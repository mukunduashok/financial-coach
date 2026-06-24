# Feature: PDF Export for Transactions

## Context

The PDF export button was removed from the Transactions screen (see BUG-SEV2-03) because
the implementation was downloading CSV content with a `.pdf` filename — no actual PDF
generation logic existed. This requirement tracks the proper implementation of PDF export.

## Goal

Allow users to export their filtered transaction list as a properly formatted PDF file,
suitable for record-keeping or sharing with a financial advisor.

## Scope

- Export button in the Transactions screen export toolbar (alongside the existing CSV button)
- Applies the same filters currently active in the Transactions view (date range, account,
  category, transaction type)
- PDF includes:
  - Header: app name, export date, active filter summary (account name / date range)
  - Table of transactions: Date | Description | Merchant | Category | Account | Amount
  - Footer: totals row (total income, total expenses, net)

## Proposed Approaches

### Option A — Browser Print (no external library, recommended first)
Use `window.print()` with a print-specific CSS stylesheet:
1. Render a hidden `<div id="print-frame">` with the transaction table HTML
2. Add a `@media print` CSS block that shows only `#print-frame` and hides everything else
3. Call `window.print()` — the browser renders the print dialog, user saves as PDF
- **Pros**: Zero dependencies, works offline, user controls paper size/orientation
- **Cons**: Requires user interaction (print dialog); no programmatic control of filename

### Option B — jsPDF from CDN (lightweight, fully programmatic)
Load `jsPDF` dynamically from a CDN only when the user clicks the PDF export button:
```js
// Dynamic import from CDN (loaded on demand — no build step needed)
const script = document.createElement("script");
script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
document.head.appendChild(script);
await new Promise((resolve) => { script.onload = resolve; });
const { jsPDF } = window.jspdf;
const doc = new jsPDF();
// ... build table and call doc.save("transactions.pdf")
```
- **Pros**: Fully programmatic, custom filename, no user print dialog
- **Cons**: Requires network access on first use; CDN dependency

## Constraints

- **No build step**: The app ships as static files to Cloudflare Pages — no bundler or transpiler
- **No runtime npm dependencies**: Do not add packages to `package.json` devDependencies that
  are used at runtime
- **ES Modules**: Implementation must use `import`/`export` syntax consistent with the rest of
  the codebase
- **Offline-first**: Option A is preferred because it requires no external network request;
  Option B should cache the CDN script or fall back gracefully when offline

## Acceptance Criteria

1. A "PDF" button appears in the Transactions screen export toolbar
2. Clicking the button generates a PDF (or opens the print dialog) containing a table of the
   currently filtered transactions
3. The PDF/print view includes: date range / account filter in a header, transaction table, totals
4. The button does not download a `.pdf` file containing CSV text
5. Works in Chrome, Firefox, and Safari on both desktop and mobile
6. `make lint-js` passes after implementation
7. Unit tests in `tests/js/` cover the new export function
8. E2E test in `tests/e2e/js/` verifies the button is present and clickable

## Out of Scope

- Charts or graphs in the PDF (plain table only for v1)
- Custom branding / logos
- Server-side PDF generation
