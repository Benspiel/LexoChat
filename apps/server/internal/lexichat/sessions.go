package lexichat

import (
	"errors"
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
)

// createSession creates a new session record for a successful login.
func (s *Server) createSession(app core.App, user *core.Record, client, device, ip string) (*core.Record, error) {
	col, err := app.FindCachedCollectionByNameOrId(ColSessions)
	if err != nil {
		return nil, err
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
	return sess, app.Save(sess)
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
		// direct update without hooks (no audit/realtime noise)
		_, err := e.App.DB().Update(ColSessions, dbx.Params{"last_seen": types.NowDateTime().String()}, dbx.HashExp{"id": sess.Id}).Execute()
		if err != nil {
			e.App.Logger().Warn("failed to update session last_seen", "error", err)
		}
	}

	e.Set(requestKeySession, sess)
	return e.Next()
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
