// LexiChat server: PocketBase with the LexiChat security extensions.
package main

import (
	"log"
	"os"

	"github.com/benspiel/lexochat/apps/server/internal/lexichat"
	_ "github.com/benspiel/lexochat/apps/server/migrations"
	"github.com/pocketbase/pocketbase"
)

func main() {
	app := pocketbase.New()

	// the healthcheck must work without any configuration
	app.RootCmd.AddCommand(lexichat.HealthcheckCommand())
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := app.RootCmd.Execute(); err != nil {
			os.Exit(1)
		}
		return
	}

	if os.Getenv("LEXICHAT_SERVER_SECRET") == "" {
		secret, err := lexichat.LoadOrCreateSecret(app.DataDir())
		if err != nil {
			log.Fatal(err)
		}
		os.Setenv("LEXICHAT_SERVER_SECRET", secret)
	}

	cfg, err := lexichat.ConfigFromEnv()
	if err != nil {
		log.Fatal(err)
	}

	srv, err := lexichat.Register(app, cfg)
	if err != nil {
		log.Fatal(err)
	}

	app.RootCmd.AddCommand(lexichat.BootstrapAdminCommand(app, func() *lexichat.Server { return srv }))
	app.RootCmd.AddCommand(lexichat.VerifyAuditCommand(app))
	app.RootCmd.AddCommand(lexichat.BackupStreamCommand(app))

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
