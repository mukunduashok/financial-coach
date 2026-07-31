---
applyTo: "static/**,tests/**"
description: "Living map of all implemented features, DB methods, API bridge methods, and UI routes. Read this before planning or implementing any new feature."
---

# Financial Coach — Features Map

> **Important**: This is a living document that tracks the current state of the application. Always read this file before planning or implementing any new feature to understand existing patterns and avoid duplication.

## SPA Routes (Router in app.js)

All routes are registered at the bottom of `app.js` using `Router.register(hash, renderFn)`.

| Route | Render Function | Screen Description |
|-------|----------------|-------------------|
| `#/` | `renderDashboard()` | Shows total balance, monthly income/expenses, recent 10 transactions, and an upcoming-bills panel driven by pending transaction follow-ups |
| `#/transactions` | `renderTransactions()` | Displays all transactions with filters (date range, type, account, category, tag), infinite scroll pagination (50/page), totals bar showing income/expense/net |
| `#/transactions/new` | `renderAddTransaction()` | New transaction form with merchant autocomplete and auto-categorization based on LLM |
| `#/accounts` | `renderAccounts()` | Account cards showing balances with merge hierarchy support (≤5 levels), create/delete actions |
| `#/sync` | `renderSync()` | Gmail connection status, OAuth flow, sync mode selection (N-days or date-range), transaction extraction, SIP-safe deduplication |
| `#/goals` | `renderGoals()` | Financial goals CRUD with doughnut chart progress indicator, deadline urgency coloring |
| `#/budgets` | `renderBudgets()` | Budget management with progress bars for spending limits across periods |
| `#/reports` | `renderReports()` | Spending analysis with pie chart + monthly line chart, category breakdown table, tag filter |
| `#/chat` | `renderChat()` | AI chat interface with message history, session management, and suggestion chips |
| `#/taxonomy` | `renderTaxonomy()` | Taxonomy browser for categories tab, merchants tab, and tags tab |
| `#/settings` | `renderSettings()` | Settings panel for AI provider configuration, data export/import, Google Drive sync, session security, trusted device. Has a `<footer class="settings-legal-footer">` with links to `/privacy.html` and `/terms.html` (both open in new tab). |

## Database Methods (DB singleton in db.js)

All database operations are available through the `DB` object exported from `static/js/db.js`.

### Accounts Management

```js
// Get all accounts (optional filter for inactive accounts)
await DB.getAccounts(includeInactive = false);
// Returns: array of account objects with merged children nested in merged_accounts

// Get single account with merged children
await DB.getAccount(id);
// Returns: { id, name, balance, account_type, merged_accounts: [] }

// Create new account
const acc = await DB.createAccount({
   name: "Test Bank",
   balance: 50000,
   account_type: "savings",      // savings | current | deposit | credit
   account_identifier: "1234567890"  // unique identifier (PAN/card number)
});

// Merge accounts (max depth = 5)
await DB.mergeAccounts(sourceId, targetId);
// sourceId is marked as merged into targetId, children of source are reattached to target

// Unmerge an account
await DB.unmergeAccount(id);

// Delete an account (fails if it has transactions)
await DB.deleteAccount(id);

// Update balance (used by Gmail sync for balance updates)
await DB.updateAccountBalance(identifier, newBalance);
```

### Transactions CRUD

```js
// Get transactions with optional filtering
const txs = await DB.getTransactions({
   date_from: "2024-01-01",
   date_to: "2024-01-31",
   account_id: 1,
   category_id: 5,
   transaction_type: "expense",    // "income" | "expense" | "" (all)
   include_merged: true,            // Include transactions from merged child accounts
   limit: 50,                       // Pagination
   offset: 0
});

// Get transaction totals for filtered set
const totals = await DB.getTransactionTotals({ date_from, date_to, account_id });
// Returns: { total_income, total_expense, net, transaction_count }

// Create transaction
const tx = await DB.createTransaction({
   date: "2024-01-15",
   amount: 1500,                  // Will be negated if transaction_type = "expense"
   transaction_type: "expense",   // "income" | "expense"
   account_id: 1,                 // Link to account
   description: "Grocery shopping",        // Optional - extracted from email
   category_id: 3,                // Optional - auto-assigned by LLM or user-selected
   merchant_name: "BigBasket",    // Optional - optional
   merchant_upi_id: "bigbasket@yahooin",  // Optional for UPI transactions
   transaction_id: "unique-uuid"  // Optional - unique identifier
});

// Update transaction (includes merchant learning)
const updated = await DB.updateTransaction(id, { category_id: 5 });
// If merchant_upi_id exists and learn_merchant=true, creates/updates merchant record
// If merchant_name changed and learn_merchant_name=true (FINCO-50), the new name is
// remembered for past & future transactions from the same merchant (see rename memory below)

// Delete transaction
await DB.deleteTransaction(id);
```

