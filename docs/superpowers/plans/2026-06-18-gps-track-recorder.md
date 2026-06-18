# GPS Track Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the flown track from the device GPS, show a live own-ship + breadcrumb, and on stop auto-save it as a timestamped saved-route entry (simplified waypoints + raw track) that the existing Drive sync carries.

**Architecture:** A new `docs/app/gps.js` module owns geolocation + recording state and the Douglas–Peucker simplifier. The live own-ship reuses the simulator's marker renderer via a small refactor (`drawSimAircraft` → `drawOwnShip(pos, hdg)`); a new `drawGpsTrack()` paints the breadcrumb. On stop, the simplified points are turned into a valid route via the canonical `serializeRoute()` (guaranteed to pass `validateRoute`) and stored in `navaid.routes`.

**Tech Stack:** Plain global-scope ES (no build), Leaflet overlay canvas, Playwright tests. Spec: `docs/superpowers/specs/2026-06-18-gps-track-recorder-design.md`.

**Test harness:** start `python3 -m http.server -d docs 8000 --bind 127.0.0.1`; run `BASE_URL=http://127.0.0.1:8000 npx playwright test <file>`. Stop the server when done.

---

## File structure

- **Create** `docs/app/gps.js` — geolocation watch, recording state, `simplifyTrack`, start/stop, `routeLibrarySaveTrack`, breadcrumb draw, own-ship source.
- **Modify** `docs/index.html` — add `app/gps.js` to the script array (before `app/ui.js`); add the View/Set toolbar control.
- **Modify** `docs/app/draw.js` — refactor `drawSimAircraft()` → `drawOwnShip(pos, hdg)`; call `drawGpsTrack()` + own-ship in `draw()`.
- **Modify** `docs/app/core.js` — English `S.*` strings.
- **Modify** `docs/app/i18n/he/strings.js` — Hebrew overrides. (path: `docs/i18n/he/strings.js`)
- **Modify** `docs/app/ui.js` — wire the toolbar button to `startGpsRecording` / `stopGpsRecordingAndSave`; live readout.
- **Create** `tests/gps-track-recorder.spec.js` — all behaviour tests.
- **Modify** `.ai/navaid-dev.md` — persistence keys + feature note.

---

## Task 1: Track simplifier + gps.js skeleton

**Files:**
- Create: `docs/app/gps.js`
- Create: `tests/gps-track-recorder.spec.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/gps-track-recorder.spec.js
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof simplifyTrack === 'function');
}

test('simplifyTrack reduces collinear points and keeps the endpoints', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const pts = [
      { lat: 32.00, lng: 34.00 }, { lat: 32.01, lng: 34.00 },
      { lat: 32.02, lng: 34.00 }, { lat: 32.03, lng: 34.00 }, // collinear N
      { lat: 32.03, lng: 34.05 },                              // sharp turn E
    ];
    const s = simplifyTrack(pts, 0.0003);
    return { n: s.length, first: s[0], last: s[s.length - 1] };
  });
  expect(out.n).toBeLessThan(5);     // collinear middle points dropped
  expect(out.n).toBeGreaterThanOrEqual(3); // turn point kept
  expect(out.first).toMatchObject({ lat: 32.00, lng: 34.00 });
  expect(out.last).toMatchObject({ lat: 32.03, lng: 34.05 });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `(python3 -m http.server -d docs 8000 --bind 127.0.0.1 >/tmp/srv.log 2>&1 &); sleep 1; BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g simplifyTrack`
Expected: FAIL — `simplifyTrack` is not defined (waitForFunction times out).

- [ ] **Step 3: Create `docs/app/gps.js` with the simplifier**

```js
// gps.js — device-GPS track recorder. Loaded after gdrive.js, before ui.js.
// Records the flown path, shows a live own-ship + breadcrumb, and on stop
// auto-saves a timestamped saved-route entry (simplified route + raw track).

var gpsRecording = false;
var gpsTrack = [];          // [{lat,lng,t,alt,acc}]
var gpsWatchId = null;
var gpsOwn = null;          // {lat,lng,hdg} last fix for own-ship rendering

