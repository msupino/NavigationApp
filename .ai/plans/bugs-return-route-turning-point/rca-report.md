---
status: approved
---

# RCA — return-route-turning-point: Return-route hotspots and turning-point inspector state

**Tier**: lean · **Confidence**: HIGH · **Service(s)**: NavAid static web app

## What's happening

In Return-only view, a hotspot that belongs to the hidden outbound route half
can remain projected and selectable through the graph-reference paths. The
waypoint where the next leg reverses the preceding leg correctly drives route
slicing. Its inspector button does not appear selected unless a redundant
manual `turn` flag was stored. A route waypoint that resolves to an airfield
also incorrectly receives the turning-point control. Airfield inspectors must
not expose that route-only action.

## Root cause

`drawHotspotOverlay()` and navigation-reference hit testing bypass the
route-direction visibility/suppression rules (`docs/app/draw.js:5414-5455`,
`docs/app/interact.js:398-408`). Separately, `showInspector()` reads only the
persisted `wp.turn` flag instead of the effective `legRetraceTurnIndex()` used
by route slicing (`docs/app/interact.js:2996-3016`). That route-waypoint branch
already computes `afInsp = airfieldAtWaypoint(wp)`, but does not use it to omit
the turning-point control for a named or coincident airfield.

## Design system

### What this change touches

- The route map overlay and matching Leaflet hit surface, from the effective
  turn and direction predicates in `docs/app/core.js:4517-4574` through
  `drawHotspotOverlay()` in `docs/app/draw.js:5414-5455` and
  `hitNavWpMarkerCandidates()` in `docs/app/interact.js:398-408`.
- The existing waypoint-inspector action area rendered by `showInspector()` in
  `docs/app/interact.js:2487-3016`.

### What the app already ships

- `legRetraceTurnIndex()` and `legDirWaypointVisible()` provide the effective
  turn and selected-direction waypoint slice (`docs/app/core.js:4517-4574`).
- `drawWaypoints()` already uses the direction predicate before painting route
  waypoint discs and hotspot rings (`docs/app/draw.js:4388-4415`).
- The inspector already has a turning-point button, selected styling, and
  `aria-pressed` state (`docs/app/interact.js:2996-3016`,
  `docs/app/style.css:2009`).
- `airfieldAtWaypoint()` and the existing `afInsp` value are the canonical
  predicates for a route waypoint that resolves to an airfield.

### What binds

- Reuse the existing route-direction predicates for route-bound hotspot
  visibility; do not add a second turn algorithm.
- Suppress reference hits when every matching route occurrence is hidden.
  Preserve candidates at visible overlaps so the chooser can merge reference
  metadata into the editable route waypoint.
- Reuse the existing `insp-btn-on` and `aria-pressed` treatment for the
  geometry-derived effective turn. No new control or visual signal is needed.
- Append that control only for ordinary non-airfield route waypoints. A route
  waypoint enriched with airfield data follows the standalone-airfield rule
  and omits the turning-point control.

### Conflicts

- The requested return-view behavior hides a graph hotspot when its matching
  route occurrence is in the hidden half. The current `?hotspots=1` comment at
  `docs/app/draw.js:5401-5413` defines that review overlay as whole-chart and
  route-independent. The requested route-aware exception changes that review
  tool contract; the approval gate must choose it explicitly.

### Unclear

- A geometry-derived turn is effective but not a persisted manual override.
  The button can show selected while retaining its existing action to pin a
  manual turn. Changing labels or disabling the action would add unrequested
  UI scope.

**Grounded by**: a three-file code walk covering the map overlay, hit surface,
and waypoint inspector. The KB is unavailable because NavAid matches no
registered product fingerprint. DS MCP was not needed because the app already
ships every affected control and visual treatment.

## Suggested fix

- `docs/app/core.js` — add one shared predicate that detects a reference point
  whose matching route occurrences all belong to the hidden direction.
- `docs/app/draw.js` — apply that predicate to the hotspot review projection
  and update its contract comment for the route-aware exception.
- `docs/app/interact.js` — suppress nav/airfield reference hits only when every
  matching route occurrence is hidden, preserving visible merged-reference
  metadata. Derive ordinary waypoint inspector selected/ARIA state from the
  effective turn while retaining the manual override action. Omit that control
  when the selected route waypoint resolves to an airfield.
- `tests/leg-direction-filter.spec.js` — turn the confirmed red scenario green
  for hotspot projection, hit testing, and derived-turn inspector state.
- `.ai/navaid-dev.md` — document the selected-direction hotspot and effective
  turn invariant.

**Expected shape**: five existing files and about 100 changed lines. Extend the
existing direction helpers, render/hit paths, inspector, focused spec, and
developer guide. Add no new test files.

## Failing test (written, red)

`tests/leg-direction-filter.spec.js::return direction hides outbound hotspot projection, recognizes geometric turn, and omits airfield turn control`
(e2e) — asserts that the hidden hotspot has no projection or nav-reference hit
for the hidden route half. It asserts that the geometry-derived turn button is
selected and `aria-pressed=true` for an ordinary waypoint. It also asserts that
a route waypoint resolving to an airfield has no turning-point control.

## Verification plan

- Focused browser: the new regression plus adjacent direction/hotspot tests.
- Syntax/lint: `node --check` on every changed JavaScript file and
  `git diff --check`.
- E2E + live env: yes — rendered canvas, hit testing, and inspector DOM state
  are browser behaviors; local focused Playwright plus the PR CI/deployed E2E
  matrix will verify them.
- New executables: none.

## Deferred / follow-ups

none
