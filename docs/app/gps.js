// gps.js — device-GPS track recorder. Loaded after gdrive.js, before ui.js.
// Records the flown path, shows a live own-ship + breadcrumb, and on stop
// auto-saves a timestamped saved-route entry (simplified route + raw track).

var gpsRecording = false;
var gpsTrack = [];          // [{lat,lng,t,alt,acc}]
var gpsWatchId = null;
var gpsOwn = null;          // {lat,lng,hdg} last fix for own-ship rendering
var gpsWakeLock = null;     // Screen Wake Lock sentinel held while recording

// Keep the screen awake while recording so the phone doesn't sleep mid-track.
// Wake Lock is auto-released by the browser when the tab is hidden; we re-acquire
// on visibilitychange (see listener at end of file). Best-effort: silently
// no-op where unsupported (older Safari) or denied by policy.
function gpsAcquireWakeLock() {
  if (gpsWakeLock || !gpsRecording) return;
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
  navigator.wakeLock.request('screen').then(function (wl) {
    if (!gpsRecording) { wl.release().catch(function () {}); return; }
    gpsWakeLock = wl;
    wl.addEventListener('release', function () { gpsWakeLock = null; });
  }).catch(function () { /* denied / no user gesture — ignore */ });
}

function gpsReleaseWakeLock() {
  if (!gpsWakeLock) return;
  var wl = gpsWakeLock; gpsWakeLock = null;
  wl.release().catch(function () {});
}

const GPS_SIMPLIFY_EPS_DEG = 0.0003;   // ~30 m
const GPS_MIN_MOVE_M = 10;             // de-jitter: drop sub-10 m steps
const GPS_MAX_ACC_M = 100;             // drop low-accuracy fixes
// A fix older than this is no longer "where you are". Nothing here timed a fix at all: a
// watch that stops delivering -- WebView backgrounded, indoor dropout, a native watcher that
// stalls -- left the own-ship symbol and the heading predictor frozen at the last known
// position, drawn exactly as if they were live, while the aircraft flew on. Neither
// watchPosition nor the native watcher raises an error in that case, so nothing else would
// ever notice.
const GPS_STALE_MS = 20000;           // grey the symbol and say how old the fix is
const GPS_STALE_TICK_MS = 2000;       // ...and notice it without waiting for a new fix
const GPS_MAX_POINTS = 50000;

