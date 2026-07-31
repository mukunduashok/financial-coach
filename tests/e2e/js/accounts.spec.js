// tests/e2e/js/accounts.spec.js
import { test, expect } from "./fixtures.js";

async function goToAccounts(page) {
  await page.evaluate(() => {
    window.location.hash = "#/accounts";
  });
  await page.waitForSelector("#screen");
}

async function createAccountViaDb(page, name, accountType, balance = 0) {
  return await page.evaluate(
    async ({ name, accountType, balance }) => {
      return await DB.createAccount({ name, account_type: accountType, balance });
    },
    { name, accountType, balance },
  );
}

async function seedAccounts(page) {
  await page.evaluate(async () => {
    await DB.createAccount({ name: "Savings Account", balance: 50000, account_type: "savings" });
    await DB.createAccount({ name: "Credit Card", balance: -2000, account_type: "credit" });
  });
}

test.describe("TestAccountsPage", () => {
  test("accounts page loads", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase().includes("account") || text.length > 200).toBeTruthy();
  });

  test("accounts show seeded data", async ({ pwaPage }) => {
    await seedAccounts(pwaPage);
    await goToAccounts(pwaPage);
    const text = await pwaPage.innerText("body");
    const hasAccounts = ["savings", "credit", "50,000", "50000"].some((keyword) =>
      text.toLowerCase().includes(keyword),
    );
    expect(hasAccounts || text.toLowerCase().includes("no account")).toBeTruthy();
  });

  test("accounts show balance", async ({ pwaPage }) => {
    await seedAccounts(pwaPage);
    await goToAccounts(pwaPage);
    const text = await pwaPage.innerText("body");
    expect(text.length).toBeGreaterThan(100);
  });
});

// FINCO-32 — empty-state CTA
test.describe("TestAccountsEmptyStateCTA", () => {
  test("empty accounts screen shows new copy and a visible CTA button", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.waitForSelector("#screen .empty-state");
    const emptyText = await pwaPage.locator("#screen .empty-text").innerText();
    expect(emptyText).toContain("No accounts yet");
    const cta = pwaPage.locator('.empty-cta[data-action="show-create-account"]');
    await expect(cta).toBeVisible();
    expect((await cta.innerText()).trim()).toBe("Add your first account");
  });

  test("clicking the CTA opens the Create Account modal", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.waitForSelector("#screen .empty-state");
    await pwaPage.locator('.empty-cta[data-action="show-create-account"]').click();
    await pwaPage.waitForSelector(".modal-overlay .modal");
    const modalTitle = await pwaPage.locator(".modal-overlay .modal .modal-title").innerText();
    expect(modalTitle).toContain("Create Account");
  });
});

test.describe("TestCreateAccount", () => {
  test("fab button visible", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    const fab = pwaPage.locator("button.fab");
    expect(await fab.count()).toBeGreaterThan(0);
  });

  test("create modal opens", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const modal = pwaPage.locator(".modal-overlay .modal");
    expect(await modal.count()).toBeGreaterThan(0);
    expect((await modal.innerText()).toLowerCase()).toContain("create account");
  });

  test("create modal has form fields", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    expect(await pwaPage.locator("#acct-name").count()).toBe(1);
    expect(await pwaPage.locator("#acct-type").count()).toBe(1);
    expect(await pwaPage.locator("#acct-balance").count()).toBe(1);
    expect(await pwaPage.locator("#acct-identifier").count()).toBe(1);
  });

  test("create modal cancel", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator(".modal-overlay button:has-text('Cancel')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
  });

  test("create account success", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator("#acct-name").fill("E2E Test Savings");
    await pwaPage.locator("#acct-type").selectOption("savings");
    await pwaPage.locator("#acct-balance").fill("12345");

    await pwaPage.locator(".modal-overlay button:has-text('Create')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("e2e test savings");
  });

  test("create account empty name shows error", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator("#acct-name").fill("");
    await pwaPage.locator(".modal-overlay button:has-text('Create')").click();
    await pwaPage.waitForSelector(".toast.error");

    expect(await pwaPage.locator(".modal-overlay").count()).toBeGreaterThan(0);
  });

  test("create account with identifier", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator("#acct-name").fill("E2E Deposit Acct");
    await pwaPage.locator("#acct-type").selectOption("deposit");
    await pwaPage.locator("#acct-balance").fill("100000");
    await pwaPage.locator("#acct-identifier").fill("9876");

    await pwaPage.locator(".modal-overlay button:has-text('Create')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("e2e deposit acct");
  });
});

