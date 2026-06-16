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

  driftLineColor: { value: '#141414', type: 'color', label: 'Drift line color' },
  driftLineAlpha: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'Drift line alpha' },
  overlayLabelHaloColor: { value: '#ffffff', type: 'color', label: 'Overlay label halo color' },
  overlayLabelHaloAlpha: { value: 0.85, min: 0, max: 1, step: 0.05, label: 'Overlay label halo alpha' },

  altPairFocusColor: { value: '#fff2a8', type: 'color', label: 'Alt-pair focus line color' },
  altPairFocusWidthPx: { value: 5, min: 0.5, max: 16, step: 0.5, label: 'Alt-pair focus line width' },
  altPairFocusDashOnPx: { value: 10, min: 0, max: 40, step: 1, label: 'Alt-pair focus dash on' },
  altPairFocusDashOffPx: { value: 8, min: 0, max: 40, step: 1, label: 'Alt-pair focus dash gap' },
  altPairFocusDotRadiusPx: { value: 7, min: 1, max: 30, step: 0.5, label: 'Alt-pair focus endpoint radius' },
  altPairFocusDotColor: { value: '#1d6fe0', type: 'color', label: 'Alt-pair focus endpoint fill' },
  altPairFocusMs: { value: 10000, min: 1000, max: 60000, step: 500, label: 'Alt-pair focus duration (ms)' },

  exportBgColor: { value: '#231f20', type: 'color', label: 'PNG export background color' },

  vorMarkerRadiusPx: { value: 9, min: 3, max: 30, step: 0.5, label: 'VOR marker radius' },
  vorMarkerWidthPx: { value: 2, min: 0.25, max: 8, step: 0.25, label: 'VOR marker stroke width' },
  vorMarkerColor: { value: '#127a7a', type: 'color', label: 'VOR marker color' },
  vorSelectedColor: { value: '#e67e22', type: 'color', label: 'VOR selected (reference) color' },
  vorLabelFontPx: { value: 10, min: 4, max: 28, step: 1, label: 'VOR label text size' },
  reportBadgeRadiusPx: { value: 7, min: 3, max: 20, step: 0.5, label: 'Reporting badge radius' },
  reportBadgeOffsetPx: { value: 9, min: 0, max: 40, step: 1, label: 'Reporting badge offset' },
  reportBadgeFontPx: { value: 9, min: 4, max: 24, step: 1, label: 'Reporting badge text size' },
  reportBadgeColor: { value: '#d63b3b', type: 'color', label: 'Reporting badge fill' },
  reportBadgeTextColor: { value: '#ffffff', type: 'color', label: 'Reporting badge text color' },

  inspectorDefaultTopPx: { value: 84, min: 40, max: 240, step: 1, label: 'Inspector default top' },
  inspectorBottomGapPx: { value: 12, min: 0, max: 120, step: 1, label: 'Inspector bottom gap' },
  zuluClockMinWidthPx: { value: 82, min: 40, max: 180, step: 1, label: 'Zulu clock min width' },
  zuluClockPadYPx: { value: 5, min: 0, max: 24, step: 1, label: 'Zulu clock vertical padding' },
  zuluClockPadXPx: { value: 8, min: 0, max: 36, step: 1, label: 'Zulu clock horizontal padding' },
  zuluClockMarginTopPx: { value: 12, min: 0, max: 80, step: 1, label: 'Zulu clock top margin' },
  zuluClockMarginRightPx: { value: 12, min: 0, max: 80, step: 1, label: 'Zulu clock right margin' },
  zuluClockFontPx: { value: 13, min: 8, max: 28, step: 1, label: 'Zulu clock text size' },
  zuluClockFontWeight: { value: 800, min: 100, max: 900, step: 100, label: 'Zulu clock text weight' },
  zuluClockLineHeight: { value: 1, min: 0.8, max: 2, step: 0.05, label: 'Zulu clock line height' },
  zuluClockTextColor: { value: '#ffffff', type: 'color', label: 'Zulu clock text color' },
  zuluClockBgColor: { value: '#141212', type: 'color', label: 'Zulu clock background color' },
  zuluClockBgAlpha: { value: 0.88, min: 0, max: 1, step: 0.05, label: 'Zulu clock background alpha' },
  zuluClockBorderColor: { value: '#3a3636', type: 'color', label: 'Zulu clock border color' },
  zuluClockBorderWidthPx: { value: 1, min: 0, max: 8, step: 0.25, label: 'Zulu clock border width' },
  zuluClockBorderRadiusPx: { value: 5, min: 0, max: 24, step: 1, label: 'Zulu clock border radius' },
  zuluClockShadowYPx: { value: 2, min: 0, max: 18, step: 1, label: 'Zulu clock shadow y' },
  zuluClockShadowBlurPx: { value: 8, min: 0, max: 36, step: 1, label: 'Zulu clock shadow blur' },
  zuluClockShadowAlpha: { value: 0.45, min: 0, max: 1, step: 0.05, label: 'Zulu clock shadow alpha' },
};
// Groups are ordered to mirror the route-building workflow: the route line
// and its per-leg annotations first, then the markers you place, then the
// reference overlays the chart adds, then chrome (notes, page frame),
// interaction (hit testing), tools (alt pairs, export), and finally the
// global colour palette.
NavAid.tuningGroups = [
  { name: 'Route line', keys: ['routeLineWidthPx', 'routeSelectedLineWidthPx'] },
  { name: 'Drift lines', keys: ['driftAngleDeg', 'driftLengthFactor', 'driftDashOnPx', 'driftDashOffPx', 'driftStrokeWidthPx', 'driftLineColor', 'driftLineAlpha'] },
  { name: 'Default marker locations', keys: ['defaultLabelMarginPx', 'defaultKiteHalfWidthPx'] },
  { name: 'Leg kites', keys: ['legKiteHeightPx', 'legKiteCellWidthPx', 'legKiteTriangleLenPx', 'legKiteBorderPx', 'legKiteDividerPx', 'legKiteHaloPx', 'legKiteTextPx', 'legKiteHeadingTextPx', 'legKiteHeadingAnchor'] },
  { name: 'Cumulative kites', keys: ['cumKiteHeightPx', 'cumKiteCellWidthPx', 'cumKiteTriangleLenPx', 'cumKiteBorderPx', 'cumKiteTextPx'] },
  { name: 'Minute markers', keys: ['minuteMarkerFontPx', 'minuteTickEvenPx', 'minuteTickOddPx', 'minuteTickEvenWidthPx', 'minuteTickOddWidthPx', 'minuteLabelOffsetPx'] },
  { name: 'Distance badges', keys: ['distanceBadgeRadiusPx', 'distanceBadgeBorderPx', 'distanceBadgeFontPx'] },
  { name: 'Route waypoints', keys: ['waypointBaseRadiusPx', 'waypointFontPx', 'waypointTextPadFactor', 'waypointMinZoomScale', 'waypointSelectedRadiusAddPx', 'waypointStrokeWidthPx'] },
  { name: 'Airfields', keys: ['airfieldMarkerRadiusPx', 'airfieldMarkerWidthFactor', 'airfieldMarkerBaseFactor', 'airfieldStrokeWidthPx', 'airfieldLabelFontPx', 'airfieldLabelOffsetPx', 'airfieldLabelHaloPx', 'airfieldFillColor', 'airfieldOutlineColor'] },
  { name: 'Nav waypoints', keys: ['navWaypointRadiusPx', 'navWaypointStrokeWidthPx', 'navWaypointLabelFontPx', 'navWaypointLabelOffsetPx', 'navWaypointLabelHaloPx', 'navWaypointDotColor'] },
  { name: 'Overlay labels', keys: ['overlayLabelHaloColor', 'overlayLabelHaloAlpha'] },
  { name: 'Frequency changes', keys: ['commChangeRingRadiusPx', 'commChangeRingWidthPx', 'commChangeNoteLatOffset', 'commChangeNoteLngOffset', 'commChangeArrowStartGapPx', 'commChangeArrowWidthPx', 'commChangeArrowColor', 'commChangeArrowLineCap', 'commChangeArrowLineJoin', 'commChangeArrowMiterLimit', 'commChangeArrowHaloPx', 'commChangeArrowHaloColor', 'commChangeArrowHaloAlpha', 'commChangeSelectedColor', 'commChangeSelectedAlpha', 'commChangeSelectedWidthAddPx', 'commChangeArrowBoltPx', 'commChangeArrowBoltAngleDeg', 'commChangeArrowBend1Along', 'commChangeArrowBend2Along', 'commChangeNameFontPx', 'commChangeFreqFontPx', 'commChangeTextColor', 'commChangeTextHaloColor', 'commChangeTextHaloAlpha', 'commChangeTextAlong', 'commChangeTextGapPx', 'commChangeNameHaloWidthPx', 'commChangeFreqHaloWidthPx'] },
  { name: 'Notes', keys: ['noteFontPx', 'notePadXPx', 'notePadYPx', 'noteLineHeightPx', 'noteMinWidthPx', 'noteStrokeWidthPx', 'noteSelectedStrokeWidthPx'] },
  { name: 'Page frame', keys: ['pageFrameLineWidthPx', 'pageFrameDashOnPx', 'pageFrameDashOffPx', 'pageFrameScrimAlpha', 'pageFrameHitPx'] },
  { name: 'Hit testing', keys: ['hitWaypointExtraPx', 'hitLegPx', 'hitLegLabelMinPx', 'hitLegLabelScalePx', 'hitCumLabelMinPx', 'hitCumLabelScalePx'] },
  { name: 'Alt pairs', keys: ['altPairFocusColor', 'altPairFocusWidthPx', 'altPairFocusDashOnPx', 'altPairFocusDashOffPx', 'altPairFocusDotRadiusPx', 'altPairFocusDotColor', 'altPairFocusMs'] },
  { name: 'VOR stations', keys: ['vorMarkerRadiusPx', 'vorMarkerWidthPx', 'vorMarkerColor', 'vorSelectedColor', 'vorLabelFontPx'] },
  { name: 'Reporting badges', keys: ['reportBadgeRadiusPx', 'reportBadgeOffsetPx', 'reportBadgeFontPx', 'reportBadgeColor', 'reportBadgeTextColor'] },
  { name: 'Chrome layout', keys: ['inspectorDefaultTopPx', 'inspectorBottomGapPx', 'zuluClockMinWidthPx', 'zuluClockPadYPx', 'zuluClockPadXPx', 'zuluClockMarginTopPx', 'zuluClockMarginRightPx', 'zuluClockFontPx', 'zuluClockFontWeight', 'zuluClockLineHeight', 'zuluClockTextColor', 'zuluClockBgColor', 'zuluClockBgAlpha', 'zuluClockBorderColor', 'zuluClockBorderWidthPx', 'zuluClockBorderRadiusPx', 'zuluClockShadowYPx', 'zuluClockShadowBlurPx', 'zuluClockShadowAlpha'] },
  { name: 'Export', keys: ['exportBgColor'] },
  { name: 'Global palette', keys: ['inkColor', 'selectedColor', 'kiteTextColor', 'legKiteHaloColor'] },
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
  navWpUrl: 'data/nav-waypoints.json?v=3',  // resolved relative to index.html (docs/)
  navWpSearchField: 'en',              // which locale label to show/search in results
  airfieldsUrl: 'data/airfields.json?v=3',  // resolved relative to index.html (docs/)
  airfieldLabelField: 'en',            // which locale label to show on the overlay
  commChangeUrl: 'data/comm-change.json?v=1', // CVFR comm-change reporting points (issue #399)
  legAltitudeUrl: 'data/leg-altitude.json?v=1', // CVFR green-route leg altitude table
  routeTemplatesUrl: 'data/route-templates.json?v=1', // ready-made route templates
  vorUrl: 'data/vor.json?v=1',              // Israeli VOR/DME stations (#404 follow-up)

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
  tbShowReporting: 'Show mandatory reports',        // reporting-type overlay toggle
  tbShowReportingTitle: 'Badge waypoints that are mandatory (חובה) reporting points',
  tbShowMsa: 'Show MSA',                            // leg-inspector minimum safe altitude row
  tbShowMsaTitle: 'Show minimum safe altitude (terrain + 1000 ft) in the leg inspector. Planning aid only.',
  report: 'Reporting',
  reportingMandatory: '📍 Mandatory report',
  reportingOnRequest: '📍 Report on request',
  tbSearchPlaceholder: '🔍 Find navigation waypoint',
  tbSearchHint: 'Tip: type space-separated waypoint codes (e.g. LLHZ BAZRA DEROR SHARO HADRA) and press Enter to build a route.',
  errSearchUnknown: function(t) { return 'Unknown waypoint: ' + t; },
  searchReplaceConfirm: 'Replace the current route with these waypoints?',
  choosePointTitle: 'Choose point',
  choosePointRoute: 'Route waypoint',
  choosePointAirfield: 'Airfield',
  choosePointNavWaypoint: 'Navigation waypoint',
  choosePointVor: 'VOR station',
  choosePointCommChange: 'Freq-change arrow',
  tbSearchOpen: '🔍 Find (Ctrl-F)',
  tbSearchOpenTitle: 'Open the search overlay (Ctrl/Cmd-F)',
  tbRouteTemplates: '🧭 Templates',
  tbRouteTemplatesTitle: 'Build a ready-made route',
  tbRouteLibrary: '💾 Saved routes',
  tbRouteLibraryTitle: 'Save, load and manage your routes (stored on this device)',
  routeLibraryTitle: 'Saved routes',
  routeLibrarySaveCurrent: 'Save current route',
  routeLibraryNamePlaceholder: 'Route name',
  routeLibraryEmpty: 'No saved routes yet',
  routeLibraryLoad: 'Load',
  routeLibraryRename: 'Rename',
  routeLibraryDuplicate: 'Duplicate',
  routeLibraryDelete: 'Delete',
  routeLibraryDeleteConfirm: 'Delete this saved route?',
  routeLibraryReplaceConfirm: 'Replace the current route with this saved route?',
  routeLibraryExport: 'Export library',
  routeLibraryImport: 'Import library',
  routeLibrarySaved: function (name) { return name + ' saved'; },
  routeLibraryGdriveSync: 'Sync with Google Drive',
  routeLibraryGdriveSyncing: 'Syncing…',
  routeLibraryGdriveSynced: 'Synced with Google Drive',
  routeLibraryGdriveError: 'Drive sync failed',
  routeTemplatesTitle: 'Route templates',
  routeTemplateRoute: 'Route',
  routeTemplateSpeed: 'Speed (kt)',
  routeTemplateApply: 'Build route',
  routeTemplateEmpty: 'No route templates available',
  routeTemplateLoadError: 'Could not load route templates.',
  routeTemplateReplaceConfirm: 'Replace the current route with this template?',
  routeTemplateBadSpeed: 'Enter a valid speed in knots.',
  routeTemplateReady: function(name, speed) {
    return name + ' template loaded at ' + speed + ' kt';
  },
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
  errInvalidVors: function(msg) { return 'Invalid VOR data: ' + msg; },
  tbShowVor: 'Show VOR stations',
  tbShowVorTitle: 'Overlay Israeli VOR/DME stations and pick a reference for radial/DME',
  vorRefLabel: 'VOR ref',
  vorRefNone: '— none —',
  tbShowWind: 'Show wind effect',
  tbShowWindTitle: 'Show the wind inputs, the per-leg wind arrows, and the wind-corrected readout in the leg inspector',
  tbShowSigmet: 'Show SIGMET',
  tbShowSigmetTitle: 'Overlay active international SIGMET hazard areas for the Israel region (source: NOAA AWC, updated periodically)',
  sigmetReadout: function(n) { return '⚠ ' + n + ' SIGMET'; },
  sigmetNone: 'No SIGMET in effect',
  sigmetUpdated: function(t) { return 'SIGMET updated ' + t; },
  sigmetReadoutClickHint: 'Click to decode',
  sigmetModalTitle: 'Active SIGMETs',
  sigmetRaw: 'Raw',
  tbWindDir: 'Wind °',
  tbWindDirTitle: 'Route-wide wind direction (degrees true, the direction the wind blows FROM)',
  tbWindSpeed: 'Wind kt',
  tbWindSpeedTitle: 'Route-wide wind speed in knots. 0 = calm (no wind effect)',
  windReadout: function(dir, speed) {
    return 'Wind ' + dir + '/' + speed;
  },
  vorName: 'Name',
  vorFreq: 'Frequency',
  vorUseRef: 'Use as reference VOR',
  vorRefActive: '✓ Reference VOR (tap to clear)',
  elevation: 'Elevation',
  navHebrew: 'Waypoint name',
  vorFrom: function(id) { return 'From ' + id + ' VOR'; }, // inspector / readout prefix
  vorRadialDme: function(rad, dme) {                  // e.g. "R-263° / 12.4 NM"
    return 'R-' + rad + '° / ' + dme + ' NM';
  },
  primary: 'Primary',
  atis: 'ATIS',
  clearance: 'Clearance',
  wxTitle: 'Weather (METAR / TAF)',
  wxLoading: 'Loading weather…',
  wxNone: 'No METAR / TAF for this field',
  wxError: 'Weather unavailable (offline or proxy blocked)',
  wxMetar: 'METAR',
  wxTaf: 'TAF',
  wxShowRaw: 'Show raw',
  wxShowDecoded: 'Show decoded',
  wxRefresh: 'Refresh weather',
  wxUpdated: 'Updated',
  errInvalidAirfields: function(msg) { return 'Invalid airfields data: ' + msg; },
  errSavedRouteCorrupt: function(msg) {
    return 'Saved route could not be restored, so the original saved data was preserved. ' +
      'Export or inspect localStorage["navaid.route"] to recover it.' +
      (msg ? '\n\nDetails: ' + msg : '');
  },
  errNoLegs: 'No legs yet — drop at least two waypoints first.',
  flightPlan: 'Flight plan',
  fpHeaders: ['#', 'From', 'To', 'Hdg', 'Dist (NM)', 'Speed (kt)', 'Alt (ft)', 'Time', 'Fuel (gal)', 'Cum. time', 'Cum. fuel', 'Radial', 'DME', ''],
  fpFreq: 'Freq',
  fpHeadersShort: ['#', 'From', 'To', 'Hdg', 'Dist', 'Spd', 'Alt', 'Time', 'Fuel'],
  exportPlanPlace: 'Place flight plan on the map',
  exportPlanPlaceTitle: 'Overlay the flight-plan table on the export; drag it to position it inside the page frame',
  exportPlanNoFrame: 'Place flight plan — set an A3/A4 page first',
  fpVorLabel: 'VOR',
  fpVorRadialEmpty: '—',
  fpDel: '✕',
  fpReturn: 'Return route',
  fpTotal: 'Total',
  fpClose: 'Close',
  fpPrint: 'Print',
  fpCsv: 'CSV',
  fpCsvTitle: 'Export this flight plan as CSV',
  tbNavLog: 'Nav log (PDF)',
  tbNavLogTitle: 'Open a printable kneeboard nav log — save as PDF',
  navLogTitle: 'NavAid — Nav Log',
  navLogDate: 'Date',
  navLogFreqs: 'Frequencies',
  navLogPopupBlocked: 'Allow pop-ups to export the nav log.',
  fpFuel: 'Fuel',
  fpMsa: 'MSA (ft)',
  msaLowTitle: 'Planned altitude is below the minimum safe altitude for this leg',
  profileTitle: 'Vertical profile',
  profileVs: 'V/S (ft/min)',
  fpDirection: 'Direction',
  toc: 'TOC',
  tod: 'TOD',
  tocTitle: 'Top of climb',
  todTitle: 'Top of descent',
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
  windFromDeg: 'Wind from (°)',
  windSpeedKt: 'Wind speed (kt)',
  windEffect: 'With wind',
  windEffectTitle: 'Wind-corrected magnetic heading, ground speed, wind correction angle, and leg time.',
  windEffectText: function(hdg, gs, wca, time) {
    return 'HDG ' + hdg + '  GS ' + gs + '  WCA ' + wca + '  ' + time;
  },
  windUnflyable: 'Wind exceeds true airspeed',
  windResetTitle: 'Clear wind override (use the route wind)',
  tbFetchWind: '⤓ Pull Wind data',
  tbFetchWindTitle: 'Fetch a per-leg winds-aloft forecast from Open-Meteo — each leg gets its own wind at its midpoint and flight level (needs a route)',
  windFetching: 'Fetching wind…',
  windFetchOk: function(hpa, dir, spd) {
    return hpa + ' hPa → ' + dir + '/' + spd;
  },
  windFetchOkLegs: function(n) {
    return 'Per-leg wind set (' + n + ' leg' + (n === 1 ? '' : 's') + ')';
  },
  windFetchErr: 'Wind fetch failed — check connection',
  inboundAlt: 'Inbound alt (ft)',
  outboundAlt: 'Outbound alt (ft)',
  altResetKnown: 'Reset to charted altitude',
  shape: 'Shape',
  shapeRect: 'Rectangle',
  shapeOval: 'Oval',
  color: 'Color',
  deleteNote: '🗑 Delete note (D)',
  latitude: 'Latitude',
  longitude: 'Longitude',
  satelliteSnippet: 'Satellite',
  satelliteExpand: 'Expand',
  satelliteSnippetTitle: 'Satellite view',
  satelliteSnippetOpen: 'Expand satellite view',
  satelliteAttribution: 'Imagery © Esri',
  satelliteZoomIn: 'Zoom in',
  satelliteZoomOut: 'Zoom out',
  satelliteResetCenter: 'Recentre on waypoint',
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
  tbGrpOverlays: 'Overlays',          // View sub-group headings (layout A)
  tbGrpRouteInfo: 'Route info',
  tbGrpSafety: 'Safety',
  tbReverse: '⇄ Reverse route (R)',
  tbReverseTitle: 'Reverse route order',
  tbUndo: '↶ Undo (Ctrl-Z)',
  tbUndoTitle: 'Undo the last edit, move or delete',
  tbClear: '🗑 Clear map (C)',
  tbClearTitle: 'Remove all waypoints and notes',
  tbExportMenu: '⬇ Export',
  tbExport: '⬇ JSON — NavAid route file',
  tbExportTitle: 'Export route (JSON / GPX / PLN / FDR)',
  tbImport: '⬆ Import JSON/GPX/PLN',
  tbImportTitle: 'Import route from JSON or GPX file',
  tbShare: '🔗 Share',
  tbShareTitle: 'Copy a shareable link to this route to the clipboard',
  shareCopied: 'Route link copied to clipboard',
  errShareTooLong: 'Route is too long for a share link (max 64 waypoints). Export as JSON and send the file instead.',
  tbFit: '⌖ Fit to screen (F)',
  tbFitTitle: 'Fit route to view (F)',
  tbPlan: '📋 Flight plan',
  tbPlanTitle: 'Show flight plan table',
  tbFreqTable: '📡 Freq table',
  tbFreqTableTitle: 'Edit local communication frequency defaults',
  tbAltPairs: '🧭 Alt pairs',
  tbAltPairsTitle: 'View and copy learned CVFR altitude pairs',
  tbCharts: '🗺️ Airport charts',
  tbChartsTitle: 'Browse approach charts for all airfields',
  tbFly: '✈️ Open in Google Earth',
  tbFlyTitle: 'Save a Google Earth tour of the route at the planned leg altitudes',
  tbGpxExport: '📍 GPX — GPS track (Garmin, etc.)',
  tbGpxExportTitle: 'Export route as GPX for portable GPS units',
  tbPlnExport: '🛩 PLN — MSFS / P3D flight plan',
  tbPlnExportTitle: 'Export route as a PLN flight plan to fly in MSFS / Prepar3D / FSX',
  tbFdrExport: '🎬 FDR — X-Plane replay',
  tbFdrExportTitle: 'Export route as an X-Plane Flight Data Recorder file that replays the flight',
  tbShowReturn: 'Show return path',
  tbShowReturnTitle: 'Show return-direction (outbound) info',
  tbShowCumTime: 'Show cumulative time',
  tbShowCumTimeTitle: 'Show running total flight time kite after each leg',
  tbShowMidLeg: 'Show leg distance',
  tbShowMidLegTitle: 'Show distance badge at the middle of each leg',
  tbHighlightDiff: 'Highlight alt/speed diff',
  tbHighlightDiffTitle: 'Halo legs whose altitude or speed differs from the adjacent leg',
  tbLimitLegKites: 'Keep kites inside leg',
  tbLimitLegKitesTitle: 'Limit dragged leg markers to the space between the leg waypoints',
  tbShowDrift: 'Show drift lines',
  tbShowDriftTitle: 'Show 10-degree drift reference lines at each leg end',
  tbShowAirfields: 'Show/pin airfields',
  tbShowAirfieldsTitle: 'Overlay published Israeli airfields (BYOP source)',
  tbForceSnap: 'Snap to nearest point',
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
  commChangeTemplateFreq: 'Default',
  freqTableTitle: 'Frequency defaults',
  freqTableCallSign: 'Call sign',
  freqTableDefault: 'Default',
  freqTableOverride: 'Override',
  freqTableRestoreAll: 'Restore originals',
  freqTableEmpty: 'No frequency catalog available',
  freqTableSearch: 'Search frequencies',
  freqTableNoMatches: 'No matching frequencies',
  altPairsTitle: 'CVFR altitude pairs',
  altPairsCopyJson: 'Copy JSON',
  altPairsCopied: 'Copied',
  altPairsCopyFailed: 'Copy failed',
  altPairsEmpty: 'No altitude-pair data available',
  altPairsSearch: 'Search altitude pairs',
  altPairsNoMatches: 'No matching altitude pairs',
  altPairsPair: 'Pair',
  altPairsInbound: 'From → to',
  altPairsOutbound: 'To → from',
  altPairsInboundTitle: 'Altitude in the pair direction: first point → second point',
  altPairsOutboundTitle: 'Altitude in the reverse direction: second point → first point',
  altPairsStatus: 'Direction',
  altPairsDistance: 'NM',
  altPairsBlocked: 'Blocked',
  altitudeUnknown: 'Unknown',
  altPairsUnknown: 'Unknown',
  altPairsOneWay: 'One way',
  altPairsTwoWay: 'Two way',
  altPairsRevertOrigin: 'Revert to origin',
  altPairsRevertDirection: 'Revert this direction to origin',
  altPairsGoTo: function(from, to) { return 'Go to ' + from + ' ↔ ' + to; },
  altPairsLocationMissing: 'Pair endpoints not found',
  addFreqChange: 'Add freq change (Z)',
  deleteFreqChange: '🗑 Delete freq change (X)',
  resetFreqLocation: '↺ Reset callout location',
  resetFreqOverride: 'Reset frequency to default',
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
  updateAvailable: 'New NavAid build available. Hard refresh or reload to update.',
  updateReload: 'Reload',
  updateDismiss: 'Dismiss',
  tbLightMode: 'Light mode',
  tbDarkMode: 'Dark mode',
  tbLightModeTitle: 'Switch between light and dark theme',
  tbClearStore: '🗑 Clear store',
  tbClearStoreTitle: 'Delete all saved routes and settings stored on this device',
  tbClearStoreConfirm: 'Delete ALL saved routes and settings stored on this device? This cannot be undone.',
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
  tbSecView: '👁 View/Set',
  tbSecCharts: '📋 Charts',
  tbSecExport: '📤 Export/import',
  tbSecSim: '✈ Simulator',
  tbSimConnect: 'Connect to simulator',
  tbSimDisconnect: 'Disconnect from simulator',
  tbSimConnectTitle: 'Poll a local SimConnect bridge (e.g. Little NavMap) for live aircraft position',
  tbSimIpLabel: 'Bridge URL',
  tbSimIpTitle: 'HTTP URL of the SimConnect bridge — default http://localhost:2020',
  tbSimFollow: 'Follow aircraft',
  tbSimFollowTitle: 'Keep the map centred on the live aircraft position',
  tbSimStatusOk: '✅ Connected',
  tbSimStatusErr: '⚠ No data',
  tbViewSource: 'GitHub',
  tbWiki: 'Wiki',
  tbPrivacy: 'Privacy',
  tbTerms: 'Terms',
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
  wind: { dir: 270, speed: 0 }, // route-wide wind (#722): dir °true FROM, kt; 0 = calm
};
var showReturn = false;     // outbound (return) markers — off by default
var showMidLeg = false;
var showCumTime = true;     // cumulative-time kites — on by default
var highlightDiff = false;  // purple halo on legs that change altitude
var limitLegKites = true;   // keep dragged leg markers between their two waypoints
var showNavWP = true;       // Israeli VFR reporting-point overlay (default on)
var showReporting = false;  // mandatory reporting badges (opt-in, default off) — issue #404
var navWP = null;           // null = not loaded yet (or last fetch failed —
                            // retry on next toggle / search call); [] or
                            // populated = last fetch resolved successfully.
