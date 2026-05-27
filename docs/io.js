'use strict';

// Shared helper: attach a top-right '✕' close button to a .modal box. The
// inspector's #insp-close already uses this pattern; modals now match it
// (plate viewer, charts modal, flight plan) — see issue thread on toolbar
// cleanup. `onClose` is invoked when the user clicks the X.
function addModalCloseX(box, onClose) {
  const x = document.createElement('button');
  x.className = 'modal-close-x';
  x.type = 'button';
  x.textContent = '✕';
  x.setAttribute('aria-label', (window.S && S.modalCloseTitle) || 'Close');
  x.title = (window.S && S.modalCloseTitle) || 'Close';
  x.onclick = onClose;
  box.appendChild(x);
}

/* NavAid — save/load, page setup, flight plan, PNG export, persistence.
   Shares globals with core.js; loaded after interact.js. */

// --- schema validation ----------------------------------------------
// Strict validation of every documented field on route JSON (file import
// + localStorage restore) and on nav-waypoints.json. A typo like
// `flghtSpeed` used to silently default; now it surfaces an alert that
// names the offending field path so the JSON author can find it. Extra /
// unknown fields at any level are silently allowed for forward-compat
// with future schema additions (issue #101). Plain JS — no deps.
function _vKind(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;                  // 'number' | 'string' | 'object' | …
}
// Push an error onto `errs` if `obj[key]` is missing or wrong-typed.
// `type` is one of: 'number' | 'string' | 'object' | 'array' | 'shape'.
// 'number' rejects NaN/Infinity; 'shape' allows exactly 'rect' | 'oval'.
function _v(obj, key, type, path, errs) {
  if (!obj || typeof obj !== 'object' || !(key in obj)) {
    errs.push(path + '.' + key + ': missing');
    return false;
  }
  const v = obj[key];
  const k = _vKind(v);
  if (type === 'number') {
    if (k !== 'number' || !Number.isFinite(v)) {
      errs.push(path + '.' + key + ': expected number, got ' + k);
      return false;
    }
  } else if (type === 'string') {
    if (k !== 'string') {
      errs.push(path + '.' + key + ': expected string, got ' + k);
      return false;
    }
  } else if (type === 'object') {
    if (k !== 'object') {
      errs.push(path + '.' + key + ': expected object, got ' + k);
      return false;
    }
  } else if (type === 'array') {
    if (k !== 'array') {
      errs.push(path + '.' + key + ': expected array, got ' + k);
      return false;
    }
  } else if (type === 'shape') {
    if (v !== 'rect' && v !== 'oval') {
      errs.push(path + '.' + key + ': expected "rect" or "oval", got ' +
                JSON.stringify(v));
      return false;
    }
  }
  return true;
}
function validateRoute(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return 'root: expected object, got ' + _vKind(d);
  }
  const wpsOk   = _v(d, 'waypoints', 'array', 'root', errs);
  const legsOk  = _v(d, 'legs',      'array', 'root', errs);
  const notesOk = _v(d, 'notes',     'array', 'root', errs);
  if (wpsOk) {
    for (let i = 0; i < d.waypoints.length; i++) {
      const p = 'waypoints[' + i + ']';
      const w = d.waypoints[i];
      if (_vKind(w) !== 'object') {
        errs.push(p + ': expected object, got ' + _vKind(w));
        continue;
      }
      _v(w, 'lat',  'number', p, errs);
      _v(w, 'lng',  'number', p, errs);
      _v(w, 'name', 'string', p, errs);
    }
  }
  if (legsOk) {
    for (let i = 0; i < d.legs.length; i++) {
      const p = 'legs[' + i + ']';
      const l = d.legs[i];
      if (_vKind(l) !== 'object') {
        errs.push(p + ': expected object, got ' + _vKind(l));
        continue;
      }
      _v(l, 'inboundAltitude',  'number', p, errs);
      _v(l, 'outboundAltitude', 'number', p, errs);
      _v(l, 'flightSpeed',      'number', p, errs);
      // #212: hasOwnProperty (not 'in') so inherited Object.prototype keys
      // can never satisfy the optional check.
      if (Object.prototype.hasOwnProperty.call(l, 'outboundSpeed')) {
        _v(l, 'outboundSpeed', 'number', p, errs);
      }
      if (_v(l, 'inLabel',  'object', p, errs)) {
        _v(l.inLabel,  'a', 'number', p + '.inLabel',  errs);
        _v(l.inLabel,  'p', 'number', p + '.inLabel',  errs);
      }
      if (_v(l, 'outLabel', 'object', p, errs)) {
        _v(l.outLabel, 'a', 'number', p + '.outLabel', errs);
        _v(l.outLabel, 'p', 'number', p + '.outLabel', errs);
      }
    }
  }
  if (notesOk) {
    for (let i = 0; i < d.notes.length; i++) {
      const p = 'notes[' + i + ']';
      const n = d.notes[i];
      if (_vKind(n) !== 'object') {
        errs.push(p + ': expected object, got ' + _vKind(n));
        continue;
      }
      _v(n, 'lat',   'number', p, errs);
      _v(n, 'lng',   'number', p, errs);
      _v(n, 'text',  'string', p, errs);
      _v(n, 'color', 'string', p, errs);
      _v(n, 'shape', 'shape',  p, errs);
    }
  }
  if (wpsOk && legsOk) {
    const wlen = d.waypoints.length, llen = d.legs.length;
    const expected = wlen === 0 ? 0 : wlen - 1;
    if (llen !== expected) {
      errs.push('legs: length ' + llen +
                ' does not match waypoints.length - 1 (' + expected + ')');
    }
  }
  return errs.length ? errs.join('; ') : null;
}
function validateNavWaypoints(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return 'root: expected object, got ' + _vKind(d);
  }
  if (!_v(d, 'waypoints', 'array', 'root', errs)) return errs.join('; ');
  for (let i = 0; i < d.waypoints.length; i++) {
    const p = 'waypoints[' + i + ']';
    const w = d.waypoints[i];
    if (_vKind(w) !== 'object') {
      errs.push(p + ': expected object, got ' + _vKind(w));
      continue;
    }
    _v(w, 'name', 'string', p, errs);
    _v(w, 'he',   'string', p, errs);
    _v(w, 'lat',  'number', p, errs);
    _v(w, 'lng',  'number', p, errs);
  }
  return errs.length ? errs.join('; ') : null;
}
// Strict schema for docs/airfields.json — { airfields:[{ name, he, en, lat,
// lng, elev_ft, plates:[string] }] }. Mirrors validateNavWaypoints; the
// loader in draw.js bails out with an alert that names the offending field
// path so the JSON author can find the typo. Extras at any level are
// silently allowed for forward-compat (issue #101).
function validateAirfields(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return 'root: expected object, got ' + _vKind(d);
  }
  if (!_v(d, 'airfields', 'array', 'root', errs)) return errs.join('; ');
  for (let i = 0; i < d.airfields.length; i++) {
    const p = 'airfields[' + i + ']';
    const a = d.airfields[i];
    if (_vKind(a) !== 'object') {
      errs.push(p + ': expected object, got ' + _vKind(a));
      continue;
    }
    _v(a, 'name',    'string', p, errs);
    _v(a, 'he',      'string', p, errs);
    _v(a, 'en',      'string', p, errs);
    _v(a, 'lat',     'number', p, errs);
    _v(a, 'lng',     'number', p, errs);
    _v(a, 'elev_ft', 'number', p, errs);
    if (_v(a, 'plates', 'array', p, errs)) {
      for (let j = 0; j < a.plates.length; j++) {
        if (typeof a.plates[j] !== 'string') {
          errs.push(p + '.plates[' + j + ']: expected string, got ' +
                    _vKind(a.plates[j]));
        }
      }
    }
  }
  return errs.length ? errs.join('; ') : null;
}

