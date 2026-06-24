# Feature: Bill Reminders & Due Date Alerts

## Problem

The recurring transaction detection feature identifies subscriptions and regular expenses
(EMIs, utility bills, streaming services) but does nothing proactive with that knowledge.
Users have no in-app way to know that their Airtel bill or loan EMI is due in 3 days,
leading to late payments and unnecessary fees.

## Goal

Extend the existing `recurring_patterns` table with due-date awareness and surface upcoming
bill alerts on the Dashboard so users are never caught off-guard by a recurring payment.

## Schema Changes

Extend `recurring_patterns` table via `ALTER TABLE` migration in `db.js` schema init
(guarded to be idempotent):

```sql
ALTER TABLE recurring_patterns ADD COLUMN next_due_date TEXT;
ALTER TABLE recurring_patterns ADD COLUMN reminder_days_before INTEGER DEFAULT 3;
ALTER TABLE recurring_patterns ADD COLUMN is_reminder_enabled INTEGER NOT NULL DEFAULT 1;
```

`next_due_date` is computed as `last_seen + frequency_days` and updated automatically
whenever a new matching transaction is inserted by `detectRecurring()`.

## Features

### Upcoming Bills Widget (Dashboard)
A "Upcoming Bills" card listing recurring patterns with `next_due_date` within the next
7 days, sorted by date ascending:
- Bill name (from `description_pattern`), expected amount, due date, days remaining
- Colour-coded rows: green (>5 days), amber (3–5 days), red (<3 days or overdue)
- "No upcoming bills" empty state when the window is clear

### Bill Management Panel
A sub-tab "Bills" inside the Transactions screen (alongside existing filter tabs), or as a
dedicated section under the existing Recurring detection UI. Shows:
- All active recurring patterns with their `next_due_date` and reminder settings
- Toggle per pattern: enable / disable reminder
- Editable `reminder_days_before` field (select: 1 / 3 / 7 days)
- User can manually override `next_due_date` for a pattern

### Browser Notification (PWA)
When the app is opened and a bill is due within `reminder_days_before` days, request
notification permission (once) and fire a browser `Notification`:
- Title: "Bill due soon — {description_pattern}"
- Body: "₹{amount} due on {due_date}"

Falls back silently (no notification, no error) if permission is denied or the browser
does not support the Notifications API.

## Implementation Notes

- `db.js`: new `getUpcomingBills(days = 7)` returns recurring patterns with
  `next_due_date` within the given window
- `db.js`: `detectRecurring()` updated to compute and store `next_due_date` for each
  pattern after detection
- Browser notification fired from `app.js` `init()` after the DB is loaded, using
  `Notification.requestPermission()` — called at most once per session
- Service worker is already registered; notifications use `self.registration.showNotification()`
  for better mobile support
- No server-side component required — purely client-side

## Acceptance Criteria

1. Dashboard shows upcoming bills for the next 7 days after recurring detection has run
2. Bills are colour-coded by urgency (green / amber / red)
3. User can toggle reminders and change `reminder_days_before` per pattern
4. Browser notification fires when app opens and a bill is due within the threshold
5. Falls back gracefully (no crash) when notification permission is denied
6. `next_due_date` updates automatically after each Gmail sync (new matching transaction)
7. `make lint` passes; unit tests cover `getUpcomingBills()` and `next_due_date` computation

## Out of Scope

- Server-side / background push notifications (see `requirements/13_push_notifications.md`)
- Email or SMS reminders
- Linking bills to specific accounts for auto-debit tracking