var showAirfields = true;   // Israeli airfields overlay (default on)
var showVorStations = true; // VOR/DME station overlay (default on)
var vors = null;            // null = not loaded yet; [] or populated once fetched
var vorRef = null;          // ident of the selected reference VOR (radial/DME source)
var inspectorVorRef = undefined; // undefined = follow vorRef; string/'' = inspector-only ref
var forceSnap = false;      // #106: when on, every click snaps to the
                            // absolute nearest airfield / nav-WP regardless
                            // of click distance (otherwise: 18 px radius).
var airfields = null;       // same null/[]/populated convention as navWP —
                            // see loadAirfields() in draw.js. Entries:
                            // { name, he, lat, lng, en?, elev_ft?, atis?, clearance?, plates:[], runways:[]|null }.
                            // `en`, `elev_ft`, `atis`, `clearance`,
                            // `plates`, and `runways` are
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
var legAltitudeMap = null; // null = not loaded yet (or last fetch failed —
                                // retry on next call); {} or populated =
                                // leg-altitude.json segments keyed as
                                // `FROM-TO` for automatic fresh-leg altitudes.
var legAltitudePointIds = null; // Set of endpoint ids from the same file.
var legAltitudeDataset = null;  // Raw validated dataset for Charts copy/view.
var legAltitudeOriginMap = null; // Loaded JSON baseline keyed as FROM-TO.
var legAltitudeDirectionPool = null; // Directed altitude entries, one per allowed direction.
var showDrift = true;       // 10-degree drift reference lines
var showWind = false;       // wind effect (#722): inputs + arrows + readout — opt-in
var showSigmet = false;     // SIGMET hazard overlay — opt-in
var sigmets = null;         // null = not loaded; [] or populated once fetched
var sigmetMeta = null;      // { generatedAt } of the loaded SIGMET file
var showWpNames = true;     // draw waypoint names (off = empty circle)
var wpNameAngle = 0;        // waypoint-name rotation: 0 / 90 / 180 / 270 deg
var yellowAlpha = 0.8;    // global multiplier for yellow label backgrounds (default 80%)
var wpSize = 1;             // waypoint name / number text size scale
var legArrowSize = 1;       // leg arrow (rectangle+triangle) size scale
var legLineWidth = 1;       // leg route line width scale (1 = default 3.5 px)
var driftLineWidth = 1;     // drift reference line width scale (1 = default 1.5 px)

