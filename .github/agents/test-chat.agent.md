---
description: "Specialized agent for testing the AI Chat feature — message sending, basic fallback responses, session management, and suggestion chips."
---

# Chat Feature Test Agent

## Purpose
Perform thorough testing of the Chat screen (`#/chat`) covering all user-visible flows.
Note: Full AI response testing requires a configured provider (Groq/OpenAI/Gemini/Ollama/Azure).
This agent tests both the configured and unconfigured states.

## References
- Production code: `static/js/app.js` (functions: `renderChat`, `sendMessage`)
- AI module: `static/js/ai.js` (`AI.chat`, `AI.getSettings`, `AI.saveSettings`, `AI._buildFallbackResponse`)
- DB layer: `static/js/db.js` (`saveChatMessage`, `getChatHistory`, `listChatSessions`, `clearChatHistory`)
- API bridge: `static/js/api.js` (`sendChatMessage`, `getChatHistory`, `listChatSessions`, `clearChatHistory`)
- Unit tests: `tests/js/ai.test.js`, `tests/js/ai-integration.test.js`
- E2E tests: `tests/e2e/js/chat.spec.js`

## Test Cases to Cover

### 1. Chat Page Load
- Page loads at `#/chat`
- Header shows: 📋 (sessions), ✚ (new chat), 🗑 (clear) buttons
- Welcome message with "Your Financial Coach" heading
- Suggestion chips visible (4 chips about finances)
- Input box present at bottom
- Without AI configured: placeholder says "AI not configured — basic answers only"
- With AI configured: placeholder says "Ask about your finances..."

### 2. Fallback Responses (No AI Provider Configured)
Seed some transactions with today's date, then test these queries:
```
"What is my total balance?"         → Shows **Financial Status** with balance, income, expenses
"How much did I spend last month?"  → Shows financial snapshot
"Can I afford a ₹5000 purchase?"    → Shows purchase decision response
"What are my spending habits?"      → Shows spending analysis
```
Verify:
- Responses include markdown-rendered content (bold text, bullets)
- Correct balance/amounts from seeded data
- Footer says "For personalised advice... configure an AI provider in ⚙️ Settings"
- Message timestamp appears under each message

### 3. Balance Consistency Check (Known Issue)
- Seed accounts of types: savings, credit, deposit
- Query "What is my total balance?"
- Compare result to dashboard total balance
- **Known Bug**: AI excludes credit/debit/deposit accounts → shows higher balance than dashboard
  See plane.so BUG-PROD-02

### 4. Chat Session Management
- 📋 icon opens sessions sidebar with list of sessions
- ✚ icon creates a new empty chat session
- 🗑 icon shows confirmation modal before clearing (NOT browser `confirm()`)
- Confirming clear removes messages and shows "Chat cleared" toast
- Cancelling clear modal does nothing

### 5. Chat History Persistence
- Send a message, then navigate away and return to `#/chat`
- Previous messages should still be visible (persisted to SQLite)
- Session count in sidebar reflects new session after using ✚

### 6. Suggestion Chip Interaction
- Clicking a suggestion chip populates the input with its text
- Optionally auto-sends the message

### 7. Error Handling
- With invalid API key configured → error message appears in chat (not JS error)
- Empty message → send button disabled or no response sent

## Key Selectors
```
.chat-messages                — message container
.chat-message.user            — user messages
.chat-message.assistant       — AI/fallback responses
[data-action="send-message"]  — send button (➤)
#chat-input                   — text input
[data-action="new-chat"]      — ✚ new chat button
[data-action="clear-chat"]    — 🗑 clear button
[data-action="toggle-sessions"] — 📋 sessions button
.suggestion-chip              — suggestion chips
```

## Seeding Data for Tests
```js
// Always use today's date for transactions visible in chat context
const today = new Date().toISOString().slice(0, 10);
await DB.createAccount({ name: "Test Bank", balance: 50000, account_type: "savings" });
await DB.createTransaction({ date: today, amount: -1500, transaction_type: "expense",
  account_id: acc.id, description: "Restaurant" });
await DB.createTransaction({ date: today, amount: 30000, transaction_type: "income",
  account_id: acc.id, description: "Salary" });
```

## Running Tests
```bash
# All chat tests
npx playwright test tests/e2e/js/chat.spec.js

# Unit tests for AI module
npx vitest run tests/js/ai.test.js
npx vitest run tests/js/ai-integration.test.js
```

## Known Issues
- **BUG-PROD-02**: Chat `BALANCE_ACCOUNT_TYPES` in `ai.js` (`["checking", "savings", "wallet", "current"]`)
  excludes credit/debit/deposit accounts from balance total. Dashboard includes all accounts.
  This causes chat to report a higher balance than the actual net balance when credit accounts exist.
  Reproduction: Create a credit account with -₹5000, see chat show higher total than dashboard.

## Output Format
```markdown
### Chat Test Results
- Page loads: ✅/❌
- Fallback responses with data: ✅/❌
- Balance matches dashboard: ✅/❌ (or note discrepancy amount)
- Session sidebar opens: ✅/❌
- Clear chat modal (not browser confirm): ✅/❌
- History persists across nav: ✅/❌
- Suggestion chips work: ✅/❌
- Bugs found: <list or "None">
```
