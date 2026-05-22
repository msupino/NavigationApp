'use strict';
/* NavAid — drawing: route, nav-waypoints, notes, page frame.
   Shares globals with core.js; loaded after it. */

// --- drawing ---------------------------------------------------------
function draw() {
  octx.clearRect(0, 0, vw(), vh());
  drawNavWaypoints();
  drawLegs();
  drawWaypoints();
  drawNotes();
  drawInfo();
  drawPageFrame();
  persist();
}

// --- nav-waypoint reference overlay ---------------------------------
// Lazy-loads docs/nav-waypoints.json on first activation. Format:
// { waypoints:[{ name, lat, lng }] } — 238 published reporting points.
// (Old GeoJSON-style entries with `coord:[lng,lat]` are also accepted
// as a fallback if a stale cache returns them.)
async function loadNavWaypoints() {
  if (navWP !== null) return navWP;
  try {
    // ?v bumped whenever nav-waypoints.json changes — the service worker
    // caches it cache-first, so a new URL is needed to pick up edits.
    const res = await fetch('nav-waypoints.json?v=2');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    navWP = (d.waypoints || []).map(w => ({
      name: w.name,
      he: w.he || '',                    // Hebrew label (English kept for search)
      lat: w.lat ?? (w.coord && w.coord[1]),
      lng: w.lng ?? (w.coord && w.coord[0]),
    }));
  } catch (e) {
    console.warn('Failed to load nav waypoints:', e);
    navWP = [];
  }
  return navWP;
}

// Closest nav waypoint within `pxThreshold` screen pixels of `latlng`,
// or null. Returns the {name, lat, lng} entry from the loaded JSON.
function nearestNavWaypoint(latlng, pxThreshold) {
  if (!navWP || !navWP.length) return null;
  const t = map.latLngToContainerPoint([latlng.lat, latlng.lng]);
  let bestDist = pxThreshold, best = null;
  for (const wp of navWP) {
    const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d < bestDist) { bestDist = d; best = wp; }
  }
  return best;
}

// True if `name` matches a known nav waypoint (English or Hebrew) — so we
// treat it as auto-snapped, not user-typed, and may overwrite on drag.
function isNavName(name) {
  if (!name || !navWP) return false;
  for (const wp of navWP) if (wp.name === name || wp.he === name) return true;
  return false;
}

// Decide where a waypoint should sit + what to call it given a target
// position and its current name. Used by both initial drop and drag.
//  - If the current name is user-typed (non-empty, not a nav name): leave
//    the name alone; just move to the target latlng.
//  - Else if a nav waypoint is within 18 px of the target: snap lat/lng +
//    name to that nav waypoint.
//  - Else if the current name was a nav name (no longer near any nav):
//    clear it so the circle reverts to the sequence number.
function applyNavSnap(latlng, currentName) {
  // Snap only while the nav-waypoint overlay is shown.
  if (!showNavWP) {
    return { lat: latlng.lat, lng: latlng.lng, name: currentName || '' };
  }
  if (currentName && !isNavName(currentName)) {
    return { lat: latlng.lat, lng: latlng.lng, name: currentName };
  }
  const snap = nearestNavWaypoint(latlng, 18);
  if (snap) {
    return { lat: snap.lat, lng: snap.lng, name: snap.he || snap.name };
  }
  return { lat: latlng.lat, lng: latlng.lng,
           name: isNavName(currentName) ? '' : (currentName || '') };
}

function drawNavWaypoints() {
  if (!showNavWP || !navWP || navWP.length === 0) return;
  const showLabels = map.getZoom() >= 10;
  octx.font = 'bold 10px sans-serif';
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  for (const wp of navWP) {
    const s = proj(wp);                  // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
    octx.fillStyle = '#ffffff';
    octx.strokeStyle = '#161412';
    octx.lineWidth = 1.5;
    octx.beginPath();
    octx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
    if (showLabels) {
      const label = wp.he || wp.name;    // Hebrew name; English is for search
      octx.lineWidth = 2.5;
      octx.strokeStyle = 'rgba(255,255,255,0.85)';
      octx.strokeText(label, s.x + 6, s.y);
      octx.fillStyle = '#161412';
      octx.fillText(label, s.x + 6, s.y);
    }
  }
  octx.lineWidth = 1;
}

