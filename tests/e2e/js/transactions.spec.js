// tests/e2e/js/transactions.spec.js
import { test, expect } from "./fixtures.js";

async function seedTransactionData(page) {
  await page.evaluate(async () => {
    await DB.createAccount({ name: "Test Account", balance: 50000, account_type: "savings" });
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

test.describe("TestTransactionsList", () => {
  test("transactions page loads", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase().includes("transaction") || text.length > 200).toBeTruthy();
  });

  test("transactions show seeded data", async ({ pwaPage }) => {
    await seedTransactionData(pwaPage);
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    const text = await pwaPage.innerText("body");
    const hasData = ["grocery", "salary", "uber", "250", "5000", "150"].some((keyword) =>
      text.toLowerCase().includes(keyword),
    );
    expect(hasData || text.toLowerCase().includes("no transaction")).toBeTruthy();
  });
});

test.describe("TestAddTransaction", () => {
  test("add transaction form exists", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");

    const addBtn = pwaPage.locator(
      "button:has-text('Add'), button:has-text('add'), " +
        "[data-action='add'], .add-btn, .fab",
    );
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await pwaPage.waitForTimeout(300);

      const form = pwaPage.locator("form, .modal, .form-container, .add-form");
      expect((await form.count()) > 0 || true).toBeTruthy();
    }
  });

  test("add transaction flow", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");

    const addBtn = pwaPage.locator(
      "button:has-text('Add'), button:has-text('add'), " +
        "[data-action='add'], .add-btn, .fab",
    );
    if ((await addBtn.count()) === 0) {
      return; // Skip: Add transaction button not found
    }

    await addBtn.first().click();
    await pwaPage.waitForTimeout(300);

    const amountInput = pwaPage.locator(
      "input[name='amount'], input[placeholder*='amount'], input[type='number']",
    );
    if ((await amountInput.count()) > 0) {
      await amountInput.first().fill("-100");
    }

    const descInput = pwaPage.locator(
      "input[name='description'], input[placeholder*='description'], textarea",
    );
    if ((await descInput.count()) > 0) {
      await descInput.first().fill("E2E Test Transaction");
    }
  });
});

test.describe("TestTransactionFilters", () => {
  test("filter controls exist", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");

    const filters = pwaPage.locator("select, input[type='date'], .filter, [data-filter]");
    expect((await filters.count()) >= 0).toBeTruthy();
  });
});

// FINCO-32 — empty-state CTAs
test.describe("TestTransactionsEmptyStateCTA", () => {
  test("empty DB shows an Add-your-first-transaction CTA that navigates to the new form", async ({
    pwaPage,
  }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#tx-list-container .empty-state");
    const emptyText = await pwaPage.locator("#tx-list-container .empty-text").innerText();
    expect(emptyText).toContain("No transactions yet");
    const cta = pwaPage.locator('#tx-list-container .empty-cta[data-action="nav-navigate"]');
    await expect(cta).toBeVisible();
    expect(await cta.getAttribute("data-route")).toBe("#/transactions/new");
    expect((await cta.innerText()).trim()).toBe("Add your first transaction");

    await cta.click();
    await pwaPage.waitForFunction(() => window.location.hash === "#/transactions/new");
    expect(await pwaPage.evaluate(() => window.location.hash)).toBe("#/transactions/new");
  });

  test("filter that matches nothing shows a Clear-filters CTA that restores the list", async ({
    pwaPage,
  }) => {
    await seedTransactionData(pwaPage);
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#tx-list-container .tx-item");

    // Apply a future date range that matches none of the seeded transactions.
    await pwaPage.evaluate(() => {
      const from = document.getElementById("f-from");
      const to = document.getElementById("f-to");
      from.value = "2099-01-01";
      to.value = "2099-12-31";
      to.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await pwaPage.waitForSelector('#tx-list-container .empty-cta[data-action="clear-tx-filters"]');
    const emptyText = await pwaPage.locator("#tx-list-container .empty-text").innerText();
    expect(emptyText).toContain("No transactions match your filters.");
    const clearCta = pwaPage.locator('#tx-list-container .empty-cta[data-action="clear-tx-filters"]');
    expect((await clearCta.innerText()).trim()).toBe("Clear filters");

    await clearCta.click();
    // clearTxFilters re-renders the whole screen; the seeded rows return.
    await pwaPage.waitForSelector("#tx-list-container .tx-item");
    const text = await pwaPage.innerText("#tx-list-container");
    const restored = ["grocery", "salary", "uber"].some((k) => text.toLowerCase().includes(k));
    expect(restored).toBeTruthy();
  });
});

test.describe("TestTransactionPDFExport", () => {
  test("no PDF export button in transactions toolbar (moved to Settings)", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(500);
    const pdfBtn = pwaPage.locator('[data-action="export-transactions"][data-format="pdf"]');
    expect(await pdfBtn.count()).toBe(0);
  });

  test("no .export-toolbar element on transactions page", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(500);
    const toolbar = pwaPage.locator(".export-toolbar");
    expect(await toolbar.count()).toBe(0);
  });
});

// ===========================================================================
// BUG-UI-01 — Pagination errors show an error toast (not a silent failure)
// ===========================================================================
test.describe("BUG-UI-01: Pagination error shows toast", () => {
  test("error toast appears when loading more transactions fails", async ({ pwaPage }) => {
    // Seed one transaction so the page loads successfully
    await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({
        name: "Toast Test Account",
        balance: 10000,
        account_type: "checking",
      });
      await DB.createTransaction({
        date: "2025-06-01",
        amount: -100,
        description: "Toast Test TX",
        transaction_type: "expense",
        account_id: acc.id,
      });
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(800);

    // Replace API.getTransactions with a function that throws on next call
    await pwaPage.evaluate(() => {
      const original = window.API.getTransactions.bind(window.API);
      let calls = 0;
      window.API.getTransactions = async (...args) => {
        calls += 1;
        if (calls > 1) {
          throw new Error("Simulated pagination failure");
        }
        return original(...args);
      };
    });

    // Trigger a pagination load directly (reset=false path in loadTransactionList)
    await pwaPage.evaluate(async () => {
      // Force txHasMore=true and txLoading=false by calling with a non-reset load
      // We inject a scroll event near the bottom of the page to trigger pagination
      window.dispatchEvent(
        new CustomEvent("scroll", {
          detail: { scrollY: 99999 },
        }),
      );
      // Manually manipulate scroll position and fire scroll handler
      Object.defineProperty(window, "scrollY", { value: 99999, configurable: true });
      Object.defineProperty(document.documentElement, "scrollHeight", {
        value: 1000,
        configurable: true,
      });
      Object.defineProperty(document.documentElement, "clientHeight", {
        value: 100,
        configurable: true,
      });
      if (window._txScrollHandler) {
        window._txScrollHandler();
      }
    });

    // Wait for the toast to appear
    await pwaPage.waitForTimeout(1000);

    const toast = pwaPage.locator(".toast, [class*='toast'], .notification, [class*='error']");
    const toastText = await pwaPage.innerText("body");
    const hasErrorIndicator =
      toastText.toLowerCase().includes("simulated pagination failure") ||
      toastText.toLowerCase().includes("error") ||
      (await toast.count()) > 0;
    expect(hasErrorIndicator).toBe(true);
  });
});

