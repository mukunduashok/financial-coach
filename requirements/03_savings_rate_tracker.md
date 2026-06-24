# Feature: Savings Rate Tracker

## Problem

Savings rate — the percentage of income that is saved — is one of the most important
personal finance metrics, yet the app has no first-class display of it. Users track
category-by-category expenses but never see the big picture: "How much of what I earn am
I actually keeping?"

## Goal

Add savings rate as a prominent, persistent metric visible on both the Dashboard and the
Reports screen, with a trend chart and an optional user-set target.

## Features

### Dashboard — "This Month" Summary
Extend the existing month-summary section to show three numbers side by side:
- **Income** (total `transaction_type = 'income'` this month)
- **Expenses** (total `transaction_type = 'expense'` this month)
- **Savings Rate** = `(Income − Expenses) / Income × 100` formatted as `42%`

If income is zero, display "N/A" instead of a percentage.

### Reports Screen — Savings Rate Tab
A new "Savings Rate" tab on the Reports screen with:
- Line chart (Chart.js) showing monthly savings rate % for the last 12 months
- Horizontal reference line at the user's target savings rate (if set)
- Table below the chart: Month | Income | Expenses | Saved | Rate %

### Savings Rate Target
A settings field (stored in `localStorage` under `fincoach-savings-target`) where the user
can set a target savings rate (e.g., 30%). When set:
- The Dashboard shows a progress badge: "32% ✓" in green or "18% / 30% target" in amber
- The Reports chart draws a dashed reference line at the target

## Implementation Notes

- New `db.js` method: `getSavingsRate(months = 12)` returns
  `[{ month: "2026-04", income, expenses, saved, rate }]`
- `income` and `expenses` are always positive numbers; `rate` is `null` when `income === 0`
- Settings field added to the existing Settings screen alongside AI provider settings
- Target stored in `localStorage` (no DB schema change)

## Acceptance Criteria

1. Dashboard "This Month" section shows income, expenses, and savings rate
2. Reports screen has a Savings Rate tab with a trend chart
3. User can set a savings rate target in Settings
4. Target appears as a reference line on the chart and a badge on the Dashboard
5. Zero-income months display "N/A" (not NaN, Infinity, or an error)
6. `make lint` passes; unit tests cover `getSavingsRate()` including edge cases

## Out of Scope

- Investment returns counted as savings (only cash income/expense from transactions)
- Tax-adjusted savings rate
- Comparing rate against external benchmarks
