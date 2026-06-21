'use strict';
/* NavAid — toolbar wiring, toolbar drag, boot, PWA.
   Shares globals with core.js; loaded last. */

// --- toolbar ---------------------------------------------------------
function setMode(mode) {
  // Clicking the currently-active mode button toggles back to inspect (null).
  if (state.mode === mode) mode = null;
  state.mode = mode;
  const addBtn = document.getElementById('tool-add');
  const noteBtn = document.getElementById('tool-note');
  addBtn.classList.toggle('active', mode === 'add');
  noteBtn.classList.toggle('active', mode === 'note');
  // Accessibility: aria-pressed mirrors the .active class so screen
  // readers announce the toggle state. The mode buttons are exclusive
  // (only one of add / note can be active at once), so flipping both
  // here keeps them in sync no matter which mode we entered or left.
  addBtn.setAttribute('aria-pressed', String(mode === 'add'));
  noteBtn.setAttribute('aria-pressed', String(mode === 'note'));
  document.getElementById('map').classList.toggle('add', mode === 'add' || mode === 'note');
}
document.getElementById('tool-add').onclick = () => setMode('add');
document.getElementById('tool-note').onclick = () => setMode('note');
// Initial aria-pressed sync — both modes start off so each button is
// explicitly "not pressed" in the a11y tree on first paint.
document.getElementById('tool-add').setAttribute('aria-pressed', 'false');
document.getElementById('tool-note').setAttribute('aria-pressed', 'false');
document.getElementById('app-version').textContent = 'v' + NavAid.version;
// Mirror the version under the map legend (shown on the desktop layout, where
// the menu bar hides #app-version).
{
  const lv = document.getElementById('legend-version');
  if (lv) lv.textContent = 'v' + NavAid.version;
}

// base map layer picker (replaces the Leaflet layers control)
const layerSelect = document.getElementById('layer-select');
for (const name in layers) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = (S.layerLabels && S.layerLabels[name]) || name;
  if (map.hasLayer(layers[name])) opt.selected = true;
  layerSelect.appendChild(opt);
}
layerSelect.onchange = () => {
  for (const name in layers) {
    if (name !== layerSelect.value && map.hasLayer(layers[name])) {
      map.removeLayer(layers[name]);
    }
  }
  map.addLayer(layers[layerSelect.value]);
  applyMapOpacity();
  draw();                                // keep the route overlay on top
  try { localStorage.setItem(LAYER_KEY, layerSelect.value); }
  catch (e) { /* storage unavailable */ }
};

// --- rotate dial — a map control next to the zoom buttons -----------
const rotateCtrl = L.control({ position: 'bottomright' });
rotateCtrl.onAdd = function () {
  const wrap = L.DomUtil.create('div', 'leaflet-control rotate-ctrl');
  wrap.innerHTML = '<input id="rotate-hdg" type="number" min="0" max="360" step="1" value="0">' +
                   '<span id="rotate-dial" role="slider" tabindex="0">' +
                   '<span id="rotate-needle"></span>' +
                   '</span>';
  L.DomEvent.disableClickPropagation(wrap);
  L.DomEvent.disableScrollPropagation(wrap);
  return wrap;
};
rotateCtrl.addTo(map);
const rotDial = document.getElementById('rotate-dial');
const rotNeedle = document.getElementById('rotate-needle');
const rotHdg = document.getElementById('rotate-hdg');
function mapBearing() { return map.getBearing ? map.getBearing() : 0; }
function refreshDial() {
  const b = (((360 - Math.round(mapBearing())) % 360) + 360) % 360;
  rotNeedle.style.transform = 'rotate(' + b + 'deg)';
  rotDial.title = S.dialTitle(b);
  if (document.activeElement !== rotHdg) rotHdg.value = b;
}
rotHdg.addEventListener('change', () => {
  // Empty / non-numeric input would flow through as NaN and could persist
  // 'NaN' to localStorage, breaking rotation until reload (issue #75).
  // Snap the field back to the current dial value and bail out instead.
  const raw = parseInt(rotHdg.value, 10);
  if (!Number.isFinite(raw)) { refreshDial(); return; }
  const v = ((raw % 360) + 360) % 360;
  rotHdg.value = v;
  map.setBearing((360 - v) % 360);
});
rotHdg.addEventListener('keydown', e => {
  if (e.key === 'Enter') rotHdg.blur();
});
rotHdg.addEventListener('click', e => e.stopPropagation());
rotHdg.addEventListener('pointerdown', e => e.stopPropagation());
function dialAngle(ev) {                 // 0 = north (up), clockwise positive
  const r = rotDial.getBoundingClientRect();
  const dx = ev.clientX - (r.left + r.width / 2);
  const dy = ev.clientY - (r.top + r.height / 2);
  return Math.atan2(dx, -dy) * 180 / Math.PI;
}
let rotDragging = false;
let rotMoved = false;
let rotStartX = 0, rotStartY = 0;
rotDial.addEventListener('pointerdown', e => {
  rotDragging = true;
  rotMoved = false;
  rotStartX = e.clientX;
  rotStartY = e.clientY;
  rotDial.classList.add('dragging');
  rotDial.setPointerCapture(e.pointerId);
});
rotDial.addEventListener('pointermove', e => {
  if (!rotDragging) return;
  if (!rotMoved) {
    if (Math.hypot(e.clientX - rotStartX, e.clientY - rotStartY) < tune('rotDragPx')) return;
    rotMoved = true;
  }
  map.setBearing(((360 - dialAngle(e)) % 360 + 360) % 360);
});
function rotEnd(cycle) {
  if (cycle && rotDragging && !rotMoved) {
    // Tap steps the bearing through 0° / 90° / 180° / 270°.
    // From an off-axis angle the first tap snaps back to north.
    const shown = (((360 - Math.round(mapBearing())) % 360) + 360) % 360;
    const next = shown % 90 === 0 ? (shown + 90) % 360 : 0;
    map.setBearing((360 - next) % 360);
  }
  rotDragging = false;
  rotDial.classList.remove('dragging');
}
rotDial.addEventListener('pointerup', () => rotEnd(true));
rotDial.addEventListener('pointercancel', () => rotEnd(false));   // aborted — don't rotate
// --- Zulu clock ------------------------------------------------------
// A compact UTC clock for flight planning. It is intentionally not localized:
// Zulu time is always left-to-right HH:MM:SSZ.
function formatZuluClockTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z';
}
window.formatZuluClockTime = formatZuluClockTime;
function cssRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 'rgba(0, 0, 0, ' + alpha + ')';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}
function applyTuningCssVars() {
  const root = document.documentElement.style;
  const px = (cssVar, key) => root.setProperty(cssVar, tune(key) + 'px');
  px('--navaid-inspector-default-top', 'inspectorDefaultTopPx');
  root.setProperty('--navaid-inspector-max-height-offset',
    (tune('inspectorDefaultTopPx') + tune('inspectorBottomGapPx')) + 'px');

  px('--navaid-zulu-clock-min-width', 'zuluClockMinWidthPx');
  px('--navaid-zulu-clock-pad-y', 'zuluClockPadYPx');
  px('--navaid-zulu-clock-pad-x', 'zuluClockPadXPx');
  px('--navaid-zulu-clock-margin-top', 'zuluClockMarginTopPx');
  px('--navaid-zulu-clock-margin-right', 'zuluClockMarginRightPx');
  px('--navaid-zulu-clock-font-size', 'zuluClockFontPx');
  root.setProperty('--navaid-zulu-clock-font-weight', tune('zuluClockFontWeight'));
  root.setProperty('--navaid-zulu-clock-line-height', tune('zuluClockLineHeight'));
  root.setProperty('--navaid-zulu-clock-text-color', tune('zuluClockTextColor'));
  root.setProperty('--navaid-zulu-clock-bg',
    cssRgba(tune('zuluClockBgColor'), tune('zuluClockBgAlpha')));
  root.setProperty('--navaid-zulu-clock-border',
    tune('zuluClockBorderWidthPx') + 'px solid ' + tune('zuluClockBorderColor'));
  px('--navaid-zulu-clock-border-radius', 'zuluClockBorderRadiusPx');
  root.setProperty('--navaid-zulu-clock-shadow',
    '0 ' + tune('zuluClockShadowYPx') + 'px ' + tune('zuluClockShadowBlurPx') +
    'px rgba(0, 0, 0, ' + tune('zuluClockShadowAlpha') + ')');
}
window.applyTuningCssVars = applyTuningCssVars;
applyTuningCssVars();
const zuluClockCtrl = L.control({ position: 'topright' });
zuluClockCtrl.onAdd = function () {
  const box = L.DomUtil.create('div', 'leaflet-control zulu-clock');
  box.id = 'zulu-clock';
  box.dir = 'ltr';
  box.title = 'Zulu time (UTC)';
  box.setAttribute('aria-label', 'Zulu time (UTC)');
  box.setAttribute('aria-live', 'off');
  return box;
};
zuluClockCtrl.addTo(map);
const zuluClockBox = document.getElementById('zulu-clock');
function refreshZuluClock() {
  if (zuluClockBox) zuluClockBox.textContent = formatZuluClockTime(new Date());
}
refreshZuluClock();
setInterval(refreshZuluClock, 1000);

// Draggable Zulu clock — drag it anywhere; the spot persists across reloads
// under navaid.clockPos. Mirrors the inspector/toolbar drag pattern. Dragging
// pins it with position:fixed (and clears the desktop translateY offset) so it
// leaves the Leaflet top-right control flow.
(function makeClockDraggable() {
  const box = document.getElementById('zulu-clock');
  if (!box) return;
  const KEY = 'navaid.clockPos';
  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
  }
  function applyPos(x, y) {
    const maxX = Math.max(0, window.innerWidth - box.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - box.offsetHeight);
    box.style.position = 'fixed';
    box.style.left = Math.max(0, Math.min(maxX, x)) + 'px';
    box.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
    box.style.right = 'auto';
    box.style.margin = '0';
    box.style.transform = 'none';   // cancel the desktop below-the-bar offset
  }
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) applyPos(p.x, p.y);
  } catch (e) { /* storage unavailable */ }
  function start(cx, cy) {
    const r = box.getBoundingClientRect();
    const off = { x: cx - r.left, y: cy - r.top };
    box.classList.add('dragging');
    const move = (mx, my) => applyPos(mx - off.x, my - off.y);
    const mm = ev => move(ev.clientX, ev.clientY);
    const tm = ev => { if (ev.touches.length === 1) { ev.preventDefault(); move(ev.touches[0].clientX, ev.touches[0].clientY); } };
    const end = () => {
      box.classList.remove('dragging');
      const r2 = box.getBoundingClientRect();
      try { localStorage.setItem(KEY, JSON.stringify({ x: r2.left, y: r2.top })); }
      catch (e) { /* storage unavailable */ }
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', end);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', end);
    window.addEventListener('touchmove', tm, { passive: false });
    window.addEventListener('touchend', end);
  }
  box.addEventListener('mousedown', e => { e.preventDefault(); start(e.clientX, e.clientY); });
  box.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { e.preventDefault(); start(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: false });
})();
// --- map legend (bottom-left) ---------------------------------------
// The legend markup lives in index.html so applyI18n() fills its text at
// boot; here we lift that element into a Leaflet control so it floats over
// the map (a chart legend) instead of sitting inside the View menu (#526).
// Bottom-left (above the coord readout) keeps it clear of the inspector
// (top-right), the toolbar (top-left) and the rotate dial (bottom-right).
const legendCtrl = L.control({ position: 'bottomleft' });
legendCtrl.onAdd = function () {
  const wrap = L.DomUtil.create('div', 'leaflet-control');
  const el = document.getElementById('map-legend');
  if (el) { el.style.display = ''; wrap.appendChild(el); }
  L.DomEvent.disableClickPropagation(wrap);
  L.DomEvent.disableScrollPropagation(wrap);
  return wrap;
};
legendCtrl.addTo(map);

// Draggable legend — drag it anywhere; the spot persists under
// navaid.legendPos. Same pattern as the Zulu clock above.
(function makeLegendDraggable() {
  const box = document.getElementById('map-legend');
  if (!box) return;
  const KEY = 'navaid.legendPos';
  function applyPos(x, y) {
    const maxX = Math.max(0, window.innerWidth - box.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - box.offsetHeight);
    box.style.position = 'fixed';
    box.style.left = Math.max(0, Math.min(maxX, x)) + 'px';
    box.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    box.style.margin = '0';
  }
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) applyPos(p.x, p.y);
  } catch (e) { /* storage unavailable */ }
  function start(cx, cy) {
    const r = box.getBoundingClientRect();
    const off = { x: cx - r.left, y: cy - r.top };
    box.classList.add('dragging');
    const move = (mx, my) => applyPos(mx - off.x, my - off.y);
    const mm = ev => move(ev.clientX, ev.clientY);
    const tm = ev => { if (ev.touches.length === 1) { ev.preventDefault(); move(ev.touches[0].clientX, ev.touches[0].clientY); } };
    const end = () => {
      box.classList.remove('dragging');
      const r2 = box.getBoundingClientRect();
      try { localStorage.setItem(KEY, JSON.stringify({ x: r2.left, y: r2.top })); }
      catch (e) { /* storage unavailable */ }
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', end);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', end);
    window.addEventListener('touchmove', tm, { passive: false });
    window.addEventListener('touchend', end);
  }
  box.addEventListener('mousedown', e => { e.preventDefault(); start(e.clientX, e.clientY); });
  box.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { e.preventDefault(); start(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: false });
})();

// --- live mouse coordinate readout ---------------------------------
// Bottom-right, sat to the LEFT of the zoom +/- + rotate-dial column (CSS
// offsets it clear of those buttons) so it no longer collides with the
// bottom-left legend (#526). Updates on every map mousemove with the same
// DM format the inspector uses for waypoints (fmtLatLng).
const coordCtrl = L.control({ position: 'bottomright' });
coordCtrl.onAdd = function () {
  const box = L.DomUtil.create('div', 'leaflet-control coord-readout');
  box.id = 'coord-readout';
  box.setAttribute('aria-hidden', 'true');
  return box;
};
coordCtrl.addTo(map);
const coordBox = document.getElementById('coord-readout');

// --- zoom level readout ---------------------------------------------
// Sits above the zoom +/- buttons in the bottom-right corner.
const zoomCtrl = L.control({ position: 'bottomright' });
zoomCtrl.onAdd = function () {
  const box = L.DomUtil.create('div', 'leaflet-control zoom-readout');
  box.id = 'zoom-readout';
  return box;
};
zoomCtrl.addTo(map);
const zoomBox = document.getElementById('zoom-readout');

const vorReadoutCtrl = L.control({ position: 'bottomright' });
vorReadoutCtrl.onAdd = function () {
  const box = L.DomUtil.create('div', 'leaflet-control coord-readout vor-readout');
  box.id = 'vor-readout';
  box.setAttribute('aria-hidden', 'true');
  return box;
};
vorReadoutCtrl.addTo(map);
const vorReadoutBox = document.getElementById('vor-readout');

// Route-wide wind readout (#722) — bottom-right corner, above the coord/VOR
// readouts. Shown only when the wind is non-calm.
const windReadoutCtrl = L.control({ position: 'bottomright' });
windReadoutCtrl.onAdd = function () {
  const box = L.DomUtil.create('div', 'leaflet-control coord-readout wind-readout');
  box.id = 'wind-readout';
  box.setAttribute('aria-hidden', 'true');
  return box;
};
windReadoutCtrl.addTo(map);
const windReadoutBox = document.getElementById('wind-readout');

// SIGMET status readout — bottom-right, above the wind readout. Shows the
// active count (hover for the raw texts) or a calm "no SIGMET" note.
const sigmetReadoutCtrl = L.control({ position: 'bottomright' });
sigmetReadoutCtrl.onAdd = function () {
  const box = L.DomUtil.create('div', 'leaflet-control coord-readout sigmet-readout');
  box.id = 'sigmet-readout';
  box.dir = 'ltr';                  // SIGMET text is LTR even in Hebrew mode
  box.setAttribute('aria-hidden', 'true');
  return box;
};
sigmetReadoutCtrl.addTo(map);
const sigmetReadoutBox = document.getElementById('sigmet-readout');
if (sigmetReadoutBox) {
  L.DomEvent.disableClickPropagation(sigmetReadoutBox);
  // Click the readout → decoded SIGMET list.
  sigmetReadoutBox.addEventListener('click', () => {
    if (Array.isArray(sigmets) && sigmets.length && typeof showSigmetDecoded === 'function') {
      showSigmetDecoded();
    }
  });
}
function refreshSigmetReadout() {
  if (!sigmetReadoutBox) return;
  if (!window.showSigmet || !Array.isArray(sigmets)) {
    sigmetReadoutBox.classList.remove('show');
    sigmetReadoutBox.textContent = '';
    sigmetReadoutBox.removeAttribute('title');
    sigmetReadoutBox.setAttribute('aria-hidden', 'true');
    return;
  }
  const n = sigmets.length;
  sigmetReadoutBox.textContent = n ? S.sigmetReadout(n) : S.sigmetNone;
  sigmetReadoutBox.classList.toggle('sigmet-none', n === 0);
  if (n) {
    // Hover = decoded text; click opens the full decoded list.
    sigmetReadoutBox.title = sigmets.map(s =>
      (typeof decodeSigmet === 'function' ? decodeSigmet(s) : s.raw)).filter(Boolean).join('\n\n') +
      '\n\n(' + (S.sigmetReadoutClickHint || 'Click to decode') + ')';
    sigmetReadoutBox.style.cursor = 'pointer';
  } else {
    sigmetReadoutBox.removeAttribute('title');
    sigmetReadoutBox.style.cursor = 'default';
  }
  sigmetReadoutBox.classList.add('show');
  sigmetReadoutBox.setAttribute('aria-hidden', 'false');
}