const LEG_ALTITUDE_INFER_MAX_HOPS = 6;
const LEG_ALTITUDE_INFER_MAX_DISTANCE_RATIO = 1.35;
const LEG_ALTITUDE_INFER_MAX_EXTRA_NM = 0.8;

function legZoomScale() {   // zoom + legArrowSize → pixel multiplier for offsets/sizes
  return Math.max(0.35, Math.pow(2, map.getZoom() - 12)) * legArrowSize;
}
var magnifierOn = false;    // magnifying-glass toggle
var magnifierZoom = 2;      // default zoom factor
var magnifierSize = 400;    // magnifier diameter (px)

// --- Simulator live aircraft (issue #691) ----------------------------
// Polls a local SimConnect HTTP bridge (e.g. Little NavMap / MSFS).
// Response JSON: { latitude, longitude, altitude, heading, ias }
var simOn = false;                        // polling active
var simUrl = 'http://localhost:2020';     // bridge base URL
var simAircraft = null;                   // last received {lat,lng,alt,hdg,ias} or null
var simFollow = false;                    // keep map centred on aircraft
let pageSize = null;        // null | 'A3' | 'A4'
// `var` (not `let`) so window.pageOrient writes from ui.js's boot restore
// land on the same binding the toggle reads. Default 'portrait' since most
// CVFR routes are tall (north–south Israel airspace).
var pageOrient = 'portrait';
let pageOffset = { x: 0, y: 0 };   // page-frame drag offset from viewport centre
var aircraft = null;               // null | {gph, taxiGal}
// Flight-plan card placed on the PNG export (#378). null = off; otherwise
// { x, y } top-left in container pixels. planCardRect holds the last rendered
// bounds for hit-testing the drag.
var planCard = null;
var planCardRect = null;

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
    inboundAltitude: NaN,
    outboundAltitude: NaN,
    flightSpeed: 90,
    outboundSpeed: 90,
    _legAltitudeAuto: 1,           // fresh leg; safe to fill from dataset
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
const SAME_REFERENCE_POINT_DEG = 0.0002; // ~22 m at Israel lat, matches snap / overlay suppression.
function sameMapPoint(a, b, eps = SAME_REFERENCE_POINT_DEG) {
  return !!(a && b &&
    Number.isFinite(a.lat) && Number.isFinite(a.lng) &&
    Number.isFinite(b.lat) && Number.isFinite(b.lng) &&
    Math.abs(a.lat - b.lat) < eps &&
    Math.abs(a.lng - b.lng) < eps);
}
function routeWaypointAtPoint(point, skipIdx = -1, eps = SAME_REFERENCE_POINT_DEG) {
  if (!point || !state || !Array.isArray(state.waypoints)) return -1;
  return state.waypoints.findIndex((wp, i) =>
    i !== skipIdx && sameMapPoint(wp, point, eps));
}
function routeOccupiesPoint(point, skipIdx = -1, eps = SAME_REFERENCE_POINT_DEG) {
  return routeWaypointAtPoint(point, skipIdx, eps) !== -1;
}
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
// --- wind triangle (#722) -------------------------------------------
// Resolve the wind that applies to a leg: an explicit per-leg override (with
// either field falling back to the route wind) beats the route-wide wind.
// Returns null for calm (speed <= 0) so callers can skip the no-op math.
function legWindFor(leg) {
  const g = (state.wind && typeof state.wind === 'object') ? state.wind : null;
  const o = (leg && leg.wind && typeof leg.wind === 'object') ? leg.wind : null;
  const dir = o && Number.isFinite(o.dir) ? o.dir
            : (g && Number.isFinite(g.dir) ? g.dir : null);
  const speed = o && Number.isFinite(o.speed) ? o.speed
              : (g && Number.isFinite(g.speed) ? g.speed : null);
  if (!Number.isFinite(dir) || !Number.isFinite(speed) || speed <= 0) return null;
  return { dir: ((Math.round(dir) % 360) + 360) % 360, speed: Math.round(speed) };
}
// Classic wind triangle. Given a true course, true airspeed, and wind
// ({ dir °true FROM, speed kt }), returns the wind correction angle,
// resulting true heading, and ground speed. Returns null when calm, when
// there is no airspeed, or when a crosswind exceeds TAS (no solution — the
// aircraft cannot hold the course).
function windTriangle(courseTrue, tas, wind) {
  if (!wind || !(tas > 0) || !(wind.speed > 0)) return null;
  // Angle of the wind FROM-direction relative to the course.
  const rel = ((wind.dir - courseTrue) * Math.PI) / 180;
  // Crosswind component (perpendicular): positive = wind from the right →
  // crab right (positive WCA, turn into the wind).
  const xw = wind.speed * Math.sin(rel);
  const sinWca = xw / tas;
  if (Math.abs(sinWca) >= 1) return null;            // unflyable crosswind
  const wca = Math.asin(sinWca);                     // radians (toward the wind)
  // Headwind component: positive = headwind (subtracts from GS).
  const head = wind.speed * Math.cos(rel);
  const gs = tas * Math.cos(wca) - head;
  if (!(gs > 0)) return null;                         // wind overpowers TAS
  return {
    wcaDeg: (wca * 180) / Math.PI,
    hdgTrue: ((courseTrue + (wca * 180) / Math.PI) % 360 + 360) % 360,
    gs,
  };
}
// Winds-aloft level mapping (#722): Open-Meteo serves wind/temperature on
// these pressure levels (hPa). Map a planned altitude to the nearest one so a
// CVFR leg at ~3000 ft pulls ~900 hPa, ~5000 ft pulls ~850 hPa, etc.
const OPEN_METEO_LEVELS_HPA =
  [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30];
