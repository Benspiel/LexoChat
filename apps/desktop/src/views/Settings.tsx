import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { fingerprint } from "@lexichat/crypto";
import { filterString } from "@lexichat/shared";
import { Avatar, Button, Dialog, Notice, SelectField, Segmented, Spinner, TextField, Toggle } from "@lexichat/ui";
import { autostart, checkForUpdate, setCaptureProtection } from "../lib/platform";
import { changePassword, client, remember, forget, renewRecoveryKey, type Unlocked } from "../lib/session";
import { getState, updateLocal, updatePrefs, updateProfile, useStore } from "../lib/store";
import { NewPasswordFields, usePasswordValid } from "./Auth";
import { getUnlocked, setUnlocked } from "./unlockedRef";

export type SettingsSection = "profile" | "password" | "security" | "privacy" | "app";

const SECTIONS: { value: SettingsSection; label: string }[] = [
  { value: "profile", label: "Profil" },
  { value: "password", label: "Passwort" },
  { value: "security", label: "Sicherheit" },
  { value: "privacy", label: "Privatsphäre" },
  { value: "app", label: "App" },
];

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "Fehler.";
}

export function SettingsDialog({
  section,
  onSection,
  onClose,
  onLogout,
}: {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  onLock: () => void;
  onLogout: () => void;
}) {
  return (
    <Dialog open title="Einstellungen." onClose={onClose}>
      <div className="lx-stack">
        <Segmented label="Bereich" options={SECTIONS} value={section} onChange={onSection} />
        {section === "profile" && <ProfileSection />}
        {section === "password" && <PasswordSection onLogout={onLogout} />}
        {section === "security" && <SecuritySection />}
        {section === "privacy" && <PrivacySection />}
        {section === "app" && <AppSection />}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ profile

function ProfileSection() {
  const me = useStore((s) => s.me);
  const [name, setName] = useState(me?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "success", text: ok });
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lx-stack">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <form
        className="lx-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateProfile({ name: name.trim() }), "Anzeigename gespeichert.");
        }}
      >
        <TextField label="Anzeigename" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <div>
          <Button type="submit" variant="outline" loading={busy} disabled={!name.trim() || name.trim() === me?.name}>
            Speichern
          </Button>
        </div>
      </form>
      <div className="lx-row">
        <Avatar name={me?.name ?? "?"} size={48} />
        <label className="lx-btn lx-btn--soft lx-btn--sm" style={{ cursor: "pointer" }}>
          Avatar hochladen
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="lx-sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 512 * 1024) {
                setMsg({ kind: "error", text: "Das Bild ist größer als 512 KB." });
                return;
              }
              void run(() => updateProfile({ avatar: f }), "Avatar gespeichert.");
            }}
          />
        </label>
        <Button variant="ghost" size="sm" onClick={() => void run(() => updateProfile({ avatar: null }), "Avatar entfernt.")}>
          Entfernen
        </Button>
      </div>
      <p className="lx-small lx-muted">JPEG, PNG oder WebP bis 512 KB. Sichtbar nur für angemeldete Kolleg:innen.</p>
    </div>
  );
}

// ------------------------------------------------------------------ password

