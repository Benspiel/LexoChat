package lexichat

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/benspiel/lexochat/apps/server/internal/lxkdf"
	_ "github.com/benspiel/lexochat/apps/server/migrations"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

const (
	testAdminOrigin = "https://admin.lexichat.test"
	testSecret      = "test-secret-test-secret-test-secret-123"
)

type testEnv struct {
	t       *testing.T
	app     *tests.TestApp
	srv     *Server
	handler http.Handler
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir(), EncryptionEnv: "pb_test_env"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)

	srv, err := Register(app, Config{
		ServerSecret: testSecret,
		AdminOrigin:  testAdminOrigin,
	})
	if err != nil {
		t.Fatal(err)
	}

	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	env := &testEnv{t: t, app: app, srv: srv}
	se := &core.ServeEvent{App: app, Router: router}
	err = app.OnServe().Trigger(se, func(e *core.ServeEvent) error {
		mux, err := e.Router.BuildMux()
		env.handler = mux
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return env
}

// testPassword returns the (fake) client derived auth key of a test user.
func testPassword(username string) string {
	sum := sha256.Sum256([]byte("pw:" + username))
	return hex.EncodeToString(sum[:])
}

func randomB64(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

// createUser creates a fully set up (active, keys present, no forced password change) user.
func (env *testEnv) createUser(username, role string) *core.Record {
	env.t.Helper()
	col, err := env.app.FindCollectionByNameOrId(ColUsers)
	if err != nil {
		env.t.Fatal(err)
	}
	u := core.NewRecord(col)
	u.Set("username", username)
	u.Set("name", strings.ToUpper(username[:1])+username[1:])
	u.Set("role", role)
	u.Set("active", true)
	u.SetPassword(testPassword(username))
	u.Set("kdf_salt", randomB64(16))
	u.Set("kdf_params", map[string]any{"alg": "argon2id13", "ops": 3, "mem": 67108864})
	u.Set("public_enc_key", randomB64(32))
	u.Set("public_sign_key", randomB64(32))
	u.Set("wrapped_private_keys", map[string]any{"v": 1, "alg": "xchacha20poly1305", "nonce": randomB64(24), "ct": randomB64(80)})
	if err := env.app.Save(u); err != nil {
		env.t.Fatal(err)
	}
	if role == RoleAdmin {
		// admins need the second factor (require_2fa_admins is on by default)
		sealed, err := env.srv.sealTotpSecret(testTotpSecret(username), u.Id)
		if err != nil {
			env.t.Fatal(err)
		}
		u.Set("totp_enabled", true)
		u.Set("totp_secret", sealed)
		if err := env.app.Save(u); err != nil {
			env.t.Fatal(err)
		}
	}
	return u
}

func testTotpSecret(username string) []byte {
	sum := sha256.Sum256([]byte("totp:" + username))
	return sum[:20]
}

// currentTotp returns a valid code and resets the replay protection (tests log in repeatedly).
func (env *testEnv) currentTotp(username string) string {
	env.t.Helper()
	if _, err := env.app.DB().NewQuery("UPDATE users SET totp_last_step = 0 WHERE username = {:u}").Bind(map[string]any{"u": username}).Execute(); err != nil {
		env.t.Fatal(err)
	}
	return totpCode(testTotpSecret(username), uint64(now().Unix()/totpPeriod))
}

func (env *testEnv) reload(r *core.Record) *core.Record {
	env.t.Helper()
	fresh, err := env.app.FindRecordById(r.Collection().Name, r.Id)
	if err != nil {
		env.t.Fatal(err)
	}
	return fresh
}

type response struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r response) str(key string) string {
	v, _ := r.Body[key].(string)
	return v
}

func (r response) items() []map[string]any {
	raw, _ := r.Body["items"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, it := range raw {
		if m, ok := it.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

type reqOpts struct {
	token   string
	session string
	origin  string
	headers map[string]string
}

func (env *testEnv) do(method, path string, body any, opts reqOpts) response {
	env.t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			env.t.Fatal(err)
		}
		reader = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if opts.token != "" {
		req.Header.Set("Authorization", opts.token)
	}
	if opts.session != "" {
		req.Header.Set(HeaderSession, opts.session)
	}
	if opts.origin != "" {
		req.Header.Set("Origin", opts.origin)
	}
	for k, v := range opts.headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)

	res := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &res.Body)
	return res
}

// client is a logged in user.
type client struct {
	env     *testEnv
	user    *core.Record
	token   string
	session string
}

// loginWith performs a password login; for accounts with TOTP a valid code is added automatically.
func (env *testEnv) loginWith(username, password, origin string) response {
	env.t.Helper()
	body := map[string]any{"identity": username, "password": password}
	if u, err := env.app.FindFirstRecordByData(ColUsers, "username", username); err == nil && u.GetBool("totp_enabled") {
		body["totp"] = env.currentTotp(username)
	}
	return env.do("POST", "/api/collections/users/auth-with-password", body,
		reqOpts{origin: origin, headers: map[string]string{HeaderDevice: "Test-PC"}})
}

func (env *testEnv) login(u *core.Record) *client {
	env.t.Helper()
	res := env.loginWith(u.GetString("username"), testPassword(u.GetString("username")), "")
	if res.Status != 200 {
		env.t.Fatalf("login %s failed: %d %s", u.GetString("username"), res.Status, res.Raw)
	}
	meta, _ := res.Body["meta"].(map[string]any)
	sid, _ := meta["sessionId"].(string)
	if sid == "" {
		env.t.Fatalf("missing session id: %s", res.Raw)
	}
	return &client{env: env, user: u, token: res.str("token"), session: sid}
}

func (c *client) do(method, path string, body any) response {
	c.env.t.Helper()
	return c.env.do(method, path, body, reqOpts{token: c.token, session: c.session})
}

// validMessage returns a structurally valid (fake) encrypted message for the chat members.
func validMessage(chatId, senderId string, members ...string) map[string]any {
	env := map[string]string{}
	for _, m := range members {
		env[m] = randomB64(80)
	}
	return map[string]any{
		"chat":       chatId,
		"sender":     senderId,
		"v":          1,
		"ciphertext": randomB64(64),
		"nonce":      randomB64(24),
		"envelopes":  env,
		"signature":  randomB64(64),
	}
}

func (env *testEnv) auditCount(action string) int {
	env.t.Helper()
	n, err := env.app.CountRecords(ColAuditLogs)
	if err != nil {
		env.t.Fatal(err)
	}
	if action == "" {
		return int(n)
	}
	records, err := env.app.FindAllRecords(ColAuditLogs)
	if err != nil {
		env.t.Fatal(err)
	}
	c := 0
	for _, r := range records {
		if r.GetString("action") == action {
			c++
		}
	}
	return c
}

func is2xx(status int) bool { return status >= 200 && status < 300 }

func urlq(s string) string { return url.QueryEscape(s) }

// deriveForTest performs the client side key derivation from a prelogin response.
func deriveForTest(t *testing.T, password string, pre response) string {
	t.Helper()
	p, _ := pre.Body["params"].(map[string]any)
	params := lxkdf.Params{Alg: p["alg"].(string), Ops: uint32(p["ops"].(float64)), Mem: uint32(p["mem"].(float64))}
	key, err := lxkdf.DeriveAuthKeyHex(password, pre.str("salt"), params)
	if err != nil {
		t.Fatal(err)
	}
	return key
}
