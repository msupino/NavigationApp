'use strict';
/* NavAid — drawing: route, nav-waypoints, notes, page frame.
   Shares globals with core.js; loaded after it. */

// --- drawing ---------------------------------------------------------
function draw() {
  octx.clearRect(0, 0, vw(), vh());
  drawNavWaypoints();
  drawAirfields();
  drawLegs();
  drawWaypoints();
  drawNotes();
  drawInfo();
  drawPageFrame();
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

// --- nav-waypoint reference overlay ---------------------------------
// Lazy-loads docs/nav-waypoints.json on first activation. Format:
// { waypoints:[{ name, he, lat, lng }] } — 256 published reporting points.
// Validated strictly by validateNavWaypoints() (issue #101): every
// documented field must be present and well-typed; extras are silently
// allowed for forward-compat.
async function loadNavWaypoints() {
  if (navWP !== null) return navWP;
  try {
    // ?v bumped whenever nav-waypoints.json changes — the service worker
    // caches it cache-first, so a new URL is needed to pick up edits.
    const res = await fetch(S.navWpUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const verr = validateNavWaypoints(d);
    if (verr) {
      console.warn('nav-waypoints schema error:', verr);
      alert(S.errInvalidNavWaypoints(verr));
      return [];
    }
    navWP = d.waypoints.map(w => ({
      name: w.name,
      he: w.he,                          // Hebrew label (English kept for search)
      lat: w.lat,
      lng: w.lng,
    }));
    return navWP;
  } catch (e) {
    // Leave navWP === null so a subsequent toggle / search / snap call can
    // retry — assigning [] would make the early-return guard short-circuit
    // forever and disable nav waypoints for the whole session (issue #72).
    console.warn('Failed to load nav waypoints:', e);
    return [];
  }
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

// Resolve a stored waypoint name to the current locale. If the stored value
// is a nav-WP name (either language), return the locale-appropriate version.
// User-typed names are returned as-is.
function navName(stored) {
  if (!stored || !navWP) return stored || '';
  for (const nw of navWP) {
    if (nw.name === stored || nw.he === stored)
      return nw[S.navWpSearchField] || nw.name;
  }
  return stored;
}

// Decide where a waypoint should sit + what to call it given a target
// position and its current name. Used by both initial drop and drag.
//  - If the current name is user-typed (non-empty, not an auto-snap name):
//    leave the name alone; just move to the target latlng.
//  - Else if an airfield is within 18 px of the target (overlay on):
//    snap lat/lng + adopt its ICAO `name`.
//  - Else if a nav waypoint is within 18 px of the target (overlay on):
//    snap lat/lng + name to that nav waypoint.
//  - Else if the current name was an auto-snap name (no longer near any):
//    clear it so the circle reverts to the sequence number.
// Airfields take priority because they're a much smaller set of strongly-
// known landmarks (16 vs 256 nav-WPs); if both overlays sit on the same
// spot the airfield name is the more meaningful identifier.
function applyNavSnap(latlng, currentName) {
  if (!showAirfields && !showNavWP) {
    const autoSnapped = isAirfieldName(currentName) || isNavName(currentName);
    return { lat: latlng.lat, lng: latlng.lng,
             name: autoSnapped ? '' : (currentName || '') };
  }
  const autoSnapped = isAirfieldName(currentName) || isNavName(currentName);
  const userTyped = currentName && !autoSnapped;
  // #106: Force-snap mode lifts the 18 px radius so every click resolves to
  // the absolute nearest known point. Useful when the chart has many close
  // reporting points and the user wants the published coordinate regardless
  // of click precision.
  const px = window.forceSnap ? Infinity : 18;
  if (showAirfields) {
    const af = nearestAirfield(latlng, px);
    if (af) {
      const name = userTyped ? currentName : af.name;
      return { lat: af.lat, lng: af.lng, name };
    }
  }
  if (showNavWP) {
    const snap = nearestNavWaypoint(latlng, px);
    if (snap) {
      const name = userTyped ? currentName : (snap[S.navWpSearchField] || snap.name);
      return { lat: snap.lat, lng: snap.lng, name };
    }
  }
  return { lat: latlng.lat, lng: latlng.lng,
           name: autoSnapped ? '' : (currentName || '') };
}

// --- airfield reference overlay -------------------------------------
// Lazy-loads docs/airfields.json on first activation. Format:
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
      plates: a.plates.slice(),
      runways: Array.isArray(a.runways) ? a.runways.slice() : null,
    }));
    return airfields;
  } catch (e) {
    // Leave airfields === null so a subsequent toggle / search call can
    // retry — assigning [] would make the early-return guard short-circuit
    // forever and disable the overlay for the whole session (issue #72).
    console.warn('Failed to load airfields:', e);
    return [];
  }
}

