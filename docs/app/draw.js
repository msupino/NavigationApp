'use strict';
/* NavAid — drawing: route, nav-waypoints, notes, page frame.
   Shares globals with core.js; loaded after it. */

// Default-kite offset helpers, shared by `drawLegs` (rendering),
// `legLabelCenter` / `cumLabelCenter` (interact.js hit-testing) and the
// drag-start materialisers. Offsets are CONSTANT (independent of leg length):
// each kite sits the same distance from its leg / waypoint — nav kite by its
// drawn half-height + margin, cum kite by the waypoint disc + its own
// half-height + margin. (Earlier the nav offset added a `(legLen/2)*tan(drift)`
// drift-cone term, which made the distance grow with leg length.)
function driftAngleRad() {
  return tune('driftAngleDeg') * Math.PI / 180;
}
// Draw scale for the leg kite: a fixed GROUND size (kitePrintHeightMm at
// 1:250,000, × the legArrowSize selector) so it matches its print size and
// scales with the map. Falls back to the plain zoom scale before the map is
// ready. Shared by drawLegArrow (drawing) and legDefaultLabelPerp (clearance)
// so the default offset always clears the actual drawn kite.
function kiteDrawScale() {
  const ppm = (typeof printPxPerMm === 'function') ? printPxPerMm() : 0;
  const sel = (typeof legArrowSize === 'number' && legArrowSize > 0) ? legArrowSize : 1;
  return ppm
    ? (tune('kitePrintHeightMm') * ppm / tune('legKiteHeightPx')) * sel
    : ((typeof legZoomScale === 'function') ? legZoomScale() : 1);
}
function legDefaultLabelPerp(legLenPx) {
  // Nav (direction) kite sits just OUTSIDE the drift lines so it never hides
  // them. The drift line reaches `legLen * driftLengthFactor` at the drift
  // angle, i.e. its perpendicular extent is that × sin(angle) — grows with leg
  // length. Add the kite's drawn half-height + a margin (both geographic, so
  // they scale with the kite). legLen defaults to 0 (fallback for hit-tests
  // that don't pass it → just the kite-half + margin clearance).
  const driftPerp = Math.max(0, legLenPx || 0) * tune('driftLengthFactor') * Math.sin(driftAngleRad());
  return driftPerp +
         (tune('legKiteHeightPx') * kiteDrawScale()) / 2 +
         tune('defaultLabelMarginPx') * kiteDrawScale();
}
// Cumulative-time kite draw scale (fixed ground size, its own print height).
function cumKiteDrawScale() {
  const ppm = (typeof printPxPerMm === 'function') ? printPxPerMm() : 0;
  const sel = (typeof legArrowSize === 'number' && legArrowSize > 0) ? legArrowSize : 1;
  return ppm
    ? (tune('cumKitePrintHeightMm') * ppm / tune('cumKiteHeightPx')) * sel
    : ((typeof legZoomScale === 'function') ? legZoomScale() : 1);
}
// Waypoint disc radius in screen px (ground-sized). `sizeSel` defaults to the live
// wpSize selector; pass 1 for the shipped size (see cumDefaultLabelPerp).
function waypointDiscRadiusPx(sizeSel) {
  const ppm = (typeof printPxPerMm === 'function') ? printPxPerMm() : 0;
  const wpSz = Number.isFinite(sizeSel) ? sizeSel
    : ((typeof wpSize === 'number') ? wpSize : 1);
  return ppm
    ? (tune('waypointPrintDiaMm') / 2) * ppm * wpSz
    : tune('waypointBaseRadiusPx') * wpSz *
        Math.max(tune('waypointMinZoomScale'), Math.pow(2, map.getZoom() - 12));
}
// Constant offset of the cum-time kite from its waypoint anchor: clear the
// waypoint disc + the cum kite's own half-height + a margin. Not leg-length
// dependent, so the cum kite sits the same distance from every waypoint.
function cumDefaultLabelPerp() {
  // Clear the waypoint disc, then a full cum-kite height (so the whole kite sits
  // off the disc with a half-height gap), plus the margin. Keeps the cum kite
  // clearly separated from the waypoint.
  //
  // The disc term is taken at the SHIPPED waypoint size, not the live one: the
  // cumulative arrow belongs to the leg-arrow controls, and reading the live wpSize made
  // it slide outwards whenever waypoints were resized -- one slider moving another
  // slider's marker. The clearance is dominated by the arrow's own height anyway (at the
  // largest waypoint size the disc is r=24px while the arrow's near edge sits ~71px out),
  // so dropping the coupling cannot let the disc reach the arrow.
  return waypointDiscRadiusPx(1) +
         tune('cumKiteHeightPx') * cumKiteDrawScale() +
         tune('defaultLabelMarginPx') * cumKiteDrawScale();
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
function drawOwnShip(pos, hdg, gsKt) {
  if (!pos) return;
  // A frozen fix is drawn faded, and without the heading predictor: extrapolating a track
  // from a position that stopped updating is the one thing a stale fix must not do.
  const stale = typeof gpsFixStale === 'function' && gpsFixStale();
  if (!stale) drawHeadingLine(pos, hdg, gsKt);   // predictor under the aircraft symbol, freezes lastOwnHeadingDeg
  const s = proj(pos);
  // Screen angle from a projected geographic offset in the heading direction,
  // so it stays correct under map rotation (map.setBearing) — same approach as
  // the wind/kite arrows. (The manual `heading − mapBearing` was only right at
  // north-up.) The silhouette's nose is up (−y) in local frame, hence +90°.
  // Same frozen-last-heading fallback as the predictor line, not a bare `|| 0`:
  // a missing/NaN heading is not "confirmed heading 0 (north)", and locking the
  // icon onto true north whenever the device drops course reporting (routine
  // while stationary/taxiing) was the actual bug, not just the line beneath it.
  const h = Number.isFinite(hdg) ? hdg : (Number.isFinite(lastOwnHeadingDeg) ? lastOwnHeadingDeg : 0);
  const to = h * Math.PI / 180;
  const eps = 0.02;   // ~1.2 NM; used for direction only
  const p2 = proj({
    lat: pos.lat + Math.cos(to) * eps,
    lng: pos.lng + Math.sin(to) * eps / Math.cos(pos.lat * Math.PI / 180),
  });
  const screenAngle = Math.atan2(p2.y - s.y, p2.x - s.x) + Math.PI / 2;
  const r = tune('liveAircraftRadiusPx');
  octx.save();
  // Inside the existing save/restore, on the overlay canvas the symbol is actually drawn on.
  if (stale) octx.globalAlpha = 0.35;
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

// Heading predictor for the own-ship (live GPS + simulator). A straight line along the
// current track with TWO sets of cross-tick marks: fixed distance (2/5/10 NM, each
// labelled with its own time-to-reach) and fixed time (2/5 minutes ahead, each labelled
// with the distance it works out to at the current groundspeed) -- both, not either/or.
// The NM marks draw regardless of speed (their position never depended on it); the
// minute marks need a groundspeed to derive a distance from and are simply omitted
// without one, same "omit rather than guess" rule the rest of this feature follows.
// Uses the same NM→geo offset as notamCirclePoints and projects every point, so it
// stays correct under map rotation. GPS course goes null at zero groundspeed, so the
// last valid heading is remembered and reused (the line freezes rather than flicker).
const HEADING_LINE_MARKS_NM = [2, 5, 10];
const HEADING_LINE_MARKS_MIN = [2, 5];
let lastOwnHeadingDeg = null;
// Clear the frozen predictor heading when the own-ship SOURCE changes (live GPS
// start, sim start). Without this, restarting live location while parked (GPS
// course goes null at zero groundspeed → falls back to the last heading) points
// confidently at a stale course, and switching sim↔live leaks one source's
// heading into the other.
function resetHeadingPredictor() { lastOwnHeadingDeg = null; }
function drawHeadingLine(pos, hdg, gsKt) {
  if (!pos) return;
  const h = Number.isFinite(hdg) ? hdg : lastOwnHeadingDeg;
  if (!Number.isFinite(h)) return;          // no heading yet — nothing to draw
  lastOwnHeadingDeg = h;
  const haveSpeed = Number.isFinite(gsKt) && gsKt > 0;
  const hr = h * Math.PI / 180;
  const cosLat = Math.max(0.2, Math.cos(pos.lat * Math.PI / 180));
  const atNm = (nm) => proj({
    lat: pos.lat + (nm / 60) * Math.cos(hr),
    lng: pos.lng + (nm / 60) * Math.sin(hr) / cosLat,
  });
  const nmAtMin = (min) => gsKt * (min / 60);   // distance covered in `min` minutes at gsKt
  const s = proj(pos);
  // Line reaches whichever mark set extends further -- the 10 NM mark, or the 5-minute
  // mark's own distance if that's farther out at the current speed (fast aircraft).
  const farNm = haveSpeed
    ? Math.max(HEADING_LINE_MARKS_NM[HEADING_LINE_MARKS_NM.length - 1],
                nmAtMin(HEADING_LINE_MARKS_MIN[HEADING_LINE_MARKS_MIN.length - 1]))
    : HEADING_LINE_MARKS_NM[HEADING_LINE_MARKS_NM.length - 1];
  const end = atNm(farNm);
  const dx = end.x - s.x, dy = end.y - s.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;                       // degenerate (extreme zoom-out)
  const ux = dx / len, uy = dy / len;        // line direction (screen)
  const px = -uy, py = ux;                    // unit perpendicular (screen)

  octx.save();
  octx.lineCap = 'butt';
  octx.lineJoin = 'round';
  // the line — dashed so it reads clearly over a busy/coloured chart
  octx.beginPath();
  octx.moveTo(s.x, s.y);
  octx.lineTo(end.x, end.y);
  octx.strokeStyle = colorWithAlpha(tune('liveHeadingLineColor'), 0.95);
  octx.lineWidth = tune('liveHeadingLineWidthPx');
  octx.setLineDash([tune('liveHeadingDashPx'), tune('liveHeadingDashGapPx')]);
  octx.stroke();
  octx.setLineDash([]);   // solid ticks below

  // cross-ticks + upright two-row labels at a given geographic distance -- shared by
  // both the NM marks and the minute marks below, just with different label text.
  const tick = tune('liveHeadingTickPx'), gap = tune('liveHeadingLabelGapPx');
  const labelPx = tune('liveHeadingLabelPx');
  octx.font = 'bold ' + labelPx + 'px sans-serif';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  function drawMark(nm, primaryLabel, secondaryLabel) {
    const m = atNm(nm);
    octx.beginPath();
    octx.moveTo(m.x - px * tick, m.y - py * tick);
    octx.lineTo(m.x + px * tick, m.y + py * tick);
    octx.strokeStyle = colorWithAlpha(tune('liveHeadingLineColor'), 0.9);
    octx.lineWidth = tune('liveHeadingLineWidthPx');
    octx.stroke();
    const lx = m.x + px * (tick + gap), ly = m.y + py * (tick + gap);
    octx.lineWidth = tune('liveHeadingTickHaloWidthPx');
    octx.strokeStyle = colorWithAlpha(tune('liveHeadingTickHaloColor'), tune('liveHeadingTickHaloAlpha'));
    octx.strokeText(primaryLabel, lx, ly);
    octx.fillStyle = tune('liveHeadingTextColor');
    octx.fillText(primaryLabel, lx, ly);
    if (secondaryLabel == null) return;
    // Second row, straight below in screen space -- readable regardless of which
    // way the line itself runs (px/py only offset the row to the line's side).
    const ly2 = ly + labelPx + 2;
    octx.lineWidth = tune('liveHeadingTickHaloWidthPx');
    octx.strokeStyle = colorWithAlpha(tune('liveHeadingTickHaloColor'), tune('liveHeadingTickHaloAlpha'));
    octx.strokeText(secondaryLabel, lx, ly2);
    octx.fillStyle = tune('liveHeadingTextColor');
    octx.fillText(secondaryLabel, lx, ly2);
  }

  // Fixed-distance marks: "N nm" ("2 nm"/"5 nm"/"10 nm"). No secondary derived row --
  // a time-to-reach subtext was tried and reported as unwanted clutter ("it shows
  // 1:20 as well"); just the marks themselves.
  for (const nm of HEADING_LINE_MARKS_NM) drawMark(nm, nm + ' nm', null);
  // Fixed-time marks: "N min". Needs a groundspeed to place at all (their distance is
  // derived from it); no secondary distance row either, same reasoning as above.
  if (haveSpeed) {
    for (const min of HEADING_LINE_MARKS_MIN) drawMark(nmAtMin(min), min + ' min', null);
  }
  // Heading value at the far end of the line, past the last tick's own labels
  // rather than stacked on top of them. Magnetic + padded to 3 digits, same as
  // every other heading this app displays (leg kite, next-leg watch alert, VOR
  // radials) -- h itself is TRUE here (both gpsOwn.hdg from a real fix and
  // simAircraft.hdg from the sim feed are converted to true at their own source
  // now, see the comment where simAircraft.hdg is set in io.js), so this needs
  // the same toMagnetic() conversion every other heading label already gets.
  const headEnd = { x: end.x + ux * (tick + gap), y: end.y + uy * (tick + gap) };
  const hMag = typeof toMagnetic === 'function' ? toMagnetic(h) : h;
  const headingLabel = (typeof pad3 === 'function' ? pad3(Math.round(((hMag % 360) + 360) % 360)) :
    Math.round(hMag)) + '°';
  octx.lineWidth = tune('liveHeadingTickHaloWidthPx');
  octx.strokeStyle = colorWithAlpha(tune('liveHeadingTickHaloColor'), tune('liveHeadingTickHaloAlpha'));
  octx.strokeText(headingLabel, headEnd.x, headEnd.y);
  octx.fillStyle = tune('liveHeadingTextColor');
  octx.fillText(headingLabel, headEnd.x, headEnd.y);
  octx.restore();
  if (typeof window !== 'undefined')
    window.__headingLine = { heading: h, marks: HEADING_LINE_MARKS_NM.slice(),
      minMarks: haveSpeed ? HEADING_LINE_MARKS_MIN.slice() : [], headingLabel };
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
  // Legs with no altitude typed are drawn at unknownProfileAltFt. Stroke those
  // segments dashed and caption the strip, so an invented height cannot be read
  // as a flown one — a solid confident line said "we are at 2000" for a route
  // the pilot had not given any altitude at all.
  ctx.strokeStyle = tune('profileLineColor');
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  // Stroke consecutive same-dash points as ONE path so the joins survive: drawing
  // a segment at a time left butt ends at every TOC kink. A run's dash state is
  // its points' own `assumed`, and the segment BETWEEN two runs is dashed if
  // either side is assumed — that boundary is half invented, so it must not read
  // as measured.
  let runStart = 0;
  const strokeRun = (from, to, dashed) => {
    if (to <= from) return;
    ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(px(prof.pts[from].d), py(prof.pts[from].alt));
    for (let k = from + 1; k <= to; k++) ctx.lineTo(px(prof.pts[k].d), py(prof.pts[k].alt));
    ctx.stroke();
  };
  for (let i = 1; i < prof.pts.length; i++) {
    const changed = !!prof.pts[i].assumed !== !!prof.pts[runStart].assumed;
    if (!changed) continue;
    strokeRun(runStart, i - 1, !!prof.pts[runStart].assumed);
    // The bridging segment: dashed when either end is assumed.
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(px(prof.pts[i - 1].d), py(prof.pts[i - 1].alt));
    ctx.lineTo(px(prof.pts[i].d), py(prof.pts[i].alt));
    ctx.stroke();
    runStart = i;
  }
  strokeRun(runStart, prof.pts.length - 1, !!prof.pts[runStart].assumed);
  ctx.setLineDash([]);
  if (prof.hasAssumed) {
    const note = S.profileAssumedNote
      ? S.profileAssumedNote(Math.round(_unknownProfileAltFt()))
      : 'No altitude set';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    // A route with no altitude is drawn at the top of the strip, so the caption
    // lands on the very line it is describing — give it a backdrop rather than
    // guessing at a corner that happens to be free.
    const nw = ctx.measureText(note).width;
    ctx.fillStyle = colorWithAlpha(tune('profileBgColor'), 0.82);
    ctx.fillRect(x + w - nw - 6, y + 1, nw + 5, 12);
    ctx.fillStyle = tune('profileTextColor');
    ctx.fillText(note, x + w - 3, y + 2);
  }
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

  // Axis unit caption.
  ctx.fillStyle = tune('profileTextColor');
  ctx.font = '7px sans-serif';
  ctx.textAlign = rtl ? 'left' : 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('NM / time', rtl ? x + 2 : x + w - 2, y + h);
  ctx.restore();
}

function draw() {
  // Reclaims the legend's screen space on a phone while a position source is live
  // (recording, live location, or a connected simulator) -- reported live as "legend
  // should be hidden, to make screen place". Kept in sync here (every redraw, which
  // already runs on essentially every state change) rather than threaded through each
  // of the six start/stop functions individually, so an early-return or a failed
  // registration can't leave it stuck in the wrong state. The actual hiding is CSS,
  // scoped to mobile widths only (see .gps-tracking-active .map-legend in style.css) --
  // desktop has room for both.
  if (typeof document !== 'undefined' && typeof gpsMapLocked === 'function') {
    document.body.classList.toggle('gps-tracking-active', gpsMapLocked());
  }
  octx.clearRect(0, 0, vw(), vh());
  drawAreas();                  // airspace bubbles under the waypoints
  // Review overlay (?graphlegs=1): under the waypoints and the route, so it never hides
  // what a pilot is actually looking at even with every segment drawn.
  if (typeof drawGraphLegs === 'function') drawGraphLegs();
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
  if (!gpsRecording && !gpsLiveOn && simOn && simAircraft) drawOwnShip(simAircraft, simAircraft.hdg, simAircraft.ias);  // sim own-ship
  drawInfo();
  drawPageFrame();
  drawPlanCard();          // flight-plan card placed for PNG export (#378)
  // #78: keep the Flight Plan modal live with the route. The hook is null
  // when the modal isn't open, or after refresh detects a structural change
  // and closes it.
  if (refreshFlightPlan) refreshFlightPlan();
  // Keep the open print panel's route-gated "Place flight plan" checkbox live.
  if (typeof updateExportPlanCb === 'function') updateExportPlanCb();
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
// Which chart a NOTAM belongs to. The feed is FIR-wide with no chart field, but
// the ultralight ones say so in their text ("ULTRALIGHT BUBBLE CLSD HAHULA
// (BHULA)") — those are the LSA chart's business and clutter a CVFR plan, which
// is what "separate NOTAMs between CVFR and LSA" asked for.
//
// Deliberately ultralight-only. The helicopter signal in this feed is not
// separable: most HEL mentions are general closures that merely name it ("AD CLSD
// TO ALL FLT INCLUDING HEL"), so matching them would hide FIR-wide NOTAMs from
// CVFR. Everything not explicitly ultralight stays on every chart.
const NOTAM_ULTRALIGHT_RE = /ULTRALIGHT|POWERED PARA|PARAGLID|MICROLIGHT|HANG GLID/i;
function notamChartTag(n) {
  return NOTAM_ULTRALIGHT_RE.test((n && n.text) || '') ? 'lsa' : null;
}
function notamOnChart(n, prefix) {
  const tag = notamChartTag(n);
  return tag === null || tag === prefix;
}
// opts.allCharts skips the chart filter, for callers that mean "the whole feed".
function activeNotams(opts) {
  // The timeline slider scrubs a look-ahead time; null = live "now".
  const now = Number.isFinite(window.notamViewTime) ? window.notamViewTime : Date.now();
  if (!Array.isArray(notams)) return [];
  const everyChart = !!(opts && opts.allCharts);
  const prefix = (typeof layerDataPrefix === 'function') ? layerDataPrefix() : 'cvfr';
  return notams.filter(n => notamActive(n, now) && (everyChart || notamOnChart(n, prefix)));
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
let airfieldsByIcao = null;              // built on first use, dropped when airfields reload
function airfieldByIcao(code) {
  const u = String(code || '').toUpperCase();
  if (!u || !Array.isArray(airfields)) return null;
  // Indexed rather than scanned: the NOTAM draw path calls this per marker, and the FPL
  // validation calls it once per waypoint, each scan re-upper-casing every name.
  if (!airfieldsByIcao || airfieldsByIcao._for !== airfields) {
    airfieldsByIcao = new Map(airfields.map(a => [String(a.name || '').toUpperCase(), a]));
    airfieldsByIcao._for = airfields;
  }
  return airfieldsByIcao.get(u) || null;
}
// airport for its ICAO)? FIR-wide (LLLL) ones don't.
function notamMappable(n) {
  if (!n) return false;
  if (n.geom) return true;
  if (Array.isArray(n._routeLines) && n._routeLines.length) return true;
  if (notamBubbleAreas(n).length) return true;
  if (n.icao && Array.isArray(airfields)) {
    const af = airfieldByIcao(n.icao);
    if (af && Number.isFinite(af.lat) && Number.isFinite(af.lng)) return true;
  }
  return false;
}
// Bubble-closure NOTAMs ("ULTRALIGHT BUBBLE CLSD HAHULA (BHULA), KARMIEL (BKRML)") carry
// no coordinates -- the bubble code IS the geometry. Resolve the codes named in the text
// against the loaded areas dataset so these NOTAMs get a map presence on the LSA chart.
//
// Performance: RegExp objects are precompiled once per area (WeakMap keyed on the area
// object, so they're collected when `areas` is replaced on layer change). The resolved
// match list is memoised on each NOTAM via a generation counter that bumps whenever
// `areas` loads, so each NOTAM pays the O(areas×codes) scan at most once per layer load.
var _notamBubbleGen = 0;                // bumped in loadAreas()
const _areaRegexes = new WeakMap();     // area object → RegExp[]
function _getAreaRegexes(a) {
  let rxs = _areaRegexes.get(a);
  if (!rxs) {
    const codes = [a.icao].concat(a.aliases || [])
      .map(c => String(c || '').toUpperCase())
      .filter(c => /^[A-Z0-9]{3,7}$/.test(c));
    rxs = codes.map(c => new RegExp('\\b' + c + '\\b'));
    _areaRegexes.set(a, rxs);
  }
  return rxs;
}
function notamBubbleAreas(n) {
  if (!n || !Array.isArray(areas) || !areas.length) return [];
  if (n._bubbleAreas && n._bubbleAreas.gen === _notamBubbleGen) return n._bubbleAreas.result;
  const txt = String(n.text || '').toUpperCase();
  // No text, nothing scanned, nothing to memoise -- caching the empty answer would pin
  // it until the next layer load even if the body arrives later in the session.
  if (!txt) return [];
  const out = [];
  for (const a of areas) {
    if (_getAreaRegexes(a).some(rx => rx.test(txt))) out.push(a);
  }
  n._bubbleAreas = { gen: _notamBubbleGen, result: out };
  return out;
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
  // Bubble areas, ALWAYS — drawNotams hatches every one of them regardless of what
  // else the NOTAM carries, and the frame has to cover what is actually drawn. Adding
  // them only when no geom exists left a NOTAM that has both a polygon and a matching
  // bubble name framed on the polygon alone, with the hatched bubble off-viewport; it
  // also returned NOTHING for a geom whose type none of the branches above handle.
  // Repeating a point costs nothing here: these coords only ever feed a bounding box.
  // notamBubbleAreas memoizes per NOTAM, so this is a cache hit on the draw path.
  notamBubbleAreas(n).forEach(a => { if (Array.isArray(a.coords)) a.coords.forEach(c => push(c[0], c[1])); });
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
    if (pts.length === 1) {
      map.setView(pts[0], Math.max(map.getZoom(), tune('fitNotamPointZoom')), { animate: true });
    } else {
      map.fitBounds(L.latLngBounds(pts),
        fitOpts('fitNotamPaddingPx', 'fitNotamMaxZoom', { animate: true }));
    }
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
  const flashCol = tune('notamFlashColor');
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
    // Bubble closures: hatch the named bubble(s) in NOTAM colour over the LSA chart.
    // The bubble outline itself stays with drawAreas; this is the closure marker.
    for (const a of notamBubbleAreas(n)) {
      const pts = a.coords
        .filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(c => proj({ lat: c[0], lng: c[1] }));
      if (pts.length < 3) continue;
      octx.beginPath();
      octx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
      octx.closePath();
      octx.fillStyle = colorWithAlpha(col, tune('notamFillAlpha'));
      octx.fill();
      octx.setLineDash([6, 4]);
      octx.lineWidth = tune('notamLineWidthPx');
      octx.strokeStyle = col;
      octx.stroke();
      octx.setLineDash([]);
      if (flashId && n.id === flashId) {
        octx.lineWidth = tune('notamLineWidthPx') + 5;
        octx.strokeStyle = colorWithAlpha(flashCol, flashPulse);
        octx.stroke();
      }
      if (n.id) {
        const c = areaCentroid(a.coords);
        const p = proj({ lat: c.lat, lng: c.lng });
        octx.font = 'bold 11px sans-serif';
        octx.textAlign = 'center';
        octx.lineWidth = 3;
        octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), 0.9);
        octx.strokeText(n.id, p.x, p.y - 14);
        octx.fillStyle = col;
        octx.fillText(n.id, p.x, p.y - 14);
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
// Active NOTAMs for an airfield that MENTION a frequency. Deliberately a boolean-ish
// question, not an extraction: the published frequency stays what the app shows, and this
// only says "there is a NOTAM about a frequency here, go read it".
//
// Not parsing the value is the whole point. A NOTAM frequency is true today, not true in
// general -- baking one into airfields.json next to `clearance` would freeze a temporary
// claim into a file that means "published truth", which is exactly how closedHint and
// openFromHourHint ended up wrong. And a mis-parse here puts a pilot on the wrong
// frequency, which is worse than making them read two lines of NOTAM text.
//
// So: no value is read out, nothing is substituted, and the badge is a pointer.
const FREQ_MENTION_RE = /\b(?:FREQ|FREQUENCY|TWR|TOWER|AFIS|ATIS|RADIO|QDM)\b|\b1[0-3][0-9]\.[0-9]{1,3}\b/;
function airfieldFreqNotams(icao) {
  const code = String(icao || '').toUpperCase();
  if (!code || typeof activeNotams !== 'function') return [];
  return activeNotams().filter(function (n) {
    if (!n || String(n.icao || '').toUpperCase() !== code) return false;
    return FREQ_MENTION_RE.test(String(n.text || '').toUpperCase());
  });
}
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
      octx.strokeStyle = colorWithAlpha(tune('notamFlashColor'), flashPulse);
      octx.stroke();
    }
    octx.beginPath();
    octx.arc(p.x, p.y + 14, 9, 0, 2 * Math.PI);    // offset below the field marker
    octx.fillStyle = colorWithAlpha(col, 0.92);
    octx.fill();
    octx.lineWidth = 1.5;
    octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), 0.9);
    octx.stroke();
    octx.fillStyle = tune('notamBadgeTextColor');
    octx.font = 'bold ' + tune('notamBadgeFontPx') + 'px sans-serif';
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
    // Bubble closures: the hatched bubble polygon is the NOTAM's shape on the map,
    // so a click inside it opens the text like any drawn area.
    let bubbleHit = false;
    for (const a of notamBubbleAreas(n)) {
      const bp = a.coords
        .filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(c => proj({ lat: c[0], lng: c[1] }));
      if (bp.length >= 3 && notamPointInPoly(pt, bp)) { bubbleHit = true; break; }
    }
    if (bubbleHit) { out.push(n); continue; }
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
// Lazy-loads the nav-waypoints projection of docs/data/cvfr-route-graph.json on first
// activation. Format:
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
  // An explicit choice (View/Set -> "Nav waypoints from") wins over the base layer, so
  // Satellite / OSM / Navigation are no longer stuck on CVFR: they used to fall through
  // to 'cvfr' with no way to ask for the LSA or helicopter sets, even though both ship.
  if (typeof navDataPrefix === 'string' && _PREFIX_LAYER_NAME[navDataPrefix]) return navDataPrefix;
  const l = currentLayerName();
  for (const p in _PREFIX_LAYER_NAME) {
    if (_PREFIX_LAYER_NAME[p] === l) return p;
  }
  return 'cvfr';   // Navigation / Satellite / OSM follow the CVFR datasets by default
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
  // nav-waypoints, comm-change and leg-altitude have no file: they are projected from
  // <layer>-route-graph.json above, and never reach this map.
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
// The three per-layer datasets now live in one file each: <layer>-route-graph.json, which
// is fetched here and projected back into the shapes the loaders validate. The projection
// itself lives in app/route-graph-shapes.js, shared with the equivalence proof
// (scripts/legacy-from-graph.mjs) so the app cannot drift from what that proof checked.
const _graphMemo = {};
function routeGraphData(prefix) {
  if (!_graphMemo[prefix]) {
    const url = 'data/' + prefix + '-route-graph.json?v=' + _verOf(S.routeGraphUrl);
    _graphMemo[prefix] = fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .catch(e => { delete _graphMemo[prefix]; throw e; });
  }
  return _graphMemo[prefix];
}

async function _fetchLayerDataRaw(kind) {
  // typeof-guarded: if app/route-graph-shapes.js failed to load, the graph-served kinds
  // fail at their own fetch below (404 on the retired URLs), but 'areas' and any future
  // file-backed kind stay alive instead of every call dying on a ReferenceError.
  if (typeof ROUTE_GRAPH_KINDS !== 'undefined' && ROUTE_GRAPH_KINDS[kind]) {
    // Same fall-back rule as the files had: the active layer's graph, else cvfr's.
    const pfx0 = layerDataPrefix();
    const order = pfx0 === 'cvfr' ? ['cvfr'] : [pfx0, 'cvfr'];
    let lastErr = null;
    for (const prefix of order) {
      try {
        return { data: routeShapeFromGraph(kind, await routeGraphData(prefix), prefix), prefix };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no route graph for ' + kind);
  }
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
    _notamBubbleGen++;
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
        icao: a.icao || '', lowFt: a.lowFt, highFt: a.highFt,
        // Alternate codes other publications use for the same bubble (the AIP prints
        // BMDEB where the chart says BMGEB) -- the NOTAM matcher honours both.
        aliases: Array.isArray(a.aliases) ? a.aliases : [],
        active: a.active === 'weekend' ? 'weekend' : 'always' }));
    if (gen !== _layerGen) return loadAreas();   // superseded — don't stomp; re-enter (joins via memo)
    areas = mapped;
    _notamBubbleGen++;                         // invalidate per-NOTAM bubble-match cache
  } catch (e) {
    // no areas file for this layer (or fetch failed) -- bump alongside, exactly as the
    // two success paths do, so no NOTAM keeps a match list built against the old areas.
    if (gen === _layerGen) { areas = []; _notamBubbleGen++; }
  }
  if (areas && areas.length) scheduleDraw();
  if (typeof refreshLsaListBtn === 'function') refreshLsaListBtn();
  // A stored bubble selection waits for this dataset: every other loader retries the
  // pending restore, and this one not doing so left the bubble inspector permanently
  // unrestored whenever areas settled last.
  if (typeof retryPendingInspectorSelection === 'function') retryPendingInspectorSelection();
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
    const wknd = a.active === 'weekend';      // the chart legend's tan class
    // Official legend colours: always = green outline + pale-green fill (in force
    // every day); weekend = black outline + tan fill (Fri–Sat only). The locate
    // highlight overrides both with amber.
    octx.fillStyle = hl ? 'rgba(255,204,51,0.22)' : (wknd ? 'rgba(201,178,138,0.35)' : 'rgba(60,160,60,0.15)');
    octx.strokeStyle = hl ? tune('lsaHighlightColor')
      : (wknd ? tune('lsaWeekendColor') : tune('lsaAlwaysColor'));
    octx.lineWidth = hl ? tune('lsaHighlightWidthPx') : tune('lsaLineWidthPx');
    octx.fill();
    octx.stroke();
  }
  // Names, at each bubble's centroid. Hidden below zoom 10, the same threshold the
  // nav-waypoint names use -- the country-wide view stays a map, not a label cloud. Own
  // font tunables: a bubble label competes with a busy chart underneath, so it runs larger
  // than the VOR labels it used to borrow from.
  const showLabels = map.getZoom() >= (typeof tune === 'function' ? tune('lsaLabelMinZoom') : 10);
  if (showLabels) {
    // The tuned sizes are the size AT ZOOM 10 (the natural bubble-viewing zoom); the label
    // then breathes with the map -- gently, 1.3x per zoom step and clamped, not the 2x the
    // markers use, which would make text unreadable two steps out and comical two steps in.
    const zScale = Math.min(2, Math.max(0.55, Math.pow(1.3, map.getZoom() - 10)));
    const namePx = Math.round((typeof tune === 'function' ? tune('lsaLabelFontPx') : 15) * zScale);
    const metaPx = Math.round((typeof tune === 'function' ? tune('lsaMetaFontPx') : 12) * zScale);
    const nameFont = 'bold ' + namePx + 'px sans-serif';
    const metaFont = 'bold ' + metaPx + 'px sans-serif';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.font = nameFont;
    for (const a of areas) {
      const nm = areaLabel(a);
      if (!nm) continue;
      const s = proj(areaCentroid(a.coords));
      const halo = txt => {
        octx.lineWidth = tune('overlayLabelHaloWidthPx');
        octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
        octx.strokeText(txt.t, s.x, txt.y);
        octx.fillStyle = tune('lsaLabelColor');      // neutral: reads over green + tan fills
        octx.fillText(txt.t, s.x, txt.y);
      };
      // Second line: the altitude band and the chart's availability class -- the two facts
      // a pilot needs before planning through the bubble. The label states what the CHART
      // says (weekend-only for the tan class); the secondary source's weekday hour is an
      // inspector note, not a map fact.
      const bits = [];
      // Unit localised: 'ft' reads as a stray Latin token on the Hebrew chart -- 'רגל'.
      if (Number.isFinite(a.lowFt) && Number.isFinite(a.highFt)) {
        bits.push(a.lowFt + '-' + a.highFt + ' ' + (S.unitFeet || 'ft'));
      }
      if (a.active === 'weekend') bits.push(S.bubbleWeekendTag || 'weekend');
      if (bits.length) {
        const gap = Math.round((namePx + metaPx) / 3.2);
        halo({ t: nm, y: s.y - gap });
        octx.font = metaFont;                 // bold too: the band is why the label exists
        halo({ t: bits.join('  '), y: s.y + gap });
        octx.font = nameFont;
      } else {
        halo({ t: nm, y: s.y });
      }
    }
  }
  octx.restore();
}

