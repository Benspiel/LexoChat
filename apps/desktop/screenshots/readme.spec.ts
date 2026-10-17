import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { API, STATE_FILE, adminLogin } from "../e2e/global-setup";

// README screenshots with fictional demo data (no real persons, no patient data).

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, "docs/assets");
const SHOTS = join(OUT, "screenshots");
const ADMIN_WEB = "http://127.0.0.1:4173";
const ADMIN_PASSWORD = "Admin Passwort für die Tests 2026";
const VIEW = { width: 1280, height: 800 };

test.describe.configure({ mode: "serial" });

const state = () => JSON.parse(readFileSync(STATE_FILE, "utf8")) as { users: Record<string, string>; totpSecret: string; lastStep: number };

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

let usedStep = 0;
async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  while (step <= usedStep) {
    await new Promise((r) => setTimeout(r, 1000));
    step = Math.floor(Date.now() / 30_000);
  }
  usedStep = step;
  return totp(secret, step);
}

const PW: Record<string, string> = {
  anna: "Morgens Kaffee, mittags Visite, abends Ruhe",
  ben: "Der Empfang ist ab acht Uhr besetzt",
  lea: "Labor um zehn, Befunde um elf",
  tom: "Raum zwei ist frisch desinfiziert",
};
const otps: Record<string, string> = {};
const pages: Record<string, Page> = {};

async function shot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function firstLogin(browser: Browser, user: string, capture = false): Promise<Page> {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Willkommen bei LexiChat." })).toBeVisible();
  if (capture) await shot(page, "desktop-erster-start");
  await page.getByRole("button", { name: "Verstanden" }).click();
  await page.getByLabel("Benutzername").fill(user);
  await page.getByLabel("Passwort", { exact: true }).fill(otps[user]!);
  if (capture) await shot(page, "desktop-anmeldung");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Neues Passwort festlegen." })).toBeVisible();
  await page.getByLabel("Neues Passwort", { exact: true }).fill(PW[user]!);
  await page.getByLabel("Neues Passwort wiederholen").fill(PW[user]!);
  await page.getByRole("button", { name: "Passwort festlegen" }).click();
  await expect(page.getByRole("heading", { name: "Ihr Wiederherstellungsschlüssel." })).toBeVisible({ timeout: 30_000 });
  const key = (await page.getByTestId("recovery-key").innerText()).replace(/\s+/g, "-");
  await page.getByLabel("Zur Kontrolle: die letzte Vierergruppe eingeben").fill(key.slice(-4));
  await page.getByRole("button", { name: "Ich habe den Schlüssel sicher notiert" }).click();
  await expect(page.getByRole("button", { name: "Neuer Chat" }).first()).toBeVisible({ timeout: 30_000 });
  return page;
}

