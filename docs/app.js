'use strict';

/* ------------------------------------------------------------------ *
 * NavAid — HTML5 CVFR flight-route planner.
 * Leaflet base map (flight-maps.com tiles) + a canvas route overlay.
 * ------------------------------------------------------------------ */

// One-time migration: the app was renamed from "Plotter" — carry over any
// localStorage values saved under the old "plotter." prefix.
try {
  for (const k of Object.keys(localStorage)) {
    if (k.indexOf('plotter.') === 0) {
      const nk = 'navaid.' + k.slice(8);
      if (localStorage.getItem(nk) === null) {
        localStorage.setItem(nk, localStorage.getItem(k));
      }
      localStorage.removeItem(k);
    }
  }
} catch (e) { /* storage unavailable */ }

const EARTH_NM = 3440.065;             // mean Earth radius, nautical miles
let magVar = -5;                       // signed offset added to true heading
                                       // (Israel ≈ −5; equivalent to 5°E variation)

// --- model -----------------------------------------------------------
const state = {
  waypoints: [],            // [{ lat, lng, name }]
  legs: [],                 // per-leg attributes (see newLeg)
  notes: [],                // [{ lat, lng, text }] — free-text annotations
  mode: null,               // 'add' | 'note' | null (= inspect)
  selected: null,           // { type:'wp'|'leg'|'note', index }
};
let showReturn = false;     // outbound (return) markers — off by default
let showMidLeg = false;
let highlightDiff = false;  // purple halo on legs that change altitude
let showNavWP = true;       // Israeli VFR reporting-point overlay (default on)
let navWP = null;           // null = not loaded; [] = loaded empty/error
let showWpNames = true;     // draw waypoint names (off = sequence number)
let yellowAlpha = 1;        // global multiplier for yellow label backgrounds
let wpSize = 1;             // waypoint name / number text size scale
let pageSize = null;        // null | 'A3' | 'A4'
let pageOrient = 'landscape';   // 'landscape' | 'portrait'

// Yellow text-background colour with the global opacity scale applied.
const yellowFill = (a) => `rgba(255,246,170,${a * yellowAlpha})`;

// Tinted fill from any "#rrggbb" hex with `a` (× yellowAlpha) for the alpha.
function tintFill(hex, a) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return yellowFill(a);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a * yellowAlpha})`;
}

const NOTE_DEFAULT_COLOR = '#fff6aa';   // matches the existing yellow fill

const newLeg = () => ({
  inboundAltitude: 2000,
  outboundAltitude: 2000,
  flightSpeed: 90,
  inLabel: { a: 0, p: 44 },            // marker offset: along leg, perpendicular
  outLabel: { a: 0, p: -44 },
});

// --- helpers ---------------------------------------------------------
function geo(a, b) {                   // a,b = {lat,lng} -> {dist NM, brg deg}
  const rad = d => (d * Math.PI) / 180;
  const phi1 = rad(a.lat), phi2 = rad(b.lat);
  const dphi = rad(b.lat - a.lat), dlam = rad(b.lng - a.lng);
  const h = Math.sin(dphi / 2) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  const dist = 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(dlam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlam);
  return { dist, brg: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}
function toMagnetic(deg) {
  // Magnetic = True + magVar (so −5 means "subtract 5", i.e. 5°E variation).
  return ((Math.round(deg + magVar) % 360) + 360) % 360;
}
const pad3 = n => String(n).padStart(3, '0');
function toHMS(hours) {
  const tm = hours * 60;
  let m = Math.floor(tm);
  let s = Math.round(((tm - m) * 60) / 5) * 5;
  if (s >= 60) { s -= 60; m++; }
  return m + ':' + String(s).padStart(2, '0');
}
function fmtLatLng(v, pos, neg) {
  const hemi = v >= 0 ? pos : neg;
  v = Math.abs(v);
  const d = Math.floor(v);
  const m = (v - d) * 60;
  return `${d}°${m.toFixed(1).padStart(4, '0')}'${hemi}`;
}

// --- Leaflet map -----------------------------------------------------
// Layer set mirrors ifl.flight-maps.com (excluding Israel Hiking).
const TILE = { minZoom: 6, maxZoom: 16, maxNativeZoom: 13 };
const FM_ATTR =
  'Charts © <a href="https://flight-maps.com">flight-maps.com</a> · CAAI';
const layers = {
  'CVFR': L.tileLayer('https://flight-maps.com/tiles/cvfr/{z}/{x}/{y}.png',
    { ...TILE, attribution: FM_ATTR }),
  'Nav': L.tileLayer('https://flight-maps.com/tiles/nav/{z}/{x}/{y}.png',
    { ...TILE, attribution: FM_ATTR }),
  'Low Alt': L.tileLayer('https://flight-maps.com/tiles/la/{z}/{x}/{y}.png',
    { ...TILE, attribution: FM_ATTR }),
  'Heli': L.tileLayer('https://flight-maps.com/tiles/il-hel/{z}/{x}/{y}.png',
    { ...TILE, maxNativeZoom: 12, attribution: FM_ATTR }),
  'Satellite': L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/' +
    'World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { minZoom: 6, maxZoom: 18, attribution: 'Imagery © Esri' }),
  'OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { minZoom: 6, maxZoom: 18, subdomains: 'abc',
      attribution: '© OpenStreetMap contributors' }),
};

