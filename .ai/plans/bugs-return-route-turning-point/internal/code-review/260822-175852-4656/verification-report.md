# Verification Report

**Date:** 2026-08-22
**Diff:** PR #1797 exact head `09fec6771b927032d73958919f9a9103c840bc00`
**Acceptance Criteria:** `.ai/plans/bugs-return-route-turning-point/rca-report.md`
**Development Plan:** none
**Design Doc:** `.ai/plans/bugs-return-route-turning-point/rca-report.md`
**Overall Status:** VERIFIED
**Summary:** 7 PASS, 0 PARTIAL, 0 FAIL out of 7

## Acceptance Criteria

### Criterion 1: “The selected outbound/return direction also suppresses a graph hotspot when every matching route occurrence is hidden.”

**Status:** PASS  
**Notes:** `routePointOnlyInHiddenDirection()` checks every same-coordinate route occurrence and returns true only when all matches are direction-hidden. `drawHotspotOverlay()` applies that predicate. The new browser regression proves the hidden-only case produces zero projected hotspots and the hidden-plus-visible case retains one projection.

---

### Criterion 2: “Suppress nav/airfield reference hits only when every matching route occurrence is hidden, preserving visible merged-reference metadata.”

**Status:** PASS  
**Notes:** Both `hitNavWpMarkerCandidates()` and `hitAirfieldMarkerCandidates()` use the shared all-occurrences predicate. A visible occurrence makes the predicate false, preserving reference candidates for chooser enrichment. The new regression directly proves hidden nav hits are absent and that the same point remains projected when it also occurs on the visible return half; inspection of the shared predicate confirms the same boundary applies to airfields.

---

### Criterion 3: “Reuse the existing `insp-btn-on` and `aria-pressed` treatment for the geometry-derived effective turn.”

**Status:** PASS  
**Notes:** The route-waypoint inspector derives `effectiveTurn` from `legRetraceTurnIndex() === idx` and uses it for both `insp-btn-on` and `aria-pressed`. The focused browser regression verifies both outputs on the first geometrically retraced leg.

---

### Criterion 4: “Append that control only for ordinary non-airfield route waypoints. A route waypoint enriched with airfield data follows the standalone-airfield rule and omits the turning-point control.”

**Status:** PASS  
**Notes:** The existing `afInsp = airfieldAtWaypoint(wp)` result gates creation of `#insp-turn-btn`. The regression selects a route waypoint that resolves to a loaded airfield and verifies the control is absent. The existing named LLHA merged-route chooser browser test also passes, confirming that the affected selection remains a route waypoint with airfield-enriched inspector data.

---

### Criterion 5: “The button can show selected while retaining its existing action to pin a manual turn.”

**Status:** PASS  
**Notes:** The click handler and `setTurnWaypoint(idx)` behavior are retained. Button text still distinguishes the stored manual flag while selected styling follows the effective turn. The existing manual-turn inspector browser regression passes alongside the new derived-turn regression.

---

### Criterion 6: “`tests/leg-direction-filter.spec.js` — turn the confirmed red scenario green for hotspot projection, hit testing, and derived-turn inspector state.”

**Status:** PASS  
**Notes:** The added test covers hidden hotspot rendering, hidden navigation-reference hits, repeated-coordinate visible preservation, derived-turn selected/ARIA state, and the route-airfield exclusion. Local browser verification passed all 37 tests in `tests/leg-direction-filter.spec.js`; six adjacent hotspot-overlay and merged-airfield chooser tests also passed.

---

### Criterion 7: “`.ai/navaid-dev.md` — document the selected-direction hotspot and effective turn invariant.”

**Status:** PASS  
**Notes:** The developer guide now documents all-occurrences hotspot suppression, effective turn inspector state, and omission of the turn control for airfield-resolving route waypoints.

## Scope Check

### In-Scope Changes

- Added one shared route-direction/reference predicate in `docs/app/core.js`.
- Applied it to hotspot projection in `docs/app/draw.js`.
- Applied it to airfield/nav-waypoint hit candidates and corrected inspector state/control visibility in `docs/app/interact.js`.
- Added the focused regression to `tests/leg-direction-filter.spec.js`.
- Updated the developer guide and retained fix-bug pipeline artifacts for issue #1796 / PR #1797.

### “While I Was In Here” Changes

None detected.

### Missing Requirements

None detected.

## Design Conformance

### Shared direction predicate; no second turn algorithm

**Status:** CONFORMS  
**Notes:** The new helper delegates visibility to the existing `legDirWaypointVisible()` source of truth and compares route occurrences with the existing `sameMapPoint()` behavior.

---

### Paint/hit behavior and visible merged references

**Status:** CONFORMS  
**Notes:** Hidden-only route-bound references are suppressed from the changed overlay/hit paths, while any visible matching occurrence preserves the reference candidate required by the overlap chooser.

---

### Existing inspector visual/action contract

**Status:** CONFORMS  
**Notes:** The implementation reuses the existing button classes, ARIA state, strings, and click handler. It gates only the airfield-resolving case via the pre-existing `afInsp` domain predicate.

---

### Verification plan

**Status:** CONFORMS  
**Notes:** `node --check` passed for all three changed application JavaScript files and the supplied snapshot is whitespace-clean. Focused local Playwright verification passed 37 direction/turn tests plus six adjacent hotspot/merged-airfield tests. At report time, GitHub lint, native Android/iOS, ESLint, Semgrep, CodeQL, Lighthouse, build, deploy, and one CI E2E shard were green; the remaining CI/deployed E2E shards were still running, with no failures reported.

## Recommendations

1. Wait for the remaining GitHub CI and deployed-E2E shards to complete before merging. This is a merge-readiness condition, not an acceptance-criteria or implementation gap.

## Cleared

Criteria actively verified and found fully satisfied:

- Criterion 1: hidden-only route hotspot projections follow the selected direction.
- Criterion 2: hidden-only reference hits are suppressed without losing visible merged references.
- Criterion 3: geometric turns render selected with matching ARIA state.
- Criterion 4: route waypoints resolving to airfields omit the turn control.
- Criterion 5: the existing manual-turn action continues to work.
- Criterion 6: focused and adjacent browser regressions pass locally.
- Criterion 7: durable developer documentation matches the implementation.
