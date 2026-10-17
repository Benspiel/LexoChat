import { useCallback, useEffect, useState } from "react";
import type { UserRecord } from "@lexichat/shared";
import { client, sessionEvents } from "./lib/client";
import { useIdleTimeout, useInterval } from "./lib/hooks";
import { LoginView, type LoginSuccess } from "./views/Login";
import { ChangePasswordView } from "./views/ChangePassword";
import { TotpSetupView } from "./views/TotpSetup";
import { Shell } from "./views/Shell";

/** Idle timeout of the admin web app (minutes). */
const IDLE_MINUTES = 15;

type Phase =
  | { name: "login"; notice?: string }
  | { name: "changePassword"; authKey: string; user: UserRecord }
  | { name: "totpSetup"; authKey: string; user: UserRecord }
  | { name: "app"; user: UserRecord };

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: "login" });

  const toLogin = useCallback((notice?: string) => {
    void client.logout();
    setPhase({ name: "login", notice });
  }, []);

  useEffect(() => {
    sessionEvents.onExpired = () => setPhase({ name: "login", notice: "Ihre Sitzung ist abgelaufen oder wurde beendet. Bitte melden Sie sich erneut an." });
  }, []);

  // closing the tab ends the server session as well
  useEffect(() => {
    const onHide = () => {
      if (client.auth) void client.logout();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const loggedIn = phase.name !== "login";
  useIdleTimeout(IDLE_MINUTES, () => {
    if (loggedIn) toLogin(`Sie wurden nach ${IDLE_MINUTES} Minuten Inaktivität abgemeldet.`);
  });
  useInterval(10, () => {
    if (client.auth) client.refresh().catch(() => {});
  });

  const onLogin = (res: LoginSuccess) => {
    if (res.mustChangePassword) setPhase({ name: "changePassword", authKey: res.authKey, user: res.user });
    else if (res.totpSetupRequired) setPhase({ name: "totpSetup", authKey: res.authKey, user: res.user });
    else setPhase({ name: "app", user: res.user });
  };

  switch (phase.name) {
    case "login":
      return <LoginView notice={phase.notice} onSuccess={onLogin} />;
    case "changePassword":
      return (
        <ChangePasswordView
          firstLogin
          user={phase.user}
          oldAuthKey={phase.authKey}
          onDone={() => toLogin("Ihr Passwort wurde geändert. Bitte melden Sie sich mit dem neuen Passwort an.")}
          onCancel={() => toLogin()}
        />
      );
    case "totpSetup":
      return (
        <TotpSetupView
          mandatory
          user={phase.user}
          authKey={phase.authKey}
          onDone={() => setPhase({ name: "app", user: phase.user })}
          onCancel={() => toLogin()}
        />
      );
    case "app":
      return <Shell user={phase.user} onLogout={() => toLogin("Sie wurden abgemeldet.")} />;
  }
}
