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

// `version` is intentionally stable at 1.0; `-<short-sha>` is auto-appended
// at deploy time by .github/workflows/deploy.yml so the displayed toolbar
// string identifies the exact deployed commit. On localhost the literal stays
// unchanged, which is fine.
window.NavAid = { exporting: false, version: '1.0' };  // cross-file export flag (read by ui.js/io.js)

const EARTH_NM = 3440.065;             // mean Earth radius, nautical miles
// Mutable globals are declared with `var` (not `let`) so that they're a true
// property on the global object. ui.js writes to them via `window.foo = …` —
// a `let` binding would be a separate lexical binding from `window.foo` and
// the writes wouldn't propagate. The `var` form also silences CodeQL's
// js/missing-variable-declaration alert on those cross-file writes.
var magVar = -5;                       // signed offset added to true heading
                                       // (Israel ≈ −5; equivalent to 5°E variation)

// Localisation strings. A strings.js may pre-set window.S with overrides
// (full locale or just navWpUrl). Object.assign merges: defaults first,
// then any pre-set keys win, so a partial override doesn't erase the rest.
window.S = Object.assign({
  navWpUrl: 'nav-waypoints.json?v=3',  // resolved relative to index.html (docs/)
  navWpSearchField: 'name',            // which field to show/search in results
  airfieldsUrl: 'airfields.json?v=3',  // resolved relative to index.html (docs/)
  airfieldLabelField: 'en',            // which locale label to show on the overlay

  // --- Waypoint terminology -------------------------------------------
  // Rule: use the full word "Waypoint" (Title Case) in all user-facing
  // English strings — buttons, toggles, tooltips, dialogs. The single
  // exception is `wpPrefix`, the tight inline fallback label for unnamed
  // waypoints ("WP 3" / "נק׳ 3" in the inspector and flight plan) where
  // the abbreviation is intentional; DO NOT expand it to "Waypoint 3".
  wpPrefix: 'WP ',                                  // short prefix for unnamed waypoints — see rule above
  summaryWaypoints: 'Waypoints',                    // stats panel total
  tbAddWp: '✏️ Add Waypoint',                        // toolbar Edit button
  tbAddWpTitle: 'Click map to drop a waypoint (click button again to stop)',
  tbShowWpNames: 'Show Waypoint Names',             // Display toggle
  tbShowWpNamesTitle: 'Show waypoint names (off = empty circle)',
  tbWpSize: 'Waypoint Size',                        // Display slider label
  tbWpSizeTitle: 'Waypoint circle and name size',
  tbShowNavWp: 'Show/Pin Navigation Waypoints',     // Map overlay toggle
  tbShowNavWpTitle: 'Overlay published Israeli VFR reporting points',
  tbSearchPlaceholder: '🔍 Find Navigation Waypoint',
  tbSearchHint: 'Tip: type space-separated waypoint codes (e.g. LLHZ BAZRA DEROR SHARO HADRA) and press Enter to build a route.',
  errSearchUnknown: function(t) { return 'Unknown waypoint: ' + t; },
  searchReplaceConfirm: 'Replace the current route with these waypoints?',
  tbSearchOpen: '🔍 Find',
  tbSearchOpenTitle: 'Open the search overlay (Ctrl/Cmd-F)',
  deleteWp: 'Delete Waypoint',                      // inspector button
  clearConfirm: 'Remove all waypoints and notes?',
  errBadCoords: 'file has invalid waypoint coordinates',
  // --- end Waypoint terminology ---------------------------------------

  noteDefault: 'Note',
  errLoadFile: 'Could not load file: ',
  errStorageFull: 'Auto-save failed: browser storage is full. Export your route to keep it.',
  errInvalidRoute: function(msg) { return 'Invalid route file: ' + msg; },
  errInvalidNavWaypoints: function(msg) { return 'Invalid nav-waypoints data: ' + msg; },
  errInvalidAirfields: function(msg) { return 'Invalid airfields data: ' + msg; },
  errSavedRouteCorrupt: function(msg) {
    return 'Saved route could not be restored, so the original saved data was preserved. ' +
      'Export or inspect localStorage["navaid.route"] to recover it.' +
      (msg ? '\n\nDetails: ' + msg : '');
  },
  errNoLegs: 'No legs yet — drop at least two waypoints first.',
  flightPlan: 'Flight plan',
  fpHeaders: ['#', 'From', 'To', 'Hdg', 'Dist (NM)', 'Speed (kt)', 'Alt (ft)', 'Time', 'Fuel (gal)'],
  fpReturn: 'Return route',
  fpTotal: 'Total',
  fpClose: 'Close',
  fpPrint: 'Print',
  fpFuel: 'Fuel',
  tbAircraft: 'Aircraft',
  tbGph: 'Gallons per Hour',
  tbGphTitle: 'Fuel consumption, gallons per hour',
  tbTaxiGal: 'Taxi/T.O. (gal)',
  tbTaxiGalTitle: 'Startup + taxi + takeoff fuel allowance in gallons',
  fpTaxiTip: function(g) { return '+ ' + g.toFixed(1) + ' gal taxi / takeoff included in total'; },
  pageOrientation: ' page — orientation',
  landscape: 'Landscape',
  portrait: 'Portrait',
  cancel: 'Cancel',
  saving: '⏳ Saving…',
  errPngFail: 'PNG export failed (a map tile could not be loaded).',
  errTilesFail: function(f, t) { return f + ' of ' + t + ' map tiles failed to load — the PNG may have blank patches. Re-run the export to retry.'; },
  errNeedWps: 'Add at least two waypoints first.',
  flyConfirm: 'Fly the route in Google Earth Pro (desktop).\n\nPress OK to save the tour file (.kml), then open it in Google Earth — the “Fly the route” tour appears under Places; press play to fly above the terrain.\n\nNo Google Earth? Free desktop app: google.com/earth/versions',
  geWebConfirm: 'Open the route in Google Earth Web (browser).\n\nThe KML file will also be downloaded so you can drag it into the web page to see the full route.',
  chooseGeMode: 'Open in',
  geModeApp: 'Google Earth Pro (KML)',
  geModeWeb: 'Google Earth Web',
  legTitle: function(n) { return 'Leg ' + n; },
  legArrow: '→',                       // direction arrow in leg inspector title (LTR)
  speedKt: 'Speed (kt)',
  inboundAlt: 'Inbound alt (ft)',
  outboundAlt: 'Outbound alt (ft)',
  shape: 'Shape',
  shapeRect: 'Rectangle',
  shapeOval: 'Oval',
  color: 'Color',
  deleteNote: 'Delete note',
  latitude: 'Latitude',
  longitude: 'Longitude',
  dialTitle: function(b) { return 'Map rotation ' + b + '° — drag to rotate, click for north up'; },
  wpnameRotTitle: function(a) { return 'Rotate waypoint names (now ' + a + '°)'; },
  expandMenu: 'Expand menu',
  collapseMenu: 'Collapse menu',
  summaryLegs: 'Legs',
  summaryDist: 'Distance',
  summaryTime: 'Total time',
  kmlDocName: 'NavAid flythrough',
  kmlRouteName: 'Route',
  kmlTourName: 'Fly the route',
  layerLabels: { 'CVFR': 'CVFR', 'Navigation': 'Navigation', 'Low Alt': 'Low Alt',
                 'Helicopters': 'Helicopters', 'Satellite': 'Satellite', 'OpenStreetMap': 'OpenStreetMap' },
  // Toolbar static strings — filled into DOM by applyI18n() on boot
  tbHandleTitle: 'Drag to move',
  tbAddNote: '📝 Add Note',
  tbAddNoteTitle: 'Click map to drop a note (click button again to stop)',
  tbLayerLabel: 'Layer',
  tbLayerTitle: 'Base map layer',
  tbReverse: '⇄ Reverse Route',
  tbReverseTitle: 'Reverse route order',
  tbClear: '🗑 Clear map',
  tbClearTitle: 'Remove all waypoints and notes',
  tbExport: '⬇ Export',
  tbExportTitle: 'Export route as JSON',
  tbImport: '⬆ Import',
  tbImportTitle: 'Import route JSON',
  tbShare: '🔗 Share',
  tbShareTitle: 'Copy a shareable link to this route to the clipboard',
  shareCopied: 'Route link copied to clipboard',
  errShareTooLong: 'Route is too long for a share link (max 64 waypoints). Export as JSON and send the file instead.',
  tbFit: '⌖ Fit to screen',
  tbFitTitle: 'Fit route to view',
  tbPlan: '📋 Flight Plan',
  tbPlanTitle: 'Show flight plan table',
  tbCharts: '🗺️ Airport Charts',
  tbChartsTitle: 'Browse approach charts for all airfields',
  tbFly: '✈️ Open route in Google Earth',
  tbFlyTitle: 'Save a Google Earth tour of the route at the planned leg altitudes',
  tbShowReturn: 'Show return path',
  tbShowReturnTitle: 'Show return-direction (outbound) info',
  tbShowMidLeg: 'Show leg distance',
  tbShowMidLegTitle: 'Show distance badge at the middle of each leg',
  tbHighlightDiff: 'Highlight alt/speed diff',
  tbHighlightDiffTitle: 'Halo legs whose altitude or speed differs from the adjacent leg',
  tbShowDrift: 'Show drift lines',
  tbShowDriftTitle: 'Show 10-degree drift reference lines at each leg end',
  tbShowAirfields: 'Show/Pin Airfields',
  tbShowAirfieldsTitle: 'Overlay published Israeli airfields (BYOP source)',
  plates: 'Charts',
  runways: 'Runways',
  plateCategoryApproach: 'Approach',
  plateCategorySid: 'SID',
  plateCategoryStar: 'STAR',
  plateCategoryGround: 'Ground',
  plateCategoryVfr: 'VFR / Airport',
  plateCategoryOther: 'Other',
  plateOpen: 'Open',
  plateDownload: 'Download',
  plateOpenTab: 'Open in new tab',
  plateClose: 'Close',
  platesNone: 'No charts available — see official AIP',
  plateLoadError: 'Failed to load chart.',
  plateAttribution: 'Charts © Israel CAAI / Ministry of Transport — published in the AIP. Snapshot from ForeFlight Israel Base Pack 02-25 edition.',
  tbTransparency: 'Label Transparency',
  tbTransparencyTitle: 'Opacity of waypoint / leg / note label backgrounds',
  tbMapOpacity: 'Map opacity',
  tbMapOpacityTitle: 'Base map brightness',
  tbLegArrowSize: 'Leg arrow size',
  tbLegArrowSizeTitle: 'Leg info marker (heading / altitude / time) size',
  tbMagVar: 'Magnetic Variation',
  tbMagVarTitle: 'Signed offset added to true heading. Negative = east variation; positive = west.',
  tbPageA3Title: 'A3 print page',
  tbPageA4Title: 'A4 print page',
  tbOrientTitle: 'Orientation — click to toggle landscape / portrait',
  modalCloseTitle: 'Close',
  tbPrint: '⬇ Save PNG',
  tbPrintTitle: 'Save the framed map + route as a PNG',
  inspCloseTitle: 'Close',
  inspCloseLabel: 'Close',
  tbSecEdit: '✏️ Edit',
  tbSecMap: '🗺 Map',
  tbSecRoute: '📋 Route',
  tbSecDisplay: '👁 Display',
  tbSecPrint: '🖨 Print',
  tbSecBuild: '✏️ Edit',
  tbSecView: '👁 View',
  tbSecCharts: '📋 Charts',
  tbSecExport: '📤 Export/Import',
  tbViewSource: 'GitHub',
  tbWiki: 'Wiki',
  exportModalTitle: 'Export PNG',
  exportShowNavWP: 'Print Navigation Waypoints',
  exportShowAirfields: 'Print Airfields',
  exportShowWpNames: 'Print route waypoint names',
  exportShowDrift: 'Print drift lines',
  exportNoPageWarn: 'No page size selected — exported image ratio may not match a print page.',
  exportLayer: 'Layer',
  exportBtn: 'Export',
}, window.S || {});

