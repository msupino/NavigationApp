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
// Flight charts first (CVFR / LSA / Heli), then a separator, then base maps.
// '---' is a non-selectable divider. Any layer not listed is appended after.
const LAYER_ORDER = ['CVFR', 'Low Alt', 'Helicopters', '---',
                     'Navigation', 'Satellite', 'OpenStreetMap'];
const orderedLayerNames = [
  ...LAYER_ORDER.filter(n => n === '---' || layers[n]),
  ...Object.keys(layers).filter(n => !LAYER_ORDER.includes(n)),
];
for (const name of orderedLayerNames) {
  const opt = document.createElement('option');
  if (name === '---') { opt.disabled = true; opt.textContent = '──────────'; layerSelect.appendChild(opt); continue; }
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
  if (typeof updateBasemapUnderlay === 'function') updateBasemapUnderlay();
  applyMapOpacity();
  reloadLayerDatasets();                  // swap waypoints/comm/leg to the new layer's source
  draw();                                // keep the route overlay on top
  try { localStorage.setItem(LAYER_KEY, layerSelect.value); }
  catch (e) { /* storage unavailable */ }
};

// The active base layer decides which data files feed the overlays. On a layer
// switch, drop the per-layer caches and reload whatever is currently shown, so
// e.g. the LSA layer shows LSA waypoints while CVFR shows CVFR waypoints.
function reloadLayerDatasets() {
  _layerGen++;               // invalidate any in-flight fetch from the previous layer
  navWP = null;
  commChangeMap = null;
  commChangeCallSigns = {};
  legAltitudeMap = null;
  areas = null;
  // routeTemplates is a single shared list filtered per layer at render time —
  // no reload needed on layer switch.
  const jobs = [loadAreas()];
  // drawCommChangeRings() needs navWP even when only "show comm-change" is on
  // (not nav-waypoints/reporting) — include it here too, or rings silently
  // stop drawing after a layer switch until the user toggles nav-waypoints.
  if (showNavWP || showReporting || showCommChange) jobs.push(loadNavWaypoints());
  if (showCommChange || showReporting) jobs.push(loadCommChange());
  jobs.push(loadLegAltitudes());
  // Returned so callers (and tests) can await the reload settling instead of
  // polling globals or sleeping fixed intervals.
  return Promise.all(jobs).then(() => {
    // Refresh an open alt-pairs chart so it reflects the new layer's leg data.
    const altSec = document.querySelector('.charts-alt-section');
    if (altSec && typeof renderAltitudePairsTable === 'function') renderAltitudePairsTable(altSec);
    // Heal legs created while the reload was in flight (applyLegAltitudeToLeg
    // bails on a null table). Safe: applyLegAltitudesToRoute is pin-gated —
    // it only fills when the loaded table's prefix matches the route's pinned
    // layer, so a route built against another layer is never rewritten here.
    applyLegAltitudesToRoute();
    draw();
  });
}

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
// HH:MMZ — used for the "wind updated" stamp (Zulu, never localized).
function formatZuluHM(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + 'Z';
}
window.formatZuluHM = formatZuluHM;
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
  // The clock is styled entirely from tune values whose defaults are dark (white
  // text on a near-black pill) — correct on the dark map but wrong in light mode.
  // When a colour is still at its dark default, swap in a light palette for light
  // mode; any tune/gist override (a non-default value) always wins in both themes.
  // (Read the theme from the body class so applyDisplayTheme can re-run this.)
  const lightTheme = document.body.classList.contains('theme-light');
  const themed = (v, dark, light) =>
    (lightTheme && String(v).toLowerCase() === dark) ? light : v;
  root.setProperty('--navaid-zulu-clock-text-color',
    themed(tune('zuluClockTextColor'), '#ffffff', '#231f20'));
  root.setProperty('--navaid-zulu-clock-bg',
    cssRgba(themed(tune('zuluClockBgColor'), '#141212', '#ffffff'), tune('zuluClockBgAlpha')));
  root.setProperty('--navaid-zulu-clock-border',
    tune('zuluClockBorderWidthPx') + 'px solid ' +
    themed(tune('zuluClockBorderColor'), '#3a3636', '#9a9a9a'));
  px('--navaid-zulu-clock-border-radius', 'zuluClockBorderRadiusPx');
  root.setProperty('--navaid-zulu-clock-shadow',
    '0 ' + tune('zuluClockShadowYPx') + 'px ' + tune('zuluClockShadowBlurPx') +
    'px rgba(0, 0, 0, ' + tune('zuluClockShadowAlpha') + ')');

  // Dark-mode backdrop behind the IMS PWX overlay: the chart's white background
  // is made transparent in the pipeline, so its dark footer (valid time / model
  // run) vanishes against the dark map. Plate ONLY the bottom band (the footer)
  // with white — not the whole oversized image — so the surrounding map isn't
  // greyed. Off in light mode (see style.css). Tunable alpha + band height.
  const bdA = tune('imsPwxDarkBackdropAlpha');
  const bdBand = tune('imsPwxBackdropBandPct');
  root.setProperty('--navaid-ims-pwx-backdrop', bdA > 0
    ? `linear-gradient(to top, rgba(255,255,255,${bdA}) 0, rgba(255,255,255,${bdA}) ${bdBand}%, rgba(255,255,255,0) ${bdBand}%)`
    : 'none');
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
    radius: tune('gotoMarkerRadiusPx'), color: tune('gotoMarkerColor'), weight: tune('gotoMarkerWeightPx'),
    fillColor: tune('gotoMarkerFillColor'), fillOpacity: tune('gotoMarkerFillAlpha'),
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
  routeAltPrefix = null;    // replacing the route unpins its altitude layer
  currentRouteLibraryId = null;   // search-built route is not a saved entry
  state.waypoints = resolved.map(w => ({
    lat: w.lat, lng: w.lng, name: w.name,
  }));
  state.legs = [];
  state.notes = [];                       // fresh route: drop the previous route's freehand notes (seedCommChangeNotes re-adds comm notes)
  state.commChangeSuppressions = [];
  state.wind = { dir: 270, speed: 0 };     // search-built route carries no wind — don't inherit the previous route's
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
  // A template's waypoints live in its own layer's dataset; loading it on a
  // different base layer would miss those points. Warn instead of failing.
  const pfx = (typeof layerDataPrefix === 'function') ? layerDataPrefix() : 'cvfr';
  if (template.layer && template.layer !== 'any' && template.layer !== pfx) {
    const label = typeof layerLabelForPrefix === 'function' ? layerLabelForPrefix : (p => p);
    const msg = typeof S.routeTemplateWrongLayer === 'function'
      ? S.routeTemplateWrongLayer(routeTemplateLabel(template), label(pfx), label(template.layer))
      : 'Can\'t load this route on this layer.';
    alert(msg);
    return false;
  }
  const route = await routeFromTemplate(template, speed);
  const verr = typeof validateRoute === 'function' ? validateRoute(route) : null;
  if (verr) throw new Error(verr);
  if ((state.waypoints.length || state.notes.length) &&
      !confirm(S.routeTemplateReplaceConfirm ||
        S.searchReplaceConfirm ||
        'Replace the current route?')) return false;
  routeAltPrefix = null;    // template replaces the route — repin to its layer
  currentRouteLibraryId = null;   // template is not a saved entry
  state.waypoints = route.waypoints;
  state.legs = route.legs;
  state.notes = route.notes;
  state.commChangeSuppressions = Array.isArray(route.commChangeSuppressions)
    ? route.commChangeSuppressions.slice() : [];
  state.wind = { dir: 270, speed: 0 };     // template carries no route-wide wind — don't inherit the previous route's
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

function showRouteLibraryModal(focusSave) {
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
  // Opened via the Edit-header Save button on an unsaved route: suggest a name
  // ("first → last" waypoints) and focus+select it so the user can accept or
  // type over it immediately.
  if (focusSave) {
    if (typeof defaultSavedRouteName === 'function') nameInput.value = defaultSavedRouteName();
    setTimeout(() => { try { nameInput.focus(); nameInput.select(); } catch (e) { /* */ } }, 0);
  }

  const list = document.createElement('div');
  list.className = 'route-library-list';

  // Export / import the whole library as one JSON file.
  const tools = document.createElement('div');
  tools.className = 'route-library-tools';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.textContent = S.routeLibraryExport || 'Export library';
  exportBtn.onclick = () => {
    // When the stored library is corrupt, export the raw blob verbatim so the
    // user can attempt recovery — not the empty parsed fallback.
    const payload = (NavAid.routeLibraryCorrupt && typeof NavAid.routeLibraryCorruptRaw === 'string')
      ? NavAid.routeLibraryCorruptRaw
      : JSON.stringify(loadRouteLibrary(), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
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
      if (!added) {   // file had no valid routes → nothing to write
        if (typeof showToast === 'function') showToast(S.routeLibraryImportNone || 'No valid routes in that file');
        return;
      }
      // Only claim success (render + toast) if the write actually happened — a
      // corrupt library refuses the write, so don't show a false "imported".
      if (persistRouteLibrary(merged)) {
        render();
        if (typeof showToast === 'function') showToast(added + ' route(s) imported');
      }
    };
    reader.readAsText(f);
  };
  tools.append(exportBtn, importBtn, importFile);

  function render() {
    list.innerHTML = '';
    // Route entries carry `data`; GPS track entries carry `track` (no route
    // data). Include both; exclude tombstones.
    const entries = loadRouteLibrary().filter(e => e && !e.deleted &&
      (e.data || (e.kind === 'gps' && Array.isArray(e.track) && e.track.length)));
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
      const isGps = entry.kind === 'gps';
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
      if (isGps && typeof trackPointsFromEntry === 'function') {
        const pts = trackPointsFromEntry(entry);
        const nm2 = typeof trackDistanceNm === 'function' ? trackDistanceNm(pts) : 0;
        meta.textContent = pts.length + ' pts · ' + nm2.toFixed(1) + ' NM' + (when ? ' · ' + when : '');
      } else {
        meta.textContent = wpN + ' WP' + (when ? ' · ' + when : '');
      }
      main.append(nm, meta);
      // GPS tracks toggle a map overlay; routes replace the working route.
      main.onclick = isGps
        ? () => { if (typeof toggleTrackOverlay === 'function') { toggleTrackOverlay(entry); render(); } }
        : () => { if (routeLibraryApply(entry)) modal.close(); };

      const actions = document.createElement('div');
      actions.className = 'route-library-actions';
      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'route-library-load';
      if (isGps) {
        const shown = typeof isTrackShown === 'function' && isTrackShown(entry.id);
        loadBtn.textContent = shown ? (S.routeLibraryHide || 'Hide') : (S.routeLibraryShow || 'Show');
        loadBtn.onclick = () => { if (typeof toggleTrackOverlay === 'function') { toggleTrackOverlay(entry); render(); } };
      } else {
        loadBtn.textContent = S.routeLibraryLoad || 'Load';
        loadBtn.onclick = () => { if (routeLibraryApply(entry)) modal.close(); };
      }
      // Per-row Save overwrites this saved route with the current one — routes
      // only (a GPS track is a recording, not an editable route). Appended
      // conditionally below.
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'route-library-save';
      save.textContent = S.routeLibrarySave || 'Save';
      save.onclick = () => {
        if (!confirm((S.routeLibrarySaveConfirm && S.routeLibrarySaveConfirm(entry.name)) ||
            ('Overwrite "' + entry.name + '" with the current route?'))) return;
        if (routeLibraryUpdate(entry.id)) render();
      };
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
        if (typeof hideTrackOverlay === 'function') hideTrackOverlay(entry.id);
        // Deleting the currently-loaded route unbinds the header Save from the
        // now-tombstoned id.
        if (currentRouteLibraryId === entry.id) currentRouteLibraryId = null;
        if (persistRouteLibrary(all)) render();
      };
      if (isGps) {
        const gpx = document.createElement('button');
        gpx.type = 'button';
        gpx.textContent = S.routeLibraryExportGpx || 'GPX';
        gpx.onclick = () => { if (typeof downloadGpsTrackGpx === 'function') downloadGpsTrackGpx(entry); };
        actions.append(loadBtn, rename, gpx, del);   // read-only track: Show/Hide + GPX only
      } else {
        actions.append(loadBtn, save, rename, dup, del);
      }
      row.append(main, actions);
      list.appendChild(row);
    }
  }

  body.append(saveRow, list, tools);

  // Corrupt library (issue mirror of #73): loadRouteLibrary() sets the flag.
  // Surface it with recovery actions and note that saving is blocked
  // (persistRouteLibrary refuses to overwrite the raw blob).
  loadRouteLibrary();
  if (NavAid.routeLibraryCorrupt) {
    const warn = document.createElement('div');
    warn.className = 'route-library-corrupt';
    const msg = document.createElement('p');
    msg.textContent = S.routeLibraryCorruptBanner ||
      'Saved routes could not be read (the stored data is corrupted).';
    const acts = document.createElement('div');
    acts.className = 'route-library-tools';
    const exp = document.createElement('button');
    exp.type = 'button';
    exp.textContent = S.routeLibraryExportCorrupt || 'Export corrupted data';
    exp.onclick = () => exportBtn.click();     // exports the raw blob when corrupt
    const disc = document.createElement('button');
    disc.type = 'button';
    disc.className = 'route-library-del';
    disc.textContent = S.routeLibraryDiscardCorrupt || 'Discard corrupted library';
    disc.onclick = () => {
      if (!confirm(S.routeLibraryDiscardCorruptConfirm ||
        'Discard the corrupted saved-route library and start empty? This cannot be undone.')) return;
      persistRouteLibrary([], { force: true });
      render();
      warn.remove();
    };
    acts.append(exp, disc);
    warn.append(msg, acts);
    body.prepend(warn);
  }

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
      // With return legs off, reset the (hidden) return speed to the forward
      // speed rather than preserving a stale value — intentional, see
      // flight-plan.spec.js "reverse route preserves flightSpeed when showReturn is off".
      outboundSpeed: showReturn ? l.flightSpeed : l.flightSpeed,
      inLabel:  flipLabel(inOld, d.inLabel),
      outLabel: flipLabel(outOld, d.outLabel),
      cumLabel: flipLabel(cumOld, d.cumLabel),
      cumLabelRet: flipLabel(cumRetOld, d.cumLabelRet),
      // Per-leg winds-aloft is an absolute FROM-direction — identical whether the
      // leg is flown A->B or B->A — so carry it over unchanged; dropping it made
      // Reverse silently discard a pulled forecast and corrupt heading/GS/ETE.
      ...(l.wind ? { wind: l.wind } : {}),
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
  state.wind = { dir: 270, speed: 0 };     // cleared route: reset wind so a new hand-built route doesn't inherit it
  state.selected = null;
  routeAltPrefix = null;    // empty route unpins its altitude layer
  currentRouteLibraryId = null;   // cleared route is no longer a saved entry
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
// Wrap so the click Event isn't forwarded as showRouteLibraryModal's focusSave
// argument (which would prefill + focus the name field just for browsing).
document.getElementById('route-library').onclick = () => showRouteLibraryModal();

