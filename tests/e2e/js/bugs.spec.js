/**
 * E2E regression tests for bugs tracked in GitHub Issues.
 *
 * These tests currently FAIL because the production bugs have not been fixed.
 * They serve as acceptance criteria for each fix.
 *
 * Bugs covered (fewest tests per the Test Pyramid — edge-case UI behaviour
 * that can only be verified in a real browser):
 *
 *   BUG-SEV1-01 — Edit transaction modal uses wrong input type (datetime-local)
 *                 and loses the existing date when saving
 *   BUG-SEV3-01 — Error toasts are not cleared when navigating between routes
 *   BUG-SEV3-02 — Edit transaction modal is missing the Merchant field
 *   BUG-SEV3-04 — Account delete confirmation text is misleading
 *   BUG-SEV4-01 — Unknown route leaves bad hash in the URL bar
 *   BUG-SEV4-02 — Ollama provider shows no base-URL input field
 */
import { test, expect } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function seedAccountAndTransaction(page) {
	// Use today's date so the transaction is within the default filter range
	// (txFilterState defaults to firstOfMonth → today).
	const todayISO = new Date().toISOString().split("T")[0];
	return page.evaluate(async (date) => {
		const acc = await DB.createAccount({
			name: "Test Seed Account",
			balance: 5000,
			account_type: "savings",
		});
		const tx = await DB.createTransaction({
			date,
			amount: -200,
			description: "Seed Coffee",
			transaction_type: "expense",
			account_id: acc.id,
			merchant_name: "Blue Tokai",
		});
		return { accId: acc.id, txId: tx.id, date };
	}, todayISO);
}

async function goTo(page, hash) {
	await page.evaluate((h) => {
		window.location.hash = h;
	}, hash);
	await page.waitForSelector("#screen");
}

// ===========================================================================
// BUG-SEV1-01: Edit Transaction — date input type and pre-fill
// ===========================================================================
test.describe("BUG-SEV1-01: Edit transaction modal uses type=date and pre-fills the date", () => {
	test("edit modal date input has type=date (not datetime-local)", async ({ pwaPage }) => {
		await seedAccountAndTransaction(pwaPage);
		await goTo(pwaPage, "#/transactions");

		// Open the first transaction's edit modal
		const txItem = pwaPage.locator(".tx-item").first();
		await txItem.click();
		await pwaPage.waitForSelector(".modal-overlay .modal");

		const dateInput = pwaPage.locator("#edit-date");
		expect(await dateInput.count()).toBe(1);

		// BUG: currently uses type="datetime-local"
		// After fix: should use type="date"
		const inputType = await dateInput.getAttribute("type");
		expect(inputType).toBe("date");
	});

	test("edit modal date input is pre-filled with the transaction date", async ({ pwaPage }) => {
		const { date } = await seedAccountAndTransaction(pwaPage);
		await goTo(pwaPage, "#/transactions");

		const txItem = pwaPage.locator(".tx-item").first();
		await txItem.click();
		await pwaPage.waitForSelector(".modal-overlay .modal");

		const dateInput = pwaPage.locator("#edit-date");

		// BUG: datetime-local input gets today's date string which is invalid for that
		// type — browser rejects it and renders the field empty.
		// After fix (type=date): field should be pre-filled with the transaction date.
		const value = await dateInput.inputValue();
		expect(value).toBe(date);
	});

	test("saving the edit modal without touching date preserves original date", async ({
		pwaPage,
	}) => {
		const { txId, date } = await seedAccountAndTransaction(pwaPage);
		await goTo(pwaPage, "#/transactions");

		const txItem = pwaPage.locator(".tx-item").first();
		await txItem.click();
		await pwaPage.waitForSelector(".modal-overlay .modal");

		// Click Save without changing anything
		await pwaPage.locator('[data-action="save-transaction"]').click();
		await pwaPage.waitForTimeout(400);

		// Re-fetch the transaction from the DB (look up by integer primary key)
		const updatedDate = await pwaPage.evaluate(async (id) => {
			const txs = await DB.getTransactions({ id });
			return txs[0]?.date ?? null;
		}, txId);

		// BUG: date becomes "" (transaction disappears from all filtered views)
		// After fix: date is preserved as the original transaction date
		expect(updatedDate).toBe(date);
	});
});