function altitudeToPressureHpa(ft) {
  const h = (Number.isFinite(ft) ? ft : 0) * 0.3048;        // metres
  return 1013.25 * Math.pow(1 - 2.25577e-5 * h, 5.25588);   // ISA barometric
}
function nearestPressureLevelHpa(ft) {
  const p = altitudeToPressureHpa(ft);
  let best = OPEN_METEO_LEVELS_HPA[0], bd = Infinity;
  for (const lv of OPEN_METEO_LEVELS_HPA) {
    const d = Math.abs(lv - p);
    if (d < bd) { bd = d; best = lv; }
  }
  return best;
}
// SIGMET hazard → colour. Codes per WMO: TS thunderstorm, TURB turbulence,
// ICE icing, MTW mountain wave, VA volcanic ash, DS/SS dust/sand storm, TC
// tropical cyclone. Unknown hazards fall back to the thunderstorm red.
function sigmetHazardColor(hz) {
  switch (String(hz || '').toUpperCase()) {
    case 'TURB': return '#e67e22';
    case 'ICE':  return '#1ba1e2';
    case 'MTW':  return '#8e44ad';
    case 'VA':   return '#7f5539';
    case 'DS':
    case 'SS':   return '#b8860b';
    case 'TC':   return '#c2185b';
    default:     return '#dd1111';   // TS + anything else (6-hex for alpha fill)
  }
}
// Decode a SIGMET's coded fields into a plain-language sentence, e.g.
// "TEL AVIV FIR — Severe Turbulence, FL080–FL180, moving SE 20 kt,
//  valid 06:00–10:00Z". Falls back gracefully on unknown codes.
function decodeSigmet(s) {
  if (!s || typeof s !== 'object') return '';
  const HAZ = {
    TS: 'Thunderstorm', TSGR: 'Thunderstorm with hail', GR: 'Hail',
    TURB: 'Turbulence', ICE: 'Icing', MTW: 'Mountain wave', VA: 'Volcanic ash',
    DS: 'Duststorm', SS: 'Sandstorm', TC: 'Tropical cyclone', FC: 'Funnel cloud',
    RDOACT: 'Radioactive cloud',
  };
  const QUAL = {
    OBSC: 'Obscured', EMBD: 'Embedded', FRQ: 'Frequent', SQL: 'Squall line',
    SEV: 'Severe', MOD: 'Moderate', ISOL: 'Isolated', OCNL: 'Occasional',
    HVY: 'Heavy', WDSPR: 'Widespread',
  };
  const lvl = v => {
    if (!Number.isFinite(v)) return null;
    if (v <= 0) return 'SFC';
    return 'FL' + pad3(Math.round(v / 100));   // SIGMET levels are flight levels
  };
  const hhmm = u => {
    const d = new Date((Number(u) || 0) * 1000);
    return isNaN(d.getTime()) || !u ? '' :
      String(d.getUTCHours()).padStart(2, '0') + ':' +
      String(d.getUTCMinutes()).padStart(2, '0') + 'Z';
  };
  const parts = [];
  const q = QUAL[String(s.qualifier || '').toUpperCase()];
  const hz = HAZ[String(s.hazard || '').toUpperCase()] || s.hazard || 'Hazard';
  parts.push((q ? q + ' ' : '') + hz);
  const base = lvl(s.base), top = lvl(s.top);
  if (base || top) parts.push((base || 'SFC') + '–' + (top || '—'));
  const dir = (s.dir === 0 || s.dir) ? String(s.dir) : '';
  if (Number.isFinite(s.spd) && s.spd > 0) parts.push('moving ' + (dir ? dir + ' ' : '') + s.spd + ' kt');
  else if (s.spd === 0 || (dir === '' && s.spd == null)) parts.push('stationary');
  const from = hhmm(s.validFrom), to = hhmm(s.validTo);
  if (from || to) parts.push('valid ' + from + '–' + to);
  const fir = s.firName || s.firId || '';
  return (fir ? fir + ' — ' : '') + parts.join(', ');
}
const pad3 = n => String(n).padStart(3, '0');
// Strip a trailing "MHz" unit from a frequency string → "121.70 MHz" → "121.70".
function freqClean(s) { return String(s == null ? '' : s).replace(/\s*MHz\s*$/i, '').trim(); }
// Per-leg comm-frequency sources along the route, sorted by waypoint index:
// each airfield's primary radio frequency (active from the leg departing it)
// plus each comm-change note (which overrides at its waypoint). Used by the
// flight-plan + printed-plan Freq column.
function routeFreqSources() {
  const out = [];
  const wps = state.waypoints || [];
  for (let i = 0; i < wps.length; i++) {
    const af = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wps[i]) : null;
    const f = af && typeof airfieldPrimaryText === 'function' ? freqClean(airfieldPrimaryText(af)) : '';
    if (f) out.push({ wpi: i, freq: f });
  }
  for (const n of (state.notes || [])) {
    if (!n || !n.cc) continue;
    const wpi = typeof commCalloutWaypointIndex === 'function' ? commCalloutWaypointIndex(n) : -1;
    const f = typeof commNoteFreq === 'function' ? commNoteFreq(n) : (n.freq || '');
    if (wpi >= 0 && f) out.push({ wpi, freq: freqClean(f) });
  }
  // Sort by waypoint; comm-change notes are pushed after airfields so a note at
  // the same waypoint sorts last and wins the carry-forward.
  out.sort((a, b) => a.wpi - b.wpi);
  return out;
}
// Active frequency for leg i: the latest source at or before the leg's start.
function legActiveFreq(i, sources) {
  const src = sources || routeFreqSources();
  let f = '';
  for (const c of src) { if (c.wpi <= i) f = c.freq; else break; }
  return f;
}

