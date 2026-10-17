package lexichat

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/tools/types"
)

// memberKey returns the canonical, order independent key of a member set.
func memberKey(ids []string) string {
	sorted := slices.Clone(ids)
	slices.Sort(sorted)
	return strings.Join(sorted, ":")
}

func (s *Server) registerChatHooks(app core.App) {
	app.OnRecordCreateRequest(ColChats).BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if err := checkBodyFields(e.RequestEvent, []string{"type", "members"}); err != nil {
			return err
		}

		members := slices.Compact(slices.Sorted(slices.Values(e.Record.GetStringSlice("members"))))
		if len(members) != 2 || !slices.Contains(members, e.Auth.Id) {
			return e.BadRequestError("Ein Chat muss genau Sie und eine weitere Person enthalten.", nil)
		}

		otherId := members[0]
		if otherId == e.Auth.Id {
			otherId = members[1]
		}
		other, err := e.App.FindRecordById(ColUsers, otherId)
		if err != nil || !other.GetBool("active") {
			return e.BadRequestError("Diese Person ist nicht verfügbar.", nil)
		}
		if other.GetString("public_enc_key") == "" {
			return e.BadRequestError("Diese Person hat LexiChat noch nicht eingerichtet und kann noch keine Nachrichten empfangen.", nil)
		}

		key := memberKey(members)
		if existing, err := e.App.FindFirstRecordByData(ColChats, "member_key", key); err == nil {
			return router.NewApiError(http.StatusConflict, "Dieser Chat existiert bereits.", map[string]any{"chatId": existing.Id})
		}

		e.Record.Set("type", ChatTypeDirect)
		e.Record.Set("members", members)
		e.Record.Set("member_key", key)
		e.Record.Set("last_message_at", "")
		return e.Next()
	})
}

// findOrCreateDirectChat is used by the broadcast endpoint (server side chat creation).
func findOrCreateDirectChat(app core.App, a, b string) (*core.Record, error) {
	key := memberKey([]string{a, b})
	if chat, err := app.FindFirstRecordByData(ColChats, "member_key", key); err == nil {
		return chat, nil
	}
	col, err := app.FindCachedCollectionByNameOrId(ColChats)
	if err != nil {
		return nil, err
	}
	chat := core.NewRecord(col)
	chat.Set("type", ChatTypeDirect)
	chat.Set("members", []string{a, b})
	chat.Set("member_key", key)
	return chat, app.Save(chat)
}

// --- messages ---

// validEnvelopes checks that there is exactly one sealed key per chat member.
func validEnvelopes(raw any, members []string) bool {
	var data []byte
	switch v := raw.(type) {
	case types.JSONRaw:
		data = v
	case []byte:
		data = v
	default:
		var err error
		if data, err = json.Marshal(v); err != nil {
			return false
		}
	}
	if len(data) == 0 || len(data) > MaxEnvelopesSize {
		return false
	}

	var env map[string]string
	if err := json.Unmarshal(data, &env); err != nil || len(env) != len(members) {
		return false
	}
	for _, m := range members {
		sealed, ok := env[m]
		if !ok || len(sealed) > 256 {
			return false
		}
		b, err := base64.StdEncoding.DecodeString(sealed)
		// crypto_box_seal(32 byte key) = 32 (ephemeral pk) + 16 (mac) + 32
		if err != nil || len(b) != 80 {
			return false
		}
	}
	return true
}

func validNonce(s string) bool {
	b, err := base64.StdEncoding.DecodeString(s)
	return err == nil && len(b) == 24
}

func validSignature(s string) bool {
	b, err := base64.StdEncoding.DecodeString(s)
	return err == nil && len(b) == 64
}

func (s *Server) validateMessageCrypto(e *core.RecordRequestEvent, chat *core.Record) error {
	if e.Record.GetInt("v") != 1 {
		return e.BadRequestError("Nicht unterstützte Nachrichtenversion.", nil)
	}
	if !validNonce(e.Record.GetString("nonce")) || !validSignature(e.Record.GetString("signature")) {
		return e.BadRequestError("Ungültige Verschlüsselungsdaten.", nil)
	}
	if !validEnvelopes(e.Record.Get("envelopes"), chat.GetStringSlice("members")) {
		return e.BadRequestError("Ungültige Schlüsselumschläge: Es wird genau ein Umschlag pro Chat-Mitglied benötigt.", nil)
	}
	return nil
}

