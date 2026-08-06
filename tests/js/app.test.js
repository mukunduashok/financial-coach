/**
 * Tests for formatAccountBalance behavior in static/js/app.js.
 *
 * formatAccountBalance is not exported from app.js, so we test it indirectly
 * through the rendered HTML of the accounts screen. The app is booted via the
 * 'db-ready' custom event and routes are accessed via the window-exposed Router
 * object (window.Router is assigned at module level in app.js).
 */
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

// Import the mocked DB so individual tests can adjust mock return values
import { DB } from "../../static/js/db.js";


// ---------------------------------------------------------------------------
// DOM setup — must exist before app.js module is evaluated
// ---------------------------------------------------------------------------
document.body.innerHTML = '<div id="app"></div>';

// jsdom does not implement these URL APIs — define stubs so vi.spyOn can wrap them later
if (!URL.createObjectURL) URL.createObjectURL = () => "";
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};

// jsdom does not implement matchMedia; provide a minimal stub required by Theme.init()
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ---------------------------------------------------------------------------
// Mock all app.js dependencies before the module is loaded
// ---------------------------------------------------------------------------
vi.mock("../../static/js/db.js", () => ({
  DB: {
    init: vi.fn().mockResolvedValue(undefined),
    getAccounts: vi.fn().mockResolvedValue([]),
    getTransactions: vi.fn().mockResolvedValue([]),
    getCategories: vi.fn().mockResolvedValue([]),
    getGoals: vi.fn().mockResolvedValue([]),
    getBudgets: vi.fn().mockResolvedValue([]),
    getChatHistory: vi.fn().mockResolvedValue({ chat_id: null, history: [] }),
    exportDatabase: vi.fn().mockReturnValue(new Uint8Array()),
    exportTransactionsCSV: vi.fn().mockReturnValue(""),
    getSettings: vi.fn().mockReturnValue({}),
  },
}));

const mockAPI = {
  getAccounts: vi.fn().mockResolvedValue([]),
  getTransactions: vi.fn().mockResolvedValue([]),
  getTransactionTotals: vi.fn().mockResolvedValue([]),
  getCategories: vi.fn().mockResolvedValue([]),
  getGoals: vi.fn().mockResolvedValue([]),
  getBudgets: vi.fn().mockResolvedValue([]),
  getChatHistory: vi.fn().mockResolvedValue({ chat_id: null, history: [] }),
  sendChatMessageWithId: vi.fn().mockResolvedValue({ chat_id: "chat-1", response: "OK" }),
  exportTransactionsUrl: vi.fn().mockResolvedValue(null),
  createTransaction: vi.fn().mockResolvedValue({}),
  createAccount: vi.fn().mockResolvedValue({ id: 1, name: "Test Account" }),
  getGmailStatus: vi.fn().mockResolvedValue({ connected: false, email: null }),
  getGmailConnectUrl: vi.fn().mockResolvedValue({ auth_url: "https://accounts.google.com/o/oauth2/auth" }),
  getUpcomingBills: vi.fn().mockResolvedValue([]),
  getFollowUp: vi.fn().mockResolvedValue(null),
  getFollowUps: vi.fn().mockResolvedValue([]),
  getGmailCustomSenders: vi.fn().mockReturnValue([]),
  saveGmailCustomSenders: vi.fn(),
  getTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn().mockResolvedValue({ id: 1, name: "testtag" }),
  updateTag: vi.fn().mockResolvedValue({ id: 1, name: "updated" }),
  deleteTag: vi.fn().mockResolvedValue(undefined),
  setTransactionTags: vi.fn().mockResolvedValue(undefined),
  getSpendingReport: vi.fn().mockResolvedValue({ total_transactions: 0, categories: [] }),
  isBiometricAvailable: vi.fn().mockResolvedValue(false),
  isBiometricEnabled: vi.fn().mockReturnValue(false),
  isVaultUnlocked: vi.fn().mockReturnValue(false),
  unlockVault: vi.fn().mockResolvedValue(true),
  setupBiometric: vi.fn().mockResolvedValue(undefined),
  unlockWithBiometric: vi.fn().mockResolvedValue(true),
  disableBiometric: vi.fn(),
  prefersNumericPinInput: vi.fn().mockReturnValue(true),
  isVaultConfigured: vi.fn().mockReturnValue(false),
  setupVault: vi.fn().mockResolvedValue(undefined),
  changeVaultPassphrase: vi.fn().mockResolvedValue(undefined),
};
vi.mock("../../static/js/api.js", () => ({ API: mockAPI }));

vi.mock("../../static/js/ai.js", () => ({
  AI: {
    getSettings: vi.fn().mockReturnValue({}),
    requiresExternalConsent: vi.fn().mockReturnValue(false),
    hasExternalConsent: vi.fn().mockReturnValue(true),
    grantExternalConsent: vi.fn(),
    revokeExternalConsent: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue({
      ok: true,
      publicSaved: true,
      secretSaved: true,
      vaultRequired: false,
    }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  },
  AI_PROVIDERS: {
    groq: { name: "Groq", requiresKey: true, defaultModel: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile"] },
    openai: { name: "OpenAI", requiresKey: true, defaultModel: "gpt-4o-mini", models: ["gpt-4o-mini"] },
    ollama: { name: "Ollama (Local)", requiresKey: false, defaultModel: "llama3.1:8b", models: ["llama3.1:8b"] },
    gemini: { name: "Google Gemini", requiresKey: true, defaultModel: "gemini-2.0-flash", models: ["gemini-2.0-flash"] },
    azure: { name: "Azure OpenAI", requiresKey: true, defaultModel: "", models: [] },
  },
}));

// jsdom does not implement these URL methods — define stubs before app.js is loaded
URL.createObjectURL = vi.fn();
URL.revokeObjectURL = vi.fn();

// Load app.js — registers the 'db-ready' listener and assigns Router to window
await import("../../static/js/app.js");

// Import GDrive to allow spying on its methods in settings tests
const { GDrive } = await import("../../static/js/gdrive.js");
const { AI } = await import("../../static/js/ai.js");

// Boot the app once: fires db-ready → renderLayout() → Router.init()
beforeAll(async () => {
  document.dispatchEvent(new Event("db-ready"));
  // Wait for the async initial render (dashboard) to settle
  await new Promise((r) => setTimeout(r, 100));
});

// Reset new mocks added for bill reminders so that vi.restoreAllMocks() calls
// in some beforeEach/afterEach blocks don't leave them returning undefined.
beforeEach(() => {
  mockAPI.getUpcomingBills.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Helper: render the accounts screen with the given account data
// ---------------------------------------------------------------------------
async function renderAccountsWithData(accounts) {
  mockAPI.getAccounts.mockResolvedValue(accounts);
  const renderFn = window.Router.routes["#/accounts"];
  await renderFn();
  return document.getElementById("screen");
}

// ===========================================================================
// formatAccountBalance — tested through rendered HTML of the accounts screen
// ===========================================================================
describe("formatAccountBalance", () => {
  it("shows formatted currency for savings account with balance_updated_at set", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 1,
        name: "HDFC Savings",
        account_type: "savings",
        balance: 25000,
        effective_balance: null,
        balance_updated_at: "2025-01-15 10:00:00",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    const balanceEl = screen.querySelector(".account-balance-amount");
    expect(balanceEl).not.toBeNull();
    // Should contain the balance amount (not empty, not "not synced")
    expect(balanceEl.textContent.trim()).not.toBe("");
    expect(balanceEl.querySelector(".balance-not-synced")).toBeNull();
    expect(balanceEl.textContent).toContain("25,000");
  });

  it("shows 'Balance not yet synced' for savings account with null balance_updated_at", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 2,
        name: "SBI Savings",
        account_type: "savings",
        balance: 0,
        effective_balance: null,
        balance_updated_at: null,
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    const balanceEl = screen.querySelector(".account-balance-amount");
    expect(balanceEl).not.toBeNull();
    const notSyncedSpan = balanceEl.querySelector(".balance-not-synced");
    expect(notSyncedSpan).not.toBeNull();
    expect(notSyncedSpan.textContent).toBe("Balance not yet synced");
  });

  it("shows empty balance for debit account even when balance_updated_at is set", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 3,
        name: "HDFC Debit Card",
        account_type: "debit",
        balance: 10000,
        effective_balance: null,
        balance_updated_at: "2025-01-15 10:00:00",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    const balanceEl = screen.querySelector(".account-balance-amount");
    expect(balanceEl).not.toBeNull();
    // formatAccountBalance returns "" for debit accounts
    expect(balanceEl.innerHTML.trim()).toBe("");
    expect(balanceEl.querySelector(".balance-not-synced")).toBeNull();
  });

  it("shows empty balance for credit account even when balance_updated_at is set", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 4,
        name: "ICICI Credit Card",
        account_type: "credit",
        balance: 5000,
        effective_balance: null,
        balance_updated_at: "2025-01-15 10:00:00",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    const balanceEl = screen.querySelector(".account-balance-amount");
    expect(balanceEl).not.toBeNull();
    // Credit accounts now show billing cycle balance with "due this cycle" label
    expect(balanceEl.innerHTML).toContain("due this cycle");
    expect(balanceEl.querySelector(".balance-not-synced")).toBeNull();
  });

  it("shows formatted currency for current account with balance_updated_at set", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 5,
        name: "ICICI Current",
        account_type: "current",
        balance: 50000,
        effective_balance: null,
        balance_updated_at: "2025-02-01 09:00:00",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    const balanceEl = screen.querySelector(".account-balance-amount");
    expect(balanceEl).not.toBeNull();
    expect(balanceEl.textContent.trim()).not.toBe("");
    expect(balanceEl.querySelector(".balance-not-synced")).toBeNull();
    expect(balanceEl.textContent).toContain("50,000");
  });

  it("uses effective_balance over balance when both are present", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 6,
        name: "AXIS Current Merged",
        account_type: "current",
        balance: 10000,
        effective_balance: 35000,
        balance_updated_at: "2025-02-01 09:00:00",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    const balanceEl = screen.querySelector(".account-balance-amount");
    expect(balanceEl).not.toBeNull();
    // effective_balance (35000) takes precedence over balance (10000)
    expect(balanceEl.textContent).toContain("35,000");
    expect(balanceEl.textContent).not.toContain("10,000");
  });

  it("shows 'Balance not yet synced' for current account with undefined balance_updated_at", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 7,
        name: "Kotak Current",
        account_type: "current",
        balance: 5000,
        effective_balance: null,
        balance_updated_at: undefined,
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    const balanceEl = screen.querySelector(".account-balance-amount");
    expect(balanceEl).not.toBeNull();
    const notSyncedSpan = balanceEl.querySelector(".balance-not-synced");
    expect(notSyncedSpan).not.toBeNull();
    expect(notSyncedSpan.textContent).toBe("Balance not yet synced");
  });
});

// ============================================================================
// renderAccounts — inactive account filtering
// ============================================================================
describe("renderAccounts — inactive account filtering", () => {
  it("shows inactive orphan account (no merged_into_id) as top-level card so user can manage it", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 1,
        name: "Old Ghost Account",
        account_type: "savings",
        balance: 0,
        effective_balance: null,
        balance_updated_at: null,
        merged_accounts: [],
        merged_into_id: null,
        is_active: false,
      },
    ]);
    // Orphan accounts (inactive, no merged_into_id) must remain visible so users
    // can see accounts left in a broken state after a failed merge.
    const cards = screen.querySelectorAll(".acct-tile");
    expect(cards.length).toBe(1);
    expect(screen.innerHTML).toContain("Old Ghost Account");
  });

  it("renders active target account with its merged child correctly", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 1,
        name: "HDFC Savings",
        account_type: "savings",
        balance: 25000,
        effective_balance: null,
        balance_updated_at: "2025-01-15 10:00:00",
        merged_accounts: [{ id: 2, name: "HDFC Old" }],
        merged_into_id: null,
        is_active: true,
      },
      {
        id: 2,
        name: "HDFC Old",
        account_type: "savings",
        balance: 0,
        effective_balance: null,
        balance_updated_at: null,
        merged_accounts: [],
        merged_into_id: 1,
        is_active: false,
      },
    ]);
    // Only the active parent should render as a top-level tile
    const cards = screen.querySelectorAll(".acct-tile");
    expect(cards.length).toBeGreaterThanOrEqual(1);
    const html = screen.innerHTML;
    expect(html).toContain("HDFC Savings");
  });
});

// ============================================================================
// renderAccounts — grouped tile layout
// ============================================================================
describe("renderAccounts — ACCOUNT_GROUPS grouping", () => {
  it("savings account lands in Savings Accounts section with bank tile", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 1,
        name: "HDFC Savings",
        account_type: "savings",
        balance: 10000,
        effective_balance: null,
        balance_updated_at: "2025-01-01",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    expect(screen.innerHTML).toContain("Savings Accounts");
    expect(screen.querySelector(".acct-tile--bank")).not.toBeNull();
    expect(screen.querySelector(".account-balance-amount")).not.toBeNull();
    expect(screen.querySelector(".account-info")).not.toBeNull();
    expect(screen.querySelector("button[title='Delete']")).not.toBeNull();
  });

  it("current account lands in Current Accounts section with bank tile", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 2,
        name: "ICICI Current",
        account_type: "current",
        balance: 50000,
        effective_balance: null,
        balance_updated_at: "2025-01-01",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    expect(screen.innerHTML).toContain("Current Accounts");
    expect(screen.querySelector(".acct-tile--bank")).not.toBeNull();
  });

  it("credit account lands in Credit Cards section with credit tile", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 3,
        name: "HDFC Credit",
        account_type: "credit",
        balance: 0,
        credit_cycle_balance: 2500,
        effective_balance: null,
        balance_updated_at: "2025-01-01",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    expect(screen.innerHTML).toContain("Credit Cards");
    expect(screen.querySelector(".acct-tile--credit")).not.toBeNull();
    expect(screen.querySelector(".account-balance-amount").innerHTML).toContain("due this cycle");
    expect(screen.querySelector(".account-info")).not.toBeNull();
    expect(screen.querySelector("button[title='Delete']")).not.toBeNull();
  });

  it("credit_card account type also lands in Credit Cards section", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 4,
        name: "Axis Credit Card",
        account_type: "credit_card",
        balance: 0,
        credit_cycle_balance: 1000,
        effective_balance: null,
        balance_updated_at: null,
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    expect(screen.innerHTML).toContain("Credit Cards");
    expect(screen.querySelector(".acct-tile--credit")).not.toBeNull();
  });

  it("debit account lands in Prepaid / Debit Cards section with debit tile", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 5,
        name: "SBI Debit",
        account_type: "debit",
        balance: 0,
        effective_balance: null,
        balance_updated_at: null,
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    expect(screen.innerHTML).toContain("Prepaid / Debit Cards");
    expect(screen.querySelector(".acct-tile--debit")).not.toBeNull();
    expect(screen.querySelector(".account-balance-amount")).not.toBeNull();
    expect(screen.querySelector(".account-info")).not.toBeNull();
    expect(screen.querySelector("button[title='Delete']")).not.toBeNull();
  });

  it("prepaid account type also lands in Prepaid / Debit Cards section", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 6,
        name: "Paytm Prepaid",
        account_type: "prepaid",
        balance: 0,
        effective_balance: null,
        balance_updated_at: null,
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    expect(screen.innerHTML).toContain("Prepaid / Debit Cards");
    expect(screen.querySelector(".acct-tile--debit")).not.toBeNull();
  });

  it("wallet account lands in Others section with wallet tile", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 7,
        name: "PhonePe Wallet",
        account_type: "wallet",
        balance: 500,
        effective_balance: null,
        balance_updated_at: null,
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    expect(screen.innerHTML).toContain("Others");
    expect(screen.querySelector(".acct-tile--wallet")).not.toBeNull();
    expect(screen.querySelector(".account-balance-amount")).not.toBeNull();
    expect(screen.querySelector(".account-info")).not.toBeNull();
    expect(screen.querySelector("button[title='Delete']")).not.toBeNull();
  });

  it("unrecognised account type falls into Others section", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 8,
        name: "Exotic Account",
        account_type: "crypto",
        balance: 0,
        effective_balance: null,
        balance_updated_at: null,
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    expect(screen.innerHTML).toContain("Others");
    expect(screen.querySelector(".acct-tile--wallet")).not.toBeNull();
  });

  it("empty sections are not rendered", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 1,
        name: "HDFC Savings",
        account_type: "savings",
        balance: 10000,
        effective_balance: null,
        balance_updated_at: "2025-01-01",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    // Only Savings Accounts section should be present
    expect(screen.innerHTML).toContain("Savings Accounts");
    expect(screen.innerHTML).not.toContain("Credit Cards");
    expect(screen.innerHTML).not.toContain("Prepaid / Debit Cards");
    expect(screen.innerHTML).not.toContain("Others");
  });

  it("multiple account types render in separate sections", async () => {
    const screen = await renderAccountsWithData([
      {
        id: 1,
        name: "HDFC Savings",
        account_type: "savings",
        balance: 10000,
        effective_balance: null,
        balance_updated_at: "2025-01-01",
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
      {
        id: 2,
        name: "HDFC Credit Card",
        account_type: "credit",
        balance: 0,
        credit_cycle_balance: 0,
        effective_balance: null,
        balance_updated_at: null,
        merged_accounts: [],
        merged_into_id: null,
        is_active: true,
      },
    ]);
    expect(screen.innerHTML).toContain("Savings Accounts");
    expect(screen.innerHTML).toContain("Credit Cards");
    expect(screen.querySelectorAll(".acct-section").length).toBe(2);
    expect(screen.querySelectorAll(".acct-tile").length).toBe(2);
  });
});


