# Local-First PWA Migration — Agent-Ready Implementation Spec

> **Purpose**: This document contains everything an AI agent needs to migrate the Financial Coach
> from a server-centric FastAPI app to a local-first PWA. Each sprint is self-contained and
> implementable independently.

---

## Architecture Overview

```
CURRENT                                 TARGET
Browser ──fetch()──▶ FastAPI ──▶ SQLite  Browser ──sql.js──▶ IndexedDB (local)
                     + LangChain                   ──fetch()──▶ Groq/OpenAI API (direct)
                     + Gmail API                   ──fetch()──▶ Gmail Proxy (Cloudflare Worker)
```

**Key principle**: `app.js` (3,014 lines of UI code) is UNCHANGED. Only `api.js` (298 lines) gets
rewired to call local `DB` methods instead of `fetch()` to the server.

**All new JS files use ES Modules** (`import`/`export`). No build step, no bundler. Native browser
`<script type="module">` support. This gives us proper module scoping, explicit dependency graphs,
and testability — while remaining vanilla JS with zero tooling.

**Requirements that are NOT NEEDED for this architecture**:
- Req #12 (User Authentication) — each browser has isolated storage, no shared server
- Req #09 (Bulk Operations) — nice-to-have feature, not a blocker
- Req #13 (Push Notifications) — can be added later as client-side-only
- Docker / docker-compose — useful for dev only; app ships as static files
- CORS / rate limiting — no backend server to configure

---

## Project Setup: Python → JavaScript Tooling

### What replaces what

| Python Tool | JS Replacement | Purpose |
|-------------|---------------|---------|
| `pyproject.toml` | `package.json` | Project metadata, scripts, dev dependencies |
| `uv` | `npm` | Package manager (dev deps only — no runtime deps) |
| `ruff` | `biome` | Linter + formatter (fast, Rust-based, single tool — like ruff for JS) |
| `pytest` | `vitest` | Unit tests for `db.js`, `ai.js` (runs in Node with jsdom) |
| `playwright` (Python) | `playwright` (npm) | E2E tests (same tool, JS bindings) |
| `uvicorn` | `npx serve` | Dev server for static files |
| `Makefile` | `Makefile` (kept) | Updated with JS targets alongside Python targets |
| `.env` | `localStorage` | User settings (API keys, provider selection) |

### Step 0.1: Create `package.json`

```json
{
  "name": "financial-coach",
  "version": "1.0.0",
  "description": "AI-powered personal finance manager — local-first PWA",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "npx serve static -l 8080 --cors",
    "lint": "npx @biomejs/biome check --fix static/js/",
    "format": "npx @biomejs/biome format --write static/js/",
    "test": "npx vitest run",
    "test:watch": "npx vitest",
    "test:e2e": "npx playwright test",
    "deploy": "npx wrangler pages deploy static --project-name=fincoach"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "vitest": "^3.2.0",
    "jsdom": "^26.1.0",
    "sql.js": "^1.11.0",
    "@playwright/test": "^1.52.0"
  }
}
```

**Key points**:
- `"type": "module"` — makes `.js` files use ES module syntax in Node (for tests)
- **Zero runtime dependencies** — `sql.js` WASM is loaded from `static/js/` via CDN download, not `node_modules`. The `devDependencies` entry is only for Vitest to import during tests.
- `devDependencies` are only for development tooling. The production app is just static files.
- No `dependencies` section — the app has no server-side runtime

### Step 0.2: Create `biome.json`

Biome is the JS equivalent of ruff — a single, fast Rust-based tool for both linting and
formatting. Same philosophy: opinionated, minimal config, auto-fixable.

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "warn",
        "noUnusedImports": "error"
      },
      "suspicious": {
        "noExplicitAny": "off"
      }
    }
  },
  "files": {
    "include": ["static/js/**/*.js"],
    "ignore": ["static/js/sql-wasm.js", "static/js/sql-wasm.wasm", "node_modules"]
  }
}
```

### Step 0.3: Create `vitest.config.js`

```javascript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/js/**/*.test.js"],
    globals: true,
  },
});
```

### Step 0.4: Update `Makefile`

The Makefile keeps Python targets for backend dev and adds JS targets for frontend dev.
After migration is complete, Python targets can be removed.

```makefile
.PHONY: help run dev lint lint-py lint-js test test-unit test-py test-js test-backend \
        test-agents test-e2e sync sync-py sync-js clean deploy

help:
	@echo ""
	@echo "=== Frontend (JS — production) ==="
	@echo "  make dev              - Serve static files on :8080 (no backend)"
	@echo "  make lint-js          - Lint + format JS with Biome"
	@echo "  make test-js          - Run JS unit tests (Vitest)"
	@echo "  make sync-js          - Install JS dev dependencies"
	@echo "  make deploy           - Deploy to Cloudflare Pages"
	@echo ""
	@echo "=== Backend (Python — development reference) ==="
	@echo "  make run              - Run FastAPI dev server on :8000"
	@echo "  make lint-py          - Lint + format Python with Ruff"
	@echo "  make test-py          - Run Python unit tests"
	@echo "  make test-backend     - Run backend API tests"
	@echo "  make test-agents      - Run agent integration tests"
	@echo "  make test-e2e         - Run Playwright E2E tests"
	@echo "  make sync-py          - Install Python dependencies"
	@echo ""
	@echo "=== Combined ==="
	@echo "  make lint             - Lint both Python and JS"
	@echo "  make test             - Run all tests (Python + JS)"
	@echo "  make sync             - Install all dependencies"
	@echo "  make clean            - Remove caches and temp files"

# ─── Frontend (JS) ────────────────────────────────────────────────────────────

dev:
	npx serve static -l 8080 --cors

lint-js:
	npx @biomejs/biome check --fix static/js/

test-js:
	npx vitest run

sync-js:
	npm install

deploy:
	npx wrangler pages deploy static --project-name=fincoach

# ─── Backend (Python) ─────────────────────────────────────────────────────────

run:
	uv run uvicorn app.main:app --reload --port 8000

lint-py:
	uv run ruff format
	uv run ruff check --fix

test-py:
	uv run pytest tests/unit_tests/ -v

test-backend:
	uv run pytest tests/backend/ -v -m backend