const LAYER_KEY = 'navaid.layer';
let initialLayer = layers.CVFR;
try {
  const saved = localStorage.getItem(LAYER_KEY);
  if (saved && layers[saved]) initialLayer = layers[saved];
} catch (e) { /* storage unavailable */ }

const map = L.map('map', {
  center: [32.0, 34.9],
  zoom: 9,
  minZoom: 8,                  // do not zoom out past the chart extent
  maxZoom: 15,
  layers: [initialLayer],
  zoomControl: false,
  zoomAnimation: false,        // keep the canvas overlay in sync
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 120,    // gentler scroll-wheel zoom (default 60)
  wheelDebounceTime: 60,
  maxBounds: [[29.0, 33.9], [33.6, 36.4]],   // keep panning over Israel
  maxBoundsViscosity: 1.0,
  worldCopyJump: false,
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.layers(layers, null, { position: 'bottomright' }).addTo(map);
map.on('baselayerchange', e => {
  try { localStorage.setItem(LAYER_KEY, e.name); }
  catch (err) { /* storage unavailable */ }
});

// --- route overlay canvas -------------------------------------------
const overlay = document.getElementById('overlay');
let octx = overlay.getContext('2d');   // reassigned during PNG export
let dpr = 1;

function vw() { return map.getSize().x; }
function vh() { return map.getSize().y; }

function resizeOverlay() {
  dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(vw() * dpr);
  overlay.height = Math.round(vh() * dpr);
  overlay.style.width = vw() + 'px';
  overlay.style.height = vh() + 'px';
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// scene point: project a waypoint to overlay (container) pixels
function proj(wp) {
  const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
  return { x: p.x, y: p.y };
}

// --- leg bookkeeping -------------------------------------------------
function syncLegs() {
  const need = Math.max(0, state.waypoints.length - 1);
  while (state.legs.length < need) state.legs.push(newLeg());
  while (state.legs.length > need) state.legs.pop();
}

// --- drawing ---------------------------------------------------------
function draw() {
  octx.clearRect(0, 0, vw(), vh());
  drawNavWaypoints();
  drawLegs();
  drawWaypoints();
  drawNotes();
  drawInfo();
  if (!printing) drawPageFrame();
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
    const res = await fetch('nav-waypoints.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    navWP = (d.waypoints || []).map(w => ({
      name: w.name,
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

// True if `name` exactly matches a known nav waypoint name (so we treat
// it as auto-snapped, not user-typed, and may overwrite on drag).
function isNavName(name) {
  if (!name || !navWP) return false;
  for (const wp of navWP) if (wp.name === name) return true;
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
  if (snap) return { lat: snap.lat, lng: snap.lng, name: snap.name };
  return { lat: latlng.lat, lng: latlng.lng,
           name: isNavName(currentName) ? '' : (currentName || '') };
}

function drawNavWaypoints() {
  if (!showNavWP || !navWP || navWP.length === 0) return;
  const showLabels = map.getZoom() >= 10;
  const W = vw(), H = vh(), pad = 30;
  octx.font = 'bold 10px sans-serif';
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  for (const wp of navWP) {
    const s = proj(wp);
    if (s.x < -pad || s.x > W + pad || s.y < -pad || s.y > H + pad) continue;
    octx.fillStyle = '#ffffff';
    octx.strokeStyle = '#161412';
    octx.lineWidth = 1.5;
    octx.beginPath();
    octx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
    if (showLabels) {
      octx.lineWidth = 2.5;
      octx.strokeStyle = 'rgba(255,255,255,0.85)';
      octx.strokeText(wp.name, s.x + 6, s.y);
      octx.fillStyle = '#161412';
      octx.fillText(wp.name, s.x + 6, s.y);
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
  const label = (showWpNames && (wp.name || '').trim()) || String(i + 1);
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
    if (wp.flipped) octx.rotate(Math.PI);
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
  const w = maxW + NOTE_PAD_X * 2;
  const h = Math.max(1, lines.length) * NOTE_LINE_H + NOTE_PAD_Y * 2;
  return { x: s.x - w / 2, y: s.y - h / 2, w, h, lines };
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
    octx.fillRect(r.x, r.y, r.w, r.h);
    octx.lineWidth = selected ? 2.5 : 1.5;
    octx.strokeStyle = selected ? '#ffcc33' : '#161412';
    octx.strokeRect(r.x, r.y, r.w, r.h);

    octx.font = NOTE_FONT;
    octx.fillStyle = '#161412';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    const cx = r.x + r.w / 2;
    for (let j = 0; j < r.lines.length; j++) {
      const ly = r.y + NOTE_PAD_Y + NOTE_LINE_H / 2 + j * NOTE_LINE_H;
      octx.fillText(r.lines[j], cx, ly);
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
  return { x: (vw() - w) / 2, y: (vh() - h) / 2, w, h };
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

// --- hit testing -----------------------------------------------------
function hitNote(px, py) {
  for (let i = state.notes.length - 1; i >= 0; i--) {
    const r = noteRect(i);
    if (px >= r.x && px <= r.x + r.w &&
        py >= r.y && py <= r.y + r.h) return i;
  }
  return -1;
}
function hitWaypoint(px, py) {
  for (let i = state.waypoints.length - 1; i >= 0; i--) {
    const s = proj(state.waypoints[i]);
    if (Math.hypot(s.x - px, s.y - py) <= waypointGeom(i).r + 6) return i;
  }
  return -1;
}
function hitLeg(px, py) {
  for (let i = 0; i < state.legs.length; i++) {
    const a = proj(state.waypoints[i]);
    const b = proj(state.waypoints[i + 1]);
    if (distToSegment(px, py, a, b) <= 8) return i;
  }
  return -1;
}
function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
function legFrame(i) {
  const a = proj(state.waypoints[i]);
  const b = proj(state.waypoints[i + 1]);
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
           dx, dy, nx: -dy, ny: dx };
}
function legLabelCenter(i, which) {
  if (!state.waypoints[i] || !state.waypoints[i + 1]) return null;
  const f = legFrame(i);
  const o = (which === 'in' ? state.legs[i].inLabel : state.legs[i].outLabel)
            || { a: 0, p: 0 };
  return { x: f.mx + f.dx * o.a + f.nx * o.p,
           y: f.my + f.dy * o.a + f.ny * o.p };
}
function hitLegLabel(px, py) {
  for (let i = 0; i < state.legs.length; i++) {
    for (const which of ['in', 'out']) {
      if (which === 'out' && !showReturn) continue;
      const c = legLabelCenter(i, which);
      if (c && Math.hypot(c.x - px, c.y - py) <= 34) return { i, which };
    }
  }
  return null;
}

// --- inspector -------------------------------------------------------
// When an altitude is edited on leg `i`, propagate the new value to legs
// that currently share the OLD value, walking outward in the natural
// flight direction for that altitude (inbound forward, outbound backward).
// Stops at the first leg that already differs, so intentional level
// changes downstream are preserved.
function propagateAlt(i, key, newVal, oldVal) {
  if (newVal === oldVal) return;
  const dir = key === 'inboundAltitude' ? 1 : -1;
  for (let j = i + dir; j >= 0 && j < state.legs.length; j += dir) {
    if (state.legs[j][key] !== oldVal) break;
    state.legs[j][key] = newVal;
  }
}

function showInspector() {
  const insp = document.getElementById('inspector');
  const title = document.getElementById('insp-title');
  const body = document.getElementById('insp-body');
  body.innerHTML = '';
  if (!state.selected) { insp.classList.add('hidden'); return; }
  insp.classList.remove('hidden');

  if (state.selected.type === 'leg') {
    const idx = state.selected.index;
    const leg = state.legs[idx];
    title.value = 'Leg ' + (idx + 1);
    title.placeholder = '';
    title.readOnly = true;
    title.oninput = null;
    body.appendChild(numberRow('Speed (kt)', leg.flightSpeed, v => {
      leg.flightSpeed = v > 0 ? v : leg.flightSpeed; draw();
    }));
    body.appendChild(numberRow('Inbound alt (ft)', leg.inboundAltitude, v => {
      const oldVal = leg.inboundAltitude;
      leg.inboundAltitude = Math.round(v);
      propagateAlt(idx, 'inboundAltitude', leg.inboundAltitude, oldVal);
      draw();
    }));
    body.appendChild(numberRow('Outbound alt (ft)', leg.outboundAltitude, v => {
      const oldVal = leg.outboundAltitude;
      leg.outboundAltitude = Math.round(v);
      propagateAlt(idx, 'outboundAltitude', leg.outboundAltitude, oldVal);
      draw();
    }));
  } else if (state.selected.type === 'note') {
    const note = state.notes[state.selected.index];
    title.value = '';
    title.placeholder = '';
    title.readOnly = true;
    title.oninput = null;
    body.appendChild(textareaRow('', note.text || '', v => {
      note.text = v; draw();
    }));
    body.appendChild(colorRow('Color', note.color || NOTE_DEFAULT_COLOR, v => {
      note.color = v; draw();
    }));
    const del = document.createElement('button');
    del.className = 'insp-btn';
    del.textContent = 'Delete note';
    del.onclick = () => {
      state.notes.splice(state.selected.index, 1);
      state.selected = null;
      draw(); showInspector();
    };
    body.appendChild(del);
  } else {
    const wp = state.waypoints[state.selected.index];
    title.value = wp.name || '';
    title.placeholder = 'WP ' + (state.selected.index + 1);
    title.readOnly = false;
    title.oninput = () => { wp.name = title.value; draw(); };
    body.appendChild(textRow('Latitude', fmtLatLng(wp.lat, 'N', 'S')));
    body.appendChild(textRow('Longitude', fmtLatLng(wp.lng, 'E', 'W')));
    const del = document.createElement('button');
    del.className = 'insp-btn';
    del.textContent = 'Delete waypoint';
    del.onclick = () => {
      state.waypoints.splice(state.selected.index, 1);
      state.selected = null;
      syncLegs(); draw(); showInspector();
    };
    body.appendChild(del);
  }
}
function colorRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = value || NOTE_DEFAULT_COLOR;
  inp.oninput = () => onChange(inp.value);
  row.append(l, inp);
  return row;
}
function textareaRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row col';
  if (label) {
    const l = document.createElement('label');
    l.textContent = label;
    row.appendChild(l);
  }
  const ta = document.createElement('textarea');
  ta.value = value || '';
  ta.rows = 3;
  ta.oninput = () => onChange(ta.value);
  row.appendChild(ta);
  return row;
}
function numberRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = value;
  inp.onchange = () => {
    const v = parseFloat(inp.value);
    if (!isNaN(v)) onChange(v);
  };
  row.append(l, inp);
  return row;
}
function textInputRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value || '';
  inp.maxLength = 10;
  inp.oninput = () => onChange(inp.value);
  row.append(l, inp);
  return row;
}
function boolRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.checked = value;
  inp.onchange = () => onChange(inp.checked);
  row.append(l, inp);
  return row;
}
function textRow(label, value) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'val';
  v.textContent = value;
  row.append(l, v);
  return row;
}

// --- interaction (Leaflet mouse events) ------------------------------
let drag = null;
let downHit = false;

map.on('mousedown', e => {
  const p = e.containerPoint;
  const wp = hitWaypoint(p.x, p.y);
  if (wp >= 0) {
    downHit = true;
    state.selected = { type: 'wp', index: wp };
    drag = { kind: 'wp', i: wp, moved: false };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  const note = hitNote(p.x, p.y);
  if (note >= 0) {
    downHit = true;
    state.selected = { type: 'note', index: note };
    drag = { kind: 'note', i: note };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  const lab = hitLegLabel(p.x, p.y);
  if (lab) {
    downHit = true;
    const f = legFrame(lab.i);
    drag = { kind: 'label', i: lab.i, which: lab.which, lx: p.x, ly: p.y,
             dx: f.dx, dy: f.dy, nx: f.nx, ny: f.ny };
    state.selected = { type: 'leg', index: lab.i };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  const leg = hitLeg(p.x, p.y);
  if (leg >= 0) {
    downHit = true;
    state.selected = { type: 'leg', index: leg };
    drag = { kind: 'legclick' };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  downHit = false;                     // empty space -> Leaflet pans
});

map.on('mousemove', e => {
  if (!drag) return;
  const p = e.containerPoint;
  if (drag.kind === 'wp') {
    drag.moved = true;
    const wp = state.waypoints[drag.i];
    const r = applyNavSnap(e.latlng, wp.name || '');
    wp.lat = r.lat; wp.lng = r.lng; wp.name = r.name;
    draw(); showInspector();
  } else if (drag.kind === 'note') {
    state.notes[drag.i].lat = e.latlng.lat;
    state.notes[drag.i].lng = e.latlng.lng;
    draw();
  } else if (drag.kind === 'label') {
    const ddx = p.x - drag.lx, ddy = p.y - drag.ly;
    drag.lx = p.x; drag.ly = p.y;
    const leg = state.legs[drag.i];
    const o = drag.which === 'in' ? leg.inLabel : leg.outLabel;
    o.a += ddx * drag.dx + ddy * drag.dy;
    o.p += ddx * drag.nx + ddy * drag.ny;
    draw();
  }
});

map.on('mouseup', () => {
  if (drag) { map.dragging.enable(); drag = null; }
});

map.on('click', e => {
  if (downHit) { downHit = false; return; }
  if (state.mode === 'add') {
    const r = applyNavSnap(e.latlng, '');
    state.waypoints.push({ lat: r.lat, lng: r.lng, name: r.name });
    syncLegs();
    state.selected = { type: 'wp', index: state.waypoints.length - 1 };
    showInspector(); draw();
  } else if (state.mode === 'note') {
    state.notes.push({ lat: e.latlng.lat, lng: e.latlng.lng, text: 'Note' });
    state.selected = { type: 'note', index: state.notes.length - 1 };
    showInspector(); draw();
  }
});

window.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;                              // typing in a field — leave the WP alone
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!state.selected) return;
    if (state.selected.type === 'wp') {
      state.waypoints.splice(state.selected.index, 1);
      state.selected = null;
      syncLegs(); draw(); showInspector();
    } else if (state.selected.type === 'note') {
      state.notes.splice(state.selected.index, 1);
      state.selected = null;
      draw(); showInspector();
    }
  }
});

// --- touch interaction (drag waypoints / markers on mobile) ----------
// Synthesised mouse events don't fire during a touch-drag, so handle touch
// directly. One-finger touches that hit a route element are captured; other
// touches fall through to Leaflet for pan / pinch-zoom.
const mapEl = map.getContainer();
let touchDrag = null;

function touchXY(t) {
  const r = mapEl.getBoundingClientRect();
  return { x: t.clientX - r.left, y: t.clientY - r.top };
}

mapEl.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  const p = touchXY(e.touches[0]);
  const wp = hitWaypoint(p.x, p.y);
  const note = wp < 0 ? hitNote(p.x, p.y) : -1;
  const lab = (wp < 0 && note < 0) ? hitLegLabel(p.x, p.y) : null;
  const leg = (wp < 0 && note < 0 && !lab) ? hitLeg(p.x, p.y) : -1;

  if (wp >= 0) {
    touchDrag = { kind: 'wp', i: wp };
    state.selected = { type: 'wp', index: wp };
  } else if (note >= 0) {
    touchDrag = { kind: 'note', i: note };
    state.selected = { type: 'note', index: note };
  } else if (lab) {
    const f = legFrame(lab.i);
    touchDrag = { kind: 'label', i: lab.i, which: lab.which,
                  lx: p.x, ly: p.y, dx: f.dx, dy: f.dy, nx: f.nx, ny: f.ny };
    state.selected = { type: 'leg', index: lab.i };
  } else if (leg >= 0) {
    touchDrag = { kind: 'legtap' };
    state.selected = { type: 'leg', index: leg };
  }

  if (touchDrag) {
    map.dragging.disable();
    e.preventDefault();                // suppress pan + the synthetic click
    showInspector(); draw();
  }
}, { passive: false });