const GPS_SIMPLIFY_EPS_DEG = 0.0003;   // ~30 m
const GPS_MIN_MOVE_M = 10;             // de-jitter: drop sub-10 m steps
const GPS_MAX_ACC_M = 100;             // drop low-accuracy fixes
const GPS_MAX_POINTS = 50000;

// Perpendicular distance (in degrees) of point p from segment a->b.
function _perpDeg(p, a, b) {
  const x = p.lng, y = p.lat, x1 = a.lng, y1 = a.lat, x2 = b.lng, y2 = b.lat;
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  if (L2 === 0) return Math.hypot(x - x1, y - y1);
  let t = ((x - x1) * dx + (y - y1) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

// Douglas–Peucker simplification. eps in degrees. Endpoints always kept.
function simplifyTrack(points, eps) {
  if (!Array.isArray(points) || points.length < 3) return (points || []).slice();
  let maxD = -1, idx = -1;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = _perpDeg(points[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = simplifyTrack(points.slice(0, idx + 1), eps);
    const right = simplifyTrack(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}
```

- [ ] **Step 4: Add `app/gps.js` to the script array in `docs/index.html`**

Find the script list (around line 519-526) and insert `gps.js` before `ui.js`:

```js
        'app/gdrive.js' + v,
        'app/gps.js' + v,
        'app/ui.js' + v
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g simplifyTrack`
Expected: PASS.

- [ ] **Step 6: node --check + commit**

```bash
node --check docs/app/gps.js
git add docs/app/gps.js docs/index.html tests/gps-track-recorder.spec.js
git commit -m "feat(gps): track simplifier + gps.js module skeleton"
```

---

## Task 2: Recording start/stop + position filter

**Files:**
- Modify: `docs/app/gps.js`
- Test: `tests/gps-track-recorder.spec.js`

- [ ] **Step 1: Write the failing test** (stub geolocation, feed fixes)

```js
test('recording collects filtered fixes and stops cleanly', async ({ page }) => {
  await page.addInitScript(() => {
    // Deterministic geolocation stub: capture the watch callback so the test drives it.
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 42; };
    navigator.geolocation.clearWatch = () => { window.__geoCb = null; };
  });
  await boot(page);
  await page.evaluate(() => startGpsRecording());
  const fed = await page.evaluate(() => {
    const fix = (lat, lng, acc) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: acc, heading: null, altitude: null }, timestamp: Date.now() });
    fix(32.0000, 34.0000, 8);   // kept
    fix(32.00001, 34.00001, 8); // < 10 m from prev -> dropped
    fix(32.0100, 34.0000, 8);   // kept (moved)
    fix(32.0200, 34.0000, 250); // accuracy > 100 -> dropped
    return { recording: gpsRecording, n: gpsTrack.length };
  });
  expect(fed.recording).toBe(true);
  expect(fed.n).toBe(2);
  const stopped = await page.evaluate(() => { gpsRecording = false; return typeof clearWatch === 'undefined'; });
  expect(stopped).toBe(true);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`startGpsRecording` undefined)

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g "collects filtered"`
Expected: FAIL.

- [ ] **Step 3: Add recording functions to `gps.js`**

```js
// Great-circle distance in metres between two {lat,lng}.
function _gpsMetres(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLa = rad(b.lat - a.lat), dLo = rad(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function onGpsPosition(pos) {
  if (!gpsRecording || !pos || !pos.coords) return;
  const c = pos.coords;
  if (c.accuracy != null && c.accuracy > GPS_MAX_ACC_M) return;       // too imprecise
  const pt = { lat: r5(c.latitude), lng: r5(c.longitude), t: pos.timestamp || Date.now(),
               alt: c.altitude != null ? c.altitude : null,
               acc: c.accuracy != null ? c.accuracy : null };
  const prev = gpsTrack[gpsTrack.length - 1];
  if (prev && _gpsMetres(prev, pt) < GPS_MIN_MOVE_M) return;          // de-jitter
  if (gpsTrack.length >= GPS_MAX_POINTS) return;
  gpsTrack.push(pt);
  // heading: device value when moving, else bearing from the previous point.
  let hdg = (c.heading != null && !isNaN(c.heading)) ? c.heading
            : (prev ? geo(prev, pt).brg : 0);
  gpsOwn = { lat: pt.lat, lng: pt.lng, hdg };
  try { sessionStorage.setItem('navaid.gpsTrack', JSON.stringify(gpsTrack)); } catch (e) { /* */ }
  gpsUpdateReadout();
  scheduleDraw();
  if (gpsFollow && typeof map !== 'undefined') map.setView([pt.lat, pt.lng], map.getZoom());
}

function onGpsError(err) {
  stopGpsRecording();
  alert((S.gpsError || 'GPS error: ') + (err && err.message ? err.message : ''));
}

var gpsFollow = true;  // recenter on own-ship while recording
var gpsStartT = 0;

// Live readout next to the toolbar button (points · elapsed). No-op if absent.
function gpsUpdateReadout() {
  const el = document.getElementById('gps-readout');
  if (!el) return;
  if (!gpsRecording) { el.textContent = ''; return; }
  const secs = gpsStartT ? Math.round((Date.now() - gpsStartT) / 1000) : 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  el.textContent = gpsTrack.length + ' pts · ' + mm + ':' + ss;
}

function startGpsRecording() {
  if (gpsRecording) return;
  if (!navigator.geolocation) { alert(S.gpsUnsupported || 'GPS is not available in this browser.'); return; }
  gpsRecording = true;
  gpsTrack = [];
  gpsOwn = null;
  gpsStartT = Date.now();
  gpsWatchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, { enableHighAccuracy: true });
  gpsUpdateReadout();
  scheduleDraw();
}

// Stop watching without saving. (Save handled separately.)
function stopGpsRecording() {
  if (gpsWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = null;
  gpsRecording = false;
  gpsOwn = null;
  try { sessionStorage.removeItem('navaid.gpsTrack'); } catch (e) { /* */ }
  gpsUpdateReadout();
  scheduleDraw();
}
```

Note: `geo(a,b)` returns `{ brgTrue, ... }` (existing core.js helper); `r5`, `scheduleDraw`, `S` are existing globals.

- [ ] **Step 4: Run the test — expect PASS**

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g "collects filtered"`
Expected: PASS.

- [ ] **Step 5: node --check + commit**

```bash
node --check docs/app/gps.js
git add docs/app/gps.js tests/gps-track-recorder.spec.js
git commit -m "feat(gps): start/stop recording with accuracy + min-move filter"
```

---

## Task 3: Save on stop → saved-route library entry

**Files:**
- Modify: `docs/app/gps.js`
- Test: `tests/gps-track-recorder.spec.js`

- [ ] **Step 1: Write the failing test**

```js
test('stop saves a kind:gps library entry with simplified route + raw track', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.removeItem('navaid.routes'); } catch (e) {}
  });
  await boot(page);
  await page.evaluate(() => {
    startGpsRecording();
    const fix = (lat, lng) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: 8, heading: null, altitude: 100 }, timestamp: Date.now() });
    fix(32.00, 34.00); fix(32.05, 34.00); fix(32.10, 34.02); fix(32.15, 34.10);
  });
  const entry = await page.evaluate(() => stopGpsRecordingAndSave());
  expect(entry).toBeTruthy();
  expect(entry.kind).toBe('gps');
  expect(entry.name).toMatch(/^Track /);
  expect(Array.isArray(entry.track)).toBe(true);
  expect(entry.track.length).toBeGreaterThanOrEqual(4);
  expect(entry.data.waypoints.length).toBeGreaterThanOrEqual(2);
  expect(entry.data.legs.length).toBe(entry.data.waypoints.length - 1);
  // persisted + validates as a real route
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.routes'))[0]);
  expect(persisted.id).toBe(entry.id);
  expect(await page.evaluate((d) => (typeof validateRoute === 'function' ? validateRoute(d) : null), entry.data)).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL** (`stopGpsRecordingAndSave` undefined)

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g "kind:gps"`
Expected: FAIL.

- [ ] **Step 3: Add save logic to `gps.js`**

```js
function gpsTrackName() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return 'Track ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
       + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Build a validateRoute-passing route `data` from simplified points by reusing
// the canonical serializer with a guarded temporary state swap.
function gpsRouteDataFromPoints(points) {
  const saved = { waypoints: state.waypoints, legs: state.legs, notes: state.notes };
  try {
    state.waypoints = points.map(p => ({ lat: r5(p.lat), lng: r5(p.lng), name: '' }));
    state.notes = [];
    syncLegs();
    return serializeRoute();
  } finally {
    state.waypoints = saved.waypoints; state.legs = saved.legs; state.notes = saved.notes;
    syncLegs();
  }
}

// Stop recording AND save. Returns the new library entry, or null.
function stopGpsRecordingAndSave() {
  const raw = gpsTrack.slice();
  stopGpsRecording();
  if (raw.length < 2) { alert(S.gpsNoTrack || 'No track recorded.'); return null; }
  const simp = simplifyTrack(raw.map(p => ({ lat: p.lat, lng: p.lng })), GPS_SIMPLIFY_EPS_DEG);
  const data = gpsRouteDataFromPoints(simp);
  const entry = {
    id: routeLibraryId(),
    name: gpsTrackName(),
    savedAt: new Date().toISOString(),
    kind: 'gps',
    data,
    track: raw.map(p => ({ lat: r5(p.lat), lng: r5(p.lng), t: p.t,
      ...(p.alt != null ? { alt: Math.round(p.alt) } : {}),
      ...(p.acc != null ? { acc: Math.round(p.acc) } : {}) })),
  };
  const list = loadRouteLibrary();
  list.unshift(entry);
  return persistRouteLibrary(list) ? entry : null;
}
```

Note: `state`, `syncLegs`, `serializeRoute`, `routeLibraryId`, `loadRouteLibrary`, `persistRouteLibrary` are existing globals from core.js/io.js (loaded before gps.js).

- [ ] **Step 4: Run the test — expect PASS**

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g "kind:gps"`
Expected: PASS.

- [ ] **Step 5: node --check + commit**

```bash
node --check docs/app/gps.js
git add docs/app/gps.js tests/gps-track-recorder.spec.js
git commit -m "feat(gps): auto-save flown track as a kind:gps library entry"
```

---

## Task 4: Live render — own-ship refactor + breadcrumb

**Files:**
- Modify: `docs/app/draw.js:39` (`drawSimAircraft`), `docs/app/draw.js:299-311` (`draw()`)
- Modify: `docs/app/gps.js`
- Test: `tests/gps-track-recorder.spec.js`

- [ ] **Step 1: Write the failing test**

```js
test('breadcrumb + own-ship are drawn while recording', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 1; };
    navigator.geolocation.clearWatch = () => {};
  });
  await boot(page);
  const drawn = await page.evaluate(() => {
    window.__gpsBreadcrumbDrawn = 0;
    startGpsRecording();
    const fix = (lat, lng) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: 8, heading: 90, altitude: null }, timestamp: Date.now() });
    fix(32.05, 34.80); fix(32.06, 34.81); fix(32.07, 34.82);
    draw();
    return { points: gpsTrack.length, ownHdg: gpsOwn && gpsOwn.hdg, breadcrumb: window.__gpsBreadcrumbDrawn };
  });
  expect(drawn.points).toBe(3);
  expect(drawn.ownHdg).toBe(90);
  expect(drawn.breadcrumb).toBeGreaterThan(0); // drawGpsTrack ran with >1 point
});
```

- [ ] **Step 2: Run it — expect FAIL** (`__gpsBreadcrumbDrawn` stays 0)

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g breadcrumb`
Expected: FAIL.

