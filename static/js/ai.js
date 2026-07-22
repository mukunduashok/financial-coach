/**
 * ai.js — AI chat layer for Financial Coach PWA.
 *
 * Direct REST calls to Groq/OpenAI/Ollama APIs (replaces LangChain).
 * Ports prompt logic from app/ai_agent.py to run entirely in the browser.
 */
import { AI_EXTERNAL_CONSENT_KEY, AI_SETTINGS_KEY } from "./config.js";
import { DB } from "./db.js";
import { fetchWithTimeout, maskPII } from "./utils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_DAYS_LOOKBACK = 30;
const LOOKBACK_MAX_TRANSACTIONS = 50;
const LOOKBACK_LAST_WEEK = 7;
const MAX_CONVERSATION_MESSAGES = 5;
const BALANCE_ACCOUNT_TYPES = new Set([
  "checking",
  "savings",
  "wallet",
  "current",
  "credit",
  "debit",
  "deposit",
]);
const AZURE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}[a-zA-Z0-9]$/;

// ---------------------------------------------------------------------------
// Provider Configuration
// ---------------------------------------------------------------------------
export const AI_PROVIDERS = {
  groq: {
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    requiresKey: true,
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    defaultModel: "llama-3.3-70b-versatile",
  },
  openai: {
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    requiresKey: true,
    models: ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
    defaultModel: "gpt-4o-mini",
  },
  ollama: {
    name: "Ollama (Local)",
    endpoint: "http://localhost:11434/v1/chat/completions",
    requiresKey: false,
    models: ["llama3.1:8b", "llama3.2:3b", "mistral", "gemma4:e4b"],
    defaultModel: "gemma4:e4b",
  },
  gemini: {
    name: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    requiresKey: true,
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-3.1-flash-lite"],
    defaultModel: "gemini-3.1-flash-lite",
  },
  azure: {
    name: "Azure OpenAI",
    endpoint: null,
    requiresKey: true,
    models: [],
    defaultModel: "",
  },
};

// ---------------------------------------------------------------------------
// Prompt Templates — ported from app/ai_agent.py
// ---------------------------------------------------------------------------
const BASE_INSTRUCTIONS = `You are a thoughtful and practical financial advisor.
Always use Indian Rupee (₹) for currency amounts.

{context}{history_context}
User's Current Question: {question}
`;

const PROMPT_PURCHASE_DECISION = `
This is a PURCHASE DECISION question.

Your analysis should cover:
1. AFFORDABILITY: Can they actually afford this right now?
   - Check current balance vs. purchase price
   - Consider upcoming bills/expenses in next 30 days
   - Calculate remaining buffer after purchase

2. TIMING: Is now the right time?
   - Look at their financial trajectory (income vs. expenses)
   - Check if there are more urgent goals
   - Consider if waiting would be better

3. ALTERNATIVES: Are there better options?
   - Could they save up a bit more?
   - Are there cheaper alternatives?
   - Would this delay other goals?

4. PATTERN CHECK: Is this consistent with their habits?
   - Look at their spending patterns
   - Is this an impulse or planned?

If there's conversation history, reference it naturally if relevant.

Provide a clear YES, NO, or WAIT recommendation with specific reasoning using their actual numbers.
`;

const PROMPT_SPENDING_ANALYSIS = `
This is a SPENDING ANALYSIS question.

Your analysis should:
1. Calculate their spending in the mentioned category (use actual numbers)
2. Compare to their total expenses and income
3. Look for patterns (frequency, amounts, timing)
4. Assess if it's problematic or reasonable given their situation
5. Suggest specific, actionable changes if needed

If this relates to something discussed earlier in the conversation, acknowledge that connection.

Be honest but not judgmental. Use data to support your points.
`;

const PROMPT_GOAL_PROGRESS = `
This is a GOAL PROGRESS question.

Your response should:
1. Show current progress (percentage, amount remaining)
2. Calculate if they're on track for their deadline
3. Suggest how much they need to save per month/week
4. Identify what might be blocking progress
5. Offer encouragement if they're doing well, or realistic adjustments if behind

Use specific numbers and dates from their data.
`;

const PROMPT_OPTIMIZATION = `
This is an OPTIMIZATION question.

Your analysis should:
1. Identify the 3 biggest spending categories
2. Look for "low-hanging fruit" (easy wins)
3. Suggest specific, realistic cuts
4. Estimate potential monthly savings
5. Prioritize changes by impact vs. effort

Be practical - suggest things they can actually do, not generic advice.
`;

const PROMPT_STATUS_QUERY = `
This is a STATUS QUERY.

Provide:
1. Clear, direct answer with numbers
2. Brief context about their financial position
3. Any relevant observations or alerts

Keep it concise and factual.
`;

