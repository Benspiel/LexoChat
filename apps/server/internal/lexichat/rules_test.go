package lexichat

import (
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/subscriptions"
	"github.com/pocketbase/pocketbase/tools/types"
)

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

func TestUsersListAndPrivacy(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	env.createUser("bob", RoleUser)
	inactive := env.createUser("carol", RoleUser)
	inactive.Set("active", false)
	if err := env.app.Save(inactive); err != nil {
		t.Fatal(err)
	}

	// guests see nothing
	res := env.do("GET", "/api/collections/users/records", nil, reqOpts{})
	if res.Status != 200 || len(res.items()) != 0 {
		t.Fatalf("guest list: %d %s", res.Status, res.Raw)
	}

	c := env.login(alice)
	res = c.do("GET", "/api/collections/users/records", nil)
	if res.Status != 200 {
		t.Fatalf("list: %d %s", res.Status, res.Raw)
	}
	if n := len(res.items()); n != 2 {
		t.Fatalf("expected 2 active users, got %d", n)
	}
	for _, field := range []string{"wrapped_private_keys", "recovery_wrapped_keys", "kdf_salt", "failed_logins", "locked_until", "password", "tokenKey"} {
		if strings.Contains(res.Raw, `"`+field+`"`) {
			t.Errorf("field %s must not be exposed: %s", field, res.Raw)
		}
	}
	for _, it := range res.items() {
		if it["id"] != alice.Id {
			if _, ok := it["role"]; ok {
				t.Errorf("role of other users must be hidden")
			}
			if _, ok := it["public_enc_key"]; !ok {
				t.Errorf("public key must be visible")
			}
		}
	}

	// hidden fields cannot be used as filter oracle
	res = c.do("GET", "/api/collections/users/records?filter="+urlq(`kdf_salt != ""`), nil)
	if res.Status == 200 && len(res.items()) > 0 {
		t.Fatalf("hidden field filter must not match: %s", res.Raw)
	}
	res = c.do("GET", "/api/collections/users/records?filter="+urlq(`wrapped_private_keys ~ "ct"`), nil)
	if res.Status == 200 && len(res.items()) > 0 {
		t.Fatalf("hidden field filter must not match: %s", res.Raw)
	}
}

func TestUsersCannotEscalatePrivileges(t *testing.T) {
	env := newTestEnv(t)
	env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	c := env.login(alice)

	// explicitly rejected
	attempts := []map[string]any{
		{"role": "admin"},
		{"active": false},
		{"username": "root"},
		{"must_change_password": true},
		{"public_enc_key": randomB64(32)},
		{"public_sign_key": randomB64(32)},
		{"key_version": 5},
		{"password": testPassword("x"), "passwordConfirm": testPassword("x"), "oldPassword": testPassword("alice")},
		{"verified": true},
		{"email": "x@example.com"},
	}
	for _, body := range attempts {
		res := c.do("PATCH", "/api/collections/users/records/"+alice.Id, body)
		if is2xx(res.Status) {
			t.Errorf("self update %v must fail, got %d", body, res.Status)
		}
	}
	// hidden/system fields are silently dropped by PocketBase - they must stay unchanged
	for _, body := range []map[string]any{
		{"wrapped_private_keys": map[string]any{"x": 1}},
		{"kdf_salt": "AAAA"},
		{"failed_logins": 99},
		{"tokenKey": "abc"},
	} {
		c.do("PATCH", "/api/collections/users/records/"+alice.Id, body)
	}
	fresh := env.reload(alice)
	if fresh.GetString("role") != RoleUser || !fresh.GetBool("active") || fresh.GetString("username") != "alice" ||
		fresh.GetString("public_enc_key") != alice.GetString("public_enc_key") ||
		fresh.GetString("kdf_salt") != alice.GetString("kdf_salt") ||
		fresh.GetString("wrapped_private_keys") != alice.GetString("wrapped_private_keys") ||
		fresh.GetInt("failed_logins") != 0 || fresh.TokenKey() != alice.TokenKey() || fresh.Email() != "" {
		t.Fatalf("protected fields changed: %v", fresh.FieldsData())
	}
	if !fresh.ValidatePassword(testPassword("alice")) {
		t.Fatal("password changed via record api")
	}

	// own display name is allowed
	res := c.do("PATCH", "/api/collections/users/records/"+alice.Id, map[string]any{"name": "Alice A."})
	if res.Status != 200 {
		t.Fatalf("name change: %d %s", res.Status, res.Raw)
	}

	// other users are not editable
	res = c.do("PATCH", "/api/collections/users/records/"+bob.Id, map[string]any{"name": "Hacked"})
	if is2xx(res.Status) || env.reload(bob).GetString("name") == "Hacked" {
		t.Fatalf("foreign update must fail: %d", res.Status)
	}

	// no account creation, neither via record api nor via admin endpoint
	res = c.do("POST", "/api/collections/users/records", map[string]any{
		"username": "mallory", "name": "M", "role": "admin", "active": true,
		"password": testPassword("m"), "passwordConfirm": testPassword("m"),
	})
	if is2xx(res.Status) {
		t.Fatalf("record api create must fail: %d", res.Status)
	}
	res = c.do("POST", "/api/lexichat/admin/users", map[string]any{"username": "mallory", "name": "M", "role": "admin"})
	if res.Status != 403 {
		t.Fatalf("admin endpoint must be forbidden for users: %d", res.Status)
	}
	res = c.do("POST", "/api/lexichat/admin/users/"+bob.Id+"/reset-password", nil)
	if res.Status != 403 {
		t.Fatalf("reset endpoint must be forbidden for users: %d", res.Status)
	}

	// no deletion
	res = c.do("DELETE", "/api/collections/users/records/"+bob.Id, nil)
	if is2xx(res.Status) {
		t.Fatalf("user delete must fail: %d", res.Status)
	}

	// public registration is closed for guests as well
	res = env.do("POST", "/api/collections/users/records", map[string]any{
		"username": "guest", "name": "G", "password": testPassword("g"), "passwordConfirm": testPassword("g"),
	}, reqOpts{})
	if is2xx(res.Status) {
		t.Fatalf("guest registration must fail: %d", res.Status)
	}
}

