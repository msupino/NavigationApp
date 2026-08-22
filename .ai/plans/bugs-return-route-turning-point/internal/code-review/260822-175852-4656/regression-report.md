# Regression Report

**Date:** 2026-08-22  
**Diff:** PR #1797 exact head `09fec6771b927032d73958919f9a9103c840bc00`  
**High Risk Deltas:** 0 | **Medium:** 3 | **Low:** 0

## Behavioral Deltas

### Delta 1: Hidden-only route references follow the selected direction

**File:** [docs/app/core.js](../../../../../../docs/app/core.js), [docs/app/draw.js](../../../../../../docs/app/draw.js), [docs/app/interact.js](../../../../../../docs/app/interact.js)  
**Function / Path:** `routePointOnlyInHiddenDirection()` → `drawHotspotOverlay()`, `hitAirfieldMarkerCandidates()`, `hitNavWpMarkerCandidates()`  
**Risk:** MEDIUM

**Before:** The `?hotspots=1` review overlay rendered and counted every graph hotspot regardless of the route-direction selection. Airfield and navigation-waypoint hit paths also returned a reference candidate at any matching route coordinate.

**After:** A graph hotspot and airfield/navigation reference hit are suppressed when the reference matches route waypoint occurrences and every occurrence is outside the selected outbound/return slice. If the same reference also has a visible route occurrence, the hotspot and reference hit remain available. Points outside the route and routes without an effective split retain their former behavior.

**Why This Matters:** Switching route direction can now change hotspot-overlay counts and which chart-reference candidates can be selected. Consumers treating `window.__hotspotOverlayCount` as a direction-independent graph total, or expecting a hidden-only reference candidate, will observe a change.

---

### Delta 2: Geometry-derived turns appear selected in the waypoint inspector

**File:** [docs/app/interact.js](../../../../../../docs/app/interact.js)  
**Function / Path:** `showInspector()` route-waypoint branch  
**Risk:** MEDIUM

**Before:** The turning-point button used only the waypoint's persisted `turn` flag for `insp-btn-on` and `aria-pressed`; a waypoint identified as the turn solely because its outgoing leg retraced an earlier leg appeared unselected.

**After:** Selected styling and `aria-pressed` use `legRetraceTurnIndex()`, so the geometry-derived turn appears selected. The button label still reflects the persisted flag, and activating an unpersisted derived turn stores it as the manual turn.

**Why This Matters:** The button now represents effective route geometry rather than only persisted override state. UI automation or users interpreting `aria-pressed` as proof of an explicit stored override will observe the new semantics.

---

### Delta 3: Route waypoints resolved as airfields omit the turning-point action

**File:** [docs/app/interact.js](../../../../../../docs/app/interact.js)  
**Function / Path:** `showInspector()` route-waypoint branch  
**Risk:** MEDIUM

**Before:** Every route-waypoint inspector appended `#insp-turn-btn`, including route waypoints enriched by `airfieldAtWaypoint()` through an ICAO-name match or positional proximity.

**After:** When `airfieldAtWaypoint()` resolves an airfield, the route-waypoint inspector omits the turning-point button. Ordinary non-airfield route waypoints retain it.

**Why This Matters:** A route waypoint identified as an airfield can no longer be marked or cleared manually as the route turn from that inspector.

---

## Cleared

Functions/paths inspected and confirmed to have no additional behavioral change:

- `hitAirfieldMarkerCandidates()` / `hitNavWpMarkerCandidates()`: round 1's overly broad `routeOccupiesPoint()` guard is gone. Visible route-reference candidates survive, so `collapseNamedRouteReferenceCandidates()` still enriches the editable route choice.
- LLHA chooser metadata: confirmed restored as `Route waypoint / Airfield / Haifa`; its existing focused regression passes.
- `routePointOnlyInHiddenDirection()`: repeated-coordinate behavior is correct; any visible matching occurrence prevents suppression.
- `legRetraceTurnIndex()` / `legDirWaypointVisible()`: existing manual-turn precedence and route partitioning are unchanged.
- `drawWaypoints()`: primary route waypoint and hotspot rendering still uses the existing direction predicate.
- VOR and frequency-change hit paths: unchanged.
- Syntax/patch checks: `node --check` passed for all three changed runtime JavaScript files and `git diff --check` passed.

## Test Evidence

- PASS: `tests/leg-direction-filter.spec.js --grep "return direction hides outbound hotspot projection"` — confirms hidden-only suppression, hidden-plus-visible preservation, derived-turn selected state, and the airfield inspector exclusion.
- PASS: `tests/routes.spec.js --grep "named route airfield is one chooser option"` — confirms the previous HIGH regression is resolved and LLHA retains merged airfield identity.
