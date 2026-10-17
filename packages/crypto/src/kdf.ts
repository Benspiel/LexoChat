import { sodium } from "./sodium";

/**
 * LexiChat KDF v1 – must stay byte compatible with apps/server/internal/lxkdf.
 *
 *   master  = Argon2id(password, salt, ops, mem, p=1, 32 bytes)
 *   authKey = BLAKE2b-256(key=master, "lexichat:auth:v1")  -> sent to the server (hex)
 *   kek     = BLAKE2b-256(key=master, "lexichat:kek:v1")   -> never leaves the device
 */
export interface KdfParams {
  alg: "argon2id13";
  ops: number;
  mem: number; // bytes
}

export const DEFAULT_KDF_PARAMS: KdfParams = { alg: "argon2id13", ops: 3, mem: 64 * 1024 * 1024 };
export const SALT_BYTES = 16;

export function validateKdfParams(p: KdfParams): void {
  if (p.alg !== "argon2id13") throw new Error("unsupported kdf algorithm");
  if (!Number.isInteger(p.ops) || p.ops < 2 || p.ops > 10) throw new Error("invalid kdf ops");
  if (!Number.isInteger(p.mem) || p.mem < 32 * 1024 * 1024 || p.mem > 1024 * 1024 * 1024 || p.mem % 1024 !== 0) {
    throw new Error("invalid kdf memory");
  }
}

export interface DerivedKeys {
  /** hex encoded auth key, used as PocketBase "password" */
  authKey: string;
  /** key encryption key for the private keys (keep in memory only, wipe after use) */
  kek: Uint8Array;
}

export async function deriveKeys(password: string, saltB64: string, params: KdfParams): Promise<DerivedKeys> {
  validateKdfParams(params);
  const s = await sodium();
  const salt = s.from_base64(saltB64, s.base64_variants.ORIGINAL);
  if (salt.length !== SALT_BYTES) throw new Error("invalid salt length");
  const master = s.crypto_pwhash(32, password, salt, params.ops, params.mem, s.crypto_pwhash_ALG_ARGON2ID13);
  try {
    const authKey = s.to_hex(s.crypto_generichash(32, s.from_string("lexichat:auth:v1"), master));
    const kek = s.crypto_generichash(32, s.from_string("lexichat:kek:v1"), master);
    return { authKey, kek };
  } finally {
    s.memzero(master);
  }
}

/** Derives only the auth key (the admin web app never needs the kek). */
export async function deriveAuthKey(password: string, saltB64: string, params: KdfParams): Promise<string> {
  const { authKey, kek } = await deriveKeys(password, saltB64, params);
  (await sodium()).memzero(kek);
  return authKey;
}

export async function newSalt(): Promise<string> {
  const s = await sodium();
  return s.to_base64(s.randombytes_buf(SALT_BYTES), s.base64_variants.ORIGINAL);
}
