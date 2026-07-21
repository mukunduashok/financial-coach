// @vitest-environment node
/**
 * Unit tests for cloudflare-worker/gmail-proxy.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import workerModule from "../../cloudflare-worker/gmail-proxy.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

function createRateLimiterBinding({ defaultLimit = Number.POSITIVE_INFINITY } = {}) {
  const counters = new Map();

  return {
    idFromName(name) {
      return { toString: () => name };
    },
    get(idLike) {
      const route = typeof idLike === "string" ? idLike : idLike.toString();
      return {
        async fetch(requestUrl, init = {}) {
          const url = new URL(requestUrl);
          if (url.pathname !== "/check" || (init.method || "GET") !== "POST") {
            return new Response(JSON.stringify({ error: "Not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          const body = init.body ? JSON.parse(init.body) : {};
          const key = `${route}:${body.key || "anonymous"}`;
          const count = (counters.get(key) || 0) + 1;
          counters.set(key, count);
          const limit = body.limit ?? defaultLimit;
          const allowed = count <= limit;

          return new Response(
            JSON.stringify({
              allowed,
              retry_after: allowed ? 0 : 60,
              remaining: Math.max(0, limit - count),
            }),
            {
              status: allowed ? 200 : 429,
              headers: { "Content-Type": "application/json" },
            },
          );
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
    RATE_LIMITER: createRateLimiterBinding(),
    ...overrides,
  };
}

function makeRequest(path, { origin = "", searchParams = {}, method = "GET", body, headers: extraHeaders = {} } = {}) {
  const url = new URL(`https://proxy.example.com${path}`);
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v);
  }
  const headers = { ...extraHeaders };
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

  it("hides upstream token exchange error details from callback HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("invalid_grant code=secret-code refresh_token=secret-token", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );
    const state = btoa(JSON.stringify({ nonce: "n3", origin: "http://localhost:8080" }));
    const resp = await workerModule.fetch(
      makeRequest("/auth/callback", { searchParams: { code: "auth-code", state } }),
      createMockEnv(),
    );
    const html = await resp.text();

    expect(resp.status).toBe(500);
    expect(html).not.toContain("invalid_grant");
    expect(html).not.toContain("secret-code");
    expect(html).not.toContain("secret-token");
    expect(html).toContain("Reference:");
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

describe("abuse controls", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects disallowed origins on /auth/refresh", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/refresh", {
        method: "POST",
        origin: "https://evil.com",
        body: { refresh_token: "refresh-token" },
      }),
      createMockEnv(),
    );
    const data = await resp.json();

    expect(resp.status).toBe(403);
    expect(data.error).toContain("Origin not allowed");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects disallowed origins on /auth/url", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/url", { origin: "https://evil.com" }),
      createMockEnv(),
    );
    const data = await resp.json();

    expect(resp.status).toBe(403);
    expect(data.error).toContain("Origin not allowed");
  });

  it("rejects oversized JSON bodies before refreshing tokens", async () => {
    const resp = await workerModule.fetch(
      makeRequest("/auth/refresh", {
        method: "POST",
        origin: "http://localhost:8080",
        body: { refresh_token: "x".repeat(5000) },
      }),
      createMockEnv(),
    );
    const data = await resp.json();

    expect(resp.status).toBe(413);
    expect(data.error).toContain("Request body too large");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rate limits repeated refresh attempts", async () => {
    const env = createMockEnv({ RATE_LIMITER: createRateLimiterBinding({ defaultLimit: 2 }) });
    const requestOptions = {
      method: "POST",
      origin: "http://localhost:8080",
      headers: { "CF-Connecting-IP": "203.0.113.10" },
      body: { refresh_token: "refresh-token" },
    };

    const firstResp = await workerModule.fetch(makeRequest("/auth/refresh", requestOptions), env);
    const secondResp = await workerModule.fetch(makeRequest("/auth/refresh", requestOptions), env);
    const thirdResp = await workerModule.fetch(makeRequest("/auth/refresh", requestOptions), env);
    const thirdData = await thirdResp.json();

    expect(firstResp.status).toBe(200);
    expect(secondResp.status).toBe(200);
    expect(thirdResp.status).toBe(429);
    expect(thirdResp.headers.get("Retry-After")).toBe("60");
    expect(thirdData.error).toContain("Rate limit exceeded");
  });

  it("hides upstream refresh error details from API responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("refresh_token=secret-token invalid_client", {
          status: 401,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const resp = await workerModule.fetch(
      makeRequest("/auth/refresh", {
        method: "POST",
        origin: "http://localhost:8080",
        body: { refresh_token: "refresh-token" },
      }),
      createMockEnv(),
    );
    const data = await resp.json();

    expect(resp.status).toBe(401);
    expect(data.error).not.toContain("secret-token");
    expect(data.error).not.toContain("invalid_client");
    expect(data.error).toContain("Reference:");
  });

  it("rate limits repeated failed callbacks from the same client", async () => {
    const env = createMockEnv({ RATE_LIMITER: createRateLimiterBinding({ defaultLimit: 2 }) });
    const requestOptions = {
      headers: { "CF-Connecting-IP": "203.0.113.11" },
      searchParams: { error: "access_denied", state: btoa(JSON.stringify({ origin: "http://localhost:8080" })) },
    };

    const firstResp = await workerModule.fetch(makeRequest("/auth/callback", requestOptions), env);
    const secondResp = await workerModule.fetch(makeRequest("/auth/callback", requestOptions), env);
    const thirdResp = await workerModule.fetch(makeRequest("/auth/callback", requestOptions), env);
    const thirdHtml = await thirdResp.text();

    expect(firstResp.status).toBe(400);
    expect(secondResp.status).toBe(400);
    expect(thirdResp.status).toBe(429);
    expect(thirdHtml).toContain("Too many requests");
  });
});