- [ ] **Step 3: Refactor own-ship in `draw.js`**

In `drawSimAircraft()` (line 39), change the guard + position source so the body draws an arbitrary own-ship. Replace the function header and the first two lines:

Old:
```js
function drawSimAircraft() {
  if (!simOn || !simAircraft) return;
  const s = proj(simAircraft);
  const mapBearing = (typeof map !== 'undefined' && map.getBearing) ? map.getBearing() : 0;
  const screenAngle = ((simAircraft.hdg || 0) - mapBearing) * Math.PI / 180;
```
New:
```js
// Draws an own-ship arrow at pos {lat,lng} with true heading `hdg`.
function drawOwnShip(pos, hdg) {
  if (!pos) return;
  const s = proj(pos);
  const mapBearing = (typeof map !== 'undefined' && map.getBearing) ? map.getBearing() : 0;
  const screenAngle = ((hdg || 0) - mapBearing) * Math.PI / 180;
```
(The rest of the aircraft-drawing body is unchanged — it already uses `s`, `screenAngle`, `octx`.)

- [ ] **Step 4: Add breadcrumb + own-ship dispatch in `gps.js`**

```js
// Breadcrumb of the in-progress recording, drawn on the overlay.
function drawGpsTrack() {
  if (!gpsRecording || gpsTrack.length < 1) return;
  if (gpsTrack.length > 1) {
    octx.save();
    octx.beginPath();
    for (let i = 0; i < gpsTrack.length; i++) {
      const s = proj(gpsTrack[i]);
      if (i === 0) octx.moveTo(s.x, s.y); else octx.lineTo(s.x, s.y);
    }
    octx.lineWidth = 3;
    octx.strokeStyle = '#1e88e5';
    octx.stroke();
    octx.restore();
    if (typeof window !== 'undefined') window.__gpsBreadcrumbDrawn = (window.__gpsBreadcrumbDrawn || 0) + 1;
  }
  if (gpsOwn) drawOwnShip(gpsOwn, gpsOwn.hdg);
}
```

