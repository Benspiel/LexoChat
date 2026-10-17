import { useEffect, useState, type FormEvent } from "react";
import { Button, Notice, SelectField, Spinner, TextField, Toggle } from "@lexichat/ui";
import { client } from "../lib/client";
import { errorText, formatDate } from "../lib/format";

interface SettingsRecord {
  id: string;
  message_retention_days: number;
  broadcast_permission: "all" | "admins";
  require_2fa_admins: boolean;
  allow_2fa_users: boolean;
  session_idle_minutes: number;
  session_max_days: number;
  desktop_lock_minutes: number;
  audit_retention_days: number;
  anonymize_deactivated_days: number;
  broadcasts_per_hour: number;
  updated: string;
}

const NUMBER_FIELDS: { key: keyof SettingsRecord; label: string; min: number; max: number; hint: string }[] = [
  {
    key: "message_retention_days",
    label: "Aufbewahrung von Nachrichten (Tage)",
    min: 1,
    max: 3650,
    hint: "Danach werden Nachrichten automatisch gelöscht. Chats sind keine Patientendokumentation – Aufbewahrungspflichten der Praxis beachten.",
  },
  { key: "session_idle_minutes", label: "Sitzung endet nach Inaktivität (Minuten)", min: 5, max: 1440, hint: "Serverseitiges Leerlauf-Timeout." },
  { key: "session_max_days", label: "Maximale Sitzungsdauer (Tage)", min: 1, max: 90, hint: "Danach ist eine neue Anmeldung nötig." },
  { key: "desktop_lock_minutes", label: "Sperre der Windows-App nach (Minuten)", min: 1, max: 240, hint: "Entsperren mit Passwort." },
  { key: "audit_retention_days", label: "Aufbewahrung des Audit-Logs (Tage)", min: 30, max: 3650, hint: "Mindestens 30 Tage." },
  {
    key: "anonymize_deactivated_days",
    label: "Deaktivierte Konten anonymisieren nach (Tagen)",
    min: 0,
    max: 3650,
    hint: "0 = nie. Löschkonzept: Konten ausgeschiedener Mitarbeitender werden danach automatisch anonymisiert.",
  },
  { key: "broadcasts_per_hour", label: "Broadcasts pro Person und Stunde", min: 1, max: 100, hint: "Schutz vor versehentlichem Massenversand." },
];

export function SettingsView() {
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [draft, setDraft] = useState<SettingsRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    client
      .request<SettingsRecord>("GET", "/api/collections/lx_settings/records/globalsettings1")
      .then((s) => {
        setSettings(s);
        setDraft(s);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, []);

  if (!draft || !settings) return error ? <Notice kind="error">{error}</Notice> : <Spinner />;

  const invalid = NUMBER_FIELDS.some((f) => {
    const v = draft[f.key] as number;
    return !Number.isInteger(v) || v < f.min || v > f.max;
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || !settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const changes: Record<string, unknown> = {};
    for (const k of Object.keys(draft) as (keyof SettingsRecord)[]) {
      if (k !== "updated" && k !== "id" && draft[k] !== settings[k]) changes[k] = draft[k];
    }
    try {
      const res = await client.update<SettingsRecord>("lx_settings", settings.id, changes);
      setSettings(res);
      setDraft(res);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof SettingsRecord>(k: K, v: SettingsRecord[K]) => {
    setSaved(false);
    setDraft({ ...draft, [k]: v });
  };

  return (
    <section aria-labelledby="settings-title">
      <div className="lx-stack-sm page-head">
        <h1 id="settings-title">Einstellungen.</h1>
        <p className="lx-muted">Gilt für alle Konten. Jede Änderung wird im Audit-Log protokolliert. Zuletzt geändert: {formatDate(settings.updated)}.</p>
      </div>
      <form className="lx-stack" onSubmit={save} noValidate>
        {error && <Notice kind="error">{error}</Notice>}
        {saved && <Notice kind="success">Einstellungen gespeichert.</Notice>}

        <div className="settings-grid">
          {NUMBER_FIELDS.map((f) => {
            const v = draft[f.key] as number;
            const bad = !Number.isInteger(v) || v < f.min || v > f.max;
            return (
              <TextField
                key={f.key}
                label={f.label}
                type="number"
                inputMode="numeric"
                min={f.min}
                max={f.max}
                value={Number.isNaN(v) ? "" : String(v)}
                onChange={(e) => set(f.key, Number.parseInt(e.target.value, 10) as never)}
                hint={f.hint}
                error={bad ? `Bitte einen Wert zwischen ${f.min} und ${f.max} eingeben.` : null}
              />
            );
          })}
          <SelectField
            label="Wer darf Broadcasts senden?"
            options={[
              { value: "all", label: "Alle Benutzer:innen" },
              { value: "admins", label: "Nur Administrator:innen" },
            ]}
            value={draft.broadcast_permission}
            onChange={(e) => set("broadcast_permission", e.target.value as SettingsRecord["broadcast_permission"])}
          />
        </div>

        <div className="lx-stack">
          <Toggle
            checked={draft.require_2fa_admins}
            onChange={(v) => set("require_2fa_admins", v)}
            label="Zwei-Faktor-Anmeldung für Administrator:innen verpflichtend"
            description="Dringend empfohlen. Ohne zweiten Faktor genügt ein erbeutetes Passwort für die Kontenverwaltung."
          />
          <Toggle
            checked={draft.allow_2fa_users}
            onChange={(v) => set("allow_2fa_users", v)}
            label="Benutzer:innen dürfen Zwei-Faktor-Anmeldung einrichten"
          />
        </div>

        <div>
          <Button type="submit" loading={busy} disabled={invalid}>
            Speichern
          </Button>
        </div>
      </form>
    </section>
  );
}
