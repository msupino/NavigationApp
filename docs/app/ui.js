'use strict';
/* NavAid — toolbar wiring, toolbar drag, boot, PWA.
   Shares globals with core.js; loaded last. */

// --- toolbar ---------------------------------------------------------
// Floating "you are in a mode" chip. The mode buttons live inside a dropdown that
// closes as soon as one is clicked, so their .active highlight is hidden and the only
// remaining cue was the crosshair cursor — easy to miss, and every later map click
// kept adding waypoints (a click meant to dismiss a panel silently added one).
// One-time nudge over the map while the route is empty. The core action had no
// discoverable entry point: a plain click did nothing and the add tool is two levels
// into a menu. Once is the point: it is onboarding, not a status readout, so it is
// shown to a given browser exactly once (navaid.hintEmptyRoute) and never returns --
// not on the next visit, and not after a later Clear map.
const EMPTY_HINT_KEY = 'navaid.hintEmptyRoute';
function emptyRouteHintSeen() {
  try { return lsGet(EMPTY_HINT_KEY) === '1'; }
  catch (e) { return false; }          // storage unavailable -> show it, harmless
}
function refreshEmptyRouteHint() {
  const empty = !state.waypoints || !state.waypoints.length;
  let el = document.getElementById('empty-route-hint');
  if (!empty || state.mode) { if (el) el.remove(); return; }
  if (!el) {
    // The flag is written when the hint is CREATED, and an element already on screen
    // is left alone, so marking it seen cannot make it vanish mid-read.
    if (emptyRouteHintSeen()) return;
    el = document.createElement('div');
    el.id = 'empty-route-hint';
    document.body.appendChild(el);
    try { localStorage.setItem(EMPTY_HINT_KEY, '1'); } catch (e) { /* storage unavailable */ }
  }
  el.textContent = S.emptyRouteHint || 'Click the map to add your first waypoint';
}

function refreshModeChip() {
  let chip = document.getElementById('mode-chip');
  const label = state.mode === 'add' ? (S.modeChipAdd || 'Adding waypoints')
    : state.mode === 'note' ? (S.modeChipNote || 'Adding notes') : '';
  if (!label) { if (chip) chip.remove(); return; }
  if (!chip) {
    chip = document.createElement('button');
    chip.id = 'mode-chip';
    chip.type = 'button';
    chip.onclick = () => setMode(null);
    document.body.appendChild(chip);
  }
  chip.textContent = label + ' — ' + (S.modeChipStop || 'tap to stop');
  chip.title = S.modeChipTitle || 'Click to leave this mode';
}

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
  refreshModeChip();
  // A map tool needs the map. In mobile-column mode the menu stays open over it —
  // covering ~98% of the height, so points had to be placed through a narrow strip —
  // so collapse it here. Desktop already closes the dropdown after a command.
  if (mode && typeof toolbarUsesDesktopMenu === 'function' && !toolbarUsesDesktopMenu()) {
    if (typeof window.collapseToolbarForMapTool === 'function') window.collapseToolbarForMapTool();
  }
  if (typeof refreshEmptyRouteHint === 'function') refreshEmptyRouteHint();
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

// Paint the legend's VOR swatch with drawVorSymbol() — the very function drawVors()
// uses — so the key cannot drift from the symbol it explains. Scaled to the 18px box:
// the radius leaves room for the ticks, and stroke/tick/dot follow the same ratios as
// the map because they are computed from that radius by the shared painter.
function paintLegendVor() {
  const cv = document.querySelector('canvas.legend-vor');
  if (!cv || typeof drawVorSymbol !== 'function') return;
  const dpr = window.devicePixelRatio || 1;
  const box = 18;
  cv.width = box * dpr;
  cv.height = box * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box, box);
  const mapR = tune('vorMarkerRadiusPx');            // 9 on the map
  const r = 5.5;                                     // ring + ticks fit an 18px box
  const k = r / mapR;                                // keep every ratio the map uses
  drawVorSymbol(ctx, box / 2, box / 2, r, tune('vorMarkerColor'),
    Math.max(1, tune('vorMarkerWidthPx') * k), 4 * k);
}
paintLegendVor();

