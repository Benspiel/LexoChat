package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Rule building blocks, frozen for this migration (see docs/02-rechtekonzept.md).
const (
	ruleActive = `@request.auth.collectionName = "users" && @request.auth.active = true && @request.auth.must_change_password = false`
	ruleAdmin  = ruleActive + ` && @request.auth.role = "admin"`
)

func init() {
	m.Register(func(app core.App) error {
		users, err := setupUsers(app)
		if err != nil {
			return err
		}
		if err := createSettings(app); err != nil {
			return err
		}
		if err := createSessions(app, users); err != nil {
			return err
		}
		chats, err := createChats(app, users)
		if err != nil {
			return err
		}
		broadcasts, err := createBroadcasts(app, users)
		if err != nil {
			return err
		}
		messages, err := createMessages(app, users, chats, broadcasts)
		if err != nil {
			return err
		}
		if err := createReceipts(app, users, messages); err != nil {
			return err
		}
		return createAuditLogs(app)
	}, func(app core.App) error {
		for _, name := range []string{"audit_logs", "receipts", "messages", "broadcasts", "chats", "sessions", "lx_settings"} {
			c, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				continue
			}
			if err := app.Delete(c); err != nil {
				return err
			}
		}
		return nil
	})
}

func intPtr(v float64) *float64 { return &v }

func setupUsers(app core.App) (*core.Collection, error) {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return nil, err
	}

	// --- rules (default: deny) ---
	users.ListRule = types.Pointer(ruleActive + ` && (active = true || id = @request.auth.id || @request.auth.role = "admin")`)
	users.ViewRule = types.Pointer(`@request.auth.collectionName = "users" && (id = @request.auth.id || (` + ruleActive + ` && (active = true || @request.auth.role = "admin")))`)
	// accounts are created only via the admin endpoint (POST /api/lexichat/admin/users)
	users.CreateRule = nil
	users.UpdateRule = types.Pointer(
		`(id = @request.auth.id && ` + ruleActive +
			` && @request.body.role:isset = false && @request.body.active:isset = false` +
			` && @request.body.username:isset = false && @request.body.must_change_password:isset = false)` +
			` || (` + ruleAdmin + `)`)
	users.DeleteRule = types.Pointer(ruleAdmin)
	users.ManageRule = nil
	users.AuthRule = types.Pointer(`active = true`)

	// --- auth options ---
	users.PasswordAuth.Enabled = true
	users.PasswordAuth.IdentityFields = []string{"username"}
	users.OAuth2.Enabled = false
	users.OTP.Enabled = false
	users.MFA.Enabled = false
	users.AuthAlert.Enabled = false // no e-mail delivery in LexiChat
	users.AuthToken.Duration = 1800 // 30 min, the clients refresh the token

	// --- fields ---
	if f, ok := users.Fields.GetByName("email").(*core.EmailField); ok {
		f.Required = false
	}
	if f, ok := users.Fields.GetByName("password").(*core.PasswordField); ok {
		// the "password" is the hex encoded auth key derived on the client (see internal/lxkdf)
		f.Min = 64
		f.Max = 64
		f.Pattern = `^[0-9a-f]{64}$`
	}
	if f, ok := users.Fields.GetByName("name").(*core.TextField); ok {
		f.Required = true
		f.Min = 1
		f.Max = 80
	}
	if f, ok := users.Fields.GetByName("avatar").(*core.FileField); ok {
		// no SVG (scriptable), small files only, protected downloads
		f.MimeTypes = []string{"image/jpeg", "image/png", "image/webp"}
		f.MaxSize = 512 * 1024
		f.Protected = true
		f.Thumbs = []string{"96x96"}
	}

	users.Fields.Add(&core.TextField{
		Name:     "username",
		Required: true,
		Min:      3,
		Max:      32,
		Pattern:  `^[a-z0-9][a-z0-9._-]{2,31}$`,
	})
	users.Fields.Add(&core.SelectField{
		Name:      "role",
		Required:  true,
		MaxSelect: 1,
		Values:    []string{"admin", "user"},
	})
	users.Fields.Add(&core.BoolField{Name: "active"})
	users.Fields.Add(&core.BoolField{Name: "must_change_password"})

	// key derivation parameters (only served via /api/lexichat/prelogin)
	users.Fields.Add(&core.TextField{Name: "kdf_salt", Hidden: true, Max: 64})
	users.Fields.Add(&core.JSONField{Name: "kdf_params", Hidden: true, MaxSize: 256})

	// public keys (visible for all active users)
	users.Fields.Add(&core.TextField{Name: "public_enc_key", Max: 64})
	users.Fields.Add(&core.TextField{Name: "public_sign_key", Max: 64})
	users.Fields.Add(&core.NumberField{Name: "key_version", OnlyInt: true, Min: intPtr(0)})
	users.Fields.Add(&core.DateField{Name: "keys_updated"})

	// private keys, encrypted on the client (only served to the owner via /api/lexichat/me/keys)
	users.Fields.Add(&core.JSONField{Name: "wrapped_private_keys", Hidden: true, MaxSize: 4096})
	users.Fields.Add(&core.JSONField{Name: "recovery_wrapped_keys", Hidden: true, MaxSize: 4096})

	// brute force protection
	users.Fields.Add(&core.NumberField{Name: "failed_logins", Hidden: true, OnlyInt: true, Min: intPtr(0)})
	users.Fields.Add(&core.DateField{Name: "locked_until", Hidden: true})

	users.AddIndex("idx_users_username", true, "`username` COLLATE NOCASE", "")

	return users, app.Save(users)
}