### Categories Management

```js
// Get all categories ordered by name
const categories = await DB.getCategories();

// Create category
await DB.createCategory({ name: "Food & Dining", description: "Restaurants, groceries..." });

// Update category
await DB.updateCategory(id, { name: "Updated Name" });

// Delete category
await DB.deleteCategory(id);

// Get default category
const defaultCat = await DB.getDefaultCategory();

// Set new default (clears old default)
await DB.setDefaultCategory(5);
```

### Merchants Management

```js
// Get merchants with optional limit/offset for pagination
const merchants = await DB.getMerchants({ limit: 50, offset: 0 });

// Search merchants by name or UPI ID (fuzzy match)
const results = await DB.searchMerchants("big basket");

// Create merchant record
await DB.createMerchant({
   merchant_upi_id: "merchant@yahooin",      // Optional - unique identifier
   merchant_name: "BigBasket",               // Optional - searchable name
   category_id: 2,                          // Required - link to category
   confidence_score: 0.9                    // Optional - LLM confidence
});

// Update merchant
await DB.updateMerchant(id, { merchant_name: "Updated Name" });

// Change merchant's category
await DB.updateMerchantCategory(id, newCategoryId);

// Delete merchant
await DB.deleteMerchant(id);
```

### Tags Management

```js
// Get all tags
const tags = await DB.getTags();
// Returns: [{ id, name, created_at }, ...]

// Create a tag
const tag = await DB.createTag(name);

// Delete a tag (also removes transaction_tags rows via CASCADE)
await DB.deleteTag(id);

// Set all tags for a transaction (replaces existing)
await DB.setTransactionTags(txId, [tagId1, tagId2]);
```

### Transaction Follow-ups / Reminders (FINCO-22)

Follow-ups are attached 1:1 to a transaction (table `transaction_follow_ups`) and created,
edited, or removed from the transaction edit modal ("Track as Follow-up / Reminder" toggle).
They are managed in the Transactions → "Bills & Reminders" tab (filter chips All/Pending/Done,
per-row Mark done / Reopen / Open / Remove, inline due-date + recurring toggle). This replaced
the old auto-detected recurring-pattern Bills UI.

```js
// CRUD
const fu = await DB.createFollowUp(transactionId, { title, follow_up_type, due_date,
  is_recurring, recurrence, notes }); // status defaults to 'pending'
await DB.updateFollowUp(id, fields);         // bumps updated_at
await DB.deleteFollowUp(id);                 // records a 'follow_up' tombstone (keyed on tx_id)
await DB.getFollowUp(transactionId);         // single follow-up for a transaction
await DB.getFollowUpById(id);
await DB.getFollowUps({ status, follow_up_type }); // pending-first (overdue→soon→later→undated),
                                                    // then done by completed_at desc

// Completion semantics
await DB.markFollowUpDone(id); // non-recurring → status 'done' + completed_at;
                               // recurring → stays 'pending', due_date rolls forward
                               // (weekly +7d, monthly +1mo, quarterly +3mo, yearly +1yr)
await DB.reopenFollowUp(id);   // status 'pending', clears completed_at

// Dashboard widget — pending follow-ups with due_date within N days
const bills = await DB.getUpcomingBills(days = 7);
```

Sync: `transaction_follow_ups` carries `updated_at`; `mergeFromJSON`/`exportAsJSON` use
natural-key UNION + last-writer-wins with `follow_up` tombstones keyed on the parent
`transaction_id`.

### Merchants — Identity & Rename (v4 + FINCO-50 rename memory)

Merchant identity is stable: each merchant has an immutable `merchant_key` (from UPI id or
name slug) plus learned `merchant_aliases`. Transactions link via `transactions.merchant_id`.
A rename only changes the merchant's `display_name` — it does NOT mutate any transaction's
stored `merchant_name`. The displayed name is resolved at READ time in
`_buildTransactionResponse` (a linked merchant's `display_name` wins over the row's text), so
a rename automatically surfaces on all of that merchant's transactions.