mapEl.addEventListener('touchmove', e => {
  if (!touchDrag || touchDrag.kind === 'legtap' || e.touches.length !== 1) return;
  e.preventDefault();
  const p = touchXY(e.touches[0]);
  const ll = map.containerPointToLatLng([p.x, p.y]);
  if (touchDrag.kind === 'wp') {
    const wp = state.waypoints[touchDrag.i];
    const r = applyNavSnap(ll, wp.name || '');
    wp.lat = r.lat; wp.lng = r.lng; wp.name = r.name;
    draw(); showInspector();
  } else if (touchDrag.kind === 'note') {
    state.notes[touchDrag.i].lat = ll.lat;
    state.notes[touchDrag.i].lng = ll.lng;
    draw();
  } else if (touchDrag.kind === 'label') {
    const ddx = p.x - touchDrag.lx, ddy = p.y - touchDrag.ly;
    touchDrag.lx = p.x; touchDrag.ly = p.y;
    const leg = state.legs[touchDrag.i];
    const o = touchDrag.which === 'in' ? leg.inLabel : leg.outLabel;
    o.a += ddx * touchDrag.dx + ddy * touchDrag.dy;
    o.p += ddx * touchDrag.nx + ddy * touchDrag.ny;
    draw();
  }
}, { passive: false });

