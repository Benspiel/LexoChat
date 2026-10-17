import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { deriveAuthKey } from "@lexichat/crypto";
import type { UserRecord } from "@lexichat/shared";
import { Button, Card, Notice, TextField } from "@lexichat/ui";
import { client } from "../lib/client";
import { errorText } from "../lib/format";
import { normalizeCode } from "../lib/totp";

interface Props {
  user: UserRecord;
  /** known auth key (directly after login); otherwise the password is asked */
  authKey?: string;
  mandatory?: boolean;
  onDone: () => void;
  onCancel: () => void;
}

export function TotpSetupForm({ user, authKey, mandatory, onDone, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let key = authKey;
      if (!key) {
        const pre = await client.prelogin(user.username);
        key = await deriveAuthKey(password, pre.salt, pre.params);
        setPassword("");
      }
      const res = await client.request<{ secret: string; uri: string }>("POST", "/api/lexichat/me/totp/setup", { password: key });
      // the QR code is rendered locally - the secret never leaves the browser/server pair
      const qr = await QRCode.toDataURL(res.uri, { margin: 1, width: 200, color: { dark: "#141414", light: "#ffffff" } });
      setSetup({ secret: res.secret, qr });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.request("POST", "/api/lexichat/me/totp/enable", { code: normalizeCode(code) });
      setSetup(null);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (!setup) {
    return (
      <form className="lx-stack" onSubmit={start} noValidate>
        {error && <Notice kind="error">{error}</Notice>}
        <p>
          Sie benötigen eine Authenticator-App auf Ihrem Diensthandy (z. B. eine App, die TOTP nach RFC 6238 unterstützt). Bei jeder
          Anmeldung geben Sie zusätzlich den sechsstelligen Code aus der App ein.
        </p>
        {!authKey && (
          <TextField
            label="Passwort zur Bestätigung"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <div className="lx-row">
          <Button type="submit" loading={busy} disabled={!authKey && !password}>
            Einrichtung starten
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {mandatory ? "Abmelden" : "Abbrechen"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form className="lx-stack" onSubmit={confirm} noValidate>
      {error && <Notice kind="error">{error}</Notice>}
      <ol className="lx-stack-sm" style={{ paddingLeft: 20, margin: 0 }}>
        <li>Scannen Sie den QR-Code mit Ihrer Authenticator-App.</li>
        <li>Geben Sie den angezeigten sechsstelligen Code ein.</li>
      </ol>
      <img className="qr" src={setup.qr} alt="QR-Code für die Authenticator-App" width={200} height={200} />
      <div className="lx-stack-sm">
        <span className="lx-small lx-muted">Falls Scannen nicht möglich ist, diesen Schlüssel manuell eingeben:</span>
        <code className="lx-mono lx-tile" data-testid="totp-secret">
          {setup.secret.match(/.{1,4}/g)?.join(" ")}
        </code>
      </div>
      <TextField
        label="Code aus der App"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
      />
      <div className="lx-row">
        <Button type="submit" loading={busy} disabled={normalizeCode(code).length !== 6}>
          Aktivieren
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {mandatory ? "Abmelden" : "Abbrechen"}
        </Button>
      </div>
    </form>
  );
}

export function TotpSetupView(props: Props) {
  return (
    <main className="auth-page">
      <Card soft className="auth-card lx-soft">
        <div className="lx-stack">
          <div className="lx-stack-sm">
            <h1>Zwei-Faktor-Anmeldung einrichten.</h1>
            <p className="lx-muted">Für Administrator-Konten ist ein zweiter Faktor Pflicht.</p>
          </div>
          <TotpSetupForm {...props} />
        </div>
      </Card>
    </main>
  );
}
