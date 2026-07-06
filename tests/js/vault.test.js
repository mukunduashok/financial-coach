/**
 * Unit tests for static/js/vault.js — Credential vault (PBKDF2 + AES-256-GCM).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Node 22 already exposes globalThis.crypto natively — no polyfill needed.

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------
let localStorageData = {};
globalThis.localStorage = {
	getItem: (key) => localStorageData[key] ?? null,
	setItem: (key, val) => {
		localStorageData[key] = val;
	},
	removeItem: (key) => {
		delete localStorageData[key];
	},
	clear: () => {
		for (const k of Object.keys(localStorageData)) delete localStorageData[k];
	},
};

// ---------------------------------------------------------------------------
// Mock config.js
// ---------------------------------------------------------------------------
import { vi } from "vitest";

vi.mock("../../static/js/config.js", () => ({
	VAULT_SALT_KEY: "fincoach-vault-salt",
	VAULT_SENTINEL_KEY: "fincoach-vault-sentinel",
	VAULT_AI_KEY: "fincoach-vault-ai",
	VAULT_GMAIL_KEY: "fincoach-vault-gmail",
	AI_SETTINGS_KEY: "fincoach-ai-settings",
	GMAIL_SETTINGS_KEY: "fincoach-gmail-settings",
}));

const { Vault } = await import("../../static/js/vault.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resetVault() {
	localStorageData = {};
	Vault._key = null;
}

beforeEach(resetVault);
afterEach(resetVault);

// ===========================================================================
// 1. isConfigured
// ===========================================================================
describe("isConfigured()", () => {
	it("returns false before setup", () => {
		expect(Vault.isConfigured()).toBe(false);
	});

	it("returns true after setup()", async () => {
		await Vault.setup("mypassphrase");
		expect(Vault.isConfigured()).toBe(true);
	});
});

// ===========================================================================
// 2. isUnlocked
// ===========================================================================
describe("isUnlocked()", () => {
	it("returns false before unlock", async () => {
		await Vault.setup("mypassphrase");
		Vault.lock();
		expect(Vault.isUnlocked()).toBe(false);
	});

	it("returns true after unlock with correct passphrase", async () => {
		await Vault.setup("mypassphrase");
		Vault.lock();
		await Vault.unlock("mypassphrase");
		expect(Vault.isUnlocked()).toBe(true);
	});
});

// ===========================================================================
// 3. setup()
// ===========================================================================
describe("setup()", () => {
	it("stores VAULT_SALT_KEY in localStorage", async () => {
		await Vault.setup("mypassphrase");
		expect(localStorageData["fincoach-vault-salt"]).toBeTruthy();
	});

	it("stores VAULT_SENTINEL_KEY in localStorage", async () => {
		await Vault.setup("mypassphrase");
		expect(localStorageData["fincoach-vault-sentinel"]).toBeTruthy();
	});

	it("leaves vault unlocked after setup", async () => {
		await Vault.setup("mypassphrase");
		expect(Vault.isUnlocked()).toBe(true);
	});
});

// ===========================================================================
// 4. unlock()
// ===========================================================================
describe("unlock()", () => {
	it("returns true for the correct passphrase", async () => {
		await Vault.setup("correct-pass");
		Vault.lock();
		const result = await Vault.unlock("correct-pass");
		expect(result).toBe(true);
		expect(Vault.isUnlocked()).toBe(true);
	});

	it("returns false for a wrong passphrase", async () => {
		await Vault.setup("correct-pass");
		Vault.lock();
		const result = await Vault.unlock("wrong-pass");
		expect(result).toBe(false);
		expect(Vault.isUnlocked()).toBe(false);
	});

	it("returns false when vault is not configured", async () => {
		const result = await Vault.unlock("anything");
		expect(result).toBe(false);
	});
});

// ===========================================================================
// 5. lock()
// ===========================================================================
describe("lock()", () => {
	it("clears the key so isUnlocked() becomes false", async () => {
		await Vault.setup("mypassphrase");
		expect(Vault.isUnlocked()).toBe(true);
		Vault.lock();
		expect(Vault.isUnlocked()).toBe(false);
	});
});

// ===========================================================================
// 6. encryptJSON / decryptJSON
// ===========================================================================
describe("encryptJSON / decryptJSON round-trip", () => {
	it("round-trips an object through encrypt then decrypt", async () => {
		await Vault.setup("mypassphrase");
		const obj = { foo: "bar", num: 42, nested: { a: true } };
		const blob = await Vault.encryptJSON(obj);
		const result = await Vault.decryptJSON(blob);
		expect(result).toEqual(obj);
	});

	it("encryptJSON throws when locked", async () => {
		await Vault.setup("mypassphrase");
		Vault.lock();
		await expect(Vault.encryptJSON({ x: 1 })).rejects.toThrow("Vault is locked");
	});

	it("decryptJSON throws when locked", async () => {
		await Vault.setup("mypassphrase");
		const blob = await Vault.encryptJSON({ x: 1 });
		Vault.lock();
		await expect(Vault.decryptJSON(blob)).rejects.toThrow("Vault is locked");
	});

	it("two encryptions of the same plaintext produce different ciphertext (random IVs)", async () => {
		await Vault.setup("mypassphrase");
		const obj = { secret: "value" };
		const blob1 = await Vault.encryptJSON(obj);
		const blob2 = await Vault.encryptJSON(obj);
		expect(blob1).not.toBe(blob2);
	});
});

// ===========================================================================
// 7. saveAISettings / loadAISettings
// ===========================================================================
describe("saveAISettings / loadAISettings", () => {
	it("stores encrypted blob under VAULT_AI_KEY", async () => {
		await Vault.setup("mypassphrase");
		await Vault.saveAISettings({ provider: "groq", apiKey: "sk-test" });
		expect(localStorageData["fincoach-vault-ai"]).toBeTruthy();
	});

	it("removes AI_SETTINGS_KEY (plaintext) from localStorage", async () => {
		await Vault.setup("mypassphrase");
		localStorageData["fincoach-ai-settings"] = JSON.stringify({ provider: "groq" });
		await Vault.saveAISettings({ provider: "groq", apiKey: "sk-test" });
		expect(localStorageData["fincoach-ai-settings"]).toBeUndefined();
	});

	it("loadAISettings returns the original settings object", async () => {
		await Vault.setup("mypassphrase");
		const settings = { provider: "openai", apiKey: "sk-openai", model: "gpt-4o" };
		await Vault.saveAISettings(settings);
		const loaded = await Vault.loadAISettings();
		expect(loaded).toEqual(settings);
	});

	it("loadAISettings returns null when no blob stored", async () => {
		await Vault.setup("mypassphrase");
		const loaded = await Vault.loadAISettings();
		expect(loaded).toBeNull();
	});
});

// ===========================================================================
// 8. saveGmailSettings / loadGmailSettings
// ===========================================================================
describe("saveGmailSettings / loadGmailSettings", () => {
	it("stores encrypted blob under VAULT_GMAIL_KEY", async () => {
		await Vault.setup("mypassphrase");
		await Vault.saveGmailSettings({ accessToken: "tok123" });
		expect(localStorageData["fincoach-vault-gmail"]).toBeTruthy();
	});

	it("removes GMAIL_SETTINGS_KEY (plaintext) from localStorage", async () => {
		await Vault.setup("mypassphrase");
		localStorageData["fincoach-gmail-settings"] = JSON.stringify({ accessToken: "old" });
		await Vault.saveGmailSettings({ accessToken: "tok123" });
		expect(localStorageData["fincoach-gmail-settings"]).toBeUndefined();
	});

	it("loadGmailSettings returns the original settings object", async () => {
		await Vault.setup("mypassphrase");
		const settings = { accessToken: "tok123", refreshToken: "ref456", sub: "12345" };
		await Vault.saveGmailSettings(settings);
		const loaded = await Vault.loadGmailSettings();
		expect(loaded).toEqual(settings);
	});

	it("loadGmailSettings returns null when no blob stored", async () => {
		await Vault.setup("mypassphrase");
		const loaded = await Vault.loadGmailSettings();
		expect(loaded).toBeNull();
	});
});

// ===========================================================================
// 9. clearCredentials()
// ===========================================================================
describe("clearCredentials()", () => {
	it("removes all four vault keys from localStorage", async () => {
		await Vault.setup("mypassphrase");
		await Vault.saveAISettings({ apiKey: "k" });
		await Vault.saveGmailSettings({ accessToken: "t" });
		Vault.clearCredentials();
		expect(localStorageData["fincoach-vault-salt"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-sentinel"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-ai"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-gmail"]).toBeUndefined();
	});

	it("sets isConfigured() to false", async () => {
		await Vault.setup("mypassphrase");
		Vault.clearCredentials();
		expect(Vault.isConfigured()).toBe(false);
	});

	it("sets isUnlocked() to false", async () => {
		await Vault.setup("mypassphrase");
		expect(Vault.isUnlocked()).toBe(true);
		Vault.clearCredentials();
		expect(Vault.isUnlocked()).toBe(false);
	});
});

// ===========================================================================
// 10. changePassphrase()
// ===========================================================================
describe("changePassphrase()", () => {
	it("unlock with new passphrase returns true after change", async () => {
		await Vault.setup("old-pass");
		await Vault.changePassphrase("old-pass", "new-pass");
		Vault.lock();
		const result = await Vault.unlock("new-pass");
		expect(result).toBe(true);
	});

	it("unlock with old passphrase returns false after change", async () => {
		await Vault.setup("old-pass");
		await Vault.changePassphrase("old-pass", "new-pass");
		Vault.lock();
		const result = await Vault.unlock("old-pass");
		expect(result).toBe(false);
	});

	it("throws 'Wrong passphrase' when old passphrase is incorrect", async () => {
		await Vault.setup("correct-pass");
		await expect(Vault.changePassphrase("wrong-pass", "new-pass")).rejects.toThrow(
			"Wrong passphrase",
		);
	});

	it("re-encrypts existing AI settings under the new passphrase", async () => {
		await Vault.setup("old-pass");
		const aiSettings = { provider: "groq", apiKey: "sk-test" };
		await Vault.saveAISettings(aiSettings);
		await Vault.changePassphrase("old-pass", "new-pass");
		Vault.lock();
		await Vault.unlock("new-pass");
		const loaded = await Vault.loadAISettings();
		expect(loaded).toEqual(aiSettings);
	});

	it("re-encrypts existing Gmail settings under the new passphrase", async () => {
		await Vault.setup("old-pass");
		const gmailSettings = { accessToken: "tok", refreshToken: "ref" };
		await Vault.saveGmailSettings(gmailSettings);
		await Vault.changePassphrase("old-pass", "new-pass");
		Vault.lock();
		await Vault.unlock("new-pass");
		const loaded = await Vault.loadGmailSettings();
		expect(loaded).toEqual(gmailSettings);
	});
});
