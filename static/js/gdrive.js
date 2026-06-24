import { AI } from "./ai.js";
import {
  GDRIVE_BACKUP_API_KEY_KEY,
  GDRIVE_ENABLED_KEY,
  GDRIVE_LAST_SYNC_KEY,
  GDRIVE_SYNC_INTERVAL_MS,
  GDRIVE_SYNC_LOCK_KEY,
  GMAIL_AUTO_SYNC_ENABLED_KEY,
  GMAIL_CUSTOM_SENDERS_KEY,
} from "./config.js";
import { DB } from "./db.js";
import { Gmail } from "./gmail.js";
import { fetchWithTimeout } from "./utils.js";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const BACKUP_FILENAME = "fincoach-backup.enc";
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 200_000;
const IV_LENGTH = 12;
const SYNC_LOCK_TIMEOUT_MS = 120_000;

export const GDrive = {
  async _deriveKey(secret, salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  },

  async _encrypt(plainBytes, email, sub = "") {
    const secret = `${email}:${sub}`;
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const key = await this._deriveKey(secret, salt);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes);
    const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
    result.set(salt, 0);
    result.set(iv, SALT_LENGTH);
    result.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);
    return result;
  },

  async _decrypt(encBytes, email, sub = "") {
    const salt = encBytes.slice(0, SALT_LENGTH);
    const iv = encBytes.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = encBytes.slice(SALT_LENGTH + IV_LENGTH);
    const secret = `${email}:${sub}`;
    const key = await this._deriveKey(secret, salt);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new Uint8Array(plain);
  },

  async _getAccessToken() {
    return Gmail._getValidToken();
  },

  async _getEmail() {
    const settings = Gmail.getSettings();
    if (settings.email) return settings.email;
    const token = await this._getAccessToken();
    const resp = await fetchWithTimeout("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error("Failed to fetch Google account info");
    const data = await resp.json();
    Gmail.saveSettings({ email: data.emailAddress });
    return data.emailAddress;
  },

  async _getKeyMaterial() {
    const email = await this._getEmail();
    const sub = Gmail.getAccountSub();
    return { email, sub };
  },

  async _findBackupFileId() {
    const token = await this._getAccessToken();
    const url = `${DRIVE_FILES_URL}?spaces=appDataFolder&q=name%3D'${BACKUP_FILENAME}'&fields=files(id,name,modifiedTime)`;
    const resp = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) throw new Error("Drive access revoked — please reconnect");
    if (resp.status === 403) {
      const body = await resp.json().catch(() => ({}));
      const reason = body?.error?.errors?.[0]?.reason;
      if (reason === "insufficientPermissions") {
        throw new Error("Please reconnect your Google account to enable Drive sync");
      }
      if (reason === "accessNotConfigured") {
        throw new Error(
          "Google Drive API is not enabled in your Google Cloud project. " +
            "Go to Google Cloud Console → APIs & Services → Enable APIs → search 'Google Drive API' → Enable.",
        );
      }
      if (reason === "storageQuotaExceeded") {
        throw new Error("Google Drive quota exceeded. Free up space and try again.");
      }
      throw new Error(`Drive API error: ${resp.status} (${reason ?? "unknown"})`);
    }
    if (!resp.ok) throw new Error(`Drive API error: ${resp.status}`);
    const data = await resp.json();
    return data.files?.[0]?.id ?? null;
  },

  _acquireLock() {
    const raw = localStorage.getItem(GDRIVE_SYNC_LOCK_KEY);
    if (raw) {
      const { timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp < SYNC_LOCK_TIMEOUT_MS) return false;
    }
    localStorage.setItem(GDRIVE_SYNC_LOCK_KEY, JSON.stringify({ timestamp: Date.now() }));
    return true;
  },

  _releaseLock() {
    localStorage.removeItem(GDRIVE_SYNC_LOCK_KEY);
  },

  async upload() {
    const token = await this._getAccessToken();
    const { email, sub } = await this._getKeyMaterial();
    const envelope = await DB.exportAsJSON();
    const aiSettings = AI.getSettings();
    const backupApiKey = localStorage.getItem(GDRIVE_BACKUP_API_KEY_KEY) === "true";
    const settingsToBackup = {
      provider: aiSettings.provider,
      model: aiSettings.model,
      azureResourceName: aiSettings.azureResourceName,
      azureDeploymentName: aiSettings.azureDeploymentName,
      azureApiVersion: aiSettings.azureApiVersion,
      ollamaBaseUrl: aiSettings.ollamaBaseUrl,
    };
    if (backupApiKey && aiSettings.apiKey) {
      settingsToBackup.apiKey = aiSettings.apiKey;
    }
    const gmailCustomSenders = localStorage.getItem(GMAIL_CUSTOM_SENDERS_KEY);
    if (gmailCustomSenders) {
      settingsToBackup.gmailCustomSenders = gmailCustomSenders;
    }
    const gmailAutoSyncEnabled = localStorage.getItem(GMAIL_AUTO_SYNC_ENABLED_KEY);
    if (gmailAutoSyncEnabled !== null) {
      settingsToBackup.gmailAutoSyncEnabled = gmailAutoSyncEnabled === "true";
    }
    envelope.settings = settingsToBackup;
    const jsonBytes = new TextEncoder().encode(JSON.stringify(envelope));
    const encBytes = await this._encrypt(jsonBytes, email, sub);
    const fileId = await this._findBackupFileId();

    if (fileId) {
      const resp = await fetchWithTimeout(`${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        body: encBytes,
      });
      if (resp.status === 401) throw new Error("Drive access revoked — please reconnect");
      if (resp.status === 403)
        throw new Error("Google Drive quota exceeded. Free up space and try again.");
      if (!resp.ok) throw new Error(`Drive upload failed: ${resp.status}`);
    } else {
      const boundary = `fin-${Date.now()}`;
      const metaJson = JSON.stringify({ name: BACKUP_FILENAME, parents: ["appDataFolder"] });
      const metaBytes = new TextEncoder().encode(metaJson);
      const nl = new TextEncoder().encode("\r\n");
      const dashes = new TextEncoder().encode(`--${boundary}\r\n`);
      const closingDashes = new TextEncoder().encode(`\r\n--${boundary}--`);
      const metaHeader = new TextEncoder().encode(
        "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      );
      const bodyHeader = new TextEncoder().encode(
        `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      );
      const parts = [dashes, metaHeader, metaBytes, nl, bodyHeader, encBytes, closingDashes];
      const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
      const body = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of parts) {
        body.set(part, offset);
        offset += part.byteLength;
      }
      const resp = await fetchWithTimeout(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });
      if (resp.status === 401) throw new Error("Drive access revoked — please reconnect");
      if (resp.status === 403)
        throw new Error("Google Drive quota exceeded. Free up space and try again.");
      if (!resp.ok) throw new Error(`Drive upload failed: ${resp.status}`);
    }
  },

  async download() {
    const fileId = await this._findBackupFileId();
    if (!fileId) return null;
    const token = await this._getAccessToken();
    const resp = await fetchWithTimeout(`${DRIVE_FILES_URL}/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) throw new Error("Drive access revoked — please reconnect");
    if (!resp.ok) throw new Error(`Drive download failed: ${resp.status}`);
    const encBytes = new Uint8Array(await resp.arrayBuffer());
    const { email, sub } = await this._getKeyMaterial();
    const secret = `${email}:${sub}`;
    const salt = encBytes.slice(0, SALT_LENGTH);
    const iv = encBytes.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = encBytes.slice(SALT_LENGTH + IV_LENGTH);
    const key = await this._deriveKey(secret, salt);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    } catch {
      throw new Error(
        "Backup decryption failed — backup may be corrupt or from a different account",
      );
    }
    return JSON.parse(new TextDecoder().decode(new Uint8Array(plain)));
  },

  _restoreSettings(envelope) {
    if (!envelope?.settings) return { apiKeyRestored: false };
    const backed = envelope.settings;
    const local = AI.getSettings();
    const merged = {
      provider: local.provider || backed.provider || null,
      model: local.model || backed.model || "",
      azureResourceName: local.azureResourceName || backed.azureResourceName || "",
      azureDeploymentName: local.azureDeploymentName || backed.azureDeploymentName || "",
      azureApiVersion: local.azureApiVersion || backed.azureApiVersion || "",
      ollamaBaseUrl: local.ollamaBaseUrl || backed.ollamaBaseUrl || "",
      apiKey: local.apiKey || "",
    };
    let apiKeyRestored = false;
    if (backed.apiKey && !local.apiKey) {
      // Fresh restore: API key was missing locally — bring it in and enable the preference
      merged.apiKey = backed.apiKey;
      apiKeyRestored = true;
      localStorage.setItem(GDRIVE_BACKUP_API_KEY_KEY, "true");
    }
    // Only save if something actually changed
    const changed =
      merged.provider !== local.provider ||
      merged.model !== local.model ||
      merged.azureResourceName !== local.azureResourceName ||
      merged.azureDeploymentName !== local.azureDeploymentName ||
      merged.azureApiVersion !== local.azureApiVersion ||
      merged.ollamaBaseUrl !== local.ollamaBaseUrl ||
      apiKeyRestored;
    if (changed) {
      AI.saveSettings(merged);
    }
    if (backed.gmailCustomSenders && !localStorage.getItem(GMAIL_CUSTOM_SENDERS_KEY)) {
      localStorage.setItem(GMAIL_CUSTOM_SENDERS_KEY, backed.gmailCustomSenders);
    }
    if (backed.gmailAutoSyncEnabled && !localStorage.getItem(GMAIL_AUTO_SYNC_ENABLED_KEY)) {
      localStorage.setItem(GMAIL_AUTO_SYNC_ENABLED_KEY, "true");
    }
    return { apiKeyRestored };
  },

  async getLastModified() {
    const fileId = await this._findBackupFileId();
    if (!fileId) return null;
    const token = await this._getAccessToken();
    const resp = await fetchWithTimeout(`${DRIVE_FILES_URL}/${fileId}?fields=modifiedTime`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.modifiedTime ?? null;
  },

  isEnabled() {
    return localStorage.getItem(GDRIVE_ENABLED_KEY) === "true";
  },

  setEnabled(bool) {
    if (bool) {
      localStorage.setItem(GDRIVE_ENABLED_KEY, "true");
    } else {
      localStorage.removeItem(GDRIVE_ENABLED_KEY);
    }
  },

  getLastSyncTime() {
    return localStorage.getItem(GDRIVE_LAST_SYNC_KEY);
  },

  async deleteBackup() {
    const fileId = await this._findBackupFileId();
    if (!fileId) throw new Error("No backup found in Google Drive");
    const token = await this._getAccessToken();
    const resp = await fetchWithTimeout(`${DRIVE_FILES_URL}/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) throw new Error("Drive access revoked — please reconnect");
    if (resp.status === 404) throw new Error("Backup file not found in Google Drive");
    if (resp.status !== 204 && !resp.ok) throw new Error(`Drive delete failed: ${resp.status}`);
  },

  async sync() {
    if (!this._acquireLock()) throw new Error("Sync already in progress");
    try {
      let stats = null;
      const envelope = await this.download().catch((err) => {
        if (err instanceof TypeError) {
          throw new Error(
            navigator.onLine
              ? "Drive request blocked — check browser or network settings"
              : "Network offline — sync skipped",
          );
        }
        throw err;
      });

      // Restore settings first so that upload() reflects the merged preference
      const settingsRestored = this._restoreSettings(envelope);

      if (envelope !== null) {
        stats = await DB.mergeFromJSON(envelope);
      }

      await this.upload().catch((err) => {
        if (err instanceof TypeError) {
          throw new Error(
            navigator.onLine
              ? "Drive request blocked — check browser or network settings"
              : "Network offline — sync skipped",
          );
        }
        throw err;
      });
      const uploadedAt = new Date().toISOString();
      localStorage.setItem(GDRIVE_LAST_SYNC_KEY, uploadedAt);
      return { stats, uploadedAt, settingsRestored };
    } finally {
      this._releaseLock();
    }
  },

  async maybeAutoSync() {
    try {
      if (!this.isEnabled()) return;
      if (!Gmail.isConnected()) return;
      const last = this.getLastSyncTime();
      if (last && Date.now() - new Date(last).getTime() < GDRIVE_SYNC_INTERVAL_MS) return;
      await this.sync();
    } catch {
      // Auto-sync must never crash the app
    }
  },
};
