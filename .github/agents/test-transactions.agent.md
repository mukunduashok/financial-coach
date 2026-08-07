---
description: "Specialized agent for testing the Transactions feature — add, edit, delete, filter, export, and merchant propagation flows."
---

# Transactions Feature Test Agent

## Purpose
Perform thorough testing of the Transactions screen (`#/transactions`, `#/transactions/new`) covering all user flows.

## References
- Production code: `static/js/app.js` (functions: `renderTransactions`, `renderAddTransaction`, `showEditTransaction`, `saveTransaction`, `loadTransactionList`)
- DB layer: `static/js/db.js` (`createTransaction`, `updateTransaction`, `deleteTransaction`, `getTransactions`, `getTransactionTotals`)
- Unit tests: `tests/js/db.test.js` (Transaction CRUD section)
- E2E tests: `tests/e2e/js/transactions.spec.js`

## Server Setup
```bash
# Check if running
curl -s -o /dev/null -w "%{http_code}" http://localhost:8111
# If not: start `npx serve static -l 8111 --cors` before running a specific Playwright spec.
```

## Seed Data Pattern
All E2E transaction seeds MUST use today's date (not hardcoded past dates — the filter defaults to the current month):
```js
const today = new Date().toISOString().slice(0, 10);
await DB.createTransaction({ date: today, ... });
```

## Test Cases to Cover

### 1. Transactions List
- Page loads at `#/transactions`
- Filter bar shows date range, type, account, category selectors
- Default date filter = first of current month → today
- Totals bar shows Income, Expense, Net
- Infinite scroll loads 50 transactions per page
- "All X transactions loaded" footer appears when no more pages

### 2. Add Transaction (`#/transactions/new`)
- FAB `+` button navigates to new form
- Form has: amount, date (defaults to today), type toggle (Expense/Income), account, category, merchant
- Selecting Expense type negates the amount on save
- Empty amount/account shows validation error
- Successful create navigates back to transactions list with toast

### 3. Edit Transaction (modal)
- Clicking a transaction item opens edit modal
- Modal fields: date (`type=date`), amount, type toggle, description, merchant name, merchant UPI ID, category, account
- `#edit-merchant-name` input must be visible in the modal
- Saving without changes preserves original values
- Changing category triggers merchant-learn prompt if merchant UPI exists

### 4. Merchant Name / Rename (v4 — no propagation prompt)
- Editing a transaction's merchant_name writes only to that row; NO "Update merchant name everywhere?" dialog appears (`#mname-yes` must not exist)
- Renaming a merchant via Taxonomy → Merchants changes its `display_name`; the new name surfaces on all linked transactions automatically via the `merchant_id` join (resolved at read time)
- Merchant identity is stable: `_lookupMerchant` by the original name still resolves the merchant after a rename
- Applies equally to UPI-backed and no-UPI merchants

### 5. Delete Transaction
- Delete button (`🗑`) on each row
- Confirmation dialog appears
- Confirming deletes and shows toast, removes from list
- Cancelling does nothing

### 6. Filters
- Date range filter restricts visible transactions
- Type filter (All/Expense/Income) works
- Account filter restricts to selected account
- Category filter restricts to selected category
- "Include merged" checkbox toggles merged account transactions
- Applying filters resets pagination

### 7. Export
- CSV export button generates downloadable CSV
- PDF export is in Settings (not on transactions page)

## Key Selectors
```
[data-action="show-edit-tx"][data-id="<id>"]   — transaction row (click to edit)
[data-action="confirm-delete-tx"][data-id="<id>"] — delete button (🗑)
[data-action="save-transaction"][data-id="<id>"]  — save button in edit modal
#edit-merchant-name                               — merchant name input in edit modal
#edit-date                                        — date input in edit modal (type=date)
[data-action="switch-taxonomy-tab"][data-mode="merchants"] — Taxonomy Merchants tab
[data-action="show-edit-merchant"][data-id="<id>"] — merchant edit button (✏️)
[data-action="do-update-merchant"][data-id="<id>"] — save merchant rename
#merch-edit-name                                  — merchant name input in merchant edit modal
#f-from, #f-to                                   — date filter inputs
#f-type, #f-account, #f-category                 — select filters
```

## Running Tests
```bash
# All transaction tests
npx playwright test tests/e2e/js/transactions.spec.js

# Specific test
npx playwright test tests/e2e/js/transactions.spec.js --grep "MerchantNamePropagation|MerchantRename"

# Unit tests for transactions
npx vitest run tests/js/db.test.js --grep "Transaction"
```

## Known Issues
- **BUG-PROD-02**: Chat balance excludes credit/debit/deposit accounts — tracked in plane.so
- Historical note: Prior to May 2026, seed functions used hardcoded 2025 dates; always use `new Date().toISOString().slice(0,10)` for seeding

## Output Format
Report findings as:
```markdown
### Transactions Test Results
- Add transaction: ✅/❌
- Edit modal opens: ✅/❌
- Merchant rename reflects via join (UPI + no-UPI): ✅/❌
- Delete with confirm: ✅/❌
- Filters work: ✅/❌
- CSV export: ✅/❌
- Bugs found: <list or "None">
```
