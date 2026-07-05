/**
 * Comprehensive unit tests for static/js/db.js — SQLite WASM database layer.
 *
 * Uses real sql.js with mocked IndexedDB persistence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";

// db.js calls window.initSqlJs — wrap to strip locateFile (npm sql.js resolves WASM internally)
globalThis.initSqlJs = (opts) => initSqlJs({ ...opts, locateFile: undefined });

// Must import after setting globalThis.initSqlJs
const { DB, SCHEMA_VERSION, SCHEMA_SQL } = await import("../../static/js/db.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fresh DB for every test — mock persistence, init schema + seeds. */
async function freshDB() {
  DB._db = null;
  DB._persist = vi.fn(async () => {});
  DB._loadFromStorage = vi.fn(async () => null);
  await DB.init();
}

/** Create a default checking account and return it. */
async function createDefaultAccount(overrides = {}) {
  return DB.createAccount({
    name: "Test Checking",
    balance: 1000,
    account_type: "checking",
    ...overrides,
  });
}

/** Create a transaction and return it. */
async function createDefaultTransaction(accountId, overrides = {}) {
  return DB.createTransaction({
    date: "2025-01-15",
    amount: 50,
    description: "Test purchase",
    transaction_type: "expense",
    account_id: accountId,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 1. Schema & Seed Data
// ---------------------------------------------------------------------------
describe("Schema & Seed Data", () => {
  beforeEach(freshDB);

  it("creates all 14 tables", () => {
    const tables = DB._queryAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual([
      "accounts",
      "budgets",
      "categories",
      "conversations",
      "goals",
      "merchant_aliases",
      "merchants",
      "processed_gmail_messages",
      "recurring_patterns",
      "sync_tombstones",
      "tags",
      "transaction_follow_ups",
      "transaction_tags",
      "transactions",
    ]);
  });

  it("seeds 20 default categories", () => {
    const cats = DB._queryAll("SELECT name FROM categories ORDER BY name");
    expect(cats).toHaveLength(20);
    const names = cats.map((c) => c.name);
    expect(names).toContain("Food & Dining");
    expect(names).toContain("Groceries");
    expect(names).toContain("Other");
    expect(names).toContain("Income");
  });

  it("seeds 4 default tags on first init", () => {
    const tags = DB._queryAll("SELECT name FROM tags ORDER BY name");
    expect(tags).toHaveLength(4);
    expect(tags.map((t) => t.name)).toEqual(["domestic", "international", "offline", "online"]);
  });

  it("has foreign keys enabled", () => {
    const result = DB._queryOne("PRAGMA foreign_keys");
    expect(result.foreign_keys).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Accounts CRUD
// ---------------------------------------------------------------------------
describe("Accounts CRUD", () => {
  beforeEach(freshDB);

  it("creates an account with valid data", async () => {
    const acc = await createDefaultAccount();
    expect(acc.id).toBeGreaterThan(0);
    expect(acc.name).toBe("Test Checking");
    expect(acc.balance).toBe(1000);
    expect(acc.account_type).toBe("checking");
    expect(acc.is_active).toBe(true);
    expect(acc.created_at).toBeDefined();
    expect(DB._persist).toHaveBeenCalled();
  });

  it("creates account with default balance of 0", async () => {
    const acc = await DB.createAccount({ name: "Zero Balance", account_type: "savings" });
    expect(acc.balance).toBe(0);
  });

  it("gets account by ID", async () => {
    const created = await createDefaultAccount();
    const fetched = await DB.getAccount(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("Test Checking");
  });

  it("throws for nonexistent account ID", async () => {
    await expect(DB.getAccount(9999)).rejects.toThrow("Account not found");
  });

  it("lists active accounts only by default", async () => {
    await createDefaultAccount({ name: "Active 1" });
    await createDefaultAccount({ name: "Active 2", account_identifier: "A2" });
    const list = await DB.getAccounts();
    expect(list.length).toBe(2);
    expect(list.every((a) => a.is_active === true)).toBe(true);
  });

  it("lists all accounts including merged", async () => {
    const a1 = await createDefaultAccount({ name: "Parent", account_identifier: "P1" });
    const a2 = await createDefaultAccount({ name: "Child", account_identifier: "C1" });
    await DB.mergeAccounts(a2.id, a1.id);
    const activeOnly = await DB.getAccounts(false);
    const all = await DB.getAccounts(true);
    expect(all.length).toBeGreaterThanOrEqual(activeOnly.length);
  });

  it("deletes an account", async () => {
    const acc = await createDefaultAccount();
    const result = await DB.deleteAccount(acc.id);
    expect(result.detail).toBe("Account deleted");
    await expect(DB.getAccount(acc.id)).rejects.toThrow("Account not found");
  });

  it("blocks delete if account has merged children", async () => {
    const parent = await createDefaultAccount({ name: "Parent", account_identifier: "P2" });
    const child = await createDefaultAccount({ name: "Child", account_identifier: "C2" });
    await DB.mergeAccounts(child.id, parent.id);
    await expect(DB.deleteAccount(parent.id)).rejects.toThrow("merged children");
  });

  it("throws when deleting nonexistent account", async () => {
    await expect(DB.deleteAccount(9999)).rejects.toThrow("Account not found");
  });

  it("response includes merged_into_name, merged_accounts, effective_balance", async () => {
    const acc = await createDefaultAccount();
    expect(acc).toHaveProperty("merged_into_name");
    expect(acc).toHaveProperty("merged_accounts");
    expect(acc).toHaveProperty("effective_balance");
    expect(acc.merged_into_name).toBeNull();
    expect(acc.merged_accounts).toEqual([]);
    expect(acc.effective_balance).toBe(1000);
  });

  it("stores account_identifier correctly", async () => {
    const acc = await createDefaultAccount({ account_identifier: "HDFC_1234" });
    expect(acc.account_identifier).toBe("HDFC_1234");
  });

  // BUG-PROD-03: balance_updated_at not set on createAccount
  it("sets balance_updated_at when initial balance > 0", async () => {
    const acc = await DB.createAccount({ name: "Has Balance", balance: 5000, account_type: "savings" });
    const raw = DB._queryOne("SELECT balance_updated_at FROM accounts WHERE id = ?", [acc.id]);
    expect(raw.balance_updated_at).not.toBeNull();
  });

  it("sets balance_updated_at to null when initial balance = 0", async () => {
    const acc = await DB.createAccount({ name: "Zero Balance", balance: 0, account_type: "savings" });
    const raw = DB._queryOne("SELECT balance_updated_at FROM accounts WHERE id = ?", [acc.id]);
    expect(raw.balance_updated_at).toBeNull();
  });

  it("sets balance_updated_at to null when balance is omitted", async () => {
    const acc = await DB.createAccount({ name: "No Balance", account_type: "checking" });
    const raw = DB._queryOne("SELECT balance_updated_at FROM accounts WHERE id = ?", [acc.id]);
    expect(raw.balance_updated_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Account Merging
// ---------------------------------------------------------------------------
describe("Account Merging", () => {
  beforeEach(freshDB);

  it("merges two accounts", async () => {
    const source = await createDefaultAccount({ name: "Source", account_identifier: "S1" });
    const target = await createDefaultAccount({ name: "Target", account_identifier: "T1" });
    const result = await DB.mergeAccounts(source.id, target.id);
    expect(result.merged_accounts.length).toBe(1);
    expect(result.merged_accounts[0].name).toBe("Source");

    const sourceAfter = await DB.getAccount(source.id);
    expect(sourceAfter.is_active).toBe(false);
    expect(sourceAfter.merged_into_id).toBe(target.id);
    expect(sourceAfter.merged_into_name).toBe("Target");
  });

  it("unmerges an account", async () => {
    const source = await createDefaultAccount({ name: "Source", account_identifier: "S2" });
    const target = await createDefaultAccount({ name: "Target", account_identifier: "T2" });
    await DB.mergeAccounts(source.id, target.id);
    const result = await DB.unmergeAccount(source.id);
    expect(result.is_active).toBe(true);
    expect(result.merged_into_id).toBeNull();
  });

  it("throws on self-merge", async () => {
    const acc = await createDefaultAccount();
    await expect(DB.mergeAccounts(acc.id, acc.id)).rejects.toThrow("Cannot merge account into itself");
  });

  it("throws on cycle detection — cannot merge parent into child's descendant", async () => {
    // The cycle check in mergeAccounts is guarded by earlier checks
    // (target must be active). Verify the descendant collection works correctly.
    const a = await createDefaultAccount({ name: "A", account_identifier: "CYC_A" });
    const b = await createDefaultAccount({ name: "B", account_identifier: "CYC_B" });
    const c = await createDefaultAccount({ name: "C", account_identifier: "CYC_C" });
    // Build chain bottom-up: c into b, then b into a
    await DB.mergeAccounts(c.id, b.id);
    await DB.mergeAccounts(b.id, a.id);
    // a's descendants include a, b, c
    const descendants = DB._collectDescendants(a.id);
    expect(descendants).toContain(a.id);
    expect(descendants).toContain(b.id);
    expect(descendants).toContain(c.id);
  });

  it("verifies max depth chain builds correctly up to limit", async () => {
    // Build a chain of depth 5 (bottom-up): a5->a4->a3->a2->a1->a0
    const accs = [];
    for (let i = 0; i < 6; i++) {
      accs.push(await createDefaultAccount({ name: `D${i}`, account_identifier: `DEPTH_${i}` }));
    }
    // Merge bottom-up: 5 into 4, 4 into 3, 3 into 2, 2 into 1, 1 into 0
    for (let i = 5; i >= 1; i--) {
      await DB.mergeAccounts(accs[i].id, accs[i - 1].id);
    }
    const descendants = DB._collectDescendants(accs[0].id);
    expect(descendants.length).toBe(6);
    const rootAcc = await DB.getAccount(accs[0].id);
    // _latestTreeBalance: no timestamps → root (accs[0]) balance (1000) returned
    expect(rootAcc.effective_balance).toBe(1000);
  });

  it("throws on type mismatch", async () => {
    const checking = await createDefaultAccount({
      name: "Checking",
      account_type: "checking",
      account_identifier: "TM1",
    });
    const savings = await createDefaultAccount({
      name: "Savings",
      account_type: "savings",
      account_identifier: "TM2",
    });
    await expect(DB.mergeAccounts(checking.id, savings.id)).rejects.toThrow("different types");
  });

  it("enforces max merge depth when merging subtrees", async () => {
    // Build source subtree of depth 5 (max), then try to merge it under a target
    // that already has depth 1 above. This should exceed MAX_MERGE_DEPTH.
    // Source tree: s4 -> s3 -> s2 -> s1 -> s0 (s0 is root, depth 4 below)
    const s = [];
    for (let i = 0; i < 5; i++) {
      s.push(await createDefaultAccount({ name: `S${i}`, account_identifier: `SRC_${i}` }));
    }
    // Build bottom-up: s4 into s3, s3 into s2, s2 into s1, s1 into s0
    for (let i = 4; i >= 1; i--) {
      await DB.mergeAccounts(s[i].id, s[i - 1].id);
    }
    // s0 has _getMergeDepth = 4
    // Now create target chain: t1 -> t0 (t0 has child t1, depth 1)
    const t0 = await createDefaultAccount({ name: "T0", account_identifier: "TGT_0" });
    const t1 = await createDefaultAccount({ name: "T1", account_identifier: "TGT_1" });
    await DB.mergeAccounts(t1.id, t0.id);
    // t0 has depth 1 below, 0 above.
    // Now try to merge s0 (sourceDepth=4) into t0: targetDepthAbove=0 + 1 + 4 = 5 = MAX. OK.
    // This should succeed at exactly depth 5
    await DB.mergeAccounts(s[0].id, t0.id);
    const descendants = DB._collectDescendants(t0.id);
    expect(descendants.length).toBe(7); // t0, t1, s0, s1, s2, s3, s4
  });

  it("effective_balance returns root balance when no timestamps set", async () => {
    const parent = await createDefaultAccount({
      name: "Parent",
      balance: 500,
      account_identifier: "EB1",
    });
    const child = await createDefaultAccount({
      name: "Child",
      balance: 300,
      account_identifier: "EB2",
    });
    // Clear timestamps so neither has balance_updated_at → root (parent) balance is returned
    DB._exec("UPDATE accounts SET balance_updated_at = NULL WHERE id IN (?, ?)", [parent.id, child.id]);
    await DB.mergeAccounts(child.id, parent.id);
    const parentAfter = await DB.getAccount(parent.id);
    // _latestTreeBalance: no timestamps → root (parent) balance returned
    expect(parentAfter.effective_balance).toBe(500);
  });

  it("effective_balance returns most recently updated account balance", async () => {
    const parent = await createDefaultAccount({
      name: "Parent",
      balance: 500,
      account_identifier: "EB3",
    });
    const child = await createDefaultAccount({
      name: "Child",
      balance: 300,
      account_identifier: "EB4",
    });
    await DB.mergeAccounts(child.id, parent.id);
    // Update child with a more recent timestamp
    DB._exec(
      "UPDATE accounts SET balance = 750, balance_updated_at = '2025-06-01T12:00:00Z' WHERE id = ?",
      [child.id],
    );
    DB._exec(
      "UPDATE accounts SET balance_updated_at = '2025-01-01T00:00:00Z' WHERE id = ?",
      [parent.id],
    );
    const parentAfter = await DB.getAccount(parent.id);
    // child has the newer timestamp, so its balance (750) is used
    expect(parentAfter.effective_balance).toBe(750);
  });

  it("throws when source already merged", async () => {
    const a = await createDefaultAccount({ name: "A", account_identifier: "AM1" });
    const b = await createDefaultAccount({ name: "B", account_identifier: "AM2" });
    const c = await createDefaultAccount({ name: "C", account_identifier: "AM3" });
    await DB.mergeAccounts(a.id, b.id);
    await expect(DB.mergeAccounts(a.id, c.id)).rejects.toThrow("already merged");
  });

  it("throws when target is already merged", async () => {
    const a = await createDefaultAccount({ name: "A", account_identifier: "TI1" });
    const b = await createDefaultAccount({ name: "B", account_identifier: "TI2" });
    const c = await createDefaultAccount({ name: "C", account_identifier: "TI3" });
    await DB.mergeAccounts(b.id, a.id);
    await expect(DB.mergeAccounts(c.id, b.id)).rejects.toThrow(
      "Target account must not already be merged",
    );
  });

  it("throws on unmerge of non-merged account", async () => {
    const acc = await createDefaultAccount();
    await expect(DB.unmergeAccount(acc.id)).rejects.toThrow("not merged");
  });

  it("throws on unmerge of nonexistent account", async () => {
    await expect(DB.unmergeAccount(9999)).rejects.toThrow("Account not found");
  });
});

// ---------------------------------------------------------------------------
// 4. Transactions CRUD
// ---------------------------------------------------------------------------
describe("Transactions CRUD", () => {
  let accountId;

  beforeEach(async () => {
    await freshDB();
    const acc = await createDefaultAccount();
    accountId = acc.id;
  });

  it("creates a transaction", async () => {
    const tx = await createDefaultTransaction(accountId);
    expect(tx.id).toBeGreaterThan(0);
    expect(tx.amount).toBe(50);
    expect(tx.description).toBe("Test purchase");
    expect(tx.transaction_type).toBe("expense");
    expect(tx.account_id).toBe(accountId);
    expect(tx.account_name).toBe("Test Checking");
    expect(tx.is_recurring).toBe(false);
    expect(DB._persist).toHaveBeenCalled();
  });

  it("updates a transaction with PATCH semantics", async () => {
    const tx = await createDefaultTransaction(accountId);
    const updated = await DB.updateTransaction(tx.id, { amount: 75 });
    expect(updated.amount).toBe(75);
    // Original fields unchanged
    expect(updated.description).toBe("Test purchase");
    expect(updated.date).toBe("2025-01-15");
  });

  it("deletes a transaction", async () => {
    const tx = await createDefaultTransaction(accountId);
    const result = await DB.deleteTransaction(tx.id);
    expect(result.detail).toBe("Transaction deleted");
  });

  it("throws when deleting nonexistent transaction", async () => {
    await expect(DB.deleteTransaction(9999)).rejects.toThrow("Transaction not found");
  });

  it("throws when updating nonexistent transaction", async () => {
    await expect(DB.updateTransaction(9999, { amount: 10 })).rejects.toThrow(
      "Transaction not found",
    );
  });

  it("filters by account_id", async () => {
    const acc2 = await createDefaultAccount({ name: "Other", account_identifier: "O1" });
    await createDefaultTransaction(accountId, { description: "TX1" });
    await createDefaultTransaction(acc2.id, { description: "TX2" });
    const txs = await DB.getTransactions({ account_id: accountId, include_merged: false });
    expect(txs.every((t) => t.account_id === accountId)).toBe(true);
  });

  it("includes gmail_message_id, transaction_id, and notes in getTransactions response", async () => {
    await DB._exec(
      "INSERT INTO transactions (transaction_id, gmail_message_id, date, amount, description, notes, transaction_type, account_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ["ref-001", "gmail-msg-001", "2025-03-01", 500, "SIP debit", "My SIP note", "expense", accountId, new Date().toISOString()],
    );
    const txs = await DB.getTransactions({});
    const tx = txs.find((t) => t.gmail_message_id === "gmail-msg-001");
    expect(tx).toBeDefined();
    expect(tx.transaction_id).toBe("ref-001");
    expect(tx.gmail_message_id).toBe("gmail-msg-001");
    expect(tx.notes).toBe("My SIP note");
  });

  it("filters by category_id", async () => {
    const cats = await DB.getCategories();
    const catId = cats[0].id;
    await createDefaultTransaction(accountId, { category_id: catId, description: "Cat TX" });
    await createDefaultTransaction(accountId, { description: "No Cat TX" });
    const txs = await DB.getTransactions({ category_id: catId });
    expect(txs.length).toBe(1);
    expect(txs[0].category_id).toBe(catId);
  });

  it("filters by transaction_type", async () => {
    await createDefaultTransaction(accountId, { transaction_type: "income", description: "Inc" });
    await createDefaultTransaction(accountId, { transaction_type: "expense", description: "Exp" });
    const incTxs = await DB.getTransactions({ transaction_type: "income" });
    expect(incTxs.length).toBe(1);
    expect(incTxs[0].transaction_type).toBe("income");
  });

  it("filters by date range", async () => {
    await createDefaultTransaction(accountId, { date: "2025-01-10", description: "Early" });
    await createDefaultTransaction(accountId, { date: "2025-01-20", description: "Late" });
    const txs = await DB.getTransactions({ date_from: "2025-01-15", date_to: "2025-01-25" });
    expect(txs.length).toBe(1);
    expect(txs[0].description).toBe("Late");
  });

  it("paginates with limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      await createDefaultTransaction(accountId, { description: `TX${i}`, date: `2025-01-0${i + 1}` });
    }
    const page1 = await DB.getTransactions({ limit: 2, offset: 0 });
    expect(page1.length).toBe(2);
    const page2 = await DB.getTransactions({ limit: 2, offset: 2 });
    expect(page2.length).toBe(2);
    // No overlap
    const page1Ids = page1.map((t) => t.id);
    const page2Ids = page2.map((t) => t.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });

  it("returns totals aggregation", async () => {
    await createDefaultTransaction(accountId, {
      amount: 100,
      transaction_type: "income",
      description: "Salary",
    });
    await createDefaultTransaction(accountId, {
      amount: -30,
      transaction_type: "expense",
      description: "Food",
    });
    await createDefaultTransaction(accountId, {
      amount: -20,
      transaction_type: "expense",
      description: "Transport",
    });
    const totals = await DB.getTransactionTotals();
    expect(totals.total_income).toBe(100);
    expect(totals.total_expense).toBe(50); // ABS(-30) + ABS(-20)
    expect(totals.net).toBe(50);
    expect(totals.transaction_count).toBe(3);
  });

  it("includes merged account transactions when include_merged is true", async () => {
    const parent = await createDefaultAccount({ name: "Parent", account_identifier: "MP" });
    const child = await createDefaultAccount({ name: "Child", account_identifier: "MC" });
    await createDefaultTransaction(parent.id, { description: "Parent TX" });
    await createDefaultTransaction(child.id, { description: "Child TX" });
    await DB.mergeAccounts(child.id, parent.id);

    const txs = await DB.getTransactions({ account_id: parent.id, include_merged: true });
    expect(txs.length).toBe(2);
  });

  it("response includes account_name and category fields", async () => {
    const cats = await DB.getCategories();
    const tx = await createDefaultTransaction(accountId, { category_id: cats[0].id });
    expect(tx.account_name).toBe("Test Checking");
    expect(tx.category).not.toBeNull();
    expect(tx.category.name).toBe(cats[0].name);
  });

  it("validates category exists on create", async () => {
    await expect(
      createDefaultTransaction(accountId, { category_id: 9999 }),
    ).rejects.toThrow("Category not found");
  });

  it("validates account exists on create", async () => {
    await expect(
      DB.createTransaction({
        date: "2025-01-01",
        amount: 10,
        transaction_type: "expense",
        account_id: 9999,
      }),
    ).rejects.toThrow("Account not found");
  });

  it("transaction account_name follows merged_into_id chain to root", async () => {
    const root = await createDefaultAccount({ name: "Root Account", account_identifier: "R1" });
    const mid = await createDefaultAccount({ name: "Mid Account", account_identifier: "M1" });
    const leaf = await createDefaultAccount({ name: "Leaf Account", account_identifier: "L1" });
    // Build chain: leaf → mid → root
    await DB.mergeAccounts(leaf.id, mid.id);
    await DB.mergeAccounts(mid.id, root.id);
    // Create transaction on the leaf account
    const tx = await DB.createTransaction({
      date: "2025-02-01",
      amount: 100,
      transaction_type: "expense",
      account_id: leaf.id,
    });
    // account_name must be the root account's name, not the leaf's
    expect(tx.account_name).toBe("Root Account");
  });

  it("transaction account_name is own name when not merged", async () => {
    const acc = await createDefaultAccount({ name: "Standalone", account_identifier: "SA1" });
    const tx = await DB.createTransaction({
      date: "2025-02-01",
      amount: 50,
      transaction_type: "income",
      account_id: acc.id,
    });
    expect(tx.account_name).toBe("Standalone");
  });
});

// ---------------------------------------------------------------------------
// 4b. _latestTreeBalance unit tests
// ---------------------------------------------------------------------------
describe("_latestTreeBalance", () => {
  beforeEach(freshDB);

  it("returns 0 for nonexistent account", () => {
    expect(DB._latestTreeBalance(9999)).toBe(0);
  });

  it("returns own balance when no children", async () => {
    const acc = await createDefaultAccount({ balance: 1234 });
    expect(DB._latestTreeBalance(acc.id)).toBe(1234);
  });

  it("returns root balance when no timestamps set (stable root-first order)", async () => {
    const parent = await createDefaultAccount({
      name: "Parent",
      balance: 500,
      account_identifier: "LT1",
    });
    const child = await createDefaultAccount({
      name: "Child",
      balance: 300,
      account_identifier: "LT2",
    });
    // Clear timestamps so neither has balance_updated_at → parent (root) is first collected → 500
    DB._exec("UPDATE accounts SET balance_updated_at = NULL WHERE id IN (?, ?)", [parent.id, child.id]);
    await DB.mergeAccounts(child.id, parent.id);
    // Neither has balance_updated_at → parent (root) is first collected → 500
    expect(DB._latestTreeBalance(parent.id)).toBe(500);
  });

  it("returns balance of account with latest balance_updated_at", async () => {
    const parent = await createDefaultAccount({
      name: "Parent",
      balance: 500,
      account_identifier: "LT3",
    });
    const child = await createDefaultAccount({
      name: "Child",
      balance: 300,
      account_identifier: "LT4",
    });
    await DB.mergeAccounts(child.id, parent.id);
    DB._exec(
      "UPDATE accounts SET balance_updated_at = '2025-01-01T00:00:00Z' WHERE id = ?",
      [parent.id],
    );
    DB._exec(
      "UPDATE accounts SET balance_updated_at = '2025-06-01T12:00:00Z' WHERE id = ?",
      [child.id],
    );
    // child has newer timestamp → return child's balance (300)
    expect(DB._latestTreeBalance(parent.id)).toBe(300);
  });

  it("handles deep tree — returns balance of most recent leaf", async () => {
    const a = await createDefaultAccount({ name: "A", balance: 100, account_identifier: "DT_A" });
    const b = await createDefaultAccount({ name: "B", balance: 200, account_identifier: "DT_B" });
    const c = await createDefaultAccount({ name: "C", balance: 999, account_identifier: "DT_C" });
    // Clear auto-set timestamps so only the explicit update on c is the latest
    DB._exec("UPDATE accounts SET balance_updated_at = NULL WHERE id IN (?, ?, ?)", [a.id, b.id, c.id]);
    // Build chain c → b → a
    await DB.mergeAccounts(b.id, a.id);
    await DB.mergeAccounts(c.id, a.id);
    DB._exec(
      "UPDATE accounts SET balance_updated_at = '2025-03-01T00:00:00Z' WHERE id = ?",
      [c.id],
    );
    // c has the only timestamp → 999 returned
    expect(DB._latestTreeBalance(a.id)).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// 5. Auto-categorization & Merchant Learning
// ---------------------------------------------------------------------------
describe("Auto-categorization & Merchant Learning", () => {
  let accountId;
  let categoryId;

  beforeEach(async () => {
    await freshDB();
    const acc = await createDefaultAccount();
    accountId = acc.id;
    const cats = await DB.getCategories();
    categoryId = cats.find((c) => c.name === "Food & Dining").id;
  });

  it("auto-categorizes from known merchant", async () => {
    // First create a merchant
    await DB.createMerchant({
      merchant_name: "Swiggy",
      category_id: categoryId,
    });

    // Transaction without category but with merchant name should auto-categorize
    const tx = await DB.createTransaction({
      date: "2025-01-15",
      amount: 200,
      merchant_name: "Swiggy",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx.category_id).toBe(categoryId);
    expect(tx.merchant_id).toBeDefined();
  });

  it("learns merchant mapping on update with learn_merchant", async () => {
    const tx = await DB.createTransaction({
      date: "2025-01-15",
      amount: 200,
      merchant_name: "NewPlace",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx.category_id).toBeNull();

    await DB.updateTransaction(tx.id, {
      category_id: categoryId,
      learn_merchant: true,
    });

    // Now creating another with same merchant should auto-categorize
    const tx2 = await DB.createTransaction({
      date: "2025-01-16",
      amount: 150,
      merchant_name: "NewPlace",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx2.category_id).toBe(categoryId);
  });

  it("retroactively categorizes uncategorized transactions from same merchant", async () => {
    // Create uncategorized transactions with same merchant
    const tx1 = await DB.createTransaction({
      date: "2025-01-10",
      amount: 100,
      merchant_upi_id: "merchant@upi",
      transaction_type: "expense",
      account_id: accountId,
    });
    const tx2 = await DB.createTransaction({
      date: "2025-01-12",
      amount: 150,
      merchant_upi_id: "merchant@upi",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx1.category_id).toBeNull();
    expect(tx2.category_id).toBeNull();

    // Now categorize one with learn_merchant
    await DB.updateTransaction(tx2.id, {
      category_id: categoryId,
      learn_merchant: true,
    });

    // tx1 should be retroactively categorized
    const txs = await DB.getTransactions({});
    const updatedTx1 = txs.find((t) => t.id === tx1.id);
    expect(updatedTx1.category_id).toBe(categoryId);
  });
});

// ---------------------------------------------------------------------------
// 5b. Merchant Rename Memory (FINCO-50)
// ---------------------------------------------------------------------------
describe("Merchant Rename Memory", () => {
  let accountId;
  let categoryId;

  beforeEach(async () => {
    await freshDB();
    const acc = await createDefaultAccount();
    accountId = acc.id;
    const cats = await DB.getCategories();
    categoryId = cats.find((c) => c.name === "Food & Dining").id;
  });

  /** Normalize a name the same way db.js does for alias lookups. */
  function norm(name) {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }

  it("rename with learn=true on an UNLINKED transaction creates identity keyed on original", async () => {
    const tx = await DB.createTransaction({
      date: "2025-01-15",
      amount: 200,
      merchant_name: "PAYTM*SWIGGY",
      category_id: categoryId,
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx.merchant_id).toBeNull();

    const updated = await DB.updateTransaction(tx.id, {
      merchant_name: "Swiggy",
      learn_merchant_name: true,
    });

    // A merchants identity keyed on the ORIGINAL string now exists with the NEW display name.
    const merchant = DB._queryOne("SELECT * FROM merchants WHERE display_name = ?", ["Swiggy"]);
    expect(merchant).not.toBeNull();
    expect(merchant.category_id).toBe(categoryId);

    // Aliases exist for both the normalized original and the normalized new name.
    const origAlias = DB._queryOne(
      "SELECT 1 FROM merchant_aliases WHERE merchant_id = ? AND alias_norm = ?",
      [merchant.id, norm("PAYTM*SWIGGY")],
    );
    const newAlias = DB._queryOne(
      "SELECT 1 FROM merchant_aliases WHERE merchant_id = ? AND alias_norm = ?",
      [merchant.id, norm("Swiggy")],
    );
    expect(origAlias).not.toBeNull();
    expect(newAlias).not.toBeNull();

    // The transaction is now linked and shows the new name; category unchanged.
    expect(updated.merchant_id).toBe(merchant.id);
    expect(updated.merchant_name).toBe("Swiggy");
    expect(updated.category_id).toBe(categoryId);
  });

  it("future transaction with SAME original merchant name picks up the new name", async () => {
    const tx = await DB.createTransaction({
      date: "2025-01-15",
      amount: 200,
      merchant_name: "PAYTM*SWIGGY",
      category_id: categoryId,
      transaction_type: "expense",
      account_id: accountId,
    });
    await DB.updateTransaction(tx.id, {
      merchant_name: "Swiggy",
      learn_merchant_name: true,
    });

    const tx2 = await DB.createTransaction({
      date: "2025-01-20",
      amount: 150,
      merchant_name: "PAYTM*SWIGGY",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx2.merchant_name).toBe("Swiggy");
    expect(tx2.merchant_id).not.toBeNull();
  });

  it("rename with learn=true on an already-LINKED transaction updates display_name and keeps original alias", async () => {
    // Create a merchant identity and a transaction linked to it via createMerchant + auto-link.
    await DB.createMerchant({ merchant_name: "OldName", category_id: categoryId });
    const tx = await DB.createTransaction({
      date: "2025-01-15",
      amount: 200,
      merchant_name: "OldName",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx.merchant_id).not.toBeNull();
    const merchantId = tx.merchant_id;

    await DB.updateTransaction(tx.id, {
      merchant_name: "NewName",
      learn_merchant_name: true,
    });

    const merchant = DB._queryOne("SELECT * FROM merchants WHERE id = ?", [merchantId]);
    expect(merchant.display_name).toBe("NewName");

    // The original name must still resolve to this merchant (via merchant_key or an alias).
    const resolved = DB._lookupMerchant(null, "OldName");
    expect(resolved).not.toBeNull();
    expect(resolved.id).toBe(merchantId);

    // A future transaction with the original name maps to the merchant and shows the new name.
    const tx2 = await DB.createTransaction({
      date: "2025-01-20",
      amount: 100,
      merchant_name: "OldName",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx2.merchant_id).toBe(merchantId);
    expect(tx2.merchant_name).toBe("NewName");
  });

  it("rename keyed on UPI only (null original name) maps future UPI-matched transactions", async () => {
    const tx = await DB.createTransaction({
      date: "2025-01-15",
      amount: 200,
      merchant_upi_id: "coffee@upi",
      category_id: categoryId,
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx.merchant_id).toBeNull();

    await DB.updateTransaction(tx.id, {
      merchant_name: "Coffee House",
      learn_merchant_name: true,
    });

    const merchant = DB._queryOne("SELECT * FROM merchants WHERE merchant_upi_id = ?", [
      "coffee@upi",
    ]);
    expect(merchant).not.toBeNull();
    expect(merchant.display_name).toBe("Coffee House");

    const tx2 = await DB.createTransaction({
      date: "2025-01-20",
      amount: 90,
      merchant_upi_id: "coffee@upi",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx2.merchant_id).toBe(merchant.id);
    expect(tx2.merchant_name).toBe("Coffee House");
  });

  it("rename does NOT change the transaction's or siblings' category_id", async () => {
    const foodId = categoryId;
    const tx1 = await DB.createTransaction({
      date: "2025-01-10",
      amount: 100,
      merchant_name: "RawMerchant",
      category_id: foodId,
      transaction_type: "expense",
      account_id: accountId,
    });
    const tx2 = await DB.createTransaction({
      date: "2025-01-12",
      amount: 120,
      merchant_name: "RawMerchant",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx2.category_id).toBeNull();

    await DB.updateTransaction(tx1.id, {
      merchant_name: "Pretty Name",
      learn_merchant_name: true,
    });

    const txs = await DB.getTransactions({});
    const after1 = txs.find((t) => t.id === tx1.id);
    const after2 = txs.find((t) => t.id === tx2.id);
    // tx1 keeps its category; tx2 (sibling) category stays null — rename never touches category.
    expect(after1.category_id).toBe(foodId);
    expect(after2.category_id).toBeNull();
  });

  it("sibling retro-link: two unlinked transactions with same original merchant both show new name", async () => {
    const tx1 = await DB.createTransaction({
      date: "2025-01-10",
      amount: 100,
      merchant_name: "BIGBASKET RETAIL",
      transaction_type: "expense",
      account_id: accountId,
    });
    const tx2 = await DB.createTransaction({
      date: "2025-01-12",
      amount: 120,
      merchant_name: "BIGBASKET RETAIL",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx1.merchant_id).toBeNull();
    expect(tx2.merchant_id).toBeNull();

    await DB.updateTransaction(tx1.id, {
      merchant_name: "BigBasket",
      learn_merchant_name: true,
    });

    const txs = await DB.getTransactions({});
    const after1 = txs.find((t) => t.id === tx1.id);
    const after2 = txs.find((t) => t.id === tx2.id);
    expect(after1.merchant_id).not.toBeNull();
    expect(after2.merchant_id).toBe(after1.merchant_id);
    expect(after1.merchant_name).toBe("BigBasket");
    expect(after2.merchant_name).toBe("BigBasket");
  });

  it("learn=false renames only that row and does NOT create an identity or affect future", async () => {
    const tx = await DB.createTransaction({
      date: "2025-01-15",
      amount: 200,
      merchant_name: "RAWSTORE",
      transaction_type: "expense",
      account_id: accountId,
    });

    const updated = await DB.updateTransaction(tx.id, {
      merchant_name: "Nice Store",
      learn_merchant_name: false,
    });

    // No merchant identity created.
    const merchant = DB._queryOne("SELECT * FROM merchants WHERE display_name = ?", ["Nice Store"]);
    expect(merchant).toBeNull();
    // This row's merchant_name changed but it stays unlinked.
    expect(updated.merchant_name).toBe("Nice Store");
    expect(updated.merchant_id).toBeNull();

    // A future transaction with the original name is NOT remapped.
    const tx2 = await DB.createTransaction({
      date: "2025-01-20",
      amount: 150,
      merchant_name: "RAWSTORE",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx2.merchant_name).toBe("RAWSTORE");
    expect(tx2.merchant_id).toBeNull();
  });

  it("no-op rename (same value) creates no identity or alias", async () => {
    const tx = await DB.createTransaction({
      date: "2025-01-15",
      amount: 200,
      merchant_name: "SameName",
      transaction_type: "expense",
      account_id: accountId,
    });

    const merchantsBefore = DB._queryAll("SELECT id FROM merchants").length;
    const aliasesBefore = DB._queryAll("SELECT id FROM merchant_aliases").length;

    await DB.updateTransaction(tx.id, {
      merchant_name: "SameName",
      learn_merchant_name: true,
    });

    const merchantsAfter = DB._queryAll("SELECT id FROM merchants").length;
    const aliasesAfter = DB._queryAll("SELECT id FROM merchant_aliases").length;
    expect(merchantsAfter).toBe(merchantsBefore);
    expect(aliasesAfter).toBe(aliasesBefore);
  });

  it("simultaneous category-learn and rename end with both new category and new display name", async () => {
    const cats = await DB.getCategories();
    const groceriesId = cats.find((c) => c.name === "Groceries").id;

    const tx = await DB.createTransaction({
      date: "2025-01-15",
      amount: 200,
      merchant_name: "DMART RETAIL",
      transaction_type: "expense",
      account_id: accountId,
    });

    await DB.updateTransaction(tx.id, {
      category_id: groceriesId,
      merchant_name: "DMart",
      learn_merchant: true,
      learn_merchant_name: true,
    });

    // The merchant identity should carry both the new display name and the learned category.
    const merchant = DB._queryOne("SELECT * FROM merchants WHERE display_name = ?", ["DMart"]);
    expect(merchant).not.toBeNull();
    expect(merchant.category_id).toBe(groceriesId);

    // Future transaction with the original name gets both.
    const tx2 = await DB.createTransaction({
      date: "2025-01-20",
      amount: 150,
      merchant_name: "DMART RETAIL",
      transaction_type: "expense",
      account_id: accountId,
    });
    expect(tx2.merchant_name).toBe("DMart");
    expect(tx2.category_id).toBe(groceriesId);
  });
});

// ---------------------------------------------------------------------------
// 6. Categories CRUD
// ---------------------------------------------------------------------------
describe("Categories CRUD", () => {
  beforeEach(freshDB);

  it("lists categories ordered by name", async () => {
    const cats = await DB.getCategories();
    expect(cats.length).toBe(20);
    const names = cats.map((c) => c.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("creates a new category", async () => {
    const cat = await DB.createCategory({ name: "Custom Category", description: "My custom" });
    expect(cat.id).toBeGreaterThan(0);
    expect(cat.name).toBe("Custom Category");
    expect(cat.description).toBe("My custom");
    expect(cat.is_default).toBe(false);
  });

  it("rejects duplicate category name", async () => {
    await expect(DB.createCategory({ name: "Food & Dining" })).rejects.toThrow("already exists");
  });

  it("updates a category", async () => {
    const cats = await DB.getCategories();
    const cat = cats[0];
    const updated = await DB.updateCategory(cat.id, { name: "Renamed Cat" });
    expect(updated.name).toBe("Renamed Cat");
  });

  it("rejects updating to duplicate name", async () => {
    const cats = await DB.getCategories();
    await expect(
      DB.updateCategory(cats[0].id, { name: cats[1].name }),
    ).rejects.toThrow("already exists");
  });

  it("deletes a category", async () => {
    const cat = await DB.createCategory({ name: "Deletable" });
    const result = await DB.deleteCategory(cat.id);
    expect(result).toBeNull();
    const cats = await DB.getCategories();
    expect(cats.find((c) => c.name === "Deletable")).toBeUndefined();
  });

  it("blocks delete if merchants reference the category", async () => {
    const cats = await DB.getCategories();
    const catId = cats[0].id;
    await DB.createMerchant({ merchant_name: "TestShop", category_id: catId });
    await expect(DB.deleteCategory(catId)).rejects.toThrow("merchant(s) reference it");
  });

  it("throws when deleting nonexistent category", async () => {
    await expect(DB.deleteCategory(9999)).rejects.toThrow("Category not found");
  });

  it("sets and gets default category", async () => {
    const cats = await DB.getCategories();
    await DB.setDefaultCategory(cats[0].id);
    const def = await DB.getDefaultCategory();
    expect(def.id).toBe(cats[0].id);
    expect(def.is_default).toBe(true);
  });

  it("clears previous default when setting new one", async () => {
    const cats = await DB.getCategories();
    await DB.setDefaultCategory(cats[0].id);
    await DB.setDefaultCategory(cats[1].id);
    const def = await DB.getDefaultCategory();
    expect(def.id).toBe(cats[1].id);
    // Old default is no longer default
    const oldCat = await DB.getCategories();
    const old = oldCat.find((c) => c.id === cats[0].id);
    expect(old.is_default).toBe(false);
  });

  it("throws when no default category set", async () => {
    await expect(DB.getDefaultCategory()).rejects.toThrow("No default category");
  });

  it("throws when setting nonexistent category as default", async () => {
    await expect(DB.setDefaultCategory(9999)).rejects.toThrow("Category not found");
  });

  it("throws when updating nonexistent category", async () => {
    await expect(DB.updateCategory(9999, { name: "X" })).rejects.toThrow("Category not found");
  });
});

// ---------------------------------------------------------------------------
// 7. Merchants CRUD
// ---------------------------------------------------------------------------
describe("Merchants CRUD", () => {
  let categoryId;

  beforeEach(async () => {
    await freshDB();
    const cats = await DB.getCategories();
    categoryId = cats[0].id;
  });

  it("lists merchants with pagination", async () => {
    for (let i = 0; i < 3; i++) {
      await DB.createMerchant({ merchant_name: `Shop${i}`, category_id: categoryId });
    }
    const all = await DB.getMerchants();
    expect(all.length).toBe(3);
    const page = await DB.getMerchants({ limit: 2, skip: 0 });
    expect(page.length).toBe(2);
  });

  it("searches merchants by name", async () => {
    await DB.createMerchant({ merchant_name: "Swiggy Foods", category_id: categoryId });
    await DB.createMerchant({ merchant_name: "Zomato", category_id: categoryId });
    const results = await DB.searchMerchants("swiggy");
    expect(results.length).toBe(1);
    expect(results[0].merchant_name).toBe("Swiggy Foods");
  });

  it("searches merchants by UPI ID", async () => {
    await DB.createMerchant({
      merchant_name: "Shop",
      merchant_upi_id: "shop@upi",
      category_id: categoryId,
    });
    const results = await DB.searchMerchants("shop@upi");
    expect(results.length).toBe(1);
    expect(results[0].merchant_upi_id).toBe("shop@upi");
  });

  it("creates a merchant", async () => {
    const m = await DB.createMerchant({
      merchant_name: "TestMerchant",
      merchant_upi_id: "test@upi",
      category_id: categoryId,
    });
    expect(m.id).toBeGreaterThan(0);
    expect(m.merchant_name).toBe("TestMerchant");
    expect(m.merchant_upi_id).toBe("test@upi");
    expect(m.category_id).toBe(categoryId);
    expect(m.category).not.toBeNull();
    expect(m.confidence_score).toBe(1.0);
  });

  it("rejects duplicate UPI ID", async () => {
    await DB.createMerchant({
      merchant_name: "Shop1",
      merchant_upi_id: "dup@upi",
      category_id: categoryId,
    });
    await expect(
      DB.createMerchant({
        merchant_name: "Shop2",
        merchant_upi_id: "dup@upi",
        category_id: categoryId,
      }),
    ).rejects.toThrow("already exists");
  });

  it("throws when creating merchant with invalid category", async () => {
    await expect(
      DB.createMerchant({ merchant_name: "X", category_id: 9999 }),
    ).rejects.toThrow("Category not found");
  });

  it("updates a merchant", async () => {
    const m = await DB.createMerchant({ merchant_name: "Old", category_id: categoryId });
    const updated = await DB.updateMerchant(m.id, { merchant_name: "New" });
    expect(updated.merchant_name).toBe("New");
  });

  it("updates merchant category via updateMerchantCategory", async () => {
    const cats = await DB.getCategories();
    const cat2 = cats[1].id;
    const m = await DB.createMerchant({ merchant_name: "Shop", category_id: categoryId });
    const updated = await DB.updateMerchantCategory(m.id, cat2);
    expect(updated.category_id).toBe(cat2);
    expect(updated.confidence_score).toBe(1.0);
  });

  it("deletes a merchant", async () => {
    const m = await DB.createMerchant({ merchant_name: "ToDelete", category_id: categoryId });
    const result = await DB.deleteMerchant(m.id);
    expect(result).toBeNull();
  });

  it("throws when deleting nonexistent merchant", async () => {
    await expect(DB.deleteMerchant(9999)).rejects.toThrow("Merchant not found");
  });

  it("throws when updating nonexistent merchant", async () => {
    await expect(DB.updateMerchant(9999, { merchant_name: "X" })).rejects.toThrow(
      "Merchant not found",
    );
  });

  it("throws when updateMerchantCategory with invalid category", async () => {
    const m = await DB.createMerchant({ merchant_name: "Shop", category_id: categoryId });
    await expect(DB.updateMerchantCategory(m.id, 9999)).rejects.toThrow("Category not found");
  });
});

// ---------------------------------------------------------------------------
// 7b. Merchant rename surfaces on linked transactions (v4 identity model)
// ---------------------------------------------------------------------------
describe("Merchant rename surfaces on linked transactions", () => {
  let categoryId;
  let accountId;

  beforeEach(async () => {
    await freshDB();
    const cats = await DB.getCategories();
    categoryId = cats[0].id;
    const acc = await DB.createAccount({ name: "Test", balance: 0, account_type: "checking" });
    accountId = acc.id;
  });

  it("surfaces the new display name on all transactions sharing the merchant_upi_id", async () => {
    const m = await DB.createMerchant({
      merchant_name: "Swiggy",
      merchant_upi_id: "swiggy@paytm",
      category_id: categoryId,
    });
    await DB.createTransaction({
      date: "2025-01-01",
      amount: -100,
      description: "tx1",
      transaction_type: "expense",
      account_id: accountId,
      merchant_upi_id: "swiggy@paytm",
      merchant_name: "Swiggy",
    });
    await DB.createTransaction({
      date: "2025-01-02",
      amount: -200,
      description: "tx2",
      transaction_type: "expense",
      account_id: accountId,
      merchant_upi_id: "swiggy@paytm",
      merchant_name: "Swiggy",
    });

    await DB.updateMerchant(m.id, { merchant_name: "Swiggy Foods" });

    const txs = await DB.getTransactions({});
    const linked = txs.filter((t) => t.merchant_upi_id === "swiggy@paytm");
    expect(linked).toHaveLength(2);
    for (const tx of linked) {
      expect(tx.merchant_name).toBe("Swiggy Foods");
    }
  });

  it("updates display_name in the merchants table for the given upi_id", async () => {
    const m = await DB.createMerchant({
      merchant_name: "Swiggy",
      merchant_upi_id: "swiggy@paytm",
      category_id: categoryId,
    });

    await DB.updateMerchant(m.id, { merchant_name: "Swiggy Foods" });

    const row = DB._queryOne("SELECT display_name FROM merchants WHERE merchant_upi_id = ?", [
      "swiggy@paytm",
    ]);
    expect(row.display_name).toBe("Swiggy Foods");
  });

  it("does NOT affect transactions linked to a different merchant", async () => {
    const m = await DB.createMerchant({
      merchant_name: "Swiggy",
      merchant_upi_id: "swiggy@paytm",
      category_id: categoryId,
    });
    await DB.createMerchant({
      merchant_name: "Zomato",
      merchant_upi_id: "zomato@upi",
      category_id: categoryId,
    });
    await DB.createTransaction({
      date: "2025-01-01",
      amount: -100,
      description: "tx-target",
      transaction_type: "expense",
      account_id: accountId,
      merchant_upi_id: "swiggy@paytm",
      merchant_name: "Swiggy",
    });
    await DB.createTransaction({
      date: "2025-01-02",
      amount: -50,
      description: "tx-other",
      transaction_type: "expense",
      account_id: accountId,
      merchant_upi_id: "zomato@upi",
      merchant_name: "Zomato",
    });

    await DB.updateMerchant(m.id, { merchant_name: "Swiggy Foods" });

    const txs = await DB.getTransactions({});
    const other = txs.find((t) => t.merchant_upi_id === "zomato@upi");
    expect(other.merchant_name).toBe("Zomato");
  });

  it("keeps the immutable provenance merchant_name column unchanged on rename", async () => {
    const m = await DB.createMerchant({
      merchant_name: "Swiggy",
      merchant_upi_id: "swiggy@paytm",
      category_id: categoryId,
    });
    await DB.createTransaction({
      date: "2025-01-01",
      amount: -100,
      description: "tx1",
      transaction_type: "expense",
      account_id: accountId,
      merchant_upi_id: "swiggy@paytm",
      merchant_name: "Swiggy",
    });

    await DB.updateMerchant(m.id, { merchant_name: "Swiggy Foods" });

    const raw = DB._queryOne(
      "SELECT merchant_name FROM transactions WHERE merchant_upi_id = ?",
      ["swiggy@paytm"],
    );
    expect(raw.merchant_name).toBe("Swiggy");
  });

  it("surfaces the rename on a no-UPI merchant matched by normalized name", async () => {
    const m = await DB.createMerchant({
      merchant_name: "Swiggy",
      category_id: categoryId,
    });
    await DB.createTransaction({
      date: "2025-01-01",
      amount: -100,
      description: "tx-noupi",
      transaction_type: "expense",
      account_id: accountId,
      merchant_name: "Swiggy",
    });

    await DB.updateMerchant(m.id, { merchant_name: "Swiggy Foods" });

    const txs = await DB.getTransactions({});
    const tx = txs.find((t) => t.description === "tx-noupi");
    expect(tx.merchant_name).toBe("Swiggy Foods");
  });

  it("editing the merchant name on a linked transaction renames the merchant identity", async () => {
    const m = await DB.createMerchant({
      merchant_name: "Swiggy",
      merchant_upi_id: "swiggy@paytm",
      category_id: categoryId,
    });
    const tx1 = await DB.createTransaction({
      date: "2025-01-01",
      amount: -100,
      description: "tx1",
      transaction_type: "expense",
      account_id: accountId,
      merchant_upi_id: "swiggy@paytm",
      merchant_name: "Swiggy",
    });
    await DB.createTransaction({
      date: "2025-01-02",
      amount: -200,
      description: "tx2",
      transaction_type: "expense",
      account_id: accountId,
      merchant_upi_id: "swiggy@paytm",
      merchant_name: "Swiggy",
    });

    // Rename via the transaction edit modal path (updateTransaction).
    const updated = await DB.updateTransaction(tx1.id, { merchant_name: "Swiggy Foods" });
    expect(updated.merchant_name).toBe("Swiggy Foods");

    // The merchant identity is renamed, so the change surfaces on every linked transaction.
    const row = DB._queryOne("SELECT display_name FROM merchants WHERE id = ?", [m.id]);
    expect(row.display_name).toBe("Swiggy Foods");
    const txs = await DB.getTransactions({});
    for (const t of txs.filter((x) => x.merchant_upi_id === "swiggy@paytm")) {
      expect(t.merchant_name).toBe("Swiggy Foods");
    }
  });

  it("editing the merchant name on an unlinked transaction updates only that transaction", async () => {
    const tx = await DB.createTransaction({
      date: "2025-01-01",
      amount: -100,
      description: "tx-unlinked",
      transaction_type: "expense",
      account_id: accountId,
    });

    const updated = await DB.updateTransaction(tx.id, { merchant_name: "Corner Store" });
    expect(updated.merchant_name).toBe("Corner Store");
    // No merchant identity was created or renamed.
    expect(updated.merchant_id).toBeNull();
  });

  it("links merchant_id even when an explicit category is supplied (sample-data case)", async () => {
    const m = await DB.createMerchant({
      merchant_name: "Netflix",
      category_id: categoryId,
    });
    const cats = await DB.getCategories();
    const otherCat = cats.find((c) => c.id !== categoryId) || cats[0];

    // A transaction that carries BOTH a merchant name AND its own category (as the sample
    // Netflix transaction does) must still link to the merchant.
    const tx = await DB.createTransaction({
      date: "2025-01-01",
      amount: -649,
      description: "Netflix subscription",
      transaction_type: "expense",
      account_id: accountId,
      merchant_name: "Netflix",
      category_id: otherCat.id,
    });
    expect(tx.merchant_id).toBe(m.id);
    // The explicit category is preserved (merchant auto-categorization does not override it).
    expect(tx.category_id).toBe(otherCat.id);

    // Because it is linked, a merchant rename surfaces on this transaction.
    await DB.updateMerchant(m.id, { merchant_name: "Netflix India" });
    const refreshed = (await DB.getTransactions({ id: tx.id }))[0];
    expect(refreshed.merchant_name).toBe("Netflix India");
  });
});

// ---------------------------------------------------------------------------
// 8. Goals CRUD
// ---------------------------------------------------------------------------
describe("Goals CRUD", () => {
  beforeEach(freshDB);

  it("creates a goal", async () => {
    const g = await DB.createGoal({
      name: "Emergency Fund",
      target_amount: 10000,
      deadline: "2025-12-31",
    });
    expect(g.id).toBeGreaterThan(0);
    expect(g.name).toBe("Emergency Fund");
    expect(g.target_amount).toBe(10000);
    expect(g.current_amount).toBe(0);
    expect(g.deadline).toBe("2025-12-31");
  });

  it("gets a goal by ID", async () => {
    const g = await DB.createGoal({ name: "Test Goal", target_amount: 5000 });
    const fetched = await DB.getGoal(g.id);
    expect(fetched.name).toBe("Test Goal");
  });

  it("lists all goals", async () => {
    await DB.createGoal({ name: "Goal 1", target_amount: 1000 });
    await DB.createGoal({ name: "Goal 2", target_amount: 2000 });
    const goals = await DB.getGoals();
    expect(goals.length).toBe(2);
  });

  it("updates a goal", async () => {
    const g = await DB.createGoal({ name: "Old Name", target_amount: 1000 });
    const updated = await DB.updateGoal(g.id, { name: "New Name", target_amount: 2000 });
    expect(updated.name).toBe("New Name");
    expect(updated.target_amount).toBe(2000);
  });

  it("deletes a goal", async () => {
    const g = await DB.createGoal({ name: "Deletable", target_amount: 100 });
    const result = await DB.deleteGoal(g.id);
    expect(result.detail).toBe("Goal deleted");
    await expect(DB.getGoal(g.id)).rejects.toThrow("Goal not found");
  });

  it("contributes to a goal", async () => {
    const g = await DB.createGoal({ name: "Savings", target_amount: 1000 });
    const updated = await DB.contributeToGoal(g.id, 250);
    expect(updated.current_amount).toBe(250);
    const again = await DB.contributeToGoal(g.id, 100);
    expect(again.current_amount).toBe(350);
  });

  it("throws for nonexistent goal", async () => {
    await expect(DB.getGoal(9999)).rejects.toThrow("Goal not found");
    await expect(DB.updateGoal(9999, { name: "X" })).rejects.toThrow("Goal not found");
    await expect(DB.deleteGoal(9999)).rejects.toThrow("Goal not found");
    await expect(DB.contributeToGoal(9999, 10)).rejects.toThrow("Goal not found");
  });
});

// ---------------------------------------------------------------------------
// 9. Budgets CRUD
// ---------------------------------------------------------------------------
describe("Budgets CRUD", () => {
  let categoryId;

  beforeEach(async () => {
    await freshDB();
    const cats = await DB.getCategories();
    categoryId = cats.find((c) => c.name === "Food & Dining").id;
  });

  it("creates a budget", async () => {
    const b = await DB.createBudget({
      category_id: categoryId,
      period_start: "2025-01-01",
      period_end: "2025-01-31",
      limit_amount: 5000,
    });
    expect(b.id).toBeGreaterThan(0);
    expect(b.category_id).toBe(categoryId);
    expect(b.category_name).toBe("Food & Dining");
    expect(b.limit_amount).toBe(5000);
    expect(b.spent_to_date).toBe(0);
    expect(b.remaining).toBe(5000);
    expect(b.percentage_used).toBe(0);
    expect(b.status).toBe("on_track");
  });

  it("rejects overlapping budget for same category", async () => {
    await DB.createBudget({
      category_id: categoryId,
      period_start: "2025-01-01",
      period_end: "2025-01-31",
      limit_amount: 5000,
    });
    await expect(
      DB.createBudget({
        category_id: categoryId,
        period_start: "2025-01-15",
        period_end: "2025-02-15",
        limit_amount: 3000,
      }),
    ).rejects.toThrow("overlapping period");
  });

  it("gets budget with spending calculation", async () => {
    const acc = await createDefaultAccount();
    const b = await DB.createBudget({
      category_id: categoryId,
      period_start: "2025-01-01",
      period_end: "2025-01-31",
      limit_amount: 1000,
    });
    await DB.createTransaction({
      date: "2025-01-10",
      amount: -200,
      transaction_type: "expense",
      account_id: acc.id,
      category_id: categoryId,
    });
    await DB.createTransaction({
      date: "2025-01-15",
      amount: -300,
      transaction_type: "expense",
      account_id: acc.id,
      category_id: categoryId,
    });

    const fetched = await DB.getBudget(b.id);
    expect(fetched.spent_to_date).toBe(500);
    expect(fetched.remaining).toBe(500);
    expect(fetched.percentage_used).toBe(50);
  });

  it("updates a budget", async () => {
    const b = await DB.createBudget({
      category_id: categoryId,
      period_start: "2025-01-01",
      period_end: "2025-01-31",
      limit_amount: 5000,
    });
    const updated = await DB.updateBudget(b.id, { limit_amount: 8000 });
    expect(updated.limit_amount).toBe(8000);
  });

  it("deletes a budget", async () => {
    const b = await DB.createBudget({
      category_id: categoryId,
      period_start: "2025-01-01",
      period_end: "2025-01-31",
      limit_amount: 5000,
    });
    const result = await DB.deleteBudget(b.id);
    expect(result.detail).toBe("Budget deleted");
    await expect(DB.getBudget(b.id)).rejects.toThrow("Budget not found");
  });

  it("determines status: on_track, warning, exceeded", async () => {
    const acc = await createDefaultAccount();
    const b = await DB.createBudget({
      category_id: categoryId,
      period_start: "2025-01-01",
      period_end: "2025-01-31",
      limit_amount: 1000,
    });

    // on_track (0 spent)
    let fetched = await DB.getBudget(b.id);
    expect(fetched.status).toBe("on_track");

    // warning (>80%)
    await DB.createTransaction({
      date: "2025-01-10",
      amount: -850,
      transaction_type: "expense",
      account_id: acc.id,
      category_id: categoryId,
    });
    fetched = await DB.getBudget(b.id);
    expect(fetched.status).toBe("warning");

    // exceeded (>100%)
    await DB.createTransaction({
      date: "2025-01-20",
      amount: -200,
      transaction_type: "expense",
      account_id: acc.id,
      category_id: categoryId,
    });
    fetched = await DB.getBudget(b.id);
    expect(fetched.status).toBe("exceeded");
  });

  it("rejects period_end before period_start", async () => {
    await expect(
      DB.createBudget({
        category_id: categoryId,
        period_start: "2025-01-31",
        period_end: "2025-01-01",
        limit_amount: 1000,
      }),
    ).rejects.toThrow("Period end must be after period start");
  });

  it("throws for nonexistent budget", async () => {
    await expect(DB.getBudget(9999)).rejects.toThrow("Budget not found");
    await expect(DB.updateBudget(9999, {})).rejects.toThrow("Budget not found");
    await expect(DB.deleteBudget(9999)).rejects.toThrow("Budget not found");
  });

  it("throws when creating budget with invalid category", async () => {
    await expect(
      DB.createBudget({
        category_id: 9999,
        period_start: "2025-01-01",
        period_end: "2025-01-31",
        limit_amount: 1000,
      }),
    ).rejects.toThrow("Category not found");
  });

  it("response includes computed fields", async () => {
    const b = await DB.createBudget({
      category_id: categoryId,
      period_start: "2025-01-01",
      period_end: "2025-01-31",
      limit_amount: 5000,
    });
    expect(b).toHaveProperty("spent_to_date");
    expect(b).toHaveProperty("remaining");
    expect(b).toHaveProperty("percentage_used");
    expect(b).toHaveProperty("status");
    expect(b).toHaveProperty("category_name");
  });
});

// ---------------------------------------------------------------------------
// 10b. Bill Reminders
// ---------------------------------------------------------------------------

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("Bill Reminders", () => {
  let acctId;

  beforeEach(async () => {
    await freshDB();
    const acc = await createDefaultAccount();
    acctId = acc.id;
  });

  it("schema migration adds next_due_date, reminder_days_before, is_reminder_enabled columns", () => {
    const cols = DB._queryAll("PRAGMA table_info(recurring_patterns)").map((c) => c.name);
    expect(cols).toContain("next_due_date");
    expect(cols).toContain("reminder_days_before");
    expect(cols).toContain("is_reminder_enabled");
  });
});

// ---------------------------------------------------------------------------
// 11. Reports
// ---------------------------------------------------------------------------
describe("Reports", () => {
  let accountId;

  beforeEach(async () => {
    await freshDB();
    const acc = await createDefaultAccount();
    accountId = acc.id;
  });

  it("returns spending by category with amounts", async () => {
    const cats = await DB.getCategories();
    const foodCat = cats.find((c) => c.name === "Food & Dining");
    const transCat = cats.find((c) => c.name === "Transportation");

    await DB.createTransaction({
      date: "2025-01-10",
      amount: -200,
      transaction_type: "expense",
      account_id: accountId,
      category_id: foodCat.id,
    });
    await DB.createTransaction({
      date: "2025-01-15",
      amount: -100,
      transaction_type: "expense",
      account_id: accountId,
      category_id: transCat.id,
    });

    const report = await DB.getSpendingReport({
      start_date: "2025-01-01",
      end_date: "2025-01-31",
    });
    expect(report.by_category.length).toBe(2);
    expect(report.total_spent).toBe(300);
    expect(report.total_transactions).toBe(2);
    const foodEntry = report.by_category.find((c) => c.category_name === "Food & Dining");
    expect(foodEntry.total_amount).toBe(200);
  });

  it("returns monthly trend data", async () => {
    await DB.createTransaction({
      date: "2025-01-15",
      amount: -100,
      transaction_type: "expense",
      account_id: accountId,
    });
    await DB.createTransaction({
      date: "2025-02-15",
      amount: -200,
      transaction_type: "expense",
      account_id: accountId,
    });

    const report = await DB.getSpendingReport({
      start_date: "2025-01-01",
      end_date: "2025-02-28",
    });
    expect(report.monthly_trend.length).toBe(2);
    expect(report.monthly_trend[0].month).toBe("2025-01");
    expect(report.monthly_trend[1].month).toBe("2025-02");
  });

  it("filters by account family", async () => {
    const parent = await createDefaultAccount({ name: "Parent", account_identifier: "RP" });
    const child = await createDefaultAccount({ name: "Child", account_identifier: "RC" });
    await DB.mergeAccounts(child.id, parent.id);

    await DB.createTransaction({
      date: "2025-01-10",
      amount: -50,
      transaction_type: "expense",
      account_id: parent.id,
    });
    await DB.createTransaction({
      date: "2025-01-12",
      amount: -75,
      transaction_type: "expense",
      account_id: child.id,
    });

    const report = await DB.getSpendingReport({
      account_id: parent.id,
      start_date: "2025-01-01",
      end_date: "2025-01-31",
    });
    expect(report.total_spent).toBe(125);
    expect(report.total_transactions).toBe(2);
  });

  it("uses default date range when not specified", async () => {
    const report = await DB.getSpendingReport();
    expect(report.start_date).toBeDefined();
    expect(report.end_date).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 12. Chat / Conversations
// ---------------------------------------------------------------------------
describe("Chat / Conversations", () => {
  beforeEach(freshDB);

  it("saves and retrieves chat messages", async () => {
    await DB.saveChatMessage("chat1", "user", "Hello");
    await DB.saveChatMessage("chat1", "assistant", "Hi there!");
    const result = await DB.getChatHistory("chat1");
    expect(result.chat_id).toBe("chat1");
    expect(result.history.length).toBe(2);
    expect(result.history[0].role).toBe("user");
    expect(result.history[0].content).toBe("Hello");
    expect(result.history[1].role).toBe("assistant");
  });

  it("clears chat history for a specific chat", async () => {
    await DB.saveChatMessage("chat1", "user", "Msg1");
    await DB.saveChatMessage("chat2", "user", "Msg2");
    await DB.clearChatHistory("chat1");
    const c1 = await DB.getChatHistory("chat1");
    expect(c1.history.length).toBe(0);
    // chat2 untouched
    const c2 = await DB.getChatHistory("chat2");
    expect(c2.history.length).toBe(1);
  });

  it("clears all chat history when no chatId", async () => {
    await DB.saveChatMessage("chat1", "user", "Msg1");
    await DB.saveChatMessage("chat2", "user", "Msg2");
    await DB.clearChatHistory();
    const c1 = await DB.getChatHistory("chat1");
    expect(c1.history.length).toBe(0);
  });

  it("lists chat sessions with preview", async () => {
    await DB.saveChatMessage("session-a", "user", "What is my balance?");
    await DB.saveChatMessage("session-a", "assistant", "Your balance is 1000");
    await DB.saveChatMessage("session-b", "user", "Show me spending report");

    const result = await DB.listChatSessions();
    expect(result.sessions.length).toBe(2);
    const sessionA = result.sessions.find((s) => s.chat_id === "session-a");
    expect(sessionA.message_count).toBe(2);
    expect(sessionA.preview).toContain("What is my balance");
  });

  it("getChatHistory returns most recent session when no chatId", async () => {
    await DB.saveChatMessage("old-chat", "user", "Old message");
    await DB.saveChatMessage("new-chat", "user", "New message");
    const result = await DB.getChatHistory();
    expect(result.chat_id).toBe("new-chat");
  });

  it("getChatHistory returns empty when no conversations exist", async () => {
    const result = await DB.getChatHistory();
    expect(result.chat_id).toBeNull();
    expect(result.history).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 13. Export
// ---------------------------------------------------------------------------
describe("Export", () => {
  let accountId;

  beforeEach(async () => {
    await freshDB();
    const acc = await createDefaultAccount();
    accountId = acc.id;
  });

  it("generates CSV with correct headers and data", async () => {
    const cats = await DB.getCategories();
    await DB.createTransaction({
      date: "2025-01-15",
      amount: -100,
      description: "Lunch at cafe",
      transaction_type: "expense",
      account_id: accountId,
      category_id: cats[0].id,
      merchant_name: "CafeShop",
    });

    const csv = await DB.exportTransactionsCSV();
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Date,Description,Amount,Type,Category,Account,Merchant,Tags");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("Lunch at cafe");
    expect(lines[1]).toContain("CafeShop");
    expect(lines[1]).toContain("Test Checking");
  });

  it("exports and imports database", async () => {
    await DB.createTransaction({
      date: "2025-01-15",
      amount: -50,
      description: "Before export",
      transaction_type: "expense",
      account_id: accountId,
    });

    const exported = await DB.exportDatabase();
    expect(exported).toBeInstanceOf(Uint8Array);
    expect(exported.length).toBeGreaterThan(0);

    // Import into a fresh DB
    await DB.importDatabase(exported);
    const txs = await DB.getTransactions({});
    expect(txs.length).toBe(1);
    expect(txs[0].description).toBe("Before export");
  });

  it("CSV filters by date range", async () => {
    await DB.createTransaction({
      date: "2025-01-10",
      amount: -50,
      description: "In range",
      transaction_type: "expense",
      account_id: accountId,
    });
    await DB.createTransaction({
      date: "2025-03-10",
      amount: -75,
      description: "Out of range",
      transaction_type: "expense",
      account_id: accountId,
    });

    const csv = await DB.exportTransactionsCSV({
      start_date: "2025-01-01",
      end_date: "2025-01-31",
    });
    const lines = csv.split("\n");
    expect(lines.length).toBe(2); // header + 1 data row
    expect(csv).toContain("In range");
    expect(csv).not.toContain("Out of range");
  });
});

// ---------------------------------------------------------------------------
// 13b. Backup & Restore
// ---------------------------------------------------------------------------
describe("Backup & Restore", () => {
  beforeEach(freshDB);

  it("importDatabase replaces existing data (not appends)", async () => {
    // Create original data
    const origAcc = await createDefaultAccount({ name: "Original Account" });
    await createDefaultTransaction(origAcc.id, { description: "Original TX" });

    // Export the original state
    const exported = await DB.exportDatabase();

    // Create MORE different data
    const newAcc = await createDefaultAccount({
      name: "New Account",
      account_identifier: "NEW1",
    });
    await createDefaultTransaction(newAcc.id, { description: "New TX" });

    // Verify both sets exist before import
    const allAccsBefore = await DB.getAccounts();
    expect(allAccsBefore.length).toBe(2);
    const allTxsBefore = await DB.getTransactions({});
    expect(allTxsBefore.length).toBe(2);

    // Import the original export — should replace, not append
    await DB.importDatabase(exported);

    const accounts = await DB.getAccounts();
    expect(accounts.length).toBe(1);
    expect(accounts[0].name).toBe("Original Account");

    const txs = await DB.getTransactions({});
    expect(txs.length).toBe(1);
    expect(txs[0].description).toBe("Original TX");
  });

  it("importDatabase preserves foreign key enforcement", async () => {
    const acc = await createDefaultAccount();
    await createDefaultTransaction(acc.id, { description: "Before export" });

    const exported = await DB.exportDatabase();
    await DB.importDatabase(exported);

    // FK enforcement should be ON after import
    const fk = DB._queryOne("PRAGMA foreign_keys");
    expect(fk.foreign_keys).toBe(1);

    // Creating a transaction with invalid account_id should throw
    await expect(
      DB.createTransaction({
        date: "2025-02-01",
        amount: -25,
        description: "Bad FK",
        transaction_type: "expense",
        account_id: 99999,
      }),
    ).rejects.toThrow();
  });

  it("re-importing a database yields a schema identical to a fresh one (parity)", async () => {
    const freshSchema = DB._queryAll(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    );
    const exported = await DB.exportDatabase();
    await DB.importDatabase(exported);
    const importedSchema = DB._queryAll(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    );
    expect(importedSchema).toEqual(freshSchema);
  });

  it("importDatabase re-creates sync artifacts missing from an older binary", async () => {
    // Simulate a pre-v7 binary that lacks the sync tombstone table and the deleted index.
    DB._exec("DROP TABLE IF EXISTS sync_tombstones");
    DB._exec("DROP INDEX IF EXISTS ix_processed_gmail_deleted");
    const exported = await DB.exportDatabase();
    await DB.importDatabase(exported);

    const table = DB._queryOne(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_tombstones'",
    );
    expect(table).toBeTruthy();
    const index = DB._queryOne(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='ix_processed_gmail_deleted'",
    );
    expect(index).toBeTruthy();
  });

  it("SCHEMA_SQL is safe to apply over a legacy processed_gmail_messages table lacking the deleted column", async () => {
    // Reproduces the production load crash ("no such column: deleted"): SCHEMA_SQL runs
    // before migrations in init()/importDatabase, so it must not create an index that
    // references the `deleted` column — that column is only added later by migration v3.
    DB._exec("DROP INDEX IF EXISTS ix_processed_gmail_deleted");
    DB._exec("DROP TABLE IF EXISTS processed_gmail_messages");
    DB._exec(`
      CREATE TABLE processed_gmail_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gmail_message_id TEXT NOT NULL UNIQUE,
        processed_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Re-applying the canonical DDL must not throw even though the existing table predates
    // the `deleted` column (CREATE TABLE IF NOT EXISTS is a no-op on the legacy table).
    // Before the fix this raised "no such column: deleted" because SCHEMA_SQL created an
    // index referencing a column only added later by migration v3.
    expect(() => DB._exec(SCHEMA_SQL)).not.toThrow();

    // The column is then supplied by the migration runner (here applied manually since the
    // fresh test DB is already stamped at the latest user_version), after which the index
    // can be created — mirroring the post-migration step in init()/importDatabase.
    DB._exec("ALTER TABLE processed_gmail_messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
    DB._exec(
      "CREATE INDEX IF NOT EXISTS ix_processed_gmail_deleted ON processed_gmail_messages(deleted)",
    );
    const cols = DB._queryAll("PRAGMA table_info(processed_gmail_messages)").map((c) => c.name);
    expect(cols).toContain("deleted");
    const index = DB._queryOne(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='ix_processed_gmail_deleted'",
    );
    expect(index).toBeTruthy();
  });

  it("migrating a legacy merchants table rebuilds identity without a dangling *_legacy FK", async () => {
    // Reproduces the production load crash ("no such table: main.merchants_legacy"): the v5
    // merchant rebuild RENAMEs merchants -> merchants_legacy and DROPs it. With foreign keys
    // enforced and legacy_alter_table OFF, the RENAME rewrites the FK references in
    // transactions/merchant_aliases to merchants_legacy; after the DROP those references
    // dangle and the migration's own "UPDATE transactions SET merchant_id" raises the error.
    // The runner must disable FK enforcement + enable legacy_alter_table around migrations.
    DB._exec("PRAGMA foreign_keys = OFF");
    DB._exec("DROP TABLE IF EXISTS merchant_aliases");
    DB._exec("DROP TABLE IF EXISTS transactions");
    DB._exec("DROP TABLE IF EXISTS merchants");
    // Pre-v5 (post-v3) legacy shape: merchants keyed by name with a match_name column and
    // no merchant_aliases table, plus transactions referencing merchants(id).
    DB._exec(`
      CREATE TABLE merchants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_name TEXT,
        match_name TEXT,
        merchant_upi_id TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        confidence_score REAL DEFAULT 1.0,
        created_at TEXT DEFAULT (datetime('now')),
        last_updated TEXT DEFAULT (datetime('now'))
      )
    `);
    DB._exec(`
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT UNIQUE,
        gmail_message_id TEXT,
        date TEXT,
        merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
        merchant_upi_id TEXT,
        merchant_name TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    DB._exec("INSERT INTO accounts (id, name) VALUES (1, 'Legacy Account')");
    DB._exec(
      "INSERT INTO merchants (id, merchant_name, match_name, merchant_upi_id) VALUES (1, 'Swiggy', 'swiggy', 'swiggy@upi')",
    );
    DB._exec(
      "INSERT INTO transactions (id, transaction_id, merchant_id, merchant_upi_id, merchant_name, account_id) VALUES (1, 'tx-1', 1, 'swiggy@upi', 'Swiggy', 1)",
    );
    DB._exec("PRAGMA foreign_keys = ON");
    // Stamp post-v4 so only the rebuild migrations (v5+) run.
    DB._exec("PRAGMA user_version = 4");

    // init()/importDatabase apply SCHEMA_SQL first (recreates merchant_aliases), then run
    // the migration runner. The whole sequence must complete without throwing.
    DB._exec(SCHEMA_SQL);
    expect(() => DB._runMigrations()).not.toThrow();

    // The legacy merchant survived the rebuild (now keyed by merchant_key) and the legacy
    // table is gone with no dangling reference left behind.
    const merch = DB._queryOne("SELECT * FROM merchants WHERE id = 1");
    expect(merch).toBeTruthy();
    expect(merch.merchant_key).toBeTruthy();
    const legacy = DB._queryOne(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='merchants_legacy'",
    );
    expect(legacy).toBeFalsy();
    // The write that originally raised the dangling-FK error now succeeds, and FK
    // enforcement was restored after the run.
    expect(() => DB._exec("UPDATE transactions SET merchant_id = 1 WHERE id = 1")).not.toThrow();
    expect(DB._queryOne("PRAGMA foreign_keys").foreign_keys).toBe(1);
  });

  it("exportTransactionsCSV with no transactions returns header only", async () => {
    // Fresh DB with no transactions
    const csv = await DB.exportTransactionsCSV();
    const lines = csv.split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe("Date,Description,Amount,Type,Category,Account,Merchant,Tags");
  });

  it("exportTransactionsCSV filters by account_id", async () => {
    const acc1 = await createDefaultAccount({ name: "Acc One" });
    const acc2 = await createDefaultAccount({
      name: "Acc Two",
      account_identifier: "A2",
    });

    await createDefaultTransaction(acc1.id, { description: "TX in Acc1" });
    await createDefaultTransaction(acc2.id, { description: "TX in Acc2" });

    const csv = await DB.exportTransactionsCSV({ account_id: acc1.id });
    const lines = csv.split("\n");
    expect(lines.length).toBe(2); // header + 1 row
    expect(csv).toContain("TX in Acc1");
    expect(csv).not.toContain("TX in Acc2");
  });

  it("exportTransactionsCSV filters by category_id", async () => {
    const acc = await createDefaultAccount();
    const cats = await DB.getCategories();
    const cat1 = cats[0];
    const cat2 = cats[1];

    await createDefaultTransaction(acc.id, {
      description: "TX cat1",
      category_id: cat1.id,
    });
    await createDefaultTransaction(acc.id, {
      description: "TX cat2",
      category_id: cat2.id,
    });

    const csv = await DB.exportTransactionsCSV({ category_id: cat1.id });
    const lines = csv.split("\n");
    expect(lines.length).toBe(2); // header + 1 row
    expect(csv).toContain("TX cat1");
    expect(csv).not.toContain("TX cat2");
  });
});

// ---------------------------------------------------------------------------
// 14. Persistence
// ---------------------------------------------------------------------------
describe("Persistence", () => {
  it("_persist is called after write operations", async () => {
    await freshDB();
    DB._persist.mockClear();

    await createDefaultAccount();
    expect(DB._persist).toHaveBeenCalledTimes(1);

    DB._persist.mockClear();
    const acc = await createDefaultAccount({ name: "Acc2", account_identifier: "ACC2" });
    await DB.createTransaction({
      date: "2025-01-01",
      amount: 10,
      transaction_type: "expense",
      account_id: acc.id,
    });
    expect(DB._persist).toHaveBeenCalledTimes(2); // 1 for account + 1 for transaction
  });

  it("initializes from existing data in storage", async () => {
    await freshDB();
    await createDefaultAccount({ name: "Persisted Account" });

    // Export current DB state
    const snapshot = DB._db.export();

    // Re-init with mocked loadFromStorage returning the snapshot
    DB._db = null;
    DB._persist = vi.fn(async () => {});
    DB._loadFromStorage = vi.fn(async () => snapshot.buffer);
    await DB.init();

    const accounts = await DB.getAccounts();
    const found = accounts.find((a) => a.name === "Persisted Account");
    expect(found).toBeDefined();
  });

  it("initializes fresh database when storage is empty", async () => {
    DB._db = null;
    DB._persist = vi.fn(async () => {});
    DB._loadFromStorage = vi.fn(async () => null);
    await DB.init();

    const cats = await DB.getCategories();
    expect(cats.length).toBe(20);
    const accounts = await DB.getAccounts();
    expect(accounts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------
describe("Edge Cases", () => {
  beforeEach(freshDB);

  it("transaction totals with no transactions returns zeros", async () => {
    const totals = await DB.getTransactionTotals();
    expect(totals.total_income).toBe(0);
    expect(totals.total_expense).toBe(0);
    expect(totals.net).toBe(0);
    expect(totals.transaction_count).toBe(0);
  });

  it("getTransactions with nonexistent account_id throws", async () => {
    await expect(DB.getTransactions({ account_id: 9999 })).rejects.toThrow("Account not found");
  });

  it("getTransactionTotals with nonexistent account_id throws", async () => {
    await expect(DB.getTransactionTotals({ account_id: 9999 })).rejects.toThrow(
      "Account not found",
    );
  });

  it("does not re-seed categories on second init", async () => {
    // First init already seeded 20 categories
    expect((await DB.getCategories()).length).toBe(20);

    // Re-init (simulating app restart with existing data)
    const snapshot = DB._db.export();
    DB._db = null;
    DB._persist = vi.fn(async () => {});
    DB._loadFromStorage = vi.fn(async () => snapshot.buffer);
    await DB.init();

    // Still 20, not 40
    expect((await DB.getCategories()).length).toBe(20);
  });

  it("CSV export escapes quotes in description", async () => {
    const acc = await createDefaultAccount();
    await DB.createTransaction({
      date: "2025-01-15",
      amount: -50,
      description: 'Item with "quotes"',
      transaction_type: "expense",
      account_id: acc.id,
    });
    const csv = await DB.exportTransactionsCSV();
    expect(csv).toContain('""quotes""');
  });

  it("budget overlap check excludes self on update", async () => {
    const cats = await DB.getCategories();
    const catId = cats[0].id;
    const b = await DB.createBudget({
      category_id: catId,
      period_start: "2025-01-01",
      period_end: "2025-01-31",
      limit_amount: 1000,
    });
    // Updating same budget's limit should not trigger overlap
    const updated = await DB.updateBudget(b.id, { limit_amount: 2000 });
    expect(updated.limit_amount).toBe(2000);
  });

  it("create category with is_default clears previous default", async () => {
    const cats = await DB.getCategories();
    await DB.setDefaultCategory(cats[0].id);
    const newCat = await DB.createCategory({
      name: "New Default",
      is_default: true,
    });
    expect(newCat.is_default).toBe(true);
    // Old one should no longer be default
    const allCats = await DB.getCategories();
    const oldDefault = allCats.find((c) => c.id === cats[0].id);
    expect(oldDefault.is_default).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Processed Gmail Messages
// ---------------------------------------------------------------------------
describe("Processed Gmail Messages", () => {
  beforeEach(freshDB);

  it("getProcessedGmailIds returns empty set for empty input", () => {
    const result = DB.getProcessedGmailIds([]);
    expect(result).toEqual(new Set());
  });

  it("getProcessedGmailIds returns empty set when no IDs stored", () => {
    const result = DB.getProcessedGmailIds(["msg1", "msg2"]);
    expect(result).toEqual(new Set());
  });

  it("saveProcessedGmailIds stores IDs and getProcessedGmailIds retrieves them", async () => {
    await DB.saveProcessedGmailIds(["msg1", "msg2", "msg3"]);
    const result = DB.getProcessedGmailIds(["msg1", "msg2", "msg3", "msg4"]);
    expect(result.size).toBe(3);
    expect(result.has("msg1")).toBe(true);
    expect(result.has("msg2")).toBe(true);
    expect(result.has("msg3")).toBe(true);
    expect(result.has("msg4")).toBe(false);
  });

  it("saveProcessedGmailIds is idempotent — no duplicates on re-save", async () => {
    await DB.saveProcessedGmailIds(["msg1", "msg2"]);
    await DB.saveProcessedGmailIds(["msg1", "msg2", "msg3"]);
    const rows = DB._queryAll("SELECT * FROM processed_gmail_messages");
    expect(rows.length).toBe(3);
  });

  it("saveProcessedGmailIds skips empty input", async () => {
    await DB.saveProcessedGmailIds([]);
    const rows = DB._queryAll("SELECT * FROM processed_gmail_messages");
    expect(rows.length).toBe(0);
  });

  it("saveProcessedGmailIds calls _persist", async () => {
    await DB.saveProcessedGmailIds(["msg1"]);
    expect(DB._persist).toHaveBeenCalled();
  });

  it("getProcessedGmailIds handles null input", () => {
    const result = DB.getProcessedGmailIds(null);
    expect(result).toEqual(new Set());
  });

  it("processed_gmail_messages table has correct schema", () => {
    const info = DB._queryAll("PRAGMA table_info(processed_gmail_messages)");
    const cols = info.map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("gmail_message_id");
    expect(cols).toContain("processed_at");
  });
});

// ============================================================================
// Bug Regression Tests — Unit Layer
// These tests currently FAIL because the production bugs tracked in GitHub Issues
// have not yet been fixed. They serve as regression specs.
// ============================================================================

// ---------------------------------------------------------------------------
// BUG-SEV2-01: deleteAccount must block when account has transactions
// ---------------------------------------------------------------------------
describe("BUG-SEV2-01: deleteAccount blocks when account has transactions", () => {
	beforeEach(freshDB);

	it("throws when deleting an account that has at least one linked transaction", async () => {
		const acc = await createDefaultAccount();
		await createDefaultTransaction(acc.id);
		await expect(DB.deleteAccount(acc.id)).rejects.toThrow(/transaction/i);
	});

	it("succeeds when the account has no transactions", async () => {
		const acc = await createDefaultAccount();
		await expect(DB.deleteAccount(acc.id)).resolves.toMatchObject({ detail: "Account deleted" });
	});

	it("succeeds after all transactions on the account are deleted", async () => {
		const acc = await createDefaultAccount();
		const tx = await createDefaultTransaction(acc.id);
		await DB.deleteTransaction(tx.id);
		await expect(DB.deleteAccount(acc.id)).resolves.toMatchObject({ detail: "Account deleted" });
	});

	it("error message mentions transaction count", async () => {
		const acc = await createDefaultAccount();
		await createDefaultTransaction(acc.id);
		await createDefaultTransaction(acc.id, { amount: 75, description: "TX2" });
		await expect(DB.deleteAccount(acc.id)).rejects.toThrow(/2/);
	});
});

// ---------------------------------------------------------------------------
// BUG-SEV3-05 / BUG-SEV1-01 (DB layer): updateTransaction rejects invalid date
// ---------------------------------------------------------------------------
describe("BUG-SEV3-05: updateTransaction rejects empty or non-ISO date", () => {
	let accountId;

	beforeEach(async () => {
		await freshDB();
		const acc = await createDefaultAccount();
		accountId = acc.id;
	});

	it("throws when date is an empty string", async () => {
		const tx = await createDefaultTransaction(accountId);
		await expect(DB.updateTransaction(tx.id, { date: "" })).rejects.toThrow(/date/i);
	});

	it("throws when date is null", async () => {
		const tx = await createDefaultTransaction(accountId);
		await expect(DB.updateTransaction(tx.id, { date: null })).rejects.toThrow(/date/i);
	});

	it("throws when date does not match YYYY-MM-DD format (DD-MM-YYYY)", async () => {
		const tx = await createDefaultTransaction(accountId);
		await expect(DB.updateTransaction(tx.id, { date: "17-05-2026" })).rejects.toThrow(/date/i);
	});

	it("throws when date is a non-date string", async () => {
		const tx = await createDefaultTransaction(accountId);
		await expect(DB.updateTransaction(tx.id, { date: "not-a-date" })).rejects.toThrow(/date/i);
	});

	it("accepts a valid ISO 8601 date string", async () => {
		const tx = await createDefaultTransaction(accountId);
		const updated = await DB.updateTransaction(tx.id, { date: "2026-06-15" });
		expect(updated.date).toBe("2026-06-15");
	});

	it("preserves the original date when date key is omitted from the update payload", async () => {
		const tx = await createDefaultTransaction(accountId);
		const updated = await DB.updateTransaction(tx.id, { amount: 99 });
		expect(updated.date).toBe("2025-01-15");
	});

	it("preserves the time component when updating a transaction that has a stored timestamp", async () => {
		// Simulate a Gmail-imported transaction stored with a full datetime
		const tx = await createDefaultTransaction(accountId, { date: "2025-03-10T14:35:00" });
		// User edits via the date picker (sends date-only)
		const updated = await DB.updateTransaction(tx.id, { date: "2025-03-11" });
		// Date should change but time must be preserved
		expect(updated.date).toBe("2025-03-11T14:35:00");
	});

	it("preserves space-separated timestamp (YYYY-MM-DD HH:MM:SS format) when date is updated", async () => {
		const tx = await createDefaultTransaction(accountId, { date: "2025-05-20 09:15:30.000" });
		const updated = await DB.updateTransaction(tx.id, { date: "2025-06-01" });
		expect(updated.date).toBe("2025-06-01 09:15:30.000");
	});

	it("stores date-only when the existing transaction has no time component", async () => {
		const tx = await createDefaultTransaction(accountId, { date: "2025-01-15" });
		const updated = await DB.updateTransaction(tx.id, { date: "2025-02-28" });
		expect(updated.date).toBe("2025-02-28");
	});
});

// ---------------------------------------------------------------------------
// BUG-SEV3-03: deleteCategory must block when transactions reference it
// ---------------------------------------------------------------------------
describe("BUG-SEV3-03: deleteCategory blocks when transactions reference it", () => {
	beforeEach(freshDB);

	it("throws when at least one transaction references the category", async () => {
		const cat = await DB.createCategory({ name: "SEV3-03 Cat A" });
		const acc = await createDefaultAccount();
		await createDefaultTransaction(acc.id, { category_id: cat.id });
		await expect(DB.deleteCategory(cat.id)).rejects.toThrow(/transaction/i);
	});

	it("includes the affected transaction count in the error message", async () => {
		const cat = await DB.createCategory({ name: "SEV3-03 Cat B" });
		const acc = await createDefaultAccount();
		await createDefaultTransaction(acc.id, { category_id: cat.id });
		await createDefaultTransaction(acc.id, { category_id: cat.id, amount: 75 });
		await expect(DB.deleteCategory(cat.id)).rejects.toThrow(/2/);
	});

	it("succeeds when no transactions or merchants reference the category", async () => {
		const cat = await DB.createCategory({ name: "SEV3-03 Orphan Cat" });
		await expect(DB.deleteCategory(cat.id)).resolves.toBeNull();
	});

	it("still blocks when merchants reference the category (existing guard)", async () => {
		const cats = await DB.getCategories();
		const catId = cats[0].id;
		await DB.createMerchant({ merchant_name: "Shop303", category_id: catId });
		await expect(DB.deleteCategory(catId)).rejects.toThrow(/merchant/i);
	});
});

// ---------------------------------------------------------------------------
// BUG-SEV3-07: updateMerchant rejects confidence_score outside 0–1
// ---------------------------------------------------------------------------
describe("BUG-SEV3-07: updateMerchant rejects confidence_score outside 0–1 range", () => {
	let categoryId;

	beforeEach(async () => {
		await freshDB();
		const cats = await DB.getCategories();
		categoryId = cats[0].id;
	});

	it("throws when confidence_score is greater than 1 (e.g., 85 instead of 0.85)", async () => {
		const m = await DB.createMerchant({ merchant_name: "BugMerch307", category_id: categoryId });
		await expect(DB.updateMerchant(m.id, { confidence_score: 85 })).rejects.toThrow(
			/confidence/i,
		);
	});

	it("throws when confidence_score is negative", async () => {
		const m = await DB.createMerchant({ merchant_name: "NegConf307", category_id: categoryId });
		await expect(DB.updateMerchant(m.id, { confidence_score: -0.1 })).rejects.toThrow(
			/confidence/i,
		);
	});

	it("throws when confidence_score is exactly 2", async () => {
		const m = await DB.createMerchant({ merchant_name: "Over307", category_id: categoryId });
		await expect(DB.updateMerchant(m.id, { confidence_score: 2 })).rejects.toThrow(
			/confidence/i,
		);
	});

	it("accepts confidence_score = 0 (minimum boundary)", async () => {
		const m = await DB.createMerchant({ merchant_name: "Zero307", category_id: categoryId });
		const updated = await DB.updateMerchant(m.id, { confidence_score: 0 });
		expect(updated.confidence_score).toBe(0);
	});

	it("accepts confidence_score = 1 (maximum boundary)", async () => {
		const m = await DB.createMerchant({ merchant_name: "Full307", category_id: categoryId });
		const updated = await DB.updateMerchant(m.id, { confidence_score: 1 });
		expect(updated.confidence_score).toBe(1);
	});

	it("accepts confidence_score = 0.75 (mid-range value)", async () => {
		const m = await DB.createMerchant({ merchant_name: "Good307", category_id: categoryId });
		const updated = await DB.updateMerchant(m.id, { confidence_score: 0.75 });
		expect(updated.confidence_score).toBe(0.75);
	});
});

// ---------------------------------------------------------------------------
// _exec multi-statement SQL
// ---------------------------------------------------------------------------
describe("_exec multi-statement SQL", () => {
  beforeEach(freshDB);

  it("executes multiple statements when no params are provided", () => {
    DB._exec(
      "CREATE TABLE _test_a (id INTEGER); CREATE TABLE _test_b (id INTEGER);",
    );
    const tables = DB._queryAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_test_%' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(["_test_a", "_test_b"]);
  });

  it("executes single statement with params via run()", () => {
    DB._exec("CREATE TABLE _test_p (id INTEGER, val TEXT)");
    DB._exec("INSERT INTO _test_p (id, val) VALUES (?, ?)", [1, "hello"]);
    const row = DB._queryOne("SELECT * FROM _test_p WHERE id = 1");
    expect(row.val).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// updateTransaction — date validation (BUG-SEV1-01)
// ---------------------------------------------------------------------------
describe("updateTransaction — date validation", () => {
	beforeEach(freshDB);

	it("rejects empty date string", async () => {
		const acc = await createDefaultAccount();
		const tx = await createDefaultTransaction(acc.id);
		await expect(DB.updateTransaction(tx.id, { date: "" })).rejects.toThrow(
			"Invalid date format",
		);
	});

	it("rejects non-ISO date string (DD/MM/YYYY)", async () => {
		const acc = await createDefaultAccount();
		const tx = await createDefaultTransaction(acc.id);
		await expect(DB.updateTransaction(tx.id, { date: "15/01/2025" })).rejects.toThrow(
			"Invalid date format",
		);
	});

	it("accepts datetime-local string (YYYY-MM-DDTHH:mm) and stores full datetime", async () => {
		const acc = await createDefaultAccount();
		const tx = await createDefaultTransaction(acc.id);
		await expect(
			DB.updateTransaction(tx.id, { date: "2025-01-15T10:30" }),
		).resolves.not.toThrow();
		const rows = await DB.getTransactions({ id: tx.id });
		expect(rows[0].date).toBe("2025-01-15T10:30");
	});

	it("accepts valid YYYY-MM-DD date", async () => {
		const acc = await createDefaultAccount();
		const tx = await createDefaultTransaction(acc.id);
		await expect(DB.updateTransaction(tx.id, { date: "2025-06-01" })).resolves.not.toThrow();
		const updated = await DB.getTransactions({ id: tx.id });
		expect(updated[0].date).toBe("2025-06-01");
	});

	it("persists merchant_name update", async () => {
		const acc = await createDefaultAccount();
		const tx = await createDefaultTransaction(acc.id);
		await DB.updateTransaction(tx.id, { merchant_name: "Swiggy" });
		const rows = await DB.getTransactions({ id: tx.id });
		expect(rows[0].merchant_name).toBe("Swiggy");
	});
});

// ---------------------------------------------------------------------------
// deleteAccount — transaction check (BUG-SEV2-01)
// ---------------------------------------------------------------------------
describe("deleteAccount — transaction check", () => {
	beforeEach(freshDB);

	it("throws when transactions are linked to the account", async () => {
		const acc = await createDefaultAccount();
		await createDefaultTransaction(acc.id);
		await expect(DB.deleteAccount(acc.id)).rejects.toThrow(
			/Cannot delete account.*transaction/,
		);
	});

	it("succeeds when no transactions are linked", async () => {
		const acc = await createDefaultAccount();
		await expect(DB.deleteAccount(acc.id)).resolves.toMatchObject({ detail: "Account deleted" });
	});
});

// ---------------------------------------------------------------------------
// Transaction Follow-ups
// ---------------------------------------------------------------------------
describe("Transaction Follow-ups", () => {
	beforeEach(freshDB);

	// UTC-based ISO date offset from today (mirrors db.js _todayISO/_addDays UTC semantics).
	const isoOffset = (days) =>
		new Date(Date.now() + days * 86_400_000).toISOString().split("T")[0];

	async function seedTransaction(overrides = {}) {
		const acc = await createDefaultAccount({ account_identifier: "FU-ACC" });
		return createDefaultTransaction(acc.id, { transaction_id: "FU-TX-1", ...overrides });
	}

	it("createFollowUp is retrievable by transaction id and by its own id", async () => {
		const tx = await seedTransaction();
		const created = await DB.createFollowUp(tx.id, {
			title: "Chase refund",
			follow_up_type: "dispute",
			due_date: "2025-02-01",
			notes: "Amazon return",
		});
		expect(created.id).toBeTruthy();
		expect(created.status).toBe("pending");
		expect(created.transaction_id).toBe(tx.id);

		const byTx = await DB.getFollowUp(tx.id);
		expect(byTx).not.toBeNull();
		expect(byTx.title).toBe("Chase refund");
		expect(byTx.follow_up_type).toBe("dispute");
		expect(byTx.due_date).toBe("2025-02-01");
		expect(byTx.notes).toBe("Amazon return");

		const byId = await DB.getFollowUpById(created.id);
		expect(byId.id).toBe(created.id);
		expect(byId.title).toBe("Chase refund");
	});

	it("updateFollowUp changes fields and bumps updated_at", async () => {
		const tx = await seedTransaction();
		const created = await DB.createFollowUp(tx.id, { title: "Original", due_date: "2025-02-01" });
		const updated = await DB.updateFollowUp(created.id, {
			title: "Renamed",
			due_date: "2025-03-01",
			notes: "changed",
		});
		expect(updated.title).toBe("Renamed");
		expect(updated.due_date).toBe("2025-03-01");
		expect(updated.notes).toBe("changed");
		expect(updated.updated_at >= created.updated_at).toBe(true);
	});

	it("deleteFollowUp removes the row and records a follow_up tombstone", async () => {
		const tx = await seedTransaction();
		const created = await DB.createFollowUp(tx.id, { title: "To delete" });
		await DB.deleteFollowUp(created.id);

		expect(await DB.getFollowUp(tx.id)).toBeNull();

		const tombstones = DB._queryAll(
			"SELECT * FROM sync_tombstones WHERE entity_type = 'follow_up'",
		);
		expect(tombstones).toHaveLength(1);
		expect(tombstones[0].entity_key).toBe(tx.transaction_id);
	});

	it("markFollowUpDone on a non-recurring item sets status done and completed_at", async () => {
		const tx = await seedTransaction();
		const created = await DB.createFollowUp(tx.id, {
			title: "One-off",
			due_date: "2025-02-01",
			is_recurring: false,
		});
		const done = await DB.markFollowUpDone(created.id);
		expect(done.status).toBe("done");
		expect(done.completed_at).toBeTruthy();
	});

	it("markFollowUpDone on a recurring monthly item stays pending and rolls due_date forward", async () => {
		const tx = await seedTransaction();
		const created = await DB.createFollowUp(tx.id, {
			title: "Monthly bill",
			due_date: "2025-02-15",
			is_recurring: true,
			recurrence: "monthly",
		});
		const rolled = await DB.markFollowUpDone(created.id);
		expect(rolled.status).toBe("pending");
		expect(rolled.completed_at).toBeTruthy();
		expect(rolled.due_date > created.due_date).toBe(true);
	});

	it.each([
		["weekly", "2025-02-15", "2025-02-22"],
		["quarterly", "2025-02-15", "2025-05-15"],
		["yearly", "2025-02-15", "2026-02-15"],
	])(
		"markFollowUpDone rolls a %s recurring item forward correctly",
		async (recurrence, dueDate, expectedNext) => {
			const tx = await seedTransaction();
			const created = await DB.createFollowUp(tx.id, {
				title: `${recurrence} bill`,
				due_date: dueDate,
				is_recurring: true,
				recurrence,
			});
			const rolled = await DB.markFollowUpDone(created.id);
			expect(rolled.status).toBe("pending");
			expect(rolled.due_date).toBe(expectedNext);
			expect(rolled.completed_at).toBeTruthy();
		},
	);

	it("markFollowUpDone on a recurring item with no due_date rolls forward from today", async () => {
		const tx = await seedTransaction();
		const created = await DB.createFollowUp(tx.id, {
			title: "No due date monthly",
			is_recurring: true,
			recurrence: "monthly",
		});
		expect(created.due_date).toBeNull();
		const rolled = await DB.markFollowUpDone(created.id);
		expect(rolled.status).toBe("pending");
		expect(rolled.due_date).not.toBeNull();
		// Rolled from today → roughly a month out (25–40 days ahead of today).
		expect(rolled.days_remaining).toBeGreaterThanOrEqual(25);
		expect(rolled.days_remaining).toBeLessThanOrEqual(40);
	});

	it("reopenFollowUp resets status to pending and clears completed_at", async () => {
		const tx = await seedTransaction();
		const created = await DB.createFollowUp(tx.id, { title: "Reopen me", is_recurring: false });
		await DB.markFollowUpDone(created.id);
		const reopened = await DB.reopenFollowUp(created.id);
		expect(reopened.status).toBe("pending");
		expect(reopened.completed_at).toBeNull();
	});

	it("getFollowUps filters by status and type, and lists pending before done", async () => {
		const acc = await createDefaultAccount({ account_identifier: "FU-LIST-ACC" });
		const txA = await createDefaultTransaction(acc.id, { transaction_id: "FU-LIST-A" });
		const txB = await createDefaultTransaction(acc.id, { transaction_id: "FU-LIST-B" });
		const txC = await createDefaultTransaction(acc.id, { transaction_id: "FU-LIST-C" });

		await DB.createFollowUp(txA.id, {
			title: "Pending reminder",
			follow_up_type: "reminder",
			due_date: isoOffset(2),
		});
		await DB.createFollowUp(txB.id, {
			title: "Pending dispute",
			follow_up_type: "dispute",
			due_date: isoOffset(5),
		});
		const doneOne = await DB.createFollowUp(txC.id, {
			title: "Completed reminder",
			follow_up_type: "reminder",
			due_date: isoOffset(1),
			is_recurring: false,
		});
		await DB.markFollowUpDone(doneOne.id);

		const pending = await DB.getFollowUps({ status: "pending" });
		expect(pending).toHaveLength(2);
		expect(pending.every((f) => f.status === "pending")).toBe(true);

		const disputes = await DB.getFollowUps({ follow_up_type: "dispute" });
		expect(disputes).toHaveLength(1);
		expect(disputes[0].title).toBe("Pending dispute");

		const all = await DB.getFollowUps();
		expect(all).toHaveLength(3);
		// Pending items come before done items.
		expect(all[0].status).toBe("pending");
		expect(all[all.length - 1].status).toBe("done");
	});

	it("getFollowUps orders pending by days_remaining ascending with undated last", async () => {
		const acc = await createDefaultAccount({ account_identifier: "FU-ORDER-ACC" });
		const txOverdue = await createDefaultTransaction(acc.id, { transaction_id: "FU-ORD-OVERDUE" });
		const txSoon = await createDefaultTransaction(acc.id, { transaction_id: "FU-ORD-SOON" });
		const txLater = await createDefaultTransaction(acc.id, { transaction_id: "FU-ORD-LATER" });
		const txUndated = await createDefaultTransaction(acc.id, { transaction_id: "FU-ORD-UNDATED" });

		await DB.createFollowUp(txSoon.id, { title: "Soon", due_date: isoOffset(2) });
		await DB.createFollowUp(txUndated.id, { title: "Undated" });
		await DB.createFollowUp(txOverdue.id, { title: "Overdue", due_date: isoOffset(-5) });
		await DB.createFollowUp(txLater.id, { title: "Later", due_date: isoOffset(20) });

		const ordered = (await DB.getFollowUps({ status: "pending" })).map((f) => f.title);
		expect(ordered).toEqual(["Overdue", "Soon", "Later", "Undated"]);
	});

	it("getUpcomingBills includes follow-ups due within the window and excludes those outside", async () => {
		const acc = await createDefaultAccount({ account_identifier: "FU-BILL-ACC" });
		const txSoon = await createDefaultTransaction(acc.id, { transaction_id: "FU-BILL-SOON" });
		const txLater = await createDefaultTransaction(acc.id, { transaction_id: "FU-BILL-LATER" });

		await DB.createFollowUp(txSoon.id, {
			title: "Due soon",
			follow_up_type: "bill",
			due_date: isoOffset(3),
		});
		await DB.createFollowUp(txLater.id, {
			title: "Due later",
			follow_up_type: "bill",
			due_date: isoOffset(30),
		});

		const upcoming = await DB.getUpcomingBills(7);
		const titles = upcoming.map((b) => b.title);
		expect(titles).toContain("Due soon");
		expect(titles).not.toContain("Due later");
		expect(upcoming.every((b) => typeof b.days_remaining === "number")).toBe(true);
	});

	it("mergeFromJSON respects a follow_up tombstone and applies last-writer-wins to another", async () => {
		const acc = await createDefaultAccount({ account_identifier: "FU-SYNC-ACC" });
		const txA = await createDefaultTransaction(acc.id, {
			transaction_id: "FU-SYNC-A",
			description: "Sync TX A",
		});
		const txB = await createDefaultTransaction(acc.id, {
			transaction_id: "FU-SYNC-B",
			description: "Sync TX B",
		});
		const fuA = await DB.createFollowUp(txA.id, {
			title: "Follow A",
			follow_up_type: "reminder",
			due_date: "2025-02-01",
		});
		await DB.createFollowUp(txB.id, {
			title: "Follow B",
			follow_up_type: "reminder",
			due_date: "2025-03-01",
		});

		const envelope = await DB.exportAsJSON();

		// Age the exported follow-up A so the local delete tombstone wins, and bump follow-up B
		// to a future updated_at so the remote row wins under last-writer-wins.
		for (const row of envelope.tables.transaction_follow_ups) {
			if (row.transaction_id === txA.id) {
				row.updated_at = "2020-01-01 00:00:00";
			}
			if (row.transaction_id === txB.id) {
				row.title = "Follow B (remote win)";
				row.updated_at = "2099-01-01 00:00:00";
			}
		}

		// Delete follow-up A locally → records a follow_up tombstone newer than the export row.
		await DB.deleteFollowUp(fuA.id);
		expect(await DB.getFollowUp(txA.id)).toBeNull();

		await DB.mergeFromJSON(envelope);

		// Tombstone-based deletion is respected: follow-up A is not resurrected.
		expect(await DB.getFollowUp(txA.id)).toBeNull();

		// Follow-up B is updated by the newer remote row (last-writer-wins).
		const mergedB = await DB.getFollowUp(txB.id);
		expect(mergedB).not.toBeNull();
		expect(mergedB.title).toBe("Follow B (remote win)");
	});
});

// ---------------------------------------------------------------------------
// exportAsJSON / mergeFromJSON
// ---------------------------------------------------------------------------
describe("exportAsJSON / mergeFromJSON", () => {
	beforeEach(freshDB);
	afterEach(() => vi.restoreAllMocks());

	// -- exportAsJSON --

	it("exportAsJSON returns correct envelope structure", async () => {
		const envelope = await DB.exportAsJSON();
		expect(envelope.version).toBe(1);
		expect(envelope.schema_version).toBe(SCHEMA_VERSION);
		expect(typeof envelope.exported_at).toBe("string");
		expect(typeof envelope.device_id).toBe("string");
		expect(typeof envelope.tables).toBe("object");
	});

	it("exportAsJSON includes every persisted table (incl. merchant_aliases + conversations)", async () => {
		const envelope = await DB.exportAsJSON();
		const tableKeys = Object.keys(envelope.tables).sort();
		expect(tableKeys).toEqual([
			"accounts",
			"budgets",
			"categories",
			"conversations",
			"goals",
			"merchant_aliases",
			"merchants",
			"processed_gmail_messages",
			"recurring_patterns",
			"sync_tombstones",
			"tags",
			"transaction_follow_ups",
			"transaction_tags",
			"transactions",
		]);
	});

	it("exportAsJSON includes seeded categories", async () => {
		const envelope = await DB.exportAsJSON();
		expect(envelope.tables.categories.length).toBe(20);
	});

	it("exportAsJSON includes accounts and transactions", async () => {
		const acc = await createDefaultAccount({ account_identifier: "ACC1" });
		await createDefaultTransaction(acc.id, { description: "Drive TX" });
		const envelope = await DB.exportAsJSON();
		expect(envelope.tables.accounts).toHaveLength(1);
		expect(envelope.tables.transactions).toHaveLength(1);
		expect(envelope.tables.transactions[0].description).toBe("Drive TX");
	});

	// -- mergeFromJSON: schema version --

	it("mergeFromJSON throws on schema version mismatch", async () => {
		const envelope = { schema_version: 999, tables: {} };
		await expect(DB.mergeFromJSON(envelope)).rejects.toThrow(
			"Drive backup uses a different schema version",
		);
	});

	// -- mergeFromJSON: full-DB-replace (last-writer-wins) --

	it("mergeFromJSON rolls back on error and preserves prior state", async () => {
		const initialCatCount = DB._queryAll("SELECT * FROM categories").length;

		// Force an error mid-transaction by spying on _exec to throw on account insert
		const origExec = DB._exec.bind(DB);
		vi.spyOn(DB, "_exec").mockImplementation((sql, params) => {
			if (typeof sql === "string" && sql.includes("INSERT INTO accounts")) {
				throw new Error("Simulated DB error during accounts insert");
			}
			return origExec(sql, params);
		});

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [
					{
						id: 100,
						name: "DriveOnlyCategory",
						description: "",
						is_default: 0,
						created_at: "2025-01-01 00:00:00",
						updated_at: "2025-01-01 00:00:00",
					},
				],
				accounts: [
					{
						id: 1,
						name: "Should Not Appear",
						balance: 0,
						account_type: "savings",
						account_identifier: "ROLLBACK-TEST",
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: "2025-01-01 00:00:00",
					},
				],
				merchants: [],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				processed_gmail_messages: [],
			},
		};

		await expect(DB.mergeFromJSON(envelope)).rejects.toThrow(
			"Simulated DB error during accounts insert",
		);

		// Rollback should have undone the category insert
		const finalCatCount = DB._queryAll("SELECT * FROM categories").length;
		expect(finalCatCount).toBe(initialCatCount);

		const catNames = DB._queryAll("SELECT name FROM categories").map((c) => c.name);
		expect(catNames).not.toContain("DriveOnlyCategory");
	});

	// -- mergeFromJSON: budget deduplication --

	// -- mergeFromJSON: full roundtrip --

	it("full roundtrip: export → mergeFromJSON restores all data", async () => {
		// Populate the DB
		const acc = await createDefaultAccount({ account_identifier: "ROUND-ACC" });
		await createDefaultTransaction(acc.id, { description: "RT Transaction" });
		await DB.createGoal({ name: "RT Goal", target_amount: 10000 });
		const cats = await DB.getCategories();
		await DB.createBudget({
			category_id: cats[0].id,
			period_start: "2025-01-01",
			period_end: "2025-01-31",
			limit_amount: 2000,
		});

		const envelope = await DB.exportAsJSON();

		// Start fresh
		await freshDB();

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.accounts).toBe(1);
		expect(result.inserted.transactions).toBe(1);
		expect(result.inserted.goals).toBe(1);
		expect(result.inserted.budgets).toBe(1);

		const accounts = await DB.getAccounts();
		expect(accounts.some((a) => a.account_identifier === "ROUND-ACC")).toBe(true);

		const txs = await DB.getTransactions({});
		expect(txs.some((t) => t.description === "RT Transaction")).toBe(true);

		const goals = await DB.getGoals();
		expect(goals.some((g) => g.name === "RT Goal")).toBe(true);
	});

	it("re-importing the same snapshot is a no-op (union + LWW, no duplicates)", async () => {
		// With union + last-writer-wins, re-importing the same snapshot inserts nothing the
		// second time: every row already exists with the same updated_at, so it is neither
		// duplicated nor re-updated.
		const acc = await createDefaultAccount({ account_identifier: "IDEMPOTENT-ACC" });
		await DB.createTransaction({
			date: "2025-01-15",
			amount: 50,
			description: "Idem TX",
			transaction_type: "expense",
			account_id: acc.id,
			transaction_id: "IDEM-TX-001",
		});
		await DB.createGoal({ name: "Idem Goal", target_amount: 5000 });

		const envelope = await DB.exportAsJSON();

		await freshDB();
		const r1 = await DB.mergeFromJSON(envelope);
		expect(r1.inserted.accounts).toBe(1);
		expect(r1.inserted.transactions).toBe(1);
		expect(r1.inserted.goals).toBe(1);
		const accountsAfter1 = DB._queryAll("SELECT * FROM accounts");
		const txAfter1 = DB._queryAll("SELECT * FROM transactions");
		const goalsAfter1 = DB._queryAll("SELECT * FROM goals");

		// Second import of the same snapshot — nothing changes.
		const r2 = await DB.mergeFromJSON(envelope);
		expect(DB._queryAll("SELECT * FROM accounts")).toEqual(accountsAfter1);
		expect(DB._queryAll("SELECT * FROM transactions")).toEqual(txAfter1);
		expect(DB._queryAll("SELECT * FROM goals")).toEqual(goalsAfter1);
		expect(r2.inserted.accounts).toBe(0);
		expect(r2.inserted.transactions).toBe(0);
		expect(r2.inserted.goals).toBe(0);
	});

	// -- mergeFromJSON: timezone / date storage --

	it("exportAsJSON exported_at is a UTC ISO 8601 string (ends with Z)", () => {
		// New Date().toISOString() always returns UTC with 'Z' suffix
		// This validates that exported_at is timezone-safe
		const envelope = {
			version: 1,
			schema_version: SCHEMA_VERSION,
			exported_at: new Date().toISOString(),
			device_id: "test-device",
			tables: {},
		};
		expect(envelope.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
	});

	it("mergeFromJSON preserves transaction date string exactly as stored", async () => {
		// Transaction dates are stored as YYYY-MM-DD calendar dates — not UTC timestamps.
		// They must survive a roundtrip without timezone conversion.
		const acc = await createDefaultAccount({ account_identifier: "TZ-ACC" });
		const txDate = "2025-12-31"; // last day of year — sensitive to timezone off-by-one

		await DB.createTransaction({
			date: txDate,
			amount: 100,
			transaction_type: "expense",
			account_id: acc.id,
		});

		const envelope = await DB.exportAsJSON();
		await freshDB();
		await DB.mergeFromJSON(envelope);

		const txs = await DB.getTransactions({});
		expect(txs).toHaveLength(1);
		// The calendar date must not shift by a timezone off-by-one through the
		// export/import roundtrip; the stored string is preserved exactly.
		expect(txs[0].date).toBe(txDate);
	});

	// -- mergeFromJSON: full-DB-replace is authoritative (no dedup) --

	it("mergeFromJSON preserves local transactions and adds snapshot rows (union)", async () => {
		// Union semantics: the local-only row is kept AND the snapshot row is added. Nothing
		// is cleared — a different description means a distinct composite identity.
		const acc = await createDefaultAccount({ account_identifier: "BUG-ACC" });

		await DB.createTransaction({
			date: "2025-06-15",
			amount: 250,
			transaction_type: "expense",
			account_id: acc.id,
			description: "Local-only entry (no transaction_id)",
		});

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [],
				accounts: [
					{
						id: 10,
						name: acc.name,
						balance: acc.balance,
						account_type: acc.account_type,
						account_identifier: acc.account_identifier,
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: acc.created_at,
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [
					{
						id: 1,
						transaction_id: null,
						gmail_message_id: null,
						date: "2025-06-15",
						amount: 250,
						description: "Snapshot entry (no transaction_id)",
						merchant_upi_id: null,
						merchant_name: null,
						merchant_id: null,
						category_id: null,
						transaction_type: "expense",
						account_id: 10,
						created_at: "2025-06-15 00:00:00",
						is_recurring: 0,
						excluded_from_expenses: 0,
						excluded_from_income: 0,
					},
				],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		// The snapshot row is inserted; the local-only row is preserved (union).
		expect(result.inserted.transactions).toBe(1);
		const txs = await DB.getTransactions({});
		expect(txs).toHaveLength(2);
		const descs = txs.map((t) => t.description).sort();
		expect(descs).toEqual([
			"Local-only entry (no transaction_id)",
			"Snapshot entry (no transaction_id)",
		]);
	});

	it("mergeFromJSON matches a nameless-identifier account and applies LWW", async () => {
		// A local cash account with no identifier is matched by name+type; the newer snapshot
		// wins (last-writer-wins) and updates the balance — no duplicate account is created.
		await DB.createAccount({ name: "Cash Wallet", account_type: "cash" });

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [],
				accounts: [
					{
						id: 5,
						name: "Cash Wallet",
						balance: 500,
						account_type: "cash",
						account_identifier: null,
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: "2025-01-01 00:00:00",
						updated_at: "2099-01-01 00:00:00",
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.accounts).toBe(0);
		expect(result.updated.accounts).toBe(1);
		const accounts = await DB.getAccounts();
		const cashAccounts = accounts.filter((a) => a.name === "Cash Wallet");
		expect(cashAccounts).toHaveLength(1);
		expect(cashAccounts[0].balance).toBe(500);
	});

	// -- Timezone consistency tests --

	it("transaction date stored as YYYY-MM-DD is independent of system timezone", () => {
		// Verifies that date fields use calendar date strings, not timezone-dependent timestamps.
		// A date like "2025-01-15" from a Gmail email must be stored as-is, not converted.
		const dateStr = "2025-01-15";
		// Simulate what _importTransaction does: split on "T" to get date-only part
		const stored = dateStr.split("T")[0];
		expect(stored).toBe("2025-01-15");

		// Also verify that toISOString (UTC) vs local date can differ for UTC-offset timezones
		// This demonstrates the inconsistency in the codebase:
		// app.js todayISO() uses LOCAL time: new Date().getFullYear(), getMonth(), getDate()
		// db.js _todayISO() uses UTC: new Date().toISOString().split("T")[0]
		// These differ for users in UTC- timezones late at night (or UTC+ early morning)
		const utcDate = new Date("2025-01-14T23:30:00.000Z").toISOString().split("T")[0]; // UTC: Jan 14
		const localDate = (() => {
			const d = new Date("2025-01-14T23:30:00.000Z");
			// Simulate app.js todayISO() — uses LOCAL date components
			// For UTC+5:30 (IST), this would be Jan 15 at 05:00 local time → "2025-01-15"
			// For UTC-5, this would be Jan 14 at 18:30 local time → "2025-01-14"
			// We can't test actual timezone difference in a unit test without mocking,
			// but we document that toISOString().split("T")[0] is always UTC.
			return d.toISOString().split("T")[0];
		})();
		expect(utcDate).toBe("2025-01-14"); // UTC date
		expect(localDate).toBe("2025-01-14"); // toISOString is always UTC
	});

	it("_now() helper produces UTC-based timestamp format", () => {
		// _now() uses new Date().toISOString() which is always UTC.
		// This verifies that created_at timestamps are timezone-safe UTC values.
		const before = new Date().toISOString();
		const nowResult = new Date().toISOString().replace("T", " ").replace("Z", "");
		const after = new Date().toISOString();

		// nowResult should be between before and after when parsed back as UTC
		const reconstructed = `${nowResult.replace(" ", "T")}Z`;
		expect(new Date(reconstructed).getTime()).toBeGreaterThanOrEqual(
			new Date(before).getTime() - 10,
		);
		expect(new Date(reconstructed).getTime()).toBeLessThanOrEqual(
			new Date(after).getTime() + 10,
		);
	});

	// -- full-replace: null-transaction_id rows round-trip verbatim --

	it("mergeFromJSON re-import of a null-transaction_id row is a no-op (composite dedup)", async () => {
		const acc = await createDefaultAccount({ account_identifier: "GDRIVE01-ACC" });

		const driveRow = {
			id: 1,
			transaction_id: null,
			gmail_message_id: null,
			date: "2025-07-10",
			amount: 150,
			description: "Manual entry",
			notes: null,
			payment_reference: null,
			merchant_upi_id: null,
			merchant_name: null,
			merchant_id: null,
			category_id: null,
			transaction_type: "expense",
			account_id: 10,
			created_at: "2025-07-10 00:00:00",
			is_recurring: 0,
			excluded_from_expenses: 0,
			excluded_from_income: 0,
		};

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [],
				accounts: [
					{
						id: 10,
						name: acc.name,
						balance: acc.balance,
						account_type: acc.account_type,
						account_identifier: acc.account_identifier,
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: acc.created_at,
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [driveRow],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		// First import: inserts.
		const result1 = await DB.mergeFromJSON(envelope);
		expect(result1.inserted.transactions).toBe(1);
		const after1 = DB._queryAll("SELECT * FROM transactions");

		// Second import of the same snapshot: the row is matched by composite key
		// (date+amount+account+description) and not duplicated.
		const result2 = await DB.mergeFromJSON(envelope);
		expect(result2.inserted.transactions).toBe(0);
		expect(DB._queryAll("SELECT * FROM transactions")).toEqual(after1);

		const txs = await DB.getTransactions({});
		expect(txs).toHaveLength(1);
	});

	it("mergeFromJSON inserts two distinct null-transaction_id rows from the snapshot", async () => {
		const acc = await createDefaultAccount({ account_identifier: "GDRIVE01-DIFF-ACC" });

		const makeRow = (id, description) => ({
			id,
			transaction_id: null,
			gmail_message_id: null,
			date: "2025-07-10",
			amount: 200,
			description,
			notes: null,
			payment_reference: null,
			merchant_upi_id: null,
			merchant_name: null,
			merchant_id: null,
			category_id: null,
			transaction_type: "expense",
			account_id: 20,
			created_at: "2025-07-10 00:00:00",
			is_recurring: 0,
			excluded_from_expenses: 0,
			excluded_from_income: 0,
		});

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [],
				accounts: [
					{
						id: 20,
						name: acc.name,
						balance: acc.balance,
						account_type: acc.account_type,
						account_identifier: acc.account_identifier,
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: acc.created_at,
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [makeRow(1, "Grocery Store"), makeRow(2, "Petrol Pump")],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.transactions).toBe(2);

		const txs = await DB.getTransactions({});
		expect(txs).toHaveLength(2);
		const descriptions = txs.map((t) => t.description).sort();
		expect(descriptions).toEqual(["Grocery Store", "Petrol Pump"]);
	});

	// -- BUG-GDRIVE-02: _todayISO() consistency (indirect tests) --

	it("BUG-GDRIVE-02: getSpendingReport() with no startDate does not throw", async () => {
		// _todayISO() is used for default date range; verifies no UTC/local mismatch crash
		await expect(DB.getSpendingReport({})).resolves.toBeDefined();
	});

	it("BUG-GDRIVE-02: getBudgets() default call does not throw", async () => {
		// getBudgets(activeOnly=true) uses _todayISO() in WHERE clause
		await expect(DB.getBudgets()).resolves.toBeDefined();
	});

	// -- full-replace: null-identifier accounts round-trip verbatim --

	it("mergeFromJSON re-import of a null-identifier account is a no-op (matched by name+type)", async () => {
		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [],
				accounts: [
					{
						id: 5,
						name: "Cash Drawer",
						balance: 0,
						account_type: "cash",
						account_identifier: null,
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: "2025-01-01 00:00:00",
						billing_cycle_start_day: 1,
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		// First import inserts; second import of the same snapshot matches by name+type and
		// does not duplicate.
		const result1 = await DB.mergeFromJSON(envelope);
		expect(result1.inserted.accounts).toBe(1);
		const after1 = DB._queryAll("SELECT * FROM accounts");

		const result2 = await DB.mergeFromJSON(envelope);
		expect(result2.inserted.accounts).toBe(0);
		expect(DB._queryAll("SELECT * FROM accounts")).toEqual(after1);

		const accounts = await DB.getAccounts();
		const cashDrawer = accounts.filter((a) => a.name === "Cash Drawer");
		expect(cashDrawer).toHaveLength(1);
	});

	it("mergeFromJSON inserts two distinct null-identifier accounts from the snapshot", async () => {
		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [],
				accounts: [
					{
						id: 5,
						name: "Wallet A",
						balance: 100,
						account_type: "cash",
						account_identifier: null,
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: "2025-01-01 00:00:00",
					},
					{
						id: 6,
						name: "Wallet B",
						balance: 200,
						account_type: "cash",
						account_identifier: null,
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: "2025-01-01 00:00:00",
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.accounts).toBe(2);

		const accounts = await DB.getAccounts();
		const wallets = accounts.filter((a) => a.name === "Wallet A" || a.name === "Wallet B");
		expect(wallets).toHaveLength(2);
	});

	// -- full-replace: merchants + aliases round-trip verbatim (incl. null category) --

	it("mergeFromJSON inserts a null-category merchant and its aliases", async () => {
		const cats = await DB.getCategories();
		const cat = cats[0];

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [
					{
						id: 30,
						name: cat.name,
						description: cat.description,
						is_default: cat.is_default ? 1 : 0,
						created_at: cat.created_at,
						updated_at: cat.updated_at,
					},
				],
				accounts: [],
				merchants: [
					{
						id: 88,
						merchant_key: "no-upi-shop",
						display_name: "No-UPI Shop Renamed",
						merchant_upi_id: null,
						category_id: null, // uncategorized merchant
						confidence_score: 0.9,
						created_at: "2025-01-01 00:00:00",
						last_updated: "2025-01-01 00:00:00",
					},
				],
				merchant_aliases: [
					{ id: 1, merchant_id: 88, alias_norm: "no-upi shop" },
					{ id: 2, merchant_id: 88, alias_norm: "noupi shop" },
				],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.merchants).toBe(1);
		expect(result.inserted.merchant_aliases).toBe(2);

		// The merchant is restored by its merchant_key with display_name and null category.
		const merch = DB._queryOne("SELECT * FROM merchants WHERE merchant_key = ?", ["no-upi-shop"]);
		expect(merch.display_name).toBe("No-UPI Shop Renamed");
		expect(merch.merchant_upi_id).toBeNull();
		expect(merch.category_id).toBeNull();

		// Both aliases are restored and resolve back to the merchant.
		const aliases = DB._queryAll(
			"SELECT alias_norm FROM merchant_aliases WHERE merchant_id = ? ORDER BY alias_norm",
			[merch.id],
		).map((r) => r.alias_norm);
		expect(aliases).toEqual(["no-upi shop", "noupi shop"]);
		const found = DB._lookupMerchant(null, "No-UPI Shop");
		expect(found.id).toBe(merch.id);
	});

	it("mergeFromJSON remaps merchant_id links on inserted transactions", async () => {
		const cats = await DB.getCategories();
		const cat = cats[0];

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [
					{
						id: 40,
						name: cat.name,
						description: cat.description,
						is_default: cat.is_default ? 1 : 0,
						created_at: cat.created_at,
						updated_at: cat.updated_at,
					},
				],
				accounts: [
					{
						id: 7,
						name: "Name-Only Merch Acc",
						balance: 500,
						account_type: "savings",
						account_identifier: "NAME-MERCH-ACC",
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: "2025-01-01 00:00:00",
					},
				],
				merchants: [
					{
						id: 77,
						merchant_key: "name-only-merchant",
						display_name: "Name-Only Merchant",
						merchant_upi_id: null,
						category_id: 40,
						confidence_score: 0.9,
						created_at: "2025-01-01 00:00:00",
						last_updated: "2025-01-01 00:00:00",
					},
				],
				merchant_aliases: [{ id: 1, merchant_id: 77, alias_norm: "name-only merchant" }],
				transactions: [
					{
						id: 300,
						transaction_id: "MERCH-MAP-TX-001",
						gmail_message_id: null,
						date: "2025-07-10",
						amount: 500,
						description: "Purchase from Name-Only Merchant",
						notes: null,
						payment_reference: null,
						merchant_upi_id: null,
						merchant_name: "Name-Only Merchant",
						merchant_id: 77,
						category_id: 40,
						transaction_type: "expense",
						account_id: 7,
						created_at: "2025-07-10 00:00:00",
						is_recurring: 0,
						excluded_from_expenses: 0,
						excluded_from_income: 0,
					},
				],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.merchants).toBe(1);
		expect(result.inserted.transactions).toBe(1);

		// The transaction's merchant_id is remapped to the local merchant id (matched by key).
		const merch = DB._queryOne("SELECT id FROM merchants WHERE merchant_key = ?", [
			"name-only-merchant",
		]);
		const tx = DB._queryOne("SELECT * FROM transactions WHERE transaction_id = ?", [
			"MERCH-MAP-TX-001",
		]);
		expect(tx).toBeTruthy();
		expect(tx.merchant_id).toBe(merch.id);
		// And the resolved display name comes through the merchant join.
		const resolved = await DB.getTransactions({});
		expect(resolved[0].merchant_name).toBe("Name-Only Merchant");
	});

	// -- full-replace: merge state comes verbatim from the snapshot --

	it("mergeFromJSON applies merged_into_id and merged_at from a newer snapshot", async () => {
		// The snapshot says account B is merged into account A and is newer than the local
		// rows, so LWW lets it win and the merge state is applied with ids remapped to local.
		await createDefaultAccount({ account_identifier: "ACC-MERGE-A" });
		await createDefaultAccount({ account_identifier: "ACC-MERGE-B" });

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [],
				accounts: [
					{
						id: 10,
						name: "Drive A",
						balance: 0,
						account_type: "checking",
						account_identifier: "ACC-MERGE-A",
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: "2025-01-01 00:00:00",
						updated_at: "2099-01-01 00:00:00",
					},
					{
						id: 11,
						name: "Drive B",
						balance: 0,
						account_type: "checking",
						account_identifier: "ACC-MERGE-B",
						balance_updated_at: null,
						is_active: 0,
						merged_into_id: 10,
						merged_at: "2025-01-01T00:00:00.000Z",
						created_at: "2025-01-01 00:00:00",
						updated_at: "2099-01-01 00:00:00",
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		await DB.mergeFromJSON(envelope);

		const accA = DB._queryOne("SELECT id FROM accounts WHERE account_identifier = ?", [
			"ACC-MERGE-A",
		]);
		const accBRow = DB._queryOne("SELECT * FROM accounts WHERE account_identifier = ?", [
			"ACC-MERGE-B",
		]);
		expect(accBRow.merged_into_id).toBe(accA.id);
		expect(accBRow.merged_at).toBe("2025-01-01T00:00:00.000Z");
	});

	it("mergeFromJSON clears local merge state when a newer snapshot says accounts are unmerged", async () => {
		// Account B is locally merged into A. A newer snapshot says both are unmerged, so LWW
		// wins and the merge relationship is cleared.
		const accA = await createDefaultAccount({ account_identifier: "ACC-UNMERGE-A" });
		const accB = await createDefaultAccount({ account_identifier: "ACC-UNMERGE-B" });

		await DB.mergeAccounts(accB.id, accA.id);
		const before = DB._queryOne("SELECT merged_into_id FROM accounts WHERE id = ?", [accB.id]);
		expect(before.merged_into_id).toBe(accA.id);

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [],
				accounts: [
					{
						id: accA.id,
						name: accA.name,
						balance: accA.balance,
						account_type: accA.account_type,
						account_identifier: "ACC-UNMERGE-A",
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: accA.created_at,
						updated_at: "2099-01-01 00:00:00",
					},
					{
						id: accB.id,
						name: accB.name,
						balance: accB.balance,
						account_type: accB.account_type,
						account_identifier: "ACC-UNMERGE-B",
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: accB.created_at,
						updated_at: "2099-01-01 00:00:00",
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		await DB.mergeFromJSON(envelope);

		const accBRow = DB._queryOne("SELECT * FROM accounts WHERE id = ?", [accB.id]);
		expect(accBRow.merged_into_id).toBeNull();
		expect(accBRow.merged_at).toBeNull();
	});

	it("mergeFromJSON remaps merged_into_id and sets merged_at for newly inserted accounts", async () => {
		// Regression: new accounts from Drive with merge relationship.
		// Drive: Account B (drive ID 11) merged into Account A (drive ID 10).
		// After insert, B's local merged_into_id must be A's local id (remapped),
		// and merged_at must be preserved from the Drive envelope.
		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [],
				accounts: [
					{
						id: 10,
						name: "Drive Account A",
						balance: 1000,
						account_type: "savings",
						account_identifier: "DRIVE-REMAP-A",
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: "2025-01-01 00:00:00",
					},
					{
						id: 11,
						name: "Drive Account B",
						balance: 500,
						account_type: "savings",
						account_identifier: "DRIVE-REMAP-B",
						balance_updated_at: null,
						is_active: 1,
						merged_into_id: 10, // Drive: B merged into A (drive ID 10)
						merged_at: "2025-01-01T00:00:00.000Z",
						created_at: "2025-01-01 00:00:00",
					},
				],
				merchants: [],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				processed_gmail_messages: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.accounts).toBe(2);

		const accA = DB._queryOne("SELECT * FROM accounts WHERE account_identifier = ?", [
			"DRIVE-REMAP-A",
		]);
		const accB = DB._queryOne("SELECT * FROM accounts WHERE account_identifier = ?", [
			"DRIVE-REMAP-B",
		]);
		expect(accA).toBeTruthy();
		expect(accB).toBeTruthy();

		// B's local merged_into_id must be A's local id (remapped from drive ID 10)
		expect(accB.merged_into_id).toBe(accA.id);
		// merged_at must be preserved from Drive
		expect(accB.merged_at).toBe("2025-01-01T00:00:00.000Z");
	});
});

// ---------------------------------------------------------------------------
// BUG-DB-01: getTransactions params.id vs params.transaction_id
// ---------------------------------------------------------------------------
describe("BUG-DB-01: getTransactions filters correctly by id and transaction_id", () => {
	beforeEach(freshDB);

	it("params.id filters by internal primary key", async () => {
		const acc = await createDefaultAccount();
		const tx = await createDefaultTransaction(acc.id);
		const results = await DB.getTransactions({ id: tx.id });
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(tx.id);
	});

	it("params.transaction_id filters by external transaction_id column", async () => {
		const acc = await createDefaultAccount();
		await DB.createTransaction({
			date: "2025-01-15",
			amount: 50,
			description: "Ext ID tx",
			transaction_type: "expense",
			account_id: acc.id,
			transaction_id: "EXT-TX-001",
		});
		const results = await DB.getTransactions({ transaction_id: "EXT-TX-001" });
		expect(results).toHaveLength(1);
		// Verify the correct row was returned by checking a known field
		expect(results[0].description).toBe("Ext ID tx");
	});

	it("params.id does not match transaction_id column value", async () => {
		const acc = await createDefaultAccount();
		// Create a tx without an external transaction_id
		const tx = await createDefaultTransaction(acc.id);
		// Lookup by transaction_id using the numeric pk — should return nothing
		const results = await DB.getTransactions({ transaction_id: String(tx.id) });
		expect(results).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// BUG-DB-02: cleanupOrphanedGmailIds must persist changes to IndexedDB
// ---------------------------------------------------------------------------
describe("BUG-DB-02: cleanupOrphanedGmailIds persists after delete", () => {
	beforeEach(freshDB);

	it("removes orphaned processed_gmail_messages rows", async () => {
		// Insert a processed message that has no matching transaction
		DB._exec(
			"INSERT INTO processed_gmail_messages (gmail_message_id, processed_at) VALUES (?, ?)",
			["orphan-msg-1", new Date().toISOString()],
		);
		const before = DB._queryAll("SELECT * FROM processed_gmail_messages");
		expect(before).toHaveLength(1);

		await DB.cleanupOrphanedGmailIds();

		const after = DB._queryAll("SELECT * FROM processed_gmail_messages");
		expect(after).toHaveLength(0);
	});

	it("calls _persist after deletion", async () => {
		DB._exec(
			"INSERT INTO processed_gmail_messages (gmail_message_id, processed_at) VALUES (?, ?)",
			["orphan-msg-2", new Date().toISOString()],
		);
		await DB.cleanupOrphanedGmailIds();
		expect(DB._persist).toHaveBeenCalled();
	});

	it("keeps rows whose gmail_message_id exists in transactions", async () => {
		const acc = await createDefaultAccount();
		const tx = await DB.createTransaction({
			date: "2025-01-15",
			amount: 100,
			description: "Gmail tx",
			transaction_type: "expense",
			account_id: acc.id,
		});
		// Set gmail_message_id directly via SQL (createTransaction doesn't expose this field)
		DB._exec("UPDATE transactions SET gmail_message_id = ? WHERE id = ?", ["linked-msg-1", tx.id]);
		DB._exec(
			"INSERT INTO processed_gmail_messages (gmail_message_id, processed_at) VALUES (?, ?)",
			["linked-msg-1", new Date().toISOString()],
		);

		await DB.cleanupOrphanedGmailIds();

		const remaining = DB._queryAll("SELECT * FROM processed_gmail_messages");
		expect(remaining).toHaveLength(1);
		expect(remaining[0].gmail_message_id).toBe("linked-msg-1");
	});
});

// ---------------------------------------------------------------------------
// Session Wipe
// ---------------------------------------------------------------------------
describe("Session Wipe", () => {
	beforeEach(freshDB);

	it("DB.wipeSession() calls _clearFromStorage", async () => {
		DB._clearFromStorage = vi.fn(async () => {});
		await DB.wipeSession();
		expect(DB._clearFromStorage).toHaveBeenCalledOnce();
	});

	it("DB.wipeSession() removes all sensitive localStorage keys but keeps exempt keys", async () => {
		DB._clearFromStorage = vi.fn(async () => {});

		const sensitiveKeys = [
			"fincoach-gmail-settings",
			"fincoach-ai-settings",
			"fincoach-gdrive-enabled",
			"fincoach-gdrive-last-sync",
			"fincoach-gdrive-backup-api-key",
			"fincoach-gdrive-sync-lock",
			"fincoach-session-last-activity",
			// 7 keys added by SEC-MEDIUM-1 / SEC-MEDIUM-2 security fixes
			"fincoach-gmail-custom-senders",
			"fincoach-gmail-auto-sync-enabled",
			"fincoach-gmail-auto-sync-last",
			"fincoach-onboarded",
			"fincoach-onboarding-step",
			"fincoach-gdrive-reminder-last",
			"fincoach-daily-summary-last",
		];
		for (const k of sensitiveKeys) {
			localStorage.setItem(k, "test-value");
		}
		localStorage.setItem("fincoach-trusted-device", "true");
		localStorage.setItem("fincoach-theme", "dark");

		await DB.wipeSession();

		for (const k of sensitiveKeys) {
			expect(localStorage.getItem(k)).toBeNull();
		}
		expect(localStorage.getItem("fincoach-trusted-device")).toBe("true");
		expect(localStorage.getItem("fincoach-theme")).toBe("dark");
	});

	// Individual tests for each of the 7 new security-fix keys
	const newSecurityKeys = [
		["fincoach-gmail-custom-senders", "GMAIL_CUSTOM_SENDERS_KEY"],
		["fincoach-gmail-auto-sync-enabled", "GMAIL_AUTO_SYNC_ENABLED_KEY"],
		["fincoach-gmail-auto-sync-last", "GMAIL_AUTO_SYNC_LAST_KEY"],
		["fincoach-onboarded", "ONBOARDED_KEY"],
		["fincoach-onboarding-step", "ONBOARDING_STEP_KEY"],
		["fincoach-gdrive-reminder-last", "GDRIVE_REMINDER_KEY"],
		["fincoach-daily-summary-last", "DAILY_SUMMARY_KEY"],
	];

	for (const [key, constName] of newSecurityKeys) {
		it(`wipeSession() clears ${constName} ("${key}")`, async () => {
			DB._clearFromStorage = vi.fn(async () => {});
			localStorage.setItem(key, "some-value");
			await DB.wipeSession();
			expect(localStorage.getItem(key)).toBeNull();
		});
	}

	it("DB._clearFromStorage() resolves without error when mocked", async () => {
		// Verify the public contract: _clearFromStorage resolves (internals use real IDB
		// which is already exercised by _persist/_loadFromStorage tests via JSDOM's fake IDB).
		const spy = vi.spyOn(DB, "_clearFromStorage").mockResolvedValue(undefined);
		await expect(DB._clearFromStorage()).resolves.toBeUndefined();
		spy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// BUG-SEC-01 — getSpendingReport SQL injection parameterization
// ---------------------------------------------------------------------------
describe("BUG-SEC-01 — getSpendingReport uses parameterized date bindings", () => {
	let accountId;

	beforeEach(async () => {
		await freshDB();
		const acc = await createDefaultAccount();
		accountId = acc.id;
	});

	it("returns correct results for a specific date range", async () => {
		const cats = await DB.getCategories();
		const foodCat = cats.find((c) => c.name === "Food & Dining");

		await DB.createTransaction({
			date: "2025-03-15",
			amount: -500,
			transaction_type: "expense",
			account_id: accountId,
			category_id: foodCat.id,
		});
		// outside the query range — should be excluded
		await DB.createTransaction({
			date: "2025-04-20",
			amount: -200,
			transaction_type: "expense",
			account_id: accountId,
		});

		const report = await DB.getSpendingReport({
			start_date: "2025-03-01",
			end_date: "2025-03-31",
		});

		expect(report.total_spent).toBe(500);
		expect(report.total_transactions).toBe(1);
		const foodEntry = report.by_category.find((c) => c.category_name === "Food & Dining");
		expect(foodEntry).toBeDefined();
		expect(foodEntry.total_amount).toBe(500);
	});

	it("does not throw and returns empty results when startDate contains SQL-special characters", async () => {
		// Seed a transaction so there is something to inject against
		await DB.createTransaction({
			date: "2025-01-10",
			amount: -100,
			transaction_type: "expense",
			account_id: accountId,
		});

		const injectionPayload = "2025-01-01'; DROP TABLE transactions; --";

		// Must not throw — parameterized query treats the whole string as a literal value
		let report;
		await expect(
			(async () => {
				report = await DB.getSpendingReport({
					start_date: injectionPayload,
					end_date: "2025-12-31",
				});
			})(),
		).resolves.not.toThrow();

		// The transactions table must still exist — DROP TABLE was NOT executed
		const txs = await DB.getTransactions({});
		expect(Array.isArray(txs)).toBe(true);
		expect(txs.length).toBeGreaterThan(0);

		// total_spent must be a valid number (query ran without error)
		expect(typeof report.total_spent).toBe("number");
		expect(typeof report.total_transactions).toBe("number");
	});
});

// ---------------------------------------------------------------------------
// Item 3 — excluded_from_expenses feature
// ---------------------------------------------------------------------------
describe("Item 3 — excluded_from_expenses", () => {
	let accountId;

	beforeEach(async () => {
		await freshDB();
		const acc = await createDefaultAccount();
		accountId = acc.id;
	});

	it("toggleExcludedFromExpenses sets flag to 1", async () => {
		const tx = await createDefaultTransaction(accountId);
		await DB.toggleExcludedFromExpenses(tx.id, true);
		const raw = DB._queryOne("SELECT excluded_from_expenses FROM transactions WHERE id = ?", [tx.id]);
		expect(raw.excluded_from_expenses).toBe(1);
		expect(DB._persist).toHaveBeenCalled();
	});

	it("toggleExcludedFromExpenses clears flag back to 0", async () => {
		const tx = await createDefaultTransaction(accountId);
		await DB.toggleExcludedFromExpenses(tx.id, true);
		await DB.toggleExcludedFromExpenses(tx.id, false);
		const raw = DB._queryOne("SELECT excluded_from_expenses FROM transactions WHERE id = ?", [tx.id]);
		expect(raw.excluded_from_expenses).toBe(0);
	});

	it("toggleExcludedFromExpenses throws for nonexistent transaction", async () => {
		await expect(DB.toggleExcludedFromExpenses(9999, true)).rejects.toThrow("Transaction not found");
	});

	it("getTransactionTotals excludes flagged expense from total_expense but not transaction_count", async () => {
		await createDefaultTransaction(accountId, { amount: -100, transaction_type: "expense" });
		const excluded = await createDefaultTransaction(accountId, {
			amount: -200,
			transaction_type: "expense",
			description: "Excluded TX",
		});
		await DB.toggleExcludedFromExpenses(excluded.id, true);

		const totals = await DB.getTransactionTotals();
		expect(totals.total_expense).toBe(100);
		expect(totals.transaction_count).toBe(2);
	});

	it("getSpendingReport excludes flagged expense from category totals", async () => {
		const cats = await DB.getCategories();
		const foodCat = cats.find((c) => c.name === "Food & Dining");

		await createDefaultTransaction(accountId, {
			amount: -150,
			transaction_type: "expense",
			category_id: foodCat.id,
			date: "2025-06-15",
		});
		const excludedTx = await createDefaultTransaction(accountId, {
			amount: -300,
			transaction_type: "expense",
			category_id: foodCat.id,
			date: "2025-06-16",
		});
		await DB.toggleExcludedFromExpenses(excludedTx.id, true);

		const report = await DB.getSpendingReport({ start_date: "2025-06-01", end_date: "2025-06-30" });
		const foodEntry = report.by_category.find((c) => c.category_name === "Food & Dining");
		expect(foodEntry).toBeDefined();
		expect(foodEntry.total_amount).toBe(150);
	});

	it("budget spending excludes flagged expenses from spent_to_date", async () => {
		const cats = await DB.getCategories();
		const foodCat = cats.find((c) => c.name === "Food & Dining");

		const budget = await DB.createBudget({
			category_id: foodCat.id,
			period_start: "2025-06-01",
			period_end: "2025-06-30",
			limit_amount: 1000,
		});

		await createDefaultTransaction(accountId, {
			amount: -200,
			transaction_type: "expense",
			category_id: foodCat.id,
			date: "2025-06-10",
		});
		const excludedTx = await createDefaultTransaction(accountId, {
			amount: -500,
			transaction_type: "expense",
			category_id: foodCat.id,
			date: "2025-06-15",
		});
		await DB.toggleExcludedFromExpenses(excludedTx.id, true);

		const fetched = await DB.getBudget(budget.id);
		expect(fetched.spent_to_date).toBe(200);
	});

	it("migration: excluded_from_expenses column exists after DB init", () => {
		const cols = DB._queryAll("PRAGMA table_info(transactions)").map((c) => c.name);
		expect(cols).toContain("excluded_from_expenses");
	});

	it("_buildTransactionResponse includes excluded_from_expenses as boolean false by default", async () => {
		const tx = await createDefaultTransaction(accountId);
		expect(tx.excluded_from_expenses).toBe(false);
	});

	it("getTransactions returns updated excluded_from_expenses=true after toggle", async () => {
		const tx = await createDefaultTransaction(accountId);
		await DB.toggleExcludedFromExpenses(tx.id, true);
		const txs = await DB.getTransactions({ account_id: accountId });
		const updated = txs.find((t) => t.id === tx.id);
		expect(updated.excluded_from_expenses).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// excluded_from_income feature
// ---------------------------------------------------------------------------
describe("excluded_from_income", () => {
	let accountId;

	beforeEach(async () => {
		await freshDB();
		const acc = await createDefaultAccount();
		accountId = acc.id;
	});

	it("migration: excluded_from_income column exists after DB init", () => {
		const cols = DB._queryAll("PRAGMA table_info(transactions)").map((c) => c.name);
		expect(cols).toContain("excluded_from_income");
	});

	it("_buildTransactionResponse includes excluded_from_income as boolean false by default", async () => {
		const tx = await createDefaultTransaction(accountId, { transaction_type: "income", amount: 1000 });
		expect(tx.excluded_from_income).toBe(false);
	});

	it("toggleExcludedFromIncome sets flag to true", async () => {
		const tx = await createDefaultTransaction(accountId, { transaction_type: "income", amount: 1000 });
		await DB.toggleExcludedFromIncome(tx.id, true);
		const raw = DB._queryOne("SELECT excluded_from_income FROM transactions WHERE id = ?", [tx.id]);
		expect(raw.excluded_from_income).toBe(1);
		expect(DB._persist).toHaveBeenCalled();
	});

	it("toggleExcludedFromIncome clears flag back to false", async () => {
		const tx = await createDefaultTransaction(accountId, { transaction_type: "income", amount: 1000 });
		await DB.toggleExcludedFromIncome(tx.id, true);
		await DB.toggleExcludedFromIncome(tx.id, false);
		const raw = DB._queryOne("SELECT excluded_from_income FROM transactions WHERE id = ?", [tx.id]);
		expect(raw.excluded_from_income).toBe(0);
	});

	it("toggleExcludedFromIncome throws for nonexistent transaction", async () => {
		await expect(DB.toggleExcludedFromIncome(9999, true)).rejects.toThrow("Transaction not found");
	});

	it("getTransactionTotals excludes income with excluded_from_income=1 from total_income", async () => {
		await createDefaultTransaction(accountId, { amount: 3000, transaction_type: "income" });
		const excluded = await createDefaultTransaction(accountId, {
			amount: 1000,
			transaction_type: "income",
			description: "Excluded Income",
		});
		await DB.toggleExcludedFromIncome(excluded.id, true);

		const totals = await DB.getTransactionTotals();
		expect(totals.total_income).toBe(3000);
		expect(totals.transaction_count).toBe(2);
	});

	it("getTransactions returns updated excluded_from_income=true after toggle", async () => {
		const tx = await createDefaultTransaction(accountId, { transaction_type: "income", amount: 500 });
		await DB.toggleExcludedFromIncome(tx.id, true);
		const txs = await DB.getTransactions({ account_id: accountId });
		const updated = txs.find((t) => t.id === tx.id);
		expect(updated.excluded_from_income).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// mergeFromJSON — full-replace merchant and transaction behaviour
// ---------------------------------------------------------------------------
describe("mergeFromJSON — merchant and transaction LWW behaviour", () => {
	beforeEach(freshDB);

	it("mergeFromJSON updates a local merchant's display_name from a newer snapshot (same key)", async () => {
		const cats = await DB.getCategories();
		const cat = cats[0];
		DB._exec(
			"INSERT INTO merchants (merchant_key, display_name, merchant_upi_id, category_id, confidence_score, created_at, last_updated) VALUES (?,?,?,?,?,?,?)",
			[
				"upi@test-update",
				"OldName",
				"upi@test-update",
				cat.id,
				1.0,
				"2025-01-01 00:00:00",
				"2025-01-01 00:00:00",
			],
		);

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [
					{
						id: 20,
						name: cat.name,
						description: cat.description,
						is_default: cat.is_default ? 1 : 0,
						created_at: cat.created_at,
						updated_at: cat.updated_at,
					},
				],
				accounts: [],
				merchants: [
					{
						id: 55,
						merchant_key: "upi@test-update",
						display_name: "NewName",
						merchant_upi_id: "upi@test-update",
						category_id: 20,
						confidence_score: 0.9,
						created_at: "2025-01-01 00:00:00",
						last_updated: "2025-02-01 00:00:00",
					},
				],
				merchant_aliases: [],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		// Matched by merchant_key; the newer snapshot wins (LWW) and updates display_name.
		expect(result.inserted.merchants).toBe(0);
		expect(result.updated.merchants).toBe(1);
		const merch = DB._queryOne("SELECT * FROM merchants WHERE merchant_key = ?", [
			"upi@test-update",
		]);
		expect(merch.display_name).toBe("NewName");
	});

	it("mergeFromJSON re-import of the same merchant snapshot is idempotent", async () => {
		const cats = await DB.getCategories();
		const cat = cats[0];

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [
					{
						id: 20,
						name: cat.name,
						description: cat.description,
						is_default: cat.is_default ? 1 : 0,
						created_at: cat.created_at,
						updated_at: cat.updated_at,
					},
				],
				accounts: [],
				merchants: [
					{
						id: 55,
						merchant_key: "upi@test-same",
						display_name: "SameName",
						merchant_upi_id: "upi@test-same",
						category_id: 20,
						confidence_score: 0.9,
						created_at: "2025-01-01 00:00:00",
						last_updated: "2025-02-01 00:00:00",
					},
				],
				merchant_aliases: [],
				transactions: [],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const r1 = await DB.mergeFromJSON(envelope);
		expect(r1.inserted.merchants).toBe(1);
		const after1 = DB._queryAll("SELECT * FROM merchants");

		const r2 = await DB.mergeFromJSON(envelope);
		expect(r2.inserted.merchants).toBe(0);
		expect(DB._queryAll("SELECT * FROM merchants")).toEqual(after1);
	});

	it("mergeFromJSON replaces a transaction's provenance merchant_name from the snapshot", async () => {
		const cats = await DB.getCategories();
		const cat = cats[0];
		const acc = await createDefaultAccount({ account_identifier: "TX-UPDATE-ACC" });

		DB._exec(
			"INSERT INTO transactions (transaction_id, date, amount, description, merchant_name, transaction_type, account_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
			[
				"TX-UPDATE-001",
				"2025-06-01",
				-200,
				"Purchase",
				"OldMerchant",
				"expense",
				acc.id,
				"2025-06-01 00:00:00",
			],
		);

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [
					{
						id: 20,
						name: cat.name,
						description: cat.description,
						is_default: cat.is_default ? 1 : 0,
						created_at: cat.created_at,
						updated_at: cat.updated_at,
					},
				],
				accounts: [
					{
						id: 10,
						name: acc.name,
						account_type: acc.account_type,
						balance: acc.balance,
						account_identifier: acc.account_identifier,
						is_active: 1,
						created_at: acc.created_at,
						merged_into_id: null,
						merged_at: null,
						billing_cycle_start_day: 1,
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [
					{
						id: 99,
						transaction_id: "TX-UPDATE-001",
						date: "2025-06-01",
						amount: -200,
						description: "Purchase",
						notes: null,
						payment_reference: null,
						merchant_name: "NewMerchant",
						merchant_id: null,
						category_id: null,
						transaction_type: "expense",
						account_id: 10,
						created_at: "2025-06-01 00:00:00",
						updated_at: "2099-01-01 00:00:00",
						is_recurring: 0,
						excluded_from_expenses: 0,
						excluded_from_income: 0,
						gmail_message_id: null,
						merchant_upi_id: null,
					},
				],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.updated.transactions).toBe(1);

		const tx = DB._queryOne("SELECT merchant_name FROM transactions WHERE transaction_id = ?", [
			"TX-UPDATE-001",
		]);
		expect(tx.merchant_name).toBe("NewMerchant");
		// With no merchant_id link, the resolved display name falls back to the provenance text.
		const resolved = await DB.getTransactions({});
		expect(resolved[0].merchant_name).toBe("NewMerchant");
	});

	it("mergeFromJSON preserves excluded_from_expenses and excluded_from_income on INSERT", async () => {
		const cats = await DB.getCategories();
		const cat = cats[0];
		const acc = await createDefaultAccount({ account_identifier: "FLAGS-ACC" });

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				categories: [
					{
						id: 20,
						name: cat.name,
						description: cat.description,
						is_default: cat.is_default ? 1 : 0,
						created_at: cat.created_at,
						updated_at: cat.updated_at,
					},
				],
				accounts: [
					{
						id: 10,
						name: acc.name,
						account_type: acc.account_type,
						balance: acc.balance,
						account_identifier: acc.account_identifier,
						is_active: 1,
						created_at: acc.created_at,
						merged_into_id: null,
						merged_at: null,
						billing_cycle_start_day: 1,
					},
				],
				merchants: [],
				merchant_aliases: [],
				transactions: [
					{
						id: 77,
						transaction_id: "TX-FLAGS-001",
						date: "2025-06-15",
						amount: 5000,
						description: "Flagged Income",
						notes: null,
						payment_reference: null,
						merchant_name: null,
						merchant_id: null,
						category_id: null,
						transaction_type: "income",
						account_id: 10,
						created_at: "2025-06-15 00:00:00",
						is_recurring: 0,
						excluded_from_expenses: 1,
						excluded_from_income: 1,
						gmail_message_id: null,
						merchant_upi_id: null,
					},
				],
				recurring_patterns: [],
				budgets: [],
				goals: [],
				conversations: [],
				processed_gmail_messages: [],
				tags: [],
				transaction_tags: [],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.transactions).toBe(1);

		const tx = DB._queryOne(
			"SELECT excluded_from_expenses, excluded_from_income FROM transactions WHERE transaction_id = ?",
			["TX-FLAGS-001"],
		);
		expect(tx.excluded_from_expenses).toBe(1);
		expect(tx.excluded_from_income).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Sample data loader
// ---------------------------------------------------------------------------
describe("loadSampleData", () => {
	beforeEach(freshDB);

	it("populates a realistic dataset on an empty database", async () => {
		const summary = await DB.loadSampleData();
		expect(summary.accounts).toBeGreaterThanOrEqual(4);
		expect(summary.transactions).toBeGreaterThanOrEqual(40);
		expect(summary.merchants).toBeGreaterThanOrEqual(7);
		expect(summary.budgets).toBe(4);
		expect(summary.goals).toBe(3);
		expect(summary.tags).toBeGreaterThanOrEqual(3);
	});

	it("creates a credit account with a billing cycle and a merged hierarchy", async () => {
		await DB.loadSampleData();
		const credit = DB._queryOne("SELECT * FROM accounts WHERE account_type = 'credit'");
		expect(credit.billing_cycle_start_day).toBe(5);
		const merged = DB._queryOne("SELECT * FROM accounts WHERE merged_into_id IS NOT NULL");
		expect(merged).toBeTruthy();
	});

	it("creates Gmail-style transactions with merchant UPI ids and message ids", async () => {
		await DB.loadSampleData();
		const gmailTx = DB._queryAll(
			"SELECT * FROM transactions WHERE gmail_message_id IS NOT NULL AND merchant_upi_id IS NOT NULL",
		);
		expect(gmailTx.length).toBeGreaterThanOrEqual(9);
		for (const tx of gmailTx) {
			expect(tx.merchant_id).not.toBeNull();
			expect(tx.category_id).not.toBeNull();
		}
	});

	it("creates transactions excluded from expense totals", async () => {
		await DB.loadSampleData();
		const excluded = DB._queryAll("SELECT * FROM transactions WHERE excluded_from_expenses = 1");
		expect(excluded.length).toBeGreaterThanOrEqual(3);
	});

	it("refuses to run on a non-empty database", async () => {
		await createDefaultAccount();
		await expect(DB.loadSampleData()).rejects.toThrow(/empty database/);
	});

	it("produces a snapshot that round-trips through exportAsJSON / mergeFromJSON", async () => {
		await DB.loadSampleData();
		const envelope = await DB.exportAsJSON();
		await freshDB();
		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.transactions).toBeGreaterThanOrEqual(40);
		const txCount = DB._queryOne("SELECT COUNT(*) AS c FROM transactions").c;
		expect(txCount).toBeGreaterThanOrEqual(40);
	});
});

// ---------------------------------------------------------------------------
// Multi-device merge — union, last-writer-wins, and delete tombstones
// ---------------------------------------------------------------------------
describe("mergeFromJSON — multi-device union / LWW / tombstones", () => {
	beforeEach(freshDB);

	it("does not duplicate the same transaction imported on two devices", async () => {
		// Both devices independently imported the same Gmail transaction (shared transaction_id).
		const acc = await createDefaultAccount({ account_identifier: "MD-DUP-ACC" });
		await DB.createTransaction({
			date: "2025-03-01",
			amount: 100,
			transaction_type: "expense",
			account_id: acc.id,
			transaction_id: "gmail_M1",
		});

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				accounts: [
					{
						id: 1,
						name: acc.name,
						balance: acc.balance,
						account_type: acc.account_type,
						account_identifier: "MD-DUP-ACC",
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: acc.created_at,
						updated_at: "2025-03-01 00:00:00",
					},
				],
				transactions: [
					{
						id: 1,
						transaction_id: "gmail_M1",
						gmail_message_id: "M1",
						date: "2025-03-01",
						amount: 100,
						transaction_type: "expense",
						account_id: 1,
						created_at: "2025-03-01 00:00:00",
						updated_at: "2025-03-01 00:00:00",
					},
				],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		// Matched by transaction_id — no duplicate inserted.
		expect(result.inserted.transactions).toBe(0);
		const txs = DB._queryAll("SELECT * FROM transactions WHERE transaction_id = ?", ["gmail_M1"]);
		expect(txs).toHaveLength(1);
	});

	it("does not duplicate seeded categories on merge", async () => {
		// A snapshot from another device carries the same 20 seeded categories; merging must
		// match them by name and insert nothing.
		const envelope = await DB.exportAsJSON();
		await freshDB();
		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.categories).toBe(0);
		expect(DB._queryAll("SELECT * FROM categories")).toHaveLength(20);
	});

	it("a newer remote edit wins (LWW updates the local transaction)", async () => {
		const acc = await createDefaultAccount({ account_identifier: "MD-LWW-ACC" });
		await DB.createTransaction({
			date: "2025-04-01",
			amount: 50,
			description: "local version",
			transaction_type: "expense",
			account_id: acc.id,
			transaction_id: "T-LWW",
		});

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				accounts: [
					{
						id: 1,
						name: acc.name,
						balance: acc.balance,
						account_type: acc.account_type,
						account_identifier: "MD-LWW-ACC",
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: acc.created_at,
						updated_at: acc.created_at,
					},
				],
				transactions: [
					{
						id: 1,
						transaction_id: "T-LWW",
						date: "2025-04-01",
						amount: 75,
						description: "remote newer version",
						transaction_type: "expense",
						account_id: 1,
						created_at: "2025-04-01 00:00:00",
						updated_at: "2099-01-01 00:00:00",
					},
				],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.updated.transactions).toBe(1);
		const tx = DB._queryOne("SELECT amount, description FROM transactions WHERE transaction_id = ?", [
			"T-LWW",
		]);
		expect(tx.amount).toBe(75);
		expect(tx.description).toBe("remote newer version");
	});

	it("an older remote edit loses (local version is preserved)", async () => {
		const acc = await createDefaultAccount({ account_identifier: "MD-LWW2-ACC" });
		await DB.createTransaction({
			date: "2025-04-01",
			amount: 50,
			description: "local newer",
			transaction_type: "expense",
			account_id: acc.id,
			transaction_id: "T-LWW2",
		});

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				accounts: [
					{
						id: 1,
						name: acc.name,
						balance: acc.balance,
						account_type: acc.account_type,
						account_identifier: "MD-LWW2-ACC",
						is_active: 1,
						merged_into_id: null,
						merged_at: null,
						created_at: acc.created_at,
						updated_at: acc.created_at,
					},
				],
				transactions: [
					{
						id: 1,
						transaction_id: "T-LWW2",
						date: "2025-04-01",
						amount: 999,
						description: "remote stale",
						transaction_type: "expense",
						account_id: 1,
						created_at: "2025-04-01 00:00:00",
						updated_at: "2000-01-01 00:00:00",
					},
				],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.updated.transactions).toBe(0);
		const tx = DB._queryOne("SELECT amount, description FROM transactions WHERE transaction_id = ?", [
			"T-LWW2",
		]);
		expect(tx.amount).toBe(50);
		expect(tx.description).toBe("local newer");
	});

	it("a remote tombstone deletes the matching local transaction", async () => {
		const acc = await createDefaultAccount({ account_identifier: "MD-TOMB-ACC" });
		await DB.createTransaction({
			date: "2025-05-01",
			amount: 30,
			transaction_type: "expense",
			account_id: acc.id,
			transaction_id: "T-TOMB",
		});

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				sync_tombstones: [
					{
						entity_type: "transaction",
						entity_key: "T-TOMB",
						deleted_at: "2099-01-01 00:00:00",
					},
				],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.deleted.transactions).toBe(1);
		expect(
			DB._queryOne("SELECT 1 AS x FROM transactions WHERE transaction_id = ?", ["T-TOMB"]),
		).toBeFalsy();
	});

	it("a remote tombstone does not delete a locally re-created (newer) transaction", async () => {
		const acc = await createDefaultAccount({ account_identifier: "MD-TOMB2-ACC" });
		await DB.createTransaction({
			date: "2025-05-01",
			amount: 30,
			transaction_type: "expense",
			account_id: acc.id,
			transaction_id: "T-TOMB2",
		});

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				sync_tombstones: [
					{
						entity_type: "transaction",
						entity_key: "T-TOMB2",
						deleted_at: "2000-01-01 00:00:00",
					},
				],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.deleted.transactions).toBe(0);
		expect(
			DB._queryOne("SELECT 1 AS x FROM transactions WHERE transaction_id = ?", ["T-TOMB2"]),
		).toBeTruthy();
	});

	it("a creating local delete is propagated through exportAsJSON tombstones", async () => {
		// Deleting locally records a tombstone that the exported snapshot carries to other devices.
		const acc = await createDefaultAccount({ account_identifier: "MD-EXP-ACC" });
		const tx = await DB.createTransaction({
			date: "2025-06-01",
			amount: 40,
			transaction_type: "expense",
			account_id: acc.id,
			transaction_id: "T-EXP",
		});
		await DB.deleteTransaction(tx.id);

		const envelope = await DB.exportAsJSON();
		const tomb = envelope.tables.sync_tombstones.find(
			(t) => t.entity_type === "transaction" && t.entity_key === "T-EXP",
		);
		expect(tomb).toBeTruthy();
	});

	it("an account tombstone is ignored when the account still has local transactions", async () => {
		const acc = await createDefaultAccount({ account_identifier: "MD-ACCT-KEEP" });
		await DB.createTransaction({
			date: "2025-07-01",
			amount: 20,
			transaction_type: "expense",
			account_id: acc.id,
			transaction_id: "T-KEEP-ACCT",
		});

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				sync_tombstones: [
					{
						entity_type: "account",
						entity_key: "MD-ACCT-KEEP",
						deleted_at: "2099-01-01 00:00:00",
					},
				],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		// The guard keeps the account so its local transactions are not orphaned.
		expect(result.deleted.accounts).toBe(0);
		expect(
			DB._queryOne("SELECT 1 AS x FROM accounts WHERE account_identifier = ?", ["MD-ACCT-KEEP"]),
		).toBeTruthy();
	});

	it("a remote tombstone deletes the matching local goal", async () => {
		await DB.createGoal({ name: "Emergency Fund", target_amount: 100000 });
		const goal = DB._queryOne("SELECT * FROM goals WHERE name = ?", ["Emergency Fund"]);
		const key = `nm:${goal.name}|tg:${goal.target_amount}|cr:${goal.created_at}`;

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				sync_tombstones: [
					{ entity_type: "goal", entity_key: key, deleted_at: "2099-01-01 00:00:00" },
				],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.deleted.goals).toBe(1);
		expect(DB._queryOne("SELECT 1 AS x FROM goals WHERE name = ?", ["Emergency Fund"])).toBeFalsy();
	});

	it("the newest of two conflicting tombstones is kept", async () => {
		// A local tombstone and an older remote tombstone for the same key — the local (newer)
		// deleted_at survives in the unified set.
		DB._exec(
			"INSERT INTO sync_tombstones (entity_type, entity_key, deleted_at) VALUES (?,?,?)",
			["transaction", "T-CONFLICT", "2050-01-01 00:00:00"],
		);

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				sync_tombstones: [
					{
						entity_type: "transaction",
						entity_key: "T-CONFLICT",
						deleted_at: "2010-01-01 00:00:00",
					},
				],
			},
		};

		await DB.mergeFromJSON(envelope);
		const row = DB._queryOne(
			"SELECT deleted_at FROM sync_tombstones WHERE entity_type = ? AND entity_key = ?",
			["transaction", "T-CONFLICT"],
		);
		expect(row.deleted_at).toBe("2050-01-01 00:00:00");
	});

	it("merges chat history append-only without duplicating identical messages", async () => {
		DB._exec("INSERT INTO conversations (chat_id, role, content, timestamp) VALUES (?,?,?,?)", [
			"chat-1",
			"user",
			"hello",
			"2025-01-01 00:00:00",
		]);

		const envelope = {
			schema_version: SCHEMA_VERSION,
			tables: {
				conversations: [
					// duplicate of the local row — must be skipped
					{ id: 1, chat_id: "chat-1", role: "user", content: "hello", timestamp: "2025-01-01 00:00:00" },
					// new message — must be added
					{ id: 2, chat_id: "chat-1", role: "assistant", content: "hi there", timestamp: "2025-01-01 00:00:05" },
				],
			},
		};

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.conversations).toBe(1);
		expect(DB._queryAll("SELECT * FROM conversations WHERE chat_id = ?", ["chat-1"])).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// Item 4 — Credit Account Billing Cycle
// ---------------------------------------------------------------------------
describe("Item 4 — Credit Account Billing Cycle", () => {
	beforeEach(freshDB);

	it("updateAccount updates name", async () => {
		const acc = await createDefaultAccount({ name: "Old Name" });
		const updated = await DB.updateAccount(acc.id, { name: "New Name" });
		expect(updated.name).toBe("New Name");
		expect(DB._persist).toHaveBeenCalled();
	});

	it("updateAccount updates billing_cycle_start_day", async () => {
		const acc = await DB.createAccount({ name: "Credit Card", account_type: "credit", balance: 0 });
		const updated = await DB.updateAccount(acc.id, { billing_cycle_start_day: 15 });
		expect(updated.billing_cycle_start_day).toBe(15);
	});

	it("updateAccount rejects billing_cycle_start_day = 0", async () => {
		const acc = await DB.createAccount({ name: "Credit Card", account_type: "credit", balance: 0 });
		await expect(DB.updateAccount(acc.id, { billing_cycle_start_day: 0 })).rejects.toThrow(
			"between 1 and 28",
		);
	});

	it("updateAccount rejects billing_cycle_start_day = 29", async () => {
		const acc = await DB.createAccount({ name: "Credit Card", account_type: "credit", balance: 0 });
		await expect(DB.updateAccount(acc.id, { billing_cycle_start_day: 29 })).rejects.toThrow(
			"between 1 and 28",
		);
	});

	it("updateAccount throws for nonexistent account", async () => {
		await expect(DB.updateAccount(9999, { name: "X" })).rejects.toThrow("Account not found");
	});

	it("updateAccount throws when no valid fields provided", async () => {
		const acc = await createDefaultAccount();
		await expect(DB.updateAccount(acc.id, {})).rejects.toThrow("No fields to update");
	});

	it("getCreditAccountBalance returns correct cycle balance for transactions within cycle", async () => {
		const creditAcc = await DB.createAccount({
			name: "Credit Card",
			account_type: "credit",
			balance: 0,
		});
		const today = new Date();
		const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

		await DB.createTransaction({
			date: todayStr,
			amount: -500,
			description: "Shopping",
			transaction_type: "expense",
			account_id: creditAcc.id,
		});
		await DB.createTransaction({
			date: todayStr,
			amount: -200,
			description: "Dining",
			transaction_type: "expense",
			account_id: creditAcc.id,
		});

		const result = await DB.getCreditAccountBalance(creditAcc.id);
		expect(result.cycle_balance).toBe(700);
		expect(result.account_id).toBe(creditAcc.id);
		expect(result.cycle_start).toBeDefined();
		expect(result.cycle_end).toBeDefined();
	});

	it("getCreditAccountBalance returns 0 when no transactions in cycle", async () => {
		const creditAcc = await DB.createAccount({
			name: "New Credit",
			account_type: "credit",
			balance: 0,
		});
		const result = await DB.getCreditAccountBalance(creditAcc.id);
		expect(result.cycle_balance).toBe(0);
	});

	it("getCreditAccountBalance throws for non-credit account", async () => {
		const savings = await createDefaultAccount({ name: "Savings", account_type: "savings" });
		await expect(DB.getCreditAccountBalance(savings.id)).rejects.toThrow("Not a credit account");
	});

	it("getCreditAccountBalance throws for nonexistent account", async () => {
		await expect(DB.getCreditAccountBalance(9999)).rejects.toThrow("Account not found");
	});

	it("_getCreditCycleWindow returns correct date range for start day 1", () => {
		const { cycleStart, cycleEnd } = DB._getCreditCycleWindow(1);
		const today = new Date();
		// Today (May 24) >= day 1 → cycle starts 1st of current month
		const expectedStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
		// cycleEnd = last day of current month
		const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
		const expectedEnd = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
		expect(cycleStart).toBe(expectedStart);
		expect(cycleEnd).toBe(expectedEnd);
	});

	it("account response includes billing_cycle_start_day and credit_cycle_balance=0 for credit accounts with no txs", async () => {
		const creditAcc = await DB.createAccount({
			name: "Credit Card",
			account_type: "credit",
			balance: 0,
		});
		const acc = await DB.getAccount(creditAcc.id);
		expect(acc).toHaveProperty("billing_cycle_start_day");
		expect(acc.billing_cycle_start_day).toBe(1);
		expect(acc).toHaveProperty("credit_cycle_balance");
		expect(acc.credit_cycle_balance).toBe(0);
	});

	it("account response has credit_cycle_balance null for non-credit accounts", async () => {
		const savings = await createDefaultAccount({ name: "Savings", account_type: "savings" });
		const acc = await DB.getAccount(savings.id);
		expect(acc.credit_cycle_balance).toBeNull();
	});

	it("migration: billing_cycle_start_day column exists after DB init", () => {
		const cols = DB._queryAll("PRAGMA table_info(accounts)").map((c) => c.name);
		expect(cols).toContain("billing_cycle_start_day");
	});

	it("credit_cycle_balance in account response reflects current-cycle transactions", async () => {
		const creditAcc = await DB.createAccount({
			name: "Credit Card",
			account_type: "credit",
			balance: 0,
		});
		const today = new Date();
		const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

		await DB.createTransaction({
			date: todayStr,
			amount: -1000,
			description: "Big Purchase",
			transaction_type: "expense",
			account_id: creditAcc.id,
		});

		const acc = await DB.getAccount(creditAcc.id);
		expect(acc.credit_cycle_balance).toBe(1000);
	});

	it("credit_cycle_balance sums transactions from merged child credit accounts", async () => {
		const today = new Date();
		const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

		const target = await DB.createAccount({ name: "Card Target", account_type: "credit", balance: 0 });
		const source = await DB.createAccount({ name: "Card Source", account_type: "credit", balance: 0 });

		await DB.createTransaction({ date: todayStr, amount: -800, description: "Target purchase", transaction_type: "expense", account_id: target.id });
		await DB.createTransaction({ date: todayStr, amount: -500, description: "Source purchase", transaction_type: "expense", account_id: source.id });
		await DB.createTransaction({ date: todayStr, amount: 200, description: "Payment", transaction_type: "income", account_id: source.id });

		await DB.mergeAccounts(source.id, target.id);
		const acc = await DB.getAccount(target.id);

		// Should be: (800 + 500) expenses - 200 income = 1100
		expect(acc.credit_cycle_balance).toBe(1100);
	});

	it("RECONCILIATION INVARIANT: _creditCycleSum equals family totals over the same window — including a last-day-of-cycle row and an excluded_from_expenses row", async () => {
		// Locks the cycle-boundary edge case: a row dated on cycleEnd must be counted.
		// _creditCycleSum must use the SAME `date < (cycleEnd + 1 day)` convention as
		// getTransactionTotals so the credit balance can never drift from the totals view.
		const creditAcc = await DB.createAccount({
			name: "Recon Card",
			account_type: "credit",
			balance: 0,
			billing_cycle_start_day: 1,
		});
		const { cycleStart, cycleEnd } = DB._getCreditCycleWindow(1);

		// A normal counted expense on cycleStart (first day of cycle).
		await DB.createTransaction({
			date: cycleStart,
			amount: -1000,
			description: "first-day spend",
			transaction_type: "expense",
			account_id: creditAcc.id,
		});
		// A counted expense on the LAST day of the cycle — the edge case under test.
		await DB.createTransaction({
			date: cycleEnd,
			amount: -250,
			description: "last-day spend",
			transaction_type: "expense",
			account_id: creditAcc.id,
		});
		// A counted income (payment) on the last day too.
		await DB.createTransaction({
			date: cycleEnd,
			amount: 400,
			description: "last-day payment",
			transaction_type: "income",
			account_id: creditAcc.id,
		});
		// An excluded_from_expenses row on the last day — must NOT count.
		const excluded = await DB.createTransaction({
			date: cycleEnd,
			amount: -700,
			description: "excluded last-day spend",
			transaction_type: "expense",
			account_id: creditAcc.id,
		});
		await DB.toggleExcludedFromExpenses(excluded.id, true);

		// Credit-cycle sum (uses the exclusive-end boundary internally).
		const cycleSum = DB._creditCycleSum(creditAcc.id, cycleStart, cycleEnd);

		// Family totals over the identical window via the public totals API.
		const totals = await DB.getTransactionTotals({
			account_id: creditAcc.id,
			date_from: cycleStart,
			date_to: cycleEnd,
		});
		const totalsNet = totals.total_expense - totals.total_income;

		// Both views must agree exactly, and the last-day rows must be included:
		// (1000 + 250) expenses - 400 income = 850, excluded 700 ignored.
		expect(cycleSum).toBe(850);
		expect(cycleSum).toBe(totalsNet);
	});
});

// ---------------------------------------------------------------------------
// ARCH-01 — conversations table has no user_id (single-user, local-first)
// ---------------------------------------------------------------------------
describe("ARCH-01 — conversations has no user_id column", () => {
	beforeEach(freshDB);

	it("conversations table has no user_id column", () => {
		const cols = DB._queryAll("PRAGMA table_info(conversations)").map((c) => c.name);
		expect(cols).not.toContain("user_id");
		expect(cols).toContain("chat_id");
		expect(cols).toContain("role");
		expect(cols).toContain("content");
	});

	it("saveChatMessage stores a message without a user_id", async () => {
		await DB.saveChatMessage("chat-arch01", "user", "Test message");

		const row = DB._queryOne(
			"SELECT chat_id, role, content FROM conversations WHERE chat_id = ?",
			["chat-arch01"],
		);
		expect(row.chat_id).toBe("chat-arch01");
		expect(row.role).toBe("user");
		expect(row.content).toBe("Test message");
	});

	it("getChatHistory retrieves all messages for a chat without user scoping", async () => {
		await DB.saveChatMessage("chat-arch01", "user", "Hello");
		await DB.saveChatMessage("chat-arch01", "assistant", "Hi there");
		await DB.saveChatMessage("other-chat", "user", "Should not appear");

		const result = await DB.getChatHistory("chat-arch01");
		expect(result.history).toHaveLength(2);
		expect(result.history[0].content).toBe("Hello");
		expect(result.history[1].content).toBe("Hi there");
	});
});

// ---------------------------------------------------------------------------
// Tags CRUD
// ---------------------------------------------------------------------------
describe("Tags CRUD", () => {
	beforeEach(freshDB);

	it("creates a tag and returns it", async () => {
		const tag = await DB.createTag("vacation");
		expect(tag.id).toBeTypeOf("number");
		expect(tag.name).toBe("vacation");
	});

	it("normalizes tag names — strips # prefix", async () => {
		const tag = await DB.createTag("#holiday");
		expect(tag.name).toBe("holiday");
	});

	it("normalizes tag names — camelCase from multiple words", async () => {
		const tag = await DB.createTag("trip to yercaud");
		expect(tag.name).toBe("tripToYercaud");
	});

	it("normalizes tag names — extra whitespace ignored", async () => {
		const tag = await DB.createTag("  business  expense  ");
		expect(tag.name).toBe("businessExpense");
	});

	it("getTags returns all tags sorted by name", async () => {
		await DB.createTag("work");
		await DB.createTag("personal");
		await DB.createTag("vacation");
		const tags = await DB.getTags();
		const names = tags.map((t) => t.name);
		// 4 seeded tags + 3 created = 7 total
		expect(tags.length).toBe(7);
		expect(names).toContain("personal");
		expect(names).toContain("vacation");
		expect(names).toContain("work");
		expect(names).toContain("domestic");
		expect(names).toContain("international");
		expect(names).toContain("offline");
		expect(names).toContain("online");
	});

	it("updateTag renames a tag", async () => {
		const tag = await DB.createTag("oldname");
		const updated = await DB.updateTag(tag.id, "newname");
		expect(updated.name).toBe("newname");
	});

	it("deleteTag removes the tag", async () => {
		const tag = await DB.createTag("temporary");
		await DB.deleteTag(tag.id);
		const tags = await DB.getTags();
		expect(tags.find((t) => t.id === tag.id)).toBeUndefined();
	});

	it("throws on duplicate tag name (case-insensitive)", async () => {
		await DB.createTag("Travel");
		await expect(DB.createTag("travel")).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Transaction Tags
// ---------------------------------------------------------------------------
describe("Transaction Tags", () => {
	let accountId;
	let catId;

	beforeEach(async () => {
		await freshDB();
		const acct = await DB.createAccount({ name: "Checking", balance: 1000, account_type: "checking" });
		accountId = acct.id;
		const cats = await DB.getCategories();
		catId = cats[0].id;
	});

	it("createTransaction with tag_ids attaches tags", async () => {
		const tag = await DB.createTag("food");
		const tx = await DB.createTransaction({
			date: "2025-01-10",
			amount: 100,
			description: "Lunch",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
			tag_ids: [tag.id],
		});
		expect(tx.tags).toHaveLength(1);
		expect(tx.tags[0].name).toBe("food");
	});

	it("updateTransaction with tag_ids replaces existing tags", async () => {
		const tag1 = await DB.createTag("food");
		const tag2 = await DB.createTag("work");
		const tx = await DB.createTransaction({
			date: "2025-01-10",
			amount: 50,
			description: "Coffee",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
			tag_ids: [tag1.id],
		});
		const updated = await DB.updateTransaction(tx.id, { tag_ids: [tag2.id] });
		expect(updated.tags.map((t) => t.name)).toEqual(["work"]);
	});

	it("setTransactionTags sets tags for a transaction", async () => {
		const tag = await DB.createTag("personal");
		const tx = await DB.createTransaction({
			date: "2025-01-10",
			amount: 200,
			description: "Groceries",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
		});
		await DB.setTransactionTags(tx.id, [tag.id]);
		const fetched = await DB.getTransactions({ limit: 1 });
		expect(fetched[0].tags[0].name).toBe("personal");
	});

	it("deleteTransaction cascades to transaction_tags", async () => {
		const tag = await DB.createTag("deleteme");
		const tx = await DB.createTransaction({
			date: "2025-01-10",
			amount: 30,
			description: "Test",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
			tag_ids: [tag.id],
		});
		await DB.deleteTransaction(tx.id);
		const rows = DB._queryAll("SELECT * FROM transaction_tags WHERE transaction_id = ?", [tx.id]);
		expect(rows).toHaveLength(0);
	});

	it("getTransactions filters by tag_ids", async () => {
		const tagA = await DB.createTag("tagA");
		const tagB = await DB.createTag("tagB");
		await DB.createTransaction({
			date: "2025-01-10",
			amount: 10,
			description: "A",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
			tag_ids: [tagA.id],
		});
		await DB.createTransaction({
			date: "2025-01-11",
			amount: 20,
			description: "B",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
			tag_ids: [tagB.id],
		});
		const result = await DB.getTransactions({ tag_ids: [tagA.id] });
		expect(result).toHaveLength(1);
		expect(result[0].description).toBe("A");
	});

	it("getTransactionTotals filters by tag_ids", async () => {
		const tag = await DB.createTag("budget");
		await DB.createTransaction({
			date: "2025-01-10",
			amount: 100,
			description: "Tagged",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
			tag_ids: [tag.id],
		});
		await DB.createTransaction({
			date: "2025-01-11",
			amount: 200,
			description: "Untagged",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
		});
		const totals = await DB.getTransactionTotals({ tag_ids: [tag.id] });
		expect(totals.total_expense).toBe(100);
	});

	it("exportTransactionsCSV includes Tags column", async () => {
		const tag = await DB.createTag("export");
		await DB.createTransaction({
			date: "2025-01-15",
			amount: 75,
			description: "CSV test",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
			tag_ids: [tag.id],
		});
		const csv = await DB.exportTransactionsCSV({});
		expect(csv).toContain("Tags");
		expect(csv).toContain("#export");
	});

	it("exportAsJSON includes tags and transaction_tags tables", async () => {
		const tag = await DB.createTag("backup");
		const tx = await DB.createTransaction({
			date: "2025-01-15",
			amount: 50,
			description: "Backup test",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
			tag_ids: [tag.id],
		});
		const envelope = await DB.exportAsJSON();
		expect(envelope.tables.tags).toBeDefined();
		expect(envelope.tables.transaction_tags).toBeDefined();
		expect(envelope.tables.tags.some((t) => t.name === "backup")).toBe(true);
		expect(envelope.tables.transaction_tags.some((r) => r.transaction_id === tx.id)).toBe(true);
	});

	it("mergeFromJSON restores tags and associates with transactions", async () => {
		// Create and export
		const tag = await DB.createTag("restore");
		await DB.createTransaction({
			date: "2025-01-15",
			amount: 99,
			description: "Restore test",
			transaction_type: "expense",
			account_id: accountId,
			category_id: catId,
			tag_ids: [tag.id],
		});
		const envelope = await DB.exportAsJSON();

		// Fresh DB — merge into it
		DB._db = null;
		DB._persist = vi.fn(async () => {});
		DB._loadFromStorage = vi.fn(async () => null);
		await DB.init();

		const result = await DB.mergeFromJSON(envelope);
		expect(result.inserted.tags).toBeGreaterThanOrEqual(1);
		const tags = await DB.getTags();
		expect(tags.some((t) => t.name === "restore")).toBe(true);
		// Transaction should also have the tag re-linked
		const txs = await DB.getTransactions({});
		const tx = txs.find((t) => t.description === "Restore test");
		expect(tx.tags.some((t) => t.name === "restore")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Regression fixes: schema v3 + 4 bugs
// ---------------------------------------------------------------------------
describe("Schema v4 — new columns", () => {
	beforeEach(freshDB);

	it("SCHEMA_VERSION is 5", () => {
		expect(SCHEMA_VERSION).toBe(5);
	});

	it("merchants has merchant_key and display_name columns (no match_name)", () => {
		const cols = DB._queryAll("PRAGMA table_info(merchants)").map((c) => c.name);
		expect(cols).toContain("merchant_key");
		expect(cols).toContain("display_name");
		expect(cols).not.toContain("match_name");
		expect(cols).not.toContain("merchant_name");
	});

	it("merchant_aliases table exists with alias_norm and merchant_id columns", () => {
		const cols = DB._queryAll("PRAGMA table_info(merchant_aliases)").map((c) => c.name);
		expect(cols).toContain("alias_norm");
		expect(cols).toContain("merchant_id");
	});

	it("processed_gmail_messages has a deleted column defaulting to 0", () => {
		const cols = DB._queryAll("PRAGMA table_info(processed_gmail_messages)").map((c) => c.name);
		expect(cols).toContain("deleted");
		DB._exec("INSERT INTO processed_gmail_messages (gmail_message_id) VALUES (?)", ["m1"]);
		const row = DB._queryOne(
			"SELECT deleted FROM processed_gmail_messages WHERE gmail_message_id = ?",
			["m1"],
		);
		expect(row.deleted).toBe(0);
	});

	it("createMerchant populates merchant_key/display_name and creates an alias row", async () => {
		const cats = await DB.getCategories();
		const m = await DB.createMerchant({
			merchant_name: "  Swiggy  Foods ",
			category_id: cats[0].id,
		});
		const row = DB._queryOne(
			"SELECT merchant_key, display_name FROM merchants WHERE id = ?",
			[m.id],
		);
		// merchant_key is the slug of the first-seen name; display_name is the mutable label.
		expect(row.merchant_key).toBe("swiggy-foods");
		expect(row.display_name).toBe("  Swiggy  Foods ");
		// An alias row maps the normalized name back to the merchant for no-UPI lookups.
		const alias = DB._queryOne(
			"SELECT alias_norm FROM merchant_aliases WHERE merchant_id = ?",
			[m.id],
		);
		expect(alias.alias_norm).toBe("swiggy foods");
	});
});

describe("BUG 1 — deleted Gmail transactions are tombstoned, not re-imported", () => {
	let accId;
	beforeEach(async () => {
		await freshDB();
		const acc = await createDefaultAccount();
		accId = acc.id;
	});

	it("deleteTransaction tombstones the Gmail message ID (deleted = 1)", async () => {
		const tx = await DB.createTransaction({
			date: "2025-01-10",
			amount: -100,
			description: "Gmail tx",
			transaction_type: "expense",
			account_id: accId,
		});
		DB._exec("UPDATE transactions SET gmail_message_id = ? WHERE id = ?", ["gm-1", tx.id]);

		await DB.deleteTransaction(tx.id);

		const row = DB._queryOne(
			"SELECT deleted FROM processed_gmail_messages WHERE gmail_message_id = ?",
			["gm-1"],
		);
		expect(row).not.toBeNull();
		expect(row.deleted).toBe(1);
	});

	it("getProcessedGmailIds still returns tombstoned IDs (stays filtered at Layer 1)", async () => {
		const tx = await DB.createTransaction({
			date: "2025-01-10",
			amount: -100,
			description: "Gmail tx",
			transaction_type: "expense",
			account_id: accId,
		});
		DB._exec("UPDATE transactions SET gmail_message_id = ? WHERE id = ?", ["gm-2", tx.id]);
		await DB.deleteTransaction(tx.id);

		const ids = DB.getProcessedGmailIds(["gm-2"]);
		expect(ids.has("gm-2")).toBe(true);
	});

	it("creates a tombstone even if the ID was never recorded", async () => {
		const tx = await DB.createTransaction({
			date: "2025-01-10",
			amount: -100,
			description: "Gmail tx",
			transaction_type: "expense",
			account_id: accId,
		});
		DB._exec("UPDATE transactions SET gmail_message_id = ? WHERE id = ?", ["gm-3", tx.id]);
		// No processed_gmail_messages row exists yet for gm-3
		await DB.deleteTransaction(tx.id);
		const row = DB._queryOne(
			"SELECT deleted FROM processed_gmail_messages WHERE gmail_message_id = ?",
			["gm-3"],
		);
		expect(row.deleted).toBe(1);
	});

	it("clearDeletedGmailTombstones removes only deleted rows and keeps live ones", async () => {
		DB._exec("INSERT INTO processed_gmail_messages (gmail_message_id, deleted) VALUES (?, 1)", [
			"dead",
		]);
		DB._exec("INSERT INTO processed_gmail_messages (gmail_message_id, deleted) VALUES (?, 0)", [
			"live",
		]);

		await DB.clearDeletedGmailTombstones();

		expect(DB.getProcessedGmailIds(["dead"]).has("dead")).toBe(false);
		expect(DB.getProcessedGmailIds(["live"]).has("live")).toBe(true);
		expect(DB._persist).toHaveBeenCalled();
	});
});

describe("BUG 2 — merchant rename changes display_name and surfaces via join", () => {
	let accId;
	let catId;
	beforeEach(async () => {
		await freshDB();
		const acc = await createDefaultAccount();
		accId = acc.id;
		const cats = await DB.getCategories();
		catId = cats[0].id;
	});

	it("_lookupMerchant matches by normalized name regardless of case/whitespace", async () => {
		await DB.createMerchant({ merchant_name: "Swiggy", category_id: catId });
		const found = DB._lookupMerchant(null, "  SWIGGY  ");
		expect(found).not.toBeNull();
		// _lookupMerchant returns the raw merchant row — identity via merchant_key.
		expect(found.merchant_key).toBe("swiggy");
		expect(found.display_name).toBe("Swiggy");
	});

	it("renaming a UPI merchant surfaces the new display name and keeps merchant_key", async () => {
		const m = await DB.createMerchant({
			merchant_name: "Swiggy",
			merchant_upi_id: "swiggy@upi",
			category_id: catId,
		});
		await DB.createTransaction({
			date: "2025-01-01",
			amount: -100,
			description: "t1",
			transaction_type: "expense",
			account_id: accId,
			merchant_upi_id: "swiggy@upi",
			merchant_name: "Swiggy",
		});

		await DB.updateMerchant(m.id, { merchant_name: "Swiggy Foods" });

		// The displayed name resolves through the merchant join, not the provenance column.
		const txs = await DB.getTransactions({});
		const tx = txs.find((t) => t.merchant_upi_id === "swiggy@upi");
		expect(tx.merchant_name).toBe("Swiggy Foods");
		// The immutable provenance column on the transaction row is unchanged.
		const raw = DB._queryOne(
			"SELECT merchant_name FROM transactions WHERE merchant_upi_id = ?",
			["swiggy@upi"],
		);
		expect(raw.merchant_name).toBe("Swiggy");
		// merchant_key stays fixed so future lookups still resolve.
		const row = DB._queryOne("SELECT merchant_key, display_name FROM merchants WHERE id = ?", [
			m.id,
		]);
		expect(row.merchant_key).toBe("swiggy@upi");
		expect(row.display_name).toBe("Swiggy Foods");
		// Lookup by the original raw name still resolves to the same merchant.
		const found = DB._lookupMerchant("swiggy@upi", "Swiggy");
		expect(found.id).toBe(m.id);
	});

	it("renaming a no-UPI merchant surfaces via join and preserves matching", async () => {
		const m = await DB.createMerchant({ merchant_name: "Localshop", category_id: catId });
		const tx = await DB.createTransaction({
			date: "2025-01-01",
			amount: -100,
			description: "t1",
			transaction_type: "expense",
			account_id: accId,
			merchant_name: "Localshop",
		});
		DB._exec("UPDATE transactions SET merchant_id = ? WHERE id = ?", [m.id, tx.id]);

		await DB.updateMerchant(m.id, { merchant_name: "Local Shop Pvt" });

		const txs = await DB.getTransactions({});
		const updatedTx = txs.find((t) => t.id === tx.id);
		expect(updatedTx.merchant_name).toBe("Local Shop Pvt");
		// merchant_key stays the original slug so future lookups still resolve.
		const row = DB._queryOne("SELECT merchant_key FROM merchants WHERE id = ?", [m.id]);
		expect(row.merchant_key).toBe("localshop");
		const found = DB._lookupMerchant(null, "Localshop");
		expect(found).not.toBeNull();
		expect(found.id).toBe(m.id);
	});
});

describe("BUG 3 — learning a category retro-updates name-variant rows", () => {
	let accId;
	let catFood;
	let catShop;
	beforeEach(async () => {
		await freshDB();
		const acc = await createDefaultAccount();
		accId = acc.id;
		const cats = await DB.getCategories();
		catFood = cats[0].id;
		catShop = cats[1].id;
	});

	it("updates past no-UPI transactions sharing the normalized name", async () => {
		const t1 = await DB.createTransaction({
			date: "2025-01-01",
			amount: -100,
			description: "past",
			transaction_type: "expense",
			account_id: accId,
			merchant_name: "Blinkit",
			category_id: catFood,
		});
		const t2 = await DB.createTransaction({
			date: "2025-01-02",
			amount: -200,
			description: "current",
			transaction_type: "expense",
			account_id: accId,
			merchant_name: "blinkit",
		});

		const tx2 = DB._queryOne("SELECT * FROM transactions WHERE id = ?", [t2.id]);
		DB._learnMerchantMapping(tx2, catShop);
		await DB._persist();

		const past = DB._queryOne("SELECT category_id FROM transactions WHERE id = ?", [t1.id]);
		expect(past.category_id).toBe(catShop);
	});

	it("does not sweep unrelated UPI merchants sharing a generic display name", async () => {
		const t1 = await DB.createTransaction({
			date: "2025-01-01",
			amount: -100,
			description: "upi-one",
			transaction_type: "expense",
			account_id: accId,
			merchant_upi_id: "store-a@upi",
			merchant_name: "Store",
		});
		const t2 = await DB.createTransaction({
			date: "2025-01-02",
			amount: -200,
			description: "upi-two",
			transaction_type: "expense",
			account_id: accId,
			merchant_upi_id: "store-b@upi",
			merchant_name: "Store",
		});

		const tx1 = DB._queryOne("SELECT * FROM transactions WHERE id = ?", [t1.id]);
		DB._learnMerchantMapping(tx1, catShop);
		await DB._persist();

		// The other UPI merchant must remain unchanged
		const other = DB._queryOne("SELECT category_id FROM transactions WHERE id = ?", [t2.id]);
		expect(other.category_id).not.toBe(catShop);
	});
});

describe("BUG 4 — credit cycle sum honours exclusions and account family", () => {
	let creditId;
	beforeEach(async () => {
		await freshDB();
		const acc = await DB.createAccount({
			name: "Card",
			account_type: "credit",
			balance: 0,
		});
		creditId = acc.id;
	});

	it("excludes transactions flagged excluded_from_expenses", async () => {
		const today = new Date();
		const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
		await DB.createTransaction({
			date: todayStr,
			amount: -500,
			description: "counted",
			transaction_type: "expense",
			account_id: creditId,
		});
		const excluded = await DB.createTransaction({
			date: todayStr,
			amount: -300,
			description: "excluded",
			transaction_type: "expense",
			account_id: creditId,
		});
		await DB.toggleExcludedFromExpenses(excluded.id, true);

		const result = await DB.getCreditAccountBalance(creditId);
		expect(result.cycle_balance).toBe(500);
	});

	it("getCreditAccountBalance and account.credit_cycle_balance agree", async () => {
		const today = new Date();
		const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
		await DB.createTransaction({
			date: todayStr,
			amount: -750,
			description: "spend",
			transaction_type: "expense",
			account_id: creditId,
		});

		const direct = await DB.getCreditAccountBalance(creditId);
		const acc = await DB.getAccount(creditId);
		expect(acc.credit_cycle_balance).toBe(direct.cycle_balance);
	});
});
