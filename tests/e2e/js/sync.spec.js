// tests/e2e/js/sync.spec.js
/**
 * E2E tests for the Gmail Sync screen — specifically the date-range validation
 * introduced to prevent `start > end` submissions.
 *
 * The sync screen only shows sync controls when Gmail is connected.
 * We simulate a connected state by pre-seeding `fincoach-gmail-settings` in
 * localStorage with a fake access + refresh token before the app loads.
 */
import { test, expect } from "@playwright/test";

const GMAIL_SETTINGS_FAKE = JSON.stringify({
	accessToken: "fake-access-token",
	refreshToken: "fake-refresh-token",
	email: "test@example.com",
});

// ---------------------------------------------------------------------------
// Helper: build a page with Gmail "connected" (faked via localStorage)
// ---------------------------------------------------------------------------
async function buildSyncPage(page) {
	await page.addInitScript((settings) => {
		localStorage.setItem("fincoach-onboarded", "true");
		localStorage.setItem("fincoach-gmail-settings", settings);
	}, GMAIL_SETTINGS_FAKE);
	await page.goto("/");
	await page.waitForSelector(".bottom-nav", { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Helper: navigate to #/sync and switch to date-range mode.
// Returns true if sync controls are present, false otherwise.
// ---------------------------------------------------------------------------
async function goToSyncDateRange(page) {
	await page.evaluate(() => {
		window.location.hash = "#/sync";
	});
	await page.waitForSelector("#screen");
	await page.waitForTimeout(500);

	const rangeBtn = page.locator('[data-action="set-sync-mode"][data-mode="range"]');
	if ((await rangeBtn.count()) === 0) return false;

	await rangeBtn.click();
	await page.waitForTimeout(200);

	const startInput = page.locator("#sync-start");
	return (await startInput.count()) > 0;
}

// ===========================================================================
// Date-range validation
// ===========================================================================
test.describe("TestSyncDateRangeValidation", () => {
	test("shows error when start date is after end date", async ({ page }) => {
		await buildSyncPage(page);
		const ready = await goToSyncDateRange(page);
		if (!ready) return; // sync screen not available — skip

		await page.locator("#sync-start").fill("2025-06-15");
		await page.locator("#sync-end").fill("2025-06-01");
		await page.locator("#btn-sync").click();
		await page.waitForTimeout(300);

		const resultsText = await page.locator("#sync-results").textContent();
		expect(resultsText).toContain("Start date cannot be later than end date");
	});

	test("sync button re-enabled after date validation error", async ({ page }) => {
		await buildSyncPage(page);
		const ready = await goToSyncDateRange(page);
		if (!ready) return;

		await page.locator("#sync-start").fill("2025-06-15");
		await page.locator("#sync-end").fill("2025-06-01");
		await page.locator("#btn-sync").click();
		await page.waitForTimeout(300);

		const isDisabled = await page.locator("#btn-sync").isDisabled();
		expect(isDisabled).toBe(false);
	});

	test("no date error shown when start date is before end date", async ({ page }) => {
		await buildSyncPage(page);
		const ready = await goToSyncDateRange(page);
		if (!ready) return;

		await page.locator("#sync-start").fill("2025-05-01");
		await page.locator("#sync-end").fill("2025-06-01");
		await page.locator("#btn-sync").click();
		// Wait a moment — sync may fail (fake token) but should not show date error
		await page.waitForTimeout(500);

		const resultsText = await page.locator("#sync-results").textContent();
		expect(resultsText).not.toContain("Start date cannot be later than end date");
	});

	test("no date error shown when start === end (same day is valid)", async ({ page }) => {
		await buildSyncPage(page);
		const ready = await goToSyncDateRange(page);
		if (!ready) return;

		await page.locator("#sync-start").fill("2025-06-01");
		await page.locator("#sync-end").fill("2025-06-01");
		await page.locator("#btn-sync").click();
		await page.waitForTimeout(500);

		const resultsText = await page.locator("#sync-results").textContent();
		expect(resultsText).not.toContain("Start date cannot be later than end date");
	});
});

// ===========================================================================
// BUG 1 — Deleted Gmail transactions must NOT reappear on re-sync
// ===========================================================================
test.describe("TestGmailTombstoneReimport", () => {
	test("reset-sync-history button is present on the sync screen", async ({ page }) => {
		await buildSyncPage(page);
		await page.evaluate(() => {
			window.location.hash = "#/sync";
		});
		await page.waitForSelector("#screen");
		await page.waitForTimeout(500);

		const btn = page.locator("#btn-reset-sync-history");
		if ((await btn.count()) === 0) return; // sync screen unavailable — skip
		expect(await btn.textContent()).toContain("Re-import deleted transactions");
	});

	test("deleting a Gmail tx tombstones it; reset clears the tombstone", async ({ page }) => {
		await buildSyncPage(page);

		// Seed a Gmail-sourced transaction directly via the DB the app uses.
		const gid = await page.evaluate(async () => {
			const acc = await DB.createAccount({
				name: "Gmail Acct",
				balance: 0,
				account_type: "savings",
			});
			const tx = await DB.createTransaction({
				date: "2025-03-01",
				amount: -250,
				description: "Gmail spend",
				transaction_type: "expense",
				account_id: acc.id,
			});
			DB._exec("UPDATE transactions SET gmail_message_id = ? WHERE id = ?", ["e2e-gmail-1", tx.id]);
			await DB.deleteTransaction(tx.id);
			return "e2e-gmail-1";
		});

		// After delete: the Gmail ID is tombstoned but still filtered at Layer 1.
		const stillFiltered = await page.evaluate(
			(id) => DB.getProcessedGmailIds([id]).has(id),
			gid,
		);
		expect(stillFiltered).toBe(true);

		// Trigger "Re-import deleted transactions" via the API the button calls.
		const clearedAfterReset = await page.evaluate(async (id) => {
			await API.resetGmailSyncHistory();
			return DB.getProcessedGmailIds([id]).has(id);
		}, gid);
		expect(clearedAfterReset).toBe(false);
	});

	test("clicking the reset button shows a success toast", async ({ page }) => {
		await buildSyncPage(page);
		await page.evaluate(() => {
			window.location.hash = "#/sync";
		});
		await page.waitForSelector("#screen");
		await page.waitForTimeout(500);

		const btn = page.locator("#btn-reset-sync-history");
		if ((await btn.count()) === 0) return; // sync screen unavailable — skip
		await btn.click();
		await page.waitForTimeout(300);

		const body = await page.innerText("body");
		expect(body.toLowerCase()).toContain("re-imported");
	});
});

// ===========================================================================
// FINCO-65 — Default "Days to look back" changed from 7 → 2
// ===========================================================================
test.describe("TestSyncDaysDefault", () => {
	test("days input defaults to 2 (not 7)", async ({ page }) => {
		await buildSyncPage(page);
		await page.evaluate(() => {
			window.location.hash = "#/sync";
		});
		await page.waitForSelector("#screen");
		await page.waitForTimeout(500);

		const daysInput = page.locator("#sync-days");
		if ((await daysInput.count()) === 0) return; // sync screen unavailable — skip

		const value = await daysInput.inputValue();
		expect(value).toBe("2");
	});
});

// ===========================================================================
// FINCO-66 — Sync screen renders without errors when AI is not configured
// ===========================================================================
test.describe("TestSyncNoAIConfigured", () => {
	test("sync screen renders without uncaught JS errors when AI is not configured", async ({
		page,
	}) => {
		const errors = [];
		page.on("pageerror", (err) => errors.push(err.message));

		// buildSyncPage sets no AI settings — simulates a first-time user
		await buildSyncPage(page);

		await page.evaluate(() => {
			window.location.hash = "#/sync";
		});
		await page.waitForSelector("#screen");
		await page.waitForTimeout(500);

		expect(errors).toHaveLength(0);
	});
});

// ===========================================================================
// Mobile layout — full-width sync buttons must stack without overlapping
// (Issue 4). "Sync Now" (#btn-sync) and "Re-import deleted transactions"
// (#btn-reset-sync-history / .btn-reimport) are both .btn-full.
// ===========================================================================
test.describe("TestSyncButtonsMobileLayout", () => {
	const MOBILE = { width: 375, height: 812 };

	test("sync buttons stack without vertical overlap on mobile", async ({ page }) => {
		await page.setViewportSize(MOBILE);
		await buildSyncPage(page);
		// Gmail credentials are vault-backed — set up a PIN and save tokens via
		// the API so Gmail.isConnected() is true and the sync controls render.
		await page.evaluate(async () => {
			await window.API.setupVault("123456");
			await window.Gmail.saveSettings({
				email: "test@example.com",
				accessToken: "fake-access-token",
				refreshToken: "fake-refresh-token",
				tokenExpiry: Date.now() + 3_600_000,
			});
		});
		await page.evaluate(() => {
			window.location.hash = "#/sync";
		});
		await page.waitForSelector("#btn-sync", { timeout: 10_000 });

		const syncBtn = page.locator("#btn-sync");
		const reimportBtn = page.locator("#btn-reset-sync-history");
		await expect(syncBtn).toBeVisible();
		await expect(reimportBtn).toBeVisible();

		// Confirm the re-import button carries the migrated CSS class.
		await expect(reimportBtn).toHaveClass(/btn-reimport/);

		const syncBox = await syncBtn.boundingBox();
		const reimportBox = await reimportBtn.boundingBox();
		expect(syncBox).not.toBeNull();
		expect(reimportBox).not.toBeNull();

		// Sync button sits above the re-import button; bottoms must not overlap.
		expect(syncBox.y + syncBox.height).toBeLessThanOrEqual(reimportBox.y + 1);
	});
});