```js
// Rename a merchant — surfaces on all linked transactions via the merchant_id join
await DB.updateMerchant(merchantId, { merchant_name: "New Display Name" });
```

**Merchant rename memory (FINCO-50).** When a merchant name is edited on a transaction in the
Edit Transaction modal, `saveTransaction` (app.js) compares the typed name to the original.
If it changed, `showMerchantRenamePrompt` asks *"Remember this merchant name?"* with
`#merchant-name-yes` ("Yes, apply to all") / `#merchant-name-no` ("No, just this one").
Confirming sends `learn_merchant_name: true` in the single `API.updateTransaction` call
(alongside `learn_merchant` if the category also changed). `DB.updateTransaction` then:

- For an **unlinked** transaction: creates/links a merchant identity with the new
  `display_name`, keyed on the ORIGINAL merchant string, and records aliases for both the
  normalized original and new names.
- For an **already-linked** transaction: updates the merchant's `display_name` (keeping the
  original name resolvable via `merchant_key`/alias).

As a result, future transactions carrying the SAME original merchant string auto-map to the
renamed name (and inherit the learned category when `learn_merchant` was also set). Declining
the prompt renames only that single row and leaves other/future transactions untouched. No
rename prompt appears when the merchant name is unchanged.

### Goals Management

```js
// Get all goals
const goals = await DB.getGoals();

// Get single goal
const goal = await DB.getGoal(id);

// Create goal
await DB.createGoal({ name: "Emergency Fund", target_amount: 50000, deadline: "2024-12-31" });

// Update goal progress
await DB.updateGoal(id, { current_amount: 25000 });

// Contribute to goal (increment current_amount)
await DB.contributeToGoal(id, amount);  // Adds amount to current_amount

// Delete goal
await DB.deleteGoal(id);
```

### Budgets Management

```js
// Get active budgets with computed status
const budgets = await DB.getBudgets(activeOnly = true);
// Each budget includes: spent_to_date, remaining, percentage_used, status (on_track|warning|exceeded)

// Create budget
await DB.createBudget({ category_id: 3, period_start: "2024-01-01", period_end: "2024-01-31", limit_amount: 5000 });

// Update budget
await DB.updateBudget(id, { limit_amount: 6000 });

// Delete budget
await DB.deleteBudget(id);
```

### Chat History

```js
// Save a chat message (user or assistant)
await DB.saveChatMessage(userId, chatId, role, content);  // role = "user" | "assistant"

// Get chat history for a session
const { chat_id, history } = await DB.getChatHistory(chatId);
// history: [{ role, content, timestamp }, ...]

// Clear all messages from a chat session
await DB.clearChatHistory(chatId);

// List all chat sessions
const sessions = await DB.listChatSessions();
// Returns: [{ chat_id, preview, message_count, last_message_at }, ...]
```

### Reports

```js
// Get spending report for analysis
const report = await DB.getSpendingReport({ start_date, end_date, account_id });
// Returns: { total_spent, total_transactions, by_category: [...], monthly_trend: [...] }
```

### Gmail / Drive Integration

```js
// Cleanup orphaned Gmail IDs (for deleted transactions) — enables re-import
await DB.cleanupOrphanedGmailIds();

// Bulk-mark Gmail messages as processed (called after each sync batch)
await DB.saveProcessedGmailIds([messageId1, messageId2]);

// Check which of a set of IDs are already processed (returns Set<string>)
const processedSet = DB.getProcessedGmailIds([id1, id2]);

// Full session wipe (all data)
await DB.wipeSession();  // Clears SQLite + IndexedDB, redirects to onboarding
```

#### Gmail Transaction Deduplication (Two Layers)

1. **Layer 1 — Gmail message ID** (`processed_gmail_messages` table): checked *before* fetching emails. Any message ID already recorded is skipped entirely (counted as `skipped`).
2. **Layer 2 — Field-based check** (date + amount + account_id): only applied to **non-Gmail** transactions (those without a `gmail_message_id`). Gmail-sourced transactions are never filtered by Layer 2, so multiple legitimate same-day same-amount emails (e.g., 3 SIP debit notifications) are all imported.

When a transaction is **deleted**, its `gmail_message_id` is removed from `processed_gmail_messages` immediately so it can be re-imported on the next sync. "Re-import deleted transactions" (`cleanupOrphanedGmailIds()`) performs a bulk cleanup of any orphaned entries.

