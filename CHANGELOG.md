# NavAid — Changelog

Browser-based CVFR flight-route planner (Israel area). HTML5 + Leaflet,
no build step. Hosted on GitHub Pages. Summary is drawn from the merged
pull requests; production is the `main` branch, staging is `dev`.

## In progress — PR #12

- Flight plan: editable **Speed** and **Altitude** number inputs (with
  the editable From / To name inputs); editing speed live-updates leg
  time + totals.
- **Map rotation**: a 360° dial (white Google-Earth-style compass) by
  the zoom buttons, via the `leaflet-rotate` plugin; the route overlay
  tracks the rotated chart. PNG export forces north-up.
- **Nav-waypoint search** box — type a name, jump to the point.
- **Hebrew names**: all 238 nav-waypoints carry a `he` name (from the
  original ForeFlight KML); the overlay shows Hebrew, English kept for
  search. `nav-waypoints.json` fetched with a `?v` so the service
  worker picks up data changes.
- `⟳` button rotates all waypoint names 90° (replaced the auto-flip).
- **Fly Route → "Open in Google Earth"**: confirm-then-save; timestamped
  download names.
- Review cleanup: persist `showWpNames` / `wpNameAngle`; dead-code
  removal; refreshed `SKILL.md`.

## 2026-05-21

### PR #11 — Editable flight-plan names; Fly Route (Google Earth)
- Editable From / To waypoint-name inputs in the Plan table.
- **Fly Route** button writes a Google Earth KML tour (`gx:Tour`) that
  flies the route above the terrain; `<Camera>` order fixed; opens at
  the route start; flythrough altitude 5000 ft AGL.

### PR #10 — Keep short/empty notes landscape
- 56 px minimum note width — empty oval notes no longer shrink to a
  vertical ellipse.

### PR #9 — Module refactor + toolbar layer picker / route info
- Split `app.js` (~1780 lines) into five ordered scripts: `core.js`,
  `draw.js`, `interact.js`, `io.js`, `ui.js` (behaviour identical).
- Route-info panel moved into the toolbar footer; base-layer picker
  moved into the toolbar as a dropdown; in-app Install button removed.

### PR #8 — PWA install, note shapes, mobile collapse, review fixes
- Toolbar collapse/expand (collapsed by default on phones).
- PWA: manifest, offline-shell service worker, app icons, Install
  button.
- Per-note shape: Rectangle or Oval.
- `exportPNG` fetch timeout + failed-tile warning; dead-code removal.

### PR #7 — Max-quality PNG export
- PNG export renders at the layer's max native tile zoom (z13 for
  CVFR), not the on-screen zoom.

### PR #6 — Draggable A3/A4 page frame
- The print-page frame can be dragged anywhere instead of being locked
  to the viewport centre.

### PR #5 — Link-preview image
- Regenerated `og-preview.jpg` with a bottom-to-top route.

### PR #4 — Production promote: snapping, modes, name toggle
- Nav-waypoint snapping (drop + drag); toolbar button renames.
- Toggleable Add modes; Edit Waypoint button dropped.
- "Show Waypoint names" toggle (off = empty circle).
- Open Graph link-preview tags; `navaid` dev agent.

### PR #3 — Nav-waypoint snap + toolbar copy
- Snap new / dragged waypoints to nearby nav-waypoints.
- Toolbar copy polish.

### PR #2 — NavAid rebrand, Pages workflow, Nav Waypoints overlay
- Rebrand to NavAid: favicon, GA4, GitHub Pages deploy workflow
  (`main` -> `/`, `dev` -> `/staging/`).
- "Show Nav Waypoints" overlay — 238 Israeli VFR reporting points.

## Pre-rewrite

### PR #1 — Leg attributes in scene JSON (Unity, closed unmerged)
- WIP on the original Unity app; superseded by the HTML5 rewrite.
