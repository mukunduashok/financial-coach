# Feature: Improve AI Chat Experience

## Problem

Chat responses lack depth and actionability. The system prompt is generic, financial context
is incomplete (budgets and recurring bills are missing), suggestion chips are static, and there
is no dynamic follow-up guidance or conversation identification after a session ends.

## Goal

Make the AI chat experience more useful, personalised, and interactive by enriching the
financial context fed to the model, improving prompt engineering, generating dynamic suggestion
chips from live data, appending contextual follow-up chips after each response, auto-naming
chat sessions from the first message, and ensuring all app-generated context sent to the LLM
is free of unmasked PII.

## Scope

### 1. Richer Financial Context in System Prompt

Extend `AI._buildContext()` in `static/js/ai.js` to include two additional data sources that
are already in the DB but currently absent from the prompt:

**a) Active budgets**

Call `DB.getBudgets(true)` (active only) inside the existing `Promise.all(...)`. For each
budget, append:
```
=== ACTIVE BUDGETS ===
- <category_name>: ₹<spent> spent of ₹<limit> limit (<pct>% used) — period <start> to <end> — status: <on_track|warning|exceeded>
```
`spent_amount` and `status` are already returned by the budget query. Use `b.category_name`,
`b.limit_amount`, `b.spent_amount`, `b.status`, `b.period_start`, `b.period_end`.

**b) Recurring bills (upcoming)**

Call `DB.getRecurringPatterns()` inside the same `Promise.all`. Include only active patterns
(`is_active === true`). Append:
```
=== RECURRING BILLS ===
- <description_pattern>: ₹<amount> every <frequency_days> days — next due: <next_due_date|"unknown"> (<category_name>)
```

**c) Financial health snapshot paragraph**

At the top of the returned context string (before `=== FINANCIAL SNAPSHOT ===`), prepend a
2–3 sentence summary paragraph generated in JavaScript (no LLM call):

```
FINANCIAL HEALTH SNAPSHOT:
You have ₹<totalBalance> across <N> account(s). This <label>, income is ₹<income> and
expenses are ₹<expenses> — a net of ₹<net> (<positive: "saving" | negative: "deficit">).
<If any budget exceeded: You are over budget on <categories>. >
<If goals exist: You have <N> active goal(s).>
```

This paragraph is generated synchronously from the already-computed values; no extra DB calls
needed. Append it to the very top of the context string.

**Implementation note:** Extend the existing `Promise.all([...])` to add `DB.getBudgets(true)`
and `DB.getRecurringPatterns()` as the 5th and 6th elements. Destructure accordingly.

---

### 2. Better Prompt Engineering

**a) Rewrite `BASE_INSTRUCTIONS`**

Replace the current generic "thoughtful financial advisor" text with a directive, role-specific
prompt:

```
You are a proactive Indian personal finance coach with deep expertise in budgeting,
saving, and spending optimisation for Indian households.
Always use Indian Rupee (₹) for all currency amounts.
Be concise — keep responses to ≤250 words unless the user explicitly asks for detail.
Lead with the direct answer or recommendation first, then provide supporting data.
Use **bold** for key numbers and amounts. Reference the user's actual data, not hypotheticals.
Do not give generic advice that ignores the numbers provided.

{context}{history_context}
User's Question: {question}
```

**b) Add output format guidelines to each `PROMPT_TEMPLATE`**

Append a short "**Format:**" block at the end of each template (do not replace existing
content):

- `PROMPT_PURCHASE_DECISION`: `Format: Start with a bold YES / NO / WAIT verdict. Use bullet points for the 3 key factors. End with one specific next step.`
- `PROMPT_SPENDING_ANALYSIS`: `Format: Lead with the top category and ₹ amount. Use a short bullet list. End with one actionable suggestion.`
- `PROMPT_GOAL_PROGRESS`: `Format: State progress percentage and ₹ remaining first. Then the monthly savings needed. End with one encouragement or adjustment.`
- `PROMPT_OPTIMIZATION`: `Format: List top 3 cuts as bullets with estimated ₹ monthly savings each. End with projected total monthly saving.`
- `PROMPT_STATUS_QUERY`: `Format: Answer in one bold sentence, then 2–3 supporting numbers as bullets.`
- `PROMPT_GENERAL`: `Format: Answer directly, stay under 200 words, reference actual ₹ amounts.`

