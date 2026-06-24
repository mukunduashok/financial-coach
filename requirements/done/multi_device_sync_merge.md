# Multi-Device Drive Sync — Last-Writer-Wins Merge

## Problem

The v4 rearch replaced the additive natural-key Drive merge with a **blind full
snapshot replace** (`DB.mergeFromJSON` deletes every row in all sync tables and
re-inserts the downloaded snapshot verbatim). Because `GDrive.sync()` runs
`download → mergeFromJSON(replace) → upload`, any local change made since the last
upload is destroyed before it can be pushed — data loss even on a single device, and
no real multi-device union.

## Goal

Restore a robust, multi-device-safe merge that mirrors standard cloud-sync practice
(per-record modification timestamp + tombstones, like WhatsApp/Telegram):

- **Union, no duplicates** — rows are matched across devices by a stable identity key.
- **Last-writer-wins** — when both sides hold the same record, the more recently
  modified copy wins (compared via `updated_at`).
- **Delete-aware** — a record deleted on one device stays deleted everywhere via
  tombstones; it is not resurrected by another device's older snapshot.
- The Drive envelope shape (full JSON snapshot of every table) is unchanged.

## Schema changes (migration `user_version = 7`, `SCHEMA_VERSION` → 5)

1. Add `updated_at TEXT` to mutable tables lacking a modification timestamp:
   `accounts`, `transactions`, `goals`, `budgets`, `recurring_patterns`.
   Backfill `updated_at = COALESCE(balance_updated_at | last_seen, created_at, now)`.
   (`categories.updated_at` and `merchants.last_updated` already serve this role.)
2. New table `sync_tombstones(entity_type TEXT, entity_key TEXT, deleted_at TEXT,
   PRIMARY KEY(entity_type, entity_key))`, added to `SYNC_TABLES`.
3. Index `ix_processed_gmail_deleted ON processed_gmail_messages(deleted)`.
4. Every transaction gets a stable `transaction_id` — manual rows generate a UUID
   (`man_<uuid>`) on create instead of `NULL`.

`SCHEMA_VERSION` is bumped so older clients reject the new envelope rather than
mis-merging; the Drive compatibility check already enforces this.

## Identity keys

| Entity | `entity_type` | Natural key |
|--------|---------------|-------------|
| transactions | `transaction` | `transaction_id` |
| accounts | `account` | `account_identifier` ?? `name`+`account_type` |
| merchants | `merchant` | `merchant_key` |
| categories | `category` | `name` |
| tags | `tag` | `name` (NOCASE) |
| goals | `goal` | `name`+`target_amount`+`created_at` |
| budgets | `budget` | `category`+`period_start`+`period_end` |
| recurring_patterns | `recurring` | `description_pattern`+`account` |

## Maintenance rules

- Every `update*` / state-change method sets the entity's modification timestamp to
  `_now()`.
- Every `delete*` method writes a tombstone `(entity_type, entity_key, _now())` **and**
  removes the row. Gmail-message tombstoning in `deleteTransaction` is retained.

## Merge algorithm (`mergeFromJSON`)

Within one transaction, FK off:

1. Validate `schema_version` and that all `SYNC_TABLES` are present (fail fast on a
   malformed/incomplete envelope — no destructive clear).
2. Apply remote tombstones: union them into local `sync_tombstones`; for each, delete
   the matching local row when the local copy's `updated_at <= deleted_at`.
3. Per table, parent-first, walk remote rows:
   - Skip a remote row whose identity is covered by a (local or remote) tombstone
     newer than the row.
   - Resolve FK columns through id-remap maps (category/account/merchant/tag).
   - If no local row matches the key → insert (remap ids).
   - If a local row matches → **last-writer-wins**: if the remote `updated_at` is
     newer, overwrite the mutable columns; otherwise keep local. Record the id map.
4. Commit, persist. Return `{ inserted, updated, deleted, skipped }` per table.

## Out-of-scope / accepted limitations

- `conversations` (chat log) is append-only: union by `(chat_id, timestamp, role,
  content)`; whole-chat deletes tombstone by `chat_id`.
- Editing a goal/budget's natural-key fields on two devices can create two records
  (no surrogate sync id) — acceptable edge case.

## Also bundled in this change

- `importDatabase` (binary backup restore) now runs migrations + reseeds.
- `_learnMerchantMapping` retro-match uses consistent normalization.
- `DB.loadSampleData()` — seed a realistic ₹ dataset (accounts incl. credit-card +
  merged hierarchy, merchants w/ aliases, ~50 transactions, budgets, goals, tags) for
  manual testing and E2E fixtures. Exposed via `API.loadSampleData()` and a Settings
  button.
