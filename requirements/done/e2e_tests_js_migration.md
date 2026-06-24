# Requirement 16: Migrate E2E Tests from Python Playwright to JavaScript Playwright

## Overview

The project currently runs end-to-end (E2E) browser tests using **Python Playwright** (`pytest-playwright`). The production application is a Vanilla JS PWA with no Python backend at runtime. Running E2E tests in Python creates an unnecessary cross-language dependency: the test runner is Python/pytest while the app under test is pure JavaScript.

This requirement migrates all E2E tests to **JavaScript Playwright** (`@playwright/test`), which is already listed as a dev dependency in `package.json`. The Python Playwright toolchain is then removed entirely.

---

## Goals

1. Convert all 11 Python Playwright E2E test files to JavaScript Playwright test files.
2. Ensure full test coverage parity — every test case that exists in Python is re-implemented in JS.
3. Replace the Python-based `make test-e2e` target with a JS Playwright invocation.
4. Remove `pytest-playwright` and related Python E2E infrastructure.
5. Validate that all migrated tests pass after migration.

---

## Current State

### Python E2E test suite (`tests/e2e/`)

| File | Test Classes / Key Scenarios |
|---|---|
| `conftest.py` | Shared fixtures: starts a static file server on `:8082`, provides `pwa_page` (Playwright `Page` with clean IndexedDB) |
| `test_pwa_smoke.py` | App loading, DB init, seed categories, nav renders, theme toggle, spinner |
| `test_navigation.py` | SPA routing, nav links, theme toggle, responsive viewport, nav restructure |
| `test_dashboard.py` | Dashboard loads, shows totals, income/expense widgets, empty state |
| `test_transactions_ui.py` | Transaction list, add transaction form, filter/search, pagination |
| `test_accounts_ui.py` | Account list, create account modal, balance display, account types |
| `test_budgets_ui.py` | Budget list, create/edit budget, progress bars |
| `test_goals_ui.py` | Goals list, create goal, progress display |
| `test_reports_ui.py` | Reports screen, charts render, date range filter |
| `test_chat_ui.py` | Chat screen loads, message input, AI provider badge |
| `test_settings_ui.py` | Provider dropdown, API key input, model dropdown, save/test buttons |
| `test_taxonomy_ui.py` | Category list, merchant list, seed data, CRUD modals |

### Python dependencies (to be removed)

```toml
# pyproject.toml [project.optional-dependencies] test
"pytest-playwright>=0.7.0"
```

System package: `uv run playwright install chromium` (called in `make sync`)

### JS Playwright (already present)

```json
// package.json devDependencies
"@playwright/test": "^1.52.0"

// package.json scripts
"test:e2e": "npx playwright test"
```

A `playwright.config.js` file does **not yet exist** — it must be created.

---

## Target State

### New JS E2E test suite (`tests/e2e/js/`)

Each Python test file maps 1:1 to a JS file:

| Python source | JS target |
|---|---|
| `conftest.py` | `playwright.config.js` (root) + `tests/e2e/js/fixtures.js` |
| `test_pwa_smoke.js` | `tests/e2e/js/pwa-smoke.spec.js` |
| `test_navigation.js` | `tests/e2e/js/navigation.spec.js` |
| `test_dashboard.js` | `tests/e2e/js/dashboard.spec.js` |
| `test_transactions_ui.js` | `tests/e2e/js/transactions.spec.js` |
| `test_accounts_ui.js` | `tests/e2e/js/accounts.spec.js` |
| `test_budgets_ui.js` | `tests/e2e/js/budgets.spec.js` |
| `test_goals_ui.js` | `tests/e2e/js/goals.spec.js` |
| `test_reports_ui.js` | `tests/e2e/js/reports.spec.js` |
| `test_chat_ui.js` | `tests/e2e/js/chat.spec.js` |
| `test_settings_ui.js` | `tests/e2e/js/settings.spec.js` |
| `test_taxonomy_ui.js` | `tests/e2e/js/taxonomy.spec.js` |

### Updated `make test-e2e`

```makefile
test-e2e: clean-ports
	npx playwright test
```

---

## Implementation Plan

### Step 1 — Create `playwright.config.js`

Create a Playwright config at the project root (`playwright.config.js`) that:

