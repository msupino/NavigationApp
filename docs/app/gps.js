// gps.js — device-GPS track recorder. Loaded after gdrive.js, before ui.js.
// Records the flown path, shows a live own-ship + breadcrumb, and on stop
// auto-saves a timestamped saved-route entry (simplified route + raw track).

var gpsRecording = false;
var gpsTrack = [];          // [{lat,lng,t,alt,acc}]
var gpsWatchId = null;
var gpsOwn = null;          // {lat,lng,hdg} last fix for own-ship rendering
var gpsWakeLock = null;     // Screen Wake Lock sentinel held while recording

// True while any own-ship position source is live: real GPS (recording or just showing
// location) or a connected simulator. interact.js's waypoint-drag handlers check this to
// freeze the route plan mid-flight -- moving a waypoint out from under an in-progress leg
// is exactly the edge case that can spuriously fire/miss the leg-approach and TOP alerts
// (see gpsCheckLegAlerts's own _gpsAlertMinDistNm comment). A plain click/tap still opens
// the inspector as normal (see the callers: this only gates the MOVE, not the selection) --
// wanting to see a waypoint's satellite image mid-flight is unaffected.
function gpsMapLocked() {
  return !!(gpsRecording || gpsLiveOn || (typeof simOn !== 'undefined' && simOn));
}

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
  // NaN, not 0, when neither the device nor a previous fix can supply a heading --
  // 0 is a real compass value (due north) and Number.isFinite(0) is true, so a
  // literal 0 here reads downstream as "confirmed heading: north" rather than
  // "unknown," locking the own-ship icon AND the predictor line onto true north
  // for as long as the device fails to report a course (stationary/taxiing GPS
  // routinely omits it -- reported live as "the broken line in front of the
  // plane is showing true north"). NaN correctly fails Number.isFinite() and
  // lets drawHeadingLine's/drawOwnShip's own frozen-last-heading fallback run.
  const hdg = (c.heading != null && !isNaN(c.heading)) ? c.heading
            : (_gpsLivePrev ? geo(_gpsLivePrev, p).brg : NaN);
  const isFirst = (_gpsLivePrev === null);
  const prev = _gpsLivePrev;
  // Groundspeed/altitude, same derivation onGpsPosition uses below -- gpsCheckLegAlerts()
  // needs both regardless of which live mode is running, and so does the footer readout
  // (gpsUpdateReadout, below -- used to stay position-only outside a recording, showing
  // nothing here; reported live: "show alt like gps mode shows alt in sim mode").
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
  if (typeof gpsUpdateReadout === 'function') gpsUpdateReadout();
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
  // Snap to wherever gpsOwn's last known position actually falls on the route, not a
  // blind reset to leg 0 -- this runs on every start, including the auto-resume-after-
  // reload path (below), where the aircraft's real position never went anywhere. A
  // blind reset here compared the live fix against a stale, wrong leg's planned
  // altitude the instant a resumed session's first fix arrived -- reported live: "it
  // said 1500 planned 800, planned is 1500" (aircraft genuinely on a later leg,
  // pointer forced back to an early one). gpsSnapLegAlertsToPosition() itself falls
  // back to plain gpsResetLegAlerts() when there is no prior gpsOwn to project (a
  // genuinely fresh start), so this is never worse than the old behaviour, only
  // better when a real prior position exists.
  if (typeof gpsSnapLegAlertsToPosition === 'function') gpsSnapLegAlertsToPosition();
  else gpsResetLegAlerts();
  gpsMaybeStartDriftTimer();
  // TEMPORARY, test-only nudge -- remove once the watch-alert feature is validated. Lets a
  // pilot testing "Show location" alone (no route) confirm notifications are actually
  // reaching the device/watch, and points them at loading a route for the real alerts.
  // Waits for the permission answer first: firing right after the (async) request used to
  // read the still-'default' permission and silently drop, exactly on a first-ever grant.
  gpsRequestNotifyPermission().then(function () {
    if (!state.waypoints || state.waypoints.length < 2) {
      gpsSendWatchAlert((S && S.watchAlertNoRouteTestTitle) || 'NavAid',
        (S && S.watchAlertNoRouteTestBody) ||
        'Load a route to get alerts if you drift off course or altitude.');
    }
  });
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
  // Persisted so a full page reload (language switch's location.href, or any other) can
  // resume it -- see the auto-reconnect block beside the #gps-live button in ui.js. Only
  // written once the watch actually registered; onGpsLiveError's stopLiveLocation() below
  // clears it again on a registration failure.
  try { localStorage.setItem('navaid.gpsLiveOn', '1'); } catch (e) { /* */ }
  scheduleDraw();
}

function stopLiveLocation() {
  try { localStorage.setItem('navaid.gpsLiveOn', '0'); } catch (e) { /* */ }
  gpsStopWatch(gpsLiveWatchId);
  gpsLiveWatchId = null;
  gpsLiveOn = false;
  _gpsLivePrev = null;
  if (!gpsRecording) gpsStopStaleWatchdog();
  if (!gpsRecording) gpsOwn = null;   // keep own-ship if a recording is still running
  gpsMaybeStopDriftTimer();
  // Otherwise the last live speed/altitude reading sat in the readout forever -- same
  // refresh stopGpsRecording() already does on its own stop.
  if (!gpsRecording && typeof gpsUpdateReadout === 'function') gpsUpdateReadout();
  scheduleDraw();
}

var gpsFollow = true;  // recenter on own-ship while recording
var gpsStartT = 0;
var gpsLastGS = null;   // current ground speed (kt), null if unknown
var gpsLastAlt = null;  // current GPS altitude (ft), null if unknown

