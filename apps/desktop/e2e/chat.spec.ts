import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { API, STATE_FILE, adminLogin } from "./global-setup";

test.describe.configure({ mode: "serial" });

interface State {
  users: Record<string, string>;
  totpSecret: string;
  lastStep: number;
}
const state = (): State => JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;

const PW = { anna: "Morgens Kaffee, mittags Visite, abends Ruhe", ben: "Der Empfang ist ab acht Uhr besetzt" };
const recovery: Record<string, string> = {};
let anna: Page;
let ben: Page;

function watch(page: Page, problems: string[]) {
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
}

async function accessible(page: Page, ctx: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), ctx).toEqual([]);
}

async function firstLogin(browser: Browser, user: "anna" | "ben", problems: string[]): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  watch(page, problems);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Willkommen bei LexiChat." })).toBeVisible();
  await page.getByRole("button", { name: "Verstanden" }).click();
  await page.getByLabel("Benutzername").fill(user);
  await page.getByLabel("Passwort", { exact: true }).fill(state().users[user]!);
  await page.getByRole("button", { name: "Anmelden" }).click();

  await expect(page.getByRole("heading", { name: "Neues Passwort festlegen." })).toBeVisible();
  await page.getByLabel("Neues Passwort", { exact: true }).fill(PW[user]);
  await page.getByLabel("Neues Passwort wiederholen").fill(PW[user]);
  await page.getByRole("button", { name: "Passwort festlegen" }).click();

  await expect(page.getByRole("heading", { name: "Ihr Wiederherstellungsschlüssel." })).toBeVisible({ timeout: 30_000 });
  const key = (await page.getByTestId("recovery-key").innerText()).replace(/\s+/g, "-");
  expect(key).toMatch(/^([A-Z2-9]{4}-){13}[A-Z2-9]{4}$/);
  recovery[user] = key;
  await page.getByLabel("Zur Kontrolle: die letzte Vierergruppe eingeben").fill(key.slice(-4));
  await page.getByRole("button", { name: "Ich habe den Schlüssel sicher notiert" }).click();
  await expect(page.getByRole("button", { name: "Neuer Chat" }).first()).toBeVisible({ timeout: 30_000 });
  return page;
}

test("first start: notice, one-time password, keys and recovery key", async ({ browser }) => {
  const problems: string[] = [];
  anna = await firstLogin(browser, "anna", problems);
  await accessible(anna, "anna empty main");
  ben = await firstLogin(browser, "ben", problems);
  expect(problems).toEqual([]);
});

test("end-to-end encrypted 1:1 chat in real time", async () => {
  // Anna starts a chat with Ben (Strg+K)
  await anna.keyboard.press("Control+k");
  const dialog = anna.getByRole("dialog", { name: "Neuer Chat." });
  await dialog.getByLabel("Person suchen").fill("ben");
  await dialog.getByRole("button", { name: /Ben Schulz/ }).click();
  await expect(anna.getByRole("heading", { name: "Ben Schulz" })).toBeVisible();

  const box = anna.getByLabel("Nachricht schreiben");
  await box.fill("Hallo Ben, Patient Raum 3 ist bereit.");
  await box.press("Enter");
  await expect(anna.getByText("Hallo Ben, Patient Raum 3 ist bereit.")).toBeVisible();

  // Ben gets it in real time (no reload)
  await ben.getByRole("button", { name: /Dr\. Anna Berger/ }).click();
  await expect(ben.getByText("Hallo Ben, Patient Raum 3 ist bereit.")).toBeVisible();
  await ben.getByLabel("Nachricht schreiben").fill("Danke, komme sofort.");
  await ben.getByLabel("Nachricht schreiben").press("Enter");
  await expect(anna.getByText("Danke, komme sofort.")).toBeVisible();

  // Shift+Enter = new line
  await box.fill("Zeile 1");
  await box.press("Shift+Enter");
  await box.type("Zeile 2");
  await box.press("Enter");
  await expect(ben.getByText(/Zeile 1\s+Zeile 2/)).toBeVisible();

  // delivered status (read receipts are off by default)
  await expect(anna.getByText(/zugestellt/).first()).toBeVisible();
  await expect(anna.getByText(/gelesen/)).toHaveCount(0);
  await accessible(anna, "conversation");
});

test("the server only stores ciphertext", async () => {
  // a guest gets nothing (default deny)
  const guest = await (await fetch(`${API}/api/collections/messages/records`)).json();
  expect(guest.items).toHaveLength(0);
  const admin = await adminLogin(state().totpSecret, state().lastStep);
  const list = await admin("GET", "/api/collections/messages/records");
  expect(list.items).toHaveLength(0); // admins cannot read chats at all
  const raw = JSON.stringify(await admin("GET", `/api/lexichat/admin/users/${state().users["annaId"]}/export`));
  expect(raw).not.toContain("Patient Raum 3");
});

