# Feature: Goal Tracking UI

## Goal
Develop a dedicated, visually rich User Interface for managing and visualizing financial goals.

## Scope
1.  **API**: Utilize existing endpoints (`GET /goals`, `POST /goals`) but build a dedicated UI experience.
2.  **UI Components**:
    *   **Goal Card**: Display name, target amount, current amount, and progress percentage (visualized via a progress bar).
    *   **Progress Visualization**: Implement charts (e.g., using Chart.js) to show progress over time against the deadline.
    *   **Contribution**: A simple mechanism to manually allocate funds towards a goal from available balances.
3.  **Integration**: The `FinancialAgent` context should be enhanced to provide a "Goal Status Summary" when the user asks general questions.

## Dependencies
- Requires a charting library (e.g., Chart.js) to be included in the static assets.