// playwright.config.js
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e/js",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  workers: process.env.CI ? 2 : 4,
  use: {
    baseURL: "http://127.0.0.1:8082",
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "npx serve static -l 8082 --cors",
    url: "http://127.0.0.1:8082",
    reuseExistingServer: !process.env.CI,
  },
});
