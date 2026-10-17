package lexichat

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
	"github.com/pocketbase/pocketbase/tools/types"
)

func broadcastBody(t *testing.T, c *client, recipients []map[string]any, stamp string) map[string]any {
	t.Helper()
	msgs := []map[string]any{}
	for _, r := range recipients {
		id := r["id"].(string)
		m := validMessage("", c.user.Id, c.user.Id, id)
		delete(m, "chat")
		delete(m, "sender")
		m["recipient"] = id
		msgs = append(msgs, m)
	}
	return map[string]any{"stamp": stamp, "messages": msgs}
}

func recipientsOf(res response) []map[string]any {
	raw, _ := res.Body["recipients"].([]any)
	out := []map[string]any{}
	for _, r := range raw {
		out = append(out, r.(map[string]any))
	}
	return out
}

func TestBroadcastFlow(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	env.createUser("carol", RoleUser)
	inactive := env.createUser("dora", RoleUser)
	inactive.Set("active", false)
	if err := env.app.Save(inactive); err != nil {
		t.Fatal(err)
	}
	nokeys := env.createUser("emil", RoleUser)
	nokeys.Set("public_enc_key", "")
	if err := env.app.Save(nokeys); err != nil {
		t.Fatal(err)
	}
	a, b := env.login(alice), env.login(bob)

	res := a.do("GET", "/api/lexichat/broadcasts/recipients", nil)
	if res.Status != 200 {
		t.Fatalf("recipients: %d %s", res.Status, res.Raw)
	}
	recips := recipientsOf(res)
	if len(recips) != 2 || res.Body["withoutKeys"].(float64) != 1 {
		t.Fatalf("expected bob+carol (1 without keys): %s", res.Raw)
	}
	if strings.Contains(res.Raw, "wrapped") || strings.Contains(res.Raw, "kdf") {
		t.Fatal("recipients must only expose public data")
	}
	stamp := res.str("stamp")

	// leaving someone out is rejected
	partial := broadcastBody(t, a, recips[:1], stamp)
	if r := a.do("POST", "/api/lexichat/broadcasts", partial); r.Status != 409 {
		t.Fatalf("incomplete recipient set must be rejected: %d", r.Status)
	}
	// adding an outsider (inactive user) is rejected
	extra := broadcastBody(t, a, append(recips, map[string]any{"id": inactive.Id}), stamp)
	if r := a.do("POST", "/api/lexichat/broadcasts", extra); r.Status != 409 {
		t.Fatalf("extra recipient must be rejected: %d", r.Status)
	}
	// wrong stamp
	if r := a.do("POST", "/api/lexichat/broadcasts", broadcastBody(t, a, recips, "x")); r.Status != 409 {
		t.Fatalf("stale stamp must be rejected: %d", r.Status)
	}
	// envelope for a third person
	bad := broadcastBody(t, a, recips, stamp)
	msgs := bad["messages"].([]map[string]any)
	msgs[0]["envelopes"] = map[string]string{alice.Id: randomB64(80), inactive.Id: randomB64(80)}
	if r := a.do("POST", "/api/lexichat/broadcasts", bad); r.Status != 400 {
		t.Fatalf("wrong envelopes must be rejected: %d", r.Status)
	}

	res = a.do("POST", "/api/lexichat/broadcasts", broadcastBody(t, a, recips, stamp))
	if res.Status != 200 {
		t.Fatalf("broadcast: %d %s", res.Status, res.Raw)
	}
	bid := res.str("id")

	// every recipient got the message in a (new) 1:1 chat with the sender
	list := b.do("GET", "/api/collections/messages/records?filter="+urlq(`is_broadcast = true`), nil)
	if len(list.items()) != 1 || list.items()[0]["broadcast"] != bid {
		t.Fatalf("bob must see the broadcast: %s", list.Raw)
	}
	if n, _ := env.app.CountRecords(ColChats); n != 2 {
		t.Fatalf("chats must be created on demand, got %d", n)
	}
	// recipients can only reply privately: the reply is a normal 1:1 message
	chatId := list.items()[0]["chat"].(string)
	if r := b.do("POST", "/api/collections/messages/records", validMessage(chatId, bob.Id, alice.Id, bob.Id)); r.Status != 200 {
		t.Fatalf("private reply: %d %s", r.Status, r.Raw)
	}
	// broadcast messages cannot be edited
	if r := a.do("PATCH", "/api/collections/messages/records/"+list.items()[0]["id"].(string), map[string]any{"nonce": randomB64(24)}); r.Status == 200 {
		t.Fatal("broadcasts must not be editable")
	}

	// delivery status
	b.do("POST", "/api/collections/receipts/records", map[string]any{"message": list.items()[0]["id"], "user": bob.Id, "read_at": "2026-01-01 00:00:00.000Z"})
	st := a.do("GET", "/api/lexichat/broadcasts/"+bid+"/status", nil)
	if st.Status != 200 || st.Body["recipients"].(float64) != 2 || st.Body["delivered"].(float64) != 1 || st.Body["read"].(float64) != 1 {
		t.Fatalf("status: %s", st.Raw)
	}
	if r := b.do("GET", "/api/lexichat/broadcasts/"+bid+"/status", nil); r.Status != 404 {
		t.Fatal("only the sender may see the status")
	}
	if env.auditCount(AuditBroadcastSent) != 1 {
		t.Fatal("broadcast must be audited (without content)")
	}
}