// --- save / load -----------------------------------------------------
function save() {
  const data = {
    waypoints: state.waypoints.map(w => ({
      lat: r5(w.lat), lng: r5(w.lng), name: w.name || '',
    })),
    legs: state.legs.map(l => ({
      inboundAltitude: l.inboundAltitude,
      outboundAltitude: l.outboundAltitude,
      flightSpeed: l.flightSpeed,
      outboundSpeed: l.outboundSpeed,
      inLabel: l.inLabel,
      outLabel: l.outLabel,
    })),
    notes: state.notes.map(n => ({
      lat: r5(n.lat), lng: r5(n.lng), text: n.text || '', color: n.color || '',
      shape: n.shape || 'rect',
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'route-' + fileStamp() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function load(file) {
  // #146: hard cap on file size before we even read it. Route JSON is
  // typically <100 KB; 2 MB leaves room for big routes / future fields and
  // still aborts a user mis-pick (e.g. a PDF / image) instantly.
  const MAX_ROUTE_BYTES = 2 * 1024 * 1024;
  if (file && file.size > MAX_ROUTE_BYTES) {
    alert(S.errLoadFile + 'file too large (' +
          (file.size / 1024 / 1024).toFixed(1) + ' MB; max 2 MB)');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let d;
    try {
      d = JSON.parse(reader.result);
    } catch (err) {
      alert(S.errLoadFile + err.message);
      return;
    }
    // Strict schema check before applying any state — issue #101. Any
    // missing / mistyped field bails out with a field-path-naming alert
    // so the JSON author can find the typo. Extras are silently allowed.
    const verr = validateRoute(d);
    if (verr) {
      alert(S.errInvalidRoute(verr));
      return;
    }
    state.waypoints = d.waypoints.map(w => ({
      lat: r5(w.lat), lng: r5(w.lng), name: w.name,
    }));
    state.legs = d.legs.map(l => ({
      inboundAltitude: l.inboundAltitude,
      outboundAltitude: l.outboundAltitude,
      flightSpeed: l.flightSpeed,
      outboundSpeed: l.outboundSpeed != null ? l.outboundSpeed : l.flightSpeed,
      inLabel:  { a: l.inLabel.a,  p: l.inLabel.p,  _m: 1 },
      outLabel: { a: l.outLabel.a, p: l.outLabel.p, _m: 1 },
    }));
    state.notes = d.notes.map(n => ({
      lat: r5(n.lat), lng: r5(n.lng),
      text: n.text, color: n.color, shape: n.shape,
    }));
    syncLegs();
    state.selected = null;
    showInspector();
    fitView();
    draw();
  };
  reader.readAsText(file);
}

// --- print -----------------------------------------------------------

function applyPage() {
  document.getElementById('page-a3').classList.toggle('active', pageSize === 'A3');
  document.getElementById('page-a4').classList.toggle('active', pageSize === 'A4');
  draw();
}

function setPage(size) {
  if (pageSize === size) {             // same button toggles the frame off
    pageSize = null;
    applyPage();
    return;
  }
  // Orientation is no longer a per-click modal — the toolbar Landscape/
  // Portrait toggle (page-orient button) is the source of truth. Default
  // to landscape on first use if nothing is persisted yet.
  if (!pageOrient) pageOrient = 'landscape';
  pageSize = size;
  pageOffset = { x: 0, y: 0 };
  applyPage();
  fitPageFrame();
}
function toggleOrientation() {
  pageOrient = pageOrient === 'portrait' ? 'landscape' : 'portrait';
  try { localStorage.setItem('navaid.pageOrient', pageOrient); } catch (e) {}
  if (pageSize) { applyPage(); fitPageFrame(); }
  refreshOrientButton();
}
function refreshOrientButton() {
  const btn = document.getElementById('page-orient');
  if (!btn) return;
  btn.textContent = pageOrient === 'portrait' ? '▯' : '▭';
  btn.classList.toggle('portrait', pageOrient === 'portrait');
}

function fitPageFrame() {
  const d = pageDims();
  if (!d) return;
  const halfW = d.w * 926;          // NM→m ÷ 2 (1852÷2 = 926)
  const halfH = d.h * 926;
  let center;
  if (state.waypoints.length > 0) {
    const b = L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng]));
    center = b.getCenter();
  } else {
    center = map.getCenter();
  }
  const latRad = center.lat * Math.PI / 180;
  const cosLat = Math.cos(latRad) || 0.0001;
  const degLng = halfW / (111320 * cosLat);
  const degLat = halfH / 110540;
  const bounds = L.latLngBounds(
    [center.lat - degLat, center.lng - degLng],
    [center.lat + degLat, center.lng + degLng]
  );
  map.fitBounds(bounds, { padding: [30, 30] });
}

// --- flight plan table -----------------------------------------------
function wpLabel(i) {
  const wp = state.waypoints[i];
  if (!wp) return '';
  const n = navName((wp.name || '').trim());
  return n || (S.wpPrefix + (i + 1));
}

// #86: Flight Plan modal state and Escape-to-close handling.
let flightPlanBack = null;
let refreshFlightPlan = null;
let flightPlanEscape = null;
let flightPlanCleanup = null;             // tears down drag listeners attached
                                          // outside the modal subtree (window).
var fpOpen = false;                       // true while flight-plan modal is shown

// Returns true if wp.name matches a known airfield ICAO code.
// Used to decide whether to add startup/taxi fuel to the first leg.
function isAirport(wp) {
  if (!wp || !airfields) return false;
  const name = (wp.name || '').trim().toUpperCase();
  // Match by name OR by coordinates (renaming the label must not lose the
  // airport status; tolerance ≈ 100 m to survive minor drag).
  const eps = 0.001;
  return airfields.some(a =>
    a.name === name ||
    (Math.abs(a.lat - wp.lat) < eps && Math.abs(a.lng - wp.lng) < eps)
  );
}

function closeFlightPlan() {
  if (flightPlanEscape) {
    document.removeEventListener('keydown', flightPlanEscape);
    flightPlanEscape = null;
  }
  if (flightPlanCleanup) {
    try { flightPlanCleanup(); } catch (e) { /* listener removal is best-effort */ }
    flightPlanCleanup = null;
  }
  if (flightPlanBack) {
    flightPlanBack.remove();
    flightPlanBack = null;
  }
  refreshFlightPlan = null;
  fpOpen = false;
  try { sessionStorage.removeItem('navaid.fpOpen'); } catch (e) {}
}

function showFlightPlan() {
  if (refreshFlightPlan) return;        // #78: dedupe — modal already open
  if (state.legs.length === 0) {
    alert(S.errNoLegs);
    return;
  }
  // 'flight-plan' variant: backdrop is transparent + pointer-events: none so
  // the map underneath stays interactive (waypoint drag, pan, etc.) while
  // the plan is open. The modal box itself opts back into pointer events.
  const back = document.createElement('div');
  back.className = 'modal-back flight-plan';
  const box = document.createElement('div');
  box.className = 'modal wide';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.flightPlan;
  box.appendChild(title);

  // Drag-to-move on the title bar (mouse + touch).
  (function (el) {
    const KEY = 'navaid.fpPos';
    let dx = 0, dy = 0, dragging = false;
    function clamp(x, y) {
      return {
        x: Math.max(0, Math.min(window.innerWidth - el.offsetWidth, x)),
        y: Math.max(0, Math.min(window.innerHeight - el.offsetHeight, y)),
      };
    }
    function setPos(x, y) {
      const c = clamp(x, y);
      el.style.left = c.x + 'px';
      el.style.top = c.y + 'px';
      el.style.margin = '0';
    }
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const p = JSON.parse(raw); setPos(p.x, p.y); }
    } catch (e) {}
    function start(cx, cy) {
      const r = el.getBoundingClientRect();
      dx = cx - r.left; dy = cy - r.top;
      dragging = true;
    }
    function move(cx, cy) { if (dragging) setPos(cx - dx, cy - dy); }
    function end() {
      if (!dragging) return;
      dragging = false;
      const r = el.getBoundingClientRect();
      try { localStorage.setItem(KEY, JSON.stringify({ x: r.left, y: r.top })); } catch (e) {}
    }
    title.addEventListener('mousedown', e => {
      e.preventDefault();
      start(e.clientX, e.clientY);
      const onMove = ev => move(ev.clientX, ev.clientY);
      const onUp = () => { end(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    function onTouchStart(e) {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      start(e.touches[0].clientX, e.touches[0].clientY);
    }
    function onTouchMove(e) {
      if (!dragging || e.touches.length !== 1) return;
      e.preventDefault();
      move(e.touches[0].clientX, e.touches[0].clientY);
    }
    title.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    // closeFlightPlan() invokes this to detach the window-level listeners so
    // a re-open doesn't accumulate stale handlers (closures capture el/dragging).
    flightPlanCleanup = function () {
      title.removeEventListener('touchstart', onTouchStart, { passive: false });
      window.removeEventListener('touchmove', onTouchMove, { passive: false });
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  })(box);

  loadAircraft();
  const fpAircraft = document.createElement('div');
  fpAircraft.className = 'fp-aircraft';
  const acLbl = document.createElement('span');
  acLbl.textContent = S.tbAircraft + ': ';
  fpAircraft.appendChild(acLbl);
  const acInputDiv = document.createElement('div');
  acInputDiv.id = 'aircraft-custom';
  function mkAcInput(id, label, title, min, max, step) {
    const wrap = document.createElement('label');
    wrap.title = title || label;
    const lbl = document.createElement('span');
    lbl.textContent = label + ': ';
    wrap.appendChild(lbl);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.id = id;
    inp.min = min; inp.max = max; inp.step = step;
    inp.style.width = '60px';
    wrap.appendChild(inp);
    return wrap;
  }
  acInputDiv.appendChild(mkAcInput('aircraft-gph', S.tbGph, S.tbGphTitle, 1, 50, 0.5));
  acInputDiv.appendChild(mkAcInput('aircraft-taxi', S.tbTaxiGal, S.tbTaxiGalTitle, 0, 20, 0.1));
  fpAircraft.appendChild(acInputDiv);
  const gphInp  = acInputDiv.querySelector('#aircraft-gph');
  const taxiInp = acInputDiv.querySelector('#aircraft-taxi');
  function syncAircraftUI() {
    if (!aircraft) { aircraft = { gph: 8, taxiGal: 1.1 }; saveAircraft(); }
    gphInp.value  = aircraft.gph;
    taxiInp.value = aircraft.taxiGal;
  }
  function readAircraftInputs() {
    const gph = parseFloat(gphInp.value);
    if (isNaN(gph) || gph <= 0) return null;
    return { gph: gph, taxiGal: parseFloat(taxiInp.value) || 0 };
  }
  [gphInp, taxiInp].forEach(inp => {
    inp.oninput = function () {
      const a = readAircraftInputs();
      aircraft = a;
      saveAircraft(); draw(); refresh();
    };
  });
  syncAircraftUI();
  box.appendChild(fpAircraft);

  const scrollArea = document.createElement('div');
  scrollArea.className = 'fp-scroll';
  box.appendChild(scrollArea);

  const table = document.createElement('table');
  table.className = 'flight-table';
  const headers = S.fpHeaders;
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
  // From / To cells are editable — each waypoint may appear in two rows,
  // so edits sync every input bound to the same waypoint.
  const wpInputs = {};                  // waypoint index -> [input elements]
  function nameCell(wpIdx) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'plan-name';
    inp.maxLength = 10;
    // #81: show the locale-resolved label so the cell matches the map.
    inp.value = navName((state.waypoints[wpIdx].name || '').trim());
    inp.placeholder = S.wpPrefix + (wpIdx + 1);
    inp.oninput = () => {
      state.waypoints[wpIdx].name = inp.value;
      for (const o of wpInputs[wpIdx]) if (o !== inp) o.value = inp.value;
      draw();
    };
    (wpInputs[wpIdx] || (wpInputs[wpIdx] = [])).push(inp);
    td.appendChild(inp);
    return td;
  }
  // Speed / Alt cells are editable number inputs. Commit on `change`
  // (blur / Enter), matching the inspector's number fields.
  function numCell(value, min, onCommit) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'plan-num';
    inp.min = min;
    inp.value = value;
    inp.onchange = () => onCommit(inp);
    td.appendChild(inp);
    return td;
  }
  const altInputs = [];                 // leg index -> altitude input
  const speedInputs = [];               // leg index -> speed input
  const distCells = [];                 // leg index -> distance cell
  const hdgCells = [];                  // leg index -> heading cell
  const timeCells = [];                 // leg index -> time cell
  const fuelCells = [];                 // leg index -> fuel (gal) cell
  let totDistCell, totTimeCell, totFuelCell;
  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    const leg = state.legs[i];
    const { dist, brg } = geo(A, B);
    const tr = document.createElement('tr');
    tr.appendChild(planCell(String(i + 1)));
    tr.appendChild(nameCell(i));
    tr.appendChild(nameCell(i + 1));
    const hdgCell = planCell(pad3(toMagnetic(brg)) + '°M');
    tr.appendChild(hdgCell);
    const distCell = planCell(dist.toFixed(1));
    tr.appendChild(distCell);
    const speedCell = numCell(leg.flightSpeed, 1, inp => {
      const v = +inp.value;
      if (v > 0) {
        const oldVal = leg.flightSpeed;
        leg.flightSpeed = v;
        propagateAlt(i, 'flightSpeed', leg.flightSpeed, oldVal);
        draw();
        refresh();
        if (retRefresh) retRefresh();
      }
      else inp.value = leg.flightSpeed;   // invalid — restore the real value
    });
    speedInputs[i] = speedCell.querySelector('.plan-num');
    tr.appendChild(speedCell);
    const altCell = numCell(leg.inboundAltitude, -2000, inp => {
      const v = +inp.value;
      if (!Number.isFinite(v)) { inp.value = leg.inboundAltitude; return; }
      const oldVal = leg.inboundAltitude;
      leg.inboundAltitude = Math.round(v);
      propagateAlt(i, 'inboundAltitude', leg.inboundAltitude, oldVal);
      draw();
      refresh();
      if (retRefresh) retRefresh();
    });
    altInputs[i] = altCell.querySelector('.plan-num');
    tr.appendChild(altCell);
    const timeCell = planCell('');
    timeCells[i] = timeCell;
    distCells[i] = distCell;
    hdgCells[i] = hdgCell;
    tr.appendChild(timeCell);
    const fuelCell = planCell('');
    fuelCells[i] = fuelCell;
    tr.appendChild(fuelCell);
    // Delete-leg button — removes the "To" waypoint and this leg, then
    // reconnects the route. The refreshFlightPlan callback detects the
    // leg-count change and rebuilds the modal.
    (function (idx) {
      const delTd = document.createElement('td');
      delTd.className = 'fp-del';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = S.fpDel || '✕';
      delBtn.title = S.fpDelTitle || 'Delete leg';
      delBtn.onclick = function () {
        if (state.waypoints.length < 2) return;
        state.waypoints.splice(idx + 1, 1);
        state.legs.splice(idx, 1);
        syncLegs();
        state.selected = null;
        showInspector();
        draw();
        if (refreshFlightPlan) refreshFlightPlan();
      };
      delTd.appendChild(delBtn);
      tr.appendChild(delTd);
    })(i);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  const trF = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.colSpan = 4;
  tdLabel.textContent = S.fpTotal;
  trF.appendChild(tdLabel);
  totDistCell = planCell('');
  trF.appendChild(totDistCell);
  trF.appendChild(planCell(''));        // Speed column
  trF.appendChild(planCell(''));        // Alt column
  totTimeCell = planCell('');
  trF.appendChild(totTimeCell);
  totFuelCell = planCell('');
  trF.appendChild(totFuelCell);
  trF.appendChild(planCell(''));        // Delete column (empty)
  tfoot.appendChild(trF);
  table.appendChild(tfoot);

  function refresh() {
    let td = 0, th = 0, tf = 0;
    const ac = aircraft;
    const taxiFuel = ac && ac.taxiGal && isAirport(state.waypoints[0]) ? ac.taxiGal : 0;
    if (taxiFuel) tf = taxiFuel;
    for (let i = 0; i < state.legs.length; i++) {
      const A = state.waypoints[i], B = state.waypoints[i + 1];
      if (!A || !B) continue;
      const { dist, brg } = geo(A, B);
      distCells[i].textContent = dist.toFixed(1);
      hdgCells[i].textContent = pad3(toMagnetic(brg)) + '°M';
      const dur = state.legs[i].flightSpeed > 0 ? dist / state.legs[i].flightSpeed : 0;
      td += dist;
      th += dur;
      timeCells[i].textContent = dur > 0 ? toHMS(dur) : '--';
      if (ac) {
        const fuel = dur * ac.gph;
        tf += fuel;
        const mark = i === 0 && taxiFuel;
        fuelCells[i].textContent = (mark ? fuel + taxiFuel : fuel).toFixed(1) + (mark ? ' *' : '');
        fuelCells[i].title = mark ? S.fpTaxiTip(taxiFuel) : '';
      } else {
        fuelCells[i].textContent = '--';
        fuelCells[i].title = '';
      }
      if (speedInputs[i] && document.activeElement !== speedInputs[i])
        speedInputs[i].value = state.legs[i].flightSpeed;
      if (altInputs[i] && document.activeElement !== altInputs[i])
        altInputs[i].value = state.legs[i].inboundAltitude;
    }
    for (const wpIdx in wpInputs) {
      const wp = state.waypoints[wpIdx];
      if (!wp) continue;
      const localized = navName((wp.name || '').trim());
      for (const inp of wpInputs[wpIdx]) {
        if (document.activeElement !== inp) inp.value = localized;
      }
    }
    totDistCell.textContent = td.toFixed(1);
    totTimeCell.textContent = th > 0 ? toHMS(th) : '--';
    totFuelCell.textContent = ac ? tf.toFixed(1) : '--';
  }
  refresh();
  scrollArea.appendChild(table);

  // --- return-route table (when showReturn is on) --------------------
  let retRefresh = null;
  if (window.showReturn) {
    const sub = document.createElement('div');
    sub.className = 'flight-plan-sub';
    sub.textContent = S.fpReturn;
    scrollArea.appendChild(sub);

    const rtable = document.createElement('table');
    rtable.className = 'flight-table';
    const rthead = document.createElement('thead');
    const rtrH = document.createElement('tr');
    for (const h of headers) {
      const th = document.createElement('th');
      th.textContent = h;
      rtrH.appendChild(th);
    }
    rthead.appendChild(rtrH);
    rtable.appendChild(rthead);

    const rtbody = document.createElement('tbody');
    const rAltInputs = [];
    const rSpeedInputs = [];
    const rDistCells = [];
    const rHdgCells = [];
    const rTimeCells = [];
    const rFuelCells = [];
    let rTotDistCell, rTotTimeCell, rTotFuelCell;

    for (let i = 0; i < state.legs.length; i++) {
      const ri = state.legs.length - 1 - i;   // reverse leg order — flyable from destination
      const leg = state.legs[ri];
      const A = state.waypoints[ri + 1], B = state.waypoints[ri];
      const { dist, brg } = geo(A, B);
      const tr = document.createElement('tr');
      tr.appendChild(planCell(String(i + 1)));
      tr.appendChild(nameCell(ri + 1));
      tr.appendChild(nameCell(ri));
      const hdgCell = planCell(pad3(toMagnetic(brg)) + '°M');
      tr.appendChild(hdgCell);
      const distCell = planCell(dist.toFixed(1));
      tr.appendChild(distCell);
      const speedCell = numCell(leg.outboundSpeed, 1, inp => {
        const v = +inp.value;
        if (v > 0) {
          const oldVal = leg.outboundSpeed;
          leg.outboundSpeed = v;
          propagateAlt(ri, 'outboundSpeed', leg.outboundSpeed, oldVal);
          draw();
          refresh();
          retRefresh();
        }
        else inp.value = leg.outboundSpeed;
      });
      rSpeedInputs[i] = speedCell.querySelector('.plan-num');
      tr.appendChild(speedCell);
      const altCell = numCell(leg.outboundAltitude, -2000, inp => {
        const v = +inp.value;
        if (!Number.isFinite(v)) { inp.value = leg.outboundAltitude; return; }
        const oldVal = leg.outboundAltitude;
        leg.outboundAltitude = Math.round(v);
        propagateAlt(ri, 'outboundAltitude', leg.outboundAltitude, oldVal);
        draw();
        refresh();
        retRefresh();
      });
      rAltInputs[i] = altCell.querySelector('.plan-num');
      tr.appendChild(altCell);
      const timeCell = planCell('');
      rTimeCells[i] = timeCell;
      rDistCells[i] = distCell;
      rHdgCells[i] = hdgCell;
      tr.appendChild(timeCell);
      const fuelCell = planCell('');
      rFuelCells[i] = fuelCell;
      tr.appendChild(fuelCell);
      rtbody.appendChild(tr);
    }
    rtable.appendChild(rtbody);

    const rtfoot = document.createElement('tfoot');
    const rtrF = document.createElement('tr');
    const rtdLabel = document.createElement('td');
    rtdLabel.colSpan = 4;
    rtdLabel.textContent = S.fpTotal;
    rtrF.appendChild(rtdLabel);
    rTotDistCell = planCell('');
    rtrF.appendChild(rTotDistCell);
    rtrF.appendChild(planCell(''));
    rtrF.appendChild(planCell(''));
    rTotTimeCell = planCell('');
    rtrF.appendChild(rTotTimeCell);
    rTotFuelCell = planCell('');
    rtrF.appendChild(rTotFuelCell);
    rtrF.appendChild(planCell(''));        // Delete column (empty)
    rtfoot.appendChild(rtrF);
    rtable.appendChild(rtfoot);


    retRefresh = function () {
      if (state.legs.length !== rDistCells.length) { closeFlightPlan(); return; }
      let td = 0, th = 0, tf = 0;
      const retTaxi = aircraft && aircraft.taxiGal && isAirport(state.waypoints[state.waypoints.length - 1]) ? aircraft.taxiGal : 0;
      if (retTaxi) tf = retTaxi;
      for (let i = 0; i < state.legs.length; i++) {
        const ri = state.legs.length - 1 - i;
        const A = state.waypoints[ri + 1], B = state.waypoints[ri];
        if (!A || !B) continue;
        const { dist, brg } = geo(A, B);
        rDistCells[i].textContent = dist.toFixed(1);
        rHdgCells[i].textContent = pad3(toMagnetic(brg)) + '°M';
        const dur = state.legs[ri].outboundSpeed > 0 ? dist / state.legs[ri].outboundSpeed : 0;
        td += dist;
        th += dur;
        rTimeCells[i].textContent = dur > 0 ? toHMS(dur) : '--';
        if (aircraft) {
          const fuel = dur * aircraft.gph;
          tf += fuel;
          const mark = i === 0 && retTaxi;
          rFuelCells[i].textContent = (mark ? fuel + retTaxi : fuel).toFixed(1) + (mark ? ' *' : '');
          rFuelCells[i].title = mark ? S.fpTaxiTip(retTaxi) : '';
        } else {
          rFuelCells[i].textContent = '--';
          rFuelCells[i].title = '';
        }
        if (rSpeedInputs[i] && document.activeElement !== rSpeedInputs[i])
          rSpeedInputs[i].value = state.legs[ri].outboundSpeed;
        if (rAltInputs[i] && document.activeElement !== rAltInputs[i])
          rAltInputs[i].value = state.legs[ri].outboundAltitude;
      }
      rTotDistCell.textContent = td.toFixed(1);
      rTotTimeCell.textContent = th > 0 ? toHMS(th) : '--';
      rTotFuelCell.textContent = aircraft ? tf.toFixed(1) : '--';
    };
    retRefresh();
    scrollArea.appendChild(rtable);
  }

  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const printBtn = document.createElement('button');
  printBtn.textContent = S.fpPrint;
  printBtn.onclick = () => {
    const cleanup = () => {
      document.body.classList.remove('printing-plan');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    document.body.classList.add('printing-plan');
    window.print();
    setTimeout(cleanup, 4000);           // belt-and-braces for Safari
  };
  btns.appendChild(printBtn);
  box.appendChild(btns);
  addModalCloseX(box, closeFlightPlan);

  back.appendChild(box);
  // Close via the Close button or Escape (#86).
  document.body.appendChild(back);
  flightPlanBack = back;
  // #78: keep the modal in sync with the live route. draw() calls this after
  // each redraw so dragging a waypoint or reversing the route updates dist /
  // hdg / time / total. A leg-count change (delete wp, import, clear) tears
  // the modal down and re-opens it on the next tick so input handlers rebind
  // against the new leg array (the old fix just closed it — the rebuild is a
  // strictly better UX so the pilot doesn't lose the plan view on edits).
  refreshFlightPlan = retRefresh
    ? function () {
        if (state.legs.length !== distCells.length) {
          closeFlightPlan();
          setTimeout(showFlightPlan, 0);
          return;
        }
        refresh();
        retRefresh();
      }
    : function () {
        if (state.legs.length !== distCells.length) {
          closeFlightPlan();
          setTimeout(showFlightPlan, 0);
          return;
        }
        refresh();
      };
  flightPlanEscape = function (e) {
    if (e.key === 'Escape') closeFlightPlan();
  };
  document.addEventListener('keydown', flightPlanEscape);
  fpOpen = true;
  // navaid.fpOpen is already cleared by closeFlightPlan(); on a fresh open
  // there's nothing to remove. The redundant call lived here for a while —
  // dropping it to keep showFlightPlan() side-effect-symmetric.
}

function planCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

// Modal: pick Landscape or Portrait (named buttons, not OK/Cancel).
function chooseOrientation(size, onPick) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = size + S.pageOrientation;
  addModalCloseX(box, () => { document.removeEventListener('keydown', onEsc); back.remove(); });
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  // #86: Escape closes the picker (counts as cancel).
  function onEsc(e) { if (e.key === 'Escape') close(); }
  function close() {
    document.removeEventListener('keydown', onEsc);
    back.remove();
  }
  for (const [label, val] of [[S.landscape, 'landscape'], [S.portrait, 'portrait']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { close(); onPick(val); };
    btns.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.textContent = S.cancel;
  cancel.className = 'modal-cancel';
  cancel.onclick = close;
  btns.appendChild(cancel);
  box.append(title, btns);
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) close(); };
  document.body.appendChild(back);
  document.addEventListener('keydown', onEsc);
}

// Timestamp for unique download names — avoids browser " (1)" suffixes.
function fileStamp() {
  return new Date().toISOString().slice(0, 19)
    .replace(/[-:]/g, '').replace('T', '-');
}

// Show a pre-export modal so the user can decide which overlays and base
// layer appear in the PNG, independently of the current screen settings.
function showExportModal() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.exportModalTitle;
  box.appendChild(title);

  addModalCloseX(box, () => { restoreOrig(); close(); });

  // Drag to reposition the modal via the title bar.
  let drag = null;
  title.addEventListener('mousedown', function (e) {
    const r = box.getBoundingClientRect();
    drag = { ox: e.clientX - r.left, oy: e.clientY - r.top };
    box.style.position = 'fixed';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.margin = '0';
    const onMove = function (e) {
      if (!drag) return;
      // Clamp to the viewport so the title bar + ✕ stay reachable. Same
      // pattern the flight-plan modal already uses.
      const x = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, e.clientX - drag.ox));
      const y = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, e.clientY - drag.oy));
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    };
    const onUp = function () {
      drag = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:4px 0';

  // Show Waypoint Names checkbox (default on).
  const wpNameLabel = document.createElement('label');
  wpNameLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  const wpNameCb = document.createElement('input');
  wpNameCb.type = 'checkbox';
  wpNameCb.checked = true;
  wpNameLabel.appendChild(wpNameCb);
  wpNameLabel.appendChild(document.createTextNode(S.exportShowWpNames));
  body.appendChild(wpNameLabel);

  // Show Drift Lines checkbox (default on).
  const driftLabel = document.createElement('label');
  driftLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  const driftCb = document.createElement('input');
  driftCb.type = 'checkbox';
  driftCb.checked = true;
  driftLabel.appendChild(driftCb);
  driftLabel.appendChild(document.createTextNode(S.exportShowDrift));
  body.appendChild(driftLabel);

  // Show Nav Waypoints checkbox.
  const navWpLabel = document.createElement('label');
  navWpLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  const navWpCb = document.createElement('input');
  navWpCb.type = 'checkbox';
  navWpCb.checked = false;
  navWpLabel.appendChild(navWpCb);
  navWpLabel.appendChild(document.createTextNode(S.exportShowNavWP));
  body.appendChild(navWpLabel);

  // Show Airfields checkbox.
  const afLabel = document.createElement('label');
  afLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer';
  const afCb = document.createElement('input');
  afCb.type = 'checkbox';
  afCb.checked = false;
  afLabel.appendChild(afCb);
  afLabel.appendChild(document.createTextNode(S.exportShowAirfields));
  body.appendChild(afLabel);

  // Layer selector.
  const layerRow = document.createElement('div');
  layerRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px';
  const layerLbl = document.createElement('span');
  layerLbl.textContent = S.exportLayer;
  layerRow.appendChild(layerLbl);
  const layerSel = document.createElement('select');
  layerSel.style.cssText = 'font:inherit;font-size:12px;flex:1';
  for (const name in layers) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = (S.layerLabels && S.layerLabels[name]) || name;
    if (name === 'Navigation') opt.selected = true;
    layerSel.appendChild(opt);
  }
  layerRow.appendChild(layerSel);
  body.appendChild(layerRow);

  // Map opacity slider.
  const opacityRow = document.createElement('div');
  opacityRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px';
  const opLbl = document.createElement('span');
  opLbl.textContent = S.tbMapOpacity;
  opacityRow.appendChild(opLbl);
  const opSlider = document.createElement('input');
  opSlider.type = 'range';
  opSlider.min = '10';
  opSlider.max = '100';
  opSlider.value = Math.round(mapOpacity * 100);
  opSlider.style.cssText = 'flex:1;height:16px;accent-color:#ffd966';
  opacityRow.appendChild(opSlider);
  const opVal = document.createElement('span');
  opVal.style.cssText = 'width:2.2em;text-align:right;font-size:12px';
  opVal.textContent = opSlider.value + '%';
  opacityRow.appendChild(opVal);
  body.appendChild(opacityRow);

  // Page-size warning.
  const pageWarn = document.createElement('div');
  pageWarn.style.cssText = 'font-size:12px;color:#e8b84b;padding:2px 0';
  if (!pageSize) {
    pageWarn.textContent = S.exportNoPageWarn;
    pageWarn.classList.add('blink-warn');
  }
  body.appendChild(pageWarn);

  box.appendChild(body);

  // Save original state (before applying defaults) so Cancel can restore.
  const origNavWP = showNavWP;
  const origAirfields = showAirfields;
  const origWpNames = showWpNames;
  const origDrift = showDrift;
  const origMapOpacity = mapOpacity;
  const origLayer = (function () {
    for (const n in layers) if (map.hasLayer(layers[n])) return n;
    return null;
  })();

  // Apply the modal's default state immediately so the user sees what
  // the PNG will look like before touching any control.
  showNavWP = navWpCb.checked;
  showWpNames = wpNameCb.checked;
  showDrift = driftCb.checked;
  showAirfields = afCb.checked;
  const chosen = layerSel.value;
  if (chosen !== origLayer) {
    for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
    map.addLayer(layers[chosen]);
  }
  draw();

  // Buttons.
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const exportBtn = document.createElement('button');
  exportBtn.textContent = S.exportBtn;
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = S.cancel;
  cancelBtn.className = 'modal-cancel';

  function restoreOrig() {
    showNavWP = origNavWP;
    showWpNames = origWpNames;
    showDrift = origDrift;
    showAirfields = origAirfields;
    const cur = (function () {
      for (const n in layers) if (map.hasLayer(layers[n])) return n;
      return null;
    })();
    if (cur !== origLayer) {
      for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
      if (origLayer) map.addLayer(layers[origLayer]);
    }
    mapOpacity = origMapOpacity;
    applyMapOpacity();
    draw();
  }

  // Live preview: apply changes to the map immediately.
  navWpCb.onchange = function () {
    showNavWP = navWpCb.checked;
    draw();
  };
  wpNameCb.onchange = function () {
    showWpNames = wpNameCb.checked;
    draw();
  };
  driftCb.onchange = function () {
    showDrift = driftCb.checked;
    draw();
  };
  afCb.onchange = function () {
    showAirfields = afCb.checked;
    draw();
  };
  layerSel.onchange = function () {
    const chosen = layerSel.value;
    for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]);
    map.addLayer(layers[chosen]);
    applyMapOpacity();
  };

  opSlider.oninput = function () {
    mapOpacity = parseFloat(this.value) / 100;
    opVal.textContent = this.value + '%';
    applyMapOpacity();
  };

  function close() { window.removeEventListener('keydown', onEsc); back.remove(); }
  function onEsc(e) { if (e.key === 'Escape') { restoreOrig(); close(); } }

  exportBtn.onclick = () => {
    NavAid._restoreExport = restoreOrig;
    close();
    exportPNG();
  };
  cancelBtn.onclick = function () {
    restoreOrig();
    close();
  };

  btns.appendChild(exportBtn);
  btns.appendChild(cancelBtn);
  box.appendChild(btns);

  back.appendChild(box);
  back.onclick = e => { if (e.target === back) close(); };
  document.body.appendChild(back);
  document.addEventListener('keydown', onEsc);
}

