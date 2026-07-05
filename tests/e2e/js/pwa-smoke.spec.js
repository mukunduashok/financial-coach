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

  test("env.js sets window.__FINCOACH_CONFIG__ before the app boots", async ({ pwaPage }) => {
    const cfg = await pwaPage.evaluate(() => window.__FINCOACH_CONFIG__);
    expect(cfg).toBeTruthy();
    expect(typeof cfg.GMAIL_PROXY_URL).toBe("string");
    expect(cfg.GMAIL_PROXY_URL.length).toBeGreaterThan(0);

    // The app still boots and the DB initialises with the config script present.
    const seeded = await pwaPage.evaluate(async () => (await DB.getCategories()).length);
    expect(seeded).toBe(EXPECTED_SEED_CATEGORIES);
  });

  test("config.js resolves GMAIL_PROXY_URL from the env.js global at boot", async ({ page }) => {
    // Stub /js/env.js to inject a distinct proxy URL, then load the app fresh.
    // config.js (imported at boot, after env.js runs) must resolve to this value,
    // proving the real load-order wiring: env.js -> window.__FINCOACH_CONFIG__ -> config.js.
    const custom = "https://e2e-stub-worker.example.dev";
    await page.route("**/js/env.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.__FINCOACH_CONFIG__ = { GMAIL_PROXY_URL: "${custom}" };`,
      }),
    );
    await page.addInitScript(() => {
      localStorage.setItem("fincoach-onboarded", "true");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".bottom-nav", { timeout: 30_000 });

    const [globalUrl, resolved] = await page.evaluate(async () => {
      const mod = await import("/js/config.js");
      return [window.__FINCOACH_CONFIG__?.GMAIL_PROXY_URL, mod.GMAIL_PROXY_URL];
    });
    expect(globalUrl).toBe(custom);
    expect(resolved).toBe(custom);
  });

  test("config.js falls back to the placeholder when env.js sets no global", async ({ page }) => {
    // Stub env.js so it does NOT define window.__FINCOACH_CONFIG__.
    await page.route("**/js/env.js", (route) =>
      route.fulfill({ contentType: "application/javascript", body: "/* no config */" }),
    );
    await page.addInitScript(() => {
      localStorage.setItem("fincoach-onboarded", "true");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".bottom-nav", { timeout: 30_000 });

    const resolved = await page.evaluate(async () => {
      const mod = await import("/js/config.js");
      return mod.GMAIL_PROXY_URL;
    });
    expect(resolved).toBe("https://your-worker.your-subdomain.workers.dev");
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
