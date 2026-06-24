# Google Drive Sync — Behaviour & Caveats

Financial Coach uses Google Drive as an **encrypted, additive backup**. Understanding how it works prevents surprises when syncing across devices.

## How sync works

Each sync is a three-step atomic operation:

1. **Download** — fetch the encrypted backup from Drive and decrypt it
2. **Merge** — import Drive data into the local SQLite DB (additive, conflict-aware)
3. **Upload** — re-encrypt and write the current local state back to Drive

The merge step is **additive**: rows that exist in Drive but not locally are inserted. Rows that exist locally but not in Drive are left untouched (and uploaded in step 3, so Drive catches up).

## Merge conflict rules

| Situation | Winner | Notes |
|-----------|--------|-------|
| Drive has a row, local does not | Drive | Row is inserted locally |
| Local has a row, Drive does not | Local | Row is preserved and uploaded |
| Both have the same row (matched by natural key) | Local | Drive data skipped; local data uploaded |
| Local merged account A into B after the Drive backup | Local | `merged_at` timestamp compared against `exported_at`; newer local merge wins |
| Drive backup shows an account as merged, local does not | Drive | Drive merge applied locally |

## Known caveats

### Deleted accounts come back from Drive

The sync has no concept of "tombstones" (deleted-item records). If you delete an account locally and then sync, Drive re-inserts it because the merge only sees a missing row — it cannot tell whether it was never created or was intentionally deleted.

**Workaround:** To permanently delete an account across all devices:
1. Delete the account locally
2. Go to **Settings → Google Drive Sync → Delete Drive Backup**
3. Sync again — the upload step will write the correct (post-deletion) state to Drive

The same applies to any other data type (transactions, goals, budgets, etc.) deleted locally while a Drive backup still contains them.

### Stale backups cannot undo newer local merges

If a Drive backup predates a local account merge, the sync correctly preserves the local merge. The `merged_at` timestamp of the local account is compared against the backup's `exported_at`; if the local merge is newer, it is kept and uploaded to Drive.

### Local merge state is authoritative when timestamps agree

When the local and Drive merge states conflict with identical or missing timestamps (e.g., the Drive backup has no `exported_at` field — a legacy format), Drive wins and the local merge state is overwritten. This only affects very old backups created before the timestamp field was introduced.

### Encryption key is tied to your Gmail account

Backups are encrypted with a key derived from your Gmail address (AES-GCM, PBKDF2, 200 000 iterations). If you reconnect a different Gmail account, Drive backups created under the old account cannot be decrypted.

### Auto-sync runs at most once per hour

Automatic background sync (`GDRIVE_SYNC_INTERVAL_MS = 1 hour`) is a cooldown, not a schedule. It fires opportunistically when the app is open and the cooldown has elapsed. Manual sync via **Settings → Sync with Drive** is always available.

### Sync is per-device, not real-time

There is no live replication. Devices sync when the user opens the app and the cooldown has elapsed (auto) or clicks "Sync with Drive" (manual). Concurrent edits on two devices between syncs are merged additively on the next sync; the last writer wins for same-row conflicts.
