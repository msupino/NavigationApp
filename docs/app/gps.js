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
// Iterative (explicit-stack) implementation — overflow-safe for up to GPS_MAX_POINTS.
function simplifyTrack(points, eps) {
  if (!Array.isArray(points) || points.length < 3) return (points || []).slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    let maxD = -1, idx = -1;
    const a = points[lo], b = points[hi];
    for (let i = lo + 1; i < hi; i++) {
      const d = _perpDeg(points[i], a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { keep[idx] = true; stack.push([lo, idx], [idx, hi]); }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
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
  const c = pos.coords;
  if (c.accuracy != null && c.accuracy > GPS_MAX_ACC_M) return;
  const p = { lat: r5(c.latitude), lng: r5(c.longitude) };
  const hdg = (c.heading != null && !isNaN(c.heading)) ? c.heading
            : (_gpsLivePrev ? geo(_gpsLivePrev, p).brg : 0);
  _gpsLivePrev = p;
  gpsOwn = { lat: p.lat, lng: p.lng, hdg };
  scheduleDraw();
  if (gpsFollow && typeof map !== 'undefined') map.setView([p.lat, p.lng], map.getZoom());
}

function startLiveLocation() {
  if (gpsLiveOn) return;
  if (!navigator.geolocation) { alert(S.gpsUnsupported || 'GPS is not available in this browser.'); return; }
  gpsLiveOn = true; _gpsLivePrev = null;
  gpsLiveWatchId = navigator.geolocation.watchPosition(onLivePosition, onGpsError, { enableHighAccuracy: true });
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
  gpsUpdateReadout();
  scheduleDraw();
  if (gpsFollow && typeof map !== 'undefined') map.setView([pt.lat, pt.lng], map.getZoom());
}

function onGpsError(err) {
  stopGpsRecording();
  stopLiveLocation();
  const rb = document.getElementById('gps-record'); if (rb) rb.textContent = S.tbGpsRecord;
  const lb = document.getElementById('gps-live'); if (lb) { lb.textContent = S.tbGpsLive; lb.setAttribute('aria-pressed', 'false'); }
  alert((S.gpsError || 'GPS error: ') + (err && err.message ? err.message : ''));
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
  gpsOwn = null;
  gpsUpdateReadout();
  scheduleDraw();
}
