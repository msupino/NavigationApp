---
name: plotter-dev
description: >-
  Continue development of the HTML5 CVFR flight plotter that lives in
  /Users/marco/NavigationApp/docs. Use this when the user wants to work on the
  map plotter web app — waypoints, legs, leg markers, the chart background,
  georeferencing, or the GitHub Pages deploy.
---

# HTML5 CVFR Flight Plotter — developer guide

## What this is

An HTML5/Canvas re-implementation of the Unity `NavigationApp` map plotter
(original: liorbenhorin.xyz). Plain HTML + CSS + vanilla JS, no build step, no
dependencies. Lives in `docs/` of the `msupino/NavigationApp` fork.

- **Live:** https://msupino.github.io/NavigationApp/
- **Repo:** https://github.com/msupino/NavigationApp (fork of liorbenhorin/NavigationApp)
- **Branch:** `html5-app` (all HTML5 work). `master` = Unity 2019 source.
  `clean` branch = the 2023 Unity source the deployed build came from.
- **Other branch:** `export-leg-attributes` — draft PR #1, C# leg-export change
  (separate from the HTML5 app).

## Files (all in `docs/`)

- `index.html` — page + toolbar. Assets carry a `?v=N` cache-bust query; **bump
  N every deploy** or browsers serve stale JS.
- `app.js` — the whole app: state, coordinate model, canvas rendering,
  interaction, persistence.
- `style.css` — dark-theme UI.
- `map.jpg` — the background chart (1800×4605).
- `build_map.py` — regenerates `map.jpg` + prints `MAP_BOUNDS`. Needs Pillow.
- `nav-waypoints.json` — 238 RATA VFR reporting points (overlay, currently off).
- `.gitattributes` — keeps images as normal git blobs (repo-wide `.gitattributes`
  routes images to LFS, which GitHub Pages cannot serve).

## Coordinate model

Scene units, plane is (x, z). Ported from the Unity `Main.cs`:

    lon = x / 8.392355  * 0.16666667 + 35      (LON_RATE, origin 35°E)
    lat = z / 10.00674 * 0.16666667 + 33       (LAT_RATE, origin 33°N)

`sceneToCoord` / `coordToScene` in `app.js` do the conversion. Distance/bearing
use spherical great-circle (`geo()`); magnetic = true − 5°.

## Background chart + georeferencing

`map.jpg` is downscaled from `Assets/Resources/LLLL_CVFR.png` (single-image
Israel CVFR chart, 2018 edition, 6202×15867). `build_map.py` georeferences it
from the chart's own lat/lon graticule and prints `MAP_BOUNDS`, which must be
pasted into the `MAP` constant in `app.js`.

Current calibration (graticule reference pixels, full-res source):
- longitude: 34°10′E at x=318, **551.2 px per 10′**
- latitude: 33°20′N at y=370, **680 px per 10′**

To re-calibrate or swap the chart: edit the 6 `*_REF_*` / `*_PX10` constants in
`build_map.py`, run it, copy `MAP_BOUNDS` into `app.js`. Verify by placing a
marker at a graticule corner (e.g. `coordToScene(33.3333, 34.1667)`) and
checking it lands on the chart's printed cross.

## Build / test / deploy

- **Test:** serve `docs/` (`python3 -m http.server`) and screenshot with
  headless Chrome (`--headless --screenshot --virtual-time-budget=5000`). To
  inject a test route, append a `<script>` that sets `state.waypoints` then
  `syncLegs(); fitView();` — top-level `const`s in the classic script are
  reachable from a later inline script.
- **Pillow venv** was at `/tmp/imgvenv` (ephemeral — recreate:
  `python3 -m venv venv && venv/bin/pip install Pillow numpy`).
- **Deploy:** push to `html5-app`. GitHub Pages auto-builds from that branch
  `/docs`. Bump `?v=N` in `index.html` so clients get fresh assets.
- Wait for the Pages build: `gh api repos/msupino/NavigationApp/pages/builds/latest --jq .status`.

## Features implemented

- Add/Edit modes, click to drop waypoints, drag waypoints, pan/zoom, Fit.
- Auto legs with aviation pennant markers (rectangle altitude+time + heading
  triangle), inbound = light yellow, outbound/return = light pink, text locked
  to flight direction.
- Draggable leg markers (`leg.inLabel` / `leg.outLabel` along/perp offsets) so
  overlapping markers can be separated.
- Distance badge (toggled by per-leg "Mid-leg indication" in the inspector),
  minute markers (always on), 10° drift lines.
- Leg inspector: speed, inbound/outbound altitude, mid-leg toggle.
- "Return info" toolbar checkbox hides outbound markers.
- Nav-waypoint overlay (toolbar checkbox) — **off by default, placement not
  verified**.
- A3 / A4 print frames + Print → PNG export.
- JSON save/load (Unity `SceneData`-compatible). Route + view persisted to
  `localStorage` so reload keeps the map.

## Known issues / pending

- Nav-waypoint overlay disabled — its georeferencing vs the chart was not
  confirmed accurate.
- Background chart is the 2018 edition (outdated). `build_map.py` is
  parameterized for an easy swap once a newer chart image is supplied.
- Possible newer source: `ifl.flight-maps.com` serves XYZ tiles
  (`https://flight-maps.com/tiles/cvfr/{z}/{x}/{y}.png`,
  `.../tiles/nav/...`) — current + zoomable, but using it means rebuilding on a
  slippy-map engine (Leaflet) and needs permission (third-party tiles,
  copyrighted CVFR data).
- Print PNG is captured at screen/device resolution, not true print DPI.
