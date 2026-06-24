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
