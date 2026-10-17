import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_KDF_PARAMS, deriveAuthKey, newSalt } from "@lexichat/crypto";

export const STATE_FILE = join(tmpdir(), "lexichat-desktop-e2e.json");
export const API = "http://127.0.0.1:8092";
const WEB = "http://127.0.0.1:4174";

async function waitFor(url: string) {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout " + url);
}

function totp(secretB32: string, step: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secretB32) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1]! & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Admin bootstrap through the real api (as the admin web app does). */
export async function adminSession(otp: string) {
  const call = async (method: string, path: string, body?: unknown, auth?: { token: string; sid: string }) => {
    const res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth.token, "X-LexiChat-Session": auth.sid } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? {} : await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
    return json as Record<string, any>;
  };
  const pre = await call("GET", "/api/lexichat/prelogin?username=admin");
  const otpKey = await deriveAuthKey(otp, pre.salt, pre.params);
  let login = await call("POST", "/api/collections/users/auth-with-password", { identity: "admin", password: otpKey });
  let auth = { token: login.token, sid: login.meta.sessionId };
  const salt = await newSalt();
  const newKey = await deriveAuthKey("Admin Passwort für die Tests 2026", salt, DEFAULT_KDF_PARAMS);
  await call("POST", "/api/lexichat/me/password", { oldPassword: otpKey, newPassword: newKey, kdfSalt: salt, kdfParams: DEFAULT_KDF_PARAMS }, auth);
  login = await call("POST", "/api/collections/users/auth-with-password", { identity: "admin", password: newKey });
  auth = { token: login.token, sid: login.meta.sessionId };
  const setup = await call("POST", "/api/lexichat/me/totp/setup", { password: newKey }, auth);
  const step = Math.floor(Date.now() / 30_000);
  await call("POST", "/api/lexichat/me/totp/enable", { code: totp(setup.secret, step) }, auth);
  return { call: (m: string, p: string, b?: unknown) => call(m, p, b, auth), totpSecret: setup.secret as string, lastStep: step };
}

/** Logs the admin in again (waits for an unused TOTP window). */
export async function adminLogin(totpSecret: string, lastStep: number) {
  let step = Math.floor(Date.now() / 30_000);
  while (step <= lastStep) {
    await new Promise((r) => setTimeout(r, 1000));
    step = Math.floor(Date.now() / 30_000);
  }
  const pre = await (await fetch(API + "/api/lexichat/prelogin?username=admin")).json();
  const key = await deriveAuthKey("Admin Passwort für die Tests 2026", pre.salt, pre.params);
  const res = await fetch(API + "/api/collections/users/auth-with-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "admin", password: key, totp: totp(totpSecret, step) }),
  });
  const login = await res.json();
  if (!res.ok) throw new Error("admin login failed " + JSON.stringify(login));
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: login.token, "X-LexiChat-Session": login.meta.sessionId },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = r.status === 204 ? {} : await r.json();
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);
    return json as Record<string, any>;
  };
}

export default async function globalSetup() {
  const root = resolve(import.meta.dirname, "../../..");
  const work = mkdtempSync(join(tmpdir(), "lexichat-desktop-e2e-"));
  const bin = join(work, "lexichat");
  const dataDir = join(work, "pb_data");
  execFileSync("go", ["build", "-o", bin, "."], { cwd: join(root, "apps/server"), env: { ...process.env, CGO_ENABLED: "0", GOTOOLCHAIN: "auto" }, stdio: "inherit" });
  const env = { ...process.env, LEXICHAT_SERVER_SECRET: randomBytes(32).toString("base64"), LEXICHAT_ALLOWED_ORIGINS: WEB };
  const out = execFileSync(bin, ["bootstrap-admin", "--dir", dataDir, "--username", "admin", "--name", "Praxis Admin"], { env }).toString();
  const otp = /Einmalpasswort:\s+(\S+)/.exec(out)![1]!;

  const server = spawn(bin, ["serve", "--http", "127.0.0.1:8092", "--dir", dataDir], { env, stdio: "ignore", detached: true });
  const web = spawn("pnpm", ["exec", "vite", "preview", "--host", "127.0.0.1"], {
    cwd: join(root, "apps/desktop"),
    env: { ...process.env, LEXICHAT_API: API },
    stdio: "ignore",
    detached: true,
  });
  await waitFor(`${API}/api/health`);
  await waitFor(`${WEB}/`);

  const admin = await adminSession(otp);
  const users: Record<string, string> = {};
  for (const [username, name] of [
    ["anna", "Dr. Anna Berger"],
    ["ben", "Ben Schulz"],
  ] as const) {
    const res = await admin.call("POST", "/api/lexichat/admin/users", { username, name, role: "user" });
    users[username] = res.oneTimePassword;
    users[`${username}Id`] = res.id;
  }
  writeFileSync(STATE_FILE, JSON.stringify({ pids: [server.pid, web.pid], users, totpSecret: admin.totpSecret, lastStep: admin.lastStep }));
}