function endTouch() {
  if (touchDrag) { map.dragging.enable(); touchDrag = null; }
}
mapEl.addEventListener('touchend', endTouch);
mapEl.addEventListener('touchcancel', endTouch);

map.on('move zoom viewreset moveend zoomend', draw);
map.on('resize', () => { resizeOverlay(); draw(); });

// --- view fitting ----------------------------------------------------
function fitView() {
  if (state.waypoints.length === 0) {
    map.setView([32.0, 34.9], 9);
    return;
  }
  const b = L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng]));
  map.fitBounds(b, { padding: [70, 70] });
}

// --- save / load -----------------------------------------------------
function save() {
  const data = {
    waypoints: state.waypoints.map(w => ({
      lat: w.lat, lng: w.lng, name: w.name || '',
    })),
    legs: state.legs.map(l => ({
      inboundAltitude: l.inboundAltitude,
      outboundAltitude: l.outboundAltitude,
      flightSpeed: l.flightSpeed,
      inLabel: l.inLabel,
      outLabel: l.outLabel,
    })),
    notes: state.notes.map(n => ({
      lat: n.lat, lng: n.lng, text: n.text || '', color: n.color || '',
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'route.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function load(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      state.waypoints = (d.waypoints || []).map(w => ({
        lat: +w.lat, lng: +w.lng, name: w.name || '', flipped: false,
      }));
      state.legs = (d.legs || []).map(l => ({
        inboundAltitude: l.inboundAltitude ?? 2000,
        outboundAltitude: l.outboundAltitude ?? 2000,
        flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
        inLabel: l.inLabel || { a: 0, p: 44 },
        outLabel: l.outLabel || { a: 0, p: -44 },
      }));
      state.notes = (d.notes || []).map(n => ({
        lat: +n.lat, lng: +n.lng, text: n.text || '', color: n.color || '',
      }));
      syncLegs();
      state.selected = null;
      showInspector();
      fitView();
      draw();
    } catch (err) {
      alert('Could not load file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// --- print -----------------------------------------------------------
let printing = false;

function applyPage() {
  document.getElementById('page-a3').classList.toggle('active', pageSize === 'A3');
  document.getElementById('page-a4').classList.toggle('active', pageSize === 'A4');
  let st = document.getElementById('page-style');
  if (!st) {
    st = document.createElement('style');
    st.id = 'page-style';
    document.head.appendChild(st);
  }
  // margin: 0 so the dashed frame on screen matches the printed area 1:1
  st.textContent = '@page { size: ' + (pageSize || 'A4') + ' ' +
                   pageOrient + '; margin: 0; }';
  draw();
}

function setPage(size) {
  if (pageSize === size) {             // same button toggles the frame off
    pageSize = null;
    applyPage();
    return;
  }
  chooseOrientation(size, orient => {
    pageOrient = orient;
    pageSize = size;
    applyPage();
  });
}

// --- flight plan table -----------------------------------------------
function wpLabel(i) {
  const wp = state.waypoints[i];
  if (!wp) return '';
  const n = (wp.name || '').trim();
  return n || ('WP ' + (i + 1));
}

function showFlightPlan() {
  if (state.legs.length === 0) {
    alert('No legs yet — drop at least two waypoints first.');
    return;
  }
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal wide';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = 'Flight plan';
  box.appendChild(title);

  const table = document.createElement('table');
  table.className = 'flight-table';
  const headers = ['#', 'From', 'To', 'Hdg', 'Dist (NM)',
                   'Speed (kt)', 'Alt (ft)', 'Time'];
  const thead = document.createElement('thead');
  const trH = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    trH.appendChild(th);
  }
  thead.appendChild(trH);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let totalDist = 0, totalH = 0;
  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    const leg = state.legs[i];
    const { dist, brg } = geo(A, B);
    const durH = leg.flightSpeed > 0 ? dist / leg.flightSpeed : 0;
    totalDist += dist;
    totalH += durH;
    tbody.appendChild(planRow([
      String(i + 1),
      wpLabel(i),
      wpLabel(i + 1),
      pad3(toMagnetic(brg)) + '°M',
      dist.toFixed(1),
      String(leg.flightSpeed),
      String(leg.inboundAltitude),
      durH > 0 ? toHMS(durH) : '--',
    ]));
  }
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  const trF = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.colSpan = 4;
  tdLabel.textContent = 'Total';
  trF.appendChild(tdLabel);
  for (const v of [totalDist.toFixed(1), '', '',
                   totalH > 0 ? toHMS(totalH) : '--']) {
    const td = document.createElement('td');
    td.textContent = v;
    trF.appendChild(td);
  }
  tfoot.appendChild(trF);
  table.appendChild(tfoot);
  box.appendChild(table);

  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.className = 'modal-cancel';
  close.onclick = () => back.remove();
  btns.appendChild(close);
  box.appendChild(btns);

  back.appendChild(box);
  back.onclick = e => { if (e.target === back) back.remove(); };
  document.body.appendChild(back);
}

function planRow(cells) {
  const tr = document.createElement('tr');
  for (const c of cells) {
    const td = document.createElement('td');
    td.textContent = c;
    tr.appendChild(td);
  }
  return tr;
}

// Modal: pick Landscape or Portrait (named buttons, not OK/Cancel).
function chooseOrientation(size, onPick) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = size + ' page — orientation';
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  for (const [label, val] of [['Landscape', 'landscape'], ['Portrait', 'portrait']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { back.remove(); onPick(val); };
    btns.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.className = 'modal-cancel';
  cancel.onclick = () => back.remove();
  btns.appendChild(cancel);
  box.append(title, btns);
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) back.remove(); };
  document.body.appendChild(back);
}