function drawLegs() {
  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    if (!A || !B) continue;
    const leg = state.legs[i];
    const sa = proj(A), sb = proj(B);
    const selected = state.selected &&
                     state.selected.type === 'leg' &&
                     state.selected.index === i;

    octx.lineCap = 'round';
    octx.strokeStyle = selected ? '#ffcc33' : '#161412';
    octx.lineWidth = selected ? 5 : 3.5;
    octx.beginPath();
    octx.moveTo(sa.x, sa.y);
    octx.lineTo(sb.x, sb.y);
    octx.stroke();
    octx.lineCap = 'butt';

    drawDriftLines(sa, sb);

    const { dist, brg } = geo(A, B);
    const durH = leg.flightSpeed > 0 ? dist / leg.flightSpeed : 0;
    const magIn = toMagnetic(brg);
    const magOut = (magIn + 180) % 360;
    const timeStr = durH > 0 ? toHMS(durH) : '--';

    drawMinuteMarkers(sa, sb, durH);

    const ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    let dx = sb.x - sa.x, dy = sb.y - sa.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    const inP = leg.inLabel || { a: 0, p: 44 };
    const outP = leg.outLabel || { a: 0, p: -44 };
    drawLegArrow(mid.x + dx * inP.a + nx * inP.p, mid.y + dy * inP.a + ny * inP.p,
      ang, pad3(magIn), timeStr, String(leg.inboundAltitude),
      '#2f6fd0', yellowFill(0.80), isAltChange(i, 'in'));
    if (showReturn) {
      drawLegArrow(mid.x + dx * outP.a + nx * outP.p,
        mid.y + dy * outP.a + ny * outP.p, ang + Math.PI,
        pad3(magOut), timeStr, String(leg.outboundAltitude),
        '#c0392b', 'rgba(255,204,214,0.80)', isAltChange(i, 'out'));
    }
    if (showMidLeg) drawDistanceBadge(mid.x, mid.y, dist);
  }
}

// 10-degree drift reference lines, one from each end, half the leg length.
function drawDriftLines(sa, sb) {
  const a = 10 * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const abx = sb.x - sa.x, aby = sb.y - sa.y;
  const bax = -abx, bay = -aby;
  octx.save();
  octx.setLineDash([5, 4]);
  octx.lineWidth = 1.5;
  octx.strokeStyle = 'rgba(20,20,20,0.6)';
  octx.beginPath();
  octx.moveTo(sa.x, sa.y);
  octx.lineTo(sa.x + (abx * c - aby * s) * 0.5, sa.y + (abx * s + aby * c) * 0.5);
  octx.moveTo(sb.x, sb.y);
  octx.lineTo(sb.x + (bax * c - bay * s) * 0.5, sb.y + (bax * s + bay * c) * 0.5);
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
  octx.font = 'bold 10px sans-serif';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  const count = Math.floor(totalMin);
  for (let m = 1; m <= count; m++) {
    const f = m / totalMin;
    const px = sa.x + (sb.x - sa.x) * f;
    const py = sa.y + (sb.y - sa.y) * f;
    const even = m % 2 === 0;
    const tick = even ? 9 : 4;          // long on even minutes, short on odd
    octx.strokeStyle = '#161412';
    octx.lineWidth = even ? 2 : 1.5;
    octx.beginPath();
    octx.moveTo(px - nx * tick, py - ny * tick);
    octx.lineTo(px + nx * tick, py + ny * tick);
    octx.stroke();
    if (even) {                         // minute number past the tick end
      const tx = px + nx * (tick + 8), ty = py + ny * (tick + 8);
      octx.lineWidth = 2.5;
      octx.strokeStyle = 'rgba(255,255,255,0.85)';
      octx.strokeText(String(m), tx, ty);
      octx.fillStyle = '#161412';
      octx.fillText(String(m), tx, ty);
    }
  }
  octx.textAlign = 'left';
}

