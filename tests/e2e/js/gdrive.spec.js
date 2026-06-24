// tests/e2e/js/gdrive.spec.js
// E2E tests for the Google Drive Sync UI in the Settings screen.
//
// These tests cover the GDrive section rendering under different Gmail/Drive
// connection states and validate the user flows: Connect, Enable, Sync, Disconnect.
//
// NOTE: Actual OAuth and Drive API calls are not exercised — they require live
// credentials. These tests verify the UI state machine and displayed controls.

import { test, expect } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function goSettings(page) {
	await page.evaluate(() => {
		window.location.hash = "#/settings";
	});
	await page.waitForSelector("#screen");
	await page.waitForTimeout(300);
}

/** Sets Gmail settings in localStorage to simulate a connected account.
 *  Uses the exact field names Gmail.isConnected() checks (accessToken + refreshToken).
 */
async function simulateGmailConnected(page, email = "test@gmail.com") {
	await page.evaluate((e) => {
		localStorage.setItem(
			"fincoach-gmail-settings",
			JSON.stringify({
				email: e,
				accessToken: "mock-access-token",
				refreshToken: "mock-refresh-token",
				tokenExpiry: Date.now() + 3_600_000,
			}),
		);
	}, email);
}

/** Enables GDrive sync in localStorage and navigates away+back so settings re-renders. */
async function setDriveEnabled(page, enabled = true) {
	await page.evaluate((val) => {
		if (val) {
			localStorage.setItem("fincoach-gdrive-enabled", "true");
		} else {
			localStorage.removeItem("fincoach-gdrive-enabled");
		}
		window.location.hash = "#/";
	}, enabled);
}