The DB `transaction_id` for Gmail-sourced transactions is always `"gmail_<gmail_message_id>"` — never the LLM-extracted bank reference — ensuring the UNIQUE constraint is never violated even when multiple emails share the same bank reference (e.g., same MF folio).

### Data Backup / Restore

```js
// Export full database to Uint8Array (encrypted by GDrive module)
const dbBytes = await DB.exportDatabase();

// Import from Uint8Array (decrypt by GDrive before importing).
// On import the canonical SCHEMA_SQL is re-applied, the ordered migration runner runs,
// and default categories/tags are re-seeded so a restored binary matches a fresh DB.
await DB.importDatabase(dbBytes);
```

### Multi-Device Sync (exportAsJSON / mergeFromJSON)

Google Drive sync uses a JSON envelope (not the raw binary) so two devices can be merged
safely without data loss. `SCHEMA_VERSION = 5` and the envelope carries every table in
`SYNC_TABLES` (13 tables, incl. `sync_tombstones`).

```js
// Snapshot every synced table into a versioned envelope.
const envelope = await DB.exportAsJSON();

// Merge a remote snapshot into the local DB (multi-device safe). Returns
// { inserted, updated, deleted, skipped } counts keyed by table.
const stats = await DB.mergeFromJSON(envelope);
```

`mergeFromJSON` implements WhatsApp/Telegram-style sync semantics:
- **Natural-key UNION** — the same real-world record is matched by a device-independent key
  (transaction → `transaction_id`; account → `account_identifier` or name+type; category →
  name; merchant → `merchant_key`/UPI; tag → name; goal → name+target+created; budget →
  category+period; recurring → pattern+account) so it is never duplicated.
- **Last-writer-wins (LWW)** — when both sides have a record, the one with the newer
  `updated_at` (or `last_updated` for merchants) wins. Hand-built envelopes without an
  `updated_at` are treated as timestamp 0, so they lose to local edits.
- **Delete tombstones** — deleting any entity records a row in `sync_tombstones`
  (`entity_type`, `entity_key`, `deleted_at`). On merge, a tombstone deletes the local row
  when `deleted_at >= row.updated_at` and suppresses re-insertion of the remote row. A
  locally re-created (newer) row survives. Account/category deletes are skipped while still
  referenced (guards prevent orphaning).

Every `create*` clears a matching tombstone; every `update*` bumps `updated_at`; every
`delete*` records a tombstone.

### Sample Data Loader (dev/testing)

```js
// Populate a realistic ₹ demo dataset (accounts incl. a credit card + merged hierarchy,
// merchants with UPI ids + aliases, ~50 transactions across 3 months incl. excluded and
// Gmail-style rows, budgets, goals, tags). Refuses to run on a non-empty database.
const summary = await DB.loadSampleData();
// → { accounts, transactions, merchants, budgets, goals, tags }
```

Surfaced in Settings → "Sample Data" card (only shown on an empty DB) via the
`load-sample-data` data-action, bridged by `API.loadSampleData()`.


## API Bridge Methods (api.js)

The `API` object is a thin bridge that delegates to `DB.*`, `AI.*`, and `Gmail.*`. No business logic here.

### Accounts Bridge
```js
API.getAccounts(includeInactive?)
API.getAccount(id)
API.createAccount(data)
API.mergeAccounts(sourceId, targetId)
API.unmergeAccount(id)
API.deleteAccount(id)
```

### Transactions Bridge
```js
API.getTransactions(params)
API.getTransactionTotals(params)
API.createTransaction(data)
API.updateTransaction(id, data)
API.deleteTransaction(id)
```

### Categories Bridge
```js
API.getCategories()
API.createCategory(data)
API.updateCategory(id, data)
API.deleteCategory(id)
API.getDefaultCategory()
API.setDefaultCategory(id)
```

### Merchants Bridge
```js
API.getMerchants(params)
API.searchMerchants(query)
API.createMerchant(data)
API.updateMerchant(id, data)
API.updateMerchantCategory(id, categoryId)
API.deleteMerchant(id)
```

### Tags Bridge
```js
API.getTags()
API.createTag(data)         // data = { name }
API.deleteTag(id)
API.setTransactionTags(txId, tagIds)
```

### Follow-ups / Bills Bridge
```js
API.createFollowUp(transactionId, data)
API.updateFollowUp(id, fields)
API.deleteFollowUp(id)
API.getFollowUp(transactionId)
API.getFollowUps(filters)     // { status?, follow_up_type? }
API.markFollowUpDone(id)
API.reopenFollowUp(id)
API.getUpcomingBills(days?)   // default 7 days — pending follow-ups due within the window
```

