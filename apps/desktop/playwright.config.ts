import { defineConfig } from "@playwright/test";

// Runs the web part of the Windows app in Chromium against a real LexiChat server
// (platform fallbacks: no Credential Manager/toasts, everything in memory).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4174", locale: "de-DE", timezoneId: "Europe/Berlin", trace: "retain-on-failure" },
});