// Save the framed map + route as a PNG, rendered at the highest practical
// native tile zoom (not the on-screen zoom) for maximum quality. flight-maps
// tiles are not CORS-enabled, so each tile is fetched through the weserv image
// proxy (which adds Access-Control-Allow-Origin) to keep the canvas untainted.
function exportPNG() {
  // Export matches the screen view exactly, including map bearing.
  // Tiles are fetched north-up (axis-aligned) for a bounding box that covers
  // all 4 frame corners, composited onto an intermediate canvas, then drawn
  // onto the output canvas with the bearing rotation applied.  The route
  // overlay uses normal screen coords (which already encode bearing via
  // latLngToContainerPoint) so the same scale/translate works for any bearing.
  NavAid.exporting = true;
  const exportBearing = map.getBearing ? map.getBearing() : 0;

  const framed = !!pageFrameRect();
  const fr = pageFrameRect() || { x: 0, y: 0, w: vw(), h: vh() };
  if (fr.w < 4 || fr.h < 4) { NavAid.exporting = false; return; }

  let base = null, baseName = 'map';
  for (const n in layers) {
    if (map.hasLayer(layers[n])) { base = layers[n]; baseName = n; }
  }
  if (!base || !base._url) { NavAid.exporting = false; return; }

  // Lock map interaction for the duration of the async tile fetch.  The
  // route overlay is composited using live proj() after the awaited tiles
  // resolve; if the user panned / zoomed / rotated during "Saving…", the
  // overlay would drift relative to the captured tile bounding box and the
  // saved PNG would be misaligned (issue #74). Remember each handler's
  // pre-export state so we restore exactly what the user had.
  const _handlers = ['dragging', 'scrollWheelZoom', 'doubleClickZoom',
                     'touchZoom', 'boxZoom', 'keyboard', 'touchRotate'];
  const _handlerWas = {};
  for (const h of _handlers) {
    if (map[h] && typeof map[h].enabled === 'function' && map[h].enabled()) {
      _handlerWas[h] = true;
      map[h].disable();
    }
  }
  // The rotate dial is a Leaflet control that calls map.setBearing directly,
  // so the handlers above don't cover it — block pointer events too.
  const _rotEl = document.querySelector('.rotate-ctrl');
  const _prevRotPE = _rotEl ? _rotEl.style.pointerEvents : '';
  if (_rotEl) _rotEl.style.pointerEvents = 'none';
  function unlockMap() {
    for (const h in _handlerWas) map[h].enable();
    if (_rotEl) _rotEl.style.pointerEvents = _prevRotPE;
  }

  // Geographic centre of the frame (stays constant regardless of bearing).
  const frameCenterLL = map.containerPointToLatLng([fr.x + fr.w / 2, fr.y + fr.h / 2]);

  // All 4 frame corners → axis-aligned lat/lng bounding box for tile fetching.
  const c0 = map.containerPointToLatLng([fr.x,          fr.y         ]);
  const c1 = map.containerPointToLatLng([fr.x + fr.w,   fr.y         ]);
  const c2 = map.containerPointToLatLng([fr.x + fr.w,   fr.y + fr.h  ]);
  const c3 = map.containerPointToLatLng([fr.x,          fr.y + fr.h  ]);
  const bbNWll = { lat: Math.max(c0.lat, c1.lat, c2.lat, c3.lat),
                   lng: Math.min(c0.lng, c1.lng, c2.lng, c3.lng) };
  const bbSEll = { lat: Math.min(c0.lat, c1.lat, c2.lat, c3.lat),
                   lng: Math.max(c0.lng, c1.lng, c2.lng, c3.lng) };

  // Choose a starting tile zoom.  Framed exports (A3 / A4) target maximum
  // print quality at the layer's max native zoom.  Without a frame the export
  // covers the entire viewport; rendering that at max native zoom can balloon
  // into hundreds of tiles, and the weserv image proxy rate-limits enough of
  // them that the result has blank patches.  Mirror the on-screen tile zoom
  // instead so the export matches what the user sees and the tile count stays
  // bounded by the viewport size.
  const nativeMax = base.options.maxNativeZoom || base.options.maxZoom || 13;
  const maxZ = framed
    ? nativeMax
    : Math.min(nativeMax, Math.max(7, Math.round(map.getZoom())));

  // Zoom down until the bounding box fits in one canvas AND the parallel tile
  // count stays within what the proxy will reliably serve.  ~300 tiles ≈ a
  // 17×17 grid which the weserv proxy handles without dropping requests; the
  // floor of 7 keeps even very large rotated frames under the cap.
  const MAX_TILES = 300;
  let z = maxZ, bbNWP, bbSEP, Wbb, Hbb;
  for (z = maxZ; z >= 7; z--) {
    bbNWP = map.project([bbNWll.lat, bbNWll.lng], z);
    bbSEP = map.project([bbSEll.lat, bbSEll.lng], z);
    Wbb = Math.round(bbSEP.x - bbNWP.x);
    Hbb = Math.round(bbSEP.y - bbNWP.y);
    const tiles = Math.ceil(Wbb / 256) * Math.ceil(Hbb / 256);
    if (Wbb <= 10000 && Hbb <= 10000 && tiles <= MAX_TILES) break;
  }

  // Output canvas: same physical size as the frame at the chosen tile zoom.
  const tilePerScreen = Math.pow(2, z - map.getZoom());
  const W = Math.round(fr.w * tilePerScreen);
  const H = Math.round(fr.h * tilePerScreen);

  // Intermediate canvas: north-up tile composite covering the bounding box.
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width  = Wbb;
  tileCanvas.height = Hbb;
  const tc = tileCanvas.getContext('2d');
  tc.fillStyle = '#231F20';
  tc.fillRect(0, 0, Wbb, Hbb);

  const out = document.createElement('canvas');
  out.width  = W;
  out.height = H;
  const o = out.getContext('2d');
  o.fillStyle = '#231F20';
  o.fillRect(0, 0, W, H);

  const btn = document.getElementById('print');
  const btnLabel = btn.textContent;
  btn.textContent = S.saving;
  btn.disabled = true;

  // Gather the covering tiles. CORS-capable layers (OSM, Esri) are fetched
  // directly; flight-maps.com tiles need the weserv proxy to add CORS headers.
  const subs = base.options.subdomains || 'abc';
  const corsOk = base.options.corsOk;

  // Clip the tile grid to the chart's published coverage when the layer
  // declares one (flight-maps.com layers only cover Israel + adjacent VFR
  // airspace).  Tiles outside that box return 404, which used to be reported
  // as "X of Y map tiles failed to load" even though they are expected blanks
  // outside the chart.  Areas outside chartBounds simply stay as the dark
  // canvas background, which matches what the user sees on screen.
  let txMin = Math.floor(bbNWP.x / 256);
  let txMax = Math.floor(bbSEP.x / 256);
  let tyMin = Math.floor(bbNWP.y / 256);
  let tyMax = Math.floor(bbSEP.y / 256);
  const cb = base.options.chartBounds;
  if (cb) {
    const cbNW = map.project([cb.north, cb.west], z);
    const cbSE = map.project([cb.south, cb.east], z);
    txMin = Math.max(txMin, Math.floor(cbNW.x / 256));
    txMax = Math.min(txMax, Math.floor(cbSE.x / 256));
    tyMin = Math.max(tyMin, Math.floor(cbNW.y / 256));
    tyMax = Math.min(tyMax, Math.floor(cbSE.y / 256));
  }
  // Fetch each tile first so we can distinguish HTTP 404 (expected outside the
  // chart's published coverage — e.g. flight-maps.com 404s on tiles outside
  // Israel and adjacent VFR airspace) from real failures (network, CORS, 5xx,
  // decode).  Only the latter count toward the "X of Y tiles failed" alert; a
  // 404 just leaves the dark canvas backdrop showing in that area, matching
  // what the user already sees on screen.
  const jobs = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const url = L.Util.template(base._url,
        { z, x: tx, y: ty, s: subs[(tx + ty) % subs.length] });
      const fetchUrl = corsOk ? url
        : 'https://images.weserv.nl/?url=' +
          encodeURIComponent(url.replace(/^https?:\/\//, ''));
      const job = {
        dx: Math.round(tx * 256 - bbNWP.x),
        dy: Math.round(ty * 256 - bbNWP.y),
        bmp: null,
        failed: false,
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      job.done = fetch(fetchUrl, { signal: ctrl.signal })
        .then(r => {
          if (r.status === 404) return null;        // expected blank tile
          if (!r.ok) { job.failed = true; return null; }
          return r.blob().then(b => createImageBitmap(b));
        })
        .then(bmp => { job.bmp = bmp; })
        .catch(() => { job.failed = true; })
        .then(() => clearTimeout(timer));
      jobs.push(job);
    }
  }

  Promise.all(jobs.map(j => j.done)).then(() => {
    let failed = 0;
    for (const j of jobs) {
      if (j.bmp) {
        try { tc.drawImage(j.bmp, j.dx, j.dy, 256, 256); }
        catch (e) { failed++; }
      } else if (j.failed) {
        failed++;
      }
    }

    // Draw the tile canvas onto the output, rotated by the map bearing so the
    // result matches the screen view.  The frame centre in tile-canvas space
    // maps to the output centre; rotation is clockwise by exportBearing.
    // globalAlpha honours the Map-opacity slider so dim tiles on screen also
    // export dim; overlays drawn after restore() stay at full alpha.
    const fcP = map.project([frameCenterLL.lat, frameCenterLL.lng], z);
    const fcx = fcP.x - bbNWP.x;
    const fcy = fcP.y - bbNWP.y;
    o.save();
    o.translate(W / 2, H / 2);
    o.rotate(exportBearing * Math.PI / 180);
    o.translate(-fcx, -fcy);
    o.globalAlpha = (typeof mapOpacity === 'number') ? mapOpacity : 1;
    o.drawImage(tileCanvas, 0, 0);
    o.restore();

    // Route overlay: screen coords already encode bearing, so the standard
    // scale/translate maps them correctly onto the rotated tile output.
    const s = W / fr.w;
    const prevOctx = octx;
    octx = o;
    o.save();
    o.scale(s, s);
    o.translate(-fr.x, -fr.y);
    try {
      drawNavWaypoints();
      drawAirfields();
      drawLegs();
      drawWaypoints();
      drawNotes();
      o.restore();
    } finally {
      octx = prevOctx;
    }

    out.toBlob(b => {
      btn.textContent = btnLabel;
      btn.disabled = false;
      unlockMap();
      NavAid.exporting = false;
      if (typeof NavAid._restoreExport === 'function') NavAid._restoreExport();
      if (!b) { alert(S.errPngFail); return; }

      // Embed physical DPI metadata so the PNG prints at the correct
      // physical size on A3 / A4 at 1:250,000 scale.
      const setDl = function (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'navigation-' + (pageSize || baseName) +
                     '-' + fileStamp() + '.png';
        a.click();
        URL.revokeObjectURL(a.href);
      };
      if (framed && pageSize) {
        const mm = pageSize === 'A4' ? [210, 297] : [297, 420];
        const paperW = pageOrient === 'portrait' ? mm[0] : mm[1];
        const paperH = pageOrient === 'portrait' ? mm[1] : mm[0];
        const ppmX = Math.round(W * 1000 / paperW);
        const ppmY = Math.round(H * 1000 / paperH);
        b.arrayBuffer().then(buf => {
          setDl(new Blob([injectPngPhys(buf, ppmX, ppmY)], { type: 'image/png' }));
        }).catch(function () { setDl(b); });
      } else {
        setDl(b);
      }
      if (failed > 0) alert(S.errTilesFail(failed, jobs.length));
    }, 'image/png');
  }).catch(err => {
    // #215: a sync throw in the .then body (e.g. drawImage on a malformed
    // bitmap) would otherwise leave the button disabled forever. Restore
    // the UI so the user can retry, and surface the failure.
    console.warn('PNG export pipeline failed:', err);
    btn.textContent = btnLabel;
    btn.disabled = false;
    unlockMap();
    NavAid.exporting = false;
    if (typeof NavAid._restoreExport === 'function') NavAid._restoreExport();
    try { alert(S.errPngFail); } catch (_) { /* alert blocked */ }
  });
}

// Inject a pHYs (physical pixel dimensions) chunk into a PNG blob so that
// the image prints at the intended physical size when the print dialog uses
// the embedded DPI rather than scaling to fit the page.
function injectPngPhys(buf, ppmX, ppmY) {
  // PNG format: 8-byte signature, then a series of chunks.
  // Each chunk: 4 bytes length (big-endian), 4 bytes type, data, 4 bytes CRC.
  // The first chunk is always IHDR (13 bytes data).  pHYs must follow IHDR.
  const view = new DataView(buf);
  const ihdrLen = view.getUint32(8);                    // should be 13
  const ihdrStart = 12;                                  // after length field
  const type = String.fromCharCode(view.getUint8(ihdrStart), view.getUint8(ihdrStart + 1),
                                    view.getUint8(ihdrStart + 2), view.getUint8(ihdrStart + 3));
  if (type !== 'IHDR') return buf;                      // not a valid PNG
  const insOff = ihdrStart + 4 + ihdrLen + 4;            // after IHDR data + CRC

  // Build pHYs chunk (9 bytes data).
  const physData = new ArrayBuffer(9);
  const pv = new DataView(physData);
  pv.setUint32(0, ppmX);
  pv.setUint32(4, ppmY);
  pv.setUint8(8, 1);                                     // unit = metre

  // CRC covers type + data.
  const crcBytes = new Uint8Array(4 + 9);
  crcBytes[0] = 112; crcBytes[1] = 72; crcBytes[2] = 89; crcBytes[3] = 115; // "pHYs"
  crcBytes.set(new Uint8Array(physData), 4);
  const crc = pngCrc(crcBytes);

  const chunk = new ArrayBuffer(21);                     // 4 len + 4 type + 9 data + 4 crc
  const cv = new DataView(chunk);
  cv.setUint32(0, 9);                                    // data length
  cv.setUint32(4, 0x70485973);                            // "pHYs"
  new Uint8Array(chunk, 8, 9).set(new Uint8Array(physData));
  cv.setUint32(17, crc);                                  // CRC at byte 17 (after 8+9)

  // Splice the pHYs chunk after IHDR.
  const out = new Uint8Array(buf.byteLength + 21);
  out.set(new Uint8Array(buf, 0, insOff), 0);
  out.set(new Uint8Array(chunk), insOff);
  out.set(new Uint8Array(buf, insOff), insOff + 21);
  return out.buffer;
}

// CRC-32 for PNG (IEEE polynomial, init 0xFFFFFFFF, final XOR 0xFFFFFFFF).
const PNG_CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function pngCrc(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = PNG_CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// --- fly the route (Google Earth) -----------------------------------
function flyRoute() {
  if (state.waypoints.length < 2) {
    alert(S.errNeedWps);
    return;
  }
  const wps = state.waypoints;
  const altM = i => {
    const leg = state.legs[Math.min(i, state.legs.length - 1)];
    return Math.max(0, Math.round((leg ? leg.inboundAltitude : 2000) * 0.3048));
  };
  const heading = i => {
    const j = Math.min(i, wps.length - 2);
    return geo(wps[j], wps[j + 1]).brg;
  };

  function downloadKml() {
    const esc = s => String(s).replace(/[<>&]/g,
      c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const camera = (i, pad) =>
      pad + '<Camera>\n' +
      pad + '  <longitude>' + wps[i].lng + '</longitude>\n' +
      pad + '  <latitude>' + wps[i].lat + '</latitude>\n' +
      pad + '  <altitude>' + altM(i) + '</altitude>\n' +
      pad + '  <heading>' + heading(i).toFixed(1) + '</heading>\n' +
      pad + '  <tilt>70</tilt>\n' +
      pad + '  <roll>0</roll>\n' +
      pad + '  <altitudeMode>absolute</altitudeMode>\n' +
      pad + '</Camera>\n';
    const flyTo = (i, dur, mode) =>
      '    <gx:FlyTo>\n' +
      '      <gx:duration>' + dur.toFixed(1) + '</gx:duration>\n' +
      '      <gx:flyToMode>' + mode + '</gx:flyToMode>\n' +
      camera(i, '      ') +
      '    </gx:FlyTo>\n';
    let tour = flyTo(0, 4, 'bounce');
    for (let i = 1; i < wps.length; i++) {
      const leg = state.legs[i - 1];
      const { dist } = geo(wps[i - 1], wps[i]);
      const durH = leg && leg.flightSpeed > 0 ? dist / leg.flightSpeed : 0;
      tour += flyTo(i, Math.max(4, Math.min(45, durH * 60 * 4)), 'smooth');
    }
    const coords = wps.map(w => w.lng + ',' + w.lat + ',0').join(' ');
    const points = wps.map((w, i) =>
      '  <Placemark><name>' + esc(wpLabel(i)) + '</name>' +
      '<Point><coordinates>' + w.lng + ',' + w.lat + ',0</coordinates></Point>' +
      '</Placemark>').join('\n');
    const kml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<kml xmlns="http://www.opengis.net/kml/2.2" ' +
      'xmlns:gx="http://www.google.com/kml/ext/2.2">\n<Document>\n' +
      '  <name>' + S.kmlDocName + '</name>\n' +
      camera(0, '  ') +
      '  <Placemark><name>' + S.kmlRouteName + '</name>\n' +
      '    <Style><LineStyle><color>ff3399ff</color><width>3</width></LineStyle></Style>\n' +
      '    <LineString><tessellate>1</tessellate>\n' +
      '      <coordinates>' + coords + '</coordinates>\n' +
      '    </LineString>\n  </Placemark>\n' + points + '\n' +
      '  <gx:Tour><name>' + S.kmlTourName + '</name>\n    <gx:Playlist>\n' +
      tour + '    </gx:Playlist>\n  </gx:Tour>\n' +
      '</Document>\n</kml>\n';
    const blob = new Blob([kml],
      { type: 'application/vnd.google-earth.kml+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'navaid-flythrough-' + fileStamp() + '.kml';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onPick(mode) {
    if (mode === 'web') {
      if (!confirm(S.geWebConfirm)) return;
      // #145: validate the first waypoint's coords before string-concat so a
      // malformed lat/lng (e.g. from a tampered import) can't leak into the
      // URL. heading()/altM() are already bounded numerics by construction.
      const lat = Number(wps[0].lat), lng = Number(wps[0].lng);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lng) || lng < -180 || lng > 180) {
        alert(S.errBadCoords);
        return;
      }
      const url = 'https://earth.google.com/web/@' +
        lat.toFixed(6) + ',' + lng.toFixed(6) + ',' + altM(0) + 'a,' +
        heading(0).toFixed(1) + 'h,70t';
      window.open(url, '_blank');
      downloadKml();
      return;
    }

    if (!confirm(S.flyConfirm)) return;
    downloadKml();
  }

  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.chooseGeMode;
  addModalCloseX(box, () => { document.removeEventListener('keydown', onEsc); back.remove(); });
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  function onEsc(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); back.remove(); } }
  function close() { document.removeEventListener('keydown', onEsc); back.remove(); }
  for (const [label, mode] of [[S.geModeWeb, 'web'], [S.geModeApp, 'app']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { close(); onPick(mode); };
    btns.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.textContent = S.cancel;
  cancel.className = 'modal-cancel';
  cancel.onclick = close;
  btns.appendChild(cancel);
  box.append(title, btns);
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) close(); };
  document.body.appendChild(back);
  document.addEventListener('keydown', onEsc);
}

// --- route persistence ----------------------------------------------
const STORE_KEY = 'navaid.route';
let persistTimer = null;
let quotaWarned = false;                // #80: stop scheduling after a quota fail
function persist() {
  // When boot detected a corrupt saved blob (issue #73), refuse to overwrite
  // it with the empty in-memory state — that's silent data loss. Once the
  // user adds a waypoint / note the state is no longer empty and the normal
  // save path resumes, replacing the corrupt blob with their new work.
  if (NavAid.corruptCache &&
      state.waypoints.length === 0 &&
      state.legs.length === 0 &&
      state.notes.length === 0) return;
  if (persistTimer || quotaWarned) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      // center / zoom are not restored (load fits the route) — not saved.
      localStorage.setItem(STORE_KEY, JSON.stringify({
        waypoints: state.waypoints,
        legs: state.legs,
        notes: state.notes,
      }));
    } catch (e) {
      // #80: a full quota used to fail silently. Surface it once so the
      // user knows to export the route; other storage-unavailable errors
      // (private mode, disabled storage) stay silent as before.
      if (e && (e.name === 'QuotaExceededError' || e.code === 22 ||
                e.code === 1014 /* NS_ERROR_DOM_QUOTA_REACHED */)) {
        quotaWarned = true;
        try { alert(S.errStorageFull); } catch (_) { /* alert blocked */ }
      }
    }
  }, 500);
}
// Returns one of:
//   true       — saved route restored into state.
//   false      — no saved route (clean first-time boot, safe to persist).
//   'corrupt'  — a saved blob exists but is unparseable or has bad coords;
//                state is left empty and the blob is preserved on disk so
//                the user can copy it out (issue #73).
function restoreRoute() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch (e) {
    return false;                         // storage unavailable
  }
  if (!raw) return false;
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    NavAid.corruptCacheError = e.message;
    return 'corrupt';                     // bad JSON — preserve raw blob (#73)
  }
  // Strict schema check — issue #101. Legacy saved blobs lacking a newer
  // field (e.g. notes added later) will fail here. The caller treats
  // 'corrupt' as the preserve-on-failure path from #73: the raw blob is
  // left untouched in localStorage and the boot continues with empty
  // state, so no user work is lost (they can hand-edit / re-import).
  const verr = validateRoute(d);
  if (verr !== null) {
    NavAid.corruptCacheError = verr;
    return 'corrupt';
  }
  state.waypoints = d.waypoints.map(w => ({
    lat: r5(w.lat), lng: r5(w.lng), name: w.name,
  }));
  state.legs = d.legs.map(l => {
    const inL  = { a: l.inLabel.a,  p: l.inLabel.p  };
    const outL = { a: l.outLabel.a, p: l.outLabel.p };
    // #393 — normalise inLabel/outLabel offsets to zoom-12 reference so they
    // scale proportionally with zoom. Old (pre-#393) blobs lack _m and hold
    // raw pixel offsets.
    if (!l.inLabel._m) {
      // Divide by legArrowSize to normalise to zoom-12 reference.
      // legZoomScale(12) = 1 * legArrowSize, so isc = 1 / legArrowSize.
      // This keeps the marker at the same position at zoom 12; at other
      // zooms it scales proportionally.
      inL.a /= legArrowSize;  inL.p /= legArrowSize;
      outL.a /= legArrowSize; outL.p /= legArrowSize;
    }
    inL._m = outL._m = 1;  // always flag as migrated so migration never re-runs
    return {
      inboundAltitude: l.inboundAltitude,
      outboundAltitude: l.outboundAltitude,
      flightSpeed: l.flightSpeed,
      outboundSpeed: l.outboundSpeed != null ? l.outboundSpeed : l.flightSpeed,
      inLabel: inL, outLabel: outL,
    };
  });
  state.notes = d.notes.map(n => ({
    lat: r5(n.lat), lng: r5(n.lng),
    text: n.text, color: n.color, shape: n.shape,
  }));
  syncLegs();
  return true;
}