**c) Increase history window**

Change `MAX_CONVERSATION_MESSAGES` constant from `5` to `8` so that more conversational
context is retained.

---

### 3. Dynamic Suggestion Chips

Add a new async method `_buildPersonalisedSuggestions()` to the `AI` object in
`static/js/ai.js`. It returns an array of 4–6 string suggestions derived from live DB data.
Falls back to the current 4 static strings if DB is empty or an error occurs.

**Logic (evaluate in order, collect until 6 chips):**

1. **Exceeded budget** — for each budget with `status === "exceeded"`: add
   `"Am I overspending on ${b.category_name} this month?"`
2. **Warning budget (>80% used)** — for each budget with `status === "warning"`: add
   `"How close am I to my ${b.category_name} budget limit?"`
3. **Upcoming goal deadline** — for each goal whose `deadline` is ≤30 days away (and not
   null): add `"Will I hit my ${g.name} goal by ${g.deadline}?"`
4. **Top spending category** — compute the top category from the last 30 days of expense
   transactions; add `"Why did I spend so much on ${topCat} this month?"`
5. **Low savings rate** — if `(income - expenses) / income < 0.1` for the current month and
   income > 0: add `"How can I improve my savings rate?"`
6. **Recurring bill due soon** — if any recurring pattern has `next_due_date` within 7 days:
   add `"Can I afford my upcoming ${pattern.description_pattern} payment?"`

After collecting chips from the above rules, if fewer than 4, pad with static fallbacks:
```js
const STATIC_FALLBACKS = [
  "How much did I spend last month?",
  "What's my spending this quarter?",
  "Can I afford a ₹5000 purchase?",
  "Help me reduce my spending",
];
```

Return the final array (max 6, min 4).

**Expose via API bridge:** Add `API.getPersonalisedSuggestions()` → `AI._buildPersonalisedSuggestions()`
in `static/js/api.js`.

**Wire into `renderChatMessages()` in `static/js/app.js`:**

When `chatMessages.length === 0 && !chatLoading`, render the static 4 chips immediately
(same as today) to avoid a blank UI, then fire an async update to swap them with personalised
ones after data loads. Pattern:

```js
// Render static chips immediately
container.innerHTML = buildWelcomeHtml(STATIC_FALLBACKS);

// Swap with personalised chips once data is ready
API.getPersonalisedSuggestions().then((chips) => {
  const suggestionsDiv = container.querySelector(".chat-suggestions");
  if (suggestionsDiv) {
    suggestionsDiv.innerHTML = chips
      .map((c) => `<button class="chat-suggestion" data-action="fill-chat-suggestion">${escapeHtml(c)}</button>`)
      .join("");
  }
});
```

---

### 4. Follow-up Suggestion Chips After AI Response

Add a new synchronous method `_extractFollowUpSuggestions(responseText)` to the `AI` object
in `static/js/ai.js`. Returns an array of 0–3 follow-up chip strings derived from keywords
in the response. No LLM call needed.

**Heuristic rules (evaluate all, collect first 3 matches):**

| Condition | Chip text |
|---|---|
| Response mentions a name from `SEED_CATEGORY_NAMES` | `"Show me all ${categoryName} transactions"` |
| Response mentions "goal" or "target" or "saving for" | `"How much do I need to save each month for this goal?"` |
| Response mentions "budget" | `"Show me all my budgets"` |
| Response mentions "recurring" or "bill" or "subscription" | `"What recurring bills do I have?"` |
| Response mentions "invest" or "SIP" or "mutual fund" | `"How much am I investing each month?"` |
| Response mentions "income" | `"What was my income last month?"` |
| Response mentions "save" or "savings" | `"How can I increase my savings rate?"` |
| Response mentions "afford" | `"Can I afford a ₹10000 purchase right now?"` |

