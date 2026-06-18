# GPS Track Recorder — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorm)
**Related:** issue #676 (Moving-map live tracking / GPS own-ship)

## Goal

Record where the pilot actually flies using the device GPS, show it live on the
map, and on stop auto-save the flown track as a saved-route library entry
(which the existing Google Drive sync then carries).

## Decisions (locked)

- **Source:** browser `navigator.geolocation` (device GPS). HTTPS only (GitHub
  Pages ✓, `localhost` ✓ for dev).
- **Live display:** a live own-ship marker plus a growing breadcrumb trail.
- **On Stop:** auto-save a timestamped entry to the saved-route library
  (`navaid.routes`); existing Drive sync picks it up. No separate export step.
- **Stored form:** a **simplified waypoint route** (editable like any NavAid
  route) **plus** the **raw breadcrumb** for fidelity.
- **Approach A:** a dedicated `gps.js` module owns geolocation + recording
  state; the live own-ship reuses the simulator's marker renderer via a small
  refactor. (Rejected B: feeding device GPS into the simulator pipeline —
  couples real GPS to "simulator" semantics.)

### Confirmed defaults
- Record toggle lives in the toolbar **View/Set** section.
- **Follow on** while recording (map recenters on own-ship).
- Track simplification epsilon **≈ 30 m** (≈ 0.0003°).

## Architecture

### 1. Module & load
New `docs/app/gps.js`, inserted in the `index.html` script array **before**
`app/ui.js` (so `ui.js` can wire the toolbar control to it). It uses globals
from earlier modules (`state`, `draw`/`scheduleDraw`, `proj`, route-library
helpers in `io.js`).

Globals it owns:
- `gpsRecording` (bool)
- `gpsTrack` — array of `{lat, lng, t, alt, acc}` (coords 5 dp, `t` = ms epoch)
- `gpsWatchId` — `watchPosition` handle
- `gpsOwn` — last fix `{lat, lng, hdg?}` for own-ship rendering

Public functions: `startGpsRecording()`, `stopGpsRecordingAndSave()`,
`onGpsPosition(pos)` (internal), `gpsOwnShip()` (getter for the renderer).

### 2. Recording mechanics
`navigator.geolocation.watchPosition(onGpsPosition, onGpsError,
{ enableHighAccuracy: true })`. Each fix:
- **Filter:** drop if `accuracy` > ~100 m, or if moved < ~10 m from the last
  kept point (de-jitter / de-dupe).
- **Append** `{lat, lng, t, alt, acc}` (lat/lng rounded 5 dp).
- Safety cap ~50 000 points.
- Update `gpsOwn`, then `scheduleDraw()`; if follow is on, recenter the map.
- **Checkpoint:** mirror the in-progress track to `sessionStorage`
  (`navaid.gpsTrack`) so an accidental reload mid-recording can resume
  (best-effort).
- **Errors:** permission denied / position error → stop recording, surface a
  notice, save nothing.

### 3. Live display (own-ship + breadcrumb)
- Refactor `drawSimAircraft()` (draw.js) into a shared `drawOwnShip(pos, hdg)`.
  The active own-ship = the GPS fix while recording, else the simulator
  aircraft. Sim behaviour is unchanged when not recording.
- **Heading** uses `position.coords.heading` when present (only reported while
  moving on most devices); otherwise it falls back to the great-circle bearing
  from the previous kept point, and to 0 (north) for the very first fix.
- New `drawGpsTrack()` draws the breadcrumb polyline from `gpsTrack` on the
  overlay canvas, gated on `gpsRecording`.
- Both are invoked from the existing `draw()` pipeline; each fix triggers
  `scheduleDraw()`.

### 4. Save on Stop
- **Simplify** `gpsTrack` lat/lng with Douglas–Peucker (ε ≈ 30 m) →
  `waypoints` (blank/sequential names; leg altitudes left at defaults —
  GPS altitude is kept only in the raw track, not as CVFR leg altitudes).
- Build a library entry via a new `routeLibrarySaveTrack()` mirroring
  `routeLibrarySaveCurrent()` (io.js):
  ```
  { id, name: "Track 2026-06-18 14:30", savedAt, kind: 'gps',
    data: <serialized simplified route>, track: [ {lat,lng,t,alt,acc} … ] }
  ```
  `unshift` into `navaid.routes`; existing persistence + Drive sync handle the
  rest.
- **No points captured** → discard, inform the user (nothing saved).
- **Loading** the entry applies the simplified route (existing
  `routeLibraryApply`); the raw `track` is retained for fidelity / future
  use. Existing route entries (no `kind`/`track`) are unaffected.

### 5. UI
- A toolbar toggle in **View/Set**: `📍 Record GPS track`. While recording it
  flips to `■ Stop & save` with a small live readout (duration · points ·
  distance).
- i18n: English defaults in `core.js`, Hebrew overrides in
  `i18n/he/strings.js`.
- If `navigator.geolocation` is unavailable, the control is hidden/disabled.
- No new global keyboard shortcut in v1.

### 6. Error handling / limits
- HTTPS required (Pages ✓).
- **Background suspension:** phones suspend page JS when the screen sleeps or
  the tab is backgrounded, so the breadcrumb will have gaps. Documented
  limitation; no wake-lock in v1.
- **Drive payload:** the raw track grows `navaid-routes.json`. Mitigate with
  5 dp coords and minimal per-point fields; accepted for v1.

### 7. Persistence keys
- `navaid.routes` — existing route library; entries gain optional `kind` +
  `track` fields (back-compatible).
- `navaid.gpsTrack` (`sessionStorage`) — best-effort in-progress checkpoint;
  cleared on save/discard.

## Testing
- Playwright stubs `navigator.geolocation.watchPosition` (via `addInitScript`)
  to emit a scripted sequence of fixes:
  - start → feed fixes → assert own-ship + breadcrumb are drawn (expose
    `window.__gpsTrack` for inspection);
  - stop → assert a `navaid.routes` entry was added with `kind: 'gps'`,
    simplified `data.waypoints`, and a raw `track[]`.
- Unit-test the Douglas–Peucker simplify helper (point reduction + endpoint
  preservation).
- Filter test: low-accuracy / sub-10 m points are dropped.
- Run on both mobile and desktop viewports.

## Non-goals (v1, YAGNI)
- Background/locked-screen recording, wake-lock.
- GPX-of-track export (a saved route already exports via the existing route
  GPX path).
- Full moving-map polish from #676 (turn indicators, heading-up, etc.).
- Editing the raw track; it is read-only fidelity data.
