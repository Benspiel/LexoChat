package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Security review (phase 6): fields that are only enriched away for other users
// could still be used as a filter oracle (e.g. "who has no 2FA?"). They are now
// hidden on schema level and served through dedicated endpoints/enrich data.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		for _, name := range []string{"prefs", "totp_enabled", "deactivated_at"} {
			if f := users.Fields.GetByName(name); f != nil {
				f.SetHidden(true)
			}
		}
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		for _, name := range []string{"prefs", "totp_enabled", "deactivated_at"} {
			if f := users.Fields.GetByName(name); f != nil {
				f.SetHidden(false)
			}
		}
		return app.Save(users)
	})
}
