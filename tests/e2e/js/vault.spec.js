// tests/e2e/js/vault.spec.js
// E2E tests for the credential vault feature.
// The vault lives in Settings (#/settings) — tests cover setup, lock, unlock, and reset.
import { test, expect } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helper: set up vault and lock it via JS evaluation, then reload
// Used in tests that exercise the unlock / reset flows, bypassing the
// vault-setup button in settings (which is rendered only if the card exists).
// ---------------------------------------------------------------------------
async function setupAndLockVault(page, passphrase = "1234") {
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
				getClientCapabilities: async () => ({ extensions: ["prf"] }),
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

async function installNoPrfBiometricSupport(page) {
	const install = () => {
		Object.defineProperty(window, "PublicKeyCredential", {
			configurable: true,
			value: {
				isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
				getClientCapabilities: async () => ({ extensions: [] }),
			},
		});

		if (!navigator.credentials) {
			Object.defineProperty(navigator, "credentials", { configurable: true, value: {} });
		}
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
		await expect(page.locator("#vault-setup-passphrase")).toHaveAttribute("inputmode", "numeric");
		await expect(page.locator("#vault-setup-confirm")).toHaveAttribute("inputmode", "numeric");
		// Short PIN — must be at least 4 characters
		await page.fill("#vault-setup-passphrase", "abc");
		await page.fill("#vault-setup-confirm", "abc");
		await page.click('[data-action="do-setup-vault"]');
		await expect(page.locator("#vault-setup-error")).toBeVisible({ timeout: 3_000 });
		// Mismatched passphrases
		await page.fill("#vault-setup-passphrase", "5678");
		await page.fill("#vault-setup-confirm", "4321");
		await page.click('[data-action="do-setup-vault"]');
		await expect(page.locator("#vault-setup-error")).toBeVisible();
	});

	test("Vault setup flow - success shows active status", async ({ pwaPage }) => {
		const page = pwaPage;
		await page.goto("/#/settings");
		await page.waitForSelector("#screen", { timeout: 10_000 });
		await page.click('[data-action="vault-setup"]');
		await expect(page.locator("#vault-setup-passphrase")).toBeVisible({ timeout: 3_000 });
		await page.fill("#vault-setup-passphrase", "1234");
		await page.fill("#vault-setup-confirm", "1234");
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
		await page.fill("#vault-setup-passphrase", "1234");
		await page.fill("#vault-setup-confirm", "1234");
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
		await page.fill("#vault-setup-passphrase", "1234");
		await page.fill("#vault-setup-confirm", "1234");
		await page.click('[data-action="do-setup-vault"]');
		await page.waitForFunction(() => !!localStorage.getItem("fincoach-vault-salt"), {
			timeout: 15_000,
		});
		await page.evaluate(async () => {
			await window.API.setupBiometric("1234");
		});
		await page.goto("/#/");
		await page.goto("/#/settings");
		await expect(page.locator("text=Biometric unlock active")).toBeVisible({ timeout: 8_000 });
	});

	test("settings hides biometric enable action when PRF support is unavailable", async ({ pwaPage }) => {
		const page = pwaPage;
		await installNoPrfBiometricSupport(page);
		await page.goto("/#/settings");
		await page.waitForSelector("#screen", { timeout: 10_000 });
		await page.click('[data-action="vault-setup"]');
		await page.fill("#vault-setup-passphrase", "1234");
		await page.fill("#vault-setup-confirm", "1234");
		await page.click('[data-action="do-setup-vault"]');
		await page.waitForFunction(() => !!localStorage.getItem("fincoach-vault-salt"), {
			timeout: 15_000,
		});
		await page.goto("/#/");
		await page.goto("/#/settings");
		await expect(page.locator("text=Not supported on this device")).toBeVisible({ timeout: 8_000 });
		await expect(page.locator('[data-action="enable-biometric"]')).toHaveCount(0);
	});
});

