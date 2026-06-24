# Feature: First-Run Onboarding Wizard

## Problem

A new user opening Financial Coach for the first time sees a blank Dashboard with empty
cards and no guidance. There is no indication of what to do first — connect Gmail, set up
an AI provider, add an account — or why any of it is useful. The cold-start experience is
a significant barrier to adoption.

## Goal

Show a guided onboarding wizard on first launch that helps the user:
1. Understand what the app does (30-second value pitch)
2. Add their first account
3. Connect Gmail (optional — unlocks automatic transaction import)
4. Set up an AI provider (optional — unlocks coaching features)
5. Land on the Dashboard with at least one piece of data visible

The wizard must be skippable at any step.

## Trigger & State

- **Trigger**: `localStorage` key `fincoach-onboarded` is absent or `false`
- **State**: current wizard step stored in `localStorage` under `fincoach-onboarding-step`
  (integer 1–5) so the wizard resumes from the correct step if the user closes the app mid-flow
- **Completion**: after finishing step 5 or skipping all remaining steps, set
  `fincoach-onboarded = true` and remove `fincoach-onboarding-step`

## Wizard Steps

Each step is rendered as a full-screen modal overlay with a step-indicator bar at the top
(e.g., ● ○ ○ ○ ○) and a "Skip →" link in the top-right corner.

### Step 1 — Welcome
- Headline: "Welcome to Financial Coach"
- Body: 3–4 sentences explaining local-first, private, AI-powered coaching (data stays on
  your device; AI queries go to your chosen provider)
- CTA button: "Let's get started →"

### Step 2 — Add Your First Account
- Headline: "Where is your money?"
- Body: "Add a bank account or wallet to start tracking."
- Inline mini-form (account name, type, opening balance) — same fields as the existing
  account creation modal; reuses `doCreateAccount()` logic
- On save: creates the account and advances to step 3
- Skip link: "I'll do this later"

### Step 3 — Connect Gmail (Optional)
- Headline: "Auto-import your transactions"
- Body: "We read bank email alerts to detect transactions. We never store your emails —
  everything stays on your device."
- CTA: "Connect Gmail" → launches existing `connectGmail()` flow; on success, advances to step 4
- Skip link: "Skip for now"

### Step 4 — Set Up AI Coaching (Optional)
- Headline: "Get a personal financial coach"
- Body: "Connect a free AI provider (Groq has a generous free tier; Ollama runs fully offline)
  to get personalised spending analysis and coaching."
- CTA: "Set Up AI" → closes wizard, sets `fincoach-onboarded = true`, and navigates to
  `#settings` with an `?onboarding=1` hint that auto-scrolls to the AI section
- Skip link: "Skip for now" → advances to step 5

### Step 5 — You're Ready
- Headline: "You're all set!"
- Shows a summary bullet list of what was configured (account added ✓ / Gmail connected ✓
  / AI set up ✓, or "not yet" for each skipped step with a link to configure later)
- CTA: "Go to Dashboard →" → completes onboarding

## Re-Triggering

A "Restart onboarding tour" link in the Settings screen clears `fincoach-onboarded` and
`fincoach-onboarding-step` from `localStorage` and reloads the wizard.

## Implementation Notes

- Wizard rendered in `app.js` `init()` before the main router runs, as a `.modal-overlay`
  on top of the normal app shell
- Step rendering: `renderOnboardingStep(step)` function in `app.js`
- Reuses `doCreateAccount(el)` for the account creation form in step 2
- No new DB tables needed — state lives entirely in `localStorage`
- Wizard overlay removed when `fincoach-onboarded = true` is set; normal router then runs

## Acceptance Criteria

1. First-time user (no `fincoach-onboarded` key) sees the wizard automatically
2. Each step is independently skippable via the "Skip →" link
3. Skipping all steps still sets `fincoach-onboarded = true` and dismisses the wizard
4. Re-opening the app does not show the wizard again once completed
5. Wizard resumes from the correct step if the user closes and reopens mid-flow
6. "Restart onboarding tour" in Settings re-triggers the wizard
7. `make lint` passes
8. E2E test covers: fresh load shows wizard; skip-all flow; wizard does not re-appear on reload

## Out of Scope

- Animated step transitions
- Demo / sample data population
- Onboarding video or external links