// Fill data-i18n / data-i18n-title / data-i18n-placeholder / data-i18n-aria
// attributes from S. Called once after S is resolved.
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = S[el.dataset.i18n] || '';
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = S[el.dataset.i18nTitle] || '';
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = S[el.dataset.i18nPlaceholder] || '';
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', S[el.dataset.i18nAria] || '');
  });
}
applyI18n();

// --- model -----------------------------------------------------------
const state = {
  waypoints: [],            // [{ lat, lng, name }]
  legs: [],                 // per-leg attributes (see newLeg)
  notes: [],                // [{ lat, lng, text }] — free-text annotations
  mode: null,               // 'add' | 'note' | null (= inspect)
  selected: null,           // { type:'wp'|'leg'|'note', index }
};
var showReturn = false;     // outbound (return) markers — off by default
var showMidLeg = false;
var highlightDiff = false;  // purple halo on legs that change altitude
var showNavWP = true;       // Israeli VFR reporting-point overlay (default on)
var navWP = null;           // null = not loaded yet (or last fetch failed —
                            // retry on next toggle / search call); [] or
                            // populated = last fetch resolved successfully.
var showAirfields = true;   // Israeli airfields overlay (default on)
var airfields = null;       // same null/[]/populated convention as navWP —
                            // see loadAirfields() in draw.js. Entries:
                            // { name, he, en, lat, lng, elev_ft, plates:[], runways:[] }.
