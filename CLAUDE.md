# Claude Code Instructions

For detailed development guidelines, see [AGENTS.md](./AGENTS.md).

This file provides quick reference for Claude Code interactions.

## Quick Commands

```bash
make dev            # Serve static files on :8111
make lint        # Lint + format JS (biome)
make test-unit        # JS unit tests (vitest)
make test-e2e       # Playwright E2E tests
make deploy         # Deploy to Cloudflare Pages
make sync           # Install all dependencies (npm + playwright)
make clean-ports    # Kill orphaned servers on dev/test ports
```

## Key Points

- **Stack**: Vanilla JS PWA — `static/**` (biome, vitest, npm)
- **Frontend**: Vanilla JS, ES Modules, sql.js (SQLite WASM), no build step
- **Config**: `localStorage` for AI settings, IndexedDB for data
- **No backend** — pure static files deployed to Cloudflare Pages
- **CDN globals** (Chart.js, marked, DOMPurify) loaded via `<script>` tags in `index.html` — NOT importable as ES modules
- **Session security**: 6-hour inactivity wipe by default; trusted device mode opt-in (Settings)
- **Google Drive sync**: AES-GCM encrypted backup via `gdrive.js` using Gmail OAuth token
  - Multi-device safe `mergeFromJSON` (`SCHEMA_VERSION = 5`): natural-key UNION + last-writer-wins by `updated_at` + delete tombstones (`sync_tombstones` table). Never blindly clears local data.
- **Sample data**: `DB.loadSampleData()` / `API.loadSampleData()` loads a realistic demo dataset (Settings → Sample Data card, empty DB only) for manual/E2E testing.
- **Gmail sync**: OAuth via Cloudflare Worker proxy, LLM-based transaction extraction
- **AI providers**: Groq, OpenAI, Google Gemini, Azure OpenAI, Ollama (local)

## Module Reference

| File | Role |
|------|------|
| `main.js` | Entry — session guard, `DB.init()`, dispatches `db-ready` |
| `db.js` | SQLite WASM + IndexedDB, full schema + CRUD |
| `ai.js` | LLM REST calls, prompt templates, provider config |
| `api.js` | Thin bridge — delegates to `DB.*` / `AI.*` / `Gmail.*` |
| `app.js` | SPA Router, all `render*()` screens, event delegation |
| `gmail.js` | Gmail OAuth, email fetch, transaction extraction (SIP-safe deduplication) |
| `gdrive.js` | Google Drive encrypted backup/sync |
| `config.js` | All localStorage key constants |
| `utils.js` | `maskPII()` and shared helpers |

## Gmail Deduplication Rules

- **Layer 1**: `processed_gmail_messages` table filters already-seen message IDs before fetch.
- **Layer 2**: date+amount+account field check — **skipped for Gmail transactions** to allow multiple same-amount same-day emails (e.g., SIPs).
- `transaction_id` for Gmail rows = `"gmail_<gmail_message_id>"` (never the bank reference).

## Notes Field Behaviour (Edit Transaction Modal)

- **Gmail tx**: `#edit-desc` is empty; description shown as placeholder. Saving empty preserves original description.
- **Manual tx**: `#edit-desc` pre-filled with description value.

## Important Notes

- **Always run `make lint` before committing** — formats code with Biome (100-char lines) and fixes code quality issues
- Run `make test-unit` to verify changes don't break unit tests
- Run `make test-e2e` to run Playwright E2E tests
- Never commit secrets or API keys

## Mandatory After Every Change

```bash
make lint          # Format + lint JS (MUST run after every change)
make test-unit          # Unit tests must pass
make test-e2e         # E2E tests must pass (if UI/routes changed)
make clean-ports      # Kill orphaned servers after E2E/dev
```

**No regressions allowed** — all previously passing tests must continue to pass.

## Session Timer — Debugging & Testing

The session wipe timer lives entirely in **`localStorage`** (not IndexedDB).

| Key | Purpose |
|-----|---------|
| `fincoach-session-last-activity` | Unix timestamp (ms) of last user interaction |
| `fincoach-trusted-device` | `"true"` disables the wipe entirely |

**Inspect the timer in the browser console:**

```js
const last = +localStorage.getItem('fincoach-session-last-activity');
const idleMin = ((Date.now() - last) / 60000).toFixed(1);
const expiresMin = ((6 * 60 * 60 * 1000 - (Date.now() - last)) / 60000).toFixed(1);
console.log(`Last activity : ${new Date(last).toLocaleString()}`);
console.log(`Idle for      : ${idleMin} min`);
console.log(`Expires in    : ${expiresMin} min`);
console.log(`Trusted device: ${localStorage.getItem('fincoach-trusted-device')}`);
```

**Useful test shortcuts:**

```js
// Reset timer to now (simulate user just touched the app)
localStorage.setItem('fincoach-session-last-activity', Date.now().toString());

// Force immediate expiry on next 1-minute check
localStorage.setItem('fincoach-session-last-activity', '1');

// Disable the wipe for this device
localStorage.setItem('fincoach-trusted-device', 'true');

// Re-enable the wipe
localStorage.removeItem('fincoach-trusted-device');
```

**How it works (`main.js`):**
1. On **boot** — if idle > 6 h, `DB.wipeSession()` runs before the DB loads.
2. Every **1 minute** via `setInterval` — same check while the app is open.
3. Activity events (`click`, `keydown`, `touchstart`, `scroll`) update the key automatically.
4. A **warning toast** fires at 5 h 30 min of idle (30 min before expiry).

## Agent Roles

- **Developer agent**: Implements code + writes **unit tests**. In fix mode, checks assigned plane.so work items for open bugs. Runs lint and unit tests before reporting.
- **Tester agent**: Writes **functional, integration, UI, and E2E tests**. MUST write E2E tests for any UI/route changes. Creates plane.so work items for implementation bugs. Runs full test suite and ensures zero regressions. **After every feature/fix, updates agent files** (features-map, tester.agent.md, AGENTS.md, CLAUDE.md) to reflect the current project state.
- **Orchestrator agent**: Coordinates the workflow including the **bug-fix loop** (max 2 iterations). When delegating to the tester, specifies which test types are expected (E2E for UI changes, integration for API wiring, functional for new modules). Checks plane.so work items after testing. Escalates to user if bugs persist after 2 loops.

## Reading Plane.so Tickets — Always Check Comments

When fetching a work item from Plane.so (for requirements, bug status, or duplicate checks), also fetch its **comments**. Comments frequently contain accepted-risk decisions, duplicate markers, resolution notes, or status rationale that is not in the description field.

## Security Issue Tracking

Whenever any agent (tester, orchestrator, or developer) identifies a security vulnerability or compliance concern:

1. **Check for duplicates first** — filter Plane.so work items with the `security` label and state ≠ Done.
2. **Create a new work item** if not already tracked, with:
   - The **`security`** label applied (color `#EB144C`)
   - Priority matching the severity: `critical/high` → High, `medium` → Medium, `low` → Low
   - State: Backlog
3. **Title format**: `SEC-<SEVERITY>-<N>: <Short description>` (e.g., `SEC-HIGH-1: Gemini API key in URL`)
4. **Description** must include: affected file(s) and line numbers, expected vs actual behavior, OWASP category, and suggested fix.

**Rule**: Only the tester agent creates Plane.so work items (including security ones). The developer and orchestrator read but do not create work items.
