import { sodium } from "./sodium";
import { fromB64, toB64 } from "./keys";

/**
 * Message format v1 (see docs/00-architektur.md 3.2):
 *   msgKey     = random(32)
 *   ciphertext = XChaCha20-Poly1305(msgKey, nonce, pad(payload), AD = "lexichat:msg:v1|" + context + "|" + senderId)
 *   envelopes  = { userId: crypto_box_seal(msgKey, encPublic(userId)) }  for every member incl. the sender
 *   signature  = Ed25519(BLAKE2b("lexichat:sig:v1" | context | senderId | nonce | ciphertext | envelopes))
 * context = "chat:<chatId>" for normal messages, "bcast:<recipientId>" for broadcasts.
 */

export interface MessagePayload {
  t: "text";
  body: string;
  /** client time of writing (only informational) */
  ts?: number;
}

export interface EncryptedMessage {
  v: 1;
  ciphertext: string;
  nonce: string;
  envelopes: Record<string, string>;
  signature: string;
}

export interface Recipient {
  id: string;
  encPublic: Uint8Array;
}

const PAD_BLOCK = 256; // hides the exact message length
export const MAX_BODY_CHARS = 20_000;

export function directContext(chatId: string): string {
  return `chat:${chatId}`;
}

export function broadcastContext(recipientId: string): string {
  return `bcast:${recipientId}`;
}

function ad(context: string, senderId: string): string {
  return `lexichat:msg:v1|${context}|${senderId}`;
}

async function signatureInput(context: string, senderId: string, nonce: string, ciphertext: string, envelopes: Record<string, string>) {
  const s = await sodium();
  const env = Object.keys(envelopes)
    .sort()
    .map((k) => `${k}:${envelopes[k]}`)
    .join("\n");
  return s.crypto_generichash(32, s.from_string(["lexichat:sig:v1", context, senderId, nonce, ciphertext, env].join("\n")), null);
}

export async function encryptMessage(opts: {
  payload: MessagePayload;
  context: string;
  senderId: string;
  senderSignPrivate: Uint8Array;
  recipients: Recipient[]; // must include the sender
}): Promise<EncryptedMessage> {
  const s = await sodium();
  if (opts.payload.body.length > MAX_BODY_CHARS) throw new Error("Die Nachricht ist zu lang.");
  if (!opts.recipients.some((r) => r.id === opts.senderId)) throw new Error("sender must be a recipient");

  const msgKey = s.crypto_aead_xchacha20poly1305_ietf_keygen();
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const padded = s.pad(s.from_string(JSON.stringify(opts.payload)), PAD_BLOCK);
  const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(padded, s.from_string(ad(opts.context, opts.senderId)), null, nonce, msgKey);

  const envelopes: Record<string, string> = {};
  for (const r of opts.recipients) envelopes[r.id] = await toB64(s.crypto_box_seal(msgKey, r.encPublic));
  s.memzero(msgKey);

  const nonceB64 = await toB64(nonce);
  const ctB64 = await toB64(ct);
  const sig = s.crypto_sign_detached(await signatureInput(opts.context, opts.senderId, nonceB64, ctB64, envelopes), opts.senderSignPrivate);
  return { v: 1, ciphertext: ctB64, nonce: nonceB64, envelopes, signature: await toB64(sig) };
}

export class MessageVerificationError extends Error {}

export async function decryptMessage(opts: {
  message: EncryptedMessage;
  context: string;
  senderId: string;
  senderSignPublic: Uint8Array;
  myId: string;
  myEncPublic: Uint8Array;
  myEncPrivate: Uint8Array;
}): Promise<MessagePayload> {
  const s = await sodium();
  const m = opts.message;
  if (m.v !== 1) throw new MessageVerificationError("Nicht unterstützte Nachrichtenversion.");

  // 1. authenticity first (signature over everything incl. the envelopes)
  const input = await signatureInput(opts.context, opts.senderId, m.nonce, m.ciphertext, m.envelopes);
  if (!s.crypto_sign_verify_detached(await fromB64(m.signature), input, opts.senderSignPublic)) {
    throw new MessageVerificationError("Die Signatur der Nachricht ist ungültig.");
  }
  // 2. own envelope
  const env = m.envelopes[opts.myId];
  if (!env) throw new MessageVerificationError("Diese Nachricht ist nicht für Sie verschlüsselt.");
  let msgKey: Uint8Array;
  try {
    msgKey = s.crypto_box_seal_open(await fromB64(env), opts.myEncPublic, opts.myEncPrivate);
  } catch {
    throw new MessageVerificationError("Diese Nachricht kann mit Ihrem Schlüssel nicht geöffnet werden.");
  }
  // 3. content (AEAD binds context + sender)
  try {
    const padded = s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, await fromB64(m.ciphertext), s.from_string(ad(opts.context, opts.senderId)), await fromB64(m.nonce), msgKey);
    const payload = JSON.parse(s.to_string(s.unpad(padded, PAD_BLOCK))) as MessagePayload;
    if (payload.t !== "text" || typeof payload.body !== "string") throw new Error("bad payload");
    return payload;
  } catch {
    throw new MessageVerificationError("Die Nachricht wurde verändert oder ist beschädigt.");
  } finally {
    s.memzero(msgKey);
  }
}
