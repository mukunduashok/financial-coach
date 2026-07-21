/**
 * gmail-proxy.js — Cloudflare Worker for Gmail OAuth token exchange.
 *
 * The browser does all Gmail API calls directly; this worker only handles:
 * - GET  /auth/url       → Generate Google OAuth URL
 * - GET  /auth/callback  → Exchange auth code for a one-time auth result handle
 * - POST /auth/consume   → Consume the one-time handle and return tokens exactly once
 * - POST /auth/refresh   → Refresh an expired access token
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_RESULT_TTL_MS = 5 * 60 * 1000;
const AUTH_RESULT_STORAGE_KEY = "auth-result";
const JSON_TEXT_ENCODER = new TextEncoder();
const BODY_SIZE_LIMITS = {
  consume: 1024,
  refresh: 4096,
};
const RATE_LIMIT_POLICIES = {
  authUrl: { limit: 20, windowMs: 60 * 1000 },
  authConsume: { limit: 10, windowMs: 60 * 1000 },
  authRefresh: { limit: 6, windowMs: 5 * 60 * 1000 },
  callbackError: { limit: 2, windowMs: 5 * 60 * 1000 },
};
const SCOPES =
  "https://www.googleapis.com/auth/gmail.readonly " +
  "https://www.googleapis.com/auth/drive.appdata " +
  "openid email";

class InvalidJsonBodyError extends Error {
  constructor() {
    super("Invalid JSON body");
    this.name = "InvalidJsonBodyError";
  }
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

function _originAllowed(origin, allowedOrigins = "") {
  if (!origin || !allowedOrigins) return false;
  const patterns = allowedOrigins.split(",").map((o) => o.trim()).filter(Boolean);
  for (const pattern of patterns) {
    if (pattern === origin) return true;
    if (pattern.includes("*")) {
      const regex = new RegExp(`^${pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+")}$`);
      if (regex.test(origin)) return true;
    }
  }
  return false;
}

function corsHeaders(origin, allowedOrigins) {
  if (!_originAllowed(origin, allowedOrigins)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function noStoreHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    ...extra,
  };
}

function jsonResponse(body, status, origin, allowedOrigin, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, allowedOrigin),
      ...extraHeaders,
    },
  });
}

function securityLog(event, details = {}) {
  console.warn(JSON.stringify({ event, ...details }));
}

function clientFingerprint(request, origin = "") {
  const forwardedIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    request.headers.get("Fly-Client-IP") ||
    "unknown";
  return `${forwardedIp}:${origin || "no-origin"}`;
}

function originDeniedResponse(route, origin, env) {
  securityLog("origin_not_allowed", { route, origin: origin || "missing" });
  return jsonResponse({ error: "Origin not allowed" }, 403, origin, env.ALLOWED_ORIGIN, noStoreHeaders());
}

function rateLimitJsonResponse(origin, env, retryAfter) {
  return jsonResponse(
    { error: "Rate limit exceeded. Try again later." },
    429,
    origin,
    env.ALLOWED_ORIGIN,
    noStoreHeaders({ "Retry-After": String(retryAfter) }),
  );
}

function rateLimitHtmlResponse(targetOrigin, retryAfter) {
  return new Response(
    callbackHTML("error", { error: "Too many requests", retry_after: retryAfter }, targetOrigin),
    {
      status: 429,
      headers: noStoreHeaders({ "Content-Type": "text/html", "Retry-After": String(retryAfter) }),
    },
  );
}

function createSafeErrorMessage(prefix, ref) {
  return `${prefix} Please try again later. Reference: ${ref}`;
}

function createErrorRef() {
  return crypto.randomUUID().slice(0, 8);
}

async function readJsonBody(request, maxBytes) {
  const text = await request.text();
  if (JSON_TEXT_ENCODER.encode(text).length > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidJsonBodyError();
  }
}

async function enforceRateLimit(env, route, key) {
  if (!env.RATE_LIMITER) return null;

  const id = env.RATE_LIMITER.idFromName(route);
  const stub = env.RATE_LIMITER.get(id);
  const resp = await stub.fetch("https://rate-limiter.internal/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, route }),
  });

  if (resp.status !== 429) return null;

  const payload = await resp.json().catch(() => ({}));
  return payload.retry_after || 60;
}

async function handleAuthUrl(request, env, origin, stateParam = "") {
  if (!_originAllowed(origin, env.ALLOWED_ORIGIN)) {
    return originDeniedResponse("/auth/url", origin, env);
  }

  const retryAfter = await enforceRateLimit(env, "authUrl", clientFingerprint(request, origin));
  if (retryAfter) {
    securityLog("rate_limited", { route: "/auth/url", origin, retryAfter });
    return rateLimitJsonResponse(origin, env, retryAfter);
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  if (stateParam) params.set("state", stateParam);
  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  return jsonResponse({ auth_url: authUrl }, 200, origin, env.ALLOWED_ORIGIN, noStoreHeaders());
}

async function storeAuthResult(env, result) {
  if (!env.AUTH_RESULTS) {
    throw new Error("AUTH_RESULTS binding is not configured");
  }

  const id = env.AUTH_RESULTS.newUniqueId();
  const stub = env.AUTH_RESULTS.get(id);
  await stub.fetch("https://auth-result.internal/store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
  return id.toString();
}

async function handleCallback(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") || "";
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const rawState = url.searchParams.get("state") || "";

  let targetOrigin = "null";
  if (rawState) {
    try {
      const decoded = JSON.parse(atob(rawState));
      if (decoded.origin && _originAllowed(decoded.origin, env.ALLOWED_ORIGIN)) {
        targetOrigin = decoded.origin;
      } else if (decoded.origin) {
        securityLog("callback_origin_mismatch", { origin: decoded.origin });
      }
    } catch {
      securityLog("callback_state_invalid", { reason: "decode_failed" });
    }
  }

  const callbackKey = clientFingerprint(request, targetOrigin === "null" ? origin : targetOrigin);

  if (error || !code) {
    const retryAfter = await enforceRateLimit(env, "callbackError", callbackKey);
    if (retryAfter) {
      securityLog("rate_limited", { route: "/auth/callback", reason: error || "missing_code", retryAfter });
      return rateLimitHtmlResponse(targetOrigin, retryAfter);
    }
  }

  if (error) {
    securityLog("oauth_callback_failed", { reason: error });
    return new Response(callbackHTML("error", { error, state: rawState }, targetOrigin), {
      status: 400,
      headers: noStoreHeaders({ "Content-Type": "text/html" }),
    });
  }

  if (!code) {
    securityLog("oauth_callback_failed", { reason: "missing_code" });
    return new Response(
      callbackHTML("error", { error: "No authorization code received", state: rawState }, targetOrigin),
      {
        status: 400,
        headers: noStoreHeaders({ "Content-Type": "text/html" }),
      },
    );
  }

  try {
    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResp.ok) {
      const ref = createErrorRef();
      securityLog("oauth_token_exchange_failed", { status: tokenResp.status, ref });
      return new Response(
        callbackHTML(
          "error",
          { error: createSafeErrorMessage("Authentication could not be completed.", ref), state: rawState },
          targetOrigin,
        ),
        {
          status: 500,
          headers: noStoreHeaders({ "Content-Type": "text/html" }),
        },
      );
    }

    const tokens = await tokenResp.json();
    const authResultId = await storeAuthResult(env, {
      state: rawState,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      expires_at: Date.now() + AUTH_RESULT_TTL_MS,
    });

    return new Response(
      callbackHTML(
        "success",
        {
          state: rawState,
          auth_result_id: authResultId,
        },
        targetOrigin,
      ),
      {
        status: 200,
        headers: noStoreHeaders({ "Content-Type": "text/html" }),
      },
    );
  } catch (err) {
    const ref = createErrorRef();
    securityLog("oauth_callback_exception", { ref });
    return new Response(callbackHTML("error", { error: createSafeErrorMessage("Authentication failed.", ref), state: rawState }, targetOrigin), {
      status: 500,
      headers: noStoreHeaders({ "Content-Type": "text/html" }),
    });
  }
}

async function handleConsume(request, env, origin) {
  if (!_originAllowed(origin, env.ALLOWED_ORIGIN)) {
    return originDeniedResponse("/auth/consume", origin, env);
  }

  const retryAfter = await enforceRateLimit(env, "authConsume", clientFingerprint(request, origin));
  if (retryAfter) {
    securityLog("rate_limited", { route: "/auth/consume", origin, retryAfter });
    return rateLimitJsonResponse(origin, env, retryAfter);
  }

  let body;
  try {
    body = await readJsonBody(request, BODY_SIZE_LIMITS.consume);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      securityLog("request_body_too_large", { route: "/auth/consume", origin });
      return jsonResponse(
        { error: "Request body too large" },
        413,
        origin,
        env.ALLOWED_ORIGIN,
        noStoreHeaders(),
      );
    }

    return jsonResponse({ error: "Invalid JSON body" }, 400, origin, env.ALLOWED_ORIGIN, noStoreHeaders());
  }

  const authResultId = body.auth_result_id;
  const state = body.state;
  if (!authResultId || typeof authResultId !== "string") {
    return jsonResponse(
      { error: "auth_result_id is required" },
      400,
      origin,
      env.ALLOWED_ORIGIN,
      noStoreHeaders(),
    );
  }
  if (!state || typeof state !== "string") {
    return jsonResponse({ error: "state is required" }, 400, origin, env.ALLOWED_ORIGIN, noStoreHeaders());
  }

  let id;
  try {
    id = env.AUTH_RESULTS.idFromString(authResultId);
  } catch {
    return jsonResponse(
      { error: "Invalid auth_result_id" },
      400,
      origin,
      env.ALLOWED_ORIGIN,
      noStoreHeaders(),
    );
  }

  const stub = env.AUTH_RESULTS.get(id);
  const resp = await stub.fetch("https://auth-result.internal/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  const text = await resp.text();

  return new Response(text, {
    status: resp.status,
    headers: {
      "Content-Type": resp.headers.get("Content-Type") || "application/json",
      ...corsHeaders(origin, env.ALLOWED_ORIGIN),
      ...noStoreHeaders(),
    },
  });
}

async function handleRefresh(request, env, origin) {
  if (!_originAllowed(origin, env.ALLOWED_ORIGIN)) {
    return originDeniedResponse("/auth/refresh", origin, env);
  }

  const retryAfter = await enforceRateLimit(env, "authRefresh", clientFingerprint(request, origin));
  if (retryAfter) {
    securityLog("rate_limited", { route: "/auth/refresh", origin, retryAfter });
    return rateLimitJsonResponse(origin, env, retryAfter);
  }

  let body;
  try {
    body = await readJsonBody(request, BODY_SIZE_LIMITS.refresh);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      securityLog("request_body_too_large", { route: "/auth/refresh", origin });
      return jsonResponse(
        { error: "Request body too large" },
        413,
        origin,
        env.ALLOWED_ORIGIN,
        noStoreHeaders(),
      );
    }

    return jsonResponse({ error: "Invalid JSON body" }, 400, origin, env.ALLOWED_ORIGIN, noStoreHeaders());
  }

  const refreshToken = body.refresh_token;
  if (!refreshToken || typeof refreshToken !== "string") {
    return jsonResponse(
      { error: "refresh_token is required" },
      400,
      origin,
      env.ALLOWED_ORIGIN,
      noStoreHeaders(),
    );
  }

  try {
    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResp.ok) {
      const ref = createErrorRef();
      securityLog("oauth_refresh_failed", { status: tokenResp.status, ref });
      return jsonResponse(
        { error: createSafeErrorMessage("Token refresh failed.", ref) },
        tokenResp.status,
        origin,
        env.ALLOWED_ORIGIN,
        noStoreHeaders(),
      );
    }

    const tokens = await tokenResp.json();
    return jsonResponse(
      { access_token: tokens.access_token, expires_in: tokens.expires_in },
      200,
      origin,
      env.ALLOWED_ORIGIN,
      noStoreHeaders(),
    );
  } catch (err) {
    const ref = createErrorRef();
    securityLog("oauth_refresh_exception", { ref });
    return jsonResponse(
      { error: createSafeErrorMessage("Token refresh failed.", ref) },
      500,
      origin,
      env.ALLOWED_ORIGIN,
      noStoreHeaders(),
    );
  }
}

function callbackHTML(status, data, targetOrigin = "null") {
  const payload = JSON.stringify({ type: "gmail-oauth", status, ...data });
  const sanitized = payload.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<!DOCTYPE html>
<html>
<head><title>Gmail OAuth</title></head>
<body>
<p>${status === "success" ? "Authentication successful! This window will close." : "Authentication failed."}</p>
<script>
  var p = ${sanitized};
  var t = ${JSON.stringify(targetOrigin)};
  if (window.opener) {
    window.opener.postMessage(p, t);
    setTimeout(function() { window.close(); }, 1500);
  } else if (t && t !== "null") {
    var enc = btoa(encodeURIComponent(JSON.stringify(p)));
    window.location.replace(t + "/?gmail-oauth=1#" + enc);
  }
<\/script>
</body>
</html>`;
}

export class AuthResultStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/store" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: noStoreHeaders({ "Content-Type": "application/json" }),
        });
      }

      await this.state.storage.put(AUTH_RESULT_STORAGE_KEY, body);
      return new Response(null, { status: 204, headers: noStoreHeaders() });
    }

    if (url.pathname === "/consume" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: noStoreHeaders({ "Content-Type": "application/json" }),
        });
      }

      const record = await this.state.storage.get(AUTH_RESULT_STORAGE_KEY);
      if (!record) {
        return new Response(JSON.stringify({ error: "OAuth result not found" }), {
          status: 404,
          headers: noStoreHeaders({ "Content-Type": "application/json" }),
        });
      }

      if (record.expires_at && Date.now() > record.expires_at) {
        await this.state.storage.delete(AUTH_RESULT_STORAGE_KEY);
        return new Response(JSON.stringify({ error: "OAuth result expired" }), {
          status: 410,
          headers: noStoreHeaders({ "Content-Type": "application/json" }),
        });
      }

      if (body.state !== record.state) {
        return new Response(JSON.stringify({ error: "Invalid OAuth state" }), {
          status: 403,
          headers: noStoreHeaders({ "Content-Type": "application/json" }),
        });
      }

      await this.state.storage.delete(AUTH_RESULT_STORAGE_KEY);
      return new Response(
        JSON.stringify({
          access_token: record.access_token,
          refresh_token: record.refresh_token,
          expires_in: record.expires_in,
        }),
        {
          status: 200,
          headers: noStoreHeaders({ "Content-Type": "application/json" }),
        },
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: noStoreHeaders({ "Content-Type": "application/json" }),
    });
  }
}

export class RequestRateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== "/check" || request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: noStoreHeaders({ "Content-Type": "application/json" }),
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: noStoreHeaders({ "Content-Type": "application/json" }),
      });
    }

    const route = body.route;
    const key = body.key;
    const policy = RATE_LIMIT_POLICIES[route];
    if (!policy || !key) {
      return new Response(JSON.stringify({ error: "Invalid rate limit request" }), {
        status: 400,
        headers: noStoreHeaders({ "Content-Type": "application/json" }),
      });
    }

    const storageKey = `${route}:${key}`;
    const now = Date.now();
    const record = (await this.state.storage.get(storageKey)) || {
      count: 0,
      resetAt: now + policy.windowMs,
    };

    if (record.resetAt <= now) {
      record.count = 0;
      record.resetAt = now + policy.windowMs;
    }

    record.count += 1;
    await this.state.storage.put(storageKey, record);

    const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    if (record.count > policy.limit) {
      return new Response(JSON.stringify({ allowed: false, retry_after: retryAfter }), {
        status: 429,
        headers: noStoreHeaders({ "Content-Type": "application/json" }),
      });
    }

    return new Response(JSON.stringify({ allowed: true, retry_after: 0 }), {
      status: 200,
      headers: noStoreHeaders({ "Content-Type": "application/json" }),
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin, env.ALLOWED_ORIGIN),
          ...noStoreHeaders(),
        },
      });
    }

    if (url.pathname === "/auth/url" && request.method === "GET") {
      return handleAuthUrl(request, env, origin, url.searchParams.get("state") || "");
    }

    if (url.pathname === "/auth/callback" && request.method === "GET") {
      return handleCallback(request, env);
    }

    if (url.pathname === "/auth/consume" && request.method === "POST") {
      return handleConsume(request, env, origin);
    }

    if (url.pathname === "/auth/refresh" && request.method === "POST") {
      return handleRefresh(request, env, origin);
    }

    return jsonResponse({ error: "Not found" }, 404, origin, env.ALLOWED_ORIGIN, noStoreHeaders());
  },
};