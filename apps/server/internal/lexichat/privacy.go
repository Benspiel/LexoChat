package lexichat

import (
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/types"
)

// ---------------------------------------------------------------------------
// Art. 15 / Art. 20 DSGVO: export of the data stored about a person
// ---------------------------------------------------------------------------

// ExportUserData collects everything the server stores about a person. Message
// contents are end-to-end encrypted: the server only has ciphertexts, so the
// export contains the metadata and the note that the plaintext only exists on
// the devices of the participants.
func ExportUserData(app core.App, userId string) (map[string]any, error) {
	u, err := app.FindRecordById(ColUsers, userId)
	if err != nil {
		return nil, err
	}

	account := map[string]any{
		"id":                   u.Id,
		"username":             u.GetString("username"),
		"name":                 u.GetString("name"),
		"role":                 u.GetString("role"),
		"active":               u.GetBool("active"),
		"anonymized":           u.GetBool("anonymized"),
		"hasAvatar":            u.GetString("avatar") != "",
		"created":              u.GetDateTime("created"),
		"updated":              u.GetDateTime("updated"),
		"deactivatedAt":        u.GetDateTime("deactivated_at"),
		"mustChangePassword":   u.GetBool("must_change_password"),
		"twoFactorEnabled":     u.GetBool("totp_enabled"),
		"publicEncryptionKey":  u.GetString("public_enc_key"),
		"publicSignatureKey":   u.GetString("public_sign_key"),
		"keyVersion":           u.GetInt("key_version"),
		"keysUpdated":          u.GetDateTime("keys_updated"),
		"privacyPreferences":   userPrefs(u),
		"failedLoginsInARow":   u.GetInt("failed_logins"),
		"temporarilyLocked":    isLocked(u, now()),
		"storedSecretsComment": "Gespeichert, aber nicht herausgegeben: bcrypt-Hash des abgeleiteten Anmeldeschlüssels, KDF-Salt, mit Ihrem Passwort bzw. Wiederherstellungsschlüssel verschlüsselte private Schlüssel, verschlüsseltes TOTP-Geheimnis.",
	}

	sessions, err := app.FindAllRecords(ColSessions, dbx.HashExp{"user": u.Id})
	if err != nil {
		return nil, err
	}
	sess := []map[string]any{}
	for _, s := range sessions {
		sess = append(sess, map[string]any{
			"client": s.GetString("client"), "device": s.GetString("device_name"),
			"created": s.GetDateTime("created"), "lastSeen": s.GetDateTime("last_seen"), "expiresAt": s.GetDateTime("expires_at"),
		})
	}

	chats, err := app.FindRecordsByFilter(ColChats, "members.id ?= {:id}", "created", 0, 0, dbx.Params{"id": u.Id})
	if err != nil {
		return nil, err
	}
	chatList := []map[string]any{}
	for _, c := range chats {
		partner := ""
		for _, m := range c.GetStringSlice("members") {
			if m != u.Id {
				if p, err := app.FindRecordById(ColUsers, m); err == nil {
					partner = p.GetString("username")
				}
			}
		}
		msgs, err := app.FindAllRecords(ColMessages, dbx.HashExp{"chat": c.Id})
		if err != nil {
			return nil, err
		}
		meta := []map[string]any{}
		for _, m := range msgs {
			meta = append(meta, map[string]any{
				"id": m.Id, "fromMe": m.GetString("sender") == u.Id, "created": m.GetDateTime("created"),
				"edited": m.GetDateTime("edited_at"), "broadcast": m.GetBool("is_broadcast"), "expiresAt": m.GetDateTime("expires_at"),
			})
		}
		chatList = append(chatList, map[string]any{
			"id": c.Id, "partner": partner, "created": c.GetDateTime("created"), "lastMessageAt": c.GetDateTime("last_message_at"), "messages": meta,
		})
	}

	receipts, err := app.FindAllRecords(ColReceipts, dbx.HashExp{"user": u.Id})
	if err != nil {
		return nil, err
	}
	rec := []map[string]any{}
	for _, r := range receipts {
		rec = append(rec, map[string]any{"message": r.GetString("message"), "deliveredAt": r.GetDateTime("delivered_at"), "readAt": r.GetDateTime("read_at")})
	}

	audits, err := app.FindRecordsByFilter(ColAuditLogs, "actor_id = {:id} || target_id = {:id}", "created", 0, 0, dbx.Params{"id": u.Id})
	if err != nil {
		return nil, err
	}
	aud := []map[string]any{}
	for _, a := range audits {
		aud = append(aud, map[string]any{
			"created": a.GetDateTime("created"), "action": a.GetString("action"), "actor": a.GetString("actor_username"),
			"target": a.GetString("target_label"), "details": a.Get("details"), "ipPseudonym": a.GetString("ip_hash"),
		})
	}

	return map[string]any{
		"format":        "lexichat-export-v1",
		"generatedAt":   types.NowDateTime(),
		"controller":    "{{PRAXIS_NAME}} – siehe Datenschutzhinweise",
		"contentNotice": "Nachrichteninhalte sind Ende-zu-Ende-verschlüsselt. Der Server kennt nur verschlüsselte Daten und Metadaten; die Klartexte liegen ausschließlich auf den Endgeräten der Beteiligten. Eine Kopie Ihrer Chatverläufe können Sie in der LexiChat-App exportieren.",
		"account":       account,
		"sessions":      sess,
		"chats":         chatList,
		"receipts":      rec,
		"auditLog":      aud,
	}, nil
}