### Gmail Bridge
```js
API.getGmailStatus()
API.getGmailConnectUrl(state?)
API.gmailSearch(query)
API.resetGmailSyncHistory()
```

### Chat Bridge
```js
API.sendChatMessage(message, chatId?)
API.getChatHistory(chatId)
API.clearChatHistory(chatId)
API.listChatSessions()
```

### Reports Bridge
```js
API.getSpendingReport(params)
API.exportTransactionsUrl(params)  // Returns blob URL for CSV download
```

### Dev / Testing Bridge
```js
API.loadSampleData()  // Populate a realistic demo dataset (empty DB only)
```

## AI Module (ai.js)

The `AI` singleton handles all LLM provider integration and chat functionality.

```js
// Get current AI settings
const settings = AI.getSettings();

// Test connection to configured provider
const result = await AI.testConnection();
// Returns: { ok: boolean, error?: string }

// Send message to configured LLM
const { response, chat_id } = await AI.chat(message);

// Save chat session
await AI.saveChatSession(userId, chatId);

// Get chat history
const history = await AI.getChatHistory(chatId);

// Clear chat history
await AI.clearChatHistory(chatId);
```

### Supported Providers

| Provider | Key Property | Models |
|----------|-------------|--------|
| Groq | `apiKey` | llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768 |
| OpenAI | `apiKey` | gpt-4o, gpt-4o-mini, gpt-3.5-turbo |
| Google Gemini | No key needed (OAuth) | gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash |
| Azure OpenAI | `azureResourceName`, `azureDeploymentName` | Configurable deployment |
| Ollama (Local) | `ollamaBaseUrl` | llama3.1:8b, llama3.2:3b, mistral |

## Google Drive Module (gdrive.js)

Encrypted backup and sync using AES-GCM with PBKDF2-derived key from user's Gmail address.

```js
// Upload encrypted database backup to Drive
await GDrive.upload();

// Download and decrypt from Drive
const dbBytes = await GDrive.download();

// Bidirectional sync (merge local changes with cloud backup)
const stats = await GDrive.sync();
// Returns: { inserted, skipped, updated, uploadedAt }

// Check if auto-sync is enabled
const isEnabled = GDrive.isEnabled();

// Enable/disable auto-sync
GDrive.setEnabled(true);

// Get last sync timestamp
const lastSync = GDrive.getLastSyncTime();

// Delete backup from Drive
await GDrive.deleteBackup();
```

## Gmail Module (gmail.js)

OAuth-based Gmail integration via Cloudflare Worker proxy for token exchange.

```js
// Get connection status
const isConnected = Gmail.isConnected();

// Get connection URL (opens OAuth popup)
const connectUrl = await Gmail.getConnectUrl(state);

// Get settings
const settings = Gmail.getSettings();  // { email, access_token }

// Extract transactions from emails (LLM-powered categorization)
const results = await Gmail.extractTransactions({
   days: 30,                  // Optional - last N days
   start_date: "2024-01-01",    // Optional
   end_date: "2024-01-31",      // Optional
   auto_import: true,        // Optional - auto-import found transactions
   batch_size: 50            // Optional - process N emails per batch
});

// Reset sync history
await Gmail.resetGmailSyncHistory();
```

## Config Keys (localStorage)

All application configuration is stored in `localStorage` using these standardized keys:

| Constant | localStorage Key | Purpose |
|----------|----------------|---------|
| `SESSION_LAST_ACTIVITY_KEY` | `fincoach-session-last-activity` | Unix timestamp ms of last activity |
| `TRUSTED_DEVICE_KEY` | `fincoach-trusted-device` | `"true"` disables session expiry |
| `GMAIL_SETTINGS_KEY` | `fincoach-gmail-settings` | OAuth token + email |
| `AI_SETTINGS_KEY` | `fincoach-ai-settings` | Provider config + API key |
| `GDRIVE_ENABLED_KEY` | `fincoach-gdrive-enabled` | Drive sync on/off |
| `GDRIVE_LAST_SYNC_KEY` | `fincoach-gdrive-last-sync` | Last sync timestamp |
| `GDRIVE_BACKUP_API_KEY_KEY` | `fincoach-gdrive-backup-api-key` | Include API key in backup |
| `VAULT_PIN_KIND_KEY` | `fincoach-vault-pin-kind` | `"numeric"` when vault uses numeric PIN |
| `VAULT_PIN_VERSION_KEY` | `fincoach-vault-pin-version` | `"2"` written on setup; absent = legacy <6-digit PIN (upgrade required) |
| `ONBOARDED_KEY` | `fincoach-onboarded` | User completed onboarding |

