# Financial Coach — Project Context

## Overview

A local-first financial coaching PWA — **Vanilla JS, no backend, no build step**.
Indian Rupee (₹) is the currency throughout. Deployed on Cloudflare Pages.

## Stack

- **Vanilla JS** with **ES Modules** (`import`/`export`, `<script type="module">`)
- **sql.js** (SQLite WASM) + **IndexedDB** for local-first data storage
- Direct REST calls to **Groq / OpenAI / Azure OpenAI / Google Gemini / Ollama** for AI features
- **Cloudflare Worker** (`cloudflare-worker/gmail-proxy.js`) for Gmail OAuth token exchange
- **Google Drive** encrypted backup/sync via Gmail OAuth token (AES-GCM + PBKDF2)
- Package manager: `npm` (dev deps only) | Formatter/Linter: `biome`
- **CDN globals** loaded as regular `<script>` tags (NOT importable as modules):
  - `Chart.js` — pie/line/doughnut charts
  - `marked` — Markdown rendering in chat
  - `DOMPurify` — sanitising AI HTML output
- **No build step, no bundler, no framework** — static files deployed to Cloudflare Pages

## Repository Layout

```
static/
  index.html           # SPA shell — loads CDN globals, sql-wasm.js, then main.js as module
  manifest.json        # PWA manifest
  _headers             # Cloudflare Pages headers (COOP/COEP for SharedArrayBuffer)
  css/styles.css       # All styles (dark/light theme vars)
  js/
    main.js            # Entry point — session guard, DB.init(), dispatches db-ready
    app.js             # SPA router (Router), all render*() screens, event delegation
    db.js              # DB singleton — sql.js WASM + IndexedDB, full SQLite schema
    ai.js              # AI singleton — Groq/OpenAI/Gemini/Azure/Ollama REST calls
    api.js             # API bridge — thin delegates to DB.* / AI.* / Gmail.*
    gmail.js           # Gmail OAuth + email fetching + LLM transaction extraction
    gdrive.js          # Google Drive encrypted backup/sync (AES-GCM)
    config.js          # App-level constants and localStorage key names
    utils.js           # Shared helpers: maskPII(), etc.
    sw.js              # Service worker — offline cache strategy
    sw-register.js     # Registers the service worker
    theme-init.js      # Runs before DOMContentLoaded — prevents flash of wrong theme
    theme-apply.js     # Applies theme from localStorage on load
    sql-wasm.js        # Vendored sql.js WASM loader (do NOT modify)
tests/
  js/                  # Vitest unit tests
    ai.test.js, ai-integration.test.js, app.test.js, bugs-integration.test.js
    db.test.js, gdrive.test.js, gmail.test.js, gmail-proxy.test.js
    main.test.js, theme.test.js, utils.test.js
  e2e/js/              # Playwright E2E tests
    accounts.spec.js, budgets.spec.js, bugs.spec.js, chat.spec.js
    dashboard.spec.js, gdrive.spec.js, goals.spec.js, navigation.spec.js
    pwa-smoke.spec.js, reports.spec.js, settings.spec.js, taxonomy.spec.js
    transactions.spec.js
    fixtures.js        # Shared pwaPage fixture (fresh DB per test)
cloudflare-worker/
  gmail-proxy.js       # Gmail OAuth proxy — handles /gmail/connect, /callback, /refresh
  wrangler.toml        # Cloudflare Worker config
requirements/          # Feature specs (active in root, done/ subfolder for completed)
```

## Implemented Features & Routes

