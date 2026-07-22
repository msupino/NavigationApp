'use strict';
/* NavAid — drawing: route, nav-waypoints, notes, page frame.
   Shares globals with core.js; loaded after it. */

// Issue #394 (+ follow-up bug): default-kite clearance helpers, shared by
// `drawLegs` (rendering), `legLabelCenter` (interact.js hit-testing),
// and the drag-start materialiser (interact.js). The kite shape itself
// is `46 * legZoomScale()` px wide (see drawLegArrow in this file —
// `W = 46 * sc`), so its half-extent perpendicular to the leg axis is
// `23 * legZoomScale()`. Drift lines fan out from each waypoint at the
// configured drift angle (default 10°)
// from the leg axis for half the leg length; at the default along-leg
// position (midpoint, a=0) the cone reaches
// `(legLength / 2) * tan(drift angle)`
// perpendicular. The kite's *centre* must therefore sit at least
// (cone-extent + kite-half-width + visual margin) from the leg line so
// the kite *body* clears both the leg line and the drift dashes at
// every zoom and `legArrowSize`. The first cut of this fix only
// pushed the centre `(len/2)*tan(10°) + 8` out, which left the kite
// edge ON the leg line at low zoom or `legArrowSize >= 2`.
function driftAngleRad() {
  return tune('driftAngleDeg') * Math.PI / 180;
}
function legDefaultLabelPerp(legLenPx) {
  const sc = (typeof legZoomScale === 'function') ? legZoomScale() : 1;
  return (Math.max(1, legLenPx) / 2) * Math.tan(driftAngleRad()) +
         tune('defaultKiteHalfWidthPx') * sc +
         tune('defaultLabelMarginPx');
}
function legKiteAlongHalfPx(sc) {
  sc = sc ?? ((typeof legZoomScale === 'function') ? legZoomScale() : 1);
  return (tune('legKiteCellWidthPx') * 2 + tune('legKiteTriangleLenPx')) * sc / 2;
}

// --- drawing ---------------------------------------------------------
// Draws the own-ship symbol at pos {lat,lng} with true heading `hdg` (used for
// both the simulator aircraft and the live GPS position). Top-down airplane
// silhouette: nose up in local frame, rotated to (heading − map bearing) so it
// tracks correctly on a rotated map.
function drawOwnShip(pos, hdg) {
  if (!pos) return;
  const s = proj(pos);
  // Screen angle from a projected geographic offset in the heading direction,
  // so it stays correct under map rotation (map.setBearing) — same approach as
  // the wind/kite arrows. (The manual `heading − mapBearing` was only right at
  // north-up.) The silhouette's nose is up (−y) in local frame, hence +90°.
  const to = (hdg || 0) * Math.PI / 180;
  const eps = 0.02;   // ~1.2 NM; used for direction only
  const p2 = proj({
    lat: pos.lat + Math.cos(to) * eps,
    lng: pos.lng + Math.sin(to) * eps / Math.cos(pos.lat * Math.PI / 180),
  });
  const screenAngle = Math.atan2(p2.y - s.y, p2.x - s.x) + Math.PI / 2;
  const r = tune('liveAircraftRadiusPx');
  octx.save();
  octx.translate(s.x, s.y);
  octx.rotate(screenAngle);

  const fc = tune('liveAircraftFillColor');
  const oc = colorWithAlpha(tune('liveAircraftOutlineColor'), 0.9);

  function roundRect(x, y, w, h, radius) {
    const rx = Math.min(radius, w / 2, h / 2);
    octx.beginPath();
    octx.moveTo(x + rx, y);
    octx.lineTo(x + w - rx, y);
    octx.quadraticCurveTo(x + w, y, x + w, y + rx);
    octx.lineTo(x + w, y + h - rx);
    octx.quadraticCurveTo(x + w, y + h, x + w - rx, y + h);
    octx.lineTo(x + rx, y + h);
    octx.quadraticCurveTo(x, y + h, x, y + h - rx);
    octx.lineTo(x, y + rx);
    octx.quadraticCurveTo(x, y, x + rx, y);
    octx.closePath();
  }

  // Cessna-style: straight full-span wing, slim fuselage, tailplane, spinner.
  // Proportions match the footer SVG (viewBox 0 0 16 16, fuselage half-length = r).
  const fw = r * 0.24;   // fuselage half-width
  const wr = r * 0.14;   // rounded corner radius

  // fuselage
  roundRect(-fw, -r, fw * 2, r * 2, wr);
  octx.fillStyle = fc; octx.fill();
  octx.lineWidth = 1.5; octx.strokeStyle = oc; octx.stroke();

  // full-span straight wing (at ~-0.14r from center)
  roundRect(-r * 1.13, -r * 0.27, r * 2.26, r * 0.27, wr);
  octx.fillStyle = fc; octx.fill();
  octx.lineWidth = 1; octx.strokeStyle = oc; octx.stroke();

  // tailplane (shorter, near tail)
  roundRect(-r * 0.55, r * 0.63, r * 1.1, r * 0.22, wr * 0.5);
  octx.fillStyle = fc; octx.fill();
  octx.lineWidth = 1; octx.strokeStyle = oc; octx.stroke();

  // spinner (nose circle)
  octx.beginPath();
  octx.arc(0, -r, r * 0.14, 0, Math.PI * 2);
  octx.fillStyle = fc; octx.fill();
  octx.lineWidth = 1; octx.strokeStyle = oc; octx.stroke();

  octx.restore();
}

// TOC / TOD markers along the route (#672). A small dot + label at the point
// where climb/descent meets cruise on each affected leg.
function drawProfileMarkers() {
  if (typeof routeProfile !== 'function' || (state.legs || []).length === 0) return;
  const prof = routeProfile();
  const mark = (m, label, color) => {
    const A = state.waypoints[m.leg], B = state.waypoints[m.leg + 1];
    if (!A || !B) return;
    const sa = proj(A), sb = proj(B);
    const x = sa.x + (sb.x - sa.x) * m.frac, y = sa.y + (sb.y - sa.y) * m.frac;
    octx.save();
    octx.fillStyle = color;
    octx.strokeStyle = tune('profileMarkerHaloColor');
    octx.lineWidth = 1.5;
    octx.beginPath();
    octx.arc(x, y, 4, 0, 2 * Math.PI);
    octx.fill();
    octx.stroke();
    octx.font = 'bold 11px sans-serif';
    octx.textAlign = 'left';
    octx.textBaseline = 'middle';
    octx.lineWidth = 3;
    octx.strokeStyle = colorWithAlpha(tune('profileMarkerHaloColor'), 0.9);
    octx.strokeText(label, x + 7, y);
    octx.fillStyle = color;
    octx.fillText(label, x + 7, y);
    octx.restore();
  };
  for (const t of prof.tocs) mark(t, S.toc || 'TOC', tune('profileTocColor'));
  for (const t of prof.tods) mark(t, S.tod || 'TOD', tune('profileTodColor'));
}

// Render the altitude-vs-distance profile strip onto a canvas context within
// (x,y,w,h). Used by the Flight Plan modal (#672).
function drawVerticalProfile(ctx, x, y, w, h) {
  if (typeof routeProfile !== 'function') return;
  const prof = routeProfile();
  if (!prof.pts.length || prof.totalDist <= 0) return;
  const alts = prof.pts.map(p => p.alt);
  const maxA = Math.max.apply(null, alts) * 1.1 + 100;
  const minA = Math.min(0, Math.min.apply(null, alts));
  // Reserve a strip at the bottom for the X axis (NM + time per waypoint) and
  // a margin on the left for the altitude (Y) axis labels.
  const axisH = tune('profileAxisHeightPx');
  const yPad = tune('profileYPadPx');
  const plotH = Math.max(10, h - axisH);
  const plotW = Math.max(10, w - yPad);
  const x0 = x + yPad;                 // plot left edge (Y axis sits left of it)
  const baseY = y + plotH;
  // In RTL (Hebrew) the route reads right-to-left, so mirror the distance axis.
  const rtl = document.documentElement && document.documentElement.dir === 'rtl';
  const px = d => rtl ? x0 + plotW - (d / prof.totalDist) * plotW : x0 + (d / prof.totalDist) * plotW;
  const py = a => baseY - ((a - minA) / (maxA - minA || 1)) * plotH;
  ctx.save();
  ctx.fillStyle = tune('profileBgColor');
  ctx.fillRect(x, y, w, h);
  // Altitude (Y) axis: horizontal gridlines + ft labels at "nice" intervals.
  const niceSteps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const range = maxA - minA;
  const yStep = niceSteps.find(s => range / s <= 5) || 50000;
  ctx.textBaseline = 'middle';
  ctx.font = '8px sans-serif';
  for (let a = Math.ceil(minA / yStep) * yStep; a <= maxA; a += yStep) {
    const gy = py(a);
    ctx.strokeStyle = colorWithAlpha(tune('profileGridColor'), 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, gy + 0.5); ctx.lineTo(x + w, gy + 0.5); ctx.stroke();
    ctx.fillStyle = tune('profileTextColor');
    ctx.textAlign = 'right';
    ctx.fillText(String(a), x0 - 3, gy);
  }
  // Y axis unit caption.
  ctx.fillStyle = tune('profileTextColor');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('ft', x + 2, y + 2);
  // ground line
  ctx.strokeStyle = tune('profileGroundColor');
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, py(minA) + 0.5); ctx.lineTo(x + w, py(minA) + 0.5); ctx.stroke();
  // profile polyline + fill
  ctx.beginPath();
  ctx.moveTo(px(prof.pts[0].d), py(prof.pts[0].alt));
  for (const p of prof.pts) ctx.lineTo(px(p.d), py(p.alt));
  ctx.lineTo(px(prof.totalDist), py(minA));
  ctx.lineTo(px(0), py(minA));
  ctx.closePath();
  ctx.fillStyle = colorWithAlpha(tune('profileAreaColor'), 0.2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(px(prof.pts[0].d), py(prof.pts[0].alt));
  for (const p of prof.pts) ctx.lineTo(px(p.d), py(p.alt));
  ctx.strokeStyle = tune('profileLineColor');
  ctx.lineWidth = 2;
  ctx.stroke();
  // TOC/TOD dots
  const dot = (m, color, label) => {
    let cum = 0;
    for (let i = 0; i < m.leg; i++) cum += prof.legs[i] ? prof.legs[i].dist : 0;
    const d = cum + (prof.legs[m.leg] ? prof.legs[m.leg].dist * m.frac : 0);
    const cx = px(d), cy = py(m.alt);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill();
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy - 6);
  };
  for (const t of prof.tocs) dot(t, tune('profileTocColor'), S.toc || 'TOC');
  for (const t of prof.tods) dot(t, tune('profileTodColor'), S.tod || 'TOD');

  // X axis: at each waypoint a tick + cumulative NM + cumulative time, plus a
  // short waypoint id, with a faint gridline up through the plot so you can
  // read where each altitude change happens along the course.
  const cum = prof.wpCum || [];
  const tcum = prof.wpTime || [];
  const last = cum.length - 1;
  const gap = last > 0 ? plotW / last : plotW;  // px between adjacent waypoints (ticks span plotW, not full w)
  const wpId = i => {
    const wp = state.waypoints[i];
    if (!wp) return '';
    return String(wp.code || wp.name || '').slice(0, 4).toUpperCase();
  };
  const fmtT = h => {                            // hours → "7m" or "1:05"
    const m = Math.round((h || 0) * 60);
    return m < 60 ? m + 'm' : Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  };
  ctx.lineWidth = 1;
  ctx.textBaseline = 'top';
  for (let i = 0; i < cum.length; i++) {
    const lx = px(cum[i]);
    ctx.strokeStyle = colorWithAlpha(tune('profileGridColor'), 0.18);
    ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx, baseY); ctx.stroke();
    ctx.strokeStyle = tune('profileAxisColor');
    ctx.beginPath(); ctx.moveTo(lx, baseY + 0.5); ctx.lineTo(lx, baseY + 3.5); ctx.stroke();
    ctx.textAlign = i === 0 ? 'left' : i === last ? 'right' : 'center';
    // NM (bright) then cumulative time (dimmer) stacked under the tick.
    ctx.fillStyle = tune('profileNmTextColor');
    ctx.font = '8px sans-serif';
    ctx.fillText(String(Math.round(cum[i])), lx, baseY + 4);
    ctx.fillStyle = tune('profileTimeTextColor');
    ctx.font = '7px sans-serif';
    ctx.fillText(fmtT(tcum[i]), lx, baseY + 13);
    // Waypoint id (skip when ticks are too tight to avoid overlap).
    if (gap >= 22) {
      ctx.fillStyle = tune('profileTextColor');
      ctx.font = '7px sans-serif';
      ctx.fillText(wpId(i), lx, baseY + 22);
    }
  }
  // TOC/TOD also get an X-axis tick + NM/time readout in their marker colour,
  // so their along-route position is readable on the axis (not just the dot).
  const markAxis = (m, color) => {
    let dcum = 0;
    for (let k = 0; k < m.leg; k++) dcum += prof.legs[k] ? prof.legs[k].dist : 0;
    const segD = prof.legs[m.leg] ? prof.legs[m.leg].dist : 0;
    const segT = prof.legs[m.leg] ? prof.legs[m.leg].timeH : 0;
    const d = dcum + segD * m.frac;
    const t = (tcum[m.leg] || 0) + segT * m.frac;
    const lx = px(d);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx, baseY + 0.5); ctx.lineTo(lx, baseY + 4); ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.font = '8px sans-serif';
    ctx.fillText(String(Math.round(d)), lx, baseY + 4);
    ctx.font = '7px sans-serif';
    ctx.fillText(fmtT(t), lx, baseY + 13);
  };
  for (const t of prof.tocs) markAxis(t, tune('profileTocColor'));
  for (const t of prof.tods) markAxis(t, tune('profileTodColor'));

  // Axis unit caption.
  ctx.fillStyle = tune('profileTextColor');
  ctx.font = '7px sans-serif';
  ctx.textAlign = rtl ? 'left' : 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('NM / time', rtl ? x + 2 : x + w - 2, y + h);
  ctx.restore();
}

function draw() {
  octx.clearRect(0, 0, vw(), vh());
  drawAreas();                  // airspace bubbles under the waypoints
  drawNavWaypoints();
  drawReportingBadges();
  drawCommChangeRings();
  drawAirfields();
  drawVors();
  if (window.showNotam && Array.isArray(notams) && notams.length) drawNotams();
  drawLegs();
  drawWaypoints();
  // NOTAM airport count badges on top of waypoints so a route waypoint on the
  // field doesn't cover them (and they stay clickable).
  if (window.showNotam && Array.isArray(notams) && notams.length) drawNotamAirportMarkers();
  drawNotes();
  if (window.showProfile) drawProfileMarkers();   // TOC/TOD markers (#672)
  if (typeof drawTracks === 'function') drawTracks();       // saved-track overlays (flown lines)
  if (typeof drawGpsTrack === 'function') drawGpsTrack();   // GPS breadcrumb + own-ship (recording or live location)
  if (!gpsRecording && !gpsLiveOn && simOn && simAircraft) drawOwnShip(simAircraft, simAircraft.hdg);  // sim own-ship
  drawInfo();
  drawPageFrame();
  drawPlanCard();          // flight-plan card placed for PNG export (#378)
  // #78: keep the Flight Plan modal live with the route. The hook is null
  // when the modal isn't open, or after refresh detects a structural change
  // and closes it.
  if (refreshFlightPlan) refreshFlightPlan();
  // #214: skip persist during a PNG export. The export modal flips overlay
  // toggles for the preview render, then restores them; without this guard
  // the debounced persist() would write the preview-state mutation to
  // localStorage if the user reopened the modal mid-export.
  if (!NavAid.exporting) persist();
}

// --- SIGMET hazard overlay (active international SIGMETs) ------------
// A scheduled GitHub Action fetches the NOAA AWC isigmet feed, filters it to
// the Israel region, and publishes sigmet.json to the `sigmet-data` branch
// for this static app to read directly. Same-origin data/sigmet.json is the
// offline / first-run fallback.
const SIGMET_URL =
  'https://raw.githubusercontent.com/msupino/NavigationApp/sigmet-data/sigmet.json';
// NOTAMs: a scheduled Action queries the FAA NOTAM API for the Israel FIR
// (LLLL), normalises geometry, and publishes notam.json to the `notam-data`
// branch (filename unchanged there). data/notam.json is the offline /
// first-run fallback.
const NOTAM_URL =
  'https://raw.githubusercontent.com/msupino/NavigationApp/notam-data/notam.json';
async function loadNotam(force) {
  if (notams !== null && !force) return notams;
  const parse = d => {
    notamMeta = { generatedAt: (d && d.generatedAt) || null };
    return Array.isArray(d && d.notams) ? d.notams.filter(n => n && n.id) : [];
  };
  try {
    const res = await fetch(NOTAM_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    notams = parse(await res.json());
    return notams;
  } catch (e) {
    try {
      const res2 = await fetch('data/notam.json');
      notams = parse(await res2.json());
    } catch (e2) {
      notams = [];
      notamMeta = { generatedAt: null };
    }
    return notams;
  }
}
// Israel international border arcs (per neighbour), used to geocode prose
// "border buffer" NOTAMs ("FM LEBANON BOUNDARY TO 8KM SB") that carry no
// coordinates. The source NOTAM defines the area verbally against a national
// border, so we trace the border ourselves and offset it inland. Planning
// aid only; not survey-accurate.
async function loadNotamBorders() {
  if (notamBorders !== null) return notamBorders;
  try {
    const res = await fetch('data/notam-borders.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    notamBorders = (d && d.borders) || {};
  } catch (e) {
    console.warn('Failed to load NOTAM borders:', e);
    notamBorders = {};
  }
  return notamBorders;
}
// Build a closed buffer polygon by offsetting a border arc inland (toward the
// Israel interior) by km. Mirrors the offset fpl.co.il applies server-side.
const NOTAM_BORDER_INTERIOR = [31.4, 34.9];     // reference point inside Israel
const NOTAM_BORDER_SIMPLIFY_KM = 1.5;           // follow the border closely; small enough that the inland offset rarely self-folds
function notamKmBetween(p, q) {
  const latr = (p[0] + q[0]) / 2 * Math.PI / 180;
  return Math.hypot((q[0] - p[0]) * 110.57, (q[1] - p[1]) * 111.32 * Math.cos(latr));
}
function notamPerpKm(p, a, b) {                  // point→segment distance in km
  const kx = 111.32 * Math.cos(p[0] * Math.PI / 180), ky = 110.57;
  const ax = a[1] * kx, ay = a[0] * ky, bx = b[1] * kx, by = b[0] * ky, px = p[1] * kx, py = p[0] * ky;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// Ramer–Douglas–Peucker: a 6–8km buffer offset on a noisy border self-folds at
// every sub-buffer wiggle. Simplifying the arc first keeps the shape but removes
// the kinks that produce spikes.
function notamSimplify(pts, tolKm) {
  if (pts.length < 3) return pts.slice();
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = notamPerpKm(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > tolKm) {
    const l = notamSimplify(pts.slice(0, idx + 1), tolKm);
    const r = notamSimplify(pts.slice(idx), tolKm);
    return l.slice(0, -1).concat(r);
  }
  return [pts[0], pts[pts.length - 1]];
}
function notamBorderBuffer(arc, km) {
  if (!Array.isArray(arc) || arc.length < 2 || !(km > 0)) return null;
  // Drop near-duplicate vertices (zero-length tangents), then simplify.
  const dedup = [arc[0]];
  for (let i = 1; i < arc.length; i++) if (notamKmBetween(dedup[dedup.length - 1], arc[i]) > 0.05) dedup.push(arc[i]);
  arc = notamSimplify(dedup, NOTAM_BORDER_SIMPLIFY_KM);
  if (arc.length < 2) return null;
  // Unit normals with CONSISTENT handedness (left of travel). Deciding inland
  // per-vertex against a far reference flips the side on wiggly borders and
  // self-intersects; instead pick one global side for the whole arc.
  const norm = [];
  let vote = 0;
  for (let i = 0; i < arc.length; i++) {
    const la = arc[i][0], ln = arc[i][1];
    const a = arc[Math.max(0, i - 1)], b = arc[Math.min(arc.length - 1, i + 1)];
    const cosl = Math.cos(la * Math.PI / 180) || 1e-6;
    const tlat = b[0] - a[0], tlng = (b[1] - a[1]) * cosl;
    const L = Math.hypot(tlat, tlng) || 1;
    const nlat = -tlng / L, nlng = tlat / L;     // rotate tangent +90° (fixed handedness)
    norm.push([nlat, nlng, cosl]);
    // accumulate which side points inland (toward the interior reference)
    vote += nlat * (NOTAM_BORDER_INTERIOR[0] - la) + nlng * (NOTAM_BORDER_INTERIOR[1] - ln) * cosl;
  }
  const s = vote >= 0 ? 1 : -1;                   // single inland side for the arc
  const off = [];
  for (let i = 0; i < arc.length; i++) {
    const [nlat, nlng, cosl] = norm[i];
    const dlat = km / 110.57, dlng = km / (111.32 * cosl);
    off.push([arc[i][0] + s * nlat * dlat, arc[i][1] + s * nlng * dlng]);
  }
  const ring = arc.concat(off.reverse());
  ring.push(arc[0]);
  return ring;
}
// Parse a prose border NOTAM → buffer polygon. Matches e.g.
// "FM LEBANON BOUNDRAY TO 8KM SB" (BOUNDRAY is the source's spelling).
const NOTAM_BORDER_RE = /\b(LEBANON|SYRIA|EGYPT|JORDAN)\b\s+BOUND\w*\s+TO\s+(\d+(?:\.\d+)?)\s*KM/i;
function notamBorderArea(n) {
  if (!n || n.geom || !notamBorders) return null;
  const m = NOTAM_BORDER_RE.exec(String(n.text || ''));
  if (!m) return null;
  const arcs = notamBorders[m[1].toUpperCase()];
  if (!Array.isArray(arcs) || !arcs.length) return null;
  // Largest arc covers the main border stretch (some borders are split by
  // the West Bank / Dead Sea into several arcs).
  let arc = arcs[0];
  for (const a of arcs) if (a.length > arc.length) arc = a;
  const ring = notamBorderBuffer(arc, parseFloat(m[2]));
  return ring ? { type: 'polygon', coords: ring, _border: m[1].toUpperCase() } : null;
}
function buildNotamBorderAreas() {
  if (!Array.isArray(notams) || !notamBorders) return;
  for (const n of notams) {
    if (!n || n.geom) continue;
    const g = notamBorderArea(n);
    if (g) n.geom = g;
  }
}
async function loadSigmets(force) {
  if (sigmets !== null && !force) return sigmets;
  const parse = d => {
    const list = Array.isArray(d && d.sigmets) ? d.sigmets : [];
    sigmetMeta = { generatedAt: (d && d.generatedAt) || null };
    return list.filter(s => s && Array.isArray(s.coords));
  };
  try {
    const res = await fetch(SIGMET_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    sigmets = parse(await res.json());
    return sigmets;
  } catch (e) {
    try {
      const res2 = await fetch('data/sigmet.json');
      sigmets = parse(await res2.json());
    } catch (e2) {
      console.warn('Failed to load SIGMETs:', e, e2);
      sigmets = [];
      sigmetMeta = { generatedAt: null };
    }
    return sigmets;
  }
}
function drawSigmets() {
  octx.save();
  for (const s of sigmets) {
    const pts = (s.coords || [])
      .filter(c => Array.isArray(c) && c.length === 2 &&
                   Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map(c => proj({ lat: c[0], lng: c[1] }));
    if (pts.length < 3) continue;
    const col = sigmetHazardColor(s.hazard);
    octx.beginPath();
    octx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
    octx.closePath();
    octx.fillStyle = colorWithAlpha(col, tune('sigmetFillAlpha'));
    octx.fill();
    octx.setLineDash([tune('sigmetDashOnPx'), tune('sigmetDashOffPx')]);
    octx.lineWidth = tune('sigmetLineWidthPx');
    octx.strokeStyle = col;
    octx.stroke();
    octx.setLineDash([]);
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    const label = (String(s.hazard || '') +
                   (s.qualifier ? ' ' + s.qualifier : '')).trim();
    if (label) {
      octx.font = 'bold ' + tune('sigmetLabelFontPx') + 'px sans-serif';
      octx.textAlign = 'center';
      octx.lineWidth = 3;
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), 0.9);
      octx.strokeText(label, cx, cy);
      octx.fillStyle = col;
      octx.fillText(label, cx, cy);
    }
  }
  octx.textAlign = 'left';
  octx.restore();
}

// A ring of lat/lng points approximating a circle of radius `nm` around a
// centre — lets a point+radius NOTAM draw with the same polygon path as an
// area NOTAM.
function notamCirclePoints(lat, lng, nm, steps = 36) {
  const dLat = nm / 60;                          // 1 NM ≈ 1/60°
  const dLng = nm / 60 / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const out = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lat + dLat * Math.cos(a), lng + dLng * Math.sin(a)]);
  }
  return out;
}