Define `SEED_CATEGORY_NAMES` as a hardcoded `const` array at module top level in `ai.js`,
mirroring the keys/names of `SEED_CATEGORIES` from `db.js`. Prefer duplication over an
additional import to avoid any circular-import risk.

Return an empty array if no rules match (chips are omitted entirely — do not show an empty
container).

**Wire into `renderChatMessages()` in `static/js/app.js`:**

After rendering assistant message bubbles, if the last message is `role === "assistant"`,
call `AI._extractFollowUpSuggestions(lastMsg.content)` synchronously. If the returned array
has ≥1 chip, append a follow-up chip block:

```html
<div class="chat-followups">
  <button class="chat-suggestion chat-followup" data-action="fill-chat-suggestion">…</button>
  …
</div>
```

The `.chat-followup` class allows distinct styling from the welcome-screen chips (e.g.,
smaller font, different background).

---

### 5. Data Sharing Warning Icon in Chat UI

Add a persistent privacy warning icon inside the chat input bar so users are always aware
that their financial data is sent to an external AI provider.

**HTML change in `renderChat()` in `static/js/app.js`:**

Add a `⚠️` info-notice icon as the first child of `.chat-input-bar`, using the existing
`.info-notice` / `.info-notice-tooltip` pattern used throughout the app:

```html
<div class="chat-input-bar">
  <span class="info-notice chat-privacy-notice" tabindex="0" role="note" aria-label="Data sharing notice">
    ⚠️
    <span class="info-notice-tooltip">Your financial data (account summaries, transactions,
    goals, budgets) is sent to your configured AI provider to answer questions. Phone numbers,
    emails, PAN, and Aadhaar are automatically masked before sending. Your raw data stays only
    in this browser.</span>
  </span>
  <textarea …></textarea>
  <button …>➤</button>
</div>
```

**CSS additions in `static/css/styles.css`:**

Add `.chat-privacy-notice` rules to align the icon at the bottom of the input bar and anchor
the tooltip to the right edge (so it does not overflow the screen on mobile):

```css
.chat-privacy-notice {
  align-self: flex-end;
  margin-bottom: 10px;
  flex-shrink: 0;
  opacity: 0.6;
  font-size: 1rem;
}
.chat-privacy-notice:hover,
.chat-privacy-notice:focus {
  opacity: 1;
}
.chat-privacy-notice .info-notice-tooltip {
  left: auto;
  right: 0;
  transform: none;
  bottom: calc(100% + 8px);
}
```

The icon is unobtrusive at 60% opacity by default and becomes fully opaque on hover/focus.
The tooltip is anchored to the right to stay within the viewport on narrow screens.

> **Note:** This change is already implemented in `app.js` and `styles.css`.

---

### 5. Conversation Auto-Naming

Auto-generate a short title (≤6 words) from the first user message after the first assistant
response arrives, and persist it in the DB. Sessions currently show only a raw message preview
in the Chat History sidebar.

**DB changes (`static/js/db.js`):**

The `conversations` table has no `title` column. Add it via a guard-checked migration:

1. In `_migrateSchema()`, add:
   ```js
   const convCols = this._queryAll("PRAGMA table_info(conversations)").map((c) => c.name);
   if (!convCols.includes("title")) {
     this._exec("ALTER TABLE conversations ADD COLUMN title TEXT");
   }
   ```
   No `SCHEMA_VERSION` bump required — the project uses `PRAGMA table_info` guard checks for
   additive migrations (consistent with existing pattern).

2. Add `DB.updateConversationTitle(chatId, title)`:
   ```sql
   UPDATE conversations SET title = ? WHERE chat_id = ? AND title IS NULL
   ```
   The `WHERE title IS NULL` condition makes the method idempotent — safe to call multiple
   times without overwriting a future user-set title. Call `await this._persist()` after.

