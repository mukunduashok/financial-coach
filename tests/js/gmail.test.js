/**
 * Unit tests for static/js/gmail.js — Gmail client for Financial Coach PWA.
 *
 * Uses mocked fetch, localStorage, and DB to test the Gmail module in isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";

// --- Setup global mocks before importing modules ---
globalThis.initSqlJs = (opts) => initSqlJs({ ...opts, locateFile: undefined });

// Mock DOMParser for Node environment
class MockDOMParser {
  parseFromString(html, type) {
    // Minimal mock: strip tags for textContent
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      body: { textContent: text },
      documentElement: { textContent: text },
      querySelectorAll: () => [],
      createTreeWalker: () => ({ nextNode: () => null }),
    };
  }
}
globalThis.DOMParser = MockDOMParser;

const { DB } = await import("../../static/js/db.js");

// Mock config.js — provide a test proxy URL
vi.mock("../../static/js/config.js", () => ({
	GMAIL_PROXY_URL: "https://proxy.example.com",
	GMAIL_SETTINGS_KEY: "fincoach-gmail-settings",
	GMAIL_OAUTH_PENDING_RESULT_KEY: "fincoach-gmail-oauth-pending-result",
	GMAIL_OAUTH_PENDING_STATE_KEY: "fincoach-gmail-oauth-pending-state",
	GMAIL_OAUTH_STATE_TTL_MS: 300_000,
	AI_SETTINGS_KEY: "fincoach-ai-settings",
	AI_EXTERNAL_CONSENT_KEY: "fincoach-ai-external-consent",
	GMAIL_CUSTOM_SENDERS_KEY: "fincoach-gmail-custom-senders",
	GMAIL_AUTO_SYNC_ENABLED_KEY: "fincoach-gmail-auto-sync-enabled",
	GMAIL_AUTO_SYNC_LAST_KEY: "fincoach-gmail-auto-sync-last",
	GMAIL_AUTO_SYNC_INTERVAL_MS: 900_000, // 15 minutes
	VAULT_SALT_KEY: "fincoach-vault-salt",
	VAULT_SENTINEL_KEY: "fincoach-vault-sentinel",
	VAULT_AI_KEY: "fincoach-vault-ai",
	VAULT_GMAIL_KEY: "fincoach-vault-gmail",
}));
// Mock vault.js — default to configured+unlocked so Gmail token storage stays encrypted.
vi.mock("../../static/js/vault.js", () => ({
	Vault: {
		isConfigured: vi.fn(() => true),
		isUnlocked: vi.fn(() => true),
		saveGmailSettings: vi.fn(),
		clearGmailSettings: vi.fn(),
	},
}));

// Now import Gmail (after DB is available)
const { Gmail } = await import("../../static/js/gmail.js");
const { Vault } = await import("../../static/js/vault.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function freshDB() {
  DB._db = null;
  DB._persist = vi.fn(async () => {});
  DB._loadFromStorage = vi.fn(async () => null);
  await DB.init();
}

let localStorageData = {};
const localStorageMock = {
  getItem: vi.fn((key) => localStorageData[key] || null),
  setItem: vi.fn((key, val) => {
    localStorageData[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete localStorageData[key];
  }),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

function getPendingOAuthState() {
	const raw = sessionStorage.getItem("fincoach-gmail-oauth-pending-state");
	return raw ? JSON.parse(raw) : null;
}

const originalFetch = globalThis.fetch;
const originalOpen = globalThis.open;

beforeEach(async () => {
  localStorageData = {};
  sessionStorage.clear();
  vi.restoreAllMocks();
  Vault.isConfigured.mockReturnValue(true);
  Vault.isUnlocked.mockReturnValue(true);
  Vault.saveGmailSettings.mockReset();
  Vault.saveGmailSettings.mockResolvedValue(undefined);
  Vault.clearGmailSettings.mockReset();
  globalThis.fetch = originalFetch;
  globalThis.open = originalOpen;
  Gmail.clearDecrypted();
  await freshDB();
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  globalThis.open = originalOpen;
});

// ===========================================================================
// 1. Settings Management
// ===========================================================================
describe("Gmail Settings", () => {
  it("returns empty object when no settings saved", () => {
    const s = Gmail.getSettings();
    expect(s).toEqual({
      email: "",
      sub: "",
      accessToken: "",
      refreshToken: "",
      tokenExpiry: null,
    });
  });

  it("saves and loads settings", async () => {
    await Gmail.saveSettings({ email: "user@example.com" });
    const s = Gmail.getSettings();
    expect(s.email).toBe("user@example.com");
    expect(JSON.parse(localStorageData["fincoach-gmail-settings"])).toEqual({
      email: "user@example.com",
      sub: "",
    });
  });

  it("merges settings without overwriting existing keys", async () => {
    await Gmail.saveSettings({ email: "user@example.com" });
    await Gmail.saveSettings({ sub: "sub-123" });
    const s = Gmail.getSettings();
    expect(s.email).toBe("user@example.com");
    expect(s.sub).toBe("sub-123");
  });

  it("rejects token persistence when the vault is unavailable", async () => {
    Vault.isConfigured.mockReturnValue(false);
    Vault.isUnlocked.mockReturnValue(false);

    await expect(Gmail.saveSettings({ accessToken: "tok123" })).rejects.toThrow(
      "Unlock the credential vault before storing Gmail credentials.",
    );
    expect(localStorageData["fincoach-gmail-settings"]).toBe(JSON.stringify({ email: "", sub: "" }));
  });

  it("migrates legacy plaintext Gmail tokens into the vault and scrubs localStorage", async () => {
    localStorageData["fincoach-gmail-settings"] = JSON.stringify({
      email: "user@example.com",
      sub: "sub-123",
      accessToken: "legacy-access",
      refreshToken: "legacy-refresh",
      tokenExpiry: 123,
    });

    await Gmail.hydrateVaultSettings(null);

    expect(Vault.saveGmailSettings).toHaveBeenCalledWith({
      accessToken: "legacy-access",
      refreshToken: "legacy-refresh",
      tokenExpiry: 123,
    });
    expect(JSON.parse(localStorageData["fincoach-gmail-settings"])).toEqual({
      email: "user@example.com",
      sub: "sub-123",
    });
    expect(Gmail.getSettings().accessToken).toBe("legacy-access");
  });
});

// ===========================================================================
// 2. OAuth / Connection Status
// ===========================================================================
describe("Gmail OAuth", () => {
  it("isConnected returns false when no tokens", () => {
    expect(Gmail.isConnected()).toBe(false);
  });

  it("isConnected returns true when tokens present", async () => {
    await Gmail.saveSettings({
      accessToken: "access",
      refreshToken: "refresh",
    });
    expect(Gmail.isConnected()).toBe(true);
  });

  it("disconnect clears all tokens", async () => {
    await Gmail.saveSettings({
      accessToken: "access",
      refreshToken: "refresh",
    });
    Gmail.disconnect();
    const s = Gmail.getSettings();
    expect(s.accessToken).toBe("");
    expect(s.refreshToken).toBe("");
  });

  it("connect fetches auth URL from proxy", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
	      ok: true,
	      json: async () => ({ auth_url: "https://accounts.google.com/o/oauth2/auth?..." }),
	    })
      .mockResolvedValueOnce({
	      ok: true,
	      json: async () => ({ access_token: "valid-tok", refresh_token: "valid-ref", expires_in: 3600 }),
	    });
    // Mock window.open to return null (popup blocked) — causes connect to reject quickly
    globalThis.open = vi.fn().mockReturnValue(null);
    await Gmail.connect().catch(() => {});
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://proxy.example.com/auth/url?state="),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("connect() stores browser-bound state with origin, nonce, and issued_at", async () => {
    const expectedOrigin = window.location.origin;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ auth_url: "https://accounts.google.com/o/oauth2/auth?..." }),
    });
    const mockPopup = { closed: false };
    globalThis.open = vi.fn().mockReturnValue(mockPopup);

    const connectPromise = Gmail.connect();
    await new Promise((r) => setTimeout(r, 0));

    const fetchUrl = globalThis.fetch.mock.calls[0][0];
    const url = new URL(fetchUrl);
    const rawState = url.searchParams.get("state");
    expect(rawState).toBeTruthy();

    const decoded = JSON.parse(atob(rawState));
    expect(decoded.origin).toBe(expectedOrigin);
    expect(typeof decoded.nonce).toBe("string");
    expect(decoded.nonce.length).toBeGreaterThan(10);
    expect(typeof decoded.issued_at).toBe("number");

    const pending = getPendingOAuthState();
    expect(pending).toEqual(
      expect.objectContaining({
        rawState,
        issuedAt: decoded.issued_at,
      }),
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://proxy.example.com",
        data: {
          type: "gmail-oauth",
          status: "success",
          state: rawState,
          auth_result_id: "auth-result-1",
        },
      }),
    );

    await connectPromise;
  });

  it("connect rejects when the vault is not configured", async () => {
    Vault.isConfigured.mockReturnValue(false);
    await expect(Gmail.connect()).rejects.toThrow("Set up a PIN before connecting Gmail.");
  });

  it("connect rejects when the vault is locked", async () => {
    Vault.isConfigured.mockReturnValue(true);
    Vault.isUnlocked.mockReturnValue(false);
    await expect(Gmail.connect()).rejects.toThrow("Unlock your PIN before connecting Gmail.");
  });
});

// ===========================================================================
// 2b. OAuth Origin Guard
// ===========================================================================
describe("OAuth onMessage origin guard", () => {
  beforeEach(() => {
    Gmail.disconnect();
    localStorageData = {};
  });

  it("ignores postMessage from an invalid origin and does not update settings", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth_url: "https://accounts.google.com/auth" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "valid-tok", refresh_token: "valid-ref", expires_in: 3600 }),
      });
    const mockPopup = { closed: false };
    globalThis.open = vi.fn().mockReturnValue(mockPopup);

    // Start connect but do not await — we need the listener to be registered first
    const connectPromise = Gmail.connect();

    // Wait for both awaits inside connect() to resolve (fetch + json)
    await new Promise((r) => setTimeout(r, 0));

    // Dispatch message from a WRONG origin — must be silently ignored
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example.com",
        data: {
          type: "gmail-oauth",
          status: "success",
          auth_result_id: "ignored-auth-result",
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 0));

    // Settings must NOT have changed — origin check blocked the message
    expect(Gmail.isConnected()).toBe(false);

    // Clean up: send a valid message so the promise resolves
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://proxy.example.com",
        data: {
          type: "gmail-oauth",
          status: "success",
          state: getPendingOAuthState().rawState,
          auth_result_id: "auth-result-1",
        },
      }),
    );

    await connectPromise;
    expect(Gmail.isConnected()).toBe(true);
  });

  it("processes postMessage from the correct origin derived from GMAIL_PROXY_URL", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth_url: "https://accounts.google.com/auth" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "real-tok", refresh_token: "real-ref", expires_in: 3600 }),
      });
    const mockPopup = { closed: false };
    globalThis.open = vi.fn().mockReturnValue(mockPopup);

    const connectPromise = Gmail.connect();

    // Wait for both awaits inside connect() to resolve
    await new Promise((r) => setTimeout(r, 0));

    // Dispatch from the CORRECT origin (matches GMAIL_PROXY_URL = "https://proxy.example.com")
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://proxy.example.com",
        data: {
          type: "gmail-oauth",
          status: "success",
          state: getPendingOAuthState().rawState,
          auth_result_id: "auth-result-1",
        },
      }),
    );

    const result = await connectPromise;
    expect(result).toEqual({ connected: true });
    expect(Gmail.isConnected()).toBe(true);
    expect(Gmail.getSettings().accessToken).toBe("real-tok");
  });

  it("rejects postMessage with mismatched oauth state even from the correct proxy origin", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ auth_url: "https://accounts.google.com/auth" }),
    });
    const mockPopup = { closed: false };
    globalThis.open = vi.fn().mockReturnValue(mockPopup);

    const connectPromise = Gmail.connect();
    await new Promise((r) => setTimeout(r, 0));

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://proxy.example.com",
        data: {
          type: "gmail-oauth",
          status: "success",
          state: "attacker-supplied-state",
          auth_result_id: "auth-result-1",
        },
      }),
    );

    await expect(connectPromise).rejects.toThrow("Invalid OAuth state.");
    expect(Gmail.isConnected()).toBe(false);
    expect(getPendingOAuthState()).toBeNull();
  });

  it("postMessage resolves auth even when popup would throw on closed access (COOP)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth_url: "https://accounts.google.com/auth" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "coop-tok", refresh_token: "coop-ref", expires_in: 3600 }),
      });

    // Simulate a popup whose .closed getter throws a SecurityError (COOP)
    const coopPopup = {
      get closed() {
        throw new DOMException("COOP blocks access", "SecurityError");
      },
    };
    globalThis.open = vi.fn().mockReturnValue(coopPopup);

    const connectPromise = Gmail.connect();

    // Wait for fetch + json awaits inside connect()
    await new Promise((r) => setTimeout(r, 0));

    // Advance fake timers aren't available here — use real setTimeout to trigger the interval
    await new Promise((r) => setTimeout(r, 600));

    // Send a valid postMessage — connect() should still resolve via the listener
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://proxy.example.com",
        data: {
          type: "gmail-oauth",
          status: "success",
          state: getPendingOAuthState().rawState,
          auth_result_id: "auth-result-1",
        },
      }),
    );

    const result = await connectPromise;
    expect(result).toEqual({ connected: true });
    expect(Gmail.isConnected()).toBe(true);
    expect(Gmail.getSettings().accessToken).toBe("coop-tok");
  });
});

// ===========================================================================
// 3. Email Parsing
// ===========================================================================
describe("Email Parsing", () => {
  it("_extractCleanText strips HTML tags and styles", () => {
    const html =
      "<html><body><style>.x{color:red}</style><p>Hello <b>World</b></p></body></html>";
    const text = Gmail._extractCleanText(html);
    expect(text).toContain("Hello");
    expect(text).toContain("World");
    expect(text).not.toContain("<style>");
    expect(text).not.toContain("<p>");
  });

  it("_parseRawEmail extracts headers and body from simple email", () => {
    const raw =
      "From: alerts@hdfcbank.net\r\nSubject: Transaction Alert\r\nDate: Mon, 01 Jan 2025 10:00:00\r\nContent-Type: text/plain\r\n\r\nYour account has been debited Rs 500";
    const encoded = btoa(raw);
    const parsed = Gmail._parseRawEmail(encoded);
    expect(parsed.from).toBe("alerts@hdfcbank.net");
    expect(parsed.subject).toBe("Transaction Alert");
    expect(parsed.text).toContain("debited Rs 500");
  });

  it("_decodeQuotedPrintable decodes soft line breaks and hex", () => {
    const input = "Hello=\r\nWorld =3D end";
    const result = Gmail._decodeQuotedPrintable(input);
    expect(result).toBe("HelloWorld = end");
  });
});

// ===========================================================================
// 4. Bank Name Extraction
// ===========================================================================
describe("Bank Name Extraction", () => {
  it("extracts HDFC from hdfcbank email", () => {
    expect(Gmail._extractBankName("alerts@hdfcbank.net")).toBe("HDFC");
  });

  it("extracts SBI from sbi email", () => {
    expect(Gmail._extractBankName("noreply@alerts.sbi.bank.in")).toBe("SBI");
  });

  it("extracts ICICI from icicibank email", () => {
    expect(Gmail._extractBankName("alerts@icicibank.com")).toBe("ICICI");
  });

  it("extracts domain name for unknown bank", () => {
    expect(Gmail._extractBankName("alerts@mybank.com")).toBe("MYBANK");
  });

  it("returns Unknown Bank for short domains", () => {
    expect(Gmail._extractBankName("a@ab.com")).toBe("Unknown Bank");
  });

  it("returns Unknown Bank for no @ in address", () => {
    expect(Gmail._extractBankName("noemail")).toBe("Unknown Bank");
  });
});

// ===========================================================================
// 5. Account Identifier Building
// ===========================================================================
describe("Account Identifier", () => {
  it("builds identifier with bank, type, and last digits", () => {
    const result = Gmail._buildAccountIdentifier("HDFC", "savings", "1234", "");
    expect(result.identifier).toBe("HDFC_SAVINGS_1234");
    expect(result.name).toBe("Hdfc Savings ****1234");
  });

  it("builds identifier with bank and type only", () => {
    const result = Gmail._buildAccountIdentifier("ICICI", "current", null, "");
    expect(result.identifier).toBe("ICICI_CURRENT");
    expect(result.name).toBe("Icici Current");
  });

  it("builds identifier with last digits only", () => {
    const result = Gmail._buildAccountIdentifier("", "savings", "5678", "");
    expect(result.identifier).toBe("UNKNOWN_SAVINGS_5678");
    expect(result.name).toBe("Account ****5678");
  });

  it("falls back to email domain", () => {
    const result = Gmail._buildAccountIdentifier("", "savings", null, "a@mybank.com");
    expect(result.identifier).toBe("MYBANK_SAVINGS");
    expect(result.name).toBe("Unknown Savings");
  });

  it("defaults invalid account type to savings", () => {
    const result = Gmail._buildAccountIdentifier("HDFC", "invalid_type", "1234", "");
    expect(result.identifier).toBe("HDFC_SAVINGS_1234");
  });
});

// ===========================================================================
// 6. Extraction Prompt Building
// ===========================================================================
describe("Extraction Prompt", () => {
  it("builds prompt with email data", () => {
    const emails = [
      {
        from: "alerts@hdfcbank.net",
        date: "2025-01-15",
        subject: "Transaction Alert",
        text: "Rs 500 debited",
      },
    ];
    const prompt = Gmail._buildExtractionPrompt(emails);
    expect(prompt).toContain("EMAIL #1:");
    expect(prompt).toContain("FROM: al**@hdfcbank.net");
    expect(prompt).not.toContain("FROM: alerts@hdfcbank.net");
    expect(prompt).toContain("Rs 500 debited");
    expect(prompt).toContain("JSON Array Response:");
    expect(prompt).toContain("1 bank emails");
    expect(prompt).toContain("<email_content>");
    expect(prompt).toContain("</email_content>");
    expect(prompt).toContain("SECURITY INSTRUCTION:");
  });

  it("includes multiple emails numbered correctly", () => {
    const emails = [
      { from: "a@hdfc.com", date: "2025-01-01", subject: "S1", text: "T1" },
      { from: "b@sbi.com", date: "2025-01-02", subject: "S2", text: "T2" },
    ];
    const prompt = Gmail._buildExtractionPrompt(emails);
    expect(prompt).toContain("EMAIL #1:");
    expect(prompt).toContain("EMAIL #2:");
    expect(prompt).toContain("2 bank emails");
  });

  it("_buildExtractionPrompt masks phone numbers in email content", () => {
    const emails = [
      {
        from: "alerts@hdfcbank.net",
        date: "2025-01-15",
        subject: "Transaction Alert",
        text: "Call 9876543210",
      },
    ];
    const prompt = Gmail._buildExtractionPrompt(emails);
    expect(prompt).not.toContain("9876543210");
    expect(prompt).toContain("*******210");
  });

  it("_buildExtractionPrompt masks PII in from and subject fields", () => {
    const emails = [
      {
        from: "alerts@hdfcbank.net",
        date: "2025-01-15",
        subject: "Transaction Alert for 9876543210",
        text: "Rs 500 debited",
      },
    ];
    const prompt = Gmail._buildExtractionPrompt(emails);
    expect(prompt).toContain("FROM: al**@hdfcbank.net");
    expect(prompt).not.toContain("9876543210");
  });

  it("_buildExtractionPrompt uses [Individual] example text", () => {
    const emails = [
      { from: "a@hdfc.com", date: "2025-01-01", subject: "S1", text: "T1" },
    ];
    const prompt = Gmail._buildExtractionPrompt(emails);
    expect(prompt).toContain("[Individual]");
    expect(prompt).not.toContain("John Doe");
  });

  it("does not use pipe-format DESCRIPTION FIELD FORMAT rules", () => {
    const prompt = Gmail._buildExtractionPrompt([
      { from: "alerts@bank.com", date: "2025-01-01", subject: "Debit alert", text: "Rs 500 debited" },
    ]);
    expect(prompt).not.toContain("DESCRIPTION FIELD FORMAT");
    expect(prompt).not.toContain("Component1: Value | Component2: Value");
    expect(prompt).toContain("brief natural description");
  });

  it("_buildExtractionPrompt retains all 15 required JSON schema fields", () => {
    const emails = [{ from: "a@hdfc.com", date: "2025-01-01", subject: "S1", text: "T1" }];
    const prompt = Gmail._buildExtractionPrompt(emails);
    const requiredFields = [
      "email_index", "amount", "transaction_type", "date", "description",
      "merchant_upi_id", "merchant_name", "account_last_digits", "account_type",
      "bank_name", "balance_after", "transaction_id", "category",
      "is_transaction", "is_balance_info",
    ];
    for (const field of requiredFields) {
      expect(prompt, `missing field: ${field}`).toContain(`"${field}"`);
    }
  });

  it("_buildExtractionPrompt retains BALANCE EXTRACTION RULES", () => {
    const emails = [{ from: "a@hdfc.com", date: "2025-01-01", subject: "S1", text: "T1" }];
    const prompt = Gmail._buildExtractionPrompt(emails);
    expect(prompt).toContain("BALANCE EXTRACTION RULES");
    expect(prompt).toContain("NEVER for credit/debit cards");
  });

  it("_buildExtractionPrompt uses [Individual] for P2P transfers example", () => {
    const emails = [{ from: "a@hdfc.com", date: "2025-01-01", subject: "S1", text: "T1" }];
    const prompt = Gmail._buildExtractionPrompt(emails);
    // MERCHANT EXTRACTION RULES rule 3: transfers to individuals must use [Individual],
    // never real names
    expect(prompt).toContain("[Individual]");
    expect(prompt).toContain("never use real names");
  });
});

// ===========================================================================
// 7. Categorization Prompt Building
// ===========================================================================
describe("Categorization Prompt", () => {
  it("builds prompt with transactions and categories", () => {
    const transactions = [
      {
        description: "Merchant: Swiggy | Method: UPI",
        amount: -450,
        email_from: "alerts@hdfc.com",
        bank_name: "HDFC",
      },
    ];
    const categories = [
      { name: "Food & Dining", description: "Restaurants and food" },
      { name: "Shopping", description: "Online shopping" },
    ];
    const prompt = Gmail._buildCategorizationPrompt(transactions, categories);
    expect(prompt).toContain("TRANSACTION #1:");
    expect(prompt).toContain("Merchant: Sw****");
    expect(prompt).toContain("Food & Dining, Shopping");
    expect(prompt).toContain("JSON Array Response:");
  });

  it("_buildCategorizationPrompt uses bank_name not email_from", () => {
    const transactions = [
      {
        description: "Test payment",
        amount: -100,
        email_from: "alerts@hdfc.com",
        bank_name: "HDFC",
      },
    ];
    const categories = [{ name: "Other", description: "Other" }];
    const prompt = Gmail._buildCategorizationPrompt(transactions, categories);
    expect(prompt).toContain("Bank/Source: HD**");
    expect(prompt).not.toContain("alerts@hdfc.com");
  });

  it("_buildCategorizationPrompt masks PII in description", () => {
    const transactions = [
      {
        description: "Purpose: Transfer | To: Ashok Kumar",
        amount: -500,
        bank_name: "SBI",
      },
    ];
    const categories = [{ name: "Transfer", description: "Money transfers" }];
    const prompt = Gmail._buildCategorizationPrompt(transactions, categories);
    expect(prompt).not.toContain("Ashok Kumar");
    expect(prompt).toContain("As***");
  });

  it("includes Merchant field with merchant_name in transaction section", () => {
    const categories = [{ name: "Food & Dining", description: "Food" }];
    const prompt = Gmail._buildCategorizationPrompt(
      [{ merchant_name: "Swiggy", description: "food delivery", amount: -350, bank_name: "HDFC" }],
      categories,
    );
    expect(prompt).toContain("Merchant: Sw****");
    const merchantIdx = prompt.indexOf("Merchant: Sw****");
    const descIdx = prompt.indexOf("Description: food delivery");
    expect(merchantIdx).toBeLessThan(descIdx);
  });

  it("_buildCategorizationPrompt with no merchant_name shows empty Merchant field", () => {
    const categories = [{ name: "Other", description: "Other" }];
    const prompt = Gmail._buildCategorizationPrompt(
      [{ merchant_name: null, description: "some purchase", amount: -100, bank_name: "HDFC" }],
      categories,
    );
    // Merchant field must be present even when merchant_name is null
    expect(prompt).toContain("Merchant: \n");
    // Description field follows immediately after the empty Merchant line
    const merchantIdx = prompt.indexOf("Merchant: \n");
    const descIdx = prompt.indexOf("Description: some purchase");
    expect(merchantIdx).toBeLessThan(descIdx);
  });
});

// ===========================================================================
// 8. JSON Parsing
// ===========================================================================
describe("JSON Parsing", () => {
  it("parses clean JSON array", () => {
    const result = Gmail._parseJSON('[{"a": 1}, {"a": 2}]');
    expect(result).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("parses JSON inside markdown fences", () => {
    const result = Gmail._parseJSON('```json\n[{"a": 1}]\n```');
    expect(result).toEqual([{ a: 1 }]);
  });

  it("parses JSON with surrounding text", () => {
    const result = Gmail._parseJSON('Here is the result:\n[{"a": 1}]\nDone!');
    expect(result).toEqual([{ a: 1 }]);
  });

  it("returns empty array for invalid JSON", () => {
    const result = Gmail._parseJSON("not json at all");
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// 9. Processed Gmail IDs (DB integration)
// ===========================================================================
describe("Processed Gmail IDs", () => {
  it("returns empty set for no IDs", () => {
    const result = DB.getProcessedGmailIds([]);
    expect(result).toEqual(new Set());
  });

  it("saves and retrieves processed IDs", async () => {
    await DB.saveProcessedGmailIds(["msg1", "msg2"]);
    const result = DB.getProcessedGmailIds(["msg1", "msg2", "msg3"]);
    expect(result.has("msg1")).toBe(true);
    expect(result.has("msg2")).toBe(true);
    expect(result.has("msg3")).toBe(false);
  });

  it("does not duplicate IDs on re-save", async () => {
    await DB.saveProcessedGmailIds(["msg1"]);
    await DB.saveProcessedGmailIds(["msg1", "msg2"]);
    const rows = DB._queryAll("SELECT * FROM processed_gmail_messages");
    expect(rows.length).toBe(2);
  });
});

// ===========================================================================
// 10. Get or Create Account
// ===========================================================================
describe("Get or Create Account", () => {
  it("creates new account from transaction data", async () => {
    const id = await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
    });
    expect(typeof id).toBe("number");
    const acc = DB._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    expect(acc.account_identifier).toBe("HDFC_SAVINGS_1234");
  });

  it("returns existing account if identifier matches", async () => {
    const id1 = await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
    });
    const id2 = await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
    });
    expect(id1).toBe(id2);
  });

  it("extracts bank name from email when not provided", async () => {
    const id = await Gmail._getOrCreateAccount({
      bank_name: "",
      account_type: "savings",
      account_last_digits: "5678",
      email_from: "alerts@icicibank.com",
    });
    const acc = DB._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    expect(acc.account_identifier).toBe("ICICI_SAVINGS_5678");
  });
});

// ===========================================================================
// 11. Import Transaction
// ===========================================================================
describe("Import Transaction", () => {
  it("imports a valid transaction", async () => {
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg1",
      amount: -500,
      description: "Test purchase",
      transaction_type: "expense",
      date: "2025-01-15T10:00",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
      is_transaction: true,
      is_balance_info: false,
    });
    expect(result).toBe("imported");
  });

  it("allows two Gmail emails with the same bank transaction_id (e.g., SIP scenario)", async () => {
    // Two different emails (different gmail_message_id) may carry the same bank
    // reference/transaction_id — e.g., SIP debit notifications with a shared folio
    // number. Both should be imported; the gmail_message_id is the unique key.
    const txData = {
      gmail_message_id: "msg1",
      transaction_id: "TXN123",
      amount: -500,
      description: "Test",
      transaction_type: "expense",
      date: "2025-01-15",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "a@hdfc.com",
      is_transaction: true,
      is_balance_info: false,
    };
    const first = await Gmail._importTransaction(txData);
    const second = await Gmail._importTransaction({
      ...txData,
      gmail_message_id: "msg2",
    });
    expect(first).toBe("imported");
    expect(second).toBe("imported");
  });

  it("handles balance-only email", async () => {
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_bal",
      amount: 25000,
      balance_after: 25000,
      transaction_type: "balance",
      is_transaction: false,
      is_balance_info: true,
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
    });
    expect(result).toBe("balance_update");
  });
  it("returns error for amount out of range", async () => {
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_range",
      amount: 2_000_000_000,
      description: "Test",
      transaction_type: "expense",
      date: "2025-01-15T10:00",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
      is_transaction: true,
      is_balance_info: false,
    });
    expect(result).toBe("error");
  });

  it("returns error for invalid transaction_type", async () => {
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_badtype",
      amount: -500,
      description: "Test",
      transaction_type: "unknown",
      date: "2025-01-15T10:00",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
      is_transaction: true,
      is_balance_info: false,
    });
    expect(result).toBe("error");
  });

  it("returns error for malformed date", async () => {
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_baddate",
      amount: -500,
      description: "Test",
      transaction_type: "expense",
      date: "not-a-date",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
      is_transaction: true,
      is_balance_info: false,
    });
    expect(result).toBe("error");
  });
});

// ===========================================================================
// 11b. Import Transaction — stored merchant display name (BUG 2)
// ===========================================================================
describe("Import Transaction — stored merchant display name", () => {
  it("applies a stored UPI merchant's renamed display name over raw LLM text", async () => {
    const cats = await DB.getCategories();
    const m = await DB.createMerchant({
      merchant_name: "Swiggy Foods",
      merchant_upi_id: "swiggy@upi",
      category_id: cats[0].id,
    });

    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_disp1",
      amount: -400,
      description: "order",
      transaction_type: "expense",
      date: "2025-01-15T10:00",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
      merchant_upi_id: "swiggy@upi",
      merchant_name: "SWIGGY", // raw LLM text differs from stored display name
      is_transaction: true,
      is_balance_info: false,
    });
    expect(result).toBe("imported");

    const tx = DB._queryOne(
      "SELECT merchant_name, merchant_id, category_id FROM transactions WHERE gmail_message_id = ?",
      ["msg_disp1"],
    );
    expect(tx.merchant_name).toBe("Swiggy Foods");
    expect(tx.merchant_id).toBe(m.id);
    expect(tx.category_id).toBe(cats[0].id);
  });

  it("matches a stored no-UPI merchant by normalized name and applies its display name", async () => {
    const cats = await DB.getCategories();
    // Simulate an UNCATEGORIZED, no-UPI merchant first seen as "LocalShop" then renamed
    // to "Local Shop Pvt": merchant_key stays the original slug, display_name is mutable,
    // and category_id is null. Inserted directly to model the null-category identity.
    DB._exec(
      "INSERT INTO merchants (merchant_key, display_name, merchant_upi_id, category_id, confidence_score, created_at, last_updated) VALUES (?,?,?,?,?,?,?)",
      ["localshop", "Local Shop Pvt", null, null, 1.0, "2025-01-01 00:00:00", "2025-01-01 00:00:00"],
    );

    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_disp2",
      amount: -150,
      description: "buy",
      transaction_type: "expense",
      date: "2025-01-16T10:00",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
      merchant_name: "LocalShop", // normalizes to "localshop" → matches merchant_key
      category: cats[2].name, // LLM-suggested category used when merchant category is null
      is_transaction: true,
      is_balance_info: false,
    });
    expect(result).toBe("imported");

    const tx = DB._queryOne(
      "SELECT merchant_name, merchant_id, category_id FROM transactions WHERE gmail_message_id = ?",
      ["msg_disp2"],
    );
    // Resolved display name comes from the matched merchant's display_name.
    expect(tx.merchant_name).toBe("Local Shop Pvt");
    // The transaction is linked to the merchant identity.
    const merchant = DB._queryOne("SELECT id FROM merchants WHERE merchant_key = ?", ["localshop"]);
    expect(tx.merchant_id).toBe(merchant.id);
    // Category falls back to the LLM suggestion because the merchant category is null.
    expect(tx.category_id).toBe(cats[2].id);
  });

  it("keeps the raw LLM merchant name when no stored merchant matches", async () => {
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_disp3",
      amount: -99,
      description: "buy",
      transaction_type: "expense",
      date: "2025-01-17T10:00",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
      merchant_name: "Unknown Vendor",
      is_transaction: true,
      is_balance_info: false,
    });
    expect(result).toBe("imported");

    const tx = DB._queryOne(
      "SELECT merchant_name FROM transactions WHERE gmail_message_id = ?",
      ["msg_disp3"],
    );
    expect(tx.merchant_name).toBe("Unknown Vendor");
  });
});

// ===========================================================================
// 12. Token Management
// ===========================================================================
describe("Token Management", () => {
  it("_getValidToken returns token when not expired", async () => {
    await Gmail.saveSettings({
      accessToken: "valid-token",
      refreshToken: "ref",
      tokenExpiry: Date.now() + 3600000,
    });
    const token = await Gmail._getValidToken();
    expect(token).toBe("valid-token");
  });

  it("_getValidToken throws when not connected", async () => {
    await expect(Gmail._getValidToken()).rejects.toThrow("Not connected to Gmail");
  });

  it("_getValidToken refreshes when token is expired", async () => {
    await Gmail.saveSettings({
      accessToken: "old-token",
      refreshToken: "ref-tok",
      tokenExpiry: Date.now() - 1000, // already expired
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "new-token", expires_in: 3600 }),
    });

    const token = await Gmail._getValidToken();
    expect(token).toBe("new-token");
  });

  it("_getValidToken refreshes when token expires within 60 seconds", async () => {
    await Gmail.saveSettings({
      accessToken: "old-token",
      refreshToken: "ref-tok",
      tokenExpiry: Date.now() + 30000, // 30 seconds from now (within 60s buffer)
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "refreshed-token", expires_in: 3600 }),
    });

    const token = await Gmail._getValidToken();
    expect(token).toBe("refreshed-token");
  });

  it("_refreshToken throws when no refresh token", async () => {
    await Gmail.saveSettings({ accessToken: "tok" });
    await expect(Gmail._refreshToken()).rejects.toThrow("No refresh token available");
  });

  it("_refreshToken disconnects on 401 response", async () => {
    await Gmail.saveSettings({
      accessToken: "old",
      refreshToken: "expired-ref",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    await expect(Gmail._refreshToken()).rejects.toThrow("Refresh token expired");
    expect(Gmail.isConnected()).toBe(false);
  });

  it("_refreshToken throws generic error on other failures", async () => {
    await Gmail.saveSettings({
      refreshToken: "ref",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(Gmail._refreshToken()).rejects.toThrow("Failed to refresh token");
  });
});

// ===========================================================================
// 13. LLM Call
// ===========================================================================
describe("LLM Call", () => {
  it("_callLLM throws when AI settings not configured", async () => {
    await expect(Gmail._callLLM("test prompt")).rejects.toThrow("AI not configured");
  });

  it("_callLLM throws for unknown provider", async () => {
    const { AI } = await import("../../static/js/ai.js");
    AI.setDecrypted({
      provider: "nonexistent",
      apiKey: "x",
    });
    await expect(Gmail._callLLM("test prompt")).rejects.toThrow("Unknown AI provider");
    AI.setDecrypted(null);
  });

  it("_callLLM sends correct request to Groq", async () => {
    const { AI } = await import("../../static/js/ai.js");
    AI.setDecrypted({
      provider: "groq",
      apiKey: "test-key",
      model: "test-model",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "LLM response" } }],
      }),
    });

    const result = await Gmail._callLLM("test prompt");
    expect(result).toBe("LLM response");

    const call = globalThis.fetch.mock.calls[0];
    expect(call[0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe("test-model");
    expect(body.messages[0].content).toBe("test prompt");
    expect(call[1].headers.Authorization).toBe("Bearer test-key");
    AI.setDecrypted(null);
  });

  it("_callLLM uses vault-decrypted settings when vault is unlocked", async () => {
    // Simulate vault unlocked: AI._decrypted set, localStorage empty
    const { AI } = await import("../../static/js/ai.js");
    AI.setDecrypted({
      provider: "groq",
      apiKey: "vault-key",
      model: "test-model",
      azureResourceName: "",
      azureDeploymentName: "",
      azureApiVersion: "",
      ollamaBaseUrl: "",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "vault response" } }] }),
    });

    const result = await Gmail._callLLM("vault prompt");
    expect(result).toBe("vault response");

    const call = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(call[1].headers.Authorization).toBe("Bearer vault-key");

    // Cleanup
    AI.setDecrypted(null);
  });

  it("_callLLM uses default model when none specified", async () => {
    const { AI } = await import("../../static/js/ai.js");
    AI.setDecrypted({
      provider: "groq",
      apiKey: "test-key",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    await Gmail._callLLM("prompt");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("openai/gpt-oss-120b");
    AI.setDecrypted(null);
  });

  it("_callLLM does not send Authorization for Ollama", async () => {
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "ollama",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    await Gmail._callLLM("prompt");
    const headers = globalThis.fetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("_callLLM throws on API error (429 rate limit)", async () => {
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      apiKey: "key",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => "",
    });

    await expect(Gmail._callLLM("prompt")).rejects.toThrow(
      "Rate limit exceeded — try a shorter date range or wait a moment before retrying.",
    );
  });

  it("_callLLM throws on API error (401 invalid key)", async () => {
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      apiKey: "bad-key",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "",
    });

    await expect(Gmail._callLLM("prompt")).rejects.toThrow(
      "Invalid API key — check your AI provider settings in Settings.",
    );
  });

  it("_callLLM includes provider message for unknown status codes", async () => {
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      apiKey: "key",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 418,
      json: async () => ({ error: { message: "I'm a teapot" } }),
      text: async () => "",
    });

    await expect(Gmail._callLLM("prompt")).rejects.toThrow("LLM API error 418: I'm a teapot");
  });

  it("_callLLM throws on API error (500 internal server error)", async () => {
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      apiKey: "key",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "",
    });

    await expect(Gmail._callLLM("prompt")).rejects.toThrow(
      "AI provider internal error — try again shortly.",
    );
  });

  it("_callLLM throws on API error (503 service unavailable)", async () => {
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      apiKey: "key",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "",
    });

    await expect(Gmail._callLLM("prompt")).rejects.toThrow(
      "AI provider is temporarily unavailable — try again shortly.",
    );
  });

  it("sends response_mime_type application/json for Gemini provider", async () => {
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.0-flash-lite",
    });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }),
    });
    vi.stubGlobal("fetch", mockFetch);
    await Gmail._callLLM("test prompt");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.generationConfig.response_mime_type).toBe("application/json");
    expect(body.generationConfig.temperature).toBe(0.1);
  });
});

// ===========================================================================
// 14. Advanced Email Parsing
// ===========================================================================
describe("Advanced Email Parsing", () => {
  it("_parseRawEmail handles multipart email with text/plain and text/html", () => {
    const boundary = "----boundary123";
    const raw = [
      `From: alerts@hdfcbank.net`,
      `Subject: Alert`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `------boundary123`,
      `Content-Type: text/plain`,
      ``,
      `Your account debited Rs 500`,
      `------boundary123`,
      `Content-Type: text/html`,
      ``,
      `<p>Your account debited Rs 500</p>`,
      `------boundary123--`,
    ].join("\r\n");
    const encoded = btoa(raw);
    const parsed = Gmail._parseRawEmail(encoded);
    expect(parsed.text).toContain("debited Rs 500");
    expect(parsed.from).toBe("alerts@hdfcbank.net");
  });

  it("_parseRawEmail handles base64 content-transfer-encoding", () => {
    const bodyContent = btoa("Your account credited Rs 1000");
    const raw = [
      `From: noreply@sbi.bank.in`,
      `Subject: Credit Alert`,
      `Content-Type: text/plain`,
      `Content-Transfer-Encoding: base64`,
      ``,
      bodyContent,
    ].join("\r\n");
    const encoded = btoa(raw);
    const parsed = Gmail._parseRawEmail(encoded);
    expect(parsed.text).toContain("credited Rs 1000");
  });

  it("_parseRawEmail handles header continuation lines", () => {
    const raw = [
      `From: alerts@hdfcbank.net`,
      `Subject: Very long subject`,
      `\tthat wraps to next line`,
      `Content-Type: text/plain`,
      ``,
      `Body text`,
    ].join("\r\n");
    const encoded = btoa(raw);
    const parsed = Gmail._parseRawEmail(encoded);
    expect(parsed.subject).toContain("Very long subject");
    expect(parsed.subject).toContain("that wraps to next line");
  });

  it("_parseRawEmail truncates body to 5000 chars", () => {
    const longBody = "A".repeat(6000);
    const raw = `From: a@b.com\r\nSubject: Test\r\nContent-Type: text/plain\r\n\r\n${longBody}`;
    const encoded = btoa(raw);
    const parsed = Gmail._parseRawEmail(encoded);
    expect(parsed.text.length).toBe(5000);
  });

  it("_parseRawEmail handles URL-safe base64 encoding", () => {
    // Gmail uses URL-safe base64 with - and _ instead of + and /
    const raw = `From: a@b.com\r\nSubject: Test\r\nContent-Type: text/plain\r\n\r\nHello World`;
    const standard = btoa(raw);
    // Convert to URL-safe base64
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");
    const parsed = Gmail._parseRawEmail(urlSafe);
    expect(parsed.text).toContain("Hello World");
  });

  it("_decodeQuotedPrintable handles consecutive encoded chars", () => {
    // Note: implementation decodes bytes individually via String.fromCharCode,
    // so multi-byte UTF-8 sequences are decoded as separate Latin-1 chars.
    const input = "=41=42=43";
    const result = Gmail._decodeQuotedPrintable(input);
    expect(result).toBe("ABC");
  });

  it("_decodeQuotedPrintable handles plain text without encoding", () => {
    const input = "Normal text without encoding";
    const result = Gmail._decodeQuotedPrintable(input);
    expect(result).toBe("Normal text without encoding");
  });
});

// ===========================================================================
// 15. Additional Bank Name Extraction
// ===========================================================================
describe("Bank Name Extraction — additional patterns", () => {
  it("extracts AXIS from axisbank", () => {
    expect(Gmail._extractBankName("alerts@axisbank.com")).toBe("AXIS");
  });

  it("extracts KOTAK from kotakbank", () => {
    expect(Gmail._extractBankName("noreply@kotakbank.com")).toBe("KOTAK");
  });

  it("extracts PNB from pnbindia", () => {
    expect(Gmail._extractBankName("alerts@pnbindia.in")).toBe("PNB");
  });

  it("extracts BOB from bankofbaroda", () => {
    expect(Gmail._extractBankName("alerts@bankofbaroda.com")).toBe("BOB");
  });

  it("extracts CANARA from canarabank", () => {
    expect(Gmail._extractBankName("noreply@canarabank.com")).toBe("CANARA");
  });
});

// ===========================================================================
// 16. Import Transaction — Advanced Cases
// ===========================================================================
describe("Import Transaction — advanced", () => {
  it("detects duplicate by date + amount + account for non-Gmail transactions", async () => {
    // Create the account, then insert a manual (non-Gmail) transaction via DB.createTransaction
    const accountId = await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
    });
    await DB.createTransaction({
      transaction_id: "manual_tx_1",
      amount: -500,
      transaction_type: "expense",
      date: "2025-01-15",
      account_id: accountId,
      description: "Manual Purchase",
    });

    // A non-Gmail transaction (no gmail_message_id) with same date+amount+account must be rejected
    const result = await Gmail._importTransaction({
      amount: -500,
      description: "Purchase B",
      transaction_type: "expense",
      date: "2025-01-15",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
      is_transaction: true,
      is_balance_info: false,
    });
    expect(result).toBe("duplicate");
  });

  it("imports with category resolution from DB", async () => {
    // "Food & Dining" is seeded by DB.init()
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_cat",
      amount: -300,
      description: "Swiggy order",
      transaction_type: "expense",
      date: "2025-01-15",
      category: "Food & Dining",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "9999",
      email_from: "alerts@hdfcbank.net",
      is_transaction: true,
      is_balance_info: false,
    });
    expect(result).toBe("imported");

    const tx = DB._queryOne(
      "SELECT category_id FROM transactions WHERE gmail_message_id = 'msg_cat'",
    );
    expect(tx.category_id).not.toBeNull();

    const cat = DB._queryOne("SELECT name FROM categories WHERE id = ?", [tx.category_id]);
    expect(cat.name).toBe("Food & Dining");
  });

  it("imports with balance update when is_balance_info is true", async () => {
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_bal_tx",
      amount: -500,
      description: "Purchase",
      transaction_type: "expense",
      date: "2025-01-15",
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "4321",
      email_from: "alerts@hdfcbank.net",
      is_transaction: true,
      is_balance_info: true,
      balance_after: 15000,
    });
    expect(result).toBe("imported");

    const acc = DB._queryOne("SELECT balance FROM accounts WHERE account_identifier = 'HDFC_SAVINGS_4321'");
    expect(acc.balance).toBe(15000);
  });

  it("returns error for balance-only email with no amount", async () => {
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_no_bal",
      amount: null,
      balance_after: null,
      transaction_type: "balance",
      is_transaction: false,
      is_balance_info: true,
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "1234",
      email_from: "alerts@hdfcbank.net",
    });
    expect(result).toBe("error");
  });

  it("generates gmail-prefixed transaction_id when none provided", async () => {
    await Gmail._importTransaction({
      gmail_message_id: "msg_noid",
      amount: -200,
      description: "Test",
      transaction_type: "expense",
      date: "2025-02-01",
      bank_name: "SBI",
      account_type: "savings",
      account_last_digits: "5555",
      email_from: "alerts@sbi.bank.in",
      is_transaction: true,
      is_balance_info: false,
    });
    const tx = DB._queryOne(
      "SELECT transaction_id FROM transactions WHERE gmail_message_id = 'msg_noid'",
    );
    expect(tx.transaction_id).toBe("gmail_msg_noid");
  });
});

// ===========================================================================
// 16b. Merchant Rename Memory across Gmail imports (FINCO-50)
//
// End-to-end integration across the real Gmail import path + DB. A user renames a
// merchant on a Gmail-imported transaction and confirms (learn_merchant_name=true);
// a subsequent Gmail email carrying the SAME original merchant string must resolve to
// the renamed display name and link to the same merchant identity — without altering
// the transaction category.
// ===========================================================================
describe("Merchant Rename Memory — Gmail import path (FINCO-50)", () => {
  const baseEmail = {
    transaction_type: "expense",
    bank_name: "HDFC",
    account_type: "savings",
    account_last_digits: "1234",
    email_from: "alerts@hdfcbank.net",
    is_transaction: true,
    is_balance_info: false,
  };

  it("second Gmail import with same original merchant picks up the renamed display name", async () => {
    // 1. First Gmail email — raw bank merchant string, no merchant identity yet.
    const first = await Gmail._importTransaction({
      ...baseEmail,
      gmail_message_id: "rename_msg_1",
      amount: -450,
      description: "UPI payment",
      merchant_name: "PAYTM*SWIGGY",
      date: "2025-03-01",
    });
    expect(first).toBe("imported");

    const tx1 = DB._queryOne(
      "SELECT * FROM transactions WHERE gmail_message_id = 'rename_msg_1'",
    );
    expect(tx1.merchant_id).toBeNull();
    expect(tx1.merchant_name).toBe("PAYTM*SWIGGY");

    // 2. User renames the merchant and confirms the "apply to all" prompt.
    await DB.updateTransaction(tx1.id, {
      merchant_name: "Swiggy",
      learn_merchant_name: true,
    });

    const merchant = DB._queryOne("SELECT * FROM merchants WHERE display_name = ?", ["Swiggy"]);
    expect(merchant).not.toBeNull();

    // 3. Second Gmail email carrying the SAME original raw string arrives later.
    const second = await Gmail._importTransaction({
      ...baseEmail,
      gmail_message_id: "rename_msg_2",
      amount: -520,
      description: "UPI payment",
      merchant_name: "PAYTM*SWIGGY",
      date: "2025-03-10",
    });
    expect(second).toBe("imported");

    const tx2 = DB._queryOne(
      "SELECT * FROM transactions WHERE gmail_message_id = 'rename_msg_2'",
    );
    // The stored merchant_name is the RENAMED value and it links the same identity.
    expect(tx2.merchant_name).toBe("Swiggy");
    expect(tx2.merchant_id).toBe(merchant.id);
  });

  it("rename via Gmail-imported transaction does NOT alter its category", async () => {
    const foodCat = DB._queryOne("SELECT id FROM categories WHERE name = ?", ["Food & Dining"]);

    await Gmail._importTransaction({
      ...baseEmail,
      gmail_message_id: "rename_cat_1",
      amount: -300,
      description: "Food order",
      merchant_name: "ZOMATO ORDER",
      category: "Food & Dining",
      date: "2025-03-02",
    });
    const tx1 = DB._queryOne(
      "SELECT * FROM transactions WHERE gmail_message_id = 'rename_cat_1'",
    );
    expect(tx1.category_id).toBe(foodCat.id);

    await DB.updateTransaction(tx1.id, {
      merchant_name: "Zomato",
      learn_merchant_name: true,
    });

    const after = DB._queryOne("SELECT category_id FROM transactions WHERE id = ?", [tx1.id]);
    // The renamed merchant identity carries the transaction's existing category, unchanged.
    expect(after.category_id).toBe(foodCat.id);
    const merchant = DB._queryOne("SELECT * FROM merchants WHERE display_name = ?", ["Zomato"]);
    expect(merchant.category_id).toBe(foodCat.id);
  });

  it("declining the rename (learn_merchant_name=false) does NOT remap future Gmail imports", async () => {
    await Gmail._importTransaction({
      ...baseEmail,
      gmail_message_id: "rename_decline_1",
      amount: -75,
      description: "Ride",
      merchant_name: "OLA CABS RAW",
      date: "2025-03-03",
    });
    const tx1 = DB._queryOne(
      "SELECT * FROM transactions WHERE gmail_message_id = 'rename_decline_1'",
    );

    await DB.updateTransaction(tx1.id, {
      merchant_name: "Ola",
      learn_merchant_name: false,
    });

    // No merchant identity should have been created for the declined rename.
    const merchant = DB._queryOne("SELECT id FROM merchants WHERE display_name = ?", ["Ola"]);
    expect(merchant).toBeNull();

    // A subsequent Gmail email with the original string keeps the raw name and no identity.
    await Gmail._importTransaction({
      ...baseEmail,
      gmail_message_id: "rename_decline_2",
      amount: -80,
      description: "Ride",
      merchant_name: "OLA CABS RAW",
      date: "2025-03-11",
    });
    const tx2 = DB._queryOne(
      "SELECT * FROM transactions WHERE gmail_message_id = 'rename_decline_2'",
    );
    expect(tx2.merchant_name).toBe("OLA CABS RAW");
    expect(tx2.merchant_id).toBeNull();
  });
});

// ===========================================================================
// 17. Full extractTransactions pipeline (mocked fetch + LLM)
// ===========================================================================
describe("extractTransactions pipeline", () => {
  it("returns zero results when no new emails found", async () => {
    await Gmail.saveSettings({
      accessToken: "tok",
      refreshToken: "ref",
      tokenExpiry: Date.now() + 3600000,
    });

    // Mock fetch to return empty messages list
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [] }),
    });

    const result = await Gmail.extractTransactions({ days: 7 });
    expect(result.imported).toBe(0);
    expect(result.found).toBe(0);
  });

  it("processes emails through full pipeline with mocked LLM", async () => {
    await Gmail.saveSettings({
      accessToken: "tok",
      refreshToken: "ref",
      tokenExpiry: Date.now() + 3600000,
    });

    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      apiKey: "test-key",
      model: "test-model",
    });

    // Patch DB.getCategories to return synchronously (workaround for missing await bug)
    const origGetCategories = DB.getCategories;
    DB.getCategories = () => [
      { name: "Shopping", description: "Online shopping" },
      { name: "Food & Dining", description: "Restaurants" },
    ];

    const rawEmail = btoa(
      "From: alerts@hdfcbank.net\r\nSubject: Txn Alert\r\nDate: Wed, 15 Jan 2025 10:00:00\r\nContent-Type: text/plain\r\n\r\nRs 500 debited from account XX1234",
    );

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes("gmail.googleapis.com") && url.includes("/messages?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: "msg_pipeline" }] }),
        };
      }
      if (url.includes("gmail.googleapis.com") && url.includes("/messages/msg_pipeline")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ raw: rawEmail }),
        };
      }
      if (url.includes("groq.com")) {
        callCount++;
        if (callCount === 1) {
          // Extraction LLM call
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify([
                      {
                        email_index: 1,
                        amount: -500,
                        transaction_type: "expense",
                        date: "2025-01-15T10:00",
                        description: "Purchase | Method: UPI",
                        account_last_digits: "1234",
                        account_type: "savings",
                        bank_name: "HDFC",
                        is_transaction: true,
                        is_balance_info: false,
                      },
                    ]),
                  },
                },
              ],
            }),
          };
        }
        // Categorization LLM call
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '["Shopping"]' } }],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    try {
      const result = await Gmail.extractTransactions({ days: 7 });
      expect(result.imported).toBe(1);
      expect(result.found).toBeGreaterThanOrEqual(1);
      expect(result.errors).toBe(0);
    } finally {
      DB.getCategories = origGetCategories;
    }
  });

  it("handles skipped (already processed) messages", async () => {
    // Pre-save a processed ID
    await DB.saveProcessedGmailIds(["already_processed"]);

    await Gmail.saveSettings({
      accessToken: "tok",
      refreshToken: "ref",
      tokenExpiry: Date.now() + 3600000,
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "already_processed" }] }),
    });

    const result = await Gmail.extractTransactions({ days: 7 });
    expect(result.imported).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

// ===========================================================================
// 18. Balance Account Type Guard — INSERT (_getOrCreateAccount)
// ===========================================================================
describe("Balance Account Type Guard — INSERT", () => {
  it("debit account is created with balance=0 even when balance_after is set", async () => {
    const id = await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "debit",
      account_last_digits: "1111",
      email_from: "alerts@hdfcbank.net",
      balance_after: 50000,
      email_date: "2025-03-01T10:00",
    });
    const acc = DB._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    expect(acc.balance).toBe(0);
    expect(acc.balance_updated_at).toBeNull();
  });

  it("credit account is created with balance=0 even when balance_after is set", async () => {
    const id = await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "credit",
      account_last_digits: "2222",
      email_from: "alerts@hdfcbank.net",
      balance_after: 15000,
      email_date: "2025-03-01T10:00",
    });
    const acc = DB._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    expect(acc.balance).toBe(0);
    expect(acc.balance_updated_at).toBeNull();
  });

  it("savings account is created with correct balance when balance_after is set", async () => {
    const id = await Gmail._getOrCreateAccount({
      bank_name: "SBI",
      account_type: "savings",
      account_last_digits: "3333",
      email_from: "alerts@sbi.bank.in",
      balance_after: 25000,
      email_date: "2025-03-01T10:00",
    });
    const acc = DB._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    expect(acc.balance).toBe(25000);
    expect(acc.balance_updated_at).not.toBeNull();
  });

  it("current account is created with correct balance when balance_after is set", async () => {
    const id = await Gmail._getOrCreateAccount({
      bank_name: "ICICI",
      account_type: "current",
      account_last_digits: "4444",
      email_from: "alerts@icicibank.com",
      balance_after: 100000,
      email_date: "2025-03-01T10:00",
    });
    const acc = DB._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    expect(acc.balance).toBe(100000);
    expect(acc.balance_updated_at).not.toBeNull();
  });

  it("deposit account is created with correct balance when balance_after is set", async () => {
    const id = await Gmail._getOrCreateAccount({
      bank_name: "AXIS",
      account_type: "deposit",
      account_last_digits: "5555",
      email_from: "alerts@axisbank.com",
      balance_after: 75000,
      email_date: "2025-03-01T10:00",
    });
    const acc = DB._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    expect(acc.balance).toBe(75000);
    expect(acc.balance_updated_at).not.toBeNull();
  });

  it("debit account is created with balance=0 when no balance_after provided", async () => {
    const id = await Gmail._getOrCreateAccount({
      bank_name: "KOTAK",
      account_type: "debit",
      account_last_digits: "6666",
      email_from: "alerts@kotakbank.com",
    });
    const acc = DB._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    expect(acc.balance).toBe(0);
    expect(acc.balance_updated_at).toBeNull();
  });
});

// ===========================================================================
// 19. Balance Staleness Guard — UPDATE (_shouldUpdateBalance via _getOrCreateAccount)
// ===========================================================================
describe("Balance Staleness Guard — UPDATE via _getOrCreateAccount", () => {
  it("updates balance when stored balance_updated_at is null", async () => {
    // Create account first with no balance
    const id = await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "7001",
      email_from: "alerts@hdfcbank.net",
    });
    // Ensure balance_updated_at is null
    DB._exec("UPDATE accounts SET balance = 0, balance_updated_at = NULL WHERE id = ?", [id]);

    // Re-call with balance_after — storedUpdatedAt is null → should update
    await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "7001",
      email_from: "alerts@hdfcbank.net",
      balance_after: 10000,
      email_date: "2025-01-15T10:00",
    });
    const acc = DB._queryOne("SELECT balance FROM accounts WHERE id = ?", [id]);
    expect(acc.balance).toBe(10000);
  });

  it("updates balance when txEmailDate is newer than stored balance_updated_at", async () => {
    // Create account with balance from an older email
    await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "7002",
      email_from: "alerts@hdfcbank.net",
      balance_after: 10000,
      email_date: "2025-01-01T10:00",
    });

    // Re-call with newer email_date → should update to higher balance
    await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "7002",
      email_from: "alerts@hdfcbank.net",
      balance_after: 20000,
      email_date: "2025-06-01T10:00",
    });
    const acc = DB._queryOne(
      "SELECT balance FROM accounts WHERE account_identifier = 'HDFC_SAVINGS_7002'",
    );
    expect(acc.balance).toBe(20000);
  });

  it("does NOT update balance when txEmailDate is older than stored balance_updated_at", async () => {
    // Create account with balance from a NEWER email
    await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "7003",
      email_from: "alerts@hdfcbank.net",
      balance_after: 30000,
      email_date: "2025-06-01T10:00",
    });

    // Re-call with OLDER email_date → should NOT update
    await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "7003",
      email_from: "alerts@hdfcbank.net",
      balance_after: 5000,
      email_date: "2025-01-01T10:00",
    });
    const acc = DB._queryOne(
      "SELECT balance FROM accounts WHERE account_identifier = 'HDFC_SAVINGS_7003'",
    );
    expect(acc.balance).toBe(30000); // unchanged
  });

  it("does NOT update balance when txEmailDate equals stored balance_updated_at", async () => {
    const emailDate = "2025-03-15T10:00";
    // Create account with balance from this exact date
    await Gmail._getOrCreateAccount({
      bank_name: "SBI",
      account_type: "savings",
      account_last_digits: "7004",
      email_from: "alerts@sbi.bank.in",
      balance_after: 40000,
      email_date: emailDate,
    });

    // Re-call with SAME date → should NOT update (not strictly newer)
    await Gmail._getOrCreateAccount({
      bank_name: "SBI",
      account_type: "savings",
      account_last_digits: "7004",
      email_from: "alerts@sbi.bank.in",
      balance_after: 99999,
      email_date: emailDate,
    });
    const acc = DB._queryOne(
      "SELECT balance FROM accounts WHERE account_identifier = 'SBI_SAVINGS_7004'",
    );
    expect(acc.balance).toBe(40000); // unchanged
  });

  it("always updates balance when txEmailDate is null (defaults to now)", async () => {
    // Create account with balance from a specific past date
    await Gmail._getOrCreateAccount({
      bank_name: "PNB",
      account_type: "savings",
      account_last_digits: "7005",
      email_from: "alerts@pnbindia.in",
      balance_after: 50000,
      email_date: "2025-01-01T10:00",
    });

    // Re-call with null email_date → _shouldUpdateBalance(null, stored) returns true
    await Gmail._getOrCreateAccount({
      bank_name: "PNB",
      account_type: "savings",
      account_last_digits: "7005",
      email_from: "alerts@pnbindia.in",
      balance_after: 60000,
      email_date: null,
    });
    const acc = DB._queryOne(
      "SELECT balance FROM accounts WHERE account_identifier = 'PNB_SAVINGS_7005'",
    );
    expect(acc.balance).toBe(60000); // updated because null txEmailDate always triggers update
  });
});

// ===========================================================================
// 20. Balance Staleness Guard — _importTransaction
// ===========================================================================
describe("Balance Staleness Guard — _importTransaction", () => {
  it("balance-only email with newer date updates balance value", async () => {
    // First: create account with balance from older email
    await Gmail._importTransaction({
      gmail_message_id: "msg_stale_1a",
      amount: 5000,
      balance_after: 5000,
      transaction_type: "balance",
      is_transaction: false,
      is_balance_info: true,
      bank_name: "PNB",
      account_type: "savings",
      account_last_digits: "0010",
      email_from: "alerts@pnbindia.in",
      email_date: "2025-01-01T10:00",
    });

    // Second: import with NEWER date → _getOrCreateAccount updates balance in
    // the UPDATE path; _importTransaction re-checks and may return "skipped"
    // (see GitHub Issues — the return value is misleading when _getOrCreateAccount
    // already handled the update). The important invariant is the balance value.
    await Gmail._importTransaction({
      gmail_message_id: "msg_stale_1b",
      amount: 15000,
      balance_after: 15000,
      transaction_type: "balance",
      is_transaction: false,
      is_balance_info: true,
      bank_name: "PNB",
      account_type: "savings",
      account_last_digits: "0010",
      email_from: "alerts@pnbindia.in",
      email_date: "2025-06-01T10:00",
    });

    // Balance must reflect the newer email, not the older one
    const acc = DB._queryOne(
      "SELECT balance FROM accounts WHERE account_identifier = 'PNB_SAVINGS_0010'",
    );
    expect(acc.balance).toBe(15000);
  });

  it("balance-only email with older date does NOT overwrite newer balance", async () => {
    // First: create account with NEWER balance
    await Gmail._importTransaction({
      gmail_message_id: "msg_stale_2a",
      amount: 50000,
      balance_after: 50000,
      transaction_type: "balance",
      is_transaction: false,
      is_balance_info: true,
      bank_name: "SBI",
      account_type: "savings",
      account_last_digits: "0011",
      email_from: "alerts@sbi.bank.in",
      email_date: "2025-06-01T10:00",
    });

    // Second: import with OLDER date → should be skipped
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_stale_2b",
      amount: 1000,
      balance_after: 1000,
      transaction_type: "balance",
      is_transaction: false,
      is_balance_info: true,
      bank_name: "SBI",
      account_type: "savings",
      account_last_digits: "0011",
      email_from: "alerts@sbi.bank.in",
      email_date: "2025-01-01T10:00",
    });

    expect(result).toBe("skipped");
    const acc = DB._queryOne(
      "SELECT balance FROM accounts WHERE account_identifier = 'SBI_SAVINGS_0011'",
    );
    expect(acc.balance).toBe(50000); // unchanged
  });

  it("regular transaction with is_balance_info=true respects staleness guard on balance", async () => {
    // Import first transaction with newer email_date to set initial balance
    await Gmail._importTransaction({
      gmail_message_id: "msg_stale_3a",
      amount: -500,
      balance_after: 25000,
      transaction_type: "expense",
      is_transaction: true,
      is_balance_info: true,
      date: "2025-06-01T10:00",
      email_date: "2025-06-01T10:00",
      bank_name: "ICICI",
      account_type: "savings",
      account_last_digits: "0012",
      email_from: "alerts@icicibank.com",
    });

    // Import second transaction with OLDER email_date → balance must not change
    await Gmail._importTransaction({
      gmail_message_id: "msg_stale_3b",
      amount: -200,
      balance_after: 10000,
      transaction_type: "expense",
      is_transaction: true,
      is_balance_info: true,
      date: "2025-05-01T10:00",
      email_date: "2025-01-01T10:00",
      bank_name: "ICICI",
      account_type: "savings",
      account_last_digits: "0012",
      email_from: "alerts@icicibank.com",
    });

    const acc = DB._queryOne(
      "SELECT balance FROM accounts WHERE account_identifier = 'ICICI_SAVINGS_0012'",
    );
    expect(acc.balance).toBe(25000); // unchanged — staleness guard blocked the older update
  });

  it("balance-only email with null email_date always updates balance", async () => {
    // First: create account with balance from a past date
    await Gmail._importTransaction({
      gmail_message_id: "msg_stale_4a",
      amount: 8000,
      balance_after: 8000,
      transaction_type: "balance",
      is_transaction: false,
      is_balance_info: true,
      bank_name: "AXIS",
      account_type: "savings",
      account_last_digits: "0013",
      email_from: "alerts@axisbank.com",
      email_date: "2025-01-01T10:00",
    });

    // Second: import with null email_date → _shouldUpdateBalance(null, stored) returns true
    const result = await Gmail._importTransaction({
      gmail_message_id: "msg_stale_4b",
      amount: 12000,
      balance_after: 12000,
      transaction_type: "balance",
      is_transaction: false,
      is_balance_info: true,
      bank_name: "AXIS",
      account_type: "savings",
      account_last_digits: "0013",
      email_from: "alerts@axisbank.com",
      email_date: null,
    });

    expect(result).toBe("balance_update");
    const acc = DB._queryOne(
      "SELECT balance FROM accounts WHERE account_identifier = 'AXIS_SAVINGS_0013'",
    );
    expect(acc.balance).toBe(12000); // updated
  });
});

// ===========================================================================
// 21. extractTransactions — errorDetails
// ===========================================================================
describe("extractTransactions — errorDetails", () => {
  const defaultTx = {
    amount: -100,
    is_transaction: true,
    description: "UPI Payment",
    account_last_digits: "1234",
    account_type: "savings",
    bank_name: "HDFC",
    transaction_type: "expense",
    date: "2025-01-15T10:00",
    is_balance_info: false,
  };

  function makeRaw({ from = "bank@example.com", subject = "Txn Alert" } = {}) {
    const raw = `From: ${from}\r\nSubject: ${subject}\r\nDate: Wed, 15 Jan 2025 10:00:00\r\nContent-Type: text/plain\r\n\r\nTest body`;
    return btoa(raw);
  }

  function mockPipeline({ rawEmails = [makeRaw()], extractedTxs = [defaultTx] } = {}) {
    // Configure AI provider so the LLM extraction path is used (not heuristic fallback)
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      apiKey: "test-key",
      model: "test-model",
    });
    localStorageData["fincoach-ai-external-consent"] = JSON.stringify({
      provider: "groq",
      granted: true,
      source: "test",
      granted_at: "2026-07-21T00:00:00.000Z",
    });
    vi.spyOn(Gmail, "searchEmails").mockResolvedValue({
      messages: rawEmails.map((raw, i) => ({ id: `msg_ed_${i}`, raw })),
      skippedCount: 0,
    });
    vi.spyOn(DB, "getCategories").mockReturnValue([]);
    vi.spyOn(Gmail, "_callLLM")
      .mockResolvedValueOnce(JSON.stringify(extractedTxs))
      .mockResolvedValueOnce(JSON.stringify(extractedTxs.map(() => "Other")));
  }

  it("errorDetails is empty array when all transactions import successfully", async () => {
    mockPipeline();
    vi.spyOn(Gmail, "_importTransaction").mockResolvedValue("imported");

    const result = await Gmail.extractTransactions({ days: 7 });
    expect(result.errorDetails).toEqual([]);
    expect(result.errors).toBe(0);
  });

  it("errorDetails populated when _importTransaction returns unrecognized result", async () => {
    mockPipeline({
      rawEmails: [makeRaw({ from: "bank@example.com", subject: "Txn Alert" })],
      extractedTxs: [{ ...defaultTx, description: "UPI Payment" }],
    });
    vi.spyOn(Gmail, "_importTransaction").mockResolvedValue("error");

    const result = await Gmail.extractTransactions({ days: 7 });
    expect(result.errors).toBe(1);
    expect(result.errorDetails.length).toBe(1);
    expect(result.errorDetails[0].subject).toBe("Txn Alert");
    expect(result.errorDetails[0].from).toBe("bank@example.com");
    expect(result.errorDetails[0].description).toBe("UPI Payment");
    expect(result.errorDetails[0].reason).toBe("Could not parse transaction");
  });

  it("errorDetails populated when _importTransaction throws", async () => {
    mockPipeline();
    vi.spyOn(Gmail, "_importTransaction").mockRejectedValue(new Error("DB write failed"));

    const result = await Gmail.extractTransactions({ days: 7 });
    expect(result.errors).toBe(1);
    expect(result.errorDetails[0].reason).toBe("DB write failed");
  });

  it("errorDetails falls back gracefully for tx with missing fields", async () => {
    const rawNoHeaders = btoa("Content-Type: text/plain\r\n\r\nBody only");
    mockPipeline({
      rawEmails: [rawNoHeaders],
      extractedTxs: [{ ...defaultTx, description: undefined }],
    });
    vi.spyOn(Gmail, "_importTransaction").mockResolvedValue("error");

    const result = await Gmail.extractTransactions({ days: 7 });
    expect(result.errorDetails[0].subject).toBe("");
    expect(result.errorDetails[0].from).toBe("");
    expect(result.errorDetails[0].description).toBe("");
  });

  it('"skipped" result is NOT counted as error', async () => {
    mockPipeline({
      rawEmails: [makeRaw(), makeRaw()],
      extractedTxs: [defaultTx, defaultTx],
    });
    vi.spyOn(Gmail, "_importTransaction")
      .mockResolvedValueOnce("skipped")
      .mockResolvedValueOnce("imported");

    const result = await Gmail.extractTransactions({ days: 7 });
    expect(result.errors).toBe(0);
    expect(result.errorDetails).toEqual([]);
  });

  it("multiple errors accumulate all errorDetails entries", async () => {
    mockPipeline({
      rawEmails: [makeRaw(), makeRaw()],
      extractedTxs: [defaultTx, defaultTx],
    });
    vi.spyOn(Gmail, "_importTransaction").mockResolvedValue("error");

    const result = await Gmail.extractTransactions({ days: 7 });
    expect(result.errors).toBe(2);
    expect(result.errorDetails.length).toBe(2);
  });
});

// ===========================================================================
// 22. BUG-GDRIVE-03: null date fallback in _importTransaction
// ===========================================================================
describe("BUG-GDRIVE-03: null date fallback in _importTransaction", () => {
  const baseTransaction = {
    gmail_message_id: "msg_null_date",
    amount: -250,
    description: "Null date purchase",
    transaction_type: "expense",
    bank_name: "HDFC",
    account_type: "savings",
    account_last_digits: "9999",
    email_from: "alerts@hdfcbank.net",
    is_transaction: true,
    is_balance_info: false,
  };

  it("_importTransaction with date: null returns 'imported' (not 'error')", async () => {
    const result = await Gmail._importTransaction({
      ...baseTransaction,
      date: null,
    });
    expect(result).toBe("imported");
  });

  it("_importTransaction with date: null stores a valid parseable date (not NaN-producing)", async () => {
    await Gmail._importTransaction({
      ...baseTransaction,
      gmail_message_id: "msg_null_date_valid",
      date: null,
    });

    const tx = DB._queryOne(
      "SELECT date FROM transactions WHERE description = ?",
      ["Null date purchase"],
    );
    expect(tx).toBeTruthy();

    // Date must be parseable — not NaN. The stored value includes the time component
    // (e.g. "2026-05-19T00:00") which is the normal format for gmail-imported transactions.
    const ms = Date.parse(tx.date);
    expect(Number.isNaN(ms)).toBe(false);

    // Must start with a valid date prefix YYYY-MM-DD
    expect(tx.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("stored date does NOT contain the malformed '000T00:00' pattern (regression guard)", async () => {
    // Before fix: tx.date || _now() where _now() returns a datetime like
    // "2025-07-10 12:00:00.000Z" → after split("T")[0] → "2025-07-10 12:00:00.000"
    // The old code used `tx.date || _now()` which would set parsedDate to the
    // full datetime, then the .includes("T") check would be false (uses space)
    // causing parsedDate to become "2025-07-10 12:00:00.000T00:00" on append
    await Gmail._importTransaction({
      ...baseTransaction,
      gmail_message_id: "msg_null_date_regression",
      description: "Regression guard purchase",
      date: null,
    });

    const tx = DB._queryOne(
      "SELECT date FROM transactions WHERE description = ?",
      ["Regression guard purchase"],
    );
    expect(tx).toBeTruthy();
    expect(tx.date).not.toContain("000T00:00");
    expect(tx.date).not.toContain("NaN");
  });
});

// ===========================================================================
// BUG-GMAIL-01: zero balances must not be treated as missing
// ===========================================================================
describe("BUG-GMAIL-01: zero balance_after is treated as a valid balance", () => {
  beforeEach(freshDB);

  it("_getOrCreateAccount: creates account with balance=0 and sets balanceUpdatedAt when balance_after is 0", async () => {
    await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "9001",
      email_from: "alerts@hdfcbank.net",
      balance_after: 0,
      email_date: "2025-03-01T10:00",
    });
    const acc = DB._queryOne(
      "SELECT balance, balance_updated_at FROM accounts WHERE account_identifier = 'HDFC_SAVINGS_9001'",
    );
    expect(acc).toBeTruthy();
    expect(acc.balance).toBe(0);
    expect(acc.balance_updated_at).not.toBeNull();
  });

  it("_getOrCreateAccount: updates existing account balance to 0 when balance_after is 0", async () => {
    const id = await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "9002",
      email_from: "alerts@hdfcbank.net",
      balance_after: 5000,
      email_date: "2025-01-01T10:00",
    });
    // Now update with balance_after = 0 and a newer date
    await Gmail._getOrCreateAccount({
      bank_name: "HDFC",
      account_type: "savings",
      account_last_digits: "9002",
      email_from: "alerts@hdfcbank.net",
      balance_after: 0,
      email_date: "2025-06-01T10:00",
    });
    const acc = DB._queryOne("SELECT balance FROM accounts WHERE id = ?", [id]);
    expect(acc.balance).toBe(0);
  });

  it("_importTransaction: balance-only tx with balance_after=0 does not return 'error'", async () => {
    await Gmail._getOrCreateAccount({
      bank_name: "SBI",
      account_type: "savings",
      account_last_digits: "9003",
      email_from: "alerts@sbi.co.in",
    });
    const result = await Gmail._importTransaction({
      bank_name: "SBI",
      account_type: "savings",
      account_last_digits: "9003",
      email_from: "alerts@sbi.co.in",
      is_balance_info: true,
      transaction_type: "balance",
      balance_after: 0,
      email_date: "2025-04-01T10:00",
      gmail_message_id: "zero-bal-msg-1",
      amount: null,
      description: "Balance update",
      date: "2025-04-01",
    });
    // Both 'balance_update' and 'skipped' indicate success — the bug was returning 'error' for zero balance
    expect(result).not.toBe("error");
    // Verify balance was actually stored as 0
    const acc = DB._queryOne(
      "SELECT balance, balance_updated_at FROM accounts WHERE account_identifier = 'SBI_SAVINGS_9003'",
    );
    expect(acc.balance).toBe(0);
    expect(acc.balance_updated_at).not.toBeNull();
  });
});

// ===========================================================================
// 22. _extractWithRegex
// ===========================================================================
describe("_extractWithRegex", () => {
  it("extracts ₹ prefix debit as expense", () => {
    const result = Gmail._extractWithRegex({ text: "₹2,500.00 debited from your account" });
    expect(result).not.toBeNull();
    expect(result.amount).toBe(-2500);
    expect(result.transaction_type).toBe("expense");
  });

  it("extracts Rs. prefix debit", () => {
    const result = Gmail._extractWithRegex({ text: "Rs. 450 debited from A/c" });
    expect(result).not.toBeNull();
    expect(result.amount).toBe(-450);
  });

  it("extracts INR credit as income", () => {
    const result = Gmail._extractWithRegex({ text: "INR 50000 credited to your account" });
    expect(result).not.toBeNull();
    expect(result.amount).toBe(50000);
    expect(result.transaction_type).toBe("income");
  });

  it("extracts UPI handle", () => {
    const result = Gmail._extractWithRegex({ text: "merchant@paytm paid Rs 500 debited" });
    expect(result).not.toBeNull();
    expect(result.merchant_upi_id).toBe("merchant@paytm");
  });

  it("extracts account last 4 digits", () => {
    const result = Gmail._extractWithRegex({ text: "A/c XX1234 debited Rs 100" });
    expect(result).not.toBeNull();
    expect(result.account_last_digits).toBe("1234");
  });

  it("passes through email date from parsedEmail", () => {
    const result = Gmail._extractWithRegex({ text: "Rs 100 debited", date: "2025-12-01T14:30" });
    expect(result).not.toBeNull();
    expect(result.date).toBe("2025-12-01T14:30");
  });

  it("returns null when no amount found", () => {
    const result = Gmail._extractWithRegex({ text: "Your account details have been updated." });
    expect(result).toBeNull();
  });

  it("defaults to expense when no debit/credit keyword present", () => {
    const result = Gmail._extractWithRegex({ text: "Rs 100 transaction processed" });
    expect(result).not.toBeNull();
    expect(result.transaction_type).toBe("expense");
    expect(result.amount).toBe(-100);
  });
});

// ===========================================================================
// 23. _categorizeWithHeuristics
// ===========================================================================
describe("_categorizeWithHeuristics", () => {
  it("keyword matching maps description to category", async () => {
    const transactions = [
      { description: "food & dining at restaurant", merchant_upi_id: null, merchant_name: null },
    ];
    const categories = [
      { id: 1, name: "Food & Dining" },
      { id: 2, name: "Shopping" },
    ];
    const results = await Gmail._categorizeWithHeuristics(transactions, categories);
    expect(results[0]).toBe("Food & Dining");
  });

  it("returns Other when no match", async () => {
    const transactions = [
      { description: "xyz unknown 12345", merchant_upi_id: null, merchant_name: null },
    ];
    const categories = [
      { id: 1, name: "Shopping" },
      { id: 2, name: "Food" },
    ];
    const results = await Gmail._categorizeWithHeuristics(transactions, categories);
    expect(results[0]).toBe("Other");
  });

  it("returns array of same length as input", async () => {
    const transactions = [
      { description: "t1", merchant_upi_id: null, merchant_name: null },
      { description: "t2", merchant_upi_id: null, merchant_name: null },
      { description: "t3", merchant_upi_id: null, merchant_name: null },
    ];
    const results = await Gmail._categorizeWithHeuristics(transactions, []);
    expect(results).toHaveLength(3);
  });

  it("all items are strings", async () => {
    const transactions = [
      { description: "t1", merchant_upi_id: null, merchant_name: null },
      { description: "food & dining lunch", merchant_upi_id: null, merchant_name: null },
    ];
    const categories = [{ id: 1, name: "Food & Dining" }];
    const results = await Gmail._categorizeWithHeuristics(transactions, categories);
    expect(results.every((r) => typeof r === "string")).toBe(true);
  });
});

// ===========================================================================
// 24. extractTransactions — heuristic path
// ===========================================================================
describe("extractTransactions — heuristic path", () => {
  async function setupGmailConnection() {
    await Gmail.saveSettings({
      accessToken: "tok",
      refreshToken: "ref",
      tokenExpiry: Date.now() + 3600000,
    });
  }

  const parseableRaw = btoa(
    "From: alerts@hdfcbank.net\r\nSubject: Txn Alert\r\nDate: Wed, 15 Jan 2025 10:00:00\r\nContent-Type: text/plain\r\n\r\nRs 500 debited from A/c XX9801",
  );

  const unparseableRaw = btoa(
    "From: alerts@hdfcbank.net\r\nSubject: Account Update\r\nDate: Wed, 15 Jan 2025 10:00:00\r\nContent-Type: text/plain\r\n\r\nYour account details have been updated.",
  );

  function mockEmailFetch(msgId, rawEmail) {
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes("gmail.googleapis.com") && url.includes("/messages?")) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: msgId }] }) };
      }
      if (url.includes("gmail.googleapis.com") && url.includes(`/messages/${msgId}`)) {
        return { ok: true, status: 200, json: async () => ({ raw: rawEmail }) };
      }
      return { ok: false, status: 404 };
    });
  }

  it("calls _extractWithRegex when AI not configured", async () => {
    await setupGmailConnection();
    const spy = vi.spyOn(Gmail, "_extractWithRegex").mockReturnValue({
      amount: -500,
      transaction_type: "expense",
      date: "2025-01-15T10:00",
      description: "Method: Bank Transfer",
      merchant_upi_id: null,
      merchant_name: null,
      account_last_digits: "9801",
      account_type: "savings",
      bank_name: "HDFC",
      balance_after: null,
      transaction_id: null,
      category: null,
      is_transaction: true,
      is_balance_info: false,
    });
    mockEmailFetch("msg_h1", parseableRaw);
    await Gmail.extractTransactions({ days: 7 });
    expect(spy).toHaveBeenCalled();
  });

  it("does not call _callLLM when AI not configured", async () => {
    await setupGmailConnection();
    const spy = vi.spyOn(Gmail, "_callLLM");
    vi.spyOn(Gmail, "_extractWithRegex").mockReturnValue({
      amount: -100,
      transaction_type: "expense",
      date: "2025-01-15T10:00",
      description: "Method: Bank Transfer",
      merchant_upi_id: null,
      merchant_name: null,
      account_last_digits: "9802",
      account_type: "savings",
      bank_name: "HDFC",
      balance_after: null,
      transaction_id: null,
      category: null,
      is_transaction: true,
      is_balance_info: false,
    });
    mockEmailFetch("msg_h2", parseableRaw);
    await Gmail.extractTransactions({ days: 7 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("heuristic_mode is true in result when no AI configured", async () => {
    await setupGmailConnection();
    vi.spyOn(Gmail, "_extractWithRegex").mockReturnValue({
      amount: -100,
      transaction_type: "expense",
      date: "2025-01-15T10:00",
      description: "Method: Bank Transfer",
      merchant_upi_id: null,
      merchant_name: null,
      account_last_digits: "9803",
      account_type: "savings",
      bank_name: "HDFC",
      balance_after: null,
      transaction_id: null,
      category: null,
      is_transaction: true,
      is_balance_info: false,
    });
    mockEmailFetch("msg_h3", parseableRaw);
    const result = await Gmail.extractTransactions({ days: 7 });
    expect(result.heuristic_mode).toBe(true);
  });

  it("falls back to heuristic mode when external AI consent is missing", async () => {
    await setupGmailConnection();
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      apiKey: "test-key",
      model: "test-model",
    });
    vi.spyOn(Gmail, "_extractWithRegex").mockReturnValue({
      amount: -100,
      transaction_type: "expense",
      date: "2025-01-15T10:00",
      description: "Method: Bank Transfer",
      merchant_upi_id: null,
      merchant_name: null,
      account_last_digits: "9804",
      account_type: "savings",
      bank_name: "HDFC",
      balance_after: null,
      transaction_id: null,
      category: null,
      is_transaction: true,
      is_balance_info: false,
    });
    const spy = vi.spyOn(Gmail, "_callLLM");
    mockEmailFetch("msg_h4b", parseableRaw);
    const result = await Gmail.extractTransactions({ days: 7 });
    expect(spy).not.toHaveBeenCalled();
    expect(result.heuristic_mode).toBe(true);
    expect(result.consent_required).toBe(true);
  });

  it("increments errors count when regex returns null", async () => {
    await setupGmailConnection();
    mockEmailFetch("msg_h4", unparseableRaw);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await Gmail.extractTransactions({ days: 7 });
    warnSpy.mockRestore();
    expect(result.errors).toBeGreaterThan(0);
  });

  it("calls _callLLM when AI is configured", async () => {
    await setupGmailConnection();
    localStorageData["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      apiKey: "test-key",
      model: "test-model",
    });
    localStorageData["fincoach-ai-external-consent"] = JSON.stringify({
      provider: "groq",
      granted: true,
      source: "test",
      granted_at: "2026-07-21T00:00:00.000Z",
    });
    const spy = vi.spyOn(Gmail, "_callLLM").mockResolvedValue(JSON.stringify([]));
    mockEmailFetch("msg_h5", parseableRaw);
    await Gmail.extractTransactions({ days: 7 });
    expect(spy).toHaveBeenCalled();
  });
});

describe("categorization prompt masking", () => {
  it("masks merchant and bank/source labels in categorization prompts", () => {
    const prompt = Gmail._buildCategorizationPrompt(
      [
        {
          merchant_name: "Blinkit",
          description: "Paid via paytm-blinkit@ptybl",
          amount: -450,
          bank_name: "HDFC Savings",
        },
      ],
      [{ name: "Food", description: "Food orders" }],
    );

    expect(prompt).not.toContain("paytm-blinkit@ptybl");
    expect(prompt).toContain("pa***@[UPI]");
    expect(prompt).toContain("Merchant: Bl*****");
    expect(prompt).toContain("Bank/Source: HD** Sa*****");
  });
});

// ===========================================================================
// 25. Custom sender filtering in searchEmails query
// ===========================================================================
describe("custom sender filtering in query", () => {
  async function setupGmailConnection() {
    await Gmail.saveSettings({
      accessToken: "tok",
      refreshToken: "ref",
      tokenExpiry: Date.now() + 3600000,
    });
  }

  function mockEmptyFetch() {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [] }),
    });
  }

  function capturedQuery() {
    const calls = globalThis.fetch.mock.calls;
    const searchCall = calls.find((c) => c[0].includes("messages?"));
    if (!searchCall) return null;
    const urlStr = searchCall[0];
    const url = new URL(urlStr);
    return url.searchParams.get("q");
  }

  beforeEach(async () => {
    await setupGmailConnection();
  });

  it("no custom senders → query contains BANK_DOMAINS wildcard patterns", async () => {
    mockEmptyFetch();
    await Gmail.searchEmails({ days: 7 });
    const q = capturedQuery();
    expect(q).not.toBeNull();
    // BANK_DOMAINS entries like hdfcbank.net → from:*@hdfcbank.net
    expect(q).toContain("from:*@hdfcbank");
  });

  it("custom senders set → query contains from: for each custom sender", async () => {
    localStorageData["fincoach-gmail-custom-senders"] = "alerts@hdfc.net,noreply@sbi.co.in";
    mockEmptyFetch();
    await Gmail.searchEmails({ days: 7 });
    const q = capturedQuery();
    expect(q).not.toBeNull();
    expect(q).toContain("from:alerts@hdfc.net");
    expect(q).toContain("from:noreply@sbi.co.in");
  });

  it("custom senders set → query does NOT contain bank domain wildcard patterns", async () => {
    localStorageData["fincoach-gmail-custom-senders"] = "alerts@hdfc.net,noreply@sbi.co.in";
    mockEmptyFetch();
    await Gmail.searchEmails({ days: 7 });
    const q = capturedQuery();
    expect(q).not.toBeNull();
    expect(q).not.toContain("*@hdfcbank");
    expect(q).not.toContain("*@alerts.sbi");
  });

  it("comma-separated values with extra spaces are trimmed in the query", async () => {
    localStorageData["fincoach-gmail-custom-senders"] = "  alerts@hdfc.net  ,  noreply@sbi.co.in  ";
    mockEmptyFetch();
    await Gmail.searchEmails({ days: 7 });
    const q = capturedQuery();
    expect(q).not.toBeNull();
    // Must be exact trimmed addresses — no leading/trailing spaces
    expect(q).toContain("from:alerts@hdfc.net");
    expect(q).toContain("from:noreply@sbi.co.in");
    expect(q).not.toContain("from:  alerts@hdfc.net");
  });

  it("empty custom senders string → falls back to BANK_DOMAINS wildcard patterns", async () => {
    localStorageData["fincoach-gmail-custom-senders"] = "";
    mockEmptyFetch();
    await Gmail.searchEmails({ days: 7 });
    const q = capturedQuery();
    expect(q).not.toBeNull();
    expect(q).toContain("from:*@hdfcbank");
  });

  it("single custom sender appears in query as from:<address>", async () => {
    localStorageData["fincoach-gmail-custom-senders"] = "txn@icici.bank";
    mockEmptyFetch();
    await Gmail.searchEmails({ days: 7 });
    const q = capturedQuery();
    expect(q).toContain("from:txn@icici.bank");
  });

  it("injection attempt in custom senders is filtered out, query falls back to BANK_DOMAINS", async () => {
    // All senders are invalid (injection attempt) → all filtered → fall back to BANK_DOMAINS
    localStorageData["fincoach-gmail-custom-senders"] = "bank@evil.com) OR (is:unread";
    mockEmptyFetch();
    await Gmail.searchEmails({ days: 7 });
    const q = capturedQuery();
    expect(q).not.toBeNull();
    // Injection payload must not appear in the query
    expect(q).not.toContain(") OR (is:unread");
    // Must have fallen back to BANK_DOMAINS
    expect(q).toContain("from:*@hdfcbank");
  });

  it("mixed valid and invalid senders — only valid ones appear in query", async () => {
    localStorageData["fincoach-gmail-custom-senders"] =
      "alerts@hdfc.net,bad value,noreply@sbi.co.in";
    mockEmptyFetch();
    await Gmail.searchEmails({ days: 7 });
    const q = capturedQuery();
    expect(q).not.toBeNull();
    // Valid senders present
    expect(q).toContain("from:alerts@hdfc.net");
    expect(q).toContain("from:noreply@sbi.co.in");
    // Invalid sender must NOT appear
    expect(q).not.toContain("from:bad value");
  });
});

// ===========================================================================
// 26. Gmail.maybeAutoSync
// ===========================================================================
describe("Gmail.maybeAutoSync", () => {
	it("does nothing when auto-sync is not enabled in localStorage", async () => {
		// GMAIL_AUTO_SYNC_ENABLED_KEY not set → getItem returns null → guard exits
		const spy = vi.spyOn(Gmail, "extractTransactions").mockResolvedValue({ imported: 0 });
		await Gmail.maybeAutoSync();
		expect(spy).not.toHaveBeenCalled();
	});

	it("does nothing when Gmail is not connected (no tokens)", async () => {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";
		// localStorageData has no token key → isConnected() returns false
		const spy = vi.spyOn(Gmail, "extractTransactions").mockResolvedValue({ imported: 0 });
		await Gmail.maybeAutoSync();
		expect(spy).not.toHaveBeenCalled();
	});

	it("does nothing when last sync is within the 15-minute cooldown", async () => {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";
		await Gmail.saveSettings({ accessToken: "tok", refreshToken: "ref" });
		// 800_000 ms ago (13 min) — still within the 15-minute cooldown window
		localStorageData["fincoach-gmail-auto-sync-last"] = String(Date.now() - 800_000);
		const spy = vi.spyOn(Gmail, "extractTransactions").mockResolvedValue({ imported: 0 });
		await Gmail.maybeAutoSync();
		expect(spy).not.toHaveBeenCalled();
	});

	it("calls extractTransactions with correct args when all guards pass", async () => {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";
		await Gmail.saveSettings({ accessToken: "tok", refreshToken: "ref" });
		// No GMAIL_AUTO_SYNC_LAST_KEY → cooldown not active
		const spy = vi.spyOn(Gmail, "extractTransactions").mockResolvedValue({ imported: 0 });
		await Gmail.maybeAutoSync();
		expect(spy).toHaveBeenCalledWith({ days: 1, auto_import: true });
	});

	it("updates GMAIL_AUTO_SYNC_LAST_KEY in localStorage after sync", async () => {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";
		await Gmail.saveSettings({ accessToken: "tok", refreshToken: "ref" });
		vi.spyOn(Gmail, "extractTransactions").mockResolvedValue({ imported: 0 });
		const before = Date.now();
		await Gmail.maybeAutoSync();
		const saved = Number(localStorageData["fincoach-gmail-auto-sync-last"] || "0");
		expect(saved).toBeGreaterThanOrEqual(before);
	});

	it("dispatches gmail-auto-sync-complete CustomEvent with imported count when imported > 0", async () => {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";
		await Gmail.saveSettings({ accessToken: "tok", refreshToken: "ref" });
		vi.spyOn(Gmail, "extractTransactions").mockResolvedValue({ imported: 3 });
		let capturedDetail = null;
		document.addEventListener(
			"gmail-auto-sync-complete",
			(e) => {
				capturedDetail = e.detail;
			},
			{ once: true },
		);
		await Gmail.maybeAutoSync();
		expect(capturedDetail).toEqual({ imported: 3 });
	});

	it("does not dispatch gmail-auto-sync-complete when imported is 0", async () => {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";
		await Gmail.saveSettings({ accessToken: "tok", refreshToken: "ref" });
		vi.spyOn(Gmail, "extractTransactions").mockResolvedValue({ imported: 0 });
		let fired = false;
		document.addEventListener("gmail-auto-sync-complete", () => {
			fired = true;
		});
		await Gmail.maybeAutoSync();
		expect(fired).toBe(false);
	});

	it("never throws even when extractTransactions rejects", async () => {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";
		await Gmail.saveSettings({ accessToken: "tok", refreshToken: "ref" });
		vi.spyOn(Gmail, "extractTransactions").mockRejectedValue(new Error("network error"));
		await expect(Gmail.maybeAutoSync()).resolves.toBeUndefined();
	});
});

// ===========================================================================
// 27. Gmail.maybeAutoSync — event dispatching (gmail-sync-start / gmail-sync-end)
// ===========================================================================
describe("Gmail.maybeAutoSync — event dispatching", () => {
	function setupConnected() {
		localStorageData["fincoach-gmail-auto-sync-enabled"] = "true";
		Gmail.saveSettings({ accessToken: "tok", refreshToken: "ref" });
	}

	it("dispatches gmail-sync-start before calling extractTransactions", async () => {
		await setupConnected();
		let startFiredBeforeExtract = false;
		vi.spyOn(Gmail, "extractTransactions").mockImplementation(async () => {
			startFiredBeforeExtract = startFiredBeforeMark;
			return { imported: 0 };
		});
		let startFiredBeforeMark = false;
		document.addEventListener("gmail-sync-start", () => { startFiredBeforeMark = true; }, { once: true });
		await Gmail.maybeAutoSync();
		expect(startFiredBeforeExtract).toBe(true);
	});

	it("dispatches gmail-sync-end with imported count and null error on success", async () => {
		await setupConnected();
		vi.spyOn(Gmail, "extractTransactions").mockResolvedValue({ imported: 3 });
		let endDetail = null;
		document.addEventListener("gmail-sync-end", (e) => { endDetail = e.detail; }, { once: true });
		await Gmail.maybeAutoSync();
		expect(endDetail).toEqual({ imported: 3, error: null });
	});

	it("dispatches gmail-sync-end with error message and imported=0 on failure", async () => {
		await setupConnected();
		vi.spyOn(Gmail, "extractTransactions").mockRejectedValue(new Error("network error"));
		let endDetail = null;
		document.addEventListener("gmail-sync-end", (e) => { endDetail = e.detail; }, { once: true });
		await Gmail.maybeAutoSync();
		expect(endDetail).toEqual({ imported: 0, error: "network error" });
	});

	it("does not throw when extractTransactions rejects — error is swallowed", async () => {
		await setupConnected();
		vi.spyOn(Gmail, "extractTransactions").mockRejectedValue(new Error("network error"));
		await expect(Gmail.maybeAutoSync()).resolves.toBeUndefined();
	});

	it("respects 15-minute cooldown — does not dispatch gmail-sync-start when last sync was 13 min ago", async () => {
		await setupConnected();
		// 800_000 ms = ~13 min ago — within the 900_000 ms (15 min) cooldown
		localStorageData["fincoach-gmail-auto-sync-last"] = String(Date.now() - 800_000);
		let started = false;
		document.addEventListener("gmail-sync-start", () => { started = true; }, { once: true });
		await Gmail.maybeAutoSync();
		expect(started).toBe(false);
	});

	it("dispatches gmail-sync-start after cooldown passes — last sync was 16+ min ago", async () => {
		await setupConnected();
		// 1_000_000 ms = ~16.7 min ago — past the 900_000 ms (15 min) cooldown
		localStorageData["fincoach-gmail-auto-sync-last"] = String(Date.now() - 1_000_000);
		vi.spyOn(Gmail, "extractTransactions").mockResolvedValue({ imported: 0 });
		let started = false;
		document.addEventListener("gmail-sync-start", () => { started = true; }, { once: true });
		await Gmail.maybeAutoSync();
		expect(started).toBe(true);
	});
});

// ===========================================================================
// Sub-based encryption support — getAccountSub / _fetchAndStoreSub
// ===========================================================================
describe("getAccountSub", () => {
	it("returns empty string when no sub is stored in settings", () => {
		// No settings saved
		expect(Gmail.getAccountSub()).toBe("");
	});

	it("returns the cached sub from settings", async () => {
		await Gmail.saveSettings({ sub: "google-sub-12345" });
		expect(Gmail.getAccountSub()).toBe("google-sub-12345");
	});

	it("returns empty string when settings exist but sub is absent", async () => {
		await Gmail.saveSettings({ accessToken: "tok", email: "user@example.com" });
		expect(Gmail.getAccountSub()).toBe("");
	});
});

describe("_fetchAndStoreSub", () => {
	it("calls the userinfo endpoint with the bearer token", async () => {
		await Gmail.saveSettings({
			accessToken: "valid-tok",
			refreshToken: "ref",
			tokenExpiry: Date.now() + 3_600_000,
		});

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ sub: "fetched-sub-xyz" }),
		});

		await Gmail._fetchAndStoreSub();

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://www.googleapis.com/oauth2/v3/userinfo",
			expect.objectContaining({
				headers: { Authorization: "Bearer valid-tok" },
			}),
		);
	});

	it("saves the sub to Gmail settings on a successful response", async () => {
		await Gmail.saveSettings({
			accessToken: "valid-tok",
			refreshToken: "ref",
			tokenExpiry: Date.now() + 3_600_000,
		});

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ sub: "saved-sub-abc" }),
		});

		await Gmail._fetchAndStoreSub();

		expect(Gmail.getSettings().sub).toBe("saved-sub-abc");
	});

	it("does not update settings when the response is not ok", async () => {
		await Gmail.saveSettings({
			accessToken: "valid-tok",
			refreshToken: "ref",
			tokenExpiry: Date.now() + 3_600_000,
		});

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
		});

		await Gmail._fetchAndStoreSub(); // must not throw

		expect(Gmail.getSettings().sub).toBe("");
	});

	it("does not save sub when data.sub is absent in the response", async () => {
		await Gmail.saveSettings({
			accessToken: "valid-tok",
			refreshToken: "ref",
			tokenExpiry: Date.now() + 3_600_000,
		});

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({}), // no sub field
		});

		await Gmail._fetchAndStoreSub();

		expect(Gmail.getSettings().sub).toBe("");
	});

	it("swallows errors silently so it is safe to call fire-and-forget", async () => {
		await Gmail.saveSettings({
			accessToken: "valid-tok",
			refreshToken: "ref",
			tokenExpiry: Date.now() + 3_600_000,
		});

		globalThis.fetch = vi.fn().mockRejectedValue(new Error("network failure"));

		await expect(Gmail._fetchAndStoreSub()).resolves.toBeUndefined();
	});

	it("saves both sub and email when userinfo returns an email", async () => {
		await Gmail.saveSettings({
			accessToken: "valid-tok",
			refreshToken: "ref",
			tokenExpiry: Date.now() + 3_600_000,
		});

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ sub: "sub-with-email", email: "user@example.com" }),
		});

		await Gmail._fetchAndStoreSub();

		const settings = Gmail.getSettings();
		expect(settings.sub).toBe("sub-with-email");
		expect(settings.email).toBe("user@example.com");
	});

	it("saves sub but not email when userinfo omits email field", async () => {
		await Gmail.saveSettings({
			accessToken: "valid-tok",
			refreshToken: "ref",
			tokenExpiry: Date.now() + 3_600_000,
		});

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ sub: "sub-only" }),
		});

		await Gmail._fetchAndStoreSub();

		const settings = Gmail.getSettings();
		expect(settings.sub).toBe("sub-only");
		expect(settings.email).toBe("");
	});
});

// ===========================================================================
// connect() — post-OAuth sub fetch
// ===========================================================================
describe("connect() — post-OAuth sub fetch", () => {
	it("calls _fetchAndStoreSub after a successful OAuth flow", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ auth_url: "https://accounts.google.com/auth" }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ access_token: "new-tok", refresh_token: "new-ref", expires_in: 3600 }),
			});
		const mockPopup = { closed: false };
		globalThis.open = vi.fn().mockReturnValue(mockPopup);

		const fetchSubSpy = vi.spyOn(Gmail, "_fetchAndStoreSub").mockResolvedValue(undefined);

		const connectPromise = Gmail.connect();
		// Wait for the fetch + json awaits inside connect() to resolve
		await new Promise((r) => setTimeout(r, 0));

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://proxy.example.com",
				data: {
					type: "gmail-oauth",
					status: "success",
					state: getPendingOAuthState().rawState,
					auth_result_id: "auth-result-1",
				},
			}),
		);

		await connectPromise;
		expect(fetchSubSpy).toHaveBeenCalled();
	});
});

// ===========================================================================
// connect() — iOS PWA redirect flow
// ===========================================================================
describe("connect() \u2014 iOS PWA redirect flow", () => {
	let origLocationDescriptor;
	let origStandaloneDescriptor;

	beforeEach(() => {
		origLocationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
		origStandaloneDescriptor = Object.getOwnPropertyDescriptor(navigator, "standalone");
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				auth_url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
			}),
		});
	});

	afterEach(() => {
		if (origLocationDescriptor) {
			Object.defineProperty(window, "location", origLocationDescriptor);
		}
		if (origStandaloneDescriptor) {
			Object.defineProperty(navigator, "standalone", origStandaloneDescriptor);
		} else {
			try {
				delete navigator.standalone;
			} catch {
				// ignore — non-configurable in some environments
			}
		}
		vi.restoreAllMocks();
	});

	it("sets window.location.href instead of opening a popup when navigator.standalone is true", async () => {
		Object.defineProperty(navigator, "standalone", { value: true, configurable: true });

		const hrefSetter = vi.fn();
		const mockLoc = { origin: "http://localhost", search: "", pathname: "/", hash: "" };
		Object.defineProperty(mockLoc, "href", {
			set: hrefSetter,
			get: () => "http://localhost/",
			configurable: true,
		});
		Object.defineProperty(window, "location", {
			writable: true,
			configurable: true,
			value: mockLoc,
		});

		const windowOpenSpy = vi.spyOn(window, "open");

		// Do NOT await — the promise never resolves (page navigates away)
		Gmail.connect();
		await new Promise((r) => setTimeout(r, 50));

		expect(hrefSetter).toHaveBeenCalledWith(
			expect.stringContaining("accounts.google.com"),
		);
		expect(windowOpenSpy).not.toHaveBeenCalled();
	});

	it("keeps using redirect flow when standalone changes after connect starts", async () => {
		Object.defineProperty(navigator, "standalone", { value: true, configurable: true });

		let resolveFetch;
		globalThis.fetch = vi.fn().mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				}),
		);

		const hrefSetter = vi.fn();
		const mockLoc = { origin: "http://localhost", search: "", pathname: "/", hash: "" };
		Object.defineProperty(mockLoc, "href", {
			set: hrefSetter,
			get: () => "http://localhost/",
			configurable: true,
		});
		Object.defineProperty(window, "location", {
			writable: true,
			configurable: true,
			value: mockLoc,
		});

		const windowOpenSpy = vi.spyOn(window, "open");

		Gmail.connect();
		await new Promise((r) => setTimeout(r, 0));
		Object.defineProperty(navigator, "standalone", { value: false, configurable: true });
		resolveFetch({
			ok: true,
			json: async () => ({
				auth_url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
			}),
		});
		await new Promise((r) => setTimeout(r, 50));

		expect(hrefSetter).toHaveBeenCalledWith(
			expect.stringContaining("accounts.google.com"),
		);
		expect(windowOpenSpy).not.toHaveBeenCalled();
	});

	it("uses window.open() popup when navigator.standalone is false", async () => {
		Object.defineProperty(navigator, "standalone", { value: false, configurable: true });

		const windowOpenSpy = vi.spyOn(window, "open").mockReturnValue(null);

		await Gmail.connect().catch(() => {}); // popup blocked \u2192 rejected

		expect(windowOpenSpy).toHaveBeenCalled();
	});

	it("uses window.open() popup when navigator.standalone is undefined", async () => {
		Object.defineProperty(navigator, "standalone", {
			value: undefined,
			configurable: true,
		});

		const windowOpenSpy = vi.spyOn(window, "open").mockReturnValue(null);

		await Gmail.connect().catch(() => {});

		expect(windowOpenSpy).toHaveBeenCalled();
	});
});

// ===========================================================================
// BUG-GMAIL-SIP: same-day same-amount Gmail transactions must not deduplicate
// ===========================================================================
describe("BUG-GMAIL-SIP: Gmail message ID bypasses field-based duplicate check", () => {
	beforeEach(freshDB);

	const sipBase = {
		amount: -2000,
		transaction_type: "expense",
		date: "2025-06-01",
		bank_name: "HDFC",
		account_type: "savings",
		account_last_digits: "5678",
		email_from: "alerts@hdfcbank.net",
		is_transaction: true,
		is_balance_info: false,
	};

	it("imports all three SIP transactions with same date/amount/account but different gmail_message_ids", async () => {
		const r1 = await Gmail._importTransaction({ ...sipBase, gmail_message_id: "sip_msg_1", description: "SIP 1" });
		const r2 = await Gmail._importTransaction({ ...sipBase, gmail_message_id: "sip_msg_2", description: "SIP 2" });
		const r3 = await Gmail._importTransaction({ ...sipBase, gmail_message_id: "sip_msg_3", description: "SIP 3" });

		expect(r1).toBe("imported");
		expect(r2).toBe("imported");
		expect(r3).toBe("imported");

		// Confirm all three rows exist in the DB
		const count = DB._queryOne(
			"SELECT COUNT(*) AS cnt FROM transactions WHERE amount = -2000 AND date(date) = '2025-06-01'",
		);
		expect(count.cnt).toBe(3);
	});

	it("still rejects a non-Gmail transaction that matches an existing one by date + amount + account", async () => {
		// First: import a Gmail-sourced transaction to establish the account
		const r1 = await Gmail._importTransaction({ ...sipBase, gmail_message_id: "sip_first", description: "First SIP" });
		expect(r1).toBe("imported");

		// Second: attempt to import a non-Gmail transaction (no gmail_message_id) with same date+amount+account
		const r2 = await Gmail._importTransaction({
			...sipBase,
			// no gmail_message_id — this is a manually-triggered import path
			description: "Duplicate without message ID",
		});
		expect(r2).toBe("duplicate");
	});

	it("extractTransactions pipeline imports all three SIP emails (real _importTransaction, no mock)", async () => {
		// Simulate 3 separate SIP confirmation emails arriving on the same day
		// with the same debit amount but distinct Gmail message IDs.
		// This is the end-to-end pipeline test for the BUG-GMAIL-SIP fix.
		await Gmail.saveSettings({
			accessToken: "tok",
			refreshToken: "ref",
			tokenExpiry: Date.now() + 3_600_000,
		});
		localStorageData["fincoach-ai-settings"] = JSON.stringify({
			provider: "groq",
			apiKey: "test-key",
			model: "test-model",
		});
		localStorageData["fincoach-ai-external-consent"] = JSON.stringify({
			provider: "groq",
			granted: true,
			source: "test",
			granted_at: "2026-07-21T00:00:00.000Z",
		});

		const sipTxTemplate = {
			amount: -2000,
			transaction_type: "expense",
			date: "2025-06-01T09:00",
			account_last_digits: "5678",
			account_type: "savings",
			bank_name: "HDFC",
			email_from: "alerts@hdfcbank.net",
			is_transaction: true,
			is_balance_info: false,
		};

		// Mock searchEmails to return 3 fake SIP emails with distinct IDs
		vi.spyOn(Gmail, "searchEmails").mockResolvedValue({
			messages: [
				{ id: "sip_pipeline_1", raw: btoa("From: alerts@hdfcbank.net\r\nSubject: SIP 1\r\n\r\nBody") },
				{ id: "sip_pipeline_2", raw: btoa("From: alerts@hdfcbank.net\r\nSubject: SIP 2\r\n\r\nBody") },
				{ id: "sip_pipeline_3", raw: btoa("From: alerts@hdfcbank.net\r\nSubject: SIP 3\r\n\r\nBody") },
			],
			skippedCount: 0,
		});
		vi.spyOn(DB, "getCategories").mockReturnValue([]);

		// Mock LLM extraction: return 3 transactions with same amount/date/account
		// Categorisation call returns an array of category strings.
		let llmCallCount = 0;
		vi.spyOn(Gmail, "_callLLM").mockImplementation(async () => {
			llmCallCount++;
			if (llmCallCount === 1) {
				// Extraction call — one entry per email
				return JSON.stringify([
					{ ...sipTxTemplate, email_index: 1, description: "SIP debit 1" },
					{ ...sipTxTemplate, email_index: 2, description: "SIP debit 2" },
					{ ...sipTxTemplate, email_index: 3, description: "SIP debit 3" },
				]);
			}
			// Categorisation call
			return JSON.stringify(["Other", "Other", "Other"]);
		});

		const result = await Gmail.extractTransactions({ days: 7 });

		// All three SIP transactions must be imported — none should be deduplicated
		expect(result.imported).toBe(3);
		expect(result.duplicates).toBe(0);
		expect(result.errors).toBe(0);

		const count = DB._queryOne(
			"SELECT COUNT(*) AS cnt FROM transactions WHERE amount = -2000 AND date(date) = '2025-06-01'",
		);
		expect(count.cnt).toBe(3);
	});
});
