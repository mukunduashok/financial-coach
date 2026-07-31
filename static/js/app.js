import { AI, AI_PROVIDERS } from "./ai.js";
/**
 * Financial Coach — Single Page Application
 * Vanilla JS with hash-based routing.
 */
import { API } from "./api.js";
import {
  DAILY_SUMMARY_KEY,
  GDRIVE_BACKUP_API_KEY_KEY,
  GDRIVE_REMINDER_INTERVAL_MS,
  GDRIVE_REMINDER_KEY,
  GMAIL_AUTO_SYNC_ENABLED_KEY,
  ONBOARDED_KEY,
  ONBOARDING_STEP_KEY,
  PRIVACY_MODE_KEY,
  PRIVACY_REVEAL_MS,
  SESSION_LAST_ACTIVITY_KEY,
  TRUSTED_DEVICE_KEY,
} from "./config.js";
import { DB } from "./db.js";
import { GDrive } from "./gdrive.js";
import { Gmail } from "./gmail.js";
import { Vault } from "./vault.js";

// ============================================================================
// Utility helpers
// ============================================================================

function formatCurrency(amount) {
  const abs = Math.abs(amount);
  return `₹${abs.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const BALANCE_DISPLAY_TYPES = new Set(["savings", "current", "deposit"]);

const ACCOUNT_GROUPS = [
  { key: "savings", label: "Savings Accounts", types: new Set(["savings"]), tileType: "bank" },
  { key: "current", label: "Current Accounts", types: new Set(["current"]), tileType: "bank" },
  {
    key: "credit",
    label: "Credit Cards",
    types: new Set(["credit", "credit_card"]),
    tileType: "credit",
  },
  {
    key: "debit",
    label: "Prepaid / Debit Cards",
    types: new Set(["debit", "debit_card", "prepaid"]),
    tileType: "debit",
  },
  { key: "others", label: "Others", types: null, tileType: "wallet" },
];

// Follow-up / reminder option lists (kept in one place so the edit modal and the
// Bills & Reminders panel stay in sync).
const FOLLOWUP_TYPES = [
  { value: "reminder", label: "Reminder" },
  { value: "bill", label: "Bill" },
  { value: "refund", label: "Refund expected" },
  { value: "recurring_deposit", label: "Recurring deposit" },
  { value: "payment", label: "Recurring payment" },
];

const FOLLOWUP_RECURRENCES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const FOLLOWUP_TYPE_LABELS = Object.fromEntries(FOLLOWUP_TYPES.map((t) => [t.value, t.label]));

function formatAccountBalance(account) {
  if (!BALANCE_DISPLAY_TYPES.has(account.account_type)) {
    return "";
  }
  if (account.balance_updated_at === null || account.balance_updated_at === undefined) {
    return '<span class="balance-not-synced">Balance not yet synced</span>';
  }
  return formatCurrency(account.effective_balance || account.balance);
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const opts = { month: "short", day: "numeric", year: "numeric" };
  const timeParts = dateStr?.includes("T") ? dateStr.split("T")[1] : null;
  if (timeParts && timeParts !== "00:00:00" && timeParts !== "00:00") {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
    opts.hour12 = true;
  }
  return d.toLocaleDateString("en-IN", opts);
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function categoryIcon(name) {
  const CATEGORY_ICONS = {
    "Food & Dining": "🍽️",
    Groceries: "🛒",
    Transportation: "🚗",
    Shopping: "🛍️",
    Entertainment: "🎬",
    "Bills & Utilities": "💡",
    "Health & Fitness": "💊",
    Travel: "✈️",
    Education: "📚",
    "Personal Care": "💆",
    Business: "💼",
    Income: "💰",
    Transfer: "↔️",
    Withdrawal: "🏧",
    Deposit: "🏦",
    Investment: "📈",
    Subscription: "🔄",
    Gift: "🎁",
    Charity: "❤️",
    Other: "📌",
  };
  if (name && CATEGORY_ICONS[name]) {
    return `<span>${CATEGORY_ICONS[name]}</span>`;
  }
  const letter = escapeHtml((name || "?")[0].toUpperCase());
  return `<span class="tx-icon-letter">${letter}</span>`;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replace(/"/g, "&quot;");
}

function truncate(str, len = 40) {
  if (!str) return "";
  return str.length > len ? `${str.slice(0, len)}…` : str;
}

function isPrivacyEnabled() {
  return localStorage.getItem(PRIVACY_MODE_KEY) !== "false";
}

function privacyAmount(html) {
  if (!html) return "";
  return `<span class="amount-private">${html}</span>`;
}

function updatePrivacyButton() {
  const btn = document.getElementById("privacy-toggle-btn");
  if (!btn) return;
  const hidden = document.body.classList.contains("privacy-active");
  btn.textContent = hidden ? "👁" : "🙈";
  btn.title = hidden ? "Reveal amounts" : "Hide amounts";
}

function applyPrivacyState() {
  if (isPrivacyEnabled()) {
    document.body.classList.add("privacy-active");
  } else {
    document.body.classList.remove("privacy-active");
  }
  updatePrivacyButton();
}

function revealPrivacy() {
  if (privacyRevealTimer) clearTimeout(privacyRevealTimer);
  document.body.classList.remove("privacy-active");
  updatePrivacyButton();
  privacyRevealTimer = setTimeout(() => {
    hidePrivacy();
  }, PRIVACY_REVEAL_MS);
}

function hidePrivacy() {
  if (privacyRevealTimer) {
    clearTimeout(privacyRevealTimer);
    privacyRevealTimer = null;
  }
  if (isPrivacyEnabled()) {
    document.body.classList.add("privacy-active");
  }
  updatePrivacyButton();
}

// ============================================================================
// Global Event Delegation — replaces all inline onclick/onchange/onkeydown
// ============================================================================

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;

  const action = el.dataset.action;
  const id = el.dataset.id !== undefined ? Number(el.dataset.id) : undefined;
  const name = el.dataset.name;
  const route = el.dataset.route;
  const mode = el.dataset.mode;
  const type = el.dataset.type;
  const format = el.dataset.format;

  switch (action) {
    // Modal close
    case "close-modal": {
      const overlay = el.closest(".modal-overlay");
      if (overlay?.querySelector('[data-action="confirm-ai-consent"]')) {
        pendingAIConsentAction = null;
      }
      overlay?.remove();
      break;
    }
    case "close-and-new-chat":
      el.closest(".modal-overlay")?.remove();
      startNewChat();
      break;
    case "do-clear-chat":
      doClearChatHistory(el);
      break;

    // Layout / Nav
    case "theme-toggle":
      Theme.toggle();
      break;
    case "toggle-privacy-reveal":
      if (document.body.classList.contains("privacy-active")) {
        revealPrivacy();
      } else {
        hidePrivacy();
      }
      break;
    case "toggle-privacy-mode": {
      const enabled = el.checked;
      localStorage.setItem(PRIVACY_MODE_KEY, enabled ? "true" : "false");
      applyPrivacyState();
      break;
    }
    case "toggle-overflow-menu":
      toggleOverflowMenu();
      break;
    case "overflow-backdrop":
      closeOverflowMenu();
      break;
    case "nav-navigate":
      Router.navigate(route);
      break;
    case "nav-overflow-navigate":
      Router.navigate(route);
      closeOverflowMenu();
      break;

    // Transactions
    case "show-edit-tx":
      showEditTransaction(id);
      break;
    case "switch-tx-tab":
      switchTxTab(el.dataset.mode);
      break;
    case "filter-followups":
      filterFollowUps(el.dataset.filter);
      break;
    case "mark-followup-done":
      markFollowUpDone(id);
      break;
    case "reopen-followup":
      reopenFollowUp(id);
      break;
    case "remove-followup":
      removeFollowUp(id);
      break;
    case "open-tx-from-followup":
      showEditTransaction(id);
      break;
    case "export-transactions":
      exportTransactions(format);
      break;
    case "scroll-top":
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;
    case "confirm-delete-tx":
      confirmDeleteTransaction(id, e);
      break;
    case "toggle-tx-type":
      toggleTxType(el, type);
      break;
    case "save-transaction":
      saveTransaction(id, el);
      break;
    case "do-delete-tx":
      doDeleteTransaction(id, el);
      break;
    case "create-transaction":
      createTransaction();
      break;

    // Sync
    case "connect-gmail":
      connectGmail();
      break;
    case "set-sync-mode":
      setSyncMode(mode, el);
      break;
    case "run-sync":
      runSync();
      break;
    case "reset-sync-history":
      resetSyncHistory();
      break;

    // Accounts
    case "show-create-account":
      showCreateAccountModal();
      break;
    case "show-merge-account":
      showMergeAccountModal();
      break;
    case "confirm-unmerge-account":
      confirmUnmergeAccount(id, name);
      break;
    case "toggle-account-children":
      toggleAccountChildren(id);
      break;
    case "confirm-delete-account":
      confirmDeleteAccount(id, name);
      break;
    case "do-create-account":
      doCreateAccount(el);
      break;
    case "do-merge-accounts":
      doMergeAccounts(el);
      break;
    case "do-unmerge-account":
      doUnmergeAccount(id, el);
      break;
    case "do-delete-account":
      doDeleteAccount(id, el);
      break;
    case "show-edit-account":
      showEditAccountModal(
        Number.parseInt(id, 10),
        el.dataset.name,
        el.dataset.identifier,
        el.dataset.type,
        Number.parseInt(el.dataset.cycleDay || "1", 10),
      );
      break;
    case "do-edit-account":
      doEditAccount(Number.parseInt(id, 10), el);
      break;

    // Chat
    case "send-chat":
      sendChatMessage();
      break;
    case "fill-chat-suggestion":
      fillChatSuggestion(el);
      break;
    case "load-chat-session":
      loadChatSession(el.dataset.chatId, el);
      break;

    // Taxonomy: Categories
    case "switch-taxonomy-tab":
      switchTaxonomyTab(mode);
      break;
    case "show-add-category":
      showAddCategoryModal();
      break;
    case "set-default-category":
      setDefaultCategory(id);
      break;
    case "show-edit-category":
      showEditCategoryModal(
        id,
        el.dataset.name,
        el.dataset.description,
        el.dataset.isDefault === "true",
      );
      break;
    case "confirm-delete-category":
      confirmDeleteCategory(id, name);
      break;
    case "do-create-category":
      doCreateCategory(el);
      break;
    case "do-update-category":
      doUpdateCategory(id, el);
      break;
    case "do-delete-category":
      doDeleteCategory(id, el);
      break;

    // Taxonomy: Merchants
    case "show-add-merchant":
      showAddMerchantModal();
      break;
    case "show-edit-merchant": {
      const merchant = _merchantCache.get(id);
      if (merchant) showEditMerchantModal(merchant);
      break;
    }
    case "confirm-delete-merchant":
      confirmDeleteMerchant(id, name);
      break;
    case "do-create-merchant":
      doCreateMerchant(el);
      break;
    case "do-update-merchant":
      doUpdateMerchant(id, el);
      break;
    case "do-delete-merchant":
      doDeleteMerchant(id, el);
      break;

    // Taxonomy: Tags
    case "show-add-tag":
      showAddTagModal();
      break;
    case "show-edit-tag":
      showEditTagModal(id, el.dataset.name);
      break;
    case "confirm-delete-tag":
      confirmDeleteTag(id, name);
      break;
    case "do-create-tag":
      doCreateTag(el);
      break;
    case "do-update-tag":
      doUpdateTag(id, el);
      break;
    case "do-delete-tag":
      doDeleteTag(id, el);
      break;

    // Tag chip removal in transaction forms
    case "remove-tag-chip":
      el.closest(".tag-chip")?.remove();
      break;

    // Goals
    case "show-create-goal":
      showCreateGoalModal();
      break;
    case "show-contribute":
      showContributeModal(id, name);
      break;
    case "show-edit-goal":
      showEditGoalModal(id);
      break;
    case "confirm-delete-goal":
      confirmDeleteGoal(id, name);
      break;
    case "do-create-goal":
      doCreateGoal(el);
      break;
    case "do-update-goal":
      doUpdateGoal(id, el);
      break;
    case "do-contribute-goal":
      doContributeToGoal(id, el);
      break;
    case "do-delete-goal":
      doDeleteGoal(id, el);
      break;

    // Budgets
    case "show-create-budget":
      showCreateBudgetModal();
      break;
    case "show-edit-budget":
      showEditBudgetModal(id);
      break;
    case "confirm-delete-budget":
      confirmDeleteBudget(id, name);
      break;
    case "do-create-budget":
      doCreateBudget(el);
      break;
    case "do-update-budget":
      doUpdateBudget(id, el);
      break;
    case "do-delete-budget":
      doDeleteBudget(id, el);
      break;

    // AI info banner
    case "dismiss-ai-banner":
      e.target.closest(".ai-info-banner")?.remove();
      break;
    case "load-report":
      loadReport();
      break;

    // Settings
    case "toggle-key-visibility":
      toggleKeyVisibility();
      break;
    case "save-ai-settings":
      saveAISettings();
      break;
    case "review-ai-consent":
      showAIConsentModal("settings");
      break;
    case "confirm-ai-consent":
      confirmAIConsent(el.dataset.source || "settings");
      break;
    case "revoke-ai-consent":
      revokeAIConsent();
      break;
    case "test-ai-connection":
      testAIConnection();
      break;
    case "export-backup":
      exportBackup();
      break;
    case "load-sample-data":
      loadSampleData();
      break;
    case "export-csv":
      exportCSV();
      break;
    case "export-pdf":
      exportAllPDF();
      break;
    case "gdrive-sync":
      runGdriveSync();
      break;
    case "gdrive-connect":
      connectGmail();
      break;
    case "gdrive-disconnect":
      gdriveDisconnect();
      break;
    case "gdrive-enable":
      gdriveEnable();
      break;
    case "gdrive-delete-backup":
      if (e.target.disabled || e.target.getAttribute("aria-disabled") === "true") return;
      gdriveDeleteBackup();
      break;
    case "gdrive-toggle-auto":
      GDrive.setEnabled(el.checked);
      break;
    case "gdrive-toggle-backup-api-key":
      if (e.target.checked) {
        localStorage.setItem(GDRIVE_BACKUP_API_KEY_KEY, "true");
      } else {
        localStorage.removeItem(GDRIVE_BACKUP_API_KEY_KEY);
      }
      break;
    case "save-gmail-senders":
      saveGmailSenders();
      break;
    case "toggle-trusted-device": {
      const checked = /** @type {HTMLInputElement} */ (el).checked;
      if (checked) {
        localStorage.setItem(TRUSTED_DEVICE_KEY, "true");
        localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
        Toast.success("Trusted device enabled — data will persist indefinitely.");
      } else {
        localStorage.removeItem(TRUSTED_DEVICE_KEY);
        localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
        Toast.info("Trusted device disabled — data expires after 6 hours of inactivity.");
      }
      renderSettings();
      break;
    }

    // Onboarding wizard
    case "onboarding-next": {
      const step = Number.parseInt(el.dataset.step, 10);
      if (step >= 5) {
        completeOnboarding();
        Router.navigate("#/");
      } else {
        onboardingAdvance(step + 1);
      }
      break;
    }
    case "onboarding-skip":
      completeOnboarding();
      Router.navigate("#/");
      break;
    case "onboarding-step-skip": {
      const next = Number.parseInt(el.dataset.next, 10);
      onboardingAdvance(next);
      break;
    }
    case "onboarding-create-account":
      onboardingCreateAccount(el);
      break;
    case "onboarding-connect-gmail":
      onboardingConnectGmail();
      break;
    case "onboarding-setup-ai":
      completeOnboarding();
      Router.navigate("#/settings?onboarding=1");
      break;
    case "onboarding-goto":
      completeOnboarding();
      Router.navigate(el.dataset.href);
      break;
    case "restart-onboarding":
      localStorage.removeItem(ONBOARDED_KEY);
      localStorage.removeItem(ONBOARDING_STEP_KEY);
      renderOnboardingStep(1);
      break;

    // Vault
    case "unlock-vault":
      doUnlockVault();
      break;
    case "unlock-biometric":
      doUnlockWithBiometric();
      break;
    case "vault-forgot-passphrase":
      showVaultForgotModal();
      break;
    case "vault-setup":
      showVaultSetupModal();
      break;
    case "do-setup-vault":
      doSetupVault();
      break;
    case "close-vault-setup-modal":
      clearPendingGmailConnect();
      document.getElementById("vault-setup-modal")?.remove();
      break;
    case "vault-change-passphrase":
      showChangePassphraseModal();
      break;
    case "do-change-passphrase":
      doChangePassphrase();
      break;
    case "close-vault-change-modal":
      document.getElementById("vault-change-modal")?.remove();
      break;
    case "vault-reset":
      showVaultForgotModal();
      break;
    case "do-reset-vault":
      doResetVault();
      break;
    case "vault-lock":
      doLockVault();
      break;
    case "close-vault-forgot-modal":
      document.getElementById("vault-forgot-modal")?.remove();
      break;
    case "enable-biometric":
      doSetupBiometric();
      break;
    case "disable-biometric":
      doDisableBiometric();
      break;
    case "do-confirm-biometric-setup":
      doConfirmBiometricSetup();
      break;
    case "close-biometric-setup-modal":
      document.getElementById("biometric-setup-modal")?.remove();
      break;
  }
});

document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-change]");
  if (!el) return;
  switch (el.dataset.change) {
    case "provider-change":
      onProviderChange();
      break;
    case "import-backup":
      importBackup(el.files[0]);
      break;
    case "followup-due-date":
      saveFollowUpDueDate(el.dataset.id, el);
      break;
    case "toggle-followup-recurring":
      toggleFollowUpRecurring(el.dataset.id, el);
      break;
    case "followup-recurrence":
      saveFollowUpRecurrence(el.dataset.id, el);
      break;
    case "toggle-followup-form": {
      const form = document.getElementById("edit-followup-form");
      if (form)
        form.style.display = /** @type {HTMLInputElement} */ (e.target).checked ? "" : "none";
      break;
    }
    case "toggle-followup-recurrence-select": {
      const grp = document.getElementById("edit-followup-recurrence-group");
      if (grp) grp.style.display = /** @type {HTMLInputElement} */ (e.target).checked ? "" : "none";
      break;
    }
    case "toggle-excluded-from-expenses":
      API.toggleExcludedFromExpenses(Number.parseInt(el.dataset.id, 10), el.checked).catch((err) =>
        Toast.error(err.message),
      );
      break;
    case "toggle-excluded-from-income":
      API.toggleExcludedFromIncome(Number.parseInt(el.dataset.id, 10), el.checked).catch((err) =>
        Toast.error(err.message),
      );
      break;
    case "gmail-toggle-auto-sync": {
      const isChecked = /** @type {HTMLInputElement} */ (e.target).checked;
      if (isChecked) {
        localStorage.setItem(GMAIL_AUTO_SYNC_ENABLED_KEY, "true");
      } else {
        localStorage.removeItem(GMAIL_AUTO_SYNC_ENABLED_KEY);
      }
      break;
    }
  }
});

document.addEventListener("keydown", (e) => {
  const el = e.target.closest("[data-keydown]");
  if (!el) return;
  switch (el.dataset.keydown) {
    case "chat-input":
      chatInputKeydown(e);
      break;
  }
});

// ============================================================================
// Tooltip viewport overflow correction (all .info-notice elements)
// Prevents tooltips from being clipped at either screen edge on mobile.
// ============================================================================

function fixTooltipOverflow(noticeEl) {
  const tooltip = noticeEl.querySelector(".info-notice-tooltip");
  if (!tooltip) return;
  // Reset any previous inline correction so we measure the natural CSS position
  tooltip.style.transform = "";
  const tRect = tooltip.getBoundingClientRect();
  const vw = window.innerWidth;
  const margin = 8;
  let shift = 0;
  if (tRect.left < margin) {
    shift = margin - tRect.left;
  } else if (tRect.right > vw - margin) {
    shift = vw - margin - tRect.right;
  }
  if (shift !== 0) {
    tooltip.style.transform = `translateX(calc(-50% + ${shift}px))`;
  }
}

// Delegated listeners — mouseenter for desktop, focusin for keyboard/mobile
document.addEventListener(
  "mouseenter",
  (e) => {
    if (!(e.target instanceof Element)) return;
    const notice = e.target.closest(".info-notice");
    if (notice) fixTooltipOverflow(notice);
  },
  true,
);
document.addEventListener("focusin", (e) => {
  if (!(e.target instanceof Element)) return;
  const notice = e.target.closest(".info-notice");
  if (notice) fixTooltipOverflow(notice);
});

document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element)) return;
  if (!document.body.classList.contains("privacy-active")) return;
  if (e.target.closest(".amount-private")) {
    revealPrivacy();
  }
});

// ============================================================================
// Theme management
// ============================================================================

const Theme = {
  KEY: "fincoach-theme",

  init() {
    const saved = localStorage.getItem(this.KEY);
    if (saved) {
      this.apply(saved);
    } else {
      const preferLight = window.matchMedia("(prefers-color-scheme: light)").matches;
      this.apply(preferLight ? "light" : "dark");
    }
  },

  apply(theme) {
    document.body.classList.toggle("light", theme === "light");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "light" ? "#FFFFFF" : "#1E1E1E";
    // Update toggle icon if present
    const btn = document.querySelector(".theme-toggle");
    if (btn) btn.textContent = theme === "light" ? "🌙" : "☀️";
  },

  toggle() {
    const isLight = document.body.classList.contains("light");
    const newTheme = isLight ? "dark" : "light";
    localStorage.setItem(this.KEY, newTheme);
    this.apply(newTheme);
  },
};

// ============================================================================
// Toast notifications
// ============================================================================

const Toast = {
  container: null,

  init() {
    this.container = document.createElement("div");
    this.container.className = "toast-container";
    document.body.appendChild(this.container);
  },

  show(message, type = "info", duration = 3000) {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${escapeHtml(message)}</span><button class="toast-close">&times;</button>`;
    el.querySelector(".toast-close").onclick = () => el.remove();
    if (!this.container) this.init();
    this.container.appendChild(el);
    if (type !== "error") {
      setTimeout(() => el.remove(), duration);
    }
  },

  success(msg) {
    this.show(msg, "success");
  },
  error(msg) {
    this.show(msg, "error", 0);
  },
  info(msg) {
    this.show(msg, "info");
  },
  clearAll() {
    if (this.container) this.container.innerHTML = "";
  },
  infoAction(msg, btnLabel, btnFn) {
    const el = document.createElement("div");
    el.className = "toast info";
    const span = document.createElement("span");
    span.textContent = msg;
    const actionBtn = document.createElement("button");
    actionBtn.className = "btn btn-sm";
    actionBtn.style.marginLeft = "var(--space-sm)";
    actionBtn.textContent = btnLabel;
    actionBtn.onclick = () => {
      el.remove();
      btnFn();
    };
    const closeBtn = document.createElement("button");
    closeBtn.className = "toast-close";
    closeBtn.textContent = "×";
    closeBtn.onclick = () => el.remove();
    el.append(span, actionBtn, closeBtn);
    if (!this.container) this.init();
    this.container.appendChild(el);
    setTimeout(() => el.remove(), 8000);
  },
};

// ============================================================================
// Header Status Bar
// ============================================================================

const StatusBar = {
  _el() {
    return document.getElementById("header-status");
  },
  clear() {
    const el = this._el();
    if (!el) return;
    el.textContent = "";
    el.classList.remove("syncing");
  },
  set(text, syncing = false) {
    const el = this._el();
    if (!el) return;
    el.textContent = text;
    if (syncing) {
      el.classList.add("syncing");
    } else {
      el.classList.remove("syncing");
    }
  },
};

// ============================================================================
// AI Info Banner (no-key mode)
// ============================================================================

function _buildAiInfoBanner(text) {
  const div = document.createElement("div");
  div.className = "ai-info-banner";
  const p = document.createElement("p");
  p.textContent = text;
  const btn = document.createElement("button");
  btn.className = "dismiss-btn";
  btn.setAttribute("data-action", "dismiss-ai-banner");
  btn.setAttribute("aria-label", "Dismiss");
  btn.textContent = "×";
  div.append(p, btn);
  return div;
}

// ============================================================================
// Simple Router
// ============================================================================

const Router = {
  routes: {},
  currentScreen: null,

  register(hash, renderFn) {
    this.routes[hash] = renderFn;
  },

  navigate(hash) {
    window.location.hash = hash;
  },

  async resolve() {
    const hash = (window.location.hash || "#/").split("?")[0];
    if (!this.routes[hash]) {
      window.location.hash = "#/";
      return;
    }
    const renderFn = this.routes[hash];
    if (renderFn) {
      // Cleanup scroll handler from transactions screen
      if (window._txScrollHandler) {
        window.removeEventListener("scroll", window._txScrollHandler);
        window._txScrollHandler = null;
      }
      // Cleanup report charts
      destroyReportCharts();
      this.currentScreen = hash;
      Toast.clearAll();
      await renderFn();
      this.updateNav();
    }
  },

  updateNav() {
    for (const el of document.querySelectorAll(".nav-item")) {
      const target = el.dataset.route;
      const isActive =
        target === "#/"
          ? this.currentScreen === "#/"
          : this.currentScreen === target || this.currentScreen.startsWith(`${target}/`);
      el.classList.toggle("active", isActive);
    }
    // Update overflow menu items active state and derive overflowActive
    let overflowActive = false;
    for (const el of document.querySelectorAll(".nav-overflow-menu .nav-overflow-item")) {
      const target = el.dataset.route;
      const isActive =
        target === "#/"
          ? this.currentScreen === "#/"
          : this.currentScreen === target || this.currentScreen.startsWith(`${target}/`);
      el.classList.toggle("active", isActive);
      if (isActive) overflowActive = true;
    }
    // Highlight More button when an overflow item is the current route
    const moreBtn = document.querySelector(".nav-more-btn");
    if (moreBtn) moreBtn.classList.toggle("active", overflowActive);
    // Show/hide chat action buttons in header
    const chatBtnIds = ["chat-history-btn", "chat-new-btn", "chat-clear-btn"];
    if (this.currentScreen === "#/chat") {
      const header = document.querySelector(".app-header");
      if (header && !document.getElementById("chat-history-btn")) {
        const histBtn = document.createElement("button");
        histBtn.id = "chat-history-btn";
        histBtn.className = "chat-clear-btn";
        histBtn.title = "Chat history";
        histBtn.textContent = "📋";
        histBtn.onclick = showChatSessions;
        header.appendChild(histBtn);

        const newBtn = document.createElement("button");
        newBtn.id = "chat-new-btn";
        newBtn.className = "chat-clear-btn";
        newBtn.title = "New chat";
        newBtn.textContent = "✚";
        newBtn.onclick = startNewChat;
        header.appendChild(newBtn);

        const clearBtn = document.createElement("button");
        clearBtn.id = "chat-clear-btn";
        clearBtn.className = "chat-clear-btn";
        clearBtn.title = "Clear chat";
        clearBtn.textContent = "🗑";
        clearBtn.onclick = confirmClearChat;
        header.appendChild(clearBtn);
      }
      for (const id of chatBtnIds) {
        const el = document.getElementById(id);
        if (el) el.style.display = "";
      }
    } else {
      for (const id of chatBtnIds) {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
      }
    }
    // Reset screen-content styles when leaving chat
    const screen = document.getElementById("screen");
    if (screen && this.currentScreen !== "#/chat") {
      screen.style.padding = "";
      screen.style.paddingBottom = "";
      screen.style.maxWidth = "";
    }
  },

  init() {
    window.addEventListener("hashchange", () => this.resolve());
    this.resolve();
  },
};

