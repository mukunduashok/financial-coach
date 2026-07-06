import { DB } from "./db.js";
import "./ai.js";
import "./api.js";
import "./app.js";
import {
  GMAIL_SETTINGS_KEY,
  SESSION_EXPIRY_MS,
  SESSION_EXPIRY_WARN_KEY,
  SESSION_LAST_ACTIVITY_KEY,
  TRUSTED_DEVICE_KEY,
} from "./config.js";
import { Vault } from "./vault.js";

function _handleOAuthCallback() {
  const search = new URLSearchParams(window.location.search);
  if (!search.has("gmail-oauth")) return;

  const fragment = window.location.hash.slice(1);
  // Clean the URL regardless of outcome
  history.replaceState(null, "", `${window.location.pathname}#/settings`);

  if (!fragment) return;

  try {
    const payload = JSON.parse(decodeURIComponent(atob(fragment)));
    if (payload.type !== "gmail-oauth") return;

    if (payload.status === "success") {
      if (!payload.access_token || !payload.refresh_token) return;
      const tokenExpiry = Date.now() + (payload.expires_in || 3600) * 1000;
      const settings = {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        tokenExpiry,
      };
      localStorage.setItem(GMAIL_SETTINGS_KEY, JSON.stringify(settings));
      sessionStorage.setItem("gmail-oauth-redirect-success", "1");
    } else {
      sessionStorage.setItem("gmail-oauth-redirect-error", payload.error || "OAuth failed");
    }
  } catch {
    // Malformed payload — ignore silently
  }
}

async function boot() {
  _handleOAuthCallback();
  try {
    // Session expiry guard — runs before DB loads
    const trusted = localStorage.getItem(TRUSTED_DEVICE_KEY) === "true";
    if (!trusted) {
      const last = Number.parseInt(localStorage.getItem(SESSION_LAST_ACTIVITY_KEY) || "0", 10);
      if (last > 0 && Date.now() - last > SESSION_EXPIRY_MS) {
        await DB.wipeSession();
        sessionStorage.setItem("fincoach-session-expired", "1");
      }
    }

    await DB.init();

    if (Vault.isConfigured()) {
      document.dispatchEvent(new Event("vault-locked"));
    } else {
      document.dispatchEvent(new Event("db-ready"));
    }
  } catch (err) {
    const app = document.getElementById("app");
    if (app) {
      const p = document.createElement("p");
      p.style.color = "red";
      p.textContent = `Failed to load database: ${err.message}`;
      app.appendChild(p);
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

// Track user activity to support session expiry
const _TRACKED_EVENTS = ["click", "keydown", "touchstart", "scroll"];
function _updateLastActivity() {
  if (localStorage.getItem(TRUSTED_DEVICE_KEY) !== "true") {
    localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
  }
}
for (const evt of _TRACKED_EVENTS) {
  document.addEventListener(evt, _updateLastActivity, { passive: true });
}

// In-session idle wipe — check every minute while the app is open
const _SESSION_CHECK_INTERVAL = 60_000; // 1 minute
setInterval(() => {
  if (localStorage.getItem(TRUSTED_DEVICE_KEY) === "true") return;
  const last = Number.parseInt(localStorage.getItem(SESSION_LAST_ACTIVITY_KEY) || "0", 10);
  if (last > 0 && Date.now() - last > SESSION_EXPIRY_MS) {
    DB.wipeSession().then(() => {
      sessionStorage.setItem("fincoach-session-expired", "1");
      window.location.reload();
    });
  }

  // Feature 4: Session expiry warning — 30 min before expiry
  if (localStorage.getItem(TRUSTED_DEVICE_KEY) !== "true") {
    const _last = Number.parseInt(localStorage.getItem(SESSION_LAST_ACTIVITY_KEY) || "0", 10);
    const _idle = Date.now() - _last;
    const _warnAt = SESSION_EXPIRY_MS - 30 * 60 * 1000;
    const _warned = sessionStorage.getItem(SESSION_EXPIRY_WARN_KEY) === "1";
    if (_last > 0 && !_warned && _idle > _warnAt && _idle <= SESSION_EXPIRY_MS) {
      sessionStorage.setItem(SESSION_EXPIRY_WARN_KEY, "1");
      document.dispatchEvent(new CustomEvent("session-expiry-warning"));
    }
  }
}, _SESSION_CHECK_INTERVAL);
