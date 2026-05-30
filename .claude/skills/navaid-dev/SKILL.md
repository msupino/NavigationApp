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
- **PR preview (by number):** https://msupino.github.io/NavigationApp/pr/NNN/
- **PR preview (by branch):** https://msupino.github.io/NavigationApp/branch/BRANCH_NAME/
- **Repo:** https://github.com/msupino/NavigationApp (fork of liorbenhorin/NavigationApp)

## Branches

- `main` — production. The web app source. The Unity tree was stripped
  here (commit `53188cc`).
- `dev` — staging. The same web app, work-in-progress. Each push to
  `dev` rebuilds the staging URL.
- `original-plotter` — frozen Unity 2019 project (renamed from `master`).
  Reference only; do not commit web changes here.

`main` is branch-protected — no direct pushes; production changes land via
a `dev` → `main` pull request. **Every change must go through a feature
branch and pull request — even one-line fixes.** Feature branches should
always target `dev` as the PR base branch.
**Every PR must be preceded by a GitHub issue** describing the bug or
enhancement. Reference it in the PR body with `Fixes #N` or `Closes #N`.

**Before any `git commit`:** run `git branch --show-current` (and
`git status` when in doubt). If the branch is not the one the user
clearly intended for this work (or you are unsure), **stop and ask the
user** which branch to use — do not guess; another agent or session may
be using a different branch. If the branch is correct, proceed. Do not
commit on `main`, `dev`, `original-plotter`, or an unrelated feature
branch by mistake.

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
  matters — later files use globals from earlier ones. Default English
  UI strings live in `core.js` (`window.S`): **sentence case** (first
  word + proper nouns / acronyms such as BYOP, CVFR, JSON); spell
  *waypoint* in full in prose. Hebrew overrides: `he/strings.js`.
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` — PWA:
  installable app + offline app-shell service worker.
- `style.css` — dark UI + `@media print` rules.
- `nav-waypoints.json` — 173 published Israeli VFR reporting points
  (`{name, he, lat, lng}`). Fetched once at boot. **Source:** IAA CVFR
  chart waypoint reference table (page 113, 2025 edition), shipped as
  `113_waypoints.csv` upstream. CSV → JSON migration in issue #406 /
  PR `feat/unified-waypoints`. ARP rows in the CSV are intentionally
  skipped here — airfield ARPs live in `airfields.json` with richer
  data (runways, plates, English label). Updating: drop the CSV into
  the build script and regenerate.
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
  - **Reset buttons:** inspector "↺ Reset marker position" (per leg) and
    toolbar `#tool-reset-all-markers` "↺ Reset all marker positions"
    (all legs, prompts `confirm()`). Both call `_defaultLegLabels()`.
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
- **Transparency slider:** scales every label-background fill via
  `tintFill(hex, a) = rgba(r,g,b, a * yellowAlpha)`. Persisted at
  `navaid.yellowAlpha`.
- **Magnetic variation:** hardcoded at `magVar = -5` in `core.js`
  (5°E variation for Israel). The user-facing Mag-var input was
  removed; the `navaid.magVar` localStorage key is no longer written
  or read.
- **Altitude propagation:** editing a leg's altitude updates the
  adjacent legs that currently share the old value, stopping at the
  first different leg. Inbound walks forward, outbound walks backward.
- **Reverse:** flips waypoint order, swaps each leg's
  inbound/outbound altitude, swap+negates `inLabel` / `outLabel`.
- **Waypoint-name rotation:** the `⟳` button by "Show waypoint names"
  cycles `wpNameAngle` 0/90/180/270; all names draw at that angle.
- **Plan table:** `📋 Plan` opens a modal with a per-leg flight plan
  (`#`, From, To, Hdg, Dist, Speed, Alt, Time) plus totals. From/To
  names and Speed/Alt are editable inputs; the rest is `textContent`
  only — user names / notes can't inject HTML.
- **Show Nav Waypoints** (default **on**): `nav-waypoints.json` is
  fetched once at boot; renders 173 white-fill / black-stroke 3.5 px
  dots; the 5-letter ID label appears at zoom ≥ 10. Captured in PNG
  export. Source: IAA CVFR chart page 113 (2025 edition) — see the
  Notes / pending section.
- **A3 / A4 page frame:** `pageFrameRect()` returns the rectangle in
  screen px sized so its contents are 1:250 000. Clicking the same
  size button again clears it. Orientation chosen via the
  `chooseOrientation()` modal.
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
  Current global shortcuts surfaced:
  - **Navigation:** `F` — fit route to view; `+`/`=` / numpad `+` — zoom
    map in (loupe zoom in when magnifier is on); `−`/`-` / numpad `−` —
    zoom map out (loupe zoom out when magnifier is on); `M` — toggle
    magnifying glass (skipped while any modal backdrop is open).
  - **Search:** `Ctrl/Cmd-F` — open search
  - **Editing:** `A` — toggle add-waypoint mode; `N` — toggle add-note
    mode; `C` — clear the map; `R` — reverse route direction;
    `Ctrl/Cmd-Z` — undo the last committed edit/move/delete; `Esc` —
    close modal / deselect / close magnifier; `D`/`Delete`/`Backspace` —
    delete selected waypoint or note (A/N/C skipped while any modal
    backdrop is open)
  - **Help:** `?` — open the cheat-sheet
  When you add a new global keyboard shortcut, append a row to
  `SHORTCUTS_HELP_ROWS` (and matching `shortcutXxx` keys in `core.js` +
  `he/strings.js`) so the cheat-sheet stays in sync.
