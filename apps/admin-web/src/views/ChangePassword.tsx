import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_KDF_PARAMS, deriveAuthKey, newSalt } from "@lexichat/crypto";
import { PASSWORD_MIN_LENGTH, checkPassword, type UserRecord } from "@lexichat/shared";
import { Button, Card, Icon, Notice, TextField } from "@lexichat/ui";
import { client } from "../lib/client";
import { errorText } from "../lib/format";

interface Props {
  user: UserRecord;
  /** first login: the auth key of the one-time password is already known */
  firstLogin?: boolean;
  oldAuthKey?: string;
  onDone: () => void;
  onCancel: () => void;
}

export function PasswordForm({ user, firstLogin, oldAuthKey, onDone, onCancel }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // live policy check (debounced; the blocklist is loaded lazily)
  useEffect(() => {
    setChecked(false);
    const id = window.setTimeout(() => {
      void checkPassword(next, { username: user.username, name: user.name }).then((r) => {
        setProblems(r.problems);
        setChecked(true);
      });
    }, 200);
    return () => window.clearTimeout(id);
  }, [next, user.username, user.name]);

  const mismatch = repeat.length > 0 && repeat !== next;
  const canSubmit = checked && problems.length === 0 && next === repeat && (firstLogin || current.length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      let oldKey = oldAuthKey;
      if (!oldKey) {
        const pre = await client.prelogin(user.username);
        oldKey = await deriveAuthKey(current, pre.salt, pre.params);
      }
      const salt = await newSalt();
      const newKey = await deriveAuthKey(next, salt, DEFAULT_KDF_PARAMS);
      await client.request("POST", "/api/lexichat/me/password", {
        oldPassword: oldKey,
        newPassword: newKey,
        kdfSalt: salt,
        kdfParams: DEFAULT_KDF_PARAMS,
      });
      setCurrent("");
      setNext("");
      setRepeat("");
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="lx-stack" onSubmit={submit} noValidate>
      {error && <Notice kind="error">{error}</Notice>}
      {!firstLogin && (
        <TextField
          label="Aktuelles Passwort"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      )}
      <TextField
        label="Neues Passwort"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        hint={`Mindestens ${PASSWORD_MIN_LENGTH} Zeichen. Am besten ein Satz aus mehreren Wörtern. Sonderzeichen sind nicht vorgeschrieben.`}
        required
      />
      {next.length > 0 && (
        <ul className="lx-checklist" aria-live="polite" aria-label="Prüfung des neuen Passworts">
          {problems.map((p) => (
            <li key={p}>
              <Icon name="x" />
              <span>{p}</span>
            </li>
          ))}
          {checked && problems.length === 0 && (
            <li>
              <Icon name="check" />
              <span>Das Passwort erfüllt alle Regeln.</span>
            </li>
          )}
        </ul>
      )}
      <TextField
        label="Neues Passwort wiederholen"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={(e) => setRepeat(e.target.value)}
        error={mismatch ? "Die Passwörter stimmen nicht überein." : null}
        required
      />
      <div className="lx-row">
        <Button type="submit" loading={busy} disabled={!canSubmit}>
          Passwort ändern
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {firstLogin ? "Abmelden" : "Abbrechen"}
        </Button>
      </div>
    </form>
  );
}

export function ChangePasswordView(props: Props) {
  return (
    <main className="auth-page">
      <Card className="auth-card">
        <div className="lx-stack">
          <div className="lx-stack-sm">
            <h1>Neues Passwort festlegen.</h1>
            <p className="lx-muted">
              Sie haben sich mit einem Einmalpasswort angemeldet. Bitte legen Sie jetzt ein persönliches Passwort fest. Es verlässt
              Ihr Gerät nie im Klartext.
            </p>
          </div>
          <PasswordForm {...props} />
        </div>
      </Card>
    </main>
  );
}
