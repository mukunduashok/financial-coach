# Feature: Net Worth Tracker

## Problem

The app tracks spending and savings goals but has no concept of total wealth. A user who has
₹5L in savings but ₹3L in a car loan has a net worth of ₹2L — not ₹5L. Without tracking
liabilities (loans, credit cards), the app gives an incomplete financial picture.

## Goal

Add a Net Worth view that aggregates:
- **Assets**: sum of all asset account balances (savings, current, wallet, deposits)
- **Liabilities**: sum of all liability account balances (loans, credit cards)
- **Net Worth**: Assets − Liabilities

## Schema Changes

Add two new `account_type` values to the existing `accounts` table (no schema migration
needed — the column is already `TEXT`):
- `loan` — home loan, car loan, personal loan
- `credit_card` — credit card outstanding balance

Accounts with these types are treated as **liabilities** — their balances are subtracted
from net worth. The balance for a liability account represents the outstanding amount owed
(stored as a positive number).

## UI Design

### Dashboard Widget
A "Net Worth" summary card on the Dashboard showing:
- Assets total, Liabilities total, Net Worth (coloured green if positive, red if negative)
- Tapping expands to list each account grouped under Assets / Liabilities

### Month-over-Month Trend
A mini bar chart (Chart.js, already a dependency) on the Reports screen showing net worth
over the last 6 months. Net worth per month is estimated from beginning-of-month balances
derived from transaction history.

### Account Creation
The existing "Add Account" modal gains two new `account_type` options: Loan and Credit Card.

## Implementation Notes

- `db.js`: new `getNetWorth()` helper returning `{ assets, liabilities, netWorth, accounts }`
  where `accounts` is the full list split by type
- `app.js`: extend `renderDashboard()` to include the net worth card; extend `renderReports()`
  for the trend chart
- The balance sign convention: all balances stored as positive numbers; `getNetWorth()`
  applies the sign based on `account_type`

## Acceptance Criteria

1. User can create an account with type `loan` or `credit_card`
2. Dashboard shows Assets, Liabilities, and Net Worth totals
3. Net worth is correctly calculated as assets − liabilities
4. Month-over-month net worth trend chart renders on Reports screen
5. Negative net worth displayed in red; positive in green
6. `make lint` passes; unit tests cover `getNetWorth()`

## Out of Scope

- Automatic import of loan balances from bank emails
- Investment portfolio value tracking (stocks / mutual funds / crypto)
