// tests/e2e/js/privacy.spec.js
/**
 * E2E tests for Privacy mode (hide/reveal monetary amounts).
 *
 * Privacy mode is enabled by default (localStorage key absent = enabled).
 * The `pwaPage` fixture provides a fresh browser context with
 * `fincoach-onboarded` set so the app boots to the dashboard directly.
 */
import { test, expect } from "./fixtures.js";

test.describe("PrivacyMode", () => {
	test("body has privacy-active class by default on fresh app load", async ({ pwaPage }) => {
		const hasClass = await pwaPage.evaluate(() => document.body.classList.contains("privacy-active"));
		expect(hasClass).toBe(true);
	});

	test("#privacy-toggle-btn is visible in the header", async ({ pwaPage }) => {
		const btn = pwaPage.locator("#privacy-toggle-btn");
		expect(await btn.count()).toBe(1);
		expect(await btn.isVisible()).toBe(true);
	});

	test(".balance-amount contains an .amount-private child span", async ({ pwaPage }) => {
		await pwaPage.evaluate(() => {
			window.location.hash = "#/";
		});
		await pwaPage.waitForSelector(".balance-amount");
		await pwaPage.waitForTimeout(300);
		const amountPrivate = pwaPage.locator(".balance-amount .amount-private");
		expect(await amountPrivate.count()).toBeGreaterThan(0);
	});

	test("clicking #privacy-toggle-btn removes privacy-active from body (reveal)", async ({
		pwaPage,
	}) => {
		// Ensure privacy is active before the click
		const before = await pwaPage.evaluate(() => document.body.classList.contains("privacy-active"));
		expect(before).toBe(true);

		await pwaPage.locator("#privacy-toggle-btn").click();
		await pwaPage.waitForTimeout(100);

		const after = await pwaPage.evaluate(() => document.body.classList.contains("privacy-active"));
		expect(after).toBe(false);
	});

	test("clicking #privacy-toggle-btn again re-adds privacy-active (hide)", async ({ pwaPage }) => {
		const btn = pwaPage.locator("#privacy-toggle-btn");
		// First click: reveal
		await btn.click();
		await pwaPage.waitForTimeout(100);
		// Second click: hide
		await btn.click();
		await pwaPage.waitForTimeout(100);

		const hasClass = await pwaPage.evaluate(() => document.body.classList.contains("privacy-active"));
		expect(hasClass).toBe(true);
	});

	test("settings toggle unchecked disables privacy mode → body loses privacy-active", async ({
		pwaPage,
	}) => {
		// Navigate to settings
		await pwaPage.evaluate(() => {
			window.location.hash = "#/settings";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(500);

		// Privacy checkbox should be checked by default (key absent = enabled)
		const checkbox = pwaPage.locator('[data-action="toggle-privacy-mode"]');
		expect(await checkbox.count()).toBeGreaterThan(0);
		expect(await checkbox.isChecked()).toBe(true);

		// Uncheck → disables privacy mode → applyPrivacyState() removes class
		await checkbox.uncheck();
		await pwaPage.waitForTimeout(200);

		// Navigate back to dashboard
		await pwaPage.evaluate(() => {
			window.location.hash = "#/";
		});
		await pwaPage.waitForSelector(".balance-amount");

		const hasClass = await pwaPage.evaluate(() => document.body.classList.contains("privacy-active"));
		expect(hasClass).toBe(false);

		// Re-enable privacy so other tests are not affected
		await pwaPage.evaluate(() => {
			window.location.hash = "#/settings";
		});
		await pwaPage.waitForSelector("#screen");
		await pwaPage.waitForTimeout(300);
		await checkbox.check();
		await pwaPage.waitForTimeout(200);

		const hasClassAfter = await pwaPage.evaluate(() =>
			document.body.classList.contains("privacy-active"),
		);
		expect(hasClassAfter).toBe(true);
	});
});