// Closest airfield within `pxThreshold` screen pixels of `latlng`, or null.
// Returns the {name, he, en, lat, lng, ...} entry from the loaded JSON.
function nearestAirfield(latlng, pxThreshold) {
  if (!airfields || !airfields.length) return null;
  const t = map.latLngToContainerPoint([latlng.lat, latlng.lng]);
  let bestDist = pxThreshold, best = null;
  for (const af of airfields) {
    const p = map.latLngToContainerPoint([af.lat, af.lng]);
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d < bestDist) { bestDist = d; best = af; }
  }
  return best;
}

// True if `name` matches a known airfield ICAO (its `name` field).
// Airfield labels are ICAO — the locale-specific Hebrew / English label
// is only shown next to the marker, never stored as the WP name.
function isAirfieldName(name) {
  if (!name || !airfields) return false;
  for (const af of airfields) if (af.name === name) return true;
  return false;
}

// Distinct from nav-WPs: airfields are rendered as a blue-filled upward
// triangle (▲) outline, sized to ~7 px at typical zooms. The ICAO and
// localised name appear next to the marker at zoom ≥ 10. Suppressed when
// a route waypoint sits on the airfield (proximity-based, like nav-WPs).
function drawAirfields() {
  if (!showAirfields || !airfields || airfields.length === 0) return;
  const SNAP_DEG = 0.0002;               // ~22 m — matches nearestAirfield px threshold
  const showLabels = map.getZoom() >= 10;
  const r = 7;                           // half-width of the triangle, screen px
  octx.font = 'bold 11px sans-serif';
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  for (const af of airfields) {
    const occupied = state.waypoints.some(
      w => Math.abs(w.lat - af.lat) < SNAP_DEG && Math.abs(w.lng - af.lng) < SNAP_DEG);
    if (occupied) continue;
    const s = proj(af);                  // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
    octx.beginPath();
    octx.moveTo(s.x,          s.y - r);
    octx.lineTo(s.x + r * 0.95, s.y + r * 0.65);
    octx.lineTo(s.x - r * 0.95, s.y + r * 0.65);
    octx.closePath();
    octx.fillStyle = '#2f6fd0';          // saturated blue — distinct from white nav-WP dots
    octx.fill();
    octx.lineWidth = 1.5;
    octx.strokeStyle = '#0a1a2a';
    octx.stroke();
    if (showLabels) {
      const locale = af[S.airfieldLabelField] || af.en || af.name;
      const label = af.name + (locale && locale !== af.name ? ' / ' + locale : '');
      octx.lineWidth = 2.5;
      octx.strokeStyle = 'rgba(255,255,255,0.85)';
      octx.strokeText(label, s.x + r + 3, s.y);
      octx.fillStyle = '#0a1a2a';
      octx.fillText(label, s.x + r + 3, s.y);
    }
  }
  octx.lineWidth = 1;
}

