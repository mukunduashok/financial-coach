---
applyTo: "static/**,tests/js/**,package.json,biome.json,vitest.config.js,cloudflare-worker/**"
description: "Frontend (JS) conventions for the local-first PWA migration. Applies when working on static files, JS tests, or frontend config."
---

# Financial Coach — Frontend (JavaScript) Conventions

## Project Overview

A local-first Progressive Web App using sql.js (SQLite WASM) in the browser with direct LLM REST calls — no backend required.

## Architecture

```
main.js (entry point, <script type="module">)
 ├── db.js           (exports DB — SQLite WASM + IndexedDB persistence)
 ├── ai.js           (exports AI — direct Groq/OpenAI/Gemini/Azure/Ollama REST calls)
 ├── api.js          (exports API — thin bridge, delegates to DB/AI/Gmail)
 ├── app.js          (imports API — UI rendering, routing, event handling)
 ├── gmail.js        (exports Gmail — OAuth via Cloudflare Worker, email fetch + LLM extraction)
 └── gdrive.js       (exports GDrive — Google Drive AES-GCM encrypted backup/sync)
```

### CDN Globals (loaded before `main.js` as plain `<script>` tags in `index.html`)

| Global | Library | Usage |
|--------|---------|-------|
| `Chart` | Chart.js 4.x | All charts (pie, doughnut, line) |
| `marked` | marked | Markdown-to-HTML for AI chat responses |
| `DOMPurify` | DOMPurify | Sanitise AI HTML output before injection |

**⚠️ These CDN globals cannot be imported as ES modules — always access via `window.Chart`, `window.marked`, `window.DOMPurify`.**

## Coding Standards

- **Framework**: Vanilla JavaScript with ES Modules
- **Formatting**: Biome (`npx @biomejs/biome check --fix static/js/`)
  - Tab indentation
  - 100 character line limit
  - Double quotes for strings
  - Semicolons required
- **Lint + format**: Run `make lint` (which calls `biome check --fix`)
- **Tests**: Vitest with jsdom (`npx vitest run` or `make test-unit`)
- **Dev server**: `npx serve static -l 8080 --cors` or `make dev`

## Key Rules

### 1. Database Persistence

**Every write method must call `await this._persist()`**:

```js
// ❌ WRONG — missing _persist() call
async function createCategory(data) {
   this._exec("INSERT INTO categories VALUES (?, ?, ?, ?, ?)", [...]);
   return id; // Missing persistence!
}

// ✅ CORRECT — persist after every mutation
async function createCategory(data) {
   this._exec("INSERT INTO categories ...", [...]);
   await this._persist(); // Persist to IndexedDB
   return this._lastInsertId();
}
```

### 2. Window Exposed Functions

**Functions used in `onclick=""` attributes must be on `window`**:

```js
// At bottom of app.js, expose all onclick handlers:
Object.assign(window, {
  handleShowModal: () => { ... },
  handleSaveTransaction: () => { ... },
  handleEditCategory: () => { ... }
});
```

### 3. API Bridge Pattern

**`api.js` is a thin bridge — it only delegates to `DB.*`, `AI.*`, or `Gmail.*`. No business logic.**

```js
// ❌ WRONG — business logic in api.js
export async function createTransaction(data) {
   // Don't do this in api.js!
   if (data.amount < 0) throw new Error("Invalid amount");
   
   const result = await DB.createTransaction(data);
   return result;
}

// ✅ CORRECT — delegate to DB, let db.js handle validation
export async function createTransaction(data) {
   return await DB.createTransaction(data); // Delegate only
}
```

### 4. Event Delegation

**Use `data-action` attributes — not inline `onclick` — handle in delegated listeners**:

```html
<!-- ❌ WRONG — inline onclick -->
<button onclick="saveTransaction(this)">Save</button>

<!-- ✅ CORRECT — data-action -->
<button data-action="save-transaction" data-id="123">Save</button>
```

```js
// In app.js, handle delegation:
document.addEventListener("click", (e) => {
   const btn = e.target.closest("[data-action]");
   if (!btn) return;
   
   switch (btn.dataset.action) {
     case "save-transaction":
       saveTransaction(btn.dataset.id);
       break;
   }
});
```

### 5. Seed Categories

The default category list is defined in `db.js` as `SEED_CATEGORIES`:

