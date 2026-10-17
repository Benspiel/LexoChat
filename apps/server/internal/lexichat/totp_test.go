package lexichat

import (
	"encoding/base32"
	"strings"
	"testing"
	"time"
)

// RFC 6238 appendix B (SHA1), truncated to 6 digits.
func TestTotpRFC6238Vectors(t *testing.T) {
	secret := []byte("12345678901234567890")
	cases := map[int64]string{59: "287082", 1111111109: "081804", 1111111111: "050471", 1234567890: "005924", 2000000000: "279037"}
	for ts, want := range cases {
		if got := totpCode(secret, uint64(ts/30)); got != want {
			t.Errorf("t=%d: got %s want %s", ts, got, want)
		}
	}
}

func TestTotpVerifyWindowAndReplay(t *testing.T) {
	secret := []byte("12345678901234567890")
	at := time.Unix(1234567890, 0)
	step := at.Unix() / 30
	code := totpCode(secret, uint64(step))

	if got := totpVerify(secret, code, at, 0); got != step {
		t.Fatalf("current code must verify, got %d", got)
	}
	if got := totpVerify(secret, code, at.Add(30*time.Second), 0); got != step {
		t.Fatal("previous step must be accepted (clock drift)")
	}
	if totpVerify(secret, code, at.Add(90*time.Second), 0) != 0 {
		t.Fatal("old code must be rejected")
	}
	if totpVerify(secret, code, at, step) != 0 {
		t.Fatal("replay must be rejected")
	}
	if totpVerify(secret, "000000", at, 0) != 0 && totpCode(secret, uint64(step)) != "000000" {
		t.Fatal("wrong code must be rejected")
	}
	if totpVerify(secret, "12345", at, 0) != 0 {
		t.Fatal("short code must be rejected")
	}
}

func TestTotpSecretEncryption(t *testing.T) {
	env := newTestEnv(t)
	sealed, err := env.srv.sealTotpSecret([]byte("secret-secret-secret"), "user1")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "secret-secret") {
		t.Fatal("secret must be encrypted")
	}
	if got, err := env.srv.openTotpSecret(sealed, "user1"); err != nil || string(got) != "secret-secret-secret" {
		t.Fatalf("roundtrip failed: %v", err)
	}
	if _, err := env.srv.openTotpSecret(sealed, "user2"); err == nil {
		t.Fatal("secret must be bound to the user id")
	}
}

