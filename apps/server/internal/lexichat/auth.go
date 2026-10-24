package lexichat

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/benspiel/lexochat/apps/server/internal/lxkdf"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	// failed logins before the account is temporarily locked
	lockoutThreshold = 5
	// maximum lock duration (exponential backoff: 1, 2, 4, ... minutes)
	lockoutMax = 60 * time.Minute

	msgLoginFailed   = "Anmeldung fehlgeschlagen. Benutzername oder Passwort falsch – nach mehreren Fehlversuchen wird das Konto vorübergehend gesperrt."
	msgAdminWebOnly  = "Die Verwaltungsoberfläche ist nur für Administratorinnen und Administratoren zugänglich."
	msgAccountLocked = msgLoginFailed // intentionally identical (no account enumeration)
)

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

// lockDuration returns the lock duration after the given number of consecutive failures.
func lockDuration(failures int) time.Duration {
	if failures < lockoutThreshold {
		return 0
	}
	exp := failures - lockoutThreshold
	if exp > 6 {
		return lockoutMax
	}
	d := time.Duration(1<<exp) * time.Minute
	if d > lockoutMax {
		return lockoutMax
	}
	return d
}

func isLocked(user *core.Record, now time.Time) bool {
	lu := user.GetDateTime("locked_until")
	return !lu.IsZero() && now.Before(lu.Time())
}

// registerFailedLogin atomically increments the failure counter and locks the account if needed.
func (s *Server) registerFailedLogin(app core.App, user *core.Record, ip string) {
	_, err := app.DB().NewQuery("UPDATE {{users}} SET [[failed_logins]] = COALESCE([[failed_logins]], 0) + 1 WHERE [[id]] = {:id}").
		Bind(dbx.Params{"id": user.Id}).Execute()
	if err != nil {
		app.Logger().Error("failed to count failed login", "error", err)
		return
	}

	var row struct {
		Failed int `db:"failed_logins"`
	}
	if err := app.DB().Select("failed_logins").From(ColUsers).Where(dbx.HashExp{"id": user.Id}).One(&row); err != nil {
		app.Logger().Error("failed to read failed logins", "error", err)
		return
	}

	details := map[string]any{"failures": row.Failed}
	if d := lockDuration(row.Failed); d > 0 {
		until := types.NowDateTime().Add(d)
		_, err := app.DB().Update(ColUsers, dbx.Params{"locked_until": until.String()}, dbx.HashExp{"id": user.Id}).Execute()
		if err != nil {
			app.Logger().Error("failed to lock account", "error", err)
		}
		details["locked_minutes"] = int(d / time.Minute)
		s.Audit(app, AuditEntry{Action: AuditLoginLocked, TargetType: ColUsers, TargetId: user.Id, TargetLabel: user.GetString("username"), Details: details, IP: ip})
		return
	}

	s.Audit(app, AuditEntry{Action: AuditLoginFailed, TargetType: ColUsers, TargetId: user.Id, TargetLabel: user.GetString("username"), Details: details, IP: ip})
}

func resetFailedLogins(app core.App, userId string) error {
	_, err := app.DB().Update(ColUsers, dbx.Params{"failed_logins": 0, "locked_until": ""}, dbx.HashExp{"id": userId}).Execute()
	return err
}

