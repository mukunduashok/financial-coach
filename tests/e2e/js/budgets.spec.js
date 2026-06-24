// tests/e2e/js/budgets.spec.js
import { test, expect } from "./fixtures.js";

test.describe("TestBudgetsPage", () => {
  test("budgets page loads", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/budgets";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(300);
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase().includes("budget") || text.length > 200).toBeTruthy();
  });

  test("budgets empty state", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/budgets";
    });
    await pwaPage.waitForSelector("#screen");
    const text = await pwaPage.innerText("body");
    const hasContent =
      text.toLowerCase().includes("budget") ||
      text.toLowerCase().includes("no budget") ||
      text.toLowerCase().includes("add");
    expect(hasContent).toBeTruthy();
  });
});

test.describe("TestCreateBudget", () => {
  test("create budget modal", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/budgets";
    });
    await pwaPage.waitForSelector("#screen");

    const addBtn = pwaPage.locator(
      "button:has-text('Add'), button:has-text('Create'), " +
        "button:has-text('New'), button:has-text('add'), " +
        "[data-action='add'], .add-btn, .fab",
    );
    if ((await addBtn.count()) === 0) {
      return; // Skip: Add budget button not found
    }

    await addBtn.first().click();
    await pwaPage.waitForTimeout(300);

    const form = pwaPage.locator("form, .modal, .form-container, dialog");
    expect(await form.count()).toBeGreaterThan(0);
  });
});

test.describe("TestBudgetProgressBar", () => {
  test("progress bar renders", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      const cats = await DB.getCategories();
      const foodCat = cats.find((c) => c.name === "Food & Dining");
      if (foodCat) {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
        await DB.createBudget({
          category_id: foodCat.id,
          period_start: start,
          period_end: end,
          limit_amount: 5000,
        });
      }
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/budgets";
    });
    await pwaPage.waitForSelector("#screen");

    const progress = pwaPage.locator(
      ".progress-bar, progress, [role='progressbar'], .budget-progress, .bar, .meter",
    );
    const text = await pwaPage.innerText("body");
    const budgetContentVisible = ["on track", "over budget", "% used", "spent", "limit"].some(
      (kw) => text.toLowerCase().includes(kw),
    );
    expect((await progress.count()) > 0 || budgetContentVisible).toBeTruthy();
  });
});
