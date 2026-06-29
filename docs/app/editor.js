// editor.js — hidden point-editor tool for digitizing map features by hand.
// Enable with ?editor=1 (or localStorage 'navaid.editor.on'='1'). A small
// floating panel lets you pick a point type, click the map to drop points, and
// export them as JSON to paste back for processing. Fully self-contained: no
// coupling to the route/state model, so it can't corrupt a real route.
(function () {
  'use strict';
  function enabled() {
    try {
      if (/[?&]editor=1\b/.test(location.search)) { localStorage.setItem('navaid.editor.on', '1'); return true; }
      return localStorage.getItem('navaid.editor.on') === '1';
    } catch (e) { return /[?&]editor=1\b/.test(location.search); }
  }
  if (!enabled()) return;

  var KEY = 'navaid.editor.points';
  // Known waypoint sources per base layer — loaded into the editor for editing.
  var KNOWN = {
    'CVFR': 'data/nav-waypoints.json',
    'Navigation': 'data/nav-waypoints.json',
    'Low Alt': 'data/lsa-waypoints.json'
  };
  var r5 = function (x) { return Math.round(x * 1e5) / 1e5; };
  var points = [];
  try { points = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { points = []; }
  if (!Array.isArray(points)) points = [];
  var curType = 'mandatory';
  var group = null;     // L.layerGroup of markers

  function save() { try { localStorage.setItem(KEY, JSON.stringify(points)); } catch (e) {} }

  // Current base layer name (CVFR / Navigation / Low Alt / …); '' if unknown.
  function currentLayer() {
    if (typeof layers === 'undefined' || typeof map === 'undefined') return '';
    for (var k in layers) if (map.hasLayer(layers[k])) return k;
    return '';
  }

  function marker(p, i) {
    var color = '#0aa3c2';
    var fill = p.report === 'mandatory' ? color : 'none';
    var html =
      '<svg width="20" height="20" viewBox="0 0 20 20">' +
      '<polygon points="10,2 18,17 2,17" fill="' + fill + '" stroke="' + color +
      '" stroke-width="2"/></svg>';
    var icon = L.divIcon({ className: 'editor-icon', html: html, iconSize: [20, 20], iconAnchor: [10, 13] });
    var m = L.marker([p.lat, p.lng], { icon: icon, keyboard: false, draggable: true });
    if (p.name) m.bindTooltip(String(p.name), { direction: 'right', offset: [8, 0] });
    m.on('click', function (ev) {                 // click a marker to delete it
      L.DomEvent.stopPropagation(ev);
      points.splice(i, 1); save(); render(); redraw();
    });
    m.on('dragend', function (ev) {               // drag to fine-tune position
      var ll = ev.target.getLatLng();
      points[i].lat = r5(ll.lat); points[i].lng = r5(ll.lng);
      save(); render();                           // update JSON; marker stays where dropped
    });
    return m;
  }
  var _redrawing = false;
  function redraw() {
    if (!group) { group = L.layerGroup().addTo(map); }
    _redrawing = true;                 // suppress our own layeradd/remove events
    group.clearLayers();
    var cur = currentLayer();
    // Show only points captured on the currently selected base layer.
    points.forEach(function (p, i) { if ((p.layer || '') === cur) group.addLayer(marker(p, i)); });
    _redrawing = false;
  }

  function curPoints() {
    var cur = currentLayer();
    return points.filter(function (p) { return (p.layer || '') === cur; });
  }
  // Export the selected layer's points only.
  function json() {
    return JSON.stringify(curPoints().map(function (p) {
      var o = { lat: p.lat, lng: p.lng, report: p.report };
      if (p.name) o.name = p.name;
      if (p.he) o.he = p.he;
      return o;
    }), null, 2);
  }

  // Replace the current layer's points with its known waypoint set, for editing.
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
      save(); render(); redraw();
    }).catch(function (e) { alert('Failed to load known set: ' + e); });
  }

  var countEl, taEl;
  function render() {
    if (countEl) countEl.textContent = curPoints().length + ' / ' + points.length + ' pts (' + (currentLayer() || '—') + ')';
    if (taEl) taEl.value = json();
  }

  function addPoint(latlng) {
    points.push({ lat: r5(latlng.lat), lng: r5(latlng.lng), report: curType, layer: currentLayer() });
    save(); render(); redraw();
  }

  function buildPanel() {
    var box = document.createElement('div');
    box.id = 'editor-panel';
    box.style.cssText =
      'position:fixed;top:60px;right:12px;z-index:100000;background:#141212;color:#fff;' +
      'font:12px/1.4 sans-serif;padding:10px;border-radius:8px;width:230px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.5);direction:ltr';
    box.innerHTML =
      '<div id="ed-head" style="font-weight:700;margin-bottom:6px;cursor:move;user-select:none">⠿ Editor <span id="ed-count" style="float:right;font-weight:400;opacity:.8"></span></div>' +
      '<div style="margin-bottom:6px">' +
      '<label style="margin-right:8px"><input type="radio" name="ed-t" value="mandatory" checked> mandatory</label>' +
      '<label><input type="radio" name="ed-t" value="onRequest"> on-request</label></div>' +
      '<div style="opacity:.8;margin-bottom:6px">Click map to add · click a marker to delete</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px">' +
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
    box.querySelectorAll('input[name=ed-t]').forEach(function (r) {
      r.addEventListener('change', function () { curType = r.value; });
    });
    box.querySelector('#ed-load').onclick = loadKnown;
    box.querySelector('#ed-undo').onclick = function () {
      var cur = currentLayer();
      for (var i = points.length - 1; i >= 0; i--) { if ((points[i].layer || '') === cur) { points.splice(i, 1); break; } }
      save(); render(); redraw();
    };
    box.querySelector('#ed-clear').onclick = function () {
      var cur = currentLayer();
      if (curPoints().length && !confirm('Clear captured points on this layer?')) return;
      points = points.filter(function (p) { return (p.layer || '') !== cur; });
      save(); render(); redraw();
    };
    makeDraggable(box, box.querySelector('#ed-head'));
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
    render();
  }

  // Drag the panel by its header (pointer-based; keeps it within the viewport).
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
    buildPanel();
    redraw();
    map.on('click', function (e) { addPoint(e.latlng); });
    // Base-layer switches change which captured points are shown.
    map.on('layeradd layerremove baselayerchange', function () { if (_redrawing) return; render(); redraw(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
