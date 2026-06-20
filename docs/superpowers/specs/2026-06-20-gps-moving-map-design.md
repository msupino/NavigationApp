# GPS Live Moving-Map — Design

**Date:** 2026-06-20
**Status:** Approved (design phase)
**Target branch:** `feature/gps-moving-map` off `dev`, PR → `dev` (per AGENTS.md)

## Origin

Request was "recreate the Air Navigation Pro app as a web interface." NavAid
already is a browser VFR flight planner (Leaflet + flight-maps.com aero chart
tiles). Rather than clone a proprietary app, we extend NavAid with the one core
moving-map capability it lacks: **live GPS position**. Aeronautical chart
overlay is already provided by the existing flight-maps.com base layers (CVFR /
Nav / Low Alt / Heli) — no OpenAIP, no new tile source, no API key.

## Goal

Show the user's live GPS position on the map as a rotatable aircraft marker with
an accuracy ring. North-up follow by default; optional track-up. Heading from
GPS course, with device-compass fallback when stationary. Controlled by a
toolbar button and keyboard shortcuts.

## Scope

In scope:
- Live position marker + accuracy circle.
- Follow mode (recenter on each fix), default **north-up**.
- **Track-up** toggle (rotate map so track points up, via existing
  `leaflet-rotate`).
- Heading: GPS `coords.heading` when moving; `deviceorientation` compass
  fallback when slow/stopped.
- Toolbar toggle button + keyboard shortcuts (`G` GPS on/off, `T` track-up).

Out of scope (future):
- OpenAIP / new tile sources (using existing flight-maps.com layers).
- Track recording / breadcrumb log (separate `codex/gps-track-recorder` branch).
- GPS-derived ETA-to-next-waypoint, terrain/airspace proximity alerts.

## Architecture

New focused module `docs/app/gps.js`, loaded in `index.html` after
`interact.js` and before `io.js` (needs the `map` global from `core.js` and
leaflet-rotate; UI/boot wiring stays in `ui.js`). Plain global-script style, no
modules, no build step — matches the rest of `docs/app/`.

The position marker lives as a **Leaflet layer**, not on the route
`<canvas id="overlay">`. This decouples GPS from the route redraw loop and lets
Leaflet handle smooth pan/zoom and (via leaflet-rotate) bearing.

### Components

1. **GPS controller** (`gps.js`) — owns:
   - `watchId` (from `navigator.geolocation.watchPosition`)
   - `lastFix` (latlng, accuracy, speed, gps heading, timestamp)
   - `headingDeg` (resolved heading, see below)
   - `following` (bool, default true), `trackUp` (bool, persisted)
   - `start()` / `stop()` / `onFix(pos)` / `onError(err)`
2. **Position marker** — `L.marker` with a rotatable `L.divIcon` (plane glyph,
   reuses favicon plane style) + `L.circle` accuracy ring. Marker CSS-rotated to
   `headingDeg` in north-up; in track-up the map rotates and the marker stays
   pointing up.
3. **Heading resolver** — use `coords.heading` when `coords.speed` is a number
   and above a small threshold (~2 kt / ~1 m/s). Otherwise fall back to the last
   `deviceorientation` compass reading (`webkitCompassHeading` on iOS, else
   `360 - alpha`). If neither available, keep last known heading.
4. **Follow / track-up** — on each fix, if `following`: `map.panTo(latlng)`. If
   `trackUp`: `map.setBearing(-headingDeg)` (leaflet-rotate) and marker held
   upright; else bearing 0 and marker rotated to `headingDeg`.
5. **UI (ui.js)** — toolbar toggle button (GPS on/off) with active state; a
   secondary track-up toggle. Mirrors existing toolbar-button pattern.
6. **Keyboard (io.js cheat-sheet)** — `G` toggles GPS, `T` toggles track-up.
   Both added to `SHORTCUTS_HELP_ROWS` + `S.shortcut*` strings (en + he), per
   AGENTS.md discoverability rule.

### Data flow

`watchPosition` → `onFix` → resolve heading → update marker + accuracy circle →
(if following) recenter → (if track-up) set map bearing. `deviceorientation`
listener updates the compass fallback value continuously while GPS is on.

## State & persistence

- GPS is **never auto-started** on load — no surprise permission prompt, privacy
  by default. User must toggle it on each session.
- Persist **track-up preference only**: new key `navaid.gpsTrackUp` (`'1'`/`'0'`).
  Document it in the `.ai/navaid-dev.md` Persistence section.
- Do **not** persist the "GPS on" state.
- No change to `state.waypoints` / `state.legs` / route model.

## Permissions & error handling

- **Geolocation denied / unavailable** → show existing notice/toast, revert
  button to off, clear marker.
- **iOS `deviceorientation`** requires `DeviceOrientationEvent.requestPermission()`
  from a user gesture → request it when the user toggles GPS on. If denied,
  GPS still works with course-only heading.
- **No fix yet** → button shows pending/active state; marker appears on first
  fix.
- **Insecure context** (plain `http://`, non-localhost) → geolocation is blocked
  by the browser; detect and show a clear notice. (localhost + https are fine;
  production is https.)

## i18n

New `window.S` defaults in `core.js` (sentence case) + Hebrew overrides in
`docs/i18n/he/strings.js`:
- `S.gpsStart`, `S.gpsStop` (button label/title)
- `S.gpsTrackUp` (track-up toggle)
- `S.gpsDenied` / `S.gpsUnavailable` (error notices)
- `S.shortcutGps`, `S.shortcutTrackUp` (cheat-sheet rows)

## Testing (tests/gps.spec.js)

Playwright with mocked geolocation (`context.grantPermissions(['geolocation'])`
+ `context.setGeolocation(...)`):
- Toggle GPS on → position marker + accuracy circle appear.
- New fix while following → map recenters near the fix.
- Track-up on → map bearing changes (assert `leaflet-rotate` bearing / rotated
  container) and marker stays upright.
- Toggle GPS off → marker + circle removed, watch cleared.
- Permission denied path → notice shown, button reverts to off.
- `G` / `T` shortcuts mirror the buttons; both appear in the `?` cheat-sheet.

Plus `node --check` on every changed `.js` (core.js, io.js, ui.js, gps.js,
i18n bundles).

## Files touched

- `docs/app/gps.js` — **new** controller + marker.
- `docs/index.html` — new ordered `<script>` tag with `?v=` placeholder.
- `docs/app/ui.js` — toolbar button + boot wiring + key handlers.
- `docs/app/io.js` — `SHORTCUTS_HELP_ROWS` rows.
- `docs/app/core.js` — `S.*` English defaults.
- `docs/i18n/he/strings.js` — Hebrew overrides.
- `docs/app/style.css` — marker / accuracy-ring / active-button styles.
- `tests/gps.spec.js` — **new** Playwright coverage.
- `.ai/navaid-dev.md` — document `navaid.gpsTrackUp` + GPS feature.

## Process (AGENTS.md non-negotiables)

- Open a GitHub issue first; branch from updated `dev`; PR targets `dev` as a
  draft; reference `Fixes #N`.
- Keep all `?v=` placeholders identical; `NavAid.version` stays `1.0`.
- `node --check` all changed JS; add tests for user-visible behavior.
- Verify GitHub user `msupino` before pushing; restore prior user after.
