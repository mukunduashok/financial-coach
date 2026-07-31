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
	VAULT_PIN_KIND_KEY: "fincoach-vault-pin-kind",
	VAULT_PIN_VERSION_KEY: "fincoach-vault-pin-version",
	AI_SETTINGS_KEY: "fincoach-ai-settings",
	GMAIL_SETTINGS_KEY: "fincoach-gmail-settings",
	VAULT_BIOMETRIC_CRED_KEY: "fincoach-vault-biometric-cred",
	VAULT_BIOMETRIC_LEGACY_WRAP_KEY: "fincoach-vault-biometric-wrap",
	VAULT_BIOMETRIC_PRF_SALT_KEY: "fincoach-vault-biometric-prf-salt",
	VAULT_BIOMETRIC_WRAPPED_KEY: "fincoach-vault-biometric-wrapped",
}));

const mockCreate = vi.fn();
const mockGet = vi.fn();
globalThis.navigator = { credentials: { create: mockCreate, get: mockGet } };
globalThis.PublicKeyCredential = {
	isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
	getClientCapabilities: vi.fn().mockResolvedValue({ extensions: ["prf"] }),
};

const { Vault } = await import("../../static/js/vault.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resetVault() {
	localStorageData = {};
	Vault._key = null;
	mockCreate.mockReset();
	mockGet.mockReset();
	globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(true);
	globalThis.PublicKeyCredential.getClientCapabilities.mockResolvedValue({ extensions: ["prf"] });
}

function makeCreateCredential(rawId = [1, 2, 3], prfBytes = null) {
	return {
		rawId: new Uint8Array(rawId),
		getClientExtensionResults: () =>
			prfBytes
				? {
					prf: {
						results: {
							first: new Uint8Array(prfBytes).buffer,
						},
					},
				}
				: {},
	};
}

function makeGetCredential(prfBytes = [7, 8, 9, 10]) {
	return {
		getClientExtensionResults: () => ({
			prf: {
				results: {
					first: new Uint8Array(prfBytes).buffer,
				},
			},
		}),
	};
}

async function createLegacyAlphaVault(pin = "alphaPIN") {
	const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
	const keyMaterial = await globalThis.crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pin),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	const key = await globalThis.crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt,
			iterations: 100_000,
			hash: "SHA-256",
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await globalThis.crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode("fincoach-vault-ok"),
	);
	const combined = new Uint8Array(12 + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), 12);
	localStorageData["fincoach-vault-salt"] = btoa(String.fromCharCode(...salt));
	localStorageData["fincoach-vault-sentinel"] = btoa(String.fromCharCode(...combined));
	delete localStorageData["fincoach-vault-pin-kind"];
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
		await Vault.setup("123456");
		expect(Vault.isConfigured()).toBe(true);
	});
});

// ===========================================================================
// 2. isUnlocked
// ===========================================================================
describe("isUnlocked()", () => {
	it("returns false before unlock", async () => {
		await Vault.setup("123456");
		Vault.lock();
		expect(Vault.isUnlocked()).toBe(false);
	});

	it("returns true after unlock with correct passphrase", async () => {
		await Vault.setup("123456");
		Vault.lock();
		await Vault.unlock("123456");
		expect(Vault.isUnlocked()).toBe(true);
	});
});

// ===========================================================================
// 3. setup()
// ===========================================================================
describe("setup()", () => {
	it("rejects non-numeric PINs", async () => {
		await expect(Vault.setup("abcd")).rejects.toThrow(
			"PIN must contain only digits and be at least 6 digits.",
		);
	});

	it("stores VAULT_SALT_KEY in localStorage", async () => {
		await Vault.setup("123456");
		expect(localStorageData["fincoach-vault-salt"]).toBeTruthy();
	});

	it("stores VAULT_SENTINEL_KEY in localStorage", async () => {
		await Vault.setup("123456");
		expect(localStorageData["fincoach-vault-sentinel"]).toBeTruthy();
	});

	it("leaves vault unlocked after setup", async () => {
		await Vault.setup("123456");
		expect(Vault.isUnlocked()).toBe(true);
	});

	it("writes VAULT_PIN_VERSION_KEY = '2' to localStorage", async () => {
		await Vault.setup("123456");
		expect(localStorageData["fincoach-vault-pin-version"]).toBe("2");
	});
});

