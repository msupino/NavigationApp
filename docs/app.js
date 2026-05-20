'use strict';

/* ------------------------------------------------------------------ *
 * Plotter — HTML5 CVFR flight plotter.
 * Leaflet base map (flight-maps.com tiles) + a canvas route overlay.
 * ------------------------------------------------------------------ */

const EARTH_NM = 3440.065;             // mean Earth radius, nautical miles
const MAG_DEV = -5;                    // fixed magnetic deviation

// --- model -----------------------------------------------------------
const state = {
  waypoints: [],            // [{ lat, lng }]
  legs: [],                 // per-leg attributes (see newLeg)
  mode: 'add',              // 'add' | 'edit'
  selected: null,           // { type:'wp'|'leg', index }
};
let showReturn = false;     // outbound (return) markers — off by default
let showMidLeg = true;
let pageSize = null;        // null | 'A3' | 'A4'
let pageOrient = 'landscape';   // 'landscape' | 'portrait'

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
  return (((Math.round(deg) + MAG_DEV) % 360) + 360) % 360;
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
const TILE = { minZoom: 6, maxZoom: 16, maxNativeZoom: 13 };
const layers = {
  CVFR: L.tileLayer('https://flight-maps.com/tiles/cvfr/{z}/{x}/{y}.png',
    { ...TILE, attribution: 'Charts © flight-maps.com' }),
  Nav: L.tileLayer('https://flight-maps.com/tiles/nav/{z}/{x}/{y}.png',
    { ...TILE, attribution: 'Charts © flight-maps.com' }),
  Satellite: L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/' +
    'World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { minZoom: 6, maxZoom: 18, attribution: 'Imagery © Esri' }),
};