function refreshWindReadout() {
  if (!windReadoutBox) return;
  const w = state.wind;
  const on = window.showWind &&
    w && Number.isFinite(w.speed) && w.speed > 0 && Number.isFinite(w.dir);
  windReadoutBox.textContent = on ? S.windReadout(pad3(w.dir), w.speed) : '';
  windReadoutBox.classList.toggle('show', !!on);
  windReadoutBox.setAttribute('aria-hidden', on ? 'false' : 'true');
}
// The readout doubles as a "go to coordinates" input (issue #497): it stays
// visible showing the map centre, follows the mouse on hover, and turns into
// an editable field on click. Make it interactive and keep clicks/scroll from
// leaking through to the map underneath.
coordBox.removeAttribute('aria-hidden');
coordBox.title = S.gotoTitle;
coordBox.classList.add('show', 'interactive');
L.DomEvent.disableClickPropagation(coordBox);
L.DomEvent.disableScrollPropagation(coordBox);

let gotoEditing = false;
function coordReadoutText(lat, lng) {
  return fmtLatLng(lat, 'N', 'S') + '  ' + fmtLatLng(lng, 'E', 'W');
}
function centerCoordText() {
  const c = map.getCenter();
  return coordReadoutText(c.lat, c.lng);
}
// When a reference VOR is selected, show its magnetic radial + DME for the
// point in a separate readout box below the live coordinates.
function vorReadoutText(lat, lng) {
  if (typeof activeVor !== 'function') return '';
  const v = activeVor();
  if (!v) return '';
  const rd = vorRadialDme(v, lat, lng);
  if (!rd) return '';
  return v.ident + ' ' + S.vorRadialDme(rd.radial, rd.dme);
}
function setVorReadout(text) {
  if (!vorReadoutBox) return;
  vorReadoutBox.textContent = text || '';
  vorReadoutBox.classList.toggle('show', !!text);
  vorReadoutBox.setAttribute('aria-hidden', text ? 'false' : 'true');
}
function showVorReadout(lat, lng) {
  setVorReadout(vorReadoutText(lat, lng));
}
function showZoom() {
  zoomBox.textContent = zoomReadoutText(map.getZoom());
}
function showCoord(latlng) {
  if (gotoEditing) return;
  coordBox.textContent = coordReadoutText(latlng.lat, latlng.lng);
  showVorReadout(latlng.lat, latlng.lng);
}
function showCenterCoord() {
  if (gotoEditing) return;
  const c = map.getCenter();
  coordBox.textContent = coordReadoutText(c.lat, c.lng);
  showVorReadout(c.lat, c.lng);
}
showCenterCoord();
showZoom();
map.on('mousemove', e => showCoord(e.latlng));
map.on('mouseout', showCenterCoord);
map.on('moveend zoomend', () => { showCenterCoord(); showZoom(); });
map.on('zoom', showZoom);

// --- temporary "look here" marker (not part of the route) ---------------
let gotoMarker = null;
function clearGotoMarker() {
  if (gotoMarker) { map.removeLayer(gotoMarker); gotoMarker = null; }
}
function dropGotoMarker(lat, lng) {
  clearGotoMarker();
  gotoMarker = L.circleMarker([lat, lng], {
    radius: 7, color: '#c0392b', weight: 2,
    fillColor: '#e74c3c', fillOpacity: 0.85,
    interactive: false, className: 'goto-marker',
  }).addTo(map);
}
// A genuine map click (drop waypoint, pan, etc.) dismisses the temp marker.
map.on('click', clearGotoMarker);
window.clearGotoMarker = clearGotoMarker;
window.dropGotoMarker = dropGotoMarker;
window.hasGotoMarker = () => !!gotoMarker;

// --- click-to-edit go-to input -----------------------------------------
function exitGotoEdit() {
  gotoEditing = false;
  coordBox.classList.remove('editing', 'error');
  coordBox.title = S.gotoTitle;
  showCenterCoord();
}
// Break a signed decimal degree into integer degrees/minutes/seconds, with
// the same 60->0 rollover carry as fmtLatLngDMS so the slots never read 60.
function dmsParts(v) {
  const deg = Math.abs(v);
  let d = Math.floor(deg);
  let m = Math.floor((deg - d) * 60);
  let s = Math.round((deg - d - m / 60) * 3600);
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; d += 1; }
  return { d, m, s };
}
function commitGoto() {
  const num = id => parseFloat(document.getElementById(id).value);
  const latD = num('goto-lat-d');
  const lngD = num('goto-lng-d');
  if (!Number.isFinite(latD) || !Number.isFinite(lngD)) {
    coordBox.classList.add('error');
    return false;
  }
  const latM = num('goto-lat-m') || 0;
  const latS = num('goto-lat-s') || 0;
  const lngM = num('goto-lng-m') || 0;
  const lngS = num('goto-lng-s') || 0;
  const lat = latD + latM / 60 + latS / 3600;
  const lng = lngD + lngM / 60 + lngS / 3600;
  const ll = finishLatLng(lat, lng);
  if (!ll) { coordBox.classList.add('error'); return false; }
  map.setView([ll.lat, ll.lng], Math.max(map.getZoom(), 11));
  dropGotoMarker(ll.lat, ll.lng);
  exitGotoEdit();
  return true;
}
// One editable numeric slot; `len` also caps the digits typed in.
function gotoSlot(id, value, len, label) {
  const i = document.createElement('input');
  i.type = 'text';
  i.inputMode = 'numeric';
  i.className = 'goto-num';
  i.id = id;
  i.maxLength = len;
  i.size = len;
  i.setAttribute('aria-label', label);
  i.value = len === 2 ? String(value).padStart(2, '0') : String(value);
  return i;
}
// Fill the six slots from a decimal lat/lng (used by paste).
function fillGotoSlots(lat, lng) {
  const la = dmsParts(lat), lo = dmsParts(lng);
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = String(v).padStart(2, '0');
  };
  set('goto-lat-d', la.d); set('goto-lat-m', la.m); set('goto-lat-s', la.s);
  set('goto-lng-d', lo.d); set('goto-lng-m', lo.m); set('goto-lng-s', lo.s);
}
function gotoSep(text) {
  const sep = document.createElement('span');
  sep.className = 'goto-sep';
  sep.textContent = text;
  return sep;
}
function enterGotoEdit() {
  if (gotoEditing) return;
  gotoEditing = true;
  coordBox.classList.add('editing');
  coordBox.classList.remove('error');
  const c = map.getCenter();
  const lat = dmsParts(c.lat);
  const lng = dmsParts(c.lng);
  coordBox.textContent = '';
  coordBox.setAttribute('aria-label', S.gotoTitle);
  coordBox.title = S.gotoError;
  const slots = [
    gotoSlot('goto-lat-d', lat.d, 2, S.latitude + ' deg'), gotoSep('°'),
    gotoSlot('goto-lat-m', lat.m, 2, S.latitude + ' min'), gotoSep('′'),
    gotoSlot('goto-lat-s', lat.s, 2, S.latitude + ' sec'), gotoSep('″'),
    gotoSep('N'), gotoSep(' '),
    gotoSlot('goto-lng-d', lng.d, 2, S.longitude + ' deg'), gotoSep('°'),
    gotoSlot('goto-lng-m', lng.m, 2, S.longitude + ' min'), gotoSep('′'),
    gotoSlot('goto-lng-s', lng.s, 2, S.longitude + ' sec'), gotoSep('″'),
    gotoSep('E'),
  ];
  const inputs = slots.filter(el => el.tagName === 'INPUT');
  for (const el of slots) coordBox.appendChild(el);
  for (let k = 0; k < inputs.length; k++) {
    const i = inputs[k];
    i.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitGoto(); }
      else if (e.key === 'Escape') { e.preventDefault(); exitGotoEdit(); }
      else { coordBox.classList.remove('error'); }
    });
    // Auto-advance once a slot is full, so typing flows left to right.
    i.addEventListener('input', () => {
      if (i.value.length >= i.maxLength && k < inputs.length - 1) {
        inputs[k + 1].focus();
        inputs[k + 1].select();
      }
    });
    // Pasting a full coordinate string fills every slot at once.
    i.addEventListener('paste', e => {
      const cb = e.clipboardData || window.clipboardData;
      const ll = cb && parseLatLng(cb.getData('text'));
      if (ll) {
        e.preventDefault();
        fillGotoSlots(ll.lat, ll.lng);
        coordBox.classList.remove('error');
      }
    });
  }
  inputs[0].focus();
  inputs[0].select();
}
coordBox.addEventListener('click', () => { if (!gotoEditing) enterGotoEdit(); });
// Leave edit mode only when focus exits the readout entirely. Registered once
// (not per edit) so repeated open/close never stacks duplicate listeners.
coordBox.addEventListener('focusout', e => {
  if (gotoEditing && !coordBox.contains(e.relatedTarget)) exitGotoEdit();
});

const BEARING_KEY = 'navaid.bearing';
// `navaid.view` — issue #413: persist center+zoom (and bearing) across
// reloads so a refresh / language switch / PWA wake-up doesn't snap back
// to the auto-fit view. Bearing is also written here so a single payload
// captures the entire viewport state atomically; the legacy
// `navaid.bearing` key keeps being written below for backward compat with
// any tooling that reads it.
const VIEW_KEY = 'navaid.view';
// Sanity bbox for restored coords — anything outside is "wildly outside
// Israel" per issue #413 and is treated as stale.
const VIEW_LAT_MIN = 28, VIEW_LAT_MAX = 34;
const VIEW_LNG_MIN = 33, VIEW_LNG_MAX = 36;
function readSavedView() {
  let raw = null;
  try { raw = localStorage.getItem(VIEW_KEY); } catch (e) { return null; }
  if (!raw) return null;
  let d;
  try { d = JSON.parse(raw); } catch (e) { return null; }
  if (!d || typeof d !== 'object') return null;
  const lat = +d.lat, lng = +d.lng, zoom = +d.zoom;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
  if (lat < VIEW_LAT_MIN || lat > VIEW_LAT_MAX) return null;
  if (lng < VIEW_LNG_MIN || lng > VIEW_LNG_MAX) return null;
  const minZ = map.options.minZoom, maxZ = map.options.maxZoom;
  if (Number.isFinite(minZ) && zoom < minZ) return null;
  if (Number.isFinite(maxZ) && zoom > maxZ) return null;
  const b = +d.bearing;
  return { lat, lng, zoom, bearing: Number.isFinite(b) ? b : null };
}
try {
  // Defensive: an older build (or a manual edit) may have stored "NaN".
  // Number.isFinite rejects NaN / Infinity so we fall back to bearing 0.
  // Read the saved view first so bearing from `navaid.view` (when present)
  // wins over the legacy `navaid.bearing` key.
  const sv = readSavedView();
  if (sv && sv.bearing !== null && map.setBearing) {
    map.setBearing(sv.bearing);
  } else {
    const sb = parseFloat(localStorage.getItem(BEARING_KEY));
    if (Number.isFinite(sb)) map.setBearing(sb);
  }
} catch (e) { /* storage unavailable */ }
let bearingSaveTimer = null;
map.on('rotate', () => {
  refreshDial(); scheduleDraw();
  if (NavAid.exporting || bearingSaveTimer) return;
  // Debounce: a dial drag fires 'rotate' continuously — only the last
  // value needs persisting.
  bearingSaveTimer = setTimeout(() => {
    bearingSaveTimer = null;
    const b = mapBearing();
    if (!Number.isFinite(b)) return;     // never persist 'NaN' (issue #75)
    try { localStorage.setItem(BEARING_KEY, String(b)); }
    catch (err) { /* storage unavailable */ }
  }, 400);
});
// Persist the full viewport (center + zoom + bearing) on any change.
// Debounced ~300 ms because pan/zoom/rotate fire continuously during a
// drag — only the resting state needs saving.
let viewSaveTimer = null;
function scheduleSaveView() {
  if (NavAid.exporting || viewSaveTimer) return;
  viewSaveTimer = setTimeout(() => {
    viewSaveTimer = null;
    try {
      const c = map.getCenter();
      const z = map.getZoom();
      const b = map.getBearing ? map.getBearing() : 0;
      if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng) ||
          !Number.isFinite(z)) return;
      const payload = { lat: c.lat, lng: c.lng, zoom: z };
      if (Number.isFinite(b)) payload.bearing = b;
      localStorage.setItem(VIEW_KEY, JSON.stringify(payload));
    } catch (e) { /* storage unavailable */ }
  }, 300);
}
map.on('moveend zoomend rotate', scheduleSaveView);
refreshDial();

// --- nav-waypoint search --------------------------------------------
const wpSearch = document.getElementById('wp-search');
const wpResults = document.getElementById('wp-search-results');
function closeSearch() {
  wpResults.classList.add('hidden');
  wpResults.innerHTML = '';
}
// Exact-match lookup of one token against airfields + navWP — case-
// insensitive on the English ICAO code, exact on the Hebrew label.
// Airfields tried first (smaller, strongly-known set; same priority as
// applyNavSnap()). Returns the entry or null.
function findNavWpToken(token) {
  if (!token) return null;
  const up = token.toUpperCase();
  if (airfields && airfields.length) {
    for (const a of airfields) {
      if ((a.name && a.name.toUpperCase() === up) ||
          (a.he && a.he === token) ||
          (a.en && a.en.toUpperCase() === up)) {
        return a;
      }
    }
  }
  if (navWP && navWP.length) {
    for (const w of navWP) {
      const en = String(w.en || '');
      const enKey = en.toUpperCase().replace(/[\s_-]+/g, '');
      const tokenKey = up.replace(/[\s_-]+/g, '');
      if ((w.name && w.name.toUpperCase() === up) ||
          (en && (en.toUpperCase() === up || enKey === tokenKey)) ||
          (w.he && w.he === token)) {
        return w;
      }
    }
  }
  return null;
}
// Multi-token Enter: parse space-separated codes, resolve every one against
// airfields + navWP, replace the route with those waypoints. Inspired by
// arielbider/cvfr-map.
async function buildRouteFromQuery(raw) {
  if (navWP === null) await loadNavWaypoints();
  if (airfields === null) await loadAirfields();
  if (legAltitudeMap === null) await loadLegAltitudes();
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const resolved = [];
  for (const t of tokens) {
    const w = findNavWpToken(t);
    if (!w) { alert(S.errSearchUnknown(t)); return false; }
    resolved.push(w);
  }
  if ((state.waypoints.length || state.notes.length) &&
      !confirm(S.searchReplaceConfirm)) return false;
  // Always store the canonical airfield / nav-waypoint code so all tokens render
  // consistently. navName() in interact.js converts it to the locale at
  // display time. Without this, HE-locale autofill would store the
  // Hebrew label for clicked tokens and the English ICAO for typed
  // tokens — producing the mixed-locale route the user reported.
  state.waypoints = resolved.map(w => ({
    lat: w.lat, lng: w.lng, name: w.name,
  }));
  state.legs = [];
  state.commChangeSuppressions = [];
  state.selected = null;
  syncLegs();
  if (typeof seedCommChangeNotes === 'function') seedCommChangeNotes();  // #487
  wpSearch.value = '';
  hideSearchOverlay();
  showInspector();
  fitView();
  draw();
  return true;
}

let routeTemplates = null;

function routeTemplateLabel(template) {
  const lang = (window.__navLang || document.documentElement.lang || '').toLowerCase();
  if (lang.slice(0, 2) === 'he' && template.he) return template.he;
  return template.name || template.id || '';
}

function routeTemplateDescription(template) {
  const lang = (window.__navLang || document.documentElement.lang || '').toLowerCase();
  if (lang.slice(0, 2) === 'he' && template.heDescription) return template.heDescription;
  return template.description || '';
}

function routeTemplateAltitudeOk(value) {
  return value === null || value === 'NaN' ||
    (typeof value === 'number' && Number.isFinite(value));
}

function normalizeRouteTemplateData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.templates)) return [];
  const out = [];
  for (const template of data.templates) {
    if (!template || typeof template !== 'object') continue;
    if (typeof template.id !== 'string' || !template.id.trim()) continue;
    if (typeof template.name !== 'string' || !template.name.trim()) continue;
    if (!Array.isArray(template.waypoints) || template.waypoints.length < 2) continue;
    const templateLegs = Array.isArray(template.legs) ? template.legs : null;
    if (templateLegs && templateLegs.length !== template.waypoints.length - 1) continue;
    const defaultSpeed = Number(template.defaultSpeed);
    if (!Number.isFinite(defaultSpeed) || defaultSpeed <= 0) continue;
    const waypoints = template.waypoints.map(code => String(code || '').trim().toUpperCase());
    let ok = waypoints.every(Boolean);
    if (templateLegs) {
      for (const leg of templateLegs) {
        if (!leg || typeof leg !== 'object' ||
            !routeTemplateAltitudeOk(leg.inboundAltitude) ||
            !routeTemplateAltitudeOk(leg.outboundAltitude)) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) continue;
    // A template note is either a full positioned note, or a lean comm-change
    // note keyed only by `cc` (waypoint code) — its position is derived from
    // that waypoint at build time, so templates don't store lat/lng.
    const notes = Array.isArray(template.notes) ? template.notes.filter(note =>
      note && typeof note === 'object' && (
        (Number.isFinite(note.lat) && Number.isFinite(note.lng) &&
          typeof note.text === 'string' && typeof note.color === 'string' &&
          (note.shape === 'rect' || note.shape === 'oval')) ||
        (typeof note.cc === 'string' && note.cc.trim())
      )) : [];
    const { legs: _templateLegs, ...templateRest } = template;
    out.push({
      ...templateRest,
      waypoints,
      defaultSpeed,
      ...(templateLegs ? { legs: templateLegs } : {}),
      notes,
    });
  }
  // Present templates alphabetically by name (locale-aware).
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
}

