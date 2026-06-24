# Feature: Bulk Operations

## Goal
Implement bulk actions for efficiency, allowing users to perform operations on multiple selected items at once.

## Scope
1.  **Bulk Delete**: Allow selecting multiple transactions and deleting them with one API call.
2.  **Bulk Categorization**: Allow selecting multiple transactions and assigning them to a single category or merchant.
3.  **Bulk Merge**: Allow merging multiple source accounts into one target account in a single request.
4.  **API**: Update endpoints to accept lists of IDs (e.g., `DELETE /transactions?ids=1,2,3`).

## Dependencies
- Requires updating the frontend selection mechanism to support multi-selection.
- The backend must validate that all provided IDs exist and are in a valid state before proceeding.