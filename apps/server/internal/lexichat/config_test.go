package lexichat

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrCreateSecret(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "pb_data")
	first, err := LoadOrCreateSecret(dir)
	if err != nil || len(first) < minSecretLen {
		t.Fatalf("create: %q %v", first, err)
	}
	info, err := os.Stat(filepath.Join(dir, secretFileName))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("secret file must be private: %v %v", info, err)
	}
	second, err := LoadOrCreateSecret(dir)
	if err != nil || second != first {
		t.Fatalf("secret must be stable across restarts: %q %v", second, err)
	}

	if err := os.WriteFile(filepath.Join(dir, secretFileName), []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateSecret(dir); err == nil {
		t.Fatal("a too short secret must be rejected")
	}
}
