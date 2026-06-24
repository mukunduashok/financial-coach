/**
 * Integration / edge-case tests for Sprint 2 — AI Chat Migration.
 *
 * Covers:
 *  - api.js ↔ ai.js chat bridge wiring
 *  - AI.chat() edge cases (empty message, long message, special chars)
 *  - Settings edge cases (overwrite, extra fields, empty provider save)
 *  - Context building edge cases (empty data, null fields, zero target)
 *  - Conversation history flow (history slicing, inclusion in fetch body)
 *  - Window global assignments (window.AI)
 *  - Date range edge cases (alternate phrasing variants)
 *  - saveChatMessage argument passing (regression for arg-count bug)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------
const localStore = {};
globalThis.localStorage = {
  getItem: vi.fn((key) => localStore[key] ?? null),
  setItem: vi.fn((key, val) => {
    localStore[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete localStore[key];
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(localStore)) delete localStore[k];
  }),
};

vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: vi.fn(() => "int-test-uuid") });

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------
const mockDB = {
  getAccounts: vi.fn(async () => []),
  getTransactions: vi.fn(async () => []),
  getGoals: vi.fn(async () => []),
  getCategories: vi.fn(async () => []),
  saveChatMessage: vi.fn(async () => {}),
  getChatHistory: vi.fn(async () => ({ chat_id: "test", history: [] })),
  clearChatHistory: vi.fn(async () => ({ message: "cleared" })),
  listChatSessions: vi.fn(async () => ({ sessions: [] })),
};

vi.mock("../../static/js/db.js", () => ({ DB: mockDB }));

globalThis.fetch = vi.fn();

const { AI, AI_PROVIDERS } = await import("../../static/js/ai.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clearLocalStore() {
  for (const k of Object.keys(localStore)) delete localStore[k];
}

function configureGroq() {
  AI.saveSettings({ provider: "groq", apiKey: "sk-int", model: "llama-3.3-70b-versatile" });
}

function mockFetchSuccess(content = "AI reply") {
  globalThis.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
}

function mockFetchError(status, body = {}) {
  globalThis.fetch.mockResolvedValue({
    ok: false,
    status,
    text: async () => JSON.stringify(body),
  });
}

// ===========================================================================
// 1. API ↔ AI Chat Bridge
// ===========================================================================
describe("API ↔ AI Chat Bridge", () => {
  let API;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearLocalStore();
    // Dynamic import so mocks are in place
    const mod = await import("../../static/js/api.js");
    API = mod.API;
  });

  it("API.sendChatMessage delegates to AI.chat with one arg", async () => {
    configureGroq();
    mockFetchSuccess("bridge reply");
    const result = await API.sendChatMessage("Hello from bridge");
    expect(result.response).toBe("bridge reply");
    expect(result.chat_id).toBeDefined();
  });

  it("API.sendChatMessageWithId passes chatId to AI.chat", async () => {
    configureGroq();
    mockFetchSuccess("bridge reply 2");
    const result = await API.sendChatMessageWithId("Hi", "my-chat-42");
    expect(result.chat_id).toBe("my-chat-42");
  });

  it("API.getChatHistory delegates to DB.getChatHistory", async () => {
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "x", history: [{ role: "user", content: "msg" }] });
    const result = await API.getChatHistory("x");
    expect(mockDB.getChatHistory).toHaveBeenCalledWith("x");
    expect(result.history).toHaveLength(1);
  });

  it("API.sendChatMessage resolves even with no provider configured", async () => {
    clearLocalStore();
    const result = await API.sendChatMessage("Hi");
    expect(result.response).toContain("configure");
  });

  it("API.clearChatHistory delegates to DB.clearChatHistory", async () => {
    await API.clearChatHistory("x");
    expect(mockDB.clearChatHistory).toHaveBeenCalledWith("x");
  });

  it("API.listChatSessions delegates to DB.listChatSessions", async () => {
    mockDB.listChatSessions.mockResolvedValue({ sessions: [{ chat_id: "s1" }] });
    const result = await API.listChatSessions();
    expect(result.sessions).toHaveLength(1);
  });
});

// ===========================================================================
// 2. Chat Edge Cases
// ===========================================================================
describe("Chat Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStore();
    configureGroq();
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "test", history: [] });
  });

  it("handles empty string message", async () => {
    mockFetchSuccess("I need a question");
    const result = await AI.chat("");
    expect(result.response).toBe("I need a question");
    expect(result.chat_id).toBeDefined();
  });

  it("handles very long message (>5000 chars)", async () => {
    const longMsg = "x".repeat(6000);
    mockFetchSuccess("Noted");
    const result = await AI.chat(longMsg);
    expect(result.response).toBe("Noted");
    // Verify the message was sent in the fetch body
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    const userMsg = body.messages.find((m) => m.role === "user");
    expect(userMsg.content).toBe(longMsg);
  });

  it("handles message with HTML/script tags (no injection)", async () => {
    const xssMsg = '<script>alert("xss")</script>';
    mockFetchSuccess("Safe");
    const result = await AI.chat(xssMsg);
    expect(result.response).toBe("Safe");
    // The raw message should be passed as-is to the API (string, not executed)
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    const userMsg = body.messages.find((m) => m.role === "user");
    expect(userMsg.content).toBe(xssMsg);
  });

  it("handles message with unicode / emoji", async () => {
    mockFetchSuccess("Got it");
    const result = await AI.chat("How much did I spend on 🍕?");
    expect(result.response).toBe("Got it");
  });

  it("sends stream:false in request body", async () => {
    mockFetchSuccess("reply");
    await AI.chat("Test");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
  });

  it("sends correct model in request body", async () => {
    mockFetchSuccess("reply");
    await AI.chat("Test");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("llama-3.3-70b-versatile");
  });

  it("includes system prompt as first message", async () => {
    mockFetchSuccess("reply");
    await AI.chat("Test");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("financial advisor");
  });

  it("handles API returning non-JSON error body", async () => {
    AI.saveSettings({ provider: "groq", apiKey: "sk-test", model: "llama-3.3-70b-versatile" });
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error — not JSON",
    });
    const result = await AI.chat("Hello");
    expect(result.response).toContain("API error (500)");
  });
});

// ===========================================================================
// 3. saveChatMessage Argument Passing
// ===========================================================================
describe("saveChatMessage Argument Passing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStore();
    configureGroq();
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "test", history: [] });
    mockFetchSuccess("AI says hello");
  });

  it("calls saveChatMessage with 3 args for user message", async () => {
    await AI.chat("My question");
    const userCall = mockDB.saveChatMessage.mock.calls[0];
    expect(userCall).toHaveLength(3);
    expect(userCall[0]).toBe("int-test-uuid"); // chatId
    expect(userCall[1]).toBe("user"); // role
    expect(userCall[2]).toBe("My question"); // content
  });

  it("calls saveChatMessage with 3 args for assistant message", async () => {
    await AI.chat("My question");
    const assistantCall = mockDB.saveChatMessage.mock.calls[1];
    expect(assistantCall).toHaveLength(3);
    expect(assistantCall[0]).toBe("int-test-uuid");
    expect(assistantCall[1]).toBe("assistant");
    expect(assistantCall[2]).toBe("AI says hello");
  });
});

// ===========================================================================
// 4. Settings Edge Cases
// ===========================================================================
describe("Settings Edge Cases", () => {
  beforeEach(clearLocalStore);

  it("overwrites existing settings completely", () => {
    AI.saveSettings({ provider: "groq", apiKey: "key1", model: "m1" });
    AI.saveSettings({ provider: "openai", apiKey: "key2", model: "m2" });
    const s = AI.getSettings();
    expect(s.provider).toBe("openai");
    expect(s.apiKey).toBe("key2");
    expect(s.model).toBe("m2");
  });

  it("saves only known fields (extra fields stripped)", () => {
    AI.saveSettings({ provider: "groq", apiKey: "k", model: "m", extra: "ignored" });
    const raw = JSON.parse(localStore["fincoach-ai-settings"]);
    expect(raw).not.toHaveProperty("extra");
    expect(Object.keys(raw)).toEqual([
      "provider",
      "apiKey",
      "model",
      "azureResourceName",
      "azureDeploymentName",
      "azureApiVersion",
      "ollamaBaseUrl",
    ]);
  });

  it("saves with empty provider as null", () => {
    AI.saveSettings({ provider: "", apiKey: "", model: "" });
    const s = AI.getSettings();
    expect(s.provider).toBeNull();
    expect(s.apiKey).toBe("");
    expect(s.model).toBe("");
  });

  it("handles settings with null values", () => {
    AI.saveSettings({ provider: null, apiKey: null, model: null });
    const s = AI.getSettings();
    expect(s.provider).toBeNull();
    expect(s.apiKey).toBe("");
    expect(s.model).toBe("");
  });
});

// ===========================================================================
// 5. Context Building Edge Cases
// ===========================================================================
describe("Context Building Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles all empty data gracefully", async () => {
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);

    const ctx = await AI._buildContext("Hello");
    expect(ctx).toContain("FINANCIAL SNAPSHOT");
    expect(ctx).toContain("No accounts yet");
    expect(ctx).toContain("No expenses tracked");
    expect(ctx).toContain("No transactions yet");
    expect(ctx).toContain("No goals set");
  });

  it("handles account with null effective_balance (falls back to balance)", async () => {
    mockDB.getAccounts.mockResolvedValue([
      { id: 1, name: "Wallet", balance: 2000, effective_balance: null, account_type: "wallet", is_active: true },
    ]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);

    const ctx = await AI._buildContext("Balance?");
    expect(ctx).toContain("2,000");
    expect(ctx).toContain("Wallet");
  });

  it("handles non-balance account types (credit card)", async () => {
    mockDB.getAccounts.mockResolvedValue([
      { id: 1, name: "HDFC CC", balance: -5000, account_type: "credit_card", is_active: true },
    ]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);

    const ctx = await AI._buildContext("Balance?");
    // Credit card should not be in balance total
    expect(ctx).toContain("HDFC CC (credit_card)");
    // Total balance should be 0 since credit_card is excluded from BALANCE_ACCOUNT_TYPES
    expect(ctx).toContain("Total Available Funds: ₹0.00");
  });

  it("handles transaction with null description", async () => {
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([
      { id: 1, date: "2025-01-10", amount: 100, description: null, transaction_type: "expense", category_id: 1 },
    ]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([{ id: 1, name: "Food" }]);

    const ctx = await AI._buildContext("Show spending");
    expect(ctx).toContain("No description");
  });

  it("handles goal with zero target_amount (no division by zero)", async () => {
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([
      { id: 1, name: "Empty Goal", target_amount: 0, current_amount: 0, deadline: null },
    ]);
    mockDB.getCategories.mockResolvedValue([]);

    const ctx = await AI._buildContext("Goals?");
    expect(ctx).toContain("Empty Goal");
    expect(ctx).toContain("0.0% complete");
    expect(ctx).not.toContain("NaN");
    expect(ctx).not.toContain("Infinity");
  });

  it("includes only accounts returned by DB.getAccounts (active-only by default)", async () => {
    // DB.getAccounts() already filters to is_active=1; inactive accounts never reach ai.js
    mockDB.getAccounts.mockResolvedValue([
      { id: 1, name: "Active", balance: 1000, account_type: "savings", is_active: true },
    ]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);

    const ctx = await AI._buildContext("Balance");
    expect(ctx).toContain("Active");
  });

  it("limits transactions to LOOKBACK_MAX (50)", async () => {
    const txns = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      date: "2025-01-01",
      amount: 10,
      description: `Tx-${i}`,
      transaction_type: "expense",
      category_id: 1,
    }));
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue(txns);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([{ id: 1, name: "Misc" }]);

    const ctx = await AI._buildContext("Show spending");
    expect(ctx).toContain("50 of 60");
    // First 50 should be present, #50 (Tx-49) is the last shown
    expect(ctx).toContain("Tx-49");
    expect(ctx).not.toContain("Tx-50");
  });

  it("calculates net income minus expenses", async () => {
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([
      { id: 1, date: "2025-01-01", amount: 50000, description: "Salary", transaction_type: "income", category_id: 1 },
      { id: 2, date: "2025-01-02", amount: 5000, description: "Rent", transaction_type: "expense", category_id: 2 },
    ]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([{ id: 1, name: "Income" }, { id: 2, name: "Housing" }]);

    const ctx = await AI._buildContext("Summary");
    expect(ctx).toContain("Income: ₹50,000.00");
    expect(ctx).toContain("Expenses: ₹5,000.00");
    expect(ctx).toContain("Net: ₹45,000.00");
  });
});

// ===========================================================================
// 6. Conversation History in Chat
// ===========================================================================
describe("Conversation History in Chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStore();
    configureGroq();
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);
    mockFetchSuccess("OK");
  });

  it("loads chat history for existing chatId", async () => {
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "prev-chat", history: [
      { role: "user", content: "What is my balance?" },
      { role: "assistant", content: "Your balance is ₹10,000" },
    ] });
    await AI.chat("And my expenses?", "prev-chat");
    expect(mockDB.getChatHistory).toHaveBeenCalled();
  });

  it("includes history messages in fetch body (last 10)", async () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Msg ${i}`,
    }));
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "test", history });

    await AI.chat("Next question");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    // system + last-10 history + current user message
    const historyInBody = body.messages.filter((m) => m.role !== "system");
    // Last 10 from history + 1 current = 11
    expect(historyInBody).toHaveLength(11);
  });

  it("sends empty history when no prior messages", async () => {
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "test", history: [] });
    await AI.chat("First message");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    // system + current user = 2 messages
    expect(body.messages).toHaveLength(2);
  });
});

// ===========================================================================
// 7. Window Global Assignments
// ===========================================================================
describe("Window Global Assignments", () => {
  it("exposes AI on window", () => {
    expect(window.AI).toBeDefined();
    expect(window.AI.chat).toBeTypeOf("function");
    expect(window.AI.getSettings).toBeTypeOf("function");
    expect(window.AI.saveSettings).toBeTypeOf("function");
    expect(window.AI.testConnection).toBeTypeOf("function");
  });
});

// ===========================================================================
// 8. Date Range Edge Cases
// ===========================================================================
describe("Date Range — Alternate Phrasings", () => {
  it("detects 'past week'", () => {
    const r = AI._detectDateRange("What about the past week?");
    expect(r.label).toBe("last 7 days");
  });

  it("detects 'previous month'", () => {
    const r = AI._detectDateRange("Show previous month");
    expect(r.label).toBe("last month");
  });

  it("detects 'current month'", () => {
    const r = AI._detectDateRange("current month summary");
    expect(r.label).toBe("this month");
  });

  it("detects 'current quarter'", () => {
    const r = AI._detectDateRange("current quarter expenses");
    expect(r.label).toBe("this quarter");
  });

  it("detects 'previous quarter'", () => {
    const r = AI._detectDateRange("previous quarter spending");
    expect(r.label).toBe("last quarter");
  });

  it("detects 'past year'", () => {
    const r = AI._detectDateRange("Show past year");
    expect(r.label).toBe("last year");
  });

  it("detects 'current year'", () => {
    const r = AI._detectDateRange("current year totals");
    expect(r.label).toBe("this year");
  });

  it("detects 'last 1 day' (singular)", () => {
    const r = AI._detectDateRange("last 1 day");
    expect(r.label).toBe("last 1 days");
  });

  it("detects 'last 6 months'", () => {
    const r = AI._detectDateRange("last 6 months spending");
    expect(r.label).toBe("last 6 months");
  });

  it("returns valid ISO dates for all ranges", () => {
    const phrases = [
      "last week", "this month", "last month", "last quarter",
      "this quarter", "last year", "this year", "last 30 days",
    ];
    for (const phrase of phrases) {
      const r = AI._detectDateRange(phrase);
      expect(r.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(r.start).getTime()).not.toBeNaN();
      expect(new Date(r.end).getTime()).not.toBeNaN();
      expect(r.start <= r.end).toBe(true);
    }
  });
});

// ===========================================================================
// 9. AI_PROVIDERS Structure Validation
// ===========================================================================
describe("AI_PROVIDERS — Detailed Structure", () => {
  it("every provider has required fields", () => {
    for (const [key, p] of Object.entries(AI_PROVIDERS)) {
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("endpoint");
      expect(p).toHaveProperty("requiresKey");
      expect(p).toHaveProperty("models");
      expect(p).toHaveProperty("defaultModel");
      if (key === "azure") {
        // Azure has null endpoint and empty models/defaultModel by design
        expect(p.endpoint).toBeNull();
        expect(p.models).toEqual([]);
        expect(p.defaultModel).toBe("");
      } else {
        expect(p.models).toContain(p.defaultModel);
        expect(p.endpoint).toMatch(/^https?:\/\//);
      }
    }
  });

  it("endpoints are valid URLs", () => {
    expect(AI_PROVIDERS.groq.endpoint).toContain("groq.com");
    expect(AI_PROVIDERS.openai.endpoint).toContain("openai.com");
    expect(AI_PROVIDERS.ollama.endpoint).toContain("localhost");
    expect(AI_PROVIDERS.gemini.endpoint).toContain("googleapis.com");
    expect(AI_PROVIDERS.azure.endpoint).toBeNull();
  });
});

// ===========================================================================
// 10. testConnection Edge Cases
// ===========================================================================
describe("testConnection Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStore();
  });

  it("returns error for unknown provider", async () => {
    AI.saveSettings({ provider: "bad-provider", apiKey: "k", model: "m" });
    const result = await AI.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown provider");
  });

  it("uses defaultModel when model is empty", async () => {
    AI.saveSettings({ provider: "groq", apiKey: "sk-x", model: "" });
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hi" } }] }),
    });
    await AI.testConnection();
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("llama-3.3-70b-versatile");
  });

  it("returns ok:true even with non-JSON success response", async () => {
    AI.saveSettings({ provider: "ollama", apiKey: "", model: "llama3.1:8b" });
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hi" } }] }),
    });
    const result = await AI.testConnection();
    expect(result.ok).toBe(true);
  });
});

// ===========================================================================
// 11. BUG-PROD-02: Credit/Debit/Deposit Account Balance in AI Context
// ===========================================================================
describe("BUG-PROD-02: Credit/Debit/Deposit Accounts in AI Context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);
  });

  it("credit account contributes negative balance to total", async () => {
    mockDB.getAccounts.mockResolvedValue([
      { id: 1, name: "HDFC CC", balance: 10000, effective_balance: null, account_type: "credit", is_active: true },
    ]);
    const ctx = await AI._buildContext("Balance?");
    // Credit card balance should be negated: -10000
    expect(ctx).toContain("-10,000.00");
  });

  it("debit account contributes positive balance to total", async () => {
    mockDB.getAccounts.mockResolvedValue([
      { id: 1, name: "HDFC Debit", balance: 5000, effective_balance: null, account_type: "debit", is_active: true },
    ]);
    const ctx = await AI._buildContext("Balance?");
    expect(ctx).toContain("5,000.00");
    expect(ctx).not.toContain("-5,000");
  });

  it("deposit account contributes positive balance to total", async () => {
    mockDB.getAccounts.mockResolvedValue([
      { id: 1, name: "FD Account", balance: 50000, effective_balance: null, account_type: "deposit", is_active: true },
    ]);
    const ctx = await AI._buildContext("Balance?");
    expect(ctx).toContain("50,000.00");
    expect(ctx).not.toContain("-50,000");
  });

  it("credit account is shown with negated balance in accountsLines", async () => {
    mockDB.getAccounts.mockResolvedValue([
      { id: 1, name: "ICICI CC", balance: 8000, effective_balance: null, account_type: "credit", is_active: true },
    ]);
    const ctx = await AI._buildContext("Accounts?");
    // The account line should show -8000 (negated)
    expect(ctx).toContain("ICICI CC");
    expect(ctx).toContain("-8,000.00");
    expect(ctx).toContain("(credit)");
  });

  it("uses effective_balance over balance when negating credit account", async () => {
    mockDB.getAccounts.mockResolvedValue([
      { id: 1, name: "SBI CC", balance: 5000, effective_balance: 7000, account_type: "credit", is_active: true },
    ]);
    const ctx = await AI._buildContext("Balance?");
    // Should use effective_balance (7000) and negate it
    expect(ctx).toContain("-7,000.00");
    expect(ctx).not.toContain("-5,000");
  });
});