- [ ] **Step 5: Wire into `draw()` and keep sim working** — edit `draw.js` line ~311

Old:
```js
  drawWaypoints();
  drawNotes();
  ...
  drawSimAircraft();
```
New:
```js
  drawWaypoints();
  drawNotes();
  ...
  if (typeof drawGpsTrack === 'function') drawGpsTrack();   // GPS breadcrumb + own-ship while recording
  if (!gpsRecording && simOn && simAircraft) drawOwnShip(simAircraft, simAircraft.hdg);  // sim own-ship
```
(Remove the old `drawSimAircraft();` call — `drawOwnShip` replaces it.)

- [ ] **Step 6: Run the test — expect PASS**

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g breadcrumb`
Expected: PASS.

- [ ] **Step 7: Sim regression + node --check + commit**

```bash
node --check docs/app/draw.js && node --check docs/app/gps.js
BASE_URL=http://127.0.0.1:8000 npx playwright test tests/   # ensure sim/draw suites stay green
git add docs/app/draw.js docs/app/gps.js tests/gps-track-recorder.spec.js
git commit -m "feat(gps): live breadcrumb + shared own-ship renderer (sim + GPS)"
```

---

## Task 5: Toolbar control + i18n + ui.js wiring

**Files:**
- Modify: `docs/index.html` (View/Set section), `docs/app/core.js` (strings), `docs/i18n/he/strings.js`, `docs/app/ui.js` (wiring)
- Test: `tests/gps-track-recorder.spec.js`

- [ ] **Step 1: Write the failing test**

```js
test('toolbar GPS button toggles recording and updates its label', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 5; };
    navigator.geolocation.clearWatch = () => {};
  });
  await boot(page);
  const btn = page.locator('#gps-record');
  await expect(btn).toHaveCount(1);
  await btn.click();
  expect(await page.evaluate(() => gpsRecording)).toBe(true);
  await expect(btn).toContainText('Stop');
  await page.evaluate(() => { const f=(a,b)=>window.__geoCb({coords:{latitude:a,longitude:b,accuracy:8,heading:null,altitude:null},timestamp:Date.now()}); f(32.0,34.0); f(32.1,34.0); });
  await btn.click();
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`#gps-record` not found)

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g "toolbar GPS"`
Expected: FAIL.

- [ ] **Step 3: Add the button to the View/Set section in `docs/index.html`**

Locate the View/Set section (the one containing the existing overlay toggles such as `#commchange-cb`). Add, after the last control in that section:

