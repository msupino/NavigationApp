# Regression Report

**Date:** 2026-08-22  
**Diff:** PR #1797 exact head `c20c5e2bd667101b86b9cd938a5e7f258eaa6db9`  
**High Risk Deltas:** 1 | **Medium:** 3 | **Low:** 0

## Behavioral Deltas

### Delta 1: Route-overlap reference identity disappears from point choices

**File:** [docs/app/interact.js](../../../../../../docs/app/interact.js)  
**Function / Path:** `hitAirfieldMarkerCandidates()`, `hitNavWpMarkerCandidates()` → `collapseNamedRouteReferenceCandidates()` / `pointChoiceText()`  
**Risk:** HIGH

**Before:** Airfield and navigation-waypoint hit candidates were returned whenever their layers were enabled, including at a coincident route waypoint. The chooser collapsed an exact named route/reference pair into the editable route candidate and retained `mergedReference`, so its metadata identified the point as, for example, `Route waypoint / Airfield / Haifa`.

**After:** Both hit functions discard every reference candidate whenever any route waypoint occupies the point, irrespective of whether that route occurrence is visible in the selected direction. The chooser therefore has no reference candidate to merge and displays only `Route waypoint`; direct reference selection at route-occupied positions is also no longer possible through these hit paths.

**Why This Matters:** Existing chooser behavior and its regression test depend on the merged reference identity to make airfield/navigation information discoverable without duplicating the point. The focused existing test `tests/routes.spec.js:473` now fails: expected `Route waypoint / Airfield / Haifa`, received `Route waypoint`. Because the new guard applies to visible route points as well as hidden ones, this observable change is broader than the return-only hotspot case.

---

### Delta 2: The hotspot review overlay follows the selected route direction for route-bound points

**File:** [docs/app/draw.js](../../../../../../docs/app/draw.js)  
**Function / Path:** `drawHotspotOverlay()`  
**Risk:** MEDIUM

**Before:** With `?hotspots=1`, every graph hotspot was rendered and counted across the whole chart regardless of route membership or the outbound/return selector.

**After:** A graph hotspot is neither rendered nor counted when it matches route waypoint occurrences and every matching occurrence is hidden by the current direction slice. It remains rendered when it is not on the route, when no direction split exists, or when at least one coincident route occurrence is visible.

**Why This Matters:** Review-overlay ring coverage and `window.__hotspotOverlayCount` now change when the pilot switches route direction. Dataset-review tooling or tests that treated the count as a route-independent graph total could observe fewer hotspots.

---

### Delta 3: Geometry-derived turns appear selected in the waypoint inspector

**File:** [docs/app/interact.js](../../../../../../docs/app/interact.js)  
**Function / Path:** `showInspector()` route-waypoint branch  
**Risk:** MEDIUM

**Before:** The turning-point button used only the waypoint's persisted `turn` flag for `insp-btn-on` and `aria-pressed`; a waypoint identified as the turn solely because its outgoing leg retraced an earlier leg appeared unselected.

**After:** Selected styling and `aria-pressed` use `legRetraceTurnIndex()`, so the geometry-derived turn appears selected. Its label still depends on the persisted flag, so an unpersisted derived turn is selected while the action remains `Mark as turning point`; activating it persists the same waypoint as the manual turn.

**Why This Matters:** The inspector's state becomes an effective-route state rather than strictly a persisted-override state. UI automation or users interpreting `aria-pressed` as proof of an explicit stored override will observe the new semantics.

---

### Delta 4: Route waypoints resolved as airfields lose the turning-point action

**File:** [docs/app/interact.js](../../../../../../docs/app/interact.js)  
**Function / Path:** `showInspector()` route-waypoint branch  
**Risk:** MEDIUM

**Before:** Every route-waypoint inspector appended `#insp-turn-btn`, including route waypoints enriched by `airfieldAtWaypoint()` through an ICAO-name match or positional proximity.

**After:** When `airfieldAtWaypoint()` resolves an airfield, the route-waypoint inspector omits the turning-point button entirely. Ordinary non-airfield route waypoints retain the action.

**Why This Matters:** A route waypoint whose name matches an ICAO code, or whose coordinates fall within the existing airfield proximity threshold, can no longer be marked or cleared manually as the route turn from that inspector.

---

## Cleared

Functions/paths inspected and confirmed to have no additional behavioral change:

- `routePointOnlyInHiddenDirection()`: repeated-coordinate routes retain the overlay whenever any matching route occurrence is visible; no match leaves the graph hotspot unchanged.
- `legRetraceTurnIndex()` / `legDirWaypointVisible()`: existing manual-turn precedence and route partitioning are unchanged.
- `drawWaypoints()`: primary route waypoint and hotspot rendering remains governed by the existing direction predicate.
- VOR and frequency-change hit paths: neither candidate generation nor selection behavior changed in this diff.
- Focused regression: `tests/leg-direction-filter.spec.js` passes at the reviewed head.
- Syntax/patch checks: `node --check` passed for all three changed runtime JavaScript files and `git diff --check` passed.

## Test Evidence

- PASS: `tests/leg-direction-filter.spec.js --grep "return direction hides outbound hotspot projection"` (1 passed).
- FAIL: `tests/routes.spec.js --grep "named route airfield is one chooser option"` (expected `Route waypoint / Airfield / Haifa`; received `Route waypoint`).
