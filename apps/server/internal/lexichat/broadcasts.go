package lexichat

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Broadcasts: the server determines the recipients (all active users with keys,
// except the sender). Because of E2EE the client encrypts the message for every
// recipient; the "stamp" proves that the client encrypted for exactly the
// current recipient set (no one left out, no one added).

const maxBroadcastRecipients = 500

type broadcastRecipient struct {
	Id            string `json:"id"`
	Name          string `json:"name"`
	PublicEncKey  string `json:"publicEncKey"`
	PublicSignKey string `json:"publicSignKey"`
	KeyVersion    int    `json:"keyVersion"`
}

func (s *Server) broadcastRecipients(app core.App, senderId string) ([]broadcastRecipient, int, string, error) {
	users, err := app.FindAllRecords(ColUsers, dbx.HashExp{"active": true}, dbx.Not(dbx.HashExp{"id": senderId}))
	if err != nil {
		return nil, 0, "", err
	}
	var out []broadcastRecipient
	withoutKeys := 0
	for _, u := range users {
		if u.GetString("public_enc_key") == "" {
			withoutKeys++
			continue
		}
		out = append(out, broadcastRecipient{
			Id:            u.Id,
			Name:          u.GetString("name"),
			PublicEncKey:  u.GetString("public_enc_key"),
			PublicSignKey: u.GetString("public_sign_key"),
			KeyVersion:    u.GetInt("key_version"),
		})
	}
	slices.SortFunc(out, func(a, b broadcastRecipient) int { return strings.Compare(a.Id, b.Id) })

	h := sha256.New()
	for _, r := range out {
		fmt.Fprintf(h, "%s:%d:%s\n", r.Id, r.KeyVersion, r.PublicEncKey)
	}
	return out, withoutKeys, hex.EncodeToString(h.Sum(nil)), nil
}

func (s *Server) mayBroadcast(app core.App, user *core.Record) error {
	gs := loadGlobalSettings(app)
	if gs.BroadcastPermission == "admins" && user.GetString("role") != RoleAdmin {
		return fmt.Errorf("Broadcasts dürfen in dieser Praxis nur Administrator:innen senden.")
	}
	since := types.NowDateTime().Add(-time.Hour).String()
	n, err := app.CountRecords(ColBroadcasts, dbx.HashExp{"sender": user.Id}, dbx.NewExp("[[created]] > {:since}", dbx.Params{"since": since}))
	if err != nil {
		return err
	}
	if int(n) >= gs.BroadcastsPerHour {
		return fmt.Errorf("Sie haben das Limit von %d Broadcasts pro Stunde erreicht.", gs.BroadcastsPerHour)
	}
	return nil
}

func (s *Server) handleBroadcastRecipients(e *core.RequestEvent) error {
	if err := s.mayBroadcast(e.App, e.Auth); err != nil {
		return e.ForbiddenError(err.Error(), nil)
	}
	recipients, withoutKeys, stamp, err := s.broadcastRecipients(e.App, e.Auth.Id)
	if err != nil {
		return e.InternalServerError("", err)
	}
	if recipients == nil {
		recipients = []broadcastRecipient{}
	}
	return e.JSON(http.StatusOK, map[string]any{"recipients": recipients, "withoutKeys": withoutKeys, "stamp": stamp})
}

type broadcastMessage struct {
	Recipient  string          `json:"recipient"`
	V          int             `json:"v"`
	Ciphertext string          `json:"ciphertext"`
	Nonce      string          `json:"nonce"`
	Envelopes  json.RawMessage `json:"envelopes"`
	Signature  string          `json:"signature"`
}

type broadcastForm struct {
	Stamp    string             `json:"stamp"`
	Messages []broadcastMessage `json:"messages"`
}

func (s *Server) handleBroadcastSend(e *core.RequestEvent) error {
	var form broadcastForm
	if err := e.BindBody(&form); err != nil {
		return e.BadRequestError("Ungültige Anfrage.", nil)
	}
	if err := s.mayBroadcast(e.App, e.Auth); err != nil {
		return e.ForbiddenError(err.Error(), nil)
	}
	if len(form.Messages) == 0 || len(form.Messages) > maxBroadcastRecipients {
		return e.BadRequestError("Ungültige Anzahl an Empfänger:innen.", nil)
	}

	recipients, _, stamp, err := s.broadcastRecipients(e.App, e.Auth.Id)
	if err != nil {
		return e.InternalServerError("", err)
	}
	// the recipient set must be exactly the current one (server side truth)
	submitted := make([]string, 0, len(form.Messages))
	for _, m := range form.Messages {
		submitted = append(submitted, m.Recipient)
	}
	slices.Sort(submitted)
	expected := make([]string, 0, len(recipients))
	for _, r := range recipients {
		expected = append(expected, r.Id)
	}
	if form.Stamp != stamp || !slices.Equal(submitted, expected) {
		return e.Error(http.StatusConflict, "Die Empfängerliste hat sich geändert. Bitte erneut senden.", nil)
	}

	for _, m := range form.Messages {
		if m.V != 1 || !validNonce(m.Nonce) || !validSignature(m.Signature) || len(m.Ciphertext) == 0 || len(m.Ciphertext) > MaxCiphertextLen {
			return e.BadRequestError("Ungültige Verschlüsselungsdaten.", nil)
		}
		if !validEnvelopes(json.RawMessage(m.Envelopes), []string{e.Auth.Id, m.Recipient}) {
			return e.BadRequestError("Ungültige Schlüsselumschläge.", nil)
		}
	}

	gs := loadGlobalSettings(e.App)
	expires := types.NowDateTime().Add(time.Duration(gs.MessageRetentionDays) * 24 * time.Hour)
	var broadcastId string

	err = e.App.RunInTransaction(func(txApp core.App) error {
		bcol, err := txApp.FindCachedCollectionByNameOrId(ColBroadcasts)
		if err != nil {
			return err
		}
		b := core.NewRecord(bcol)
		b.Set("sender", e.Auth.Id)
		b.Set("recipient_count", len(form.Messages))
		b.Set("expires_at", expires)
		if err := txApp.Save(b); err != nil {
			return err
		}
		broadcastId = b.Id

		mcol, err := txApp.FindCachedCollectionByNameOrId(ColMessages)
		if err != nil {
			return err
		}
		for _, m := range form.Messages {
			chat, err := findOrCreateDirectChat(txApp, e.Auth.Id, m.Recipient)
			if err != nil {
				return err
			}
			msg := core.NewRecord(mcol)
			msg.Set("chat", chat.Id)
			msg.Set("sender", e.Auth.Id)
			msg.Set("v", m.V)
			msg.Set("ciphertext", m.Ciphertext)
			msg.Set("nonce", m.Nonce)
			msg.Set("envelopes", m.Envelopes)
			msg.Set("signature", m.Signature)
			msg.Set("is_broadcast", true)
			msg.Set("broadcast", b.Id)
			msg.Set("expires_at", expires)
			if err := txApp.Save(msg); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return e.BadRequestError("Der Broadcast konnte nicht gesendet werden.", err)
	}

	s.Audit(e.App, AuditEntry{Action: AuditBroadcastSent, Actor: e.Auth, TargetType: ColBroadcasts, TargetId: broadcastId, Details: map[string]any{"recipients": len(form.Messages)}, IP: e.RealIP()})
	return e.JSON(http.StatusOK, map[string]any{"id": broadcastId, "recipients": len(form.Messages)})
}

// handleBroadcastStatus returns delivered/read counts of an own broadcast.
func (s *Server) handleBroadcastStatus(e *core.RequestEvent) error {
	b, err := e.App.FindRecordById(ColBroadcasts, e.Request.PathValue("id"))
	if err != nil || b.GetString("sender") != e.Auth.Id {
		return e.NotFoundError("", nil)
	}
	var row struct {
		Delivered int `db:"delivered"`
		Read      int `db:"read"`
	}
	err = e.App.DB().NewQuery(`
		SELECT COUNT(r.id) AS delivered,
		       COALESCE(SUM(CASE WHEN r.read_at != '' THEN 1 ELSE 0 END), 0) AS read
		FROM {{receipts}} r JOIN {{messages}} m ON m.id = r.message
		WHERE m.broadcast = {:b}`).Bind(dbx.Params{"b": b.Id}).One(&row)
	if err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]any{
		"id":         b.Id,
		"recipients": b.GetInt("recipient_count"),
		"delivered":  row.Delivered,
		"read":       row.Read,
		"created":    b.GetDateTime("created"),
	})
}