// ---------------------------------------------------------------------------
// Group 2 – Vault unlock screen (these tests use JS evaluation to set up the
// vault state directly, so they work independently of the settings card UI)
// ---------------------------------------------------------------------------
test.describe("Vault unlock screen", () => {
	test("Vault lock shows unlock screen on reload", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupAndLockVault(page, "1234");
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
	});

	test("Vault unlock - wrong passphrase shows error", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupAndLockVault(page, "1234");
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
		await expect(page.locator("#vault-unlock-passphrase")).toHaveAttribute("inputmode", "numeric");
		// Enter wrong passphrase
		await page.fill("#vault-unlock-passphrase", "9999");
		await page.click('[data-action="unlock-vault"]');
		await expect(page.locator("#vault-unlock-error")).toBeVisible({ timeout: 5_000 });
		// Unlock screen should still be visible
		await expect(page.locator("#vault-unlock-screen")).toBeVisible();
	});

	test("Vault unlock - correct passphrase dismisses screen", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupAndLockVault(page, "1234");
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
		// Enter correct passphrase
		await page.fill("#vault-unlock-passphrase", "1234");
		await page.click('[data-action="unlock-vault"]');
		await expect(page.locator("#vault-unlock-screen")).toBeHidden({ timeout: 8_000 });
		// App should load normally
		await expect(page.locator("#app")).toBeVisible({ timeout: 5_000 });
	});

	test("Vault forgot passphrase - shows reset modal", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupAndLockVault(page, "1234");
		await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
		// Click forgot passphrase
		await page.click('[data-action="vault-forgot-passphrase"]');
		await expect(page.locator("#vault-forgot-modal")).toBeVisible({ timeout: 5_000 });
	});

	test("Vault forgot passphrase - confirm reset clears vault and loads app", async ({
		pwaPage,
	}) => {
		const page = pwaPage;
		await setupAndLockVault(page, "1234");
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

// ---------------------------------------------------------------------------
// Group 3 – AI public settings survive vault unlock
//
// Regression coverage for the bug where the AI Provider/Model (public,
// non-secret settings kept in localStorage `fincoach-ai-settings`) vanished
// after the credential vault was unlocked, while the API key (secret, encrypted
// in `fincoach-vault-ai`) survived. Public settings must come from localStorage;
// the decrypted vault cache supplies only the apiKey and must never clobber
// good localStorage public values.
// ---------------------------------------------------------------------------
const AI_SETTINGS_LS_KEY = "fincoach-ai-settings";

async function setupVaultAndSaveAI(page, { provider, model, apiKey, pin = "1234" }) {
	await page.evaluate(
		async ({ provider, model, apiKey, pin }) => {
			await window.API.setupVault(pin);
			await window.AI.saveSettings({ provider, model, apiKey });
		},
		{ provider, model, apiKey, pin },
	);
}

async function lockAndReload(page) {
	await page.evaluate(() => window.API.lockVault());
	await page.reload({ waitUntil: "domcontentloaded" });
}

async function unlockViaScreen(page, pin = "1234") {
	await expect(page.locator("#vault-unlock-screen")).toBeVisible({ timeout: 8_000 });
	await page.fill("#vault-unlock-passphrase", pin);
	await page.click('[data-action="unlock-vault"]');
	await expect(page.locator("#vault-unlock-screen")).toBeHidden({ timeout: 8_000 });
}

// Hash-based navigation (no full reload — a reload would re-lock the in-memory vault).
async function goSettingsHash(page) {
	await page.evaluate(() => {
		window.location.hash = "#/settings";
	});
	await page.waitForSelector("#ai-provider", { timeout: 10_000 });
}

test.describe("AI settings survive vault unlock", () => {
	test("provider + model + key persist through lock → reload → unlock (bug repro)", async ({
		pwaPage,
	}) => {
		const page = pwaPage;
		await setupVaultAndSaveAI(page, {
			provider: "groq",
			model: "llama-3.1-8b-instant",
			apiKey: "sk-groq-123",
		});
		await lockAndReload(page);
		await unlockViaScreen(page, "1234");
		await goSettingsHash(page);
		// Primary user-visible assertion: provider dropdown + model input restored.
		await expect(page.locator("#ai-provider")).toHaveValue("groq");
		await expect(page.locator("#ai-model")).toHaveValue("llama-3.1-8b-instant");
		// The secret key is present and usable after unlock.
		await expect(page.locator("#ai-api-key")).toHaveValue("sk-groq-123");
	});

	test("empty localStorage + vault-only {apiKey} does not poison settings on unlock", async ({
		pwaPage,
	}) => {
		const page = pwaPage;
		await setupVaultAndSaveAI(page, {
			provider: "groq",
			model: "llama-3.1-8b-instant",
			apiKey: "sk-groq-123",
		});
		// Simulate the exact broken cross-device state: public localStorage lost,
		// encrypted vault {apiKey} intact.
		await page.evaluate((k) => localStorage.removeItem(k), AI_SETTINGS_LS_KEY);
		await lockAndReload(page);
		await unlockViaScreen(page, "1234");
		// The API key remains usable from the vault.
		const apiKey = await page.evaluate(() => window.AI.getSettings().apiKey);
		expect(apiKey).toBe("sk-groq-123");
		// localStorage was NOT overwritten with an all-null public object — nothing
		// poisonous to feed into a subsequent GDrive backup.
		const raw = await page.evaluate((k) => localStorage.getItem(k), AI_SETTINGS_LS_KEY);
		expect(raw).toBeNull();
		// getSettings returns clean public defaults (no persisted null poisoning).
		const settings = await page.evaluate(() => window.AI.getSettings());
		expect(settings.provider).toBeNull();
		expect(settings.model).toBe("");
	});

	test("provider/model/key survive after changing the PIN", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupVaultAndSaveAI(page, {
			provider: "openai",
			model: "gpt-4o-mini",
			apiKey: "sk-openai-xyz",
		});
		await page.evaluate(async () => {
			await window.API.changeVaultPassphrase("1234", "5678");
		});
		await lockAndReload(page);
		await unlockViaScreen(page, "5678");
		await goSettingsHash(page);
		await expect(page.locator("#ai-provider")).toHaveValue("openai");
		await expect(page.locator("#ai-model")).toHaveValue("gpt-4o-mini");
		await expect(page.locator("#ai-api-key")).toHaveValue("sk-openai-xyz");
	});

	test("biometric unlock preserves provider/model/key", async ({ pwaPage }) => {
		const page = pwaPage;
		await installBiometricMocks(page);
		await setupVaultAndSaveAI(page, {
			provider: "groq",
			model: "llama-3.1-8b-instant",
			apiKey: "sk-bio-1",
		});
		await page.evaluate(async () => {
			await window.API.setupBiometric("1234");
		});
		await page.evaluate(() => window.API.lockVault());
		await page.reload({ waitUntil: "domcontentloaded" });
		// The unlock screen auto-triggers biometric unlock when enabled. Poll the
		// hydrated settings directly rather than racing the overlay's removal.
		await page.waitForFunction(
			() => window.AI?.getSettings?.().apiKey === "sk-bio-1",
			{ timeout: 15_000 },
		);
		const s = await page.evaluate(() => window.AI.getSettings());
		expect(s.provider).toBe("groq");
		expect(s.model).toBe("llama-3.1-8b-instant");
		expect(s.apiKey).toBe("sk-bio-1");
	});

	test("session-expiry wipe clears AI + vault settings and shows setup", async ({ pwaPage }) => {
		const page = pwaPage;
		await setupVaultAndSaveAI(page, {
			provider: "groq",
			model: "llama-3.1-8b-instant",
			apiKey: "sk-wipe",
		});
		// Force an expired session: last activity far in the past, device not trusted.
		await page.evaluate(() => {
			localStorage.setItem("fincoach-session-last-activity", "1");
			localStorage.removeItem("fincoach-trusted-device");
		});
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForTimeout(1_000);
		// Everything sensitive is wiped — no half-erased state where the key lingers.
		const state = await page.evaluate(() => ({
			ai: localStorage.getItem("fincoach-ai-settings"),
			vaultAI: localStorage.getItem("fincoach-vault-ai"),
			salt: localStorage.getItem("fincoach-vault-salt"),
			onboarded: localStorage.getItem("fincoach-onboarded"),
		}));
		expect(state.ai).toBeNull();
		expect(state.vaultAI).toBeNull();
		expect(state.salt).toBeNull();
		expect(state.onboarded).toBeNull();
		// App is not stuck on a locked/unlock overlay.
		await expect(page.locator("#vault-unlock-screen")).toHaveCount(0);
	});
});
