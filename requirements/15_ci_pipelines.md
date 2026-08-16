# Feature: CI Pipelines with GitHub Actions

## Goal

Streamline development by enforcing quality gates through automated CI pipelines on GitHub
Actions, protecting the `main` branch from direct pushes and unverified merges.

## Workflow Overview

```
feature-branch  →  Draft PR opened / commit pushed  →  [CI: Lint + Unit Tests]
                →  Mark ready for review            →  [CI: E2E Tests]
                →  Required checks pass             →  Merge into main
```

## Scope

### 1. Branch Protection on `main`

Configure the following rules for `main` via GitHub repository settings
(**Settings → Rules → Rulesets**, or the repository's equivalent branch-protection settings):

| Rule | Setting |
|------|---------|
| Require a pull request before merging | ✅ Enabled |
| Require status checks to pass before merging | ✅ Enabled |
| Required status checks | `lint-and-unit-tests`, `e2e-tests` |
| Require branches to be up to date before merging | ✅ Enabled |
| Do not allow bypassing the above settings | ✅ Enabled (applies to admins too) |
| Restrict who can push to matching branches | Only via PR — no direct pushes |

> **Ready-for-review E2E:** For a draft PR targeting `main`, `e2e-tests` runs when the PR is
> marked ready for review. Start E2E manually with `workflow_dispatch` after later commits or
> for a normal non-draft PR. Require the `e2e-tests` status check to block merging until it passes.

---

### 2. Workflow 1 — PR Lint & Unit Tests (`ci-pr.yml`)

**File path:** `.github/workflows/ci-pr.yml`

**Purpose:** Fast feedback on every PR commit. Runs Biome linter and Vitest unit tests.

**Triggers:**
- `pull_request` targeting `main` on types:
- `opened` — when PR is first created
- `synchronize` — when new commits are pushed to the PR branch
- `reopened` — when a closed PR is reopened
- `workflow_dispatch` — for a manually requested run.

**Job: `lint-and-unit-tests`**

Steps:

1. **Checkout** — `actions/checkout@v4`
2. **Set up Node.js** — `actions/setup-node@v4`
   - `node-version: '22'` (LTS)
   - `cache: 'npm'` (cache `node_modules` by `package-lock.json` hash)
3. **Install dependencies** — `npm ci` (clean install, no lock-file mutation)
4. **Run linter** — `npx @biomejs/biome check static/js/`
   - **Do NOT use `--fix`** in CI — lint failures must be surfaced as errors, not silently fixed.
   - Exit code non-zero on any lint error fails the job.
5. **Run unit tests** — `npx vitest run`
   - Reporter: `verbose` for readable GitHub Actions log output.
6. **Upload test results** (on failure) — `actions/upload-artifact@v4`
   - Name: `unit-test-results`
   - Path: `test-results/` (Vitest output directory)
   - Retention: 7 days

**Timeout:** 10 minutes for the entire job.

**Environment variables needed:** None (unit tests are fully offline; no API keys required).

---

### 3. Workflow 2 — Pre-Merge E2E Tests (`ci-e2e.yml`)

**File path:** `.github/workflows/ci-e2e.yml`

**Purpose:** Full browser-based E2E test suite run before a PR merges into `main`.
It is ready-for-review-gated so routine PR events do not consume the E2E runner.

**Triggers:**
- `pull_request` targeting `main` on `ready_for_review` — the `e2e-tests` job runs when a draft
   PR is marked ready for review.
- `workflow_dispatch` — permits an explicit manual E2E run from the Actions tab.

After later commits, or for a normal non-draft PR, start E2E manually with `workflow_dispatch`.

**Concurrency:** Runs for the same PR share a workflow-level concurrency group. A later
ready-for-review event cancels queued or in-progress E2E runs for that PR. Manual dispatches use
`github.run_id` as a fallback group, so they neither cancel PR-triggered runs nor each other.

**Job: `e2e-tests`**

Steps:

1. **Checkout** — `actions/checkout@v4`
2. **Set up Node.js** — `actions/setup-node@v4`
   - `node-version: '22'`
   - `cache: 'npm'`
3. **Install dependencies** — `npm ci`
4. **Install Playwright browsers** — `npx playwright install chromium --with-deps`
   - Cache the Playwright browser binaries using `actions/cache@v4` keyed on
     `${{ runner.os }}-playwright-${{ hashFiles('package-lock.json') }}`.
   - Cache path: `~/.cache/ms-playwright`
5. **Start dev server** — `npx serve static -l 8111 --cors &`
   - Run in the background (`&`).
   - Wait for the server to be ready: `npx wait-on http://localhost:8111 --timeout 30000`
   - Add `wait-on` as a dev dependency: `npm install --save-dev wait-on`
6. **Run E2E tests** — `npx playwright test`
   - Reporter: `github` (native GitHub Actions annotations) + `html`
   - All spec files under `tests/e2e/js/` are run.
7. **Kill dev server** — `pkill -f "serve static"` (cleanup step, `if: always()`)
8. **Upload Playwright report** — `actions/upload-artifact@v4` (`if: always()`)
   - Name: `playwright-report`
   - Path: `playwright-report/`
   - Retention: 14 days

**Timeout:** 30 minutes for the entire job.

**Environment variables needed:** None (Playwright E2E tests use a local in-browser SQLite
DB; no external API calls are made during tests per `tests/e2e/js/fixtures.js`).

---

### 4. Files to Create

| File | Description |
|------|-------------|
| `.github/workflows/ci-pr.yml` | Workflow 1 — Lint + Unit Tests |
| `.github/workflows/ci-e2e.yml` | Workflow 2 — E2E Tests |

No changes to existing source files are required. The `wait-on` dev dependency must be added
to `package.json`.

---

### 5. Playwright Configuration Notes

The existing `playwright.config.js` must support GitHub Actions runners:

- Set `use.headless: true` (already default — confirm it is not overridden).
- Confirm `webServer` block is NOT configured in `playwright.config.js` (the workflow starts
  the server manually via `npx serve`). If a `webServer` block exists, remove it from the
  config and rely on the workflow step instead, or keep it and remove the manual server start
  from the workflow — pick one approach and document it.
- Set `retries: 2` in CI (via `process.env.CI` check) to reduce flakiness on shared runners.

---

## Dependencies

- `wait-on` npm dev dependency (for the E2E workflow server readiness check)
- GitHub repository `main` branch must exist before branch protection rules are applied

## Out of Scope

- Deployment pipeline (Cloudflare Pages deploy on merge to `main`) — separate requirement
- Secret scanning or SAST — separate security hardening task
- Coverage reporting or badges — can be added incrementally

## Acceptance Criteria

1. Direct pushes to `main` are blocked for all users including admins.
2. Every PR commit triggers `lint-and-unit-tests` within 2 minutes of push.
3. A PR with lint errors or failing unit tests cannot be merged.
4. Marking a draft PR ready for review triggers `e2e-tests`; PR opening, reopening, and
   synchronization do not.
5. `workflow_dispatch` starts E2E after later commits or for a normal non-draft PR.
6. The required `e2e-tests` status check blocks merging until it passes.
7. A later ready-for-review event cancels any queued or in-progress E2E run for the same PR.
8. `workflow_dispatch` can run either workflow manually; manual E2E runs retain the
   Playwright HTML report for 14 days.
9. Both workflows complete successfully for their respective events.
