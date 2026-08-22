# Quality Review Report

**Date:** 2026-08-22
**Diff:** PR #1804 head `90a315b3`
**Design Doc:** none; reviewed against `intent-context.md`
**[Blocker]:** 0 | **[Major]:** 0 | **[Suggestion]:** 1 | **[Nit]:** 1

## Findings

### Finding 1: Restore regression covers only an explicitly marked turn

**Category:** tests
**Severity:** [Suggestion]
**File:** `tests/leg-direction-filter.spec.js:604`

**Problem:** The new restore/import regression marks TYONA with `setTurnWaypoint(2)` before serializing. That proves reconciliation for a persisted manual `waypoint.turn`, but it does not prove the same startup/import boundary removes a callout at a geometry-derived turn. The implementation is deliberately attached to the common `syncLegs()` boundary and the intent requires the effective turn, including a retraced route whose saved waypoints have no explicit `turn` flag. A future restore-order change could leave `state.legs` unavailable when reconciliation runs and still pass this test because manual-turn detection does not depend on retrace geometry.

**Fix:** Add a saved/imported out-and-back route with no explicit `turn` flag, place a persisted automatic or manual callout at its first retraced leg's start, and assert both `applyRouteData()` and `restoreRoute()` remove it while preserving an unrelated note.

### Finding 2: Added reconciliation comment exceeds the advisory sentence bound

**Category:** comment hygiene
**Severity:** [Nit]
**File:** `docs/app/core.js:4063`

**Problem:** `check-comment-bounds.py` reports the added reconciliation sentence at 32 words, above its advisory 25-word limit. The repository has no root `WRITING-VOCABULARY.md`, so this does not fail the check.

**Fix:** Split the reason for using the shared boundary from the no-persistent-suppression consequence.

## Merge Recommendation

APPROVE

The implementation correctly invokes the existing synchronous reconciliation after route geometry, notes, and suppressions are installed. It is guarded for script-load order, has no recursion path, repairs removed or shifted note selection through the existing helper, and keeps turn removal independent of the overlay toggle. The missing geometry-derived restore case is a focused test-hardening suggestion rather than a demonstrated defect.

## Cleared

Areas actively reviewed and found clean:

- Startup/load safety: `draw.js` is loaded before `io.js` and `ui.js`; the `typeof` guard also keeps `core.js` safe in isolation.
- Reconciliation timing: both `applyRouteData()` and `restoreRoute()` install waypoints, legs, notes, and suppressions before `syncLegs()`.
- Selection repair: removed selected notes become null, while surviving note objects follow their shifted index.
- Suppression behavior: structural turn removal does not create a persistent suppression, so moving or clearing the turn permits normal reseeding.
- Recursion: `seedCommChangeNotes()` does not call `syncLegs()` directly or indirectly.
- Performance: the extra reconciliation is synchronous and bounded by route/waypoint data; duplicate explicit seeding at some callers is idempotent and not material at expected route sizes.
- Conventions: the five-line source change is narrowly scoped and `node --check docs/app/core.js` passes.
- Runtime verification: the two added Chromium regressions passed locally (2 tests, 2 passed).
- Patch hygiene: `git diff --check origin/dev...HEAD` passes.

## Incomplete Checks

None.