function PasswordSection({ onLogout }: { onLogout: () => void }) {
  const me = useStore((s) => s.me);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const valid = usePasswordValid(next, repeat, me?.username ?? "", me?.name ?? "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const u = getUnlocked();
    if (!u) return;
    setBusy(true);
    setMsg(null);
    try {
      const updated: Unlocked = await changePassword(u, current, next);
      setUnlocked(updated);
      if (getState().local.local.rememberMe) await remember(updated);
      setCurrent("");
      setNext("");
      setRepeat("");
      setMsg({ kind: "success", text: "Passwort geändert. Andere Geräte wurden abgemeldet." });
    } catch (err) {
      const text = errorText(err);
      setMsg({ kind: "error", text });
      if (text.includes("neu an")) onLogout();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="lx-stack" onSubmit={submit} noValidate>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <TextField label="Aktuelles Passwort" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <NewPasswordFields username={me?.username ?? ""} name={me?.name ?? ""} value={next} repeat={repeat} onValue={setNext} onRepeat={setRepeat} />
      <p className="lx-small lx-muted">Ihre Chat-Schlüssel werden mit dem neuen Passwort neu verschlüsselt. Alle anderen Geräte werden abgemeldet.</p>
      <div>
        <Button type="submit" loading={busy} disabled={!valid || !current}>
          Passwort ändern
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ security

interface SessionRecord {
  id: string;
  client: string;
  device_name: string;
  created: string;
  last_seen: string;
}

function SecuritySection() {
  const me = useStore((s) => s.me);
  const identity = useStore((s) => s.identity);
  const settings = useStore((s) => s.settings);
  const capture = useStore((s) => s.local.local.captureProtection);
  const [fp, setFp] = useState("");
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [totp, setTotp] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [totpEnabled, setTotpEnabled] = useState<boolean>(!!me?.two_factor);

  useEffect(() => {
    if (identity) void fingerprint(identity.encPublic, identity.signPublic).then(setFp);
  }, [identity]);

  const loadSessions = () =>
    client
      .list<SessionRecord>("sessions", { perPage: 50, sort: "-last_seen", filter: `user = ${filterString(me?.id ?? "")}` })
      .then((r) => setSessions(r.items))
      .catch(() => setSessions([]));
  useEffect(() => {
    void loadSessions();
  }, []);

  return (
    <div className="lx-stack">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <section className="lx-stack-sm">
        <h3>Ihr Fingerabdruck.</h3>
        <p className="lx-small lx-muted">Teil Ihrer Sicherheitsnummer. Kontakte können ihn mit Ihnen vergleichen.</p>
        <div className="safety-number lx-mono">{fp ? fp.split(" ").map((g, i) => <span key={i}>{g}</span>) : <Spinner />}</div>
      </section>

      <section className="lx-stack-sm">
        <h3>Wiederherstellungsschlüssel.</h3>
        {recovery ? (
          <>
            <div className="recovery-key lx-mono">{recovery.split("-").map((g, i) => <span key={i}>{g}</span>)}</div>
            <Notice kind="warning">Der alte Schlüssel ist ab sofort ungültig. Bitte notieren Sie den neuen Schlüssel und bewahren Sie ihn sicher auf.</Notice>
            <div>
              <Button variant="outline" onClick={() => setRecovery(null)}>
                Ich habe ihn notiert
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button
              variant="soft"
              onClick={async () => {
                const u = getUnlocked();
                if (!u) return;
                try {
                  setRecovery(await renewRecoveryKey(u));
                } catch (err) {
                  setMsg({ kind: "error", text: errorText(err) });
                }
              }}
            >
              Neuen Wiederherstellungsschlüssel erzeugen
            </Button>
          </div>
        )}
      </section>

      {(me?.role === "admin" || settings?.allow_2fa_users) && (
        <section className="lx-stack-sm">
          <h3>Zwei-Faktor-Anmeldung.</h3>
          {totpEnabled ? (
            <p className="lx-small">Aktiv. Bei Verlust des Geräts kann die Verwaltung sie zurücksetzen.</p>
          ) : totp ? (
            <>
              <img src={totp.qr} alt="QR-Code für die Authenticator-App" width={180} height={180} className="qr" />
              <code className="lx-mono lx-tile">{totp.secret.match(/.{1,4}/g)?.join(" ")}</code>
              <TextField label="Code aus der App" inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
              <div>
                <Button
                  disabled={code.replace(/\D/g, "").length !== 6}
                  onClick={async () => {
                    try {
                      await client.request("POST", "/api/lexichat/me/totp/enable", { code: code.replace(/\D/g, "") });
                      setTotp(null);
                      setTotpEnabled(true);
                      setMsg({ kind: "success", text: "Zwei-Faktor-Anmeldung eingerichtet." });
                    } catch (err) {
                      setMsg({ kind: "error", text: errorText(err) });
                    }
                  }}
                >
                  Aktivieren
                </Button>
              </div>
            </>
          ) : (
            <form
              className="lx-row"
              onSubmit={async (e) => {
                e.preventDefault();
                const u = getUnlocked();
                if (!u) return;
                try {
                  const { deriveAuthKey } = await import("@lexichat/crypto");
                  const key = await deriveAuthKey(pw, u.kdf.salt, u.kdf.params);
                  const res = await client.request<{ secret: string; uri: string }>("POST", "/api/lexichat/me/totp/setup", { password: key });
                  setTotp({ secret: res.secret, qr: await QRCode.toDataURL(res.uri, { margin: 1, width: 180 }) });
                  setPw("");
                } catch (err) {
                  setMsg({ kind: "error", text: errorText(err) });
                }
              }}
            >
              <TextField className="lx-grow" label="Passwort zur Bestätigung" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <Button type="submit" variant="outline" disabled={!pw}>
                Einrichten
              </Button>
            </form>
          )}
        </section>
      )}

      <section className="lx-stack-sm">
        <h3>Bildschirmschutz.</h3>
        <Toggle
          checked={capture}
          label="Vor Bildschirmaufnahmen schützen"
          description="Das Fenster erscheint in Screenshots und Bildschirmfreigaben schwarz. Abfotografieren des Bildschirms lässt sich technisch nicht verhindern."
          onChange={async (v) => {
            const ok = await setCaptureProtection(v);
            await updateLocal({ captureProtection: v });
            if (v && !ok) setMsg({ kind: "info", text: "Nur in der Windows-App verfügbar." });
          }}
        />
      </section>

      <section className="lx-stack-sm">
        <h3>Angemeldete Geräte.</h3>
        {sessions === null ? (
          <Spinner />
        ) : (
          <ul className="lx-stack-sm">
            {sessions.map((s) => (
              <li key={s.id} className="lx-spread lx-tile">
                <span className="lx-small">
                  {s.client === "admin_web" ? "Verwaltung (Browser)" : "Windows-App"} {s.device_name && `· ${s.device_name}`}
                  {s.id === client.auth?.sessionId && <strong> · dieses Gerät</strong>}
                  <br />
                  <span className="lx-caption lx-muted-strong">zuletzt aktiv {new Date(s.last_seen.replace(" ", "T")).toLocaleString("de-DE")}</span>
                </span>
                {s.id !== client.auth?.sessionId && (
                  <Button variant="outline" size="sm" onClick={() => void client.remove("sessions", s.id).then(loadSessions)}>
                    Abmelden
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ privacy & notifications

function PrivacySection() {
  const prefs = useStore((s) => s.prefs);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Parameters<typeof updatePrefs>[0]) => void updatePrefs(p).catch((e: unknown) => setError(errorText(e)));
  return (
    <div className="lx-stack">
      {error && <Notice kind="error">{error}</Notice>}
      <p className="lx-small lx-muted">Alles ist standardmäßig ausgeschaltet (Datenschutz durch Voreinstellung).</p>
      <Toggle checked={prefs.readReceipts} onChange={(v) => set({ readReceipts: v })} label="Lesebestätigungen senden" description="Sonst sehen andere nur „zugestellt“." />
      <Toggle checked={prefs.typing} onChange={(v) => set({ typing: v })} label="Tipp-Anzeige" description="Nur gegenseitig: Sie sehen sie nur, wenn Sie sie selbst teilen." />
      <Toggle checked={prefs.presence} onChange={(v) => set({ presence: v })} label="Online-Status teilen" description="Nur gegenseitig sichtbar." />
      <Toggle checked={prefs.listPreview} onChange={(v) => set({ listPreview: v })} label="Nachrichtenvorschau in der Chatliste" description="Aus empfohlen, wenn andere auf Ihren Bildschirm sehen können." />
      <SelectField
        label="Inhalt von Windows-Benachrichtigungen"
        value={prefs.notificationContent}
        onChange={(e) => set({ notificationContent: e.target.value as "none" | "sender" | "full" })}
        options={[
          { value: "none", label: "Nur „Neue Nachricht“ (empfohlen)" },
          { value: "sender", label: "Mit Absender" },
          { value: "full", label: "Mit Absender und Text" },
        ]}
        hint="Inhalte können sonst auf dem Bildschirm oder Sperrbildschirm für andere sichtbar werden."
      />
    </div>
  );
}

// ------------------------------------------------------------------ app & data

function AppSection() {
  const remembered = useStore((s) => s.local.local.rememberMe);
  const [auto, setAuto] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  useEffect(() => {
    void autostart.isEnabled().then(setAuto);
  }, []);
  return (
    <div className="lx-stack">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Toggle
        checked={remembered}
        label="Angemeldet bleiben"
        description="Die Sitzung wird im Windows-Anmeldeinformationsspeicher abgelegt. Beim Start ist trotzdem Ihr Passwort nötig (lokal, ohne Server)."
        onChange={async (v) => {
          await updateLocal({ rememberMe: v });
          const u = getUnlocked();
          if (v && u) await remember(u);
          else await forget();
        }}
      />
      <Toggle
        checked={auto}
        label="Beim Windows-Start öffnen"
        onChange={async (v) => {
          await autostart.set(v);
          setAuto(v);
        }}
      />
      <div className="lx-row">
        <Button
          variant="soft"
          onClick={async () => {
            try {
              const u = await checkForUpdate();
              if (!u) setMsg({ kind: "info", text: "LexiChat ist aktuell (oder Updates sind in dieser Umgebung nicht verfügbar)." });
              else {
                setMsg({ kind: "info", text: `Version ${u.version} wird installiert …` });
                await u.install();
              }
            } catch (err) {
              setMsg({ kind: "error", text: errorText(err) });
            }
          }}
        >
          Nach Updates suchen
        </Button>
        <Button
          variant="soft"
          onClick={async () => {
            try {
              const data = await client.request<unknown>("GET", "/api/lexichat/me/export");
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "lexichat-datenauskunft.json";
              a.click();
              URL.revokeObjectURL(a.href);
              setMsg({ kind: "success", text: "Datenauskunft gespeichert." });
            } catch (err) {
              setMsg({ kind: "error", text: errorText(err) });
            }
          }}
        >
          Meine Daten exportieren
        </Button>
      </div>
      <p className="lx-small lx-muted">
        Der Export enthält alle Daten, die der Server über Sie speichert (Art. 15/20 DSGVO). Nachrichteninhalte kennt der Server nicht – sie
        sind Ende-zu-Ende-verschlüsselt.
      </p>
    </div>
  );
}
