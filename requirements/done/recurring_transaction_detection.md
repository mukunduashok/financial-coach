# Feature: Recurring Transaction Detection

## Goal
Automatically detect and flag transactions that are likely to be recurring (e.g., monthly subscriptions, rent payments) based on patterns in description, amount, and frequency.

## Scope
1.  **Database**: Potentially add a `is_recurring` boolean flag to the `transactions` table, or a separate `recurring_patterns` table.
2.  **Service Logic**:
    *   Implement a pattern-matching service that analyzes transaction history.
    *   Look for transactions with similar amounts and descriptions occurring at regular intervals (e.g., every 30 days).
    *   When a pattern is found, the system should suggest creating a "Recurring Transaction" record or flagging the existing one.
3.  **AI Integration**: The `FinancialAgent` should be updated to recognize and advise on recurring expenses, treating them with higher priority in spending analysis.

## Dependencies
- Requires robust date/time comparison logic.
- Needs to interact heavily with the `Transaction` model and history.