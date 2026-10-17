package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// TOTP second factor (phase 2). The secrets are AES-GCM encrypted by the server
// (see internal/lexichat/totp.go) and hidden from every api response.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(&core.BoolField{Name: "totp_enabled"})
		users.Fields.Add(&core.TextField{Name: "totp_secret", Hidden: true, Max: 200})
		users.Fields.Add(&core.TextField{Name: "totp_pending", Hidden: true, Max: 200})
		users.Fields.Add(&core.NumberField{Name: "totp_last_step", Hidden: true, OnlyInt: true, Min: intPtr(0)})
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		for _, f := range []string{"totp_enabled", "totp_secret", "totp_pending", "totp_last_step"} {
			users.Fields.RemoveByName(f)
		}
		return app.Save(users)
	})
}
