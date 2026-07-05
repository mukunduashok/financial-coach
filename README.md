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

Enter the API key directly in the Settings screen. Keys are stored in `localStorage` on your device only.

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
6. In the app, go to **Settings** and enter the worker URL, then go to **Sync** to connect your Gmail account.

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
- AI queries are sent only to your configured provider; choose Ollama for fully offline operation
- Gmail OAuth tokens are stored locally and never sent anywhere except Google's OAuth servers and the Cloudflare Worker you control
- Google Drive backups are AES-GCM encrypted before upload — the key is derived from your Gmail address via PBKDF2 and never leaves your device

## License

See [LICENSE](./LICENSE).