// Save/Load route shortcuts, shared by the in-header pair (accordion) and the
// standalone .tb-quick pair (desktop menubar) via .js-save-route/.js-load-route.
// The accordion pair sits inside the clickable section header, so the handlers
// stopPropagation to avoid also toggling the section open/closed.
function saveRouteFromHeader(e) {
  if (e) e.stopPropagation();
  // Nothing to save on an empty/too-short route — pop an error instead of
  // opening the menu or attempting an overwrite (a route needs >=2 waypoints).
  if (state.waypoints.length < 2) {
    alert(S.errNothingToSave || S.errNeedWps || 'Nothing to save.');
    return;
  }
  // If the current route came from a saved entry, overwrite that same entry
  // (with a confirm warning). Otherwise it's an unsaved route — open the Saved
  // routes menu so the user can name and save it.
  const id = currentRouteLibraryId;
  const existing = id
    ? loadRouteLibrary().find(x => x && x.id === id && !x.deleted && x.data)
    : null;
  if (!existing) { showRouteLibraryModal(true); return; }
  const msg = (typeof S.routeLibrarySaveConfirm === 'function')
    ? S.routeLibrarySaveConfirm(existing.name)
    : ('Overwrite "' + existing.name + '" with the current route?');
  if (!confirm(msg)) return;
  const entry = routeLibraryUpdate(id);
  if (!entry) return;
  if (typeof refreshRouteLibrary === 'function') refreshRouteLibrary();
  if (typeof showToast === 'function') {
    showToast(typeof S.routeLibrarySaved === 'function'
      ? S.routeLibrarySaved(entry.name) : entry.name + ' saved');
  }
}
function loadRouteFromHeader(e) {
  if (e) e.stopPropagation();
  showRouteLibraryModal();
}
for (const el of document.querySelectorAll('.js-save-route')) el.onclick = saveRouteFromHeader;
for (const el of document.querySelectorAll('.js-load-route')) el.onclick = loadRouteFromHeader;

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
document.getElementById('plan').onclick = () => {
  if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
  showFlightPlan();
};
document.getElementById('freq-table').onclick = showFreqTableModal;
document.getElementById('alt-pairs').onclick = showAltitudePairsModal;
document.getElementById('charts').onclick = showChartsModal;
(function () {
  const mb = document.getElementById('mosaic-btn');
  if (mb) mb.onclick = () => { if (typeof showRouteMosaicModal === 'function') showRouteMosaicModal(); };
}());
// Footer GPS buttons render as compact icons (label hidden at desktop), so set
// the icon glyph + the (hidden) text label rather than replacing the button's
// content.
function setFooterBtn(btn, label, icon) {
  if (!btn) return;
  const t = btn.querySelector('.footer-link-text');
  if (t) t.textContent = label; else btn.textContent = label;
  const ic = btn.querySelector('.footer-link-icon');
  if (ic && icon) ic.textContent = icon;
}
const gpsBtn = document.getElementById('gps-record');
if (gpsBtn) {
  // Recording works via the native background-geolocation plugin too, so only
  // disable when neither the web API nor the native watch is available (else
  // the APK, where navigator.geolocation can be absent, would disable it).
  if (!navigator.geolocation && !(typeof _bgGeo === 'function' && _bgGeo())) { gpsBtn.disabled = true; }
  gpsBtn.addEventListener('click', () => {
    // The label/icon/aria are kept in lockstep with gpsRecording by
    // updateGpsRecIndicator() (called from start/stop), so they stay correct
    // even if a start step throws — no manual flip here.
    if (gpsRecording) {
      stopGpsRecordingAndSave();
      if (typeof window.refreshRouteLibrary === 'function') window.refreshRouteLibrary();
    } else {
      startGpsRecording();
    }
  });
}
const liveBtn = document.getElementById('gps-live');
if (liveBtn) {
  if (!navigator.geolocation) { liveBtn.disabled = true; }
  liveBtn.addEventListener('click', () => {
    if (gpsLiveOn) {
      stopLiveLocation();
      setFooterBtn(liveBtn, S.tbGpsLive, '📍'); liveBtn.setAttribute('aria-pressed', 'false');
    } else {
      startLiveLocation();
      if (gpsLiveOn) { setFooterBtn(liveBtn, S.tbGpsLiveStop, '📍'); liveBtn.setAttribute('aria-pressed', 'true'); }
    }
  });
}
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

  // One-shot recenter on the live aircraft (distinct from continuous Follow).
  const centerBtn = document.getElementById('sim-center');
  if (centerBtn) centerBtn.onclick = () => {
    const a = window.simAircraft;
    const have = a && Number.isFinite(a.lat) && Number.isFinite(a.lng);
    if (have) map.setView([a.lat, a.lng], map.getZoom());
    // Always flash so the one-shot click gives visible feedback — green when it
    // recentered, a muted "no-data" flash when there's no live position yet.
    centerBtn.classList.remove('sim-flash', 'sim-flash-nodata');
    void centerBtn.offsetWidth;                   // restart the animation
    centerBtn.classList.add(have ? 'sim-flash' : 'sim-flash-nodata');
    setTimeout(() => centerBtn.classList.remove('sim-flash', 'sim-flash-nodata'), 600);
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
    // The sim panel now lives behind the footer icon (#sim-modal); the
    // connected status shows when the user opens it. Just resume polling.
    simStart();
  }
})();

