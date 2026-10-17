/** German labels for audit actions (see apps/server/internal/lexichat/audit.go). */
export const AUDIT_LABELS: Record<string, string> = {
  "auth.login_success": "Anmeldung erfolgreich",
  "auth.login_failed": "Anmeldung fehlgeschlagen",
  "auth.account_locked": "Konto vorübergehend gesperrt",
  "auth.login_rejected": "Anmeldung abgelehnt",
  "auth.session_revoked": "Sitzung beendet",
  "auth.password_changed": "Passwort geändert",
  "auth.keys_changed": "Schlüssel geändert",
  "auth.totp_enabled": "Zwei-Faktor-Anmeldung eingerichtet",
  "auth.totp_disabled": "Zwei-Faktor-Anmeldung deaktiviert",
  "admin.user_created": "Konto angelegt",
  "admin.user_updated": "Konto bearbeitet",
  "admin.user_deactivated": "Konto deaktiviert",
  "admin.user_reactivated": "Konto reaktiviert",
  "admin.user_role_changed": "Rolle geändert",
  "admin.user_deleted": "Konto gelöscht",
  "admin.user_password_reset": "Passwort zurückgesetzt",
  "admin.user_totp_reset": "Zwei-Faktor-Anmeldung zurückgesetzt",
  "admin.user_unlocked": "Konto entsperrt",
  "admin.settings_changed": "Einstellungen geändert",
  "system.bootstrap_admin": "Erstes Admin-Konto angelegt",
  "system.retention_cleanup": "Automatische Löschung",
};

export const AUDIT_REASONS: Record<string, string> = {
  locked: "Konto gesperrt",
  inactive: "Konto deaktiviert",
  admin_web_non_admin: "Kein Admin (Verwaltungsoberfläche)",
  unknown_user: "Unbekannter Benutzername",
};

export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action;
}