var showDrift = true;       // 10-degree drift reference lines
var showWpNames = true;     // draw waypoint names (off = empty circle)
var wpNameAngle = 0;        // waypoint-name rotation: 0 / 90 / 180 / 270 deg
var yellowAlpha = 1;        // global multiplier for yellow label backgrounds
var wpSize = 1;             // waypoint name / number text size scale
var legArrowSize = 1;       // leg arrow (rectangle+triangle) size scale
let pageSize = null;        // null | 'A3' | 'A4'
// `var` (not `let`) so window.pageOrient writes from ui.js's boot restore
// land on the same binding the toggle reads. Default 'portrait' since most
// CVFR routes are tall (north–south Israel airspace).
var pageOrient = 'portrait';
let pageOffset = { x: 0, y: 0 };   // page-frame drag offset from viewport centre
var aircraft = null;               // null | {gph, taxiGal}

function loadAircraft() {
  try {
    const raw = localStorage.getItem('navaid.aircraft');
    if (raw) aircraft = JSON.parse(raw);
  } catch (e) { /* storage unavailable */ }
}

function saveAircraft() {
  try { localStorage.setItem('navaid.aircraft', JSON.stringify(aircraft)); } catch (e) {}
}

// Yellow text-background colour. yellowAlpha directly controls opacity (0–1).
const yellowFill = (a) => `rgba(255,246,170,${yellowAlpha})`;