// --- Airfield plates viewer (#105) -----------------------------------
const PLATE_BASE = 'byop/';

function plateUrl(filename) {
  return PLATE_BASE + encodeURIComponent(filename);
}

function plateCategory(filename) {
  const rest = filename.replace(/^[A-Z]{4}_/, '');
  const cat = rest.split('_')[0];
  if (cat === 'APPROACH') return 'approach';
  if (cat === 'SID') return 'sid';
  if (cat === 'STAR') return 'star';
  if (cat === 'Ground' || cat === 'parking') return 'ground';
  if (cat === 'VAC' || cat === 'airport') return 'vfr';
  return 'other';
}

function prettyPlateLabel(filename) {
  const noIcao = filename.replace(/^[A-Z]{4}_/, '').replace(/\.pdf$/i, '');
  return noIcao.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function showPlateViewer(filename, label) {
  const back = document.createElement('div');
  back.className = 'modal-back plate-viewer';
  const box = document.createElement('div');
  box.className = 'modal plate-viewer-box';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = label;
  box.appendChild(title);

  const iframe = document.createElement('iframe');
  iframe.className = 'plate-iframe';
  const url = plateUrl(filename);

  const loading = document.createElement('div');
  loading.className = 'plate-loading';
  loading.textContent = 'Loading...\n' + url;

  let blobUrl = null;
  let pdfReady = false;

  iframe.onload = () => { if (pdfReady) loading.style.display = 'none'; };
  iframe.onerror = () => {
    loading.textContent = S.plateLoadError + '\n' + url;
  };

  fetch(url, { credentials: 'omit' })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    })
    .then(blob => {
      blobUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      pdfReady = true;
      iframe.src = blobUrl + '#view=FitH';
    })
    .catch(() => {
      loading.textContent = S.plateLoadError + '\n' + url;
    });

  box.appendChild(loading);
  box.appendChild(iframe);

  const att = document.createElement('div');
  att.className = 'plate-attribution';
  att.textContent = S.plateAttribution;
  box.appendChild(att);

  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const openTab = document.createElement('button');
  openTab.textContent = S.plateOpenTab;
  openTab.onclick = () => { if (blobUrl) window.open(blobUrl, '_blank'); };
  btns.appendChild(openTab);
  const download = document.createElement('button');
  download.textContent = S.plateDownload;
  download.onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };
  btns.appendChild(download);
  box.appendChild(btns);
  addModalCloseX(box, () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    window.removeEventListener('keydown', onEsc);
    back.remove();
  });

  function onEsc(e) {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', onEsc);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      back.remove();
    }
  }
  back.appendChild(box);
  back.onclick = e => {
    if (e.target === back) {
      window.removeEventListener('keydown', onEsc);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      back.remove();
    }
  };
  document.body.appendChild(back);
  window.addEventListener('keydown', onEsc);
}