// Footer plane icon ⇄ simulator panel modal (#sim-modal).
(function () {
  const trigger = document.getElementById('sim-trigger');
  const modal = document.getElementById('sim-modal');
  const closeBtn = document.getElementById('sim-modal-close');
  if (!trigger || !modal) return;
  const open = () => {
    if (typeof closeToolbarDesktopMenus === 'function') closeToolbarDesktopMenus();
    modal.classList.remove('hidden');
  };
  const close = () => modal.classList.add('hidden');
  trigger.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });
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
try {
  const sn = localStorage.getItem(WPNAME_KEY);
  if (sn !== null) window.showWpNames =sn === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('wpname-cb').checked = showWpNames;
document.getElementById('wpname-cb').onchange = e => {
  window.showWpNames =e.target.checked;
  try { localStorage.setItem(WPNAME_KEY, showWpNames ? '1' : '0'); }
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
// There is no manual wind UI: route-wide wind (state.wind) only comes from a
// loaded route, and per-leg wind (leg.wind) only from the realtime winds-aloft
// fetch. The inspector shows it read-only. refreshWindInputs is kept (and
// exported) purely as the post-load hook io.js calls — it refreshes the readout.
function windDefault() { return { dir: tune('windDir'), speed: tune('windSpeed') }; }
function refreshWindInputs() { refreshWindReadout(); }
window.refreshWindInputs = refreshWindInputs;
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
    // Turning the wind display ON pulls the forecast by itself when a route
    // exists — no separate Pull Wind click needed. Toggle-only (not boot
    // restore): an auto-fetch on every load would silently overwrite wind
    // values the user set by hand.
    if (window.showWind && state.legs.length && typeof fetchRouteWind === 'function') {
      fetchRouteWind();
    }
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
// Index of the hourly sample nearest `atMs` (default: now). Open-Meteo UTC
// times carry no Z suffix.
function nearestHourIndex(times, atMs) {
  const target = Number.isFinite(atMs) ? atMs : Date.now();
  let bi = 0, bd = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(Date.parse(times[i] + 'Z') - target);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
// Forecast ETA (ms since epoch) of each leg's midpoint from `departMs`:
// legs are flown in sequence, so leg i's midpoint is reached after the sum
// of the prior legs' ETEs plus half its own. Legs without a usable speed
// contribute no time — their midpoint ETA falls back to the running total.
function legMidpointEtas(departMs) {
  const t0 = Number.isFinite(departMs) ? departMs : Date.now();
  const etas = [];
  let tH = 0;
  for (let i = 0; i < state.legs.length; i++) {
    const { dist } = geo(state.waypoints[i], state.waypoints[i + 1]);
    const legH = state.legs[i].flightSpeed > 0 ? dist / state.legs[i].flightSpeed : 0;
    etas.push(t0 + (tH + legH / 2) * 3600e3);
    tH += legH;
  }
  return etas;
}
const windFetchStatus = document.getElementById('wind-fetch-status');
// Departure-offset slider: forecast departure = now + N hours (0 = now).
// Session-only — a planned departure is flight-specific, not a setting.
const windDepartSlider = document.getElementById('wind-depart');
const windDepartVal = document.getElementById('wind-depart-val');
function windDepartOffsetH() {
  return windDepartSlider ? (parseInt(windDepartSlider.value, 10) || 0) : 0;
}
function refreshWindDepartLabel() {
  if (!windDepartVal) return;
  // Same readout as the NOTAM and wind-field look-ahead sliders:
  // 0 shows the clock of now, otherwise '+Nh · <clock>' (fmtViewTime).
  windDepartVal.textContent = notamTimeLabel(windDepartOffsetH());
}
// Fetch a per-leg winds-aloft forecast: each leg gets its own wind from
// Open-Meteo at the leg midpoint, the pressure level matching that leg's
// altitude, AND the forecast hour matching that leg's ETA (departure = now +
// the slider offset) — so a two-hour route's last legs get the wind expected
// when the aircraft actually reaches them, not the wind blowing there now.
// Stored as a per-leg override. Needs a route — with no legs it alerts (like
// the flight plan / export paths) and does nothing.
//
// The response carries ALL hourly samples (forecast_days=3), so moving the
// departure slider re-samples from this cache locally — no refetch unless
// the route itself changed since the fetch.
let windFetchCache = null;   // { locs, levels, sig }
function windRouteSig() {
  return JSON.stringify(state.waypoints.map(w => [r5(w.lat), r5(w.lng)])) + '|' +
         JSON.stringify(state.legs.map(l => [legAltitudeFt(l), l.flightSpeed]));
}
// Write each leg's wind from the fetched hourly data at the current slider
// departure. Returns the number of legs set; on success stamps windUpdated,
// refreshes the status/inspector, persists and redraws. `skipPersist` is for
// live slider drags: every tick re-samples and redraws, but only the release
// persists — otherwise each dragged hour would pile up an undo step.
function applyRouteWindSamples(locs, levels, skipPersist) {
  const etas = legMidpointEtas(Date.now() + windDepartOffsetH() * 3600e3);
  let set = 0;
  for (let i = 0; i < state.legs.length; i++) {
    const loc = locs[i];
    const lvl = levels[i];
    const h = loc && loc.hourly;
    const times = h && h.time;
    const spd = h && h['wind_speed_' + lvl + 'hPa'];
    const dir = h && h['wind_direction_' + lvl + 'hPa'];
    if (!Array.isArray(times) || !Array.isArray(spd) || !Array.isArray(dir)) continue;
    const bi = nearestHourIndex(times, etas[i]);   // this leg's forecast ETA
    const wd = Math.round(dir[bi]), ws = Math.round(spd[bi]);
    if (!Number.isFinite(wd) || !Number.isFinite(ws)) continue;
    state.legs[i].wind = { dir: ((wd % 360) + 360) % 360, speed: Math.max(0, ws) };
    set++;
  }
  if (set) {
    state.windUpdated = Date.now();          // Zulu stamp for the readout
    if (windFetchStatus) {
      windFetchStatus.textContent = S.windFetchOkLegs(set) + ' · ' + formatZuluHM(state.windUpdated);
    }
    if (state.selected && state.selected.type === 'leg') showInspector();
    if (!skipPersist && typeof persist === 'function') persist();
    draw();
  }
  return set;
}
async function fetchRouteWind() {
  if (!state.legs.length) {
    if (windFetchStatus) windFetchStatus.textContent = '';
    alert(S.errNeedWps);
    return;
  }
  if (windFetchStatus) windFetchStatus.textContent = S.windFetching;
  try {
    // One batched request: comma-joined leg midpoints + the union of the
    // pressure-level params every leg needs; each leg reads its own level.
    const mids = state.legs.map((l, i) => legMidpoint(i));
    const levels = state.legs.map(l => nearestPressureLevelHpa(legAltitudeFt(l)));
    const uniq = Array.from(new Set(levels));
    const params = uniq.flatMap(l => ['wind_speed_' + l + 'hPa', 'wind_direction_' + l + 'hPa']);
    // forecast_days=3: the departure slider reaches +24 h, plus route time,
    // plus a late-UTC "now" can cross two UTC-day boundaries; fewer days
    // would clamp those legs to the last fetched hour.
    const url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + mids.map(m => m.lat.toFixed(3)).join(',') +
      '&longitude=' + mids.map(m => m.lng.toFixed(3)).join(',') +
      '&hourly=' + params.join(',') +
      '&wind_speed_unit=kn&timezone=UTC&forecast_days=3';
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const locs = Array.isArray(j) ? j : [j];        // multi-location → array
    if (!applyRouteWindSamples(locs, levels)) throw new Error('no data');
    windFetchCache = { locs, levels, sig: windRouteSig() };
  } catch (e) {
    if (windFetchStatus) windFetchStatus.textContent = S.windFetchErr;
  }
}
// A new leg added while the wind display is on gets its wind too: the route
// signature changed, so this refetches (cache miss) and fills the new leg.
// Debounced — several quick waypoint adds coalesce into one request.
let windLegGrowTimer = null;
window.onRouteLegsGrown = function () {
  if (!window.showWind) return;
  clearTimeout(windLegGrowTimer);
  windLegGrowTimer = setTimeout(() => { if (state.legs.length) fetchRouteWind(); }, 400);
};
if (windDepartSlider) {
  // The wind updates immediately while dragging: every input tick re-samples
  // the cached hourly data locally (no network) and redraws; persistence
  // waits for the release so the drag collapses into one undo step.
  windDepartSlider.oninput = () => {
    refreshWindDepartLabel();
    if (!state.legs.length) return;
    if (windFetchCache && windFetchCache.sig === windRouteSig()) {
      applyRouteWindSamples(windFetchCache.locs, windFetchCache.levels, true);
    }
  };
  // Release: persist the final sampling; if the route changed since the
  // fetch (different waypoints/speeds/altitudes) refetch instead — but only
  // when wind was already pulled once (no surprise network calls before the
  // first pull).
  windDepartSlider.onchange = () => {
    refreshWindDepartLabel();
    if (!state.legs.length) return;
    if (windFetchCache && windFetchCache.sig === windRouteSig()) {
      applyRouteWindSamples(windFetchCache.locs, windFetchCache.levels);
    } else if (state.windUpdated) {
      fetchRouteWind();
    }
  };
  refreshWindDepartLabel();
}

// --- Animated wind-field overlay (live Open-Meteo grid) -------------
// Windy-style animated wind particles, free: fetch a coarse winds-aloft grid
// over Israel from Open-Meteo (same live source as the per-leg fetch) and feed
// it to the leaflet-velocity layer. Prototype: a single fixed level (~3000 ft /
// 900 hPa); level/opacity controls can follow.
(function windFieldOverlay() {
  const cb = document.getElementById('windfield-cb');
  const statusEl = document.getElementById('windfield-status');
  const controls = document.getElementById('windfield-controls');
  const opacity = document.getElementById('windfield-opacity');
  const opacityVal = document.getElementById('windfield-opacity-val');
  const opacityReset = document.getElementById('windfield-opacity-reset');
  const timeSlider = document.getElementById('windfield-time');
  const timeVal = document.getElementById('windfield-time-val');
  const altSlider = document.getElementById('windfield-alt');
  const altVal = document.getElementById('windfield-alt-val');
  if (!cb) return;
  const KEY = 'navaid.windField';
  const OPACITY_KEY = 'navaid.windFieldOpacity';
  const ALT_KEY = 'navaid.windFieldAlt';
  const tn = (k, d) => (typeof tune === 'function' ? tune(k) : d);
  function defaultAltFt() { return tn('windFieldDefaultAltFt', 1500); }
  // Pressure level (hPa) for the chosen altitude — drives the fetch + parse.
  function altFt() { return altSlider ? (parseInt(altSlider.value, 10) || defaultAltFt()) : defaultAltFt(); }
  function level() {
    return (typeof nearestPressureLevelHpa === 'function') ? nearestPressureLevelHpa(altFt()) : 900;
  }
  // Grid over Israel (+margin), tunable. leaflet-velocity scans la1(N)→S, lo1(W)→E.
  function gridBounds() {
    return { west: tn('windFieldWest', 34.2), east: tn('windFieldEast', 35.95),
             north: tn('windFieldNorth', 33.45), south: tn('windFieldSouth', 29.45),
             d: tn('windFieldGridDeg', 0.25) };
  }
  let layer = null;
  let busy = false;
  let refetchPending = false;   // an altitude change arrived mid-fetch → refetch after
  let store = null;     // { g, times, sp[k][], di[k][], baseIdx } — all 48 fetched hours

  function gridPoints() {
    const b = gridBounds();
    const nx = Math.round((b.east - b.west) / b.d) + 1;
    const ny = Math.round((b.north - b.south) / b.d) + 1;
    const lats = [], lngs = [];
    for (let j = 0; j < ny; j++) {
      const lat = b.north - j * b.d;
      for (let i = 0; i < nx; i++) { lats.push(lat); lngs.push(b.west + i * b.d); }
    }
    return { nx, ny, lats, lngs };
  }

  function velocityData(g, U, V) {
    const b = gridBounds();
    const base = {
      parameterUnit: 'm.s-1', parameterCategory: 2,
      lo1: b.west, la1: b.north, lo2: b.east, la2: b.south,
      nx: g.nx, ny: g.ny, dx: b.d, dy: b.d,
      refTime: new Date().toISOString(), forecastTime: 0,
    };
    return [
      { header: Object.assign({ parameterNumber: 2, parameterNumberName: 'Eastward wind' }, base), data: U },
      { header: Object.assign({ parameterNumber: 3, parameterNumberName: 'Northward wind' }, base), data: V },
    ];
  }

  // Absolute hour index for the current slider offset (0 = now, +24 forward).
  function absIndex() {
    if (!store) return 0;
    const off = timeSlider ? (parseInt(timeSlider.value, 10) || 0) : 0;
    return Math.min(store.times.length - 1, store.baseIdx + off);
  }
  // Build the velocity grid (U/V) for the selected hour from the stored frames.
  function frameData() {
    const idx = absIndex(), g = store.g, n = g.lats.length;
    const U = new Array(n).fill(0), V = new Array(n).fill(0);
    // Rotate the wind vectors by the map bearing. leaflet-velocity draws
    // (u, -v) in screen space assuming north-up, so on a rotated map the flow
    // would otherwise point the wrong way. Positions are already bearing-aware
    // (the canvas lives in a non-rotating pane, plotted via
    // latLngToContainerPoint) — only the vectors need this pre-rotation.
    const th = (typeof map !== 'undefined' && map.getBearing) ? (map.getBearing() || 0) * Math.PI / 180 : 0;
    const cb = Math.cos(th), sb = Math.sin(th);
    for (let k = 0; k < n; k++) {
      const spd = store.sp[k] && store.sp[k][idx], dir = store.di[k] && store.di[k][idx];
      if (!Number.isFinite(spd) || !Number.isFinite(dir)) continue;
      const r = dir * Math.PI / 180;                  // met direction = FROM
      const u = -spd * Math.sin(r);                   // eastward component
      const v = -spd * Math.cos(r);                   // northward component
      U[k] = u * cb + v * sb;
      V[k] = v * cb - u * sb;
    }
    return velocityData(g, U, V);
  }
  function applyTimeLabel() {
    if (!timeVal || !store) return;
    const off = timeSlider ? (parseInt(timeSlider.value, 10) || 0) : 0;
    const t = store.times[absIndex()];                // 'YYYY-MM-DDThh:00' UTC
    const clock = t ? fmtViewClock(new Date(t + 'Z')) : '';
    timeVal.textContent = fmtViewTime(off, clock);
  }

  async function addLayer() {
    if (typeof L === 'undefined' || typeof L.velocityLayer !== 'function') {
      // Library missing → wind field unavailable: show the error, hide the
      // sliders (nothing to control), and clear the toggle.
      if (statusEl) { statusEl.classList.remove('windfield-loading'); statusEl.style.display = ''; statusEl.textContent = S.windFieldErr || 'Wind field unavailable'; }
      cb.checked = false;
      showControls(false);
      return;
    }
    busy = true;
    // Loading banner while the (slow) grid request is in flight.
    if (statusEl) { statusEl.style.display = ''; statusEl.classList.add('windfield-loading'); statusEl.textContent = S.windFieldLoading || 'Loading wind field…'; }
    try {
      const g = gridPoints();
      const lv = level();
      // Fetch a few forecast days of hourly samples so the slider can scrub
      // forward from the current hour (tunable horizon).
      const url = 'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + g.lats.map(v => v.toFixed(2)).join(',') +
        '&longitude=' + g.lngs.map(v => v.toFixed(2)).join(',') +
        '&hourly=wind_speed_' + lv + 'hPa,wind_direction_' + lv + 'hPa' +
        '&wind_speed_unit=ms&timezone=UTC&forecast_days=' + tn('windFieldForecastDays', 2);
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      const locs = Array.isArray(j) ? j : [j];
      const n = g.lats.length;
      const sp = new Array(n), di = new Array(n);
      let times = [];
      for (let k = 0; k < n; k++) {
        const h = locs[k] && locs[k].hourly;
        if (h && Array.isArray(h.time) && h.time.length > times.length) times = h.time;
        sp[k] = (h && h['wind_speed_' + lv + 'hPa']) || [];
        di[k] = (h && h['wind_direction_' + lv + 'hPa']) || [];
      }
      if (!times.length) throw new Error('no data');
      store = { g, times, sp, di, baseIdx: nearestHourIndex(times) };
      if (timeSlider) { timeSlider.value = '0'; }
      // The fetch is async — if the user turned the field off meanwhile, cache
      // the data but don't add an orphan layer.
      if (!cb.checked) { if (statusEl) { statusEl.classList.remove('windfield-loading'); statusEl.style.display = 'none'; } return; }
      if (statusEl) { statusEl.classList.remove('windfield-loading'); statusEl.style.display = 'none'; }
      applyTimeLabel();
      applyRotationState();   // builds the field north-up, or shows the rotated-map note
    } catch (e) {
      // Fetch failed → unavailable: show the error, hide the sliders, untoggle.
      if (statusEl) { statusEl.classList.remove('windfield-loading'); statusEl.style.display = ''; statusEl.textContent = S.windFieldErr || 'Wind field fetch failed'; }
      cb.checked = false;
      showControls(false);
    } finally {
      busy = false;
      // A refetch requested during the fetch (e.g. altitude change) runs now.
      // Always clear the flag (even if the field was turned off / the fetch
      // failed) so it can't leak true into a later enable and double-fetch.
      const pending = refetchPending; refetchPending = false;
      if (pending && cb.checked) addLayer();
    }
  }

  // Create (or recreate) the velocity layer from the current store + bearing.
  function buildLayer() {
    if (!store) return;
    if (layer) { map.removeLayer(layer); layer = null; }
    layer = L.velocityLayer({
      displayValues: false,
      // Non-rotating pane (see core.js): the field draws in screen
      // coordinates, so it must not sit in the rotate pane or it breaks when
      // the map is rotated.
      paneName: 'windfield',
      data: frameData(),
      // Colour particles by speed with a *saturated* ramp (no pale mids that
      // vanish on the light chart) so the motion reads over the busy base.
      minVelocity: tn('windFieldMinVelocity', 0), maxVelocity: tn('windFieldMaxVelocity', 24),
      colorScale: ['#00429d', '#1d6fd0', '#00b4d8', '#00d49b', '#7cd800',
                   '#ffd000', '#ff8800', '#ff2a00', '#c4000b'],
      velocityScale: tn('windFieldVelocityScale', 0.028),
      particleAge: tn('windFieldParticleAge', 80),
      particleMultiplier: tn('windFieldParticleMultiplier', 0.0032),
      lineWidth: tn('windFieldLineWidth', 1.8),
      frameRate: tn('windFieldFrameRate', 22),
    });
    layer.addTo(map);
    applyOpacity();
  }

  function removeLayer() {
    if (layer) { map.removeLayer(layer); layer = null; }
    refetchPending = false;
    if (statusEl) { statusEl.classList.remove('windfield-loading'); statusEl.style.display = 'none'; }
  }

  // leaflet-velocity bakes its particle field into a north-up screen grid at
  // build time, so on a rotated map (leaflet-rotate) it renders offset off the
  // viewport — the field can't be re-placed for a non-zero bearing. Rather than
  // show a broken field, only display it north-up: when the map is rotated
  // (bearing != 0) hide the field and show a note; it reappears automatically at
  // 0°. 'rotate' fires continuously during a dial drag → coalesce per frame.
  const isRotated = () => ((map.getBearing ? map.getBearing() : 0) || 0) !== 0;
  function applyRotationState() {
    if (!cb.checked || !store) return;
    if (isRotated()) {
      if (layer) removeLayer();
      if (statusEl) {
        statusEl.classList.remove('windfield-loading');
        statusEl.style.display = '';
        statusEl.textContent = (window.S && S.windFieldNorthUpOnly) || 'Wind field shows north-up only — rotate the map to 0°';
      }
    } else if (!layer) {
      buildLayer();
      applyTimeLabel();
      if (statusEl) { statusEl.textContent = ''; statusEl.style.display = 'none'; }
    }
  }
  let rotStatePending = false;
  function onWindViewChange() {
    if (busy || rotStatePending) return;   // mid-fetch: addLayer will settle state on completion
    rotStatePending = true;
    requestAnimationFrame(() => { rotStatePending = false; applyRotationState(); });
  }
  map.on('moveend', onWindViewChange);
  map.on('zoomend', onWindViewChange);
  map.on('rotate', onWindViewChange);
  map.on('rotateend', onWindViewChange);

  // leaflet-velocity draws into a canvas in the overlay pane; set its element
  // opacity so the field can be dialled down against the chart base.
  function velocityCanvas() {
    return (layer && layer._canvasLayer && layer._canvasLayer._canvas) || null;
  }
  function applyOpacity() {
    const c = velocityCanvas();
    if (c && opacity) c.style.opacity = String(opacity.value);
    if (opacity && opacityVal) opacityVal.textContent = Math.round(parseFloat(opacity.value) * 100) + '%';
  }
  function showControls(on) { if (controls) controls.hidden = !on; }

  if (opacity) {
    let saved = null;
    try { saved = localStorage.getItem(OPACITY_KEY); } catch (e) { /* */ }
    opacity.value = (saved !== null) ? saved : String(tn('windFieldDefaultOpacity', 0.7));
    opacity.oninput = () => {
      try { localStorage.setItem(OPACITY_KEY, opacity.value); } catch (e) { /* */ }
      applyOpacity();
    };
  }
  if (opacityReset) {
    opacityReset.onclick = () => {
      if (!opacity) return;
      opacity.value = String(tn('windFieldDefaultOpacity', 0.7));   // tunable default
      try { localStorage.setItem(OPACITY_KEY, opacity.value); } catch (e) { /* */ }
      applyOpacity();
    };
  }

  if (timeSlider) {
    timeSlider.max = String(tn('windFieldHoursAhead', 24));   // tunable scrub range
    timeSlider.oninput = () => {
      applyTimeLabel();
      if (layer && store && typeof layer.setData === 'function') layer.setData(frameData());
    };
  }

  function applyAltLabel() { if (altVal) altVal.textContent = altFt().toLocaleString() + ' ft'; }
  if (altSlider) {
    let saved = null;
    try { saved = localStorage.getItem(ALT_KEY); } catch (e) { /* */ }
    altSlider.value = (saved !== null) ? saved : String(defaultAltFt());   // tunable default
    applyAltLabel();
    altSlider.oninput = applyAltLabel;
    // Changing altitude means a different pressure level → refetch (on release,
    // not every tick) when the field is on.
    altSlider.onchange = () => {
      try { localStorage.setItem(ALT_KEY, altSlider.value); } catch (e) { /* */ }
      applyAltLabel();
      if (!cb.checked) return;
      if (busy) { refetchPending = true; return; }   // apply the new altitude after the in-flight fetch
      addLayer();
    };
  }

  try { if (localStorage.getItem(KEY) === '1') cb.checked = true; } catch (e) { /* */ }
  showControls(cb.checked);
  cb.onchange = () => {
    try { localStorage.setItem(KEY, cb.checked ? '1' : '0'); } catch (e) { /* */ }
    showControls(cb.checked);
    // Auto-fetch on enable; addLayer() shows a "Loading wind…" banner while the
    // (slow) grid request is in flight.
    if (cb.checked) { if (!busy) addLayer(); } else removeLayer();
  };
  if (cb.checked && !busy) addLayer();
  NavAid.refreshWindField = () => { if (cb.checked && !busy) addLayer(); };
})();

// --- Unified look-ahead time slider (drives NOTAM + wind-depart + windfield) ---
(function () {
  const master = document.getElementById('lookahead-time');
  const masterVal = document.getElementById('lookahead-time-val');
  const targets = ['notam-time', 'wind-depart', 'windfield-time'].map(id => document.getElementById(id));
  function sync() {
    const h = master ? (parseInt(master.value, 10) || 0) : 0;
    if (masterVal) masterVal.textContent = notamTimeLabel(h);
    for (const t of targets) {
      if (!t) continue;
      t.value = String(Math.min(h, parseInt(t.max, 10) || 24));
      t.dispatchEvent(new Event('input'));
    }
  }
  if (master) {
    master.oninput = sync;
    sync();
  }
})();

// --- SIGMET chart button (modal list, no map overlay) ---------------
const sigmetBtn = document.getElementById('sigmet-btn');
function refreshSigmetBtn() {
  if (sigmetBtn) sigmetBtn.hidden = !(Array.isArray(sigmets) && sigmets.length > 0);
}
if (sigmetBtn) {
  sigmetBtn.onclick = async () => {
    if (typeof loadSigmets === 'function') await loadSigmets();
    refreshSigmetBtn();
    if (typeof showSigmetDecoded === 'function') showSigmetDecoded();
  };
}
// Eager load on boot so the button appears if SIGMETs are active.
if (typeof loadSigmets === 'function') {
  loadSigmets().then(refreshSigmetBtn);
}

// --- NOTAM overlay + list (FAA NOTAM API, Israel FIR LLLL) ----------
const NOTAM_KEY = 'navaid.showNotam';
try { const s = localStorage.getItem(NOTAM_KEY); if (s !== null) window.showNotam = s === '1'; } catch (e) { /* */ }
const notamCb = document.getElementById('notam-cb');
const notamListBtn = document.getElementById('notam-list-btn');
const notamControls = document.getElementById('notam-controls');
const notamTimeEl = document.getElementById('notam-time');
const notamTimeVal = document.getElementById('notam-time-val');
const notamUpdatedEl = document.getElementById('notam-updated');
function refreshNotamListBtn() {
  const have = Array.isArray(notams) && notams.length;
  if (notamListBtn) notamListBtn.hidden = !have;
  // Gray out the NOTAM toggle when the feed has no data (source currently
  // unavailable). Data-driven: every call re-evaluates, so when a non-empty
  // feed is present the toggle is enabled again. (The feed is loaded once per
  // session, so an empty-at-boot feed clears on the next reload — the saved
  // preference is preserved below either way.) Only act once a load has
  // completed (notams !== null); a pending load leaves the toggle as-is.
  if (notamCb && notams !== null) {
    const lbl = notamCb.closest('label');
    notamCb.disabled = !have;
    // Re-check from the saved preference when the feed is present again.
    if (have && !notamCb.checked) {
      let pref = false; try { pref = localStorage.getItem(NOTAM_KEY) === '1'; } catch (e) { /* */ }
      if (pref) { notamCb.checked = true; window.showNotam = true; }
    }
    if (lbl) {
      lbl.classList.toggle('navtoggle-disabled', !have);
      lbl.title = have ? (S.tbShowNotamTitle || '') : (S.notamUnavailable || 'NOTAM data is currently unavailable.');
    }
    if (!have && notamCb.checked) {        // nothing to show → turn off in-memory
      notamCb.checked = false;
      window.showNotam = false;
      // Don't persist '0' here — a transient empty feed must not wipe the user's
      // saved 'on' preference; it re-enables when NOTAMs return.
    }
  }
  // The timeline slider only makes sense with the overlay on and data present.
  if (notamControls) notamControls.hidden = !(window.showNotam && have);
  // Feed freshness, shown in the panel (not just the list modal).
  if (notamUpdatedEl) {
    let txt = '';
    if (notamMeta && notamMeta.generatedAt) {
      const t = new Date(notamMeta.generatedAt);
      if (!isNaN(t) && S.notamUpdated) txt = S.notamUpdated(t.toISOString().slice(0, 16).replace('T', ' ') + 'Z');
    }
    notamUpdatedEl.textContent = txt;
  }
}
// Shared time-slider clock: "HH:MMZ", prefixed with "MM-DD " when the instant
// falls on a different UTC date than today. Used by every look-ahead slider so
// they read identically.
function fmtViewClock(d) {
  if (!d || isNaN(d)) return '';
  const iso = d.toISOString();
  const hm = iso.slice(11, 16) + 'Z';
  return iso.slice(0, 10) === new Date().toISOString().slice(0, 10)
    ? hm
    : iso.slice(5, 10) + ' ' + hm;
}
// Unified look-ahead readout: base (0) shows the clock; an offset shows
// "+Nh · <clock>".
function fmtViewTime(h, clock) {
  if (!h) return clock;
  return S.notamTimeAt ? S.notamTimeAt(h, clock) : ('+' + h + 'h · ' + clock);
}
// Slider readout: 0 = clock of the current hour, otherwise "+Nh · HH:00Z".
// Rounded to the top of the hour so every look-ahead slider reads round
// clock times like the wind-field slider (whose clock is the hourly forecast
// timestamp) — these sliders step in whole hours over hourly data.
function topOfHour(ms) {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}
function notamTimeLabel(h) {
  return fmtViewTime(h, fmtViewClock(new Date(topOfHour(Date.now()) + h * 3600e3)));
}
function syncNotamTime() {
  const h = notamTimeEl ? (parseInt(notamTimeEl.value, 10) || 0) : 0;
  window.notamViewTime = h ? (Date.now() + h * 3600e3) : null;
  if (notamTimeVal) notamTimeVal.textContent = notamTimeLabel(h);
}
if (notamTimeEl) {
  notamTimeEl.oninput = () => { syncNotamTime(); refreshNotamListBtn(); draw(); };
  syncNotamTime();
}
async function ensureNotams() {
  if (typeof loadNotam === 'function' && notams === null) await loadNotam();
  // Airport NOTAM markers need the airfield coords even if that layer is off.
  if (typeof loadAirfields === 'function' && typeof airfields !== 'undefined' && airfields === null) {
    try { await loadAirfields(); } catch (e) { /* */ }
  }
  // Prose "border buffer" NOTAMs (no coords) → polygons traced from the
  // national border. Build before route lines so geom is set first.
  if (typeof loadNotamBorders === 'function' && typeof notamBorders !== 'undefined' && notamBorders === null) {
    try { await loadNotamBorders(); } catch (e) { /* */ }
  }
  if (typeof buildNotamBorderAreas === 'function') buildNotamBorderAreas();
  // Route-closure NOTAMs name fixes instead of coords; resolving them to lines
  // needs the nav-waypoint / VOR databases. Load, then build the route lines.
  if (typeof loadNavWaypoints === 'function' && typeof navWP !== 'undefined' && navWP === null) {
    try { await loadNavWaypoints(); } catch (e) { /* */ }
  }
  if (typeof loadVors === 'function' && typeof vors !== 'undefined' && vors === null) {
    try { await loadVors(); } catch (e) { /* */ }
  }
  if (typeof buildNotamRouteLines === 'function') buildNotamRouteLines();
  refreshNotamListBtn();
}
function showNotamModal(only) {
  // Behave like every other chart modal: opening closes any other open chart
  // modal (and a prior NOTAM list, since it's tagged below) + the toolbar
  // dropdowns. One chart on screen at a time.
  if (typeof closeOpenChartModals === 'function') closeOpenChartModals();
  if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.dataset.chartModal = 'notam-list';
  const box = document.createElement('div');
  box.className = 'modal wide notam-modal';
  const close = document.createElement('button');
  close.className = 'modal-close-x'; close.type = 'button'; close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  box.appendChild(close);
  // `only` = subset clicked on the map. Empty/absent → full active list.
  const shown = (Array.isArray(only) && only.length)
    ? only
    : ((typeof activeNotams === 'function') ? activeNotams() : (Array.isArray(notams) ? notams : []));
  const h = document.createElement('h3');
  // Title scope: when the shown set is one airfield, name it; otherwise LLLL
  // (FIR-wide / mixed). Updates when the filter narrows the list.
  const updateTitle = (subset) => {
    const ic = Array.from(new Set(subset.map(n => String(n.icao || '').toUpperCase()).filter(Boolean)));
    const scope = ic.length === 1 ? ic[0] : 'LLLL';
    h.textContent = (S.notamModalTitle || 'Active NOTAMs') + ' (' + scope + ') — ' + subset.length;
  };
  updateTitle(shown);
  box.appendChild(h);
  // Raw toggle: NOTAM texts show decoded (Q-code + expanded abbreviations) by
  // default; this flips every item to the original source text and back.
  let rawMode = false;
  const rawBtn = document.createElement('button');
  rawBtn.type = 'button'; rawBtn.className = 'notam-raw-toggle';
  rawBtn.textContent = S.notamRaw || 'Raw';
  box.appendChild(rawBtn);
  if (notamMeta && notamMeta.generatedAt) {
    const u = document.createElement('div');
    u.className = 'notam-updated';
    const t = new Date(notamMeta.generatedAt);
    if (!isNaN(t)) u.textContent = (S.notamUpdated ? S.notamUpdated(t.toISOString().slice(0, 16).replace('T', ' ') + 'Z') : '');
    box.appendChild(u);
  }
  // Airfield/global filter. Every NOTAM carries an ICAO: LLLL = FIR-wide
  // (global); anything else is aerodrome-specific. Build a dropdown of the
  // codes present so the list can be narrowed to one airfield (or globals).
  let filterIcao = '';
  const codes = Array.from(new Set(
    shown.map(n => String(n.icao || '').toUpperCase()).filter(Boolean)));
  const list = document.createElement('div');
  list.className = 'notam-list';
  const renderList = () => {
    list.textContent = '';
    const subset = filterIcao
      ? shown.filter(n => String(n.icao || '').toUpperCase() === filterIcao)
      : shown;
    updateTitle(subset);
    if (!subset.length) {
      const e = document.createElement('div');
      e.className = 'notam-empty';
      e.textContent = S.notamNone || 'No active NOTAMs.';
      list.appendChild(e);
      return;
    }
    for (const n of subset) {
      const it = document.createElement('div');
      it.className = 'notam-item';
      const id = document.createElement('div');
      id.className = 'notam-id'; id.dir = 'ltr';
      id.textContent = n.id + (n.end ? '  ·  ' + n.end : '');
      const tx = document.createElement('pre');
      tx.className = 'notam-text'; tx.dir = 'ltr';
      tx._raw = n.text || '';
      tx._decoded = (typeof decodeNotam === 'function') ? decodeNotam(n) : tx._raw;
      tx.textContent = rawMode ? tx._raw : tx._decoded;
      it.appendChild(id); it.appendChild(tx);
      // Clicking a NOTAM that has a map presence closes the modal, turns the
      // overlay on if needed, and blinks it on the map.
      if (typeof notamMappable === 'function' && notamMappable(n)) {
        it.classList.add('notam-item-clickable');
        it.title = S.notamShowOnMap || 'Show on map';
        it.onclick = () => {
          if (!window.showNotam) {
            window.showNotam = true;
            try { localStorage.setItem(NOTAM_KEY, '1'); } catch (err) { /* */ }
            if (notamCb) notamCb.checked = true;
          }
          dismiss();
          if (typeof flashNotam === 'function') flashNotam(n.id);
        };
      }
      list.appendChild(it);
    }
  };
  if (codes.length > 1) {
    const fw = document.createElement('div');
    fw.className = 'notam-filter';
    const sel = document.createElement('select');
    sel.className = 'notam-filter-sel'; sel.dir = 'ltr';
    sel.setAttribute('aria-label', S.notamFilterLabel || 'Filter NOTAMs by airfield');
    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = (S.notamFilterAll || 'All') + ' (' + shown.length + ')';
    sel.appendChild(optAll);
    // Global (LLLL) first, then aerodromes alphabetically.
    const ordered = codes.slice().sort((a, b) =>
      (a === 'LLLL' ? -1 : b === 'LLLL' ? 1 : a.localeCompare(b)));
    for (const c of ordered) {
      const cnt = shown.filter(n => String(n.icao || '').toUpperCase() === c).length;
      const o = document.createElement('option');
      o.value = c;
      o.textContent = (c === 'LLLL' ? (S.notamFilterGlobal || 'Global (FIR)') : c)
        + ' (' + cnt + ')';
      sel.appendChild(o);
    }
    sel.onchange = () => { filterIcao = sel.value; renderList(); };
    fw.appendChild(sel);
    box.appendChild(fw);
  }
  rawBtn.onclick = () => {
    rawMode = !rawMode;
    rawBtn.textContent = rawMode ? (S.notamDecoded || 'Decoded') : (S.notamRaw || 'Raw');
    list.querySelectorAll('.notam-text').forEach(tx => {
      tx.textContent = rawMode ? tx._raw : tx._decoded;
    });
  };
  renderList();
  box.appendChild(list);
  back.appendChild(box);
  document.body.appendChild(back);
  // Lock the modal's height (capped to the viewport) so filtering doesn't
  // resize it AND the list scrolls inside instead of overflowing the screen —
  // a long single-airfield list (e.g. LLBG) stays fully scrollable.
  const hCap = Math.round(window.innerHeight * 0.84);
  box.style.height = Math.min(box.offsetHeight, hCap) + 'px';
  const dismiss = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  // Let closeOpenChartModals() (other charts opening) close this one too.
  back._navaidClose = dismiss;
  function onKey(ev) { if (ev.key === 'Escape') dismiss(); }
  close.onclick = dismiss;
  back.addEventListener('click', e => { if (e.target === back) dismiss(); });
  document.addEventListener('keydown', onKey);
}
if (notamCb) {
  notamCb.checked = !!window.showNotam;
  notamCb.onchange = async e => {
    window.showNotam = e.target.checked;
    try { localStorage.setItem(NOTAM_KEY, window.showNotam ? '1' : '0'); } catch (err) { /* */ }
    if (window.showNotam) await ensureNotams();
    refreshNotamListBtn();   // toggle the timeline slider's visibility too
    draw();
  };
  // Load on boot so the list button can reveal (and the overlay restore) even
  // if the toggle is off — the JSON is small. refreshNotamListBtn() then grays
  // the toggle if the feed came back empty (source unavailable).
  ensureNotams().then(() => { refreshNotamListBtn(); if (window.showNotam) draw(); });
}
if (notamListBtn) notamListBtn.onclick = () => { ensureNotams().then(showNotamModal); };

// ── Circuit overlay ──────────────────────────────────────────────────────────
const CIRCUIT_SHOW_KEY    = 'navaid.showCircuit';
const CIRCUIT_OPACITY_KEY = 'navaid.circuitOpacity';
const CIRCUIT_DEFAULT_OPACITY = 0.6;

window.showCircuit = localStorage.getItem(CIRCUIT_SHOW_KEY) === '1';
window.circuitLayerGroup = null;
let circuitOpacity = (() => {
  const v = parseFloat(localStorage.getItem(CIRCUIT_OPACITY_KEY));
  return isNaN(v) ? CIRCUIT_DEFAULT_OPACITY : v;
})();

// Unlike byop plates (a single copy at the deployed root — see plateBase()),
// circuit-img PNGs are committed to the repo and ship WITH every preview
// (root, staging, /pr/N/, /branch/NAME/). So resolve them relative to the
// document base like the app's own scripts, WITHOUT stripping any preview
// suffix — stripping to root 404s on previews that carry their own images.
function circuitImgBase() {
  return new URL('circuit-img/', document.baseURI).href;
}

function loadCircuitOverlays() {
  if (circuitLayerGroup) return;
  if (!airfields) return;
  circuitLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const co = af.circuit_overlay;
    if (!co) continue;
    L.imageOverlay(
      circuitImgBase() + encodeURIComponent(co.png) + '?v=3',
      [co.sw, co.ne],
      { opacity: plateOpacity, interactive: false, pane: 'overlayPane' }
    ).addTo(circuitLayerGroup);
  }
}

function applyCircuitOpacity(v) {
  circuitOpacity = v;
  const valEl = document.getElementById('circuit-opacity-val');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  if (circuitLayerGroup) circuitLayerGroup.eachLayer(l => l.setOpacity(v));
}

// ── Training-area overlay ─────────────────────────────────────────────────────
const TRAINING_SHOW_KEY    = 'navaid.showTraining';
const TRAINING_OPACITY_KEY = 'navaid.trainingOpacity';
const TRAINING_DEFAULT_OPACITY = 0.6;

window.showTraining = localStorage.getItem(TRAINING_SHOW_KEY) === '1';
window.trainingLayerGroup = null;
let trainingOpacity = (() => {
  const v = parseFloat(localStorage.getItem(TRAINING_OPACITY_KEY));
  return isNaN(v) ? TRAINING_DEFAULT_OPACITY : v;
})();

// Same resolution rule as circuitImgBase(): training-img PNGs ship with every
// preview, so resolve them relative to the document base without stripping.
function trainingImgBase() {
  return new URL('training-img/', document.baseURI).href;
}

function loadTrainingOverlays() {
  if (trainingLayerGroup) return;
  if (!airfields) return;
  trainingLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const to = af.training_overlay;
    if (!to) continue;
    L.imageOverlay(
      trainingImgBase() + encodeURIComponent(to.png) + '?v=1',
      [to.sw, to.ne],
      { opacity: plateOpacity, interactive: false, pane: 'overlayPane' }
    ).addTo(trainingLayerGroup);
  }
}

function applyTrainingOpacity(v) {
  trainingOpacity = v;
  const valEl = document.getElementById('training-opacity-val');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  if (trainingLayerGroup) trainingLayerGroup.eachLayer(l => l.setOpacity(v));
}

// ── CVFR routes / comm-failure overlay ────────────────────────────────────────
const CVFR_SHOW_KEY    = 'navaid.showCvfr';
const CVFR_OPACITY_KEY = 'navaid.cvfrOpacity';
const CVFR_DEFAULT_OPACITY = 0.6;

window.showCvfr = localStorage.getItem(CVFR_SHOW_KEY) === '1';
window.cvfrLayerGroup = null;
let cvfrOpacity = (() => {
  const v = parseFloat(localStorage.getItem(CVFR_OPACITY_KEY));
  return isNaN(v) ? CVFR_DEFAULT_OPACITY : v;
})();

// Same resolution rule as trainingImgBase(): cvfr-img PNGs ship with every
// preview, so resolve them relative to the document base without stripping.
function cvfrImgBase() {
  return new URL('cvfr-img/', document.baseURI).href;
}

function loadCvfrOverlays() {
  if (cvfrLayerGroup) return;
  if (!airfields) return;
  cvfrLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const co = af.cvfr_overlay;
    if (!co) continue;
    L.imageOverlay(
      cvfrImgBase() + encodeURIComponent(co.png) + '?v=2',
      [co.sw, co.ne],
      { opacity: plateOpacity, interactive: false, pane: 'overlayPane' }
    ).addTo(cvfrLayerGroup);
  }
}

