# Agent Behavior & Workflow

This file defines how AI agents should behave when working autonomously on this repository.
For project context, coding standards, and build commands, see `.github/copilot-instructions.md`.

## Scoped AGENTS.md Files

This repository uses **subfolder AGENTS.md files** following the OpenAI Codex convention:
more-deeply-nested files take precedence over this root file for their scope.

| File | Scope | What it covers |
|------|-------|---------------|
| `AGENTS.md` (this file) | Entire repo | Workflow, agent roles, safety, commands |
| [`static/AGENTS.md`](static/AGENTS.md) | `static/**` | JS coding rules, module map, dedup logic, CDN globals |
| [`tests/AGENTS.md`](tests/AGENTS.md) | `tests/**` | Test patterns, file inventory, bug logging, agent file updates |
| [`cloudflare-worker/AGENTS.md`](cloudflare-worker/AGENTS.md) | `cloudflare-worker/**` | Worker endpoints, secrets, wrangler commands |

**Always read the most specific AGENTS.md for the file you are working on.**

## Operational Boundaries

### Allowed Commands

**JavaScript frontend:**
```bash
make sync          # Install JS dev deps (npm install)
make dev              # Serve static files on :8111
make lint          # Format + lint JS (biome)
make test-unit          # JS unit tests (vitest)
make test-e2e         # Playwright E2E tests
make deploy           # Deploy to Cloudflare Pages
npx @biomejs/biome check --fix static/js/  # Lint + format JS
npx vitest run        # Run JS tests
npx playwright test   # Run E2E tests
```

**Combined:**
```bash
make sync             # Install all dependencies
make lint             # Lint JS
make test             # Run all tests (unit + E2E)
make clean-ports      # Kill orphaned servers on dev/test ports (8111, 8082)
```

### Forbidden Actions

- Never commit `.env`, secrets, or API keys
- Never add dependencies without adding them to `package.json`
- Never push code without running the appropriate lint and test commands
- Never add runtime npm dependencies — the JS app has zero runtime deps
- Never add a bundler or build step to the frontend

### Safety Rules

- Prefer small, focused changes over large refactors
- Do not delete files or branches without confirmation
- Do not modify `.env` or production configuration
- Always run `make clean-ports` after running dev servers (`make dev`) or E2E tests (`make test-e2e`) to kill orphaned processes

## Agent Roles & Responsibilities

This project uses three specialized agents coordinated by an orchestrator:

### Developer Agent
- Implements features, fixes bugs, and writes **unit tests** for the code it produces
- After every code change, MUST:
  1. Run the linter (`make lint`)
  2. Write unit tests covering the change (`tests/js/` for JS)
  3. Run unit tests (`make test-unit`) and verify all pass
  4. Fix any lint errors or test failures before reporting completion
- Does NOT write functional, integration, or E2E tests — the tester agent handles those
- **Fix mode** (invoked by orchestrator during bug-fix loop):
  1. Check assigned plane.so work items for open bugs for the current task
  2. Fix each bug, following the same lint → test → verify workflow
  3. Do NOT create plane.so work items — the tester agent handles bug reporting
  4. Report which bugs were addressed in the completion summary

### Tester Agent
- Writes **functional tests** (module-level), **integration tests** (backend API), **UI tests**, and **E2E tests**
- **Mandatory test types per change:**
  - If the change adds/modifies **UI screens or routes** (`app.js`, `index.html`, CSS) → MUST write **E2E tests** in `tests/e2e/js/`
  - If the change adds/modifies **API bridge methods** (`api.js`) → MUST write **integration tests** verifying the wiring
  - If the change adds/modifies **JS modules** (`ai.js`, `db.js`, `gmail.js`) → MUST write **functional tests** verifying module behavior beyond unit tests
  - Always check what existing E2E tests cover and add tests for any new screens, routes, or user flows
- After writing tests, MUST:
  1. Run the linter (`make lint`)
  2. Run the test suite and verify all tests pass:
     - JS changes: `make test-unit` + `make test-e2e` (PWA smoke tests)
  3. Check for regressions — no previously passing test should break
  4. Fix any failing tests before reporting completion
- When tests reveal bugs in the implementation (not in the tests themselves), MUST:
  1. Create a plane.so work item for each bug (see **Bug Report Format** below)
  2. Include the bug count and summary in the completion report to the orchestrator
- Do NOT fix implementation bugs — only log them and report to the orchestrator
- During re-verification (fix loop), update bug status in the plane.so work item:
  - Move the plane.so work item to Done for fixed bugs
  - Leave the plane.so work item open and add a comment for bugs that persist
