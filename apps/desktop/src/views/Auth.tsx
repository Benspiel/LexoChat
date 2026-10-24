import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, PASSWORD_MIN_LENGTH, checkPassword } from "@lexichat/shared";
import { Button, Card, Icon, Logomark, Notice, TextField } from "@lexichat/ui";
import {
  afterLogin,
  changeInitialPassword,
  passwordLogin,
  replaceKeys,
  restoreWithRecoveryKey,
  setupNewKeys,
  type LoginStep,
  type MyKeys,
  type NextStep,
  type Unlocked,
} from "../lib/session";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Unbekannter Fehler.";
}

export function AuthFrame({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <main className="auth-page">
      <Card soft className="auth-card lx-soft">
        <div className="lx-stack">
          <div className="lx-stack-sm">
            <span className="brand">
              <Logomark /> LexiChat
            </span>
            <h1>{title}</h1>
            {lead && <p className="lx-muted-strong">{lead}</p>}
          </div>
          {children}
        </div>
      </Card>
    </main>
  );
}

// ------------------------------------------------------------------ first start notice

export function PrivacyNotice({ onAccept }: { onAccept: () => void }) {
  return (
    <AuthFrame title="Willkommen bei LexiChat." lead="Bitte lesen Sie diese Hinweise vor der ersten Nutzung.">
      <div className="lx-stack-sm notice-text" tabIndex={0} aria-label="Datenschutzhinweise">
        <p>
          LexiChat ist der interne Messenger Ihrer Praxis. Ihr Arbeitgeber ist für die Verarbeitung verantwortlich; die vollständigen
          Informationen nach Art. 13 DSGVO erhalten Sie von der Praxisleitung bzw. im Intranet.
        </p>
        <ul>
          <li>Nachrichten sind Ende-zu-Ende-verschlüsselt. Weder Administrator:innen noch der Server können sie lesen.</li>
          <li>Gespeichert werden technisch notwendige Daten (Konto, Geräte-Sitzungen, Zeitpunkte und Absender/Empfänger von Nachrichten).</li>
          <li>Nachrichten werden nach der in der Praxis festgelegten Frist automatisch gelöscht.</li>
          <li>Lesebestätigungen, Tipp-Anzeige und Online-Status sind aus, bis Sie sie selbst einschalten.</li>
          <li>LexiChat ersetzt nicht die Patientendokumentation: Dokumentationspflichtige Inhalte gehören in das Praxisverwaltungssystem.</li>
          <li>Es gilt die Nutzungsrichtlinie Ihrer Praxis und die ärztliche Schweigepflicht (§ 203 StGB).</li>
        </ul>
        <p className="lx-small lx-muted-strong">
          Rechtsgrundlage ist in der Regel § 26 BDSG / Art. 88 DSGVO (Beschäftigungsverhältnis) bzw. Art. 9 Abs. 2 lit. h DSGVO für
          Gesundheitsdaten. Eine Einwilligung ist nicht erforderlich; dieser Hinweis dient Ihrer Information.
        </p>
      </div>
      <Button block onClick={onAccept}>
        Verstanden
      </Button>
    </AuthFrame>
  );
}

// ------------------------------------------------------------------ login

export function LoginScreen({ notice, onNext }: { notice?: string; onNext: (n: NextStep) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<LoginStep | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await passwordLogin(username, password, needsCode ? code.replace(/\D/g, "") : undefined, step ?? undefined);
      setPassword("");
      onNext(await afterLogin(s));
    } catch (err) {
      if (err instanceof ApiError && err.totpRequired) {
        // keep the derived keys of this attempt, ask for the code
        setStep((prev) => prev ?? (err as ApiError & { step?: LoginStep }).step ?? null);
        setNeedsCode(true);
        setCode("");
        if (err.status !== 401) setError(err.message);
        window.setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        setStep(null);
        setNeedsCode(false);
        setPassword("");
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Anmelden." lead="Interner Messenger Ihrer Praxis.">
      <form className="lx-stack" onSubmit={submit} noValidate>
        {notice && <Notice kind="info">{notice}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        {!needsCode ? (
          <>
            <TextField label="Benutzername" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            <TextField label="Passwort" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        ) : (
          <TextField
            ref={codeRef}
            label="Code aus der Authenticator-App"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        )}
        <Button type="submit" block loading={busy} disabled={needsCode ? code.replace(/\D/g, "").length !== 6 : !username || !password}>
          {busy ? "Anmeldung wird geprüft …" : needsCode ? "Bestätigen" : "Anmelden"}
        </Button>
      </form>
    </AuthFrame>
  );
}

// ------------------------------------------------------------------ password rules

function usePasswordCheck(pw: string, username: string, name: string) {
  const [problems, setProblems] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setChecked(false);
    const id = window.setTimeout(() => {
      void checkPassword(pw, { username, name }).then((r) => {
        setProblems(r.problems);
        setChecked(true);
      });
    }, 200);
    return () => window.clearTimeout(id);
  }, [pw, username, name]);
  return { problems, ok: checked && problems.length === 0, checked };
}

