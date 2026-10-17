package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Phase 3-5: privacy preferences, account lifecycle (deactivation date,
// anonymisation) and the automatic anonymisation of long deactivated accounts.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		// privacy preferences of the person (privacy by default: everything off)
		users.Fields.Add(&core.JSONField{Name: "prefs", MaxSize: 1024})
		users.Fields.Add(&core.DateField{Name: "deactivated_at"})
		users.Fields.Add(&core.BoolField{Name: "anonymized"})
		if err := app.Save(users); err != nil {
			return err
		}

		settings, err := app.FindCollectionByNameOrId("lx_settings")
		if err != nil {
			return err
		}
		// 0 = never; otherwise deactivated accounts are anonymised after n days
		settings.Fields.Add(&core.NumberField{Name: "anonymize_deactivated_days", OnlyInt: true, Min: intPtr(0), Max: intPtr(3650)})
		settings.Fields.Add(&core.NumberField{Name: "broadcasts_per_hour", OnlyInt: true, Min: intPtr(1), Max: intPtr(100)})
		if err := app.Save(settings); err != nil {
			return err
		}
		r, err := app.FindRecordById(settings, "globalsettings1")
		if err != nil {
			return err
		}
		r.Set("anonymize_deactivated_days", 180)
		r.Set("broadcasts_per_hour", 10)
		return app.Save(r)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.RemoveByName("prefs")
		users.Fields.RemoveByName("deactivated_at")
		users.Fields.RemoveByName("anonymized")
		if err := app.Save(users); err != nil {
			return err
		}
		settings, err := app.FindCollectionByNameOrId("lx_settings")
		if err != nil {
			return err
		}
		settings.Fields.RemoveByName("anonymize_deactivated_days")
		settings.Fields.RemoveByName("broadcasts_per_hour")
		return app.Save(settings)
	})
}