- Test locations:
  - E2E / PWA smoke tests → `tests/e2e/js/`

### Orchestrator Agent
- Coordinates Plan → Approve → Implement → Test → **Fix Loop** workflow
- Delegates code changes to the developer agent and testing to the tester agent
- **When delegating to the tester**, MUST specify which test types are expected based on the changes:
  - UI changes (new screens, routes, nav items) → request **E2E tests** in `tests/e2e/js/`
  - New JS modules → request **functional/integration tests**
  - API wiring changes → request **integration tests** verifying the bridge
  - Include the developer's file list so the tester knows what changed
- After tester reports completion, checks plane.so for any open bugs
- If open bugs exist, initiates the **Bug-Fix Loop**:
  1. Delegates open bugs to the developer agent (fix mode)
  2. After developer fixes, delegates back to tester for re-verification
  3. **Maximum 2 fix iterations** — if bugs persist after 2 loops, stops and reports to the user for manual intervention
- Tracks the current iteration count and includes it when delegating (e.g., "Fix iteration 1 of 2")
- Ensures no regressions remain before marking a task complete

## Development Workflow

Follow this sequence for every code change:

1. **Understand** — Read relevant source files before modifying
2. **Identify stack** — Check which files are affected:
   - `static/**`, `tests/js/**`, `tests/e2e/js/**` → JS stack
3. **Implement** — Make minimal changes following project standards
4. **Lint** — Run the linter **immediately after every change**:
   - JS: `make lint`
5. **Write tests** — Add/update tests in the appropriate location:
   - Developer agent: unit tests (`tests/js/`)
   - Tester agent: functional, UI, E2E tests (`tests/e2e/js/`)
6. **Run tests** — Run the correct tests and **verify all pass**:
   - JS: `make test-unit`
7. **Regression check** — Ensure no previously passing tests are now failing
8. **Smoke test** — Verify the change works:
   - JS: `make dev` → open browser, check console
9. **Bug logging** (tester only) — Create a plane.so work item for any implementation bugs found (see Bug Report Format below)
10. **Fix loop** (orchestrator) — If there are open plane.so bugs, delegate fix → re-verify (max 2 iterations)
11. **Report** — Summarize what changed, what was tested, and any unresolved bugs

### Bug-Fix Feedback Loop

When the tester finds implementation bugs, the orchestrator manages a fix loop:

```
Tester finds bugs → creates plane.so work items → reports to Orchestrator
    ↓
Orchestrator reads plane.so work items → delegates to Developer (fix mode)
    ↓
Developer fixes bugs → reports to Orchestrator
    ↓
Orchestrator delegates to Tester (re-verification)
    ↓
Tester re-verifies → updates plane.so work item statuses → reports to Orchestrator
    ↓
If open bugs remain AND iteration < 2 → loop back to Developer
If open bugs remain AND iteration = 2 → Orchestrator escalates to user
If no open bugs → Orchestrator marks task complete
```

**Rules:**
- Maximum **2 fix iterations** per task. After 2 loops, the orchestrator MUST stop and report remaining bugs to the user.
- Each iteration includes: developer fix + tester re-verification (both count as 1 iteration).
- The orchestrator tracks iteration count and communicates it to both agents.
- Bugs from different tasks are independent — iteration count does not carry over.

### Bug Report Format (plane.so)

Each plane.so work item MUST follow this format:

```markdown
## BUG: {Short descriptive title}

- **Task**: {Feature or task name that introduced the bug}
- **Severity**: high | medium | low
- **Iteration**: {Which fix iteration, if in a loop — omit for initial filing}
- **Filed by**: tester
- **File(s)**: {Affected file paths}

**Description**: {What is broken — expected vs actual behavior}

**Reproduction**: {Steps or test name that demonstrates the bug}

**Suggested fix**: {Optional — tester's suggestion for how to fix}
```

**Rules for plane.so work items:**
- Only the **tester agent** creates bug work items in plane.so (via the `plane` subagent)
- The **developer agent** reads but does NOT create plane.so work items
- The **orchestrator** reads plane.so work items to determine loop state
- Move resolved items to Done (for history) — do not delete them

### When Working on JavaScript (`static/**`)

