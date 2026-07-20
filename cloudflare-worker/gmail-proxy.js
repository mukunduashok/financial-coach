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
const SCOPES =
  "https://www.googleapis.com/auth/gmail.readonly " +
  "https://www.googleapis.com/auth/drive.appdata " +
  "openid email";

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

async function handleAuthUrl(env, origin, stateParam = "") {
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
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const rawState = url.searchParams.get("state") || "";

  let targetOrigin = "null";
  if (rawState) {
    try {
      const decoded = JSON.parse(atob(rawState));
      if (decoded.origin && _originAllowed(decoded.origin, env.ALLOWED_ORIGIN)) {
        targetOrigin = decoded.origin;
      }
    } catch {
      // malformed state — keep targetOrigin as "null"
    }
  }

  if (error) {
    return new Response(callbackHTML("error", { error, state: rawState }, targetOrigin), {
      status: 400,
      headers: noStoreHeaders({ "Content-Type": "text/html" }),
    });
  }

  if (!code) {
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
      const errBody = await tokenResp.text();
      return new Response(
        callbackHTML(
          "error",
          { error: `Token exchange failed: ${errBody}`, state: rawState },
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
    return new Response(callbackHTML("error", { error: err.message, state: rawState }, targetOrigin), {
      status: 500,
      headers: noStoreHeaders({ "Content-Type": "text/html" }),
    });
  }
}

async function handleConsume(request, env, origin) {
  if (!_originAllowed(origin, env.ALLOWED_ORIGIN)) {
    return jsonResponse(
      { error: "Origin not allowed" },
      403,
      origin,
      env.ALLOWED_ORIGIN,
      noStoreHeaders(),
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
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
  let body;
  try {
    body = await request.json();
  } catch {
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
      const errBody = await tokenResp.text();
      return jsonResponse(
        { error: `Token refresh failed: ${errBody}` },
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
    return jsonResponse({ error: err.message }, 500, origin, env.ALLOWED_ORIGIN, noStoreHeaders());
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
      return handleAuthUrl(env, origin, url.searchParams.get("state") || "");
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