async function openChatWith(page: Page, name: string) {
  const existing = page.getByRole("button", { name: new RegExp(name) });
  if (await existing.count()) {
    await existing.first().click();
  } else {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Neuer Chat." });
    await dialog.getByLabel("Person suchen").fill(name.split(" ").at(-1)!);
    await dialog.getByRole("button", { name: new RegExp(name) }).click();
  }
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function send(page: Page, text: string) {
  const box = page.getByLabel("Nachricht schreiben");
  await box.fill(text);
  await box.press("Enter");
  await expect(page.locator(".bubble.mine", { hasText: text })).toBeVisible();
}

async function setReadReceipts(page: Page) {
  await page.getByRole("button", { name: /Menü/ }).click();
  await page.getByRole("menuitem", { name: "Benachrichtigungen und Privatsphäre" }).click();
  const settings = page.getByRole("dialog", { name: "Einstellungen." });
  await settings.getByRole("switch", { name: /Lesebestätigungen senden/ }).click();
  await page.keyboard.press("Escape");
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test("windows app", async ({ browser }) => {
  const s = state();
  otps.anna = s.users.anna!;
  otps.ben = s.users.ben!;
  const admin = await adminLogin(s.totpSecret, s.lastStep);
  usedStep = Math.floor(Date.now() / 30_000);
  for (const [username, name] of [
    ["lea", "Lea Wagner"],
    ["tom", "Tom Richter"],
  ] as const) {
    otps[username] = (await admin("POST", "/api/lexichat/admin/users", { username, name, role: "user" })).oneTimePassword;
  }

  pages.anna = await firstLogin(browser, "anna", true);
  for (const u of ["ben", "lea", "tom"]) pages[u] = await firstLogin(browser, u);
  const { anna, ben, lea, tom } = pages as Record<string, Page>;
  await shot(anna!, "desktop-leer");

  await setReadReceipts(anna!);
  await setReadReceipts(ben!);

  await openChatWith(tom!, "Dr. Anna Berger");
  await send(tom!, "Die Spritzenpumpe in Raum 2 ist gewartet und wieder einsatzbereit.");

  await openChatWith(anna!, "Lea Wagner");
  await send(anna!, "Kannst du die Laborwerte von heute Vormittag ins PVS übernehmen?");
  await openChatWith(lea!, "Dr. Anna Berger");
  await send(lea!, "Mache ich gleich, sind in 10 Minuten drin.");

  await openChatWith(anna!, "Ben Schulz");
  await send(anna!, "Guten Morgen Ben! Ist Raum 3 schon vorbereitet?");
  await openChatWith(ben!, "Dr. Anna Berger");
  await send(ben!, "Guten Morgen! Ja, Raum 3 ist fertig. Die nächste Person wartet im Wartezimmer.");
  await send(ben!, "Soll ich die Überweisung schon ausdrucken?");
  await expect(anna!.getByText("Soll ich die Überweisung schon ausdrucken?")).toBeVisible();
  await send(anna!, "Ja, bitte. Ich komme in 5 Minuten.");
  await expect(anna!.locator(".bubble.mine", { hasText: "Ja, bitte." })).toContainText("gelesen");
  await anna!.getByLabel("Nachricht schreiben").fill("Danke dir!");
  await shot(anna!, "desktop-chat");

  // safety number
  await anna!.getByLabel("Nachricht schreiben").fill("");
  await anna!.getByRole("button", { name: "Sicherheitsnummer" }).click();
  await expect(anna!.getByTestId("safety-number")).toBeVisible();
  await shot(anna!, "desktop-sicherheitsnummer");
  await anna!.keyboard.press("Escape");

  // broadcast
  await anna!.getByLabel("Nachricht schreiben").fill("Teamsitzung heute um 13 Uhr im Besprechungsraum. Bitte pünktlich sein!");
  await anna!.getByRole("button", { name: "Als Broadcast senden" }).click();
  const dialog = anna!.getByRole("dialog", { name: "Als Broadcast senden?" });
  await expect(dialog).toBeVisible();
  await shot(anna!, "desktop-broadcast-dialog");
  await dialog.getByRole("button", { name: /^An \d+ Person/ }).click();
  await expect(dialog).toBeHidden();
  await expect(ben!.getByText("Teamsitzung heute um 13 Uhr", { exact: false }).first()).toBeVisible();
  await anna!.getByRole("button", { name: "Broadcasts" }).click();
  await expect(anna!.getByText(/zugestellt/).first()).toBeVisible();
  await shot(anna!, "desktop-broadcasts");
  await anna!.getByRole("button", { name: "Chats", exact: true }).click();

  // settings
  await anna!.getByRole("button", { name: /Menü/ }).click();
  await anna!.getByRole("menuitem", { name: "Benachrichtigungen und Privatsphäre" }).click();
  await expect(anna!.getByRole("dialog", { name: "Einstellungen." })).toBeVisible();
  await shot(anna!, "desktop-einstellungen");
  await anna!.keyboard.press("Escape");

  // lock
  await anna!.keyboard.press("Control+l");
  await expect(anna!.getByRole("heading", { name: "LexiChat ist gesperrt." })).toBeVisible();
  await shot(anna!, "desktop-gesperrt");
  await anna!.getByLabel("Passwort").fill(PW.anna!);
  await anna!.getByRole("button", { name: "Entsperren" }).click();
});

test("admin web app", async ({ browser }) => {
  const web = spawn("pnpm", ["exec", "vite", "preview", "--host", "127.0.0.1"], {
    cwd: join(ROOT, "apps/admin-web"),
    env: { ...process.env, LEXICHAT_API: API },
    stdio: "ignore",
    detached: true,
  });
  try {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, baseURL: ADMIN_WEB });
    const page = await ctx.newPage();
    for (let i = 0; i < 100; i++) {
      try {
        await page.goto("/");
        break;
      } catch {
        await page.waitForTimeout(300);
      }
    }
    await expect(page.getByLabel("Benutzername")).toBeVisible();
    await shot(page, "admin-anmeldung");
    await page.getByLabel("Benutzername").fill("admin");
    await page.getByLabel("Passwort", { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.getByLabel("Code aus der Authenticator-App").fill(await freshTotp(state().totpSecret));
    await shot(page, "admin-2fa");
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page.getByRole("button", { name: "Neues Konto" })).toBeVisible();
    await expect(page.getByText("Tom Richter")).toBeVisible();
    await shot(page, "admin-benutzer");

    await page.getByRole("button", { name: "Neues Konto" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Anzeigename").fill("Sophie Klein");
    await dialog.getByLabel("Benutzername").fill("sophie.klein");
    await shot(page, "admin-neues-konto");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Audit-Log" }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await shot(page, "admin-audit-log");
    await page.getByRole("button", { name: "Einstellungen" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(page, "admin-einstellungen");
  } finally {
    try {
      process.kill(-web.pid!);
    } catch {
      // gone
    }
  }
});

// ---------------------------------------------------------------- composed images

function dataUrl(file: string, mime = "image/png") {
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

function fontCss() {
  const font = join(ROOT, "node_modules/.pnpm/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");
  return `@font-face{font-family:Inter;src:url(${dataUrl(font, "font/woff2")}) format("woff2");font-weight:100 900}`;
}

const LOGO = (size: number, bg: string, fg: string) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="72" fill="${bg}"/><path d="M98 66v124h68" fill="none" stroke="${fg}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

test("logo, banner and hero", async ({ browser }) => {
  writeFileSync(join(OUT, "logo.svg"), LOGO(256, "#141414", "#ffffff") + "\n");
  writeFileSync(join(OUT, "logo-dark.svg"), LOGO(256, "#ffffff", "#141414") + "\n");

  const page = await (await browser.newContext({ deviceScaleFactor: 2 })).newPage();
  for (const [mode, bg, fg, muted, logoBg, logoFg] of [
    ["light", "#ffffff", "#141414", "#696969", "#141414", "#ffffff"],
    ["dark", "#0d1117", "#f0f6fc", "#9198a1", "#ffffff", "#141414"],
  ] as const) {
    await page.setViewportSize({ width: 900, height: 220 });
    await page.setContent(`<style>${fontCss()}body{margin:0;background:${bg};font-family:Inter}
      .b{height:220px;display:flex;align-items:center;justify-content:center;gap:36px}
      h1{margin:0;font-size:112px;font-weight:652;letter-spacing:-0.04em;color:${fg};line-height:1}
      p{margin:10px 0 0;font-size:24px;font-weight:456;color:${muted};letter-spacing:-0.01em}</style>
      <div class="b">${LOGO(150, logoBg, logoFg)}<div><h1>LexiChat</h1><p>Der sichere Messenger für Ihre Praxis.</p></div></div>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, `banner-${mode}.png`), omitBackground: false });
  }

  // hero: Windows app window + admin web app in a browser window
  const desk = dataUrl(join(SHOTS, "desktop-chat.png"));
  const adm = dataUrl(join(SHOTS, "admin-benutzer.png"));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.setContent(`<style>${fontCss()}
    body{margin:0;width:1600px;height:1000px;background:linear-gradient(160deg,#f3f3f3,#e6e6e6);font-family:Inter;position:relative;overflow:hidden}
    .win{position:absolute;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 30px 80px rgba(0,0,0,.22),0 0 0 1px rgba(0,0,0,.08)}
    .bar{height:40px;display:flex;align-items:center;padding:0 14px;font-size:14px;font-weight:600;color:#141414;background:#fafafa;border-bottom:1px solid #e0e0e0;gap:10px}
    .bar .t{flex:1}.ctl{display:flex;gap:22px;color:#707070;font-size:16px}
    .dots{display:flex;gap:8px}.dots i{width:12px;height:12px;border-radius:50%;background:#d0d0d0;display:block}
    .url{flex:1;margin:0 18px;height:24px;border-radius:12px;background:#f0f0f0;display:flex;align-items:center;padding:0 14px;font-weight:456;color:#696969;font-size:13px}
    img{display:block;width:100%}
    .admin{left:520px;top:70px;width:1000px}.desk{left:80px;top:300px;width:1000px}</style>
    <div class="win admin"><div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">🔒 admin.praxis-beispiel.de</span></div><img src="${adm}"></div>
    <div class="win desk"><div class="bar">${LOGO(20, "#141414", "#fff")}<span class="t">LexiChat</span><span class="ctl"><span>—</span><span>☐</span><span>✕</span></span></div><img src="${desk}"></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, "hero.png") });
});