### Deployment config (env.js)

`GMAIL_PROXY_URL` (the Cloudflare Worker OAuth URL) is deployment-specific rather
than per-user. It is sourced from `.env` (`GMAIL_PROXY_URL=…`, see `.env.example`)
and baked into `static/js/env.js` by the `make gen-env` target (also run by
`make dev` / `make deploy`). `env.js` is git-ignored (generated); `static/js/env.example.js`
is the tracked template. `index.html` loads `<script src="/js/env.js">` before
`main.js`, and `sw.js` precaches `/js/env.js`. `env.js` sets
`window.__FINCOACH_CONFIG__.GMAIL_PROXY_URL`, which `config.js` reads at load
(`globalThis.__FINCOACH_CONFIG__?.GMAIL_PROXY_URL ?? "<placeholder>"`), falling
back to the placeholder Worker URL when no global is set.

## Test Structure

### Unit Tests (`tests/js/`) - Vitest

```
tests/js/
├── ai.test.js                  # AI settings, provider config, model selection
├── ai-integration.test.js       # AI.chat(), context building, API bridge
├── app.test.js                  # Render functions, modal logic from app.js
├── bugs-integration.test.js     # Regression tests for known bugs
├── db.test.js                  # All DB CRUD operations, schema, migrations
├── gdrive.test.js              # Encryption/decryption, sync logic
├── gmail.test.js               # Email parsing, extraction logic
├── gmail-proxy.test.js         # Cloudflare Worker OAuth proxy tests
├── main.test.js                # Session expiry logic
├── theme.test.js               # Theme persistence and toggle
├── utils.test.js               # Utility functions (maskPII, formatCurrency, etc.)
└── config.test.js              # GMAIL_PROXY_URL runtime resolution from env.js
```

### E2E Tests (`tests/e2e/js/`) - Playwright

```
tests/e2e/js/
├── accounts.spec.js            # Account management flows
├── bills.spec.js               # Transaction follow-ups: edit-modal flag, Bills & Reminders tab, dashboard widget
├── budgets.spec.js             # Budget tracking and alerts
├── bugs.spec.js                # Regression tests for all known bugs
├── chat.spec.js                # Chat interface, AI responses
├── dashboard.spec.js           # Home screen display
├── gdrive.spec.js              # Drive backup/restore/sync
├── goals.spec.js               # Goal creation and tracking
├── navigation.spec.js          # Route transitions, bottom nav
├── onboarding.spec.js          # Onboarding wizard flow
├── privacy.spec.js             # Privacy mode (blur amounts)
├── pwa-smoke.spec.js           # PWA manifest, service worker
├── reports.spec.js             # Reports screen charts
├── settings.spec.js            # Settings UI, toggles
├── sync.spec.js                # Gmail sync screen and date validation
├── taxonomy.spec.js            # Category/merchant/tag management
├── transactions.spec.js        # Add/edit/delete/filter transactions
├── vault.spec.js               # Credential vault: setup/lock/unlock, PIN strength, 4→6 digit migration, biometric
└── fixtures.js                 # Shared test fixtures and helpers
```

## CDN Global Access Pattern

All CDN-loaded libraries are accessed as `window.*` properties:

```js
// Chart.js for charts
const chart = new window.Chart(ctx, { type: 'pie', data: {...} });

// marked for markdown parsing
const html = window.marked(markdownText);

// DOMPurify for sanitization
const safeHtml = window.DOMPurify.sanitize(userInput);
```

## Development Workflow

1. **Make changes** to production code in `static/js/`
2. **Run lint**: `make lint` (Biome check + format)
3. **Run unit tests**: `make test-unit` (Vitest)
4. **Start dev server**: `make dev` (verify manually in browser)
5. **Run E2E tests** (if UI changed): `make test-e2e` (Playwright)
6. **Verify zero regressions** - all prior tests must pass

## Zero Regression Policy

All previously passing tests MUST continue to pass:

```bash
# Full test suite before ANY commit
make lint
make test-unit
make test-e2e
```
