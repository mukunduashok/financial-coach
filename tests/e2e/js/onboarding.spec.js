// tests/e2e/js/onboarding.spec.js
import { test as base, expect } from "@playwright/test";

/**
 * freshPage — clears ALL IndexedDB databases and ALL localStorage before
 * reloading the app. This means the onboarding wizard will appear, because
 * "fincoach-onboarded" is never set.
 */
const test = base.extend({
  freshPage: async ({ page }, use) => {
    await page.goto("/");

    await page.evaluate(async () => {
      // Clear IndexedDB
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.map(
          (db) =>
            new Promise((resolve) => {
              const req = indexedDB.deleteDatabase(db.name);
              req.onsuccess = resolve;
              req.onerror = resolve;
              req.onblocked = resolve;
            }),
        ),
      );
      // Clear all localStorage so the wizard triggers
      localStorage.clear();
    });

    await page.reload();
    // Wait for either the wizard or the bottom-nav (whichever appears first)
    await page.waitForSelector("#onboarding-wizard, .bottom-nav", { timeout: 15_000 });

    await use(page);
  },
});

// ---------------------------------------------------------------------------
// Helper: navigate through wizard steps programmatically
// ---------------------------------------------------------------------------
async function advanceToStep(page, targetStep) {
  // Set the step in localStorage and reload so checkOnboarding picks it up
  await page.evaluate((step) => {
    localStorage.removeItem("fincoach-onboarded");
    localStorage.setItem("fincoach-onboarding-step", String(step));
  }, targetStep);
  await page.reload();
  await page.waitForSelector("#onboarding-wizard", { timeout: 15_000 });
}

