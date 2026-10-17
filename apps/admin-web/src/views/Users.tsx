import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { UserRecord } from "@lexichat/shared";
import { Avatar, Badge, Button, Dialog, EmptyState, Icon, Notice, SelectField, Spinner, TextField } from "@lexichat/ui";
import { client } from "../lib/client";
import { errorText, formatDate } from "../lib/format";
import { SessionsDialog } from "./Sessions";

type StatusFilter = "all" | "active" | "inactive" | "locked" | "setup";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "active", label: "Aktiv" },
  { value: "inactive", label: "Deaktiviert" },
  { value: "locked", label: "Vorübergehend gesperrt" },
  { value: "setup", label: "Einrichtung ausstehend" },
];

const ROLE_OPTIONS = [
  { value: "user", label: "Benutzer:in" },
  { value: "admin", label: "Administrator:in" },
];

function matchesStatus(u: UserRecord, f: StatusFilter): boolean {
  switch (f) {
    case "active":
      return !!u.active;
    case "inactive":
      return !u.active;
    case "locked":
      return !!u.locked;
    case "setup":
      return !!u.must_change_password || !u.has_keys;
    default:
      return true;
  }
}

export function UsersView({ me }: { me: UserRecord }) {
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<UserRecord | null>(null);
  const [otp, setOtp] = useState<{ user: string; password: string; reason: "created" | "reset" } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await client.list<UserRecord>("users", { perPage: 500, sort: "name" });
      setUsers(res.items);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter(
      (u) => matchesStatus(u, status) && (!q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)),
    );
  }, [users, query, status]);

  const done = (message: string) => {
    setFlash(message);
    setManaging(null);
    void load();
  };

  return (
    <section aria-labelledby="users-title">
      <div className="lx-spread page-head">
        <div className="lx-stack-sm">
          <h1 id="users-title">Benutzer.</h1>
          <p className="lx-muted">Konten anlegen, bearbeiten, sperren und Passwörter zurücksetzen. Chatinhalte sind hier nicht sichtbar.</p>
        </div>
        <Button onClick={() => setCreating(true)}>Neues Konto</Button>
      </div>

      <div className="lx-stack">
        {flash && <Notice kind="success">{flash}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}

        <div className="toolbar" role="search">
          <TextField
            className="lx-grow"
            label="Suche nach Name oder Benutzername"
            hideLabel
            placeholder="Suchen …"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SelectField label="Status" options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} />
        </div>

        {users === null ? (
          <Spinner />
        ) : visible.length === 0 ? (
          <EmptyState title="Keine Konten gefunden.">Passen Sie die Suche oder den Filter an.</EmptyState>
        ) : (
          <div className="lx-table-wrap">
            <table className="lx-table">
              <caption className="lx-sr-only">Konten ({visible.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Rolle</th>
                  <th scope="col">Status</th>
                  <th scope="col">2FA</th>
                  <th scope="col">Angelegt</th>
                  <th scope="col">
                    <span className="lx-sr-only">Aktionen</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="user-cell">
                        <Avatar name={u.name} />
                        <span className="lx-stack-sm" style={{ gap: 0 }}>
                          <span>
                            {u.name}
                            {u.id === me.id && <span className="lx-muted"> (Sie)</span>}
                          </span>
                          <span className="lx-small lx-muted">{u.username}</span>
                        </span>
                      </span>
                    </td>
                    <td>{u.role === "admin" ? "Admin" : "Benutzer:in"}</td>
                    <td>
                      <StatusBadges user={u} />
                    </td>
                    <td>{u.totp_enabled ? "Ja" : "Nein"}</td>
                    <td className="lx-small">{formatDate(u.created)}</td>
                    <td>
                      <Button variant="soft" size="sm" onClick={() => setManaging(u)} aria-label={`${u.name} verwalten`}>
                        Verwalten
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(username, password) => {
          setCreating(false);
          setOtp({ user: username, password, reason: "created" });
          void load();
        }}
      />

      {managing && (
        <ManageUserDialog
          me={me}
          user={managing}
          onClose={() => setManaging(null)}
          onDone={done}
          onPasswordReset={(password) => {
            setOtp({ user: managing.username, password, reason: "reset" });
            setManaging(null);
            void load();
          }}
        />
      )}

      <OneTimePasswordDialog data={otp} onClose={() => setOtp(null)} />
    </section>
  );
}

export function StatusBadges({ user }: { user: UserRecord }) {
  return (
    <span className="lx-row">
      {user.active ? <Badge variant="neutral">Aktiv</Badge> : <Badge variant="outline">Deaktiviert</Badge>}
      {user.locked && (
        <Badge variant="ink">
          <Icon name="lock" size={12} /> Gesperrt
        </Badge>
      )}
      {user.must_change_password && <Badge variant="outline">Erstanmeldung offen</Badge>}
      {!user.must_change_password && !user.has_keys && <Badge variant="outline">App nicht eingerichtet</Badge>}
    </span>
  );
}

// ------------------------------------------------------------------ create

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (username: string, password: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUsername("");
      setName("");
      setRole("user");
      setError(null);
    }
  }, [open]);

  const usernameValid = /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await client.request<{ username: string; oneTimePassword: string }>("POST", "/api/lexichat/admin/users", {
        username,
        name: name.trim(),
        role,
      });
      onCreated(res.username, res.oneTimePassword);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Neues Konto." onClose={onClose}>
      <form className="lx-stack" onSubmit={submit} noValidate>
        {error && <Notice kind="error">{error}</Notice>}
        <TextField label="Anzeigename" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        <TextField
          label="Benutzername"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          autoCapitalize="none"
          spellCheck={false}
          hint="3–32 Zeichen: a–z, 0–9, Punkt, Bindestrich, Unterstrich. Keine E-Mail-Adresse nötig."
          error={username && !usernameValid ? "Ungültiger Benutzername." : null}
          required
        />
        <SelectField label="Rolle" options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value)} />
        {role === "admin" && <Notice kind="warning">Administrator:innen können Konten verwalten und Passwörter zurücksetzen. Zwei-Faktor-Anmeldung ist für sie Pflicht.</Notice>}
        <div className="lx-dialog__footer">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={busy} disabled={!usernameValid || !name.trim()}>
            Konto anlegen
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ one-time password