// ============================================================================
// App Layout (header + nav + content area)
// ============================================================================

function renderLayout() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <header class="app-header">
      <span class="header-title">FinCoach</span>
      <div class="header-status" id="header-status"></div>
      <button class="privacy-toggle" id="privacy-toggle-btn" data-action="toggle-privacy-reveal" title="Reveal amounts">👁</button>
      <button class="theme-toggle" data-action="theme-toggle" title="Toggle theme"></button>
    </header>
    <main class="screen-content" id="screen"></main>
    <nav class="bottom-nav">
      <button class="nav-item" data-route="#/" data-action="nav-navigate">
        <span class="nav-icon">🏠</span>
        <span>Home</span>
      </button>
      <button class="nav-item" data-route="#/transactions" data-action="nav-navigate">
        <span class="nav-icon">💳</span>
        <span>Transactions</span>
      </button>
      <button class="nav-item" data-route="#/accounts" data-action="nav-navigate">
        <span class="nav-icon">🏦</span>
        <span>Accounts</span>
      </button>
      <button class="nav-item" data-route="#/sync" data-action="nav-navigate">
        <span class="nav-icon">📧</span>
        <span>Sync</span>
      </button>
      <button class="nav-more-btn" data-action="toggle-overflow-menu" title="More">
        <span class="nav-icon">☰</span>
        <span>More</span>
      </button>
    </nav>
    <div class="nav-overflow-backdrop" data-action="overflow-backdrop"></div>
    <div class="nav-overflow-menu">
      <button class="nav-overflow-item" data-route="#/chat" data-action="nav-overflow-navigate">
        <span class="nav-icon">💬</span>
        <span>Chat</span>
      </button>
      <button class="nav-overflow-item" data-route="#/reports" data-action="nav-overflow-navigate">
        <span class="nav-icon">📊</span>
        <span>Reports</span>
      </button>
      <button class="nav-overflow-item" data-route="#/goals" data-action="nav-overflow-navigate">
        <span class="nav-icon">🎯</span>
        <span>Goals</span>
      </button>
      <button class="nav-overflow-item" data-route="#/budgets" data-action="nav-overflow-navigate">
        <span class="nav-icon">💰</span>
        <span>Budgets</span>
      </button>
      <button class="nav-overflow-item" data-route="#/taxonomy" data-action="nav-overflow-navigate">
        <span class="nav-icon">🏷️</span>
        <span>Taxonomy</span>
      </button>
      <button class="nav-overflow-item" data-route="#/settings" data-action="nav-overflow-navigate">
        <span class="nav-icon">⚙️</span>
        <span>Settings</span>
      </button>
    </div>
  `;

  // Close overflow menu on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverflowMenu();
  });
}

function toggleOverflowMenu() {
  const menu = document.querySelector(".nav-overflow-menu");
  const backdrop = document.querySelector(".nav-overflow-backdrop");
  if (menu && backdrop) {
    menu.classList.toggle("open");
    backdrop.classList.toggle("open");
  }
}

function closeOverflowMenu() {
  const menu = document.querySelector(".nav-overflow-menu");
  const backdrop = document.querySelector(".nav-overflow-backdrop");
  if (menu) menu.classList.remove("open");
  if (backdrop) backdrop.classList.remove("open");
}

function getScreen() {
  return document.getElementById("screen");
}

// ============================================================================
// Screen: Dashboard
// ============================================================================

async function renderDashboard() {
  const screen = getScreen();
  screen.innerHTML = `<div class="spinner"></div>`;

  try {
    const [accounts, transactions, upcomingBills] = await Promise.all([
      API.getAccounts(),
      API.getTransactions({ date_from: daysAgoISO(30), date_to: todayISO() }),
      API.getUpcomingBills(7),
    ]);

    // Compute totals
    const totalBalance = accounts.reduce((s, a) => {
      const bal = a.effective_balance ?? a.balance;
      return s + (a.account_type === "credit" ? -bal : bal);
    }, 0);
    const monthStart = firstOfMonthISO();
    const monthTx = transactions.filter((t) => t.date >= monthStart);
    const income = monthTx
      .filter((t) => t.transaction_type === "income")
      .reduce((s, t) => s + t.amount, 0);
    const expenses = monthTx
      .filter((t) => t.transaction_type === "expense" && !t.excluded_from_expenses)
      .reduce((s, t) => s + t.amount, 0);
    const recent = transactions.slice(0, 10);

    screen.innerHTML = `
      <div class="card" style="text-align:center">
        <div class="balance-label">Total Balance</div>
        <div class="balance-amount">${privacyAmount(formatCurrency(totalBalance))}</div>
        <div class="balance-label">${accounts.length} account${accounts.length !== 1 ? "s" : ""}</div>
      </div>

      <div class="stats-row">
        <div class="stat-card income">
          <div class="stat-value">${privacyAmount(formatCurrency(income))}</div>
          <div class="stat-label">Income this month</div>
        </div>
        <div class="stat-card expense">
          <div class="stat-value">${privacyAmount(formatCurrency(Math.abs(expenses)))}</div>
          <div class="stat-label">Expenses this month</div>
        </div>
      </div>

      <div class="card" style="margin-top:var(--space-md)">
        <div class="card-title">Upcoming Bills</div>
        ${
          upcomingBills.length === 0
            ? `<div class="empty-state-small">No upcoming bills in the next 7 days</div>`
            : `<ul class="bills-list">${upcomingBills.map(billItemHTML).join("")}</ul>`
        }
      </div>

      <div class="card" style="margin-top:var(--space-md)">
        <div class="card-title">Recent Transactions</div>
        ${
          recent.length === 0
            ? `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No recent transactions</div></div>`
            : `<ul class="tx-list">${recent.map((t) => txItemHTML(t)).join("")}</ul>`
        }
      </div>
    `;
  } catch (err) {
    screen.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function txItemHTML(t) {
  const desc = t.merchant_name || t.merchant_upi_id || t.description || "Transaction";
  const catName = t.category ? t.category.name : "";
  const meta = formatDate(t.date);
  return `
    <li class="tx-item" data-action="show-edit-tx" data-id="${t.id}">
      <div class="tx-icon">${categoryIcon(catName)}</div>
      <div class="tx-details">
        <div class="tx-desc">${escapeHtml(truncate(desc))}</div>
        <div class="tx-meta">${escapeHtml(meta)}</div>
        ${(t.notes || t.description) && (t.merchant_name || t.merchant_upi_id) ? `<div class="tx-note">${escapeHtml(truncate(t.notes || t.description, 60))}</div>` : ""}
      </div>
      <div class="tx-amount ${t.transaction_type}">${t.transaction_type === "income" ? "+" : ""}${privacyAmount(formatCurrency(t.amount))}</div>
    </li>
  `;
}

function billItemHTML(bill) {
  const dr = bill.days_remaining;
  let urgencyClass;
  let label;
  if (dr < 3) {
    urgencyClass = "bill-row--urgent";
    label = dr < 0 ? "Overdue" : dr === 0 ? "Due today" : `${dr}d`;
  } else if (dr <= 5) {
    urgencyClass = "bill-row--warning";
    label = `${dr}d`;
  } else {
    urgencyClass = "bill-row--ok";
    label = `${dr}d`;
  }
  const name =
    bill.title || bill.merchant_name || bill.merchant_upi_id || bill.description || "Follow-up";
  return `
    <li class="bill-row ${urgencyClass}" data-action="open-tx-from-followup" data-id="${bill.transaction_id}">
      <div class="bill-row-name">${escapeHtml(name)}</div>
      <div class="bill-row-meta">
        ${bill.amount != null ? `<span class="bill-row-amount">${formatCurrency(bill.amount)}</span>` : ""}
        <span class="bill-days-badge ${urgencyClass}">${escapeHtml(label)}</span>
      </div>
    </li>
  `;
}

function followUpRowHTML(f) {
  const name = f.title || f.merchant_name || f.merchant_upi_id || f.description || "Follow-up";
  const typeLabel = FOLLOWUP_TYPE_LABELS[f.follow_up_type] || f.follow_up_type;
  const isDone = f.status === "done";
  const dr = f.days_remaining;
  let dueBadge = "";
  if (!isDone && dr !== null && dr !== undefined) {
    let cls = "bill-row--ok";
    let label = `${dr}d`;
    if (dr < 3) {
      cls = "bill-row--urgent";
      label = dr < 0 ? "Overdue" : dr === 0 ? "Due today" : `${dr}d`;
    } else if (dr <= 5) {
      cls = "bill-row--warning";
    }
    dueBadge = `<span class="bill-days-badge ${cls}">${escapeHtml(label)}</span>`;
  } else if (isDone) {
    dueBadge = `<span class="bill-days-badge bill-row--ok">Done</span>`;
  }
  const recurrenceOptions = FOLLOWUP_RECURRENCES.map(
    (r) =>
      `<option value="${r.value}" ${f.recurrence === r.value ? "selected" : ""}>${r.label}</option>`,
  ).join("");
  return `
    <div class="bill-mgmt-row" data-followup-id="${f.id}">
      <div class="bill-mgmt-name">
        <strong>${escapeHtml(name)}</strong>
        <span class="bill-mgmt-meta">
          ${f.amount != null ? `${formatCurrency(f.amount)} · ` : ""}${escapeHtml(typeLabel)}
          ${dueBadge}
        </span>
      </div>
      <div class="bill-mgmt-controls">
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem">Due date</label>
          <input type="date" class="form-control form-control-sm" value="${f.due_date || ""}"
            data-change="followup-due-date" data-id="${f.id}" ${isDone ? "disabled" : ""}>
        </div>
        <div class="bill-mgmt-toggle" title="Repeat this follow-up">
          <span>Recurring</span>
          <label class="toggle-switch">
            <input type="checkbox" ${f.is_recurring ? "checked" : ""}
              data-change="toggle-followup-recurring" data-id="${f.id}">
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${
          f.is_recurring
            ? `<div class="form-group" style="margin:0">
          <label style="font-size:0.75rem">Every</label>
          <select class="form-control form-control-sm" data-change="followup-recurrence"
            data-id="${f.id}">${recurrenceOptions}</select>
        </div>`
            : ""
        }
        <div class="bill-mgmt-actions">
          ${
            isDone
              ? `<button class="btn btn-outline btn-sm" data-action="reopen-followup" data-id="${f.id}">Reopen</button>`
              : `<button class="btn btn-primary btn-sm" data-action="mark-followup-done" data-id="${f.id}">Mark done</button>`
          }
          <button class="btn btn-outline btn-sm" data-action="open-tx-from-followup" data-id="${f.transaction_id}">Open</button>
          <button class="btn btn-outline btn-sm" data-action="remove-followup" data-id="${f.id}">Remove</button>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// Screen: Transactions
// ============================================================================

const _merchantCache = new Map();

const txFilterState = {
  date_from: firstOfMonthISO(),
  date_to: todayISO(),
  transaction_type: "",
  account_id: "",
  category_id: "",
  show_merged_accounts: false,
  tag_ids: [],
};

const TX_PAGE_SIZE = 50;
let txTab = "transactions"; // "transactions" | "bills"
let followUpFilter = "pending"; // "pending" | "done" | "all"
let txOffset = 0;
let txHasMore = true;
let txLoading = false;
let privacyRevealTimer = null;

