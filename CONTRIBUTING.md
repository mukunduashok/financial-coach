# Contributing to Financial Coach

Thanks for your interest in contributing! This is a local-first, zero-backend
financial coaching PWA built with **vanilla JS, ES Modules, and no build step**.
Please read this guide before opening a pull request.

## Code of Conduct

Be respectful and constructive. Assume good intent, keep discussions focused on
the code, and help keep the project welcoming for everyone.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (dev tooling only — not required at runtime)
- A modern browser (Chrome, Firefox, Safari, Edge)

### Setup

```bash
git clone https://github.com/<your-fork>/financial-coach.git
cd financial-coach
make sync        # Install dev dependencies (Biome, Vitest, Playwright)
make dev         # Serve the app at http://localhost:8111
```

See [README.md](README.md) for self-hosting and Gmail/Drive setup details.

## Project Conventions

- **Vanilla JS + ES Modules** (`import`/`export`, `<script type="module">`).
- **No build step, no bundler, no framework, no runtime npm dependencies.**
- CDN globals (`Chart`, `marked`, `DOMPurify`) are loaded via `<script>` tags in
  `index.html` — they are **not** importable as ES modules.
- Every DB write method must `await this._persist()` to IndexedDB.
- Event handling uses **`data-action` attribute delegation** in `app.js` — not
  inline `onclick` bindings. Functions referenced from HTML templates must be
  exposed on `window` via `Object.assign(window, { ... })`.
- Indian Rupee (₹) is the currency throughout.
- Follow the module responsibilities documented in
  [.github/copilot-instructions.md](.github/copilot-instructions.md) and
  [AGENTS.md](AGENTS.md).

### Style

- Formatter/linter: **Biome** — 100-char lines, tab indentation, double quotes.
- Use named constants instead of magic values.
- Use `async`/`await` for all I/O.
- Keep functions small and focused; follow DRY/SOLID.

## Branch Naming

Use short, descriptive, kebab-case branches prefixed by type:

| Prefix | Use for |
|--------|---------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `test/` | Test-only changes |
| `chore/` | Tooling, deps, housekeeping |

Examples: `feat/cash-flow-forecast`, `fix/gmail-dedup-sip`.

## Development Workflow

1. Do not implement, commit, or push directly on `main`.
2. Before work begins, choose whether to create a new branch from the latest `main` or use an existing branch.
3. For a new branch, fetch `origin/main`, fast-forward local `main`, then create and switch to a descriptive branch. For an existing branch, safely switch to it without overwriting local work.
4. Confirm the active branch is not `main`, then make focused, minimal changes that follow the conventions above.
5. **Lint after every change:**
   ```bash
   make lint
   ```
6. **Add or update tests:**
   - Unit tests → `tests/js/<module>.test.js`
   - E2E / UI tests → `tests/e2e/js/<feature>.spec.js`
7. **Run the test suites and verify everything passes on the same branch:**
   ```bash
   make test-unit   # Vitest unit tests
   make test-e2e    # Playwright E2E tests (required if you change UI/routes)
   make clean-ports # Kill orphaned dev/test servers afterwards
   ```
8. Ensure **no regressions** — every previously passing test must still pass.

### Required test coverage

- UI screens or routes changed (`app.js`, `index.html`, CSS) → add **E2E tests**.
- API bridge methods changed (`api.js`) → add **integration tests**.
- JS modules changed (`ai.js`, `db.js`, `gmail.js`, `gdrive.js`) → add
  **functional tests**.

## Pull Request Process

1. Confirm `make lint`, `make test-unit`, and (when relevant) `make test-e2e`
   all pass locally.
2. Keep PRs small and scoped to a single concern.
3. Write a clear description: what changed, why, and how it was tested.
4. Link any related issues.
5. Lint and unit checks run on PR commits. E2E starts only when a reviewer submits an approval
   for a PR targeting `main`, or when manually started with `workflow_dispatch`; opening,
   reopening, synchronization, requesting a review, and re-requesting a review do not start it.
   New commits dismiss stale approvals, so obtain a fresh approval for a fresh required
   `e2e-tests` check before merging. The required E2E check blocks the merge. A newer approved
   review cancels queued or in-progress E2E for that PR; manual E2E runs have separate groups and
   do not cancel review-triggered or other manual runs. This repository does not use a merge queue.
6. Do **not** commit secrets, API keys, or `.env` files.
7. Do **not** add a bundler, build step, or runtime npm dependency.

## Reporting Bugs & Requesting Features

Open a GitHub issue with:

- **Bugs:** steps to reproduce, expected vs actual behaviour, browser/OS, and
  any console errors.
- **Features:** the problem you're trying to solve and your proposed approach.

## Security

Please do **not** open public issues for security vulnerabilities. Instead,
report them privately to the maintainer so they can be addressed before
disclosure.
