# Feature: Proactive AI Insights & Weekly Digest

## Problem

Financial Coach currently operates in a purely reactive mode — the AI only responds when
the user explicitly asks a question. A true financial coach proactively surfaces insights,
flags anomalies, and nudges the user toward better habits without being asked.

## Goal

Transform the coaching experience from reactive Q&A into a proactive advisor that:
- Surfaces a weekly financial digest on the Dashboard
- Flags unusual spending spikes automatically
- Celebrates wins (goal milestones, budget under-spend)
- Warns about upcoming risks (budget approaching limit, goal behind schedule)

## Scope

### 1. Weekly Digest Card (Dashboard)
A collapsible card on the Dashboard that appears every Monday (or on first open of the
week) showing an AI-generated summary of the previous week:
- Top spending categories vs. the week before
- Any budget nearing the limit
- Progress toward active goals
- One actionable tip ("You spent ₹3,200 more on Food this week — skipping 2 Zomato orders
  saves ~₹800/month")

The digest is generated lazily (computed when the card is rendered, cached in `localStorage`
under `fincoach-weekly-digest-{YYYY-WW}` so it is only recomputed once per week).

### 2. Insight Badges on Dashboard Cards
Small inline badges next to budget/goal cards when the app detects something worth flagging:
- 🔴 Budget exceeded
- 🟡 Budget >80% used with >5 days left in the period
- 🟢 Goal on track / ahead of schedule
- ⚡ Unusual spending spike (>50% above 4-week average for a category)

These are computed locally without an LLM call (pure arithmetic on DB data), so they work
offline and require no AI provider configuration.

### 3. AI-Powered "Get Coaching" Shortcut (Dashboard)
A "Get Coaching" button on the Dashboard that pre-populates the chat with a context-aware
prompt:
> "Review my finances for this month. What are the top 3 things I should act on?"

This reuses the existing `AI.chat()` infrastructure — no new API surface needed.

## Implementation Notes

- Weekly digest uses `AI.chat()` with a purpose-built prompt; result cached in `localStorage`
  under `fincoach-weekly-digest-{YYYY-WW}` to avoid recomputing on every page load
- Insight badges are computed in `db.js` (new helper `getInsights()`) and rendered in `app.js`
  `renderDashboard()` — no LLM call required
- No new DB tables needed; insights are derived from existing `budgets`, `goals`, and
  `transactions` data

## Acceptance Criteria

1. Dashboard shows a "This Week" digest card; regenerates at most once per week
2. Budget cards show a coloured badge when >80% used or exceeded
3. Goal cards show a badge when behind schedule
4. "Get Coaching" button opens chat with a pre-filled prompt
5. All badge logic works offline — no LLM dependency
6. `make lint` passes; unit tests cover `getInsights()` helper

## Out of Scope

- Server-side push notifications (see `requirements/13_push_notifications.md`)
- Email digest / external notifications
- Per-category anomaly thresholds customised by the user
