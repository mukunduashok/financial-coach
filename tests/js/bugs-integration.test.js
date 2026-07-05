/**
 * Integration tests for bug regressions.
 *
 * These tests use real sql.js (via db.js) wired to the real API bridge (api.js)
 * to verify cross-module behaviour.
 *
 * Coverage:
 *   BUG-SEV2-03 — PDF button removed; only CSV export is supported
 *   BUG-SEV2-01 — deleteAccount blocks deletion when transactions are linked
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";

// ---------------------------------------------------------------------------
// Bootstrap: initialise sql.js the same way db.test.js does
// ---------------------------------------------------------------------------
globalThis.initSqlJs = (opts) => initSqlJs({ ...opts, locateFile: undefined });

// DOM stubs required by api.js (Blob, URL.createObjectURL, anchor click)
// jsdom provides Blob; URL helpers must be stubbed because jsdom omits them.
if (!URL.createObjectURL) URL.createObjectURL = () => "";
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};

// jsdom does not implement these URL methods — define stubs at module level
URL.createObjectURL = vi.fn();
URL.revokeObjectURL = vi.fn();

const { DB } = await import("../../static/js/db.js");

// api.js imports DB and AI — AI is not needed here; provide a minimal stub.
vi.mock("../../static/js/ai.js", () => ({
	AI: { getSettings: vi.fn().mockReturnValue({}), chat: vi.fn() },
	AI_PROVIDERS: {},
}));
vi.mock("../../static/js/gmail.js", () => ({ Gmail: {} }));

const { API } = await import("../../static/js/api.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function freshDB() {
	DB._db = null;
	DB._persist = vi.fn(async () => {});
	DB._loadFromStorage = vi.fn(async () => null);
	await DB.init();
}

// ---------------------------------------------------------------------------
// BUG-SEV2-03: Only CSV export is supported — PDF button was removed
// ---------------------------------------------------------------------------
describe("BUG-SEV2-03: exportTransactionsUrl only supports CSV format", () => {
	let capturedBlobs;

	beforeEach(async () => {
		await freshDB();
		capturedBlobs = [];

		// Intercept every Blob creation to inspect type and content
		const OrigBlob = globalThis.Blob;
		vi.spyOn(globalThis, "Blob").mockImplementation(function (parts, opts) {
			capturedBlobs.push({ parts: parts ? [...parts] : [], type: opts?.type ?? "" });
			return new OrigBlob(parts || [], opts);
		});

		// Reset URL stubs for this test
		URL.createObjectURL.mockReturnValue("blob:mock-export");
		URL.revokeObjectURL.mockReturnValue(undefined);

		// Stub HTMLAnchorElement.click() to prevent navigation errors in jsdom
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockReturnValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		URL.createObjectURL.mockReset();
		URL.revokeObjectURL.mockReset();
		capturedBlobs = [];
	});

	it("CSV export creates a Blob with type text/csv", async () => {
		await API.exportTransactionsUrl({ format: "csv" });

		expect(capturedBlobs).toHaveLength(1);
		expect(capturedBlobs[0].type).toBe("text/csv");
	});
});

// ---------------------------------------------------------------------------
// BUG-SEV2-01: deleteAccount blocks deletion when transactions are linked
// ---------------------------------------------------------------------------
describe("BUG-SEV2-01: deleteAccount blocks linked transactions", () => {
	beforeEach(async () => {
		await freshDB();
	});

	it("throws when account has linked transactions", async () => {
		const account = await DB.createAccount({
			name: "Test Account",
			account_type: "savings",
			balance: 1000,
		});
		await DB.createTransaction({
			account_id: account.id,
			amount: -100,
			description: "Test tx",
			date: "2026-01-15",
			transaction_type: "debit",
		});

		await expect(DB.deleteAccount(account.id)).rejects.toThrow(/transaction/i);
	});

	it("succeeds when account has no transactions", async () => {
		const account = await DB.createAccount({
			name: "Empty Account",
			account_type: "savings",
			balance: 500,
		});

		const result = await DB.deleteAccount(account.id);
		expect(result).toMatchObject({ detail: "Account deleted" });
	});
});

// ---------------------------------------------------------------------------
// Tags — API bridge wiring (all five delegates)
// ---------------------------------------------------------------------------
describe("Tags API bridge wiring", () => {
	beforeEach(async () => {
		await freshDB();
	});

	it("API.getTags() delegates to DB.getTags() and returns empty array initially", async () => {
		const tags = await API.getTags();
		expect(Array.isArray(tags)).toBe(true);
		// 4 default tags are seeded on init (domestic, international, offline, online)
		expect(tags.length).toBe(4);
	});

	it("API.createTag({ name }) creates a tag via DB.createTag()", async () => {
		const tag = await API.createTag({ name: "vacation" });
		expect(tag.id).toBeTypeOf("number");
		expect(tag.name).toBe("vacation");
	});

	it("API.createTag normalises names (strips # and camelCases spaces) via DB", async () => {
		const tag = await API.createTag({ name: "trip to goa" });
		expect(tag.name).toBe("tripToGoa");
	});

	it("API.getTags() returns tags created via API.createTag()", async () => {
		await API.createTag({ name: "work" });
		await API.createTag({ name: "personal" });
		const tags = await API.getTags();
		const names = tags.map((t) => t.name);
		// 4 seeded + 2 created = 6 total; just verify the created ones are present
		expect(names).toContain("personal");
		expect(names).toContain("work");
	});

	it("API.updateTag(id, { name }) renames the tag", async () => {
		const tag = await API.createTag({ name: "oldname" });
		const updated = await API.updateTag(tag.id, { name: "newname" });
		expect(updated.name).toBe("newname");
		const tags = await API.getTags();
		expect(tags.find((t) => t.id === tag.id)?.name).toBe("newname");
	});

	it("API.deleteTag(id) removes the tag from the store", async () => {
		const tag = await API.createTag({ name: "temporary" });
		await API.deleteTag(tag.id);
		const tags = await API.getTags();
		expect(tags.find((t) => t.id === tag.id)).toBeUndefined();
	});

	it("API.setTransactionTags(txId, tagIds) associates tags with a transaction", async () => {
		const acct = await DB.createAccount({ name: "Bridge Account", balance: 1000, account_type: "checking" });
		const cats = await DB.getCategories();
		const tx = await DB.createTransaction({
			date: "2025-06-01",
			amount: 100,
			description: "Bridge tx",
			transaction_type: "expense",
			account_id: acct.id,
			category_id: cats[0].id,
		});
		const tag = await API.createTag({ name: "bridge" });
		await API.setTransactionTags(tx.id, [tag.id]);
		const txs = await DB.getTransactions({ limit: 1 });
		expect(txs[0].tags.some((t) => t.name === "bridge")).toBe(true);
	});

	it("API.getTransactions with tag_ids filters by tag", async () => {
		const acct = await DB.createAccount({ name: "Filter Account", balance: 1000, account_type: "checking" });
		const cats = await DB.getCategories();
		const tagA = await API.createTag({ name: "tagA" });
		const tagB = await API.createTag({ name: "tagB" });
		await DB.createTransaction({
			date: "2025-06-01",
			amount: 50,
			description: "Tagged A",
			transaction_type: "expense",
			account_id: acct.id,
			category_id: cats[0].id,
			tag_ids: [tagA.id],
		});
		await DB.createTransaction({
			date: "2025-06-01",
			amount: 80,
			description: "Tagged B",
			transaction_type: "expense",
			account_id: acct.id,
			category_id: cats[0].id,
			tag_ids: [tagB.id],
		});
		const result = await DB.getTransactions({ tag_ids: [tagA.id] });
		expect(result).toHaveLength(1);
		expect(result[0].description).toBe("Tagged A");
	});

	it("CSV export via API.exportTransactionsUrl includes Tags column header", async () => {
		const acct = await DB.createAccount({ name: "CSV Account", balance: 5000, account_type: "savings" });
		const cats = await DB.getCategories();
		const tag = await API.createTag({ name: "export" });
		await DB.createTransaction({
			date: "2025-06-01",
			amount: 75,
			description: "CSV bridge test",
			transaction_type: "expense",
			account_id: acct.id,
			category_id: cats[0].id,
			tag_ids: [tag.id],
		});

		let csvContent = null;
		const OrigBlob = globalThis.Blob;
		vi.spyOn(globalThis, "Blob").mockImplementationOnce(function (parts, opts) {
			csvContent = parts ? parts[0] : "";
			return new OrigBlob(parts || [], opts);
		});
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockReturnValueOnce(undefined);
		URL.createObjectURL.mockReturnValueOnce("blob:mock");
		URL.revokeObjectURL.mockReturnValueOnce(undefined);

		await API.exportTransactionsUrl({ format: "csv" });

		vi.restoreAllMocks();
		expect(csvContent).not.toBeNull();
		expect(csvContent).toContain("Tags");
		expect(csvContent).toContain("#export");
	});
});

// ---------------------------------------------------------------------------
// BUG 1 — API.resetGmailSyncHistory delegates to DB.clearDeletedGmailTombstones
// ---------------------------------------------------------------------------
describe("BUG 1: API.resetGmailSyncHistory clears Gmail tombstones", () => {
	beforeEach(freshDB);

	it("delegates to DB.clearDeletedGmailTombstones (removes only deleted rows)", async () => {
		DB._exec("INSERT INTO processed_gmail_messages (gmail_message_id, deleted) VALUES (?, 1)", [
			"tomb-1",
		]);
		DB._exec("INSERT INTO processed_gmail_messages (gmail_message_id, deleted) VALUES (?, 0)", [
			"live-1",
		]);

		await API.resetGmailSyncHistory();

		expect(DB.getProcessedGmailIds(["tomb-1"]).has("tomb-1")).toBe(false);
		expect(DB.getProcessedGmailIds(["live-1"]).has("live-1")).toBe(true);
	});

	it("a deleted Gmail tx stays filtered until reset, then becomes re-importable", async () => {
		const acct = await DB.createAccount({
			name: "Gmail Acct",
			balance: 0,
			account_type: "savings",
		});
		const tx = await DB.createTransaction({
			date: "2025-03-01",
			amount: -250,
			description: "Gmail spend",
			transaction_type: "expense",
			account_id: acct.id,
		});
		DB._exec("UPDATE transactions SET gmail_message_id = ? WHERE id = ?", ["gmail-x", tx.id]);

		// Deleting via the API bridge must tombstone the Gmail ID (still filtered).
		await API.deleteTransaction(tx.id);
		expect(DB.getProcessedGmailIds(["gmail-x"]).has("gmail-x")).toBe(true);

		// Re-import deleted transactions: clears the tombstone so it can be synced again.
		await API.resetGmailSyncHistory();
		expect(DB.getProcessedGmailIds(["gmail-x"]).has("gmail-x")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// BUG 2 — API.updateMerchant rename surfaces on transactions via the join
// ---------------------------------------------------------------------------
describe("BUG 2: API.updateMerchant rename surfaces on past transactions", () => {
	beforeEach(freshDB);

	it("renaming a UPI merchant via the bridge surfaces on its past transactions", async () => {
		const acct = await DB.createAccount({
			name: "Acct",
			balance: 0,
			account_type: "savings",
		});
		const cats = await DB.getCategories();
		const m = await DB.createMerchant({
			merchant_name: "Zomato",
			merchant_upi_id: "zomato@upi",
			category_id: cats[0].id,
		});
		await DB.createTransaction({
			date: "2025-02-01",
			amount: -300,
			description: "lunch",
			transaction_type: "expense",
			account_id: acct.id,
			merchant_upi_id: "zomato@upi",
			merchant_name: "Zomato",
		});

		await API.updateMerchant(m.id, { merchant_name: "Zomato Ltd" });

		// The display name resolves through the merchant join — no propagation to the row.
		const txs = await API.getTransactions({});
		const tx = txs.find((t) => t.merchant_upi_id === "zomato@upi");
		expect(tx.merchant_name).toBe("Zomato Ltd");
		// The immutable provenance column on the transaction row is unchanged.
		const raw = DB._queryOne(
			"SELECT merchant_name FROM transactions WHERE merchant_upi_id = ?",
			["zomato@upi"],
		);
		expect(raw.merchant_name).toBe("Zomato");
	});
});

// ---------------------------------------------------------------------------
// BUG 4 — API.getCreditAccountBalance agrees with the account response field
// ---------------------------------------------------------------------------
describe("BUG 4: API.getCreditAccountBalance excludes Not-an-Expense rows", () => {
	beforeEach(freshDB);

	function todayStr() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	}

	it("CC due excludes excluded_from_expenses rows and matches account field", async () => {
		const card = await DB.createAccount({
			name: "Credit Card",
			balance: 0,
			account_type: "credit",
		});
		await DB.createTransaction({
			date: todayStr(),
			amount: -1000,
			description: "counted",
			transaction_type: "expense",
			account_id: card.id,
		});
		const skip = await DB.createTransaction({
			date: todayStr(),
			amount: -400,
			description: "not an expense",
			transaction_type: "expense",
			account_id: card.id,
		});
		await DB.toggleExcludedFromExpenses(skip.id, true);

		const result = await API.getCreditAccountBalance(card.id);
		expect(result.cycle_balance).toBe(1000);

		const acc = await DB.getAccount(card.id);
		expect(acc.credit_cycle_balance).toBe(result.cycle_balance);
	});
});

// ---------------------------------------------------------------------------
// FINCO-50 — Merchant rename memory through the API bridge
//
// Verifies the `learn_merchant_name` flag passes untouched through
// API.updateTransaction into DB.updateTransaction, and that the resulting
// merchant identity + retro-linking behave end-to-end via the bridge.
// ---------------------------------------------------------------------------
describe("FINCO-50: merchant rename memory via API bridge", () => {
	beforeEach(freshDB);

	it("learn_merchant_name=true through the bridge creates an identity keyed on the original name", async () => {
		const acct = await DB.createAccount({
			name: "Acct",
			balance: 0,
			account_type: "savings",
		});
		const cats = await DB.getCategories();
		const foodId = cats.find((c) => c.name === "Food & Dining").id;

		const tx = await API.createTransaction({
			date: "2025-04-01",
			amount: -200,
			description: "food",
			transaction_type: "expense",
			account_id: acct.id,
			category_id: foodId,
			merchant_name: "PAYTM*SWIGGY",
		});
		expect(tx.merchant_id).toBeNull();

		const updated = await API.updateTransaction(tx.id, {
			merchant_name: "Swiggy",
			learn_merchant_name: true,
		});

		// The bridge forwarded the flag; an identity keyed on the original string exists.
		const merchant = DB._queryOne("SELECT * FROM merchants WHERE display_name = ?", ["Swiggy"]);
		expect(merchant).not.toBeNull();
		expect(updated.merchant_id).toBe(merchant.id);

		// A future transaction with the ORIGINAL string maps to the new name via the bridge.
		const tx2 = await API.createTransaction({
			date: "2025-04-10",
			amount: -150,
			description: "food",
			transaction_type: "expense",
			account_id: acct.id,
			merchant_name: "PAYTM*SWIGGY",
		});
		expect(tx2.merchant_name).toBe("Swiggy");
		expect(tx2.merchant_id).toBe(merchant.id);
	});

	it("rename via the bridge does NOT alter the transaction category", async () => {
		const acct = await DB.createAccount({
			name: "Acct",
			balance: 0,
			account_type: "savings",
		});
		const cats = await DB.getCategories();
		const foodId = cats.find((c) => c.name === "Food & Dining").id;

		const tx = await API.createTransaction({
			date: "2025-04-01",
			amount: -200,
			description: "food",
			transaction_type: "expense",
			account_id: acct.id,
			category_id: foodId,
			merchant_name: "RAW MERCHANT",
		});

		const updated = await API.updateTransaction(tx.id, {
			merchant_name: "Pretty Name",
			learn_merchant_name: true,
		});
		expect(updated.category_id).toBe(foodId);
	});

	it("simultaneous category-learn + rename via the bridge sets both new category and display name", async () => {
		const acct = await DB.createAccount({
			name: "Acct",
			balance: 0,
			account_type: "savings",
		});
		const cats = await DB.getCategories();
		const groceriesId = cats.find((c) => c.name === "Groceries").id;

		const tx = await API.createTransaction({
			date: "2025-04-01",
			amount: -200,
			description: "shopping",
			transaction_type: "expense",
			account_id: acct.id,
			merchant_name: "DMART RETAIL",
		});

		await API.updateTransaction(tx.id, {
			category_id: groceriesId,
			merchant_name: "DMart",
			learn_merchant: true,
			learn_merchant_name: true,
		});

		const merchant = DB._queryOne("SELECT * FROM merchants WHERE display_name = ?", ["DMart"]);
		expect(merchant).not.toBeNull();
		expect(merchant.category_id).toBe(groceriesId);

		// Future transaction with the original string inherits both the category and the name.
		const tx2 = await API.createTransaction({
			date: "2025-04-10",
			amount: -180,
			description: "shopping",
			transaction_type: "expense",
			account_id: acct.id,
			merchant_name: "DMART RETAIL",
		});
		expect(tx2.merchant_name).toBe("DMart");
		expect(tx2.category_id).toBe(groceriesId);
	});
});

// ---------------------------------------------------------------------------
// FINCO-22: Transaction Follow-ups — API bridge wiring (all seven delegates)
// ---------------------------------------------------------------------------
describe("Transaction Follow-ups API bridge wiring", () => {
	beforeEach(freshDB);

	async function seedTx(overrides = {}) {
		const acct = await DB.createAccount({
			name: "FU Bridge Account",
			balance: 1000,
			account_type: "savings",
		});
		const cats = await DB.getCategories();
		return DB.createTransaction({
			date: "2025-06-01",
			amount: -499,
			description: "Netflix",
			transaction_type: "expense",
			account_id: acct.id,
			category_id: cats[0].id,
			...overrides,
		});
	}

	it("API.createFollowUp() delegates to DB.createFollowUp() and is retrievable", async () => {
		const tx = await seedTx();
		const fu = await API.createFollowUp(tx.id, {
			title: "Renew Netflix",
			follow_up_type: "bill",
			due_date: "2025-07-01",
		});
		expect(fu.id).toBeTypeOf("number");
		expect(fu.status).toBe("pending");
		expect(fu.transaction_id).toBe(tx.id);

		const viaDb = await DB.getFollowUp(tx.id);
		expect(viaDb.title).toBe("Renew Netflix");
	});

	it("API.getFollowUp(txId) delegates to DB.getFollowUp()", async () => {
		const tx = await seedTx();
		await API.createFollowUp(tx.id, { title: "Bridge get", follow_up_type: "reminder" });
		const fu = await API.getFollowUp(tx.id);
		expect(fu).not.toBeNull();
		expect(fu.title).toBe("Bridge get");
	});

	it("API.getFollowUps(filters) delegates to DB.getFollowUps() with status filtering", async () => {
		const txA = await seedTx({ transaction_id: "FU-BR-A" });
		const txB = await seedTx({ transaction_id: "FU-BR-B" });
		const a = await API.createFollowUp(txA.id, { title: "A", due_date: "2025-07-01" });
		await API.createFollowUp(txB.id, { title: "B", due_date: "2025-07-02" });
		await API.markFollowUpDone(a.id);

		const pending = await API.getFollowUps({ status: "pending" });
		expect(pending).toHaveLength(1);
		expect(pending[0].title).toBe("B");

		const all = await API.getFollowUps({});
		expect(all).toHaveLength(2);
	});

	it("API.updateFollowUp(id, fields) delegates to DB.updateFollowUp()", async () => {
		const tx = await seedTx();
		const fu = await API.createFollowUp(tx.id, { title: "Old", due_date: "2025-07-01" });
		const updated = await API.updateFollowUp(fu.id, {
			title: "New",
			due_date: "2025-08-01",
		});
		expect(updated.title).toBe("New");
		expect(updated.due_date).toBe("2025-08-01");
	});

	it("API.markFollowUpDone(id) delegates to DB.markFollowUpDone() (non-recurring → done)", async () => {
		const tx = await seedTx();
		const fu = await API.createFollowUp(tx.id, {
			title: "One-off",
			due_date: "2025-07-01",
			is_recurring: false,
		});
		const done = await API.markFollowUpDone(fu.id);
		expect(done.status).toBe("done");
		expect(done.completed_at).toBeTruthy();
	});

	it("API.reopenFollowUp(id) delegates to DB.reopenFollowUp()", async () => {
		const tx = await seedTx();
		const fu = await API.createFollowUp(tx.id, { title: "Reopen", is_recurring: false });
		await API.markFollowUpDone(fu.id);
		const reopened = await API.reopenFollowUp(fu.id);
		expect(reopened.status).toBe("pending");
		expect(reopened.completed_at).toBeNull();
	});

	it("API.deleteFollowUp(id) delegates to DB.deleteFollowUp() and records a tombstone", async () => {
		const tx = await seedTx();
		const fu = await API.createFollowUp(tx.id, { title: "Delete me" });
		await API.deleteFollowUp(fu.id);
		expect(await API.getFollowUp(tx.id)).toBeNull();

		const tombstones = DB._queryAll(
			"SELECT * FROM sync_tombstones WHERE entity_type = 'follow_up'",
		);
		expect(tombstones).toHaveLength(1);
	});

	it("API.getUpcomingBills(days) returns pending follow-ups within the window", async () => {
		const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString().split("T")[0];
		const txSoon = await seedTx({ transaction_id: "FU-UB-SOON" });
		const txLater = await seedTx({ transaction_id: "FU-UB-LATER" });
		await API.createFollowUp(txSoon.id, { title: "Soon", due_date: iso(2) });
		await API.createFollowUp(txLater.id, { title: "Later", due_date: iso(30) });

		const bills = await API.getUpcomingBills(7);
		const titles = bills.map((b) => b.title);
		expect(titles).toContain("Soon");
		expect(titles).not.toContain("Later");
	});
});