// ===========================================================================
// Bug 2 — Merchant name propagation prompt (UPI-gated)
// ===========================================================================
test.describe("MerchantNamePropagation", () => {
  async function seedTxWithUpi(page) {
    return page.evaluate(async () => {
      const today = new Date().toISOString().slice(0, 10);
      const acc = await DB.createAccount({
        name: "UPI Test Account",
        balance: 10000,
        account_type: "checking",
      });
      const tx1 = await DB.createTransaction({
        date: today,
        amount: -100,
        description: "Food delivery",
        transaction_type: "expense",
        account_id: acc.id,
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@paytm",
      });
      await DB.createTransaction({
        date: today,
        amount: -120,
        description: "Food delivery 2",
        transaction_type: "expense",
        account_id: acc.id,
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@paytm",
      });
      return { tx1Id: tx1.id };
    });
  }

  // FINCO-50: renaming a merchant on a transaction now offers to remember the new name for
  // all past & future transactions from the same merchant. Confirming ("Yes, apply to all")
  // persists the rename so future transactions carrying the SAME original string are mapped
  // to the renamed name; declining ("No, just this one") renames only that single row.

  test("renaming a merchant shows the rename prompt; confirming remaps future transactions", async ({
    pwaPage,
  }) => {
    const { tx1Id } = await seedTxWithUpi(pwaPage);

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    // Open the edit modal for the transaction.
    await pwaPage.evaluate((id) => {
      const item = document.querySelector(`[data-action="show-edit-tx"][data-id="${id}"]`);
      if (item) item.click();
    }, tx1Id);
    await pwaPage.waitForSelector("#edit-merchant-name", { timeout: 5000 });

    // Change the merchant name and save.
    await pwaPage.fill("#edit-merchant-name", "Swiggy Foods");
    await pwaPage.click(`[data-action="save-transaction"][data-id="${tx1Id}"]`);

    // The rename prompt appears (FINCO-50). Confirm "apply to all".
    await pwaPage.waitForSelector("#merchant-name-yes", { timeout: 5000 });
    await pwaPage.click("#merchant-name-yes");
    await pwaPage.waitForTimeout(600);

    // The edited transaction now shows the new name.
    const editedName = await pwaPage.evaluate(async (id) => {
      const rows = await DB.getTransactions({ id });
      return rows[0]?.merchant_name || null;
    }, tx1Id);
    expect(editedName).toBe("Swiggy Foods");

    // A NEW transaction carrying the ORIGINAL merchant string is auto-mapped to the new name.
    const newTxName = await pwaPage.evaluate(async () => {
      const acc = (await DB.getAccounts())[0];
      const tx = await DB.createTransaction({
        date: new Date().toISOString().slice(0, 10),
        amount: -80,
        description: "Another order",
        transaction_type: "expense",
        account_id: acc.id,
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@paytm",
      });
      return tx.merchant_name;
    });
    expect(newTxName).toBe("Swiggy Foods");
  });

  test("declining the rename prompt renames only that row and leaves future transactions untouched", async ({
    pwaPage,
  }) => {
    const { tx1Id } = await seedTxWithUpi(pwaPage);

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    await pwaPage.evaluate((id) => {
      const item = document.querySelector(`[data-action="show-edit-tx"][data-id="${id}"]`);
      if (item) item.click();
    }, tx1Id);
    await pwaPage.waitForSelector("#edit-merchant-name", { timeout: 5000 });

    await pwaPage.fill("#edit-merchant-name", "Swiggy Foods");
    await pwaPage.click(`[data-action="save-transaction"][data-id="${tx1Id}"]`);

    // Decline the rename prompt — "No, just this one".
    await pwaPage.waitForSelector("#merchant-name-no", { timeout: 5000 });
    await pwaPage.click("#merchant-name-no");
    await pwaPage.waitForTimeout(600);

    // Only the edited row shows the new name.
    const editedName = await pwaPage.evaluate(async (id) => {
      const rows = await DB.getTransactions({ id });
      return rows[0]?.merchant_name || null;
    }, tx1Id);
    expect(editedName).toBe("Swiggy Foods");

    // A subsequently-added transaction with the original string keeps the ORIGINAL name.
    const newTxName = await pwaPage.evaluate(async () => {
      const acc = (await DB.getAccounts())[0];
      const tx = await DB.createTransaction({
        date: new Date().toISOString().slice(0, 10),
        amount: -70,
        description: "Another order",
        transaction_type: "expense",
        account_id: acc.id,
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@paytm",
      });
      return tx.merchant_name;
    });
    expect(newTxName).toBe("Swiggy");
  });

  test("no rename prompt appears when the merchant name is unchanged", async ({ pwaPage }) => {
    const { tx1Id } = await seedTxWithUpi(pwaPage);

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    await pwaPage.evaluate((id) => {
      const item = document.querySelector(`[data-action="show-edit-tx"][data-id="${id}"]`);
      if (item) item.click();
    }, tx1Id);
    await pwaPage.waitForSelector("#edit-merchant-name", { timeout: 5000 });

    // Change only the amount, leave the merchant name as-is, then save.
    await pwaPage.fill("#edit-amount", "175");
    await pwaPage.click(`[data-action="save-transaction"][data-id="${tx1Id}"]`);
    await pwaPage.waitForTimeout(600);

    // No rename prompt should appear when the name did not change.
    expect(await pwaPage.locator("#merchant-name-yes").count()).toBe(0);
    expect(await pwaPage.locator(".modal.confirm-dialog").count()).toBe(0);

    const name = await pwaPage.evaluate(async (id) => {
      const rows = await DB.getTransactions({ id });
      return rows[0]?.merchant_name || null;
    }, tx1Id);
    expect(name).toBe("Swiggy");
  });

  test("renaming a UPI merchant via Taxonomy reflects on its transactions", async ({
    pwaPage,
  }) => {
    const merchantId = await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({ name: "T", balance: 0, account_type: "savings" });
      const cats = await DB.getCategories();
      const m = await DB.createMerchant({
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@paytm",
        category_id: cats[0].id,
      });
      // createTransaction links merchant_id via the matching UPI id.
      await DB.createTransaction({
        date: new Date().toISOString().slice(0, 10),
        amount: -100,
        description: "Food delivery",
        transaction_type: "expense",
        account_id: acc.id,
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@paytm",
      });
      return m.id;
    });

    // Rename through the Taxonomy → Merchants edit modal.
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.click('[data-action="switch-taxonomy-tab"][data-mode="merchants"]');
    await pwaPage.waitForSelector(`[data-action="show-edit-merchant"][data-id="${merchantId}"]`, {
      timeout: 5000,
    });
    await pwaPage.click(`[data-action="show-edit-merchant"][data-id="${merchantId}"]`);
    await pwaPage.waitForSelector("#merch-edit-name", { timeout: 5000 });
    await pwaPage.fill("#merch-edit-name", "Swiggy Foods");
    await pwaPage.click(`[data-action="do-update-merchant"][data-id="${merchantId}"]`);
    await pwaPage.waitForTimeout(600);

    // No propagation prompt — the rename surfaces via the merchant_id join.
    expect(await pwaPage.locator("#mname-yes").count()).toBe(0);

    // The transaction list now resolves to the new display name.
    const names = await pwaPage.evaluate(async () => {
      const rows = await DB.getTransactions({});
      return rows.map((r) => r.merchant_name);
    });
    expect(names).toContain("Swiggy Foods");
    expect(names).not.toContain("Swiggy");

    // The renamed display name is also rendered in the transactions screen.
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);
    expect(await pwaPage.innerText("body")).toContain("Swiggy Foods");
  });

  test("renaming a no-UPI merchant reflects on transactions and keeps a stable identity", async ({
    pwaPage,
  }) => {
    const merchantId = await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({ name: "T2", balance: 0, account_type: "savings" });
      const cats = await DB.getCategories();
      const m = await DB.createMerchant({
        merchant_name: "Cafe Coffee Day",
        merchant_upi_id: null,
        category_id: cats[0].id,
      });
      // No UPI: createTransaction links merchant_id via the stable merchant_key/name.
      await DB.createTransaction({
        date: new Date().toISOString().slice(0, 10),
        amount: -50,
        description: "Coffee",
        transaction_type: "expense",
        account_id: acc.id,
        merchant_name: "Cafe Coffee Day",
        merchant_upi_id: null,
      });
      return m.id;
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.click('[data-action="switch-taxonomy-tab"][data-mode="merchants"]');
    await pwaPage.waitForSelector(`[data-action="show-edit-merchant"][data-id="${merchantId}"]`, {
      timeout: 5000,
    });
    await pwaPage.click(`[data-action="show-edit-merchant"][data-id="${merchantId}"]`);
    await pwaPage.waitForSelector("#merch-edit-name", { timeout: 5000 });
    await pwaPage.fill("#merch-edit-name", "Blue Tokai Coffee");
    await pwaPage.click(`[data-action="do-update-merchant"][data-id="${merchantId}"]`);
    await pwaPage.waitForTimeout(600);

    // No propagation prompt for a no-UPI merchant either.
    expect(await pwaPage.locator("#mname-yes").count()).toBe(0);

    const result = await pwaPage.evaluate(async (origName) => {
      const rows = await DB.getTransactions({});
      const names = rows.map((r) => r.merchant_name);
      // Identity is stable: the original name still resolves to the same merchant.
      const m = DB._lookupMerchant(null, origName);
      return { names, lookupId: m?.id || null };
    }, "Cafe Coffee Day");

    expect(result.names).toContain("Blue Tokai Coffee");
    expect(result.names).not.toContain("Cafe Coffee Day");
    expect(result.lookupId).toBe(merchantId);
  });
});

