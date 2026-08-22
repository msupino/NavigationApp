# Quality Review Report

**Date:** 2026-08-22
**Diff:** PR #1797 head `09fec6771b927032d73958919f9a9103c840bc00`
**Design Doc:** `.ai/plans/bugs-return-route-turning-point/rca-report.md`
**[Blocker]:** 0 | **[Major]:** 0 | **[Suggestion]:** 0 | **[Nit]:** 18

## Findings

### Finding 1: Advisory prose and comment bounds

**Category:** comment hygiene  
**Severity:** [Nit] (18 occurrences)  
**File:** changed planning Markdown and `tests/leg-direction-filter.spec.js`

**Problem:** The required automated comment-bound check reports these added sentences above its advisory 25-word limit:

- `.ai/plans/bugs-return-route-turning-point/frontend/fe-resolution.md:46` — 26 words
- `.ai/plans/bugs-return-route-turning-point/frontend/fe-resolution.md:50` — 39 words
- `.ai/plans/bugs-return-route-turning-point/investigation.md:16` — 58 words
- `.ai/plans/bugs-return-route-turning-point/investigation.md:18` — 32 words
- `.ai/plans/bugs-return-route-turning-point/investigation.md:18` — 30 words
- `.ai/plans/bugs-return-route-turning-point/investigation.md:62` — 41 words
- `.ai/plans/bugs-return-route-turning-point/investigation.md:71` — 27 words
- `.ai/plans/bugs-return-route-turning-point/investigation.md:76` — 49 words
- `.ai/plans/bugs-return-route-turning-point/investigation.md:76` — 32 words
- `.ai/plans/bugs-return-route-turning-point/investigation.md:82` — 32 words
- `.ai/plans/bugs-return-route-turning-point/progress_summary.md:11` — 30 words
- `.ai/plans/bugs-return-route-turning-point/rca-report.md:11` — 30 words
- `.ai/plans/bugs-return-route-turning-point/rca-report.md:75` — 26 words
- `.ai/plans/bugs-return-route-turning-point/rca-report.md:79` — 39 words
- `.ai/plans/bugs-return-route-turning-point/rca-report.md:91` — 29 words
- `.ai/plans/bugs-return-route-turning-point/rca-report.md:100` — 28 words
- `.ai/plans/bugs-return-route-turning-point/rca-report.md:106` — 28 words
- `tests/leg-direction-filter.spec.js:193` — 27 words

The repository has no root `WRITING-VOCABULARY.md`, so the checker classifies all occurrences as advisory.

**Fix:** Split each sentence at its logical clause boundary. In the test comment, end the first sentence after “editable route candidate” and retain the chooser explanation separately.

---

## Merge Recommendation

APPROVE

The previous substantive quality gap is resolved. The repeated-coordinate regression now proves a hotspot remains projected when the same reference also occurs in the visible half. Visible navigation/airfield reference candidates are no longer blanket-suppressed, preserving the merged-reference chooser path, while hidden-only candidates remain suppressed.

## Cleared

Areas actively reviewed and found clean:
- Prior merged-reference regression: `hitAirfieldMarkerCandidates()` and `hitNavWpMarkerCandidates()` now use `routePointOnlyInHiddenDirection()` instead of blanket `routeOccupiesPoint()` suppression.
- Repeated-coordinate coverage: the focused direction test adds HADRA to the visible return half and asserts `projectedWhenAlsoVisible === 1`.
- Runtime confirmation: the new direction regression and existing LLHA merged-route/airfield chooser test both passed locally on Chromium (2 tests, 2 passed).
- Tests: hidden-only projection/hit behavior, visible repeated-coordinate projection, derived-turn state, and airfield turn-control exclusion are covered.
- Design conformance: the implementation continues to reuse the approved route-direction, retrace, and airfield predicates without new UI abstractions.
- Performance: hotspot reference scans remain bounded by the small route and opt-in review overlay.
