/**
 * gmail-proxy.js — Cloudflare Worker for Gmail OAuth token exchange.
 *
 * The browser does all Gmail API calls directly; this worker only handles:
 * - GET  /auth/url      → Generate Google OAuth URL
 * - GET  /auth/callback  → Exchange auth code for tokens (returns HTML with postMessage)
 * - POST /auth/refresh   → Refresh an expired access token
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES =
	"https://www.googleapis.com/auth/gmail.readonly " +
	"https://www.googleapis.com/auth/drive.appdata";

function _originAllowed(origin, allowedOrigins) {
  const patterns = allowedOrigins.split(",").map((o) => o.trim());
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

function jsonResponse(body, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, allowedOrigin),
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
  return jsonResponse({ auth_url: authUrl }, 200, origin, env.ALLOWED_ORIGIN);
}

async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  // CSRF is prevented by ALLOWED_ORIGIN validation — state payload carries only the target origin.
  // Derive the target origin from the OAuth state parameter
  const rawState = url.searchParams.get("state") || "";
  let targetOrigin = "null"; // safe fallback — browser silently drops the message
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
    return new Response(callbackHTML("error", { error }, targetOrigin), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!code) {
    return new Response(callbackHTML("error", { error: "No authorization code received" }, targetOrigin), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
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
      return new Response(callbackHTML("error", { error: `Token exchange failed: ${errBody}` }, targetOrigin), {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }

    const tokens = await tokenResp.json();
    return new Response(
      callbackHTML("success", {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      }, targetOrigin),
      {
        status: 200,
        headers: { "Content-Type": "text/html" },
      },
    );
  } catch (err) {
    return new Response(callbackHTML("error", { error: err.message }, targetOrigin), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}

async function handleRefresh(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin, env.ALLOWED_ORIGIN);
  }

  const refreshToken = body.refresh_token;
  if (!refreshToken || typeof refreshToken !== "string") {
    return jsonResponse({ error: "refresh_token is required" }, 400, origin, env.ALLOWED_ORIGIN);
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
      );
    }

    const tokens = await tokenResp.json();
    return jsonResponse(
      { access_token: tokens.access_token, expires_in: tokens.expires_in },
      200,
      origin,
      env.ALLOWED_ORIGIN,
    );
  } catch (err) {
    return jsonResponse({ error: err.message }, 500, origin, env.ALLOWED_ORIGIN);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env.ALLOWED_ORIGIN),
      });
    }

    // Route requests
    if (url.pathname === "/auth/url" && request.method === "GET") {
      return handleAuthUrl(env, origin, url.searchParams.get("state") || "");
    }

    if (url.pathname === "/auth/callback" && request.method === "GET") {
      return handleCallback(request, env);
    }

    if (url.pathname === "/auth/refresh" && request.method === "POST") {
      return handleRefresh(request, env, origin);
    }

    return jsonResponse({ error: "Not found" }, 404, origin, env.ALLOWED_ORIGIN);
  },
};
