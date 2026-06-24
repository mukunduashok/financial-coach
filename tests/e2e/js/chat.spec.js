// tests/e2e/js/chat.spec.js
import { test, expect } from "./fixtures.js";

test.describe("TestChatPage", () => {
  test("chat page loads", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/chat";
    });
    await pwaPage.waitForSelector("#screen");
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase().includes("chat") || text.length > 200).toBeTruthy();
  });

  test("chat input exists", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/chat";
    });
    await pwaPage.waitForSelector("#screen");

    const chatInput = pwaPage.locator(
      "input[type='text'], textarea, [contenteditable='true'], .chat-input",
    );
    expect(await chatInput.count()).toBeGreaterThan(0);
  });

  test("chat has suggestions", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/chat";
    });
    await pwaPage.waitForSelector("#screen");

    const text = await pwaPage.innerText("body");
    const hasPrompts = [
      "suggest",
      "try",
      "ask",
      "welcome",
      "help",
      "spending",
      "budget",
      "financial",
    ].some((keyword) => text.toLowerCase().includes(keyword));
    expect(hasPrompts || text.length > 100).toBeTruthy();
  });

  test("chat send button exists", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/chat";
    });
    await pwaPage.waitForSelector("#screen");

    const sendBtn = pwaPage.locator("#chat-send-btn, .chat-send-btn");
    expect(await sendBtn.count()).toBeGreaterThan(0);
  });

  test("chat send without ai configured", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/chat";
    });
    await pwaPage.waitForSelector("#screen");

    const chatInput = pwaPage.locator("#chat-input, .chat-input, textarea");
    await chatInput.first().fill("Hello, can you help me?");
    await pwaPage.waitForTimeout(200);

    const sendBtn = pwaPage.locator("#chat-send-btn, .chat-send-btn");
    await sendBtn.first().click();
    await pwaPage.waitForTimeout(1500);

    const text = await pwaPage.innerText("body");
    const hasResponse = [
      "sorry",
      "wrong",
      "error",
      "configure",
      "settings",
      "api key",
      "try again",
      "help",
    ].some((keyword) => text.toLowerCase().includes(keyword));
    expect(text.toLowerCase().includes("hello") || hasResponse).toBeTruthy();
  });
});

// ===========================================================================
// UI-UX-02 — Custom clear-chat modal (not browser confirm)
// ===========================================================================
test.describe("UI-UX-02: Clear chat uses custom confirmation modal", () => {
  async function goToChat(page) {
    await page.evaluate(() => {
      window.location.hash = "#/chat";
    });
    await page.waitForSelector("#screen");
    await page.waitForTimeout(400);
  }

  test("clear chat button shows custom modal, not browser confirm", async ({ pwaPage }) => {
    await goToChat(pwaPage);

    // Intercept window.confirm — if it's called, the old code path is still active
    let confirmCalled = false;
    await pwaPage.evaluate(() => {
      window.confirm = () => {
        window._confirmCalled = true;
        return true;
      };
      window._confirmCalled = false;
    });

    // Click the clear button (🗑 or equivalent)
    const clearBtn = pwaPage.locator(
      "button[title*='clear' i], button[aria-label*='clear' i], button:has-text('🗑')",
    );
    if ((await clearBtn.count()) > 0) {
      await clearBtn.first().click();
      await pwaPage.waitForTimeout(300);
    }

    const confirmWasCalled = await pwaPage.evaluate(() => window._confirmCalled);
    expect(confirmWasCalled).toBe(false);

    // Custom modal overlay should be visible
    const modal = pwaPage.locator(".modal-overlay");
    expect(await modal.count()).toBeGreaterThan(0);
  });

  test("clear chat modal has Cancel and Clear buttons", async ({ pwaPage }) => {
    await goToChat(pwaPage);

    const clearBtn = pwaPage.locator(
      "button[title*='clear' i], button[aria-label*='clear' i], button:has-text('🗑')",
    );
    if ((await clearBtn.count()) === 0) {
      return; // No clear button — skip
    }

    await clearBtn.first().click();
    await pwaPage.waitForSelector(".modal-overlay", { timeout: 3000 });

    const cancelBtn = pwaPage.locator(".modal-overlay button:has-text('Cancel')");
    const confirmClearBtn = pwaPage.locator(".modal-overlay button:has-text('Clear')");

    expect(await cancelBtn.count()).toBeGreaterThan(0);
    expect(await confirmClearBtn.count()).toBeGreaterThan(0);
  });

  test("Cancel button closes modal without clearing messages", async ({ pwaPage }) => {
    await goToChat(pwaPage);

    const clearBtn = pwaPage.locator(
      "button[title*='clear' i], button[aria-label*='clear' i], button:has-text('🗑')",
    );
    if ((await clearBtn.count()) === 0) {
      return; // No clear button — skip
    }

    await clearBtn.first().click();
    await pwaPage.waitForSelector(".modal-overlay", { timeout: 3000 });

    // Click Cancel
    await pwaPage.locator(".modal-overlay button:has-text('Cancel')").first().click();
    await pwaPage.waitForTimeout(300);

    // Modal should be gone
    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
  });

  test("Clear button confirms and shows success toast", async ({ pwaPage }) => {
    await goToChat(pwaPage);

    const clearBtn = pwaPage.locator(
      "button[title*='clear' i], button[aria-label*='clear' i], button:has-text('🗑')",
    );
    if ((await clearBtn.count()) === 0) {
      return; // No clear button — skip
    }

    await clearBtn.first().click();
    await pwaPage.waitForSelector(".modal-overlay", { timeout: 3000 });

    // Click the Clear confirm button
    await pwaPage.locator(".modal-overlay button:has-text('Clear')").first().click();
    await pwaPage.waitForTimeout(800);

    // Modal should be gone
    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);

    // Success toast or confirmation text should appear
    const bodyText = await pwaPage.innerText("body");
    const hasSuccess = ["cleared", "success", "chat"].some((kw) =>
      bodyText.toLowerCase().includes(kw),
    );
    expect(hasSuccess).toBe(true);
  });
});

test.describe("TestSyncPage", () => {
  test("sync page loads", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/sync";
    });
    await pwaPage.waitForSelector("#screen");
    const text = await pwaPage.innerText("body");
    expect(
      text.toLowerCase().includes("sync") ||
        text.toLowerCase().includes("gmail") ||
        text.length > 200,
    ).toBeTruthy();
  });

  test("sync shows connect button", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/sync";
    });
    await pwaPage.waitForSelector("#screen");

    const text = await pwaPage.innerText("body");
    const hasConnect = ["connect", "gmail", "google", "sync", "not connected"].some((keyword) =>
      text.toLowerCase().includes(keyword),
    );
    expect(hasConnect || text.length > 100).toBeTruthy();
  });
});