async function renderTransactions() {
  const screen = getScreen();
  screen.innerHTML = `<div class="spinner"></div>`;

  try {
    const tabBar = `
      <div class="tab-bar">
        <button class="tab-btn ${txTab === "transactions" ? "active" : ""}"
          data-action="switch-tx-tab" data-mode="transactions">Transactions</button>
        <button class="tab-btn ${txTab === "bills" ? "active" : ""}"
          data-action="switch-tx-tab" data-mode="bills">Bills &amp; Reminders</button>
      </div>`;

    if (txTab === "bills") {
      screen.innerHTML = `${tabBar}<div id="tx-tab-content"><div class="spinner"></div></div>`;
      renderBillsPanel();
      return;
    }

    const [accounts, categories, allTags] = await Promise.all([
      API.getAccounts(true),
      API.getCategories(),
      API.getTags(),
    ]);

    // Cache for edit modal
    window._appAccounts = accounts;
    window._appCategories = categories;
    window._appTags = allTags;

    screen.innerHTML = `
      ${tabBar}
      <div id="tx-tab-content">
      <div class="card">
        <div class="card-title">Filters</div>
        <div class="filter-bar">
          <input type="date" class="form-control" id="f-from" value="${txFilterState.date_from}">
          <input type="date" class="form-control" id="f-to" value="${txFilterState.date_to}">
        </div>
        <div class="filter-bar">
          <select class="form-control" id="f-type">
            <option value="">All Types</option>
            <option value="expense" ${txFilterState.transaction_type === "expense" ? "selected" : ""}>Expense</option>
            <option value="income" ${txFilterState.transaction_type === "income" ? "selected" : ""}>Income</option>
          </select>
          <select class="form-control" id="f-account">
            <option value="">All Accounts</option>
            ${(txFilterState.show_merged_accounts ? accounts : accounts.filter((a) => !a.merged_into_id)).map((a) => `<option value="${a.id}" ${txFilterState.account_id === String(a.id) ? "selected" : ""}>${escapeHtml(a.name)}${txFilterState.show_merged_accounts && a.merged_into_id ? " (merged)" : ""}</option>`).join("")}
          </select>
          <select class="form-control" id="f-category">
            <option value="">All Categories</option>
            ${categories.map((c) => `<option value="${c.id}" ${txFilterState.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        ${
          allTags.length > 0
            ? `
        <div class="filter-bar">
          <div class="tag-filter-dropdown" id="f-tags-dropdown">
            <button type="button" class="tag-filter-btn" id="f-tags-btn">
              <span id="f-tags-label">${
                txFilterState.tag_ids.length > 0
                  ? txFilterState.tag_ids
                      .map((id) => {
                        const t = allTags.find((x) => x.id === id);
                        return t ? `#${t.name}` : "";
                      })
                      .filter(Boolean)
                      .join(", ")
                  : "Filter by tags"
              }</span>
              <span class="tag-filter-arrow">▾</span>
            </button>
            <div class="tag-filter-menu hidden" id="f-tags-menu">
              ${allTags.map((t) => `<label class="tag-filter-option"><input type="checkbox" value="${t.id}" ${txFilterState.tag_ids.includes(t.id) ? "checked" : ""}> #${escapeHtml(t.name)}</label>`).join("")}
            </div>
          </div>
        </div>`
            : ""
        }
        <div class="filter-toggle">
          <span>Show merged accounts</span>
          <label class="toggle-switch">
            <input type="checkbox" id="f-merged" ${txFilterState.show_merged_accounts ? "checked" : ""}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div id="tx-totals-container"></div>
      <div id="tx-list-container"><div class="spinner"></div></div>
      </div>
      <button class="fab" data-action="nav-navigate" data-route="#/transactions/new" title="Add Transaction">+</button>
      <button class="scroll-top" id="scroll-top-btn" data-action="scroll-top" title="Back to top">↑</button>
    `;

    // Wire filter events
    const applyFilters = () => {
      txFilterState.date_from = document.getElementById("f-from").value;
      txFilterState.date_to = document.getElementById("f-to").value;
      txFilterState.transaction_type = document.getElementById("f-type").value;
      txFilterState.category_id = document.getElementById("f-category").value;
      const prevShowMerged = txFilterState.show_merged_accounts;
      txFilterState.show_merged_accounts = document.getElementById("f-merged").checked;
      // Rebuild account dropdown options when toggle changes
      if (txFilterState.show_merged_accounts !== prevShowMerged) {
        const accountSel = document.getElementById("f-account");
        if (accountSel) {
          const filteredAccounts = txFilterState.show_merged_accounts
            ? accounts
            : accounts.filter((a) => !a.merged_into_id);
          const prevAccountId = accountSel.value;
          accountSel.innerHTML =
            `<option value="">All Accounts</option>` +
            filteredAccounts
              .map(
                (a) =>
                  `<option value="${a.id}"${String(a.id) === prevAccountId ? " selected" : ""}>${escapeHtml(a.name)}${txFilterState.show_merged_accounts && a.merged_into_id ? " (merged)" : ""}</option>`,
              )
              .join("");
          // If previously selected account is a child and we switched to parent-only, clear it
          if (!txFilterState.show_merged_accounts) {
            const stillPresent = filteredAccounts.some((a) => String(a.id) === prevAccountId);
            if (!stillPresent) {
              accountSel.value = "";
            }
          }
        }
      }
      txFilterState.account_id = document.getElementById("f-account").value;
      const tagCheckboxes = document.querySelectorAll("#f-tags-menu input[type=checkbox]");
      txFilterState.tag_ids = [...tagCheckboxes]
        .filter((cb) => cb.checked)
        .map((cb) => Number(cb.value));
      // Update button label
      const label = document.getElementById("f-tags-label");
      if (label) {
        label.textContent =
          txFilterState.tag_ids.length > 0
            ? txFilterState.tag_ids
                .map((id) => {
                  const t = allTags.find((x) => x.id === id);
                  return t ? `#${t.name}` : "";
                })
                .filter(Boolean)
                .join(", ")
            : "Filter by tags";
      }
      txOffset = 0;
      txHasMore = true;
      loadTransactionList(true);
    };

    for (const id of ["f-from", "f-to", "f-type", "f-account", "f-category"]) {
      document.getElementById(id).addEventListener("change", applyFilters);
    }
    document.getElementById("f-merged").addEventListener("change", applyFilters);

    // Tag dropdown toggle
    const tagsBtn = document.getElementById("f-tags-btn");
    const tagsMenu = document.getElementById("f-tags-menu");
    if (tagsBtn && tagsMenu) {
      tagsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        tagsMenu.classList.toggle("hidden");
      });
      tagsMenu.addEventListener("change", applyFilters);
      document.addEventListener("click", function closeTagsMenu(e) {
        if (!tagsBtn.contains(e.target) && !tagsMenu.contains(e.target)) {
          tagsMenu.classList.add("hidden");
        }
      });
    }

    // Infinite scroll + scroll-to-top
    window._txScrollHandler = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = document.documentElement.clientHeight;

      // Infinite scroll
      if (!txLoading && txHasMore) {
        if (scrollTop + clientHeight >= scrollHeight - 200) {
          loadTransactionList(false);
        }
      }
      // Show/hide scroll-to-top button
      const btn = document.getElementById("scroll-top-btn");
      if (btn) {
        btn.classList.toggle("visible", scrollTop > 400);
      }
    };
    window.addEventListener("scroll", window._txScrollHandler);

    txOffset = 0;
    txHasMore = true;
    await loadTransactionList(true);
  } catch (err) {
    screen.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

async function loadTransactionList(reset = true) {
  const container = document.getElementById("tx-list-container");
  if (!container) return;
  if (txLoading) return;
  txLoading = true;

  if (reset) {
    txOffset = 0;
    txHasMore = true;
    container.innerHTML = `<div class="spinner"></div>`;
    // Load totals in parallel
    const totalsContainer = document.getElementById("tx-totals-container");
    if (totalsContainer) {
      const totalsParams = { ...txFilterState };
      totalsParams.include_merged = !txFilterState.show_merged_accounts;
      delete totalsParams.show_merged_accounts;
      if (!totalsParams.account_id) {
        totalsParams.account_id = undefined;
        totalsParams.include_merged = undefined;
      }
      if (!totalsParams.category_id) totalsParams.category_id = undefined;
      API.getTransactionTotals(totalsParams)
        .then((totals) => {
          totalsContainer.innerHTML = `
          <div class="tx-totals-bar">
            <div class="tx-total-item income">
              <span class="tx-total-label">Income</span>
              <span class="tx-total-value">${privacyAmount(formatCurrency(totals.total_income))}</span>
            </div>
            <div class="tx-total-item expense">
              <span class="tx-total-label">Expense</span>
              <span class="tx-total-value">${privacyAmount(formatCurrency(totals.total_expense))}</span>
            </div>
            <div class="tx-total-item net ${totals.net >= 0 ? "income" : "expense"}">
              <span class="tx-total-label">Net</span>
              <span class="tx-total-value">${totals.net >= 0 ? "+" : "-"}${privacyAmount(formatCurrency(totals.net))}</span>
            </div>
          </div>`;
        })
        .catch(() => {
          totalsContainer.innerHTML = "";
        });
    }
  }

  try {
    const params = { ...txFilterState, limit: TX_PAGE_SIZE, offset: txOffset };
    params.include_merged = !txFilterState.show_merged_accounts;
    delete params.show_merged_accounts;
    if (!params.account_id) {
      params.account_id = undefined;
      params.include_merged = undefined;
    }
    if (!params.category_id) params.category_id = undefined;
    const transactions = await API.getTransactions(params);

    if (reset && transactions.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No transactions found</div></div>`;
      txLoading = false;
      return;
    }

    if (transactions.length < TX_PAGE_SIZE) {
      txHasMore = false;
    }
    txOffset += transactions.length;

    const itemsHTML = transactions
      .map(
        (t) => `
      <li class="tx-item">
        <div class="tx-icon" data-action="show-edit-tx" data-id="${t.id}">${categoryIcon(t.category ? t.category.name : t.category_name || "")}</div>
        <div class="tx-details" data-action="show-edit-tx" data-id="${t.id}">
          <div class="tx-desc">${escapeHtml(truncate(t.merchant_name || t.merchant_upi_id || t.description || "Transaction"))}</div>
          <div class="tx-meta">${escapeHtml(formatDate(t.date))}</div>
          ${(t.notes || t.description) && (t.merchant_name || t.merchant_upi_id) ? `<div class="tx-note">${escapeHtml(truncate(t.notes || t.description, 60))}</div>` : ""}
        </div>
        <div class="tx-amount ${t.transaction_type}" data-action="show-edit-tx" data-id="${t.id}">${t.transaction_type === "income" ? "+" : ""}${privacyAmount(formatCurrency(t.amount))}</div>
        <button class="tx-delete" data-action="confirm-delete-tx" data-id="${t.id}" title="Delete">🗑</button>
      </li>
    `,
      )
      .join("");

    if (reset) {
      container.innerHTML = `<div class="card"><ul class="tx-list" id="tx-ul">${itemsHTML}</ul></div>`;
    } else {
      const ul = document.getElementById("tx-ul");
      if (ul) ul.insertAdjacentHTML("beforeend", itemsHTML);
    }

    // Remove any existing "end" indicator and add if no more
    const existing = container.querySelector(".tx-end-msg");
    if (existing) existing.remove();
    if (!txHasMore && txOffset > 0) {
      container.insertAdjacentHTML(
        "beforeend",
        `<div class="tx-end-msg empty-state" style="padding:var(--space-md)"><div class="empty-text">All ${txOffset} transactions loaded</div></div>`,
      );
    }
  } catch (err) {
    if (reset) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
    } else {
      Toast.error(err.message);
    }
  } finally {
    txLoading = false;
  }
}

function switchTxTab(mode) {
  txTab = mode;
  renderTransactions();
}

function refreshTransactionsScreen() {
  if (Router.currentScreen !== "#/transactions") return;
  if (txTab === "bills") renderBillsPanel();
  else loadTransactionList(true);
}

async function renderBillsPanel() {
  const container = document.getElementById("tx-tab-content");
  if (!container) return;
  try {
    const status = followUpFilter === "all" ? undefined : followUpFilter;
    const followUps = await API.getFollowUps({ status });
    const chip = (value, label) =>
      `<button class="tab-btn ${followUpFilter === value ? "active" : ""}"
        data-action="filter-followups" data-filter="${value}">${label}</button>`;
    const filterBar = `
      <div class="followup-filter-bar">
        ${chip("pending", "Pending")}
        ${chip("done", "Done")}
        ${chip("all", "All")}
      </div>`;

    if (followUps.length === 0) {
      container.innerHTML = `
        ${filterBar}
        <div class="empty-state">
          <div class="empty-icon">🔔</div>
          <div class="empty-text">No follow-ups here yet. Open any transaction and flag it for follow-up to track bills, refunds, or recurring payments.</div>
        </div>`;
      return;
    }
    container.innerHTML = `
      ${filterBar}
      <div class="card">
        ${followUps.map(followUpRowHTML).join("")}
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function filterFollowUps(filter) {
  followUpFilter = filter;
  renderBillsPanel();
}

async function saveFollowUpDueDate(id, el) {
  try {
    await API.updateFollowUp(Number(id), { due_date: el.value || null });
    Toast.success("Due date updated");
    renderBillsPanel();
  } catch (err) {
    Toast.error(err.message);
  }
}

async function toggleFollowUpRecurring(id, el) {
  try {
    await API.updateFollowUp(Number(id), { is_recurring: el.checked });
    renderBillsPanel();
  } catch (err) {
    Toast.error(err.message);
    el.checked = !el.checked;
  }
}

async function saveFollowUpRecurrence(id, el) {
  try {
    await API.updateFollowUp(Number(id), { recurrence: el.value });
    Toast.success("Recurrence updated");
    renderBillsPanel();
  } catch (err) {
    Toast.error(err.message);
  }
}

async function markFollowUpDone(id) {
  try {
    await API.markFollowUpDone(Number(id));
    Toast.success("Marked done");
    renderBillsPanel();
    if (Router.currentScreen === "#/") renderDashboard();
  } catch (err) {
    Toast.error(err.message);
  }
}

async function reopenFollowUp(id) {
  try {
    await API.reopenFollowUp(Number(id));
    Toast.success("Follow-up reopened");
    renderBillsPanel();
  } catch (err) {
    Toast.error(err.message);
  }
}

async function removeFollowUp(id) {
  try {
    await API.deleteFollowUp(Number(id));
    Toast.success("Follow-up removed");
    renderBillsPanel();
    if (Router.currentScreen === "#/") renderDashboard();
  } catch (err) {
    Toast.error(err.message);
  }
}

// ============================================================================
// Export Transactions
// ============================================================================

async function exportTransactions(format) {
  if (format === "pdf") {
    exportPDF();
    return;
  }
  const params = {
    format,
    start_date: txFilterState.date_from || undefined,
    end_date: txFilterState.date_to || undefined,
  };
  if (txFilterState.account_id) params.account_id = txFilterState.account_id;
  if (txFilterState.category_id) params.category_id = txFilterState.category_id;
  if (txFilterState.tag_ids && txFilterState.tag_ids.length > 0)
    params.tag_ids = txFilterState.tag_ids;
  await API.exportTransactionsUrl(params);
}

async function exportPDF() {
  try {
    // Build params from current filter state (same normalization as loadTransactionList)
    const params = {
      ...txFilterState,
      limit: 10000,
      offset: 0,
    };
    params.include_merged = !txFilterState.show_merged_accounts;
    delete params.show_merged_accounts;
    if (!params.account_id) {
      params.account_id = undefined;
      params.include_merged = undefined;
    }
    if (!params.category_id) params.category_id = undefined;

    const totalsParams = { ...txFilterState };
    totalsParams.include_merged = !txFilterState.show_merged_accounts;
    delete totalsParams.show_merged_accounts;
    if (!totalsParams.account_id) {
      totalsParams.account_id = undefined;
      totalsParams.include_merged = undefined;
    }
    if (!totalsParams.category_id) totalsParams.category_id = undefined;

    const [transactions, totals] = await Promise.all([
      API.getTransactions(params),
      API.getTransactionTotals(totalsParams),
    ]);

    // Build human-readable filter summary
    const accounts = window._appAccounts || [];
    const categories = window._appCategories || [];
    const filterParts = [];
    if (txFilterState.account_id) {
      const acct = accounts.find((a) => String(a.id) === String(txFilterState.account_id));
      filterParts.push(`Account: ${acct ? escapeHtml(acct.name) : txFilterState.account_id}`);
    }
    if (txFilterState.date_from || txFilterState.date_to) {
      const from = txFilterState.date_from ? formatDate(txFilterState.date_from) : "—";
      const to = txFilterState.date_to ? formatDate(txFilterState.date_to) : "—";
      filterParts.push(`Period: ${from} – ${to}`);
    }
    if (txFilterState.transaction_type) {
      const typeLabel = txFilterState.transaction_type === "income" ? "Income" : "Expense";
      filterParts.push(`Type: ${typeLabel}`);
    }
    if (txFilterState.category_id) {
      const cat = categories.find((c) => String(c.id) === String(txFilterState.category_id));
      filterParts.push(`Category: ${cat ? escapeHtml(cat.name) : txFilterState.category_id}`);
    }
    if (txFilterState.tag_ids && txFilterState.tag_ids.length > 0) {
      const allTags = window._appTags || [];
      const tagNames = txFilterState.tag_ids
        .map((tid) => {
          const found = allTags.find((t) => t.id === tid);
          return found ? `#${found.name}` : `#${tid}`;
        })
        .join(", ");
      filterParts.push(`Tags: ${tagNames}`);
    }
    const filterSummary = filterParts.length > 0 ? filterParts.join(" | ") : "All transactions";

    // Build table rows
    const rows = transactions
      .map((tx) => {
        const amtClass = tx.transaction_type === "income" ? "amount-income" : "amount-expense";
        const tagStr =
          tx.tags && tx.tags.length > 0 ? tx.tags.map((tg) => `#${tg.name}`).join(" ") : "";
        return `<tr>
                <td>${escapeHtml(formatDate(tx.date))}</td>
                <td>${escapeHtml(tx.description || "")}</td>
                <td>${escapeHtml(tx.merchant_name || "")}</td>
                <td>${escapeHtml(tx.category?.name || tx.category_name || "")}</td>
                <td>${escapeHtml(tx.account_name || "")}</td>
                <td class="${amtClass}">${formatCurrency(tx.amount)}</td>
                <td>${escapeHtml(tagStr)}</td>
            </tr>`;
      })
      .join("");

    // Build totals footer
    const income = totals?.total_income ?? 0;
    const expense = totals?.total_expense ?? 0;
    const net = totals?.net ?? 0;

    const html = `
            <div class="print-header">
                <h1>Financial Coach — Transactions</h1>
                <p>Exported: ${formatDate(todayISO())}</p>
                <p>${escapeHtml(filterSummary)}</p>
            </div>
            <table class="print-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Merchant</th>
                        <th>Category</th>
                        <th>Account</th>
                        <th>Amount</th>
                        <th>Tags</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="print-footer">
                <table>
                    <tr>
                        <td class="footer-label">Total Income:</td>
                        <td class="amount-income">${formatCurrency(income)}</td>
                    </tr>
                    <tr>
                        <td class="footer-label">Total Expenses:</td>
                        <td class="amount-expense">${formatCurrency(expense)}</td>
                    </tr>
                    <tr>
                        <td class="footer-label">Net:</td>
                        <td>${formatCurrency(net)}</td>
                    </tr>
                </table>
            </div>`;

    // Inject print frame
    document.getElementById("print-frame")?.remove();
    const frame = document.createElement("div");
    frame.id = "print-frame";
    frame.innerHTML = html;
    document.body.appendChild(frame);
    window.addEventListener("afterprint", () => frame.remove(), { once: true });
    window.print();
  } catch (err) {
    Toast.error(`PDF export failed: ${err.message}`);
  }
}

// ============================================================================
// Edit Transaction Modal
// ============================================================================

function detectPaymentType(description, merchantUpiId) {
  const desc = description || "";
  // Wallet transactions may contain the word 'Wallet' in Method — must NOT be treated as UPI.
  // Check for Wallet first to exclude it from UPI detection.
  const isWallet = !merchantUpiId && /method:\s*Wallet/i.test(desc);
  if (!isWallet && (merchantUpiId || /\bUPI\b/i.test(desc) || /method:\s*UPI/i.test(desc)))
    return "UPI";
  if (/\bNEFT\b/i.test(desc)) return "NEFT";
  if (/\bRTGS\b/i.test(desc)) return "RTGS";
  if (/\bIMPS\b/i.test(desc)) return "IMPS";
  if (
    isWallet ||
    /\b(Wallet|PhonePe Wallet|Paytm Wallet|AmazonPay|Amazon Pay Wallet)\b/i.test(desc)
  )
    return "Wallet";
  return "Unknown";
}

// Builds the follow-up / reminder section shown inside the edit-transaction modal.
// `followUp` is the existing follow-up for this transaction (or null when none).
function followUpFormHTML(followUp) {
  const enabled = !!followUp;
  const type = followUp?.follow_up_type || "reminder";
  const typeOptions = FOLLOWUP_TYPES.map(
    (t) => `<option value="${t.value}" ${type === t.value ? "selected" : ""}>${t.label}</option>`,
  ).join("");
  const recurrence = followUp?.recurrence || "monthly";
  const recurrenceOptions = FOLLOWUP_RECURRENCES.map(
    (r) =>
      `<option value="${r.value}" ${recurrence === r.value ? "selected" : ""}>${r.label}</option>`,
  ).join("");
  return `
    <div class="form-group">
      <label class="followup-flag">
        <input type="checkbox" id="edit-followup-enabled" data-change="toggle-followup-form" ${enabled ? "checked" : ""}>
        <span>Flag for follow-up / reminder</span>
      </label>
    </div>
    <div id="edit-followup-form" style="display:${enabled ? "" : "none"}">
      <div class="form-group">
        <label>Follow-up type</label>
        <select class="form-control" id="edit-followup-type">${typeOptions}</select>
      </div>
      <div class="form-group">
        <label>Title (optional)</label>
        <input type="text" class="form-control" id="edit-followup-title"
          value="${escapeHtml(followUp?.title || "")}" placeholder="e.g. Electricity bill">
      </div>
      <div class="form-group">
        <label>Due date</label>
        <input type="date" class="form-control" id="edit-followup-due" value="${followUp?.due_date || ""}">
      </div>
      <div class="form-group">
        <label class="followup-flag">
          <input type="checkbox" id="edit-followup-recurring" data-change="toggle-followup-recurrence-select" ${followUp?.is_recurring ? "checked" : ""}>
          <span>Repeats</span>
        </label>
      </div>
      <div class="form-group" id="edit-followup-recurrence-group" style="display:${followUp?.is_recurring ? "" : "none"}">
        <label>Every</label>
        <select class="form-control" id="edit-followup-recurrence">${recurrenceOptions}</select>
      </div>
      <div class="form-group">
        <label>Follow-up notes (optional)</label>
        <input type="text" class="form-control" id="edit-followup-notes"
          value="${escapeHtml(followUp?.notes || "")}" placeholder="Anything to remember">
      </div>
    </div>
  `;
}

// Reads the follow-up form inside the edit modal into a plain object. Returns null when
// the modal has no follow-up section. Must be called while the overlay is still in the DOM.
function readFollowUpForm(overlay) {
  const enabledEl = overlay.querySelector("#edit-followup-enabled");
  if (!enabledEl) return null;
  const recurring = !!overlay.querySelector("#edit-followup-recurring")?.checked;
  return {
    enabled: enabledEl.checked,
    data: {
      follow_up_type: overlay.querySelector("#edit-followup-type")?.value || "reminder",
      title: overlay.querySelector("#edit-followup-title")?.value.trim() || null,
      due_date: overlay.querySelector("#edit-followup-due")?.value || null,
      is_recurring: recurring,
      recurrence: recurring
        ? overlay.querySelector("#edit-followup-recurrence")?.value || "monthly"
        : null,
      notes: overlay.querySelector("#edit-followup-notes")?.value.trim() || null,
    },
  };
}

// Creates, updates, or deletes the follow-up for this transaction to match the captured
// form state (from readFollowUpForm). No-op when formState is null.
async function persistFollowUp(txId, formState) {
  if (!formState) return;
  const existing = await API.getFollowUp(txId).catch(() => null);
  if (!formState.enabled) {
    if (existing) await API.deleteFollowUp(existing.id);
    return;
  }
  if (existing) await API.updateFollowUp(existing.id, formState.data);
  else await API.createFollowUp(txId, formState.data);
}

async function showEditTransaction(txId) {
  try {
    // Fetch the transaction
    const txList = await API.getTransactions({ id: txId });
    if (!txList.length) {
      Toast.error("Transaction not found");
      return;
    }
    const tx = txList[0];
    const accounts = window._appAccounts || (await API.getAccounts(true));
    const categories = window._appCategories || (await API.getCategories());
    const followUp = await API.getFollowUp(tx.id).catch(() => null);

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    // Store original category and merchant info for merchant learning prompt
    const hasMerchant = !!(tx.merchant_upi_id || tx.merchant_name);
    const merchantLabel = tx.merchant_name || tx.merchant_upi_id || "";

    overlay.innerHTML = `
      <div class="modal" data-orig-category-id="${tx.category_id || ""}" data-has-merchant="${hasMerchant}" data-merchant-label="${escapeHtml(merchantLabel)}" data-orig-merchant-name="${escapeHtml(tx.merchant_name || "")}" data-orig-merchant-upi="${escapeHtml(tx.merchant_upi_id || "")}">
        <div class="modal-header">
          <span class="modal-title">Edit Transaction</span>
          <button class="modal-close" data-action="close-modal">&times;</button>
        </div>
        <div class="form-group">
          <label>Date</label>
          <input type="date" class="form-control" id="edit-date" value="${tx.date ? tx.date.slice(0, 10) : ""}">
        </div>
        <div class="form-group">
          <label>Time</label>
          <input type="time" class="form-control" id="edit-time" value="${tx.date?.includes("T") ? tx.date.slice(11, 16) : ""}">
        </div>
        <div class="form-group">
          <label>Amount</label>
          <input type="number" class="form-control" id="edit-amount" step="0.01" value="${Math.abs(tx.amount)}">
        </div>
        <div class="form-group">
          <label>Type</label>
          <div class="toggle-group">
            <button class="toggle-btn expense ${tx.transaction_type === "expense" ? "active" : ""}" data-action="toggle-tx-type" data-type="expense">Expense</button>
            <button class="toggle-btn income ${tx.transaction_type === "income" ? "active" : ""}" data-action="toggle-tx-type" data-type="income">Income</button>
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <input type="text" class="form-control" id="edit-desc"
            value="${escapeHtml(tx.notes || "")}"
            placeholder="Add Notes">
        </div>
        <div class="form-group">
          <label>Merchant Name</label>
          <input type="text" class="form-control" id="edit-merchant-name" value="${escapeHtml(tx.merchant_name || tx.merchant_upi_id || tx.description || "")}">
        </div>
        <div class="form-group">
          <label>Payment Reference</label>
          <input type="text" class="form-control" id="edit-payment-ref" readonly tabindex="-1"
            value="${escapeHtml(
              (() => {
                // payment_reference: LLM-extracted bank ref (stored separately from internal dedup key)
                if (tx.payment_reference) return tx.payment_reference;
                if (tx.merchant_upi_id) return tx.merchant_upi_id;
                return "";
              })(),
            )}">
        </div>
        <div class="form-group">
          <label>Transaction Type</label>
          <input type="text" class="form-control" id="edit-payment-type" readonly tabindex="-1"
            value="${detectPaymentType(tx.description, tx.merchant_upi_id)}">
        </div>
        <div class="form-group">
          <label>Category</label>
          <select class="form-control" id="edit-category">
            <option value="">None</option>
            ${categories.map((c) => `<option value="${c.id}" ${tx.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Account</label>
          <select class="form-control" id="edit-account">
            ${accounts.map((a) => `<option value="${a.id}" ${tx.account_id === a.id ? "selected" : ""}>${escapeHtml(a.name)}${a.merged_into_id ? " (merged)" : ""}</option>`).join("")}
          </select>
        </div>
        ${
          tx.transaction_type === "expense"
            ? `<div class="form-group">
          <label>Not an expense</label>
          <label class="toggle-switch">
            <input type="checkbox" data-change="toggle-excluded-from-expenses" data-id="${tx.id}" ${tx.excluded_from_expenses ? "checked" : ""}>
            <span class="toggle-slider"></span>
          </label>
        </div>`
            : ""
        }
        ${
          tx.transaction_type === "income"
            ? `<div class="form-group">
          <label>Not an income</label>
          <label class="toggle-switch">
            <input type="checkbox" data-change="toggle-excluded-from-income" data-id="${tx.id}" ${tx.excluded_from_income ? "checked" : ""}>
            <span class="toggle-slider"></span>
          </label>
        </div>`
            : ""
        }
        <div class="form-group">
          <label>Tags</label>
          <div id="edit-tx-tag-chips" class="tag-chips-container">${(tx.tags || []).map((t) => `<span class="tag-chip" data-tag-id="${t.id}" data-tag-name="${escapeHtml(t.name)}">#${escapeHtml(t.name)}<button class="tag-chip-remove" data-action="remove-tag-chip" title="Remove">×</button></span>`).join("")}</div>
          <input type="text" class="form-control" id="edit-tx-tag-input" placeholder="Type a tag and press Enter">
        </div>
        ${followUpFormHTML(followUp)}
        <div class="modal-actions">
          <button class="btn btn-outline" data-action="close-modal">Cancel</button>
          <button class="btn btn-primary" data-action="save-transaction" data-id="${tx.id}">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    setupTagInput("edit-tx-tag-input", "edit-tx-tag-chips");
  } catch (err) {
    Toast.error(err.message);
  }
}

function toggleTxType(btn, _type) {
  const group = btn.parentElement;
  for (const b of group.querySelectorAll(".toggle-btn")) b.classList.remove("active");
  btn.classList.add("active");
}

async function saveTransaction(txId, btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const modal = overlay.querySelector(".modal");
  const txType = overlay.querySelector(".toggle-btn.active")?.classList.contains("income")
    ? "income"
    : "expense";
  let amount = Number.parseFloat(overlay.querySelector("#edit-amount").value);
  if (txType === "expense" && amount > 0) amount = -amount;
  if (txType === "income" && amount < 0) amount = -amount;

  const dateVal = overlay.querySelector("#edit-date").value;
  if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    Toast.error("Invalid date — please select a valid date");
    return;
  }
  const timeVal = overlay.querySelector("#edit-time").value;
  const fullDate = timeVal ? `${dateVal}T${timeVal}` : dateVal;

  const newCategoryId = Number.parseInt(overlay.querySelector("#edit-category").value, 10) || null;

  const descInput = overlay.querySelector("#edit-desc");
  // User input always goes to `notes`. `description` (LLM text) is never modified by UI.
  const notes = descInput.value.trim() || null;

  const data = {
    date: fullDate,
    amount,
    notes,
    transaction_type: txType,
    category_id: newCategoryId,
    account_id: Number.parseInt(overlay.querySelector("#edit-account").value, 10),
    merchant_name: overlay.querySelector("#edit-merchant-name")?.value.trim() || null,
    merchant_upi_id: modal.dataset.origMerchantUpi || null,
  };

  // Check if the category changed and/or the merchant was renamed. Both changes can offer
  // to be remembered for future transactions from the same merchant. A single save may carry
  // both prompts; both flags are sent in one API.updateTransaction call.
  const origCategoryId = Number.parseInt(modal.dataset.origCategoryId, 10) || null;
  const hasMerchant = modal.dataset.hasMerchant === "true";
  const merchantLabel = modal.dataset.merchantLabel || "this merchant";
  const origMerchantName = modal.dataset.origMerchantName || "";
  const newMerchantName = data.merchant_name || "";

  const categoryChanged = !!(newCategoryId && newCategoryId !== origCategoryId && hasMerchant);
  const nameChanged = !!(newMerchantName && newMerchantName !== origMerchantName && hasMerchant);

  // Capture the follow-up form state before the overlay may be removed below.
  const followUpState = readFollowUpForm(overlay);

  if (categoryChanged || nameChanged) {
    overlay.remove();
    let learnCategory = false;
    let learnName = false;
    if (categoryChanged) {
      learnCategory = await showMerchantLearnPrompt(merchantLabel, newCategoryId);
      data.learn_merchant = learnCategory;
    }
    if (nameChanged) {
      learnName = await showMerchantRenamePrompt(merchantLabel, newMerchantName);
      data.learn_merchant_name = learnName;
    }
    try {
      await API.updateTransaction(txId, data);
      const tagIds = await collectTagIds("edit-tx-tag-chips");
      await API.setTransactionTags(txId, tagIds);
      await persistFollowUp(txId, followUpState);
      Toast.success("Transaction updated");
      if (learnCategory) {
        Toast.info(`Future transactions from ${merchantLabel} will be auto-categorized`);
      }
      if (learnName) Toast.info(`Future transactions will use "${newMerchantName}"`);
      if (Router.currentScreen === "#/transactions") refreshTransactionsScreen();
      else if (Router.currentScreen === "#/") renderDashboard();
    } catch (err) {
      Toast.error(err.message);
    }
    return;
  }

  btnEl.disabled = true;
  try {
    await API.updateTransaction(txId, data);
    const tagIds = await collectTagIds("edit-tx-tag-chips");
    await API.setTransactionTags(txId, tagIds);
    await persistFollowUp(txId, followUpState);
    overlay.remove();
    Toast.success("Transaction updated");
    // Refresh the current list
    if (Router.currentScreen === "#/transactions") refreshTransactionsScreen();
    else if (Router.currentScreen === "#/") renderDashboard();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

/**
 * Show a prompt asking if the user wants to map this merchant to the new category.
 * Returns a Promise<boolean>.
 */
function showMerchantLearnPrompt(merchantLabel, categoryId) {
  const categories = window._appCategories || [];
  const catName = categories.find((c) => c.id === categoryId)?.name || "this category";

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal confirm-dialog">
        <p style="margin-bottom:var(--space-sm);font-weight:600">Map merchant to category?</p>
        <p style="font-size:0.9rem;color:var(--color-text-secondary)">
          Do you want to automatically categorize all transactions from
          <strong>${escapeHtml(merchantLabel)}</strong> as <strong>${escapeHtml(catName)}</strong>?
        </p>
        <p style="font-size:0.8rem;color:var(--color-text-secondary);margin-top:var(--space-sm)">
          This will update all past and future transactions from this merchant.
        </p>
        <div class="modal-actions">
          <button class="btn btn-outline" id="merchant-no">No, just this one</button>
          <button class="btn btn-primary" id="merchant-yes">Yes, map all</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#merchant-yes").onclick = () => {
      overlay.remove();
      resolve(true);
    };
    overlay.querySelector("#merchant-no").onclick = () => {
      overlay.remove();
      resolve(false);
    };
  });
}

/**
 * Show a prompt asking if the renamed merchant name should be remembered for all past &
 * future transactions from this merchant. Returns a Promise<boolean>.
 */
function showMerchantRenamePrompt(merchantLabel, newName) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal confirm-dialog">
        <p style="margin-bottom:var(--space-sm);font-weight:600">Remember this merchant name?</p>
        <p style="font-size:0.9rem;color:var(--color-text-secondary)">
          Apply the name <strong>${escapeHtml(newName)}</strong> to all past &amp; future
          transactions from <strong>${escapeHtml(merchantLabel)}</strong>?
        </p>
        <div class="modal-actions">
          <button class="btn btn-outline" id="merchant-name-no">No, just this one</button>
          <button class="btn btn-primary" id="merchant-name-yes">Yes, apply to all</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#merchant-name-yes").onclick = () => {
      overlay.remove();
      resolve(true);
    };
    overlay.querySelector("#merchant-name-no").onclick = () => {
      overlay.remove();
      resolve(false);
    };
  });
}

// ============================================================================
// Delete Transaction
// ============================================================================

