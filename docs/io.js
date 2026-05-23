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
      lat: w.lat, lng: w.lng, name: w.name,
    }));
    state.legs = d.legs.map(l => ({
      inboundAltitude: l.inboundAltitude,
      outboundAltitude: l.outboundAltitude,
      flightSpeed: l.flightSpeed,
      inLabel:  { a: l.inLabel.a,  p: l.inLabel.p  },
      outLabel: { a: l.outLabel.a, p: l.outLabel.p },
    }));
    state.notes = d.notes.map(n => ({
      lat: n.lat, lng: n.lng,
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
  });
}

// --- flight plan table -----------------------------------------------
function wpLabel(i) {
  const wp = state.waypoints[i];
  if (!wp) return '';
  const n = navName((wp.name || '').trim());
  return n || (S.wpPrefix + (i + 1));
}

function showFlightPlan() {
  if (state.legs.length === 0) {
    alert(S.errNoLegs);
    return;
  }
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal wide';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = S.flightPlan;
  box.appendChild(title);

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
    inp.value = (state.waypoints[wpIdx].name || '').trim();
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
  const rows = [];                      // { leg, dist, timeCell }
  const altInputs = [];                 // leg index -> altitude input
  let totDistCell, totTimeCell;
  function refresh() {                  // recompute Time cells + totals
    let td = 0, th = 0;
    for (const r of rows) {
      const dur = r.leg.flightSpeed > 0 ? r.dist / r.leg.flightSpeed : 0;
      td += r.dist;
      th += dur;
      r.timeCell.textContent = dur > 0 ? toHMS(dur) : '--';
    }
    totDistCell.textContent = td.toFixed(1);
    totTimeCell.textContent = th > 0 ? toHMS(th) : '--';
  }
  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    const leg = state.legs[i];
    const { dist, brg } = geo(A, B);
    const tr = document.createElement('tr');
    tr.appendChild(planCell(String(i + 1)));
    tr.appendChild(nameCell(i));
    tr.appendChild(nameCell(i + 1));
    tr.appendChild(planCell(pad3(toMagnetic(brg)) + '°M'));
    tr.appendChild(planCell(dist.toFixed(1)));
    tr.appendChild(numCell(leg.flightSpeed, 1, inp => {
      const v = +inp.value;
      if (v > 0) { leg.flightSpeed = v; refresh(); draw(); }
      else inp.value = leg.flightSpeed;   // invalid — restore the real value
    }));
    const altCell = numCell(leg.inboundAltitude, -2000, inp => {
      const oldVal = leg.inboundAltitude;
      leg.inboundAltitude = Math.round(+inp.value) || 0;
      propagateAlt(i, 'inboundAltitude', leg.inboundAltitude, oldVal);
      for (let k = 0; k < altInputs.length; k++) {
        if (altInputs[k]) altInputs[k].value = state.legs[k].inboundAltitude;
      }
      draw();
    });
    altInputs[i] = altCell.querySelector('.plan-num');
    tr.appendChild(altCell);
    const timeCell = planCell('');
    tr.appendChild(timeCell);
    rows.push({ leg, dist, timeCell });
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
  refresh();
  box.appendChild(table);

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
  close.onclick = () => back.remove();
  btns.appendChild(close);
  box.appendChild(btns);

  back.appendChild(box);
  back.onclick = e => { if (e.target === back) back.remove(); };
  document.body.appendChild(back);
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
  for (const [label, val] of [[S.landscape, 'landscape'], [S.portrait, 'portrait']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { back.remove(); onPick(val); };
    btns.appendChild(b);
  }
  const cancel = document.createElement('button');
  cancel.textContent = S.cancel;
  cancel.className = 'modal-cancel';
  cancel.onclick = () => back.remove();
  btns.appendChild(cancel);
  box.append(title, btns);
  back.appendChild(box);
  back.onclick = e => { if (e.target === back) back.remove(); };
  document.body.appendChild(back);
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
// A browser cannot launch or detect a desktop app, so this writes a KML
// tour and tells the user to open it in Google Earth Pro, which flies
// the route at the per-leg altitudes set in the flight plan.
function flyRoute() {
  if (state.waypoints.length < 2) {
    alert(S.errNeedWps);
    return;
  }
  if (!confirm(S.flyConfirm)) {
    return;
  }
  const wps = state.waypoints;
  // Camera flythrough height per waypoint (metres MSL): the leg flown
  // along it; the last waypoint reuses the last leg. inboundAltitude is feet.
  const altM = i => {
    const leg = state.legs[Math.min(i, state.legs.length - 1)];
    return Math.max(0, Math.round((leg ? leg.inboundAltitude : 2000) * 0.3048));
  };
  const esc = s => String(s).replace(/[<>&]/g,
    c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  // heading at each waypoint = bearing toward the next (last reuses prev)
  const heading = i => {
    const j = Math.min(i, wps.length - 2);
    return geo(wps[j], wps[j + 1]).brg;
  };
  // KML <Camera> child order is strict — altitudeMode must come last,
  // or Google Earth ignores it and the eye ends up miles up.
  // absolute = altitude is metres above mean sea level (MSL).
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
    camera(0, '  ') +                    // open already at the start, 5000 ft
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

// --- route persistence ----------------------------------------------
const STORE_KEY = 'navaid.route';
let persistTimer = null;
function persist() {
  // When boot detected a corrupt saved blob (issue #73), refuse to overwrite
  // it with the empty in-memory state — that's silent data loss. Once the
  // user adds a waypoint / note the state is no longer empty and the normal
  // save path resumes, replacing the corrupt blob with their new work.
  if (NavAid.corruptCache &&
      state.waypoints.length === 0 &&
      state.legs.length === 0 &&
      state.notes.length === 0) return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      // center / zoom are not restored (load fits the route) — not saved.
      localStorage.setItem(STORE_KEY, JSON.stringify({
        waypoints: state.waypoints,
        legs: state.legs,
        notes: state.notes,
      }));
    } catch (e) { /* storage unavailable */ }
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
    return 'corrupt';                     // bad JSON — preserve raw blob (#73)
  }
  // Strict schema check — issue #101. Legacy saved blobs lacking a newer
  // field (e.g. notes added later) will fail here. The caller treats
  // 'corrupt' as the preserve-on-failure path from #73: the raw blob is
  // left untouched in localStorage and the boot continues with empty
  // state, so no user work is lost (they can hand-edit / re-import).
  if (validateRoute(d) !== null) {
    return 'corrupt';
  }
  state.waypoints = d.waypoints.map(w => ({
    lat: w.lat, lng: w.lng, name: w.name,
  }));
  state.legs = d.legs.map(l => ({
    inboundAltitude: l.inboundAltitude,
    outboundAltitude: l.outboundAltitude,
    flightSpeed: l.flightSpeed,
    inLabel:  { a: l.inLabel.a,  p: l.inLabel.p  },
    outLabel: { a: l.outLabel.a, p: l.outLabel.p },
  }));
  state.notes = d.notes.map(n => ({
    lat: n.lat, lng: n.lng,
    text: n.text, color: n.color, shape: n.shape,
  }));
  syncLegs();
  return true;
}

