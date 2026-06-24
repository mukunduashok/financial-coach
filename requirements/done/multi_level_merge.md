# Feature: Multi-Level Merge Hierarchies

## Goal
Enhance the account merging feature to support complex, multi-level account relationships (e.g., Parent $\rightarrow$ Child $\rightarrow$ Grandchild).

## Scope
1.  **Database**: Modify the `accounts` table structure or introduce a new relationship table to track parent/child relationships beyond a simple `merged_into_id`.
2.  **Service Logic**:
    *   Update `validate_merge_operation` to traverse the entire hierarchy to prevent circular dependencies or invalid merges.
    *   Update balance calculation to correctly aggregate balances across all levels of the hierarchy.
3.  **API**: Update `/accounts/merge` to accept a list of source accounts and a single target account.

## Dependencies
- This is a significant database schema change and requires careful migration planning.
- Must be implemented *after* the basic merge functionality is stable.

## Future Enhancements
- **Merge History / Audit Log**: Track when merges and unmerges happened, by whom, with timestamps. Enables undo and accountability.
- **Automatic Merge Suggestions**: Detect accounts that likely represent the same real account (e.g., same last 4 digits, similar names) and suggest merges to the user.