func TestAdminWithoutTotpIsRestricted(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	fresh := env.createUser("neuadmin", RoleUser)
	fresh.Set("role", RoleAdmin) // admin without second factor
	if err := env.app.Save(fresh); err != nil {
		t.Fatal(err)
	}

	res := env.loginWith("neuadmin", testPassword("neuadmin"), testAdminOrigin)
	if res.Status != 200 {
		t.Fatalf("login: %d %s", res.Status, res.Raw)
	}
	meta := res.Body["meta"].(map[string]any)
	if meta["totpSetupRequired"] != true {
		t.Fatal("totpSetupRequired must be signalled")
	}
	c := &client{env: env, token: res.str("token"), session: meta["sessionId"].(string)}
	if r := c.do("POST", "/api/lexichat/admin/users", map[string]any{"username": "x1x", "name": "X", "role": "user"}); r.Status != 403 {
		t.Fatalf("admin endpoint must be blocked: %d", r.Status)
	}
	if r := c.do("GET", "/api/collections/audit_logs/records", nil); r.Status != 403 {
		t.Fatalf("record api must be blocked: %d", r.Status)
	}

	// enrolment
	if r := c.do("POST", "/api/lexichat/me/totp/setup", map[string]any{"password": testPassword("wrong")}); r.Status != 400 {
		t.Fatalf("setup needs the password: %d", r.Status)
	}
	setup := c.do("POST", "/api/lexichat/me/totp/setup", map[string]any{"password": testPassword("neuadmin")})
	if setup.Status != 200 || !strings.HasPrefix(setup.str("uri"), "otpauth://totp/LexiChat:neuadmin?") {
		t.Fatalf("setup: %d %s", setup.Status, setup.Raw)
	}
	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(setup.str("secret"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(env.reload(fresh).GetString("totp_pending"), setup.str("secret")) {
		t.Fatal("pending secret must be stored encrypted")
	}
	if r := c.do("POST", "/api/lexichat/me/totp/enable", map[string]any{"code": "000000"}); r.Status != 400 && totpCode(secret, uint64(now().Unix()/30)) != "000000" {
		t.Fatalf("wrong code: %d", r.Status)
	}
	code := totpCode(secret, uint64(now().Unix()/30))
	if r := c.do("POST", "/api/lexichat/me/totp/enable", map[string]any{"code": code}); r.Status != 204 {
		t.Fatalf("enable: %d %s", r.Status, r.Raw)
	}
	if r := c.do("GET", "/api/collections/audit_logs/records", nil); r.Status != 200 {
		t.Fatalf("after enrolment the admin must be unrestricted: %d", r.Status)
	}

	// login now requires the code
	res = env.do("POST", "/api/collections/users/auth-with-password", map[string]any{"identity": "neuadmin", "password": testPassword("neuadmin")}, reqOpts{})
	if res.Status != 401 || !strings.Contains(res.Raw, `"code":"totp_required"`) {
		t.Fatalf("missing code: %d %s", res.Status, res.Raw)
	}
	res = env.do("POST", "/api/collections/users/auth-with-password", map[string]any{"identity": "neuadmin", "password": testPassword("neuadmin"), "totp": code}, reqOpts{})
	if res.Status == 200 {
		t.Fatal("replayed code must be rejected")
	}
	if env.reload(fresh).GetInt("failed_logins") == 0 {
		t.Fatal("wrong codes must count as failed logins")
	}

	// admins cannot disable the mandatory second factor
	if r := c.do("POST", "/api/lexichat/me/totp/disable", map[string]any{"password": testPassword("neuadmin"), "code": code}); r.Status != 403 {
		t.Fatalf("disable must be forbidden for admins: %d", r.Status)
	}

	// another admin can reset it (lost phone)
	a := env.login(admin)
	if r := a.do("POST", "/api/lexichat/admin/users/"+fresh.Id+"/reset-2fa", nil); r.Status != 204 {
		t.Fatalf("reset-2fa: %d %s", r.Status, r.Raw)
	}
	if env.reload(fresh).GetBool("totp_enabled") {
		t.Fatal("totp must be disabled")
	}
	if r := c.do("GET", "/api/lexichat/me/keys", nil); r.Status != 401 {
		t.Fatal("sessions must end on 2fa reset")
	}
	if env.auditCount(AuditUserTotpReset) != 1 || env.auditCount(AuditTotpEnabled) != 1 {
		t.Fatal("2fa changes must be audited")
	}
	if r := a.do("POST", "/api/lexichat/admin/users/"+admin.Id+"/reset-2fa", nil); r.Status != 400 {
		t.Fatal("own 2fa reset must be refused")
	}
}

func TestUsersCannotSeeOrSetTotpFields(t *testing.T) {
	env := newTestEnv(t)
	env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	c := env.login(alice)

	res := c.do("GET", "/api/collections/users/records", nil)
	if strings.Contains(res.Raw, "totp_secret") || strings.Contains(res.Raw, "totp_pending") || strings.Contains(res.Raw, `"totp_enabled"`) || strings.Count(res.Raw, `"two_factor"`) > 1 {
		t.Fatalf("totp fields leaked: %s", res.Raw)
	}
	c.do("PATCH", "/api/collections/users/records/"+alice.Id, map[string]any{"totp_enabled": true})
	if env.reload(alice).GetBool("totp_enabled") {
		t.Fatal("totp_enabled must not be settable")
	}
}

func TestAdminUnlock(t *testing.T) {
	env := newTestEnv(t)
	admin := env.createUser("admin", RoleAdmin)
	alice := env.createUser("alice", RoleUser)
	for i := 0; i < lockoutThreshold; i++ {
		env.loginWith("alice", testPassword("wrong"), "")
	}
	a := env.login(admin)
	list := a.do("GET", "/api/collections/users/records?filter="+urlq(`username = "alice"`), nil)
	if len(list.items()) != 1 || list.items()[0]["locked"] != true {
		t.Fatalf("admin must see the lock state: %s", list.Raw)
	}
	if r := a.do("POST", "/api/lexichat/admin/users/"+alice.Id+"/unlock", nil); r.Status != 204 {
		t.Fatalf("unlock: %d", r.Status)
	}
	env.login(alice)
}

func TestKeySetupEndpoint(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	alice.Set("public_enc_key", "")
	alice.Set("public_sign_key", "")
	alice.Set("wrapped_private_keys", nil)
	if err := env.app.Save(alice); err != nil {
		t.Fatal(err)
	}
	c := env.login(alice)
	wrapped := map[string]any{"v": 1, "alg": "xchacha20poly1305", "nonce": randomB64(24), "ct": randomB64(96)}
	body := map[string]any{"password": testPassword("alice"), "wrappedPrivateKeys": wrapped}

	if r := c.do("POST", "/api/lexichat/me/keys", body); r.Status != 400 {
		t.Fatalf("new keys are required for an account without keys: %d", r.Status)
	}
	body["publicEncKey"] = randomB64(32)
	body["publicSignKey"] = randomB64(32)
	bad := map[string]any{}
	for k, v := range body {
		bad[k] = v
	}
	bad["password"] = testPassword("wrong")
	if r := c.do("POST", "/api/lexichat/me/keys", bad); r.Status != 400 {
		t.Fatalf("password is required: %d", r.Status)
	}
	if r := c.do("POST", "/api/lexichat/me/keys", body); r.Status != 204 {
		t.Fatalf("setup: %d %s", r.Status, r.Raw)
	}
	if env.reload(alice).GetInt("key_version") != 1 {
		t.Fatal("key version must be incremented")
	}
	if r := c.do("POST", "/api/lexichat/me/keys", body); r.Status != 400 {
		t.Fatal("existing keys must not be overwritten via setup")
	}

	// password change without re-wrapped keys is refused once keys exist
	r := c.do("POST", "/api/lexichat/me/password", map[string]any{
		"oldPassword": testPassword("alice"), "newPassword": testPassword("alice2"),
		"kdfSalt": randomB64(16), "kdfParams": map[string]any{"alg": "argon2id13", "ops": 3, "mem": 67108864},
	})
	if r.Status != 400 || !strings.Contains(r.Raw, "LexiChat-App") {
		t.Fatalf("password change must require re-wrapped keys: %d %s", r.Status, r.Raw)
	}
}
