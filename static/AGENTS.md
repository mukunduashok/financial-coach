# Static / Frontend — Agent Instructions

> **Scope**: This file applies to all files under `static/`. It overrides the root `AGENTS.md`
> for any conflicts specific to frontend production code.
> Root `AGENTS.md` still applies for workflow, agent roles, and safety rules.

## Stack

- **Vanilla JS**, ES Modules (`import`/`export`), no build step, no bundler
- **sql.js** (SQLite WASM) + IndexedDB for local-first data
- **Biome** for formatting/linting (100-char lines, tab indent, double quotes)
- **CDN globals** loaded as plain `<script>` tags — NOT importable as ES modules:
  `Chart` (Chart.js), `marked`, `DOMPurify` — access via `window.*`

## Module Map

| File | Purpose | Modify when |
|------|---------|-------------|
| `js/main.js` | Entry point, session guard, DB.init(), `db-ready` event | Session expiry logic changes |
| `js/db.js` | SQLite WASM + IndexedDB, full schema, all CRUD | New DB tables, columns, queries |
| `js/ai.js` | LLM provider REST calls, prompt templates | AI features, prompt changes |
| `js/api.js` | Thin bridge — delegates to `DB.*`/`AI.*`/`Gmail.*` only | New API surface |
| `js/app.js` | SPA Router, all `render*()` screens, event delegation | New screens or UI changes |
| `js/gmail.js` | Gmail OAuth, email fetch, LLM extraction, SIP-safe dedup | Gmail features |
| `js/gdrive.js` | Google Drive AES-GCM encrypted backup/sync | Drive features |
| `js/config.js` | All `localStorage` key constants | New config/settings keys |
| `js/utils.js` | `maskPII()` and shared helpers | New shared utilities |
| `js/sw.js` | Service worker — offline cache strategy | Cache strategy changes |
| `js/theme-init.js` | Prevents flash of wrong theme (runs before DOM) | Theme flash issues only |
| `js/theme-apply.js` | Applies saved theme on load | Theme logic changes |
| `js/sql-wasm.js` | Vendored sql.js loader | **DO NOT MODIFY** |

## Coding Rules

### 1. Every DB write must persist

```js
// ❌ Missing persist — data lost on page close
this._exec("INSERT INTO categories ...", [...]);
return id;

// ✅ Always call _persist() after writes
this._exec("INSERT INTO categories ...", [...]);
await this._persist();
return id;
```

### 2. api.js is a thin bridge — no logic

```js
// ❌ Business logic in api.js
async createTransaction(data) {
  if (data.amount < 0) throw new Error("...");  // NO
  return DB.createTransaction(data);
}

// ✅ Delegate only
async createTransaction(data) {
  return DB.createTransaction(data);
}
```

### 3. Event handling via data-action, not onclick

```html
<!-- ❌ -->
<button onclick="saveTransaction(this)">Save</button>

<!-- ✅ -->
<button data-action="save-transaction" data-id="123">Save</button>
```

Handle in the delegated click listener in `app.js`.

### 4. Window-exposed functions (onclick in HTML templates only)

Only functions used in `onclick=""` string templates need `Object.assign(window, {...})` at the bottom of `app.js`. Functions called from `data-action` delegation do NOT need this.

### 5. CDN globals

```js
// ❌ These will fail — not ES modules
import Chart from 'chart.js';

// ✅ Access via window
const chart = new window.Chart(ctx, { type: 'pie', data: ... });
```

### 6. No runtime npm deps

Zero packages in production. `devDependencies` only (biome, vitest, playwright).

## Gmail Deduplication Rules (gmail.js)

When importing a transaction in `_importTransaction()`:

1. **Layer 1** — `processed_gmail_messages` table blocks re-import of already-seen Gmail message IDs (checked in `searchEmails` before fetching full emails).
2. **Layer 2** — date + amount + account_id field check — **only runs when `tx.gmail_message_id` is absent** (non-Gmail transactions). This allows 3 SIP emails on the same day for the same amount to all be imported.
3. **`transaction_id`** — for Gmail rows, always `"gmail_<gmail_message_id>"`, never the LLM-extracted bank reference. This prevents UNIQUE constraint violations when multiple emails share the same bank reference (e.g., SIP folio).

## Edit Transaction Modal — Notes Field

- **Gmail transactions** (`gmail_message_id` is set): `#edit-desc` starts **empty**; the LLM-extracted `description` is shown as placeholder text. Saving with an empty Notes field preserves the original `description` in the DB (`data-orig-description` on the modal div).
- **Manual transactions**: `#edit-desc` is pre-filled with `description` as a value, not placeholder.

## Multi-Device Sync Rules (db.js)

`SCHEMA_VERSION = 5`. Google Drive sync uses the JSON envelope (`exportAsJSON` /
`mergeFromJSON`), not the raw binary. `SYNC_TABLES` lists all 13 synced tables (incl.
`sync_tombstones`).

`mergeFromJSON` is **multi-device safe** — it never blindly clears local data:
1. **Natural-key UNION** — match the same real-world record by a device-independent key
   (transaction → `transaction_id`; account → `account_identifier` or name+type; category →
   name; merchant → `merchant_key`/UPI; tag → name; goal → name+target+created; budget →
   category+period; recurring → pattern+account). No duplicates.
2. **Last-writer-wins** — newer `updated_at` (merchants: `last_updated`) wins on conflict.
3. **Delete tombstones** — `delete*` records a `sync_tombstones` row; merge deletes the local
   row when `deleted_at >= row.updated_at` and suppresses re-insert. A re-created (newer) row
   survives. Account/category deletes are guarded while still referenced.

When adding or changing a CRUD method: `create*` must `_clearTombstone(...)`, `update*` must
bump `updated_at`, `delete*` must `_recordTombstone(...)`. `importDatabase` re-applies
SCHEMA_SQL + migrations + seeds so a restored binary matches a fresh DB.

## Sample Data Loader (db.js)

`DB.loadSampleData()` populates a realistic ₹ demo dataset (accounts incl. a credit card +
merged hierarchy, merchants with UPI ids + aliases, ~50 transactions across 3 months incl.
excluded and Gmail-style rows, budgets, goals, tags) using the public CRUD methods. Refuses
to run on a non-empty DB. Bridged by `API.loadSampleData()`; surfaced in Settings →
"Sample Data" card (empty-DB only) via the `load-sample-data` data-action.

## After Every Change

```bash
make lint        # Biome format + lint (MUST — fixes formatting automatically)
make test-unit   # All 959+ Vitest tests must pass
```

If UI screens or routes changed, also:
```bash
make test-e2e    # Playwright E2E tests
make clean-ports # Kill orphaned servers after E2E
```
