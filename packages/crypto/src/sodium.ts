type Sodium = typeof import("libsodium-wrappers-sumo").default;

let ready: Promise<Sodium> | null = null;

/** Returns the initialised libsodium instance (WebAssembly, lazily loaded once). */
export function sodium(): Promise<Sodium> {
  ready ??= import("libsodium-wrappers-sumo").then(async (m) => {
    await m.default.ready;
    return m.default;
  });
  return ready;
}