export function NewPasswordFields({
  username,
  name,
  value,
  repeat,
  onValue,
  onRepeat,
}: {
  username: string;
  name: string;
  value: string;
  repeat: string;
  onValue: (v: string) => void;
  onRepeat: (v: string) => void;
}) {
  const { problems, ok } = usePasswordCheck(value, username, name);
  return (
    <>
      <TextField
        label="Neues Passwort"
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(e) => onValue(e.target.value)}
        hint={`Mindestens ${PASSWORD_MIN_LENGTH} Zeichen, am besten ein Satz aus mehreren Wörtern.`}
      />
      {value && (
        <ul className="lx-checklist" aria-live="polite" aria-label="Prüfung des neuen Passworts">
          {problems.map((p) => (
            <li key={p}>
              <Icon name="x" /> <span>{p}</span>
            </li>
          ))}
          {ok && (
            <li>
              <Icon name="check" /> <span>Das Passwort erfüllt alle Regeln.</span>
            </li>
          )}
        </ul>
      )}
      <TextField
        label="Neues Passwort wiederholen"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={(e) => onRepeat(e.target.value)}
        error={repeat && repeat !== value ? "Die Passwörter stimmen nicht überein." : null}
      />
    </>
  );
}

export function usePasswordValid(pw: string, repeat: string, username: string, name: string) {
  const { ok } = usePasswordCheck(pw, username, name);
  return ok && pw === repeat;
}

// ------------------------------------------------------------------ first login: new password