func TestAdminUserManagement(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	a := env.login(admin)

	// create
	res := a.do("POST", "/api/lexichat/admin/users", map[string]any{"username": "Dr.Mueller", "name": "Dr. Müller", "role": "user"})
	if res.Status != 201 || res.str("oneTimePassword") == "" {
		t.Fatalf("create: %d %s", res.Status, res.Raw)
	}
	created, err := env.app.FindRecordById(ColUsers, res.str("id"))
	if err != nil {
		t.Fatal(err)
	}
	if created.GetString("username") != "dr.mueller" || !created.GetBool("must_change_password") || created.GetString("role") != RoleUser {
		t.Fatalf("unexpected created user: %v", created.FieldsData())
	}
	if env.auditCount(AuditUserCreated) != 1 {
		t.Fatal("missing audit entry for user creation")
	}

	// duplicate username
	res = a.do("POST", "/api/lexichat/admin/users", map[string]any{"username": "alice", "name": "X", "role": "user"})
	if res.Status != 400 {
		t.Fatalf("duplicate username: %d", res.Status)
	}

	// rename + role change of another user is allowed
	res = a.do("PATCH", "/api/collections/users/records/"+alice.Id, map[string]any{"name": "Alice B", "role": "admin"})
	if res.Status != 200 {
		t.Fatalf("admin update: %d %s", res.Status, res.Raw)
	}
	if env.auditCount(AuditUserRoleChanged) != 1 {
		t.Fatal("missing audit entry for role change")
	}

	// admins cannot touch key material or passwords via the record api
	res = a.do("PATCH", "/api/collections/users/records/"+alice.Id, map[string]any{"public_enc_key": randomB64(32)})
	if is2xx(res.Status) {
		t.Fatal("admin must not be able to replace public keys (MITM)")
	}

	// no self demotion / deactivation / deletion
	for _, body := range []map[string]any{{"role": "user"}, {"active": false}} {
		res = a.do("PATCH", "/api/collections/users/records/"+admin.Id, body)
		if is2xx(res.Status) {
			t.Fatalf("self change %v must fail", body)
		}
	}
	res = a.do("DELETE", "/api/collections/users/records/"+admin.Id, nil)
	if is2xx(res.Status) {
		t.Fatal("self delete must fail")
	}
}

func TestLastAdminInvariant(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)

	admin.Set("role", RoleUser)
	if err := env.app.Save(admin); err == nil {
		t.Fatal("demoting the last admin must fail (model level)")
	}
	admin = env.reload(admin)
	if err := env.app.Delete(admin); err == nil {
		t.Fatal("deleting the last admin must fail (model level)")
	}

	second := env.createUser("admin2", RoleAdmin)
	second.Set("role", RoleUser)
	if err := env.app.Save(second); err != nil {
		t.Fatalf("demoting a non-last admin must work: %v", err)
	}
}

func TestDeactivationInvalidatesSessionsImmediately(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	a := env.login(admin)
	c := env.login(alice)

	if res := c.do("GET", "/api/collections/users/records", nil); res.Status != 200 {
		t.Fatalf("precondition: %d", res.Status)
	}

	res := a.do("PATCH", "/api/collections/users/records/"+alice.Id, map[string]any{"active": false})
	if res.Status != 200 {
		t.Fatalf("deactivate: %d %s", res.Status, res.Raw)
	}

	if res := c.do("GET", "/api/lexichat/me/keys", nil); res.Status != 401 {
		t.Fatalf("token of deactivated user must be invalid: %d %s", res.Status, res.Raw)
	}
	if res := c.do("POST", "/api/collections/users/auth-refresh", nil); res.Status == 200 {
		t.Fatal("refresh must fail after deactivation")
	}
	if n, _ := env.app.CountRecords(ColSessions); n != 1 { // only the admin session remains
		t.Fatalf("sessions of deactivated user must be deleted, %d left", n)
	}
	if res := env.loginWith("alice", testPassword("alice"), ""); res.Status == 200 {
		t.Fatal("deactivated user must not log in")
	}
	if env.auditCount(AuditUserDeactivated) != 1 {
		t.Fatal("missing audit entry")
	}
}

// ---------------------------------------------------------------------------
// auth, sessions, lockout
// ---------------------------------------------------------------------------

