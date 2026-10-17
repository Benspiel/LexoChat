import {
  DEFAULT_KDF_PARAMS,
  deriveKeys,
  generateIdentity,
  newRecoveryKey,
  newSalt,
  parseRecoveryKey,
  recoveryWrapKey,
  sodium,
  toB64,
  unwrapIdentity,
  wipeIdentity,
  wrapIdentity,
  type Identity,
  type KdfParams,
  type WrappedKeys,
} from "@lexichat/crypto";
import { ApiError, LexiChatClient, type LoginResult, type UserRecord } from "@lexichat/shared";
import { deviceName, localCache, secrets } from "./platform";

/** Fixed server url (build time) – not changeable by the user (phishing protection). */
export const SERVER_URL: string = import.meta.env.VITE_LEXICHAT_SERVER ?? "";

export const sessionEvents = { onExpired: () => {} };

export const client = new LexiChatClient({
  baseUrl: SERVER_URL,
  device: "Windows-App",
  onUnauthorized: () => sessionEvents.onExpired(),
});

void deviceName().then((d) => client.setDevice(d));

export interface MyKeys {
  publicEncKey: string;
  publicSignKey: string;
  keyVersion: number;
  wrappedPrivateKeys: WrappedKeys | null;
  recoveryWrappedKeys: WrappedKeys | null;
}

/** Everything needed while logged in. The kek itself is never kept. */
export interface Unlocked {
  user: UserRecord;
  identity: Identity;
  wrapped: WrappedKeys;
  kdf: { salt: string; params: KdfParams };
}

export interface LoginStep {
  login: LoginResult;
  username: string;
  authKey: string;
  kek: Uint8Array;
  kdf: { salt: string; params: KdfParams };
}

function hasBlob(v: unknown): v is WrappedKeys {
  return !!v && typeof v === "object" && "ct" in (v as Record<string, unknown>);
}

export async function fetchMyKeys(): Promise<MyKeys> {
  const k = await client.request<MyKeys>("GET", "/api/lexichat/me/keys");
  return {
    ...k,
    wrappedPrivateKeys: hasBlob(k.wrappedPrivateKeys) ? k.wrappedPrivateKeys : null,
    recoveryWrappedKeys: hasBlob(k.recoveryWrappedKeys) ? k.recoveryWrappedKeys : null,
  };
}

/** Password login (2FA code optional). Throws ApiError with totpRequired if a code is needed. */
export async function passwordLogin(username: string, password: string, totp?: string, cached?: LoginStep): Promise<LoginStep> {
  const user = username.trim().toLowerCase();
  let step = cached;
  if (!step) {
    const pre = await client.prelogin(user);
    const keys = await deriveKeys(password, pre.salt, pre.params);
    step = { username: user, authKey: keys.authKey, kek: keys.kek, kdf: { salt: pre.salt, params: pre.params }, login: null as never };
  }
  try {
    step.login = await client.login(user, step.authKey, totp);
  } catch (err) {
    // keep the (expensive) derived keys for the second attempt with the 2FA code
    if (err instanceof ApiError && err.totpRequired) Object.assign(err, { step });
    throw err;
  }
  return step;
}

export type NextStep =
  | { kind: "changePassword"; step: LoginStep }
  | { kind: "setupKeys"; step: LoginStep }
  | { kind: "restore"; step: LoginStep; keys: MyKeys }
  | { kind: "ready"; unlocked: Unlocked };

/** Decides what has to happen after a successful login. */
export async function afterLogin(step: LoginStep): Promise<NextStep> {
  if (step.login.mustChangePassword) return { kind: "changePassword", step };
  const keys = await fetchMyKeys();
  if (keys.wrappedPrivateKeys) {
    const identity = await unwrapIdentity(keys.wrappedPrivateKeys, step.kek);
    (await sodium()).memzero(step.kek);
    return { kind: "ready", unlocked: { user: step.login.record, identity, wrapped: keys.wrappedPrivateKeys, kdf: step.kdf } };
  }
  if (!keys.publicEncKey) return { kind: "setupKeys", step };
  return { kind: "restore", step, keys };
}