function drawNavWaypoints() {
  if (!showNavWP || !navWP || navWP.length === 0) return;
  // Suppress nav-WP dot when a route waypoint sits on it (by position),
  // regardless of whether the WP name was changed after snapping.
  const SNAP_DEG = 0.0002;               // ~22 m — matches nearestNavWaypoint px threshold
  const showLabels = map.getZoom() >= 10;
  octx.font = 'bold 10px sans-serif';
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  for (const wp of navWP) {
    const occupied = state.waypoints.some(
      r => Math.abs(r.lat - wp.lat) < SNAP_DEG && Math.abs(r.lng - wp.lng) < SNAP_DEG);
    if (occupied) continue;
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
      const label = wp[S.navWpSearchField] || wp.name;
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
  const zoomScale = Math.max(0.35, Math.pow(2, map.getZoom() - 12)) * legArrowSize;
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
    const inP = leg.inLabel || { a: 0, p: 44 };
    const outP = leg.outLabel || { a: 0, p: -44 };
    drawLegArrow(mid.x + dx * inP.a + nx * inP.p, mid.y + dy * inP.a + ny * inP.p,
      ang, pad3(magIn), timeStr, String(leg.inboundAltitude),
      '#2f6fd0', yellowFill(0.80), needsHalo(i, 'in'), zoomScale);
    if (showReturn) {
      drawLegArrow(mid.x + dx * outP.a + nx * outP.p,
        mid.y + dy * outP.a + ny * outP.p, ang + Math.PI,
        pad3(magOut), timeStrOut, String(leg.outboundAltitude),
        '#c0392b', 'rgba(255,204,214,0.80)', needsHalo(i, 'out'), zoomScale);
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
      octx.fillStyle = '#161412';
      octx.font = 'bold 10px sans-serif';
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
    return cur.inboundAltitude !== prev.inboundAltitude ||
           cur.flightSpeed     !== prev.flightSpeed;
  }
  if (i === state.legs.length - 1) return false;
  const next = state.legs[i + 1];
  return cur.outboundAltitude !== next.outboundAltitude ||
         cur.outboundSpeed    !== next.outboundSpeed;
}

// Navigation leg marker: a two-cell rectangle (altitude, time) joined to a
// triangle (heading) pointing in the flight direction. Text runs across the
// marker and is locked to its orientation.
function drawLegArrow(cx, cy, flightAng, head, time, alt, accent, fill, halo, sc) {
  sc = sc ?? 1;
  const W = 46 * sc, cell = 22 * sc, Lt = 26 * sc;
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
    octx.lineWidth = 7 * sc;
    octx.strokeStyle = '#8e44ad';
    octx.stroke();
    octx.lineJoin = 'miter';
  }
  octx.fillStyle = fill;
  octx.fill();
  octx.lineWidth = 2 * sc;
  octx.strokeStyle = accent;
  octx.stroke();
  octx.lineWidth = sc;
  for (const dx of [-L / 2 + cell, xb]) {
    octx.beginPath();
    octx.moveTo(dx, -W / 2);
    octx.lineTo(dx, W / 2);
    octx.stroke();
  }
  octx.restore();

  const fontPx = Math.max(4, Math.round(13 * sc));
  const fontPxH = Math.max(4, Math.round(14 * sc));
  const ta = flightAng + Math.PI / 2;
  const cos = Math.cos(flightAng), sin = Math.sin(flightAng);
  const at = lx => ({ x: cx + lx * cos, y: cy + lx * sin });
  const pAlt = at(-L / 2 + cell * 0.5);
  const pTime = at(-L / 2 + cell * 1.5);
  const pHead = at(xb + Lt * 0.32);
  drawRotText(pAlt.x, pAlt.y, ta, alt, `bold ${fontPx}px sans-serif`, '#000');
  drawRotText(pTime.x, pTime.y, ta, time, `bold ${fontPx}px sans-serif`, '#000');
  drawRotText(pHead.x, pHead.y, ta, head, `bold ${fontPxH}px sans-serif`, '#000');
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
// needed to fit it. Scaled by wpSize slider × zoom (geographic footprint
// stays roughly constant; floor at 0.35× so markers stay visible when zoomed out).
function waypointGeom(i) {
  const wp = state.waypoints[i];
  const label = showWpNames ? (navName((wp.name || '').trim()) || String(i + 1)) : '';
  const zoomScale = Math.max(0.35, Math.pow(2, map.getZoom() - 12));
  const scale = wpSize * zoomScale;
  const fontPx = Math.max(4, Math.round(13 * scale));
  octx.font = `bold ${fontPx}px sans-serif`;
  const w = octx.measureText(label).width;
  const minR = WP_RADIUS * scale;
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
    `${S.summaryWaypoints}: ${state.waypoints.length}\n` +
    `${S.summaryLegs}: ${state.legs.length}\n` +
    `${S.summaryDist}: ${totalDist.toFixed(1)} NM\n` +
    `${S.summaryTime}: ${totalH > 0 ? toHMS(totalH) : '--'}`;
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

