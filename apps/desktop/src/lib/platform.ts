/**
 * Platform abstraction: in the Tauri app the native commands (Windows Credential
 * Manager, encrypted local cache, toast notifications, screenshot protection,
 * autostart, updates) are used. In a plain browser (development, e2e tests) safe
 * in-memory fallbacks are used – nothing is ever written to localStorage.
 */

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

const memory = new Map<string, string>();

/** Small secrets (session token) – Windows Credential Manager (DPAPI) in the app. */
export const secrets = {
  async get(key: string): Promise<string | null> {
    if (!isTauri) return memory.get(`secret:${key}`) ?? null;
    return invoke<string | null>("secret_get", { key });
  },
  async set(key: string, value: string): Promise<void> {
    if (!isTauri) {
      memory.set(`secret:${key}`, value);
      return;
    }
    await invoke("secret_set", { key, value });
  },
  async remove(key: string): Promise<void> {
    if (!isTauri) {
      memory.delete(`secret:${key}`);
      return;
    }
    await invoke("secret_delete", { key });
  },
};

/** Encrypted local cache (key stored in the Credential Manager). Holds no plaintext messages. */
export const localCache = {
  async read<T>(name: string, fallback: T): Promise<T> {
    try {
      const raw = isTauri ? await invoke<string | null>("cache_read", { name }) : (memory.get(`cache:${name}`) ?? null);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  async write(name: string, value: unknown): Promise<void> {
    const raw = JSON.stringify(value);
    if (!isTauri) {
      memory.set(`cache:${name}`, raw);
      return;
    }
    await invoke("cache_write", { name, data: raw });
  },
  async clearAll(): Promise<void> {
    if (!isTauri) {
      for (const k of [...memory.keys()]) if (k.startsWith("cache:")) memory.delete(k);
      return;
    }
    await invoke("cache_clear");
  },
};

/** Windows toast. The content is decided by the caller according to the privacy prefs. */
export async function notify(title: string, body: string): Promise<void> {
  if (!isTauri) return;
  const n = await import("@tauri-apps/plugin-notification");
  let granted = await n.isPermissionGranted();
  if (!granted) granted = (await n.requestPermission()) === "granted";
  if (granted) n.sendNotification({ title, body });
}

/** Excludes the window from screenshots / screen sharing (SetWindowDisplayAffinity). */
export async function setCaptureProtection(enabled: boolean): Promise<boolean> {
  if (!isTauri) return false;
  return invoke<boolean>("set_capture_protection", { enabled });
}

export const autostart = {
  async isEnabled(): Promise<boolean> {
    if (!isTauri) return false;
    return (await import("@tauri-apps/plugin-autostart")).isEnabled();
  },
  async set(enabled: boolean): Promise<void> {
    if (!isTauri) return;
    const a = await import("@tauri-apps/plugin-autostart");
    if (enabled) await a.enable();
    else await a.disable();
  },
};

/** Signed updates from the own update server (Tauri updater verifies the signature). */
export async function checkForUpdate(): Promise<{ version: string; install: () => Promise<void> } | null> {
  if (!isTauri) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    install: async () => {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}

/** Subscribe to native events (tray menu "Sperren"). */
export async function onNativeEvent(name: string, cb: () => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen(name, cb);
}

/** Device label for the session list ("Windows-App · <Rechnername>"). */
export async function deviceName(): Promise<string> {
  if (!isTauri) return "Browser (Entwicklung)";
  try {
    return await invoke<string>("device_name");
  } catch {
    return "Windows-PC";
  }
}
