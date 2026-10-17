import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const STATE_FILE = join(tmpdir(), "lexichat-e2e-state.json");
const SERVER_PORT = 8091;
const WEB_ORIGIN = "http://127.0.0.1:4173";

async function waitFor(url: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${url}`);
}

export default async function globalSetup() {
  const root = resolve(import.meta.dirname, "../../..");
  const work = mkdtempSync(join(tmpdir(), "lexichat-e2e-"));
  const bin = join(work, "lexichat");
  const dataDir = join(work, "pb_data");

  execFileSync("go", ["build", "-o", bin, "."], {
    cwd: join(root, "apps/server"),
    env: { ...process.env, CGO_ENABLED: "0", GOTOOLCHAIN: "auto" },
    stdio: "inherit",
  });

  const env = {
    ...process.env,
    LEXICHAT_SERVER_SECRET: randomBytes(32).toString("base64"),
    LEXICHAT_ADMIN_ORIGIN: WEB_ORIGIN,
    LEXICHAT_ALLOWED_ORIGINS: WEB_ORIGIN,
  };

  const out = execFileSync(bin, ["bootstrap-admin", "--dir", dataDir, "--username", "praxisadmin", "--name", "Praxis Admin"], { env }).toString();
  const otp = /Einmalpasswort:\s+(\S+)/.exec(out)?.[1];
  if (!otp) throw new Error("bootstrap did not print a one-time password:\n" + out);

  const server = spawn(bin, ["serve", "--http", `127.0.0.1:${SERVER_PORT}`, "--dir", dataDir], { env, stdio: "ignore", detached: true });
  const web = spawn("pnpm", ["exec", "vite", "preview", "--host", "127.0.0.1"], {
    cwd: join(root, "apps/admin-web"),
    env: { ...process.env, LEXICHAT_API: `http://127.0.0.1:${SERVER_PORT}` },
    stdio: "ignore",
    detached: true,
  });

  await waitFor(`http://127.0.0.1:${SERVER_PORT}/api/health`);
  await waitFor(`${WEB_ORIGIN}/`);

  writeFileSync(STATE_FILE, JSON.stringify({ otp, pids: [server.pid, web.pid], bin, dataDir, env: { LEXICHAT_SERVER_SECRET: env.LEXICHAT_SERVER_SECRET } }));
}