func TestLoginRequiresDerivedKeyFormat(t *testing.T) {
	env := newTestEnv(t)
	env.createUser("alice", RoleUser)
	if res := env.loginWith("alice", "plaintext-password", ""); res.Status == 200 {
		t.Fatal("raw passwords must never authenticate")
	}
}

func TestSessionBinding(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	c := env.login(alice)
	b := env.login(bob)

	// token without session header
	res := env.do("GET", "/api/collections/chats/records", nil, reqOpts{token: c.token})
	if res.Status != 401 {
		t.Fatalf("missing session must be rejected: %d", res.Status)
	}
	// token with someone else's session
	res = env.do("GET", "/api/collections/chats/records", nil, reqOpts{token: c.token, session: b.session})
	if res.Status != 401 {
		t.Fatalf("foreign session must be rejected: %d", res.Status)
	}

	// users only see their own sessions
	res = c.do("GET", "/api/collections/sessions/records", nil)
	if res.Status != 200 || len(res.items()) != 1 || res.items()[0]["id"] != c.session {
		t.Fatalf("own sessions: %d %s", res.Status, res.Raw)
	}
	res = c.do("DELETE", "/api/collections/sessions/records/"+b.session, nil)
	if is2xx(res.Status) {
		t.Fatal("deleting a foreign session must fail")
	}

	// revoke own session ("Abmelden") -> token is useless afterwards
	res = c.do("DELETE", "/api/collections/sessions/records/"+c.session, nil)
	if res.Status != 204 {
		t.Fatalf("logout: %d %s", res.Status, res.Raw)
	}
	if res := c.do("GET", "/api/collections/chats/records", nil); res.Status != 401 {
		t.Fatalf("revoked session must be rejected: %d", res.Status)
	}
	if res := c.do("POST", "/api/collections/users/auth-refresh", nil); res.Status != 401 {
		t.Fatalf("revoked session must not refresh: %d", res.Status)
	}
}

func TestSessionExpiry(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	admin := env.createUser("admin", RoleAdmin)
	c := env.login(alice)

	// desktop: no idle timeout ("einmal anmelden")
	sess, _ := env.app.FindRecordById(ColSessions, c.session)
	sess.Set("last_seen", types.NowDateTime().Add(-48*time.Hour))
	if err := env.app.Save(sess); err != nil {
		t.Fatal(err)
	}
	if res := c.do("GET", "/api/collections/chats/records", nil); res.Status != 200 {
		t.Fatalf("idle desktop session must stay valid: %d", res.Status)
	}
	// ... and the expiry slides forward with use
	sess, _ = env.app.FindRecordById(ColSessions, c.session)
	if sess.GetDateTime("expires_at").Time().Before(time.Now().Add(desktopSessionLifetime - time.Hour)) {
		t.Fatalf("desktop session expiry must slide: %s", sess.GetDateTime("expires_at"))
	}

	// expired desktop session is rejected
	sess.Set("expires_at", types.NowDateTime().Add(-time.Minute))
	if err := env.app.Save(sess); err != nil {
		t.Fatal(err)
	}
	if res := c.do("GET", "/api/collections/chats/records", nil); res.Status != 401 {
		t.Fatalf("expired session must be rejected: %d", res.Status)
	}

	// admin web keeps the idle timeout
	res := env.loginWith("admin", testPassword("admin"), testAdminOrigin)
	meta, _ := res.Body["meta"].(map[string]any)
	sid, _ := meta["sessionId"].(string)
	if _, has := meta["resumeSecret"]; has {
		t.Fatal("admin web sessions must not get a resume secret")
	}
	as, _ := env.app.FindRecordById(ColSessions, sid)
	as.Set("last_seen", types.NowDateTime().Add(-48*time.Hour))
	if err := env.app.Save(as); err != nil {
		t.Fatal(err)
	}
	ac := &client{env: env, user: admin, token: res.str("token"), session: sid}
	if r := ac.do("GET", "/api/collections/chats/records", nil); r.Status != 401 {
		t.Fatalf("idle admin web session must be rejected: %d", r.Status)
	}
}

func TestResumeSession(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)

	res := env.loginWith("alice", testPassword("alice"), "")
	meta, _ := res.Body["meta"].(map[string]any)
	sid, _ := meta["sessionId"].(string)
	secret, _ := meta["resumeSecret"].(string)
	if sid == "" || len(secret) != 64 {
		t.Fatalf("desktop login must return a resume secret: %s", res.Raw)
	}
	sess, _ := env.app.FindRecordById(ColSessions, sid)
	if sess.GetString("resume_hash") == secret || sess.GetString("resume_hash") == "" {
		t.Fatal("only the hash of the resume secret may be stored")
	}

	resume := func(id, sec string) response {
		return env.do("POST", "/api/lexichat/session/resume", map[string]any{"sessionId": id, "resumeSecret": sec}, reqOpts{})
	}

	r := resume(sid, secret)
	if r.Status != 200 || r.str("token") == "" {
		t.Fatalf("resume failed: %d %s", r.Status, r.Raw)
	}
	if strings.Contains(r.Raw, "resume_hash") || strings.Contains(r.Raw, secret) {
		t.Fatal("resume response must not leak the secret")
	}
	c := &client{env: env, user: alice, token: r.str("token"), session: sid}
	if got := c.do("GET", "/api/collections/chats/records", nil); got.Status != 200 {
		t.Fatalf("resumed token must work: %d", got.Status)
	}

	wrong := strings.Repeat("0", 64)
	if r := resume(sid, wrong); r.Status != 401 {
		t.Fatalf("wrong secret must be rejected: %d", r.Status)
	}
	if r := resume("nosuchsession12", secret); r.Status != 401 {
		t.Fatalf("unknown session must be rejected: %d", r.Status)
	}

	// deactivated account
	alice = env.reload(alice)
	alice.Set("active", false)
	if err := env.app.Save(alice); err != nil {
		t.Fatal(err)
	}
	if r := resume(sid, secret); r.Status != 401 {
		t.Fatalf("inactive user must not resume: %d", r.Status)
	}

	// revoked session
	alice.Set("active", true)
	if err := env.app.Save(alice); err != nil {
		t.Fatal(err)
	}
	sess, _ = env.app.FindRecordById(ColSessions, sid)
	if sess != nil {
		if err := env.app.Delete(sess); err != nil {
			t.Fatal(err)
		}
	}
	if r := resume(sid, secret); r.Status != 401 {
		t.Fatalf("revoked session must not resume: %d", r.Status)
	}
}