func TestBroadcastPermissionAndRateLimit(t *testing.T) {
	env := newTestEnv(t)
	env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	env.createUser("bob", RoleUser)
	a := env.login(alice)

	st, _ := env.app.FindRecordById(ColSettings, SettingsRecordId)
	st.Set("broadcast_permission", "admins")
	if err := env.app.Save(st); err != nil {
		t.Fatal(err)
	}
	if r := a.do("GET", "/api/lexichat/broadcasts/recipients", nil); r.Status != 403 {
		t.Fatalf("users must not broadcast when restricted: %d", r.Status)
	}

	st.Set("broadcast_permission", "all")
	st.Set("broadcasts_per_hour", 1)
	if err := env.app.Save(st); err != nil {
		t.Fatal(err)
	}
	res := a.do("GET", "/api/lexichat/broadcasts/recipients", nil)
	if r := a.do("POST", "/api/lexichat/broadcasts", broadcastBody(t, a, recipientsOf(res), res.str("stamp"))); r.Status != 200 {
		t.Fatalf("first broadcast: %d %s", r.Status, r.Raw)
	}
	if r := a.do("POST", "/api/lexichat/broadcasts", broadcastBody(t, a, recipientsOf(res), res.str("stamp"))); r.Status != 403 {
		t.Fatalf("rate limit: %d", r.Status)
	}
}

func TestPrefs(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	a, b := env.login(alice), env.login(bob)

	for _, bad := range []map[string]any{
		{"typing": "yes"},
		{"notificationContent": "everything"},
		{"unknown": true},
	} {
		if r := a.do("POST", "/api/lexichat/me/prefs", bad); r.Status == 200 {
			t.Errorf("invalid prefs accepted: %v", bad)
		}
	}
	if r := a.do("POST", "/api/lexichat/me/prefs", map[string]any{"typing": true, "presence": true, "readReceipts": true, "notificationContent": "sender"}); r.Status != 200 {
		t.Fatalf("valid prefs: %d %s", r.Status, r.Raw)
	}
	// others cannot see or set them
	if r := b.do("GET", "/api/collections/users/records/"+alice.Id, nil); strings.Contains(r.Raw, "prefs") {
		t.Fatal("prefs of others must be hidden")
	}
	if r := a.do("GET", "/api/lexichat/me/prefs", nil); r.Body["typing"] != true || r.Body["notificationContent"] != "sender" {
		t.Fatalf("own prefs: %s", r.Raw)
	}
	// hidden on schema level: no filter oracle for other users
	if r := b.do("GET", "/api/collections/users/records?filter="+urlq(`prefs ~ "typing"`), nil); r.Status == 200 && len(r.items()) > 0 {
		t.Fatal("prefs must not be filterable")
	}
	b.do("PATCH", "/api/collections/users/records/"+bob.Id, map[string]any{"prefs": map[string]any{"typing": true}})
	if userPrefs(env.reload(bob)).Typing {
		t.Fatal("prefs only via the dedicated endpoint")
	}
}

func subscribeFake(env *testEnv, userId string, topics ...string) *subscriptions.DefaultClient {
	u, _ := env.app.FindRecordById(ColUsers, userId)
	c := subscriptions.NewDefaultClient()
	c.Set(apis.RealtimeClientAuthKey, u)
	c.Subscribe(topics...)
	env.app.SubscriptionsBroker().Register(c)
	return c
}

func drained(c *subscriptions.DefaultClient) []subscriptions.Message {
	var out []subscriptions.Message
	for {
		select {
		case m := <-c.Channel():
			out = append(out, m)
		case <-time.After(50 * time.Millisecond):
			return out
		}
	}
}

