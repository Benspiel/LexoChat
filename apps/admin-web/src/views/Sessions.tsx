import { useCallback, useEffect, useState } from "react";
import { filterString, type UserRecord } from "@lexichat/shared";
import { Button, Dialog, EmptyState, Notice, Spinner } from "@lexichat/ui";
import { client } from "../lib/client";
import { errorText, formatDate } from "../lib/format";

interface SessionRecord {
  id: string;
  user: string;
  client: "desktop" | "admin_web";
  device_name: string;
  created: string;
  last_seen: string;
  expires_at: string;
}

export function SessionList({ user, me }: { user: UserRecord; me: UserRecord }) {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const currentId = client.auth?.sessionId;

  const load = useCallback(async () => {
    try {
      const res = await client.list<SessionRecord>("sessions", { perPage: 100, sort: "-last_seen", filter: `user = ${filterString(user.id)}` });
      setSessions(res.items);
    } catch (err) {
      setError(errorText(err));
    }
  }, [user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function end(ids: string[]) {
    setBusy(ids.length > 1 ? "all" : (ids[0] ?? null));
    setError(null);
    try {
      for (const id of ids) await client.remove("sessions", id);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (sessions === null) return <Spinner />;
  const others = sessions.filter((s) => s.id !== currentId);

  return (
    <div className="lx-stack">
      {error && <Notice kind="error">{error}</Notice>}
      {sessions.length === 0 ? (
        <EmptyState title="Keine aktiven Sitzungen." />
      ) : (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <caption className="lx-sr-only">Aktive Sitzungen von {user.name}</caption>
            <thead>
              <tr>
                <th scope="col">Gerät</th>
                <th scope="col">Angemeldet</th>
                <th scope="col">Zuletzt aktiv</th>
                <th scope="col">
                  <span className="lx-sr-only">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.client === "admin_web" ? "Verwaltung (Browser)" : "Windows-App"}
                    {s.device_name && <span className="lx-muted"> · {s.device_name}</span>}
                    {s.id === currentId && <strong> · diese Sitzung</strong>}
                  </td>
                  <td className="lx-small">{formatDate(s.created)}</td>
                  <td className="lx-small">{formatDate(s.last_seen)}</td>
                  <td>
                    {s.id !== currentId && (
                      <Button variant="soft" size="sm" loading={busy === s.id} onClick={() => void end([s.id])}>
                        Beenden
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {others.length > 1 && (
        <div>
          <Button variant="outline" loading={busy === "all"} onClick={() => void end(others.map((s) => s.id))}>
            {user.id === me.id ? "Alle anderen Sitzungen beenden" : "Alle Sitzungen beenden"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function SessionsDialog({ open, user, me, onClose }: { open: boolean; user: UserRecord; me: UserRecord; onClose: () => void }) {
  return (
    <Dialog open={open} title={`Sitzungen von ${user.name}.`} onClose={onClose}>
      {open && <SessionList user={user} me={me} />}
    </Dialog>
  );
}