func TestAdminWebRejectsNonAdmins(t *testing.T) {
	env := newTestEnv(t)
	env.createUser("admin", RoleAdmin)
	env.createUser("alice", RoleUser)

	if res := env.loginWith("alice", testPassword("alice"), testAdminOrigin); res.Status != 403 {
		t.Fatalf("user login from admin origin: %d %s", res.Status, res.Raw)
	}
	if n, _ := env.app.CountRecords(ColSessions); n != 0 {
		t.Fatal("rejected login must not leave a session")
	}
	res := env.loginWith("admin", testPassword("admin"), testAdminOrigin)
	if res.Status != 200 {
		t.Fatalf("admin login from admin origin: %d %s", res.Status, res.Raw)
	}
	sess, _ := env.app.FindFirstRecordByData(ColSessions, "client", ClientAdminWeb)
	if sess == nil {
		t.Fatal("admin web session must be labeled")
	}
}

func TestBruteForceLockout(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)

	wrong := env.loginWith("alice", testPassword("wrong"), "")
	unknown := env.loginWith("nobody", testPassword("wrong"), "")
	if wrong.Status != 400 || unknown.Status != 400 || wrong.Body["message"] != unknown.Body["message"] {
		t.Fatalf("errors must be generic: %s / %s", wrong.Raw, unknown.Raw)
	}

	for i := 0; i < lockoutThreshold-1; i++ {
		env.loginWith("alice", testPassword("wrong"), "")
	}
	locked := env.reload(alice)
	if !isLocked(locked, time.Now()) {
		t.Fatalf("account must be locked after %d failures (failed_logins=%d)", lockoutThreshold, locked.GetInt("failed_logins"))
	}

	// correct password is rejected while locked, with the same generic message
	res := env.loginWith("alice", testPassword("alice"), "")
	if res.Status != 400 || res.Body["message"] != wrong.Body["message"] {
		t.Fatalf("locked account: %d %s", res.Status, res.Raw)
	}
	if env.auditCount(AuditLoginLocked) == 0 {
		t.Fatal("lock must be audited")
	}

	// after the lock expired a successful login resets the counter
	locked.Set("locked_until", types.NowDateTime().Add(-time.Minute))
	if err := env.app.Save(locked); err != nil {
		t.Fatal(err)
	}
	env.login(alice)
	if env.reload(alice).GetInt("failed_logins") != 0 {
		t.Fatal("counter must be reset after successful login")
	}
}

func TestLockDurationBackoff(t *testing.T) {
	cases := map[int]time.Duration{4: 0, 5: time.Minute, 6: 2 * time.Minute, 8: 8 * time.Minute, 11: 60 * time.Minute, 50: 60 * time.Minute}
	for failures, want := range cases {
		if got := lockDuration(failures); got != want {
			t.Errorf("lockDuration(%d) = %v, want %v", failures, got, want)
		}
	}
}

func TestPrelogin(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)

	res := env.do("GET", "/api/lexichat/prelogin?username=alice", nil, reqOpts{})
	if res.Status != 200 || res.str("salt") != alice.GetString("kdf_salt") {
		t.Fatalf("known user: %d %s", res.Status, res.Raw)
	}
	u1 := env.do("GET", "/api/lexichat/prelogin?username=ghost", nil, reqOpts{})
	u2 := env.do("GET", "/api/lexichat/prelogin?username=ghost", nil, reqOpts{})
	if u1.Status != 200 || u1.str("salt") == "" || u1.str("salt") != u2.str("salt") {
		t.Fatalf("unknown user must get a stable fake salt: %s / %s", u1.Raw, u2.Raw)
	}
	if strings.Contains(res.Raw, "wrapped") || strings.Contains(res.Raw, "password") {
		t.Fatal("prelogin must only expose kdf data")
	}
}

// ---------------------------------------------------------------------------
// one-time password + password change flow
// ---------------------------------------------------------------------------

