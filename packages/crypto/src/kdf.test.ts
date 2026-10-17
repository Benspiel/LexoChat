import { describe, expect, it } from "vitest";
import { DEFAULT_KDF_PARAMS, deriveKeys, newSalt, validateKdfParams } from "./kdf";
import { sodium } from "./sodium";

// Same vector as apps/server/internal/lxkdf/kdf_test.go (cross implementation check).
const VECTOR = {
  password: "correct horse battery staple",
  salt: "AAECAwQFBgcICQoLDA0ODw==",
  auth: "e6a1f080e3f8da345a86797bacfe8e091f63bcb89ac755651ebfbcebaa153aef",
  kek: "22c058705e8208a85eb11b94c948ec44ff823c489ba63ca19ec6468ab05edeb4",
};

describe("kdf v1", () => {
  it("matches the server implementation", async () => {
    const keys = await deriveKeys(VECTOR.password, VECTOR.salt, DEFAULT_KDF_PARAMS);
    expect(keys.authKey).toBe(VECTOR.auth);
    expect((await sodium()).to_hex(keys.kek)).toBe(VECTOR.kek);
  });

  it("rejects weak or unknown parameters", () => {
    expect(() => validateKdfParams({ alg: "argon2id13", ops: 1, mem: DEFAULT_KDF_PARAMS.mem })).toThrow();
    expect(() => validateKdfParams({ alg: "argon2id13", ops: 3, mem: 1024 * 1024 })).toThrow();
    expect(() => validateKdfParams({ alg: "scrypt" as "argon2id13", ops: 3, mem: DEFAULT_KDF_PARAMS.mem })).toThrow();
  });

  it("creates 16 byte salts", async () => {
    const s = await sodium();
    const salt = await newSalt();
    expect(s.from_base64(salt, s.base64_variants.ORIGINAL)).toHaveLength(16);
    expect(await newSalt()).not.toBe(salt);
  });
});