function showChartsModal() {
  if (fpOpen) closeFlightPlan();
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal wide';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.plates;
  box.appendChild(title);

  addModalCloseX(box, () => { window.removeEventListener('keydown', onEsc); back.remove(); });

  let drag = null;
  title.addEventListener('mousedown', function (e) {
    const r = box.getBoundingClientRect();
    drag = { ox: e.clientX - r.left, oy: e.clientY - r.top };
    box.style.position = 'fixed';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.margin = '0';
    const onMove = function (e) {
      if (!drag) return;
      // Clamp to the viewport so the title bar + ✕ stay reachable. Same
      // pattern the flight-plan modal already uses.
      const x = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, e.clientX - drag.ox));
      const y = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, e.clientY - drag.oy));
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    };
    const onUp = function () {
      drag = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  const scrollArea = document.createElement('div');
  scrollArea.className = 'fp-scroll';
  const body = document.createElement('div');
  body.className = 'charts-modal-body';

  const catOrder = ['approach', 'sid', 'star', 'ground', 'vfr', 'other'];
  const catLabel = {
    approach: S.plateCategoryApproach,
    sid: S.plateCategorySid,
    star: S.plateCategoryStar,
    ground: S.plateCategoryGround,
    vfr: S.plateCategoryVfr,
    other: S.plateCategoryOther,
  };

  function renderList(afs) {
    body.innerHTML = '';
    const withPlates = afs.filter(af => af.plates && af.plates.length);
    if (!withPlates.length) {
      const none = document.createElement('p');
      none.textContent = S.platesNone;
      body.appendChild(none);
      return;
    }
    for (const af of withPlates) {
      const section = document.createElement('div');
      section.className = 'charts-airport';
      const header = document.createElement('div');
      header.className = 'charts-airport-header';
      header.textContent = af.name + (af.en ? ' — ' + af.en : '');
      // Keyboard + screen-reader parity with the toolbar's .tb-section-head
      // pattern: tabbable, announced as a button, with explicit expanded
      // state. The pane it controls is display:none until 'open', so without
      // this the plate chips inside would be unreachable from the keyboard.
      header.tabIndex = 0;
      header.setAttribute('role', 'button');
      header.setAttribute('aria-expanded', 'false');
      const pane = document.createElement('div');
      pane.className = 'charts-airport-body';
      function toggle() {
        const open = pane.classList.toggle('open');
        header.classList.toggle('open', open);
        header.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      section.appendChild(header);

      const groups = {};
      for (const fn of af.plates) {
        const cat = plateCategory(fn);
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(fn);
      }
      for (const cat of catOrder) {
        if (!groups[cat]) continue;
        const catDiv = document.createElement('div');
        catDiv.className = 'charts-cat';
        const catLbl = document.createElement('span');
        catLbl.className = 'charts-cat-label';
        catLbl.textContent = catLabel[cat];
        catDiv.appendChild(catLbl);
        for (const fn of groups[cat]) {
          const chip = document.createElement('button');
          chip.className = 'plate-chip';
          chip.textContent = prettyPlateLabel(fn);
          chip.onclick = () => showPlateViewer(fn, prettyPlateLabel(fn));
          catDiv.appendChild(chip);
        }
        pane.appendChild(catDiv);
      }
      section.appendChild(pane);
      body.appendChild(section);
    }
  }

  if (airfields) {
    renderList(airfields);
  } else {
    const loading = document.createElement('p');
    loading.textContent = '…';
    body.appendChild(loading);
    loadAirfields().then(() => { if (airfields) renderList(airfields); });
  }

  scrollArea.appendChild(body);
  box.appendChild(scrollArea);

  const att = document.createElement('div');
  att.className = 'plate-attribution';
  att.textContent = S.plateAttribution;
  box.appendChild(att);

  function onEsc(e) {
    if (e.key === 'Escape') { window.removeEventListener('keydown', onEsc); back.remove(); }
  }
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) { window.removeEventListener('keydown', onEsc); back.remove(); } };
  document.body.appendChild(back);
  window.addEventListener('keydown', onEsc);
}