func (s *Server) registerAuthHooks(app core.App) {
	// brute force protection around the password login
	app.OnRecordAuthWithPasswordRequest(ColUsers).BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
		ip := e.RealIP()
		user := e.Record

		if user != nil && isLocked(user, time.Now()) {
			s.Audit(e.App, AuditEntry{Action: AuditLoginRejected, TargetType: ColUsers, TargetId: user.Id, TargetLabel: user.GetString("username"), Details: map[string]any{"reason": "locked"}, IP: ip})
			return e.BadRequestError(msgAccountLocked, nil)
		}

		err := e.Next()
		if err == nil {
			return nil
		}

		wrongCredentials := user == nil || !user.ValidatePassword(e.Password)
		switch {
		case user == nil:
			// unknown user: the submitted identity is not stored (could be a mistyped password)
			s.Audit(e.App, AuditEntry{Action: AuditLoginFailed, Details: map[string]any{"reason": "unknown_user"}, IP: ip})
		case wrongCredentials:
			s.registerFailedLogin(e.App, user, ip)
		default:
			// correct password, but rejected afterwards (inactive, admin web, ...)
			if !user.GetBool("active") {
				s.Audit(e.App, AuditEntry{Action: AuditLoginRejected, TargetType: ColUsers, TargetId: user.Id, TargetLabel: user.GetString("username"), Details: map[string]any{"reason": "inactive"}, IP: ip})
			}
		}

		if wrongCredentials {
			return e.BadRequestError(msgLoginFailed, nil)
		}
		return err
	})

	// runs after successful credential verification (login) and on token refresh
	app.OnRecordAuthRequest(ColUsers).BindFunc(func(e *core.RecordAuthRequestEvent) error {
		if e.AuthMethod == "" {
			// token refresh: the session middleware already validated the session
			if sess := currentSession(e.RequestEvent); sess != nil {
				e.Meta = map[string]any{"sessionId": sess.Id}
			}
			return e.Next()
		}

		ip := e.RealIP()
		origin := strings.TrimRight(e.Request.Header.Get("Origin"), "/")
		client := ClientDesktop
		if s.cfg.AdminOrigin != "" && origin == s.cfg.AdminOrigin {
			client = ClientAdminWeb
			if e.Record.GetString("role") != RoleAdmin {
				s.Audit(e.App, AuditEntry{Action: AuditLoginRejected, TargetType: ColUsers, TargetId: e.Record.Id, TargetLabel: e.Record.GetString("username"), Details: map[string]any{"reason": "admin_web_non_admin"}, IP: ip})
				return e.ForbiddenError(msgAdminWebOnly, nil)
			}
		}

		if err := s.checkLoginTotp(e); err != nil {
			return err
		}

		sess, resumeSecret, err := s.createSession(e.App, e.Record, client, e.Request.Header.Get(HeaderDevice), ip)
		if err != nil {
			return e.InternalServerError("", err)
		}

		meta := map[string]any{
			"sessionId":          sess.Id,
			"mustChangePassword": e.Record.GetBool("must_change_password"),
			"totpSetupRequired":  requires2FASetup(e.App, e.Record),
		}
		if resumeSecret != "" {
			meta["resumeSecret"] = resumeSecret
		}
		e.Meta = meta

		if err := e.Next(); err != nil {
			if delErr := e.App.Delete(sess); delErr != nil {
				e.App.Logger().Error("failed to delete aborted session", "error", delErr)
			}
			return err
		}

		if err := resetFailedLogins(e.App, e.Record.Id); err != nil {
			e.App.Logger().Error("failed to reset failed logins", "error", err)
		}
		s.Audit(e.App, AuditEntry{Action: AuditLoginSuccess, Actor: e.Record, TargetType: ColSessions, TargetId: sess.Id, Details: map[string]any{"client": client}, IP: ip})
		return nil
	})
}

// fakeSalt returns a deterministic salt for unknown usernames (no account enumeration via prelogin).
func (s *Server) fakeSalt(username string) string {
	mac := hmac.New(sha256.New, []byte(s.cfg.ServerSecret))
	mac.Write([]byte("prelogin:" + strings.ToLower(username)))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil)[:lxkdf.SaltBytes])
}

// handlePrelogin returns the KDF parameters needed to derive the auth key.
func (s *Server) handlePrelogin(e *core.RequestEvent) error {
	username := strings.TrimSpace(e.Request.URL.Query().Get("username"))
	if username == "" || len(username) > 64 {
		return e.BadRequestError("Ungültiger Benutzername.", nil)
	}

	resp := map[string]any{
		"salt":   s.fakeSalt(username),
		"params": lxkdf.DefaultParams(),
	}

	user, err := e.App.FindFirstRecordByFilter(ColUsers, "username = {:u}", dbx.Params{"u": strings.ToLower(username)})
	if err == nil && user.GetString("kdf_salt") != "" {
		var params lxkdf.Params
		if err := user.UnmarshalJSONField("kdf_params", &params); err == nil && params.Validate() == nil {
			resp["salt"] = user.GetString("kdf_salt")
			resp["params"] = params
		}
	}

	return e.JSON(http.StatusOK, resp)
}
