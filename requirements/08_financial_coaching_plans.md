# Feature: AI-Driven Financial Coaching Plans

## Problem

The chat interface answers one-off questions but provides no structured, multi-step
guidance toward a financial goal. A user asking "How do I save ₹5 lakh for a house down
payment in 2 years?" receives a text answer but has no tracked action plan to follow.
The advice is forgotten as soon as the chat session ends.

## Goal

Allow the AI to generate a structured **Coaching Plan** — a named, multi-step action plan
with checkable milestones — that persists in the app and tracks the user's progress.

## Schema Changes

Two new tables (added to `SCHEMA_SQL` in `db.js`):

```sql
CREATE TABLE IF NOT EXISTS coaching_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  ai_provider TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS coaching_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES coaching_plans(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  description TEXT NOT NULL,
  is_done INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  completed_at TEXT
);
```

## Features

### Plan Generation via Chat
A "Create a Plan" suggestion chip displayed in the Chat screen alongside the existing quick
suggestions. The user describes their goal in natural language; the AI is prompted to return
a structured JSON plan with 3–7 actionable steps. The app validates and parses the JSON
before inserting it into the DB.

AI prompt for plan generation (appended to the existing `BASE_INSTRUCTIONS` context):
```
Generate a structured financial coaching plan as JSON.
Respond ONLY with valid JSON in this exact format:
{
  "title": "Short plan title",
  "summary": "One paragraph summary",
  "steps": [
    { "step": 1, "description": "Actionable step", "due_date": "YYYY-MM-DD or null" }
  ]
}
Do not include any text outside the JSON block.
```

### Plans Screen
A new screen accessible via a "Plans" nav item (overflow menu). Shows:
- Active plans with a checklist of steps, % completion progress bar
- Completed plans in a collapsible "Completed" section
- "New Plan" button that opens the chat with the plan-creation prompt pre-filled

### Step Interaction
Tapping a step in the checklist:
- Marks it done (`is_done = 1`, `completed_at = now()`)
- Updates the plan's progress bar
- If all steps done, marks the plan complete with a celebratory toast

## Implementation Notes

- New `db.js` methods: `createCoachingPlan(plan)`, `getCoachingPlans()`,
  `markStepDone(stepId)`, `deleteCoachingPlan(id)`
- New `app.js` screen: `renderCoachingPlans()` registered as route `#plans`
- JSON validation in `app.js` before DB insert: verify `title` (string), `steps` (array,
  1–10 items), each step has `description` (string ≤ 500 chars), `due_date` (null or
  parseable date)
- If AI response is not valid JSON, show an error toast and keep the chat open for retry
- `await this._persist()` called after every `coaching_plans` / `coaching_steps` write

## Acceptance Criteria

1. "Create a Plan" chip appears in the Chat screen
2. AI generates a valid JSON plan; the app parses it and persists the plan + steps
3. Plans screen shows active plans with checkable steps and a progress bar
4. Checking off all steps marks the plan complete
5. Invalid AI JSON response shows an error toast (no crash)
6. Plans survive app reload (IndexedDB persistence)
7. `make lint` passes; unit tests cover plan parsing/validation and DB methods

## Out of Scope

- Automatic step completion based on transaction data
- Plan sharing or export to PDF
- Plan templates (pre-built plans for common goals)
