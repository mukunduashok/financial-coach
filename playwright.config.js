// playwright.config.js
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e/js",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,
  use: {
    baseURL: "http://127.0.0.1:8111",
    browserName: "chromium",
    headless: true,
  },
});