3. Add `DB.getConversationTitle(chatId)` method:
   ```sql
   SELECT title FROM conversations WHERE chat_id = ? AND title IS NOT NULL LIMIT 1
   ```
   Returns the title string or `null`.

4. Update `DB.listChatSessions()` to `SELECT title` and return it as a field on each session
   object. If `title` is non-null, prefer it over the raw preview.

**AI changes (`static/js/ai.js`):**

Add a helper `_generateSessionTitle(firstUserMessage)` — pure, synchronous, no LLM call:

1. Strip leading/trailing whitespace and punctuation.
2. Remove common filler prefixes (case-insensitive): "can you", "please", "what is",
   "how much", "tell me", "show me".
3. Truncate to first 6 words.
4. Title-case the result.
5. Return the cleaned string (max 40 chars; append "…" if truncated).

In `AI.chat()`, after saving the assistant response, auto-name only on the first exchange.
Detect this by checking `history.length <= 1` (the history loaded before the LLM call). If
true, compute the title and call `DB.updateConversationTitle(resolvedChatId, title)`.

**API bridge (`static/js/api.js`):**

Add:
```js
updateConversationTitle(chatId, title) {
  return DB.updateConversationTitle(chatId, title);
},
```

**UI changes (`static/js/app.js`):**

In `showChatSessions()`, replace `s.preview` with `s.title || s.preview` for the display
text of each session item. No structural change — `listChatSessions()` returns the `title`
field once the DB method is updated.

---

### 6. PII Masking for All App-Generated LLM Context

The LLM should never receive unmasked personal data that originates from the app's DB or
prompt templates. Conversely, the user's own typed messages do not need PII scanning —
they are the user's own words.

**Current state (gap analysis):**

| Data | Currently masked? | Required? |
|------|------------------|-----------|
| `tx.description` in context | ✅ yes | yes |
| Conversation history — user role | ✅ yes (masked in `_buildPrompt` and messages array) | ❌ no — user's own text, skip |
| Conversation history — assistant role | ✅ yes (masked together with user) | ✅ yes — contains app-generated context |
| Account names (`a.name`) in context | ❌ no | ✅ yes |
| Goal names (`g.name`) in context | ❌ no | ✅ yes |
| Recurring bill patterns (`p.description_pattern`) in context | ❌ no | ✅ yes |
| Budget category names in context | no PII risk (seeded names like "Food") | not required |
| Health snapshot (computed numerics only) | n/a | no PII in numerics |

**Changes required in `static/js/ai.js`:**

**a) Stop masking user-typed messages**

In `_buildPrompt()`, only mask assistant messages in the history context:
```js
// Before (masks all roles):
historyContext += `${role}: ${maskPII(msg.content)}\n`;

// After (only mask assistant messages):
historyContext += `${role}: ${
  msg.role === "assistant" ? maskPII(msg.content) : msg.content
}\n`;
```

In the `messages` array built in `chat()` before the LLM call, do not apply `maskPII` to
user-role messages:
```js
// Before:
.map((m) => ({ role: m.role, content: maskPII(m.content) }))

// After:
.map((m) => ({ role: m.role, content: m.role === "assistant" ? maskPII(m.content) : m.content }))
```

**b) Mask account names in `_buildContext()`**

When building `accountsLines`, apply `maskPII()` to the account name:
```js
// Before:
return `- ${a.name}: ₹${...} (${a.account_type})`;

// After:
return `- ${maskPII(a.name)}: ₹${...} (${a.account_type})`;
```

**c) Mask goal names in `_buildContext()`**

When building `goalsLines`, apply `maskPII()` to the goal name:
```js
// Before:
return `- ${g.name}: ₹${...}`;

// After:
return `- ${maskPII(g.name)}: ₹${...}`;
```

**d) Mask recurring bill patterns in `_buildContext()`**