```html
        <button id="gps-record" data-i18n="tbGpsRecord" data-i18n-title="tbGpsRecordTitle"></button>
        <span id="gps-readout" class="gps-readout"></span>
```

(The `gpsUpdateReadout()` defined in Task 2 fills `#gps-readout` with `N pts · MM:SS` while recording and clears it on stop — no extra wiring needed beyond the span existing.)

- [ ] **Step 4: Add English strings in `docs/app/core.js`** (inside the `window.S = { … }` defaults)

```js
  tbGpsRecord: '📍 Record GPS track',
  tbGpsRecordTitle: 'Record your flown track from the device GPS and save it',
  tbGpsStop: '■ Stop & save',
  gpsUnsupported: 'GPS is not available in this browser.',
  gpsNoTrack: 'No track recorded.',
  gpsError: 'GPS error: ',
```

- [ ] **Step 5: Add Hebrew overrides in `docs/i18n/he/strings.js`**

```js
  tbGpsRecord: '📍 הקלטת מסלול GPS',
  tbGpsRecordTitle: 'הקלטת המסלול בפועל מ-GPS המכשיר ושמירתו',
  tbGpsStop: '■ עצור ושמור',
  gpsUnsupported: 'GPS אינו זמין בדפדפן זה.',
  gpsNoTrack: 'לא הוקלט מסלול.',
  gpsError: 'שגיאת GPS: ',
```