func TestOneTimePasswordFlow(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	a := env.login(admin)

	res := a.do("POST", "/api/lexichat/admin/users", map[string]any{"username": "neu", "name": "Neu", "role": "user"})
	if res.Status != 201 {
		t.Fatalf("create: %d %s", res.Status, res.Raw)
	}
	otp := res.str("oneTimePassword")

	// client side derivation (same as the desktop client)
	pre := env.do("GET", "/api/lexichat/prelogin?username=neu", nil, reqOpts{})
	authKey := deriveForTest(t, otp, pre)

	login := env.loginWith("neu", authKey, "")
	if login.Status != 200 {
		t.Fatalf("otp login: %d %s", login.Status, login.Raw)
	}
	meta := login.Body["meta"].(map[string]any)
	if meta["mustChangePassword"] != true {
		t.Fatal("mustChangePassword must be signalled")
	}
	u := &client{env: env, token: login.str("token"), session: meta["sessionId"].(string)}

	// everything except the password change is blocked
	if res := u.do("GET", "/api/collections/chats/records", nil); res.Status != 403 {
		t.Fatalf("must change password: chats %d", res.Status)
	}
	if res := u.do("GET", "/api/collections/users/records", nil); res.Status != 403 {
		t.Fatalf("must change password: users %d", res.Status)
	}

	newKey := testPassword("neu-new")
	body := map[string]any{
		"oldPassword":        authKey,
		"newPassword":        newKey,
		"kdfSalt":            randomB64(16),
		"kdfParams":          map[string]any{"alg": "argon2id13", "ops": 3, "mem": 67108864},
		"wrappedPrivateKeys": map[string]any{"v": 1, "alg": "xchacha20poly1305", "nonce": randomB64(24), "ct": randomB64(96)},
	}

	body["publicEncKey"] = randomB64(32)
	body["publicSignKey"] = randomB64(32)

	wrongOld := map[string]any{}
	for k, v := range body {
		wrongOld[k] = v
	}
	wrongOld["oldPassword"] = testPassword("nope")
	if res := u.do("POST", "/api/lexichat/me/password", wrongOld); res.Status != 400 {
		t.Fatalf("wrong old password: %d", res.Status)
	}

	res = u.do("POST", "/api/lexichat/me/password", body)
	if res.Status != 200 {
		t.Fatalf("password change: %d %s", res.Status, res.Raw)
	}

	// old token/session are invalid, the new password works
	if res := u.do("GET", "/api/lexichat/me/keys", nil); res.Status != 401 {
		t.Fatalf("old session must be invalid: %d", res.Status)
	}
	if res := env.loginWith("neu", authKey, ""); res.Status == 200 {
		t.Fatal("one-time password must not work anymore")
	}
	login = env.loginWith("neu", newKey, "")
	if login.Status != 200 {
		t.Fatalf("new password login: %d %s", login.Status, login.Raw)
	}
	meta = login.Body["meta"].(map[string]any)
	u = &client{env: env, token: login.str("token"), session: meta["sessionId"].(string)}
	keys := u.do("GET", "/api/lexichat/me/keys", nil)
	if keys.Status != 200 || keys.Body["wrappedPrivateKeys"] == nil || keys.Body["keyVersion"].(float64) != 1 {
		t.Fatalf("own keys: %d %s", keys.Status, keys.Raw)
	}
	if env.auditCount(AuditKeysChanged) != 1 || env.auditCount(AuditPasswordChanged) != 1 {
		t.Fatal("password and key changes must be audited")
	}
}

func TestAdminPasswordResetKeepsPublicKeysAndDropsWrappedKeys(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	a := env.login(admin)
	c := env.login(alice)

	res := a.do("POST", "/api/lexichat/admin/users/"+alice.Id+"/reset-password", nil)
	if res.Status != 200 || res.str("oneTimePassword") == "" {
		t.Fatalf("reset: %d %s", res.Status, res.Raw)
	}
	fresh := env.reload(alice)
	if !fresh.GetBool("must_change_password") || fresh.Get("wrapped_private_keys") != nil && string(fresh.GetString("wrapped_private_keys")) != "null" && fresh.GetString("wrapped_private_keys") != "" {
		t.Fatalf("reset state: %v", fresh.FieldsData())
	}
	if fresh.GetString("public_enc_key") != alice.GetString("public_enc_key") {
		t.Fatal("public keys must stay (recovery possible)")
	}
	// note: an invalid token is treated as guest by PocketBase, so use an auth-only endpoint
	if res := c.do("GET", "/api/lexichat/me/keys", nil); res.Status != 401 {
		t.Fatalf("sessions must end on reset: %d", res.Status)
	}
	if res := a.do("POST", "/api/lexichat/admin/users/"+admin.Id+"/reset-password", nil); res.Status != 400 {
		t.Fatalf("self reset must be refused: %d", res.Status)
	}
}

// ---------------------------------------------------------------------------
// chats + messages + receipts
// ---------------------------------------------------------------------------