- All files use ES Modules (`import`/`export`)
- New DB methods → add to `static/js/db.js`, call `await this._persist()` after writes
- New API methods → add bridge in `static/js/api.js`, delegate to `DB.*` or `AI.*`
- New AI features → add to `static/js/ai.js`
- New Google Drive features → add to `static/js/gdrive.js`
- New Gmail features → add to `static/js/gmail.js`
- New UI screen → add `render*()` in `static/js/app.js`, register route in Router
- New test file → `tests/js/<module>.test.js`
- Functions referenced from `onclick=""` in HTML → add to `Object.assign(window, {...})` at bottom of `app.js`
- Event handling uses **data-action** attributes on HTML elements, delegated in `app.js`
- CDN globals (Chart, marked, DOMPurify) are loaded via `<script>` in `index.html` — not importable as ES modules

### Module Responsibilities

| Module | Purpose |
|--------|---------|
| `main.js` | Entry point — session expiry check, DB.init(), dispatches `db-ready` event |
| `db.js` | SQLite WASM + IndexedDB persistence, full schema, all CRUD methods. Multi-device-safe `mergeFromJSON` (UNION + LWW + tombstones), `loadSampleData()` demo dataset |
| `ai.js` | AI provider REST calls (Groq/OpenAI/Gemini/Azure/Ollama), prompt templates |
| `api.js` | Thin bridge — delegates to `DB.*` / `AI.*` / `Gmail.*`. No business logic |
| `app.js` | SPA router (Router), all `render*()` screen functions, event delegation |
| `gmail.js` | Gmail OAuth connect, email fetch, LLM-based transaction extraction, SIP-safe deduplication |
| `gdrive.js` | Google Drive encrypted backup/restore/sync (AES-GCM + PBKDF2) |
| `config.js` | App-level constants, all `localStorage` key names |
| `utils.js` | Shared helpers: `maskPII()` for AI prompts |
| `sw.js` | Service worker — offline cache strategy |
| `theme-init.js` | Runs before DOMContentLoaded to prevent theme flash |
| `theme-apply.js` | Applies saved theme from localStorage |

#### Gmail Transaction Deduplication

Two deduplication layers in `gmail.js._importTransaction()`:
1. **Layer 1** — `processed_gmail_messages` table (checked before email fetch). Gmail IDs already recorded are skipped.
2. **Layer 2** — date + amount + account_id field check. **Only applied to non-Gmail transactions** (no `gmail_message_id`). This allows multiple legitimate same-day/same-amount emails (e.g., 3 SIP debits) to all be imported.

DB `transaction_id` for Gmail rows is always `"gmail_<gmail_message_id>"` to avoid UNIQUE constraint collisions from shared bank references.

#### Edit Transaction Modal — Notes Field

- **Gmail transactions**: `#edit-desc` starts empty; LLM-extracted `description` is shown as placeholder text. Saving with an empty Notes field preserves the original `description` in the DB.
- **Manual transactions**: `#edit-desc` is pre-filled with `description` value as before.

### When Modifying Existing Code

- Read the file and its tests first
- Preserve existing patterns and conventions
- Update tests to cover the change
- Do not refactor unrelated code

## Testing Expectations

### Test Ownership

| Test Type | Owner | Location | Command |
|-----------|-------|----------|---------|
| Unit tests (JS) | Developer agent | `tests/js/` | `make test-unit` |
| E2E / UI tests | Tester agent | `tests/e2e/js/` | `make test-e2e` |

### Mandatory Post-Change Checks

Every agent MUST run these after making changes — **no exceptions**.

```bash
# After JS changes (static/**, tests/js/**):
make lint          # Fix lint errors before anything else
make test-unit          # Unit tests must pass
make test-e2e         # E2E tests must pass (if UI/routes changed)
make clean-ports      # Kill any orphaned servers left by tests/dev
make dev              # Smoke-test: app loads at http://localhost:8111, no console errors
```

### Test Organization

- One test file per module: `<module>.test.js`
- Group related tests with `describe`: `describe('<Feature>', () => { ... })`
- Descriptive names: `test('<feature> <scenario>', async () => { ... })`

### Test Patterns

- Use `test.each(...)` or `for...of` loops for multiple scenarios
- Mock external services (AI providers via `vi.mock`)
- Test happy path, edge cases, and error conditions

**Zero tolerance for regressions** — if a previously passing test now fails, fix it before reporting completion.

## When to Stop and Ask

- Ambiguous requirements with multiple valid interpretations
- Changes that would affect database schema
- Changes requiring new external dependencies
- Destructive operations (deleting files, dropping tables)
- Security-sensitive changes (auth, secrets handling)