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

- `index.html` — page, toolbar, Leaflet + the five app scripts. Title
  is "NavAid"; `favicon.svg` is a small plane glyph; GA4 tag
  `G-0XM5PHEK8B` and a Web App Manifest are embedded. Assets carry
  `?v=N` query strings; cache-bust is now **rewritten automatically by
  `.github/workflows/deploy.yml`** to `?v=<short-sha>` at upload time,
  so the in-source value (currently `?v=134`) is just a static
  placeholder and doesn't need bumping per commit. CI lint still
  enforces that every `?v=` in the file agrees so authors don't
  accidentally leave one stale.
- The app is five plain scripts loaded in order, sharing one global
  scope (no build step, no modules):
  `core.js` (migration, state model, geo helpers, Leaflet map,
  overlay canvas) → `draw.js` (route / nav-waypoint / note rendering,
  page frame) → `interact.js` (hit-testing, inspector, mouse/touch) →
  `io.js` (save/load, page setup, flight plan, PNG export,
  persistence) → `ui.js` (toolbar wiring, drag, boot, PWA). Order
  matters — later files use globals from earlier ones.
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` — PWA:
  installable app + offline app-shell service worker.
- `style.css` — dark UI + `@media print` rules.
- `nav-waypoints.json` — 256 published Israeli VFR reporting points
  (`{name, he, lat, lng}`). Fetched once at boot. Source: ForeFlight
  Israel Base Pack (https://www.foreflightisrael.xyz/).
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
  - `state.waypoints[i]` = `{lat, lng, name}` (name optional).
  - `state.legs[i]` = `{inboundAltitude, outboundAltitude, flightSpeed,
    inLabel, outLabel}`. `inLabel` / `outLabel` are `{a, p}` offsets
    (along-leg / perpendicular, screen px) so markers can be dragged
    apart from the leg midpoint.
  - `state.notes[i]` = `{lat, lng, text, color, shape}` — free-text
    annotation boxes; `shape` is `'rect'` or `'oval'`.
  - `state.mode` = `'add' | 'note' | null` (null = inspect);
    `state.selected` = `{type:'wp'|'leg'|'note', index}` or `null`.
  - Top-level globals: `showReturn`, `showMidLeg`, `highlightDiff`,
    `showNavWP`, `navWP`, `showWpNames`, `wpNameAngle`,
    `yellowAlpha`, `wpSize`, `magVar`,
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

- **Modes:** Add / Note (no mode active = inspect).
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
  inbound/outbound altitude, swap+negates `inLabel` / `outLabel`.
- **Waypoint-name rotation:** the `⟳` button by "Show Waypoint names"
  cycles `wpNameAngle` 0/90/180/270; all names draw at that angle.
- **Plan table:** `📋 Plan` opens a modal with a per-leg flight plan
  (`#`, From, To, Hdg, Dist, Speed, Alt, Time) plus totals. From/To
  names and Speed/Alt are editable inputs; the rest is `textContent`
  only — user names / notes can't inject HTML.
- **Show Nav Waypoints** (default **on**): `nav-waypoints.json` is
  fetched once at boot; renders 238 white-fill / black-stroke 3.5 px
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

- `navaid.route` — `{waypoints, legs, notes}` (debounced; the view is
  not saved — a reload fits the route).
- `navaid.layer` — selected base layer name.
- `navaid.toolbarPos` — `{x, y}` of the toolbar.
- `navaid.toolbarCollapsed` — `'0'` / `'1'` for the collapsed toolbar.
- `navaid.yellowAlpha` — Transparency slider value.
- `navaid.wpSize` — Text-size slider value.
- `navaid.magVar` — magnetic variation offset.
- `navaid.showNavWP` — `'0'` / `'1'` for the nav-waypoints overlay.
- `navaid.showWpNames` — `'0'` / `'1'` for waypoint-name display.
- `navaid.wpNameAngle` — waypoint-name rotation (`0`/`90`/`180`/`270`).

A one-time migration at the top of `core.js` copies any old
`plotter.*` keys into `navaid.*` and removes the old ones.

