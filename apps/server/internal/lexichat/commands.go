package lexichat

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

// BootstrapAdminCommand creates the very first admin account.
// It refuses to run if an admin account already exists.
func BootstrapAdminCommand(app core.App, srv func() *Server) *cobra.Command {
	var username, name string

	cmd := &cobra.Command{
		Use:   "bootstrap-admin",
		Short: "Creates the first LexiChat admin (one-time password, must be changed on first login)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := app.RunAllMigrations(); err != nil {
				return err
			}

			n, err := app.CountRecords(ColUsers, dbx.HashExp{"role": RoleAdmin})
			if err != nil {
				return err
			}
			if n > 0 {
				return errors.New("an admin account already exists - use the admin web app to manage users")
			}

			user, otp, err := CreateAccount(app, username, name, RoleAdmin)
			if err != nil {
				return err
			}
			srv().Audit(app, AuditEntry{Action: AuditBootstrapAdmin, TargetType: ColUsers, TargetId: user.Id, TargetLabel: user.GetString("username")})

			// printed once to the terminal only (never logged)
			fmt.Fprintf(cmd.OutOrStdout(), "\nAdmin-Konto angelegt.\n  Benutzername:     %s\n  Einmalpasswort:   %s\n\n"+
				"Das Einmalpasswort muss bei der ersten Anmeldung geändert werden.\n"+
				"Bewahren Sie es bis dahin sicher auf und geben Sie es nicht weiter.\n\n", user.GetString("username"), otp)
			return nil
		},
	}
	cmd.Flags().StringVar(&username, "username", "", "username of the admin (a-z, 0-9, . _ -)")
	cmd.Flags().StringVar(&name, "name", "", "display name")
	_ = cmd.MarkFlagRequired("username")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

// HealthcheckCommand is used by the container healthcheck (the image has no shell/curl).
func HealthcheckCommand() *cobra.Command {
	var url string
	cmd := &cobra.Command{
		Use:   "healthcheck",
		Short: "Checks the local health endpoint",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := &http.Client{Timeout: 3 * time.Second}
			res, err := client.Get(url)
			if err != nil {
				return err
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				return fmt.Errorf("unhealthy: %d", res.StatusCode)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&url, "url", "http://127.0.0.1:8090/api/health", "health url")
	cmd.SilenceUsage = true
	return cmd
}

// VerifyAuditCommand verifies the audit log hash chain.
func VerifyAuditCommand(app core.App) *cobra.Command {
	return &cobra.Command{
		Use:   "verify-audit",
		Short: "Verifies the audit log hash chain",
		RunE: func(cmd *cobra.Command, args []string) error {
			n, err := VerifyAuditChain(app)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Audit-Kette NICHT intakt: %v\n", err)
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Audit-Kette intakt (%d Einträge).\n", n)
			return nil
		},
	}
}

// StreamBackup creates a consistent PocketBase backup (zip of pb_data), writes it to w
// and removes the temporary archive again. The caller encrypts the stream (age),
// so no unencrypted copy is left behind outside of the data volume.
func StreamBackup(ctx context.Context, app core.App, w io.Writer) error {
	name := "lexichat-" + time.Now().UTC().Format("20060102-150405") + ".zip"
	if err := app.CreateBackup(ctx, name); err != nil {
		return err
	}

	fsys, err := app.NewBackupsFilesystem()
	if err != nil {
		return err
	}
	defer fsys.Close()
	defer func() {
		if err := fsys.Delete(name); err != nil {
			app.Logger().Error("failed to delete temporary backup", "error", err)
		}
	}()

	r, err := fsys.GetReader(name)
	if err != nil {
		return err
	}
	defer r.Close()

	_, err = io.Copy(w, r)
	return err
}

// BackupStreamCommand writes a backup zip to stdout (pipe it into age!).
func BackupStreamCommand(app core.App) *cobra.Command {
	return &cobra.Command{
		Use:   "backup-stream",
		Short: "Writes a consistent backup zip to stdout (encrypt it, e.g. | age -R recipients.txt)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if term.IsTerminal(int(os.Stdout.Fd())) {
				return errors.New("refusing to write the backup to a terminal - pipe it into age")
			}
			return StreamBackup(cmd.Context(), app, cmd.OutOrStdout())
		},
	}
}
