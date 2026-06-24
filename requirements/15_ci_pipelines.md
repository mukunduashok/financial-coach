# Feature: CI Pipelines with GitHub Actions

## Goal

Streamline development by enforcing quality gates through automated CI pipelines on GitHub
Actions, protecting the `main` branch from direct pushes and unverified merges.

## Workflow Overview

```
feature-branch  →  PR opened / commit pushed  →  [CI: Lint + Unit Tests]
                →  PR marked ready to merge   →  [CI: E2E Tests]
                →  All checks pass            →  Merge allowed into main
```

## Scope

### 1. Branch Protection Rules on `main`

Configure the following rules on the `main` branch via GitHub repository settings
(**Settings → Branches → Add branch protection rule** for `main`):

| Rule | Setting |
|------|---------|
| Require a pull request before merging | ✅ Enabled |
| Require approvals | 1 (at minimum) |
| Dismiss stale pull request approvals when new commits are pushed | ✅ Enabled |
| Require status checks to pass before merging | ✅ Enabled |
| Required status checks | `lint-and-unit-tests` (from Workflow 1) |
| Require branches to be up to date before merging | ✅ Enabled |
| Do not allow bypassing the above settings | ✅ Enabled (applies to admins too) |
| Restrict who can push to matching branches | Only via PR — no direct pushes |

> **Note on E2E gate:** The E2E workflow (Workflow 2) is a label-triggered on-demand check.
> It is NOT listed as a required status check in branch protection because it is expensive
> and only needs to pass once before the final merge. Developers trigger it manually by
> applying the `run-e2e` label. The merge is blocked until the `e2e-tests` check passes
> **after** the label is applied (enforce via `required status checks: e2e-tests` only when
> the label is present — see Workflow 2 notes below). Alternatively, require it as an
> optional advisory check that must be run before the PR author clicks Merge.

---

### 2. Workflow 1 — PR Lint & Unit Tests (`ci-pr.yml`)

**File path:** `.github/workflows/ci-pr.yml`

**Purpose:** Fast feedback on every PR commit. Runs Biome linter and Vitest unit tests.

**Trigger:** `pull_request` event targeting `main` on types:
- `opened` — when PR is first created
- `synchronize` — when new commits are pushed to the PR branch
- `reopened` — when a closed PR is reopened

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
This is triggered on-demand when the developer signals the PR is ready to merge.

**Trigger:** `pull_request` event targeting `main` on type:
- `labeled` — fires when any label is added to the PR.
  - Gate the job with: `if: github.event.label.name == 'run-e2e'`

**Alternative / complementary trigger:**
- `pull_request` type `ready_for_review` (fires when a draft PR is converted to ready).
  - Use this in addition to the label trigger so that converting from draft also kicks off E2E.

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

### 4. Label Convention

| Label name | Color | Purpose |
|------------|-------|---------|
| `run-e2e` | `#e4c2f7` (purple) | Triggers Workflow 2 on a PR |

Create this label in GitHub (**Issues → Labels → New label**) before using the workflow.

---

### 5. Files to Create

| File | Description |
|------|-------------|
| `.github/workflows/ci-pr.yml` | Workflow 1 — Lint + Unit Tests |
| `.github/workflows/ci-e2e.yml` | Workflow 2 — E2E Tests |

No changes to existing source files are required. The `wait-on` dev dependency must be added
to `package.json`.

---

### 6. Playwright Configuration Notes

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
- The `run-e2e` label must be created in the GitHub repository

## Out of Scope

- Deployment pipeline (Cloudflare Pages deploy on merge to `main`) — separate requirement
- Secret scanning or SAST — separate security hardening task
- Coverage reporting or badges — can be added incrementally

## Acceptance Criteria

1. Direct pushes to `main` are blocked for all users including admins.
2. Every PR commit triggers `lint-and-unit-tests` within 2 minutes of push.
3. A PR with lint errors or failing unit tests cannot be merged.
4. Applying the `run-e2e` label to a PR triggers the full Playwright suite.
5. The Playwright HTML report is available as a downloadable artifact for 14 days.
6. Both workflows complete successfully on a clean feature branch with no source changes.
