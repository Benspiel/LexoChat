import { defineConfig } from "@playwright/test";

// Generates the README screenshots (docs/assets) against a real LexiChat server
// with fictional demo data:  pnpm --filter @lexichat/desktop screenshots
export default defineConfig({
  testDir: "./screenshots",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4174", locale: "de-DE", timezoneId: "Europe/Berlin" },
});