func TestTypingAndPresenceAreReciprocal(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	a, b := env.login(alice), env.login(bob)
	chatId := a.do("POST", "/api/collections/chats/records", map[string]any{"members": []string{alice.Id, bob.Id}}).str("id")
	bobRT := subscribeFake(env, bob.Id, TopicTyping)

	// default off: nothing is sent
	a.do("POST", "/api/lexichat/typing", map[string]any{"chat": chatId})
	if len(drained(bobRT)) != 0 {
		t.Fatal("typing must be off by default")
	}
	// only alice enabled -> still nothing (reciprocity)
	a.do("POST", "/api/lexichat/me/prefs", map[string]any{"typing": true, "presence": true})
	a.do("POST", "/api/lexichat/typing", map[string]any{"chat": chatId})
	if len(drained(bobRT)) != 0 {
		t.Fatal("typing must only reach people who enabled it as well")
	}
	b.do("POST", "/api/lexichat/me/prefs", map[string]any{"typing": true})
	time.Sleep(2100 * time.Millisecond) // throttle window
	a.do("POST", "/api/lexichat/typing", map[string]any{"chat": chatId})
	msgs := drained(bobRT)
	if len(msgs) != 1 || msgs[0].Name != TopicTyping {
		t.Fatalf("typing event expected, got %v", msgs)
	}
	var data map[string]string
	_ = json.Unmarshal(msgs[0].Data, &data)
	if data["chat"] != chatId || data["user"] != alice.Id {
		t.Fatalf("unexpected payload %v", data)
	}

	// presence: bob does not share -> alice does not see him; bob sees nothing at all
	subscribeFake(env, alice.Id)
	if r := a.do("GET", "/api/lexichat/presence", nil); strings.Contains(r.Raw, bob.Id) {
		t.Fatal("bob does not share his presence")
	}
	if r := b.do("GET", "/api/lexichat/presence", nil); r.Body["enabled"] != false || strings.Contains(r.Raw, alice.Id) {
		t.Fatalf("presence is reciprocal: %s", r.Raw)
	}
	b.do("POST", "/api/lexichat/me/prefs", map[string]any{"typing": true, "presence": true})
	if r := b.do("GET", "/api/lexichat/presence", nil); !strings.Contains(r.Raw, alice.Id) {
		t.Fatalf("both share -> visible: %s", r.Raw)
	}

	// outsiders cannot send typing events into foreign chats
	carol := env.createUser("carol", RoleUser)
	c := env.login(carol)
	c.do("POST", "/api/lexichat/me/prefs", map[string]any{"typing": true})
	if r := c.do("POST", "/api/lexichat/typing", map[string]any{"chat": chatId}); r.Status != 404 {
		t.Fatalf("foreign chat typing: %d", r.Status)
	}
}

func TestDataExport(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	a := env.login(alice)
	chatId := a.do("POST", "/api/collections/chats/records", map[string]any{"members": []string{alice.Id, bob.Id}}).str("id")
	a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id, bob.Id))

	res := a.do("GET", "/api/lexichat/me/export", nil)
	if res.Status != 200 {
		t.Fatalf("export: %d %s", res.Status, res.Raw)
	}
	for _, want := range []string{`"username":"alice"`, `"partner":"bob"`, `"fromMe":true`, "Ende-zu-Ende-verschlüsselt", `"sessions"`} {
		if !strings.Contains(res.Raw, want) {
			t.Errorf("export misses %s", want)
		}
	}
	fresh := env.reload(alice)
	for _, secret := range []string{fresh.GetString("kdf_salt"), `"ct"`, "ciphertext", "tokenKey", testPassword("alice")} {
		if strings.Contains(res.Raw, secret) {
			t.Fatalf("export must not contain %q", secret)
		}
	}

	if r := a.do("GET", "/api/lexichat/admin/users/"+bob.Id+"/export", nil); r.Status != 403 {
		t.Fatal("users must not export others")
	}
	ad := env.login(admin)
	if r := ad.do("GET", "/api/lexichat/admin/users/"+alice.Id+"/export", nil); r.Status != 200 || !strings.Contains(r.Raw, `"username":"alice"`) {
		t.Fatalf("admin export: %d", r.Status)
	}
	if env.auditCount(AuditDataExported) != 2 {
		t.Fatal("exports must be audited")
	}
}

