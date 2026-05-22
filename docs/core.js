'use strict';

/* ------------------------------------------------------------------ *
 * NavAid — HTML5 CVFR flight-route planner.
 * Leaflet base map (flight-maps.com tiles) + a canvas route overlay.
 * ------------------------------------------------------------------ */

// One-time migration: the app was renamed from "Plotter" — carry over any
// localStorage values saved under the old "plotter." prefix.
try {
  for (const k of Object.keys(localStorage)) {
    if (k.indexOf('plotter.') === 0) {
      const nk = 'navaid.' + k.slice(8);
      if (localStorage.getItem(nk) === null) {
        localStorage.setItem(nk, localStorage.getItem(k));
      }
      localStorage.removeItem(k);
    }
  }
} catch (e) { /* storage unavailable */ }

const EARTH_NM = 3440.065;             // mean Earth radius, nautical miles
let magVar = -5;                       // signed offset added to true heading
                                       // (Israel ≈ −5; equivalent to 5°E variation)

// Localisation strings. he/strings.js pre-sets window.S to Hebrew before
// core.js runs; the || here keeps English as the default for the main app.
window.S = window.S || {
  navWpUrl: 'nav-waypoints.json?v=2',  // relative URL — he/ overrides to ../
  navWpSearchField: 'name',            // which field to show/search in results
  wpPrefix: 'WP ',
  noteDefault: 'Note',
  errLoadFile: 'Could not load file: ',
  errNoLegs: 'No legs yet — drop at least two waypoints first.',
  flightPlan: 'Flight plan',
  fpHeaders: ['#', 'From', 'To', 'Hdg', 'Dist (NM)', 'Speed (kt)', 'Alt (ft)', 'Time'],
  fpTotal: 'Total',
  fpClose: 'Close',
  pageOrientation: ' page — orientation',
  landscape: 'Landscape',
  portrait: 'Portrait',
  cancel: 'Cancel',
  saving: '⏳ Saving…',
  errPngFail: 'PNG export failed (a map tile could not be loaded).',
  errTilesFail: function(f, t) { return f + ' of ' + t + ' map tiles failed to load — the PNG may have blank patches. Re-run the export to retry.'; },
  errNeedWps: 'Add at least two waypoints first.',
  flyConfirm: 'Fly the route in Google Earth Pro (desktop).\n\nPress OK to save the tour file (.kml), then open it in Google Earth — the “Fly the route” tour appears under Places; press play to fly the route ~5000 ft above the terrain.\n\nNo Google Earth? Free desktop app: google.com/earth/versions',
  legTitle: function(n) { return 'Leg ' + n; },
  speedKt: 'Speed (kt)',
  inboundAlt: 'Inbound alt (ft)',
  outboundAlt: 'Outbound alt (ft)',
  shape: 'Shape',
  shapeRect: 'Rectangle',
  shapeOval: 'Oval',
  color: 'Color',
  deleteNote: 'Delete note',
  deleteWp: 'Delete waypoint',
  latitude: 'Latitude',
  longitude: 'Longitude',
  dialTitle: function(b) { return 'Map rotation ' + b + '° — drag to rotate, click for north up'; },
  wpnameRotTitle: function(a) { return 'Rotate waypoint names (now ' + a + '°)'; },
  clearConfirm: 'Remove all waypoints and notes?',
  expandMenu: 'Expand menu',
  collapseMenu: 'Collapse menu',
};

// --- model -----------------------------------------------------------
const state = {
  waypoints: [],            // [{ lat, lng, name }]
  legs: [],                 // per-leg attributes (see newLeg)
  notes: [],                // [{ lat, lng, text }] — free-text annotations
  mode: null,               // 'add' | 'note' | null (= inspect)
  selected: null,           // { type:'wp'|'leg'|'note', index }
};
let showReturn = false;     // outbound (return) markers — off by default
let showMidLeg = false;
let highlightDiff = false;  // purple halo on legs that change altitude
let showNavWP = true;       // Israeli VFR reporting-point overlay (default on)
let navWP = null;           // null = not loaded; [] = loaded empty/error
let showWpNames = true;     // draw waypoint names (off = empty circle)
let wpNameAngle = 0;        // waypoint-name rotation: 0 / 90 / 180 / 270 deg
let yellowAlpha = 1;        // global multiplier for yellow label backgrounds
let wpSize = 1;             // waypoint name / number text size scale
let pageSize = null;        // null | 'A3' | 'A4'
let pageOrient = 'landscape';   // 'landscape' | 'portrait'
let pageOffset = { x: 0, y: 0 };   // page-frame drag offset from viewport centre

// Yellow text-background colour with the global opacity scale applied.
const yellowFill = (a) => `rgba(255,246,170,${a * yellowAlpha})`;

