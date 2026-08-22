# Quality Review Report

**Date:** 2026-08-22
**Diff:** PR #1797 head `c20c5e2bd667101b86b9cd938a5e7f258eaa6db9`
**Design Doc:** `.ai/plans/bugs-return-route-turning-point/rca-report.md`
**[Blocker]:** 0 | **[Major]:** 0 | **[Suggestion]:** 1 | **[Nit]:** 18

## Findings

### Finding 1: Repeated-coordinate visibility branch is not pinned by the regression

**Category:** tests  
**Severity:** [Suggestion]  
**File:** [tests/leg-direction-filter.spec.js:147](../../../../tests/leg-direction-filter.spec.js#L147)

**Problem:** The new helper deliberately scans every matching route occurrence and keeps a hotspot when any occurrence belongs to the visible direction. The regression covers a hotspot that occurs only in the hidden half, while its repeated `BEFORE` coordinate is unrelated to the hotspot assertion. An implementation that stopped at the first matching route occurrence could therefore regress the promised repeated-coordinate behavior without failing this test.

**Fix:** Extend this test, or add an adjacent case, that places the same hotspot coordinate once in the hidden half and once in the visible half. Assert that `routePointOnlyInHiddenDirection(hadra)` is false and that `__hotspotOverlayCount` remains 1 for the selected direction.

---

### Finding 2: Overlong sentence in FE resolution uncertainty

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/frontend/fe-resolution.md:46](../../../../.ai/plans/bugs-return-route-turning-point/frontend/fe-resolution.md#L46)

**Problem:** The automated comment-bound check reports this 26-word sentence above the advisory 25-word limit.

**Fix:** Split the sentence after “manual override.”

---

### Finding 3: Overlong grounding summary

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/frontend/fe-resolution.md:50](../../../../.ai/plans/bugs-return-route-turning-point/frontend/fe-resolution.md#L50)

**Problem:** The automated comment-bound check reports this 39-word sentence above the advisory limit.

**Fix:** Split the code-walk, KB, and DS conclusions into separate short sentences.

---

### Finding 4: Overlong investigation root-cause sentence

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:16](../../../../.ai/plans/bugs-return-route-turning-point/investigation.md#L16)

**Problem:** The automated comment-bound check reports a 58-word sentence.

**Fix:** Separate the render-path evidence from the hit-test evidence.

---

### Finding 5: Overlong inspector-state sentence

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:18](../../../../.ai/plans/bugs-return-route-turning-point/investigation.md#L18)

**Problem:** The automated comment-bound check reports the first sentence on this line at 32 words.

**Fix:** End the sentence after the serialized `wp.turn` comparison and state the source location separately.

---

### Finding 6: Overlong airfield predicate sentence

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:18](../../../../.ai/plans/bugs-return-route-turning-point/investigation.md#L18)

**Problem:** The automated comment-bound check reports the airfield predicate sentence on this line at 30 words.

**Fix:** Split the predicate statement from the ordinary-waypoint/airfield behavior statement.

---

### Finding 7: Overlong affected-file entry

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:62](../../../../.ai/plans/bugs-return-route-turning-point/investigation.md#L62)

**Problem:** The automated comment-bound check reports this 41-word list item.

**Fix:** Use separate bullets for the unchanged branch, `afInsp` guard, and effective-turn state.

---

### Finding 8: Overlong related-test entry

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:71](../../../../.ai/plans/bugs-return-route-turning-point/investigation.md#L71)

**Problem:** The automated comment-bound check reports this 27-word list item.

**Fix:** Split the existing coverage from the missing assertion.

---

### Finding 9: Overlong missing-test description

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:76](../../../../.ai/plans/bugs-return-route-turning-point/investigation.md#L76)

**Problem:** The automated comment-bound check reports the missing-test description at 49 words.

**Fix:** List the selection, airfield resolution, and absent-control assertions separately.

---

### Finding 10: Overlong test-gap rationale

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:76](../../../../.ai/plans/bugs-return-route-turning-point/investigation.md#L76)

**Problem:** The automated comment-bound check reports the “Why it would have caught this” sentence at 32 words.

**Fix:** Split the branch combination from the `afInsp` conclusion.

---

### Finding 11: Overlong tier rationale

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/investigation.md:82](../../../../.ai/plans/bugs-return-route-turning-point/investigation.md#L82)

**Problem:** The automated comment-bound check reports this 32-word sentence.

**Fix:** Put the bounded-scope statement and implementation rationale in separate sentences.

---

### Finding 12: Overlong progress overview sentence

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/progress_summary.md:11](../../../../.ai/plans/bugs-return-route-turning-point/progress_summary.md#L11)

**Problem:** The automated comment-bound check reports this 30-word sentence.

**Fix:** Separate route slicing behavior from inspector state.

---

### Finding 13: Overlong RCA problem statement

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/rca-report.md:11](../../../../.ai/plans/bugs-return-route-turning-point/rca-report.md#L11)

**Problem:** The automated comment-bound check reports this 30-word sentence.

**Fix:** Separate route slicing behavior from inspector state.

---

### Finding 14: Overlong RCA uncertainty sentence

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/rca-report.md:75](../../../../.ai/plans/bugs-return-route-turning-point/rca-report.md#L75)

**Problem:** The automated comment-bound check reports this 26-word sentence.

**Fix:** Split the selected-state choice from the UI-scope consequence.

---

### Finding 15: Overlong RCA grounding summary

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/rca-report.md:79](../../../../.ai/plans/bugs-return-route-turning-point/rca-report.md#L79)

**Problem:** The automated comment-bound check reports this 39-word sentence.

**Fix:** Split the code-walk, KB, and DS conclusions into separate short sentences.

---

### Finding 16: Overlong suggested-fix entry

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/rca-report.md:91](../../../../.ai/plans/bugs-return-route-turning-point/rca-report.md#L91)

**Problem:** The automated comment-bound check reports this 29-word list item.

**Fix:** Split the hit-test change from the inspector change.

---

### Finding 17: Overlong expected-shape summary

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/rca-report.md:99](../../../../.ai/plans/bugs-return-route-turning-point/rca-report.md#L99)

**Problem:** The automated comment-bound check reports this 28-word sentence.

**Fix:** Put file/line sizing and implementation scope in separate sentences.

---

### Finding 18: Overlong failing-test description

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [.ai/plans/bugs-return-route-turning-point/rca-report.md:105](../../../../.ai/plans/bugs-return-route-turning-point/rca-report.md#L105)

**Problem:** The automated comment-bound check reports this 28-word sentence.

**Fix:** Separate the hidden-hotspot assertion from the inspector-state assertion.

---

### Finding 19: Overlong regression-test comment

**Category:** comment hygiene  
**Severity:** [Nit]  
**File:** [tests/leg-direction-filter.spec.js:184](../../../../tests/leg-direction-filter.spec.js#L184)

**Problem:** The automated comment-bound check reports this 27-word comment sentence.

**Fix:** End the first sentence after “editable route candidate.” Keep the merged-chooser explanation as a second sentence.

---

## Merge Recommendation

APPROVE

The runtime changes are small, reuse the existing direction and airfield predicates, preserve paint/hit symmetry, and have focused browser coverage. The repeated-coordinate hotspot boundary would benefit from a direct regression; the remaining findings are advisory prose/comment-length polish.

## Cleared

Areas actively reviewed and found clean:
- Duplication/YAGNI: the new predicate is narrowly scoped and shared by the overlay path without introducing unnecessary abstraction.
- Conventions and design: the implementation follows the approved RCA and reuses `legDirWaypointVisible()`, `legRetraceTurnIndex()`, `routeOccupiesPoint()`, and `afInsp`.
- Performance: the added route scan is bounded by the small route length and runs only for hotspot candidates in the opt-in review overlay.
- Interaction quality: marker painting and hit testing now apply the same occupied-route suppression for navigation waypoints and airfields.
- Inspector behavior: ordinary derived turns reuse existing selected/ARIA styling, while airfield-enriched route inspectors omit the route-only action.
- Test scope: the regression directly covers hidden projection, phantom nav/airfield hits, derived-turn state, and the route-airfield exclusion.
