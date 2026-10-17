package lexichat

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Audit actions. Audit entries never contain message content.
const (
	AuditLoginSuccess       = "auth.login_success"
	AuditLoginFailed        = "auth.login_failed"
	AuditLoginLocked        = "auth.account_locked"
	AuditLoginRejected      = "auth.login_rejected"
	AuditSessionRevoked     = "auth.session_revoked"
	AuditPasswordChanged    = "auth.password_changed"
	AuditKeysChanged        = "auth.keys_changed"
	AuditUserCreated        = "admin.user_created"
	AuditUserUpdated        = "admin.user_updated"
	AuditUserDeactivated    = "admin.user_deactivated"
	AuditUserReactivated    = "admin.user_reactivated"
	AuditUserRoleChanged    = "admin.user_role_changed"
	AuditUserDeleted        = "admin.user_deleted"
	AuditUserPasswordReset  = "admin.user_password_reset"
	AuditSettingsChanged    = "admin.settings_changed"
	AuditTotpEnabled        = "auth.totp_enabled"
	AuditTotpDisabled       = "auth.totp_disabled"
	AuditUserTotpReset      = "admin.user_totp_reset"
	AuditUserUnlocked       = "admin.user_unlocked"
	AuditBootstrapAdmin     = "system.bootstrap_admin"
	AuditRetentionCompleted = "system.retention_cleanup"
)

// AuditEntry describes one audit event.
type AuditEntry struct {
	Action      string
	Actor       *core.Record // may be nil (system / unknown user)
	TargetType  string
	TargetId    string
	TargetLabel string
	Details     map[string]any
	IP          string // raw ip, only stored as keyed hash
}

type auditor struct {
	secret []byte
	mu     sync.Mutex
}

// hashIP returns a truncated keyed hash of the ip address (pseudonymisation).
func (a *auditor) hashIP(ip string) string {
	if ip == "" {
		return ""
	}
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte("ip:" + ip))
	return hex.EncodeToString(mac.Sum(nil))[:16]
}

// Write appends an entry to the hash chained audit log.
func (a *auditor) Write(app core.App, entry AuditEntry) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	col, err := app.FindCachedCollectionByNameOrId(ColAuditLogs)
	if err != nil {
		return err
	}

	r := core.NewRecord(col)
	r.Set("action", entry.Action)
	if entry.Actor != nil {
		r.Set("actor_id", entry.Actor.Id)
		r.Set("actor_username", entry.Actor.GetString("username"))
	}
	r.Set("target_type", entry.TargetType)
	r.Set("target_id", entry.TargetId)
	r.Set("target_label", truncate(entry.TargetLabel, 80))
	if entry.Details != nil {
		r.Set("details", entry.Details)
	}
	r.Set("ip_hash", a.hashIP(entry.IP))

	now := types.NowDateTime()
	r.Set("created", now)

	prev := struct {
		Hash string `db:"hash"`
	}{}
	err = app.DB().Select("hash").From(ColAuditLogs).OrderBy("created DESC", "rowid DESC").Limit(1).One(&prev)
	if err != nil && !isNoRows(err) {
		return err
	}
	r.Set("prev_hash", prev.Hash)
	r.Set("hash", auditHash(prev.Hash, r))

	return app.SaveNoValidate(r)
}

// auditHash computes the chain hash of an audit record.
func auditHash(prevHash string, r *core.Record) string {
	payload, _ := json.Marshal([]any{
		prevHash,
		r.GetString("action"),
		r.GetString("actor_id"),
		r.GetString("actor_username"),
		r.GetString("target_type"),
		r.GetString("target_id"),
		r.GetString("target_label"),
		r.Get("details"),
		r.GetString("ip_hash"),
		r.GetDateTime("created").String(),
	})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

// VerifyAuditChain checks the hash chain of all remaining audit entries.
// The first remaining entry may point to an already deleted (expired) predecessor.
func VerifyAuditChain(app core.App) (int, error) {
	col, err := app.FindCachedCollectionByNameOrId(ColAuditLogs)
	if err != nil {
		return 0, err
	}
	records := []*core.Record{}
	if err := app.RecordQuery(col).OrderBy("created ASC", "rowid ASC").All(&records); err != nil {
		return 0, err
	}
	prev := ""
	for i, r := range records {
		if i > 0 && r.GetString("prev_hash") != prev {
			return i, errors.New("audit chain broken (prev_hash mismatch) at " + r.Id)
		}
		if auditHash(r.GetString("prev_hash"), r) != r.GetString("hash") {
			return i, errors.New("audit chain broken (hash mismatch) at " + r.Id)
		}
		prev = r.GetString("hash")
	}
	return len(records), nil
}

// protectAuditLogs makes the audit log append-only on the model level
// (the retention job deletes old entries with a direct query).
func protectAuditLogs(app core.App) {
	deny := func(e *core.ModelEvent) error {
		return errors.New("audit logs are append-only")
	}
	app.OnModelUpdate(ColAuditLogs).Bind(&hook.Handler[*core.ModelEvent]{Func: deny, Priority: -100})
	app.OnModelDelete(ColAuditLogs).Bind(&hook.Handler[*core.ModelEvent]{Func: deny, Priority: -100})
}

// deleteAuditLogsOlderThan removes expired audit entries (retention).
func deleteAuditLogsOlderThan(app core.App, cutoff time.Time) (int64, error) {
	dt, err := types.ParseDateTime(cutoff)
	if err != nil {
		return 0, err
	}
	res, err := app.DB().Delete(ColAuditLogs, dbx.NewExp("[[created]] < {:cutoff}", dbx.Params{
		"cutoff": dt.String(),
	})).Execute()
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
