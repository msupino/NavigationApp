# NavAid — HTML5 CVFR flight-route planner — developer guide

## What this is

A browser flight-route planner. Leaflet slippy map (live chart tiles from
`https://flight-maps.com`, export/download tiles from
`https://navaid-tiles.supino.org`) with a canvas overlay that draws the route,
free-text notes, and an
optional VFR-reporting-point reference layer. Plain HTML / CSS / JS, no
build step; pinned Leaflet plugins are listed in `docs/index.html`. This repository now
carries the static web app source only.

- **Live (production):** https://navaid.supino.org/
- **Live (staging):** https://navaid.supino.org/staging/
- **Pull-request previews:** every open same-repository PR is published at
  `https://navaid.supino.org/pr/<n>/` (and `/branch/<name>/`), linked from a bot
  comment and a `View deployment` record. Fork PRs are never published.
  **Trust model — read before opening one:** a preview is unreviewed branch code
  on the PRODUCTION origin. It is given its own `localStorage`/`sessionStorage`
  namespace (`.github/preview/pr-store.js`, taken only from the base branch) and
  is refused a service worker, which keeps an ordinary preview from stepping on
  live data or deleting the offline shell. That is **not** a security boundary:
  a same-origin iframe reaches the real store, which
  `tests/preview-store-isolation.spec.js` demonstrates on purpose. Treat opening
  a preview as running that branch's code against your saved routes, settings and
  BYOK/Drive credentials. The robust fix is a separate origin; hosting them here
  is a deliberate, accepted trade.
- **Repo:** https://github.com/msupino/NavigationApp (fork of liorbenhorin/NavigationApp)

## AI Docs

This file is the full developer guide. For fast orientation and task-specific
checklists, also use the rest of the repo-tracked `.ai/` handbook:

- `.ai/README.md` — index and non-negotiables.
- `.ai/agent.md` — compact agent brief.
- `.ai/workflow.md` — branches, issues, pushes, draft PRs, deploys.
- `.ai/architecture.md` — script order, state, rendering, persistence.
- `.ai/data.md` — JSON datasets and sources of truth.
- `.ai/ui-patterns.md` — inspectors, charts, RTL/LTR, satellite, VOR.
- `.ai/testing.md` — local checks, Playwright, deployed e2e behavior.
- `.ai/checklists.md` — pre-commit and change-type checklists.

## Branches

- `main` — production. The web app source.
- `dev` — staging. The same web app, work-in-progress. Each push to
  `dev` rebuilds the staging URL.

`main` is branch-protected — no direct pushes; production changes land via
a `dev` → `main` pull request. **Every change must go through a feature
branch and pull request — even one-line fixes.** Feature branches should
always target `dev` as the PR base branch.
**Every PR must be preceded by a GitHub issue** describing the bug or
enhancement. Reference it in the PR body with `Fixes #N` or `Closes #N`.

**Before creating a feature branch from `dev`:** update local `dev`
first, then bring production back into it. Fetch `origin`, check out
`dev`, fast-forward it to `origin/dev`, and integrate `origin/main`
when possible. Resolve and push that `dev` update before creating or
switching to the feature branch. If `dev` cannot fast-forward or
`origin/main` cannot be integrated cleanly, stop and resolve that
before branching.

**Before any `git commit`:** run `git branch --show-current` (and
`git status` when in doubt). If the branch is not the one the user
clearly intended for this work (or you are unsure), **stop and ask the
user** which branch to use — do not guess; another agent or session may
be using a different branch. If the branch is correct, proceed. Do not
commit on `main`, `dev`, or an unrelated feature branch by mistake.

## Files (`docs/`)

- `index.html` — page, toolbar, Leaflet + the ordered app scripts. Title
  is "NavAid"; `favicon.svg` is a small plane glyph and a Web App Manifest is
  embedded. Mutable analytics scripts are intentionally absent. Assets carry
  `?v=src` query strings; cache-bust is **rewritten automatically by
  `.github/workflows/deploy.yml`** to `?v=<short-sha>` at upload time,
  so the in-source value is a fixed placeholder that must NOT be bumped —
  changing it per pull request only makes every PR conflict with every other
  on that line. CI lint still
  enforces that every `?v=` in the file agrees so authors don't
  accidentally leave one stale.
- `app/` — the app source. Plain scripts load in order and share one global
  scope (no build step, no modules):
  `app/core.js` (migration, state model, geo helpers, Leaflet map,
  overlay canvas) → `app/terrain.js` (terrain / MSA helpers) →
  `app/draw.js` (route / nav-waypoint / note rendering, page frame) →
  `app/interact.js` (hit-testing, inspector, mouse/touch) →
  `app/io.js` (save/load, page setup, flight plan, PNG export,
  persistence) → `app/alt-pair-directions.js` (altitude-pair direction
  helpers) → `app/gdrive.js` (optional Drive route library) →
  `app/ui.js` (toolbar wiring, drag, boot, PWA). Order matters — later
  files use globals from earlier ones. Default English UI strings live in
  `app/core.js` (`window.S`): **sentence case** (first word + proper nouns /
  acronyms such as BYOP, CVFR, JSON); spell *waypoint* in full in prose.
  Hebrew overrides: `i18n/he/strings.js`.
- `app/style.css` — dark UI + `@media print` rules.
- `data/` — shipped JSON datasets used by the app.
- `i18n/` — locale string bundles.
- `assets/` — icons and social preview images.
- `manifest.json`, `sw.js` — PWA manifest + offline app-shell service worker.
- `../mobile/` — Capacitor native iOS / Android remote-URL shell. It keeps its
  own tooling, uses the small `mobile/shell` webDir, and opens
  `https://navaid.supino.org`; it must not introduce a build step for Pages.
- `data/cvfr-nav-waypoints.json` — 172 published Israeli CVFR reporting points
  under `waypoints`, with `{name, en, he, lat, lng, report}`. **Source:** IAA CVFR
  chart waypoint reference table (page 113, 2025 edition), shipped as
  `113_waypoints.csv` upstream. CSV → JSON migration in issue #406 /
  PR `feat/unified-waypoints`. ARP rows in the CSV are intentionally
  skipped here — airfield ARPs live in `data/airfields.json` with richer
  data (runways, plates, English label). Updating: drop the CSV into
  the build script and regenerate.
- `.gitattributes` — forces images out of LFS so Pages serves them.
- `legacy/map.jpg`, `legacy/build_map.py` — legacy from the pre-Leaflet
  static-chart version. **Unused**, safe to delete.

## Architecture

- **Base map:** Leaflet with six base layers in one `layers` object:
  CVFR / Nav / Low Alt / Heli (live from `https://flight-maps.com`,
  with `exportUrl` entries on `https://navaid-tiles.supino.org` for PNG
  download rendering) / Satellite (Esri) / OSM.
  Selection persisted at `localStorage['navaid.layer']` and restored
  *before* `L.map()` runs (no CVFR flash on reload).
- **Route overlay:** a `<canvas id="overlay">` over the map with
  `pointer-events: none`, redrawn on every Leaflet `move` / `zoom` /
  `resize`. `proj(wp)` = `map.latLngToContainerPoint`.