const PROMPT_GENERAL = `
Analyze their question in the context of their financial situation and any previous conversation.

If this is a follow-up question (like "what about...", "and...", "but..."), use the conversation history to understand what they're referring to.

Provide practical, specific advice based on their actual data.
Be conversational and helpful.
`;

const PROMPT_TEMPLATES = {
  purchase_decision: PROMPT_PURCHASE_DECISION,
  spending_analysis: PROMPT_SPENDING_ANALYSIS,
  goal_progress: PROMPT_GOAL_PROGRESS,
  optimization: PROMPT_OPTIMIZATION,
  status_query: PROMPT_STATUS_QUERY,
  general: PROMPT_GENERAL,
};

// ---------------------------------------------------------------------------
// Month name lookup
// ---------------------------------------------------------------------------
const MONTH_NAMES = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const MONTH_LABEL = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const AI_PUBLIC_DEFAULTS = {
  provider: null,
  model: "",
  azureResourceName: "",
  azureDeploymentName: "",
  azureApiVersion: "",
  ollamaBaseUrl: "",
};

const AI_SECRET_DEFAULTS = {
  apiKey: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _todayDate() {
  return new Date();
}

function _formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// AI Module
// ---------------------------------------------------------------------------
export const AI = {
  // ========================================================================
  // Settings
  // ========================================================================
  _decrypted: null,

  setDecrypted(settings) {
    this._decrypted = settings ? { ...settings } : null;
  },

  clearDecrypted() {
    this._decrypted = null;
  },

  _readStoredSettings() {
    try {
      const raw = localStorage.getItem(AI_SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  _normalizePublicSettings(settings = {}) {
    return {
      provider: settings.provider || null,
      model: settings.model || "",
      azureResourceName: settings.azureResourceName || "",
      azureDeploymentName: settings.azureDeploymentName || "",
      azureApiVersion: settings.azureApiVersion || "",
      ollamaBaseUrl: settings.ollamaBaseUrl || "",
    };
  },

  _normalizeSecretSettings(settings = {}) {
    return {
      apiKey: settings?.apiKey || "",
    };
  },

  _mergePublicSettings(current, settings = {}) {
    const has = (key) => Object.hasOwn(settings, key);
    return {
      provider: has("provider") ? settings.provider || null : current.provider || null,
      model: has("model") ? settings.model || "" : current.model || "",
      azureResourceName: has("azureResourceName")
        ? settings.azureResourceName || ""
        : current.azureResourceName || "",
      azureDeploymentName: has("azureDeploymentName")
        ? settings.azureDeploymentName || ""
        : current.azureDeploymentName || "",
      azureApiVersion: has("azureApiVersion")
        ? settings.azureApiVersion || ""
        : current.azureApiVersion || "",
      ollamaBaseUrl: has("ollamaBaseUrl")
        ? settings.ollamaBaseUrl || ""
        : current.ollamaBaseUrl || "",
    };
  },

  _mergeSecretSettings(current, settings = {}) {
    return {
      apiKey: Object.hasOwn(settings, "apiKey") ? settings.apiKey || "" : current.apiKey || "",
    };
  },

  _persistPublicSettings(settings) {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(this._normalizePublicSettings(settings)));
  },

  _scrubPlaintextSecrets() {
    const raw = this._readStoredSettings();
    if (!Object.hasOwn(raw, "apiKey")) return false;
    this._persistPublicSettings(raw);
    return true;
  },

  getLegacyPlaintextSettings() {
    const raw = this._readStoredSettings();
    return {
      ...AI_PUBLIC_DEFAULTS,
      ...this._normalizePublicSettings(raw),
      ...AI_SECRET_DEFAULTS,
      ...this._normalizeSecretSettings(raw),
    };
  },

  async hydrateVaultSettings(vaultSettings = null) {
    const currentPublic = this._normalizePublicSettings(this._readStoredSettings());
    const vaultPublic = this._normalizePublicSettings(vaultSettings || {});
    const plaintext = this.getLegacyPlaintextSettings();
    // Field-wise merge: keep the existing non-empty value, only fall back to the
    // vault-supplied value when the local one is empty. Never let empty vault
    // fields clobber good localStorage values.
    const mergedPublic = {
      provider: currentPublic.provider || vaultPublic.provider || null,
      model: currentPublic.model || vaultPublic.model || "",
      azureResourceName: currentPublic.azureResourceName || vaultPublic.azureResourceName || "",
      azureDeploymentName:
        currentPublic.azureDeploymentName || vaultPublic.azureDeploymentName || "",
      azureApiVersion: currentPublic.azureApiVersion || vaultPublic.azureApiVersion || "",
      ollamaBaseUrl: currentPublic.ollamaBaseUrl || vaultPublic.ollamaBaseUrl || "",
    };
    // Only persist when the merge actually adds a real (non-empty) value that
    // differs from what is already stored. This prevents an all-empty public
    // object (localStorage absent + vault holds only {apiKey}) from overwriting
    // localStorage with null/empty public settings.
    const publicChanged = Object.keys(mergedPublic).some(
      (key) => (mergedPublic[key] || "") !== (currentPublic[key] || ""),
    );
    const publicHasValue = Object.values(mergedPublic).some((value) => !!value);
    if (publicChanged && publicHasValue) {
      this._persistPublicSettings(mergedPublic);
    }

    const secretFromVault = this._normalizeSecretSettings(vaultSettings || {});
    const secretToPersist = secretFromVault.apiKey || plaintext.apiKey || "";
    const needsVaultRewrite =
      !!vaultSettings &&
      (vaultPublic.provider ||
        vaultPublic.model ||
        vaultPublic.azureResourceName ||
        vaultPublic.azureDeploymentName ||
        vaultPublic.azureApiVersion ||
        vaultPublic.ollamaBaseUrl);

    if (secretToPersist) {
      const { Vault } = await import("./vault.js");
      if (!secretFromVault.apiKey || needsVaultRewrite) {
        await Vault.saveAISettings({ apiKey: secretToPersist });
      }
      this.setDecrypted({ apiKey: secretToPersist });
    } else {
      this.clearDecrypted();
    }

    return { scrubbed: this._scrubPlaintextSecrets() };
  },

  getSettings() {
    // Public (non-secret) settings come only from localStorage; the decrypted
    // vault cache supplies only the secret apiKey. This prevents empty decrypted
    // public fields from clobbering good localStorage values on unlock.
    const publicSettings = this._normalizePublicSettings(this._readStoredSettings());
    return {
      ...AI_PUBLIC_DEFAULTS,
      ...publicSettings,
      ...AI_SECRET_DEFAULTS,
      apiKey: this._decrypted?.apiKey || "",
    };
  },

  isLocalOnlyProvider(provider = this.getSettings().provider) {
    return provider === "ollama";
  },

  requiresExternalConsent(provider = this.getSettings().provider) {
    return !!provider && !this.isLocalOnlyProvider(provider);
  },

  getExternalConsent() {
    try {
      const raw = localStorage.getItem(AI_EXTERNAL_CONSENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  hasExternalConsent(provider = this.getSettings().provider) {
    if (!this.requiresExternalConsent(provider)) return true;
    const consent = this.getExternalConsent();
    return !!consent?.granted && consent.provider === provider;
  },

  grantExternalConsent(provider = this.getSettings().provider, source = "manual") {
    if (!this.requiresExternalConsent(provider)) return;
    localStorage.setItem(
      AI_EXTERNAL_CONSENT_KEY,
      JSON.stringify({ provider, granted: true, source, granted_at: new Date().toISOString() }),
    );
  },

  revokeExternalConsent() {
    localStorage.removeItem(AI_EXTERNAL_CONSENT_KEY);
  },

  async saveSettings(settings) {
    const currentPublic = this._normalizePublicSettings(this._readStoredSettings());
    const currentSecret = this._normalizeSecretSettings(this._decrypted || {});
    const nextPublic = this._mergePublicSettings(currentPublic, settings);
    const nextSecret = this._mergeSecretSettings(currentSecret, settings);

    // Persist non-secret preferences synchronously so callers that do not await
    // this method still get updated provider/model state.
    this._persistPublicSettings(nextPublic);
    if (nextSecret.apiKey) {
      this.setDecrypted({ ...nextPublic, ...nextSecret });
    } else {
      this.clearDecrypted();
    }

    const { Vault } = await import("./vault.js");
    if (!nextSecret.apiKey) {
      if (Vault.isConfigured() && Vault.isUnlocked()) {
        Vault.clearAISettings();
      }
      return { ok: true, publicSaved: true, secretSaved: false, vaultRequired: false };
    }

    if (!Vault.isConfigured()) {
      this.clearDecrypted();
      return {
        ok: false,
        publicSaved: true,
        secretSaved: false,
        vaultRequired: true,
        error: "Set up a PIN before saving an AI API key.",
      };
    }

    if (!Vault.isUnlocked()) {
      this.clearDecrypted();
      return {
        ok: false,
        publicSaved: true,
        secretSaved: false,
        vaultRequired: true,
        error: "Unlock your PIN before saving an AI API key.",
      };
    }

    await Vault.saveAISettings(nextSecret);
    return { ok: true, publicSaved: true, secretSaved: true, vaultRequired: false };
  },

  // ========================================================================
  // Date Range Detection — ported from app/ai_agent.py detect_date_range()
  // ========================================================================
  _detectDateRange(question) {
    const today = _todayDate();
    const q = question.toLowerCase();

    // --- Relative periods ---
    if (/last\s+week|past\s+week|this\s+week/.test(q)) {
      const start = new Date(today);
      start.setDate(start.getDate() - LOOKBACK_LAST_WEEK);
      return { start: _formatDate(start), end: _formatDate(today), label: "last 7 days" };
    }

    if (/last\s+month|past\s+month|previous\s+month/.test(q)) {
      const firstOfThis = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(firstOfThis);
      end.setDate(end.getDate() - 1);
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      return { start: _formatDate(start), end: _formatDate(end), label: "last month" };
    }

    if (/this\s+month|current\s+month/.test(q)) {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: _formatDate(start), end: _formatDate(today), label: "this month" };
    }

    if (/last\s+quarter|past\s+quarter|previous\s+quarter/.test(q)) {
      const currentQStartMonth = Math.floor(today.getMonth() / 3) * 3;
      const end = new Date(today.getFullYear(), currentQStartMonth, 0);
      const startMonth = Math.floor(end.getMonth() / 3) * 3;
      const start = new Date(end.getFullYear(), startMonth, 1);
      return { start: _formatDate(start), end: _formatDate(end), label: "last quarter" };
    }

    if (/this\s+quarter|current\s+quarter/.test(q)) {
      const startMonth = Math.floor(today.getMonth() / 3) * 3;
      const start = new Date(today.getFullYear(), startMonth, 1);
      return { start: _formatDate(start), end: _formatDate(today), label: "this quarter" };
    }

    if (/last\s+year|past\s+year|previous\s+year/.test(q)) {
      const y = today.getFullYear() - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: "last year" };
    }

    if (/this\s+year|current\s+year/.test(q)) {
      return {
        start: `${today.getFullYear()}-01-01`,
        end: _formatDate(today),
        label: "this year",
      };
    }

    // --- Specific month ---
    const monthMatch = q.match(
      /(?:in|last|this)\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/,
    );
    if (monthMatch) {
      const monthNum = MONTH_NAMES[monthMatch[1]];
      const year = monthNum <= today.getMonth() + 1 ? today.getFullYear() : today.getFullYear() - 1;
      const start = new Date(year, monthNum - 1, 1);
      let end;
      if (monthNum === 12) {
        end = new Date(year + 1, 0, 0);
      } else {
        end = new Date(year, monthNum, 0);
      }
      if (end > today) end = today;
      const label = `${MONTH_LABEL[monthNum]} ${year}`;
      return { start: _formatDate(start), end: _formatDate(end), label };
    }

    // --- Last N days / months ---
    const nDays = q.match(/last\s+(\d+)\s+days?/);
    if (nDays) {
      const days = Number.parseInt(nDays[1], 10);
      const start = new Date(today);
      start.setDate(start.getDate() - days);
      return { start: _formatDate(start), end: _formatDate(today), label: `last ${days} days` };
    }

    const nMonths = q.match(/last\s+(\d+)\s+months?/);
    if (nMonths) {
      const months = Number.parseInt(nMonths[1], 10);
      const start = new Date(today);
      start.setDate(start.getDate() - months * 30);
      return {
        start: _formatDate(start),
        end: _formatDate(today),
        label: `last ${months} months`,
      };
    }

    // --- Default: last 30 days ---
    const start = new Date(today);
    start.setDate(start.getDate() - DEFAULT_DAYS_LOOKBACK);
    return {
      start: _formatDate(start),
      end: _formatDate(today),
      label: `last ${DEFAULT_DAYS_LOOKBACK} days`,
    };
  },

  // ========================================================================
  // Heuristic Mode (no AI provider configured)
  // ========================================================================
  _isConfigured() {
    return !!this.getSettings().provider;
  },

  async _buildHeuristicResponse(question) {
    const questionType = this._detectQuestionType(question);
    const today = _todayDate();
    const fmt = (amount) => `\u20B9${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
    const footer =
      "\n\n---\n*For personalised advice and deeper analysis, configure an AI provider in ⚙️ Settings.*";

    if (questionType === "status_query") {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const [accounts, txs] = await Promise.all([
        DB.getAccounts(),
        DB.getTransactions({ date_from: _formatDate(firstOfMonth), date_to: _formatDate(today) }),
      ]);
      const balanceAccounts = accounts.filter(
        (a) => a.account_type && BALANCE_ACCOUNT_TYPES.has(a.account_type.toLowerCase()),
      );
      const totalBalance = balanceAccounts.reduce((sum, a) => {
        const bal = a.effective_balance != null ? a.effective_balance : a.balance;
        return sum + (a.account_type?.toLowerCase() === "credit" ? -bal : bal);
      }, 0);
      let income = 0;
      let expenses = 0;
      for (const tx of txs) {
        if (tx.transaction_type === "income") income += tx.amount;
        else if (tx.transaction_type === "expense") expenses += Math.abs(tx.amount);
      }
      const net = income - expenses;
      return `**Financial Status**\n\n**Total Balance:** ${fmt(totalBalance)}\n\n**This Month:**\n- Income: ${fmt(income)}\n- Expenses: ${fmt(expenses)}\n- Net: ${fmt(net)}${footer}`;
    }

    if (questionType === "goal_progress") {
      const goals = await DB.getGoals();
      if (goals.length === 0) {
        return `**Goals**\n\nNo goals found. Create goals in the Goals screen to track your progress.${footer}`;
      }
      const now = new Date();
      const lines = goals.map((g) => {
        const pct =
          g.target_amount > 0 ? ((g.current_amount / g.target_amount) * 100).toFixed(1) : "0.0";
        let deadline = "";
        if (g.deadline) {
          const days = Math.ceil((new Date(g.deadline) - now) / (1000 * 60 * 60 * 24));
          deadline = ` | ${days > 0 ? `${days} days remaining` : "Overdue"}`;
        }
        return `- **${g.name}**: ${fmt(g.current_amount)} / ${fmt(g.target_amount)} (${pct}%${deadline})`;
      });
      return `**Goal Progress**\n\n${lines.join("\n")}${footer}`;
    }

    if (questionType === "spending_analysis") {
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 30);
      const [txs, categories] = await Promise.all([
        DB.getTransactions({ date_from: _formatDate(startDate), date_to: _formatDate(today) }),
        DB.getCategories(),
      ]);
      const catMap = {};
      for (const c of categories) catMap[c.id] = c.name;
      const spending = {};
      for (const tx of txs) {
        if (tx.transaction_type === "expense") {
          const cat = catMap[tx.category_id] || "Other";
          spending[cat] = (spending[cat] || 0) + Math.abs(tx.amount);
        }
      }
      const sorted = Object.entries(spending)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      if (sorted.length === 0) {
        return `**Spending Analysis (Last 30 Days)**\n\nNo expense transactions found in the last 30 days.${footer}`;
      }
      const lines = sorted.map(([cat, amt]) => `- **${cat}**: ${fmt(amt)}`);
      return `**Top Spending Categories (Last 30 Days)**\n\n${lines.join("\n")}${footer}`;
    }

    if (questionType === "purchase_decision") {
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 90);
      const [accounts, txs] = await Promise.all([
        DB.getAccounts(),
        DB.getTransactions({ date_from: _formatDate(startDate), date_to: _formatDate(today) }),
      ]);
      const balanceAccounts = accounts.filter(
        (a) => a.account_type && BALANCE_ACCOUNT_TYPES.has(a.account_type.toLowerCase()),
      );
      const totalBalance = balanceAccounts.reduce((sum, a) => {
        const bal = a.effective_balance != null ? a.effective_balance : a.balance;
        return sum + (a.account_type?.toLowerCase() === "credit" ? -bal : bal);
      }, 0);
      const totalExpenses = txs
        .filter((tx) => tx.transaction_type === "expense")
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
      const avgMonthlySpend = totalExpenses / 3;
      return `**Purchase Decision**\n\n**Total Balance:** ${fmt(totalBalance)}\n**Avg Monthly Spend (3 months):** ${fmt(avgMonthlySpend)}\n\nFor a detailed analysis of whether you can afford this purchase, configure an AI provider.${footer}`;
    }

    // optimization or general
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 30);
    const [accounts, txs, goals] = await Promise.all([
      DB.getAccounts(),
      DB.getTransactions({ date_from: _formatDate(startDate), date_to: _formatDate(today) }),
      DB.getGoals(),
    ]);
    const balanceAccounts = accounts.filter(
      (a) => a.account_type && BALANCE_ACCOUNT_TYPES.has(a.account_type.toLowerCase()),
    );
    const totalBalance = balanceAccounts.reduce((sum, a) => {
      const bal = a.effective_balance != null ? a.effective_balance : a.balance;
      return sum + (a.account_type?.toLowerCase() === "credit" ? -bal : bal);
    }, 0);
    let income = 0;
    let expenses = 0;
    for (const tx of txs) {
      if (tx.transaction_type === "income") income += tx.amount;
      else if (tx.transaction_type === "expense") expenses += Math.abs(tx.amount);
    }
    const goalsNote = goals.length > 0 ? `\n- **Active Goals:** ${goals.length}` : "";
    return `**Financial Snapshot (Last 30 Days)**\n\n- **Total Balance:** ${fmt(totalBalance)}\n- **Income:** ${fmt(income)}\n- **Expenses:** ${fmt(expenses)}${goalsNote}\n\nAI-powered analysis is not available without a configured AI provider. Add one in ⚙️ Settings for personalised coaching.${footer}`;
  },

  // ========================================================================
  // Question Type Detection — ported from app/ai_agent.py detect_question_type()
  // ========================================================================
  _detectQuestionType(question) {
    const q = question.toLowerCase();

    if (["should i buy", "should i purchase", "can i afford"].some((w) => q.includes(w))) {
      return "purchase_decision";
    }
    if (["how much", "what's my balance", "total"].some((w) => q.includes(w))) {
      return "status_query";
    }
    if (["spending too much", "spending on", "waste"].some((w) => q.includes(w))) {
      return "spending_analysis";
    }
    if (["goal", "saving for", "target"].some((w) => q.includes(w))) {
      return "goal_progress";
    }
    if (["help me save", "reduce spending", "cut costs"].some((w) => q.includes(w))) {
      return "optimization";
    }
    return "general";
  },

  // ========================================================================
  // Context Building — ported from app/ai_agent.py get_financial_context()
  // ========================================================================
  async _buildContext(question) {
    const { start, end, label } = this._detectDateRange(question);

    const [accounts, transactions, goals, categories] = await Promise.all([
      DB.getAccounts(),
      DB.getTransactions({ date_from: start, date_to: end }),
      DB.getGoals(),
      DB.getCategories(),
    ]);

    // Build category lookup
    const catMap = {};
    for (const c of categories) {
      catMap[c.id] = c.name;
    }

    // Active accounts with balance
    const balanceAccounts = accounts.filter(
      (a) => a.account_type && BALANCE_ACCOUNT_TYPES.has(a.account_type.toLowerCase()),
    );
    const totalBalance = balanceAccounts.reduce((sum, a) => {
      const bal = a.effective_balance != null ? a.effective_balance : a.balance;
      return sum + (a.account_type?.toLowerCase() === "credit" ? -bal : bal);
    }, 0);

    // Format accounts summary
    const accountsLines = accounts.map((a, index) => {
      if (a.account_type && BALANCE_ACCOUNT_TYPES.has(a.account_type.toLowerCase())) {
        const bal = a.effective_balance != null ? a.effective_balance : a.balance;
        const displayBal = a.account_type.toLowerCase() === "credit" ? -bal : bal;
        return `- Account ${index + 1}: ₹${displayBal.toLocaleString("en-IN", { minimumFractionDigits: 2 })} (${a.account_type})`;
      }
      return `- Account ${index + 1} (${a.account_type || "unknown"})`;
    });
    const accountsSummary = accountsLines.join("\n");

    // Calculate spending by category
    const categorySpending = {};
    let totalExpenses = 0;
    let totalIncome = 0;

    for (const tx of transactions) {
      if (tx.transaction_type === "expense") {
        const amt = Math.abs(tx.amount);
        totalExpenses += amt;
        const catName = catMap[tx.category_id] || "Other";
        categorySpending[catName] = (categorySpending[catName] || 0) + amt;
      } else if (tx.transaction_type === "income") {
        totalIncome += tx.amount;
      }
    }

    // Format transactions
    const txSlice = transactions.slice(0, LOOKBACK_MAX_TRANSACTIONS);
    const transactionsLines = txSlice.map((tx) => {
      const catName = catMap[tx.category_id] || "Other";
      return `- ${tx.date}: ₹${tx.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} - ${maskPII(tx.description || "No description")} (${catName})`;
    });
    const transactionsSummary = transactionsLines.join("\n");
    const totalTxCount = transactions.length;

    // Format category spending (sorted by amount desc)
    const catEntries = Object.entries(categorySpending).sort((a, b) => b[1] - a[1]);
    const categoryLines = catEntries.map(
      ([cat, amount]) =>
        `- ${cat}: ₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
    );
    const categorySummary = categoryLines.join("\n");

    // Format goals
    const goalsLines = goals.map((g, index) => {
      const pct =
        g.target_amount > 0 ? ((g.current_amount / g.target_amount) * 100).toFixed(1) : "0.0";
      return `- Goal ${index + 1}: ₹${g.current_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} / ₹${g.target_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} (${pct}% complete) - Deadline: ${g.deadline || "none"}`;
    });
    const goalsSummary = goalsLines.join("\n");

    const todayStr = _formatDate(_todayDate());

    const net = totalIncome - totalExpenses;

    return `
=== FINANCIAL SNAPSHOT ===

Total Available Funds: ₹${totalBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}

Accounts:
${accountsSummary || "No accounts yet"}

=== ${label.toUpperCase()} (${start} to ${end}) ===

Income: ₹${totalIncome.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
Expenses: ₹${totalExpenses.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
Net: ₹${net.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
Total Transactions: ${totalTxCount}

Spending by Category:
${categorySummary || "No expenses tracked"}

Transactions (${Math.min(totalTxCount, LOOKBACK_MAX_TRANSACTIONS)} of ${totalTxCount}):
${transactionsSummary || "No transactions yet"}

=== GOALS ===
${goalsSummary || "No goals set"}

Current Date: ${todayStr}
`;
  },

  // ========================================================================
  // Prompt Building — ported from app/ai_agent.py build_prompt()
  // ========================================================================
  _buildPrompt(question, context, historyMessages) {
    const questionType = this._detectQuestionType(question);

    // Format conversation history
    let historyContext = "";
    if (historyMessages && historyMessages.length > 0) {
      const recent = historyMessages.slice(-MAX_CONVERSATION_MESSAGES);
      historyContext = "\n=== CONVERSATION HISTORY ===\n";
      for (const msg of recent) {
        const role = msg.role === "user" ? "You" : "Assistant";
        historyContext += `${role}: ${maskPII(msg.content)}\n`;
      }
      historyContext += "\n";
    }

    const base = BASE_INSTRUCTIONS.replace("{context}", context)
      .replace("{history_context}", historyContext)
      .replace("{question}", maskPII(question));

    const specific = PROMPT_TEMPLATES[questionType] || PROMPT_TEMPLATES.general;

    return `${base}${specific}\nYour response:`;
  },

  // ========================================================================
  // Chat — main entry point
  // ========================================================================
  async chat(message, chatId = null) {
    const settings = this.getSettings();
    const resolvedChatId = chatId || crypto.randomUUID();
    const maskedMessage = maskPII(message);
    if (!settings.provider) {
      await DB.saveChatMessage(resolvedChatId, "user", message);
      const heuristicResponse = await this._buildHeuristicResponse(message);
      await DB.saveChatMessage(resolvedChatId, "assistant", heuristicResponse);
      return { response: heuristicResponse, model_used: "heuristic", chat_id: resolvedChatId };
    }

    if (
      this.requiresExternalConsent(settings.provider) &&
      !this.hasExternalConsent(settings.provider)
    ) {
      await DB.saveChatMessage(resolvedChatId, "user", message);
      const heuristicResponse = await this._buildHeuristicResponse(message);
      const consentNote =
        "\n\n---\n*External AI is configured but not yet enabled. Review and accept the data-sharing consent in Settings or when prompted in Chat/Sync to send data to your provider. Until then, chat stays in local heuristic mode.*";
      await DB.saveChatMessage(resolvedChatId, "assistant", `${heuristicResponse}${consentNote}`);
      return {
        response: `${heuristicResponse}${consentNote}`,
        model_used: "heuristic",
        chat_id: resolvedChatId,
        consent_required: true,
      };
    }

    // Save user message
    await DB.saveChatMessage(resolvedChatId, "user", message);

    // Load conversation history
    const historyResult = await DB.getChatHistory(resolvedChatId);
    const history = historyResult.history || [];

    // Build context and prompt
    const context = await this._buildContext(message);
    const systemPrompt = this._buildPrompt(message, context, history);

    // Get provider config
    const provider = AI_PROVIDERS[settings.provider];
    if (!provider) {
      return {
        response: `Unknown AI provider: ${settings.provider}. Please check your settings.`,
        model_used: "none",
        chat_id: resolvedChatId,
      };
    }

    // Build messages array
    const historySlice = history
      .slice(-10)
      .map((m) => ({ role: m.role, content: maskPII(m.content) }));
    const messages = [
      { role: "system", content: systemPrompt },
      ...historySlice,
      { role: "user", content: maskedMessage },
    ];

    // Build headers and endpoint — azure uses a different auth scheme and URL
    let fetchEndpoint;
    const headers = { "Content-Type": "application/json" };

    if (settings.provider === "azure") {
      if (!settings.azureResourceName || !settings.azureDeploymentName) {
        return { ok: false, error: "Azure resource name and deployment name are required" };
      }
      if (
        !AZURE_NAME_RE.test(settings.azureResourceName) ||
        !AZURE_NAME_RE.test(settings.azureDeploymentName)
      ) {
        return { ok: false, error: "Invalid Azure resource or deployment name" };
      }
      const apiVersion = settings.azureApiVersion || "2024-12-01-preview";
      fetchEndpoint = `https://${settings.azureResourceName}.openai.azure.com/openai/deployments/${settings.azureDeploymentName}/chat/completions?api-version=${apiVersion}`;
      headers["api-key"] = settings.apiKey;
    } else if (settings.provider === "gemini") {
      const geminiModel = settings.model || provider.defaultModel;
      fetchEndpoint = `${provider.endpoint}/${geminiModel}:generateContent?key=${settings.apiKey}`;
    } else {
      if (settings.provider === "ollama" && settings.ollamaBaseUrl) {
        try {
          const parsedUrl = new URL(settings.ollamaBaseUrl);
          if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            return {
              response: "Error: Invalid Ollama URL — must use http or https.",
              model_used: settings.model,
              chat_id: resolvedChatId,
            };
          }
          fetchEndpoint = `${settings.ollamaBaseUrl}/v1/chat/completions`;
        } catch {
          return {
            response: "Error: Invalid Ollama base URL.",
            model_used: settings.model,
            chat_id: resolvedChatId,
          };
        }
      } else {
        fetchEndpoint = provider.endpoint;
      }
      if (provider.requiresKey) {
        headers.Authorization = `Bearer ${settings.apiKey}`;
      }
    }

    try {
      let requestBody;
      if (settings.provider === "gemini") {
        const systemMsg = messages.find((m) => m.role === "system");
        const contents = messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          }));
        requestBody = { contents };
        if (systemMsg) {
          requestBody.system_instruction = { parts: [{ text: systemMsg.content }] };
        }
      } else if (settings.provider === "azure") {
        requestBody = { messages, stream: false };
      } else {
        requestBody = { model: settings.model, messages, stream: false };
      }
      const resp = await fetchWithTimeout(fetchEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        let errMsg = `API error (${resp.status})`;
        try {
          const errJson = JSON.parse(errBody);
          errMsg = errJson.error?.message || errJson.message || errMsg;
        } catch {
          // use default message
        }
        return {
          response: `Error: ${errMsg}`,
          model_used: settings.model,
          chat_id: resolvedChatId,
        };
      }

      const data = await resp.json();
      const content =
        settings.provider === "gemini"
          ? data.candidates[0].content.parts[0].text
          : data.choices[0].message.content;

      // Save assistant response
      await DB.saveChatMessage(resolvedChatId, "assistant", content);

      return { response: content, model_used: settings.model, chat_id: resolvedChatId };
    } catch (err) {
      return {
        response: `Network error: ${err.message}. Please check your connection and settings.`,
        model_used: settings.model,
        chat_id: resolvedChatId,
      };
    }
  },

  // ========================================================================
  // Test Connection
  // ========================================================================
  async testConnection() {
    const settings = this.getSettings();
    if (!settings.provider) {
      return { ok: false, error: "No AI provider configured" };
    }

    const provider = AI_PROVIDERS[settings.provider];
    if (!provider) {
      return { ok: false, error: `Unknown provider: ${settings.provider}` };
    }

    // Build headers and endpoint — azure uses a different auth scheme and URL
    let fetchEndpoint;
    const headers = { "Content-Type": "application/json" };

    if (settings.provider === "azure") {
      if (!settings.azureResourceName) {
        return { ok: false, error: "Azure resource name is required" };
      }
      if (!settings.azureDeploymentName) {
        return { ok: false, error: "Azure deployment name is required" };
      }
      if (
        !AZURE_NAME_RE.test(settings.azureResourceName) ||
        !AZURE_NAME_RE.test(settings.azureDeploymentName)
      ) {
        return { ok: false, error: "Invalid Azure resource or deployment name" };
      }
      const apiVersion = settings.azureApiVersion || "2024-12-01-preview";
      fetchEndpoint = `https://${settings.azureResourceName}.openai.azure.com/openai/deployments/${settings.azureDeploymentName}/chat/completions?api-version=${apiVersion}`;
      headers["api-key"] = settings.apiKey;
    } else if (settings.provider === "gemini") {
      if (!settings.apiKey) {
        return { ok: false, error: "API key is required" };
      }
      const geminiModel = settings.model || provider.defaultModel;
      fetchEndpoint = `${provider.endpoint}/${geminiModel}:generateContent?key=${settings.apiKey}`;
    } else {
      if (provider.requiresKey) {
        if (!settings.apiKey) {
          return { ok: false, error: "API key is required" };
        }
        headers.Authorization = `Bearer ${settings.apiKey}`;
      }
      if (settings.provider === "ollama" && settings.ollamaBaseUrl) {
        try {
          const parsedUrl = new URL(settings.ollamaBaseUrl);
          if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            return { ok: false, error: "Invalid Ollama URL — must use http or https." };
          }
          fetchEndpoint = `${settings.ollamaBaseUrl}/v1/chat/completions`;
        } catch {
          return { ok: false, error: "Invalid Ollama base URL." };
        }
      } else {
        fetchEndpoint = provider.endpoint;
      }
    }

    try {
      let requestBody;
      if (settings.provider === "gemini") {
        requestBody = { contents: [{ role: "user", parts: [{ text: "Say hello" }] }] };
      } else if (settings.provider === "azure") {
        requestBody = { messages: [{ role: "user", content: "Say hello" }], stream: false };
      } else {
        requestBody = {
          model: settings.model || provider.defaultModel,
          messages: [{ role: "user", content: "Say hello" }],
          stream: false,
        };
      }
      const resp = await fetchWithTimeout(fetchEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        let errMsg = `API error (${resp.status})`;
        try {
          const errJson = JSON.parse(errBody);
          errMsg = errJson.error?.message || errJson.message || errMsg;
        } catch {
          // use default message
        }
        return { ok: false, error: errMsg };
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};

window.AI = AI;
