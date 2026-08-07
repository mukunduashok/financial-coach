# Financial Coach

AI-powered personal finance manager with privacy-first design. Track transactions, set budgets, manage goals, and get AI financial coaching — all running locally in your browser with your data staying on your device.

> **Indian Rupee (₹) first.** Built for personal use with a local-first, zero-backend architecture.

## Features

- **AI Financial Coaching** — Chat with an AI advisor (Groq, OpenAI, Gemini, Azure, Ollama) about spending, budgets, and goals
- **Gmail Transaction Sync** — Import transactions automatically from bank email alerts via Gmail OAuth
- **Budget Tracking** — Set per-category spending limits with on-track / warning / exceeded status
- **Goal Management** — Track savings goals with deadlines, contributions, and progress charts
- **Bill Reminders** — Track recurring bills and upcoming due dates
- **Recurring Detection** — Auto-detect subscriptions and recurring expenses
- **Multi-Account Support** — Manage multiple bank accounts with merge/unmerge (up to 5 levels deep)
- **Data Export** — Export transactions as CSV or PDF reports
- **Google Drive Backup** — Encrypted (AES-GCM) backup and restore via Google Drive
- **Spending Charts** — Category pie charts and monthly trend line charts
- **Taxonomy Management** — Full CRUD for categories and merchant mappings
- **PWA** — Install as a mobile or desktop app directly from the browser
- **Dark / Light Mode** — Follows system preference with manual override
- **Session Security** — Data wiped after 6 hours of inactivity (trusted device mode opt-in)

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | Vanilla JS (ES Modules), no build step |
| Database | [sql.js](https://sql.js.org/) (SQLite WASM) + IndexedDB for persistence |
| AI | Direct REST calls — Groq / OpenAI / Google Gemini / Azure OpenAI / Ollama |
| Deployment | [Cloudflare Pages](https://pages.cloudflare.com/) (static files) |
| Gmail OAuth | Cloudflare Worker proxy (`cloudflare-worker/`) |
| Drive Backup | Google Drive API (AES-GCM encrypted) |
| Dev tooling | `npm` (dev only), [Biome](https://biomejs.dev/) (lint/format), [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/) |

There is **no backend server, no Python, no Docker, no build step**. The app is pure static files.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (for dev tooling only — not required in production)
- A modern browser (Chrome, Firefox, Safari, Edge)

### Run Locally

```bash
# Clone the repository
git clone https://github.com/your-username/financial-coach.git
cd financial-coach

# Install dev dependencies (Biome, Vitest, Playwright)
make sync

# Serve the app locally
make dev
```

Open [http://localhost:8111](http://localhost:8111) in your browser.

On first launch, the onboarding wizard will guide you through:
1. Creating your first account
2. Configuring an AI provider
3. (Optional) Connecting Gmail for transaction sync

## Self-Hosting

If you are forking this repo to run your own instance, follow these steps in order.

> **Gmail sync requires a Cloudflare Worker** that you deploy under your own Google OAuth credentials. The rest of the app (budgets, goals, AI chat, etc.) works without it.

### 1. Google OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a new project.
2. Enable the **Gmail API** (`APIs & Services → Enable APIs → Gmail API`).
3. Create **OAuth 2.0 credentials** — type: *Web application*.
4. Under *Authorised redirect URIs*, add your Worker callback URL:
   `https://<your-worker>.<your-subdomain>.workers.dev/gmail/callback`

### 2. Deploy the Cloudflare Worker

```bash
cd cloudflare-worker

# Store your secrets (you will be prompted to type each value)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put REDIRECT_URI      # Worker callback URL from step 1.4
npx wrangler secret put ALLOWED_ORIGIN    # Your Pages domain, e.g. https://finance.example.com

npx wrangler deploy
```

Note the deployed Worker URL — you will need it in the next step.

Before going live, choose the Cloudflare security path that matches your plan:

- Paid plan path:
  - add route-specific Cloudflare dashboard rate limits / WAF rules for `/auth/url`, `/auth/refresh`, and repeated `/auth/callback` failures
  - keep `/auth/refresh` and callback-failure thresholds stricter than `/auth/url`
  - add alerts or log monitors for repeated `origin_not_allowed`, `rate_limited`, and callback-state failures emitted by the Worker
- Free plan path:
  - rely on the Worker's built-in protection layer: strict `ALLOWED_ORIGIN` checks, request body caps, generic safe OAuth errors, and Durable Object-backed throttling
  - optionally add simple custom method-block rules if your zone dashboard exposes them: only `GET` for `/auth/url` and `/auth/callback`, only `POST` for `/auth/refresh`
  - monitor Worker logs for repeated `origin_not_allowed`, `rate_limited`, and callback-state failures

For both paths:
- keep `invocation_logs` disabled for the Worker and restrict access / retention for any other logs so OAuth callback query data is not broadly retained

The current implementation already enforces origin checks, request body caps, and Durable Object-backed throttling in the Worker itself. Paid-plan dashboard rules are still useful as extra defense in depth, but Free-tier deployments can rely on the built-in Durable Object limiter.

### 3. Point the app at your Worker

Copy `.env.example` to `.env` and set `GMAIL_PROXY_URL` to your deployed Worker URL:

```bash
cp .env.example .env
# then edit .env:
# GMAIL_PROXY_URL=https://<your-worker>.<your-subdomain>.workers.dev
```

`make dev` and `make deploy` read this value and generate `static/js/env.js` automatically.

### 4. Deploy the app

```bash
make deploy
```

Or connect the repository to **Cloudflare Pages** with:
- Build command: *(leave empty)*
- Build output directory: `static/`

Make sure `ALLOWED_ORIGIN` in your Worker matches the Pages domain before deploying.

## AI Provider Setup

AI settings are configured in the app under **Settings → AI Provider**. No config files needed.

| Provider | Cost | How to get a key |
|----------|------|-----------------|
| **Groq** | Free tier | Sign up at [groq.com](https://console.groq.com) |
| **OpenAI** | Paid | [platform.openai.com](https://platform.openai.com) |
| **Google Gemini** | Free tier | [aistudio.google.com](https://aistudio.google.com) |
| **Azure OpenAI** | Paid | Azure subscription required |
| **Ollama** (local) | Free | Install [Ollama](https://ollama.com), run `ollama pull llama3.1:8b` |

Set up the in-app Credential Vault first, then enter the API key in the Settings screen. Keys are stored only in the encrypted vault on your device.

## Gmail Sync Setup

Gmail sync requires a Cloudflare Worker to handle the OAuth token exchange securely (since there is no backend).

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the **Gmail API**
3. Create **OAuth 2.0 credentials** (Web application type)
4. Add your Cloudflare Worker callback URL as an authorised redirect URI (e.g. `https://gmail-proxy.your-worker.workers.dev/gmail/callback`)
5. Deploy the worker:
   ```bash
   cd cloudflare-worker
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   wrangler secret put REDIRECT_URI       # your worker callback URL
   wrangler secret put ALLOWED_ORIGIN     # your Pages domain, e.g. https://finance.example.com
   wrangler deploy
   ```
6. Configure Cloudflare abuse controls for the public OAuth endpoints:
   - Paid plan: add dashboard rate limiting / WAF rules plus alerts for repeated blocked-origin or callback-state failures.
   - Free plan: rely on the built-in Durable Object limiter, keep `ALLOWED_ORIGIN` strict, optionally add simple method-block custom rules, and monitor Worker logs for repeated blocked-origin or callback-state failures.
7. In the app, set up the **Credential Vault** in **Settings** first, then enter the worker URL and go to **Sync** to connect your Gmail account.

## Google Drive Backup

Encrypted backup uses the same Gmail OAuth token — no extra setup required once Gmail is connected.
Toggle auto-sync in **Settings → Google Drive Sync**.

See [docs/gdrive-sync.md](docs/gdrive-sync.md) for a full description of sync behaviour, merge conflict rules, and known caveats.

## Development

```bash
make sync           # Install JS dev dependencies (npm install)
make dev            # Serve static files at http://localhost:8111
make lint           # Format + lint JS with Biome (auto-fix)
make test-unit      # Unit tests (Vitest)
make test-e2e       # E2E tests (Playwright)
make test           # All tests (unit + E2E)
make clean-ports    # Kill orphaned dev/test server processes
make deploy         # Deploy to Cloudflare Pages
```

## Continuous Integration

Pull requests to `main` run linting and Vitest unit tests when opened, synchronized, or reopened.
End-to-end tests run only when the `run-e2e` label is added, or when a pull request already
carrying that label is marked ready for review.

Repository administrators must create the `run-e2e` label and configure branch protection for
`main` manually. Require the `lint-and-unit-tests` status check if it is part of the merge policy.
GitHub cannot make a label-conditional E2E status check required: a required check would remain
pending when the label is absent.

## Deployment (Cloudflare Pages)

The entire app is static files under `static/`. Deploy with:

```bash
make deploy
```

Or connect the repository to Cloudflare Pages directly — set the build output directory to `static/` and leave the build command empty.

Make sure your Cloudflare Worker's `ALLOWED_ORIGIN` secret matches your Pages domain before deploying.

## Architecture

```
static/
  index.html        # SPA shell — loads CDN globals, then main.js as module
  js/
    main.js         # Entry point — session guard, DB.init(), dispatches db-ready
    app.js          # SPA router + all render*() screen functions + event delegation
    db.js           # SQLite WASM + IndexedDB persistence, full schema, all CRUD
    ai.js           # AI provider REST calls and prompt templates
    api.js          # Thin bridge — delegates to DB.* / AI.* / Gmail.*
    gmail.js        # Gmail OAuth connect + email fetch + LLM transaction extraction
    gdrive.js       # Google Drive encrypted backup/sync (AES-GCM + PBKDF2)
    config.js       # All localStorage key constants
    utils.js        # Shared helpers (maskPII, etc.)

cloudflare-worker/
  gmail-proxy.js    # Cloudflare Worker — Gmail OAuth token exchange proxy
```

See [AGENTS.md](./AGENTS.md) for development workflow and coding standards.

## Privacy

- All financial data is stored locally in your browser (IndexedDB / SQLite WASM)
- No telemetry, no analytics, no server — this is a purely client-side app
- AI queries are sent only to your configured provider after you explicitly consent to external processing; choose Ollama for fully offline operation
- Gmail OAuth tokens and AI API keys are stored only in the encrypted in-browser Credential Vault and never sent anywhere except Google's OAuth servers, the Cloudflare Worker you control, and the AI provider you explicitly configure
- External AI prompts are sent directly from your browser and include only masked financial context relevant to the current feature (chat or Gmail extraction); do not paste secrets or personal data you do not want shared
- Google Drive backups are AES-GCM encrypted before upload — the key is derived from your Gmail address via PBKDF2 and never leaves your device

If you lose a device or forget your vault PIN, rotate your AI API keys, revoke Google access from https://myaccount.google.com/permissions, reconnect Gmail, and restore your latest encrypted Drive backup after setting up a new vault.

## License

See [LICENSE](./LICENSE).