func (s *Server) registerMessageHooks(app core.App) {
	app.OnRecordCreateRequest(ColMessages).BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if err := checkBodyFields(e.RequestEvent, []string{"chat", "sender", "v", "ciphertext", "nonce", "envelopes", "signature", "reply_to"}); err != nil {
			return err
		}

		chat, err := e.App.FindRecordById(ColChats, e.Record.GetString("chat"))
		if err != nil || !slices.Contains(chat.GetStringSlice("members"), e.Auth.Id) {
			return e.ForbiddenError("", nil)
		}

		for _, m := range chat.GetStringSlice("members") {
			if m == e.Auth.Id {
				continue
			}
			other, err := e.App.FindRecordById(ColUsers, m)
			if err != nil || !other.GetBool("active") {
				return e.BadRequestError("Diese Person ist deaktiviert und kann keine Nachrichten empfangen.", nil)
			}
		}

		if err := s.validateMessageCrypto(e, chat); err != nil {
			return err
		}

		if replyTo := e.Record.GetString("reply_to"); replyTo != "" {
			orig, err := e.App.FindRecordById(ColMessages, replyTo)
			if err != nil || orig.GetString("chat") != chat.Id {
				return e.BadRequestError("Die Antwort bezieht sich auf eine unbekannte Nachricht.", nil)
			}
		}

		gs := loadGlobalSettings(e.App)
		e.Record.Set("sender", e.Auth.Id)
		e.Record.Set("is_broadcast", false)
		e.Record.Set("broadcast", "")
		e.Record.Set("edited_at", "")
		e.Record.Set("expires_at", types.NowDateTime().Add(time.Duration(gs.MessageRetentionDays)*24*time.Hour))
		return e.Next()
	})

	app.OnRecordUpdateRequest(ColMessages).BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if err := checkBodyFields(e.RequestEvent, []string{"ciphertext", "nonce", "envelopes", "signature"}); err != nil {
			return err
		}
		if e.Record.Original().GetBool("is_broadcast") {
			return e.BadRequestError("Broadcasts können nicht bearbeitet werden.", nil)
		}
		chat, err := e.App.FindRecordById(ColChats, e.Record.GetString("chat"))
		if err != nil {
			return e.ForbiddenError("", nil)
		}
		if err := s.validateMessageCrypto(e, chat); err != nil {
			return err
		}
		e.Record.Set("edited_at", types.NowDateTime())
		return e.Next()
	})

	// keep the chat list order up to date
	app.OnRecordAfterCreateSuccess(ColMessages).BindFunc(func(e *core.RecordEvent) error {
		chat, err := e.App.FindRecordById(ColChats, e.Record.GetString("chat"))
		if err == nil {
			chat.Set("last_message_at", e.Record.GetDateTime("created"))
			if err := e.App.Save(chat); err != nil {
				e.App.Logger().Warn("failed to update chat last_message_at", "error", err)
			}
		}
		return e.Next()
	})
}

// --- receipts ---

func (s *Server) registerReceiptHooks(app core.App) {
	app.OnRecordCreateRequest(ColReceipts).BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if err := checkBodyFields(e.RequestEvent, []string{"message", "user", "delivered_at", "read_at"}); err != nil {
			return err
		}
		msg, err := e.App.FindRecordById(ColMessages, e.Record.GetString("message"))
		if err != nil {
			return e.BadRequestError("Unbekannte Nachricht.", nil)
		}
		chat, err := e.App.FindRecordById(ColChats, msg.GetString("chat"))
		if err != nil || !slices.Contains(chat.GetStringSlice("members"), e.Auth.Id) || msg.GetString("sender") == e.Auth.Id {
			return e.ForbiddenError("", nil)
		}

		readRequested := !e.Record.GetDateTime("read_at").IsZero()
		nowDt := types.NowDateTime()
		e.Record.Set("user", e.Auth.Id)
		e.Record.Set("delivered_at", nowDt)
		if readRequested {
			e.Record.Set("read_at", nowDt)
		} else {
			e.Record.Set("read_at", "")
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest(ColReceipts).BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if err := checkBodyFields(e.RequestEvent, []string{"read_at"}); err != nil {
			return err
		}
		orig := e.Record.Original()
		if !orig.GetDateTime("read_at").IsZero() || e.Record.GetDateTime("read_at").IsZero() {
			// read state can only be set once and never removed
			return e.BadRequestError("Der Lesestatus kann nicht geändert werden.", nil)
		}
		e.Record.Set("read_at", types.NowDateTime())
		return e.Next()
	})
}