// Save the framed map + route as a PNG, rendered at the highest practical
// native tile zoom (not the on-screen zoom) for maximum quality. flight-maps
// tiles are not CORS-enabled, so each tile is fetched through the weserv image
// proxy (which adds Access-Control-Allow-Origin) to keep the canvas untainted.
function exportPNG() {
  const fr = pageFrameRect() || { x: 0, y: 0, w: vw(), h: vh() };
  if (fr.w < 4 || fr.h < 4) return;

  let base = null, baseName = 'map';
  for (const n in layers) {
    if (map.hasLayer(layers[n])) { base = layers[n]; baseName = n; }
  }
  if (!base || !base._url) return;

  const nw = map.containerPointToLatLng([fr.x, fr.y]);
  const se = map.containerPointToLatLng([fr.x + fr.w, fr.y + fr.h]);

  // highest native zoom that keeps tile count and canvas size sane
  const maxZ = base.options.maxNativeZoom || base.options.maxZoom || 13;
  let z = maxZ, nwP, seP, W, H;
  for (; z >= 9; z--) {
    nwP = map.project([nw.lat, nw.lng], z);
    seP = map.project([se.lat, se.lng], z);
    W = Math.round(seP.x - nwP.x);
    H = Math.round(seP.y - nwP.y);
    const tiles = (Math.floor(seP.x / 256) - Math.floor(nwP.x / 256) + 1) *
                  (Math.floor(seP.y / 256) - Math.floor(nwP.y / 256) + 1);
    if (tiles <= 150 && W <= 8000 && H <= 8000) break;
  }

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const o = out.getContext('2d');
  o.fillStyle = '#231F20';
  o.fillRect(0, 0, W, H);

  const btn = document.getElementById('print');
  const btnLabel = btn.textContent;
  btn.textContent = '⏳ Saving…';
  btn.disabled = true;

  // gather the covering tiles, proxied for CORS
  const subs = base.options.subdomains || 'abc';
  const jobs = [];
  for (let tx = Math.floor(nwP.x / 256); tx <= Math.floor(seP.x / 256); tx++) {
    for (let ty = Math.floor(nwP.y / 256); ty <= Math.floor(seP.y / 256); ty++) {
      const url = L.Util.template(base._url,
        { z, x: tx, y: ty, s: subs[(tx + ty) % subs.length] });
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const job = {
        img, dx: Math.round(tx * 256 - nwP.x), dy: Math.round(ty * 256 - nwP.y),
        done: new Promise(res => { img.onload = res; img.onerror = res; }),
      };
      img.src = 'https://images.weserv.nl/?url=' +
                encodeURIComponent(url.replace(/^https?:\/\//, ''));
      jobs.push(job);
    }
  }

  Promise.all(jobs.map(j => j.done)).then(() => {
    for (const j of jobs) {
      if (j.img.naturalWidth) {
        try { o.drawImage(j.img, j.dx, j.dy, 256, 256); } catch (e) { /* skip */ }
      }
    }
    // re-render the route into the export canvas. Web Mercator is a uniform
    // scale between zooms, so the on-screen projection scaled by s lines up
    // with the native-zoom tiles exactly.
    const s = W / fr.w;
    const prevOctx = octx;
    octx = o;
    o.save();
    o.scale(s, s);
    o.translate(-fr.x, -fr.y);
    drawNavWaypoints();
    drawLegs();
    drawWaypoints();
    drawNotes();
    o.restore();
    octx = prevOctx;

    out.toBlob(b => {
      btn.textContent = btnLabel;
      btn.disabled = false;
      if (!b) { alert('PNG export failed (a map tile could not be loaded).'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'navigation-' + (pageSize || baseName) + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  });
}

// --- route persistence ----------------------------------------------
const STORE_KEY = 'navaid.route';
let persistTimer = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const c = map.getCenter();
      localStorage.setItem(STORE_KEY, JSON.stringify({
        waypoints: state.waypoints,
        legs: state.legs,
        notes: state.notes,
        center: [c.lat, c.lng],
        zoom: map.getZoom(),
      }));
    } catch (e) { /* storage unavailable */ }
  }, 500);
}
function restoreRoute() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state.waypoints = (d.waypoints || []).map(w => ({
      lat: +w.lat, lng: +w.lng, name: w.name || '', flipped: !!w.flipped,
    }));
    state.legs = (d.legs || []).map(l => ({
      inboundAltitude: l.inboundAltitude ?? 2000,
      outboundAltitude: l.outboundAltitude ?? 2000,
      flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
      inLabel: l.inLabel || { a: 0, p: 44 },
      outLabel: l.outLabel || { a: 0, p: -44 },
    }));
    state.notes = (d.notes || []).map(n => ({
      lat: +n.lat, lng: +n.lng, text: n.text || '', color: n.color || '',
    }));
    syncLegs();
    return true;
  } catch (e) {
    return false;
  }
}