function applyCvfrOpacity(v) {
  cvfrOpacity = v;
  const valEl = document.getElementById('cvfr-opacity-val');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  if (cvfrLayerGroup) cvfrLayerGroup.eachLayer(l => l.setOpacity(v));
}

// ── Helicopter routes overlay ─────────────────────────────────────────────────
const HELI_SHOW_KEY    = 'navaid.showHeli';
const HELI_OPACITY_KEY = 'navaid.heliOpacity';
const HELI_DEFAULT_OPACITY = 0.6;

window.showHeli = localStorage.getItem(HELI_SHOW_KEY) === '1';
window.heliLayerGroup = null;
let heliOpacity = (() => {
  const v = parseFloat(localStorage.getItem(HELI_OPACITY_KEY));
  return isNaN(v) ? HELI_DEFAULT_OPACITY : v;
})();

// Same resolution rule as cvfrImgBase(): heli-img PNGs ship with every
// preview, so resolve them relative to the document base without stripping.
function heliImgBase() {
  return new URL('heli-img/', document.baseURI).href;
}

function loadHeliOverlays() {
  if (heliLayerGroup) return;
  if (!airfields) return;
  heliLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const ho = af.heli_overlay;
    if (!ho) continue;
    L.imageOverlay(
      heliImgBase() + encodeURIComponent(ho.png) + '?v=1',
      [ho.sw, ho.ne],
      { opacity: plateOpacity, interactive: false, pane: 'overlayPane' }
    ).addTo(heliLayerGroup);
  }
}