function confirmDeleteTransaction(txId, event) {
  event.stopPropagation();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <p>Delete this transaction?</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger" data-action="do-delete-tx" data-id="${txId}">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doDeleteTransaction(txId, btnEl) {
  btnEl.disabled = true;
  try {
    await API.deleteTransaction(txId);
    btnEl.closest(".modal-overlay").remove();
    Toast.success("Transaction deleted");
    if (Router.currentScreen === "#/transactions") loadTransactionList(true);
    else if (Router.currentScreen === "#/") renderDashboard();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

// ============================================================================
// Screen: Add Transaction
// ============================================================================

async function renderAddTransaction() {
  const screen = getScreen();
  screen.innerHTML = `<div class="spinner"></div>`;

  try {
    const [accounts, categories] = await Promise.all([API.getAccounts(), API.getCategories()]);

    screen.innerHTML = `
      <div class="card">
        <div class="card-title">New Transaction</div>

        <div class="form-group">
          <label>Type</label>
          <div class="toggle-group" id="new-tx-type">
            <button class="toggle-btn expense active" data-action="toggle-tx-type" data-type="expense">Expense</button>
            <button class="toggle-btn income" data-action="toggle-tx-type" data-type="income">Income</button>
          </div>
        </div>

        <div class="form-group">
          <label>Amount*</label>
          <input type="number" class="form-control" id="new-amount" step="0.01" min="0.01" placeholder="0.00">
        </div>

        <div class="form-group">
          <label>Date*</label>
          <input type="date" class="form-control" id="new-date" value="${todayISO()}">
        </div>

        <div class="form-group">
          <label>Time</label>
          <input type="time" class="form-control" id="new-time" value="${new Date().toTimeString().slice(0, 5)}">
        </div>

        <div class="form-group">
          <label>Account*</label>
          <select class="form-control" id="new-account">
            <option value="">Select account</option>
            ${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}
          </select>
        </div>

        <div class="form-group">
          <label>Notes</label>
          <input type="text" class="form-control" id="new-desc" placeholder="Add a personal note\u2026">
        </div>

        <div class="form-group">
          <label>Category</label>
          <select class="form-control" id="new-category">
            <option value="">None</option>
            ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>

        <div class="form-group">
          <label>Merchant</label>
          <input type="text" class="form-control" id="new-merchant" placeholder="Optional">
        </div>

        <div class="form-group">
          <label>Tags</label>
          <div id="new-tx-tag-chips" class="tag-chips-container"></div>
          <input type="text" class="form-control" id="new-tx-tag-input" placeholder="Type a tag and press Enter">
          <small style="color:var(--color-text-secondary)">Spaces auto-convert to camelCase. Press Enter or comma to add.</small>
        </div>

        <button class="btn btn-primary btn-full" id="btn-create-tx" data-action="create-transaction">Create Transaction</button>
      </div>
    `;

    setupMerchantAutocomplete("new-merchant", "new-category");
    setupTagInput("new-tx-tag-input", "new-tx-tag-chips");
  } catch (err) {
    screen.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

async function createTransaction() {
  const btn = document.getElementById("btn-create-tx");
  const amountRaw = Number.parseFloat(document.getElementById("new-amount").value);
  const txType = document
    .querySelector("#new-tx-type .toggle-btn.active")
    ?.classList.contains("income")
    ? "income"
    : "expense";
  const accountId = Number.parseInt(document.getElementById("new-account").value, 10);
  const dateOnly = document.getElementById("new-date").value;
  const time = document.getElementById("new-time").value;

  // Validation
  if (!amountRaw || amountRaw <= 0) {
    Toast.error("Enter a valid amount");
    return;
  }
  if (!accountId) {
    Toast.error("Select an account");
    return;
  }
  if (!dateOnly) {
    Toast.error("Select a date");
    return;
  }

  const date = time ? `${dateOnly}T${time}` : dateOnly;
  let amount = amountRaw;
  if (txType === "expense") amount = -amount;

  const data = {
    date,
    amount,
    transaction_type: txType,
    account_id: accountId,
    description: document.getElementById("new-desc").value || null,
    category_id: Number.parseInt(document.getElementById("new-category").value, 10) || null,
    merchant_name: document.getElementById("new-merchant").value || null,
  };

  btn.disabled = true;
  try {
    const tagIds = await collectTagIds("new-tx-tag-chips");
    data.tag_ids = tagIds;
    await API.createTransaction(data);
    Toast.success("Transaction created");
    Router.navigate("#/transactions");
  } catch (err) {
    Toast.error(err.message);
    btn.disabled = false;
  }
}

// ============================================================================
// Screen: Gmail Sync
// ============================================================================

let syncMode = "days"; // "days" or "range"
const GMAIL_CONNECT_PENDING_KEY = "fincoach-gmail-connect-pending";

function markPendingGmailConnect() {
  sessionStorage.setItem(GMAIL_CONNECT_PENDING_KEY, "1");
}

function clearPendingGmailConnect() {
  sessionStorage.removeItem(GMAIL_CONNECT_PENDING_KEY);
}

function clearGmailVaultGateToasts() {
  for (const toast of document.querySelectorAll(".toast.error")) {
    const text = toast.textContent || "";
    if (
      text.includes("Set up a PIN before connecting Gmail.") ||
      text.includes("Unlock your PIN before connecting Gmail.")
    ) {
      toast.remove();
    }
  }
}

function isNumericPin(value) {
  return /^\d{6,}$/u.test(value);
}

const isExistingNumericPin = /^\d{4,}$/u;

function _updatePinStrength(pin, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (pin.length < 6) {
    el.textContent = "Weak";
    el.classList.remove("fair", "strong");
    el.classList.add("weak");
  } else if (pin.length <= 7) {
    el.textContent = "Fair";
    el.classList.remove("weak", "strong");
    el.classList.add("fair");
  } else {
    el.textContent = "Strong";
    el.classList.remove("weak", "fair");
    el.classList.add("strong");
  }
}

function pinInputAttrs(preferNumeric = API.prefersNumericPinInput(), enterKeyHint = "done") {
  const base = `enterkeyhint="${enterKeyHint}" autocapitalize="off" autocorrect="off" spellcheck="false"`;
  return preferNumeric ? `inputmode="numeric" ${base}` : base;
}

async function continuePendingGmailConnect() {
  if (sessionStorage.getItem(GMAIL_CONNECT_PENDING_KEY) !== "1") return;
  clearPendingGmailConnect();

  try {
    const status = await API.getGmailStatus();
    if (status?.connected) return;
  } catch {
    // If status lookup fails, fall through and retry the connect flow.
  }

  await connectGmail();
}

async function renderSync() {
  const screen = getScreen();
  screen.innerHTML = `<div class="spinner"></div>`;

  try {
    let gmailStatus;
    try {
      gmailStatus = await API.getGmailStatus();
    } catch {
      gmailStatus = { connected: false };
    }

    const connected = gmailStatus.connected || gmailStatus.status === "connected";
    const aiProvider = AI.getSettings().provider;
    const needsAiConsent =
      aiProvider && AI.requiresExternalConsent(aiProvider) && !AI.hasExternalConsent(aiProvider);

    screen.innerHTML = `
      <div class="card">
        <div class="card-title">Gmail Connection</div>
        <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md)">
          <span class="status-dot ${connected ? "connected" : "disconnected"}"></span>
          <span>${connected ? "Connected" : "Not Connected"}</span>
        </div>
        ${
          !connected
            ? `<button class="btn btn-primary btn-sm" data-action="connect-gmail">Connect Gmail</button>`
            : `<button class="btn btn-sm" data-action="connect-gmail">Reconnect / Reauthorize</button>`
        }
      </div>

      ${
        connected
          ? `
      <div class="card">
        <div class="card-title">Sync Transactions</div>

        <div class="sync-option-group">
          <button class="sync-option-btn ${syncMode === "days" ? "active" : ""}" data-action="set-sync-mode" data-mode="days">Last N Days</button>
          <button class="sync-option-btn ${syncMode === "range" ? "active" : ""}" data-action="set-sync-mode" data-mode="range">Date Range</button>
        </div>

        <div id="sync-fields">
          ${syncFieldsHTML()}
        </div>

        <button class="btn btn-primary btn-full" id="btn-sync" data-action="run-sync" style="margin-top:var(--space-md)">Sync Now</button>
        <button class="btn btn-secondary btn-full" id="btn-reset-sync-history" data-action="reset-sync-history" style="margin-top:var(--space-sm);font-size:0.85em">Re-import deleted transactions</button>
        ${
          needsAiConsent
            ? `<p class="text-muted" style="margin-top:var(--space-sm);font-size:0.9em">External AI consent is required before Gmail extraction sends masked email content to ${escapeHtml(AI_PROVIDERS[aiProvider]?.name || aiProvider)}. Until then, Financial Coach will stay in local heuristic mode.</p>`
            : ""
        }
      </div>

      <div id="sync-results"></div>
      `
          : ""
      }
    `;

    if (!AI.getSettings().provider) {
      const banner = _buildAiInfoBanner(
        "Add an AI key in Settings to unlock smarter categorisation, personalized advice, and better transaction extraction.",
      );
      const firstCard = screen.querySelector(".card");
      if (firstCard) {
        firstCard.after(banner);
      } else {
        screen.prepend(banner);
      }
    }
  } catch (err) {
    screen.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function syncFieldsHTML() {
  if (syncMode === "days") {
    return `
      <div class="form-group">
        <label>Days to look back</label>
        <input type="number" class="form-control" id="sync-days" value="2" min="1" max="31">
      </div>
    `;
  }
  return `
    <div class="form-group">
      <label>Start Date</label>
      <input type="date" class="form-control" id="sync-start" value="${daysAgoISO(7)}">
    </div>
    <div class="form-group">
      <label>End Date</label>
      <input type="date" class="form-control" id="sync-end" value="${todayISO()}">
    </div>
  `;
}

function setSyncMode(mode, btn) {
  syncMode = mode;
  for (const b of btn.parentElement.querySelectorAll(".sync-option-btn")) {
    b.classList.remove("active");
  }
  btn.classList.add("active");
  document.getElementById("sync-fields").innerHTML = syncFieldsHTML();
}

async function connectGmail() {
  if (!API.isVaultConfigured()) {
    markPendingGmailConnect();
    showVaultSetupModal();
    Toast.error("Set up a PIN before connecting Gmail.");
    return;
  }
  if (!API.isVaultUnlocked()) {
    markPendingGmailConnect();
    renderVaultUnlock();
    Toast.error("Unlock your PIN before connecting Gmail.");
    return;
  }

  clearGmailVaultGateToasts();
  clearPendingGmailConnect();

  try {
    const result = await API.getGmailConnectUrl();
    if (result?.connected) {
      Toast.success("Gmail connected!");
      // Re-render whichever screen is currently active instead of always going to Sync
      const renderFn = Router.routes[Router.currentScreen];
      if (renderFn) await renderFn();
      else await renderSync();
    }
  } catch (err) {
    Toast.error(err.message || "Failed to connect Gmail");
  }
}

async function resetSyncHistory() {
  const btn = document.getElementById("btn-reset-sync-history");
  btn.disabled = true;
  try {
    await API.resetGmailSyncHistory();
    Toast.success(
      "Deleted-email history cleared — previously deleted transactions can be re-imported on next sync",
    );
  } catch (err) {
    Toast.error(err.message || "Failed to reset sync history");
  } finally {
    btn.disabled = false;
  }
}

function _warnNoAISyncOnce() {
  const TOAST_KEY = "fincoach-sync-ai-reminder-shown";
  if (sessionStorage.getItem(TOAST_KEY)) return;
  const settings = AI.getSettings();
  const provider = settings.provider;
  const needsConsent =
    provider && AI.requiresExternalConsent(provider) && !AI.hasExternalConsent(provider);
  if (!provider || needsConsent) {
    sessionStorage.setItem(TOAST_KEY, "1");
    Toast.info(
      "For smarter transaction extraction: add an AI API key in Settings → AI Settings and accept the Review Consent.",
    );
  }
}

async function runSync() {
  _warnNoAISyncOnce();
  const btn = document.getElementById("btn-sync");
  const resultsDiv = document.getElementById("sync-results");

  btn.disabled = true;
  resultsDiv.innerHTML = `<div class="card"><div class="spinner"></div><p style="text-align:center;color:var(--color-text-secondary);margin-top:var(--space-sm)">Syncing emails… this may take a moment</p></div>`;

  const params = { auto_import: true, batch_size: 20 };
  if (syncMode === "days") {
    params.days = Number.parseInt(document.getElementById("sync-days").value, 10) || 2;
  } else {
    const startVal = document.getElementById("sync-start").value;
    const endVal = document.getElementById("sync-end").value;
    if (startVal && endVal && startVal > endVal) {
      btn.disabled = false;
      resultsDiv.innerHTML = `<div class="card"><p style="color:var(--color-expense);padding:var(--space-sm)">⚠ Start date cannot be later than end date.</p></div>`;
      return;
    }
    params.start_date = startVal;
    params.end_date = endVal;
  }

  try {
    const result = await API.gmailSearch(params);
    const ir = result.import_results || {};
    const imported = ir.imported ?? result.imported_count ?? result.imported ?? 0;
    const duplicates = ir.duplicates ?? result.duplicate_count ?? result.duplicates ?? 0;
    const skipped = ir.skipped ?? result.skipped ?? 0;
    const errors = ir.errors ?? result.error_count ?? result.errors ?? 0;
    const balanceUpdates = ir.balance_updates ?? 0;
    const found = result.found_count ?? result.found ?? imported + duplicates + skipped + errors;

    resultsDiv.innerHTML = `
      <div class="card sync-results">
        <div class="card-title">Sync Results</div>
        <div class="result-item"><span>Found</span><strong>${found}</strong></div>
        <div class="result-item"><span>Imported</span><strong>${imported}</strong></div>
        ${balanceUpdates ? `<div class="result-item"><span>Balance Updates</span><strong>${balanceUpdates}</strong></div>` : ""}
        ${skipped ? `<div class="result-item"><span>Already Synced</span><strong>${skipped}</strong></div>` : ""}
        ${duplicates ? `<div class="result-item"><span>Duplicates</span><strong>${duplicates}</strong></div>` : ""}
        ${errors ? `<div class="result-item"><span>Errors</span><strong>${errors}</strong></div>` : ""}
        ${
          errors > 0
            ? `
          <details class="sync-error-details">
            <summary>${errors} email${errors !== 1 ? "s" : ""} could not be imported</summary>
            <ul class="sync-error-list">
              ${(result.errorDetails || [])
                .map(
                  (e) => `
                <li>
                  <span class="sync-error-subject">${escapeHtml(e.subject || e.from || "Unknown email")}</span>
                  ${e.description ? `<span class="sync-error-desc">${escapeHtml(e.description)}</span>` : ""}
                  <span class="sync-error-reason">${escapeHtml(e.reason || "Unknown error")}</span>
                </li>
              `,
                )
                .join("")}
            </ul>
          </details>
        `
            : ""
        }
        <button class="btn btn-outline btn-full" style="margin-top:var(--space-md)" data-action="nav-navigate" data-route="#/transactions">View Transactions</button>
      </div>
    `;

    if (result.heuristic_mode) {
      const notice = document.createElement("p");
      notice.className = "text-muted";
      notice.style.marginTop = "var(--space-sm)";
      notice.textContent =
        "Regex-based extraction was used (no AI key). Some transactions may be incomplete. Add an AI key in Settings for full accuracy.";
      const syncResults = resultsDiv.querySelector(".sync-results") || resultsDiv;
      syncResults.append(notice);
    }

    Toast.success(`Imported ${imported} transaction${imported !== 1 ? "s" : ""}`);
  } catch (err) {
    if (err.status === 401) {
      resultsDiv.innerHTML = `<div class="card"><p>Session expired. Please reconnect Gmail.</p><button class="btn btn-primary btn-sm" data-action="connect-gmail" style="margin-top:var(--space-sm)">Reconnect</button></div>`;
    } else {
      resultsDiv.innerHTML = `<div class="card"><p style="color:var(--color-expense)">${escapeHtml(err.message)}</p><button class="btn btn-outline btn-sm" data-action="run-sync" style="margin-top:var(--space-sm)">Retry</button></div>`;
    }
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// Screen: Accounts
// ============================================================================

async function renderAccounts() {
  const screen = getScreen();
  screen.innerHTML = `<div class="spinner"></div>`;

  try {
    const accounts = await API.getAccounts(true);

    // Separate parent/standalone accounts from merged children.
    // Orphan accounts (is_active=0 but merged_into_id=null) remain visible so users can act on them.
    const topLevel = accounts.filter((a) => !a.merged_into_id);

    // Build lookup map by id for tree rendering
    const accountMap = {};
    for (const a of accounts) {
      accountMap[a.id] = a;
    }

    // Cache for merge modal
    window._accountsList = accounts;

    if (topLevel.length === 0) {
      screen.innerHTML = `
        <div class="empty-state"><div class="empty-icon">🏦</div><div class="empty-text">No accounts yet</div></div>
        <button class="fab" data-action="show-create-account" title="Add Account">+</button>
      `;
      return;
    }

    // Bucket accounts into groups
    const buckets = new Map(ACCOUNT_GROUPS.map((g) => [g.key, []]));
    for (const a of topLevel) {
      const group =
        ACCOUNT_GROUPS.find((g) => g.types?.has(a.account_type)) ??
        ACCOUNT_GROUPS.find((g) => g.types === null);
      buckets.get(group.key).push(a);
    }

    const sectionsHTML = ACCOUNT_GROUPS.filter((g) => buckets.get(g.key).length > 0)
      .map((g) => renderAccountSection(g.label, buckets.get(g.key), accountMap))
      .join("");

    screen.innerHTML = `
      <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-md)">
        <button class="btn btn-outline btn-sm" data-action="show-merge-account">Merge Accounts</button>
      </div>
      ${sectionsHTML}
      <button class="fab" data-action="show-create-account" title="Add Account">+</button>
    `;
  } catch (err) {
    screen.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function renderAccountSection(label, accounts, accountMap) {
  return `
    <div class="acct-section">
      <h3 class="acct-section-title">${escapeHtml(label)}</h3>
      ${accounts.map((a) => renderAccountTile(a, accountMap)).join("")}
    </div>
  `;
}

function renderAccountTile(a, accountMap) {
  const group =
    ACCOUNT_GROUPS.find((g) => g.types?.has(a.account_type)) ??
    ACCOUNT_GROUPS.find((g) => g.types === null);
  const tileType = group?.tileType ?? "wallet";
  switch (tileType) {
    case "bank":
      return renderBankTile(a, accountMap);
    case "credit":
      return renderCreditCardTile(a, accountMap);
    case "debit":
      return renderDebitCardTile(a, accountMap);
    default:
      return renderWalletTile(a, accountMap);
  }
}

function _accountTileEditBtn(a) {
  return `<button class="btn-icon" title="Edit account"
    data-action="show-edit-account"
    data-id="${a.id}"
    data-name="${escapeHtml(a.name)}"
    data-identifier="${escapeHtml(a.account_identifier || "")}"
    data-type="${escapeHtml(a.account_type || "")}"
    data-cycle-day="${a.billing_cycle_start_day || 1}">✏️</button>`;
}

function _accountTileDeleteBtn(a) {
  return `<button class="btn-icon" title="Delete" data-action="confirm-delete-account" data-id="${a.id}" data-name="${escapeHtml(a.name)}">🗑</button>`;
}

function renderBankTile(a, accountMap) {
  const last4 = a.account_identifier ? a.account_identifier.slice(-4) : "";
  return `
    <div class="card acct-tile acct-tile--bank">
      <div class="acct-tile__body" data-action="toggle-account-children" data-id="${a.id}">
        <div class="acct-tile__icon">🏦</div>
        <div class="account-info">
          <div class="account-name">${escapeHtml(a.name)}</div>
        </div>
        <div class="account-balance">
          <div class="account-balance-amount">${privacyAmount(formatAccountBalance(a))}</div>
        </div>
        ${last4 ? `<div class="acct-tile__identifier">••••&nbsp;${escapeHtml(last4)}</div>` : ""}
      </div>
      <div class="account-card-actions">
        ${_accountTileEditBtn(a)} ${_accountTileDeleteBtn(a)}
      </div>
      <div class="account-children hidden" id="children-${a.id}">
        ${renderAccountChildren(a.merged_accounts || [], accountMap, 1)}
      </div>
    </div>
  `;
}

function renderCreditCardTile(a, accountMap) {
  const last4 = a.account_identifier ? a.account_identifier.slice(-4) : "";
  const balanceHTML = `${formatCurrency(a.credit_cycle_balance ?? 0)} <span style="font-size:0.75em;opacity:0.7">due this cycle</span>`;
  return `
    <div class="card acct-tile acct-tile--credit">
      <div class="acct-tile__body" data-action="toggle-account-children" data-id="${a.id}">
        <div class="acct-tile__card-top">
          <div class="acct-tile__card-network">CARD</div>
          <div class="account-card-actions">${_accountTileEditBtn(a)} ${_accountTileDeleteBtn(a)}</div>
        </div>
        <div class="account-info">
          <div class="account-name">${escapeHtml(a.name)}</div>
        </div>
        <div class="acct-tile__card-bottom">
          <div class="acct-tile__identifier">${last4 ? `••••&nbsp;${escapeHtml(last4)}` : ""}</div>
          <div class="account-balance">
            <div class="account-balance-amount">${balanceHTML}</div>
          </div>
        </div>
      </div>
      <div class="account-children hidden" id="children-${a.id}">
        ${renderAccountChildren(a.merged_accounts || [], accountMap, 1)}
      </div>
    </div>
  `;
}

function renderDebitCardTile(a, accountMap) {
  const last4 = a.account_identifier ? a.account_identifier.slice(-4) : "";
  return `
    <div class="card acct-tile acct-tile--debit">
      <div class="acct-tile__body" data-action="toggle-account-children" data-id="${a.id}">
        <div class="acct-tile__card-top">
          <div class="acct-tile__card-network">CARD</div>
          <div class="account-card-actions">${_accountTileEditBtn(a)} ${_accountTileDeleteBtn(a)}</div>
        </div>
        <div class="account-info">
          <div class="account-name">${escapeHtml(a.name)}</div>
        </div>
        <div class="acct-tile__card-bottom">
          <div class="acct-tile__identifier">${last4 ? `••••&nbsp;${escapeHtml(last4)}` : ""}</div>
          <div class="account-balance">
            <div class="account-balance-amount">${privacyAmount(formatAccountBalance(a))}</div>
          </div>
        </div>
      </div>
      <div class="account-children hidden" id="children-${a.id}">
        ${renderAccountChildren(a.merged_accounts || [], accountMap, 1)}
      </div>
    </div>
  `;
}

function renderWalletTile(a, accountMap) {
  return `
    <div class="card acct-tile acct-tile--wallet">
      <div class="acct-tile__body" data-action="toggle-account-children" data-id="${a.id}">
        <div class="acct-tile__icon">👛</div>
        <div class="account-info">
          <div class="account-name">${escapeHtml(a.name)}</div>
        </div>
        <div class="account-balance">
          <div class="account-balance-amount">${privacyAmount(formatAccountBalance(a))}</div>
        </div>
      </div>
      <div class="account-card-actions">
        ${_accountTileEditBtn(a)} ${_accountTileDeleteBtn(a)}
      </div>
      <div class="account-children hidden" id="children-${a.id}">
        ${renderAccountChildren(a.merged_accounts || [], accountMap, 1)}
      </div>
    </div>
  `;
}

function renderAccountChildren(children, accountMap, depth) {
  if (!children || children.length === 0) return "";
  return children
    .map((c) => {
      const full = accountMap[c.id] || c;
      const grandchildren = full.merged_accounts || [];
      const indent = depth * 16;
      return `
      <div class="account-child" style="padding-left:${indent}px">
        <span>${"─".repeat(depth)} ${escapeHtml(c.name)} <span class="badge badge-type">${escapeHtml(c.account_type)}</span>
          ${grandchildren.length ? `<span class="account-sub-count">${grandchildren.length} merged</span>` : ""}
        </span>
        <span class="account-child-right">
          ${privacyAmount(formatAccountBalance(c))}
          <button class="btn-icon" title="Unmerge" data-action="confirm-unmerge-account" data-id="${c.id}" data-name="${escapeHtml(c.name)}">↩️</button>
        </span>
      </div>
      ${renderAccountChildren(grandchildren, accountMap, depth + 1)}
    `;
    })
    .join("");
}

function toggleAccountChildren(accountId) {
  const el = document.getElementById(`children-${accountId}`);
  if (el) el.classList.toggle("hidden");
}

// ---- Account Actions ----

function showCreateAccountModal() {
  const accountTypes = [
    "savings",
    "current",
    "credit",
    "credit_card",
    "debit",
    "debit_card",
    "prepaid",
    "deposit",
    "wallet",
  ];
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Create Account</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Name*</label>
        <input type="text" class="form-control" id="acct-name" placeholder="Account name">
      </div>
      <div class="form-group">
        <label>Account Type*</label>
        <select class="form-control" id="acct-type">
          ${accountTypes.map((t) => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Initial Balance</label>
        <input type="number" class="form-control" id="acct-balance" step="0.01" value="0" placeholder="0.00">
      </div>
      <div class="form-group">
        <label>Account Identifier</label>
        <input type="text" class="form-control" id="acct-identifier" placeholder="Optional (e.g. last 4 digits)">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-create-account">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doCreateAccount(btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const name = overlay.querySelector("#acct-name").value.trim();
  if (!name) {
    Toast.error("Name is required");
    return;
  }

  const data = {
    name,
    account_type: overlay.querySelector("#acct-type").value,
    balance: Number.parseFloat(overlay.querySelector("#acct-balance").value) || 0,
    account_identifier: overlay.querySelector("#acct-identifier").value.trim() || null,
  };

  btnEl.disabled = true;
  try {
    await API.createAccount(data);
    overlay.remove();
    Toast.success("Account created");
    renderAccounts();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

function showEditAccountModal(id, name, identifier, type, cycleDay) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Edit Account</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Name</label>
        <input type="text" class="form-control" id="edit-acct-name" value="${escapeHtml(name)}">
      </div>
      <div class="form-group">
        <label>Account Identifier</label>
        <input type="text" class="form-control" id="edit-acct-identifier" value="${escapeHtml(identifier)}">
      </div>
      ${
        type === "credit"
          ? `<div class="form-group">
              <label>Billing Cycle Start Day (1–28)</label>
              <input type="number" class="form-control" id="edit-acct-cycle-day"
                     min="1" max="28" value="${cycleDay}">
            </div>`
          : ""
      }
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-edit-account"
                data-id="${id}" data-type="${escapeHtml(type)}">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doEditAccount(id, el) {
  const overlay = el.closest(".modal-overlay");
  const name = overlay.querySelector("#edit-acct-name").value.trim();
  if (!name) {
    Toast.error("Name is required");
    return;
  }
  const data = {
    name,
    account_identifier: overlay.querySelector("#edit-acct-identifier").value.trim() || null,
  };
  const cycleDayEl = overlay.querySelector("#edit-acct-cycle-day");
  if (cycleDayEl) data.billing_cycle_start_day = Number.parseInt(cycleDayEl.value, 10);
  el.disabled = true;
  try {
    await API.updateAccount(id, data);
    overlay.remove();
    Toast.success("Account updated");
    renderAccounts();
  } catch (err) {
    Toast.error(err.message);
    el.disabled = false;
  }
}

async function showMergeAccountModal() {
  const accounts = window._accountsList || (await API.getAccounts(true));
  // Active top-level accounts can be either source or target.
  // Orphan accounts (is_active=0 with no merged_into_id) result from a broken merge and can
  // only be sources — merging them into a valid target repairs the relationship.
  const activeAccounts = accounts.filter((a) => a.is_active && !a.merged_into_id);
  const orphanAccounts = accounts.filter((a) => !a.is_active && !a.merged_into_id);
  const sourceAccounts = [...activeAccounts, ...orphanAccounts];

  if (activeAccounts.length === 0 || (activeAccounts.length === 1 && orphanAccounts.length === 0)) {
    Toast.error("Need at least 2 active top-level accounts to merge");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Merge Accounts</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <p style="font-size:0.85rem;color:var(--color-text-secondary);margin-bottom:var(--space-md)">
        Merge source into target. Both must be the same type. Source becomes a child of target. Multi-level hierarchies are supported.
      </p>
      <div class="form-group">
        <label>Source Account (will be grouped under target)</label>
        <select class="form-control" id="merge-source">
          <option value="">Select source</option>
          ${sourceAccounts
            .map(
              (a) =>
                `<option value="${a.id}" data-type="${escapeHtml(a.account_type)}">${escapeHtml(a.name)} (${escapeHtml(a.account_type)})${a.is_active ? "" : " — orphaned"}</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Target Account</label>
        <select class="form-control" id="merge-target">
          <option value="">Select target</option>
          ${activeAccounts
            .map(
              (a) =>
                `<option value="${a.id}" data-type="${escapeHtml(a.account_type)}">${escapeHtml(a.name)} (${escapeHtml(a.account_type)})</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-merge-accounts">Merge</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doMergeAccounts(btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const sourceId = Number.parseInt(overlay.querySelector("#merge-source").value, 10);
  const targetId = Number.parseInt(overlay.querySelector("#merge-target").value, 10);

  if (!sourceId) {
    Toast.error("Select a source account");
    return;
  }
  if (!targetId) {
    Toast.error("Select a target account");
    return;
  }
  if (sourceId === targetId) {
    Toast.error("Source and target must be different");
    return;
  }

  const srcOpt = overlay.querySelector(`#merge-source option[value="${sourceId}"]`);
  const tgtOpt = overlay.querySelector(`#merge-target option[value="${targetId}"]`);
  if (srcOpt && tgtOpt && srcOpt.dataset.type !== tgtOpt.dataset.type) {
    Toast.error("Source and target must be the same account type");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.mergeAccounts(sourceId, targetId);
    overlay.remove();
    Toast.success("Accounts merged");
    renderAccounts();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

function confirmUnmergeAccount(id, name) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <p>Unmerge "${escapeHtml(name)}"?</p>
      <p style="font-size:0.85rem;color:var(--color-text-secondary)">This account will become standalone again.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-unmerge-account" data-id="${id}">Unmerge</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doUnmergeAccount(id, btnEl) {
  btnEl.disabled = true;
  try {
    await API.unmergeAccount(id);
    btnEl.closest(".modal-overlay").remove();
    Toast.success("Account unmerged");
    renderAccounts();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

async function confirmDeleteAccount(id, name) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  let txCount = 0;
  try {
    const result = await API.getTransactionTotals({ account_id: id });
    txCount = result?.transaction_count || 0;
  } catch {
    // ignore — treat as 0
  }

  const bodyText =
    txCount > 0
      ? `Cannot delete "${escapeHtml(name)}": ${txCount} transaction(s) are linked to it. Reassign or delete them first.`
      : `Delete account "${escapeHtml(name)}"? This action cannot be undone.`;

  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <p>${bodyText}</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        ${txCount === 0 ? `<button class="btn btn-danger" data-action="do-delete-account" data-id="${id}">Delete</button>` : ""}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doDeleteAccount(id, btnEl) {
  btnEl.disabled = true;
  try {
    await API.deleteAccount(id);
    btnEl.closest(".modal-overlay").remove();
    Toast.success("Account deleted");
    renderAccounts();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

// ============================================================================
// Screen: Chat
// ============================================================================

let chatMessages = [];
let chatLoading = false;
let currentChatId = null;
let pendingAIConsentAction = null;

function formatChatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  return `${d.toLocaleDateString("en-IN", { month: "short", day: "numeric" })} ${time}`;
}

function showAIConsentModal(source = "settings", onAccept = null) {
  const providerKey = AI.getSettings().provider;
  if (!providerKey || !AI.requiresExternalConsent(providerKey)) return;

  pendingAIConsentAction = onAccept;
  const providerName = AI_PROVIDERS[providerKey]?.name || providerKey;
  const sourceLabel =
    source === "sync"
      ? "Gmail transaction extraction and categorisation"
      : "financial chat responses and account summaries";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      pendingAIConsentAction = null;
      overlay.remove();
    }
  };
  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <div class="modal-header">
        <span class="modal-title">Allow external AI processing?</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <p>
        ${escapeHtml(providerName)} is an external AI provider. If you continue, Financial Coach may send
        masked transaction descriptions, account summaries, budgets, goals, and relevant Gmail-derived
        content from this device directly to ${escapeHtml(providerName)} for ${escapeHtml(sourceLabel)}.
      </p>
      <p class="text-muted" style="font-size:0.9em">
        Detected identifiers like phone numbers, emails, PAN, Aadhaar, UPI handles, and labelled account
        references are masked before sending when possible. Do not paste secrets or personal details that
        you do not want shared. You can revoke this consent later in Settings.
      </p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="confirm-ai-consent" data-source="${escapeHtml(source)}">I understand, continue</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function confirmAIConsent(source = "settings") {
  const provider = AI.getSettings().provider;
  if (provider) AI.grantExternalConsent(provider, source);
  document.querySelector('[data-action="confirm-ai-consent"]')?.closest(".modal-overlay")?.remove();
  const pending = pendingAIConsentAction;
  pendingAIConsentAction = null;
  Toast.success("External AI consent saved");
  if (typeof pending === "function") {
    await pending();
  } else if (Router.currentScreen === "#/settings") {
    await renderSettings();
  }
}

async function revokeAIConsent() {
  AI.revokeExternalConsent();
  Toast.info(
    "External AI consent revoked. Chat and Gmail extraction will stay local until you opt in again.",
  );
  if (Router.currentScreen === "#/settings") {
    await renderSettings();
  }
}

async function renderChat() {
  const screen = getScreen();
  screen.style.padding = "0";
  screen.style.paddingBottom = "0";
  screen.style.maxWidth = "100%";
  screen.innerHTML = `
    <div class="chat-container">
      <div class="chat-messages" id="chat-messages">
        <div class="spinner"></div>
      </div>
      <div class="chat-input-bar">
        <span class="info-notice chat-privacy-notice" tabindex="0" role="note" aria-label="Data sharing notice">
          ⚠️
          <span class="info-notice-tooltip">If you use an external AI provider, Financial Coach sends masked financial context from this browser directly to that provider after you consent. Detected identifiers in your chat are masked when possible, but avoid typing secrets or personal details you do not want shared. Ollama stays local to your device.</span>
        </span>
        <textarea id="chat-input" rows="1" placeholder="Ask your financial coach…" data-keydown="chat-input"></textarea>
        <button class="chat-send-btn" id="chat-send-btn" data-action="send-chat" title="Send">➤</button>
      </div>
    </div>
  `;

  const textarea = document.getElementById("chat-input");
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  });

  // Load most recent chat or start fresh
  try {
    const data = await API.getChatHistory(currentChatId);
    currentChatId = data.chat_id || null;
    chatMessages = (data.history || []).map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp || null,
    }));
  } catch {
    currentChatId = null;
    chatMessages = [];
  }

  renderChatMessages();
  textarea.focus();

  if (!AI.getSettings().provider) {
    const banner = _buildAiInfoBanner(
      "Add an AI key in Settings to unlock smarter categorisation, personalized advice, and better transaction extraction.",
    );
    const chatContainer = screen.querySelector(".chat-container") || screen.firstElementChild;
    chatContainer.prepend(banner);
    const chatTextarea = screen.querySelector("#chat-input");
    if (chatTextarea) {
      chatTextarea.placeholder =
        "Ask about your finances (AI not configured \u2014 basic answers only)";
    }
  }
}

function renderChatMessages() {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  if (chatMessages.length === 0 && !chatLoading) {
    container.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">💬</div>
        <div class="chat-welcome-title">Your Financial Coach</div>
        <div class="chat-welcome-text">Ask anything about your finances. Try:</div>
        <div class="chat-suggestions">
          <button class="chat-suggestion" data-action="fill-chat-suggestion">"How much did I spend last month?"</button>
          <button class="chat-suggestion" data-action="fill-chat-suggestion">"What's my spending this quarter?"</button>
          <button class="chat-suggestion" data-action="fill-chat-suggestion">"Can I afford a ₹5000 purchase?"</button>
          <button class="chat-suggestion" data-action="fill-chat-suggestion">"Help me reduce my spending"</button>
        </div>
      </div>
    `;
    return;
  }

  let html = chatMessages
    .map((m) => {
      const timeStr = formatChatTime(m.timestamp);
      const timeHtml = timeStr ? `<span class="chat-time">${escapeHtml(timeStr)}</span>` : "";
      const content =
        m.role === "user"
          ? escapeHtml(m.content)
          : DOMPurify.sanitize(marked.parse(m.content || ""));
      return `<div class="chat-bubble ${m.role === "user" ? "user" : "assistant"}">${content}${timeHtml}</div>`;
    })
    .join("");

  if (chatLoading) {
    html += `
      <div class="chat-typing" id="chat-typing">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
      </div>
    `;
  }

  container.innerHTML = html;
  scrollChatToBottom();
}

function fillChatSuggestion(btn) {
  const input = document.getElementById("chat-input");
  if (input) {
    input.value = btn.textContent.replace(/^"|"$/g, "");
    input.focus();
  }
}

function scrollChatToBottom() {
  const container = document.getElementById("chat-messages");
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

function chatInputKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

async function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const btn = document.getElementById("chat-send-btn");
  const message = input.value.trim();
  if (!message || chatLoading) return;

  const provider = AI.getSettings().provider;
  if (provider && AI.requiresExternalConsent(provider) && !AI.hasExternalConsent(provider)) {
    showAIConsentModal("chat", async () => {
      await sendChatMessage();
    });
    return;
  }

  chatMessages.push({ role: "user", content: message, timestamp: new Date().toISOString() });
  input.value = "";
  input.style.height = "auto";
  chatLoading = true;
  btn.disabled = true;
  renderChatMessages();

  try {
    const data = await API.sendChatMessageWithId(message, currentChatId);
    currentChatId = data.chat_id;
    chatMessages.push({
      role: "assistant",
      content: data.response,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    chatMessages.push({
      role: "assistant",
      content: "Sorry, something went wrong. Please try again.",
    });
    Toast.error(err.message);
  } finally {
    chatLoading = false;
    btn.disabled = false;
    renderChatMessages();
    input.focus();
  }
}

function startNewChat() {
  currentChatId = null;
  chatMessages = [];
  renderChatMessages();
  const input = document.getElementById("chat-input");
  if (input) input.focus();
}

function confirmClearChat() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <p>Clear this chat?</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger" data-action="do-clear-chat">Clear</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doClearChatHistory(btnEl) {
  btnEl.disabled = true;
  try {
    if (currentChatId) {
      await API.clearChatHistory(currentChatId);
    }
    btnEl.closest(".modal-overlay").remove();
    currentChatId = null;
    chatMessages = [];
    renderChatMessages();
    Toast.success("Chat cleared");
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

async function showChatSessions() {
  try {
    const data = await API.listChatSessions();
    const sessions = data.sessions || [];

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    const listHtml =
      sessions.length === 0
        ? `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No chat history yet</div></div>`
        : sessions
            .map(
              (s) => `
        <div class="chat-session-item ${s.chat_id === currentChatId ? "active" : ""}" data-action="load-chat-session" data-chat-id="${escapeHtml(s.chat_id)}">
          <div class="chat-session-preview">${escapeHtml(truncate(s.preview, 60)) || "Empty chat"}</div>
          <div class="chat-session-meta">${s.message_count} messages · ${formatChatTime(s.last_message_at)}</div>
        </div>
      `,
            )
            .join("");

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">Chat History</span>
          <button class="modal-close" data-action="close-modal">&times;</button>
        </div>
        <div class="chat-session-list">${listHtml}</div>
        <div class="modal-actions">
          <button class="btn btn-primary btn-full" data-action="close-and-new-chat">+ New Chat</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  } catch (err) {
    Toast.error(err.message);
  }
}

async function loadChatSession(chatId, el) {
  const overlay = el ? el.closest(".modal-overlay") : null;
  if (overlay) overlay.remove();

  currentChatId = chatId;
  try {
    const data = await API.getChatHistory(chatId);
    chatMessages = (data.history || []).map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp || null,
    }));
  } catch {
    chatMessages = [];
  }
  renderChatMessages();
}

// ============================================================================
// Screen: Taxonomy (Categories & Merchants)
// ============================================================================

let taxonomyTab = "categories";

async function renderTaxonomy() {
  const screen = getScreen();
  screen.innerHTML = `<div class="spinner"></div>`;

  screen.innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn ${taxonomyTab === "categories" ? "active" : ""}" data-action="switch-taxonomy-tab" data-mode="categories">Categories</button>
      <button class="tab-btn ${taxonomyTab === "merchants" ? "active" : ""}" data-action="switch-taxonomy-tab" data-mode="merchants">Merchants</button>
      <button class="tab-btn ${taxonomyTab === "tags" ? "active" : ""}" data-action="switch-taxonomy-tab" data-mode="tags">Tags</button>
    </div>
    <div id="taxonomy-content"><div class="spinner"></div></div>
    ${taxonomyTab === "categories" ? '<button class="fab" data-action="show-add-category" title="Add Category">+</button>' : ""}
    ${taxonomyTab === "tags" ? '<button class="fab" data-action="show-add-tag" title="Add Tag">+</button>' : ""}
  `;

  if (taxonomyTab === "categories") {
    await renderCategoriesTab();
  } else if (taxonomyTab === "tags") {
    await renderTagsTab();
  } else {
    await renderMerchantsTab();
  }
}

function switchTaxonomyTab(tab) {
  taxonomyTab = tab;
  renderTaxonomy();
}

// ---- Categories Tab ----

async function renderCategoriesTab() {
  const container = document.getElementById("taxonomy-content");
  if (!container) return;

  try {
    const categories = await API.getCategories();

    container.innerHTML = `
      ${
        categories.length === 0
          ? `<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-text">No categories yet</div></div>`
          : categories
              .map(
                (c) => `
          <div class="card taxonomy-card">
            <div class="taxonomy-card-header">
              <div class="taxonomy-card-info">
                <div class="taxonomy-card-name">${escapeHtml(c.name)}${c.is_default ? ' <span class="badge badge-default">Default</span>' : ""}</div>
                ${c.description ? `<div class="taxonomy-card-desc">${escapeHtml(c.description)}</div>` : ""}
              </div>
              <div class="taxonomy-card-actions">
                ${!c.is_default ? `<button class="btn-icon" title="Set as default" data-action="set-default-category" data-id="${c.id}">⭐</button>` : ""}
                <button class="btn-icon" title="Edit" data-action="show-edit-category" data-id="${c.id}" data-name="${escapeHtml(c.name)}" data-description="${escapeHtml(c.description || "")}" data-is-default="${c.is_default}">✏️</button>
                <button class="btn-icon" title="Delete" data-action="confirm-delete-category" data-id="${c.id}" data-name="${escapeHtml(c.name)}">🗑</button>
              </div>
            </div>
          </div>
        `,
              )
              .join("")
      }
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

async function setDefaultCategory(categoryId) {
  try {
    await API.setDefaultCategory(categoryId);
    Toast.success("Default category updated");
    renderCategoriesTab();
  } catch (err) {
    Toast.error(err.message);
  }
}

function showAddCategoryModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Add Category</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Name*</label>
        <input type="text" class="form-control" id="cat-name" placeholder="Category name">
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" class="form-control" id="cat-desc" placeholder="Optional description">
      </div>
      <div class="form-group">
        <div class="toggle-row">
          <span>Set as default</span>
          <label class="toggle-switch">
            <input type="checkbox" id="cat-default">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-create-category">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doCreateCategory(btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const name = overlay.querySelector("#cat-name").value.trim();
  if (!name) {
    Toast.error("Name is required");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.createCategory({
      name,
      description: overlay.querySelector("#cat-desc").value.trim() || null,
      is_default: overlay.querySelector("#cat-default").checked,
    });
    overlay.remove();
    Toast.success("Category created");
    renderCategoriesTab();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

function showEditCategoryModal(id, name, description, isDefault) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Edit Category</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Name*</label>
        <input type="text" class="form-control" id="cat-edit-name" value="${escapeHtml(name)}">
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" class="form-control" id="cat-edit-desc" value="${escapeHtml(description)}">
      </div>
      <div class="form-group">
        <div class="toggle-row">
          <span>Set as default</span>
          <label class="toggle-switch">
            <input type="checkbox" id="cat-edit-default" ${isDefault ? "checked" : ""}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-update-category" data-id="${id}">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doUpdateCategory(id, btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const name = overlay.querySelector("#cat-edit-name").value.trim();
  if (!name) {
    Toast.error("Name is required");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.updateCategory(id, {
      name,
      description: overlay.querySelector("#cat-edit-desc").value.trim() || null,
      is_default: overlay.querySelector("#cat-edit-default").checked,
    });
    overlay.remove();
    Toast.success("Category updated");
    renderCategoriesTab();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

async function confirmDeleteCategory(id, name) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  let txCount = 0;
  try {
    const result = await API.getTransactionTotals({ category_id: id });
    txCount = result?.transaction_count || 0;
  } catch {
    // ignore — treat as 0
  }

  const warningText =
    txCount > 0
      ? `<p style="font-size:0.85rem;color:var(--color-text-secondary)">${txCount} transaction(s) use this category. They will become uncategorized.</p>`
      : "";

  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <p>Delete category "${escapeHtml(name)}"?</p>
      ${warningText}
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger" data-action="do-delete-category" data-id="${id}">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doDeleteCategory(id, btnEl) {
  btnEl.disabled = true;
  try {
    await API.deleteCategory(id);
    btnEl.closest(".modal-overlay").remove();
    Toast.success("Category deleted");
    renderCategoriesTab();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

// ---- Merchants Tab ----

async function renderMerchantsTab() {
  const container = document.getElementById("taxonomy-content");
  if (!container) return;

  container.innerHTML = `
    <div class="merchant-toolbar">
      <input type="text" class="form-control" id="merchant-search" placeholder="Search merchants…">
      <button class="btn btn-primary btn-sm" data-action="show-add-merchant">+ Add</button>
    </div>
    <div id="merchant-list"><div class="spinner"></div></div>
  `;

  const searchInput = document.getElementById("merchant-search");
  let debounceTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadMerchantList(searchInput.value.trim()), 300);
  });

  await loadMerchantList("");
}

async function loadMerchantList(query) {
  const container = document.getElementById("merchant-list");
  if (!container) return;

  try {
    const merchants = query ? await API.searchMerchants(query) : await API.getMerchants();

    _merchantCache.clear();
    for (const m of merchants) _merchantCache.set(m.id, m);

    if (merchants.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🏪</div><div class="empty-text">No merchants found</div></div>`;
      return;
    }

    container.innerHTML = merchants
      .map(
        (m) => `
      <div class="card taxonomy-card">
        <div class="taxonomy-card-header">
          <div class="taxonomy-card-info">
            <div class="taxonomy-card-name">${escapeHtml(m.merchant_name || m.merchant_upi_id || "Unknown")}</div>
            <div class="taxonomy-card-desc">
              ${m.merchant_upi_id ? `<span class="badge badge-type">UPI: ${escapeHtml(m.merchant_upi_id)}</span> ` : ""}
              ${m.category ? `<span class="badge badge-default">${escapeHtml(m.category.name)}</span> ` : ""}
              <span class="confidence-score" title="Confidence">${(m.confidence_score * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div class="taxonomy-card-actions">
            <button class="btn-icon" title="Edit" data-action="show-edit-merchant" data-id="${m.id}">✏️</button>
            <button class="btn-icon" title="Delete" data-action="confirm-delete-merchant" data-id="${m.id}" data-name="${escapeHtml(m.merchant_name || m.merchant_upi_id || "")}">🗑</button>
          </div>
        </div>
      </div>
    `,
      )
      .join("");
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

async function showAddMerchantModal() {
  const categories = await API.getCategories();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Add Merchant</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Merchant Name</label>
        <input type="text" class="form-control" id="merch-name" placeholder="Merchant name">
      </div>
      <div class="form-group">
        <label>UPI ID</label>
        <input type="text" class="form-control" id="merch-upi" placeholder="Optional UPI ID">
      </div>
      <div class="form-group">
        <label>Category*</label>
        <select class="form-control" id="merch-category">
          <option value="">Select category</option>
          ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-create-merchant">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doCreateMerchant(btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const name = overlay.querySelector("#merch-name").value.trim();
  const upi = overlay.querySelector("#merch-upi").value.trim();
  const categoryId = Number.parseInt(overlay.querySelector("#merch-category").value, 10);

  if (!name && !upi) {
    Toast.error("Name or UPI ID required");
    return;
  }
  if (!categoryId) {
    Toast.error("Select a category");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.createMerchant({
      merchant_name: name || null,
      merchant_upi_id: upi || null,
      category_id: categoryId,
    });
    overlay.remove();
    Toast.success("Merchant created");
    loadMerchantList("");
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

async function showEditMerchantModal(m) {
  const categories = await API.getCategories();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Edit Merchant</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Merchant Name</label>
        <input type="text" class="form-control" id="merch-edit-name" value="${escapeHtml(m.merchant_name || "")}">
      </div>
      <div class="form-group">
        <label>UPI ID</label>
        <input type="text" class="form-control" id="merch-edit-upi" value="${escapeHtml(m.merchant_upi_id || "")}">
      </div>
      <div class="form-group">
        <label>Category</label>
        <select class="form-control" id="merch-edit-category">
          <option value="">None</option>
          ${categories.map((c) => `<option value="${c.id}" ${m.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Confidence (0.0–1.0)</label>
        <input type="number" class="form-control" id="merch-edit-confidence" step="0.01" min="0" max="1" value="${m.confidence_score}">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-update-merchant" data-id="${m.id}">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doUpdateMerchant(id, btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const name = overlay.querySelector("#merch-edit-name").value.trim();
  const upi = overlay.querySelector("#merch-edit-upi").value.trim();
  const categoryId =
    Number.parseInt(overlay.querySelector("#merch-edit-category").value, 10) || null;
  const confidence = Number.parseFloat(overlay.querySelector("#merch-edit-confidence").value);

  if (!name && !upi) {
    Toast.error("Name or UPI ID required");
    return;
  }

  if (!Number.isNaN(confidence) && (confidence < 0 || confidence > 1)) {
    Toast.error("Confidence must be between 0.0 and 1.0");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.updateMerchant(id, {
      merchant_name: name || null,
      merchant_upi_id: upi || null,
      category_id: categoryId,
      confidence_score: Number.isNaN(confidence) ? null : confidence,
    });
    overlay.remove();
    Toast.success("Merchant updated");
    loadMerchantList("");
    // A merchant rename propagates to its transactions — refresh any visible list/dashboard.
    if (Router.currentScreen === "#/transactions") loadTransactionList(true);
    else if (Router.currentScreen === "#/") renderDashboard();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

function confirmDeleteMerchant(id, name) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <p>Delete merchant "${escapeHtml(name)}"?</p>
      <p style="font-size:0.85rem;color:var(--color-text-secondary)">Transactions linked to this merchant will be unlinked.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger" data-action="do-delete-merchant" data-id="${id}">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doDeleteMerchant(id, btnEl) {
  btnEl.disabled = true;
  try {
    await API.deleteMerchant(id);
    btnEl.closest(".modal-overlay").remove();
    Toast.success("Merchant deleted");
    loadMerchantList("");
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

// ---- Tags Tab ----

async function renderTagsTab() {
  const container = document.getElementById("taxonomy-content");
  if (!container) return;

  try {
    const tags = await API.getTags();

    container.innerHTML =
      tags.length === 0
        ? `<div class="empty-state"><div class="empty-icon">🏷️</div><div class="empty-text">No tags yet. Tap + to create one.</div></div>`
        : tags
            .map(
              (t) => `
          <div class="card taxonomy-card">
            <div class="taxonomy-card-header">
              <div class="taxonomy-card-info">
                <div class="taxonomy-card-name">#${escapeHtml(t.name)}</div>
              </div>
              <div class="taxonomy-card-actions">
                <button class="btn-icon" title="Edit" data-action="show-edit-tag" data-id="${t.id}" data-name="${escapeHtml(t.name)}">✏️</button>
                <button class="btn-icon" title="Delete" data-action="confirm-delete-tag" data-id="${t.id}" data-name="${escapeHtml(t.name)}">🗑</button>
              </div>
            </div>
          </div>
        `,
            )
            .join("");
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function showAddTagModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Add Tag</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Name*</label>
        <input type="text" class="form-control" id="tag-name" placeholder="e.g. online or trip to yercaud">
        <small style="color:var(--color-text-secondary)">Spaces auto-convert to camelCase. No leading #.</small>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-create-tag">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doCreateTag(btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const name = overlay.querySelector("#tag-name").value.trim();
  if (!name) {
    Toast.error("Tag name is required");
    return;
  }
  btnEl.disabled = true;
  try {
    await API.createTag({ name });
    overlay.remove();
    Toast.success("Tag created");
    renderTagsTab();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

function showEditTagModal(id, currentName) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Edit Tag</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Name*</label>
        <input type="text" class="form-control" id="tag-edit-name" value="${escapeHtml(currentName)}">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-update-tag" data-id="${id}">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doUpdateTag(id, btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const name = overlay.querySelector("#tag-edit-name").value.trim();
  if (!name) {
    Toast.error("Tag name is required");
    return;
  }
  btnEl.disabled = true;
  try {
    await API.updateTag(id, { name });
    overlay.remove();
    Toast.success("Tag updated");
    renderTagsTab();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

async function confirmDeleteTag(id, name) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <p>Delete tag <strong>#${escapeHtml(name)}</strong>?</p>
      <p style="font-size:0.85rem;color:var(--color-text-secondary)">This will remove the tag from all transactions.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger" data-action="do-delete-tag" data-id="${id}">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doDeleteTag(id, btnEl) {
  btnEl.disabled = true;
  try {
    await API.deleteTag(id);
    btnEl.closest(".modal-overlay").remove();
    Toast.success("Tag deleted");
    renderTagsTab();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

// ============================================================================
// Tag input widget (shared by Add/Edit Transaction forms)
// ============================================================================

/**
 * Render tag chips for a list of tags into a container.
 * Each chip has a × button with data-action="remove-tag-chip".
 */
function _renderTagChips(container, tags) {
  container.innerHTML = tags
    .map(
      (t) =>
        `<span class="tag-chip" data-tag-id="${t.id}">#${escapeHtml(t.name)}<button class="tag-chip-remove" data-action="remove-tag-chip" title="Remove">×</button></span>`,
    )
    .join("");
}

/**
 * Setup tag input autocomplete for a given input element and chip container.
 * @param {string} inputId - id of the text input
 * @param {string} chipsId - id of the chips container div
 */
function setupTagInput(inputId, chipsId) {
  const input = document.getElementById(inputId);
  const chipsContainer = document.getElementById(chipsId);
  if (!input || !chipsContainer) return;

  let allTags = [];
  API.getTags()
    .then((tags) => {
      allTags = tags;
    })
    .catch(() => {});

  function addTagByName(rawName) {
    const name = rawName.trim().replace(/^#+/, "").trim();
    if (!name) return;
    // Convert spaces → camelCase (mirror server normalization)
    const words = name.split(/\s+/);
    const normalizedName =
      words.length === 1
        ? words[0]
        : words[0] +
          words
            .slice(1)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join("");
    if (!normalizedName) return;
    // Check if already added
    const existing = [...chipsContainer.querySelectorAll(".tag-chip")].find(
      (c) => c.dataset.tagName?.toLowerCase() === normalizedName.toLowerCase(),
    );
    if (existing) return;
    // Try to find an existing tag id
    const existingTag = allTags.find((t) => t.name.toLowerCase() === normalizedName.toLowerCase());
    const tagId = existingTag ? existingTag.id : `new:${normalizedName}`;
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.dataset.tagId = tagId;
    chip.dataset.tagName = normalizedName;
    chip.innerHTML = `#${escapeHtml(normalizedName)}<button class="tag-chip-remove" data-action="remove-tag-chip" title="Remove">×</button>`;
    chipsContainer.appendChild(chip);
    input.value = "";
    removeDropdown();
  }

  function showAllTagsDropdown() {
    removeDropdown();
    const alreadyAdded = new Set(
      [...chipsContainer.querySelectorAll(".tag-chip")].map((c) =>
        (c.dataset.tagName || "").toLowerCase(),
      ),
    );
    const available = allTags.filter((t) => !alreadyAdded.has(t.name.toLowerCase()));
    if (available.length === 0) return;
    dropdown = document.createElement("div");
    dropdown.className = "autocomplete-dropdown";
    for (const t of available.slice(0, 10)) {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      item.textContent = `#${t.name}`;
      item.onmousedown = (e) => {
        e.preventDefault();
        addTagByName(t.name);
      };
      dropdown.appendChild(item);
    }
    input.parentElement.style.position = "relative";
    input.parentElement.appendChild(dropdown);
  }

  let debounceTimer;
  let dropdown = null;

  input.addEventListener("focus", () => {
    if (input.value.trim() === "") showAllTagsDropdown();
  });

  input.addEventListener("click", () => {
    if (input.value.trim() === "" && !dropdown) showAllTagsDropdown();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTagByName(input.value);
    } else if (e.key === "Backspace" && input.value === "") {
      // Remove last chip
      const chips = chipsContainer.querySelectorAll(".tag-chip");
      if (chips.length > 0) chips[chips.length - 1].remove();
    }
  });

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim().replace(/^#+/, "");
    if (q.length < 1) {
      showAllTagsDropdown();
      return;
    }
    debounceTimer = setTimeout(() => {
      const matches = allTags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
      if (matches.length === 0) {
        removeDropdown();
        return;
      }
      removeDropdown();
      dropdown = document.createElement("div");
      dropdown.className = "autocomplete-dropdown";
      for (const t of matches.slice(0, 8)) {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        item.textContent = `#${t.name}`;
        item.onmousedown = (e) => {
          e.preventDefault();
          addTagByName(t.name);
        };
        dropdown.appendChild(item);
      }
      input.parentElement.style.position = "relative";
      input.parentElement.appendChild(dropdown);
    }, 200);
  });

  input.addEventListener("blur", () => {
    setTimeout(removeDropdown, 200);
  });

  function removeDropdown() {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
  }
}

/**
 * Collect tag ids from the chip container.
 * For chips with `new:name` ids, creates the tag first and returns the new id.
 * Returns a Promise<number[]> of tag ids.
 */
async function collectTagIds(chipsId) {
  const chipsContainer = document.getElementById(chipsId);
  if (!chipsContainer) return [];
  const chips = [...chipsContainer.querySelectorAll(".tag-chip")];
  const ids = [];
  for (const chip of chips) {
    const rawId = chip.dataset.tagId;
    if (!rawId) continue;
    if (String(rawId).startsWith("new:")) {
      const name = rawId.slice(4);
      try {
        const created = await API.createTag({ name });
        ids.push(created.id);
      } catch {
        // Tag may already exist (race condition), look it up
        try {
          const tags = await API.getTags();
          const found = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
          if (found) ids.push(found.id);
        } catch {
          // ignore
        }
      }
    } else {
      ids.push(Number(rawId));
    }
  }
  return ids;
}

// ============================================================================
// Merchant autocomplete for Add Transaction
// ============================================================================

function setupMerchantAutocomplete(inputId, categorySelectId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  let debounceTimer;
  let dropdown = null;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 1) {
      removeDropdown();
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const results = await API.searchMerchants(q);
        showAutocompleteDropdown(results);
      } catch {
        removeDropdown();
      }
    }, 300);
  });

  input.addEventListener("blur", () => {
    setTimeout(removeDropdown, 200);
  });

  function showAutocompleteDropdown(results) {
    removeDropdown();
    if (results.length === 0) return;

    dropdown = document.createElement("div");
    dropdown.className = "autocomplete-dropdown";
    for (const m of results.slice(0, 8)) {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      item.textContent = m.merchant_name || m.merchant_upi_id || "Unknown";
      item.onclick = () => {
        input.value = m.merchant_name || m.merchant_upi_id || "";
        if (m.category_id && categorySelectId) {
          const sel = document.getElementById(categorySelectId);
          if (sel) sel.value = m.category_id;
        }
        removeDropdown();
      };
      dropdown.appendChild(item);
    }
    input.parentElement.style.position = "relative";
    input.parentElement.appendChild(dropdown);
  }

  function removeDropdown() {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
  }
}

// ============================================================================
// Screen: Goals
// ============================================================================

// Store chart instances for cleanup
let goalChartInstances = {};

function destroyGoalCharts() {
  for (const c of Object.values(goalChartInstances)) {
    try {
      c.destroy();
    } catch {}
  }
  goalChartInstances = {};
}

async function renderGoals() {
  destroyGoalCharts();
  const screen = getScreen();
  screen.innerHTML = `<div class="spinner"></div>`;

  try {
    const goals = await API.getGoals();

    if (goals.length === 0) {
      screen.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎯</div>
          <div class="empty-text">No goals yet. Create one to start tracking!</div>
        </div>
        <button class="fab" data-action="show-create-goal" title="Add Goal">+</button>
      `;
      return;
    }

    screen.innerHTML = `
      <div id="goals-list">
        ${goals.map((g) => goalCardHTML(g)).join("")}
      </div>
      <button class="fab" data-action="show-create-goal" title="Add Goal">+</button>
    `;

    // Render doughnut charts after DOM is ready
    for (const g of goals) renderGoalChart(g);
  } catch (err) {
    screen.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function goalCardHTML(g) {
  const pct = g.target_amount > 0 ? Math.min((g.current_amount / g.target_amount) * 100, 100) : 0;
  const remaining = Math.max(g.target_amount - g.current_amount, 0);

  let deadlineHTML = "";
  let barColorClass = "goal-fill-normal";
  if (g.deadline) {
    const now = new Date();
    const dl = new Date(`${g.deadline}T23:59:59`);
    const diffMs = dl - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      deadlineHTML = `<span class="goal-deadline overdue">Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? "s" : ""}</span>`;
      barColorClass = "goal-fill-danger";
    } else if (diffDays <= 7) {
      deadlineHTML = `<span class="goal-deadline urgent">${diffDays} day${diffDays !== 1 ? "s" : ""} left</span>`;
      barColorClass = "goal-fill-warning";
    } else if (diffDays <= 30) {
      deadlineHTML = `<span class="goal-deadline soon">${diffDays} days left</span>`;
      barColorClass = "goal-fill-warning";
    } else {
      deadlineHTML = `<span class="goal-deadline">${diffDays} days left</span>`;
    }
  }

  if (pct >= 100) {
    barColorClass = "goal-fill-complete";
  }

  return `
    <div class="card goal-card">
      <div class="goal-card-top">
        <div class="goal-card-info">
          <div class="goal-card-name">${escapeHtml(g.name)}</div>
          ${deadlineHTML}
        </div>
        <div class="goal-chart-container">
          <canvas id="goal-chart-${g.id}" width="64" height="64"></canvas>
        </div>
      </div>
      <div class="goal-progress-bar">
        <div class="goal-progress-fill ${barColorClass}" style="width:${pct.toFixed(1)}%"></div>
      </div>
      <div class="goal-stats">
        <div class="goal-stat">
          <span class="goal-stat-label">Saved</span>
          <span class="goal-stat-value">${privacyAmount(formatCurrency(g.current_amount))}</span>
        </div>
        <div class="goal-stat">
          <span class="goal-stat-label">Target</span>
          <span class="goal-stat-value">${privacyAmount(formatCurrency(g.target_amount))}</span>
        </div>
        <div class="goal-stat">
          <span class="goal-stat-label">Remaining</span>
          <span class="goal-stat-value">${privacyAmount(formatCurrency(remaining))}</span>
        </div>
      </div>
      <div class="goal-actions">
        <button class="btn btn-primary btn-sm" data-action="show-contribute" data-id="${g.id}" data-name="${escapeHtml(g.name)}">+ Contribute</button>
        <button class="btn btn-outline btn-sm" data-action="show-edit-goal" data-id="${g.id}">Edit</button>
        <button class="btn btn-outline btn-sm" data-action="confirm-delete-goal" data-id="${g.id}" data-name="${escapeHtml(g.name)}">Delete</button>
      </div>
    </div>
  `;
}

function renderGoalChart(g) {
  const canvas = document.getElementById(`goal-chart-${g.id}`);
  if (!canvas || typeof Chart === "undefined") return;

  const pct = g.target_amount > 0 ? Math.min((g.current_amount / g.target_amount) * 100, 100) : 0;
  const remainPct = 100 - pct;

  const fillColor = pct >= 100 ? "rgba(102, 187, 106, 0.9)" : "rgba(100, 181, 246, 0.9)";
  const bgColor =
    getComputedStyle(document.documentElement).getPropertyValue("--color-border").trim() || "#333";

  goalChartInstances[g.id] = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Saved", "Remaining"],
      datasets: [
        {
          data: [pct, remainPct],
          backgroundColor: [fillColor, bgColor],
          borderWidth: 0,
        },
      ],
    },
    options: {
      cutout: "70%",
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
    plugins: [
      {
        id: "centerText",
        afterDraw(chart) {
          const { ctx, width, height } = chart;
          ctx.save();
          ctx.font = "bold 13px sans-serif";
          ctx.fillStyle =
            getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim() ||
            "#E0E0E0";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`${Math.round(pct)}%`, width / 2, height / 2);
          ctx.restore();
        },
      },
    ],
  });
}

function showCreateGoalModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Create Goal</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Name*</label>
        <input type="text" class="form-control" id="goal-name" placeholder="e.g. Emergency Fund">
      </div>
      <div class="form-group">
        <label>Target Amount*</label>
        <input type="number" class="form-control" id="goal-target" step="0.01" min="0.01" placeholder="0.00">
      </div>
      <div class="form-group">
        <label>Deadline</label>
        <input type="date" class="form-control" id="goal-deadline">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-create-goal">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doCreateGoal(btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const name = overlay.querySelector("#goal-name").value.trim();
  const target = Number.parseFloat(overlay.querySelector("#goal-target").value);
  const deadline = overlay.querySelector("#goal-deadline").value || null;

  if (!name) {
    Toast.error("Name is required");
    return;
  }
  if (!target || target <= 0) {
    Toast.error("Enter a valid target amount");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.createGoal({ name, target_amount: target, deadline });
    overlay.remove();
    Toast.success("Goal created");
    renderGoals();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

async function showEditGoalModal(goalId) {
  try {
    const g = await API.getGoal(goalId);

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">Edit Goal</span>
          <button class="modal-close" data-action="close-modal">&times;</button>
        </div>
        <div class="form-group">
          <label>Name*</label>
          <input type="text" class="form-control" id="goal-edit-name" value="${escapeHtml(g.name)}">
        </div>
        <div class="form-group">
          <label>Target Amount*</label>
          <input type="number" class="form-control" id="goal-edit-target" step="0.01" min="0.01" value="${g.target_amount}">
        </div>
        <div class="form-group">
          <label>Current Amount</label>
          <input type="number" class="form-control" id="goal-edit-current" step="0.01" min="0" value="${g.current_amount}">
        </div>
        <div class="form-group">
          <label>Deadline</label>
          <input type="date" class="form-control" id="goal-edit-deadline" value="${g.deadline || ""}">
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" data-action="close-modal">Cancel</button>
          <button class="btn btn-primary" data-action="do-update-goal" data-id="${g.id}">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  } catch (err) {
    Toast.error(err.message);
  }
}

async function doUpdateGoal(goalId, btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const name = overlay.querySelector("#goal-edit-name").value.trim();
  const target = Number.parseFloat(overlay.querySelector("#goal-edit-target").value);
  const current = Number.parseFloat(overlay.querySelector("#goal-edit-current").value);
  const deadline = overlay.querySelector("#goal-edit-deadline").value || null;

  if (!name) {
    Toast.error("Name is required");
    return;
  }
  if (!target || target <= 0) {
    Toast.error("Enter a valid target amount");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.updateGoal(goalId, {
      name,
      target_amount: target,
      current_amount: Number.isNaN(current) ? 0 : current,
      deadline,
    });
    overlay.remove();
    Toast.success("Goal updated");
    renderGoals();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

function showContributeModal(goalId, goalName) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Contribute to ${escapeHtml(goalName)}</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Amount*</label>
        <input type="number" class="form-control" id="goal-contribute-amount" step="0.01" min="0.01" placeholder="0.00">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-contribute-goal" data-id="${goalId}">Contribute</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  // Auto-focus the amount input
  setTimeout(() => {
    const input = overlay.querySelector("#goal-contribute-amount");
    if (input) input.focus();
  }, 100);
}

async function doContributeToGoal(goalId, btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const amount = Number.parseFloat(overlay.querySelector("#goal-contribute-amount").value);

  if (!amount || amount <= 0) {
    Toast.error("Enter a valid amount");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.contributeToGoal(goalId, amount);
    overlay.remove();
    Toast.success(`Contributed ${formatCurrency(amount)}`);
    renderGoals();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

function confirmDeleteGoal(goalId, goalName) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <p>Delete goal "${escapeHtml(goalName)}"?</p>
      <p style="font-size:0.85rem;color:var(--color-text-secondary)">This action cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger" data-action="do-delete-goal" data-id="${goalId}">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doDeleteGoal(goalId, btnEl) {
  btnEl.disabled = true;
  try {
    await API.deleteGoal(goalId);
    btnEl.closest(".modal-overlay").remove();
    Toast.success("Goal deleted");
    renderGoals();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

// ============================================================================
// Screen: Budgets
// ============================================================================

function lastDayOfMonthISO() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

function budgetStatusLabel(status) {
  if (status === "exceeded")
    return `<span class="budget-status budget-status-exceeded">Exceeded</span>`;
  if (status === "warning")
    return `<span class="budget-status budget-status-warning">Warning</span>`;
  return `<span class="budget-status budget-status-on-track">On Track</span>`;
}

function budgetBarClass(status) {
  if (status === "exceeded") return "budget-fill-exceeded";
  if (status === "warning") return "budget-fill-warning";
  return "budget-fill-on-track";
}

async function renderBudgets() {
  const screen = getScreen();
  screen.innerHTML = `<div class="spinner"></div>`;

  try {
    const budgets = await API.getBudgets(true);

    if (budgets.length === 0) {
      screen.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💰</div>
          <div class="empty-text">No budgets yet. Create one to start tracking spending!</div>
        </div>
        <button class="fab" data-action="show-create-budget" title="Add Budget">+</button>
      `;
      return;
    }

    screen.innerHTML = `
      <div id="budgets-list">
        ${budgets.map((b) => budgetCardHTML(b)).join("")}
      </div>
      <button class="fab" data-action="show-create-budget" title="Add Budget">+</button>
    `;
  } catch (err) {
    screen.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function budgetCardHTML(b) {
  const pct = Math.min(b.percentage_used, 100);
  const fillClass = budgetBarClass(b.status);

  return `
    <div class="card budget-card">
      <div class="budget-card-header">
        <div class="budget-card-name">${escapeHtml(b.category_name)}</div>
        ${budgetStatusLabel(b.status)}
      </div>
      <div class="budget-card-period">${b.period_start} → ${b.period_end}</div>
      <div class="budget-progress-bar">
        <div class="budget-progress-fill ${fillClass}" style="width:${pct.toFixed(1)}%"></div>
      </div>
      <div class="budget-pct">${b.percentage_used.toFixed(1)}% used</div>
      <div class="budget-stats">
        <div class="budget-stat">
          <span class="budget-stat-label">Spent</span>
          <span class="budget-stat-value">${privacyAmount(formatCurrency(b.spent_to_date))}</span>
        </div>
        <div class="budget-stat">
          <span class="budget-stat-label">Limit</span>
          <span class="budget-stat-value">${privacyAmount(formatCurrency(b.limit_amount))}</span>
        </div>
        <div class="budget-stat">
          <span class="budget-stat-label">Remaining</span>
          <span class="budget-stat-value">${privacyAmount(formatCurrency(b.remaining))}</span>
        </div>
      </div>
      <div class="budget-actions">
        <button class="btn btn-outline btn-sm" data-action="show-edit-budget" data-id="${b.id}">Edit</button>
        <button class="btn btn-outline btn-sm" data-action="confirm-delete-budget" data-id="${b.id}" data-name="${escapeHtml(b.category_name)}">Delete</button>
      </div>
    </div>
  `;
}

async function showCreateBudgetModal() {
  let categories = [];
  try {
    categories = await API.getCategories();
  } catch {
    Toast.error("Failed to load categories");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  const catOptions = categories
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Create Budget</span>
        <button class="modal-close" data-action="close-modal">&times;</button>
      </div>
      <div class="form-group">
        <label>Category*</label>
        <select class="form-control" id="budget-category">${catOptions}</select>
      </div>
      <div class="form-group">
        <label>Period Start*</label>
        <input type="date" class="form-control" id="budget-start" value="${firstOfMonthISO()}">
      </div>
      <div class="form-group">
        <label>Period End*</label>
        <input type="date" class="form-control" id="budget-end" value="${lastDayOfMonthISO()}">
      </div>
      <div class="form-group">
        <label>Limit Amount*</label>
        <input type="number" class="form-control" id="budget-limit" step="0.01" min="0.01" placeholder="0.00">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="do-create-budget">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doCreateBudget(btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const categoryId = Number.parseInt(overlay.querySelector("#budget-category").value, 10);
  const start = overlay.querySelector("#budget-start").value;
  const end = overlay.querySelector("#budget-end").value;
  const limit = Number.parseFloat(overlay.querySelector("#budget-limit").value);

  if (!start || !end) {
    Toast.error("Period dates are required");
    return;
  }
  if (!limit || limit <= 0) {
    Toast.error("Enter a valid limit amount");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.createBudget({
      category_id: categoryId,
      period_start: start,
      period_end: end,
      limit_amount: limit,
    });
    overlay.remove();
    Toast.success("Budget created");
    renderBudgets();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

async function showEditBudgetModal(budgetId) {
  try {
    const b = await API.getBudget(budgetId);

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">Edit Budget — ${escapeHtml(b.category_name)}</span>
          <button class="modal-close" data-action="close-modal">&times;</button>
        </div>
        <div class="form-group">
          <label>Period Start*</label>
          <input type="date" class="form-control" id="budget-edit-start" value="${b.period_start}">
        </div>
        <div class="form-group">
          <label>Period End*</label>
          <input type="date" class="form-control" id="budget-edit-end" value="${b.period_end}">
        </div>
        <div class="form-group">
          <label>Limit Amount*</label>
          <input type="number" class="form-control" id="budget-edit-limit" step="0.01" min="0.01" value="${b.limit_amount}">
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" data-action="close-modal">Cancel</button>
          <button class="btn btn-primary" data-action="do-update-budget" data-id="${b.id}">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  } catch (err) {
    Toast.error(err.message);
  }
}

async function doUpdateBudget(budgetId, btnEl) {
  const overlay = btnEl.closest(".modal-overlay");
  const start = overlay.querySelector("#budget-edit-start").value;
  const end = overlay.querySelector("#budget-edit-end").value;
  const limit = Number.parseFloat(overlay.querySelector("#budget-edit-limit").value);

  if (!start || !end) {
    Toast.error("Period dates are required");
    return;
  }
  if (!limit || limit <= 0) {
    Toast.error("Enter a valid limit amount");
    return;
  }

  btnEl.disabled = true;
  try {
    await API.updateBudget(budgetId, {
      period_start: start,
      period_end: end,
      limit_amount: limit,
    });
    overlay.remove();
    Toast.success("Budget updated");
    renderBudgets();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

function confirmDeleteBudget(budgetId, categoryName) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.innerHTML = `
    <div class="modal confirm-dialog">
      <p>Delete budget for "${escapeHtml(categoryName)}"?</p>
      <p style="font-size:0.85rem;color:var(--color-text-secondary)">This action cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger" data-action="do-delete-budget" data-id="${budgetId}">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doDeleteBudget(budgetId, btnEl) {
  btnEl.disabled = true;
  try {
    await API.deleteBudget(budgetId);
    btnEl.closest(".modal-overlay").remove();
    Toast.success("Budget deleted");
    renderBudgets();
  } catch (err) {
    Toast.error(err.message);
    btnEl.disabled = false;
  }
}

// ============================================================================
// Screen: Reports
// ============================================================================

const CHART_COLORS = [
  "#64B5F6",
  "#66BB6A",
  "#EF5350",
  "#FFA726",
  "#AB47BC",
  "#26C6DA",
  "#FF7043",
  "#9CCC65",
  "#EC407A",
  "#5C6BC0",
  "#29B6F6",
  "#FFCA28",
  "#8D6E63",
  "#78909C",
  "#D4E157",
  "#26A69A",
];

let _reportPieChart = null;
let _reportLineChart = null;

function destroyReportCharts() {
  if (_reportPieChart) {
    _reportPieChart.destroy();
    _reportPieChart = null;
  }
  if (_reportLineChart) {
    _reportLineChart.destroy();
    _reportLineChart = null;
  }
}

function monthsAgoISO(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().split("T")[0];
}

async function renderReports() {
  const screen = getScreen();
  const defaultStart = monthsAgoISO(6);
  const defaultEnd = todayISO();

  let accounts = [];
  let allTags = [];
  try {
    [accounts, allTags] = await Promise.all([API.getAccounts(true), API.getTags()]);
  } catch {
    /* proceed without accounts/tags */
  }

  const accountOptions = accounts
    .map(
      (a) =>
        `<option value="${a.id}">${escapeHtml(a.name)}${a.merged_into_id ? " (merged)" : ""}</option>`,
    )
    .join("");

  screen.innerHTML = `
    <div class="card">
      <div class="card-title">Spending Analysis</div>
      <div class="filter-bar">
        <input type="date" id="report-start" class="form-control" value="${defaultStart}">
        <input type="date" id="report-end" class="form-control" value="${defaultEnd}">
        <select id="report-account" class="form-control">
          <option value="">All accounts</option>
          ${accountOptions}
        </select>
        <button class="btn btn-primary" data-action="load-report">Apply</button>
      </div>
      ${
        allTags.length > 0
          ? `
      <div class="filter-bar" style="margin-top:var(--space-sm)">
        <div class="tag-filter-dropdown" id="report-tags-dropdown">
          <button type="button" class="tag-filter-btn" id="report-tags-btn">
            <span id="report-tags-label">Filter by tags</span>
            <span class="tag-filter-arrow">▾</span>
          </button>
          <div class="tag-filter-menu hidden" id="report-tags-menu">
            ${allTags.map((t) => `<label class="tag-filter-option"><input type="checkbox" value="${t.id}"> #${escapeHtml(t.name)}</label>`).join("")}
          </div>
        </div>
      </div>`
          : ""
      }
    </div>
    <div id="report-summary" class="report-summary" style="display:none"></div>
    <div id="report-charts" class="reports-charts" style="display:none">
      <div class="chart-card">
        <div class="card-title">By Category</div>
        <canvas id="spending-pie-chart"></canvas>
      </div>
      <div class="chart-card">
        <div class="card-title">Monthly Trend</div>
        <canvas id="spending-line-chart"></canvas>
      </div>
    </div>
    <div id="report-table-container" style="display:none"></div>
    <div id="report-empty" style="display:none">
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <div class="empty-text">No expense transactions in this period</div>
      </div>
    </div>
    <div id="report-loading" class="spinner" style="display:none"></div>
  `;
  loadReport();

  // Wire report tag dropdown toggle
  const rTagsBtn = document.getElementById("report-tags-btn");
  const rTagsMenu = document.getElementById("report-tags-menu");
  if (rTagsBtn && rTagsMenu) {
    rTagsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      rTagsMenu.classList.toggle("hidden");
    });
    document.addEventListener("click", function closeRTagsMenu(e) {
      if (!rTagsBtn.contains(e.target) && !rTagsMenu.contains(e.target)) {
        rTagsMenu.classList.add("hidden");
      }
    });
  }
}

async function loadReport() {
  const startEl = document.getElementById("report-start");
  const endEl = document.getElementById("report-end");
  const accountEl = document.getElementById("report-account");
  if (!startEl) return;

  const tagCheckboxes = document.querySelectorAll("#report-tags-menu input[type=checkbox]");
  const selectedTagIds = [...tagCheckboxes]
    .filter((cb) => cb.checked)
    .map((cb) => Number(cb.value));
  // Update button label
  const rTagsLabel = document.getElementById("report-tags-label");
  if (rTagsLabel) {
    rTagsLabel.textContent =
      selectedTagIds.length > 0
        ? selectedTagIds
            .map((id) => {
              const cb = document.querySelector(`#report-tags-menu input[value="${id}"]`);
              return cb ? cb.closest("label").textContent.trim() : "";
            })
            .filter(Boolean)
            .join(", ")
        : "Filter by tags";
  }

  const params = {
    start_date: startEl.value,
    end_date: endEl.value,
    account_id: accountEl.value,
    tag_ids: selectedTagIds.length > 0 ? selectedTagIds : undefined,
  };

  const summaryDiv = document.getElementById("report-summary");
  const chartsDiv = document.getElementById("report-charts");
  const tableDiv = document.getElementById("report-table-container");
  const emptyDiv = document.getElementById("report-empty");
  const loadingDiv = document.getElementById("report-loading");

  summaryDiv.style.display = "none";
  chartsDiv.style.display = "none";
  tableDiv.style.display = "none";
  emptyDiv.style.display = "none";
  loadingDiv.style.display = "";
  destroyReportCharts();

  try {
    const data = await API.getSpendingReport(params);
    loadingDiv.style.display = "none";

    if (data.total_transactions === 0) {
      emptyDiv.style.display = "";
      return;
    }

    // Summary cards
    summaryDiv.style.display = "";
    summaryDiv.innerHTML = `
      <div class="stat-card expense">
        <div class="stat-value">${formatCurrency(data.total_spent)}</div>
        <div class="stat-label">Total Spent</div>
      </div>
      <div class="stat-card" style="background:var(--color-primary-light);color:var(--color-primary)">
        <div class="stat-value">${data.total_transactions}</div>
        <div class="stat-label">Transactions</div>
      </div>
    `;

    // Charts
    chartsDiv.style.display = "";
    renderSpendingPieChart(data.by_category);
    renderSpendingLineChart(data.monthly_trend);

    // Table
    tableDiv.style.display = "";
    tableDiv.innerHTML = `
      <div class="card" style="margin-top:var(--space-md)">
        <div class="card-title">Category Breakdown</div>
        <table class="category-table">
          <thead>
            <tr><th>Category</th><th>Amount</th><th>Count</th></tr>
          </thead>
          <tbody>
            ${data.by_category
              .map(
                (c) => `
              <tr>
                <td>${escapeHtml(c.category_name)}</td>
                <td>${formatCurrency(c.total_amount)}</td>
                <td>${c.transaction_count}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    loadingDiv.style.display = "none";
    Toast.error(err.message);
  }
}

function renderSpendingPieChart(byCategory) {
  const ctx = document.getElementById("spending-pie-chart");
  if (!ctx) return;
  const isDark = !document.body.classList.contains("light");
  _reportPieChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: byCategory.map((c) => c.category_name),
      datasets: [
        {
          data: byCategory.map((c) => c.total_amount),
          backgroundColor: byCategory.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: isDark ? "#E0E0E0" : "#212121", padding: 12, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.parsed)}`,
          },
        },
      },
    },
  });
}

function renderSpendingLineChart(monthlyTrend) {
  const ctx = document.getElementById("spending-line-chart");
  if (!ctx) return;
  const isDark = !document.body.classList.contains("light");
  const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const textColor = isDark ? "#E0E0E0" : "#212121";
  _reportLineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: monthlyTrend.map((m) => m.month),
      datasets: [
        {
          label: "Spending",
          data: monthlyTrend.map((m) => m.total_amount),
          borderColor: "#EF5350",
          backgroundColor: "rgba(239,83,80,0.15)",
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: {
          beginAtZero: true,
          ticks: {
            color: textColor,
            callback: (v) => formatCurrency(v),
          },
          grid: { color: gridColor },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => formatCurrency(ctx.parsed.y),
          },
        },
      },
    },
  });
}

// ============================================================================
// Screen: Settings
// ============================================================================

async function renderSettings() {
  const screen = getScreen();
  const settings = AI.getSettings();
  const providerKeys = Object.keys(AI_PROVIDERS);
  const trustedDevice = localStorage.getItem(TRUSTED_DEVICE_KEY) === "true";
  const fromOnboarding = window.location.hash.includes("?onboarding=1");

  let gmailStatus = { connected: false, email: null };
  try {
    gmailStatus = await API.getGmailStatus();
  } catch {
    // ignore — show disconnected state
  }
  const gmailConnected = gmailStatus.connected;
  const email = gmailStatus.email || "";
  const driveEnabled = GDrive.isEnabled();
  const lastSync = GDrive.getLastSyncTime();

  // The sample-data loader is offered only on an empty database so it can never clobber
  // real user data (the loader itself also refuses to run on a non-empty DB).
  let isDbEmpty = false;
  try {
    const accts = await API.getAccounts(true);
    isDbEmpty = accts.length === 0;
  } catch {
    // ignore — default to hiding the button
  }

  const backupApiKeyEnabled = localStorage.getItem(GDRIVE_BACKUP_API_KEY_KEY) === "true";
  const vaultConfigured = Vault.isConfigured();
  const biometricAvailable = vaultConfigured ? await API.isBiometricAvailable() : false;
  const biometricEnabled = vaultConfigured ? API.isBiometricEnabled() : false;

  const providerOptions = providerKeys
    .map((k) => {
      const p = AI_PROVIDERS[k];
      const sel = settings.provider === k ? "selected" : "";
      return `<option value="${k}" ${sel}>${p.name}</option>`;
    })
    .join("");

  const currentProvider = settings.provider ? AI_PROVIDERS[settings.provider] : null;
  const isAzure = settings.provider === "azure";
  const azureFieldsDisplay = isAzure ? "block" : "none";

  const modelSuggestions = (currentProvider?.models || [])
    .map((m) => `<option value="${m}">`)
    .join("");

  const modelInputHtml = isAzure
    ? `<input type="text" id="ai-model" class="form-control" value="Set by deployment name" disabled>`
    : `<input type="text" id="ai-model" class="form-control"
             list="ai-model-options"
             value="${escapeHtml(settings.model || currentProvider?.defaultModel || "")}"
             placeholder="${escapeHtml(currentProvider?.defaultModel || "Enter model name")}">
       <datalist id="ai-model-options">${modelSuggestions}</datalist>`;

  const showKey = currentProvider ? currentProvider.requiresKey : true;
  const aiNeedsConsent = settings.provider && AI.requiresExternalConsent(settings.provider);
  const aiConsentGranted = aiNeedsConsent ? AI.hasExternalConsent(settings.provider) : true;
  const gmailCustomSenders = (API.getGmailCustomSenders?.() ?? []).join(", ");

  const onboardingBanner = fromOnboarding
    ? `<div class="card settings-section" style="margin-bottom:var(--space-lg);border-left:4px solid var(--color-primary)">
        <p class="text-muted" style="margin:0">
          ✨ <strong>Almost there!</strong> Configure your AI provider below to unlock financial coaching,
          then head to your dashboard.
        </p>
      </div>`
    : "";

  screen.innerHTML = `
    ${onboardingBanner}
    <div class="card settings-section gdrive-section">
      <h2>Google Drive Sync</h2>
      <p class="text-muted">Back up your data to Google Drive, encrypted with your Google account key.</p>
      ${
        !gmailConnected
          ? `
      <div class="gdrive-status-row">
        <span class="gdrive-status gdrive-disconnected">&#10007; Not connected to Google</span>
        <button class="btn btn-primary btn-sm" data-action="gdrive-connect">Connect Google Account</button>
      </div>
      `
          : !driveEnabled
            ? `
      <div class="gdrive-status-row">
        <span class="gdrive-status gdrive-disconnected">
          &#10007; Drive sync disabled${email ? ` &mdash; ${escapeHtml(email)}` : ""}
        </span>
        <button class="btn btn-primary btn-sm" data-action="gdrive-enable">Enable Drive Sync</button>
        <button class="btn btn-sm" data-action="gdrive-connect">Reconnect Google Account</button>
      </div>
      `
            : `
      <div class="gdrive-status-row">
        <span class="gdrive-status gdrive-connected">
          &#10003; Drive sync active${email ? ` &mdash; ${escapeHtml(email)}` : ""}
        </span>
        <button class="btn btn-sm" data-action="gdrive-connect">Reconnect</button>
        <button class="btn btn-sm" data-action="gdrive-disconnect">Disable Drive Sync</button>
      </div>
      <div class="settings-field" style="margin-top: var(--space-md)">
        <div class="gdrive-toggle-label">
          <span>Auto-sync on app open (at most once per hour)</span>
          <label class="toggle-switch">
            <input type="checkbox" data-action="gdrive-toggle-auto" ${driveEnabled ? "checked" : ""}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="gdrive-last-sync text-muted">
        Last synced: ${lastSync ? new Date(lastSync).toLocaleString() : "Never"}
      </div>
      <div class="settings-actions" style="margin-top: var(--space-md)">
        <button id="gdrive-sync-btn" class="btn btn-primary" data-action="gdrive-sync">&#8645; Sync with Drive</button>
        <button id="gdrive-delete-btn" class="btn btn-danger btn-sm" data-action="gdrive-delete-backup" disabled aria-disabled="true">&#128465; Delete Drive Backup</button>
        <span id="gdrive-no-backup-msg" class="text-muted" style="font-size:0.85em">Checking…</span>
      </div>
      <p class="text-muted gdrive-help" style="font-size: 0.85em; margin-top: var(--space-sm)">
        Sync merges Drive and local data &mdash; records from either side are combined,
        nothing is deleted. Safe to use across multiple devices.
      </p>
      `
      }
      <div id="gdrive-backup-api-key-field" class="settings-field" style="margin-top: var(--space-md); display:${showKey ? "block" : "none"}">
        <div class="toggle-row">
          <span>
            Include API key in Google Drive backup
            <span class="info-notice" tabindex="0" role="note" aria-label="Security warning">
              ⚠️
              <span class="info-notice-tooltip">Your API key will be stored encrypted in Drive — do not enable on shared accounts.</span>
            </span>
          </span>
          <label class="toggle-switch">
            <input type="checkbox" data-action="gdrive-toggle-backup-api-key" ${backupApiKeyEnabled ? "checked" : ""}/>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>

    <div class="card settings-section" style="margin-top: var(--space-lg)">
      <h2>AI Settings</h2>
      <p class="text-muted">Configure your AI provider to enable chat. API keys are stored only in the Credential Vault and require an unlocked PIN to use.
        <span class="info-notice" tabindex="0" role="note" aria-label="Privacy notice">
          🔒
          <span class="info-notice-tooltip">External providers receive masked financial context only after you explicitly consent. Ollama stays local on your device. Detected identifiers are masked before sending when possible, but you should still avoid sharing secrets in free-form prompts.</span>
        </span>
      </p>

      <div class="settings-field">
        <label for="ai-provider">Provider</label>
        <select id="ai-provider" class="form-control" data-change="provider-change">
          <option value="">— Select Provider —</option>
          ${providerOptions}
        </select>
      </div>

      <div class="settings-field" id="api-key-field" style="display:${showKey ? "block" : "none"}">
        <label for="ai-api-key">API Key</label>
        <div class="password-wrapper">          <input type="password" id="ai-api-key" class="form-control" value="${escapeHtml(settings.apiKey || "")}" placeholder="Enter API key" autocomplete="off" />
          <button type="button" class="btn btn-sm" data-action="toggle-key-visibility">Show</button>
          <span class="info-notice" tabindex="0" role="note" aria-label="Security warning">
            ⚠️
            <span class="info-notice-tooltip">API keys are encrypted in the Credential Vault. Set up or unlock your PIN before saving them.</span>
          </span>
        </div>
        <small class="text-muted" style="font-weight:normal;display:block;margin-top:var(--space-xs)">Optional — the app works without a key, but AI features improve accuracy and enable personalised coaching.</small>
      </div>

      <div class="settings-field">
        <label for="ai-model">Model</label>
        ${modelInputHtml}
      </div>

      <div class="settings-field" id="azure-fields" style="display:${azureFieldsDisplay}">
        <label for="azure-resource-name">Resource Name</label>
        <input type="text" id="azure-resource-name" class="form-control"
               value="${escapeHtml(settings.azureResourceName || "")}" placeholder="e.g. my-openai-resource" />
        <label for="azure-deployment-name" style="margin-top:var(--space-sm)">Deployment Name</label>
        <input type="text" id="azure-deployment-name" class="form-control"
               value="${escapeHtml(settings.azureDeploymentName || "")}" placeholder="e.g. gpt-4o" />
        <label for="azure-api-version" style="margin-top:var(--space-sm)">API Version</label>
        <input type="text" id="azure-api-version" class="form-control"
               value="${escapeHtml(settings.azureApiVersion || "2024-12-01-preview")}" />
      </div>

      <div class="settings-field" id="ollama-base-url-field" style="display:${settings.provider === "ollama" ? "block" : "none"}">
        <label for="ollama-base-url">Ollama Base URL</label>
        <input type="url" id="ollama-base-url" class="form-control"
               value="${escapeHtml(settings.ollamaBaseUrl || "http://localhost:11434")}"
               placeholder="http://localhost:11434" />
      </div>

      ${
        aiNeedsConsent
          ? `
      <div class="settings-field">
        <label>External AI consent</label>
        <p class="text-muted" style="margin-bottom:var(--space-sm)">
          ${
            aiConsentGranted
              ? `✓ Consent granted for ${escapeHtml(currentProvider?.name || settings.provider)}. Chat and Gmail extraction may send masked data directly to this provider from your browser.`
              : `Consent not yet granted for ${escapeHtml(currentProvider?.name || settings.provider)}. Chat and Gmail extraction will stay local / heuristic until you opt in.`
          }
        </p>
        <div class="settings-actions">
          ${
            aiConsentGranted
              ? `<button class="btn btn-outline" data-action="revoke-ai-consent">Revoke Consent</button>`
              : `<button class="btn" data-action="review-ai-consent">Review Consent</button>`
          }
        </div>
      </div>`
          : ""
      }

      <div class="settings-actions">
        <button class="btn btn-primary" data-action="save-ai-settings">Save Settings</button>
        <button class="btn" data-action="test-ai-connection">Test Connection</button>
      </div>

      <div class="settings-status" id="settings-status"></div>
    </div>

    <div class="card settings-section" style="margin-top: var(--space-lg)">
      <h2>Data Management</h2>
      <p class="text-muted">Export your data for backup or import a previous backup.</p>
      <div class="settings-actions">
        <button class="btn btn-primary" data-action="export-backup">📦 Export Data</button>
        <button class="btn" data-action="export-csv">📊 Export CSV</button>
        <button class="btn" data-action="export-pdf">🖨️ Export PDF</button>
      </div>
      <div class="settings-field" style="margin-top: var(--space-md)">
        <label for="import-file">Import Backup</label>
        <input type="file" id="import-file" accept=".db,.sqlite,.sqlite3"
               class="form-control" data-change="import-backup" />
      </div>
      <div class="settings-status" id="backup-status"></div>
    </div>
${
  isDbEmpty
    ? `
    <div class="card settings-section" style="margin-top: var(--space-lg)">
      <h2>Sample Data</h2>
      <p class="text-muted">Load a realistic demo dataset (accounts, transactions, budgets,
        goals) for testing the app without connecting Gmail. Available only on an empty
        database.</p>
      <div class="settings-actions">
        <button class="btn" data-action="load-sample-data">🧪 Load Sample Data</button>
      </div>
      <div class="settings-status" id="sample-data-status"></div>
    </div>`
    : ""
}

    <div class="card settings-section" style="margin-top: var(--space-lg)">
      <h2>Gmail Sync</h2>
      <p class="text-muted">Restrict email fetching to specific sender addresses or domains.
        Leave blank to use the built-in list of known bank domains.</p>
      <div class="settings-field">
        <label for="gmail-senders">Sender addresses (comma-separated)</label>
        <textarea id="gmail-senders" class="form-control" rows="3"
          placeholder="alerts@hdfcbank.net, noreply@sbi.co.in">${escapeHtml(gmailCustomSenders)}</textarea>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" data-action="save-gmail-senders">Save</button>
      </div>
      <div id="gmail-senders-status" class="settings-status"></div>
      <div class="settings-field">
        <div class="toggle-row">
          <span>Auto-sync Gmail every 2 hours
            <span class="info-notice" tabindex="0" role="note" aria-label="Auto-sync info">
              ℹ️
              <span class="info-notice-tooltip">Automatically imports the last 24 hours of bank emails in the background. Requires Gmail to be connected.</span>
            </span>
          </span>
          <label class="toggle-switch">
            <input type="checkbox" data-change="gmail-toggle-auto-sync"
              ${localStorage.getItem(GMAIL_AUTO_SYNC_ENABLED_KEY) === "true" ? "checked" : ""} />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>

  <div class="card settings-section" style="margin-top: var(--space-lg)">
    <h2>Privacy &amp; Security</h2>
    <p class="text-muted">
      Control how long your financial data and credentials persist in this browser.
    </p>
    <div class="settings-field">
      <div class="toggle-row">
        <span>Hide balances (Privacy mode)
          <span class="info-notice" tabindex="0" role="note">ℹ️
            <span class="info-notice-tooltip">Blurs all monetary amounts. Tap the 👁 in the header or any amount to reveal for 5 minutes.</span>
          </span>
        </span>
        <label class="toggle-switch">
          <input type="checkbox" data-action="toggle-privacy-mode"
            ${localStorage.getItem(PRIVACY_MODE_KEY) !== "false" ? "checked" : ""}/>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
    <div class="settings-field">
      <div class="toggle-row">
        <span>
          This is my personal device
          <span class="info-notice" tabindex="0" role="note" aria-label="Trusted device information">
            ℹ️
            <span class="info-notice-tooltip">
              When enabled, your data is stored indefinitely on this device.
              When disabled (default), all financial data and credentials are wiped
              after 6 hours of inactivity.
            </span>
          </span>
        </span>
        <label class="toggle-switch">
          <input type="checkbox" data-action="toggle-trusted-device" ${trustedDevice ? "checked" : ""}/>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
    <p class="text-muted" style="font-size:0.85em; margin-top: var(--space-sm)">
      ${
        trustedDevice
          ? "✓ Data will persist indefinitely on this device."
          : "⏱ Data will be wiped after 6 hours of inactivity."
      }
    </p>
  </div>

  ${
    vaultConfigured
      ? `
  <div class="card settings-section" style="margin-top: var(--space-lg)">
    <h2>🔒 Credential Vault</h2>
    <p class="text-muted">Your AI API keys and Gmail tokens are AES-256 encrypted and only available while the vault is unlocked.</p>
    <div class="settings-field">
      <span style="color:var(--color-success,#2ecc71)">&#10003; PIN protection active</span>
    </div>
    <div style="display:flex;gap:var(--space-sm,0.5rem);flex-wrap:wrap;margin-top:var(--space-md,1rem)">
      <button class="btn btn-sm" data-action="vault-change-passphrase">Change PIN</button>
      <button class="btn btn-sm" data-action="vault-lock">Lock now</button>
      <button class="btn btn-sm btn-danger" data-action="vault-reset">Reset credentials</button>
    </div>
    <div style="margin-top:var(--space-md,1rem);padding-top:var(--space-md,1rem);border-top:1px solid var(--border)">
      <p class="text-muted" style="font-size:0.85em;margin-bottom:var(--space-sm,0.5rem)">
        If this device is lost or you forget your PIN, rotate AI API keys, revoke Google access, reconnect Gmail, and restore your latest Drive backup after setting a new PIN.
      </p>
      <p class="text-muted" style="font-size:0.85em;margin-bottom:var(--space-sm,0.5rem)">
        🫆 Biometric Unlock
        <span style="cursor:help" title="Biometric is a convenience layer only. Your PIN provides the actual encryption key.">ℹ️</span>
      </p>
      ${
        biometricEnabled
          ? `<span style="color:var(--color-success,#2ecc71)">✓ Biometric unlock active</span>
           <button class="btn btn-sm btn-danger" style="margin-left:var(--space-sm,0.5rem)" data-action="disable-biometric">Disable</button>`
          : biometricAvailable
            ? `<button class="btn btn-sm" data-action="enable-biometric">Enable Biometric Unlock</button>`
            : `<span class="text-muted" style="font-size:0.85em">Not supported on this device</span>`
      }
    </div>
  </div>`
      : `
  <div class="card settings-section" style="margin-top: var(--space-lg);border-left:3px solid var(--color-primary)">
    <h2>🔒 Credential Vault</h2>
    <p class="text-muted">
      Set up a PIN before saving AI API keys or connecting Gmail. Credential-backed features stay disabled until the vault is ready.
    </p>
    <p class="text-muted" style="font-size:0.85em;margin-top:var(--space-xs,0.25rem)">
      Once set up, you can also enable biometric unlock (fingerprint / Face ID) for quick access. If you lose this device, rotate AI keys and revoke Google access from your Google account.
    </p>
    <button class="btn btn-primary btn-sm" style="margin-top:var(--space-sm,0.5rem)" data-action="vault-setup">Set up PIN protection</button>
  </div>`
  }

  <div class="card settings-section" style="margin-top: var(--space-lg)">
    <h2>Onboarding</h2>
    <p class="text-muted">Revisit the setup guide to configure accounts, Gmail sync, or AI.</p>
    <button class="btn btn-outline" data-action="restart-onboarding">↩ Restart onboarding tour</button>
  </div>

  <footer class="settings-legal-footer">
    <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
    &nbsp;·&nbsp;
    <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>
  </footer>
  `;

  // Show feedback from iOS PWA OAuth redirect
  const oauthSuccess = sessionStorage.getItem("gmail-oauth-redirect-success");
  const oauthError = sessionStorage.getItem("gmail-oauth-redirect-error");
  if (oauthSuccess) {
    sessionStorage.removeItem("gmail-oauth-redirect-success");
    Toast.success("Gmail connected successfully.");
  }
  if (oauthError) {
    sessionStorage.removeItem("gmail-oauth-redirect-error");
    Toast.error(`Gmail connection failed: ${oauthError}`);
  }

  // Lazily check for Drive backup — do NOT block the page render for this network call
  if (driveEnabled && gmailConnected) {
    (async () => {
      try {
        const lastModified = await GDrive.getLastModified();
        const exists = lastModified !== null;
        const deleteBtn = document.getElementById("gdrive-delete-btn");
        const noBackupMsg = document.getElementById("gdrive-no-backup-msg");
        if (deleteBtn && exists) {
          deleteBtn.removeAttribute("disabled");
          deleteBtn.removeAttribute("aria-disabled");
        }
        if (noBackupMsg) {
          if (exists) {
            noBackupMsg.style.display = "none";
          } else {
            noBackupMsg.textContent = "No backup on Drive yet";
          }
        }
      } catch {
        const noBackupMsg = document.getElementById("gdrive-no-backup-msg");
        if (noBackupMsg) noBackupMsg.textContent = "";
      }
    })();
  }
}

async function runGdriveSync() {
  const btn = document.getElementById("gdrive-sync-btn");
  if (btn) {
    btn.classList.add("loading");
    btn.disabled = true;
  }
  try {
    const result = await GDrive.sync();
    const stats = result.stats;
    if (stats) {
      const TABLE_LABELS = {
        accounts: "accounts",
        categories: "categories",
        merchants: "merchants",
        transactions: "transactions",
        recurring_patterns: "recurring patterns",
        budgets: "budgets",
        goals: "goals",
        processed_gmail_messages: "synced emails",
      };
      const parts = [];
      const ins = stats.inserted || {};
      for (const [table, count] of Object.entries(ins)) {
        if (count > 0) parts.push(`+${count} ${TABLE_LABELS[table] ?? table}`);
      }
      const msg =
        parts.length > 0
          ? `Drive sync complete. Added: ${parts.join(", ")}`
          : "Drive sync complete. Everything up to date.";
      Toast.success(msg);
    } else {
      Toast.success("Drive sync complete. Everything up to date.");
    }
    if (result.settingsRestored?.apiKeyRestored) {
      Toast.info("AI API key restored from Drive backup.");
    } else if (result.settingsRestored?.apiKeySkipped) {
      Toast.info(
        "AI API key skipped during Drive restore. Unlock the Credential Vault and sync again to restore it.",
      );
    }
    await renderSettings();
  } catch (err) {
    if (err.message?.includes("revoked")) {
      GDrive.setEnabled(false);
      await renderSettings();
    } else if (err.message?.includes("reconnect your Google account")) {
      // Drive scope missing — prompt user to use the Reconnect button; do NOT auto-trigger
      // the popup or auto-retry (would loop if the Worker hasn't been redeployed yet)
      Toast.error(
        'Drive access not authorized. Use the "Reconnect" button in the Drive Sync section to re-authorize.',
      );
    } else {
      Toast.error(`Drive sync failed: ${err.message || "Unknown error"}`);
    }
  } finally {
    if (btn) {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  }
}

async function gdriveDisconnect() {
  GDrive.setEnabled(false);
  Toast.info("Drive sync disabled");
  await renderSettings();
}

async function gdriveEnable() {
  GDrive.setEnabled(true);
  await renderSettings();
}

async function gdriveDeleteBackup() {
  const first = confirm(
    "Are you sure you want to delete the Google Drive backup?\n\nThis will permanently remove the encrypted backup file from your Google Drive.",
  );
  if (!first) return;
  const second = confirm(
    "⚠️ Final confirmation: The Drive backup cannot be recovered after deletion. Delete it now?",
  );
  if (!second) return;
  try {
    await GDrive.deleteBackup();
    Toast.success("Google Drive backup deleted.");
    await renderSettings();
  } catch (err) {
    Toast.error(`Delete failed: ${err.message || "Unknown error"}`);
  }
}

async function exportBackup() {
  const data = await DB.exportDatabase();
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fincoach-backup-${new Date().toISOString().split("T")[0]}.db`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadSampleData() {
  if (
    !confirm(
      "Load the sample demo dataset? This adds accounts, transactions, budgets and goals for testing.",
    )
  ) {
    return;
  }
  const status = document.getElementById("sample-data-status");
  try {
    const summary = await API.loadSampleData();
    Toast.success(
      `Loaded ${summary.transactions} transactions across ${summary.accounts} accounts.`,
    );
    location.reload();
  } catch (e) {
    if (status) {
      status.textContent = `Could not load sample data: ${e.message}`;
      status.className = "settings-status error";
    } else {
      Toast.error(`Could not load sample data: ${e.message}`);
    }
  }
}

async function importBackup(file) {
  if (!file) return;
  if (!confirm("This will replace ALL current data. Continue?")) return;
  try {
    const buffer = await file.arrayBuffer();
    await DB.importDatabase(new Uint8Array(buffer));
    location.reload();
  } catch (e) {
    const status = document.getElementById("backup-status");
    if (status) {
      status.textContent = `Import failed: ${e.message}`;
      status.className = "settings-status error";
    }
  }
}

async function exportCSV() {
  const csv = await DB.exportTransactionsCSV();
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function saveGmailSenders() {
  const ta = document.getElementById("gmail-senders");
  if (!ta) return;
  const senders = ta.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const { saved, rejected } = API.saveGmailCustomSenders(senders);
  const status = document.getElementById("gmail-senders-status");
  if (status) {
    if (rejected.length > 0) {
      status.textContent = `Saved ${saved.length} sender(s). Rejected invalid: ${rejected.join(", ")}`;
      status.className = "settings-status error";
    } else {
      status.textContent = "Saved.";
      status.className = "settings-status success";
    }
    setTimeout(() => {
      status.textContent = "";
    }, 4000);
  }
}

async function exportAllPDF() {
  const saved = { ...txFilterState };
  txFilterState.date_from = "";
  txFilterState.date_to = "";
  txFilterState.transaction_type = "";
  txFilterState.account_id = "";
  txFilterState.category_id = "";
  txFilterState.show_merged_accounts = true;
  try {
    await exportPDF();
  } finally {
    Object.assign(txFilterState, saved);
  }
}

function onProviderChange() {
  const sel = document.getElementById("ai-provider");
  const provider = sel ? sel.value : "";
  const modelInput = document.getElementById("ai-model");
  const datalist = document.getElementById("ai-model-options");
  const keyField = document.getElementById("api-key-field");
  const backupKeyField = document.getElementById("gdrive-backup-api-key-field");
  const azureFields = document.getElementById("azure-fields");
  const ollamaField = document.getElementById("ollama-base-url-field");

  if (provider && AI_PROVIDERS[provider]) {
    const p = AI_PROVIDERS[provider];
    if (provider === "azure") {
      if (azureFields) azureFields.style.display = "block";
      modelInput.value = "Set by deployment name";
      modelInput.disabled = true;
      if (datalist) datalist.innerHTML = "";
    } else {
      if (azureFields) azureFields.style.display = "none";
      modelInput.disabled = false;
      if (datalist) datalist.innerHTML = p.models.map((m) => `<option value="${m}">`).join("");
      if (!modelInput.value) modelInput.value = p.defaultModel || "";
    }
    keyField.style.display = p.requiresKey ? "block" : "none";
    if (backupKeyField) backupKeyField.style.display = p.requiresKey ? "block" : "none";
    if (ollamaField) ollamaField.style.display = provider === "ollama" ? "block" : "none";
  } else {
    if (azureFields) azureFields.style.display = "none";
    modelInput.disabled = false;
    modelInput.value = "";
    if (datalist) datalist.innerHTML = "";
    keyField.style.display = "block";
    if (backupKeyField) backupKeyField.style.display = "block";
    if (ollamaField) ollamaField.style.display = "none";
  }
}

async function saveAISettings() {
  const provider = document.getElementById("ai-provider")?.value || "";
  const apiKey = document.getElementById("ai-api-key")?.value || "";
  const model = document.getElementById("ai-model")?.value || "";
  const azureResourceName = document.getElementById("azure-resource-name")?.value || "";
  const azureDeploymentName = document.getElementById("azure-deployment-name")?.value || "";
  const azureApiVersion =
    document.getElementById("azure-api-version")?.value || "2024-12-01-preview";
  const ollamaBaseUrl = document.getElementById("ollama-base-url")?.value?.trim() || "";

  if (!provider) {
    Toast.show("Please select a provider", "error");
    return;
  }

  if (provider === "ollama" && ollamaBaseUrl) {
    try {
      const parsedUrl = new URL(ollamaBaseUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        Toast.show("Invalid Ollama URL — must use http or https", "error");
        return;
      }
    } catch {
      Toast.show("Invalid Ollama base URL", "error");
      return;
    }
  }

  const result = await AI.saveSettings({
    provider,
    apiKey,
    model,
    azureResourceName,
    azureDeploymentName,
    azureApiVersion,
    ollamaBaseUrl,
  });

  const status = document.getElementById("settings-status");
  if (!result.ok && result.vaultRequired) {
    if (status) {
      status.textContent = `⚠ ${result.error} Provider settings were saved.`;
      status.className = "settings-status error";
    }
    Toast.show(result.error, "error");
    if (!API.isVaultConfigured()) {
      showVaultSetupModal();
    } else if (!API.isVaultUnlocked()) {
      renderVaultUnlock();
    }
    return;
  }

  Toast.show("Settings saved", "success");
  if (status) {
    status.textContent = "✓ Settings saved";
    status.className = "settings-status success";
  }
}

async function testAIConnection() {
  const status = document.getElementById("settings-status");
  if (status) {
    status.textContent = "Testing connection…";
    status.className = "settings-status";
  }

  // Save current form values first
  const provider = document.getElementById("ai-provider")?.value || "";
  const apiKey = document.getElementById("ai-api-key")?.value || "";
  const model = document.getElementById("ai-model")?.value || "";
  const azureResourceName = document.getElementById("azure-resource-name")?.value || "";
  const azureDeploymentName = document.getElementById("azure-deployment-name")?.value || "";
  const azureApiVersion =
    document.getElementById("azure-api-version")?.value || "2024-12-01-preview";
  const ollamaBaseUrl = document.getElementById("ollama-base-url")?.value?.trim() || "";
  if (provider) {
    const saveResult = await AI.saveSettings({
      provider,
      apiKey,
      model,
      azureResourceName,
      azureDeploymentName,
      azureApiVersion,
      ollamaBaseUrl,
    });

    if (!saveResult.ok && saveResult.vaultRequired) {
      if (status) {
        status.textContent = `✗ ${saveResult.error}`;
        status.className = "settings-status error";
      }
      if (!API.isVaultConfigured()) {
        showVaultSetupModal();
      } else if (!API.isVaultUnlocked()) {
        renderVaultUnlock();
      }
      return;
    }
  }

  const result = await AI.testConnection();
  if (status) {
    if (result.ok) {
      status.textContent = "✓ Connection successful!";
      status.className = "settings-status success";
    } else {
      status.textContent = `✗ ${result.error}`;
      status.className = "settings-status error";
    }
  }
}

function toggleKeyVisibility() {
  const input = document.getElementById("ai-api-key");
  if (!input) return;
  const btn = input.parentElement.querySelector("button");
  if (input.type === "password") {
    input.type = "text";
    if (btn) btn.textContent = "Hide";
  } else {
    input.type = "password";
    if (btn) btn.textContent = "Show";
  }
}

// ============================================================================
// Onboarding Wizard
// ============================================================================

function checkOnboarding() {
  if (localStorage.getItem(ONBOARDED_KEY) === "true") return;
  const step = localStorage.getItem(ONBOARDING_STEP_KEY) || "1";
  renderOnboardingStep(Number.parseInt(step, 10) || 1);
}

function completeOnboarding() {
  localStorage.setItem(ONBOARDED_KEY, "true");
  localStorage.removeItem(ONBOARDING_STEP_KEY);
  document.getElementById("onboarding-wizard")?.remove();
}

function onboardingAdvance(nextStep) {
  localStorage.setItem(ONBOARDING_STEP_KEY, String(nextStep));
  renderOnboardingStep(nextStep);
}

async function renderOnboardingStep(step) {
  document.getElementById("onboarding-wizard")?.remove();

  const dots = [1, 2, 3, 4, 5]
    .map((n) => `<span class="onboarding-dot${n === step ? " active" : ""}"></span>`)
    .join("");

  let stepContent = "";
  if (step === 1) {
    stepContent = `
			<h2 class="onboarding-headline">Welcome to Financial Coach</h2>
			<p class="onboarding-body">
				Financial Coach is a local-first, private finance tracker — your data never leaves your
				device. Get AI-powered coaching, track spending, set goals, and stay on top of your
				finances. Everything is stored in your browser's local storage and IndexedDB.
				No account required, no data sent to any server.
			</p>
			<div class="onboarding-actions">
				<button class="btn btn-primary" data-action="onboarding-next" data-step="1">
					Let's get started →
				</button>
			</div>
		`;
  } else if (step === 2) {
    stepContent = `
			<h2 class="onboarding-headline">How transactions are tracked</h2>
			<p class="onboarding-body">
				Your bank sends you email alerts for every debit and credit. Financial Coach reads those
				emails and automatically extracts your transactions — no manual entry needed. Your emails
				are never stored; only the transaction data is saved locally on your device.
			</p>
			<p class="onboarding-body">
				You can also add transactions manually or import a CSV at any time from the Transactions screen.
				To export your data, go to Settings → Data Management.
			</p>
			<div class="onboarding-actions">
				<button class="btn btn-primary" data-action="onboarding-next" data-step="2">
					Got it →
				</button>
			</div>
		`;
  } else if (step === 3) {
    stepContent = `
			<h2 class="onboarding-headline">Auto-import your transactions</h2>
			<p class="onboarding-body">
				We read bank email alerts to detect transactions. We never store your emails —
				everything stays on your device.
			</p>
			<div class="onboarding-actions">
				<button class="btn btn-primary" data-action="onboarding-connect-gmail">
					Connect Gmail
				</button>
				<button class="onboarding-step-skip" data-action="onboarding-step-skip" data-next="4">
					Skip for now
				</button>
			</div>
		`;
  } else if (step === 4) {
    stepContent = `
			<h2 class="onboarding-headline">Get a personal financial coach</h2>
			<p class="onboarding-body">
				Use Groq's free tier or run Ollama offline to get AI-powered insights, spending analysis,
				and personalised financial coaching. Ollama stays on-device; external providers are used
				only after you explicitly consent to share masked financial context from this browser.
			</p>
			<div class="onboarding-actions">
				<button class="btn btn-primary" data-action="onboarding-setup-ai">
					Set Up AI →
				</button>
				<button class="onboarding-step-skip" data-action="onboarding-step-skip" data-next="5">
					Skip for now
				</button>
			</div>
		`;
  } else {
    const [accounts, gmailStatus, aiSettings] = await Promise.all([
      API.getAccounts(),
      API.getGmailStatus().catch(() => null),
      Promise.resolve(AI.getSettings()),
    ]);

    const acctItem =
      accounts.length > 0
        ? `<li class="configured">✓ Account added — ${escapeHtml(accounts[0].name)}</li>`
        : "<li>\u2013 No account added yet</li>";

    const gmailItem = gmailStatus?.connected
      ? `<li class="configured">✓ Gmail connected${gmailStatus.email ? `: ${escapeHtml(gmailStatus.email)}` : ""}</li>`
      : `<li>– Gmail not connected —
					<button class="onboarding-inline-link" data-action="onboarding-goto" data-href="#/sync">
						Connect now
					</button></li>`;

    const aiItem = aiSettings?.provider
      ? `<li class="configured">✓ AI provider: ${escapeHtml(aiSettings.provider)}</li>`
      : `<li>– AI not configured —
					<button class="onboarding-inline-link" data-action="onboarding-goto" data-href="#/settings">
						Set up now
					</button></li>`;

    stepContent = `
			<h2 class="onboarding-headline">You're all set!</h2>
			<p class="onboarding-body">Here's a summary of your setup:</p>
			<ul class="onboarding-summary-list">
				${acctItem}
				${gmailItem}
				${aiItem}
			</ul>
			<div class="onboarding-actions">
				<button class="btn btn-primary" data-action="onboarding-next" data-step="5">
					Go to Dashboard →
				</button>
			</div>
		`;
  }

  const skipBtn =
    step < 5
      ? `<button class="onboarding-skip-link" data-action="onboarding-skip">Skip setup</button>`
      : "";

  const overlay = document.createElement("div");
  overlay.id = "onboarding-wizard";
  overlay.className = "onboarding-wizard";
  overlay.innerHTML = `
		<div class="onboarding-card">
			<div class="onboarding-header">
				<div class="onboarding-step-indicator">${dots}</div>
				${skipBtn}
			</div>
			${stepContent}
		</div>
	`;
  document.body.appendChild(overlay);
}

async function onboardingCreateAccount(btnEl) {
  const container = btnEl.closest(".onboarding-card");
  const name = container.querySelector("#acct-name")?.value?.trim() || "";
  const type = container.querySelector("#acct-type")?.value || "bank";
  const balance = container.querySelector("#acct-balance")?.value || "0";
  const identifier = container.querySelector("#acct-identifier")?.value?.trim() || "";
  const errorEl = container.querySelector("#onboarding-acct-error");

  if (!name) {
    if (errorEl) {
      errorEl.textContent = "Account name is required.";
      errorEl.style.display = "";
    }
    return;
  }

  btnEl.disabled = true;
  if (errorEl) errorEl.style.display = "none";

  try {
    await API.createAccount({
      name,
      account_type: type,
      balance: Number.parseFloat(balance) || 0,
      account_identifier: identifier,
    });
    onboardingAdvance(3);
  } catch (err) {
    btnEl.disabled = false;
    if (errorEl) {
      errorEl.textContent = err.message || "Failed to create account.";
      errorEl.style.display = "";
    }
  }
}

async function onboardingConnectGmail() {
  try {
    const result = await API.getGmailConnectUrl();
    if (result?.connected) {
      onboardingAdvance(4);
    } else if (result?.auth_url) {
      const parsed = new URL(result.auth_url);
      if (parsed.origin !== "https://accounts.google.com") {
        throw new Error("Unexpected OAuth redirect origin");
      }
      window.location.href = result.auth_url;
      onboardingAdvance(4);
    }
  } catch (err) {
    Toast.error(err.message || "Failed to connect Gmail");
  }
}

// ============================================================================
// Register routes & boot
// ============================================================================

function checkGDriveReminder() {
  if (GDrive.isEnabled()) return;
  const last = Number(localStorage.getItem(GDRIVE_REMINDER_KEY) || "0");
  if (last > 0 && Date.now() - last < GDRIVE_REMINDER_INTERVAL_MS) return;
  localStorage.setItem(GDRIVE_REMINDER_KEY, String(Date.now()));
  Toast.infoAction(
    "Back up your data — Google Drive sync is not enabled.",
    "Enable in Settings",
    () => Router.navigate("#/settings"),
  );
}

async function checkDailySummary() {
  try {
    const now = new Date();
    if (now.getHours() < 18) return;
    const today = now.toISOString().split("T")[0];
    if (localStorage.getItem(DAILY_SUMMARY_KEY) === today) return;
    const totals = await API.getTransactionTotals({ date_from: today, date_to: today });
    if (!totals || totals.transaction_count === 0) return;
    localStorage.setItem(DAILY_SUMMARY_KEY, today);
    const net = totals.net ?? totals.total_income - totals.total_expense;
    Toast.info(
      `Today: ${formatCurrency(totals.total_income)} income, ` +
        `${formatCurrency(totals.total_expense)} expenses, ` +
        `net ${formatCurrency(Math.abs(net))} ${net >= 0 ? "surplus" : "deficit"}`,
    );
  } catch {
    // Daily summary must never crash the app
  }
}

async function checkBillNotifications() {
  const NOTIF_KEY = "fincoach-notif-checked";
  if (sessionStorage.getItem(NOTIF_KEY)) return;
  sessionStorage.setItem(NOTIF_KEY, "1");
  if (!("Notification" in window)) return;
  try {
    const bills = await API.getUpcomingBills(7);
    const dueSoon = bills.filter((b) => b.days_remaining <= (b.reminder_days_before ?? 3));
    if (dueSoon.length === 0) return;
    let permission = Notification.permission;
    if (permission === "denied") return;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return;
    const reg = await navigator.serviceWorker?.ready.catch(() => null);
    for (const bill of dueSoon) {
      const title = `Bill due soon — ${bill.description_pattern}`;
      const body = `₹${bill.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} due on ${bill.next_due_date}`;
      if (reg?.showNotification) {
        reg.showNotification(title, { body, icon: "/icons/icon-192.png" });
      } else {
        // eslint-disable-next-line no-new
        new Notification(title, { body });
      }
    }
  } catch {
    // Silent fallback — never crash on notification errors
  }
}

document.addEventListener("vault-locked", () => {
  renderVaultUnlock();
});

// ============================================================================
// Vault UI functions
// ============================================================================

function renderVaultUnlock() {
  const existing = document.getElementById("vault-unlock-screen");
  if (existing) return;
  const biometricEnabled = API.isBiometricEnabled();
  const unlockPinAttrs = pinInputAttrs(API.prefersNumericPinInput(), "done");
  const overlay = document.createElement("div");
  overlay.id = "vault-unlock-screen";
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:var(--bg-primary,#111);z-index:9999;display:flex;align-items:center;justify-content:center";
  overlay.innerHTML = `
    <div class="card" style="max-width:420px;width:100%;padding:var(--space-xl,2rem)">
      <h2 style="margin-bottom:var(--space-md,1rem)">🔒 Unlock Your Data</h2>
      <p class="text-muted">Your credentials are protected. Enter your PIN to continue.</p>
      ${
        biometricEnabled
          ? `
        <button class="btn btn-primary" style="width:100%;margin-bottom:var(--space-md,1rem)"
                data-action="unlock-biometric">🫆 Unlock with Biometrics</button>
        <hr style="margin:var(--space-md,1rem) 0">
      `
          : ""
      }
      <div id="vault-unlock-error" class="alert alert-danger" style="display:none;margin-bottom:var(--space-md,1rem)"></div>
      <div class="form-group" style="margin-bottom:var(--space-md,1rem)">
        <label class="form-label">PIN</label>
        <input type="password" id="vault-unlock-passphrase" class="form-control"
               placeholder="Enter PIN" autocomplete="current-password" ${unlockPinAttrs}>
      </div>
      <div style="display:flex;gap:var(--space-sm,0.5rem);flex-wrap:wrap">
        <button class="btn btn-primary" data-action="unlock-vault">Unlock</button>
        <button class="btn btn-link" data-action="vault-forgot-passphrase" style="margin-left:auto">Forgot PIN?</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const pinInput = overlay.querySelector("#vault-unlock-passphrase");
  pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doUnlockVault();
  });
  pinInput.focus();
  if (biometricEnabled) doUnlockWithBiometric();
}

async function doUnlockVault() {
  const input = document.getElementById("vault-unlock-passphrase");
  const errEl = document.getElementById("vault-unlock-error");
  if (!input) return;
  const passphrase = input.value.trim();
  if (!passphrase) {
    errEl.textContent = "Please enter your PIN.";
    errEl.style.display = "";
    return;
  }
  if (API.prefersNumericPinInput() && !isExistingNumericPin.test(passphrase)) {
    errEl.textContent = "PIN must contain only digits and be at least 4 digits.";
    errEl.style.display = "";
    return;
  }
  try {
    const ok = await API.unlockVault(passphrase);
    if (ok) {
      const needsPinUpgrade = Vault.requiresPinUpgrade();
      const overlay = document.getElementById("vault-unlock-screen");
      if (overlay) overlay.remove();
      clearGmailVaultGateToasts();
      document.dispatchEvent(new Event("db-ready"));
      await continuePendingGmailConnect();
      if (needsPinUpgrade) {
        // Deferred so the initial render's Toast.clearAll() doesn't wipe the nudge.
        setTimeout(() => {
          Toast.info("Your PIN is under 6 digits. Consider upgrading for better security.");
        }, 100);
      }
    } else {
      errEl.textContent = "Incorrect PIN. Please try again.";
      errEl.style.display = "";
      input.value = "";
      input.focus();
    }
  } catch (err) {
    errEl.textContent = `Unlock failed: ${err.message}`;
    errEl.style.display = "";
  }
}

async function doUnlockWithBiometric() {
  const errEl = document.getElementById("vault-unlock-error");
  try {
    const ok = await API.unlockWithBiometric();
    if (ok) {
      const overlay = document.getElementById("vault-unlock-screen");
      if (overlay) overlay.remove();
      clearGmailVaultGateToasts();
      document.dispatchEvent(new Event("db-ready"));
      await continuePendingGmailConnect();
    } else {
      if (errEl) {
        errEl.textContent = "Biometric unlock failed. Please enter your PIN.";
        errEl.style.display = "";
      }
    }
  } catch (err) {
    if (errEl) {
      errEl.textContent = `Biometric error: ${err.message}`;
      errEl.style.display = "";
    }
  }
}

async function doDisableBiometric() {
  API.disableBiometric();
  showToast("Biometric unlock disabled.", "info");
  if (window.location.hash.startsWith("#/settings")) await renderSettings();
}

function doSetupBiometric() {
  const currentPinAttrs = pinInputAttrs(API.prefersNumericPinInput(), "done");
  const html = `
    <div id="biometric-setup-modal" class="modal-overlay" style="z-index:10000">
      <div class="modal">
        <h3>Enable Biometric Unlock</h3>
        <p>Your device will ask for fingerprint or face verification to confirm setup.</p>
        <p class="text-muted" style="font-size:0.85em">Biometric is a convenience layer only — your PIN remains the primary security key.</p>
        <div id="biometric-setup-error" class="alert alert-danger" style="display:none;margin-bottom:1rem"></div>
        <div class="form-group">
          <label class="form-label">Confirm your current PIN</label>
          <input type="password" id="biometric-setup-passphrase" class="form-control" autocomplete="current-password" placeholder="Enter PIN" ${currentPinAttrs}>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" data-action="do-confirm-biometric-setup">Enable</button>
          <button class="btn btn-secondary" data-action="close-biometric-setup-modal">Cancel</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function doConfirmBiometricSetup() {
  const passphrase = document.getElementById("biometric-setup-passphrase")?.value || "";
  const errEl = document.getElementById("biometric-setup-error");
  if (!passphrase) {
    errEl.textContent = "Please enter your PIN.";
    errEl.style.display = "";
    return;
  }
  if (API.prefersNumericPinInput() && !isExistingNumericPin.test(passphrase)) {
    errEl.textContent = "PIN must contain only digits and be at least 4 digits.";
    errEl.style.display = "";
    return;
  }
  try {
    await API.setupBiometric(passphrase);
    document.getElementById("biometric-setup-modal")?.remove();
    showToast("Biometric unlock enabled.", "success");
    if (window.location.hash.startsWith("#/settings")) await renderSettings();
  } catch (err) {
    errEl.textContent =
      err.message === "Biometric PRF unavailable"
        ? "Biometric unlock is not supported in this browser/app yet. Please use your PIN."
        : err.message || "Failed to enable biometric unlock.";
    errEl.style.display = "";
  }
}

function showVaultForgotModal() {
  const html = `
    <div id="vault-forgot-modal" class="modal-overlay" style="z-index:10000">
      <div class="modal">
        <h3>Reset Credentials</h3>
        <p>Your <strong>financial data is safe</strong> — only your AI API keys and Gmail connection will be cleared.</p>
        <p>You will need to re-enter your API keys and reconnect Gmail after resetting.</p>
        <div class="modal-actions">
          <button class="btn btn-danger" data-action="do-reset-vault">Clear credentials &amp; continue</button>
          <button class="btn btn-secondary" data-action="close-vault-forgot-modal">Cancel</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

function showVaultSetupModal() {
  const newPinAttrs = pinInputAttrs(true, "next");
  const confirmPinAttrs = pinInputAttrs(true, "done");
  const html = `
    <div id="vault-setup-modal" class="modal-overlay" style="z-index:10000">
      <div class="modal">
        <h3>🔒 Protect Your Credentials</h3>
        <p>Encrypt your API keys and Gmail tokens with a PIN so they are never stored in plaintext.</p>
        <p class="text-muted">If you forget your PIN, you can always reset and re-enter your credentials. Your financial data is never affected.</p>
        <div id="vault-setup-error" class="alert alert-danger" style="display:none;margin-bottom:1rem"></div>
        <div class="form-group">
          <label class="form-label">PIN <span class="text-muted">(digits only, min 6)</span></label>
          <input type="password" id="vault-setup-passphrase" class="form-control" placeholder="Choose a PIN" autocomplete="new-password" ${newPinAttrs}>
          <div id="vault-setup-strength" class="pin-strength-bar" aria-live="polite"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm PIN</label>
          <input type="password" id="vault-setup-confirm" class="form-control" placeholder="Repeat PIN" autocomplete="new-password" ${confirmPinAttrs}>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" data-action="do-setup-vault">Set PIN</button>
          <button class="btn btn-secondary" data-action="close-vault-setup-modal">Skip for now</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("vault-setup-passphrase")?.addEventListener("input", (e) => {
    _updatePinStrength(e.target.value, "vault-setup-strength");
  });
}

async function doSetupVault() {
  const passphrase = document.getElementById("vault-setup-passphrase")?.value || "";
  const confirm = document.getElementById("vault-setup-confirm")?.value || "";
  const errEl = document.getElementById("vault-setup-error");
  if (!isNumericPin(passphrase)) {
    errEl.textContent = "PIN must contain only digits and be at least 6 digits.";
    errEl.style.display = "";
    return;
  }
  if (passphrase !== confirm) {
    errEl.textContent = "PINs do not match.";
    errEl.style.display = "";
    return;
  }
  try {
    await API.setupVault(passphrase);
  } catch (err) {
    errEl.textContent = `Failed to set up PIN: ${err.message}`;
    errEl.style.display = "";
    return;
  }
  document.getElementById("vault-setup-modal")?.remove();
  clearGmailVaultGateToasts();
  Toast.success("Credentials are now PIN-protected.");
  if (window.location.hash.startsWith("#/settings")) await renderSettings();
  await continuePendingGmailConnect();
}

function showChangePassphraseModal() {
  const currentPinAttrs = pinInputAttrs(API.prefersNumericPinInput(), "next");
  const newPinAttrs = pinInputAttrs(true, "next");
  const confirmPinAttrs = pinInputAttrs(true, "done");
  const html = `
    <div id="vault-change-modal" class="modal-overlay" style="z-index:10000">
      <div class="modal">
        <h3>Change PIN</h3>
        <div id="vault-change-error" class="alert alert-danger" style="display:none;margin-bottom:1rem"></div>
        <div class="form-group">
          <label class="form-label">Current PIN</label>
          <input type="password" id="vault-change-old" class="form-control" autocomplete="current-password" ${currentPinAttrs}>
        </div>
        <div class="form-group">
          <label class="form-label">New PIN <span class="text-muted">(digits only, min 6)</span></label>
          <input type="password" id="vault-change-new" class="form-control" autocomplete="new-password" ${newPinAttrs}>
          <div id="vault-change-strength" class="pin-strength-bar" aria-live="polite"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm new PIN</label>
          <input type="password" id="vault-change-confirm" class="form-control" autocomplete="new-password" ${confirmPinAttrs}>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" data-action="do-change-passphrase">Update PIN</button>
          <button class="btn btn-secondary" data-action="close-vault-change-modal">Cancel</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("vault-change-new")?.addEventListener("input", (e) => {
    _updatePinStrength(e.target.value, "vault-change-strength");
  });
}

async function doChangePassphrase() {
  const oldP = document.getElementById("vault-change-old")?.value || "";
  const newP = document.getElementById("vault-change-new")?.value || "";
  const confirmP = document.getElementById("vault-change-confirm")?.value || "";
  const errEl = document.getElementById("vault-change-error");
  if (!isNumericPin(newP)) {
    errEl.textContent = "New PIN must contain only digits and be at least 6 digits.";
    errEl.style.display = "";
    return;
  }
  if (newP !== confirmP) {
    errEl.textContent = "New PINs do not match.";
    errEl.style.display = "";
    return;
  }
  try {
    await API.changeVaultPassphrase(oldP, newP);
  } catch (err) {
    errEl.textContent = err.message || "Failed to change PIN.";
    errEl.style.display = "";
    return;
  }
  document.getElementById("vault-change-modal")?.remove();
  Toast.success("PIN updated.");
  if (window.location.hash.startsWith("#/settings")) await renderSettings();
}

async function doResetVault() {
  API.resetVault();
  document.getElementById("vault-forgot-modal")?.remove();
  const overlay = document.getElementById("vault-unlock-screen");
  if (overlay) {
    overlay.remove();
    document.dispatchEvent(new Event("db-ready"));
  }
  showToast("Credentials cleared. Please re-enter your API keys and reconnect Gmail.", "warning");
  if (window.location.hash.startsWith("#/settings")) await renderSettings();
}

function doLockVault() {
  API.lockVault();
  window.location.reload();
}

document.addEventListener("db-ready", () => {
  Toast.init();
  document.addEventListener("gmail-auto-sync-complete", (e) => {
    Toast.info(`Gmail auto-sync: ${e.detail.imported} new transaction(s) imported.`);
  });
  document.addEventListener("session-expiry-warning", () => {
    Toast.info(
      "Your session will expire in ~30 minutes due to inactivity. Interact with the app to extend it.",
    );
  });
  if (sessionStorage.getItem("fincoach-session-expired") === "1") {
    sessionStorage.removeItem("fincoach-session-expired");
    setTimeout(
      () =>
        Toast.info("Your session expired after 6 hours of inactivity. All data has been cleared."),
      100,
    );
  }
  renderLayout();
  Theme.init();

  Router.register("#/", renderDashboard);
  Router.register("#/transactions", renderTransactions);
  Router.register("#/transactions/new", renderAddTransaction);
  Router.register("#/sync", renderSync);
  Router.register("#/accounts", renderAccounts);
  Router.register("#/goals", renderGoals);
  Router.register("#/budgets", renderBudgets);
  Router.register("#/reports", renderReports);
  Router.register("#/chat", renderChat);
  Router.register("#/taxonomy", renderTaxonomy);
  Router.register("#/settings", renderSettings);

  Router.init();
  applyPrivacyState();
  checkOnboarding();
  document.addEventListener("gmail-sync-start", _warnNoAISyncOnce);
  document.addEventListener("gmail-sync-start", () => StatusBar.set("Syncing transactions…", true));
  document.addEventListener("gmail-sync-end", ({ detail }) => {
    if (detail?.error) {
      StatusBar.set("Sync failed", false);
    } else {
      StatusBar.set(detail?.imported > 0 ? `Synced ${detail.imported} new` : "Up to date", false);
    }
    setTimeout(() => StatusBar.clear(), 3000);
  });
  GDrive.maybeAutoSync(); // fire-and-forget — never throws
  Gmail.maybeAutoSync(); // Feature 2 — fire-and-forget
  checkGDriveReminder(); // Feature 1 — synchronous, no await
  checkDailySummary(); // Feature 3 — fire-and-forget
  checkBillNotifications(); // fire-and-forget
});

// Router exposed for test access; formatCurrency for potential external use.
// Onboarding functions exposed for test access.
// All inline-handler functions use event delegation and need no window exposure.
Object.assign(window, {
  Router,
  formatCurrency,
  categoryIcon,
  exportPDF,
  checkOnboarding,
  completeOnboarding,
  onboardingAdvance,
  renderOnboardingStep,
  detectPaymentType,
  doUnlockWithBiometric,
  doSetupBiometric,
});