/** First login: new password + (if needed) a freshly generated identity + recovery key. */
export async function changeInitialPassword(step: LoginStep, newPassword: string, hasPublicKeys: boolean): Promise<{ recoveryKey: string | null }> {
  const salt = await newSalt();
  const next = await deriveKeys(newPassword, salt, DEFAULT_KDF_PARAMS);
  const body: Record<string, unknown> = { oldPassword: step.authKey, newPassword: next.authKey, kdfSalt: salt, kdfParams: DEFAULT_KDF_PARAMS };
  let recoveryKey: string | null = null;
  if (!hasPublicKeys) {
    const id = await generateIdentity();
    recoveryKey = await newRecoveryKey();
    body["publicEncKey"] = await toB64(id.encPublic);
    body["publicSignKey"] = await toB64(id.signPublic);
    body["wrappedPrivateKeys"] = await wrapIdentity(id, next.kek);
    body["recoveryWrappedKeys"] = await wrapIdentity(id, await recoveryWrapKey(await parseRecoveryKey(recoveryKey)));
    await wipeIdentity(id);
  }
  await client.request("POST", "/api/lexichat/me/password", body);
  (await sodium()).memzero(next.kek);
  return { recoveryKey };
}

/** Account without keys (e.g. admin who first used the web app): create identity + recovery key. */
export async function setupNewKeys(step: LoginStep): Promise<string> {
  const id = await generateIdentity();
  const recoveryKey = await newRecoveryKey();
  await client.request("POST", "/api/lexichat/me/keys", {
    password: step.authKey,
    publicEncKey: await toB64(id.encPublic),
    publicSignKey: await toB64(id.signPublic),
    wrappedPrivateKeys: await wrapIdentity(id, step.kek),
    recoveryWrappedKeys: await wrapIdentity(id, await recoveryWrapKey(await parseRecoveryKey(recoveryKey))),
  });
  await wipeIdentity(id);
  return recoveryKey;
}

/** After an admin reset: restore the old keys with the recovery key. */
export async function restoreWithRecoveryKey(step: LoginStep, keys: MyKeys, recoveryKeyText: string): Promise<void> {
  if (!keys.recoveryWrappedKeys) throw new Error("Für Ihr Konto ist kein Wiederherstellungsschlüssel hinterlegt.");
  const raw = await parseRecoveryKey(recoveryKeyText);
  let id: Identity;
  try {
    id = await unwrapIdentity(keys.recoveryWrappedKeys, await recoveryWrapKey(raw));
  } catch {
    throw new Error("Der Wiederherstellungsschlüssel passt nicht zu Ihrem Konto.");
  }
  if ((await toB64(id.encPublic)) !== keys.publicEncKey) throw new Error("Der Wiederherstellungsschlüssel gehört zu einem älteren Schlüssel.");
  await client.request("POST", "/api/lexichat/me/keys", { password: step.authKey, wrappedPrivateKeys: await wrapIdentity(id, step.kek) });
  await wipeIdentity(id);
}

/** Lost recovery key: new identity (old messages become unreadable for this person). */
export async function replaceKeys(step: LoginStep): Promise<string> {
  return setupNewKeys(step);
}

/** Unlock after the inactivity lock: purely local (no server round trip). */
export async function unlockLocally(u: Unlocked | { wrapped: WrappedKeys; kdf: Unlocked["kdf"] }, password: string): Promise<Identity> {
  const keys = await deriveKeys(password, u.kdf.salt, u.kdf.params);
  try {
    return await unwrapIdentity(u.wrapped, keys.kek);
  } catch {
    throw new Error("Das Passwort ist falsch.");
  } finally {
    (await sodium()).memzero(keys.kek);
  }
}

