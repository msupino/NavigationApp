'use strict';
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
      if ('outboundSpeed' in l) _v(l, 'outboundSpeed', 'number', p, errs);
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
      inLabel:  { a: l.inLabel.a,  p: l.inLabel.p  },
      outLabel: { a: l.outLabel.a, p: l.outLabel.p },
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
  chooseOrientation(size, orient => {
    pageOrient = orient;
    pageSize = size;
    pageOffset = { x: 0, y: 0 };          // start centred
    applyPage();
    fitPageFrame();
  });
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
  let totDistCell, totTimeCell;
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
  tfoot.appendChild(trF);
  table.appendChild(tfoot);

  function refresh() {
    let td = 0, th = 0;
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
      // Sync the editable inputs unless the user is mid-edit in that cell.
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
    let rTotDistCell, rTotTimeCell;

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
    rtfoot.appendChild(rtrF);
    rtable.appendChild(rtfoot);

    retRefresh = function () {
      if (state.legs.length !== rDistCells.length) { closeFlightPlan(); return; }
      let td = 0, th = 0;
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
        if (rSpeedInputs[i] && document.activeElement !== rSpeedInputs[i])
          rSpeedInputs[i].value = state.legs[ri].outboundSpeed;
        if (rAltInputs[i] && document.activeElement !== rAltInputs[i])
          rAltInputs[i].value = state.legs[ri].outboundAltitude;
      }
      rTotDistCell.textContent = td.toFixed(1);
      rTotTimeCell.textContent = th > 0 ? toHMS(th) : '--';
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
  const close = document.createElement('button');
  close.textContent = S.fpClose;
  close.className = 'modal-cancel';
  close.onclick = closeFlightPlan;
  btns.appendChild(close);
  box.appendChild(btns);

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
  try { sessionStorage.removeItem('navaid.fpOpen'); } catch (e) {}
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
    drawNavWaypoints();
    drawAirfields();
    drawLegs();
    drawWaypoints();
    drawNotes();
    o.restore();
    octx = prevOctx;

    out.toBlob(b => {
      btn.textContent = btnLabel;
      btn.disabled = false;
      unlockMap();
      NavAid.exporting = false;
      if (!b) { alert(S.errPngFail); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'navigation-' + (pageSize || baseName) +
                   '-' + fileStamp() + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
      if (failed > 0) alert(S.errTilesFail(failed, jobs.length));
    }, 'image/png');
  });
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
  state.legs = d.legs.map(l => ({
    inboundAltitude: l.inboundAltitude,
    outboundAltitude: l.outboundAltitude,
    flightSpeed: l.flightSpeed,
    outboundSpeed: l.outboundSpeed != null ? l.outboundSpeed : l.flightSpeed,
    inLabel:  { a: l.inLabel.a,  p: l.inLabel.p  },
    outLabel: { a: l.outLabel.a, p: l.outLabel.p },
  }));
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
  const close = document.createElement('button');
  close.textContent = S.plateClose;
  close.className = 'modal-cancel';
  close.onclick = () => { if (blobUrl) URL.revokeObjectURL(blobUrl); back.remove(); };
  btns.appendChild(close);

  box.appendChild(btns);

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
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal wide';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.plates;
  box.appendChild(title);

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
      const section = document.createElement('details');
      section.className = 'charts-airport';
      const summ = document.createElement('summary');
      summ.textContent = af.name + (af.en ? ' — ' + af.en : '');
      section.appendChild(summ);

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
        section.appendChild(catDiv);
      }
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

  box.appendChild(body);

  const att = document.createElement('div');
  att.className = 'plate-attribution';
  att.textContent = S.plateAttribution;
  box.appendChild(att);

  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const close = document.createElement('button');
  close.textContent = S.plateClose;
  close.className = 'modal-cancel';
  close.onclick = () => back.remove();
  btns.appendChild(close);
  box.appendChild(btns);

  function onEsc(e) {
    if (e.key === 'Escape') { window.removeEventListener('keydown', onEsc); back.remove(); }
  }
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) { window.removeEventListener('keydown', onEsc); back.remove(); } };
  document.body.appendChild(back);
  window.addEventListener('keydown', onEsc);
}