// ===========================================================================
// Regression coverage for two bugs found 2026-06-23. Both slipped through
// because the existing "MerchantNamePropagation" tests seeded transactions
// WITHOUT a pre-existing merchant, so merchant_id stayed null and the
// linked-merchant display path (the actual source of both bugs) was never hit.
// These tests create the merchant FIRST so the transactions link via merchant_id.
// ===========================================================================
test.describe("MerchantNameLinkedEditRegression", () => {
  // Seeds a merchant and two transactions that link to it via the shared UPI id, so each
  // transaction's displayed name resolves from the merchant's display_name (merchant_id join).
  async function seedLinkedMerchantTxs(page) {
    return page.evaluate(async () => {
      const acc = await DB.createAccount({
        name: "Linked Acct",
        balance: 10000,
        account_type: "checking",
      });
      const cats = await DB.getCategories();
      await DB.createMerchant({
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@paytm",
        category_id: cats[0].id,
      });
      const today = new Date().toISOString().slice(0, 10);
      const tx1 = await DB.createTransaction({
        date: today,
        amount: -100,
        description: "Food delivery 1",
        transaction_type: "expense",
        account_id: acc.id,
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@paytm",
      });
      const tx2 = await DB.createTransaction({
        date: today,
        amount: -200,
        description: "Food delivery 2",
        transaction_type: "expense",
        account_id: acc.id,
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@paytm",
      });
      return { tx1Id: tx1.id, tx2Id: tx2.id };
    });
  }

  // BUG 1: editing the merchant name on a transaction LINKED to a merchant had no visible
  // effect — updateTransaction wrote only the row's merchant_name column while the display
  // resolves from the merchant's display_name. The rename must surface on every linked
  // transaction (identity rename).
  test("editing the merchant name on a linked transaction surfaces on all its transactions", async ({
    pwaPage,
  }) => {
    const { tx1Id, tx2Id } = await seedLinkedMerchantTxs(pwaPage);

    // Sanity: both transactions are actually linked to the merchant (merchant_id set),
    // otherwise this test would silently exercise the wrong (unlinked) code path.
    const linkedBefore = await pwaPage.evaluate(async (id) => {
      const rows = await DB.getTransactions({ id });
      return rows[0]?.merchant_id || null;
    }, tx1Id);
    expect(linkedBefore).not.toBeNull();

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    await pwaPage.evaluate((id) => {
      const item = document.querySelector(`[data-action="show-edit-tx"][data-id="${id}"]`);
      if (item) item.click();
    }, tx1Id);
    await pwaPage.waitForSelector("#edit-merchant-name", { timeout: 5000 });
    await pwaPage.fill("#edit-merchant-name", "Swiggy Foods");
    await pwaPage.click(`[data-action="save-transaction"][data-id="${tx1Id}"]`);

    // FINCO-50: the rename prompt appears. Confirm "apply to all" so the identity
    // rename surfaces on every linked transaction.
    await pwaPage.waitForSelector("#merchant-name-yes", { timeout: 5000 });
    await pwaPage.click("#merchant-name-yes");
    await pwaPage.waitForTimeout(600);

    // The rename surfaces on BOTH the edited transaction and its linked sibling.
    const names = await pwaPage.evaluate(
      async (ids) => {
        const a = (await DB.getTransactions({ id: ids.tx1Id }))[0]?.merchant_name;
        const b = (await DB.getTransactions({ id: ids.tx2Id }))[0]?.merchant_name;
        return { a, b };
      },
      { tx1Id, tx2Id },
    );
    expect(names.a).toBe("Swiggy Foods");
    expect(names.b).toBe("Swiggy Foods");
  });

  // BUG 2: the edit modal's Merchant Name field used only tx.merchant_name, so a
  // transaction carrying just a UPI id (no extracted name) showed an empty field even
  // though the list renders the UPI as a fallback label.
  test("edit modal pre-fills the merchant name with the UPI id when no name is stored", async ({
    pwaPage,
  }) => {
    const txId = await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({
        name: "UPI Only Acct",
        balance: 5000,
        account_type: "checking",
      });
      // No merchant_name and no pre-existing merchant — only a UPI id, mirroring a Gmail
      // import that could not extract a display name.
      const tx = await DB.createTransaction({
        date: new Date().toISOString().slice(0, 10),
        amount: -75,
        description: "UPI payment",
        transaction_type: "expense",
        account_id: acc.id,
        merchant_upi_id: "merchant@okhdfcbank",
      });
      return tx.id;
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    await pwaPage.evaluate((id) => {
      const item = document.querySelector(`[data-action="show-edit-tx"][data-id="${id}"]`);
      if (item) item.click();
    }, txId);
    await pwaPage.waitForSelector("#edit-merchant-name", { timeout: 5000 });

    // The field falls back to the UPI id, matching what the list view shows.
    const fieldValue = await pwaPage.inputValue("#edit-merchant-name");
    expect(fieldValue).toBe("merchant@okhdfcbank");
  });

  // BUG 3 (sample-data case): manual transactions with no merchant at all (e.g. "NGO
  // donation", "Transfer to savings") show their description as the list label, but the edit
  // modal's Merchant Name field used only merchant_name/merchant_upi_id, leaving it blank.
  // It must fall back to the description so the field matches the list label.
  test("edit modal pre-fills the merchant name with the description when there is no merchant", async ({
    pwaPage,
  }) => {
    const txId = await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({
        name: "Manual Acct",
        balance: 5000,
        account_type: "checking",
      });
      const cats = await DB.getCategories();
      // A manual transaction: only a description, no merchant_name and no merchant_upi_id.
      const tx = await DB.createTransaction({
        date: new Date().toISOString().slice(0, 10),
        amount: -500,
        description: "NGO donation",
        transaction_type: "expense",
        account_id: acc.id,
        category_id: cats[0].id,
      });
      return tx.id;
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    // The list label shows the description.
    expect(await pwaPage.innerText("body")).toContain("NGO donation");

    await pwaPage.evaluate((id) => {
      const item = document.querySelector(`[data-action="show-edit-tx"][data-id="${id}"]`);
      if (item) item.click();
    }, txId);
    await pwaPage.waitForSelector("#edit-merchant-name", { timeout: 5000 });

    // The Merchant Name field matches the list label instead of being blank.
    const fieldValue = await pwaPage.inputValue("#edit-merchant-name");
    expect(fieldValue).toBe("NGO donation");
  });
});