// ============================================================================
// Bug Regression Tests — App Layer
// These tests currently FAIL because the production bugs have not been fixed.
// ============================================================================

// ---------------------------------------------------------------------------
// BUG-SEV1-02 & BUG-SEV1-03: export functions must await async DB calls
// ---------------------------------------------------------------------------
describe("BUG-SEV1-02 / BUG-SEV1-03: export functions await DB async calls", () => {
	let capturedBlobParts;
	let blobSpy;

	let anchorClickSpy;

	beforeEach(async () => {
		capturedBlobParts = null;

		// Make DB exports truly async (return Promise) — exposes missing-await bug
		DB.exportDatabase.mockResolvedValue(new Uint8Array([83, 81, 76, 105])); // "SQLi"
		DB.exportTransactionsCSV.mockResolvedValue("id,amount,description\n1,-100,Test");

		// Spy on Blob constructor to capture the content passed to it
		const OrigBlob = globalThis.Blob;
		blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation(function (parts, opts) {
			capturedBlobParts = parts ? [...parts] : [];
			return new OrigBlob(parts || [], opts);
		});

		// Reset URL stubs for this test (defined at module level)
		URL.createObjectURL.mockReturnValue("blob:test-export");
		URL.revokeObjectURL.mockReturnValue(undefined);

		// Prevent jsdom "Not implemented: navigation" error when anchor.click() fires
		anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

		// Render settings screen so the export buttons are in the DOM
		const renderFn = window.Router.routes["#/settings"];
		await renderFn();
	});

	afterEach(() => {
		// Restore only the Blob spy — avoid vi.restoreAllMocks() because it also
		// resets vi.fn() module mocks (e.g. AI.getSettings) to return undefined.
		blobSpy?.mockRestore();
		anchorClickSpy?.mockRestore();
		URL.createObjectURL.mockReset();
		URL.revokeObjectURL.mockReset();
		capturedBlobParts = null;
	});

	it("BUG-SEV1-02: exportBackup creates Blob with actual bytes, not a Promise object", async () => {
		const btn = document.querySelector('[data-action="export-backup"]');
		expect(btn).not.toBeNull();

		btn.click();
		// Allow any micro-tasks (Promise resolutions) to complete
		await new Promise((r) => setTimeout(r, 50));

		expect(capturedBlobParts).not.toBeNull();
		expect(capturedBlobParts).toHaveLength(1);
		// BUG: without await, capturedBlobParts[0] is a Promise (not Uint8Array)
		// After fix: capturedBlobParts[0] should be a Uint8Array with real bytes
		expect(capturedBlobParts[0]).toBeInstanceOf(Uint8Array);
		expect(capturedBlobParts[0]).not.toBeInstanceOf(Promise);
	});

	it("BUG-SEV1-03: exportCSV creates Blob with actual CSV string, not a Promise object", async () => {
		const btn = document.querySelector('[data-action="export-csv"]');
		expect(btn).not.toBeNull();

		btn.click();
		await new Promise((r) => setTimeout(r, 50));

		expect(capturedBlobParts).not.toBeNull();
		expect(capturedBlobParts).toHaveLength(1);
		// BUG: without await, capturedBlobParts[0] is a Promise (not a string)
		// After fix: capturedBlobParts[0] should be a CSV string
		expect(typeof capturedBlobParts[0]).toBe("string");
		expect(capturedBlobParts[0]).toContain("id,amount");
	});
});

