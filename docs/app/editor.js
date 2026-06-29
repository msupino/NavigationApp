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
  var KNOWN = {
    'CVFR': 'data/cvfr-nav-waypoints.json',
    'Navigation': 'data/cvfr-nav-waypoints.json',
    'Low Alt': 'data/lsa-nav-waypoints.json'
  };
  var COLOR = '#0aa3c2';
  var r5 = function (x) { return Math.round(x * 1e5) / 1e5; };

  function load(key) { try { var a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  var points = load(KEY);
  var polys = load(PKEY);
  var draft = [];               // in-progress polygon: array of L.latLng
  var mode = 'point';           // 'point' | 'polygon'
  var curType = 'onRequest';
  var group = null;

  function savePoints() { try { localStorage.setItem(KEY, JSON.stringify(points)); } catch (e) {} }
  function savePolys() { try { localStorage.setItem(PKEY, JSON.stringify(polys)); } catch (e) {} }

  function currentLayer() {
    if (typeof layers === 'undefined' || typeof map === 'undefined') return '';
    for (var k in layers) if (map.hasLayer(layers[k])) return k;
    return '';
  }
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
    if (p.name) m.bindTooltip(String(p.name), { direction: 'right', offset: [8, 0] });
    // Unnamed points: swallow mousedown so the app's nav-WP hit-test (inspector)
    // underneath doesn't fire — clicking one should ONLY open the name setter.
    if (!named) m.on('mousedown', function (ev) { L.DomEvent.stopPropagation(ev); });
    m.on('click', function (ev) {                 // click to name (blank = delete)
      L.DomEvent.stopPropagation(ev);
      var name = prompt('Waypoint name (blank to delete):', points[i].name || '');
      if (name === null) return;                  // cancel — no change
      name = name.trim();
      if (name) points[i].name = name; else points.splice(i, 1);
      savePoints(); render(); redraw();           // name lands in the exported JSON
    });
    m.on('dragend', function (ev) { var ll = ev.target.getLatLng(); points[i].lat = r5(ll.lat); points[i].lng = r5(ll.lng); savePoints(); render(); });
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
      var poly = L.polygon(pg.coords, { color: COLOR, weight: 2, fillColor: COLOR, fillOpacity: 0.12 });
      if (pg.name) poly.bindTooltip(String(pg.name), { sticky: true });
      poly.on('click', function (ev) {            // click a polygon to delete it
        L.DomEvent.stopPropagation(ev);
        if (!confirm('Delete this polygon?')) return;
        polys.splice(i, 1); savePolys(); render(); redraw();
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
      return JSON.stringify(curPolys().map(function (pg) {
        var o = { type: 'polygon', coords: pg.coords };
        if (pg.name) o.name = pg.name;
        return o;
      }), null, 2);
    }
    return JSON.stringify(curPoints().map(function (p) {
      var o = { lat: p.lat, lng: p.lng, report: p.report };
      if (p.name) o.name = p.name;
      if (p.he) o.he = p.he;
      return o;
    }), null, 2);
  }

  function loadKnown() {
    var lyr = currentLayer();
    var url = KNOWN[lyr];
    if (!url) { alert('No known waypoint set for ' + (lyr || 'this layer')); return; }
    if (curPoints().length && !confirm('Replace ' + curPoints().length + ' point(s) on ' + lyr + ' with the known set?')) return;
    fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (d) {
      var arr = Array.isArray(d) ? d : (d.points || d.waypoints || []);
      var loaded = arr.filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); }).map(function (p) {
        var rep = p.report === 'mandatory' ? 'mandatory' : (p.report === 'onRequest' ? 'onRequest' : curType);
        return { lat: r5(p.lat), lng: r5(p.lng), report: rep, layer: lyr, name: p.name || '', he: p.he || '' };
      });
      points = points.filter(function (p) { return (p.layer || '') !== lyr; }).concat(loaded);
      savePoints(); render(); redraw();
    }).catch(function (e) { alert('Failed to load known set: ' + e); });
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
    polys.push({ coords: draft.map(function (ll) { return [r5(ll.lat), r5(ll.lng)]; }), layer: currentLayer(), name: '' });
    draft = []; savePolys(); render(); redraw();
  }

  // ---- panel ------------------------------------------------------------
  var countEl, taEl, finishBtn, typeRow;
  function render() {
    if (countEl) {
      countEl.textContent = mode === 'polygon'
        ? curPolys().length + ' / ' + polys.length + ' polys' + (draft.length ? ' (+' + draft.length + ')' : '') + ' (' + (currentLayer() || '—') + ')'
        : curPoints().length + ' / ' + points.length + ' pts (' + (currentLayer() || '—') + ')';
    }
    if (taEl) taEl.value = json();
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
      '<div style="opacity:.8;margin-bottom:6px">Point: click add · marker to name (blank deletes).<br>Polygon: click vertices · dbl-click / Finish / click 1st vertex to close · polygon to delete.</div>' +
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
    box.querySelector('#ed-load').onclick = loadKnown;
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
