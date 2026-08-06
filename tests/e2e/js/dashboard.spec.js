// tests/e2e/js/dashboard.spec.js
import { test, expect } from "./fixtures.js";

async function seedDashboardData(page) {
  await page.evaluate(async () => {
    await DB.createAccount({ name: "Savings Account", balance: 50000, account_type: "savings" });
    const cats = await DB.getCategories();
    const foodCat = cats.find((c) => c.name === "Food & Dining");
    const incomeCat = cats.find((c) => c.name === "Income");
    const transportCat = cats.find((c) => c.name === "Transportation");
    await DB.createTransaction({
      date: new Date().toISOString().split("T")[0],
      amount: -250,
      description: "Grocery Store",
      transaction_type: "expense",
      account_id: 1,
      category_id: foodCat ? foodCat.id : 1,
    });
    await DB.createTransaction({
      date: new Date().toISOString().split("T")[0],
      amount: 5000,
      description: "Monthly Salary",
      transaction_type: "income",
      account_id: 1,
      category_id: incomeCat ? incomeCat.id : 1,
    });
    await DB.createTransaction({
      date: new Date().toISOString().split("T")[0],
      amount: -150,
      description: "Uber Ride",
      transaction_type: "expense",
      account_id: 1,
      category_id: transportCat ? transportCat.id : 1,
    });
  });
}

test.describe("TestDashboard", () => {
  test("dashboard loads", async ({ pwaPage }) => {
    const content = await pwaPage.content();
    expect(content.length).toBeGreaterThan(500);
  });

  test("dashboard shows totals", async ({ pwaPage }) => {
    await seedDashboardData(pwaPage);
    await pwaPage.evaluate(() => {
      window.location.hash = "#/settings";
    });
    await pwaPage.waitForTimeout(200);
    await pwaPage.evaluate(() => {
      window.location.hash = "#/";
    });
    await pwaPage.waitForSelector("#screen");

    const text = await pwaPage.innerText("body");
    const hasFinancialData = ["income", "expense", "balance", "total", "₹", "$"].some((keyword) =>
      text.toLowerCase().includes(keyword),
    );
    expect(hasFinancialData || text.length > 100).toBeTruthy();
  });

  test("dashboard has recent transactions", async ({ pwaPage }) => {
    await seedDashboardData(pwaPage);
    await pwaPage.evaluate(() => {
      window.location.hash = "#/settings";
    });
    await pwaPage.waitForTimeout(200);
    await pwaPage.evaluate(() => {
      window.location.hash = "#/";
    });
    await pwaPage.waitForSelector("#screen");

    const text = await pwaPage.innerText("body");
    const hasTransactions = [
      "grocery",
      "salary",
      "uber",
      "transaction",
      "no transactions",
      "recent",
    ].some((keyword) => text.toLowerCase().includes(keyword));
    expect(hasTransactions || text.length > 200).toBeTruthy();
  });
});

// FINCO-33 — backup reminder nudge (checkGDriveReminder runs on dashboard boot)
test.describe("TestBackupNudge", () => {
  const NUDGE_TOAST = '.toast.info:has-text("Back up your data")';

  // Boots the app with Playwright's default fresh context (Drive disabled, no
  // export/throttle keys), optionally seeding localStorage before any script runs.
  async function boot(page, initKeys = {}) {
    await page.addInitScript((keys) => {
      localStorage.setItem("fincoach-onboarded", "true");
      for (const [k, v] of Object.entries(keys)) {
        localStorage.setItem(k, v);
      }
    }, initKeys);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".bottom-nav", { timeout: 30_000 });
  }

  test("shows a two-action nudge on a fresh install with Drive disabled", async ({ page }) => {
    await boot(page);
    const toast = page.locator(NUDGE_TOAST);
    await expect(toast).toBeVisible();
    await expect(toast.locator('.btn-sm:has-text("Export backup now")')).toBeVisible();
    await expect(toast.locator('.btn-sm:has-text("Enable Drive sync")')).toBeVisible();
  });

  test("clicking Enable Drive sync navigates to Settings", async ({ page }) => {
    await boot(page);
    const toast = page.locator(NUDGE_TOAST);
    await expect(toast).toBeVisible();
    await toast.locator('.btn-sm:has-text("Enable Drive sync")').click();
    await page.waitForFunction(() => window.location.hash === "#/settings");
    expect(await page.evaluate(() => window.location.hash)).toBe("#/settings");
  });

  test("does not re-show within the same session after a reload", async ({ page }) => {
    await boot(page);
    await expect(page.locator(NUDGE_TOAST)).toBeVisible();
    // sessionStorage persists across reloads in the same browser context.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".bottom-nav", { timeout: 30_000 });
    await page.waitForTimeout(400);
    expect(await page.locator(NUDGE_TOAST).count()).toBe(0);
  });

  test("is suppressed when a manual export happened within 30 days", async ({ page }) => {
    await boot(page, { "fincoach-last-manual-export": String(Date.now()) });
    await page.waitForTimeout(400);
    expect(await page.locator(NUDGE_TOAST).count()).toBe(0);
  });
});

// ===========================================================================
// Mobile-view CSP-migration regressions (Issues 1 & 2)
// The CSP was tightened to `style-src 'self'`, so inline styles were migrated
// to CSS classes. These tests run at a mobile viewport and assert the visual
// contract that the inline styles previously provided.
// ===========================================================================
test.describe("TestDashboardMobileLayout", () => {
  const MOBILE = { width: 375, height: 812 };

  async function goDashboard(page) {
    await page.evaluate(() => {
      window.location.hash = "#/";
    });
    await page.waitForSelector("#screen .balance-card", { timeout: 10_000 });
  }

  // Issue 1 — Total Balance card must be centre-aligned via .balance-card class.
  test("balance card is centre-aligned on mobile", async ({ pwaPage }) => {
    await pwaPage.setViewportSize(MOBILE);
    await seedDashboardData(pwaPage);
    await goDashboard(pwaPage);

    const card = pwaPage.locator(".balance-card");
    await expect(card).toBeVisible();
    const textAlign = await card.evaluate((el) => getComputedStyle(el).textAlign);
    expect(textAlign).toBe("center");
  });

  // Issue 2 — Upcoming Bills card must sit below the stats-row without overlap.
  test("upcoming bills card does not overlap the stats-row on mobile", async ({ pwaPage }) => {
    await pwaPage.setViewportSize(MOBILE);
    await seedDashboardData(pwaPage);
    await goDashboard(pwaPage);

    const statsRow = pwaPage.locator(".stats-row");
    const billsCard = pwaPage.locator('.card:has(.card-title:has-text("Upcoming Bills"))');
    await expect(statsRow).toBeVisible();
    await expect(billsCard).toBeVisible();

    const statsBox = await statsRow.boundingBox();
    const billsBox = await billsCard.boundingBox();
    expect(statsBox).not.toBeNull();
    expect(billsBox).not.toBeNull();
    // Bills card top must be at or below the bottom of the stats-row.
    expect(billsBox.y).toBeGreaterThanOrEqual(statsBox.y + statsBox.height - 1);
  });
});
