import { useState } from "react";
import type { UserRecord } from "@lexichat/shared";
import { Avatar, Button, Icon } from "@lexichat/ui";
import { UsersView } from "./Users";
import { AuditView } from "./Audit";
import { SettingsView } from "./Settings";
import { AccountView } from "./Account";

const TABS = [
  { id: "users", label: "Benutzer" },
  { id: "audit", label: "Audit-Log" },
  { id: "settings", label: "Einstellungen" },
  { id: "account", label: "Mein Konto" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export function Shell({ user, onLogout }: { user: UserRecord; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="app">
      <a className="lx-sr-only" href="#main">
        Zum Inhalt springen
      </a>
      <header className="app-header">
        <div className="app-header__inner">
          <span className="app-brand">
            <Icon name="shield" size={20} /> LexiChat Verwaltung
          </span>
          <nav aria-label="Hauptnavigation" className="lx-nav lx-grow">
            {TABS.map((t) => (
              <button key={t.id} type="button" className="lx-nav__item" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <span className="lx-row">
            <Avatar name={user.name} size={28} />
            <span className="lx-small">{user.name}</span>
            <Button variant="outline" size="sm" onClick={onLogout}>
              <Icon name="logout" /> Abmelden
            </Button>
          </span>
        </div>
      </header>

      <main id="main" className="app-main" tabIndex={-1}>
        {tab === "users" && <UsersView me={user} />}
        {tab === "audit" && <AuditView />}
        {tab === "settings" && <SettingsView />}
        {tab === "account" && <AccountView me={user} onLogout={onLogout} />}
      </main>

      <footer className="app-footer">
        <div className="app-footer__inner lx-spread">
          <span>
            Datenschutz: Diese Oberfläche setzt keine Cookies und speichert nichts im Browser. Die Anmeldung besteht nur im Arbeitsspeicher
            dieses Tabs und endet beim Schließen.
          </span>
          <span>Chatinhalte sind Ende-zu-Ende-verschlüsselt und hier nicht einsehbar.</span>
        </div>
      </footer>
    </div>
  );
}
