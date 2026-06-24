# Feature: Cash Flow Forecast

## Problem

The app shows historical spending but gives no forward-looking view. Users cannot see
whether they will run out of money before their next salary, or how much they can
safely spend this month without jeopardising their savings goals.

## Goal

Show a 30-day forward-looking cash flow forecast on the Dashboard that combines:
- Known recurring expenses detected by the recurring-transaction engine
- Active goals' required monthly contributions
- Current account balances
- Average historical income (last 3 months)

## UI Design

A "Next 30 Days" card on the Dashboard showing:
- **Projected balance** at end of the period: current balance + expected income − expected expenses
- **Safe-to-spend**: projected balance − goal contributions − 10% safety buffer
- A mini week-by-week timeline bar (4 segments) coloured green / amber / red based on the
  projected running balance at each week boundary

Tapping the card expands a breakdown listing:
- Each recurring expense with its expected date and amount
- Expected income (labelled "Est. income — avg of last 3 months")
- Goal contributions deducted

## Implementation Notes

- Uses `recurring_patterns` table (populated by the existing recurring detection feature)
  for known fixed expenses; `next_due_date` estimated as `last_seen + frequency_days`
- Income estimated as the rolling average of the last 3 months' `transaction_type = 'income'`
  transactions
- Goal contribution per goal = `(target_amount − current_amount) / months_remaining_until_deadline`
  (skipped for goals with no deadline)
- No LLM call required — pure arithmetic
- New `db.js` method: `getCashFlowForecast()` returns:
  ```js
  {
    projectedBalance: Number,
    safeToSpend: Number,
    expectedIncome: Number,
    recurringExpenses: [{ description, amount, expectedDate }],
    goalContributions: [{ name, monthlyTarget }],
    weeklyProjections: [Number, Number, Number, Number]  // balance at end of each week
  }
  ```
- Rendered in `app.js` `renderDashboard()` as a collapsible card

## Acceptance Criteria

1. Dashboard shows "Next 30 Days" card with projected balance and safe-to-spend amount
2. Recurring expenses from `recurring_patterns` are included in the forecast
3. Goal monthly contributions are deducted from safe-to-spend
4. Safe-to-spend is never shown as negative (floored at ₹0 with a warning)
5. Works fully offline with no LLM dependency
6. `make lint` passes; unit tests cover `getCashFlowForecast()` including edge cases
   (no income history, no recurring patterns, no goals)

## Out of Scope

- Day-by-day forecast table or calendar view
- Forecast beyond 30 days
- Integration with external calendar events or UPI mandates
