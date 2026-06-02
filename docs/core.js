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

// Hidden developer tuning registry. Open with `?tune=1` to preview visual
// constants without editing source. Values are page-local and reset on reload.
NavAid.tuning = {};
NavAid.tuningDefaults = {
  routeLineWidthPx: { value: 3.5, min: 0.5, max: 12, step: 0.1, label: 'Route line width' },
  routeSelectedLineWidthPx: { value: 5, min: 0.5, max: 16, step: 0.1, label: 'Selected route line width' },

  driftAngleDeg: { value: 10, min: 1, max: 30, step: 0.5, label: 'Drift angle deg' },
  driftLengthFactor: { value: 0.5, min: 0.05, max: 1, step: 0.05, label: 'Drift length factor' },
  driftDashOnPx: { value: 12, min: 1, max: 60, step: 1, label: 'Drift dash on' },
  driftDashOffPx: { value: 8, min: 0, max: 60, step: 1, label: 'Drift dash gap' },
  driftStrokeWidthPx: { value: 1.5, min: 0.25, max: 8, step: 0.25, label: 'Drift stroke width' },

  defaultLabelMarginPx: { value: 20, min: 0, max: 80, step: 1, label: 'Default marker margin' },
  defaultKiteHalfWidthPx: { value: 23, min: 1, max: 80, step: 1, label: 'Default kite half-width' },

  legKiteHeightPx: { value: 47, min: 8, max: 120, step: 1, label: 'Leg kite height' },
  legKiteCellWidthPx: { value: 24, min: 8, max: 80, step: 1, label: 'Leg kite cell width' },
  legKiteTriangleLenPx: { value: 35, min: 8, max: 100, step: 1, label: 'Leg kite triangle length' },
  legKiteBorderPx: { value: 2, min: 0.25, max: 8, step: 0.25, label: 'Leg kite border width' },
  legKiteDividerPx: { value: 1, min: 0.25, max: 6, step: 0.25, label: 'Leg kite divider width' },
  legKiteHaloPx: { value: 7, min: 0, max: 20, step: 0.5, label: 'Leg kite halo width' },
  legKiteTextPx: { value: 13, min: 4, max: 36, step: 1, label: 'Leg kite text size' },
  legKiteHeadingTextPx: { value: 13, min: 4, max: 40, step: 1, label: 'Leg kite heading text size' },
  legKiteHeadingAnchor: { value: 0.25, min: -0.5, max: 1, step: 0.01, label: 'Leg kite heading anchor' },

  cumKiteHeightPx: { value: 23, min: 8, max: 100, step: 1, label: 'Cum kite height' },
  cumKiteCellWidthPx: { value: 43, min: 10, max: 120, step: 1, label: 'Cum kite cell width' },
  cumKiteTriangleLenPx: { value: 20, min: 6, max: 100, step: 1, label: 'Cum kite triangle length' },
  cumKiteBorderPx: { value: 1.5, min: 0.25, max: 8, step: 0.25, label: 'Cum kite border width' },
  cumKiteTextPx: { value: 15, min: 4, max: 36, step: 1, label: 'Cum kite text size' },

  minuteMarkerFontPx: { value: 10, min: 4, max: 28, step: 1, label: 'Minute label text size' },
  minuteTickEvenPx: { value: 9, min: 1, max: 30, step: 1, label: 'Even minute tick length' },
  minuteTickOddPx: { value: 4, min: 1, max: 30, step: 1, label: 'Odd minute tick length' },
  minuteTickEvenWidthPx: { value: 2, min: 0.25, max: 8, step: 0.25, label: 'Even minute tick width' },
  minuteTickOddWidthPx: { value: 1.5, min: 0.25, max: 8, step: 0.25, label: 'Odd minute tick width' },
  minuteLabelOffsetPx: { value: 8, min: 0, max: 40, step: 1, label: 'Minute label offset' },

  distanceBadgeRadiusPx: { value: 15, min: 4, max: 50, step: 1, label: 'Distance badge radius' },
  distanceBadgeBorderPx: { value: 2.5, min: 0.25, max: 10, step: 0.25, label: 'Distance badge border width' },
  distanceBadgeFontPx: { value: 11, min: 4, max: 30, step: 1, label: 'Distance badge text size' },

  waypointBaseRadiusPx: { value: 13, min: 2, max: 60, step: 1, label: 'Waypoint base radius' },
  waypointFontPx: { value: 13, min: 4, max: 40, step: 1, label: 'Waypoint text size' },
  waypointTextPadFactor: { value: 0.7, min: 0, max: 2, step: 0.05, label: 'Waypoint text pad factor' },
  waypointMinZoomScale: { value: 0.35, min: 0.1, max: 2, step: 0.05, label: 'Waypoint min zoom scale' },
  waypointSelectedRadiusAddPx: { value: 2, min: 0, max: 20, step: 0.5, label: 'Selected waypoint radius add' },
  waypointStrokeWidthPx: { value: 3, min: 0.25, max: 10, step: 0.25, label: 'Waypoint stroke width' },

  airfieldMarkerRadiusPx: { value: 7, min: 2, max: 40, step: 1, label: 'Airfield triangle radius' },
  airfieldMarkerWidthFactor: { value: 0.95, min: 0.1, max: 2, step: 0.05, label: 'Airfield triangle width factor' },
  airfieldMarkerBaseFactor: { value: 0.65, min: 0.1, max: 2, step: 0.05, label: 'Airfield triangle base factor' },
  airfieldStrokeWidthPx: { value: 1.5, min: 0.25, max: 8, step: 0.25, label: 'Airfield stroke width' },
  airfieldLabelFontPx: { value: 11, min: 4, max: 30, step: 1, label: 'Airfield label text size' },
  airfieldLabelOffsetPx: { value: 3, min: 0, max: 40, step: 1, label: 'Airfield label offset' },
  airfieldLabelHaloPx: { value: 2.5, min: 0.25, max: 10, step: 0.25, label: 'Airfield label halo width' },

  navWaypointRadiusPx: { value: 3.5, min: 1, max: 20, step: 0.5, label: 'Nav waypoint dot radius' },
  navWaypointStrokeWidthPx: { value: 1.5, min: 0.25, max: 8, step: 0.25, label: 'Nav waypoint stroke width' },
  navWaypointLabelFontPx: { value: 10, min: 4, max: 28, step: 1, label: 'Nav waypoint label text size' },
  navWaypointLabelOffsetPx: { value: 6, min: 0, max: 40, step: 1, label: 'Nav waypoint label offset' },
  navWaypointLabelHaloPx: { value: 2.5, min: 0.25, max: 10, step: 0.25, label: 'Nav waypoint label halo width' },

  commChangeRingRadiusPx: { value: 6, min: 1, max: 40, step: 0.5, label: 'Comm-change ring radius' },
  commChangeRingWidthPx: { value: 1.8, min: 0.25, max: 10, step: 0.1, label: 'Comm-change ring width' },
  commChangeNoteLatOffset: { value: 0, min: -0.15, max: 0.15, step: 0.001, label: 'Comm-change arrow tail lat offset' },
  commChangeNoteLngOffset: { value: 0.09, min: -0.25, max: 0.25, step: 0.001, label: 'Comm-change arrow tail lng offset' },
  commChangeArrowStartGapPx: { value: 3, min: 0, max: 50, step: 0.5, label: 'Comm-change arrow start gap' },
  commChangeArrowWidthPx: { value: 4, min: 1, max: 28, step: 0.5, label: 'Comm-change arrow width' },
  commChangeArrowColor: { value: '#000000', type: 'color', label: 'Comm-change arrow color' },
  commChangeArrowLineCap: { value: 'square', type: 'select', options: ['butt', 'round', 'square'], label: 'Comm-change arrow line cap' },
  commChangeArrowLineJoin: { value: 'miter', type: 'select', options: ['bevel', 'round', 'miter'], label: 'Comm-change arrow line join' },
  commChangeArrowMiterLimit: { value: 1, min: 1, max: 20, step: 0.5, label: 'Comm-change arrow miter limit' },
  commChangeArrowHaloPx: { value: 0, min: 0, max: 24, step: 0.5, label: 'Comm-change arrow light halo' },
  commChangeArrowHaloColor: { value: '#fff9d6', type: 'color', label: 'Comm-change arrow halo color' },
  commChangeArrowHaloAlpha: { value: 0.92, min: 0, max: 1, step: 0.05, label: 'Comm-change arrow halo alpha' },
  commChangeSelectedColor: { value: '#ffcc33', type: 'color', label: 'Comm-change selected color' },
  commChangeSelectedAlpha: { value: 0.35, min: 0, max: 1, step: 0.05, label: 'Comm-change selected alpha' },
  commChangeSelectedWidthAddPx: { value: 5, min: 0, max: 40, step: 0.5, label: 'Comm-change selected width add' },
  commChangeArrowBoltPx: { value: 15, min: 0, max: 80, step: 1, label: 'Comm-change lightning amplitude' },
  commChangeArrowBoltAngleDeg: { value: 30, min: -180, max: 180, step: 1, label: 'Comm-change lightning rotation' },
  commChangeArrowBend1Along: { value: 0.52, min: 0.05, max: 0.95, step: 0.01, label: 'Comm-change lightning forward fold' },
  commChangeArrowBend2Along: { value: 0.38, min: 0.05, max: 0.95, step: 0.01, label: 'Comm-change lightning reverse fold' },
  commChangeNameFontPx: { value: 12, min: 4, max: 40, step: 1, label: 'Comm-change name text size' },
  commChangeFreqFontPx: { value: 12, min: 4, max: 54, step: 1, label: 'Comm-change freq text size' },
  commChangeTextColor: { value: '#161412', type: 'color', label: 'Comm-change text color' },
  commChangeTextHaloColor: { value: '#fff9d6', type: 'color', label: 'Comm-change text halo color' },
  commChangeTextHaloAlpha: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'Comm-change text halo alpha' },
  commChangeTextAlong: { value: 0.88, min: 0.1, max: 0.95, step: 0.01, label: 'Comm-change text along arrow' },
  commChangeTextGapPx: { value: 10, min: 0, max: 30, step: 1, label: 'Comm-change text gap' },
  commChangeNameHaloWidthPx: { value: 0, min: 0, max: 12, step: 0.5, label: 'Comm-change name halo width' },
  commChangeFreqHaloWidthPx: { value: 0, min: 0, max: 14, step: 0.5, label: 'Comm-change freq halo width' },

  noteFontPx: { value: 12, min: 4, max: 40, step: 1, label: 'Note text size' },
  notePadXPx: { value: 8, min: 0, max: 40, step: 1, label: 'Note horizontal padding' },
  notePadYPx: { value: 6, min: 0, max: 40, step: 1, label: 'Note vertical padding' },
  noteLineHeightPx: { value: 16, min: 6, max: 60, step: 1, label: 'Note line height' },
  noteMinWidthPx: { value: 56, min: 1, max: 240, step: 1, label: 'Note min width' },
  noteStrokeWidthPx: { value: 1.5, min: 0.25, max: 8, step: 0.25, label: 'Note stroke width' },
  noteSelectedStrokeWidthPx: { value: 2.5, min: 0.25, max: 10, step: 0.25, label: 'Selected note stroke width' },

  pageFrameLineWidthPx: { value: 2, min: 0.25, max: 10, step: 0.25, label: 'Page frame line width' },
  pageFrameDashOnPx: { value: 8, min: 1, max: 60, step: 1, label: 'Page frame dash on' },
  pageFrameDashOffPx: { value: 5, min: 0, max: 60, step: 1, label: 'Page frame dash gap' },
  pageFrameScrimAlpha: { value: 0.4, min: 0, max: 1, step: 0.05, label: 'Page frame scrim alpha' },
  pageFrameHitPx: { value: 14, min: 1, max: 80, step: 1, label: 'Page frame drag band' },

  hitWaypointExtraPx: { value: 6, min: 0, max: 40, step: 1, label: 'Waypoint hit extra' },
  hitLegPx: { value: 8, min: 1, max: 60, step: 1, label: 'Leg line hit width' },
  hitLegLabelMinPx: { value: 18, min: 1, max: 80, step: 1, label: 'Leg label hit min' },
  hitLegLabelScalePx: { value: 34, min: 1, max: 120, step: 1, label: 'Leg label hit scale' },
  hitCumLabelMinPx: { value: 18, min: 1, max: 80, step: 1, label: 'Cum label hit min' },
  hitCumLabelScalePx: { value: 28, min: 1, max: 120, step: 1, label: 'Cum label hit scale' },

  inkColor: { value: '#161412', type: 'color', label: 'Ink color (lines, kites, text strokes)' },
  selectedColor: { value: '#ffcc33', type: 'color', label: 'Selected highlight color' },
  kiteTextColor: { value: '#000000', type: 'color', label: 'Kite text color' },
  legKiteHaloColor: { value: '#8e44ad', type: 'color', label: 'Leg kite halo color' },
  airfieldFillColor: { value: '#2f6fd0', type: 'color', label: 'Airfield fill color' },
  airfieldOutlineColor: { value: '#0a1a2a', type: 'color', label: 'Airfield outline color' },
  navWaypointDotColor: { value: '#ffffff', type: 'color', label: 'Nav waypoint dot color' },
};
NavAid.tuningGroups = [
  { name: 'Route', keys: ['routeLineWidthPx', 'routeSelectedLineWidthPx'] },
  { name: 'Drift lines', keys: ['driftAngleDeg', 'driftLengthFactor', 'driftDashOnPx', 'driftDashOffPx', 'driftStrokeWidthPx'] },
  { name: 'Default marker locations', keys: ['defaultLabelMarginPx', 'defaultKiteHalfWidthPx'] },
  { name: 'Leg kites', keys: ['legKiteHeightPx', 'legKiteCellWidthPx', 'legKiteTriangleLenPx', 'legKiteBorderPx', 'legKiteDividerPx', 'legKiteHaloPx', 'legKiteTextPx', 'legKiteHeadingTextPx', 'legKiteHeadingAnchor'] },
  { name: 'Cumulative kites', keys: ['cumKiteHeightPx', 'cumKiteCellWidthPx', 'cumKiteTriangleLenPx', 'cumKiteBorderPx', 'cumKiteTextPx'] },
  { name: 'Minute markers', keys: ['minuteMarkerFontPx', 'minuteTickEvenPx', 'minuteTickOddPx', 'minuteTickEvenWidthPx', 'minuteTickOddWidthPx', 'minuteLabelOffsetPx'] },
  { name: 'Distance badges', keys: ['distanceBadgeRadiusPx', 'distanceBadgeBorderPx', 'distanceBadgeFontPx'] },
  { name: 'Route waypoints', keys: ['waypointBaseRadiusPx', 'waypointFontPx', 'waypointTextPadFactor', 'waypointMinZoomScale', 'waypointSelectedRadiusAddPx', 'waypointStrokeWidthPx'] },
  { name: 'Reference overlays', keys: ['airfieldMarkerRadiusPx', 'airfieldMarkerWidthFactor', 'airfieldMarkerBaseFactor', 'airfieldStrokeWidthPx', 'airfieldLabelFontPx', 'airfieldLabelOffsetPx', 'airfieldLabelHaloPx', 'navWaypointRadiusPx', 'navWaypointStrokeWidthPx', 'navWaypointLabelFontPx', 'navWaypointLabelOffsetPx', 'navWaypointLabelHaloPx', 'commChangeRingRadiusPx', 'commChangeRingWidthPx', 'commChangeNoteLatOffset', 'commChangeNoteLngOffset', 'commChangeArrowStartGapPx', 'commChangeArrowWidthPx', 'commChangeArrowColor', 'commChangeArrowLineCap', 'commChangeArrowLineJoin', 'commChangeArrowMiterLimit', 'commChangeArrowHaloPx', 'commChangeArrowHaloColor', 'commChangeArrowHaloAlpha', 'commChangeSelectedColor', 'commChangeSelectedAlpha', 'commChangeSelectedWidthAddPx', 'commChangeArrowBoltPx', 'commChangeArrowBoltAngleDeg', 'commChangeArrowBend1Along', 'commChangeArrowBend2Along', 'commChangeNameFontPx', 'commChangeFreqFontPx', 'commChangeTextColor', 'commChangeTextHaloColor', 'commChangeTextHaloAlpha', 'commChangeTextAlong', 'commChangeTextGapPx', 'commChangeNameHaloWidthPx', 'commChangeFreqHaloWidthPx'] },
  { name: 'Notes', keys: ['noteFontPx', 'notePadXPx', 'notePadYPx', 'noteLineHeightPx', 'noteMinWidthPx', 'noteStrokeWidthPx', 'noteSelectedStrokeWidthPx'] },
  { name: 'Page frame', keys: ['pageFrameLineWidthPx', 'pageFrameDashOnPx', 'pageFrameDashOffPx', 'pageFrameScrimAlpha', 'pageFrameHitPx'] },
  { name: 'Hit testing', keys: ['hitWaypointExtraPx', 'hitLegPx', 'hitLegLabelMinPx', 'hitLegLabelScalePx', 'hitCumLabelMinPx', 'hitCumLabelScalePx'] },
  { name: 'Colors', keys: ['inkColor', 'selectedColor', 'kiteTextColor', 'legKiteHaloColor', 'airfieldFillColor', 'airfieldOutlineColor', 'navWaypointDotColor'] },
];
function tune(key) {
  const spec = NavAid.tuningDefaults && NavAid.tuningDefaults[key];
  if (!spec) return 0;
  const v = NavAid.tuning[key];
  if (spec.type === 'color') return typeof v === 'string' ? v : spec.value;
  if (spec.type === 'select') {
    return spec.options && spec.options.indexOf(v) !== -1 ? v : spec.value;
  }
  return Number.isFinite(v) ? v : spec.value;
}
function setTune(key, value) {
  const spec = NavAid.tuningDefaults && NavAid.tuningDefaults[key];
  if (!spec) return;
  if (spec.type === 'color') {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return;
    NavAid.tuning[key] = value.toLowerCase();
    return;
  }
  if (spec.type === 'select') {
    if (!spec.options || spec.options.indexOf(value) === -1) return;
    NavAid.tuning[key] = value;
    return;
  }
  if (!Number.isFinite(value)) return;
  NavAid.tuning[key] = Math.max(spec.min, Math.min(spec.max, value));
}
function resetTune(key) {
  if (key) delete NavAid.tuning[key];
  else NavAid.tuning = {};
}

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
  commChangeUrl: 'comm-change.json?v=1', // CVFR comm-change reporting points (issue #399)

  // --- English UI copy (default locale) -------------------------------
  // Sentence case: capitalize the first word and proper nouns / acronyms
  // (BYOP, CVFR, JSON, …). Spell "waypoint" in full in prose (never "WPT").
  // Exception: `wpPrefix` is the tight inline label for unnamed waypoints
  // ("WP 3" / "נק׳ 3"); do not expand to "Waypoint 3".
  wpPrefix: 'WP ',                                  // short prefix for unnamed waypoints — see rule above
  summaryWaypoints: 'Waypoints',                    // stats panel total
  tbAddWp: '✏️ Add waypoint (A)',                    // toolbar Edit button
  tbAddWpTitle: 'Click map to drop a waypoint (click button again to stop)',
  tbShowWpNames: 'Show waypoint names',             // Display toggle
  tbShowWpNamesTitle: 'Show waypoint names (off = empty circle)',
  tbWpSize: 'Waypoint size',                        // Display slider label
  tbWpSizeTitle: 'Waypoint circle and name size',
  tbShowNavWp: 'Show/pin nav waypoints',            // Map overlay toggle
  tbShowNavWpTitle: 'Overlay published Israeli VFR reporting points',
  tbSearchPlaceholder: '🔍 Find navigation waypoint',
  tbSearchHint: 'Tip: type space-separated waypoint codes (e.g. LLHZ BAZRA DEROR SHARO HADRA) and press Enter to build a route.',
  errSearchUnknown: function(t) { return 'Unknown waypoint: ' + t; },
  searchReplaceConfirm: 'Replace the current route with these waypoints?',
  tbSearchOpen: '🔍 Find (Ctrl-F)',
  tbSearchOpenTitle: 'Open the search overlay (Ctrl/Cmd-F)',
  deleteWp: '🗑 Delete waypoint (D)',                  // inspector button
  resetWpName: '↺ Reset waypoint name',             // inspector — reference snap or clear (placeholder)
  resetWpNameTitle: 'Set name to the nearest reference (airfield / nav-WP), or clear when off-grid (dimmed sequence label)',
  tbResetAllWpNames: '↺ Reset all waypoint names',
  tbResetAllWpNamesTitle: 'Set each name to its nearest reference, or clear when off-grid',
  resetAllWpNamesConfirm: 'Reset all waypoint names to their nearest reference codes, or clear when off-grid (sequence placeholders)?',
  resetLegMarkers: '↺ Reset marker position',       // inspector leg button — reset label offsets
  resetAllLegMarkers: '↺ Reset all marker positions', // inspector leg button — reset every leg
  resetAllConfirm: 'Reset all leg marker positions to default? This will clear any manual adjustments.',
  clearConfirm: 'Remove all waypoints and notes?',
  errBadCoords: 'file has invalid waypoint coordinates',
  // --- end English UI copy (waypoint-related keys above) --------------

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
  fpHeaders: ['#', 'From', 'To', 'Hdg', 'Dist (NM)', 'Speed (kt)', 'Alt (ft)', 'Time', 'Fuel (gal)', 'Cum. time', 'Cum. fuel', ''],
  fpDel: '✕',
  fpReturn: 'Return route',
  fpTotal: 'Total',
  fpClose: 'Close',
  fpPrint: 'Print',
  fpFuel: 'Fuel',
  tbAircraft: 'Aircraft',
  tbGph: 'Gallons per hour',
  tbGphTitle: 'Fuel consumption, gallons per hour',
  tbTaxiGal: 'Taxi and Takeoff (gal)',
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
  deleteNote: '🗑 Delete note (D)',
  latitude: 'Latitude',
  longitude: 'Longitude',
  gotoTitle: 'Click to go to coordinates',
  gotoError: 'Type the digits, or paste a coordinate like 32°00\'17"N 34°43\'38"E',
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
  tbAddNote: '📝 Add note (N)',
  tbAddNoteTitle: 'Click map to drop a note (click button again to stop)',
  tbLayerLabel: 'Layer',
  tbLayerTitle: 'Base map layer',
  tbReverse: '⇄ Reverse route (R)',
  tbReverseTitle: 'Reverse route order',
  tbUndo: '↶ Undo (Ctrl-Z)',
  tbUndoTitle: 'Undo the last edit, move or delete',
  tbClear: '🗑 Clear map (C)',
  tbClearTitle: 'Remove all waypoints and notes',
  tbExport: '⬇ Export JSON',
  tbExportTitle: 'Export route as JSON',
  tbImport: '⬆ Import JSON/GPX',
  tbImportTitle: 'Import route from JSON or GPX file',
  tbShare: '🔗 Share',
  tbShareTitle: 'Copy a shareable link to this route to the clipboard',
  shareCopied: 'Route link copied to clipboard',
  errShareTooLong: 'Route is too long for a share link (max 64 waypoints). Export as JSON and send the file instead.',
  tbFit: '⌖ Fit to screen (F)',
  tbFitTitle: 'Fit route to view (F)',
  tbPlan: '📋 Flight plan',
  tbPlanTitle: 'Show flight plan table',
  tbCharts: '🗺️ Airport charts',
  tbChartsTitle: 'Browse approach charts for all airfields',
  tbFly: '✈️ Open in Google Earth',
  tbFlyTitle: 'Save a Google Earth tour of the route at the planned leg altitudes',
  tbGpxExport: '📍 Export GPX',
  tbGpxExportTitle: 'Export route as GPX for portable GPS units',
  tbShowReturn: 'Show return path',
  tbShowReturnTitle: 'Show return-direction (outbound) info',
  tbShowCumTime: 'Show cumulative time',
  tbShowCumTimeTitle: 'Show running total flight time kite after each leg',
  tbShowMidLeg: 'Show leg distance',
  tbShowMidLegTitle: 'Show distance badge at the middle of each leg',
  tbHighlightDiff: 'Highlight alt/speed diff',
  tbHighlightDiffTitle: 'Halo legs whose altitude or speed differs from the adjacent leg',
  tbShowDrift: 'Show drift lines',
  tbShowDriftTitle: 'Show 10-degree drift reference lines at each leg end',
  tbShowAirfields: 'Show/pin airfields',
  tbShowAirfieldsTitle: 'Overlay published Israeli airfields (BYOP source)',
  tbForceSnap: 'Force snap',
  tbForceSnapTitle: 'Always snap clicks to the nearest airfield or nav-waypoint (otherwise: 18 px radius)',
  tbShowCommChange: 'Show/Add Freq Changes',
  tbShowCommChangeTitle: 'Mark CVFR reporting points where pilots must change ATC frequency',
  legendTitle: 'Legend',
  legendAirfield: 'Airfield',
  legendWaypoint: 'Waypoint',
  legendAtcChange: 'Freq change',
  commChangeBadge: '📡 Freq change point',
  commChangeNoteText: 'Freq change',
  commChangeCallSign: 'Waypoint',
  commChangeName: 'Call sign',
  commChangeFreq: 'Frequency',
  addFreqChange: 'Add freq change (Z)',
  deleteFreqChange: '🗑 Delete freq change (X)',
  resetFreqLocation: '↺ Reset callout location',
  plates: 'Charts',
  runways: 'Runways',
  plateCategoryApproach: 'Approach',
  plateCategorySid: 'SID',
  plateCategoryStar: 'STAR',
  plateCategoryGround: 'Ground',
  plateCategoryVfr: 'VFR / airport',
  plateCategoryOther: 'Other',
  plateOpen: 'Open',
  plateDownload: 'Download',
  plateOpenTab: 'Open in new tab',
  plateClose: 'Close',
  platesNone: 'No charts available — see official AIP',
  plateLoadError: 'Failed to load chart.',
  plateAttribution: 'Charts © Israel CAAI / Ministry of Transport — published in the AIP.',
  tbTransparency: 'Label opacity',
  tbTransparencyTitle: 'Opacity of waypoint / leg / note label backgrounds',
  tbMapOpacity: 'Map opacity',
  tbMapOpacityTitle: 'Base map brightness',
  tbLegArrowSize: 'Leg arrow size',
  tbLegArrowSizeTitle: 'Leg info marker (heading / altitude / time) size',
  sliderReset: 'Reset to default',
  tbLegLineWidth: 'Leg line width',
  tbLegLineWidthTitle: 'Route line thickness',
  tbDriftLineWidth: 'Drift line width',
  tbDriftLineWidthTitle: 'Drift reference line thickness',
  tbPageA3Title: 'A3 print page',
  tbPageA4Title: 'A4 print page',
  tbOrientTitle: 'Orientation — click to toggle landscape / portrait',
  modalCloseTitle: 'Close',
  tbPrint: '⬇ Save PNG',
  tbPrintTitle: 'Save the framed map + route as a PNG',
  tbMagnifier: '🔍 Magnifying glass (M)',
  tbMagnifierTitle: 'Magnifying glass (M) — zoomed view at cursor; +/− adjust loupe zoom while open',
  magSettingsTitle: 'Magnifier',
  magZoomLabel: 'Zoom',
  magZoomTitle: 'Magnifier zoom factor',
  magLoading: 'Perfecting…',
  tbResetAllMarkers: '↺ Reset all marker positions',
  tbResetAllMarkersTitle: 'Reset all leg marker offsets to default positions',
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
  tbSecExport: '📤 Export/import',
  tbViewSource: 'GitHub',
  tbWiki: 'Wiki',
  tbIssues: 'Issues / Requests',

  // --- Keyboard-shortcuts cheat-sheet (issue #420) --------------------
  // Opens via the toolbar '?' Help link or the '?' (Shift-/) shortcut.
  // Suppressed while focused in an input / textarea / contenteditable so
  // typing a literal '?' in a waypoint name / note still works.
  // Each shortcutXxx row is rendered as <kbd>keys</kbd> + description; the
  // modal builds itself from the i18n strings so locales control wording.
  shortcutsHelpTitle: 'Keyboard shortcuts',
  shortcutsHelpButton: 'Shortcuts',
  shortcutsHelpButtonTitle: 'Show keyboard shortcuts (?)',
  shortcutsHelpAriaLabel: 'Show keyboard shortcuts',
  shortcutsGroupNavigation: 'Navigation',
  shortcutsGroupSearch: 'Search',
  shortcutsGroupEditing: 'Editing',
  shortcutsGroupHelp: 'Help',
  shortcutFitRoute: 'Fit route to view',
  shortcutSearch: 'Open search',
  shortcutAddWp: 'Toggle add-waypoint mode (click map to drop; press again to stop)',
  shortcutAddNote: 'Toggle add-note mode (click map to drop; press again to stop)',
  shortcutClear: 'Clear the map (remove all waypoints and notes)',
  shortcutReverse: 'Reverse route direction',
  shortcutBothDirections: 'Toggle show return path (both directions)',
  shortcutUndo: 'Undo the last edit, move or delete',
  shortcutEsc: 'Close modal / deselect / close magnifier',
  shortcutDelete: 'Delete selected waypoint or note',
  shortcutHelp: 'Show this cheat-sheet',
  shortcutZoomIn: 'Zoom map in (+/= or numpad +); adjusts loupe zoom when magnifier is on',
  shortcutZoomOut: 'Zoom map out (− or numpad −); adjusts loupe zoom when magnifier is on',
  shortcutMagnifier: 'Toggle magnifying glass',
  exportModalTitle: 'Export PNG',
  exportShowNavWP: 'Print navigation waypoints',
  exportShowAirfields: 'Print airfields',
  exportShowWpNames: 'Print route waypoint names',
  exportShowDrift: 'Print drift lines',
  exportShowCumTime: 'Print cumulative time',
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
  commChangeSuppressions: [], // canonical comm-change callouts the user deleted
  mode: null,               // 'add' | 'note' | null (= inspect)
  selected: null,           // { type:'wp'|'leg'|'note', index }
};
var showReturn = false;     // outbound (return) markers — off by default
var showMidLeg = false;
var showCumTime = true;     // cumulative-time kites — on by default
var highlightDiff = false;  // purple halo on legs that change altitude
var showNavWP = true;       // Israeli VFR reporting-point overlay (default on)
var navWP = null;           // null = not loaded yet (or last fetch failed —
                            // retry on next toggle / search call); [] or
                            // populated = last fetch resolved successfully.