test-agents:
	uv run pytest tests/test_agents.py -v

test-e2e:
	uv run pytest tests/e2e/ -v -m e2e --browser chromium

sync-py:
	uv sync --all-groups --all-extras
	uv run playwright install chromium

# ─── Combined ─────────────────────────────────────────────────────────────────

lint: lint-py lint-js

test: test-py test-js test-backend

test-unit: test-py test-js

sync: sync-py sync-js

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name ".ruff_cache" -exec rm -rf {} +
	find . -type d -name "htmlcov" -exec rm -rf {} +
	find . -type f -name ".coverage" -delete
	find . -type f -name "coverage.xml" -delete
	rm -rf node_modules/.cache
```

### Step 0.5: Update `.gitignore`

Add JS-specific entries:

```gitignore
# JS tooling
node_modules/
.biome/

# sql.js WASM (downloaded, not committed)
static/js/sql-wasm.js
static/js/sql-wasm.wasm
```

### Step 0.6: Download sql.js WASM files

```bash
curl -o static/js/sql-wasm.js "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.js"
curl -o static/js/sql-wasm.wasm "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/sql-wasm.wasm"
```

### What happens to `pyproject.toml`?

**It stays.** `pyproject.toml` continues to manage the Python backend for development, testing,
and as the reference implementation. It is NOT replaced — `package.json` is ADDED alongside it.

The project becomes dual-toolchain during migration:
- `pyproject.toml` + `uv` → Python backend (dev/test)
- `package.json` + `npm` → JS frontend (production)

Once migration is complete and the Python backend is no longer needed, `pyproject.toml` can
be archived or removed. But that's a future decision.

### What happens to `Makefile`?

**It stays and grows.** The Makefile is updated with new JS targets (`dev`, `lint-js`, `test-js`,
`sync-js`, `deploy`). The existing Python targets are renamed with `-py` suffix for clarity.
Combined targets (`lint`, `test`, `sync`) run both.

---

## ES Modules Strategy

### Why ES Modules

The current codebase uses `<script>` tags with globals (`const API = {...}`, `const Router = {...}`).
This works for 2 files but breaks down at 5+ files:
- No dependency management (load order matters)
- No scoping (any file can overwrite `DB`, `API`, etc.)
- No testability (can't import a single module in Node)
- Global namespace pollution

ES Modules (`import`/`export`) solve all of this with **zero build step**. Every modern browser
that supports WebAssembly (required for sql.js) also supports `<script type="module">`.

### Module dependency graph

```
main.js (entry point)
  ├── db.js          (exports DB)
  ├── ai.js          (exports AI; imports DB)
  ├── api.js         (exports API; imports DB, AI)
  └── app.js         (imports API, DB, AI; runs UI)
        └── (CDN: Chart.js, marked, DOMPurify — loaded as globals via <script>)
```

### The `onclick` bridge — 54 functions

`app.js` uses inline `onclick="functionName()"` in HTML template literals (53 `onclick` + 1
`onkeydown`). With ES modules, top-level functions are scoped to the module and not available
on `window`.

**Solution**: At the bottom of `app.js`, explicitly expose the 54 functions that are referenced
from inline handlers:

```javascript
// ============================================================================
// Expose functions used in onclick="" HTML template attributes.
// ES modules scope functions to the module — these need window access.
// ============================================================================

// Navigation & layout
Object.assign(window, {
  toggleOverflowMenu, closeOverflowMenu,
});

// Transactions
Object.assign(window, {
  showEditTransaction, confirmDeleteTransaction, doDeleteTransaction,
  saveTransaction, toggleTxType, createTransaction,
  exportTransactions, runDetectRecurring,
});

// Accounts
Object.assign(window, {
  showCreateAccountModal, doCreateAccount,
  showMergeAccountModal, doMergeAccounts,
  confirmUnmergeAccount, doUnmergeAccount,
  confirmDeleteAccount, doDeleteAccount,
  toggleAccountChildren,
});

// Sync / Gmail
Object.assign(window, {
  setSyncMode, connectGmail, runSync,
});

// Taxonomy (categories + merchants)
Object.assign(window, {
  switchTaxonomyTab,
  showAddCategoryModal, showEditCategoryModal, doCreateCategory, doUpdateCategory,
  confirmDeleteCategory, doDeleteCategory, setDefaultCategory,
  showAddMerchantModal, showEditMerchantModal, doCreateMerchant, doUpdateMerchant,
  confirmDeleteMerchant, doDeleteMerchant,
});

// Goals
Object.assign(window, {
  showCreateGoalModal, showEditGoalModal, doCreateGoal, doUpdateGoal,
  showContributeModal, doContributeToGoal,
  confirmDeleteGoal, doDeleteGoal,
});

// Budgets
Object.assign(window, {
  showCreateBudgetModal, showEditBudgetModal, doCreateBudget, doUpdateBudget,
  confirmDeleteBudget, doDeleteBudget,
});

// Reports
Object.assign(window, { loadReport });

// Chat
Object.assign(window, {
  sendChatMessage, fillChatSuggestion, loadChatSession, chatInputKeydown,
});
```

This is a mechanical, one-time change. Every function listed above already exists in `app.js`.
The `Object.assign(window, {...})` calls go at the bottom of the file, after all function
definitions.

### `index.html` changes

```html
<!-- BEFORE (current): -->
<script src="/static/js/api.js"></script>
<script src="/static/js/app.js"></script>

