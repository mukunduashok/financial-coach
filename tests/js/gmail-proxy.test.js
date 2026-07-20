// @vitest-environment node
/**
 * Unit tests for cloudflare-worker/gmail-proxy.js
 *
 * Tests the Worker's exported fetch handler, which exercises:
 *   - _originAllowed() via CORS headers on responses
 *   - callbackHTML() via the /auth/callback response body
 *   - handleAuthUrl() via the /auth/url endpoint
 *   - handleCallback() via the /auth/callback endpoint
 *
 * Note: _originAllowed, callbackHTML, handleAuthUrl, handleCallback are NOT
 * individually exported — they are tested indirectly through the fetch handler.
 * Functions that require full Cloudflare Worker runtime (e.g., KV, Durable
 * Objects) are not tested here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import workerModule from "../../cloudflare-worker/gmail-proxy.js";

// ---------------------------------------------------------------------------
// Shared test env
// ---------------------------------------------------------------------------
const mockEnv = {
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  REDIRECT_URI: "https://proxy.example.com/auth/callback",
  ALLOWED_ORIGIN: "http://localhost:8080,https://app.pages.dev",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a GET Request with optional query params and Origin header. */
function makeRequest(path, { origin = "", searchParams = {} } = {}) {
  const url = new URL(`https://proxy.example.com${path}`);
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v);
  }
  const headers = {};
  if (origin) headers["Origin"] = origin;
  return new Request(url.toString(), { method: "GET", headers });
}