// --- editable airfield clearance / ATIS frequencies -------------------
// Clearance/ATIS are stored as compound strings ("Arrival 132.50 MHz /
// Departure 132.80 MHz"). Split them into labelled numeric parts so each can
// be edited; edits are persisted as per-airfield/field/part overrides and the
// display string is rebuilt from the (override-aware) parts.
function parseFreqParts(str) {
  const out = [];
  for (const seg of String(str == null ? '' : str).split('/')) {
    const m = seg.match(/(\d{2,3}(?:\.\d{1,3})?)/);
    if (!m) continue;
    const label = seg.slice(0, m.index).replace(/[^A-Za-z֐-׿ ]+/g, ' ').trim();
    out.push({ label, freq: freqClean(m[1]) });
  }
  return out;
}
function airfieldFreqOverrides() {
  try { return JSON.parse(localStorage.getItem('navaid.airfieldFreqOverrides') || '{}') || {}; }
  catch (e) { return {}; }
}
function setAirfieldFreqOverride(key, val) {
  const o = airfieldFreqOverrides();
  if (val) o[key] = val; else delete o[key];
  try { localStorage.setItem('navaid.airfieldFreqOverrides', JSON.stringify(o)); } catch (e) { /* ignore */ }
}
// Override-aware labelled parts for an airfield field ('clearance' | 'atis').
function airfieldFieldParts(af, field) {
  if (!af || typeof af[field] !== 'string') return [];
  const parts = parseFreqParts(af[field]);
  const ov = airfieldFreqOverrides();
  return parts.map((p, i) => {
    const key = af.name + '|' + field + '|' + i;
    const o = ov[key];
    return { label: p.label, freq: o || p.freq, def: p.freq, key, overridden: !!o && o !== p.freq };
  });
}
// Override-aware display string for an airfield field.
function airfieldFieldText(af, field) {
  const parts = airfieldFieldParts(af, field);
  if (!parts.length) return af && typeof af[field] === 'string' ? af[field].trim() : '';
  return parts.map(p => (p.label ? p.label + ' ' : '') + p.freq + ' MHz').join(' / ');
}
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