async function loadRouteTemplates() {
  if (routeTemplates !== null) return routeTemplates;
  try {
    const res = await fetch(S.routeTemplatesUrl || 'data/route-templates.json?v=1');
    if (!res.ok) throw new Error(String(res.status));
    routeTemplates = normalizeRouteTemplateData(await res.json());
  } catch (e) {
    routeTemplates = [];
    console.warn('Failed to load route templates:', e);
  }
  return routeTemplates;
}

function routeTemplateLeg(templateLeg, speed) {
  const hasExplicitAltitudes = templateLeg && typeof templateLeg === 'object' &&
    Object.prototype.hasOwnProperty.call(templateLeg, 'inboundAltitude') &&
    Object.prototype.hasOwnProperty.call(templateLeg, 'outboundAltitude');
  if (!hasExplicitAltitudes && typeof newLeg === 'function') {
    const leg = newLeg();
    leg.flightSpeed = speed;
    leg.outboundSpeed = speed;
    return leg;
  }
  const labels = typeof _defaultLegLabels === 'function'
    ? _defaultLegLabels()
    : {
      inLabel: { a: 0, _default: 1, _m: 1 },
      outLabel: { a: 0, _default: 1, _m: 1 },
      cumLabel: { a: 0, _default: 1, _m: 1 },
      cumLabelRet: { a: 0, _default: 1, _m: 1 },
    };
  return {
    inboundAltitude: typeof decodeRouteAltitude === 'function'
      ? decodeRouteAltitude(templateLeg && templateLeg.inboundAltitude)
      : (templateLeg && templateLeg.inboundAltitude),
    outboundAltitude: typeof decodeRouteAltitude === 'function'
      ? decodeRouteAltitude(templateLeg && templateLeg.outboundAltitude)
      : (templateLeg && templateLeg.outboundAltitude),
    flightSpeed: speed,
    outboundSpeed: speed,
    inLabel: labels.inLabel,
    outLabel: labels.outLabel,
    cumLabel: labels.cumLabel,
    cumLabelRet: labels.cumLabelRet,
  };
}

function routeTemplateNoteFreq(note) {
  if (!note || typeof note !== 'object') return '';
  if (typeof note.freq === 'string' && note.freq.trim()) return note.freq;
  if (!note.cc || !note.freqName ||
      typeof commCallSignOptions !== 'function' ||
      typeof commCallSignOptionMatches !== 'function') return '';
  const opt = commCallSignOptions(note.cc)
    .find(o => commCallSignOptionMatches(o, note.freqName));
  return opt && opt.freq ? opt.freq : '';
}

async function routeFromTemplate(template, speed) {
  if (navWP === null) await loadNavWaypoints();
  if (airfields === null) await loadAirfields();
  if (legAltitudeMap === null) await loadLegAltitudes();
  if (typeof loadCommChange === 'function' && typeof commChangeMap !== 'undefined' &&
      commChangeMap === null) await loadCommChange();
  const waypoints = [];
  for (const code of template.waypoints) {
    const point = findNavWpToken(code);
    if (!point) throw new Error(code);
    waypoints.push({ lat: point.lat, lng: point.lng, name: point.name });
  }
  const templateLegs = Array.isArray(template.legs) ? template.legs : [];
  const legs = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    legs.push(routeTemplateLeg(templateLegs[i], speed));
  }
  return {
    waypoints,
    legs,
    notes: (template.notes || []).map(note => {
      // Lean comm-change notes carry only `cc` — derive the callout position
      // from that waypoint (same default offset seedCommChangeNotes uses).
      let lat = note.lat, lng = note.lng;
      const freq = routeTemplateNoteFreq(note);
      if (!(Number.isFinite(lat) && Number.isFinite(lng)) && note.cc) {
        const key = typeof canonicalNavWaypointName === 'function'
          ? canonicalNavWaypointName(note.cc) : String(note.cc).trim().toUpperCase();
        const wp = waypoints.find(w => (typeof canonicalNavWaypointName === 'function'
          ? canonicalNavWaypointName(w.name) : String(w.name).trim().toUpperCase()) === key);
        if (wp) {
          lat = wp.lat + (typeof tune === 'function' ? tune('commChangeNoteLatOffset') : 0);
          lng = wp.lng + (typeof tune === 'function' ? tune('commChangeNoteLngOffset') : 0);
        }
      }
      return {
        lat: r5(lat),
        lng: r5(lng),
        text: note.text || 'Freq change',
        color: note.color || '#fff6aa',
        shape: note.shape || 'rect',
        ...(note.cc ? { cc: note.cc } : {}),
        ...(note.freqName ? { freqName: note.freqName } : {}),
        ...(freq ? { freq } : {}),
        ...(note.freqAuto === true ? { freqAuto: true } : {}),
      };
    }).filter(n => Number.isFinite(n.lat) && Number.isFinite(n.lng)),
    commChangeSuppressions: Array.isArray(template.commChangeSuppressions)
      ? template.commChangeSuppressions.filter(s => typeof s === 'string') : [],
  };
}

async function applyRouteTemplate(template, speed, closeModal) {
  const route = await routeFromTemplate(template, speed);
  const verr = typeof validateRoute === 'function' ? validateRoute(route) : null;
  if (verr) throw new Error(verr);
  if ((state.waypoints.length || state.notes.length) &&
      !confirm(S.routeTemplateReplaceConfirm ||
        S.searchReplaceConfirm ||
        'Replace the current route?')) return false;
  state.waypoints = route.waypoints;
  state.legs = route.legs;
  state.notes = route.notes;
  state.commChangeSuppressions = Array.isArray(route.commChangeSuppressions)
    ? route.commChangeSuppressions.slice() : [];
  state.selected = null;
  syncLegs();
  if (showCommChange && typeof loadCommChange === 'function') {
    await loadCommChange();
    if (typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
  }
  showInspector();
  fitView();
  draw();
  if (typeof closeModal === 'function') closeModal();
  if (typeof showToast === 'function') {
    const name = routeTemplateLabel(template);
    const msg = typeof S.routeTemplateReady === 'function'
      ? S.routeTemplateReady(name, speed)
      : name + ' template loaded';
    showToast(msg);
  }
  return true;
}

function showRouteTemplatesModal() {
  if (typeof prepareChartModal === 'function') {
    if (!prepareChartModal('route-templates')) return;
  } else {
    if (fpOpen) closeFlightPlan();
    if (typeof rememberOpenChartModal === 'function') rememberOpenChartModal('route-templates');
  }
  const modal = createDraggableModal(S.routeTemplatesTitle || 'Route templates',
    'modal route-template-modal',
    typeof clearOpenChartModal === 'function'
      ? () => clearOpenChartModal('route-templates') : null,
    { nonBlocking: true, chartKind: 'route-templates' });
  const body = document.createElement('div');
  body.className = 'route-template-body';
  const loading = document.createElement('p');
  loading.className = 'route-template-empty';
  loading.textContent = '…';
  body.appendChild(loading);
  modal.box.appendChild(body);
  modal.show();

  loadRouteTemplates().then(templates => {
    body.innerHTML = '';
    if (!templates.length) {
      const empty = document.createElement('p');
      empty.className = 'route-template-empty';
      empty.textContent = S.routeTemplateEmpty || 'No route templates available';
      body.appendChild(empty);
      return;
    }

    const routeRow = document.createElement('label');
    routeRow.className = 'route-template-row';
    const routeLabel = document.createElement('span');
    routeLabel.textContent = S.routeTemplateRoute || 'Route';
    const select = document.createElement('select');
    select.className = 'route-template-select';
    for (const template of templates) {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = routeTemplateLabel(template);
      select.appendChild(option);
    }
    routeRow.append(routeLabel, select);

    const speedRow = document.createElement('label');
    speedRow.className = 'route-template-row';
    const speedLabel = document.createElement('span');
    speedLabel.textContent = S.routeTemplateSpeed || 'Speed (kt)';
    const speed = document.createElement('input');
    speed.type = 'number';
    speed.className = 'route-template-speed';
    speed.min = '1';
    speed.max = '300';
    speed.step = '1';
    speed.inputMode = 'numeric';
    speedRow.append(speedLabel, speed);

    const path = document.createElement('p');
    path.className = 'route-template-path';
    const desc = document.createElement('p');
    desc.className = 'route-template-description';

    const btns = document.createElement('div');
    btns.className = 'modal-btns';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = S.routeTemplateApply || 'Build route';
    btns.appendChild(apply);

    const selectedTemplate = () =>
      templates.find(template => template.id === select.value) || templates[0];
    const updateDetails = () => {
      const template = selectedTemplate();
      speed.value = String(template.defaultSpeed || 90);
      path.textContent = template.waypoints.join(' → ');
      desc.textContent = routeTemplateDescription(template);
      desc.hidden = !desc.textContent;
    };
    select.addEventListener('change', updateDetails);
    updateDetails();

    apply.onclick = async () => {
      const template = selectedTemplate();
      const nextSpeed = Number(speed.value);
      if (!Number.isFinite(nextSpeed) || nextSpeed <= 0) {
        speed.setAttribute('aria-invalid', 'true');
        alert(S.routeTemplateBadSpeed || 'Enter a valid speed in knots.');
        return;
      }
      speed.setAttribute('aria-invalid', 'false');
      apply.disabled = true;
      try {
        const ok = await applyRouteTemplate(template, Math.round(nextSpeed), modal.close);
        if (!ok) apply.disabled = false;
      } catch (e) {
        apply.disabled = false;
        alert((S.routeTemplateLoadError || 'Could not load route templates.') +
          (e && e.message ? '\n' + e.message : ''));
      }
    };

    body.append(routeRow, speedRow, path, desc, btns);
    select.focus();
  }).catch(e => {
    body.innerHTML = '';
    const err = document.createElement('p');
    err.className = 'route-template-empty';
    err.textContent = (S.routeTemplateLoadError || 'Could not load route templates.') +
      (e && e.message ? ' ' + e.message : '');
    body.appendChild(err);
  });
}

function showRouteLibraryModal() {
  if (typeof prepareChartModal === 'function') {
    if (!prepareChartModal('route-library')) return;
  } else {
    if (fpOpen) closeFlightPlan();
    if (typeof rememberOpenChartModal === 'function') rememberOpenChartModal('route-library');
  }
  const modal = createDraggableModal(S.routeLibraryTitle || 'Saved routes',
    'modal route-library-modal',
    () => {
      window.refreshRouteLibrary = null;   // stop auto-sync from poking a closed modal
      if (typeof clearOpenChartModal === 'function') clearOpenChartModal('route-library');
    },
    { nonBlocking: true, chartKind: 'route-library' });
  const body = document.createElement('div');
  body.className = 'route-library-body';
  modal.box.appendChild(body);
  modal.show();

  // Save-current row: name field + save button.
  const saveRow = document.createElement('div');
  saveRow.className = 'route-library-saverow';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'route-library-name';
  nameInput.dir = 'auto';
  nameInput.placeholder = S.routeLibraryNamePlaceholder || 'Route name';
  nameInput.maxLength = 80;
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = S.routeLibrarySaveCurrent || 'Save current route';
  saveBtn.onclick = () => {
    const entry = routeLibrarySaveCurrent(nameInput.value);
    if (!entry) return;
    nameInput.value = '';
    render();
    if (typeof showToast === 'function') {
      showToast(typeof S.routeLibrarySaved === 'function'
        ? S.routeLibrarySaved(entry.name) : entry.name + ' saved');
    }
  };
  saveRow.append(nameInput, saveBtn);

  const list = document.createElement('div');
  list.className = 'route-library-list';

  // Export / import the whole library as one JSON file.
  const tools = document.createElement('div');
  tools.className = 'route-library-tools';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.textContent = S.routeLibraryExport || 'Export library';
  exportBtn.onclick = () => {
    const blob = new Blob([JSON.stringify(loadRouteLibrary(), null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'navaid-routes-' + fileStamp() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.textContent = S.routeLibraryImport || 'Import library';
  const importFile = document.createElement('input');
  importFile.type = 'file';
  importFile.accept = 'application/json,.json';
  importFile.hidden = true;
  importBtn.onclick = () => importFile.click();
  importFile.onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let arr;
      try { arr = JSON.parse(reader.result); } catch (err) { alert(S.errLoadFile + err.message); return; }
      if (!Array.isArray(arr)) { alert(S.errLoadFile + 'expected a route-library array'); return; }
      // Merge valid entries (fresh ids) into the existing library.
      const merged = loadRouteLibrary();
      let added = 0;
      for (const it of arr) {
        if (!it || !it.data) continue;
        if (typeof validateRoute === 'function' && validateRoute(it.data)) continue;
        merged.unshift({ id: routeLibraryId(), name: (it.name || 'Route').toString().slice(0, 80),
          savedAt: it.savedAt || new Date().toISOString(), data: it.data });
        added++;
      }
      if (persistRouteLibrary(merged)) render();
      if (typeof showToast === 'function') showToast(added + ' route(s) imported');
    };
    reader.readAsText(f);
  };
  tools.append(exportBtn, importBtn, importFile);

  function render() {
    list.innerHTML = '';
    const entries = loadRouteLibrary().filter(e => e && e.data && !e.deleted);
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'route-library-empty';
      empty.textContent = S.routeLibraryEmpty || 'No saved routes yet';
      list.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'route-library-row';
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'route-library-open';
      const wpN = (entry.data && entry.data.waypoints && entry.data.waypoints.length) || 0;
      const when = (entry.savedAt || '').slice(0, 10);
      main.innerHTML = '';
      const nm = document.createElement('span');
      nm.className = 'route-library-row-name';
      nm.dir = 'auto';
      nm.textContent = entry.name;
      const meta = document.createElement('span');
      meta.className = 'route-library-row-meta';
      meta.dir = 'ltr';
      meta.textContent = wpN + ' WP' + (when ? ' · ' + when : '');
      main.append(nm, meta);
      main.onclick = () => { if (routeLibraryApply(entry)) modal.close(); };

      const actions = document.createElement('div');
      actions.className = 'route-library-actions';
      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'route-library-load';
      loadBtn.textContent = S.routeLibraryLoad || 'Load';
      loadBtn.onclick = () => { if (routeLibraryApply(entry)) modal.close(); };
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.textContent = S.routeLibraryRename || 'Rename';
      rename.onclick = () => {
        const next = prompt(S.routeLibraryNamePlaceholder || 'Route name', entry.name);
        if (next == null) return;
        const all = loadRouteLibrary();
        const t = all.find(x => x.id === entry.id);
        if (t) { t.name = next.trim().slice(0, 80) || t.name; if (persistRouteLibrary(all)) render(); }
      };
      const dup = document.createElement('button');
      dup.type = 'button';
      dup.textContent = S.routeLibraryDuplicate || 'Duplicate';
      dup.onclick = () => {
        const all = loadRouteLibrary();
        const src = all.find(x => x.id === entry.id);
        if (!src) return;
        all.unshift({ id: routeLibraryId(), name: src.name + ' (copy)',
          savedAt: new Date().toISOString(), data: src.data });
        if (persistRouteLibrary(all)) render();
      };
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'route-library-del';
      del.textContent = S.routeLibraryDelete || 'Delete';
      del.onclick = () => {
        if (!confirm(S.routeLibraryDeleteConfirm || 'Delete this saved route?')) return;
        // Replace with a tombstone (deleted + fresh timestamp) so the delete
        // wins the Drive merge instead of being resurrected from the remote.
        const all = loadRouteLibrary().map(x => x.id === entry.id
          ? { id: x.id, name: x.name, savedAt: new Date().toISOString(), deleted: true }
          : x);
        if (persistRouteLibrary(all)) render();
      };
      actions.append(loadBtn, rename, dup, del);
      row.append(main, actions);
      list.appendChild(row);
    }
  }

  body.append(saveRow, list, tools);

  // Optional Google Drive sync (#677 follow-up). Only shown when an OAuth
  // client ID is configured (gdrive.js); otherwise the feature stays dormant.
  if (typeof gdriveConfigured === 'function' && gdriveConfigured()) {
    const gd = document.createElement('div');
    gd.className = 'route-library-tools route-library-gdrive';
    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.textContent = S.routeLibraryGdriveSync || 'Sync with Google Drive';
    const status = document.createElement('span');
    status.className = 'route-library-gdrive-status';
    const setStatus = t => { status.textContent = t || ''; };
    syncBtn.onclick = () => {
      syncBtn.disabled = true;
      setStatus(S.routeLibraryGdriveSyncing || 'Syncing…');
      gdriveSync().then(() => {
        render();
        setStatus(S.routeLibraryGdriveSynced || 'Synced');
      }).catch(err => {
        setStatus((S.routeLibraryGdriveError || 'Sync failed') +
          (err && err.message ? ': ' + err.message : ''));
      }).then(() => { syncBtn.disabled = false; });
    };
    gd.append(syncBtn, status);
    body.append(gd);
  }

  render();
  // Let a background auto-sync refresh this list while it's open.
  window.refreshRouteLibrary = render;
  nameInput.focus();
}

function restoreOpenChartModal() {
  if (typeof readOpenChartModal !== 'function') return;
  const kind = readOpenChartModal();
  if (!kind) return;
  if (kind === 'airport-charts' && typeof showChartsModal === 'function') {
    showChartsModal();
    return;
  }
  if (kind === 'freq-table' && typeof showFreqTableModal === 'function') {
    showFreqTableModal();
    return;
  }
  if (kind === 'alt-pairs' && typeof showAltitudePairsModal === 'function') {
    showAltitudePairsModal();
    return;
  }
  if (kind === 'route-templates' && typeof showRouteTemplatesModal === 'function') {
    showRouteTemplatesModal();
    return;
  }
  if (kind === 'route-library' && typeof showRouteLibraryModal === 'function') {
    showRouteLibraryModal();
    return;
  }
  if (typeof clearOpenChartModal === 'function') clearOpenChartModal();
}

function runSearch() {
  // Use the raw value (not trimmed) so a trailing space — meaning "I just
  // accepted the previous token, waiting to type the next one" — suppresses
  // the dropdown instead of re-running a stale single-token query.
  const rawAll = wpSearch.value;
  const trailingSpace = /\s$/.test(rawAll);
  const qRaw = rawAll.trim();
  const multi = /\s/.test(qRaw) || trailingSpace;
  const lastToken = trailingSpace ? '' : (multi ? (qRaw.split(/\s+/).pop() || '') : qRaw);
  if (multi && !lastToken) { closeSearch(); return; }
  const q = lastToken.toUpperCase();
  if (!q) { closeSearch(); return; }
  const afHits = [], wpHits = [];
  // #124: split budget evenly — up to 6 airfields then up to 6 nav-WPs so a
  // broad query (e.g. "LL") can't fill all 12 slots with airfield results.
  if (airfields && airfields.length) {
    for (const a of airfields) {
      if (a.name.toUpperCase().indexOf(q) >= 0 ||
          (a.en && a.en.toUpperCase().indexOf(q) >= 0) ||
          (a.he && a.he.indexOf(lastToken) >= 0)) {
        afHits.push({ kind: 'af', entry: a });
      }
    }
  }
  if (navWP && navWP.length) {
    for (const w of navWP) {
      if (w.name.toUpperCase().indexOf(q) >= 0 ||
          (w.en && w.en.toUpperCase().indexOf(q) >= 0) ||
          (w.he && w.he.indexOf(lastToken) >= 0)) {
        wpHits.push({ kind: 'wp', entry: w });
      }
    }
  }
  const afSlots = Math.min(afHits.length, 6);
  const wpSlots = Math.min(wpHits.length, 12 - afSlots);
  const hits = afHits.slice(0, afSlots).concat(wpHits.slice(0, wpSlots));
  if (!hits.length) { closeSearch(); return; }
  wpResults.innerHTML = '';
  const wpField = S.navWpSearchField;
  const afField = S.airfieldLabelField;
  for (const h of hits) {
    const w = h.entry;
    const item = document.createElement('div');
    item.className = 'wp-search-item';
    let primary, alt;
    if (h.kind === 'af') {
      primary = w.name;                  // ICAO is always shown first
      alt = (w[afField] || w.en || '');
      if (alt === primary) alt = '';
    } else {
      primary = w[wpField] || w.en || w.name;
      if (wpField === 'he') {
        alt = w.name + (w.en ? ' / ' + w.en : '');
      } else {
        alt = w.name + (w.he ? ' / ' + w.he : '');
      }
    }
    item.textContent = alt && alt !== primary ? primary + ' / ' + alt : primary;
    item.onclick = () => {
      if (multi) {
        // Replace just the last token with the canonical code — keeps the
        // typed route in a single stable identifier set. Trailing
        // space primes the next autocomplete.
        const parts = wpSearch.value.split(/\s+/);
        parts[parts.length - 1] = w.name;
        wpSearch.value = parts.join(' ') + ' ';
        wpSearch.focus();
        closeSearch();
        return;
      }
      map.setView([w.lat, w.lng], Math.max(map.getZoom(), 12));
      wpSearch.value = primary;
      closeSearch();
    };
    wpResults.appendChild(item);
  }
  wpResults.classList.remove('hidden');
}
wpSearch.addEventListener('input', runSearch);
wpSearch.addEventListener('focus', () => { if (wpSearch.value.trim()) runSearch(); });
wpSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const raw = wpSearch.value.trim();
    // Only treat as a route-build when there are ≥ 2 actual tokens.
    // A single token with trailing whitespace must still let Enter pick
    // the highlighted dropdown suggestion.
    if (raw.split(/\s+/).filter(Boolean).length >= 2) {
      e.preventDefault();
      buildRouteFromQuery(raw);
      return;
    }
    const first = wpResults.querySelector('.wp-search-item');
    if (first) first.click();
  } else if (e.key === 'Escape') {
    hideSearchOverlay();
  }
});
// Floating search overlay — Ctrl/Cmd-F opens it, Escape or ✕ closes it. The
// search input moved out of the toolbar Build section so it no longer
// requires the section to be expanded.
const searchOverlay = document.getElementById('search-overlay');
function showSearchOverlay() {
  if (typeof closeToolbarDesktopMenus === 'function') closeToolbarDesktopMenus();
  searchOverlay.classList.remove('hidden');
  wpSearch.focus();
  wpSearch.select();
}
function hideSearchOverlay() {
  searchOverlay.classList.add('hidden');
  closeSearch();
  wpSearch.value = '';
}
document.getElementById('search-trigger').onclick = showSearchOverlay;
document.getElementById('search-close').onclick = hideSearchOverlay;

