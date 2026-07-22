/**
 * Unit tests for static/js/ai.js — AI chat layer.
 *
 * Mocks fetch and DB methods to test AI logic in isolation.
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

// Mock crypto.randomUUID
vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: vi.fn(() => "test-uuid-1234") });

// ---------------------------------------------------------------------------
// Mock DB — stub the methods AI uses
// ---------------------------------------------------------------------------
const mockDB = {
  getAccounts: vi.fn(async () => []),
  getTransactions: vi.fn(async () => []),
  getGoals: vi.fn(async () => []),
  getCategories: vi.fn(async () => []),
  saveChatMessage: vi.fn(async () => {}),
  getChatHistory: vi.fn(async () => ({ chat_id: "test", history: [] })),
};

// Mock the db.js module
vi.mock("../../static/js/db.js", () => ({ DB: mockDB }));

// Mock vault.js — default to configured + unlocked so most AI tests can keep
// using API keys without exercising the vault gate explicitly.
vi.mock("../../static/js/vault.js", () => ({
  Vault: {
    isConfigured: vi.fn(() => true),
    isUnlocked: vi.fn(() => true),
    saveAISettings: vi.fn(),
    clearAISettings: vi.fn(),
  },
}));

// Mock fetch globally
globalThis.fetch = vi.fn();

// Now import AI (after mocks are set up)
const { AI, AI_PROVIDERS } = await import("../../static/js/ai.js");
const { Vault } = await import("../../static/js/vault.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clearLocalStore() {
  for (const k of Object.keys(localStore)) delete localStore[k];
  AI.clearDecrypted();
  Vault.isConfigured.mockReturnValue(true);
  Vault.isUnlocked.mockReturnValue(true);
  Vault.saveAISettings.mockReset();
  Vault.saveAISettings.mockResolvedValue(undefined);
  Vault.clearAISettings.mockReset();
}

function mockFetchSuccess(content = "Hello! How can I help?") {
  globalThis.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  });
}

function mockFetchError(status, body = {}) {
  globalThis.fetch.mockResolvedValue({
    ok: false,
    status,
    text: async () => JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 1. AI_PROVIDERS
// ---------------------------------------------------------------------------
describe("AI_PROVIDERS", () => {
  it("has groq, openai, ollama, gemini, and azure providers", () => {
    expect(Object.keys(AI_PROVIDERS)).toEqual(["groq", "openai", "ollama", "gemini", "azure"]);
  });

  it("groq requires an API key", () => {
    expect(AI_PROVIDERS.groq.requiresKey).toBe(true);
    expect(AI_PROVIDERS.groq.models.length).toBeGreaterThan(0);
  });

  it("ollama does not require an API key", () => {
    expect(AI_PROVIDERS.ollama.requiresKey).toBe(false);
  });

  it("gemini has requiresKey, 4 models, correct defaultModel, and googleapis endpoint", () => {
    expect(AI_PROVIDERS.gemini.requiresKey).toBe(true);
    expect(AI_PROVIDERS.gemini.models).toHaveLength(4);
    expect(AI_PROVIDERS.gemini.defaultModel).toBe("gemini-3.1-flash-lite");
    expect(AI_PROVIDERS.gemini.endpoint).toContain("googleapis.com");
  });

  it("azure has requiresKey, null endpoint, empty models, and empty defaultModel", () => {
    expect(AI_PROVIDERS.azure.requiresKey).toBe(true);
    expect(AI_PROVIDERS.azure.endpoint).toBeNull();
    expect(AI_PROVIDERS.azure.models).toEqual([]);
    expect(AI_PROVIDERS.azure.defaultModel).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 2. Settings Management
// ---------------------------------------------------------------------------
describe("Settings Management", () => {
  beforeEach(clearLocalStore);

  it("returns defaults when no settings saved", () => {
    const s = AI.getSettings();
    expect(s).toEqual({
      provider: null,
      apiKey: "",
      model: "",
      azureResourceName: "",
      azureDeploymentName: "",
      azureApiVersion: "",
      ollamaBaseUrl: "",
    });
  });

  it("tracks external AI consent per provider", () => {
    expect(AI.hasExternalConsent("groq")).toBe(false);
    AI.grantExternalConsent("groq", "test");
    expect(AI.hasExternalConsent("groq")).toBe(true);
    expect(AI.hasExternalConsent("openai")).toBe(false);
    AI.revokeExternalConsent();
    expect(AI.hasExternalConsent("groq")).toBe(false);
  });

  it("does not require consent for Ollama", () => {
    expect(AI.requiresExternalConsent("ollama")).toBe(false);
    expect(AI.hasExternalConsent("ollama")).toBe(true);
  });

  it("stores public settings locally and secret settings in the vault", async () => {
    await AI.saveSettings({
      provider: "groq",
      apiKey: "sk-test",
      model: "llama-3.3-70b-versatile",
      azureResourceName: "",
      azureDeploymentName: "",
      azureApiVersion: "",
    });

    const s = AI.getSettings();
    expect(s.provider).toBe("groq");
    expect(s.apiKey).toBe("sk-test");
    expect(s.model).toBe("llama-3.3-70b-versatile");
    expect(s.azureResourceName).toBe("");
    expect(s.azureDeploymentName).toBe("");
    expect(s.azureApiVersion).toBe("");
    expect(JSON.parse(localStore["fincoach-ai-settings"])).toEqual({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      azureResourceName: "",
      azureDeploymentName: "",
      azureApiVersion: "",
      ollamaBaseUrl: "",
    });
    expect(Vault.saveAISettings).toHaveBeenCalledWith({ apiKey: "sk-test" });
  });

  it("saves public settings but blocks plaintext API key storage when the vault is unavailable", async () => {
    Vault.isConfigured.mockReturnValue(false);
    Vault.isUnlocked.mockReturnValue(false);

    const result = await AI.saveSettings({
      provider: "groq",
      apiKey: "sk-test",
      model: "llama-3.3-70b-versatile",
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, publicSaved: true, secretSaved: false }),
    );
    expect(JSON.parse(localStore["fincoach-ai-settings"])).toEqual({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      azureResourceName: "",
      azureDeploymentName: "",
      azureApiVersion: "",
      ollamaBaseUrl: "",
    });
    expect(AI.getSettings().apiKey).toBe("");
    expect(Vault.saveAISettings).not.toHaveBeenCalled();
  });

  it("saves public settings but requires unlock before saving an API key when the vault is locked", async () => {
    Vault.isConfigured.mockReturnValue(true);
    Vault.isUnlocked.mockReturnValue(false);

    const result = await AI.saveSettings({
      provider: "openai",
      apiKey: "sk-locked",
      model: "gpt-4o",
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        publicSaved: true,
        secretSaved: false,
        vaultRequired: true,
        error: "Unlock your PIN before saving an AI API key.",
      }),
    );
    expect(JSON.parse(localStore["fincoach-ai-settings"])).toEqual({
      provider: "openai",
      model: "gpt-4o",
      azureResourceName: "",
      azureDeploymentName: "",
      azureApiVersion: "",
      ollamaBaseUrl: "",
    });
    expect(AI.getSettings().apiKey).toBe("");
    expect(Vault.saveAISettings).not.toHaveBeenCalled();
  });

  it("saves and retrieves azure-specific settings", async () => {
    await AI.saveSettings({
      provider: "azure",
      apiKey: "my-azure-key",
      model: "",
      azureResourceName: "my-resource",
      azureDeploymentName: "gpt-4o",
      azureApiVersion: "2024-06-01",
    });
    const s = AI.getSettings();
    expect(s.provider).toBe("azure");
    expect(s.apiKey).toBe("my-azure-key");
    expect(s.azureResourceName).toBe("my-resource");
    expect(s.azureDeploymentName).toBe("gpt-4o");
    expect(s.azureApiVersion).toBe("2024-06-01");
  });

  it("fills in missing azure fields with empty strings", () => {
    localStore["fincoach-ai-settings"] = JSON.stringify({ provider: "groq", apiKey: "k", model: "m" });
    const s = AI.getSettings();
    expect(s.azureResourceName).toBe("");
    expect(s.azureDeploymentName).toBe("");
    expect(s.azureApiVersion).toBe("");
  });

  it("handles corrupt localStorage data gracefully", () => {
    localStore["fincoach-ai-settings"] = "not-json{{{";
    const s = AI.getSettings();
    expect(s).toEqual({
      provider: null,
      apiKey: "",
      model: "",
      azureResourceName: "",
      azureDeploymentName: "",
      azureApiVersion: "",
      ollamaBaseUrl: "",
    });
  });

  it("fills in missing fields with defaults", () => {
    localStore["fincoach-ai-settings"] = JSON.stringify({ provider: "openai" });
    const s = AI.getSettings();
    expect(s.provider).toBe("openai");
    expect(s.apiKey).toBe("");
    expect(s.model).toBe("");
  });

  it("migrates legacy plaintext API keys into the vault and scrubs localStorage", async () => {
    localStore["fincoach-ai-settings"] = JSON.stringify({
      provider: "openai",
      apiKey: "legacy-key",
      model: "gpt-4o",
    });

    await AI.hydrateVaultSettings(null);

    expect(Vault.saveAISettings).toHaveBeenCalledWith({ apiKey: "legacy-key" });
    expect(JSON.parse(localStore["fincoach-ai-settings"])).toEqual({
      provider: "openai",
      model: "gpt-4o",
      azureResourceName: "",
      azureDeploymentName: "",
      azureApiVersion: "",
      ollamaBaseUrl: "",
    });
    expect(AI.getSettings().apiKey).toBe("legacy-key");
  });

  it("unlock with only {apiKey} in the vault does not erase public settings (bug repro)", async () => {
    // localStorage absent; vault blob only holds the secret.
    delete localStore["fincoach-ai-settings"];

    await AI.hydrateVaultSettings({ apiKey: "sk" });

    // Secret survives.
    expect(AI.getSettings().apiKey).toBe("sk");
    // Public fields are NOT erased — remain defaults, and localStorage is not
    // overwritten with a stale null/empty public object.
    expect(AI.getSettings().provider).toBeNull();
    expect(AI.getSettings().model).toBe("");
    expect(localStore["fincoach-ai-settings"]).toBeUndefined();
  });

  it("hydrate preserves localStorage public when the vault holds only {apiKey}", async () => {
    localStore["fincoach-ai-settings"] = JSON.stringify({
      provider: "openai",
      model: "gpt-4o",
    });

    await AI.hydrateVaultSettings({ apiKey: "sk" });

    const stored = JSON.parse(localStore["fincoach-ai-settings"]);
    expect(stored.provider).toBe("openai");
    expect(stored.model).toBe("gpt-4o");
    const s = AI.getSettings();
    expect(s.provider).toBe("openai");
    expect(s.model).toBe("gpt-4o");
    expect(s.apiKey).toBe("sk");
  });

  it("migrates legacy vault-stored public settings into localStorage", async () => {
    delete localStore["fincoach-ai-settings"];

    await AI.hydrateVaultSettings({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      apiKey: "sk",
    });

    const stored = JSON.parse(localStore["fincoach-ai-settings"]);
    expect(stored.provider).toBe("groq");
    expect(stored.model).toBe("llama-3.3-70b-versatile");
    expect(Vault.saveAISettings).toHaveBeenCalledWith({ apiKey: "sk" });
    const s = AI.getSettings();
    expect(s.provider).toBe("groq");
    expect(s.model).toBe("llama-3.3-70b-versatile");
    expect(s.apiKey).toBe("sk");
  });
});

// ---------------------------------------------------------------------------
// 3. Question Type Detection
// ---------------------------------------------------------------------------
describe("Question Type Detection", () => {
  it("detects purchase_decision", () => {
    expect(AI._detectQuestionType("Should I buy a new laptop?")).toBe("purchase_decision");
    expect(AI._detectQuestionType("Should I purchase this phone?")).toBe("purchase_decision");
    expect(AI._detectQuestionType("Can I afford a vacation?")).toBe("purchase_decision");
  });

  it("detects status_query", () => {
    expect(AI._detectQuestionType("How much did I spend?")).toBe("status_query");
    expect(AI._detectQuestionType("What's my balance?")).toBe("status_query");
    expect(AI._detectQuestionType("What is my total savings?")).toBe("status_query");
  });

  it("detects spending_analysis", () => {
    expect(AI._detectQuestionType("Am I spending too much on food?")).toBe("spending_analysis");
    expect(AI._detectQuestionType("How is my spending on entertainment?")).toBe(
      "spending_analysis",
    );
    expect(AI._detectQuestionType("Am I wasting money on food waste?")).toBe("spending_analysis");
  });

  it("detects goal_progress", () => {
    expect(AI._detectQuestionType("How is my goal progress?")).toBe("goal_progress");
    expect(AI._detectQuestionType("Am I saving for a house?")).toBe("goal_progress");
    expect(AI._detectQuestionType("Will I reach my target?")).toBe("goal_progress");
  });

  it("detects optimization", () => {
    expect(AI._detectQuestionType("Help me save more money")).toBe("optimization");
    expect(AI._detectQuestionType("How can I reduce spending?")).toBe("optimization");
    expect(AI._detectQuestionType("I want to cut costs")).toBe("optimization");
  });

  it("defaults to general", () => {
    expect(AI._detectQuestionType("Tell me something about my finances")).toBe("general");
    expect(AI._detectQuestionType("Hello")).toBe("general");
  });
});

// ---------------------------------------------------------------------------
// 4. Date Range Detection
// ---------------------------------------------------------------------------
describe("Date Range Detection", () => {
  it("detects last week", () => {
    const result = AI._detectDateRange("What did I spend last week?");
    expect(result.label).toBe("last 7 days");
    expect(result.start).toBeDefined();
    expect(result.end).toBeDefined();
  });

  it("detects this month", () => {
    const result = AI._detectDateRange("Spending this month");
    expect(result.label).toBe("this month");
  });

  it("detects last month", () => {
    const result = AI._detectDateRange("Show me last month spending");
    expect(result.label).toBe("last month");
  });

  it("detects last quarter", () => {
    const result = AI._detectDateRange("What about last quarter?");
    expect(result.label).toBe("last quarter");
  });

  it("detects this quarter", () => {
    const result = AI._detectDateRange("this quarter summary");
    expect(result.label).toBe("this quarter");
  });

  it("detects last year", () => {
    const result = AI._detectDateRange("Show me last year");
    expect(result.label).toBe("last year");
  });

  it("detects this year", () => {
    const result = AI._detectDateRange("Summary for this year");
    expect(result.label).toBe("this year");
  });

  it("detects specific month names", () => {
    const result = AI._detectDateRange("What did I spend in January?");
    expect(result.label).toMatch(/January/);
  });

  it("detects abbreviated month names", () => {
    const result = AI._detectDateRange("Show me spending in Feb");
    expect(result.label).toMatch(/February/);
  });

  it("detects last N days", () => {
    const result = AI._detectDateRange("Show last 14 days");
    expect(result.label).toBe("last 14 days");
  });

  it("detects last N months", () => {
    const result = AI._detectDateRange("Show last 3 months");
    expect(result.label).toBe("last 3 months");
  });

  it("defaults to last 30 days", () => {
    const result = AI._detectDateRange("How is my financial health?");
    expect(result.label).toBe("last 30 days");
  });
});

// ---------------------------------------------------------------------------
// 5. Context Building
// ---------------------------------------------------------------------------
describe("Context Building", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDB.getAccounts.mockResolvedValue([
      {
        id: 1,
        name: "Savings",
        balance: 50000,
        account_type: "savings",
        is_active: true,
        effective_balance: 50000,
      },
    ]);
    mockDB.getTransactions.mockResolvedValue([
      {
        id: 1,
        date: "2025-01-10",
        amount: 500,
        description: "Grocery shopping",
        transaction_type: "expense",
        category_id: 2,
      },
      {
        id: 2,
        date: "2025-01-05",
        amount: 30000,
        description: "Salary",
        transaction_type: "income",
        category_id: 12,
      },
    ]);
    mockDB.getGoals.mockResolvedValue([
      {
        id: 1,
        name: "Emergency Fund",
        target_amount: 100000,
        current_amount: 50000,
        deadline: "2025-12-31",
      },
    ]);
    mockDB.getCategories.mockResolvedValue([
      { id: 2, name: "Groceries" },
      { id: 12, name: "Income" },
    ]);
  });

  it("calls DB methods for data", async () => {
    await AI._buildContext("How am I doing?");
    expect(mockDB.getAccounts).toHaveBeenCalled();
    expect(mockDB.getTransactions).toHaveBeenCalled();
    expect(mockDB.getGoals).toHaveBeenCalled();
    expect(mockDB.getCategories).toHaveBeenCalled();
  });

  it("includes financial snapshot in output", async () => {
    const ctx = await AI._buildContext("How am I doing?");
    expect(ctx).toContain("FINANCIAL SNAPSHOT");
    expect(ctx).toContain("Account 1");
    expect(ctx).toContain("50,000");
  });

  it("includes transactions summary", async () => {
    const ctx = await AI._buildContext("Show my spending");
    expect(ctx).toContain("Grocery shopping");
    expect(ctx).toContain("Salary");
  });

  it("includes goals summary", async () => {
    const ctx = await AI._buildContext("Goal progress");
    expect(ctx).toContain("Goal 1");
    expect(ctx).toContain("50.0% complete");
  });

  it("passes date range to getTransactions", async () => {
    await AI._buildContext("Show spending this month");
    const callArgs = mockDB.getTransactions.mock.calls[0][0];
    expect(callArgs).toHaveProperty("date_from");
    expect(callArgs).toHaveProperty("date_to");
  });

  it("_buildContext masks PII in transaction descriptions", async () => {
    mockDB.getTransactions.mockResolvedValue([
      {
        id: 3,
        date: "2025-01-12",
        amount: -1000,
        description: "From: Ramesh Kumar",
        transaction_type: "expense",
        category_id: 2,
      },
    ]);
    const context = await AI._buildContext("test question");
    expect(context.includes("Ramesh Kumar")).toBe(false);
    expect(context.includes("Ra****")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Prompt Building
// ---------------------------------------------------------------------------
describe("Prompt Building", () => {
  it("uses correct template for purchase_decision", () => {
    const prompt = AI._buildPrompt("Should I buy a car?", "context here", []);
    expect(prompt).toContain("PURCHASE DECISION");
    expect(prompt).toContain("context here");
  });

  it("uses correct template for spending_analysis", () => {
    const prompt = AI._buildPrompt("Am I spending too much?", "ctx", []);
    expect(prompt).toContain("SPENDING ANALYSIS");
  });

  it("uses correct template for goal_progress", () => {
    const prompt = AI._buildPrompt("How is my goal?", "ctx", []);
    expect(prompt).toContain("GOAL PROGRESS");
  });

  it("uses correct template for optimization", () => {
    const prompt = AI._buildPrompt("Help me save money", "ctx", []);
    expect(prompt).toContain("OPTIMIZATION");
  });

  it("uses correct template for status_query", () => {
    const prompt = AI._buildPrompt("What's my balance?", "ctx", []);
    expect(prompt).toContain("STATUS QUERY");
  });

  it("uses general template for unknown types", () => {
    const prompt = AI._buildPrompt("Hello there", "ctx", []);
    expect(prompt).toContain("Be conversational and helpful");
  });

  it("includes conversation history when provided", () => {
    const history = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];
    const prompt = AI._buildPrompt("Thanks", "ctx", history);
    expect(prompt).toContain("CONVERSATION HISTORY");
    expect(prompt).toContain("You: Hi");
    expect(prompt).toContain("Assistant: Hello!");
  });

  it("omits history section when empty", () => {
    const prompt = AI._buildPrompt("Hello", "ctx", []);
    expect(prompt).not.toContain("CONVERSATION HISTORY");
  });

  it("masks PII in conversation history content", () => {
    const history = [
      { role: "user", content: "My number is 9876543210" },
      { role: "assistant", content: "Got it." },
    ];
    const prompt = AI._buildPrompt("Thanks", "ctx", history);
    expect(prompt).not.toContain("9876543210");
    expect(prompt).toContain("*******210");
  });

  it("ends with 'Your response:'", () => {
    const prompt = AI._buildPrompt("Hello", "ctx", []);
    expect(prompt).toContain("Your response:");
  });
});

// ---------------------------------------------------------------------------
// 7. Chat — Happy Path
// ---------------------------------------------------------------------------
describe("Chat — Happy Path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStore();
    AI.saveSettings({ provider: "groq", apiKey: "sk-test", model: "llama-3.3-70b-versatile" });
    AI.grantExternalConsent("groq", "test");
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "test", history: [] });
    mockFetchSuccess("Here is my advice...");
  });

  it("generates a chatId when none provided", async () => {
    const result = await AI.chat("Hello");
    expect(result.chat_id).toBe("test-uuid-1234");
  });

  it("reuses provided chatId", async () => {
    const result = await AI.chat("Hello", "existing-chat-id");
    expect(result.chat_id).toBe("existing-chat-id");
  });

  it("saves user message to DB", async () => {
    await AI.chat("Hello");
    expect(mockDB.saveChatMessage).toHaveBeenCalledWith(
      "test-uuid-1234",
      "user",
      "Hello",
    );
  });

  it("saves assistant response to DB", async () => {
    await AI.chat("Hello");
    expect(mockDB.saveChatMessage).toHaveBeenCalledWith(
      "test-uuid-1234",
      "assistant",
      "Here is my advice...",
    );
  });

  it("returns correct shape", async () => {
    const result = await AI.chat("Hello");
    expect(result).toHaveProperty("response", "Here is my advice...");
    expect(result).toHaveProperty("model_used", "llama-3.3-70b-versatile");
    expect(result).toHaveProperty("chat_id");
  });

  it("calls fetch with correct endpoint", async () => {
    await AI.chat("Hello");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("includes authorization header for groq", async () => {
    await AI.chat("Hello");
    const fetchCall = globalThis.fetch.mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer sk-test");
  });

  it("masks PII in conversation history sent to provider", async () => {
    mockDB.getChatHistory.mockResolvedValue({
      chat_id: "test",
      history: [
        { role: "user", content: "Call me at 9876543210" },
        { role: "assistant", content: "Got it." },
      ],
    });
    await AI.chat("What did I say?");
    const fetchCall = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    // Find history messages (not system prompt, not last user message)
    const historyMessages = body.messages.filter(
      (m) => m.role !== "system" && m.content !== "What did I say?",
    );
    const historyContent = historyMessages.map((m) => m.content).join(" ");
    expect(historyContent).not.toContain("9876543210");
    expect(historyContent).toContain("*******210");
  });

  it("falls back to heuristic mode until external consent is granted", async () => {
    AI.revokeExternalConsent();
    const result = await AI.chat("Hello");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.model_used).toBe("heuristic");
    expect(result.consent_required).toBe(true);
    expect(result.response).toContain("External AI is configured but not yet enabled");
  });

  it("masks the current user message before sending to the provider", async () => {
    AI.grantExternalConsent("groq", "test");
    await AI.chat("My UPI is paytm-blinkit@ptybl");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    const currentMessage = body.messages[body.messages.length - 1].content;
    expect(currentMessage).not.toContain("paytm-blinkit@ptybl");
    expect(currentMessage).toContain("pa***@[UPI]");
  });
});

// ---------------------------------------------------------------------------
// 8. Provider Switching
// ---------------------------------------------------------------------------
describe("Provider Switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStore();
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "test", history: [] });
    mockFetchSuccess("OK");
  });

  it("uses OpenAI endpoint when configured", async () => {
    AI.saveSettings({ provider: "openai", apiKey: "sk-oai", model: "gpt-4o-mini" });
    AI.grantExternalConsent("openai", "test");
    await AI.chat("Test");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.anything(),
    );
  });

  it("uses Ollama endpoint without auth header", async () => {
    AI.saveSettings({ provider: "ollama", apiKey: "", model: "llama3.1:8b" });
    await AI.chat("Test");
    const fetchCall = globalThis.fetch.mock.calls[0];
    expect(fetchCall[0]).toBe("http://localhost:11434/v1/chat/completions");
    expect(fetchCall[1].headers.Authorization).toBeUndefined();
  });

  it("uses Gemini endpoint when configured", async () => {
    AI.saveSettings({ provider: "gemini", apiKey: "gemini-key", model: "gemini-2.0-flash" });
    AI.grantExternalConsent("gemini", "test");
    await AI.chat("Test");
    const fetchCall = globalThis.fetch.mock.calls[0];
    expect(fetchCall[0]).toContain("googleapis.com");
    expect(fetchCall[0]).toContain("gemini-2.0-flash:generateContent");
    expect(fetchCall[0]).toContain("key=gemini-key");
    expect(fetchCall[1].headers.Authorization).toBeUndefined();
  });

  it("azure chat uses api-key header not Authorization", async () => {
    AI.saveSettings({
      provider: "azure",
      apiKey: "azure-key",
      model: "",
      azureResourceName: "my-resource",
      azureDeploymentName: "gpt-4o",
      azureApiVersion: "2024-06-01",
    });
    AI.grantExternalConsent("azure", "test");
    await AI.chat("Test");
    const fetchCall = globalThis.fetch.mock.calls[0];
    expect(fetchCall[1].headers["api-key"]).toBe("azure-key");
    expect(fetchCall[1].headers.Authorization).toBeUndefined();
  });

  it("azure chat builds endpoint from resource and deployment names", async () => {
    AI.saveSettings({
      provider: "azure",
      apiKey: "azure-key",
      model: "",
      azureResourceName: "my-resource",
      azureDeploymentName: "gpt-4o",
      azureApiVersion: "2024-06-01",
    });
    AI.grantExternalConsent("azure", "test");
    await AI.chat("Test");
    const fetchUrl = globalThis.fetch.mock.calls[0][0];
    expect(fetchUrl).toContain("my-resource.openai.azure.com");
    expect(fetchUrl).toContain("gpt-4o");
  });

  it("azure chat omits model field from request body", async () => {
    AI.saveSettings({
      provider: "azure",
      apiKey: "azure-key",
      model: "",
      azureResourceName: "my-resource",
      azureDeploymentName: "gpt-4o",
      azureApiVersion: "2024-06-01",
    });
    AI.grantExternalConsent("azure", "test");
    await AI.chat("Test");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.model).toBeUndefined();
  });

  it("azure chat returns error when resource name missing", async () => {
    AI.saveSettings({
      provider: "azure",
      apiKey: "azure-key",
      model: "",
      azureResourceName: "",
      azureDeploymentName: "gpt-4o",
      azureApiVersion: "",
    });
    AI.grantExternalConsent("azure", "test");
    const result = await AI.chat("Test");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("azure chat returns error when deployment name missing", async () => {
    AI.saveSettings({
      provider: "azure",
      apiKey: "azure-key",
      model: "",
      azureResourceName: "my-resource",
      azureDeploymentName: "",
      azureApiVersion: "",
    });
    AI.grantExternalConsent("azure", "test");
    const result = await AI.chat("Test");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Error Handling
// ---------------------------------------------------------------------------
describe("Error Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStore();
    mockDB.getAccounts.mockResolvedValue([]);
    mockDB.getTransactions.mockResolvedValue([]);
    mockDB.getGoals.mockResolvedValue([]);
    mockDB.getCategories.mockResolvedValue([]);
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "test", history: [] });
  });

  it("returns config message when no provider set", async () => {
    const result = await AI.chat("Hello");
    expect(result.response).toContain("configure");
    expect(result.model_used).toBe("heuristic");
  });

  it("handles 401 unauthorized", async () => {
    AI.saveSettings({ provider: "groq", apiKey: "sk-test", model: "llama-3.3-70b-versatile" });
    AI.grantExternalConsent("groq", "test");
    mockFetchError(401, { error: { message: "Invalid API key" } });
    const result = await AI.chat("Hello");
    expect(result.response).toContain("Invalid API key");
  });

  it("handles 429 rate limit", async () => {
    AI.saveSettings({ provider: "groq", apiKey: "sk-test", model: "llama-3.3-70b-versatile" });
    AI.grantExternalConsent("groq", "test");
    mockFetchError(429, { error: { message: "Rate limit exceeded" } });
    const result = await AI.chat("Hello");
    expect(result.response).toContain("Rate limit exceeded");
  });

  it("handles network failure", async () => {
    AI.saveSettings({ provider: "groq", apiKey: "sk-test", model: "llama-3.3-70b-versatile" });
    AI.grantExternalConsent("groq", "test");
    globalThis.fetch.mockRejectedValue(new Error("Network unreachable"));
    const result = await AI.chat("Hello");
    expect(result.response).toContain("Network error");
    expect(result.response).toContain("Network unreachable");
  });

  it("handles unknown provider", async () => {
    AI.saveSettings({ provider: "unknown", apiKey: "mystery-key", model: "m" });
    AI.grantExternalConsent("unknown", "test");
    const result = await AI.chat("Hello");
    expect(result.response).toContain("Unknown AI provider");
  });
});

// ---------------------------------------------------------------------------
// 10. Test Connection
// ---------------------------------------------------------------------------
describe("Test Connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStore();
  });

  it("returns ok:true on successful connection", async () => {
    AI.saveSettings({ provider: "groq", apiKey: "sk-test", model: "llama-3.3-70b-versatile" });
    mockFetchSuccess("Hello!");
    const result = await AI.testConnection();
    expect(result).toEqual({ ok: true });
  });

  it("returns error when no provider configured", async () => {
    const result = await AI.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No AI provider");
  });

  it("returns error when API key missing for key-required provider", async () => {
    AI.saveSettings({ provider: "groq", apiKey: "", model: "llama-3.3-70b-versatile" });
    const result = await AI.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("API key is required");
  });

  it("returns error on API failure", async () => {
    AI.saveSettings({ provider: "openai", apiKey: "sk-bad", model: "gpt-4o-mini" });
    mockFetchError(401, { error: { message: "Unauthorized" } });
    const result = await AI.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unauthorized");
  });

  it("returns error on network failure", async () => {
    AI.saveSettings({ provider: "ollama", apiKey: "", model: "llama3.1:8b" });
    globalThis.fetch.mockRejectedValue(new Error("Connection refused"));
    const result = await AI.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Connection refused");
  });

  it("azure testConnection uses api-key header and built endpoint", async () => {
    AI.saveSettings({
      provider: "azure",
      apiKey: "azure-key",
      model: "",
      azureResourceName: "my-resource",
      azureDeploymentName: "gpt-4o",
      azureApiVersion: "2024-06-01",
    });
    mockFetchSuccess("Hello!");
    const result = await AI.testConnection();
    expect(result.ok).toBe(true);
    const fetchCall = globalThis.fetch.mock.calls[0];
    expect(fetchCall[0]).toContain("my-resource.openai.azure.com");
    expect(fetchCall[1].headers["api-key"]).toBe("azure-key");
    expect(fetchCall[1].headers.Authorization).toBeUndefined();
  });

  it("azure testConnection fails when resource name is empty", async () => {
    AI.saveSettings({
      provider: "azure",
      apiKey: "k",
      model: "",
      azureResourceName: "",
      azureDeploymentName: "gpt-4o",
      azureApiVersion: "",
    });
    const result = await AI.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("resource name");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("azure testConnection fails when deployment name is empty", async () => {
    AI.saveSettings({
      provider: "azure",
      apiKey: "k",
      model: "",
      azureResourceName: "my-resource",
      azureDeploymentName: "",
      azureApiVersion: "",
    });
    const result = await AI.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("deployment name");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 11. Chat — Heuristic Mode (no provider)
// ---------------------------------------------------------------------------
describe("Chat — Heuristic Mode (no provider)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStore();
    mockDB.getAccounts.mockResolvedValue([
      {
        id: 1,
        name: "Savings",
        balance: 50000,
        account_type: "savings",
        is_active: true,
        effective_balance: 50000,
      },
    ]);
    mockDB.getTransactions.mockResolvedValue([
      {
        id: 1,
        date: "2026-05-01",
        amount: 500,
        description: "Grocery shopping",
        transaction_type: "expense",
        category_id: 1,
      },
      {
        id: 2,
        date: "2026-05-05",
        amount: 30000,
        description: "Salary",
        transaction_type: "income",
        category_id: 2,
      },
    ]);
    mockDB.getGoals.mockResolvedValue([
      {
        id: 1,
        name: "Emergency Fund",
        target_amount: 100000,
        current_amount: 50000,
        deadline: "2026-12-31",
      },
    ]);
    mockDB.getCategories.mockResolvedValue([
      { id: 1, name: "Groceries" },
      { id: 2, name: "Income" },
    ]);
  });

  it("when no provider configured, returns model_used: heuristic", async () => {
    const result = await AI.chat("How am I doing?");
    expect(result.model_used).toBe("heuristic");
  });

  it("when no provider, saves user and assistant messages to DB", async () => {
    await AI.chat("How am I doing?");
    expect(mockDB.saveChatMessage).toHaveBeenCalledWith(
      expect.any(String),
      "user",
      "How am I doing?",
    );
    expect(mockDB.saveChatMessage).toHaveBeenCalledWith(
      expect.any(String),
      "assistant",
      expect.any(String),
    );
    expect(mockDB.saveChatMessage).toHaveBeenCalledTimes(2);
  });

  it("when no provider, response contains CTA text", async () => {
    const result = await AI.chat("How am I doing?");
    expect(result.response).toContain("configure an AI provider");
  });

  it("when no provider and status_query, response contains Financial Status", async () => {
    const result = await AI.chat("What's my balance?");
    expect(result.response).toMatch(/Financial Status|Total Balance/);
  });

  it("when no provider and goal_progress, response contains goal name", async () => {
    const result = await AI.chat("How is my goal progress?");
    expect(result.response).toContain("Emergency Fund");
  });

  it("when no provider and spending_analysis, response contains Spending", async () => {
    const result = await AI.chat("Am I spending too much on food?");
    expect(result.response).toMatch(/Spending|Groceries/i);
  });

  it("when no provider and purchase_decision, response contains Purchase Decision", async () => {
    const result = await AI.chat("Should I buy a new laptop?");
    expect(result.response).toContain("Purchase Decision");
  });

  it("when no provider and general question, response contains Financial Snapshot or configured", async () => {
    const result = await AI.chat("Tell me something interesting");
    expect(result.response).toMatch(/Financial Snapshot|configured/i);
  });

  it("_buildHeuristicResponse returns a non-empty string for each question type", async () => {
    const questions = [
      "What's my balance?",
      "How is my goal progress?",
      "Am I spending too much on food?",
      "Should I buy a phone?",
      "Help me save money",
      "Hello there",
    ];
    for (const q of questions) {
      const response = await AI._buildHeuristicResponse(q);
      expect(typeof response).toBe("string");
      expect(response.length).toBeGreaterThan(0);
    }
  });

  it("when provider IS configured, does NOT return model_used: heuristic", async () => {
    AI.saveSettings({ provider: "groq", apiKey: "sk-test", model: "llama-3.3-70b-versatile" });
    AI.grantExternalConsent("groq", "test");
    mockDB.getChatHistory.mockResolvedValue({ chat_id: "test", history: [] });
    mockFetchSuccess("Here is my advice...");
    const result = await AI.chat("How am I doing?");
    expect(result.model_used).not.toBe("heuristic");
  });
});

// ---------------------------------------------------------------------------
// 12. Vault / _decrypted cache
// ---------------------------------------------------------------------------

describe("Vault / _decrypted cache", () => {
  beforeEach(() => {
    clearLocalStore();
    Vault.isConfigured.mockReturnValue(false);
    Vault.isUnlocked.mockReturnValue(false);
  });

  it("setDecrypted supplies only the secret apiKey; public fields come from localStorage", () => {
    localStore["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
    });
    AI.setDecrypted({ apiKey: "from-vault" });
    const s = AI.getSettings();
    expect(s.provider).toBe("groq");
    expect(s.model).toBe("llama-3.3-70b-versatile");
    expect(s.apiKey).toBe("from-vault");
  });

  it("empty decrypted public fields do not clobber good localStorage public settings", () => {
    localStore["fincoach-ai-settings"] = JSON.stringify({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
    });
    // Simulate an unlock that only seeds the secret in the decrypted cache.
    AI.setDecrypted({ apiKey: "sk" });
    const s = AI.getSettings();
    expect(s.provider).toBe("groq");
    expect(s.model).toBe("llama-3.3-70b-versatile");
    expect(s.apiKey).toBe("sk");
  });

  it("clearDecrypted() → getSettings() reads from localStorage again", () => {
    AI.setDecrypted({ apiKey: "from-vault" });
    localStore["fincoach-ai-settings"] = JSON.stringify({ provider: "openai" });
    AI.clearDecrypted();
    const s = AI.getSettings();
    expect(s.provider).toBe("openai");
    expect(s.apiKey).toBe("");
  });

  it("saveSettings() returns a Promise (is async)", () => {
    const result = AI.saveSettings({ provider: "groq", apiKey: "k", model: "m" });
    expect(result).toBeInstanceOf(Promise);
  });

  it("saveSettings() when vault not configured → keeps only public settings in localStorage", async () => {
    Vault.isConfigured.mockReturnValue(false);
    await AI.saveSettings({ provider: "groq", apiKey: "sk-test", model: "llama-3.3-70b-versatile" });
    const raw = localStore["fincoach-ai-settings"];
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.provider).toBe("groq");
    expect(parsed.apiKey).toBeUndefined();
  });

  it("saveSettings() when vault is configured+unlocked → calls Vault.saveAISettings()", async () => {
    Vault.isConfigured.mockReturnValue(true);
    Vault.isUnlocked.mockReturnValue(true);
    Vault.saveAISettings.mockResolvedValue(undefined);
    await AI.saveSettings({ provider: "groq", apiKey: "sk-test" });
    expect(Vault.saveAISettings).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(JSON.parse(localStore["fincoach-ai-settings"])).toEqual({
      provider: "groq",
      model: "",
      azureResourceName: "",
      azureDeploymentName: "",
      azureApiVersion: "",
      ollamaBaseUrl: "",
    });
  });
});
