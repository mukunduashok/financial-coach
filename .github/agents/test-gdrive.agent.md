---
description: "Specialized agent for testing the Google Drive Backup feature — connection status, enable/disable, API key backup checkbox, and sync UI."
---

# Google Drive Backup Test Agent

## Purpose
Perform thorough testing of the Google Drive Sync feature in Settings (`#/settings`).
Note: Full sync testing requires a real Google account. This agent covers UI state verification,
localStorage flag management, and encryption logic — which can all be tested without live Drive access.

## References
- Production code: `static/js/app.js` (Settings section with GDrive UI, ~line 4150-4280)
- GDrive module: `static/js/gdrive.js` (`GDrive.upload`, `GDrive.download`, `GDrive.sync`, `GDrive.isEnabled`, `GDrive.setEnabled`)
- Config keys: `static/js/config.js` (`GDRIVE_ENABLED_KEY`, `GDRIVE_LAST_SYNC_KEY`, `GDRIVE_BACKUP_API_KEY_KEY`, `GDRIVE_SYNC_LOCK_KEY`)
- Unit tests: `tests/js/gdrive.test.js`
- E2E tests: `tests/e2e/js/gdrive.spec.js`

## Test Cases to Cover

### 1. GDrive Section Render
- Settings page contains "Google Drive Sync" heading
- Section has descriptive text mentioning backup and encryption

### 2. Gmail Not Connected State
- Shows "Not connected to Google" status
- Shows "Connect Google Account" button
- Does NOT show "Sync with Drive" button
- Does NOT show "Disable Drive Sync" button

### 3. Gmail Connected + Drive Disabled State
Setup: Set `fincoach-gmail-settings` in localStorage with a valid email:
```js
localStorage.setItem("fincoach-gmail-settings", JSON.stringify({
  email: "test@gmail.com",
  access_token: "mock-token",
  expiry: Date.now() + 3600000
}));
```
- Shows "gdrive-disconnected" status indicator
- Shows "Enable Drive Sync" button
- Shows "Reconnect Google Account" button
- Shows connected email address
- Does NOT show "Sync with Drive" button

### 4. Drive Enabled State
Setup: Additionally set `fincoach-gdrive-enabled` = "true":
```js
localStorage.setItem("fincoach-gdrive-enabled", "true");
```
- Shows "gdrive-connected" status indicator
- Shows "Sync with Drive" button
- Shows "Disable Drive Sync" button
- Shows auto-sync checkbox (checked when enabled)
- Shows "Last synced: Never" when `fincoach-gdrive-last-sync` is not set
- Shows formatted date when `fincoach-gdrive-last-sync` is set

### 5. Enable/Disable Drive Sync Flow
- Clicking "Enable Drive Sync" → sets localStorage flag, re-renders with connected state
- Clicking "Disable Drive Sync" → clears localStorage flag, re-renders with disabled state

### 6. API Key Backup Checkbox
**KNOWN BUG (BUG-PROD-01)**: The checkbox is always visible regardless of provider.
Expected behavior (not yet implemented):
- When provider requires API key (groq, openai, gemini, azure) → checkbox VISIBLE
- When provider doesn't require API key (ollama) → checkbox HIDDEN

Current behavior:
- Checkbox is always visible (display:block) even for Ollama

Test the current state:
- With Groq selected: checkbox visible ✅ (correct)
- With Ollama selected: checkbox VISIBLE ❌ (should be hidden — BUG-PROD-01)

Checkbox state management (works correctly):
- Default: unchecked (`fincoach-gdrive-backup-api-key` not in localStorage)
- Checking: sets localStorage key to "true"
- Unchecking: removes localStorage key

### 7. Delete Backup Button State
Setup: Connect Gmail + enable Drive. The Delete button state depends on whether a backup file exists on Drive.
- No backup file on Drive → button disabled, shows "No backup on Drive yet" note
- Backup exists → button enabled

### 8. Auto-sync Checkbox
- Only visible when Drive is enabled
- Checking auto-sync → sets some localStorage mechanism

### 9. Encryption Logic (Unit Tests)
The `GDrive` module uses AES-GCM + PBKDF2:
- `_encrypt(bytes, email)` → encrypts Uint8Array with email-derived key
- `_decrypt(encrypted, email)` → decrypts back to original
- Decrypting with wrong email → throws error
These are tested in `tests/js/gdrive.test.js` and don't need browser testing.

## Key Selectors
```
input[data-action="gdrive-toggle-backup-api-key"]   — API key backup checkbox
[data-action="gdrive-enable"]                       — Enable Drive Sync button
[data-action="gdrive-sync"]                         — Sync with Drive button  
[data-action="gdrive-delete-backup"]                — Delete Drive Backup button
.gdrive-connected / .gdrive-disconnected            — status indicators
.gdrive-last-sync                                   — last sync timestamp text
[data-action="gdrive-toggle-auto-sync"]             — auto-sync checkbox
```

## Helper: setProviderSettings
```js
async function setProviderSettings(page, provider) {
  await page.evaluate((p) => {
    const settings = { provider: p, apiKey: p === "ollama" ? "" : "test-key",
      model: "test-model", ollamaBaseUrl: "http://localhost:11434" };
    localStorage.setItem("fincoach-ai-settings", JSON.stringify(settings));
  }, provider);
}
```

## Helper: goSettings
```js
async function goSettings(page) {
  await page.evaluate(() => { localStorage.setItem("fincoach-onboarded", "true"); });
  await page.goto("/");
  await page.waitForSelector(".bottom-nav");
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await page.waitForSelector("#screen");
  await page.waitForTimeout(500);
}
```

## Running Tests
```bash
# All GDrive tests
npx playwright test tests/e2e/js/gdrive.spec.js

# Unit tests for GDrive module
npx vitest run tests/js/gdrive.test.js
```

## Known Issues
- **BUG-PROD-01** (Low): API key backup checkbox always visible in Settings even for Ollama provider
  (which doesn't require/have an API key). The checkbox at app.js ~line 4238 needs conditional
  `display:none` when `currentProvider.requiresKey === false`.
  Test that confirms this: `gdrive.spec.js:435` — currently FAILING.

## Output Format
```markdown
### GDrive Test Results
- Section renders: ✅/❌
- Disconnected state UI: ✅/❌  
- Connected + Drive disabled UI: ✅/❌
- Drive enabled UI: ✅/❌
- Enable/Disable flow: ✅/❌
- API key checkbox (Groq): ✅/❌
- API key checkbox (Ollama — BUG-PROD-01): ❌ (known bug — checkbox visible)
- Checkbox localStorage management: ✅/❌
- Delete button state: ✅/❌
- Encryption unit tests: ✅/❌
- Bugs found: BUG-PROD-01 (open)
```