When building the recurring bills section (added in Scope §1b), apply `maskPII()` to the
`description_pattern` field:
```js
// After masking:
`- ${maskPII(p.description_pattern)}: ₹${p.amount} every ${p.frequency_days} days — ...`
```

**Principle:** Any free-text field that came from user input or transaction data (names,
descriptions, patterns) must pass through `maskPII()` before being included in the prompt.
Numeric fields (amounts, dates, percentages, counts) are not PII and do not need masking.
Category names from `SEED_CATEGORIES` are app-defined constants and do not need masking.

---

## Implementation Notes

- `AI._buildPersonalisedSuggestions()` and `AI._extractFollowUpSuggestions()` are methods on
  the `AI` object, following the same pattern as `AI.getSettings()`, `AI.chat()`, etc.
- `_extractFollowUpSuggestions` is **synchronous** — called directly from `renderChatMessages()`
  without `await`. No extra loading state needed.
- `_buildPersonalisedSuggestions` is **async** — calls `DB.getBudgets`, `DB.getGoals`,
  `DB.getRecurringPatterns`, and `DB.getTransactions`. Use `Promise.all` internally.
- The two-phase chip render (static → personalised) must not block the initial paint. The
  static chips are rendered synchronously; the swap is done in a `.then()` callback.
- `DB.updateConversationTitle` uses `WHERE title IS NULL` to make it idempotent — safe to
  call multiple times without overwriting a manually-set title in the future.
- `SEED_CATEGORY_NAMES` constant in `ai.js` is a hardcoded array matching the category names
  seeded by `SEED_CATEGORIES` in `db.js`. Prefer duplication over a new import to avoid any
  circular-dependency risk (`ai.js` already imports `DB` from `db.js`).
- The follow-up chip container `div.chat-followups` is only rendered when
  `_extractFollowUpSuggestions` returns ≥1 chip.
- **PII masking rule of thumb**: any free-text field sourced from user input or transaction
  data (account names, goal names, merchant/description patterns) must pass through
  `maskPII()` before inclusion in a prompt. Numeric fields and app-defined constants
  (category names, status labels) do not need masking.
- User-typed chat messages are **not** passed through `maskPII()` — they are the user's own
  words. Only app-generated context and assistant-role history entries are masked.
- All new strings use ₹ (not Rs. or INR).

---

## Acceptance Criteria

1. The context block passed to the LLM includes active budgets (with spent/limit/status) and
   recurring bill patterns (with next due dates).
2. The context block begins with a plain-English 2–3 sentence financial health snapshot
   computed from the same data (no extra LLM call).
3. `BASE_INSTRUCTIONS` names the advisor as a "proactive Indian personal finance coach",
   enforces ≤250-word responses, and instructs leading with a recommendation.
4. Each `PROMPT_TEMPLATE` ends with a "Format:" instruction specifying the expected output
   structure (verdict + bullets + one next step, etc.).
5. On chat load with an empty message list, the suggestion chips are derived from live DB
   data (budget overruns, near-deadline goals, top spending category). Falls back to the
   original 4 static chips if DB has no relevant data.
6. After each assistant response, 1–3 follow-up suggestion chips appear below the last
   assistant bubble, derived from keywords in the response text.
7. After the first exchange in a new chat session, the session receives an auto-generated
   title (≤6 words, title-cased, stripped of filler words). The title appears in the Chat
   History sidebar in place of the raw message preview.
8. Account names, goal names, and recurring bill pattern strings included in the LLM context
   are passed through `maskPII()` before being sent to any AI provider.
9. User-typed chat messages are no longer passed through `maskPII()` in the messages array
   or in history context building — only assistant-role messages are masked there.
10. All existing unit tests pass without modification.
11. `make lint` passes (biome — 100-char lines, tabs, double quotes).

---

## Out of Scope