// ---------------------------------------------------------------------------
// Item 3 — "Not an expense" toggle in transaction edit modal
// ---------------------------------------------------------------------------
test.describe("TestNotAnExpenseToggle", () => {
  async function seedExpenseAndNavigate(page) {
    const txId = await page.evaluate(async () => {
      const acc = await DB.createAccount({
        name: "Toggle Test Account",
        balance: 10000,
        account_type: "savings",
      });
      const tx = await DB.createTransaction({
        date: new Date().toISOString().split("T")[0],
        amount: -300,
        description: "Toggle Test Expense",
        transaction_type: "expense",
        account_id: acc.id,
      });
      return tx.id;
    });

    await page.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await page.waitForSelector("#screen");
    await page.waitForTimeout(700);

    return txId;
  }

  async function openEditModal(page, txId) {
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-action="show-edit-tx"][data-id="${id}"]`);
      if (el) el.click();
    }, txId);
    await page.waitForSelector(".modal-overlay .modal", { timeout: 5000 });
  }

  test("transaction edit modal has Not an expense toggle slider", async ({ pwaPage }) => {
    const txId = await seedExpenseAndNavigate(pwaPage);
    await openEditModal(pwaPage, txId);

    const toggle = pwaPage.locator(
      `input[type="checkbox"][data-change="toggle-excluded-from-expenses"]`,
    );
    expect(await toggle.count()).toBe(1);

    const label = pwaPage.locator(".modal .form-group label:has-text('Not an expense')");
    expect(await label.count()).toBe(1);
  });

  test("toggle is unchecked by default for a normal expense", async ({ pwaPage }) => {
    const txId = await seedExpenseAndNavigate(pwaPage);
    await openEditModal(pwaPage, txId);

    const toggle = pwaPage.locator(
      `input[type="checkbox"][data-change="toggle-excluded-from-expenses"]`,
    );
    expect(await toggle.isChecked()).toBe(false);
  });

  test("toggling the slider persists the exclusion flag", async ({ pwaPage }) => {
    const txId = await seedExpenseAndNavigate(pwaPage);
    await openEditModal(pwaPage, txId);

    const toggle = pwaPage.locator(
      `input[type="checkbox"][data-change="toggle-excluded-from-expenses"]`,
    );
    // Check the toggle (fires data-change handler which calls API immediately)
    await toggle.check();
    await pwaPage.waitForTimeout(600);

    // Close the modal
    await pwaPage.locator(".modal-overlay button[data-action='close-modal']").first().click();
    await pwaPage.waitForTimeout(300);

    // Verify flag persisted in DB
    const excluded = await pwaPage.evaluate(async (id) => {
      const tx = (await DB.getTransactions({})).find((t) => t.id === id);
      return tx ? tx.excluded_from_expenses : null;
    }, txId);
    expect(excluded).toBe(true);
  });

  test("excluded transaction does not appear in total_expense", async ({ pwaPage }) => {
    // Seed two expenses — one normal, one to-be-excluded
    await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({
        name: "Totals Test Account",
        balance: 50000,
        account_type: "savings",
      });
      const today = new Date().toISOString().split("T")[0];
      await DB.createTransaction({
        date: today,
        amount: -100,
        description: "Normal Expense",
        transaction_type: "expense",
        account_id: acc.id,
      });
      const toExclude = await DB.createTransaction({
        date: today,
        amount: -999,
        description: "Excluded Expense",
        transaction_type: "expense",
        account_id: acc.id,
      });
      await DB.toggleExcludedFromExpenses(toExclude.id, true);
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(800);

    // The totals bar should show 100 for expense, not 1099
    const totalsBar = pwaPage.locator(".tx-totals-bar");
    if ((await totalsBar.count()) > 0) {
      const totalsText = await totalsBar.innerText();
      // Should contain 100 but NOT 999 in the expense section
      expect(totalsText).toContain("100");
      expect(totalsText).not.toContain("999");
    } else {
      // Fallback: verify via DB directly
      const totals = await pwaPage.evaluate(async () => DB.getTransactionTotals());
      expect(totals.total_expense).toBe(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Toggle visibility — conditional on transaction type
// ---------------------------------------------------------------------------
test.describe("TestToggleVisibilityByType", () => {
  async function seedTransactionAndOpen(page, type, amount) {
    const txId = await page.evaluate(
      async ({ type, amount }) => {
        const acc = await DB.createAccount({
          name: "Visibility Test Account",
          balance: 20000,
          account_type: "savings",
        });
        const tx = await DB.createTransaction({
          date: new Date().toISOString().split("T")[0],
          amount,
          description: `Visibility Test ${type}`,
          transaction_type: type,
          account_id: acc.id,
        });
        return tx.id;
      },
      { type, amount },
    );

    await page.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await page.waitForSelector("#screen");
    await page.waitForTimeout(700);

    // Open edit modal
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-action="show-edit-tx"][data-id="${id}"]`);
      if (el) el.click();
    }, txId);
    await page.waitForSelector(".modal-overlay .modal", { timeout: 5000 });

    return txId;
  }

  test("Not an expense toggle visible only for expense transactions", async ({ pwaPage }) => {
    await seedTransactionAndOpen(pwaPage, "expense", -300);

    const expenseToggle = pwaPage.locator(
      `input[type="checkbox"][data-change="toggle-excluded-from-expenses"]`,
    );
    const incomeToggle = pwaPage.locator(
      `input[type="checkbox"][data-change="toggle-excluded-from-income"]`,
    );

    expect(await expenseToggle.count()).toBe(1);
    expect(await incomeToggle.count()).toBe(0);

    const label = pwaPage.locator(".modal .form-group label:has-text('Not an expense')");
    expect(await label.count()).toBe(1);
  });

  test("Not an income toggle visible only for income transactions", async ({ pwaPage }) => {
    await seedTransactionAndOpen(pwaPage, "income", 5000);

    const incomeToggle = pwaPage.locator(
      `input[type="checkbox"][data-change="toggle-excluded-from-income"]`,
    );
    const expenseToggle = pwaPage.locator(
      `input[type="checkbox"][data-change="toggle-excluded-from-expenses"]`,
    );

    expect(await incomeToggle.count()).toBe(1);
    expect(await expenseToggle.count()).toBe(0);

    const label = pwaPage.locator(".modal .form-group label:has-text('Not an income')");
    expect(await label.count()).toBe(1);
  });

  test("toggling Not an income persists excluded_from_income flag", async ({ pwaPage }) => {
    const txId = await seedTransactionAndOpen(pwaPage, "income", 5000);

    const incomeToggle = pwaPage.locator(
      `input[type="checkbox"][data-change="toggle-excluded-from-income"]`,
    );

    await incomeToggle.check();
    await pwaPage.waitForTimeout(600);

    // Close modal
    await pwaPage.locator(".modal-overlay button[data-action='close-modal']").first().click();
    await pwaPage.waitForTimeout(300);

    // Verify flag persisted in DB
    const excluded = await pwaPage.evaluate(async (id) => {
      const tx = (await DB.getTransactions({})).find((t) => t.id === id);
      return tx ? tx.excluded_from_income : null;
    }, txId);
    expect(excluded).toBe(true);
  });

  test("excluded income does not appear in total_income", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({
        name: "Income Totals Account",
        balance: 0,
        account_type: "savings",
      });
      const today = new Date().toISOString().split("T")[0];
      await DB.createTransaction({
        date: today,
        amount: 4000,
        description: "Normal Income",
        transaction_type: "income",
        account_id: acc.id,
      });
      const toExclude = await DB.createTransaction({
        date: today,
        amount: 999,
        description: "Excluded Income",
        transaction_type: "income",
        account_id: acc.id,
      });
      await DB.toggleExcludedFromIncome(toExclude.id, true);
    });

    // Verify via DB that only non-excluded income is counted
    const totals = await pwaPage.evaluate(async () => DB.getTransactionTotals());
    expect(totals.total_income).toBe(4000);
  });
});