// Live readout next to the toolbar button: points · elapsed · ground speed ·
// altitude (the last two only when the fix provides them). No-op if absent.
// The readout is measurements -- "18 kt · 390 ft" -- which must read left to right even
// in the RTL UI, where the bidi algorithm otherwise reorders the sequence and showed
// "kt · 390 ft 18". The stale-fix notice cannot simply come along for the ride: its
// Hebrew ("קליטת GPS מלפני") is two Hebrew words either side of a Latin one, and an LTR
// base reverses how they read. So the measurements are written into an LTR-isolated
// element and the notice carries dir="auto", taking its own base from its own text.
function gpsSetReadout(el, parts, staleText) {
  el.textContent = '';
  const measured = parts.join(' · ');
  if (measured) el.appendChild(document.createTextNode(measured));
  if (!staleText) return;
  if (measured) el.appendChild(document.createTextNode(' · '));
  const span = document.createElement('span');
  span.dir = 'auto';
  span.textContent = staleText;
  el.appendChild(span);
}
function gpsStaleText() {
  return gpsFixStale()
    ? ((S && S.gpsFixStale) || 'GPS fix') + ' ' + Math.round(gpsFixAgeMs() / 1000) + 's'
    : '';
}
// The comm change (if any) attached to a waypoint. Reads the ROUTE'S OWN note rather than
// the static dataset: the note is what the pilot sees on the map and what the frequency
// pipeline may have overridden or suppressed for this particular route, so speaking
// anything else would be reading out a different frequency from the one drawn.
function gpsCommChangeAt(wp) {
  if (!wp || typeof state === 'undefined' || !Array.isArray(state.notes)) return null;
  const name = wp.name || '';
  if (!name) return null;
  const note = state.notes.find(n => n && n.cc && n.cc === name);
  if (!note) return null;
  if (!note.freqName && !note.freq) return null;
  return { freqName: note.freqName || '', freq: note.freq || '' };
}
// "118.4" -> "one one eight decimal four". Digit by digit, like a heading and for the same
// reason: a frequency misheard as a number is a frequency tuned wrong.
function gpsSpokenFreq(freq, lang) {
  const str = String(freq || '').trim();
  if (!str) return '';
  const dec = (typeof S !== 'undefined' && S.spokenDecimal) || 'decimal';
  return str.split('.')
    .map(part => gpsSpokenDigits(part, lang))
    .filter(Boolean)
    .join(' ' + dec + ' ');
}
// Magnetic heading for the readout, or null when the fix carries none (a stationary GPS
// reports no course at all). gpsOwn.hdg is TRUE in both paths -- the geolocation API is
// true-referenced, and the simulator bridge's magnetic value is converted to true in
// _simFetch -- so this is the one place it turns back into what a pilot reads off the DI.
function gpsReadoutHeading() {
  if (!gpsOwn || !Number.isFinite(gpsOwn.hdg)) return null;
  const mag = (typeof toMagnetic === 'function') ? toMagnetic(gpsOwn.hdg) : gpsOwn.hdg;
  if (!Number.isFinite(mag)) return null;
  const r = ((Math.round(mag) % 360) + 360) % 360;
  return ((typeof pad3 === 'function') ? pad3(r) : String(r)) + '\u00b0';
}
function gpsUpdateReadout() {
  const el = document.getElementById('gps-readout');
  if (!el) return;
  // The compact desktop toolbar normally hides this text to save space. A live
  // GPS or simulator source is the exception: in a full-width/full-screen map,
  // heading, altitude and speed are cockpit information, not footer decoration.
  const liveActive = gpsRecording || gpsLiveOn ||
    (typeof simOn !== 'undefined' && simOn);
  el.classList.toggle('live-active', !!liveActive);
  if (gpsRecording) {
    const secs = gpsStartT ? Math.round((Date.now() - gpsStartT) / 1000) : 0;
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const parts = [gpsTrack.length + ' pts · ' + mm + ':' + ss];
    if (gpsLastGS != null) parts.push(Math.round(gpsLastGS) + ' kt');
    if (gpsLastAlt != null) parts.push(Math.round(gpsLastAlt) + ' ft');
    const hdgRec = gpsReadoutHeading();
    if (hdgRec) parts.push(hdgRec);
    gpsSetReadout(el, parts, gpsStaleText());
    return;
  }
  // Not recording, but still a live position source (plain "show location", or a
  // connected simulator -- see the gpsUpdateReadout() call in io.js's _simFetch) --
  // same speed/altitude fields as a recording, just without the point-count/elapsed
  // -time prefix that only means something while actually building a track. Used to
  // show nothing at all outside a recording; reported live: "show alt like gps mode
  // shows alt in sim mode".
  if (liveActive) {
    const parts = [];
    if (gpsLastGS != null) parts.push(Math.round(gpsLastGS) + ' kt');
    if (gpsLastAlt != null) parts.push(Math.round(gpsLastAlt) + ' ft');
    // Same three fields whether the position comes from the device GPS or a connected
    // simulator -- both land in gpsOwn, and this branch already serves both.
    const hdgLive = gpsReadoutHeading();
    if (hdgLive) parts.push(hdgLive);
    gpsSetReadout(el, parts, gpsStaleText());
    return;
  }
  // Nothing active: a stale leftover fix is still worth saying (the map may still show
  // a frozen own-ship symbol with no other way to tell it stopped updating).
  gpsSetReadout(el, [], gpsStaleText());
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
  // NaN (not 0 -- see onLivePosition's identical fallback for why) when neither
  // is available.
  let hdg = (c.heading != null && !isNaN(c.heading)) ? c.heading
            : (prev ? geo(prev, pt).brg : NaN);
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
  if (gpsOwn && (gpsRecording || gpsLiveOn)) drawOwnShip(gpsOwn, gpsOwn.hdg, gpsLastGS);
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
// Whether gpsAlertLegIndex has ever been verified against a REAL waypoint, not just
// inferred from geometry. gpsSnapLegAlertsToPosition() picks a leg from an along-track
// projection alone -- a reasonable best guess on the very first fix (start mid-route,
// resume a session, a page reload), but still a guess: an imprecise or early fix could
// project onto the wrong leg, and every alert type (ETA, altitude, drift) reads
// gpsAlertLegIndex as ground truth. All three stay silent until a fix has actually
// landed within capture radius of a real waypoint -- true confirmation, not an
// inference -- same "don't alert on a guess" rule requested live after the false
// "planned 800 ft" alarm this fix's own snap change could otherwise still produce on
// an unlucky first fix. Only the CAPTURE-RADIUS branch of the TOP block below counts;
// the "passed abeam, never got close" branch advances the pointer (still needed to
// keep tracking) but does not confirm it.
var _gpsAlertConfirmed = false;

// Called whenever tracking (re)starts, so a pointer left over from a previous flight or
// route can't silently suppress real alerts on this one. Plain reset to leg 0 -- correct
// when there is no fix yet (nothing to snap to) or the route is being drawn fresh.
function gpsResetLegAlerts() {
  gpsAlertLegIndex = 0;
  _gpsAlertMinDistNm = Infinity;
  _gpsAlertLegFired = false;
  _gpsAlertAltDeviated = false;
  _gpsAlertConfirmed = false;
  _gpsLastTopAt = 0;
  // Cone/off-route state belongs to the same episode: a fresh session must not inherit a
  // half-elapsed unknown timer or a stale recovery heading from the last one.
  _gpsConeOutsideSince = null;
  _gpsConeAlertedHdg = null;
  _gpsConeAlertedAt = 0;
  gpsRouteUnknown = false;
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

// --- cone-based leg tracking (2026-08-13-cone-leg-tracking-design.md) --------------
// Which leg is the aircraft on? The old answer was a forward-only pointer over an
// UNBOUNDED perpendicular corridor, so every position belonged to some leg and the app
// could never say "I do not know where you are relative to this route" -- it always
// answered, even when the answer was meaningless, and the altitude and off-course alerts
// were then measured against a leg the aircraft was nowhere near.
//
// A leg is now the OVERLAP of a 90-degree cone from each of its ends: +/-45 degrees from A
// toward B, and +/-45 degrees from B back toward A. The region is a diamond -- a point at
// each waypoint, widest (half the leg length) at the midpoint. Since tan(45) = 1, the test
// reduces to a comparison with no trigonometry:
//
//     0 <= along <= legLen   and   |cross| <= min(along, legLen - along)
//
// A single cone anchored at A was rejected: it widens without bound, so near B a position a
// whole leg-length off to the side still reads as "on the leg", and the unknown state would
// almost never trigger on a long leg -- defeating the point.
var GPS_CONE_UNKNOWN_MS = 15000;      // continuously outside every cone before we say so
var GPS_CONE_SECTOR_DEG = 45;         // recovery target preferred within this of the nose
var GPS_CONE_REPEAT_DEG = 15;         // re-speak once the recovery heading moves this far
var GPS_CONE_REPEAT_MS = 60000;       // ...and never more often than this
var _gpsConeOutsideSince = null;      // when we first fell outside every cone, or null
var _gpsConeAlertedHdg = null;        // heading given by the last recovery call
var _gpsConeAlertedAt = 0;            // when that call was made
var gpsRouteUnknown = false;          // true while outside every cone (after the debounce)

function _gpsLegConeContains(a, b, p) {
  const ab = geo(a, b);
  if (!Number.isFinite(ab.dist) || ab.dist <= 0) return false;
  const ap = geo(a, p);
  const bp = geo(b, p);
  if (!Number.isFinite(ap.dist) || !Number.isFinite(bp.dist)) return false;
  // Standing ON a waypoint has no meaningful bearing from it; that is the cone's apex, so
  // it counts as inside rather than as a division by zero.
  if (ap.dist <= 0 || bp.dist <= 0) return true;
  // The angle form, not an along/cross comparison: _gpsTrackProjection derives alongNm
  // through acos, so it is never negative, and a position squarely BEHIND the start read
  // as a small positive along-track distance -- i.e. inside the cone. Measuring the two
  // bearings directly is both correct there and exactly what the spec describes.
  const fromA = Math.abs(_gpsAngleDiff(ap.brg, ab.brg));
  const fromB = Math.abs(_gpsAngleDiff(bp.brg, geo(b, a).brg));
  return fromA <= GPS_CONE_SECTOR_DEG && fromB <= GPS_CONE_SECTOR_DEG;
}

// Recomputed every fix. Returns the leg index, or -1 when no cone contains the position.
// Hysteresis first: if the CURRENT leg still contains us, keep it. That is what stops
// flapping where adjacent diamonds overlap around a shared waypoint.
function gpsLegByCone() {
  const wps = (typeof state !== 'undefined' && state.waypoints) || [];
  const legs = (typeof state !== 'undefined' && state.legs) || [];
  const n = Math.min(legs.length, wps.length - 1);
  if (!gpsOwn || n <= 0) return -1;
  const cur = gpsAlertLegIndex;
  if (cur >= 0 && cur < n && wps[cur] && wps[cur + 1] &&
      _gpsLegConeContains(wps[cur], wps[cur + 1], gpsOwn)) {
    return cur;
  }
  let best = -1, bestCross = Infinity;
  for (let i = 0; i < n; i++) {
    const a = wps[i], b = wps[i + 1];
    if (!a || !b || !_gpsLegConeContains(a, b, gpsOwn)) continue;
    const proj = _gpsTrackProjection(a, b, gpsOwn);
    const cross = proj ? Math.abs(proj.crossNm) : Infinity;
    if (cross < bestCross) { bestCross = cross; best = i; }
  }
  return best;
}

// Where to fly to get back on. Candidates are the waypoints still AHEAD on the route --
// never simply the nearest by distance: after drifting off late in a leg, or on a route
// that doubles back, the closest waypoint is routinely one already overflown, and "direct
// ALPHA" when ALPHA is behind tells a pilot to turn around to resume a route that
// continues ahead. Among those, the nearest one within +/-45 degrees of the current
// heading wins -- least turn, and the one a pilot would pick by eye. If none is in the
// sector the nearest candidate is named anyway, with the turn direction, because "you are
// off route" with no target is the unhelpful message this exists to avoid.
function gpsRouteRecovery() {
  const wps = (typeof state !== 'undefined' && state.waypoints) || [];
  if (!gpsOwn || wps.length < 2) return null;
  const from = Math.min(Math.max(gpsAlertLegIndex, 0) + 1, wps.length - 1);
  const hdg = Number.isFinite(gpsOwn.hdg) ? gpsOwn.hdg : null;
  let inSector = null, nearest = null;
  for (let i = from; i < wps.length; i++) {
    const wp = wps[i];
    if (!wp) continue;
    const g = geo(gpsOwn, wp);
    if (!Number.isFinite(g.dist)) continue;
    const cand = { index: i, wp: wp, distNm: g.dist, brg: g.brg };
    if (!nearest || cand.distNm < nearest.distNm) nearest = cand;
    if (hdg != null && Math.abs(_gpsAngleDiff(g.brg, hdg)) <= GPS_CONE_SECTOR_DEG) {
      if (!inSector || cand.distNm < inSector.distNm) inSector = cand;
    }
  }
  const pick = inSector || nearest;
  if (!pick) return null;
  // Only worth naming a turn when the target is NOT already ahead of the nose.
  let turn = null;
  if (!inSector && hdg != null) turn = _gpsAngleDiff(pick.brg, hdg) >= 0 ? 'right' : 'left';
  return { index: pick.index, wp: pick.wp, distNm: pick.distNm, brg: pick.brg, turn: turn };
}

// Debounced: a wide turn at a waypoint and ordinary GPS scatter both put a fix briefly
// outside, and an alert that cried wolf there would be turned off. Timed, not counted in
// fixes -- fix rate varies with the source, and a count would mean a different grace
// period on a 1 Hz phone fix than on a simulator poll.
function gpsCheckRouteUnknown(insideCone) {
  if (insideCone) {
    _gpsConeOutsideSince = null;
    _gpsConeAlertedHdg = null;
    gpsRouteUnknown = false;
    return;
  }
  const now = Date.now();
  if (_gpsConeOutsideSince == null) { _gpsConeOutsideSince = now; return; }
  if (now - _gpsConeOutsideSince < GPS_CONE_UNKNOWN_MS) return;
  gpsRouteUnknown = true;
  const rec = gpsRouteRecovery();
  if (!rec) return;
  const hdgMag = (typeof toMagnetic === 'function') ? toMagnetic(rec.brg) : rec.brg;
  const hdg = Math.round(hdgMag);
  // A heading given once goes stale the moment the aircraft turns, so this repeats -- but
  // only when the course has genuinely moved, and never more often than once a minute.
  // Flying straight at the target produces no repeats.
  if (_gpsConeAlertedHdg != null) {
    const moved = Math.abs(_gpsAngleDiff(hdg, _gpsConeAlertedHdg));
    if (moved < GPS_CONE_REPEAT_DEG || now - _gpsConeAlertedAt < GPS_CONE_REPEAT_MS) return;
  }
  _gpsConeAlertedHdg = hdg;
  _gpsConeAlertedAt = now;
  const label = (typeof waypointDisplayLabel === 'function')
    ? waypointDisplayLabel(rec.wp, rec.index) : (rec.wp.name || '');
  const hdg3 = (typeof pad3 === 'function') ? pad3(hdg) : String(hdg);
  const nm = Math.round(rec.distNm * 10) / 10;
  gpsSendWatchAlert(
    (S && S.watchAlertOffRouteTitle) || 'Off route',
    (S && S.watchAlertOffRouteBody) ? S.watchAlertOffRouteBody(label, hdg3, nm, rec.turn)
      : ('Direct ' + label + ', heading ' + hdg3 + ', ' + nm + ' NM'),
    // Spoken form only once the voice feature is present -- these two land independently,
    // and an undefined helper here would take the notification down with it.
    (S && S.speakAlertOffRoute && typeof gpsSpokenDigits === 'function')
      ? S.speakAlertOffRoute(label,
          gpsSpokenDigits(hdg3, (typeof window !== 'undefined' && window.__navLang) || 'en'),
          nm, rec.turn)
      : null);
}

function gpsCheckLegAlerts() {
  if (!gpsOwn || typeof state === 'undefined' || typeof geo !== 'function') return;
  const wps = state.waypoints || [];
  const legs = state.legs || [];
  // The cone decides which leg we are on, every fix -- not a forward-only pointer. This is
  // what lets a pilot rejoin mid-route, fly it backwards, or skip a leg and still be
  // tracked, and what makes "I do not know where you are" expressible at all.
  const coneLeg = gpsLegByCone();
  if (coneLeg >= 0) {
    if (coneLeg !== gpsAlertLegIndex) {
      // A different leg means that leg's one-shot alerts are owed again -- rejoining a leg
      // you had left should give you its approach call. The hysteresis in gpsLegByCone is
      // what keeps this from re-arming on every wobble at a cone boundary.
      gpsAlertLegIndex = coneLeg;
      _gpsAlertLegFired = false;
      _gpsAlertAltDeviated = false;
      _gpsAlertMinDistNm = Infinity;
    }
    // Being inside a cone IS confirmation: it is a positional fact about a bounded region,
    // not the nearest-leg guess the old gate was protecting against. Alerts therefore start
    // working as soon as the aircraft is demonstrably on a leg, instead of waiting for the
    // first waypoint capture -- which used to cost the FIRST waypoint of every session its
    // approach call, since the capture that confirmed was the same event that fired TOP.
    _gpsAlertConfirmed = true;
  }
  gpsCheckRouteUnknown(coneLeg >= 0);
  // Outside every cone there is no trustworthy leg to measure against, and an altitude
  // "deviation" from a leg the aircraft is not flying is noise. The off-route alert
  // supersedes them; normal alerting resumes on re-entry.
  if (gpsRouteUnknown) return;
  if (gpsAlertLegIndex >= legs.length || gpsAlertLegIndex + 1 >= wps.length) return;
  const next = wps[gpsAlertLegIndex + 1];
  if (!next) return;
  const { dist } = geo(gpsOwn, next);
  if (!Number.isFinite(dist)) return;

  // ETA is measured against the CURRENT leg's own PLANNED speed, not gpsLastGS -- the route
  // plan is the source of truth for how fast this leg is flown, not whatever the live fix
  // happens to report right now (a pilot running faster or slower than planned still gets
  // the alert relative to the plan, matching what the leg kite itself already shows).
  const curLeg = legs[gpsAlertLegIndex];
  const planSpeed = (curLeg && curLeg.flightSpeed > 0) ? curLeg.flightSpeed : null;
  if (_gpsAlertConfirmed && !_gpsAlertLegFired && planSpeed) {
    // A leg shorter than the standard 2-minute lead time would otherwise fire the alert
    // essentially at the moment the leg starts (or never usefully "N minutes before" at
    // all) -- half the lead time instead, once the CURRENT leg's own planned duration is
    // under the standard threshold.
    let etaThreshold = GPS_LEG_ETA_S;
    const start = wps[gpsAlertLegIndex];
    const legDurationS = start ? (geo(start, next).dist / planSpeed) * 3600 : Infinity;
    if (Number.isFinite(legDurationS) && legDurationS < GPS_LEG_ETA_S) {
      etaThreshold = GPS_LEG_ETA_S / 2;
    }
    const etaS = (dist / planSpeed) * 3600;
    if (etaS <= etaThreshold) {
      _gpsAlertLegFired = true;
      const label = (typeof waypointDisplayLabel === 'function')
        ? waypointDisplayLabel(next, gpsAlertLegIndex + 1) : (next.name || '');
      // What to fly on the leg AFTER this waypoint -- the one starting here, not the one
      // just being finished -- so the alert doubles as prep for the turn, not just a
      // "you're nearly there" ping. Either can be unavailable (last leg: no next leg at
      // all; no altitude entered on it; the pilot hid that leg's nav kite -- legKiteVisible,
      // same effective-visibility rule the kite itself uses, so a leg deliberately
      // decluttered on the map doesn't get its numbers read out here either) and is simply
      // omitted, never guessed.
      const nextLeg = legs[gpsAlertLegIndex + 1];
      const nextLegKiteVisible = (typeof legKiteVisible !== 'function') ||
        legKiteVisible(gpsAlertLegIndex + 1, nextLeg);
      let nextLegAlt = null;
      let nextLegHdg = null;
      let nextLegTime = null;
      let nextLegHms = null;    // {h,m,s} of the SAME figure the kite shows, for speech
      if (nextLegKiteVisible) {
        nextLegAlt = (nextLeg && Number.isFinite(nextLeg.inboundAltitude))
          ? Math.round(nextLeg.inboundAltitude) : null;
        const afterNext = wps[gpsAlertLegIndex + 2];
        const nextLegGeo = afterNext ? geo(next, afterNext) : null;
        // Magnetic AND wind-corrected -- the leg inspector's own "With wind" readout
        // (interact.js) shows toMagnetic(windTriangle(brg, leg.flightSpeed, wind).hdgTrue),
        // not the plain course; this reported the uncorrected course, which read off by
        // however many degrees of WCA the leg's wind produced (reported live: leg inspector
        // said 6°, this said 5°). windTriangle() itself returns null for calm/no-wind/an
        // unflyable crosswind, in which case the plain course is the right answer anyway.
        if (nextLegGeo && Number.isFinite(nextLegGeo.brg) && typeof toMagnetic === 'function') {
          const nextWind = (nextLeg && typeof legWindFor === 'function') ? legWindFor(nextLeg) : null;
          const fx = (nextWind && typeof windTriangle === 'function' && nextLeg)
            ? windTriangle(nextLegGeo.brg, nextLeg.flightSpeed, nextWind) : null;
          // Three digits, same as every other heading the app displays (pad3 -- the leg
          // kite, the wind-effect readout, VOR radials): "004", not "4".
          nextLegHdg = (typeof pad3 === 'function')
            ? pad3(toMagnetic(fx ? fx.hdgTrue : nextLegGeo.brg)) : toMagnetic(fx ? fx.hdgTrue : nextLegGeo.brg);
        }
        // Planned time for the next leg -- its own distance at its own PLANNED speed, same
        // "route plan is the only source of truth ... ignore any drift" rule as the ETA
        // trigger and the wind-corrected heading above: not an estimate of how long it will
        // actually take given how the flight is actually going, just what the plan says.
        if (nextLegGeo && Number.isFinite(nextLegGeo.dist) && nextLeg && nextLeg.flightSpeed > 0 &&
            typeof toHMS === 'function') {
          nextLegTime = toHMS(nextLegGeo.dist / nextLeg.flightSpeed);
          // Whole minutes for the SPOKEN form -- seconds are false precision on a planned
          // time, and they lengthen the phrase at the moment the pilot is busiest.
          // Speak the figure the kite ALREADY shows rather than deriving a second one.
          // toHMS floors the minutes and quantises the seconds to 5s, so rounding its
          // result again to whole minutes both loses information and disagrees with the
          // map: a 12:30 leg was being spoken as "13 minutes".
          const _hms = nextLegTime.split(':').map(Number);
          nextLegHms = _hms.length === 3
            ? { h: _hms[0], m: _hms[1], s: _hms[2] }
            : { h: 0, m: _hms[0], s: _hms[1] };
        }
      }
      gpsSendWatchAlert((S && S.watchAlertLegTitle) || 'Next leg',
        (S && S.watchAlertLegBody) ? S.watchAlertLegBody(label, nextLegAlt, nextLegHdg, nextLegTime)
          : ('Approaching ' + label),
        (S && S.speakAlertLeg)
          ? S.speakAlertLeg(label, nextLegAlt,
              nextLegHdg == null ? null : gpsSpokenDigits(nextLegHdg, (typeof window !== 'undefined' && window.__navLang) || 'en'),
              nextLegHms)
          : null);
    }
  }

  // Altitude vs. the CURRENT leg's planned altitude -- same field routeProfile() treats
  // as the leg's planned altitude. One-shot per deviation episode: fires once on the way
  // out past tolerance, clears once back inside it, so a second real drift fires again.
  const planned = legs[gpsAlertLegIndex].inboundAltitude;
  if (_gpsAlertConfirmed && Number.isFinite(planned) && gpsLastAlt != null) {
    const off = Math.abs(gpsLastAlt - planned);
    if (off >= GPS_ALT_TOLERANCE_FT) {
      if (!_gpsAlertAltDeviated) {
        _gpsAlertAltDeviated = true;
        gpsSendWatchAlert((S && S.watchAlertAltTitle) || 'Altitude',
          (S && S.watchAlertAltBody)
            ? S.watchAlertAltBody(Math.round(gpsLastAlt), Math.round(planned))
            : (Math.round(gpsLastAlt) + ' ft, planned ' + Math.round(planned) + ' ft'),
          (S && S.speakAlertAlt)
            ? S.speakAlertAlt(Math.round(gpsLastAlt), Math.round(planned)) : null);
      }
    } else {
      _gpsAlertAltDeviated = false;
    }
  }

  // Advance the leg pointer: within the capture radius of the next waypoint, or the
  // distance to it has started growing again after shrinking (passed abeam it). This IS
  // the "overhead the waypoint" moment -- CVFR radio phraseology's own "TOP <point>" call --
  // so it fires here, once per crossing (the index only ever moves forward past a given
  // waypoint the one time this condition is first met; a lingering loiter right at the
  // capture radius does not re-fire it, because by the next check gpsAlertLegIndex has
  // already moved on to a different `next`).
  if (dist < _gpsAlertMinDistNm) _gpsAlertMinDistNm = dist;
  const captured = dist <= GPS_LEG_CAPTURE_NM;
  if (captured || dist > _gpsAlertMinDistNm + GPS_LEG_CAPTURE_NM) {
    // A genuine capture -- a fix actually landed within radius of a real waypoint --
    // is what confirms gpsAlertLegIndex is right, not just an inferred snap. The
    // "passed abeam without ever getting close" branch still advances the pointer
    // (needed to keep tracking a route flown well off one waypoint), but does not
    // confirm it -- if this is the FIRST advance since a snap, its own TOP alert
    // (and every other alert type, gated above) stays silent too.
    if (captured) _gpsAlertConfirmed = true;
    if (_gpsAlertConfirmed) {
      // Just "TOP" -- no waypoint name. The leg-approach alert already named it
      // seconds earlier; repeating it here only added characters to a small watch screen.
      // Passing a waypoint is also the moment the drift check must go quiet for a while:
      // see _gpsLastTopAt in gpsCheckDrift.
      _gpsLastTopAt = Date.now();
      // A waypoint that changes frequency is exactly where the pilot is about to make a
      // call, so TOP carries it: the notification already shows the callout on the map,
      // and hearing it saves looking down at the one moment the eyes are outside.
      const ccAt = gpsCommChangeAt(next);
      const ccLang = (typeof window !== 'undefined' && window.__navLang) || 'en';
      const ccFreq = ccAt ? gpsSpokenFreq(ccAt.freq, ccLang) : '';
      gpsSendWatchAlert((S && S.watchAlertTopTitle) || 'TOP',
        (S && S.watchAlertTopBody) || 'TOP',
        (ccAt && S && S.speakAlertTopComm)
          ? S.speakAlertTopComm(ccAt.freqName, ccFreq)
          : ((S && S.speakAlertTop) ? S.speakAlertTop() : null));
    }
    gpsAlertLegIndex++;
    _gpsAlertMinDistNm = Infinity;
    _gpsAlertLegFired = false;
    _gpsAlertAltDeviated = false;
  }
}

// --- spoken alerts (APK) -------------------------------------------------
// A heading is read digit by digit -- "zero zero four", never "four". Every heading this
// app displays is already three-digit padded (pad3), and a TTS engine handed "004" says
// "four", which is a different heading to anyone listening.
var _GPS_DIGIT_WORDS = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
  he: ['אפס', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'],
};
function gpsSpokenDigits(value, lang) {
  if (value == null) return '';
  const words = _GPS_DIGIT_WORDS[lang] || _GPS_DIGIT_WORDS.en;
  const out = [];
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    const d = s.charCodeAt(i) - 48;
    if (d >= 0 && d <= 9) out.push(words[d]);
  }
  return out.join(' ');
}
window.gpsSpokenDigits = gpsSpokenDigits;

// Native TTS, same access pattern as _nativeNotify()/_bgGeo(): the injected Capacitor
// bridge exposes any synced plugin at window.Capacitor.Plugins.*. On the website (no
// native plugin) gpsSpeak() falls back to window.speechSynthesis below -- but that
// fallback is a TESTING aid only, never the in-flight path: browsers suspend
// speechSynthesis when the page is backgrounded, which is exactly the cockpit case
// (phone locked, background geolocation still feeding fixes). A voice that goes quiet
// precisely when it is needed is worse than none, because it is trusted. The APK's
// native plugin does not have that failure mode and stays the reliable path in flight.
function _nativeTts() {
  const C = typeof window !== 'undefined' && window.Capacitor;
  return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() &&
          C.Plugins && C.Plugins.TextToSpeech) || null;
}
function gpsVoiceAlertsOn() {
  return typeof window !== 'undefined' && window.voiceAlerts === true;
}
// Resolved once per session: asking the engine on every alert would put a round trip in
// front of speech that is already late by the time it matters.
var _gpsVoiceLang = null;
function _gpsResolveVoiceLang(tts) {
  if (_gpsVoiceLang) return Promise.resolve(_gpsVoiceLang);
  const want = (typeof window !== 'undefined' && window.__navLang === 'he') ? 'he-IL' : 'en-US';
  if (want === 'en-US') { _gpsVoiceLang = want; return Promise.resolve(want); }
  if (typeof tts.getSupportedLanguages !== 'function') {
    _gpsVoiceLang = want;
    return Promise.resolve(want);
  }
  return tts.getSupportedLanguages().then(function (res) {
    const list = (res && res.languages) || [];
    // A device with no Hebrew voice speaks the English phrasing rather than nothing: a
    // missing voice must never mean a missed alert.
    _gpsVoiceLang = list.some(function (l) { return String(l).toLowerCase().indexOf('he') === 0; })
      ? want : 'en-US';
    return _gpsVoiceLang;
  }).catch(function () { _gpsVoiceLang = 'en-US'; return _gpsVoiceLang; });
}
// Web speechSynthesis fallback, used only when there is no native plugin (see the
// comment above _nativeTts). Resolves the returned promise on 'end' so the speak chain
// still queues correctly, and also resolves on 'error' -- an engine that never calls
// back must not hang the chain forever. Absence of either global is a silent no-op, same
// as the rest of gpsSpeak.
function _webSpeak(text, lang) {
  if (typeof window === 'undefined' || !window.speechSynthesis ||
      typeof window.SpeechSynthesisUtterance !== 'function') {
    return Promise.resolve();
  }
  return new Promise(function (resolve) {
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.onend = function () { resolve(); };
    u.onerror = function () { resolve(); };
    window.speechSynthesis.speak(u);
  });
}
// Chained, never interrupted: a TOP firing seconds after a leg-approach alert waits its
// turn rather than cutting it off mid-word.
window.__gpsSpeakChain = Promise.resolve();
function gpsSpeak(text) {
  if (!text || !gpsVoiceAlertsOn()) return;
  const tts = _nativeTts();
  const lang = (typeof window !== 'undefined' && window.__navLang === 'he') ? 'he-IL' : 'en-US';
  if (tts && typeof tts.speak === 'function') {
    window.__gpsSpeakChain = window.__gpsSpeakChain.then(function () {
      return _gpsResolveVoiceLang(tts).then(function (voiceLang) {
        return tts.speak({
          text: text,
          lang: voiceLang,
          // iOS audio-session category; ignored on Android. 'playback', NOT the plugin's
          // 'ambient' default: the plugin's own docs say 'playback' is what plays audio
          // "even when the app is in the background", and backgrounded is precisely when
          // these alerts matter -- phone locked in a cockpit, background geolocation still
          // feeding fixes. An 'ambient' session would go silent exactly then, which is the
          // failure mode this whole feature exists to avoid.
          category: 'playback',
        });
      });
    }).catch(function () { /* best-effort: never let a TTS failure break the chain */ });
    return;
  }
  // No native plugin -- website testing path.
  window.__gpsSpeakChain = window.__gpsSpeakChain.then(function () {
    return _webSpeak(text, lang);
  }).catch(function () { /* best-effort: never let a TTS failure break the chain */ });
}
window.gpsSpeak = gpsSpeak;
window.gpsVoiceAlertsOn = gpsVoiceAlertsOn;