test("safety numbers match on both sides", async () => {
  await anna.getByRole("button", { name: "Sicherheitsnummer" }).click();
  const a = await anna.getByTestId("safety-number").innerText();
  await ben.getByRole("button", { name: "Sicherheitsnummer" }).click();
  const b = await ben.getByTestId("safety-number").innerText();
  expect(a.replace(/\s/g, "")).toMatch(/^\d{60}$/);
  expect(a).toBe(b);
  await anna.keyboard.press("Escape");
  await ben.keyboard.press("Escape");
});

test("broadcast to all colleagues", async () => {
  const box = anna.getByLabel("Nachricht schreiben");
  await box.fill("Teamsitzung heute um 13 Uhr.");
  await anna.getByRole("button", { name: "Als Broadcast senden" }).click();
  const dialog = anna.getByRole("dialog", { name: "Als Broadcast senden?" });
  await expect(dialog).toContainText("Diese Nachricht geht an 1 Person");
  await expect(dialog).toContainText("1 Person hat die App noch nicht eingerichtet"); // the admin has no keys yet
  await dialog.getByRole("button", { name: "An 1 Person senden" }).click();
  await expect(dialog).toBeHidden();

  await expect(ben.getByText("Teamsitzung heute um 13 Uhr.")).toBeVisible();
  await expect(ben.getByText("Broadcast", { exact: true }).first()).toBeVisible();

  await anna.getByRole("button", { name: "Broadcasts" }).click();
  await expect(anna.getByText("Teamsitzung heute um 13 Uhr.")).toBeVisible();
  await expect(anna.getByText(/1 von 1 zugestellt/)).toBeVisible();
  await anna.getByRole("button", { name: "Chats", exact: true }).click();
});

test("edit and delete for everyone", async () => {
  const bubble = anna.locator(".bubble.mine", { hasText: "Hallo Ben, Patient Raum 3 ist bereit." });
  await bubble.hover();
  await bubble.getByRole("button", { name: "Löschen" }).click();
  await anna.getByRole("dialog", { name: "Nachricht für alle löschen?" }).getByRole("button", { name: "Für alle löschen" }).click();
  await expect(anna.getByText("Hallo Ben, Patient Raum 3 ist bereit.")).toHaveCount(0);
  await expect(ben.getByText("Hallo Ben, Patient Raum 3 ist bereit.")).toHaveCount(0);
});

test("inactivity/manual lock hides all content", async () => {
  await anna.keyboard.press("Control+l");
  await expect(anna.getByRole("heading", { name: "LexiChat ist gesperrt." })).toBeVisible();
  await expect(anna.getByText("Danke, komme sofort.")).toHaveCount(0);
  await anna.getByLabel("Passwort").fill("falsch falsch falsch");
  await anna.getByRole("button", { name: "Entsperren" }).click();
  await expect(anna.getByRole("alert")).toContainText("Das Passwort ist falsch.");
  await anna.getByLabel("Passwort").fill(PW.anna);
  await anna.getByRole("button", { name: "Entsperren" }).click();
  await expect(anna.getByRole("button", { name: "Neuer Chat" }).first()).toBeVisible();
  await anna.getByRole("button", { name: /Ben Schulz/ }).click();
  await expect(anna.getByText("Danke, komme sofort.")).toBeVisible();
});

test("admin password reset + recovery key keeps old messages readable", async ({ browser }) => {
  const admin = await adminLogin(state().totpSecret, state().lastStep + 1);
  const res = await admin("POST", `/api/lexichat/admin/users/${state().users["benId"]}/reset-password`);
  const otp = res.oneTimePassword as string;

  // the old session of Ben ends immediately
  await expect(ben.getByRole("heading", { name: "Anmelden." })).toBeVisible({ timeout: 30_000 });

  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Verstanden" }).click();
  await page.getByLabel("Benutzername").fill("ben");
  await page.getByLabel("Passwort", { exact: true }).fill(otp);
  await page.getByRole("button", { name: "Anmelden" }).click();
  const newPw = "Neues Passwort nach dem Urlaub 2026";
  await page.getByLabel("Neues Passwort", { exact: true }).fill(newPw);
  await page.getByLabel("Neues Passwort wiederholen").fill(newPw);
  await page.getByRole("button", { name: "Passwort festlegen" }).click();

  await expect(page.getByRole("heading", { name: "Schlüssel wiederherstellen." })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Wiederherstellungsschlüssel").fill(recovery["ben"]!.toLowerCase());
  await page.getByRole("button", { name: "Wiederherstellen" }).click();
  await page.getByRole("button", { name: /Dr\. Anna Berger/ }).click();
  await expect(page.getByText("Teamsitzung heute um 13 Uhr.")).toBeVisible();
  await expect(page.getByText("Danke, komme sofort.")).toBeVisible();

  // keys unchanged -> Anna sees no key change warning
  await anna.reload();
  await expect(anna.getByText(/Sicherheitsnummer von Ben Schulz hat sich geändert/)).toHaveCount(0);
});
