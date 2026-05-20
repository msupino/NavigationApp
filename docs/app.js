'use strict';

/* ------------------------------------------------------------------ *
 * Plotter — HTML5 port of the Unity NavigationApp map plotter.
 * Coordinate model and conversion rates ported from Assets/Scripts/Main.cs.
 * ------------------------------------------------------------------ */

// --- conversion constants (from Main.cs) -----------------------------
const LON_RATE   = 8.392355;   // scene units per 10' of longitude
const LAT_RATE   = 10.00674;   // scene units per 10' of latitude
const NM_RATE    = 0.1666667;  // 10' expressed in degrees
const LON_ORIGIN = 35;         // degrees E at scene x = 0
const LAT_ORIGIN = 33;         // degrees N at scene z = 0
const MAG_DEV    = -5;         // fixed magnetic deviation (ToMagnetic)
const EARTH_NM   = 3440.065;   // mean Earth radius in nautical miles

// --- model -----------------------------------------------------------
const state = {
  waypoints: [],            // [{ x, z }]  scene units, plane is (x, z)
  legs: [],                 // [{ inboundAltitude, outboundAltitude, flightSpeed, drawMidLegIndication }]
  cam: { x: 0, z: 0, scale: 6 },   // scale = screen px per scene unit
  mode: 'add',              // 'add' | 'edit'
  selected: null,           // { type:'wp'|'leg', index }
};

const newLeg = () => ({
  inboundAltitude: 2000,
  outboundAltitude: 2000,
  flightSpeed: 90,
  drawMidLegIndication: true,
});

// --- geo helpers (port of Main.cs static methods) --------------------
function sceneToCoord(x, z) {
  return {
    lon: (x / LON_RATE) * NM_RATE + LON_ORIGIN,
    lat: (z / LAT_RATE) * NM_RATE + LAT_ORIGIN,
  };
}
function coordToScene(lat, lon) {
  return {
    x: ((lon - LON_ORIGIN) / NM_RATE) * LON_RATE,
    z: ((lat - LAT_ORIGIN) / NM_RATE) * LAT_RATE,
  };
}

// Great-circle distance (NM) and initial bearing (deg true) between two scene points.
function geo(p1, p2) {
  const a = sceneToCoord(p1.x, p1.z);
  const b = sceneToCoord(p2.x, p2.z);
  const rad = d => (d * Math.PI) / 180;
  const phi1 = rad(a.lat), phi2 = rad(b.lat);
  const dPhi = rad(b.lat - a.lat), dLam = rad(b.lon - a.lon);
  const h = Math.sin(dPhi / 2) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  const dist = 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  const brg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { dist, brg };
}

// True bearing -> magnetic, integer, wrapped (Main.ToMagnetic).
function toMagnetic(deg) {
  return (((Math.round(deg) + MAG_DEV) % 360) + 360) % 360;
}
const pad3 = n => String(n).padStart(3, '0');

// Decimal hours -> "M:SS", seconds rounded to nearest 5 (Main.ToHMS).
function toHMS(hours) {
  const totalMin = hours * 60;
  let m = Math.floor(totalMin);
  let s = Math.round(((totalMin - m) * 60) / 5) * 5;
  if (s >= 60) { s -= 60; m++; }
  return m + ':' + String(s).padStart(2, '0');
}

// --- canvas / view ---------------------------------------------------
const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
let dpr = 1;

function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
const vw = () => canvas.width / dpr;
const vh = () => canvas.height / dpr;

// scene {x,z} -> screen {x,y}  (scene z points up)
function s2p(p) {
  return {
    x: (p.x - state.cam.x) * state.cam.scale + vw() / 2,
    y: -(p.z - state.cam.z) * state.cam.scale + vh() / 2,
  };
}
// screen px -> scene {x,z}
function p2s(px, py) {
  return {
    x: (px - vw() / 2) / state.cam.scale + state.cam.x,
    z: -(py - vh() / 2) / state.cam.scale + state.cam.z,
  };
}

// --- leg bookkeeping -------------------------------------------------
function syncLegs() {
  const need = Math.max(0, state.waypoints.length - 1);
  while (state.legs.length < need) state.legs.push(newLeg());
  while (state.legs.length > need) state.legs.pop();
}