func TestAnonymize(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	a, b, ad := env.login(alice), env.login(bob), env.login(admin)
	chatId := a.do("POST", "/api/collections/chats/records", map[string]any{"members": []string{alice.Id, bob.Id}}).str("id")
	msg := a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id, bob.Id)).str("id")

	if r := a.do("POST", "/api/lexichat/admin/users/"+bob.Id+"/anonymize", nil); r.Status != 403 {
		t.Fatal("users must not anonymize")
	}
	if r := ad.do("POST", "/api/lexichat/admin/users/"+alice.Id+"/anonymize", nil); r.Status != 204 {
		t.Fatalf("anonymize: %d", r.Status)
	}
	u := env.reload(alice)
	if !u.GetBool("anonymized") || u.GetBool("active") || u.GetString("name") != "Ehemaliges Konto" || !strings.HasPrefix(u.GetString("username"), "geloescht-") ||
		u.GetString("kdf_salt") != "" || u.GetString("deactivated_at") == "" {
		t.Fatalf("anonymized state: %v", u.FieldsData())
	}
	// the partner keeps the conversation until the retention period ends
	if _, err := env.app.FindRecordById(ColMessages, msg); err != nil {
		t.Fatal("messages stay for the partner")
	}
	dir := b.do("GET", "/api/lexichat/directory", nil)
	if !strings.Contains(dir.Raw, "Ehemaliges Konto") || strings.Contains(dir.Raw, alice.GetString("public_enc_key")) || strings.Contains(dir.Raw, `"username":"alice"`) {
		t.Fatalf("partner view: %s", dir.Raw)
	}
	if r := a.do("GET", "/api/lexichat/me/keys", nil); r.Status != 401 {
		t.Fatal("sessions must end")
	}
	if r := ad.do("PATCH", "/api/collections/users/records/"+alice.Id, map[string]any{"active": true}); r.Status == 200 {
		t.Fatal("anonymized accounts cannot be reactivated")
	}
}

func TestAutoAnonymizeLongDeactivated(t *testing.T) {
	env := newTestEnv(t)
	env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	for _, u := range []string{alice.Id, bob.Id} {
		r, _ := env.app.FindRecordById(ColUsers, u)
		r.Set("active", false)
		if err := env.app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	if env.reload(alice).GetDateTime("deactivated_at").IsZero() {
		t.Fatal("deactivated_at must be set")
	}
	old, _ := env.app.FindRecordById(ColUsers, alice.Id)
	old.Set("deactivated_at", types.NowDateTime().Add(-200*24*time.Hour))
	if err := env.app.Save(old); err != nil {
		t.Fatal(err)
	}
	res, err := env.srv.RunRetention(env.app)
	if err != nil {
		t.Fatal(err)
	}
	if res.Anonymized != 1 || !env.reload(alice).GetBool("anonymized") || env.reload(bob).GetBool("anonymized") {
		t.Fatalf("only accounts deactivated > 180 days are anonymized: %+v", res)
	}
}

func TestDirectory(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	carol := env.createUser("carol", RoleUser)
	dora := env.createUser("dora", RoleUser)
	a := env.login(alice)
	a.do("POST", "/api/collections/chats/records", map[string]any{"members": []string{alice.Id, bob.Id}})
	for _, u := range []string{bob.Id, carol.Id} {
		r, _ := env.app.FindRecordById(ColUsers, u)
		r.Set("active", false)
		if err := env.app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	res := a.do("GET", "/api/lexichat/directory", nil)
	if res.Status != 200 || !strings.Contains(res.Raw, `"username":"bob"`) || !strings.Contains(res.Raw, `"username":"dora"`) {
		t.Fatalf("directory: %s", res.Raw)
	}
	if strings.Contains(res.Raw, `"username":"carol"`) {
		t.Fatal("deactivated non-partners must not be listed")
	}
	for _, secret := range []string{"kdf", "wrapped", "role", "totp", dora.GetString("kdf_salt")} {
		if strings.Contains(res.Raw, secret) {
			t.Fatalf("directory leaks %s", secret)
		}
	}
}

func TestNoFilterOracleOnSecurityFields(t *testing.T) {
	env := newTestEnv(t)
	env.createUser("admin", RoleAdmin) // has 2FA
	alice := env.createUser("alice", RoleUser)
	a := env.login(alice)
	for _, filter := range []string{`totp_enabled = true`, `totp_enabled = false`, `deactivated_at != ""`, `kdf_salt != ""`, `failed_logins > 0`} {
		r := a.do("GET", "/api/collections/users/records?filter="+urlq(filter), nil)
		if r.Status == 200 && len(r.items()) > 0 {
			t.Errorf("filter %q must not work for users", filter)
		}
	}
}

func TestUnusedAuthEndpointsAreBlocked(t *testing.T) {
	env := newTestEnv(t)
	env.createUser("alice", RoleUser)
	for _, path := range []string{
		"/api/collections/users/request-password-reset",
		"/api/collections/users/request-otp",
		"/api/collections/users/auth-with-otp",
		"/api/collections/users/auth-with-oauth2",
		"/api/collections/users/request-verification",
		"/api/collections/users/request-email-change",
		"/api/collections/users/impersonate/abc",
	} {
		if r := env.do("POST", path, map[string]any{"email": "x@example.com"}, reqOpts{}); r.Status != 404 {
			t.Errorf("%s must be blocked, got %d", path, r.Status)
		}
	}
}
