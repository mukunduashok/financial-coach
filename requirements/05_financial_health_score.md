# Feature: Financial Health Score

## Problem

The current Dashboard shows a collection of stats (spend this month, recent transactions,
budget bars, goal progress) but gives the user no holistic view of their financial health.
A user cannot quickly answer "Am I doing well financially?"

## Goal

Compute and display a **Financial Health Score** (0–100) on the Dashboard that aggregates
multiple financial dimensions into a single, easy-to-understand indicator.

## Score Dimensions (each 0–25 points)

| Dimension | What it measures | How it's computed |
|-----------|-----------------|-------------------|
| **Budget Adherence** | Staying within budgets | Avg % of active budgets under limit this month |
| **Savings Rate** | Saving a meaningful % of income | (Income − Expenses) / Income × 100, mapped to 0–25 |
| **Goal Progress** | Active goals on track | Avg on-track ratio across all active goals |
| **Spending Consistency** | Stable month-over-month spending | Stddev of last 3 monthly totals; low variance = high score |

## UI Design

- Circular gauge (CSS `conic-gradient` — no external library) displayed in the Dashboard
  header area
- Score shown as a number (e.g., **72 / 100**) with a label: Poor / Fair / Good / Excellent
- Tapping the gauge expands a breakdown card showing each dimension's sub-score and a
  one-line explanation
- Score colour thresholds: red (<40), amber (40–69), green (70–100)

## Implementation Notes

- All computation is pure arithmetic on existing DB data — no LLM call required
- New `db.js` method: `getHealthScore()` returns
  `{ total, budget, savings, goals, consistency }` (all values 0–25, `total` 0–100)
- Rendered in `app.js` `renderDashboard()` using an inline SVG or CSS `conic-gradient`
- Score is recomputed on every dashboard render (fast, local-only)

## Acceptance Criteria

1. Dashboard shows a health score gauge with a numeric value and label
2. Tapping/clicking the gauge expands to show the 4 sub-scores with explanations
3. Score updates correctly when transactions, budgets, or goals change
4. Works fully offline — no LLM required
5. Months with zero income show savings sub-score as 0 (not NaN or error)
6. `make lint` passes; unit tests cover `getHealthScore()` with multiple scenarios

## Out of Scope

- Historical health score trend chart (future v2)
- Benchmarking score against other users or national averages