// --- shareable route link (#162) -----------------------------------
// Encodes the current route into the URL so a pilot can paste a link
// into WhatsApp / Telegram and the receiver opens the same route.
//
// Wire format (chosen for URL-length budget — JSON+base64 of a 20-WP
// route blows past WhatsApp's ~2 KB preview render):
//   ?r=<polyline>         — Google Encoded Polyline of [lat,lng] pairs
//                            at 1e-5 precision (~1.1 m at 32 N)
//   &n=<base64url-names>  — names joined by U+001F, then base64url
//                            (UTF-8 safe — Hebrew names go through)
//   &l=<compact-legs>     — semicolon-separated `ia,oa,fs[,os]` triples
//                            where outboundSpeed is optional
const SHARE_MAX_WAYPOINTS = 64;        // ~1.4 KB URL, fits in WhatsApp preview
const SHARE_NAME_SEP = '\x1f';

function _polyEncodeSigned(v) {
  v = v < 0 ? ~(v << 1) : (v << 1);
  let out = '';
  while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>>= 5; }
  out += String.fromCharCode(v + 63);
  return out;
}
function polylineEncode(points) {
  let out = '', prevLat = 0, prevLng = 0;
  for (const [lat, lng] of points) {
    const latE5 = Math.round(lat * 1e5), lngE5 = Math.round(lng * 1e5);
    out += _polyEncodeSigned(latE5 - prevLat) + _polyEncodeSigned(lngE5 - prevLng);
    prevLat = latE5; prevLng = lngE5;
  }
  return out;
}
function polylineDecode(str) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >>> 1) : (result >>> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >>> 1) : (result >>> 1);
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
function _b64UrlEncode(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64UrlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

// Build the share URL from current state. Returns null if no route or if
// the route would exceed SHARE_MAX_WAYPOINTS.
function buildShareUrl() {
  if (state.waypoints.length < 2) return { err: 'errNeedWps' };
  if (state.waypoints.length > SHARE_MAX_WAYPOINTS) return { err: 'errShareTooLong' };
  const r = polylineEncode(state.waypoints.map(w => [w.lat, w.lng]));
  const n = _b64UrlEncode(state.waypoints.map(w => w.name || '').join(SHARE_NAME_SEP));
  const l = state.legs.map(leg => {
    const triple = [leg.inboundAltitude, leg.outboundAltitude, leg.flightSpeed];
    if (leg.outboundSpeed != null && leg.outboundSpeed !== leg.flightSpeed) {
      triple.push(leg.outboundSpeed);
    }
    return triple.join(',');
  }).join(';');
  const base = location.origin + location.pathname;
  const params = new URLSearchParams(location.search);
  // Preserve ?lang= so the receiver opens in the sender's language. Drop
  // any previous share params so re-shares don't double up.
  params.delete('r'); params.delete('n'); params.delete('l');
  params.set('r', r); params.set('n', n); params.set('l', l);
  return { url: base + '?' + params.toString() };
}

// Decode a share URL back into a route shape. Returns the route or null.
function decodeShareUrl(search) {
  const params = new URLSearchParams(search);
  const r = params.get('r'), n = params.get('n'), l = params.get('l');
  if (!r || n === null || l === null) return null;
  let coords, names, legParts;
  try {
    coords = polylineDecode(r);
    names = _b64UrlDecode(n).split(SHARE_NAME_SEP);
    legParts = l === '' ? [] : l.split(';');
  } catch (e) {
    return null;
  }
  if (!coords.length || names.length !== coords.length) return null;
  if (legParts.length !== Math.max(0, coords.length - 1)) return null;
  const waypoints = coords.map(([lat, lng], i) => ({ lat, lng, name: names[i] || '' }));
  const legs = legParts.map(s => {
    const parts = s.split(',').map(Number);
    if (parts.length < 3 || parts.some(v => !Number.isFinite(v))) return null;
    const [ia, oa, fs, os] = parts;
    return {
      inboundAltitude: ia,
      outboundAltitude: oa,
      flightSpeed: fs,
      outboundSpeed: os != null ? os : fs,
      inLabel: { a: 0, p: 44 },
      outLabel: { a: 0, p: -44 },
    };
  });
  if (legs.some(l => l === null)) return null;
  return { waypoints, legs, notes: [] };
}

// Called from ui.js boot, before restoreRoute(). Returns true if a route
// was loaded from the URL (boot should skip restoreRoute in that case).
function tryLoadRouteFromUrl() {
  const r = decodeShareUrl(location.search);
  if (!r) return false;
  const verr = validateRoute(r);
  if (verr) { console.warn('share-link schema error:', verr); return false; }
  state.waypoints = r.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
  state.legs = r.legs;
  state.notes = [];
  return true;
}

// Lightweight non-blocking toast (no popup, no modal). The share action
// fires often enough that an alert() was disproportionately disruptive —
// pilots want the link copied and to keep working. The toast self-removes
// after 2.5 s; clipboard failures still fall through to a window.prompt
// so the URL can be copied manually.
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  void el.offsetWidth;                  // force reflow so the fade-in runs
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2500);
}