/** Voluntary password change in the app: re-wraps the private keys with the new kek. */
export async function changePassword(u: Unlocked, current: string, next: string): Promise<Unlocked> {
  const old = await deriveKeys(current, u.kdf.salt, u.kdf.params);
  try {
    await unwrapIdentity(u.wrapped, old.kek); // verifies the current password locally
  } catch {
    throw new Error("Das aktuelle Passwort ist falsch.");
  }
  const salt = await newSalt();
  const nk = await deriveKeys(next, salt, DEFAULT_KDF_PARAMS);
  const wrapped = await wrapIdentity(u.identity, nk.kek);
  await client.request("POST", "/api/lexichat/me/password", {
    oldPassword: old.authKey,
    newPassword: nk.authKey,
    kdfSalt: salt,
    kdfParams: DEFAULT_KDF_PARAMS,
    wrappedPrivateKeys: wrapped,
  });
  const s = await sodium();
  s.memzero(old.kek);
  // all sessions ended -> log in again with the new password
  const step = await passwordLogin(u.user.username, next, undefined, {
    username: u.user.username,
    authKey: nk.authKey,
    kek: nk.kek,
    kdf: { salt, params: DEFAULT_KDF_PARAMS },
    login: null as never,
  }).catch((err: unknown) => {
    if (err instanceof ApiError && err.totpRequired) throw new Error("Passwort geändert. Bitte melden Sie sich neu an (Zwei-Faktor-Code).");
    throw err;
  });
  s.memzero(nk.kek);
  return { user: step.login.record, identity: u.identity, wrapped, kdf: { salt, params: DEFAULT_KDF_PARAMS } };
}

/** New recovery key (e.g. if the old one may be compromised). */
export async function renewRecoveryKey(u: Unlocked): Promise<string> {
  const recoveryKey = await newRecoveryKey();
  await client.request("POST", "/api/lexichat/me/keys/recovery", {
    recoveryWrappedKeys: await wrapIdentity(u.identity, await recoveryWrapKey(await parseRecoveryKey(recoveryKey))),
  });
  return recoveryKey;
}

// ---------------------------------------------------------------- "Angemeldet bleiben"

interface Remembered {
  token: string;
  sessionId: string;
  user: UserRecord;
  wrapped: WrappedKeys;
  kdf: Unlocked["kdf"];
}

const REMEMBER_KEY = "session";

/** Stores the server session (not the password, not the private keys in clear) in the Credential Manager. */
export async function remember(u: Unlocked): Promise<void> {
  if (!client.auth) return;
  const data: Remembered = { token: client.auth.token, sessionId: client.auth.sessionId, user: u.user, wrapped: u.wrapped, kdf: u.kdf };
  await secrets.set(REMEMBER_KEY, JSON.stringify(data));
}

export async function forget(): Promise<void> {
  await secrets.remove(REMEMBER_KEY);
}

export async function loadRemembered(): Promise<Remembered | null> {
  const raw = await secrets.get(REMEMBER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Remembered;
  } catch {
    return null;
  }
}

/** Resumes a remembered session: unlock with the password (local), then refresh the token. */
export async function resume(r: Remembered, password: string): Promise<Unlocked> {
  const identity = await unlockLocally(r, password);
  client.auth = { token: r.token, sessionId: r.sessionId, record: r.user };
  try {
    await client.refresh();
  } catch (err) {
    await wipeIdentity(identity);
    await forget();
    throw err instanceof ApiError && err.status === 401 ? new Error("Ihre gespeicherte Sitzung ist abgelaufen. Bitte melden Sie sich neu an.") : err;
  }
  return { user: client.auth?.record ?? r.user, identity, wrapped: r.wrapped, kdf: r.kdf };
}

export async function logout(): Promise<void> {
  await forget();
  await client.logout();
}

export async function wipeLocalData(): Promise<void> {
  await forget();
  await localCache.clearAll();
}
