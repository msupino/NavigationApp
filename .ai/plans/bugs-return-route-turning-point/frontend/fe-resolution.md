# FE grounding — return-route hotspot and turning-point state

## What this change touches

- The route map overlay and matching Leaflet hit surface, from the effective
  turn and direction predicates in `docs/app/core.js:4517-4574` through
  `drawHotspotOverlay()` in `docs/app/draw.js:5414-5455` and
  `hitNavWpMarkerCandidates()` in `docs/app/interact.js:398-408`.
- The existing waypoint-inspector action area rendered by `showInspector()` in
  `docs/app/interact.js:2487-3016`.

## What the app already ships

- `legRetraceTurnIndex()` and `legDirWaypointVisible()` provide the effective
  turn and selected-direction waypoint slice (`docs/app/core.js:4517-4574`).
- `drawWaypoints()` already uses the direction predicate before painting route
  waypoint discs and hotspot rings (`docs/app/draw.js:4388-4415`).
- The inspector already has a turning-point button, selected styling, and
  `aria-pressed` state (`docs/app/interact.js:2996-3016`,
  `docs/app/style.css:2009`).
- `airfieldAtWaypoint()` and the existing `afInsp` value identify route
  waypoints that use airfield-enriched inspector content.

## What binds

- Reuse the existing route-direction predicates for route-bound hotspot
  visibility; do not add a second turn algorithm.
- Suppress reference hits when every matching route occurrence is hidden.
  Preserve candidates at visible overlaps so the chooser can merge reference
  metadata into the editable route waypoint.
- Reuse the existing `insp-btn-on` and `aria-pressed` treatment for the
  geometry-derived effective turn. No new control or visual signal is needed.
- Do not append the turning-point control when `afInsp` resolves. A route
  waypoint at an airfield follows the standalone-airfield inspector rule.

## Conflicts

- The requested return-view behavior hides a graph hotspot when its matching
  route occurrence is in the hidden half. The current `?hotspots=1` comment at
  `docs/app/draw.js:5401-5413` defines that review overlay as whole-chart and
  route-independent. The requested route-aware exception changes that review
  tool contract; the approval gate must choose it explicitly.

## Unclear

- A geometry-derived turn is effective but not a persisted manual override.
  The button can show selected while retaining its existing action to pin a
  manual turn. Changing labels or disabling the action would add unrequested
  UI scope.

**Grounded by**: a three-file code walk covering the map overlay, hit surface,
and waypoint inspector. The KB is unavailable because NavAid matches no
registered product fingerprint. DS MCP was not needed because the app already
ships every affected control and visual treatment.
