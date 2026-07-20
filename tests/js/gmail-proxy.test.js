// @vitest-environment node
/**
 * Unit tests for cloudflare-worker/gmail-proxy.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import workerModule from "../../cloudflare-worker/gmail-proxy.js";

function createAuthResultsBinding() {
  const records = new Map();
  let seq = 0;

  function getKey(idLike) {
    if (!idLike) throw new Error("missing id");
    return typeof idLike === "string" ? idLike : idLike.toString();
  }

  return {
    newUniqueId() {
      seq += 1;
      const id = `auth-result-${seq}`;
      return { toString: () => id };
    },
    idFromString(id) {
      if (!id || typeof id !== "string") throw new Error("bad id");
      return { toString: () => id };
    },
    get(idLike) {
      const key = getKey(idLike);
      return {
        async fetch(requestUrl, init = {}) {
          const url = new URL(requestUrl);
          const method = init.method || "GET";
          const body = init.body ? JSON.parse(init.body) : null;

          if (url.pathname === "/store" && method === "POST") {
            records.set(key, body);
            return new Response(null, { status: 204 });
          }

          if (url.pathname === "/consume" && method === "POST") {
            const record = records.get(key);
            if (!record) {
              return new Response(JSON.stringify({ error: "OAuth result not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
              });
            }
            if (record.expires_at && Date.now() > record.expires_at) {
              records.delete(key);
              return new Response(JSON.stringify({ error: "OAuth result expired" }), {
                status: 410,
                headers: { "Content-Type": "application/json" },
              });
            }
            if (body?.state !== record.state) {
              return new Response(JSON.stringify({ error: "Invalid OAuth state" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
              });
            }

            records.delete(key);
            return new Response(
              JSON.stringify({
                access_token: record.access_token,
                refresh_token: record.refresh_token,
                expires_in: record.expires_in,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        },
      };
    },
  };
}

function createMockEnv(overrides = {}) {
  return {
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    REDIRECT_URI: "https://proxy.example.com/auth/callback",
    ALLOWED_ORIGIN: "http://localhost:8080,https://app.pages.dev",
    AUTH_RESULTS: createAuthResultsBinding(),
    ...overrides,
  };
}

function makeRequest(path, { origin = "", searchParams = {}, method = "GET", body } = {}) {
  const url = new URL(`https://proxy.example.com${path}`);
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v);
  }
  const headers = {};
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("_originAllowed (via CORS response headers)", () => {
  it("exact match: allowed origin receives Access-Control-Allow-Origin", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", { origin: "https://app.pages.dev" }),
      createMockEnv(),
    );
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("https://app.pages.dev");
  });

  it("wildcard: subdomain matches *.pages.dev pattern", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", { origin: "https://abc.pages.dev" }),
      createMockEnv({ ALLOWED_ORIGIN: "https://*.pages.dev" }),
    );
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("https://abc.pages.dev");
  });

  it("no match: disallowed origin does NOT receive CORS header", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", { origin: "https://evil.com" }),
      createMockEnv(),
    );
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("multiple allowed (comma-separated): second origin is allowed", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", { origin: "http://localhost:8080" }),
      createMockEnv(),
    );
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8080");
  });

  it("empty allowlist: no origin is allowed", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", { origin: "https://app.pages.dev" }),
      createMockEnv({ ALLOWED_ORIGIN: "" }),
    );
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("callbackHTML (via /auth/callback endpoint)", () => {
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

  it("targetOrigin in postMessage is the decoded state origin, not '*'", async () => {
    const state = btoa(JSON.stringify({ nonce: "n1", origin: "http://localhost:8080" }));
    const resp = await workerModule.fetch(
      makeRequest("/auth/callback", { searchParams: { code: "auth-code", state } }),
      createMockEnv(),
    );
    const html = await resp.text();

    expect(html).toContain('"http://localhost:8080"');
    expect(html).not.toContain('"*"');
  });

  it("success callback does not embed access or refresh tokens in HTML", async () => {
    const state = btoa(JSON.stringify({ nonce: "n2", origin: "http://localhost:8080" }));
    const resp = await workerModule.fetch(
      makeRequest("/auth/callback", { searchParams: { code: "auth-code", state } }),
      createMockEnv(),
    );
    const html = await resp.text();

    expect(resp.status).toBe(200);
    expect(html).toContain('"type":"gmail-oauth"');
    expect(html).toContain('"status":"success"');
    expect(html).toContain(`"state":"${state}"`);
    expect(html).toContain('"auth_result_id":"auth-result-1"');
    expect(html).not.toContain('"access_token":"tok"');
    expect(html).not.toContain('"refresh_token":"ref"');
    expect(resp.headers.get("Cache-Control")).toContain("no-store");
  });

  it("error status renders 'Authentication failed' message with 400", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/callback", { searchParams: { error: "access_denied" } }),
      createMockEnv(),
    );
    const html = await resp.text();

    expect(html).toContain("Authentication failed");
    expect(resp.status).toBe(400);
    expect(resp.headers.get("Cache-Control")).toContain("no-store");
  });

  it("targetOrigin defaults to 'null' when state is absent (safe fallback)", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/callback", { searchParams: { code: "auth-code" } }),
      createMockEnv(),
    );
    const html = await resp.text();

    expect(html).toContain('"null"');
    expect(html).not.toContain('"*"');
  });
});

describe("handleAuthUrl (via /auth/url endpoint)", () => {
  it("state query param is forwarded into the Google auth_url", async () => {
    const stateValue = btoa(JSON.stringify({ nonce: "abc", origin: "http://localhost:8080" }));
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", {
        origin: "http://localhost:8080",
        searchParams: { state: stateValue },
      }),
      createMockEnv(),
    );
    const data = await resp.json();

    const authUrl = new URL(data.auth_url);
    expect(authUrl.searchParams.get("state")).toBe(stateValue);
  });

  it("auth_url has no state parameter when no state is provided", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", { origin: "http://localhost:8080" }),
      createMockEnv(),
    );
    const data = await resp.json();

    const authUrl = new URL(data.auth_url);
    expect(authUrl.searchParams.has("state")).toBe(false);
  });

  it("returns 200 with auth_url field", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", { origin: "http://localhost:8080" }),
      createMockEnv(),
    );

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(typeof data.auth_url).toBe("string");
    expect(data.auth_url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("auth_url scope includes gmail.readonly, drive.appdata, openid, and email", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", { origin: "http://localhost:8080" }),
      createMockEnv(),
    );
    const data = await resp.json();

    const authUrl = new URL(data.auth_url);
    const scope = authUrl.searchParams.get("scope");
    expect(scope).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scope).toContain("https://www.googleapis.com/auth/drive.appdata");
    expect(scope.split(" ")).toContain("openid");
    expect(scope.split(" ")).toContain("email");
  });

  it("404 for unknown endpoint", async () => {
    const resp = await workerModule.fetch(makeRequest("/unknown"), createMockEnv());
    expect(resp.status).toBe(404);
  });
});

describe("callbackHTML — redirect fallback (iOS PWA)", () => {
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
    const resp = await workerModule.fetch(
      makeRequest("/auth/callback", { searchParams: { code: "auth-code", state } }),
      createMockEnv(),
    );
    const html = await resp.text();

    expect(html).toContain("window.location.replace");
    expect(html).toContain("/?gmail-oauth=1#");
  });

  it("redirect payload uses auth_result_id instead of tokens", async () => {
    const state = btoa(JSON.stringify({ origin: "http://localhost:8080" }));
    const resp = await workerModule.fetch(
      makeRequest("/auth/callback", { searchParams: { code: "auth-code", state } }),
      createMockEnv(),
    );
    const html = await resp.text();

    expect(html).toContain('"auth_result_id":"auth-result-1"');
    expect(html).not.toContain('"access_token":"tok"');
    expect(html).not.toContain('"refresh_token":"ref"');
  });

  it("error payload also echoes state for browser-side csrf validation", async () => {
    const state = btoa(JSON.stringify({ origin: "http://localhost:8080", nonce: "nonce-err" }));
    const resp = await workerModule.fetch(
      makeRequest("/auth/callback", { searchParams: { error: "access_denied", state } }),
      createMockEnv(),
    );
    const html = await resp.text();

    expect(resp.status).toBe(400);
    expect(html).toContain('"status":"error"');
    expect(html).toContain(`"state":"${state}"`);
    expect(html).toContain('"error":"access_denied"');
  });
});

describe("/auth/consume", () => {
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

  async function createAuthResult(env, state = "valid-state") {
    const callbackResp = await workerModule.fetch(
      makeRequest("/auth/callback", { searchParams: { code: "auth-code", state } }),
      env,
    );
    const html = await callbackResp.text();
    return html.match(/"auth_result_id":"([^"]+)"/)?.[1] || null;
  }

  it("returns tokens once and prevents replay", async () => {
    const env = createMockEnv();
    const state = "valid-state";
    const authResultId = await createAuthResult(env, state);

    const firstResp = await workerModule.fetch(
      makeRequest("/auth/consume", {
        method: "POST",
        origin: "http://localhost:8080",
        body: { auth_result_id: authResultId, state },
      }),
      env,
    );
    const firstData = await firstResp.json();
    expect(firstResp.status).toBe(200);
    expect(firstData.access_token).toBe("tok");
    expect(firstData.refresh_token).toBe("ref");
    expect(firstResp.headers.get("Cache-Control")).toContain("no-store");

    const secondResp = await workerModule.fetch(
      makeRequest("/auth/consume", {
        method: "POST",
        origin: "http://localhost:8080",
        body: { auth_result_id: authResultId, state },
      }),
      env,
    );
    const secondData = await secondResp.json();
    expect(secondResp.status).toBe(404);
    expect(secondData.error).toContain("not found");
  });

  it("rejects a mismatched OAuth state", async () => {
    const env = createMockEnv();
    const authResultId = await createAuthResult(env, "expected-state");

    const resp = await workerModule.fetch(
      makeRequest("/auth/consume", {
        method: "POST",
        origin: "http://localhost:8080",
        body: { auth_result_id: authResultId, state: "wrong-state" },
      }),
      env,
    );
    const data = await resp.json();

    expect(resp.status).toBe(403);
    expect(data.error).toContain("Invalid OAuth state");
  });

  it("rejects disallowed origins", async () => {
    const env = createMockEnv();
    const authResultId = await createAuthResult(env, "expected-state");

    const resp = await workerModule.fetch(
      makeRequest("/auth/consume", {
        method: "POST",
        origin: "https://evil.com",
        body: { auth_result_id: authResultId, state: "expected-state" },
      }),
      env,
    );
    const data = await resp.json();

    expect(resp.status).toBe(403);
    expect(data.error).toContain("Origin not allowed");
  });
});
