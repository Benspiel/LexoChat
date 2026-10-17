import { defineConfig } from "@playwright/test";

// The e2e tests start a real LexiChat server (fresh data dir) and the built admin web app
// (vite preview with the production CSP), see e2e/global-setup.ts.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    launchOptions: process.env.LEXICHAT_CHROMIUM ? { executablePath: process.env.LEXICHAT_CHROMIUM } : {},
  },
});