// --- toolbar ---------------------------------------------------------
function setMode(mode) {
  // Clicking the currently-active mode button toggles back to inspect (null).
  if (state.mode === mode) mode = null;
  state.mode = mode;
  document.getElementById('tool-add').classList.toggle('active', mode === 'add');
  document.getElementById('tool-note').classList.toggle('active', mode === 'note');
  document.getElementById('map').classList.toggle('add', mode === 'add' || mode === 'note');
}
document.getElementById('tool-add').onclick = () => setMode('add');
document.getElementById('tool-note').onclick = () => setMode('note');
document.getElementById('reverse').onclick = () => {
  // Reversing flight direction means each leg's inbound/outbound roles swap.
  // The leg's local axes (along + perpendicular) also flip, so negating the
  // label offsets keeps the markers visually pinned to the same map pixels.
  // Waypoint name text is rotated 180° so the chart, when turned around to
  // fly the return route, still reads upright.
  state.waypoints = state.waypoints.reverse().map(w => ({
    ...w, flipped: !w.flipped,
  }));
  state.legs = state.legs.reverse().map(l => ({
    inboundAltitude: l.outboundAltitude,
    outboundAltitude: l.inboundAltitude,
    flightSpeed: l.flightSpeed,
    inLabel: { a: -l.outLabel.a, p: -l.outLabel.p },
    outLabel: { a: -l.inLabel.a, p: -l.inLabel.p },
  }));
  state.selected = null;
  showInspector(); draw();
};
document.getElementById('clear').onclick = () => {
  if ((state.waypoints.length || state.notes.length) &&
      !confirm('Remove all waypoints and notes?')) return;
  state.waypoints = [];
  state.legs = [];
  state.notes = [];
  state.selected = null;
  showInspector(); draw();
};
document.getElementById('save').onclick = save;
document.getElementById('load').onclick = () => document.getElementById('file').click();
document.getElementById('file').onchange = e => {
  if (e.target.files[0]) load(e.target.files[0]);
  e.target.value = '';
};
document.getElementById('fit').onclick = fitView;
document.getElementById('plan').onclick = showFlightPlan;
document.getElementById('ret-cb').onchange = e => {
  showReturn = e.target.checked;
  draw();
};
document.getElementById('mid-cb').onchange = e => {
  showMidLeg = e.target.checked;
  draw();
};
document.getElementById('wpname-cb').onchange = e => {
  showWpNames = e.target.checked;
  draw();
};
document.getElementById('diff-cb').onchange = e => {
  highlightDiff = e.target.checked;
  draw();
};
const NAVWP_KEY = 'navaid.showNavWP';
try {
  const stored = localStorage.getItem(NAVWP_KEY);
  // New users (null) get the default-on; '0' / '1' override.
  if (stored !== null) showNavWP = stored === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('navwp-cb').checked = showNavWP;
document.getElementById('navwp-cb').onchange = async e => {
  showNavWP = e.target.checked;
  try { localStorage.setItem(NAVWP_KEY, showNavWP ? '1' : '0'); }
  catch (err) { /* storage unavailable */ }
  if (showNavWP) await loadNavWaypoints();
  draw();
};
const ALPHA_KEY = 'navaid.yellowAlpha';
try {
  const v = parseFloat(localStorage.getItem(ALPHA_KEY));
  if (!isNaN(v)) yellowAlpha = Math.max(0, Math.min(1, v));
} catch (e) { /* storage unavailable */ }
document.getElementById('yellow-alpha').value = yellowAlpha;
document.getElementById('yellow-alpha').oninput = e => {
  yellowAlpha = parseFloat(e.target.value);
  try { localStorage.setItem(ALPHA_KEY, String(yellowAlpha)); }
  catch (err) { /* storage unavailable */ }
  draw();
};
const WPSIZE_KEY = 'navaid.wpSize';
try {
  const v = parseFloat(localStorage.getItem(WPSIZE_KEY));
  if (!isNaN(v)) wpSize = Math.max(0.6, Math.min(2, v));
} catch (e) { /* storage unavailable */ }
document.getElementById('wp-size').value = wpSize;
document.getElementById('wp-size').oninput = e => {
  wpSize = parseFloat(e.target.value);
  try { localStorage.setItem(WPSIZE_KEY, String(wpSize)); }
  catch (err) { /* storage unavailable */ }
  draw();
};
const MAGVAR_KEY = 'navaid.magVar';
try {
  const v = parseFloat(localStorage.getItem(MAGVAR_KEY));
  if (!isNaN(v)) magVar = Math.max(-30, Math.min(30, v));
} catch (e) { /* storage unavailable */ }
function showMagVarEqv() {
  const span = document.getElementById('mag-var-eqv');
  if (!span) return;
  if (magVar === 0) span.textContent = '';
  else if (magVar < 0) span.textContent = `(${-magVar}°E)`;
  else span.textContent = `(${magVar}°W)`;
}
document.getElementById('mag-var').value = magVar;
showMagVarEqv();
document.getElementById('mag-var').oninput = e => {
  const v = parseFloat(e.target.value);
  if (isNaN(v)) return;
  magVar = Math.max(-30, Math.min(30, v));
  try { localStorage.setItem(MAGVAR_KEY, String(magVar)); }
  catch (err) { /* storage unavailable */ }
  showMagVarEqv();
  draw();
};
document.getElementById('page-a3').onclick = () => setPage('A3');
document.getElementById('page-a4').onclick = () => setPage('A4');
document.getElementById('print').onclick = exportPNG;
document.getElementById('insp-close').onclick = () => {
  state.selected = null;
  showInspector(); draw();
};

// --- toolbar drag ----------------------------------------------------
(function makeToolbarDraggable() {
  const bar = document.getElementById('toolbar');
  const handle = document.getElementById('toolbar-handle');
  const KEY = 'navaid.toolbarPos';
  let dx = 0, dy = 0, dragging = false;

  function clampPos(x, y) {
    const w = bar.offsetWidth, h = bar.offsetHeight;
    return {
      x: Math.max(8, Math.min(window.innerWidth - w - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - h - 8, y)),
    };
  }
  function setPos(x, y) {
    const c = clampPos(x, y);
    bar.style.left = c.x + 'px';
    bar.style.top = c.y + 'px';
    bar.style.right = 'auto';
  }

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      requestAnimationFrame(() => setPos(p.x, p.y));
    }
  } catch (e) { /* storage unavailable */ }

  function start(cx, cy) {
    const r = bar.getBoundingClientRect();
    dx = cx - r.left;
    dy = cy - r.top;
    dragging = true;
    bar.classList.add('dragging');
  }
  function move(cx, cy) {
    if (!dragging) return;
    setPos(cx - dx, cy - dy);
  }
  function end() {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('dragging');
    const r = bar.getBoundingClientRect();
    try { localStorage.setItem(KEY, JSON.stringify({ x: r.left, y: r.top })); }
    catch (e) { /* storage unavailable */ }
  }

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    start(e.clientX, e.clientY);
    const onMove = ev => move(ev.clientX, ev.clientY);
    const onUp = () => {
      end();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  handle.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    start(t.clientX, t.clientY);
  }, { passive: false });
  window.addEventListener('touchmove', e => {
    if (!dragging || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    move(t.clientX, t.clientY);
  }, { passive: false });
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);

  window.addEventListener('resize', () => {
    if (bar.style.left) setPos(parseFloat(bar.style.left), parseFloat(bar.style.top));
  });
})();

// --- boot ------------------------------------------------------------
resizeOverlay();
setMode(null);
restoreRoute();
if (state.waypoints.length) fitView();   // always frame the restored route
draw();
// Always load nav-waypoints in the background — they power both the
// overlay toggle and the auto-snap on drop / drag.
loadNavWaypoints().then(draw);
