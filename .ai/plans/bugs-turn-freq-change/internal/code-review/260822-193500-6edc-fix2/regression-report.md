# Regression review

## Recommendation

**NEEDS CHANGES**

## Findings

### [P1] Keep full callout seeding out of the generic leg synchronizer

**Location:** `docs/app/core.js:4067`

Calling `seedCommChangeNotes()` unconditionally from `syncLegs()` changes that low-level synchronizer from geometry/leg reconciliation into a callout-creation action. With communication data loaded, even synchronizing a single route waypoint now creates a linked frequency note. That replaces the deliberately supported read-only communication-change badge with the editable linked-callout inspector.

This is introduced by this PR and breaks three existing focused regressions:

- `inspector grows a Comm change badge for a TYONA-named route waypoint`
- `inspector badge resolves a Hebrew-labelled waypoint to its comm-change point`
- `fixture entry without from/to renders badge + note, omits freq row`

All three pass against exact `origin/dev` and fail against PR head. The full `tests/comm-change.spec.js` result on PR head is **23 passed, 3 failed**; the same three targeted tests on `origin/dev` are **3 passed**.

Keep the restored/imported-turn cleanup at the shared boundary without making every `syncLegs()` invocation seed missing callouts. A narrow turn-callout reconciliation helper, or explicit reconciliation at route restore/import and turn-changing call sites, would preserve the intended cleanup, selection repair, no-suppression behavior, and normal reseeding while leaving ordinary `syncLegs()` semantics intact. Add or retain coverage for the read-only badge path when no linked callout exists.

## Verified behavior

- Saved import and startup restore remove the effective turn's persisted automatic/manual callout.
- Removing the selected turn callout clears the selection.
- Removing an earlier turn callout reindexes a selected unrelated note to the same object.
- Unrelated ordinary notes remain.
- Turn-driven removal creates no persistent communication suppression.
- Moving or clearing the turn permits normal automatic reseeding.
- Straight routes retain their frequency callouts.
- Manual-turn and route-direction behavior remains intact in the focused suite.

## Test evidence

- `tests/leg-direction-filter.spec.js`: **41 passed**.
- Focused turn/import subset: **5 passed**.
- `tests/comm-change.spec.js` on PR head: **23 passed, 3 failed**.
- The three failing communication-inspector tests against exact `origin/dev`: **3 passed**.
- `node --check docs/app/core.js docs/app/draw.js docs/app/interact.js docs/app/io.js`: passed.
- `git diff --check origin/dev...HEAD`: passed.

## Counts

- P0: 0
- P1: 1
- P2: 0
- P3: 0
- Total findings: 1

## Incomplete

- No incomplete review areas. The first full test attempt lost an externally supplied local server after 19 passing tests; it was rerun with a dedicated server and completed successfully. The failed communication-change cases were independently compared with `origin/dev`.