func (s *Server) handleExportMe(e *core.RequestEvent) error {
	data, err := ExportUserData(e.App, e.Auth.Id)
	if err != nil {
		return e.InternalServerError("", err)
	}
	s.Audit(e.App, AuditEntry{Action: AuditDataExported, Actor: e.Auth, TargetType: ColUsers, TargetId: e.Auth.Id, TargetLabel: e.Auth.GetString("username"), IP: e.RealIP()})
	e.Response.Header().Set("Cache-Control", "no-store")
	e.Response.Header().Set("Content-Disposition", `attachment; filename="lexichat-datenauskunft.json"`)
	return e.JSON(http.StatusOK, data)
}

func (s *Server) handleAdminExport(e *core.RequestEvent) error {
	u, err := e.App.FindRecordById(ColUsers, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("Benutzer nicht gefunden.", nil)
	}
	data, err := ExportUserData(e.App, u.Id)
	if err != nil {
		return e.InternalServerError("", err)
	}
	s.Audit(e.App, AuditEntry{Action: AuditDataExported, Actor: e.Auth, TargetType: ColUsers, TargetId: u.Id, TargetLabel: u.GetString("username"), IP: e.RealIP()})
	e.Response.Header().Set("Cache-Control", "no-store")
	e.Response.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="lexichat-datenauskunft-%s.json"`, u.GetString("username")))
	return e.JSON(http.StatusOK, data)
}

// ---------------------------------------------------------------------------
// Art. 17 DSGVO: anonymisation (alternative to deletion, see Löschkonzept)
// ---------------------------------------------------------------------------

// AnonymizeUser removes all personal data of the account but keeps the 1:1
// chats of the conversation partners until their retention period ends. The
// messages then show "Ehemaliges Konto" as sender.
func AnonymizeUser(app core.App, u *core.Record) error {
	if u.GetBool("anonymized") {
		return nil
	}
	return app.RunInTransaction(func(txApp core.App) error {
		u.Set("name", "Ehemaliges Konto")
		u.Set("username", "geloescht-"+security.RandomStringWithAlphabet(10, "abcdefghijkmnpqrstuvwxyz23456789"))
		u.Set("email", "")
		u.Set("avatar", nil)
		u.Set("role", RoleUser)
		u.Set("active", false)
		u.Set("anonymized", true)
		u.Set("must_change_password", false)
		u.Set("prefs", nil)
		u.Set("kdf_salt", "")
		u.Set("kdf_params", nil)
		u.Set("wrapped_private_keys", nil)
		u.Set("recovery_wrapped_keys", nil)
		u.Set("failed_logins", 0)
		u.Set("locked_until", "")
		clearTotp(u)
		u.SetRandomPassword()
		if err := txApp.Save(u); err != nil {
			return err
		}
		if err := deleteUserSessions(txApp, u.Id, ""); err != nil {
			return err
		}
		// receipts reveal reading behaviour -> removed
		receipts, err := txApp.FindAllRecords(ColReceipts, dbx.HashExp{"user": u.Id})
		if err != nil {
			return err
		}
		for _, r := range receipts {
			if err := txApp.Delete(r); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Server) handleAdminAnonymize(e *core.RequestEvent) error {
	u, err := s.findOtherUser(e)
	if err != nil {
		return err
	}
	if u.GetBool("anonymized") {
		return e.BadRequestError("Das Konto ist bereits anonymisiert.", nil)
	}
	label := u.GetString("username")
	if err := AnonymizeUser(e.App, u); err != nil {
		return e.BadRequestError("Das Konto konnte nicht anonymisiert werden. Ist es der letzte aktive Admin?", err)
	}
	// the audit entry must not re-identify the person: only the old username as label
	s.Audit(e.App, AuditEntry{Action: AuditUserAnonymized, Actor: e.Auth, TargetType: ColUsers, TargetId: u.Id, TargetLabel: label, IP: e.RealIP()})
	return e.NoContent(http.StatusNoContent)
}

// anonymizeLongDeactivated anonymises accounts that are deactivated for longer
// than the configured period (Löschkonzept: ausgeschiedene Mitarbeitende).
func (s *Server) anonymizeLongDeactivated(app core.App, days int) (int, error) {
	if days <= 0 {
		return 0, nil
	}
	cutoff := types.NowDateTime().Add(-time.Duration(days) * 24 * time.Hour).String()
	users, err := app.FindAllRecords(ColUsers,
		dbx.HashExp{"active": false, "anonymized": false},
		dbx.NewExp("[[deactivated_at]] != '' AND [[deactivated_at]] < {:c}", dbx.Params{"c": cutoff}),
	)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, u := range users {
		label := u.GetString("username")
		if err := AnonymizeUser(app, u); err != nil {
			return n, err
		}
		s.Audit(app, AuditEntry{Action: AuditUserAnonymized, TargetType: ColUsers, TargetId: u.Id, TargetLabel: label, Details: map[string]any{"automatic": true, "days": days}})
		n++
	}
	return n, nil
}

// hideAnonymizedFields is used by the enrich hook.
var anonymizedVisible = []string{"id", "name", "username", "active", "anonymized", "collectionId", "collectionName"}

func hideForAnonymized(r *core.Record) {
	var hide []string
	for _, f := range r.Collection().Fields.FieldNames() {
		if !slices.Contains(anonymizedVisible, f) {
			hide = append(hide, f)
		}
	}
	r.Hide(hide...)
}