// --- background chart ------------------------------------------------
// CVFR2020 chart composited and georeferenced by build_map.py.
const MAP = { xMin: -46.880, xMax: 47.550, zMin: -207.934, zMax: 25.561 };
const mapImg = new Image();
let mapReady = false;
mapImg.onload = () => { mapReady = true; draw(); };
mapImg.src = 'map.jpg';

// --- navigation waypoints (published VFR reporting points) -----------
let navWaypoints = [];                 // [{ name, x, z }]
let showNav = false;                   // off by default — overlay not yet accurate
fetch('nav-waypoints.json')
  .then(r => r.json())
  .then(d => {
    navWaypoints = (d.waypoints || []).map(w => {
      const s = coordToScene(w.coord[1], w.coord[0]);   // coord = [lon, lat]
      return { name: w.name, x: s.x, z: s.z };
    });
    draw();
  })
  .catch(() => {});

// --- drawing ---------------------------------------------------------
function draw() {
  ctx.clearRect(0, 0, vw(), vh());
  ctx.fillStyle = '#231F20';
  ctx.fillRect(0, 0, vw(), vh());

  drawMap();
  drawNavWaypoints();
  drawLegs();
  drawWaypoints();
  drawInfo();
  persist();
}

// Draw the georeferenced CVFR chart into its scene rectangle.
function drawMap() {
  if (!mapReady) return;
  const tl = s2p({ x: MAP.xMin, z: MAP.zMax });
  const br = s2p({ x: MAP.xMax, z: MAP.zMin });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mapImg, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

// Published navigation waypoints overlay; names appear once zoomed in.
function drawNavWaypoints() {
  if (!showNav || navWaypoints.length === 0) return;
  const showText = state.cam.scale > 16;
  const r = 5;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const w of navWaypoints) {
    const s = s2p(w);
    if (s.x < -30 || s.x > vw() + 30 || s.y < -30 || s.y > vh() + 30) continue;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x - r * 0.9, s.y + r * 0.7);
    ctx.lineTo(s.x + r * 0.9, s.y + r * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#b3138a';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (showText) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(w.name, s.x, s.y - r - 7);
      ctx.fillStyle = '#b3138a';
      ctx.fillText(w.name, s.x, s.y - r - 7);
    }
  }
  ctx.textAlign = 'left';
}

// Rounded-rectangle path helper.
function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fmtDeg(value, pos, neg) {
  const hemi = value >= 0 ? pos : neg;
  const v = Math.abs(value);
  const d = Math.floor(v);
  const m = Math.round((v - d) * 60);
  return `${d}°${String(m).padStart(2, '0')}'${hemi}`;
}

function drawLegs() {
  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i];
    const B = state.waypoints[i + 1];
    if (!A || !B) continue;
    const leg = state.legs[i];
    const sa = s2p(A), sb = s2p(B);
    const selected = state.selected &&
                     state.selected.type === 'leg' &&
                     state.selected.index === i;

    // thick leg line
    ctx.lineCap = 'round';
    ctx.strokeStyle = selected ? '#ffcc33' : '#161412';
    ctx.lineWidth = selected ? 5 : 3.5;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.lineCap = 'butt';

    drawDriftLines(sa, sb);

    const { dist, brg } = geo(A, B);
    const durH = leg.flightSpeed > 0 ? dist / leg.flightSpeed : 0;
    const magIn = toMagnetic(brg);
    const magOut = (magIn + 180) % 360;
    const timeStr = durH > 0 ? toHMS(durH) : '--';

    drawMinuteMarkers(sa, sb, durH);

    // info boxes rotated parallel to the leg, one on each side
    const ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    let dx = sb.x - sa.x, dy = sb.y - sa.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    const off = 40;
    drawLegArrow(mid.x + nx * off, mid.y + ny * off, ang,
      pad3(magIn), timeStr, String(leg.inboundAltitude), '#2f6fd0');
    drawLegArrow(mid.x - nx * off, mid.y - ny * off, ang + Math.PI,
      pad3(magOut), timeStr, String(leg.outboundAltitude), '#c0392b');

    if (leg.drawMidLegIndication) drawDistanceBadge(mid.x, mid.y, dist);
  }
}