const map = L.map('map', {
  center: [32.0, 34.9],
  zoom: 9,
  minZoom: 8,                  // do not zoom out past the chart extent
  maxZoom: 15,
  layers: [layers.CVFR],
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

// --- route overlay canvas -------------------------------------------
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
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
  drawLegs();
  drawWaypoints();
  drawInfo();
  if (!printing) drawPageFrame();
  persist();
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
      '#2f6fd0', 'rgba(255,246,170,0.80)');
    if (showReturn) {
      drawLegArrow(mid.x + dx * outP.a + nx * outP.p,
        mid.y + dy * outP.a + ny * outP.p, ang + Math.PI,
        pad3(magOut), timeStr, String(leg.outboundAltitude),
        '#c0392b', 'rgba(255,204,214,0.80)');
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

// Navigation leg marker: a two-cell rectangle (altitude, time) joined to a
// triangle (heading) pointing in the flight direction. Text runs across the
// marker and is locked to its orientation.
function drawLegArrow(cx, cy, flightAng, head, time, alt, accent, fill) {
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
  octx.fillStyle = 'rgba(255,246,170,0.90)';
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

function drawWaypoints() {
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    const s = proj(wp);
    const selected = state.selected &&
                     state.selected.type === 'wp' &&
                     state.selected.index === i;
    const r = selected ? WP_RADIUS + 2 : WP_RADIUS;

    // point circle with the sequence number
    octx.beginPath();
    octx.arc(s.x, s.y, r, 0, Math.PI * 2);
    octx.fillStyle = selected ? '#ffcc33' : 'rgba(255,246,170,0.60)';
    octx.fill();
    octx.lineWidth = 3;
    octx.strokeStyle = '#161412';
    octx.stroke();
    octx.font = 'bold 13px sans-serif';
    octx.fillStyle = '#161412';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(String(i + 1), s.x, s.y);

    // name label above the circle — black on translucent yellow
    const name = (wp.name || '').trim();
    if (name) {
      octx.font = 'bold 12px sans-serif';
      const bw = octx.measureText(name).width + 12;
      const bh = 19;
      const bx = s.x - bw / 2;
      const by = s.y - r - 5 - bh;
      octx.fillStyle = 'rgba(255,246,170,0.80)';
      octx.fillRect(bx, by, bw, bh);
      octx.lineWidth = 1.5;
      octx.strokeStyle = '#161412';
      octx.strokeRect(bx, by, bw, bh);
      octx.fillStyle = '#161412';
      octx.fillText(name, s.x, by + bh / 2 + 1);
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
function hitWaypoint(px, py) {
  for (let i = state.waypoints.length - 1; i >= 0; i--) {
    const s = proj(state.waypoints[i]);
    if (Math.hypot(s.x - px, s.y - py) <= WP_RADIUS + 6) return i;
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
function showInspector() {
  const insp = document.getElementById('inspector');
  const title = document.getElementById('insp-title');
  const body = document.getElementById('insp-body');
  body.innerHTML = '';
  if (!state.selected) { insp.classList.add('hidden'); return; }
  insp.classList.remove('hidden');

  if (state.selected.type === 'leg') {
    const leg = state.legs[state.selected.index];
    title.textContent = 'Leg ' + (state.selected.index + 1);
    body.appendChild(numberRow('Speed (kt)', leg.flightSpeed, v => {
      leg.flightSpeed = v > 0 ? v : leg.flightSpeed; draw();
    }));
    body.appendChild(numberRow('Inbound alt (ft)', leg.inboundAltitude, v => {
      leg.inboundAltitude = Math.round(v); draw();
    }));
    body.appendChild(numberRow('Outbound alt (ft)', leg.outboundAltitude, v => {
      leg.outboundAltitude = Math.round(v); draw();
    }));
  } else {
    const wp = state.waypoints[state.selected.index];
    title.textContent = (wp.name && wp.name.trim())
      ? wp.name.trim() : 'WP ' + (state.selected.index + 1);
    body.appendChild(textInputRow('Name', wp.name || '', v => {
      wp.name = v; draw();
    }));
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
    state.waypoints[drag.i].lat = e.latlng.lat;
    state.waypoints[drag.i].lng = e.latlng.lng;
    draw(); showInspector();
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
    state.waypoints.push({ lat: e.latlng.lat, lng: e.latlng.lng, name: '' });
    syncLegs();
    state.selected = { type: 'wp', index: state.waypoints.length - 1 };
    showInspector(); draw();
  }
});

window.addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') &&
      state.selected && state.selected.type === 'wp') {
    state.waypoints.splice(state.selected.index, 1);
    state.selected = null;
    syncLegs(); draw(); showInspector();
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
  if (wp >= 0) {
    touchDrag = { kind: 'wp', i: wp };
    state.selected = { type: 'wp', index: wp };
  } else {
    const lab = hitLegLabel(p.x, p.y);
    if (lab) {
      const f = legFrame(lab.i);
      touchDrag = { kind: 'label', i: lab.i, which: lab.which,
                    lx: p.x, ly: p.y, dx: f.dx, dy: f.dy, nx: f.nx, ny: f.ny };
      state.selected = { type: 'leg', index: lab.i };
    } else {
      const leg = hitLeg(p.x, p.y);
      if (leg >= 0) {
        touchDrag = { kind: 'legtap' };
        state.selected = { type: 'leg', index: leg };
      }
    }
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
  if (touchDrag.kind === 'wp') {
    const ll = map.containerPointToLatLng([p.x, p.y]);
    state.waypoints[touchDrag.i].lat = ll.lat;
    state.waypoints[touchDrag.i].lng = ll.lng;
    draw(); showInspector();
  } else {
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
    waypoints: state.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name || '' })),
    legs: state.legs.map(l => ({
      inboundAltitude: l.inboundAltitude,
      outboundAltitude: l.outboundAltitude,
      flightSpeed: l.flightSpeed,
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
        lat: +w.lat, lng: +w.lng, name: w.name || '',
      }));
      state.legs = (d.legs || []).map(l => ({
        inboundAltitude: l.inboundAltitude ?? 2000,
        outboundAltitude: l.outboundAltitude ?? 2000,
        flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
        inLabel: l.inLabel || { a: 0, p: 44 },
        outLabel: l.outLabel || { a: 0, p: -44 },
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
  st.textContent = '@page { size: ' + (pageSize || 'A4') + ' ' +
                   pageOrient + '; margin: 6mm; }';
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

function doPrint() {
  printing = true;
  draw();
  window.print();
  printing = false;
  draw();
}

// --- route persistence ----------------------------------------------
const STORE_KEY = 'plotter.route';
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
      lat: +w.lat, lng: +w.lng, name: w.name || '',
    }));
    state.legs = (d.legs || []).map(l => ({
      inboundAltitude: l.inboundAltitude ?? 2000,
      outboundAltitude: l.outboundAltitude ?? 2000,
      flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
      inLabel: l.inLabel || { a: 0, p: 44 },
      outLabel: l.outLabel || { a: 0, p: -44 },
    }));
    syncLegs();
    return true;
  } catch (e) {
    return false;
  }
}

// --- toolbar ---------------------------------------------------------
function setMode(mode) {
  state.mode = mode;
  document.getElementById('tool-add').classList.toggle('active', mode === 'add');
  document.getElementById('tool-edit').classList.toggle('active', mode === 'edit');
  document.getElementById('map').classList.toggle('add', mode === 'add');
}
document.getElementById('tool-add').onclick = () => setMode('add');
document.getElementById('tool-edit').onclick = () => setMode('edit');
document.getElementById('reverse').onclick = () => {
  state.waypoints.reverse();
  state.legs.reverse();
  state.selected = null;
  showInspector(); draw();
};
document.getElementById('clear').onclick = () => {
  if (state.waypoints.length && !confirm('Remove all waypoints?')) return;
  state.waypoints = [];
  state.legs = [];
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
document.getElementById('ret-cb').onchange = e => {
  showReturn = e.target.checked;
  draw();
};
document.getElementById('mid-cb').onchange = e => {
  showMidLeg = e.target.checked;
  draw();
};
document.getElementById('page-a3').onclick = () => setPage('A3');
document.getElementById('page-a4').onclick = () => setPage('A4');
document.getElementById('print').onclick = doPrint;
document.getElementById('insp-close').onclick = () => {
  state.selected = null;
  showInspector(); draw();
};

// --- boot ------------------------------------------------------------
resizeOverlay();
setMode('add');
restoreRoute();
if (state.waypoints.length) fitView();   // always frame the restored route
draw();