| Route | Screen | Key capabilities |
|-------|---------|-----------------|
| `#/` | Dashboard | Balance summary, income/expense this month, recent transactions |
| `#/transactions` | Transactions | Filter by date/type/account/category, infinite scroll, edit, delete, CSV/PDF export |
| `#/transactions/new` | Add Transaction | Form with merchant autocomplete (maps category from DB) |
| `#/accounts` | Accounts | Hierarchical merge/unmerge (up to 5 levels deep), create, delete |
| `#/sync` | Gmail Sync | OAuth via Cloudflare Worker, date-range or N-days mode, LLM extraction |
| `#/goals` | Goals | CRUD, contribute, doughnut chart, deadline urgency colouring |
| `#/budgets` | Budgets | Period budgets, on-track/warning/exceeded status, progress bar |
| `#/reports` | Reports | Spending by category (pie) + monthly trend (line), category table |
| `#/chat` | AI Chat | Multi-session, chat history sidebar, markdown rendering, suggestion chips |
| `#/taxonomy` | Taxonomy | Categories tab + Merchants tab, search, set-default, confidence score |
| `#/settings` | Settings | AI provider config, data export/import/backup, Google Drive sync, session security |

## Database Schema (db.js)

Tables: `accounts`, `categories`, `merchants`, `merchant_aliases`, `transactions`,
`recurring_patterns`, `goals`, `budgets`, `conversations`, `processed_gmail_messages`,
`tags`, `transaction_tags`, `sync_tombstones`

Key constants in `db.js`:
- `SEED_CATEGORIES` — 20 default categories seeded on first run
- `SCHEMA_VERSION = 5` — version of the JSON sync envelope (`exportAsJSON`/`mergeFromJSON`)
- PRAGMA `user_version` migration runner (`MIGRATIONS`) currently ends at version 7
- `IDB_NAME = "fincoach"`, `IDB_STORE = "db"`, `IDB_KEY = "sqlite"`

### Multi-Device Sync (mergeFromJSON)

Google Drive sync merges a JSON envelope with WhatsApp/Telegram-style semantics: natural-key
**UNION** (no duplicates) + **last-writer-wins** by `updated_at` (merchants use
`last_updated`) + delete **tombstones** (`sync_tombstones` table). Mutable tables carry
`updated_at`; every `create*` clears a tombstone, every `update*` bumps `updated_at`, every
`delete*` records a tombstone. `mergeFromJSON` returns `{inserted, updated, deleted, skipped}`
per table and never blindly clears local data. `importDatabase` re-applies SCHEMA_SQL, runs
migrations, and re-seeds so restored binaries match a fresh DB.

`DB.loadSampleData()` (bridged by `API.loadSampleData()`, surfaced as the Settings → Sample
Data card on an empty DB) populates a realistic demo dataset for manual/E2E testing.


## AI Providers (ai.js)

| Key | Name | Models |
|-----|------|--------|
| `groq` | Groq | llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768 |
| `openai` | OpenAI | gpt-4o, gpt-4o-mini, gpt-3.5-turbo |
| `gemini` | Google Gemini | gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash |
| `azure` | Azure OpenAI | configured via resource name + deployment name |
| `ollama` | Ollama (Local) | llama3.1:8b, llama3.2:3b, mistral |

AI settings stored in `localStorage` under `AI_SETTINGS_KEY`.

## localStorage / Config Keys (config.js)

| Constant | Key | Purpose |
|----------|-----|---------|
| `GMAIL_PROXY_URL` | (URL) | Cloudflare Worker URL for Gmail OAuth |
| `GDRIVE_SYNC_INTERVAL_MS` | — | 1 hour auto-sync cooldown |
| `GDRIVE_LAST_SYNC_KEY` | `fincoach-gdrive-last-sync` | Last GDrive sync timestamp |
| `GDRIVE_ENABLED_KEY` | `fincoach-gdrive-enabled` | Whether auto-sync is enabled |
| `GDRIVE_BACKUP_API_KEY_KEY` | `fincoach-gdrive-backup-api-key` | Include API key in Drive backup |
| `GDRIVE_SYNC_LOCK_KEY` | `fincoach-gdrive-sync-lock` | GDrive sync mutex |
| `GMAIL_SETTINGS_KEY` | `fincoach-gmail-settings` | Gmail OAuth token + email |
| `AI_SETTINGS_KEY` | `fincoach-ai-settings` | AI provider/model/key settings |
| `SESSION_LAST_ACTIVITY_KEY` | `fincoach-session-last-activity` | Last user activity time |
| `TRUSTED_DEVICE_KEY` | `fincoach-trusted-device` | Disable session expiry |
| `SESSION_EXPIRY_MS` | — | 6 hours (21,600,000 ms) |