<!-- AFTER (ES Modules): -->
<script type="module" src="/static/js/main.js"></script>
```

CDN libraries (Chart.js, marked, DOMPurify) stay as regular `<script>` tags because they
are third-party globals. Only our code uses ES modules.

---

## File Inventory

### Files to CREATE

| File | Sprint | Purpose |
|------|--------|---------|
| `package.json` | 0 | Project config, scripts, dev dependencies |
| `biome.json` | 0 | JS linter/formatter config |
| `vitest.config.js` | 0 | JS test runner config |
| `static/js/main.js` | 1 | ES module entry point (init DB, import app) |
| `static/js/db.js` | 1 | SQLite WASM database layer — schema, CRUD, persistence |
| `static/js/ai.js` | 2 | Direct LLM REST client (replaces LangChain) |
| `static/js/gmail.js` | 4 | Browser-side Gmail fetch + email parsing |
| `cloudflare-worker/gmail-proxy.js` | 4 | Serverless OAuth token exchange |
| `tests/js/db.test.js` | 1 | Unit tests for db.js |
| `tests/js/ai.test.js` | 2 | Unit tests for ai.js |

### Files to MODIFY

| File | Sprint | Changes |
|------|--------|---------|
| `Makefile` | 0 | Add JS targets, rename Python targets |
| `.gitignore` | 0 | Add `node_modules/`, sql-wasm files |
| `static/js/api.js` | 1,2 | Rewrite with `import`/`export`, delegate to DB/AI |
| `static/js/app.js` | 1,2,3 | Add `import`, add `window.*` bridge, add Settings screen |
| `static/js/sw.js` | 1 | Cache sql-wasm + module files, remove API route handling |
| `static/index.html` | 1 | Replace `<script>` tags with `<script type="module">` |
| `static/css/styles.css` | 2 | Settings screen styles (minimal) |

### Files NOT TOUCHED

- `pyproject.toml` — stays as-is for Python backend
- `app/**` — entire Python backend unchanged
- `tests/unit_tests/**`, `tests/backend/**` — Python tests unchanged

---

## Sprint 1: Data Layer Migration (SQLAlchemy → sql.js)

### Goal

All CRUD operations work in the browser via SQLite WASM. Backend server is no longer required
for data storage.

### Step 1.1: Create `static/js/main.js` (ES Module Entry Point)

```javascript
/**
 * main.js — Application entry point.
 * Initializes the database, then boots the app.
 *
 * Loaded as: <script type="module" src="/static/js/main.js"></script>
 */

import { DB } from "./db.js";
import "./api.js";   // Registers global API object (bridge to app.js)
import "./app.js";   // Registers all render functions + router