// NOTAM areas: filled, dashed-outline polygons (point+radius → ring) with the
// NOTAM id labelled at the centroid. Free-text / FIR-wide NOTAMs without
// geometry are not drawn here — they live in the NOTAM list modal.
// A NOTAM is "active" within the displayed window if it hasn't expired (PERM /
// blank end = open-ended) and has already started. Used to filter the map +
// list so expired/future NOTAMs don't clutter.
function notamActive(n, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const ms = s => { const d = Date.parse(s); return Number.isFinite(d) ? d : NaN; };
  const end = n && n.end;
  if (end && !/PERM/i.test(end)) { const e = ms(end); if (Number.isFinite(e) && e < t) return false; }
  const start = n && n.start;
  if (start) { const s = ms(start); if (Number.isFinite(s) && s > t) return false; }
  return true;
}
function activeNotams() {
  // The timeline slider scrubs a look-ahead time; null = live "now".
  const now = Number.isFinite(window.notamViewTime) ? window.notamViewTime : Date.now();
  return Array.isArray(notams) ? notams.filter(n => notamActive(n, now)) : [];
}
// Resolve a NOTAM fix name (CVFR reporting point / airfield / VOR) → coords.
// Route-closure NOTAMs name fixes ("BTN NEGEV-HOVAV") instead of giving
// coordinates, so we look each one up in our own databases to draw a line.
function notamResolveFix(name) {
  const k = String(name || '').toUpperCase();
  if (!k) return null;
  if (Array.isArray(navWP)) {
    const w = navWP.find(p => String(p.name).toUpperCase() === k);
    if (w && Number.isFinite(w.lat) && Number.isFinite(w.lng)) return [w.lat, w.lng];
  }
  if (Array.isArray(airfields)) {
    const a = airfields.find(p => String(p.name).toUpperCase() === k);
    if (a && Number.isFinite(a.lat) && Number.isFinite(a.lng)) return [a.lat, a.lng];
  }
  if (Array.isArray(vors)) {
    const v = vors.find(p => String(p.ident).toUpperCase() === k);
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lng)) return [v.lat, v.lng];
  }
  return null;
}
// Parse route-closure / reroute lines out of a NOTAM's text. Fix chains are
// runs of name tokens joined by '-' (≥2 fixes). Chains before a DIVERTED/REROUTE
// marker are closures (only when the NOTAM says CLSD — availability/limit NOTAMs
// name routes too but aren't closed); chains after it are diversions. A chain is
// drawn only if ≥2 of its fixes resolve in our databases (IFR airway fixes that
// we don't carry are skipped). Result cached on n._routeLines.
const NOTAM_FIX_CHAIN = /\b([A-Z][A-Z0-9]{2,4}(?:-[A-Z][A-Z0-9]{2,4})+)\b/g;
function notamRouteLines(n) {
  if (!n || n._routeLines) return n && n._routeLines || [];
  n._routeLines = [];
  const txt = String(n.text || '');
  if (!/\bRTE\b|\bROUTE\b|\bAWY\b|\bAIRWAY\b/.test(txt)) return n._routeLines;
  const closed = /\bCLSD\b|\bCLOSED\b/.test(txt);
  const divIdx = txt.search(/DIVERT|RE-?ROUTE/i);
  let m;
  NOTAM_FIX_CHAIN.lastIndex = 0;
  while ((m = NOTAM_FIX_CHAIN.exec(txt))) {
    const diverted = divIdx >= 0 && m.index >= divIdx;
    if (!diverted && !closed) continue;            // availability/limit-only → no line
    const coords = m[1].split('-').map(notamResolveFix).filter(Boolean);
    if (coords.length >= 2) n._routeLines.push({ coords, kind: diverted ? 'diverted' : 'closed' });
  }
  return n._routeLines;
}
// Build route lines for all loaded NOTAMs (call once fix databases are ready).
function buildNotamRouteLines() {
  if (!Array.isArray(notams)) return;
  for (const n of notams) { if (n) { n._routeLines = null; notamRouteLines(n); } }
}
// --- NOTAM "flash" (blink a single NOTAM on the map) --------------------
// Clicking a NOTAM in the list pulses its area/line/airport badge for a couple
// of seconds so the eye can find it. State lives here; drawNotams reads it.
let notamFlashId = null, notamFlashStart = 0, notamFlashRAF = 0;
const NOTAM_FLASH_MS = 2600;
// Pulse alpha 0..1 for the currently flashing NOTAM, or 0 when idle.
function notamFlashPulse() {
  if (!notamFlashId) return 0;
  const t = performance.now() - notamFlashStart;
  return 0.35 + 0.65 * Math.abs(Math.sin(t / 170));
}
// Does a NOTAM have anything to show on the map (area / route line / a known
// Find an airfield by ICAO, case-insensitively — the NOTAM modal normalises
// icao with toUpperCase(), so the map side must too or the list/map disagree.
function airfieldByIcao(code) {
  const u = String(code || '').toUpperCase();
  if (!u || !Array.isArray(airfields)) return null;
  return airfields.find(a => String(a.name || '').toUpperCase() === u) || null;
}
// airport for its ICAO)? FIR-wide (LLLL) ones don't.
function notamMappable(n) {
  if (!n) return false;
  if (n.geom) return true;
  if (Array.isArray(n._routeLines) && n._routeLines.length) return true;
  if (n.icao && Array.isArray(airfields)) {
    const af = airfieldByIcao(n.icao);
    if (af && Number.isFinite(af.lat) && Number.isFinite(af.lng)) return true;
  }
  return false;
}
// Collect a NOTAM's map points (polygon/line/circle perimeter, route lines, or
// its airport) so the view can be framed on it.
function notamLatLngs(n) {
  const out = [];
  const push = (lat, lng) => { if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]); };
  const g = n && n.geom;
  if (g && g.type === 'polygon' && Array.isArray(g.coords)) g.coords.forEach(c => push(c[0], c[1]));
  else if (g && g.type === 'line' && Array.isArray(g.coords)) g.coords.forEach(c => push(c[0], c[1]));
  else if (g && g.type === 'circle' && Number.isFinite(g.lat) && Number.isFinite(g.lng) &&
           Number.isFinite(g.radiusNm)) notamCirclePoints(g.lat, g.lng, g.radiusNm).forEach(c => push(c[0], c[1]));
  if (Array.isArray(n && n._routeLines)) n._routeLines.forEach(rl => (rl.coords || []).forEach(c => push(c[0], c[1])));
  if (!out.length && n && n.icao && Array.isArray(airfields)) {
    const af = airfieldByIcao(n.icao);
    if (af) push(af.lat, af.lng);
  }
  return out;
}
function flashNotam(id) {
  if (!id) return;
  // Only flash a NOTAM that's currently drawn (active at the timeline position).
  // drawNotams iterates activeNotams(), so flashing an inactive one would pan
  // the map and spin the redraw loop with nothing to pulse.
  const act = (typeof activeNotams === 'function') ? activeNotams()
    : (Array.isArray(notams) ? notams : []);
  const n = act.find(x => x && x.id === id);
  if (!n) return;
  // Frame the map on the NOTAM so the highlight is actually in view.
  const pts = notamLatLngs(n);
  if (typeof map !== 'undefined' && map && pts.length) {
    if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 10), { animate: true });
    else map.fitBounds(L.latLngBounds(pts), { padding: [80, 80], maxZoom: 11, animate: true });
  }
  notamFlashId = id;
  notamFlashStart = performance.now();
  if (notamFlashRAF) cancelAnimationFrame(notamFlashRAF);
  const step = () => {
    draw();
    if (performance.now() - notamFlashStart < NOTAM_FLASH_MS) {
      notamFlashRAF = requestAnimationFrame(step);
    } else {
      notamFlashId = null; notamFlashRAF = 0; draw();
    }
  };
  notamFlashRAF = requestAnimationFrame(step);
}
window.flashNotam = flashNotam;
window.notamMappable = notamMappable;
function drawNotams() {
  octx.save();
  const col = tune('notamColor');
  const divCol = tune('notamDivertColor');
  const flashId = notamFlashId;
  const flashPulse = notamFlashPulse();
  const flashCol = '#ffd400';
  for (const n of activeNotams()) {
    // Resolved route lines (named-fix closures / diversions). Closed = solid
    // NOTAM colour; diverted = dashed divert colour, drawn distinctly.
    const rls = (n && Array.isArray(n._routeLines)) ? n._routeLines : [];
    for (const rl of rls) {
      const lp = rl.coords
        .filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(c => proj({ lat: c[0], lng: c[1] }));
      if (lp.length < 2) continue;
      octx.beginPath();
      octx.moveTo(lp[0].x, lp[0].y);
      for (let i = 1; i < lp.length; i++) octx.lineTo(lp[i].x, lp[i].y);
      if (rl.kind === 'diverted') {
        octx.setLineDash([4, 6]); octx.strokeStyle = divCol;
        octx.lineWidth = tune('notamLineWidthPx');
      } else {
        octx.setLineDash([]); octx.strokeStyle = col;
        octx.lineWidth = tune('notamRouteWidthPx');
      }
      octx.lineJoin = 'round'; octx.lineCap = 'round';
      octx.stroke();
      octx.setLineDash([]);
      if (flashId && n.id === flashId) {
        octx.lineWidth = tune('notamRouteWidthPx') + 5;
        octx.strokeStyle = colorWithAlpha(flashCol, flashPulse);
        octx.stroke();
      }
      if (n.id) {
        const mid = lp[Math.floor(lp.length / 2)];
        octx.font = 'bold 11px sans-serif';
        octx.textAlign = 'center';
        octx.lineWidth = 3;
        octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), 0.9);
        octx.strokeText(n.id, mid.x, mid.y - 6);
        octx.fillStyle = rl.kind === 'diverted' ? divCol : col;
        octx.fillText(n.id, mid.x, mid.y - 6);
      }
    }
    const g = n && n.geom;
    // Route closures (FAA LineString) → a thick dashed polyline, not a fill.
    if (g && g.type === 'line' && Array.isArray(g.coords)) {
      const lp = g.coords.filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(c => proj({ lat: c[0], lng: c[1] }));
      if (lp.length < 2) continue;
      octx.beginPath();
      octx.moveTo(lp[0].x, lp[0].y);
      for (let i = 1; i < lp.length; i++) octx.lineTo(lp[i].x, lp[i].y);
      octx.setLineDash([10, 5]);
      octx.lineWidth = tune('notamLineWidthPx') + 1;
      octx.strokeStyle = col;
      octx.stroke();
      octx.setLineDash([]);
      if (flashId && n.id === flashId) {
        octx.lineWidth = tune('notamLineWidthPx') + 5;
        octx.strokeStyle = colorWithAlpha(flashCol, flashPulse);
        octx.stroke();
      }
      continue;
    }
    let ll = null;
    if (g && g.type === 'polygon' && Array.isArray(g.coords)) ll = g.coords;
    else if (g && g.type === 'circle' && Number.isFinite(g.lat) && Number.isFinite(g.lng) &&
             Number.isFinite(g.radiusNm)) ll = notamCirclePoints(g.lat, g.lng, g.radiusNm);
    if (!ll) continue;
    const pts = ll
      .filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map(c => proj({ lat: c[0], lng: c[1] }));
    if (pts.length < 3) continue;
    octx.beginPath();
    octx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
    octx.closePath();
    octx.fillStyle = colorWithAlpha(col, tune('notamFillAlpha'));
    octx.fill();
    // Border-buffer areas (FM <NEIGHBOUR> BOUNDARY TO NKM) trace the
    // international border, so draw their outline as a continuous solid line;
    // ordinary point/area NOTAMs keep the dashed outline.
    if (!(g && g._border)) octx.setLineDash([6, 4]);
    octx.lineWidth = tune('notamLineWidthPx');
    octx.strokeStyle = col;
    octx.stroke();
    octx.setLineDash([]);
    if (flashId && n.id === flashId) {
      octx.lineWidth = tune('notamLineWidthPx') + 5;
      octx.strokeStyle = colorWithAlpha(flashCol, flashPulse);
      octx.stroke();
    }
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    if (n.id) {
      octx.font = 'bold 11px sans-serif';
      octx.textAlign = 'center';
      octx.lineWidth = 3;
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), 0.9);
      octx.strokeText(n.id, cx, cy);
      octx.fillStyle = col;
      octx.fillText(n.id, cx, cy);
    }
  }
  octx.textAlign = 'left';
  octx.restore();
  // Airport count badges are drawn separately (after waypoints) so a route
  // waypoint sitting on the field doesn't hide / block them — see draw().
}

// Most NOTAMs carry no coordinates (airport-procedural / FIR-wide) — the source
// gives none. For ones tied to a known airport, drop a count badge at the field
// so they're visible on the map; the full text is in the NOTAM list.
function drawNotamAirportMarkers() {
  if (!Array.isArray(airfields) || !airfields.length) return;
  const byIcao = {};
  for (const n of activeNotams()) {
    if (n && n.geom) continue;                 // already drawn as an area
    if (n && Array.isArray(n._routeLines) && n._routeLines.length) continue;  // drawn as a route line
    const c = n && n.icao;
    if (!c) continue;
    (byIcao[c] = byIcao[c] || []).push(n);
  }
  const col = tune('notamColor');
  const flashId = notamFlashId;
  const flashPulse = notamFlashPulse();
  for (const code in byIcao) {
    const af = airfieldByIcao(code);
    if (!af || !Number.isFinite(af.lat) || !Number.isFinite(af.lng)) continue;   // FIR (LLLL) etc. → list only
    const p = proj({ lat: af.lat, lng: af.lng });
    if (flashId && byIcao[code].some(n => n.id === flashId)) {
      octx.beginPath();
      octx.arc(p.x, p.y + 14, 15, 0, 2 * Math.PI);   // pulsing halo around the badge
      octx.lineWidth = 4;
      octx.strokeStyle = colorWithAlpha('#ffd400', flashPulse);
      octx.stroke();
    }
    octx.beginPath();
    octx.arc(p.x, p.y + 14, 9, 0, 2 * Math.PI);    // offset below the field marker
    octx.fillStyle = colorWithAlpha(col, 0.92);
    octx.fill();
    octx.lineWidth = 1.5;
    octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), 0.9);
    octx.stroke();
    octx.fillStyle = '#fff';
    octx.font = 'bold 11px sans-serif';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(String(byIcao[code].length), p.x, p.y + 14);
    octx.textBaseline = 'alphabetic';
  }
  octx.textAlign = 'left';
}