// --- magnifying glass -------------------------------------------------
let _magDirty = true;                      // content needs rebuilding
let _magRAF = null;                        // requestAnimationFrame id
let _magX = 0, _magY = 0;                 // last known cursor (viewport px)
let _magFixed = false;                     // click-to-lock fixed position

function magCenter() { return magnifierSize / 2; }

function createMagnifier() {
  if (document.getElementById('magnifier')) return;
  const mag = document.createElement('div');
  mag.id = 'magnifier';
  mag.style.cssText = 'display:none;position:fixed;z-index:1000;width:' + magnifierSize +
    'px;height:' + magnifierSize + 'px;border-radius:50%;overflow:hidden;' +
    'pointer-events:none;border:2px solid rgba(255,204,51,0.85);' +
    'box-shadow:0 0 20px rgba(0,0,0,0.6)';
  const content = document.createElement('div');
  content.id = 'mag-content';
  content.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;transform-origin:0 0';
  mag.appendChild(content);
  // crosshair
  const ch = document.createElement('div');
  ch.style.cssText = 'position:absolute;top:50%;left:50%;width:0;height:0;pointer-events:none';
  ch.innerHTML =
    '<div style="position:absolute;top:-1px;left:-24px;width:48px;height:2px;background:rgba(255,60,60,0.8)"></div>' +
    '<div style="position:absolute;top:-24px;left:-1px;width:2px;height:48px;background:rgba(255,60,60,0.8)"></div>';
  mag.appendChild(ch);
  document.body.appendChild(mag);
}

