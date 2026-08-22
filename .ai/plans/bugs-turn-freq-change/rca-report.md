---
status: approved
---

# RCA — turn-freq-change: remove frequency changes at turning points

**Tier**: lean   ·   **Confidence**: HIGH   ·   **Service(s)**: NavAid static web app

## What's happening

NavAid correctly identifies a route's effective turning waypoint, but an existing frequency-change callout can remain there. Marking the point manually also leaves the callout in place, and the inspector or `Z` shortcut can recreate it. The inspector's current selected-state color also makes a non-destructive set/unset action look like a separate color-coded action.

## Root cause

`seedCommChangeNotes()` in `docs/app/draw.js:3693-3829` only skips fresh automatic creation at the effective turn; it deliberately preserves existing automatic and manual notes. `setTurnWaypoint()` and the inspector/add-keyboard paths in `docs/app/core.js:4550-4555` and `docs/app/interact.js:201-276,3000-3024,4291-4300` do not enforce the same invariant immediately.

## Suggested fix

- `docs/app/draw.js` — reconcile every frequency-change note against `legRetraceTurnIndex()`, removing all callouts linked to the effective turn without creating a permanent suppression. Preserve unrelated notes and repair note selection after removal.
- `docs/app/interact.js` — reconcile immediately after marking a turn, and prevent the inspector action and `Z` shortcut from adding a callout at the effective turn.
- `docs/app/style.css` — keep destructive actions red, but make the shared set/unset selected state bold without changing its safe foreground, background, or border colors.
- `tests/leg-direction-filter.spec.js` — replace the obsolete manual-note-survives expectation with derived-turn, manual-turn, preservation, and keyboard regressions.
- `.ai/navaid-dev.md` — document that an effective turning point cannot carry an automatic or manual route frequency-change callout.

**Expected shape**: 5 files, ~115 lines · extend the existing callout reconciliation, inspector action/state style, focused browser spec, and developer guide · new test files: 0

## Failing test (written, red)

`tests/leg-direction-filter.spec.js` (browser integration) — three focused cases assert that derived and manually marked turns remove their callouts, preserve unrelated notes, hide the add control, reject `Z`, and use bold rather than a color change for the selected state. All three fail on the current implementation for the expected obsolete behavior.

## Verification plan

- Unit/integration: run the focused `tests/leg-direction-filter.spec.js` cases and adjacent frequency-change cases.
- Syntax/lint: run `node --check` on every changed shipped JavaScript file and `git diff --check`.
- E2E + live env: CI/deployed E2E, because the fix changes inspector and keyboard behavior in the browser.
- New executable(s): none.

## Deferred / follow-ups

none