var showAirfields = true;   // Israeli airfields overlay (default on)
var forceSnap = false;      // #106: when on, every click snaps to the
                            // absolute nearest airfield / nav-WP regardless
                            // of click distance (otherwise: 18 px radius).
var airfields = null;       // same null/[]/populated convention as navWP —
                            // see loadAirfields() in draw.js. Entries:
                            // { name, he, lat, lng, en?, elev_ft?, plates:[], runways:[]|null }.
                            // `en`, `elev_ft`, `plates`, and `runways` are
                            // optional per the chart-rebuild (#412): ARPs
                            // surfaced from the IAA chart with no published
                            // BYOP enrichment ship as bare {name,he,lat,lng}.
var showCommChange = true;   // Comm-change ring overlay + callouts (default on) — issue #399/#487.
var commChangeMap = null;   // null = not loaded yet (or last fetch failed —
                            // retry on next toggle); {} or populated = last
                            // fetch resolved. Keyed by nav-WP `name` for
                            // O(1) lookup, value is the raw point entry
                            // `{commChange, callSigns, from, to, note, ...}`.
var commChangeCallSigns = {}; // Frequency catalog keyed by call-sign id
                              // (loaded from comm-change.json `callSigns`).
var showDrift = true;       // 10-degree drift reference lines
var showWpNames = true;     // draw waypoint names (off = empty circle)
var wpNameAngle = 0;        // waypoint-name rotation: 0 / 90 / 180 / 270 deg
var yellowAlpha = 0.8;    // global multiplier for yellow label backgrounds (default 80%)
var wpSize = 1;             // waypoint name / number text size scale
var legArrowSize = 1;       // leg arrow (rectangle+triangle) size scale
var legLineWidth = 1;       // leg route line width scale (1 = default 3.5 px)
var driftLineWidth = 1;     // drift reference line width scale (1 = default 1.5 px)
function legZoomScale() {   // zoom + legArrowSize → pixel multiplier for offsets/sizes
  return Math.max(0.35, Math.pow(2, map.getZoom() - 12)) * legArrowSize;
}
var magnifierOn = false;    // magnifying-glass toggle
var magnifierZoom = 2;      // default zoom factor
var magnifierSize = 400;    // magnifier diameter (px)
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
const yellowFill = (_) => `rgba(255,246,170,${yellowAlpha})`;

