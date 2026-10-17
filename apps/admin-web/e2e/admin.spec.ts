import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, freshTotp, state, watchConsole } from "./helpers";

// One admin journey from the very first login to user management. Serial: every step builds on the previous one.
test.describe.configure({ mode: "serial" });

const ADMIN = "praxisadmin";
const ADMIN_PASSWORD = "Kaffeetasse und Stethoskop am Fenster";
let totpSecret = "";
let newUserOtp = "";

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
}

async function loginAdmin(page: Page) {
  await login(page, ADMIN, ADMIN_PASSWORD);
  await page.getByLabel("Code aus der Authenticator-App").fill(await freshTotp(totpSecret));
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Benutzer." })).toBeVisible();
}

test("first login: one-time password, new password, mandatory 2FA", async ({ page }) => {
  const problems = watchConsole(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Verwaltung." })).toBeVisible();
  await expectAccessible(page, "login");

  // wrong password -> generic message
  await login(page, ADMIN, "falsches-passwort-123");
  await expect(page.getByRole("alert")).toContainText("Benutzername oder Passwort falsch");

  await login(page, ADMIN, state().otp);
  await expect(page.getByRole("heading", { name: "Neues Passwort festlegen." })).toBeVisible();
  await expectAccessible(page, "change password");

  // policy: common password is rejected client side
  await page.getByLabel("Neues Passwort", { exact: true }).fill("Passwort2026!");
  await expect(page.getByText("Dieses Passwort ist zu verbreitet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Passwort ändern" })).toBeDisabled();

  await page.getByLabel("Neues Passwort", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel("Neues Passwort wiederholen").fill(ADMIN_PASSWORD);
  await expect(page.getByText("Das Passwort erfüllt alle Regeln.")).toBeVisible();
  await page.getByRole("button", { name: "Passwort ändern" }).click();
  await expect(page.getByText("Ihr Passwort wurde geändert.")).toBeVisible();

  // the one-time password is invalid now
  await login(page, ADMIN, state().otp);
  await expect(page.getByRole("alert")).toBeVisible();

  // login with the new password -> 2FA setup is mandatory for admins
  await login(page, ADMIN, ADMIN_PASSWORD);
  await expect(page.getByRole("heading", { name: "Zwei-Faktor-Anmeldung einrichten." })).toBeVisible();
  await page.getByRole("button", { name: "Einrichtung starten" }).click();
  await expect(page.getByRole("img", { name: "QR-Code für die Authenticator-App" })).toBeVisible();
  await expectAccessible(page, "totp setup");
  totpSecret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  expect(totpSecret).toMatch(/^[A-Z2-7]{32}$/);

  await page.getByLabel("Code aus der App").fill(await freshTotp(totpSecret));
  await page.getByRole("button", { name: "Aktivieren" }).click();
  await expect(page.getByRole("heading", { name: "Benutzer." })).toBeVisible();
  await expectAccessible(page, "users");

  expect(problems, "console / CSP problems").toEqual([]);
});

test("login requires the second factor", async ({ page }) => {
  await login(page, ADMIN, ADMIN_PASSWORD);
  await expect(page.getByLabel("Code aus der Authenticator-App")).toBeVisible();
  await page.getByLabel("Code aus der Authenticator-App").fill("000000");
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("alert")).toContainText("Zwei-Faktor-Code ist ungültig");

  await page.getByLabel("Code aus der Authenticator-App").fill(await freshTotp(totpSecret));
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Benutzer." })).toBeVisible();
});

test("create, deactivate and reactivate an account", async ({ page }) => {
  const problems = watchConsole(page);
  await loginAdmin(page);

  await page.getByRole("button", { name: "Neues Konto" }).click();
  const dialog = page.getByRole("dialog", { name: "Neues Konto." });
  await expect(dialog).toBeVisible();
  await expectAccessible(page, "create dialog");
  await dialog.getByLabel("Anzeigename").fill("Dr. Anna Müller");
  await dialog.getByLabel("Benutzername").fill("dr.mueller");
  await dialog.getByRole("button", { name: "Konto anlegen" }).click();

  const otpDialog = page.getByRole("dialog", { name: "Konto angelegt." });
  await expect(otpDialog).toBeVisible();
  newUserOtp = (await page.getByTestId("one-time-password").innerText()).trim();
  expect(newUserOtp).toMatch(/^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
  await otpDialog.getByRole("button", { name: "Ich habe das Einmalpasswort übergeben" }).click();

  const row = page.getByRole("row", { name: /Dr\. Anna Müller/ });
  await expect(row).toContainText("Erstanmeldung offen");

  // deactivate
  await row.getByRole("button", { name: "Dr. Anna Müller verwalten" }).click();
  await page.getByRole("button", { name: "Deaktivieren" }).click();
  await page.getByRole("dialog", { name: "Konto deaktivieren?" }).getByRole("button", { name: "Deaktivieren" }).click();
  await expect(page.getByText("Dr. Anna Müller wurde deaktiviert.")).toBeVisible();
  await expect(row).toContainText("Deaktiviert");

  // reactivate
  await row.getByRole("button", { name: "Dr. Anna Müller verwalten" }).click();
  await page.getByRole("button", { name: "Reaktivieren" }).click();
  await expect(page.getByText("Dr. Anna Müller wurde reaktiviert.")).toBeVisible();

  expect(problems).toEqual([]);
});

test("non-admins cannot use the admin web app", async ({ page }) => {
  await login(page, "dr.mueller", newUserOtp);
  await expect(page.getByRole("alert")).toContainText("nur für Administratorinnen und Administratoren");
  await expect(page.getByRole("heading", { name: "Benutzer." })).toHaveCount(0);
});

test("audit log, settings and account pages", async ({ page }) => {
  const problems = watchConsole(page);
  await loginAdmin(page);

  await page.getByRole("button", { name: "Audit-Log" }).click();
  await expect(page.getByRole("heading", { name: "Audit-Log." })).toBeVisible();
  for (const label of ["Konto angelegt", "Konto deaktiviert", "Zwei-Faktor-Anmeldung eingerichtet", "Anmeldung abgelehnt"]) {
    await expect(page.getByRole("cell", { name: label }).first()).toBeVisible();
  }
  await expectAccessible(page, "audit");

  await page.getByRole("button", { name: "Einstellungen" }).click();
  const retention = page.getByLabel("Aufbewahrung von Nachrichten (Tage)");
  await expect(retention).toHaveValue("90");
  await retention.fill("0");
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await retention.fill("30");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Einstellungen gespeichert.")).toBeVisible();
  await expectAccessible(page, "settings");

  await page.getByRole("button", { name: "Mein Konto" }).click();
  await expect(page.getByRole("heading", { name: "Angemeldete Geräte." })).toBeVisible();
  await expect(page.getByText("diese Sitzung")).toBeVisible();
  await expectAccessible(page, "account");

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByText("Sie wurden abgemeldet.")).toBeVisible();

  expect(problems).toEqual([]);
});

test("security headers of the app", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["content-security-policy"]).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  const html = await res.text();
  expect(html).not.toMatch(/<script>(?!<\/script>)/); // no inline scripts
});