// Native (APK) local-notifications plugin, mirroring _bgGeo()'s access pattern -- the
// injected Capacitor bridge exposes any synced plugin at window.Capacitor.Plugins.*.
function _nativeNotify() {
  const C = typeof window !== 'undefined' && window.Capacitor;
  return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() &&
          C.Plugins && C.Plugins.LocalNotifications) || null;
}
// No point prompting for, or sending, a WEB notification on a desktop browser during a
// REAL flight -- nothing is going to mirror it to a watch, and there's no phone to show it
// on either. The APK path (_nativeNotify above) is unaffected: it's definitionally a phone
// already. Prefers the modern, non-sniffing signal (userAgentData.mobile) where Chromium
// exposes it; the UA string is a fallback for engines that don't (Firefox, Safari).
//
// Exempt while connected to a flight simulator (simOn, io.js): that's either dev/testing
// (the whole point is seeing the alert on the machine you're testing from, however it's
// wired up) or a real home-sim setup where the desktop IS where a pilot would watch for
// it -- neither belongs behind a "you're not on a phone" gate meant for an actual flight.
function _gpsIsMobileDevice() {
  if (typeof simOn !== 'undefined' && simOn) return true;
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
    return navigator.userAgentData.mobile;
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}
var _watchNotifyPermAsked = false;
// Ask once per tracking session, not once per alert -- a denial should not re-prompt on
// every fix. Best-effort: a silent no-op on an unsupported/denied context is the correct
// behaviour here, not an error the pilot needs to see.
// Returns a promise so a caller that wants to send an alert RIGHT AFTER asking (the
// no-route test nudge below) can wait for the answer -- the browser/native permission
// prompt is async and waits on the user, so a synchronous gpsSendWatchAlert() call right
// after this one used to read the still-'default' permission and silently drop the very
// first alert of a session, exactly when a pilot had just clicked Allow.
function gpsRequestNotifyPermission() {
  if (_watchNotifyPermAsked) return Promise.resolve();
  _watchNotifyPermAsked = true;
  const nn = _nativeNotify();
  if (nn) return nn.requestPermissions().catch(function () {});
  if (!_gpsIsMobileDevice()) return Promise.resolve();
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    return Notification.requestPermission().catch(function () {});
  }
  return Promise.resolve();
}
var _watchAlertId = 1;
function gpsSendWatchAlert(title, body, speech) {
  // Speech first, and independent: it is fire-and-forget, and the notification below has
  // its own return paths (native plugin, service worker, plain constructor) that must not
  // decide whether the pilot hears the alert.
  gpsSpeak(speech);
  const nn = _nativeNotify();
  if (nn) {
    nn.schedule({ notifications: [{ id: _watchAlertId++, title: title, body: body,
      schedule: { at: new Date(Date.now() + 100) } }] }).catch(function () {});
    return;
  }
  if (!_gpsIsMobileDevice()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const plain = function () {
    try { new Notification(title, { body: body }); } catch (e) { /* unsupported context */ }
  };
  const sw = (typeof navigator !== 'undefined') ? navigator.serviceWorker : null;
  if (!sw || typeof sw.ready === 'undefined') { plain(); return; }
  // Android Chrome refuses the bare `new Notification()` constructor once a service worker
  // is registered for the page -- throws "Illegal constructor", silently swallowed by
  // plain()'s catch, which is exactly why this app's alerts worked on a desktop browser but
  // never appeared on an Android one. Route through the service worker's showNotification()
  // instead, which works everywhere. Raced against a short timeout so an environment with no
  // ACTIVE worker (a test harness; a page that never got past `?nogist`-style early boot)
  // still falls back promptly instead of hanging on a `.ready` that never resolves.
  let settled = false;
  const timeout = setTimeout(function () { if (!settled) { settled = true; plain(); } }, 800);
  sw.ready.then(function (reg) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (reg && typeof reg.showNotification === 'function') reg.showNotification(title, { body: body }).catch(plain);
    else plain();
  }).catch(function () {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    plain();
  });
}

