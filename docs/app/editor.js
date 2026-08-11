// editor.js — hidden map-data editor for digitizing features by hand.
// Enable with ?editor=1. A small floating panel offers two modes:
//   • Point   — click to drop draggable point markers (waypoints).
//   • Polygon — click to add vertices; finish to close a ring (LSA bubbles,
//               airspace areas). Double-click or "Finish" closes the ring.
// Exports JSON to paste back. Fully self-contained: a separate Leaflet layer +
// localStorage, no coupling to the route/state model, so it can't corrupt a
// real route. Points and polygons are tagged with the active base layer and
// only shown / exported for that layer.
(function () {
  'use strict';
  function enabled() {
    return /[?&]editor=1\b/.test(location.search);   // URL param only — never persisted
  }
  if (!enabled()) {
    try { localStorage.removeItem('navaid.editor.on'); } catch (e) {}
    return;
  }

  var KEY = 'navaid.editor.points';
  var PKEY = 'navaid.editor.polys';
  var COLOR = '#0aa3c2';
  var r5 = function (x) { return Math.round(x * 1e5) / 1e5; };
  // Leaflet renders a string tooltip as HTML — escape user-entered names so a
  // name like "<img onerror=…>" can't execute (self-XSS in this dev-only tool).
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function load(key) { try { var a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  var points = load(KEY);
  var polys = load(PKEY);
  var draft = [];               // in-progress polygon: array of L.latLng
  var mode = 'point';           // 'point' | 'polygon'
  var curType = 'onRequest';
  var group = null;

  function savePoints() { try { localStorage.setItem(KEY, JSON.stringify(points)); } catch (e) {} }
  function savePolys() { try { localStorage.setItem(PKEY, JSON.stringify(polys)); } catch (e) {} }
  // Debounced write for the DRAG path only. Each loaded point now carries its whole
  // source record in `_node` (needed so the export can ride every field through -- see
  // json() below), so a `Load known` of ~200 CVFR nodes makes savePoints() tens of KB
  // instead of a few hundred bytes. Dragging fires that write on every mouseup; a fast
  // multi-point reposition session turns into one big synchronous localStorage write per
  // drag instead of one for the whole session. Same debounce shape as persist()/
  // flushPersist() in io.js, for the same reason: collapse a burst into one write,
  // flush on unload so nothing is lost if the tab closes mid-drag.
  var _pointsSaveTimer = null;
  function savePointsSoon() {
    if (_pointsSaveTimer) return;
    _pointsSaveTimer = setTimeout(function () { _pointsSaveTimer = null; savePoints(); }, 400);
  }
  window.addEventListener('beforeunload', function () {
    if (_pointsSaveTimer) { clearTimeout(_pointsSaveTimer); _pointsSaveTimer = null; savePoints(); }
  });

  // Reuses the shared active-layer lookup from draw.js (loaded before this
  // script) instead of keeping a second, independently-maintained copy.
  function currentLayer() { return typeof currentLayerName === 'function' ? currentLayerName() : ''; }
  function curPoints() { var c = currentLayer(); return points.filter(function (p) { return (p.layer || '') === c; }); }
  function curPolys() { var c = currentLayer(); return polys.filter(function (p) { return (p.layer || '') === c; }); }

  // ---- markers / shapes -------------------------------------------------
  function marker(p, i) {
    // Named points: small cyan triangle. Unnamed: big red pulsing triangle so
    // they're impossible to miss and quick to label.
    var named = !!p.name;
    var col = named ? COLOR : '#ff2020';
    var sz = named ? 20 : 40;
    var fill = p.report === 'mandatory' ? col : 'none';
    var html = '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 20 20"><polygon points="10,2 18,17 2,17" fill="' +
      fill + '" stroke="' + col + '" stroke-width="2"/></svg>';
    var cls = 'editor-icon' + (named ? '' : ' editor-flash');
    var icon = L.divIcon({ className: cls, html: html, iconSize: [sz, sz], iconAnchor: [sz / 2, sz * 0.65] });
    var m = L.marker([p.lat, p.lng], { icon: icon, keyboard: false, draggable: true });
    if (p.name) m.bindTooltip(esc(p.name), { direction: 'right', offset: [8, 0] });
    // Unnamed points: swallow mousedown so the app's nav-WP hit-test (inspector)
    // underneath doesn't fire — clicking one should ONLY open the name setter.
    if (!named) m.on('mousedown', function (ev) { L.DomEvent.stopPropagation(ev); });
    m.on('click', function (ev) {                 // click = name · shift-click = delete
      L.DomEvent.stopPropagation(ev);
      var oe = ev.originalEvent;
      if (oe && oe.shiftKey) {                    // instant delete, no prompt round-trip
        points.splice(i, 1);
        savePoints(); render(); redraw();
        return;
      }
      var name = prompt('Waypoint name (blank to delete):', points[i].name || '');
      if (name === null) return;                  // cancel — no change
      name = name.trim();
      if (name) {
        // The export keys the nodes map by this name (uppercased), one bare assignment
        // per point -- a second point with the same name would silently overwrite the
        // first's whole record on export, with no error. Catch it here instead, where a
        // human is already looking at the map and can pick a different name or the point
        // that should really be renamed.
        var up = name.toUpperCase();
        var lyr = p.layer || currentLayer();
        var clash = points.some(function (q, j) {
          return j !== i && (q.layer || '') === lyr &&
            String(q.name || '').trim().toUpperCase() === up;
        });
        if (clash) {
          alert('Another point on this layer is already named "' + name + '". ' +
            'Two points sharing a name would collapse into one on export -- rename or move one first.');
          return;
        }
        points[i].name = name;
      } else {
        points.splice(i, 1);
      }
      savePoints(); render(); redraw();           // name lands in the exported JSON
    });
    // savePointsSoon, not savePoints: the localStorage write is debounced, but render()
    // still runs synchronously every time, so the panel's count and #ed-json stay live --
    // only the disk write behind them is throttled.
    m.on('dragend', function (ev) { var ll = ev.target.getLatLng(); points[i].lat = r5(ll.lat); points[i].lng = r5(ll.lng); savePointsSoon(); render(); });
    return m;
  }

  var _redrawing = false;
  function redraw() {
    if (!group) group = L.layerGroup().addTo(map);
    _redrawing = true;
    group.clearLayers();
    var cur = currentLayer();
    points.forEach(function (p, i) { if ((p.layer || '') === cur) group.addLayer(marker(p, i)); });
    polys.forEach(function (pg, i) {
      if ((pg.layer || '') !== cur) return;
      // Match the map/legend: always = green, weekend = black outline + tan fill.
      var col = pg.active === 'weekend' ? '#2b2b2b' : '#3c8f3c';
      var fillCol = pg.active === 'weekend' ? '#c9b28a' : '#4caf50';
      var poly = L.polygon(pg.coords, { color: col, weight: 2, fillColor: fillCol, fillOpacity: 0.12 });
      var lbl = String(pg.name || pg.en || pg.he || '');
      if (pg.active === 'weekend') lbl = (lbl ? lbl + ' · ' : '') + 'weekend';
      if (lbl) poly.bindTooltip(esc(lbl), { sticky: true });
      poly.on('click', function (ev) {            // click = name/type (shift-click = delete)
        L.DomEvent.stopPropagation(ev);
        if (ev.originalEvent && ev.originalEvent.shiftKey) {
          if (!confirm('Delete this polygon?')) return;
          polys.splice(i, 1); savePolys(); render(); redraw(); return;
        }
        var name = prompt('Bubble code / name (blank to clear):', polys[i].name || '');
        if (name === null) return;                 // cancel — no change
        var en = prompt('English name:', polys[i].en || '');
        if (en === null) return;
        var he = prompt('Hebrew name:', polys[i].he || '');
        if (he === null) return;
        var typ = prompt('Active — "weekend" or "always":', polys[i].active || 'always');
        if (typ === null) return;
        polys[i].name = name.trim(); polys[i].en = en.trim(); polys[i].he = he.trim();
        polys[i].active = /^\s*w/i.test(typ) ? 'weekend' : 'always';
        savePolys(); render(); redraw();           // lands in the exported JSON
      });
      group.addLayer(poly);
    });
    if (draft.length) {                            // in-progress ring
      group.addLayer(L.polyline(draft, { color: COLOR, weight: 2, dashArray: '5,5' }));
      draft.forEach(function (ll) { group.addLayer(L.circleMarker(ll, { radius: 4, color: COLOR, fillColor: '#fff', fillOpacity: 1, weight: 2 })); });
    }
    _redrawing = false;
  }

  // ---- export -----------------------------------------------------------
  function json() {
    if (mode === 'polygon') {
      dupeWarning = '';   // point-mode-only warning; clear so switching modes doesn't leak it
      return JSON.stringify(curPolys().map(function (pg) {
        var o = { type: 'polygon', coords: pg.coords };
        if (pg.name) o.name = pg.name;
        if (pg.en) o.en = pg.en;
        if (pg.he) o.he = pg.he;
        if (pg.active === 'weekend') o.active = 'weekend';   // 'always' is the default → omitted
        // Fields this editor does not edit (icao, lowFt/highFt, points, aliases, ...) ride
        // through untouched: the documented workflow pastes this JSON back over the data
        // file, and the round-trip must not strip data the app reads.
        for (var k in pg) {
          if (!pg.hasOwnProperty(k)) continue;
          if (k === 'coords' || k === 'name' || k === 'en' || k === 'he' ||
              k === 'active' || k === 'layer' || k === 'type') continue;
          o[k] = pg[k];
        }
        return o;
      }), null, 2);
    }
    // Reporting points live in <prefix>-route-graph.json under `nodes`, keyed by name --
    // NOT in a flat array, which is what the retired *-nav-waypoints.json files used and
    // what this exported until now. Pasting that array back over a graph would not have
    // been a lossy round-trip, it would have destroyed the file.
    //
    // Fields this editor does not edit (code, kind, layers, commChange, callSigns, active,
    // noSegmentsReason, ...) ride through untouched, the same guarantee polygon mode has
    // always given. `_node` carries the original record; only position and labels are
    // overwritten from what was edited here.
    //
    // EDGES ARE NOT EMITTED. This tool does not draw them, so the fragment is `nodes` only
    // and must be MERGED into the file's nodes map, never pasted over the whole graph.
    // Unnamed points keep a placeholder key rather than being dropped. Dropping them would
    // lose captured coordinates silently, and capture-then-name IS the workflow: you click
    // to drop, export to check, and name afterwards. UNNAMED_n is obviously not a code, so
    // it cannot be pasted back by accident without being noticed.
    // Belt and suspenders: the rename prompt refuses a clashing name up front, but this
    // loop must never silently drop a record even if a collision reaches it some other
    // way. A bare `out[id] = base` would let the later point overwrite the earlier one's
    // whole record with no error -- that WAS this function's bug. A colliding id is
    // suffixed instead, so both survive and the count below tells the pilot to look.
    var out = {}, draft = 0, dupes = [];
    curPoints().forEach(function (p) {
      var name = (p.name || '').trim().toUpperCase();   // the REAL name -- goes in the record
      var id = name;                                     // the map KEY -- may get disambiguated
      if (!id) { draft++; id = 'UNNAMED_' + draft; }
      else if (out.hasOwnProperty(id)) {
        var n = 2;
        while (out.hasOwnProperty(id + '__DUP' + n)) n++;
        dupes.push(id);
        id = id + '__DUP' + n;                            // key only -- name/code stay real
      }
      var base = p._node ? JSON.parse(JSON.stringify(p._node)) : {};
      base.lat = p.lat;
      base.lng = p.lng;
      if (p.report) base.report = p.report;
      var named = !!name;
      if (named) base.name = name;
      if (p.he) base.he = p.he;
      // A node the validator will accept: it requires he, and en or code. A draft gets
      // neither -- it is not a node yet, and inventing a code would make it look like one.
      if (named && !base.code) base.code = name;
      if (!base.en && !base.code) base.en = name || id;
      if (!base.kind) base.kind = 'waypoint';
      var lyr = prefixForLayer(p.layer || currentLayer());
      if (!Array.isArray(base.layers)) base.layers = [lyr];
      else if (base.layers.indexOf(lyr) < 0) base.layers = base.layers.concat([lyr]);
      out[id] = base;
    });
    if (dupes.length) {
      // Surfaced where the pilot is already looking, not buried in the JSON: the export
      // still succeeds and nothing is dropped (see the __DUP suffix above), but two points
      // sharing a name is a mistake worth fixing before this is pasted anywhere.
      dupeWarning = 'Duplicate name' + (dupes.length > 1 ? 's' : '') + ': ' +
        Array.from(new Set(dupes)).join(', ') +
        ' -- exported under a __DUP suffix so nothing is lost, but rename before using this.';
    } else {
      dupeWarning = '';
    }
    return JSON.stringify({ nodes: out }, null, 2);
  }

  // Only chart layers have a known waypoint set worth importing into the
  // editor; base maps (Satellite/OSM) don't — even though fetchLayerData
  // would happily hand back the CVFR file for them. The chart-layer
  // predicate is shared with the satellite modal (interact.js).
  function prefixForLayer(name) {
    if (typeof _PREFIX_LAYER_NAME === 'object') {
      for (var p in _PREFIX_LAYER_NAME) if (_PREFIX_LAYER_NAME[p] === name) return p;
    }
    return 'cvfr';   // Navigation shares the CVFR dataset
  }
  function loadKnown() {
    var lyr = currentLayer();
    if (!satelliteModalIsChartLayer(lyr)) { alert('No known waypoint set for ' + (lyr || 'this layer')); return; }
    if (curPoints().length && !confirm('Replace ' + curPoints().length + ' point(s) on ' + lyr + ' with the known set?')) return;
    // Reuse the shared per-layer resolver (draw.js) for the URL/prefix logic,
    // but REFUSE its silent cvfr fallback: if the layer's own file failed to
    // load (404/network), importing CVFR points tagged as this layer would
    // corrupt the dataset on paste-back. Surface the failure instead.
    // `expected` derives from the layer captured at CLICK time — comparing
    // against layerDataPrefix() at resolve time is tautological, because
    // fetchLayerData itself retries to follow the active layer, so a
    // mid-fetch layer switch would import the new layer's points tagged
    // with the old layer's name.
    var expected = prefixForLayer(lyr);
    // The RAW graph, not the projected waypoint view: the projection drops code, kind,
    // layers, commChange, callSigns and the rest, and re-exporting from it would quietly
    // strip them on paste-back. Each editor point keeps its whole source record in `_node`.
    routeGraphData(expected).then(function (g) {
      if (currentLayer() !== lyr) {
        alert('Layer changed while loading — not importing. Try again on ' + lyr + '.');
        return;
      }
      if (!g || !g.nodes) {
        alert('The ' + lyr + ' route graph failed to load — not importing. Try again.');
        return;
      }
      var loaded = Object.keys(g.nodes).map(function (id) { return g.nodes[id]; })
        .filter(function (n) {
          return n && isFinite(n.lat) && isFinite(n.lng) &&
            Array.isArray(n.layers) && n.layers.indexOf(expected) >= 0 &&
            n.kind !== 'airfield' && n.kind !== 'airstrip';   // ARPs live in airfields.json
        })
        .map(function (n) {
          var rep = n.report === 'mandatory' ? 'mandatory' : (n.report === 'onRequest' ? 'onRequest' : curType);
          return { lat: r5(n.lat), lng: r5(n.lng), report: rep, layer: lyr,
                   name: n.name || n.code || '', he: n.he || '', _node: n };
        });
      points = points.filter(function (p) { return (p.layer || '') !== lyr; }).concat(loaded);
      savePoints(); render(); redraw();
    }).catch(function (e) { alert('Failed to load known set: ' + e); });
  }
  // Polygon-mode counterpart of loadKnown: pull the shipped LSA bubbles into the
  // editor so their name/en/he can be set by clicking, then Copy JSON to paste
  // back into data/<layer>-areas.json. Same anti-corruption guard as loadKnown:
  // refuse the silent cvfr fallback (no cvfr-areas.json exists).
  function loadKnownAreas() {
    var lyr = currentLayer();
    var expected = prefixForLayer(lyr);
    if (expected === 'cvfr') { alert('No known LSA areas for ' + (lyr || 'this layer')); return; }
    if (curPolys().length && !confirm('Replace ' + curPolys().length + ' polygon(s) on ' + lyr + ' with the known set?')) return;
    fetchLayerData('areas').then(function (res) {
      if (currentLayer() !== lyr) {
        alert('Layer changed while loading — not importing. Try again on ' + lyr + '.');
        return;
      }
      if (res.prefix !== expected) {
        alert('The ' + lyr + ' areas set failed to load (got the ' + res.prefix +
          ' fallback instead) — not importing. Try again.');
        return;
      }
      var d = res.data;
      var arr = Array.isArray(d) ? d : (d.areas || []);
      var loaded = arr.filter(function (a) { return a && Array.isArray(a.coords) && a.coords.length >= 3; }).map(function (a) {
        // Start from the record as shipped, so fields the editor does not know about
        // (icao, lowFt/highFt, points, aliases, ...) survive the load -> edit -> export
        // round-trip; then normalize the fields the editor does edit.
        var o = {};
        for (var k in a) { if (a.hasOwnProperty(k)) o[k] = a[k]; }
        o.coords = a.coords.map(function (c) { return [r5(c[0]), r5(c[1])]; });
        o.layer = lyr;
        o.name = a.name || ''; o.en = a.en || ''; o.he = a.he || '';
        o.active = a.active === 'weekend' ? 'weekend' : 'always';
        return o;
      });
      polys = polys.filter(function (p) { return (p.layer || '') !== lyr; }).concat(loaded);
      savePolys(); render(); redraw();
    }).catch(function (e) { alert('Failed to load known areas: ' + e); });
  }

  // ---- actions ----------------------------------------------------------
  function addPoint(latlng) {
    points.push({ lat: r5(latlng.lat), lng: r5(latlng.lng), report: curType, layer: currentLayer() });
    savePoints(); render(); redraw();
  }
  function addVertex(latlng) {
    // Click near the first vertex (>=3 placed) closes the ring.
    if (draft.length >= 3) {
      var a = map.latLngToContainerPoint(latlng);
      var b = map.latLngToContainerPoint(draft[0]);
      if (a.distanceTo(b) <= 12) { finishPoly(); return; }
    }
    draft.push(latlng); render(); redraw();
  }
  function finishPoly() {
    if (draft.length < 3) { draft = []; render(); redraw(); return; }
    polys.push({ coords: draft.map(function (ll) { return [r5(ll.lat), r5(ll.lng)]; }), layer: currentLayer(), name: '', en: '', he: '', active: 'always' });
    draft = []; savePolys(); render(); redraw();
  }

  // ---- panel ------------------------------------------------------------
  var countEl, taEl, finishBtn, typeRow;
  var dupeWarning = '';   // set by json() point mode; surfaced in the count line below
  function render() {
    if (taEl) taEl.value = json();   // sets dupeWarning as a side effect, before countEl reads it
    if (countEl) {
      countEl.textContent = (mode === 'polygon'
        ? curPolys().length + ' / ' + polys.length + ' polys' + (draft.length ? ' (+' + draft.length + ')' : '') + ' (' + (currentLayer() || '—') + ')'
        : curPoints().length + ' / ' + points.length + ' pts (' + (currentLayer() || '—') + ')') +
        (dupeWarning ? '  ⚠ ' + dupeWarning : '');
    }
    if (finishBtn) finishBtn.style.display = mode === 'polygon' ? '' : 'none';
    if (typeRow) typeRow.style.display = mode === 'polygon' ? 'none' : '';
  }

  function setMode(m) {
    mode = m;
    draft = [];                                   // discard any half-drawn ring
    if (map && map.doubleClickZoom) { if (m === 'polygon') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable(); }
    render(); redraw();
  }

  function buildPanel() {
    var box = document.createElement('div');
    box.id = 'editor-panel';
    box.style.cssText =
      'position:fixed;top:60px;right:12px;z-index:100000;background:#141212;color:#fff;' +
      'font:12px/1.4 sans-serif;padding:10px;border-radius:8px;width:240px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.5);direction:ltr';
    box.innerHTML =
      '<div id="ed-head" style="font-weight:700;margin-bottom:6px;cursor:move;user-select:none">⠿ Editor <span id="ed-count" style="float:right;font-weight:400;opacity:.8"></span></div>' +
      '<div style="margin-bottom:6px">Mode: ' +
      '<label style="margin-right:8px"><input type="radio" name="ed-m" value="point" checked> point</label>' +
      '<label><input type="radio" name="ed-m" value="polygon"> polygon</label></div>' +
      '<div id="ed-type" style="margin-bottom:6px">' +
      '<label style="margin-right:8px"><input type="radio" name="ed-t" value="mandatory"> mandatory</label>' +
      '<label><input type="radio" name="ed-t" value="onRequest" checked> on-request</label></div>' +
      '<div style="opacity:.8;margin-bottom:6px">Point: click add · click marker to name (blank deletes) · shift-click marker to delete.<br>Polygon: click vertices · dbl-click / Finish / click 1st vertex to close · click polygon to set name/en/he + active (always/weekend) · shift-click to delete · “Load known” imports the shipped bubbles.</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">' +
      '<button id="ed-finish" type="button">Finish</button>' +
      '<button id="ed-load" type="button">Load known</button>' +
      '<button id="ed-undo" type="button">Undo</button>' +
      '<button id="ed-clear" type="button">Clear</button></div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px">' +
      '<button id="ed-copy" type="button">Copy JSON</button>' +
      '<button id="ed-dl" type="button">Download</button></div>' +
      '<textarea id="ed-json" readonly style="width:100%;height:120px;font:11px monospace;background:#0b0a0a;color:#bfe;border:1px solid #3a3636;border-radius:4px"></textarea>';
    document.body.appendChild(box);
    countEl = box.querySelector('#ed-count');
    taEl = box.querySelector('#ed-json');
    finishBtn = box.querySelector('#ed-finish');
    typeRow = box.querySelector('#ed-type');
    box.querySelectorAll('input[name=ed-m]').forEach(function (r) { r.addEventListener('change', function () { setMode(r.value); }); });
    box.querySelectorAll('input[name=ed-t]').forEach(function (r) { r.addEventListener('change', function () { curType = r.value; }); });
    finishBtn.onclick = finishPoly;
    box.querySelector('#ed-load').onclick = function () { if (mode === 'polygon') loadKnownAreas(); else loadKnown(); };
    box.querySelector('#ed-undo').onclick = function () {
      var cur = currentLayer();
      if (mode === 'polygon') {
        if (draft.length) draft.pop();
        else { for (var j = polys.length - 1; j >= 0; j--) { if ((polys[j].layer || '') === cur) { polys.splice(j, 1); break; } } savePolys(); }
      } else {
        for (var i = points.length - 1; i >= 0; i--) { if ((points[i].layer || '') === cur) { points.splice(i, 1); break; } }
        savePoints();
      }
      render(); redraw();
    };
    box.querySelector('#ed-clear').onclick = function () {
      var cur = currentLayer();
      if (mode === 'polygon') {
        if ((curPolys().length || draft.length) && !confirm('Clear polygons on this layer?')) return;
        draft = []; polys = polys.filter(function (p) { return (p.layer || '') !== cur; }); savePolys();
      } else {
        if (curPoints().length && !confirm('Clear points on this layer?')) return;
        points = points.filter(function (p) { return (p.layer || '') !== cur; }); savePoints();
      }
      render(); redraw();
    };
    box.querySelector('#ed-copy').onclick = function () {
      taEl.select();
      if (navigator.clipboard) navigator.clipboard.writeText(json()).catch(function () { document.execCommand('copy'); });
      else document.execCommand('copy');
    };
    box.querySelector('#ed-dl').onclick = function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
      a.download = 'editor-' + Date.now() + '.json'; a.click();
      URL.revokeObjectURL(a.href);
    };
    makeDraggable(box, box.querySelector('#ed-head'));
    render();
  }

  function makeDraggable(box, handle) {
    var sx, sy, ox, oy, dragging = false;
    handle.addEventListener('pointerdown', function (e) {
      dragging = true; sx = e.clientX; sy = e.clientY;
      var r = box.getBoundingClientRect(); ox = r.left; oy = r.top;
      box.style.right = 'auto'; box.style.left = ox + 'px'; box.style.top = oy + 'px';
      handle.setPointerCapture(e.pointerId); e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var nx = Math.max(0, Math.min(window.innerWidth - 40, ox + e.clientX - sx));
      var ny = Math.max(0, Math.min(window.innerHeight - 20, oy + e.clientY - sy));
      box.style.left = nx + 'px'; box.style.top = ny + 'px';
    });
    handle.addEventListener('pointerup', function () { dragging = false; });
  }

  function init() {
    if (typeof map === 'undefined' || typeof L === 'undefined') { setTimeout(init, 200); return; }
    var st = document.createElement('style');
    st.textContent = '@keyframes edFlash{0%,100%{opacity:1}50%{opacity:.15}} .editor-flash{animation:edFlash 1s ease-in-out infinite}';
    document.head.appendChild(st);
    buildPanel();
    redraw();
    map.on('click', function (e) { if (mode === 'polygon') addVertex(e.latlng); else addPoint(e.latlng); });
    map.on('dblclick', function (e) { if (mode === 'polygon') { L.DomEvent.stop(e); finishPoly(); } });
    map.on('layeradd layerremove baselayerchange', function () { if (_redrawing) return; render(); redraw(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