- **Save PNG (`exportPNG`):** renders the framed region (or current
  view if no frame) at native tile zoom into an off-screen canvas.
  Tiles are pulled through `images.weserv.nl` to dodge the lack of
  CORS on flight-maps.com tiles. Then re-runs the canvas draws
  scaled into the export canvas and triggers a `.png` download
  named `navigation-A4.png` / `navigation-CVFR.png` etc.

## Persistence (`localStorage` + `sessionStorage`, all keyed `navaid.*`)

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
  the `⌖ Fit to screen` toolbar button (Build section) or the `F`
  keyboard shortcut (when not focused in an input).
- `navaid.layer` — selected base layer name.
- `navaid.lang` — `'en'` / `'he'`; bootstrap script in `index.html`
  reads this before the app loads.
- `navaid.toolbarPos` — `{x, y}` of the toolbar.
- `navaid.toolbarCollapsed` — `'0'` / `'1'` for the collapsed toolbar.
- `navaid.sec.<sectionId>` — `'0'` / `'1'` per accordion section
  (`build`, `view`, `display`, `charts`, `export`, `print`).
- `navaid.bearing` — map bearing in degrees (rotated-map support).
- `navaid.yellowAlpha` — Transparency slider value.
- `navaid.mapOpacity` — base-map opacity slider value.
- `navaid.wpSize` — Text-size slider value.
- `navaid.legArrowSize` — leg-arrow size slider value.
- `navaid.showReturn` — `'0'` / `'1'` for the return-leg overlay.
- `navaid.showMidLeg` — `'0'` / `'1'` for the mid-leg distance badge.
- `navaid.showDrift` — `'0'` / `'1'` for drift lines.
- `navaid.highlightDiff` — `'0'` / `'1'` for altitude-diff halos.
- `navaid.showNavWP` — `'0'` / `'1'` for the nav-waypoints overlay.
- `navaid.showAirfields` — `'0'` / `'1'` for the airfield overlay.
- `navaid.showWpNames` — `'0'` / `'1'` for waypoint-name display.
- `navaid.wpNameAngle` — waypoint-name rotation (`0`/`90`/`180`/`270`).
- `navaid.aircraft` — last-used aircraft profile JSON (fuel planner).
- `navaid.pageOrient` — `'portrait'` / `'landscape'` for page export.
- `navaid.fpPos` — `{x, y}` of the dragged Flight Plan modal.

`sessionStorage` (cleared on tab close — used to survive a language
re-load that does a full page navigation):

- `navaid.selected` — `state.selected` round-trip.
- `navaid.fpOpen` — `'1'` if the Flight Plan modal was open pre-reload.

`magVar` is hardcoded at `-5` in `core.js`; the obsolete
`navaid.magVar` key is no longer written. A one-time migration at the
top of `core.js` copies any old `plotter.*` keys into `navaid.*` and
removes the old ones.

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
  vs. deployed e2e.
- **Keep `tests/README.md` in sync** when adding tests that don't run in
  e2e-deployed, or when changing the exclusion pattern in `deploy.yml`.
- **Deploy is a workflow** at `.github/workflows/deploy.yml`. It
  triggers on push to `main` *or* `dev` (or manual dispatch),
  checks out **both** branches, and assembles one Pages site:
  - `main/docs/` → `/`
  - `dev/docs/`  → `/staging/`
  - `origin/<PR-branch>/docs/` → `/pr/NNN/` and `/branch/<BRANCH>/`
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
- **Toolbar version SHA suffix is automatic.** The same Deploy step
  also rewrites `version: '1.0'` → `version: '1.0-<short-sha>'` in
  `docs/core.js`, so the toolbar identifies the exact deployed commit.
  Do not manually increase the source version number; the regex is
  idempotent (matches both `'x.y'` and `'x.y-anything'`).
- PR preview links: when creating a PR include the direct preview URL
  in the PR body: `https://msupino.github.io/NavigationApp/pr/NNN/` or
  `https://msupino.github.io/NavigationApp/branch/BRANCH_NAME/`
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
  copyrighted.
- `nav-waypoints.json` — 173 Israeli CVFR reporting points.
  **Source:** IAA CVFR chart waypoint reference table (page 113, 2025
  edition), supplied upstream as `113_waypoints.csv`. The CSV is the
  sole source of truth — the legacy KMZ dataset
  (`CVFR WAYPOINTS 0225.kmz`) was replaced in issue #406 because it
  carried ~91 stale codes (`AREA *`, `LLHA A/B/C`, `LLMG A/B
  Maarav/Mizrah`, etc.) and had several reporting points off the
  chart by hundreds of metres (notably `BEZRA` ~752 m, `KUVSH` ~648 m,
  causing ~1° heading drift on cross-country legs). `{name, he, lat,
  lng}`: `name` = 5-letter chart code, `he` = Hebrew place name from
  CSV `Name` column. CSV rows where `Reporting == ARP` are skipped
  here — airfield ARPs live in `airfields.json` with richer data
  (runways, plates, English label). To refresh: replace the CSV with
  the latest chart edition, regenerate the JSON keeping the same
  `{waypoints: [{name, he, lat, lng}]}` shape and `name`/`he`/`lat`/
  `lng` mapping (CSV `Code` → `name`, CSV `Name` → `he`, decimal
  columns → `lat`/`lng` rounded to 5 dp), and diff for sanity. The
  exact migration is documented in the body of the PR that introduced
  it (#406).
- `geo` distances are exact great-circle; verify against the chart's
  graticule if precision is questioned.
- GA4 (`G-0XM5PHEK8B`) tracks page views; no event tracking yet.
