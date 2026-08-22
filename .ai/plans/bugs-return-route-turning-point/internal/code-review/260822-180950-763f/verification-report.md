# Verification Report

**Date:** 2026-08-22
**Diff:** PR #1797 exact head `3bc090b86fffbc4209d81efebd32d712b1765449`
**Acceptance Criteria:** `.ai/plans/bugs-return-route-turning-point/rca-report.md`
**Development Plan:** none
**Design Doc:** `.ai/plans/bugs-return-route-turning-point/rca-report.md`
**Overall Status:** VERIFIED
**Summary:** 7 PASS, 0 PARTIAL, 0 FAIL out of 7

## Acceptance Criteria

### Criterion 1: “The selected outbound/return direction also suppresses a graph hotspot when every matching route occurrence is hidden.”

**Status:** PASS  
**Notes:** `routePointOnlyInHiddenDirection()` evaluates every same-coordinate route occurrence and returns true only when all matches are hidden by `legDirWaypointVisible()`. `drawHotspotOverlay()` applies it. The focused browser regression proves both the hidden-only suppression and hidden-plus-visible preservation cases.

---

### Criterion 2: “Suppress reference hits when every matching route occurrence is hidden. Preserve candidates at visible overlaps so the chooser can merge reference metadata into the editable route waypoint.”

**Status:** PASS  
**Notes:** Navigation-waypoint and airfield hit candidate paths use the same all-occurrences predicate. A visible occurrence prevents suppression. The hidden nav-hit behavior is directly asserted, and the final LLHA chooser regression confirms visible airfield overlap still resolves to the editable `{type:'wp'}` candidate with airfield metadata.

---

### Criterion 3: “Reuse the existing `insp-btn-on` and `aria-pressed` treatment for the geometry-derived effective turn.”

**Status:** PASS  
**Notes:** The ordinary route-waypoint inspector derives selected state from `legRetraceTurnIndex() === idx` and applies it to both the existing selected class and ARIA state. The focused browser regression verifies `insp-btn-on` and `aria-pressed=true` at the first geometrically retraced leg.

---

### Criterion 4: “Append that control only for ordinary non-airfield route waypoints. A route waypoint enriched with airfield data follows the standalone-airfield rule and omits the turning-point control.”

**Status:** PASS  
**Notes:** `afInsp = airfieldAtWaypoint(wp)` gates creation of `#insp-turn-btn`. The direction regression verifies an arbitrary route waypoint resolving to an airfield has no control. The final added LLHA overlap-chooser assertion verifies the exact reported path: selection remains `{type:'wp', index:10}`, the title remains airfield-enriched, and `#insp-turn-btn` is absent.

---

### Criterion 5: “The button can show selected while retaining its existing action to pin a manual turn.”

**Status:** PASS  
**Notes:** The existing `setTurnWaypoint(idx)` click behavior remains intact. Label choice still uses the stored manual flag while selected styling reflects the effective turn. The adjacent manual-turn inspector test passes.

---

### Criterion 6: “`tests/leg-direction-filter.spec.js` — turn the confirmed red scenario green for hotspot projection, hit testing, and derived-turn inspector state.”

**Status:** PASS  
**Notes:** The added direction test covers hidden hotspot projection/hit behavior, repeated-coordinate visible preservation, derived-turn inspector state, and airfield exclusion. The final test-only delta also adds the exact merged LLHA chooser assertion requested by the investigation. Eight focused and adjacent Playwright tests pass locally.

---

### Criterion 7: “`.ai/navaid-dev.md` — document the selected-direction hotspot and effective turn invariant.”

**Status:** PASS  
**Notes:** The guide documents all-matching-occurrences suppression, derived turn inspector selection, and omission of the turn control for route waypoints resolving to airfields. The final planning-document edits clarify the same approved contract without changing runtime scope.

## Scope Check

### In-Scope Changes

- Shared route-direction/reference predicate in `docs/app/core.js`.
- Route-aware hotspot projection in `docs/app/draw.js`.
- Hidden-only airfield/nav-waypoint hit suppression and inspector state/control behavior in `docs/app/interact.js`.
- Focused direction regression plus exact merged LLHA chooser assertion.
- Developer documentation and fix-bug pipeline artifacts for issue #1796 / PR #1797.

### “While I Was In Here” Changes

None detected.

### Missing Requirements

None detected.

## Design Conformance

### Shared direction predicate; no second turn algorithm

**Status:** CONFORMS  
**Notes:** The helper delegates route-slice decisions to existing `legDirWaypointVisible()` and reuses `sameMapPoint()` for occurrence identity.

---

### Hidden-only hit suppression with visible chooser enrichment

**Status:** CONFORMS  
**Notes:** Both reference types use the shared predicate. The final LLHA assertion provides direct browser evidence that visible overlap metadata remains available after the hit-path change.

---

### Existing inspector contract

**Status:** CONFORMS  
**Notes:** Existing button strings, styling, ARIA, and manual action are reused. Only route waypoints resolving through the pre-existing `afInsp` predicate omit the control.

---

### Verification plan

**Status:** CONFORMS  
**Notes:** `node --check` passes for all changed application JavaScript files. Eight focused/adjacent browser tests pass at the exact head, including the new merged LLHA assertion. GitHub lint, native Android/iOS, ESLint, Semgrep, CodeQL, Lighthouse, build, and deploy checks are green. At report time the CI and deployed-E2E shards are still running, with no reported failures.

## Recommendations

1. Wait for the remaining GitHub CI and deployed-E2E shards before merging. This is an external merge-readiness condition, not an implementation or acceptance-criteria gap.

## Cleared

Criteria actively verified and found fully satisfied:

- Criterion 1: hidden-only hotspot projections respect route direction.
- Criterion 2: hidden-only reference hits are suppressed while visible merged references remain usable.
- Criterion 3: geometric turns use the existing selected/ARIA treatment.
- Criterion 4: the exact merged LLHA airfield inspector omits the turn control.
- Criterion 5: manual turn behavior remains intact.
- Criterion 6: focused and adjacent browser coverage passes.
- Criterion 7: developer and planning documentation match the shipped behavior.