// Tinted fill from any "#rrggbb" hex with `a` (× yellowAlpha) for the alpha.
function tintFill(hex, a) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return yellowFill(a);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a * yellowAlpha})`;
}

const NOTE_DEFAULT_COLOR = '#fff6aa';   // matches the existing yellow fill

const newLeg = () => ({
  inboundAltitude: 2000,
  outboundAltitude: 2000,
  flightSpeed: 90,
  inLabel: { a: 0, p: 44 },            // marker offset: along leg, perpendicular
  outLabel: { a: 0, p: -44 },
});

// --- helpers ---------------------------------------------------------
function geo(a, b) {                   // a,b = {lat,lng} -> {dist NM, brg deg}
  const rad = d => (d * Math.PI) / 180;
  const phi1 = rad(a.lat), phi2 = rad(b.lat);
  const dphi = rad(b.lat - a.lat), dlam = rad(b.lng - a.lng);
  const h = Math.sin(dphi / 2) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  const dist = 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(dlam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlam);
  return { dist, brg: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}
function toMagnetic(deg) {
  // Magnetic = True + magVar (so −5 means "subtract 5", i.e. 5°E variation).
  return ((Math.round(deg + magVar) % 360) + 360) % 360;
}
const pad3 = n => String(n).padStart(3, '0');
function toHMS(hours) {
  const tm = hours * 60;
  let m = Math.floor(tm);
  let s = Math.round(((tm - m) * 60) / 5) * 5;
  if (s >= 60) { s -= 60; m++; }
  return m + ':' + String(s).padStart(2, '0');
}
function fmtLatLng(v, pos, neg) {
  const hemi = v >= 0 ? pos : neg;
  v = Math.abs(v);
  const d = Math.floor(v);
  const m = (v - d) * 60;
  return `${d}°${m.toFixed(1).padStart(4, '0')}'${hemi}`;
}

// --- Leaflet map -----------------------------------------------------
// Layer set mirrors ifl.flight-maps.com (excluding Israel Hiking).
const TILE = { minZoom: 6, maxZoom: 16, maxNativeZoom: 13 };
const FM_ATTR =
  'Charts © <a href="https://flight-maps.com">flight-maps.com</a> · CAAI';
const layers = {
  'CVFR': L.tileLayer('https://flight-maps.com/tiles/cvfr/{z}/{x}/{y}.png',
    { ...TILE, attribution: FM_ATTR }),
  'Nav': L.tileLayer('https://flight-maps.com/tiles/nav/{z}/{x}/{y}.png',
    { ...TILE, attribution: FM_ATTR }),
  'Low Alt': L.tileLayer('https://flight-maps.com/tiles/la/{z}/{x}/{y}.png',
    { ...TILE, attribution: FM_ATTR }),
  'Heli': L.tileLayer('https://flight-maps.com/tiles/il-hel/{z}/{x}/{y}.png',
    { ...TILE, maxNativeZoom: 12, attribution: FM_ATTR }),
  'Satellite': L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/' +
    'World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { minZoom: 6, maxZoom: 18, attribution: 'Imagery © Esri' }),
  'OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { minZoom: 6, maxZoom: 18, subdomains: 'abc',
      attribution: '© OpenStreetMap contributors' }),
};

const LAYER_KEY = 'navaid.layer';
let initialLayer = layers.CVFR;
try {
  const saved = localStorage.getItem(LAYER_KEY);
  if (saved && layers[saved]) initialLayer = layers[saved];
} catch (e) { /* storage unavailable */ }

const map = L.map('map', {
  center: [32.0, 34.9],
  zoom: 9,
  minZoom: 8,                  // do not zoom out past the chart extent
  maxZoom: 15,
  layers: [initialLayer],
  zoomControl: false,
  zoomAnimation: false,        // keep the canvas overlay in sync
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 120,    // gentler scroll-wheel zoom (default 60)
  wheelDebounceTime: 60,
  maxBounds: [[29.0, 33.9], [33.6, 36.4]],   // keep panning over Israel
  maxBoundsViscosity: 1.0,
  worldCopyJump: false,
  rotate: true,                // leaflet-rotate: enable map bearing
  rotateControl: false,        // own dial in the toolbar instead
  touchRotate: true,
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
// Base layer is chosen from the toolbar (#layer-select, wired in ui.js).

// --- route overlay canvas -------------------------------------------
const overlay = document.getElementById('overlay');
let octx = overlay.getContext('2d');   // reassigned during PNG export
let dpr = 1;

function vw() { return map.getSize().x; }
function vh() { return map.getSize().y; }

function resizeOverlay() {
  dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(vw() * dpr);
  overlay.height = Math.round(vh() * dpr);
  overlay.style.width = vw() + 'px';
  overlay.style.height = vh() + 'px';
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// scene point: project a waypoint to overlay (container) pixels
function proj(wp) {
  const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
  return { x: p.x, y: p.y };
}

// --- leg bookkeeping -------------------------------------------------
function syncLegs() {
  const need = Math.max(0, state.waypoints.length - 1);
  while (state.legs.length < need) state.legs.push(newLeg());
  while (state.legs.length > need) state.legs.pop();
}

