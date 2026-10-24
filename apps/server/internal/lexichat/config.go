package lexichat

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Config holds the runtime configuration (from environment variables).
type Config struct {
	// ServerSecret is used for HMACs (ip hashes, fake prelogin salts).
	// Must be at least 32 characters. Env: LEXICHAT_SERVER_SECRET.
	ServerSecret string

	// AdminOrigin is the origin of the admin web app (e.g. https://admin.praxis.example).
	// Non-admins are rejected when they try to log in from this origin.
	// Env: LEXICHAT_ADMIN_ORIGIN.
	AdminOrigin string

	// AllowedOrigins limits CORS (comma separated). Env: LEXICHAT_ALLOWED_ORIGINS.
	AllowedOrigins []string

	// SuperuserIPs restricts the PocketBase superuser login (comma separated IPs/CIDRs).
	// Env: LEXICHAT_SUPERUSER_IPS.
	SuperuserIPs []string

	// AppURL is the public base url. Env: LEXICHAT_APP_URL.
	AppURL string

	// TrustProxy enables X-Forwarded-For handling (only behind the bundled reverse proxy).
	// Env: LEXICHAT_TRUST_PROXY=true.
	TrustProxy bool
}

const minSecretLen = 32

// ConfigFromEnv reads the configuration from the environment.
func ConfigFromEnv() (Config, error) {
	cfg := Config{
		ServerSecret:   os.Getenv("LEXICHAT_SERVER_SECRET"),
		AdminOrigin:    strings.TrimRight(os.Getenv("LEXICHAT_ADMIN_ORIGIN"), "/"),
		AllowedOrigins: splitList(os.Getenv("LEXICHAT_ALLOWED_ORIGINS")),
		SuperuserIPs:   splitList(os.Getenv("LEXICHAT_SUPERUSER_IPS")),
		AppURL:         os.Getenv("LEXICHAT_APP_URL"),
		TrustProxy:     os.Getenv("LEXICHAT_TRUST_PROXY") == "true",
	}
	return cfg, cfg.Validate()
}

// secretFileName holds the generated server secret inside the data directory.
const secretFileName = ".lexichat_secret"

// LoadOrCreateSecret returns the server secret stored in the data directory and
// creates a random one on first start. This way "docker compose up" works without
// any configuration; LEXICHAT_SERVER_SECRET still takes precedence. The file is
// part of every pb_data backup, so ip hashes stay comparable after a restore.
func LoadOrCreateSecret(dataDir string) (string, error) {
	path := filepath.Join(dataDir, secretFileName)
	if b, err := os.ReadFile(path); err == nil {
		if secret := strings.TrimSpace(string(b)); len(secret) >= minSecretLen {
			return secret, nil
		}
		return "", errors.New(path + " is invalid (shorter than 32 characters)")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	buf := make([]byte, 48)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	secret := base64.StdEncoding.EncodeToString(buf)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	if _, err := f.WriteString(secret + "\n"); err != nil {
		f.Close()
		return "", err
	}
	return secret, f.Close()
}

// Validate checks the configuration.
func (c Config) Validate() error {
	if len(c.ServerSecret) < minSecretLen {
		return errors.New("LEXICHAT_SERVER_SECRET must be set and at least 32 characters long")
	}
	for _, o := range c.AllowedOrigins {
		if o == "*" {
			return errors.New("LEXICHAT_ALLOWED_ORIGINS must not contain *")
		}
	}
	return nil
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, strings.TrimRight(p, "/"))
		}
	}
	return out
}
