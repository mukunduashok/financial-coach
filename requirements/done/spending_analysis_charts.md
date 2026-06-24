# Feature: Charts/Graphs for Spending Analysis

## Goal
Visualize spending patterns over time using interactive charts (e.g., pie charts, bar charts, line graphs).

## Scope
1.  **API**: Create a new endpoint, e.g., `GET /api/reports/spending?start_date=...&end_date=...`. This endpoint must aggregate transaction data by category and month.
2.  **Frontend**:
    *   Integrate a charting library (e.g., Chart.js) into the Dashboard or a new "Reports" screen.
    *   Display:
        *   **Pie Chart**: Spending breakdown by category for the selected period.
        *   **Line Chart**: Spending trend over time (monthly totals).
3.  **Data Handling**: The backend must perform complex aggregation queries on the `transactions` table.

## Dependencies
- Requires a charting library dependency in the frontend build process.
- Requires significant backend SQL/SQLAlchemy query refinement.