// Initialize DB before app renders
async function boot() {
  try {
    await DB.init();
    // Dispatch event so app.js knows DB is ready
    document.dispatchEvent(new Event("db-ready"));
  } catch (err) {
    document.getElementById("app").innerHTML =
      `<div style="padding:2rem;color:red">Failed to initialize database: ${err.message}</div>`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
```

### Step 1.2: Create `static/js/db.js`

This file replaces the entire Python backend data layer. Uses ES module `export`.

```javascript
/**
 * db.js — Browser-side SQLite database layer.
 *
 * Replaces: app/database.py, all app/routes/*.py, all app/services/*.py,
 *           app/conversation_memory.py
 *
 * Uses sql.js (SQLite compiled to WASM) + IndexedDB for persistence.
 */

const DB_NAME = "fincoach-db";
const DB_STORE = "sqlitedb";

export const DB = {
  db: null,
  SQL: null,

  // =========================================================================
  // Initialization
  // =========================================================================

  async init() {
    // sql-wasm.js is loaded as a regular <script> tag (not a module),
    // so initSqlJs is a global.
    this.SQL = await initSqlJs({
      locateFile: (file) => `/static/js/${file}`,
    });

    const saved = await this._loadFromStorage();
    if (saved) {
      this.db = new this.SQL.Database(saved);
      this.db.run("PRAGMA foreign_keys = ON");
    } else {
      this.db = new this.SQL.Database();
      this.db.run("PRAGMA foreign_keys = ON");
      this._createSchema();
      this._seedCategories();
      await this._persist();
    }
  },

  // ... schema, seed, CRUD methods identical to previous spec (see below) ...
};

// Make DB available globally for api.js bridge during transition
window.DB = DB;
```

The full schema (`_createSchema`), seed data (`_seedCategories`), persistence layer
(`_persist`, `_loadFromStorage`), query helpers (`_queryAll`, `_queryOne`, `_exec`,
`_lastInsertId`), and **all CRUD methods** are exactly as specified previously.
They are not repeated here — see the "CRUD Methods — Complete API Surface" and
"Business Logic to Port" sections below (unchanged from previous spec).

**One addition** — every exported method that writes data must call `await this._persist()`
and the calling code in `api.js` must `await` it. All DB methods that write become `async`:

```javascript
// Example: createAccount is now async
async createAccount(data) {
  // ... validation and INSERT ...
  this._exec("INSERT INTO accounts ...", [...]);
  const id = this._lastInsertId();
  await this._persist();          // <-- async persist
  return this.getAccount(id);
},
```

### Step 1.3: Rewrite `static/js/api.js` (ES Module)

```javascript
/**
 * api.js — API bridge layer.
 *
 * Delegates all calls to DB (local SQLite) or AI (direct REST).
 * Exports API object and also attaches to window for app.js compatibility.
 */

import { DB } from "./db.js";
// AI is imported in Sprint 2: import { AI } from "./ai.js";

export const API = {
  // ---- Accounts (local DB) ----
  getAccounts(includeInactive = false) { return DB.getAccounts(includeInactive); },
  getAccount(id) { return DB.getAccount(id); },
  createAccount(data) { return DB.createAccount(data); },
  mergeAccounts(sourceId, targetId) { return DB.mergeAccounts(sourceId, targetId); },
  unmergeAccount(id) { return DB.unmergeAccount(id); },
  deleteAccount(id) { return DB.deleteAccount(id); },

  // ---- Transactions (local DB) ----
  getTransactions(params = {}) { return DB.getTransactions(params); },
  getTransactionTotals(params = {}) { return DB.getTransactionTotals(params); },
  createTransaction(data) { return DB.createTransaction(data); },
  updateTransaction(id, data) { return DB.updateTransaction(id, data); },
  deleteTransaction(id) { return DB.deleteTransaction(id); },
  detectRecurring(accountId = null) { return DB.detectRecurring(accountId); },
  getRecurringTransactions() { return DB.getRecurringTransactions(); },
  getRecurringPatterns() { return DB.getRecurringPatterns(); },
  deleteRecurringPattern(id) { return DB.deleteRecurringPattern(id); },

  // ---- Categories (local DB) ----
  getCategories() { return DB.getCategories(); },
  createCategory(data) { return DB.createCategory(data); },
  updateCategory(id, data) { return DB.updateCategory(id, data); },
  deleteCategory(id) { return DB.deleteCategory(id); },
  getDefaultCategory() { return DB.getDefaultCategory(); },
  setDefaultCategory(id) { return DB.setDefaultCategory(id); },

  // ---- Merchants (local DB) ----
  getMerchants(params = {}) { return DB.getMerchants(params); },
  searchMerchants(q) { return DB.searchMerchants(q); },
  createMerchant(data) { return DB.createMerchant(data); },
  updateMerchant(id, data) { return DB.updateMerchant(id, data); },
  updateMerchantCategory(id, categoryId) { return DB.updateMerchantCategory(id, categoryId); },
  deleteMerchant(id) { return DB.deleteMerchant(id); },

  // ---- Goals (local DB) ----
  getGoals() { return DB.getGoals(); },
  getGoal(id) { return DB.getGoal(id); },
  createGoal(data) { return DB.createGoal(data); },
  updateGoal(id, data) { return DB.updateGoal(id, data); },
  deleteGoal(id) { return DB.deleteGoal(id); },
  contributeToGoal(id, amount) { return DB.contributeToGoal(id, amount); },

  // ---- Budgets (local DB) ----
  getBudgets(activeOnly = true) { return DB.getBudgets(activeOnly); },
  getBudget(id) { return DB.getBudget(id); },
  createBudget(data) { return DB.createBudget(data); },
  updateBudget(id, data) { return DB.updateBudget(id, data); },
  deleteBudget(id) { return DB.deleteBudget(id); },

  // ---- Chat (via AI module — Sprint 2) ----
  sendChatMessage(message) { return window.AI?.chat(message) ?? Promise.reject("AI not configured"); },
  sendChatMessageWithId(message, chatId) { return window.AI?.chat(message, chatId) ?? Promise.reject("AI not configured"); },
  getChatHistory(chatId) {
    const userId = "default_user";
    if (chatId) {
      return { chat_id: chatId, history: DB.getChatHistory(chatId, userId) };
    }
    const sessions = DB.listChatSessions(userId);
    if (!sessions.length) return { chat_id: null, history: [] };
    const latest = sessions[0].chat_id;
    return { chat_id: latest, history: DB.getChatHistory(latest, userId) };
  },
  clearChatHistory(chatId) {
    DB.clearChatHistory(chatId);
    return { message: "Chat history cleared" };
  },
  listChatSessions() { return { sessions: DB.listChatSessions() }; },

  // ---- Reports (local DB) ----
  getSpendingReport(params = {}) { return DB.getSpendingReport(params); },

  // ---- Export (local — triggers download directly) ----
  exportTransactionsUrl(params = {}) {
    const csv = DB.exportTransactionsCSV(params);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    return null;
  },

  // ---- Gmail (stub — implemented in Sprint 4) ----
  getGmailStatus() { return { connected: false }; },
  getGmailConnectUrl() { return { auth_url: "" }; },
  gmailSearch(_params) { throw new Error("Gmail sync not yet available in browser mode."); },
};

// Bridge: expose API globally for app.js (which uses onclick="..." referencing API)
window.API = API;
```

### Step 1.4: Update `static/js/app.js` — ES Module Conversion

`app.js` has 3,014 lines. The conversion is minimal:

**At the top**, add imports:
```javascript
import { API } from "./api.js";
import { DB } from "./db.js";
```

**At the bottom**, change `DOMContentLoaded` to listen for `db-ready` event instead
(since `main.js` handles DB init):
```javascript
// BEFORE:
document.addEventListener("DOMContentLoaded", () => {
  Toast.init();
  renderLayout();
  // ...
});

// AFTER:
document.addEventListener("db-ready", () => {
  Toast.init();
  renderLayout();
  Theme.init();
  Router.register("#/", renderDashboard);
  Router.register("#/transactions", renderTransactions);
  Router.register("#/transactions/new", renderAddTransaction);
  Router.register("#/sync", renderSync);
  Router.register("#/accounts", renderAccounts);
  Router.register("#/goals", renderGoals);
  Router.register("#/budgets", renderBudgets);
  Router.register("#/reports", renderReports);
  Router.register("#/chat", renderChat);
  Router.register("#/taxonomy", renderTaxonomy);
  Router.register("#/settings", renderSettings);  // NEW — Sprint 2
  Router.init();
});
```

**At the very bottom**, add the `window.*` bridge for inline onclick handlers:
```javascript
// Expose functions used in onclick="" HTML template attributes
Object.assign(window, {
  // Navigation & layout
  toggleOverflowMenu, closeOverflowMenu,
  // Transactions
  showEditTransaction, confirmDeleteTransaction, doDeleteTransaction,
  saveTransaction, toggleTxType, createTransaction,
  exportTransactions, runDetectRecurring,
  showMerchantLearnPrompt,
  // Accounts
  showCreateAccountModal, doCreateAccount,
  showMergeAccountModal, doMergeAccounts,
  confirmUnmergeAccount, doUnmergeAccount,
  confirmDeleteAccount, doDeleteAccount,
  toggleAccountChildren,
  // Sync / Gmail
  setSyncMode, connectGmail, runSync,
  // Taxonomy
  switchTaxonomyTab,
  showAddCategoryModal, showEditCategoryModal, doCreateCategory, doUpdateCategory,
  confirmDeleteCategory, doDeleteCategory, setDefaultCategory,
  showAddMerchantModal, showEditMerchantModal, doCreateMerchant, doUpdateMerchant,
  confirmDeleteMerchant, doDeleteMerchant,
  // Goals
  showCreateGoalModal, showEditGoalModal, doCreateGoal, doUpdateGoal,
  showContributeModal, doContributeToGoal,
  confirmDeleteGoal, doDeleteGoal,
  // Budgets
  showCreateBudgetModal, showEditBudgetModal, doCreateBudget, doUpdateBudget,
  confirmDeleteBudget, doDeleteBudget,
  // Reports
  loadReport,
  // Chat
  sendChatMessage, fillChatSuggestion, loadChatSession, chatInputKeydown,
});
```

**Everything in between stays exactly the same.** No render functions change. No DOM
manipulation changes. No routing changes.

### Step 1.5: Update `static/index.html`

```html
<!-- REPLACE the two script tags at the bottom: -->

<!-- BEFORE: -->
<script src="/static/js/api.js"></script>
<script src="/static/js/app.js"></script>

<!-- AFTER: -->
<script src="/static/js/sql-wasm.js"></script>
<script type="module" src="/static/js/main.js"></script>
```

CDN scripts (Chart.js, marked, DOMPurify) stay as regular `<script>` — they expose globals
that `app.js` uses via `Chart`, `marked`, `DOMPurify`.

### Step 1.6: Update `static/js/sw.js`

```javascript
const CACHE_NAME = "fincoach-v6"; // Bump from v5
const APP_SHELL = [
  "/",
  "/static/css/styles.css",
  "/static/js/sql-wasm.js",
  "/static/js/sql-wasm.wasm",
  "/static/js/main.js",
  "/static/js/db.js",
  "/static/js/ai.js",
  "/static/js/api.js",
  "/static/js/app.js",
  "/static/manifest.json",
];

// Install — cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate — clear old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch — cache-first for everything (no backend API calls to proxy)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Network-first for LLM API calls (Groq, OpenAI)
  if (url.hostname !== location.hostname) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for all local static assets
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
```

**Key change**: The old `sw.js` had network-first handling for `/api/`, `/accounts`,
`/transactions` etc. (backend routes). Those are gone — everything is local now.
Only external API calls (Groq, OpenAI) go to the network.

### Step 1.7: Validation Checklist

- [ ] Run `npm install` (creates `node_modules/` for dev tooling)
- [ ] Run `make dev` (starts `npx serve static` on :8080)
- [ ] No backend server running
- [ ] Open `http://localhost:8080` — app loads without errors
- [ ] Browser console shows no `import`/`export` errors
- [ ] Create an account → appears in Accounts screen
- [ ] Add a transaction → appears in Transactions screen
- [ ] Create a budget → shows spending calculation
- [ ] Set a goal → progress chart renders
- [ ] Create/edit/delete categories and merchants
- [ ] Run recurring detection → patterns detected
- [ ] Refresh page → all data persists (IndexedDB)
- [ ] Close browser, reopen → data still there
- [ ] Export CSV → file downloads with transaction data
- [ ] Run `make lint-js` → passes with no errors

---

## CRUD Methods — Complete API Surface

Every method below corresponds to a FastAPI route. The agent MUST implement all of these
in `db.js` as exported methods on the `DB` object. Each method name matches the `API.*`
method it replaces.

**Source mapping** (Python → JS):

| `api.js` method | Python source | `db.js` method | Key logic to port |
|-----------------|--------------|----------------|-------------------|
| `getAccounts(includeInactive)` | `routes/accounts.py:get_accounts` | `DB.getAccounts()` | Query + `populate_account_response()` |
| `getAccount(id)` | `routes/accounts.py:get_account` | `DB.getAccount()` | Same + 404 check |
| `createAccount(data)` | `routes/accounts.py:create_account` | `DB.createAccount()` | Validate balance for account_type |
| `mergeAccounts(src, tgt)` | `routes/accounts.py:merge_accounts` | `DB.mergeAccounts()` | All validation from `validate_merge_operation()` |
| `unmergeAccount(id)` | `routes/accounts.py:unmerge_account` | `DB.unmergeAccount()` | Reset merged_into, activate |
| `deleteAccount(id)` | `routes/accounts.py:delete_account` | `DB.deleteAccount()` | Block if has children |
| `getTransactions(params)` | `routes/transactions.py:get_transactions` | `DB.getTransactions()` | Filters, family expansion, pagination |
| `getTransactionTotals(params)` | `routes/transactions.py:get_transaction_totals` | `DB.getTransactionTotals()` | SUM/CASE aggregation |
| `createTransaction(data)` | `routes/transactions.py:create_transaction` | `DB.createTransaction()` | Auto-categorize via merchant lookup |
| `updateTransaction(id, data)` | `routes/transactions.py:update_transaction` | `DB.updateTransaction()` | PATCH semantics + merchant learning |
| `deleteTransaction(id)` | `routes/transactions.py:delete_transaction` | `DB.deleteTransaction()` | Simple delete |
| `detectRecurring(accountId)` | `routes/transactions.py:detect_recurring` → `recurring_service.py` | `DB.detectRecurring()` | Group txs, calculate intervals, find frequency, upsert patterns |
| `getRecurringTransactions()` | `routes/transactions.py:get_recurring_transactions` | `DB.getRecurringTransactions()` | Filter is_recurring=1 |
| `getRecurringPatterns()` | `routes/transactions.py:get_recurring_patterns` | `DB.getRecurringPatterns()` | Filter is_active=1 |
| `deleteRecurringPattern(id)` | `routes/transactions.py:delete_recurring_pattern` | `DB.deleteRecurringPattern()` | Simple delete |
| `getCategories()` | `routes/categories.py:list_categories` | `DB.getCategories()` | ORDER BY name |
| `createCategory(data)` | `routes/categories.py:create_category` | `DB.createCategory()` | Uniqueness check, default clearing |
| `updateCategory(id, data)` | `routes/categories.py:update_category` | `DB.updateCategory()` | Uniqueness check on name change |
| `deleteCategory(id)` | `routes/categories.py:delete_category` | `DB.deleteCategory()` | Block if merchants reference it |
| `getDefaultCategory()` | `routes/categories.py:get_default_category` | `DB.getDefaultCategory()` | Filter is_default=1 |
| `setDefaultCategory(id)` | `routes/categories.py:set_default_category` | `DB.setDefaultCategory()` | Clear all, set one |
| `getMerchants(params)` | `routes/merchants.py:list_merchants` | `DB.getMerchants()` | Pagination, join category name |
| `searchMerchants(q)` | `routes/merchants.py:search_merchants` | `DB.searchMerchants()` | LIKE on name + UPI ID |
| `createMerchant(data)` | `routes/merchants.py:create_merchant` | `DB.createMerchant()` | Validate category, check UPI dupe |
| `updateMerchant(id, data)` | `routes/merchants.py:update_merchant` | `DB.updateMerchant()` | Validate category + UPI uniqueness |
| `updateMerchantCategory(id, catId)` | `routes/merchants.py:update_merchant_category` | `DB.updateMerchantCategory()` | Update category + confidence |
| `deleteMerchant(id)` | `routes/merchants.py:delete_merchant` | `DB.deleteMerchant()` | Simple delete |
| `getGoals()` | `routes/goals.py:get_goals` | `DB.getGoals()` | SELECT all |
| `getGoal(id)` | `routes/goals.py:get_goal` | `DB.getGoal()` | By ID |
| `createGoal(data)` | `routes/goals.py:create_goal` | `DB.createGoal()` | Insert |
| `updateGoal(id, data)` | `routes/goals.py:update_goal` | `DB.updateGoal()` | Partial update |
| `deleteGoal(id)` | `routes/goals.py:delete_goal` | `DB.deleteGoal()` | Delete |
| `contributeToGoal(id, amount)` | `routes/goals.py:contribute_to_goal` | `DB.contributeToGoal()` | Increment current_amount |
| `getBudgets(activeOnly)` | `routes/budgets.py:get_budgets` | `DB.getBudgets()` | Filter active + compute spending |
| `getBudget(id)` | `routes/budgets.py:get_budget` | `DB.getBudget()` | By ID + compute spending |
| `createBudget(data)` | `routes/budgets.py:create_budget` | `DB.createBudget()` | Overlap check |
| `updateBudget(id, data)` | `routes/budgets.py:update_budget` | `DB.updateBudget()` | Period validation + overlap |
| `deleteBudget(id)` | `routes/budgets.py:delete_budget` | `DB.deleteBudget()` | Delete |
| `getSpendingReport(params)` | `routes/reports.py:get_spending_report` | `DB.getSpendingReport()` | GROUP BY category + monthly trend |
| `sendChatMessage(msg)` | `routes/chat.py:chat` | `AI.chat()` | Moved to Sprint 2 |
| `getChatHistory(chatId)` | `routes/chat.py:get_chat_history` | `DB.getChatHistory()` | Query conversations table |
| `clearChatHistory(chatId)` | `routes/chat.py:clear_chat_history` | `DB.clearChatHistory()` | Delete from conversations |
| `listChatSessions()` | `routes/chat.py:list_chat_sessions` | `DB.listChatSessions()` | GROUP BY chat_id |
| `exportTransactionsUrl(params)` | `routes/export.py:export_transactions` | `DB.exportTransactionsCSV()` | Generate CSV string |

### Business Logic to Port

These Python functions contain important logic that must be replicated in `db.js`:

**Account service** (`app/services/account_service.py`):
- `get_root_account(db, id)` → `DB._getRootAccountId(id)`: Walk up merge chain
- `collect_descendants(account)` → `DB._collectDescendants(id)`: Recursive children
- `get_account_family(db, id)` → `DB._getAccountFamily(id)`: Root → all descendants
- `get_effective_balance(db, id)` → `DB._sumTreeBalance(id)`: Sum self + all descendant balances
- `populate_account_response(db, acc)` → `DB._populateAccountResponse(acc)`: Enrich with merged_into_name, merged_accounts list, effective_balance
- `validate_merge_operation(db, src, tgt)` → inline in `DB.mergeAccounts()`: Self-merge check, existence, active check, already-merged check, cycle detection, type mismatch, max depth (5)

**Budget service** (`app/services/budget_service.py`):
- `calculate_budget_spending(db, budget)` → `DB._calculateBudgetSpending()`: SUM(ABS(amount)) for expense txs in period
- `determine_status(pct)` → inline: `>=100` → "exceeded", `>=80` → "warning", else "on_track"
- `check_budget_overlap(db, cat, start, end)` → `DB._checkBudgetOverlap()`: Overlapping date ranges
- `populate_budget_response(db, budget)` → `DB._populateBudgetResponse()`: Add spent, remaining, pct, status

**Recurring service** (`app/services/recurring_service.py`):
- `normalize_description(desc)` → inline: lowercase, strip, remove non-alphanumeric
- `amounts_match(a, b, tolerance=0.05)` → inline: 5% tolerance check
- `find_frequency(intervals)` → inline: Match median to known frequencies [7, 14, 30, 90, 365] within ±5 days
- `_group_transactions(txs)` → inline: Group by normalized desc + approximate amount
- Full detection pipeline in `DB.detectRecurring()`

**Transaction merchant learning** (`routes/transactions.py:_learn_merchant_mapping`):
- When user updates category with `learn_merchant=true`:
  1. Look up existing merchant by UPI ID or name
  2. Create or update merchant record with new category
  3. Link transaction to merchant
  4. Retroactively categorize other uncategorized txs from same merchant

### Database Schema

The complete schema (`_createSchema` method) mirrors `app/database.py` exactly:
- 9 tables: `accounts`, `categories`, `merchants`, `transactions`, `recurring_patterns`, `goals`, `budgets`, `processed_gmail_messages`, `conversations`
- All columns, types, defaults, constraints, and foreign keys match
- 12 indexes match the Python `Column(index=True)` and `__table_args__` definitions
- Seed data: 20 categories from `app/constants.py:SEED_CATEGORIES` with exact names and descriptions

Refer to `app/database.py` for the authoritative schema. The agent should read that file
and reproduce it in SQL `CREATE TABLE` statements.

### Persistence Layer

```javascript
// Save SQLite DB to IndexedDB (call after every write)
async _persist() {
  const data = this.db.export();
  const buffer = data.buffer;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => {
      const tx = req.result.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(buffer, "db");
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => { req.result.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
},

// Load SQLite DB from IndexedDB (returns Uint8Array or null)
async _loadFromStorage() {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => {
      const tx = req.result.transaction(DB_STORE, "readonly");
      const getReq = tx.objectStore(DB_STORE).get("db");
      getReq.onsuccess = () => {
        req.result.close();
        resolve(getReq.result ? new Uint8Array(getReq.result) : null);
      };
      getReq.onerror = () => { req.result.close(); resolve(null); };
    };
    req.onerror = () => resolve(null);
  });
},

// Query helpers
_queryAll(sql, params = []) {
  const stmt = this.db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
},

_queryOne(sql, params = []) {
  const rows = this._queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
},

_exec(sql, params = []) {
  this.db.run(sql, params);
},

_lastInsertId() {
  return this._queryOne("SELECT last_insert_rowid() as id").id;
},
```

---

## Sprint 2: AI Chat Migration (LangChain → Direct REST)

### Goal

AI chat calls go directly from browser to Groq/OpenAI REST API. No backend needed.

### Step 2.1: Create `static/js/ai.js` (ES Module)

```javascript
/**
 * ai.js — Direct LLM REST client.
 *
 * Replaces: app/ai_agent.py, app/model_manager.py, LangChain
 */

import { DB } from "./db.js";

const AI_SETTINGS_KEY = "fincoach-ai-settings";

export const AI_PROVIDERS = { /* ... provider config ... */ };

export const AI = {
  // Settings management, context building, question detection,
  // prompt assembly, direct REST calls — all as specified previously
  // ...
};

// Bridge for api.js to access before full import wiring
window.AI = AI;
```

The full implementation (settings management, `_buildContext()`, `_detectQuestionType()`,
prompt templates, `chat()` method) is exactly as previously specified. The only change is
adding `export` and `import { DB }`.

#### Provider endpoints (all OpenAI-compatible)

| Provider | Endpoint | Auth Header | CORS from Browser |
|----------|----------|-------------|-------------------|
| Groq | `https://api.groq.com/openai/v1/chat/completions` | `Bearer <key>` | Yes |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `Bearer <key>` | Yes |
| Ollama | `http://localhost:11434/v1/chat/completions` | None | Yes (with `OLLAMA_ORIGINS=*`) |

#### Prompt templates to copy from Python

Copy these EXACTLY from `app/ai_agent.py`:
- `BASE_INSTRUCTIONS` template
- `PROMPT_PURCHASE_DECISION`
- `PROMPT_SPENDING_ANALYSIS`
- `PROMPT_GOAL_PROGRESS`
- `PROMPT_OPTIMIZATION`
- `PROMPT_STATUS_QUERY`
- `PROMPT_GENERAL`

#### API key security

The API key is stored in `localStorage`. This is acceptable because:
- It's the user's own key on their own device
- Same security model as browser-saved passwords
- Single-user, local-first architecture — no server to steal from

### Step 2.2: Update `main.js` — Add AI Import

```javascript
import { DB } from "./db.js";
import "./ai.js";    // ADD THIS — registers AI globally
import "./api.js";
import "./app.js";
```

### Step 2.3: Update `api.js` — Wire Chat to AI

In Sprint 1, chat methods used `window.AI?.chat()`. Now with the AI module loaded, update:

```javascript
import { AI } from "./ai.js";  // ADD to imports

// In the API object, replace the stubs:
sendChatMessage(message) { return AI.chat(message); },
sendChatMessageWithId(message, chatId) { return AI.chat(message, chatId); },
```

### Step 2.4: Add Settings Screen to `app.js`

Add a new `renderSettings()` function and register `#/settings` route. The Settings screen
must include:

- AI Provider dropdown: Groq / OpenAI / Ollama (local) / None
- API Key input (password-type field)
- Model selector dropdown (populated from `AI_PROVIDERS[selected].models`)
- "Save Settings" button
- Status indicator: "Connected" / "Not configured"
- Navigation: Add a ⚙️ icon to the nav bar or overflow menu

### Step 2.5: Validation Checklist

- [ ] Go to Settings → select Groq → enter API key → save
- [ ] Go to Chat → ask "What's my balance?" → get response from Groq
- [ ] Ask follow-up → conversation history maintained
- [ ] Close browser, reopen → chat history persists
- [ ] Settings → select "None" → chat shows "AI not configured" message
- [ ] No backend server running during any of the above
- [ ] Run `make lint-js` → passes

---

## Sprint 3: Backup & Restore

### Goal

Users can export their entire database as a file and restore it later.

### Implementation

Already built into `db.js` (`exportDatabase()`, `importDatabase()`).
Sprint 3 adds the UI in the Settings screen (from Sprint 2).

#### Add to Settings screen (`app.js`):

- **Backup section** (below AI settings):
  - "Export Data" button → downloads `.db` file
  - "Import Data" file picker → restores from `.db` file
  - "Export CSV" button → downloads transactions CSV

```javascript
import { DB } from "./db.js";

function exportBackup() {
  const data = DB.exportDatabase();  // Returns Uint8Array
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fincoach-backup-${new Date().toISOString().split("T")[0]}.db`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  if (!confirm("This will replace ALL current data. Continue?")) return;
  const buffer = await file.arrayBuffer();
  await DB.importDatabase(new Uint8Array(buffer));
  location.reload();
}

function exportCSV() {
  const csv = DB.exportTransactionsCSV();
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
```

#### DB methods (in `db.js`):

```javascript
exportDatabase() { return this.db.export(); },

async importDatabase(uint8Array) {
  this.db = new this.SQL.Database(uint8Array);
  this.db.run("PRAGMA foreign_keys = ON");
  await this._persist();
},

exportTransactionsCSV(params = {}) {
  const txs = this.getTransactions({ ...params, limit: 99999, offset: 0 });
  const headers = ["Date", "Amount", "Type", "Description", "Category", "Account", "Merchant"];
  const rows = txs.map(t => [
    t.date, t.amount, t.transaction_type, t.description || "",
    t.category_name || "Other", t.account_name || "", t.merchant_name || "",
  ]);
  let csv = headers.join(",") + "\n";
  for (const row of rows) {
    csv += row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",") + "\n";
  }
  return csv;
},
```

### Validation Checklist

- [ ] Settings → Export Data → `.db` file downloads
- [ ] Clear IndexedDB (DevTools → Application → IndexedDB → delete)
- [ ] Settings → Import Data → select `.db` file → page reloads with data restored
- [ ] Export CSV → opens in Excel/Sheets with correct data

---

## Sprint 4: Gmail Sync (Serverless Proxy)

### Goal

Gmail sync works from the browser. Only OAuth token exchange goes through a
Cloudflare Worker (free tier: 100,000 requests/day).

### Step 4.1: Create Cloudflare Worker

File: `cloudflare-worker/gmail-proxy.js`

Handles ONLY:
1. `/auth/url` — generate Google OAuth URL
2. `/auth/callback` — exchange auth code for tokens (uses server-stored `client_secret`)
3. `/gmail/*` — proxy Gmail API calls (browser sends user's access token)

Environment variables (set in Cloudflare dashboard, never in code):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `REDIRECT_URI`

### Step 4.2: Create `static/js/gmail.js` (ES Module)

```javascript
import { DB } from "./db.js";
import { AI } from "./ai.js";

export const Gmail = {
  // OAuth flow, email fetching, HTML parsing, transaction extraction
};

window.Gmail = Gmail;
```

Browser-side implementation replacing `app/services/gmail_service.py`:
1. **OAuth flow**: Redirect to Google, receive tokens via Worker callback
2. **Email fetching**: Use Gmail API directly from browser (with access token)
3. **HTML parsing**: Use native `DOMParser` (replaces BeautifulSoup)
4. **Transaction extraction**: Call Groq/OpenAI directly with the extraction prompt from `app/agents/prompts.py:build_extraction_prompt`
5. **Categorization**: Call Groq/OpenAI with categorization prompt from `app/agents/prompts.py:build_batch_categorization_prompt`

### Step 4.3: Update `api.js` Gmail Methods

```javascript
import { Gmail } from "./gmail.js";

// Replace stubs:
getGmailStatus() { return Gmail.getStatus(); },
getGmailConnectUrl() { return Gmail.getConnectUrl(); },
gmailSearch(params) { return Gmail.search(params); },
```

### Validation Checklist

- [ ] Deploy Cloudflare Worker with Google credentials
- [ ] Settings → Connect Gmail → redirects to Google → returns with tokens
- [ ] Run sync → fetches bank emails → extracts transactions
- [ ] Transactions appear in the app with categories

---

## Sprint 5: Static Hosting & Distribution

### Goal

Deploy the static site for free. Users visit a URL, install as PWA, done.

### Step 5.1: Choose Hosting

| Platform | Recommended | Setup |
|----------|-------------|-------|
| **Cloudflare Pages** | **Yes** — pairs with Worker | Connect Git repo, set output dir to `static` |
| GitHub Pages | Alternative | `git subtree push --prefix static origin gh-pages` |
| Netlify | Alternative | Connect Git repo, set publish dir to `static` |

### Step 5.2: Deploy

```bash
# Via Makefile:
make deploy

# Or directly:
npx wrangler pages deploy static --project-name=fincoach
```

### Step 5.3: End-User Setup Guide

```
1. Open https://fincoach.yourname.dev in Chrome or Safari
2. Tap "Install" when prompted (or Menu → Add to Home Screen)
3. Open the app → tap ⚙️ Settings
4. Select "Groq" as AI provider
5. Enter your free Groq API key (get one at console.groq.com)
6. Tap "Save" → Start using!

Your data stays on your device. Back up regularly via Settings → Export Data.
```

---

## Testing Strategy

### JS Unit Tests (Vitest)

File: `tests/js/db.test.js`

```javascript
import { describe, it, expect, beforeEach } from "vitest";
// Mock initSqlJs and test DB methods
// Use sql.js from node_modules (devDependency) for real SQLite in tests

import initSqlJs from "sql.js";

describe("DB", () => {
  let DB;

  beforeEach(async () => {
    // Initialize fresh DB for each test
    globalThis.initSqlJs = initSqlJs;
    // Dynamic import to reset module state
    const mod = await import("../../static/js/db.js");
    DB = mod.DB;
    // Mock IndexedDB persistence (no-op in tests)
    DB._persist = async () => {};
    DB._loadFromStorage = async () => null;
    await DB.init();
  });

  it("seeds 20 categories on init", () => {
    const cats = DB.getCategories();
    expect(cats).toHaveLength(20);
  });

  it("creates and retrieves an account", async () => {
    const acc = await DB.createAccount({
      name: "Test Savings", balance: 1000, account_type: "savings"
    });
    expect(acc.name).toBe("Test Savings");
    expect(acc.balance).toBe(1000);
    expect(DB.getAccount(acc.id).name).toBe("Test Savings");
  });

  it("rejects negative balance for non-credit accounts", async () => {
    await expect(DB.createAccount({
      name: "Bad", balance: -100, account_type: "savings"
    })).rejects.toThrow();
  });

  // ... more tests for every CRUD operation
});
```

### E2E Tests (Playwright)

Existing Playwright tests in `tests/e2e/` can be migrated to JS with `@playwright/test`.
They test the same UI — just pointed at `http://localhost:8080` instead of `:8000`.

### Python Tests

The 689 Python unit tests (`make test-py`) continue to work and validate the reference
implementation. The JS migration mirrors the Python logic, so passing Python tests = confidence
that the JS implementation spec is correct.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | sql.js WASM is ~1MB download | Cached by service worker. One-time cost. |
| 2 | IndexedDB can be cleared by user | Backup/restore feature. Periodic reminder in Settings. |
| 3 | API key in localStorage | User's own key on their own device. Acceptable. |
| 4 | Groq CORS policy may change | Fallback: thin Cloudflare Worker proxy (~20 lines). |
| 5 | Browser storage limits | Browsers allow 50MB+ per origin. Finance data is tiny (<1MB for years). |
| 6 | sql.js boolean handling | SQLite stores booleans as 0/1. Cast with `!!value` when returning to UI. |
| 7 | Date handling differences | SQLite stores as TEXT. Use ISO format consistently. |
| 8 | No server-side PDF export | Replace ReportLab with jsPDF/pdfmake (CDN). |
| 9 | ES Module + onclick bridge | 54 functions exposed via `Object.assign(window, {...})`. Mechanical, one-time. |
| 10 | `type="module"` is deferred by default | Scripts load after DOM parse. `main.js` handles this correctly via `db-ready` event. |

---

## Post-Migration Cleanup (Optional, Future)

Once the JS migration is validated and stable:

1. **Archive Python backend**: Move `app/`, `tests/unit_tests/`, `tests/backend/` to a `backend-archive/` directory or separate branch
2. **Simplify `pyproject.toml`**: Remove or reduce to dev-only dependencies (Playwright, pytest)
3. **Simplify `Makefile`**: Remove Python targets, keep only JS targets
4. **Consider TypeScript**: Add `jsconfig.json` or migrate to `.ts` files with `tsc` for type checking (no runtime change — still outputs vanilla JS)
5. **Consider splitting `app.js`**: Break into `screens/dashboard.js`, `screens/transactions.js`, etc. using ES module imports. Not required but improves maintainability at 3,000+ lines.

These are all optional and should only be done after the migration is working and validated.