// ---------------------------------------------------------------------------
// 1. GDrive section always renders in Settings
// ---------------------------------------------------------------------------
test.describe("GDrive Settings Section — Render", () => {
	test("settings page contains a Google Drive Sync section heading", async ({ pwaPage }) => {
		await goSettings(pwaPage);
		const text = await pwaPage.innerText("body");
		expect(text).toContain("Google Drive Sync");
	});

	test("GDrive section has descriptive text about backup/encryption", async ({ pwaPage }) => {
		await goSettings(pwaPage);
		const text = await pwaPage.innerText("body");
		// Must mention encryption or Google account in the section
		expect(
			text.toLowerCase().includes("encrypt") || text.toLowerCase().includes("google account"),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 2. Gmail not connected → "Connect Google Account" state
// ---------------------------------------------------------------------------
test.describe("GDrive Settings — Gmail not connected", () => {
	test.beforeEach(async ({ pwaPage }) => {
		// Ensure Gmail is NOT connected (fresh pwaPage has empty localStorage)
		await pwaPage.evaluate(() => {
			localStorage.removeItem("fincoach-gmail-settings");
			localStorage.removeItem("fincoach-gdrive-enabled");
		});
		await goSettings(pwaPage);
	});

	test("shows Connect Google Account button when Gmail not connected", async ({ pwaPage }) => {
		const btn = pwaPage.locator("button[data-action='gdrive-connect']");
		expect(await btn.count()).toBeGreaterThan(0);
		expect(await btn.first().innerText()).toMatch(/connect/i);
	});

	test("does NOT show Sync with Drive button when not connected", async ({ pwaPage }) => {
		const syncBtn = pwaPage.locator("button[data-action='gdrive-sync']");
		expect(await syncBtn.count()).toBe(0);
	});

	test("does NOT show Disable Drive Sync button when not connected", async ({ pwaPage }) => {
		const disableBtn = pwaPage.locator("button[data-action='gdrive-disconnect']");
		expect(await disableBtn.count()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 3. Gmail connected but Drive disabled → "Enable Drive Sync" state
// ---------------------------------------------------------------------------
test.describe("GDrive Settings — Gmail connected, Drive disabled", () => {
	test.beforeEach(async ({ pwaPage }) => {
		await simulateGmailConnected(pwaPage);
		await setDriveEnabled(pwaPage, false);
		await goSettings(pwaPage);
	});

	test("shows gdrive-disconnected status indicator", async ({ pwaPage }) => {
		const statusEl = pwaPage.locator(".gdrive-disconnected");
		expect(await statusEl.count()).toBeGreaterThan(0);
	});

	test("shows Enable Drive Sync button", async ({ pwaPage }) => {
		const btn = pwaPage.locator("button[data-action='gdrive-enable']");
		expect(await btn.count()).toBe(1);
		expect(await btn.innerText()).toMatch(/enable/i);
	});

	test("shows Reconnect Google Account button", async ({ pwaPage }) => {
		const btn = pwaPage.locator("button[data-action='gdrive-connect']");
		expect(await btn.count()).toBeGreaterThan(0);
	});

	test("shows the connected email address in the disabled state", async ({ pwaPage }) => {
		const section = pwaPage.locator(".gdrive-section");
		const text = await section.innerText();
		expect(text).toContain("test@gmail.com");
	});

	test("does not show sync button when Drive is disabled", async ({ pwaPage }) => {
		const syncBtn = pwaPage.locator("button[data-action='gdrive-sync']");
		expect(await syncBtn.count()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 4. Gmail connected and Drive enabled → "Active" state
// ---------------------------------------------------------------------------
test.describe("GDrive Settings — Drive sync active", () => {
	test.beforeEach(async ({ pwaPage }) => {
		// Mock Drive API so renderSettings() resolves getLastModified() instantly
		// (avoids real network call to googleapis.com that outlasts the 300ms wait)
		await pwaPage.route(/googleapis\.com\/drive\/v3\/files/, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ files: [] }),
			});
		});
		await simulateGmailConnected(pwaPage);
		await setDriveEnabled(pwaPage, true);
		await goSettings(pwaPage);
		// Wait for async renderSettings() to finish (getLastModified resolves via mock)
		await pwaPage.waitForSelector("button[data-action='gdrive-sync']", { timeout: 5000 });
	});

	test("shows gdrive-connected status indicator", async ({ pwaPage }) => {
		const statusEl = pwaPage.locator(".gdrive-connected");
		expect(await statusEl.count()).toBeGreaterThan(0);
	});

	test("shows Sync with Drive button when enabled", async ({ pwaPage }) => {
		const syncBtn = pwaPage.locator("button[data-action='gdrive-sync']");
		expect(await syncBtn.count()).toBe(1);
		expect(await syncBtn.innerText()).toMatch(/sync/i);
	});

	test("shows Disable Drive Sync button when enabled", async ({ pwaPage }) => {
		const btn = pwaPage.locator("button[data-action='gdrive-disconnect']");
		expect(await btn.count()).toBe(1);
		expect(await btn.innerText()).toMatch(/disable/i);
	});

	test("shows auto-sync checkbox checked when enabled", async ({ pwaPage }) => {
		const checkbox = pwaPage.locator("input[data-action='gdrive-toggle-auto']");
		expect(await checkbox.count()).toBe(1);
		expect(await checkbox.isChecked()).toBe(true);
	});

	test("shows last synced 'Never' when no prior sync timestamp exists", async ({ pwaPage }) => {
		const section = pwaPage.locator(".gdrive-section");
		const text = await section.innerText();
		expect(text).toContain("Never");
	});

	test("shows last synced date when a prior sync timestamp is stored", async ({ pwaPage }) => {
		// Set a prior sync time and force re-render
		await pwaPage.evaluate(() => {
			localStorage.setItem("fincoach-gdrive-last-sync", "2025-01-15T10:30:00.000Z");
			window.location.hash = "#/";
		});
		await goSettings(pwaPage);
		// Wait for async renderSettings() to complete and display the date (not "Never")
		await pwaPage.waitForFunction(
			() => {
				const sec = document.querySelector(".gdrive-section");
				return sec != null && !sec.innerText.includes("Never");
			},
			{ timeout: 5000 },
		);

		const section = pwaPage.locator(".gdrive-section");
		const text = await section.innerText();
		// Should show a human-readable date, not "Never"
		expect(text).not.toContain("Never");
		// Should contain some recognizable date component (year or month)
		expect(text).toMatch(/2025|Jan/i);
	});

	test("shows connected email address in active state", async ({ pwaPage }) => {
		const section = pwaPage.locator(".gdrive-section");
		const text = await section.innerText();
		expect(text).toContain("test@gmail.com");
	});

	test("shows merge-safety help text", async ({ pwaPage }) => {
		const section = pwaPage.locator(".gdrive-section");
		const text = await section.innerText();
		expect(
			text.toLowerCase().includes("merge") || text.toLowerCase().includes("nothing is deleted"),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 5. Disable Drive Sync flow
// ---------------------------------------------------------------------------
test.describe("GDrive Disable Sync flow", () => {
	test("clicking Disable Drive Sync disables Drive and updates UI", async ({ pwaPage }) => {
		await simulateGmailConnected(pwaPage);
		await setDriveEnabled(pwaPage, true);
		await goSettings(pwaPage);

		// Verify sync is active
		await pwaPage.waitForSelector("button[data-action='gdrive-sync']");
		expect(await pwaPage.locator("button[data-action='gdrive-sync']").count()).toBe(1);

		// Click Disable
		await pwaPage.locator("button[data-action='gdrive-disconnect']").click();
		await pwaPage.waitForSelector("button[data-action='gdrive-enable']");

		// Verify localStorage updated
		const enabled = await pwaPage.evaluate(() =>
			localStorage.getItem("fincoach-gdrive-enabled"),
		);
		expect(enabled).toBeNull();

		// Sync button gone, Enable button shown
		expect(await pwaPage.locator("button[data-action='gdrive-sync']").count()).toBe(0);
		expect(await pwaPage.locator("button[data-action='gdrive-enable']").count()).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// 6. Enable Drive Sync flow
// ---------------------------------------------------------------------------
test.describe("GDrive Enable Sync flow", () => {
	test("clicking Enable Drive Sync enables Drive and shows sync button", async ({ pwaPage }) => {
		await simulateGmailConnected(pwaPage);
		await setDriveEnabled(pwaPage, false);
		await goSettings(pwaPage);

		// Verify Drive is disabled
		await pwaPage.waitForSelector("button[data-action='gdrive-enable']");
		expect(await pwaPage.locator("button[data-action='gdrive-enable']").count()).toBe(1);

		// Click Enable
		await pwaPage.locator("button[data-action='gdrive-enable']").click();
		await pwaPage.waitForSelector("button[data-action='gdrive-sync']");

		// Verify localStorage updated
		const enabled = await pwaPage.evaluate(() =>
			localStorage.getItem("fincoach-gdrive-enabled"),
		);
		expect(enabled).toBe("true");

		// Sync button should appear
		expect(await pwaPage.locator("button[data-action='gdrive-sync']").count()).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// 7. Delete Backup button state (BUG-GDRIVE-02)
// ---------------------------------------------------------------------------
test.describe("GDrive Settings — Delete Backup button state", () => {
	test("delete backup button is disabled with 'No backup on Drive yet' note when no backup exists", async ({
		pwaPage,
	}) => {
		// Mock Drive API to return an empty file list (simulates no backup on Drive)
		await pwaPage.route(/googleapis\.com\/drive\/v3\/files/, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ files: [] }),
			});
		});

		await simulateGmailConnected(pwaPage);
		await setDriveEnabled(pwaPage, true);
		await goSettings(pwaPage);

		// Wait for async renderSettings() to finish (getLastModified resolves after mock)
		await pwaPage.waitForSelector('button[data-action="gdrive-delete-backup"]', {
			timeout: 5000,
		});

		const btn = pwaPage.locator('button[data-action="gdrive-delete-backup"]');
		expect(await btn.getAttribute("disabled")).not.toBeNull();
		expect(await btn.getAttribute("aria-disabled")).toBe("true");

		const text = await pwaPage.innerText("body");
		expect(text).toContain("No backup on Drive yet");
	});

	test("delete backup button is enabled when a backup file exists on Drive", async ({
		pwaPage,
	}) => {
		// Mock Drive files list → returns one backup file
		// Mock Drive file metadata → returns modifiedTime
		await pwaPage.route(/googleapis\.com\/drive\/v3\/files/, async (route) => {
			const url = route.request().url();
			if (url.includes("/mock-id")) {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ modifiedTime: "2025-01-15T10:30:00.000Z" }),
				});
			} else {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						files: [
							{
								id: "mock-id",
								name: "fincoach-backup.enc",
								modifiedTime: "2025-01-15T10:30:00.000Z",
							},
						],
					}),
				});
			}
		});

		await simulateGmailConnected(pwaPage);
		await setDriveEnabled(pwaPage, true);
		await goSettings(pwaPage);

		await pwaPage.waitForSelector('button[data-action="gdrive-delete-backup"]', {
			timeout: 5000,
		});

		const btn = pwaPage.locator('button[data-action="gdrive-delete-backup"]');
		expect(await btn.getAttribute("disabled")).toBeNull();
		expect(await btn.getAttribute("aria-disabled")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 8. API key backup opt-in (FEAT-GDRIVE-01)
// ---------------------------------------------------------------------------
test.describe("GDrive Settings — API key backup opt-in", () => {
	async function setProviderSettings(page, provider) {
		const modelMap = {
			groq: "llama-3.3-70b-versatile",
			ollama: "llama3.1:8b",
		};
		await page.evaluate(
			([p, m]) => {
				localStorage.setItem("fincoach-ai-settings", JSON.stringify({ provider: p, model: m, apiKey: "" }));
			},
			[provider, modelMap[provider] ?? ""],
		);
	}

	test("API key backup checkbox appears in AI settings when provider requires a key (groq)", async ({
		pwaPage,
	}) => {
		await setProviderSettings(pwaPage, "groq");
		await goSettings(pwaPage);
		const checkbox = pwaPage.locator('input[data-action="gdrive-toggle-backup-api-key"]');
		expect(await checkbox.count()).toBeGreaterThan(0);
		expect(await checkbox.isVisible()).toBe(true);
	});

	test("API key backup checkbox is unchecked by default when flag is not set", async ({
		pwaPage,
	}) => {
		await setProviderSettings(pwaPage, "groq");
		await pwaPage.evaluate(() => localStorage.removeItem("fincoach-gdrive-backup-api-key"));
		await goSettings(pwaPage);
		const checkbox = pwaPage.locator('input[data-action="gdrive-toggle-backup-api-key"]');
		expect(await checkbox.count()).toBeGreaterThan(0);
		expect(await checkbox.isChecked()).toBe(false);
	});

	test("checking the API key backup checkbox sets localStorage flag to 'true'", async ({
		pwaPage,
	}) => {
		await setProviderSettings(pwaPage, "groq");
		await goSettings(pwaPage);
		const checkbox = pwaPage.locator('input[data-action="gdrive-toggle-backup-api-key"]');
		await checkbox.check();
		const val = await pwaPage.evaluate(() =>
			localStorage.getItem("fincoach-gdrive-backup-api-key"),
		);
		expect(val).toBe("true");
	});

	test("unchecking the API key backup checkbox removes the localStorage flag", async ({
		pwaPage,
	}) => {
		await pwaPage.evaluate(() => {
			localStorage.setItem("fincoach-gdrive-backup-api-key", "true");
			localStorage.setItem(
				"fincoach-ai-settings",
				JSON.stringify({ provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" }),
			);
		});
		await goSettings(pwaPage);
		const checkbox = pwaPage.locator('input[data-action="gdrive-toggle-backup-api-key"]');
		expect(await checkbox.isChecked()).toBe(true);
		await checkbox.uncheck();
		const val = await pwaPage.evaluate(() =>
			localStorage.getItem("fincoach-gdrive-backup-api-key"),
		);
		expect(val).toBeNull();
	});

	test("API key backup checkbox is not visible for Ollama (provider without API key requirement)", async ({
		pwaPage,
	}) => {
		await setProviderSettings(pwaPage, "ollama");
		await goSettings(pwaPage);
		const checkbox = pwaPage.locator('input[data-action="gdrive-toggle-backup-api-key"]');
		// Field is rendered with display:none for providers that don't require a key
		expect(await checkbox.isVisible()).toBe(false);
	});
});

