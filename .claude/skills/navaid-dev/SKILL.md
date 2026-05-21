---
name: navaid-dev
description: >-
  Continue development of NavAid, the HTML5 CVFR flight-route planner in
  /Users/marco/NavigationApp/docs. Use when the user wants to work on the
  map plotter web app — waypoints, legs, leg markers, notes, the Leaflet
  base map, the nav-waypoint overlay, or the deploy pipeline.
---

# NavAid — HTML5 CVFR flight-route planner — developer guide

## What this is

A browser flight-route planner. Leaflet slippy map (flight-maps.com tiles)
with a canvas overlay that draws the route, free-text notes, and an
optional VFR-reporting-point reference layer. Plain HTML / CSS / JS, no
build step; Leaflet from CDN is the only dependency. Re-implements the
Unity `NavigationApp` plotter, which is preserved on the
`original-plotter` branch.

- **Live (production):** https://msupino.github.io/NavigationApp/
- **Live (staging):** https://msupino.github.io/NavigationApp/staging/
- **Repo:** https://github.com/msupino/NavigationApp (fork of liorbenhorin/NavigationApp)

## Branches

- `main` — production. The web app source. The Unity tree was stripped
  here (commit `53188cc`).
- `dev` — staging. The same web app, work-in-progress. Each push to
  `dev` rebuilds the staging URL.
- `original-plotter` — frozen Unity 2019 project (renamed from `master`).
  Reference only; do not commit web changes here.

`main` is branch-protected — no direct pushes; production changes land via
a `dev` → `main` pull request.

## Files (`docs/`)

- `index.html` — page, toolbar, Leaflet + app.js. Title is "NavAid";
  `favicon.svg` is a small plane glyph; GA4 tag `G-0XM5PHEK8B` is
  embedded. Assets carry `?v=N` query strings; **always bump N on
  every change** to `app.js` / `style.css` so visitors don't get
  stale JS / CSS.
- `app.js` — the whole app.
- `style.css` — dark UI + `@media print` rules.
- `nav-waypoints.json` — 238 published Israeli VFR reporting points
  (`{name, lat, lng}`). Lazy-loaded by the "Show Nav Waypoints"
  toggle.
- `.gitattributes` — forces images out of LFS so Pages serves them.
- `map.jpg`, `build_map.py` — legacy from the pre-Leaflet static-chart
  version. **Unused**, safe to delete.

## Architecture

- **Base map:** Leaflet with six base layers in one `layers` object:
  CVFR / Nav / Low Alt / Heli (flight-maps.com tiles) / Satellite (Esri) /
  OSM. Selection persisted at `localStorage['navaid.layer']` and
  restored *before* `L.map()` runs (no CVFR flash on reload).
- **Route overlay:** a `<canvas id="overlay">` over the map with
  `pointer-events: none`, redrawn on every Leaflet `move` / `zoom` /
  `resize`. `proj(wp)` = `map.latLngToContainerPoint`.
- **State:**
  - `state.waypoints[i]` = `{lat, lng, name, flipped}` (name optional;
    `flipped` toggled by Reverse).
  - `state.legs[i]` = `{inboundAltitude, outboundAltitude, flightSpeed,
    inLabel, outLabel}`. `inLabel` / `outLabel` are `{a, p}` offsets
    (along-leg / perpendicular, screen px) so markers can be dragged
    apart from the leg midpoint.
  - `state.notes[i]` = `{lat, lng, text, color}` — free-text annotation
    boxes with optional per-note `#rrggbb` colour.
  - `state.mode` = `'add' | 'edit' | 'note'`; `state.selected` =
    `{type:'wp'|'leg'|'note', index}` or `null`.
  - Top-level globals: `showReturn`, `showMidLeg`, `highlightDiff`,
    `showNavWP`, `navWP`, `yellowAlpha`, `wpSize`, `magVar`,
    `pageSize`, `pageOrient`.
- **Interaction (mouse):** Leaflet `mousedown` → hit-test in priority
  order **waypoint > note > leg-label > leg**. On a hit,
  `map.dragging.disable()` and own the drag; otherwise let Leaflet pan.
  `map.on('click')` in `add` mode drops a waypoint (snapped to a nearby
  nav-waypoint within ~18 px — only while Show Nav Waypoints is on, see
  `applyNavSnap`), in `note` mode drops a note.
- **Interaction (touch):** single-finger touchstart / touchmove / touchend
  on `mapEl` mirror the mouse path. Multi-finger or empty-space falls
  through to Leaflet for pan / pinch-zoom.
- **Toolbar:** vertical column, absolute-positioned, with a `⋯` drag
  handle (`#toolbar-handle`); position persisted at
  `navaid.toolbarPos`, re-clamped on `window resize`.
- **geo():** great-circle distance (NM) + bearing. Magnetic = true +
  `magVar` (signed offset; Israel ≈ −5, equiv. 5°E variation).

## Features

- **Modes:** Add / Edit / Note.
- **Inspector:** `#insp-title` is an `<input>` — for waypoints it's
  the editable name (placeholder `WP N`); for legs it's read-only
  `Leg N`; for notes it's read-only and a textarea + color picker
  below holds the body. The global `keydown` handler bails out when
  the target is an input / textarea / contenteditable so typing
  Backspace doesn't delete.
