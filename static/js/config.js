/**
 * config.js — App-level configuration constants.
 *
 * Values here are deployment-specific and apply to all users.
 * Unlike localStorage settings (per-user), these are baked into the app.
 */

/** Cloudflare Worker URL that handles Gmail OAuth token exchange. */
// Resolved at load from window.__FINCOACH_CONFIG__ (generated static/js/env.js from .env
// via `make gen-env` / `make dev` / `make deploy`); falls back to the placeholder below.
// See cloudflare-worker/ and docs/cloudflare-deployment.md for deployment steps.
export const GMAIL_PROXY_URL =
  globalThis.__FINCOACH_CONFIG__?.GMAIL_PROXY_URL ??
  "https://your-worker.your-subdomain.workers.dev";

/**
 * Minimum time (ms) between automatic Drive syncs.
 * Auto-sync on app open is skipped if the last sync was more recent than this.
 * Default: 1 hour. Increase to 2 h (7_200_000) or 3 h (10_800_000) as needed.
 */
export const GDRIVE_SYNC_INTERVAL_MS = 3_600_000; // 1 hour
export const GDRIVE_LAST_SYNC_KEY = "fincoach-gdrive-last-sync";
export const GDRIVE_ENABLED_KEY = "fincoach-gdrive-enabled";
export const GDRIVE_BACKUP_API_KEY_KEY = "fincoach-gdrive-backup-api-key";
export const GDRIVE_SYNC_LOCK_KEY = "fincoach-gdrive-sync-lock";

export const GMAIL_SETTINGS_KEY = "fincoach-gmail-settings";
export const GMAIL_CUSTOM_SENDERS_KEY = "fincoach-gmail-custom-senders";
export const GMAIL_OAUTH_PENDING_STATE_KEY = "fincoach-gmail-oauth-pending-state";
export const GMAIL_OAUTH_PENDING_RESULT_KEY = "fincoach-gmail-oauth-pending-result";
export const GMAIL_OAUTH_STATE_TTL_MS = 300_000; // 5 minutes
export const AI_SETTINGS_KEY = "fincoach-ai-settings";
export const AI_EXTERNAL_CONSENT_KEY = "fincoach-ai-external-consent";

export const VAULT_SALT_KEY = "fincoach-vault-salt";
export const VAULT_SENTINEL_KEY = "fincoach-vault-sentinel";
export const VAULT_AI_KEY = "fincoach-vault-ai";
export const VAULT_GMAIL_KEY = "fincoach-vault-gmail";

export const SESSION_LAST_ACTIVITY_KEY = "fincoach-session-last-activity";
export const TRUSTED_DEVICE_KEY = "fincoach-trusted-device";
export const SESSION_EXPIRY_MS = 6 * 60 * 60 * 1000; // 21_600_000

export const ONBOARDED_KEY = "fincoach-onboarded";
export const ONBOARDING_STEP_KEY = "fincoach-onboarding-step";

// Google Drive backup reminder
export const GDRIVE_REMINDER_KEY = "fincoach-gdrive-reminder-last";
export const GDRIVE_REMINDER_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

// Gmail auto-sync
export const GMAIL_AUTO_SYNC_ENABLED_KEY = "fincoach-gmail-auto-sync-enabled";
export const GMAIL_AUTO_SYNC_LAST_KEY = "fincoach-gmail-auto-sync-last";
export const GMAIL_AUTO_SYNC_INTERVAL_MS = 900_000; // 15 minutes

// Daily spending summary
export const DAILY_SUMMARY_KEY = "fincoach-daily-summary-last";

// Session expiry warning (30 min before expiry)
export const SESSION_EXPIRY_WARN_KEY = "fincoach-session-expiry-warned";

// iOS PWA OAuth redirect callback query param
export const GMAIL_OAUTH_CALLBACK_PARAM = "gmail-oauth";

// Vault biometric authentication keys
export const VAULT_BIOMETRIC_CRED_KEY = "fincoach-vault-biometric-cred";
export const VAULT_BIOMETRIC_LEGACY_WRAP_KEY = "fincoach-vault-biometric-wrap";
export const VAULT_BIOMETRIC_PRF_SALT_KEY = "fincoach-vault-biometric-prf-salt";
export const VAULT_BIOMETRIC_WRAPPED_KEY = "fincoach-vault-biometric-wrapped";

export const PRIVACY_MODE_KEY = "fincoach-privacy-mode";
export const PRIVACY_REVEAL_MS = 300_000;