function applyHeliOpacity(v) {
  heliOpacity = v;
  const valEl = document.getElementById('heli-opacity-val');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  if (heliLayerGroup) heliLayerGroup.eachLayer(l => l.setOpacity(v));
}

// ── Comm-failure entry overlay ────────────────────────────────────────────────
const COMMFAIL_SHOW_KEY    = 'navaid.showCommfail';
const COMMFAIL_OPACITY_KEY = 'navaid.commfailOpacity';
const COMMFAIL_DEFAULT_OPACITY = 0.6;

window.showCommfail = localStorage.getItem(COMMFAIL_SHOW_KEY) === '1';
window.commfailLayerGroup = null;
let commfailOpacity = (() => {
  const v = parseFloat(localStorage.getItem(COMMFAIL_OPACITY_KEY));
  return isNaN(v) ? COMMFAIL_DEFAULT_OPACITY : v;
})();

// Same resolution rule as cvfrImgBase(): commfail-img PNGs ship with every
// preview, so resolve them relative to the document base without stripping.
function commfailImgBase() {
  return new URL('commfail-img/', document.baseURI).href;
}

function loadCommfailOverlays() {
  if (commfailLayerGroup) return;
  if (!airfields) return;
  commfailLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const co = af.commfail_overlay;
    if (!co) continue;
    L.imageOverlay(
      commfailImgBase() + encodeURIComponent(co.png) + '?v=1',
      [co.sw, co.ne],
      { opacity: plateOpacity, interactive: false, pane: 'overlayPane' }
    ).addTo(commfailLayerGroup);
  }
}

function applyCommfailOpacity(v) {
  commfailOpacity = v;
  const valEl = document.getElementById('commfail-opacity-val');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  if (commfailLayerGroup) commfailLayerGroup.eachLayer(l => l.setOpacity(v));
}