- **State:**
  - `state.waypoints[i]` = `{lat, lng, name}` (name optional).
  - `state.legs[i]` = `{inboundAltitude, outboundAltitude, flightSpeed,
    inLabel, outLabel, hideDrift?, showDrift?}`. `inLabel` / `outLabel` are `{a, p}` offsets
    (along-leg / perpendicular, screen px) so markers can be dragged
    apart from the leg midpoint. `hideDrift: 1` hides that leg even when
    route-wide drift lines are on; `showDrift: 1` shows it when route-wide
    drift lines are off. `hideDrift` wins if both legacy flags are present.
  - `state.notes[i]` = `{lat, lng, text, color, shape}` — free-text
    annotation boxes; `shape` is `'rect'` or `'oval'`.
  - `state.mode` = `'add' | 'note' | null` (null = inspect);
    `state.selected` = `{type:'wp'|'leg'|'note', index}` or `null`.
  - Top-level globals: `showReturn`, `showMidLeg`, `showCumTime`,
    `highlightDiff`, `showNavWP`, `navWP`, `showWpNames`,
    `wpNameAngle`, `showAirfields`, `showVorStations`, `vorRef`,
    `showReporting`, `showMsa`, `showWind`, `showSigmet`,
    `yellowAlpha`, `wpSize`, `legArrowSize`, `legLineWidth`,
    `driftLineWidth`, `limitLegKites`, `forceSnap`, `magVar`,
    `pageSize`, `pageOrient`, `simUrl`, `simOn`, `simFollow`.
- **Interaction (mouse):** Leaflet `mousedown` → hit-test in priority
  order **waypoint > note > leg-label > leg**. On a hit,
  `map.dragging.disable()` and own the drag; otherwise let Leaflet pan.
  `map.on('click')` in `add` mode drops a waypoint (snapped to a nearby
  nav-waypoint within ~18 px — only while Show Nav Waypoints is on, see
  `applyNavSnap`), in `note` mode drops a note.
  Double-clicking an existing leg splits it at the clicked map coordinate
  in both inspect mode and edit modes; the two click events are suppressed
  by the leg hit so add/note mode does not also create a free waypoint or
  note.
- **Interaction (touch):** single-finger touchstart / touchmove / touchend
  on `mapEl` mirror the mouse path. Multi-finger or empty-space falls
  through to Leaflet for pan / pinch-zoom.