// LSA bubbles under a map point -- ray-cast in screen space, like the NOTAM areas.
// Smallest bubble first, so a click inside nested/overlapping bubbles offers the one the
// pilot is most likely pointing at before the one that covers half the map.
function lsaAreasAtLatLng(latlng) {
  if (!showLsaBubbles || !Array.isArray(areas) || !areas.length || !latlng) return [];
  const pt = proj(latlng);
  const out = [];
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i];
    if (!Array.isArray(a.coords) || a.coords.length < 3) continue;
    const poly = a.coords.map(c => proj({ lat: c[0], lng: c[1] }));
    if (notamPointInPoly(pt, poly)) {
      let area2 = 0;
      for (let j = 0; j < poly.length; j++) {
        const q = poly[(j + 1) % poly.length];
        area2 += poly[j].x * q.y - q.x * poly[j].y;
      }
      out.push({ index: i, size: Math.abs(area2) });
    }
  }
  out.sort((x, y) => x.size - y.size);
  return out.map(h => h.index);
}

// Lazy-loads the comm-change projection of docs/data/cvfr-route-graph.json — { callSigns:{...},
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
    // A FETCH failure is left retryable (state stays null): all three kinds now ride one
    // graph file, so the next draw's loadNavWaypoints() refetches it anyway and a success
    // there is a success for this kind too. Committing {} here is how one dropped request
    // used to kill the rings and the altitude table for the whole session while the
    // waypoints quietly recovered. Schema errors above still commit {} -- bad data does
    // not get better by asking again. No retry storm: concurrent callers join the shared
    // in-flight fetch via the memo.
    console.warn('Failed to load comm-change dataset:', e);
    return {};
  }
}