// ── Shared airfield-plate opacity ─────────────────────────────────────────────
// The five plate overlays (circuit, training, CVFR, helicopter, comm-failure)
// are mutually exclusive, so one slider at the top of the "Airfield plates"
// frame drives whichever plate is showing. All plate imageOverlays are created
// with `plateOpacity`, and this applies live to every plate layer group.
const PLATE_OPACITY_KEY = 'navaid.plateOpacity';
const PLATE_DEFAULT_OPACITY = 0.6;
let plateOpacity = (() => {
  const v = parseFloat(localStorage.getItem(PLATE_OPACITY_KEY));
  return isNaN(v) ? PLATE_DEFAULT_OPACITY : v;
})();
function applyPlateOpacity(v) {
  plateOpacity = v;
  const valEl = document.getElementById('plate-opacity-val');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  [circuitLayerGroup, trainingLayerGroup, cvfrLayerGroup, heliLayerGroup, commfailLayerGroup]
    .forEach(g => { if (g) g.eachLayer(l => l.setOpacity(v)); });
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
// --- LSA airspace bubbles overlay toggle (Extra layers) ------------------
const LSA_BUBBLES_KEY = 'navaid.showLsaBubbles';
try {
  const stored = localStorage.getItem(LSA_BUBBLES_KEY);
  if (stored !== null) window.showLsaBubbles = stored === '1';
} catch (e) { /* storage unavailable */ }
const lsaCb = document.getElementById('lsa-cb');
if (lsaCb) {
  lsaCb.checked = showLsaBubbles;
  lsaCb.onchange = e => {
    window.showLsaBubbles = e.target.checked;
    try { localStorage.setItem(LSA_BUBBLES_KEY, showLsaBubbles ? '1' : '0'); }
    catch (err) { /* storage unavailable */ }
    if (typeof refreshLsaListBtn === 'function') refreshLsaListBtn();  // list button follows the toggle
    draw();   // drawAreas() lazy-loads the areas file if needed
  };
}
// LSA "bubble chart": a list of named bubbles (shown only on the Low Alt layer
// once areas load). Clicking a row zooms to it and highlights it.
function refreshLsaListBtn() {
  const onLsa = typeof layerDataPrefix === 'function' && layerDataPrefix() === 'lsa';
  // The whole LSA control group belongs to the Low Alt layer only — bubbles
  // exist nowhere else, so hide the toggle + list button on other layers.
  const grp = document.getElementById('lsa-group');
  if (grp) grp.hidden = !onLsa;
  // The list button follows the overlay toggle too: with bubbles hidden, the
  // list's "locate" would zoom to an unpainted bubble (drawAreas early-returns),
  // so the button is only shown when the overlay is actually on.
  const btn = document.getElementById('lsa-list-btn');
  if (btn) btn.hidden = !(onLsa && showLsaBubbles && Array.isArray(areas) && areas.length > 0);
}
function showLsaChart() {
  if (typeof closeOpenChartModals === 'function') closeOpenChartModals();
  const list = Array.isArray(areas) ? areas : [];
  // Reuse the shared modal builder so the LSA list behaves like every other
  // chart: Escape-to-close, drag, click-outside, and closeOpenChartModals().
  const title = (S.lsaModalTitle || 'LSA bubbles') + ' — ' + list.length;
  const { box, close, show } = createDraggableModal(title, 'modal wide lsa-modal', null, { chartKind: 'lsa-list' });
  const ul = document.createElement('div');
  ul.className = 'lsa-list';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'lsa-empty'; empty.textContent = S.lsaEmpty || 'No LSA areas on this layer.';
    ul.appendChild(empty);
  }
  list.forEach((a, i) => {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'lsa-row';
    if (a.active === 'weekend') row.classList.add('lsa-row-weekend');
    const base = (typeof areaLabel === 'function' && areaLabel(a)) ||
      ((S.lsaUnnamed || 'Unnamed area') + ' #' + (i + 1));
    row.textContent = a.active === 'weekend' ? (base + ' · ' + (S.lsaWeekend || 'weekend')) : base;
    row.onclick = () => {
      try {
        const b = L.latLngBounds(a.coords.map(c => L.latLng(c[0], c[1])));
        map.fitBounds(b, { padding: [40, 40], maxZoom: 12 });
      } catch (err) { /* */ }
      window.__lsaHighlight = a; draw();
      setTimeout(() => { if (window.__lsaHighlight === a) { window.__lsaHighlight = null; draw(); } }, 2000);
      close();
    };
    ul.appendChild(row);
  });
  box.appendChild(ul);
  show();
}
const lsaListBtn = document.getElementById('lsa-list-btn');
if (lsaListBtn) lsaListBtn.onclick = showLsaChart;
refreshLsaListBtn();
// Circuit overlay toggle
(function () {
  const cb       = document.getElementById('circuit-cb');
  const controls = document.getElementById('circuit-controls');
  const opEl     = document.getElementById('circuit-opacity');
  const opReset  = document.getElementById('circuit-opacity-reset');

  if (cb) {
    cb.checked = showCircuit;
    if (controls) controls.hidden = !showCircuit;

    cb.onchange = async function (e) {
      window.showCircuit = e.target.checked;
      try { localStorage.setItem(CIRCUIT_SHOW_KEY, showCircuit ? '1' : '0'); } catch (_) {}
      if (controls) controls.hidden = !showCircuit;
      if (showCircuit) {
        if (!airfields) await loadAirfields();
        loadCircuitOverlays();
        if (circuitLayerGroup) circuitLayerGroup.addTo(map);
      } else {
        if (circuitLayerGroup) circuitLayerGroup.remove();
      }
    };
  }

  if (opEl) {
    opEl.value = String(circuitOpacity);
    applyCircuitOpacity(circuitOpacity);    // sets val label on load
    opEl.oninput = function () {
      const v = parseFloat(opEl.value);
      try { localStorage.setItem(CIRCUIT_OPACITY_KEY, String(v)); } catch (_) {}
      applyCircuitOpacity(v);
    };
  }

  if (opReset) {
    opReset.onclick = function () {
      if (!opEl) return;
      opEl.value = String(CIRCUIT_DEFAULT_OPACITY);
      try { localStorage.setItem(CIRCUIT_OPACITY_KEY, String(CIRCUIT_DEFAULT_OPACITY)); } catch (_) {}
      applyCircuitOpacity(CIRCUIT_DEFAULT_OPACITY);
    };
  }
})();
// Training-area overlay toggle
(function () {
  const cb       = document.getElementById('training-cb');
  const controls = document.getElementById('training-controls');
  const opEl     = document.getElementById('training-opacity');
  const opReset  = document.getElementById('training-opacity-reset');

  if (cb) {
    cb.checked = showTraining;
    if (controls) controls.hidden = !showTraining;

    cb.onchange = async function (e) {
      window.showTraining = e.target.checked;
      try { localStorage.setItem(TRAINING_SHOW_KEY, showTraining ? '1' : '0'); } catch (_) {}
      if (controls) controls.hidden = !showTraining;
      if (showTraining) {
        if (!airfields) await loadAirfields();
        loadTrainingOverlays();
        if (trainingLayerGroup) trainingLayerGroup.addTo(map);
      } else {
        if (trainingLayerGroup) trainingLayerGroup.remove();
      }
    };
  }

  if (opEl) {
    opEl.value = String(trainingOpacity);
    applyTrainingOpacity(trainingOpacity);    // sets val label on load
    opEl.oninput = function () {
      const v = parseFloat(opEl.value);
      try { localStorage.setItem(TRAINING_OPACITY_KEY, String(v)); } catch (_) {}
      applyTrainingOpacity(v);
    };
  }

  if (opReset) {
    opReset.onclick = function () {
      if (!opEl) return;
      opEl.value = String(TRAINING_DEFAULT_OPACITY);
      try { localStorage.setItem(TRAINING_OPACITY_KEY, String(TRAINING_DEFAULT_OPACITY)); } catch (_) {}
      applyTrainingOpacity(TRAINING_DEFAULT_OPACITY);
    };
  }
})();
// CVFR routes / comm-failure overlay toggle
(function () {
  const cb       = document.getElementById('cvfr-cb');
  const controls = document.getElementById('cvfr-controls');
  const opEl     = document.getElementById('cvfr-opacity');
  const opReset  = document.getElementById('cvfr-opacity-reset');

  if (cb) {
    cb.checked = showCvfr;
    if (controls) controls.hidden = !showCvfr;

    cb.onchange = async function (e) {
      window.showCvfr = e.target.checked;
      try { localStorage.setItem(CVFR_SHOW_KEY, showCvfr ? '1' : '0'); } catch (_) {}
      if (controls) controls.hidden = !showCvfr;
      if (showCvfr) {
        if (!airfields) await loadAirfields();
        loadCvfrOverlays();
        if (cvfrLayerGroup) cvfrLayerGroup.addTo(map);
      } else {
        if (cvfrLayerGroup) cvfrLayerGroup.remove();
      }
    };
  }

  if (opEl) {
    opEl.value = String(cvfrOpacity);
    applyCvfrOpacity(cvfrOpacity);    // sets val label on load
    opEl.oninput = function () {
      const v = parseFloat(opEl.value);
      try { localStorage.setItem(CVFR_OPACITY_KEY, String(v)); } catch (_) {}
      applyCvfrOpacity(v);
    };
  }

  if (opReset) {
    opReset.onclick = function () {
      if (!opEl) return;
      opEl.value = String(CVFR_DEFAULT_OPACITY);
      try { localStorage.setItem(CVFR_OPACITY_KEY, String(CVFR_DEFAULT_OPACITY)); } catch (_) {}
      applyCvfrOpacity(CVFR_DEFAULT_OPACITY);
    };
  }
})();
// Helicopter routes overlay toggle
(function () {
  const cb       = document.getElementById('heli-cb');
  const controls = document.getElementById('heli-controls');
  const opEl     = document.getElementById('heli-opacity');
  const opReset  = document.getElementById('heli-opacity-reset');

  if (cb) {
    cb.checked = showHeli;
    if (controls) controls.hidden = !showHeli;

    cb.onchange = async function (e) {
      window.showHeli = e.target.checked;
      try { localStorage.setItem(HELI_SHOW_KEY, showHeli ? '1' : '0'); } catch (_) {}
      if (controls) controls.hidden = !showHeli;
      if (showHeli) {
        if (!airfields) await loadAirfields();
        loadHeliOverlays();
        if (heliLayerGroup) heliLayerGroup.addTo(map);
      } else {
        if (heliLayerGroup) heliLayerGroup.remove();
      }
    };
  }

  if (opEl) {
    opEl.value = String(heliOpacity);
    applyHeliOpacity(heliOpacity);    // sets val label on load
    opEl.oninput = function () {
      const v = parseFloat(opEl.value);
      try { localStorage.setItem(HELI_OPACITY_KEY, String(v)); } catch (_) {}
      applyHeliOpacity(v);
    };
  }

  if (opReset) {
    opReset.onclick = function () {
      if (!opEl) return;
      opEl.value = String(HELI_DEFAULT_OPACITY);
      try { localStorage.setItem(HELI_OPACITY_KEY, String(HELI_DEFAULT_OPACITY)); } catch (_) {}
      applyHeliOpacity(HELI_DEFAULT_OPACITY);
    };
  }
})();
// Comm-failure entry overlay toggle
(function () {
  const cb       = document.getElementById('commfail-cb');
  const controls = document.getElementById('commfail-controls');
  const opEl     = document.getElementById('commfail-opacity');
  const opReset  = document.getElementById('commfail-opacity-reset');

  if (cb) {
    cb.checked = showCommfail;
    if (controls) controls.hidden = !showCommfail;

    cb.onchange = async function (e) {
      window.showCommfail = e.target.checked;
      try { localStorage.setItem(COMMFAIL_SHOW_KEY, showCommfail ? '1' : '0'); } catch (_) {}
      if (controls) controls.hidden = !showCommfail;
      if (showCommfail) {
        if (!airfields) await loadAirfields();
        loadCommfailOverlays();
        if (commfailLayerGroup) commfailLayerGroup.addTo(map);
      } else {
        if (commfailLayerGroup) commfailLayerGroup.remove();
      }
    };
  }

  if (opEl) {
    opEl.value = String(commfailOpacity);
    applyCommfailOpacity(commfailOpacity);    // sets val label on load
    opEl.oninput = function () {
      const v = parseFloat(opEl.value);
      try { localStorage.setItem(COMMFAIL_OPACITY_KEY, String(v)); } catch (_) {}
      applyCommfailOpacity(v);
    };
  }

  if (opReset) {
    opReset.onclick = function () {
      if (!opEl) return;
      opEl.value = String(COMMFAIL_DEFAULT_OPACITY);
      try { localStorage.setItem(COMMFAIL_OPACITY_KEY, String(COMMFAIL_DEFAULT_OPACITY)); } catch (_) {}
      applyCommfailOpacity(COMMFAIL_DEFAULT_OPACITY);
    };
  }
})();
// Airfield-plate overlays are mutually exclusive — only one plate layer shows at
// a time, so turning one on turns the others off (each toggle's own change
// handler then removes its layer + persists the off state).
(function () {
  const boxes = ['circuit-cb', 'training-cb', 'cvfr-cb', 'heli-cb', 'commfail-cb']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  for (const cb of boxes) {
    cb.addEventListener('change', () => {
      if (!cb.checked) return;
      for (const other of boxes) {
        if (other !== cb && other.checked) {
          other.checked = false;
          other.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  }
})();
// Shared airfield-plate opacity slider — one control at the top of the frame
// drives whichever plate overlay is showing.
(function () {
  const opEl    = document.getElementById('plate-opacity');
  const opReset = document.getElementById('plate-opacity-reset');
  if (opEl) {
    opEl.value = String(plateOpacity);
    applyPlateOpacity(plateOpacity);          // sets val label on load
    opEl.oninput = function () {
      const v = parseFloat(opEl.value);
      try { localStorage.setItem(PLATE_OPACITY_KEY, String(v)); } catch (_) {}
      applyPlateOpacity(v);
    };
  }
  if (opReset) {
    opReset.onclick = function () {
      if (!opEl) return;
      opEl.value = String(PLATE_DEFAULT_OPACITY);
      try { localStorage.setItem(PLATE_OPACITY_KEY, String(PLATE_DEFAULT_OPACITY)); } catch (_) {}
      applyPlateOpacity(PLATE_DEFAULT_OPACITY);
    };
  }
})();
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
// docs/data/cvfr-comm-change.json and rings are drawn on top of the nav-WP dots
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
let displayTheme = 'light';                 // default light; a stored choice wins below
try {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') displayTheme = stored;
  if (stored === 'day') displayTheme = 'light';
} catch (e) { /* storage unavailable */ }
function applyDisplayTheme() {
  document.body.classList.toggle('theme-light', displayTheme === 'light');
  document.body.classList.toggle('theme-dark', displayTheme !== 'light');
  // The Zulu clock's default palette is theme-aware (see applyTuningCssVars) and
  // reads the body theme class, so refresh it now that the class is set.
  if (typeof applyTuningCssVars === 'function') applyTuningCssVars();
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
    // Suppress the beforeunload/visibilitychange autosave so reload() can't
    // re-persist the in-memory route right after we wipe storage.
    window.__clearingStore = true;
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
  // Position is per-language (RTL mirrors LTR, so the spot differs by language).
  const posKey = () => navLangPosKey(toolbarUsesDesktopMenu() ? KEY_DESKTOP : KEY);
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
  // Close every open section (any layout) — called when a modal opens so the
  // toolbar dropdown doesn't sit on top of it.
  window.closeToolbarMenus = function () {
    for (const sec of sections) {
      if (sec.classList.contains('open')) setSectionOpen(sec, false);
    }
  };

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
  if (window.NavAid && typeof NavAid.refreshSigwxOv === 'function') NavAid.refreshSigwxOv();
  if (window.NavAid && typeof NavAid.refreshWindField === 'function') NavAid.refreshWindField();
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
  // Circuit overlay: add to map if already toggled on (restored from localStorage)
  if (showCircuit) {
    loadCircuitOverlays();
    if (circuitLayerGroup) circuitLayerGroup.addTo(map);
  }
  // Training-area overlay: same restore-on-load guard.
  if (showTraining) {
    loadTrainingOverlays();
    if (trainingLayerGroup) trainingLayerGroup.addTo(map);
  }
  // CVFR routes / comm-failure overlay: same restore-on-load guard.
  if (showCvfr) {
    loadCvfrOverlays();
    if (cvfrLayerGroup) cvfrLayerGroup.addTo(map);
  }
  // Helicopter routes overlay: same restore-on-load guard.
  if (showHeli) {
    loadHeliOverlays();
    if (heliLayerGroup) heliLayerGroup.addTo(map);
  }
  // Comm-failure entry overlay: same restore-on-load guard.
  if (showCommfail) {
    loadCommfailOverlays();
    if (commfailLayerGroup) commfailLayerGroup.addTo(map);
  }
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
  if (window.__clearingStore) return;   // clear-store wiped storage; don't re-save
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

// --- APK self-update (native remote-URL shell) -----------------------
// The Capacitor WebView loads the live site once at launch and keeps the page
// alive across app resumes — it only re-navigates on a cold start, which
// Android seldom does. The SW-based notice above can't cover it: the SW update
// lifecycle (reg.update / controllerchange) is unreliable inside Android
// WebView. So an installed APK would sit frozen on its first-loaded bundle,
// breaking the README's "updates itself with every web deploy" promise.
//
// Fix: on resume, read the live build id straight from the network (sw.js
// carries CACHE='navaid-<sha>', rewritten at deploy in lockstep with
// NavAid.version='1.0-<sha>') and reload when it differs from the running
// build. Guards: dev builds (a version with no '-<sha>' suffix) never reload;
// a per-build sessionStorage marker prevents a reload loop if a CDN briefly
// serves a newer sw.js than the running page.
const APK_UPDATE_CHECK_MIN_MS = 30 * 1000;
const APK_RELOADED_FOR_KEY = 'navaid.apkReloadedForBuild';
let apkUpdateCheckInFlight = null;
let lastApkUpdateCheckAt = -Infinity;

function currentBuildId(version) {
  let v = version != null ? version
    : ((typeof window !== 'undefined' && window.NavAid && window.NavAid.version) || '');
  v = String(v);
  const dash = v.indexOf('-');
  return dash >= 0 ? v.slice(dash + 1) : '';   // '' for a dev build (no sha suffix)
}

function checkApkForUpdate(opts) {
  opts = opts || {};
  const running = opts.buildId != null ? opts.buildId : currentBuildId();
  if (!running) return Promise.resolve(false);            // dev build — never reload
  const now = (opts.now || Date.now)();
  if (!opts.force && now - lastApkUpdateCheckAt < APK_UPDATE_CHECK_MIN_MS) {
    return apkUpdateCheckInFlight || Promise.resolve(false);
  }
  lastApkUpdateCheckAt = now;
  const doFetch = opts.fetch ||
    ((typeof fetch === 'function') ? (u, o) => fetch(u, o) : null);
  if (!doFetch) return Promise.resolve(false);
  const reload = opts.reload || (() => window.location.reload());
  const store = opts.storage !== undefined ? opts.storage
    : (typeof sessionStorage !== 'undefined' ? sessionStorage : null);

  apkUpdateCheckInFlight = Promise.resolve(doFetch('sw.js?fresh=' + now, { cache: 'no-store' }))
    .then(r => (r && r.ok && typeof r.text === 'function') ? r.text() : '')
    .then(txt => {
      const m = /navaid-([A-Za-z0-9]+)/.exec(txt || '');
      const live = m ? m[1] : '';
      if (!live || live === 'v6' || live === running) return false;   // unknown / dev / unchanged
      let already = '';
      try { already = (store && store.getItem(APK_RELOADED_FOR_KEY)) || ''; } catch (e) {}
      if (already === live) return false;    // already reloaded for this build — don't loop
      try { if (store) store.setItem(APK_RELOADED_FOR_KEY, live); } catch (e) {}
      reload();
      return true;
    })
    .catch(() => false)
    .finally(() => { apkUpdateCheckInFlight = null; });
  return apkUpdateCheckInFlight;
}

// --- PWA: service worker --------------------------------------------
// Registering the worker makes the app installable; the browser shows
// the install control in the address bar — no in-app button needed.
function isNativeCapacitorShell() {
  return location.hostname === 'app.navaid.local' ||
    location.protocol === 'capacitor:' ||
    !!(window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform());
}
// The old STATIC shell served assets from a local native origin, where a
// service worker was pointless (assets already on-device) — so it skipped SW
// boot for any native shell. The remote-URL shell (capacitor.config
// server.url) loads the production site instead, and offline (app shell +
// downloaded chart packs) DEPENDS on the SW — so only skip the legacy local
// origins, and register normally when the shell shows the live site.
function isNativeLocalOrigin() {
  return location.hostname === 'app.navaid.local' || location.protocol === 'capacitor:';
}

if ('serviceWorker' in navigator && !isNativeLocalOrigin()) {
  watchBuildUpdateCheckTriggers();
  window.addEventListener('load', () => {
    watchServiceWorkerUpdates(navigator.serviceWorker);
  });
}

// The remote-URL native shell can't rely on the SW update lifecycle, so poll
// the live build id on resume and reload when a newer web deploy is live.
if (isNativeCapacitorShell() && !isNativeLocalOrigin()) {
  const check = () => { if (!document.hidden) checkApkForUpdate(); };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
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
// Index of the forecast time closest to "now" (Zulu) in an IMS times array —
// entries carry { valid:'HH:MM', day:'DD/MM/YYYY' } (UTC). Used so the PWX /
// SIGWX overlays default to the current valid time instead of the first one.
function imsNearestTimeIndex(times) {
  if (!Array.isArray(times) || !times.length) return 0;
  const now = Date.now();
  let best = 0, bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const tm = /^(\d{1,2}):(\d{2})$/.exec(times[i].valid || '');
    if (!tm) continue;
    const dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(times[i].day || '');
    let ms;
    if (dm) ms = Date.UTC(+dm[3], +dm[2] - 1, +dm[1], +tm[1], +tm[2]);
    else { const d = new Date(); ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +tm[1], +tm[2]); }
    const diff = Math.abs(ms - now);
    if (diff < bestD) { bestD = diff; best = i; }
  }
  return best;
}
// Shared valid-time dropdown for the IMS weather-chart overlays. Wind/temp (PWX)
// and significant-weather (SIGWX) are both IMS products issued for the same
// 00/03/06/12/18Z valid times, so one #wx-time dropdown drives both. The option
// value is the valid string; each overlay resolves its own data by matching it.
const NavWxTime = (function () {
  const KEY = 'navaid.wxTime';
  const sel = document.getElementById('wx-time');
  let seeded = false;
  // Merge a feed's times into the dropdown (deduped by valid), and seed the
  // initial selection once — the saved time if still offered, else nearest now.
  function ensure(times) {
    if (!sel || !Array.isArray(times)) return;
    const have = new Set(Array.from(sel.options, o => o.value));
    for (const t of times) {
      if (!t || !t.valid || have.has(t.valid)) continue;
      const o = document.createElement('option');
      o.value = t.valid;
      o.textContent = (t.day ? t.day + ' ' : '') + t.valid + 'Z';
      sel.appendChild(o); have.add(t.valid);
    }
    if (!seeded && sel.options.length) {
      let saved = '';
      try { saved = localStorage.getItem(KEY) || ''; } catch (e) {}
      if (saved && have.has(saved)) sel.value = saved;
      else sel.selectedIndex = Math.max(0, imsNearestTimeIndex(
        Array.from(sel.options, o => ({ valid: o.value }))));
      seeded = true;
    }
  }
  if (sel) sel.addEventListener('change', () => {
    try { localStorage.setItem(KEY, sel.value); } catch (e) {}
  });
  return {
    value: () => (sel ? sel.value : ''),
    ensure,
    onChange: fn => { if (sel) sel.addEventListener('change', fn); },
  };
})();

// Shared opacity for the IMS weather-chart overlays — one #wx-opacity slider
// fades both the wind/temp (PWX) and SIGWX overlays. Single owner: seeds the
// default / persisted value, drives the label + reset, and notifies both
// overlays on change.
const NavWxOpacity = (function () {
  const KEY = 'navaid.wxOpacity';
  const DEFAULT = 0.6;
  const sel = document.getElementById('wx-opacity');
  const valEl = document.getElementById('wx-opacity-val');
  const reset = document.getElementById('wx-opacity-reset');
  const value = () => { const v = sel ? parseFloat(sel.value) : NaN; return isNaN(v) ? DEFAULT : v; };
  const label = () => { if (valEl) valEl.textContent = Math.round(value() * 100) + '%'; };
  if (sel) {
    let v = DEFAULT;
    try { const s = parseFloat(localStorage.getItem(KEY)); if (!isNaN(s)) v = s; } catch (e) {}
    sel.value = String(v); label();
    sel.addEventListener('input', () => { try { localStorage.setItem(KEY, sel.value); } catch (e) {} label(); });
  }
  if (reset && sel) reset.addEventListener('click', () => {
    sel.value = String(DEFAULT);
    try { localStorage.setItem(KEY, String(DEFAULT)); } catch (e) {}
    label();
    sel.dispatchEvent(new Event('input'));
  });
  return { value, onChange: fn => { if (sel) sel.addEventListener('input', fn); } };
})();

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
  const timeSel = document.getElementById('wx-time');   // shared with SIGWX
  if (!box || !cb || !levelSel || !timeSel || typeof map === 'undefined') return;

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
  const sc = k => { const v = typeof tune === 'function' ? tune(k) : 1; return v > 0 ? v : 1; };
  function updateLayer() {
    if (!cb.checked || !manifest) { removeLayer(); return; }
    const t = currentTime();
    if (!t) { removeLayer(); return; }
    const b = manifest.bounds;
    // Tunable (?tune=1 → Weather (IMS)) for fine-aligning the overlay:
    // scale the span about its centre (zoom), then nudge lat/lng.
    const cLat = (b.s + b.n) / 2, cLng = (b.w + b.e) / 2;
    const hLat = (b.n - b.s) / 2 * sc('imsPwxLatScale');
    const hLng = (b.e - b.w) / 2 * sc('imsPwxLngScale');
    const dLat = off('imsPwxLatOffset'), dLng = off('imsPwxLngOffset');
    const bounds = [[cLat - hLat + dLat, cLng - hLng + dLng],
                    [cLat + hLat + dLat, cLng + hLng + dLng]];
    const url = RAW + t.png + '?t=' + (manifest.generatedAt || '');
    if (!layer) {
      layer = L.imageOverlay(url, bounds, { opacity: NavWxOpacity.value(), interactive: false, pane: 'overlayPane', className: 'ims-pwx-layer' });
      layer.addTo(map);
    } else {
      layer.setUrl(url);
      layer.setBounds(bounds);
      layer.setOpacity(NavWxOpacity.value());
    }
    applyRotation();
  }
  // L.imageOverlay has no native rotation — append a CSS rotate() to the image
  // (about its centre) on top of Leaflet's positioning transform, re-applied
  // whenever Leaflet repositions it (pan/zoom) so the rotation sticks.
  function applyRotation() {
    if (!layer || typeof layer.getElement !== 'function') return;
    const el = layer.getElement();
    if (!el) return;
    const deg = off('imsPwxRotationDeg');
    const base = el.style.transform.replace(/\s*rotate\([^)]*\)/g, '');
    el.style.transformOrigin = '50% 50%';
    el.style.transform = deg ? (base + ' rotate(' + deg + 'deg)') : base;
  }
  map.on('move zoom zoomend viewreset', applyRotation);
  // Merge this level's valid times into the shared #wx-time dropdown (deduped;
  // does not clear SIGWX's options). The selection persists in the element.
  function fillTimes() {
    const lv = currentLevel();
    if (lv) NavWxTime.ensure(lv.times);
  }

  // Persist the on/off + selections so a reload keeps the overlay as it was.
  const KEY = 'navaid.imsPwx';
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        on: cb.checked, level: levelSel.value, valid: timeSel.value,
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
  // Opacity is the shared #wx-opacity slider (NavWxOpacity) — re-apply on change.
  NavWxOpacity.onChange(() => { if (layer) layer.setOpacity(NavWxOpacity.value()); });

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
          if (sv.on) { cb.checked = true; controls.hidden = false; }
        }
      } catch (e) { /* storage unavailable */ }
      // The shared #wx-time dropdown was seeded to now (Zulu) by NavWxTime.
      updateLayer();
      // Show the model run time (cropped off the chart's bottom band).
      const runEl = document.getElementById('ims-pwx-run');
      if (runEl && /^\d{12}$/.test(m.run || '')) {
        const r = m.run;
        runEl.textContent = (S.tbImsPwxRun || 'Model run') + ': ' +
          r.slice(6, 8) + '/' + r.slice(4, 6) + ' ' + r.slice(8, 10) + ':' + r.slice(10, 12) + 'Z';
      }
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
    if (back || !manifest) return;   // open even with zero times (show broken)
    // Behave like every chart: close other open charts + the toolbar dropdowns.
    if (typeof closeOpenChartModals === 'function') closeOpenChartModals();
    if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
    back = document.createElement('div');
    back.className = 'modal-back';
    back.dataset.chartModal = 'sigwx';
    back._navaidClose = close;
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
    if (manifest.times.length) {
      load();
    } else {
      // Charts exist as a feature but none are currently published (a run that
      // couldn't fetch them) — show it's broken, not hidden.
      sel.hidden = true; img.hidden = true;
      note.hidden = false;
      note.textContent = S.sigwxUnavailable || 'SIGWX charts are temporarily unavailable.';
    }
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
      // Reveal the button whenever the manifest exists — even with zero times —
      // so a broken/empty run is visible (button opens to an "unavailable" note)
      // rather than the whole feature silently disappearing.
      if (!m || !Array.isArray(m.times)) return;
      manifest = m;
      btn.hidden = false;
    })
    .catch(() => { /* manifest unreachable → stay hidden */ });
})();