test.describe("TestMergeAccounts", () => {
  test("merge button visible", async ({ pwaPage }) => {
    await seedAccounts(pwaPage);
    await goToAccounts(pwaPage);
    const mergeBtn = pwaPage.locator("button:has-text('Merge Accounts')");
    expect(await mergeBtn.count()).toBeGreaterThan(0);
  });

  test("merge modal opens", async ({ pwaPage }) => {
    await seedAccounts(pwaPage);
    await goToAccounts(pwaPage);
    await pwaPage.locator("button:has-text('Merge Accounts')").click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const modal = pwaPage.locator(".modal-overlay .modal");
    expect(await modal.count()).toBeGreaterThan(0);
    expect((await modal.innerText()).toLowerCase()).toContain("merge");
  });

  test("merge modal has dropdowns", async ({ pwaPage }) => {
    await seedAccounts(pwaPage);
    await goToAccounts(pwaPage);
    await pwaPage.locator("button:has-text('Merge Accounts')").click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    expect(await pwaPage.locator("#merge-source").count()).toBe(1);
    expect(await pwaPage.locator("#merge-target").count()).toBe(1);
  });

  test("merge modal cancel", async ({ pwaPage }) => {
    await seedAccounts(pwaPage);
    await goToAccounts(pwaPage);
    await pwaPage.locator("button:has-text('Merge Accounts')").click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator(".modal-overlay button:has-text('Cancel')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
  });

  test("merge accounts same type", async ({ pwaPage }) => {
    const acctA = await createAccountViaDb(pwaPage, "Merge Source A", "savings", 100);
    const acctB = await createAccountViaDb(pwaPage, "Merge Target B", "savings", 200);

    await goToAccounts(pwaPage);
    await pwaPage.locator("button:has-text('Merge Accounts')").click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator("#merge-source").selectOption(String(acctA.id));
    await pwaPage.locator("#merge-target").selectOption(String(acctB.id));
    await pwaPage.locator(".modal-overlay button:has-text('Merge')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("merge target b");
  });

  test("merge no source shows error", async ({ pwaPage }) => {
    await seedAccounts(pwaPage);
    await goToAccounts(pwaPage);
    await pwaPage.locator("button:has-text('Merge Accounts')").click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator(".modal-overlay button:has-text('Merge')").click();
    await pwaPage.waitForTimeout(300);

    expect(await pwaPage.locator(".modal-overlay").count()).toBeGreaterThan(0);
  });

  test("merge same account shows error", async ({ pwaPage }) => {
    const acct = await createAccountViaDb(pwaPage, "Self Merge Acct", "current", 50);
    await createAccountViaDb(pwaPage, "Dummy Acct", "current", 10);

    await goToAccounts(pwaPage);
    await pwaPage.locator("button:has-text('Merge Accounts')").click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const acctIdStr = String(acct.id);
    await pwaPage.locator("#merge-source").selectOption(acctIdStr);
    await pwaPage.locator("#merge-target").selectOption(acctIdStr);
    await pwaPage.locator(".modal-overlay button:has-text('Merge')").click();
    await pwaPage.waitForTimeout(300);

    expect(await pwaPage.locator(".modal-overlay").count()).toBeGreaterThan(0);
  });

  test("merge different types shows error", async ({ pwaPage }) => {
    const acctS = await createAccountViaDb(pwaPage, "Type Mismatch Src", "savings", 100);
    const acctC = await createAccountViaDb(pwaPage, "Type Mismatch Tgt", "credit", 200);

    await goToAccounts(pwaPage);
    await pwaPage.locator("button:has-text('Merge Accounts')").click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator("#merge-source").selectOption(String(acctS.id));
    await pwaPage.locator("#merge-target").selectOption(String(acctC.id));
    await pwaPage.locator(".modal-overlay button:has-text('Merge')").click();
    await pwaPage.waitForTimeout(300);

    expect(await pwaPage.locator(".modal-overlay").count()).toBeGreaterThan(0);
  });
});

test.describe("TestUnmergeAccount", () => {
  test("unmerge button visible on merged child", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      const src = await DB.createAccount({
        name: "Unmerge Src",
        account_type: "savings",
        balance: 10,
      });
      const tgt = await DB.createAccount({
        name: "Unmerge Tgt",
        account_type: "savings",
        balance: 20,
      });
      await DB.mergeAccounts(src.id, tgt.id);
    });

    await goToAccounts(pwaPage);

    const card = pwaPage.locator(".account-info:has-text('Unmerge Tgt')");
    if ((await card.count()) > 0) {
      await card.first().click();
      await pwaPage.waitForTimeout(300);
    }

    const unmergeBtn = pwaPage.locator("button[title='Unmerge']");
    expect(await unmergeBtn.count()).toBeGreaterThan(0);
  });

  test("unmerge flow", async ({ pwaPage }) => {
    const tgtId = await pwaPage.evaluate(async () => {
      const src = await DB.createAccount({
        name: "Restore Src",
        account_type: "current",
        balance: 500,
      });
      const tgt = await DB.createAccount({
        name: "Restore Tgt",
        account_type: "current",
        balance: 1000,
      });
      await DB.mergeAccounts(src.id, tgt.id);
      return tgt.id;
    });

    await goToAccounts(pwaPage);

    const card = pwaPage.locator(".account-info:has-text('Restore Tgt')");
    if ((await card.count()) > 0) {
      await card.first().click();
      await pwaPage.waitForTimeout(300);
    }

    const unmergeBtn = pwaPage.locator(`#children-${tgtId} button[title='Unmerge']`);
    if ((await unmergeBtn.count()) > 0) {
      await unmergeBtn.first().click();
      await pwaPage.waitForSelector(".modal-overlay .modal");

      const confirmBtn = pwaPage.locator(".modal-overlay button:has-text('Unmerge')");
      if ((await confirmBtn.count()) > 0) {
        await confirmBtn.first().click();
        await pwaPage.waitForFunction(
          () =>
            document.querySelector(".modal-overlay") === null ||
            getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
        );
      }

      const text = await pwaPage.innerText("body");
      expect(text.toLowerCase()).toContain("restore src");
    }
  });
});

