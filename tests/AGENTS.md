# Tests — Agent Instructions

> **Scope**: This file applies to all files under `tests/`. It overrides the root `AGENTS.md`
> for any test-specific conventions. Root `AGENTS.md` still applies for workflow and safety rules.

## Test Infrastructure

```
tests/js/              # Vitest unit tests (run with: make test-unit)
  ai.test.js           # AI settings, provider config, model selection
  ai-integration.test.js  # AI.chat(), context building, API bridge wiring
  app.test.js          # render*() functions, modal logic, UI state
  bugs-integration.test.js  # Regression tests for known bugs
  db.test.js           # All DB CRUD, schema, persistence, migrations
  gdrive.test.js       # GDrive encrypt/decrypt, sync, upload/download
  gmail.test.js        # Gmail OAuth, email parsing, LLM extraction, dedup
  gmail-proxy.test.js  # Cloudflare Worker OAuth proxy
  main.test.js         # Session expiry logic
  theme.test.js        # Theme persistence and toggle
  utils.test.js        # maskPII() and shared helpers
  config.test.js       # GMAIL_PROXY_URL runtime resolution from env.js global

tests/e2e/js/          # Playwright E2E tests (run with: make test-e2e)
  accounts.spec.js     # Account management flows
  bills.spec.js        # Upcoming bills panel on Dashboard
  budgets.spec.js      # Budget tracking and alerts
  bugs.spec.js         # Regression scenarios
  chat.spec.js         # Chat interface, AI responses
  dashboard.spec.js    # Home screen display
  gdrive.spec.js       # Google Drive backup/restore/sync
  goals.spec.js        # Goal creation and tracking
  navigation.spec.js   # Route transitions, bottom nav
  onboarding.spec.js   # Onboarding wizard flow
  privacy.spec.js      # Privacy mode (blur amounts)
  pwa-smoke.spec.js    # PWA manifest, service worker
  reports.spec.js      # Reports screen charts
  settings.spec.js     # Settings UI, toggles, trusted device
  sync.spec.js         # Gmail sync screen, date-range validation
  taxonomy.spec.js     # Category/merchant/tag management
  transactions.spec.js # Add/edit/delete/filter transactions
  fixtures.js          # pwaPage fixture — fresh DB, app at :8082
```

## Commands

```bash
make test-unit                         # Run all Vitest unit tests
npx vitest run tests/js/x.test.js     # Run a specific unit test file
make test-e2e                          # Run all Playwright E2E tests
npx playwright test tests/e2e/js/x.spec.js  # Run a specific E2E spec
make lint                              # Lint test files too (biome checks tests/)
make clean-ports                       # Kill orphaned servers after E2E
```

## Unit Test Patterns (Vitest)

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('FeatureName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns expected result for valid input', () => {
    expect(myFn('valid')).toBe('expected');
  });

  it('handles null gracefully', () => {
    expect(myFn(null)).toBeNull();
  });
});
```

- One test file per module: `tests/js/<module>.test.js`
- Group related tests with `describe`
- Test happy path, edge cases (null/undefined/empty), error conditions
- Mock external services with `vi.mock` or `vi.spyOn`
- Keep tests deterministic — no random data, no timing dependencies

## E2E Test Patterns (Playwright)

```js
import { test, expect } from './fixtures.js';  // always from fixtures, not @playwright/test

test.describe('MyFeature', () => {
  test('page loads correctly', async ({ pwaPage }) => {
    await pwaPage.evaluate(() => { window.location.hash = '#/feature'; });
    await pwaPage.waitForTimeout(500);
    expect(await pwaPage.locator('.feature-container').isVisible()).toBe(true);
  });
});
```

- Import `{ test, expect }` from `./fixtures.js` — not from `@playwright/test` directly
- Use `pwaPage` fixture for tests needing a fresh DB
- Use `{ page }` directly for tests managing their own state
- One spec file per screen/feature

## Test Ownership

| Test Type | Who writes it | Location |
|-----------|--------------|---------|
| Unit tests | **Developer agent** | `tests/js/` |
| Integration, UI, E2E tests | **Tester agent** | `tests/js/` or `tests/e2e/js/` |

## What Must Be Tested After Each Change

| Change type | Required tests |
|-------------|---------------|
| New/modified `db.js` method | Unit test in `db.test.js` |
| New/modified `gmail.js` logic | Unit test in `gmail.test.js` + integration test for pipeline |
| New/modified `ai.js` | Unit test in `ai.test.js` |
| New/modified `api.js` bridge | Integration test verifying delegation wiring |
| New UI screen or route | E2E test in matching `*.spec.js` |
| Bug fix | Regression unit test proving the fix |

## Bug Logging (Tester Agent Only)

When tests reveal a production bug, create a work item in plane.so (via the `plane` subagent).

Only the tester creates plane.so bug work items. The developer reads but never creates them.

## Updating Agent Files (Tester Responsibility)

After every feature/fix, update these files to reflect the current state:

- `.github/instructions/features-map.instructions.md` — new routes, DB methods, API methods
- `.github/agents/tester.agent.md` — new test files
- `tests/AGENTS.md` (this file) — new test files or patterns
- `AGENTS.md` (root) — module table or workflow changes
- `CLAUDE.md` (root) — module reference or key rules

## Rules

- **Only modify `tests/`** — never touch `static/` production code
- Assertions must be specific — verify actual values, not just "no exception"
- All tests must pass before reporting: `make test-unit` + `make test-e2e`
- Zero regression tolerance — if a previously passing test breaks, fix it