// Nav-data source picker: "Follow chart" (default) or an explicit chart. The value
// drives layerDataPrefix(), so one change swaps waypoints, comm changes and leg
// altitudes together -- they belong to one chart, and mixing them (heli waypoints with
// CVFR altitudes) would quietly produce a wrong plan.
const NAVWP_SOURCE_KEY = 'navaid.navDataPrefix';
(function wireNavWpSource() {
  const sel = document.getElementById('navwp-source');
  if (!sel) return;
  try {
    const stored = lsGet(NAVWP_SOURCE_KEY);
    if (stored === 'cvfr' || stored === 'lsa' || stored === 'heli') window.navDataPrefix = stored;
  } catch (e) { /* storage unavailable */ }
  const opts = [['', S.tbNavWpSourceFollow || 'Follow chart'],
    ['cvfr', (S.layerLabels && S.layerLabels.CVFR) || 'CVFR'],
    ['lsa', (S.layerLabels && S.layerLabels['Low Alt']) || 'Low Alt'],
    ['heli', (S.layerLabels && S.layerLabels.Helicopters) || 'Helicopters']];
  for (const [value, label] of opts) {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = navDataPrefix || '';
  sel.onchange = () => {
    window.navDataPrefix = sel.value || null;
    try {
      if (navDataPrefix) localStorage.setItem(NAVWP_SOURCE_KEY, navDataPrefix);
      else localStorage.removeItem(NAVWP_SOURCE_KEY);
    } catch (e) { /* storage unavailable */ }
    // Same path a base-layer switch takes, so every dataset and the open alt-pairs
    // table follow, and a route pinned to another chart is not rewritten.
    if (typeof reloadLayerDatasets === 'function') reloadLayerDatasets();
  };
})();

// base map layer picker (replaces the Leaflet layers control)
const layerSelect = document.getElementById('layer-select');
// Flight charts first (CVFR / LSA / Heli), then a separator, then base maps.
// '---' is a non-selectable divider. Any layer not listed is appended after.
const LAYER_ORDER = ['CVFR', 'Low Alt', 'Helicopters', '---',
                     'Navigation', 'Satellite', 'OpenStreetMap'];
const orderedLayerNames = () => [
  ...LAYER_ORDER.filter(n => n === '---' || (layers[n] && layerOffered(n))),
  ...Object.keys(layers).filter(n => !LAYER_ORDER.includes(n) && layerOffered(n)),
];
// (Re)build the picker from the OFFERED layers. Runs at boot and again after the gist
// lands, because the gist is what turns layers on and off -- a chart pulled from service
// disappears from here without a build, and the map falls back to CVFR if it was active.
function rebuildLayerPicker() {
  const current = layerSelect.value;
  layerSelect.textContent = '';
  for (const name of orderedLayerNames()) {
    const opt = document.createElement('option');
    if (name === '---') { opt.disabled = true; opt.textContent = '──────────'; layerSelect.appendChild(opt); continue; }
    opt.value = name;
    opt.textContent = (S.layerLabels && S.layerLabels[name]) || name;
    if (map.hasLayer(layers[name])) opt.selected = true;
    layerSelect.appendChild(opt);
  }
  const active = (typeof currentLayerName === 'function') ? currentLayerName() : current;
  if (active && !layerOffered(active)) {
    // The active layer just got pulled: land on CVFR, datasets and all.
    layerSelect.value = 'CVFR';
    layerSelect.onchange && layerSelect.onchange();
  }
}
rebuildLayerPicker();
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
// Apply the new chart's own NOTAM choice. The overlay flag is per chart (see
// notamPrefKey), so a switch has to re-read it and bring the checkbox with it —
// otherwise the previous chart's state stays on screen under the new chart.
function applyNotamPrefForLayer() {
  const pref = notamPrefRead();
  const on = pref === null ? false : pref;
  if (window.showNotam === on) return Promise.resolve(false);
  window.showNotam = on;
  const cb = document.getElementById('notam-cb');
  if (cb && !cb.disabled) cb.checked = on;
  const after = () => { if (typeof refreshNotamListBtn === 'function') refreshNotamListBtn(); return true; };
  if (on && typeof ensureNotams === 'function') return Promise.resolve(ensureNotams()).then(after);
  return Promise.resolve(after());
}

function reloadLayerDatasets() {
  _layerGen++;               // invalidate any in-flight fetch from the previous layer
  // A selection backed by a per-layer dataset does not survive the switch: the bubble is
  // not on the new layer at all, and a nav-waypoint index would silently point at a
  // DIFFERENT layer's point once navWP repopulates. Close the inspector rather than let it
  // show either stale or wrong data. (Airfields and VORs are layer-independent and keep.)
  if (state.selected && (state.selected.type === 'lsaArea' || state.selected.type === 'navwp')) {
    state.selected = null;
    if (typeof showInspector === 'function') showInspector();
  }
  navWP = null;
  commChangeMap = null;
  commChangeCallSigns = {};
  legAltitudeMap = null;
  areas = null;
  // routeTemplates is a single shared list filtered per layer at render time —
  // no reload needed on layer switch.
  const jobs = [loadAreas(), applyNotamPrefForLayer()];
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

  // The legend's VOR swatch is a canvas painted by the map's own symbol function, so a
  // tune/gist recolour has to repaint it (see paintLegendVor).
  root.setProperty('--navaid-vor-marker-color', tune('vorMarkerColor'));
  if (typeof paintLegendVor === 'function') paintLegendVor();
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
    const p = JSON.parse(navLangPosRead(KEY) || 'null');
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
      try { localStorage.setItem(navLangPosKey(KEY), JSON.stringify({ x: r2.left, y: r2.top })); }
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
  // The card must not come to rest under the menu bar. It carries the route totals as
  // its top row, so that is exactly the line the toolbar hid -- the always-visible
  // number ended up the invisible one. Only pushes DOWN, and only while the card
  // actually overlaps the bar horizontally, so the rest of the map stays fair game.
  function clearOfToolbar(x, y) {
    const w = box.offsetWidth, h = box.offsetHeight;
    // The docked search sits directly under the bar, i.e. exactly where a card
    // pushed clear of the bar lands — and it paints above the legend, so the card
    // ended up unreachable there. Both count as chrome to be pushed past, lowest
    // obstacle last so a stack of them resolves in one pass.
    const chrome = ['toolbar', 'search-overlay']
      .map(id => document.getElementById(id))
      .filter(el => el && !el.classList.contains('hidden'))
      .map(el => el.getBoundingClientRect())
      .filter(r => r.height)                       // hidden (print, mobile modal)
      .sort((a, b) => a.bottom - b.bottom);
    for (const t of chrome) {
      const horizontallyClear = x + w < t.left || x > t.right;
      // Leave the position alone unless the card would actually SIT ON the bar: clear to
      // its side, fully above it, or fully below it are all fine. Testing only "above"
      // pinned every card below the bar to bottom+6 -- it could be dragged up but never
      // back down again.
      const verticallyClear = y + h < t.top || y > t.bottom;
      if (!horizontallyClear && !verticallyClear) y = t.bottom + 6;
    }
    return y;
  }
  function applyPos(x, y) {
    const maxX = Math.max(0, window.innerWidth - box.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - box.offsetHeight);
    y = clearOfToolbar(Math.max(0, Math.min(maxX, x)), y);
    box.style.position = 'fixed';
    box.style.left = Math.max(0, Math.min(maxX, x)) + 'px';
    box.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    box.style.margin = '0';
  }
  try {
    const p = JSON.parse(navLangPosRead(KEY) || 'null');
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
      try { localStorage.setItem(navLangPosKey(KEY), JSON.stringify({ x: r2.left, y: r2.top })); }
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
  // Jump, don't slide: when the current zoom already is the go-to zoom this is a
  // same-zoom setView, which Leaflet animates as a pan — a long glide across the
  // country for a coordinate you typed, and the canvas overlay lags behind it.
  map.setView([ll.lat, ll.lng], Math.max(map.getZoom(), 11), { animate: false });
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
  i.value = String(value).padStart(len, '0');   // zero-pad to the slot width (lng deg = 3)
  return i;
}
// Fill the six slots from a decimal lat/lng (used by paste).
function fillGotoSlots(lat, lng) {
  const la = dmsParts(lat), lo = dmsParts(lng);
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = String(v).padStart(el.maxLength || 2, '0');
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
    gotoSlot('goto-lng-d', lng.d, 3, S.longitude + ' deg'), gotoSep('°'),
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
  try { raw = lsGet(VIEW_KEY); } catch (e) { return null; }
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
    const sb = parseFloat(lsGet(BEARING_KEY));
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

// Flash the point a search just flew to. Landing at a new place with nothing marked leaves
// the pilot hunting for which of several nearby symbols was the hit -- so ring it, briefly,
// then let it go. Deliberately NOT a permanent marker: it is an answer to "where is it",
// not a change to the route.
//
// Its own pane so it sits above the chart without joining the rotate pane (the ring is a
// screen-space annotation; rotating it would skew the circle).
let _searchFlashEl = null;
let _searchFlashTimer = null;
function flashMapPoint(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const ms = (typeof tune === 'function') ? Number(tune('searchFlashMs')) : 3500;
  if (!(ms > 0)) return;                       // 0 turns it off
  const px = (typeof tune === 'function') ? Number(tune('searchFlashRadiusPx')) || 26 : 26;
  clearSearchFlash();
  if (!map.getPane('searchflash')) {
    map.createPane('searchflash');
    const pane = map.getPane('searchflash');
    pane.style.zIndex = 640;                   // above the route overlay, below controls
    pane.style.pointerEvents = 'none';         // never steals a click from the map
  }
  const icon = L.divIcon({
    className: 'search-flash',
    html: '<span class="search-flash-ring"></span>',
    iconSize: [px * 2, px * 2],
    iconAnchor: [px, px],
  });
  _searchFlashEl = L.marker([lat, lng], { icon, pane: 'searchflash',
    interactive: false, keyboard: false }).addTo(map);
  // Every knob the CSS reads comes from the tune registry, so the gist (or ?tune=1) can
  // change how loud this is without a release. Colour is a hex string; the fill is derived
  // from it so the two can never disagree.
  const T = (k, fb) => { const v = (typeof tune === 'function') ? tune(k) : undefined;
    return (v === undefined || v === null || v === '') ? fb : v; };
  const hex = String(T('searchFlashColor', '#ffb020')).trim();
  // The fill is derived from the ring colour so the two cannot disagree. A malformed value
  // from the gist falls back rather than producing an invalid rgba() that would drop the
  // fill silently.
  const rgb = /^#?[0-9a-f]{6}$/i.test(hex)
    ? hex.replace('#', '').match(/../g).map(h => parseInt(h, 16)).join(', ')
    : '255, 176, 32';
  const el = _searchFlashEl.getElement();
  el.style.setProperty('--flash-size', px * 2 + 'px');
  el.style.setProperty('--flash-ms', ms + 'ms');
  el.style.setProperty('--flash-color', hex);
  el.style.setProperty('--flash-rgb', rgb);
  el.style.setProperty('--flash-width', (Number(T('searchFlashWidthPx', 2)) || 2) + 'px');
  el.style.setProperty('--flash-fill', String(T('searchFlashFillAlpha', 0.10)));
  const pulses = Math.max(0, Math.round(Number(T('searchFlashPulses', 2))));
  el.style.setProperty('--flash-pulses', String(pulses));
  if (!pulses) el.classList.add('search-flash-nopulse');
  _searchFlashTimer = setTimeout(clearSearchFlash, ms);
}
function clearSearchFlash() {
  if (_searchFlashTimer) { clearTimeout(_searchFlashTimer); _searchFlashTimer = null; }
  if (_searchFlashEl) { map.removeLayer(_searchFlashEl); _searchFlashEl = null; }
}
window.flashMapPoint = flashMapPoint;
window.clearSearchFlash = clearSearchFlash;

// --- nav-waypoint search --------------------------------------------
const wpSearch = document.getElementById('wp-search');
const wpResults = document.getElementById('wp-search-results');
// The panel only outranks the toolbar while the dropdown is open (see style.css).
function syncSearchResultsStacking() {
  const ov = document.getElementById('search-overlay');
  const res = document.getElementById('wp-search-results');
  if (ov && res) ov.classList.toggle('has-results', !res.classList.contains('hidden'));
}
function closeSearch() {
  wpResults.classList.add('hidden');
  syncSearchResultsStacking();
  wpResults.innerHTML = '';
}
// The two-line "type space-separated codes" tip teaches the search once and then
// costs two permanent lines above the map — on the docked desktop panel it never
// went away. Retire it after the pilot has actually searched.
const SEARCH_TIP_KEY = 'navaid.searchTipDone';
function searchTipDone() {
  try { return lsGet(SEARCH_TIP_KEY) === '1'; } catch (e) { return false; }
}
function retireSearchTip() {
  const tip = document.getElementById('wp-search-hint');
  if (tip) tip.classList.add('hidden');
  try { localStorage.setItem(SEARCH_TIP_KEY, '1'); } catch (e) { /* storage unavailable */ }
}
function applySearchTipState() {
  const tip = document.getElementById('wp-search-hint');
  if (tip) tip.classList.toggle('hidden', searchTipDone());
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
  // Auto-route applies to a search-built route too: typing "LLHZ RIDNG" is the same
  // request as tapping the two points, and it would be strange for one to fill in the
  // reporting points between them and the other not to. Each gap is filled in turn, and
  // the fill is skipped if the route changed under the await.
  if (typeof autoRouteChain === 'function' && window.autoRouteCorridors) {
    (async () => {
      const built = state.waypoints;
      for (let i = built.length - 1; i > 0; i--) {
        if (state.waypoints !== built) return;              // route replaced meanwhile
        const prev = built[i - 1], next = built[i];
        const mid = await autoRouteChain(prev, next);
        if (state.waypoints !== built) return;   // route replaced mid-await: not ours any more
        if (!mid || !mid.length) continue;
        const at = state.waypoints.indexOf(next);
        if (at < 1 || state.waypoints[at - 1] !== prev) continue;
        state.waypoints.splice(at, 0, ...mid);
      }
      syncLegs();
      if (typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
      draw();
      fitView();
    })().catch(() => {});
  }
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
    // The template names its own cruise speed, so the leg is not tracking the default.
    if (typeof markLegSpeedManual === 'function') markLegSpeedManual(leg);
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
          // Use the shared default so a template callout lands LEFT of travel like
          // every other one. Hand-rolling the static compass offset here put every
          // template's callouts due east — on a northbound leg that is the nav-kite
          // side, the overlap the shared helper exists to avoid — and the migration
          // in seedCommChangeNotes does not recognise that position, so nothing
          // ever corrected it. `waypoints` is this route's own list; it is not in
          // state yet.
          const tail = (typeof commCalloutDefaultTail === 'function')
            ? commCalloutDefaultTail(wp, waypoints.indexOf(wp), waypoints)
            : { lat: wp.lat, lng: wp.lng };
          lat = tail.lat;
          lng = tail.lng;
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
    const corrupt = NavAid.routeLibraryCorrupt && typeof NavAid.routeLibraryCorruptRaw === 'string';
    const lib = corrupt ? null : loadRouteLibrary().filter(e => e && !e.deleted);
    // An empty library exported as "[]" — a file that imports as nothing.
    if (!corrupt && !lib.length) { alert(S.routeLibraryExportEmpty || 'No saved routes to export yet.'); return; }
    const payload = corrupt ? NavAid.routeLibraryCorruptRaw : JSON.stringify(lib, null, 2);
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
      if (!Array.isArray(arr)) { alert(S.errNotRouteLibrary || 'That file is not a saved-routes library.'); return; }
      // Merging (fresh ids, tracks included) is shared with the toolbar Import,
      // which auto-detects a library file — one code path, one behaviour.
      const res = importRouteLibraryArray(arr);
      if (!res || !res.added) {   // file had no valid routes → nothing to write
        if (typeof showToast === 'function') showToast(S.routeLibraryImportNone || 'No valid routes in that file');
        return;
      }
      // Only claim success (render + toast) if the write actually happened — a
      // corrupt library refuses the write, so don't show a false "imported".
      if (!persistRouteLibrary(res.merged)) {
        alert(S.errRouteLibraryWriteFailed);   // never claim success on a refused write
        return;
      }
      render();
      if (typeof showToast === 'function') showToast(routeLibraryImportMessage(res));
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
        // Endpoints in the LTR meta line, derived from the route itself rather than from
        // its name. A name typed (or generated) with an arrow between a Hebrew name and a
        // Latin code reorders under bidi, so an out-and-back pair reads almost identically
        // -- "LLHZ ← צומת אשדוד" against "צומת אשדוד ← LLHZ". This line always reads
        // first-to-last, whatever the name says, and it fixes routes saved before that.
        const rw = (entry.data && entry.data.waypoints) || [];
        const endName = (w) => {
          const raw = (w && w.name) || '';
          return ((raw && typeof navName === 'function') ? navName(raw) : raw).toString().trim();
        };
        const from = endName(rw[0]), to = endName(rw[rw.length - 1]);
        // ...but only when the NAME does not already carry them, or the row says the same
        // thing twice. Auto-named routes state the direction in words; a renamed one
        // ("morning nav ex") still needs the endpoints spelled out.
        // "Already named" counts the RAW codes as well as the localised names: a route
        // called "בדיקה BAZRA DEROR" identifies its endpoints perfectly well, and
        // appending "בצרה → בני דרור" to it says the same thing a second time.
        const rawName = (w) => ((w && w.name) || '').toString().trim();
        const has = (w, disp) => {
          const r = rawName(w);
          return !!((r && entry.name.includes(r)) || (disp && entry.name.includes(disp)));
        };
        const named = from && to && entry.name &&
          has(rw[0], from) && has(rw[rw.length - 1], to);
        const ends = (from && to && !named) ? from + ' → ' + to + ' · ' : '';
        meta.textContent = ends + wpN + ' WP' + (when ? ' · ' + when : '');
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
        const json = document.createElement('button');
        json.type = 'button';
        json.textContent = S.routeLibraryExportJson || 'JSON';
        json.onclick = () => { if (typeof downloadGpsTrackJson === 'function') downloadGpsTrackJson(entry); };
        actions.append(loadBtn, rename, gpx, json, del);   // read-only track: Show/Hide + GPX + JSON
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
    // Opt-in: also mirror portable settings (layers, toggles, opacities…).
    const setLabel = document.createElement('label');
    setLabel.className = 'route-library-gdrive-settings';
    const setChk = document.createElement('input');
    setChk.type = 'checkbox';
    setChk.checked = (typeof settingsSyncEnabled === 'function' && settingsSyncEnabled());
    setChk.onchange = () => {
      if (typeof setSettingsSyncEnabled === 'function') setSettingsSyncEnabled(setChk.checked);
    };
    setLabel.append(setChk, document.createTextNode(' ' + (S.routeLibraryGdriveSyncSettings || 'Sync settings too')));
    syncBtn.onclick = () => {
      syncBtn.disabled = true;
      setStatus(S.routeLibraryGdriveSyncing || 'Syncing…');
      gdriveSync()
        .then(() => {
          render();
          if (typeof gdriveSyncSettings !== 'function') return null;
          return gdriveSyncSettings({
            // First sync only, and only for keys set differently on BOTH sides:
            // there is no correct automatic answer, and picking one silently
            // discards real settings, so ask once.
            resolveFirstConflict: keys => {
              const names = keys.map(k => k.replace(/^navaid\./, '')).join(', ');
              const msg = (S.routeLibraryGdriveFirstSyncConflict ||
                'This device and Google Drive both have settings for: {keys}.\n\n' +
                'OK = REPLACE this device\'s values with the ones from Drive.\n' +
                'Cancel = do nothing (sync again to choose).').replace('{keys}', names);
              // Both sides are destructive to SOMEBODY: keeping local overwrites the
              // other device's values in the shared file, taking remote overwrites
              // this one's. So only an explicit OK acts, and anything else — Cancel,
              // Escape, a WebView that never renders confirm() — aborts the settings
              // sync entirely rather than silently picking a side.
              if (window.confirm(msg)) return 'remote';
              const keep = S.routeLibraryGdriveKeepThisDevice ||
                'Keep THIS device\'s settings and update Google Drive?';
              return window.confirm(keep) ? 'local' : 'abort';
            },
          });
        })
        .then(res => {
          if (res && res.needsChoice) {
            setStatus(S.routeLibraryGdriveSettingsSkipped ||
              'Settings not synced — sync again to choose which device wins.');
            return;
          }
          if (res && res.applied) {
            // Settings from another device landed — reload so every boot-time
            // read (globals, toggles, layer) picks them up cleanly.
            setStatus(S.routeLibraryGdriveSettingsApplied || 'Settings updated — reloading…');
            setTimeout(() => location.reload(), 700);
            return;
          }
          setStatus(S.routeLibraryGdriveSynced || 'Synced');
        })
        .catch(err => {
          setStatus((S.routeLibraryGdriveError || 'Sync failed') +
            (err && err.message ? ': ' + err.message : ''));
        })
        .then(() => { syncBtn.disabled = false; });
    };
    gd.append(syncBtn, setLabel, status);
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
  // They are searching — the tip has done its job.
  if (!searchTipDone()) retireSearchTip();
  // Searchable sources — every named thing drawn on the map. Adding a dataset is
  // one entry here rather than another branch below. `routable` marks sources whose
  // `name` is a canonical route point, so multi-token route building can accept
  // them; everything else just flies the map to the hit.
  const src = [];
  const has = a => Array.isArray(a) && a.length;
  const hit = (s2, up) => s2 && String(s2).toUpperCase().indexOf(up) >= 0;
  const hitHe = s2 => s2 && String(s2).indexOf(lastToken) >= 0;
  if (has(vors)) src.push({                                   // VOR/DME stations
    kind: 'vor', cap: tune('searchMaxVor'), items: vors, routable: false,
    match: v => hit(v.ident, q) || hit(v.name, q) || hitHe(v.he),
  });
  if (has(airfields)) src.push({
    kind: 'af', cap: tune('searchMaxAirfields'), items: airfields, routable: true,
    match: a => hit(a.name, q) || hit(a.en, q) || hitHe(a.he),
  });
  if (has(navWP)) src.push({
    kind: 'wp', cap: tune('searchMaxNavWp'), items: navWP, routable: true,
    match: w => hit(w.name, q) || hit(w.en, q) || hitHe(w.he),
  });
  if (typeof areas !== 'undefined' && has(areas) &&
      typeof showLsaBubbles !== 'undefined' && showLsaBubbles) src.push({  // LSA bubbles (searchable by code or name; gated on the toggle like the map click, or search selects an unpainted polygon)
    kind: 'bubble', cap: tune('searchMaxBubbles'),
    items: areas.map((a, i) => ({ ...a, _areaIndex: i })), routable: false,
    match: a => hit(a.icao, q) || hit(a.en, q) || hit(a.name, q) || hitHe(a.he) || hitHe(a.name),
  });
  if (has(state.waypoints)) src.push({                        // the user's own route
    kind: 'routewp', cap: tune('searchMaxRouteWp'), items: state.waypoints, routable: false,
    match: w => hit(w.name, q) || hitHe(w.he),
  });
  if (has(state.notes)) src.push({                            // notes placed on the map
    kind: 'note', cap: tune('searchMaxNotes'),
    items: state.notes.filter(n => n && (n.text || n.cc)), routable: false,
    match: n => hit(n.text, q) || hit(n.cc, q) || hitHe(n.text),
  });
  if (has(notams)) src.push({                                 // active NOTAMs (this chart)
    // Not gated on the overlay toggle: the list button isn't either, and picking a
    // mappable hit turns the overlay on, same as clicking it in the list.
    kind: 'notam', cap: tune('searchMaxNotams'),
    items: (typeof activeNotams === 'function') ? activeNotams() : [], routable: false,
    match: n => hit(n.id, q) || hit(n.icao, q) || hit(n.text, q),
  });
  // #124: split the 12 slots across sources so one broad match cannot fill them all.
  const hits = [];
  const perSource = [];
  for (const so of src) perSource.push(so.items.filter(so.match).map(e => ({ kind: so.kind, entry: e, src: so })));
  let budget = tune('searchMaxResults');
  for (let i = 0; i < perSource.length && budget > 0; i++) {
    const take = Math.min(perSource[i].length, src[i].cap, budget);
    hits.push(...perSource[i].slice(0, take));
    budget -= take;
  }
  if (!hits.length) { closeSearch(); return; }
  wpResults.innerHTML = '';
  const wpField = S.navWpSearchField;
  const afField = S.airfieldLabelField;
  for (const h of hits) {
    const w = h.entry;
    const item = document.createElement('div');
    item.className = 'wp-search-item';
    let primary, alt;
    if (h.kind === 'routewp') {
      primary = w.name || (S.wpLabel || 'WP');
      alt = S.searchKindRouteWp || 'on your route';
    } else if (h.kind === 'note') {
      primary = (w.text || w.cc || '').slice(0, tune('searchNoteLabelChars'));
      alt = S.searchKindNote || 'note';
    } else if (h.kind === 'vor') {
      // "ZFR — Zofar · 115.60" so the ident, the name and the frequency to tune are
      // all visible without opening anything.
      primary = w.ident;
      const nm = (wpField === 'he' && w.he) ? w.he : w.name;
      const bits = [];
      if (nm) bits.push(nm);
      if (w.freq && !w.dmeOnly) bits.push(w.freq);
      if (w.ch) bits.push('CH ' + w.ch);
      if (w.type) bits.push(w.type);
      if (w.coverageNm) bits.push(w.coverageNm + ' NM');
      alt = bits.join(' \u00b7 ');
    } else if (h.kind === 'bubble') {
      primary = w.icao || areaLabel(w);
      const bits = [];
      const nm = areaLabel(w);
      if (nm && nm !== primary) bits.push(nm);
      if (Number.isFinite(w.lowFt) && Number.isFinite(w.highFt)) bits.push(w.lowFt + '-' + w.highFt + ' ' + (S.unitFeet || 'ft'));
      if (w.active === 'weekend') bits.push(S.bubbleWeekendTag || 'weekend');
      alt = bits.join(' \u00b7 ');
    } else if (h.kind === 'notam') {
      // "C1584/26 / LLBG · RWY 12/30 CLSD" -- the id, the field when it names one,
      // and the head of the text, truncated like the note labels are.
      primary = w.id;
      const bits = [];
      const ic = String(w.icao || '').toUpperCase();
      if (ic && ic !== 'LLLL') bits.push(ic);
      if (w.text) bits.push(String(w.text).slice(0, tune('searchNoteLabelChars')));
      alt = bits.join(' · ');
    } else if (h.kind === 'af') {
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
      if (h.kind === 'notam') {
        closeSearch();
        if (typeof notamMappable === 'function' && notamMappable(w)) {
          // Same contract as clicking it in the list: overlay on if needed, then blink.
          if (!window.showNotam) {
            window.showNotam = true;
            if (typeof notamPrefWrite === 'function') notamPrefWrite(true);
            if (notamCb) notamCb.checked = true;
          }
          if (typeof flashNotam === 'function') flashNotam(w.id);
          draw();
        } else if (typeof showNotamModal === 'function') {
          showNotamModal([w]);           // no map presence -- show the text instead
        }
        return;
      }
      if (h.kind === 'bubble') {
        // Fly to the bubble, select it and open its inspector -- a polygon has no single
        // point, so the centroid is where the ring lands.
        const c = areaCentroid(w.coords);
        map.setView([c.lat, c.lng], Math.max(map.getZoom(), 10));
        flashMapPoint(c.lat, c.lng);
        state.selected = { type: 'lsaArea', index: w._areaIndex };
        if (typeof showInspector === 'function') showInspector();
        draw();
        closeSearch();
        return;
      }
      if (multi && !h.src.routable) {
        // Route building works on named route points; a station is a place to look
        // at, so just fly the map there and leave the typed route untouched.
        map.setView([w.lat, w.lng], Math.max(map.getZoom(), 12));
        flashMapPoint(w.lat, w.lng);
        closeSearch();
        return;
      }
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
      flashMapPoint(w.lat, w.lng);
      wpSearch.value = primary;
      closeSearch();
    };
    wpResults.appendChild(item);
  }
  wpResults.classList.remove('hidden');
  syncSearchResultsStacking();
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
    // Route through escapeSearch, not straight to hide: docked, the first
    // Escape clears the query and only a second one puts the panel away.
    // Stop it here — the document-level handler runs the same function, and
    // letting it bubble applied both steps to one keypress.
    e.stopPropagation();
    escapeSearch();
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
  // The VOR dataset is lazy-loaded with its map layer, so a search opened before
  // that layer was ever shown would silently have no stations to match. Pull it in
  // and re-run once, so typing ZOFAR works on a cold start.
  if (typeof vors === 'undefined' || !vors) {
    if (typeof loadVors === 'function') {
      Promise.resolve(loadVors())
        .then(() => { if (!searchOverlay.classList.contains('hidden') && wpSearch.value.trim()) runSearch(); })
        .catch(() => {});
    }
  }
}
function hideSearchOverlay() {
  searchOverlay.classList.add('hidden');
  closeSearch();
  wpSearch.value = '';
  // Docked, dismissal is a preference rather than a one-off: the panel is part
  // of the desktop furniture, so whether it is up must survive a reload.
  if (searchDocked()) setSearchDockShown(false);
}
// Escape while docked clears the query first and only dismisses the panel on a
// second press with nothing left to clear — so the common case (wrong search
// term) does not cost the panel.
function escapeSearch() {
  if (searchDocked() && wpSearch.value) {
    closeSearch();
    wpSearch.value = '';
    return;
  }
  hideSearchOverlay();
}
document.getElementById('search-trigger').onclick = revealSearchOverlay;
document.getElementById('search-close').onclick = hideSearchOverlay;

// Ctrl/Cmd-F and the toolbar button always bring the panel up and put the caret
// in it — never dismiss it, since Ctrl-F pressed while already in the search box
// means "search", not "put the search away". Dismissal is the ✕, or Escape with
// nothing left to clear. Docked, whether it is up is remembered under
// navaid.searchShown; mobile keeps its summoned overlay.
const SEARCH_SHOWN_KEY = 'navaid.searchShown';
function searchDockShown() {
  try { return lsGet(SEARCH_SHOWN_KEY) !== '0'; } catch (e) { return true; }
}
function setSearchDockShown(on) {
  try {
    if (on) localStorage.removeItem(SEARCH_SHOWN_KEY);
    else localStorage.setItem(SEARCH_SHOWN_KEY, '0');
  } catch (e) { /* storage unavailable */ }
}
function revealSearchOverlay() {
  if (searchDocked()) setSearchDockShown(true);
  showSearchOverlay();
}

// Desktop keeps the search on screen permanently, parked under the menu bar on
// the side the language reads from and draggable anywhere from there. Mobile has
// no room for a standing panel, so it stays the summoned overlay.
const SEARCH_DOCK_MQ = window.matchMedia('(min-width: 681px)');
const SEARCH_POS_KEY = 'navaid.searchPos';
function searchDocked() { return searchOverlay.classList.contains('docked'); }
(function dockSearchOnDesktop() {
  const box = searchOverlay;
  // Read once and keep it: the only thing that changes this is the pilot dragging
  // the panel (see the drag-end below). It used to be re-read, with a JSON.parse,
  // on every toolbar resize via the ResizeObserver.
  const readSavedPos = () => {
    try {
      const p = JSON.parse(navLangPosRead(SEARCH_POS_KEY) || 'null');
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    } catch (e) { return null; }
  };
  let savedPosCache = readSavedPos();
  const savedPos = () => savedPosCache;
  // Same rule as the legend: never come to rest ON the menu bar, but above and
  // below are both fine, so a panel dragged down can be dragged back up.
  function clearOfToolbar(x, y) {
    const tb = document.getElementById('toolbar');
    if (!tb) return y;
    const t = tb.getBoundingClientRect();
    if (!t.height) return y;
    const w = box.offsetWidth, h = box.offsetHeight;
    if (x + w < t.left || x > t.right) return y;
    if (y + h < t.top || y > t.bottom) return y;
    return t.bottom + 6;
  }
  function applyPos(x, y) {
    const maxX = Math.max(0, window.innerWidth - box.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - box.offsetHeight);
    const cx = Math.max(0, Math.min(maxX, x));
    box.style.left = cx + 'px';
    box.style.top = Math.max(0, Math.min(maxY, clearOfToolbar(cx, y))) + 'px';
    box.style.right = 'auto';
    box.style.transform = 'none';
  }
  function clearInlinePos() {
    box.style.left = '';
    box.style.top = '';
    box.style.right = '';
    box.style.transform = '';
  }
  // The CSS parks it at top:46px, which is right only while the menu bar is one
  // row tall. It wraps to two on narrower desktops, so the default sits under
  // whatever height the bar actually has.
  function parkBelowToolbar() {
    const tb = document.getElementById('toolbar');
    const t = tb && tb.getBoundingClientRect();
    if (!t || !t.height) return;
    box.style.top = Math.round(t.bottom + 6) + 'px';
  }
  function sync() {
    if (SEARCH_DOCK_MQ.matches) {
      box.classList.add('docked');
      // Shown by default; only a deliberate dismissal keeps it down.
      box.classList.toggle('hidden', !searchDockShown());
      const p = savedPos();
      if (p) applyPos(p.x, p.y); else { clearInlinePos(); parkBelowToolbar(); }
    } else {
      // Back to a phone-width viewport: drop the docked geometry so the overlay
      // returns to its centred, summoned form rather than a stranded panel.
      box.classList.remove('docked');
      box.classList.add('hidden');
      clearInlinePos();
    }
  }
  // A dragged-to position is only meaningful at the width it was chosen at, and
  // the side default flips with the language, so re-clamp on resize.
  const onResize = () => {
    // Don't trust the mediaquery `change` event alone to flip the dock: some
    // viewport resizes (devtools/CDP among them) arrive without it, which left
    // a docked panel stranded at phone width. Reconcile on every resize.
    if (SEARCH_DOCK_MQ.matches !== searchDocked()) { sync(); return; }
    if (!searchDocked()) return;
    const p = savedPos();
    if (p) applyPos(p.x, p.y); else { clearInlinePos(); parkBelowToolbar(); }
  };
  if (SEARCH_DOCK_MQ.addEventListener) SEARCH_DOCK_MQ.addEventListener('change', sync);
  else if (SEARCH_DOCK_MQ.addListener) SEARCH_DOCK_MQ.addListener(sync);
  window.addEventListener('resize', onResize);
  // The bar's height is not settled at boot and changes later anyway — it wraps
  // to a second row on narrower desktops and when a section is expanded. Sampling
  // it once parked the panel under a one-row bar that then grew over it, so track
  // it for as long as the panel is using the default position.
  if (window.ResizeObserver) {
    const tb = document.getElementById('toolbar');
    if (tb) new ResizeObserver(() => { if (searchDocked() && !savedPos()) parkBelowToolbar(); }).observe(tb);
  }

  // Drag from the panel's own chrome only — the input, the results list and the
  // buttons keep their normal behaviour, or the search would be untypeable.
  const isDragSurface = t => t === box || (t && t.classList && t.classList.contains('search-hint'));
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
      savedPosCache = { x: r2.left, y: r2.top };
      try { localStorage.setItem(navLangPosKey(SEARCH_POS_KEY), JSON.stringify(savedPosCache)); }
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
  box.addEventListener('mousedown', e => {
    if (!searchDocked() || !isDragSurface(e.target)) return;
    e.preventDefault();
    start(e.clientX, e.clientY);
  });
  box.addEventListener('touchstart', e => {
    if (!searchDocked() || e.touches.length !== 1 || !isDragSurface(e.target)) return;
    e.preventDefault();
    start(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  sync();
  applySearchTipState();
})();

// Reference-link overflow (⋯). The six links behind it are read once; keeping them
// inline cost the menu bar more width than the flight plan itself and forced the
// desktop bar onto a second row.
(function wireFooterMore() {
  const btn = document.getElementById('footer-more-btn');
  const menu = document.getElementById('footer-more-menu');
  if (!btn || !menu) return;
  const setOpen = open => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  btn.onclick = e => {
    e.stopPropagation();
    setOpen(menu.hidden);
  };
  // Any click elsewhere, or Escape, closes it — same dismissal rules as the
  // toolbar dropdowns, so nothing is left hanging over the map.
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) setOpen(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) setOpen(false); });
  menu.addEventListener('click', () => setOpen(false));
})();

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
    revealSearchOverlay();
  } else if (e.key === 'Escape' && !searchOverlay.classList.contains('hidden') &&
             // Docked, the panel is always on screen, so Escape must only mean
             // "clear the search" when the search is what the user is in — else
             // it would swallow the key from every other Escape-driven action.
             (!searchDocked() || document.activeElement === wpSearch || wpSearch.value)) {
    escapeSearch();
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
  // Freq-change callouts default to the side opposite the nav kites, which
  // depends on travel direction — so before reversing, note which callouts are
  // still on their (pre-reverse) default tail; those get re-defaulted after the
  // reversal so they flip with the route. User-dragged callouts are left put.
  const commOnDefault = new Set();
  if (typeof commCalloutTarget === 'function' && typeof commCalloutDefaultTail === 'function') {
    for (const n of state.notes) {
      if (!n || !n.cc) continue;
      const wp = commCalloutTarget(n);
      const idx = wp ? state.waypoints.indexOf(wp) : -1;
      if (idx < 0) continue;
      const def = commCalloutDefaultTail(wp, idx);
      if (Math.abs(n.lat - def.lat) < 1e-4 && Math.abs(n.lng - def.lng) < 1e-4) commOnDefault.add(n);
    }
  }
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
      // Same argument for the two per-leg choices added since: the reference VOR the
      // leg's Radial/DME is measured from, and whether its nav kite is hidden. Both
      // belong to the physical segment, not to the direction of travel. Dropping
      // vorRef silently moved that leg's published Radial/DME back to the GLOBAL VOR;
      // dropping hideKite made a deliberately decluttered leg redraw its kite.
      ...(l.vorRef ? { vorRef: l.vorRef } : {}),
      ...(l.hideKite ? { hideKite: 1 } : {}),
      ...(l.showKite ? { showKite: 1 } : {}),
      ...(l.hideDrift ? { hideDrift: 1 } : {}),
      ...(l.showDrift ? { showDrift: 1 } : {}),
      // Reversing is not a speed edit, so the pins travel -- but they travel WITH the
      // speeds, which swap above when the return path is shown. With it hidden both
      // directions take the forward speed, so both take the forward pin.
      ...((showReturn ? l._legSpeedAutoRet : l._legSpeedAuto) ? { _legSpeedAuto: 1 } : {}),
      ...(l._legSpeedAuto ? { _legSpeedAutoRet: 1 } : {}),
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
  // Identification-point ovals are anchored to (leg, t); reversing flips both
  // so the oval stays on the same geographic spot instead of jumping to the
  // mirrored end. new leg = (M-1) - leg; new t = 1 - t.
  const legCount = state.legs.length;
  for (const n of state.notes) {
    if (n && n.rp && Number.isInteger(n.rp.leg)) {
      n.rp.leg = (legCount - 1) - n.rp.leg;
      n.rp.t = 1 - (Number.isFinite(n.rp.t) ? n.rp.t : 0.5);
    }
  }
  // Re-default the freq-change callouts that were on their default tail so they
  // flip to the far side of the now-reversed legs (see snapshot above).
  if (commOnDefault.size && typeof commCalloutTarget === 'function') {
    for (const n of commOnDefault) {
      const wp = commCalloutTarget(n);
      const idx = wp ? state.waypoints.indexOf(wp) : -1;
      if (idx < 0) continue;
      const def = commCalloutDefaultTail(wp, idx);
      n.lat = def.lat; n.lng = def.lng;
    }
  }
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
  else if (v === 'json-track') {
    const shown = (typeof shownTracks !== 'undefined') ? shownTracks : [];
    if (!shown.length) { alert(S.tbTrackExportNoTrack || 'No GPS track shown — open Saved routes and click Show on a track first.'); return; }
    const pick = shown[shown.length - 1];
    const entry = (typeof loadRouteLibrary === 'function' ? loadRouteLibrary() : []).find(e => e.id === pick.id);
    // A missing entry means the library could not be read (corrupt blob) or the
    // track is gone. Falling through silently looked identical to a successful
    // export: the picker reset and no file appeared.
    if (!entry || typeof downloadGpsTrackJson !== 'function') {
      alert(S.errTrackExportFailed || 'That track could not be read from your saved routes.');
      return;
    }
    // With several tracks shown, "the last one shown" is not something the user can
    // see — name it before writing the file.
    if (shown.length > 1) {
      const name = entry.name || pick.name || '';
      const ask = S.trackExportConfirm ? S.trackExportConfirm(name) : ('Export the track "' + name + '"?');
      if (!confirm(ask)) return;
    }
    downloadGpsTrackJson(entry);
  }
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
    const p = JSON.parse(navLangPosRead(INSP_POS_KEY) || 'null');
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
      try { localStorage.setItem(navLangPosKey(INSP_POS_KEY), JSON.stringify({ x: r2.left, y: r2.top })); }
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
const openFlightPlan = () => {
  if (typeof window.closeToolbarMenus === 'function') window.closeToolbarMenus();
  showFlightPlan();
};
document.getElementById('plan').onclick = openFlightPlan;
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
  const sr = lsGet(RETURN_KEY);
  if (sr !== null) window.showReturn =sr === '1';
  const sm = lsGet(MIDLEG_KEY);
  if (sm !== null) window.showMidLeg =sm === '1';
  const sc = lsGet(CUMTIME_KEY);
  if (sc !== null) window.showCumTime = sc === '1';
  const slk = lsGet(LIMIT_KITES_KEY);
  if (slk !== null) window.limitLegKites = slk === '1';
  const su = lsGet(SIM_URL_KEY);
  if (su) window.simUrl = su;
  const son = lsGet(SIM_ON_KEY);
  if (son !== null) window.simOn = son === '1';
  const sf = lsGet(SIM_FOLLOW_KEY);
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
  try { _savedOn = lsGet('navaid.simOn') === '1'; } catch (e) { /* */ }
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
  // This panel is hand-rolled rather than built by createDraggableModal, and its
  // markup declares role="dialog" aria-modal="true" -- a promise it was not keeping:
  // focus stayed on the plane icon behind it, Tab walked the page underneath, and
  // closing left focus nowhere. Same treatment the factory dialogs get.
  const box = modal.querySelector('.modal') || modal;
  let prevFocus = null;
  const focusables = () => [...box.querySelectorAll(
    'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  const onTrapTab = e => {
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const open = () => {
    if (typeof closeToolbarDesktopMenus === 'function') closeToolbarDesktopMenus();
    modal.classList.remove('hidden');
    prevFocus = document.activeElement;
    box.addEventListener('keydown', onTrapTab);
    const firstStop = closeBtn || focusables()[0];
    if (firstStop) { try { firstStop.focus(); } catch (e) { /* */ } }
  };
  const close = () => {
    modal.classList.add('hidden');
    box.removeEventListener('keydown', onTrapTab);
    const el = prevFocus;
    prevFocus = null;
    if (el && document.contains(el)) { try { el.focus(); } catch (e) { /* */ } }
  };
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
  const sn = lsGet(WPNAME_KEY);
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
  const sd = lsGet(DIFF_KEY);
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
  const sd = lsGet(DRIFT_KEY);
  if (sd !== null) window.showDrift =sd === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('drift-cb').checked = showDrift;
document.getElementById('drift-cb').onchange = e => {
  window.showDrift =e.target.checked;
  try { localStorage.setItem(DRIFT_KEY, showDrift ? '1' : '0'); } catch (err) { /* */ }
  draw();
};
const AUTOROUTE_KEY = 'navaid.autoRoute';
try {
  const ar = lsGet(AUTOROUTE_KEY);
  if (ar !== null) window.autoRouteCorridors = ar === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('autoroute-cb').checked = autoRouteCorridors;
document.getElementById('autoroute-cb').onchange = e => {
  window.autoRouteCorridors = e.target.checked;
  try { localStorage.setItem(AUTOROUTE_KEY, autoRouteCorridors ? '1' : '0'); } catch (err) { /* */ }
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
  const stored = lsGet(NAVWP_KEY);
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
  const stored = lsGet(REPORTING_KEY);
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
  const stored = lsGet(MSA_KEY);
  if (stored !== null) window.showMsa = stored === '1';
} catch (e) { /* storage unavailable */ }
const msaCb = document.getElementById('msa-cb');
if (msaCb) {
  msaCb.checked = !!window.showMsa;
  msaCb.onchange = e => {
    window.showMsa = e.target.checked;
    try { localStorage.setItem(MSA_KEY, window.showMsa ? '1' : '0'); }
    catch (err) { /* storage unavailable */ }
    refreshInspectorIfVisible();   // rebuild so the MSA row appears/clears
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
  const stored = lsGet(WIND_KEY);
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
  let enableGen = 0;            // bumped on every toggle: a request belongs to one switch-on
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
    // Outside the try: this request's identity, which the catch below also has to check.
    // The LEVEL alone is not enough. Off then on at the SAME altitude leaves an obsolete
    // request whose level still matches, so its failure untoggled the control the pilot had
    // just re-enabled and `finally` then dropped the queued retry (`cb.checked` was false by
    // then) -- one request, box off, "unavailable", nothing retrying. The enable lifetime is
    // the missing half: a request belongs to the switch-on that started it.
    const lv = level();
    const gen = enableGen;
    const mine = () => gen === enableGen && lv === level();
    try {
      const g = gridPoints();
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
      // The altitude may have moved while this was in flight, and the queue that normally
      // catches that has a hole: the altitude handler returns early when the box is off, and
      // the enable handler starts nothing while busy. So off -> change altitude -> back on
      // (all before this settles) used to COMMIT the old level's data and render it under
      // the new altitude label, with nothing left to correct it. The captured level is the
      // request's identity: if it is no longer the selected one, this response is not ours.
      if (!mine()) { if (cb.checked) refetchPending = true; return; }
      store = { g, times, sp, di, baseIdx: nearestHourIndex(times) };
      if (timeSlider) { timeSlider.value = '0'; }
      // The fetch is async — if the user turned the field off meanwhile, cache
      // the data but don't add an orphan layer.
      if (!cb.checked) { if (statusEl) { statusEl.classList.remove('windfield-loading'); statusEl.style.display = 'none'; } return; }
      if (statusEl) { statusEl.classList.remove('windfield-loading'); statusEl.style.display = 'none'; }
      applyTimeLabel();
      applyRotationState();   // builds the field north-up, or shows the rotated-map note
    } catch (e) {
      // A SUPERSEDED request's failure is not this field's failure: letting it report would
      // untoggle a field the pilot has just re-enabled at another altitude, and hide the
      // controls under it. Leave the live request to speak for itself.
      if (!mine()) { if (cb.checked) refetchPending = true; return; }
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

  // leaflet-velocity scales particle speed by mapArea^0.4, where mapArea comes from
  // map.getBounds() -- the SW/NE corners. On a rotated map that box is the axis-aligned
  // bounding box of a rotated viewport, so it grows with the bearing even though the visible
  // area has not changed: measured on this map, 0.1216 deg² at 0°, 0.2814 at 45°, back to
  // 0.1216 at 90°. That is a 1.40x speed factor at 45°, i.e. the particles animate ~40% too
  // fast at intermediate bearings and correctly at the right angles. Direction and position
  // are unaffected, and the colour ramp reads real m/s from the data, so nothing a pilot
  // reads is wrong -- but the animation lies about how hard the wind is blowing.
  //
  // Patched here rather than by vendoring the library: it is one method, and the CDN copy
  // stays pinned with its SRI hash. _startWindy is what hands the extent over, so an
  // override with a bearing-independent extent is the whole fix.
  let velocityPatched = false;
  function patchVelocityScale() {
    if (velocityPatched) return;
    const proto = (typeof L !== 'undefined' && L.VelocityLayer && L.VelocityLayer.prototype) || null;
    if (!proto || typeof proto._startWindy !== 'function') return;   // library shape changed
    proto._startWindy = function () {
      const map = this._map;
      const size = map.getSize();
      const zoom = map.getZoom();
      // The viewport as if UNROTATED: project/unproject are CRS-level and carry no bearing,
      // so a box built in projected pixels around the centre has the same geographic size at
      // every bearing. Taking spans along the screen axes instead does NOT work -- at 90° the
      // screen x-axis runs north-south, the lng span collapses to ~0, and the particles stop
      // (measured: screen magnitude 12.66 at 0° against 0.01 at 90°).
      const c = map.project(map.getCenter(), zoom);
      const sw = map.unproject(c.add(L.point(-size.x / 2, size.y / 2)), zoom);
      const ne = map.unproject(c.add(L.point(size.x / 2, -size.y / 2)), zoom);
      this._windy.start(
        [[0, 0], [size.x, size.y]], size.x, size.y,
        [[sw.lng, sw.lat], [ne.lng, ne.lat]]);
    };
    velocityPatched = true;
  }

  // Create (or recreate) the velocity layer from the current store + bearing.
  function buildLayer() {
    if (!store) return;
    patchVelocityScale();
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

  // The field follows map rotation, and the reason it used not to is worth recording,
  // because the previous fix here was to refuse to draw it at all above 0° bearing.
  //
  // leaflet-velocity's maths IS rotation-aware: it inverts each screen pixel with
  // map.containerPointToLatLng and builds its u/v -> screen Jacobian by calling
  // map.latLngToContainerPoint, both of which account for bearing under leaflet-rotate.
  // What it lacks is a REBUILD trigger: its getEvents() covers resize and moveend, plus
  // dragend/zoomstart/zoomend, and nothing for rotate -- those events postdate the library.
  // So after a rotation the field kept the columns it computed at the old bearing: stale,
  // not misplaced. Measured at bearing 90 with a uniform 270° wind, the field still pushed
  // particles +x on screen; after a restart it pushed +y, i.e. it had rotated with the map.
  //
  // (The two-corner viewport box the library derives is genuinely wrong at a bearing, but it
  // only feeds mapArea -> velocityScale, i.e. particle SPEED. Coverage and direction are
  // unaffected, so it is not what broke this.)
  function restartField() {
    if (!layer) return;
    if (typeof layer._clearAndRestart === 'function') { layer._clearAndRestart(); return; }
    // Older/other builds of the library: rebuild the layer outright.
    removeLayer();
    buildLayer();
    applyTimeLabel();
  }
  function applyRotationState() {
    if (!cb.checked || !store) return;
    if (!layer) {
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
  // Debounced, and bound to BOTH events: 'rotate' fires continuously through a dial drag
  // (rebuilding the particle field per frame would stall the map), while a programmatic
  // map.setBearing() fires 'rotate' and NO 'rotateend' at all -- so listening only for the
  // end event misses every rotation that does not come from the dial.
  let rotSettle = null;
  function onRotateSettle() {
    if (!cb.checked || !layer) return;
    clearTimeout(rotSettle);
    rotSettle = setTimeout(restartField, 150);
  }
  map.on('moveend', onWindViewChange);
  map.on('zoomend', onWindViewChange);
  map.on('rotate', onRotateSettle);
  map.on('rotateend', onRotateSettle);

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
    try { saved = lsGet(OPACITY_KEY); } catch (e) { /* */ }
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
    try { saved = lsGet(ALT_KEY); } catch (e) { /* */ }
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

  try { if (lsGet(KEY) === '1') cb.checked = true; } catch (e) { /* */ }
  showControls(cb.checked);
  cb.onchange = () => {
    enableGen++;                // this switch-on (or off) supersedes any request in flight
    try { localStorage.setItem(KEY, cb.checked ? '1' : '0'); } catch (e) { /* */ }
    showControls(cb.checked);
    // Auto-fetch on enable; addLayer() shows a "Loading wind…" banner while the
    // (slow) grid request is in flight.
    // Re-enabling while an older request is still in flight has to QUEUE, not no-op: the
    // altitude may have changed while the box was off, and that handler deliberately does
    // nothing when it is off. Without this, whatever the old request returns is what gets
    // rendered, however stale the level.
    if (cb.checked) { if (busy) refetchPending = true; else addLayer(); } else removeLayer();
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
// Whether the overlay is on is remembered PER CHART: the NOTAM feed is FIR-wide
// (one LLLL source, no per-chart split available in it), but what you want on
// screen is not. CVFR cross-country wants the airspace NOTAMs up; an LSA or
// helicopter chart is usually flown with them off, and one shared flag meant
// switching charts carried the other chart's choice over. Keyed off
// layerDataPrefix() so it follows the same cvfr/lsa/heli split as the waypoint,
// comm-change and leg-altitude datasets — including the "Nav waypoints from"
// override, so a chart-less base map follows whatever data it is showing.
const NOTAM_KEY = 'navaid.showNotam';
function notamPrefKey() {
  const pfx = (typeof layerDataPrefix === 'function') ? layerDataPrefix() : 'cvfr';
  return NOTAM_KEY + '.' + pfx;
}
// A chart the pilot has never set INHERITS the choice they last made elsewhere,
// rather than defaulting to off. Defaulting to off made NOTAMs vanish on the first
// switch to another chart — including the ultralight-bubble NOTAMs, which matter
// most on the LSA chart they disappeared from. Charts only diverge once the pilot
// actually toggles one. A pre-split preference is adopted the same way, with the
// legacy key left for the other charts (as navLangPosRead does for positions).
const NOTAM_LAST_KEY = NOTAM_KEY + '.last';
function notamPrefRead() {
  try {
    const scoped = lsGet(notamPrefKey());
    if (scoped !== null) return scoped === '1';
    const inherited = lsGet(NOTAM_KEY) !== null
      ? lsGet(NOTAM_KEY)
      : lsGet(NOTAM_LAST_KEY);
    if (inherited === null) return null;
    localStorage.setItem(notamPrefKey(), inherited);
    return inherited === '1';
  } catch (e) { return null; }   // storage unavailable
}
function notamPrefWrite(on) {
  try {
    localStorage.setItem(notamPrefKey(), on ? '1' : '0');
    // What an untouched chart inherits next.
    localStorage.setItem(NOTAM_LAST_KEY, on ? '1' : '0');
  } catch (e) { /* storage unavailable */ }
}
{
  const pref = notamPrefRead();
  if (pref !== null) window.showNotam = pref;
}
const notamCb = document.getElementById('notam-cb');
const notamListBtn = document.getElementById('notam-list-btn');
const notamControls = document.getElementById('notam-controls');
const notamTimeEl = document.getElementById('notam-time');
const notamTimeVal = document.getElementById('notam-time-val');
const notamUpdatedEl = document.getElementById('notam-updated');
function refreshNotamListBtn() {
  const have = Array.isArray(notams) && notams.length;
  // The list is chart-filtered, so the BUTTON follows what this chart can show —
  // gating it on the whole feed offered an empty list. `have` stays feed-presence:
  // it also drives the toggle's disabled state, and tying that to the filtered
  // count would let the timeline slider disable (and uncheck) the overlay.
  const shownHere = (typeof activeNotams === 'function') ? activeNotams() : [];
  if (notamListBtn) notamListBtn.hidden = !(have && shownHere.length);
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
      if (notamPrefRead() === true) { notamCb.checked = true; window.showNotam = true; }
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
  let filterText = '';
  const codes = Array.from(new Set(
    shown.map(n => String(n.icao || '').toUpperCase()).filter(Boolean)));
  const list = document.createElement('div');
  list.className = 'notam-list';
  // Freetext match: id, ICAO, raw and decoded text -- whichever the pilot is
  // reading. Decoded once per NOTAM, cached; the filter runs per keystroke.
  const notamHay = (n) => {
    if (!n._hay) {
      const dec = (typeof decodeNotam === 'function') ? decodeNotam(n) : '';
      n._hay = (n.id + ' ' + (n.icao || '') + ' ' + (n.text || '') + ' ' + dec).toUpperCase();
    }
    return n._hay;
  };
  const renderList = () => {
    list.textContent = '';
    const q = filterText.trim().toUpperCase();
    const subset = shown.filter(n =>
      (!filterIcao || String(n.icao || '').toUpperCase() === filterIcao) &&
      (!q || notamHay(n).indexOf(q) !== -1));
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
            // Per-chart key, not the bare legacy one: writing NOTAM_KEY here left
            // the choice where this chart never reads it (so it reverted on
            // reload) while planting a legacy value every OTHER chart then
            // inherited. See notamPrefKey / notamPrefWrite.
            notamPrefWrite(true);
            if (notamCb) notamCb.checked = true;
          }
          dismiss();
          if (typeof flashNotam === 'function') flashNotam(n.id);
        };
      }
      list.appendChild(it);
    }
  };
  if (shown.length > 1) {
    // Freetext search sits with the airfield dropdown; it renders even for a
    // single-airfield feed (the dropdown alone used to gate the whole row) --
    // but not for a single-NOTAM view (a map click), where there is nothing
    // to narrow.
    const fw = document.createElement('div');
    fw.className = 'notam-filter';
    const find = document.createElement('input');
    find.type = 'search';
    find.className = 'notam-find'; find.dir = 'auto';
    find.placeholder = S.notamSearchPh || 'Search NOTAM text…';
    find.setAttribute('aria-label', find.placeholder);
    find.addEventListener('input', () => { filterText = find.value; renderList(); });
    fw.appendChild(find);
    if (codes.length > 1) {
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
    }
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
    notamPrefWrite(window.showNotam);
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

// ── Overlay alignment: local bound overrides + rect/rotated rendering ─────────
// Extra-layer chart overlays are placed by lat/long in airfields.json. The
// align editor lets a user nudge/scale/rotate one by eye; the result is stored
// as a per-PNG override in localStorage (merged over the shipped bounds here)
// and can be exported to bake into airfields.json via PR.
const OVERLAY_OVERRIDES_KEY = 'navaid.overlayBoundsOverrides';

function overlayOverrides() {
  try { return JSON.parse(lsGet(OVERLAY_OVERRIDES_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveOverlayOverride(png, geom) {
  const all = overlayOverrides();
  if (geom) all[png] = geom; else delete all[png];
  if (Object.keys(all).length) {
    localStorage.setItem(OVERLAY_OVERRIDES_KEY, JSON.stringify(all));
  } else {
    localStorage.removeItem(OVERLAY_OVERRIDES_KEY);
  }
}
// Effective geometry for an overlay: a stored override wins over airfields.json.
// Returns { rot:false, sw, ne } (axis-aligned) or { rot:true, tl, tr, bl }.
function overlayGeom(ov) {
  const o = overlayOverrides()[ov.png];
  if (o && o.tl && o.tr && o.bl) return { rot: true, tl: o.tl, tr: o.tr, bl: o.bl };
  if (o && o.sw && o.ne)         return { rot: false, sw: o.sw, ne: o.ne };
  // base airfields.json geometry — rotated (3-corner) or axis-aligned (sw/ne)
  if (ov.tl && ov.tr && ov.bl)   return { rot: true, tl: ov.tl, tr: ov.tr, bl: ov.bl };
  return { rot: false, sw: ov.sw, ne: ov.ne };
}
// Build the Leaflet layer for one overlay (axis-aligned or rotated), tagged so
// the align editor can find/select it.
function buildOverlayLayer(base, ov, ver, type) {
  const url = base + encodeURIComponent(ov.png) + '?v=' + ver;
  const g = overlayGeom(ov);
  const opts = { opacity: plateOpacity, interactive: false, pane: 'overlayPane' };
  const layer = g.rot
    ? L.imageOverlay.rotated(url, g.tl, g.tr, g.bl, opts)
    : L.imageOverlay(url, [g.sw, g.ne], opts);
  layer._ovPng = ov.png;
  layer._ovType = type;
  layer._ovUrl = url;
  layer._ovData = ov;
  return layer;
}

// ── Circuit overlay ──────────────────────────────────────────────────────────
const CIRCUIT_SHOW_KEY    = 'navaid.showCircuit';
// Storage can THROW, not just return null: with site data blocked (Safari private mode,
// Chrome's "block third-party cookies and site data") every localStorage access raises
// SecurityError. The overlay-toggle reads below run at module scope, so one throw aborted the
// rest of this file -- ~3480 lines: every overlay toggle, the plate wiring, the toolbar
// persistence and the tuning panel -- while the map still rendered, so the app looked alive
// and simply had no controls. Every other read in this file was already wrapped; these were
// the ones that were not.
function lsGet(key) {
  // eslint-disable-next-line no-restricted-globals -- the one place that must touch the API
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function lsNum(key, fallback) {
  const v = parseFloat(lsGet(key));
  return isNaN(v) ? fallback : v;
}
const CIRCUIT_OPACITY_KEY = 'navaid.circuitOpacity';
const CIRCUIT_DEFAULT_OPACITY = 0.6;

window.showCircuit = lsGet(CIRCUIT_SHOW_KEY) === '1';
window.circuitLayerGroup = null;
let circuitOpacity = lsNum(CIRCUIT_OPACITY_KEY, CIRCUIT_DEFAULT_OPACITY);

// Unlike byop plates (a single copy at the deployed root — see plateBase()),
// circuit-img PNGs are committed to the repo and ship WITH every preview
// (root, staging, /pr/N/, /branch/NAME/). So resolve them relative to the
// document base like the app's own scripts, WITHOUT stripping any preview
// suffix — stripping to root 404s on previews that carry their own images.
function circuitImgBase() {
  // Own copy, or the deployed root's when this preview shares it (navAssetBase).
  return navAssetBase('circuit-img');
}

function loadCircuitOverlays() {
  if (circuitLayerGroup) return;
  if (!airfields) return;
  circuitLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const co = af.circuit_overlay;
    if (!co) continue;
    if (!plateAirfieldAllowed(af.name)) continue;
    buildOverlayLayer(circuitImgBase(), co, '6', 'circuit_overlay')
      .addTo(circuitLayerGroup);
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

window.showTraining = lsGet(TRAINING_SHOW_KEY) === '1';
window.trainingLayerGroup = null;
let trainingOpacity = lsNum(TRAINING_OPACITY_KEY, TRAINING_DEFAULT_OPACITY);

// Same resolution rule as circuitImgBase(): training-img PNGs ship with every
// preview, so resolve them relative to the document base without stripping.
function trainingImgBase() {
  // Own copy, or the deployed root's when this preview shares it (navAssetBase).
  return navAssetBase('training-img');
}

function loadTrainingOverlays() {
  if (trainingLayerGroup) return;
  if (!airfields) return;
  trainingLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const to = af.training_overlay;
    if (!to) continue;
    if (!plateAirfieldAllowed(af.name)) continue;
    buildOverlayLayer(trainingImgBase(), to, '5', 'training_overlay')
      .addTo(trainingLayerGroup);
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

window.showCvfr = lsGet(CVFR_SHOW_KEY) === '1';
window.cvfrLayerGroup = null;
let cvfrOpacity = lsNum(CVFR_OPACITY_KEY, CVFR_DEFAULT_OPACITY);

// Same resolution rule as trainingImgBase(): cvfr-img PNGs ship with every
// preview, so resolve them relative to the document base without stripping.
function cvfrImgBase() {
  // Own copy, or the deployed root's when this preview shares it (navAssetBase).
  return navAssetBase('cvfr-img');
}

function loadCvfrOverlays() {
  if (cvfrLayerGroup) return;
  if (!airfields) return;
  cvfrLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const co = af.cvfr_overlay;
    if (!co) continue;
    if (!plateAirfieldAllowed(af.name)) continue;
    buildOverlayLayer(cvfrImgBase(), co, '5', 'cvfr_overlay')
      .addTo(cvfrLayerGroup);
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

window.showHeli = lsGet(HELI_SHOW_KEY) === '1';
window.heliLayerGroup = null;
let heliOpacity = lsNum(HELI_OPACITY_KEY, HELI_DEFAULT_OPACITY);

// Same resolution rule as cvfrImgBase(): heli-img PNGs ship with every
// preview, so resolve them relative to the document base without stripping.
function heliImgBase() {
  // Own copy, or the deployed root's when this preview shares it (navAssetBase).
  return navAssetBase('heli-img');
}

function loadHeliOverlays() {
  if (heliLayerGroup) return;
  if (!airfields) return;
  heliLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const ho = af.heli_overlay;
    if (!ho) continue;
    if (!plateAirfieldAllowed(af.name)) continue;
    buildOverlayLayer(heliImgBase(), ho, '4', 'heli_overlay')
      .addTo(heliLayerGroup);
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

window.showCommfail = lsGet(COMMFAIL_SHOW_KEY) === '1';
window.commfailLayerGroup = null;
let commfailOpacity = lsNum(COMMFAIL_OPACITY_KEY, COMMFAIL_DEFAULT_OPACITY);

// Same resolution rule as cvfrImgBase(): commfail-img PNGs ship with every
// preview, so resolve them relative to the document base without stripping.
function commfailImgBase() {
  // Own copy, or the deployed root's when this preview shares it (navAssetBase).
  return navAssetBase('commfail-img');
}

function loadCommfailOverlays() {
  if (commfailLayerGroup) return;
  if (!airfields) return;
  commfailLayerGroup = L.layerGroup();
  for (const af of airfields) {
    const co = af.commfail_overlay;
    if (!co) continue;
    if (!plateAirfieldAllowed(af.name)) continue;
    buildOverlayLayer(commfailImgBase(), co, '4', 'commfail_overlay')
      .addTo(commfailLayerGroup);
  }
}

function applyCommfailOpacity(v) {
  commfailOpacity = v;
  const valEl = document.getElementById('commfail-opacity-val');
  if (valEl) valEl.textContent = Math.round(v * 100) + '%';
  if (commfailLayerGroup) commfailLayerGroup.eachLayer(l => l.setOpacity(v));
}

// ── Per-airfield plate filter ("Show plates for") ────────────────────────────
// Airfield plates of the same type overlap for close fields (e.g. LLKS & LLIB
// CVFR). This picker limits every plate overlay to a single airfield.
const PLATE_AIRFIELD_KEY = 'navaid.plateAirfield';
window.plateAirfield = (() => {
  try { return lsGet(PLATE_AIRFIELD_KEY) || ''; } catch (_) { return ''; }
})();
const PLATE_OTYPES = ['circuit_overlay', 'training_overlay', 'cvfr_overlay',
                      'heli_overlay', 'commfail_overlay'];

function plateFields() {
  return (window.airfields || [])
    .filter(a => a.name && PLATE_OTYPES.some(t => a[t])).map(a => a.name);
}
// First & last airfield (with plates) appearing as route waypoints.
function routeEndpointAirfields() {
  const set = new Set();
  const have = new Set(plateFields());
  const wps = (typeof state === 'object' && state && Array.isArray(state.waypoints))
    ? state.waypoints : [];
  const on = wps.map(w => w && w.name).filter(n => have.has(n));
  if (on.length) { set.add(on[0]); set.add(on[on.length - 1]); }
  return set;
}
// '' = every field; 'auto' = route first/last airfield; else a single ICAO.
function plateAirfieldAllowed(name) {
  if (window.plateAirfield === 'auto') {
    // With no route (or none of its waypoints on a plate-carrying airfield)
    // a saved 'auto' must not silently blank every plate toggle — fall back
    // to showing every field until the route provides endpoints.
    const ends = routeEndpointAirfields();
    return ends.size ? ends.has(name) : true;
  }
  if (window.plateAirfield) return name === window.plateAirfield;
  return true;
}

function populatePlateAirfieldSelect() {
  const sel = document.getElementById('plate-airfield');
  if (!sel || !window.airfields) return;
  const names = airfields.filter(a => a.name && PLATE_OTYPES.some(t => a[t]))
    .map(a => a.name).sort();
  const allLabel = (typeof S === 'object' && S.tbPlateAirfieldAll) || 'All airfields';
  sel.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = ''; optAll.textContent = allLabel; sel.appendChild(optAll);
  const autoLabel = (typeof S === 'object' && S.tbPlateAirfieldAuto) || 'Auto (route start + end)';
  const optAuto = document.createElement('option');
  optAuto.value = 'auto'; optAuto.textContent = autoLabel; sel.appendChild(optAuto);
  const labelField = (typeof S === 'object' && S.airfieldLabelField) || 'en';
  for (const name of names) {
    const af = airfields.find(a => a.name === name);
    const label = af && af[labelField] ? name + ' \u00b7 ' + af[labelField] : name;
    const o = document.createElement('option'); o.value = name; o.textContent = label;
    sel.appendChild(o);
  }
  // A saved filter for an unknown field falls back to "all".
  window.plateAirfield = (names.includes(window.plateAirfield) || window.plateAirfield === 'auto')
    ? window.plateAirfield : '';
  sel.value = window.plateAirfield;
}

// Rebuild whichever plate layers are shown so they honour the current filter.
function rebuildPlateOverlays() {
  // The align editor may hold a layer inside a group we're about to destroy —
  // deselect it first so its handles can't keep editing an orphaned layer.
  if (window.overlayAlign && typeof overlayAlign.onPlatesRebuilt === 'function') {
    overlayAlign.onPlatesRebuilt();
  }
  const defs = [
    ['showCircuit', 'circuitLayerGroup', loadCircuitOverlays],
    ['showTraining', 'trainingLayerGroup', loadTrainingOverlays],
    ['showCvfr', 'cvfrLayerGroup', loadCvfrOverlays],
    ['showHeli', 'heliLayerGroup', loadHeliOverlays],
    ['showCommfail', 'commfailLayerGroup', loadCommfailOverlays],
  ];
  for (const [, gname] of defs) {
    const g = window[gname]; if (g) g.remove(); window[gname] = null;  // force rebuild
  }
  for (const [flag, gname, load] of defs) {
    if (!window[flag]) continue;
    load(); const g = window[gname]; if (g) g.addTo(map);
  }
}

// Route-aware: when Auto is selected and the route's endpoint airfields change,
// re-filter the shown plates. Called from syncLegs().
let _plateAutoKey = '';
function onRouteChangedForPlates() {
  if (window.plateAirfield !== 'auto') { _plateAutoKey = ''; return; }
  const key = [...routeEndpointAirfields()].sort().join(',');
  if (key === _plateAutoKey) return;
  _plateAutoKey = key;
  rebuildPlateOverlays();
}

(function wirePlateAirfieldSelect() {
  const sel = document.getElementById('plate-airfield');
  if (!sel) return;
  populatePlateAirfieldSelect();
  sel.onchange = () => {
    window.plateAirfield = sel.value;
    try { localStorage.setItem(PLATE_AIRFIELD_KEY, sel.value); } catch (_) {}
    _plateAutoKey = sel.value === 'auto' ? [...routeEndpointAirfields()].sort().join(',') : '';
    rebuildPlateOverlays();
  };
})();

// ── Overlay align editor ──────────────────────────────────────────────────────
// Lets a user pan / scale / rotate a shown chart overlay by eye. Geometry is
// tracked as { center:[lat,lng], a, b, rot } (a = N-S half-deg, b = E-W half in
// metric deg = lngHalf·cos(lat), rot = degrees) so rotation looks right on the
// map. Edits auto-save as a per-PNG localStorage override (see
// saveOverlayOverride) and can be copied out to bake into airfields.json.
const overlayAlign = (function () {
  const DEG = Math.PI / 180;
  const GTYPES = ['circuit_overlay', 'training_overlay', 'cvfr_overlay',
                  'heli_overlay', 'commfail_overlay'];
  const GVAR = {
    circuit_overlay: 'circuitLayerGroup', training_overlay: 'trainingLayerGroup',
    cvfr_overlay: 'cvfrLayerGroup', heli_overlay: 'heliLayerGroup',
    commfail_overlay: 'commfailLayerGroup',
  };
  const GLOAD = {
    circuit_overlay: () => loadCircuitOverlays(), training_overlay: () => loadTrainingOverlays(),
    cvfr_overlay: () => loadCvfrOverlays(), heli_overlay: () => loadHeliOverlays(),
    commfail_overlay: () => loadCommfailOverlays(),
  };
  let active = false, sel = null, editLayer = null, state = null;
  let handles = {}, panel = null, mapClick = null;

  const grp = (t) => window[GVAR[t]];
  const kf = (lat) => Math.cos(lat * DEG);
  const r5 = (n) => Math.round(n * 1e5) / 1e5;

  function corners(st) {
    const kk = kf(st.center[0]), c = Math.cos(st.rot * DEG), s = Math.sin(st.rot * DEG);
    const pt = (x, y) => {
      const xr = x * c - y * s, yr = x * s + y * c;
      return [st.center[0] + yr, st.center[1] + xr / kk];
    };
    return { tl: pt(-st.b, st.a), tr: pt(st.b, st.a),
             bl: pt(-st.b, -st.a), br: pt(st.b, -st.a) };
  }
  function rotHandle(st) {
    const kk = kf(st.center[0]), c = Math.cos(st.rot * DEG), s = Math.sin(st.rot * DEG);
    const y = st.a * 1.25, x = 0, xr = x * c - y * s, yr = x * s + y * c;
    return [st.center[0] + yr, st.center[1] + xr / kk];
  }
  function stateFromGeom(g) {
    if (g.rot) {
      const tl = g.tl, tr = g.tr, bl = g.bl;
      const br = [tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1]];
      const center = [(tl[0] + br[0]) / 2, (tl[1] + br[1]) / 2];
      const kk = kf(center[0]);
      const ex = (tr[1] - tl[1]) * kk, ey = tr[0] - tl[0];
      const lx = (bl[1] - tl[1]) * kk, ly = bl[0] - tl[0];
      return { center, a: Math.hypot(lx, ly) / 2, b: Math.hypot(ex, ey) / 2,
               rot: Math.atan2(ey, ex) / DEG };
    }
    const center = [(g.sw[0] + g.ne[0]) / 2, (g.sw[1] + g.ne[1]) / 2];
    return { center, a: (g.ne[0] - g.sw[0]) / 2,
             b: (g.ne[1] - g.sw[1]) / 2 * kf(center[0]), rot: 0 };
  }
  function geomFromState(st) {
    if (Math.abs(st.rot) < 0.05) {
      const kk = kf(st.center[0]);
      return { sw: [r5(st.center[0] - st.a), r5(st.center[1] - st.b / kk)],
               ne: [r5(st.center[0] + st.a), r5(st.center[1] + st.b / kk)] };
    }
    const c = corners(st);
    return { tl: c.tl.map(r5), tr: c.tr.map(r5), bl: c.bl.map(r5) };
  }

  function containsPoint(g, ll) {
    if (!g.rot) {
      return ll.lat >= g.sw[0] && ll.lat <= g.ne[0] &&
             ll.lng >= g.sw[1] && ll.lng <= g.ne[1];
    }
    const tl = g.tl, tr = g.tr, bl = g.bl;
    const br = [tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1]];
    const poly = [tl, tr, br, bl];
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if (((yi > ll.lat) !== (yj > ll.lat)) &&
          (ll.lng < (xj - xi) * (ll.lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function geomArea(g) {
    if (!g.rot) return (g.ne[0] - g.sw[0]) * (g.ne[1] - g.sw[1]);
    const st = stateFromGeom(g);
    return st.a * st.b;
  }
  function hitTest(ll) {
    let best = null, bestArea = Infinity;
    for (const t of GTYPES) {
      const G = grp(t);
      if (!G || !map.hasLayer(G)) continue;
      G.eachLayer((l) => {
        if (!l._ovData) return;
        const g = (l === editLayer) ? geomFromState(state) : overlayGeom(l._ovData);
        g.rot = g.rot || !!g.tl;
        if (containsPoint(g, ll)) {
          const area = geomArea(g);
          if (area < bestArea) { bestArea = area; best = l; }
        }
      });
    }
    return best;
  }

  function makeHandle(ll, cls, onDrag) {
    const m = L.marker(ll, {
      draggable: true, keyboard: false, pane: 'markerPane',
      icon: L.divIcon({ className: 'ov-handle ' + cls, iconSize: [18, 18],
                        iconAnchor: [9, 9] }),
    });
    m.on('drag', (e) => { onDrag(e.target.getLatLng()); });
    m.on('dragend', save);
    return m;
  }
  function positionHandles(except) {
    const c = corners(state);
    const pos = { center: state.center, tl: c.tl, tr: c.tr, bl: c.bl, br: c.br,
                  rot: rotHandle(state) };
    for (const key in handles) {
      if (key !== except) handles[key].setLatLng(pos[key]);
    }
  }
  function refresh(except) {
    const c = corners(state);
    editLayer.reposition(c.tl, c.tr, c.bl);
    positionHandles(except);
    updateReadout();
  }
  function fromCorner(ll) {
    const kk = kf(state.center[0]);
    const dx = (ll.lng - state.center[1]) * kk, dy = ll.lat - state.center[0];
    const c = Math.cos(state.rot * DEG), s = Math.sin(state.rot * DEG);
    state.b = Math.max(1e-4, Math.abs(dx * c + dy * s));
    state.a = Math.max(1e-4, Math.abs(-dx * s + dy * c));
  }
  function fromRotate(ll) {
    const kk = kf(state.center[0]);
    const dx = (ll.lng - state.center[1]) * kk, dy = ll.lat - state.center[0];
    state.rot = Math.atan2(dy, dx) / DEG - 90;
  }

  function buildHandles() {
    clearHandles();
    const c = corners(state);
    handles.center = makeHandle(state.center, 'ov-h-center',
      (ll) => { state.center = [ll.lat, ll.lng]; refresh('center'); });
    handles.rot = makeHandle(rotHandle(state), 'ov-h-rot',
      (ll) => { fromRotate(ll); refresh('rot'); });
    for (const key of ['tl', 'tr', 'bl', 'br']) {
      handles[key] = makeHandle(c[key], 'ov-h-corner',
        (ll) => { fromCorner(ll); refresh(key); });
    }
    for (const k in handles) handles[k].addTo(map);
  }
  function clearHandles() {
    for (const k in handles) map.removeLayer(handles[k]);
    handles = {};
  }

  function select(layer) {
    deselect();
    sel = layer;
    state = stateFromGeom(overlayGeom(layer._ovData));
    const G = grp(layer._ovType), c = corners(state);
    editLayer = L.imageOverlay.rotated(layer._ovUrl, c.tl, c.tr, c.bl,
      { opacity: Math.max(0.5, plateOpacity), interactive: false, pane: 'overlayPane' });
    editLayer._ovPng = layer._ovPng; editLayer._ovType = layer._ovType;
    editLayer._ovUrl = layer._ovUrl; editLayer._ovData = layer._ovData;
    G.removeLayer(layer); editLayer.addTo(G);
    buildHandles();
    updatePanel();
  }
  function save() {
    if (sel) saveOverlayOverride(sel._ovPng, geomFromState(state));
  }
  function deselect() {
    if (!sel) return;
    save();
    clearHandles();
    const t = sel._ovType;
    sel = null; editLayer = null; state = null;
    reloadType(t);
  }
  function reloadType(t) {
    const G = grp(t);
    const wasShown = G && map.hasLayer(G);
    if (G) map.removeLayer(G);
    window[GVAR[t]] = null;
    GLOAD[t]();
    if (wasShown && grp(t)) grp(t).addTo(map);
  }

  // ── panel ──
  function updateReadout() {
    if (!panel) return;
    const g = geomFromState(state);
    const ro = panel.querySelector('.ov-readout');
    if (g.sw) {
      ro.textContent = `sw ${g.sw[0]}, ${g.sw[1]}  ne ${g.ne[0]}, ${g.ne[1]}`;
    } else {
      ro.textContent = `rot ${state.rot.toFixed(1)}°  tl ${g.tl[0]}, ${g.tl[1]}`;
    }
  }
  function updatePanel() {
    if (!panel) return;
    const has = !!sel;
    panel.querySelector('.ov-sel').textContent = has
      ? (sel._ovPng + '  (' + sel._ovType.replace('_overlay', '') + ')')
      : (S.ovAlignPick || 'Tap an overlay to select');
    panel.querySelector('.ov-reset-sel').disabled = !has;
    panel.querySelector('.ov-readout').textContent = has ? '' : '';
    if (has) updateReadout();
  }
  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'ov-align-panel';
    panel.innerHTML =
      '<div class="ov-title">' + (S.ovAlignTitle || 'Align overlays') + '</div>' +
      '<div class="ov-sel"></div>' +
      '<div class="ov-readout"></div>' +
      '<div class="ov-hint">' + (S.ovAlignHint ||
        'Drag centre = move · corners = scale · top dot = rotate') + '</div>' +
      '<div class="ov-btns">' +
        '<button type="button" class="ov-reset-sel">' + (S.ovAlignResetSel || 'Reset this') + '</button>' +
        '<button type="button" class="ov-reset-all">' + (S.ovAlignResetAll || 'Reset all') + '</button>' +
        '<button type="button" class="ov-copy">' + (S.ovAlignCopy || 'Copy coords') + '</button>' +
        '<button type="button" class="ov-done">' + (S.ovAlignDone || 'Done') + '</button>' +
      '</div>';
    document.body.appendChild(panel);
    panel.querySelector('.ov-done').onclick = () => exit();
    panel.querySelector('.ov-reset-sel').onclick = () => {
      if (!sel) return;
      const png = sel._ovPng, t = sel._ovType;
      saveOverlayOverride(png, null);
      clearHandles(); sel = null; editLayer = null; state = null;
      reloadType(t); updatePanel();
    };
    panel.querySelector('.ov-reset-all').onclick = () => {
      if (!confirm(S.ovAlignResetAllConfirm || 'Clear all overlay alignments?')) return;
      localStorage.removeItem(OVERLAY_OVERRIDES_KEY);
      clearHandles(); sel = null; editLayer = null; state = null;
      GTYPES.forEach(reloadType); updatePanel();
    };
    panel.querySelector('.ov-copy').onclick = () => {
      const json = JSON.stringify(overlayOverrides(), null, 2);
      const say = (m) => { if (typeof showToast === 'function') showToast(m); };
      navigator.clipboard.writeText(json).then(
        () => say(S.ovAlignCopied || 'Overlay coords copied'),
        () => say(json));
    };
    updatePanel();
  }

  function enter() {
    if (active) return;
    active = true;
    document.body.classList.add('ov-align-active');
    const cb = document.getElementById('overlay-align-cb');
    if (cb) cb.checked = true;
    buildPanel();
    mapClick = (e) => {
      if (e.originalEvent && e.originalEvent.target &&
          e.originalEvent.target.closest &&
          e.originalEvent.target.closest('.ov-handle')) return;
      const l = hitTest(e.latlng);
      if (l && l !== sel) select(l);
    };
    map.on('click', mapClick);
  }
  function exit() {
    if (!active) return;
    deselect();
    map.off('click', mapClick); mapClick = null;
    if (panel) { panel.remove(); panel = null; }
    document.body.classList.remove('ov-align-active');
    const cb = document.getElementById('overlay-align-cb');
    if (cb) cb.checked = false;
    active = false;
  }
  function toggle() { active ? exit() : enter(); }

  // External hook: plate layer groups are being rebuilt (filter change /
  // Auto route-follow) — drop the current selection so edits can't target a
  // detached layer.
  function onPlatesRebuilt() { if (sel) deselect(); }
  return { toggle, enter, exit, isActive: () => active, onPlatesRebuilt };
})();
window.overlayAlign = overlayAlign;

// Hidden tool, like ?editor=1 / ?tune=1: the align toggle only appears with
// ?align=1 in the URL. Otherwise its group stays hidden and unwired.
(function wireOverlayAlignToggle() {
  if (!/[?&]align=1\b/.test(location.search)) return;
  const group = document.getElementById('overlay-align-group');
  const cb = document.getElementById('overlay-align-cb');
  if (!group || !cb) return;
  group.hidden = false;
  cb.onchange = () => { cb.checked ? overlayAlign.enter() : overlayAlign.exit(); };
})();

// ── Shared airfield-plate opacity ─────────────────────────────────────────────
// The five plate overlays (circuit, training, CVFR, helicopter, comm-failure)
// are mutually exclusive, so one slider at the top of the "Airfield plates"
// frame drives whichever plate is showing. All plate imageOverlays are created
// with `plateOpacity`, and this applies live to every plate layer group.
const PLATE_OPACITY_KEY = 'navaid.plateOpacity';
const PLATE_DEFAULT_OPACITY = 0.6;
let plateOpacity = (() => {
  const v = parseFloat(lsGet(PLATE_OPACITY_KEY));
  if (!isNaN(v)) return v;
  // One-time migration: adopt a value saved under any of the old per-layer
  // opacity keys (before the sliders were united) so customised users keep it.
  for (const k of ['navaid.circuitOpacity', 'navaid.trainingOpacity',
                   'navaid.cvfrOpacity', 'navaid.heliOpacity', 'navaid.commfailOpacity']) {
    const ov = parseFloat(lsGet(k));
    if (!isNaN(ov)) {
      try { localStorage.setItem(PLATE_OPACITY_KEY, String(ov)); } catch (_) {}
      return ov;
    }
  }
  return PLATE_DEFAULT_OPACITY;
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
  const stored = lsGet(AIRFIELDS_KEY);
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
  const stored = lsGet(LSA_BUBBLES_KEY);
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
        map.fitBounds(b, fitOpts('fitAreaPaddingPx', 'fitAreaMaxZoom'));
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

// Persistent "Loading charts…" indicator shown while an Extra-layers plate
// overlay is fetching its airfield data / building its image layers, so the
// toggle doesn't sit silent before anything appears. Dismissed once the layer
// is on the map (charts start rendering).
let _chartsLoadingEl = null;
function chartsLoading(on) {
  if (on) {
    if (_chartsLoadingEl) return;
    const el = document.createElement('div');
    el.className = 'toast show charts-loading';
    el.textContent = S.loadingCharts || 'Loading charts…';
    document.body.appendChild(el);
    _chartsLoadingEl = el;
  } else if (_chartsLoadingEl) {
    const el = _chartsLoadingEl; _chartsLoadingEl = null;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }
}
// Keep the indicator up until the overlay group's images have actually loaded
// (the perceptible wait is the chart PNGs, not just adding the layer), then
// dismiss. A timeout guards against an image that never loads.
function chartsLoadingUntilReady(group) {
  if (!group) { chartsLoading(false); return; }
  let pending = 0, done = false;
  const finish = () => { if (!done) { done = true; chartsLoading(false); } };
  group.eachLayer(l => {
    const img = l && l._image;
    if (img && img.complete && img.naturalWidth) return;   // already loaded
    if (l && l.once) { pending++; l.once('load error', () => { if (--pending <= 0) finish(); }); }
  });
  if (pending === 0) finish(); else setTimeout(finish, 8000);
}
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
        if (!airfields || !circuitLayerGroup) chartsLoading(true);
        if (!airfields) await loadAirfields();
        // Re-check: a toggle-off (or mutual-exclusion switch) during the
        // cold-start await would otherwise leave an orphaned overlay.
        if (!window.showCircuit) { chartsLoading(false); return; }
        loadCircuitOverlays();
        if (circuitLayerGroup) circuitLayerGroup.addTo(map);
        chartsLoadingUntilReady(circuitLayerGroup);
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
        if (!airfields || !trainingLayerGroup) chartsLoading(true);
        if (!airfields) await loadAirfields();
        // Re-check: a toggle-off (or mutual-exclusion switch) during the
        // cold-start await would otherwise leave an orphaned overlay.
        if (!window.showTraining) { chartsLoading(false); return; }
        loadTrainingOverlays();
        if (trainingLayerGroup) trainingLayerGroup.addTo(map);
        chartsLoadingUntilReady(trainingLayerGroup);
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
        if (!airfields || !cvfrLayerGroup) chartsLoading(true);
        if (!airfields) await loadAirfields();
        // Re-check: a toggle-off (or mutual-exclusion switch) during the
        // cold-start await would otherwise leave an orphaned overlay.
        if (!window.showCvfr) { chartsLoading(false); return; }
        loadCvfrOverlays();
        if (cvfrLayerGroup) cvfrLayerGroup.addTo(map);
        chartsLoadingUntilReady(cvfrLayerGroup);
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
        if (!airfields || !heliLayerGroup) chartsLoading(true);
        if (!airfields) await loadAirfields();
        // Re-check: a toggle-off (or mutual-exclusion switch) during the
        // cold-start await would otherwise leave an orphaned overlay.
        if (!window.showHeli) { chartsLoading(false); return; }
        loadHeliOverlays();
        if (heliLayerGroup) heliLayerGroup.addTo(map);
        chartsLoadingUntilReady(heliLayerGroup);
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
        if (!airfields || !commfailLayerGroup) chartsLoading(true);
        if (!airfields) await loadAirfields();
        // Re-check: a toggle-off (or mutual-exclusion switch) during the
        // cold-start await would otherwise leave an orphaned overlay.
        if (!window.showCommfail) { chartsLoading(false); return; }
        loadCommfailOverlays();
        if (commfailLayerGroup) commfailLayerGroup.addTo(map);
        chartsLoadingUntilReady(commfailLayerGroup);
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
  const storedStations = lsGet(VOR_STATIONS_KEY);
  const legacyStations = lsGet(VOR_LEGACY_KEY);
  if (storedStations !== null) {
    window.showVorStations = storedStations === '1';
  } else if (legacyStations !== null) {
    window.showVorStations = legacyStations === '1';
    localStorage.setItem(VOR_STATIONS_KEY, window.showVorStations ? '1' : '0');
    localStorage.removeItem(VOR_LEGACY_KEY);
  }
  const ref = lsGet(VOR_REF_KEY);
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
    refreshInspectorIfVisible();   // refresh radial/DME rows
    if (typeof showCenterCoord === 'function') showCenterCoord();
    if (typeof refreshFlightPlan === 'function' && refreshFlightPlan) refreshFlightPlan();
  };
}
if (vorRefSelect) {
  vorRefSelect.onchange = e => {
    setReferenceVor(e.target.value);
    draw();
    refreshInspectorIfVisible();
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
  const stored = lsGet(FORCE_SNAP_KEY);
  if (stored !== null) window.forceSnap = stored === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('force-snap-cb').checked = forceSnap;
document.getElementById('force-snap-cb').onchange = e => {
  window.forceSnap = e.target.checked;
  try { localStorage.setItem(FORCE_SNAP_KEY, forceSnap ? '1' : '0'); }
  catch (err) { /* storage unavailable */ }
};
// Comm-change overlay toggle (issue #399). The dataset lives in
// the route graph's comm-change nodes and rings are drawn on top of the nav-WP dots
// in draw.js. This key intentionally replaced the legacy
// navaid.showCommChange key so users who had stored the old default-off
// state get the new default-on behavior.
const COMMCHANGE_KEY = 'navaid.showFreqChanges';
try {
  const stored = lsGet(COMMCHANGE_KEY);
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
  const stored = lsGet(THEME_KEY);
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
  const v = parseFloat(lsGet(ALPHA_KEY));
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
    // Fire both: many sliders live-update on 'input', but some (e.g. the
    // wind-field altitude) do the real work — a refetch — on 'change'.
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
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

// Kite / cumulative-kite / note fill opacity. This writes the SAME tune key every
// drawing path reads (tune('kiteNoteAlpha') in draw.js), so the value propagates to the
// PNG export and the print sheet with no second code path -- there is one number, not a
// screen one and a paper one.
//
// The slider's default is whatever the gist (or the shipped default) says, not a
// hardcoded 50%: gistKiteAlpha remembers that value so the reset button returns to it,
// and the gist arrives asynchronously, so syncKiteAlphaSlider() re-reads it once the
// remote config lands -- unless the pilot has already chosen their own value.
// Display controls that write TUNE keys (rather than plain globals) have to be re-applied
// after the remote config lands: loadRemoteConfig() writes NavAid.tuning wholesale, and
// the gist ships every one of these keys, so a stored user choice was silently clobbered
// on each load -- the picker still showed the chosen colour while the map drew the gist's.
// Registered here, applied at boot AND again after the gist.
const STORED_TUNE_OVERRIDES = [];
function registerTuneOverride(storageKey, tuneKeys, validate) {
  STORED_TUNE_OVERRIDES.push({ storageKey, keys: tuneKeys, validate });
  applyStoredTuneOverride(STORED_TUNE_OVERRIDES[STORED_TUNE_OVERRIDES.length - 1]);
}
function applyStoredTuneOverride(entry) {
  let stored = null;
  try { stored = lsGet(entry.storageKey); } catch (e) { return null; }
  if (stored === null) return null;
  const v = entry.validate ? entry.validate(stored) : stored;
  if (v === null || v === undefined) return null;
  entry.keys.forEach(k => setTune(k, v));
  return v;
}
// Called after loadRemoteConfig(): the pilot's saved choices outrank the gist.
function reapplyStoredTuneOverrides() {
  for (const entry of STORED_TUNE_OVERRIDES) applyStoredTuneOverride(entry);
}

// Default leg speed. Seeds a new leg that has no earlier leg to copy from, so it
// belongs beside the layer picker rather than in the hidden tuning panel — it is
// the one performance number every pilot needs to set once for their aircraft.
// Registered as a tune override so it outranks the gist and survives its reload.
const DEFAULTSPEED_KEY = 'navaid.defaultSpeed';
const DEFAULTSPEED_EL = document.getElementById('default-speed');
const defaultSpeedOk = n => Number.isFinite(n) && n >= 20 && n <= 400;
function syncDefaultSpeedInput() {
  if (DEFAULTSPEED_EL) DEFAULTSPEED_EL.value = String(Math.round(tune('defaultLegSpeedKt')));
}
// Single carry point. The toolbar input is not the only writer of the in-force
// default -- the gist reload, the dev tuning panel (and its per-key reset), and a
// Drive settings win all move it -- and every one of them used to leave the legs
// still tracking it behind at the old number, showing a control whose value the
// route did not match and which the pilot had no reason to touch.
function carryDefaultSpeedToRoute() {
  if (typeof applyDefaultSpeedToAutoLegs !== 'function') return false;
  if (!applyDefaultSpeedToAutoLegs(tune('defaultLegSpeedKt'))) return false;
  if (typeof persist === 'function') persist();
  draw();
  refreshInspectorIfVisible();
  return true;
}
if (DEFAULTSPEED_EL) {
  registerTuneOverride(DEFAULTSPEED_KEY, ['defaultLegSpeedKt'], v => {
    const n = Math.round(Number(v));
    return defaultSpeedOk(n) ? n : null;
  });
  syncDefaultSpeedInput();
  DEFAULTSPEED_EL.onchange = () => {
    const n = Math.round(Number(DEFAULTSPEED_EL.value));
    if (!defaultSpeedOk(n)) { syncDefaultSpeedInput(); return; }   // reject junk, show what is in force
    setTune('defaultLegSpeedKt', n);
    try { localStorage.setItem(DEFAULTSPEED_KEY, String(n)); } catch (e) { /* storage unavailable */ }
    // Carry the legs that never had a speed typed on them, so setting the aircraft's
    // cruise once fixes the whole route rather than only the legs drawn after.
    carryDefaultSpeedToRoute();
  };
}

const KITEALPHA_KEY = 'navaid.legArrowAlpha';
let gistKiteAlpha = tune('kiteNoteAlpha');
const KITEALPHA_EL = document.getElementById('kite-alpha');
function syncKiteAlphaSlider(fromGist) {
  if (!KITEALPHA_EL) return;
  if (fromGist) {
    // Remember what the gist asked for (that is what reset returns to), then let the
    // pilot's stored choice win again -- reapplyStoredTuneOverrides() has already
    // rewritten the tune key by the time this runs.
    gistKiteAlpha = tune('kiteNoteAlpha');
    let stored = null;
    try { stored = lsGet(KITEALPHA_KEY); } catch (e) { /* */ }
    if (stored !== null) return;
  }
  KITEALPHA_EL.value = String(Math.round(tune('kiteNoteAlpha') * 100));
  updateSliderVal(KITEALPHA_EL, KITEALPHA_EL.value + '%');
}
if (KITEALPHA_EL) {
  KITEALPHA_EL.min = '0'; KITEALPHA_EL.max = '100'; KITEALPHA_EL.step = '5';
  registerTuneOverride(KITEALPHA_KEY, ['kiteNoteAlpha'], v => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  });
  syncKiteAlphaSlider();
  KITEALPHA_EL.oninput = e => {
    setTune('kiteNoteAlpha', parseFloat(e.target.value) / 100);
    updateSliderVal(e.target, e.target.value + '%');
    try { localStorage.setItem(KITEALPHA_KEY, String(tune('kiteNoteAlpha'))); }
    catch (err) { /* storage unavailable */ }
    draw();
  };
}

// Colour pickers for the two fills a pilot actually tweaks: waypoint labels and the leg
// arrows. Both write the tune key the drawing code reads, so screen, PNG export and print
// stay one value -- and both remember the gist/shipped colour so their reset returns to it
// rather than to a hardcoded hex.
function wireColorPicker(elId, tuneKeys, storageKey) {
  const keys = Array.isArray(tuneKeys) ? tuneKeys : [tuneKeys];
  const el = document.getElementById(elId);
  if (!el) return;
  const shipped = keys.map(k => tune(k));
  const applyAll = v => keys.forEach(k => setTune(k, v));
  registerTuneOverride(storageKey, keys,
    v => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null));
  el.value = tune(keys[0]);
  el.oninput = () => {
    applyAll(el.value);
    try { localStorage.setItem(storageKey, tune(keys[0])); } catch (e) { /* */ }
    draw();
  };
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'slider-reset';
  btn.textContent = '↻';
  btn.title = S.resetToDefault || 'Reset to default';
  btn.setAttribute('aria-label', btn.title);
  btn.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    try { localStorage.removeItem(storageKey); } catch (err) { /* */ }
    keys.forEach((k, i) => setTune(k, shipped[i]));
    el.value = tune(keys[0]);
    draw();
  };
  el.parentElement.appendChild(btn);
}
// Waypoint colour drives waypointFillColor -- the same fill the Waypoint-opacity slider
// fades. (labelFillColor exists in the registry but nothing draws with it: yellowFill()
// has no callers, which is why pointing the picker at it changed nothing on screen.)
wireColorPicker('waypoint-color', 'waypointFillColor', 'navaid.waypointColor');
// One "leg arrow" control covers the nav arrow AND the cumulative arrow, which carry
// separate fill keys. The RETURN arrows keep their own colours on purpose -- they are
// deliberately different so the return path reads as the return path.
wireColorPicker('leg-arrow-color', ['legKiteFillColor', 'cumKiteFillColor'], 'navaid.legArrowColor');

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
  const v = parseFloat(lsGet(MAPOPACITY_KEY));
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
  const v = parseFloat(lsGet(WPSIZE_KEY));
  if (!isNaN(v)) window.wpSize =Math.max(WP_SIZE_MIN, Math.min(WP_SIZE_MAX, v));
} catch (e) { /* storage unavailable */ }
// Symbol-size readout. Selector 1 IS the printed standard -- the fixed physical sizes
// (7mm waypoint disc, 18.5mm leg arrow, 9.5mm cum arrow, 21x14mm note) are pinned at
// selector 1 and everything else multiplies them. The slider can now go below 1 as well
// as above, so say so when it sits on the standard: departing from it should be visible,
// not silent, because it changes what comes out of the printer.
function sizeSliderVal(v) {
  const n = parseFloat(v);
  const txt = n.toFixed(2);
  return Math.abs(n - 1) < 1e-9 ? txt + ' ' + (S.sliderStandardSuffix || '(standard)') : txt;
}

const WP_EL = document.getElementById('wp-size');
WP_EL.min = String(WP_SIZE_MIN); WP_EL.max = String(WP_SIZE_MAX); WP_EL.step = String(WP_SIZE_STEP);
WP_EL.value = wpSize;
updateSliderVal(WP_EL, sizeSliderVal(wpSize));
WP_EL.oninput = e => {
  window.wpSize =parseFloat(e.target.value);
  updateSliderVal(e.target, sizeSliderVal(e.target.value));
  try { localStorage.setItem(WPSIZE_KEY, String(wpSize)); }
  catch (err) { /* storage unavailable */ }
  draw();
};

const LEGARROW_KEY = 'navaid.legArrowSize';
// 1.0 sits in the MIDDLE of the travel, not at the start: the range was 1..3, so the
// shipped size was the smallest available and the slider could only enlarge. 0.2..1.8
// on a 0.1 grid keeps 1.0 exactly centred and lands on the tick.
const LEGARROW_MIN = 0.2, LEGARROW_MAX = 1.8, LEGARROW_STEP = 0.1;
try {
  const v = parseFloat(lsGet(LEGARROW_KEY));
  if (!isNaN(v)) window.legArrowSize =Math.max(LEGARROW_MIN, Math.min(LEGARROW_MAX, v));
} catch (e) { /* storage unavailable */ }
const LEGARROW_EL = document.getElementById('leg-arrow-size');
LEGARROW_EL.min = String(LEGARROW_MIN); LEGARROW_EL.max = String(LEGARROW_MAX); LEGARROW_EL.step = String(LEGARROW_STEP);
LEGARROW_EL.value = legArrowSize;
updateSliderVal(LEGARROW_EL, sizeSliderVal(legArrowSize));
LEGARROW_EL.oninput = e => {
  window.legArrowSize =parseFloat(e.target.value);
  updateSliderVal(e.target, sizeSliderVal(e.target.value));
  try { localStorage.setItem(LEGARROW_KEY, String(legArrowSize)); }
  catch (err) { /* storage unavailable */ }
  draw();
};

// A slider whose RANGE changed needs a new key, or an out-of-range saved value gets
// silently clamped and the pilot sees a width they never chose. Bumping alone would
// reset everyone, including the majority whose value still fits — so adopt the old
// value when it falls inside the new range, and fall back to the shipped default
// only when it genuinely cannot be honoured. Same shape as navLangPosRead's adoption.
function adoptRangedNumber(key, legacyKeys, min, max, shipped) {
  const inRange = v => Number.isFinite(v) && v >= min && v <= max;
  try {
    const own = parseFloat(lsGet(key));
    if (inRange(own)) return own;
    for (const old of legacyKeys) {
      const v = parseFloat(lsGet(old));
      if (inRange(v)) { localStorage.setItem(key, String(v)); return v; }
    }
  } catch (e) { /* storage unavailable */ }
  return shipped;
}

// Key bumped again (v3): v2 was introduced for a 0.1–2.0 range, and the range was
// later narrowed to 0.1–0.9 WITHOUT a bump — so a saved 1.5 was quietly clamped to
// 0.9, the exact failure the first bump existed to prevent.
const LEGLINEWIDTH_KEY = 'navaid.legLineWidth3';
const LEGLINEWIDTH_LEGACY = ['navaid.legLineWidth2', 'navaid.legLineWidth'];
// Shipped default (0.5) centred on the travel: it used to sit at 21% of a 0.1..2 range,
// so the slider mostly thickened and barely thinned. 0.1..0.9 on a 0.1 grid puts 0.5
// in the middle and on a tick.
const LEGLINEWIDTH_MIN = 0.1, LEGLINEWIDTH_MAX = 0.9, LEGLINEWIDTH_STEP = 0.1;
window.legLineWidth = adoptRangedNumber(LEGLINEWIDTH_KEY, LEGLINEWIDTH_LEGACY,
  LEGLINEWIDTH_MIN, LEGLINEWIDTH_MAX, window.legLineWidth);
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

// Versioned for the same reason: this slider went 0.5–6 -> 0.2–1.8 on the original
// key, so a saved 3 was clamped to 1.8.
const DRIFTLINEWIDTH_KEY = 'navaid.driftLineWidth2';
const DRIFTLINEWIDTH_LEGACY = ['navaid.driftLineWidth'];
// Same treatment: the default (1) sat at 9% of a 0.5..6 range. 0.2..1.8 on a 0.1 grid
// centres it, and the finer step gives 17 stops instead of a coarse half-unit jump.
const DRIFTLINEWIDTH_MIN = 0.2, DRIFTLINEWIDTH_MAX = 1.8, DRIFTLINEWIDTH_STEP = 0.1;
window.driftLineWidth = adoptRangedNumber(DRIFTLINEWIDTH_KEY, DRIFTLINEWIDTH_LEGACY,
  DRIFTLINEWIDTH_MIN, DRIFTLINEWIDTH_MAX, window.driftLineWidth);
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
// Per-slider reset buttons for the Display section sliders + the magnifier
// zoom and wind-field altitude sliders (each restores its HTML default value
// and re-fires the slider's own input handler).
// The kite-opacity reset returns to the GIST value, so it is wired by hand rather than
// through addSliderReset (which restores the HTML default attribute).
if (KITEALPHA_EL) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'slider-reset';
  btn.textContent = '↻';
  btn.title = S.resetToDefault || 'Reset to default';
  btn.setAttribute('aria-label', btn.title);
  btn.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    try { localStorage.removeItem(KITEALPHA_KEY); } catch (err) { /* */ }
    setTune('kiteNoteAlpha', gistKiteAlpha);
    syncKiteAlphaSlider();
    draw();
  };
  KITEALPHA_EL.parentElement.appendChild(btn);
}
['yellow-alpha', 'map-opacity', 'wp-size', 'leg-arrow-size', 'leg-line-width', 'drift-line-width',
 'mag-zoom', 'windfield-alt']
  .forEach(id => addSliderReset(document.getElementById(id)));
// magVar is hardcoded at -5 (5°E) in core.js; the input was removed.

document.getElementById('page-a3').onclick = () => setPage('A3');
document.getElementById('page-a4').onclick = () => setPage('A4');
const _a4x2Btn = document.getElementById('page-a4x2');
if (_a4x2Btn) _a4x2Btn.onclick = () => setPage('A4x2');
// Restore last-used orientation and wire the toolbar toggle button.
try {
  const stored = lsGet('navaid.pageOrient');
  if (stored === 'portrait' || stored === 'landscape') window.pageOrient = stored;
} catch (e) { /* storage unavailable */ }
document.getElementById('page-orient').onclick = toggleOrientation;
// One-click fix for a route that overruns the page: pick the smallest page that holds
// it and centre it there. Hidden unless the route actually overruns (refreshPrintFit).
const _printFitBtn = document.getElementById('print-fit');
if (_printFitBtn) _printFitBtn.onclick = () => {
  const pick = (typeof fitPageToRoute === 'function') ? fitPageToRoute() : false;
  if (!pick) return;                       // nothing fits; the warning already says so
  try {
    localStorage.setItem('navaid.pageSize', pageSize);
    localStorage.setItem('navaid.pageOrient', pageOrient);
  } catch (e) { /* storage unavailable */ }
  if (typeof refreshPageButtons === 'function') refreshPageButtons();
  if (typeof refreshOrientButton === 'function') refreshOrientButton();
  draw();
};
refreshOrientButton();
// Restore the A3/A4 page frame across reloads — the frame re-centres on the
// current map view, so it reappears over the same area.
try {
  const sp = lsGet('navaid.pageSize');
  if ((sp === 'A3' || sp === 'A4' || sp === 'A4x2') && typeof setPage === 'function') setPage(sp);
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
  const posBase = () => (toolbarUsesDesktopMenu() ? KEY_DESKTOP : KEY);
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
      const raw = navLangPosRead(posBase());
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
      if (typeof window.reclampToolbarSections === 'function') window.reclampToolbarSections();
      return;
    }
    restorePos();
    let sc = null;
    try { sc = lsGet(COLLAPSED_KEY); } catch (e) { /* storage unavailable */ }
    // Default collapsed on phones — an expanded toolbar column covers ~half the
    // map on a narrow screen. A saved phone choice wins.
    const narrowDefault = !!(window.matchMedia && window.matchMedia('(max-width: 680px)').matches);
    setCollapsed(sc === null ? narrowDefault : sc === '1', { persist: sc !== null });
    refreshMapAfterToolbarModeChange();
    // A stale dropdown nudge from the other layout must not survive the switch.
    if (typeof window.reclampToolbarSections === 'function') window.reclampToolbarSections();
  }

  window.addEventListener('resize', () => {
    // Keep a dragged bar (mobile or desktop) on-screen after a resize.
    if (toolbarUsesDesktopMenu() && !bar.style.left) {
      setCollapsed(false, { persist: false });
      return;
    }
    if (bar.style.left) setPos(parseFloat(bar.style.left), parseFloat(bar.style.top));
  });

  // Lets setMode() get the mobile column out of the way when a map tool is armed.
  window.collapseToolbarForMapTool = () => {
    if (typeof toolbarUsesDesktopMenu === 'function' && toolbarUsesDesktopMenu()) return;
    setCollapsed(true, { persist: false });
  };
  onToolbarDesktopMenuChange(applyResponsiveToolbarMode);
  applyResponsiveToolbarMode();
})();

// --- section toggles -------------------------------------------------
(function makeSectionToggle() {
  // .tb-standalone entries (Flight plan) are plain actions wearing the section-head
  // look — they have no body to open, so they stay out of the accordion, the
  // hover-open, the persisted open state and the open-count bookkeeping.
  const sections = Array.from(document.querySelectorAll('.tb-section:not(.tb-standalone)'));
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
    clampSectionBody(sec, open);
  }
  // Keep an open section dropdown inside the viewport. When the desktop menu bar
  // wraps to a second row, a section head can sit near a screen edge and its
  // dropdown (fixed left/right rules) overflows off-screen — e.g. the Print
  // menu's Save-PNG button became unreachable in RTL. Nudge the body back in.
  function clampSectionBody(sec, open) {
    const body = sec.querySelector('.tb-section-body');
    if (!body) return;
    body.style.transform = '';
    if (!open || !toolbarUsesDesktopMenu()) return;
    const r = body.getBoundingClientRect();
    const vw = window.innerWidth;
    let dx = 0;
    if (r.right > vw - 4) dx = (vw - 4) - r.right;
    else if (r.left < 4) dx = 4 - r.left;
    if (dx) body.style.transform = 'translateX(' + Math.round(dx) + 'px)';
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

  // Re-apply the viewport clamp to whatever is currently open. Two gaps this
  // closes: a section restored open from localStorage at boot only gets
  // classList.add('open') and never goes through setSectionOpen, so it was never
  // clamped — that is the original off-screen dropdown (an unreachable Save-PNG
  // button in RTL on a wrapped menu bar), which only healed after manually
  // closing and reopening. And an already-applied translateX goes stale when the
  // viewport resizes or the toolbar switches desktop<->mobile, leaving the
  // dropdown nudged away from its section head.
  function reclampOpenSections() {
    for (const sec of sections) clampSectionBody(sec, sec.classList.contains('open'));
  }
  window.reclampToolbarSections = reclampOpenSections;
  window.addEventListener('resize', reclampOpenSections);
  // After this IIFE finishes (so the restore loop below has run) and layout has
  // settled, clamp whatever was restored open.
  requestAnimationFrame(reclampOpenSections);

  for (const sec of sections) {
    const head = sec.querySelector('.tb-section-head');
    if (!head) continue;
    const key = 'navaid.sec.' + sec.dataset.sec;
    try {
      if (lsGet(key) === '1') sec.classList.add('open');
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
    if (e.target && e.target.closest && e.target.closest('#toolbar')) return;
    if (toolbarUsesDesktopMenu()) {
      if (toolbar && toolbar.classList.contains('multi-open')) return;
      closeDesktopMenus();
    }
  });
  // Mobile / floating toolbar: close the open section on a tap outside it.
  // Uses 'click' (not pointerdown) because on touch devices Leaflet's map can
  // swallow the pointer event before it bubbles to document — the same 'click'
  // path that dismisses the inspector, so it fires reliably on a real tap.
  document.addEventListener('click', e => {
    if (toolbarUsesDesktopMenu()) return;
    if (e.target && e.target.closest && e.target.closest('#toolbar')) return;
    if (anySectionOpen()) window.closeToolbarMenus();
  });
  document.addEventListener('keydown', e => {
    if (toolbarUsesDesktopMenu() && e.key === 'Escape') closeDesktopMenus();
  });
  if (toolbar) {
    // Commands that close the desktop submenu after opening their modal. EVERY
    // modal-opening Charts-section item is listed so the submenu closes
    // uniformly whenever any chart item is opened (previously sigwx-btn/pwx-btn/
    // sigmet-btn/notam-list-btn/lsa-list-btn/mosaic-btn were missing, leaving
    // the submenu open behind those — the bug this fixes).
    const closeAfterCommandIds = new Set([
      'search-trigger',
      'route-templates',
      'plan',
      'freq-table',
      'alt-pairs',
      'charts',
      'sigwx-btn',
      'pwx-btn',
      'sigmet-btn',
      'notam-list-btn',
      'lsa-list-btn',
      'mosaic-btn',
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
  if (spec.type === 'bool') return value ? 'on' : 'off';
  if (spec.type === 'color' || spec.type === 'select') return String(value);
  const step = String(spec.step || 1);
  const dot = step.indexOf('.');
  const places = dot === -1 ? 0 : step.length - dot - 1;
  return places ? value.toFixed(places) : String(Math.round(value));
}

function redrawAfterTune() {
  applyTuningCssVars();
  // The tuning panel can move defaultLegSpeedKt too (Route defaults group), so the
  // legs following it come along -- and the toolbar input re-reads the new value.
  if (typeof applyDefaultSpeedToAutoLegs === 'function') applyDefaultSpeedToAutoLegs(tune('defaultLegSpeedKt'));
  if (typeof syncDefaultSpeedInput === 'function') syncDefaultSpeedInput();
  draw();
  refreshInspectorIfVisible();
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
      const raw = navLangPosRead(KEY);
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
      try { localStorage.setItem(navLangPosKey(KEY), JSON.stringify({ x: r.left, y: r.top })); }
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
    if (set.check) set.check.checked = !!v;
  };
  const applyValue = (key, raw) => {
    const spec = NavAid.tuningDefaults[key];
    if (spec && spec.type === 'bool') {
      setTune(key, raw);
      syncControl(key);
      // A default-visibility toggle only affects a fresh visitor; re-run the
      // reconciliation so the change is visible immediately in this session too
      // (for toggles the current user hasn't explicitly set).
      if (typeof NavAid.applyDefaultVisibility === 'function') NavAid.applyDefaultVisibility();
      redrawAfterTune();
      return;
    }
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
      // The registry key is what a gist edit needs, and nothing showed it: hover the label
      // for the key, click it to copy the key to the clipboard (with a brief confirmation
      // in place of the label, so the copy is felt without a toast layer).
      name.title = key;
      name.style.cursor = 'copy';
      // The restore target is the ORIGINAL label, captured once: capturing it inside the
      // handler let a double click within the toast window capture "✓ copied" as the
      // label and stick it permanently.
      const origLabel = name.textContent;
      let copyTimer = 0;
      name.addEventListener('click', ev => {
        ev.preventDefault();          // the row is a <label>; don't toggle the control
        const done = () => {
          name.textContent = key + ' ✓ copied';
          clearTimeout(copyTimer);
          copyTimer = setTimeout(() => { name.textContent = origLabel; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(key).then(done, done);
        } else { done(); }
      });

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.id = 'tune-' + key + '-reset';
      reset.className = 'tune-reset';
      reset.textContent = '↻';
      reset.title = 'Reset ' + (spec.label || key);
      reset.setAttribute('aria-label', reset.title);

      const set = {};
      if (spec.type === 'bool') {
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.id = 'tune-' + key + '-check';
        check.setAttribute('aria-label', spec.label || key);
        set.check = check;
        check.addEventListener('change', () => applyValue(key, check.checked));
        row.htmlFor = check.id;
        row.append(name, check, reset);
      } else if (spec.type === 'color') {
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
  refreshInspectorIfVisible();
  // Airfield-plate overlays are mutually exclusive — restore only the first
  // enabled plate and clear any stale extras, so a past double-on state (e.g.
  // from a cold-start toggle race) can never stack two plates on load.
  (function restorePlateOverlays() {
    const plates = [
      ['showCircuit',  CIRCUIT_SHOW_KEY,  'circuit-cb',  loadCircuitOverlays,  () => circuitLayerGroup],
      ['showTraining', TRAINING_SHOW_KEY, 'training-cb', loadTrainingOverlays, () => trainingLayerGroup],
      ['showCvfr',     CVFR_SHOW_KEY,     'cvfr-cb',     loadCvfrOverlays,     () => cvfrLayerGroup],
      ['showHeli',     HELI_SHOW_KEY,     'heli-cb',     loadHeliOverlays,     () => heliLayerGroup],
      ['showCommfail', COMMFAIL_SHOW_KEY, 'commfail-cb', loadCommfailOverlays, () => commfailLayerGroup],
    ];
    let shown = false;
    for (const [flag, key, cbId, load, group] of plates) {
      if (!window[flag]) continue;
      if (!shown) {
        load();
        const g = group(); if (g) g.addTo(map);
        shown = true;
      } else {
        // A second enabled plate — drop it so only one shows.
        window[flag] = false;
        try { localStorage.setItem(key, '0'); } catch (_) {}
        const cb = document.getElementById(cbId);
        if (cb) cb.checked = false;
      }
    }
  })();
});
// Leg-altitude green-route altitude table: fills only freshly-created legs, and
// leaves saved/imported/manual leg values authoritative.
loadLegAltitudes().then(() => {
  if (applyLegAltitudesToRoute()) {
    draw();
    refreshInspectorIfVisible();
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
    refreshInspectorIfVisible();
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
// CTR boundary points: the route clock starts there, not at the field.
if (typeof loadCtrBoundaries === "function") loadCtrBoundaries();

// Pull optional remote tuning overrides (gist) over the baked-in defaults, then
// repaint so they take effect. Silent fallback to defaults if the fetch fails.
if (typeof loadRemoteConfig === "function") {
  loadRemoteConfig().then(n => {
    // The gist has just overwritten NavAid.tuning: restore the pilot's saved overrides
    // on top of it, then let the controls re-read.
    if (typeof reapplyStoredTuneOverrides === 'function') reapplyStoredTuneOverrides();
    if (typeof syncKiteAlphaSlider === 'function') syncKiteAlphaSlider(true);
    // Show whatever is in force now — the gist's value, or the pilot's saved one
    // that reapplyStoredTuneOverrides() just put back on top of it.
    if (typeof syncDefaultSpeedInput === 'function') syncDefaultSpeedInput();
    // A gist-shipped default is in force now, so the legs following it move too.
    if (typeof carryDefaultSpeedToRoute === 'function') carryDefaultSpeedToRoute();
    for (const [id, keys] of [['waypoint-color', ['waypointFillColor']],
      ['leg-arrow-color', ['legKiteFillColor', 'cumKiteFillColor']]]) {
      const el = document.getElementById(id);
      if (el) el.value = tune(keys[0]);
    }
    if (!n) return;
    if (typeof applyTuningCssVars === "function") applyTuningCssVars();
    // Gist may have flipped a default-layer-visibility bool — reconcile the
    // toolbar checkboxes for any toggle the user hasn't explicitly set.
    if (NavAid && typeof NavAid.applyDefaultVisibility === "function") NavAid.applyDefaultVisibility();
    // The gist may have turned base layers on or off -- rebuild the picker to match.
    if (typeof rebuildLayerPicker === "function") rebuildLayerPicker();
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
// 00/03/06/12/18Z valid times, so one #wx-time dropdown drives both.
//
// The option value carries the DAY as well as the valid time ("05/08/2026|18:00"), because
// the two feeds do not always offer the same days: deduping on the valid string alone let
// PWX's 18:00 on the 5th swallow SIGWX's 18:00 on the 4th, and since each overlay resolved
// its own entry by valid alone, whichever feed lost the race then rendered a chart 24 h from
// the day printed on the selected option. Use NavWxTime.match(entry) to resolve rather than
// comparing to the raw value.
const NavWxTime = (function () {
  const KEY = 'navaid.wxTime';
  const sel = document.getElementById('wx-time');
  // The pilot's own choice, which nothing may override. Everything else is a default the
  // dropdown is still free to improve as more options arrive: PWX and SIGWX are fetched
  // independently, so seeding once off whichever answered first made RESPONSE ORDER decide
  // the default. Near midnight PWX could seed yesterday's 18:00 and a later SIGWX response
  // could add today's 00:00 without selecting it -- the newer chart visibly in the list,
  // the overlay nearly six hours stale.
  let pinned = false;
  // Consumers of the shared selection. The overlays used to listen for the DOM `change`
  // event only, which a programmatic assignment does not fire -- so re-seeding moved the
  // dropdown to a newer valid time while an already-drawn overlay kept its old PNG, and
  // the UI labelled an 18:00 chart as 00:00. Anything that renders the selected time
  // subscribes here instead and is told whether the pilot made the change.
  const subs = [];
  function notify(programmatic) {
    for (const fn of subs) {
      try { fn({ programmatic: !!programmatic }); } catch (e) { /* one bad subscriber */ }
    }
  }
  // Merge a feed's times into the dropdown (deduped by valid), and seed the
  // initial selection once — the saved time if still offered, else nearest now.
  // "day|valid", or just "valid" when the feed gives no day.
  const keyOf = t => (t && t.day ? t.day + '|' + t.valid : (t ? String(t.valid || '') : ''));
  function parse(v) {
    const s = String(v || '');
    const i = s.indexOf('|');
    return i < 0 ? { day: '', valid: s } : { day: s.slice(0, i), valid: s.slice(i + 1) };
  }
  function ensure(times) {
    if (!sel || !Array.isArray(times)) return;
    const have = new Set(Array.from(sel.options, o => o.value));
    for (const t of times) {
      if (!t || !t.valid || have.has(keyOf(t))) continue;
      const o = document.createElement('option');
      o.value = keyOf(t);
      o.textContent = (t.day ? t.day + ' ' : '') + t.valid + 'Z';
      sel.appendChild(o); have.add(o.value);
    }
    // Chronological, so a 00:00 belonging to tomorrow does not sort above today's 18:00.
    const opts = Array.from(sel.options).sort((a, b) => {
      const A = parse(a.value), B = parse(b.value);
      const norm = d => String(d).split('/').reverse().join('');   // dd/mm/yyyy -> yyyymmdd
      return (norm(A.day) + A.valid).localeCompare(norm(B.day) + B.valid);
    });
    for (const o of opts) sel.appendChild(o);
    reseed();
  }
  // Choose the default. Re-run on every merge until the selection is pinned, so a feed that
  // arrives second can still supply a closer time.
  function reseed() {
    if (pinned || !sel || !sel.options.length) return;
    const was = sel.value;
    const changed = () => { if (sel.value !== was) notify(true); };
    let saved = '';
    try { saved = lsGet(KEY) || ''; } catch (e) {}
    const savedValid = parse(saved).valid;
    const exact = Array.from(sel.options).find(o => o.value === saved);
    if (exact) {
      // A day-qualified stored value is a decision this pilot made earlier, not a guess:
      // honour it and stop reconsidering.
      sel.value = exact.value;
      if (parse(saved).day) pinned = true;
      changed();
      return;
    }
    // A value stored by a build that keyed on the valid time alone: the HOUR is a real
    // preference, the day was never recorded. Keep the hour and let imsNearestTimeIndex pick
    // which day of it -- assuming the first one offered put the pilot on yesterday's chart.
    const sameHour = savedValid &&
      Array.from(sel.options).filter(o => parse(o.value).valid === savedValid);
    if (sameHour && sameHour.length) {
      const i = Math.max(0, imsNearestTimeIndex(sameHour.map(o => parse(o.value))));
      sel.value = sameHour[i].value;
      changed();
      return;
    }
    // ...and the day goes to imsNearestTimeIndex, which has always known how to use one.
    // Without it every hour was assumed to be TODAY, so at 23:45 the dropdown seeded to a
    // chart hours old instead of the one about to become valid.
    sel.selectedIndex = Math.max(0, imsNearestTimeIndex(
      Array.from(sel.options, o => parse(o.value))));
    changed();
  }
  // Move to a time the caller can actually render, if the current one is not among them.
  // The dropdown accumulates options from both feeds and every PWX level, so a level change
  // used to leave a time selected that the new level does not publish: currentTime() then
  // found nothing and the overlay was REMOVED, even though that level had valid charts.
  // Changing level is itself a request to see that level, so this overrides a pin.
  function prefer(times, force) {
    if (!sel || !Array.isArray(times) || !times.length) return false;
    // A pinned choice stands unless the pilot just asked for a different level: PWX must not
    // drag the shared dropdown off a SIGWX-only time the pilot chose deliberately.
    if (pinned && !force) return false;
    const offered = times.filter(t => t && t.valid);
    if (!offered.length) return false;
    if (offered.some(t => api.match(t))) return false;          // already showable
    const keys = new Set(offered.map(keyOf));
    const usable = Array.from(sel.options).filter(o => keys.has(o.value));
    if (!usable.length) return false;
    const near = Math.max(0, imsNearestTimeIndex(usable.map(o => parse(o.value))));
    const was = sel.value;
    sel.value = usable[near].value;
    if (sel.value !== was) notify(true);
    return true;
  }
  if (sel) sel.addEventListener('change', () => {
    pinned = true;
    try { localStorage.setItem(KEY, sel.value); } catch (e) {}
    notify(false);
  });
  const api = {
    value: () => (sel ? sel.value : ''),
    // Does this manifest entry belong to the selected option? Both sides may lack a day
    // (older manifests), in which case the valid time is all there is to go on.
    match: t => {
      if (!sel || !t) return false;
      const sel1 = parse(sel.value);
      if (String(t.valid || '') !== sel1.valid) return false;
      if (!sel1.day || !t.day) return true;
      return String(t.day) === sel1.day;
    },
    ensure,
    prefer,
    // Called for BOTH a pilot change and a programmatic re-seed; the argument says which,
    // so a subscriber can redraw either way but only persist a real choice.
    onChange: fn => { if (typeof fn === 'function') subs.push(fn); },
  };
  return api;
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
    try { const s = parseFloat(lsGet(KEY)); if (!isNaN(s)) v = s; } catch (e) {}
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
    return lv && lv.times.find(t => NavWxTime.match(t));
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
  // `force` = the pilot just changed level, so landing on a renderable time outranks a
  // pinned one. Only ever moves the shared selection while this overlay is actually on.
  function fillTimes(force) {
    const lv = currentLevel();
    if (!lv) return;
    NavWxTime.ensure(lv.times);
    // ...then make sure the selection is one THIS level publishes, or the overlay would be
    // removed on a level change despite valid charts being available at the new level.
    if (cb.checked) NavWxTime.prefer(lv.times, force);
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
    // Switching the overlay ON is also a moment where the selected time has to be one this
    // level publishes -- otherwise it appears to do nothing at all.
    if (cb.checked) fillTimes(true);
    updateLayer(); persist();
  });
  levelSel.addEventListener('change', () => { fillTimes(true); updateLayer(); persist(); });
  NavWxTime.onChange(e => {
    updateLayer();
    // A re-seed is not a pilot pin, so it must not be written back as one.
    if (!e || !e.programmatic) persist();
  });
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
        const sv = JSON.parse(lsGet(KEY) || 'null');
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
  function hexToRgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
    const v = m ? parseInt(m[1], 16) : 0x1d4e89;
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }
  function cropPanel(url, crop, knockWhite) {
    // Map panel: drop the chart's pale paper AND terrain/sea (light + low
    // saturation) so the selected base layer (CVFR, etc.) shows through; the
    // saturated hazard areas + dark lines/labels stay. Table/header keep white.
    const thr = knockWhite ? Math.round(off('sigwxWhiteKnockout') || 170) : 999;
    const satThr = Math.round(off('sigwxKnockoutSat'));
    // Coast params only affect the knocked map panel — keep them out of the
    // table/header cache keys so coast tuning can't invalidate those crops.
    const coastKey = knockWhite
      ? off('sigwxCoastWidthPx') + '|' +
        (typeof tune === 'function' ? tune('sigwxCoastColor') : '') + '|' +
        (typeof tune === 'function' ? tune('sigwxCoastAlpha') : '')
      : '';
    const key = url + '|' + crop.x0 + '|' + crop.y0 + '|' + thr + '|' + satThr + '|' + coastKey;
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
            const n = sw * sh;
            const cw = Math.max(0, Math.round(off('sigwxCoastWidthPx')));
            if (cw === 0) {
              // Coastline off (the default): plain single-pass knockout, no
              // scratch buffers.
              for (let i = 0; i < d.length; i += 4) {
                const r = d[i], g = d[i + 1], b = d[i + 2];
                const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                if (mx >= thr && (mx - mn) <= satThr) d[i + 3] = 0;
              }
            } else {
              // Pass 1 — classify. The chart draws no coastline stroke: the
              // coast is only the boundary between the pale-blue sea fill and
              // the pale land/paper, and the knockout erases both. Detect sea
              // pixels (pale AND blue-leaning) to re-stroke that boundary.
              const sea = new Uint8Array(n);
              const knock = new Uint8Array(n);
              for (let p = 0, i = 0; p < n; p++, i += 4) {
                const r = d[i], g = d[i + 1], b = d[i + 2];
                const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                if (mx >= thr && (mx - mn) <= satThr) {
                  knock[p] = 1;
                  if (b - r >= 10 && b >= g) sea[p] = 1;
                }
              }
              // Pass 2 — coastline = sea pixel with a knocked non-sea
              // neighbour (paper/terrain), thickened to cw. Marking is
              // clamped per row (no wrap to the opposite edge) and gated on
              // knock[q] so preserved dark ink (labels, hazard outlines) is
              // never painted over.
              const coast = new Uint8Array(n);
              for (let y = 1; y < sh - 1; y++) {
                for (let x = 1; x < sw - 1; x++) {
                  const p = y * sw + x;
                  if (!sea[p]) continue;
                  if ((knock[p - 1] && !sea[p - 1]) || (knock[p + 1] && !sea[p + 1]) ||
                      (knock[p - sw] && !sea[p - sw]) || (knock[p + sw] && !sea[p + sw])) {
                    for (let dy = -(cw - 1); dy <= cw - 1; dy++) {
                      const ny = y + dy;
                      if (ny < 0 || ny >= sh) continue;
                      for (let dx = -(cw - 1); dx <= cw - 1; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= sw) continue;
                        const q = ny * sw + nx;
                        if (knock[q]) coast[q] = 1;
                      }
                    }
                  }
                }
              }
              // Pass 3 — knock out the pale fills, then paint the coastline.
              const cc = hexToRgb(typeof tune === 'function' ? tune('sigwxCoastColor') : '#1d4e89');
              const ca = Math.round(255 * (typeof tune === 'function' ? tune('sigwxCoastAlpha') : 0.9));
              for (let p = 0, i = 0; p < n; p++, i += 4) {
                if (coast[p]) {
                  d[i] = cc.r; d[i + 1] = cc.g; d[i + 2] = cc.b; d[i + 3] = ca;
                } else if (knock[p]) {
                  d[i + 3] = 0;
                }
              }
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
    return manifest && manifest.times.find(t => NavWxTime.match(t));
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
  // Cropping a SIGWX panel is asynchronous (image decode + canvas), and the pilot can
  // change the valid time while one is in flight. Without a generation token a slower crop
  // of the OLD chart lands after the new one and paints stale weather under the new label
  // -- the same class of defect as the simulator's ended-session poll.
  let sigwxGen = 0;
  function updateLayer() {
    const gen = ++sigwxGen;
    if (!cb.checked || !manifest) { removeLayers(); return; }
    const t = currentTime();
    if (!t) { removeLayers(); return; }
    const url = RAW + t.png + '?t=' + (manifest.generatedAt || '');
    cropPanel(url, CROP_MAP, true).then(data => {
      if (gen !== sigwxGen) return;                 // a newer selection won
      if (!cb.checked) { removeLayers(); return; }
      place('map', data, boundsFrom(BOUNDS_MAP, 'sigwxLatOffset', 'sigwxLngOffset', 'sigwxLatScale', 'sigwxLngScale'), NavWxOpacity.value());
      applyRotation();
    }).catch(() => {
      // Guarded exactly like the success path above. Without the generation check an OLD
      // request rejecting late (slow decode, transient CORS) tore down the overlay a NEWER
      // selection had already placed: the chart went blank while the checkbox stayed on and
      // #wx-time still read the new time, so nothing on screen said the weather was gone.
      if (gen !== sigwxGen || !cb.checked) return;
      removeLayers();
    });
    const tblOp = off('sigwxTblOpacity') || 0.92;
    const tblBounds = boundsFrom(BOUNDS_TABLE, 'sigwxTblLatOffset', 'sigwxTblLngOffset', 'sigwxTblScale', 'sigwxTblScale');
    cropPanel(url, CROP_TABLE, false).then(data => {
      if (gen !== sigwxGen || !cb.checked) return;
      place('table', data, tblBounds, tblOp);
    }).catch(() => { /* table optional */ });
    // Title header: full-width strip shrunk to the table's width, parked just
    // above the table (height keeps the strip's aspect at that width).
    cropPanel(url, CROP_HEADER, false).then(data => {
      if (gen !== sigwxGen || !cb.checked) return;
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
  NavWxTime.onChange(e => {
    updateLayer();
    if (!e || !e.programmatic) persist();     // a re-seed is not a pilot pin
  });
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
      try { saved = JSON.parse(lsGet(KEY) || 'null'); } catch (e) { /* */ }
      // The shared #wx-time dropdown was seeded to now (Zulu) by NavWxTime.
      if (saved && saved.on) { cb.checked = true; controls.hidden = false; updateLayer(); }
    })
    .catch(() => { /* manifest unreachable → stay hidden */ });
})();

// --- Default layer visibility ---------------------------------------------
// Reconcile the toolbar layer/display checkboxes to the tune-registry defaults
// (which the gist can override) for any toggle the current user has NOT set
// explicitly. Each row is [checkbox id, localStorage key, tune key]; the tune
// key's baked value mirrors the checkbox's shipped default, so for a nogist
// user this is a no-op — it only bites when the gist (or the ?tune=1 panel)
// flips a default. We dispatch the checkbox's own 'change' so every existing
// loader (network fetch, layer add, redraw) runs unchanged, then erase the key
// the handler persisted so the toggle stays gist-controlled next load.
NavAid.defaultVisibilityMap = [
  ['navwp-cb', 'navaid.showNavWP', 'defaultShowNavWP'],
  ['airfield-cb', 'navaid.showAirfields', 'defaultShowAirfields'],
  ['vor-cb', 'navaid.showVorStations', 'defaultShowVor'],
  ['wpname-cb', 'navaid.showWpNames', 'defaultShowWpNames'],
  ['cumtime-cb', 'navaid.showCumTime', 'defaultShowCumTime'],
  ['drift-cb', 'navaid.showDrift', 'defaultShowDrift'],
  ['commchange-cb', 'navaid.showFreqChanges', 'defaultShowCommChange'],
  ['mid-cb', 'navaid.showMidLeg', 'defaultShowMidLeg'],
  ['diff-cb', 'navaid.highlightDiff', 'defaultHighlightDiff'],
  ['limit-kites-cb', 'navaid.limitLegKites', 'defaultLimitLegKites'],
  ['msa-cb', 'navaid.showMsa', 'defaultShowMsa'],
  ['reporting-cb', 'navaid.showReporting', 'defaultShowReporting'],
  ['force-snap-cb', 'navaid.forceSnap', 'defaultForceSnap'],
  ['ret-cb', 'navaid.showReturn', 'defaultShowReturn'],
  // Per-chart key (see notamPrefKey): a plain string would consult the legacy
  // shared key, conclude the pilot had never chosen, and stamp the shipped
  // default over the current chart's real preference.
  ['notam-cb', () => notamPrefKey(), 'defaultShowNotam'],
  ['show-wind-cb', 'navaid.showWind', 'defaultShowWind'],
  ['windfield-cb', 'navaid.windField', 'defaultWindField'],
  ['ims-pwx-cb', 'navaid.imsPwx', 'defaultImsPwx'],
  ['sigwx-ov-cb', 'navaid.sigwxOv', 'defaultSigwxOv'],
  ['lsa-cb', 'navaid.showLsaBubbles', 'defaultShowLsaBubbles'],
  ['autoroute-cb', 'navaid.autoRoute', 'defaultAutoRoute'],
  ['circuit-cb', 'navaid.showCircuit', 'defaultShowCircuit'],
  ['training-cb', 'navaid.showTraining', 'defaultShowTraining'],
  ['cvfr-cb', 'navaid.showCvfr', 'defaultShowCvfr'],
  ['heli-cb', 'navaid.showHeli', 'defaultShowHeli'],
  ['commfail-cb', 'navaid.showCommfail', 'defaultShowCommfail'],
];
NavAid.applyDefaultVisibility = function applyDefaultVisibility() {
  if (typeof tune !== 'function') return;
  for (const [cbId, lsKeyRaw, tuneKey] of NavAid.defaultVisibilityMap) {
    const cb = document.getElementById(cbId);
    if (!cb) continue;                                   // not wired yet
    // A row may carry a function when its key depends on state (the NOTAM
    // overlay is remembered per chart).
    const lsKey = typeof lsKeyRaw === 'function' ? lsKeyRaw() : lsKeyRaw;
    let stored = null;
    try { stored = lsGet(lsKey); } catch (e) { /* */ }
    if (stored !== null) continue;                       // user set this — leave it
    const desired = !!tune(tuneKey);
    if (cb.checked === desired) continue;                // already matches
    cb.checked = desired;
    cb.dispatchEvent(new Event('change'));               // run the real loader
    // The handler persisted lsKey synchronously; erase it so this toggle keeps
    // following the gist/default (rather than freezing after the first boot).
    try { localStorage.removeItem(lsKey); } catch (e) { /* */ }
  }
};
// Baked defaults mirror the shipped checkbox state, so this first pass is a
// no-op for a nogist user; the gist .then() re-runs it once overrides land.
NavAid.applyDefaultVisibility();

// Keep the empty-route nudge in step with the route. draw() runs on every route
// change, so wrap it once rather than touching every mutation site.
refreshEmptyRouteHint();
if (!window.__navaidHintWrapped) {
  window.__navaidHintWrapped = true;
  const _origDraw = window.draw;
  window.draw = function (...a) {
    const r = _origDraw.apply(this, a);
    try { refreshEmptyRouteHint(); } catch (e) { /* never break a draw */ }
    return r;
  };
}