// Altitude diff: leg's flown altitude differs from the adjacent leg's, so a
// climb/descent happens here. 'in'  -> inbound vs previous leg's inbound,
// 'out' -> outbound vs next leg's outbound (return-direction).
function isAltChange(i, which) {
  if (!highlightDiff) return false;
  const cur = state.legs[i];
  if (which === 'in') {
    if (i === 0) return false;
    return cur.inboundAltitude !== state.legs[i - 1].inboundAltitude;
  }
  if (i === state.legs.length - 1) return false;
  return cur.outboundAltitude !== state.legs[i + 1].outboundAltitude;
}

// Navigation leg marker: a two-cell rectangle (altitude, time) joined to a
// triangle (heading) pointing in the flight direction. Text runs across the
// marker and is locked to its orientation.
function drawLegArrow(cx, cy, flightAng, head, time, alt, accent, fill, halo) {
  const W = 46, cell = 22, Lt = 26;
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
    octx.lineWidth = 7;
    octx.strokeStyle = '#8e44ad';
    octx.stroke();
    octx.lineJoin = 'miter';
  }
  octx.fillStyle = fill;
  octx.fill();
  octx.lineWidth = 2;
  octx.strokeStyle = accent;
  octx.stroke();
  octx.lineWidth = 1;
  for (const dx of [-L / 2 + cell, xb]) {
    octx.beginPath();
    octx.moveTo(dx, -W / 2);
    octx.lineTo(dx, W / 2);
    octx.stroke();
  }
  octx.restore();

  const ta = flightAng + Math.PI / 2;
  const cos = Math.cos(flightAng), sin = Math.sin(flightAng);
  const at = lx => ({ x: cx + lx * cos, y: cy + lx * sin });
  const pAlt = at(-L / 2 + cell * 0.5);
  const pTime = at(-L / 2 + cell * 1.5);
  const pHead = at(xb + Lt * 0.32);
  drawRotText(pAlt.x, pAlt.y, ta, alt, 'bold 13px sans-serif', '#000');
  drawRotText(pTime.x, pTime.y, ta, time, 'bold 13px sans-serif', '#000');
  drawRotText(pHead.x, pHead.y, ta, head, 'bold 14px sans-serif', '#000');
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
  octx.arc(cx, cy, 15, 0, Math.PI * 2);
  octx.fillStyle = yellowFill(0.90);
  octx.fill();
  octx.lineWidth = 2.5;
  octx.strokeStyle = '#161412';
  octx.stroke();
  octx.fillStyle = '#161412';
  octx.font = 'bold 11px sans-serif';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(dist.toFixed(1), cx, cy);
  octx.textAlign = 'left';
}

const WP_RADIUS = 13;

// Label to draw inside a waypoint circle, plus the radius and font px
// needed to fit it. Scaled by the global `wpSize` slider.
function waypointGeom(i) {
  const wp = state.waypoints[i];
  // Names off -> empty circle (no name, no number).
  const label = showWpNames ? ((wp.name || '').trim() || String(i + 1)) : '';
  const fontPx = Math.max(8, Math.round(13 * wpSize));
  octx.font = `bold ${fontPx}px sans-serif`;
  const w = octx.measureText(label).width;
  const minR = WP_RADIUS * wpSize;
  return { label, fontPx, r: Math.max(minR, w / 2 + fontPx * 0.7) };
}

function drawWaypoints() {
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    const s = proj(wp);
    const selected = state.selected &&
                     state.selected.type === 'wp' &&
                     state.selected.index === i;
    const { label, fontPx, r } = waypointGeom(i);
    const radius = selected ? r + 2 : r;

    octx.beginPath();
    octx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    octx.fillStyle = selected ? '#ffcc33' : yellowFill(0.60);
    octx.fill();
    octx.lineWidth = 3;
    octx.strokeStyle = '#161412';
    octx.stroke();

    octx.save();
    octx.translate(s.x, s.y);
    if (wpNameAngle) octx.rotate(wpNameAngle * Math.PI / 180);
    octx.font = `bold ${fontPx}px sans-serif`;
    octx.fillStyle = '#161412';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(label, 0, 0);
    octx.restore();
    octx.textAlign = 'left';
  }
}

