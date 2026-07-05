/**
 * Unit tests for static/js/config.js — runtime resolution of GMAIL_PROXY_URL.
 *
 * config.js resolves GMAIL_PROXY_URL from globalThis.__FINCOACH_CONFIG__ at
 * module-eval time. In the browser, env.js runs first and defines that global
 * before config.js (an ES module) is evaluated.
 *
 * Coverage split:
 *   - The DEFAULT / fallback branches (global absent, or present but missing the
 *     key) are deterministic here and asserted below.
 *   - The "global-present" branch cannot be re-tested reliably under vitest:
 *     Vite's module runner evaluates the real config.js before a test can mutate
 *     the global, so a dynamic re-import returns the fallback. That branch is
 *     verified authoritatively in a real browser by tests/e2e/js/pwa-smoke.spec.js
 *     (browsers re-evaluate a module when its query string changes), which injects
 *     a custom global and asserts config.js reads it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const DEFAULT_PROXY_URL = "https://your-worker.your-subdomain.workers.dev";

describe("config GMAIL_PROXY_URL resolution", () => {
	afterEach(() => {
		globalThis.__FINCOACH_CONFIG__ = undefined;
		vi.resetModules();
	});

	it("exports a non-empty string", async () => {
		const { GMAIL_PROXY_URL } = await import("../../static/js/config.js");
		expect(typeof GMAIL_PROXY_URL).toBe("string");
		expect(GMAIL_PROXY_URL.length).toBeGreaterThan(0);
	});

	it("falls back to the default placeholder when the global is absent", async () => {
		globalThis.__FINCOACH_CONFIG__ = undefined;
		vi.resetModules();
		const { GMAIL_PROXY_URL } = await import("../../static/js/config.js");
		expect(GMAIL_PROXY_URL).toBe(DEFAULT_PROXY_URL);
	});

	it("falls back to the default when the global exists but lacks GMAIL_PROXY_URL", async () => {
		globalThis.__FINCOACH_CONFIG__ = {};
		vi.resetModules();
		const { GMAIL_PROXY_URL } = await import("../../static/js/config.js");
		expect(GMAIL_PROXY_URL).toBe(DEFAULT_PROXY_URL);
	});
});