## Session Security

- Default: data wiped after **6 hours of inactivity** (`SESSION_EXPIRY_MS`)
- Trusted device mode: data persists indefinitely (opt-in via Settings)
- `main.js` checks session on boot and also on a 1-minute interval while the app is open
- `DB.wipeSession()` clears all data on expiry

## Coding Standards

- **ES Modules**: All files use `import`/`export`
- **No magic values**: Use named constants
- **Async**: Use `async/await` for all I/O
- **Functions**: Keep small and focused
- **DRY/SOLID**: Follow strictly

### Biome Configuration

- 100-char lines, tab indentation, double quotes
- Lints `static/js/` — run `make lint` after every change

## Build & Test

```bash
make sync           # Install JS dev deps (npm install)
make dev            # Serve static files on :8111
make lint           # Format + lint JS (biome)
make test-unit      # JS unit tests (vitest)
make test-e2e       # Playwright E2E tests
make deploy         # Deploy to Cloudflare Pages
make test           # Run all tests (unit + E2E)
make clean-ports    # Kill orphaned servers on :8080, :8082
```

## Guardrails

- All files use ES Modules (`import`/`export`), loaded via `<script type="module">`
- CDN globals (Chart, marked, DOMPurify) are loaded as plain `<script>` tags — not importable
- No runtime npm dependencies — the app ships as static files only
- Every DB write method must `await this._persist()` to IndexedDB
- Functions used in `onclick=""` HTML templates must be exposed on `window` via `Object.assign(window, {...})`
- Event handling uses **data-action** attribute delegation in `app.js` — not direct onclick bindings
- Never add a bundler or build step
- Run `make lint` after every JS change
- Run `make test-unit` after every JS change and verify all tests pass
- Zero tolerance for regressions — fix any failing tests before reporting

## Gmail Transaction Deduplication

Two deduplication layers in `gmail.js._importTransaction()`:
1. **Layer 1** — `processed_gmail_messages` table (checked before email fetch). Gmail IDs already recorded are skipped.
2. **Layer 2** — date + amount + account_id field check. **Only applied to non-Gmail transactions** (no `gmail_message_id`). This allows multiple legitimate same-day/same-amount emails (e.g., 3 SIP debits) to all be imported.

DB `transaction_id` for Gmail rows is always `"gmail_<gmail_message_id>"` to avoid UNIQUE constraint collisions from shared bank references.

## Edit Transaction Modal — Notes Field

- **Gmail transactions**: `#edit-desc` starts empty; LLM-extracted `description` is shown as placeholder text. Saving with an empty Notes field preserves the original `description` in the DB.
- **Manual transactions**: `#edit-desc` is pre-filled with `description` value as before.

## Reading Plane.so Tickets — Always Check Comments

When reading any Plane.so work item (for requirements, bug status, or duplicate checks), **always fetch its comments** in addition to the title and description. Comments frequently contain:
- Accepted-risk decisions with rationale
- Duplicate or superseded-by notes
- Resolution context not captured in the description field

Use the plane agent or the comments endpoint directly: `GET /issues/{issue_id}/comments/`

## Security Issue Tracking (Plane.so)

Whenever a security vulnerability, compliance concern, or access control issue is discovered during development, code review, or automated scanning:

1. **Check for duplicates** — list Plane.so work items with the `security` label and state ≠ Done before logging.
2. **Create a Plane.so work item** (via the `plane` subagent) with:
   - The **`security`** label applied
   - Priority: High for critical/high severity, Medium for medium, Low for low
   - State: Backlog
3. **Title format**: `SEC-<SEVERITY>-<N>: <Short description>`
4. **Description** must include: affected file(s) + line numbers, description of the vulnerability, OWASP category, and a suggested fix.

The security label color is `#EB144C`. Only the **tester agent** creates these work items.
