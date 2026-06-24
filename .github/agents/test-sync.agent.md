---
description: "Specialized agent for testing Gmail Sync — connection status UI, sync mode selection, and sync flow."
---

# Gmail Sync Feature Test Agent

## Purpose
Test the Gmail Sync screen (`#/sync`) covering OAuth connection status, sync mode UI,
and sync initiation flows. Full OAuth testing requires a real Gmail account.
This agent covers all UI states and non-OAuth flows.

## References
- Production code: `static/js/app.js` (function: `renderSync`)
- Gmail module: `static/js/gmail.js` (`Gmail.connect`, `Gmail.isConnected`, `Gmail.extractTransactions`)
- Config: `static/js/config.js` (`GMAIL_SETTINGS_KEY`, `GMAIL_PROXY_URL`)
- Unit tests: `tests/js/gmail.test.js`
- E2E tests: `tests/e2e/js/chat.spec.js` (sync section)

## Test Cases to Cover

### 1. Sync Page Load (Not Connected)
- Navigating to `#/sync` shows Gmail Connection section
- Shows "Not Connected" status
- Shows "Connect Gmail" button
- No sync controls visible (N-days/date-range mode)

### 2. Connected State UI
Setup: Set `fincoach-gmail-settings` with a valid token:
```js
localStorage.setItem("fincoach-gmail-settings", JSON.stringify({
  email: "test@gmail.com",
  access_token: "mock-token",
  expiry: Date.now() + 3600000
}));
```
- Shows connected email address
- Shows sync mode selector (N-days vs date-range)
- N-days mode: shows days input + "Sync Last X Days" button
- Date-range mode: shows from/to date inputs + "Sync Date Range" button
- Shows "Reset Sync History" button

### 3. Sync Mode Switching
- Clicking "N-Days" mode → days input visible
- Clicking "Date Range" mode → from/to date inputs visible
- Mode selection persists within the session

### 4. AI Key Notice
- Without AI key configured: info notice appears at top of sync page
  ("Add an AI key in Settings to unlock smarter categorisation...")
- With AI key configured: notice is absent or dismissed

### 5. Reset Sync History
- "Reset Sync History" button present when connected
- Clicking shows confirmation
- Confirming clears processed_gmail_messages table

## Key Selectors
```
[data-action="connect-gmail"]    — Connect Gmail button
[data-action="set-sync-mode"]    — Mode toggle buttons (N-Days / Date Range)
[data-action="run-sync"]         — Run Sync button
[data-action="reset-sync-history"] — Reset history button
.gmail-status                    — Connection status indicator
#sync-days                       — Days input (N-days mode)
#sync-from, #sync-to             — Date inputs (date-range mode)
```

## Running Tests
```bash
# Sync-related E2E tests
npx playwright test tests/e2e/js/chat.spec.js --grep "TestSyncPage"

# Gmail unit tests
npx vitest run tests/js/gmail.test.js
```

## Output Format
```markdown
### Gmail Sync Test Results
- Page loads (not connected): ✅/❌
- Connect button visible: ✅/❌
- Connected state UI: ✅/❌ (or N/A - no live Gmail)
- Sync mode switching: ✅/❌
- AI key notice: ✅/❌
- Bugs found: <list or "None">
```
