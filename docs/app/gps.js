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

var gpsLiveOn = false;
var gpsLiveWatchId = null;
var _gpsLivePrev = null;

function onLivePosition(pos) {
  if (!gpsLiveOn || !pos || !pos.coords) return;
  if (gpsRecording) return;   // recording drives own-ship + recenter; avoid dueling
  const c = pos.coords;
  if (c.accuracy != null && c.accuracy > GPS_MAX_ACC_M) return;
  const p = { lat: r5(c.latitude), lng: r5(c.longitude) };
  const hdg = (c.heading != null && !isNaN(c.heading)) ? c.heading
            : (_gpsLivePrev ? geo(_gpsLivePrev, p).brg : 0);
  const isFirst = (_gpsLivePrev === null);
  _gpsLivePrev = p;
  gpsOwn = { lat: p.lat, lng: p.lng, hdg };
  scheduleDraw();
  if (typeof map !== 'undefined') {
    if (isFirst) map.setView([p.lat, p.lng], map.getZoom());
    else if (gpsFollow) map.setView([p.lat, p.lng], map.getZoom());
  }
}

function startLiveLocation() {
  if (gpsLiveOn) return;
  if (!navigator.geolocation) { alert(S.gpsUnsupported || 'GPS is not available in this browser.'); return; }
  gpsLiveOn = true; _gpsLivePrev = null;
  gpsLiveWatchId = navigator.geolocation.watchPosition(onLivePosition, onGpsLiveError, { enableHighAccuracy: true });
  scheduleDraw();
}

function stopLiveLocation() {
  if (gpsLiveWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(gpsLiveWatchId);
  gpsLiveWatchId = null;
  gpsLiveOn = false;
  _gpsLivePrev = null;
  if (!gpsRecording) gpsOwn = null;   // keep own-ship if a recording is still running
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
  if (!gpsRecording) { el.textContent = ''; return; }
  const secs = gpsStartT ? Math.round((Date.now() - gpsStartT) / 1000) : 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  let s = gpsTrack.length + ' pts · ' + mm + ':' + ss;
  if (gpsLastGS != null) s += ' · ' + Math.round(gpsLastGS) + ' kt';
  if (gpsLastAlt != null) s += ' · ' + Math.round(gpsLastAlt) + ' ft';
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
  gpsOwn = { lat: pt.lat, lng: pt.lng, hdg };
  gpsUpdateReadout();
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
function onGpsRecError(err) {
  if (!gpsRecording) return;
  stopGpsRecording();
  resetGpsFooterBtn('gps-record', S.tbGpsRecord, '⏺');
  alert(gpsErrMsg(err));
}
function onGpsLiveError(err) {
  if (!gpsLiveOn) return;
  stopLiveLocation();
  resetGpsFooterBtn('gps-live', S.tbGpsLive, '📍');
  alert(gpsErrMsg(err));
}

function startGpsRecording() {
  if (gpsRecording) return;
  if (!navigator.geolocation) { alert(S.gpsUnsupported || 'GPS is not available in this browser.'); return; }
  gpsRecording = true;
  gpsTrack = [];
  if (!gpsLiveOn) gpsOwn = null;
  gpsStartT = Date.now();
  gpsWatchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsRecError, { enableHighAccuracy: true });
  gpsAcquireWakeLock();
  gpsUpdateReadout();
  scheduleDraw();
}

function gpsTrackName() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return 'Track ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
       + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Build a validateRoute-passing route `data` from simplified points by reusing
// the canonical serializer with a guarded temporary state swap.
// Also neutralizes state.commChangeSuppressions and state.wind so the saved GPS
// entry is not polluted with the user's current comm-change suppressions or wind.
function gpsRouteDataFromPoints(points) {
  const saved = {
    waypoints: state.waypoints, legs: state.legs, notes: state.notes,
    commChangeSuppressions: state.commChangeSuppressions,
    wind: state.wind,
  };
  try {
    state.waypoints = points.map(p => ({ lat: r5(p.lat), lng: r5(p.lng), name: '' }));
    state.legs = [];
    state.notes = [];
    state.commChangeSuppressions = [];
    state.wind = { dir: 270, speed: 0 };  // calm — encodeWind omits speed:0
    syncLegs();
    // Carry the recorded GPS altitude into each leg as the flown cruise altitude
    // (inbound = forward direction; the return/outbound leg stays unknown since
    // we only flew it once). Per leg: nearest-100-ft average of its two endpoint
    // altitudes (GPS metres → ft). Mark manual so applyLegAltitudesToRoute won't
    // clobber it. Without this, every saved-route leg altitude reads "unknown".
    const altFt = i => (points[i] && points[i].alt != null && !isNaN(points[i].alt))
      ? points[i].alt * 3.28084 : null;
    for (let i = 0; i < state.legs.length; i++) {
      const a = altFt(i), b = altFt(i + 1);
      if (a == null || b == null) continue;
      state.legs[i].inboundAltitude = Math.round((a + b) / 2 / 100) * 100;
      state.legs[i]._legAltitudeAuto = 0;
    }
    return serializeRoute();
  } finally {
    state.waypoints = saved.waypoints; state.legs = saved.legs; state.notes = saved.notes;
    state.commChangeSuppressions = saved.commChangeSuppressions;
    state.wind = saved.wind;
    // Do NOT call syncLegs() here — saved.legs already has the correct length
    // for saved.waypoints, and syncLegs() would call applyLegAltitudesToRoute()
    // which overwrites any _legAltitudeAuto leg values (e.g. custom altitudes
    // the user set) with NaN when the waypoint names don't match the dataset.
  }
}

// Stop recording AND save. Returns the new library entry, or null.
function stopGpsRecordingAndSave() {
  const raw = gpsTrack.slice();
  stopGpsRecording();
  if (raw.length < 2) { alert(S.gpsNoTrack || 'No track recorded.'); return null; }
  const simp = simplifyTrack(raw.map(p => ({ lat: p.lat, lng: p.lng, alt: p.alt })), GPS_SIMPLIFY_EPS_DEG);
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
  if (gpsWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = null;
  gpsRecording = false;
  gpsReleaseWakeLock();
  gpsLastGS = null; gpsLastAlt = null;
  if (!gpsLiveOn) gpsOwn = null;
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
