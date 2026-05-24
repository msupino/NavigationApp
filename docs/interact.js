'use strict';
/* NavAid — hit-testing, inspector panel, mouse/touch interaction.
   Shares globals with core.js; loaded after draw.js. */

// --- hit testing -----------------------------------------------------
function hitNote(px, py) {
  for (let i = state.notes.length - 1; i >= 0; i--) {
    const r = noteRect(i);
    if (r.oval) {
      const dx = (px - (r.x + r.w / 2)) / (r.w / 2);
      const dy = (py - (r.y + r.h / 2)) / (r.h / 2);
      if (dx * dx + dy * dy <= 1) return i;
    } else if (px >= r.x && px <= r.x + r.w &&
               py >= r.y && py <= r.y + r.h) {
      return i;
    }
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

// Remove waypoint k and the leg beside it, so the remaining legs keep
// their altitudes / speeds aligned with the route geometry.
function deleteWaypoint(k) {
  state.waypoints.splice(k, 1);
  if (state.legs.length) {
    state.legs.splice(Math.min(k, state.legs.length - 1), 1);
  }
  syncLegs();
}

// Compose the leg-inspector title from the names of its endpoints, e.g.
// "TLV → NETANYA" (LTR) / "TLV ← NETANYA" (RTL). Falls back to the sequence
// label (`WP N` / `נק׳ N`) for unnamed waypoints, and to the legacy
// "Leg N" string if the adjacent waypoints can't be resolved.
function legPairTitle(idx) {
  try {
    const a = state.waypoints[idx];
    const b = state.waypoints[idx + 1];
    if (!a || !b) return S.legTitle(idx + 1);
    const labelFor = (wp, i) => {
      const raw = (wp.name || '').trim();
      const loc = raw ? (navName(raw) || raw).trim() : '';
      return loc || (S.wpPrefix + (i + 1));
    };
    const arrow = S.legArrow || '→';
    return labelFor(a, idx) + ' ' + arrow + ' ' + labelFor(b, idx + 1);
  } catch (e) {
    return S.legTitle(idx + 1);
  }
}

function showInspector() {
  const insp = document.getElementById('inspector');
  const title = document.getElementById('insp-title');
  const body = document.getElementById('insp-body');
  body.innerHTML = '';
  title.classList.remove('editable');
  if (!state.selected) { insp.classList.add('hidden'); return; }
  insp.classList.remove('hidden');

  if (state.selected.type === 'leg') {
    const idx = state.selected.index;
    const leg = state.legs[idx];
    title.value = legPairTitle(idx);
    title.placeholder = '';
    title.readOnly = true;
    title.oninput = null;
    body.appendChild(numberRow(S.speedKt, leg.flightSpeed, v => {
      leg.flightSpeed = v > 0 ? v : leg.flightSpeed; draw();
    }));
    body.appendChild(numberRow(S.inboundAlt, leg.inboundAltitude, v => {
      const oldVal = leg.inboundAltitude;
      leg.inboundAltitude = Math.round(v);
      propagateAlt(idx, 'inboundAltitude', leg.inboundAltitude, oldVal);
      draw();
    }));
    body.appendChild(numberRow(S.outboundAlt, leg.outboundAltitude, v => {
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
    body.appendChild(selectRow(S.shape, note.shape || 'rect',
      [['rect', S.shapeRect], ['oval', S.shapeOval]], v => {
        note.shape = v; draw();
      }));
    body.appendChild(colorRow(S.color, note.color || NOTE_DEFAULT_COLOR, v => {
      note.color = v; draw();
    }));
    const del = document.createElement('button');
    del.className = 'insp-btn';
    del.textContent = S.deleteNote;
    del.onclick = () => {
      state.notes.splice(state.selected.index, 1);
      state.selected = null;
      draw(); showInspector();
    };
    body.appendChild(del);
  } else {
    const wp = state.waypoints[state.selected.index];
    title.value = wp.name || '';
    title.placeholder = S.wpPrefix + (state.selected.index + 1);
    title.readOnly = false;
    title.classList.add('editable');
    title.oninput = () => { wp.name = title.value; draw(); };
    body.appendChild(textRow(S.latitude, fmtLatLng(wp.lat, 'N', 'S')));
    body.appendChild(textRow(S.longitude, fmtLatLng(wp.lng, 'E', 'W')));
    const del = document.createElement('button');
    del.className = 'insp-btn';
    del.textContent = S.deleteWp;
    del.onclick = () => {
      deleteWaypoint(state.selected.index);
      state.selected = null;
      draw(); showInspector();
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
function selectRow(label, value, options, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const sel = document.createElement('select');
  for (const [val, text] of options) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = text;
    if (val === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => onChange(sel.value);
  row.append(l, sel);
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
  // Hit-test priority matches paint order so the topmost element wins:
  // notes are drawn above waypoints (draw.js), so test notes first (issue #71).
  const note = hitNote(p.x, p.y);
  if (note >= 0) {
    downHit = true;
    state.selected = { type: 'note', index: note };
    drag = { kind: 'note', i: note };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
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
  if (pageSize && hitPageFrameEdge(p.x, p.y)) {
    downHit = true;
    drag = { kind: 'page', lx: p.x, ly: p.y };
    map.dragging.disable();
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
    const o = leg && (drag.which === 'in' ? leg.inLabel : leg.outLabel);
    if (!o) return;                    // malformed leg / label — issue #82
    o.a += ddx * drag.dx + ddy * drag.dy;
    o.p += ddx * drag.nx + ddy * drag.ny;
    draw();
  } else if (drag.kind === 'page') {
    pageOffset.x += p.x - drag.lx;
    pageOffset.y += p.y - drag.ly;
    drag.lx = p.x; drag.ly = p.y;
    clampPageOffset();
    draw();
  }
});

// Re-enable map dragging on release anywhere, not just inside the map.
// Listening to map.on('mouseup') alone misses releases over the toolbar /
// browser chrome and leaves the map permanently unpannable (issue #70).
function endMouseDrag() {
  if (drag) { map.dragging.enable(); drag = null; }
}
window.addEventListener('mouseup', endMouseDrag);
window.addEventListener('pointerup', endMouseDrag);
window.addEventListener('pointercancel', endMouseDrag);

map.on('click', e => {
  if (downHit) { downHit = false; return; }
  if (state.mode === 'add') {
    const r = applyNavSnap(e.latlng, '');
    state.waypoints.push({ lat: r.lat, lng: r.lng, name: r.name });
    syncLegs();
    state.selected = { type: 'wp', index: state.waypoints.length - 1 };
    showInspector(); draw();
  } else if (state.mode === 'note') {
    state.notes.push({ lat: e.latlng.lat, lng: e.latlng.lng,
                       text: S.noteDefault, color: NOTE_DEFAULT_COLOR,
                       shape: 'rect' });
    state.selected = { type: 'note', index: state.notes.length - 1 };
    showInspector(); draw();
  } else if (state.selected) {
    state.selected = null;               // empty-map click closes the inspector
    showInspector(); draw();
  }
});

window.addEventListener('keydown', e => {
  const t = e.target;
  if (e.key === 'Escape') {
    if (state.selected) {
      state.selected = null;
      showInspector(); draw();
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) t.blur();
    }
    return;
  }
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;                              // typing in a field — leave the WP alone
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!state.selected) return;
    if (state.selected.type === 'wp') {
      deleteWaypoint(state.selected.index);
      state.selected = null;
      draw(); showInspector();
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
  // Hit-test priority matches paint order so the topmost element wins:
  // notes are drawn above waypoints (draw.js), so test notes first (issue #71).
  const note = hitNote(p.x, p.y);
  const wp = note < 0 ? hitWaypoint(p.x, p.y) : -1;
  const lab = (wp < 0 && note < 0) ? hitLegLabel(p.x, p.y) : null;
  const leg = (wp < 0 && note < 0 && !lab) ? hitLeg(p.x, p.y) : -1;
  const onPage = (wp < 0 && note < 0 && !lab && leg < 0 && pageSize)
    ? hitPageFrameEdge(p.x, p.y) : false;

  if (note >= 0) {
    touchDrag = { kind: 'note', i: note };
    state.selected = { type: 'note', index: note };
  } else if (wp >= 0) {
    touchDrag = { kind: 'wp', i: wp };
    state.selected = { type: 'wp', index: wp };
  } else if (lab) {
    const f = legFrame(lab.i);
    touchDrag = { kind: 'label', i: lab.i, which: lab.which,
                  lx: p.x, ly: p.y, dx: f.dx, dy: f.dy, nx: f.nx, ny: f.ny };
    state.selected = { type: 'leg', index: lab.i };
  } else if (leg >= 0) {
    touchDrag = { kind: 'legtap' };
    state.selected = { type: 'leg', index: leg };
  } else if (onPage) {
    touchDrag = { kind: 'page', lx: p.x, ly: p.y };
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
    const o = leg && (touchDrag.which === 'in' ? leg.inLabel : leg.outLabel);
    if (!o) return;                    // malformed leg / label — issue #82
    o.a += ddx * touchDrag.dx + ddy * touchDrag.dy;
    o.p += ddx * touchDrag.nx + ddy * touchDrag.ny;
    draw();
  } else if (touchDrag.kind === 'page') {
    pageOffset.x += p.x - touchDrag.lx;
    pageOffset.y += p.y - touchDrag.ly;
    touchDrag.lx = p.x; touchDrag.ly = p.y;
    clampPageOffset();
    draw();
  }
}, { passive: false });

function endTouch() {
  if (touchDrag) { map.dragging.enable(); touchDrag = null; }
}
mapEl.addEventListener('touchend', endTouch);
mapEl.addEventListener('touchcancel', endTouch);

let _drawPending = false;
function scheduleDraw() {
  if (_drawPending) return;
  _drawPending = true;
  requestAnimationFrame(() => { _drawPending = false; draw(); });
}
map.on('move zoom viewreset moveend zoomend', scheduleDraw);
map.on('resize', () => { resizeOverlay(); scheduleDraw(); });

// --- view fitting ----------------------------------------------------
function fitView() {
  if (state.waypoints.length === 0) {
    map.setView([32.0, 34.9], 9);
    return;
  }
  const b = L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng]));
  map.fitBounds(b, { padding: [70, 70] });
}