// Lazy-loads the leg-altitude projection of docs/data/cvfr-route-graph.json — { segments:[{from,to,
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
    // Same fetch-failure policy as loadCommChange, for the same reason: the kinds share
    // one file now, so leaving the state null lets the next shared fetch repopulate the
    // altitude table instead of freezing it empty for the session.
    console.warn('Failed to load leg-altitude dataset:', e);
    return {};
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
// Lazy-loads docs/data/vor.json: { vors:[{ ident, name, he?, freq, lat, lng,
// aipName?, type?, ch?, hours?, elevFt?, coverageNm?, remarks?, dmeOnly? }].
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
    // Carry the published AIP detail through — the inspector shows type / channel /
    // hours / range / limits, and the range ring needs coverageNm. This mapping used
    // to whitelist six fields, so everything else was silently dropped.
    vors = d.vors.map(v => ({
      ident: v.ident, name: v.name, he: v.he,
      freq: v.freq, lat: v.lat, lng: v.lng,
      aipName: v.aipName, type: v.type, ch: v.ch, hours: v.hours,
      elevFt: v.elevFt, coverageNm: v.coverageNm, remarks: v.remarks,
      dmeOnly: v.dmeOnly === true,
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
// The VOR station symbol, in one place: ring, four N/E/S/W ticks just outside it, and
// a filled centre dot. Shared with the map legend's swatch (ui.js paints it into a
// small canvas) -- the legend used to approximate this in CSS and looked nothing like
// it, because stroke width, tick length and dot size are all ratios of the radius.
function drawVorSymbol(ctx, x, y, r, col, lineWidth, tickLen) {
  const tick = Number.isFinite(tickLen) ? tickLen : 4;
  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * r, y + dy * r);
    ctx.lineTo(x + dx * (r + tick), y + dy * (r + tick));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1.5, r * 0.22), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawVors(force) {
  if ((!showVorStations && !force) || !vors || !vors.length) return;
  const r = tune('vorMarkerRadiusPx');
  const showLabels = map.getZoom() >= tune('vorLabelMinZoom');
  octx.save();
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  octx.font = `bold ${tune('vorLabelFontPx')}px sans-serif`;
  // Published coverage ring for the SELECTED station, drawn first so the marker and
  // label sit on top of it. Radius is the AIP ENR 4.1 coverage figure, so it shows
  // where the station is actually usable — several are far smaller than pilots
  // assume (BSA 15 NM, ROP 20 NM) and two publish none at all.
  // Selecting a station on the map rings it immediately — that is what a pilot is
  // asking when they tap it. The inspector-only override and the global reference
  // VOR also ring, in that order of precedence.
  let selectedStation = (state.selected && state.selected.type === 'vor' &&
    vors[state.selected.index]) ? vors[state.selected.index].ident : null;
  // ...unless the pilot cleared the reference on that very station (setReferenceVor): the
  // selection ring is an answer to "what does this one cover", and clearing is the pilot
  // saying they are done with it. Any other station still rings on selection.
  if (typeof vorRingSuppressed === 'function' && vorRingSuppressed(selectedStation)) {
    selectedStation = null;
  }
  const selIdent = selectedStation ||
    (typeof inspectorVorRef === 'string' && inspectorVorRef) || vorRef;
  const selV = selIdent ? vors.find(v => v.ident === selIdent) : null;
  const ringPts = (selV && selV.coverageNm > 0 && typeof notamCirclePoints === 'function')
    ? notamCirclePoints(selV.lat, selV.lng, selV.coverageNm, tune('vorRangeRingSteps'))
      .map(c => proj({ lat: c[0], lng: c[1] }))
    : [];
  // Guarded like every other polygon path here (drawSigmets, drawNotams): the step count is a
  // tuning key, so the live gist or ?tune=1 can set it to 0, and pts[0] on an empty array
  // threw INSIDE draw() -- taking the route line, kites, waypoints, notes and the page frame
  // down with it, not just the ring. Skipping only the ring keeps the stations below drawn.
  if (ringPts.length >= 3) {
    const pts = ringPts;
    octx.save();
    octx.beginPath();
    octx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
    octx.closePath();
    octx.setLineDash([tune('vorRangeRingDashPx'), tune('vorRangeRingGapPx')]);
    octx.lineWidth = tune('vorRangeRingWidthPx');
    octx.strokeStyle = colorWithAlpha(tune('vorRangeRingColor'), tune('vorRangeRingAlpha'));
    octx.stroke();
    octx.setLineDash([]);
    if (tune('vorRangeRingLabel')) {
      // Label at the ring's top so it reads without covering the station.
      const top = pts.reduce((a, b) => (b.y < a.y ? b : a), pts[0]);
      const txt = selV.ident + ' ' + selV.coverageNm + ' NM';
      octx.font = `bold ${tune('vorLabelFontPx')}px sans-serif`;
      octx.textAlign = 'center';
      octx.textBaseline = 'bottom';
      octx.lineWidth = tune('overlayLabelHaloWidthPx');
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
      octx.strokeText(txt, top.x, top.y - tune('vorRangeRingLabelGapPx'));
      octx.fillStyle = colorWithAlpha(tune('vorRangeRingColor'), 1);
      octx.fillText(txt, top.x, top.y - tune('vorRangeRingLabelGapPx'));
    }
    octx.restore();
  }

  for (const v of vors) {
    const s = proj(v);
    const sel = v.ident === selIdent;
    const col = sel ? tune('vorSelectedColor') : tune('vorMarkerColor');
    drawVorSymbol(octx, s.x, s.y, r, col, tune('vorMarkerWidthPx') * (sel ? 1.6 : 1));
    if (showLabels) {
      const label = v.ident + '  ' + (typeof vorEffectiveFreq === 'function' ? vorEffectiveFreq(v) : v.freq);
      const lx = s.x + r + 6, ly = s.y;
      octx.lineWidth = tune('overlayLabelHaloWidthPx');
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
function commRouteAfterNames(entry) {
  // Every waypoint from here to the next comm-change point (inclusive of that point, exclusive
  // of anything past it) -- the span a call sign picked at `entry` is actually in force for.
  // A route sometimes has extra waypoints spliced in right after a comm-change point (auto-route
  // inserting a real corridor stop a hint's `after` was never written to expect -- NTAIM's
  // TEL_NOF hint said "after: SIRNI" and a route drawn NTAIM->SUPER->SIRNI missed it on the
  // immediate neighbour alone), so a fixed hop count is the wrong tolerance: the actual boundary
  // is the next place the frequency would change again, however many stops away that is.
  const names = [];
  if (typeof state === 'undefined' || !Array.isArray(state.waypoints)) return names;
  for (let i = entry.index + 1; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    const nm = canonicalNavWaypointName(wp && wp.name);
    if (nm) names.push(nm);
    const row = commChangeMap && wp && commChangeMap[wp.name];
    if (row && row.commChange) break;
  }
  return names;
}
function commRouteHintDefault(entry) {
  if (!entry || !commChangeMap || typeof state === 'undefined' ||
      !Array.isArray(state.waypoints)) return null;
  const row = commChangeMap[entry.name];
  if (!row || !Array.isArray(row.routeHints) || !row.routeHints.length) return null;
  const before = commRouteContextName(entry.index - 1);
  const afterNames = commRouteAfterNames(entry);
  // Rank each matching hint by how soon its `after` target is actually crossed -- a
  // comm-change point can carry several routeHints, each written for a DIFFERENT possible
  // next leg, and the corridor lookahead (commRouteAfterNames) can put more than one of
  // their targets within range at once. NTAIM's own "after: BOVED" and "after: NSHRM"
  // hints both matched once a route drawn NTAIM -> BOVED -> ... -> NSHRM put both names in
  // afterNames -- treating them as EQUALLY valid produced two different call signs and gave
  // up (ambiguous -> null -> fell to the solver's unrelated guess), when only the nearer one
  // (BOVED, actually crossed first) is the leg in force right now. An unconstrained
  // before-only hint has no "after" distance to rank by, so it always stays in the running
  // alongside whichever after-based hint(s) are nearest.
  let bestRank = Infinity;
  const candidates = [];
  const seen = new Set();
  for (const hint of row.routeHints) {
    if (!hint || typeof hint !== 'object') continue;
    if (hint.before && commRouteHintName(hint.before) !== before) continue;
    let rank = -1;
    if (hint.after) {
      rank = afterNames.indexOf(commRouteHintName(hint.after));
      if (rank === -1) continue;   // this hint's target isn't in range at all
    }
    if (rank > bestRank) continue;      // a strictly-farther match than the best seen so far
    const opt = commCallSignOptionById(entry.name, hint.callSign);
    const key = opt && commCallSignIdKey(opt.id);
    if (!opt || !key) continue;
    if (rank < bestRank) { bestRank = rank; candidates.length = 0; seen.clear(); }
    if (seen.has(key)) continue;
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
// `hinted` names the entries whose value came from an EXPLICIT maintainer routeHint
// (before/after -> callSign), as opposed to the general solve's tie-broken guess. The
// difference matters to at least one caller: suppressing a note because its computed
// frequency happens to match what came before it is only safe when that computation is
// grounded in a verified rule, not a coincidence produced by an ambiguous solve. Splicing
// an extra corridor point between two comm-change points (auto-route) is exactly what
// breaks a before/after match and pushes a point onto the lower-confidence solve path --
// so an unqualified "same as before" check would silently drop a note for a point whose
// actual frequency was never really known to agree.
function commRouteCalloutDefaultsMap() {
  const entries = commRouteChangeEntries();
  const path = commSolveRouteCallSigns(entries);
  const out = {};
  const hinted = new Set();
  for (let i = 0; i < entries.length; i++) {
    const routeHint = commRouteHintDefault(entries[i]);
    if (routeHint) {
      out[entries[i].name] = routeHint;
      hinted.add(entries[i].name);
      continue;
    }
    if (!path.length) continue;
    const id = path[i + 1];
    const opt = commCallSignOptionById(entries[i].name, id);
    if (opt) out[entries[i].name] = { freqName: opt.id, freq: opt.freq || '' };
  }
  return { defaults: out, hinted };
}
function commCalloutDefaults(name) {
  const key = canonicalNavWaypointName(name);
  const { defaults: routeDefaults } = commRouteCalloutDefaultsMap();
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
// Identification / report point (נקי הזדהות): an oval note anchored to a leg
// at fraction t (0..1 from the leg's start waypoint). Its lat/lng is derived
// from the leg on every draw so it always sits on the track.
function reportPointGeom(n) {
  if (!n || !n.rp) return null;
  const i = n.rp.leg;
  const A = state.waypoints[i], B = state.waypoints[i + 1];
  if (!A || !B) return null;
  const t = Math.max(0, Math.min(1, Number.isFinite(n.rp.t) ? n.rp.t : 0.5));
  return { i, t, lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t };
}
// Planned time from the leg's start waypoint to the point, mm:ss. Uses the
// SAME still-air/TAS basis as the minute ticks (not GS), so the number in the
// oval always agrees with the tick it sits on. (Only the leg-total ETE in the
// kite is GS/wind-corrected.)
function reportPointTime(n) {
  const g = reportPointGeom(n);
  if (!g) return '';
  const leg = state.legs[g.i];
  const gg = geo(state.waypoints[g.i], state.waypoints[g.i + 1]);
  const h = leg && leg.flightSpeed > 0 ? (gg.dist * g.t) / leg.flightSpeed : 0;
  return h > 0 ? toHMS(h) : '0:00';
}
// Per-leg time as printed on the kite -- and in the flight plan, which reads the same
// model (io.js refresh: prof.legs[i].timeH). A leg with an altitude, i.e. every leg of
// a loaded template, costs climb/descent time, so still-air dist/speed put a different
// ETE on the chart than in the plan for the very same leg. Falls back to dist/speed
// when the profile engine is unavailable.
function legKiteTimeH(i, prof) {
  const A = state.waypoints[i], B = state.waypoints[i + 1];
  const leg = state.legs[i];
  if (!A || !B || !leg) return 0;
  const p = prof || ((typeof routeProfile === 'function') ? routeProfile() : null);
  if (p && p.legs[i]) return p.legs[i].timeH;
  return leg.flightSpeed > 0 ? geo(A, B).dist / leg.flightSpeed : 0;
}
function noteLines(n) {
  if (n && n.cc) {
    const name = commNoteName(n);
    const freq = commNoteFreq(n);
    return [name ? name.toUpperCase() : '', freq].filter(Boolean);
  }
  if (n && n.rp) {                       // report point: auto time + optional label
    const label = (n.text || '').trim();
    const t = reportPointTime(n);
    return label ? [t, label] : [t];
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
// Default position for a freq-change callout: offset from the waypoint to the
// LEFT of the direction of travel — the opposite side from the nav kites
// (which sit on the right / +nx). This flips with route direction instead of
// being a static compass offset, so on a north->south leg the callout no longer
// lands on the same side as the kites. Magnitude comes from the existing tune
// (its sign is ignored now — the side is derived from the leg).
// `wpsOverride` lets a route being BUILT (a template, before it reaches state)
// resolve the side from its own waypoint list.
function commCalloutDefaultTail(wp, idx, wpsOverride) {
  // A magnitude of 0 must mean 0. `Math.abs(x) || 0.09` silently restored the
  // shipped default when the slider (or a gist override) was set to zero, and
  // then applied it in BOTH axes via the bearing — an unfalsifiable control.
  const rawD = tune('commChangeNoteLngOffset');
  const D = Number.isFinite(rawD) ? Math.abs(rawD) : 0.09;
  let brg = null;
  const wps = Array.isArray(wpsOverride) ? wpsOverride : state.waypoints;
  // Derive the route index when the caller did not pass one. Callers that omit it
  // used to fall through to the static compass offset, which put the callout back
  // on the nav-kite side — and left it there permanently, because the reverse
  // handler's "is this still at default?" test compares against the bearing-derived
  // position and so classified it as user-dragged. Resolving the index here means a
  // caller cannot reintroduce that by forgetting the argument. A target that is not
  // on the route (a navWP reference) yields -1 and keeps the static fallback.
  if (!Number.isInteger(idx) && Array.isArray(wps) && wp) {
    const found = wps.indexOf(wp);
    if (found >= 0) idx = found;
  }
  if (Array.isArray(wps) && Number.isInteger(idx) && typeof geo === 'function') {
    const prev = wps[idx - 1], next = wps[idx + 1];
    if (prev && wp) brg = geo(prev, wp).brg;          // inbound leg preferred
    else if (wp && next) brg = geo(wp, next).brg;     // else outbound
  }
  if (brg == null) {                                  // no leg direction → keep the plain tune offset
    return {
      lat: r5(wp.lat + (tune('commChangeNoteLatOffset') || 0)),
      lng: r5(wp.lng + tune('commChangeNoteLngOffset')),
    };
  }
  const th = (brg - 90) * Math.PI / 180;              // left of travel
  const cosLat = Math.max(0.1, Math.cos(wp.lat * Math.PI / 180));
  return {
    lat: r5(wp.lat + D * Math.cos(th)),
    lng: r5(wp.lng + D * Math.sin(th) / cosLat),
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
  const { defaults: routeDefaults, hinted } = commRouteCalloutDefaultsMap();
  // The frequency actually in effect as the route is walked in order. Two DIFFERENT
  // comm-change points along the way can happen to publish the SAME frequency (e.g. two
  // adjacent reporting points share one call sign) -- crossing the second one is not a
  // change to make on the radio, so no note is worth seeding for it. Purely computed from
  // the route's own sequence on every pass, never persisted: drag a waypoint or reorder
  // the route and this re-evaluates on its own, same as everything else this function does.
  //
  // Suppressing only fires below when `hinted` names this point -- i.e. its callout came
  // from an EXPLICIT, maintainer-verified routeHint, not the general solve's tie-broken
  // guess. The solve's guesses have already been shown (this same session, on this same
  // corridor) to coincidentally repeat a preceding frequency where the real answer
  // differed -- suppressing on an uncertain match would have hidden that note instead of
  // surfacing the wrong one, which is worse.
  let routeFreq = '';
  for (let wpIdx = 0; wpIdx < state.waypoints.length; wpIdx++) {
    const wp = state.waypoints[wpIdx];
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
    const calloutFreq = commFormatFreq(callout.freq);
    const existing = state.notes.find(n => n && canonicalNavWaypointName(n.cc) === nm);
    if (existing) {
      // An auto-generated note can become redundant AFTER it was seeded -- a route built
      // incrementally seeds NTAIM's note while its next waypoint (and so its callout) is
      // still unknown (static default), and only later grows a next waypoint that makes
      // NTAIM's own frequency match what TYONA already put in effect. Updating the note's
      // shown frequency (below) used to be as far as this went, leaving a now-pointless
      // note in place instead of removing it -- reported live: "when i set manually, it
      // starts NTAIM with TEL_NOF, after adding BOVED or NAGID, it changes, but doesn't
      // suppress". Same condition the "no existing note" branch below already uses to
      // skip CREATING one; applied retroactively here too. A note the pilot hand-created
      // or hand-edited (freqAuto !== true) is never removed this way.
      if (existing.freqAuto === true && calloutFreq && calloutFreq === routeFreq && hinted.has(nm)) {
        const idx = state.notes.indexOf(existing);
        if (idx !== -1) { state.notes.splice(idx, 1); changed = true; }
        routeFreq = calloutFreq;
        continue;
      }
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
        const tail = commCalloutDefaultTail(wp, wpIdx);
        existing.lat = tail.lat;
        existing.lng = tail.lng;
        changed = true;
      }
      // A note the pilot hand-edited wins over the computed default for what is actually
      // in effect from here on, same as it wins on screen.
      const shownFreq = commFormatFreq(existing.freq);
      if (shownFreq) routeFreq = shownFreq;
      continue;
    }
    if (isCommChangeSuppressed(nm)) {
      // A manual suppression hides the NOTE, not the radio environment -- the frequency
      // still changes here whether or not a callout says so, so later points still
      // compare against it.
      if (calloutFreq) routeFreq = calloutFreq;
      continue;
    }
    // Same frequency already in effect from an earlier point on the route: crossing this
    // one calls for no action on the radio, so no note is seeded for it. Gated on `hinted`
    // -- see the comment above the loop for why an unverified match must never suppress.
    if (calloutFreq && calloutFreq === routeFreq && hinted.has(nm)) continue;
    const tail = commCalloutDefaultTail(wp, wpIdx);
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
    if (calloutFreq) routeFreq = calloutFreq;
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
      const gj = geo(Aj, Bj);
      const dur = state.legs[j].outboundSpeed > 0 ? gj.dist / state.legs[j].outboundSpeed : 0;
      // CTR legs stay off the return clock too, mirroring the outbound cum chain.
      const jPre = typeof legInsideCtr === 'function' && legInsideCtr(j);
      if (!jPre) cumOut += dur;
      cumOutArr[j] = jPre ? '---' : (cumOut > 0 ? toHMS(cumOut) : '--');
    }
  }

  // One model for every time on screen: the kites, the cumulative labels and the
  // flight-plan table all read per-leg times from here.
  const legProfile = (typeof routeProfile === 'function') ? routeProfile() : null;

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

    // The toolbar toggle sets the default; a leg can override it EITHER way (hide one cone
    // on a busy chart, or show one cone on an otherwise clean map). Nothing else about the
    // leg changes -- including the kite's offset, which keeps its usual drift-derived
    // position so that hiding the cone does not make the kite jump.
    if (typeof legDriftVisible === 'function' ? legDriftVisible(leg, showDrift, i)
        : (showDrift && !leg.hideDrift)) {
      drawDriftLines(sa, sb);
    }

    const { dist, brg } = geo(A, B);
    const durH = legKiteTimeH(i, legProfile);
    const durOut = leg.outboundSpeed > 0 ? dist / leg.outboundSpeed : 0;
    const magIn = toMagnetic(brg);
    const magOut = (magIn + 180) % 360;
    const timeStr = durH > 0 ? toHMS(durH) : '--';
    const timeStrOut = durOut > 0 ? toHMS(durOut) : '--';

    // The pilot can hide this leg's nav kite (both directions). Everything else the leg
    // draws is unaffected -- this is about an unreadable pile of kites in a busy area, not
    // about hiding the leg.
    const kiteOff = typeof legKiteVisible === 'function'
      ? !legKiteVisible(i, leg)
      : (typeof legKiteHidden === 'function' && legKiteHidden(leg));

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
    const cumPerpDef = cumDefaultLabelPerp();   // constant, waypoint-anchored
    const inPerp  = inP._default  ?  driftPerp : (inP.p  || 0) * zoomScale;
    const outPerp = outP._default ? -driftPerp : (outP.p || 0) * zoomScale;
    const inAlong  = (inP.a  || 0) * zoomScale;
    const outAlong = (outP.a || 0) * zoomScale;
    // Legs inside the departure field's CTR are flown on the field's procedure, not on the
    // route's stopwatch: the clock starts at the boundary reporting point (see
    // ctr-boundaries.json). Those legs add nothing and show no cumulative kite.
    const preClock = typeof legInsideCtr === 'function' && legInsideCtr(i);
    if (!preClock) cumInH += durH;
    const cumInStr = (!preClock && cumInH > 0) ? toHMS(cumInH) : '--';

    // A blocked inbound direction (one-way leg flown the disallowed way) has no
    // valid altitude to show — skip its nav kite entirely (the return kite is
    // already gated by legAllowsReturn).
    const inboundBlocked = typeof legAltitudeIsBlocked === 'function' &&
      legAltitudeIsBlocked(leg, 'inboundAltitude');
    if (!inboundBlocked && !kiteOff) drawLegArrow(mid.x + dx * inAlong + nx * inPerp,
      mid.y + dy * inAlong + ny * inPerp,
      ang, pad3(magIn), timeStr, kiteAltitudeLabel(leg.inboundAltitude, leg, 'inboundAltitude'),
      tune('inkColor'), tintFill(tune('legKiteFillColor'), tune('kiteNoteAlpha')), needsHalo(i, 'in'), zoomScale);
    // Cumulative inbound time: < [time], position driven by leg.cumLabel
    // (default: at B waypoint, same perpendicular side as main kite).
    const defCum = { a: 0, _default: 1, _m: 1 };
    if (showCumTime && !preClock) {
      const cumP = leg.cumLabel || defCum;
      const cumPerp  = cumP._default ? cumPerpDef : (cumP.p || 0) * zoomScale;
      const cumAlong = (cumP.a || 0) * zoomScale;
      const cumX = sb.x + dx * cumAlong + nx * cumPerp;
      const cumY = sb.y + dy * cumAlong + ny * cumPerp;
      drawCumTimeArrow(cumX, cumY,
        Math.atan2(sb.y - cumY, sb.x - cumX),
        cumInStr, tune('inkColor'), tintFill(tune('cumKiteFillColor'), tune('kiteNoteAlpha')), zoomScale);
    }

    if (showReturn && legAllowsReturn(i)) {
      if (!kiteOff) drawLegArrow(mid.x + dx * outAlong + nx * outPerp,
        mid.y + dy * outAlong + ny * outPerp, ang + Math.PI,
        pad3(magOut), timeStrOut, kiteAltitudeLabel(leg.outboundAltitude, leg, 'outboundAltitude'),
        tune('inkColor'), tintFill(tune('returnKiteFillColor'), tune('kiteNoteAlpha')), needsHalo(i, 'out'), zoomScale);
      if (showCumTime) {
        // Cumulative return time kite at A waypoint (return destination).
        // Own offset (cumLabelRet), anchored at A with the same +dx/+nx frame
        // as the inbound kite so its drag math is identical; default sits on
        // the opposite perpendicular side (-driftPerp).
        const cumRetP = leg.cumLabelRet || defCum;
        const cumRetPerp  = cumRetP._default ? -cumPerpDef : (cumRetP.p || 0) * zoomScale;
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
    // CAAI standard: minute ticks sit on the RIGHT side of the leg (relative to
    // the direction of flight), starting on the track line and extending out to
    // the same side as the numbers — not straddling the track. +nx/+ny is
    // right-of-travel (holds under map rotation since it is screen-projected).
    octx.moveTo(px, py);
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
  // Fixed GROUND size — cumKitePrintHeightMm tall at the 1:250,000 scale (× the
  // legArrowSize selector) — so it scales with the map like its position and
  // prints WYSIWYG at the intended physical height, keeping on-screen
  // proportions (so the time text fits). Falls back to the passed zoom scale
  // before the map is ready.
  const ppm = printPxPerMm();
  if (ppm) {
    const selc = (typeof legArrowSize === 'number' && legArrowSize > 0) ? legArrowSize : 1;
    sc = (tune('cumKitePrintHeightMm') * ppm / tune('cumKiteHeightPx')) * selc;
  }
  const W = tune('cumKiteHeightPx') * sc;
  const cell = tune('cumKiteCellWidthPx') * sc;
  const Lt = tune('cumKiteTriangleLenPx') * sc;
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
  // The whole kite is a fixed GROUND size — kitePrintHeightMm tall at the
  // 1:250,000 scale (× the legArrowSize selector) — so it scales with the map
  // like its position and prints WYSIWYG at the intended physical height, with
  // the on-screen proportions (triangle included). (Falls back to the passed
  // zoom scale before the map is ready.)
  if (printPxPerMm()) sc = kiteDrawScale();
  const W = tune('legKiteHeightPx') * sc;
  const cell = tune('legKiteCellWidthPx') * sc;
  const Lt = tune('legKiteTriangleLenPx') * sc;
  const Lr = cell * 2, L = Lr + Lt;
  const xb = -L / 2 + Lr;

  // Kite outline, reusable: clip() consumes the current path, so the halo pass
  // needs to lay it down more than once.
  const kitePath = () => {
    octx.beginPath();
    octx.moveTo(-L / 2, -W / 2);
    octx.lineTo(xb, -W / 2);
    octx.lineTo(L / 2, 0);
    octx.lineTo(xb, W / 2);
    octx.lineTo(-L / 2, W / 2);
    octx.closePath();
  };

  octx.save();
  octx.translate(cx, cy);
  octx.rotate(flightAng);
  if (halo) {                            // purple band around the marker
    // Only the OUTER half of the band should show: a stroke centred on the outline
    // would otherwise read as a second, internal highlight through the translucent
    // fill. Clip to everything OUTSIDE the kite (even-odd against a huge rect) and
    // stroke at double width, so the visible result is a halo-wide outer band.
    //
    // This deliberately ERASES NOTHING. Both earlier attempts used
    // destination-out: filling the whole path wiped every pixel already drawn
    // inside the kite (track line, drift lines, minute ticks), and clipping to the
    // interior and re-stroking merely narrowed that to a ring — still destructive,
    // because destination-out removes whatever is underneath, which during PNG
    // export is the background and the composited map tiles. Both left a
    // transparent hole (or ring) in the delivered image.
    octx.save();
    octx.beginPath();
    octx.rect(-1e5, -1e5, 2e5, 2e5);     // outer subpath …
    octx.moveTo(-L / 2, -W / 2);          // … minus the kite (even-odd)
    octx.lineTo(xb, -W / 2);
    octx.lineTo(L / 2, 0);
    octx.lineTo(xb, W / 2);
    octx.lineTo(-L / 2, W / 2);
    octx.closePath();
    octx.clip('evenodd');
    octx.lineJoin = 'round';
    // Centred stroke, inner half clipped away → the visible band is lineWidth/2,
    // which is exactly what the old erase-the-inside approach left. Do NOT double
    // it here or every haloed kite gets a band twice the shipped width.
    octx.lineWidth = tune('legKiteHaloPx') * sc;
    octx.strokeStyle = tune('legKiteHaloColor');
    kitePath();
    octx.stroke();
    octx.restore();
  }
  kitePath();
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

// Label to draw inside a waypoint circle, plus the radius and font px needed to
// fit it. The disc is a fixed GROUND size — waypointPrintDiaMm at the chart's
// 1:250,000 scale (× the wpSize selector) — so it scales with the map like its
// position and prints WYSIWYG at the intended physical mm. (Falls back to the
// base-px × zoom size before the map is ready.)
function waypointGeom(i) {
  const wp = state.waypoints[i];
  // Match wpLabel() / inspector placeholder ("WP N"), not a bare digit.
  const label = showWpNames ? waypointDisplayLabel(wp, i) : '';
  const ppm = printPxPerMm();
  const scale = ppm
    ? (tune('waypointPrintDiaMm') / 2) * ppm * wpSize / tune('waypointBaseRadiusPx')
    : wpSize * Math.max(tune('waypointMinZoomScale'), Math.pow(2, map.getZoom() - 12));
  // Every waypoint circle is the SAME size (radius depends only on the wpSize
  // slider × scale, never on the label). The text shrinks to fit instead of the
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
// Per-note size multiplier (default 1, clamped). A default (size-1) note is a
// fixed GROUND size — notePrintHeightMm tall at the chart's 1:250,000 scale —
// so it scales with the map like its position and prints WYSIWYG at the intended
// physical mm. (Falls back to a plain zoom curve before the map is ready.)
function noteUserSize(n) {
  const s = Number(n && n.size);
  return Number.isFinite(s) && s > 0 ? Math.max(0.5, Math.min(s, 4)) : 1;
}
function noteScale(n) {
  const user = noteUserSize(n);
  const ppm = printPxPerMm();
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

// Screen rotation applied to a note when it is drawn. Identification-point ovals
// align ACROSS the track (leg angle + 90°, per the standard's diagram), flipped
// 180° when the text would read upside-down; every other note is axis-aligned.
// SHARED with hitNote — when only drawNotes knew the angle, the clickable ellipse
// stayed axis-aligned while the painted one rotated, so on an east-west leg the
// two were 90° apart: clicking the visible oval missed it and clicking empty map
// beside it grabbed it.
function noteDrawAngle(n) {
  if (!n || !n.rp) return 0;
  const A = state.waypoints[n.rp.leg], B = state.waypoints[n.rp.leg + 1];
  if (!A || !B) return 0;
  const pa = proj(A), pb = proj(B);
  let ang = Math.atan2(pb.y - pa.y, pb.x - pa.x) + Math.PI / 2;
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  return ang;
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
  // Default box floor: notePrintWidthMm wide at the 1:250k scale (× the note's
  // own size). An oval uses the same default box as a rectangle so both note
  // shapes are the same size.
  const ppm = printPxPerMm();
  const minW = ppm
    ? tune('notePrintWidthMm') * ppm * noteUserSize(n)
    : tune('noteMinWidthPx') * sc;
  let w = Math.max(maxW + tune('notePadXPx') * sc * 2, minW);
  let h = Math.max(1, lines.length) * lineH + tune('notePadYPx') * sc * 2;
  const oval = n.rp ? true : n.shape === 'oval';
  // Identification-point ovals are a FIXED size (the hard-coded note print box)
  // — the box never grows with its text; the text is sized to fit it instead.
  if (n.rp && ppm) {
    w = tune('notePrintWidthMm') * ppm * noteUserSize(n);
    h = tune('notePrintHeightMm') * ppm * noteUserSize(n);
    return { x: s.x - w / 2, y: s.y - h / 2, w, h, lines, oval, fixed: true };
  }
  // Before the map is ready (no ppm) grow the ellipse by √2 so it bounds the
  // text; with the ground-sized box it already matches the rectangle.
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
    if (n && n.rp) {
      // Keep the anchored oval on its leg: recompute lat/lng from the anchor
      // every frame (the leg may have moved). Skip if the leg is gone.
      const g = reportPointGeom(n);
      if (!g) continue;
      n.lat = g.lat; n.lng = g.lng;
    }
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

    let lineH = tune('noteLineHeightPx') * noteScale(n);
    let fontPx = tune('noteFontPx') * noteScale(n);
    // Fixed-size ovals (identification points): shrink the text to fit the box
    // instead of growing the box. Fit the widest line into the ellipse's usable
    // width and all lines into its usable height.
    if (r.fixed) {
      octx.font = `bold ${fontPx}px sans-serif`;
      let widest = 1;
      for (const l of r.lines) widest = Math.max(widest, octx.measureText(l || ' ').width);
      const fitW = (r.w * 0.72) / widest;                       // ellipse narrows → 0.72
      const fitH = (r.h * 0.78) / (r.lines.length * lineH);
      const k = Math.min(1, fitW, fitH);
      fontPx *= k; lineH *= k;
    }

    // Identification-point ovals align ACROSS the track; see noteDrawAngle, which
    // hitNote shares so the clickable region matches what is painted.
    const ang = noteDrawAngle(n);
    const cx0 = r.x + r.w / 2, cy0 = r.y + r.h / 2;
    octx.save();
    octx.translate(cx0, cy0);
    if (ang) octx.rotate(ang);
    if (r.oval) {
      octx.beginPath();
      octx.ellipse(0, 0, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      octx.fill();
      octx.stroke();
    } else {
      octx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
      octx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
    }

    octx.font = `bold ${fontPx}px sans-serif`;
    octx.fillStyle = tune('inkColor');
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    const y0 = -(r.lines.length * lineH) / 2;
    for (let j = 0; j < r.lines.length; j++) {
      const ly = y0 + lineH / 2 + j * lineH;
      octx.fillText(r.lines[j], 0, ly);
      // CAAI: the planned time on an identification point is underlined. It is
      // the first line of a report-point oval.
      if (n.rp && j === 0 && r.lines[j]) {
        const tw = octx.measureText(r.lines[j]).width;
        const uy = ly + lineH * 0.42;
        octx.strokeStyle = tune('inkColor');
        octx.lineWidth = Math.max(1, tune('noteStrokeWidthPx'));
        octx.beginPath();
        octx.moveTo(-tw / 2, uy);
        octx.lineTo(tw / 2, uy);
        octx.stroke();
      }
    }
    octx.restore();
    octx.textAlign = 'left';
  }
}

function drawInfo() {
  // Totals come from routeProfile() -- the same model the flight plan's summary and
  // table use -- so the stats panel, the summary pill and the plan cannot print three
  // different ETEs for one route. (Per-leg kite times stay still-air/TAS on purpose:
  // they have to agree with the minute ticks they sit on.)
  const prof = (typeof routeProfile === 'function') ? routeProfile() : null;
  let totalDist = 0, totalH = 0;
  if (prof) {
    totalDist = prof.totalDist;
    totalH = prof.totalTimeH;
    // The pill must agree with the plan table, which keeps CTR legs off the clock. The
    // profile's own total stays untouched -- it feeds the FILED EET, and the filed time is
    // the whole flight, procedure legs included.
    if (typeof legInsideCtr === 'function' && Array.isArray(prof.legs)) {
      for (let i = 0; i < prof.legs.length; i++) {
        if (legInsideCtr(i) && prof.legs[i] && Number.isFinite(prof.legs[i].timeH)) {
          totalH -= prof.legs[i].timeH;
        }
      }
      if (totalH < 0) totalH = 0;
    }
  } else {
    for (let i = 0; i < state.legs.length; i++) {
      const A = state.waypoints[i], B = state.waypoints[i + 1];
      if (!A || !B) continue;   // legs can transiently outnumber waypoints-1 mid-edit; guard like the sibling loops
      if (typeof legInsideCtr === 'function' && legInsideCtr(i)) { totalDist += geo(A, B).dist; continue; }
      const g = geo(A, B);
      totalDist += g.dist;
      if (state.legs[i].flightSpeed > 0) totalH += g.dist / state.legs[i].flightSpeed;
    }
  }
  // The VOR legend row only makes sense while the stations are on the map.
  const vorRow = document.getElementById('legend-row-vor');
  if (vorRow) vorRow.style.display = (typeof showVorStations !== 'undefined' && showVorStations) ? '' : 'none';
  // The stats block that used to live at the bottom of the mobile menu is gone: the
  // legend card now carries the same totals at every width, and on a phone the two
  // were on screen together saying the same thing twice.
  drawSummaryPill(prof, totalDist, totalH);
  // Panning, zooming, editing the route or dragging the frame can all push the route
  // off the page — re-check here so the warning tracks whatever the map is showing.
  if (typeof refreshPrintFit === 'function') refreshPrintFit();
}

// Route totals, always on screen while a route exists. They lived only inside the
// mobile hamburger (and nowhere at all on desktop), so the headline numbers a pilot
// checks constantly -- distance, ETE, fuel -- meant opening a menu or the whole plan.
// Widest summary this browser has shown, in px. The legend card is hand-placed and
// draggable, so it must not resize under the cursor when a route appears, changes or
// is cleared -- and the reserved width has to survive a reload, when there is no
// route to measure. Monotone: it only ever grows.
const LEGEND_PILL_W_KEY = 'navaid.legendPillW';
let _legendPillW = (() => {
  try { return Math.max(0, parseFloat(localStorage.getItem(LEGEND_PILL_W_KEY)) || 0); }
  catch (e) { return 0; }
})();
function reserveSummaryWidth(pill) {
  const w = Math.ceil(pill.scrollWidth);
  if (w > _legendPillW + 0.5) {
    _legendPillW = w;
    try { localStorage.setItem(LEGEND_PILL_W_KEY, String(w)); } catch (e) { /* storage */ }
  }
  if (_legendPillW > 0) pill.style.minWidth = _legendPillW + 'px';
}

function drawSummaryPill(prof, totalDist, totalH) {
  const pill = document.getElementById('route-summary');
  if (!pill) return;
  // No route: keep the row's BOX but hide its ink. Removing it from layout made the
  // legend card resize the instant a route appeared or was cleared -- the card is
  // draggable and hand-placed, so it must not change size under the cursor. A
  // placeholder of the same shape as a real summary reserves a realistic width.
  if (!state.legs.length || totalDist <= 0) {
    pill.style.display = '';
    pill.style.visibility = 'hidden';
    pill.textContent = (typeof S.fpMobileSummary === 'function')
      ? S.fpMobileSummary(0, '0.0', '0:00', '0.0') : '0 NM';
    reserveSummaryWidth(pill);
    return;
  }
  pill.style.visibility = '';
  // Trip fuel includes the taxi/takeoff allowance when departing an airfield —
  // exactly the plan's rule (io.js taxiFuel), or the pill would read 1.1 gal light.
  // A fresh browser has no persisted aircraft object until the plan is opened,
  // but the plan already uses the tuning defaults in that state. Use the same
  // effective profile here so merely opening the plan cannot change this total.
  const summaryAircraft = (aircraft && typeof aircraft === 'object')
    ? aircraft : { gph: tune('defaultGph'), taxiGal: tune('defaultTaxiGal') };
  const taxi = (summaryAircraft.taxiGal > 0 && typeof isAirport === 'function' &&
    state.waypoints[0] && isAirport(state.waypoints[0])) ? summaryAircraft.taxiGal : 0;
  const gal = prof && prof.totalFuel > 0 ? prof.totalFuel + taxi : 0;
  pill.style.display = '';
  pill.textContent = (typeof S.fpMobileSummary === 'function')
    ? S.fpMobileSummary(state.legs.length, totalDist.toFixed(1),
      totalH > 0 ? toHMS(totalH) : '--', gal.toFixed(1))
    : `${totalDist.toFixed(1)} NM`;
  reserveSummaryWidth(pill);
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

// Screen pixels per paper-millimetre at the chart's 1:250,000 print scale
// (1 mm on paper = 250 m on the ground). Sizing a marker by this makes it a
// fixed GROUND size — it scales with the map exactly like its lat/lng position,
// so the arrangement you make on screen prints WYSIWYG, AND it comes out at the
// intended physical mm on a 1:250k A4/A3 export. Returns 0 before the map is
// ready so callers can fall back to a plain px size.
function printPxPerMm() {
  if (typeof map === 'undefined' || !map.getZoom) return 0;
  const mpp = metresPerPixel();
  return mpp > 0 ? 250 / mpp : 0;
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

// Every piece of INK the export will draw, as screen-space rectangles: waypoint discs,
// leg kites, cumulative kites (both directions), notes, comm callouts, report points
// and the flight-plan card. Testing waypoint coordinates alone was not enough -- a
// kite is ~18.5 x 33 mm of ink hanging off its leg, so a route whose waypoints all sit
// inside the frame can still print with its labels sliced off the edge.
function routeInkRects() {
  const rects = [];
  const wps = state.waypoints || [];
  const push = (x, y, w, h) => { if (Number.isFinite(x) && Number.isFinite(y)) rects.push({ x, y, w, h }); };
  // A rotated box (kite): take the axis-aligned bounds of its four corners.
  const pushRotated = (c, ax, ay, halfL, halfW) => {
    if (!c || !Number.isFinite(ax)) return;
    let dx = ax - c.x, dy = ay - c.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    const xs = [], ys = [];
    for (const sl of [-1, 1]) for (const sw of [-1, 1]) {
      xs.push(c.x + dx * halfL * sl + nx * halfW * sw);
      ys.push(c.y + dy * halfL * sl + ny * halfW * sw);
    }
    push(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  };

  for (let i = 0; i < wps.length; i++) {
    const p = proj(wps[i]);
    const g = (typeof waypointGeom === 'function') ? waypointGeom(i) : null;
    const r = g && Number.isFinite(g.r) ? g.r : 6;
    push(p.x - r, p.y - r, r * 2, r * 2);
  }
  const sc = (typeof legZoomScale === 'function') ? legZoomScale() : 1;
  const halfL = (tune('legKiteCellWidthPx') * 2 + tune('legKiteTriangleLenPx')) * sc / 2;
  const halfW = tune('legKiteHeightPx') * sc / 2;
  const cum = (typeof _cumKiteHalfDims === 'function') ? _cumKiteHalfDims() : null;
  for (let i = 0; i < (state.legs || []).length; i++) {
    const A = wps[i] && proj(wps[i]), B = wps[i + 1] && proj(wps[i + 1]);
    if (!A || !B) continue;
    // Only ink that is actually DRAWN may drive the clipping warning and "Fit page to
    // route" -- otherwise an invisible kite can claim the route hangs off the page, or
    // push the fit onto a larger sheet than the export needs. Mirror drawLegs()'s gates:
    // a hidden kite, a blocked one-way inbound, and the return direction.
    const legI = (state.legs || [])[i];
    // The EFFECTIVE gates, same as drawLegs: legKiteVisible covers both the explicit
    // hide/show flags and the CTR default, and a CTR leg draws no cum kite -- ink that is
    // never painted must not grow the fitted page or fire the clipping warning.
    const kiteOff = typeof legKiteVisible === 'function'
      ? !legKiteVisible(i, legI)
      : (typeof legKiteHidden === 'function' && legKiteHidden(legI));
    const preClock = typeof legInsideCtr === 'function' && legInsideCtr(i);
    const inBlocked = typeof legAltitudeIsBlocked === 'function' &&
      legAltitudeIsBlocked(legI, 'inboundAltitude');
    if (typeof legLabelCenter === 'function' && !kiteOff) {
      if (!inBlocked) pushRotated(legLabelCenter(i, 'in'), B.x, B.y, halfL, halfW);
      if (typeof showReturn !== 'undefined' && showReturn &&
          (typeof legAllowsReturn !== 'function' || legAllowsReturn(i))) {
        pushRotated(legLabelCenter(i, 'out'), A.x, A.y, halfL, halfW);
      }
    }
    if (cum && typeof showCumTime !== 'undefined' && showCumTime && !preClock) {
      if (typeof cumLabelCenter === 'function') pushRotated(cumLabelCenter(i), B.x, B.y, cum.halfL, cum.halfW);
      if (typeof showReturn !== 'undefined' && showReturn && typeof cumLabelRetCenter === 'function') {
        pushRotated(cumLabelRetCenter(i), A.x, A.y, cum.halfL, cum.halfW);
      }
    }
  }
  for (let i = 0; i < (state.notes || []).length; i++) {
    const n = state.notes[i];
    const box = (n && n.cc && typeof commCalloutRect === 'function') ? commCalloutRect(n)
      : (typeof noteRect === 'function' ? noteRect(i) : null);
    if (box) push(box.x, box.y, box.w, box.h);
    // A comm callout also draws a leader to its anchor point.
    if (n && n.cc && typeof commCalloutGeom === 'function') {
      const g = commCalloutGeom(n);
      if (g && g.tail) push(g.tail.x - 2, g.tail.y - 2, 4, 4);
    }
    if (n && n.rp && typeof reportPointGeom === 'function') {
      const g = reportPointGeom(n);
      if (g) { const p = proj({ lat: g.lat, lng: g.lng }); push(p.x - 12, p.y - 12, 24, 24); }
    }
  }
  if (typeof planCardRect !== 'undefined' && planCardRect) {
    push(planCardRect.x, planCardRect.y, planCardRect.w, planCardRect.h);
  }
  return rects;
}

// Does everything the export draws sit inside the page frame? The frame is a fixed
// REAL-WORLD size (A4 is ~40x28 NM at 1:250,000), so a long route cannot fit however
// far you zoom -- and nothing said so: Print happily produced a page with two thirds
// of the route outside it. Reports what is inside so the UI can warn.
function routePageFit() {
  const r = pageFrameRect();
  const items = routeInkRects();
  if (!r || !items.length) return { fits: true, inside: items.length, total: items.length };
  let inside = 0;
  for (const it of items) {
    if (it.x >= r.x && it.x + it.w <= r.x + r.w &&
        it.y >= r.y && it.y + it.h <= r.y + r.h) inside++;
  }
  return { fits: inside === items.length, inside, total: items.length };
}

// Smallest page that holds the route, centred on it. Tries every size/orientation in
// increasing paper area and centres the frame on the route's midpoint; returns false
// when even the largest cannot hold it (the caller says so rather than pretending).
function fitPageToRoute() {
  const wps = (state.waypoints || []);
  if (!wps.length) return false;
  // Fit the INK, not the waypoints: fitting to bare coordinates chose a page that
  // satisfied the old check while kites and notes still hung off the edge -- the
  // button would clear its own warning and still print a clipped sheet.
  const items = routeInkRects();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.x); maxX = Math.max(maxX, it.x + it.w);
    minY = Math.min(minY, it.y); maxY = Math.max(maxY, it.y + it.h);
  }
  if (!Number.isFinite(minX)) return false;
  const need = { w: maxX - minX, h: maxY - minY };
  const mid = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const mpp = metresPerPixel();
  const candidates = [];
  for (const size of ['A4', 'A4x2', 'A3']) {
    for (const orient of ['landscape', 'portrait']) {
      const p = PAGE_NM[size];
      const d = orient === 'portrait' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
      candidates.push({ size, orient, w: d.w * 1852 / mpp, h: d.h * 1852 / mpp });
    }
  }
  const pick = candidates.find(c => c.w >= need.w && c.h >= need.h);
  if (!pick) return false;
  pageSize = pick.size;
  pageOrient = pick.orient;
  // Centre the chosen page on the route: pageFrameRect() centres on the viewport and
  // then adds pageOffset, so the offset is simply route-midpoint minus viewport-centre.
  pageOffset = { x: mid.x - vw() / 2, y: mid.y - vh() / 2 };
  return { size: pick.size, orient: pick.orient };
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
    // The printed kneeboard must say what the on-screen plan says: CTR legs read --- and
    // stay out of the running clock. Fuel is real either way.
    const cardPre = typeof legInsideCtr === 'function' && legInsideCtr(i);
    if (!cardPre) totTime += dur;
    totFuel += fuel;
    const fLabel = ac ? fuel.toFixed(1) + (i === 0 && taxiFuel ? ' *' : '') : '--';
    const rd = vorCells(B, legs[i]);
    rows.push({ num: i + 1, from: waypointDisplayLabel(A, i),
      to: waypointDisplayLabel(B, i + 1),
      hdg: pad3(hdg) + '°M', dist: dist.toFixed(1),
      speed: String(legs[i].flightSpeed),
      // Guard non-finite (unknown) altitude like the kite + flight-plan modal do,
      // so the PNG plan card shows the unknown-label instead of the literal "NaN".
      alt: formatAltitudeValue(legs[i].inboundAltitude, legs[i], 'inboundAltitude'),
      time: cardPre ? '---' : (dur > 0 ? toHMS(dur) : '--'), fuel: fLabel,
      cumTime: cardPre ? '---' : (totTime > 0 ? toHMS(totTime) : '--'),
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

// --- graph-legs review overlay (?graphlegs=1) ---------------------------------
// Every published segment of the current layer's graph, drawn as it is STORED, so the
// stored direction can be read straight off the chart underneath it. A review tool, not a
// feature: no toolbar entry, nothing persisted, invisible unless the flag is in the URL.
//
// Deliberately not the leg kite. The kite answers "what altitude am I flying this leg at"
// for ONE leg of the pilot's route; this answers "what does the dataset claim" for all 271
// of them at once, and a kite per segment would bury the map it is meant to be checked
// against.
//
// It reads the same fields routing reads, so what is drawn is what fplGraphChain will do:
// a one-way arrow points the way the chain search may actually travel.
var _graphLegsGraph = null;
var _graphLegsLoading = false;
function graphLegsEnabled() {
  try { return new URLSearchParams(location.search).get('graphlegs') === '1'; }
  catch (e) { return false; }
}
// Class -> tuning key. The colours live in the registry (and therefore in the live gist)
// like every other presentation value in the drawing code; nothing here is a literal.
const GRAPH_LEG_COLOR_KEYS = {
  army:   'graphLegArmyColor',     // never routable
  atc:    'graphLegAtcColor',      // real-time clearance only
  closed: 'graphLegClosedColor',   // hinted shut
  oneWay: 'graphLegOneWayColor',
  plain:  'graphLegPlainColor',
};
const graphLegColor = (kind) => tune(GRAPH_LEG_COLOR_KEYS[kind] || 'graphLegPlainColor');
function drawGraphLegs() {
  if (!graphLegsEnabled()) return;
  const prefix = (typeof layerDataPrefix === 'function') ? layerDataPrefix() : 'cvfr';
  if (!_graphLegsGraph && !_graphLegsLoading) {
    _graphLegsLoading = true;
    routeGraphData(prefix).then(g => {
      _graphLegsGraph = g || null; _graphLegsLoading = false; scheduleDraw();
    }).catch(() => { _graphLegsLoading = false; });
    return;
  }
  const g = _graphLegsGraph;
  if (!g || !g.nodes || !g.edges) return;
  const zoom = map.getZoom();
  const labels = zoom >= tune('graphLegLabelMinZoom');
  octx.save();
  octx.lineWidth = tune('graphLegWidthPx');
  octx.lineCap = 'round';
  octx.font = 'bold 12px sans-serif';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  const seen = new Set();
  for (const [from, es] of Object.entries(g.edges)) {
    for (const e of es) {
      const key = [from, e.to].sort().join('|');
      if (seen.has(key)) continue;          // one line per undirected pair
      seen.add(key);
      const rev = (g.edges[e.to] || []).find(x => x.to === from);
      const a = g.nodes[from], b = g.nodes[e.to];
      if (!a || !b) continue;
      // The direction that may actually be flown, decided exactly as routing decides it.
      const fwdOpen = !e.blocked, revOpen = !!rev && !rev.blocked;
      const flown = fwdOpen ? e : rev;
      if (!flown) continue;
      const p = proj(fwdOpen ? a : b), q = proj(fwdOpen ? b : a);
      const kind = flown.armyAirway ? 'army' : flown.onAtcApproval ? 'atc'
        : flown.closedHint ? 'closed' : (fwdOpen && revOpen) ? 'plain' : 'oneWay';
      octx.strokeStyle = graphLegColor(kind);
      octx.setLineDash(kind === 'closed' ? [9, 7] : []);
      octx.beginPath(); octx.moveTo(p.x, p.y); octx.lineTo(q.x, q.y); octx.stroke();
      octx.setLineDash([]);
      // Arrowheads: one per travellable direction, so a two-way leg reads <---> and a
      // one-way reads ---> without having to consult a legend.
      //
      // FILLED and large on purpose. This overlay is read while cross-checking a chart, at
      // whatever zoom the airspace happens to need, and two thin strokes could not be told
      // apart from the segment they sit on. A solid triangle survives a busy background.
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      const head = (x, y, dir) => {
        const s = tune('graphLegArrowPx'), spread = 0.42;
        octx.beginPath();
        octx.moveTo(x, y);
        octx.lineTo(x - s * Math.cos(dir - spread), y - s * Math.sin(dir - spread));
        octx.lineTo(x - s * 0.62 * Math.cos(dir), y - s * 0.62 * Math.sin(dir));
        octx.lineTo(x - s * Math.cos(dir + spread), y - s * Math.sin(dir + spread));
        octx.closePath();
        octx.fillStyle = graphLegColor(kind);
        octx.fill();
      };
      // Each arrowhead sits at the end its direction STARTS from, next to that
      // direction's altitude -- so an arrow and the figure it belongs to are read as one
      // mark. Putting the head at the far end instead left the pair split across the leg,
      // and on a two-way leg there was no way to tell which figure went with which arrow.
      // The head still POINTS the way of travel; only where it sits changed.
      const startFwd = 0.22, startRev = 0.78;
      head(p.x + (q.x - p.x) * startFwd, p.y + (q.y - p.y) * startFwd, ang);
      if (fwdOpen && revOpen) head(p.x + (q.x - p.x) * startRev, p.y + (q.y - p.y) * startRev, ang + Math.PI);
      if (!labels) continue;
      // The altitude of the direction being flown -- the same field the kite reads, so a
      // blank here is the dataset defect this overlay exists to make visible.
      // A two-way leg has TWO altitudes and they routinely differ (4000 one way, 3500 the
      // other). One label in the middle could only ever show one of them, and gave no clue
      // which -- so each altitude is drawn beside the end it is flown FROM, which is where
      // the published CVFR chart prints it. Matching the chart's own convention is the
      // point: this overlay is read side by side with it, and a figure in the other place
      // would have to be mentally re-mapped on every leg.
      //
      // Read off the entry for the direction concerned: inboundAltitude is always
      // "this entry's from -> to", so the p->q direction takes fwd.inboundAltitude and the
      // q->p direction takes the reverse entry's.
      const fwdEntry = fwdOpen ? e : rev;              // the p -> q direction
      const revEntry = fwdOpen ? rev : e;              // the q -> p direction
      const txt = (v) => Number.isFinite(v) ? String(v) : '—';
      const put = (x, y, label) => {
        octx.lineWidth = tune('overlayLabelHaloWidthPx') || 4;
        octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
        octx.strokeText(label, x, y);
        octx.fillStyle = graphLegColor(kind);
        octx.fillText(label, x, y);
        octx.lineWidth = tune('graphLegWidthPx');
      };
      // Sit the labels just inside the arrowheads, offset perpendicular to the leg so they
      // clear the line itself whatever angle it runs at.
      const nx = -Math.sin(ang) * 9, ny = Math.cos(ang) * 9;
      const at = (t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      const twoWay = fwdOpen && revOpen;
      if (twoWay) {
        // p->q starts at p; q->p starts at q.
        const a = at(0.30), b = at(0.70);
        put(a.x + nx, a.y + ny, txt(fwdEntry && fwdEntry.inboundAltitude));
        put(b.x + nx, b.y + ny, txt(revEntry && revEntry.inboundAltitude));
      } else {
        const a = at(0.30);          // the permitted direction runs p -> q, so it starts at p
        put(a.x + nx, a.y + ny, txt(flown.inboundAltitude));
      }
    }
  }
  octx.restore();
}