- Sets `testDir` to `tests/e2e/js/`
- Uses `chromium` only (matching current Python test invocation `--browser chromium`)
- Starts the static file server (`npx serve static -l 8082 --cors`) as a `webServer` block on port `8082`
- Sets `baseURL` to `http://127.0.0.1:8082`
- Sets a reasonable `timeout` (30 s) and `expect` timeout (10 s)
- Disables retries in CI (or sets 1 retry for flakiness)
- Outputs results to `test-results/` (already gitignored pattern)

```js
// playwright.config.js (example)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e/js',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:8082',
    browserName: 'chromium',
    headless: true,
  },
  webServer: {
    command: 'npx serve static -l 8082 --cors',
    port: 8082,
    reuseExistingServer: !process.env.CI,
  },
});
```

### Step 2 — Create `tests/e2e/js/fixtures.js`

Translate `conftest.py` shared fixtures into a Playwright JS fixture file:

- Export a custom `test` object that extends `base` with a `pwaPage` fixture
- The `pwaPage` fixture navigates to `/`, waits for `.bottom-nav`, and clears IndexedDB between tests
- IndexedDB cleanup uses `page.evaluate(() => indexedDB.deleteDatabase('fincoach'))` before each test

```js
// tests/e2e/js/fixtures.js
import { test as base } from '@playwright/test';

export const test = base.extend({
  pwaPage: async ({ page }, use) => {
    // Clear previous IndexedDB state
    await page.goto('/');
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('fincoach');
        req.onsuccess = resolve;
        req.onerror = resolve;
      });
    });
    await page.reload();
    await page.waitForSelector('.bottom-nav', { timeout: 10_000 });
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

### Step 3 — Translate Python API → JS Playwright API

Key translation table:

| Python (`pytest-playwright`) | JavaScript (`@playwright/test`) |
|---|---|
| `pwa_page` fixture | `pwaPage` fixture from `fixtures.js` |
| `page.locator(sel)` | `page.locator(sel)` (same) |
| `page.evaluate("js")` | `page.evaluate(() => ...)` |
| `page.wait_for_timeout(ms)` | `page.waitForTimeout(ms)` |
| `page.wait_for_selector(sel, timeout=N)` | `page.waitForSelector(sel, { timeout: N })` |
| `page.wait_for_load_state("networkidle")` | `page.waitForLoadState('networkidle')` |
| `page.inner_text("body")` | `page.innerText('body')` |
| `page.content()` | `page.content()` (same) |
| `page.reload()` | `page.reload()` (same) |
| `page.set_viewport_size({w, h})` | `page.setViewportSize({ width, height })` |
| `page.title()` | `page.title()` (same) |
| `locator.is_visible()` | `await locator.isVisible()` |
| `locator.count()` | `await locator.count()` |
| `locator.inner_text()` | `await locator.innerText()` |
| `locator.get_attribute("x")` | `await locator.getAttribute('x')` |
| `locator.first.click()` | `await locator.first().click()` |
| `locator.nth(i).inner_text()` | `await locator.nth(i).innerText()` |
| `assert x == y` | `expect(x).toBe(y)` |
| `assert x in y` | `expect(y).toContain(x)` |
| `assert x > 0` | `expect(x).toBeGreaterThan(0)` |
| `@pytest.mark.parametrize(...)` | `for ... of [...] { test(...) }` or `test.each(...)` |
| `class TestFoo:` | `test.describe('TestFoo', () => { ... })` |
| `def test_foo(pwa_page):` | `test('foo', async ({ pwaPage }) => { ... })` |
| `pwa_page.on("pageerror", cb)` | `page.on('pageerror', cb)` (same) |

### Step 4 — Convert each test file (1:1 parity)

Convert each file following the mapping in the target state table. Each JS spec:

- Imports `{ test, expect }` from `./fixtures.js`
- Wraps related tests in `test.describe(...)` blocks matching Python class names
- Reproduces every individual `def test_*` as a `test(...)` call
- Uses `await` for all async Playwright calls
- Seeds data via `page.evaluate(async () => { await DB.createAccount(...); })` (same as Python, but properly `await`-ed)

### Step 5 — Update `Makefile`

```makefile
# Before
test-e2e: clean-ports
	uv run pytest tests/e2e/ -v -m e2e --browser chromium

# After
test-e2e: clean-ports
	npx playwright test
```

Also remove the Playwright install step from `make sync`:

```makefile
# Before
sync: sync-js
	uv sync
	uv run playwright install chromium

# After
sync: sync-js
	uv sync
	npx playwright install chromium