// Hit-test a map click against drawn NOTAMs, so areas/lines/badges open their
// text (#959 follow-up: "notam on map should be clickable to view its info").
// All tests run in canvas/screen space via proj(), matching how drawNotams()
// renders, so what you see is what you can click.
function notamPointInPoly(pt, poly) {       // poly: [{x,y}], ray-cast
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function notamDistToSeg(p, a, b) {           // point→segment distance (px)
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function notamsAtLatLng(latlng) {
  if (!window.showNotam || !latlng) return [];
  const act = (typeof activeNotams === 'function') ? activeNotams() : [];
  if (!act.length) return [];
  const pt = proj(latlng);
  const out = [];
  for (const n of act) {
    // Resolved route lines (closed/diverted) — near any segment counts.
    const rls = (n && Array.isArray(n._routeLines)) ? n._routeLines : [];
    let routeHit = false;
    for (const rl of rls) {
      const lp = rl.coords
        .filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(c => proj({ lat: c[0], lng: c[1] }));
      for (let i = 1; i < lp.length; i++) {
        if (notamDistToSeg(pt, lp[i - 1], lp[i]) <= 6) { routeHit = true; break; }
      }
      if (routeHit) break;
    }
    if (routeHit) { out.push(n); continue; }
    const g = n && n.geom;
    if (g && g.type === 'line' && Array.isArray(g.coords)) {
      const lp = g.coords
        .filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(c => proj({ lat: c[0], lng: c[1] }));
      for (let i = 1; i < lp.length; i++) {
        if (notamDistToSeg(pt, lp[i - 1], lp[i]) <= 6) { out.push(n); break; }
      }
      continue;
    }
    let ll = null;
    if (g && g.type === 'polygon' && Array.isArray(g.coords)) ll = g.coords;
    else if (g && g.type === 'circle' && Number.isFinite(g.lat) && Number.isFinite(g.lng) &&
             Number.isFinite(g.radiusNm)) ll = notamCirclePoints(g.lat, g.lng, g.radiusNm);
    if (!ll) continue;
    const pts = ll
      .filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map(c => proj({ lat: c[0], lng: c[1] }));
    if (pts.length >= 3 && notamPointInPoly(pt, pts)) out.push(n);
  }
  // Airport count badges (no-geom NOTAMs grouped by ICAO) — see
  // drawNotamAirportMarkers(): a r=9 disc at proj(field) offset +14px down.
  if (Array.isArray(airfields) && airfields.length) {
    const byIcao = {};
    for (const n of act) {
      if (n && n.geom) continue;
      if (n && Array.isArray(n._routeLines) && n._routeLines.length) continue;
      const c = n && n.icao;
      if (c) (byIcao[c] = byIcao[c] || []).push(n);
    }
    for (const code in byIcao) {
      const af = airfieldByIcao(code);
      if (!af || !Number.isFinite(af.lat) || !Number.isFinite(af.lng)) continue;
      const p = proj({ lat: af.lat, lng: af.lng });
      if (Math.hypot(pt.x - p.x, pt.y - (p.y + 14)) <= 11) out.push(...byIcao[code]);
    }
  }
  return out;
}

// Just the airport count-badge NOTAMs under a point (the r=11 disc at
// proj(field)+14px). Used to let the badge win a click over a route waypoint
// sitting on the same field, without area NOTAMs stealing waypoint clicks.
function notamBadgeNotamsAt(latlng) {
  if (!window.showNotam || !latlng || !Array.isArray(airfields) || !airfields.length) return [];
  const act = (typeof activeNotams === 'function') ? activeNotams() : [];
  if (!act.length) return [];
  const byIcao = {};
  for (const n of act) {
    if (n && n.geom) continue;
    if (n && Array.isArray(n._routeLines) && n._routeLines.length) continue;
    if (n && n.icao) (byIcao[n.icao] = byIcao[n.icao] || []).push(n);
  }
  const pt = proj(latlng);
  for (const code in byIcao) {
    const af = airfieldByIcao(code);
    if (!af || !Number.isFinite(af.lat) || !Number.isFinite(af.lng)) continue;
    const p = proj({ lat: af.lat, lng: af.lng });
    if (Math.hypot(pt.x - p.x, pt.y - (p.y + 14)) <= 11) return byIcao[code];
  }
  return [];
}
window.notamBadgeNotamsAt = notamBadgeNotamsAt;

// --- nav-waypoint reference overlay ---------------------------------
// Lazy-loads docs/data/cvfr-nav-waypoints.json on first activation. Format:
// { waypoints:[{ name, en, he, lat, lng }] } — 172 published reporting
// points sourced from the IAA CVFR chart page 113 (2025 edition); see
// issue #406. Validated strictly by validateNavWaypoints() (issue
// #101): every documented field must be present and well-typed;
// extras are silently allowed for forward-compat.
// --- per-layer dataset resolution ----------------------------------
// Each base layer can have its own data files (waypoints, comm-change, …).
// Naming: <prefix>-<kind>.json. Prefix by layer: 'Low Alt' -> lsa,
// 'Heli' -> heli, everything else -> cvfr. A layer without its own file for
// a given kind falls back to the cvfr file (see fetchLayerData).
function currentLayerName() {
  if (typeof layers === 'undefined' || typeof map === 'undefined') return '';
  for (const k in layers) if (map.hasLayer(layers[k])) return k;
  return '';
}
// Bumped by reloadLayerDatasets() on every base-layer switch. Each per-layer
// loader captures this at call time and re-checks it before committing its
// result — a fetch that resolves after a *later* layer switch has started is
// stale and must not overwrite state for the now-active layer.
var _layerGen = 0;
// Single authoritative prefix<->layer table; layerDataPrefix() derives the
// reverse direction from it rather than keeping a second hand-maintained
// inverse map that could drift. Layers not named here (Navigation /
// Satellite / OSM) share the CVFR datasets.
const _PREFIX_LAYER_NAME = { cvfr: 'CVFR', lsa: 'Low Alt', heli: 'Helicopters' };
function layerDataPrefix() {
  const l = currentLayerName();
  for (const p in _PREFIX_LAYER_NAME) {
    if (_PREFIX_LAYER_NAME[p] === l) return p;
  }
  return 'cvfr';   // Navigation / Satellite / OSM share the CVFR datasets
}
// Display label for a data-prefix ('cvfr'/'lsa'/'heli'), reusing the already
// -translated S.layerLabels dict (keyed by full layer name) instead of a
// second hand-written map that would need its own translations kept in sync.
function layerLabelForPrefix(pfx) {
  const layerName = _PREFIX_LAYER_NAME[pfx] || pfx;
  return (S.layerLabels && S.layerLabels[layerName]) || layerName;
}
// Map a data kind to its canonical cvfr URL (carries the ?v cache-bust).
const _CVFR_DATA_URL = {
  'nav-waypoints': () => S.navWpUrl,
  'comm-change': () => S.commChangeUrl,
  'leg-altitude': () => S.legAltitudeUrl,
  // No cvfr-areas.json exists (areas are lsa/heli-only) — this entry is only a
  // version carrier: _verOf() reads its ?v= to cache-bust data/<layer>-areas.json.
  // Bump ?v= whenever an *-areas.json changes. The cvfr fallback fetch never
  // runs (loadAreas skips the network on the cvfr prefix).
  'areas': () => 'data/cvfr-areas.json?v=5',
  // route-templates is a single shared file; templates self-tag with a `layer`.
};
function _verOf(url) { const m = /\?v=([^&]+)/.exec(url || ''); return m ? m[1] : '1'; }
// Fetch the active layer's file for `kind`; if that layer has no such file
// (HTTP not-ok / network error), fall back to the cvfr file. Returns
// { data, prefix } where prefix is the source actually used.
//
// Staleness is generation-based and lives entirely here: the settle handler
// re-checks _layerGen after the whole chain (fetch AND body parse — a switch
// during r.json() is caught too) and re-dispatches for the now-active layer.
// Unlike the earlier prefix comparison this also catches alias switches
// (Navigation→CVFR keeps prefix 'cvfr' but bumps the generation) and
// A→B→A round trips. Callers therefore always settle with data current for
// the active layer; the loaders' own gen re-enter is only a no-stomp guard
// for their global commit, not a second fetch (it joins via the memo).
//
// The memo keeps one network chain per (kind, generation): a superseded
// call's retry JOINS the new generation's in-flight fetch instead of racing
// it with a duplicate request.
const _layerFetchMemo = {};   // kind -> { gen, promise }
function fetchLayerData(kind) {
  const memo = _layerFetchMemo[kind];
  if (memo && memo.gen === _layerGen) return memo.promise;
  const gen = _layerGen;
  const settle = pass => res => {
    if (_layerFetchMemo[kind] && _layerFetchMemo[kind].promise === promise) {
      delete _layerFetchMemo[kind];
    }
    if (gen !== _layerGen) return fetchLayerData(kind);   // superseded — retry
    if (!pass) throw res;
    return res;
  };
  const promise = _fetchLayerDataRaw(kind).then(settle(true), settle(false));
  _layerFetchMemo[kind] = { gen, promise };
  return promise;
}
async function _fetchLayerDataRaw(kind) {
  const cvfrUrl = (_CVFR_DATA_URL[kind] || (() => 'data/cvfr-' + kind + '.json'))();
  const v = _verOf(cvfrUrl);
  const pfx = layerDataPrefix();
  if (pfx !== 'cvfr') {
    try {
      const r = await fetch('data/' + pfx + '-' + kind + '.json?v=' + v);
      if (r.ok) return { data: await r.json(), prefix: pfx };
    } catch (e) { /* fall through to cvfr */ }
  }
  const r = await fetch(cvfrUrl);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return { data: await r.json(), prefix: 'cvfr' };
}

async function loadNavWaypoints() {
  if (navWP !== null) return navWP;
  const gen = _layerGen;
  try {
    const { data: d, prefix } = await fetchLayerData('nav-waypoints');
    // Strict schema check only for the canonical CVFR dataset; layer datasets
    // (lsa/heli) use the looser { points:[…] } shape.
    if (prefix === 'cvfr') {
      const verr = validateNavWaypoints(d);
      if (verr) {
        console.warn('nav-waypoints schema error:', verr);
        alert(S.errInvalidNavWaypoints(verr));
        return [];
      }
    }
    const arr = Array.isArray(d) ? d : (d.waypoints || d.points || []);
    const mapped = arr
      .filter(w => w && Number.isFinite(w.lat) && Number.isFinite(w.lng))
      .map(w => ({
        name: w.name || '',
        en: w.en || w.name || '',         // English label (name stays canonical code)
        he: w.he || '',                   // Hebrew label
        lat: w.lat,
        lng: w.lng,
        report: w.report || '',           // 'mandatory' | 'onRequest' | 'optional'
      }));
    if (prefix !== 'cvfr') {
      // No strict validator on this path — still surface the two defects
      // that would otherwise silently collide points in name-keyed lookups
      // (e.g. reportingFor()'s _reportIndex).
      const blank = mapped.filter(w => !w.name).length;
      const seen = new Set(); const dupes = new Set();
      for (const w of mapped) { if (w.name) { if (seen.has(w.name)) dupes.add(w.name); seen.add(w.name); } }
      if (blank || dupes.size) {
        console.warn('nav-waypoints (' + prefix + '): ' + blank + ' point(s) with a blank name, ' +
          dupes.size + ' duplicate name(s): ' + [...dupes].join(', '));
      }
    }
    // Superseded by a newer layer switch: don't stomp the new generation's
    // committed value — re-enter, which either returns it (memo-check above)
    // or joins the new generation's in-flight fetch (fetchLayerData memo),
    // so no duplicate request is issued.
    if (gen !== _layerGen) return loadNavWaypoints();
    navWP = mapped;
    return navWP;
  } catch (e) {
    // Leave navWP === null so a subsequent toggle / search / snap call can
    // retry — assigning [] would make the early-return guard short-circuit
    // forever and disable nav waypoints for the whole session (issue #72).
    console.warn('Failed to load nav waypoints:', e);
    return [];
  }
}

// LSA airspace areas ("bubbles") overlay — filled rings drawn under the
// waypoints. Layer-aware via fetchLayerData('areas'): the Low Alt layer has
// data/lsa-areas.json; layers without an areas file simply draw nothing.
var areas = null;            // null = not loaded; [] or populated = loaded
async function loadAreas() {
  if (areas !== null) return areas;
  const gen = _layerGen;
  // No cvfr-areas.json exists (areas are an lsa/heli-only overlay), so on the
  // cvfr-prefixed layers (CVFR/Navigation/Satellite/OSM) skip the network call
  // to avoid a guaranteed-404 (the 'areas' _CVFR_DATA_URL entry is only a
  // cache-bust version carrier, never actually fetched).
  if (layerDataPrefix() === 'cvfr') {
    areas = [];
    if (typeof refreshLsaListBtn === 'function') refreshLsaListBtn();
    return areas;
  }
  try {
    const { data: d } = await fetchLayerData('areas');
    const arr = Array.isArray(d) ? d : (d.areas || []);
    const mapped = arr
      .filter(a => a && Array.isArray(a.coords) && a.coords.length >= 3)
      // `active`: 'weekend' bubbles are only in force on the Israel weekend
      // (Fri–Sat); everything else defaults to 'always'. Field is optional in
      // the data — absent means 'always'.
      .map(a => ({ coords: a.coords, name: a.name || '', en: a.en || '', he: a.he || '',
        active: a.active === 'weekend' ? 'weekend' : 'always' }));
    if (gen !== _layerGen) return loadAreas();   // superseded — don't stomp; re-enter (joins via memo)
    areas = mapped;
  } catch (e) {
    if (gen === _layerGen) areas = [];      // no areas file for this layer (or fetch failed)
  }
  if (areas && areas.length) scheduleDraw();
  if (typeof refreshLsaListBtn === 'function') refreshLsaListBtn();
  return areas;
}
// Localized display name for an LSA bubble (Hebrew label on the he layer, else
// English/base). Empty when the bubble is unnamed.
function areaLabel(a) {
  if (!a) return '';
  const heFirst = (typeof S !== 'undefined' && S.airfieldLabelField === 'he');
  return (heFirst ? (a.he || a.name || a.en) : (a.en || a.name || a.he)) || '';
}
// Polygon centroid (area-weighted) for label placement; falls back to the
// vertex average for degenerate rings.
function areaCentroid(coords) {
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0, n = coords.length; i < n; i++) {
    const [y0, x0] = coords[i], [y1, x1] = coords[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    a2 += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  if (Math.abs(a2) < 1e-9) {
    const s = coords.reduce((p, c) => [p[0] + c[0], p[1] + c[1]], [0, 0]);
    return { lat: s[0] / coords.length, lng: s[1] / coords.length };
  }
  return { lat: cy / (3 * a2), lng: cx / (3 * a2) };
}
function drawAreas() {
  if (!showLsaBubbles) return;                    // "Show LSA bubbles" toggle (Extra layers)
  if (areas === null) { loadAreas(); return; }   // lazy-load on first draw
  if (!areas.length) return;
  octx.save();
  octx.setLineDash([]);                 // official legend uses solid outlines for both types
  for (const a of areas) {              // paint state (fill/stroke/width) is set per-polygon below
    octx.beginPath();
    for (let i = 0; i < a.coords.length; i++) {
      const s = proj({ lat: a.coords[i][0], lng: a.coords[i][1] });
      if (i === 0) octx.moveTo(s.x, s.y); else octx.lineTo(s.x, s.y);
    }
    octx.closePath();
    const hl = a === window.__lsaHighlight;   // chart "locate" highlight
    const wknd = a.active === 'weekend';
    // Official legend colours: always = green outline + pale-green fill (in force
    // every day); weekend = black outline + tan fill (Fri–Sat only). The locate
    // highlight overrides both with amber.
    octx.fillStyle = hl ? 'rgba(255,204,51,0.22)' : (wknd ? 'rgba(201,178,138,0.35)' : 'rgba(60,160,60,0.15)');
    octx.strokeStyle = hl ? '#ffcc33' : (wknd ? '#2b2b2b' : '#3c8f3c');
    octx.lineWidth = hl ? tune('lsaHighlightWidthPx') : tune('lsaLineWidthPx');
    octx.fill();
    octx.stroke();
  }
  // Names, at each bubble's centroid (zoomed in enough to be readable).
  const showLabels = map.getZoom() >= (typeof tune === 'function' ? tune('vorLabelMinZoom') : 8);
  if (showLabels) {
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.font = 'bold ' + (typeof tune === 'function' ? tune('vorLabelFontPx') : 12) + 'px sans-serif';
    for (const a of areas) {
      const nm = areaLabel(a);
      if (!nm) continue;
      const s = proj(areaCentroid(a.coords));
      octx.lineWidth = 2.5;
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
      octx.strokeText(nm, s.x, s.y);
      octx.fillStyle = '#222';                       // neutral: reads over green + tan fills
      octx.fillText(nm, s.x, s.y);
    }
  }
  octx.restore();
}

// Lazy-loads docs/data/cvfr-comm-change.json — { callSigns:{...},
// points:[{name, commChange, callSigns, routeHints, note, source}] }.
// Builds an O(1) map keyed by ICAO `name` for the nav-waypoint overlay ring
// + inspector badge. On 404 or schema error we install an EMPTY map ({})
// instead of leaving commChangeMap null — the dataset is intentionally
// optional, and a missing file must not disable the rest of the nav-WP
// overlay (issue #399). The map is only rebuilt if a future call observes
// `commChangeMap === null` (i.e. nothing was installed yet), so a one-time
// 404 doesn't trigger retry storms.
async function loadCommChange() {
  if (commChangeMap !== null) return commChangeMap;
  const gen = _layerGen;
  try {
    const { data: d } = await fetchLayerData('comm-change');
    const verr = validateCommChange(d);
    if (verr) {
      console.warn('comm-change schema error:', verr);
      if (gen === _layerGen) { commChangeMap = {}; commChangeCallSigns = {}; }
      return commChangeMap;
    }
    const callSigns = (d.callSigns && typeof d.callSigns === 'object' &&
      !Array.isArray(d.callSigns)) ? d.callSigns : {};
    const m = {};
    for (const pt of d.points) {
      if (pt && pt.name && pt.commChange) m[pt.name] = pt;
    }
    if (gen !== _layerGen) return loadCommChange();   // superseded — don't stomp; re-enter (joins via memo)
    commChangeCallSigns = callSigns;
    commChangeMap = m;
    return commChangeMap;
  } catch (e) {
    console.warn('Failed to load comm-change dataset:', e);
    if (gen === _layerGen) {
      commChangeCallSigns = {};
      commChangeMap = {};                  // graceful degrade — no rings, no retry
    }
    return commChangeMap;
  }
}

// Lazy-loads docs/data/cvfr-leg-altitude.json — { segments:[{from,to,
// inboundAltitude,outboundAltitude,status,oneWay,...}], directionPool:[...] }.
// The app uses it only as a reference table for freshly-created legs;
// saved/imported route JSON stays authoritative for existing leg values.
// The loader itself never touches the route: applying the table to legs is
// applyLegAltitudesToRoute()'s job, and that function gates every apply on
// the route's pinned altitude prefix (routeAltPrefix, see core.js) — so a
// passive layer switch or chart-modal open can never rewrite a route built
// against another layer's table, regardless of which call path loaded it.
// Empty-string degrade: on schema error / fetch failure the table becomes {}
// via resetLegAltitudeState so legs keep their defaults without retry storms.
function resetLegAltitudeState(prefix) {
  legAltitudeMap = {};
  legAltitudePointIds = new Set();
  legAltitudeDataset = null;
  legAltitudeOriginMap = null;
  legAltitudeDirectionPool = null;
  legAltitudeMapPrefix = prefix || null;
}
async function loadLegAltitudes() {
  if (legAltitudeMap !== null) return legAltitudeMap;
  const gen = _layerGen;
  try {
    const { data: d, prefix } = await fetchLayerData('leg-altitude');
    const verr = validateLegAltitudes(d);
    if (verr) {
      console.warn('leg-altitude schema error:', verr);
      if (gen === _layerGen) resetLegAltitudeState(prefix);
      return legAltitudeMap;
    }
    const directions = Array.isArray(d.directionPool)
      ? d.directionPool
      : legAltitudeDirectionsFromSegments(d.segments);
    const m = {};
    const ids = new Set();
    for (const segment of d.segments) {
      if (!segment || !segment.from || !segment.to) continue;
      m[legAltitudeKey(segment.from, segment.to)] = {
        from: segment.from,
        to: segment.to,
        distanceNm: segment.distanceNm,
        inboundAltitude: segment.inboundAltitude,
        outboundAltitude: segment.outboundAltitude,
        oneWay: segment.oneWay === true,
        status: segment.status || 'candidate',
      };
      ids.add(segment.from);
      ids.add(segment.to);
    }
    if (gen !== _layerGen) return loadLegAltitudes();   // superseded — don't stomp; re-enter (joins via memo)
    resetLegAltitudeOrigins(d.segments);
    legAltitudeMap = m;
    legAltitudePointIds = ids;
    legAltitudeDataset = d;
    legAltitudeDirectionPool = directions;
    legAltitudeMapPrefix = prefix;
    return legAltitudeMap;
  } catch (e) {
    console.warn('Failed to load leg-altitude dataset:', e);
    if (gen === _layerGen) resetLegAltitudeState(layerDataPrefix());
    return legAltitudeMap;
  }
}

function closestScreenReference(list, kind, latlng, pxThreshold, options = {}) {
  if (!Array.isArray(list) || !list.length || !latlng) return null;
  const t = map.latLngToContainerPoint([latlng.lat, latlng.lng]);
  let bestDist = Number.isFinite(pxThreshold) ? pxThreshold : Infinity;
  let best = null;
  for (const ref of list) {
    if (options.excludeLl && sameMapPoint(ref, options.excludeLl)) continue;
    if (Number.isInteger(options.skipOccupiedRouteIndex) &&
        routeOccupiesPoint(ref, options.skipOccupiedRouteIndex)) continue;
    const p = map.latLngToContainerPoint([ref.lat, ref.lng]);
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d < bestDist) { bestDist = d; best = ref; }
  }
  return best ? { kind, ref: best, dist: bestDist } : null;
}

// Closest nav waypoint within `pxThreshold` screen pixels of `latlng`,
// or null. Returns the {name, lat, lng} entry from the loaded JSON.
function nearestNavWaypoint(latlng, pxThreshold, excludeLl) {
  const hit = closestScreenReference(navWP, 'navwp', latlng, pxThreshold, { excludeLl });
  return hit && hit.ref;
}

// True if `name` matches a known nav waypoint (code, English, or Hebrew) — so we
// treat it as auto-snapped, not user-typed, and may overwrite on drag.
function isNavName(name) {
  if (!name || !navWP) return false;
  for (const wp of navWP) {
    if (wp.name === name || wp.en === name || wp.he === name) return true;
  }
  return false;
}

function canonicalNavWaypointName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (navWP) {
    for (const wp of navWP) {
      if (wp.name === s || wp.en === s || wp.he === s) return wp.name;
    }
  }
  return s;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// True if `name` is the auto sequence label (`WP N`, `WPn`, or locale
// `S.wpPrefix` + digits). Same family as the dimmed inspector / flight-plan
// placeholder — not a user-chosen static name.
function isSequenceWaypointName(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  if (/^wp\s*\d+$/i.test(s)) return true;
  const p = (typeof S !== 'undefined' && S && S.wpPrefix) ? String(S.wpPrefix) : 'WP ';
  const flags = /[^\u0000-\u007f]/.test(p) || /[^\u0000-\u007f]/.test(s) ? 'u' : '';
  if (new RegExp('^' + escapeRegExp(p) + '\\d+$', flags).test(s)) return true;
  const pt = p.trim();
  if (pt && new RegExp('^' + escapeRegExp(pt) + '\\s*\\d+$', flags).test(s)) return true;
  return false;
}

// Clear stored `wp.name` when it is only a sequence placeholder so the UI
// shows the dimmed placeholder (empty value) and snap logic applies.
function normalizeWaypointSequenceName(wp) {
  if (!wp) return;
  const t = String(wp.name || '').trim();
  if (t && isSequenceWaypointName(t)) wp.name = '';
}

// Resolve a stored waypoint name to the current locale. If the stored value
// is a nav-WP name (code or either language), return the locale-appropriate
// version.
// User-typed names are returned as-is.
function navName(stored) {
  if (!stored || !navWP) return stored || '';
  for (const nw of navWP) {
    if (nw.name === stored || nw.en === stored || nw.he === stored)
      return nw[S.navWpSearchField] || nw.en || nw.name;
  }
  return stored;
}

function isAutoSnapName(name) {
  return isAirfieldName(name) || isNavName(name) || isSequenceWaypointName(name);
}

function referenceCode(ref, kind) {
  if (!ref) return '';
  if (kind === 'vor') return ref.ident || ref.name || '';
  return ref.name || ref.ident || '';
}

function currentUiLang() {
  return (window.__navLang === 'he' ||
    (document.documentElement && document.documentElement.lang === 'he')) ? 'he' : 'en';
}

function referenceLocaleName(ref, kind) {
  if (!ref) return '';
  if (kind === 'airfield') {
    return ref[S.airfieldLabelField] || ref.en || ref.he || ref.name || '';
  }
  if (kind === 'vor') {
    return currentUiLang() === 'he'
      ? (ref.he || ref.name || ref.ident || '')
      : (ref.en || ref.name || ref.ident || '');
  }
  return ref[S.navWpSearchField] || ref.en || ref.he || ref.name || '';
}

function codeTitle(code, locale) {
  const c = String(code || '').trim();
  const l = String(locale || '').trim();
  return c + (l && l !== c ? ' / ' + l : '');
}

function referenceInspectorTitle(ref, kind) {
  return codeTitle(referenceCode(ref, kind), referenceLocaleName(ref, kind));
}

function referenceOverlayLabel(ref, kind) {
  const code = referenceCode(ref, kind);
  const locale = referenceLocaleName(ref, kind);
  if (kind === 'airfield') return codeTitle(code, locale);
  return locale || code;
}

function waypointDisplayLabel(wp, idx) {
  const n = navName((wp && wp.name || '').trim());
  return n || (S.wpPrefix + (idx + 1));
}

function nearestReference(latlng, options = {}) {
  const pxThreshold = options.force ? Infinity :
    (Number.isFinite(options.pxThreshold) ? options.pxThreshold : 18);
  const common = {
    excludeLl: options.excludeLl,
    skipOccupiedRouteIndex: options.skipOccupiedRouteIndex,
  };
  const air = options.includeAirfields === false ? null :
    closestScreenReference(airfields, 'airfield', latlng, pxThreshold, common);
  const nav = options.includeNavWaypoints === false ? null :
    closestScreenReference(navWP, 'navwp', latlng, pxThreshold, common);
  if (options.force) {
    return [air, nav].filter(Boolean).sort((a, b) => a.dist - b.dist)[0] || null;
  }
  return air || nav;
}

// Decide where a waypoint should sit + what to call it given a target
// position and its current name. Used by both initial drop and drag.
//  - If the current name is user-typed (non-empty, not an auto-snap or
//    sequence label like "WP 6" / "WP6"):
//    leave the name alone; just move to the target latlng.
//  - Else if an airfield is within 18 px of the target (overlay on):
//    snap lat/lng + adopt its ICAO `name`.
//  - Else if a nav waypoint is within 18 px of the target (overlay on):
//    snap lat/lng + name to that nav waypoint.
//  - Else if the current name was an auto-snap or sequence label (no longer
//    near any):
//    clear it so the circle reverts to the sequence number.
// Airfields take priority because they're a much smaller set of strongly-
// known landmarks (16 vs 172 nav-WPs); if both overlays sit on the same
// spot the airfield name is the more meaningful identifier.
function applyNavSnap(latlng, currentName, excludeLl) {
  const autoSnapped = isAutoSnapName(currentName);
  const userTyped = currentName && !autoSnapped;
  if (!showAirfields && !showNavWP) {
    return { lat: latlng.lat, lng: latlng.lng,
             name: autoSnapped ? '' : (currentName || '') };
  }
  // #106: Force-snap mode lifts the 18 px radius so every click resolves to
  // the absolute nearest known point. Useful when the chart has many close
  // reporting points and the user wants the published coordinate regardless
  // of click precision.
  // #106: force-snap lifts the radius. Airfield-first priority is fine inside
  // the 18 px radius (both rarely sit there together), but at infinite radius
  // it would make the 16-airfield set always win and leave the 172 nav-WPs
  // unreachable. So in force-snap mode pick the globally nearest across both
  // visible sets by screen distance instead of short-circuiting on airfields.
  const snap = nearestReference(latlng, {
    pxThreshold: 18,
    force: !!window.forceSnap,
    includeAirfields: showAirfields,
    includeNavWaypoints: showNavWP,
    excludeLl,
  });
  if (snap && snap.ref) {
    const name = userTyped ? currentName : snap.ref.name;
    return { lat: snap.ref.lat, lng: snap.ref.lng, name, code: snap.ref.name };
  }
  return { lat: latlng.lat, lng: latlng.lng,
           name: autoSnapped ? '' : (currentName || ''), code: '' };
}

// --- airfield reference overlay -------------------------------------
// Lazy-loads docs/data/airfields.json on first activation. Format:
// { airfields:[{ name, he, en, lat, lng, elev_ft, plates:[string] }] } —
// published Israeli airfields with matching BYOP plate filenames. The
// `plates` field is data-only for now; rendering a per-airfield plate
// list is tracked as a follow-up. Validated strictly by
// validateAirfields() (issue #101): every documented field must be
// present and well-typed; extras are silently allowed for forward-compat.
async function loadAirfields() {
  if (airfields !== null) return airfields;
  try {
    const res = await fetch(S.airfieldsUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const verr = validateAirfields(d);
    if (verr) {
      console.warn('airfields schema error:', verr);
      alert(S.errInvalidAirfields(verr));
      return [];
    }
    airfields = d.airfields.map(a => ({
      name: a.name,
      he: a.he,
      en: a.en,
      lat: a.lat,
      lng: a.lng,
      elev_ft: a.elev_ft,
      atis: a.atis,
      clearance: a.clearance,
      plates: Array.isArray(a.plates) ? a.plates.slice() : [],
      runways: Array.isArray(a.runways) ? a.runways.slice() : null,
      circuit_overlay: a.circuit_overlay || null,
      training_overlay: a.training_overlay || null,
      cvfr_overlay: a.cvfr_overlay || null,
      heli_overlay: a.heli_overlay || null,
      commfail_overlay: a.commfail_overlay || null,
    }));
    if (typeof populatePlateAirfieldSelect === 'function') populatePlateAirfieldSelect();
    return airfields;
  } catch (e) {
    // Leave airfields === null so a subsequent toggle / search call can
    // retry — assigning [] would make the early-return guard short-circuit
    // forever and disable the overlay for the whole session (issue #72).
    console.warn('Failed to load airfields:', e);
    return [];
  }
}
// --- VOR/DME stations (issue #404 follow-up) ------------------------
// Lazy-loads docs/data/vor.json: { vors:[{ ident, name, he?, freq, lat, lng }] }.
// Used by the overlay markers, the selectable reference for radial/DME
// readouts, and (later) the flight-plan radial/DME columns.
async function loadVors() {
  if (vors !== null) return vors;
  try {
    const res = await fetch(S.vorUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const verr = typeof validateVors === 'function' ? validateVors(d) : null;
    if (verr) {
      console.warn('vor schema error:', verr);
      if (typeof S.errInvalidVors === 'function') alert(S.errInvalidVors(verr));
      return [];
    }
    vors = d.vors.map(v => ({
      ident: v.ident, name: v.name, he: v.he,
      freq: v.freq, lat: v.lat, lng: v.lng,
    }));
    return vors;
  } catch (e) {
    console.warn('Failed to load VORs:', e);
    return [];
  }
}
function vorByIdent(ident) {
  if (!ident || !vors) return null;
  return vors.find(v => v.ident === ident) || null;
}
// The currently-selected reference VOR object (or null).
function activeVor() { return vorByIdent(vorRef); }
// Magnetic radial FROM the VOR to a point + DME (great-circle nm).
// Radial is magnetic (VOR radials are defined magnetic; matches the Hdg
// column). Returns { radial: '263', dme: '12.4' } strings, or null.
function vorRadialDme(vor, lat, lng) {
  if (!vor || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const g = geo({ lat: vor.lat, lng: vor.lng }, { lat, lng });
  if (!g || !Number.isFinite(g.brg) || !Number.isFinite(g.dist)) return null;
  return { radial: pad3(toMagnetic(g.brg)), dme: g.dist.toFixed(1) };
}

// Closest airfield within `pxThreshold` screen pixels of `latlng`, or null.
// Returns the {name, he, en, lat, lng, ...} entry from the loaded JSON.
function nearestAirfield(latlng, pxThreshold, excludeLl) {
  const hit = closestScreenReference(airfields, 'airfield', latlng, pxThreshold, { excludeLl });
  return hit && hit.ref;
}

// True if `name` matches a known airfield ICAO (its `name` field).
// Airfield labels are ICAO — the locale-specific Hebrew / English label
// is only shown next to the marker, never stored as the WP name.
function isAirfieldName(name) {
  if (!name || !airfields) return false;
  for (const af of airfields) if (af.name === name) return true;
  return false;
}

// Max |Δlat| and |Δlng| for treating a waypoint as "on" an airfield ARP when
// the label is not the ICAO code (renamed WP, older saved coords vs chart
// refresh, r5 rounding). ~0.002° ≈ 220 m at Israel lat — matches `isAirport`.
const AIRFIELD_POS_MATCH_EPS = 0.002;

// Airfield row from `airfields.json` for inspector runways / plates: prefer an
// exact ICAO name match, else ARP coords within `AIRFIELD_POS_MATCH_EPS` so a
// renamed label (or legacy share-link coords) still surfaces charts + runways.
function airfieldAtWaypoint(wp) {
  if (!wp || !airfields || !airfields.length) return null;
  const name = (wp.name || '').trim().toUpperCase();
  const byName = airfields.find(a => a.name === name);
  if (byName) return byName;
  const eps = AIRFIELD_POS_MATCH_EPS;
  return airfields.find(a =>
    Math.abs(a.lat - wp.lat) < eps && Math.abs(a.lng - wp.lng) < eps
  ) || null;
}

// Distinct from nav-WPs: airfields are rendered as a blue-filled upward
// triangle (▲) outline, sized to ~7 px at typical zooms. The ICAO and
// localised name appear next to the marker at zoom ≥ 10. Suppressed when
// a route waypoint sits on the airfield (proximity-based, like nav-WPs).
function drawAirfields() {
  if (!showAirfields || !airfields || airfields.length === 0) return;
  const showLabels = map.getZoom() >= tune('airfieldLabelMinZoom');
  const r = tune('airfieldMarkerRadiusPx');
  const wFactor = tune('airfieldMarkerWidthFactor');
  const bFactor = tune('airfieldMarkerBaseFactor');
  const labelOffset = tune('airfieldLabelOffsetPx');
  octx.font = `bold ${tune('airfieldLabelFontPx')}px sans-serif`;
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  for (const af of airfields) {
    if (routeOccupiesPoint(af)) continue;
    const s = proj(af);                  // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
    octx.beginPath();
    octx.moveTo(s.x,          s.y - r);
    octx.lineTo(s.x + r * wFactor, s.y + r * bFactor);
    octx.lineTo(s.x - r * wFactor, s.y + r * bFactor);
    octx.closePath();
    octx.fillStyle = tune('airfieldFillColor');          // saturated blue — distinct from white nav-WP dots
    octx.fill();
    octx.lineWidth = tune('airfieldStrokeWidthPx');
    octx.strokeStyle = tune('airfieldOutlineColor');
    octx.stroke();
    if (showLabels) {
      const label = referenceOverlayLabel(af, 'airfield');
      octx.lineWidth = tune('airfieldLabelHaloPx');
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
      octx.strokeText(label, s.x + r + labelOffset, s.y);
      octx.fillStyle = tune('airfieldOutlineColor');
      octx.fillText(label, s.x + r + labelOffset, s.y);
    }
  }
  octx.lineWidth = 1;
}

function drawNavWaypoints() {
  if (!showNavWP || !navWP || navWP.length === 0) return;
  // Suppress nav-WP dot when a route waypoint sits on it (by position),
  // regardless of whether the WP name was changed after snapping.
  const showLabels = map.getZoom() >= tune('navWpLabelMinZoom');
  const dotRadius = tune('navWaypointRadiusPx');
  const labelOffset = tune('navWaypointLabelOffsetPx');
  octx.font = `bold ${tune('navWaypointLabelFontPx')}px sans-serif`;
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  for (const wp of navWP) {
    if (routeOccupiesPoint(wp)) continue;
    const s = proj(wp);                  // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
    octx.fillStyle = tune('navWaypointDotColor');
    octx.strokeStyle = tune('inkColor');
    octx.lineWidth = tune('navWaypointStrokeWidthPx');
    octx.beginPath();
    octx.arc(s.x, s.y, dotRadius, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
    if (showLabels) {
      const label = referenceOverlayLabel(wp, 'navwp');
      octx.lineWidth = tune('navWaypointLabelHaloPx');
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
      octx.strokeText(label, s.x + labelOffset, s.y);
      octx.fillStyle = tune('inkColor');
      octx.fillText(label, s.x + labelOffset, s.y);
    }
  }
  octx.lineWidth = 1;
}

// VOR/DME station overlay. Each station draws a compass-rose glyph (ring +
// N/E/S/W ticks + centre dot) with an ident + frequency label. The selected
// reference VOR is highlighted so it is obvious which one feeds the radial/
// DME readouts. Gated by the "Show VOR stations" toggle.
// `force` draws the stations regardless of the "Show VOR stations" toggle —
// used by the PNG export so the exported chart shows the stations whenever it
// carries VOR info (plan-card Radial/DME columns) even with the toggle off.
function drawVors(force) {
  if ((!showVorStations && !force) || !vors || !vors.length) return;
  const r = tune('vorMarkerRadiusPx');
  const showLabels = map.getZoom() >= tune('vorLabelMinZoom');
  octx.save();
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  octx.font = `bold ${tune('vorLabelFontPx')}px sans-serif`;
  for (const v of vors) {
    const s = proj(v);
    const sel = v.ident === vorRef;
    const col = sel ? tune('vorSelectedColor') : tune('vorMarkerColor');
    octx.strokeStyle = col;
    octx.fillStyle = col;
    octx.lineWidth = tune('vorMarkerWidthPx') * (sel ? 1.6 : 1);
    octx.beginPath();
    octx.arc(s.x, s.y, r, 0, Math.PI * 2);
    octx.stroke();
    // N/E/S/W ticks just outside the ring.
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      octx.beginPath();
      octx.moveTo(s.x + dx * r, s.y + dy * r);
      octx.lineTo(s.x + dx * (r + 4), s.y + dy * (r + 4));
      octx.stroke();
    }
    octx.beginPath();
    octx.arc(s.x, s.y, Math.max(1.5, r * 0.22), 0, Math.PI * 2);
    octx.fill();
    if (showLabels) {
      const label = v.ident + '  ' + (typeof vorEffectiveFreq === 'function' ? vorEffectiveFreq(v) : v.freq);
      const lx = s.x + r + 6, ly = s.y;
      octx.lineWidth = 2.5;
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
      octx.strokeText(label, lx, ly);
      octx.fillStyle = col;
      octx.fillText(label, lx, ly);
    }
  }
  octx.restore();
  octx.lineWidth = 1;
}

// --- reporting-type overlay (issue #404 / PR #405 design) ------------
// The CVFR chart's סוג דיווח class lives inline on each nav-waypoint as
// `report` ('mandatory' = חובה, 'onRequest' = דרישה). reportingFor() resolves
// a route-waypoint or nav-WP name (code or either locale label) to its class.
let _reportIndex = null;
let _reportIndexFor = null;
function reportingFor(name) {
  if (!name || !navWP || !navWP.length) return null;
  if (_reportIndexFor !== navWP) {
    _reportIndex = Object.create(null);
    for (const w of navWP) if (w.report) _reportIndex[w.name] = w.report;
    _reportIndexFor = navWP;
  }
  // `name` is guaranteed truthy by the guard above.
  const key = typeof canonicalNavWaypointName === 'function'
    ? canonicalNavWaypointName(name) : String(name).trim();
  return (key && _reportIndex[key]) || null;
}
// Small "M" badge on mandatory (חובה) reporting points so they stand out on
// the chart. Drawn as its own pass — independent of the nav-WP dot overlay —
// so it tracks the dedicated "Show mandatory reports" toggle. On-request
// points are not badged (they are the common case); the inspector still
// reports both classes for any selected waypoint.
function drawReportingBadges() {
  if (!showReporting || !navWP || !navWP.length) return;
  const r = tune('reportBadgeRadiusPx');
  const off = tune('reportBadgeOffsetPx');
  octx.save();
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.font = `bold ${tune('reportBadgeFontPx')}px sans-serif`;
  for (const wp of navWP) {
    if (wp.report !== 'mandatory') continue;
    const s = proj(wp);
    const cx = s.x + off, cy = s.y - off;
    octx.beginPath();
    octx.arc(cx, cy, r, 0, Math.PI * 2);
    octx.fillStyle = tune('reportBadgeColor');
    octx.fill();
    octx.lineWidth = 1.5;
    octx.strokeStyle = tune('inkColor');
    octx.stroke();
    octx.fillStyle = tune('reportBadgeTextColor');
    octx.fillText('M', cx, cy + 0.5);
  }
  octx.restore();
  octx.lineWidth = 1;
}

// Comm-change rings (issue #399 / #484). Drawn independently of the nav-WP
// dot layer: the "Show Comm Changes" toggle marks frequency-boundary points
// whether or not the full 173-dot reporting-point overlay is on. Positions
// come from the same navWP dataset, so navWP must be loaded when this layer
// is enabled (toggle handler + boot ensure that). When both layers are on,
// the dot is drawn by drawNavWaypoints() and the ring here — once each.
function drawCommChangeRings() {
  // Test-inspection hook (issue #399): every comm-change ring drawn this
  // frame is recorded here so Playwright can assert "ring drew at X"
  // without snapshotting overlay pixels. Built fresh every draw() so it
  // never accumulates stale names after a toggle off / pan away.
  const ringsDrawn = new Set();
  const ringRadii = {};                  // #488 test hook: name -> drawn radius
  // commChangeMap may be null briefly during boot — guard so a fast first
  // paint can't NPE before loadCommChange resolves. The red rings are an
  // on-screen affordance only — omit them from the PNG export (NavAid.exporting).
  if (showCommChange && commChangeMap && navWP && navWP.length &&
      !(window.NavAid && NavAid.exporting)) {
    const ringWidth = tune('commChangeRingWidthPx');
    octx.strokeStyle = tune('commChangeRingColor');
    octx.lineWidth = ringWidth;
    // #488: if a route waypoint sits on the point, drawWaypoints() paints a
    // filled disc over this ring later in the frame — and with "show waypoint
    // names" on, waypointGeom() enlarges that disc to fit its label. Grow the
    // ring to enclose the disc (+ its 3px stroke) so it stays visible outside.
    for (const wp of navWP) {
      if (!commChangeMap[wp.name] || !commChangeMap[wp.name].commChange) continue;
      const s = proj(wp);                // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
      let radius = tune('commChangeRingRadiusPx');
      const wi = routeWaypointAtPoint(wp);
      if (wi !== -1) {
        const selected = state.selected &&
                         state.selected.type === 'wp' && state.selected.index === wi;
        const discR = (selected ? waypointGeom(wi).r + 2 : waypointGeom(wi).r) + 2;
        if (discR + ringWidth > radius) radius = discR + ringWidth;
      }
      octx.beginPath();
      octx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      octx.stroke();
      ringsDrawn.add(wp.name);
      ringRadii[wp.name] = radius;
    }
    octx.lineWidth = 1;
  }
  window.__commChangeRingsDrawn = ringsDrawn;
  window.__commChangeRingRadii = ringRadii;
}

// Issue #487: auto-seed a real note near any route waypoint that sits on a
// comm-change reporting point, so the frequency change shows on the printed
// plan. The note is a normal `state.notes` object (movable / editable /
// deletable) tagged with `cc: <ICAO>` for idempotency — a point is seeded
// at most once, and the tag survives reload / export / import, so re-draws
// or repeated snaps never duplicate it. The same pass also removes tagged
// notes whose route waypoint moved away from the referenced point. Seeding is
// driven ONLY from explicit placement/snap/toggle actions (drop, drag-end,
// search route-build, Show/Add Freq Changes); it must not be called from
// draw() / load / import / undo or it would resurrect notes the user deleted.
// Returns true if any note was added, changed, or removed so the caller can
// persist / repaint.
function splitCommCalloutText(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.*?)(?:\s+(\d{3}(?:\.\d{1,3})?))$/);
  return {
    name: (m ? m[1] : s).trim(),
    freq: m ? commFormatFreq(m[2]) : '',
  };
}
function commFormatFreq(raw) {
  const s = String(raw || '').trim();
  if (/^\d{3}$/.test(s)) return s + '.00';
  if (/^\d{3}\.\d$/.test(s)) return s + '0';
  return s;
}
const COMM_FREQ_INPUT_MIN = '118';
const COMM_FREQ_INPUT_MAX = '136.975';
const COMM_FREQ_INPUT_STEP = '0.005';
function commNormalizeFreqInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/^\d{3}(?:\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < Number(COMM_FREQ_INPUT_MIN) ||
      n > Number(COMM_FREQ_INPUT_MAX)) return null;
  return commFormatFreq(s);
}
function commConfigureFreqInput(input) {
  if (!input) return input;
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = COMM_FREQ_INPUT_MIN;
  input.max = COMM_FREQ_INPUT_MAX;
  input.step = COMM_FREQ_INPUT_STEP;
  return input;
}
// VORs live in the 108–117.975 MHz VHF nav band, below the comm band — they
// need their own validation so valid VOR freqs aren't flagged invalid.
const VOR_FREQ_INPUT_MIN = '108';
const VOR_FREQ_INPUT_MAX = '117.975';
function vorNormalizeFreqInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/^\d{3}(?:\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < Number(VOR_FREQ_INPUT_MIN) ||
      n > Number(VOR_FREQ_INPUT_MAX)) return null;
  return commFormatFreq(s);
}
function vorConfigureFreqInput(input) {
  if (!input) return input;
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = VOR_FREQ_INPUT_MIN;
  input.max = VOR_FREQ_INPUT_MAX;
  input.step = '0.05';
  return input;
}
function commUseHebrewLabels() {
  const lang = (typeof window !== 'undefined' && window.__navLang) ||
    (typeof document !== 'undefined' && document.documentElement &&
      document.documentElement.lang) || '';
  return String(lang).toLowerCase().slice(0, 2) === 'he';
}
function commCallSignLabel(id, row) {
  if (commUseHebrewLabels() && row && typeof row.he === 'string' && row.he.trim()) {
    return row.he.trim();
  }
  if (row && typeof row.label === 'string' && row.label.trim()) return row.label.trim();
  return String(id || '').replace(/_/g, ' ').toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}
function commCallSignOptionNames(opt) {
  if (!opt) return [];
  const row = (opt.row && typeof opt.row === 'object') ? opt.row : {};
  return [opt.id, opt.label, row.label, row.he]
    .filter(v => typeof v === 'string' && v.trim())
    .map(v => v.trim());
}
function commCallSignOptionMatches(opt, raw) {
  const needle = String(raw || '').trim().toLocaleLowerCase();
  if (!needle) return false;
  return commCallSignOptionNames(opt)
    .some(v => v.toLocaleLowerCase() === needle);
}
const COMM_FREQ_OVERRIDES_KEY = 'navaid.commFreqOverrides';
function commCallSignIdKey(id) {
  return String(id || '').trim().toUpperCase();
}
function commReadFreqOverrides() {
  try {
    const raw = localStorage.getItem(COMM_FREQ_OVERRIDES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [id, freq] of Object.entries(parsed)) {
      const key = commCallSignIdKey(id);
      const val = commFormatFreq(freq);
      if (key && val) out[key] = val;
    }
    return out;
  } catch (e) {
    return {};
  }
}
function commWriteFreqOverrides(overrides) {
  try {
    const clean = {};
    for (const [id, freq] of Object.entries(overrides || {})) {
      const key = commCallSignIdKey(id);
      const val = commFormatFreq(freq);
      if (key && val) clean[key] = val;
    }
    if (Object.keys(clean).length) {
      localStorage.setItem(COMM_FREQ_OVERRIDES_KEY, JSON.stringify(clean));
    } else {
      localStorage.removeItem(COMM_FREQ_OVERRIDES_KEY);
    }
  } catch (e) {}
}
function commCatalogCallSignRow(id) {
  const key = commCallSignIdKey(id);
  const catalog = (typeof commChangeCallSigns === 'object' && commChangeCallSigns) || {};
  return catalog[key] || catalog[id] || null;
}
function commCallSignDefaultFreq(row) {
  if (!row || typeof row !== 'object') return '';
  if (typeof row.primary === 'string' && row.primary.trim()) return commFormatFreq(row.primary);
  if (typeof row.freq === 'string' && row.freq.trim()) return commFormatFreq(row.freq);
  return '';
}
function commCallSignTemplateFreq(id, row) {
  return commCallSignDefaultFreq(row || commCatalogCallSignRow(id));
}
function commCallSignOverrideFreq(id) {
  const key = commCallSignIdKey(id);
  return key ? (commReadFreqOverrides()[key] || '') : '';
}
function commCallSignEffectiveFreq(id, row) {
  return commCallSignOverrideFreq(id) || commCallSignTemplateFreq(id, row);
}
function commSetCallSignFreqOverride(id, freq) {
  const key = commCallSignIdKey(id);
  if (!key) return '';
  const formatted = commFormatFreq(freq);
  const template = commCallSignTemplateFreq(key);
  const overrides = commReadFreqOverrides();
  if (!formatted || (template && formatted === template)) delete overrides[key];
  else overrides[key] = formatted;
  commWriteFreqOverrides(overrides);
  return formatted || template || '';
}
function commApplyCallSignFreqOverride(id, freq) {
  const key = commCallSignIdKey(id);
  const effective = commSetCallSignFreqOverride(key, freq);
  if (!key || !effective || typeof state === 'undefined' || !Array.isArray(state.notes)) {
    return effective;
  }
  for (const n of state.notes) {
    const opt = commNoteCallSignOption(n);
    if (opt && commCallSignIdKey(opt.id) === key) {
      n.freq = effective;
      n.freqAuto = false;
    }
  }
  return effective;
}
function commResetCallSignFreqOverride(id) {
  const template = commCallSignTemplateFreq(id);
  return template ? commApplyCallSignFreqOverride(id, template) : '';
}
function commResetAllCallSignFreqOverrides() {
  const catalog = (typeof commChangeCallSigns === 'object' && commChangeCallSigns) || {};
  for (const id of Object.keys(catalog)) commResetCallSignFreqOverride(id);
  commWriteFreqOverrides({});
}
function commCallSignOptions(name) {
  const key = canonicalNavWaypointName(name);
  const cc = commChangeMap && key ? commChangeMap[key] : null;
  if (!cc || !Array.isArray(cc.callSigns)) return [];
  const catalog = (typeof commChangeCallSigns === 'object' && commChangeCallSigns) || {};
  const out = [];
  for (const rawId of cc.callSigns) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    const row = catalog[id] || catalog[id.toUpperCase()] || null;
    out.push({
      id,
      label: commCallSignLabel(id, row),
      freq: commCallSignEffectiveFreq(id, row),
      templateFreq: commCallSignTemplateFreq(id, row),
      overrideFreq: commCallSignOverrideFreq(id),
      row,
    });
  }
  return out;
}
function commCallSignOptionById(name, id) {
  const needle = String(id || '').trim().toLocaleLowerCase();
  if (!needle) return null;
  return commCallSignOptions(name)
    .find(o => String(o.id || '').trim().toLocaleLowerCase() === needle) || null;
}
function commStaticCalloutDefaults(name) {
  const key = canonicalNavWaypointName(name);
  const cc = commChangeMap && key ? commChangeMap[key] : null;
  const fallback = (typeof S !== 'undefined' && S.commChangeNoteText) || 'Freq change';
  const opt = commCallSignOptions(key)[0];
  if (opt) return { freqName: opt.id || opt.label || fallback, freq: opt.freq || '' };
  const raw = cc && (cc.to || cc.from || cc.note || cc.name || key);
  const d = splitCommCalloutText(raw || key || fallback);
  return { freqName: d.name || fallback, freq: d.freq };
}
function commNameKey(s) {
  return String(s || '').trim().toLocaleLowerCase()
    .replace(/[^0-9a-z\u0590-\u05ff]+/g, '');
}
function commNamesMatch(a, b) {
  const ak = commNameKey(a);
  const bk = commNameKey(b);
  if (!ak || !bk) return false;
  if (ak === bk) return true;
  return ak.length >= 4 && bk.length >= 4 &&
    (ak.includes(bk) || bk.includes(ak));
}
function commWaypointNameCandidates(wp) {
  const out = [];
  const push = v => {
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  };
  if (wp) push(wp.name);
  const key = canonicalNavWaypointName(wp && wp.name);
  push(key);
  if (Array.isArray(navWP) && key) {
    const ref = navWP.find(w => w && canonicalNavWaypointName(w.name) === key);
    if (ref) {
      push(ref.name);
      push(ref.en);
      push(ref.he);
    }
  }
  const af = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wp) : null;
  if (af) {
    push(af.name);
    push(af.en);
    push(af.he);
  }
  return out;
}
function commAllCallSignOptions() {
  const catalog = (typeof commChangeCallSigns === 'object' && commChangeCallSigns) || {};
  return Object.keys(catalog).map(id => ({
    id,
    label: commCallSignLabel(id, catalog[id]),
    freq: commCallSignEffectiveFreq(id, catalog[id]),
    templateFreq: commCallSignTemplateFreq(id, catalog[id]),
    overrideFreq: commCallSignOverrideFreq(id),
    row: catalog[id],
  }));
}
function commOptionPool(allowedIds) {
  const all = commAllCallSignOptions();
  if (!Array.isArray(allowedIds) || !allowedIds.length) return all;
  const allowed = new Set(allowedIds.map(id => String(id || '').toLocaleLowerCase()));
  return all.filter(o => allowed.has(String(o.id || '').toLocaleLowerCase()));
}
function commCallSignReferencePoints(opt, excludedNames) {
  const out = [];
  const excluded = new Set((Array.isArray(excludedNames) ? excludedNames : [])
    .map(canonicalNavWaypointName)
    .filter(Boolean));
  const add = p => {
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) out.push(p);
  };
  if (Array.isArray(airfields)) {
    for (const af of airfields) {
      const names = [af.name, af.en, af.he].filter(v => typeof v === 'string' && v.trim());
      if (commCallSignOptionNames(opt).some(a =>
        names.some(b => commNamesMatch(a, b)))) add(af);
    }
  }
  if (commChangeMap && typeof commChangeMap === 'object') {
    for (const [name, row] of Object.entries(commChangeMap)) {
      const key = canonicalNavWaypointName(name);
      if (excluded.has(key)) continue;
      if (!row || !Array.isArray(row.callSigns)) continue;
      if (!row.callSigns.some(id => String(id || '').toLocaleLowerCase() ===
          String(opt.id || '').toLocaleLowerCase())) continue;
      add(commChangeReferencePoint(key));
    }
  }
  return out;
}
function commCallSignReferenceDistance(wp, opt, excludedNames) {
  if (!wp) return Infinity;
  let best = Infinity;
  for (const ref of commCallSignReferencePoints(opt, excludedNames)) {
    best = Math.min(best, geo(wp, ref).dist);
  }
  return best;
}
function commRouteContextName(index) {
  if (typeof state === 'undefined' || !Array.isArray(state.waypoints)) return '';
  const wp = state.waypoints[index];
  return canonicalNavWaypointName(wp && wp.name);
}
function commRouteHintName(raw) {
  return canonicalNavWaypointName(raw);
}
function commCallSignDefaultFromOption(opt) {
  return opt ? { freqName: opt.id, freq: opt.freq || '' } : null;
}
function commRouteHintDefault(entry) {
  if (!entry || !commChangeMap || typeof state === 'undefined' ||
      !Array.isArray(state.waypoints)) return null;
  const row = commChangeMap[entry.name];
  if (!row || !Array.isArray(row.routeHints) || !row.routeHints.length) return null;
  const before = commRouteContextName(entry.index - 1);
  const after = commRouteContextName(entry.index + 1);
  const candidates = [];
  const seen = new Set();
  for (const hint of row.routeHints) {
    if (!hint || typeof hint !== 'object') continue;
    if (hint.before && commRouteHintName(hint.before) !== before) continue;
    if (hint.after && commRouteHintName(hint.after) !== after) continue;
    const opt = commCallSignOptionById(entry.name, hint.callSign);
    const key = opt && commCallSignIdKey(opt.id);
    if (!opt || !key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(opt);
  }
  return candidates.length === 1 ? commCallSignDefaultFromOption(candidates[0]) : null;
}
function commInferRouteContextCallSignId(points, allowedIds, excludedNames) {
  const opts = commOptionPool(allowedIds);
  const pts = (Array.isArray(points) ? points : []).filter(Boolean);
  if (!pts.length || !opts.length) return '';
  for (const wp of pts) {
    const names = commWaypointNameCandidates(wp);
    for (const opt of opts) {
      if (commCallSignOptionNames(opt).some(a =>
        names.some(b => commNamesMatch(a, b)))) return opt.id;
    }
  }
  let best = null;
  let second = Infinity;
  for (const opt of opts) {
    let d = Infinity;
    for (const wp of pts) d = Math.min(d, commCallSignReferenceDistance(wp, opt, excludedNames));
    if (!Number.isFinite(d)) continue;
    if (!best || d < best.dist) {
      second = best ? best.dist : Infinity;
      best = { id: opt.id, dist: d };
    } else {
      second = Math.min(second, d);
    }
  }
  if (!best || best.dist > 25) return '';
  if (Number.isFinite(second) && second - best.dist < 0.75) return '';
  return best.id;
}
function commInferWaypointCallSignId(wp, allowedIds) {
  return commInferRouteContextCallSignId([wp], allowedIds, []);
}
function commRouteChangeEntries() {
  if (!commChangeMap || typeof state === 'undefined' ||
      !Array.isArray(state.waypoints)) return [];
  const out = [];
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    const name = canonicalNavWaypointName(wp && wp.name);
    const row = name && commChangeMap[name];
    if (!row || !row.commChange || !commChangeWaypointInRange(wp, name)) continue;
    const options = commCallSignOptions(name).map(o => o.id).filter(Boolean);
    if (!options.length) continue;
    out.push({ index: i, name, options, set: new Set(options) });
  }
  return out;
}
function commRouteDomain(entries, pos) {
  const ids = [];
  const push = id => { if (id && !ids.includes(id)) ids.push(id); };
  if (pos === 0) entries[0].options.forEach(push);
  else if (pos === entries.length) entries[entries.length - 1].options.forEach(push);
  else {
    entries[pos - 1].options.forEach(push);
    entries[pos].options.forEach(push);
  }
  return ids;
}
function commRouteDomainHint(entries, pos, allowedIds) {
  if (!entries.length || !Array.isArray(state.waypoints)) return '';
  const start = pos === 0 ? 0 : entries[pos - 1].index + 1;
  const end = pos === entries.length ? state.waypoints.length : entries[pos].index;
  const points = state.waypoints.slice(start, end);
  const excluded = [];
  if (pos > 0) excluded.push(entries[pos - 1].name);
  if (pos < entries.length) excluded.push(entries[pos].name);
  return commInferRouteContextCallSignId(points, allowedIds, excluded);
}
function commSolveRouteCallSigns(entries) {
  const n = entries.length;
  if (!n) return [];
  const domains = [];
  for (let i = 0; i <= n; i++) domains.push(commRouteDomain(entries, i));
  const domainHints = domains.map((ids, i) => commRouteDomainHint(entries, i, ids));
  let states = new Map();
  for (const id of domains[0]) {
    const hint = domainHints[0];
    const cost = hint ? (id === hint ? 0 : 50) : 0;
    states.set(id, { cost, path: [id] });
  }
  for (let i = 0; i < n; i++) {
    const next = new Map();
    for (const [prevId, prev] of states.entries()) {
      for (const id of domains[i + 1]) {
        if (!entries[i].set.has(prevId) || !entries[i].set.has(id)) continue;
        let cost = prev.cost;
        if (prevId === id && entries[i].options.length > 1) cost += 10;
        const idx = entries[i].options.indexOf(id);
        cost += (idx < 0 ? 1 : idx * 0.01);
        const hint = domainHints[i + 1];
        if (hint) cost += id === hint ? 0 : 50;
        const old = next.get(id);
        if (!old || cost < old.cost) next.set(id, { cost, path: prev.path.concat(id) });
      }
    }
    states = next;
    if (!states.size) return [];
  }
  let best = null;
  for (const cur of states.values()) {
    if (!best || cur.cost < best.cost) best = cur;
  }
  return best ? best.path : [];
}
function commRouteCalloutDefaultsMap() {
  const entries = commRouteChangeEntries();
  const path = commSolveRouteCallSigns(entries);
  const out = {};
  for (let i = 0; i < entries.length; i++) {
    const routeHint = commRouteHintDefault(entries[i]);
    if (routeHint) {
      out[entries[i].name] = routeHint;
      continue;
    }
    if (!path.length) continue;
    const id = path[i + 1];
    const opt = commCallSignOptionById(entries[i].name, id);
    if (opt) out[entries[i].name] = { freqName: opt.id, freq: opt.freq || '' };
  }
  return out;
}
function commCalloutDefaults(name) {
  const key = canonicalNavWaypointName(name);
  const routeDefaults = commRouteCalloutDefaultsMap();
  return (key && routeDefaults[key]) || commStaticCalloutDefaults(key);
}
function commNoteCallSignOption(n) {
  if (!n || !n.cc || typeof n.freqName !== 'string' || !n.freqName.trim()) return null;
  return commCallSignOptions(n.cc)
    .find(o => commCallSignOptionMatches(o, n.freqName)) || null;
}
function commNoteName(n) {
  const opt = commNoteCallSignOption(n);
  if (opt) return opt.label;
  if (n && typeof n.freqName === 'string' && n.freqName.trim()) {
    return n.freqName.trim();
  }
  if (n && n.cc) {
    const d = commCalloutDefaults(n.cc);
    const def = commCallSignOptions(n.cc)
      .find(o => commCallSignOptionMatches(o, d.freqName));
    return def ? def.label : d.freqName;
  }
  return '';
}
function commNoteFreq(n) {
  const opt = commNoteCallSignOption(n);
  if (opt && opt.overrideFreq &&
      (n.freqAuto === true || !n.freq || commFormatFreq(n.freq) === (opt.templateFreq || ''))) {
    return opt.overrideFreq;
  }
  if (n && typeof n.freq === 'string' && n.freq.trim()) return commFormatFreq(n.freq);
  if (opt && opt.freq) return opt.freq;
  if (n && n.cc) return commCalloutDefaults(n.cc).freq;
  return '';
}
function noteLines(n) {
  if (n && n.cc) {
    const name = commNoteName(n);
    const freq = commNoteFreq(n);
    return [name ? name.toUpperCase() : '', freq].filter(Boolean);
  }
  return (n.text || '').split('\n');
}
function commCalloutTarget(n) {
  if (!n || !n.cc) return null;
  const key = canonicalNavWaypointName(n.cc);
  if (!key) return null;
  const routeWp = state.waypoints.find(w => w &&
    canonicalNavWaypointName(w.name) === key);
  if (routeWp) return routeWp;
  const refWp = Array.isArray(navWP) ? navWP.find(w => w && w.name === key) : null;
  return refWp || null;
}
function commCalloutDefaultTail(wp) {
  return {
    lat: r5(wp.lat + tune('commChangeNoteLatOffset')),
    lng: r5(wp.lng + tune('commChangeNoteLngOffset')),
  };
}
function commChangeReferencePoint(name) {
  const key = canonicalNavWaypointName(name);
  if (!key) return null;
  const row = commChangeMap && commChangeMap[key];
  if (row && Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
    return { name: key, lat: row.lat, lng: row.lng };
  }
  const refWp = Array.isArray(navWP)
    ? navWP.find(w => w && canonicalNavWaypointName(w.name) === key)
    : null;
  if (refWp) return refWp;
  const refAf = Array.isArray(airfields)
    ? airfields.find(a => a && a.name === key)
    : null;
  return refAf || null;
}
function knownRoutePointKey(name) {
  const key = canonicalNavWaypointName(name);
  if (!key) return '';
  if (Array.isArray(navWP) && navWP.some(w => w && canonicalNavWaypointName(w.name) === key)) {
    return key;
  }
  if (Array.isArray(airfields) && airfields.some(a => a && canonicalNavWaypointName(a.name) === key)) {
    return key;
  }
  return '';
}
function commChangeWaypointInRange(wp, name) {
  if (!wp || typeof map === 'undefined' || !map) return false;
  const key = canonicalNavWaypointName(name);
  if (!key) return false;
  const wpKey = canonicalNavWaypointName(wp.name);
  if (wpKey && wpKey !== key && knownRoutePointKey(wpKey)) return false;
  const ref = commChangeReferencePoint(key);
  // When there is no reference position, fall back to name equality.
  if (!ref) return wpKey === key;
  // Position is authoritative only for custom / renamed points — a known
  // route waypoint with a different code must not snap to a nearby comm point
  // at low zoom (e.g. HTZUK must not activate KNTRY).
  const a = map.latLngToContainerPoint([wp.lat, wp.lng]);
  const b = map.latLngToContainerPoint([ref.lat, ref.lng]);
  return Math.hypot(a.x - b.x, a.y - b.y) <= tune('commChangeSnapPx');
}
function hasActiveCommChangeWaypoint(name) {
  if (!Array.isArray(state.waypoints)) return false;
  const key = canonicalNavWaypointName(name);
  return !!key && state.waypoints.some(w => commChangeWaypointInRange(w, key));
}
function normalizeCommChangeSuppressions(raw) {
  const src = raw === undefined ? state.commChangeSuppressions : raw;
  const out = [];
  if (Array.isArray(src)) {
    for (const v of src) {
      const key = canonicalNavWaypointName(v);
      if (key && !out.includes(key)) out.push(key);
    }
  }
  state.commChangeSuppressions = out;
  return out;
}
function isCommChangeSuppressed(name) {
  const key = canonicalNavWaypointName(name);
  return !!key && normalizeCommChangeSuppressions().includes(key);
}
function suppressCommChange(name) {
  const key = canonicalNavWaypointName(name);
  if (!key) return false;
  const suppressions = normalizeCommChangeSuppressions();
  if (suppressions.includes(key)) return false;
  suppressions.push(key);
  state.commChangeSuppressions = suppressions;
  return true;
}
function unsuppressCommChange(name) {
  const key = canonicalNavWaypointName(name);
  if (!key) return false;
  const suppressions = normalizeCommChangeSuppressions()
    .filter(v => canonicalNavWaypointName(v) !== key);
  if (suppressions.length === state.commChangeSuppressions.length) return false;
  state.commChangeSuppressions = suppressions;
  return true;
}
function pruneStaleCommChangeSuppressions() {
  if (!Array.isArray(state.commChangeSuppressions)) {
    state.commChangeSuppressions = [];
    return false;
  }
  const before = normalizeCommChangeSuppressions();
  const kept = before.filter(name => {
    const row = commChangeMap && commChangeMap[name];
    return row && row.commChange && hasActiveCommChangeWaypoint(name);
  });
  if (kept.length === before.length) return false;
  state.commChangeSuppressions = kept;
  return true;
}
function pruneStaleCommChangeNotes() {
  if (!Array.isArray(state.notes)) return false;
  let changed = false;
  const selectedNote = state.selected && state.selected.type === 'note'
    ? state.notes[state.selected.index] : null;
  const kept = [];
  for (const n of state.notes) {
    if (n && n.cc && !hasActiveCommChangeWaypoint(n.cc)) {
      changed = true;
      continue;
    }
    kept.push(n);
  }
  if (!changed) return false;
  state.notes = kept;
  if (selectedNote) {
    const idx = state.notes.indexOf(selectedNote);
    state.selected = idx >= 0 ? { type: 'note', index: idx } : null;
  }
  return true;
}
function seedCommChangeNotes() {
  if (!showCommChange) return false;
  if (!commChangeMap || typeof state === 'undefined' ||
      !Array.isArray(state.waypoints) || !Array.isArray(state.notes)) return false;
  let changed = pruneStaleCommChangeNotes();
  if (pruneStaleCommChangeSuppressions()) changed = true;
  const routeDefaults = commRouteCalloutDefaultsMap();
  for (const wp of state.waypoints) {
    if (!wp) continue;
    // Resolve comm-change key: try stored name first, then fall back to
    // coordinate scan so a renamed waypoint at a known ICAO position still
    // triggers (e.g. move back to DEROR after rename → freq change shows).
    let nm = canonicalNavWaypointName(wp && wp.name);
    let cc = nm ? commChangeMap[nm] : null;
    if ((!cc || !cc.commChange) && Array.isArray(navWP) && typeof map !== 'undefined' && map) {
      for (const nwp of navWP) {
        const k = canonicalNavWaypointName(nwp.name);
        if (!k || !commChangeMap[k] || !commChangeMap[k].commChange) continue;
        const ref = commChangeReferencePoint(k);
        if (!ref) continue;
        const a = map.latLngToContainerPoint([wp.lat, wp.lng]);
        const b = map.latLngToContainerPoint([ref.lat, ref.lng]);
        if (Math.hypot(a.x - b.x, a.y - b.y) <= tune('commChangeSnapPx')) {
          nm = k; cc = commChangeMap[k]; break;
        }
      }
    }
    if (!nm || !cc || !cc.commChange) continue;
    if (!commChangeWaypointInRange(wp, nm)) continue;
    const callout = routeDefaults[nm] || commStaticCalloutDefaults(nm);
    const existing = state.notes.find(n => n && canonicalNavWaypointName(n.cc) === nm);
    if (existing) {
      if (unsuppressCommChange(nm)) changed = true;
      if (existing.cc !== nm) { existing.cc = nm; changed = true; }
      if (!existing.freqName) { existing.freqName = callout.freqName; changed = true; }
      if (!existing.freq) { existing.freq = callout.freq; changed = true; }
      if (existing.freqAuto === true &&
          (existing.freqName !== callout.freqName || existing.freq !== callout.freq)) {
        existing.freqName = callout.freqName;
        existing.freq = callout.freq;
        changed = true;
      }
      // Earlier auto-generated callouts were note boxes above the point.
      // Move only notes still sitting on those generated positions to the
      // chart-style west tail; user-dragged callouts keep their location.
      const oldLats = [r5(wp.lat + 0.012), r5(wp.lat + 0.07)];
      const oldLng = r5(wp.lng);
      if (oldLats.some(oldLat => Math.abs(existing.lat - oldLat) < 0.00002) &&
          Math.abs(existing.lng - oldLng) < 0.00002) {
        const tail = commCalloutDefaultTail(wp);
        existing.lat = tail.lat;
        existing.lng = tail.lng;
        changed = true;
      }
      continue;
    }
    if (isCommChangeSuppressed(nm)) continue;
    const tail = commCalloutDefaultTail(wp);
    state.notes.push({
      lat: tail.lat,
      lng: tail.lng,
      text: (typeof S !== 'undefined' && S.commChangeNoteText) || 'Freq change',
      color: NOTE_DEFAULT_COLOR,
      shape: 'rect',
      cc: nm,
      freqName: callout.freqName,
      freq: callout.freq,
      freqAuto: true,
    });
    changed = true;
  }
  return changed;
}
window.seedCommChangeNotes = seedCommChangeNotes;
window.suppressCommChange = suppressCommChange;
window.unsuppressCommChange = unsuppressCommChange;
window.normalizeCommChangeSuppressions = normalizeCommChangeSuppressions;