// --- notes (free-text annotation boxes) ------------------------------
const NOTE_FONT = 'bold 12px sans-serif';
const NOTE_PAD_X = 8;
const NOTE_PAD_Y = 6;
const NOTE_LINE_H = 16;
const NOTE_MIN_W = 56;                  // keep short / empty notes landscape

function noteRect(i) {
  const n = state.notes[i];
  const s = proj(n);
  const lines = (n.text || '').split('\n');
  octx.font = NOTE_FONT;
  let maxW = 1;
  for (const l of lines) {
    const w = octx.measureText(l || ' ').width;
    if (w > maxW) maxW = w;
  }
  let w = Math.max(maxW + NOTE_PAD_X * 2, NOTE_MIN_W);
  let h = Math.max(1, lines.length) * NOTE_LINE_H + NOTE_PAD_Y * 2;
  const oval = n.shape === 'oval';
  if (oval) { w *= Math.SQRT2; h *= Math.SQRT2; }   // ellipse must bound the text
  return { x: s.x - w / 2, y: s.y - h / 2, w, h, lines, oval };
}

function drawNotes() {
  for (let i = 0; i < state.notes.length; i++) {
    const n = state.notes[i];
    const r = noteRect(i);
    const selected = state.selected &&
                     state.selected.type === 'note' &&
                     state.selected.index === i;
    const color = n.color || NOTE_DEFAULT_COLOR;
    octx.fillStyle = tintFill(color, selected ? 0.95 : 0.80);
    octx.lineWidth = selected ? 2.5 : 1.5;
    octx.strokeStyle = selected ? '#ffcc33' : '#161412';
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

    octx.font = NOTE_FONT;
    octx.fillStyle = '#161412';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    const cx = r.x + r.w / 2;
    const y0 = r.y + (r.h - r.lines.length * NOTE_LINE_H) / 2;
    for (let j = 0; j < r.lines.length; j++) {
      octx.fillText(r.lines[j], cx, y0 + NOTE_LINE_H / 2 + j * NOTE_LINE_H);
    }
    octx.textAlign = 'left';
  }
}

function drawInfo() {
  let totalDist = 0, totalH = 0;
  for (let i = 0; i < state.legs.length; i++) {
    const { dist } = geo(state.waypoints[i], state.waypoints[i + 1]);
    totalDist += dist;
    if (state.legs[i].flightSpeed > 0) totalH += dist / state.legs[i].flightSpeed;
  }
  document.getElementById('info').textContent =
    `Waypoints  ${state.waypoints.length}\n` +
    `Legs       ${state.legs.length}\n` +
    `Distance   ${totalDist.toFixed(1)} NM\n` +
    `Total time ${totalH > 0 ? toHMS(totalH) : '--'}`;
}

// --- print page frame -----------------------------------------------
// Landscape page coverage in nautical miles at 1:250,000.
const PAGE_NM = { A4: { w: 40.09, h: 28.35 }, A3: { w: 56.70, h: 40.09 } };

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
  const t = 14;
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

function drawPageFrame() {
  const r = pageFrameRect();
  if (!r) return;
  octx.save();
  octx.fillStyle = 'rgba(20,18,18,0.4)';
  octx.beginPath();
  octx.rect(0, 0, vw(), vh());
  octx.rect(r.x, r.y, r.w, r.h);
  octx.fill('evenodd');
  octx.strokeStyle = '#ffcc33';
  octx.lineWidth = 2;
  octx.setLineDash([8, 5]);
  octx.strokeRect(r.x, r.y, r.w, r.h);
  octx.restore();
}

