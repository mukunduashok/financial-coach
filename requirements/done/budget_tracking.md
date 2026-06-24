# Feature: Budget Tracking / Spending Limits per Category

## Goal
Allow users to set proactive spending limits (budgets) for specific categories over defined periods (e.g., "$400 for Groceries in May").

## Scope
1.  **Database**: Create a `Budgets` table: `(user_id, category_id, period_start, period_end, limit_amount)`.
2.  **API Endpoints**:
    *   `POST /budgets`: Create/Update a budget.
    *   `GET /budgets`: List all active budgets for the user.
    *   `DELETE /budgets/{id}`: Remove a budget.
3.  **Service Logic**:
    *   A new service function must calculate `spent_to_date` for a given budget period and category.
    *   The AI Agent (`FinancialAgent`) must be updated to read and incorporate budget status into its context when advising on spending.
4.  **UI**: Add a dedicated "Budgets" screen to the main navigation.

## Dependencies
- Requires `app/constants.py` to define budget period constants.
- Requires updating the `FinancialAgent` prompt to include budget status.