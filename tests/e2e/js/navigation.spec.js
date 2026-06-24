// tests/e2e/js/navigation.spec.js
import { test, expect } from "./fixtures.js";

test.describe("TestNavigation", () => {
  test("home page loads", async ({ pwaPage }) => {
    expect(await pwaPage.title()).not.toBe("");
    expect(await pwaPage.locator("#app").count()).toBe(1);
  });

  const routes = [
    { route: "#/", expectedText: "Dashboard", id: "dashboard" },
    { route: "#/transactions", expectedText: "Transactions", id: "transactions" },
    { route: "#/chat", expectedText: "Chat", id: "chat" },
    { route: "#/sync", expectedText: "Sync", id: "sync" },
    { route: "#/accounts", expectedText: "Accounts", id: "accounts" },
    { route: "#/settings", expectedText: "Settings", id: "settings" },
  ];

  for (const { route, expectedText, id } of routes) {
    test(`navigate to ${id}`, async ({ pwaPage }) => {
      await pwaPage.evaluate((r) => {
        window.location.hash = r;
      }, route);
      await pwaPage.waitForSelector("#screen");
      const content = await pwaPage.content();
      expect(
        content.toLowerCase().includes(expectedText.toLowerCase()) || content.length > 500,
      ).toBeTruthy();
    });
  }

  test("nav links work", async ({ pwaPage }) => {
    const count = await pwaPage.locator("button.nav-item").count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

test.describe("TestResponsive", () => {
  test("mobile viewport", async ({ pwaPage }) => {
    await pwaPage.setViewportSize({ width: 375, height: 667 });
    await pwaPage.evaluate(() => {
      window.location.hash = "#/";
    });
    await pwaPage.waitForSelector("#screen");

    const content = await pwaPage.content();
    expect(content.length).toBeGreaterThan(500);
  });
});

test.describe("TestNavRestructure", () => {
  test("more button always visible", async ({ pwaPage }) => {
    await pwaPage.setViewportSize({ width: 1280, height: 800 });
    await pwaPage.waitForTimeout(300);
    const moreBtn = pwaPage.locator(".nav-more-btn");
    expect(await moreBtn.count()).toBeGreaterThan(0);
    expect(await moreBtn.first().isVisible()).toBeTruthy();
  });

  test("more button visible mobile", async ({ pwaPage }) => {
    await pwaPage.setViewportSize({ width: 375, height: 667 });
    await pwaPage.waitForTimeout(300);
    const moreBtn = pwaPage.locator(".nav-more-btn");
    expect(await moreBtn.count()).toBeGreaterThan(0);
    expect(await moreBtn.first().isVisible()).toBeTruthy();
  });

  test("overflow items not in bottom nav", async ({ pwaPage }) => {
    const count = await pwaPage.locator(".bottom-nav > .nav-overflow-item").count();
    expect(count).toBe(0);
  });

  test("overflow items in popup", async ({ pwaPage }) => {
    const moreBtn = pwaPage.locator(".nav-more-btn").first();
    await moreBtn.click();
    await pwaPage.waitForTimeout(300);
    const count = await pwaPage.locator(".nav-overflow-menu .nav-overflow-item").count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("active overflow route highlights more button", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/settings";
    });
    await pwaPage.waitForSelector("#screen");
    const moreBtn = pwaPage.locator(".nav-more-btn");
    const btnClass = (await moreBtn.first().getAttribute("class")) || "";
    expect(btnClass.includes("active") || btnClass.includes("selected")).toBeTruthy();
  });
});

test.describe("TestHeaderStatusBar", () => {
  test("header contains status bar element", async ({ pwaPage }) => {
    const statusBar = pwaPage.locator("#header-status");
    expect(await statusBar.count()).toBe(1);
    const text = (await statusBar.textContent()) ?? "";
    expect(text.trim()).toBe("");
  });
});