// --- watch alert: drifted off the leg's course line -----------------------
// Checked on its own 2-minute timer, not per-fix like the leg/altitude alerts above --
// this is a "how are we doing" periodic check, not a one-shot event, and re-fires every
// interval as long as the drift persists (no one-shot suppression here; 2 minutes is
// already the pacing).
var GPS_DRIFT_CHECK_MS = 120000;
var GPS_DRIFT_TRACK_ERROR_DEG = 10;   // fire once track-angle error reaches this
// Overhead a waypoint the aircraft is turning onto the next leg, so its track is honestly
// nothing like that leg's course -- track-angle error is huge and shrinking, and calling
// that "off course" is crying wolf at the one moment the pilot is busiest and least wrong.
// Reported live: the drift alert "shoots too early" after TOP. Stay quiet until the turn
// has had time to settle.
var GPS_DRIFT_AFTER_TOP_MS = 30000;
var _gpsLastTopAt = 0;
var _gpsDriftTimer = null;

// A connected simulator's own clock can run faster than real time (cvfr-bridge's
// speed_factor field, captured onto window.simSpeedFactor in io.js's _simFetch) -- a fixed
// REAL-TIME interval has no idea, and a 2-real-minute wait against a 10x-fast aircraft
// checks 10x too rarely relative to how quickly it's actually covering ground. Real GPS
// (simOn false) always uses the standard cadence -- there is no "sped up" real flight.
function _gpsDriftIntervalMs() {
  const sf = (typeof simOn !== 'undefined' && simOn && typeof window !== 'undefined' &&
    Number.isFinite(window.simSpeedFactor) && window.simSpeedFactor > 0)
    ? window.simSpeedFactor : 1;
  return GPS_DRIFT_CHECK_MS / sf;
}
// setTimeout, not setInterval: re-reads the (possibly just-changed) speed factor on every
// reschedule, so a factor that changes mid-session -- reconnecting to a differently-tuned
// bridge, or simply disconnecting the simulator and falling back to real GPS -- takes
// effect on the very next check instead of only once the OLD interval is torn down and
// restarted.
function _gpsDriftTick() {
  gpsCheckDrift();
  if (_gpsDriftTimer !== null) _gpsDriftTimer = setTimeout(_gpsDriftTick, _gpsDriftIntervalMs());
}
function gpsMaybeStartDriftTimer() {
  if (_gpsDriftTimer !== null) return;
  _gpsDriftTimer = setTimeout(_gpsDriftTick, _gpsDriftIntervalMs());
}
// Only actually stops once NONE of the three position sources (recording, live-only,
// connected simulator) are still running -- called from all three teardown paths, each of
// which may fire while another is still active (e.g. stopping a recording with live
// location still on).
function gpsMaybeStopDriftTimer() {
  if (gpsRecording || gpsLiveOn || (typeof simOn !== 'undefined' && simOn)) return;
  if (_gpsDriftTimer !== null) { clearTimeout(_gpsDriftTimer); _gpsDriftTimer = null; }
}