- **Toolbar:** on phones / narrow viewports (`max-width: 680px`) the
  toolbar is the original floating vertical column with a `⋯` drag handle
  (`#toolbar-handle`) and hamburger collapse control. Position is persisted
  at `navaid.toolbarPos.<lang>`, re-clamped on `window resize`; collapsed state is
  persisted at `navaid.toolbarCollapsed`. On desktop (`min-width: 681px`)
  those same `.tb-section` groups render as a fixed top menubar with
  Windows-like dropdown panels. Desktop ignores saved mobile drag/collapse
  state, offsets the map/overlay below the menu strip, and closes dropdowns
  on outside click or Escape.
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
- **Leg markers (informally "kite"):** aviation pennant — rectangle (altitude / time) +
  heading triangle. Yellow-fill inbound, pink-fill return; draggable
  via the `inLabel` / `outLabel` offsets. **Highlight diff** adds a
  7 px purple halo when a leg's altitude differs from the adjacent
  leg (inbound vs previous leg's inbound, outbound vs next leg's
  outbound).
  - **Offset invariant (`_m: 1`):** user-dragged `inLabel` / `outLabel`
    are stored in *size-independent* units. The on-screen position is
    `mid + nx * p * legZoomScale()` where
    `legZoomScale() = max(0.35, 2^(zoom-12)) * legArrowSize`.
    `_normalizeLegLabel()` in `io.js` migrates legacy raw-pixel offsets
    (no `_m` flag) by dividing by the file's `legArrowSize` and stamping
    `_m: 1`. Migration runs on `restoreRoute()` (localStorage),
    `load()` (file import), and is implicit for share-URL decoded
    routes (which only carry the default).
  - **Default sentinel (`_default: 1`, issue #394 + PR #395
    follow-up):** `_defaultLegLabels()` in `core.js` returns
    `{ a: 0, _default: 1, _m: 1 }` (no `p`). At render time, `drawLegs`
    (and the matching hit-test in `legLabelCenter`) computes the
    perpendicular as
    `legDefaultLabelPerp(legLenPx) = (max(1, legLenPx) / 2) * tan(10°)
    + 23 * legZoomScale() + 8`, placing the kite **body** clear of both
    the leg line and the 10° drift cone. The `23 * legZoomScale()` term
    is the kite's own half-width (it's `46 * legZoomScale()` px wide
    in `drawLegArrow`); without it the kite's *centre* sat at the cone
    edge but its body still overlapped the leg line at low zoom or
    `legArrowSize >= 2` (PR #395 follow-up). Dragging a
    default kite calls `_materialiseDefaultLegLabel()` (interact.js) to
    freeze the current rendered offset into the user-dragged
    `{ a, p, _m: 1 }` shape so subsequent drag deltas behave normally.
    `_normalizeLegLabel` preserves `_default` across reload / import.
    The validator (`validateRoute`) accepts either shape (`a` only when
    `_default: 1`, else `a` + `p`).
  - **Reset buttons:** inspector `↻ Reset marker position` (per leg)
    and toolbar `#tool-reset-all-markers` `↻ Reset all marker positions`
    (all legs, prompts `confirm()`). Both call `_defaultLegLabels()`.
- **Cumulative-time kites:** `cumLabel` (inbound, anchored at the leg's
  destination waypoint) and `cumLabelRet` (return, anchored at the leg's
  start waypoint) use the same `{a,p,_m:1}` storage as leg labels, but
  dragging is intentionally endpoint-relative: each pointer move recomputes
  the vector from the anchor waypoint to the pointer, so the kite orbits the
  waypoint and can move nearer/farther. The drawn cumulative-time kite rotates
  to point back at its anchor waypoint, so orbiting is visible instead of
  reading as a free-floating label.
- **Mid-leg distance badge:** global toggle (`showMidLeg`).
- **Magnifying glass:** toggle button 🔍 in the **View** section. Shows a
  circular **400 px** loupe (default; `magnifierSize`) of cloned base
  tiles plus the captured route overlay, centred on the cursor.
  Configurable via the magnifier settings panel (slider `magnifierZoom`,
  default 2×, mouse-wheel + slider; close button `#mag-settings-close`).
  The loupe follows the cursor with `pointer-events: none` so
  clicks/drags pass through. Click inside the loupe to **lock** it to a
  fixed map position (border turns green); click again to unlock. ESC
  closes the magnifier entirely.
  - **Adaptive hi-res tiles:** `rebuildMagnifier()` in `io.js` reads the
    active tile layer's `_tiles` cache (works for any URL template,
    including Satellite's `{z}/{y}/{x}`) and fetches sub-tiles at a
    deeper zoom so labels stay readable at wide base zooms. Formula:
    `desiredExp = max(ceil(log2(slider)), MAG_BASELINE_Z - refZ)`
    clamped to `MAG_MAX_EXP = 4` and `maxNativeZoom - refZ`, where
    `refZ` is the tile zoom of the reference cloned tile —
    `_tiles[k].coords.z` — which is usually the current Leaflet
    `map.getZoom()` but can lag during a zoom transition.
    `MAG_BASELINE_Z = 12` (Israeli VFR labels become legible there).
    Cursor-centred fetch window keeps tile-request count flat at
    ~16 per rebuild across all base zooms. Tile failures clean up via
    `tile.onerror = () => tile.remove()`.
  - **Slider invariant:** the CSS scale on `#mag-content` always equals
    the slider value — `sub` (tile zoom step) is an implementation
    detail, not a multiplier on visible magnification. Hi-res tiles
    are downsampled to the slider's scale rather than forcing the
    loupe to render at `max(slider, sub)`.
  - **"Perfecting…" indicator:** a `.mag-loading` pill appears inside
    the loupe while hi-res sub-tiles are in flight and hides once they
    all settle (`_magPendingTiles` counter + `_magBatch` id to discard
    stale callbacks). Never shown at max native zoom (no hi-res
    fetched). String key `magLoading`.
  - **Refresh triggers:** map `move`/`zoom`/`moveend`/`zoomend`/
    `rotate`/`layeradd` all dirty the loupe and queue a single rAF
    rebuild via `scheduleMagRebuild()`. Cursor moves past
    `max(8, magnifierSize / 2 / _magEffS)` client px trigger a
    refetch. Locked loupe keeps its screen position but its content
    still refreshes when the map below changes.
  - **Overlay capture:** before `overlay.toDataURL()` the magnifier
    calls `draw()` so the route, waypoint dots, leg markers, and notes
    are re-rendered against the current map state and stay anchored
    to terrain during pan (not just on `moveend`).
- **Drift lines** (10°), **minute markers** with even-minute numeric
  labels and a white halo.
- **Comm-change frequency callouts:** the "Show/Add Freq Changes" layer
  still draws red rings on published comm-change reporting points. When a
  route waypoint sits on one of those points, `seedCommChangeNotes()`
  creates a real draggable note tagged `cc: <ICAO>`, with editable
  `freqName` / `freq` fields. Tagged notes render as chart-style lightning
  arrows: the arrow point stays on the waypoint, the stored note coordinate
  is the movable far tail, and the name/frequency are drawn above/below the
  arrow rather than inside a note box. Selecting the callout opens inspector
  fields for name + frequency. If `docs/data/cvfr-comm-change.json` defines a root
  `callSigns` catalog and a point's `callSigns` array, the inspector also
  shows a call-sign dropdown; choosing an option copies its default primary
  frequency into the editable frequency field. Call-sign names use the
  catalog's `he` translation when the app is in Hebrew, falling back to
  `label`. Editing a call-sign frequency stores a local override in
  `navaid.commFreqOverrides` keyed by call-sign id; new and auto-generated
  callouts for that call sign use the override, and the inspector shows the
  catalog template frequency when the active value differs. Optional
  `routeHints` entries on a comm-change point are route-context call-sign
  hints: each entry stores optional adjacent route waypoint names
  (`before`, `after`) and the `callSign` ID to use for that context. Display
  labels and frequencies are derived from the call-sign catalog. Ambiguous or
  unmatched routes fall back to the normal route graph. Shipped route-template
  comm-change notes are used as regression evidence for these hints and keep
  only `cc` / `freqName` / optional `freqAuto`; `routeFromTemplate()` expands
  them into full saved-route notes with a concrete `freq`. `tests/comm-change.spec.js`
  verifies that every template `cc` call sign has a matching `{before, after,
  callSign}` route hint, with frequencies kept in the call-sign catalog instead
  of the hint.
  Defaults are
  route-aware: `commRouteCalloutDefaultsMap()` treats
  each comm-change waypoint's call-sign list as a boundary in an ATC graph,
  then picks the sector after crossing based on route order, neighboring
  comm-change boundaries, and the actual route points before/after each
  boundary. Route-context hints match call-sign labels, nearby airfields when
  one exists, and nearby comm-change boundary points that advertise the same
  call sign, so sectors without airfields still get useful suggestions.
  Example: LLHZ → DEROR → DAROM → LLHA suggests PLUTO_WEST at DEROR,
  then HAIFA at DAROM; the reverse route suggests PLUTO_WEST at DAROM, then
  HERZLIYA at DEROR. Auto-suggested
  notes carry `freqAuto: true` so route direction changes can refresh them;
  an inline Auto checkbox beside the call-sign dropdown stays checked while a callout is
  following that route default, and the call-sign dropdown selects the resolved
  call sign itself. Choosing a named call sign or editing the frequency clears that
  flag and preserves the user's manual choice. Turning the layer on seeds lightning
  arrows only for matching
  waypoints already present in the route, never for unrelated reference
  points. The default callout tail starts east/right of the waypoint via
  `commChangeNoteLngOffset`. Turning the layer off hides red rings, tagged
  callout notes, their hit-testing, and route-waypoint inspector
  comm-change badge/details without deleting the saved callout notes, so
  toggling back on restores the same editable callouts. These fields are saved in the
  existing `navaid.route` note payload (`cc`, `freqName`, `freq`, optional
  `freqAuto`), not in a separate storage key. Deleted callouts are tracked
  in `navaid.route.suppressedCC` (an array of canonical waypoint names);
  the auto-seed pass skips suppressed names. "Add frequency change" in the
  waypoint inspector clears the suppression and re-creates the callout for
  known comm-change points; for other named route waypoints it creates a
  manual callout with editable call-sign text and frequency.
  Suppressions are cleared when the waypoint is removed, moves away from
  the comm-change point, the route is cleared, or a new file is loaded.
- **Map legend:** a Leaflet control (bottom-left, floating over the map) with
  entries for airfield triangles, waypoint circles, and freq-change red rings.
  The markup lives in `index.html` so `applyI18n()` fills its text at boot;
  `ui.js` reparents the element into the control at startup. Not drawn by
  `draw()` or `exportPNG()`, so PNG exports stay chart-only.
- **Hidden developer tuning panel:** open with `?tune=1`
  (`?lang=en&tune=1`, `/pr/NNN/?lang=en&tune=1`, etc.);
  `?tune=0` / `false` / `no` explicitly disables it. The registry
  lives in `NavAid.tuningDefaults` / `NavAid.tuningGroups` (`core.js`),
  values are read through `tune(key)` in drawing / hit-testing code, and
  `createTuningPanel()` (`ui.js`) renders controls into `#tuning-panel`.
  CSS-backed chrome values use `applyTuningCssVars()` (`ui.js`) to mirror
  Tune values into `:root` variables; the "Chrome layout" group owns the
  Zulu clock styling and the default inspector top / viewport gap.
  Canvas/map drawing colours live in the feature group that owns the
  shape (for example kite fills with "Leg kites", page scrim with "Page
  frame", and profile colours with "Vertical profile"), with shared
  draw palette values in "Global palette".
  Each slider group has a ↻ reset button that restores the HTML default
  via the slider's own input handler. Preview values are page-local
  only: no `localStorage` / `sessionStorage` writes, and reload restores
  source defaults. Any new visual, layout, label-position, dash-pattern,
  font-size, marker-size, page-frame, or hit-test constant should be
  added to `tuningDefaults` and a group so it is available in Tune;
  keep only non-preview domain invariants (for example Earth radius,
  storage keys, URLs) as hard-coded constants. Cover panel behavior in
  `tests/tuning-panel.spec.js`.
- **Opacity (Display):** `tintFill(hex, a)` builds `rgba(r,g,b, a)` where `a`
  defaults to `yellowAlpha` — the **Label opacity** slider for waypoint label
  backgrounds (`navaid.yellowAlpha`, default 0.5). Kite fills **and note
  backgrounds** pass `tune('kiteNoteAlpha')` instead — there is no Display
  slider for it; it is gist-only (default 0.5), adjustable in the hidden
  `?tune` panel under Global palette.
- **Magnetic variation:** hardcoded at `magVar = -5` in `core.js`
  (5°E variation for Israel). The user-facing Mag-var input was
  removed; the `navaid.magVar` localStorage key is no longer written
  or read.
- **Satellite inspector preview:** the small inspector snippet is static
  Esri imagery; expanding it opens a live Leaflet modal with zoom, layer
  picker, reset-to-centre, and rotation sync. Chart layers remain selectable
  there, but switching to CVFR / Navigation / Low Alt / Helicopters clamps the
  modal to a readable chart zoom near each layer's native tile level instead
  of overscaling into blur.
- **Altitude propagation:** editing a leg's altitude updates the
  adjacent legs that currently share the old value, stopping at the
  first different leg. Inbound walks forward, outbound walks backward.
- **Altitude pairs modal:** pair labels focus the corresponding chart leg.
  By default the modal closes after focus; the 📌 toggle beside the close
  button keeps the resizable table open while focusing additional legs,
  and keeps the blinking red leg highlight visible until another pair is
  focused or the modal is closed. The pair search is token-based, so
  endpoint names match in either order; an exact two-endpoint search
  auto-focuses the chart leg without clicking the result. The modal can
  be resized down to a compact few-row view for filtered results.
- **Route templates never carry altitudes.** `route-templates.json`
  entries define only waypoints + `defaultSpeed`; leg altitudes are
  resolved from the active `<prefix>-leg-altitude.json` dataset.
  Do not add `inboundAltitude` / `outboundAltitude` to a template — they
  must come from the altitude dataset so a route stays consistent with
  the chart. Templates are listed alphabetically by name.
- **Reverse:** flips waypoint order, swaps each leg's
  inbound/outbound altitude, swap+negates `inLabel` / `outLabel`.
- **Waypoint-name rotation:** the `⟳` button by "Show waypoint names"
  cycles `wpNameAngle` 0/90/180/270; all names draw at that angle.
- **Plan table:** `📋 Plan` opens a modal with a per-leg flight plan
  (`#`, From, To, Hdg, Dist, Speed, Alt, Time) plus totals; the per-leg
  distance column is hidden by default and can be re-enabled from Columns.
  From/To
  names and Speed/Alt are editable inputs; the rest is `textContent`
  only — user names / notes can't inject HTML. The Print button switches to
  a print stylesheet that hides modal chrome and controls, then prints the
  plan as plain white-page tables rather than a modal screenshot. The CSV
  button beside Print downloads the currently displayed forward/return plan
  tables as UTF-8 BOM-prefixed `flight-plan-*.csv`, excluding modal controls
  and delete buttons. The Nav log button opens a print-ready kneeboard
  document; its comm-change radio-frequency list is sorted by route waypoint
  order, not by note insertion order.
- **Vertical profile / TOC (there is no TOD):** `routeProfile()` in `core.js`
  draws per-leg altitude ramps in the flight-plan modal and emits map markers
  while the plan is open. The only ramp is the departure climb — that is where
  the aircraft demonstrably leaves a known elevation. Departure TOC uses the
  aircraft/profile climb performance (speed plus ft/min vertical speed), capped
  to the available leg distance, and is emitted only when the departure resolves
  to an airfield elevation. **No TOD:** no descent is invented onto the
  destination field, and a leg starting anywhere other than an airfield is drawn
  level at its own altitude with no synthesized mid-route ramp. `routeProfile()`
  returns `tocs` and no `tods`, which `tests/vertical-profile.spec.js` pins. The
  V/S input persists at `navaid.profileVS` and moves the climb ramp and its TOC
  marker.
- **Show Nav Waypoints** (default **on**): the active
  `<prefix>-nav-waypoints.json` is fetched once at boot; CVFR currently has
  172 points and renders white-fill / black-stroke 3.5 px
  dots; the 5-letter ID label appears at zoom ≥ 10. Captured in PNG
  export. Source: IAA CVFR chart page 113 (2025 edition) — see the
  Notes / pending section.
- **Charts / frequency modals:** `📡 Freq table` opens
  `showFreqTableModal()` (`io.js`) with the comm-change call-sign
  frequencies referenced by `commChangeMap[*].callSigns` (not unused
  catalog rows). The search box filters by call sign, code, Hebrew
  label, and visible frequency values. Edits are local
  `navaid.commFreqOverrides` values and the row / all restore controls
  revert those entries back to the shipped template frequencies. `🗺️ Charts` opens
  `showChartsModal()`, which lists every airfield in
  `airfields.json` that carries a non-empty `plates[]` as a
  collapsible section (header `ICAO — English name`, plate chips
  grouped by `plateCategory()`). `🧭 Alt pairs` opens the
  active `<prefix>-leg-altitude.json` editing table; each direction, each row, and the full
  page have reset controls that restore values to the loaded origin data.
  **Airfields are listed alphabetically by ICAO** — `renderList()` sorts `withPlates` via
  `a.name.localeCompare(b.name)` before rendering, so JSON row order
  never leaks into the UI. Keep that sort when touching the list.
- **A3 / A4 page frame:** `pageFrameRect()` returns the rectangle in
  screen px sized so its contents are 1:250 000. Clicking the same
  size button again clears it. Orientation chosen via the
  `chooseOrientation()` modal. The toolbar Fit button and `F` fit the active
  page frame when one is selected; without a frame they fit the route.
  The frame stays centred on the viewport by default, so dragging its border
  pans the map underneath it. The gist boolean `pageFrameLocked` defaults to
  `true`; setting it to `false` restores the legacy movable-frame drag grip.
  The gist numbers `a3FitZoomOffset` and `a4FitZoomOffset` default to `0`, so
  an unset gist preserves the calculated page zoom. Negative values zoom out;
  A4×2 uses `a3FitZoomOffset` because its assembled frame is A3-sized.
  `Fit page to route` likewise pans map content into the locked frame, while
  `refreshPrintFit()` checks whether that action can help without moving the map.
  Print keeps both fit actions visible. `Fit page to route` is disabled/dimmed
  unless a supported page/orientation can contain all print ink. Locked mode
  centres the map on that ink; legacy unlocked mode centres the paper.
  Opening a waypoint or leg inspector while Print is open raises the shared
  inspector above the Print panel; closing the inspector reveals Print again.
  On desktop, the floating Print panel starts opposite the inspector: left in
  English/LTR and right in Hebrew/RTL. Both panels remain draggable, but
  collision avoidance prevents either one from covering the other. Opening an
  inspector moves an overlapping Print panel to the nearest free position. The
  gist number `floatingPanelGapPx` controls their separation and defaults to 12.
- **Unnamed closed-loop labels:** repeating an earlier unnamed route waypoint
  reuses its sequence label. A route closed on its first point is displayed as
  `WP 1 → … → WP 1` on the map, in inspectors, and in the flight plan; the
  repeated visit does not acquire a new sequence identity or consume the next
  number. For example, a new point after `WP 1 → WP 2 → WP 3 → WP 1` is
  `WP 4`, not `WP 5`. A route can make one ordinary turn by flying
  `WP 1 → WP 2 → WP 3 → WP 4 → WP 3`; the final press appends the return leg.
  Pointer jitter below `originResnapArmPx` while in Add mode remains a
  visit/tap and cannot invoke the adjacent-point drag-delete gesture. An
  intentional drag beyond that threshold can still delete a point by dropping
  it on its neighbour.
- **Keyboard shortcuts cheat-sheet (issue #420):** modal listing every
  global shortcut, openable via the toolbar "Shortcuts" link (in
  `#footer-links`) or the `?` (Shift-`/`) key. Built by
  `showShortcutsHelp()` / `closeShortcutsHelp()` in `io.js` from the
  `SHORTCUTS_HELP_ROWS` array; each row's `descKey` resolves through
  `S.shortcut*` so Hebrew and English render idiomatically. Modal has
  `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the title,
  Tab/Shift-Tab focus trap, and closes via Esc / backdrop / ✕ button.
  `?` is suppressed inside inputs / textareas / contenteditable so users
  can still type a literal question mark in waypoint names or notes.
  Letter shortcuts are English-key shortcuts in every locale: the
  cheat-sheet keeps `A`, `N`, `C`, etc. as key labels, and the handlers
  match physical `KeyboardEvent.code` values so the same English keys work
  while the OS keyboard layout is Hebrew.
  Current global shortcuts surfaced:
  - **Navigation:** `F` — fit the selected A3/A4/A4×2 page frame to the view, or fit
    the route when no page is selected; `+`/`=` / numpad `+` — zoom
    map in (loupe zoom in when magnifier is on); `−`/`-` / numpad `−` —
    zoom map out (loupe zoom out when magnifier is on); `M` — toggle
    magnifying glass (skipped while any modal backdrop is open).
  - **Search:** `Ctrl/Cmd-F` — open search
  - **Editing:** `A` — toggle add-waypoint mode; `N` — toggle add-note
    mode; `C` — clear the map; `R` — reverse route direction;
    `B` — toggle show return path / both directions (the `ret-cb`
    checkbox); `Ctrl/Cmd-Z` — undo the last committed edit/move/delete; `Esc` —
    close modal / deselect / close magnifier; `D`/`Delete`/`Backspace` —
    delete selected waypoint or note (A/N/C skipped while any modal
    backdrop is open)
  - **Help:** `?` — open the cheat-sheet
  When you add a new global keyboard shortcut, append a row to
  `SHORTCUTS_HELP_ROWS` (and matching `shortcutXxx` keys in `app/core.js` +
  `i18n/he/strings.js`) so the cheat-sheet stays in sync.
- **Save PNG (`exportPNG`):** renders the framed region (or current
  view if no frame) at native tile zoom into an off-screen canvas.
  Tiles are fetched directly from each active layer URL. Then re-runs
  the canvas draws scaled into the export canvas and triggers a `.png` download
  named `navigation-A4.png` / `navigation-CVFR.png` etc.
  An "Include cumulative time" checkbox in the export modal (default on)
  includes the cumulative-time kite layer in the exported PNG; disabling
  it still renders leg markers but hides cumulative kites. Drift lines have
  no separate print override: export uses the route's current global and
  per-leg drift visibility. The outbound / return selector filters route-bound map
  visuals: track lines, waypoints, kites, drift, time and distance marks, wind and
  profile marks, and anchored notes. It also filters route totals, flight-plan rows
  and profile, the placed plan card, print ink bounds, and Route Fit. Global chart
  overlays and free map notes stay visible.
  A placed card starts in the visible part of an oversized, zoomed-in page frame. In
  the printed plan card, airfield procedure legs that omit leg time also omit direction
  (airfield to first reporting point and last reporting point to airfield).
- **GPS track recorder:** the `📍 Record GPS track` toggle in the View/Set
  toolbar section records the flown path from the device GPS (live own-ship
  dot + breadcrumb trail on the map). On Stop it auto-saves a timestamped
  `kind:'gps'` saved-route entry containing simplified waypoints plus the raw
  `track[]` breadcrumb, carried by the existing Drive sync. Requires HTTPS.
  The footer live readout shows magnetic heading, altitude, and speed for GPS
  recording, plain live location, and the simulator. It remains visible in the
  compact desktop/full-screen toolbar while one of those sources is active;
  when desktop live mode stops it hides again. Mobile keeps its existing text
  footer behavior. The footer plane button opens the Simulator panel. Its title
  is a drag handle; pointer dragging clamps the panel to the viewport so its
  close button and controls remain reachable.
  Recording takes a **screen wake lock** while it runs (`gpsAcquireWakeLock()`
  in `gps.js`), releases it on Stop, and re-acquires it when the page becomes
  visible again — browsers drop the sentinel while the tab is hidden, so a
  backgrounded browser tab can still leave gaps. The native app uses background
  geolocation instead, which is a separate capability.

## Persistence (`localStorage` + `sessionStorage`, all keyed `navaid.*`)

The enforceable inventory is `GDRIVE_SETTINGS_KEYS` plus the reasoned
`NOT_A_SYNCED_SETTING` registry in `tests/settings-sync-allowlist.spec.js`.
That test scans every app literal so a new key cannot silently escape the
sync/device-local decision. The list below documents the main keys and dynamic
families; when code and prose disagree, update both rather than treating prose
as a machine-readable registry.

`localStorage` (persisted across reloads):

- `navaid.route` — `{waypoints, legs, notes}` (debounced; route geometry
  only — the viewport is saved separately under `navaid.view`).
- `navaid.view` — `{lat, lng, zoom, bearing?}` of the map viewport at
  rest, written 300 ms-debounced on `moveend` / `zoomend` / `rotate`
  (issue #413). On boot the saved view wins over the historical
  fit-to-route auto-frame; the auto-fit only runs when no valid saved
  view exists (first-time users, cleared storage). Sanity-rejected if
  coords fall outside the Israel bbox (lat ∉ [28, 34] or lng ∉ [33, 36])
  or zoom outside `[map.options.minZoom, map.options.maxZoom]`.
  `bearing` is also written to legacy `navaid.bearing` for back-compat,
  but `navaid.view.bearing` wins on restore when present. Manual re-fit:
  the `⌖ Fit to screen` toolbar button (Build or Print section) or the `F`
  keyboard shortcut (when not focused in an input). With an A3, A4, or A4×2 frame
  selected, those controls fit the frame instead of the route.
- `navaid.layer` — selected base layer name.
- `navaid.navDataPrefix` — which chart the *navigation data* comes from,
  independently of the base layer's visuals: `''`/absent = **follow chart**
  (the default), or an explicit `'cvfr'` / `'lsa'` / `'heli'`. One value drives
  `layerDataPrefix()`, so it swaps nav waypoints, comm changes and leg altitudes
  together — they belong to one chart, and mixing them (heli waypoints against
  CVFR altitudes) would quietly produce a wrong plan. Changing it takes the same
  path as a base-layer switch, so a route pinned to another chart is not
  rewritten. Synced by Drive (`GDRIVE_SETTINGS_KEYS`), alongside
  `navaid.layer`. Note that these are two independent settings: the base chart
  decides what you see, this decides what the plan is computed from.
- `navaid.lang` — `'en'` / `'he'`; bootstrap script in `index.html`
  reads this before the app loads.
- `navaid.toolbarPos.<lang>` and `navaid.toolbarPosDesktop.<lang>` — `{x, y}`
  for the floating mobile toolbar and desktop menubar.
- `navaid.toolbarCollapsed` — `'0'` / `'1'` for the collapsed floating
  mobile toolbar. Desktop menubar view ignores this value.
- `navaid.sec.<sectionId>` — `'0'` / `'1'` per accordion section
  (`build`, `view`, `display`, `charts`, `export`, `print`, `sim`, etc.).
- `navaid.inspPos.<lang>`, `navaid.clockPos.<lang>`,
  `navaid.legendPos.<lang>`, `navaid.searchPos.<lang>`,
  `navaid.tunePanelPos.<lang>`, and `navaid.fpPos.<lang>` —
  language-specific dragged panel/widget positions. On first read,
  `navLangPosRead()` adopts a legacy bare position key into the active
  language's key and leaves the bare key available for the other language.
  Position keys and other panel geometry are device-local.
- `navaid.bearing` — map bearing in degrees (rotated-map support).
- `navaid.theme` — `'dark'` / `'light'` for toolbar and panel chrome.
- `navaid.yellowAlpha` — Label-opacity slider value (waypoint labels).
  (Kite/note opacity is not persisted here — it's the gist tune key `kiteNoteAlpha`.)
- `navaid.mapOpacity.v2` — base-map opacity slider value.
- `navaid.wpSize` — Text-size slider value.
- `navaid.legArrowSize` — leg-arrow size slider value.
- `navaid.legLineWidth3` — route-line width scale (default 0.5, range 0.1–0.9). Bumped twice: `legLineWidth` → `legLineWidth2` when the default/range first changed, then → `legLineWidth3` when the range narrowed again to 0.1–0.9. A legacy value is adopted when it falls inside the current range (see `adoptRangedNumber`), so only genuinely out-of-range settings fall back to the default instead of being silently clamped.
- `navaid.driftLineWidth2` — drift-line width scale (default 1, range 0.2–1.8). Versioned when the range narrowed from 0.5–6; legacy values inside the new range are adopted.
- `navaid.showReturn` — `'0'` / `'1'` for the return-leg overlay.
- `navaid.showMidLeg` — `'0'` / `'1'` for the mid-leg distance badge.
- `navaid.showCumTime` — `'0'` / `'1'` for cumulative-time kites.
- `navaid.limitLegKites` — `'0'` / `'1'` for clamping dragged
  leg-marker kites between the two waypoints of their leg (default on).
- `navaid.showDrift` — `'0'` / `'1'` for drift lines.
- `navaid.highlightDiff` — `'0'` / `'1'` for altitude-diff halos.
- `navaid.showNavWP` — `'0'` / `'1'` for the nav-waypoints overlay.
- `navaid.showAirfields` — `'0'` / `'1'` for the airfield overlay.
- `navaid.showReporting` — `'0'` / `'1'` for mandatory-reporting badges.
- `navaid.showMsa` — `'0'` / `'1'` for the leg-inspector MSA row.
- `navaid.showWind` — `'0'` / `'1'` for wind inputs, arrows, and readout.
- `navaid.windField`, `navaid.windFieldAlt`, `navaid.windFieldOpacity`, and
  `navaid.wxTime` — wind-field visibility and device-local forecast scrub state.
- `navaid.showSigmet` — `'0'` / `'1'` for the SIGMET overlay.
- `navaid.showVorStations` — `'0'` / `'1'` for VOR/DME station markers.
- `navaid.showVor` — legacy VOR marker key, migrated once to
  `navaid.showVorStations` and removed.
- `navaid.vorRef` — selected global reference VOR ident for radial/DME
  readouts.
- `navaid.forceSnap` — `'0'` / `'1'` for forcing new waypoint clicks to
  snap to the nearest reference point.
- `navaid.showFreqChanges` — `'0'` / `'1'` for the Show/Add Freq Changes
  overlay and callouts (default on). Replaces the legacy
  `navaid.showCommChange` key, which is intentionally ignored so older
  stored-off users get the default-on behavior.
- `navaid.commFreqOverrides` — object keyed by comm call-sign id
  (`HERZLIYA`, `PLUTO_WEST`, etc.) containing locally edited frequency
  defaults. Empty / template-matching edits remove the key.
- `navaid.airfieldFreqOverrides` — object keyed by airfield frequency id
  for locally edited airport frequency defaults.
- `navaid.vorFreqOverrides` — object keyed by VOR ident for locally edited
  VOR frequency defaults.
- `navaid.showWpNames` — `'0'` / `'1'` for waypoint-name display.
- `navaid.wpNameAngle` — waypoint-name rotation (`0`/`90`/`180`/`270`).
- `navaid.aircraft` — last-used aircraft profile JSON (fuel planner).
- `navaid.profileVS` — vertical-profile climb rate input, used for timing and
  the TOC ramp distance. (The profile draws a departure TOC only; there is no
  TOD — see the vertical-profile entry above.)
- `navaid.ai.provider` — active AI-assistant LLM provider id (`gemini` |
  `anthropic` | `openrouter` | `deepseek`; default `gemini`; `assistant.js`).
- `navaid.ai.key.<provider>` — the user's own API key per provider (BYOK).
  Never leaves the browser except in the request to that provider.
- `navaid.ai.model.<provider>` — model id per provider (defaults:
  `gemini-2.5-flash` / `claude-sonnet-5` / `openai/gpt-4o-mini` /
  `deepseek-chat`).
- `navaid.ai.baseUrl` — base-URL override for the OpenAI-compatible providers
  (OpenRouter / DeepSeek), e.g. to route through a CORS proxy.
- `navaid.routes` — saved-route library entries and tombstones. An entry
  may carry `kind: 'gps'` plus a raw `track[]` (the recorded GPS
  breadcrumb: `{lat,lng,t,alt?,acc?}`); loading applies the simplified
  waypoint route, the raw track is retained for fidelity.
- `navaid.syncSettings` — `'1'` when the opt-in "Sync settings too" box (route
  library → Drive) is enabled. Device-local; itself never synced.
- `navaid.settingsSyncedAt` / `navaid.settingsSnapshot` — bookkeeping for the
  optional Drive **settings** sync. The synced blob lives in Drive app-data as
  `navaid-settings.json` (separate from `navaid-routes.json`); the allowlist is
  `GDRIVE_SETTINGS_KEYS` in `gdrive.js` and deliberately excludes API keys,
  panel geometry, and the working route. It also excludes, as a rule, **any key
  that decides where data is sent** — `navaid.ai.baseUrl`, and
  `navaid.fpl.aisEmail` (the address a flight plan is filed to: an override
  synced from a settings blob would redirect every device's plan). The pilot's
  own `navaid.fpl.replyTo` IS synced: it is cc'd, so a wrong value costs them
  their copy but cannot misdirect the plan, and it is required to file — keeping
  it device-local would block a second device. `tests/settings-sync-allowlist.spec.js`
  enforces this: every `navaid.*` literal must be synced or declared in
  `NOT_A_SYNCED_SETTING` with a reason. Protocol details that a second
  reader/writer of that file MUST honour:
  - **Changing the allowlist — in either direction — is a normal event, and the
    change detector must survive it.** `_settingsChangedLocally()` compares only
    the keys the snapshot has an *opinion* about: a key it holds that we no longer
    do is a deletion (a real edit), and a key we hold that it lacks is "no
    information", the same rule this protocol already states for absent keys.
    Comparing raw JSON strings read a *removal* as a local edit; comparing every
    current key read an *addition* the same way. Either one made the device stamp
    itself above the remote and push pre-upgrade values over a peer's newer ones,
    once, on every upgraded device. But "absent from the snapshot" has **two**
    causes that the values alone cannot distinguish — the allowlist gained the key,
    or the pilot set it for the first time (the normal state, since most keys are
    unset until used) — and skipping both dropped that first setting for good. So
    the snapshot records the allowlist it was written against, in
    `navaid.settingsSnapKeys` (written AFTER the snapshot, and tolerated if refused:
    the snapshot is what the detector cannot work without). A snapshot that predates
    that record is **adopted once** by `_adoptLegacySnapshot()` — every allowlisted
    key we hold but it lacks is taken into it, as if synced — so the ambiguous case
    exists for one call instead of forever. Do not try to resolve it by consulting
    the remote: a remote that already holds the key cannot say whether our value is
    a stale copy or a fresh first setting, and a remote *tombstone* reads as "the
    remote has it", so a peer's deletion silently erased a value the pilot had just
    typed. Getting any of this backwards is not "one lost round": the loser applies
    the winner's values, so either verdict destroys a real setting somewhere.
  - `values[key] === null` is a **tombstone** ("deleted on the authoring
    device"), not "no value". A reader that drops nulls when re-publishing
    erases the deletion for every device that has not synced yet. A key that is
    *absent* means "no information" (an older blob) and must be left alone.
    For a gist-controlled toggle a tombstone also means "following the gist",
    which is why clearing the key is the correct way to apply it.
  - `updatedAt` is **monotonic**, not wall-clock:
    `max(Date.now(), ourLast + 1, remote + 1)`. This is what stops a device with
    a skewed clock from outranking everyone until the skew passes, and stops a
    tie from freezing the stamp so two devices overwrite each other forever.
  - `navaid.settingsSnapshot` must be byte-identical to
    `JSON.stringify(collectSyncableSettings())` — i.e. canonical
    `GDRIVE_SETTINGS_KEYS` order, nulls omitted. A snapshot built with
    `Object.assign` has a different key order, which reads as a phantom local
    edit on every later sync and pushes over newer remotes.
  - Snapshot **absent but `settingsSyncedAt` present** = "synced before, could
    not store the snapshot" (quota). It is NOT a new device: treat local as
    unchanged and rank by the stored stamp.
  - Snapshot **and** stamp absent = never synced. That first sync against an
    existing file does a per-key **union** (never timestamp ranking), and keys
    set differently on both sides are a conflict the UI must resolve; a
    dismissed prompt aborts the sync rather than picking a side.
  - Applying is all-or-nothing: a rejected `localStorage` write rolls the
    already-written keys back and throws, because a half-applied device reads as
    a local edit and would push the mixture over the authoring device.
- `navaid.pageSize` — selected page frame size (`A3` / `A4` / `A4x2`) or cleared.
  (`A4x2` draws the A3-size frame; Save PNG slices it into two A4 tiles.)
- `navaid.plateAirfield` — "Show plates for" filter on the airfield-plate
  overlays: `''` = all airfields, `'auto'` = the route's first & last airfield
  (live via `syncLegs()`), or a single ICAO.
- `navaid.overlayBoundsOverrides` — per-plate overlay geometry overrides from
  the `?align=1` align editor, keyed by overlay PNG filename; axis-aligned
  (`sw`/`ne`) or rotated (`tl`/`tr`/`bl`). Wins over `airfields.json` bounds.
- `navaid.pageOrient` — `'portrait'` / `'landscape'` for page export.
- `navaid.fpPos.<lang>` — `{x, y}` of the dragged Flight Plan modal (included
  in the language-scoped position migration described above).
- `navaid.fpColumns` — JSON array of hidden Flight Plan table column keys
  (`seq`, `from`, `to`, `hdg`, `dist`, `speed`, `alt`, `time`, `fuel`,
  `cumTime`, `cumFuel`, `radial`, `dme`, optional `freq`). When the key is
  absent, `dist` is hidden by default; an explicit empty array means the user
  chose All columns. Missing keys are shown, so newly added columns default
  visible.
- `navaid.fpl.<field>` — flight-plan pilot/aircraft/contact form values;
  `replyTo` may sync, while `aisEmail` is device-local because it controls the
  filing destination. See the allowlist test for the exact decision.
- `navaid.imsPwx`, `navaid.sigwxOv`, `navaid.showNotam.<prefix>`, and the
  related opacity keys — current chart/overlay choices (per-chart families are
  enumerated from the active CVFR/LSA/heli prefixes by tests).
- `navaid.apkReloadedForBuild` — native-shell reload bookkeeping, device-local.
- Session keys: `navaid.selected`, `navaid.fpOpen`, and
  `navaid.openChartModal` restore transient UI state within a tab visit.
- `navaid.simUrl` — simulator bridge base URL.
- `navaid.simOn` — `'0'` / `'1'` for simulator auto-reconnect state.
- `navaid.simFollow` — `'0'` / `'1'` for simulator-follow mode.
- `navaid.tracks.shown` — JSON array of shown recorded-track ids
  (`gps.js`). Only one track is shown at a time, so this holds 0 or 1 id;
  an older multi-id list is healed to a single id on load.
- `navaid.localTiles` — `'1'` when the localhost-only `?localTiles=1` dev
  mode (serve chart tiles from the local MBTiles server) is enabled
  (`core.js`). Never set off localhost; absent in production.

`sessionStorage` (cleared on tab close — used to survive a language
re-load that does a full page navigation):

- `navaid.selected` — `state.selected` round-trip.
- `navaid.fpOpen` — `'1'` if the Flight Plan modal was open pre-reload.
- `navaid.openChartModal` — chart/frequency modal kind to reopen after a
  language reload.

`magVar` is hardcoded at `-5` in `core.js`; the obsolete
`navaid.magVar` key is no longer written.

When adding a new key, grep `localStorage.setItem` /
`sessionStorage.setItem` under `docs/` to stay in sync with this list.

`save()` / `load()` round-trip waypoints (with `name`), legs (with
`inLabel` / `outLabel`), and notes (with `color`, `shape`) as a
downloadable `route.json`.

## Build / test / deploy

- **Test locally:** `python3 -m http.server -d docs 8000` →
  `http://localhost:8000`. Inject a test route with a trailing
  `<script>` that sets `state.waypoints` and calls
  `syncLegs(); fitView(); draw();`.
- **Branch check** before every commit: run `git branch --show-current`.
  If it does not match the branch for this task (or you are unsure),
  **ask the user** before committing — other agents may be on another
  branch. See **Branches** above.
- **Lint** before every commit: `node --check` each changed `.js`.
- **Every enhancement, bug fix, or regression must include tests.** Add new
  test cases to the appropriate `tests/*.spec.js` file. If no file covers
  the area, create one. See `tests/README.md` for which tests run in CI
  vs. built-artifact e2e.
- **Keep `tests/README.md` in sync** when adding tests that don't run in
  e2e-deployed, or when changing the exclusion pattern in `deploy.yml`.
- **Deploy is a workflow** at `.github/workflows/deploy.yml`. It
  triggers on push to `main` *or* `dev` (or manual dispatch),
  checks out **both** branches, and assembles one Pages site:
  - `main/docs/` → `/`
  - `dev/docs/`  → `/staging/`
  - on PRs, the current head is also assembled under `/pr/NNN/` inside the
    artifact for localhost E2E only; the deploy job is skipped.
  - `actions/deploy-pages@v4` publishes only trusted non-PR runs.
- **Staging deploy** follows an issue + feature-branch PR into `dev`; the merge
  push publishes staging. Direct protected-branch pushes are exceptional and
  require explicit maintainer authorization.
- **Production deploy** = merge a `dev` → `main` pull request (`main` is
  branch-protected; the merge triggers the same workflow).
  The promotion automation first verifies that `dev` contains the current
  `main` ancestry. If it does not, the workflow opens a temporary sync PR into
  `dev`, explicitly runs its required checks, and auto-merges it. The merged
  sync then resumes creation of the `dev` → `main` promotion PR. Automation
  never pushes the ancestry merge directly to protected `dev`.
  **Before merging**: delete `REVIEW.md` from repo root if it exists
  (`git rm REVIEW.md && git commit`). It must not land in production.
- **Cache-bust is automatic.** `.github/workflows/deploy.yml` rewrites
  each branch's `docs/index.html` `?v=N` markers, `NavAid.version`,
  every app/i18n `data/*.json?v=N` literal, and the service-worker cache
  name to that branch's short commit SHA after checkout. Source `?v=N`
  values are just placeholders; you don't need to bump them per commit.
  CI lint still enforces that every `?v=` value in the source HTML agrees.
  At runtime, `ui.js` registers `sw.js`, forces one update check on load,
  then re-checks on window focus, visible-tab restore, toolbar/menu
  activity, layer/input changes, and a visible-tab 10 minute interval.
  Those follow-up checks are throttled to once every 5 minutes; the
  existing "New NavAid build available" notice appears only when the
  service worker actually reports a newer installed build.
- **Toolbar version SHA suffix is automatic.** The same Deploy step
  also rewrites `version: '1.0'` → `version: '1.0-<short-sha>'` in
  `docs/app/core.js`, so the toolbar identifies the exact deployed commit.
  Do not manually increase the source version number; the regex is
  idempotent (matches both `'x.y'` and `'x.y-anything'`).
- PRs have no executable public preview. Use CI's built artifact and local
  Playwright/browser verification.
- Watch run status: `gh run list --workflow=deploy.yml --limit 5`.
- **GitHub issues**: a review agent files bugs as GitHub issues on this
  repo. Check open issues at the start of a session:
  `gh issue list --repo msupino/NavigationApp --state open`
  Fix them on `dev` the same way as any other bug — one commit per issue,
  close with `Fixes #N` in the commit message.
- **Every PR must have a corresponding issue.** Open the issue first, then
  create the PR referencing it. This ensures every change is traceable.

## CI / Deploy gotchas

- Both `CI` (`.github/workflows/ci.yml`) and `Deploy`
  (`.github/workflows/deploy.yml`) have `workflow_dispatch:`. Manual
  trigger: `gh workflow run CI --ref dev` /
  `gh workflow run Deploy --ref dev`.
- **Explicitly authorized admin-bypass pushes can silently swallow workflow events.** Pushing
  to `dev` / `main` as a repo admin while branch protection has required
  status checks pending records a "Bypassed rule violations" entry but
  the push event sometimes fails to fire `Deploy` or `CI`. If no run
  appears within ~30 s of a push (`gh run list --limit 5`), dispatch
  manually with the commands above.
- Land ordinary changes through an issue and feature-branch PR to `dev`.
  Admin bypass is not routine recovery and requires explicit authorization.
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

- Flight Maps chart data is copyrighted. Realtime chart display uses
  `https://flight-maps.com`. PNG export/download rendering uses the
  mirrored CVFR, Navigation, Low Alt, and Helicopters tile pyramids in
  `msupino/NavigationApp-tiles`, served from
  `https://navaid-tiles.supino.org`, so canvas tile fetches remain
  readable without the old proxy path.
- `cvfr-nav-waypoints.json` — 172 Israeli CVFR reporting points.
  **Source:** IAA CVFR chart waypoint reference table (page 113, 2025
  edition), supplied upstream as `113_waypoints.csv`. The CSV is the
  sole source of truth — the legacy KMZ dataset
  (`CVFR WAYPOINTS 0225.kmz`) was replaced in issue #406 because it
  carried ~91 stale codes (`AREA *`, `LLHA A/B/C`, `LLMG A/B
  Maarav/Mizrah`, etc.) and had several reporting points off the
  chart by hundreds of metres (notably `BEZRA` ~752 m, `KUVSH` ~648 m,
  causing ~1° heading drift on cross-country legs). `{name, en, he, lat,
  lng, report}`: `name` = 5-letter chart code, `he` = Hebrew place name from
  CSV `Name` column. CSV rows where `Reporting == ARP` are skipped
  here — airfield ARPs live in `airfields.json` with richer data
  (runways, plates, English label). To refresh: replace the CSV with
  the latest chart edition, regenerate the JSON keeping the same
  `{waypoints: [{name, en, he, lat, lng, report}]}` shape and field
  mapping (CSV `Code` → `name`, CSV `Name` → `he`, decimal
  columns → `lat`/`lng` rounded to 5 dp), and diff for sanity. The
  exact migration is documented in the body of the PR that introduced
  it (#406).
- `proposed-altitudes.json` — candidate altitude pairs for detected green
  CVFR route segments. Coordinates are intentionally not duplicated here:
  segment endpoints resolve by `from` / `to` against `cvfr-nav-waypoints.json`
  and `airfields.json`. `inboundAltitude` means `from -> to`;
  `outboundAltitude` means `to -> from`; `oneWay: true` rows use `null`
  for the disallowed direction. The extraction/review trail lives in
  `scripts/cvfr-altitude-extraction.md`, with a machine-readable review ledger
  in `scripts/cvfr-altitude-extraction-notes.json`. The app loads this file as
  a runtime reference for freshly-created legs only; saved/imported route leg
  values stay authoritative, and manual altitude edits clear the auto-fill
  marker. Equal inbound/outbound values are allowed when the chart publishes
  the same altitude both directions, including double-ended yellow altitude
  tags. When refreshing from new PDFs, use the guide's same-route review rules
  before trusting OCR or nearest yellow signs, especially around Haifa / LLHA,
  Herzliya, Beer Sheba, the coastal strip, and Arad / Metzada.
- `cvfr-comm-change.json` — dataset of CVFR reporting points where pilots
  must change ATC frequency (the `מע.` / `מז.` Hebrew sector callouts
  on the IAA CVFR chart, indicating PLUTO West / PLUTO East / etc.).
  Schema: `{version, source, _definition, _NOTE, _TODO, callSigns,
  points:[{name, commChange, callSigns, routeHints, note, source}]}`.
  `name` matches an ICAO 5-letter code in `cvfr-nav-waypoints.json`; airfield
  endpoints may use 4-letter LLxx ICAO codes where the frequency point is
  the field itself. A point's `callSigns` array contains catalog IDs from
  the root `callSigns` object. Optional `routeHints` entries map adjacent
  route waypoint context to a `callSign` ID from that same point array, never
  display labels or frequencies. **Source:** maintainer visual inspection of the printed IAA
  CVFR chart's `נקודת מעבר קשר` symbology, enriched with frequency options
  from the maintainer-provided AirMapRadioFrequencies PDF.
  - **Loader:** `loadCommChange()` in `draw.js` lazy-fetches the file
    at boot (parallel with `loadNavWaypoints` / `loadAirfields` in
    `ui.js`), validates it with `validateCommChange()` in `io.js`, and
    builds the module-level `commChangeMap` keyed by `name` for O(1)
    lookup. A 404 / schema error degrades to `commChangeMap = {}` so
    a missing dataset never disables the rest of the nav-WP overlay.
  - **Render:** `drawNavWaypoints` in `draw.js` augments every white
    nav-WP dot whose `name` has `commChange: true` with a red outer
    ring (radius 6 px, 1.8 px stroke, `#e74c3c`). Gated by the global
    `showCommChange` boolean + the View-section `#commchange-cb`
    checkbox; persisted at `localStorage['navaid.showFreqChanges']`
    (default on; the legacy `navaid.showCommChange` key is ignored).
    The ring sits on top of the white dot — it
    augments, never replaces. A `window.__commChangeRingsDrawn` Set
    is rebuilt every frame for Playwright inspection.
  - **Inspector editor:** `interact.js` `showInspector()` appends a
    freq-change editor to the waypoint pane whenever the selected
    waypoint has a linked callout note (matched by canonical name).
    The editor (shared with the note inspector via `appendFreqEdit()`)
    includes an inline Auto checkbox, a call-sign dropdown that selects the resolved route-default call sign when Auto is checked, editable frequency,
    and `↻ Reset callout location` button. When no linked note exists (overlay off or not
    seeded), legacy datasets with `from` / `to` strings still show that
    read-only pair
    and optional note. Styled in `app/style.css`
    under `/* Comm-change inspector badge (issue #399) */`.
    Standalone map/nav waypoint inspectors are read-only: when the selected
    `navwp` is a comm-change point and the layer is visible, they show the
    point's call-sign options and effective catalog frequencies (for example
    DALIA lists RAMAT_DAVID and PLUTO_WEST) without creating or editing route
    callouts.
  - **i18n keys:** `tbShowCommChange`, `tbShowCommChangeTitle`,
    `commChangeBadge`, `commChangeCallSigns` (English defaults in
    `app/core.js`, Hebrew overrides in `i18n/he/strings.js`).
- `geo` distances are exact great-circle; verify against the chart's
  graticule if precision is questioned.
- The app does not load a third-party analytics runtime. The remote-URL
  Capacitor shell is detected through `window.Capacitor`; the production
  service worker still provides native offline behavior. Only the retired
  `app.navaid.local` shell skips the SW.

## Native mobile packaging

- The native app workspace lives in `mobile/` and uses Capacitor. Run
  `cd mobile && npm install && npm run sync` to validate/sync the small shell;
  the WebView loads the live production URL.
- `mobile/capacitor.config.json` owns the native app metadata:
  `appId: org.supino.navaid`, `appName: NavAid`, `webDir: shell`, and
  `server.url: https://navaid.supino.org`.
- Keep Capacitor packages in `mobile/package.json`; the root package remains
  only the Playwright/static-check tooling for the web app.
- `mobile/scripts/validate-capacitor.mjs` and
  `tests/capacitor-mobile.spec.js` guard the wrapper configuration in CI.
- The installed shell updates with web deploys. Offline behavior comes from the
  production service worker after the first online launch, including explicitly
  downloaded chart packs; native-only changes still require rebuilding the app.

<!-- ci-flake-audit: no-op change to trigger a full CI run -->