// --- IMS wind/temperature (PWX) original-chart viewer ----------------
// Same image-modal pattern as the SIGWX viewer, but the PWX manifest is keyed
// by flight level → valid time. Shows the original IMS chart full-size; the
// on-map PWX overlay is a separate control in the Information section.
(function imsPwxChartsViewer() {
  const RAW = 'https://raw.githubusercontent.com/msupino/NavigationApp/ims-data/';
  const btn = document.getElementById('pwx-btn');
  if (!btn) return;
  let manifest = null, back = null;

  function close() {
    if (back) { back.remove(); back = null; }
    document.removeEventListener('keydown', onEsc, true);
  }
  function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  function open() {
    if (back || !manifest) return;
    if (typeof closeOpenChartModals === 'function') closeOpenChartModals();
    if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
    back = document.createElement('div');
    back.className = 'modal-back';
    back.dataset.chartModal = 'pwx';
    back._navaidClose = close;
    const box = document.createElement('div');
    box.className = 'modal wide sigwx-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.style.cursor = 'default';
    title.textContent = S.pwxModalTitle || 'Wind / temperature charts (PWX)';
    box.appendChild(title);

    const levels = manifest.levels.slice().sort((a, b) => Number(b.level) - Number(a.level));
    const lvlSel = document.createElement('select');
    lvlSel.className = 'sigwx-time';
    lvlSel.setAttribute('aria-label', S.tbImsPwxLevel || 'Level');
    levels.forEach((lv, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = lv.label || (lv.level + ' hPa');
      lvlSel.appendChild(o);
    });
    box.appendChild(lvlSel);

    const timeSel = document.createElement('select');
    timeSel.className = 'sigwx-time';
    timeSel.setAttribute('aria-label', S.tbImsPwxTime || 'Valid time');
    box.appendChild(timeSel);

    const img = document.createElement('img');
    img.className = 'sigwx-img';
    img.alt = S.pwxModalTitle || 'PWX chart';
    const note = document.createElement('div');
    note.className = 'sigwx-missing';
    note.hidden = true;
    note.textContent = S.pwxMissing || 'Chart not available for this level/time yet.';

    // Read png paths from the trusted manifest by index, never the DOM value
    // (avoids js/xss-through-dom).
    const curLevel = () => levels[lvlSel.selectedIndex];
    function fillTimes() {
      const lv = curLevel(); const prev = timeSel.value;
      timeSel.innerHTML = '';
      if (!lv || !Array.isArray(lv.times)) return;
      lv.times.forEach((t, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = (t.day ? t.day + ' ' : '') + t.valid + 'Z';
        timeSel.appendChild(o);
      });
      if (prev && [...timeSel.options].some(o => o.value === prev)) timeSel.value = prev;
    }
    function load() {
      const lv = curLevel(); const t = lv && lv.times[timeSel.selectedIndex];
      if (!t) { img.hidden = true; note.hidden = false; return; }
      note.hidden = true; img.hidden = false;
      img.src = RAW + t.png + '?t=' + (manifest.generatedAt || '');
    }
    img.addEventListener('error', () => { img.hidden = true; note.hidden = false; });
    lvlSel.addEventListener('change', () => { fillTimes(); load(); });
    timeSel.addEventListener('change', load);
    if (levels.length) { fillTimes(); load(); }
    else {
      lvlSel.hidden = true; timeSel.hidden = true; img.hidden = true;
      note.hidden = false;
      note.textContent = S.pwxUnavailable || 'Wind/temp charts are temporarily unavailable.';
    }
    box.appendChild(img);
    box.appendChild(note);

    if (typeof addModalCloseX === 'function') addModalCloseX(box, close);
    back.appendChild(box);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.addEventListener('keydown', onEsc, true);
    document.body.appendChild(back);
    lvlSel.focus();
  }

  btn.addEventListener('click', open);

  fetch(RAW + 'ims/pwx.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(m => {
      if (!m || !Array.isArray(m.levels) || !m.levels.length) return;
      manifest = m;
      btn.hidden = false;
    })
    .catch(() => { /* manifest unreachable → stay hidden */ });
})();