// Signed angular difference a-b, wrapped to (-180, 180].
function _gpsAngleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function gpsCheckDrift() {
  if (!gpsOwn || typeof state === 'undefined' || typeof geo !== 'function') return;
  // Reads gpsAlertLegIndex as the reference leg to measure track error against --
  // meaningless (or actively wrong) before a real waypoint has confirmed it, same
  // "don't alert on a guess" rule gpsCheckLegAlerts' own three alert types follow.
  if (!_gpsAlertConfirmed) return;
  // Just passed a waypoint: the turn onto the new leg has not settled yet (see
  // GPS_DRIFT_AFTER_TOP_MS).
  if (_gpsLastTopAt && Date.now() - _gpsLastTopAt < GPS_DRIFT_AFTER_TOP_MS) return;
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
    gpsSendWatchAlert((S && S.watchAlertDriftTitle) || 'Off course',
      (S && S.watchAlertDriftBody) ? S.watchAlertDriftBody(driftOut, driftIn, label)
        : (driftOut + '° off course, ' + driftIn + '° to intercept toward ' + label),
      (S && S.speakAlertDrift) ? S.speakAlertDrift(driftOut, driftIn, label) : null);
  } else {
    // Past the midpoint: rejoining the original line buys nothing this close to the
    // waypoint -- report the correction to head direct to it instead.
    const direct = geo(gpsOwn, end);
    const correction = Math.round(Math.abs(_gpsAngleDiff(direct.brg, leg.brg)));
    gpsSendWatchAlert((S && S.watchAlertDriftTitle) || 'Off course',
      (S && S.watchAlertDriftDirectBody) ? S.watchAlertDriftDirectBody(correction, label)
        : (correction + '° to ' + label),
      (S && S.speakAlertDriftDirect) ? S.speakAlertDriftDirect(correction, label) : null);
  }
}
