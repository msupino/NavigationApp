'use strict';
/* NavAid — toolbar wiring, toolbar drag, boot, PWA.
   Shares globals with core.js; loaded last. */

// --- toolbar ---------------------------------------------------------
function setMode(mode) {
  // Clicking the currently-active mode button toggles back to inspect (null).
  if (state.mode === mode) mode = null;
  state.mode = mode;
  document.getElementById('tool-add').classList.toggle('active', mode === 'add');
  document.getElementById('tool-note').classList.toggle('active', mode === 'note');
  document.getElementById('map').classList.toggle('add', mode === 'add' || mode === 'note');
}
document.getElementById('tool-add').onclick = () => setMode('add');
document.getElementById('tool-note').onclick = () => setMode('note');
document.getElementById('app-version').textContent = 'v' + NavAid.version;

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
const ROT_DRAG_PX = 8;                 // min movement before treating as a drag
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
    if (Math.hypot(e.clientX - rotStartX, e.clientY - rotStartY) < ROT_DRAG_PX) return;
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
const BEARING_KEY = 'navaid.bearing';
try {
  // Defensive: an older build (or a manual edit) may have stored "NaN".
  // Number.isFinite rejects NaN / Infinity so we fall back to bearing 0.
  const sb = parseFloat(localStorage.getItem(BEARING_KEY));
  if (Number.isFinite(sb)) map.setBearing(sb);
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
refreshDial();

// --- nav-waypoint search --------------------------------------------
const wpSearch = document.getElementById('wp-search');
const wpResults = document.getElementById('wp-search-results');
function closeSearch() {
  wpResults.classList.add('hidden');
  wpResults.innerHTML = '';
}
function runSearch() {
  const qRaw = wpSearch.value.trim();
  const q = qRaw.toUpperCase();
  if (!q) { closeSearch(); return; }
  const hits = [];
  // Airfields surface first — small (16-entry) high-signal set: ICAO,
  // English label, and Hebrew label all matched substring.
  if (airfields && airfields.length) {
    for (const a of airfields) {
      if (a.name.toUpperCase().indexOf(q) >= 0 ||
          (a.en && a.en.toUpperCase().indexOf(q) >= 0) ||
          (a.he && a.he.indexOf(qRaw) >= 0)) {
        hits.push({ kind: 'af', entry: a });
      }
    }
  }
  if (navWP && navWP.length) {
    for (const w of navWP) {
      if (w.name.toUpperCase().indexOf(q) >= 0 ||
          (w.he && w.he.indexOf(qRaw) >= 0)) {
        hits.push({ kind: 'wp', entry: w });
      }
    }
  }
  if (!hits.length) { closeSearch(); return; }
  wpResults.innerHTML = '';
  const wpField = S.navWpSearchField;
  const afField = S.airfieldLabelField;
  for (const h of hits.slice(0, 12)) {
    const w = h.entry;
    const item = document.createElement('div');
    item.className = 'wp-search-item';
    let primary, alt;
    if (h.kind === 'af') {
      primary = w.name;                  // ICAO is always shown first
      alt = (w[afField] || w.en || '');
      if (alt === primary) alt = '';
    } else {
      primary = w[wpField] || w.name;
      alt = wpField === 'he' ? w.name : (w.he || '');
    }
    item.textContent = alt && alt !== primary ? primary + ' / ' + alt : primary;
    item.onclick = () => {
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
    const first = wpResults.querySelector('.wp-search-item');
    if (first) first.click();
  } else if (e.key === 'Escape') {
    closeSearch();
    wpSearch.value = '';
  }
});
document.addEventListener('click', e => {
  if (!e.target.closest('.navsearch')) closeSearch();
});
document.getElementById('reverse').onclick = () => {
  // Reversing flight direction means each leg's inbound/outbound roles swap.
  // The leg's local axes (along + perpendicular) also flip, so negating the
  // label offsets keeps the markers visually pinned to the same map pixels.
  state.waypoints.reverse();
  state.legs = state.legs.reverse().map(l => ({
    inboundAltitude: l.outboundAltitude,
    outboundAltitude: l.inboundAltitude,
    flightSpeed: l.flightSpeed,
    inLabel: { a: -l.outLabel.a, p: -l.outLabel.p },
    outLabel: { a: -l.inLabel.a, p: -l.inLabel.p },
  }));
  state.selected = null;
  showInspector(); draw();
};
document.getElementById('clear').onclick = () => {
  if ((state.waypoints.length || state.notes.length) &&
      !confirm(S.clearConfirm)) return;
  state.waypoints = [];
  state.legs = [];
  state.notes = [];
  state.selected = null;
  showInspector(); draw();
};
document.getElementById('save').onclick = save;
document.getElementById('load').onclick = () => document.getElementById('file').click();
document.getElementById('file').onchange = e => {
  if (e.target.files[0]) load(e.target.files[0]);
  e.target.value = '';
};
document.getElementById('fit').onclick = fitView;
document.getElementById('fly').onclick = flyRoute;
const GE_MODE_KEY = 'navaid.geMode';
try {
  const stored = localStorage.getItem(GE_MODE_KEY);
  if (stored === 'app' || stored === 'web') window.geMode = stored;
} catch (e) { /* storage unavailable */ }
document.getElementById('ge-mode-select').value = geMode;
document.getElementById('ge-mode-select').onchange = e => {
  window.geMode = e.target.value;
  try { localStorage.setItem(GE_MODE_KEY, geMode); } catch (err) { /* */ }
};
document.getElementById('plan').onclick = showFlightPlan;
const RETURN_KEY = 'navaid.showReturn';
const MIDLEG_KEY = 'navaid.showMidLeg';
try {
  const sr = localStorage.getItem(RETURN_KEY);
  if (sr !== null) window.showReturn =sr === '1';
  const sm = localStorage.getItem(MIDLEG_KEY);
  if (sm !== null) window.showMidLeg =sm === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('ret-cb').checked = showReturn;
document.getElementById('mid-cb').checked = showMidLeg;
document.getElementById('ret-cb').onchange = e => {
  window.showReturn =e.target.checked;
  try { localStorage.setItem(RETURN_KEY, showReturn ? '1' : '0'); } catch (err) { /* */ }
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
  if (showNavWP) await loadNavWaypoints();
  draw();
};
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
  if (showAirfields) await loadAirfields();
  draw();
};
const ALPHA_KEY = 'navaid.yellowAlpha';
try {
  const v = parseFloat(localStorage.getItem(ALPHA_KEY));
  if (!isNaN(v)) window.yellowAlpha =Math.max(0, Math.min(1, v));
} catch (e) { /* storage unavailable */ }
document.getElementById('yellow-alpha').value = Math.round(yellowAlpha * 100);
document.getElementById('yellow-alpha').oninput = e => {
  window.yellowAlpha =parseFloat(e.target.value) / 100;
  try { localStorage.setItem(ALPHA_KEY, String(yellowAlpha)); }
  catch (err) { /* storage unavailable */ }
  draw();
};
const MAPOPACITY_KEY = 'navaid.mapOpacity';
let mapOpacity = 1;
function applyMapOpacity() {
  for (const n in layers) {
    if (map.hasLayer(layers[n])) layers[n].setOpacity(mapOpacity);
  }
}
try {
  const v = parseFloat(localStorage.getItem(MAPOPACITY_KEY));
  if (!isNaN(v)) mapOpacity = Math.max(0.1, Math.min(1, v));
} catch (e) { /* storage unavailable */ }
document.getElementById('map-opacity').value = Math.round(mapOpacity * 100);
applyMapOpacity();
document.getElementById('map-opacity').oninput = e => {
  mapOpacity = parseFloat(e.target.value) / 100;
  applyMapOpacity();
  try { localStorage.setItem(MAPOPACITY_KEY, String(mapOpacity)); }
  catch (err) { /* storage unavailable */ }
};
const WPSIZE_KEY = 'navaid.wpSize';
try {
  const v = parseFloat(localStorage.getItem(WPSIZE_KEY));
  if (!isNaN(v)) window.wpSize =Math.max(0.6, Math.min(2, v));
} catch (e) { /* storage unavailable */ }
document.getElementById('wp-size').value = wpSize;
document.getElementById('wp-size').oninput = e => {
  window.wpSize =parseFloat(e.target.value);
  try { localStorage.setItem(WPSIZE_KEY, String(wpSize)); }
  catch (err) { /* storage unavailable */ }
  draw();
};

const LEGARROW_KEY = 'navaid.legArrowSize';
try {
  const v = parseFloat(localStorage.getItem(LEGARROW_KEY));
  if (!isNaN(v)) window.legArrowSize =Math.max(0.3, Math.min(2, v));
} catch (e) { /* storage unavailable */ }
document.getElementById('leg-arrow-size').value = legArrowSize;
document.getElementById('leg-arrow-size').oninput = e => {
  window.legArrowSize =parseFloat(e.target.value);
  try { localStorage.setItem(LEGARROW_KEY, String(legArrowSize)); }
  catch (err) { /* storage unavailable */ }
  draw();
};
const MAGVAR_KEY = 'navaid.magVar';
try {
  const v = parseFloat(localStorage.getItem(MAGVAR_KEY));
  if (!isNaN(v)) window.magVar =Math.max(-30, Math.min(30, v));
} catch (e) { /* storage unavailable */ }
function showMagVarEqv() {
  const span = document.getElementById('mag-var-eqv');
  if (!span) return;
  if (magVar === 0) span.textContent = '';
  else if (magVar < 0) span.textContent = `(${-magVar}°E)`;
  else span.textContent = `(${magVar}°W)`;
}
document.getElementById('mag-var').value = magVar;
showMagVarEqv();
document.getElementById('mag-var').oninput = e => {
  const v = parseFloat(e.target.value);
  if (isNaN(v)) return;
  window.magVar =Math.max(-30, Math.min(30, v));
  try { localStorage.setItem(MAGVAR_KEY, String(magVar)); }
  catch (err) { /* storage unavailable */ }
  showMagVarEqv();
  draw();
};
document.getElementById('page-a3').onclick = () => setPage('A3');
document.getElementById('page-a4').onclick = () => setPage('A4');
document.getElementById('print').onclick = exportPNG;
document.getElementById('insp-close').onclick = () => {
  state.selected = null;
  showInspector(); draw();
};

// --- toolbar drag ----------------------------------------------------
(function makeToolbarDraggable() {
  const bar = document.getElementById('toolbar');
  const handle = document.getElementById('toolbar-handle');
  const KEY = 'navaid.toolbarPos';
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

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      requestAnimationFrame(() => setPos(p.x, p.y));
    }
  } catch (e) { /* storage unavailable */ }

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
    try { localStorage.setItem(KEY, JSON.stringify({ x: r.left, y: r.top })); }
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

  const COLLAPSED_KEY = 'navaid.toolbarCollapsed';

  // collapse / expand the toolbar (keeps just the handle + toggle)
  const toggle = document.getElementById('toolbar-toggle');
  function setCollapsed(on) {
    bar.classList.toggle('collapsed', on);
    toggle.title = on ? S.expandMenu : S.collapseMenu;
    try { localStorage.setItem(COLLAPSED_KEY, on ? '1' : '0'); } catch (e) { /* */ }
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
  const sc = localStorage.getItem(COLLAPSED_KEY);
  setCollapsed(sc === null ? false : sc === '1');

  window.addEventListener('resize', () => {
    if (bar.style.left) setPos(parseFloat(bar.style.left), parseFloat(bar.style.top));
  });
})();

