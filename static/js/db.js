/**
 * db.js — SQLite WASM database layer for Financial Coach PWA.
 *
 * Local-first data storage using sql.js (SQLite compiled to WASM)
 * with IndexedDB persistence. Mirrors the Python backend schema exactly.
 */
import {
  AI_SETTINGS_KEY,
  DAILY_SUMMARY_KEY,
  GDRIVE_BACKUP_API_KEY_KEY,
  GDRIVE_ENABLED_KEY,
  GDRIVE_LAST_SYNC_KEY,
  GDRIVE_REMINDER_KEY,
  GDRIVE_SYNC_LOCK_KEY,
  GMAIL_AUTO_SYNC_ENABLED_KEY,
  GMAIL_AUTO_SYNC_LAST_KEY,
  GMAIL_CUSTOM_SENDERS_KEY,
  GMAIL_SETTINGS_KEY,
  ONBOARDED_KEY,
  ONBOARDING_STEP_KEY,
  SESSION_LAST_ACTIVITY_KEY,
  VAULT_AI_KEY,
  VAULT_BIOMETRIC_CRED_KEY,
  VAULT_BIOMETRIC_LEGACY_WRAP_KEY,
  VAULT_BIOMETRIC_PRF_SALT_KEY,
  VAULT_BIOMETRIC_WRAPPED_KEY,
  VAULT_GMAIL_KEY,
  VAULT_PIN_KIND_KEY,
  VAULT_SALT_KEY,
  VAULT_SENTINEL_KEY,
} from "./config.js";

// ---------------------------------------------------------------------------
// Constants (from app/constants.py)
// ---------------------------------------------------------------------------
const MAX_MERGE_DEPTH = 5;
const BUDGET_WARNING_THRESHOLD = 0.8;
const DEFAULT_REPORT_MONTHS = 6;
const DEFAULT_MERCHANT_PAGE_LIMIT = 50;
const DEFAULT_CONFIDENCE_SCORE = 1.0;

const BUDGET_STATUS_ON_TRACK = "on_track";
const BUDGET_STATUS_WARNING = "warning";
const BUDGET_STATUS_EXCEEDED = "exceeded";

const SEED_TAGS = ["domestic", "international", "offline", "online"];

// Both account_type and transaction_type are stored free-form. Account creation,
// onboarding and Gmail import produce loosely-typed values (e.g. "checking",
// "debit", "balance"), so neither column carries a CHECK constraint.

const SEED_CATEGORIES = {
  "Food & Dining":
    "Restaurants, food delivery, cafes, bistros, diners (e.g., Swiggy, Zomato, any restaurant)",
  Groceries: "Supermarkets, grocery delivery (e.g., Blinkit, BigBasket, DMart)",
  Transportation:
    "Daily commute, fuel, parking, ride-sharing for local travel (e.g., Uber, Ola, petrol)",
  Shopping: "E-commerce, retail, sports stores, apparel, general stores (e.g., Amazon, Flipkart)",
  Entertainment: "Streaming services, movies, games (e.g., Netflix, Spotify, cinema)",
  "Bills & Utilities":
    "Electricity, water, internet, mobile recharge (e.g., Airtel, bill payments)",
  "Health & Fitness": "Gym, pharmacy, hospital, medical expenses, doctor visits",
  Travel:
    "Flight tickets, train bookings, hotel reservations, vacation expenses (e.g., IRCTC, MakeMyTrip)",
  Education: "Courses, books, school fees, college tuition, online learning",
  "Personal Care": "Salon, spa, beauty products, grooming",
  Business: "Office supplies, business expenses",
  Income: "Salary, interest, dividends, freelance income",
  Transfer:
    "Money transfers between own accounts (use ONLY when no merchant and explicitly a transfer)",
  Withdrawal: "ATM withdrawals, cash withdrawals",
  Deposit: "Fixed deposits, recurring deposits, term deposits",
  Investment: "Mutual funds, stocks, SIPs, bonds",
  Subscription: "Recurring subscriptions, memberships",
  Gift: "Gifts given or received",
  Charity: "Donations, charitable contributions",
  Other: "Transactions that don't fit any other category",
};

export const SCHEMA_VERSION = 5;

const IDB_NAME = "fincoach";
const IDB_STORE = "db";
const IDB_KEY = "sqlite";

// ---------------------------------------------------------------------------
// Schema DDL — mirrors app/database.py exactly
// ---------------------------------------------------------------------------
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  balance REAL DEFAULT 0.0,
  account_type TEXT,
  account_identifier TEXT UNIQUE,
  balance_updated_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  merged_into_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  merged_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  billing_cycle_start_day INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_accounts_is_active ON accounts(is_active);
CREATE INDEX IF NOT EXISTS ix_accounts_merged_into_id ON accounts(merged_into_id);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS merchants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_key TEXT NOT NULL UNIQUE,
  display_name TEXT,
  merchant_upi_id TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  confidence_score REAL DEFAULT 1.0,
  created_at TEXT DEFAULT (datetime('now')),
  last_updated TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_merchants_upi ON merchants(merchant_upi_id) WHERE merchant_upi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_merchants_category ON merchants(category_id);

CREATE TABLE IF NOT EXISTS merchant_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  alias_norm TEXT NOT NULL,
  UNIQUE(alias_norm)
);
CREATE INDEX IF NOT EXISTS ix_merchant_aliases_merchant ON merchant_aliases(merchant_id);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT UNIQUE,
  gmail_message_id TEXT,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  notes TEXT,
  payment_reference TEXT,
  merchant_upi_id TEXT,
  merchant_name TEXT,
  merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  transaction_type TEXT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  is_recurring INTEGER NOT NULL DEFAULT 0,
  excluded_from_expenses INTEGER NOT NULL DEFAULT 0,
  excluded_from_income INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_transactions_transaction_id ON transactions(transaction_id);
CREATE INDEX IF NOT EXISTS ix_transactions_gmail_message_id ON transactions(gmail_message_id);
CREATE INDEX IF NOT EXISTS ix_transactions_merchant_upi_id ON transactions(merchant_upi_id);
CREATE INDEX IF NOT EXISTS ix_transactions_merchant_name ON transactions(merchant_name);
CREATE INDEX IF NOT EXISTS ix_tx_account_date ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS ix_tx_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS ix_tx_merchant ON transactions(merchant_id);

CREATE TABLE IF NOT EXISTS recurring_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description_pattern TEXT NOT NULL,
  amount REAL NOT NULL,
  frequency_days INTEGER NOT NULL,
  last_seen TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  next_due_date TEXT,
  reminder_days_before INTEGER DEFAULT 3,
  is_reminder_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL CHECK(target_amount > 0),
  current_amount REAL DEFAULT 0.0,
  deadline TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  limit_amount REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_budgets_category_period ON budgets(category_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_conversations_chat_id ON conversations(chat_id);

CREATE TABLE IF NOT EXISTS processed_gmail_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_message_id TEXT NOT NULL UNIQUE,
  processed_at TEXT DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_processed_gmail_msg_id ON processed_gmail_messages(gmail_message_id);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_tags_name ON tags(name);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);
CREATE INDEX IF NOT EXISTS ix_transaction_tags_tag_id ON transaction_tags(tag_id);

CREATE TABLE IF NOT EXISTS transaction_follow_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  title TEXT,
  follow_up_type TEXT NOT NULL DEFAULT 'reminder',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence TEXT,
  completed_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(transaction_id)
);
CREATE INDEX IF NOT EXISTS ix_follow_ups_status_due ON transaction_follow_ups(status, due_date);

CREATE TABLE IF NOT EXISTS sync_tombstones (
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_key)
);
`;

// Complete list of persisted tables, parent-first so a full-DB-replace import can
// re-insert rows in foreign-key-safe order. Drive export/import iterate this list.
const SYNC_TABLES = [
  "categories",
  "accounts",
  "merchants",
  "merchant_aliases",
  "transactions",
  "recurring_patterns",
  "goals",
  "budgets",
  "conversations",
  "processed_gmail_messages",
  "tags",
  "transaction_tags",
  "transaction_follow_ups",
  "sync_tombstones",
];

// ---------------------------------------------------------------------------
// Ordered migrations — gated on PRAGMA user_version.
//
// Each step is idempotent (column ALTERs are guarded by PRAGMA table_info,
// index/table creates use IF NOT EXISTS) so a step is safe to re-run on a DB
// that already reflects it. The runner applies every step whose `version` is
// greater than the stored `user_version`, in ascending order, then stamps the
// new `user_version`. A fresh DB built from SCHEMA_SQL already contains the
// full final schema, so every migration runs as a no-op and the result is
// byte-identical to a DB brought up to date by the runner (DDL/live parity).
//
// NOTE: this PRAGMA user_version stream is independent of SCHEMA_VERSION, which
// is used only by the Drive sync compatibility check.
// ---------------------------------------------------------------------------
function _hasColumn(db, table, col) {
  return db._queryAll(`PRAGMA table_info(${table})`).some((c) => c.name === col);
}

const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      if (!_hasColumn(db, "recurring_patterns", "next_due_date")) {
        db._exec("ALTER TABLE recurring_patterns ADD COLUMN next_due_date TEXT");
      }
      if (!_hasColumn(db, "recurring_patterns", "reminder_days_before")) {
        db._exec(
          "ALTER TABLE recurring_patterns ADD COLUMN reminder_days_before INTEGER DEFAULT 3",
        );
      }
      if (!_hasColumn(db, "recurring_patterns", "is_reminder_enabled")) {
        db._exec(
          "ALTER TABLE recurring_patterns ADD COLUMN is_reminder_enabled INTEGER NOT NULL DEFAULT 1",
        );
      }
    },
  },
  {
    version: 2,
    up(db) {
      if (!_hasColumn(db, "transactions", "excluded_from_expenses")) {
        db._exec(
          "ALTER TABLE transactions ADD COLUMN excluded_from_expenses INTEGER NOT NULL DEFAULT 0",
        );
      }
      if (!_hasColumn(db, "transactions", "excluded_from_income")) {
        db._exec(
          "ALTER TABLE transactions ADD COLUMN excluded_from_income INTEGER NOT NULL DEFAULT 0",
        );
      }
      if (!_hasColumn(db, "transactions", "notes")) {
        db._exec("ALTER TABLE transactions ADD COLUMN notes TEXT");
      }
      if (!_hasColumn(db, "transactions", "payment_reference")) {
        db._exec("ALTER TABLE transactions ADD COLUMN payment_reference TEXT");
      }
      if (!_hasColumn(db, "accounts", "billing_cycle_start_day")) {
        db._exec("ALTER TABLE accounts ADD COLUMN billing_cycle_start_day INTEGER DEFAULT 1");
      }
    },
  },
  {
    version: 3,
    up(db) {
      if (!_hasColumn(db, "merchants", "match_name")) {
        db._exec("ALTER TABLE merchants ADD COLUMN match_name TEXT");
        db._exec("CREATE INDEX IF NOT EXISTS ix_merchant_match_name ON merchants(match_name)");
        // Backfill match_name from the existing display name for legacy rows.
        const legacy = db._queryAll(
          "SELECT id, merchant_name FROM merchants WHERE match_name IS NULL AND merchant_name IS NOT NULL",
        );
        for (const row of legacy) {
          db._exec("UPDATE merchants SET match_name = ? WHERE id = ?", [
            _normalizeMerchantName(row.merchant_name),
            row.id,
          ]);
        }
      }
      if (!_hasColumn(db, "processed_gmail_messages", "deleted")) {
        db._exec(
          "ALTER TABLE processed_gmail_messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
        );
      }
      // Tag tables are covered by SCHEMA_SQL but recreated here defensively so a
      // legacy DB created before tags existed gains them during migration.
      db._exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db._exec(`
        CREATE TABLE IF NOT EXISTS transaction_tags (
          transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (transaction_id, tag_id)
        )
      `);
    },
  },
  {
    version: 4,
    up(db) {
      db._exec("CREATE INDEX IF NOT EXISTS ix_tx_account_date ON transactions(account_id, date)");
      db._exec("CREATE INDEX IF NOT EXISTS ix_tx_category ON transactions(category_id)");
      db._exec("CREATE INDEX IF NOT EXISTS ix_tx_merchant ON transactions(merchant_id)");
    },
  },
  {
    // Merchant identity rebuild: separate immutable identity (merchant_key) from the
    // mutable display name, make category_id nullable, and introduce merchant_aliases.
    // Runs inside the migration transaction with foreign_keys OFF (set by the runner);
    // ids are preserved so transactions.merchant_id FKs stay valid.
    version: 5,
    up(db) {
      // A fresh DB built from the current SCHEMA_SQL already has the new shape.
      if (!_hasColumn(db, "merchants", "match_name")) {
        db._exec(`
          CREATE TABLE IF NOT EXISTS merchant_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
            alias_norm TEXT NOT NULL,
            UNIQUE(alias_norm)
          )
        `);
        return;
      }

      // Legacy table present — rebuild FK-safely, preserving ids.
      db._exec("ALTER TABLE merchants RENAME TO merchants_legacy");
      db._exec(`
        CREATE TABLE merchants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          merchant_key TEXT NOT NULL UNIQUE,
          display_name TEXT,
          merchant_upi_id TEXT,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          confidence_score REAL DEFAULT 1.0,
          created_at TEXT DEFAULT (datetime('now')),
          last_updated TEXT DEFAULT (datetime('now'))
        )
      `);
      db._exec(`
        CREATE TABLE IF NOT EXISTS merchant_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
          alias_norm TEXT NOT NULL,
          UNIQUE(alias_norm)
        )
      `);

      const legacyRows = db._queryAll("SELECT * FROM merchants_legacy ORDER BY id");
      const usedKeys = new Set();
      for (const row of legacyRows) {
        let key = row.merchant_upi_id || _slug(row.merchant_name);
        if (!key) key = `merchant-${row.id}`;
        if (usedKeys.has(key)) key = `${key}-${row.id}`;
        usedKeys.add(key);
        db._exec(
          "INSERT INTO merchants (id, merchant_key, display_name, merchant_upi_id, category_id, confidence_score, created_at, last_updated) VALUES (?,?,?,?,?,?,?,?)",
          [
            row.id,
            key,
            row.merchant_name ?? null,
            row.merchant_upi_id ?? null,
            row.category_id ?? null,
            row.confidence_score ?? DEFAULT_CONFIDENCE_SCORE,
            row.created_at ?? _now(),
            row.last_updated ?? _now(),
          ],
        );
        // Backfill aliases from the legacy match_name and normalized display name,
        // skipping any that equal the key or collide on the UNIQUE(alias_norm).
        const aliasCandidates = new Set();
        if (row.match_name) aliasCandidates.add(row.match_name);
        const normName = _normalizeMerchantName(row.merchant_name);
        if (normName) aliasCandidates.add(normName);
        for (const alias of aliasCandidates) {
          if (!alias || alias === key) continue;
          const clash = db._queryOne("SELECT 1 FROM merchant_aliases WHERE alias_norm = ?", [
            alias,
          ]);
          if (clash) continue;
          db._exec("INSERT INTO merchant_aliases (merchant_id, alias_norm) VALUES (?,?)", [
            row.id,
            alias,
          ]);
        }
      }
      db._exec("DROP TABLE merchants_legacy");
      db._exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_merchants_upi ON merchants(merchant_upi_id) WHERE merchant_upi_id IS NOT NULL",
      );
      db._exec("CREATE INDEX IF NOT EXISTS ix_merchants_category ON merchants(category_id)");
      db._exec(
        "CREATE INDEX IF NOT EXISTS ix_merchant_aliases_merchant ON merchant_aliases(merchant_id)",
      );

      // Backfill transactions.merchant_id for rows carrying merchant provenance but no link.
      const orphans = db._queryAll(
        "SELECT id, merchant_upi_id, merchant_name FROM transactions WHERE merchant_id IS NULL AND (merchant_upi_id IS NOT NULL OR merchant_name IS NOT NULL)",
      );
      for (const tx of orphans) {
        const m = db._lookupMerchant(tx.merchant_upi_id, tx.merchant_name);
        if (m) db._exec("UPDATE transactions SET merchant_id = ? WHERE id = ?", [m.id, tx.id]);
      }
    },
  },
  {
    // Drop conversations.user_id (single-user app). Table rebuild, FK-safe.
    version: 6,
    up(db) {
      if (!_hasColumn(db, "conversations", "user_id")) return;
      db._exec("ALTER TABLE conversations RENAME TO conversations_legacy");
      db._exec(`
        CREATE TABLE conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TEXT DEFAULT (datetime('now'))
        )
      `);
      db._exec(
        "INSERT INTO conversations (id, chat_id, role, content, timestamp) SELECT id, chat_id, role, content, timestamp FROM conversations_legacy",
      );
      db._exec("DROP TABLE conversations_legacy");
      db._exec("DROP INDEX IF EXISTS ix_conversations_user_chat");
      db._exec("CREATE INDEX IF NOT EXISTS ix_conversations_chat_id ON conversations(chat_id)");
    },
  },
  {
    // Multi-device sync: per-record modification timestamps + delete tombstones.
    // Adds updated_at to mutable tables lacking one, a sync_tombstones table, an index
    // on processed_gmail_messages.deleted, and backfills a stable transaction_id for
    // any manual rows still carrying NULL. All steps are idempotent.
    version: 7,
    up(db) {
      const addUpdatedAt = (table, fallbackCol) => {
        if (_hasColumn(db, table, "updated_at")) return;
        db._exec(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT`);
        const fallback = fallbackCol ? `COALESCE(${fallbackCol}, created_at)` : "created_at";
        db._exec(`UPDATE ${table} SET updated_at = COALESCE(${fallback}, datetime('now'))`);
      };
      addUpdatedAt("accounts", "balance_updated_at");
      addUpdatedAt("transactions", null);
      addUpdatedAt("goals", null);
      addUpdatedAt("budgets", null);
      addUpdatedAt("recurring_patterns", "last_seen");

      db._exec(
        "CREATE INDEX IF NOT EXISTS ix_processed_gmail_deleted ON processed_gmail_messages(deleted)",
      );
      db._exec(`
        CREATE TABLE IF NOT EXISTS sync_tombstones (
          entity_type TEXT NOT NULL,
          entity_key TEXT NOT NULL,
          deleted_at TEXT NOT NULL,
          PRIMARY KEY (entity_type, entity_key)
        )
      `);

      // Backfill a stable transaction_id for manual rows created before this migration.
      const orphans = db._queryAll("SELECT id FROM transactions WHERE transaction_id IS NULL");
      for (const row of orphans) {
        db._exec("UPDATE transactions SET transaction_id = ? WHERE id = ?", [
          `man_${crypto.randomUUID()}`,
          row.id,
        ]);
      }
    },
  },
  {
    // Transaction follow-ups / reminders: any transaction can be flagged for follow-up.
    // Adds the transaction_follow_ups table (1:1 with a transaction) and its status/due
    // index. Idempotent — CREATE IF NOT EXISTS is a no-op on a fresh DB already built
    // from SCHEMA_SQL.
    version: 8,
    up(db) {
      db._exec(`
        CREATE TABLE IF NOT EXISTS transaction_follow_ups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
          title TEXT,
          follow_up_type TEXT NOT NULL DEFAULT 'reminder',
          due_date TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          is_recurring INTEGER NOT NULL DEFAULT 0,
          recurrence TEXT,
          completed_at TEXT,
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(transaction_id)
        )
      `);
      db._exec(
        "CREATE INDEX IF NOT EXISTS ix_follow_ups_status_due ON transaction_follow_ups(status, due_date)",
      );
    },
  },
];