- [ ] **Step 6: Wire the button in `docs/app/ui.js`** (near other toolbar button wiring, e.g. where `#plan` / `#charts` are bound)

```js
  const gpsBtn = document.getElementById('gps-record');
  if (gpsBtn) {
    if (!navigator.geolocation) { gpsBtn.disabled = true; }
    gpsBtn.addEventListener('click', () => {
      if (gpsRecording) {
        stopGpsRecordingAndSave();
        gpsBtn.textContent = S.tbGpsRecord;
        if (typeof window.refreshRouteLibrary === 'function') window.refreshRouteLibrary();
      } else {
        startGpsRecording();
        if (gpsRecording) gpsBtn.textContent = S.tbGpsStop;
      }
    });
  }
```

- [ ] **Step 7: Run the test + spell lint — expect PASS**

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/gps-track-recorder.spec.js -g "toolbar GPS"`
Then: `npm run lint:spell`
Expected: test PASS; spell lint clean (add proper-noun exceptions only if needed).

- [ ] **Step 8: node --check + commit**

```bash
node --check docs/app/ui.js docs/app/core.js docs/i18n/he/strings.js
git add docs/index.html docs/app/core.js docs/i18n/he/strings.js docs/app/ui.js tests/gps-track-recorder.spec.js
git commit -m "feat(gps): View/Set record toggle, i18n strings, ui wiring"
```

---

## Task 6: Docs + full regression

**Files:**
- Modify: `.ai/navaid-dev.md`
- Test: full suite

- [ ] **Step 1: Document the new keys/feature in `.ai/navaid-dev.md`**

Add to the Persistence section:
```
- `navaid.gpsTrack` (sessionStorage) — best-effort in-progress GPS recording
  checkpoint; cleared on save/discard.
```
Add to the route-library note: saved-route entries may carry `kind: 'gps'` + a
raw `track[]` (recorded GPS breadcrumb); loading applies the simplified route.
Add a Features bullet describing the GPS track recorder (📍 Record GPS track in
the View/Set section; auto-saves a timestamped library entry; Drive-synced).

- [ ] **Step 2: Run the full suite**

Run: `BASE_URL=http://127.0.0.1:8000 npx playwright test tests/`
Expected: all green (gps-track-recorder + no regressions in sim/draw/route-library/bidi).

- [ ] **Step 3: Stop the server + commit**

```bash
pkill -f "http.server -d docs 8000" 2>/dev/null
git add .ai/navaid-dev.md
git commit -m "docs(gps): document GPS track recorder + navaid.gpsTrack key"
```

---

## Notes for the implementer
- No build step — scripts share one global scope; load order matters (`gps.js` after `gdrive.js`, before `ui.js`).
- Keep `?v=` placeholders in `index.html` consistent; deploy rewrites them.
- HTTPS is required for `geolocation` in real browsers (Pages ✓, `localhost` ✓). Tests stub `watchPosition`, so no real permission prompt.
- Background suspension on phones is a known limitation (no wake-lock in v1) — do not add one.
