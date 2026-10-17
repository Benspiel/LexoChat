import { useEffect, useState } from "react";
import type { UserRecord } from "@lexichat/shared";
import { Badge, Button, Card, Notice } from "@lexichat/ui";
import { client } from "../lib/client";
import { PasswordForm } from "./ChangePassword";
import { SessionList } from "./Sessions";
import { TotpSetupForm } from "./TotpSetup";

export function AccountView({ me, onLogout }: { me: UserRecord; onLogout: () => void }) {
  const [profile, setProfile] = useState<UserRecord>(me);
  const [mode, setMode] = useState<"view" | "password" | "totp">("view");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    client
      .request<UserRecord>("GET", `/api/collections/users/records/${me.id}`)
      .then(setProfile)
      .catch(() => {});
  }, [me.id, mode]);

  return (
    <section aria-labelledby="account-title" className="lx-stack">
      <div className="lx-stack-sm page-head">
        <h1 id="account-title">Mein Konto.</h1>
        <p className="lx-muted">
          {profile.name} · {profile.username}
        </p>
      </div>
      {notice && <Notice kind="success">{notice}</Notice>}

      <Card>
        <div className="lx-stack">
          <div className="lx-spread">
            <h2>Passwort.</h2>
          </div>
          {profile.has_keys ? (
            <p className="lx-muted">
              Ihr Passwort schützt auch Ihre Chat-Schlüssel. Ändern Sie es deshalb bitte in der LexiChat-App für Windows – nur dort
              werden die Schlüssel neu verschlüsselt.
            </p>
          ) : mode === "password" ? (
            <PasswordForm
              user={profile}
              onDone={() => {
                setMode("view");
                onLogout();
              }}
              onCancel={() => setMode("view")}
            />
          ) : (
            <div>
              <Button variant="outline" onClick={() => setMode("password")}>
                Passwort ändern
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="lx-stack">
          <div className="lx-spread">
            <h2>Zwei-Faktor-Anmeldung.</h2>
            {profile.two_factor ? <Badge variant="ink">Aktiv</Badge> : <Badge variant="outline">Nicht eingerichtet</Badge>}
          </div>
          {profile.two_factor ? (
            <p className="lx-muted">Bei Verlust des Geräts kann eine andere Administratorin bzw. ein anderer Administrator die 2FA zurücksetzen.</p>
          ) : mode === "totp" ? (
            <TotpSetupForm
              user={profile}
              onDone={() => {
                setMode("view");
                setNotice("Zwei-Faktor-Anmeldung eingerichtet.");
              }}
              onCancel={() => setMode("view")}
            />
          ) : (
            <div>
              <Button variant="outline" onClick={() => setMode("totp")}>
                Einrichten
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="lx-stack">
          <h2>Angemeldete Geräte.</h2>
          <SessionList user={profile} me={me} />
        </div>
      </Card>
    </section>
  );
}