export const LATEST_USER_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _now() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function _todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function _bool(v) {
  return v === 1 || v === true;
}

function _normalizeMerchantName(name) {
  if (!name) return null;
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Build a stable, URL-ish slug used as the immutable merchant_key when no UPI ID
 * exists: lowercased, trimmed, whitespace collapsed, spaces → "-", and every
 * character that is not alphanumeric or "-" stripped. Returns null for empty input.
 */
function _escapeLike(s) {
  return s.replace(/[%_\\]/g, "\\$&");
}

function _slug(name) {
  if (!name) return null;
  const s = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/ /g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return s || null;
}

function _addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Roll a date forward by a follow-up recurrence interval. Unknown/absent values fall
// back to monthly. Returns a YYYY-MM-DD string.
function _advanceByRecurrence(dateStr, recurrence) {
  const d = new Date(dateStr);
  switch (recurrence) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function _daysBetween(fromDate, toDate) {
  return Math.round((new Date(toDate) - new Date(fromDate)) / 86_400_000);
}

// Shared SELECT for follow-ups joined to their parent transaction and category so a row
// carries the transaction's amount/merchant/type context alongside the follow-up fields.
const FOLLOWUP_SELECT = `
  SELECT f.*, t.amount AS amount, t.description AS description,
    t.merchant_name AS merchant_name, t.merchant_upi_id AS merchant_upi_id,
    t.transaction_type AS transaction_type, t.account_id AS account_id,
    t.date AS transaction_date, c.name AS category_name
  FROM transaction_follow_ups f
  LEFT JOIN transactions t ON t.id = f.transaction_id
  LEFT JOIN categories c ON c.id = t.category_id`;

function _getOrCreateDeviceId() {
  const KEY = "fincoach-device-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

// Builds the device-independent natural key for an entity that participates in delete-
// tombstone propagation. Each key is derived purely from the row's own columns (no local
// foreign-key ids) so the same real-world record yields an identical key on every device —
// that is what lets tombstones and last-writer-wins dedup line up.
function _syncEntityKey(entityType, row) {
  switch (entityType) {
    case "transaction":
      return row.transaction_id || null;
    case "account":
      return row.account_identifier || `nm:${row.name}|ty:${row.account_type ?? ""}`;
    case "category":
      return `nm:${String(row.name ?? "")
        .trim()
        .toLowerCase()}`;
    case "merchant":
      return row.merchant_key || null;
    case "tag":
      return `nm:${String(row.name ?? "")
        .trim()
        .toLowerCase()}`;
    case "goal":
      return `nm:${row.name}|tg:${row.target_amount}|cr:${row.created_at}`;
    default:
      return null;
  }
}

// Parse a timestamp stored either as ISO ("...T...Z"/"...T...") or as the space-separated
// form produced by _now()/datetime('now'). Returns ms since epoch (0 when unparseable).
function _ts(value) {
  if (!value) return 0;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------
export const DB = {
  _db: null,

  // ========================================================================
  // Initialization
  // ========================================================================
  async init() {
    const SQL = await window.initSqlJs({
      locateFile: (file) => `/js/${file}`,
    });

    const saved = await this._loadFromStorage();
    const isFresh = !saved;
    if (saved) {
      this._db = new SQL.Database(new Uint8Array(saved));
    } else {
      this._db = new SQL.Database();
    }
    this._exec("PRAGMA foreign_keys = ON");
    this._exec(SCHEMA_SQL);
    if (isFresh) {
      // A brand-new DB is built directly from SCHEMA_SQL, which already reflects the
      // final schema. Stamp it at the latest migration version and skip the runner —
      // the legacy-detection path inspects columns (e.g. merchants.match_name) that no
      // longer exist on a fresh DB and would otherwise mis-detect an old baseline.
      this._exec(`PRAGMA user_version = ${LATEST_USER_VERSION}`);
    } else {
      this._runMigrations();
    }
    // Index on the migration-added `deleted` column. Created here (not in SCHEMA_SQL)
    // because SCHEMA_SQL runs before migrations: on a legacy DB whose
    // processed_gmail_messages table predates the column, an index in SCHEMA_SQL would
    // reference a column that only exists after _runMigrations(). By this point the
    // column is guaranteed — added by SCHEMA_SQL on a fresh DB or by migrations on an
    // existing one — so this idempotent statement is safe on every path.
    this._exec(
      "CREATE INDEX IF NOT EXISTS ix_processed_gmail_deleted ON processed_gmail_messages(deleted)",
    );
    this._seedCategories();
    this._seedTags();
    await this._persist();
  },

  _userVersion() {
    const row = this._queryOne("PRAGMA user_version");
    return row ? row.user_version : 0;
  },

  /**
   * Detect a baseline `user_version` for a DB that has never been stamped
   * (`user_version === 0`). Both a brand-new DB built from the full SCHEMA_SQL
   * and a legacy DB already migrated by the old ad-hoc ALTER list start at 0, so
   * we inspect schema markers to avoid needlessly re-running the early column
   * ALTERs. Detection only covers column-adding steps (1–3); the index step (4)
   * is idempotent and always runs when stamping from a baseline.
   */
  _detectBaselineVersion() {
    let v = 0;
    if (_hasColumn(this, "recurring_patterns", "next_due_date")) v = 1;
    else return v;
    if (_hasColumn(this, "transactions", "excluded_from_expenses")) v = 2;
    else return v;
    if (_hasColumn(this, "merchants", "match_name")) v = 3;
    else return v;
    return v;
  },

  /**
   * Ordered migration runner gated on PRAGMA user_version. Applies every pending
   * migration (version greater than the stored/baseline user_version) in ascending
   * order, each inside its own transaction, then stamps the new user_version.
   */
  _runMigrations() {
    let current = this._userVersion();
    if (current === 0) {
      current = this._detectBaselineVersion();
    }
    const pending = MIGRATIONS.filter((m) => m.version > current);
    if (pending.length === 0) return;
    // Table-rebuild migrations (e.g. the merchant/conversation rebuilds) RENAME a table to
    // a *_legacy name, recreate it, then DROP the legacy copy. Two pragmas make this safe:
    //  - foreign_keys = OFF: lets the rebuild insert/drop without tripping FK enforcement
    //    (it is a no-op inside a transaction, so it must be toggled out here).
    //  - legacy_alter_table = ON: stops RENAME from rewriting FK references in dependent
    //    tables to the *_legacy name — otherwise those references would dangle after the
    //    DROP and raise "no such table: <name>_legacy" on the next write.
    this._exec("PRAGMA foreign_keys = OFF");
    this._exec("PRAGMA legacy_alter_table = ON");
    try {
      for (const migration of pending) {
        this._exec("BEGIN");
        try {
          migration.up(this);
          this._exec(`PRAGMA user_version = ${migration.version}`);
          this._exec("COMMIT");
        } catch (err) {
          this._exec("ROLLBACK");
          throw err;
        }
      }
    } finally {
      this._exec("PRAGMA legacy_alter_table = OFF");
      this._exec("PRAGMA foreign_keys = ON");
    }
  },

  _seedCategories() {
    const count = this._queryOne("SELECT COUNT(*) as c FROM categories");
    if (count && count.c > 0) return;
    const now = _now();
    for (const [name, description] of Object.entries(SEED_CATEGORIES)) {
      this._exec(
        "INSERT INTO categories (name, description, created_at, updated_at) VALUES (?,?,?,?)",
        [name, description, now, now],
      );
    }
  },

  _seedTags() {
    const count = this._queryOne("SELECT COUNT(*) as n FROM tags").n;
    if (count > 0) return;
    const now = _now();
    for (const name of SEED_TAGS) {
      this._exec("INSERT OR IGNORE INTO tags (name, created_at) VALUES (?,?)", [name, now]);
    }
  },

  // ========================================================================
  // Low-level helpers
  // ========================================================================
  _exec(sql, params = []) {
    if (params.length === 0) {
      this._db.exec(sql);
    } else {
      this._db.run(sql, params);
    }
  },

  _queryAll(sql, params = []) {
    const stmt = this._db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },

  _queryOne(sql, params = []) {
    const rows = this._queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
  },

  _lastInsertId() {
    return this._queryOne("SELECT last_insert_rowid() as id").id;
  },

  // ========================================================================
  // IndexedDB persistence
  // ========================================================================
  async _persist() {
    const data = this._db.export();
    const buffer = data.buffer;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains(IDB_STORE)) {
          idb.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(buffer, IDB_KEY);
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => {
          idb.close();
          reject(tx.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
  },

  async _loadFromStorage() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains(IDB_STORE)) {
          idb.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction(IDB_STORE, "readonly");
        const getReq = tx.objectStore(IDB_STORE).get(IDB_KEY);
        getReq.onsuccess = () => {
          idb.close();
          resolve(getReq.result || null);
        };
        getReq.onerror = () => {
          idb.close();
          reject(getReq.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
  },

  async _clearFromStorage() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
  },

  async wipeSession() {
    await this._clearFromStorage();
    const sensitiveKeys = [
      GMAIL_SETTINGS_KEY,
      AI_SETTINGS_KEY,
      VAULT_SALT_KEY,
      VAULT_SENTINEL_KEY,
      VAULT_AI_KEY,
      VAULT_GMAIL_KEY,
      VAULT_PIN_KIND_KEY,
      VAULT_BIOMETRIC_CRED_KEY,
      VAULT_BIOMETRIC_PRF_SALT_KEY,
      VAULT_BIOMETRIC_WRAPPED_KEY,
      VAULT_BIOMETRIC_LEGACY_WRAP_KEY,
      GDRIVE_ENABLED_KEY,
      GDRIVE_LAST_SYNC_KEY,
      GDRIVE_BACKUP_API_KEY_KEY,
      GDRIVE_SYNC_LOCK_KEY,
      SESSION_LAST_ACTIVITY_KEY,
      GMAIL_CUSTOM_SENDERS_KEY,
      GMAIL_AUTO_SYNC_ENABLED_KEY,
      GMAIL_AUTO_SYNC_LAST_KEY,
      ONBOARDED_KEY,
      ONBOARDING_STEP_KEY,
      GDRIVE_REMINDER_KEY,
      DAILY_SUMMARY_KEY,
    ];
    for (const key of sensitiveKeys) {
      localStorage.removeItem(key);
    }
  },

  // ========================================================================
  // Accounts
  // ========================================================================
  _getCreditCycleWindow(startDay) {
    const today = new Date();
    const day = startDay || 1;
    let start;
    if (today.getDate() >= day) {
      start = new Date(today.getFullYear(), today.getMonth(), day);
    } else {
      start = new Date(today.getFullYear(), today.getMonth() - 1, day);
    }
    const nextStart = new Date(start.getFullYear(), start.getMonth() + 1, day);
    const cycleEnd = new Date(nextStart - 86400000);
    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { cycleStart: fmt(start), cycleEnd: fmt(cycleEnd) };
  },

  _getRootAccountId(accountId) {
    let id = accountId;
    const visited = new Set([id]);
    while (true) {
      const row = this._queryOne("SELECT merged_into_id FROM accounts WHERE id = ?", [id]);
      if (!row?.merged_into_id) break;
      if (visited.has(row.merged_into_id)) break;
      visited.add(row.merged_into_id);
      id = row.merged_into_id;
    }
    return id;
  },

  /**
   * Collect an account's full subtree (the node itself + every merged-in descendant)
   * with a visited-set guard so a cyclic `merged_into_id` chain can never recurse
   * forever. This is the SINGLE descendant-walk in the codebase.
   */
  _collectDescendants(accountId, visited = new Set()) {
    if (visited.has(accountId)) return [];
    visited.add(accountId);
    const result = [accountId];
    const children = this._queryAll("SELECT id FROM accounts WHERE merged_into_id = ?", [
      accountId,
    ]);
    for (const child of children) {
      result.push(...this._collectDescendants(child.id, visited));
    }
    return result;
  },

  /**
   * Canonical, cycle-guarded account-family resolver. Resolves to the root of the
   * merge tree, then returns the root plus every descendant. This is the SINGLE
   * tree-expansion code path used by every aggregation (transactions, totals,
   * spending report, credit-cycle) so those views can never diverge. Passing any
   * node in a family — root or descendant — resolves to the same complete set.
   */
  _accountFamilyIds(accountId) {
    const rootId = this._getRootAccountId(accountId);
    return this._collectDescendants(rootId);
  },

  /** Thin backward-compatible alias — delegates to the canonical family resolver. */
  _getAccountFamily(accountId) {
    return this._accountFamilyIds(accountId);
  },

  /**
   * Sum the net credit-cycle spend for an account's full family (root → descendants)
   * within [cycleStart, cycleEnd]. Mirrors the income/expense exclusion rules used by
   * getTransactions/getTransactionTotals so the credit balance can never drift from them.
   */
  _creditCycleSum(accountId, cycleStart, cycleEnd) {
    const familyIds = this._accountFamilyIds(accountId);
    const placeholders = familyIds.map(() => "?").join(", ");
    // cycleEnd is an inclusive date-only bound. Mirror getTransactions/getTransactionTotals
    // exactly: add 1 day and use `date < ?` so canonical YYYY-MM-DDTHH:MM:SS rows on the
    // last day of the cycle are not lexically excluded by a date-only comparison.
    const end = new Date(cycleEnd);
    end.setDate(end.getDate() + 1);
    const cycleEndExclusive = end.toISOString().split("T")[0];
    const row = this._queryOne(
      `SELECT COALESCE(
         SUM(CASE WHEN transaction_type = 'expense' AND excluded_from_expenses = 0 THEN ABS(amount) ELSE 0 END) -
         SUM(CASE WHEN transaction_type = 'income' AND excluded_from_income = 0 THEN amount ELSE 0 END),
       0.0) as cycle_balance
       FROM transactions
       WHERE account_id IN (${placeholders}) AND date >= ? AND date < ?`,
      [...familyIds, cycleStart, cycleEndExclusive],
    );
    return row ? Math.round(row.cycle_balance * 100) / 100 : 0;
  },

  _latestTreeBalance(accountId) {
    const rows = [];
    for (const id of this._collectDescendants(accountId)) {
      const acc = this._queryOne("SELECT balance, balance_updated_at FROM accounts WHERE id = ?", [
        id,
      ]);
      if (acc) rows.push(acc);
    }
    if (rows.length === 0) return 0;
    rows.sort((a, b) => {
      const ta = a.balance_updated_at ? new Date(a.balance_updated_at).getTime() : 0;
      const tb = b.balance_updated_at ? new Date(b.balance_updated_at).getTime() : 0;
      return tb - ta;
    });
    return rows[0].balance;
  },

  _populateAccountResponse(acc) {
    let merged_into_name = null;
    if (acc.merged_into_id) {
      const parent = this._queryOne("SELECT name FROM accounts WHERE id = ?", [acc.merged_into_id]);
      if (parent) merged_into_name = parent.name;
    }

    const children = this._queryAll(
      "SELECT id, name, balance, account_type, is_active, merged_at, balance_updated_at FROM accounts WHERE merged_into_id = ?",
      [acc.id],
    );
    const merged_accounts = children.map((c) => ({
      id: c.id,
      name: c.name,
      balance: c.balance,
      account_type: c.account_type,
      is_active: _bool(c.is_active),
      merged_at: c.merged_at || null,
      balance_updated_at: c.balance_updated_at || null,
    }));

    // effective balance: if merged, resolve to root tree latest; else own tree latest
    let effective_balance;
    if (acc.merged_into_id) {
      const rootId = this._getRootAccountId(acc.id);
      effective_balance = this._latestTreeBalance(rootId);
    } else {
      effective_balance = this._latestTreeBalance(acc.id);
    }

    let credit_cycle_balance = null;
    if (acc.account_type === "credit") {
      const { cycleStart, cycleEnd } = this._getCreditCycleWindow(acc.billing_cycle_start_day || 1);
      // Include transactions from the full account family (root → merged children) and
      // honour income/expense exclusions, matching getTransactionTotals exactly.
      credit_cycle_balance = this._creditCycleSum(acc.id, cycleStart, cycleEnd);
    }

    return {
      id: acc.id,
      name: acc.name,
      balance: acc.balance,
      account_type: acc.account_type,
      account_identifier: acc.account_identifier || null,
      balance_updated_at: acc.balance_updated_at || null,
      is_active: _bool(acc.is_active),
      merged_into_id: acc.merged_into_id || null,
      merged_into_name,
      merged_accounts,
      effective_balance,
      billing_cycle_start_day: acc.billing_cycle_start_day || 1,
      credit_cycle_balance,
      created_at: acc.created_at,
    };
  },

  async getAccounts(includeAll = false) {
    let sql = "SELECT * FROM accounts";
    if (!includeAll) sql += " WHERE is_active = 1";
    const rows = this._queryAll(sql);
    return rows.map((r) => this._populateAccountResponse(r));
  },

  async getAccount(id) {
    const acc = this._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    if (!acc) throw new Error("Account not found");
    return this._populateAccountResponse(acc);
  },

  async createAccount(data) {
    const now = _now();
    const initialBalance = data.balance || 0;
    this._exec(
      "INSERT INTO accounts (name, balance, account_type, account_identifier, is_active, created_at, balance_updated_at) VALUES (?,?,?,?,1,?,?)",
      [
        data.name,
        initialBalance,
        data.account_type,
        data.account_identifier || null,
        now,
        initialBalance > 0 ? now : null,
      ],
    );
    const id = this._lastInsertId();
    this._clearTombstone(
      "account",
      _syncEntityKey("account", { ...data, account_identifier: data.account_identifier || null }),
    );
    await this._persist();
    const acc = this._queryOne("SELECT * FROM accounts WHERE id = ?", [id]);
    return this._populateAccountResponse(acc);
  },

  async updateAccount(accountId, data) {
    const acc = this._queryOne("SELECT * FROM accounts WHERE id = ?", [accountId]);
    if (!acc) throw new Error("Account not found");
    const fields = [];
    const values = [];
    if (data.name !== undefined && data.name !== "") {
      fields.push("name = ?");
      values.push(data.name);
    }
    if (data.account_identifier !== undefined) {
      fields.push("account_identifier = ?");
      values.push(data.account_identifier || null);
    }
    if (data.billing_cycle_start_day !== undefined) {
      const day = Number.parseInt(data.billing_cycle_start_day, 10);
      if (Number.isNaN(day) || day < 1 || day > 28) {
        throw new Error("Billing cycle start day must be between 1 and 28");
      }
      fields.push("billing_cycle_start_day = ?");
      values.push(day);
    }
    if (fields.length === 0) throw new Error("No fields to update");
    fields.push("updated_at = ?");
    values.push(_now());
    values.push(accountId);
    this._exec(`UPDATE accounts SET ${fields.join(", ")} WHERE id = ?`, values);
    await this._persist();
    const updated = this._queryOne("SELECT * FROM accounts WHERE id = ?", [accountId]);
    return this._populateAccountResponse(updated);
  },

  async getCreditAccountBalance(accountId) {
    const acc = this._queryOne("SELECT * FROM accounts WHERE id = ?", [accountId]);
    if (!acc) throw new Error("Account not found");
    if (acc.account_type !== "credit") throw new Error("Not a credit account");
    const { cycleStart, cycleEnd } = this._getCreditCycleWindow(acc.billing_cycle_start_day || 1);
    return {
      account_id: accountId,
      cycle_start: cycleStart,
      cycle_end: cycleEnd,
      cycle_balance: this._creditCycleSum(accountId, cycleStart, cycleEnd),
    };
  },

  async mergeAccounts(sourceId, targetId) {
    if (sourceId === targetId) throw new Error("Cannot merge account into itself");

    const source = this._queryOne("SELECT * FROM accounts WHERE id = ?", [sourceId]);
    if (!source) throw new Error("Source account not found");

    const target = this._queryOne("SELECT * FROM accounts WHERE id = ?", [targetId]);
    if (!target) throw new Error("Target account not found");

    if (!_bool(target.is_active) || target.merged_into_id) {
      throw new Error("Target account must not already be merged into another account");
    }
    if (source.merged_into_id) {
      throw new Error("Source account is already merged. Unmerge it first.");
    }

    // cycle check: target must not be descendant of source
    const sourceDescendants = this._collectDescendants(sourceId);
    if (sourceDescendants.includes(targetId)) {
      throw new Error("Cannot merge an account into its own descendant");
    }

    // type check
    if (source.account_type !== target.account_type) {
      throw new Error(
        `Cannot merge accounts with different types: ${source.account_type} into ${target.account_type}`,
      );
    }

    // depth check
    const _getMergeDepth = (aid) => {
      const kids = this._queryAll("SELECT id FROM accounts WHERE merged_into_id = ?", [aid]);
      if (kids.length === 0) return 0;
      return 1 + Math.max(...kids.map((k) => _getMergeDepth(k.id)));
    };
    const sourceDepth = _getMergeDepth(sourceId);
    let targetDepthAbove = 0;
    let cur = target;
    while (cur.merged_into_id) {
      targetDepthAbove++;
      cur = this._queryOne("SELECT * FROM accounts WHERE id = ?", [cur.merged_into_id]);
      if (!cur) break;
    }
    if (targetDepthAbove + 1 + sourceDepth > MAX_MERGE_DEPTH) {
      throw new Error("Cannot merge: maximum hierarchy depth exceeded");
    }

    const now = _now();
    this._exec(
      "UPDATE accounts SET merged_into_id = ?, merged_at = ?, is_active = 0, updated_at = ? WHERE id = ?",
      [targetId, now, now, sourceId],
    );
    await this._persist();
    const updated = this._queryOne("SELECT * FROM accounts WHERE id = ?", [targetId]);
    return this._populateAccountResponse(updated);
  },

  async unmergeAccount(accountId) {
    const acc = this._queryOne("SELECT * FROM accounts WHERE id = ?", [accountId]);
    if (!acc) throw new Error("Account not found");
    if (!acc.merged_into_id) throw new Error("Account is not merged");

    this._exec(
      "UPDATE accounts SET merged_into_id = NULL, merged_at = NULL, is_active = 1, updated_at = ? WHERE id = ?",
      [_now(), accountId],
    );
    await this._persist();
    const updated = this._queryOne("SELECT * FROM accounts WHERE id = ?", [accountId]);
    return this._populateAccountResponse(updated);
  },

  async deleteAccount(accountId) {
    const acc = this._queryOne("SELECT * FROM accounts WHERE id = ?", [accountId]);
    if (!acc) throw new Error("Account not found");

    const children = this._queryAll("SELECT id FROM accounts WHERE merged_into_id = ?", [
      accountId,
    ]);
    if (children.length > 0) {
      throw new Error("Cannot delete account with merged children. Unmerge them first.");
    }

    const txRow = this._queryOne("SELECT COUNT(*) as c FROM transactions WHERE account_id = ?", [
      accountId,
    ]);
    if (txRow && txRow.c > 0) {
      throw new Error(`Cannot delete account: ${txRow.c} transaction(s) are linked to it`);
    }

    this._exec("DELETE FROM accounts WHERE id = ?", [accountId]);
    this._recordTombstone("account", _syncEntityKey("account", acc));
    await this._persist();
    return { detail: "Account deleted" };
  },

  // ========================================================================
  // Transactions
  // ========================================================================
  _lookupMerchant(merchantUpiId, merchantName) {
    if (merchantUpiId) {
      const m = this._queryOne("SELECT * FROM merchants WHERE merchant_upi_id = ?", [
        merchantUpiId,
      ]);
      if (m) return m;
    }
    if (merchantName) {
      // Resolve via a learned alias (normalized name) first, then by the stable key.
      const aliasNorm = _normalizeMerchantName(merchantName);
      if (aliasNorm) {
        const viaAlias = this._queryOne(
          `SELECT m.* FROM merchants m
           JOIN merchant_aliases a ON a.merchant_id = m.id
           WHERE a.alias_norm = ?`,
          [aliasNorm],
        );
        if (viaAlias) return viaAlias;
      }
      const key = _slug(merchantName);
      if (key) {
        const viaKey = this._queryOne("SELECT * FROM merchants WHERE merchant_key = ?", [key]);
        if (viaKey) return viaKey;
      }
    }
    return null;
  },

  /**
   * Insert a merchant_alias row mapping a normalized name to a merchant, unless the
   * normalized name equals the merchant_key or already collides on the UNIQUE(alias_norm).
   */
  _ensureMerchantAlias(merchantId, merchantKey, merchantName) {
    const aliasNorm = _normalizeMerchantName(merchantName);
    if (!aliasNorm || aliasNorm === merchantKey) return;
    const clash = this._queryOne("SELECT 1 FROM merchant_aliases WHERE alias_norm = ?", [
      aliasNorm,
    ]);
    if (clash) return;
    this._exec("INSERT OR IGNORE INTO merchant_aliases (merchant_id, alias_norm) VALUES (?,?)", [
      merchantId,
      aliasNorm,
    ]);
  },

  /**
   * Compute a unique merchant_key from a UPI id or display name, appending a numeric
   * suffix if the candidate collides with an existing merchant_key.
   */
  _uniqueMerchantKey(merchantUpiId, merchantName) {
    let key = merchantUpiId || _slug(merchantName);
    if (!key) key = `merchant-${Date.now()}`;
    const existing = this._queryOne("SELECT id FROM merchants WHERE merchant_key = ?", [key]);
    if (!existing) return key;
    // Collision — append a disambiguating suffix.
    let n = 2;
    while (this._queryOne("SELECT id FROM merchants WHERE merchant_key = ?", [`${key}-${n}`])) {
      n++;
    }
    return `${key}-${n}`;
  },

  _learnMerchantMapping(transaction, newCategoryId) {
    const merchantUpiId = transaction.merchant_upi_id;
    const merchantName = transaction.merchant_name;
    if (!merchantUpiId && !merchantName) return;

    let merchant = this._lookupMerchant(merchantUpiId, merchantName);
    const now = _now();

    if (merchant) {
      this._exec(
        "UPDATE merchants SET category_id = ?, confidence_score = ?, last_updated = ? WHERE id = ?",
        [newCategoryId, DEFAULT_CONFIDENCE_SCORE, now, merchant.id],
      );
      // Record this raw name as an alias too, in case the merchant was resolved by UPI.
      this._ensureMerchantAlias(merchant.id, merchant.merchant_key, merchantName);
    } else {
      const key = this._uniqueMerchantKey(merchantUpiId, merchantName);
      this._exec(
        "INSERT INTO merchants (merchant_key, display_name, merchant_upi_id, category_id, confidence_score, created_at, last_updated) VALUES (?,?,?,?,?,?,?)",
        [
          key,
          merchantName,
          merchantUpiId || null,
          newCategoryId,
          DEFAULT_CONFIDENCE_SCORE,
          now,
          now,
        ],
      );
      merchant = { id: this._lastInsertId(), merchant_key: key };
      this._ensureMerchantAlias(merchant.id, key, merchantName);
    }

    // Link this transaction to the merchant identity.
    this._exec("UPDATE transactions SET merchant_id = ? WHERE id = ?", [
      merchant.id,
      transaction.id,
    ]);

    // Retroactively link + recategorize every transaction belonging to THIS merchant.
    this._relinkMerchantTransactions(merchant, {
      upiId: merchantUpiId,
      originalName: merchantName,
      excludeTxId: transaction.id,
      categoryId: newCategoryId,
    });
  },

  /**
   * Retroactively link every transaction belonging to `merchant` — those already linked by
   * merchant_id, plus any unlinked rows whose provenance (merchant_upi_id, or normalized
   * merchant_name) resolves to this merchant via its UPI id / key / aliases. Scoped strictly
   * to this merchant. When `categoryId` is provided the chosen category is applied too;
   * otherwise only merchant_id is set (used by rename memory, which must not touch category).
   */
  _relinkMerchantTransactions(merchant, { upiId, originalName, excludeTxId, categoryId } = {}) {
    const setCategory = categoryId !== undefined && categoryId !== null;
    const setClause = setCategory ? "category_id = ?, merchant_id = ?" : "merchant_id = ?";
    const catArgs = setCategory ? [categoryId] : [];

    const aliasNorms = this._queryAll(
      "SELECT alias_norm FROM merchant_aliases WHERE merchant_id = ?",
      [merchant.id],
    ).map((r) => r.alias_norm);
    const nameKeys = new Set(aliasNorms);
    if (merchant.merchant_key) nameKeys.add(merchant.merchant_key);
    const normSelf = _normalizeMerchantName(originalName);
    if (normSelf) nameKeys.add(normSelf);

    // Always sweep rows already linked to this merchant.
    this._exec(`UPDATE transactions SET ${setClause} WHERE id != ? AND merchant_id = ?`, [
      ...catArgs,
      merchant.id,
      excludeTxId,
      merchant.id,
    ]);
    if (upiId) {
      this._exec(`UPDATE transactions SET ${setClause} WHERE id != ? AND merchant_upi_id = ?`, [
        ...catArgs,
        merchant.id,
        excludeTxId,
        upiId,
      ]);
    }
    if (nameKeys.size > 0) {
      // Match on the SAME normalization used to build nameKeys (_normalizeMerchantName
      // collapses internal whitespace, which SQL's lower(trim(...)) does not). Fetch the
      // unlinked candidates and compare normalized names in JS so the two never diverge.
      const candidates = this._queryAll(
        `SELECT id, merchant_name FROM transactions
         WHERE id != ? AND merchant_id IS NULL AND merchant_upi_id IS NULL
           AND merchant_name IS NOT NULL`,
        [excludeTxId],
      );
      for (const cand of candidates) {
        if (!nameKeys.has(_normalizeMerchantName(cand.merchant_name))) continue;
        this._exec(`UPDATE transactions SET ${setClause} WHERE id = ?`, [
          ...catArgs,
          merchant.id,
          cand.id,
        ]);
      }
    }
  },

  /**
   * Persist a merchant rename so future transactions carrying the SAME original merchant
   * provenance are automatically mapped to the renamed display name. Keyed on the ORIGINAL
   * string/UPI (that is what future bank/LLM emails carry). Never changes category_id.
   */
  _rememberMerchantRename(transaction, originalUpiId, originalName, newName) {
    if (!originalUpiId && !originalName) return;

    let merchant = this._lookupMerchant(originalUpiId, originalName);
    const now = _now();

    if (merchant) {
      if (merchant.display_name !== newName) {
        this._exec("UPDATE merchants SET display_name = ?, last_updated = ? WHERE id = ?", [
          newName,
          now,
          merchant.id,
        ]);
      }
      // Ensure the original raw name resolves to this merchant (it may have matched by UPI).
      this._ensureMerchantAlias(merchant.id, merchant.merchant_key, originalName);
    } else {
      // The bug case: no identity yet. Create one keyed on the ORIGINAL string so future
      // imports of that raw text resolve here.
      const key = this._uniqueMerchantKey(originalUpiId, originalName);
      this._exec(
        "INSERT INTO merchants (merchant_key, display_name, merchant_upi_id, category_id, confidence_score, created_at, last_updated) VALUES (?,?,?,?,?,?,?)",
        [
          key,
          newName,
          originalUpiId || null,
          transaction.category_id || null,
          DEFAULT_CONFIDENCE_SCORE,
          now,
          now,
        ],
      );
      merchant = { id: this._lastInsertId(), merchant_key: key };
      this._ensureMerchantAlias(merchant.id, key, originalName);
    }

    // Also map the NEW name so a future manual entry typed as the new name maps here too.
    this._ensureMerchantAlias(merchant.id, merchant.merchant_key, newName);

    // Link this transaction to the merchant identity.
    this._exec("UPDATE transactions SET merchant_id = ? WHERE id = ?", [
      merchant.id,
      transaction.id,
    ]);

    // Retro-link siblings (no category write) so they display the new name automatically.
    this._relinkMerchantTransactions(merchant, {
      upiId: originalUpiId,
      originalName,
      excludeTxId: transaction.id,
    });
  },

  _buildTransactionResponse(tx) {
    let category = null;
    if (tx.category_id) {
      const cat = this._queryOne("SELECT * FROM categories WHERE id = ?", [tx.category_id]);
      if (cat) {
        category = {
          id: cat.id,
          name: cat.name,
          description: cat.description || null,
          is_default: _bool(cat.is_default),
          created_at: cat.created_at,
          updated_at: cat.updated_at,
        };
      }
    }
    let account_name = null;
    const acc = this._queryOne("SELECT name, merged_into_id FROM accounts WHERE id = ?", [
      tx.account_id,
    ]);
    if (acc) {
      // Walk up to root account for display name
      let cur = acc;
      while (cur.merged_into_id) {
        const parent = this._queryOne("SELECT name, merged_into_id FROM accounts WHERE id = ?", [
          cur.merged_into_id,
        ]);
        if (!parent) break;
        cur = parent;
      }
      account_name = cur.name;
    }

    // Resolve the displayed merchant name: a linked merchant's current display_name wins
    // over the transaction's immutable provenance text so renames surface everywhere.
    let merchantDisplay = tx.merchant_name || null;
    if (tx.merchant_id) {
      const m = this._queryOne("SELECT merchant_key, display_name FROM merchants WHERE id = ?", [
        tx.merchant_id,
      ]);
      if (m) merchantDisplay = m.display_name || m.merchant_key || merchantDisplay;
    }

    return {
      id: tx.id,
      transaction_id: tx.transaction_id || null,
      gmail_message_id: tx.gmail_message_id || null,
      date: tx.date,
      amount: tx.amount,
      description: tx.description || null,
      notes: tx.notes || null,
      payment_reference: tx.payment_reference || null,
      category_id: tx.category_id || null,
      category,
      merchant_upi_id: tx.merchant_upi_id || null,
      merchant_name: merchantDisplay,
      merchant_id: tx.merchant_id || null,
      transaction_type: tx.transaction_type,
      account_id: tx.account_id,
      account_name,
      is_recurring: _bool(tx.is_recurring),
      excluded_from_expenses: Boolean(tx.excluded_from_expenses),
      excluded_from_income: Boolean(tx.excluded_from_income),
      created_at: tx.created_at,
      tags: this._getTagsForTx(tx.id),
    };
  },

  async getTransactions(params = {}) {
    let sql = "SELECT * FROM transactions WHERE 1=1";
    const binds = [];

    if (params.id) {
      sql += " AND id = ?";
      binds.push(params.id);
    }
    if (params.transaction_id) {
      sql += " AND transaction_id = ?";
      binds.push(params.transaction_id);
    }
    if (params.account_id) {
      const acc = this._queryOne("SELECT id FROM accounts WHERE id = ?", [params.account_id]);
      if (!acc) throw new Error("Account not found");
      const includeMerged = params.include_merged !== "false" && params.include_merged !== false;
      if (includeMerged) {
        const familyIds = this._getAccountFamily(params.account_id);
        sql += ` AND account_id IN (${familyIds.map(() => "?").join(",")})`;
        binds.push(...familyIds);
      } else {
        sql += " AND account_id = ?";
        binds.push(params.account_id);
      }
    }
    if (params.category_id) {
      sql += " AND category_id = ?";
      binds.push(params.category_id);
    }
    if (params.transaction_type) {
      sql += " AND transaction_type = ?";
      binds.push(params.transaction_type.toLowerCase());
    }
    if (params.date_from) {
      sql += " AND date >= ?";
      binds.push(params.date_from);
    }
    if (params.date_to) {
      // date_to is inclusive — add 1 day
      const d = new Date(params.date_to);
      d.setDate(d.getDate() + 1);
      sql += " AND date < ?";
      binds.push(d.toISOString().split("T")[0]);
    }
    if (params.tag_ids && params.tag_ids.length > 0) {
      const tagPlaceholders = params.tag_ids.map(() => "?").join(",");
      sql += ` AND id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${tagPlaceholders}))`;
      binds.push(...params.tag_ids);
    }
    sql += " ORDER BY date DESC";
    const limit = params.limit ? Number.parseInt(params.limit, 10) : 50;
    const offset = params.offset ? Number.parseInt(params.offset, 10) : 0;
    sql += " LIMIT ? OFFSET ?";
    binds.push(limit, offset);

    const rows = this._queryAll(sql, binds);
    return rows.map((tx) => this._buildTransactionResponse(tx));
  },

  async getTransactionTotals(params = {}) {
    let sql = `SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'income' AND excluded_from_income = 0 THEN amount ELSE 0 END), 0) as total_income,
      COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND excluded_from_expenses = 0 THEN ABS(amount) ELSE 0 END), 0) as total_expense,
      COUNT(*) as transaction_count
      FROM transactions WHERE 1=1`;
    const binds = [];

    if (params.account_id) {
      const acc = this._queryOne("SELECT id FROM accounts WHERE id = ?", [params.account_id]);
      if (!acc) throw new Error("Account not found");
      const includeMerged = params.include_merged !== "false" && params.include_merged !== false;
      if (includeMerged) {
        const familyIds = this._getAccountFamily(params.account_id);
        sql += ` AND account_id IN (${familyIds.map(() => "?").join(",")})`;
        binds.push(...familyIds);
      } else {
        sql += " AND account_id = ?";
        binds.push(params.account_id);
      }
    }
    if (params.category_id) {
      sql += " AND category_id = ?";
      binds.push(params.category_id);
    }
    if (params.transaction_type) {
      sql += " AND transaction_type = ?";
      binds.push(params.transaction_type.toLowerCase());
    }
    if (params.date_from) {
      sql += " AND date >= ?";
      binds.push(params.date_from);
    }
    if (params.date_to) {
      const d = new Date(params.date_to);
      d.setDate(d.getDate() + 1);
      sql += " AND date < ?";
      binds.push(d.toISOString().split("T")[0]);
    }
    if (params.tag_ids && params.tag_ids.length > 0) {
      const tagPlaceholders = params.tag_ids.map(() => "?").join(",");
      sql += ` AND id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${tagPlaceholders}))`;
      binds.push(...params.tag_ids);
    }

    const row = this._queryOne(sql, binds);
    const totalIncome = row.total_income;
    const totalExpense = row.total_expense;
    return {
      total_income: totalIncome,
      total_expense: totalExpense,
      net: totalIncome - totalExpense,
      transaction_count: row.transaction_count,
    };
  },

  async createTransaction(data) {
    // Validate category
    if (data.category_id) {
      const cat = this._queryOne("SELECT id FROM categories WHERE id = ?", [data.category_id]);
      if (!cat) throw new Error("Category not found");
    }
    // Validate account
    const acc = this._queryOne("SELECT id FROM accounts WHERE id = ?", [data.account_id]);
    if (!acc) throw new Error("Account not found");

    let categoryId = data.category_id || null;
    let merchantId = data.merchant_id || null;

    // Link to a known merchant whenever one matches, independent of whether a category was
    // supplied. The merchant_id link is what surfaces merchant renames on a transaction (see
    // _buildTransactionResponse), so it must not be skipped just because a category is set.
    // Auto-categorization still only fills in a missing category.
    if (!merchantId) {
      const merchant = this._lookupMerchant(data.merchant_upi_id, data.merchant_name);
      if (merchant) {
        merchantId = merchant.id;
        if (!categoryId) categoryId = merchant.category_id;
      }
    }

    const now = _now();
    const transactionId = data.transaction_id || `man_${crypto.randomUUID()}`;
    this._exec(
      `INSERT INTO transactions
       (transaction_id, date, amount, description, notes, merchant_upi_id, merchant_name,
        merchant_id, category_id, transaction_type, account_id, created_at, updated_at, is_recurring)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [
        transactionId,
        data.date,
        data.amount,
        data.description || null,
        data.notes || null,
        data.merchant_upi_id || null,
        data.merchant_name || null,
        merchantId,
        categoryId,
        data.transaction_type,
        data.account_id,
        now,
        now,
      ],
    );
    this._clearTombstone("transaction", transactionId);
    const id = this._lastInsertId();
    if (data.tag_ids && data.tag_ids.length > 0) {
      this._setTxTags(id, data.tag_ids);
    }
    await this._persist();
    const tx = this._queryOne("SELECT * FROM transactions WHERE id = ?", [id]);
    return this._buildTransactionResponse(tx);
  },

  async updateTransaction(txId, data) {
    const tx = this._queryOne("SELECT * FROM transactions WHERE id = ?", [txId]);
    if (!tx) throw new Error("Transaction not found");

    const fields = [];
    const values = [];
    const learnMerchant = data.learn_merchant;

    if (data.date !== undefined) {
      if (!data.date || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(data.date)) {
        throw new Error("Invalid date format: expected YYYY-MM-DD or YYYY-MM-DDTHH:MM");
      }
      const dateOnly = data.date.slice(0, 10);
      // If the caller supplied a time component, use it; otherwise preserve the
      // existing row's time suffix so intra-day ordering is not lost.
      const hasNewTime = data.date.length > 10;
      const timeSuffix = hasNewTime
        ? data.date.slice(10)
        : tx.date && tx.date.length > 10
          ? tx.date.slice(10)
          : "";
      fields.push("date = ?");
      values.push(dateOnly + timeSuffix);
    }
    if (data.amount !== undefined) {
      fields.push("amount = ?");
      values.push(data.amount);
    }
    if (data.description !== undefined) {
      fields.push("description = ?");
      values.push(data.description);
    }
    if (data.notes !== undefined) {
      fields.push("notes = ?");
      values.push(data.notes);
    }
    if (data.category_id !== undefined) {
      if (data.category_id !== null) {
        const cat = this._queryOne("SELECT id FROM categories WHERE id = ?", [data.category_id]);
        if (!cat) throw new Error("Category not found");
      }
      fields.push("category_id = ?");
      values.push(data.category_id);
    }
    if (data.transaction_type !== undefined) {
      fields.push("transaction_type = ?");
      values.push(data.transaction_type);
    }
    if (data.account_id !== undefined) {
      fields.push("account_id = ?");
      values.push(data.account_id);
    }
    if (data.merchant_name !== undefined) {
      fields.push("merchant_name = ?");
      values.push(data.merchant_name);
    }
    if (data.merchant_upi_id !== undefined) {
      fields.push("merchant_upi_id = ?");
      values.push(data.merchant_upi_id);
    }

    if (fields.length > 0) {
      fields.push("updated_at = ?");
      values.push(_now());
      values.push(txId);
      this._exec(`UPDATE transactions SET ${fields.join(", ")} WHERE id = ?`, values);
    }

    // A transaction linked to a merchant shows that merchant's display_name (see
    // _buildTransactionResponse), so editing the merchant name on such a transaction must
    // rename the merchant identity for the change to surface. Unlinked transactions rely on
    // their own merchant_name column (updated above) instead.
    const nameChanged =
      data.merchant_name !== undefined &&
      data.merchant_name &&
      data.merchant_name !== tx.merchant_name;

    if (nameChanged && data.learn_merchant_name === true) {
      // Remember the rename so future transactions with the SAME original provenance map to
      // the new name. Works for both linked and unlinked source transactions. Keyed on the
      // ORIGINAL name/UPI from the pre-update snapshot. Carries the transaction's CURRENT
      // (post-update) category without changing it.
      const updated = this._queryOne("SELECT * FROM transactions WHERE id = ?", [txId]);
      this._rememberMerchantRename(
        updated,
        tx.merchant_upi_id,
        tx.merchant_name,
        data.merchant_name,
      );
    } else if (data.merchant_name !== undefined && data.merchant_name && tx.merchant_id) {
      const linked = this._queryOne("SELECT display_name FROM merchants WHERE id = ?", [
        tx.merchant_id,
      ]);
      if (linked && linked.display_name !== data.merchant_name) {
        this._exec("UPDATE merchants SET display_name = ?, last_updated = ? WHERE id = ?", [
          data.merchant_name,
          _now(),
          tx.merchant_id,
        ]);
      }
    }

    // Learn merchant mapping if requested
    if (learnMerchant && data.category_id !== undefined && data.category_id !== null) {
      const updated = this._queryOne("SELECT * FROM transactions WHERE id = ?", [txId]);
      this._learnMerchantMapping(updated, data.category_id);
    }
    if (data.tag_ids !== undefined) {
      this._setTxTags(txId, data.tag_ids || []);
    }

    await this._persist();
    const result = this._queryOne("SELECT * FROM transactions WHERE id = ?", [txId]);
    return this._buildTransactionResponse(result);
  },

  async toggleExcludedFromExpenses(txId, value) {
    const tx = this._queryOne("SELECT id FROM transactions WHERE id = ?", [txId]);
    if (!tx) throw new Error("Transaction not found");
    this._exec("UPDATE transactions SET excluded_from_expenses = ?, updated_at = ? WHERE id = ?", [
      value ? 1 : 0,
      _now(),
      txId,
    ]);
    await this._persist();
  },

  async toggleExcludedFromIncome(txId, value) {
    const tx = this._queryOne("SELECT id FROM transactions WHERE id = ?", [txId]);
    if (!tx) throw new Error("Transaction not found");
    this._exec("UPDATE transactions SET excluded_from_income = ?, updated_at = ? WHERE id = ?", [
      value ? 1 : 0,
      _now(),
      txId,
    ]);
    await this._persist();
  },

  async deleteTransaction(txId) {
    const tx = this._queryOne(
      "SELECT id, transaction_id, gmail_message_id FROM transactions WHERE id = ?",
      [txId],
    );
    if (!tx) throw new Error("Transaction not found");
    // transaction_tags rows are removed by ON DELETE CASCADE
    this._exec("DELETE FROM transactions WHERE id = ?", [txId]);
    // Tombstone the transaction identity so the deletion propagates to other devices.
    this._recordTombstone("transaction", tx.transaction_id);
    // Tombstone the Gmail message: keep its ID in processed_gmail_messages and flag it
    // deleted so Layer-1 dedup keeps filtering it (a deleted email must NOT be re-imported
    // on the next sync). Ensure a tombstone row exists even if the ID was never recorded.
    if (tx.gmail_message_id) {
      this._exec("INSERT OR IGNORE INTO processed_gmail_messages (gmail_message_id) VALUES (?)", [
        tx.gmail_message_id,
      ]);
      this._exec("UPDATE processed_gmail_messages SET deleted = 1 WHERE gmail_message_id = ?", [
        tx.gmail_message_id,
      ]);
    }
    await this._persist();
    return { detail: "Transaction deleted" };
  },

  // ========================================================================
  // Tags
  // ========================================================================

  /**
   * Normalize a tag name: strip leading '#', convert whitespace-separated
   * words to camelCase, trim.
   */
  _normalizeTagName(name) {
    if (!name) return "";
    // Strip leading '#'
    let n = name.trim().replace(/^#+/, "");
    n = n.trim();
    if (!n) return "";
    // Split on whitespace, convert to camelCase
    const words = n.split(/\s+/);
    if (words.length === 1) return words[0];
    return (
      words[0] +
      words
        .slice(1)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("")
    );
  },

  _getTagsForTx(txId) {
    return this._queryAll(
      "SELECT t.id, t.name FROM tags t JOIN transaction_tags tt ON t.id = tt.tag_id WHERE tt.transaction_id = ? ORDER BY t.name",
      [txId],
    ).map((r) => ({ id: r.id, name: r.name }));
  },

  _setTxTags(txId, tagIds) {
    this._exec("DELETE FROM transaction_tags WHERE transaction_id = ?", [txId]);
    for (const tagId of tagIds) {
      this._exec("INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?,?)", [
        txId,
        tagId,
      ]);
    }
  },

  async getTags() {
    return this._queryAll("SELECT * FROM tags ORDER BY name");
  },

  async createTag(name) {
    const normalized = this._normalizeTagName(name);
    if (!normalized) throw new Error("Tag name is required");
    const existing = this._queryOne("SELECT id FROM tags WHERE name = ? COLLATE NOCASE", [
      normalized,
    ]);
    if (existing) throw new Error(`Tag '${normalized}' already exists`);
    const now = _now();
    this._exec("INSERT INTO tags (name, created_at) VALUES (?,?)", [normalized, now]);
    const id = this._lastInsertId();
    this._clearTombstone("tag", _syncEntityKey("tag", { name: normalized }));
    await this._persist();
    return this._queryOne("SELECT * FROM tags WHERE id = ?", [id]);
  },

  async updateTag(id, name) {
    const tag = this._queryOne("SELECT id FROM tags WHERE id = ?", [id]);
    if (!tag) throw new Error("Tag not found");
    const normalized = this._normalizeTagName(name);
    if (!normalized) throw new Error("Tag name is required");
    const existing = this._queryOne(
      "SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?",
      [normalized, id],
    );
    if (existing) throw new Error(`Tag '${normalized}' already exists`);
    this._exec("UPDATE tags SET name = ? WHERE id = ?", [normalized, id]);
    await this._persist();
    return this._queryOne("SELECT * FROM tags WHERE id = ?", [id]);
  },

  async deleteTag(id) {
    const tag = this._queryOne("SELECT id, name FROM tags WHERE id = ?", [id]);
    if (!tag) throw new Error("Tag not found");
    // transaction_tags rows removed by ON DELETE CASCADE
    this._exec("DELETE FROM tags WHERE id = ?", [id]);
    this._recordTombstone("tag", _syncEntityKey("tag", tag));
    await this._persist();
    return { detail: "Tag deleted" };
  },

  async setTransactionTags(txId, tagIds) {
    const tx = this._queryOne("SELECT id FROM transactions WHERE id = ?", [txId]);
    if (!tx) throw new Error("Transaction not found");
    this._setTxTags(txId, tagIds);
    await this._persist();
  },

  async getUpcomingBills(days = 7) {
    const today = _todayISO();
    const horizon = _addDays(today, days);
    const rows = this._queryAll(
      `${FOLLOWUP_SELECT}
       WHERE f.status = 'pending'
         AND f.due_date IS NOT NULL
         AND f.due_date <= ?
       ORDER BY f.due_date ASC`,
      [horizon],
    );
    return rows.map((r) => this._buildFollowUpResponse(r, today));
  },

  // ========================================================================
  // Transaction follow-ups / reminders
  // ========================================================================
  _buildFollowUpResponse(r, today = _todayISO()) {
    return {
      id: r.id,
      transaction_id: r.transaction_id,
      title: r.title || null,
      follow_up_type: r.follow_up_type,
      due_date: r.due_date || null,
      status: r.status,
      is_recurring: _bool(r.is_recurring),
      recurrence: r.recurrence || null,
      completed_at: r.completed_at || null,
      notes: r.notes || null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      amount: r.amount ?? null,
      description: r.description ?? null,
      merchant_name: r.merchant_name ?? null,
      merchant_upi_id: r.merchant_upi_id ?? null,
      category_name: r.category_name ?? null,
      transaction_type: r.transaction_type ?? null,
      account_id: r.account_id ?? null,
      transaction_date: r.transaction_date ?? null,
      days_remaining: r.due_date ? _daysBetween(today, r.due_date) : null,
    };
  },

  async getFollowUpById(id) {
    const r = this._queryOne(`${FOLLOWUP_SELECT} WHERE f.id = ?`, [id]);
    return r ? this._buildFollowUpResponse(r) : null;
  },

  async getFollowUp(transactionId) {
    const r = this._queryOne(`${FOLLOWUP_SELECT} WHERE f.transaction_id = ?`, [transactionId]);
    return r ? this._buildFollowUpResponse(r) : null;
  },

  async getFollowUps({ status, follow_up_type } = {}) {
    const where = [];
    const binds = [];
    if (status) {
      where.push("f.status = ?");
      binds.push(status);
    }
    if (follow_up_type) {
      where.push("f.follow_up_type = ?");
      binds.push(follow_up_type);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this._queryAll(`${FOLLOWUP_SELECT} ${whereSql}`, binds);
    const today = _todayISO();
    const mapped = rows.map((r) => this._buildFollowUpResponse(r, today));
    // Pending first (overdue → due soon → upcoming by due_date asc, undated last),
    // then done items sorted by completion time descending.
    mapped.sort((a, b) => {
      const aDone = a.status === "done";
      const bDone = b.status === "done";
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (!aDone) {
        if (a.days_remaining === null && b.days_remaining === null) return 0;
        if (a.days_remaining === null) return 1;
        if (b.days_remaining === null) return -1;
        return a.days_remaining - b.days_remaining;
      }
      return _ts(b.completed_at) - _ts(a.completed_at);
    });
    return mapped;
  },

  async createFollowUp(transactionId, data = {}) {
    const tx = this._queryOne("SELECT id, transaction_id FROM transactions WHERE id = ?", [
      transactionId,
    ]);
    if (!tx) throw new Error("Transaction not found");
    const now = _now();
    this._exec(
      `INSERT INTO transaction_follow_ups
         (transaction_id, title, follow_up_type, due_date, status, is_recurring, recurrence,
          notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        transactionId,
        data.title || null,
        data.follow_up_type || "reminder",
        data.due_date || null,
        "pending",
        data.is_recurring ? 1 : 0,
        data.recurrence || null,
        data.notes || null,
        now,
        now,
      ],
    );
    const id = this._lastInsertId();
    if (tx.transaction_id) this._clearTombstone("follow_up", tx.transaction_id);
    await this._persist();
    return this.getFollowUpById(id);
  },

  async updateFollowUp(id, fields = {}) {
    const existing = this._queryOne("SELECT id FROM transaction_follow_ups WHERE id = ?", [id]);
    if (!existing) throw new Error("Follow-up not found");
    const allowed = new Set([
      "title",
      "follow_up_type",
      "due_date",
      "status",
      "is_recurring",
      "recurrence",
      "notes",
      "completed_at",
    ]);
    const cols = [];
    const binds = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.has(key)) continue;
      cols.push(`${key} = ?`);
      binds.push(key === "is_recurring" ? (value ? 1 : 0) : (value ?? null));
    }
    if (cols.length === 0) return this.getFollowUpById(id);
    cols.push("updated_at = ?");
    binds.push(_now());
    binds.push(id);
    this._exec(`UPDATE transaction_follow_ups SET ${cols.join(", ")} WHERE id = ?`, binds);
    await this._persist();
    return this.getFollowUpById(id);
  },

  async deleteFollowUp(id) {
    const row = this._queryOne(
      `SELECT f.id, t.transaction_id AS tx_key
       FROM transaction_follow_ups f
       LEFT JOIN transactions t ON t.id = f.transaction_id
       WHERE f.id = ?`,
      [id],
    );
    if (!row) throw new Error("Follow-up not found");
    this._exec("DELETE FROM transaction_follow_ups WHERE id = ?", [id]);
    if (row.tx_key) this._recordTombstone("follow_up", row.tx_key);
    await this._persist();
    return { detail: "Follow-up deleted" };
  },

  async markFollowUpDone(id) {
    const f = this._queryOne("SELECT * FROM transaction_follow_ups WHERE id = ?", [id]);
    if (!f) throw new Error("Follow-up not found");
    const now = _now();
    if (_bool(f.is_recurring)) {
      const base = f.due_date || _todayISO();
      const nextDue = _advanceByRecurrence(base, f.recurrence);
      this._exec(
        `UPDATE transaction_follow_ups
         SET completed_at = ?, due_date = ?, status = 'pending', updated_at = ? WHERE id = ?`,
        [now, nextDue, now, id],
      );
    } else {
      this._exec(
        `UPDATE transaction_follow_ups
         SET completed_at = ?, status = 'done', updated_at = ? WHERE id = ?`,
        [now, now, id],
      );
    }
    await this._persist();
    return this.getFollowUpById(id);
  },

  async reopenFollowUp(id) {
    const f = this._queryOne("SELECT id FROM transaction_follow_ups WHERE id = ?", [id]);
    if (!f) throw new Error("Follow-up not found");
    this._exec(
      `UPDATE transaction_follow_ups
       SET status = 'pending', completed_at = NULL, updated_at = ? WHERE id = ?`,
      [_now(), id],
    );
    await this._persist();
    return this.getFollowUpById(id);
  },

  // ========================================================================
  // Categories
  // ========================================================================
  _buildCategoryResponse(c) {
    return {
      id: c.id,
      name: c.name,
      description: c.description || null,
      is_default: _bool(c.is_default),
      created_at: c.created_at,
      updated_at: c.updated_at,
    };
  },

  async getCategories() {
    const rows = this._queryAll("SELECT * FROM categories ORDER BY name");
    return rows.map((c) => this._buildCategoryResponse(c));
  },

  async createCategory(data) {
    const existing = this._queryOne("SELECT id FROM categories WHERE name = ?", [data.name]);
    if (existing) throw new Error(`Category '${data.name}' already exists`);

    if (data.is_default) {
      this._exec("UPDATE categories SET is_default = 0 WHERE is_default = 1");
    }
    const now = _now();
    this._exec(
      "INSERT INTO categories (name, description, is_default, created_at, updated_at) VALUES (?,?,?,?,?)",
      [data.name, data.description || null, data.is_default ? 1 : 0, now, now],
    );
    const id = this._lastInsertId();
    this._clearTombstone("category", _syncEntityKey("category", { name: data.name }));
    await this._persist();
    const cat = this._queryOne("SELECT * FROM categories WHERE id = ?", [id]);
    return this._buildCategoryResponse(cat);
  },

  async updateCategory(id, data) {
    const cat = this._queryOne("SELECT * FROM categories WHERE id = ?", [id]);
    if (!cat) throw new Error("Category not found");

    if (data.name !== undefined) {
      const existing = this._queryOne("SELECT id FROM categories WHERE name = ? AND id != ?", [
        data.name,
        id,
      ]);
      if (existing) throw new Error(`Category '${data.name}' already exists`);
    }

    if (data.is_default) {
      this._exec("UPDATE categories SET is_default = 0 WHERE is_default = 1 AND id != ?", [id]);
    }

    const fields = [];
    const values = [];
    if (data.name !== undefined) {
      fields.push("name = ?");
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push("description = ?");
      values.push(data.description);
    }
    if (data.is_default !== undefined) {
      fields.push("is_default = ?");
      values.push(data.is_default ? 1 : 0);
    }
    if (fields.length > 0) {
      fields.push("updated_at = ?");
      values.push(_now());
      values.push(id);
      this._exec(`UPDATE categories SET ${fields.join(", ")} WHERE id = ?`, values);
    }

    await this._persist();
    const updated = this._queryOne("SELECT * FROM categories WHERE id = ?", [id]);
    return this._buildCategoryResponse(updated);
  },

  async deleteCategory(categoryId) {
    const cat = this._queryOne("SELECT id, name FROM categories WHERE id = ?", [categoryId]);
    if (!cat) throw new Error("Category not found");

    const merchantCount = this._queryOne(
      "SELECT COUNT(*) as c FROM merchants WHERE category_id = ?",
      [categoryId],
    );
    if (merchantCount && merchantCount.c > 0) {
      throw new Error(`Cannot delete category: ${merchantCount.c} merchant(s) reference it`);
    }

    const txCount = this._queryOne("SELECT COUNT(*) as c FROM transactions WHERE category_id = ?", [
      categoryId,
    ]);
    if (txCount && txCount.c > 0) {
      throw new Error(`Cannot delete category: ${txCount.c} transaction(s) reference it`);
    }

    this._exec("DELETE FROM categories WHERE id = ?", [categoryId]);
    this._recordTombstone("category", _syncEntityKey("category", cat));
    await this._persist();
    return null;
  },

  async getDefaultCategory() {
    const cat = this._queryOne("SELECT * FROM categories WHERE is_default = 1");
    if (!cat) throw new Error("No default category set");
    return this._buildCategoryResponse(cat);
  },

  async setDefaultCategory(categoryId) {
    const cat = this._queryOne("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if (!cat) throw new Error("Category not found");

    this._exec("UPDATE categories SET is_default = 0 WHERE is_default = 1 AND id != ?", [
      categoryId,
    ]);
    this._exec("UPDATE categories SET is_default = 1, updated_at = ? WHERE id = ?", [
      _now(),
      categoryId,
    ]);
    await this._persist();
    const updated = this._queryOne("SELECT * FROM categories WHERE id = ?", [categoryId]);
    return this._buildCategoryResponse(updated);
  },

  // ========================================================================
  // Merchants
  // ========================================================================
  _buildMerchantResponse(m) {
    let category = null;
    if (m.category_id) {
      const cat = this._queryOne("SELECT * FROM categories WHERE id = ?", [m.category_id]);
      if (cat) category = this._buildCategoryResponse(cat);
    }
    return {
      id: m.id,
      merchant_upi_id: m.merchant_upi_id || null,
      // The UI reads `merchant_name`; expose the mutable display name (falling back to the
      // stable key) under that key for backward compatibility.
      merchant_name: m.display_name || m.merchant_key || null,
      merchant_key: m.merchant_key,
      category_id: m.category_id ?? null,
      category,
      confidence_score: m.confidence_score,
      created_at: m.created_at,
      last_updated: m.last_updated,
    };
  },

  async getMerchants(params = {}) {
    const skip = params.skip ? Number.parseInt(params.skip, 10) : 0;
    const limit = params.limit ? Number.parseInt(params.limit, 10) : DEFAULT_MERCHANT_PAGE_LIMIT;
    const rows = this._queryAll(
      "SELECT * FROM merchants ORDER BY last_updated DESC LIMIT ? OFFSET ?",
      [limit, skip],
    );
    return rows.map((m) => this._buildMerchantResponse(m));
  },

  async searchMerchants(q) {
    const pattern = `%${_escapeLike(q)}%`;
    const rows = this._queryAll(
      "SELECT * FROM merchants WHERE display_name LIKE ? ESCAPE '\\' OR merchant_key LIKE ? ESCAPE '\\' OR merchant_upi_id LIKE ? ESCAPE '\\' ORDER BY display_name",
      [pattern, pattern, pattern],
    );
    return rows.map((m) => this._buildMerchantResponse(m));
  },

  async createMerchant(data) {
    const cat = this._queryOne("SELECT id FROM categories WHERE id = ?", [data.category_id]);
    if (!cat) throw new Error("Category not found");

    if (data.merchant_upi_id) {
      const existing = this._queryOne("SELECT id FROM merchants WHERE merchant_upi_id = ?", [
        data.merchant_upi_id,
      ]);
      if (existing) {
        throw new Error(`Merchant with UPI ID '${data.merchant_upi_id}' already exists`);
      }
    }

    const key = data.merchant_upi_id || _slug(data.merchant_name);
    if (!key) throw new Error("Name or UPI ID required");
    const keyClash = this._queryOne("SELECT id FROM merchants WHERE merchant_key = ?", [key]);
    if (keyClash) {
      throw new Error(`Merchant '${data.merchant_name || key}' already exists`);
    }

    const now = _now();
    this._exec(
      "INSERT INTO merchants (merchant_key, display_name, merchant_upi_id, category_id, confidence_score, created_at, last_updated) VALUES (?,?,?,?,?,?,?)",
      [
        key,
        data.merchant_name || null,
        data.merchant_upi_id || null,
        data.category_id,
        data.confidence_score ?? DEFAULT_CONFIDENCE_SCORE,
        now,
        now,
      ],
    );
    const id = this._lastInsertId();
    this._ensureMerchantAlias(id, key, data.merchant_name);
    this._clearTombstone("merchant", key);
    await this._persist();
    const m = this._queryOne("SELECT * FROM merchants WHERE id = ?", [id]);
    return this._buildMerchantResponse(m);
  },

  async updateMerchant(merchantId, data) {
    const m = this._queryOne("SELECT * FROM merchants WHERE id = ?", [merchantId]);
    if (!m) throw new Error("Merchant not found");

    if (data.category_id !== undefined && data.category_id !== null) {
      const cat = this._queryOne("SELECT id FROM categories WHERE id = ?", [data.category_id]);
      if (!cat) throw new Error("Category not found");
    }
    if (data.merchant_upi_id) {
      const existing = this._queryOne(
        "SELECT id FROM merchants WHERE merchant_upi_id = ? AND id != ?",
        [data.merchant_upi_id, merchantId],
      );
      if (existing) {
        throw new Error(`Merchant with UPI ID '${data.merchant_upi_id}' already exists`);
      }
    }

    const fields = [];
    const values = [];
    if (data.merchant_upi_id !== undefined) {
      fields.push("merchant_upi_id = ?");
      values.push(data.merchant_upi_id);
    }
    // A rename only changes the display name — merchant_key and aliases stay fixed so the
    // identity (and every transaction linked to it) is preserved without propagation.
    if (data.merchant_name !== undefined) {
      fields.push("display_name = ?");
      values.push(data.merchant_name);
    }
    if (data.category_id !== undefined) {
      fields.push("category_id = ?");
      values.push(data.category_id);
    }
    if (data.confidence_score !== undefined) {
      if (
        typeof data.confidence_score !== "number" ||
        data.confidence_score < 0 ||
        data.confidence_score > 1
      ) {
        throw new Error("Confidence score must be a number between 0 and 1");
      }
      fields.push("confidence_score = ?");
      values.push(data.confidence_score);
    }
    if (fields.length > 0) {
      fields.push("last_updated = ?");
      values.push(_now());
      values.push(merchantId);
      this._exec(`UPDATE merchants SET ${fields.join(", ")} WHERE id = ?`, values);
    }

    await this._persist();
    const updated = this._queryOne("SELECT * FROM merchants WHERE id = ?", [merchantId]);
    return this._buildMerchantResponse(updated);
  },

  async updateMerchantCategory(merchantId, categoryId) {
    const m = this._queryOne("SELECT * FROM merchants WHERE id = ?", [merchantId]);
    if (!m) throw new Error("Merchant not found");
    const cat = this._queryOne("SELECT id FROM categories WHERE id = ?", [categoryId]);
    if (!cat) throw new Error("Category not found");

    this._exec(
      "UPDATE merchants SET category_id = ?, confidence_score = ?, last_updated = ? WHERE id = ?",
      [categoryId, DEFAULT_CONFIDENCE_SCORE, _now(), merchantId],
    );
    await this._persist();
    const updated = this._queryOne("SELECT * FROM merchants WHERE id = ?", [merchantId]);
    return this._buildMerchantResponse(updated);
  },

  async deleteMerchant(merchantId) {
    const m = this._queryOne("SELECT id, merchant_key FROM merchants WHERE id = ?", [merchantId]);
    if (!m) throw new Error("Merchant not found");
    this._exec("DELETE FROM merchants WHERE id = ?", [merchantId]);
    this._recordTombstone("merchant", m.merchant_key);
    await this._persist();
    return null;
  },

  // ========================================================================
  // Goals
  // ========================================================================
  _buildGoalResponse(g) {
    return {
      id: g.id,
      name: g.name,
      target_amount: g.target_amount,
      current_amount: g.current_amount,
      deadline: g.deadline || null,
      created_at: g.created_at,
    };
  },

  async getGoals() {
    const rows = this._queryAll("SELECT * FROM goals");
    return rows.map((g) => this._buildGoalResponse(g));
  },

  async getGoal(id) {
    const g = this._queryOne("SELECT * FROM goals WHERE id = ?", [id]);
    if (!g) throw new Error("Goal not found");
    return this._buildGoalResponse(g);
  },

  async createGoal(data) {
    const now = _now();
    this._exec(
      "INSERT INTO goals (name, target_amount, current_amount, deadline, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [data.name, data.target_amount, data.current_amount || 0, data.deadline || null, now, now],
    );
    const id = this._lastInsertId();
    const g = this._queryOne("SELECT * FROM goals WHERE id = ?", [id]);
    this._clearTombstone("goal", _syncEntityKey("goal", g));
    await this._persist();
    return this._buildGoalResponse(g);
  },

  async updateGoal(id, data) {
    const g = this._queryOne("SELECT * FROM goals WHERE id = ?", [id]);
    if (!g) throw new Error("Goal not found");

    const fields = [];
    const values = [];
    if (data.name !== undefined) {
      fields.push("name = ?");
      values.push(data.name);
    }
    if (data.target_amount !== undefined) {
      fields.push("target_amount = ?");
      values.push(data.target_amount);
    }
    if (data.current_amount !== undefined) {
      fields.push("current_amount = ?");
      values.push(data.current_amount);
    }
    if (data.deadline !== undefined) {
      fields.push("deadline = ?");
      values.push(data.deadline);
    }
    if (fields.length > 0) {
      fields.push("updated_at = ?");
      values.push(_now());
      values.push(id);
      this._exec(`UPDATE goals SET ${fields.join(", ")} WHERE id = ?`, values);
    }

    await this._persist();
    const updated = this._queryOne("SELECT * FROM goals WHERE id = ?", [id]);
    return this._buildGoalResponse(updated);
  },

  async deleteGoal(id) {
    const g = this._queryOne("SELECT id, name, target_amount, created_at FROM goals WHERE id = ?", [
      id,
    ]);
    if (!g) throw new Error("Goal not found");
    this._exec("DELETE FROM goals WHERE id = ?", [id]);
    this._recordTombstone("goal", _syncEntityKey("goal", g));
    await this._persist();
    return { detail: "Goal deleted" };
  },

  async contributeToGoal(id, amount) {
    const g = this._queryOne("SELECT * FROM goals WHERE id = ?", [id]);
    if (!g) throw new Error("Goal not found");
    this._exec(
      "UPDATE goals SET current_amount = current_amount + ?, updated_at = ? WHERE id = ?",
      [amount, _now(), id],
    );
    await this._persist();
    const updated = this._queryOne("SELECT * FROM goals WHERE id = ?", [id]);
    return this._buildGoalResponse(updated);
  },

  // ========================================================================
  // Budgets
  // ========================================================================
  _calculateBudgetSpending(budget) {
    const row = this._queryOne(
      `SELECT COALESCE(SUM(ABS(amount)), 0.0) as spent
       FROM transactions
       WHERE category_id = ?
         AND transaction_type = 'expense'
         AND excluded_from_expenses = 0
         AND date(date) >= ?
         AND date(date) <= ?`,
      [budget.category_id, budget.period_start, budget.period_end],
    );
    return row ? row.spent : 0;
  },

  _determineBudgetStatus(percentageUsed) {
    if (percentageUsed >= 100) return BUDGET_STATUS_EXCEEDED;
    if (percentageUsed >= BUDGET_WARNING_THRESHOLD * 100) return BUDGET_STATUS_WARNING;
    return BUDGET_STATUS_ON_TRACK;
  },

  _checkBudgetOverlap(categoryId, periodStart, periodEnd, excludeId = null) {
    let sql = `SELECT id FROM budgets
      WHERE category_id = ?
        AND period_start <= ?
        AND period_end >= ?`;
    const binds = [categoryId, periodEnd, periodStart];
    if (excludeId) {
      sql += " AND id != ?";
      binds.push(excludeId);
    }
    return this._queryOne(sql, binds) !== null;
  },

  _populateBudgetResponse(budget) {
    const cat = this._queryOne("SELECT name FROM categories WHERE id = ?", [budget.category_id]);
    const categoryName = cat ? cat.name : "Unknown";
    const spent = this._calculateBudgetSpending(budget);
    const remaining = Math.max(0, budget.limit_amount - spent);
    const pct = budget.limit_amount > 0 ? (spent / budget.limit_amount) * 100 : 0;
    const status = this._determineBudgetStatus(pct);

    return {
      id: budget.id,
      category_id: budget.category_id,
      category_name: categoryName,
      period_start: budget.period_start,
      period_end: budget.period_end,
      limit_amount: budget.limit_amount,
      spent_to_date: Math.round(spent * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      percentage_used: Math.round(pct * 100) / 100,
      status,
      created_at: budget.created_at,
    };
  },

  async getBudgets(activeOnly = true) {
    let sql = "SELECT * FROM budgets";
    const binds = [];
    if (activeOnly) {
      sql += " WHERE period_end >= ?";
      binds.push(_todayISO());
    }
    sql += " ORDER BY period_start DESC";
    const rows = this._queryAll(sql, binds);
    return rows.map((b) => this._populateBudgetResponse(b));
  },

  async getBudget(id) {
    const b = this._queryOne("SELECT * FROM budgets WHERE id = ?", [id]);
    if (!b) throw new Error("Budget not found");
    return this._populateBudgetResponse(b);
  },

  async createBudget(data) {
    const cat = this._queryOne("SELECT id FROM categories WHERE id = ?", [data.category_id]);
    if (!cat) throw new Error("Category not found");

    if (data.period_end <= data.period_start) {
      throw new Error("Period end must be after period start");
    }

    if (this._checkBudgetOverlap(data.category_id, data.period_start, data.period_end)) {
      throw new Error("A budget already exists for this category in the overlapping period");
    }

    const now = _now();
    this._exec(
      "INSERT INTO budgets (category_id, period_start, period_end, limit_amount, created_at) VALUES (?,?,?,?,?)",
      [data.category_id, data.period_start, data.period_end, data.limit_amount, now],
    );
    const id = this._lastInsertId();
    await this._persist();
    const b = this._queryOne("SELECT * FROM budgets WHERE id = ?", [id]);
    return this._populateBudgetResponse(b);
  },

  async updateBudget(id, data) {
    const b = this._queryOne("SELECT * FROM budgets WHERE id = ?", [id]);
    if (!b) throw new Error("Budget not found");

    const newStart = data.period_start ?? b.period_start;
    const newEnd = data.period_end ?? b.period_end;

    if (newEnd <= newStart) {
      throw new Error("Period end must be after period start");
    }

    if (data.period_start !== undefined || data.period_end !== undefined) {
      if (this._checkBudgetOverlap(b.category_id, newStart, newEnd, id)) {
        throw new Error("A budget already exists for this category in the overlapping period");
      }
    }

    const fields = [];
    const values = [];
    if (data.period_start !== undefined) {
      fields.push("period_start = ?");
      values.push(data.period_start);
    }
    if (data.period_end !== undefined) {
      fields.push("period_end = ?");
      values.push(data.period_end);
    }
    if (data.limit_amount !== undefined) {
      fields.push("limit_amount = ?");
      values.push(data.limit_amount);
    }
    if (fields.length > 0) {
      fields.push("updated_at = ?");
      values.push(_now());
      values.push(id);
      this._exec(`UPDATE budgets SET ${fields.join(", ")} WHERE id = ?`, values);
    }

    await this._persist();
    const updated = this._queryOne("SELECT * FROM budgets WHERE id = ?", [id]);
    return this._populateBudgetResponse(updated);
  },

  async deleteBudget(id) {
    const b = this._queryOne("SELECT id FROM budgets WHERE id = ?", [id]);
    if (!b) throw new Error("Budget not found");
    this._exec("DELETE FROM budgets WHERE id = ?", [id]);
    await this._persist();
    return { detail: "Budget deleted" };
  },

  // ========================================================================
  // Reports
  // ========================================================================
  async getSpendingReport(params = {}) {
    const today = _todayISO();
    const endDate = params.end_date || today;
    let startDate = params.start_date;
    if (!startDate) {
      const d = new Date();
      d.setMonth(d.getMonth() - DEFAULT_REPORT_MONTHS);
      startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    const baseFilter = [
      "transaction_type = 'expense'",
      "excluded_from_expenses = 0",
      "date(date) >= ?",
      "date(date) <= ?",
    ];
    const filterBinds = [startDate, endDate];

    if (params.account_id) {
      const familyIds = this._getAccountFamily(params.account_id);
      baseFilter.push(`account_id IN (${familyIds.map(() => "?").join(",")})`);
      filterBinds.push(...familyIds);
    }

    if (params.tag_ids && params.tag_ids.length > 0) {
      const tagPlaceholders = params.tag_ids.map(() => "?").join(",");
      baseFilter.push(
        `id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${tagPlaceholders}))`,
      );
      filterBinds.push(...params.tag_ids);
    }

    const where = baseFilter.join(" AND ");

    // By category
    const categoryRows = this._queryAll(
      `SELECT t.category_id,
              COALESCE(c.name, 'Other') as category_name,
              SUM(ABS(t.amount)) as total_amount,
              COUNT(t.id) as transaction_count
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE ${where}
       GROUP BY t.category_id
       ORDER BY SUM(ABS(t.amount)) DESC`,
      filterBinds,
    );

    const byCategory = categoryRows.map((r) => ({
      category_id: r.category_id || null,
      category_name: r.category_name,
      total_amount: Math.round(r.total_amount * 100) / 100,
      transaction_count: r.transaction_count,
    }));

    // Monthly trend
    const monthRows = this._queryAll(
      `SELECT strftime('%Y-%m', date) as month,
              SUM(ABS(amount)) as total_amount,
              COUNT(id) as transaction_count
       FROM transactions
       WHERE ${where}
       GROUP BY month
       ORDER BY month`,
      filterBinds,
    );

    const monthlyTrend = monthRows.map((r) => ({
      month: r.month,
      total_amount: Math.round(r.total_amount * 100) / 100,
      transaction_count: r.transaction_count,
    }));

    const totalSpent = byCategory.reduce((s, c) => s + c.total_amount, 0);
    const totalTransactions = byCategory.reduce((s, c) => s + c.transaction_count, 0);

    return {
      start_date: startDate,
      end_date: endDate,
      by_category: byCategory,
      monthly_trend: monthlyTrend,
      total_spent: Math.round(totalSpent * 100) / 100,
      total_transactions: totalTransactions,
    };
  },

  // ========================================================================
  // Chat history
  // ========================================================================
  async getChatHistory(chatId) {
    if (chatId) {
      const rows = this._queryAll(
        "SELECT role, content, timestamp FROM conversations WHERE chat_id = ? ORDER BY id ASC LIMIT 100",
        [chatId],
      );
      return { chat_id: chatId, history: rows };
    }
    // No chatId: return most recent session
    const latestChat = this._queryOne("SELECT chat_id FROM conversations ORDER BY id DESC LIMIT 1");
    if (!latestChat) return { chat_id: null, history: [] };

    const rows = this._queryAll(
      "SELECT role, content, timestamp FROM conversations WHERE chat_id = ? ORDER BY id ASC LIMIT 100",
      [latestChat.chat_id],
    );
    return { chat_id: latestChat.chat_id, history: rows };
  },

  async clearChatHistory(chatId) {
    if (chatId) {
      this._exec("DELETE FROM conversations WHERE chat_id = ?", [chatId]);
    } else {
      this._exec("DELETE FROM conversations");
    }
    await this._persist();
    return { message: "Chat history cleared" };
  },

  async listChatSessions() {
    const chats = this._queryAll(
      `SELECT chat_id,
              COUNT(id) as message_count,
              MIN(timestamp) as started_at,
              MAX(timestamp) as last_message_at
       FROM conversations
       GROUP BY chat_id
       ORDER BY MAX(timestamp) DESC`,
    );

    const sessions = chats.map((c) => {
      const firstMsg = this._queryOne(
        "SELECT content FROM conversations WHERE chat_id = ? AND role = 'user' ORDER BY id ASC LIMIT 1",
        [c.chat_id],
      );
      return {
        chat_id: c.chat_id,
        preview: firstMsg ? firstMsg.content.substring(0, 80) : "",
        message_count: c.message_count,
        started_at: c.started_at,
        last_message_at: c.last_message_at,
      };
    });
    return { sessions };
  },

  async saveChatMessage(chatId, role, content) {
    const now = _now();
    this._exec("INSERT INTO conversations (chat_id, role, content, timestamp) VALUES (?,?,?,?)", [
      chatId,
      role,
      content,
      now,
    ]);
    await this._persist();
  },

  // ========================================================================
  // Processed Gmail Messages
  // ========================================================================
  getProcessedGmailIds(gmailIds) {
    if (!gmailIds || gmailIds.length === 0) return new Set();
    const placeholders = gmailIds.map(() => "?").join(",");
    const rows = this._queryAll(
      `SELECT gmail_message_id FROM processed_gmail_messages WHERE gmail_message_id IN (${placeholders})`,
      gmailIds,
    );
    return new Set(rows.map((r) => r.gmail_message_id));
  },

  async saveProcessedGmailIds(gmailIds) {
    if (!gmailIds || gmailIds.length === 0) return;
    const existing = this.getProcessedGmailIds(gmailIds);
    const newIds = gmailIds.filter((id) => !existing.has(id));
    for (const id of newIds) {
      this._exec("INSERT OR IGNORE INTO processed_gmail_messages (gmail_message_id) VALUES (?)", [
        id,
      ]);
    }
    await this._persist();
  },

  /**
   * Remove processed_gmail_messages entries whose transactions have been deleted.
   * Called before each sync so that deleted transactions can be re-imported.
   * Returns the number of stale entries removed.
   */
  async cleanupOrphanedGmailIds() {
    this._exec(`
      DELETE FROM processed_gmail_messages
      WHERE gmail_message_id NOT IN (
        SELECT gmail_message_id FROM transactions WHERE gmail_message_id IS NOT NULL
      )
    `);
    await this._persist();
  },

  /**
   * Remove only the tombstoned entries (deleted = 1) from processed_gmail_messages.
   * After this runs, previously deleted Gmail emails are no longer filtered at Layer 1
   * and can be re-imported on the next sync. Live (non-deleted) processed IDs are kept.
   */
  async clearDeletedGmailTombstones() {
    this._exec("DELETE FROM processed_gmail_messages WHERE deleted = 1");
    await this._persist();
  },

  // ========================================================================
  // Export
  // ========================================================================
  async exportTransactionsCSV(params = {}) {
    let sql = `SELECT t.*, c.name as category_name, a.name as account_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       WHERE 1=1`;
    const binds = [];

    if (params.start_date) {
      sql += " AND date(t.date) >= ?";
      binds.push(params.start_date);
    }
    if (params.end_date) {
      sql += " AND date(t.date) <= ?";
      binds.push(params.end_date);
    }
    if (params.account_id) {
      const familyIds = this._getAccountFamily(params.account_id);
      sql += ` AND t.account_id IN (${familyIds.map(() => "?").join(",")})`;
      binds.push(...familyIds);
    }
    if (params.category_id) {
      sql += " AND t.category_id = ?";
      binds.push(params.category_id);
    }
    if (params.tag_ids && params.tag_ids.length > 0) {
      const tagPlaceholders = params.tag_ids.map(() => "?").join(",");
      sql += ` AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${tagPlaceholders}))`;
      binds.push(...params.tag_ids);
    }
    sql += " ORDER BY t.date DESC";

    const rows = this._queryAll(sql, binds);

    const lines = ["Date,Description,Amount,Type,Category,Account,Merchant,Tags"];
    for (const r of rows) {
      const date = r.date ? r.date.split(" ")[0] : "";
      const desc = (r.description || "").replace(/"/g, '""');
      const cat = r.category_name || "";
      const acct = r.account_name || "";
      const merchant = (r.merchant_name || "").replace(/"/g, '""');
      const tags = this._getTagsForTx(r.id)
        .map((t) => `#${t.name}`)
        .join(" ");
      lines.push(
        `"${date}","${desc}",${r.amount},"${r.transaction_type || ""}","${cat}","${acct}","${merchant}","${tags}"`,
      );
    }
    return lines.join("\n");
  },

  async exportDatabase() {
    const data = this._db.export();
    return new Uint8Array(data);
  },

  async importDatabase(buffer) {
    const SQL = await window.initSqlJs({
      locateFile: (file) => `/js/${file}`,
    });
    this._db = new SQL.Database(new Uint8Array(buffer));
    this._exec("PRAGMA foreign_keys = ON");
    // A restored binary backup may predate the current schema. Apply the canonical DDL
    // (CREATE IF NOT EXISTS adds any missing tables/indexes), run the ordered migration
    // runner to upgrade existing tables, then re-seed defaults so the restored DB matches
    // a freshly-initialised one.
    this._exec(SCHEMA_SQL);
    this._runMigrations();
    // Index on the migration-added `deleted` column — created here rather than in
    // SCHEMA_SQL (which runs before the column exists on a legacy binary) and after the
    // runner (which is skipped when the binary is already at the latest user_version).
    this._exec(
      "CREATE INDEX IF NOT EXISTS ix_processed_gmail_deleted ON processed_gmail_messages(deleted)",
    );
    this._seedCategories();
    this._seedTags();
    await this._persist();
  },

  /**
   * Populate the database with a realistic sample dataset for manual UI testing and E2E
   * fixtures — no Gmail connection required. Every row is created through the public CRUD
   * methods so it passes the same validation and sync instrumentation as real user data.
   * All dates are relative to today so the data always lands in the current and recent
   * budget/report periods. Refuses to run on a non-empty database to avoid duplicate-key
   * collisions. Returns a summary of how many rows were created.
   */
  async loadSampleData() {
    const existing = this._queryOne("SELECT COUNT(*) AS c FROM accounts");
    if (existing && existing.c > 0) {
      throw new Error("Sample data can only be loaded into an empty database.");
    }

    const cats = await this.getCategories();
    const catId = (name) => {
      const c = cats.find((x) => x.name === name);
      if (!c) throw new Error(`Seed category '${name}' missing`);
      return c.id;
    };

    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const daysAgo = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return iso(d);
    };
    const monthStart = iso(new Date(today.getFullYear(), today.getMonth(), 1));
    const monthEnd = iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    const monthsFromNow = (n) => {
      const d = new Date(today);
      d.setMonth(d.getMonth() + n);
      return iso(d);
    };

    // --- Accounts (incl. a credit card and a merged hierarchy) ---
    const savings = await this.createAccount({
      name: "HDFC Savings",
      balance: 85000,
      account_type: "checking",
      account_identifier: "HDFC-XXXX1234",
    });
    const salary = await this.createAccount({
      name: "ICICI Salary",
      balance: 120000,
      account_type: "checking",
      account_identifier: "ICICI-XXXX5678",
    });
    const card = await this.createAccount({
      name: "HDFC Credit Card",
      balance: 0,
      account_type: "credit",
      account_identifier: "HDFC-CC-XXXX9012",
    });
    await this.updateAccount(card.id, { billing_cycle_start_day: 5 });
    await this.createAccount({ name: "Cash Wallet", balance: 5000, account_type: "cash" });
    // A duplicate statement account merged under HDFC Savings to exercise the hierarchy UI.
    const oldHdfc = await this.createAccount({
      name: "HDFC Bank (old statement)",
      balance: 0,
      account_type: "checking",
      account_identifier: "HDFC-OLD-1234",
    });
    await this.mergeAccounts(oldHdfc.id, savings.id);

    // --- Merchants (UPI ids + extra aliases) ---
    const mkMerchant = async (data, aliases = []) => {
      const m = await this.createMerchant(data);
      for (const a of aliases) this._ensureMerchantAlias(m.id, m.merchant_key, a);
      return m;
    };
    await mkMerchant(
      {
        merchant_name: "Swiggy",
        merchant_upi_id: "swiggy@hdfcbank",
        category_id: catId("Food & Dining"),
      },
      ["swiggy instamart", "bundl technologies"],
    );
    await mkMerchant(
      {
        merchant_name: "Zomato",
        merchant_upi_id: "zomato@paytm",
        category_id: catId("Food & Dining"),
      },
      ["eternal ltd"],
    );
    await mkMerchant(
      {
        merchant_name: "Blinkit",
        merchant_upi_id: "blinkit@icici",
        category_id: catId("Groceries"),
      },
      ["grofers"],
    );
    await mkMerchant({ merchant_name: "Amazon", category_id: catId("Shopping") }, [
      "amazon pay",
      "amazon india",
    ]);
    await mkMerchant({ merchant_name: "Netflix", category_id: catId("Entertainment") });
    await mkMerchant(
      {
        merchant_name: "Uber",
        merchant_upi_id: "uber@axisbank",
        category_id: catId("Transportation"),
      },
      ["uber india"],
    );
    await mkMerchant({ merchant_name: "Airtel", category_id: catId("Bills & Utilities") }, [
      "bharti airtel",
    ]);

    // --- Tags ---
    const tagWork = await this.createTag("work");
    const tagReimbursable = await this.createTag("reimbursable");
    const tagFamily = await this.createTag("family");

    // --- Transactions ---
    // createTransaction only persists the base columns, so flags/Gmail ids are applied with
    // a follow-up UPDATE on the returned row.
    const addTx = async (opts) => {
      const tx = await this.createTransaction(opts);
      const sets = [];
      const vals = [];
      if (opts.excluded_from_expenses) sets.push("excluded_from_expenses = 1");
      if (opts.excluded_from_income) sets.push("excluded_from_income = 1");
      if (opts.gmail_message_id) {
        sets.push("gmail_message_id = ?");
        vals.push(opts.gmail_message_id);
      }
      if (sets.length) {
        vals.push(tx.id);
        this._exec(`UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`, vals);
        await this._persist();
      }
      return tx;
    };

    // Three recent monthly cycles anchored ~70/40/10 days ago.
    const anchors = [70, 40, 10];
    for (let idx = 0; idx < anchors.length; idx++) {
      const a = anchors[idx];
      await addTx({
        date: daysAgo(a + 5),
        amount: 95000,
        description: "Monthly salary",
        transaction_type: "income",
        account_id: salary.id,
        category_id: catId("Income"),
      });
      await addTx({
        date: daysAgo(a + 4),
        amount: 25000,
        description: "House rent",
        transaction_type: "expense",
        account_id: savings.id,
        category_id: catId("Bills & Utilities"),
      });
      // Gmail-style imports (UPI id auto-maps to the merchant's category).
      await addTx({
        date: daysAgo(a + 3),
        amount: 2150,
        transaction_type: "expense",
        account_id: savings.id,
        merchant_upi_id: "blinkit@icici",
        merchant_name: "Blinkit",
        transaction_id: `gmail_blinkit_${idx}`,
        gmail_message_id: `blinkit_${idx}`,
      });
      await addTx({
        date: daysAgo(a + 2),
        amount: 540,
        transaction_type: "expense",
        account_id: card.id,
        merchant_upi_id: "swiggy@hdfcbank",
        merchant_name: "Swiggy",
        transaction_id: `gmail_swiggy_${idx}`,
        gmail_message_id: `swiggy_${idx}`,
      });
      await addTx({
        date: daysAgo(a + 2),
        amount: 380,
        transaction_type: "expense",
        account_id: card.id,
        merchant_upi_id: "zomato@paytm",
        merchant_name: "Zomato",
        transaction_id: `gmail_zomato_${idx}`,
        gmail_message_id: `zomato_${idx}`,
      });
      await addTx({
        date: daysAgo(a + 1),
        amount: 260,
        transaction_type: "expense",
        account_id: savings.id,
        merchant_upi_id: "uber@axisbank",
        merchant_name: "Uber",
        transaction_id: `gmail_uber_${idx}`,
        gmail_message_id: `uber_${idx}`,
      });
      await addTx({
        date: daysAgo(a),
        amount: 1499,
        description: "Amazon order",
        transaction_type: "expense",
        account_id: card.id,
        merchant_name: "Amazon",
      });
      await addTx({
        date: daysAgo(a),
        amount: 649,
        description: "Netflix subscription",
        transaction_type: "expense",
        account_id: card.id,
        merchant_name: "Netflix",
        category_id: catId("Subscription"),
      });
      await addTx({
        date: daysAgo(a),
        amount: 599,
        description: "Airtel mobile",
        transaction_type: "expense",
        account_id: savings.id,
        merchant_name: "Airtel",
      });
      await addTx({
        date: daysAgo(a),
        amount: 1200,
        description: "Gym membership",
        transaction_type: "expense",
        account_id: savings.id,
        category_id: catId("Health & Fitness"),
        tag_ids: [tagFamily.id],
      });
      await addTx({
        date: daysAgo(a + 5),
        amount: 5000,
        description: "Mutual fund SIP",
        transaction_type: "expense",
        account_id: salary.id,
        category_id: catId("Investment"),
      });
      // Credit-card payment and ATM withdrawal are excluded from expense totals.
      await addTx({
        date: daysAgo(a),
        amount: 8000,
        description: "Credit card payment",
        transaction_type: "expense",
        account_id: savings.id,
        category_id: catId("Transfer"),
        excluded_from_expenses: true,
      });
      await addTx({
        date: daysAgo(a + 1),
        amount: 3000,
        description: "ATM withdrawal",
        transaction_type: "expense",
        account_id: savings.id,
        category_id: catId("Withdrawal"),
      });
      await addTx({
        date: daysAgo(a + 1),
        amount: 850,
        description: "Team lunch",
        transaction_type: "expense",
        account_id: card.id,
        category_id: catId("Food & Dining"),
        tag_ids: [tagWork.id, tagReimbursable.id],
      });
    }

    // A few one-off transactions for variety across more categories.
    // Current-month rent — always visible with the default month filter on the transactions screen.
    await addTx({
      date: monthStart,
      amount: 25000,
      description: "House rent",
      transaction_type: "expense",
      account_id: savings.id,
      category_id: catId("Bills & Utilities"),
    });
    await addTx({
      date: daysAgo(20),
      amount: 1250,
      description: "Savings account interest",
      transaction_type: "income",
      account_id: savings.id,
      category_id: catId("Income"),
    });
    await addTx({
      date: daysAgo(8),
      amount: 2999,
      description: "Online course",
      transaction_type: "expense",
      account_id: card.id,
      category_id: catId("Education"),
    });
    await addTx({
      date: daysAgo(6),
      amount: 700,
      description: "Salon visit",
      transaction_type: "expense",
      account_id: savings.id,
      category_id: catId("Personal Care"),
    });
    await addTx({
      date: daysAgo(4),
      amount: 350,
      description: "Movie tickets",
      transaction_type: "expense",
      account_id: card.id,
      category_id: catId("Entertainment"),
      tag_ids: [tagFamily.id],
    });
    await addTx({
      date: daysAgo(3),
      amount: 1100,
      description: "Birthday gift",
      transaction_type: "expense",
      account_id: savings.id,
      category_id: catId("Gift"),
    });
    await addTx({
      date: daysAgo(2),
      amount: 500,
      description: "NGO donation",
      transaction_type: "expense",
      account_id: savings.id,
      category_id: catId("Charity"),
    });
    await addTx({
      date: daysAgo(1),
      amount: 10000,
      description: "Transfer to savings",
      transaction_type: "income",
      account_id: savings.id,
      category_id: catId("Transfer"),
      excluded_from_income: true,
    });

    // --- Budgets (current month) ---
    await this.createBudget({
      category_id: catId("Food & Dining"),
      period_start: monthStart,
      period_end: monthEnd,
      limit_amount: 8000,
    });
    await this.createBudget({
      category_id: catId("Groceries"),
      period_start: monthStart,
      period_end: monthEnd,
      limit_amount: 6000,
    });
    await this.createBudget({
      category_id: catId("Shopping"),
      period_start: monthStart,
      period_end: monthEnd,
      limit_amount: 5000,
    });
    await this.createBudget({
      category_id: catId("Transportation"),
      period_start: monthStart,
      period_end: monthEnd,
      limit_amount: 3000,
    });

    // --- Goals ---
    await this.createGoal({
      name: "Emergency Fund",
      target_amount: 300000,
      current_amount: 120000,
      deadline: monthsFromNow(12),
    });
    await this.createGoal({
      name: "Goa Vacation",
      target_amount: 80000,
      current_amount: 35000,
      deadline: monthsFromNow(6),
    });
    await this.createGoal({
      name: "New Laptop",
      target_amount: 120000,
      current_amount: 60000,
      deadline: monthsFromNow(3),
    });

    await this._persist();
    return {
      accounts: this._queryOne("SELECT COUNT(*) AS c FROM accounts").c,
      transactions: this._queryOne("SELECT COUNT(*) AS c FROM transactions").c,
      merchants: this._queryOne("SELECT COUNT(*) AS c FROM merchants").c,
      budgets: this._queryOne("SELECT COUNT(*) AS c FROM budgets").c,
      goals: this._queryOne("SELECT COUNT(*) AS c FROM goals").c,
      tags: this._queryOne("SELECT COUNT(*) AS c FROM tags").c,
    };
  },

  // Record that an entity was deleted so the deletion propagates to other devices on
  // the next Drive merge instead of being resurrected by their older snapshot.
  _recordTombstone(entityType, key) {
    if (!key) return;
    this._exec(
      "INSERT OR REPLACE INTO sync_tombstones (entity_type, entity_key, deleted_at) VALUES (?,?,?)",
      [entityType, key, _now()],
    );
  },

  // Drop any tombstone for an entity that has just been (re-)created locally so a stale
  // deletion does not suppress it during the next merge.
  _clearTombstone(entityType, key) {
    if (!key) return;
    this._exec("DELETE FROM sync_tombstones WHERE entity_type = ? AND entity_key = ?", [
      entityType,
      key,
    ]);
  },

  async exportAsJSON() {
    // A complete snapshot of every persisted table. `SELECT *` reflects the live
    // schema, so dropped columns (e.g. conversations.user_id) are naturally excluded
    // and new tables (merchant_aliases) are included.
    const envelope = {
      version: 1,
      schema_version: SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      device_id: _getOrCreateDeviceId(),
      tables: {},
    };
    for (const table of SYNC_TABLES) {
      envelope.tables[table] = this._queryAll(`SELECT * FROM ${table}`);
    }
    return envelope;
  },

  /**
   * Merge a Drive snapshot into the local database with multi-device-safe semantics:
   *   - natural-key UNION so the same real-world record is never duplicated,
   *   - last-writer-wins by `updated_at` so the most recent edit on any device is kept,
   *   - delete tombstones so a deletion on one device propagates instead of being
   *     resurrected by another device's older snapshot.
   * The local database is never blindly cleared, so local-only changes made since the
   * last upload survive the merge. Returns { inserted, updated, deleted, skipped } counts
   * keyed by table.
   */
  async mergeFromJSON(envelope) {
    if (!envelope || envelope.schema_version !== SCHEMA_VERSION) {
      throw new Error(
        "Drive backup uses a different schema version. Please delete and re-create your Drive backup.",
      );
    }
    if (!envelope.tables || typeof envelope.tables !== "object") {
      throw new Error("Drive backup is malformed (no tables present).");
    }
    // Normalise to a complete table set. Under union semantics a missing table simply
    // means "no remote rows to merge" (a safe no-op), so we default it to [] rather than
    // risk a destructive interpretation.
    const tables = {};
    for (const t of SYNC_TABLES) {
      const rows = envelope.tables[t];
      tables[t] = Array.isArray(rows) ? rows : [];
    }

    const stats = { inserted: {}, updated: {}, deleted: {}, skipped: {} };
    for (const t of SYNC_TABLES) {
      stats.inserted[t] = 0;
      stats.updated[t] = 0;
      stats.deleted[t] = 0;
      stats.skipped[t] = 0;
    }

    try {
      this._exec("BEGIN TRANSACTION");
      // FK enforcement is disabled during the merge so parent/child insert order and the
      // accounts self-reference (merged_into_id) cannot trip a constraint mid-merge.
      this._exec("PRAGMA foreign_keys = OFF");

      const tombMap = this._unifyTombstones(tables.sync_tombstones);
      this._applyTombstonesToLocal(tombMap, stats);

      // A remote row is suppressed only when a tombstone is at least as new as that row.
      const isTomb = (type, key, updatedMs) => {
        if (!key) return false;
        const del = tombMap.get(`${type}\u0000${key}`);
        return del !== undefined && del >= updatedMs;
      };

      // Parents first so children can remap their foreign keys to local ids.
      const catMap = this._mergeCategories(tables.categories, isTomb, stats);
      const accMap = this._mergeAccounts(tables.accounts, isTomb, stats);
      const merMap = this._mergeMerchants(tables.merchants, catMap, isTomb, stats);
      this._mergeMerchantAliases(tables.merchant_aliases, merMap, stats);
      const tagMap = this._mergeTags(tables.tags, isTomb, stats);

      const txMap = this._mergeTransactions(
        tables.transactions,
        accMap,
        catMap,
        merMap,
        isTomb,
        stats,
      );

      this._mergeRecurring(tables.recurring_patterns, accMap, catMap, stats);
      this._mergeBudgets(tables.budgets, catMap, stats);
      this._mergeGoals(tables.goals, isTomb, stats);
      this._mergeFollowUps(tables.transaction_follow_ups, txMap, isTomb, stats);
      this._mergeProcessedGmail(tables.processed_gmail_messages, stats);
      this._mergeTransactionTags(tables.transaction_tags, txMap, tagMap, stats);
      this._mergeConversations(tables.conversations, stats);

      this._normalizeSingleDefaultCategory();

      this._exec("PRAGMA foreign_keys = ON");
      this._exec("COMMIT");
      await this._persist();
      return stats;
    } catch (err) {
      try {
        this._exec("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      this._exec("PRAGMA foreign_keys = ON");
      throw err;
    }
  },

  // Union local + remote tombstones, persisting the newest deleted_at per key, and return
  // a Map "<entity_type>\u0000<entity_key>" -> deleted_at (ms since epoch) for the merge.
  _unifyTombstones(remoteRows) {
    const map = new Map();
    const add = (type, key, deletedAt) => {
      const k = `${type}\u0000${key}`;
      const ms = _ts(deletedAt);
      const prev = map.get(k);
      if (prev === undefined || ms > prev) map.set(k, ms);
    };
    for (const r of this._queryAll(
      "SELECT entity_type, entity_key, deleted_at FROM sync_tombstones",
    )) {
      add(r.entity_type, r.entity_key, r.deleted_at);
    }
    for (const r of remoteRows) {
      add(r.entity_type, r.entity_key, r.deleted_at);
      // Keep whichever deleted_at is newer (string compare is safe: every device writes
      // the same space-separated _now() format).
      this._exec(
        `INSERT INTO sync_tombstones (entity_type, entity_key, deleted_at) VALUES (?,?,?)
         ON CONFLICT(entity_type, entity_key)
         DO UPDATE SET deleted_at = excluded.deleted_at
         WHERE excluded.deleted_at > sync_tombstones.deleted_at`,
        [r.entity_type, r.entity_key, r.deleted_at],
      );
    }
    return map;
  },

  // Delete local rows that another device deleted (tombstone newer-or-equal to the local
  // row's last modification). Guards skip deletions that would orphan referenced data.
  _applyTombstonesToLocal(tombMap, stats) {
    const tombFor = (type, key) => (key ? tombMap.get(`${type}\u0000${key}`) : undefined);

    for (const row of this._queryAll("SELECT id, transaction_id, updated_at FROM transactions")) {
      const del = tombFor("transaction", _syncEntityKey("transaction", row));
      if (del === undefined || del < _ts(row.updated_at)) continue;
      this._exec("DELETE FROM transaction_tags WHERE transaction_id = ?", [row.id]);
      this._exec("DELETE FROM transactions WHERE id = ?", [row.id]);
      stats.deleted.transactions++;
    }

    for (const row of this._queryAll(
      "SELECT id, name, account_type, account_identifier, updated_at FROM accounts",
    )) {
      const del = tombFor("account", _syncEntityKey("account", row));
      if (del === undefined || del < _ts(row.updated_at)) continue;
      // Never orphan transactions: keep the account if it is still referenced locally.
      if (
        this._queryOne("SELECT 1 AS x FROM transactions WHERE account_id = ? LIMIT 1", [row.id])
      ) {
        continue;
      }
      this._exec("UPDATE accounts SET merged_into_id = NULL WHERE merged_into_id = ?", [row.id]);
      this._exec("DELETE FROM accounts WHERE id = ?", [row.id]);
      stats.deleted.accounts++;
    }

    for (const row of this._queryAll("SELECT id, name, updated_at FROM categories")) {
      const del = tombFor("category", _syncEntityKey("category", row));
      if (del === undefined || del < _ts(row.updated_at)) continue;
      const refs = this._queryOne(
        `SELECT 1 AS x FROM transactions WHERE category_id = ?
         UNION ALL SELECT 1 FROM merchants WHERE category_id = ?
         UNION ALL SELECT 1 FROM budgets WHERE category_id = ?
         UNION ALL SELECT 1 FROM recurring_patterns WHERE category_id = ?
         LIMIT 1`,
        [row.id, row.id, row.id, row.id],
      );
      if (refs) continue;
      this._exec("DELETE FROM categories WHERE id = ?", [row.id]);
      stats.deleted.categories++;
    }

    for (const row of this._queryAll("SELECT id, merchant_key, last_updated FROM merchants")) {
      const del = tombFor("merchant", _syncEntityKey("merchant", row));
      if (del === undefined || del < _ts(row.last_updated)) continue;
      this._exec("UPDATE transactions SET merchant_id = NULL WHERE merchant_id = ?", [row.id]);
      this._exec("DELETE FROM merchant_aliases WHERE merchant_id = ?", [row.id]);
      this._exec("DELETE FROM merchants WHERE id = ?", [row.id]);
      stats.deleted.merchants++;
    }

    for (const row of this._queryAll("SELECT id, name, created_at FROM tags")) {
      const del = tombFor("tag", _syncEntityKey("tag", row));
      if (del === undefined || del < _ts(row.created_at)) continue;
      this._exec("DELETE FROM transaction_tags WHERE tag_id = ?", [row.id]);
      this._exec("DELETE FROM tags WHERE id = ?", [row.id]);
      stats.deleted.tags++;
    }

    for (const row of this._queryAll(
      "SELECT id, name, target_amount, created_at, updated_at FROM goals",
    )) {
      const del = tombFor("goal", _syncEntityKey("goal", row));
      if (del === undefined || del < _ts(row.updated_at)) continue;
      this._exec("DELETE FROM goals WHERE id = ?", [row.id]);
      stats.deleted.goals++;
    }

    // Follow-ups: keyed by the parent transaction's stable transaction_id (1:1 relation).
    for (const row of this._queryAll(
      `SELECT f.id AS id, f.updated_at AS updated_at, t.transaction_id AS tx_key
       FROM transaction_follow_ups f
       LEFT JOIN transactions t ON t.id = f.transaction_id`,
    )) {
      const del = tombFor("follow_up", row.tx_key);
      if (del === undefined || del < _ts(row.updated_at)) continue;
      this._exec("DELETE FROM transaction_follow_ups WHERE id = ?", [row.id]);
      stats.deleted.transaction_follow_ups++;
    }
  },

  // Match by category name; last-writer-wins on description/is_default. Returns remote→local id map.
  _mergeCategories(rows, isTomb, stats) {
    const idMap = new Map();
    for (const row of rows) {
      if (isTomb("category", _syncEntityKey("category", row), _ts(row.updated_at))) continue;
      const existing = this._queryOne("SELECT id, updated_at FROM categories WHERE name = ?", [
        row.name,
      ]);
      if (existing) {
        idMap.set(row.id, existing.id);
        if (_ts(row.updated_at) > _ts(existing.updated_at)) {
          this._exec(
            "UPDATE categories SET description = ?, is_default = ?, updated_at = ? WHERE id = ?",
            [row.description ?? null, row.is_default ?? 0, row.updated_at ?? _now(), existing.id],
          );
          stats.updated.categories++;
        }
      } else {
        this._exec(
          "INSERT INTO categories (name, description, is_default, created_at, updated_at) VALUES (?,?,?,?,?)",
          [
            row.name,
            row.description ?? null,
            row.is_default ?? 0,
            row.created_at ?? _now(),
            row.updated_at ?? _now(),
          ],
        );
        idMap.set(row.id, this._lastInsertId());
        stats.inserted.categories++;
      }
    }
    return idMap;
  },

  // Match by account_identifier (else name+type); LWW on fields, with a second pass that
  // remaps the merged_into self-reference once every account has a local id.
  _mergeAccounts(rows, isTomb, stats) {
    const idMap = new Map();
    const pending = [];
    for (const row of rows) {
      if (isTomb("account", _syncEntityKey("account", row), _ts(row.updated_at))) continue;
      let existing = null;
      if (row.account_identifier) {
        existing = this._queryOne(
          "SELECT id, updated_at FROM accounts WHERE account_identifier = ?",
          [row.account_identifier],
        );
      }
      if (!existing) {
        existing = this._queryOne(
          "SELECT id, updated_at FROM accounts WHERE account_identifier IS NULL AND name = ? AND IFNULL(account_type,'') = IFNULL(?,'')",
          [row.name, row.account_type ?? null],
        );
      }
      if (existing) {
        idMap.set(row.id, existing.id);
        const remoteWon = _ts(row.updated_at) > _ts(existing.updated_at);
        if (remoteWon) {
          this._exec(
            `UPDATE accounts SET name = ?, balance = ?, account_type = ?, account_identifier = ?,
               balance_updated_at = ?, is_active = ?, billing_cycle_start_day = ?, updated_at = ?
             WHERE id = ?`,
            [
              row.name,
              row.balance ?? 0,
              row.account_type ?? null,
              row.account_identifier ?? null,
              row.balance_updated_at ?? null,
              row.is_active ?? 1,
              row.billing_cycle_start_day ?? 1,
              row.updated_at ?? _now(),
              existing.id,
            ],
          );
          stats.updated.accounts++;
        }
        pending.push({
          localId: existing.id,
          remoteWon,
          remoteMergedInto: row.merged_into_id ?? null,
          mergedAt: row.merged_at ?? null,
        });
      } else {
        this._exec(
          `INSERT INTO accounts (name, balance, account_type, account_identifier, balance_updated_at,
             is_active, merged_into_id, merged_at, created_at, updated_at, billing_cycle_start_day)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            row.name,
            row.balance ?? 0,
            row.account_type ?? null,
            row.account_identifier ?? null,
            row.balance_updated_at ?? null,
            row.is_active ?? 1,
            null,
            null,
            row.created_at ?? _now(),
            row.updated_at ?? _now(),
            row.billing_cycle_start_day ?? 1,
          ],
        );
        const newId = this._lastInsertId();
        idMap.set(row.id, newId);
        stats.inserted.accounts++;
        pending.push({
          localId: newId,
          remoteWon: true,
          remoteMergedInto: row.merged_into_id ?? null,
          mergedAt: row.merged_at ?? null,
        });
      }
    }
    // Second pass: apply the merge relationship from the winning (remote) side.
    for (const p of pending) {
      if (!p.remoteWon) continue;
      const target = p.remoteMergedInto != null ? (idMap.get(p.remoteMergedInto) ?? null) : null;
      this._exec(
        "UPDATE accounts SET merged_into_id = ?, merged_at = ?, is_active = ? WHERE id = ?",
        [target, target != null ? p.mergedAt : null, target != null ? 0 : 1, p.localId],
      );
    }
    return idMap;
  },

  // Match by merchant_key (else merchant_upi_id); LWW on display/category. Returns id map.
  _mergeMerchants(rows, catMap, isTomb, stats) {
    const idMap = new Map();
    for (const row of rows) {
      if (isTomb("merchant", _syncEntityKey("merchant", row), _ts(row.last_updated))) continue;
      const localCat = row.category_id != null ? (catMap.get(row.category_id) ?? null) : null;
      let existing = this._queryOne(
        "SELECT id, last_updated FROM merchants WHERE merchant_key = ?",
        [row.merchant_key],
      );
      if (!existing && row.merchant_upi_id) {
        existing = this._queryOne(
          "SELECT id, last_updated FROM merchants WHERE merchant_upi_id = ?",
          [row.merchant_upi_id],
        );
      }
      if (existing) {
        idMap.set(row.id, existing.id);
        if (_ts(row.last_updated) > _ts(existing.last_updated)) {
          this._exec(
            `UPDATE merchants SET display_name = ?, merchant_upi_id = ?, category_id = ?,
               confidence_score = ?, last_updated = ? WHERE id = ?`,
            [
              row.display_name ?? null,
              row.merchant_upi_id ?? null,
              localCat,
              row.confidence_score ?? 1.0,
              row.last_updated ?? _now(),
              existing.id,
            ],
          );
          stats.updated.merchants++;
        }
      } else {
        this._exec(
          `INSERT INTO merchants (merchant_key, display_name, merchant_upi_id, category_id,
             confidence_score, created_at, last_updated) VALUES (?,?,?,?,?,?,?)`,
          [
            row.merchant_key,
            row.display_name ?? null,
            row.merchant_upi_id ?? null,
            localCat,
            row.confidence_score ?? 1.0,
            row.created_at ?? _now(),
            row.last_updated ?? _now(),
          ],
        );
        idMap.set(row.id, this._lastInsertId());
        stats.inserted.merchants++;
      }
    }
    return idMap;
  },

  // Union aliases by their globally-unique alias_norm; remap merchant_id to the local id.
  _mergeMerchantAliases(rows, merMap, stats) {
    for (const row of rows) {
      const localMerchant = merMap.get(row.merchant_id);
      if (localMerchant === undefined) continue;
      if (
        this._queryOne("SELECT 1 AS x FROM merchant_aliases WHERE alias_norm = ?", [row.alias_norm])
      ) {
        continue;
      }
      this._exec("INSERT INTO merchant_aliases (merchant_id, alias_norm) VALUES (?,?)", [
        localMerchant,
        row.alias_norm,
      ]);
      stats.inserted.merchant_aliases++;
    }
  },

  // Union tags by case-insensitive name. Tags have no updated_at, so this is insert-if-missing.
  _mergeTags(rows, isTomb, stats) {
    const idMap = new Map();
    for (const row of rows) {
      if (isTomb("tag", _syncEntityKey("tag", row), _ts(row.created_at))) continue;
      const existing = this._queryOne("SELECT id FROM tags WHERE name = ? COLLATE NOCASE", [
        row.name,
      ]);
      if (existing) {
        idMap.set(row.id, existing.id);
      } else {
        this._exec("INSERT INTO tags (name, created_at) VALUES (?,?)", [
          row.name,
          row.created_at ?? _now(),
        ]);
        idMap.set(row.id, this._lastInsertId());
        stats.inserted.tags++;
      }
    }
    return idMap;
  },

  // Match by transaction_id (legacy rows fall back to a composite key); LWW on all fields.
  _mergeTransactions(rows, accMap, catMap, merMap, isTomb, stats) {
    const idMap = new Map();
    for (const row of rows) {
      const txKey = row.transaction_id || null;
      if (txKey && isTomb("transaction", txKey, _ts(row.updated_at))) continue;
      const localAcc = accMap.get(row.account_id);
      if (localAcc === undefined) {
        stats.skipped.transactions++;
        continue;
      }
      const localCat = row.category_id != null ? (catMap.get(row.category_id) ?? null) : null;
      const localMer = row.merchant_id != null ? (merMap.get(row.merchant_id) ?? null) : null;

      let existing = null;
      if (txKey) {
        existing = this._queryOne(
          "SELECT id, updated_at FROM transactions WHERE transaction_id = ?",
          [txKey],
        );
      } else {
        existing = this._queryOne(
          `SELECT id, updated_at FROM transactions
           WHERE transaction_id IS NULL AND date = ? AND amount = ? AND account_id = ?
             AND IFNULL(description,'') = IFNULL(?,'')`,
          [row.date, row.amount, localAcc, row.description ?? null],
        );
      }

      if (existing) {
        idMap.set(row.id, existing.id);
        if (_ts(row.updated_at) > _ts(existing.updated_at)) {
          this._exec(
            `UPDATE transactions SET date = ?, amount = ?, description = ?, notes = ?,
               payment_reference = ?, merchant_upi_id = ?, merchant_name = ?, merchant_id = ?,
               category_id = ?, transaction_type = ?, account_id = ?, gmail_message_id = ?,
               is_recurring = ?, excluded_from_expenses = ?, excluded_from_income = ?, updated_at = ?
             WHERE id = ?`,
            [
              row.date,
              row.amount,
              row.description ?? null,
              row.notes ?? null,
              row.payment_reference ?? null,
              row.merchant_upi_id ?? null,
              row.merchant_name ?? null,
              localMer,
              localCat,
              row.transaction_type ?? null,
              localAcc,
              row.gmail_message_id ?? null,
              row.is_recurring ?? 0,
              row.excluded_from_expenses ?? 0,
              row.excluded_from_income ?? 0,
              row.updated_at ?? _now(),
              existing.id,
            ],
          );
          stats.updated.transactions++;
        }
      } else {
        this._exec(
          `INSERT INTO transactions (transaction_id, gmail_message_id, date, amount, description,
             notes, payment_reference, merchant_upi_id, merchant_name, merchant_id, category_id,
             transaction_type, account_id, created_at, updated_at, is_recurring,
             excluded_from_expenses, excluded_from_income)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            row.transaction_id ?? null,
            row.gmail_message_id ?? null,
            row.date,
            row.amount,
            row.description ?? null,
            row.notes ?? null,
            row.payment_reference ?? null,
            row.merchant_upi_id ?? null,
            row.merchant_name ?? null,
            localMer,
            localCat,
            row.transaction_type ?? null,
            localAcc,
            row.created_at ?? _now(),
            row.updated_at ?? _now(),
            row.is_recurring ?? 0,
            row.excluded_from_expenses ?? 0,
            row.excluded_from_income ?? 0,
          ],
        );
        idMap.set(row.id, this._lastInsertId());
        stats.inserted.transactions++;
      }
    }
    return idMap;
  },

  // Match by description_pattern + account; LWW. No delete-propagation (key depends on parent).
  _mergeRecurring(rows, accMap, catMap, stats) {
    for (const row of rows) {
      const localAcc = accMap.get(row.account_id);
      if (localAcc === undefined) {
        stats.skipped.recurring_patterns++;
        continue;
      }
      const localCat = row.category_id != null ? (catMap.get(row.category_id) ?? null) : null;
      const existing = this._queryOne(
        "SELECT id, updated_at FROM recurring_patterns WHERE description_pattern = ? AND account_id = ?",
        [row.description_pattern, localAcc],
      );
      if (existing) {
        if (_ts(row.updated_at) > _ts(existing.updated_at)) {
          this._exec(
            `UPDATE recurring_patterns SET amount = ?, frequency_days = ?, last_seen = ?,
               confidence = ?, category_id = ?, is_active = ?, next_due_date = ?,
               reminder_days_before = ?, is_reminder_enabled = ?, updated_at = ? WHERE id = ?`,
            [
              row.amount,
              row.frequency_days,
              row.last_seen,
              row.confidence ?? 0.8,
              localCat,
              row.is_active ?? 1,
              row.next_due_date ?? null,
              row.reminder_days_before ?? 3,
              row.is_reminder_enabled ?? 1,
              row.updated_at ?? _now(),
              existing.id,
            ],
          );
          stats.updated.recurring_patterns++;
        }
      } else {
        this._exec(
          `INSERT INTO recurring_patterns (description_pattern, amount, frequency_days, last_seen,
             confidence, category_id, account_id, is_active, created_at, updated_at, next_due_date,
             reminder_days_before, is_reminder_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            row.description_pattern,
            row.amount,
            row.frequency_days,
            row.last_seen,
            row.confidence ?? 0.8,
            localCat,
            localAcc,
            row.is_active ?? 1,
            row.created_at ?? _now(),
            row.updated_at ?? _now(),
            row.next_due_date ?? null,
            row.reminder_days_before ?? 3,
            row.is_reminder_enabled ?? 1,
          ],
        );
        stats.inserted.recurring_patterns++;
      }
    }
  },

  // Match by category + period; LWW on the limit. No delete-propagation (key depends on parent).
  _mergeBudgets(rows, catMap, stats) {
    for (const row of rows) {
      const localCat = catMap.get(row.category_id);
      if (localCat === undefined) {
        stats.skipped.budgets++;
        continue;
      }
      const existing = this._queryOne(
        "SELECT id, updated_at FROM budgets WHERE category_id = ? AND period_start = ? AND period_end = ?",
        [localCat, row.period_start, row.period_end],
      );
      if (existing) {
        if (_ts(row.updated_at) > _ts(existing.updated_at)) {
          this._exec("UPDATE budgets SET limit_amount = ?, updated_at = ? WHERE id = ?", [
            row.limit_amount,
            row.updated_at ?? _now(),
            existing.id,
          ]);
          stats.updated.budgets++;
        }
      } else {
        this._exec(
          "INSERT INTO budgets (category_id, period_start, period_end, limit_amount, created_at, updated_at) VALUES (?,?,?,?,?,?)",
          [
            localCat,
            row.period_start,
            row.period_end,
            row.limit_amount,
            row.created_at ?? _now(),
            row.updated_at ?? _now(),
          ],
        );
        stats.inserted.budgets++;
      }
    }
  },

  // Match by name + target + created_at; LWW on progress/deadline; delete-propagation supported.
  _mergeGoals(rows, isTomb, stats) {
    for (const row of rows) {
      if (isTomb("goal", _syncEntityKey("goal", row), _ts(row.updated_at))) continue;
      const existing = this._queryOne(
        "SELECT id, updated_at FROM goals WHERE name = ? AND target_amount = ? AND created_at = ?",
        [row.name, row.target_amount, row.created_at],
      );
      if (existing) {
        if (_ts(row.updated_at) > _ts(existing.updated_at)) {
          this._exec(
            "UPDATE goals SET current_amount = ?, deadline = ?, updated_at = ? WHERE id = ?",
            [row.current_amount ?? 0, row.deadline ?? null, row.updated_at ?? _now(), existing.id],
          );
          stats.updated.goals++;
        }
      } else {
        this._exec(
          "INSERT INTO goals (name, target_amount, current_amount, deadline, created_at, updated_at) VALUES (?,?,?,?,?,?)",
          [
            row.name,
            row.target_amount,
            row.current_amount ?? 0,
            row.deadline ?? null,
            row.created_at ?? _now(),
            row.updated_at ?? _now(),
          ],
        );
        stats.inserted.goals++;
      }
    }
  },

  // Match by the parent transaction (1:1, remapped via txMap); LWW on all fields;
  // delete-propagation supported (key = parent transaction's stable transaction_id).
  _mergeFollowUps(rows, txMap, isTomb, stats) {
    for (const row of rows) {
      const localTx = txMap.get(row.transaction_id);
      if (localTx === undefined) {
        stats.skipped.transaction_follow_ups++;
        continue;
      }
      const txRow = this._queryOne("SELECT transaction_id FROM transactions WHERE id = ?", [
        localTx,
      ]);
      const key = txRow ? txRow.transaction_id : null;
      if (isTomb("follow_up", key, _ts(row.updated_at))) continue;
      const existing = this._queryOne(
        "SELECT id, updated_at FROM transaction_follow_ups WHERE transaction_id = ?",
        [localTx],
      );
      if (existing) {
        if (_ts(row.updated_at) > _ts(existing.updated_at)) {
          this._exec(
            `UPDATE transaction_follow_ups SET title = ?, follow_up_type = ?, due_date = ?,
               status = ?, is_recurring = ?, recurrence = ?, completed_at = ?, notes = ?,
               updated_at = ? WHERE id = ?`,
            [
              row.title ?? null,
              row.follow_up_type ?? "reminder",
              row.due_date ?? null,
              row.status ?? "pending",
              row.is_recurring ?? 0,
              row.recurrence ?? null,
              row.completed_at ?? null,
              row.notes ?? null,
              row.updated_at ?? _now(),
              existing.id,
            ],
          );
          stats.updated.transaction_follow_ups++;
        }
      } else {
        this._exec(
          `INSERT INTO transaction_follow_ups
             (transaction_id, title, follow_up_type, due_date, status, is_recurring, recurrence,
              completed_at, notes, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            localTx,
            row.title ?? null,
            row.follow_up_type ?? "reminder",
            row.due_date ?? null,
            row.status ?? "pending",
            row.is_recurring ?? 0,
            row.recurrence ?? null,
            row.completed_at ?? null,
            row.notes ?? null,
            row.created_at ?? _now(),
            row.updated_at ?? _now(),
          ],
        );
        stats.inserted.transaction_follow_ups++;
      }
    }
  },

  // Union by gmail_message_id. Deletion wins: if either side marks a message deleted, keep it so.
  _mergeProcessedGmail(rows, stats) {
    for (const row of rows) {
      const existing = this._queryOne(
        "SELECT id, deleted FROM processed_gmail_messages WHERE gmail_message_id = ?",
        [row.gmail_message_id],
      );
      if (existing) {
        if (row.deleted && !existing.deleted) {
          this._exec("UPDATE processed_gmail_messages SET deleted = 1 WHERE id = ?", [existing.id]);
          stats.updated.processed_gmail_messages++;
        }
      } else {
        this._exec(
          "INSERT INTO processed_gmail_messages (gmail_message_id, processed_at, deleted) VALUES (?,?,?)",
          [row.gmail_message_id, row.processed_at ?? _now(), row.deleted ?? 0],
        );
        stats.inserted.processed_gmail_messages++;
      }
    }
  },

  // Union the join table, remapping both foreign keys to local ids (no removal propagation).
  _mergeTransactionTags(rows, txMap, tagMap, stats) {
    for (const row of rows) {
      const localTx = txMap.get(row.transaction_id);
      const localTag = tagMap.get(row.tag_id);
      if (localTx === undefined || localTag === undefined) continue;
      if (
        this._queryOne(
          "SELECT 1 AS x FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?",
          [localTx, localTag],
        )
      ) {
        continue;
      }
      this._exec("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?,?)", [
        localTx,
        localTag,
      ]);
      stats.inserted.transaction_tags++;
    }
  },

  // Append-only union of chat history, de-duplicated by (chat_id, timestamp, role, content).
  _mergeConversations(rows, stats) {
    for (const row of rows) {
      if (
        this._queryOne(
          "SELECT 1 AS x FROM conversations WHERE chat_id = ? AND timestamp = ? AND role = ? AND content = ?",
          [row.chat_id, row.timestamp, row.role, row.content],
        )
      ) {
        continue;
      }
      this._exec("INSERT INTO conversations (chat_id, role, content, timestamp) VALUES (?,?,?,?)", [
        row.chat_id,
        row.role,
        row.content,
        row.timestamp ?? _now(),
      ]);
      stats.inserted.conversations++;
    }
  },

  // A merge can pull in a second is_default category; keep only the most-recently-updated one.
  _normalizeSingleDefaultCategory() {
    const defaults = this._queryAll(
      "SELECT id FROM categories WHERE is_default = 1 ORDER BY updated_at DESC, id DESC",
    );
    if (defaults.length <= 1) return;
    this._exec("UPDATE categories SET is_default = 0 WHERE is_default = 1 AND id != ?", [
      defaults[0].id,
    ]);
  },
};

window.DB = DB;