// --- vertical profile: top-of-climb / top-of-descent (#672) -------------
// Default GA climb/descent performance (C172-ish); overridable per aircraft.
const WX_DEFAULT_PERF = { climbFpm: 500, descentFpm: 500, climbKt: 75, descentKt: 110 };
// Field elevation at route endpoint waypoint i (airfield elev_ft) or null.
function routeEndpointElev(i) {
  const wp = state.waypoints[i];
  if (!wp) return null;
  const af = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wp) : null;
  return af && Number.isFinite(af.elev_ft) ? af.elev_ft : null;
}
// Model each leg at its own planned altitude. A leg ramps gradually (at the
// climb/descent rate, over distance — not a vertical step) from its start
// altitude to its own altitude; the first leg climbs out of the departure
// field, the last leg descends into the destination field. The ramp is
// confined to the leg. TOC/TOD markers are emitted only when the departure /
// destination is an actual airfield (has a field elevation); intermediate
// per-leg altitude changes are drawn but not marked. Returns per-leg
// time/fuel, altitude-vs-distance vertices (pts), and wpCum (cumulative NM at
// each waypoint, for the distance axis).
function routeProfile(ac) {
  ac = ac || (typeof aircraft === 'object' && aircraft) || {};
  // A single vertical-speed (V/S) override drives both the climb and descent
  // ramp slope when set (the profile's V/S input); otherwise per-aircraft perf.
  const vs = typeof window !== 'undefined' && window.profileVS > 0 ? window.profileVS : 0;
  const climbFpm = vs > 0 ? vs : (ac.climbFpm > 0 ? ac.climbFpm : WX_DEFAULT_PERF.climbFpm);
  const descFpm = vs > 0 ? vs : (ac.descentFpm > 0 ? ac.descentFpm : WX_DEFAULT_PERF.descentFpm);
  const climbKt = ac.climbKt > 0 ? ac.climbKt : WX_DEFAULT_PERF.climbKt;
  const descKt = ac.descentKt > 0 ? ac.descentKt : WX_DEFAULT_PERF.descentKt;
  const gph = ac.gph > 0 ? ac.gph : 8;
  const legs = state.legs || [], wps = state.waypoints || [];
  const n = legs.length;
  const legAlt = i => Number.isFinite(legs[i].inboundAltitude) ? legs[i].inboundAltitude : 2000;
  // TOC/TOD are only meaningful off/onto the ground, so they're emitted solely
  // when the departure / destination is an actual airfield (has a field elev).
  const depElev = routeEndpointElev(0);
  const destElev = routeEndpointElev(n);
  const fieldStart = depElev != null ? depElev : (n ? legAlt(0) : 2000);
  const fieldEnd = destElev != null ? destElev : (n ? legAlt(n - 1) : 2000);
  const out = { legs: [], pts: [], tocs: [], tods: [], wpCum: [0], wpTime: [0], totalDist: 0, totalTimeH: 0, totalFuel: 0 };

  // Prepass: per-leg distance + cumulative NM at each waypoint.
  const dists = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const A = wps[i], B = wps[i + 1];
    const d = A && B ? geo(A, B).dist : 0;
    dists.push(d); total += d; out.wpCum.push(total);
  }
  out.totalDist = total;
  if (!n) return out;

  let cum = 0;
  for (let i = 0; i < n; i++) {
    const dist = dists[i];
    const cr = legAlt(i);
    const isFirst = i === 0, isLast = i === n - 1;
    // Each leg ramps from its start altitude (field on leg 1, else the previous
    // leg's altitude) up/down to its own altitude at the climb/descent rate, so
    // altitude changes happen gradually over distance — not as a vertical step.
    // The ramp is confined to the leg (capped at the leg distance).
    const startAlt = isFirst ? fieldStart : legAlt(i - 1);
    let climbDist = 0, descDist = 0;
    if (cr > startAlt) climbDist = Math.min(dist, climbKt * ((cr - startAlt) / climbFpm) / 60);
    else if (cr < startAlt) descDist = Math.min(dist, descKt * ((startAlt - cr) / descFpm) / 60);
    // The final leg also descends to the destination field at its end.
    let endDescDist = 0, endAlt = cr;
    if (isLast && cr > fieldEnd) {
      endAlt = fieldEnd;
      endDescDist = Math.min(dist - climbDist - descDist, descKt * ((cr - fieldEnd) / descFpm) / 60);
    }
    const cruiseDist = Math.max(0, dist - climbDist - descDist - endDescDist);
    const climbT = climbKt > 0 ? climbDist / climbKt : 0;
    const descT = descKt > 0 ? (descDist + endDescDist) / descKt : 0;
    const cruiseT = legs[i].flightSpeed > 0 ? cruiseDist / legs[i].flightSpeed : 0;
    const timeH = climbT + cruiseT + descT;
    const fuel = timeH * gph;
    out.legs.push({ dist, timeH, fuel, climbDist, descDist: descDist + endDescDist, cruiseDist, startAlt, cruiseAlt: cr, endAlt });
    // Vertices: start, ramp to cr over the start transition, hold, then (last
    // leg) ramp down to the field at the end.
    out.pts.push({ d: cum, alt: startAlt });
    const trans = climbDist + descDist;
    if (trans > 0) out.pts.push({ d: cum + trans, alt: cr });
    if (endDescDist > 0) out.pts.push({ d: cum + dist - endDescDist, alt: cr });
    out.pts.push({ d: cum + dist, alt: endAlt });
    // TOC only for the first leg climbing out of a departure airfield; TOD only
    // for the last leg descending into a destination airfield. Intermediate
    // altitude ramps are drawn but not marked.
    if (isFirst && depElev != null && climbDist > 0) {
      out.tocs.push({ leg: 0, frac: dist > 0 ? climbDist / dist : 0, alt: cr });
    }
    if (isLast && destElev != null && endDescDist > 0) {
      out.tods.push({ leg: i, frac: dist > 0 ? (dist - endDescDist) / dist : 1, alt: cr });
    }
    cum += dist; out.totalTimeH += timeH; out.totalFuel += fuel;
    out.wpTime.push(out.totalTimeH);
  }
  // Drop consecutive duplicate vertices.
  out.pts = out.pts.filter((p, i, arr) => i === 0 || p.d !== arr[i - 1].d || p.alt !== arr[i - 1].alt);
  return out;
}

// --- airfield METAR / TAF (#670) ---------------------------------------
// NOAA AWC's METAR/TAF API blocks browser CORS and public proxies proved
// unreliable, so a scheduled GitHub Action fetches it server-side and
// publishes wx.json (all Israeli fields) to the `wx-data` branch, served with
// CORS by raw.githubusercontent.com — same pattern as the SIGMET feed. The
// whole file is memoised 5 min; same-origin data/wx.json is the offline /
// first-run fallback. Decoding works off AWC's structured JSON fields.
const WX_URL = 'https://raw.githubusercontent.com/msupino/NavigationApp/wx-data/wx.json';
var _wxFile = null;
async function loadWxFile(force) {
  if (!force && _wxFile && Date.now() - _wxFile.t < 5 * 60000) return _wxFile;
  const parse = d => ({ t: Date.now(), stations: (d && d.stations) || {}, generatedAt: (d && d.generatedAt) || null });
  try {
    const r = await fetch(WX_URL + '?_=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _wxFile = parse(await r.json());
    return _wxFile;
  } catch (e) {
    try {
      const r2 = await fetch('data/wx.json');
      _wxFile = parse(await r2.json());
    } catch (e2) {
      _wxFile = { t: Date.now(), stations: {}, generatedAt: null, error: true };
    }
    return _wxFile;
  }
}
async function fetchAirfieldWx(icao, force) {
  icao = String(icao || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(icao)) return { metar: null, taf: null, unsupported: true };
  const file = await loadWxFile(force);
  const st = file.stations[icao] || {};
  return {
    metar: st.metar || null,
    taf: st.taf || null,
    generatedAt: file.generatedAt,
    error: !!file.error && !st.metar && !st.taf,
  };
}
const WX_CLOUD = {
  SKC: 'Clear', CLR: 'Clear', NSC: 'No sig cloud', NCD: 'No cloud',
  FEW: 'Few', SCT: 'Scattered', BKN: 'Broken', OVC: 'Overcast', VV: 'Vert vis',
};
const WX_PHENOM = {
  MI: 'shallow', BC: 'patches', PR: 'partial', DR: 'low drifting', BL: 'blowing',
  SH: 'showers', TS: 'thunderstorm', FZ: 'freezing',
  RA: 'rain', DZ: 'drizzle', SN: 'snow', SG: 'snow grains', PL: 'ice pellets',
  GR: 'hail', GS: 'small hail', IC: 'ice crystals', UP: 'unknown precip',
  BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash', DU: 'dust',
  SA: 'sand', HZ: 'haze', PY: 'spray', PO: 'dust whirls', SQ: 'squalls',
  FC: 'funnel cloud', DS: 'duststorm', SS: 'sandstorm',
};
function decodeWxString(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).map(tok => {
    let pre = '';
    if (tok[0] === '-') { pre = 'light '; tok = tok.slice(1); }
    else if (tok[0] === '+') { pre = 'heavy '; tok = tok.slice(1); }
    if (tok.slice(0, 2) === 'VC') { pre = 'vicinity '; tok = tok.slice(2); }
    let out = '';
    for (let i = 0; i < tok.length; i += 2) {
      const w = WX_PHENOM[tok.slice(i, i + 2)];
      if (w) out += (out ? ' ' : '') + w;
    }
    return (pre + out).trim() || tok;
  }).join(', ');
}
function wxClouds(clouds) {
  if (!Array.isArray(clouds) || !clouds.length) return '';
  return clouds.map(c => (WX_CLOUD[c.cover] || c.cover) +
    (Number.isFinite(c.base) ? ' ' + c.base + ' ft' : '')).join(', ');
}
function wxWind(dir, spd, gst) {
  if (spd === 0) return 'Wind calm';
  if (spd == null && dir == null) return '';
  const d = (dir === 'VRB' || dir == null) ? 'variable' : pad3(dir) + '°';
  return 'Wind ' + d + ' ' + spd + ' kt' + (gst ? ' gust ' + gst : '');
}
// Decode a METAR from AWC's JSON object into a plain-language line.
function decodeMetar(m) {
  if (!m) return '';
  const p = [];
  const w = wxWind(m.wdir, m.wspd, m.wgst); if (w) p.push(w);
  if (m.visib != null) p.push('Vis ' + m.visib + (/^[0-9.]+$/.test(String(m.visib)) ? ' SM' : ''));
  if (m.wxString) p.push(decodeWxString(m.wxString));
  const cl = wxClouds(m.clouds); if (cl) p.push(cl);
  if (m.temp != null) p.push('Temp ' + Math.round(m.temp) + '°C' +
    (m.dewp != null ? ' / dew ' + Math.round(m.dewp) + '°C' : ''));
  if (m.altim != null) p.push('QNH ' + Math.round(m.altim) + (m.altim > 900 ? ' hPa' : ' inHg'));
  return p.join(' · ');
}
// Decode a TAF (AWC JSON) into one decoded line per forecast period.
function decodeTaf(t) {
  if (!t) return [];
  const fc = t.fcsts || t.forecast || [];
  const hh = u => {
    const d = new Date((Number(u) || 0) * 1000);
    return isNaN(d.getTime()) || !u ? '' :
      String(d.getUTCDate()).padStart(2, '0') + ' ' +
      String(d.getUTCHours()).padStart(2, '0') + ':' +
      String(d.getUTCMinutes()).padStart(2, '0') + 'Z';
  };
  return fc.map(f => {
    const seg = [];
    const ch = (f.fcstChange || '').toUpperCase();
    const tag = ch === 'TEMPO' ? 'TEMPO ' : ch === 'BECMG' ? 'BECMG ' : 'From ';
    const w = wxWind(f.wdir, f.wspd, f.wgst); if (w) seg.push(w);
    if (f.visib != null) seg.push('Vis ' + f.visib + (/^[0-9.]+$/.test(String(f.visib)) ? ' SM' : ''));
    if (f.wxString) seg.push(decodeWxString(f.wxString));
    const cl = wxClouds(f.clouds); if (cl) seg.push(cl);
    return { when: tag + hh(f.timeFrom), text: seg.join(' · ') };
  }).filter(s => s.text);
}
function sameAltitudeValue(a, b) {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}
function altitudeUnknownLabel() {
  return S.altitudeUnknown || S.altPairsUnknown || 'Unknown';
}
function altitudeBlockedLabel() {
  return S.altitudeBlocked || S.altPairsBlocked || 'Blocked';
}
function legAltitudeIsBlocked(leg, key) {
  if (!leg) return false;
  if (key === 'inboundAltitude') return Boolean(leg._legAltitudeInboundBlocked);
  if (key === 'outboundAltitude') {
    return Boolean(leg._legAltitudeOutboundBlocked) ||
      (Boolean(leg._legAltitudeOneWay) && !leg._legAltitudeInboundBlocked);
  }
  return false;
}
function legAltitudePlaceholder(leg, key) {
  return legAltitudeIsBlocked(leg, key) ? altitudeBlockedLabel() : altitudeUnknownLabel();
}
function formatAltitudeValue(v, leg, key) {
  if (legAltitudeIsBlocked(leg, key)) return altitudeBlockedLabel();
  return Number.isFinite(v) ? String(v) : altitudeUnknownLabel();
}
function altitudeInputValue(v) {
  return Number.isFinite(v) ? String(v) : '';
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
  while (state.legs.length < need) {
    const i = state.legs.length;
    state.legs.push(newLeg());
    applyLegAltitudeToLeg(i);
  }
  while (state.legs.length > need) state.legs.pop();
  applyLegAltitudesToRoute();
}

