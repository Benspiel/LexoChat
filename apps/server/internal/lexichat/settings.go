package lexichat

import (
	"maps"
	"slices"

	"github.com/pocketbase/pocketbase/core"
)

// GlobalSettings mirrors the lx_settings record.
type GlobalSettings struct {
	MessageRetentionDays int
	BroadcastPermission  string
	Require2FAAdmins     bool
	Allow2FAUsers        bool
	SessionIdleMinutes   int
	SessionMaxDays       int
	DesktopLockMinutes   int
	AuditRetentionDays   int
	// 0 = never
	AnonymizeDeactivatedDays int
	BroadcastsPerHour        int
}

// defaultGlobalSettings are used if the settings record is unreadable (fail safe values).
var defaultGlobalSettings = GlobalSettings{
	MessageRetentionDays:     90,
	BroadcastPermission:      "all",
	Require2FAAdmins:         true,
	Allow2FAUsers:            true,
	SessionIdleMinutes:       480,
	SessionMaxDays:           14,
	DesktopLockMinutes:       10,
	AuditRetentionDays:       365,
	AnonymizeDeactivatedDays: 180,
	BroadcastsPerHour:        10,
}

func loadGlobalSettings(app core.App) GlobalSettings {
	r, err := app.FindRecordById(ColSettings, SettingsRecordId)
	if err != nil {
		app.Logger().Error("failed to load lx_settings, using defaults", "error", err)
		return defaultGlobalSettings
	}
	return GlobalSettings{
		MessageRetentionDays:     r.GetInt("message_retention_days"),
		BroadcastPermission:      r.GetString("broadcast_permission"),
		Require2FAAdmins:         r.GetBool("require_2fa_admins"),
		Allow2FAUsers:            r.GetBool("allow_2fa_users"),
		SessionIdleMinutes:       r.GetInt("session_idle_minutes"),
		SessionMaxDays:           r.GetInt("session_max_days"),
		DesktopLockMinutes:       r.GetInt("desktop_lock_minutes"),
		AuditRetentionDays:       r.GetInt("audit_retention_days"),
		AnonymizeDeactivatedDays: r.GetInt("anonymize_deactivated_days"),
		BroadcastsPerHour:        max(1, r.GetInt("broadcasts_per_hour")),
	}
}

// applyAppSettings enforces the security relevant PocketBase settings on every start
// ("settings as code"). Changes made in the superuser dashboard are overwritten.
func (s *Server) applyAppSettings(app core.App) error {
	st := app.Settings()

	st.Meta.AppName = "LexiChat"
	if s.cfg.AppURL != "" {
		st.Meta.AppURL = s.cfg.AppURL
	}
	st.Meta.HideControls = true

	// request logs: no ip, no auth id, limited retention
	st.Logs.MaxDays = 30
	st.Logs.LogIP = false
	st.Logs.LogAuthId = false

	st.Batch.Enabled = false

	st.RateLimits.Enabled = true
	st.RateLimits.Rules = []core.RateLimitRule{
		{Label: "*:auth", MaxRequests: 30, Duration: 60},
		{Label: "/api/lexichat/prelogin", MaxRequests: 30, Duration: 60},
		{Label: "/api/lexichat/me/password", MaxRequests: 10, Duration: 60},
		{Label: "/api/lexichat/admin/", MaxRequests: 60, Duration: 60},
		{Label: "*:create", MaxRequests: 60, Duration: 10},
		{Label: "/api/", MaxRequests: 600, Duration: 10},
	}

	if s.cfg.TrustProxy {
		st.TrustedProxy.Headers = []string{"X-Forwarded-For"}
		st.TrustedProxy.UseLeftmostIP = false
	} else {
		st.TrustedProxy.Headers = nil
	}

	st.SuperuserIPs = slices.Clone(s.cfg.SuperuserIPs)

	return app.Save(st)
}

func (s *Server) registerSettingsHooks(app core.App) {
	app.OnRecordUpdateRequest(ColSettings).BindFunc(func(e *core.RecordRequestEvent) error {
		before := e.Record.Original().FieldsData()
		if err := e.Next(); err != nil {
			return err
		}
		after := e.Record.FieldsData()
		changed := map[string]any{}
		for _, k := range slices.Sorted(maps.Keys(after)) {
			if k == "updated" {
				continue
			}
			if before[k] != after[k] {
				changed[k] = after[k]
			}
		}
		s.Audit(e.App, AuditEntry{
			Action:     AuditSettingsChanged,
			Actor:      e.Auth,
			TargetType: ColSettings,
			TargetId:   e.Record.Id,
			Details:    changed,
			IP:         e.RealIP(),
		})
		return nil
	})
}
