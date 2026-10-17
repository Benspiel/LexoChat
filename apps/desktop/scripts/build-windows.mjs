// Builds the signed Windows installer with the practice specific server url.
//
//   LEXICHAT_SERVER=https://chat.praxis.example \
//   TAURI_SIGNING_PRIVATE_KEY=... TAURI_SIGNING_PRIVATE_KEY_PASSWORD=... \
//   LEXICHAT_UPDATER_PUBKEY="$(cat updater.pub)" \
//   pnpm build:windows
//
// The server url is compiled into the app (not changeable by the user) and
// written into the CSP; code signing is configured via signtool / the CI job.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const server = process.env.LEXICHAT_SERVER;
if (!server || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(server)) {
  console.error("LEXICHAT_SERVER must be set to the https origin of the LexiChat server (no path).");
  process.exit(1);
}
const pubkey = process.env.LEXICHAT_UPDATER_PUBKEY;
if (!pubkey) {
  console.error("LEXICHAT_UPDATER_PUBKEY (public key of the update signature) must be set.");
  process.exit(1);
}

const base = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const csp = { ...base.app.security.csp, "img-src": `'self' blob: data: ${server}`, "connect-src": `ipc: http://ipc.localhost ${server}` };
const override = {
  app: { security: { csp } },
  plugins: { updater: { pubkey, endpoints: [`${server}/updates/latest.json`] } },
};

execFileSync("pnpm", ["tauri", "build", "--config", JSON.stringify(override)], {
  stdio: "inherit",
  env: { ...process.env, VITE_LEXICHAT_SERVER: server },
});
