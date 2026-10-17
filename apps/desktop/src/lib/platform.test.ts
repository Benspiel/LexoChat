import { describe, expect, it } from "vitest";
import { localCache, secrets } from "./platform";

describe("browser fallback (outside Tauri)", () => {
  it("keeps secrets and cache in memory only", async () => {
    const writes: string[] = [];
    const spy = { setItem: (k: string) => writes.push(k), getItem: () => null, removeItem: () => {}, clear: () => {} };
    Object.defineProperty(globalThis, "localStorage", { value: spy, configurable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: spy, configurable: true });

    await secrets.set("token", "t");
    expect(await secrets.get("token")).toBe("t");
    await secrets.remove("token");
    expect(await secrets.get("token")).toBeNull();

    await localCache.write("state", { a: 1 });
    expect(await localCache.read("state", null)).toEqual({ a: 1 });
    await localCache.clearAll();
    expect(await localCache.read("state", "empty")).toBe("empty");

    expect(writes).toEqual([]);
  });
});
