# Feature: Debt Payoff Planner

## Problem

Users with loans or credit card debt have no tool to plan their payoff strategy. The app
can record that a loan exists (via `requirements/20_net_worth_tracker.md`) but gives no
guidance on how fast it can be paid off, what the total interest cost is, or which debt
to tackle first.

## Goal

Provide a Debt Payoff Planner that helps the user:
1. Record all debts with outstanding balance, interest rate, and minimum payment
2. See a payoff projection (months to payoff, total interest) for each debt
3. Compare two common strategies — Avalanche vs. Snowball — using their actual cash flow
4. Get an AI coaching recommendation on which strategy suits their situation

## Schema Changes

Extend the `accounts` table with new optional columns (added via `ALTER TABLE` migration in
`db.js` schema init, guarded with `IF NOT EXISTS` equivalent via a try-catch on the alter):

```sql
ALTER TABLE accounts ADD COLUMN interest_rate REAL;
ALTER TABLE accounts ADD COLUMN minimum_payment REAL;
ALTER TABLE accounts ADD COLUMN original_balance REAL;
```

These columns apply only to `account_type IN ('loan', 'credit_card')`.

## Features

### Payoff Calculator (Local — No AI Required)
For each debt account display:
- Outstanding balance, interest rate (%), minimum monthly payment
- Projected payoff date at minimum payment only
- Total interest paid if only minimum payments are made
- "Extra monthly payment" input field → recalculates payoff date and interest saved in real time

### Strategy Comparison
Two strategy buttons: **Avalanche** (highest rate first) and **Snowball** (lowest balance first).
Shows a side-by-side comparison of:
- Total interest paid
- Total payoff time (months)
- Order in which debts would be paid off

Strategy calculations use the user's available monthly surplus:
`surplus = avg_monthly_income − avg_monthly_expenses − sum_of_minimum_payments`

### AI Coaching Integration
A "Get Advice" button inside the Debt Planner that pre-fills the chat with:
> "Given my debts and monthly cash flow, which payoff strategy should I use and why?"

## Implementation Notes

- New screen: `renderDebtPlanner()` in `app.js`, registered as route `#debt`
- Nav item added to the overflow menu
- All payoff calculations are pure JS arithmetic helpers in `utils.js`:
  - `calcPayoff(balance, rate, minPayment, extraPayment)` → `{ months, totalInterest }`
  - `calcStrategy(debts, surplus, strategy)` → ordered payoff plan
- `db.js`: `getDebtAccounts()` returns accounts where `account_type IN ('loan', 'credit_card')`

## Acceptance Criteria

1. User can add interest rate and minimum payment to loan/credit card accounts
2. Payoff projection (date, total interest) displays for each debt
3. Avalanche vs. Snowball comparison renders correctly
4. "Extra payment" input updates projections in real time (no page reload)
5. Correctly handles edge case: 0% interest rate, missing minimum payment
6. `make lint` passes; unit tests cover `calcPayoff()` and `calcStrategy()`

## Out of Scope

- Month-by-month amortisation schedule table
- Automatic tracking of loan balances from bank transaction emails
- Prepayment penalty calculations
