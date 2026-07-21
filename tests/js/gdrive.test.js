/**
 * Unit tests for static/js/gdrive.js — Google Drive sync layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------
let localStorageData = {};
globalThis.localStorage = {
	getItem: vi.fn((key) => localStorageData[key] ?? null),
	setItem: vi.fn((key, val) => {
		localStorageData[key] = val;
	}),
	removeItem: vi.fn((key) => {
		delete localStorageData[key];
	}),
	clear: vi.fn(() => {
		for (const k of Object.keys(localStorageData)) delete localStorageData[k];
	}),
};

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------
const mockDB = {
	exportAsJSON: vi.fn(),
	mergeFromJSON: vi.fn(),
};
vi.mock("../../static/js/db.js", () => ({ DB: mockDB, SCHEMA_VERSION: 1 }));

// ---------------------------------------------------------------------------
// Mock Gmail
// ---------------------------------------------------------------------------
const mockGmail = {
	_getValidToken: vi.fn(),
	getSettings: vi.fn(),
	saveSettings: vi.fn(),
	isConnected: vi.fn(),
	getAccountSub: vi.fn(),
};
vi.mock("../../static/js/gmail.js", () => ({ Gmail: mockGmail }));

// ---------------------------------------------------------------------------
// Mock AI
// ---------------------------------------------------------------------------
const mockAI = { getSettings: vi.fn(), saveSettings: vi.fn() };
vi.mock("../../static/js/ai.js", () => ({ AI: mockAI }));

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------
vi.mock("../../static/js/config.js", () => ({
	GDRIVE_SYNC_INTERVAL_MS: 3_600_000,
	GDRIVE_LAST_SYNC_KEY: "fincoach-gdrive-last-sync",
	GDRIVE_ENABLED_KEY: "fincoach-gdrive-enabled",
	GDRIVE_BACKUP_API_KEY_KEY: "fincoach-gdrive-backup-api-key",
	GDRIVE_SYNC_LOCK_KEY: "fincoach-gdrive-sync-lock",
	GMAIL_CUSTOM_SENDERS_KEY: "fincoach-gmail-custom-senders",
	GMAIL_AUTO_SYNC_ENABLED_KEY: "fincoach-gmail-auto-sync-enabled",
}));

// Mock fetch globally
globalThis.fetch = vi.fn();

// Now import GDrive (after mocks are set up)
const { GDrive } = await import("../../static/js/gdrive.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeEnvelopeResponse(envelope) {
	const json = JSON.stringify(envelope);
	const bytes = new TextEncoder().encode(json);
	// Pretend it's "encrypted" — for upload/download tests we spy on _encrypt/_decrypt
	return bytes;
}

function mockFetchOk(body, status = 200) {
	globalThis.fetch.mockResolvedValueOnce({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
	});
}

function mockFetchError(status, body = {}) {
	globalThis.fetch.mockResolvedValueOnce({
		ok: false,
		status,
		json: async () => body,
	});
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
	localStorageData = {};
	vi.resetAllMocks();
	// Re-set default mocks after reset
	mockGmail._getValidToken.mockResolvedValue("test-token");
	mockGmail.getSettings.mockReturnValue({ email: "test@gmail.com" });
	mockGmail.saveSettings.mockReturnValue(undefined);
	mockGmail.isConnected.mockReturnValue(true);
	mockGmail.getAccountSub.mockReturnValue("123456789");
	mockDB.exportAsJSON.mockResolvedValue({
		version: 1,
		schema_version: 1,
		exported_at: new Date().toISOString(),
		device_id: "dev-1",
		tables: {},
	});
	mockDB.mergeFromJSON.mockResolvedValue({
		inserted: { accounts: 0, categories: 0, transactions: 0 },
		skipped: { accounts: 0, categories: 0, transactions: 0 },
	});
	mockAI.getSettings.mockReturnValue({
		provider: null,
		apiKey: "",
		model: "",
		azureResourceName: "",
		azureDeploymentName: "",
		azureApiVersion: "",
		ollamaBaseUrl: "",
	});
	mockAI.saveSettings.mockResolvedValue({ ok: true, publicSaved: true, secretSaved: true });
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ===========================================================================
// 1. Encryption helpers
// ===========================================================================
describe("GDrive encryption", () => {
	it("_deriveKey returns a CryptoKey", async () => {
		const key = await GDrive._deriveKey("user@example.com");
		expect(key).toBeTruthy();
		expect(key.type).toBe("secret");
	});

	it("_encrypt/_decrypt roundtrip restores original bytes", async () => {
		const originalText = "hello world test data";
		const original = new TextEncoder().encode(originalText);
		const email = "user@example.com";
		const encrypted = await GDrive._encrypt(original, email);
		const decrypted = await GDrive._decrypt(encrypted, email);
		expect(new TextDecoder().decode(decrypted)).toBe(originalText);
	});

	it("decrypting with wrong email fails", async () => {
		const data = new TextEncoder().encode("sensitive data");
		const encrypted = await GDrive._encrypt(data, "user@example.com");
		await expect(GDrive._decrypt(encrypted, "other@example.com")).rejects.toThrow();
	});

	it("encrypt produces different ciphertext for the same plaintext (random IV)", async () => {
		const data = new TextEncoder().encode("same data");
		const enc1 = await GDrive._encrypt(data, "user@example.com");
		const enc2 = await GDrive._encrypt(data, "user@example.com");
		// IVs differ, so ciphertexts differ
		expect(enc1).not.toEqual(enc2);
	});
});

// ===========================================================================
// 1b. BUG-SEC-02 — per-user random PBKDF2 salt
// ===========================================================================
describe("GDrive encryption — BUG-SEC-02 per-user random salt", () => {
	it("_deriveKey accepts an explicit salt parameter and returns a CryptoKey", async () => {
		const salt = new Uint8Array(16);
		crypto.getRandomValues(salt);
		const key = await GDrive._deriveKey("user@example.com", salt);
		expect(key).toBeTruthy();
		expect(key.type).toBe("secret");
	});

	it("_encrypt output length is at least salt(16) + IV(12) + 1 byte ciphertext", async () => {
		const plainBytes = new TextEncoder().encode("x");
		const encrypted = await GDrive._encrypt(plainBytes, "user@example.com");
		// 16 (salt) + 12 (IV) + AES-GCM tag (16) + 1 byte payload = 45 minimum
		expect(encrypted.byteLength).toBeGreaterThanOrEqual(16 + 12 + 1);
	});

	it("_encrypt uses a random salt — first 16 bytes differ between two calls", async () => {
		const plainBytes = new TextEncoder().encode("hello");
		const enc1 = await GDrive._encrypt(plainBytes, "user@example.com");
		const enc2 = await GDrive._encrypt(plainBytes, "user@example.com");

		const salt1 = Array.from(enc1.slice(0, 16));
		const salt2 = Array.from(enc2.slice(0, 16));
		// Salts should differ (probability of collision is negligible)
		expect(salt1).not.toEqual(salt2);
	});

	it("_decrypt correctly reads salt from the header and decrypts (roundtrip)", async () => {
		const original = new TextEncoder().encode("round-trip test");
		const email = "salt-test@example.com";

		const encrypted = await GDrive._encrypt(original, email);
		const decrypted = await GDrive._decrypt(encrypted, email);

		expect(new TextDecoder().decode(decrypted)).toBe("round-trip test");
	});

	it("_decrypt fails on old format buffer (no salt header)", async () => {
		// Old format: [IV 12 bytes][ciphertext].
		// New _decrypt reads: salt=bytes[0..16), IV=bytes[16..28), ciphertext=bytes[28+).
		// Random bytes won't form a valid AES-GCM ciphertext, so decryption must throw.
		const fakeOldFormat = new Uint8Array(48);
		crypto.getRandomValues(fakeOldFormat);

		await expect(GDrive._decrypt(fakeOldFormat, "user@example.com")).rejects.toThrow();
	});
});

// ===========================================================================
// 2. localStorage helpers
// ===========================================================================
describe("GDrive localStorage helpers", () => {
	it("isEnabled returns false when key not set", () => {
		expect(GDrive.isEnabled()).toBe(false);
	});

	it("setEnabled(true) stores 'true'", () => {
		GDrive.setEnabled(true);
		expect(localStorageData["fincoach-gdrive-enabled"]).toBe("true");
		expect(GDrive.isEnabled()).toBe(true);
	});

	it("setEnabled(false) removes the key", () => {
		localStorageData["fincoach-gdrive-enabled"] = "true";
		GDrive.setEnabled(false);
		expect(localStorageData["fincoach-gdrive-enabled"]).toBeUndefined();
		expect(GDrive.isEnabled()).toBe(false);
	});

	it("getLastSyncTime returns null when not set", () => {
		expect(GDrive.getLastSyncTime()).toBeNull();
	});

	it("getLastSyncTime returns stored value", () => {
		localStorageData["fincoach-gdrive-last-sync"] = "2025-01-01T00:00:00.000Z";
		expect(GDrive.getLastSyncTime()).toBe("2025-01-01T00:00:00.000Z");
	});

	it("_acquireLock returns true when no lock held", () => {
		expect(GDrive._acquireLock()).toBe(true);
		expect(localStorageData["fincoach-gdrive-sync-lock"]).toBeTruthy();
	});

	it("_acquireLock returns false when lock is fresh", () => {
		localStorageData["fincoach-gdrive-sync-lock"] = JSON.stringify({ timestamp: Date.now() });
		expect(GDrive._acquireLock()).toBe(false);
	});

	it("_acquireLock returns true when lock is expired", () => {
		localStorageData["fincoach-gdrive-sync-lock"] = JSON.stringify({
			timestamp: Date.now() - 200_000, // 200s > 120s timeout
		});
		expect(GDrive._acquireLock()).toBe(true);
	});

	it("_releaseLock removes the lock key", () => {
		localStorageData["fincoach-gdrive-sync-lock"] = JSON.stringify({ timestamp: Date.now() });
		GDrive._releaseLock();
		expect(localStorageData["fincoach-gdrive-sync-lock"]).toBeUndefined();
	});
});

// ===========================================================================
// 3. _findBackupFileId
// ===========================================================================
describe("GDrive._findBackupFileId", () => {
	it("returns null when files array is empty", async () => {
		mockFetchOk({ files: [] });
		const id = await GDrive._findBackupFileId();
		expect(id).toBeNull();
	});

	it("returns file ID when file exists on Drive", async () => {
		mockFetchOk({ files: [{ id: "abc123", name: "fincoach-backup.enc" }] });
		const id = await GDrive._findBackupFileId();
		expect(id).toBe("abc123");
	});

	it("throws 'Drive access revoked' on 401", async () => {
		mockFetchError(401);
		await expect(GDrive._findBackupFileId()).rejects.toThrow("Drive access revoked");
	});

	it("throws reconnect message on 403 insufficientPermissions", async () => {
		mockFetchError(403, {
			error: { errors: [{ reason: "insufficientPermissions" }] },
		});
		await expect(GDrive._findBackupFileId()).rejects.toThrow(
			"Please reconnect your Google account",
		);
	});

	it("throws quota message on 403 storageQuotaExceeded", async () => {
		mockFetchError(403, {
			error: { errors: [{ reason: "storageQuotaExceeded" }] },
		});
		await expect(GDrive._findBackupFileId()).rejects.toThrow(
			"Google Drive quota exceeded",
		);
	});
});

// ===========================================================================
// 4. upload
// ===========================================================================
describe("GDrive.upload", () => {
	beforeEach(() => {
		vi.spyOn(GDrive, "_encrypt").mockResolvedValue(new Uint8Array([1, 2, 3]));
	});

	it("calls PATCH when backup file already exists", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("existing-id");
		mockFetchOk({}, 200); // PATCH response

		await GDrive.upload();

		const patchCall = globalThis.fetch.mock.calls[0];
		expect(patchCall[0]).toContain("/existing-id?uploadType=media");
		expect(patchCall[1].method).toBe("PATCH");
	});

	it("calls POST multipart when no backup file exists", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		mockFetchOk({ id: "new-file-id" }, 200); // POST response

		await GDrive.upload();

		const postCall = globalThis.fetch.mock.calls[0];
		expect(postCall[0]).toContain("uploadType=multipart");
		expect(postCall[1].method).toBe("POST");
		expect(postCall[1].headers["Content-Type"]).toContain("multipart/related");
	});

	it("throws on 401 during PATCH", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("existing-id");
		mockFetchError(401);
		await expect(GDrive.upload()).rejects.toThrow("Drive access revoked");
	});

	it("throws on 403 during POST", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		mockFetchError(403);
		await expect(GDrive.upload()).rejects.toThrow("Google Drive quota exceeded");
	});
});

// ===========================================================================
// 5. download
// ===========================================================================
describe("GDrive.download", () => {
	it("returns null when no backup file on Drive", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		const result = await GDrive.download();
		expect(result).toBeNull();
	});

	it("returns parsed envelope after decrypt", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		const envelope = { version: 1, schema_version: 1, tables: {} };
		const plainBytes = new TextEncoder().encode(JSON.stringify(envelope));
		const email = "test@gmail.com";
		const sub = "123456789";
		const encBytes = await GDrive._encrypt(plainBytes, email, sub);
		vi.spyOn(GDrive, "_getKeyMaterial").mockResolvedValue({ email, sub });
		globalThis.fetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({}),
			arrayBuffer: async () => encBytes.buffer,
		});

		const result = await GDrive.download();
		expect(result).toEqual(envelope);
	});

	it("throws 'Drive access revoked' on 401", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		mockFetchError(401);
		await expect(GDrive.download()).rejects.toThrow("Drive access revoked");
	});

	it("throws on download failure", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		mockFetchError(500);
		await expect(GDrive.download()).rejects.toThrow("Drive download failed");
	});
});

// ===========================================================================
// 6. sync
// ===========================================================================
describe("GDrive.sync", () => {
	beforeEach(() => {
		vi.spyOn(GDrive, "_encrypt").mockResolvedValue(new Uint8Array([1, 2, 3]));
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		// upload: POST multipart
		globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
	});

	it("throws 'Sync already in progress' when lock is held", async () => {
		localStorageData["fincoach-gdrive-sync-lock"] = JSON.stringify({ timestamp: Date.now() });
		await expect(GDrive.sync()).rejects.toThrow("Sync already in progress");
	});

	it("full sync: download null → skip merge → upload → sets last sync", async () => {
		vi.spyOn(GDrive, "download").mockResolvedValue(null);
		vi.spyOn(GDrive, "upload").mockResolvedValue(undefined);

		const result = await GDrive.sync();

		expect(GDrive.download).toHaveBeenCalled();
		expect(mockDB.mergeFromJSON).not.toHaveBeenCalled();
		expect(GDrive.upload).toHaveBeenCalled();
		expect(result.stats).toBeNull();
		expect(localStorageData["fincoach-gdrive-last-sync"]).toBeTruthy();
	});

	it("full sync: download envelope → merge → upload", async () => {
		const envelope = { version: 1, schema_version: 1, tables: {} };
		vi.spyOn(GDrive, "download").mockResolvedValue(envelope);
		vi.spyOn(GDrive, "upload").mockResolvedValue(undefined);
		const mergeResult = { inserted: { accounts: 2 }, skipped: {} };
		mockDB.mergeFromJSON.mockResolvedValue(mergeResult);

		const result = await GDrive.sync();

		expect(mockDB.mergeFromJSON).toHaveBeenCalledWith(envelope);
		expect(result.stats).toEqual(mergeResult);
		expect(localStorageData["fincoach-gdrive-last-sync"]).toBeTruthy();
	});

	it("releases lock after successful sync", async () => {
		vi.spyOn(GDrive, "download").mockResolvedValue(null);
		vi.spyOn(GDrive, "upload").mockResolvedValue(undefined);

		await GDrive.sync();

		expect(localStorageData["fincoach-gdrive-sync-lock"]).toBeUndefined();
	});

	it("releases lock even when sync throws", async () => {
		vi.spyOn(GDrive, "download").mockRejectedValue(new Error("Network failure"));

		await expect(GDrive.sync()).rejects.toThrow("Network failure");
		expect(localStorageData["fincoach-gdrive-sync-lock"]).toBeUndefined();
	});

	it("wraps TypeError (network blocked) from download when online", async () => {
		vi.spyOn(GDrive, "download").mockRejectedValue(new TypeError("Failed to fetch"));
		Object.defineProperty(navigator, "onLine", { value: true, configurable: true });

		await expect(GDrive.sync()).rejects.toThrow("Drive request blocked");
	});

	it("wraps TypeError (network offline) from download when offline", async () => {
		vi.spyOn(GDrive, "download").mockRejectedValue(new TypeError("Failed to fetch"));
		Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

		await expect(GDrive.sync()).rejects.toThrow("Network offline");
		Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
	});

	it("wraps TypeError (network blocked) from upload when online", async () => {
		vi.spyOn(GDrive, "download").mockResolvedValue(null);
		vi.spyOn(GDrive, "upload").mockRejectedValue(new TypeError("Failed to fetch"));
		Object.defineProperty(navigator, "onLine", { value: true, configurable: true });

		await expect(GDrive.sync()).rejects.toThrow("Drive request blocked");
	});

	it("wraps TypeError (network offline) from upload when offline", async () => {
		vi.spyOn(GDrive, "download").mockResolvedValue(null);
		vi.spyOn(GDrive, "upload").mockRejectedValue(new TypeError("Failed to fetch"));
		Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

		await expect(GDrive.sync()).rejects.toThrow("Network offline");
		Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
	});
});

// ===========================================================================
// 7. maybeAutoSync
// ===========================================================================
describe("GDrive.maybeAutoSync", () => {
	beforeEach(() => {
		vi.spyOn(GDrive, "sync").mockResolvedValue({ stats: null, uploadedAt: new Date().toISOString() });
	});

	it("no-ops when drive sync is not enabled", async () => {
		GDrive.setEnabled(false);
		await GDrive.maybeAutoSync();
		expect(GDrive.sync).not.toHaveBeenCalled();
	});

	it("no-ops when Gmail is not connected", async () => {
		GDrive.setEnabled(true);
		mockGmail.isConnected.mockReturnValue(false);
		await GDrive.maybeAutoSync();
		expect(GDrive.sync).not.toHaveBeenCalled();
	});

	it("no-ops when last sync was within cooldown window", async () => {
		GDrive.setEnabled(true);
		// Set last sync to 10 minutes ago (well within 1 hour cooldown)
		const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		localStorageData["fincoach-gdrive-last-sync"] = tenMinutesAgo;

		await GDrive.maybeAutoSync();
		expect(GDrive.sync).not.toHaveBeenCalled();
	});

	it("calls sync when enabled, connected, and cooldown has elapsed", async () => {
		GDrive.setEnabled(true);
		// No last sync time = never synced
		await GDrive.maybeAutoSync();
		expect(GDrive.sync).toHaveBeenCalled();
	});

	it("calls sync when last sync was > 1 hour ago", async () => {
		GDrive.setEnabled(true);
		const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
		localStorageData["fincoach-gdrive-last-sync"] = twoHoursAgo;

		await GDrive.maybeAutoSync();
		expect(GDrive.sync).toHaveBeenCalled();
	});

	it("swallows errors from sync without rethrowing", async () => {
		GDrive.setEnabled(true);
		GDrive.sync.mockRejectedValue(new Error("Drive error"));

		await expect(GDrive.maybeAutoSync()).resolves.toBeUndefined();
	});
});

// ===========================================================================
// 8. _getEmail
// ===========================================================================
describe("GDrive._getEmail", () => {
	it("returns email from Gmail settings cache without fetching", async () => {
		mockGmail.getSettings.mockReturnValue({ email: "cached@example.com" });
		const email = await GDrive._getEmail();
		expect(email).toBe("cached@example.com");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("fetches email from Google profile API when not in settings", async () => {
		mockGmail.getSettings.mockReturnValue({}); // no email cached
		mockFetchOk({ emailAddress: "fetched@example.com" });
		const email = await GDrive._getEmail();
		expect(email).toBe("fetched@example.com");
		expect(mockGmail.saveSettings).toHaveBeenCalledWith({ email: "fetched@example.com" });
	});

	it("throws when Google profile API returns non-OK response", async () => {
		mockGmail.getSettings.mockReturnValue({});
		mockFetchError(401);
		await expect(GDrive._getEmail()).rejects.toThrow("Failed to fetch Google account info");
	});
});

// ===========================================================================
// 9. _findBackupFileId — additional error cases
// ===========================================================================
describe("GDrive._findBackupFileId additional error cases", () => {
	it("throws Drive API error message on 403 with accessNotConfigured reason", async () => {
		mockFetchError(403, {
			error: { errors: [{ reason: "accessNotConfigured" }] },
		});
		await expect(GDrive._findBackupFileId()).rejects.toThrow(
			"Google Drive API is not enabled",
		);
	});

	it("throws generic Drive API error on 403 with unknown reason", async () => {
		mockFetchError(403, {
			error: { errors: [{ reason: "unknownReason" }] },
		});
		await expect(GDrive._findBackupFileId()).rejects.toThrow("Drive API error: 403");
	});

	it("throws generic Drive API error on 500", async () => {
		mockFetchError(500);
		await expect(GDrive._findBackupFileId()).rejects.toThrow("Drive API error: 500");
	});
});

// ===========================================================================
// 10. getLastModified
// ===========================================================================
describe("GDrive.getLastModified", () => {
	it("returns null when no backup file exists on Drive", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		const result = await GDrive.getLastModified();
		expect(result).toBeNull();
	});

	it("returns modifiedTime string when file exists", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id-123");
		mockFetchOk({ modifiedTime: "2025-01-15T10:30:00.000Z" });
		const result = await GDrive.getLastModified();
		expect(result).toBe("2025-01-15T10:30:00.000Z");
	});

	it("returns null when modifiedTime is missing from response", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id-123");
		mockFetchOk({}); // no modifiedTime in response
		const result = await GDrive.getLastModified();
		expect(result).toBeNull();
	});

	it("returns null when fetch fails", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id-123");
		mockFetchError(500);
		const result = await GDrive.getLastModified();
		expect(result).toBeNull();
	});
});

// ===========================================================================
// 11. upload — additional coverage
// ===========================================================================
describe("GDrive.upload additional coverage", () => {
	beforeEach(() => {
		vi.spyOn(GDrive, "_encrypt").mockResolvedValue(new Uint8Array([1, 2, 3]));
	});

	it("throws on 401 during POST (new file)", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		mockFetchError(401);
		await expect(GDrive.upload()).rejects.toThrow("Drive access revoked");
	});

	it("throws on non-OK status during PATCH", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("existing-id");
		mockFetchError(503);
		await expect(GDrive.upload()).rejects.toThrow("Drive upload failed: 503");
	});

	it("throws on non-OK status during POST", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		mockFetchError(503);
		await expect(GDrive.upload()).rejects.toThrow("Drive upload failed: 503");
	});

	it("PATCH request includes Authorization header with token", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("existing-id");
		mockFetchOk({}, 200);
		await GDrive.upload();
		const patchCall = globalThis.fetch.mock.calls[0];
		expect(patchCall[1].headers.Authorization).toBe("Bearer test-token");
	});

	it("POST request includes Authorization header with token", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		mockFetchOk({ id: "new-id" }, 200);
		await GDrive.upload();
		const postCall = globalThis.fetch.mock.calls[0];
		expect(postCall[1].headers.Authorization).toBe("Bearer test-token");
	});
});

// ===========================================================================
// 12. sync — additional coverage
// ===========================================================================
describe("GDrive.sync additional coverage", () => {
	beforeEach(() => {
		vi.spyOn(GDrive, "_encrypt").mockResolvedValue(new Uint8Array([1, 2, 3]));
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
	});

	it("sync result uploadedAt is a UTC ISO 8601 string", async () => {
		vi.spyOn(GDrive, "download").mockResolvedValue(null);
		vi.spyOn(GDrive, "upload").mockResolvedValue(undefined);

		const result = await GDrive.sync();

		// uploadedAt must be a valid UTC ISO string (ends with Z)
		expect(result.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
	});

	it("sync stores uploadedAt in localStorage as ISO string", async () => {
		vi.spyOn(GDrive, "download").mockResolvedValue(null);
		vi.spyOn(GDrive, "upload").mockResolvedValue(undefined);

		await GDrive.sync();

		const stored = localStorageData["fincoach-gdrive-last-sync"];
		expect(stored).toBeTruthy();
		expect(new Date(stored).getTime()).not.toBeNaN();
	});

	it("sync with download envelope returns merge stats", async () => {
		const envelope = { version: 1, schema_version: 1, tables: {} };
		const mergeStats = {
			inserted: { accounts: 3, categories: 0, transactions: 5 },
			skipped: { accounts: 1, categories: 20, transactions: 2 },
		};
		vi.spyOn(GDrive, "download").mockResolvedValue(envelope);
		vi.spyOn(GDrive, "upload").mockResolvedValue(undefined);
		mockDB.mergeFromJSON.mockResolvedValue(mergeStats);

		const result = await GDrive.sync();

		expect(result.stats).toEqual(mergeStats);
		expect(mockDB.mergeFromJSON).toHaveBeenCalledWith(envelope);
	});

	it("sync re-throws non-TypeError download errors", async () => {
		vi.spyOn(GDrive, "download").mockRejectedValue(new Error("Auth expired"));

		await expect(GDrive.sync()).rejects.toThrow("Auth expired");
	});

	it("sync re-throws non-TypeError upload errors", async () => {
		vi.spyOn(GDrive, "download").mockResolvedValue(null);
		vi.spyOn(GDrive, "upload").mockRejectedValue(new Error("Quota exceeded"));

		await expect(GDrive.sync()).rejects.toThrow("Quota exceeded");
	});
});

// ===========================================================================
// 13. download — additional coverage
// ===========================================================================
describe("GDrive.download additional coverage", () => {
	it("passes correct Authorization header to Drive files API", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("dl-file-id");
		const envelope = { version: 1, tables: {} };
		const plainBytes = new TextEncoder().encode(JSON.stringify(envelope));
		const email = "test@gmail.com";
		const sub = "123456789";
		const encBytes = await GDrive._encrypt(plainBytes, email, sub);
		vi.spyOn(GDrive, "_getKeyMaterial").mockResolvedValue({ email, sub });
		globalThis.fetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({}),
			arrayBuffer: async () => encBytes.buffer,
		});

		await GDrive.download();

		const fetchCall = globalThis.fetch.mock.calls[0];
		expect(fetchCall[0]).toContain("dl-file-id?alt=media");
		expect(fetchCall[1].headers.Authorization).toBe("Bearer test-token");
	});

	it("throws 'Drive download failed' on non-401 HTTP error", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		mockFetchError(503);
		await expect(GDrive.download()).rejects.toThrow("Drive download failed: 503");
	});
});

// ===========================================================================
// 14. deleteBackup
// ===========================================================================
describe("GDrive.deleteBackup", () => {
	it("throws 'No backup found' when no file exists on Drive", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		await expect(GDrive.deleteBackup()).rejects.toThrow("No backup found in Google Drive");
	});

	it("calls DELETE on the correct file URL with Authorization header", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("del-file-id");
		globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 204 });

		await GDrive.deleteBackup();

		const [url, opts] = globalThis.fetch.mock.calls[0];
		expect(url).toContain("/del-file-id");
		expect(opts.method).toBe("DELETE");
		expect(opts.headers.Authorization).toBe("Bearer test-token");
	});

	it("resolves successfully on HTTP 204", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 204 });

		await expect(GDrive.deleteBackup()).resolves.toBeUndefined();
	});

	it("resolves successfully on HTTP 200", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200 });

		await expect(GDrive.deleteBackup()).resolves.toBeUndefined();
	});

	it("throws 'Drive access revoked' on 401", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		mockFetchError(401);
		await expect(GDrive.deleteBackup()).rejects.toThrow("Drive access revoked");
	});

	it("throws 'Backup file not found' on 404", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		mockFetchError(404);
		await expect(GDrive.deleteBackup()).rejects.toThrow("Backup file not found in Google Drive");
	});

	it("throws 'Drive delete failed' on other non-OK status", async () => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		mockFetchError(500);
		await expect(GDrive.deleteBackup()).rejects.toThrow("Drive delete failed: 500");
	});
});

// ===========================================================================
// 15. upload — settings in envelope
// ===========================================================================
describe("GDrive.upload — settings in envelope", () => {
	beforeEach(() => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
	});

	it("upload() includes non-sensitive settings in envelope", async () => {
		mockAI.getSettings.mockReturnValue({
			provider: "openai",
			apiKey: "sk-secret",
			model: "gpt-4o",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});

		let capturedBytes = null;
		vi.spyOn(GDrive, "_encrypt").mockImplementation(async (bytes) => {
			capturedBytes = bytes;
			return bytes;
		});

		await GDrive.upload();

		const decoded = JSON.parse(new TextDecoder().decode(capturedBytes));
		expect(decoded.settings).toBeDefined();
		expect(decoded.settings.provider).toBe("openai");
		expect(decoded.settings.model).toBe("gpt-4o");
		expect(decoded.settings.azureResourceName).toBe("");
		expect(decoded.settings.apiKey).toBeUndefined();
	});

	it("upload() includes apiKey in envelope when opt-in is enabled", async () => {
		localStorageData["fincoach-gdrive-backup-api-key"] = "true";
		mockAI.getSettings.mockReturnValue({
			provider: "openai",
			apiKey: "sk-mysecret",
			model: "gpt-4o",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});

		let capturedBytes = null;
		vi.spyOn(GDrive, "_encrypt").mockImplementation(async (bytes) => {
			capturedBytes = bytes;
			return bytes;
		});

		await GDrive.upload();

		const decoded = JSON.parse(new TextDecoder().decode(capturedBytes));
		expect(decoded.settings.apiKey).toBe("sk-mysecret");
	});

	it("upload() excludes apiKey when opt-in is off", async () => {
		// No opt-in flag set
		mockAI.getSettings.mockReturnValue({
			provider: "openai",
			apiKey: "sk-secret",
			model: "gpt-4o",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});

		let capturedBytes = null;
		vi.spyOn(GDrive, "_encrypt").mockImplementation(async (bytes) => {
			capturedBytes = bytes;
			return bytes;
		});

		await GDrive.upload();

		const decoded = JSON.parse(new TextDecoder().decode(capturedBytes));
		expect(decoded.settings.apiKey).toBeUndefined();
	});
});

// ===========================================================================
// 16. _restoreSettings
// ===========================================================================
describe("GDrive._restoreSettings", () => {
	it("returns early when envelope is null", async () => {
		const result = await GDrive._restoreSettings(null);
		expect(result).toEqual({ apiKeyRestored: false, apiKeySkipped: false });
		expect(mockAI.saveSettings).not.toHaveBeenCalled();
	});

	it("returns early when envelope has no settings field", async () => {
		const result = await GDrive._restoreSettings({ version: 1, tables: {} });
		expect(result).toEqual({ apiKeyRestored: false, apiKeySkipped: false });
		expect(mockAI.saveSettings).not.toHaveBeenCalled();
	});

	it("merges non-sensitive fields when local values are empty", async () => {
		mockAI.getSettings.mockReturnValue({
			provider: null,
			apiKey: "",
			model: "",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});
		const envelope = {
			settings: {
				provider: "openai",
				model: "gpt-4o",
				azureResourceName: "",
				azureDeploymentName: "",
				azureApiVersion: "",
				ollamaBaseUrl: "",
			},
		};
		await GDrive._restoreSettings(envelope);
		expect(mockAI.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "openai", model: "gpt-4o" }),
		);
	});

	it("does NOT overwrite already-set local provider/model", async () => {
		mockAI.getSettings.mockReturnValue({
			provider: "groq",
			apiKey: "",
			model: "llama3",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});
		const envelope = {
			settings: {
				provider: "openai",
				model: "gpt-4o",
				azureResourceName: "",
				azureDeploymentName: "",
				azureApiVersion: "",
				ollamaBaseUrl: "",
			},
		};
		await GDrive._restoreSettings(envelope);
		// Nothing changed (local already has provider+model), so saveSettings not called
		expect(mockAI.saveSettings).not.toHaveBeenCalled();
	});

	it("restores apiKey when envelope has it and local is empty → apiKeyRestored: true", async () => {
		mockAI.getSettings.mockReturnValue({
			provider: "openai",
			apiKey: "",
			model: "gpt-4o",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});
		const envelope = {
			settings: {
				provider: "openai",
				model: "gpt-4o",
				apiKey: "sk-backed-key",
				azureResourceName: "",
				azureDeploymentName: "",
				azureApiVersion: "",
				ollamaBaseUrl: "",
			},
		};
		const result = await GDrive._restoreSettings(envelope);
		expect(result.apiKeyRestored).toBe(true);
		expect(result.apiKeySkipped).toBe(false);
		expect(mockAI.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "openai", model: "gpt-4o" }),
		);
		expect(localStorage.setItem).toHaveBeenCalledWith("fincoach-gdrive-backup-api-key", "true");
	});

	it("does NOT restore apiKey when local apiKey is already set → apiKeyRestored: false", async () => {
		mockAI.getSettings.mockReturnValue({
			provider: "openai",
			apiKey: "sk-existing",
			model: "gpt-4o",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});
		const envelope = {
			settings: {
				provider: "openai",
				model: "gpt-4o",
				apiKey: "sk-backed-key",
				azureResourceName: "",
				azureDeploymentName: "",
				azureApiVersion: "",
				ollamaBaseUrl: "",
			},
		};
		const result = await GDrive._restoreSettings(envelope);
		expect(result.apiKeyRestored).toBe(false);
		// local already had all same values (provider, model set) and apiKey was not overwritten
		// saveSettings should not have been called since nothing changed
		expect(mockAI.saveSettings).not.toHaveBeenCalled();
		// GDRIVE_BACKUP_API_KEY_KEY is NOT set — the API key was not freshly restored
		// and backed.backupApiKeyEnabled is not explicitly false, so the checkbox is untouched
		expect(localStorage.setItem).not.toHaveBeenCalledWith("fincoach-gdrive-backup-api-key", "true");
	});

	it("does NOT set GDRIVE_BACKUP_API_KEY_KEY when backed.apiKey is absent", async () => {
		mockAI.getSettings.mockReturnValue({
			provider: null,
			apiKey: "",
			model: "",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});
		const envelope = {
			settings: {
				provider: "groq",
				model: "llama3",
				// apiKey intentionally absent
				azureResourceName: "",
				azureDeploymentName: "",
				azureApiVersion: "",
				ollamaBaseUrl: "",
			},
		};
		const result = await GDrive._restoreSettings(envelope);
		expect(result.apiKeyRestored).toBe(false);
		expect(result.apiKeySkipped).toBe(false);
		expect(localStorage.setItem).not.toHaveBeenCalledWith("fincoach-gdrive-backup-api-key", "true");
	});

	it("does NOT remove GDRIVE_BACKUP_API_KEY_KEY when backed.backupApiKeyEnabled is false (preference is per-device)", async () => {
		mockAI.getSettings.mockReturnValue({
			provider: "openai",
			apiKey: "sk-existing",
			model: "gpt-4o",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});
		const envelope = {
			settings: {
				provider: "openai",
				model: "gpt-4o",
				backupApiKeyEnabled: false, // another browser opted out
				azureResourceName: "",
				azureDeploymentName: "",
				azureApiVersion: "",
				ollamaBaseUrl: "",
			},
		};
		await GDrive._restoreSettings(envelope);
		// Per-device preference: opt-out from another browser must NOT affect this browser
		expect(localStorage.removeItem).not.toHaveBeenCalledWith("fincoach-gdrive-backup-api-key");
	});

	it("does NOT call AI.saveSettings when nothing changed", async () => {
		mockAI.getSettings.mockReturnValue({
			provider: "openai",
			apiKey: "sk-existing",
			model: "gpt-4o",
			azureResourceName: "my-resource",
			azureDeploymentName: "my-deployment",
			azureApiVersion: "2024-12-01-preview",
			ollamaBaseUrl: "http://localhost:11434",
		});
		const envelope = {
			settings: {
				provider: "openai",
				model: "gpt-4o",
				azureResourceName: "my-resource",
				azureDeploymentName: "my-deployment",
				azureApiVersion: "2024-12-01-preview",
				ollamaBaseUrl: "http://localhost:11434",
			},
		};
		await GDrive._restoreSettings(envelope);
		expect(mockAI.saveSettings).not.toHaveBeenCalled();
	});

	it("reports apiKeySkipped when the restored key is blocked by vault-only storage", async () => {
		mockAI.getSettings.mockReturnValue({
			provider: "openai",
			apiKey: "",
			model: "gpt-4o",
			azureResourceName: "",
			azureDeploymentName: "",
			azureApiVersion: "",
			ollamaBaseUrl: "",
		});
		mockAI.saveSettings.mockResolvedValueOnce({
			ok: false,
			publicSaved: true,
			secretSaved: false,
			vaultRequired: true,
		});
		const envelope = {
			settings: {
				provider: "openai",
				model: "gpt-4o",
				apiKey: "«reda...…»",
				azureResourceName: "",
				azureDeploymentName: "",
				azureApiVersion: "",
				ollamaBaseUrl: "",
			},
		};

		const result = await GDrive._restoreSettings(envelope);

		expect(result).toEqual({ apiKeyRestored: false, apiKeySkipped: true });
		expect(localStorage.setItem).not.toHaveBeenCalledWith("fincoach-gdrive-backup-api-key", "true");
	});
});

// ===========================================================================
// 17. sync — settings restore
// ===========================================================================
describe("GDrive.sync — settings restore", () => {
	beforeEach(() => {
		vi.spyOn(GDrive, "_encrypt").mockResolvedValue(new Uint8Array([1, 2, 3]));
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
	});

	it("sync() calls _restoreSettings with the downloaded envelope", async () => {
		const envelope = { version: 1, schema_version: 1, tables: {}, settings: { provider: "openai" } };
		vi.spyOn(GDrive, "download").mockResolvedValue(envelope);
		vi.spyOn(GDrive, "upload").mockResolvedValue(undefined);
		const restoreSpy = vi
			.spyOn(GDrive, "_restoreSettings")
			.mockResolvedValue({ apiKeyRestored: false, apiKeySkipped: false });

		await GDrive.sync();

		expect(restoreSpy).toHaveBeenCalledWith(envelope);
	});

	it("sync() returns settingsRestored in result", async () => {
		const envelope = { version: 1, schema_version: 1, tables: {}, settings: { provider: "groq" } };
		vi.spyOn(GDrive, "download").mockResolvedValue(envelope);
		vi.spyOn(GDrive, "upload").mockResolvedValue(undefined);
		vi.spyOn(GDrive, "_restoreSettings").mockResolvedValue({
			apiKeyRestored: true,
			apiKeySkipped: false,
		});

		const result = await GDrive.sync();

		expect(result.settingsRestored).toEqual({ apiKeyRestored: true, apiKeySkipped: false });
	});

	it("sync() returns apiKeyRestored: false when envelope is null (no remote backup)", async () => {
		vi.spyOn(GDrive, "download").mockResolvedValue(null);
		vi.spyOn(GDrive, "upload").mockResolvedValue(undefined);
		const restoreSpy = vi
			.spyOn(GDrive, "_restoreSettings")
			.mockResolvedValue({ apiKeyRestored: false, apiKeySkipped: false });

		const result = await GDrive.sync();

		expect(restoreSpy).toHaveBeenCalledWith(null);
		expect(result.settingsRestored).toEqual({ apiKeyRestored: false, apiKeySkipped: false });
	});
});

// ===========================================================================
// 18. upload — gmailCustomSenders in settings
// ===========================================================================
describe("GDrive.upload — gmailCustomSenders in settings", () => {
	beforeEach(() => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
	});

	it("includes gmailCustomSenders in settings when key is present", async () => {
		localStorageData["fincoach-gmail-custom-senders"] = '["alerts@sbi.co.in"]';

		let capturedBytes = null;
		vi.spyOn(GDrive, "_encrypt").mockImplementation(async (bytes) => {
			capturedBytes = bytes;
			return bytes;
		});

		await GDrive.upload();

		const decoded = JSON.parse(new TextDecoder().decode(capturedBytes));
		expect(decoded.settings.gmailCustomSenders).toBe('["alerts@sbi.co.in"]');
	});

	it("omits gmailCustomSenders from settings when key is absent", async () => {
		// Ensure key is not present
		delete localStorageData["fincoach-gmail-custom-senders"];

		let capturedBytes = null;
		vi.spyOn(GDrive, "_encrypt").mockImplementation(async (bytes) => {
			capturedBytes = bytes;
			return bytes;
		});

		await GDrive.upload();

		const decoded = JSON.parse(new TextDecoder().decode(capturedBytes));
		expect(decoded.settings.gmailCustomSenders).toBeUndefined();
	});
});

// ===========================================================================
// 20. upload — gmailAutoSyncEnabled in settings
// ===========================================================================
describe("GDrive.upload — gmailAutoSyncEnabled in settings", () => {
	beforeEach(() => {
		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue(null);
		globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
	});

	it("includes gmailAutoSyncEnabled: true in settings when key is 'true'", async () => {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";

		let capturedBytes = null;
		vi.spyOn(GDrive, "_encrypt").mockImplementation(async (bytes) => {
			capturedBytes = bytes;
			return bytes;
		});

		await GDrive.upload();

		const decoded = JSON.parse(new TextDecoder().decode(capturedBytes));
		expect(decoded.settings.gmailAutoSyncEnabled).toBe(true);
	});

	it("omits gmailAutoSyncEnabled from settings when key is absent", async () => {
		delete localStorageData["fincoach-gmail-auto-sync-enabled"];

		let capturedBytes = null;
		vi.spyOn(GDrive, "_encrypt").mockImplementation(async (bytes) => {
			capturedBytes = bytes;
			return bytes;
		});

		await GDrive.upload();

		const decoded = JSON.parse(new TextDecoder().decode(capturedBytes));
		expect(decoded.settings.gmailAutoSyncEnabled).toBeUndefined();
	});
});

// ===========================================================================
// 19. _restoreSettings — gmailCustomSenders
// ===========================================================================
describe("GDrive._restoreSettings — gmailCustomSenders", () => {
	it("restores gmailCustomSenders when absent locally", () => {
		// Ensure key is not present locally
		delete localStorageData["fincoach-gmail-custom-senders"];

		const envelope = { settings: { gmailCustomSenders: '["alerts@sbi.co.in"]' } };
		GDrive._restoreSettings(envelope);

		expect(localStorage.setItem).toHaveBeenCalledWith(
			"fincoach-gmail-custom-senders",
			'["alerts@sbi.co.in"]',
		);
	});

	it("does not overwrite existing gmailCustomSenders", () => {
		localStorageData["fincoach-gmail-custom-senders"] = '["existing@bank.com"]';

		const envelope = { settings: { gmailCustomSenders: '["new@bank.com"]' } };
		GDrive._restoreSettings(envelope);

		expect(localStorageData["fincoach-gmail-custom-senders"]).toBe('["existing@bank.com"]');
	});
});

// ===========================================================================
// 21. _restoreSettings — gmailAutoSyncEnabled
// ===========================================================================
describe("GDrive._restoreSettings — gmailAutoSyncEnabled", () => {
	it("restores gmailAutoSyncEnabled when backed is true and key is absent locally", () => {
		delete localStorageData["fincoach-gmail-auto-sync-enabled"];

		const envelope = { settings: { gmailAutoSyncEnabled: true } };
		GDrive._restoreSettings(envelope);

		expect(localStorage.setItem).toHaveBeenCalledWith(
			"fincoach-gmail-auto-sync-enabled",
			"true",
		);
	});

	it("does not overwrite existing local gmailAutoSyncEnabled key", () => {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";

		const envelope = { settings: { gmailAutoSyncEnabled: true } };
		GDrive._restoreSettings(envelope);

		// setItem should NOT have been called with the key (it was already set)
		const calls = localStorage.setItem.mock.calls.filter(
			([k]) => k === "fincoach-gmail-auto-sync-enabled",
		);
		expect(calls).toHaveLength(0);
	});

	it("does not restore when backed gmailAutoSyncEnabled is false", () => {
		delete localStorageData["fincoach-gmail-auto-sync-enabled"];

		const envelope = { settings: { gmailAutoSyncEnabled: false } };
		GDrive._restoreSettings(envelope);

		expect(localStorage.setItem).not.toHaveBeenCalledWith(
			"fincoach-gmail-auto-sync-enabled",
			"true",
		);
	});
});

// ===========================================================================
// Sub-based encryption (SEC-MEDIUM-1)
// ===========================================================================
describe("sub-based encryption", () => {
	const email = "user@example.com";

	it("_encrypt/_decrypt roundtrip with passphrase restores original bytes", async () => {
		const original = new TextEncoder().encode("sensitive backup data");
		const encrypted = await GDrive._encrypt(original, email, "mypass");
		const decrypted = await GDrive._decrypt(encrypted, email, "mypass");
		expect(new TextDecoder().decode(decrypted)).toBe("sensitive backup data");
	});

	it("_decrypt with wrong passphrase throws", async () => {
		const data = new TextEncoder().encode("data");
		const encrypted = await GDrive._encrypt(data, email, "correct");
		await expect(GDrive._decrypt(encrypted, email, "wrong")).rejects.toThrow();
	});

	it("_encrypt with different subs produces different ciphertext", async () => {
		const data = new TextEncoder().encode("same data");
		const withSub = await GDrive._encrypt(data, email, "sub-abc-123");
		const withoutSub = await GDrive._encrypt(data, email, "");
		expect(Array.from(withSub)).not.toEqual(Array.from(withoutSub));
	});

	it("maybeAutoSync calls sync() with no arguments (sub is fetched internally)", async () => {
		GDrive.setEnabled(true);
		mockGmail.isConnected.mockReturnValue(true);
		// No last sync → cooldown not active
		delete localStorageData["fincoach-gdrive-last-sync"];

		const syncSpy = vi.spyOn(GDrive, "sync").mockResolvedValue({ stats: null, uploadedAt: "" });

		await GDrive.maybeAutoSync();

		expect(syncSpy).toHaveBeenCalledWith();
	});

	it("maybeAutoSync passes no arguments regardless of sessionStorage state", async () => {
		GDrive.setEnabled(true);
		mockGmail.isConnected.mockReturnValue(true);
		delete localStorageData["fincoach-gdrive-last-sync"];

		const syncSpy = vi.spyOn(GDrive, "sync").mockResolvedValue({ stats: null, uploadedAt: "" });

		await GDrive.maybeAutoSync();

		expect(syncSpy).toHaveBeenCalledWith();
	});

	it("download() throws when backup is encrypted with a different sub", async () => {
		const envelope = { version: 1, schema_version: 1, tables: {} };
		const plainBytes = new TextEncoder().encode(JSON.stringify(envelope));
		const encBytes = await GDrive._encrypt(plainBytes, email, "correct-sub");

		vi.spyOn(GDrive, "_findBackupFileId").mockResolvedValue("file-id");
		vi.spyOn(GDrive, "_getKeyMaterial").mockResolvedValue({ email, sub: "wrong-sub" });
		globalThis.fetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({}),
			arrayBuffer: async () => encBytes.buffer,
		});

		await expect(GDrive.download()).rejects.toThrow("Backup decryption failed");
	});
});

// ===========================================================================
// 22. _getKeyMaterial
// ===========================================================================
describe("GDrive._getKeyMaterial", () => {
	it("returns { email, sub } from _getEmail() and Gmail.getAccountSub()", async () => {
		vi.spyOn(GDrive, "_getEmail").mockResolvedValue("key-user@example.com");
		mockGmail.getAccountSub.mockReturnValue("sub-abc-123");

		const result = await GDrive._getKeyMaterial();

		expect(result).toEqual({ email: "key-user@example.com", sub: "sub-abc-123" });
	});

	it("returns empty string for sub when Gmail.getAccountSub returns empty string", async () => {
		vi.spyOn(GDrive, "_getEmail").mockResolvedValue("key-user@example.com");
		mockGmail.getAccountSub.mockReturnValue("");

		const result = await GDrive._getKeyMaterial();

		expect(result).toEqual({ email: "key-user@example.com", sub: "" });
	});

	it("propagates _getEmail() error when token is invalid", async () => {
		vi.spyOn(GDrive, "_getEmail").mockRejectedValue(new Error("Not connected"));

		await expect(GDrive._getKeyMaterial()).rejects.toThrow("Not connected");
	});
});

