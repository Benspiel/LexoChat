package lexichat

import (
	"errors"
	"os"
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