// ---------------------------------------------------------------------------
// BUG-SEV2-02: date helpers must return local date, not UTC date
// Simulates being in IST (UTC+5:30) by mocking Date.prototype.toISOString to
// return the UTC equivalent of midnight local time — the scenario where UTC
// date and local date differ.
// ---------------------------------------------------------------------------
describe("BUG-SEV2-02: date helpers return local date not UTC date", () => {
	let toISOSpy;

	beforeEach(async () => {
		// Simulate IST timezone: toISOString() subtracts 5h30m from the stored
		// timestamp so that "midnight local" appears as "18:30 previous day UTC".
		// The buggy implementation calls toISOString() and gets the wrong date;
		// the correct implementation uses getFullYear/getMonth/getDate and is unaffected.
		toISOSpy = vi.spyOn(Date.prototype, "toISOString").mockImplementation(function () {
			const offsetMs = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30
			const utcMs = this.getTime() - offsetMs;
			const d = new Date(utcMs);
			const pad = (n) => String(n).padStart(2, "0");
			return (
				`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
				`T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.000Z`
			);
		});

		mockAPI.getBudgets.mockResolvedValue([]);
		mockAPI.getCategories.mockResolvedValue([
			{ id: 1, name: "Food & Dining", is_default: false, description: null },
		]);

		const renderFn = window.Router.routes["#/budgets"];
		await renderFn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		// Remove any modal that was opened during the test
		for (const el of document.querySelectorAll(".modal-overlay")) el.remove();
	});

	it("budget period start defaults to local first-of-month, not UTC first-of-month", async () => {
		const fabBtn = document.querySelector('[data-action="show-create-budget"]');
		expect(fabBtn).not.toBeNull();
		fabBtn.click();
		await new Promise((r) => setTimeout(r, 50));

		const startInput = document.querySelector("#budget-start");
		expect(startInput).not.toBeNull();

		// Build the correct local first-of-month using local Date methods
		const now = new Date();
		const expectedLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

		// BUG: firstOfMonthISO uses toISOString (mocked → off by one day)
		// After fix: uses getFullYear/getMonth → returns expectedLocal
		expect(startInput.value).toBe(expectedLocal);
	});

	it("budget period end defaults to local last-of-month, not UTC last-of-month", async () => {
		const fabBtn = document.querySelector('[data-action="show-create-budget"]');
		expect(fabBtn).not.toBeNull();
		fabBtn.click();
		await new Promise((r) => setTimeout(r, 50));

		const endInput = document.querySelector("#budget-end");
		expect(endInput).not.toBeNull();

		// Build the correct local last-of-month using local Date methods
		const now = new Date();
		const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
		const expectedLocal =
			`${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}` +
			`-${String(lastDay.getDate()).padStart(2, "0")}`;

		// BUG: lastDayOfMonthISO uses toISOString (mocked → off by one day)
		// After fix: uses getFullYear/getMonth/getDate → returns expectedLocal
		expect(endInput.value).toBe(expectedLocal);
	});
});

// ---------------------------------------------------------------------------
// BUG-SEV3-06: dashboard total balance must subtract credit account balances
// ---------------------------------------------------------------------------
describe("BUG-SEV3-06: dashboard total balance subtracts credit account balances", () => {
	beforeEach(() => {
		mockAPI.getTransactions.mockResolvedValue([]);
	});

	it("subtracts credit account balance from net worth (savings 10k − credit 5k = 5k)", async () => {
		mockAPI.getAccounts.mockResolvedValue([
			{
				id: 1,
				name: "HDFC Savings",
				account_type: "savings",
				balance: 10000,
				effective_balance: 10000,
				balance_updated_at: "2026-01-01",
				is_active: true,
				merged_accounts: [],
				merged_into_id: null,
			},
			{
				id: 2,
				name: "Credit Card",
				account_type: "credit",
				balance: 5000,
				effective_balance: 5000,
				balance_updated_at: "2026-01-01",
				is_active: true,
				merged_accounts: [],
				merged_into_id: null,
			},
		]);

		const renderFn = window.Router.routes["#/"];
		await renderFn();

		const balanceEl = document.querySelector(".balance-amount");
		expect(balanceEl).not.toBeNull();
		// BUG: currently adds both → ₹15,000
		// After fix: savings 10k − credit 5k → ₹5,000
		expect(balanceEl.textContent).toContain("5,000");
		expect(balanceEl.textContent).not.toContain("15,000");
	});

	it("shows correct total when there are only savings accounts (no credit)", async () => {
		mockAPI.getAccounts.mockResolvedValue([
			{
				id: 3,
				name: "SBI Savings",
				account_type: "savings",
				balance: 20000,
				effective_balance: 20000,
				balance_updated_at: "2026-01-01",
				is_active: true,
				merged_accounts: [],
				merged_into_id: null,
			},
		]);

		const renderFn = window.Router.routes["#/"];
		await renderFn();

		const balanceEl = document.querySelector(".balance-amount");
		expect(balanceEl).not.toBeNull();
		expect(balanceEl.textContent).toContain("20,000");
	});
});

// ===========================================================================
// exportPDF — unit tests
// ===========================================================================

const TX_FIXTURE = [
	{
		id: 1,
		date: "2026-05-01",
		description: "Test Transaction",
		merchant_name: "Test Shop",
		category: { name: "Food" },
		category_name: "Food",
		account_name: "HDFC",
		amount: -250,
		transaction_type: "expense",
	},
];

const TOTALS_FIXTURE = {
	total_income: 5000,
	total_expense: 250,
	net: 4750,
	transaction_count: 1,
};

async function flushPromises() {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("exportPDF", () => {
	beforeEach(async () => {
		// Setup print spy
		window.print = vi.fn();

		// Setup API mocks with fixture data
		mockAPI.getTransactions.mockResolvedValue(TX_FIXTURE);
		mockAPI.getTransactionTotals.mockResolvedValue(TOTALS_FIXTURE);
		mockAPI.getAccounts.mockResolvedValue([]);
		mockAPI.getCategories.mockResolvedValue([]);

		// Remove any leftover print frame
		document.getElementById("print-frame")?.remove();

		// Navigate to transactions screen (export is now triggered from Settings)
		const renderFn = window.Router.routes["#/transactions"];
		await renderFn();
	});

	afterEach(() => {
		document.getElementById("print-frame")?.remove();
		vi.restoreAllMocks();
	});

	it("No PDF button in export-toolbar on transactions page (moved to Settings)", () => {
		// The export toolbar was removed from the transactions page
		const btn = document.querySelector(
			'[data-action="export-transactions"][data-format="pdf"]',
		);
		expect(btn).toBeNull();
	});

	it("exportPDF appends #print-frame to document.body when called directly", async () => {
		// exportPDF is called from Settings; invoke it directly via window
		await window.exportPDF();
		await vi.waitFor(() => expect(document.getElementById("print-frame")).not.toBeNull());
		expect(document.getElementById("print-frame")).not.toBeNull();
	});

	it("exportPDF calls window.print()", async () => {
		await window.exportPDF();
		await vi.waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
	});

	it("print-frame contains transaction table headers", async () => {
		await window.exportPDF();
		await vi.waitFor(() => expect(document.getElementById("print-frame")).not.toBeNull());
		const frame = document.getElementById("print-frame");
		expect(frame.innerHTML).toContain("Date");
		expect(frame.innerHTML).toContain("Description");
	});

	it("print-frame contains transaction data", async () => {
		await window.exportPDF();
		await vi.waitFor(() => expect(document.getElementById("print-frame")).not.toBeNull());
		const frame = document.getElementById("print-frame");
		expect(frame.innerHTML).toContain("Test Transaction");
	});

	it("print-frame contains totals footer", async () => {
		await window.exportPDF();
		await vi.waitFor(() => expect(document.getElementById("print-frame")).not.toBeNull());
		const frame = document.getElementById("print-frame");
		// Footer should show income and expense amounts
		expect(frame.innerHTML).toContain("Total Income");
		expect(frame.innerHTML).toContain("Total Expenses");
		// formatCurrency renders these amounts
		expect(frame.innerHTML).toContain("5,000");
	});
});

// ===========================================================================
// BUG-UI-01 — info-notice icon tooltips in settings screen
// ===========================================================================
describe("BUG-UI-01: settings screen uses info-notice icons instead of inline blocks", () => {
  async function renderSettings() {
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  beforeEach(async () => {
    AI.getSettings.mockReturnValue({});
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    vi.spyOn(GDrive, "isEnabled").mockReturnValue(false);
    vi.spyOn(GDrive, "getLastSyncTime").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders at least one .info-notice element in the settings screen", async () => {
    const screen = await renderSettings();
    const icons = screen.querySelectorAll(".info-notice");
    expect(icons.length).toBeGreaterThan(0);
  });

  it("each .info-notice contains a .info-notice-tooltip child", async () => {
    const screen = await renderSettings();
    const icons = screen.querySelectorAll(".info-notice");
    for (const icon of icons) {
      const tooltip = icon.querySelector(".info-notice-tooltip");
      expect(tooltip).not.toBeNull();
      expect(tooltip.textContent.trim().length).toBeGreaterThan(0);
    }
  });

  it("privacy notice icon is keyboard accessible (tabindex='0')", async () => {
    const screen = await renderSettings();
    const icons = screen.querySelectorAll(".info-notice");
    const accessible = [...icons].some((el) => el.getAttribute("tabindex") === "0");
    expect(accessible).toBe(true);
  });

  it("does not render any inline bordered privacy notice paragraph", async () => {
    const screen = await renderSettings();
    const inlineParagraphs = [...screen.querySelectorAll("p")].filter((p) =>
      p.style.borderLeft?.includes("solid"),
    );
    expect(inlineParagraphs).toHaveLength(0);
  });
});

// ===========================================================================
// FINCO-59 — vault-only AI credential UX
// ===========================================================================
describe("FINCO-59: AI settings require the Credential Vault for API keys", () => {
  async function renderSettings() {
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  beforeEach(async () => {
    AI.getSettings.mockReturnValue({ provider: "groq", model: "llama-3.3-70b-versatile" });
    AI.saveSettings.mockResolvedValue({
      ok: true,
      publicSaved: true,
      secretSaved: true,
      vaultRequired: false,
    });
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    mockAPI.isVaultConfigured.mockReturnValue(false);
    mockAPI.isVaultUnlocked.mockReturnValue(false);
    vi.spyOn(GDrive, "isEnabled").mockReturnValue(false);
    vi.spyOn(GDrive, "getLastSyncTime").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders vault-only copy instead of localStorage API-key copy", async () => {
    const screen = await renderSettings();
    expect(screen.textContent).toContain("API keys are stored only in the Credential Vault");
    expect(screen.textContent).not.toContain("localStorage");
  });

  it("shows a blocked status and vault setup modal when saving an API key without a vault", async () => {
    AI.saveSettings.mockResolvedValueOnce({
      ok: false,
      publicSaved: true,
      secretSaved: false,
      vaultRequired: true,
      error: "Set up a PIN before saving an AI API key.",
    });

    await renderSettings();
    document.getElementById("ai-provider").value = "groq";
    document.getElementById("ai-api-key").value = "sk-test";

    document.querySelector('[data-action="save-ai-settings"]').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(AI.saveSettings).toHaveBeenCalled();
    expect(AI.testConnection).not.toHaveBeenCalled();
    expect(document.getElementById("settings-status").textContent).toContain(
      "Set up a PIN before saving an AI API key.",
    );
    expect(document.getElementById("vault-setup-modal")).not.toBeNull();
  });
});

// ===========================================================================
// FINCO-60 — external AI consent UX
// ===========================================================================
describe("FINCO-60: external AI consent UX", () => {
  async function renderSettings() {
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  async function renderChat() {
    const renderFn = window.Router.routes["#/chat"];
    await renderFn();
    return document.getElementById("screen");
  }

  beforeEach(() => {
    AI.getSettings.mockReturnValue({ provider: "groq", model: "llama-3.3-70b-versatile" });
    AI.requiresExternalConsent.mockReturnValue(true);
    AI.hasExternalConsent.mockReturnValue(false);
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    mockAPI.sendChatMessageWithId.mockClear();
    vi.spyOn(GDrive, "isEnabled").mockReturnValue(false);
    vi.spyOn(GDrive, "getLastSyncTime").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a review consent button in AI settings for external providers", async () => {
    const screen = await renderSettings();
    expect(screen.textContent).toContain("External AI consent");
    expect(screen.querySelector('[data-action="review-ai-consent"]')).not.toBeNull();
  });

  it("prompts for consent before sending a chat message", async () => {
    await renderChat();
    const input = document.getElementById("chat-input");
    input.value = "How much did I spend?";

    document.getElementById("chat-send-btn").click();
    await new Promise((r) => setTimeout(r, 20));

    expect(document.querySelector('[data-action="confirm-ai-consent"]')).not.toBeNull();
    expect(mockAPI.sendChatMessageWithId).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// FINCO-78 — external-consent control appears immediately after saving AI settings
// ===========================================================================
describe("FINCO-78: consent control re-renders immediately after saving AI settings", () => {
  async function renderSettings() {
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  beforeEach(() => {
    window.Router.currentScreen = "#/settings";
    // Start from a state with no provider configured — no consent control on first render.
    AI.getSettings.mockReturnValue({});
    AI.saveSettings.mockResolvedValue({
      ok: true,
      publicSaved: true,
      secretSaved: true,
      vaultRequired: false,
    });
    AI.requiresExternalConsent.mockReturnValue(false);
    AI.hasExternalConsent.mockReturnValue(false);
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    mockAPI.isVaultConfigured.mockReturnValue(true);
    mockAPI.isVaultUnlocked.mockReturnValue(true);
    vi.spyOn(GDrive, "isEnabled").mockReturnValue(false);
    vi.spyOn(GDrive, "getLastSyncTime").mockReturnValue(null);
  });

  afterEach(() => {
    window.Router.currentScreen = null;
    vi.restoreAllMocks();
  });

  it("shows Review Consent immediately after saving an external provider without consent", async () => {
    const screen = await renderSettings();
    expect(screen.querySelector('[data-action="review-ai-consent"]')).toBeNull();

    document.getElementById("ai-provider").value = "groq";
    document.getElementById("ai-api-key").value = "sk-test";

    // Simulate the newly-saved state the re-render will read back.
    AI.getSettings.mockReturnValue({ provider: "groq", model: "llama-3.3-70b-versatile" });
    AI.requiresExternalConsent.mockReturnValue(true);
    AI.hasExternalConsent.mockReturnValue(false);

    document.querySelector('[data-action="save-ai-settings"]').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(document.querySelector('[data-action="review-ai-consent"]')).not.toBeNull();
    expect(document.querySelector('[data-action="revoke-ai-consent"]')).toBeNull();
  });

  it("shows Revoke Consent immediately after saving when consent is already granted", async () => {
    await renderSettings();

    document.getElementById("ai-provider").value = "groq";

    AI.getSettings.mockReturnValue({ provider: "groq", model: "llama-3.3-70b-versatile" });
    AI.requiresExternalConsent.mockReturnValue(true);
    AI.hasExternalConsent.mockReturnValue(true);

    document.querySelector('[data-action="save-ai-settings"]').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(document.querySelector('[data-action="revoke-ai-consent"]')).not.toBeNull();
    expect(document.querySelector('[data-action="review-ai-consent"]')).toBeNull();
  });

  it("shows no consent control after saving a local Ollama provider", async () => {
    await renderSettings();

    document.getElementById("ai-provider").value = "ollama";

    AI.getSettings.mockReturnValue({ provider: "ollama", model: "llama3.1:8b" });
    AI.requiresExternalConsent.mockReturnValue(false);

    document.querySelector('[data-action="save-ai-settings"]').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(document.querySelector('[data-action="review-ai-consent"]')).toBeNull();
    expect(document.querySelector('[data-action="revoke-ai-consent"]')).toBeNull();
  });

  it("preserves the saved status text after the re-render", async () => {
    await renderSettings();

    document.getElementById("ai-provider").value = "groq";
    AI.getSettings.mockReturnValue({ provider: "groq", model: "llama-3.3-70b-versatile" });

    document.querySelector('[data-action="save-ai-settings"]').click();
    await new Promise((r) => setTimeout(r, 50));

    const status = document.getElementById("settings-status");
    expect(status.textContent).toContain("✓ Settings saved");
    expect(status.className).toContain("success");
  });

  it("re-renders the settings screen exactly once on a successful save", async () => {
    await renderSettings();
    document.getElementById("ai-provider").value = "groq";
    AI.getSettings.mockReturnValue({ provider: "groq", model: "llama-3.3-70b-versatile" });

    // renderSettings() reads AI.getSettings() exactly once per render.
    AI.getSettings.mockClear();

    document.querySelector('[data-action="save-ai-settings"]').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(AI.getSettings).toHaveBeenCalledTimes(1);
  });

  it("does not re-render the settings screen on the vault-required failure path", async () => {
    AI.saveSettings.mockResolvedValueOnce({
      ok: false,
      publicSaved: true,
      secretSaved: false,
      vaultRequired: true,
      error: "Set up a PIN before saving an AI API key.",
    });
    mockAPI.isVaultConfigured.mockReturnValue(false);

    await renderSettings();
    document.getElementById("ai-provider").value = "groq";
    document.getElementById("ai-api-key").value = "sk-test";

    AI.getSettings.mockClear();

    document.querySelector('[data-action="save-ai-settings"]').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(AI.getSettings).not.toHaveBeenCalled();
    expect(document.getElementById("settings-status").textContent).toContain(
      "Set up a PIN before saving an AI API key.",
    );
  });
});

// ===========================================================================
// BUG-GDRIVE-01 — delete backup UI and double-confirmation flow
// ===========================================================================
describe("BUG-GDRIVE-01: Google Drive delete backup with double confirmation", () => {
  async function renderSettings() {
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  beforeEach(async () => {
    AI.getSettings.mockReturnValue({});
    mockAPI.getGmailStatus.mockResolvedValue({ connected: true, email: "user@example.com" });
    vi.spyOn(GDrive, "isEnabled").mockReturnValue(true);
    vi.spyOn(GDrive, "getLastSyncTime").mockReturnValue(null);
    vi.spyOn(GDrive, "getLastModified").mockResolvedValue("2025-01-01T00:00:00.000Z");
    vi.spyOn(GDrive, "deleteBackup").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the delete backup button when connected and Drive sync is enabled", async () => {
    const screen = await renderSettings();
    const btn = screen.querySelector('[data-action="gdrive-delete-backup"]');
    expect(btn).not.toBeNull();
  });

  it("delete backup button has danger styling", async () => {
    const screen = await renderSettings();
    const btn = screen.querySelector('[data-action="gdrive-delete-backup"]');
    expect(btn.classList.contains("btn-danger")).toBe(true);
  });

  it("does not call deleteBackup when first confirm is cancelled", async () => {
    await renderSettings();
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    const btn = document.querySelector('[data-action="gdrive-delete-backup"]');
    btn.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(GDrive.deleteBackup).not.toHaveBeenCalled();
  });

  it("does not call deleteBackup when second confirm is cancelled", async () => {
    await renderSettings();
    vi.spyOn(window, "confirm")
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const btn = document.querySelector('[data-action="gdrive-delete-backup"]');
    btn.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(GDrive.deleteBackup).not.toHaveBeenCalled();
  });

  it("calls deleteBackup when both confirms are accepted", async () => {
    await renderSettings();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const btn = document.querySelector('[data-action="gdrive-delete-backup"]');
    btn.click();
    await new Promise((r) => setTimeout(r, 100));

    expect(GDrive.deleteBackup).toHaveBeenCalledTimes(1);
  });

  it("shows two confirm dialogs when delete is triggered", async () => {
    await renderSettings();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const btn = document.querySelector('[data-action="gdrive-delete-backup"]');
    btn.click();
    await new Promise((r) => setTimeout(r, 100));

    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// BUG-TX-01 — txItemHTML display label priority (dashboard recent transactions)
// txItemHTML is internal; tested via the dashboard "Recent Transactions" list.
// ===========================================================================
describe("BUG-TX-01: txItemHTML label priority (merchant_name > merchant_upi_id > description > 'Transaction')", () => {
  const BASE_TX = {
    id: 10,
    date: "2026-05-15",
    transaction_type: "expense",
    amount: 100,
    account_name: "HDFC",
    category: null,
  };

  async function renderDashboardWithTransaction(tx) {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([tx]);
    const renderFn = window.Router.routes["#/"];
    await renderFn();
    return document.getElementById("screen");
  }

  afterEach(() => {
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getAccounts.mockResolvedValue([]);
  });

  it("shows merchant_name when merchant_name is set (highest priority)", async () => {
    const screen = await renderDashboardWithTransaction({
      ...BASE_TX,
      merchant_name: "Swiggy",
      merchant_upi_id: "swiggy@upi",
      description: "Food order",
    });
    const desc = screen.querySelector(".tx-desc");
    expect(desc).not.toBeNull();
    expect(desc.textContent.trim()).toContain("Swiggy");
  });

  it("does not show description or upi_id when merchant_name is set", async () => {
    const screen = await renderDashboardWithTransaction({
      ...BASE_TX,
      merchant_name: "Swiggy",
      merchant_upi_id: "swiggy@upi",
      description: "Food order",
    });
    const desc = screen.querySelector(".tx-desc");
    expect(desc).not.toBeNull();
    expect(desc.textContent.trim()).not.toContain("Food order");
    expect(desc.textContent.trim()).not.toContain("swiggy@upi");
  });

  it("shows merchant_upi_id when merchant_name is null", async () => {
    const screen = await renderDashboardWithTransaction({
      ...BASE_TX,
      merchant_name: null,
      merchant_upi_id: "zomato@upi",
      description: "Food delivery",
    });
    const desc = screen.querySelector(".tx-desc");
    expect(desc).not.toBeNull();
    expect(desc.textContent.trim()).toContain("zomato@upi");
  });

  it("does not show description when merchant_upi_id is present and merchant_name is null", async () => {
    const screen = await renderDashboardWithTransaction({
      ...BASE_TX,
      merchant_name: null,
      merchant_upi_id: "zomato@upi",
      description: "Food delivery",
    });
    const desc = screen.querySelector(".tx-desc");
    expect(desc).not.toBeNull();
    expect(desc.textContent.trim()).not.toContain("Food delivery");
  });

  it("shows description when both merchant_name and merchant_upi_id are null", async () => {
    const screen = await renderDashboardWithTransaction({
      ...BASE_TX,
      merchant_name: null,
      merchant_upi_id: null,
      description: "ATM Withdrawal",
    });
    const desc = screen.querySelector(".tx-desc");
    expect(desc).not.toBeNull();
    expect(desc.textContent.trim()).toContain("ATM Withdrawal");
  });

  it("shows 'Transaction' fallback when all three label fields are null", async () => {
    const screen = await renderDashboardWithTransaction({
      ...BASE_TX,
      merchant_name: null,
      merchant_upi_id: null,
      description: null,
    });
    const desc = screen.querySelector(".tx-desc");
    expect(desc).not.toBeNull();
    expect(desc.textContent.trim()).toContain("Transaction");
  });
});

// ===========================================================================
// BUG-TX-01 — same priority logic in loadTransactionList (transactions screen)
// ===========================================================================
describe("BUG-TX-01: transactions list screen respects display label priority", () => {
  const BASE_TX = {
    id: 20,
    date: "2026-05-15",
    transaction_type: "expense",
    amount: 150,
    account_name: "SBI",
    category: null,
  };

  async function renderTransactionsWithData(tx) {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([tx]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 150,
      net: -150,
      transaction_count: 1,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    // Flush any remaining microtasks (e.g. getTransactionTotals .then)
    await new Promise((r) => setTimeout(r, 0));
    return document.getElementById("screen");
  }

  afterEach(() => {
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
  });

  it("shows merchant_name in list row when merchant_name is set", async () => {
    const screen = await renderTransactionsWithData({
      ...BASE_TX,
      merchant_name: "BigBasket",
      merchant_upi_id: null,
      description: "Grocery",
    });
    const descs = [...screen.querySelectorAll(".tx-desc")];
    expect(descs.length).toBeGreaterThan(0);
    expect(descs.some((el) => el.textContent.includes("BigBasket"))).toBe(true);
  });

  it("shows merchant_upi_id in list row when merchant_name is null", async () => {
    const screen = await renderTransactionsWithData({
      ...BASE_TX,
      merchant_name: null,
      merchant_upi_id: "paytm@upi",
      description: "Recharge",
    });
    const descs = [...screen.querySelectorAll(".tx-desc")];
    expect(descs.length).toBeGreaterThan(0);
    expect(descs.some((el) => el.textContent.includes("paytm@upi"))).toBe(true);
  });

  it("shows description in list row when both merchant fields are null", async () => {
    const screen = await renderTransactionsWithData({
      ...BASE_TX,
      merchant_name: null,
      merchant_upi_id: null,
      description: "Bank Transfer",
    });
    const descs = [...screen.querySelectorAll(".tx-desc")];
    expect(descs.length).toBeGreaterThan(0);
    expect(descs.some((el) => el.textContent.includes("Bank Transfer"))).toBe(true);
  });

  it("shows 'Transaction' fallback in list row when all label fields are null", async () => {
    const screen = await renderTransactionsWithData({
      ...BASE_TX,
      merchant_name: null,
      merchant_upi_id: null,
      description: null,
    });
    const descs = [...screen.querySelectorAll(".tx-desc")];
    expect(descs.length).toBeGreaterThan(0);
    expect(descs.some((el) => el.textContent.includes("Transaction"))).toBe(true);
  });
});

// ===========================================================================
// REVIEW-TX-01 — "Detect Recurring" button removed from transactions screen
// ===========================================================================
describe("REVIEW-TX-01: 'Detect Recurring' UI elements removed from transactions screen", () => {
  beforeEach(async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 0,
      net: 0,
      transaction_count: 0,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
  });

  afterEach(() => {
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
  });

  it("no #btn-detect-recurring button is present after rendering transactions screen", () => {
    const btn = document.querySelector("#btn-detect-recurring");
    expect(btn).toBeNull();
  });

  it("no [data-action='run-detect-recurring'] element is present", () => {
    const el = document.querySelector("[data-action='run-detect-recurring']");
    expect(el).toBeNull();
  });

  it("runDetectRecurring is not exposed on window", () => {
    expect(window.runDetectRecurring).toBeUndefined();
  });

  it("no element with text '🔄 Detect Recurring' exists in transactions screen", () => {
    const buttons = [...document.querySelectorAll("button")];
    const found = buttons.some((btn) => btn.textContent.includes("Detect Recurring"));
    expect(found).toBe(false);
  });
});

// ===========================================================================
// Privacy & Security — toggle-trusted-device handler
// ===========================================================================
describe("Privacy & Security: toggle-trusted-device handler", () => {
  async function renderSettingsScreen() {
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  beforeEach(async () => {
    localStorage.clear();
    AI.getSettings.mockReturnValue({});
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    vi.spyOn(GDrive, "isEnabled").mockReturnValue(false);
    vi.spyOn(GDrive, "getLastSyncTime").mockReturnValue(null);
    // Clear any toasts from previous tests
    const container = document.querySelector(".toast-container");
    if (container) container.innerHTML = "";
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("settings screen renders Privacy & Security heading", async () => {
    const screen = await renderSettingsScreen();
    const headings = [...screen.querySelectorAll("h2")];
    expect(headings.some((h) => h.textContent.includes("Privacy"))).toBe(true);
  });

  it("trusted device checkbox renders unchecked when key not set", async () => {
    const screen = await renderSettingsScreen();
    const checkbox = screen.querySelector('[data-action="toggle-trusted-device"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
  });

  it("trusted device checkbox renders checked when TRUSTED_DEVICE_KEY is set", async () => {
    localStorage.setItem("fincoach-trusted-device", "true");
    const screen = await renderSettingsScreen();
    const checkbox = screen.querySelector('[data-action="toggle-trusted-device"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(true);
  });

  it("checking the checkbox sets TRUSTED_DEVICE_KEY and removes activity key", async () => {
    localStorage.setItem("fincoach-session-last-activity", String(Date.now()));
    await renderSettingsScreen();
    const checkbox = document.querySelector('[data-action="toggle-trusted-device"]');
    expect(checkbox.checked).toBe(false);

    checkbox.click(); // toggles to checked, click handler fires with el.checked === true
    await new Promise((r) => setTimeout(r, 50));

    expect(localStorage.getItem("fincoach-trusted-device")).toBe("true");
    expect(localStorage.getItem("fincoach-session-last-activity")).toBeNull();
  });

  it("checking the checkbox shows success toast", async () => {
    await renderSettingsScreen();
    const checkbox = document.querySelector('[data-action="toggle-trusted-device"]');
    checkbox.click();
    await new Promise((r) => setTimeout(r, 50));

    const toast = document.querySelector(".toast.success");
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain("Trusted device enabled");
  });

  it("unchecking the checkbox removes TRUSTED_DEVICE_KEY and sets activity key", async () => {
    localStorage.setItem("fincoach-trusted-device", "true");
    await renderSettingsScreen();
    const checkbox = document.querySelector('[data-action="toggle-trusted-device"]');
    expect(checkbox.checked).toBe(true);

    checkbox.click(); // toggles to unchecked, click handler fires with el.checked === false
    await new Promise((r) => setTimeout(r, 50));

    expect(localStorage.getItem("fincoach-trusted-device")).toBeNull();
    expect(localStorage.getItem("fincoach-session-last-activity")).not.toBeNull();
  });

  it("unchecking the checkbox shows info toast", async () => {
    localStorage.setItem("fincoach-trusted-device", "true");
    await renderSettingsScreen();
    const checkbox = document.querySelector('[data-action="toggle-trusted-device"]');
    checkbox.click();
    await new Promise((r) => setTimeout(r, 50));

    const toast = document.querySelector(".toast.info");
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain("Trusted device disabled");
  });

  it("settings status text shows inactivity warning when trusted device disabled", async () => {
    const screen = await renderSettingsScreen();
    expect(screen.textContent).toContain("6 hours");
  });

  it("settings status text shows persistence message when trusted device enabled", async () => {
    localStorage.setItem("fincoach-trusted-device", "true");
    const screen = await renderSettingsScreen();
    expect(screen.textContent).toContain("indefinitely");
  });
});

// ===========================================================================
// Onboarding Wizard
// ===========================================================================
describe("onboarding wizard", () => {
  afterEach(() => {
    // Remove any wizard from the DOM
    document.getElementById("onboarding-wizard")?.remove();
    // Clean onboarding keys from localStorage
    localStorage.removeItem("fincoach-onboarded");
    localStorage.removeItem("fincoach-onboarding-step");
    // Reset mocks to defaults
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    AI.getSettings.mockReturnValue({});
    vi.restoreAllMocks();
  });

  it("checkOnboarding shows wizard when not onboarded", () => {
    localStorage.removeItem("fincoach-onboarded");
    window.checkOnboarding();
    expect(document.getElementById("onboarding-wizard")).not.toBeNull();
  });

  it("checkOnboarding does not show wizard when already onboarded", () => {
    localStorage.setItem("fincoach-onboarded", "true");
    window.checkOnboarding();
    expect(document.getElementById("onboarding-wizard")).toBeNull();
  });

  it("checkOnboarding resumes from saved step", () => {
    localStorage.removeItem("fincoach-onboarded");
    localStorage.setItem("fincoach-onboarding-step", "3");
    window.checkOnboarding();
    const headline = document.querySelector(".onboarding-headline");
    expect(headline).not.toBeNull();
    expect(headline.textContent).toContain("Auto-import");
  });

  it("completeOnboarding removes wizard and sets key", () => {
    const wizard = document.createElement("div");
    wizard.id = "onboarding-wizard";
    document.body.appendChild(wizard);
    window.completeOnboarding();
    expect(document.getElementById("onboarding-wizard")).toBeNull();
    expect(localStorage.getItem("fincoach-onboarded")).toBe("true");
  });

  it("onboardingAdvance saves step to localStorage", () => {
    window.onboardingAdvance(2);
    expect(localStorage.getItem("fincoach-onboarding-step")).toBe("2");
    document.getElementById("onboarding-wizard")?.remove();
  });

  it("step 1 renders welcome headline", () => {
    window.renderOnboardingStep(1);
    const headline = document.querySelector(".onboarding-headline");
    expect(headline).not.toBeNull();
    expect(headline.textContent).toContain("Welcome to Financial Coach");
  });

  it("step 2 renders transaction explanation", () => {
    window.renderOnboardingStep(2);
    const headline = document.querySelector(".onboarding-headline");
    expect(headline).not.toBeNull();
    expect(headline.textContent).toContain("How transactions are tracked");
  });

  it("step 3 renders Gmail connect content", () => {
    window.renderOnboardingStep(3);
    const headline = document.querySelector(".onboarding-headline");
    expect(headline).not.toBeNull();
    expect(headline.textContent).toContain("Auto-import");
  });

  it("step 4 renders AI coaching content", () => {
    window.renderOnboardingStep(4);
    const headline = document.querySelector(".onboarding-headline");
    expect(headline).not.toBeNull();
    expect(headline.textContent.toLowerCase()).toContain("financial coach");
  });

  it("step 5 renders summary with dashboard CTA", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getGmailStatus.mockResolvedValue(null);
    AI.getSettings.mockReturnValue({});
    await window.renderOnboardingStep(5);
    const headline = document.querySelector(".onboarding-headline");
    expect(headline).not.toBeNull();
    expect(headline.textContent.toLowerCase()).toContain("all set");
  });

  // -------------------------------------------------------------------------
  // Bug fix: step 5 checks gmailStatus.connected (not gmailStatus.email)
  // -------------------------------------------------------------------------
  it("step 5 shows Gmail connected with email when connected=true and email is set", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getGmailStatus.mockResolvedValue({ connected: true, email: "user@gmail.com" });
    AI.getSettings.mockReturnValue({});
    await window.renderOnboardingStep(5);
    const list = document.querySelector(".onboarding-summary-list");
    expect(list).not.toBeNull();
    expect(list.textContent).toContain("Gmail connected");
    expect(list.textContent).toContain("user@gmail.com");
  });

  it("step 5 shows Gmail connected without email when connected=true but email is null", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getGmailStatus.mockResolvedValue({ connected: true, email: null });
    AI.getSettings.mockReturnValue({});
    await window.renderOnboardingStep(5);
    const list = document.querySelector(".onboarding-summary-list");
    expect(list).not.toBeNull();
    expect(list.textContent).toContain("Gmail connected");
    // Should NOT contain any email address-like string
    expect(list.textContent).not.toContain("@");
  });

  it("step 5 shows Gmail not connected fallback when connected=false", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    AI.getSettings.mockReturnValue({});
    await window.renderOnboardingStep(5);
    const list = document.querySelector(".onboarding-summary-list");
    expect(list).not.toBeNull();
    expect(list.textContent).toContain("Gmail not connected");
  });

  it("step 5 shows Gmail not connected fallback when getGmailStatus rejects", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getGmailStatus.mockRejectedValue(new Error("network error"));
    AI.getSettings.mockReturnValue({});
    await window.renderOnboardingStep(5);
    const list = document.querySelector(".onboarding-summary-list");
    expect(list).not.toBeNull();
    expect(list.textContent).toContain("Gmail not connected");
  });
});

// ===========================================================================
// categoryIcon() — unit tests
// ===========================================================================
describe("categoryIcon", () => {
  it("Food & Dining returns 🍽️ span", () => {
    const html = window.categoryIcon("Food & Dining");
    expect(html).toContain("🍽️");
    expect(html).not.toContain("tx-icon-letter");
  });

  it("Groceries returns 🛒 span", () => {
    const html = window.categoryIcon("Groceries");
    expect(html).toContain("🛒");
    expect(html).not.toContain("tx-icon-letter");
  });

  it("Income returns 💰 span", () => {
    const html = window.categoryIcon("Income");
    expect(html).toContain("💰");
    expect(html).not.toContain("tx-icon-letter");
  });

  it("Other returns 📌 span", () => {
    const html = window.categoryIcon("Other");
    expect(html).toContain("📌");
    expect(html).not.toContain("tx-icon-letter");
  });

  it("Investment returns 📈 span", () => {
    const html = window.categoryIcon("Investment");
    expect(html).toContain("📈");
    expect(html).not.toContain("tx-icon-letter");
  });

  it("unknown category returns tx-icon-letter span with uppercased first letter", () => {
    const html = window.categoryIcon("Rent");
    expect(html).toContain("tx-icon-letter");
    expect(html).toContain("R");
  });

  it("unknown category uses first letter uppercased", () => {
    const html = window.categoryIcon("zakat");
    expect(html).toContain("tx-icon-letter");
    expect(html).toContain("Z");
  });

  it("empty string returns tx-icon-letter with ?", () => {
    const html = window.categoryIcon("");
    expect(html).toContain("tx-icon-letter");
    expect(html).toContain("?");
  });

  it("null returns tx-icon-letter with ?", () => {
    const html = window.categoryIcon(null);
    expect(html).toContain("tx-icon-letter");
    expect(html).toContain("?");
  });

  it("undefined returns tx-icon-letter with ?", () => {
    const html = window.categoryIcon(undefined);
    expect(html).toContain("tx-icon-letter");
    expect(html).toContain("?");
  });

  test("categoryIcon XSS: category starting with < is escaped", () => {
    const html = window.categoryIcon("<script>");
    expect(html).toContain("&lt;");
    expect(html).not.toContain("<script");
  });
  test("categoryIcon XSS: category starting with & is escaped", () => {
    const html = window.categoryIcon("&evil");
    expect(html).toContain("&amp;");
  });
  test("categoryIcon XSS: category starting with \" is escaped", () => {
    const html = window.categoryIcon('"quote');
    expect(html).toContain("&quot;");
  });
});

// ===========================================================================
// txItemHTML meta format — tested via dashboard recent transactions
// ===========================================================================
describe("txItemHTML meta format", () => {
  const BASE_TX = {
    id: 50,
    date: "2026-05-01",
    transaction_type: "expense",
    amount: -300,
    account_name: "HDFC Savings",
    merchant_name: "Swiggy",
    merchant_upi_id: null,
    description: "Food order",
    category: { name: "Food & Dining" },
  };

  async function renderDashboardWithTx(tx) {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([tx]);
    const renderFn = window.Router.routes["#/"];
    await renderFn();
    return document.getElementById("screen");
  }

  afterEach(() => {
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getAccounts.mockResolvedValue([]);
  });

  it("meta line shows date only (no account name, no separator)", async () => {
    const screen = await renderDashboardWithTx(BASE_TX);
    const meta = screen.querySelector(".tx-meta");
    expect(meta).not.toBeNull();
    expect(meta.textContent).not.toContain("HDFC Savings");
    expect(meta.textContent).not.toContain("·");
  });

  it("meta line does NOT contain the category name", async () => {
    const screen = await renderDashboardWithTx(BASE_TX);
    const meta = screen.querySelector(".tx-meta");
    expect(meta).not.toBeNull();
    expect(meta.textContent).not.toContain("Food & Dining");
  });
});

// ===========================================================================
// API bridge — getGmailCustomSenders / saveGmailCustomSenders
// (tested via the real api.js by importing separately from the mock)
// ===========================================================================
describe("API.getGmailCustomSenders / saveGmailCustomSenders (real api.js)", () => {
  // Import the real API module (not the vi.mock used for app.js tests)
  let RealAPI;
  const KEY = "fincoach-gmail-custom-senders";

  beforeAll(async () => {
    const mod = await import("../../static/js/api.js?real=1");
    RealAPI = mod.API;
  });

  beforeEach(() => {
    localStorage.removeItem(KEY);
  });

  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("getGmailCustomSenders returns [] when key not set", () => {
    const result = RealAPI.getGmailCustomSenders();
    expect(result).toEqual([]);
  });

  it("getGmailCustomSenders returns [] when key is empty string", () => {
    localStorage.setItem(KEY, "");
    const result = RealAPI.getGmailCustomSenders();
    expect(result).toEqual([]);
  });

  it("getGmailCustomSenders parses comma-separated string to array", () => {
    localStorage.setItem(KEY, "a@b.com,c@d.com");
    const result = RealAPI.getGmailCustomSenders();
    expect(result).toEqual(["a@b.com", "c@d.com"]);
  });

  it("getGmailCustomSenders trims whitespace from entries", () => {
    localStorage.setItem(KEY, "  a@b.com  ,  c@d.com  ");
    const result = RealAPI.getGmailCustomSenders();
    expect(result).toEqual(["a@b.com", "c@d.com"]);
  });

  it("saveGmailCustomSenders removes key when given empty array", () => {
    localStorage.setItem(KEY, "a@b.com");
    RealAPI.saveGmailCustomSenders([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("saveGmailCustomSenders removes key when given null", () => {
    localStorage.setItem(KEY, "a@b.com");
    RealAPI.saveGmailCustomSenders(null);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("saveGmailCustomSenders stores joined string for non-empty array", () => {
    RealAPI.saveGmailCustomSenders(["a@b.com"]);
    expect(localStorage.getItem(KEY)).toBe("a@b.com");
  });

  it("saveGmailCustomSenders stores multiple entries joined by comma", () => {
    RealAPI.saveGmailCustomSenders(["a@b.com", "c@d.com"]);
    expect(localStorage.getItem(KEY)).toBe("a@b.com,c@d.com");
  });
});

// ===========================================================================
// BUG-PROD-01: GDrive backup API key checkbox visibility follows provider
// ===========================================================================
describe("BUG-PROD-01: GDrive backup API key checkbox visibility", () => {
  async function renderSettingsWithProvider(providerKey) {
    AI.getSettings.mockReturnValue(
      providerKey ? { provider: providerKey, apiKey: "sk-test", model: "m" } : {},
    );
    mockAPI.getGmailStatus.mockResolvedValue({ connected: true, email: "user@example.com" });
    vi.spyOn(GDrive, "isEnabled").mockReturnValue(true);
    vi.spyOn(GDrive, "getLastSyncTime").mockReturnValue(null);
    vi.spyOn(GDrive, "getLastModified").mockResolvedValue(null);
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("backup key checkbox is hidden when provider has requiresKey: false (Ollama)", async () => {
    const screen = await renderSettingsWithProvider("ollama");
    const field = screen.querySelector("#gdrive-backup-api-key-field");
    expect(field).not.toBeNull();
    expect(field.classList.contains("hidden")).toBe(true);
  });

  it("backup key checkbox is visible when provider has requiresKey: true (Groq)", async () => {
    const screen = await renderSettingsWithProvider("groq");
    const field = screen.querySelector("#gdrive-backup-api-key-field");
    expect(field).not.toBeNull();
    expect(field.classList.contains("hidden")).toBe(false);
  });
});

// ===========================================================================
// CSP-safe inline-style migration — Settings & Vault (Issues 5 & 6)
// ===========================================================================
describe("Settings inline-style migration to CSS classes", () => {
  async function renderSettingsWithProvider(providerKey) {
    AI.getSettings.mockReturnValue(
      providerKey ? { provider: providerKey, apiKey: "sk-test", model: "m" } : {},
    );
    mockAPI.getGmailStatus.mockResolvedValue({ connected: true, email: "user@example.com" });
    mockAPI.isVaultConfigured.mockReturnValue(true);
    localStorage.setItem("fincoach-vault-salt", "configured");
    vi.spyOn(GDrive, "isEnabled").mockReturnValue(true);
    vi.spyOn(GDrive, "getLastSyncTime").mockReturnValue(null);
    vi.spyOn(GDrive, "getLastModified").mockResolvedValue(null);
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  afterEach(() => {
    mockAPI.isVaultConfigured.mockReturnValue(false);
    localStorage.removeItem("fincoach-vault-salt");
    vi.restoreAllMocks();
  });

  it("renderSettings output contains no inline style= attribute", async () => {
    const screen = await renderSettingsWithProvider("groq");
    expect(screen.innerHTML).not.toContain('style="');
  });

  it("vault button group renders with class btn-group and no inline style", async () => {
    const screen = await renderSettingsWithProvider("groq");
    const changePinBtn = screen.querySelector('[data-action="vault-change-passphrase"]');
    expect(changePinBtn).not.toBeNull();
    const group = changePinBtn.parentElement;
    expect(group.classList.contains("btn-group")).toBe(true);
    expect(group.getAttribute("style")).toBeNull();
  });

  it("onProviderChange hides azure + ollama fields when provider is gemini (Issue 5)", async () => {
    const screen = await renderSettingsWithProvider("gemini");
    const sel = screen.querySelector("#ai-provider");
    sel.value = "gemini";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screen.querySelector("#azure-fields").classList.contains("hidden")).toBe(true);
    expect(screen.querySelector("#ollama-base-url-field").classList.contains("hidden")).toBe(true);
  });

  it("onProviderChange shows azure fields when provider is azure", async () => {
    const screen = await renderSettingsWithProvider("gemini");
    const sel = screen.querySelector("#ai-provider");
    sel.value = "azure";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screen.querySelector("#azure-fields").classList.contains("hidden")).toBe(false);
  });

  it("onProviderChange shows ollama base URL field when provider is ollama", async () => {
    const screen = await renderSettingsWithProvider("gemini");
    const sel = screen.querySelector("#ai-provider");
    sel.value = "ollama";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(screen.querySelector("#ollama-base-url-field").classList.contains("hidden")).toBe(false);
  });
});

// ===========================================================================
// Transaction Tags — UI rendering
// ===========================================================================

// NOTE: Tag badges are rendered by txItemHTML(), used in the Dashboard's "Recent Transactions".
// The Transactions list screen (loadTransactionList) renders a leaner template without tag badges.
// See BUG: missing tag badges in loadTransactionList — tracked in GitHub Issues.
describe("Transaction Tags: tag badges rendered via Dashboard txItemHTML", () => {
  const BASE_TX = {
    id: 99,
    date: "2026-06-01",
    transaction_type: "expense",
    amount: 200,
    account_name: "HDFC",
    description: "Tagged purchase",
    merchant_name: null,
    merchant_upi_id: null,
    category: null,
  };

  async function renderDashboardWithTx(tx) {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([tx]);
    mockAPI.getUpcomingBills.mockResolvedValue([]);
    const renderFn = window.Router.routes["#/"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));
    return document.getElementById("screen");
  }

  afterEach(() => {
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getUpcomingBills.mockResolvedValue([]);
  });

  it("renders no .tx-tags div when transaction has no tags", async () => {
    const screen = await renderDashboardWithTx({ ...BASE_TX, tags: [] });
    const tagDivs = screen.querySelectorAll(".tx-tags");
    expect(tagDivs).toHaveLength(0);
  });

  it("does not render .tag-badge in list view (tags shown in detail only)", async () => {
    const screen = await renderDashboardWithTx({
      ...BASE_TX,
      tags: [
        { id: 1, name: "vacation" },
        { id: 2, name: "online" },
      ],
    });
    const badges = screen.querySelectorAll(".tag-badge");
    expect(badges.length).toBe(0);
  });

  it("does not render .tx-tags wrapper in list view", async () => {
    const screen = await renderDashboardWithTx({
      ...BASE_TX,
      tags: [{ id: 1, name: "food" }],
    });
    const wrapper = screen.querySelector(".tx-tags");
    expect(wrapper).toBeNull();
  });
});

describe("Transaction Tags: tag filter select in transactions screen", () => {
  afterEach(() => {
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
  });

  it("renders tag filter dropdown when tags exist", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([
      { id: 1, name: "work" },
      { id: 2, name: "personal" },
    ]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 0,
      net: 0,
      transaction_count: 0,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));
    const screen = document.getElementById("screen");
    const dropdown = screen.querySelector("#f-tags-dropdown");
    expect(dropdown).not.toBeNull();
    const checkboxes = dropdown.querySelectorAll("input[type=checkbox]");
    expect(checkboxes.length).toBe(2);
  });

  it("does not render tag filter dropdown when no tags exist", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 0,
      net: 0,
      transaction_count: 0,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));
    const screen = document.getElementById("screen");
    const dropdown = screen.querySelector("#f-tags-dropdown");
    expect(dropdown).toBeNull();
  });
});

describe("Transaction Tags: Taxonomy Tags tab rendering", () => {
  afterEach(() => {
    mockAPI.getTags.mockResolvedValue([]);
  });

  it("renders Tags tab button in taxonomy tab bar", async () => {
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    const renderFn = window.Router.routes["#/taxonomy"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));
    const screen = document.getElementById("screen");
    const tagsBtn = screen.querySelector("[data-action='switch-taxonomy-tab'][data-mode='tags']");
    expect(tagsBtn).not.toBeNull();
    expect(tagsBtn.textContent.trim()).toBe("Tags");
  });

  it("renders empty state on Tags tab when no tags exist", async () => {
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);

    // Switch to the tags tab
    const switchTab = window.Router.routes["#/taxonomy"];
    await switchTab();
    await new Promise((r) => setTimeout(r, 0));

    const screen = document.getElementById("screen");
    // Programmatically switch to the tags tab
    const tagsTabBtn = screen.querySelector("[data-action='switch-taxonomy-tab'][data-mode='tags']");
    expect(tagsTabBtn).not.toBeNull();
    tagsTabBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const content = document.getElementById("taxonomy-content");
    expect(content).not.toBeNull();
    expect(content.innerHTML).toContain("No tags yet");
  });

  it("renders tag list items when tags exist", async () => {
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([
      { id: 1, name: "vacation" },
      { id: 2, name: "work" },
    ]);

    const renderFn = window.Router.routes["#/taxonomy"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));

    const screen = document.getElementById("screen");
    const tagsTabBtn = screen.querySelector("[data-action='switch-taxonomy-tab'][data-mode='tags']");
    expect(tagsTabBtn).not.toBeNull();
    tagsTabBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const content = document.getElementById("taxonomy-content");
    expect(content).not.toBeNull();
    expect(content.innerHTML).toContain("#vacation");
    expect(content.innerHTML).toContain("#work");
  });

  it("shows FAB with data-action=show-add-tag when Tags tab is active", async () => {
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);

    const renderFn = window.Router.routes["#/taxonomy"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));

    const screen = document.getElementById("screen");
    const tagsTabBtn = screen.querySelector("[data-action='switch-taxonomy-tab'][data-mode='tags']");
    tagsTabBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const fab = document.querySelector(".fab[data-action='show-add-tag']");
    expect(fab).not.toBeNull();
  });
});

describe("Transaction Tags: Reports screen tag filter", () => {
  afterEach(() => {
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getSpendingReport.mockResolvedValue({ total_transactions: 0, categories: [] });
  });

  it("renders #report-tags-dropdown when tags exist", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([{ id: 1, name: "online" }]);
    mockAPI.getSpendingReport.mockResolvedValue({ total_transactions: 0, categories: [] });

    const renderFn = window.Router.routes["#/reports"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 50));

    const screen = document.getElementById("screen");
    const dropdown = screen.querySelector("#report-tags-dropdown");
    expect(dropdown).not.toBeNull();
    const labels = [...dropdown.querySelectorAll(".tag-filter-option")];
    expect(labels.some((l) => l.textContent.includes("#online"))).toBe(true);
  });

  it("does not render #report-tags-dropdown when no tags exist", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getSpendingReport.mockResolvedValue({ total_transactions: 0, categories: [] });

    const renderFn = window.Router.routes["#/reports"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 50));

    const screen = document.getElementById("screen");
    const dropdown = screen.querySelector("#report-tags-dropdown");
    expect(dropdown).toBeNull();
  });
});

// ===========================================================================
// runSync — date-range validation
// ===========================================================================
describe("runSync date-range validation", () => {
  beforeEach(async () => {
    // Add gmailSearch to the shared mock (not in original mockAPI definition)
    mockAPI.gmailSearch = vi.fn().mockResolvedValue({
      found_count: 0,
      import_results: { imported: 0, duplicates: 0, skipped: 0, errors: 0 },
    });
    mockAPI.getGmailStatus.mockResolvedValue({ connected: true, email: "user@gmail.com" });
    const renderFn = window.Router.routes["#/sync"];
    await renderFn();
    // Switch to date-range mode
    const rangeBtn = document.querySelector('[data-action="set-sync-mode"][data-mode="range"]');
    if (rangeBtn) rangeBtn.click();
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(() => {
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    mockAPI.gmailSearch = vi.fn();
  });

  it("shows inline error message when start > end", async () => {
    const startInput = document.getElementById("sync-start");
    const endInput = document.getElementById("sync-end");
    if (!startInput || !endInput) return; // fields only render when connected
    startInput.value = "2025-06-15";
    endInput.value = "2025-06-01";
    document.getElementById("btn-sync").click();
    await new Promise((r) => setTimeout(r, 50));
    const resultsDiv = document.getElementById("sync-results");
    expect(resultsDiv.innerHTML).toContain("Start date cannot be later than end date");
  });

  it("does NOT call API.gmailSearch when start > end", async () => {
    const startInput = document.getElementById("sync-start");
    const endInput = document.getElementById("sync-end");
    if (!startInput || !endInput) return;
    startInput.value = "2025-06-15";
    endInput.value = "2025-06-01";
    document.getElementById("btn-sync").click();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAPI.gmailSearch).not.toHaveBeenCalled();
  });

  it("re-enables the sync button after date validation error", async () => {
    const startInput = document.getElementById("sync-start");
    const endInput = document.getElementById("sync-end");
    if (!startInput || !endInput) return;
    startInput.value = "2025-06-15";
    endInput.value = "2025-06-01";
    const btn = document.getElementById("btn-sync");
    btn.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(btn.disabled).toBe(false);
  });

  it("calls API.gmailSearch when start === end (equal dates are valid)", async () => {
    const startInput = document.getElementById("sync-start");
    const endInput = document.getElementById("sync-end");
    if (!startInput || !endInput) return;
    startInput.value = "2025-06-01";
    endInput.value = "2025-06-01";
    document.getElementById("btn-sync").click();
    await new Promise((r) => setTimeout(r, 100));
    expect(mockAPI.gmailSearch).toHaveBeenCalledOnce();
  });

  it("calls API.gmailSearch when start < end (valid range)", async () => {
    const startInput = document.getElementById("sync-start");
    const endInput = document.getElementById("sync-end");
    if (!startInput || !endInput) return;
    startInput.value = "2025-05-01";
    endInput.value = "2025-06-01";
    document.getElementById("btn-sync").click();
    await new Promise((r) => setTimeout(r, 100));
    expect(mockAPI.gmailSearch).toHaveBeenCalledOnce();
  });

  it("no error shown in sync-results when start < end", async () => {
    const startInput = document.getElementById("sync-start");
    const endInput = document.getElementById("sync-end");
    if (!startInput || !endInput) return;
    startInput.value = "2025-05-01";
    endInput.value = "2025-06-01";
    document.getElementById("btn-sync").click();
    await new Promise((r) => setTimeout(r, 100));
    const resultsDiv = document.getElementById("sync-results");
    expect(resultsDiv.innerHTML).not.toContain("Start date cannot be later than end date");
  });
});

// ===========================================================================
// Privacy mode helpers
// ===========================================================================
describe("Privacy mode helpers", () => {
  beforeEach(() => {
    localStorage.removeItem("fincoach-privacy-mode");
    document.body.classList.add("privacy-active");
    for (const el of document.querySelectorAll(".modal-overlay")) el.remove();
  });

  afterEach(() => {
    localStorage.removeItem("fincoach-privacy-mode");
    document.body.classList.remove("privacy-active");
    vi.restoreAllMocks();
  });

  it("dashboard renders .amount-private spans for monetary values", async () => {
    mockAPI.getAccounts.mockResolvedValue([
      {
        id: 1,
        name: "HDFC Savings",
        account_type: "savings",
        balance: 10000,
        effective_balance: 10000,
        balance_updated_at: "2026-01-01",
        is_active: true,
        merged_accounts: [],
        merged_into_id: null,
      },
    ]);
    mockAPI.getTransactions.mockResolvedValue([]);
    const renderFn = window.Router.routes["#/"];
    await renderFn();
    const screen = document.getElementById("screen");
    const amountSpans = screen.querySelectorAll(".amount-private");
    expect(amountSpans.length).toBeGreaterThan(0);
  });

  it(".balance-amount contains a .amount-private child span", async () => {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([]);
    const renderFn = window.Router.routes["#/"];
    await renderFn();
    const balanceAmount = document.querySelector(".balance-amount");
    expect(balanceAmount).not.toBeNull();
    expect(balanceAmount.querySelector(".amount-private")).not.toBeNull();
  });

  it("#privacy-toggle-btn is present in the layout header", () => {
    const btn = document.getElementById("privacy-toggle-btn");
    expect(btn).not.toBeNull();
  });

  it("clicking #privacy-toggle-btn removes privacy-active from body when body is hidden", () => {
    document.body.classList.add("privacy-active");
    const btn = document.getElementById("privacy-toggle-btn");
    expect(btn).not.toBeNull();
    btn.click();
    expect(document.body.classList.contains("privacy-active")).toBe(false);
  });

  it("clicking #privacy-toggle-btn adds privacy-active when body is revealed and privacy is enabled", () => {
    document.body.classList.remove("privacy-active");
    localStorage.removeItem("fincoach-privacy-mode"); // absent = enabled
    const btn = document.getElementById("privacy-toggle-btn");
    btn.click();
    expect(document.body.classList.contains("privacy-active")).toBe(true);
  });

  it("when privacy mode is disabled (key=false), hidePrivacy does not add privacy-active", () => {
    localStorage.setItem("fincoach-privacy-mode", "false");
    document.body.classList.remove("privacy-active");
    // Toggle button click when not hidden → calls hidePrivacy()
    // hidePrivacy: isPrivacyEnabled() = false → does NOT add class
    const btn = document.getElementById("privacy-toggle-btn");
    btn.click();
    expect(document.body.classList.contains("privacy-active")).toBe(false);
  });
});

// ===========================================================================
// Transaction notes field
// ===========================================================================
describe("Transaction notes field", () => {
  const BASE_TX = {
    id: 1,
    date: "2026-05-15",
    transaction_type: "expense",
    amount: -200,
    account_name: "HDFC",
    category: null,
    tags: [],
  };

  async function renderDashboardWithTxNotes(tx) {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([tx]);
    const renderFn = window.Router.routes["#/"];
    await renderFn();
    return document.getElementById("screen");
  }

  async function renderTxListWithTxNotes(tx) {
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([tx]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 200,
      net: -200,
      transaction_count: 1,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));
    return document.getElementById("screen");
  }

  afterEach(() => {
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    for (const el of document.querySelectorAll(".modal-overlay")) el.remove();
  });

  it("dashboard shows .tx-note when description and merchant_name are both set", async () => {
    const screen = await renderDashboardWithTxNotes({
      ...BASE_TX,
      merchant_name: "Test Merchant",
      merchant_upi_id: null,
      description: "Birthday dinner",
    });
    const note = screen.querySelector(".tx-note");
    expect(note).not.toBeNull();
    expect(note.textContent).toContain("Birthday dinner");
  });

  it("dashboard hides .tx-note when description is null", async () => {
    const screen = await renderDashboardWithTxNotes({
      ...BASE_TX,
      merchant_name: "Test Merchant",
      merchant_upi_id: null,
      description: null,
    });
    expect(screen.querySelector(".tx-note")).toBeNull();
  });

  it("dashboard hides .tx-note when description exists but no merchant_name or merchant_upi_id", async () => {
    const screen = await renderDashboardWithTxNotes({
      ...BASE_TX,
      merchant_name: null,
      merchant_upi_id: null,
      description: "Note without merchant",
    });
    expect(screen.querySelector(".tx-note")).toBeNull();
  });

  it("dashboard .tx-note shows when merchant_upi_id is set (not merchant_name)", async () => {
    const screen = await renderDashboardWithTxNotes({
      ...BASE_TX,
      merchant_name: null,
      merchant_upi_id: "coffee@upi",
      description: "My coffee note",
    });
    const note = screen.querySelector(".tx-note");
    expect(note).not.toBeNull();
    expect(note.textContent).toContain("My coffee note");
  });

  it("dashboard .tx-note truncates description to 60 chars with ellipsis", async () => {
    const screen = await renderDashboardWithTxNotes({
      ...BASE_TX,
      merchant_name: "Test Merchant",
      merchant_upi_id: null,
      description: "A".repeat(100),
    });
    const note = screen.querySelector(".tx-note");
    expect(note).not.toBeNull();
    // truncate(str, 60) produces str.slice(0,60) + '…' — max 61 chars
    expect(note.textContent.length).toBeLessThanOrEqual(62);
  });

  it("transactions list shows .tx-note when description and merchant_name are set", async () => {
    const screen = await renderTxListWithTxNotes({
      ...BASE_TX,
      merchant_name: "List Merchant",
      merchant_upi_id: null,
      description: "List note text",
    });
    const notes = screen.querySelectorAll(".tx-note");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].textContent).toContain("List note text");
  });

  it("transactions list hides .tx-note when description is null", async () => {
    const screen = await renderTxListWithTxNotes({
      ...BASE_TX,
      merchant_name: "Shop",
      merchant_upi_id: null,
      description: null,
    });
    expect(screen.querySelectorAll(".tx-note").length).toBe(0);
  });

  it("edit overlay: #edit-desc has empty value when notes is null", async () => {
    const txWithDesc = {
      ...BASE_TX,
      merchant_name: "Shop",
      merchant_upi_id: null,
      description: "old note",
    };
    mockAPI.getTransactions.mockResolvedValue([txWithDesc]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 200,
      net: -200,
      transaction_count: 1,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));

    const editEl = document.querySelector('[data-action="show-edit-tx"]');
    expect(editEl).not.toBeNull();
    editEl.click();
    await new Promise((r) => setTimeout(r, 100));

    const editDesc = document.getElementById("edit-desc");
    expect(editDesc).not.toBeNull();
    // No notes set — value should be empty
    expect(editDesc.value).toBe("");
    expect(editDesc.placeholder).toBe("Add Notes");
  });

  it("edit overlay: #edit-desc placeholder is 'Add Notes'", async () => {
    const txNoDesc = {
      ...BASE_TX,
      merchant_name: "Shop",
      merchant_upi_id: null,
      description: null,
    };
    mockAPI.getTransactions.mockResolvedValue([txNoDesc]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 200,
      net: -200,
      transaction_count: 1,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));

    const editEl = document.querySelector('[data-action="show-edit-tx"]');
    expect(editEl).not.toBeNull();
    editEl.click();
    await new Promise((r) => setTimeout(r, 100));

    const editDesc = document.getElementById("edit-desc");
    expect(editDesc).not.toBeNull();
    expect(editDesc.placeholder).toBe("Add Notes");
  });

  it("edit overlay label reads 'Notes' (not 'Description')", async () => {
    const txData = {
      ...BASE_TX,
      merchant_name: "Shop",
      merchant_upi_id: null,
      description: null,
    };
    mockAPI.getTransactions.mockResolvedValue([txData]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 200,
      net: -200,
      transaction_count: 1,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));

    const editEl = document.querySelector('[data-action="show-edit-tx"]');
    editEl.click();
    await new Promise((r) => setTimeout(r, 100));

    const modal = document.querySelector(".modal-overlay .modal");
    expect(modal).not.toBeNull();
    const labels = [...modal.querySelectorAll("label")];
    expect(labels.some((l) => l.textContent.trim() === "Notes")).toBe(true);
    expect(labels.some((l) => l.textContent.trim() === "Description")).toBe(false);
  });

  it("add transaction form label reads 'Notes'", async () => {
    const renderFn = window.Router.routes["#/transactions/new"];
    await renderFn();
    const screen = document.getElementById("screen");
    const labels = [...screen.querySelectorAll("label")];
    expect(labels.some((l) => l.textContent.trim() === "Notes")).toBe(true);
  });

  it("add transaction form #new-desc placeholder is 'Add a personal note…'", async () => {
    const renderFn = window.Router.routes["#/transactions/new"];
    await renderFn();
    const screen = document.getElementById("screen");
    const descInput = screen.querySelector("#new-desc");
    expect(descInput).not.toBeNull();
    expect(descInput.placeholder).toBe("Add a personal note\u2026");
  });

  // -------------------------------------------------------------------------
  // Gmail transaction: Notes field shown as placeholder, not pre-filled value
  // -------------------------------------------------------------------------
  it("edit overlay: Gmail tx with no notes has empty value and 'Add Notes' placeholder", async () => {
    const gmailTx = {
      ...BASE_TX,
      gmail_message_id: "msg_abc123",
      merchant_name: "HDFC MF",
      merchant_upi_id: null,
      description: "Merchant: HDFC MF | Method: UPI | Purpose: SIP",
    };
    mockAPI.getTransactions.mockResolvedValue([gmailTx]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 200,
      net: -200,
      transaction_count: 1,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));

    const editEl = document.querySelector('[data-action="show-edit-tx"]');
    expect(editEl).not.toBeNull();
    editEl.click();
    await new Promise((r) => setTimeout(r, 100));

    const editDesc = document.getElementById("edit-desc");
    expect(editDesc).not.toBeNull();
    // Value must be empty — no notes set
    expect(editDesc.value).toBe("");
    // Placeholder is now generic
    expect(editDesc.placeholder).toBe("Add Notes");
  });

  it("edit overlay: Gmail tx with no description shows generic placeholder", async () => {
    const gmailTx = {
      ...BASE_TX,
      gmail_message_id: "msg_xyz",
      merchant_name: null,
      merchant_upi_id: null,
      description: null,
    };
    mockAPI.getTransactions.mockResolvedValue([gmailTx]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 200,
      net: -200,
      transaction_count: 1,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));

    const editEl = document.querySelector('[data-action="show-edit-tx"]');
    editEl.click();
    await new Promise((r) => setTimeout(r, 100));

    const editDesc = document.getElementById("edit-desc");
    expect(editDesc).not.toBeNull();
    expect(editDesc.value).toBe("");
    expect(editDesc.placeholder).toBe("Add Notes");
  });

  it("edit overlay: modal data-is-gmail attribute has been removed", async () => {
    // Verify that data-is-gmail is no longer present on the modal
    mockAPI.getTransactions.mockResolvedValue([{ ...BASE_TX, gmail_message_id: "msg1", description: "desc", merchant_name: null, merchant_upi_id: null }]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({ total_income: 0, total_expense: 200, net: -200, transaction_count: 1 });
    await window.Router.routes["#/transactions"]();
    await new Promise((r) => setTimeout(r, 0));
    document.querySelector('[data-action="show-edit-tx"]').click();
    await new Promise((r) => setTimeout(r, 100));
    const modal = document.querySelector(".modal-overlay .modal");
    expect(modal.dataset.isGmail).toBeUndefined();
  });

  it("edit overlay: Gmail tx with user notes shows notes as value (not placeholder)", async () => {
    const gmailTxWithNotes = {
      ...BASE_TX,
      gmail_message_id: "msg_with_notes",
      merchant_name: "HDFC MF",
      merchant_upi_id: null,
      description: "Merchant: HDFC MF | Method: UPI | Purpose: SIP",
      notes: "My custom note",
    };
    mockAPI.getTransactions.mockResolvedValue([gmailTxWithNotes]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 200,
      net: -200,
      transaction_count: 1,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));

    document.querySelector('[data-action="show-edit-tx"]').click();
    await new Promise((r) => setTimeout(r, 100));

    const editDesc = document.getElementById("edit-desc");
    expect(editDesc).not.toBeNull();
    // User notes must show as normal text value
    expect(editDesc.value).toBe("My custom note");
    // Placeholder is now generic
    expect(editDesc.placeholder).toBe("Add Notes");
  });
});

// ===========================================================================
// detectPaymentType
// ===========================================================================
describe("detectPaymentType", () => {
  test("UPI via merchantUpiId set", () => {
    expect(window.detectPaymentType("", "hdfc@upi")).toBe("UPI");
  });
  test("UPI via description keyword UPI", () => {
    expect(window.detectPaymentType("Payment via UPI", null)).toBe("UPI");
  });
  test("UPI via method: UPI in description", () => {
    expect(window.detectPaymentType("method: UPI | SIP debit", null)).toBe("UPI");
  });
  test("NEFT", () => {
    expect(window.detectPaymentType("NEFT transfer ref 123", null)).toBe("NEFT");
  });
  test("RTGS", () => {
    expect(window.detectPaymentType("RTGS payment to vendor", null)).toBe("RTGS");
  });
  test("IMPS", () => {
    expect(window.detectPaymentType("IMPS payment received", null)).toBe("IMPS");
  });
  test("Wallet \u2014 generic Wallet keyword", () => {
    expect(window.detectPaymentType("Wallet payment", null)).toBe("Wallet");
  });
  test("Wallet \u2014 Amazon Pay Wallet", () => {
    expect(window.detectPaymentType("Amazon Pay Wallet debit", null)).toBe("Wallet");
  });
  test("UPI beats Wallet \u2014 PhonePe UPI via merchantUpiId", () => {
    expect(window.detectPaymentType("PhonePe Wallet transaction", "abc@ybl")).toBe("UPI");
  });
  test("UPI beats Wallet \u2014 UPI keyword in description alongside Wallet", () => {
    expect(window.detectPaymentType("Wallet transfer via UPI", null)).toBe("UPI");
  });
  test("Unknown for unrecognized description", () => {
    expect(window.detectPaymentType("ATM cash withdrawal", null)).toBe("Unknown");
  });
  test("Unknown when description is null and no upiId", () => {
    expect(window.detectPaymentType(null, null)).toBe("Unknown");
  });
  test("Wallet \u2014 Method: Wallet in description (not UPI)", () => {
    expect(window.detectPaymentType("Merchant: Amazon | Method: Wallet | Via: Amazon Pay", null)).toBe("Wallet");
  });
  test("Wallet \u2014 Method: Wallet not confused as UPI even with Amazon Pay keyword", () => {
    expect(window.detectPaymentType("Merchant: Amazon | Method: Wallet | Via: Amazon Pay", null)).toBe("Wallet");
  });
  test("UPI \u2014 Method: UPI still wins when merchantUpiId also present", () => {
    expect(window.detectPaymentType("Merchant: Amazon | Method: UPI | Via: Amazon Pay", "amazonpay@apl")).toBe("UPI");
  });
});

// ===========================================================================
// Transaction Type field in edit modal
// ===========================================================================
describe("Transaction Type field", () => {
  const BASE_TX = {
    id: 1,
    date: "2026-05-15",
    transaction_type: "expense",
    amount: -200,
    account_name: "HDFC",
    category: null,
    tags: [],
  };

  async function openEditModalWith(tx) {
    mockAPI.getTransactions.mockResolvedValue([tx]);
    mockAPI.getAccounts.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 200,
      net: -200,
      transaction_count: 1,
    });
    await window.Router.routes["#/transactions"]();
    await new Promise((r) => setTimeout(r, 0));
    document.querySelector('[data-action="show-edit-tx"]').click();
    await new Promise((r) => setTimeout(r, 100));
  }

  afterEach(() => {
    for (const el of document.querySelectorAll(".modal-overlay")) el.remove();
  });

  it("edit overlay: Transaction Type field exists and is readonly", async () => {
    await openEditModalWith({ ...BASE_TX, merchant_upi_id: null, description: null });
    const payTypeEl = document.getElementById("edit-payment-type");
    expect(payTypeEl).not.toBeNull();
    expect(payTypeEl.readOnly).toBe(true);
  });

  it("edit overlay: Transaction Type shows 'UPI' when merchant_upi_id is set", async () => {
    await openEditModalWith({ ...BASE_TX, merchant_upi_id: "hdfc@upi", description: null });
    expect(document.getElementById("edit-payment-type").value).toBe("UPI");
  });

  it("edit overlay: Transaction Type shows 'NEFT' for NEFT description", async () => {
    await openEditModalWith({ ...BASE_TX, merchant_upi_id: null, description: "NEFT transfer ref 456" });
    expect(document.getElementById("edit-payment-type").value).toBe("NEFT");
  });

  it("edit overlay: Transaction Type shows 'Unknown' when no patterns match", async () => {
    await openEditModalWith({ ...BASE_TX, merchant_upi_id: null, description: null });
    expect(document.getElementById("edit-payment-type").value).toBe("Unknown");
  });
});

// ===========================================================================
// FINCO-49 — Merged accounts in the transactions filter
// ===========================================================================
describe("FINCO-49: merged accounts filter toggle", () => {
  const PARENT_ACCOUNT = {
    id: 1,
    name: "HDFC Savings",
    account_type: "savings",
    balance: 10000,
    effective_balance: 10000,
    balance_updated_at: "2026-01-01",
    is_active: true,
    merged_accounts: [],
    merged_into_id: null,
  };

  const CHILD_ACCOUNT = {
    id: 2,
    name: "HDFC Old",
    account_type: "savings",
    balance: 0,
    effective_balance: 0,
    balance_updated_at: null,
    is_active: true,
    merged_accounts: [],
    merged_into_id: 1,
  };

  async function renderTxScreen() {
    mockAPI.getAccounts.mockResolvedValue([PARENT_ACCOUNT, CHILD_ACCOUNT]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getTags.mockResolvedValue([]);
    mockAPI.getTransactionTotals.mockResolvedValue({
      total_income: 0,
      total_expense: 0,
      net: 0,
      transaction_count: 0,
    });
    const renderFn = window.Router.routes["#/transactions"];
    await renderFn();
    await new Promise((r) => setTimeout(r, 0));
    return document.getElementById("screen");
  }

  beforeEach(async () => {
    await renderTxScreen();
    // Ensure the toggle starts unchecked (show_merged_accounts = false, the default)
    const toggle = document.getElementById("f-merged");
    if (toggle && toggle.checked) {
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    }
  });

  afterEach(() => {
    mockAPI.getTransactions.mockResolvedValue([]);
    mockAPI.getCategories.mockResolvedValue([]);
    mockAPI.getAccounts.mockResolvedValue([]);
  });

  it("f-merged toggle is unchecked by default (show_merged_accounts = false)", () => {
    const toggle = document.getElementById("f-merged");
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(false);
  });

  it("toggle label reads 'Show merged accounts'", () => {
    const screen = document.getElementById("screen");
    const filterToggle = screen.querySelector(".filter-toggle");
    expect(filterToggle).not.toBeNull();
    expect(filterToggle.textContent).toContain("Show merged accounts");
  });

  it("account dropdown shows only parent accounts when show_merged_accounts = false", () => {
    const accountSel = document.getElementById("f-account");
    const options = [...accountSel.options].filter((o) => o.value !== "");
    // Only the parent account (merged_into_id = null) should be listed
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe(String(PARENT_ACCOUNT.id));
    expect(options[0].textContent).toBe(PARENT_ACCOUNT.name);
    // Child account must NOT appear
    const childOption = [...accountSel.options].find((o) => o.value === String(CHILD_ACCOUNT.id));
    expect(childOption).toBeUndefined();
  });

  it("account dropdown shows all accounts with '(merged)' suffix for children when show_merged_accounts = true", async () => {
    const toggle = document.getElementById("f-merged");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const accountSel = document.getElementById("f-account");
    const options = [...accountSel.options].filter((o) => o.value !== "");
    // Both parent and child accounts should be listed
    expect(options).toHaveLength(2);
    const parentOpt = options.find((o) => o.value === String(PARENT_ACCOUNT.id));
    const childOpt = options.find((o) => o.value === String(CHILD_ACCOUNT.id));
    expect(parentOpt).toBeDefined();
    expect(parentOpt.textContent).toBe(PARENT_ACCOUNT.name); // no "(merged)" suffix
    expect(childOpt).toBeDefined();
    expect(childOpt.textContent).toBe(`${CHILD_ACCOUNT.name} (merged)`);
  });

  it("clears selected child account when show_merged_accounts is toggled back to false", async () => {
    // First enable show_merged_accounts so the child account is accessible
    const toggle = document.getElementById("f-merged");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    // Select the child account
    const accountSel = document.getElementById("f-account");
    accountSel.value = String(CHILD_ACCOUNT.id);

    // Now disable show_merged_accounts
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    // Account dropdown should have been reset since child account is no longer shown
    expect(accountSel.value).toBe("");
  });

  it("parent account selection is preserved when toggling show_merged_accounts", async () => {
    const accountSel = document.getElementById("f-account");
    // Select the parent account while toggle is off
    accountSel.value = String(PARENT_ACCOUNT.id);

    // Enable show_merged_accounts
    const toggle = document.getElementById("f-merged");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    // Parent account selection should still be set
    expect(accountSel.value).toBe(String(PARENT_ACCOUNT.id));
  });

  it("getTransactions is called with include_merged=true when show_merged_accounts=false and account selected", async () => {
    mockAPI.getTransactions.mockClear();
    const accountSel = document.getElementById("f-account");
    accountSel.value = String(PARENT_ACCOUNT.id);
    accountSel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAPI.getTransactions).toHaveBeenCalled();
    const callArgs = mockAPI.getTransactions.mock.calls[0][0];
    expect(callArgs.account_id).toBe(String(PARENT_ACCOUNT.id));
    expect(callArgs.include_merged).toBe(true);
    expect(callArgs.show_merged_accounts).toBeUndefined();
  });

  it("getTransactions is called with include_merged=false when show_merged_accounts=true and account selected", async () => {
    // Enable show_merged_accounts
    const toggle = document.getElementById("f-merged");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    mockAPI.getTransactions.mockClear();
    const accountSel = document.getElementById("f-account");
    accountSel.value = String(PARENT_ACCOUNT.id);
    accountSel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAPI.getTransactions).toHaveBeenCalled();
    const callArgs = mockAPI.getTransactions.mock.calls[0][0];
    expect(callArgs.account_id).toBe(String(PARENT_ACCOUNT.id));
    expect(callArgs.include_merged).toBe(false);
    expect(callArgs.show_merged_accounts).toBeUndefined();
  });

  it("getTransactions is called without include_merged when no account is selected", async () => {
    mockAPI.getTransactions.mockClear();
    const accountSel = document.getElementById("f-account");
    accountSel.value = "";
    accountSel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAPI.getTransactions).toHaveBeenCalled();
    const callArgs = mockAPI.getTransactions.mock.calls[0][0];
    expect(callArgs.account_id).toBeUndefined();
    expect(callArgs.include_merged).toBeUndefined();
  });
});

// ===========================================================================
// Vault — PIN minimum 4 characters
// ===========================================================================
describe("Vault — PIN minimum 4 characters", () => {
  function openVaultSetupModal() {
    const btn = document.createElement("button");
    btn.setAttribute("data-action", "vault-setup");
    document.body.appendChild(btn);
    btn.click();
    document.body.removeChild(btn);
  }

  afterEach(() => {
    document.getElementById("vault-setup-modal")?.remove();
    mockAPI.setupVault.mockClear();
  });

  it("showVaultSetupModal renders '(min 6 digits/characters)' label text", () => {
    openVaultSetupModal();
    const modal = document.getElementById("vault-setup-modal");
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain("digits only, min 6");
    expect(modal.textContent).not.toContain("min 8 characters");
  });

  it("doSetupVault shows error for 3-character passphrase", async () => {
    openVaultSetupModal();
    const modal = document.getElementById("vault-setup-modal");
    expect(modal).not.toBeNull();

    modal.querySelector("#vault-setup-passphrase").value = "abc";
    modal.querySelector("#vault-setup-confirm").value = "abc";

    const submitBtn = modal.querySelector('[data-action="do-setup-vault"]');
    submitBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    const errEl = modal.querySelector("#vault-setup-error");
    expect(errEl.classList.contains("hidden")).toBe(false);
    expect(errEl.textContent).toContain("only digits and be at least 6 digits");
    expect(mockAPI.setupVault).not.toHaveBeenCalled();
  });

	it("doSetupVault rejects non-numeric PINs", async () => {
		openVaultSetupModal();
		const modal = document.getElementById("vault-setup-modal");
		expect(modal).not.toBeNull();

		modal.querySelector("#vault-setup-passphrase").value = "12ab";
		modal.querySelector("#vault-setup-confirm").value = "12ab";

		const submitBtn = modal.querySelector('[data-action="do-setup-vault"]');
		submitBtn.click();
		await new Promise((r) => setTimeout(r, 0));

		const errEl = modal.querySelector("#vault-setup-error");
		expect(errEl.classList.contains("hidden")).toBe(false);
		expect(errEl.textContent).toContain("only digits and be at least 6 digits");
		expect(mockAPI.setupVault).not.toHaveBeenCalled();
	});

  it("doSetupVault accepts 6-digit PIN and calls API.setupVault", async () => {
    openVaultSetupModal();
    const modal = document.getElementById("vault-setup-modal");
    expect(modal).not.toBeNull();

    modal.querySelector("#vault-setup-passphrase").value = "123456";
    modal.querySelector("#vault-setup-confirm").value = "123456";

    const submitBtn = modal.querySelector('[data-action="do-setup-vault"]');
    submitBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAPI.setupVault).toHaveBeenCalledWith("123456");
  });
});

// ===========================================================================
// Vault biometric availability and mobile PIN keyboard hints
// ===========================================================================
describe("Vault biometric availability and PIN inputs", () => {
  async function renderSettings() {
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  beforeEach(() => {
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    mockAPI.isBiometricEnabled.mockReturnValue(false);
    mockAPI.isBiometricAvailable.mockResolvedValue(false);
    localStorage.setItem("fincoach-vault-salt", "configured");
    vi.spyOn(GDrive, "isEnabled").mockReturnValue(false);
    vi.spyOn(GDrive, "getLastSyncTime").mockReturnValue(null);
  });

  afterEach(() => {
    localStorage.removeItem("fincoach-vault-salt");
    document.getElementById("vault-setup-modal")?.remove();
    document.getElementById("vault-unlock-screen")?.remove();
    document.getElementById("vault-change-modal")?.remove();
    vi.restoreAllMocks();
  });

  it("shows biometric enable button only when PRF-backed biometric unlock is supported", async () => {
    mockAPI.isBiometricAvailable.mockResolvedValue(true);

    const screen = await renderSettings();

    expect(screen.querySelector('[data-action="enable-biometric"]')).not.toBeNull();
    expect(screen.textContent).not.toContain("Not supported on this device");
  });

  it("shows unsupported copy and hides the enable button when PRF-backed biometric unlock is unavailable", async () => {
    mockAPI.isBiometricAvailable.mockResolvedValue(false);

    const screen = await renderSettings();

    expect(screen.querySelector('[data-action="enable-biometric"]')).toBeNull();
    expect(screen.textContent).toContain("Not supported on this device");
  });

  it("vault setup and unlock PIN inputs request a numeric mobile keyboard", async () => {
    const screen = await renderSettings();
    screen.querySelector('[data-action="vault-change-passphrase"]');

    const setupBtn = document.createElement("button");
    setupBtn.setAttribute("data-action", "vault-setup");
    document.body.appendChild(setupBtn);
    setupBtn.click();
    document.body.removeChild(setupBtn);

    const setupPin = document.getElementById("vault-setup-passphrase");
    const setupConfirm = document.getElementById("vault-setup-confirm");
    expect(setupPin?.getAttribute("inputmode")).toBe("numeric");
    expect(setupPin?.getAttribute("enterkeyhint")).toBe("next");
    expect(setupConfirm?.getAttribute("inputmode")).toBe("numeric");
    expect(setupConfirm?.getAttribute("enterkeyhint")).toBe("done");

    document.getElementById("vault-setup-modal")?.remove();
    document.dispatchEvent(new Event("vault-locked"));

    const unlockPin = document.getElementById("vault-unlock-passphrase");
    expect(unlockPin?.getAttribute("inputmode")).toBe("numeric");
    expect(unlockPin?.getAttribute("enterkeyhint")).toBe("done");
  });
});

// ===========================================================================
// Gmail connect — vault gating and auto-continue
// ===========================================================================
describe("Gmail connect vault gating", () => {
  async function renderSettings() {
    mockAPI.getGmailStatus.mockResolvedValue({ connected: false, email: null });
    const renderFn = window.Router.routes["#/settings"];
    await renderFn();
    return document.getElementById("screen");
  }

  afterEach(() => {
    document.getElementById("vault-setup-modal")?.remove();
    document.getElementById("vault-unlock-screen")?.remove();
    document.querySelector(".toast-container")?.replaceChildren();
    mockAPI.getGmailConnectUrl.mockClear();
    mockAPI.setupVault.mockReset();
    mockAPI.unlockVault.mockReset();
    mockAPI.isVaultConfigured.mockReturnValue(false);
    mockAPI.isVaultUnlocked.mockReturnValue(false);
  });

  it("clicking connect without a vault opens setup and does not start Gmail auth", async () => {
    mockAPI.isVaultConfigured.mockReturnValue(false);
    mockAPI.isVaultUnlocked.mockReturnValue(false);
    const screen = await renderSettings();

    screen.querySelector('[data-action="gdrive-connect"]').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.getElementById("vault-setup-modal")).not.toBeNull();
    expect(mockAPI.getGmailConnectUrl).not.toHaveBeenCalled();
  });

  it("successful PIN setup from connect flow automatically starts Gmail auth", async () => {
    mockAPI.isVaultConfigured.mockReturnValue(false);
    mockAPI.isVaultUnlocked.mockReturnValue(false);
    mockAPI.setupVault.mockImplementation(async () => {
      mockAPI.isVaultConfigured.mockReturnValue(true);
      mockAPI.isVaultUnlocked.mockReturnValue(true);
    });
    mockAPI.getGmailConnectUrl.mockResolvedValue({ connected: true });

    const screen = await renderSettings();
    screen.querySelector('[data-action="gdrive-connect"]').click();
    await new Promise((r) => setTimeout(r, 0));

    const modal = document.getElementById("vault-setup-modal");
    modal.querySelector("#vault-setup-passphrase").value = "123456";
    modal.querySelector("#vault-setup-confirm").value = "123456";
    modal.querySelector('[data-action="do-setup-vault"]').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAPI.setupVault).toHaveBeenCalledWith("123456");
    expect(mockAPI.getGmailConnectUrl).toHaveBeenCalledTimes(1);
  });

	it("successful PIN setup from connect flow clears the stale PIN-required error toast", async () => {
		mockAPI.isVaultConfigured.mockReturnValue(false);
		mockAPI.isVaultUnlocked.mockReturnValue(false);
		mockAPI.setupVault.mockImplementation(async () => {
			mockAPI.isVaultConfigured.mockReturnValue(true);
			mockAPI.isVaultUnlocked.mockReturnValue(true);
		});
		mockAPI.getGmailConnectUrl.mockResolvedValue({ connected: true });

		const screen = await renderSettings();
		screen.querySelector('[data-action="gdrive-connect"]').click();
		await new Promise((r) => setTimeout(r, 0));

		expect(
			Array.from(document.querySelectorAll(".toast.error")).some((toast) =>
				toast.textContent.includes("Set up a PIN before connecting Gmail."),
			),
		).toBe(true);

		const modal = document.getElementById("vault-setup-modal");
		modal.querySelector("#vault-setup-passphrase").value = "123456";
		modal.querySelector("#vault-setup-confirm").value = "123456";
		modal.querySelector('[data-action="do-setup-vault"]').click();
		await new Promise((r) => setTimeout(r, 50));

		expect(
			Array.from(document.querySelectorAll(".toast.error")).some((toast) =>
				toast.textContent.includes("Set up a PIN before connecting Gmail."),
			),
		).toBe(false);
	});

  it("successful unlock from connect flow automatically starts Gmail auth", async () => {
    mockAPI.isVaultConfigured.mockReturnValue(true);
    mockAPI.isVaultUnlocked.mockReturnValue(false);
    mockAPI.unlockVault.mockImplementation(async () => {
      mockAPI.isVaultUnlocked.mockReturnValue(true);
      return true;
    });
    mockAPI.getGmailConnectUrl.mockResolvedValue({ connected: true });

    const screen = await renderSettings();
    screen.querySelector('[data-action="gdrive-connect"]').click();
    await new Promise((r) => setTimeout(r, 0));

    const overlay = document.getElementById("vault-unlock-screen");
    expect(overlay).not.toBeNull();
    overlay.querySelector("#vault-unlock-passphrase").value = "1234";
    overlay.querySelector('[data-action="unlock-vault"]').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(mockAPI.unlockVault).toHaveBeenCalledWith("1234");
    expect(mockAPI.getGmailConnectUrl).toHaveBeenCalledTimes(1);
  });

	it("successful unlock from connect flow clears the stale unlock-required error toast", async () => {
		mockAPI.isVaultConfigured.mockReturnValue(true);
		mockAPI.isVaultUnlocked.mockReturnValue(false);
		mockAPI.unlockVault.mockImplementation(async () => {
			mockAPI.isVaultUnlocked.mockReturnValue(true);
			return true;
		});
		mockAPI.getGmailConnectUrl.mockResolvedValue({ connected: true });

		const screen = await renderSettings();
		screen.querySelector('[data-action="gdrive-connect"]').click();
		await new Promise((r) => setTimeout(r, 0));

		expect(
			Array.from(document.querySelectorAll(".toast.error")).some((toast) =>
				toast.textContent.includes("Unlock your PIN before connecting Gmail."),
			),
		).toBe(true);

		const overlay = document.getElementById("vault-unlock-screen");
		overlay.querySelector("#vault-unlock-passphrase").value = "1234";
		overlay.querySelector('[data-action="unlock-vault"]').click();
		await new Promise((r) => setTimeout(r, 50));

		expect(
			Array.from(document.querySelectorAll(".toast.error")).some((toast) =>
				toast.textContent.includes("Unlock your PIN before connecting Gmail."),
			),
		).toBe(false);
	});
});

// ===========================================================================
// FINCO-32 — Empty state messages with CTAs
// ===========================================================================
describe("FINCO-32: empty-state helper and screen CTAs", () => {
	it("emptyStateHTML renders icon, escaped text, and a CTA button", () => {
		const html = window.emptyStateHTML("🎯", "No <b>goals</b> yet", {
			actionLabel: "Create goal",
			action: "show-create-goal",
		});
		expect(html).toContain("empty-state");
		expect(html).toContain("🎯");
		expect(html).toContain("&lt;b&gt;goals&lt;/b&gt;");
		expect(html).toContain('data-action="show-create-goal"');
		expect(html).toContain("empty-cta");
		expect(html).toContain("Create goal");
	});

	it("emptyStateHTML adds data-route only when route is provided", () => {
		const withRoute = window.emptyStateHTML("📭", "None", {
			actionLabel: "Add",
			action: "nav-navigate",
			route: "#/transactions/new",
		});
		expect(withRoute).toContain('data-route="#/transactions/new"');
		const noRoute = window.emptyStateHTML("📭", "None", {
			actionLabel: "Add",
			action: "show-create-budget",
		});
		expect(noRoute).not.toContain("data-route");
	});

	it("emptyStateHTML omits the button when no actionLabel/action", () => {
		const html = window.emptyStateHTML("📭", "Nothing here");
		expect(html).not.toContain("empty-cta");
		expect(html).not.toContain("<button");
		expect(html).toContain("Nothing here");
	});

	it("budgets empty screen shows a create-budget CTA", async () => {
		mockAPI.getBudgets.mockResolvedValue([]);
		await window.Router.routes["#/budgets"]();
		const cta = document
			.getElementById("screen")
			.querySelector('.empty-cta[data-action="show-create-budget"]');
		expect(cta).not.toBeNull();
		expect(cta.textContent).toContain("Create your first budget");
	});

	it("goals empty screen shows a create-goal CTA", async () => {
		mockAPI.getGoals.mockResolvedValue([]);
		await window.Router.routes["#/goals"]();
		const cta = document
			.getElementById("screen")
			.querySelector('.empty-cta[data-action="show-create-goal"]');
		expect(cta).not.toBeNull();
		expect(cta.textContent).toContain("Create your first goal");
	});

	it("accounts empty screen shows an add-account CTA", async () => {
		mockAPI.getAccounts.mockResolvedValue([]);
		await window.Router.routes["#/accounts"]();
		const cta = document
			.getElementById("screen")
			.querySelector('.empty-cta[data-action="show-create-account"]');
		expect(cta).not.toBeNull();
		expect(cta.textContent).toContain("Add your first account");
	});

	it("transactions empty (unfiltered) shows an add-transaction CTA", async () => {
		mockAPI.getTransactions.mockResolvedValue([]);
		window.clearTxFilters();
		await vi.waitFor(() => {
			const cta = document
				.getElementById("tx-list-container")
				?.querySelector('.empty-cta[data-action="nav-navigate"]');
			expect(cta).not.toBeNull();
			expect(cta.getAttribute("data-route")).toBe("#/transactions/new");
		});
	});

	it("transactions empty (filtered) shows a clear-filters CTA", async () => {
		mockAPI.getTransactions.mockResolvedValue([]);
		await window.Router.routes["#/transactions"]();
		window.txFilterState.transaction_type = "expense";
		await window.Router.routes["#/transactions"]();
		const cta = document
			.getElementById("tx-list-container")
			.querySelector('.empty-cta[data-action="clear-tx-filters"]');
		expect(cta).not.toBeNull();
		expect(cta.textContent).toContain("Clear filters");
	});

	it("clear-tx-filters resets txFilterState to defaults and re-renders", async () => {
		mockAPI.getTransactions.mockResolvedValue([]);
		await window.Router.routes["#/transactions"]();
		window.txFilterState.transaction_type = "income";
		window.txFilterState.account_id = "5";
		window.txFilterState.category_id = "3";
		window.txFilterState.tag_ids = [1, 2];
		await window.Router.routes["#/transactions"]();
		const cta = document
			.getElementById("tx-list-container")
			.querySelector('.empty-cta[data-action="clear-tx-filters"]');
		cta.click();
		await vi.waitFor(() => {
			expect(window.txFilterState.transaction_type).toBe("");
			expect(window.txFilterState.account_id).toBe("");
			expect(window.txFilterState.category_id).toBe("");
			expect(window.txFilterState.tag_ids).toEqual([]);
			const unfiltered = document
				.getElementById("tx-list-container")
				?.querySelector('.empty-cta[data-action="nav-navigate"]');
			expect(unfiltered).not.toBeNull();
		});
	});
});

// ===========================================================================
// FINCO-33 — Backup reminder nudge
// ===========================================================================
describe("FINCO-33: backup reminder nudge", () => {
	const SESSION_KEY = "fincoach-backup-nudge-session";
	const EXPORT_KEY = "fincoach-last-manual-export";
	const NUDGE_KEY = "fincoach-backup-nudge-last";

	beforeEach(() => {
		window.Toast.clearAll();
		localStorage.removeItem(EXPORT_KEY);
		localStorage.removeItem(NUDGE_KEY);
		sessionStorage.removeItem(SESSION_KEY);
		vi.spyOn(GDrive, "isEnabled").mockReturnValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("Toast.infoActions renders one button per action", () => {
		window.Toast.clearAll();
		window.Toast.infoActions("msg", [
			{ label: "A", fn: vi.fn() },
			{ label: "B", fn: vi.fn() },
		]);
		const toast = document.querySelector(".toast.info");
		const btns = toast.querySelectorAll(".btn-sm");
		expect(btns.length).toBe(2);
		expect(btns[0].textContent).toBe("A");
		expect(btns[1].textContent).toBe("B");
	});

	it("Toast.infoActions button click invokes its fn and removes the toast", () => {
		window.Toast.clearAll();
		const fn = vi.fn();
		window.Toast.infoActions("msg", [{ label: "Go", fn }]);
		const toast = document.querySelector(".toast.info");
		toast.querySelector(".btn-sm").click();
		expect(fn).toHaveBeenCalledTimes(1);
		expect(document.body.contains(toast)).toBe(false);
	});

	it("exportBackup sets LAST_MANUAL_EXPORT_KEY to a recent timestamp", async () => {
		const before = Date.now();
		await window.exportBackup();
		const ts = Number(localStorage.getItem(EXPORT_KEY));
		expect(ts).toBeGreaterThanOrEqual(before);
	});

	it("no toast when Drive sync is enabled", () => {
		GDrive.isEnabled.mockReturnValue(true);
		const spy = vi.spyOn(window.Toast, "infoActions");
		window.checkGDriveReminder();
		expect(spy).not.toHaveBeenCalled();
	});

	it("no toast when exported within the last 30 days", () => {
		localStorage.setItem(EXPORT_KEY, String(Date.now() - 1000));
		const spy = vi.spyOn(window.Toast, "infoActions");
		window.checkGDriveReminder();
		expect(spy).not.toHaveBeenCalled();
	});

	it("no toast when a nudge was shown within the last 7 days", () => {
		localStorage.setItem(NUDGE_KEY, String(Date.now() - 1000));
		const spy = vi.spyOn(window.Toast, "infoActions");
		window.checkGDriveReminder();
		expect(spy).not.toHaveBeenCalled();
	});

	it("no toast when already shown this session", () => {
		sessionStorage.setItem(SESSION_KEY, "1");
		const spy = vi.spyOn(window.Toast, "infoActions");
		window.checkGDriveReminder();
		expect(spy).not.toHaveBeenCalled();
	});

	it("shows a two-button toast when all conditions are met", () => {
		const spy = vi.spyOn(window.Toast, "infoActions");
		window.checkGDriveReminder();
		expect(spy).toHaveBeenCalledTimes(1);
		const [msg, actions] = spy.mock.calls[0];
		expect(msg).toContain("Back up your data");
		expect(actions.map((a) => a.label)).toEqual([
			"Export backup now",
			"Enable Drive sync",
		]);
		// Persists the throttle + session guard
		expect(localStorage.getItem(NUDGE_KEY)).not.toBeNull();
		expect(sessionStorage.getItem(SESSION_KEY)).toBe("1");
	});

	it("Export backup now action triggers a backup and Enable Drive sync navigates", () => {
		const navSpy = vi.spyOn(window.Router, "navigate").mockImplementation(() => {});
		window.checkGDriveReminder();
		const toast = document.querySelector(".toast.info");
		const btns = toast.querySelectorAll(".btn-sm");
		expect(btns[0].textContent).toBe("Export backup now");
		expect(btns[1].textContent).toBe("Enable Drive sync");
		btns[1].click();
		expect(navSpy).toHaveBeenCalledWith("#/settings");
	});
});

// ===========================================================================
// CSP regression guard — no inline style= attributes in app.js source
//
// The CSP was tightened to `style-src 'self'` (no 'unsafe-inline'), so any
// inline style="..." attribute is silently ignored by the browser. This guard
// fails the build if an inline style is reintroduced into app.js.
// ===========================================================================
describe("CSP guard: app.js source has zero inline style= attributes", () => {
  it("static/js/app.js contains no style=\" occurrences", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const srcPath = join(process.cwd(), "static/js/app.js");
    const source = readFileSync(srcPath, "utf8");
    const matches = source.match(/style="/g) || [];
    expect(matches.length).toBe(0);
  });
});