func TestChatRules(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	carol := env.createUser("carol", RoleUser)
	a, c := env.login(alice), env.login(carol)

	res := a.do("POST", "/api/collections/chats/records", map[string]any{"type": "direct", "members": []string{alice.Id, bob.Id}})
	if res.Status != 200 {
		t.Fatalf("create chat: %d %s", res.Status, res.Raw)
	}
	chatId := res.str("id")

	bad := []map[string]any{
		{"members": []string{alice.Id, bob.Id}},                    // duplicate
		{"members": []string{bob.Id, alice.Id}},                    // duplicate (other order)
		{"members": []string{alice.Id, alice.Id}},                  // self chat
		{"members": []string{bob.Id, carol.Id}},                    // creator not a member
		{"members": []string{alice.Id, bob.Id, carol.Id}},          // group (not in the MVP)
		{"members": []string{alice.Id, "doesnotexist123"}},         // unknown user
		{"members": []string{alice.Id, bob.Id}, "member_key": "x"}, // server managed field
	}
	for _, body := range bad {
		if res := a.do("POST", "/api/collections/chats/records", body); is2xx(res.Status) {
			t.Errorf("chat create %v must fail", body)
		}
	}

	// outsiders cannot see the chat
	if res := c.do("GET", "/api/collections/chats/records/"+chatId, nil); res.Status != 404 {
		t.Fatalf("outsider view: %d", res.Status)
	}
	if res := c.do("GET", "/api/collections/chats/records", nil); len(res.items()) != 0 {
		t.Fatal("outsider list must be empty")
	}
	// nobody can update or delete chats via the api
	if res := a.do("PATCH", "/api/collections/chats/records/"+chatId, map[string]any{"members": []string{alice.Id, carol.Id}}); is2xx(res.Status) {
		t.Fatal("chat update must fail")
	}
	if res := a.do("DELETE", "/api/collections/chats/records/"+chatId, nil); is2xx(res.Status) {
		t.Fatal("chat delete must fail")
	}

	// a person without keys cannot be added yet
	dave := env.createUser("dave", RoleUser)
	dave.Set("public_enc_key", "")
	if err := env.app.Save(dave); err != nil {
		t.Fatal(err)
	}
	if res := a.do("POST", "/api/collections/chats/records", map[string]any{"members": []string{alice.Id, dave.Id}}); is2xx(res.Status) {
		t.Fatal("chat with user without keys must fail")
	}
}

func TestMessageRules(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	carol := env.createUser("carol", RoleUser)
	a, b, c := env.login(alice), env.login(bob), env.login(carol)

	res := a.do("POST", "/api/collections/chats/records", map[string]any{"members": []string{alice.Id, bob.Id}})
	chatId := res.str("id")

	// valid message
	res = a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id, bob.Id))
	if res.Status != 200 {
		t.Fatalf("send: %d %s", res.Status, res.Raw)
	}
	msgId := res.str("id")
	msg, _ := env.app.FindRecordById(ColMessages, msgId)
	if msg.GetDateTime("expires_at").IsZero() || msg.GetBool("is_broadcast") {
		t.Fatal("server managed fields not set")
	}
	chat, _ := env.app.FindRecordById(ColChats, chatId)
	if chat.GetDateTime("last_message_at").IsZero() {
		t.Fatal("last_message_at not updated")
	}

	// sender spoofing
	if res := a.do("POST", "/api/collections/messages/records", validMessage(chatId, bob.Id, alice.Id, bob.Id)); is2xx(res.Status) {
		t.Fatal("sender spoofing must fail")
	}
	// outsider posting into a foreign chat (with own sender id)
	if res := c.do("POST", "/api/collections/messages/records", validMessage(chatId, carol.Id, alice.Id, bob.Id)); is2xx(res.Status) {
		t.Fatal("outsider must not post")
	}
	// missing envelope for a member
	if res := a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id)); is2xx(res.Status) {
		t.Fatal("missing envelope must fail")
	}
	// envelope for an outsider
	if res := a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id, bob.Id, carol.Id)); is2xx(res.Status) {
		t.Fatal("extra envelope must fail")
	}
	// forged broadcast flag / server managed fields
	for _, extra := range []map[string]any{{"is_broadcast": true}, {"expires_at": "2099-01-01 00:00:00.000Z"}, {"edited_at": "2020-01-01 00:00:00.000Z"}} {
		m := validMessage(chatId, alice.Id, alice.Id, bob.Id)
		for k, v := range extra {
			m[k] = v
		}
		if res := a.do("POST", "/api/collections/messages/records", m); is2xx(res.Status) {
			t.Errorf("server managed field %v must be rejected", extra)
		}
	}
	// invalid crypto structure
	m := validMessage(chatId, alice.Id, alice.Id, bob.Id)
	m["nonce"] = "short"
	if res := a.do("POST", "/api/collections/messages/records", m); is2xx(res.Status) {
		t.Fatal("invalid nonce must fail")
	}

	// read access
	if res := b.do("GET", "/api/collections/messages/records?filter="+urlq(`chat = "`+chatId+`"`), nil); len(res.items()) != 1 {
		t.Fatalf("member must read: %s", res.Raw)
	}
	if res := c.do("GET", "/api/collections/messages/records", nil); len(res.items()) != 0 {
		t.Fatal("outsider must not list messages")
	}
	if res := c.do("GET", "/api/collections/messages/records/"+msgId, nil); res.Status != 404 {
		t.Fatalf("outsider view: %d", res.Status)
	}

	// edit: only the sender, only crypto fields
	edit := validMessage(chatId, alice.Id, alice.Id, bob.Id)
	delete(edit, "chat")
	delete(edit, "sender")
	delete(edit, "v")
	if res := b.do("PATCH", "/api/collections/messages/records/"+msgId, edit); is2xx(res.Status) {
		t.Fatal("recipient must not edit")
	}
	if res := a.do("PATCH", "/api/collections/messages/records/"+msgId, map[string]any{"chat": chatId, "sender": bob.Id}); is2xx(res.Status) {
		t.Fatal("moving / re-attributing a message must fail")
	}
	if res := a.do("PATCH", "/api/collections/messages/records/"+msgId, edit); res.Status != 200 {
		t.Fatalf("sender edit: %d %s", res.Status, res.Raw)
	}
	if env.reload(msg).GetDateTime("edited_at").IsZero() {
		t.Fatal("edited_at must be set")
	}

	// receipts
	res = b.do("POST", "/api/collections/receipts/records", map[string]any{"message": msgId, "user": bob.Id})
	if res.Status != 200 {
		t.Fatalf("receipt: %d %s", res.Status, res.Raw)
	}
	receiptId := res.str("id")
	if res := c.do("POST", "/api/collections/receipts/records", map[string]any{"message": msgId, "user": carol.Id}); is2xx(res.Status) {
		t.Fatal("outsider receipt must fail")
	}
	if res := a.do("POST", "/api/collections/receipts/records", map[string]any{"message": msgId, "user": alice.Id}); is2xx(res.Status) {
		t.Fatal("receipt for own message must fail")
	}
	if res := b.do("POST", "/api/collections/receipts/records", map[string]any{"message": msgId, "user": alice.Id}); is2xx(res.Status) {
		t.Fatal("receipt in the name of others must fail")
	}
	if res := a.do("GET", "/api/collections/receipts/records", nil); len(res.items()) != 1 {
		t.Fatal("sender must see the receipt")
	}
	if res := c.do("GET", "/api/collections/receipts/records/"+receiptId, nil); res.Status != 404 {
		t.Fatal("outsider must not see receipts")
	}
	if res := b.do("PATCH", "/api/collections/receipts/records/"+receiptId, map[string]any{"read_at": "2020-01-01 00:00:00.000Z"}); res.Status != 200 {
		t.Fatalf("mark read: %d %s", res.Status, res.Raw)
	}
	if res := b.do("PATCH", "/api/collections/receipts/records/"+receiptId, map[string]any{"read_at": ""}); is2xx(res.Status) {
		t.Fatal("read state must not be removable")
	}

	// delete: only the sender
	if res := b.do("DELETE", "/api/collections/messages/records/"+msgId, nil); is2xx(res.Status) {
		t.Fatal("recipient must not delete")
	}
	if res := a.do("DELETE", "/api/collections/messages/records/"+msgId, nil); res.Status != 204 {
		t.Fatalf("sender delete: %d", res.Status)
	}
	if _, err := env.app.FindRecordById(ColReceipts, receiptId); err == nil {
		t.Fatal("receipts must be deleted with the message")
	}

	// no messages to deactivated users
	bob = env.reload(bob)
	bob.Set("active", false)
	if err := env.app.Save(bob); err != nil {
		t.Fatal(err)
	}
	if res := a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id, bob.Id)); is2xx(res.Status) {
		t.Fatal("message to deactivated user must fail")
	}
}

