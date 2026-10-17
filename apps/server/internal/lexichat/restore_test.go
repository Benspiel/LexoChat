package lexichat

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// TestBackupRestoreRoundtrip is the automated restore test: a backup stream is
// unpacked into a fresh data directory, a new server is started on it and the
// data (accounts, chats, messages, audit chain) must be intact and usable.
func TestBackupRestoreRoundtrip(t *testing.T) {
	env := newTestEnv(t)
	alice := env.createUser("alice", RoleUser)
	bob := env.createUser("bob", RoleUser)
	a := env.login(alice)
	chatId := a.do("POST", "/api/collections/chats/records", map[string]any{"members": []string{alice.Id, bob.Id}}).str("id")
	msgId := a.do("POST", "/api/collections/messages/records", validMessage(chatId, alice.Id, alice.Id, bob.Id)).str("id")

	var buf bytes.Buffer
	if err := StreamBackup(context.Background(), env.app, &buf); err != nil {
		t.Fatal(err)
	}

	// restore into an empty directory (what restore.sh does inside the volume)
	restored := t.TempDir()
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range zr.File {
		path := filepath.Join(restored, filepath.Clean(f.Name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(rc)
		rc.Close()
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	app2, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: restored, EncryptionEnv: "pb_test_env"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app2.Cleanup)
	srv2, err := Register(app2, Config{ServerSecret: testSecret, AdminOrigin: testAdminOrigin})
	if err != nil {
		t.Fatal(err)
	}
	router, err := apis.NewRouter(app2)
	if err != nil {
		t.Fatal(err)
	}
	env2 := &testEnv{t: t, app: app2, srv: srv2}
	if err := app2.OnServe().Trigger(&core.ServeEvent{App: app2, Router: router}, func(e *core.ServeEvent) error {
		mux, err := e.Router.BuildMux()
		env2.handler = mux
		return err
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := app2.FindRecordById(ColMessages, msgId); err != nil {
		t.Fatal("message missing after restore")
	}
	// the restored accounts can log in and read their chat
	b := env2.login(env2.reload(bob))
	if r := b.do("GET", "/api/collections/messages/records", nil); len(r.items()) != 1 {
		t.Fatalf("restored chat not readable: %s", r.Raw)
	}
	if n, err := VerifyAuditChain(app2); err != nil || n == 0 {
		t.Fatalf("audit chain after restore: %d %v", n, err)
	}
}
