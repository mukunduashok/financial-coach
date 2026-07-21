// tests/e2e/js/vault.spec.js
// E2E tests for the credential vault feature.
// The vault lives in Settings (#/settings) — tests cover setup, lock, unlock, and reset.
import { test, expect } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helper: set up vault and lock it via JS evaluation, then reload
// Used in tests that exercise the unlock / reset flows, bypassing the
// vault-setup button in settings (which is rendered only if the card exists).
// ---------------------------------------------------------------------------
async function setupAndLockVault(page, passphrase = "mysecurepass") {
	await page.evaluate(async (pp) => {
		await window.API.setupVault(pp);
		window.API.lockVault();
	}, passphrase);
	// Reload triggers main.js vault check → dispatches vault-locked → shows unlock screen
	await page.reload({ waitUntil: "domcontentloaded" });
}

async function installBiometricMocks(page) {
	const install = () => {
		const mockCredId = new Uint8Array([1, 2, 3, 4]);
		const mockPrf = new Uint8Array([7, 8, 9, 10]).buffer;

		Object.defineProperty(window, "PublicKeyCredential", {
			configurable: true,
			value: {
				isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
			},
		});

		if (!navigator.credentials) {
			Object.defineProperty(navigator, "credentials", { configurable: true, value: {} });
		}

		navigator.credentials.create = async () => ({
			rawId: mockCredId,
			getClientExtensionResults: () => ({
				prf: { results: { first: mockPrf } },
			}),
		});

		navigator.credentials.get = async () => ({
			getClientExtensionResults: () => ({
				prf: { results: { first: mockPrf } },
			}),
		});
	};

	await page.addInitScript(install);
	await page.evaluate(install);
}

// ---------------------------------------------------------------------------
// Group 1 – Vault settings card (these tests document the INTENDED UI)
// ---------------------------------------------------------------------------
test.describe("Vault settings card", () => {
	test("Settings shows vault setup card when vault not configured", async ({ pwaPage }) => {
		const page = pwaPage;
		await page.goto("/#/settings");
		await page.waitForSelector("#screen", { timeout: 10_000 });
		// Vault section should appear
		await expect(page.getByRole("heading", { name: /Credential Vault/i })).toBeVisible();
		await expect(page.locator('[data-action="vault-setup"]')).toBeVisible();
	});

	test("Vault setup flow - validation errors", async ({ pwaPage }) => {
		const page = pwaPage;
		await page.goto("/#/settings");
		await page.waitForSelector("#screen", { timeout: 10_000 });
		await page.click('[data-action="vault-setup"]');
		// Modal should appear
		await expect(page.locator("#vault-setup-passphrase")).toBeVisible({ timeout: 3_000 });
		// Short PIN — must be at least 4 characters
		await page.fill("#vault-setup-passphrase", "abc");
		await page.fill("#vault-setup-confirm", "abc");
		await page.click('[data-action="do-setup-vault"]');
		await expect(page.locator("#vault-setup-error")).toBeVisible({ timeout: 3_000 });
		// Mismatched passphrases
		await page.fill("#vault-setup-passphrase", "validpass123");
		await page.fill("#vault-setup-confirm", "differentpass");
		await page.click('[data-action="do-setup-vault"]');
		await expect(page.locator("#vault-setup-error")).toBeVisible();
	});

	test("Vault setup flow - success shows active status", async ({ pwaPage }) => {
		const page = pwaPage;
		await page.goto("/#/settings");
		await page.waitForSelector("#screen", { timeout: 10_000 });
		await page.click('[data-action="vault-setup"]');
		await expect(page.locator("#vault-setup-passphrase")).toBeVisible({ timeout: 3_000 });
		await page.fill("#vault-setup-passphrase", "mysecurepass");
		await page.fill("#vault-setup-confirm", "mysecurepass");
		await page.click('[data-action="do-setup-vault"]');
		// Vault.setup() writes the salt to localStorage before any UI update.
		// Wait for the salt key to confirm crypto completed (PBKDF2 takes a few seconds).
		await page.waitForFunction(() => !!localStorage.getItem("fincoach-vault-salt"), {
			timeout: 15_000,
		});
		// Navigate away and back to trigger the SPA router's hashchange event,
		// which calls renderSettings() and displays the vault active state.
		await page.goto("/#/");
		await page.goto("/#/settings");
		await expect(page.locator("text=PIN protection active")).toBeVisible({
			timeout: 5_000,
		});
		await expect(page.locator('[data-action="vault-lock"]')).toBeVisible();
	});

	test("Vault lock button in settings triggers unlock screen on reload", async ({ pwaPage }) => {
		const page = pwaPage;
		// Set up vault first
		await page.goto("/#/settings");
		await page.waitForSelector("#screen", { timeout: 10_000 });
		await page.click('[data-action="vault-setup"]');
		await page.fill("#vault-setup-passphrase", "mysecurepass");
		await page.fill("#vault-setup-confirm", "mysecurepass");
		await page.click('[data-action="do-setup-vault"]');
		// Wait for the vault salt to appear in localStorage (crypto complete).
		await page.waitForFunction(() => !!localStorage.getItem("fincoach-vault-salt"), {
			timeout: 15_000,
		});
		// Navigate away and back to re-render settings via hashchange.
		await page.goto("/#/");
		await page.goto("/#/settings");
		await page.waitForSelector('[data-action="vault-lock"]', { timeout: 5_000 });
		await page.click('[data-action="vault-lock"]');
		// Page should reload and show unlock screen
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
	});

	test("biometric enable flow shows active state after setup", async ({ pwaPage }) => {
		const page = pwaPage;
		await installBiometricMocks(page);
		await page.goto("/#/settings");
		await page.waitForSelector("#screen", { timeout: 10_000 });
		await page.click('[data-action="vault-setup"]');
		await page.fill("#vault-setup-passphrase", "mysecurepass");
		await page.fill("#vault-setup-confirm", "mysecurepass");
		await page.click('[data-action="do-setup-vault"]');
		await page.waitForFunction(() => !!localStorage.getItem("fincoach-vault-salt"), {
			timeout: 15_000,
		});
		await page.evaluate(async () => {
			await window.API.setupBiometric("mysecurepass");
		});
		await page.goto("/#/");
		await page.goto("/#/settings");
		await expect(page.locator("text=Biometric unlock active")).toBeVisible({ timeout: 8_000 });
	});
});

