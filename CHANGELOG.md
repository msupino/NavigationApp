# NavAid — Changelog

Browser-based CVFR flight-route planner (Israel area). HTML5 + Leaflet,
no build step. Hosted on GitHub Pages. Summary is drawn from the merged
pull requests; production is the `main` branch, staging is `dev`.

## In progress — dev (not yet merged)

### Google Earth export — per-leg altitudes (#64)
- The `.kml` export no longer prompts for a single AGL value. The route
  line, waypoint placemarks, and flythrough camera all use the per-leg
  altitudes from the flight plan (`altitudeMode=relativeToGround`).

### Rotate dial — tap cycles 90° (#65)
- Tapping the rotate dial steps the map bearing through 0° / 90° / 180° /
  270° instead of always resetting to north. Drag still sets any angle.

### Bug-fix batch — issues #57–#62
- Import validation: a route JSON with non-numeric coordinates is rejected
  with an error instead of silently blanking the map; the same guard
  protects the localStorage route cache (#58).
- Flight-plan altitude edits now cascade to adjacent legs like the
  inspector's do; number fields commit on `change` (not per keystroke),
  matching the inspector (#59).
- Exported route JSON gets a timestamped filename — no more `route (1).json`
  (#60).
- PNG export fetches OSM / Esri tiles directly (they support CORS); the
  weserv proxy is used only for the flight-maps.com layers (#62).
- Service worker clones navigation responses before the body is consumed (#57).
- Stale comments corrected: 256 nav-waypoints; `navWpUrl` note (#61).
- `sw.js` cache bumped to `navaid-v4`.

- **Bilingual UI**: Hebrew root (`/`), English at `/en/`; all dynamic
  strings localised; language picker dropdown in toolbar.
- Flight plan: editable **Speed** and **Altitude** number inputs; editing
  speed live-updates leg time + totals.
- **Map rotation**: 360° Google-Earth-style compass dial by the zoom
  buttons; route overlay tracks rotation; bearing persisted across reloads.
  PNG export forces north-up (bearing restored after export; no stale save
  during export via `_isExporting` flag).
- **Nav-waypoint search**: type a name to jump to the point; dropdown shows
  both Hebrew and English names (`primary / alt`); outside-click closes
  without clearing text; Escape clears.
- **Hebrew nav-waypoint names**: all 238 points carry a `he` field; overlay
  shows Hebrew, English kept for search. `nav-waypoints.json` versioned for
  SW cache busting.
- `⟳` button rotates all waypoint names 90°.
- **"Open route in Google Earth"** (renamed from "Fly Route"): KML tour,
  confirm-then-save, timestamped filename.
- **Export / Import** (renamed from Save / Load).
- **Flight Plan modal**: editable Speed/Altitude columns; Print button.
- Transparency slider: 0–100% range (no percentage label).
- Toolbar collapse persisted across reloads and language switches; defaults
  to collapsed on first visit.
- Rotate dial tap fixed on mobile (8 px movement threshold).
- Hamburger toggle uses three explicit `<span>` elements (pseudo-element
  approach was unreliable on mobile).
- `showReturn` / `showMidLeg` / `highlightDiff` persistence pattern fixed.
- Nav-waypoint dot hidden under placed waypoints by position proximity
  (not name match — works after rename).
- Hebrew mag-var label corrected: נטייה מגנטית.
- Layer picker: "OSM" → "OpenStreetMap" (with migration for saved key).
- `sw.js` cache bumped to `navaid-v3`.

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
