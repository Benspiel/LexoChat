package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// "Einmal anmelden": desktop sessions get a long lived resume secret. Only its
// sha256 is stored (hidden field), the secret itself stays in the Windows
// Credential Manager of the device.
func init() {
	m.Register(func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sessions")
		if err != nil {
			return err
		}
		if c.Fields.GetByName("resume_hash") == nil {
			c.Fields.Add(&core.TextField{Name: "resume_hash", Max: 64, Hidden: true})
		}
		return app.Save(c)
	}, func(app core.App) error {
		c, err := app.FindCollectionByNameOrId("sessions")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("resume_hash")
		return app.Save(c)
	})
}
