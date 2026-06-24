# Architecture & Design Analysis

_Analysed: May 2026_

## Current Design

### Module Map

```
index.html
  └── CDN globals (Chart.js, marked, DOMPurify) — plain <script>
  └── sql-wasm.js (vendored WASM loader)
  └── main.js (ES module entry)
        ├── db.js      — SQLite WASM + IndexedDB (2,541 lines)
        ├── ai.js      — LLM REST calls (935 lines)
        ├── api.js     — thin bridge (223 lines)
        ├── app.js     — Router + ALL screens + ALL handlers (5,184 lines)
        ├── gmail.js   — OAuth + email extraction (1,262 lines)
        └── gdrive.js  — Drive sync (354 lines)
```

### What Works Well

| Strength | Why it matters |
|---|---|
| Zero runtime deps | Ships as static files, no supply chain risk |
| SQLite WASM in-browser | Full relational queries, complex aggregations, schema migrations |
| Local-first + IndexedDB persistence | Privacy by default, works offline |
| Data-action event delegation | No event listener leaks on re-renders |
| API bridge layer (`api.js`) | Keeps `app.js` decoupled from storage internals |
| No build step | Deploy is just file copy, immediate load in browser |

---

## Structural Problems

### 1. `app.js` is a 5,184-line God File

It owns: Router, Toast, Theme, every `render*()` function, every action handler, every modal builder, and chart lifecycle. Any change to any screen requires navigating this entire file.

### 2. No component model — template literals as UI

HTML is assembled as concatenated strings. Adding a new field to a modal means finding the right string, escaping HTML manually, and hoping no one missed an `escapeHtml()`. One missed escape = stored XSS.

### 3. Scattered, implicit state

State lives as module-level variables: `txFilterState`, `txOffset`, `txHasMore`, `chatMessages`, `currentChatId`, `goalChartInstances`, `taxonomyTab`, `syncMode`. There's no single source of truth. When the Router navigates, some of this state is cleaned up (scroll handlers), some isn't (filter state persists across navigations by design).

### 4. DB operations block the main thread

`sql.js` runs synchronously on the main thread. During a large Gmail sync (importing hundreds of transactions), the entire UI is frozen. There's no Worker offloading.

### 5. CDN globals as runtime dependencies

Chart.js, marked, and DOMPurify are loaded via `<script>` tags. If the CDN is unreachable and the service worker hasn't cached them yet, those features silently fail. The app can't import them as ES modules either, creating a two-tier module system.

---

## Alternatives

### Alternative 1: Split `app.js` by screen (lowest effort)

Extract each `render*()` group into its own ES module file:

```
js/
  screens/
    dashboard.js
    transactions.js
    chat.js
    settings.js
    ...
  ui/
    router.js
    toast.js
    theme.js
    modal.js
  app.js  ← just imports and wires them up
```

**Pros:**
- No new dependencies, no paradigm shift
- Each screen file is independently testable
- `app.js` shrinks from 5,184 → ~100 lines

**Cons:**
- Still no reactivity — every state change requires a manual `render*()` call
- Template literal HTML generation with manual `escapeHtml()` remains
- State is still scattered across modules

---

### Alternative 2: Alpine.js for reactivity (minimal change, no build step)

Alpine.js (~16KB CDN) adds declarative reactivity to plain HTML via `x-data`, `x-bind`, `x-for` attributes. It can be loaded as a CDN global just like Chart.js is today.

```html
<!-- instead of renderTransactions() writing innerHTML -->
<div x-data="transactions">
  <ul>
    <template x-for="tx in items" :key="tx.id">
      <li x-text="tx.description"></li>
    </template>
  </ul>
</div>
```

**Pros:**
- No build step needed
- Eliminates manual `innerHTML` string assembly — reduces XSS surface
- Reactive: changing `this.items` automatically updates the DOM
- `db.js`, `ai.js`, `api.js` all stay the same

**Cons:**
- Adds another CDN global dependency
- Logic split between HTML attributes and JS — harder to test in Vitest
- Alpine is opinionated about how data flows; adapting the existing event delegation pattern takes effort

---

### Alternative 3: Web Workers for DB (correctness + performance)

Move `db.js` to a Worker via `Comlink` (or a manual `postMessage` protocol), keeping sql.js off the main thread.

```
main thread  ←→  comlink  ←→  db.worker.js (sql.js runs here)
```

**Pros:**
- UI never freezes during large syncs or imports
- WASM memory doesn't compete with rendering
- Can add SharedArrayBuffer-backed `wa-sqlite` (true multi-tab support)

**Cons:**
- `Comlink` adds a dependency (~2KB), or you hand-roll a `postMessage` protocol
- All DB calls become truly async (they already are by convention, but now forced)
- Requires COOP/COEP headers — already present in `static/_headers`

---

### Alternative 4: Replace sql.js + IndexedDB with OPFS + wa-sqlite (long-term)

The Origin Private File System API lets the browser hold a real SQLite database file using `wa-sqlite` with an OPFS VFS — no more serialize/deserialize on every write.

**Pros:**
- No IndexedDB serialization overhead on every `_persist()` — massive write performance gain
- File is persistent without the "copy to IDB" dance
- Multi-tab access is possible with `SharedArrayBuffer` + Atomics
- `wa-sqlite` is actively maintained and smaller than `sql.js`

**Cons:**
- OPFS is fully supported only in Chromium (Firefox partial, Safari 16.4+)
- Migration path from existing IndexedDB data requires a one-time migration
- `wa-sqlite` API is lower-level than `sql.js` — more setup code

---

## Recommendation

Given the project's goals (lightweight, privacy-first, no build step), the highest ROI path is:

**Do now — no new deps, no risk:**
- Split `app.js` by screen (Alternative 1). This alone eliminates the God File problem and makes each screen independently testable.

**Do next — low risk:**
- Move `sql.js` to a Web Worker (Alternative 3). The infrastructure (`_headers` with COOP/COEP) is already in place.

**Watch for later:**
- OPFS + `wa-sqlite` once Safari support solidifies — it would make the storage layer significantly faster and simpler.

**Skip:**
- Alpine.js or any other framework. The current data-action delegation pattern is already a thin "framework" that tests cleanly with Vitest. Adding Alpine doesn't eliminate complexity, it displaces it.