// Issue #420: keyboard-shortcuts cheat-sheet trigger. The '?' key shortcut
// is wired in interact.js; this button gives non-keyboard users (touch /
// mouse) a discoverable entry point.
{
  const helpBtn = document.getElementById('help-trigger');
  if (helpBtn) {
    helpBtn.onclick = () => {
      if (typeof closeToolbarDesktopMenus === 'function') closeToolbarDesktopMenus();
      if (typeof showShortcutsHelp === 'function') showShortcutsHelp();
    };
  }
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && shortcutKey(e, 'KeyF', 'f')) {
    const t = e.target;
    // Allow native find-in-page when the user is already typing somewhere.
    if (shortcutTypingTarget(t)) {
      if (t !== wpSearch) return;
    }
    e.preventDefault();
    showSearchOverlay();
  } else if (e.key === 'Escape' && !searchOverlay.classList.contains('hidden')) {
    hideSearchOverlay();
  } else if (shortcutPlain(e, 'KeyR', 'r')) {
    const t = e.target;
    if (shortcutTypingTarget(t)) return;
    document.getElementById('reverse').click();
  } else if (shortcutPlain(e, 'KeyB', 'b')) {
    const t = e.target;
    if (shortcutTypingTarget(t)) return;
    // Toggling the checkbox fires its onchange (persist + redraw).
    document.getElementById('ret-cb').click();
  }
});
document.addEventListener('click', e => {
  if (!searchOverlay.contains(e.target) && e.target.id !== 'search-trigger') {
    closeSearch();
  }
});
document.getElementById('reverse').onclick = () => {
  // Reversing flight direction means each leg's inbound/outbound roles swap.
  // The leg's local axes (along + perpendicular) also flip, so negating the
  // label offsets keeps the markers visually pinned to the same map pixels.
  state.waypoints.reverse();
  // A leg imported from a corrupted file / share URL may be missing a
  // label; fall back to the default so negating its offsets can't throw.
  const d = _defaultLegLabels();
  const flipLabel = (label, fallback) => {
    const src = label || fallback;
    const next = { a: -(Number.isFinite(src.a) ? src.a : 0) };
    if (Number.isFinite(src.p)) next.p = -src.p;
    if (src._m !== undefined) next._m = src._m;
    if (src._default !== undefined) next._default = src._default;
    return next;
  };
  state.legs = state.legs.reverse().map(l => {
    const inOld = l.outLabel || d.outLabel;
    const outOld = l.inLabel || d.inLabel;
    const cumOld = l.cumLabelRet || d.cumLabelRet;
    const cumRetOld = l.cumLabel || d.cumLabel;
    return {
      inboundAltitude: l.outboundAltitude,
      outboundAltitude: l.inboundAltitude,
      flightSpeed: showReturn ? l.outboundSpeed : l.flightSpeed,
      outboundSpeed: showReturn ? l.flightSpeed : l.flightSpeed,
      inLabel:  flipLabel(inOld, d.inLabel),
      outLabel: flipLabel(outOld, d.outLabel),
      cumLabel: flipLabel(cumOld, d.cumLabel),
      cumLabelRet: flipLabel(cumRetOld, d.cumLabelRet),
      ...(l._legAltitudeAuto ? { _legAltitudeAuto: 1 } : {}),
      ...(l._legAltitudeKey ? { _legAltitudeKey: l._legAltitudeKey } : {}),
      ...(l._legAltitudeOutboundBlocked || l._legAltitudeOneWay
        ? { _legAltitudeInboundBlocked: 1 } : {}),
      ...(l._legAltitudeInboundBlocked ? {
        _legAltitudeOutboundBlocked: 1,
        _legAltitudeOneWay: 1,
      } : {}),
    };
  });
  applyLegAltitudesToRoute();
  // Keep the inspector open on the same leg/waypoint after the reversal — the
  // item moves to the mirrored index (count is unchanged).
  const sel = state.selected;
  if (sel && sel.type === 'leg' && Number.isFinite(sel.index)) {
    state.selected = Object.assign({}, sel, { index: state.legs.length - 1 - sel.index });
  } else if (sel && sel.type === 'wp' && Number.isFinite(sel.index)) {
    state.selected = Object.assign({}, sel, { index: state.waypoints.length - 1 - sel.index });
  }
  if (showCommChange && typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
  showInspector(); draw();
};
document.getElementById('undo').onclick = () => { if (typeof undo === 'function') undo(); };
document.getElementById('clear').onclick = () => {
  if ((state.waypoints.length || state.notes.length) &&
      !confirm(S.clearConfirm)) return;
  state.waypoints = [];
  state.legs = [];
  state.notes = [];
  state.commChangeSuppressions = [];
  state.selected = null;
  showInspector(); draw();
};
document.getElementById('tool-reset-all-wp-names').onclick = () => {
  if (!state.waypoints.length) return;
  if (!confirm(S.resetAllWpNamesConfirm ||
      'Reset all waypoint names to their nearest reference codes, or clear when off-grid?')) return;
  if (typeof resetAllWpNames === 'function') resetAllWpNames();
};
// Export format picker: one dropdown for JSON / GPX / PLN. Resets to its
// placeholder after firing so the same format can be re-picked.
document.getElementById('export-select').onchange = e => {
  const v = e.target.value;
  e.target.value = '';
  if (v === 'json') save();
  else if (v === 'gpx') exportGpx();
  else if (v === 'pln') exportPln();
  else if (v === 'fdr') exportFdr();
};
document.getElementById('load').onclick = () => document.getElementById('file').click();
document.getElementById('share').onclick = shareRoute;
document.getElementById('route-templates').onclick = showRouteTemplatesModal;
document.getElementById('route-library').onclick = showRouteLibraryModal;

// Draggable inspector — grab the header bar (but not the editable title or the
// close button) to reposition the panel; the spot persists across selections
// and reloads under navaid.inspPos. Mirrors the modal/toolbar drag pattern.
(function () {
  const insp = document.getElementById('inspector');
  const header = document.getElementById('insp-header');
  if (!insp || !header) return;
  const INSP_POS_KEY = 'navaid.inspPos';
  function applyInspPos(x, y) {
    const maxX = Math.max(0, window.innerWidth - 60);
    const maxY = Math.max(0, window.innerHeight - 40);
    insp.style.left = Math.max(0, Math.min(maxX, x)) + 'px';
    insp.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
    insp.style.right = 'auto';
  }
  const isNarrow = () => !!(window.matchMedia && window.matchMedia('(max-width: 680px)').matches);
  try {
    // On phones the inspector is a fixed bottom sheet (see the mobile block in
    // style.css); a saved drag position would override that, so ignore it there.
    const p = JSON.parse(localStorage.getItem(INSP_POS_KEY) || 'null');
    if (!isNarrow() && p && Number.isFinite(p.x) && Number.isFinite(p.y)) applyInspPos(p.x, p.y);
  } catch (e) { /* */ }
  header.addEventListener('mousedown', function (e) {
    if (e.target.closest('#insp-close')) return;               // close button stays clickable
    // The title line (#insp-title) is read-only for every inspector type — the
    // waypoint name is edited via a separate row in the body — so the whole
    // header, title included, is a drag handle.
    const r = insp.getBoundingClientRect();
    const off = { x: e.clientX - r.left, y: e.clientY - r.top };
    insp.style.right = 'auto';
    const onMove = function (ev) {
      const x = Math.max(0, Math.min(window.innerWidth - insp.offsetWidth, ev.clientX - off.x));
      const y = Math.max(0, Math.min(window.innerHeight - insp.offsetHeight, ev.clientY - off.y));
      insp.style.left = x + 'px';
      insp.style.top = y + 'px';
    };
    const onUp = function () {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const r2 = insp.getBoundingClientRect();
      try { localStorage.setItem(INSP_POS_KEY, JSON.stringify({ x: r2.left, y: r2.top })); }
      catch (e2) { /* */ }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
})();
document.getElementById('file').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  if (/\.gpx$/i.test(f.name)) loadGpx(f);
  else if (/\.pln$/i.test(f.name)) loadPln(f);
  else load(f);
  e.target.value = '';
};
document.getElementById('fit').onclick = fitView;
document.getElementById('fly').onclick = flyRoute;
document.getElementById('plan').onclick = showFlightPlan;
document.getElementById('freq-table').onclick = showFreqTableModal;
document.getElementById('alt-pairs').onclick = showAltitudePairsModal;
document.getElementById('charts').onclick = showChartsModal;
const RETURN_KEY = 'navaid.showReturn';
const MIDLEG_KEY = 'navaid.showMidLeg';
const CUMTIME_KEY  = 'navaid.showCumTime';
const LIMIT_KITES_KEY = 'navaid.limitLegKites';
const SIM_URL_KEY  = 'navaid.simUrl';
const SIM_ON_KEY   = 'navaid.simOn';
const SIM_FOLLOW_KEY = 'navaid.simFollow';
try {
  const sr = localStorage.getItem(RETURN_KEY);
  if (sr !== null) window.showReturn =sr === '1';
  const sm = localStorage.getItem(MIDLEG_KEY);
  if (sm !== null) window.showMidLeg =sm === '1';
  const sc = localStorage.getItem(CUMTIME_KEY);
  if (sc !== null) window.showCumTime = sc === '1';
  const slk = localStorage.getItem(LIMIT_KITES_KEY);
  if (slk !== null) window.limitLegKites = slk === '1';
  const su = localStorage.getItem(SIM_URL_KEY);
  if (su) window.simUrl = su;
  const son = localStorage.getItem(SIM_ON_KEY);
  if (son !== null) window.simOn = son === '1';
  const sf = localStorage.getItem(SIM_FOLLOW_KEY);
  if (sf !== null) window.simFollow = sf === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('ret-cb').checked = showReturn;
document.getElementById('mid-cb').checked = showMidLeg;
document.getElementById('cumtime-cb').checked = showCumTime;
document.getElementById('limit-kites-cb').checked = limitLegKites;
document.getElementById('cumtime-cb').onchange = e => {
  window.showCumTime = e.target.checked;
  try { localStorage.setItem(CUMTIME_KEY, showCumTime ? '1' : '0'); } catch (err) { /* */ }
  draw();
};
document.getElementById('limit-kites-cb').onchange = e => {
  window.limitLegKites = e.target.checked;
  try { localStorage.setItem(LIMIT_KITES_KEY, limitLegKites ? '1' : '0'); } catch (err) { /* */ }
  draw();
};

// --- Simulator wiring ------------------------------------------------
(function () {
  const cb     = document.getElementById('sim-connect-cb');
  const urlInp = document.getElementById('sim-url');
  const followCb = document.getElementById('sim-follow-cb');
  const statusEl = document.getElementById('sim-status');
  if (!cb || !urlInp || !followCb || !statusEl) return;

  // Connect + Follow are toggle BUTTONS (not checkboxes). Track their state
  // via aria-pressed; the connect label swaps Connect ⇄ Disconnect.
  let connected = false;
  function setConnectLabel() {
    cb.textContent = connected ? (S.tbSimDisconnect || 'Disconnect from simulator')
                               : (S.tbSimConnect || 'Connect to simulator');
    cb.setAttribute('aria-pressed', String(connected));
  }
  function setFollowState() {
    followCb.setAttribute('aria-pressed', String(!!simFollow));
  }

  // Restore persisted state into UI controls.
  if (simUrl) urlInp.value = simUrl;
  setConnectLabel();
  setFollowState();

  // io.js's _simSetStatus reads window._simStatusEl at poll time.
  window._simStatusEl = statusEl;

  const saveSimUrl = () => {
    window.simUrl = urlInp.value.trim() || 'http://localhost:2020';
    try { localStorage.setItem(SIM_URL_KEY, window.simUrl); } catch (e) { /* */ }
  };
  urlInp.oninput  = saveSimUrl;
  urlInp.onchange = saveSimUrl;

  followCb.onclick = () => {
    window.simFollow = !simFollow;
    setFollowState();
    try { localStorage.setItem(SIM_FOLLOW_KEY, simFollow ? '1' : '0'); } catch (e) { /* */ }
  };

  cb.onclick = () => {
    connected = !connected;
    setConnectLabel();
    if (connected) {
      window.simUrl = urlInp.value.trim() || 'http://localhost:2020';
      window._simStatusEl = statusEl;
      if (typeof window.simStart === 'function') simStart();  // saves navaid.simOn
    } else {
      if (typeof window.simStop === 'function') simStop();    // saves navaid.simOn
    }
  };

  // Auto-reconnect if sim was active before the page refreshed.
  // Read localStorage directly — the global simOn may not yet reflect the
  // stored value when this IIFE runs (timing with other restore code).
  let _savedOn = false;
  try { _savedOn = localStorage.getItem('navaid.simOn') === '1'; } catch (e) { /* */ }
  if (_savedOn && typeof window.simStart === 'function') {
    connected = true;
    setConnectLabel();
    // Open the sim section so the user can see the connected state.
    const simSec = cb.closest('.tb-section');
    if (simSec && !simSec.classList.contains('open')) {
      simSec.classList.add('open');
      try { localStorage.setItem('navaid.sec.sim', '1'); } catch (e) { /* */ }
    }
    simStart();
  }
})();

document.getElementById('ret-cb').onchange = e => {
  window.showReturn =e.target.checked;
  try { localStorage.setItem(RETURN_KEY, showReturn ? '1' : '0'); } catch (err) { /* */ }
  if (fpOpen) { closeFlightPlan(); setTimeout(showFlightPlan, 0); }
  draw();
};
document.getElementById('mid-cb').onchange = e => {
  window.showMidLeg =e.target.checked;
  try { localStorage.setItem(MIDLEG_KEY, showMidLeg ? '1' : '0'); } catch (err) { /* */ }
  draw();
};
const WPNAME_KEY = 'navaid.showWpNames';
const WPANGLE_KEY = 'navaid.wpNameAngle';
try {
  const sn = localStorage.getItem(WPNAME_KEY);
  if (sn !== null) window.showWpNames =sn === '1';
  const sa = parseInt(localStorage.getItem(WPANGLE_KEY), 10);
  if (sa === 90 || sa === 180 || sa === 270) window.wpNameAngle =sa;
} catch (e) { /* storage unavailable */ }
document.getElementById('wpname-cb').checked = showWpNames;
document.getElementById('wpname-cb').onchange = e => {
  window.showWpNames =e.target.checked;
  try { localStorage.setItem(WPNAME_KEY, showWpNames ? '1' : '0'); }
  catch (err) { /* storage unavailable */ }
  draw();
};
document.getElementById('wpname-rot').onclick = e => {
  e.stopPropagation();                  // don't toggle the checkbox
  window.wpNameAngle =(wpNameAngle + 90) % 360;
  e.currentTarget.title = S.wpnameRotTitle(wpNameAngle);
  try { localStorage.setItem(WPANGLE_KEY, String(wpNameAngle)); }
  catch (err) { /* storage unavailable */ }
  draw();
};
const DIFF_KEY = 'navaid.highlightDiff';
try {
  const sd = localStorage.getItem(DIFF_KEY);
  if (sd !== null) window.highlightDiff =sd === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('diff-cb').checked = highlightDiff;
document.getElementById('diff-cb').onchange = e => {
  window.highlightDiff =e.target.checked;
  try { localStorage.setItem(DIFF_KEY, highlightDiff ? '1' : '0'); } catch (err) { /* */ }
  draw();
};
const DRIFT_KEY = 'navaid.showDrift';
try {
  const sd = localStorage.getItem(DRIFT_KEY);
  if (sd !== null) window.showDrift =sd === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('drift-cb').checked = showDrift;
document.getElementById('drift-cb').onchange = e => {
  window.showDrift =e.target.checked;
  try { localStorage.setItem(DRIFT_KEY, showDrift ? '1' : '0'); } catch (err) { /* */ }
  draw();
};
// When the user toggles an overlay ON, snap existing waypoints whose name
// is empty, auto-snapped, or a sequence label (WP N / locale prefix) to the
// nearest airfield / nav-WP. Preserves user-typed names. Priority matches
// applyNavSnap: airfields first.
function snapExistingWaypoints() {
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    if (wp.name && !isAutoSnapName(wp.name)) continue;
    const snap = nearestReference(wp, {
      pxThreshold: 18,
      includeAirfields: showAirfields,
      includeNavWaypoints: showNavWP,
      skipOccupiedRouteIndex: i,
    });
    if (snap && snap.ref) {
      wp.lat = r5(snap.ref.lat);
      wp.lng = r5(snap.ref.lng);
      wp.name = snap.ref.name;
    }
  }
}
const NAVWP_KEY = 'navaid.showNavWP';
try {
  const stored = localStorage.getItem(NAVWP_KEY);
  // New users (null) get the default-on; '0' / '1' override.
  if (stored !== null) window.showNavWP =stored === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('navwp-cb').checked = showNavWP;
document.getElementById('navwp-cb').onchange = async e => {
  window.showNavWP =e.target.checked;
  try { localStorage.setItem(NAVWP_KEY, showNavWP ? '1' : '0'); }
  catch (err) { /* storage unavailable */ }
  if (showNavWP) {
    await loadNavWaypoints();
    snapExistingWaypoints();
  }
  draw();
};
const REPORTING_KEY = 'navaid.showReporting';
try {
  const stored = localStorage.getItem(REPORTING_KEY);
  if (stored !== null) window.showReporting = stored === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('reporting-cb').checked = showReporting;
document.getElementById('reporting-cb').onchange = async e => {
  window.showReporting = e.target.checked;
  try { localStorage.setItem(REPORTING_KEY, showReporting ? '1' : '0'); }
  catch (err) { /* storage unavailable */ }
  if (showReporting && navWP === null) await loadNavWaypoints();
  draw();
};
// Minimum safe altitude row in the leg inspector (#673). Off by default —
// it is a planning aid, not a terrain-warning system, so users opt in.
const MSA_KEY = 'navaid.showMsa';
try {
  const stored = localStorage.getItem(MSA_KEY);
  if (stored !== null) window.showMsa = stored === '1';
} catch (e) { /* storage unavailable */ }
const msaCb = document.getElementById('msa-cb');
if (msaCb) {
  msaCb.checked = !!window.showMsa;
  msaCb.onchange = e => {
    window.showMsa = e.target.checked;
    try { localStorage.setItem(MSA_KEY, window.showMsa ? '1' : '0'); }
    catch (err) { /* storage unavailable */ }
    if (state.selected) showInspector();   // rebuild so the MSA row appears/clears
  };
}
// --- route-wide wind inputs (#722) ----------------------------------
// The wind lives in state.wind (persisted with the route, not in its own
// localStorage key — it's a property of the flight, like speed/altitude).
// The two View inputs drive it; the corner readout + every leg redraw react.
const windDirInput = document.getElementById('wind-dir');
const windSpeedInput = document.getElementById('wind-speed');
function refreshWindInputs() {
  const w = state.wind || { dir: 270, speed: 0 };
  if (windDirInput && document.activeElement !== windDirInput) {
    windDirInput.value = Number.isFinite(w.dir) ? String(w.dir) : '270';
  }
  if (windSpeedInput && document.activeElement !== windSpeedInput) {
    windSpeedInput.value = Number.isFinite(w.speed) ? String(w.speed) : '0';
  }
  refreshWindReadout();
}
window.refreshWindInputs = refreshWindInputs;
function commitWind() {
  if (!state.wind || typeof state.wind !== 'object') state.wind = { dir: 270, speed: 0 };
  const d = parseFloat(windDirInput && windDirInput.value);
  const s = parseFloat(windSpeedInput && windSpeedInput.value);
  state.wind.dir = Number.isFinite(d) ? ((Math.round(d) % 360) + 360) % 360 : state.wind.dir;
  state.wind.speed = Number.isFinite(s) && s >= 0 ? Math.round(s) : state.wind.speed;
  refreshWindReadout();
  if (state.selected && state.selected.type === 'leg') showInspector();
  if (typeof persist === 'function') persist();
  draw();
}
// Endless 0–359 spinner wrap on the route-wide direction input (attached
// before the commit handler so it cleans the value first).
if (windDirInput && typeof wrapDirectionInput === 'function') wrapDirectionInput(windDirInput);
if (windDirInput) windDirInput.oninput = commitWind;
if (windSpeedInput) windSpeedInput.oninput = commitWind;
// On blur / Enter, write the normalized value back so a typed -395 shows as
// its wrapped 325 (commitWind already stored the normalized value).
function writebackWindInputs() {
  commitWind();
  if (windDirInput) windDirInput.value = String(state.wind.dir);
  if (windSpeedInput) windSpeedInput.value = String(state.wind.speed);
}
if (windDirInput) windDirInput.onchange = writebackWindInputs;
if (windSpeedInput) windSpeedInput.onchange = writebackWindInputs;
// "Show wind effect" toggle (#722) gates the wind inputs, the per-leg map
// arrows, the corner readout, and the inspector wind rows. Off by default —
// it's a planning aid, not part of the core route picture.
const WIND_KEY = 'navaid.showWind';
try {
  const stored = localStorage.getItem(WIND_KEY);
  if (stored !== null) window.showWind = stored === '1';
} catch (e) { /* storage unavailable */ }
const showWindCb = document.getElementById('show-wind-cb');
const windInputRows = Array.from(document.querySelectorAll('.wind-input-row'));
function refreshWindInputVisibility() {
  // Inline display (not the `hidden` attribute) because `.navtoggle` sets
  // `display:flex`, which overrides the UA `[hidden] { display:none }`.
  for (const row of windInputRows) row.style.display = window.showWind ? '' : 'none';
}
if (showWindCb) {
  showWindCb.checked = !!window.showWind;
  showWindCb.onchange = e => {
    window.showWind = e.target.checked;
    try { localStorage.setItem(WIND_KEY, window.showWind ? '1' : '0'); }
    catch (err) { /* storage unavailable */ }
    refreshWindInputVisibility();
    refreshWindReadout();
    if (state.selected && state.selected.type === 'leg') showInspector();
    draw();
  };
}
refreshWindInputVisibility();
refreshWindInputs();
// --- Open-Meteo winds-aloft fetch (#722) ----------------------------
// Pull a real per-leg winds-aloft forecast (free, no key) and
// store each leg's own wind. Numeric source — the IMS aviation page only
// publishes chart images.
function legAltitudeFt(leg) {
  return Number.isFinite(leg && leg.inboundAltitude) ? leg.inboundAltitude : 3000;
}
function legMidpoint(i) {
  const a = state.waypoints[i], b = state.waypoints[i + 1];
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}
// Index of the hourly sample nearest now (Open-Meteo UTC times have no Z).
function nearestHourIndex(times) {
  const now = Date.now();
  let bi = 0, bd = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(Date.parse(times[i] + 'Z') - now);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
const windFetchBtn = document.getElementById('wind-fetch');
const windFetchStatus = document.getElementById('wind-fetch-status');
// Fetch a per-leg winds-aloft forecast: each leg gets its own wind from
// Open-Meteo at the leg midpoint and the pressure level matching that leg's
// altitude, stored as a per-leg override. Needs a route — with no legs it
// alerts (like the flight plan / export paths) and does nothing.
async function fetchRouteWind() {
  if (!state.legs.length) {
    if (windFetchStatus) windFetchStatus.textContent = '';
    alert(S.errNeedWps);
    return;
  }
  if (windFetchStatus) windFetchStatus.textContent = S.windFetching;
  if (windFetchBtn) windFetchBtn.disabled = true;
  try {
    // One batched request: comma-joined leg midpoints + the union of the
    // pressure-level params every leg needs; each leg reads its own level.
    const mids = state.legs.map((l, i) => legMidpoint(i));
    const levels = state.legs.map(l => nearestPressureLevelHpa(legAltitudeFt(l)));
    const uniq = Array.from(new Set(levels));
    const params = uniq.flatMap(l => ['wind_speed_' + l + 'hPa', 'wind_direction_' + l + 'hPa']);
    const url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + mids.map(m => m.lat.toFixed(3)).join(',') +
      '&longitude=' + mids.map(m => m.lng.toFixed(3)).join(',') +
      '&hourly=' + params.join(',') +
      '&wind_speed_unit=kn&timezone=UTC&forecast_days=1';
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const locs = Array.isArray(j) ? j : [j];        // multi-location → array
    let set = 0;
    for (let i = 0; i < state.legs.length; i++) {
      const loc = locs[i];
      const lvl = levels[i];
      const h = loc && loc.hourly;
      const times = h && h.time;
      const spd = h && h['wind_speed_' + lvl + 'hPa'];
      const dir = h && h['wind_direction_' + lvl + 'hPa'];
      if (!Array.isArray(times) || !Array.isArray(spd) || !Array.isArray(dir)) continue;
      const bi = nearestHourIndex(times);
      const wd = Math.round(dir[bi]), ws = Math.round(spd[bi]);
      if (!Number.isFinite(wd) || !Number.isFinite(ws)) continue;
      state.legs[i].wind = { dir: ((wd % 360) + 360) % 360, speed: Math.max(0, ws) };
      set++;
    }
    if (!set) throw new Error('no data');
    if (windFetchStatus) windFetchStatus.textContent = S.windFetchOkLegs(set);
    if (state.selected && state.selected.type === 'leg') showInspector();
    if (typeof persist === 'function') persist();
    draw();
  } catch (e) {
    if (windFetchStatus) windFetchStatus.textContent = S.windFetchErr;
  } finally {
    if (windFetchBtn) windFetchBtn.disabled = false;
  }
}
if (windFetchBtn) windFetchBtn.onclick = fetchRouteWind;
// --- SIGMET hazard overlay toggle -----------------------------------
const SIGMET_KEY = 'navaid.showSigmet';
try {
  const stored = localStorage.getItem(SIGMET_KEY);
  if (stored !== null) window.showSigmet = stored === '1';
} catch (e) { /* storage unavailable */ }
const sigmetCb = document.getElementById('sigmet-cb');
if (sigmetCb) {
  sigmetCb.checked = !!window.showSigmet;
  sigmetCb.onchange = async e => {
    window.showSigmet = e.target.checked;
    try { localStorage.setItem(SIGMET_KEY, window.showSigmet ? '1' : '0'); }
    catch (err) { /* storage unavailable */ }
    if (window.showSigmet && typeof loadSigmets === 'function') await loadSigmets();
    refreshSigmetReadout();
    draw();
  };
  if (window.showSigmet && typeof loadSigmets === 'function') {
    loadSigmets().then(() => { refreshSigmetReadout(); draw(); });
  }
}
const AIRFIELDS_KEY = 'navaid.showAirfields';
try {
  const stored = localStorage.getItem(AIRFIELDS_KEY);
  if (stored !== null) window.showAirfields =stored === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('airfield-cb').checked = showAirfields;
document.getElementById('airfield-cb').onchange = async e => {
  window.showAirfields =e.target.checked;
  try { localStorage.setItem(AIRFIELDS_KEY, showAirfields ? '1' : '0'); }
  catch (err) { /* storage unavailable */ }
  if (showAirfields) {
    await loadAirfields();
    snapExistingWaypoints();
  }
  draw();
};
// --- VOR/DME overlay + reference selector --------------------------------
const VOR_STATIONS_KEY = 'navaid.showVorStations';
const VOR_LEGACY_KEY = 'navaid.showVor';
const VOR_REF_KEY = 'navaid.vorRef';
const vorCb = document.getElementById('vor-cb');
const vorRefRow = document.getElementById('vor-ref-row');
const vorRefSelect = document.getElementById('vor-ref-select');
try {
  const storedStations = localStorage.getItem(VOR_STATIONS_KEY);
  const legacyStations = localStorage.getItem(VOR_LEGACY_KEY);
  if (storedStations !== null) {
    window.showVorStations = storedStations === '1';
  } else if (legacyStations !== null) {
    window.showVorStations = legacyStations === '1';
    localStorage.setItem(VOR_STATIONS_KEY, window.showVorStations ? '1' : '0');
    localStorage.removeItem(VOR_LEGACY_KEY);
  }
  const ref = localStorage.getItem(VOR_REF_KEY);
  if (ref) window.vorRef = ref;
} catch (e) { /* storage unavailable */ }
function populateVorRefSelect() {
  if (!vorRefSelect) return;
  vorRefSelect.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = S.vorRefNone || '— none —';
  vorRefSelect.appendChild(none);
  for (const v of (vors || [])) {
    const opt = document.createElement('option');
    opt.value = v.ident;
    opt.textContent = v.ident + ' · ' + v.name + ' (' + v.freq + ')';
    vorRefSelect.appendChild(opt);
  }
  vorRefSelect.value = vorRef || '';
}
function syncVorUI() {
  if (vorCb) vorCb.checked = showVorStations;
  // The reference selector is always available: picking a VOR for
  // radial/DME readouts is independent of the map-marker overlay.
  if (vorRefRow) vorRefRow.style.display = '';
  populateVorRefSelect();
}
if (vorCb) {
  vorCb.onchange = async e => {
    window.showVorStations = e.target.checked;
    try {
      localStorage.setItem(VOR_STATIONS_KEY, showVorStations ? '1' : '0');
      localStorage.removeItem(VOR_LEGACY_KEY);
    } catch (err) { /* */ }
    if (showVorStations && vors === null) await loadVors();
    syncVorUI();
    draw();
    if (state.selected) showInspector();   // refresh radial/DME rows
    if (typeof showCenterCoord === 'function') showCenterCoord();
    if (typeof refreshFlightPlan === 'function' && refreshFlightPlan) refreshFlightPlan();
  };
}
if (vorRefSelect) {
  vorRefSelect.onchange = e => {
    window.vorRef = e.target.value || null;
    try {
      if (vorRef) localStorage.setItem(VOR_REF_KEY, vorRef);
      else localStorage.removeItem(VOR_REF_KEY);
    } catch (err) { /* */ }
    draw();
    if (state.selected) showInspector();
    if (typeof showCenterCoord === 'function') showCenterCoord();
    // Keep an open flight plan's Radial/DME columns in sync.
    if (typeof refreshFlightPlan === 'function' && refreshFlightPlan) refreshFlightPlan();
  };
}
// Boot: keep the reference selector populated even when markers are hidden.
loadVors().then(() => {
  syncVorUI();
  retryPendingInspectorSelection();
  if (typeof showCenterCoord === 'function') showCenterCoord();
  if (showVorStations) draw();
});
const FORCE_SNAP_KEY = 'navaid.forceSnap';
try {
  const stored = localStorage.getItem(FORCE_SNAP_KEY);
  if (stored !== null) window.forceSnap = stored === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('force-snap-cb').checked = forceSnap;
document.getElementById('force-snap-cb').onchange = e => {
  window.forceSnap = e.target.checked;
  try { localStorage.setItem(FORCE_SNAP_KEY, forceSnap ? '1' : '0'); }
  catch (err) { /* storage unavailable */ }
};
// Comm-change overlay toggle (issue #399). The dataset lives in
// docs/data/comm-change.json and rings are drawn on top of the nav-WP dots
// in draw.js. This key intentionally replaced the legacy
// navaid.showCommChange key so users who had stored the old default-off
// state get the new default-on behavior.
const COMMCHANGE_KEY = 'navaid.showFreqChanges';
try {
  const stored = localStorage.getItem(COMMCHANGE_KEY);
  if (stored !== null) window.showCommChange = stored === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('commchange-cb').checked = showCommChange;
document.getElementById('commchange-cb').onchange = async e => {
  window.showCommChange = e.target.checked;
  try { localStorage.setItem(COMMCHANGE_KEY, showCommChange ? '1' : '0'); }
  catch (err) { /* storage unavailable */ }
  // Rings draw independently of the nav-WP dot layer (issue #484) but reuse
  // its positions, so load navWP too even when that layer is off.
  if (showCommChange) await Promise.all([loadCommChange(), loadNavWaypoints()]);
  let changed = false;
  if (showCommChange && typeof seedCommChangeNotes === 'function') {
    changed = seedCommChangeNotes();
  }
  if (!showCommChange && state.selected && state.selected.type === 'note') {
    const n = state.notes[state.selected.index];
    if (n && n.cc) {
      state.selected = null;
      showInspector();
    }
  }
  draw();
  if (state.selected && (changed || state.selected.type === 'wp')) showInspector();
};
const THEME_KEY = 'navaid.theme';
let displayTheme = 'dark';
try {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') displayTheme = stored;
  if (stored === 'day') displayTheme = 'light';
} catch (e) { /* storage unavailable */ }
function applyDisplayTheme() {
  document.body.classList.toggle('theme-light', displayTheme === 'light');
  document.body.classList.toggle('theme-dark', displayTheme !== 'light');
}
const THEME_TOGGLE_EL = document.getElementById('theme-toggle');
// The button shows the mode it switches TO: in dark it offers "Light mode",
// in light it offers "Dark mode".
function updateThemeToggleLabel() {
  if (!THEME_TOGGLE_EL) return;
  const toLight = displayTheme !== 'light';
  THEME_TOGGLE_EL.textContent = toLight
    ? '☀️ ' + (S.tbLightMode || 'Light mode')
    : '🌙 ' + (S.tbDarkMode || 'Dark mode');
}
applyDisplayTheme();
updateThemeToggleLabel();
if (THEME_TOGGLE_EL) {
  THEME_TOGGLE_EL.onclick = () => {
    displayTheme = displayTheme === 'light' ? 'dark' : 'light';
    applyDisplayTheme();
    updateThemeToggleLabel();
    try { localStorage.setItem(THEME_KEY, displayTheme); }
    catch (err) { /* storage unavailable */ }
  };
}
// Clear store: wipe every navaid.* key (routes, saved-route library, all
// settings) from local + session storage, then reload to a clean slate.
const CLEAR_STORE_EL = document.getElementById('clear-store');
if (CLEAR_STORE_EL) {
  CLEAR_STORE_EL.onclick = () => {
    if (!confirm(S.tbClearStoreConfirm ||
      'Delete ALL saved routes and settings stored on this device? This cannot be undone.')) return;
    try {
      Object.keys(localStorage).filter(k => k.indexOf('navaid.') === 0)
        .forEach(k => localStorage.removeItem(k));
      Object.keys(sessionStorage).filter(k => k.indexOf('navaid.') === 0)
        .forEach(k => sessionStorage.removeItem(k));
    } catch (e) { /* storage unavailable */ }
    location.reload();
  };
}
const ALPHA_KEY = 'navaid.yellowAlpha';
try {
  const v = parseFloat(localStorage.getItem(ALPHA_KEY));
  if (!isNaN(v)) window.yellowAlpha =Math.max(0, Math.min(1, v));
} catch (e) { /* storage unavailable */ }
function updateSliderVal(el, val) {
  const span = document.getElementById(el.id + '-val');
  if (span) span.textContent = val;
}
// Small ↻ button next to a Display slider that restores its HTML-default
// value. Re-fires the slider's own `input` handler so the var, the
// localStorage write, the value label and the redraw all run as if the
// user had dragged it back — no per-slider reset wiring needed.
function addSliderReset(el) {
  if (!el || !el.parentElement) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'slider-reset';
  btn.textContent = '↻';
  btn.title = S.sliderReset || 'Reset to default';
  btn.setAttribute('aria-label', btn.title);
  btn.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  el.parentElement.appendChild(btn);
}

const YELLOW_EL = document.getElementById('yellow-alpha');
YELLOW_EL.min = '0'; YELLOW_EL.max = '100'; YELLOW_EL.step = '5';
YELLOW_EL.value = Math.round(yellowAlpha * 100);
updateSliderVal(YELLOW_EL, YELLOW_EL.value + '%');
YELLOW_EL.oninput = e => {
  window.yellowAlpha =parseFloat(e.target.value) / 100;
  updateSliderVal(e.target, e.target.value + '%');
  try { localStorage.setItem(ALPHA_KEY, String(yellowAlpha)); }
  catch (err) { /* storage unavailable */ }
  draw();
};

const MAPOPACITY_KEY = 'navaid.mapOpacity.v2';
// `var` (not `let`) so writes from any module via window.mapOpacity reach
// the same binding the export reads — same hazard documented for every
// other mutable global in core.js.
var mapOpacity = 0.8;
function applyMapOpacity() {
  for (const n in layers) {
    if (map.hasLayer(layers[n])) layers[n].setOpacity(mapOpacity);
  }
}
try {
  const v = parseFloat(localStorage.getItem(MAPOPACITY_KEY));
  if (!isNaN(v)) mapOpacity = Math.max(0.1, Math.min(1, v));
} catch (e) { /* storage unavailable */ }
const MAPOPACITY_EL = document.getElementById('map-opacity');
MAPOPACITY_EL.min = '10'; MAPOPACITY_EL.max = '100'; MAPOPACITY_EL.step = '5';
MAPOPACITY_EL.value = Math.round(mapOpacity * 100);
updateSliderVal(MAPOPACITY_EL, MAPOPACITY_EL.value + '%');
applyMapOpacity();
MAPOPACITY_EL.oninput = e => {
  mapOpacity = parseFloat(e.target.value) / 100;
  updateSliderVal(e.target, e.target.value + '%');
  applyMapOpacity();
  try { localStorage.setItem(MAPOPACITY_KEY, String(mapOpacity)); }
  catch (err) { /* storage unavailable */ }
};

const WPSIZE_KEY = 'navaid.wpSize';
const WP_SIZE_MIN = 0.1, WP_SIZE_MAX = 2, WP_SIZE_STEP = 0.1;
try {
  const v = parseFloat(localStorage.getItem(WPSIZE_KEY));
  if (!isNaN(v)) window.wpSize =Math.max(WP_SIZE_MIN, Math.min(WP_SIZE_MAX, v));
} catch (e) { /* storage unavailable */ }
const WP_EL = document.getElementById('wp-size');
WP_EL.min = String(WP_SIZE_MIN); WP_EL.max = String(WP_SIZE_MAX); WP_EL.step = String(WP_SIZE_STEP);
WP_EL.value = wpSize;
updateSliderVal(WP_EL, parseFloat(wpSize).toFixed(2));
WP_EL.oninput = e => {
  window.wpSize =parseFloat(e.target.value);
  updateSliderVal(e.target, parseFloat(e.target.value).toFixed(2));
  try { localStorage.setItem(WPSIZE_KEY, String(wpSize)); }
  catch (err) { /* storage unavailable */ }
  draw();
};

const LEGARROW_KEY = 'navaid.legArrowSize';
const LEGARROW_MIN = 1, LEGARROW_MAX = 3, LEGARROW_STEP = 0.1;
try {
  const v = parseFloat(localStorage.getItem(LEGARROW_KEY));
  if (!isNaN(v)) window.legArrowSize =Math.max(LEGARROW_MIN, Math.min(LEGARROW_MAX, v));
} catch (e) { /* storage unavailable */ }
const LEGARROW_EL = document.getElementById('leg-arrow-size');
LEGARROW_EL.min = String(LEGARROW_MIN); LEGARROW_EL.max = String(LEGARROW_MAX); LEGARROW_EL.step = String(LEGARROW_STEP);
LEGARROW_EL.value = legArrowSize;
updateSliderVal(LEGARROW_EL, parseFloat(legArrowSize).toFixed(2));
LEGARROW_EL.oninput = e => {
  window.legArrowSize =parseFloat(e.target.value);
  updateSliderVal(e.target, parseFloat(e.target.value).toFixed(2));
  try { localStorage.setItem(LEGARROW_KEY, String(legArrowSize)); }
  catch (err) { /* storage unavailable */ }
  draw();
};

// Key bumped to v2 so existing users pick up the new 0.5 default + 0.1–2.0
// range instead of a stale saved value from the old 0.5–6 slider.
const LEGLINEWIDTH_KEY = 'navaid.legLineWidth2';
const LEGLINEWIDTH_MIN = 0.1, LEGLINEWIDTH_MAX = 2, LEGLINEWIDTH_STEP = 0.1;
try {
  const v = parseFloat(localStorage.getItem(LEGLINEWIDTH_KEY));
  if (!isNaN(v)) window.legLineWidth = Math.max(LEGLINEWIDTH_MIN, Math.min(LEGLINEWIDTH_MAX, v));
} catch (e) { /* storage unavailable */ }
const LEGLINEWIDTH_EL = document.getElementById('leg-line-width');
LEGLINEWIDTH_EL.min = String(LEGLINEWIDTH_MIN); LEGLINEWIDTH_EL.max = String(LEGLINEWIDTH_MAX); LEGLINEWIDTH_EL.step = String(LEGLINEWIDTH_STEP);
LEGLINEWIDTH_EL.value = legLineWidth;
updateSliderVal(LEGLINEWIDTH_EL, parseFloat(legLineWidth).toFixed(1));
LEGLINEWIDTH_EL.oninput = e => {
  window.legLineWidth = parseFloat(e.target.value);
  updateSliderVal(e.target, parseFloat(e.target.value).toFixed(1));
  try { localStorage.setItem(LEGLINEWIDTH_KEY, String(legLineWidth)); }
  catch (err) { /* storage unavailable */ }
  draw();
};

const DRIFTLINEWIDTH_KEY = 'navaid.driftLineWidth';
const DRIFTLINEWIDTH_MIN = 0.5, DRIFTLINEWIDTH_MAX = 6, DRIFTLINEWIDTH_STEP = 0.5;
try {
  const v = parseFloat(localStorage.getItem(DRIFTLINEWIDTH_KEY));
  if (!isNaN(v)) window.driftLineWidth = Math.max(DRIFTLINEWIDTH_MIN, Math.min(DRIFTLINEWIDTH_MAX, v));
} catch (e) { /* storage unavailable */ }
const DRIFTLINEWIDTH_EL = document.getElementById('drift-line-width');
DRIFTLINEWIDTH_EL.min = String(DRIFTLINEWIDTH_MIN); DRIFTLINEWIDTH_EL.max = String(DRIFTLINEWIDTH_MAX); DRIFTLINEWIDTH_EL.step = String(DRIFTLINEWIDTH_STEP);
DRIFTLINEWIDTH_EL.value = driftLineWidth;
updateSliderVal(DRIFTLINEWIDTH_EL, parseFloat(driftLineWidth).toFixed(1));
DRIFTLINEWIDTH_EL.oninput = e => {
  window.driftLineWidth = parseFloat(e.target.value);
  updateSliderVal(e.target, parseFloat(e.target.value).toFixed(1));
  try { localStorage.setItem(DRIFTLINEWIDTH_KEY, String(driftLineWidth)); }
  catch (err) { /* storage unavailable */ }
  draw();
};
// Per-slider reset buttons for the Display section sliders.
['yellow-alpha', 'map-opacity', 'wp-size', 'leg-arrow-size', 'leg-line-width', 'drift-line-width']
  .forEach(id => addSliderReset(document.getElementById(id)));
// magVar is hardcoded at -5 (5°E) in core.js; the input was removed.

document.getElementById('page-a3').onclick = () => setPage('A3');
document.getElementById('page-a4').onclick = () => setPage('A4');
// Restore last-used orientation and wire the toolbar toggle button.
try {
  const stored = localStorage.getItem('navaid.pageOrient');
  if (stored === 'portrait' || stored === 'landscape') window.pageOrient = stored;
} catch (e) { /* storage unavailable */ }
document.getElementById('page-orient').onclick = toggleOrientation;
refreshOrientButton();
// Restore the A3/A4 page frame across reloads — the frame re-centres on the
// current map view, so it reappears over the same area.
try {
  const sp = localStorage.getItem('navaid.pageSize');
  if ((sp === 'A3' || sp === 'A4') && typeof setPage === 'function') setPage(sp);
} catch (e) { /* storage unavailable */ }
document.getElementById('print').onclick = showExportModal;
createMagnifier();
document.getElementById('tool-magnifier').onclick = toggleMagnifier;
document.getElementById('tool-reset-all-markers').onclick = () => {
  // PR review #14: confirm before wiping every manual leg-marker offset —
  // this button is in the always-visible Build section so an accidental
  // click on a hand-tuned route was costly.
  if (!confirm(S.resetAllConfirm || 'Reset all marker positions?')) return;
  for (let i = 0; i < state.legs.length; i++) {
    const d = _defaultLegLabels();
    state.legs[i].inLabel = d.inLabel;
    state.legs[i].outLabel = d.outLabel;
    state.legs[i].cumLabel = d.cumLabel;
    state.legs[i].cumLabelRet = d.cumLabelRet;
  }
  for (const note of state.notes) {
    if (!note || !note.cc) continue;
    const target = typeof commCalloutTarget === 'function' ? commCalloutTarget(note) : null;
    if (target && typeof commCalloutDefaultTail === 'function') {
      const tail = commCalloutDefaultTail(target);
      note.lat = tail.lat;
      note.lng = tail.lng;
    }
  }
  draw();
};
document.getElementById('insp-close').onclick = () => {
  state.selected = null;
  showInspector(); draw();
};

// --- toolbar drag / responsive menu mode -----------------------------
const toolbarDesktopMenuQuery = window.matchMedia
  ? window.matchMedia('(min-width: 681px)')
  : null;

function toolbarUsesDesktopMenu() {
  return !!(toolbarDesktopMenuQuery && toolbarDesktopMenuQuery.matches);
}

function onToolbarDesktopMenuChange(fn) {
  if (!toolbarDesktopMenuQuery) return;
  if (toolbarDesktopMenuQuery.addEventListener) {
    toolbarDesktopMenuQuery.addEventListener('change', fn);
  } else if (toolbarDesktopMenuQuery.addListener) {
    toolbarDesktopMenuQuery.addListener(fn);
  }
}

function refreshMapAfterToolbarModeChange() {
  requestAnimationFrame(() => {
    try { if (map && typeof map.invalidateSize === 'function') map.invalidateSize(); }
    catch (e) { /* map not ready */ }
    try { if (typeof resizeOverlay === 'function') resizeOverlay(); }
    catch (e) { /* overlay not ready */ }
    try { if (typeof draw === 'function') draw(); }
    catch (e) { /* draw not ready */ }
  });
}

(function makeToolbarDraggable() {
  const bar = document.getElementById('toolbar');
  const handle = document.getElementById('toolbar-handle');
  const KEY = 'navaid.toolbarPos';
  // Desktop menu-bar position is stored separately from the mobile column
  // position — they mean different things and must not clobber each other
  // when the viewport crosses the breakpoint.
  const KEY_DESKTOP = 'navaid.toolbarPosDesktop';
  const COLLAPSED_KEY = 'navaid.toolbarCollapsed';
  const posKey = () => (toolbarUsesDesktopMenu() ? KEY_DESKTOP : KEY);
  let dx = 0, dy = 0, dragging = false;

  function clampPos(x, y) {
    const w = bar.offsetWidth, h = bar.offsetHeight;
    return {
      x: Math.max(8, Math.min(window.innerWidth - w - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - h - 8, y)),
    };
  }
  function setPos(x, y) {
    const c = clampPos(x, y);
    bar.style.left = c.x + 'px';
    bar.style.top = c.y + 'px';
    bar.style.right = 'auto';
  }

  function restorePos() {
    try {
      const raw = localStorage.getItem(posKey());
      if (raw) {
        const p = JSON.parse(raw);
        requestAnimationFrame(() => setPos(p.x, p.y));
      }
    } catch (e) { /* storage unavailable */ }
  }

  function clearInlineDesktopPos() {
    bar.style.left = '';
    bar.style.top = '';
    bar.style.right = '';
  }

  function start(cx, cy) {
    const r = bar.getBoundingClientRect();
    dx = cx - r.left;
    dy = cy - r.top;
    dragging = true;
    bar.classList.add('dragging');
  }
  function move(cx, cy) {
    if (!dragging) return;
    setPos(cx - dx, cy - dy);
  }
  function end() {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('dragging');
    const r = bar.getBoundingClientRect();
    try { localStorage.setItem(posKey(), JSON.stringify({ x: r.left, y: r.top })); }
    catch (e) { /* storage unavailable */ }
  }

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    start(e.clientX, e.clientY);
    const onMove = ev => move(ev.clientX, ev.clientY);
    const onUp = () => {
      end();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  handle.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    start(t.clientX, t.clientY);
  }, { passive: false });
  window.addEventListener('touchmove', e => {
    if (!dragging || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    move(t.clientX, t.clientY);
  }, { passive: false });
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);

  // collapse / expand the toolbar (keeps just the handle + toggle)
  const toggle = document.getElementById('toolbar-toggle');
  function setCollapsed(on, opts = {}) {
    const effective = toolbarUsesDesktopMenu() ? false : !!on;
    bar.classList.toggle('collapsed', effective);
    toggle.title = effective ? S.expandMenu : S.collapseMenu;
    if (opts.persist !== false && !toolbarUsesDesktopMenu()) {
      try { localStorage.setItem(COLLAPSED_KEY, effective ? '1' : '0'); } catch (e) { /* */ }
    }
    if (bar.style.left) {                 // size changed -> keep on screen
      requestAnimationFrame(() =>
        setPos(parseFloat(bar.style.left), parseFloat(bar.style.top)));
    }
  }
  toggle.addEventListener('click',
    () => setCollapsed(!bar.classList.contains('collapsed')));
  toggle.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setCollapsed(!bar.classList.contains('collapsed'));
    }
  });

  function applyResponsiveToolbarMode() {
    if (toolbarUsesDesktopMenu()) {
      dragging = false;
      bar.classList.remove('dragging');
      clearInlineDesktopPos();       // drop any leftover mobile-column position
      setCollapsed(false, { persist: false });
      restorePos();                  // re-apply a saved desktop position, if any
      refreshMapAfterToolbarModeChange();
      return;
    }
    restorePos();
    let sc = null;
    try { sc = localStorage.getItem(COLLAPSED_KEY); } catch (e) { /* storage unavailable */ }
    // Default collapsed on phones — an expanded toolbar column covers ~half the
    // map on a narrow screen. A saved phone choice wins.
    const narrowDefault = !!(window.matchMedia && window.matchMedia('(max-width: 680px)').matches);
    setCollapsed(sc === null ? narrowDefault : sc === '1', { persist: sc !== null });
    refreshMapAfterToolbarModeChange();
  }

  window.addEventListener('resize', () => {
    // Keep a dragged bar (mobile or desktop) on-screen after a resize.
    if (toolbarUsesDesktopMenu() && !bar.style.left) {
      setCollapsed(false, { persist: false });
      return;
    }
    if (bar.style.left) setPos(parseFloat(bar.style.left), parseFloat(bar.style.top));
  });

  onToolbarDesktopMenuChange(applyResponsiveToolbarMode);
  applyResponsiveToolbarMode();
})();

// --- section toggles -------------------------------------------------
(function makeSectionToggle() {
  const sections = Array.from(document.querySelectorAll('.tb-section'));
  const toolbar = document.getElementById('toolbar');
  function updateToolbarOpenCount() {
    const count = sections.filter(sec => sec.classList.contains('open')).length;
    if (!toolbar) return;
    toolbar.classList.toggle('multi-open', toolbarUsesDesktopMenu() && count > 1);
    toolbar.dataset.openCount = String(count);
  }
  function persist(sec, open) {
    try { localStorage.setItem('navaid.sec.' + sec.dataset.sec, open ? '1' : '0'); }
    catch (e) { /* storage unavailable */ }
  }
  function setSectionOpen(sec, open) {
    sec.classList.toggle('open', open);
    const head = sec.querySelector('.tb-section-head');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    persist(sec, open);
    updateToolbarOpenCount();
  }
  function closeOthers(sec) {
    for (const other of sections) {
      if (other !== sec && other.classList.contains('open')) {
        setSectionOpen(other, false);
      }
    }
  }
  function anySectionOpen() {
    return sections.some(sec => sec.classList.contains('open'));
  }
  function closeDesktopMenus() {
    if (!toolbarUsesDesktopMenu()) return;
    for (const sec of sections) {
      if (sec.classList.contains('open')) setSectionOpen(sec, false);
    }
  }

  for (const sec of sections) {
    const head = sec.querySelector('.tb-section-head');
    if (!head) continue;
    const key = 'navaid.sec.' + sec.dataset.sec;
    try {
      if (localStorage.getItem(key) === '1') sec.classList.add('open');
    } catch (e) { /* storage unavailable */ }
    head.setAttribute('aria-expanded', sec.classList.contains('open') ? 'true' : 'false');
    function toggle() {
      const willOpen = !sec.classList.contains('open');
      // Accordion behaviour: opening a section closes the others.
      if (willOpen) closeOthers(sec);
      setSectionOpen(sec, willOpen);
    }
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      if (toolbarUsesDesktopMenu() && e.key === 'ArrowDown') {
        e.preventDefault();
        closeOthers(sec);
        setSectionOpen(sec, true);
      }
      if (toolbarUsesDesktopMenu() && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const dir = (e.key === 'ArrowRight') === (document.documentElement.dir !== 'rtl') ? 1 : -1;
        const idx = sections.indexOf(sec);
        const next = sections[(idx + dir + sections.length) % sections.length];
        next?.querySelector('.tb-section-head')?.focus();
        if (sec.classList.contains('open') || anySectionOpen()) {
          closeOthers(next);
          setSectionOpen(next, true);
        }
      }
      if (toolbarUsesDesktopMenu() && e.key === 'Escape') {
        e.preventDefault();
        closeDesktopMenus();
        head.focus();
      }
    });
  }
  document.addEventListener('pointerdown', e => {
    if (!toolbarUsesDesktopMenu()) return;
    if (toolbar && toolbar.classList.contains('multi-open')) return;
    if (e.target && e.target.closest && e.target.closest('#toolbar')) return;
    closeDesktopMenus();
  });
  document.addEventListener('keydown', e => {
    if (toolbarUsesDesktopMenu() && e.key === 'Escape') closeDesktopMenus();
  });
  if (toolbar) {
    const closeAfterCommandIds = new Set([
      'search-trigger',
      'route-templates',
      'plan',
      'freq-table',
      'alt-pairs',
      'charts',
      'load',
      'route-library',
      'share',
      'fly',
      'print',
    ]);
    toolbar.addEventListener('click', e => {
      if (!toolbarUsesDesktopMenu()) return;
      const command = e.target && e.target.closest
        ? e.target.closest('.tb-section-body button')
        : null;
      if (!command) return;
      if (!closeAfterCommandIds.has(command.id)) return;
      window.setTimeout(closeDesktopMenus, 0);
    });
  }
  onToolbarDesktopMenuChange(updateToolbarOpenCount);
  window.closeToolbarDesktopMenus = closeDesktopMenus;
  updateToolbarOpenCount();
})();

// --- hidden tuning panel --------------------------------------------
// Developer-only preview surface for visual constants. It is intentionally
// page-local: no localStorage/sessionStorage writes, and reload restores the
// source defaults. Open with ?tune=1.
function tuningPanelEnabled() {
  const params = new URLSearchParams(location.search);
  // `?tune` / `?tune=1` enables; `?tune=0` (or false/no/off) explicitly
  // disables — a bare presence check wrongly treated tune=0 as "on".
  if (params.has('tune')) {
    const v = (params.get('tune') || '').trim().toLowerCase();
    return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
  }
  return params.get('dev') === 'tune' || location.hash === '#tune';
}

function formatTuneValue(spec, value) {
  if (spec.type === 'color' || spec.type === 'select') return String(value);
  const step = String(spec.step || 1);
  const dot = step.indexOf('.');
  const places = dot === -1 ? 0 : step.length - dot - 1;
  return places ? value.toFixed(places) : String(Math.round(value));
}

function redrawAfterTune() {
  applyTuningCssVars();
  draw();
  if (state.selected) showInspector();
  // The IMS overlay is a Leaflet layer (not part of draw()) — refresh it so
  // tuning its opacity / lat-lng offset updates it live.
  if (window.NavAid && typeof NavAid.refreshImsPwx === 'function') NavAid.refreshImsPwx();
}

function createTuningPanel() {
  if (!tuningPanelEnabled()) return;
  if (!NavAid.tuningDefaults || !NavAid.tuningGroups) return;

  const panel = document.createElement('aside');
  panel.id = 'tuning-panel';
  panel.setAttribute('aria-label', 'Tuning panel');
  panel.addEventListener('click', e => e.stopPropagation());
  panel.addEventListener('pointerdown', e => e.stopPropagation());
  panel.addEventListener('keydown', e => e.stopPropagation());
  panel.addEventListener('wheel', e => e.stopPropagation(), { passive: true });

  const header = document.createElement('div');
  header.className = 'tune-head';
  const title = document.createElement('strong');
  title.textContent = 'Tuning';
  const subtitle = document.createElement('span');
  subtitle.id = 'tune-subtitle';
  subtitle.textContent = 'Preview only. Resets on reload.';
  const left = document.createElement('div');
  left.style.cssText = 'display:flex;gap:12px;align-items:baseline';
  left.append(title, subtitle);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tune-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close tuning panel');
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  header.append(left, closeBtn);
  panel.appendChild(header);

  // Drag to reposition via header.
  {
    const KEY = 'navaid.tunePanelPos';
    let dx = 0, dy = 0, dragging = false;
    function clampPos(x, y) {
      const w = panel.offsetWidth, h = panel.offsetHeight;
      return {
        x: Math.max(8, Math.min(window.innerWidth - w - 8, x)),
        y: Math.max(8, Math.min(window.innerHeight - h - 8, y)),
      };
    }
    function setPos(x, y) {
      const c = clampPos(x, y);
      panel.style.left = c.x + 'px';
      panel.style.top = c.y + 'px';
      panel.style.right = 'auto';
    }
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        requestAnimationFrame(() => setPos(p.x, p.y));
      }
    } catch (e) { /* storage unavailable */ }
    function start(cx, cy) {
      const r = panel.getBoundingClientRect();
      dx = cx - r.left;
      dy = cy - r.top;
      dragging = true;
      panel.classList.add('dragging');
    }
    function move(cx, cy) {
      if (!dragging) return;
      setPos(cx - dx, cy - dy);
    }
    function end() {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('dragging');
      const r = panel.getBoundingClientRect();
      try { localStorage.setItem(KEY, JSON.stringify({ x: r.left, y: r.top })); }
      catch (e) { /* storage unavailable */ }
    }
    header.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      start(e.clientX, e.clientY);
      const onMove = ev => move(ev.clientX, ev.clientY);
      const onUp = () => {
        end();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  const actions = document.createElement('div');
  actions.className = 'tune-actions';
  const resetAll = document.createElement('button');
  resetAll.type = 'button';
  resetAll.id = 'tune-reset-all';
  resetAll.textContent = '↻';
  resetAll.title = 'Reset all tuning values';
  resetAll.setAttribute('aria-label', resetAll.title);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.id = 'tune-copy-json';
  copy.textContent = 'Copy JSON';
  actions.append(resetAll, copy);
  panel.appendChild(actions);

  // Find box — filters rows/groups by label or key (the registry is large).
  const find = document.createElement('input');
  find.type = 'search';
  find.id = 'tune-find';
  find.className = 'tune-find';
  find.placeholder = 'Find…';
  find.setAttribute('aria-label', 'Find tuning parameter');
  panel.appendChild(find);
  const filterGroups = [];   // { details, rows: [{ el, text }] }

  const controlSets = {};
  const syncControl = key => {
    const spec = NavAid.tuningDefaults[key];
    const v = tune(key);
    const text = formatTuneValue(spec, v);
    const set = controlSets[key];
    if (!set) return;
    if (set.range) set.range.value = String(v);
    if (set.number) set.number.value = text;
    if (set.color) set.color.value = String(v);
    if (set.text) set.text.value = text;
    if (set.select) set.select.value = String(v);
  };
  const applyValue = (key, raw) => {
    const spec = NavAid.tuningDefaults[key];
    if (spec && (spec.type === 'color' || spec.type === 'select')) {
      setTune(key, raw);
    } else {
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) {
        syncControl(key);
        return;
      }
      setTune(key, v);
    }
    syncControl(key);
    redrawAfterTune();
  };

  for (const group of NavAid.tuningGroups) {
    const details = document.createElement('details');
    details.className = 'tune-group';
    const summary = document.createElement('summary');
    summary.textContent = group.name;
    details.appendChild(summary);
    const groupEntry = { details, name: group.name.toLowerCase(), rows: [] };
    filterGroups.push(groupEntry);

    for (const key of group.keys) {
      const spec = NavAid.tuningDefaults[key];
      if (!spec) continue;
      const row = document.createElement('label');
      row.className = 'tune-row';
      row.htmlFor = 'tune-' + key + '-number';

      const name = document.createElement('span');
      name.className = 'tune-label';
      name.textContent = spec.label || key;

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.id = 'tune-' + key + '-reset';
      reset.className = 'tune-reset';
      reset.textContent = '↻';
      reset.title = 'Reset ' + (spec.label || key);
      reset.setAttribute('aria-label', reset.title);

      const set = {};
      if (spec.type === 'color') {
        const color = document.createElement('input');
        color.type = 'color';
        color.id = 'tune-' + key + '-color';
        color.setAttribute('aria-label', spec.label || key);

        const text = document.createElement('input');
        text.type = 'text';
        text.id = 'tune-' + key + '-text';
        text.inputMode = 'text';
        text.pattern = '#[0-9a-fA-F]{6}';
        text.setAttribute('aria-label', spec.label || key);

        set.color = color;
        set.text = text;
        color.addEventListener('input', () => applyValue(key, color.value));
        text.addEventListener('input', () => applyValue(key, text.value));
        row.append(name, color, text, reset);
      } else if (spec.type === 'select') {
        const select = document.createElement('select');
        select.id = 'tune-' + key + '-select';
        select.setAttribute('aria-label', spec.label || key);
        for (const opt of spec.options || []) {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt;
          select.appendChild(option);
        }

        set.select = select;
        select.addEventListener('change', () => applyValue(key, select.value));
        row.append(name, select, reset);
      } else {
        const range = document.createElement('input');
        range.type = 'range';
        range.id = 'tune-' + key + '-range';
        range.min = String(spec.min);
        range.max = String(spec.max);
        range.step = String(spec.step);

        const number = document.createElement('input');
        number.type = 'number';
        number.id = 'tune-' + key + '-number';
        number.min = String(spec.min);
        number.max = String(spec.max);
        number.step = String(spec.step);
        number.inputMode = 'decimal';
        number.setAttribute('aria-label', spec.label || key);

        set.range = range;
        set.number = number;
        range.addEventListener('input', () => applyValue(key, range.value));
        number.addEventListener('input', () => applyValue(key, number.value));
        row.append(name, range, number, reset);
      }

      groupEntry.rows.push({ el: row, text: ((spec.label || key) + ' ' + key).toLowerCase() });
      controlSets[key] = set;
      syncControl(key);
      reset.addEventListener('click', e => {
        e.preventDefault();
        resetTune(key);
        syncControl(key);
        redrawAfterTune();
      });

      details.appendChild(row);
    }

    panel.appendChild(details);
  }

  find.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    for (const g of filterGroups) {
      let shown = 0;
      for (const r of g.rows) {
        const hit = !q || r.text.includes(q) || g.name.includes(q);
        r.el.style.display = hit ? '' : 'none';
        if (hit) shown++;
      }
      g.details.style.display = shown ? '' : 'none';
      if (q) g.details.open = shown > 0;   // auto-expand matching groups while searching
    }
  });

  resetAll.addEventListener('click', () => {
    resetTune();
    for (const key of Object.keys(controlSets)) syncControl(key);
    redrawAfterTune();
  });
  copy.addEventListener('click', async () => {
    const current = {};
    for (const key of Object.keys(NavAid.tuningDefaults)) current[key] = tune(key);
    const text = JSON.stringify(current, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy JSON'; }, 1200);
    } catch (e) {
      copy.textContent = 'Copy failed';
      setTimeout(() => { copy.textContent = 'Copy JSON'; }, 1200);
    }
  });

  document.body.appendChild(panel);
  NavAid.tuningPanel = panel;
  // Lets a late source of overrides (e.g. the remote gist config, which lands
  // asynchronously after the panel is built) push its values into the controls.
  NavAid.syncTuningPanel = () => {
    for (const key of Object.keys(controlSets)) syncControl(key);
  };
}
createTuningPanel();

// --- boot ------------------------------------------------------------
resizeOverlay();
setMode(null);
// #162: if the URL carries share-link params (?r=…&n=…&l=…) the receiver
// gets the shared route. URL wins over localStorage so a paste of someone
// else's link doesn't appear to do nothing for a user who has their own
// saved route. If the share-link parse fails we fall through to restore.
const _sharedLoaded = tryLoadRouteFromUrl();
let _restoreResult = null;
if (!_sharedLoaded) {
  // restoreRoute() returns 'corrupt' when the saved blob exists but is
  // unparseable / has invalid coords. Set a flag so persist() refuses to
  // overwrite the (potentially recoverable) blob with empty state — see #73.
  _restoreResult = restoreRoute();
  if (_restoreResult === 'corrupt') {
    NavAid.corruptCache = true;
    const msg = S.errSavedRouteCorrupt(NavAid.corruptCacheError || '');
    console.warn('NavAid: ' + msg);
    alert(msg);
  }
} else {
  syncLegs();
}
let pendingInspectorSelection = null;
function retryPendingInspectorSelection() {
  if (!pendingInspectorSelection || typeof tryRestoreInspectorSelection !== 'function') return;
  const result = tryRestoreInspectorSelection(pendingInspectorSelection);
  if (result === 'restored' || result === 'invalid') {
    pendingInspectorSelection = null;
  }
}
try {
  pendingInspectorSelection = typeof readStoredInspectorSelection === 'function'
    ? readStoredInspectorSelection() : null;
  retryPendingInspectorSelection();
} catch (e) {}
// Issue #413 — restore the persisted viewport (center + zoom + bearing) so
// a reload lands on the user's last view. Falls back to fitView() only
// when no valid saved view exists. The bearing was already applied above
// from `navaid.view` (or `navaid.bearing`), so we only re-apply center +
// zoom here. `animate: false` avoids a visible pan on boot.
const _savedView = readSavedView();
if (_savedView) {
  map.setView([_savedView.lat, _savedView.lng], _savedView.zoom, { animate: false });
} else if (state.waypoints.length) {
  fitView();                              // first-time / cleared-storage path
}
draw();
// Always load nav-waypoints in the background — they power both the
// overlay toggle and the auto-snap on drop / drag.
loadNavWaypoints().then(() => {
  retryPendingInspectorSelection();
  snapExistingWaypoints();
  applyLegAltitudesToRoute();
  draw();
});
// Same pattern for airfields: powering both the overlay and snap.
// Also re-render inspector so plates section appears if a waypoint
// was restored from sessionStorage before airfields loaded.
loadAirfields().then(() => {
  retryPendingInspectorSelection();
  snapExistingWaypoints();
  applyLegAltitudesToRoute();
  if (showCommChange && typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
  draw();
  if (state.selected) showInspector();
});
// Leg-altitude green-route altitude table: fills only freshly-created legs, and
// leaves saved/imported/manual leg values authoritative.
loadLegAltitudes().then(() => {
  if (applyLegAltitudesToRoute()) {
    draw();
    if (state.selected) showInspector();
  }
});
// Comm-change dataset (issue #399): parallel fetch so the rings appear
// on first paint and the inspector badge is available immediately for
// a selection restored from sessionStorage. Rings draw independently of
// the nav-WP dot layer (issue #484), so when comm-change is on we also
// load navWP positions even if that layer is off.
loadCommChange().then(() => showCommChange ? loadNavWaypoints() : null)
  .then(() => {
    retryPendingInspectorSelection();
    if (showCommChange && typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
    draw();
    if (state.selected) showInspector();
  });
// Restore flight-plan modal if it was open before refresh / language change.
let restoredFlightPlan = false;
try {
  if (sessionStorage.getItem('navaid.fpOpen')) {
    sessionStorage.removeItem('navaid.fpOpen');
    if (state.waypoints.length && typeof showFlightPlan === 'function') {
      showFlightPlan();
      restoredFlightPlan = true;
    }
  }
} catch (e) {}
if (!restoredFlightPlan) restoreOpenChartModal();

// Save selected waypoint and flight-plan state on refresh / tab-close.
window.addEventListener('beforeunload', function () {
  if (typeof flushPersist === 'function') flushPersist();
  if (typeof persistInspectorSelection === 'function') persistInspectorSelection();
  if (window.fpOpen) {
    try { sessionStorage.setItem('navaid.fpOpen', '1'); } catch (e) {}
  }
});

function showBuildUpdateNotice() {
  if (document.getElementById('build-update-notice')) return;
  const el = document.createElement('div');
  el.id = 'build-update-notice';
  el.className = 'build-update-notice';
  el.setAttribute('role', 'status');
  const msg = document.createElement('span');
  msg.textContent = S.updateAvailable ||
    'New NavAid build available. Hard refresh or reload to update.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'update-reload';
  reload.textContent = S.updateReload || 'Reload';
  reload.onclick = () => window.location.reload();
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'update-dismiss';
  dismiss.textContent = S.updateDismiss || 'Dismiss';
  dismiss.onclick = () => el.remove();
  el.append(msg, reload, dismiss);
  document.body.appendChild(el);
}

const BUILD_UPDATE_CHECK_MIN_MS = 5 * 60 * 1000;
const BUILD_UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
let buildUpdateRegistration = null;
let buildUpdateCheckInFlight = null;
let lastBuildUpdateCheckAt = -Infinity;
let buildUpdateCheckTriggersBound = false;

function requestBuildUpdateCheck(reason, opts) {
  opts = opts || {};
  const sw = opts.serviceWorker ||
    (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : null);
  if (!sw && !buildUpdateRegistration) return Promise.resolve(null);

  const now = Date.now();
  if (!opts.force && now - lastBuildUpdateCheckAt < BUILD_UPDATE_CHECK_MIN_MS) {
    return buildUpdateCheckInFlight || Promise.resolve(buildUpdateRegistration);
  }
  lastBuildUpdateCheckAt = now;

  const regPromise = buildUpdateRegistration
    ? Promise.resolve(buildUpdateRegistration)
    : (sw && typeof sw.getRegistration === 'function'
      ? sw.getRegistration()
      : Promise.resolve(null));

  buildUpdateCheckInFlight = regPromise.then(reg => {
    if (!reg) return null;
    buildUpdateRegistration = reg;
    if (typeof reg.update !== 'function') return reg;
    return Promise.resolve(reg.update()).then(() => reg);
  }).catch(() => null).finally(() => {
    buildUpdateCheckInFlight = null;
  });
  return buildUpdateCheckInFlight;
}

function watchBuildUpdateCheckTriggers() {
  if (buildUpdateCheckTriggersBound) return;
  buildUpdateCheckTriggersBound = true;
  const request = reason => requestBuildUpdateCheck(reason);

  window.addEventListener('focus', () => request('focus'));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) request('visible');
  });

  document.addEventListener('click', e => {
    const target = e.target && e.target.closest ? e.target : null;
    if (!target || !target.closest('#toolbar')) return;
    if (target.closest('button, .tb-section-head, #toolbar-toggle')) request('toolbar');
  });
  document.addEventListener('change', e => {
    const target = e.target && e.target.closest ? e.target : null;
    if (!target || !target.closest('#toolbar')) return;
    if (target.closest('select, input')) request('toolbar-change');
  });

  window.setInterval(() => {
    if (!document.hidden) request('interval');
  }, BUILD_UPDATE_CHECK_INTERVAL_MS);
}

function watchServiceWorkerUpdates(sw) {
  if (!sw || typeof sw.register !== 'function') return Promise.resolve(null);
  const controlledAtStart = !!sw.controller;
  let hadController = controlledAtStart;
  let firstInstallWorker = null;
  const notifyIfUpdate = () => {
    if (hadController) showBuildUpdateNotice();
    hadController = true;
  };
  if (typeof sw.addEventListener === 'function') {
    sw.addEventListener('controllerchange', notifyIfUpdate);
  }
  return sw.register('sw.js').then(reg => {
    const watchWorker = worker => {
      if (!worker || typeof worker.addEventListener !== 'function') return;
      worker.addEventListener('statechange', () => {
        if ((worker.state === 'installed' || worker.state === 'activated') &&
            hadController) {
          if (!controlledAtStart && worker === firstInstallWorker) return;
          showBuildUpdateNotice();
        }
      });
    };
    if (!controlledAtStart && reg) firstInstallWorker = reg.installing || reg.waiting || null;
    if (reg && reg.waiting && hadController && reg.waiting !== firstInstallWorker) {
      showBuildUpdateNotice();
    }
    if (reg) {
      buildUpdateRegistration = reg;
      watchWorker(reg.installing);
      if (typeof reg.addEventListener === 'function') {
        reg.addEventListener('updatefound', () => watchWorker(reg.installing));
      }
      requestBuildUpdateCheck('load', { force: true, serviceWorker: sw });
    }
    return reg;
  }).catch(() => null);
}

// --- PWA: service worker --------------------------------------------
// Registering the worker makes the app installable; the browser shows
// the install control in the address bar — no in-app button needed.
if ('serviceWorker' in navigator) {
  watchBuildUpdateCheckTriggers();
  window.addEventListener('load', () => {
    watchServiceWorkerUpdates(navigator.serviceWorker);
  });
}

// Preload the terrain grid so MSA / terrain-clearance (#673) is ready when a
// leg inspector opens. No-op (coverage:false) until a real DEM is bundled.
if (typeof loadTerrain === "function") loadTerrain();

// Pull optional remote tuning overrides (gist) over the baked-in defaults, then
// repaint so they take effect. Silent fallback to defaults if the fetch fails.
if (typeof loadRemoteConfig === "function") {
  loadRemoteConfig().then(n => {
    if (!n) return;
    if (typeof applyTuningCssVars === "function") applyTuningCssVars();
    if (typeof scheduleDraw === "function") scheduleDraw();
    // Apply gist overrides to the IMS overlay too (opacity / lat-lng offset),
    // so alignment + opacity can be tuned from the gist without a redeploy.
    if (NavAid && typeof NavAid.refreshImsPwx === "function") NavAid.refreshImsPwx();
    // Reflect the loaded gist values in the tuning panel if it's open (?tune=1).
    if (NavAid && typeof NavAid.syncTuningPanel === "function") NavAid.syncTuningPanel();
    const sub = document.getElementById("tune-subtitle");
    if (sub) sub.textContent = "Loaded " + n + " value(s) from gist. Resets on reload.";
  });
}

// --- IMS PWX wind/temperature chart overlay --------------------------
// Manifest + PNGs are published by .github/workflows/ims-charts.yml to the
// ims-data orphan branch (the browser can't fetch ims.gov.il directly — no
// CORS). The control stays hidden until the manifest loads, so nothing shows
// before the first Action run.
(function imsPwxOverlay() {
  const RAW = 'https://raw.githubusercontent.com/msupino/NavigationApp/ims-data/';
  const box = document.getElementById('ims-pwx');
  const cb = document.getElementById('ims-pwx-cb');
  const controls = document.getElementById('ims-pwx-controls');
  const levelSel = document.getElementById('ims-pwx-level');
  const timeSel = document.getElementById('ims-pwx-time');
  const opacity = document.getElementById('ims-pwx-opacity');
  const opacityReset = document.getElementById('ims-pwx-opacity-reset');
  const DEFAULT_OPACITY = String(typeof tune === 'function' ? tune('imsPwxOpacity') : 1);
  if (!box || !cb || !levelSel || !timeSel || !opacity || typeof map === 'undefined') return;

  let manifest = null;
  let layer = null;

  const currentLevel = () => (manifest && manifest.levels.find(l => l.level === levelSel.value)) || null;
  const currentTime = () => {
    const lv = currentLevel();
    return lv && lv.times.find(t => t.valid === timeSel.value);
  };

  function removeLayer() {
    if (layer) { map.removeLayer(layer); layer = null; }
  }
  const off = k => (typeof tune === 'function' ? tune(k) : 0) || 0;
  function updateLayer() {
    if (!cb.checked || !manifest) { removeLayer(); return; }
    const t = currentTime();
    if (!t) { removeLayer(); return; }
    const b = manifest.bounds;
    // Tunable nudge (?tune=1 → Weather (IMS)) for fine-aligning the overlay.
    const dLat = off('imsPwxLatOffset'), dLng = off('imsPwxLngOffset');
    const bounds = [[b.s + dLat, b.w + dLng], [b.n + dLat, b.e + dLng]];
    const url = RAW + t.png + '?t=' + (manifest.generatedAt || '');
    if (!layer) {
      layer = L.imageOverlay(url, bounds, { opacity: +opacity.value, interactive: false, pane: 'overlayPane' });
      layer.addTo(map);
    } else {
      layer.setUrl(url);
      layer.setBounds(bounds);
      layer.setOpacity(+opacity.value);
    }
  }
  function fillTimes() {
    const lv = currentLevel();
    const prev = timeSel.value;            // keep the chosen period across FL changes
    timeSel.innerHTML = '';
    if (!lv) return;
    for (const t of lv.times) {
      const o = document.createElement('option');
      o.value = t.valid;
      o.textContent = t.valid + 'Z' + (t.day ? ' (' + t.day + ')' : '');   // Zulu
      timeSel.appendChild(o);
    }
    // Re-select the same valid time if the newly chosen level also has it.
    if (prev && lv.times.some(t => t.valid === prev)) timeSel.value = prev;
  }

  // Persist the on/off + selections so a reload keeps the overlay as it was.
  const KEY = 'navaid.imsPwx';
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        on: cb.checked, level: levelSel.value, valid: timeSel.value,
        opacity: +opacity.value,
      }));
    } catch (e) { /* storage unavailable */ }
  };
  // Let the tuning panel live-refresh the overlay when the offset/opacity
  // defaults change (the overlay isn't part of the canvas draw()).
  NavAid.refreshImsPwx = updateLayer;

  cb.addEventListener('change', () => {
    controls.hidden = !cb.checked;
    updateLayer(); persist();
  });
  levelSel.addEventListener('change', () => { fillTimes(); updateLayer(); persist(); });
  timeSel.addEventListener('change', () => { updateLayer(); persist(); });
  const showOpacity = () => updateSliderVal(opacity, Math.round(+opacity.value * 100) + '%');
  opacity.addEventListener('input', () => {
    if (layer) layer.setOpacity(+opacity.value);
    showOpacity(); persist();
  });
  if (opacityReset) opacityReset.addEventListener('click', () => {
    opacity.value = DEFAULT_OPACITY;
    if (layer) layer.setOpacity(+opacity.value);
    showOpacity(); persist();
  });
  opacity.value = DEFAULT_OPACITY;   // apply the (tunable) default + show it
  showOpacity();

  fetch(RAW + 'ims/pwx.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(m => {
      if (!m || !Array.isArray(m.levels) || !m.levels.length || !m.bounds) return;
      manifest = m;
      // List levels lowest-altitude first (FL030 before FL050) so the default
      // selection is the lowest CVFR level — higher hPa number = lower altitude.
      const ordered = m.levels.slice().sort((a, b) => Number(b.level) - Number(a.level));
      for (const lv of ordered) {
        const o = document.createElement('option');
        o.value = lv.level;
        o.textContent = lv.label || (lv.level + ' hPa');
        levelSel.appendChild(o);
      }
      fillTimes();
      // Restore the saved selection + on/off so a reload keeps the overlay.
      try {
        const sv = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (sv) {
          if (sv.level && [...levelSel.options].some(o => o.value === sv.level)) {
            levelSel.value = sv.level; fillTimes();
          }
          if (sv.valid && [...timeSel.options].some(o => o.value === sv.valid)) timeSel.value = sv.valid;
          if (Number.isFinite(sv.opacity)) { opacity.value = sv.opacity; showOpacity(); }
          if (sv.on) { cb.checked = true; controls.hidden = false; }
        }
      } catch (e) { /* storage unavailable */ }
      updateLayer();
      box.hidden = false;          // reveal the control now that data exists
    })
    .catch(() => { /* no ims-data branch yet → stay hidden */ });
})();

