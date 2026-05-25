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
  // #83: scale the hit radius with the same zoom + legArrowSize factor that
  // sizes the drawn marker (see drawLegArrow in draw.js), so the hit zone
  // tracks the visual size. Floor at 18 px keeps touch ergonomics.
  const zoomScale = Math.max(0.35, Math.pow(2, map.getZoom() - 12)) * legArrowSize;
  const hit = Math.max(18, 34 * zoomScale);
  for (let i = 0; i < state.legs.length; i++) {
    for (const which of ['in', 'out']) {
      if (which === 'out' && !showReturn) continue;
      const c = legLabelCenter(i, which);
      if (c && Math.hypot(c.x - px, c.y - py) <= hit) return { i, which };
    }
  }
  return null;
}

function hitSuggestion(px, py) {
  if (!legSuggestions) return null;
  for (let i = 0; i < legSuggestions.length; i++) {
    const chips = legSuggestions[i];
    if (!chips) continue;
    for (let c = 0; c < chips.length; c++) {
      const ch = chips[c];
      if (px >= ch.sx && px <= ch.sx + ch.sw &&
          py >= ch.sy && py <= ch.sy + ch.sh) {
        return { legIdx: i, wp: ch };
      }
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
  const dir = key === 'outboundAltitude' || key === 'outboundSpeed' ? -1 : 1;
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
    // #81: show the locale-resolved label so the inspector matches the map.
    // The canonical stored name (`wp.name`) is whatever the user types/keeps;
    // navName() converts a nav-WP canonical id to the current locale for read.
    title.value = navName((wp.name || '').trim()) || wp.name || '';
    title.placeholder = S.wpPrefix + (state.selected.index + 1);
    title.readOnly = false;
    title.classList.add('editable');
    title.oninput = () => { wp.name = title.value; draw(); };
    body.appendChild(textRow(S.latitude, fmtLatLng(wp.lat, 'N', 'S')));
    body.appendChild(textRow(S.longitude, fmtLatLng(wp.lng, 'E', 'W')));
    // #231: runway directions when the waypoint matches a known airfield.
    if (airfields && wp.name) {
      const up = wp.name.trim().toUpperCase();
      const af = airfields.find(a => a.name === up);
      if (af && Array.isArray(af.runways) && af.runways.length) {
        const row = document.createElement('div');
        row.className = 'row runways-row';
        const lbl = document.createElement('label');
        lbl.textContent = S.runways;
        row.appendChild(lbl);
        const chips = document.createElement('div');
        chips.className = 'runway-chips';
        for (const r of af.runways) {
          const chip = document.createElement('span');
          chip.className = 'runway-chip';
          chip.textContent = r;
          chips.appendChild(chip);
        }
        row.appendChild(chips);
        body.appendChild(row);
      }
    }
    // #105: show plates section if waypoint name matches an airfield.
    if (airfields && wp.name) {
      for (const af of airfields) {
        if (af.name === wp.name && af.plates && af.plates.length) {
          const section = document.createElement('div');
          section.className = 'plates-section';
          const label = document.createElement('div');
          label.className = 'row';
          const l = document.createElement('label');
          l.textContent = S.plates;
          label.appendChild(l);
          section.appendChild(label);
          // Group by category
          const groups = {};
          const catOrder = ['approach', 'sid', 'star', 'ground', 'vfr', 'other'];
          const catLabel = {
            approach: S.plateCategoryApproach,
            sid: S.plateCategorySid,
            star: S.plateCategoryStar,
            ground: S.plateCategoryGround,
            vfr: S.plateCategoryVfr,
            other: S.plateCategoryOther,
          };
          for (const fn of af.plates) {
            const cat = plateCategory(fn);
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(fn);
          }
          for (const cat of catOrder) {
            if (!groups[cat]) continue;
            const row = document.createElement('div');
            row.className = 'row';
            const catLbl = document.createElement('label');
            catLbl.textContent = catLabel[cat];
            row.appendChild(catLbl);
            const chips = document.createElement('span');
            for (const fn of groups[cat]) {
              const chip = document.createElement('button');
              chip.className = 'plate-chip';
              chip.textContent = prettyPlateLabel(fn);
              chip.onclick = () => showPlateViewer(fn, prettyPlateLabel(fn));
              chips.appendChild(chip);
            }
            row.appendChild(chips);
            section.appendChild(row);
          }
          body.appendChild(section);
          break;
        }
      }
    }
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
    wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
    draw(); showInspector();
  } else if (drag.kind === 'note') {
    state.notes[drag.i].lat = r5(e.latlng.lat);
    state.notes[drag.i].lng = r5(e.latlng.lng);
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
  const p = e.containerPoint;
  const hitSugg = hitSuggestion(p.x, p.y);
  if (hitSugg && !state.mode) {
    insertSuggestion(hitSugg.legIdx, hitSugg.wp);
    syncLegs();
    showInspector(); draw();
    return;
  }
  if (state.mode === 'add') {
    const r = applyNavSnap(e.latlng, '');
    // #104: ignore the click if a waypoint already sits at the snap target.
    // Without this an add-mode click on a nav-WP / airfield that already has
    // a route waypoint produces a duplicate at the same coords and a leg
    // with zero distance.
    const SNAP_DEG = 0.0002;
    if (state.waypoints.some(
          w => Math.abs(w.lat - r.lat) < SNAP_DEG &&
               Math.abs(w.lng - r.lng) < SNAP_DEG)) {
      return;
    }
    state.waypoints.push({ lat: r5(r.lat), lng: r5(r.lng), name: r.name });
    syncLegs();
    state.selected = { type: 'wp', index: state.waypoints.length - 1 };
    showInspector(); draw();
  } else if (state.mode === 'note') {
    state.notes.push({ lat: r5(e.latlng.lat), lng: r5(e.latlng.lng),
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
    const modal = document.querySelector('.modal-back');
    if (modal) { modal.remove(); return; }
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
    wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
    draw(); showInspector();
  } else if (touchDrag.kind === 'note') {
    state.notes[touchDrag.i].lat = r5(ll.lat);
    state.notes[touchDrag.i].lng = r5(ll.lng);
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
  // Clamp maxZoom so two close waypoints don't snap to a tight, useless view.
  map.fitBounds(b, { padding: [70, 70], maxZoom: 11 });
}