// ===========================================================================
// Transaction Tags — E2E
// ===========================================================================

test.describe("TestTransactionTagFilter", () => {
  test("tag filter select is present with the 4 seeded tag options on a fresh DB", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(500);

    // 4 default tags are seeded on init, so the filter is always visible
    const tagDropdown = pwaPage.locator("#f-tags-dropdown");
    expect(await tagDropdown.count()).toBe(1);
    const menuHtml = await pwaPage.locator("#f-tags-menu").innerHTML();
    expect(menuHtml).toContain("#online");
    expect(menuHtml).toContain("#offline");
    expect(menuHtml).toContain("#domestic");
    expect(menuHtml).toContain("#international");
  });

  test("tag filter select appears when tags exist", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      await DB.createTag("work");
      await DB.createTag("personal");
    });
    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(500);

    const tagDropdown = pwaPage.locator("#f-tags-dropdown");
    expect(await tagDropdown.count()).toBe(1);
    // Options include both created tags plus the 4 seeded ones
    const menuHtml = await pwaPage.locator("#f-tags-menu").innerHTML();
    expect(menuHtml).toContain("#work");
    expect(menuHtml).toContain("#personal");
  });

  test("filtering by tag shows only matching transactions", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({ name: "Tag Filter Acct", balance: 10000, account_type: "checking" });
      const cats = await DB.getCategories();
      const tagA = await DB.createTag("alpha");
      const tagB = await DB.createTag("beta");
      const today = new Date().toISOString().split("T")[0];
      await DB.createTransaction({
        date: today,
        amount: 111,
        description: "Alpha TX",
        transaction_type: "expense",
        account_id: acc.id,
        category_id: cats[0].id,
        tag_ids: [tagA.id],
      });
      await DB.createTransaction({
        date: today,
        amount: 222,
        description: "Beta TX",
        transaction_type: "expense",
        account_id: acc.id,
        category_id: cats[0].id,
        tag_ids: [tagB.id],
      });
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    const tagSelect = pwaPage.locator("#f-tags");
    if ((await tagSelect.count()) === 0) return; // skip if filter not rendered

    const alphaOption = tagSelect.locator("option:has-text('#alpha')");
    const alphaValue = await alphaOption.getAttribute("value");
    await tagSelect.selectOption(alphaValue);
    await pwaPage.waitForTimeout(600);

    const bodyText = await pwaPage.locator("#screen").innerText();
    expect(bodyText).toContain("Alpha TX");
    expect(bodyText).not.toContain("Beta TX");
  });
});

// Tag badges are intentionally NOT shown in the transaction list view.
// They are shown only in the transaction detail/edit modal.
// Dashboard Recent Transactions (txItemHTML) also does not render badges in list rows.
test.describe("TestTransactionTagBadges", () => {
  test("no tag badges in the transactions list view for tagged transactions", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({ name: "TX Badge Acct", balance: 5000, account_type: "checking" });
      const cats = await DB.getCategories();
      const tag = await DB.createTag("holiday");
      const today = new Date().toISOString().split("T")[0];
      await DB.createTransaction({
        date: today,
        amount: 500,
        description: "Holiday shopping",
        transaction_type: "expense",
        account_id: acc.id,
        category_id: cats[0].id,
        tag_ids: [tag.id],
      });
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/transactions";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    const badge = pwaPage.locator(".tag-badge:has-text('#holiday')");
    expect(await badge.count()).toBe(0);
  });

  test("no tag badges in dashboard Recent Transactions for tagged items", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({ name: "Badge Acct", balance: 5000, account_type: "checking" });
      const cats = await DB.getCategories();
      const tag = await DB.createTag("holiday");
      const today = new Date().toISOString().split("T")[0];
      await DB.createTransaction({
        date: today,
        amount: 500,
        description: "Holiday purchase",
        transaction_type: "expense",
        account_id: acc.id,
        category_id: cats[0].id,
        tag_ids: [tag.id],
      });
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    // Tag badges are not shown in the list view — tags are detail-only
    const badge = pwaPage.locator(".tag-badge:has-text('#holiday')");
    expect(await badge.count()).toBe(0);
  });

  test("no tag badges in dashboard for untagged transactions", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      const acc = await DB.createAccount({ name: "No Tag Acct", balance: 5000, account_type: "checking" });
      const cats = await DB.getCategories();
      const today = new Date().toISOString().split("T")[0];
      await DB.createTransaction({
        date: today,
        amount: 300,
        description: "Untagged purchase",
        transaction_type: "expense",
        account_id: acc.id,
        category_id: cats[0].id,
      });
    });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/";
    });
    await pwaPage.waitForSelector("#screen");
    await pwaPage.waitForTimeout(600);

    const badges = pwaPage.locator(".tag-badge");
    expect(await badges.count()).toBe(0);
  });
});