// Douglas–Peucker simplification. eps in degrees. Endpoints always kept.
// Iterative (explicit-stack) implementation — overflow-safe for up to GPS_MAX_POINTS.
function simplifyTrack(points, eps) {
  if (!Array.isArray(points) || points.length < 3) return (points || []).slice();
  const n = points.length;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const eps2 = eps * eps;
  // Flat lo/hi stack (no per-split tuple allocation). Squared perpendicular
  // distances in the inner loop — no sqrt/hypot per point (it ran O(n²) times
  // and dominated the worst-case zigzag). d > eps ⇔ d² > eps², so the kept set
  // is identical to the hypot version.
  const stack = [0, n - 1];
  while (stack.length) {
    const hi = stack.pop(), lo = stack.pop();
    if (hi - lo < 2) continue;
    const x1 = points[lo].lng, y1 = points[lo].lat;
    const dx = points[hi].lng - x1, dy = points[hi].lat - y1;
    const L2 = dx * dx + dy * dy;
    let maxD2 = -1, idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const px = points[i].lng - x1, py = points[i].lat - y1;
      let d2;
      if (L2 === 0) {
        d2 = px * px + py * py;
      } else {
        let t = (px * dx + py * dy) / L2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const ex = px - t * dx, ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > maxD2) { maxD2 = d2; idx = i; }
    }
    if (maxD2 > eps2) { keep[idx] = 1; stack.push(lo, idx, idx, hi); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// Great-circle distance in metres between two {lat,lng}.
function _gpsMetres(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLa = rad(b.lat - a.lat), dLo = rad(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

// --- native (Capacitor APK) background watch ----------------------------
// In the APK, navigator.geolocation stops when the phone locks. The Capacitor
// background-geolocation plugin runs an Android foreground service (persistent
// notification), so fixes keep flowing with the screen off. Web/PWA builds
// don't have the plugin and fall back to plain watchPosition — unchanged.
function _bgGeo() {
  const C = typeof window !== 'undefined' && window.Capacitor;
  return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() &&
          C.Plugins && C.Plugins.BackgroundGeolocation) || null;
}
// Start a position watch. Returns an opaque handle for gpsStopWatch().
// onPos always receives a GeolocationPosition-shaped fix ({coords, timestamp}).
function gpsStartWatch(onPos, onErr, title, message) {
  const bg = _bgGeo();
  if (!bg) {
    // `timeout` matters as much as accuracy: without it a watch that never delivers again
    // simply goes quiet, and onErr is never called.
    return { web: navigator.geolocation.watchPosition(onPos, onErr,
      { enableHighAccuracy: true, timeout: GPS_STALE_MS, maximumAge: 0 }) };
  }
  const h = { native: null, stopped: false };
  // addWatcher is typed Promise<string>, but on some runtimes (Capacitor 8
  // Android bridge accessed via Capacitor.Plugins) it returns the watcher id
  // SYNCHRONOUSLY — a plain string with no .then (the reported
  // "bg.addWatcher(...).then is not a function"). Promise.resolve() normalises
  // both a Promise and a bare id so registration never throws.
  const watcher = bg.addWatcher({
    backgroundTitle: title,
    backgroundMessage: message,
    requestPermissions: true,
    stale: false,
    distanceFilter: 0,
  }, function (loc, err) {
    if (err) { onErr(err); return; }
    if (!loc) return;
    onPos({
      coords: {
        latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
        altitude: loc.altitude, speed: loc.speed, heading: loc.bearing,
      },
      timestamp: loc.time || Date.now(),
    });
  });
  Promise.resolve(watcher).then(function (id) {
    // A stop that raced the async registration must still kill the watcher,
    // or the foreground service (and its notification) would leak.
    if (h.stopped) bg.removeWatcher({ id }).catch(function () {});
    else h.native = id;
  }).catch(function (e) {
    // This IS a registration failure -- addWatcher's own promise rejected, so
    // h.native never gets set and no watcher was ever created. Unlike the
    // synchronous-throw case, this one usually carries no `.code` either, and
    // without the tag it read exactly like a codeless MID-watch error (the
    // iOS CLError case) and was let through as "transient, keep going" even
    // though the watch had, in fact, never started.
    if (e && typeof e === 'object') e._gpsRegistrationFailure = true;
    onErr(e);
  });
  return h;
}
function gpsStopWatch(h) {
  if (!h) return;
  h.stopped = true;
  if (h.native != null) {
    const bg = _bgGeo();
    if (bg) bg.removeWatcher({ id: h.native }).catch(function () {});
    h.native = null;
  } else if (h.web != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(h.web);
  }
}

var gpsLiveOn = false;
var gpsLiveWatchId = null;
var _gpsLivePrev = null;

function onLivePosition(pos) {
  if (!gpsLiveOn || !pos || !pos.coords) return;
  if (gpsRecording) return;   // recording drives own-ship + recenter; avoid dueling
  const c = pos.coords;
  if (c.accuracy != null && c.accuracy > GPS_MAX_ACC_M) return;
  const p = { lat: r5(c.latitude), lng: r5(c.longitude) };
  const t = pos.timestamp || Date.now();
  const hdg = (c.heading != null && !isNaN(c.heading)) ? c.heading
            : (_gpsLivePrev ? geo(_gpsLivePrev, p).brg : 0);
  const isFirst = (_gpsLivePrev === null);
  const prev = _gpsLivePrev;
  // Groundspeed/altitude, same derivation onGpsPosition uses below: the live readout
  // stays position-only outside a recording (gpsUpdateReadout), but gpsCheckLegAlerts()
  // needs both regardless of which live mode is running.
  let gsMs = (c.speed != null && !isNaN(c.speed) && c.speed >= 0) ? c.speed : null;
  if (gsMs == null && prev && prev.t) {
    const dt = (t - prev.t) / 1000;
    if (dt > 0) gsMs = _gpsMetres(prev, p) / dt;
  }
  gpsLastGS = gsMs != null ? gsMs * 1.94384 : null;             // m/s → kt
  gpsLastAlt = c.altitude != null ? c.altitude * 3.28084 : null; // m → ft
  _gpsLivePrev = { lat: p.lat, lng: p.lng, t };
  // Carry the fix time so everything downstream can tell live from frozen.
  gpsOwn = { lat: p.lat, lng: p.lng, hdg, t };
  gpsNoteFixArrived();
  gpsCheckLegAlerts();
  scheduleDraw();
  if (typeof map !== 'undefined') {
    if (isFirst) map.setView([p.lat, p.lng], map.getZoom());
    else if (gpsFollow) map.setView([p.lat, p.lng], map.getZoom());
  }
}

// Is the current own-ship fix stale? Age is measured from the fix's own timestamp, not from
// when we happened to receive it.
function gpsFixAgeMs() {
  if (!gpsOwn || !Number.isFinite(gpsOwn.t)) return null;
  return Math.max(0, Date.now() - gpsOwn.t);
}
function gpsFixStale() {
  const age = gpsFixAgeMs();
  return age != null && age > GPS_STALE_MS;
}
// No fix means no callback, so staleness cannot be noticed by the fix handler. This ticks
// while a live watch (or a recording) is on, and redraws once when the fix crosses from fresh
// to stale so the symbol and the readout change without waiting for data that is not coming.
var _gpsStaleTimer = null;
var _gpsWasStale = false;
function gpsNoteFixArrived() {
  if (_gpsWasStale) { _gpsWasStale = false; }
  if (_gpsStaleTimer) return;
  _gpsStaleTimer = setInterval(() => {
    if (!gpsLiveOn && !gpsRecording) { gpsStopStaleWatchdog(); return; }
    const stale = gpsFixStale();
    if (stale !== _gpsWasStale) {
      _gpsWasStale = stale;
      scheduleDraw();
      if (typeof gpsUpdateReadout === 'function') gpsUpdateReadout();
    }
  }, GPS_STALE_TICK_MS);
}
function gpsStopStaleWatchdog() {
  if (_gpsStaleTimer) { clearInterval(_gpsStaleTimer); _gpsStaleTimer = null; }
  _gpsWasStale = false;
}

function startLiveLocation() {
  if (gpsLiveOn) return;
  if (!navigator.geolocation && !_bgGeo()) { alert(S.gpsUnsupported || 'GPS is not available in this browser.'); return; }
  gpsLiveOn = true; _gpsLivePrev = null;
  gpsResetLegAlerts();
  gpsRequestNotifyPermission();
  gpsMaybeStartDriftTimer();
  // TEMPORARY, test-only nudge -- remove once the watch-alert feature is validated. Lets a
  // pilot testing "Show location" alone (no route) confirm notifications are actually
  // reaching the device/watch, and points them at loading a route for the real alerts.
  if (!state.waypoints || state.waypoints.length < 2) {
    gpsSendWatchAlert((S && S.watchAlertNoRouteTestTitle) || 'NavAid',
      (S && S.watchAlertNoRouteTestBody) ||
      'Load a route to get alerts if you drift off course or altitude.');
  }
  if (typeof resetHeadingPredictor === 'function') resetHeadingPredictor();
  try {
    gpsLiveWatchId = gpsStartWatch(onLivePosition, onGpsLiveError,
      S.gpsLiveNotifTitle || 'NavAid location', S.gpsLiveNotifText || 'Showing your position on the map');
  } catch (e) {
    // Same registration-failure handling as startGpsRecording: without this,
    // gpsLiveOn was already set true above, so a synchronous registration throw
    // (native plugin API mismatch) left the app believing live location was on
    // with no watch running and no error shown.
    if (e && typeof e === 'object') e._gpsRegistrationFailure = true;
    onGpsLiveError(e);
    return;
  }
  scheduleDraw();
}

function stopLiveLocation() {
  gpsStopWatch(gpsLiveWatchId);
  gpsLiveWatchId = null;
  gpsLiveOn = false;
  _gpsLivePrev = null;
  if (!gpsRecording) gpsStopStaleWatchdog();
  if (!gpsRecording) gpsOwn = null;   // keep own-ship if a recording is still running
  gpsMaybeStopDriftTimer();
  scheduleDraw();
}

var gpsFollow = true;  // recenter on own-ship while recording
var gpsStartT = 0;
var gpsLastGS = null;   // current ground speed (kt), null if unknown
var gpsLastAlt = null;  // current GPS altitude (ft), null if unknown

// Live readout next to the toolbar button: points · elapsed · ground speed ·
// altitude (the last two only when the fix provides them). No-op if absent.
function gpsUpdateReadout() {
  const el = document.getElementById('gps-readout');
  if (!el) return;
  // A stale fix is worth saying even when nothing is being recorded: the map still shows an
  // own-ship symbol, and the pilot has no other way to tell it is frozen.
  if (!gpsRecording) {
    const age = gpsFixStale() ? gpsFixAgeMs() : null;
    el.textContent = age == null ? ''
      : ((S && S.gpsFixStale) || 'GPS fix') + ' ' + Math.round(age / 1000) + 's';
    return;
  }
  const secs = gpsStartT ? Math.round((Date.now() - gpsStartT) / 1000) : 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  let s = gpsTrack.length + ' pts · ' + mm + ':' + ss;
  if (gpsLastGS != null) s += ' · ' + Math.round(gpsLastGS) + ' kt';
  if (gpsLastAlt != null) s += ' · ' + Math.round(gpsLastAlt) + ' ft';
  if (gpsFixStale()) {
    s += ' · ' + ((S && S.gpsFixStale) || 'GPS fix') + ' ' +
      Math.round(gpsFixAgeMs() / 1000) + 's';
  }
  el.textContent = s;
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
  // At the cap, stop growing the track but keep the live display (own-ship,
  // GS/alt, readout, recenter) updating instead of freezing.
  if (gpsTrack.length < GPS_MAX_POINTS) gpsTrack.push(pt);
  // Ground speed: device value (m/s) when present, else derived from the last
  // fix; altitude in feet. Both feed the live readout.
  let gsMs = (c.speed != null && !isNaN(c.speed) && c.speed >= 0) ? c.speed : null;
  if (gsMs == null && prev) {
    const dt = (pt.t - prev.t) / 1000;
    if (dt > 0) gsMs = _gpsMetres(prev, pt) / dt;
  }
  gpsLastGS = gsMs != null ? gsMs * 1.94384 : null;            // m/s → kt
  gpsLastAlt = c.altitude != null ? c.altitude * 3.28084 : null;  // m → ft
  // heading: device value when moving, else bearing from the previous point.
  let hdg = (c.heading != null && !isNaN(c.heading)) ? c.heading
            : (prev ? geo(prev, pt).brg : 0);
  // Same fix time as the live path: a stalled RECORDING freezes the same symbol.
  gpsOwn = { lat: pt.lat, lng: pt.lng, hdg, t: pt.t };
  gpsNoteFixArrived();
  gpsUpdateReadout();
  gpsCheckLegAlerts();
  scheduleDraw();
  if (gpsFollow && typeof map !== 'undefined') map.setView([pt.lat, pt.lng], map.getZoom());
}

// Reset a footer GPS button's (hidden) label + icon without wiping its icon
// span — mirrors setFooterBtn() in ui.js.
function resetGpsFooterBtn(id, label, icon) {
  const b = document.getElementById(id);
  if (!b) return;
  const t = b.querySelector('.footer-link-text');
  if (t) t.textContent = label; else b.textContent = label;
  const ic = b.querySelector('.footer-link-icon');
  if (ic) ic.textContent = icon;
  b.setAttribute('aria-pressed', 'false');
}
function gpsErrMsg(err) {
  return (S.gpsError || 'GPS error: ') + (err && err.message ? err.message : '');
}
// Per-watch error handlers: an error on one mode must not tear down the other
// (a transient live-watch error used to also kill — and discard — an active
// recording).
//
// Only a PERMISSION error tears a watch down. The web watch is registered with
// timeout: GPS_STALE_MS, so watchPosition reports TIMEOUT (code 3) after any
// 20-second fix gap — phone in the flight bag, brief dropout — and keeps
// watching afterwards. Tearing down there discarded a whole flight's recording
// over one quiet spell; the stale-fix indicator already shows the gap.
function gpsErrFatal(err) {
  const c = err && err.code;
  // A registration throw (native plugin API mismatch) is tagged by its catch block
  // below -- that watch never started, so it must tear down regardless of shape.
  if (err && err._gpsRegistrationFailure) return true;
  // Everything else with no code is a MID-WATCH async error, not a registration
  // failure: iOS's background-geolocation plugin forwards any CLError it doesn't
  // recognize (e.g. .network -- a transient GPS hiccup, the same kind of blip
  // Android reports as a TIMEOUT code) via `call.reject(message, nil, error)`,
  // which arrives here with no `code` at all. Treating that as fatal reintroduced
  // the "one quiet spell discards the flight" bug on iOS specifically.
  if (c === undefined || c === null) return false;
  return c === 1 || c === 'NOT_AUTHORIZED';   // web PERMISSION_DENIED / native plugin
}
function onGpsRecError(err) {
  if (!gpsRecording) return;
  if (!gpsErrFatal(err)) return;              // transient: the watch keeps trying
  stopGpsRecording();
  resetGpsFooterBtn('gps-record', S.tbGpsRecord, '⏺');
  alert(gpsErrMsg(err));
}
function onGpsLiveError(err) {
  if (!gpsLiveOn) return;
  if (!gpsErrFatal(err)) return;
  stopLiveLocation();
  resetGpsFooterBtn('gps-live', S.tbGpsLive, '📍');
  alert(gpsErrMsg(err));
}

// Toggle the top-right REC indicator (a pulsing red dot) AND the Record
// button's label/icon to match gpsRecording — both driven from here so they
// can never disagree. The button label used to be flipped by the click
// handler AFTER startGpsRecording() returned; if a later start step threw
// (e.g. the native background-geolocation watch on the APK), the dot came on
// but the label stayed "Start recording" — the reported "stuck on Start
// recording with the red indicator flashing" bug. Setting it here keeps
// start / stop / error paths consistent.
function updateGpsRecIndicator() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('gps-rec-indicator');
  if (el) el.hidden = !gpsRecording;
  const btn = document.getElementById('gps-record');
  if (btn) {
    const t = btn.querySelector('.footer-link-text');
    const label = gpsRecording ? (S.tbGpsStop || 'Stop recording')
                               : (S.tbGpsRecord || 'Start recording');
    if (t) t.textContent = label; else btn.textContent = label;
    const ic = btn.querySelector('.footer-link-icon');
    if (ic) ic.textContent = gpsRecording ? '⏹' : '⏺';
    btn.setAttribute('aria-pressed', gpsRecording ? 'true' : 'false');
  }
}

function startGpsRecording() {
  if (gpsRecording) return;
  if (!navigator.geolocation && !_bgGeo()) { alert(S.gpsUnsupported || 'GPS is not available in this browser.'); return; }
  gpsRecording = true;
  updateGpsRecIndicator();
  gpsTrack = [];
  if (!gpsLiveOn) gpsOwn = null;
  gpsStartT = Date.now();
  gpsResetLegAlerts();
  gpsRequestNotifyPermission();
  gpsMaybeStartDriftTimer();
  try {
    gpsWatchId = gpsStartWatch(onGpsPosition, onGpsRecError,
      S.gpsRecNotifTitle || 'NavAid GPS recording', S.gpsRecNotifText || 'Recording your track — tap to return');
  } catch (e) {
    // A synchronous failure registering the watch (e.g. a native plugin API
    // mismatch on the APK) must roll the recording back — stop, reset the
    // button + dot, and surface the error — not leave a phantom "recording".
    // Tagged so gpsErrFatal can tell this apart from a codeless MID-watch error
    // (a running watch reporting an unrecognized native error) -- only this one,
    // where the watch never started at all, is unconditionally fatal.
    if (e && typeof e === 'object') e._gpsRegistrationFailure = true;
    onGpsRecError(e);
    return;
  }
  gpsAcquireWakeLock();
  gpsUpdateReadout();
  scheduleDraw();
}

function gpsTrackName() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return 'Record - ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
       + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Stop recording AND save. Returns the new library entry, or null.
// A recording is stored as a TRACK (a line), not a waypoint route: it keeps a
// Douglas–Peucker-simplified fix list (endpoints + shape preserved) so a long
// flight doesn't bloat localStorage / the Drive payload. On the map it's an
// overlay drawn on top of whatever route (if any) is loaded — see the
// saved-track overlay section below.
function stopGpsRecordingAndSave() {
  const raw = gpsTrack.slice();
  stopGpsRecording();
  if (raw.length < 2) { alert(S.gpsNoTrack || 'No track recorded.'); return null; }
  const simplified = simplifyTrack(raw, GPS_SIMPLIFY_EPS_DEG);   // keeps the flown line's shape, drops redundant fixes
  const entry = {
    id: routeLibraryId(),
    name: gpsTrackName(),
    savedAt: new Date().toISOString(),
    kind: 'gps',
    track: simplified.map(p => ({ lat: r5(p.lat), lng: r5(p.lng), t: p.t,
      ...(p.alt != null ? { alt: Math.round(p.alt) } : {}),
      ...(p.acc != null ? { acc: Math.round(p.acc) } : {}) })),
  };
  const list = loadRouteLibrary();
  list.unshift(entry);
  if (!persistRouteLibrary(list)) return null;
  showTrackOverlay(entry);            // surface the flown line immediately
  return entry;
}

// --- saved-track overlays --------------------------------------------------
// A recorded GPS track is shown as a coloured polyline overlay, independent of
// the waypoint route. One track is shown at a time (showing another replaces
// it); the shown id is persisted so the overlay survives a reload.
var shownTracks = [];                 // [{ id, name, points:[{lat,lng,alt,t}], color }]
// Palette for recorded GPS tracks. Driven by the gistable `gpsTrackColors` knob
// (comma-separated); the literal list is only the fallback before tune() exists.
const TRACK_COLORS_FALLBACK = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080', '#9a6324', '#000075'];  // FALLBACK only
function trackColors() {
  const raw = (typeof tune === 'function') ? tune('gpsTrackColors') : '';
  const list = String(raw || '').split(',').map(c => c.trim()).filter(Boolean);
  return list.length ? list : TRACK_COLORS_FALLBACK;
}
const SHOWN_TRACKS_KEY = 'navaid.tracks.shown';
var _shownTracksBooted = false;

// A freshly-shown track is zoomed-to and glows for TRACK_HIGHLIGHT_MS so the
// user can spot the flown line before it settles into a plain overlay.
const TRACK_HIGHLIGHT_MS = 10000;
var _trackHighlightId = null;
var _trackHighlightUntil = 0;
var _trackHighlightTimer = null;

// Points to draw for an entry. New entries carry `track`; old ones only had a
// synthetic waypoint route (entry.data) — render those waypoints as the line.
function trackPointsFromEntry(entry) {
  if (entry && Array.isArray(entry.track) && entry.track.length) {
    return entry.track.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }
  if (entry && entry.data && Array.isArray(entry.data.waypoints)) {
    return entry.data.waypoints
      .filter(w => w && Number.isFinite(w.lat) && Number.isFinite(w.lng))
      .map(w => ({ lat: w.lat, lng: w.lng }));
  }
  return [];
}
function isTrackShown(id) { return shownTracks.some(t => t.id === id); }
function _nextTrackColor() {
  const used = new Set(shownTracks.map(t => t.color));
  const pal = trackColors();
  return pal.find(c => !used.has(c)) || pal[shownTracks.length % pal.length];
}
function _addTrackOverlay(entry) {
  if (!entry || isTrackShown(entry.id)) return false;
  const points = trackPointsFromEntry(entry);
  if (points.length < 2) return false;
  shownTracks.push({ id: entry.id, name: entry.name || '', points, color: _nextTrackColor() });
  return true;
}
function showTrackOverlay(entry) {
  if (!entry) return;
  // Only one recorded track is shown at a time — showing one hides the rest.
  // But don't wipe the current overlay if the new entry has nothing to draw
  // (<2 finite points): a degenerate/legacy track must not blank the map.
  if (!isTrackShown(entry.id)) {
    const prev = shownTracks;
    shownTracks = [];
    if (!_addTrackOverlay(entry)) { shownTracks = prev; return; }
    persistShownTrackIds();
  }
  // Always re-zoom + glow the target (also when it was already the shown one).
  highlightTrack(entry.id);
}
// Zoom the map to a shown track and glow it for TRACK_HIGHLIGHT_MS, then revert.
function highlightTrack(id) {
  const t = shownTracks.find(x => x.id === id);
  if (!t) { scheduleDraw(); return; }
  const ll = t.points
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map(p => [p.lat, p.lng]);
  if (typeof map !== 'undefined' && ll.length) {
    if (ll.length === 1) {
      map.setView(ll[0], Math.max(map.getZoom(), tune('fitTrackPointZoom')), { animate: true });
    } else {
      map.fitBounds(L.latLngBounds(ll),
        fitOpts('fitTrackPaddingPx', 'fitTrackMaxZoom', { animate: true }));
    }
  }
  _trackHighlightId = id;
  _trackHighlightUntil = Date.now() + TRACK_HIGHLIGHT_MS;
  clearTimeout(_trackHighlightTimer);
  _trackHighlightTimer = setTimeout(() => {
    _trackHighlightId = null;
    _trackHighlightUntil = 0;
    if (typeof scheduleDraw === 'function') scheduleDraw();
  }, TRACK_HIGHLIGHT_MS);
  scheduleDraw();
}
function hideTrackOverlay(id) {
  const before = shownTracks.length;
  shownTracks = shownTracks.filter(t => t.id !== id);
  if (shownTracks.length !== before) {
    // Cancel a pending highlight for the track being hidden so its timer can't
    // fire a stale redraw and _trackHighlightId can't dangle past the overlay.
    if (_trackHighlightId === id) {
      _trackHighlightId = null; _trackHighlightUntil = 0; clearTimeout(_trackHighlightTimer);
    }
    persistShownTrackIds(); scheduleDraw();
  }
}
function toggleTrackOverlay(entry) {
  if (!entry) return false;
  if (isTrackShown(entry.id)) { hideTrackOverlay(entry.id); return false; }
  showTrackOverlay(entry);
  return isTrackShown(entry.id);
}
function persistShownTrackIds() {
  try { localStorage.setItem(SHOWN_TRACKS_KEY, JSON.stringify(shownTracks.map(t => t.id))); } catch (e) { /* */ }
}
function loadShownTrackOverlays() {
  _shownTracksBooted = true;
  let ids = [];
  try { ids = JSON.parse(localStorage.getItem(SHOWN_TRACKS_KEY) || '[]'); } catch (e) { /* */ }
  if (!Array.isArray(ids) || !ids.length) return;
  const lib = (typeof loadRouteLibrary === 'function') ? loadRouteLibrary() : [];
  shownTracks = [];
  // Single track at a time: restore just the first still-existing id.
  for (const id of ids) { const e = lib.find(x => x.id === id); if (e && _addTrackOverlay(e)) break; }
  // Heal the stored key when it drifted from what we restored (an old multi-id
  // list, or ids whose entries were since deleted), so it matches reality.
  if (ids.length !== shownTracks.length) persistShownTrackIds();
  if (shownTracks.length) scheduleDraw();
}

// Total great-circle length of a track (NM) — for library row meta.
function trackDistanceNm(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += _gpsMetres(points[i - 1], points[i]);
  return m / 1852;
}

// Draw all shown track overlays as coloured polylines with start/end dots.
function drawTracks() {
  if (!_shownTracksBooted) loadShownTrackOverlays();
  if (!Array.isArray(shownTracks) || !shownTracks.length) return;
  octx.save();
  octx.lineCap = 'round'; octx.lineJoin = 'round';
  const highlightOn = _trackHighlightId && Date.now() < _trackHighlightUntil;
  for (const t of shownTracks) {
    const pts = t.points.map(proj);
    if (pts.length < 2) continue;
    octx.beginPath();
    octx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
    if (highlightOn && t.id === _trackHighlightId) {   // glow halo under the line
      octx.save();
      // Wide soft amber outer glow + a tighter brighter ring so the freshly
      // shown track pops on both the light and dark base maps for 10s.
      octx.lineWidth = tune('gpsBreadcrumbWidthPx') + 16;
      octx.strokeStyle = 'rgba(255, 209, 0, 0.35)';
      octx.stroke();
      octx.lineWidth = tune('gpsBreadcrumbWidthPx') + 7;
      octx.strokeStyle = 'rgba(255, 209, 0, 0.85)';
      octx.stroke();
      octx.restore();
    }
    octx.lineWidth = tune('gpsBreadcrumbWidthPx');
    octx.strokeStyle = t.color;
    octx.stroke();
    const dot = (p, c) => {
      octx.beginPath(); octx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
      octx.fillStyle = c; octx.fill();
      octx.lineWidth = 1.5; octx.strokeStyle = tune('gpsTrackOutlineColor'); octx.stroke();
    };
    dot(pts[0], tune('gpsTrackStartColor'));       // start
    dot(pts[pts.length - 1], tune('gpsTrackEndColor'));  // end
  }
  octx.restore();
  if (typeof window !== 'undefined') window.__tracksDrawn = shownTracks.length;
}

// Export a saved track as GPX (<trk>), the natural format for a flown path.
function gpsTrackToGpx(entry) {
  const pts = trackPointsFromEntry(entry);
  const esc = s => String(s).replace(/[<&>]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const seg = pts.map(p =>
    '      <trkpt lat="' + p.lat + '" lon="' + p.lng + '">' +
    (p.alt != null ? '<ele>' + p.alt + '</ele>' : '') +  // p.alt is already metres (Geolocation altitude); GPX <ele> is metres
    (p.t ? '<time>' + new Date(p.t).toISOString() + '</time>' : '') +
    '</trkpt>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="NavAid">\n' +
    '  <trk>\n    <name>' + esc(entry.name || 'GPS track') + '</name>\n    <trkseg>\n' +
    seg + '\n    </trkseg>\n  </trk>\n</gpx>\n';
}
function downloadGpsTrackGpx(entry) {
  const blob = new Blob([gpsTrackToGpx(entry)], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (entry.name || 'track').replace(/[^\w\-]+/g, '_') + '.gpx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);   // revoking synchronously after click can abort the download (Firefox/Safari)
}
function downloadGpsTrackJson(entry) {
  // A single-entry LIBRARY array, not a bare entry: that is the shape load()
  // recognises, so an exported track can be imported back. A lone object went
  // through the single-route validator and failed with "root.waypoints: missing".
  const blob = new Blob([JSON.stringify([entry], null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (entry.name || 'track').replace(/[^\w\-]+/g, '_') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Breadcrumb of the in-progress recording, drawn on the overlay.
function drawGpsTrack() {
  if (!gpsRecording && !gpsLiveOn) return;
  if (gpsRecording && gpsTrack.length > 1) {
    octx.save(); octx.beginPath();
    for (let i = 0; i < gpsTrack.length; i++) { const s = proj(gpsTrack[i]); if (i === 0) octx.moveTo(s.x, s.y); else octx.lineTo(s.x, s.y); }
    octx.lineWidth = tune('gpsBreadcrumbWidthPx'); octx.strokeStyle = tune('gpsBreadcrumbColor');
    octx.lineCap = 'round'; octx.lineJoin = 'round'; octx.stroke(); octx.restore();
    if (typeof window !== 'undefined') window.__gpsBreadcrumbDrawn = (window.__gpsBreadcrumbDrawn || 0) + 1;
  }
  if (gpsOwn && (gpsRecording || gpsLiveOn)) drawOwnShip(gpsOwn, gpsOwn.hdg);
}

// Stop watching without saving. (Save handled in a later task.)
function stopGpsRecording() {
  gpsStopWatch(gpsWatchId);
  gpsWatchId = null;
  gpsRecording = false;
  updateGpsRecIndicator();
  gpsReleaseWakeLock();
  gpsLastGS = null; gpsLastAlt = null;
  if (!gpsLiveOn) gpsOwn = null;
  gpsMaybeStopDriftTimer();
  gpsUpdateReadout();
  scheduleDraw();
}

// The browser drops the wake lock whenever the tab is backgrounded; re-arm it
// when the page becomes visible again and a recording is still in progress.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && gpsRecording) gpsAcquireWakeLock();
  });
}

// --- watch alerts: leg approach + altitude off plan -----------------------
// "Prepare for next leg" / "altitude off plan" as local device notifications. A paired
// Garmin watch (or any other) picks these up the same way it picks up SMS/WhatsApp --
// Garmin Connect mirrors ordinary OS notifications ("Smart Notifications"), so no
// Garmin-specific integration is needed, just a real notification to mirror. Runs
// automatically whenever a live fix is flowing -- from onGpsPosition (recording),
// onLivePosition (live-only), and io.js's connected-simulator poll (_simFetch) -- via
// gpsCheckLegAlerts(); no separate on/off setting. The simulator path doubles as a way to
// test (or just use) these alerts without a phone or a real flight.
var GPS_LEG_ETA_S = 120;          // fire this many seconds before the next waypoint
var GPS_LEG_CAPTURE_NM = 0.3;     // ...or this close, whichever comes first
var GPS_ALT_TOLERANCE_FT = 100;
var gpsAlertLegIndex = 0;         // forward-only pointer into state.legs/state.waypoints
var _gpsAlertMinDistNm = Infinity;
var _gpsAlertLegFired = false;    // leg-approach alert already sent for gpsAlertLegIndex
var _gpsAlertAltDeviated = false; // currently inside an altitude-deviation episode

// Called whenever tracking (re)starts, so a pointer left over from a previous flight or
// route can't silently suppress real alerts on this one. Plain reset to leg 0 -- correct
// when there is no fix yet (nothing to snap to) or the route is being drawn fresh.
function gpsResetLegAlerts() {
  gpsAlertLegIndex = 0;
  _gpsAlertMinDistNm = Infinity;
  _gpsAlertLegFired = false;
  _gpsAlertAltDeviated = false;
}
// Along-track / cross-track projection of p onto great-circle segment a->b, in nm.
// alongNm is distance from a toward b (negative = short of a, > leg length = past b);
// crossNm is signed perpendicular distance off the line. Null if a and b coincide.
function _gpsTrackProjection(a, b, p) {
  const ab = geo(a, b);
  if (!Number.isFinite(ab.dist) || ab.dist <= 0) return null;
  const ap = geo(a, p);
  if (!Number.isFinite(ap.dist)) return null;
  const R = 3440.065;   // earth radius, nm
  if (ap.dist <= 0) return { alongNm: 0, crossNm: 0 };
  const d13 = ap.dist / R;
  const brg13 = ap.brg * Math.PI / 180, brg12 = ab.brg * Math.PI / 180;
  const crossRad = Math.asin(Math.sin(d13) * Math.sin(brg13 - brg12));
  const alongRad = Math.acos(Math.min(1, Math.cos(d13) / Math.cos(crossRad)));
  return { alongNm: alongRad * R, crossNm: crossRad * R };
}
// A route can be loaded WHILE already tracking, and not necessarily from its own start --
// a pilot picking a plan mid-flight is already somewhere along it. gpsResetLegAlerts()
// alone would leave the pointer at leg 0 no matter where that is: gpsCheckLegAlerts only
// advances ONE leg per call, so a single immediate check afterward would not catch up over
// several legs. A "nearest endpoint" heuristic is not enough here: right next to a shared
// waypoint, the leg ending there and the leg starting there look equally close, and picking
// wrong there is exactly the common case (loading a route near where you already are, i.e.
// near one of its waypoints). Projects onto each leg's actual track instead, and picks the
// leg the position falls WITHIN (along-track distance between 0 and the leg's length,
// smallest cross-track error breaking a tie); falls back to nearest single leg by endpoint
// distance only if the position doesn't project onto any leg at all (e.g. off the route
// entirely).
function gpsSnapLegAlertsToPosition() {
  gpsResetLegAlerts();
  if (!gpsOwn || typeof state === 'undefined' || typeof geo !== 'function') return;
  const wps = state.waypoints || [];
  const legs = state.legs || [];
  const n = Math.min(legs.length, wps.length - 1);
  let onTrack = -1, onTrackCross = Infinity;
  let nearest = 0, nearestD = Infinity;
  for (let i = 0; i < n; i++) {
    const a = wps[i], b = wps[i + 1];
    if (!a || !b) continue;
    const legLen = geo(a, b).dist;
    const proj = _gpsTrackProjection(a, b, gpsOwn);
    if (proj && proj.alongNm >= 0 && proj.alongNm <= legLen) {
      const absCross = Math.abs(proj.crossNm);
      if (absCross < onTrackCross) { onTrackCross = absCross; onTrack = i; }
    }
    const d = Math.min(geo(gpsOwn, a).dist, geo(gpsOwn, b).dist);
    if (d < nearestD) { nearestD = d; nearest = i; }
  }
  gpsAlertLegIndex = onTrack >= 0 ? onTrack : nearest;
}

function gpsCheckLegAlerts() {
  if (!gpsOwn || typeof state === 'undefined' || typeof geo !== 'function') return;
  const wps = state.waypoints || [];
  const legs = state.legs || [];
  if (gpsAlertLegIndex >= legs.length || gpsAlertLegIndex + 1 >= wps.length) return;
  const next = wps[gpsAlertLegIndex + 1];
  if (!next) return;
  const { dist } = geo(gpsOwn, next);
  if (!Number.isFinite(dist)) return;

  if (!_gpsAlertLegFired && gpsLastGS > 0) {
    const etaS = (dist / gpsLastGS) * 3600;
    if (etaS <= GPS_LEG_ETA_S) {
      _gpsAlertLegFired = true;
      const label = (typeof waypointDisplayLabel === 'function')
        ? waypointDisplayLabel(next, gpsAlertLegIndex + 1) : (next.name || '');
      gpsSendWatchAlert((S && S.watchAlertLegTitle) || 'NavAid',
        (S && S.watchAlertLegBody) ? S.watchAlertLegBody(label) : ('Approaching ' + label));
    }
  }

  // Altitude vs. the CURRENT leg's planned altitude -- same field routeProfile() treats
  // as the leg's planned altitude. One-shot per deviation episode: fires once on the way
  // out past tolerance, clears once back inside it, so a second real drift fires again.
  const planned = legs[gpsAlertLegIndex].inboundAltitude;
  if (Number.isFinite(planned) && gpsLastAlt != null) {
    const off = Math.abs(gpsLastAlt - planned);
    if (off >= GPS_ALT_TOLERANCE_FT) {
      if (!_gpsAlertAltDeviated) {
        _gpsAlertAltDeviated = true;
        gpsSendWatchAlert((S && S.watchAlertAltTitle) || 'NavAid',
          (S && S.watchAlertAltBody)
            ? S.watchAlertAltBody(Math.round(gpsLastAlt), Math.round(planned))
            : (Math.round(gpsLastAlt) + ' ft, planned ' + Math.round(planned) + ' ft'));
      }
    } else {
      _gpsAlertAltDeviated = false;
    }
  }

  // Advance the leg pointer: within the capture radius of the next waypoint, or the
  // distance to it has started growing again after shrinking (passed abeam it).
  if (dist < _gpsAlertMinDistNm) _gpsAlertMinDistNm = dist;
  if (dist <= GPS_LEG_CAPTURE_NM || dist > _gpsAlertMinDistNm + GPS_LEG_CAPTURE_NM) {
    gpsAlertLegIndex++;
    _gpsAlertMinDistNm = Infinity;
    _gpsAlertLegFired = false;
    _gpsAlertAltDeviated = false;
  }
}

// Native (APK) local-notifications plugin, mirroring _bgGeo()'s access pattern -- the
// injected Capacitor bridge exposes any synced plugin at window.Capacitor.Plugins.*.
function _nativeNotify() {
  const C = typeof window !== 'undefined' && window.Capacitor;
  return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() &&
          C.Plugins && C.Plugins.LocalNotifications) || null;
}
var _watchNotifyPermAsked = false;
// Ask once per tracking session, not once per alert -- a denial should not re-prompt on
// every fix. Best-effort: a silent no-op on an unsupported/denied context is the correct
// behaviour here, not an error the pilot needs to see.
function gpsRequestNotifyPermission() {
  if (_watchNotifyPermAsked) return;
  _watchNotifyPermAsked = true;
  const nn = _nativeNotify();
  if (nn) { nn.requestPermissions().catch(function () {}); return; }
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(function () {});
  }
}
var _watchAlertId = 1;
function gpsSendWatchAlert(title, body) {
  const nn = _nativeNotify();
  if (nn) {
    nn.schedule({ notifications: [{ id: _watchAlertId++, title: title, body: body,
      schedule: { at: new Date(Date.now() + 100) } }] }).catch(function () {});
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try { new Notification(title, { body: body }); } catch (e) { /* unsupported context */ }
}

// --- watch alert: drifted off the leg's course line -----------------------
// Checked on its own 2-minute timer, not per-fix like the leg/altitude alerts above --
// this is a "how are we doing" periodic check, not a one-shot event, and re-fires every
// interval as long as the drift persists (no one-shot suppression here; 2 minutes is
// already the pacing).
var GPS_DRIFT_CHECK_MS = 120000;
var GPS_DRIFT_TRACK_ERROR_DEG = 10;   // fire once track-angle error reaches this
var _gpsDriftTimer = null;

function gpsMaybeStartDriftTimer() {
  if (_gpsDriftTimer) return;
  _gpsDriftTimer = setInterval(gpsCheckDrift, GPS_DRIFT_CHECK_MS);
}
// Only actually stops once NONE of the three position sources (recording, live-only,
// connected simulator) are still running -- called from all three teardown paths, each of
// which may fire while another is still active (e.g. stopping a recording with live
// location still on).
function gpsMaybeStopDriftTimer() {
  if (gpsRecording || gpsLiveOn || (typeof simOn !== 'undefined' && simOn)) return;
  if (_gpsDriftTimer) { clearInterval(_gpsDriftTimer); _gpsDriftTimer = null; }
}

// Signed angular difference a-b, wrapped to (-180, 180].
function _gpsAngleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function gpsCheckDrift() {
  if (!gpsOwn || typeof state === 'undefined' || typeof geo !== 'function') return;
  const wps = state.waypoints || [];
  if (gpsAlertLegIndex + 1 >= wps.length) return;
  const start = wps[gpsAlertLegIndex], end = wps[gpsAlertLegIndex + 1];
  if (!start || !end) return;
  const leg = geo(start, end);
  if (!Number.isFinite(leg.dist) || leg.dist <= 0) return;
  const flown = geo(start, gpsOwn);
  if (!Number.isFinite(flown.dist)) return;
  // Track-angle error: how far the bearing FROM the leg's start TO here has diverged from
  // the planned course -- not a full cross-track projection, just the angle a pilot would
  // read off a compass/HSI against the planned course.
  const trackErrorDeg = _gpsAngleDiff(flown.brg, leg.brg);
  if (Math.abs(trackErrorDeg) < GPS_DRIFT_TRACK_ERROR_DEG) return;
  const label = (typeof waypointDisplayLabel === 'function')
    ? waypointDisplayLabel(end, gpsAlertLegIndex + 1) : (end.name || '');
  if (flown.dist < leg.dist / 2) {
    // Before the leg's midpoint: worth rejoining the original line. Classic "double the
    // error" intercept -- fly the correction back at twice the angle you drifted out at.
    const driftOut = Math.round(Math.abs(trackErrorDeg));
    const driftIn = driftOut * 2;
    gpsSendWatchAlert((S && S.watchAlertDriftTitle) || 'NavAid — off course',
      (S && S.watchAlertDriftBody) ? S.watchAlertDriftBody(driftOut, driftIn)
        : (driftOut + '° off course, ' + driftIn + '° to intercept'));
  } else {
    // Past the midpoint: rejoining the original line buys nothing this close to the
    // waypoint -- report the correction to head direct to it instead.
    const direct = geo(gpsOwn, end);
    const correction = Math.round(Math.abs(_gpsAngleDiff(direct.brg, leg.brg)));
    gpsSendWatchAlert((S && S.watchAlertDriftTitle) || 'NavAid — off course',
      (S && S.watchAlertDriftDirectBody) ? S.watchAlertDriftDirectBody(correction, label)
        : (correction + '° to ' + label));
  }
}