// 10-degree drift reference lines: one from each leg end, angled 10 deg off
// the leg, half the leg length, dashed.
function drawDriftLines(sa, sb) {
  const a = 10 * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const abx = sb.x - sa.x, aby = sb.y - sa.y;
  const bax = -abx, bay = -aby;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(20,20,20,0.6)';
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sa.x + (abx * c - aby * s) * 0.5, sa.y + (abx * s + aby * c) * 0.5);
  ctx.moveTo(sb.x, sb.y);
  ctx.lineTo(sb.x + (bax * c - bay * s) * 0.5, sb.y + (bax * s + bay * c) * 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawMinuteMarkers(sa, sb, durH) {
  const totalMin = durH * 60;
  if (totalMin < 1) return;
  let dx = sb.x - sa.x, dy = sb.y - sa.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const nx = -dy, ny = dx;
  ctx.strokeStyle = '#161412';
  ctx.lineWidth = 1.5;
  const count = Math.floor(totalMin);
  for (let m = 1; m <= count; m++) {
    const f = m / totalMin;
    const px = sa.x + (sb.x - sa.x) * f;
    const py = sa.y + (sb.y - sa.y) * f;
    const tick = m % 2 === 0 ? 7 : 4;
    ctx.beginPath();
    ctx.moveTo(px - nx * tick, py - ny * tick);
    ctx.lineTo(px + nx * tick, py + ny * tick);
    ctx.stroke();
  }
}

// Navigation leg marker: a two-cell rectangle (altitude, time) joined to a
// triangle (heading) pointing in the flight direction. Text runs across the
// marker and is locked to its orientation, matching the reference chart.
function drawLegArrow(cx, cy, flightAng, head, time, alt, accent) {
  const W = 46, cell = 22, Lt = 26;
  const Lr = cell * 2, L = Lr + Lt;
  const xb = -L / 2 + Lr;                // rectangle / triangle boundary

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(flightAng);
  ctx.beginPath();
  ctx.moveTo(-L / 2, -W / 2);
  ctx.lineTo(xb, -W / 2);
  ctx.lineTo(L / 2, 0);                  // triangle apex = flight direction
  ctx.lineTo(xb, W / 2);
  ctx.lineTo(-L / 2, W / 2);
  ctx.closePath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.lineWidth = 1;                     // cell dividers
  for (const dx of [-L / 2 + cell, xb]) {
    ctx.beginPath();
    ctx.moveTo(dx, -W / 2);
    ctx.lineTo(dx, W / 2);
    ctx.stroke();
  }
  ctx.restore();

  // text runs across the marker, locked to its orientation (no upright flip)
  const ta = flightAng + Math.PI / 2;
  const cos = Math.cos(flightAng), sin = Math.sin(flightAng);
  const at = lx => ({ x: cx + lx * cos, y: cy + lx * sin });
  const pAlt = at(-L / 2 + cell * 0.5);
  const pTime = at(-L / 2 + cell * 1.5);
  const pHead = at(xb + Lt * 0.32);
  drawRotText(pAlt.x, pAlt.y, ta, alt, 'bold 13px sans-serif', '#000000');
  drawRotText(pTime.x, pTime.y, ta, time, 'bold 13px sans-serif', '#000000');
  drawRotText(pHead.x, pHead.y, ta, head, 'bold 14px sans-serif', '#000000');
}

function drawRotText(x, y, ang, text, font, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawDistanceBadge(cx, cy, dist) {
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#161412';
  ctx.stroke();
  ctx.fillStyle = '#161412';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(dist.toFixed(1), cx, cy);
  ctx.textAlign = 'left';
}

function drawWaypoints() {
  for (let i = 0; i < state.waypoints.length; i++) {
    const s = s2p(state.waypoints[i]);
    const selected = state.selected &&
                     state.selected.type === 'wp' &&
                     state.selected.index === i;
    ctx.beginPath();
    ctx.arc(s.x, s.y, selected ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#ffcc33' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#161412';
    ctx.stroke();

    const label = 'WP' + (i + 1);
    ctx.font = 'bold 11px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(label, s.x + 12, s.y - 10);
    ctx.fillStyle = '#161412';
    ctx.fillText(label, s.x + 12, s.y - 10);
  }
}

function drawInfo() {
  let totalDist = 0, totalH = 0;
  for (let i = 0; i < state.legs.length; i++) {
    const { dist } = geo(state.waypoints[i], state.waypoints[i + 1]);
    totalDist += dist;
    if (state.legs[i].flightSpeed > 0) totalH += dist / state.legs[i].flightSpeed;
  }
  const el = document.getElementById('info');
  el.textContent =
    `Waypoints  ${state.waypoints.length}\n` +
    `Legs       ${state.legs.length}\n` +
    `Distance   ${totalDist.toFixed(1)} NM\n` +
    `Total time ${totalH > 0 ? toHMS(totalH) : '--'}`;
}

// --- hit testing -----------------------------------------------------
function hitWaypoint(px, py) {
  for (let i = state.waypoints.length - 1; i >= 0; i--) {
    const s = s2p(state.waypoints[i]);
    if (Math.hypot(s.x - px, s.y - py) <= 10) return i;
  }
  return -1;
}
function hitLeg(px, py) {
  for (let i = 0; i < state.legs.length; i++) {
    const a = s2p(state.waypoints[i]);
    const b = s2p(state.waypoints[i + 1]);
    if (distToSegment(px, py, a, b) <= 7) return i;
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
      leg.flightSpeed = v > 0 ? v : leg.flightSpeed; draw(); showInspector();
    }));
    body.appendChild(numberRow('Inbound alt (ft)', leg.inboundAltitude, v => {
      leg.inboundAltitude = Math.round(v); draw();
    }));
    body.appendChild(numberRow('Outbound alt (ft)', leg.outboundAltitude, v => {
      leg.outboundAltitude = Math.round(v); draw();
    }));
    body.appendChild(boolRow('Mid-leg indication', leg.drawMidLegIndication, v => {
      leg.drawMidLegIndication = v; draw();
    }));
  } else {
    const wp = state.waypoints[state.selected.index];
    const c = sceneToCoord(wp.x, wp.z);
    title.textContent = 'WP' + (state.selected.index + 1);
    body.appendChild(textRow('Latitude', fmtDeg(c.lat, 'N', 'S')));
    body.appendChild(textRow('Longitude', fmtDeg(c.lon, 'E', 'W')));
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

// --- pointer interaction ---------------------------------------------
let drag = null;   // { kind:'pan'|'wp', ... }

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const px = e.clientX, py = e.clientY;
  const wp = hitWaypoint(px, py);

  if (wp >= 0) {
    state.selected = { type: 'wp', index: wp };
    drag = { kind: 'wp', index: wp, moved: false };
    showInspector(); draw();
    return;
  }
  const leg = hitLeg(px, py);
  if (leg >= 0) {
    state.selected = { type: 'leg', index: leg };
    // noAdd: a click that selects a leg must not also drop a waypoint
    drag = { kind: 'pan', sx: px, sy: py, cx: state.cam.x, cz: state.cam.z,
             moved: false, noAdd: true };
    showInspector(); draw();
    return;
  }
  // empty space — pan; in add mode a click (no drag) drops a waypoint
  drag = { kind: 'pan', sx: px, sy: py, cx: state.cam.x, cz: state.cam.z, moved: false };
});

canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const px = e.clientX, py = e.clientY;

  if (drag.kind === 'wp') {
    drag.moved = true;
    state.waypoints[drag.index] = p2s(px, py);
    draw(); showInspector();
  } else {
    const ddx = px - drag.sx, ddy = py - drag.sy;
    if (Math.abs(ddx) > 3 || Math.abs(ddy) > 3) drag.moved = true;
    if (drag.moved) {
      canvas.classList.add('panning');
      state.cam.x = drag.cx - ddx / state.cam.scale;
      state.cam.z = drag.cz + ddy / state.cam.scale;
      draw();
    }
  }
});

canvas.addEventListener('pointerup', e => {
  canvas.classList.remove('panning');
  if (drag && drag.kind === 'pan' && !drag.moved && !drag.noAdd &&
      state.mode === 'add') {
    // plain click on empty space in add mode -> new waypoint
    state.waypoints.push(p2s(e.clientX, e.clientY));
    syncLegs();
    state.selected = { type: 'wp', index: state.waypoints.length - 1 };
    showInspector(); draw();
  }
  drag = null;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const before = p2s(e.clientX, e.clientY);
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  state.cam.scale = Math.max(0.4, Math.min(400, state.cam.scale * factor));
  const after = p2s(e.clientX, e.clientY);
  state.cam.x += before.x - after.x;
  state.cam.z += before.z - after.z;
  draw();
}, { passive: false });