func createSettings(app core.App) error {
	c := core.NewBaseCollection("lx_settings")
	c.ListRule = types.Pointer(ruleActive)
	c.ViewRule = types.Pointer(ruleActive)
	c.CreateRule = nil
	c.UpdateRule = types.Pointer(ruleAdmin)
	c.DeleteRule = nil

	c.Fields.Add(
		&core.NumberField{Name: "message_retention_days", Required: true, OnlyInt: true, Min: intPtr(1), Max: intPtr(3650)},
		&core.SelectField{Name: "broadcast_permission", Required: true, MaxSelect: 1, Values: []string{"all", "admins"}},
		&core.BoolField{Name: "require_2fa_admins"},
		&core.BoolField{Name: "allow_2fa_users"},
		&core.NumberField{Name: "session_idle_minutes", Required: true, OnlyInt: true, Min: intPtr(5), Max: intPtr(1440)},
		&core.NumberField{Name: "session_max_days", Required: true, OnlyInt: true, Min: intPtr(1), Max: intPtr(90)},
		&core.NumberField{Name: "desktop_lock_minutes", Required: true, OnlyInt: true, Min: intPtr(1), Max: intPtr(240)},
		&core.NumberField{Name: "audit_retention_days", Required: true, OnlyInt: true, Min: intPtr(30), Max: intPtr(3650)},
		&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
	)
	if err := app.Save(c); err != nil {
		return err
	}

	r := core.NewRecord(c)
	r.Set("id", "globalsettings1")
	r.Set("message_retention_days", 90)
	r.Set("broadcast_permission", "all")
	r.Set("require_2fa_admins", true)
	r.Set("allow_2fa_users", true)
	r.Set("session_idle_minutes", 480)
	r.Set("session_max_days", 14)
	r.Set("desktop_lock_minutes", 10)
	r.Set("audit_retention_days", 365)
	return app.Save(r)
}

func createSessions(app core.App, users *core.Collection) error {
	c := core.NewBaseCollection("sessions")
	own := `@request.auth.collectionName = "users" && (user = @request.auth.id || (` + ruleAdmin + `))`
	c.ListRule = types.Pointer(own)
	c.ViewRule = types.Pointer(own)
	c.CreateRule = nil // created on login only
	c.UpdateRule = nil
	c.DeleteRule = types.Pointer(own) // "Sitzung beenden"

	c.Fields.Add(
		&core.RelationField{Name: "user", Required: true, MaxSelect: 1, CollectionId: users.Id, CascadeDelete: true},
		&core.SelectField{Name: "client", Required: true, MaxSelect: 1, Values: []string{"desktop", "admin_web"}},
		&core.TextField{Name: "device_name", Max: 64},
		&core.TextField{Name: "ip_hash", Max: 32},
		&core.DateField{Name: "last_seen"},
		&core.DateField{Name: "expires_at", Required: true},
		&core.AutodateField{Name: "created", OnCreate: true},
	)
	c.AddIndex("idx_sessions_user", false, "`user`", "")
	return app.Save(c)
}

func createChats(app core.App, users *core.Collection) (*core.Collection, error) {
	c := core.NewBaseCollection("chats")
	member := ruleActive + ` && members.id ?= @request.auth.id`
	c.ListRule = types.Pointer(member)
	c.ViewRule = types.Pointer(member)
	c.CreateRule = types.Pointer(ruleActive) // details validated in the create hook
	c.UpdateRule = nil
	c.DeleteRule = nil

	c.Fields.Add(
		&core.SelectField{Name: "type", Required: true, MaxSelect: 1, Values: []string{"direct"}},
		&core.RelationField{Name: "members", Required: true, MinSelect: 2, MaxSelect: 2, CollectionId: users.Id},
		&core.TextField{Name: "member_key", Required: true, Max: 200},
		&core.DateField{Name: "last_message_at"},
		&core.AutodateField{Name: "created", OnCreate: true},
		&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
	)
	c.AddIndex("idx_chats_member_key", true, "`member_key`", "")
	return c, app.Save(c)
}

