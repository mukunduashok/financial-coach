# Feature: Category/Merchant Management UI

## Goal
Provide a dedicated interface for users to manage their financial taxonomy: Categories and Merchants.

## Scope
1.  **Category Management**:
    *   UI to view, create, edit, and delete categories (using `GET/POST/PUT/DELETE /api/categories`).
    *   Ability to set a default category for new transactions.
2.  **Merchant Management**:
    *   UI to view, search, and manage merchants (using `/api/merchants`).
    *   Ability to link a merchant to a specific category and set a confidence score.
3.  **Integration**: When a transaction is imported or manually entered, the UI should guide the user to select/confirm the correct merchant and category.

## Dependencies
- Utilizes existing API endpoints for categories and merchants.
- This feature improves data quality by giving the user control over the underlying taxonomy.