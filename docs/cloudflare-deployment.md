# Cloudflare Deployment Guide

Financial Coach uses two separate Cloudflare services:

| Service | Purpose | Directory | Deploy Command |
|---------|---------|-----------|----------------|
| **Cloudflare Pages** | Hosts the static PWA (HTML, CSS, JS, WASM) | Project root (`/`) | `make deploy` |
| **Cloudflare Worker** | Gmail OAuth proxy (token exchange only) | `cloudflare-worker/` | `cd cloudflare-worker && npx wrangler deploy` |

---

## Prerequisites

1. **Cloudflare account** — [Sign up](https://dash.cloudflare.com/sign-up)
2. **Wrangler CLI** — Already installed as a transitive dev dependency (`npx wrangler`)
3. **Authenticate once**:
   ```bash
   npx wrangler login
   ```
   Opens a browser for OAuth. Credentials are cached locally at `~/.wrangler/`.

---

## 1. Cloudflare Pages (Static PWA)

### What it hosts

The entire `static/` directory: `index.html`, CSS, JS modules, icons, manifest, service worker, and sql-wasm files.

### Deploy

```bash
# From project root
make deploy
```

This runs: `npx wrangler pages deploy static --project-name=fincoach`

On first run, Wrangler creates the Pages project `fincoach`. You may be prompted to confirm.

### When to redeploy

Redeploy after **any change** to files in `static/`:

- `static/js/*.js` — JS module changes
- `static/css/styles.css` — Style changes
- `static/index.html` — HTML changes
- `static/manifest.json` — PWA manifest changes
- `static/_headers` — Custom response headers
- `static/icons/*` — App icons

### Custom headers (`static/_headers`)

Cloudflare Pages reads this file to set response headers:

```
/js/sw.js
  Cache-Control: no-cache          # SW updates propagate immediately

/js/sql-wasm.wasm
  Content-Type: application/wasm   # Correct MIME type for WASM

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### Custom domain (optional)

1. Go to Cloudflare dashboard → **Pages** → `fincoach` → **Custom domains**
2. Add your domain and follow DNS setup instructions

### Deployed URL

Each deploy gets a unique preview URL:
```
https://<deploy-hash>.fincoach-<id>.pages.dev
```

This is also the main app URL. Every new deploy generates a new hash, but previous deploy URLs continue to work.

---

## 2. Cloudflare Worker (Gmail OAuth Proxy)

### What it does

Handles Gmail OAuth token exchange only. No email data passes through it.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/url` | GET | Generate Google OAuth URL |
| `/auth/callback` | GET | Exchange auth code for tokens (returns HTML with `postMessage`) |
| `/auth/refresh` | POST | Refresh an expired access token |

### Configuration (`cloudflare-worker/wrangler.toml`)

```toml
name = "gmail-proxy"
main = "gmail-proxy.js"
compatibility_date = "2024-09-25"
```

### First-time setup

#### 1. Set secrets

```bash
cd cloudflare-worker

npx wrangler secret put GOOGLE_CLIENT_ID
# Paste your Google OAuth Client ID

npx wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your Google OAuth Client Secret

npx wrangler secret put REDIRECT_URI
# Enter: https://<your-worker-name>.<your-account>.workers.dev/auth/callback

npx wrangler secret put ALLOWED_ORIGIN
# Enter comma-separated origins:
# http://localhost:8080,https://<your-pages-url>.pages.dev
```

> **ALLOWED_ORIGIN** supports multiple comma-separated URLs for CORS.
> Include `http://localhost:8080` for local dev and your Pages URL for production.

#### 2. Deploy

```bash
cd cloudflare-worker
npx wrangler deploy
```

#### 3. Verify the PWA config

Ensure `static/js/config.js` points to your Worker URL:

```javascript
export const GMAIL_PROXY_URL = "https://<your-worker-name>.<your-account>.workers.dev";
```

If you change the Worker name or account, update this URL and redeploy Pages.

### Deploy

```bash
# From cloudflare-worker/ directory
cd cloudflare-worker
npx wrangler deploy
```

### When to redeploy

Redeploy after changes to:

- `cloudflare-worker/gmail-proxy.js` — Worker code changes
- `cloudflare-worker/wrangler.toml` — Configuration changes

**Note**: Secrets (`GOOGLE_CLIENT_ID`, etc.) are set independently via `npx wrangler secret put` and do NOT require a redeploy to take effect.

### When to update secrets

| Secret | Update when... |
|--------|---------------|
| `GOOGLE_CLIENT_ID` | You regenerate Google OAuth credentials |
| `GOOGLE_CLIENT_SECRET` | You regenerate Google OAuth credentials |
| `REDIRECT_URI` | You change the Worker name or Cloudflare account |
| `ALLOWED_ORIGIN` | You add a new deployment URL (e.g., custom domain) or change the Pages project |

### Update a secret

```bash
cd cloudflare-worker
npx wrangler secret put <SECRET_NAME> --name gmail-proxy
# Paste the new value when prompted
```

### List current secrets (names only, not values)

```bash
cd cloudflare-worker
npx wrangler secret list --name gmail-proxy
```

---

## Quick Reference

### Deploy everything

```bash
# Deploy PWA (from project root)
make deploy

# Deploy Gmail proxy (from cloudflare-worker/)
cd cloudflare-worker && npx wrangler deploy
```

### Common scenarios

| Scenario | What to do |
|----------|-----------|
| Changed JS/CSS/HTML | `make deploy` from project root |
| Changed Gmail proxy code | `cd cloudflare-worker && npx wrangler deploy` |
| Added a new deployment domain | Update `ALLOWED_ORIGIN` secret with comma-separated list |
| Changed Google OAuth credentials | Update `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` secrets |
| Changed Worker URL/name | Update `static/js/config.js` → `make deploy` |
| Changed `_headers` file | `make deploy` from project root |

### Pre-deploy checklist

```bash
make lint          # Zero errors
make test          # All tests pass
make deploy        # Deploy PWA
```

---

## Google OAuth Setup (for Gmail + Drive sync)

If you haven't set up Google OAuth credentials yet:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable **Gmail API** — APIs & Services → Enable APIs → search "Gmail API" → Enable
4. Enable **Google Drive API** — APIs & Services → Enable APIs → search "Google Drive API" → Enable
   > ⚠️ **Both APIs must be enabled.** Skipping the Drive API causes a `403 accessNotConfigured` error when Drive sync is used.
5. Go to **Credentials** → **Create credentials** → **OAuth 2.0 Client ID**
6. Application type: **Web application**
7. Authorized redirect URIs: `https://<your-worker-name>.<your-account>.workers.dev/auth/callback`
8. Copy the Client ID and Client Secret
9. Set them as Worker secrets (see First-time setup above)
