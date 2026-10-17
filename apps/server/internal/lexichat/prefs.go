package lexichat

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

// Prefs are the privacy preferences of a person. Privacy by default: all off,
// notifications without content.
type Prefs struct {
	// send read receipts (otherwise only "delivered")
	ReadReceipts bool `json:"readReceipts"`
	// send and receive typing indicators
	Typing bool `json:"typing"`
	// share and see the online status (reciprocal)
	Presence bool `json:"presence"`
	// "none" (default) | "sender" | "full"
	NotificationContent string `json:"notificationContent"`
	// show a message preview in the chat list
	ListPreview bool `json:"listPreview"`
}

const (
	TopicTyping   = "lexichat/typing"
	TopicPresence = "lexichat/presence"
)

func userPrefs(u *core.Record) Prefs {
	var p Prefs
	_ = u.UnmarshalJSONField("prefs", &p)
	if p.NotificationContent == "" {
		p.NotificationContent = "none"
	}
	return p
}

// validPrefs checks the submitted prefs json (only known keys and values).
func validPrefs(raw any) bool {
	b, err := json.Marshal(raw)
	if err != nil || len(b) > 512 {
		return false
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return false
	}
	for k, v := range m {
		switch k {
		case "readReceipts", "typing", "presence", "listPreview":
			if _, ok := v.(bool); !ok {
				return false
			}
		case "notificationContent":
			s, ok := v.(string)
			if !ok || !slices.Contains([]string{"none", "sender", "full"}, s) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

// realtimeUser returns the authenticated users record of a realtime client (or nil).
func realtimeUser(c subscriptions.Client) *core.Record {
	auth, _ := c.Get(apis.RealtimeClientAuthKey).(*core.Record)
	if auth == nil || auth.Collection().Name != ColUsers {
		return nil
	}
	return auth
}

// sendToUser delivers a custom realtime message to all subscribed clients of a user.
func sendToUser(app core.App, userId, topic string, data any) {
	payload, err := json.Marshal(data)
	if err != nil {
		return
	}
	for _, c := range app.SubscriptionsBroker().Clients() {
		if u := realtimeUser(c); u != nil && u.Id == userId && c.HasSubscription(topic) {
			// the client channel is unbuffered: never block the request on a slow client
			go c.Send(subscriptions.Message{Name: topic, Data: payload})
		}
	}
}

// typing indicators: reciprocal (both sides must have enabled them), throttled
type typingLimiter struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func (l *typingLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.last == nil {
		l.last = map[string]time.Time{}
	}
	if t, ok := l.last[key]; ok && time.Since(t) < 2*time.Second {
		return false
	}
	l.last[key] = time.Now()
	if len(l.last) > 10_000 { // bounded memory
		l.last = map[string]time.Time{key: time.Now()}
	}
	return true
}

func (s *Server) handleTyping(e *core.RequestEvent) error {
	var body struct {
		Chat string `json:"chat"`
	}
	if err := e.BindBody(&body); err != nil || body.Chat == "" {
		return e.BadRequestError("Ungültige Anfrage.", nil)
	}
	me, err := e.App.FindRecordById(ColUsers, e.Auth.Id)
	if err != nil || !userPrefs(me).Typing {
		return e.NoContent(http.StatusNoContent) // silently ignored when disabled
	}
	chat, err := e.App.FindRecordById(ColChats, body.Chat)
	if err != nil || !slices.Contains(chat.GetStringSlice("members"), me.Id) {
		return e.NotFoundError("", nil)
	}
	if !s.typing.allow(me.Id + ":" + chat.Id) {
		return e.NoContent(http.StatusNoContent)
	}
	for _, m := range chat.GetStringSlice("members") {
		if m == me.Id {
			continue
		}
		other, err := e.App.FindRecordById(ColUsers, m)
		if err != nil || !userPrefs(other).Typing {
			continue
		}
		sendToUser(e.App, m, TopicTyping, map[string]string{"chat": chat.Id, "user": me.Id})
	}
	return e.NoContent(http.StatusNoContent)
}

// handlePresence returns the ids of online users that share their status - only
// for people who share their own status as well (reciprocity).
func (s *Server) handlePresence(e *core.RequestEvent) error {
	me, err := e.App.FindRecordById(ColUsers, e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", nil)
	}
	if !userPrefs(me).Presence {
		return e.JSON(http.StatusOK, map[string]any{"enabled": false, "online": []string{}})
	}
	seen := map[string]bool{}
	online := []string{}
	for _, c := range e.App.SubscriptionsBroker().Clients() {
		u := realtimeUser(c)
		if u == nil || u.Id == me.Id || seen[u.Id] {
			continue
		}
		seen[u.Id] = true
		fresh, err := e.App.FindRecordById(ColUsers, u.Id)
		if err == nil && fresh.GetBool("active") && userPrefs(fresh).Presence {
			online = append(online, u.Id)
		}
	}
	slices.Sort(online)
	return e.JSON(http.StatusOK, map[string]any{"enabled": true, "online": online})
}

// DirectoryEntry is the minimal, public information about a colleague.
type DirectoryEntry struct {
	Id            string `json:"id"`
	Username      string `json:"username"`
	Name          string `json:"name"`
	Avatar        string `json:"avatar"`
	Active        bool   `json:"active"`
	Anonymized    bool   `json:"anonymized"`
	PublicEncKey  string `json:"publicEncKey"`
	PublicSignKey string `json:"publicSignKey"`
	KeyVersion    int    `json:"keyVersion"`
	KeysUpdated   string `json:"keysUpdated"`
}

// handleDirectory returns all active colleagues plus the (possibly deactivated or
// anonymised) partners of the own chats - nothing else (data minimisation).
func (s *Server) handleDirectory(e *core.RequestEvent) error {
	users, err := e.App.FindAllRecords(ColUsers, dbx.HashExp{"active": true})
	if err != nil {
		return e.InternalServerError("", err)
	}
	byId := map[string]*core.Record{}
	for _, u := range users {
		byId[u.Id] = u
	}
	chats, err := e.App.FindRecordsByFilter(ColChats, "members.id ?= {:id}", "", 0, 0, dbx.Params{"id": e.Auth.Id})
	if err != nil {
		return e.InternalServerError("", err)
	}
	for _, c := range chats {
		for _, m := range c.GetStringSlice("members") {
			if _, ok := byId[m]; !ok {
				if u, err := e.App.FindRecordById(ColUsers, m); err == nil {
					byId[m] = u
				}
			}
		}
	}
	out := make([]DirectoryEntry, 0, len(byId))
	for _, u := range byId {
		entry := DirectoryEntry{Id: u.Id, Username: u.GetString("username"), Name: u.GetString("name"), Active: u.GetBool("active"), Anonymized: u.GetBool("anonymized")}
		if u.GetBool("active") {
			entry.Avatar = u.GetString("avatar")
			entry.PublicEncKey = u.GetString("public_enc_key")
			entry.PublicSignKey = u.GetString("public_sign_key")
			entry.KeyVersion = u.GetInt("key_version")
			entry.KeysUpdated = u.GetDateTime("keys_updated").String()
		} else if !u.GetBool("anonymized") {
			// keys are still needed to verify signatures of old messages
			entry.PublicSignKey = u.GetString("public_sign_key")
			entry.KeyVersion = u.GetInt("key_version")
		}
		out = append(out, entry)
	}
	slices.SortFunc(out, func(a, b DirectoryEntry) int {
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return e.JSON(http.StatusOK, map[string]any{"users": out})
}
