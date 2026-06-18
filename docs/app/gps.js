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

// Great-circle distance in metres between two {lat,lng}.
function _gpsMetres(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLa = rad(b.lat - a.lat), dLo = rad(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
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
  try { sessionStorage.setItem('navaid.gpsTrack', JSON.stringify(gpsTrack)); } catch (e) { /* */ }
  gpsUpdateReadout();
  scheduleDraw();
  if (gpsFollow && typeof map !== 'undefined') map.setView([pt.lat, pt.lng], map.getZoom());
}

function onGpsError(err) {
  stopGpsRecording();
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

// Stop watching without saving. (Save handled in a later task.)
function stopGpsRecording() {
  if (gpsWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = null;
  gpsRecording = false;
  gpsOwn = null;
  try { sessionStorage.removeItem('navaid.gpsTrack'); } catch (e) { /* */ }
  gpsUpdateReadout();
  scheduleDraw();
}
