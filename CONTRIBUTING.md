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

1. Create a branch from `main`.
2. Make focused, minimal changes that follow the conventions above.
3. **Lint after every change:**
   ```bash
   make lint
   ```
4. **Add or update tests:**
   - Unit tests → `tests/js/<module>.test.js`
   - E2E / UI tests → `tests/e2e/js/<feature>.spec.js`
5. **Run the test suites and verify everything passes:**
   ```bash
   make test-unit   # Vitest unit tests
   make test-e2e    # Playwright E2E tests (required if you change UI/routes)
   make clean-ports # Kill orphaned dev/test servers afterwards
   ```
6. Ensure **no regressions** — every previously passing test must still pass.

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
5. Do **not** commit secrets, API keys, or `.env` files.
6. Do **not** add a bundler, build step, or runtime npm dependency.

## Reporting Bugs & Requesting Features

Open a GitHub issue with:

- **Bugs:** steps to reproduce, expected vs actual behaviour, browser/OS, and
  any console errors.
- **Features:** the problem you're trying to solve and your proposed approach.

## Security

Please do **not** open public issues for security vulnerabilities. Instead,
report them privately to the maintainer so they can be addressed before
disclosure.