```

### Step 6 — Remove Python Playwright dependencies

1. Remove `pytest-playwright>=0.7.0` from `pyproject.toml` `[project.optional-dependencies] test`
2. Run `uv sync` to update the lock file
3. Delete the Python E2E test directory: `tests/e2e/`
4. Delete `tests/__init__.py` if it only existed for the e2e package (verify first)
5. Remove the `e2e` pytest marker from `pyproject.toml` `[tool.pytest.ini_options]`

### Step 7 — Validate

Run the full migrated JS test suite:

```bash
make clean-ports
make test-e2e
```

All tests must pass. Zero regressions in the existing `make test-js` suite.

---

## Side Effects & Mitigation

### SE-1: `conftest.py` static file server is replaced by `webServer` in Playwright config

**Effect**: The Python conftest started a `serve` subprocess and managed its lifecycle. Playwright's `webServer` block handles this natively for JS tests.

**Mitigation**: The `webServer` config in `playwright.config.js` is equivalent — it starts `npx serve static -l 8082 --cors` and waits for the port to be ready before running tests. No manual teardown is needed.

### SE-2: `tests/e2e/` directory deletion removes `__pycache__` and `__init__.py`

**Effect**: `tests/__init__.py` and `tests/e2e/__init__.py` may be referenced by pytest's test discovery.

**Mitigation**: After deleting `tests/e2e/`, verify that `make test-py` (Python unit tests) still discovers and runs correctly. If `tests/__init__.py` is used for unit test discovery, keep it. Only delete the e2e subdirectory.

### SE-3: Python `uv run pytest tests/e2e/` invocation will no longer work

**Effect**: Anyone invoking the old command manually will get a `no such directory` error.

**Mitigation**: Update `AGENTS.md` and `CLAUDE.md` reference tables to reflect `npx playwright test` as the e2e command. The `Makefile` target is the single source of truth.

### SE-4: `pytest-playwright` removal may affect `make test-py`

**Effect**: `pytest-playwright` is listed under `[project.optional-dependencies] test`. If `uv sync --extra test` was being used (i.e., pytest runs included this extra), its removal could affect the sync command.

**Mitigation**: Verify `make test-py` invocation in the Makefile does not use `--extra test`. In the current Makefile there is no `make test-py` target — Python unit tests are not relevant here since the project has fully migrated to the JS frontend. Confirm and document this.

### SE-5: `AGENTS.md` test ownership table references `tests/e2e/`

**Effect**: The AGENTS.md table `tests/e2e/` for E2E tests will point to a deleted directory.

**Mitigation**: Update the table to `tests/e2e/js/` and update the command from `make test-e2e` invocation description to reference JS Playwright.

### SE-6: `pytest-playwright` system browsers may still be installed

**Effect**: `uv run playwright install chromium` previously installed Playwright's Chromium binary for Python. After migration, `npx playwright install chromium` installs for Node. Both could coexist, wasting disk.

**Mitigation**: After migration, run `uv run playwright uninstall` (if supported) or manually remove `~/.cache/ms-playwright` binaries that are no longer needed. The `make sync` target uses `npx playwright install chromium` going forward.

### SE-7: CI/CD pipelines (if any) may reference Python Playwright commands

**Effect**: Any CI YAML files invoking `uv run pytest tests/e2e/` would break.

**Mitigation**: Audit `.github/workflows/` for any e2e test steps and update them. (No CI files exist in the current workspace, so this is a no-op for now but must be checked.)

---

## Cleanup Action Items

| # | Action | File(s) Affected | Priority |
|---|---|---|---|
| C-1 | Remove `pytest-playwright>=0.7.0` from `pyproject.toml` | `pyproject.toml` | High |
| C-2 | Remove `e2e` pytest marker from `pyproject.toml` | `pyproject.toml` | High |
| C-3 | Run `uv sync` to update lock file after dependency removal | `uv.lock` | High |
| C-4 | Delete `tests/e2e/` directory (all `.py` files + `__init__.py`) | `tests/e2e/` | High |
| C-5 | Update `make test-e2e` in `Makefile` to use `npx playwright test` | `Makefile` | High |
| C-6 | Update `make sync` in `Makefile` to use `npx playwright install chromium` | `Makefile` | High |
| C-7 | Update `AGENTS.md` test ownership table to point to `tests/e2e/js/` | `AGENTS.md` | Medium |
| C-8 | Update `CLAUDE.md` E2E test command references | `CLAUDE.md` | Medium |
| C-9 | Update `.github/copilot-instructions.md` test command table | `.github/copilot-instructions.md` | Medium |
| C-10 | Remove Python Playwright browser cache: `~/.cache/ms-playwright` (if separate from Node's) | System | Low |
| C-11 | Verify `make test-py` still works after e2e directory deletion | CI smoke | Low |

---

## Validation Checklist

After the migration is complete, all of the following must pass:

- [ ] `make test-e2e` runs `npx playwright test` (not `uv run pytest`)
- [ ] All 11 spec files in `tests/e2e/js/` are discovered and run by Playwright
- [ ] Total test count in JS is ≥ total test count in Python (no tests dropped)
- [ ] `make test-js` (Vitest unit tests) still passes — no regressions
- [ ] `make test` (= `test-js` + `test-e2e`) exits with code 0
- [ ] `make clean-ports` cleans up port 8082 after test run
- [ ] No Python `pytest` invocation is left in the Makefile
- [ ] `tests/e2e/` directory no longer exists
- [ ] `pytest-playwright` is no longer listed in `pyproject.toml`
- [ ] `playwright.config.js` exists at project root and is valid
- [ ] `tests/e2e/js/fixtures.js` exists with `pwaPage` fixture

---

## Files to Create

| File | Purpose |
|---|---|
| `playwright.config.js` | Playwright JS configuration (webServer, baseURL, testDir, browser) |
| `tests/e2e/js/fixtures.js` | Shared `pwaPage` fixture (replaces `conftest.py`) |
| `tests/e2e/js/pwa-smoke.spec.js` | Converts `test_pwa_smoke.py` |
| `tests/e2e/js/navigation.spec.js` | Converts `test_navigation.py` |
| `tests/e2e/js/dashboard.spec.js` | Converts `test_dashboard.py` |
| `tests/e2e/js/transactions.spec.js` | Converts `test_transactions_ui.py` |
| `tests/e2e/js/accounts.spec.js` | Converts `test_accounts_ui.py` |
| `tests/e2e/js/budgets.spec.js` | Converts `test_budgets_ui.py` |
| `tests/e2e/js/goals.spec.js` | Converts `test_goals_ui.py` |
| `tests/e2e/js/reports.spec.js` | Converts `test_reports_ui.py` |
| `tests/e2e/js/chat.spec.js` | Converts `test_chat_ui.py` |
| `tests/e2e/js/settings.spec.js` | Converts `test_settings_ui.py` |
| `tests/e2e/js/taxonomy.spec.js` | Converts `test_taxonomy_ui.py` |

## Files to Modify

| File | Change |
|---|---|
| `Makefile` | Replace `test-e2e` and `sync` targets |
| `pyproject.toml` | Remove `pytest-playwright`, remove `e2e` marker |
| `AGENTS.md` | Update test ownership table and e2e directory reference |
| `CLAUDE.md` | Update E2E command reference |
| `.github/copilot-instructions.md` | Update test command table |

## Files to Delete

| File/Directory | Reason |
|---|---|
| `tests/e2e/__init__.py` | No longer needed (Python package marker) |
| `tests/e2e/conftest.py` | Replaced by `playwright.config.js` + `fixtures.js` |
| `tests/e2e/test_pwa_smoke.py` | Replaced by JS spec |
| `tests/e2e/test_navigation.py` | Replaced by JS spec |
| `tests/e2e/test_dashboard.py` | Replaced by JS spec |
| `tests/e2e/test_transactions_ui.py` | Replaced by JS spec |
| `tests/e2e/test_accounts_ui.py` | Replaced by JS spec |
| `tests/e2e/test_budgets_ui.py` | Replaced by JS spec |
| `tests/e2e/test_goals_ui.py` | Replaced by JS spec |
| `tests/e2e/test_reports_ui.py` | Replaced by JS spec |
| `tests/e2e/test_chat_ui.py` | Replaced by JS spec |
| `tests/e2e/test_settings_ui.py` | Replaced by JS spec |
| `tests/e2e/test_taxonomy_ui.py` | Replaced by JS spec |

---

## Out of Scope

- Adding new test coverage beyond what exists in the Python suite
- Migrating Python unit tests (`tests/unit_tests/`) — those test the Python backend and are unaffected
- Changing the app's source code
- Setting up CI/CD pipelines (tracked separately)