- **Waypoints:** circle auto-sized to fit name or sequence number
  (`waypointGeom(i)`). Selection bumps the radius +2 and swaps fill
  to gold. The `wpSize` slider scales font + circle.
- **Leg markers:** aviation pennant — rectangle (altitude / time) +
  heading triangle. Yellow-fill inbound, pink-fill return; draggable
  via the `inLabel` / `outLabel` offsets. **Highlight diff** adds a
  7 px purple halo when a leg's altitude differs from the adjacent
  leg (inbound vs previous leg's inbound, outbound vs next leg's
  outbound).
- **Mid-leg distance badge:** global toggle (`showMidLeg`).
- **Drift lines** (10°), **minute markers** with even-minute numeric
  labels and a white halo.
- **Transparency slider:** scales every label-background fill via
  `tintFill(hex, a) = rgba(r,g,b, a * yellowAlpha)`. Persisted at
  `navaid.yellowAlpha`.
- **Mag var input:** signed offset added to true heading. Negative =
  east variation. Shows `(N°E)` / `(N°W)` next to the input.
  Persisted at `navaid.magVar`.
- **Altitude propagation:** editing a leg's altitude updates the
  adjacent legs that currently share the old value, stopping at the
  first different leg. Inbound walks forward, outbound walks backward.
- **Reverse:** flips waypoint order, swaps each leg's
  inbound/outbound altitude, swap+negates `inLabel` / `outLabel`,
  and toggles each waypoint's `flipped` flag (text rotates 180°).
- **Plan table:** `📋 Plan` opens a modal with a per-leg flight plan
  (`#`, From, To, Hdg, Dist, Speed, Alt, Time) plus totals. Uses
  `textContent` only — user names / notes can't inject HTML.
- **Show Nav Waypoints** (default **on**): lazy-fetches
  `nav-waypoints.json`, renders 238 white-fill / black-stroke 3.5 px
  dots; the 5-letter ID label appears at zoom ≥ 10. Captured in PNG
  export.
- **A3 / A4 page frame:** `pageFrameRect()` returns the rectangle in
  screen px sized so its contents are 1:250 000. Clicking the same
  size button again clears it. Orientation chosen via the
  `chooseOrientation()` modal.
- **Save PNG (`exportPNG`):** renders the framed region (or current
  view if no frame) at native tile zoom into an off-screen canvas.
  Tiles are pulled through `images.weserv.nl` to dodge the lack of
  CORS on flight-maps.com tiles. Then re-runs the canvas draws
  scaled into the export canvas and triggers a `.png` download
  named `navigation-A4.png` / `navigation-CVFR.png` etc.

## Persistence (`localStorage`, all keyed `navaid.*`)

- `navaid.route` — `{waypoints, legs, notes, center, zoom}` (debounced).
- `navaid.layer` — selected base layer name.
- `navaid.toolbarPos` — `{x, y}` of the toolbar.
- `navaid.yellowAlpha` — Transparency slider value.
- `navaid.wpSize` — Text-size slider value.
- `navaid.magVar` — magnetic variation offset.
- `navaid.showNavWP` — `'0'` / `'1'` for the nav-waypoints overlay.

A one-time migration at the top of `app.js` copies any old
`plotter.*` keys into `navaid.*` and removes the old ones.

`save()` / `load()` round-trip waypoints (with `name`), legs (with
`inLabel` / `outLabel`), and notes (with `color`) as a downloadable
`route.json`.

## Build / test / deploy

- **Test locally:** `python3 -m http.server -d docs 8000` →
  `http://localhost:8000`. Inject a test route with a trailing
  `<script>` that sets `state.waypoints` and calls
  `syncLegs(); fitView(); draw();`.
- **Lint** before every commit: `node --check docs/app.js`.
- **Deploy is a workflow** at `.github/workflows/deploy.yml`. It
  triggers on push to `main` *or* `dev` (or manual dispatch),
  checks out **both** branches, and assembles one Pages site:
  - `main/docs/` → `/`
  - `dev/docs/`  → `/staging/`
  - `actions/deploy-pages@v4` publishes the result.
- **Staging deploy** = `git push origin dev`.
- **Production deploy** = merge a `dev` → `main` pull request (`main` is
  branch-protected; the merge triggers the same workflow).
- **Always** bump `?v=N` on `app.js` and `style.css` in
  `index.html` before pushing.
- Watch run status: `gh run list --workflow=deploy.yml --limit 5`.

## Notes / pending

- flight-maps.com tiles are a third-party service; the CVFR data is
  copyrighted. Fine for personal use; a public deploy needs permission.
- `nav-waypoints.json` is a snapshot of 238 Israeli VFR reporting
  points; refresh manually (OpenAIP API key + a small script) when an
  AIRAC cycle actually changes them.
- `geo` distances are exact great-circle; verify against the chart's
  graticule if precision is questioned.
- Some helpers in `app.js` are unused historical leftovers
  (`textInputRow`, `boolRow`); harmless, prune when convenient.
- GA4 (`G-0XM5PHEK8B`) tracks page views; no event tracking yet.