export function ChangeInitialPassword({ step, onRecoveryKey, onNext }: { step: LoginStep; onRecoveryKey: (key: string, relogin: () => Promise<NextStep>) => void; onNext: (n: NextStep | { kind: "login"; notice: string }) => void }) {
  const [pw, setPw] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = step.login.record;
  const valid = usePasswordValid(pw, repeat, user.username, user.name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const keysRes = await fetchHasKeys();
      const { recoveryKey } = await changeInitialPassword(step, pw, keysRes);
      const relogin = async (): Promise<NextStep> => afterLogin(await passwordLogin(user.username, pw));
      if (recoveryKey) onRecoveryKey(recoveryKey, relogin);
      else {
        try {
          onNext(await relogin());
        } catch (err) {
          onNext({ kind: "login", notice: err instanceof ApiError && err.totpRequired ? "Passwort geändert. Bitte melden Sie sich mit Code an." : errorText(err) });
        }
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function fetchHasKeys(): Promise<boolean> {
    const { fetchMyKeys } = await import("../lib/session");
    return !!(await fetchMyKeys()).publicEncKey;
  }

  return (
    <AuthFrame title="Neues Passwort festlegen." lead="Sie haben sich mit einem Einmalpasswort angemeldet. Ihr Passwort schützt auch Ihre Chat-Schlüssel und verlässt dieses Gerät nie.">
      <form className="lx-stack" onSubmit={submit} noValidate>
        {error && <Notice kind="error">{error}</Notice>}
        <NewPasswordFields username={user.username} name={user.name} value={pw} repeat={repeat} onValue={setPw} onRepeat={setRepeat} />
        <Button type="submit" block loading={busy} disabled={!valid}>
          {busy ? "Schlüssel werden erzeugt …" : "Passwort festlegen"}
        </Button>
      </form>
    </AuthFrame>
  );
}

// ------------------------------------------------------------------ recovery key display

export function RecoveryKeyScreen({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => Promise<void> | void }) {
  const groups = recoveryKey.split("-");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastGroup = groups[groups.length - 1] ?? "";
  return (
    <AuthFrame
      title="Ihr Wiederherstellungsschlüssel."
      lead="Wird Ihr Passwort zurückgesetzt, können Sie Ihre Nachrichten nur mit diesem Schlüssel wieder lesen. Er wird nur jetzt angezeigt."
    >
      <div className="recovery-key lx-mono" data-testid="recovery-key" aria-label="Wiederherstellungsschlüssel">
        {groups.map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </div>
      <Notice kind="warning">
        Schreiben Sie den Schlüssel auf Papier und bewahren Sie ihn verschlossen auf (nicht am Bildschirm, nicht in E-Mails, nicht in
        LexiChat). Die Praxis kann ihn nicht wiederherstellen.
      </Notice>
      {error && <Notice kind="error">{error}</Notice>}
      <TextField
        label="Zur Kontrolle: die letzte Vierergruppe eingeben"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value.toUpperCase())}
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={4}
      />
      <Button
        block
        loading={busy}
        disabled={confirm !== lastGroup}
        onClick={async () => {
          setBusy(true);
          try {
            await onDone();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Ich habe den Schlüssel sicher notiert
      </Button>
    </AuthFrame>
  );
}

// ------------------------------------------------------------------ account without keys

export function SetupKeys({ step, onRecoveryKey }: { step: LoginStep; onRecoveryKey: (key: string, next: () => Promise<NextStep>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthFrame title="LexiChat einrichten." lead="Für Ihr Konto werden jetzt die persönlichen Schlüssel für die Ende-zu-Ende-Verschlüsselung erzeugt.">
      {error && <Notice kind="error">{error}</Notice>}
      <Button
        block
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const key = await setupNewKeys(step);
            onRecoveryKey(key, () => afterLogin(step));
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Schlüssel erzeugen
      </Button>
    </AuthFrame>
  );
}

// ------------------------------------------------------------------ restore after admin reset

export function RestoreKeys({ step, keys, onNext, onRecoveryKey }: { step: LoginStep; keys: MyKeys; onNext: (n: NextStep) => void; onRecoveryKey: (key: string, next: () => Promise<NextStep>) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  return (
    <AuthFrame title="Schlüssel wiederherstellen." lead="Ihr Passwort wurde zurückgesetzt. Mit Ihrem Wiederherstellungsschlüssel bleiben alle bisherigen Nachrichten lesbar.">
      {error && <Notice kind="error">{error}</Notice>}
      {!confirmNew ? (
        <form
          className="lx-stack"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await restoreWithRecoveryKey(step, keys, text);
              onNext(await afterLogin(step));
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextField label="Wiederherstellungsschlüssel" value={text} onChange={(e) => setText(e.target.value)} autoCapitalize="characters" spellCheck={false} hint="56 Zeichen in Vierergruppen, Groß-/Kleinschreibung egal." />
          <Button type="submit" block loading={busy} disabled={text.replace(/[^a-z0-9]/gi, "").length < 56}>
            Wiederherstellen
          </Button>
          <Button variant="ghost" block onClick={() => setConfirmNew(true)}>
            Ich habe keinen Wiederherstellungsschlüssel
          </Button>
        </form>
      ) : (
        <div className="lx-stack">
          <Notice kind="warning">
            Ohne Wiederherstellungsschlüssel werden neue Schlüssel erzeugt. <strong>Ihre bisherigen Nachrichten können Sie dann nicht mehr lesen.</strong>{" "}
            Ihre Kontakte sehen einen Hinweis, dass sich Ihre Sicherheitsnummer geändert hat.
          </Notice>
          <Button
            block
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const key = await replaceKeys(step);
                onRecoveryKey(key, () => afterLogin(step));
              } catch (err) {
                setError(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Neue Schlüssel erzeugen
          </Button>
          <Button variant="ghost" block onClick={() => setConfirmNew(false)}>
            Zurück
          </Button>
        </div>
      )}
    </AuthFrame>
  );
}

// ------------------------------------------------------------------ lock screen

export function LockScreen({ name, onUnlock, onLogout }: { name: string; onUnlock: () => Promise<void>; onLogout: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <AuthFrame title="LexiChat ist gesperrt." lead={`Angemeldet als ${name}. Inhalte sind ausgeblendet, bis Sie entsperren.`}>
      <div className="lx-stack">
        <Button
          block
          loading={busy}
          autoFocus
          onClick={async () => {
            setBusy(true);
            try {
              await onUnlock();
            } finally {
              setBusy(false);
            }
          }}
        >
          Entsperren
        </Button>
        <Button variant="ghost" block onClick={onLogout}>
          Abmelden
        </Button>
      </div>
    </AuthFrame>
  );
}

export type { Unlocked };
