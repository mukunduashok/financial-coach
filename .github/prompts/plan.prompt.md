---
description: "Plans a feature or bug fix without implementing. Produces a structured implementation plan for review."
agent: "planner"
argument-hint: "Describe the feature/bugfix or paste requirements file path"
---

Create a detailed implementation plan for the following requirement:

${input}

Analyze the requirement against the Financial Coach codebase and produce a structured plan.

## Context

This project is a **Vanilla JS PWA** — `static/**`. There is no Python backend.

### Repository Layout

```
static/                  # JS frontend (production PWA)
  index.html             # SPA shell
  css/styles.css         # All styles
  js/
    main.js              # Entry point
    db.js                # Database — sql.js WASM + IndexedDB
    ai.js                # AI — LLM REST calls
    api.js               # API bridge
    app.js               # UI — render functions, Router
    gmail.js             # Gmail OAuth
    gdrive.js            # Google Drive backup
    config.js            # Constants
    utils.js             # Shared helpers
tests/
  js/                    # Vitest unit tests
  e2e/js/                # Playwright E2E tests
```

### CDN Globals (loaded as plain `<script>` tags)

- `Chart` (Chart.js) — all charts
- `marked` — Markdown parser
- `DOMPurify` — HTML sanitizer

**These cannot be imported as ES modules — access via `window.*`**.

## Planning Steps

1. **Read the requirement** carefully. Identify:
   - What feature/bug is being fixed
   - Which screens are affected
   - Database changes needed
   - API bridge methods needed
   - UI components to add

2. **Explore the codebase**:
   - Look at similar features in `static/js/app.js`
   - Check database schema in `db.js`
   - Review API bridge patterns in `api.js`
   - Study existing test patterns

3. **Produce the plan** below.

## Output Format

```markdown
# Implementation Plan: {Feature/bug title}

## Summary
{1-2 sentence overview of what will be implemented}

## Requirement Analysis
{Key points, ambiguities, affected files}

## Changes

### Database (`static/js/db.js`)
- {New tables, methods, schema changes}
- Note: Every write method must call `await this._persist()`

### API Bridge (`static/js/api.js`)
- {New bridge functions — delegates only, no logic}

### UI (`static/js/app.js`)
- {New render*() functions, Router routes, data-action handlers}

### Entry Point / Config (`static/js/main.js` or `config.js`)
- {Bootstrap changes or new localStorage keys, if needed}

### Tests

#### Unit Tests (`tests/js/`)
- {Test files and what they test}

#### E2E Tests (`tests/e2e/js/`)
- {Spec files and scenarios — required if UI/routes change}

## Files to Create / Modify

| Action | File | Description |
|--------|-------|-------------|
| CREATE | `static/js/x.js` | New module for X |
| MODIFY | `static/js/db.js` | Add X table and methods |
| CREATE | `tests/js/x.test.js` | Unit tests for X |

## Implementation Order
1. {Step 1 — what to implement first and why}
2. {Step 2}

## Risks & Notes
- {Any potential issues, breaking changes, or things to watch out for}
```