func TestBroadcastsNotCreatableViaRecordApi(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	a := env.login(alice)
	if res := a.do("POST", "/api/collections/broadcasts/records", map[string]any{"sender": alice.Id, "recipient_count": 1}); is2xx(res.Status) {
		t.Fatal("broadcasts are created by the server only")
	}
}

// ---------------------------------------------------------------------------
// settings + audit
// ---------------------------------------------------------------------------

func TestSettingsRules(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	a, c := env.login(admin), env.login(alice)

	path := "/api/collections/lx_settings/records/" + SettingsRecordId
	if res := c.do("GET", path, nil); res.Status != 200 {
		t.Fatalf("user view settings: %d", res.Status)
	}
	if res := c.do("PATCH", path, map[string]any{"broadcast_permission": "admins"}); is2xx(res.Status) {
		t.Fatal("user must not change settings")
	}
	if res := a.do("PATCH", path, map[string]any{"message_retention_days": 0}); is2xx(res.Status) {
		t.Fatal("retention must be >= 1")
	}
	if res := a.do("PATCH", path, map[string]any{"message_retention_days": 30}); res.Status != 200 {
		t.Fatalf("admin change: %d %s", res.Status, res.Raw)
	}
	if env.auditCount(AuditSettingsChanged) != 1 {
		t.Fatal("settings change must be audited")
	}
	if res := a.do("POST", "/api/collections/lx_settings/records", map[string]any{"message_retention_days": 1}); is2xx(res.Status) {
		t.Fatal("no second settings record")
	}
	if res := a.do("DELETE", path, nil); is2xx(res.Status) {
		t.Fatal("settings must not be deletable")
	}
}

