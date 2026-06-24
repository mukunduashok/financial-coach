/**
 * Unit tests for static/js/theme-init.js, static/js/theme-apply.js,
 * and static/js/sw-register.js.
 *
 * All three files are plain IIFE scripts (not ES modules). Dynamic import()
 * is used alongside vi.resetModules() so each test gets a fresh execution.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// theme-init.js
// ---------------------------------------------------------------------------

describe("theme-init.js", () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.classList.remove("light-pending");
    localStorage.clear();
    // Default matchMedia stub — dark mode preference
    vi.stubGlobal("matchMedia", (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
    }));
  });

  afterEach(() => {
    document.documentElement.classList.remove("light-pending");
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("adds light-pending to html when saved theme is light", async () => {
    localStorage.setItem("fincoach-theme", "light");
    await import("../../static/js/theme-init.js");
    expect(document.documentElement.classList.contains("light-pending")).toBe(true);
  });

  it("does not add light-pending to html when saved theme is dark", async () => {
    localStorage.setItem("fincoach-theme", "dark");
    await import("../../static/js/theme-init.js");
    expect(document.documentElement.classList.contains("light-pending")).toBe(false);
  });

  it("adds light-pending when localStorage is empty and matchMedia prefers light", async () => {
    // No saved theme — falls back to matchMedia
    vi.stubGlobal("matchMedia", (query) => ({
      matches: query.includes("light"),
      media: query,
      addEventListener: () => {},
    }));
    await import("../../static/js/theme-init.js");
    expect(document.documentElement.classList.contains("light-pending")).toBe(true);
  });

  it("does not add light-pending when localStorage is empty and matchMedia prefers dark", async () => {
    // No saved theme — matchMedia returns false (dark preference)
    vi.stubGlobal("matchMedia", (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
    }));
    await import("../../static/js/theme-init.js");
    expect(document.documentElement.classList.contains("light-pending")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// theme-apply.js
// ---------------------------------------------------------------------------

describe("theme-apply.js", () => {
  let metaEl;

  beforeEach(() => {
    vi.resetModules();
    document.documentElement.classList.remove("light-pending");
    document.body.classList.remove("light");

    // Add a meta[name="theme-color"] element for apply tests
    metaEl = document.createElement("meta");
    metaEl.name = "theme-color";
    metaEl.content = "#000000";
    document.head.appendChild(metaEl);
  });

  afterEach(() => {
    document.documentElement.classList.remove("light-pending");
    document.body.classList.remove("light");
    metaEl?.remove();
  });

  it("adds light class to body when html has light-pending", async () => {
    document.documentElement.classList.add("light-pending");
    await import("../../static/js/theme-apply.js");
    expect(document.body.classList.contains("light")).toBe(true);
  });

  it("removes light-pending from html when applied", async () => {
    document.documentElement.classList.add("light-pending");
    await import("../../static/js/theme-apply.js");
    expect(document.documentElement.classList.contains("light-pending")).toBe(false);
  });

  it("sets meta[name=theme-color] content to #FFFFFF when applying light theme", async () => {
    document.documentElement.classList.add("light-pending");
    await import("../../static/js/theme-apply.js");
    expect(metaEl.content).toBe("#FFFFFF");
  });

  it("does not add light class to body when html does not have light-pending", async () => {
    // html has no light-pending
    await import("../../static/js/theme-apply.js");
    expect(document.body.classList.contains("light")).toBe(false);
  });

  it("does not modify meta content when html does not have light-pending", async () => {
    await import("../../static/js/theme-apply.js");
    expect(metaEl.content).toBe("#000000");
  });
});

// ---------------------------------------------------------------------------
// sw-register.js
// ---------------------------------------------------------------------------

describe("sw-register.js", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls navigator.serviceWorker.register with /js/sw.js when serviceWorker is available", async () => {
    const registerMock = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register: registerMock },
      writable: true,
      configurable: true,
    });

    await import("../../static/js/sw-register.js");

    expect(registerMock).toHaveBeenCalledWith("/js/sw.js");
  });

  it("does not throw when navigator.serviceWorker is not available", async () => {
    // Replace navigator with a plain object that has no serviceWorker property,
    // making `"serviceWorker" in navigator` return false so the guard skips registration.
    vi.stubGlobal("navigator", {});

    await expect(import("../../static/js/sw-register.js")).resolves.not.toThrow();
  });
});