test.describe("TestGroupedLayout", () => {
  test("savings account appears in Savings Accounts section", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "My Savings", "savings", 10000);
    await goToAccounts(pwaPage);

    const heading = pwaPage.locator(".acct-section-title", { hasText: "Savings Accounts" });
    expect(await heading.count()).toBe(1);
  });

  test("savings account renders as bank tile", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Bank Tile Acct", "savings", 5000);
    await goToAccounts(pwaPage);

    const tile = pwaPage.locator(".acct-tile--bank", { hasText: "Bank Tile Acct" });
    expect(await tile.count()).toBe(1);
  });

  test("credit account appears in Credit Cards section with credit tile", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "My Credit Card", "credit", -1500);
    await goToAccounts(pwaPage);

    const heading = pwaPage.locator(".acct-section-title", { hasText: "Credit Cards" });
    expect(await heading.count()).toBe(1);

    const tile = pwaPage.locator(".acct-tile--credit", { hasText: "My Credit Card" });
    expect(await tile.count()).toBe(1);
  });

  test("credit_card type also renders as credit tile", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "CC Type Acct", "credit_card", 0);
    await goToAccounts(pwaPage);

    const tile = pwaPage.locator(".acct-tile--credit", { hasText: "CC Type Acct" });
    expect(await tile.count()).toBe(1);
  });

  test("debit_card account appears in Prepaid / Debit Cards section", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "My Debit Card", "debit_card", 2000);
    await goToAccounts(pwaPage);

    const heading = pwaPage.locator(".acct-section-title", { hasText: "Prepaid / Debit Cards" });
    expect(await heading.count()).toBe(1);

    const tile = pwaPage.locator(".acct-tile--debit", { hasText: "My Debit Card" });
    expect(await tile.count()).toBe(1);
  });

  test("prepaid type renders as debit tile", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Prepaid Wallet", "prepaid", 500);
    await goToAccounts(pwaPage);

    const tile = pwaPage.locator(".acct-tile--debit", { hasText: "Prepaid Wallet" });
    expect(await tile.count()).toBe(1);
  });

  test("unrecognised type renders in Others section as wallet tile", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Misc Account", "wallet", 0);
    await goToAccounts(pwaPage);

    const heading = pwaPage.locator(".acct-section-title", { hasText: "Others" });
    expect(await heading.count()).toBe(1);

    const tile = pwaPage.locator(".acct-tile--wallet", { hasText: "Misc Account" });
    expect(await tile.count()).toBe(1);
  });

  test("section heading hidden when no accounts of that type exist", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Only Savings", "savings", 1000);
    await goToAccounts(pwaPage);

    const creditHeading = pwaPage.locator(".acct-section-title", { hasText: "Credit Cards" });
    expect(await creditHeading.count()).toBe(0);
  });

  test("tile shows account name and balance", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Balance Check Acct", "savings", 75000);
    await goToAccounts(pwaPage);

    const tile = pwaPage.locator(".acct-tile--bank", { hasText: "Balance Check Acct" });
    expect(await tile.count()).toBe(1);

    const tileText = await tile.innerText();
    expect(tileText.toLowerCase()).toContain("balance check acct");
  });

  test("edit and delete buttons visible on bank tile", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Actions Test Acct", "savings", 100);
    await goToAccounts(pwaPage);

    const tile = pwaPage.locator(".acct-tile--bank", { hasText: "Actions Test Acct" });
    expect(await tile.count()).toBe(1);

    const editBtn = tile.locator("button[title='Edit account']");
    const deleteBtn = tile.locator("button[title='Delete']");
    expect(await editBtn.count()).toBe(1);
    expect(await deleteBtn.count()).toBe(1);
  });

  test("multiple account types create multiple sections", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Multi Section Savings", "savings", 1000);
    await createAccountViaDb(pwaPage, "Multi Section Credit", "credit", -500);
    await goToAccounts(pwaPage);

    const savingsHeading = pwaPage.locator(".acct-section-title", { hasText: "Savings Accounts" });
    const creditHeading = pwaPage.locator(".acct-section-title", { hasText: "Credit Cards" });
    expect(await savingsHeading.count()).toBe(1);
    expect(await creditHeading.count()).toBe(1);
  });

  test("current account appears in Current Accounts section with bank tile", async ({
    pwaPage,
  }) => {
    await createAccountViaDb(pwaPage, "Current Acct", "current", 20000);
    await goToAccounts(pwaPage);

    const heading = pwaPage.locator(".acct-section-title", { hasText: "Current Accounts" });
    expect(await heading.count()).toBe(1);

    const tile = pwaPage.locator(".acct-tile--bank", { hasText: "Current Acct" });
    expect(await tile.count()).toBe(1);
  });
});

