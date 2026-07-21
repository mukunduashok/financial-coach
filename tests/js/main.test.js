/**
 * Unit tests for static/js/main.js — boot sequence and error handling.
 *
 * Verifies that the XSS fix (using textContent instead of innerHTML) is in
 * place when the DB init fails during application boot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Boot Error Handling", () => {
  let appEl;

  beforeEach(() => {
    // Reset module registry so main.js re-executes on each dynamic import
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    appEl = document.createElement("div");
    appEl.id = "app";
    document.body.appendChild(appEl);
    delete window.__xss;
  });

  afterEach(() => {
    appEl.remove();
    localStorage.clear();
    sessionStorage.clear();
    delete window.__xss;
  });

  it("renders boot error via textContent, not innerHTML, preventing XSS", async () => {
    const xssPayload = '<img src=x onerror="window.__xss=true">';

    // Register non-hoisted mocks AFTER resetModules so they apply to the fresh import
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockRejectedValue(new Error(xssPayload)) },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({}));

    // Dynamic import triggers main.js module execution (boot() is called immediately
    // because jsdom readyState is "complete", not "loading")
    await import("../../static/js/main.js");

    // Allow the async boot() to finish
    await new Promise((r) => setTimeout(r, 50));

    const p = appEl.querySelector("p");
    expect(p).not.toBeNull();

    // Error text must appear as plain text — the raw XSS string, not executed
    expect(p.textContent).toContain("<img");

    // No <img> element should have been injected (innerHTML would create one)
    expect(appEl.querySelector("img")).toBeNull();

    // The onerror handler must NOT have executed
    expect(window.__xss).toBeUndefined();
  });

  it("appends nothing when #app element is absent", async () => {
    // Remove the app element before boot runs
    appEl.remove();

    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockRejectedValue(new Error("DB failure")) },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({}));

    // Should not throw even when #app is missing
    await expect(import("../../static/js/main.js")).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 50));

    // Re-create for afterEach cleanup
    appEl = document.createElement("div");
  });

  it("runs boot successfully on successful DB init", async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init },
    }));
    vi.doMock("../../static/js/ai.js", () => ({ AI: { _scrubPlaintextSecrets: vi.fn() }, AI_PROVIDERS: {} }));
    vi.doMock("../../static/js/api.js", () => ({ API: { lockVault: vi.fn() } }));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({ Gmail: { _scrubPlaintextSecrets: vi.fn() } }));
    vi.doMock("../../static/js/vault.js", () => ({
      Vault: { isConfigured: vi.fn(() => false) },
    }));

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(init).toHaveBeenCalledOnce();
    expect(appEl.querySelector("p")).toBeNull();
  });
});

describe("Session Guard", () => {
  let appEl;

  beforeEach(() => {
    vi.resetModules();
    appEl = document.createElement("div");
    appEl.id = "app";
    document.body.appendChild(appEl);
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    appEl.remove();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("wipes session when last activity was more than 6 hours ago", async () => {
    const wipeSession = vi.fn(async () => {});
    const lockVault = vi.fn();
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({ API: { lockVault } }));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({}));

    const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;
    localStorage.setItem("fincoach-session-last-activity", String(sevenHoursAgo));

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(wipeSession).toHaveBeenCalledOnce();
    expect(lockVault).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("fincoach-session-expired")).toBe("1");
  });

  it("does not wipe when last activity was less than 6 hours ago", async () => {
    const wipeSession = vi.fn(async () => {});
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({}));

    const oneHourAgo = Date.now() - 1 * 60 * 60 * 1000;
    localStorage.setItem("fincoach-session-last-activity", String(oneHourAgo));

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(wipeSession).not.toHaveBeenCalled();
  });

  it("does not wipe on first launch (no last activity recorded)", async () => {
    const wipeSession = vi.fn(async () => {});
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({}));

    // No SESSION_LAST_ACTIVITY_KEY set

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(wipeSession).not.toHaveBeenCalled();
  });

  it("does not wipe when trusted device is set", async () => {
    const wipeSession = vi.fn(async () => {});
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({}));

    const tenHoursAgo = Date.now() - 10 * 60 * 60 * 1000;
    localStorage.setItem("fincoach-session-last-activity", String(tenHoursAgo));
    localStorage.setItem("fincoach-trusted-device", "true");

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(wipeSession).not.toHaveBeenCalled();
  });
});

describe("Session expiry warning", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    const appEl = document.createElement("div");
    appEl.id = "app";
    document.body.appendChild(appEl);
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    document.getElementById("app")?.remove();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not dispatch session-expiry-warning when idle is below warn threshold", async () => {
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession: vi.fn(async () => {}) },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({ Gmail: { maybeAutoSync: vi.fn() } }));

    // 5 hours idle — below the 5h30m warn threshold
    localStorage.setItem("fincoach-session-last-activity", String(Date.now() - 5 * 60 * 60 * 1000));

    let warned = false;
    document.addEventListener("session-expiry-warning", () => { warned = true; }, { once: true });

    await import("../../static/js/main.js");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(warned).toBe(false);
  });

  it("dispatches session-expiry-warning when idle exceeds warn threshold", async () => {
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession: vi.fn(async () => {}) },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({ Gmail: { maybeAutoSync: vi.fn() } }));

    // 5h35m idle — above the 5h30m warn threshold, below 6h expiry
    const idleMs = 5 * 60 * 60 * 1000 + 35 * 60 * 1000;
    localStorage.setItem("fincoach-session-last-activity", String(Date.now() - idleMs));

    let warned = false;
    document.addEventListener("session-expiry-warning", () => { warned = true; }, { once: true });

    await import("../../static/js/main.js");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(warned).toBe(true);
    expect(sessionStorage.getItem("fincoach-session-expiry-warned")).toBe("1");
  });

  it("does not dispatch session-expiry-warning when already warned flag is set", async () => {
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession: vi.fn(async () => {}) },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({ Gmail: { maybeAutoSync: vi.fn() } }));

    const idleMs = 5 * 60 * 60 * 1000 + 35 * 60 * 1000;
    localStorage.setItem("fincoach-session-last-activity", String(Date.now() - idleMs));
    sessionStorage.setItem("fincoach-session-expiry-warned", "1"); // already warned

    let warnCount = 0;
    document.addEventListener("session-expiry-warning", () => { warnCount++; });

    await import("../../static/js/main.js");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(warnCount).toBe(0);
  });

  it("does not dispatch session-expiry-warning when trusted device is set", async () => {
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession: vi.fn(async () => {}) },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({ Gmail: { maybeAutoSync: vi.fn() } }));

    const idleMs = 5 * 60 * 60 * 1000 + 35 * 60 * 1000;
    localStorage.setItem("fincoach-session-last-activity", String(Date.now() - idleMs));
    localStorage.setItem("fincoach-trusted-device", "true");

    let warned = false;
    document.addEventListener("session-expiry-warning", () => { warned = true; }, { once: true });

    await import("../../static/js/main.js");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(warned).toBe(false);
  });

  it("does NOT call Gmail.maybeAutoSync from the 1-minute interval handler", async () => {
    const maybeAutoSync = vi.fn();
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession: vi.fn(async () => {}) },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({ Gmail: { maybeAutoSync } }));

    await import("../../static/js/main.js");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(maybeAutoSync).not.toHaveBeenCalled();
  });
});

describe("_handleOAuthCallback (iOS PWA OAuth redirect)", () => {
  let origLocation;

  beforeEach(() => {
    vi.resetModules();
    origLocation = window.location;
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: origLocation,
    });
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  function mockLocation({ search = "", hash = "" } = {}) {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { search, hash, pathname: "/" },
    });
    vi.spyOn(history, "replaceState").mockImplementation(() => {});
  }

  function setupDefaultMocks({
    consumePendingOAuthState = vi.fn(() => true),
    storePendingOAuthResult = vi.fn(),
    clearPendingOAuthResult = vi.fn(),
    finalizePendingOAuthResult = vi.fn().mockResolvedValue({ connected: true }),
    vaultConfigured = true,
    vaultUnlocked = false,
  } = {}) {
    vi.doMock("../../static/js/db.js", () => ({
      DB: { init: vi.fn().mockResolvedValue(undefined), wipeSession: vi.fn(async () => {}) },
    }));
    vi.doMock("../../static/js/ai.js", () => ({}));
    vi.doMock("../../static/js/api.js", () => ({}));
    vi.doMock("../../static/js/app.js", () => ({}));
    vi.doMock("../../static/js/gmail.js", () => ({
      Gmail: {
        consumePendingOAuthState,
        storePendingOAuthResult,
        clearPendingOAuthResult,
        finalizePendingOAuthResult,
      },
    }));
    vi.doMock("../../static/js/vault.js", () => ({
      Vault: {
        isConfigured: vi.fn(() => vaultConfigured),
        isUnlocked: vi.fn(() => vaultUnlocked),
      },
    }));
    return {
      consumePendingOAuthState,
      storePendingOAuthResult,
      clearPendingOAuthResult,
      finalizePendingOAuthResult,
    };
  }

  it("is a no-op when ?gmail-oauth param is absent", async () => {
    mockLocation({ search: "", hash: "" });
    setupDefaultMocks();

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(localStorage.getItem("fincoach-gmail-settings")).toBeNull();
    expect(sessionStorage.getItem("gmail-oauth-redirect-success")).toBeNull();
  });

  it("stores the one-time auth result handle until the vault is unlocked", async () => {
    const { consumePendingOAuthState, storePendingOAuthResult, finalizePendingOAuthResult } =
      setupDefaultMocks({ vaultConfigured: true, vaultUnlocked: false });
    const payload = {
      type: "gmail-oauth",
      status: "success",
      state: "valid-oauth-state",
      auth_result_id: "auth-result-1",
    };
    const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
    mockLocation({ search: "?gmail-oauth=1", hash: `#${encoded}` });

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(consumePendingOAuthState).toHaveBeenCalledWith("valid-oauth-state");
    expect(storePendingOAuthResult).toHaveBeenCalledWith({
      authResultId: "auth-result-1",
      state: "valid-oauth-state",
    });
    expect(finalizePendingOAuthResult).not.toHaveBeenCalled();
    expect(localStorage.getItem("fincoach-gmail-settings")).toBeNull();
    expect(sessionStorage.getItem("gmail-oauth-redirect-success")).toBeNull();
  });

  it("clears the pending auth result and shows an error when no vault is configured", async () => {
    const { consumePendingOAuthState, storePendingOAuthResult, clearPendingOAuthResult } =
      setupDefaultMocks({ vaultConfigured: false, vaultUnlocked: false });
    const payload = {
      type: "gmail-oauth",
      status: "success",
      state: "valid-oauth-state",
      auth_result_id: "auth-result-1",
    };
    const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
    mockLocation({ search: "?gmail-oauth=1", hash: `#${encoded}` });

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(consumePendingOAuthState).toHaveBeenCalledWith("valid-oauth-state");
    expect(storePendingOAuthResult).toHaveBeenCalled();
    expect(clearPendingOAuthResult).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("gmail-oauth-redirect-error")).toBe(
      "Set up a PIN before connecting Gmail.",
    );
  });

  it("stores error message in sessionStorage when status is error", async () => {
    const { consumePendingOAuthState } = setupDefaultMocks();
    const payload = {
      type: "gmail-oauth",
      status: "error",
      state: "valid-oauth-state",
      error: "access_denied",
    };
    const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
    mockLocation({ search: "?gmail-oauth=1", hash: `#${encoded}` });

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(consumePendingOAuthState).toHaveBeenCalledWith("valid-oauth-state");
    expect(sessionStorage.getItem("gmail-oauth-redirect-error")).toBe("access_denied");
    expect(localStorage.getItem("fincoach-gmail-settings")).toBeNull();
  });

  it("rejects redirect payload when oauth state validation fails", async () => {
    const consumePendingOAuthState = vi.fn(() => false);
    const payload = {
      type: "gmail-oauth",
      status: "success",
      state: "attacker-state",
      access_token: "at123",
      refresh_token: "rt456",
      expires_in: 3600,
    };
    const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
    mockLocation({ search: "?gmail-oauth=1", hash: `#${encoded}` });
    setupDefaultMocks({ consumePendingOAuthState });

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(consumePendingOAuthState).toHaveBeenCalledWith("attacker-state");
    expect(localStorage.getItem("fincoach-gmail-settings")).toBeNull();
    expect(sessionStorage.getItem("gmail-oauth-redirect-success")).toBeNull();
    expect(sessionStorage.getItem("gmail-oauth-redirect-error")).toBe("Invalid OAuth state");
  });

  it("silently ignores malformed base64 without throwing", async () => {
    mockLocation({ search: "?gmail-oauth=1", hash: "#not-valid-base64!!!" });
    setupDefaultMocks();

    await expect(import("../../static/js/main.js")).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 50));

    expect(localStorage.getItem("fincoach-gmail-settings")).toBeNull();
  });

  it("ignores success payload when auth_result_id is missing", async () => {
    const { consumePendingOAuthState, storePendingOAuthResult } = setupDefaultMocks();
    const payload = {
      type: "gmail-oauth",
      status: "success",
      state: "valid-oauth-state",
    };
    const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
    mockLocation({ search: "?gmail-oauth=1", hash: `#${encoded}` });

    await import("../../static/js/main.js");
    await new Promise((r) => setTimeout(r, 50));

    expect(consumePendingOAuthState).toHaveBeenCalledWith("valid-oauth-state");
    expect(storePendingOAuthResult).not.toHaveBeenCalled();
    expect(localStorage.getItem("fincoach-gmail-settings")).toBeNull();
    expect(sessionStorage.getItem("gmail-oauth-redirect-success")).toBeNull();
  });
});
