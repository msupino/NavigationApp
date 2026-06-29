// capture.js — hidden point-capture tool for digitizing map features by hand.
// Enable with ?capture=1 (or localStorage 'navaid.capture.on'='1'). A small
// floating panel lets you pick a point type, click the map to drop points, and
// export them as JSON to paste back for processing. Fully self-contained: no
// coupling to the route/state model, so it can't corrupt a real route.
(function () {
  'use strict';
  function enabled() {
    try {
      if (/[?&]capture=1\b/.test(location.search)) { localStorage.setItem('navaid.capture.on', '1'); return true; }
      return localStorage.getItem('navaid.capture.on') === '1';
    } catch (e) { return /[?&]capture=1\b/.test(location.search); }
  }
  if (!enabled()) return;

  var KEY = 'navaid.capture.points';
  var r5 = function (x) { return Math.round(x * 1e5) / 1e5; };
  var points = [];
  try { points = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { points = []; }
  if (!Array.isArray(points)) points = [];
  var curType = 'mandatory';
  var group = null;     // L.layerGroup of markers

  function save() { try { localStorage.setItem(KEY, JSON.stringify(points)); } catch (e) {} }

  function marker(p, i) {
    var color = '#0aa3c2';
    var fill = p.report === 'mandatory' ? color : 'none';
    var html =
      '<svg width="20" height="20" viewBox="0 0 20 20">' +
      '<polygon points="10,2 18,17 2,17" fill="' + fill + '" stroke="' + color +
      '" stroke-width="2"/></svg>';
    var icon = L.divIcon({ className: 'capture-icon', html: html, iconSize: [20, 20], iconAnchor: [10, 13] });
    var m = L.marker([p.lat, p.lng], { icon: icon, keyboard: false });
    m.on('click', function (ev) {                 // click a marker to delete it
      L.DomEvent.stopPropagation(ev);
      points.splice(i, 1); save(); render(); redraw();
    });
    return m;
  }
  function redraw() {
    if (!group) { group = L.layerGroup().addTo(map); }
    group.clearLayers();
    points.forEach(function (p, i) { group.addLayer(marker(p, i)); });
  }

  function json() {
    return JSON.stringify(points.map(function (p) {
      return { lat: p.lat, lng: p.lng, report: p.report };
    }), null, 2);
  }

  var countEl, taEl;
  function render() {
    if (countEl) countEl.textContent = points.length + ' pts';
    if (taEl) taEl.value = json();
  }

  function addPoint(latlng) {
    points.push({ lat: r5(latlng.lat), lng: r5(latlng.lng), report: curType });
    save(); render(); redraw();
  }

  function buildPanel() {
    var box = document.createElement('div');
    box.id = 'capture-panel';
    box.style.cssText =
      'position:fixed;top:60px;right:12px;z-index:100000;background:#141212;color:#fff;' +
      'font:12px/1.4 sans-serif;padding:10px;border-radius:8px;width:230px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.5);direction:ltr';
    box.innerHTML =
      '<div style="font-weight:700;margin-bottom:6px">Capture <span id="cap-count" style="float:right;font-weight:400;opacity:.8"></span></div>' +
      '<div style="margin-bottom:6px">' +
      '<label style="margin-right:8px"><input type="radio" name="cap-t" value="mandatory" checked> mandatory</label>' +
      '<label><input type="radio" name="cap-t" value="onRequest"> on-request</label></div>' +
      '<div style="opacity:.8;margin-bottom:6px">Click map to add · click a marker to delete</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px">' +
      '<button id="cap-undo" type="button">Undo</button>' +
      '<button id="cap-clear" type="button">Clear</button>' +
      '<button id="cap-copy" type="button">Copy JSON</button>' +
      '<button id="cap-dl" type="button">Download</button></div>' +
      '<textarea id="cap-json" readonly style="width:100%;height:120px;font:11px monospace;background:#0b0a0a;color:#bfe;border:1px solid #3a3636;border-radius:4px"></textarea>';
    document.body.appendChild(box);
    countEl = box.querySelector('#cap-count');
    taEl = box.querySelector('#cap-json');
    box.querySelectorAll('input[name=cap-t]').forEach(function (r) {
      r.addEventListener('change', function () { curType = r.value; });
    });
    box.querySelector('#cap-undo').onclick = function () { points.pop(); save(); render(); redraw(); };
    box.querySelector('#cap-clear').onclick = function () {
      if (points.length && !confirm('Clear all captured points?')) return;
      points = []; save(); render(); redraw();
    };
    box.querySelector('#cap-copy').onclick = function () {
      taEl.select();
      if (navigator.clipboard) navigator.clipboard.writeText(json()).catch(function () { document.execCommand('copy'); });
      else document.execCommand('copy');
    };
    box.querySelector('#cap-dl').onclick = function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
      a.download = 'capture-' + Date.now() + '.json'; a.click();
      URL.revokeObjectURL(a.href);
    };
    render();
  }

  function init() {
    if (typeof map === 'undefined' || typeof L === 'undefined') { setTimeout(init, 200); return; }
    buildPanel();
    redraw();
    map.on('click', function (e) { addPoint(e.latlng); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