window.addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
    if (state.selected.type === 'wp') {
      state.waypoints.splice(state.selected.index, 1);
      state.selected = null;
      syncLegs(); draw(); showInspector();
    }
  }
});

// --- view fitting ----------------------------------------------------
function fitRect(minX, maxX, minZ, maxZ, pad) {
  state.cam.x = (minX + maxX) / 2;
  state.cam.z = (minZ + maxZ) / 2;
  const spanX = Math.max(maxX - minX, 1);
  const spanZ = Math.max(maxZ - minZ, 1);
  const scale = Math.min(vw() / spanX, vh() / spanZ) * pad;
  state.cam.scale = Math.max(0.4, Math.min(400, scale));
  draw();
}

function fitView() {
  if (state.waypoints.length === 0) {
    fitRect(MAP.xMin, MAP.xMax, MAP.zMin, MAP.zMax, 0.96);
    return;
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const w of state.waypoints) {
    minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
    minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
  }
  fitRect(minX, maxX, minZ, maxZ, 0.7);
}

// --- save / load -----------------------------------------------------
// JSON format matches the Unity SceneData (waypoints + legs).
function save() {
  const data = {
    waypoints: state.waypoints.map(w => ({ x: w.x, y: 0, z: w.z })),
    legs: state.legs.map(l => ({
      inboundAltitude: l.inboundAltitude,
      outboundAltitude: l.outboundAltitude,
      flightSpeed: l.flightSpeed,
      drawMidLegIndication: l.drawMidLegIndication,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'waypoints.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function load(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      state.waypoints = (d.waypoints || []).map(p => ({ x: +p.x, z: +p.z }));
      state.legs = (d.legs || []).map(l => ({
        inboundAltitude: l.inboundAltitude ?? 2000,
        outboundAltitude: l.outboundAltitude ?? 2000,
        flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
        drawMidLegIndication: l.drawMidLegIndication ?? true,
      }));
      syncLegs();
      state.selected = null;
      showInspector();
      fitView();
    } catch (err) {
      alert('Could not load file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// --- toolbar wiring --------------------------------------------------
function setMode(mode) {
  state.mode = mode;
  document.getElementById('tool-add').classList.toggle('active', mode === 'add');
  document.getElementById('tool-edit').classList.toggle('active', mode === 'edit');
  canvas.classList.toggle('edit', mode === 'edit');
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
document.getElementById('nav-cb').onchange = e => {
  showNav = e.target.checked;
  draw();
};

function defaultView() {
  state.cam.x = (MAP.xMin + MAP.xMax) / 2;
  state.cam.z = coordToScene(32.0, 35.0).z;          // central Israel
  const fit = vw() / (MAP.xMax - MAP.xMin);
  state.cam.scale = Math.max(0.4, Math.min(400, fit));
  draw();
}

// --- route persistence (survives page reload) ------------------------
const STORE_KEY = 'plotter.route';
let persistTimer = null;

function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        waypoints: state.waypoints,
        legs: state.legs,
        cam: state.cam,
      }));
    } catch (e) { /* storage unavailable */ }
  }, 500);
}

function restoreRoute() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state.waypoints = (d.waypoints || []).map(w => ({ x: +w.x, z: +w.z }));
    state.legs = (d.legs || []).map(l => ({
      inboundAltitude: l.inboundAltitude ?? 2000,
      outboundAltitude: l.outboundAltitude ?? 2000,
      flightSpeed: l.flightSpeed > 0 ? l.flightSpeed : 90,
      drawMidLegIndication: l.drawMidLegIndication ?? true,
    }));
    syncLegs();
    if (d.cam && isFinite(d.cam.x) && isFinite(d.cam.z) && d.cam.scale > 0) {
      state.cam = { x: +d.cam.x, z: +d.cam.z, scale: +d.cam.scale };
    }
    return true;
  } catch (e) {
    return false;
  }
}

// --- boot ------------------------------------------------------------
window.addEventListener('resize', resize);
const restored = restoreRoute();
resize();
if (!restored) defaultView();