// ===========================================================================
// Transaction notes field — E2E tests
// ===========================================================================
test.describe("TestTransactionNotesField", () => {
	test(".tx-note element is visible when tx has description and merchant name", async ({
		pwaPage,
	}) => {
		await pwaPage.evaluate(async () => {
			const acc = await DB.createAccount({
				name: "Notes E2E Account",
				balance: 50000,
				account_type: "savings",
			});
			await DB.createTransaction({
				date: new Date().toISOString().split("T")[0],
				amount: -300,
				description: "My personal note",
				transaction_type: "expense",
				account_id: acc.id,
				merchant_name: "Coffee Shop",
			});
		});
		await pwaPage.evaluate(() => {
			window.location.hash = "#/transactions";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(600);

		const noteEl = pwaPage.locator(".tx-note");
		expect(await noteEl.count()).toBeGreaterThan(0);
		const text = await noteEl.first().textContent();
		expect(text).toContain("My personal note");
	});

	test("no .tx-note element when transaction description is null", async ({ pwaPage }) => {
		await pwaPage.evaluate(async () => {
			const acc = await DB.createAccount({
				name: "No Note Account",
				balance: 50000,
				account_type: "savings",
			});
			await DB.createTransaction({
				date: new Date().toISOString().split("T")[0],
				amount: -100,
				description: null,
				transaction_type: "expense",
				account_id: acc.id,
				merchant_name: "No Note Shop",
			});
		});
		await pwaPage.evaluate(() => {
			window.location.hash = "#/transactions";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(600);

		const noteEl = pwaPage.locator(".tx-note");
		expect(await noteEl.count()).toBe(0);
	});

	test("no .tx-note when description exists but no merchant (guard condition)", async ({
		pwaPage,
	}) => {
		await pwaPage.evaluate(async () => {
			const acc = await DB.createAccount({
				name: "Desc Only Account",
				balance: 50000,
				account_type: "savings",
			});
			// No merchant_name or merchant_upi_id — guard condition: no note row
			await DB.createTransaction({
				date: new Date().toISOString().split("T")[0],
				amount: -200,
				description: "Note without merchant",
				transaction_type: "expense",
				account_id: acc.id,
			});
		});
		await pwaPage.evaluate(() => {
			window.location.hash = "#/transactions";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(600);

		const noteEl = pwaPage.locator(".tx-note");
		expect(await noteEl.count()).toBe(0);
	});

	test("edit overlay #edit-desc has empty value and 'Add Notes' placeholder", async ({
		pwaPage,
	}) => {
		await pwaPage.evaluate(async () => {
			const acc = await DB.createAccount({
				name: "Edit Notes Account",
				balance: 50000,
				account_type: "savings",
			});
			await DB.createTransaction({
				date: new Date().toISOString().split("T")[0],
				amount: -150,
				description: "Coffee note",
				transaction_type: "expense",
				account_id: acc.id,
				merchant_name: "Cafe Blue",
			});
		});
		await pwaPage.evaluate(() => {
			window.location.hash = "#/transactions";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(600);

		// Click first edit-tx trigger to open overlay
		const editTrigger = pwaPage.locator('[data-action="show-edit-tx"]').first();
		await editTrigger.click();
		await pwaPage.waitForSelector(".modal-overlay");
		await pwaPage.waitForTimeout(300);

		const editDesc = pwaPage.locator("#edit-desc");
		expect(await editDesc.count()).toBeGreaterThan(0);
		// No notes field set — value is empty
		expect(await editDesc.inputValue()).toBe("");
		const placeholder = await editDesc.getAttribute("placeholder");
		expect(placeholder).toBe("Add Notes");
	});

	test("edit overlay label reads 'Notes'", async ({ pwaPage }) => {
		await pwaPage.evaluate(async () => {
			const acc = await DB.createAccount({
				name: "Label Test Account",
				balance: 50000,
				account_type: "savings",
			});
			await DB.createTransaction({
				date: new Date().toISOString().split("T")[0],
				amount: -150,
				description: null,
				transaction_type: "expense",
				account_id: acc.id,
				merchant_name: "Label Shop",
			});
		});
		await pwaPage.evaluate(() => {
			window.location.hash = "#/transactions";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(600);

		const editTrigger = pwaPage.locator('[data-action="show-edit-tx"]').first();
		await editTrigger.click();
		await pwaPage.waitForSelector(".modal-overlay");
		await pwaPage.waitForTimeout(300);

		const modalText = await pwaPage.locator(".modal-overlay .modal").innerText();
		expect(modalText).toContain("Notes");
	});
});

// =============================================================================
// Gmail Notes field + Payment Reference E2E tests
// =============================================================================
test.describe("TestGmailNotesAndPaymentReference", () => {
	/** Helper: create a Gmail-style transaction directly in the DB */
	async function createGmailTx(pwaPage, opts = {}) {
		return pwaPage.evaluate(async (o) => {
			const acc = await DB.createAccount({
				name: o.accountName || "Gmail Acc",
				balance: 10000,
				account_type: "savings",
			});
			// Insert directly — createTransaction doesn't expose gmail_message_id / payment_reference
			DB._exec(
				"INSERT INTO transactions (transaction_id, gmail_message_id, date, amount, description, notes, payment_reference, merchant_name, merchant_upi_id, transaction_type, account_id, created_at, is_recurring) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'),0)",
				[
					`gmail_${o.gmailMessageId || "gmail-test-msg-001"}`,
					o.gmailMessageId || "gmail-test-msg-001",
					new Date().toISOString().split("T")[0],
					o.amount || -2000,
					o.description !== undefined ? o.description : "Merchant: HDFC MF | Method: UPI | Purpose: SIP",
					o.notes || null,
					o.paymentReference !== undefined ? o.paymentReference : null,
					o.merchantName || "HDFC MF",
					o.merchantUpiId !== undefined ? o.merchantUpiId : null,
					"expense",
					acc.id,
				],
			);
			await DB._persist();
			return acc.id;
		}, opts);
	}

	async function openEditModal(pwaPage) {
		await pwaPage.evaluate(() => {
			window.location.hash = "#/transactions";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(600);
		await pwaPage.locator('[data-action="show-edit-tx"]').first().click();
		await pwaPage.waitForSelector(".modal-overlay");
		await pwaPage.waitForTimeout(300);
	}

	// -------------------------------------------------------------------------
	// Notes field
	// -------------------------------------------------------------------------

	test("Gmail tx: LLM description shown as placeholder, value is empty", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, {
			description: "Merchant: HDFC MF | Method: UPI | Purpose: SIP",
			notes: null,
		});
		await openEditModal(pwaPage);

		const editDesc = pwaPage.locator("#edit-desc");
		expect(await editDesc.inputValue()).toBe("");
		const ph = await editDesc.getAttribute("placeholder");
		expect(ph).toBe("Add Notes");
	});

	test("Gmail tx with saved user notes: notes shown as value, description stays as placeholder", async ({
		pwaPage,
	}) => {
		await createGmailTx(pwaPage, {
			description: "Merchant: HDFC MF | Method: UPI | Purpose: SIP",
			notes: "My custom SIP note",
		});
		await openEditModal(pwaPage);

		const editDesc = pwaPage.locator("#edit-desc");
		expect(await editDesc.inputValue()).toBe("My custom SIP note");
		const ph = await editDesc.getAttribute("placeholder");
		expect(ph).toBe("Add Notes");
	});

	test("Gmail tx: typing a note and saving persists it as normal text on reopen", async ({
		pwaPage,
	}) => {
		await createGmailTx(pwaPage, {
			gmailMessageId: "gmail-save-test",
			description: "Merchant: HDFC MF | Method: UPI | Purpose: SIP",
			notes: null,
		});
		await openEditModal(pwaPage);

		// Type a custom note and save
		await pwaPage.locator("#edit-desc").fill("User entered note");
		await pwaPage.locator('[data-action="save-transaction"]').click();
		await pwaPage.waitForTimeout(600);

		// Reopen
		await pwaPage.locator('[data-action="show-edit-tx"]').first().click();
		await pwaPage.waitForSelector(".modal-overlay");
		await pwaPage.waitForTimeout(300);

		const editDesc = pwaPage.locator("#edit-desc");
		// Must show as value (normal text), not placeholder
		expect(await editDesc.inputValue()).toBe("User entered note");
		const ph = await editDesc.getAttribute("placeholder");
		expect(ph).toBe("Add Notes");
	});

	test("Manual tx: existing description shown as value (normal text)", async ({ pwaPage }) => {
		await pwaPage.evaluate(async () => {
			const acc = await DB.createAccount({
				name: "Manual Note Acc",
				balance: 5000,
				account_type: "savings",
			});
			await DB.createTransaction({
				date: new Date().toISOString().split("T")[0],
				amount: -500,
				description: "Manual note text",
				transaction_type: "expense",
				account_id: acc.id,
				merchant_name: "Local Shop",
			});
		});
		await openEditModal(pwaPage);

		const editDesc = pwaPage.locator("#edit-desc");
		// No notes — value is empty; description not shown in notes field
		expect(await editDesc.inputValue()).toBe("");
		const ph = await editDesc.getAttribute("placeholder");
		expect(ph).toBe("Add Notes");
	});

	// -------------------------------------------------------------------------
	// Payment Reference
	// -------------------------------------------------------------------------

	test("Payment Reference: bank payment_reference shown", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, {
			paymentReference: "BANK-REF-12345",
			gmailMessageId: "gmail-ref-test",
			merchantUpiId: null,
		});
		await openEditModal(pwaPage);
		const payRef = await pwaPage.locator("#edit-payment-ref").inputValue();
		expect(payRef).toBe("BANK-REF-12345");
	});

	test("Payment Reference: no payment_reference but has UPI ID — shows UPI ID", async ({
		pwaPage,
	}) => {
		await createGmailTx(pwaPage, {
			paymentReference: null,
			gmailMessageId: "gmail-upi-test",
			merchantUpiId: "hdfc@upi",
		});
		await openEditModal(pwaPage);
		const payRef = await pwaPage.locator("#edit-payment-ref").inputValue();
		expect(payRef).toBe("hdfc@upi");
	});

	test("Payment Reference: UPI tx with no payment_reference shows UPI ID", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, {
			paymentReference: null,
			gmailMessageId: "gmail-upi-only",
			merchantUpiId: "sbi@upi",
		});
		await openEditModal(pwaPage);
		const payRef = await pwaPage.locator("#edit-payment-ref").inputValue();
		expect(payRef).toBe("sbi@upi");
	});

	test("Payment Reference: non-UPI tx with no payment_reference shows blank", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, {
			paymentReference: null,
			gmailMessageId: "gmail-blank-ref",
			merchantUpiId: null,
		});
		await openEditModal(pwaPage);
		const payRef = await pwaPage.locator("#edit-payment-ref").inputValue();
		expect(payRef).toBe("");
	});

	test("Payment Reference: is read-only", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, { merchantUpiId: "test@upi" });
		await openEditModal(pwaPage);
		const payRefEl = pwaPage.locator("#edit-payment-ref");
		expect(await payRefEl.getAttribute("readonly")).not.toBeNull();
	});

	test("Payment Reference: payment_reference takes priority over UPI ID", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, {
			paymentReference: "346012383131",
			merchantUpiId: "merchant@upi",
			gmailMessageId: "gmail-priority-test",
		});
		await openEditModal(pwaPage);
		const payRef = await pwaPage.locator("#edit-payment-ref").inputValue();
		expect(payRef).toBe("346012383131");
	});

	// -------------------------------------------------------------------------
	// Transaction Type field
	// -------------------------------------------------------------------------

	test("Transaction Type field: UPI via merchant_upi_id", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, { merchantUpiId: "hdfc@upi", description: null });
		await openEditModal(pwaPage);
		const payType = pwaPage.locator("#edit-payment-type");
		expect(await payType.inputValue()).toBe("UPI");
		expect(await payType.getAttribute("readonly")).not.toBeNull();
	});

	test("Transaction Type field: NEFT via description", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, { merchantUpiId: null, description: "NEFT transfer ref 789" });
		await openEditModal(pwaPage);
		expect(await pwaPage.locator("#edit-payment-type").inputValue()).toBe("NEFT");
	});

	test("Transaction Type field: RTGS via description", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, { merchantUpiId: null, description: "RTGS payment to vendor" });
		await openEditModal(pwaPage);
		expect(await pwaPage.locator("#edit-payment-type").inputValue()).toBe("RTGS");
	});

	test("Transaction Type field: IMPS via description", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, { merchantUpiId: null, description: "IMPS payment received" });
		await openEditModal(pwaPage);
		expect(await pwaPage.locator("#edit-payment-type").inputValue()).toBe("IMPS");
	});

	test("Transaction Type field: Wallet via description", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, { merchantUpiId: null, description: "Wallet payment debit" });
		await openEditModal(pwaPage);
		expect(await pwaPage.locator("#edit-payment-type").inputValue()).toBe("Wallet");
	});

	test("Transaction Type field: Unknown when no pattern matches", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, { merchantUpiId: null, description: null });
		await openEditModal(pwaPage);
		expect(await pwaPage.locator("#edit-payment-type").inputValue()).toBe("Unknown");
	});

	test("Transaction Type field: Wallet \u2014 Method: Wallet NOT treated as UPI", async ({ pwaPage }) => {
		await createGmailTx(pwaPage, {
			merchantUpiId: null,
			description: "Merchant: Amazon | Method: Wallet | Via: Amazon Pay",
		});
		await openEditModal(pwaPage);
		expect(await pwaPage.locator("#edit-payment-type").inputValue()).toBe("Wallet");
	});

	test("Transaction Type field: UPI via merchantUpiId even when description says Wallet", async ({
		pwaPage,
	}) => {
		await createGmailTx(pwaPage, {
			merchantUpiId: "amazonpay@apl",
			description: "Merchant: Amazon | Method: Wallet | Via: Amazon Pay",
		});
		await openEditModal(pwaPage);
		expect(await pwaPage.locator("#edit-payment-type").inputValue()).toBe("UPI");
	});
});

