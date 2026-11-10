'use strict';

// Turn labels in an area. Asked: on a route that turns -- Haifa south to Hadera, then east to
// Rosh Pina -- NavAid's labels read upright only where the route runs north; "select area and
// rotate all text inside that area", our labels, not the chart's printed ones. Edit -> Turn
// labels arms the tool (state.mode 'turn', one map tool at a time like Add and Note): drag a box
// over part of the route and pick how far its labels turn -- 90° left, 180°, 90° right, or along
// the leg that runs through it. Tap a box to change or remove it. The areas are saved with the
// route (state.labelTurns, io.js sanitizeLabelTurns) and drawn turned by draw.js
// (labelTurnBegin), on screen and in NavAid's print / PNG export. Outlined only while the tool is
// on: the chart stays clean.
(function () {
  const btn = document.getElementById('tool-label-turn');
  if (!btn || typeof map === 'undefined') return;
  btn.onclick = () => { if (typeof setMode === 'function') setMode('turn'); };

  const container = map.getContainer();
  let band = null, start = null, dragsWas = null;
  const MIN_PX = 14;               // smaller than this is a tap, not a box

  window.labelTurnModeChanged = function (on) {
    if (on) {
      dragsWas = map.dragging && map.dragging.enabled();
      if (map.dragging) map.dragging.disable();
      if (typeof showToast === 'function') showToast(S.labelTurnHint || 'Drag a box over the labels to turn. Tap a box to change or remove it.');
    } else if (dragsWas !== null) {
      if (dragsWas && map.dragging) map.dragging.enable();
      dragsWas = null;
      endBand();
    }
  };

  const local = (e) => { const r = container.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function endBand() { if (band) { band.remove(); band = null; } start = null; }

  container.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'turn' || e.button > 0) return;
    // Only on the chart itself: the map's own buttons keep working while the tool is on.
    if (e.target.closest && e.target.closest('.leaflet-control, .leaflet-marker-icon, .leaflet-popup')) return;
    e.preventDefault(); e.stopPropagation();
    start = local(e);
    band = document.createElement('div');
    band.className = 'label-turn-band';
    container.appendChild(band);
    place(start);
    try { container.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }
  }, true);
  container.addEventListener('pointermove', (e) => {
    if (!start || state.mode !== 'turn') return;
    e.preventDefault(); e.stopPropagation();
    place(local(e));
  }, true);
  container.addEventListener('pointerup', (e) => {
    if (!start || state.mode !== 'turn') return;
    e.preventDefault(); e.stopPropagation();
    const a = start, b = local(e);
    endBand();
    if (Math.abs(b.x - a.x) < MIN_PX || Math.abs(b.y - a.y) < MIN_PX) {
      const i = areaAt(b);
      if (i >= 0) pick(i);
      return;
    }
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    // Four corners, not two: on a turned chart the box on screen is not a lat/lng rectangle.
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
      const ll = map.containerPointToLatLng([x, y]);
      return [ll.lat, ll.lng];
    });
    pick(-1, pts);
  }, true);
  // A click that ends a drag must not also reach the map's own click (select, add a point).
  container.addEventListener('click', (e) => {
    if (state.mode === 'turn' && !(e.target.closest && e.target.closest('.leaflet-control'))) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  function place(p) {
    if (!band || !start) return;
    band.style.left = Math.min(start.x, p.x) + 'px';
    band.style.top = Math.min(start.y, p.y) + 'px';
    band.style.width = Math.abs(p.x - start.x) + 'px';
    band.style.height = Math.abs(p.y - start.y) + 'px';
  }
  function areaAt(p) {
    const turns = state.labelTurns || [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const poly = turns[i].pts.map(q => proj({ lat: q[0], lng: q[1] }));
      if (typeof labelTurnInside === 'function' && labelTurnInside(poly, p.x, p.y)) return i;
    }
    return -1;
  }

  // The angle, in the app's own dialog. index >= 0: an existing area (change or remove it).
  function pick(index, pts) {
    const existing = index >= 0 ? state.labelTurns[index] : null;
    const modal = createDraggableModal(S.labelTurnPickTitle || 'Turn the labels', 'modal follow-me-ask-modal label-turn-modal', () => {});
    const row = document.createElement('div');
    row.className = 'label-turn-choices';
    const choices = [
      [270, S.labelTurnLeft || '90° left'],
      [180, S.labelTurn180 || '180°'],
      [90, S.labelTurnRight || '90° right'],
      ['leg', S.labelTurnLeg || 'Along the leg'],
    ];
    const done = () => { modal.close(); if (typeof persist === 'function') persist(); draw(); };
    for (const [deg, label] of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'label-turn-choice' + (existing && existing.deg === deg ? ' is-current' : '');
      b.dataset.deg = String(deg);
      b.textContent = label;
      b.setAttribute('aria-pressed', String(!!(existing && existing.deg === deg)));
      b.onclick = () => {
        if (!Array.isArray(state.labelTurns)) state.labelTurns = [];
        if (existing) existing.deg = deg;
        else state.labelTurns.push({ pts: pts.map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]), deg });
        done();
      };
      row.appendChild(b);
    }
    const actions = document.createElement('div');
    actions.className = 'follow-me-ask-actions';
    if (existing) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'label-turn-remove';
      rm.textContent = S.labelTurnRemove || 'Remove';
      rm.onclick = () => { state.labelTurns.splice(index, 1); done(); };
      actions.appendChild(rm);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'follow-me-ask-cancel';
    cancel.textContent = S.cancel || 'Cancel';
    cancel.onclick = () => modal.close();
    actions.appendChild(cancel);
    modal.box.append(row, actions);
    modal.show();
    try { row.querySelector('button').focus(); } catch (e) { /* not focusable yet */ }
  }
  window.labelTurnPick = pick;     // tests
  draw();                          // routes loaded before this module: draw their areas turned
}());