// ===========================================================================
// 4. unlock()
// ===========================================================================
describe("unlock()", () => {
	it("returns true for the correct passphrase", async () => {
		await Vault.setup("123456");
		Vault.lock();
		const result = await Vault.unlock("123456");
		expect(result).toBe(true);
		expect(Vault.isUnlocked()).toBe(true);
	});

	it("returns false for a wrong passphrase", async () => {
		await Vault.setup("123456");
		Vault.lock();
		const result = await Vault.unlock("999999");
		expect(result).toBe(false);
		expect(Vault.isUnlocked()).toBe(false);
	});

	it("returns false when vault is not configured", async () => {
		const result = await Vault.unlock("anything");
		expect(result).toBe(false);
	});

	it("still unlocks legacy vaults that were created with alphabetic passphrases before numeric-only enforcement", async () => {
		await createLegacyAlphaVault("alphaPIN");
		const result = await Vault.unlock("alphaPIN");
		expect(result).toBe(true);
		expect(Vault.isUnlocked()).toBe(true);
	});
});

// ===========================================================================
// 5. lock()
// ===========================================================================
describe("lock()", () => {
	it("clears the key so isUnlocked() becomes false", async () => {
		await Vault.setup("123456");
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
		await Vault.setup("123456");
		const obj = { foo: "bar", num: 42, nested: { a: true } };
		const blob = await Vault.encryptJSON(obj);
		const result = await Vault.decryptJSON(blob);
		expect(result).toEqual(obj);
	});

	it("encryptJSON throws when locked", async () => {
		await Vault.setup("123456");
		Vault.lock();
		await expect(Vault.encryptJSON({ x: 1 })).rejects.toThrow("Vault is locked");
	});

	it("decryptJSON throws when locked", async () => {
		await Vault.setup("123456");
		const blob = await Vault.encryptJSON({ x: 1 });
		Vault.lock();
		await expect(Vault.decryptJSON(blob)).rejects.toThrow("Vault is locked");
	});

	it("two encryptions of the same plaintext produce different ciphertext (random IVs)", async () => {
		await Vault.setup("123456");
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
		await Vault.setup("123456");
		await Vault.saveAISettings({ provider: "groq", apiKey: "sk-test" });
		expect(localStorageData["fincoach-vault-ai"]).toBeTruthy();
	});

	it("preserves AI_SETTINGS_KEY public settings in localStorage", async () => {
		await Vault.setup("123456");
		localStorageData["fincoach-ai-settings"] = JSON.stringify({ provider: "groq", model: "llama" });
		await Vault.saveAISettings({ provider: "groq", apiKey: "sk-test" });
		expect(JSON.parse(localStorageData["fincoach-ai-settings"]).provider).toBe("groq");
		expect(JSON.parse(localStorageData["fincoach-ai-settings"]).model).toBe("llama");
	});

	it("loadAISettings returns the original settings object", async () => {
		await Vault.setup("123456");
		const settings = { provider: "openai", apiKey: "sk-openai", model: "gpt-4o" };
		await Vault.saveAISettings(settings);
		const loaded = await Vault.loadAISettings();
		expect(loaded).toEqual(settings);
	});

	it("loadAISettings returns null when no blob stored", async () => {
		await Vault.setup("123456");
		const loaded = await Vault.loadAISettings();
		expect(loaded).toBeNull();
	});

	it("clearAISettings removes the encrypted AI blob only", async () => {
		await Vault.setup("123456");
		await Vault.saveAISettings({ apiKey: "sk-test" });
		Vault.clearAISettings();
		expect(localStorageData["fincoach-vault-ai"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-salt"]).toBeTruthy();
	});
});

// ===========================================================================
// 8. saveGmailSettings / loadGmailSettings
// ===========================================================================
describe("saveGmailSettings / loadGmailSettings", () => {
	it("stores encrypted blob under VAULT_GMAIL_KEY", async () => {
		await Vault.setup("123456");
		await Vault.saveGmailSettings({ accessToken: "tok123" });
		expect(localStorageData["fincoach-vault-gmail"]).toBeTruthy();
	});

	it("preserves GMAIL_SETTINGS_KEY public settings in localStorage", async () => {
		await Vault.setup("123456");
		localStorageData["fincoach-gmail-settings"] = JSON.stringify({ email: "user@example.com", sub: "abc" });
		await Vault.saveGmailSettings({ accessToken: "tok123" });
		expect(JSON.parse(localStorageData["fincoach-gmail-settings"]).email).toBe("user@example.com");
		expect(JSON.parse(localStorageData["fincoach-gmail-settings"]).sub).toBe("abc");
	});

	it("loadGmailSettings returns the original settings object", async () => {
		await Vault.setup("123456");
		const settings = { accessToken: "tok123", refreshToken: "ref456", sub: "12345" };
		await Vault.saveGmailSettings(settings);
		const loaded = await Vault.loadGmailSettings();
		expect(loaded).toEqual(settings);
	});

	it("loadGmailSettings returns null when no blob stored", async () => {
		await Vault.setup("123456");
		const loaded = await Vault.loadGmailSettings();
		expect(loaded).toBeNull();
	});

	it("clearGmailSettings removes the encrypted Gmail blob only", async () => {
		await Vault.setup("123456");
		await Vault.saveGmailSettings({ accessToken: "tok123" });
		Vault.clearGmailSettings();
		expect(localStorageData["fincoach-vault-gmail"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-salt"]).toBeTruthy();
	});
});

// ===========================================================================
// 9. clearCredentials()
// ===========================================================================
describe("clearCredentials()", () => {
	it("removes all vault keys including the PIN version key from localStorage", async () => {
		await Vault.setup("123456");
		await Vault.saveAISettings({ apiKey: "k" });
		await Vault.saveGmailSettings({ accessToken: "t" });
		Vault.clearCredentials();
		expect(localStorageData["fincoach-vault-salt"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-sentinel"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-ai"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-gmail"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-pin-version"]).toBeUndefined();
	});

	it("sets isConfigured() to false", async () => {
		await Vault.setup("123456");
		Vault.clearCredentials();
		expect(Vault.isConfigured()).toBe(false);
	});

	it("sets isUnlocked() to false", async () => {
		await Vault.setup("123456");
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
		await Vault.setup("123456");
		await Vault.changePassphrase("123456", "567890");
		Vault.lock();
		const result = await Vault.unlock("567890");
		expect(result).toBe(true);
	});

	it("unlock with old passphrase returns false after change", async () => {
		await Vault.setup("123456");
		await Vault.changePassphrase("123456", "567890");
		Vault.lock();
		const result = await Vault.unlock("123456");
		expect(result).toBe(false);
	});

	it("throws 'Wrong passphrase' when old passphrase is incorrect", async () => {
		await Vault.setup("123456");
		await expect(Vault.changePassphrase("999999", "567890")).rejects.toThrow(
			"Wrong passphrase",
		);
	});

	it("re-encrypts existing AI settings under the new passphrase", async () => {
		await Vault.setup("123456");
		const aiSettings = { provider: "groq", apiKey: "sk-test" };
		await Vault.saveAISettings(aiSettings);
		await Vault.changePassphrase("123456", "567890");
		Vault.lock();
		await Vault.unlock("567890");
		const loaded = await Vault.loadAISettings();
		expect(loaded).toEqual(aiSettings);
	});

	it("re-encrypts existing Gmail settings under the new passphrase", async () => {
		await Vault.setup("123456");
		const gmailSettings = { accessToken: "tok", refreshToken: "ref" };
		await Vault.saveGmailSettings(gmailSettings);
		await Vault.changePassphrase("123456", "567890");
		Vault.lock();
		await Vault.unlock("567890");
		const loaded = await Vault.loadGmailSettings();
		expect(loaded).toEqual(gmailSettings);
	});

	it("clears biometric keys after passphrase change", async () => {
		await Vault.setup("123456");
		// Manually set biometric keys
		localStorageData["fincoach-vault-biometric-cred"] = "cred";
		localStorageData["fincoach-vault-biometric-prf-salt"] = "salt";
		localStorageData["fincoach-vault-biometric-wrap"] = "wrap";
		localStorageData["fincoach-vault-biometric-wrapped"] = "wrapped";
		await Vault.changePassphrase("123456", "567890");
		expect(localStorageData["fincoach-vault-biometric-cred"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-biometric-prf-salt"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-biometric-wrap"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-biometric-wrapped"]).toBeUndefined();
	});

	it("migrates a legacy alphabetic vault to a numeric-only PIN on passphrase change", async () => {
		await createLegacyAlphaVault("alphaPIN");
		await Vault.changePassphrase("alphaPIN", "567890");
		Vault.lock();
		await expect(Vault.unlock("alphaPIN")).resolves.toBe(false);
		await expect(Vault.unlock("567890")).resolves.toBe(true);
		expect(localStorageData["fincoach-vault-pin-kind"]).toBe("numeric");
	});

	it("rejects non-numeric new PINs on passphrase change", async () => {
		await Vault.setup("123456");
		await expect(Vault.changePassphrase("123456", "56ab")).rejects.toThrow(
			"New PIN must contain only digits and be at least 6 digits.",
		);
	});
});

// ===========================================================================
// 11. isBiometricAvailable()
// ===========================================================================
describe("isBiometricAvailable()", () => {
	it("returns true when platform authenticator and PRF support are available", async () => {
		globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(
			true,
		);
		globalThis.PublicKeyCredential.getClientCapabilities.mockResolvedValue({ extensions: ["prf"] });
		const result = await Vault.isBiometricAvailable();
		expect(result).toBe(true);
	});

	it("returns false when platform authenticator is not available", async () => {
		globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(
			false,
		);
		const result = await Vault.isBiometricAvailable();
		expect(result).toBe(false);
	});

	it("returns false when PRF support is not advertised", async () => {
		globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValue(
			true,
		);
		globalThis.PublicKeyCredential.getClientCapabilities.mockResolvedValue({ extensions: [] });
		const result = await Vault.isBiometricAvailable();
		expect(result).toBe(false);
	});

	it("returns false when getClientCapabilities is unavailable", async () => {
		const saved = globalThis.PublicKeyCredential.getClientCapabilities;
		delete globalThis.PublicKeyCredential.getClientCapabilities;
		const result = await Vault.isBiometricAvailable();
		expect(result).toBe(false);
		globalThis.PublicKeyCredential.getClientCapabilities = saved;
	});

	it("returns false when navigator.credentials is missing", async () => {
		const savedNav = globalThis.navigator;
		globalThis.navigator = {};
		const result = await Vault.isBiometricAvailable();
		expect(result).toBe(false);
		globalThis.navigator = savedNav;
	});
});

// ===========================================================================
// 12. isBiometricEnabled()
// ===========================================================================
describe("isBiometricEnabled()", () => {
	it("returns false before setupBiometric", () => {
		expect(Vault.isBiometricEnabled()).toBe(false);
	});

	it("returns true after setupBiometric succeeds", async () => {
		await Vault.setup("123456");
		mockCreate.mockResolvedValue(makeCreateCredential());
		mockGet.mockResolvedValue(makeGetCredential());
		await Vault.setupBiometric("123456");
		expect(Vault.isBiometricEnabled()).toBe(true);
	});

	it("returns false and clears legacy biometric storage", () => {
		localStorageData["fincoach-vault-biometric-cred"] = "cred";
		localStorageData["fincoach-vault-biometric-wrap"] = "legacy-wrap";
		localStorageData["fincoach-vault-biometric-wrapped"] = "legacy-wrapped";

		expect(Vault.isBiometricEnabled()).toBe(false);
		expect(localStorageData["fincoach-vault-biometric-cred"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-biometric-wrap"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-biometric-wrapped"]).toBeUndefined();
	});
});

// ===========================================================================
// 13. setupBiometric()
// ===========================================================================
describe("setupBiometric()", () => {
	it("throws 'Incorrect passphrase' when passphrase is wrong", async () => {
		await Vault.setup("123456");
		Vault.lock();
		await expect(Vault.setupBiometric("999999")).rejects.toThrow("Incorrect passphrase");
	});

	it("stores all 3 biometric keys on success", async () => {
		await Vault.setup("123456");
		mockCreate.mockResolvedValue(makeCreateCredential());
		mockGet.mockResolvedValue(makeGetCredential());
		await Vault.setupBiometric("123456");
		expect(localStorageData["fincoach-vault-biometric-cred"]).toBeTruthy();
		expect(localStorageData["fincoach-vault-biometric-prf-salt"]).toBeTruthy();
		expect(localStorageData["fincoach-vault-biometric-wrapped"]).toBeTruthy();
		expect(localStorageData["fincoach-vault-biometric-wrap"]).toBeUndefined();
	});

	it("uses PRF output returned by credential creation without requiring a second biometric prompt", async () => {
		await Vault.setup("123456");
		mockCreate.mockResolvedValue(makeCreateCredential([1, 2, 3], [4, 5, 6, 7]));
		mockGet.mockRejectedValue(new Error("should not be called"));

		await Vault.setupBiometric("123456");

		expect(localStorageData["fincoach-vault-biometric-cred"]).toBeTruthy();
		expect(localStorageData["fincoach-vault-biometric-prf-salt"]).toBeTruthy();
		expect(localStorageData["fincoach-vault-biometric-wrapped"]).toBeTruthy();
		expect(mockGet).not.toHaveBeenCalled();
	});

	it("stores the same PRF salt used during setup so biometric unlock still works after a create-time PRF result", async () => {
		await Vault.setup("123456");
		const derivePrfForSalt = (saltBytes) => {
			const salt = new Uint8Array(saltBytes);
			return Uint8Array.from([salt[0] ?? 0, salt[1] ?? 0, salt[2] ?? 0, salt[3] ?? 0]).buffer;
		};

		mockCreate.mockImplementation(async ({ publicKey }) => ({
			rawId: new Uint8Array([1, 2, 3]),
			getClientExtensionResults: () => ({
				prf: {
					results: {
						first: derivePrfForSalt(publicKey.extensions.prf.eval.first),
					},
				},
			}),
		}));
		mockGet.mockImplementation(async ({ publicKey }) => ({
			getClientExtensionResults: () => ({
				prf: {
					results: {
						first: derivePrfForSalt(publicKey.extensions.prf.eval.first),
					},
				},
			}),
		}));

		await Vault.setupBiometric("123456");
		Vault.lock();

		await expect(Vault.unlockWithBiometric()).resolves.toBe(true);
	});

	it("falls back to credentials.get with prf.eval for broader browser compatibility", async () => {
		await Vault.setup("123456");
		mockCreate.mockResolvedValue(makeCreateCredential([1, 2, 3]));
		mockGet.mockImplementation(async ({ publicKey }) => {
			expect(publicKey.extensions.prf.eval.first).toBeInstanceOf(Uint8Array);
			expect(publicKey.extensions.prf.evalByCredential).toBeUndefined();
			return makeGetCredential();
		});

		await expect(Vault.setupBiometric("123456")).resolves.toBeUndefined();
		expect(mockGet).toHaveBeenCalledTimes(1);
	});
});

// ===========================================================================
// 14. unlockWithBiometric()
// ===========================================================================
describe("unlockWithBiometric()", () => {
	it("returns false when no credential is stored", async () => {
		const result = await Vault.unlockWithBiometric();
		expect(result).toBe(false);
	});

	it("returns true on successful biometric authentication", async () => {
		await Vault.setup("123456");
		mockCreate.mockResolvedValue(makeCreateCredential());
		mockGet.mockResolvedValue(makeGetCredential());
		await Vault.setupBiometric("123456");
		Vault.lock();
		const result = await Vault.unlockWithBiometric();
		expect(result).toBe(true);
		expect(Vault.isUnlocked()).toBe(true);
	});

	it("returns false when credentials.get is rejected (user cancels)", async () => {
		await Vault.setup("123456");
		mockCreate.mockResolvedValue(makeCreateCredential());
		mockGet.mockResolvedValue(makeGetCredential());
		await Vault.setupBiometric("123456");
		Vault.lock();
		mockGet.mockRejectedValue(new Error("NotAllowedError"));
		const result = await Vault.unlockWithBiometric();
		expect(result).toBe(false);
	});

	it("returns false when PRF output is unavailable, proving storage-only possession is insufficient", async () => {
		await Vault.setup("123456");
		mockCreate.mockResolvedValue(makeCreateCredential());
		mockGet.mockResolvedValue(makeGetCredential([1, 2, 3, 4]));
		await Vault.setupBiometric("123456");
		Vault.lock();
		mockGet.mockResolvedValue({ getClientExtensionResults: () => ({}) });

		const result = await Vault.unlockWithBiometric();

		expect(result).toBe(false);
		expect(Vault.isUnlocked()).toBe(false);
	});
});

// ===========================================================================
// 15. disableBiometric()
// ===========================================================================
describe("disableBiometric()", () => {
	it("removes all 3 biometric keys from localStorage", async () => {
		await Vault.setup("123456");
		mockCreate.mockResolvedValue(makeCreateCredential());
		mockGet.mockResolvedValue(makeGetCredential());
		await Vault.setupBiometric("123456");
		expect(Vault.isBiometricEnabled()).toBe(true);
		Vault.disableBiometric();
		expect(localStorageData["fincoach-vault-biometric-cred"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-biometric-prf-salt"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-biometric-wrap"]).toBeUndefined();
		expect(localStorageData["fincoach-vault-biometric-wrapped"]).toBeUndefined();
		expect(Vault.isBiometricEnabled()).toBe(false);
	});
});

// ===========================================================================
// 16. setup() — 4-digit PIN rejection (PIN upgrade enforcement)
// ===========================================================================
describe("setup() — short PIN rejection", () => {
	it("rejects a 4-digit PIN with an appropriate error", async () => {
		await expect(Vault.setup("1234")).rejects.toThrow(
			"PIN must contain only digits and be at least 6 digits.",
		);
	});

	it("rejects a 5-digit PIN", async () => {
		await expect(Vault.setup("12345")).rejects.toThrow(
			"PIN must contain only digits and be at least 6 digits.",
		);
	});

	it("accepts a 6-digit PIN", async () => {
		await expect(Vault.setup("123456")).resolves.toBeUndefined();
	});
});

// ===========================================================================
// 17. requiresPinUpgrade()
// ===========================================================================
describe("requiresPinUpgrade()", () => {
	it("returns true when no VAULT_PIN_VERSION_KEY is in localStorage", () => {
		delete localStorageData["fincoach-vault-pin-version"];
		expect(Vault.requiresPinUpgrade()).toBe(true);
	});

	it("returns false after setup() with a 6-digit PIN", async () => {
		await Vault.setup("123456");
		expect(Vault.requiresPinUpgrade()).toBe(false);
	});

	it("returns true after clearCredentials() removes the version key", async () => {
		await Vault.setup("123456");
		expect(Vault.requiresPinUpgrade()).toBe(false);
		Vault.clearCredentials();
		expect(Vault.requiresPinUpgrade()).toBe(true);
	});

	it("returns true for a legacy vault set up before VAULT_PIN_VERSION_KEY existed", async () => {
		// Simulate legacy: vault is configured (has salt) but no version key
		await Vault.setup("123456");
		delete localStorageData["fincoach-vault-pin-version"];
		expect(Vault.isConfigured()).toBe(true);
		expect(Vault.requiresPinUpgrade()).toBe(true);
	});

	it("a legacy 4-digit numeric vault can still be unlocked (no lockout)", async () => {
		// Set up a 4-digit numeric vault the old way, without version key
		localStorageData["fincoach-vault-pin-kind"] = "numeric";
		// We need an actual vault configured with a 4-digit PIN.
		// Use the internal API directly: derive key and store sentinel.
		const pin = "1234";
		const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
		const keyMaterial = await globalThis.crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(pin),
			"PBKDF2",
			false,
			["deriveKey"],
		);
		const key = await globalThis.crypto.subtle.deriveKey(
			{ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
			keyMaterial,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"],
		);
		const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
		const ciphertext = await globalThis.crypto.subtle.encrypt(
			{ name: "AES-GCM", iv },
			key,
			new TextEncoder().encode("fincoach-vault-ok"),
		);
		const combined = new Uint8Array(12 + ciphertext.byteLength);
		combined.set(iv, 0);
		combined.set(new Uint8Array(ciphertext), 12);
		localStorageData["fincoach-vault-salt"] = btoa(String.fromCharCode(...salt));
		localStorageData["fincoach-vault-sentinel"] = btoa(String.fromCharCode(...combined));
		// No version key — simulates legacy vault
		delete localStorageData["fincoach-vault-pin-version"];

		expect(Vault.requiresPinUpgrade()).toBe(true);
		const ok = await Vault.unlock("1234");
		expect(ok).toBe(true);
		expect(Vault.isUnlocked()).toBe(true);
	});
});
