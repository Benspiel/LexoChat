package lexichat

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	requestKeySession  = "lexichatSession"
	realtimeKeySession = "lexichatSession"

	msgSessionInvalid = "Ihre Sitzung ist abgelaufen oder wurde beendet. Bitte melden Sie sich erneut an."
	msgMustChangePw   = "Bitte ändern Sie zuerst Ihr Passwort."

	// last_seen is written at most once per interval (avoids a db write per request)
	lastSeenWriteInterval = time.Minute

	// "Einmal anmelden": a desktop session has no idle timeout and its expiry slides
	// forward with every use, so a PC that is used at least once a year never has
	// to log in again. Revocation (session list, password change/reset,
	// deactivation) still ends it immediately.
	desktopSessionLifetime = 365 * 24 * time.Hour
)

// newResumeSecret returns a random secret (hex) and its sha256 (hex) for storage.
func newResumeSecret() (secret, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	secret = hex.EncodeToString(b)
	return secret, hashResumeSecret(secret), nil
}

func hashResumeSecret(secret string) string {
	sum := sha256Sum([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// createSession creates a new session record for a successful login. For desktop
// sessions the returned resume secret lets the app start later without a password.
func (s *Server) createSession(app core.App, user *core.Record, client, device, ip string) (*core.Record, string, error) {
	col, err := app.FindCachedCollectionByNameOrId(ColSessions)
	if err != nil {
		return nil, "", err
	}
	gs := loadGlobalSettings(app)

	now := types.NowDateTime()
	sess := core.NewRecord(col)
	sess.Set("user", user.Id)
	sess.Set("client", client)
	sess.Set("device_name", sanitizeDeviceName(device))
	sess.Set("ip_hash", s.audit.hashIP(ip))
	sess.Set("last_seen", now)
	sess.Set("expires_at", now.Add(time.Duration(gs.SessionMaxDays)*24*time.Hour))
	secret := ""
	if client == ClientDesktop {
		var hash string
		if secret, hash, err = newResumeSecret(); err != nil {
			return nil, "", err
		}
		sess.Set("resume_hash", hash)
		sess.Set("expires_at", now.Add(desktopSessionLifetime))
	}
	return sess, secret, app.Save(sess)
}

func sanitizeDeviceName(name string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	return truncate(strings.TrimSpace(name), 64)
}

// sessionValid reports whether the session is not expired (absolute and idle timeout).
func sessionValid(sess *core.Record, gs GlobalSettings, now time.Time) bool {
	if exp := sess.GetDateTime("expires_at"); exp.IsZero() || !now.Before(exp.Time()) {
		return false
	}
	if sess.GetString("client") == ClientDesktop {
		return true
	}
	idle := time.Duration(gs.SessionIdleMinutes) * time.Minute
	if last := sess.GetDateTime("last_seen"); !last.IsZero() && now.Sub(last.Time()) > idle {
		return false
	}
	return true
}

// sessionMiddleware binds every users token to a live session record.
// A valid token without (or with a revoked/expired) session is rejected.
func (s *Server) sessionMiddleware(e *core.RequestEvent) error {
	if e.Auth == nil || e.Auth.Collection().Name != ColUsers {
		return e.Next()
	}

	sid := e.Request.Header.Get(HeaderSession)
	if sid == "" {
		return e.UnauthorizedError(msgSessionInvalid, nil)
	}

	sess, err := e.App.FindRecordById(ColSessions, sid)
	if err != nil || sess.GetString("user") != e.Auth.Id {
		return e.UnauthorizedError(msgSessionInvalid, nil)
	}

	now := time.Now()
	if !sessionValid(sess, loadGlobalSettings(e.App), now) {
		if err := e.App.Delete(sess); err != nil {
			e.App.Logger().Warn("failed to delete expired session", "error", err)
		}
		return e.UnauthorizedError(msgSessionInvalid, nil)
	}

	if now.Sub(sess.GetDateTime("last_seen").Time()) > lastSeenWriteInterval {
		touchSession(e.App, sess)
	}

	e.Set(requestKeySession, sess)
	return e.Next()
}

// touchSession updates last_seen (and slides the expiry of desktop sessions).
// Direct update without hooks (no audit/realtime noise).
func touchSession(app core.App, sess *core.Record) {
	nowDt := types.NowDateTime()
	params := dbx.Params{"last_seen": nowDt.String()}
	if sess.GetString("client") == ClientDesktop {
		params["expires_at"] = nowDt.Add(desktopSessionLifetime).String()
	}
	if _, err := app.DB().Update(ColSessions, params, dbx.HashExp{"id": sess.Id}).Execute(); err != nil {
		app.Logger().Warn("failed to update session last_seen", "error", err)
	}
}

// handleResumeSession starts a remembered desktop session again without the
// password: the app sends the session id and the resume secret from the Windows
// Credential Manager and gets a fresh auth token for that (still valid) session.
func (s *Server) handleResumeSession(e *core.RequestEvent) error {
	var body struct {
		SessionId    string `json:"sessionId"`
		ResumeSecret string `json:"resumeSecret"`
	}
	if err := e.BindBody(&body); err != nil || body.SessionId == "" || len(body.ResumeSecret) != 64 {
		return e.UnauthorizedError(msgSessionInvalid, nil)
	}

	sess, err := e.App.FindRecordById(ColSessions, body.SessionId)
	if err != nil || sess.GetString("client") != ClientDesktop || sess.GetString("resume_hash") == "" {
		return e.UnauthorizedError(msgSessionInvalid, nil)
	}
	if subtle.ConstantTimeCompare([]byte(hashResumeSecret(body.ResumeSecret)), []byte(sess.GetString("resume_hash"))) != 1 {
		return e.UnauthorizedError(msgSessionInvalid, nil)
	}
	if !sessionValid(sess, loadGlobalSettings(e.App), time.Now()) {
		if err := e.App.Delete(sess); err != nil {
			e.App.Logger().Warn("failed to delete expired session", "error", err)
		}
		return e.UnauthorizedError(msgSessionInvalid, nil)
	}

	user, err := e.App.FindRecordById(ColUsers, sess.GetString("user"))
	if err != nil || !user.GetBool("active") {
		return e.UnauthorizedError(msgSessionInvalid, nil)
	}
	token, err := user.NewAuthToken()
	if err != nil {
		return e.InternalServerError("", err)
	}
	touchSession(e.App, sess)

	return e.JSON(http.StatusOK, map[string]any{
		"token":  token,
		"record": user,
		"meta": map[string]any{
			"sessionId":          sess.Id,
			"mustChangePassword": user.GetBool("must_change_password"),
			"totpSetupRequired":  requires2FASetup(e.App, user),
		},
	})
}

// restrictedAccountMiddleware limits accounts with a one-time password (or admins
// without the mandatory second factor) to the endpoints needed to fix that.
func (s *Server) restrictedAccountMiddleware(e *core.RequestEvent) error {
	if e.Auth == nil || e.Auth.Collection().Name != ColUsers {
		return e.Next()
	}
	msg := ""
	switch {
	case e.Auth.GetBool("must_change_password"):
		msg = msgMustChangePw
	case requires2FASetup(e.App, e.Auth):
		msg = msgTotpSetupReq
	default:
		return e.Next()
	}

	path := e.Request.URL.Path
	method := e.Request.Method
	allowed := strings.HasPrefix(path, "/api/lexichat/me") ||
		(method == "POST" && path == "/api/collections/users/auth-refresh") ||
		(method == "GET" && path == "/api/collections/users/records/"+e.Auth.Id) ||
		(method == "DELETE" && strings.HasPrefix(path, "/api/collections/sessions/records/"))
	if !allowed {
		return e.ForbiddenError(msg, nil)
	}
	return e.Next()
}

// currentSession returns the session validated by the middleware (or nil).
func currentSession(e *core.RequestEvent) *core.Record {
	sess, _ := e.Get(requestKeySession).(*core.Record)
	return sess
}

// deleteUserSessions removes all sessions of a user (except keepId, if set).
func deleteUserSessions(app core.App, userId string, keepId string) error {
	sessions, err := app.FindAllRecords(ColSessions, dbx.HashExp{"user": userId})
	if err != nil {
		return err
	}
	var errs []error
	for _, sess := range sessions {
		if sess.Id == keepId {
			continue
		}
		errs = append(errs, app.Delete(sess))
	}
	return errors.Join(errs...)
}

func (s *Server) registerSessionHooks(app core.App) {
	// remember the session of authenticated realtime clients
	app.OnRealtimeSubscribeRequest().BindFunc(func(e *core.RealtimeSubscribeRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if sess := currentSession(e.RequestEvent); sess != nil {
			e.Client.Set(realtimeKeySession, sess.Id)
		}
		return nil
	})

	// a deleted (revoked, expired) session immediately disconnects its realtime clients
	app.OnRecordAfterDeleteSuccess(ColSessions).BindFunc(func(e *core.RecordEvent) error {
		for _, client := range e.App.SubscriptionsBroker().Clients() {
			if sid, _ := client.Get(realtimeKeySession).(string); sid == e.Record.Id {
				client.Discard()
			}
		}
		return e.Next()
	})

	app.OnRecordDeleteRequest(ColSessions).BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		s.Audit(e.App, AuditEntry{
			Action:     AuditSessionRevoked,
			Actor:      e.Auth,
			TargetType: ColSessions,
			TargetId:   e.Record.Id,
			Details:    map[string]any{"user": e.Record.GetString("user")},
			IP:         e.RealIP(),
		})
		return nil
	})
}