// ===========================================================================
// BUG-SEV3-01: Error toasts cleared on navigation
// ===========================================================================
test.describe("BUG-SEV3-01: Error toasts are cleared when navigating to a new route", () => {
	test("toast from one screen does not appear on a different screen", async ({ pwaPage }) => {
		// Trigger a validation error toast on the Accounts screen (merge with mismatched types)
		const { savingsId, creditId } = await pwaPage.evaluate(async () => {
			const s = await DB.createAccount({ name: "Savings1", balance: 0, account_type: "savings" });
			const c = await DB.createAccount({ name: "Credit1", balance: 0, account_type: "credit" });
			return { savingsId: s.id, creditId: c.id };
		});
		await goTo(pwaPage, "#/accounts");

		// Open merge modal and attempt a type-mismatch merge to produce an error toast
		await pwaPage.locator("button:has-text('Merge Accounts')").click();
		await pwaPage.waitForSelector(".modal-overlay");
		await pwaPage.locator("#merge-source").selectOption(String(savingsId));
		await pwaPage.locator("#merge-target").selectOption(String(creditId));
		await pwaPage.locator(".modal-overlay button:has-text('Merge')").last().click();
		await pwaPage.waitForTimeout(300);

		// Confirm an error toast is visible on Accounts
		const toastsBefore = await pwaPage.locator(".toast, .toast-container .toast").count();
		expect(toastsBefore).toBeGreaterThan(0);

		// Navigate away to Goals
		await goTo(pwaPage, "#/goals");

		// BUG: toast is still visible after navigation
		// After fix: no toasts should remain on the Goals screen
		const toastsAfter = await pwaPage.locator(".toast, .toast-container .toast").count();
		expect(toastsAfter).toBe(0);
	});
});

// ===========================================================================
// BUG-SEV3-02: Edit transaction modal has a Merchant field
// ===========================================================================
test.describe("BUG-SEV3-02: Edit transaction modal includes a Merchant field", () => {
	test("edit modal contains a merchant name input", async ({ pwaPage }) => {
		await seedAccountAndTransaction(pwaPage);
		await goTo(pwaPage, "#/transactions");

		const txItem = pwaPage.locator(".tx-item").first();
		await txItem.click();
		await pwaPage.waitForSelector(".modal-overlay .modal");

		// BUG: edit modal has no merchant field
		// After fix: should have an input with id="edit-merchant-name"
		const merchantField = pwaPage.locator("#edit-merchant-name");
		expect(await merchantField.count()).toBeGreaterThan(0);
	});

	test("edit modal pre-fills merchant name from existing transaction", async ({ pwaPage }) => {
		await seedAccountAndTransaction(pwaPage);
		await goTo(pwaPage, "#/transactions");

		const txItem = pwaPage.locator(".tx-item").first();
		await txItem.click();
		await pwaPage.waitForSelector(".modal-overlay .modal");

		// After fix: field should be pre-filled with "Blue Tokai"
		const merchantField = pwaPage.locator("#edit-merchant-name");
		if ((await merchantField.count()) > 0) {
			const value = await merchantField.inputValue();
			expect(value).toBe("Blue Tokai");
		} else {
			// Field doesn't exist yet — test marks the intent
			expect(await merchantField.count()).toBeGreaterThan(0);
		}
	});
});