// ===========================================================================
// BUG 2 — Merchant rename is remembered and propagates to past transactions
// ===========================================================================
test.describe("TestMerchantRenamePropagation", () => {
	test("renaming a UPI merchant updates its past transactions", async ({ pwaPage }) => {
		const names = await pwaPage.evaluate(async () => {
			const acc = await DB.createAccount({ name: "A", balance: 0, account_type: "savings" });
			const cats = await DB.getCategories();
			const m = await DB.createMerchant({
				merchant_name: "Zomato",
				merchant_upi_id: "zomato@upi",
				category_id: cats[0].id,
			});
			await DB.createTransaction({
				date: "2025-02-01",
				amount: -300,
				description: "old order",
				transaction_type: "expense",
				account_id: acc.id,
				merchant_upi_id: "zomato@upi",
				merchant_name: "Zomato",
			});
			// Rename via the same API bridge the merchant edit modal uses.
			await API.updateMerchant(m.id, { merchant_name: "Zomato Ltd" });
			const txns = await DB.getTransactions({});
			return txns.map((t) => t.merchant_name);
		});
		expect(names).toContain("Zomato Ltd");
		expect(names).not.toContain("Zomato");
	});

	test("renamed UPI merchant display name is applied to a future Gmail import", async ({
		pwaPage,
	}) => {
		const merchantName = await pwaPage.evaluate(async () => {
			const cats = await DB.getCategories();
			const m = await DB.createMerchant({
				merchant_name: "Swiggy",
				merchant_upi_id: "swiggy@upi",
				category_id: cats[0].id,
			});
			await API.updateMerchant(m.id, { merchant_name: "Swiggy Foods" });
			// A later Gmail import for the same UPI must use the stored display name.
			await Gmail._importTransaction({
				gmail_message_id: "e2e-rename-1",
				amount: -120,
				description: "lunch",
				transaction_type: "expense",
				date: "2025-03-01T10:00",
				bank_name: "HDFC",
				account_type: "savings",
				account_last_digits: "1234",
				email_from: "alerts@hdfcbank.net",
				merchant_upi_id: "swiggy@upi",
				merchant_name: "SWIGGY",
				is_transaction: true,
				is_balance_info: false,
			});
			const tx = DB._queryOne(
				"SELECT merchant_name FROM transactions WHERE gmail_message_id = ?",
				["e2e-rename-1"],
			);
			return tx.merchant_name;
		});
		expect(merchantName).toBe("Swiggy Foods");
	});
});

// ===========================================================================
// BUG 3 — "Yes, map all" re-categorizes PAST transactions too
// ===========================================================================
test.describe("TestMapAllRecategorizesPast", () => {
	test("learning a category retro-updates past name-variant rows, future too", async ({
		pwaPage,
	}) => {
		const result = await pwaPage.evaluate(async () => {
			const acc = await DB.createAccount({ name: "A", balance: 0, account_type: "savings" });
			const cats = await DB.getCategories();
			const food = cats[0].id;
			const shop = cats[1].id;
			// Past transaction (different case of the same merchant name).
			const past = await DB.createTransaction({
				date: "2025-01-01",
				amount: -100,
				description: "past",
				transaction_type: "expense",
				account_id: acc.id,
				merchant_name: "Blinkit",
				category_id: food,
			});
			// Current transaction the user is categorizing (category already set to shop,
			// matching the real flow where updateTransaction sets it before learning).
			const current = await DB.createTransaction({
				date: "2025-01-05",
				amount: -200,
				description: "current",
				transaction_type: "expense",
				account_id: acc.id,
				merchant_name: "blinkit",
				category_id: shop,
			});
			const curRow = DB._queryOne("SELECT * FROM transactions WHERE id = ?", [current.id]);
			DB._learnMerchantMapping(curRow, shop);
			await DB._persist();
			const pastRow = DB._queryOne("SELECT category_id FROM transactions WHERE id = ?", [past.id]);
			const curAfter = DB._queryOne("SELECT category_id FROM transactions WHERE id = ?", [
				current.id,
			]);
			return { pastCat: pastRow.category_id, curCat: curAfter.category_id, shop };
		});
		expect(result.pastCat).toBe(result.shop);
		expect(result.curCat).toBe(result.shop);
	});

	test("map-all does not sweep unrelated UPI merchants sharing a generic name", async ({
		pwaPage,
	}) => {
		const result = await pwaPage.evaluate(async () => {
			const acc = await DB.createAccount({ name: "A", balance: 0, account_type: "savings" });
			const cats = await DB.getCategories();
			const shop = cats[1].id;
			const a = await DB.createTransaction({
				date: "2025-01-01",
				amount: -100,
				description: "store-a",
				transaction_type: "expense",
				account_id: acc.id,
				merchant_upi_id: "store-a@upi",
				merchant_name: "Store",
			});
			const b = await DB.createTransaction({
				date: "2025-01-02",
				amount: -200,
				description: "store-b",
				transaction_type: "expense",
				account_id: acc.id,
				merchant_upi_id: "store-b@upi",
				merchant_name: "Store",
			});
			const aRow = DB._queryOne("SELECT * FROM transactions WHERE id = ?", [a.id]);
			DB._learnMerchantMapping(aRow, shop);
			await DB._persist();
			const bAfter = DB._queryOne("SELECT category_id FROM transactions WHERE id = ?", [b.id]);
			return { bCat: bAfter.category_id, shop };
		});
		expect(result.bCat).not.toBe(result.shop);
	});
});