```js
// In static/js/db.js
const SEED_CATEGORIES = {
  "Food & Dining": "Restaurants, food delivery, cafes...",
  Groceries: "Supermarkets, grocery delivery...",
  Transportation: "Daily commute, fuel, parking...",
  // ... 16 total categories
};

// In _seedCategories() method:
_seedCategories() {
   const count = this._queryOne("SELECT COUNT(*) as c FROM categories");
   if (count && count.c > 0) return;
   
   for (const [name, description] of Object.entries(SEED_CATEGORIES)) {
     this._exec(
       "INSERT INTO categories (name, description, created_at, updated_at) VALUES (?,?,?,?)",
       [name, description, now, now]
     );
   }
   await this._persist();
}
```

### 6. CDN Globals Access Pattern

**Never import CDN globals — access via `window.*`**:

```js
// ❌ WRONG — these won't work as ES modules
import Chart from 'chart.js';
import marked from 'marked';
import DOMPurify from 'dompurify';

// ✅ CORRECT — access via window objects
const chart = new window.Chart(ctx, { type: 'pie', data: ... });
const html = window.marked(mdText);
const sanitized = window.DOMPurify.sanitize(userInput);
```

### 7. No Inline Styles (CSP `style-src 'self'`)

The CSP is tightened to `style-src 'self'` (no `'unsafe-inline'`), so the browser
**silently ignores any inline `style="..."` attribute**. Never emit inline styles
from `app.js` render functions.

- Toggle visibility with the `.hidden` class (`display: none !important`) via
  `classList.toggle("hidden", condition)` — not `el.style.display`.
- Use the utility/semantic classes in `styles.css` (`.balance-card`, `.btn-group`,
  `.btn-reimport`, `.stats-row`, `.mt-*`, `.mb-*`, `.text-success`, etc.) instead
  of inline styles.
- Regression guard: `tests/js/app.test.js` asserts `static/js/app.js` contains
  zero `style="` occurrences.

## Module Responsibilities

| Module | Responsibility | When to modify |
|--------|---------------|----------------|
| `main.js` | Entry point, session guard, DB init, event dispatch | Session expiry logic changes |
| `db.js` | All database operations, schema migrations, persistence | New features requiring data storage |
| `ai.js` | LLM provider integration, chat functionality, prompt templates | AI-related features or prompt changes |
| `api.js` | Thin API bridge layer (delegates only) | Adding new API methods |
| `app.js` | All UI rendering, routing, event handling, modals | New screens or major UI changes |
| `gmail.js` | Gmail OAuth flow, email fetching, transaction extraction | Gmail-related features |
| `gdrive.js` | Google Drive encrypted backup and sync | Drive backup features |
| `config.js` | Application constants, localStorage keys | Adding new config options |

## Session Security

The app implements a 6-hour session expiry by default:

- On boot: checks if last activity > 6 hours ago → wipes session
- Every 60s: re-checks via `setInterval` while app is open
- Activity tracked via `click`, `keydown`, `touchstart`, `scroll` events
- Trusted device mode (opt-in) disables expiry

```js
// localStorage keys for session tracking:
fincoach-session-last-activity   // Unix timestamp ms of last user interaction
fincoach-trusted-device          // "true" disables expiry permanently
```

## File Locations

| Purpose | Location | Format |
|---------|----------|--------|
| Production build entry | `static/js/main.js` | ES Module |
| Database layer | `static/js/db.js` | ES Module |
| AI/LLM interface | `static/js/ai.js` | ES Module |
| API bridge | `static/js/api.js` | ES Module |
| Main application | `static/js/app.js` | ES Module |
| Gmail integration | `static/js/gmail.js` | ES Module |
| Drive backup | `static/js/gdrive.js` | ES Module |
| Config/constants | `static/js/config.js` | ES Module |
| Utilities | `static/js/utils.js` | ES Module |

## Testing Commands

```bash
# Run full test suite
make test-unit    # Vitest unit tests
make test-e2e     # Playwright E2E tests

# Run specific test file
npx vitest run tests/js/db.test.js
npx playwright test tests/e2e/js/transactions.spec.js

# Lint/format (MUST run after every change)
make lint         # Biome check + fix
```

## Agent Roles

When working on JavaScript changes:

### Developer Agent
- Implements code according to approved plan
- Writes **unit tests** in `tests/js/`
- Runs `make lint` and `make test-unit` after implementation
- Does NOT modify E2E tests

### Tester Agent
- Writes functional/integration tests in `tests/js/`
- Writes E2E tests in `tests/e2e/js/` (Playwright)
- Runs full test suite before reporting results
- Logs bugs found in plane.so (via the `plane` subagent)

## Mandatory Checklist After Changes

Before completing any implementation task, always run:

```bash
make lint        # Format + lint with Biome (100-char lines, double quotes)
make test-unit   # Run Vitest — verify no regressions
make dev         # Start dev server and manually verify in browser
```

**Zero tolerance for regressions** — all previously passing tests must continue to pass.