func TestAuditLogIsAdminOnlyAndAppendOnly(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	a, c := env.login(admin), env.login(alice)

	if res := c.do("GET", "/api/collections/audit_logs/records", nil); res.Status != 200 || len(res.items()) != 0 {
		t.Fatalf("users must not read audit logs: %d %s", res.Status, res.Raw)
	}
	res := a.do("GET", "/api/collections/audit_logs/records", nil)
	if res.Status != 200 || len(res.items()) < 2 {
		t.Fatalf("admin must read audit logs: %d %s", res.Status, res.Raw)
	}
	entryId := res.items()[0]["id"].(string)

	if res := a.do("POST", "/api/collections/audit_logs/records", map[string]any{"action": "fake", "created": "2020-01-01 00:00:00.000Z"}); is2xx(res.Status) {
		t.Fatal("audit create via api must fail")
	}
	if res := a.do("PATCH", "/api/collections/audit_logs/records/"+entryId, map[string]any{"action": "x"}); is2xx(res.Status) {
		t.Fatal("audit update via api must fail")
	}
	if res := a.do("DELETE", "/api/collections/audit_logs/records/"+entryId, nil); is2xx(res.Status) {
		t.Fatal("audit delete via api must fail")
	}

	// model level protection (even for internal code / superusers)
	entry, _ := env.app.FindRecordById(ColAuditLogs, entryId)
	entry.Set("action", "tampered")
	if err := env.app.Save(entry); err == nil {
		t.Fatal("audit update must fail on model level")
	}
	if err := env.app.Delete(entry); err == nil {
		t.Fatal("audit delete must fail on model level")
	}

	if n, err := VerifyAuditChain(env.app); err != nil || n < 2 {
		t.Fatalf("chain must verify: %d %v", n, err)
	}

	// tampering with the database directly is detected
	if _, err := env.app.DB().NewQuery("UPDATE audit_logs SET action = 'tampered' WHERE id = {:id}").Bind(map[string]any{"id": entryId}).Execute(); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyAuditChain(env.app); err == nil {
		t.Fatal("tampering must be detected")
	}
}

func TestAuditContainsNoSecrets(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	a := env.login(admin)
	res := a.do("POST", "/api/lexichat/admin/users", map[string]any{"username": "neu", "name": "Neu", "role": "user"})
	otp := res.str("oneTimePassword")
	env.loginWith("admin", testPassword("wrong"), "")
	env.loginWith("tippfehler-passwort", testPassword("wrong"), "")

	records, _ := env.app.FindAllRecords(ColAuditLogs)
	for _, r := range records {
		dump := r.GetString("details") + r.GetString("target_label") + r.GetString("ip_hash")
		for _, secret := range []string{otp, testPassword("admin"), testPassword("wrong"), "tippfehler-passwort", "127.0.0.1", "192.0.2.1"} {
			if strings.Contains(dump, secret) {
				t.Fatalf("audit entry %s leaks %q", r.GetString("action"), secret)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// retention
// ---------------------------------------------------------------------------

func TestRetentionDeletesExpiredData(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	a := env.login(alice)

	res := a.do("POST", "/api/collections/chats/records", map[string]any{"members": []string{alice.Id, bob.Id}})
	chatId := res.str("id")
	keep := a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id, bob.Id)).str("id")
	expired := a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id, bob.Id)).str("id")

	m, _ := env.app.FindRecordById(ColMessages, expired)
	m.Set("expires_at", types.NowDateTime().Add(-time.Hour))
	if err := env.app.Save(m); err != nil {
		t.Fatal(err)
	}
	sess, _ := env.app.FindRecordById(ColSessions, a.session)
	sess.Set("expires_at", types.NowDateTime().Add(-time.Hour))
	if err := env.app.Save(sess); err != nil {
		t.Fatal(err)
	}

	r, err := env.srv.RunRetention(env.app)
	if err != nil {
		t.Fatal(err)
	}
	if r.Messages != 1 || r.Sessions != 1 {
		t.Fatalf("unexpected retention result: %+v", r)
	}
	if _, err := env.app.FindRecordById(ColMessages, keep); err != nil {
		t.Fatal("non-expired message must stay")
	}
	if _, err := env.app.FindRecordById(ColMessages, expired); err == nil {
		t.Fatal("expired message must be deleted")
	}
}

func TestDeletingUserRemovesTheirChats(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	a, ad := env.login(alice), env.login(admin)

	chatId := a.do("POST", "/api/collections/chats/records", map[string]any{"members": []string{alice.Id, bob.Id}}).str("id")
	msgId := a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id, bob.Id)).str("id")

	if res := ad.do("DELETE", "/api/collections/users/records/"+bob.Id, nil); res.Status != 204 {
		t.Fatalf("delete user: %d %s", res.Status, res.Raw)
	}
	if _, err := env.app.FindRecordById(ColChats, chatId); err == nil {
		t.Fatal("chat must be removed")
	}
	if _, err := env.app.FindRecordById(ColMessages, msgId); err == nil {
		t.Fatal("messages must be removed")
	}
	if env.auditCount(AuditUserDeleted) != 1 {
		t.Fatal("deletion must be audited")
	}
}

func TestRevokedSessionDisconnectsRealtimeClients(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	c := env.login(alice)

	rc := subscriptions.NewDefaultClient()
	rc.Set(realtimeKeySession, c.session)
	other := subscriptions.NewDefaultClient()
	other.Set(realtimeKeySession, "someothersessi")
	env.app.SubscriptionsBroker().Register(rc)
	env.app.SubscriptionsBroker().Register(other)

	if res := c.do("DELETE", "/api/collections/sessions/records/"+c.session, nil); res.Status != 204 {
		t.Fatalf("logout: %d", res.Status)
	}
	if !rc.IsDiscarded() {
		t.Fatal("realtime client of the revoked session must be discarded")
	}
	if other.IsDiscarded() {
		t.Fatal("other realtime clients must stay connected")
	}
}
