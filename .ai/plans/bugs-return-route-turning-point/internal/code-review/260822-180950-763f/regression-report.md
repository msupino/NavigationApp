# Regression Report

**Date:** 2026-08-22  
**Diff:** PR #1797 exact head `3bc090b86fffbc4209d81efebd32d712b1765449`  
**High Risk Deltas:** 0 | **Medium:** 3 | **Low:** 0

## Behavioral Deltas

### Delta 1: Hidden-only route references follow the selected direction

**File:** [docs/app/core.js](../../../../../../docs/app/core.js), [docs/app/draw.js](../../../../../../docs/app/draw.js), [docs/app/interact.js](../../../../../../docs/app/interact.js)  
**Function / Path:** `routePointOnlyInHiddenDirection()` → `drawHotspotOverlay()`, `hitAirfieldMarkerCandidates()`, `hitNavWpMarkerCandidates()`  
**Risk:** MEDIUM

**Before:** The `?hotspots=1` overlay rendered and counted every graph hotspot regardless of route direction, and airfield/navigation hit paths returned reference candidates at matching route coordinates.

**After:** A hotspot and airfield/navigation reference hit are suppressed when every matching route occurrence is outside the selected outbound/return slice. Any visible matching occurrence preserves the overlay and reference candidate; non-route points and routes without an effective split retain their former behavior.

**Why This Matters:** Switching direction can now change hotspot-overlay counts and which hidden-only chart references are selectable. Consumers treating the overlay count as route-independent will observe a different value.

---

### Delta 2: Geometry-derived turns appear selected in the waypoint inspector

**File:** [docs/app/interact.js](../../../../../../docs/app/interact.js)  
**Function / Path:** `showInspector()` route-waypoint branch  
**Risk:** MEDIUM

**Before:** `insp-btn-on` and `aria-pressed` reflected only the persisted `wp.turn` flag, so a turn derived from a retraced leg appeared unselected.

**After:** Selected styling and `aria-pressed` reflect `legRetraceTurnIndex()`. The label remains based on the persisted flag, and activating an unpersisted derived turn stores it manually.

**Why This Matters:** The button now exposes effective route geometry rather than only persisted override state, which is an observable semantic change for users and UI automation.

---

### Delta 3: Route waypoints resolved as airfields omit the turning-point action

**File:** [docs/app/interact.js](../../../../../../docs/app/interact.js)  
**Function / Path:** `showInspector()` route-waypoint branch  
**Risk:** MEDIUM

**Before:** Every route-waypoint inspector appended `#insp-turn-btn`, including waypoints resolved as airfields by ICAO name or positional proximity.

**After:** An airfield-resolved route waypoint omits the turning-point button; ordinary non-airfield route waypoints retain it.

**Why This Matters:** An airfield route waypoint can no longer be marked or cleared manually as the turn from that inspector.

---

## Cleared

Functions/paths inspected and confirmed to have no additional behavioral change:

- Prior HIGH regression remains resolved: visible route-reference hits survive and `collapseNamedRouteReferenceCandidates()` retains LLHA's merged identity.
- Final LLHA assertion passes: the chooser displays `Route waypoint / Airfield / Haifa`, selects `{type:'wp', index:10}`, preserves airfield-enriched title content, and renders no `#insp-turn-btn`.
- `routePointOnlyInHiddenDirection()` preserves repeated-coordinate behavior because any visible match prevents suppression.
- Existing manual-turn precedence and route partitioning in `legRetraceTurnIndex()` / `legDirWaypointVisible()` are unchanged.
- VOR and frequency-change hit paths are unchanged.
- Final commit changes only tests/planning documentation relative to round 2; runtime behavior is unchanged from the clean round-2 review.
- `node --check` passed for all three changed runtime JavaScript files; `git diff --check` passed.

## Test Evidence

- PASS: `tests/leg-direction-filter.spec.js --grep "return direction hides outbound hotspot projection"` — hidden-only suppression, hidden-plus-visible preservation, derived-turn state, and airfield exclusion.
- PASS: `tests/routes.spec.js --grep "named route airfield is one chooser option"` — merged LLHA metadata plus the final no-turn-control assertion.
