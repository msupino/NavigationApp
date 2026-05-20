---
name: plotter-dev
description: >-
  Continue development of the HTML5 CVFR flight plotter in
  /Users/marco/NavigationApp/docs. Use when the user wants to work on the map
  plotter web app — waypoints, legs, leg markers, the Leaflet base map, or the
  GitHub Pages deploy.
---

# HTML5 CVFR Flight Plotter — developer guide

## What this is

A browser flight-route plotter. Leaflet slippy map (flight-maps.com tiles) with
a canvas overlay that draws the route. Plain HTML/CSS/JS, no build step; Leaflet
is the only dependency (CDN). It re-implements the Unity `NavigationApp` plotter.

- **Live:** https://msupino.github.io/NavigationApp/
- **Repo:** https://github.com/msupino/NavigationApp (fork of liorbenhorin/NavigationApp)
- **Branch:** `html5-app` — all web-app work. `master` = Unity 2019 source,
  `clean` = the 2023 Unity source of the deployed build.
- `export-leg-attributes` branch = draft PR #1 (C# change, unrelated).

## Files (`docs/`)

- `index.html` — page, toolbar, Leaflet + app.js from CDN/local. Assets carry
  `?v=N`; **bump N every deploy** or browsers serve stale JS.
- `app.js` — the whole app.
- `style.css` — dark UI + `@media print` rules.
- `map.jpg`, `build_map.py`, `nav-waypoints.json` — **legacy, unused** (from the
  earlier static-chart version). Safe to delete; kept for history.

## Architecture

- **Base map:** Leaflet (`L.map`), tile layers from flight-maps.com:
  `https://flight-maps.com/tiles/{cvfr,nav}/{z}/{x}/{y}.png` (z 6–13) plus Esri
  satellite. Layer switcher top-right. Leaflet owns pan/zoom/projection.
- **Route overlay:** a `<canvas id="overlay">` over the map, `pointer-events:
  none`, redrawn on every Leaflet `move`/`zoom`/`resize`. `proj(wp)` =
  `map.latLngToContainerPoint` projects waypoints to overlay pixels.
- **State:** `state.waypoints` = `[{lat,lng}]`; `state.legs` = per-leg
  `{inboundAltitude, outboundAltitude, flightSpeed, drawMidLegIndication,
  inLabel, outLabel}`. `inLabel`/`outLabel` = `{a,p}` marker offsets
  (along-leg / perpendicular, screen px) so markers can be dragged apart.
- **Interaction:** Leaflet mouse events + hit-testing. mousedown hit-tests
  waypoint → label → leg; if hit, `map.dragging.disable()` and drag; else
  Leaflet pans. `click` in Add mode drops a waypoint.
- **geo():** great-circle distance (NM) + bearing from lat/lng. Magnetic =
  true − 5°.

## Features

- Add/Edit modes, drag waypoints, click leg → inspector (speed, in/out
  altitude, mid-leg toggle), pan/zoom, Fit.
- Leg markers: aviation pennant — rectangle (altitude, time) + heading
  triangle; inbound light-yellow, return light-pink; draggable.
- 10° drift lines, minute markers, distance badge (gated by per-leg "Mid-leg
  indication"), "Return info" toggle for outbound markers.
- A3/A4 page buttons set `@page` size; **Print** = `window.print()` (browser
  dialog → PDF). Tiles are not CORS-enabled, so a canvas PNG export that
  includes the map is not possible — browser print is the path.
- JSON save/load (`{waypoints:[{lat,lng}], legs:[...]}`), route + view
  persisted to `localStorage`.

## Build / test / deploy

- **Test:** serve `docs/` (`python3 -m http.server`), screenshot with headless
  Chrome (`--headless --screenshot --virtual-time-budget=10000`; allow time for
  Leaflet + tiles to load). Inject a test route with a trailing `<script>` that
  sets `state.waypoints` (lat/lng objects) then `syncLegs(); fitView(); draw();`.
- **Deploy:** push to `html5-app`; GitHub Pages auto-builds from that branch
  `/docs`. Bump `?v=N` in `index.html`. Poll
  `gh api repos/msupino/NavigationApp/pages/builds/latest --jq .status`.

## Notes / pending

- flight-maps.com tiles are a third-party service; the CVFR data is
  copyrighted. Fine for personal use; a public deploy should have permission.
- Print is screen-WYSIWYG via the browser dialog, not a cropped page export.
- `geo` distances are exact great-circle; verify against chart graticule if
  precision is questioned.