// ===========================================================================
// BUG-SEV3-04: Account deletion confirmation text is accurate
// ===========================================================================
test.describe(
	"BUG-SEV3-04: Account deletion confirmation accurately describes what will happen",
	() => {
		test("confirmation dialog does not say 'cannot be deleted' when transactions exist", async ({
			pwaPage,
		}) => {
			await pwaPage.evaluate(async () => {
				const acc = await DB.createAccount({
					name: "HasTx",
					balance: 0,
					account_type: "savings",
				});
				await DB.createTransaction({
					date: "2026-05-01",
					amount: -100,
					description: "TX",
					transaction_type: "expense",
					account_id: acc.id,
				});
			});
			await goTo(pwaPage, "#/accounts");

			// Click delete for the account that has transactions
			await pwaPage.locator("button.delete-btn, button[title*='delete' i], button:has-text('🗑')").first().click();
			await pwaPage.waitForTimeout(300);

			const confirmDialog = pwaPage.locator(
				".confirm-dialog, .modal-overlay, [role='dialog']",
			);
			if ((await confirmDialog.count()) > 0) {
				const dialogText = await confirmDialog.first().innerText();
				// BUG: currently says "Accounts with transactions cannot be deleted"
				// After fix: should describe what WILL happen, not falsely claim it's blocked
				expect(dialogText.toLowerCase()).not.toContain("cannot be deleted");
			}
		});
	},
);

// ===========================================================================
// BUG-SEV4-01: Unknown route corrects the URL to #/
// ===========================================================================
test.describe("BUG-SEV4-01: Navigating to an unknown route corrects the URL hash", () => {
	test("URL hash is corrected to #/ after navigating to an unknown route", async ({ pwaPage }) => {
		await pwaPage.evaluate(() => {
			window.location.hash = "#/totally-unknown-route-xyz";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(300);

		const url = pwaPage.url();
		// BUG: URL stays as #/totally-unknown-route-xyz
		// After fix: Router should redirect and URL should be #/
		expect(url).toMatch(/#\/$/);
		expect(url).not.toContain("totally-unknown-route");
	});

	test("Router.currentScreen is set to #/ after navigating to an unknown route", async ({
		pwaPage,
	}) => {
		await pwaPage.evaluate(() => {
			window.location.hash = "#/nonexistent";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(300);

		const currentScreen = await pwaPage.evaluate(() => window.Router?.currentScreen ?? null);
		// BUG: currentScreen is "#/nonexistent" instead of "#/"
		// After fix: should be "#/"
		expect(currentScreen).toBe("#/");
	});
});

// ===========================================================================
// BUG-SEV4-02: Ollama provider shows a configurable base-URL input
// ===========================================================================
test.describe("BUG-SEV4-02: Ollama provider shows a base-URL input field", () => {
	test("selecting Ollama reveals a base URL input field", async ({ pwaPage }) => {
		await goTo(pwaPage, "#/settings");

		await pwaPage.locator("#ai-provider").selectOption("ollama");
		await pwaPage.waitForTimeout(300);

		// BUG: no URL field shown for Ollama; endpoint is hardcoded
		// After fix: a text input for the Ollama base URL should appear
		const urlInput = pwaPage.locator(
			"#ollama-base-url, input[placeholder*='localhost' i], input[placeholder*='11434' i]",
		);
		expect(await urlInput.count()).toBeGreaterThan(0);
	});

	test("Ollama base URL input is pre-filled with the default endpoint", async ({ pwaPage }) => {
		await goTo(pwaPage, "#/settings");

		await pwaPage.locator("#ai-provider").selectOption("ollama");
		await pwaPage.waitForTimeout(300);

		const urlInput = pwaPage.locator("#ollama-base-url");
		if ((await urlInput.count()) > 0) {
			const value = await urlInput.inputValue();
			// After fix: should default to the standard Ollama endpoint
			expect(value).toContain("localhost:11434");
		} else {
			// Field doesn't exist yet — fail with clear intent
			expect(await urlInput.count()).toBeGreaterThan(0);
		}
	});
});
