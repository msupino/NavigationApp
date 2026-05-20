---
name: plotter-dev
description: >-
  Continue development of the HTML5 CVFR flight plotter in
  /Users/marco/NavigationApp/docs. Use when the user wants to work on the map
  plotter web app — waypoints, legs, leg markers, notes, the Leaflet base map,
  or the GitHub Pages deploy.
---

# HTML5 CVFR Flight Plotter — developer guide

## What this is

A browser flight-route plotter. Leaflet slippy map (flight-maps.com tiles)
with a canvas overlay that draws the route plus free-text notes. Plain
HTML / CSS / JS, no build step; Leaflet from CDN is the only dependency.
Re-implements the Unity `NavigationApp` plotter.

- **Live:** https://msupino.github.io/NavigationApp/
- **Repo:** https://github.com/msupino/NavigationApp (fork of liorbenhorin/NavigationApp)
- **Branch:** `html5-app` — all web-app work. This branch holds **only**
  the web app (`docs/` + `.claude/`). The Unity tree was intentionally
  stripped from this branch (commit `53188cc`); it survives on `master`
  (Unity 2019) and `clean` (2023 deployed-build sources).

## Files (`docs/`)

- `index.html` — page, toolbar, Leaflet + app.js. Assets carry `?v=N`;
  **always bump N on every change** to `app.js` / `style.css` so Pages
  visitors don't get stale JS / CSS.
- `app.js` — the whole app.
- `style.css` — dark UI + `@media print` rules.
- `.gitattributes` — forces images out of LFS so GitHub Pages can serve them.
- `map.jpg`, `build_map.py`, `nav-waypoints.json` — legacy from the
  pre-Leaflet static-chart version. **Unused**, safe to delete.

## Architecture

- **Base map:** Leaflet with six base layers in one `layers` object:
  CVFR / Nav / Low Alt / Heli (flight-maps.com tiles) / Satellite (Esri) /
  OSM. Selection persisted at `localStorage['plotter.layer']` and
  restored *before* `L.map()` runs (no CVFR flash on reload).
- **Route overlay:** a `<canvas id="overlay">` over the map with
  `pointer-events: none`, redrawn on every Leaflet `move` / `zoom` /
  `resize`. `proj(wp)` = `map.latLngToContainerPoint`.
- **State:**
  - `state.waypoints[i]` = `{lat, lng, name}` (name optional).
  - `state.legs[i]` = `{inboundAltitude, outboundAltitude, flightSpeed,
    inLabel, outLabel}`. `inLabel` / `outLabel` are `{a, p}` offsets
    (along-leg / perpendicular, screen px) so markers can be dragged
    apart from the leg midpoint.
  - `state.notes[i]` = `{lat, lng, text}` — free-text annotation boxes.
  - `state.mode` = `'add' | 'edit' | 'note'`; `state.selected` =
    `{type:'wp'|'leg'|'note', index}` or `null`.
  - Top-level globals: `showReturn`, `showMidLeg`, `highlightDiff`,
    `yellowAlpha`, `pageSize`, `pageOrient`.
- **Interaction (mouse):** Leaflet `mousedown` → hit-test in priority
  order **waypoint > note > leg-label > leg**. On a hit,
  `map.dragging.disable()` and own the drag; otherwise let Leaflet pan.
  `map.on('click')` in `add` mode drops a waypoint, in `note` mode drops
  a note.
- **Interaction (touch):** single-finger touchstart / touchmove / touchend
  on `mapEl` mirror the mouse path. Multi-finger or empty-space falls
  through to Leaflet for pan / pinch-zoom.
- **Toolbar:** absolute-positioned panel with a `⋮⋮` drag handle
  (`#toolbar-handle`); position persisted at `plotter.toolbarPos`,
  re-clamped on `window resize`.
- **geo():** great-circle distance (NM) + bearing. Magnetic = true − 5°.

## Features

- **Modes:** Add / Edit / Note (toolbar buttons).
- **Inspector:** `#insp-title` is an `<input>` — for waypoints it's the
  **editable Name** (placeholder `WP N`); for legs it's read-only
  `Leg N`; for notes it's read-only and a textarea below holds the body.
  The global `keydown` handler bails out when the target is an input /
  textarea / contenteditable so typing Backspace doesn't delete.
- **Waypoints:** circle auto-sized to fit either the name or the
  sequence number (`waypointGeom(i)`). Selection bumps the radius by 2
  and swaps the fill to gold.
- **Leg markers:** aviation pennant — rectangle (altitude / time) +
  heading triangle. Yellow-fill inbound, pink-fill return; draggable via
  the `inLabel` / `outLabel` offsets. `Highlight diff` adds a 7 px
  purple halo when a leg's altitude differs from the adjacent leg
  (inbound vs previous leg's inbound, outbound vs next leg's outbound).
- **Mid-leg distance badge:** single global toggle (`showMidLeg`).
- **Drift lines** (10°), **minute markers** with even-minute numeric
  labels and a white halo.
- **Labels alpha slider:** scales every yellow text-background fill via
  `yellowFill(a) = rgba(255,246,170, a * yellowAlpha)`. Persisted at
  `plotter.yellowAlpha`.
- **A3/A4 page frame:** `pageFrameRect()` returns the rectangle in
  screen px sized so its contents are 1:250 000. Clicking the same
  size button again clears it. Orientation chosen via the
  `chooseOrientation()` custom modal (Landscape / Portrait / Cancel).
- **Print:** when a frame is set, `doPrint()` adds `html.print-frame`
  and CSS vars (`--print-vw / --print-vh / --print-fx / --print-fy /
  --print-fw / --print-fh`). The print CSS clamps body to the frame
  size and offsets `#map` / `#overlay` so only the frame's content is
  visible. `@page` margin is `0` — full-bleed match to the dashed
  rectangle. Without a frame, prints the current viewport.

## Persistence (`localStorage`)

- `plotter.route` — `{waypoints, legs, notes, center, zoom}` (debounced).
- `plotter.layer` — selected base layer name.
- `plotter.toolbarPos` — `{x, y}` of the toolbar.
- `plotter.yellowAlpha` — labels-opacity slider value.

`save()` / `load()` write/read the same shape (minus `center` / `zoom`)
as a downloadable `route.json`.

## Build / test / deploy

- **Test:** serve `docs/` (`python3 -m http.server -d docs 8000`),
  screenshot via headless Chrome (`--headless --screenshot
  --virtual-time-budget=10000`; allow time for Leaflet + tiles to load).
  Inject a test route with a trailing `<script>` that sets
  `state.waypoints` and calls `syncLegs(); fitView(); draw();`.
- **Deploy:** `git push origin html5-app`; GitHub Pages auto-builds from
  that branch's `/docs`. **Always** bump `?v=N` in `index.html` (both
  `app.js` and `style.css`) before pushing. Poll
  `gh api repos/msupino/NavigationApp/pages/builds/latest --jq .status`.

## Notes / pending

- flight-maps.com tiles are a third-party service; the CVFR data is
  copyrighted. Fine for personal use; a public deploy needs permission.
- Tiles are not CORS-enabled, so a canvas-PNG export that includes the
  map isn't possible — print + Save-as-PDF is the path.
- `geo` distances are exact great-circle; verify against the chart's
  graticule if precision is questioned.
- Some helpers in `app.js` are unused historical leftovers
  (`textInputRow`, `boolRow`); harmless, prune when convenient.