// ---------------------------------------------------------------------------
// Group 2 – Vault unlock screen (these tests use JS evaluation to set up the
// vault state directly, so they work independently of the settings card UI)
// ---------------------------------------------------------------------------
test.describe("Vault unlock screen", () => {
	test("Vault lock shows unlock screen on reload", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupAndLockVault(page, "mysecurepass");
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
	});

	test("Vault unlock - wrong passphrase shows error", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupAndLockVault(page, "mysecurepass");
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
		// Enter wrong passphrase
		await page.fill("#vault-unlock-passphrase", "wrongpassword");
		await page.click('[data-action="unlock-vault"]');
		await expect(page.locator("#vault-unlock-error")).toBeVisible({ timeout: 5_000 });
		// Unlock screen should still be visible
		await expect(page.locator("#vault-unlock-screen")).toBeVisible();
	});

	test("Vault unlock - correct passphrase dismisses screen", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupAndLockVault(page, "mysecurepass");
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
		// Enter correct passphrase
		await page.fill("#vault-unlock-passphrase", "mysecurepass");
		await page.click('[data-action="unlock-vault"]');
		await expect(page.locator("#vault-unlock-screen")).toBeHidden({ timeout: 8_000 });
		// App should load normally
		await expect(page.locator("#app")).toBeVisible({ timeout: 5_000 });
	});

	test("Vault forgot passphrase - shows reset modal", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupAndLockVault(page, "mysecurepass");
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
		// Click forgot passphrase
		await page.click('[data-action="vault-forgot-passphrase"]');
		await expect(page.locator("#vault-forgot-modal")).toBeVisible({ timeout: 5_000 });
	});

	test("Vault forgot passphrase - confirm reset clears vault and loads app", async ({
		pwaPage,
	}) => {
		const page = pwaPage;
		await setupAndLockVault(page, "mysecurepass");
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
		// Click forgot passphrase
		await page.click('[data-action="vault-forgot-passphrase"]');
		await expect(page.locator("#vault-forgot-modal")).toBeVisible({ timeout: 5_000 });
		// Confirm reset
		await page.click('[data-action="do-reset-vault"]');
		// Vault screen should be gone
		await expect(page.locator("#vault-unlock-screen")).toBeHidden({ timeout: 8_000 });
		// Navigate to settings - vault should be not configured (no active status)
		await page.goto("/#/settings");
		await page.waitForSelector("#screen", { timeout: 10_000 });
		await expect(page.locator("text=PIN protection active")).not.toBeVisible({
			timeout: 3_000,
		});
	});
});
