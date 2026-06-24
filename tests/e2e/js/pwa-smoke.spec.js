// tests/e2e/js/pwa-smoke.spec.js
import { test, expect } from "./fixtures.js";

const EXPECTED_SEED_CATEGORIES = 20;

// ============================================================================
// App Loading
// ============================================================================

test.describe("TestAppLoading", () => {
  test("page loads without js errors", async ({ pwaPage }) => {
    const errors = [];
    pwaPage.on("pageerror", (err) => errors.push(String(err)));

    await pwaPage.reload();
    await pwaPage.waitForLoadState("networkidle");
    await pwaPage.waitForSelector(".bottom-nav", { timeout: 10_000 });

    expect(errors).toEqual([]);
  });

  test("app container visible", async ({ pwaPage }) => {
    const app = pwaPage.locator("#app");
    expect(await app.isVisible()).toBeTruthy();

    const content = await app.innerText();
    expect(content).not.toContain("Failed to load database");
  });

  test("no spinner stuck", async ({ pwaPage }) => {
    const spinners = pwaPage.locator("#app > .spinner");
    expect(await spinners.count()).toBe(0);
  });

  test("navigation renders", async ({ pwaPage }) => {
    const nav = pwaPage.locator(".bottom-nav");
    expect(await nav.isVisible()).toBeTruthy();

    const navItems = pwaPage.locator(".bottom-nav .nav-item");
    expect(await navItems.count()).toBeGreaterThanOrEqual(4);
  });

  test("header renders", async ({ pwaPage }) => {
    const header = pwaPage.locator(".app-header");
    expect(await header.isVisible()).toBeTruthy();
    expect(await header.innerText()).toContain("FinCoach");
  });

  test("theme toggle exists", async ({ pwaPage }) => {
    const toggle = pwaPage.locator(".theme-toggle");
    expect(await toggle.count()).toBe(1);
  });
});

// ============================================================================
// Data Persistence
// ============================================================================

test.describe("TestDataPersistence", () => {
  test("data survives reload", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(".bottom-nav", { timeout: 10_000 });

    await page.evaluate(async () => {
      await DB.createAccount({ name: "Persist Test", account_type: "savings", balance: 9999 });
    });

    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForSelector(".bottom-nav", { timeout: 10_000 });

    await page.evaluate(() => {
      window.location.hash = "#/accounts";
    });
    await page.waitForSelector("#screen");

    const text = await page.innerText("body");
    expect(text.toLowerCase()).toContain("persist test");
  });
});