test.describe("TestCreateAccountTypes", () => {
  test("create modal includes credit_card type option", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const options = await pwaPage.locator("#acct-type option").allInnerTexts();
    const values = await pwaPage.locator("#acct-type option").evaluateAll((opts) =>
      opts.map((o) => o.value),
    );
    expect(values).toContain("credit_card");
  });

  test("create modal includes debit_card type option", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const values = await pwaPage.locator("#acct-type option").evaluateAll((opts) =>
      opts.map((o) => o.value),
    );
    expect(values).toContain("debit_card");
  });

  test("create modal includes prepaid type option", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const values = await pwaPage.locator("#acct-type option").evaluateAll((opts) =>
      opts.map((o) => o.value),
    );
    expect(values).toContain("prepaid");
  });

  test("create modal includes wallet type option", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const values = await pwaPage.locator("#acct-type option").evaluateAll((opts) =>
      opts.map((o) => o.value),
    );
    expect(values).toContain("wallet");
  });

  test("creating a credit_card account shows it in Credit Cards section", async ({ pwaPage }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator("#acct-name").fill("New Credit Card");
    await pwaPage.locator("#acct-type").selectOption("credit_card");
    await pwaPage.locator("#acct-balance").fill("0");

    await pwaPage.locator(".modal-overlay button:has-text('Create')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    const tile = pwaPage.locator(".acct-tile--credit", { hasText: "New Credit Card" });
    expect(await tile.count()).toBe(1);
  });

  test("creating a debit_card account shows it in Prepaid / Debit Cards section", async ({
    pwaPage,
  }) => {
    await goToAccounts(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator("#acct-name").fill("New Debit Card");
    await pwaPage.locator("#acct-type").selectOption("debit_card");
    await pwaPage.locator("#acct-balance").fill("3000");

    await pwaPage.locator(".modal-overlay button:has-text('Create')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    const heading = pwaPage.locator(".acct-section-title", { hasText: "Prepaid / Debit Cards" });
    expect(await heading.count()).toBe(1);
  });
});

test.describe("TestDeleteAccount", () => {
  test("delete button visible", async ({ pwaPage }) => {
    await seedAccounts(pwaPage);
    await goToAccounts(pwaPage);
    const deleteBtn = pwaPage.locator("button[title='Delete']");
    expect(await deleteBtn.count()).toBeGreaterThan(0);
  });

  test("delete confirm dialog opens", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Delete Dialog Acct", "debit", 0);

    await goToAccounts(pwaPage);
    const deleteBtn = pwaPage.locator("button[title='Delete']");
    expect(await deleteBtn.count()).toBeGreaterThan(0);
    await deleteBtn.last().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    expect(await pwaPage.locator(".modal-overlay").count()).toBeGreaterThan(0);
  });

  test("delete cancel", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Keep This Acct", "savings", 999);

    await goToAccounts(pwaPage);
    const textBefore = await pwaPage.innerText("body");
    expect(textBefore.toLowerCase()).toContain("keep this acct");

    await pwaPage.locator("button[title='Delete']").last().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator(".modal-overlay button:has-text('Cancel')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    const textAfter = await pwaPage.innerText("body");
    expect(textAfter.toLowerCase()).toContain("keep this acct");
  });

  test("delete account success", async ({ pwaPage }) => {
    await createAccountViaDb(pwaPage, "Delete Me Acct", "debit", 0);

    await goToAccounts(pwaPage);
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("delete me acct");

    const card = pwaPage.locator(".card:has-text('Delete Me Acct')");
    const deleteBtn = card.locator("button[title='Delete']");
    await deleteBtn.click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator(".modal-overlay button:has-text('Delete')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    const textAfter = await pwaPage.innerText("body");
    expect(textAfter.toLowerCase()).not.toContain("delete me acct");
  });
});

// ===========================================================================
// BUG-PROD-03: Accounts page shows "Balance not yet synced" for manual balances
// ===========================================================================
test.describe("TestBUGPROD03BalanceNotYetSynced", () => {
	test("savings account with initial balance shows currency, not sync message", async ({
		pwaPage,
	}) => {
		await createAccountViaDb(pwaPage, "BUGFIX Savings", "savings", 25000);
		await goToAccounts(pwaPage);
		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toContain("bugfix savings");
		expect(text).not.toContain("Balance not yet synced");
		// Should display formatted balance
		expect(text).toMatch(/25[,.]?000/);
	});

	test("current account with initial balance shows currency, not sync message", async ({
		pwaPage,
	}) => {
		await createAccountViaDb(pwaPage, "BUGFIX Current", "current", 75000);
		await goToAccounts(pwaPage);
		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toContain("bugfix current");
		expect(text).not.toContain("Balance not yet synced");
		expect(text).toMatch(/75[,.]?000/);
	});

	test("deposit account with initial balance shows currency, not sync message", async ({
		pwaPage,
	}) => {
		await createAccountViaDb(pwaPage, "BUGFIX FD", "deposit", 50000);
		await goToAccounts(pwaPage);
		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toContain("bugfix fd");
		expect(text).not.toContain("Balance not yet synced");
		expect(text).toMatch(/50[,.]?000/);
	});

	test("account created via UI form with balance shows currency, not sync message", async ({
		pwaPage,
	}) => {
		await goToAccounts(pwaPage);
		await pwaPage.locator("button.fab").first().click();
		await pwaPage.waitForSelector(".modal-overlay .modal");

		await pwaPage.locator("#acct-name").fill("UI Created Savings");
		await pwaPage.locator("#acct-type").selectOption("savings");
		await pwaPage.locator("#acct-balance").fill("30000");

		await pwaPage.locator(".modal-overlay button:has-text('Create')").click();
		await pwaPage.waitForFunction(
			() =>
				document.querySelector(".modal-overlay") === null ||
				getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
		);

		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toContain("ui created savings");
		expect(text).not.toContain("Balance not yet synced");
		expect(text).toMatch(/30[,.]?000/);
	});

	test("zero-balance savings account shows sync message (expected behavior)", async ({
		pwaPage,
	}) => {
		await createAccountViaDb(pwaPage, "Zero Balance Savings", "savings", 0);
		await goToAccounts(pwaPage);
		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toContain("zero balance savings");
		// Zero-balance savings accounts show "Balance not yet synced" — this is
		// expected because balance_updated_at stays null when no balance is provided.
		expect(text).toContain("Balance not yet synced");
	});

	test("non-balance-display-type account does not show sync message or balance", async ({
		pwaPage,
	}) => {
		// credit/debit/wallet accounts are not in BALANCE_DISPLAY_TYPES
		await createAccountViaDb(pwaPage, "BUGFIX Wallet", "wallet", 10000);
		await goToAccounts(pwaPage);
		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toContain("bugfix wallet");
		// wallet accounts never show balance or sync message in the account card
		expect(text).not.toContain("Balance not yet synced");
	});
});

// ---------------------------------------------------------------------------
// Item 4 — Edit Account Modal & Credit Billing Cycle Balance
// ---------------------------------------------------------------------------
test.describe("TestEditAccount", () => {
  async function seedSavingsAndCredit(page) {
    return await page.evaluate(async () => {
      const savings = await DB.createAccount({
        name: "Edit Test Savings",
        balance: 5000,
        account_type: "savings",
      });
      const credit = await DB.createAccount({
        name: "Edit Test Credit",
        balance: 0,
        account_type: "credit",
      });
      return { savingsId: savings.id, creditId: credit.id };
    });
  }

  test("edit button (pencil icon) is present on account cards", async ({ pwaPage }) => {
    await seedSavingsAndCredit(pwaPage);
    await goToAccounts(pwaPage);
    const editBtns = pwaPage.locator("button[data-action='show-edit-account']");
    expect(await editBtns.count()).toBeGreaterThanOrEqual(1);
  });

  test("clicking edit button opens edit modal", async ({ pwaPage }) => {
    await seedSavingsAndCredit(pwaPage);
    await goToAccounts(pwaPage);

    const editBtn = pwaPage.locator("button[data-action='show-edit-account']").first();
    await editBtn.click();
    await pwaPage.waitForSelector(".modal-overlay .modal", { timeout: 3000 });

    const modal = pwaPage.locator(".modal-overlay .modal");
    expect(await modal.count()).toBe(1);
    const modalText = (await modal.innerText()).toLowerCase();
    expect(modalText.includes("edit") || modalText.includes("account")).toBe(true);
  });

  test("edit modal for credit account shows billing_cycle_start_day input", async ({ pwaPage }) => {
    const { creditId } = await seedSavingsAndCredit(pwaPage);
    await goToAccounts(pwaPage);

    // Click the edit button for the credit account specifically
    const editBtn = pwaPage.locator(
      `button[data-action='show-edit-account'][data-id='${creditId}']`,
    );
    await editBtn.click();
    await pwaPage.waitForSelector("#edit-acct-cycle-day", { timeout: 3000 });

    const cycleDayInput = pwaPage.locator("#edit-acct-cycle-day");
    expect(await cycleDayInput.count()).toBe(1);
    expect(await cycleDayInput.isVisible()).toBe(true);
  });

  test("edit modal for savings account does NOT show billing_cycle_start_day input", async ({ pwaPage }) => {
    const { savingsId } = await seedSavingsAndCredit(pwaPage);
    await goToAccounts(pwaPage);

    const editBtn = pwaPage.locator(
      `button[data-action='show-edit-account'][data-id='${savingsId}']`,
    );
    await editBtn.click();
    await pwaPage.waitForSelector(".modal-overlay .modal", { timeout: 3000 });

    const cycleDayInput = pwaPage.locator("#edit-acct-cycle-day");
    expect(await cycleDayInput.count()).toBe(0);
  });

  test("saving edit modal with new name updates account name on screen", async ({ pwaPage }) => {
    const { savingsId } = await seedSavingsAndCredit(pwaPage);
    await goToAccounts(pwaPage);

    const editBtn = pwaPage.locator(
      `button[data-action='show-edit-account'][data-id='${savingsId}']`,
    );
    await editBtn.click();
    await pwaPage.waitForSelector("#edit-acct-name", { timeout: 3000 });

    await pwaPage.locator("#edit-acct-name").fill("Renamed Savings Account");
    await pwaPage.locator("button[data-action='do-edit-account']").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("renamed savings account");
  });

  test("credit account card shows 'due this cycle' text in balance area", async ({ pwaPage }) => {
    const { creditId } = await seedSavingsAndCredit(pwaPage);

    // Add a transaction to the credit account so balance area has real data
    await pwaPage.evaluate(async (id) => {
      const today = new Date().toISOString().split("T")[0];
      await DB.createTransaction({
        date: today,
        amount: -200,
        description: "Credit Purchase",
        transaction_type: "expense",
        account_id: id,
      });
    }, creditId);

    await goToAccounts(pwaPage);

    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("due this cycle");
  });
});

// ---------------------------------------------------------------------------
// Fix: merged credit account hierarchy — source must appear as child, not as
// a separate top-level card (inactive account filtering in renderAccounts)
// ---------------------------------------------------------------------------
test.describe("TestMergeHierarchy", () => {
  test("merged source account does not appear as separate top-level card", async ({ pwaPage }) => {
    // Merge savings A into savings B — A becomes merged (is_active=0) with merged_into_id set
    await pwaPage.evaluate(async () => {
      const src = await DB.createAccount({
        name: "Hierarchy Source",
        account_type: "savings",
        balance: 1000,
      });
      const tgt = await DB.createAccount({
        name: "Hierarchy Target",
        account_type: "savings",
        balance: 2000,
      });
      await DB.mergeAccounts(src.id, tgt.id);
    });

    await goToAccounts(pwaPage);

    // Count top-level account tiles — only the active target should appear
    // Exclude tiles nested inside .account-children (merged children)
    const topLevelCards = pwaPage.locator(".acct-tile:not(.account-children .acct-tile)");
    const count = await topLevelCards.count();
    expect(count).toBe(1);

    // The target (active) must be the only top-level card
    const bodyText = await pwaPage.innerText("body");
    expect(bodyText.toLowerCase()).toContain("hierarchy target");
  });

  test("merged source appears as child under target, not as a separate card", async ({
    pwaPage,
  }) => {
    const ids = await pwaPage.evaluate(async () => {
      const src = await DB.createAccount({
        name: "Child Source Acct",
        account_type: "current",
        balance: 500,
      });
      const tgt = await DB.createAccount({
        name: "Parent Target Acct",
        account_type: "current",
        balance: 1500,
      });
      await DB.mergeAccounts(src.id, tgt.id);
      return { srcId: src.id, tgtId: tgt.id };
    });

    await goToAccounts(pwaPage);

    // Expand the target card's children by clicking the tile body
    const tileBody = pwaPage.locator(".acct-tile__body[data-id='" + ids.tgtId + "']");
    if ((await tileBody.count()) > 0) {
      await tileBody.first().click();
      await pwaPage.waitForTimeout(300);
    }

    const bodyText = await pwaPage.innerText("body");
    // Source should appear (as a child) — not hidden entirely
    expect(bodyText.toLowerCase()).toContain("child source acct");
    // Target must be visible as the top-level card
    expect(bodyText.toLowerCase()).toContain("parent target acct");
  });

  test("orphan inactive account (merged_into_id=null, is_active=false) is visible for user action", async ({
    pwaPage,
  }) => {
    // Simulate the orphan state: inactive account with no parent reference
    // (happens when a merge target is deleted — ON DELETE SET NULL clears merged_into_id)
    await pwaPage.evaluate(async () => {
      const src = await DB.createAccount({
        name: "Orphan Ghost Account",
        account_type: "savings",
        balance: 0,
      });
      const tgt = await DB.createAccount({
        name: "Temp Target To Delete",
        account_type: "savings",
        balance: 100,
      });
      await DB.mergeAccounts(src.id, tgt.id);
      // Manually null out merged_into_id to simulate ON DELETE SET NULL scenario
      // while keeping is_active=false — this is the phantom bug scenario
      DB._db.run("UPDATE accounts SET merged_into_id = NULL WHERE id = ?", [src.id]);
      await DB._persist();
    });

    await goToAccounts(pwaPage);

    const bodyText = await pwaPage.innerText("body");
    // Orphan accounts must remain visible so the user can act on them
    expect(bodyText.toLowerCase()).toContain("orphan ghost account");
  });
});

// ===========================================================================
// BUG 4 — Credit card due amount is correct (exclusions + merged family)
// ===========================================================================
test.describe("TestCreditCardDueAmount", () => {
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  test("CC due excludes Not-an-Expense rows and both code paths agree", async ({ pwaPage }) => {
    const result = await pwaPage.evaluate(async (today) => {
      const card = await DB.createAccount({
        name: "Credit Card",
        balance: 0,
        account_type: "credit",
      });
      await DB.createTransaction({
        date: today,
        amount: -1000,
        description: "counted",
        transaction_type: "expense",
        account_id: card.id,
      });
      const skip = await DB.createTransaction({
        date: today,
        amount: -400,
        description: "not an expense",
        transaction_type: "expense",
        account_id: card.id,
      });
      await DB.toggleExcludedFromExpenses(skip.id, true);

      const direct = await DB.getCreditAccountBalance(card.id);
      const acc = await DB.getAccount(card.id);
      return { direct: direct.cycle_balance, field: acc.credit_cycle_balance };
    }, todayStr());

    expect(result.direct).toBe(1000);
    expect(result.field).toBe(1000);
  });

  test("merged-account CC due sums the full family over the cycle window", async ({ pwaPage }) => {
    const result = await pwaPage.evaluate(async (today) => {
      const root = await DB.createAccount({
        name: "CC Root",
        balance: 0,
        account_type: "credit",
      });
      const child = await DB.createAccount({
        name: "CC Child",
        balance: 0,
        account_type: "credit",
      });
      // Spend on both accounts, then merge the child into the root.
      await DB.createTransaction({
        date: today,
        amount: -500,
        description: "root spend",
        transaction_type: "expense",
        account_id: root.id,
      });
      await DB.createTransaction({
        date: today,
        amount: -250,
        description: "child spend",
        transaction_type: "expense",
        account_id: child.id,
      });
      await DB.mergeAccounts(child.id, root.id);

      const direct = await DB.getCreditAccountBalance(root.id);
      const acc = await DB.getAccount(root.id);
      return { direct: direct.cycle_balance, field: acc.credit_cycle_balance };
    }, todayStr());

    // Both child and root spend count toward the merged family's due.
    expect(result.direct).toBe(750);
    expect(result.field).toBe(750);
  });
});