- Streaming responses (chunked SSE rendering)
- LLM-generated session titles (would require an extra API call per session)
- User-editable conversation titles (UI for renaming sessions)
- Changes to `_buildHeuristicResponse()` (no-AI fallback path; that path never calls external LLMs)
- PII scanning of user-typed messages (out of scope by design — user's own words)
- Any schema change requiring a `SCHEMA_VERSION` bump or export-format migration

---

## File Summary

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `static/js/ai.js` | Extend `_buildContext` (budgets + bills + health snapshot + PII masking for account/goal names and bill patterns); rewrite `BASE_INSTRUCTIONS`; add Format blocks to `PROMPT_TEMPLATES`; raise `MAX_CONVERSATION_MESSAGES` to 8; fix PII masking in history context and messages array (user role skipped, assistant role kept); add `_buildPersonalisedSuggestions()`; add `_extractFollowUpSuggestions()`; add `_generateSessionTitle()`; update `chat()` to auto-name on first exchange; add `SEED_CATEGORY_NAMES` constant |
| MODIFY | `static/js/db.js` | Add `conversations.title` column migration in `_migrateSchema()`; add `DB.updateConversationTitle(chatId, title)`; add `DB.getConversationTitle(chatId)`; update `DB.listChatSessions()` to return `title` field |
| MODIFY | `static/js/api.js` | Add `API.getPersonalisedSuggestions()`; add `API.updateConversationTitle(chatId, title)` |
| MODIFY | `static/js/app.js` | Update `renderChatMessages()` for two-phase chip render and follow-up chips; update `showChatSessions()` to use `title`; add data-sharing warning icon to `renderChat()` input bar |
| MODIFY | `static/css/styles.css` | Add `.chat-privacy-notice` rules for warning icon alignment and tooltip positioning |
| CREATE | `tests/js/ai-chat-improvements.test.js` | Unit tests for `_buildPersonalisedSuggestions()`, `_extractFollowUpSuggestions()`, `_generateSessionTitle()`, updated `_buildContext()` PII masking, corrected history masking behaviour |
| CREATE | `tests/e2e/js/chat-improvements.spec.js` | E2E tests: dynamic chips on empty chat, follow-up chips after response, session title in history sidebar |

---

## Implementation Order

1. **`static/js/db.js`** — Add `conversations.title` migration, `updateConversationTitle()`,
   `getConversationTitle()`, update `listChatSessions()`.
2. **`static/js/ai.js`** — Extend `_buildContext()`, rewrite `BASE_INSTRUCTIONS`, add Format
   blocks, raise `MAX_CONVERSATION_MESSAGES`, add the three new helper methods, update
   `chat()` auto-naming. This is the largest change.
3. **`static/js/api.js`** — Add bridge methods.
4. **`static/js/app.js`** — Update `renderChatMessages()` (two-phase chip render + follow-up
   chips) and `showChatSessions()` (title display).
5. **`make lint`** — Fix any formatting issues before writing tests.
6. **`tests/js/ai-chat-improvements.test.js`** — Unit tests (developer agent).
7. **`make test-unit`** — Verify all pass.
8. **`tests/e2e/js/chat-improvements.spec.js`** — E2E tests (tester agent).
9. **`make test-e2e`** — Verify all pass.

---

## Risks & Notes

- **`_buildPersonalisedSuggestions()` async in render**: `renderChatMessages()` is currently
  synchronous. The async chip update must be done as a two-phase render (show static chips
  immediately, swap once the Promise resolves) to avoid blocking the initial paint.
- **`_extractFollowUpSuggestions` false positives**: Simple substring matching on category
  names may trigger on unrelated text. Mitigate by checking for word-boundary or title-case
  matches for multi-word category names.
- **Budget `category_name` field**: Verify that `DB.getBudgets()` already returns
  `category_name` via its JOIN before the developer starts (grep `getBudgets` in `db.js`).
- **Idempotent title writes**: `WHERE title IS NULL` in `updateConversationTitle` ensures
  that once a title is set, it is never overwritten — even if `chat()` is called again on
  the same `chatId` (e.g., if the user continues a session later).
