import { sodium } from "./sodium";

/** Long-term identity of a person: X25519 (encryption) + Ed25519 (signatures). */
export interface Identity {
  encPublic: Uint8Array;
  encPrivate: Uint8Array;
  signPublic: Uint8Array;
  signPrivate: Uint8Array; // 64 bytes (libsodium format, contains the public key)
}

/** Encrypted key blob as stored on the server ("wrapped_private_keys"). */
export interface WrappedKeys {
  v: 1;
  alg: "xchacha20poly1305";
  nonce: string;
  ct: string;
}

const B64 = () => sodium().then((s) => s.base64_variants.ORIGINAL);

export async function toB64(bytes: Uint8Array): Promise<string> {
  const s = await sodium();
  return s.to_base64(bytes, await B64());
}

export async function fromB64(text: string): Promise<Uint8Array> {
  const s = await sodium();
  return s.from_base64(text, await B64());
}

export async function generateIdentity(): Promise<Identity> {
  const s = await sodium();
  const enc = s.crypto_box_keypair();
  const sign = s.crypto_sign_keypair();
  return { encPublic: enc.publicKey, encPrivate: enc.privateKey, signPublic: sign.publicKey, signPrivate: sign.privateKey };
}

const KEYS_AD = "lexichat:keys:v1";

/** Encrypts the private keys with a 32 byte key (kek from the password, or the recovery key). */
export async function wrapIdentity(id: Identity, key: Uint8Array): Promise<WrappedKeys> {
  const s = await sodium();
  const plain = s.from_string(JSON.stringify({ enc: await toB64(id.encPrivate), sign: await toB64(id.signPrivate) }));
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, s.from_string(KEYS_AD), null, nonce, key);
  s.memzero(plain);
  return { v: 1, alg: "xchacha20poly1305", nonce: await toB64(nonce), ct: await toB64(ct) };
}

/** Decrypts the private keys; throws if the key is wrong or the blob was modified. */
export async function unwrapIdentity(blob: WrappedKeys, key: Uint8Array): Promise<Identity> {
  const s = await sodium();
  if (blob.v !== 1 || blob.alg !== "xchacha20poly1305") throw new Error("unsupported key format");
  let plain: Uint8Array;
  try {
    plain = s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, await fromB64(blob.ct), s.from_string(KEYS_AD), await fromB64(blob.nonce), key);
  } catch {
    throw new Error("Die Schlüssel konnten nicht entschlüsselt werden.");
  }
  const parsed = JSON.parse(s.to_string(plain)) as { enc: string; sign: string };
  s.memzero(plain);
  const encPrivate = await fromB64(parsed.enc);
  const signPrivate = await fromB64(parsed.sign);
  return {
    encPrivate,
    encPublic: s.crypto_scalarmult_base(encPrivate),
    signPrivate,
    signPublic: s.crypto_sign_ed25519_sk_to_pk(signPrivate),
  };
}

export async function wipeIdentity(id: Identity | null): Promise<void> {
  if (!id) return;
  const s = await sodium();
  s.memzero(id.encPrivate);
  s.memzero(id.signPrivate);
}

// ------------------------------------------------------------- recovery key

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O/1/I

/** A random 256 bit recovery key, shown once as 13 groups of 4 characters (+ checksum group). */
export async function newRecoveryKey(): Promise<string> {
  const s = await sodium();
  return formatRecoveryKey(s.randombytes_buf(32));
}

function toSymbols(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

async function checksum(raw: Uint8Array): Promise<string> {
  const s = await sodium();
  return toSymbols(s.crypto_generichash(16, raw, null)).slice(0, 4);
}

async function formatRecoveryKey(raw: Uint8Array): Promise<string> {
  const symbols = toSymbols(raw) + (await checksum(raw));
  return symbols.match(/.{1,4}/g)!.join("-");
}

/** Parses a typed recovery key (case/space tolerant, verifies the checksum). */
export async function parseRecoveryKey(text: string): Promise<Uint8Array> {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 56) throw new Error("Der Wiederherstellungsschlüssel ist unvollständig.");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const c of clean.slice(0, 52)) {
    const idx = RECOVERY_ALPHABET.indexOf(c);
    if (idx < 0) throw new Error("Ungültiges Zeichen im Wiederherstellungsschlüssel.");
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const raw = new Uint8Array(bytes.slice(0, 32));
  if ((await checksum(raw)) !== clean.slice(52)) throw new Error("Der Wiederherstellungsschlüssel ist falsch (Prüfsumme).");
  return raw;
}

/** Key used to wrap the private keys with the recovery key. */
export async function recoveryWrapKey(raw: Uint8Array): Promise<Uint8Array> {
  const s = await sodium();
  return s.crypto_generichash(32, s.from_string("lexichat:recovery:v1"), raw);
}

// ------------------------------------------------------------- fingerprints

/** 60 digit fingerprint of a person's public keys (12 groups of 5 digits). */
export async function fingerprint(encPublic: Uint8Array, signPublic: Uint8Array): Promise<string> {
  const s = await sodium();
  const input = new Uint8Array([...s.from_string("lexichat:fp:v1"), ...encPublic, ...signPublic]);
  const hash = s.crypto_generichash(60, input, null);
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const chunk = hash.slice(i * 5, i * 5 + 5);
    let n = 0;
    for (const b of chunk) n = (n * 256 + b) % 100000;
    groups.push(String(n).padStart(5, "0"));
  }
  return groups.join(" ");
}

/** Safety number of a conversation: both fingerprints, ordered, identical on both sides. */
export async function safetyNumber(a: { encPublic: Uint8Array; signPublic: Uint8Array }, b: { encPublic: Uint8Array; signPublic: Uint8Array }): Promise<string> {
  const fa = (await fingerprint(a.encPublic, a.signPublic)).split(" ").slice(0, 6).join(" ");
  const fb = (await fingerprint(b.encPublic, b.signPublic)).split(" ").slice(0, 6).join(" ");
  return [fa, fb].sort().join(" ");
}