// --- section toggles -------------------------------------------------
(function makeSectionToggle() {
  document.querySelectorAll('.tb-section-head').forEach(head => {
    const sec = head.closest('.tb-section');
    const key = 'navaid.sec.' + sec.dataset.sec;
    try {
      if (localStorage.getItem(key) === '1') sec.classList.add('open');
    } catch (e) { /* storage unavailable */ }
    function toggle() {
      sec.classList.toggle('open');
      try { localStorage.setItem(key, sec.classList.contains('open') ? '1' : '0'); }
      catch (e) { /* storage unavailable */ }
    }
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });
})();

// --- boot ------------------------------------------------------------
resizeOverlay();
setMode(null);
// restoreRoute() returns 'corrupt' when the saved blob exists but is
// unparseable / has invalid coords. Set a flag so persist() refuses to
// overwrite the (potentially recoverable) blob with empty state — see #73.
const _restoreResult = restoreRoute();
if (_restoreResult === 'corrupt') {
  NavAid.corruptCache = true;
  const msg = S.errSavedRouteCorrupt(NavAid.corruptCacheError || '');
  console.warn('NavAid: ' + msg);
  alert(msg);
}
if (state.waypoints.length) fitView();   // always frame the restored route
draw();
// Always load nav-waypoints in the background — they power both the
// overlay toggle and the auto-snap on drop / drag.
loadNavWaypoints().then(draw);
// Same pattern for airfields: powering both the overlay and snap.
loadAirfields().then(draw);

// --- PWA: service worker --------------------------------------------
// Registering the worker makes the app installable; the browser shows
// the install control in the address bar — no in-app button needed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch(() => { /* offline mode unavailable */ });
  });
}