// ===========================================================================
// 1. _originAllowed — tested via CORS headers on JSON responses
// ===========================================================================
describe("_originAllowed (via CORS response headers)", () => {
  it("exact match: allowed origin receives Access-Control-Allow-Origin", async () => {
    const req = makeRequest("/auth/url", { origin: "https://app.pages.dev" });
    const resp = await workerModule.fetch(req, mockEnv);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("https://app.pages.dev");
  });

  it("wildcard: subdomain matches *.pages.dev pattern", async () => {
    const envWild = { ...mockEnv, ALLOWED_ORIGIN: "https://*.pages.dev" };
    const req = makeRequest("/auth/url", { origin: "https://abc.pages.dev" });
    const resp = await workerModule.fetch(req, envWild);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("https://abc.pages.dev");
  });

  it("no match: disallowed origin does NOT receive CORS header", async () => {
    const req = makeRequest("/auth/url", { origin: "https://evil.com" });
    const resp = await workerModule.fetch(req, mockEnv);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("multiple allowed (comma-separated): second origin is allowed", async () => {
    // mockEnv.ALLOWED_ORIGIN = "http://localhost:8080,https://app.pages.dev"
    const req = makeRequest("/auth/url", { origin: "http://localhost:8080" });
    const resp = await workerModule.fetch(req, mockEnv);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8080");
  });

  it("empty allowlist: no origin is allowed", async () => {
    const envEmpty = { ...mockEnv, ALLOWED_ORIGIN: "" };
    const req = makeRequest("/auth/url", { origin: "https://app.pages.dev" });
    const resp = await workerModule.fetch(req, envEmpty);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ===========================================================================
// 2. callbackHTML — tested via /auth/callback response body
// ===========================================================================
describe("callbackHTML (via /auth/callback endpoint)", () => {
  beforeEach(() => {
    // Mock token exchange fetch — returns a successful token response
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("targetOrigin in postMessage is the decoded state origin, not '*'", async () => {
    const state = btoa(JSON.stringify({ nonce: "n1", origin: "http://localhost:8080" }));
    const req = makeRequest("/auth/callback", {
      searchParams: { code: "auth-code", state },
    });
    const resp = await workerModule.fetch(req, mockEnv);
    const html = await resp.text();

    expect(html).toContain('"http://localhost:8080"');
    expect(html).not.toContain('"*"');
  });

  it("targetOrigin defaults to 'null' when state is absent (safe fallback)", async () => {
    const req = makeRequest("/auth/callback", { searchParams: { code: "auth-code" } });
    const resp = await workerModule.fetch(req, mockEnv);
    const html = await resp.text();

    expect(html).toContain('"null"');
    expect(html).not.toContain('"*"');
  });

  it("targetOrigin is 'null' when state origin is NOT in the allowlist", async () => {
    const state = btoa(JSON.stringify({ nonce: "n2", origin: "https://evil.com" }));
    const req = makeRequest("/auth/callback", {
      searchParams: { code: "auth-code", state },
    });
    const resp = await workerModule.fetch(req, mockEnv);
    const html = await resp.text();

    // Must NOT use evil.com as postMessage target
    expect(html).not.toContain('"https://evil.com"');
    expect(html).toContain('"null"');
  });

  it("success status renders 'Authentication successful' message", async () => {
    const state = btoa(JSON.stringify({ nonce: "n3", origin: "http://localhost:8080" }));
    const req = makeRequest("/auth/callback", {
      searchParams: { code: "auth-code", state },
    });
    const resp = await workerModule.fetch(req, mockEnv);
    const html = await resp.text();

    expect(html).toContain("Authentication successful");
    expect(resp.status).toBe(200);
  });

  it("error status renders 'Authentication failed' message with 400", async () => {
    const req = makeRequest("/auth/callback", { searchParams: { error: "access_denied" } });
    const resp = await workerModule.fetch(req, mockEnv);
    const html = await resp.text();

    expect(html).toContain("Authentication failed");
    expect(resp.status).toBe(400);
  });
});

// ===========================================================================
// 3. handleAuthUrl — tested via /auth/url endpoint
// ===========================================================================
describe("handleAuthUrl (via /auth/url endpoint)", () => {
  it("state query param is forwarded into the Google auth_url", async () => {
    const stateValue = btoa(JSON.stringify({ nonce: "abc", origin: "http://localhost:8080" }));
    const req = makeRequest("/auth/url", {
      origin: "http://localhost:8080",
      searchParams: { state: stateValue },
    });
    const resp = await workerModule.fetch(req, mockEnv);
    const data = await resp.json();

    const authUrl = new URL(data.auth_url);
    expect(authUrl.searchParams.get("state")).toBe(stateValue);
  });

  it("auth_url has no state parameter when no state is provided", async () => {
    const req = makeRequest("/auth/url", { origin: "http://localhost:8080" });
    const resp = await workerModule.fetch(req, mockEnv);
    const data = await resp.json();

    const authUrl = new URL(data.auth_url);
    expect(authUrl.searchParams.has("state")).toBe(false);
  });

  it("returns 200 with auth_url field", async () => {
    const req = makeRequest("/auth/url", { origin: "http://localhost:8080" });
    const resp = await workerModule.fetch(req, mockEnv);

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(typeof data.auth_url).toBe("string");
    expect(data.auth_url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("auth_url scope includes gmail.readonly, drive.appdata, openid, and email", async () => {
    const req = makeRequest("/auth/url", { origin: "http://localhost:8080" });
    const resp = await workerModule.fetch(req, mockEnv);
    const data = await resp.json();

    const authUrl = new URL(data.auth_url);
    const scope = authUrl.searchParams.get("scope");
    expect(scope).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scope).toContain("https://www.googleapis.com/auth/drive.appdata");
    // openid + email are required so /oauth2/v3/userinfo returns the user's sub
    expect(scope.split(" ")).toContain("openid");
    expect(scope.split(" ")).toContain("email");
  });

  it("404 for unknown endpoint", async () => {
    const req = makeRequest("/unknown");
    const resp = await workerModule.fetch(req, mockEnv);
    expect(resp.status).toBe(404);
  });
});

// ===========================================================================
// 4. callbackHTML — redirect fallback (iOS PWA)
// ===========================================================================
describe("callbackHTML \u2014 redirect fallback (iOS PWA)", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("generated HTML contains the window.location.replace redirect branch", async () => {
		const state = btoa(JSON.stringify({ origin: "http://localhost:8080" }));
		const req = makeRequest("/auth/callback", {
			searchParams: { code: "auth-code", state },
		});
		const resp = await workerModule.fetch(req, mockEnv);
		const html = await resp.text();

		expect(html).toContain("window.location.replace");
		expect(html).toContain("/?gmail-oauth=1#");
	});

	it("redirect URL uses targetOrigin derived from state", async () => {
		const state = btoa(JSON.stringify({ origin: "http://localhost:8080" }));
		const req = makeRequest("/auth/callback", {
			searchParams: { code: "auth-code", state },
		});
		const resp = await workerModule.fetch(req, mockEnv);
		const html = await resp.text();

		expect(html).toContain('"http://localhost:8080"');
		expect(html).toContain('+ "/?gmail-oauth=1#"');
	});

	it("redirect branch is guarded by t !== 'null' so it skips when targetOrigin is null", async () => {
		// No state \u2192 targetOrigin defaults to "null" \u2192 redirect branch should not fire
		const req = makeRequest("/auth/callback", { searchParams: { code: "auth-code" } });
		const resp = await workerModule.fetch(req, mockEnv);
		const html = await resp.text();

		expect(html).toContain("window.location.replace");
		expect(html).toContain('"null"');
		expect(html).toContain('t !== "null"');
	});

	it("payload in generated script contains expected gmail-oauth fields and echoes state", async () => {
		const state = btoa(
			JSON.stringify({
				origin: "http://localhost:8080",
				nonce: "nonce-123",
				issued_at: 1_700_000_000_000,
			}),
		);
		const req = makeRequest("/auth/callback", {
			searchParams: { code: "auth-code", state },
		});
		const resp = await workerModule.fetch(req, mockEnv);
		const html = await resp.text();

		expect(html).toContain('"type":"gmail-oauth"');
		expect(html).toContain('"status":"success"');
		expect(html).toContain(`"state":"${state}"`);
		expect(html).toContain('"access_token":"tok"');
		expect(html).toContain('"refresh_token":"ref"');
	});

	it("error payload also echoes state for browser-side csrf validation", async () => {
		const state = btoa(
			JSON.stringify({
				origin: "http://localhost:8080",
				nonce: "nonce-err",
				issued_at: 1_700_000_000_000,
			}),
		);
		const req = makeRequest("/auth/callback", {
			searchParams: { error: "access_denied", state },
		});
		const resp = await workerModule.fetch(req, mockEnv);
		const html = await resp.text();

		expect(resp.status).toBe(400);
		expect(html).toContain('"status":"error"');
		expect(html).toContain(`"state":"${state}"`);
		expect(html).toContain('"error":"access_denied"');
	});
});
