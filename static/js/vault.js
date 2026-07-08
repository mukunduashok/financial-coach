/**
 * vault.js — Credential vault using PBKDF2 + AES-256-GCM.
 *
 * Encrypts AI API keys and Gmail OAuth tokens so they are never stored
 * in plaintext in localStorage.
 */
import {
  AI_SETTINGS_KEY,
  GMAIL_SETTINGS_KEY,
  VAULT_AI_KEY,
  VAULT_BIOMETRIC_CRED_KEY,
  VAULT_BIOMETRIC_WRAP_KEY,
  VAULT_BIOMETRIC_WRAPPED_KEY,
  VAULT_GMAIL_KEY,
  VAULT_SALT_KEY,
  VAULT_SENTINEL_KEY,
} from "./config.js";

// ---------------------------------------------------------------------------
// Crypto constants
// ---------------------------------------------------------------------------
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const SENTINEL = "fincoach-vault-ok";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function _fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function _deriveKey(passphrase, salt) {
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
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
}

// ---------------------------------------------------------------------------
// Vault singleton
// ---------------------------------------------------------------------------
export const Vault = {
  _key: null,

  isConfigured() {
    return !!localStorage.getItem(VAULT_SALT_KEY);
  },

  isUnlocked() {
    return this._key !== null;
  },

  async _encryptStr(plaintext) {
    if (!this._key) throw new Error("Vault is locked");
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this._key,
      new TextEncoder().encode(plaintext),
    );
    const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), IV_LENGTH);
    return _toBase64(combined);
  },

  async _decryptStr(blob) {
    if (!this._key) throw new Error("Vault is locked");
    const combined = _fromBase64(blob);
    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      this._key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  },

  async setup(passphrase) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    this._key = await _deriveKey(passphrase, salt);
    localStorage.setItem(VAULT_SALT_KEY, _toBase64(salt));
    const encryptedSentinel = await this._encryptStr(SENTINEL);
    localStorage.setItem(VAULT_SENTINEL_KEY, encryptedSentinel);
  },

  async unlock(passphrase) {
    const saltB64 = localStorage.getItem(VAULT_SALT_KEY);
    if (!saltB64) return false;
    const salt = _fromBase64(saltB64);
    const key = await _deriveKey(passphrase, salt);

    // Verify sentinel
    const sentinelBlob = localStorage.getItem(VAULT_SENTINEL_KEY);
    if (!sentinelBlob) return false;

    try {
      const iv = _fromBase64(sentinelBlob).slice(0, IV_LENGTH);
      const ciphertext = _fromBase64(sentinelBlob).slice(IV_LENGTH);
      const plaintext = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext,
      );
      const decoded = new TextDecoder().decode(plaintext);
      if (decoded !== SENTINEL) return false;
    } catch {
      return false;
    }

    this._key = key;
    return true;
  },

  lock() {
    this._key = null;
  },

  async encryptJSON(obj) {
    if (!this._key) throw new Error("Vault is locked");
    return this._encryptStr(JSON.stringify(obj));
  },

  async decryptJSON(blob) {
    if (!this._key) throw new Error("Vault is locked");
    return JSON.parse(await this._decryptStr(blob));
  },

  async saveAISettings(settings) {
    const encrypted = await this.encryptJSON(settings);
    localStorage.setItem(VAULT_AI_KEY, encrypted);
    localStorage.removeItem(AI_SETTINGS_KEY);
  },

  async loadAISettings() {
    const blob = localStorage.getItem(VAULT_AI_KEY);
    if (!blob) return null;
    return this.decryptJSON(blob);
  },

  async saveGmailSettings(settings) {
    const encrypted = await this.encryptJSON(settings);
    localStorage.setItem(VAULT_GMAIL_KEY, encrypted);
    localStorage.removeItem(GMAIL_SETTINGS_KEY);
  },

  async loadGmailSettings() {
    const blob = localStorage.getItem(VAULT_GMAIL_KEY);
    if (!blob) return null;
    return this.decryptJSON(blob);
  },

  clearCredentials() {
    localStorage.removeItem(VAULT_SALT_KEY);
    localStorage.removeItem(VAULT_SENTINEL_KEY);
    localStorage.removeItem(VAULT_AI_KEY);
    localStorage.removeItem(VAULT_GMAIL_KEY);
    this._key = null;
  },

  async changePassphrase(oldPassphrase, newPassphrase) {
    const ok = await this.unlock(oldPassphrase);
    if (!ok) throw new Error("Wrong passphrase");

    // Load existing encrypted blobs before re-keying
    const aiBlob = localStorage.getItem(VAULT_AI_KEY);
    const gmailBlob = localStorage.getItem(VAULT_GMAIL_KEY);

    let aiSettings = null;
    let gmailSettings = null;

    if (aiBlob) {
      try {
        aiSettings = await this.decryptJSON(aiBlob);
      } catch {
        // ignore unreadable blob
      }
    }
    if (gmailBlob) {
      try {
        gmailSettings = await this.decryptJSON(gmailBlob);
      } catch {
        // ignore unreadable blob
      }
    }

    // Re-setup with new passphrase (generates new salt + sentinel)
    await this.setup(newPassphrase);

    // Re-encrypt existing credentials under new key
    if (aiSettings) await this.saveAISettings(aiSettings);
    if (gmailSettings) await this.saveGmailSettings(gmailSettings);

    // Clear biometric so stale credentials are not reused after a PIN change
    this.disableBiometric();
  },

  async isBiometricAvailable() {
    if (!globalThis.navigator?.credentials || !globalThis.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  isBiometricEnabled() {
    return !!localStorage.getItem(VAULT_BIOMETRIC_CRED_KEY);
  },

  async setupBiometric(passphrase) {
    // Step 1: verify passphrase
    const ok = await this.unlock(passphrase);
    if (!ok) throw new Error("Incorrect passphrase");

    // Step 2: register platform credential
    const credential = await navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: "Financial Coach" },
        user: {
          id: globalThis.crypto.getRandomValues(new Uint8Array(32)),
          name: "fincoach-user",
          displayName: "Financial Coach User",
        },
        challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
        },
      },
    });

    // Step 3: store credential ID
    localStorage.setItem(VAULT_BIOMETRIC_CRED_KEY, _toBase64(credential.rawId));

    // Step 4: generate wrap key
    const wrapBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const wrapKey = await globalThis.crypto.subtle.importKey("raw", wrapBytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);

    // Step 5: encrypt passphrase with wrap key
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      wrapKey,
      new TextEncoder().encode(passphrase),
    );
    const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), IV_LENGTH);

    // Step 6: store wrap key and wrapped passphrase
    localStorage.setItem(VAULT_BIOMETRIC_WRAP_KEY, _toBase64(wrapBytes));
    localStorage.setItem(VAULT_BIOMETRIC_WRAPPED_KEY, _toBase64(combined));
  },

  async unlockWithBiometric() {
    const credIdB64 = localStorage.getItem(VAULT_BIOMETRIC_CRED_KEY);
    if (!credIdB64) return false;

    // Step 1: biometric challenge
    try {
      await navigator.credentials.get({
        publicKey: {
          allowCredentials: [{ id: _fromBase64(credIdB64), type: "public-key" }],
          userVerification: "required",
          challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
        },
      });
    } catch {
      return false;
    }

    // Step 2: decrypt stored passphrase using wrap key
    const wrapB64 = localStorage.getItem(VAULT_BIOMETRIC_WRAP_KEY);
    const wrappedB64 = localStorage.getItem(VAULT_BIOMETRIC_WRAPPED_KEY);
    if (!wrapB64 || !wrappedB64) return false;

    try {
      const wrapBytes = _fromBase64(wrapB64);
      const wrapKey = await globalThis.crypto.subtle.importKey("raw", wrapBytes, "AES-GCM", false, [
        "decrypt",
      ]);
      const combined = _fromBase64(wrappedB64);
      const iv = combined.slice(0, IV_LENGTH);
      const ciphertext = combined.slice(IV_LENGTH);
      const plaintext = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        wrapKey,
        ciphertext,
      );
      const passphrase = new TextDecoder().decode(plaintext);
      return await this.unlock(passphrase);
    } catch {
      return false;
    }
  },

  disableBiometric() {
    localStorage.removeItem(VAULT_BIOMETRIC_CRED_KEY);
    localStorage.removeItem(VAULT_BIOMETRIC_WRAP_KEY);
    localStorage.removeItem(VAULT_BIOMETRIC_WRAPPED_KEY);
  },
};