function rebuildMagnifier() {
  if (!magnifierOn) return;
  const content = document.getElementById('mag-content');
  if (!content) return;
  content.innerHTML = '';

  // clone tiles at current zoom (immediate fallback)
  const tilePane = document.querySelector('.leaflet-tile-pane');
  const tiles = tilePane ? Array.from(tilePane.querySelectorAll('img')) : [];
  for (const img of tiles) {
    const c = img.cloneNode(true);
    c.style.visibility = 'visible';
    content.appendChild(c);
  }

  // asynchronously overlay higher-zoom tiles for crisp detail
  const S = magnifierZoom;
  const mapZoom = Math.floor(map.getZoom());
  const zoomStep = Math.ceil(Math.log2(S));
  const targetZoom = Math.min(mapZoom + zoomStep, 19);
  const useHighRes = targetZoom > mapZoom;

  let activeLayer = null;
  if (useHighRes) {
    for (const key in layers) {
      if (map.hasLayer(layers[key])) { activeLayer = layers[key]; break; }
    }
  }

  if (useHighRes && activeLayer) {
    const subs = activeLayer.options.subdomains || 'abc';
    const corsOk = activeLayer.options.corsOk;
    const sub = Math.pow(2, targetZoom - mapZoom);
    const pending = [];
    for (const img of tiles) {
      const parts = new URL(img.src).pathname.split('/');
      if (parts.length < 4) continue;
      const zNum = parseInt(parts[parts.length - 3], 10);
      if (isNaN(zNum) || zNum !== mapZoom) continue;
      const yNum = parseInt(parts[parts.length - 1], 10);
      if (isNaN(yNum)) continue;
      const xNum = parseInt(parts[parts.length - 2], 10);
      if (isNaN(xNum)) continue;
      for (let dy = 0; dy < sub; dy++) {
        for (let dx = 0; dx < sub; dx++) {
          const tx = xNum * sub + dx;
          const ty = yNum * sub + dy;
          const tile = document.createElement('img');
          tile.style.cssText = 'position:absolute;left:' +
            (tx * 256 / sub) + 'px;top:' +
            (ty * 256 / sub) + 'px;' +
            'width:256px;height:256px;';
          content.appendChild(tile);
          const url = L.Util.template(activeLayer._url,
            { z: targetZoom, x: tx, y: ty, s: subs[(tx + ty) % subs.length] });
          const fetchUrl = corsOk ? url
            : 'https://images.weserv.nl/?url=' +
              encodeURIComponent(url.replace(/^https?:\/\//, ''));
          pending.push(fetch(fetchUrl).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob();
          }).then(blob => {
            tile.src = URL.createObjectURL(blob);
          }).catch(() => { tile.remove(); }));
        }
      }
    }
  }

  // capture overlay
  const overlay = document.getElementById('overlay');
  if (overlay) {
    const cap = document.createElement('img');
    cap.src = overlay.toDataURL();
    const mapPane = document.querySelector('.leaflet-map-pane');
    const mat = mapPane ? new DOMMatrixReadOnly(getComputedStyle(mapPane).transform) : null;
    const dx = mat ? (mat.is2D ? mat.e : mat.m41) : 0;
    const dy = mat ? (mat.is2D ? mat.f : mat.m42) : 0;
    cap.style.cssText = 'position:absolute;left:' + (-dx) + 'px;top:' + (-dy) +
      'px;width:' + overlay.style.width + ';height:' + overlay.style.height;
    content.appendChild(cap);
  }
  _magDirty = false;
}

function applyMagnifierTransform() {
  const mag = document.getElementById('magnifier');
  const content = document.getElementById('mag-content');
  if (!mag || !content) return;
  if (_magDirty) rebuildMagnifier();
  const mapRect = map.getContainer().getBoundingClientRect();
  const cp = { x: _magX - mapRect.left, y: _magY - mapRect.top };
  const S = magnifierZoom;
  const mapPane = document.querySelector('.leaflet-map-pane');
  const mat = mapPane ? new DOMMatrixReadOnly(getComputedStyle(mapPane).transform) : null;
  const dx = mat ? (mat.is2D ? mat.e : mat.m41) : 0;
  const dy = mat ? (mat.is2D ? mat.f : mat.m42) : 0;
  content.style.transform =
    'translate(' + (magCenter() + dx * S - cp.x * S) + 'px,' +
                   (magCenter() + dy * S - cp.y * S) + 'px) scale(' + S + ')';
}

function updateMagnifier(e) {
  if (!magnifierOn || _magFixed) return;
  _magX = e.clientX;
  _magY = e.clientY;
  if (_magRAF) return;                     // already queued
  _magRAF = requestAnimationFrame(() => {
    _magRAF = null;
    const mag = document.getElementById('magnifier');
    const content = document.getElementById('mag-content');
    if (!mag || !content) return;
    mag.style.left = (_magX - magCenter()) + 'px';
    mag.style.top = (_magY - magCenter()) + 'px';
    applyMagnifierTransform();
  });
}

function applyMagBorder() {
  const mag = document.getElementById('magnifier');
  if (!mag) return;
  mag.style.borderColor = _magFixed ? 'rgba(102,255,102,0.9)' : 'rgba(255,204,51,0.85)';
}

function toggleMagnifier() {
  magnifierOn = !magnifierOn;
  _magFixed = false;
  const mag = document.getElementById('magnifier');
  if (!mag) return;
  mag.style.display = magnifierOn ? 'block' : 'none';
  applyMagBorder();
  document.getElementById('tool-magnifier').classList.toggle('active', magnifierOn);
  const settings = document.getElementById('magnifier-settings');
  if (settings) settings.classList.toggle('hidden', !magnifierOn);
  if (magnifierOn) {
    _magDirty = true;
    rebuildMagnifier();
    _magX = _magX || window.innerWidth / 2;
    _magY = _magY || window.innerHeight / 2;
    mag.style.left = (_magX - magCenter()) + 'px'; mag.style.top = (_magY - magCenter()) + 'px';
    applyMagnifierTransform();
    document.addEventListener('mousemove', updateMagnifier);
    document.addEventListener('click', onMagClick, true);
  } else {
    document.removeEventListener('mousemove', updateMagnifier);
    document.removeEventListener('click', onMagClick, true);
    if (_magRAF) { cancelAnimationFrame(_magRAF); _magRAF = null; }
  }
}

function onMagClick(e) {
  if (!magnifierOn) return;
  const ignore = document.getElementById('toolbar');
  if (ignore && ignore.contains(e.target)) return;
  const settings = document.getElementById('magnifier-settings');
  if (settings && settings.contains(e.target)) return;
  const insp = document.getElementById('inspector');
  if (insp && insp.contains(e.target)) return;
  _magFixed = !_magFixed;
  applyMagBorder();
  // event passes through to map for selection
}

// Magnifier zoom slider + scroll-wheel control
(function () {})();

// Magnifier zoom slider + scroll-wheel control
(function () {
  const zoomSlider = document.getElementById('mag-zoom');
  const zoomVal = document.getElementById('mag-zoom-val');
  if (zoomSlider && zoomVal) {
    zoomSlider.addEventListener('input', function () {
      window.magnifierZoom = parseFloat(this.value);
      zoomVal.textContent = magnifierZoom.toFixed(2).replace(/\.?0+$/, '') + '×';
      _magDirty = true;
      if (magnifierOn) { rebuildMagnifier(); applyMagnifierTransform(); }
    });
  }
  // Scroll wheel changes magnifier zoom instead of map zoom.
  // Intercept on document during capture phase so we fire before Leaflet's
  // own wheel handler (which is attached to the map container in bubble phase).
  if (zoomSlider && zoomVal) {
    document.addEventListener('wheel', function (e) {
      if (!magnifierOn) return;
      if (!document.getElementById('map')?.contains(e.target)) return;
      e.stopPropagation();
      e.preventDefault();
      const step = e.deltaY > 0 ? -0.25 : 0.25;
      var v = parseFloat(zoomSlider.value) + step;
      v = Math.max(1, Math.min(5, Math.round(v * 4) / 4));
      if (v === parseFloat(zoomSlider.value)) return;
      zoomSlider.value = '' + v;
      window.magnifierZoom = v;
      zoomVal.textContent = v.toFixed(2).replace(/\.?0+$/, '') + '×';
      _magDirty = true;
      rebuildMagnifier();
      applyMagnifierTransform();
    }, { capture: true, passive: false });
  }
  // Settings close button
  const closeBtn = document.getElementById('mag-settings-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      if (magnifierOn) toggleMagnifier();
    });
  }
})();

// Mark magnifier dirty when the map or route changes
map.on('moveend zoomend rotate', () => { _magDirty = true; });
// _onDraw already used by WYSIWYG; piggyback — the WYSIWYG fires after draw
// so this runs right after it.
// We hook into draw via a separate channel so the two features are independent.
// Wrap NavAid._onDraw so it also marks the magnifier dirty.
if (typeof NavAid._onDraw === 'function') {
  const _origOnDraw = NavAid._onDraw;
  NavAid._onDraw = function () { _origOnDraw(); _magDirty = true; };
} else {
  NavAid._onDraw = function () { _magDirty = true; };
}

// --- Toolbar button handler — copy share URL to clipboard. ------------
function shareRoute() {
  const r = buildShareUrl();
  if (r.err) { alert(S[r.err]); return; }
  // Clipboard API requires a secure context + user gesture; the button
  // click satisfies the gesture, but http://localhost might fall back.
  const writePromise = (navigator.clipboard && navigator.clipboard.writeText)
    ? navigator.clipboard.writeText(r.url)
    : Promise.reject(new Error('no clipboard API'));
  writePromise
    .then(() => showToast(S.shareCopied))
    .catch(() => {
      // Fallback: show the URL in a prompt so the user can copy manually.
      window.prompt(S.shareCopied, r.url);
    });
}