// ===========================================================================
test.describe("OnboardingWizard", () => {
  // -------------------------------------------------------------------------
  // 1. wizard appears on first load
  // -------------------------------------------------------------------------
  test("wizard appears on first load", async ({ freshPage }) => {
    const wizard = freshPage.locator("#onboarding-wizard");
    await expect(wizard).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. wizard does not appear after onboarding completed
  // -------------------------------------------------------------------------
  test("wizard does not appear after onboarding completed", async ({ freshPage }) => {
    // Mark as onboarded before loading the real content
    await freshPage.evaluate(() => {
      localStorage.setItem("fincoach-onboarded", "true");
    });
    await freshPage.reload();
    await freshPage.waitForSelector(".bottom-nav", { timeout: 15_000 });

    const wizard = freshPage.locator("#onboarding-wizard");
    expect(await wizard.count()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 3. step indicator shows 5 dots, first is active on step 1
  // -------------------------------------------------------------------------
  test("step indicator shows 5 dots", async ({ freshPage }) => {
    await freshPage.waitForSelector("#onboarding-wizard", { timeout: 15_000 });
    const dots = freshPage.locator(".onboarding-dot");
    await expect(dots).toHaveCount(5);

    const activeDots = freshPage.locator(".onboarding-dot.active");
    await expect(activeDots).toHaveCount(1);
    // The FIRST dot should be active
    const firstDotActive = await freshPage
      .locator(".onboarding-dot")
      .first()
      .evaluate((el) => el.classList.contains("active"));
    expect(firstDotActive).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. global skip button exits wizard
  // -------------------------------------------------------------------------
  test("global skip button exits wizard", async ({ freshPage }) => {
    await freshPage.waitForSelector("#onboarding-wizard", { timeout: 15_000 });

    await freshPage.locator(".onboarding-skip-link").click();
    await freshPage.waitForTimeout(500);

    const wizard = freshPage.locator("#onboarding-wizard");
    expect(await wizard.count()).toBe(0);

    const onboarded = await freshPage.evaluate(() =>
      localStorage.getItem("fincoach-onboarded"),
    );
    expect(onboarded).toBe("true");
  });

  // -------------------------------------------------------------------------
  // 5. step 1 advance to step 2
  // -------------------------------------------------------------------------
  test("step 1 advance to step 2", async ({ freshPage }) => {
    await freshPage.waitForSelector("#onboarding-wizard", { timeout: 15_000 });

    await freshPage.locator("button[data-action='onboarding-next']").click();
    await freshPage.waitForTimeout(500);

    const headline = await freshPage.locator(".onboarding-headline").innerText();
    expect(headline).toContain("How transactions are tracked");
  });

  // -------------------------------------------------------------------------
  // 6. step 2 next advances to step 3
  // -------------------------------------------------------------------------
  test("step 2 next advances to step 3", async ({ freshPage }) => {
    await advanceToStep(freshPage, 2);

    await freshPage.locator("button[data-action='onboarding-next']").click();
    await freshPage.waitForTimeout(500);

    const headline = await freshPage.locator(".onboarding-headline").innerText();
    expect(headline).toContain("Auto-import");
  });

  // -------------------------------------------------------------------------
  // 7. step 3 per-step skip advances to step 4
  // -------------------------------------------------------------------------
  test("step 3 per-step skip advances to step 4", async ({ freshPage }) => {
    await advanceToStep(freshPage, 3);

    await freshPage.locator("button[data-action='onboarding-step-skip']").click();
    await freshPage.waitForTimeout(500);

    const headline = await freshPage.locator(".onboarding-headline").innerText();
    expect(headline).toContain("Get a personal financial coach");
  });

  // -------------------------------------------------------------------------
  // 8. step 4 per-step skip advances to step 5
  // -------------------------------------------------------------------------
  test("step 4 per-step skip advances to step 5", async ({ freshPage }) => {
    await advanceToStep(freshPage, 4);

    await freshPage.locator("button[data-action='onboarding-step-skip']").click();
    await freshPage.waitForTimeout(1000);

    const headline = await freshPage.locator(".onboarding-headline").innerText();
    expect(headline.toLowerCase()).toContain("all set");
  });

  // -------------------------------------------------------------------------
  // 9. step 5 go to dashboard completes onboarding
  // -------------------------------------------------------------------------
  test("step 5 go to dashboard completes onboarding", async ({ freshPage }) => {
    await advanceToStep(freshPage, 5);

    await freshPage.locator("button[data-action='onboarding-next']").click();
    await freshPage.waitForTimeout(1000);

    const wizard = freshPage.locator("#onboarding-wizard");
    expect(await wizard.count()).toBe(0);

    // URL hash should be #/ (dashboard)
    const hash = await freshPage.evaluate(() => window.location.hash);
    expect(["#/", "", "#"]).toContain(hash);
  });

  // -------------------------------------------------------------------------
  // 10. wizard resumes from saved step
  // -------------------------------------------------------------------------
  test("wizard resumes from saved step", async ({ freshPage }) => {
    // Set step 3 before reload
    await freshPage.evaluate(() => {
      localStorage.removeItem("fincoach-onboarded");
      localStorage.setItem("fincoach-onboarding-step", "3");
    });
    await freshPage.reload();
    await freshPage.waitForSelector("#onboarding-wizard", { timeout: 15_000 });

    const headline = await freshPage.locator(".onboarding-headline").innerText();
    expect(headline).toContain("Auto-import");
  });

  // -------------------------------------------------------------------------
  // 11. restart onboarding from settings
  // -------------------------------------------------------------------------
  test("restart onboarding from settings", async ({ freshPage }) => {
    // Mark as onboarded so the app loads normally first
    await freshPage.evaluate(() => {
      localStorage.setItem("fincoach-onboarded", "true");
    });
    await freshPage.reload();
    await freshPage.waitForSelector(".bottom-nav", { timeout: 15_000 });

    // Navigate to settings
    await freshPage.evaluate(() => {
      window.location.hash = "#/settings";
    });
    await freshPage.waitForSelector("#screen", { timeout: 10_000 });
    await freshPage.waitForTimeout(500);

    // Click "Restart onboarding tour"
    await freshPage.locator("button[data-action='restart-onboarding']").click();
    await freshPage.waitForTimeout(500);

    const wizard = freshPage.locator("#onboarding-wizard");
    await expect(wizard).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 12. step 5 Gmail connected status — shows email when connected
  // -------------------------------------------------------------------------
  test("step 5 does not treat plaintext Gmail tokens in localStorage as connected", async ({ freshPage }) => {
    // Plaintext localStorage tokens should no longer count as connected state.
    await freshPage.evaluate(() => {
      localStorage.setItem(
        "fincoach-gmail-settings",
        JSON.stringify({
          accessToken: "fake-tok",
          refreshToken: "fake-ref",
          email: "test@gmail.com",
        }),
      );
    });
    await advanceToStep(freshPage, 5);
    await freshPage.waitForTimeout(500);

    const list = freshPage.locator(".onboarding-summary-list");
    await expect(list).toBeVisible();
    const text = await list.innerText();
    expect(text).toContain("Gmail not connected");
    expect(text).not.toContain("Gmail connected");
  });

  // -------------------------------------------------------------------------
  // 13. step 5 Gmail not connected — shows fallback link
  // -------------------------------------------------------------------------
  test("step 5 shows Gmail not connected fallback when no Gmail settings in localStorage", async ({ freshPage }) => {
    // freshPage fixture already cleared localStorage; no Gmail tokens present
    await advanceToStep(freshPage, 5);
    await freshPage.waitForTimeout(500);

    const list = freshPage.locator(".onboarding-summary-list");
    await expect(list).toBeVisible();
    const text = await list.innerText();
    expect(text).toContain("Gmail not connected");
  });

  // -------------------------------------------------------------------------
  // 14. step 5 Gmail connected without email — still shows "connected"
  //     (regression guard: old code checked gmailStatus.email, not .connected)
  // -------------------------------------------------------------------------
  test("step 5 does not treat plaintext Gmail tokens without email as connected", async ({ freshPage }) => {
    // Plaintext localStorage tokens should no longer count as connected state.
    await freshPage.evaluate(() => {
      localStorage.setItem(
        "fincoach-gmail-settings",
        JSON.stringify({
          accessToken: "fake-tok",
          refreshToken: "fake-ref",
          // no email key
        }),
      );
    });
    await advanceToStep(freshPage, 5);
    await freshPage.waitForTimeout(500);

    const list = freshPage.locator(".onboarding-summary-list");
    await expect(list).toBeVisible();
    const text = await list.innerText();
    expect(text).toContain("Gmail not connected");
    expect(text).not.toContain("@");
  });

});
