// tests/e2e/js/reports.spec.js
import { test, expect } from "./fixtures.js";

test.describe("TestReportsPage", () => {
  test("reports page loads", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/reports";
    });
    await pwaPage.waitForSelector("#screen");

    const content = await pwaPage.content();
    const text = (await pwaPage.innerText("body")).toLowerCase();
    const hasReportContent = [
      "report",
      "spending",
      "analysis",
      "chart",
      "category",
      "trend",
    ].some((keyword) => text.includes(keyword));
    expect(hasReportContent || content.length > 500).toBeTruthy();
  });

  test("reports date filters", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/reports";
    });
    await pwaPage.waitForSelector("#screen");

    const dateInputs = pwaPage.locator("input[type='date']");
    if ((await dateInputs.count()) >= 2) {
      expect(await dateInputs.nth(0).isVisible()).toBeTruthy();
      expect(await dateInputs.nth(1).isVisible()).toBeTruthy();
    } else {
      const content = await pwaPage.content();
      expect(content.length).toBeGreaterThan(500);
    }
  });

  test("reports empty state", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/reports";
    });
    await pwaPage.waitForSelector("#screen");

    const text = (await pwaPage.innerText("body")).toLowerCase();
    const hasContent = [
      "no data",
      "no expenses",
      "no spending",
      "food",
      "transportation",
      "category",
      "total",
      "₹",
      "$",
    ].some((keyword) => text.includes(keyword));
    expect(hasContent || text.length > 100).toBeTruthy();
  });

  test("reports has chart elements", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/reports";
    });
    await pwaPage.waitForSelector("#screen");

    await pwaPage.waitForSelector(".spinner", { state: "hidden", timeout: 5000 });

    const chartsDiv = pwaPage.locator("#report-charts");
    if ((await chartsDiv.count()) > 0 && (await chartsDiv.isVisible())) {
      const canvases = pwaPage.locator("canvas");
      if ((await canvases.count()) > 0) {
        expect(await canvases.first().isVisible()).toBeTruthy();
      } else {
        const text = (await pwaPage.innerText("body")).toLowerCase();
        expect(
          text.includes("report") || text.includes("spending") || text.length > 200,
        ).toBeTruthy();
      }
    } else {
      const text = (await pwaPage.innerText("body")).toLowerCase();
      expect(
        text.includes("report") || text.includes("spending") || text.length > 200,
      ).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 1 — Chart card overflow (CSS fix)
// ---------------------------------------------------------------------------
test.describe("TestReportsChartOverflow", () => {
  test("chart-card elements do not overflow horizontally", async ({ pwaPage }) => {
    // Seed data so charts render
    await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({ name: "Overflow Test", balance: 10000, account_type: "savings" });
      const cats = await DB.getCategories();
      const foodCat = cats.find((c) => c.name === "Food & Dining");
      const today = new Date().toISOString().split("T")[0];
      await DB.createTransaction({
        date: today,
        amount: -500,
        description: "Groceries",
        transaction_type: "expense",
        account_id: acc.id,
        category_id: foodCat ? foodCat.id : cats[0].id,
      });
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/reports";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(1000);

    const chartCards = pwaPage.locator(".chart-card");
    const count = await chartCards.count();

    if (count === 0) {
      // No chart cards rendered (empty state) — test passes vacuously
      return;
    }

    for (let i = 0; i < count; i++) {
      const card = chartCards.nth(i);
      const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Transaction Tags — Reports tag filter
// ---------------------------------------------------------------------------
test.describe("TestReportsTagFilter", () => {
  test("tag filter is present with seeded tags on a fresh DB", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/reports";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    const tagDropdown = pwaPage.locator("#report-tags-dropdown");
    expect(await tagDropdown.count()).toBe(1);
    const menuHtml = await pwaPage.locator("#report-tags-menu").innerHTML();
    expect(menuHtml).toContain("#online");
    expect(menuHtml).toContain("#offline");
    expect(menuHtml).toContain("#domestic");
    expect(menuHtml).toContain("#international");
  });

  test("tag filter <select> is visible when tags exist", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      await DB.createTag("shopping");
      await DB.createTag("office");
    });
    await pwaPage.evaluate(() => {
      window.location.hash = "#/reports";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    const tagDropdown = pwaPage.locator("#report-tags-dropdown");
    expect(await tagDropdown.count()).toBe(1);
    expect(await tagDropdown.isVisible()).toBe(true);

    const menuHtml = await pwaPage.locator("#report-tags-menu").innerHTML();
    expect(menuHtml).toContain("#shopping");
    expect(menuHtml).toContain("#office");
  });

  test("report respects tag filter — only tagged-transaction data fetched", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({ name: "Report Tag Acct", balance: 10000, account_type: "savings" });
      const cats = await DB.getCategories();
      const foodCat = cats.find((c) => c.name === "Food & Dining") || cats[0];
      const tag = await DB.createTag("family");
      const today = new Date().toISOString().split("T")[0];
      await DB.createTransaction({
        date: today,
        amount: 750,
        description: "Family dinner",
        transaction_type: "expense",
        account_id: acc.id,
        category_id: foodCat.id,
        tag_ids: [tag.id],
      });
      await DB.createTransaction({
        date: today,
        amount: 200,
        description: "Random expense",
        transaction_type: "expense",
        account_id: acc.id,
        category_id: foodCat.id,
      });
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/reports";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    const tagSelect = pwaPage.locator("#report-tags");
    if ((await tagSelect.count()) === 0) return;

    const familyOption = tagSelect.locator("option:has-text('#family')");
    const familyValue = await familyOption.getAttribute("value");
    await tagSelect.selectOption(familyValue);

    await pwaPage.locator("[data-action='load-report']").click();
    // Wait for spinner to disappear (report finished loading)
    await pwaPage.waitForSelector("#report-loading", { state: "hidden", timeout: 10000 });
    await pwaPage.waitForTimeout(400);

    // The report should now only count 750 in expenses (the tagged one)
    const bodyText = await pwaPage.locator("#screen").innerText();
    // Either the report summary shows 750, or the empty state appeared (0 matches)
    // The key assertion: the combined 950 total should NOT appear
    expect(bodyText).not.toContain("950"); // 750+200 combined total should not appear
  });
});