// Tinted fill from any "#rrggbb" hex — yellowAlpha controls the alpha.
function tintFill(hex, a) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return yellowFill(a);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${yellowAlpha})`;
}

const NOTE_DEFAULT_COLOR = '#fff6aa';   // matches the existing yellow fill

const newLeg = () => ({
  inboundAltitude: 2000,
  outboundAltitude: 2000,
  flightSpeed: 90,
  outboundSpeed: 90,
  inLabel: { a: 0, p: 44 },            // marker offset: along leg, perpendicular
  outLabel: { a: 0, p: -44 },
});


// --- helpers ---------------------------------------------------------
// Round lat/lng to 5 decimals (~1.1 m at 32°N). 3 dp was too coarse — coarser
// than AIP source data (published to ~18 m) and visibly shifted close-spaced
// reporting points. 5 dp keeps full source precision while still trimming
// IEEE-754 noise from drags and JSON imports.
function r5(v) { return Math.round(v * 100000) / 100000; }
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
  const h = Math.floor(m / 60);
  m %= 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
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
// chartBounds = the lat/lng box that flight-maps.com actually publishes
// tiles for (Israel + adjacent VFR airspace).  exportPNG uses it to skip
// out-of-coverage tile fetches, which would otherwise return 404 and trip
// the "X of Y map tiles failed to load" warning when the viewport extends
// past the chart (the typical case at low zoom).
const FM_BOUNDS = { south: 28.3, west: 33.7, north: 34.3, east: 36.6 };
const TILE = { minZoom: 6, maxZoom: 16, maxNativeZoom: 13,
               chartBounds: FM_BOUNDS };
const FM_ATTR =
  'Charts © <a href="https://flight-maps.com">flight-maps.com</a> · CAAI';
const layers = {
  'CVFR': L.tileLayer('https://flight-maps.com/tiles/cvfr/{z}/{x}/{y}.png',
    { ...TILE, attribution: FM_ATTR }),
  'Navigation': L.tileLayer('https://flight-maps.com/tiles/nav/{z}/{x}/{y}.png',
    { ...TILE, attribution: FM_ATTR }),
  'Low Alt': L.tileLayer('https://flight-maps.com/tiles/la/{z}/{x}/{y}.png',
    { ...TILE, attribution: FM_ATTR }),
  'Helicopters': L.tileLayer('https://flight-maps.com/tiles/il-hel/{z}/{x}/{y}.png',
    { ...TILE, maxNativeZoom: 12, attribution: FM_ATTR }),
  'Satellite': L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/' +
    'World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { minZoom: 6, maxZoom: 18, attribution: 'Imagery © Esri', corsOk: true }),
  'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { minZoom: 6, maxZoom: 18, subdomains: 'abc', corsOk: true,
      attribution: '© OpenStreetMap contributors' }),
};

const LAYER_KEY = 'navaid.layer';
let initialLayer = layers.CVFR;
try {
  let saved = localStorage.getItem(LAYER_KEY);
  if (saved === 'OSM') { saved = 'OpenStreetMap'; localStorage.setItem(LAYER_KEY, saved); }
  if (saved === 'Nav') { saved = 'Navigation'; localStorage.setItem(LAYER_KEY, saved); }
  if (saved === 'Heli') { saved = 'Helicopters'; localStorage.setItem(LAYER_KEY, saved); }
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

