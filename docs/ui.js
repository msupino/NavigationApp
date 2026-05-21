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

// base map layer picker (replaces the Leaflet layers control)
const layerSelect = document.getElementById('layer-select');
for (const name in layers) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
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
  draw();                                // keep the route overlay on top
  try { localStorage.setItem(LAYER_KEY, layerSelect.value); }
  catch (e) { /* storage unavailable */ }
};
document.getElementById('reverse').onclick = () => {
  // Reversing flight direction means each leg's inbound/outbound roles swap.
  // The leg's local axes (along + perpendicular) also flip, so negating the
  // label offsets keeps the markers visually pinned to the same map pixels.
  // Waypoint name text is rotated 180° so the chart, when turned around to
  // fly the return route, still reads upright.
  state.waypoints = state.waypoints.reverse().map(w => ({
    ...w, flipped: !w.flipped,
  }));
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
      !confirm('Remove all waypoints and notes?')) return;
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
document.getElementById('plan').onclick = showFlightPlan;
document.getElementById('ret-cb').onchange = e => {
  showReturn = e.target.checked;
  draw();
};
document.getElementById('mid-cb').onchange = e => {
  showMidLeg = e.target.checked;
  draw();
};
document.getElementById('wpname-cb').onchange = e => {
  showWpNames = e.target.checked;
  draw();
};
document.getElementById('diff-cb').onchange = e => {
  highlightDiff = e.target.checked;
  draw();
};
const NAVWP_KEY = 'navaid.showNavWP';
try {
  const stored = localStorage.getItem(NAVWP_KEY);
  // New users (null) get the default-on; '0' / '1' override.
  if (stored !== null) showNavWP = stored === '1';
} catch (e) { /* storage unavailable */ }
document.getElementById('navwp-cb').checked = showNavWP;
document.getElementById('navwp-cb').onchange = async e => {
  showNavWP = e.target.checked;
  try { localStorage.setItem(NAVWP_KEY, showNavWP ? '1' : '0'); }
  catch (err) { /* storage unavailable */ }
  if (showNavWP) await loadNavWaypoints();
  draw();
};
const ALPHA_KEY = 'navaid.yellowAlpha';
try {
  const v = parseFloat(localStorage.getItem(ALPHA_KEY));
  if (!isNaN(v)) yellowAlpha = Math.max(0, Math.min(1, v));
} catch (e) { /* storage unavailable */ }
document.getElementById('yellow-alpha').value = yellowAlpha;
document.getElementById('yellow-alpha').oninput = e => {
  yellowAlpha = parseFloat(e.target.value);
  try { localStorage.setItem(ALPHA_KEY, String(yellowAlpha)); }
  catch (err) { /* storage unavailable */ }
  draw();
};
const WPSIZE_KEY = 'navaid.wpSize';
try {
  const v = parseFloat(localStorage.getItem(WPSIZE_KEY));
  if (!isNaN(v)) wpSize = Math.max(0.6, Math.min(2, v));
} catch (e) { /* storage unavailable */ }
document.getElementById('wp-size').value = wpSize;
document.getElementById('wp-size').oninput = e => {
  wpSize = parseFloat(e.target.value);
  try { localStorage.setItem(WPSIZE_KEY, String(wpSize)); }
  catch (err) { /* storage unavailable */ }
  draw();
};
const MAGVAR_KEY = 'navaid.magVar';
try {
  const v = parseFloat(localStorage.getItem(MAGVAR_KEY));
  if (!isNaN(v)) magVar = Math.max(-30, Math.min(30, v));
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
  magVar = Math.max(-30, Math.min(30, v));
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

  // collapse / expand the toolbar (keeps just the handle + toggle)
  const toggle = document.getElementById('toolbar-toggle');
  const COLLAPSE_KEY = 'navaid.toolbarCollapsed';
  function setCollapsed(on) {
    bar.classList.toggle('collapsed', on);
    toggle.textContent = on ? '☰' : '▴';
    toggle.title = on ? 'Expand menu' : 'Collapse menu';
    try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); }
    catch (e) { /* storage unavailable */ }
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
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    const onPhone = window.matchMedia('(max-width: 680px)').matches;
    // phones start collapsed unless the user has explicitly expanded before
    if (stored === '1' || (stored === null && onPhone)) setCollapsed(true);
  } catch (e) { /* storage unavailable */ }

  window.addEventListener('resize', () => {
    if (bar.style.left) setPos(parseFloat(bar.style.left), parseFloat(bar.style.top));
  });
})();

// --- boot ------------------------------------------------------------
resizeOverlay();
setMode(null);
restoreRoute();
if (state.waypoints.length) fitView();   // always frame the restored route
draw();
// Always load nav-waypoints in the background — they power both the
// overlay toggle and the auto-snap on drop / drag.
loadNavWaypoints().then(draw);

// --- PWA: service worker --------------------------------------------
// Registering the worker makes the app installable; the browser shows
// the install control in the address bar — no in-app button needed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch(() => { /* offline mode unavailable */ });
  });
}