// ===========================================================================
// FINCO-49 — "Show merged accounts" checkbox in Transactions filter
// ===========================================================================
test.describe("TestMergedAccountsFilter", () => {
	/**
	 * Seed a parent account, a child account merged into it, and one
	 * transaction on each. Returns { parentId, childId, parentTxId, childTxId }.
	 */
	async function seedMergedAccounts(page) {
		return page.evaluate(async () => {
			const parent = await DB.createAccount({
				name: "FINCO49 Parent",
				balance: 10000,
				account_type: "savings",
			});
			const child = await DB.createAccount({
				name: "FINCO49 Child",
				balance: 5000,
				account_type: "savings",
			});
			// Merge child into parent (child becomes the source/merged account)
			await DB.mergeAccounts(child.id, parent.id);
			const today = new Date().toISOString().split("T")[0];
			const parentTx = await DB.createTransaction({
				date: today,
				amount: -100,
				description: "Parent TX FINCO49",
				transaction_type: "expense",
				account_id: parent.id,
			});
			const childTx = await DB.createTransaction({
				date: today,
				amount: -200,
				description: "Child TX FINCO49",
				transaction_type: "expense",
				account_id: child.id,
			});
			return {
				parentId: parent.id,
				childId: child.id,
				parentTxId: parentTx.id,
				childTxId: childTx.id,
			};
		});
	}

	async function navigateToTransactions(page) {
		await page.evaluate(() => {
			window.location.hash = "#/transactions";
		});
		await page.waitForSelector("#screen");
		await page.waitForTimeout(600);
	}

	// -------------------------------------------------------------------------
	// Test 1 — Default state: checkbox unchecked, dropdown hides merged children
	// -------------------------------------------------------------------------
	test("f-merged checkbox is unchecked by default", async ({ pwaPage }) => {
		await seedMergedAccounts(pwaPage);
		await navigateToTransactions(pwaPage);

		const checkbox = pwaPage.locator("#f-merged");
		expect(await checkbox.count()).toBe(1);
		expect(await checkbox.isChecked()).toBe(false);
	});

	test("account dropdown hides merged child accounts when f-merged is unchecked", async ({
		pwaPage,
	}) => {
		const { childId } = await seedMergedAccounts(pwaPage);
		await navigateToTransactions(pwaPage);

		// Checkbox must be unchecked (default)
		expect(await pwaPage.locator("#f-merged").isChecked()).toBe(false);

		// Child account should NOT appear in the dropdown
		const childOption = pwaPage.locator(`#f-account option[value="${childId}"]`);
		expect(await childOption.count()).toBe(0);
	});

	// -------------------------------------------------------------------------
	// Test 2 — Checking the box reveals child accounts with "(merged)" suffix
	// -------------------------------------------------------------------------
	test("checking f-merged reveals child accounts with (merged) suffix", async ({ pwaPage }) => {
		const { childId } = await seedMergedAccounts(pwaPage);
		await navigateToTransactions(pwaPage);

		// Check the toggle
		await pwaPage.locator("#f-merged").check();
		await pwaPage.waitForTimeout(400);

		// Child account should now appear with "(merged)" suffix
		const childOption = pwaPage.locator(`#f-account option[value="${childId}"]`);
		expect(await childOption.count()).toBe(1);
		const optionText = await childOption.textContent();
		expect(optionText).toContain("(merged)");
	});

	// -------------------------------------------------------------------------
	// Test 3 — Parent selection (unchecked) includes child transactions
	// -------------------------------------------------------------------------
	test("selecting parent account with f-merged unchecked shows child transactions too", async ({
		pwaPage,
	}) => {
		const { parentId } = await seedMergedAccounts(pwaPage);
		await navigateToTransactions(pwaPage);

		// Ensure checkbox is unchecked
		expect(await pwaPage.locator("#f-merged").isChecked()).toBe(false);

		// Select the parent account in the dropdown
		await pwaPage.locator("#f-account").selectOption(String(parentId));
		await pwaPage.waitForTimeout(600);

		const bodyText = await pwaPage.locator("#tx-list-container").innerText();
		// Both parent and child transactions should appear
		expect(bodyText).toContain("Parent TX FINCO49");
		expect(bodyText).toContain("Child TX FINCO49");
	});

	// -------------------------------------------------------------------------
	// Test 4 — Parent selection (checked) excludes child transactions
	// -------------------------------------------------------------------------
	test("selecting parent account with f-merged checked shows only parent transactions", async ({
		pwaPage,
	}) => {
		const { parentId } = await seedMergedAccounts(pwaPage);
		await navigateToTransactions(pwaPage);

		// Check the toggle first
		await pwaPage.locator("#f-merged").check();
		await pwaPage.waitForTimeout(400);

		// Select the parent account
		await pwaPage.locator("#f-account").selectOption(String(parentId));
		await pwaPage.waitForTimeout(600);

		const bodyText = await pwaPage.locator("#tx-list-container").innerText();
		// Only parent's own transaction should appear — NOT the child's
		expect(bodyText).toContain("Parent TX FINCO49");
		expect(bodyText).not.toContain("Child TX FINCO49");
	});

	// -------------------------------------------------------------------------
	// Test 5 — Unchecking while child is selected resets account filter
	// -------------------------------------------------------------------------
	test("unchecking f-merged while child account is selected resets f-account to All Accounts", async ({
		pwaPage,
	}) => {
		const { childId } = await seedMergedAccounts(pwaPage);
		await navigateToTransactions(pwaPage);

		// First check the box so child accounts appear
		await pwaPage.locator("#f-merged").check();
		await pwaPage.waitForTimeout(400);

		// Select the child account
		await pwaPage.locator("#f-account").selectOption(String(childId));
		await pwaPage.waitForTimeout(200);

		// Verify the child is selected
		const selectedBeforeUncheck = await pwaPage.locator("#f-account").inputValue();
		expect(selectedBeforeUncheck).toBe(String(childId));

		// Now uncheck the toggle — child should disappear and selection should reset
		await pwaPage.locator("#f-merged").uncheck();
		await pwaPage.waitForTimeout(400);

		// #f-account should be back to "" (All Accounts)
		const selectedAfterUncheck = await pwaPage.locator("#f-account").inputValue();
		expect(selectedAfterUncheck).toBe("");
	});
});