function drawLegs() {
  const zoomScale = legZoomScale();

  // Pre-compute cumulative outbound times (walk legs in reverse so each
  // entry is "total return time from the last waypoint through leg i").
  const cumOutArr = new Array(state.legs.length).fill('--');
  if (showReturn) {
    let cumOut = 0;
    for (let j = state.legs.length - 1; j >= 0; j--) {
      const Aj = state.waypoints[j], Bj = state.waypoints[j + 1];
      if (!Aj || !Bj) continue;
      const { dist: dj } = geo(Aj, Bj);
      const dur = state.legs[j].outboundSpeed > 0 ? dj / state.legs[j].outboundSpeed : 0;
      cumOut += dur;
      cumOutArr[j] = cumOut > 0 ? toHMS(cumOut) : '--';
    }
  }

  let cumInH = 0;  // running inbound cumulative time (hours)

  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    if (!A || !B) continue;
    const leg = state.legs[i];
    const sa = proj(A), sb = proj(B);
    const selected = selectionVisible() && state.selected &&
                     state.selected.type === 'leg' &&
                     state.selected.index === i;

    const lw = (typeof legLineWidth === 'number' && legLineWidth > 0) ? legLineWidth : 1;
    octx.lineCap = 'round';
    octx.strokeStyle = selected ? tune('selectedColor') : tune('inkColor');
    octx.lineWidth = selected ? tune('routeSelectedLineWidthPx') * lw : tune('routeLineWidthPx') * lw;
    octx.beginPath();
    octx.moveTo(sa.x, sa.y);
    octx.lineTo(sb.x, sb.y);
    octx.stroke();
    octx.lineCap = 'butt';

    if (showDrift) drawDriftLines(sa, sb);

    const { dist, brg } = geo(A, B);
    const durH = leg.flightSpeed > 0 ? dist / leg.flightSpeed : 0;
    const durOut = leg.outboundSpeed > 0 ? dist / leg.outboundSpeed : 0;
    const magIn = toMagnetic(brg);
    const magOut = (magIn + 180) % 360;
    const timeStr = durH > 0 ? toHMS(durH) : '--';
    const timeStrOut = durOut > 0 ? toHMS(durOut) : '--';

    drawMinuteMarkers(sa, sb, durH);

    const ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    let dx = sb.x - sa.x, dy = sb.y - sa.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    // Strict validator (`_normalizeLegLabel` + `syncLegs`) should keep
    // these defined in practice — every code path that touches a leg
    // stamps `inLabel`/`outLabel` via `_defaultLegLabels()`. Fallback
    // exists as a defensive guard for hand-edited / corrupted state.
    const defaults = (typeof _defaultLegLabels === 'function')
      ? _defaultLegLabels()
      : { inLabel: { a: 0, _default: 1, _m: 1 },
          outLabel: { a: 0, _default: 1, _m: 1 } };
    const inP = leg.inLabel || defaults.inLabel;
    const outP = leg.outLabel || defaults.outLabel;
    // Issue #394: a default (unmodified) kite sits just outside the drift
    // cone instead of at a fixed per-zoom pixel offset. The cone's
    // perpendicular extent at the leg midpoint comes from the configured
    // drift angle; a margin keeps the kite visibly clear of the dashed
    // drift lines at every zoom / leg length. User-dragged offsets
    // (no `_default` flag) keep the existing `p * legZoomScale()` path so
    // hand-positioned kites round-trip exactly as PR #393 designed.
    const driftPerp = legDefaultLabelPerp(len);
    const inPerp  = inP._default  ?  driftPerp : (inP.p  || 0) * zoomScale;
    const outPerp = outP._default ? -driftPerp : (outP.p || 0) * zoomScale;
    const inAlong  = (inP.a  || 0) * zoomScale;
    const outAlong = (outP.a || 0) * zoomScale;
    cumInH += durH;
    const cumInStr = cumInH > 0 ? toHMS(cumInH) : '--';

    drawLegArrow(mid.x + dx * inAlong + nx * inPerp,
      mid.y + dy * inAlong + ny * inPerp,
      ang, pad3(magIn), timeStr, formatAltitudeValue(leg.inboundAltitude, leg, 'inboundAltitude'),
      tune('inkColor'), tintFill(tune('legKiteFillColor'), tune('kiteNoteAlpha')), needsHalo(i, 'in'), zoomScale);
    // Cumulative inbound time: < [time], position driven by leg.cumLabel
    // (default: at B waypoint, same perpendicular side as main kite).
    const defCum = { a: 0, _default: 1, _m: 1 };
    if (showCumTime) {
      const cumP = leg.cumLabel || defCum;
      const cumPerp  = cumP._default ? driftPerp : (cumP.p || 0) * zoomScale;
      const cumAlong = (cumP.a || 0) * zoomScale;
      const cumX = sb.x + dx * cumAlong + nx * cumPerp;
      const cumY = sb.y + dy * cumAlong + ny * cumPerp;
      drawCumTimeArrow(cumX, cumY,
        Math.atan2(sb.y - cumY, sb.x - cumX),
        cumInStr, tune('inkColor'), tintFill(tune('cumKiteFillColor'), tune('kiteNoteAlpha')), zoomScale);
    }

    if (showReturn && legAllowsReturn(i)) {
      drawLegArrow(mid.x + dx * outAlong + nx * outPerp,
        mid.y + dy * outAlong + ny * outPerp, ang + Math.PI,
        pad3(magOut), timeStrOut, formatAltitudeValue(leg.outboundAltitude, leg, 'outboundAltitude'),
        tune('inkColor'), tintFill(tune('returnKiteFillColor'), tune('kiteNoteAlpha')), needsHalo(i, 'out'), zoomScale);
      if (showCumTime) {
        // Cumulative return time kite at A waypoint (return destination).
        // Own offset (cumLabelRet), anchored at A with the same +dx/+nx frame
        // as the inbound kite so its drag math is identical; default sits on
        // the opposite perpendicular side (-driftPerp).
        const cumRetP = leg.cumLabelRet || defCum;
        const cumRetPerp  = cumRetP._default ? -driftPerp : (cumRetP.p || 0) * zoomScale;
        const cumRetAlong = (cumRetP.a || 0) * zoomScale;
        const cumRetX = sa.x + dx * cumRetAlong + nx * cumRetPerp;
        const cumRetY = sa.y + dy * cumRetAlong + ny * cumRetPerp;
        drawCumTimeArrow(cumRetX, cumRetY,
          Math.atan2(sa.y - cumRetY, sa.x - cumRetX),
          cumOutArr[i], tune('inkColor'), tintFill(tune('returnCumKiteFillColor'), tune('kiteNoteAlpha')), zoomScale);
      }
    }
    if (showMidLeg) drawDistanceBadge(mid.x, mid.y, dist);

    // Wind arrow (#722): show the wind that applies to each leg — the
    // route-wide wind, or a per-leg override where one is set. A leg that
    // overrides the route wind is drawn slightly bolder so the difference is
    // visible at a glance. Drawn at 30% along the leg (clear of the midpoint
    // distance badge and the minute-marker numbers).
    if (window.showWind && typeof legWindFor === 'function') {
      const lw2 = legWindFor(leg);
      if (lw2) {
        const f = 0.3;
        const px = sa.x + (sb.x - sa.x) * f, py = sa.y + (sb.y - sa.y) * f;
        const pll = { lat: A.lat + (B.lat - A.lat) * f,
                      lng: A.lng + (B.lng - A.lng) * f };
        const isOverride = !!(leg.wind &&
          (Number.isFinite(leg.wind.dir) || Number.isFinite(leg.wind.speed)));
        drawWindArrow(px, py, pll, lw2, isOverride);
      }
    }
  }
}