`save()` / `load()` round-trip waypoints (with `name`), legs (with
`inLabel` / `outLabel`), and notes (with `color`, `shape`) as a
downloadable `route.json`.

## Build / test / deploy

- **Test locally:** `python3 -m http.server -d docs 8000` →
  `http://localhost:8000`. Inject a test route with a trailing
  `<script>` that sets `state.waypoints` and calls
  `syncLegs(); fitView(); draw();`.
- **Lint** before every commit: `node --check` each changed `.js`.
- **Deploy is a workflow** at `.github/workflows/deploy.yml`. It
  triggers on push to `main` *or* `dev` (or manual dispatch),
  checks out **both** branches, and assembles one Pages site:
  - `main/docs/` → `/`
  - `dev/docs/`  → `/staging/`
  - `actions/deploy-pages@v4` publishes the result.
- **Staging deploy** = `git push origin dev`.
- **Production deploy** = merge a `dev` → `main` pull request (`main` is
  branch-protected; the merge triggers the same workflow).
  **Before merging**: delete `REVIEW.md` from repo root if it exists
  (`git rm REVIEW.md && git commit`). It must not land in production.
- **Cache-bust is automatic.** `.github/workflows/deploy.yml` runs
  `sed -i -E "s/\?v=[A-Za-z0-9]+/?v=${SHA}/g"` against each branch's
  `docs/index.html` after checkout, using that branch's short commit
  SHA. The source-HTML `?v=N` value is just a placeholder; you don't
  need to bump it per commit. CI lint still enforces that every `?v=`
  value in the source HTML agrees.
- Watch run status: `gh run list --workflow=deploy.yml --limit 5`.
- **GitHub issues**: a review agent files bugs as GitHub issues on this
  repo. Check open issues at the start of a session:
  `gh issue list --repo msupino/NavigationApp --state open`
  Fix them on `dev` the same way as any other bug — one commit per issue,
  close with `Fixes #N` in the commit message.

## CI / Deploy gotchas

- Both `CI` (`.github/workflows/ci.yml`) and `Deploy`
  (`.github/workflows/deploy.yml`) have `workflow_dispatch:`. Manual
  trigger: `gh workflow run CI --ref dev` /
  `gh workflow run Deploy --ref dev`.
- **Admin-bypass pushes can silently swallow workflow events.** Pushing
  to `dev` / `main` as a repo admin while branch protection has required
  status checks pending records a "Bypassed rule violations" entry but
  the push event sometimes fails to fire `Deploy` or `CI`. If no run
  appears within ~30 s of a push (`gh run list --limit 5`), dispatch
  manually with the commands above.
- Prefer landing changes via PRs — `pull_request` events fire reliably,
  no admin bypass needed. Direct push to `dev` is allowed but is the
  source of the missed-run bug above.
- Deploy uses `concurrency: { group: pages, cancel-in-progress: false }`
  so a fast burst of pushes queues runs instead of cancelling them; do
  not flip `cancel-in-progress` back to `true` — staging deploys are
  consumed by humans and each commit must actually publish.
- Cache-bust check (also enforced by CI's `lint` job): every `?v=` in
  `docs/index.html` must agree (regex `\?v=[A-Za-z0-9]+`, so it
  matches both the integer placeholder and the SHA value that Deploy
  rewrites in). The actual cache-bust value users see is the short
  commit SHA injected by Deploy at upload time. See AGENTS.md for the
  full rule.

## Notes / pending

- flight-maps.com tiles are a third-party service; the CVFR data is
  copyrighted. Fine for personal use; a public deploy needs permission.
- `nav-waypoints.json` — 256 Israeli CVFR reporting points.
  **Source:** ForeFlight Israel Base Pack, https://www.foreflightisrael.xyz/.
  KMZ (`CVFR WAYPOINTS 0225.kmz`) extracted and converted to
  `{name, he, lat, lng}` JSON. `name` = ICAO/CVFR code; `he` = Hebrew
  place name. To refresh: download latest pack from the site, extract
  the KMZ, diff against the current JSON and add new entries.
- `geo` distances are exact great-circle; verify against the chart's
  graticule if precision is questioned.
- GA4 (`G-0XM5PHEK8B`) tracks page views; no event tracking yet.
