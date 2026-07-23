# NavAid — Changelog

Browser-based CVFR flight-route planner (Israel area). HTML5 + Leaflet,
no build step. Hosted on GitHub Pages. Summary is drawn from the merged
pull requests; production is the `main` branch, staging is `dev`.

## 2026-07-21 — recent merges _(auto-generated from merged PRs)_

**Features**
- "Loading charts…" indicator for Extra-layers overlays ([#1236](https://github.com/msupino/NavigationApp/pull/1236))
- plate PNGs (fix garbled Hebrew) + LLBS training-overlay offset ([#1235](https://github.com/msupino/NavigationApp/pull/1235))
- graticule-georeference 6 chart overlays from source AIP PDFs ([#1237](https://github.com/msupino/NavigationApp/pull/1237))
- georeference 4 overlays from byop Annex sources (full page + header) ([#1238](https://github.com/msupino/NavigationApp/pull/1238))
- in-app align editor — pan/scale/rotate chart overlays ([#1239](https://github.com/msupino/NavigationApp/pull/1239))
- rotated LLHZ circuit alignment + render rotated from airfields.json ([#1240](https://github.com/msupino/NavigationApp/pull/1240))
- "Show plates for" airfield picker (one field at a time) ([#1244](https://github.com/msupino/NavigationApp/pull/1244))
- plate dropdown + Auto option + clearer labels + mobile fit ([#1246](https://github.com/msupino/NavigationApp/pull/1246))
- A4×2 page size — the A3 frame exported as two A4 tiles ([#1252](https://github.com/msupino/NavigationApp/pull/1252))
- show the A4×2 cut line on the page frame ([#1256](https://github.com/msupino/NavigationApp/pull/1256))
- re-stroke the coastline the white-knockout erases ([#1260](https://github.com/msupino/NavigationApp/pull/1260))
- list the reference VOR(s) with their frequency ([#1265](https://github.com/msupino/NavigationApp/pull/1265))
- make every toolbar checkbox default gist/tune-controllable ([#1272](https://github.com/msupino/NavigationApp/pull/1272))
- name exported files for the route endpoints ([#1281](https://github.com/msupino/NavigationApp/pull/1281))

**Fixes**
- roll minutes 60→degree + LTR coord readout in RTL ([#1231](https://github.com/msupino/NavigationApp/pull/1231))
- address all 8 code-review findings ([#1262](https://github.com/msupino/NavigationApp/pull/1262))
- don't open the inspector when a pan starts on a selectable marker ([#1268](https://github.com/msupino/NavigationApp/pull/1268))
- stacked-Escape close + reset buttons for zoom/size sliders ([#1274](https://github.com/msupino/NavigationApp/pull/1274))
- scale note boxes with map zoom like the leg/nav kites ([#1276](https://github.com/msupino/NavigationApp/pull/1276))

**Data**
- add 2 AIP-verified LSA reporting points (Sorek, Shaalvim) ([#1230](https://github.com/msupino/NavigationApp/pull/1230))
- 8 Haifa/Megiddo/Rosh Pina CVFR routes ([#1267](https://github.com/msupino/NavigationApp/pull/1267))

**Tests**
- re-runnable wiki-screenshot generator ([#1242](https://github.com/msupino/NavigationApp/pull/1242))

**CI**
- on-demand wiki-screenshots Action (en+he → push to wiki) ([#1248](https://github.com/msupino/NavigationApp/pull/1248))
- nightly wiki-screenshots refresh (02:30 UTC) ([#1253](https://github.com/msupino/NavigationApp/pull/1253))
- nightly wiki-changelog automation from merged PRs ([#1257](https://github.com/msupino/NavigationApp/pull/1257))
- make the dev-to-main auto-PR idempotent under concurrent runs ([#1264](https://github.com/msupino/NavigationApp/pull/1264))

**Security**
- add noopener to external window.open calls ([#1250](https://github.com/msupino/NavigationApp/pull/1250))

**Chores**
- CI flake audit (no-op) ([#1270](https://github.com/msupino/NavigationApp/pull/1270))
- remove leftover Unity 2019 / plotter references ([#1279](https://github.com/msupino/NavigationApp/pull/1279))

**Other**
- prefetch plates on section expand (touch-friendly) ([#1225](https://github.com/msupino/NavigationApp/pull/1225))
- Fix live-location footer button jumping lines (Hebrew) ([#1226](https://github.com/msupino/NavigationApp/pull/1226))
- Keep record + live-location footer buttons on one line (both languages) ([#1228](https://github.com/msupino/NavigationApp/pull/1228))

## SIGWX significant-weather map overlay

- **SIGWX on the map** — overlay the low-level significant-weather prog chart on
  the map by valid time, like the PWX wind/temp layer: toggle, time selector,
  opacity. The IMS chart is split into its two panels — the **map frame** is
  georeferenced over Israel (aligned to the LLHA, LLBS and LLIB airfields shared
  with our layers, with a small rotation), and the **weather table** is parked
  just east of Israel. In dark mode the map panel's white paper is knocked out so
  it no longer reads as a print sheet (the table keeps its white for legibility).
  Everything is alignable via `?tune` → SIGWX overlay (panel + table offset /
  scale / rotation / opacity / white-knockout).

## NOTAM layer + Information (weather) overlays

- **NOTAM layer** (Israel FIR, LLLL) — active-NOTAM areas on the map plus a
  full-text list. Source: autorouter (Eurocontrol EAD), refreshed daily by a
  scheduled Action to the `notam-data` branch.
  - Map geometry: polygons, circles, route-closure lines, and airport count
    badges for coordinate-less airport NOTAMs.
  - **Click / hover** any area, line, or badge to read its text.
  - **Decoded view** — ICAO Q-code (subject + condition) and standard
    abbreviations expanded to plain English; **Raw** toggle for source text.
  - **CVFR route closures** drawn as lines by resolving named fixes against the
    nav-waypoint / airfield / VOR data; diversions drawn distinctly.
  - **Border-buffer NOTAMs** ("FM LEBANON BOUNDARY TO 8KM") geocoded to polygons
    from an Israel border dataset (`notam-borders.json`).
  - **Timeline slider** (0–72h) scrubs which NOTAMs are active at a future time.
- **Weather / Information overlays** — SIGMET hazard areas, route-wide wind
  effect, animated wind field, IMS PWX wind/temperature, and SIGWX charts.
- **"Weather" section renamed "Information"** now that it also holds NOTAMs.

## Cumulative-time kites, frequency-change callouts, tuning panel

- **Cumulative-time kites** per leg — inbound kite at B, optional return
  kite at A, both draggable around their anchor waypoint (PR #513).
- **Frequency-change callouts** — known ATC-change points show red rings;
  matching route waypoints get editable lightning arrows with call sign
  and frequency (PR #519, #525). Route-aware default call-sign suggestions
  based on route order (PR #525). Inline editing from the waypoint
  inspector (PR #533). Deletion suppression persists across reloads
  (PR #539). Renamed from "Comm Change" to "Freq Change" (PR #490).
- **Hidden tuning panel** — `?tune=1` exposes drawing constants (PR #515);
  `?tune=0` disables; per-slider reset; Colors group (PR #531).
- **Keyboard shortcuts** split — `D` deletes waypoint/note, `X` deletes
  freq change, `Z` adds freq change, `Delete`/`Backspace` handles all.
- **Floating map legend** — moved from View menu to a Leaflet control
  (PR #528).
- **Leg line-width sliders** — `legLineWidth` and `driftLineWidth`
  persisted across reloads (PR #513).
- **Export-PNG** includes "Include cumulative time" checkbox (PR #531).

## Undo, keyboard shortcuts, go-to, flight-plan fuel, magnifier fix

- **Undo** — Ctrl/Cmd-Z to revert last edit/move/delete (PR #456).
- **Keyboard cheat-sheet** — `?` modal listing all global shortcuts
  (PR #423). Shortcuts added: `A`/`N`/`C` (PR #453), `D` (PR #455),
  `B` (PR #477), `R` (PR #446).
- **Go-to coordinates** — click the lat/long readout to navigate to
  specific coordinates (PR #498, #501).
- **Flight-plan fuel** — cumulative time and fuel columns (PR #444);
  resizable plan window (PR #509).
- **Magnifier** — fixed rotation misalignment and zoom-in drift (PR #483).
- **Map view persistence** — center/zoom/bearing saved across reloads
  via `navaid.view` (PR #415).

## Nav-WP rebuild, comm-change seed, cheat-sheet, toolbar, sliders

- **Nav-waypoints** — rebuilt from IAA CVFR chart CSV (173 points),
  replacing legacy KMZ dataset (PR #407, #411).
- **Comm-change seed** — 48 points with call-sign catalog in
  `docs/data/comm-change.json` (PR #401).
- **Floating search overlay** — Ctrl-F opens top-center nav-WP search
  (PR #453).
- **Slider constants** — min/max/step defined, inline value labels,
  `tintFill` fix (PR #329, #335, #366, #368).
- **Force-snap toggle** — snap to nearest nav-WP/airfield regardless
  of distance (PR #240).
- **GPX export** — route export for portable GPS units (PR #239).
- **Drift lines toggle** (PR #322).
- **DPI metadata** in exported PNGs for correct print scale (PR #320).
- **Toolbar width** fixes — 240 px fixed, no stretch (PR #377).
- **Charts modal** — sorted alphabetically by ICAO (PR #473).
- **Live lat/long readout** on map (PR #469).
- **Reset waypoint name** button in inspector (PR #422).
- **Sentence-case** English strings (PR #431).
- **Default leg-kite** sits outside 10° drift cone (PR #395).
- **e2e-deployed** — tests run against built artifact, not live CDN
  (PR #494).

## v1.0

### Toolbar UX
- Language picker (`🌐`) lifted out of the Edit section so it stays
  visible regardless of which section is expanded or whether the
  toolbar is collapsed.
- New `GitHub` and `Wiki` links in the toolbar footer (always visible,
  open in a new tab). Hebrew UI uses the English brand names.
- Leg inspector title now reads `From → To` (locale-aware) instead of
  `Leg N`.

### Bug fixes (multi-model review)
- **#70** (blocker): map panning no longer gets stuck when a drag is
  released off-map — drag cleanup is now bound to `window` mouseup /
  pointerup / pointercancel.
- **#71**: notes overlapping waypoints are selectable again — pointer
  hit-test now matches paint order (notes before waypoints).
- **#72**: a failed `nav-waypoints.json` fetch no longer permanently
  disables the overlay / search / snap features for the session.
- **#73**: a corrupt saved route is preserved instead of silently
  overwritten with empty state on boot.
- **#74**: PNG export locks map interaction during the async tile
  fetch so tiles and route overlay never drift mid-export.
- **#75**: cleared / non-numeric rotation input is rejected; bearing
  load/save is guarded against `NaN`.
- **#79**: PNG export without an A3/A4 frame no longer produces blank
  patches at large viewport sizes.
- **#82**: partial `inLabel` / `outLabel` objects on import (e.g.
  `{a:0}` without `p`) are normalised per-key, so reverse-route and
  drag math no longer produce `NaN` offsets.
- **#76**: clearing the flight-plan altitude cell no longer commits
  `0` ft (and no longer cascades that 0 via `propagateAlt`) — the
  input is restored to the leg's value on empty / non-numeric.
- **#78**: Flight Plan modal dedupes (a second click is a no-op while
  one is open), and route mutations now refresh distances, headings,
  times, and name inputs live; a structural change (leg count) closes
  the modal instead of leaving a stale table.
- **#80**: a `QuotaExceededError` from autosave surfaces a one-time
  alert telling the user to export the route, and further autosave
  attempts back off (other storage-unavailable errors stay silent).
- **#81**: inspector and flight-plan name inputs show the locale-
  resolved label (`navName`) so they match the map; the canonical
  stored name is still persisted.
- **#83**: leg-label hit radius scales with map zoom and
  `legArrowSize`, with a 18 px floor — mouse/touch parity with the
  drawn marker at extreme zooms.
- **#84**: service worker only caches `resp.ok` HTML navigations and
  `await`s the `cache.put` inside the respondWith promise so the SW
  lifecycle can't terminate mid-write.
- **#104**: add-mode clicks that snap to a nav-WP / airfield already
  occupied by a waypoint are ignored — no more zero-distance legs.

### Google Earth
- KML camera tilt set to **70°** (was 85° → tried 45° → settled on 70°
  as the best forward-and-slightly-down view for terrain context).

### SEO / repo hygiene
- Add `robots.txt`, `sitemap.xml`, `canonical` + `hreflang` (he / en /
  x-default), and a `WebApplication` JSON-LD block in `index.html`.
- `/en/` and `/he/` paths restored as language-redirect stubs (each
  with self-referential canonical).
- New root `README.md` (English summary + bidi-safe Hebrew block via
  `<bdi>` wraps).
- New `LICENSE` (MIT) — source code is permissively licensed; chart /
  imagery / OSM / nav-waypoints data retain their own terms.
- GitHub repo description, homepage URL, and topics filled in.
- New GitHub Wiki: 19 pages (Quick Start, Features, User Guide, Map
  Layers, Flight Plan, Print and Export, Bilingual UI, Offline / PWA,
  Settings and Persistence, Keyboard and Touch, FAQ, Architecture,
  LocalStorage Schema, Service Worker, Deployment, Contributing,
  Changelog, Google Earth, Nav-waypoints Dataset).
- Bing webmaster verification file mirrored from main onto dev.

### CI / Deploy
- New `.github/workflows/ci.yml` lints every PR + push: `node --check`
  on every JS file, JSON parse for `manifest.json` /
  `nav-waypoints.json`, XML parse for `sitemap.xml` /
  `BingSiteAuth.xml`, `html-validate` on the three `index.html`
  entrypoints, `?v=N` consistency check, and SW cache-name parity.
- Branch protection on `main` requires the `lint` check (strict);
  `dev` records the same check non-strict.
- Deploy workflow: `cancel-in-progress` switched from `true` to
  `false` so a fast burst of pushes queues runs instead of
  cancelling intermediate ones.
- Both workflows now have `workflow_dispatch:` so they can be
  triggered manually with `gh workflow run …`.
- `?v=N` cache-bust is **auto-rewritten to the short commit SHA** in
  `docs/index.html` at deploy time. The integer placeholder in the
  source HTML doesn't need to be bumped per commit anymore; CI lint
  still enforces that all `?v=` values agree.

### Hebrew UI
- Footer link labels `GitHub` / `Wiki` keep the English brand names
  in the Hebrew strings file.
- Mid-leg "kite" badges: yellow inbound pennant is always drawn (one
  always-on kite per leg); the pink return pennant remains gated by
  the "Show return path" toggle (off by default), matching the
  original behaviour.

## In progress — dev (not yet merged)

### Bug-fix batch 2 — issues #66–#69
- Deleting a waypoint now removes the leg beside it, so leg altitudes /
  speeds stay aligned with the route instead of shifting downstream (#66).
- Rotate dial: a cancelled pointer (`pointercancel`) no longer cycles the
  bearing (#67).
- Flight plan: clearing the Speed field resets it to the leg's current
  speed instead of showing blank (#68).
- Rotate dial drag debounces the bearing write to localStorage (#69).

### Google Earth export — per-leg altitudes (#64)
- The `.kml` export no longer prompts for a single AGL value. The
  flythrough camera flies at the per-leg altitudes from the flight plan
  (MSL — `altitudeMode=absolute`); the route line and waypoints stay
  clamped to the ground.

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
