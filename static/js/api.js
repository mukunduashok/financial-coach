/**
 * api.js — Thin bridge layer. Delegates to DB (local SQLite) or AI (future).
 * No business logic here — only routing calls to the right module.
 */
import { AI } from "./ai.js";
import { AI_SETTINGS_KEY, GMAIL_CUSTOM_SENDERS_KEY, GMAIL_SETTINGS_KEY } from "./config.js";
import { DB } from "./db.js";
import { Gmail } from "./gmail.js";
import { validateGmailSender } from "./utils.js";
import { Vault } from "./vault.js";

export const API = {
  // ---- Accounts ----
  getAccounts(includeAll = false) {
    return DB.getAccounts(includeAll);
  },
  getAccount(id) {
    return DB.getAccount(id);
  },
  createAccount(data) {
    return DB.createAccount(data);
  },
  mergeAccounts(sourceId, targetId) {
    return DB.mergeAccounts(sourceId, targetId);
  },
  unmergeAccount(id) {
    return DB.unmergeAccount(id);
  },
  deleteAccount(id) {
    return DB.deleteAccount(id);
  },
  updateAccount(id, data) {
    return DB.updateAccount(id, data);
  },
  getCreditAccountBalance(accountId) {
    return DB.getCreditAccountBalance(accountId);
  },

  // ---- Transactions ----
  getTransactions(params = {}) {
    return DB.getTransactions(params);
  },
  getTransactionTotals(params = {}) {
    return DB.getTransactionTotals(params);
  },
  createTransaction(data) {
    return DB.createTransaction(data);
  },
  updateTransaction(id, data) {
    return DB.updateTransaction(id, data);
  },
  toggleExcludedFromExpenses(id, value) {
    return DB.toggleExcludedFromExpenses(id, value);
  },
  toggleExcludedFromIncome(id, value) {
    return DB.toggleExcludedFromIncome(id, value);
  },
  deleteTransaction(id) {
    return DB.deleteTransaction(id);
  },

  getUpcomingBills(days = 7) {
    return DB.getUpcomingBills(days);
  },

  // ---- Follow-ups / reminders ----
  createFollowUp(transactionId, data) {
    return DB.createFollowUp(transactionId, data);
  },
  updateFollowUp(id, fields) {
    return DB.updateFollowUp(id, fields);
  },
  deleteFollowUp(id) {
    return DB.deleteFollowUp(id);
  },
  getFollowUp(transactionId) {
    return DB.getFollowUp(transactionId);
  },
  getFollowUps(filters) {
    return DB.getFollowUps(filters);
  },
  markFollowUpDone(id) {
    return DB.markFollowUpDone(id);
  },
  reopenFollowUp(id) {
    return DB.reopenFollowUp(id);
  },

  // ---- Categories ----
  getCategories() {
    return DB.getCategories();
  },
  createCategory(data) {
    return DB.createCategory(data);
  },
  updateCategory(id, data) {
    return DB.updateCategory(id, data);
  },
  deleteCategory(id) {
    return DB.deleteCategory(id);
  },
  getDefaultCategory() {
    return DB.getDefaultCategory();
  },
  setDefaultCategory(id) {
    return DB.setDefaultCategory(id);
  },

  // ---- Merchants ----
  getMerchants(params = {}) {
    return DB.getMerchants(params);
  },
  searchMerchants(q) {
    return DB.searchMerchants(q);
  },
  createMerchant(data) {
    return DB.createMerchant(data);
  },
  updateMerchant(id, data) {
    return DB.updateMerchant(id, data);
  },
  updateMerchantCategory(id, categoryId) {
    return DB.updateMerchantCategory(id, categoryId);
  },
  deleteMerchant(id) {
    return DB.deleteMerchant(id);
  },

  // ---- Gmail ----
  async getGmailStatus() {
    return { connected: Gmail.isConnected(), email: Gmail.getSettings().email || null };
  },
  async getGmailConnectUrl() {
    return Gmail.connect();
  },
  async gmailSearch(params) {
    return Gmail.extractTransactions(params);
  },
  async resetGmailSyncHistory() {
    return DB.clearDeletedGmailTombstones();
  },
  getGmailCustomSenders() {
    const raw = localStorage.getItem(GMAIL_CUSTOM_SENDERS_KEY);
    return raw
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  },
  saveGmailCustomSenders(senders) {
    if (!senders || senders.length === 0) {
      localStorage.removeItem(GMAIL_CUSTOM_SENDERS_KEY);
      return { saved: [], rejected: [] };
    }
    const valid = [];
    const rejected = [];
    for (const s of senders) {
      if (validateGmailSender(s)) {
        valid.push(s);
      } else {
        rejected.push(s);
      }
    }
    if (valid.length === 0) {
      localStorage.removeItem(GMAIL_CUSTOM_SENDERS_KEY);
    } else {
      localStorage.setItem(GMAIL_CUSTOM_SENDERS_KEY, valid.join(","));
    }
    return { saved: valid, rejected };
  },

  // ---- Goals ----
  getGoals() {
    return DB.getGoals();
  },
  getGoal(id) {
    return DB.getGoal(id);
  },
  createGoal(data) {
    return DB.createGoal(data);
  },
  updateGoal(id, data) {
    return DB.updateGoal(id, data);
  },
  deleteGoal(id) {
    return DB.deleteGoal(id);
  },
  contributeToGoal(id, amount) {
    return DB.contributeToGoal(id, amount);
  },

  // ---- Budgets ----
  getBudgets(activeOnly = true) {
    return DB.getBudgets(activeOnly);
  },
  getBudget(id) {
    return DB.getBudget(id);
  },
  createBudget(data) {
    return DB.createBudget(data);
  },
  updateBudget(id, data) {
    return DB.updateBudget(id, data);
  },
  deleteBudget(id) {
    return DB.deleteBudget(id);
  },

  // ---- Chat ----
  sendChatMessage(message) {
    return AI.chat(message);
  },
  sendChatMessageWithId(message, chatId) {
    return AI.chat(message, chatId);
  },
  getChatHistory(chatId) {
    return DB.getChatHistory(chatId);
  },
  clearChatHistory(chatId) {
    return DB.clearChatHistory(chatId);
  },
  listChatSessions() {
    return DB.listChatSessions();
  },

  // ---- Reports ----
  getSpendingReport(params = {}) {
    return DB.getSpendingReport(params);
  },

  // ---- Export ----
  async exportTransactionsUrl(params = {}) {
    const csv = await DB.exportTransactionsCSV(params);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
    return null;
  },

  // ---- Tags ----
  getTags() {
    return DB.getTags();
  },
  createTag(data) {
    return DB.createTag(data.name);
  },
  updateTag(id, data) {
    return DB.updateTag(id, data.name);
  },
  deleteTag(id) {
    return DB.deleteTag(id);
  },
  setTransactionTags(txId, tagIds) {
    return DB.setTransactionTags(txId, tagIds);
  },

  // ---- Dev / Testing ----
  loadSampleData() {
    return DB.loadSampleData();
  },

  // ---- Vault ----
  isVaultConfigured() {
    return Vault.isConfigured();
  },
  isVaultUnlocked() {
    return Vault.isUnlocked();
  },
  async unlockVault(passphrase) {
    const ok = await Vault.unlock(passphrase);
    if (!ok) return false;

    // Populate in-memory caches
    const aiSettings = await Vault.loadAISettings();
    if (aiSettings) AI.setDecrypted(aiSettings);

    const gmailSettings = await Vault.loadGmailSettings();
    if (gmailSettings) Gmail.setDecrypted(gmailSettings);

    // Migrate OAuth redirect tokens that landed in plaintext localStorage
    // (iOS PWA redirect flow writes there before vault check runs)
    const plaintextGmail = localStorage.getItem(GMAIL_SETTINGS_KEY);
    if (plaintextGmail) {
      try {
        const tempTokens = JSON.parse(plaintextGmail);
        const merged = { ...(gmailSettings || {}), ...tempTokens };
        await Vault.saveGmailSettings(merged);
        Gmail.setDecrypted(merged);
      } catch {
        /* ignore corrupt temp data */
      }
    }

    return true;
  },
  async setupVault(passphrase) {
    // Capture existing plaintext credentials before encrypting
    const aiSettings = AI.getSettings();
    const gmailSettings = Gmail.getSettings();

    await Vault.setup(passphrase);

    // Migrate existing plaintext AI credentials into vault
    if (aiSettings.provider || aiSettings.apiKey) {
      await Vault.saveAISettings(aiSettings);
      AI.setDecrypted(aiSettings);
    }

    // Migrate existing plaintext Gmail credentials into vault
    if (gmailSettings.accessToken || gmailSettings.refreshToken) {
      await Vault.saveGmailSettings(gmailSettings);
      Gmail.setDecrypted(gmailSettings);
      localStorage.removeItem(GMAIL_SETTINGS_KEY);
    }
  },
  lockVault() {
    Vault.lock();
    AI.clearDecrypted();
    Gmail.clearDecrypted();
  },
  resetVault() {
    Vault.clearCredentials();
    AI.clearDecrypted();
    Gmail.clearDecrypted();
    localStorage.removeItem(AI_SETTINGS_KEY);
    localStorage.removeItem(GMAIL_SETTINGS_KEY);
  },
  async changeVaultPassphrase(oldPassphrase, newPassphrase) {
    await Vault.changePassphrase(oldPassphrase, newPassphrase);
  },

  // ---- Vault Biometric ----
  async isBiometricAvailable() {
    return Vault.isBiometricAvailable();
  },
  isBiometricEnabled() {
    return Vault.isBiometricEnabled();
  },
  async setupBiometric(passphrase) {
    return Vault.setupBiometric(passphrase);
  },
  async unlockWithBiometric() {
    const ok = await Vault.unlockWithBiometric();
    if (!ok) return false;

    // Populate in-memory caches (same as unlockVault)
    const aiSettings = await Vault.loadAISettings();
    if (aiSettings) AI.setDecrypted(aiSettings);

    const gmailSettings = await Vault.loadGmailSettings();
    if (gmailSettings) Gmail.setDecrypted(gmailSettings);

    // Migrate OAuth redirect tokens that landed in plaintext localStorage
    // (iOS PWA redirect flow writes there before vault check runs)
    const plaintextGmail = localStorage.getItem(GMAIL_SETTINGS_KEY);
    if (plaintextGmail) {
      try {
        const tempTokens = JSON.parse(plaintextGmail);
        if (tempTokens?.accessToken) {
          await Vault.saveGmailSettings(tempTokens);
          Gmail.setDecrypted(tempTokens);
          localStorage.removeItem(GMAIL_SETTINGS_KEY);
        }
      } catch {
        /* ignore corrupt temp data */
      }
    }

    return true;
  },
  disableBiometric() {
    Vault.disableBiometric();
  },
};

window.API = API;
