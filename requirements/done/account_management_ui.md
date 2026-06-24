# Feature: Account Management UI

## Goal
Expose existing account CRUD and merge/unmerge API endpoints through the web UI, allowing users to manage accounts without using the API directly.

## Scope
1.  **Create Account**: Form with fields — name, account type (dropdown: savings/current/credit/debit/deposit), initial balance, account identifier (optional).
    - **API:** `POST /accounts`
2.  **Merge Accounts**: UI to select a source and target account and trigger a merge.
    - Show validation constraints (same type, no self-merge, source must be standalone).
    - **API:** `POST /accounts/merge`
3.  **Unmerge Account**: Button on merged (inactive) accounts to undo the merge.
    - **API:** `POST /accounts/{id}/unmerge`
4.  **Delete Account**: Delete button with confirmation dialog.
    - Warn if account has transactions.
    - **API:** `DELETE /accounts/{id}`

## Context
The Accounts screen (`#/accounts`) currently displays account list, balances, and merge relationships (read-only). These actions extend it to be fully interactive.

## Dependencies
- All backend APIs already exist and are tested.
- Requires the existing Accounts screen in the web UI.