function legAltitudeKey(from, to) {
  return String(from || '').trim() + '-' + String(to || '').trim();
}
function legAltitudeDirectionsFromSegments(segments) {
  const out = [];
  for (const segment of segments || []) {
    if (!segment || typeof segment.from !== 'string' || typeof segment.to !== 'string') continue;
    if (Number.isInteger(segment.inboundAltitude)) {
      out.push({
        from: segment.from,
        to: segment.to,
        altitude: segment.inboundAltitude,
        segment: legAltitudeKey(segment.from, segment.to),
        field: 'inboundAltitude',
      });
    }
    if (Number.isInteger(segment.outboundAltitude)) {
      out.push({
        from: segment.to,
        to: segment.from,
        altitude: segment.outboundAltitude,
        segment: legAltitudeKey(segment.from, segment.to),
        field: 'outboundAltitude',
      });
    }
  }
  return out;
}
function syncLegAltitudeDatasetDirectionPool(data) {
  if (!data || !Array.isArray(data.segments)) return [];
  const pool = legAltitudeDirectionsFromSegments(data.segments);
  data.directionPool = pool;
  if (data === legAltitudeDataset) legAltitudeDirectionPool = pool;
  return pool;
}
function cloneLegAltitudeOrigin(segment) {
  return JSON.parse(JSON.stringify(segment || {}));
}
function resetLegAltitudeOrigins(segments) {
  const origins = {};
  for (const segment of segments || []) {
    if (!segment || !segment.from || !segment.to) continue;
    origins[legAltitudeKey(segment.from, segment.to)] = cloneLegAltitudeOrigin(segment);
  }
  legAltitudeOriginMap = origins;
}
function normalizeLegAltitudePairSegment(segment) {
  if (!segment) return;
  const nullCount = ['inboundAltitude', 'outboundAltitude']
    .filter(key => segment[key] === null).length;
  if (nullCount === 2) {
    delete segment.oneWay;
    segment.status = 'unknown';
  } else if (nullCount === 1) {
    segment.oneWay = true;
    if (segment.status === 'unknown') segment.status = 'candidate';
  } else {
    delete segment.oneWay;
    if (segment.status === 'unknown') segment.status = 'candidate';
  }
}
function syncLegAltitudeLookupSegment(segment) {
  if (!segment || !segment.from || !segment.to || !legAltitudeMap) return;
  const lookup = legAltitudeMap[legAltitudeKey(segment.from, segment.to)];
  if (!lookup || lookup === segment) return;
  lookup.from = segment.from;
  lookup.to = segment.to;
  lookup.distanceNm = segment.distanceNm;
  lookup.inboundAltitude = segment.inboundAltitude;
  lookup.outboundAltitude = segment.outboundAltitude;
  lookup.oneWay = segment.oneWay === true;
  lookup.status = segment.status || 'candidate';
}
function legAltitudeOriginSegment(segment) {
  if (!segment || !segment.from || !segment.to || !legAltitudeOriginMap) return null;
  return legAltitudeOriginMap[legAltitudeKey(segment.from, segment.to)] || null;
}
function legAltitudePairComparable(segment) {
  if (!segment) return null;
  return {
    inboundAltitude: segment.inboundAltitude === null ? null :
      (Number.isFinite(segment.inboundAltitude) ? Math.round(segment.inboundAltitude) : undefined),
    outboundAltitude: segment.outboundAltitude === null ? null :
      (Number.isFinite(segment.outboundAltitude) ? Math.round(segment.outboundAltitude) : undefined),
    oneWay: segment.oneWay === true,
    status: segment.status || '',
  };
}
function legAltitudePairDiffersFromOrigin(segment) {
  const origin = legAltitudeOriginSegment(segment);
  if (!origin) return false;
  return JSON.stringify(legAltitudePairComparable(segment)) !==
    JSON.stringify(legAltitudePairComparable(origin));
}
function restoreLegAltitudePairOrigin(segment) {
  const origin = legAltitudeOriginSegment(segment);
  if (!segment || !origin) return false;
  const before = JSON.stringify(legAltitudePairComparable(segment));
  const restored = cloneLegAltitudeOrigin(origin);
  for (const key of Object.keys(segment)) delete segment[key];
  Object.assign(segment, restored);
  normalizeLegAltitudePairSegment(segment);
  syncLegAltitudeLookupSegment(segment);
  syncLegAltitudeDatasetDirectionPool(legAltitudeDataset);
  return before !== JSON.stringify(legAltitudePairComparable(segment));
}
function legAltitudeKnownPointName(name) {
  const raw = String(name || '').trim();
  const candidates = [];
  const push = v => {
    const s = String(v || '').trim();
    if (s && !candidates.includes(s)) candidates.push(s);
  };
  push(raw);
  if (typeof canonicalNavWaypointName === 'function') push(canonicalNavWaypointName(raw));
  if (Array.isArray(airfields)) {
    for (const af of airfields) {
      if (!af) continue;
      if (raw && (af.name === raw || af.en === raw || af.he === raw)) push(af.name);
    }
  }
  if (!legAltitudePointIds) return candidates[0] || '';
  return candidates.find(v => legAltitudePointIds.has(v)) || '';
}
function legAltitudePointAtWaypoint(wp) {
  if (!wp) return '';
  const named = legAltitudeKnownPointName(wp.name);
  if (named) return named;
  if (!legAltitudePointIds) return '';
  let best = null;
  const visit = ref => {
    if (!ref || !legAltitudePointIds.has(ref.name)) return;
    const d = geo(wp, ref).dist;
    if (d <= 0.05 && (!best || d < best.dist)) best = { name: ref.name, dist: d };
  };
  if (Array.isArray(navWP)) navWP.forEach(visit);
  if (Array.isArray(airfields)) airfields.forEach(visit);
  return best ? best.name : '';
}
function legAltitudeDirectionalEdges() {
  const edges = {};
  const add = (from, to, altitude, distanceNm) => {
    if (!from || !to || !Number.isFinite(altitude) ||
        !Number.isFinite(distanceNm) || distanceNm <= 0) return;
    (edges[from] || (edges[from] = [])).push({ to, altitude, distanceNm });
  };
  const distanceBySegment = {};
  for (const segment of Object.values(legAltitudeMap || {})) {
    distanceBySegment[legAltitudeKey(segment.from, segment.to)] = segment.distanceNm;
  }
  if (Array.isArray(legAltitudeDirectionPool) && legAltitudeDirectionPool.length) {
    for (const dir of legAltitudeDirectionPool) {
      add(dir.from, dir.to, dir.altitude, distanceBySegment[dir.segment]);
    }
  } else {
    for (const segment of Object.values(legAltitudeMap || {})) {
      add(segment.from, segment.to, segment.inboundAltitude, segment.distanceNm);
      add(segment.to, segment.from, segment.outboundAltitude, segment.distanceNm);
    }
  }
  return edges;
}
function inferConsistentLegAltitude(from, to, directDistanceNm) {
  if (!from || !to || from === to || !Number.isFinite(directDistanceNm)) return null;
  const edges = legAltitudeDirectionalEdges();
  const maxDistance = directDistanceNm * LEG_ALTITUDE_INFER_MAX_DISTANCE_RATIO +
    LEG_ALTITUDE_INFER_MAX_EXTRA_NM;
  const queue = [{
    node: from,
    altitude: null,
    distanceNm: 0,
    hops: 0,
    path: [from],
  }];
  const bestDistance = {};
  const foundAltitudes = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || cur.hops >= LEG_ALTITUDE_INFER_MAX_HOPS) continue;
    for (const edge of edges[cur.node] || []) {
      if (cur.path.includes(edge.to)) continue;
      const altitude = cur.altitude === null ? edge.altitude : cur.altitude;
      if (cur.altitude !== null && edge.altitude !== cur.altitude) continue;
      const distanceNm = cur.distanceNm + edge.distanceNm;
      if (distanceNm > maxDistance) continue;
      if (edge.to === to) {
        foundAltitudes.add(altitude);
        continue;
      }
      const key = edge.to + '|' + altitude;
      if (Number.isFinite(bestDistance[key]) && bestDistance[key] <= distanceNm) continue;
      bestDistance[key] = distanceNm;
      queue.push({
        node: edge.to,
        altitude,
        distanceNm,
        hops: cur.hops + 1,
        path: cur.path.concat(edge.to),
      });
    }
  }
  if (foundAltitudes.size !== 1) return null;
  return foundAltitudes.values().next().value;
}
function legAltitudeForLeg(i) {
  if (!legAltitudeMap || !state.waypoints[i] || !state.waypoints[i + 1]) return null;
  const from = legAltitudePointAtWaypoint(state.waypoints[i]);
  const to = legAltitudePointAtWaypoint(state.waypoints[i + 1]);
  if (!from || !to || from === to) return null;
  const resolveSegment = (segment, reverse) => {
    const inboundAltitude = reverse ? segment.outboundAltitude : segment.inboundAltitude;
    const outboundAltitude = reverse ? segment.inboundAltitude : segment.outboundAltitude;
    const inboundBlocked = inboundAltitude === null && segment.oneWay === true;
    const outboundBlocked = outboundAltitude === null && segment.oneWay === true;
    if (!Number.isFinite(inboundAltitude) && !Number.isFinite(outboundAltitude) &&
        !inboundBlocked && !outboundBlocked) {
      return null;
    }
    return {
      key: legAltitudeKey(segment.from, segment.to),
      inboundAltitude,
      outboundAltitude,
      inboundBlocked,
      outboundBlocked,
    };
  };
  const direct = legAltitudeMap[legAltitudeKey(from, to)];
  if (direct) {
    const match = resolveSegment(direct, false);
    if (match) return match;
  }
  const reverse = legAltitudeMap[legAltitudeKey(to, from)];
  if (reverse) {
    const match = resolveSegment(reverse, true);
    if (match) return match;
  }
  const directDistanceNm = geo(state.waypoints[i], state.waypoints[i + 1]).dist;
  const inferredInbound = inferConsistentLegAltitude(from, to, directDistanceNm);
  const inferredOutbound = inferConsistentLegAltitude(to, from, directDistanceNm);
  if (Number.isFinite(inferredInbound) || Number.isFinite(inferredOutbound)) {
    return {
      key: legAltitudeKey(from, to),
      inboundAltitude: Number.isFinite(inferredInbound) ? inferredInbound : null,
      outboundAltitude: Number.isFinite(inferredOutbound) ? inferredOutbound : null,
      inboundBlocked: false,
      outboundBlocked: false,
      inferred: true,
    };
  }
  return null;
}
function legAltitudePairMatchForLeg(i) {
  if (!legAltitudeMap || !state.waypoints[i] || !state.waypoints[i + 1]) return null;
  const from = legAltitudePointAtWaypoint(state.waypoints[i]);
  const to = legAltitudePointAtWaypoint(state.waypoints[i + 1]);
  if (!from || !to || from === to) return null;
  const directKey = legAltitudeKey(from, to);
  if (legAltitudeMap[directKey]) {
    return { key: directKey, segment: legAltitudeMap[directKey], reverse: false };
  }
  const reverseKey = legAltitudeKey(to, from);
  if (legAltitudeMap[reverseKey]) {
    return { key: reverseKey, segment: legAltitudeMap[reverseKey], reverse: true };
  }
  return null;
}
function rawLegAltitudeSegment(key) {
  if (!legAltitudeDataset || !Array.isArray(legAltitudeDataset.segments)) return null;
  return legAltitudeDataset.segments.find(segment =>
    legAltitudeKey(segment && segment.from, segment && segment.to) === key) || null;
}
function setLegAltitudePairValue(segment, key, value) {
  if (!segment) return false;
  const next = Number.isFinite(value) ? Math.round(value) : null;
  const changed = segment[key] !== next;
  segment[key] = next;
  normalizeLegAltitudePairSegment(segment);
  syncLegAltitudeLookupSegment(segment);
  syncLegAltitudeDatasetDirectionPool(legAltitudeDataset);
  return changed;
}
function syncLegAltitudePairFromRouteLeg(i, key, value) {
  if (key !== 'inboundAltitude' && key !== 'outboundAltitude') return false;
  const match = legAltitudePairMatchForLeg(i);
  if (!match) return false;
  const pairKey = match.reverse
    ? (key === 'inboundAltitude' ? 'outboundAltitude' : 'inboundAltitude')
    : key;
  let changed = setLegAltitudePairValue(match.segment, pairKey, value);
  const raw = rawLegAltitudeSegment(match.key);
  if (raw && raw !== match.segment) {
    changed = setLegAltitudePairValue(raw, pairKey, value) || changed;
  }
  return changed;
}
function applyLegAltitudeToLeg(i) {
  const leg = state.legs[i];
  if (!leg || !leg._legAltitudeAuto) return false;
  if (legAltitudeMap === null) return false;
  const match = legAltitudeForLeg(i);
  if (match) {
    const nextInbound = Number.isFinite(match.inboundAltitude)
      ? match.inboundAltitude
      : NaN;
    const nextOutbound = Number.isFinite(match.outboundAltitude)
      ? match.outboundAltitude
      : NaN;
    const changed = !sameAltitudeValue(leg.inboundAltitude, nextInbound) ||
      !sameAltitudeValue(leg.outboundAltitude, nextOutbound) ||
      leg._legAltitudeKey !== match.key ||
      Boolean(leg._legAltitudeInboundBlocked) !== Boolean(match.inboundBlocked) ||
      Boolean(leg._legAltitudeOutboundBlocked) !== Boolean(match.outboundBlocked) ||
      Boolean(leg._legAltitudeOneWay) !== Boolean(match.outboundBlocked);
    leg.inboundAltitude = nextInbound;
    leg.outboundAltitude = nextOutbound;
    leg._legAltitudeKey = match.key;
    if (match.inboundBlocked) leg._legAltitudeInboundBlocked = 1;
    else delete leg._legAltitudeInboundBlocked;
    if (match.outboundBlocked) {
      leg._legAltitudeOutboundBlocked = 1;
      leg._legAltitudeOneWay = 1;
    } else {
      delete leg._legAltitudeOutboundBlocked;
      delete leg._legAltitudeOneWay;
    }
    return changed;
  }
  const changed = !sameAltitudeValue(leg.inboundAltitude, NaN) ||
    !sameAltitudeValue(leg.outboundAltitude, NaN) ||
    Boolean(leg._legAltitudeKey) ||
    Boolean(leg._legAltitudeInboundBlocked) ||
    Boolean(leg._legAltitudeOutboundBlocked) ||
    Boolean(leg._legAltitudeOneWay);
  leg.inboundAltitude = NaN;
  leg.outboundAltitude = NaN;
  delete leg._legAltitudeKey;
  delete leg._legAltitudeInboundBlocked;
  delete leg._legAltitudeOutboundBlocked;
  delete leg._legAltitudeOneWay;
  return changed;
}
function applyLegAltitudesToRoute() {
  let changed = false;
  for (let i = 0; i < state.legs.length; i++) {
    if (applyLegAltitudeToLeg(i)) changed = true;
  }
  return changed;
}
function markLegAltitudeManual(i) {
  const leg = state.legs[i];
  if (!leg) return;
  delete leg._legAltitudeAuto;
  delete leg._legAltitudeKey;
  delete leg._legAltitudeInboundBlocked;
  delete leg._legAltitudeOutboundBlocked;
  delete leg._legAltitudeOneWay;
}
function legAllowsReturn(i) {
  const leg = state.legs[i];
  return !(leg && (leg._legAltitudeOutboundBlocked || leg._legAltitudeOneWay));
}
// The charted altitude for a leg as loaded from leg-altitude.json — read from
// the pristine ORIGIN map, never the live (route-editable) lookup. The leg
// inspector uses this for its default / reset-to-charted value so a hand-edited
// altitude elsewhere doesn't redefine what "charted" means in the inspector.
function legAltitudeOriginForLeg(i) {
  if (!legAltitudeOriginMap || !state.waypoints[i] || !state.waypoints[i + 1]) return null;
  const from = legAltitudePointAtWaypoint(state.waypoints[i]);
  const to = legAltitudePointAtWaypoint(state.waypoints[i + 1]);
  if (!from || !to || from === to) return null;
  const resolve = (segment, reverse) => {
    const inboundAltitude = reverse ? segment.outboundAltitude : segment.inboundAltitude;
    const outboundAltitude = reverse ? segment.inboundAltitude : segment.outboundAltitude;
    if (!Number.isFinite(inboundAltitude) && !Number.isFinite(outboundAltitude)) return null;
    return { inboundAltitude, outboundAltitude };
  };
  const direct = legAltitudeOriginMap[legAltitudeKey(from, to)];
  if (direct) { const m = resolve(direct, false); if (m) return m; }
  const reverse = legAltitudeOriginMap[legAltitudeKey(to, from)];
  if (reverse) { const m = resolve(reverse, true); if (m) return m; }
  return null;
}
