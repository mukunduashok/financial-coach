# Cloudflare Worker — Agent Instructions

> **Scope**: This file applies to all files under `cloudflare-worker/`. It overrides the root
> `AGENTS.md` for worker-specific conventions. Root `AGENTS.md` applies for workflow and safety.

## What This Worker Does

`gmail-proxy.js` is a Cloudflare Worker that acts as an OAuth proxy between the PWA (running in the browser) and the Google OAuth endpoints. The browser cannot exchange auth codes directly (client secret must stay server-side), so this worker handles:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/url` | GET | Generate Google OAuth authorization URL with PKCE state |
| `/auth/callback` | GET | Exchange auth code for access + refresh tokens; responds with HTML that `postMessage`s tokens to the opener |
| `/auth/refresh` | POST | Refresh an expired access token using the stored refresh token |

**The browser makes all Gmail API calls directly.** This worker only handles the OAuth token lifecycle.

The worker also enforces repo-visible abuse controls:
- `ALLOWED_ORIGIN` checks for browser-facing routes
- JSON body caps on `/auth/consume` and `/auth/refresh`
- Durable Object-backed route throttling via `RequestRateLimiter`
- structured `console.warn` security events for blocked origins, callback-state failures, rate-limit hits, and upstream OAuth failures
- generic correlation-safe error messages for callback / refresh failures (never echo raw upstream bodies or exception text)

## Configuration (`wrangler.toml`)

```toml
[[durable_objects.bindings]]
name = "AUTH_RESULTS"
class_name = "AuthResultStore"

[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RequestRateLimiter"

[vars]
GOOGLE_CLIENT_ID = "..."       # Set in Cloudflare dashboard secrets
GOOGLE_CLIENT_SECRET = "..."   # Never committed — use wrangler secret put
REDIRECT_URI = "..."           # Must match OAuth app config exactly
ALLOWED_ORIGIN = "..."         # Comma-separated list of allowed PWA origins
```

Secrets are managed via `wrangler secret put <NAME>` — never committed to version control.

## Commands

```bash
cd cloudflare-worker
npx wrangler dev              # Local dev mode (uses .dev.vars for secrets)
npx wrangler deploy           # Deploy the gmail-proxy Worker to Cloudflare
```

Or from the repo root:
```bash
make deploy                   # Deploys ONLY the static Pages site (static/) — NOT the worker
```

> **Note:** `make deploy` publishes the static Pages site only. Worker changes are **not** included — deploy the worker separately with `npx wrangler deploy` from the `cloudflare-worker/` directory.

## Testing

The worker is unit-tested in `tests/js/gmail-proxy.test.js` using Vitest with a Node.js fetch mock — no actual Cloudflare runtime needed.

```bash
make test-unit                # Runs gmail-proxy.test.js along with all other unit tests
```

## Security Rules

- **Never log tokens** — access/refresh tokens must not appear in `console.log`, error messages, or response bodies other than the intended token exchange response
- **ALLOWED_ORIGIN validation** — all CORS responses are gated on `_originAllowed(origin, env.ALLOWED_ORIGIN)`. Wildcards (`*`) are supported for subdomains
- **State parameter** — the OAuth state carries a base64-encoded JSON `{ origin }` payload. On callback, the origin is validated against `ALLOWED_ORIGIN` before being used as the `postMessage` target
- **No client secrets in source** — `env.GOOGLE_CLIENT_SECRET` must come from Cloudflare Secrets (wrangler), never hardcoded
- **Public endpoint abuse controls** — keep route-specific rate limits and JSON body caps in place; `/auth/refresh` and repeated failed callbacks should remain stricter than `/auth/url`
- **Operational controls are required too** — configure Cloudflare dashboard rate-limiting / WAF rules and alerts for repeated `origin_not_allowed`, `rate_limited`, and callback-state failures seen in Worker logs
- **Telemetry hygiene** — keep `invocation_logs = false` so automatic request logging does not persist OAuth callback query strings; if you enable any external log sink, redact `code`, `state`, token-shaped values, and query strings before retention
- **Restricted access + minimal retention** — only admins operating the Worker should have log access; keep retention as short as practical and use reference IDs from generic error responses for troubleshooting instead of raw upstream payloads
