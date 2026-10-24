import { useCallback, useEffect, useState } from "react";
import { wipeIdentity } from "@lexichat/crypto";
import { Spinner } from "@lexichat/ui";
import { localCache, onNativeEvent, setCaptureProtection } from "./lib/platform";
import { loadRemembered, logout, remember, resume, sessionEvents, unlockFromDevice, type NextStep, type Unlocked } from "./lib/session";
import { getState, lock as lockStore, setWindowFocused, start, stop, unlock as unlockStore } from "./lib/store";
import { ChangeInitialPassword, LockScreen, LoginScreen, PrivacyNotice, RecoveryKeyScreen, RestoreKeys, SetupKeys } from "./views/Auth";
import { Main } from "./views/Main";
import { getUnlocked, setUnlocked } from "./views/unlockedRef";

type Phase =
  | { name: "boot" }
  | { name: "notice" }
  | { name: "login"; notice?: string }
  | { name: "flow"; next: NextStep }
  | { name: "recovery"; key: string; continueWith: () => Promise<NextStep> }
  | { name: "app"; locked: boolean };

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: "boot" });

  const toLogin = useCallback(async (notice?: string) => {
    const u = getUnlocked();
    if (u) await wipeIdentity(u.identity);
    setUnlocked(null);
    stop();
    await logout().catch(() => {});
    setPhase({ name: "login", notice });
  }, []);

  const enterApp = useCallback(async (u: Unlocked, fresh: boolean) => {
    setUnlocked(u);
    setPhase({ name: "app", locked: false });
    // "einmal anmelden": after a password login the device remembers the login
    if (fresh) await remember(u);
    await start(u.user, u.identity);
    if (getState().local.local.captureProtection) await setCaptureProtection(true);
  }, []);

  // boot: privacy notice once, then the remembered login (no password) or the login form
  useEffect(() => {
    sessionEvents.onExpired = () => void toLogin("Ihre Sitzung ist abgelaufen oder wurde beendet. Bitte melden Sie sich erneut an.");
    void (async () => {
      const accepted = await localCache.read<boolean>("notice-v1", false);
      if (!accepted) return setPhase({ name: "notice" });
      const r = await loadRemembered();
      if (!r) return setPhase({ name: "login" });
      try {
        await enterApp(await resume(r), false);
      } catch (err) {
        setPhase({ name: "login", notice: err instanceof Error ? err.message : undefined });
      }
    })();
  }, [toLogin, enterApp]);

  const handleNext = useCallback(
    (n: NextStep | { kind: "login"; notice: string }) => {
      if (n.kind === "login") return void toLogin(n.notice);
      if (n.kind === "ready") return void enterApp(n.unlocked, true);
      setPhase({ name: "flow", next: n });
    },
    [enterApp, toLogin],
  );

  const lockNow = useCallback(() => {
    const u = getUnlocked();
    if (!u) return;
    void wipeIdentity(u.identity);
    lockStore();
    setPhase({ name: "app", locked: true });
  }, []);

  // inactivity lock (minutes from the practice settings)
  const locked = phase.name === "app" && phase.locked;
  const inApp = phase.name === "app";
  useEffect(() => {
    if (!inApp || locked) return;
    let timer = 0;
    const reset = () => {
      window.clearTimeout(timer);
      const minutes = getState().settings?.desktop_lock_minutes ?? 10;
      timer = window.setTimeout(lockNow, minutes * 60_000);
    };
    const evs = ["mousedown", "keydown", "wheel", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [inApp, locked, lockNow]);

  useEffect(() => {
    const focus = () => setWindowFocused(true);
    const blur = () => setWindowFocused(false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    let unlisten: (() => void) | undefined;
    void onNativeEvent("lexichat://lock", lockNow).then((u) => (unlisten = u));
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
      unlisten?.();
    };
  }, [lockNow]);

  switch (phase.name) {
    case "boot":
      return (
        <main className="auth-page">
          <Spinner />
        </main>
      );
    case "notice":
      return (
        <PrivacyNotice
          onAccept={async () => {
            await localCache.write("notice-v1", true);
            setPhase({ name: "login" });
          }}
        />
      );
    case "login":
      return <LoginScreen notice={phase.notice} onNext={handleNext} />;
    case "recovery":
      return (
        <RecoveryKeyScreen
          recoveryKey={phase.key}
          onDone={async () => {
            try {
              handleNext(await phase.continueWith());
            } catch {
              await toLogin("Ihr Konto ist eingerichtet. Bitte melden Sie sich mit dem neuen Passwort an.");
            }
          }}
        />
      );
    case "flow": {
      const n = phase.next;
      const onRecoveryKey = (key: string, continueWith: () => Promise<NextStep>) => setPhase({ name: "recovery", key, continueWith });
      if (n.kind === "changePassword") return <ChangeInitialPassword step={n.step} onRecoveryKey={onRecoveryKey} onNext={handleNext} />;
      if (n.kind === "setupKeys") return <SetupKeys step={n.step} onRecoveryKey={onRecoveryKey} />;
      if (n.kind === "restore") return <RestoreKeys step={n.step} keys={n.keys} onNext={handleNext} onRecoveryKey={onRecoveryKey} />;
      return null;
    }
    case "app":
      return (
        <>
          {/* the chat ui is not rendered at all while locked (no content behind the lock screen) */}
          {!phase.locked && <Main onLock={lockNow} onLogout={() => void toLogin("Sie wurden abgemeldet.")} />}
          {phase.locked && (
            <LockScreen
              name={getUnlocked()?.user.name ?? ""}
              onLogout={() => void toLogin()}
              onUnlock={async () => {
                const u = getUnlocked();
                if (!u) return;
                try {
                  const identity = await unlockFromDevice();
                  setUnlocked({ ...u, identity });
                  unlockStore(identity);
                  setPhase({ name: "app", locked: false });
                } catch (err) {
                  await toLogin(err instanceof Error ? err.message : undefined);
                }
              }}
            />
          )}
        </>
      );
  }
}