// Tinted fill from any "#rrggbb" hex — yellowAlpha controls the alpha.
function tintFill(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return yellowFill();
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${yellowAlpha})`;
}

const NOTE_DEFAULT_COLOR = '#fff6aa';   // matches the existing yellow fill

// Default leg-marker offsets. Single source of truth used by newLeg(),
// the inspector "Reset marker position" button (interact.js), the toolbar
// "Reset all marker positions" button (ui.js), and the share-URL decoder
// (io.js).
//
// `_default: 1` is a sentinel meaning "I'm an unmodified default — compute
// my perpendicular offset at render time from the current leg's screen
// length so I stay outside the 10° drift cone." `drawLegs` (draw.js) and
// `legLabelCenter` (interact.js) handle the sentinel; the drag handlers
// materialise the current rendered `p` into the stored offset on
// drag-start so the user-dragged path keeps the existing
// size-independent `{ a, p, _m: 1 }` shape unchanged (issue #394).
//
// `_m: 1` continues to mark the label as migrated, so the legacy-pixel
// path in `_normalizeLegLabel` (io.js) leaves sentinels untouched on
// reload. See `_normalizeLegLabel` for the pre-#393 raw-pixel migration.
function _defaultLegLabels() {
  return {
    inLabel:  { a: 0, _default: 1, _m: 1 },
    outLabel: { a: 0, _default: 1, _m: 1 },
    cumLabel: { a: 0, _default: 1, _m: 1 },
    cumLabelRet: { a: 0, _default: 1, _m: 1 },
  };
}
const newLeg = () => {
  const d = _defaultLegLabels();
  return {
    inboundAltitude: 2000,
    outboundAltitude: 2000,
    flightSpeed: 90,
    outboundSpeed: 90,
    inLabel: d.inLabel,                  // marker offset: along leg, perpendicular
    outLabel: d.outLabel,
    cumLabel: d.cumLabel,                // inbound cumulative-time kite offset (B-endpoint relative)
    cumLabelRet: d.cumLabelRet,          // return cumulative-time kite offset (A-endpoint relative)
  };
};


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

// Go-to sanity box (issue #497): a generous Israel-area bound. Parsed
// coordinates outside this are rejected so a typo can't fling the map to
// the other side of the planet.
const GOTO_LAT_MIN = 28, GOTO_LAT_MAX = 34;
const GOTO_LNG_MIN = 33, GOTO_LNG_MAX = 37;

// Parse a free-text coordinate string into { lat, lng } or null (issue #497).
// Tolerant of three notations, in priority order:
//   1. DMS / DM with hemisphere letters:  32°00'17"N 34°43'38"E  /  32 00.3 N ...
//   2. Signed decimal degrees:            32.005, 34.727  /  32.005 34.727
// Minutes and seconds are optional; separators (° ' " : and spaces) are loose.
function parseLatLng(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().toUpperCase();
  if (!s) return null;

  // --- hemisphere-tagged (DMS / DM) ---
  // One coordinate = degrees, optional minutes, optional seconds, hemisphere.
  const comp = /(-?\d+(?:\.\d+)?)\s*[°:\s]?\s*(?:(\d+(?:\.\d+)?)\s*['′M:\s]\s*)?(?:(\d+(?:\.\d+)?)\s*["″S]?\s*)?\s*([NSEW])/g;
  const found = [];
  let m;
  while ((m = comp.exec(s)) !== null) {
    const deg = parseFloat(m[1]);
    const min = m[2] ? parseFloat(m[2]) : 0;
    const sec = m[3] ? parseFloat(m[3]) : 0;
    if (!Number.isFinite(deg)) continue;
    let val = Math.abs(deg) + min / 60 + sec / 3600;
    const hemi = m[4];
    if (hemi === 'S' || hemi === 'W') val = -val;
    found.push({ val, axis: (hemi === 'N' || hemi === 'S') ? 'lat' : 'lng' });
  }
  if (found.length >= 2) {
    const lat = found.find(f => f.axis === 'lat');
    const lng = found.find(f => f.axis === 'lng');
    if (lat && lng) return finishLatLng(lat.val, lng.val);
  }

  // --- plain decimal degrees: "lat, lng" or "lat lng" ---
  const nums = s.match(/-?\d+(?:\.\d+)?/g);
  if (nums && nums.length >= 2) {
    return finishLatLng(parseFloat(nums[0]), parseFloat(nums[1]));
  }
  return null;
}

function finishLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < GOTO_LAT_MIN || lat > GOTO_LAT_MAX) return null;
  if (lng < GOTO_LNG_MIN || lng > GOTO_LNG_MAX) return null;
  return { lat, lng };
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
// `var` (not `let`) so the binding is a real `window` property — same pattern
// as `magVar` above. Some harness paths resolve globals via `window` only.
var octx = overlay.getContext('2d');   // reassigned during PNG export
var dpr = 1;

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