function OneTimePasswordDialog({
  data,
  onClose,
}: {
  data: { user: string; password: string; reason: "created" | "reset" } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [data]);

  return (
    <Dialog
      open={data !== null}
      persistent
      title={data?.reason === "created" ? "Konto angelegt." : "Passwort zurückgesetzt."}
      onClose={onClose}
      footer={<Button onClick={onClose}>Ich habe das Einmalpasswort übergeben</Button>}
    >
      {data && (
        <div className="lx-stack">
          <p>
            Einmalpasswort für <strong>{data.user}</strong>. Es wird <strong>nur jetzt</strong> angezeigt und muss bei der ersten Anmeldung
            geändert werden.
          </p>
          <div className="otp-box lx-mono" data-testid="one-time-password">
            {data.password}
          </div>
          <div className="lx-row">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(data.password).then(() => setCopied(true));
              }}
            >
              <Icon name="copy" /> {copied ? "Kopiert" : "Kopieren"}
            </Button>
          </div>
          <Notice kind="info">
            Bitte persönlich oder telefonisch nach Identitätsprüfung übergeben – nicht per E-Mail und nicht über LexiChat selbst.
          </Notice>
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ manage

type Confirm =
  | { kind: "reset-password" }
  | { kind: "reset-2fa" }
  | { kind: "deactivate" }
  | { kind: "delete" };

function ManageUserDialog({
  me,
  user,
  onClose,
  onDone,
  onPasswordReset,
}: {
  me: UserRecord;
  user: UserRecord;
  onClose: () => void;
  onDone: (message: string) => void;
  onPasswordReset: (password: string) => void;
}) {
  const self = user.id === me.id;
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState<string>(user.role ?? "user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [sessions, setSessions] = useState(false);

  const changed = name.trim() !== user.name || username !== user.username || role !== user.role;

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone(message);
    } catch (err) {
      setError(errorText(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const data: Record<string, unknown> = {};
    if (name.trim() !== user.name) data["name"] = name.trim();
    if (username !== user.username) data["username"] = username;
    if (role !== user.role) data["role"] = role;
    await run(() => client.update("users", user.id, data), `Änderungen für ${name.trim()} gespeichert.`);
  }

  async function resetPassword() {
    setBusy(true);
    setError(null);
    try {
      const res = await client.request<{ oneTimePassword: string }>("POST", `/api/lexichat/admin/users/${user.id}/reset-password`);
      onPasswordReset(res.oneTimePassword);
    } catch (err) {
      setError(errorText(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={confirm === null && !sessions} title={`${user.name} verwalten.`} onClose={onClose}>
        <div className="lx-stack">
          {error && <Notice kind="error">{error}</Notice>}
          <StatusBadges user={user} />

          <form className="lx-stack" onSubmit={save} noValidate>
            <TextField label="Anzeigename" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <TextField
              label="Benutzername"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoCapitalize="none"
              spellCheck={false}
            />
            <SelectField
              label="Rolle"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={self}
              hint={self ? "Die eigene Rolle kann nicht geändert werden." : undefined}
            />
            <div>
              <Button type="submit" variant="outline" loading={busy} disabled={!changed}>
                Änderungen speichern
              </Button>
            </div>
          </form>

          <hr style={{ border: 0, borderTop: "1px solid var(--hairline)", margin: 0 }} />

          <div className="lx-stack-sm">
            <h3>Aktionen.</h3>
            <div className="lx-row">
              <Button variant="soft" size="sm" onClick={() => setSessions(true)}>
                Sitzungen
              </Button>
              {!self && (
                <Button variant="soft" size="sm" onClick={() => setConfirm({ kind: "reset-password" })}>
                  Passwort zurücksetzen
                </Button>
              )}
              {!self && user.totp_enabled && (
                <Button variant="soft" size="sm" onClick={() => setConfirm({ kind: "reset-2fa" })}>
                  2FA zurücksetzen
                </Button>
              )}
              {!self && user.locked && (
                <Button
                  variant="soft"
                  size="sm"
                  loading={busy}
                  onClick={() => void run(() => client.request("POST", `/api/lexichat/admin/users/${user.id}/unlock`), `${user.name} wurde entsperrt.`)}
                >
                  Entsperren
                </Button>
              )}
              {!self &&
                (user.active ? (
                  <Button variant="soft" size="sm" onClick={() => setConfirm({ kind: "deactivate" })}>
                    Deaktivieren
                  </Button>
                ) : (
                  <Button
                    variant="soft"
                    size="sm"
                    loading={busy}
                    onClick={() => void run(() => client.update("users", user.id, { active: true }), `${user.name} wurde reaktiviert.`)}
                  >
                    Reaktivieren
                  </Button>
                ))}
              {!self && (
                <Button variant="outline" size="sm" onClick={() => setConfirm({ kind: "delete" })}>
                  Konto löschen
                </Button>
              )}
            </div>
            {self && <p className="lx-small lx-muted">Das eigene Konto kann hier nicht gesperrt, zurückgesetzt oder gelöscht werden.</p>}
          </div>
        </div>
      </Dialog>

      <SessionsDialog open={sessions} user={user} me={me} onClose={() => setSessions(false)} />

      <ConfirmDialog
        open={confirm?.kind === "reset-password"}
        title="Passwort zurücksetzen?"
        confirmLabel="Einmalpasswort erzeugen"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void resetPassword()}
      >
        <p>{user.name} erhält ein neues Einmalpasswort. Alle Sitzungen werden sofort beendet, eine Sperre wird aufgehoben.</p>
        <Notice kind="warning">
          Wichtig: Ohne ihren persönlichen <strong>Wiederherstellungsschlüssel</strong> kann die Person ihre bisherigen Nachrichten danach
          nicht mehr lesen (Ende-zu-Ende-Verschlüsselung). Bitte vorher nachfragen. Prüfen Sie außerdem die Identität der Person
          (persönlich oder Rückruf).
        </Notice>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === "reset-2fa"}
        title="Zwei-Faktor-Anmeldung zurücksetzen?"
        confirmLabel="2FA zurücksetzen"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          void run(() => client.request("POST", `/api/lexichat/admin/users/${user.id}/reset-2fa`), `Zwei-Faktor-Anmeldung von ${user.name} zurückgesetzt.`)
        }
      >
        <p>
          Verwenden Sie dies nur, wenn das Gerät mit der Authenticator-App verloren ist. Alle Sitzungen werden beendet; Administrator:innen
          müssen 2FA bei der nächsten Anmeldung neu einrichten.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === "deactivate"}
        title="Konto deaktivieren?"
        confirmLabel="Deaktivieren"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run(() => client.update("users", user.id, { active: false }), `${user.name} wurde deaktiviert.`)}
      >
        <p>
          {user.name} wird sofort auf allen Geräten abgemeldet und kann sich nicht mehr anmelden. Nachrichten bleiben bis zum Ablauf der
          Aufbewahrungsfrist erhalten. Die Deaktivierung kann jederzeit rückgängig gemacht werden.
        </p>
      </ConfirmDialog>

      <DeleteDialog
        open={confirm?.kind === "delete"}
        user={user}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run(() => client.remove("users", user.id), `Das Konto ${user.username} wurde gelöscht.`)}
      />
    </>
  );
}

function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy,
  children,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy: boolean;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="lx-stack">{children}</div>
    </Dialog>
  );
}

function DeleteDialog({
  open,
  user,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  user: UserRecord;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [open]);
  return (
    <Dialog
      open={open}
      title="Konto endgültig löschen?"
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button onClick={onConfirm} loading={busy} disabled={typed !== user.username}>
            Endgültig löschen
          </Button>
        </>
      }
    >
      <div className="lx-stack">
        <Notice kind="warning">
          Das Konto, alle 1:1-Chats der Person und die zugehörigen Nachrichten werden unwiderruflich gelöscht – auch für die
          Gesprächspartner. Für ausscheidende Mitarbeitende ist meist <strong>Deaktivieren</strong> der richtige erste Schritt (siehe
          Löschkonzept).
        </Notice>
        <TextField
          label={`Zur Bestätigung den Benutzernamen „${user.username}“ eingeben`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
    </Dialog>
  );
}
