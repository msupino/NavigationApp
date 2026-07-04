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
  return 'Record - ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
       + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Stop recording AND save. Returns the new library entry, or null.
// A recording is stored as a TRACK (a line), not a waypoint route: it keeps
// only the raw fix list. On the map it's an overlay drawn on top of whatever
// route (if any) is loaded — see the saved-track overlay section below.
function stopGpsRecordingAndSave() {
  const raw = gpsTrack.slice();
  stopGpsRecording();
  if (raw.length < 2) { alert(S.gpsNoTrack || 'No track recorded.'); return null; }
  const entry = {
    id: routeLibraryId(),
    name: gpsTrackName(),
    savedAt: new Date().toISOString(),
    kind: 'gps',
    track: raw.map(p => ({ lat: r5(p.lat), lng: r5(p.lng), t: p.t,
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
// the waypoint route. Multiple can be shown at once; the set of shown ids is
// persisted so overlays survive a reload.
var shownTracks = [];                 // [{ id, name, points:[{lat,lng,alt,t}], color }]
const TRACK_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
                      '#008080', '#9a6324', '#000075'];
const SHOWN_TRACKS_KEY = 'navaid.tracks.shown';
var _shownTracksBooted = false;

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
  return TRACK_COLORS.find(c => !used.has(c)) || TRACK_COLORS[shownTracks.length % TRACK_COLORS.length];
}
function _addTrackOverlay(entry) {
  if (!entry || isTrackShown(entry.id)) return false;
  const points = trackPointsFromEntry(entry);
  if (points.length < 2) return false;
  shownTracks.push({ id: entry.id, name: entry.name || '', points, color: _nextTrackColor() });
  return true;
}
function showTrackOverlay(entry) {
  if (_addTrackOverlay(entry)) { persistShownTrackIds(); scheduleDraw(); }
}
function hideTrackOverlay(id) {
  const before = shownTracks.length;
  shownTracks = shownTracks.filter(t => t.id !== id);
  if (shownTracks.length !== before) { persistShownTrackIds(); scheduleDraw(); }
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
  for (const id of ids) { const e = lib.find(x => x.id === id); if (e) _addTrackOverlay(e); }
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
  for (const t of shownTracks) {
    const pts = t.points.map(proj);
    if (pts.length < 2) continue;
    octx.beginPath();
    octx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
    octx.lineWidth = tune('gpsBreadcrumbWidthPx');
    octx.strokeStyle = t.color;
    octx.stroke();
    const dot = (p, c) => {
      octx.beginPath(); octx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
      octx.fillStyle = c; octx.fill();
      octx.lineWidth = 1.5; octx.strokeStyle = '#fff'; octx.stroke();
    };
    dot(pts[0], '#0a0');                 // start = green
    dot(pts[pts.length - 1], '#d00');    // end = red
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
    (p.alt != null ? '<ele>' + (p.alt / 3.28084).toFixed(1) + '</ele>' : '') +  // ft → m
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
  URL.revokeObjectURL(a.href);
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