// --- IMS SIGWX significant-weather charts (in-app image viewer) ------
// No map overlay — these are wide-area prognostic charts. The button opens a
// modal with a valid-time dropdown and the chart image. Hidden until the
// ims-data sigwx manifest loads.
(function imsSigwxViewer() {
  const RAW = 'https://raw.githubusercontent.com/msupino/NavigationApp/ims-data/';
  const btn = document.getElementById('sigwx-btn');
  if (!btn) return;
  let manifest = null;
  let back = null;

  function close() {
    if (back) { back.remove(); back = null; }
    document.removeEventListener('keydown', onEsc, true);
  }
  function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  function open() {
    if (back || !manifest || !manifest.times.length) return;
    if (typeof closeToolbarDesktopMenus === 'function') closeToolbarDesktopMenus();
    back = document.createElement('div');
    back.className = 'modal-back';
    const box = document.createElement('div');
    box.className = 'modal wide sigwx-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.style.cursor = 'default';
    title.textContent = S.sigwxModalTitle || 'Significant weather (SIGWX)';
    box.appendChild(title);

    const sel = document.createElement('select');
    sel.className = 'sigwx-time';
    sel.setAttribute('aria-label', S.tbSigwxTime || 'Valid time');
    manifest.times.forEach((t, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = (t.day ? t.day + ' ' : '') + t.valid + 'Z';
      sel.appendChild(o);
    });
    box.appendChild(sel);

    const img = document.createElement('img');
    img.className = 'sigwx-img';
    img.alt = S.sigwxModalTitle || 'SIGWX chart';
    const note = document.createElement('div');
    note.className = 'sigwx-missing';
    note.hidden = true;
    note.textContent = S.sigwxMissing || 'Chart not available for this time yet.';
    // Read the png path from the trusted manifest by index — never from the
    // DOM-held select value (avoids CodeQL js/xss-through-dom #64).
    const load = () => {
      const t = manifest.times[sel.selectedIndex];
      if (!t) return;
      note.hidden = true; img.hidden = false;
      img.src = RAW + t.png + '?t=' + (manifest.generatedAt || '');
    };
    // If the PNG is missing (a forecast hour not yet published), show a note
    // instead of a broken-image icon.
    img.addEventListener('error', () => { img.hidden = true; note.hidden = false; });
    sel.addEventListener('change', load);
    load();
    box.appendChild(img);
    box.appendChild(note);

    if (typeof addModalCloseX === 'function') addModalCloseX(box, close);
    back.appendChild(box);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.addEventListener('keydown', onEsc, true);
    document.body.appendChild(back);
    sel.focus();
  }

  btn.addEventListener('click', open);

  fetch(RAW + 'ims/sigwx.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(m => {
      if (!m || !Array.isArray(m.times) || !m.times.length) return;
      manifest = m;
      btn.hidden = false;
    })
    .catch(() => { /* no sigwx data yet → stay hidden */ });
})();
