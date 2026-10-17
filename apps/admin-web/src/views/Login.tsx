import { useRef, useState, type FormEvent } from "react";
import { deriveAuthKey } from "@lexichat/crypto";
import { ApiError, type UserRecord } from "@lexichat/shared";
import { Button, Card, Logomark, Notice, TextField } from "@lexichat/ui";
import { client } from "../lib/client";
import { errorText } from "../lib/format";
import { normalizeCode } from "../lib/totp";

export interface LoginSuccess {
  user: UserRecord;
  /** derived auth key (kept in memory only until the follow-up step is done) */
  authKey: string;
  mustChangePassword: boolean;
  totpSetupRequired: boolean;
}

export function LoginView({ notice, onSuccess }: { notice?: string; onSuccess: (r: LoginSuccess) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [authKey, setAuthKey] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = username.trim().toLowerCase();
      let key = authKey;
      if (!key) {
        const pre = await client.prelogin(user);
        key = await deriveAuthKey(password, pre.salt, pre.params);
        setAuthKey(key);
        setPassword(""); // the raw password is not needed anymore
      }
      const res = await client.login(user, key, needsCode ? normalizeCode(code) : undefined);
      if (res.record.role !== "admin") {
        await client.logout();
        throw new Error("Die Verwaltungsoberfläche ist nur für Administratorinnen und Administratoren zugänglich.");
      }
      onSuccess({ user: res.record, authKey: key, mustChangePassword: res.mustChangePassword, totpSetupRequired: res.totpSetupRequired });
    } catch (err) {
      if (err instanceof ApiError && err.totpRequired) {
        setNeedsCode(true);
        setCode("");
        if (err.status !== 401) setError(err.message);
        window.setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        // start over: wrong credentials, locked account, ...
        setAuthKey(null);
        setNeedsCode(false);
        setPassword("");
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <Card soft className="auth-card lx-soft">
        <form className="lx-stack" onSubmit={submit} noValidate>
          <div className="lx-stack-sm">
            <span className="app-brand">
              <Logomark /> LexiChat
            </span>
            <h1>Verwaltung.</h1>
            <p className="lx-muted">Anmeldung nur für Administratorinnen und Administratoren.</p>
          </div>

          {notice && <Notice kind="info">{notice}</Notice>}
          {error && <Notice kind="error">{error}</Notice>}

          {!needsCode ? (
            <>
              <TextField
                label="Benutzername"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
              <TextField
                label="Passwort"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </>
          ) : (
            <TextField
              ref={codeRef}
              label="Code aus der Authenticator-App"
              name="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              hint="Sechsstelliger Code, der sich alle 30 Sekunden ändert."
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          )}

          <Button type="submit" block loading={busy} disabled={needsCode ? normalizeCode(code).length !== 6 : !username || !password}>
            {busy ? "Anmeldung wird geprüft …" : needsCode ? "Bestätigen" : "Anmelden"}
          </Button>
          {needsCode && (
            <Button
              variant="ghost"
              block
              onClick={() => {
                setNeedsCode(false);
                setAuthKey(null);
                setError(null);
              }}
            >
              Zurück
            </Button>
          )}
        </form>
      </Card>
    </main>
  );
}
