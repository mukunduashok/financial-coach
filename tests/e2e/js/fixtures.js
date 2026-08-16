// tests/e2e/js/fixtures.js
import { test as base, expect } from "@playwright/test";

/**
 * pwaPage — sets fincoach-onboarded before first script executes, then loads
 * the app. Playwright isolates each test in a fresh browser context, so
 * IndexedDB and localStorage are always empty — no explicit clear or reload
 * needed.
 */
export const test = base.extend({
	pwaPage: async ({ page }, use) => {
		// Runs before any page script, so the app never sees a missing key
		await page.addInitScript(() => {
			localStorage.setItem("fincoach-onboarded", "true");
		});
		// Use domcontentloaded — the app is JS-rendered so we don't need to
		// wait for all assets. waitForSelector below confirms app readiness.
		await page.goto("/", { waitUntil: "domcontentloaded" });
		try {
			await page.waitForSelector(".bottom-nav", { timeout: 30_000 });
		} catch (error) {
			const sqlJsAssets = await Promise.all(
				["/js/sql-wasm.js", "/js/sql-wasm.wasm"].map(async (path) => {
					const response = await page.request.get(path);
					return `${path}: ${response.status()}`;
				}),
			);
			throw new Error(`App bootstrap failed; SQL.js asset responses: ${sqlJsAssets.join(", ")}`, {
				cause: error,
			});
		}

		await use(page);
	},
});

export { expect } from "@playwright/test";