func createBroadcasts(app core.App, users *core.Collection) (*core.Collection, error) {
	c := core.NewBaseCollection("broadcasts")
	own := ruleActive + ` && sender = @request.auth.id`
	c.ListRule = types.Pointer(own)
	c.ViewRule = types.Pointer(own)
	c.CreateRule = nil // only via POST /api/lexichat/broadcasts (phase 4)
	c.UpdateRule = nil
	c.DeleteRule = nil

	c.Fields.Add(
		&core.RelationField{Name: "sender", Required: true, MaxSelect: 1, CollectionId: users.Id, CascadeDelete: true},
		&core.NumberField{Name: "recipient_count", OnlyInt: true, Min: intPtr(0)},
		&core.DateField{Name: "expires_at"},
		&core.AutodateField{Name: "created", OnCreate: true},
	)
	return c, app.Save(c)
}

func createMessages(app core.App, users, chats, broadcasts *core.Collection) (*core.Collection, error) {
	c := core.NewBaseCollection("messages")
	member := ruleActive + ` && chat.members.id ?= @request.auth.id`
	c.ListRule = types.Pointer(member)
	c.ViewRule = types.Pointer(member)
	c.CreateRule = types.Pointer(ruleActive + ` && @request.body.sender = @request.auth.id && @request.body.chat.members.id ?= @request.auth.id`)
	c.UpdateRule = types.Pointer(ruleActive + ` && sender = @request.auth.id && chat.members.id ?= @request.auth.id`)
	c.DeleteRule = types.Pointer(ruleActive + ` && sender = @request.auth.id && chat.members.id ?= @request.auth.id`)

	c.Fields.Add(
		&core.RelationField{Name: "chat", Required: true, MaxSelect: 1, CollectionId: chats.Id, CascadeDelete: true},
		&core.RelationField{Name: "sender", Required: true, MaxSelect: 1, CollectionId: users.Id, CascadeDelete: true},
		&core.NumberField{Name: "v", Required: true, OnlyInt: true, Min: intPtr(1), Max: intPtr(1)},
		&core.TextField{Name: "ciphertext", Required: true, Max: 100_000},
		&core.TextField{Name: "nonce", Required: true, Max: 64},
		&core.JSONField{Name: "envelopes", Required: true, MaxSize: 16 * 1024},
		&core.TextField{Name: "signature", Required: true, Max: 200},
		&core.BoolField{Name: "is_broadcast"},
		&core.RelationField{Name: "broadcast", MaxSelect: 1, CollectionId: broadcasts.Id, CascadeDelete: true},
		&core.DateField{Name: "edited_at"},
		&core.DateField{Name: "expires_at"},
		&core.AutodateField{Name: "created", OnCreate: true},
		&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
	)
	c.AddIndex("idx_messages_chat_created", false, "`chat`, `created`", "")
	c.AddIndex("idx_messages_expires", false, "`expires_at`", "")
	c.AddIndex("idx_messages_broadcast", false, "`broadcast`", "")
	if err := app.Save(c); err != nil {
		return nil, err
	}

	// self relation (needs the collection id)
	c.Fields.Add(&core.RelationField{Name: "reply_to", MaxSelect: 1, CollectionId: c.Id})
	return c, app.Save(c)
}

func createReceipts(app core.App, users, messages *core.Collection) error {
	c := core.NewBaseCollection("receipts")
	c.ListRule = types.Pointer(ruleActive + ` && (user = @request.auth.id || message.sender = @request.auth.id)`)
	c.ViewRule = c.ListRule
	c.CreateRule = types.Pointer(ruleActive + ` && @request.body.user = @request.auth.id`)
	c.UpdateRule = types.Pointer(ruleActive + ` && user = @request.auth.id`)
	c.DeleteRule = nil

	c.Fields.Add(
		&core.RelationField{Name: "message", Required: true, MaxSelect: 1, CollectionId: messages.Id, CascadeDelete: true},
		&core.RelationField{Name: "user", Required: true, MaxSelect: 1, CollectionId: users.Id, CascadeDelete: true},
		&core.DateField{Name: "delivered_at"},
		&core.DateField{Name: "read_at"},
	)
	c.AddIndex("idx_receipts_message_user", true, "`message`, `user`", "")
	return app.Save(c)
}

func createAuditLogs(app core.App) error {
	c := core.NewBaseCollection("audit_logs")
	c.ListRule = types.Pointer(ruleAdmin)
	c.ViewRule = types.Pointer(ruleAdmin)
	c.CreateRule = nil
	c.UpdateRule = nil
	c.DeleteRule = nil

	c.Fields.Add(
		&core.TextField{Name: "action", Required: true, Max: 64},
		&core.TextField{Name: "actor_id", Max: 32},
		&core.TextField{Name: "actor_username", Max: 32},
		&core.TextField{Name: "target_type", Max: 32},
		&core.TextField{Name: "target_id", Max: 32},
		&core.TextField{Name: "target_label", Max: 80},
		&core.JSONField{Name: "details", MaxSize: 2048},
		&core.TextField{Name: "ip_hash", Max: 32},
		&core.TextField{Name: "prev_hash", Max: 64},
		&core.TextField{Name: "hash", Max: 64},
		// set by the audit writer (part of the hash chain), not an autodate
		&core.DateField{Name: "created", Required: true},
	)
	c.AddIndex("idx_audit_created", false, "`created`", "")
	return app.Save(c)
}