// Screen angle (radians) of the direction the wind BLOWS TOWARD at a given
// lat/lng. Computed by projecting a small geographic offset instead of using
// the compass angle directly so it stays correct under map rotation
// (map.setBearing) — same reasoning as the kite angles, which come from
// projected points.
function windScreenAngle(latlng, windDirFrom) {
  const to = ((windDirFrom + 180) * Math.PI) / 180;
  const eps = 0.02;                                   // ~1.2 NM; angle only
  const p1 = proj(latlng);
  const p2 = proj({
    lat: latlng.lat + Math.cos(to) * eps,
    lng: latlng.lng + Math.sin(to) * eps / Math.cos((latlng.lat * Math.PI) / 180),
  });
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

// Blue wind arrow + "dir/speed" label for a per-leg wind override.
function drawWindArrow(x, y, latlng, wind, emphasis) {
  const ang = windScreenAngle(latlng, wind.dir);
  // Shaft length scales with wind speed (≈ stronger wind = longer barb),
  // clamped so a light breeze is still visible and a gale doesn't span the
  // whole leg. Override legs draw a touch longer/bolder.
  const base = Math.max(16, Math.min(70, 12 + (wind.speed || 0) * 1.1));
  const len = emphasis ? base * 1.15 : base;
  const head = emphasis ? 11 : 9;
  const cx = Math.cos(ang), cy = Math.sin(ang);
  const x1 = x + cx * len / 2, y1 = y + cy * len / 2;
  octx.save();
  octx.strokeStyle = tune('windArrowColor');
  octx.fillStyle = tune('windArrowColor');
  octx.lineWidth = emphasis ? 3 : 2;
  // White halo so the arrow reads over busy chart tiles.
  octx.lineJoin = 'round';
  octx.beginPath();
  octx.moveTo(x - cx * len / 2, y - cy * len / 2);
  octx.lineTo(x1, y1);
  octx.save();
  octx.strokeStyle = colorWithAlpha(tune('windArrowHaloColor'), 0.85);
  octx.lineWidth = (emphasis ? 3 : 2) + 3;
  octx.stroke();
  octx.restore();
  octx.stroke();
  octx.beginPath();                                   // arrow head
  octx.moveTo(x1, y1);
  octx.lineTo(x1 - Math.cos(ang - 0.4) * head, y1 - Math.sin(ang - 0.4) * head);
  octx.lineTo(x1 - Math.cos(ang + 0.4) * head, y1 - Math.sin(ang + 0.4) * head);
  octx.closePath();
  octx.fill();
  const label = pad3(wind.dir) + '/' + wind.speed;
  octx.font = 'bold 11px sans-serif';
  octx.lineWidth = 3;                                 // text halo
  octx.strokeStyle = colorWithAlpha(tune('windTextHaloColor'), 0.9);
  octx.strokeText(label, x1 + 6, y1 + 3);
  octx.fillText(label, x1 + 6, y1 + 3);
  octx.restore();
}

// Drift reference lines, one from each end, defaulting to half the leg length.
function drawDriftLines(sa, sb) {
  const a = driftAngleRad();
  const c = Math.cos(a), s = Math.sin(a);
  const abx = sb.x - sa.x, aby = sb.y - sa.y;
  const bax = -abx, bay = -aby;
  const dlw = (typeof driftLineWidth === 'number' && driftLineWidth > 0) ? driftLineWidth : 1;
  const lenFactor = tune('driftLengthFactor');
  octx.save();
  octx.setLineDash([tune('driftDashOnPx'), tune('driftDashOffPx')]);
  octx.lineWidth = tune('driftStrokeWidthPx') * dlw;
  octx.strokeStyle = colorWithAlpha(tune('driftLineColor'), tune('driftLineAlpha'));
  octx.beginPath();
  octx.moveTo(sa.x, sa.y);
  octx.lineTo(sa.x + (abx * c - aby * s) * lenFactor, sa.y + (abx * s + aby * c) * lenFactor);
  octx.moveTo(sb.x, sb.y);
  octx.lineTo(sb.x + (bax * c - bay * s) * lenFactor, sb.y + (bax * s + bay * c) * lenFactor);
  octx.stroke();
  octx.restore();
}

function drawMinuteMarkers(sa, sb, durH) {
  const totalMin = durH * 60;
  if (totalMin < 1) return;
  let dx = sb.x - sa.x, dy = sb.y - sa.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const nx = -dy, ny = dx;
  octx.font = `bold ${tune('minuteMarkerFontPx')}px sans-serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  const count = Math.floor(totalMin);
  for (let m = 1; m <= count; m++) {
    const f = m / totalMin;
    const px = sa.x + (sb.x - sa.x) * f;
    const py = sa.y + (sb.y - sa.y) * f;
    const even = m % 2 === 0;
    const tick = even ? tune('minuteTickEvenPx') : tune('minuteTickOddPx');
    octx.strokeStyle = tune('inkColor');
    octx.lineWidth = even ? tune('minuteTickEvenWidthPx') : tune('minuteTickOddWidthPx');
    octx.beginPath();
    octx.moveTo(px - nx * tick, py - ny * tick);
    octx.lineTo(px + nx * tick, py + ny * tick);
    octx.stroke();
    if (even) {                         // minute number past the tick end
      const tx = px + nx * (tick + tune('minuteLabelOffsetPx'));
      const ty = py + ny * (tick + tune('minuteLabelOffsetPx'));
      octx.fillStyle = tune('inkColor');
      octx.font = `bold ${tune('minuteMarkerFontPx')}px sans-serif`;
      octx.fillText(String(m), tx, ty);
    }
  }
  octx.textAlign = 'left';
}

// Highlight when altitude OR speed differs from the adjacent leg.
// 'in'  -> compare with previous leg's inbound altitude/speed.
// 'out' -> compare with next leg's outbound altitude/speed (return direction).
function needsHalo(i, which) {
  if (!highlightDiff) return false;
  const cur = state.legs[i];
  if (which === 'in') {
    if (i === 0) return false;
    const prev = state.legs[i - 1];
    return !sameAltitudeValue(cur.inboundAltitude, prev.inboundAltitude) ||
           cur.flightSpeed     !== prev.flightSpeed;
  }
  if (i === state.legs.length - 1) return false;
  const next = state.legs[i + 1];
  return !sameAltitudeValue(cur.outboundAltitude, next.outboundAltitude) ||
         cur.outboundSpeed    !== next.outboundSpeed;
}

// Cumulative-time marker: < [time]
// A backward-pointing triangle (tip toward the leg origin) joined to a single
// rectangle cell showing the running total time from departure to this leg.
// Drawn on the opposite perpendicular side from the main inbound kite so both
// markers are always visible without overlap.
function drawCumTimeArrow(cx, cy, flightAng, cumTime, accent, fill, sc) {
  sc = sc ?? 1;
  let W = tune('cumKiteHeightPx') * sc;
  let cell = tune('cumKiteCellWidthPx') * sc;
  let Lt = tune('cumKiteTriangleLenPx') * sc;
  // Framed A4/A3 export pins the cum-time kite to a fixed physical size at
  // size-selector (legArrowSize) 1, scaled by the selector otherwise — body
  // cell + triangle length × height (triangle on the short side). Each
  // dimension is set from mm × NavAid._exportPxPerMm; `sc` is re-derived from
  // the printed height so border / text stay proportional. Screen unchanged.
  const ppm = (window.NavAid && NavAid._exportPxPerMm) || 0;
  if (ppm) {
    const selc = (typeof legArrowSize === 'number' && legArrowSize > 0) ? legArrowSize : 1;
    W = tune('cumKitePrintHeightMm') * ppm * selc;
    cell = tune('cumKitePrintLengthMm') * ppm * selc;
    Lt = tune('cumKitePrintTriangleMm') * ppm * selc;
    sc = W / tune('cumKiteHeightPx');
  }
  const L = Lt + cell;
  // Pentagon: tip on the LEFT (= backward along flightAng), rectangle on right.
  octx.save();
  octx.translate(cx, cy);
  octx.rotate(flightAng);
  const xb = L / 2 - Lt;                // rectangle/triangle junction
  octx.beginPath();
  octx.moveTo(-L / 2, -W / 2);          // top-left of rectangle
  octx.lineTo(xb,     -W / 2);
  octx.lineTo( L / 2,  0);              // → tip pointing toward B waypoint
  octx.lineTo(xb,      W / 2);
  octx.lineTo(-L / 2,  W / 2);          // bottom-left of rectangle
  octx.closePath();
  octx.fillStyle = fill;
  octx.fill();
  octx.lineWidth = tune('cumKiteBorderPx') * sc;
  octx.strokeStyle = accent;
  octx.stroke();
  octx.restore();

  const fontPx = Math.max(4, Math.round(tune('cumKiteTextPx') * sc));
  const cos = Math.cos(flightAng), sin = Math.sin(flightAng);
  const textLx = -L / 2 + cell / 2;     // centre of the rectangle cell (excludes the triangle)
  const p = { x: cx + textLx * cos, y: cy + textLx * sin };
  octx.save();
  octx.translate(p.x, p.y);
  // Text orientation matches the navigation kite (flightAng+π = ang+π/2 when kite is at ang-π/2).
  let textAng = flightAng + Math.PI;
  if (Math.cos(textAng) < 0) textAng += Math.PI;
  octx.rotate(textAng);
  octx.font = `bold ${fontPx}px sans-serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillStyle = tune('kiteTextColor');
  octx.fillText(cumTime, 0, 0);
  octx.restore();
}

// Navigation leg marker: a two-cell rectangle (altitude, time) joined to a
// triangle (heading) pointing in the flight direction. Text runs across the
// marker and is locked to its orientation.
function drawLegArrow(cx, cy, flightAng, head, time, alt, accent, fill, halo, sc) {
  sc = sc ?? 1;
  let W = tune('legKiteHeightPx') * sc;
  let cell = tune('legKiteCellWidthPx') * sc;
  let Lt = tune('legKiteTriangleLenPx') * sc;
  // Framed A4/A3 export pins the kite to a fixed physical size at size-selector
  // 1 (× legArrowSize for other selector values): body length (2 cells) ×
  // height + triangle, in mm. The three tune-px ratios don't match the target
  // mm ratios, so each dimension is set independently; `sc` is re-derived from
  // the printed height so borders / dividers / text stay proportional. Screen
  // size is unchanged. printed mm = screenPx / (screen-px-per-mm).
  const ppm = (window.NavAid && NavAid._exportPxPerMm) || 0;
  if (ppm) {
    const sel = (typeof legArrowSize === 'number' && legArrowSize > 0) ? legArrowSize : 1;
    W = tune('kitePrintHeightMm') * ppm * sel;
    cell = tune('kitePrintLengthMm') / 2 * ppm * sel;
    Lt = tune('kitePrintTriangleMm') * ppm * sel;
    sc = W / tune('legKiteHeightPx');   // keep borders / text proportional to height
  }
  const Lr = cell * 2, L = Lr + Lt;
  const xb = -L / 2 + Lr;

  octx.save();
  octx.translate(cx, cy);
  octx.rotate(flightAng);
  octx.beginPath();
  octx.moveTo(-L / 2, -W / 2);
  octx.lineTo(xb, -W / 2);
  octx.lineTo(L / 2, 0);
  octx.lineTo(xb, W / 2);
  octx.lineTo(-L / 2, W / 2);
  octx.closePath();
  if (halo) {                            // purple band around the marker
    octx.lineJoin = 'round';
    octx.lineWidth = tune('legKiteHaloPx') * sc;
    octx.strokeStyle = tune('legKiteHaloColor');
    octx.stroke();
    octx.lineJoin = 'miter';
  }
  octx.fillStyle = fill;
  octx.fill();
  octx.lineWidth = tune('legKiteBorderPx') * sc;
  octx.strokeStyle = accent;
  octx.stroke();
  octx.lineWidth = tune('legKiteDividerPx') * sc;
  for (const dx of [-L / 2 + cell, xb]) {
    octx.beginPath();
    octx.moveTo(dx, -W / 2);
    octx.lineTo(dx, W / 2);
    octx.stroke();
  }
  octx.restore();

  const fontPx = Math.max(4, Math.round(tune('legKiteTextPx') * sc));
  const fontPxH = Math.max(4, Math.round(tune('legKiteHeadingTextPx') * sc));
  const ta = flightAng + Math.PI / 2;
  const cos = Math.cos(flightAng), sin = Math.sin(flightAng);
  const at = lx => ({ x: cx + lx * cos, y: cy + lx * sin });
  const pAlt = at(-L / 2 + cell * 0.5);
  const pTime = at(-L / 2 + cell * 1.5);
  const pHead = at(xb + Lt * tune('legKiteHeadingAnchor'));
  drawRotText(pAlt.x, pAlt.y, ta, alt, `bold ${fontPx}px sans-serif`, tune('kiteTextColor'));
  drawRotText(pTime.x, pTime.y, ta, time, `bold ${fontPx}px sans-serif`, tune('kiteTextColor'));
  drawRotText(pHead.x, pHead.y, ta, head, `bold ${fontPxH}px sans-serif`, tune('kiteTextColor'));
}

function drawRotText(x, y, ang, text, font, color) {
  octx.save();
  octx.translate(x, y);
  octx.rotate(ang);
  octx.font = font;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillStyle = color;
  octx.fillText(text, 0, 0);
  octx.restore();
}

function drawDistanceBadge(cx, cy, dist) {
  octx.beginPath();
  octx.arc(cx, cy, tune('distanceBadgeRadiusPx'), 0, Math.PI * 2);
  octx.fillStyle = tintFill(tune('distanceBadgeFillColor'));
  octx.fill();
  octx.lineWidth = tune('distanceBadgeBorderPx');
  octx.strokeStyle = tune('inkColor');
  octx.stroke();
  octx.fillStyle = tune('inkColor');
  octx.font = `bold ${tune('distanceBadgeFontPx')}px sans-serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(dist.toFixed(1), cx, cy);
  octx.textAlign = 'left';
}

// Label to draw inside a waypoint circle, plus the radius and font px
// needed to fit it. Scaled by wpSize slider × zoom (geographic footprint
// stays roughly constant; floor at 0.35× so markers stay visible when zoomed out).
function waypointGeom(i) {
  const wp = state.waypoints[i];
  // Match wpLabel() / inspector placeholder ("WP N"), not a bare digit.
  const label = showWpNames ? waypointDisplayLabel(wp, i) : '';
  const zoomScale = Math.max(tune('waypointMinZoomScale'), Math.pow(2, map.getZoom() - 12));
  // Framed A4/A3 export pins the disc to a fixed physical diameter
  // (waypointPrintDiaMm) via NavAid._exportPxPerMm; on screen it stays the
  // wpSize × zoom size. Derive `scale` from whichever radius applies so the
  // text still fits the disc.
  const exportPpm = (window.NavAid && NavAid._exportPxPerMm) || 0;
  // At size-selector 1 the disc prints at waypointPrintDiaMm; wpSize scales it.
  const exportR = exportPpm ? (tune('waypointPrintDiaMm') / 2) * exportPpm * wpSize : 0;
  const scale = exportR
    ? exportR / tune('waypointBaseRadiusPx')
    : wpSize * zoomScale;
  // Every waypoint circle is the SAME size (radius depends only on the wpSize
  // slider × zoom, never on the label). The text shrinks to fit instead of the
  // circle growing — so a 5-letter code and a single digit share one disc.
  const r = tune('waypointBaseRadiusPx') * scale;
  let fontPx = Math.max(4, Math.round(tune('waypointFontPx') * scale));
  if (label) {
    octx.font = `bold ${fontPx}px sans-serif`;
    const w = octx.measureText(label).width;
    const maxW = 2 * r * tune('waypointTextFitFactor');   // usable text width inside the disc
    if (w > maxW && maxW > 0) fontPx = Math.max(4, Math.floor(fontPx * maxW / w));
  }
  return { label, fontPx, r };
}

// Selection highlight (stronger colour / thicker stroke) is an on-screen
// affordance only — never bake it into the PNG export (NavAid.exporting), so a
// selected waypoint/leg/note prints identically to the rest.
function selectionVisible() {
  return !(window.NavAid && NavAid.exporting);
}
function drawWaypoints() {
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    if (!wp) continue;   // skip a null/hole (corrupt/partially-applied state) rather than throwing in proj()
    const s = proj(wp);
    const selected = selectionVisible() && state.selected &&
                     state.selected.type === 'wp' &&
                     state.selected.index === i;
    const { label, fontPx, r } = waypointGeom(i);
    const radius = selected ? r + tune('waypointSelectedRadiusAddPx') : r;

    octx.beginPath();
    octx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    octx.fillStyle = selected ? tune('selectedColor') : tintFill(tune('waypointFillColor'));
    octx.fill();
    octx.lineWidth = tune('waypointStrokeWidthPx');
    octx.strokeStyle = tune('inkColor');
    octx.stroke();

    octx.font = `bold ${fontPx}px sans-serif`;
    octx.fillStyle = tune('inkColor');
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(label, s.x, s.y);
    octx.textAlign = 'left';
  }
}

// --- notes (free-text annotation boxes) ------------------------------
// Per-note size multiplier (default 1). Clamped so a note can't shrink to
// nothing or blow up the canvas. Applied to the font and every rect metric so
// the note scales uniformly around its anchor point. The note also grows and
// shrinks with the map zoom, on the same 2^(z-12) curve (clamped like
// legZoomScale) the leg/nav kites use, so a note keeps its geographic footprint
// relative to the kites it annotates instead of staying a fixed screen size.
function noteUserSize(n) {
  const s = Number(n && n.size);
  return Number.isFinite(s) && s > 0 ? Math.max(0.5, Math.min(s, 4)) : 1;
}
function noteScale(n) {
  const user = noteUserSize(n);
  // Framed A4/A3 export pins a default (size-1) note to notePrintHeightMm tall:
  // one line + top/bottom padding must span that many mm. printed mm =
  // screenPx / (screen-px-per-mm), so pick the scale that makes the 1-line box
  // equal to the target physical height. Screen size is unchanged.
  const ppm = (window.NavAid && NavAid._exportPxPerMm) || 0;
  if (ppm) {
    const oneLinePx = tune('noteLineHeightPx') + tune('notePadYPx') * 2;
    return user * (tune('notePrintHeightMm') * ppm) / oneLinePx;
  }
  const zoom = (typeof map !== 'undefined' && map.getZoom)
    ? Math.max(0.35, Math.pow(2, map.getZoom() - 12)) : 1;
  return user * zoom;
}
function noteFont(n) {
  return `bold ${tune('noteFontPx') * noteScale(n)}px sans-serif`;
}

function noteRect(i) {
  const n = state.notes[i];
  if (n && n.cc) return commCalloutRect(n);
  const s = proj(n);
  const sc = noteScale(n);
  const lines = noteLines(n);
  const lineH = tune('noteLineHeightPx') * sc;
  octx.font = noteFont(n);
  let maxW = 1;
  for (const l of lines) {
    const w = octx.measureText(l || ' ').width;
    if (w > maxW) maxW = w;
  }
  // In framed export the default box is pinned to notePrintWidthMm wide (× the
  // note's own size); on screen it's the usual noteMinWidthPx × scale floor.
  const ppm = (window.NavAid && NavAid._exportPxPerMm) || 0;
  const minW = ppm
    ? tune('notePrintWidthMm') * ppm * noteUserSize(n)
    : tune('noteMinWidthPx') * sc;
  let w = Math.max(maxW + tune('notePadXPx') * sc * 2, minW);
  let h = Math.max(1, lines.length) * lineH + tune('notePadYPx') * sc * 2;
  const oval = n.shape === 'oval';
  // On screen the ellipse is grown by √2 so it bounds the text; on a framed
  // export the oval is pinned to the same default box as the rectangle
  // (notePrintWidthMm × notePrintHeightMm), so both note shapes print the same
  // physical size.
  if (oval && !ppm) { w *= Math.SQRT2; h *= Math.SQRT2; }
  return { x: s.x - w / 2, y: s.y - h / 2, w, h, lines, oval };
}

function commCalloutTextMetrics(lines) {
  const name = lines[0] || '';
  const freq = lines[1] || '';
  const namePx = tune('commChangeNameFontPx');
  const freqPx = tune('commChangeFreqFontPx');
  const oldFont = octx.font;
  octx.font = `bold ${namePx}px sans-serif`;
  const nameW = octx.measureText(name || ' ').width;
  octx.font = `bold ${freqPx}px sans-serif`;
  const freqW = octx.measureText(freq || ' ').width;
  octx.font = oldFont;
  return { name, freq, namePx, freqPx, nameW, freqW };
}

function colorWithAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  const m = typeof color === 'string' && color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function commCalloutGeom(n) {
  const target = commCalloutTarget(n);
  if (!target) return null;
  const lines = noteLines(n);
  const text = commCalloutTextMetrics(lines);
  const targetCenter = proj(target);
  const fp = proj(n);
  let dx = fp.x - targetCenter.x;
  let dy = fp.y - targetCenter.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return null;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const key = canonicalNavWaypointName(n.cc);
  const routeIdx = state.waypoints.findIndex(w => w &&
    canonicalNavWaypointName(w.name) === key);
  const targetRadius = routeIdx >= 0
    ? waypointGeom(routeIdx).r + tune('waypointStrokeWidthPx') / 2
    : tune('commChangeRingRadiusPx') + tune('commChangeRingWidthPx') / 2;
  const startGap = Math.max(0, tune('commChangeArrowStartGapPx'));
  const startClear = Math.min(Math.max(0, len - 4), targetRadius + startGap);
  const tp = {
    x: targetCenter.x + ux * startClear,
    y: targetCenter.y + uy * startClear,
  };
  dx = fp.x - tp.x;
  dy = fp.y - tp.y;
  const pathLen = Math.hypot(dx, dy) || 1;
  const width = tune('commChangeArrowWidthPx');
  const halo = tune('commChangeArrowHaloPx');
  const bolt = tune('commChangeArrowBoltPx');
  const boltAngle = tune('commChangeArrowBoltAngleDeg') * Math.PI / 180;
  const boltX = ux * Math.cos(boltAngle) + nx * Math.sin(boltAngle);
  const boltY = uy * Math.cos(boltAngle) + ny * Math.sin(boltAngle);
  const bend1 = {
    x: tp.x + dx * tune('commChangeArrowBend1Along') + boltX * bolt,
    y: tp.y + dy * tune('commChangeArrowBend1Along') + boltY * bolt,
  };
  const bend2 = {
    x: tp.x + dx * tune('commChangeArrowBend2Along') - boltX * bolt,
    y: tp.y + dy * tune('commChangeArrowBend2Along') - boltY * bolt,
  };
  const bends = [bend1, bend2];
  const points = [tp, ...bends, fp];
  const segs = [];
  let totalPath = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen <= 0) continue;
    segs.push({ a, b, len: segLen });
    totalPath += segLen;
  }
  let want = totalPath * tune('commChangeTextAlong');
  let textSeg = segs[segs.length - 1];
  for (const seg of segs) {
    if (want <= seg.len) { textSeg = seg; break; }
    want -= seg.len;
  }
  const textT = textSeg ? Math.max(0, Math.min(1, want / textSeg.len)) : 0;
  const tx = textSeg ? textSeg.a.x + (textSeg.b.x - textSeg.a.x) * textT : fp.x;
  const ty = textSeg ? textSeg.a.y + (textSeg.b.y - textSeg.a.y) * textT : fp.y;
  let textAngle = textSeg ? Math.atan2(textSeg.b.y - textSeg.a.y, textSeg.b.x - textSeg.a.x)
                          : Math.atan2(uy, ux);
  if (Math.cos(textAngle) < 0) textAngle += Math.PI;
  const textGap = tune('commChangeTextGapPx');
  return {
    target: tp, targetCenter, targetRadius, startGap, tail: fp, bends, bend1, bend2,
    ux, uy, nx, ny, len: pathLen, width, halo, textGap,
    textX: tx, textY: ty, textAngle, text, lines,
  };
}

function commCalloutRect(n) {
  const g = commCalloutGeom(n);
  if (!g) {
    const s = proj(n);
    return { x: s.x - 20, y: s.y - 20, w: 40, h: 40, lines: noteLines(n), oval: false, comm: true };
  }
  const maxTextW = Math.max(g.text.nameW, g.text.freqW);
  const textH = g.text.namePx + g.text.freqPx + g.width + g.textGap * 2;
  const pad = Math.max(g.width + g.halo * 2, 16) + 8;
  const xs = [g.tail.x, g.target.x, ...g.bends.map(p => p.x),
    g.textX - maxTextW / 2, g.textX + maxTextW / 2];
  const ys = [g.tail.y, g.target.y, ...g.bends.map(p => p.y),
    g.textY - textH / 2, g.textY + textH / 2];
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, lines: g.lines, oval: false, comm: true };
}

function strokeCommCalloutShape(g, width, style, alpha) {
  octx.strokeStyle = style;
  octx.globalAlpha = alpha;
  octx.lineWidth = width;
  octx.lineCap = tune('commChangeArrowLineCap');
  octx.lineJoin = tune('commChangeArrowLineJoin');
  octx.miterLimit = tune('commChangeArrowMiterLimit');
  octx.beginPath();
  octx.moveTo(g.target.x, g.target.y);
  for (const p of g.bends) octx.lineTo(p.x, p.y);
  octx.lineTo(g.tail.x, g.tail.y);
  octx.stroke();
  octx.globalAlpha = 1;
}

function drawCommCalloutText(g) {
  const name = g.text.name ? g.text.name.toUpperCase() : '';
  const freq = g.text.freq || '';
  if (!name && !freq) return;
  octx.save();
  octx.translate(g.textX, g.textY);
  octx.rotate(g.textAngle);
  octx.textAlign = 'center';
  octx.lineJoin = 'round';
  const halo = colorWithAlpha(tune('commChangeTextHaloColor'), tune('commChangeTextHaloAlpha'));
  const textColor = tune('commChangeTextColor');
  if (name) {
    octx.font = `bold ${g.text.namePx}px sans-serif`;
    octx.textBaseline = 'bottom';
    const y = -g.width / 2 - g.textGap;
    octx.lineWidth = tune('commChangeNameHaloWidthPx');
    octx.strokeStyle = halo;
    octx.strokeText(name, 0, y);
    octx.fillStyle = textColor;
    octx.fillText(name, 0, y);
  }
  if (freq) {
    octx.font = `bold ${g.text.freqPx}px sans-serif`;
    octx.textBaseline = 'top';
    const y = g.width / 2 + g.textGap;
    octx.lineWidth = tune('commChangeFreqHaloWidthPx');
    octx.strokeStyle = halo;
    octx.strokeText(freq, 0, y);
    octx.fillStyle = textColor;
    octx.fillText(freq, 0, y);
  }
  octx.restore();
}

function drawCommCallout(n, selected) {
  const g = commCalloutGeom(n);
  if (!g) return;
  octx.save();
  if (selected) {
    strokeCommCalloutShape(g, g.width + tune('commChangeSelectedWidthAddPx'),
      tune('commChangeSelectedColor'), tune('commChangeSelectedAlpha'));
  }
  if (g.halo > 0) {
    const halo = colorWithAlpha(tune('commChangeArrowHaloColor'), tune('commChangeArrowHaloAlpha'));
    strokeCommCalloutShape(g, g.width + g.halo * 2, halo, 1);
  }
  strokeCommCalloutShape(g, g.width, tune('commChangeArrowColor'), 1);
  drawCommCalloutText(g);
  octx.restore();
}

function selectedCommCallout(i) {
  if (!state.selected) return false;
  if (state.selected.type === 'note' && state.selected.index === i) return true;
  return state.selected.type === 'wp' && state.selected.freqNoteIndex === i;
}

function drawNotes() {
  for (let i = 0; i < state.notes.length; i++) {
    const n = state.notes[i];
    if (n && n.cc && !showCommChange) continue;
    const r = noteRect(i);
    const selected = selectionVisible() && (n && n.cc
      ? selectedCommCallout(i)
      : state.selected &&
        state.selected.type === 'note' &&
        state.selected.index === i);
    const color = n.color || tune('noteDefaultFillColor') || NOTE_DEFAULT_COLOR;
    if (n.cc) {
      drawCommCallout(n, selected);
      continue;
    }
    octx.fillStyle = tintFill(color, tune('kiteNoteAlpha'));   // notes share the gist-tuned kite opacity
    octx.lineWidth = selected ? tune('noteSelectedStrokeWidthPx') : tune('noteStrokeWidthPx');
    octx.strokeStyle = selected ? tune('selectedColor') : tune('inkColor');
    if (r.oval) {
      octx.beginPath();
      octx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2,
                   0, 0, Math.PI * 2);
      octx.fill();
      octx.stroke();
    } else {
      octx.fillRect(r.x, r.y, r.w, r.h);
      octx.strokeRect(r.x, r.y, r.w, r.h);
    }

    const lineH = tune('noteLineHeightPx') * noteScale(n);
    octx.font = noteFont(n);
    octx.fillStyle = tune('inkColor');
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    const cx = r.x + r.w / 2;
    const y0 = r.y + (r.h - r.lines.length * lineH) / 2;
    for (let j = 0; j < r.lines.length; j++) {
      octx.fillText(r.lines[j], cx, y0 + lineH / 2 + j * lineH);
    }
    octx.textAlign = 'left';
  }
}

function drawInfo() {
  let totalDist = 0, totalH = 0;
  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    if (!A || !B) continue;   // legs can transiently outnumber waypoints-1 mid-edit; guard like the sibling loops
    const { dist } = geo(A, B);
    totalDist += dist;
    if (state.legs[i].flightSpeed > 0) totalH += dist / state.legs[i].flightSpeed;
  }
  document.getElementById('info').textContent =
    `${S.summaryWaypoints}: ${state.waypoints.length}\n` +
    `${S.summaryLegs}: ${state.legs.length}\n` +
    `${S.summaryDist}: ${totalDist.toFixed(1)} NM\n` +
    `${S.summaryTime}: ${totalH > 0 ? toHMS(totalH) : '--'}`;
}

// --- print page frame -----------------------------------------------
// Landscape page coverage in nautical miles at 1:250,000.
const PAGE_NM = { A4: { w: 40.09, h: 28.35 }, A3: { w: 56.70, h: 40.09 },
                  // A4x2 = the A3 frame, exported as two A4 tiles.
                  A4x2: { w: 56.70, h: 40.09 } };

function metresPerPixel() {
  const y = vh() / 2;
  const a = map.containerPointToLatLng([0, y]);
  const b = map.containerPointToLatLng([200, y]);
  return map.distance(a, b) / 200;
}

function pageDims() {                   // page coverage (NM), oriented
  const p = PAGE_NM[pageSize];
  return pageOrient === 'portrait' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

function pageFrameRect() {
  if (!pageSize) return null;
  const mpp = metresPerPixel();
  const d = pageDims();
  const w = d.w * 1852 / mpp;
  const h = d.h * 1852 / mpp;
  return { x: (vw() - w) / 2 + pageOffset.x,
           y: (vh() - h) / 2 + pageOffset.y, w, h };
}

// True if (px,py) is on the page-frame border band — the drag grip.
function hitPageFrameEdge(px, py) {
  const r = pageFrameRect();
  if (!r) return false;
  const t = tune('pageFrameHitPx');
  const inOuter = px >= r.x - t && px <= r.x + r.w + t &&
                  py >= r.y - t && py <= r.y + r.h + t;
  const inInner = px >= r.x + t && px <= r.x + r.w - t &&
                  py >= r.y + t && py <= r.y + r.h - t;
  return inOuter && !inInner;
}

// Keep the frame centre on screen so it can always be grabbed back.
function clampPageOffset() {
  pageOffset.x = Math.max(-vw() / 2, Math.min(vw() / 2, pageOffset.x));
  pageOffset.y = Math.max(-vh() / 2, Math.min(vh() / 2, pageOffset.y));
}

// Render the flight-plan table onto a canvas at (x,y), auto-sizing columns to
// content. `w`/`h` are the available box; the table is anchored within it per
// `align` ('tl'|'tr'|'bl'|'br'|'center'). Returns the rendered { x, y, w, h }
// (or null when there's no route). Paper-print look — white bg, black text.
// Shared by the live export preview and the PNG render so they match exactly.
function drawFlightPlanTable(ctx, x, y, w, h, align) {
  const legs = state.legs || [];
  const wpts = state.waypoints || [];
  if (!legs.length || wpts.length < 2) return null;
  // Default to 8 gph when no aircraft is configured (matches the printed
  // flight plan) so the Fuel / Cum. fuel columns aren't just '--'.
  const ac = (typeof aircraft === 'object' && aircraft) ? aircraft : { gph: tune('defaultGph'), taxiGal: tune('defaultTaxiGal') };
  const taxiFuel = ac && ac.taxiGal && typeof isAirport === 'function' && isAirport(wpts[0]) ? ac.taxiGal : 0;
  const empty = S.fpVorRadialEmpty || '—';
  // Radial / DME of a waypoint from the leg's reference VOR (per-leg override,
  // else the global reference). Blank when no VOR is selected.
  const vorCells = (wp, lg) => {
    const v = (lg && lg.vorRef && typeof vorByIdent === 'function' ? vorByIdent(lg.vorRef) : null) ||
              (typeof activeVor === 'function' ? activeVor() : null);
    if (!v || !wp || typeof vorRadialDme !== 'function') return [empty, empty];
    const rd = vorRadialDme(v, wp.lat, wp.lng);
    return rd ? ['R-' + rd.radial, String(rd.dme)] : [empty, empty];
  };
  const rows = [];
  let totTime = 0, totFuel = 0;
  for (let i = 0; i < legs.length; i++) {
    const A = wpts[i], B = wpts[i + 1];
    if (!A || !B) continue;
    const { dist, brg } = geo(A, B);
    const hdg = toMagnetic(brg);
    const dur = legs[i].flightSpeed > 0 ? dist / legs[i].flightSpeed : 0;
    let fuel = ac ? dur * ac.gph : 0;
    if (i === 0 && taxiFuel) fuel += taxiFuel;
    totTime += dur; totFuel += fuel;
    const fLabel = ac ? fuel.toFixed(1) + (i === 0 && taxiFuel ? ' *' : '') : '--';
    const rd = vorCells(B, legs[i]);
    rows.push({ num: i + 1, from: waypointDisplayLabel(A, i),
      to: waypointDisplayLabel(B, i + 1),
      hdg: pad3(hdg) + '°M', dist: dist.toFixed(1),
      speed: String(legs[i].flightSpeed),
      // Guard non-finite (unknown) altitude like the kite + flight-plan modal do,
      // so the PNG plan card shows the unknown-label instead of the literal "NaN".
      alt: formatAltitudeValue(legs[i].inboundAltitude, legs[i], 'inboundAltitude'),
      time: dur > 0 ? toHMS(dur) : '--', fuel: fLabel,
      cumTime: totTime > 0 ? toHMS(totTime) : '--',
      cumFuel: ac ? totFuel.toFixed(1) : '--',
      radial: rd[0], dme: rd[1] });
  }
  if (!rows.length) return null;
  // Active comm frequency per leg — departure/arrival airfield freqs +
  // comm-change notes, carried forward (shared core logic, matches the
  // flight-plan modal so the printed table aligns with it).
  const freqSources = typeof routeFreqSources === 'function' ? routeFreqSources() : [];
  for (let r = 0; r < rows.length; r++) {
    rows[r].freq = typeof legActiveFreq === 'function' ? legActiveFreq(rows[r].num - 1, freqSources) : '';
  }
  const freqActive = rows.some(r => r.freq);
  // Fixed kneeboard column set: Destination, Direction, Altitude, Speed,
  // Time of leg, Fuel of leg, [Comm freq]. (Was #,From,To,Hdg,Dist,Spd,Alt,
  // Time,Fuel,CumTime,CumFuel,Radial,DME — trimmed to what a pilot reads.)
  // Radial / DME columns appear only when a reference VOR is selected (global
  // or any per-leg). The Radial header carries the reference VOR ident.
  const refVor = typeof activeVor === 'function' ? activeVor() : null;
  const vorActive = !!refVor || legs.some(l => l && l.vorRef);
  const headers = [
    '#',
    S.planColDestination || 'Destination',
    S.planColDirection || 'Direction',
    S.planColAltitude || 'Altitude',
    S.planColSpeed || 'Speed',
    S.planColLegTime || 'Time of leg',
    S.planColLegFuel || 'Fuel of leg',
  ];
  if (vorActive) headers.push((S.planColRadial || 'Radial') + (refVor ? ' ' + refVor.ident : ''),
    S.planColDme || 'DME');
  if (freqActive) headers.push(S.planColComm || 'Comm freq');
  const numCols = headers.length;
  const numRows = rows.length + 2;            // header + data + total
  // Derive the font FROM the row height (not an independent floor) so text
  // can never grow taller than its row → no vertical overlap at any size.
  const rowH = h / numRows;
  const fontSize = Math.max(1, Math.min(rowH * 0.62, 22));
  const padX = Math.max(2, Math.round(fontSize * 0.5));
  const aligns = ['center', 'left', 'center', 'right', 'right', 'center', 'right'];
  if (vorActive) aligns.push('center', 'right');
  if (freqActive) aligns.push('center');
  const valsOf = rd => {
    const v = [String(rd.num), rd.to, rd.hdg, rd.alt, rd.speed, rd.time, rd.fuel];
    if (vorActive) v.push(rd.radial, rd.dme);
    if (freqActive) v.push(rd.freq || '');
    return v;
  };
  ctx.save();
  ctx.font = fontSize + 'px sans-serif';
  // Totals row: total time (Time-of-leg col 5) + total fuel (Fuel-of-leg col 6).
  const totVals = { 5: totTime > 0 ? toHMS(totTime) : '--', 6: ac ? totFuel.toFixed(1) : '--' };
  const colW = new Array(numCols).fill(0);
  ctx.font = 'bold ' + fontSize + 'px sans-serif';
  for (let mc = 0; mc < numCols; mc++) {
    colW[mc] = Math.max(colW[mc], ctx.measureText(String(headers[mc])).width);
    if (totVals[mc] !== undefined) colW[mc] = Math.max(colW[mc], ctx.measureText(String(totVals[mc])).width);
  }
  ctx.font = fontSize + 'px sans-serif';
  for (let mr = 0; mr < rows.length; mr++) {
    const mvals = valsOf(rows[mr]);
    for (let mc = 0; mc < numCols; mc++) colW[mc] = Math.max(colW[mc], ctx.measureText(String(mvals[mc])).width);
  }
  for (let mc = 0; mc < numCols; mc++) colW[mc] = Math.ceil(colW[mc] + 2 * padX);
  const colX = new Array(numCols + 1).fill(0);
  for (let mc = 0; mc < numCols; mc++) colX[mc + 1] = colX[mc] + colW[mc];
  const totalW = colX[numCols];
  // Hebrew: render the table right-to-left — column 0 (Destination) on the
  // right, text alignment mirrored.
  const rtl = (typeof window !== 'undefined' && window.__navLang === 'he') ||
    (typeof document !== 'undefined' && document.documentElement &&
     document.documentElement.dir === 'rtl');
  const colLeft = c => (rtl ? totalW - colX[c] - colW[c] : colX[c]);
  const HEADER_BG = tune('planCardHeaderBgColor');
  const TOTAL_BG = tune('planCardTotalBgColor');
  const STRIPE_BG = tune('planCardStripeBgColor');
  const GRID = tune('planCardGridColor');
  const TEXT = tune('planCardTextColor');
  const tableH = Math.round(rowH * numRows);
  const al = align || 'tl';
  if (al === 'tr' || al === 'br') x = x + Math.max(0, w - totalW);
  if (al === 'bl' || al === 'br') y = y + Math.max(0, h - tableH);
  if (al === 'center') { x = x + Math.max(0, (w - totalW) / 2); y = y + Math.max(0, (h - tableH) / 2); }
  // Integer-snapped row boundaries so cell text and grid lines line up exactly
  // (fractional row heights otherwise drift the text off its row at small
  // sizes). Every row uses rowY[row]..rowY[row+1].
  const rowY = new Array(numRows + 1);
  for (let i = 0; i <= numRows; i++) rowY[i] = y + Math.round(i * rowH);
  const tableHActual = rowY[numRows] - y;
  ctx.fillStyle = tune('planCardBgColor');
  ctx.fillRect(x, y, totalW, tableHActual);
  function cell(row, col, text, bold, bg) {
    const cx = x + colLeft(col), cy = rowY[row], rh = rowY[row + 1] - rowY[row], cw = colW[col];
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(cx, cy, cw, rh); }
    ctx.fillStyle = TEXT;
    ctx.font = (bold ? 'bold ' : '') + fontSize + 'px sans-serif';
    ctx.textBaseline = 'middle';
    let a = aligns[col];
    if (rtl) a = a === 'left' ? 'right' : a === 'right' ? 'left' : a;
    ctx.textAlign = a;
    const tx = a === 'right' ? cx + cw - padX : a === 'center' ? cx + cw / 2 : cx + padX;
    // 'middle' baseline centres the em-box, which reads slightly high; nudge
    // down a hair so glyphs sit visually centred in the row.
    ctx.fillText(text, tx, cy + rh / 2 + fontSize * 0.08);
  }
  ctx.fillStyle = HEADER_BG;
  ctx.fillRect(x, rowY[0], totalW, rowY[1] - rowY[0]);
  for (let c = 0; c < numCols; c++) cell(0, c, headers[c], true, null);
  for (let r = 0; r < rows.length; r++) {
    const vals = valsOf(rows[r]);
    for (let c2 = 0; c2 < numCols; c2++) cell(r + 1, c2, String(vals[c2]), false, r % 2 === 1 ? STRIPE_BG : null);
  }
  const tr = rows.length + 1;
  ctx.fillStyle = TOTAL_BG;
  ctx.fillRect(x, rowY[tr], totalW, rowY[tr + 1] - rowY[tr]);
  ctx.fillStyle = TEXT;
  ctx.font = 'bold ' + fontSize + 'px sans-serif';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(S.fpTotal,
    x + colLeft(1) + (rtl ? colW[1] - padX : padX),
    rowY[tr] + (rowY[tr + 1] - rowY[tr]) / 2 + fontSize * 0.08);
  for (let c4 = 0; c4 < numCols; c4++) if (totVals[c4] !== undefined) cell(tr, c4, String(totVals[c4]), true, null);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, totalW - 1, tableHActual - 1);
  ctx.lineWidth = 0.75;
  for (let gc = 1; gc < numCols; gc++) {
    const gx = Math.round(x + (rtl ? totalW - colX[gc] : colX[gc])) + 0.5;
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + tableHActual); ctx.stroke();
  }
  for (let gr = 1; gr < numRows; gr++) {
    const gy = rowY[gr] + 0.5;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + totalW, gy); ctx.stroke();
  }
  ctx.restore();
  return { x, y, w: totalW, h: tableHActual };
}

// Draw the placed flight-plan card on the overlay (live preview + export).
// Row height scales with planCard.scale; the export scale then renders it
// crisp at print DPI. Updates planCardRect for hit-testing drag + resize.
function drawPlanCard() {
  if (!planCard) { window.planCardRect = null; return; }
  const scale = planCard.scale > 0 ? planCard.scale : 1;
  const numRows = (state.legs ? state.legs.length : 0) + 2;
  const h = numRows * tune('planCardBaseRowPx') * scale;
  window.planCardRect = drawFlightPlanTable(octx, planCard.x, planCard.y, 1e6, h, 'tl');
  // The resize grip is a UI handle — never bake it into the exported PNG.
  if (!planCardRect || (window.NavAid && NavAid.exporting)) return;
  // Resize grip — a triangle in the bottom-right corner, with diagonal ribs.
  const r = planCardRect, g = tune('planCardGripPx');
  const ex = r.x + r.w, ey = r.y + r.h;
  octx.save();
  octx.fillStyle = tune('planCardGripColor');
  octx.beginPath();
  octx.moveTo(ex - g, ey);
  octx.lineTo(ex, ey);
  octx.lineTo(ex, ey - g);
  octx.closePath();
  octx.fill();
  octx.strokeStyle = tune('planCardGripLineColor');
  octx.lineWidth = 1.5;
  for (let i = 1; i <= 3; i++) {
    octx.beginPath();
    octx.moveTo(ex - i * 5, ey - 2);
    octx.lineTo(ex - 2, ey - i * 5);
    octx.stroke();
  }
  octx.restore();
}
// True if (px,py) is on the card's resize grip (a forgiving corner zone).
function planCardOnGrip(px, py) {
  const r = planCardRect;
  if (!r) return false;
  const z = tune('planCardGripPx') + 8;     // generous hit padding
  return px >= r.x + r.w - z && px <= r.x + r.w + 8 &&
         py >= r.y + r.h - z && py <= r.y + r.h + 8;
}

function drawPageFrame() {
  const r = pageFrameRect();
  if (!r) return;
  octx.save();
  octx.fillStyle = colorWithAlpha(tune('pageFrameScrimColor'), tune('pageFrameScrimAlpha'));
  octx.beginPath();
  octx.rect(0, 0, vw(), vh());
  octx.rect(r.x, r.y, r.w, r.h);
  octx.fill('evenodd');
  octx.strokeStyle = tune('selectedColor');
  octx.lineWidth = tune('pageFrameLineWidthPx');
  octx.setLineDash([tune('pageFrameDashOnPx'), tune('pageFrameDashOffPx')]);
  octx.strokeRect(r.x, r.y, r.w, r.h);
  // A4x2: dashed mid-line showing where the A3 frame is cut into the two A4
  // pages (vertical on a landscape frame, horizontal on a portrait one) —
  // matches the seam the exported tiles carry. Style is tunable (?tune=1,
  // "Page frame" group) and deliberately bolder than the frame border.
  if (pageSize === 'A4x2') {
    octx.strokeStyle = colorWithAlpha(tune('a4x2CutLineColor'), tune('a4x2CutLineAlpha'));
    octx.lineWidth = tune('a4x2CutLineWidthPx');
    octx.setLineDash([tune('a4x2CutDashOnPx'), tune('a4x2CutDashOffPx')]);
    octx.beginPath();
    if (r.w >= r.h) {
      octx.moveTo(r.x + r.w / 2, r.y);
      octx.lineTo(r.x + r.w / 2, r.y + r.h);
    } else {
      octx.moveTo(r.x,       r.y + r.h / 2);
      octx.lineTo(r.x + r.w, r.y + r.h / 2);
    }
    octx.stroke();
  }
  octx.restore();
}