// --- SIGWX significant-weather MAP overlay --------------------------
// Overlays the low-level prog chart's map panel on the map (georeferenced like
// PWX). The chart is a rotated, projected regional chart with its own basemap,
// so alignment is approximate and fine-tuned via ?tune (SIGWX overlay group).
// We crop the IMS PNG to its map frame (drop the side table) before overlaying.
(function imsSigwxOverlay() {
  const RAW = 'https://raw.githubusercontent.com/msupino/NavigationApp/ims-data/';
  const box = document.getElementById('sigwx-ov');
  const cb = document.getElementById('sigwx-ov-cb');
  const controls = document.getElementById('sigwx-ov-controls');
  const timeSel = document.getElementById('wx-time');   // shared with wind/temp
  if (!box || !cb || !timeSel || typeof map === 'undefined' || typeof L === 'undefined') return;
  // Three panels of the 1755x1240 IMS chart: the full-width title/valid-time
  // HEADER strip, the left MAP frame, and the right weather TABLE. The MAP and
  // TABLE crops both start BELOW the header (y0=0.105); the header is shown as
  // its own strip shrunk to the table's width and parked above the table.
  const CROP_HEADER = { x0: 0.00000, x1: 0.99200, y0: 0.02258, y1: 0.10484 };
  const CROP_MAP = { x0: 0.01595, x1: 0.38860, y0: 0.10484, y1: 0.91774 };
  const CROP_TABLE = { x0: 0.39000, x1: 0.99200, y0: 0.10484, y1: 0.91774 };
  // Header strip aspect (height/width in source px) — used to size it when it's
  // scaled to the table's width.
  const HEADER_ASPECT = (CROP_HEADER.y1 - CROP_HEADER.y0) / (CROP_HEADER.x1 - CROP_HEADER.x0)
    * (1240 / 1755);
  // Map-panel geographic extent (re-solved for the header-trimmed crop) as a
  // similarity fit over three airfields shared with our own layers — LLHA, LLBS
  // and LLIB; LLIB constrains the longitude scale. ~-0.8° tilt → sigwxRotationDeg.
  const BOUNDS_MAP = { n: 33.97, s: 29.37, w: 33.29, e: 36.80 };
  // The TABLE isn't geographic — park it just east of Israel (over Jordan) so it
  // sits to the right of the map; position/size are tunable.
  const BOUNDS_TABLE = { n: 34.20, s: 29.60, w: 37.10, e: 40.60 };

  let manifest = null, mapLayer = null, tblLayer = null, hdrLayer = null;
  const off = k => (typeof tune === 'function' ? tune(k) : 0) || 0;
  const sc = k => { const v = typeof tune === 'function' ? tune(k) : 1; return v > 0 ? v : 1; };
  const cropCache = {};                      // key → cropped dataURL

  function removeLayers() {
    if (mapLayer) { map.removeLayer(mapLayer); mapLayer = null; }
    if (tblLayer) { map.removeLayer(tblLayer); tblLayer = null; }
    if (hdrLayer) { map.removeLayer(hdrLayer); hdrLayer = null; }
  }
  // Crop a panel of the chart PNG client-side. `knockWhite` (map panel only)
  // makes the chart's white paper transparent so it doesn't read as a glaring
  // print sheet over a dark-mode map (the table keeps its white, for legibility).
  // raw.githubusercontent serves CORS so the canvas isn't tainted.
  function cropPanel(url, crop, knockWhite) {
    // Map panel: drop the chart's pale paper AND terrain/sea (light + low
    // saturation) so the selected base layer (CVFR, etc.) shows through; the
    // saturated hazard areas + dark lines/labels stay. Table/header keep white.
    const thr = knockWhite ? Math.round(off('sigwxWhiteKnockout') || 170) : 999;
    const satThr = Math.round(off('sigwxKnockoutSat'));
    const key = url + '|' + crop.x0 + '|' + crop.y0 + '|' + thr + '|' + satThr;
    if (cropCache[key]) return Promise.resolve(cropCache[key]);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const W = img.naturalWidth, H = img.naturalHeight;
          const sx = Math.round(W * crop.x0), sy = Math.round(H * crop.y0);
          const sw = Math.round(W * (crop.x1 - crop.x0)), sh = Math.round(H * (crop.y1 - crop.y0));
          const c = document.createElement('canvas');
          c.width = sw; c.height = sh;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          if (knockWhite && thr <= 255) {
            const im = ctx.getImageData(0, 0, sw, sh), d = im.data;
            for (let i = 0; i < d.length; i += 4) {
              const r = d[i], g = d[i + 1], b = d[i + 2];
              const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
              if (mx >= thr && (mx - mn) <= satThr) d[i + 3] = 0;
            }
            ctx.putImageData(im, 0, 0);
          }
          const data = c.toDataURL('image/png');
          cropCache[key] = data;
          resolve(data);
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = url;
    });
  }
  function currentTime() {
    // Resolve by valid string — the shared #wx-time dropdown's option order is
    // not this manifest's array order.
    return manifest && manifest.times.find(t => t.valid === timeSel.value);
  }
  function boundsFrom(B, latOff, lngOff, latSc, lngSc) {
    const cLat = (B.s + B.n) / 2, cLng = (B.w + B.e) / 2;
    const hLat = (B.n - B.s) / 2 * sc(latSc), hLng = (B.e - B.w) / 2 * sc(lngSc);
    const dLat = off(latOff), dLng = off(lngOff);
    return [[cLat - hLat + dLat, cLng - hLng + dLng], [cLat + hLat + dLat, cLng + hLng + dLng]];
  }
  function applyRotation() {       // only the map panel is tilted; the table is upright
    if (!mapLayer || typeof mapLayer.getElement !== 'function') return;
    const el = mapLayer.getElement(); if (!el) return;
    const deg = off('sigwxRotationDeg');
    const base = el.style.transform.replace(/\s*rotate\([^)]*\)/g, '');
    el.style.transformOrigin = '50% 50%';
    el.style.transform = deg ? (base + ' rotate(' + deg + 'deg)') : base;
  }
  map.on('move zoom zoomend viewreset', applyRotation);
  function place(which, data, bounds, op) {
    const ref = which === 'map' ? mapLayer : (which === 'header' ? hdrLayer : tblLayer);
    if (!ref) {
      const lyr = L.imageOverlay(data, bounds, { opacity: op, interactive: false, pane: 'overlayPane', className: 'sigwx-ov-layer' });
      lyr.addTo(map);
      if (which === 'map') mapLayer = lyr; else if (which === 'header') hdrLayer = lyr; else tblLayer = lyr;
    } else {
      ref.setUrl(data); ref.setBounds(bounds); ref.setOpacity(op);
    }
  }
  function updateLayer() {
    if (!cb.checked || !manifest) { removeLayers(); return; }
    const t = currentTime();
    if (!t) { removeLayers(); return; }
    const url = RAW + t.png + '?t=' + (manifest.generatedAt || '');
    cropPanel(url, CROP_MAP, true).then(data => {
      if (!cb.checked) { removeLayers(); return; }
      place('map', data, boundsFrom(BOUNDS_MAP, 'sigwxLatOffset', 'sigwxLngOffset', 'sigwxLatScale', 'sigwxLngScale'), NavWxOpacity.value());
      applyRotation();
    }).catch(() => removeLayers());
    const tblOp = off('sigwxTblOpacity') || 0.92;
    const tblBounds = boundsFrom(BOUNDS_TABLE, 'sigwxTblLatOffset', 'sigwxTblLngOffset', 'sigwxTblScale', 'sigwxTblScale');
    cropPanel(url, CROP_TABLE, false).then(data => {
      if (!cb.checked) return;
      place('table', data, tblBounds, tblOp);
    }).catch(() => { /* table optional */ });
    // Title header: full-width strip shrunk to the table's width, parked just
    // above the table (height keeps the strip's aspect at that width).
    cropPanel(url, CROP_HEADER, false).then(data => {
      if (!cb.checked) return;
      const w = tblBounds[0][1], e = tblBounds[1][1], nT = tblBounds[1][0];
      const midLat = (tblBounds[0][0] + nT) / 2;
      const hLat = (e - w) * Math.cos(midLat * Math.PI / 180) * HEADER_ASPECT;
      place('header', data, [[nT, w], [nT + hLat, e]], tblOp);
    }).catch(() => { /* header optional */ });
  }
  // Merge into the shared #wx-time dropdown (deduped; does not clear PWX's
  // options).
  function fillTimes() {
    if (manifest) NavWxTime.ensure(manifest.times);
  }
  const KEY = 'navaid.sigwxOv';
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ on: cb.checked, valid: timeSel.value })); }
    catch (e) { /* */ }
  };
  NavAid.refreshSigwxOv = updateLayer;

  cb.addEventListener('change', () => { controls.hidden = !cb.checked; updateLayer(); persist(); });
  timeSel.addEventListener('change', () => { updateLayer(); persist(); });
  // Opacity is the shared #wx-opacity slider (NavWxOpacity) — re-render on change.
  NavWxOpacity.onChange(() => updateLayer());

  fetch(RAW + 'ims/sigwx.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(m => {
      if (!m || !Array.isArray(m.times) || !m.times.length) return;
      manifest = m;
      fillTimes();
      box.hidden = false;
      // Restore persisted state.
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* */ }
      // The shared #wx-time dropdown was seeded to now (Zulu) by NavWxTime.
      if (saved && saved.on) { cb.checked = true; controls.hidden = false; updateLayer(); }
    })
    .catch(() => { /* manifest unreachable → stay hidden */ });
})();
