# Quality Review Report

**Date:** 2026-08-22  
**Diff:** `origin/dev...20ac662acc359ba694d350041f6e88c736dc7fe5`  
**Design Doc:** none  
**[Blocker]:** 0 | **[Major]:** 1 | **[Suggestion]:** 2 | **[Nit]:** 1

## Findings

### Finding 1: Saved-route ingest bypasses turn-callout reconciliation

**Category:** design pattern  
**Severity:** [Major]  
**File:** [docs/app/draw.js:3717](../../../../../../docs/app/draw.js#L3717)

**Problem:** The new invariant is enforced only when `seedCommChangeNotes()` is called. The file-import and saved-route path in `applyRouteData()` restores `state.waypoints` and `state.notes`, calls `syncLegs()`, and then redraws without calling this function. The startup restore path also invokes the seeder only when `showCommChange` is true. Consequently, an imported or restored route can retain a persisted automatic or manual frequency-change callout at its turning point—especially when the overlay is disabled—until an unrelated edit happens to trigger reconciliation. That contradicts the documented invariant that a turning waypoint cannot carry the callout.

**Fix:** Reconcile immediately after every route-ingest `syncLegs()` call, independent of `showCommChange`. For example, call `seedCommChangeNotes()` from `applyRouteData()` before `draw()`, and make the post-`restoreRoute()` reconciliation unconditional. Keep the internal `showCommChange` gate at line 3721 so the call always prunes the turn while only seeding new callouts when the layer is enabled. Add an import/restore regression containing a persisted `wp.turn` and matching `cc` note.

---

### Finding 2: Selection repair and reversible re-seeding are untested

**Category:** tests  
**Severity:** [Suggestion]  
**File:** [tests/leg-direction-filter.spec.js:434](../../../../../../tests/leg-direction-filter.spec.js#L434)

**Problem:** `pruneTurnCommChangeNotes()` adds non-trivial index repair for both `{type: 'note'}` and waypoint `freqNoteIndex` selections, but the new preservation test leaves `state.selected` unset. The approved RCA also requires clearing or moving the turn to permit normal automatic re-seeding, while the test checks only that no suppression was added. These branches could regress without any focused failure, including a stale selection deleting or editing the wrong surviving note.

**Fix:** Extend the focused cases to select (1) the removed turn callout and (2) an unrelated note whose index shifts, then assert the former clears and the latter is reindexed to the same object. Toggle a manual turn off and assert the eligible automatic callout is seeded again while `commChangeSuppressions` remains empty.

---

### Finding 3: Added prose exceeds the repository review bounds

**Category:** comment hygiene  
**Severity:** [Suggestion]  
**File:** [.ai/navaid-dev.md:352](../../../../../../.ai/navaid-dev.md#L352)

**Problem:** `check-comment-bounds.py --include-markdown` reports 14 newly added sentences over its 25-word advisory bound: `.ai/navaid-dev.md:352`; `.ai/plans/bugs-turn-freq-change/investigation.md:7,16,18,22,27,67,70,86` (two sentences at line 86), `87` (two sentences at line 87), and `102`; plus `.ai/plans/bugs-turn-freq-change/rca-report.md:25,29`. Several combine multiple lifecycle conditions into one sentence and are harder to scan than the surrounding handbook text.

**Fix:** Split each reported sentence at its logical condition or outcome while preserving the rationale. In particular, split the developer-guide statement after “callout,” and divide each test scenario into setup, action, and assertion sentences.

---

### Finding 4: Investigation artifact fails `git diff --check`

**Category:** convention  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-turn-freq-change/investigation.md:7](../../../../../../.ai/plans/bugs-turn-freq-change/investigation.md#L7)

**Problem:** Lines 7–11 and 93 end with Markdown hard-break spaces. `git diff --check origin/dev...HEAD` reports all six as trailing whitespace, so the verification command promised in the approved RCA is not clean.

**Fix:** Remove the trailing spaces on lines 7–11 and 93. Use separate paragraphs or ordinary line breaks if visual separation is needed.

---

## Merge Recommendation

APPROVE WITH WARNINGS

The runtime implementation is small and generally well-factored, but saved-route ingest can bypass the new invariant and should be corrected before the PR is readied. The remaining findings improve regression coverage and keep the committed review artifacts mechanically clean.

## Cleared

Areas actively reviewed and found clean:

- Duplication/YAGNI: the shared pruning helper avoids duplicating removal logic across inspector and keyboard paths.
- Performance: reconciliation is linear in the small in-memory waypoint/note collections and introduces no hot-loop or network cost.
- Interaction guards: both the inspector action and `Z` shortcut converge on `addCommChangeNoteForWaypoint()` and reject the effective turn.
- Styling: `.insp-btn-on` now changes emphasis only, so safe set/unset actions retain their theme colors while destructive actions remain red.
- Syntax: `node --check` passes for the changed shipped JavaScript files.
- Scope and dependencies: no new dependency, persistence key, schema, or unrelated runtime abstraction was introduced.
