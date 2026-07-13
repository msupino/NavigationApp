'use strict';

/* ------------------------------------------------------------------ *
 * NavAid — HTML5 CVFR flight-route planner.
 * Leaflet base map (Flight Maps tiles) + a canvas route overlay.
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

function shortcutTypingTarget(t) {
  return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}

function shortcutKey(e, code, key) {
  const k = String(e && e.key || '');
  return e && (e.code === code || k === key || k === String(key || '').toUpperCase());
}

function shortcutPlain(e, code, key) {
  return shortcutKey(e, code, key) && !e.ctrlKey && !e.metaKey && !e.altKey;
}

// Hidden developer tuning registry. Open with `?tune=1` to preview visual
// constants without editing source. Values are page-local and reset on reload.
NavAid.tuning = {};
NavAid.tuningDefaults = {
  magneticVariationDeg: { value: -5, min: -30, max: 30, step: 0.5, label: 'Magnetic variation (° — negative = E)' },
  msaBufferFt: { value: 1000, min: 0, max: 5000, step: 100, label: 'MSA clearance above terrain (ft)' },

  profileClimbFpm: { value: 500, min: 100, max: 3000, step: 50, label: 'Default climb rate (fpm)' },
  profileDescentFpm: { value: 500, min: 100, max: 3000, step: 50, label: 'Default descent rate (fpm)' },
  profileClimbKt: { value: 75, min: 30, max: 200, step: 1, label: 'Default climb speed (kt)' },
  profileDescentKt: { value: 110, min: 30, max: 250, step: 1, label: 'Default descent speed (kt)' },
  defaultGph: { value: 8, min: 1, max: 60, step: 0.5, label: 'Default fuel burn (GPH)' },
  defaultTaxiGal: { value: 1.1, min: 0, max: 10, step: 0.1, label: 'Default taxi/run-up fuel (gal)' },

  legAltInferMaxHops: { value: 6, min: 1, max: 20, step: 1, label: 'Alt inference max hops' },
  legAltInferMaxDistRatio: { value: 1.35, min: 1, max: 3, step: 0.05, label: 'Alt inference max distance ratio' },
  legAltInferMaxExtraNm: { value: 0.8, min: 0, max: 10, step: 0.1, label: 'Alt inference max extra NM' },

  commChangeSnapPx: { value: 18, min: 2, max: 60, step: 1, label: 'Comm-change snap distance (px)' },
  originResnapArmPx: { value: 18, min: 2, max: 60, step: 1, label: 'Origin re-snap arm distance (px)' },

  planCardBaseRowPx: { value: 16, min: 6, max: 48, step: 1, label: 'Plan card row height (px)' },
  planCardGripPx: { value: 22, min: 8, max: 60, step: 1, label: 'Plan card resize grip (px)' },
  planCardBgColor: { value: '#ffffff', type: 'color', label: 'Plan card background color' },
  planCardHeaderBgColor: { value: '#e8e6e1', type: 'color', label: 'Plan card header color' },
  planCardTotalBgColor: { value: '#f0eee9', type: 'color', label: 'Plan card total color' },
  planCardStripeBgColor: { value: '#dcd8cf', type: 'color', label: 'Plan card stripe color' },
  planCardGridColor: { value: '#7a7470', type: 'color', label: 'Plan card grid color' },
  planCardTextColor: { value: '#1a1a1a', type: 'color', label: 'Plan card text color' },
  planCardGripColor: { value: '#0b5ed7', type: 'color', label: 'Plan card grip color' },
  planCardGripLineColor: { value: '#ffffff', type: 'color', label: 'Plan card grip line color' },

  satellitePreviewZoom: { value: 16, min: 10, max: 19, step: 1, label: 'Satellite preview zoom' },
  satelliteExpandedZoom: { value: 17, min: 10, max: 20, step: 1, label: 'Satellite expanded zoom' },
  satelliteMinZoom: { value: 13, min: 8, max: 18, step: 1, label: 'Satellite min zoom' },
  satelliteMaxZoom: { value: 18, min: 12, max: 20, step: 1, label: 'Satellite max zoom' },
  satelliteChartOverscale: { value: 1, min: 0, max: 3, step: 1, label: 'Satellite chart overscale levels' },

  magBaselineZoom: { value: 12, min: 8, max: 18, step: 1, label: 'Magnifier baseline zoom' },
  magMaxExp: { value: 4, min: 1, max: 6, step: 1, label: 'Magnifier max sub-tile exponent' },

  undoLimit: { value: 50, min: 5, max: 500, step: 5, label: 'Undo history depth' },
  rotDragPx: { value: 8, min: 1, max: 40, step: 1, label: 'Rotate drag threshold (px)' },
  shareMaxWaypoints: { value: 64, min: 8, max: 256, step: 1, label: 'Share URL max waypoints' },

  routeLineWidthPx: { value: 3.5, min: 0.5, max: 12, step: 0.1, label: 'Route line width' },
  routeSelectedLineWidthPx: { value: 5, min: 0.5, max: 16, step: 0.1, label: 'Selected route line width' },

  driftAngleDeg: { value: 10, min: 1, max: 30, step: 0.5, label: 'Drift angle deg' },
  driftLengthFactor: { value: 0.5, min: 0.05, max: 1, step: 0.05, label: 'Drift length factor' },
  driftDashOnPx: { value: 12, min: 1, max: 60, step: 1, label: 'Drift dash on' },
  driftDashOffPx: { value: 8, min: 0, max: 60, step: 1, label: 'Drift dash gap' },
  driftStrokeWidthPx: { value: 1.5, min: 0.25, max: 8, step: 0.25, label: 'Drift stroke width' },
  windArrowColor: { value: '#0b5ed7', type: 'color', label: 'Wind arrow color' },
  windArrowHaloColor: { value: '#ffffff', type: 'color', label: 'Wind arrow halo color' },
  windTextHaloColor: { value: '#ffffff', type: 'color', label: 'Wind text halo color' },

  defaultLabelMarginPx: { value: 20, min: 0, max: 80, step: 1, label: 'Default marker margin' },
  defaultKiteHalfWidthPx: { value: 23, min: 1, max: 80, step: 1, label: 'Default kite half-width' },

  legKiteFillColor: { value: '#00ff00', type: 'color', label: 'Leg kite fill color' },
  returnKiteFillColor: { value: '#ffccd6', type: 'color', label: 'Return kite fill color' },
  legKiteHeightPx: { value: 47, min: 8, max: 120, step: 1, label: 'Leg kite height' },
  legKiteCellWidthPx: { value: 24, min: 8, max: 80, step: 1, label: 'Leg kite cell width' },
  legKiteTriangleLenPx: { value: 35, min: 8, max: 100, step: 1, label: 'Leg kite triangle length' },
  legKiteBorderPx: { value: 2, min: 0.25, max: 8, step: 0.25, label: 'Leg kite border width' },
  legKiteDividerPx: { value: 1, min: 0.25, max: 6, step: 0.25, label: 'Leg kite divider width' },
  legKiteHaloPx: { value: 7, min: 0, max: 20, step: 0.5, label: 'Leg kite halo width' },
  legKiteTextPx: { value: 13, min: 4, max: 36, step: 1, label: 'Leg kite text size' },
  legKiteHeadingTextPx: { value: 13, min: 4, max: 40, step: 1, label: 'Leg kite heading text size' },
  legKiteHeadingAnchor: { value: 0.25, min: -0.5, max: 1, step: 0.01, label: 'Leg kite heading anchor' },

  cumKiteFillColor: { value: '#00ff00', type: 'color', label: 'Cum kite fill color' },
  returnCumKiteFillColor: { value: '#ffccd6', type: 'color', label: 'Return cum kite fill color' },
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
  distanceBadgeFillColor: { value: '#fff6aa', type: 'color', label: 'Distance badge fill color' },

  waypointBaseRadiusPx: { value: 13, min: 2, max: 60, step: 1, label: 'Waypoint base radius' },
  waypointFontPx: { value: 13, min: 4, max: 40, step: 1, label: 'Waypoint text size' },
  waypointTextFitFactor: { value: 0.85, min: 0.3, max: 1, step: 0.05, label: 'Waypoint text fit (fraction of diameter)' },
  waypointMinZoomScale: { value: 0.35, min: 0.1, max: 2, step: 0.05, label: 'Waypoint min zoom scale' },
  waypointSelectedRadiusAddPx: { value: 2, min: 0, max: 20, step: 0.5, label: 'Selected waypoint radius add' },
  waypointStrokeWidthPx: { value: 1, min: 0.25, max: 10, step: 0.25, label: 'Waypoint stroke width' },
  waypointFillColor: { value: '#fff6aa', type: 'color', label: 'Waypoint fill color' },

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
  commChangeRingColor: { value: '#e74c3c', type: 'color', label: 'Comm-change ring color' },
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
  noteDefaultFillColor: { value: '#fff6aa', type: 'color', label: 'Default note fill color' },

  pageFrameLineWidthPx: { value: 2, min: 0.25, max: 10, step: 0.25, label: 'Page frame line width' },
  pageFrameDashOnPx: { value: 8, min: 1, max: 60, step: 1, label: 'Page frame dash on' },
  pageFrameDashOffPx: { value: 5, min: 0, max: 60, step: 1, label: 'Page frame dash gap' },
  pageFrameScrimColor: { value: '#141212', type: 'color', label: 'Page frame scrim color' },
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
  labelFillColor: { value: '#fff6aa', type: 'color', label: 'Default label fill color' },
  kiteTextColor: { value: '#000000', type: 'color', label: 'Kite text color' },
  legKiteHaloColor: { value: '#8e44ad', type: 'color', label: 'Leg kite halo color' },
  airfieldFillColor: { value: '#2f6fd0', type: 'color', label: 'Airfield fill color' },
  airfieldOutlineColor: { value: '#0a1a2a', type: 'color', label: 'Airfield outline color' },
  navWaypointDotColor: { value: '#ffffff', type: 'color', label: 'Nav waypoint dot color' },

  driftLineColor: { value: '#141414', type: 'color', label: 'Drift line color' },
  driftLineAlpha: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'Drift line alpha' },
  gpsBreadcrumbColor: { value: '#1e88e5', type: 'color', label: 'GPS breadcrumb color' },
  gpsBreadcrumbWidthPx: { value: 3, min: 1, max: 10, step: 0.5, label: 'GPS breadcrumb width' },
  overlayLabelHaloColor: { value: '#ffffff', type: 'color', label: 'Overlay label halo color' },
  overlayLabelHaloAlpha: { value: 0.85, min: 0, max: 1, step: 0.05, label: 'Overlay label halo alpha' },

  altPairFocusColor: { value: '#ff3030', type: 'color', label: 'Alt-pair focus line color' },
  altPairFocusWidthPx: { value: 5, min: 0.5, max: 16, step: 0.5, label: 'Alt-pair focus line width' },
  altPairFocusDashOnPx: { value: 10, min: 0, max: 40, step: 1, label: 'Alt-pair focus dash on' },
  altPairFocusDashOffPx: { value: 8, min: 0, max: 40, step: 1, label: 'Alt-pair focus dash gap' },
  altPairFocusDotRadiusPx: { value: 7, min: 1, max: 30, step: 0.5, label: 'Alt-pair focus endpoint radius' },
  altPairFocusDotColor: { value: '#ff3030', type: 'color', label: 'Alt-pair focus endpoint fill' },
  altPairFocusMs: { value: 10000, min: 1000, max: 60000, step: 500, label: 'Alt-pair focus duration (ms)' },

  exportBgColor: { value: '#231f20', type: 'color', label: 'PNG export background color' },

  liveAircraftFillColor: { value: '#000000', type: 'color', label: 'Live aircraft fill color' },
  liveAircraftOutlineColor: { value: '#ffffff', type: 'color', label: 'Live aircraft outline color' },

  profileBgColor: { value: '#1d2733', type: 'color', label: 'Profile background color' },
  profileGridColor: { value: '#7896b4', type: 'color', label: 'Profile grid color' },
  profileAxisColor: { value: '#5a6b7d', type: 'color', label: 'Profile axis color' },
  profileGroundColor: { value: '#3a4654', type: 'color', label: 'Profile ground line color' },
  profileTextColor: { value: '#8aa0b4', type: 'color', label: 'Profile axis text color' },
  profileNmTextColor: { value: '#cdd8e3', type: 'color', label: 'Profile NM text color' },
  profileTimeTextColor: { value: '#7fa8d0', type: 'color', label: 'Profile time text color' },
  profileAreaColor: { value: '#5096e6', type: 'color', label: 'Profile area color' },
  profileLineColor: { value: '#5a96e6', type: 'color', label: 'Profile line color' },
  profileTocColor: { value: '#2e9e4f', type: 'color', label: 'TOC marker color' },
  profileTodColor: { value: '#c47f17', type: 'color', label: 'TOD marker color' },
  profileMarkerHaloColor: { value: '#ffffff', type: 'color', label: 'TOC/TOD halo color' },

  sigmetTurbColor: { value: '#e67e22', type: 'color', label: 'SIGMET turbulence color' },
  sigmetIceColor: { value: '#1ba1e2', type: 'color', label: 'SIGMET icing color' },
  sigmetMtwColor: { value: '#8e44ad', type: 'color', label: 'SIGMET mountain wave color' },
  sigmetVaColor: { value: '#7f5539', type: 'color', label: 'SIGMET volcanic ash color' },
  sigmetDustColor: { value: '#b8860b', type: 'color', label: 'SIGMET dust/sand color' },
  sigmetTcColor: { value: '#c2185b', type: 'color', label: 'SIGMET cyclone color' },
  sigmetDefaultColor: { value: '#dd1111', type: 'color', label: 'SIGMET default/TS color' },
  notamColor: { value: '#c026d3', type: 'color', label: 'NOTAM area color' },
  notamFillAlpha: { value: 0.14, min: 0, max: 1, step: 0.02, label: 'NOTAM area fill alpha' },
  notamLineWidthPx: { value: 2, min: 0.5, max: 5, step: 0.5, label: 'NOTAM area line width (px)' },
  notamRouteWidthPx: { value: 3, min: 1, max: 6, step: 0.5, label: 'NOTAM closed-route line width (px)' },
  notamDivertColor: { value: '#0891b2', type: 'color', label: 'NOTAM diverted-route color' },

  imsPwxOpacity: { value: 0.6, min: 0.2, max: 1, step: 0.05, label: 'IMS PWX overlay default opacity' },
  imsPwxLatOffset: { value: 0.005, min: -0.5, max: 0.5, step: 0.005, label: 'IMS PWX overlay latitude nudge (°)' },
  imsPwxLngOffset: { value: -0.015, min: -0.5, max: 0.5, step: 0.005, label: 'IMS PWX overlay longitude nudge (°)' },
  imsPwxLatScale: { value: 0.98, min: 0.8, max: 1.2, step: 0.005, label: 'IMS PWX overlay vertical zoom' },
  imsPwxLngScale: { value: 1.02, min: 0.8, max: 1.2, step: 0.005, label: 'IMS PWX overlay horizontal zoom' },
  imsPwxRotationDeg: { value: -0.5, min: -15, max: 15, step: 0.1, label: 'IMS PWX overlay rotation (°)' },
  imsPwxDarkBackdropAlpha: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'IMS PWX dark-mode footer backdrop (white, 0 = off)' },
  imsPwxBackdropBandPct: { value: 6, min: 0, max: 50, step: 1, label: 'IMS PWX footer backdrop band (% of image height)' },
  sigwxLatOffset: { value: -0.03, min: -2, max: 2, step: 0.01, label: 'SIGWX overlay latitude nudge (°)' },
  sigwxLngOffset: { value: 0, min: -2, max: 2, step: 0.01, label: 'SIGWX overlay longitude nudge (°)' },
  sigwxLatScale: { value: 1, min: 0.7, max: 1.3, step: 0.005, label: 'SIGWX overlay vertical zoom' },
  sigwxLngScale: { value: 1.02, min: 0.7, max: 1.3, step: 0.005, label: 'SIGWX overlay horizontal zoom' },
  sigwxRotationDeg: { value: 0, min: -45, max: 45, step: 0.1, label: 'SIGWX overlay rotation (°)' },
  sigwxOpacity: { value: 0.55, min: 0.2, max: 1, step: 0.05, label: 'SIGWX overlay default opacity' },
  sigwxWhiteKnockout: { value: 170, min: 120, max: 256, step: 1, label: 'SIGWX map-panel knockout lightness (drops paper+terrain so the base layer shows; 256 = off)' },
  sigwxKnockoutSat: { value: 45, min: 0, max: 120, step: 1, label: 'SIGWX map-panel knockout max saturation (keeps coloured hazard areas)' },
  sigwxTblLatOffset: { value: 0, min: -3, max: 3, step: 0.02, label: 'SIGWX table latitude nudge (°)' },
  sigwxTblLngOffset: { value: 0, min: -4, max: 6, step: 0.02, label: 'SIGWX table longitude nudge (°)' },
  sigwxTblScale: { value: 1, min: 0.4, max: 2, step: 0.02, label: 'SIGWX table size' },
  sigwxTblOpacity: { value: 0.92, min: 0.2, max: 1, step: 0.05, label: 'SIGWX table opacity' },

  windFieldDefaultAltFt: { value: 1500, min: 1000, max: 5000, step: 500, label: 'Wind field default altitude (ft)' },
  windFieldDefaultOpacity: { value: 0.7, min: 0.2, max: 1, step: 0.05, label: 'Wind field default opacity' },
  windFieldGridDeg: { value: 0.25, min: 0.1, max: 1, step: 0.05, label: 'Wind field grid spacing (°)' },
  windFieldWest: { value: 34.2, min: 33, max: 37, step: 0.05, label: 'Wind field grid west (°)' },
  windFieldEast: { value: 35.95, min: 33, max: 37, step: 0.05, label: 'Wind field grid east (°)' },
  windFieldSouth: { value: 29.45, min: 28, max: 34, step: 0.05, label: 'Wind field grid south (°)' },
  windFieldNorth: { value: 33.45, min: 28, max: 34, step: 0.05, label: 'Wind field grid north (°)' },
  windFieldVelocityScale: { value: 0.028, min: 0.005, max: 0.08, step: 0.001, label: 'Wind field particle speed scale' },
  windFieldParticleAge: { value: 80, min: 20, max: 200, step: 5, label: 'Wind field particle age (frames)' },
  windFieldParticleMultiplier: { value: 0.0032, min: 0.0005, max: 0.01, step: 0.0001, label: 'Wind field particle density' },
  windFieldLineWidth: { value: 1.8, min: 0.5, max: 4, step: 0.1, label: 'Wind field particle line width' },
  windFieldMaxVelocity: { value: 24, min: 5, max: 60, step: 1, label: 'Wind field max velocity (m/s)' },
  windFieldFrameRate: { value: 22, min: 10, max: 60, step: 1, label: 'Wind field frame rate (fps)' },
  windFieldMinVelocity: { value: 0, min: 0, max: 20, step: 1, label: 'Wind field min velocity (m/s)' },
  windFieldHoursAhead: { value: 24, min: 1, max: 48, step: 1, label: 'Wind field forecast slider range (h)' },
  windFieldForecastDays: { value: 2, min: 1, max: 7, step: 1, label: 'Wind field forecast fetch days' },

  liveAircraftRadiusPx: { value: 18, min: 6, max: 48, step: 1, label: 'Live aircraft size' },
  gotoMarkerColor: { value: '#c0392b', type: 'color', label: 'Go-to marker outline' },
  gotoMarkerFillColor: { value: '#e74c3c', type: 'color', label: 'Go-to marker fill' },
  gotoMarkerRadiusPx: { value: 7, min: 2, max: 24, step: 1, label: 'Go-to marker radius' },
  gotoMarkerWeightPx: { value: 2, min: 0.5, max: 8, step: 0.5, label: 'Go-to marker stroke width' },
  gotoMarkerFillAlpha: { value: 0.85, min: 0, max: 1, step: 0.05, label: 'Go-to marker fill opacity' },
  altPairFocusLineAlpha: { value: 0.95, min: 0, max: 1, step: 0.05, label: 'Alt-pair focus line opacity' },
  altPairFocusDotAlpha: { value: 0.95, min: 0, max: 1, step: 0.05, label: 'Alt-pair focus dot opacity' },
  satellitePreviewWidthPx: { value: 214, min: 120, max: 480, step: 2, label: 'Satellite preview width' },
  satellitePreviewHeightPx: { value: 118, min: 80, max: 360, step: 2, label: 'Satellite preview height' },
  satelliteMarkerRadiusPx: { value: 7, min: 2, max: 24, step: 1, label: 'Satellite marker radius' },
  satelliteMarkerColor: { value: '#ffda4c', type: 'color', label: 'Satellite marker color' },
  satelliteMarkerWeightPx: { value: 2, min: 0.5, max: 8, step: 0.5, label: 'Satellite marker stroke width' },
  satelliteMarkerAlpha: { value: 0.96, min: 0, max: 1, step: 0.02, label: 'Satellite marker opacity' },
  profileAxisHeightPx: { value: 30, min: 12, max: 80, step: 1, label: 'Vertical profile axis height' },
  profileYPadPx: { value: 34, min: 8, max: 80, step: 1, label: 'Vertical profile side padding' },
  airfieldLabelMinZoom: { value: 10, min: 5, max: 16, step: 1, label: 'Airfield label min zoom' },
  navWpLabelMinZoom: { value: 10, min: 5, max: 16, step: 1, label: 'Nav-waypoint label min zoom' },
  vorLabelMinZoom: { value: 8, min: 5, max: 16, step: 1, label: 'VOR label min zoom' },
  windDir: { value: 0, min: 0, max: 360, step: 5, label: 'Default wind direction (°true FROM)' },
  windSpeed: { value: 0, min: 0, max: 200, step: 1, label: 'Default wind speed (kt; 0 = calm)' },

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

  inspectorDefaultTopPx: { value: 96, min: 40, max: 240, step: 1, label: 'Inspector default top' },
  inspectorBottomGapPx: { value: 12, min: 0, max: 120, step: 1, label: 'Inspector bottom gap' },
  zuluClockMinWidthPx: { value: 82, min: 40, max: 180, step: 1, label: 'Zulu clock min width' },
  zuluClockPadYPx: { value: 5, min: 0, max: 24, step: 1, label: 'Zulu clock vertical padding' },
  zuluClockPadXPx: { value: 8, min: 0, max: 36, step: 1, label: 'Zulu clock horizontal padding' },
  zuluClockMarginTopPx: { value: 4, min: 0, max: 80, step: 1, label: 'Zulu clock top margin' },
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
  { name: 'Navigation', keys: ['magneticVariationDeg', 'msaBufferFt'] },
  { name: 'Performance defaults', keys: ['profileClimbFpm', 'profileDescentFpm', 'profileClimbKt', 'profileDescentKt', 'defaultGph', 'defaultTaxiGal'] },
  { name: 'Altitude inference', keys: ['legAltInferMaxHops', 'legAltInferMaxDistRatio', 'legAltInferMaxExtraNm'] },
  { name: 'Plan card', keys: ['planCardBaseRowPx', 'planCardGripPx', 'planCardBgColor', 'planCardHeaderBgColor', 'planCardTotalBgColor', 'planCardStripeBgColor', 'planCardGridColor', 'planCardTextColor', 'planCardGripColor', 'planCardGripLineColor'] },
  { name: 'Satellite', keys: ['satellitePreviewZoom', 'satelliteExpandedZoom', 'satelliteMinZoom', 'satelliteMaxZoom', 'satelliteChartOverscale', 'satellitePreviewWidthPx', 'satellitePreviewHeightPx', 'satelliteMarkerRadiusPx', 'satelliteMarkerColor', 'satelliteMarkerWeightPx', 'satelliteMarkerAlpha'] },
  { name: 'Go-to marker', keys: ['gotoMarkerColor', 'gotoMarkerFillColor', 'gotoMarkerRadiusPx', 'gotoMarkerWeightPx', 'gotoMarkerFillAlpha'] },
  { name: 'Map label zoom', keys: ['airfieldLabelMinZoom', 'navWpLabelMinZoom', 'vorLabelMinZoom'] },
  { name: 'Wind', keys: ['windDir', 'windSpeed'] },
  { name: 'Magnifier', keys: ['magBaselineZoom', 'magMaxExp'] },
  { name: 'Behaviour', keys: ['undoLimit', 'rotDragPx', 'shareMaxWaypoints', 'commChangeSnapPx', 'originResnapArmPx'] },
  { name: 'Route line', keys: ['routeLineWidthPx', 'routeSelectedLineWidthPx'] },
  { name: 'Drift lines', keys: ['driftAngleDeg', 'driftLengthFactor', 'driftDashOnPx', 'driftDashOffPx', 'driftStrokeWidthPx', 'driftLineColor', 'driftLineAlpha'] },
  { name: 'GPS track', keys: ['gpsBreadcrumbColor', 'gpsBreadcrumbWidthPx'] },
  { name: 'Wind arrows', keys: ['windArrowColor', 'windArrowHaloColor', 'windTextHaloColor'] },
  { name: 'Default marker locations', keys: ['defaultLabelMarginPx', 'defaultKiteHalfWidthPx'] },
  { name: 'Leg kites', keys: ['legKiteFillColor', 'returnKiteFillColor', 'legKiteHeightPx', 'legKiteCellWidthPx', 'legKiteTriangleLenPx', 'legKiteBorderPx', 'legKiteDividerPx', 'legKiteHaloPx', 'legKiteTextPx', 'legKiteHeadingTextPx', 'legKiteHeadingAnchor'] },
  { name: 'Cumulative kites', keys: ['cumKiteFillColor', 'returnCumKiteFillColor', 'cumKiteHeightPx', 'cumKiteCellWidthPx', 'cumKiteTriangleLenPx', 'cumKiteBorderPx', 'cumKiteTextPx'] },
  { name: 'Minute markers', keys: ['minuteMarkerFontPx', 'minuteTickEvenPx', 'minuteTickOddPx', 'minuteTickEvenWidthPx', 'minuteTickOddWidthPx', 'minuteLabelOffsetPx'] },
  { name: 'Distance badges', keys: ['distanceBadgeRadiusPx', 'distanceBadgeBorderPx', 'distanceBadgeFontPx', 'distanceBadgeFillColor'] },
  { name: 'Route waypoints', keys: ['waypointBaseRadiusPx', 'waypointFontPx', 'waypointTextFitFactor', 'waypointMinZoomScale', 'waypointSelectedRadiusAddPx', 'waypointStrokeWidthPx', 'waypointFillColor'] },
  { name: 'Airfields', keys: ['airfieldMarkerRadiusPx', 'airfieldMarkerWidthFactor', 'airfieldMarkerBaseFactor', 'airfieldStrokeWidthPx', 'airfieldLabelFontPx', 'airfieldLabelOffsetPx', 'airfieldLabelHaloPx', 'airfieldFillColor', 'airfieldOutlineColor'] },
  { name: 'Nav waypoints', keys: ['navWaypointRadiusPx', 'navWaypointStrokeWidthPx', 'navWaypointLabelFontPx', 'navWaypointLabelOffsetPx', 'navWaypointLabelHaloPx', 'navWaypointDotColor'] },
  { name: 'Overlay labels', keys: ['overlayLabelHaloColor', 'overlayLabelHaloAlpha'] },
  { name: 'Frequency changes', keys: ['commChangeRingRadiusPx', 'commChangeRingWidthPx', 'commChangeRingColor', 'commChangeNoteLatOffset', 'commChangeNoteLngOffset', 'commChangeArrowStartGapPx', 'commChangeArrowWidthPx', 'commChangeArrowColor', 'commChangeArrowLineCap', 'commChangeArrowLineJoin', 'commChangeArrowMiterLimit', 'commChangeArrowHaloPx', 'commChangeArrowHaloColor', 'commChangeArrowHaloAlpha', 'commChangeSelectedColor', 'commChangeSelectedAlpha', 'commChangeSelectedWidthAddPx', 'commChangeArrowBoltPx', 'commChangeArrowBoltAngleDeg', 'commChangeArrowBend1Along', 'commChangeArrowBend2Along', 'commChangeNameFontPx', 'commChangeFreqFontPx', 'commChangeTextColor', 'commChangeTextHaloColor', 'commChangeTextHaloAlpha', 'commChangeTextAlong', 'commChangeTextGapPx', 'commChangeNameHaloWidthPx', 'commChangeFreqHaloWidthPx'] },
  { name: 'Notes', keys: ['noteFontPx', 'notePadXPx', 'notePadYPx', 'noteLineHeightPx', 'noteMinWidthPx', 'noteStrokeWidthPx', 'noteSelectedStrokeWidthPx', 'noteDefaultFillColor'] },
  { name: 'Page frame', keys: ['pageFrameLineWidthPx', 'pageFrameDashOnPx', 'pageFrameDashOffPx', 'pageFrameScrimColor', 'pageFrameScrimAlpha', 'pageFrameHitPx'] },
  { name: 'Hit testing', keys: ['hitWaypointExtraPx', 'hitLegPx', 'hitLegLabelMinPx', 'hitLegLabelScalePx', 'hitCumLabelMinPx', 'hitCumLabelScalePx'] },
  { name: 'Alt pairs', keys: ['altPairFocusColor', 'altPairFocusWidthPx', 'altPairFocusDashOnPx', 'altPairFocusDashOffPx', 'altPairFocusDotRadiusPx', 'altPairFocusDotColor', 'altPairFocusMs', 'altPairFocusLineAlpha', 'altPairFocusDotAlpha'] },
  { name: 'VOR stations', keys: ['vorMarkerRadiusPx', 'vorMarkerWidthPx', 'vorMarkerColor', 'vorSelectedColor', 'vorLabelFontPx'] },
  { name: 'Reporting badges', keys: ['reportBadgeRadiusPx', 'reportBadgeOffsetPx', 'reportBadgeFontPx', 'reportBadgeColor', 'reportBadgeTextColor'] },
  { name: 'Live aircraft', keys: ['liveAircraftFillColor', 'liveAircraftOutlineColor', 'liveAircraftRadiusPx'] },
  { name: 'Vertical profile', keys: ['profileBgColor', 'profileGridColor', 'profileAxisColor', 'profileGroundColor', 'profileTextColor', 'profileNmTextColor', 'profileTimeTextColor', 'profileAreaColor', 'profileLineColor', 'profileTocColor', 'profileTodColor', 'profileMarkerHaloColor', 'profileAxisHeightPx', 'profileYPadPx'] },
  { name: 'SIGMETs', keys: ['sigmetTurbColor', 'sigmetIceColor', 'sigmetMtwColor', 'sigmetVaColor', 'sigmetDustColor', 'sigmetTcColor', 'sigmetDefaultColor'] },
  { name: 'NOTAMs', keys: ['notamColor', 'notamFillAlpha', 'notamLineWidthPx', 'notamRouteWidthPx', 'notamDivertColor'] },
  { name: 'Weather (IMS)', keys: ['imsPwxOpacity', 'imsPwxLatOffset', 'imsPwxLngOffset', 'imsPwxLatScale', 'imsPwxLngScale', 'imsPwxRotationDeg', 'imsPwxDarkBackdropAlpha', 'imsPwxBackdropBandPct'] },
  { name: 'SIGWX overlay', keys: ['sigwxOpacity', 'sigwxLatOffset', 'sigwxLngOffset', 'sigwxLatScale', 'sigwxLngScale', 'sigwxRotationDeg', 'sigwxWhiteKnockout', 'sigwxKnockoutSat', 'sigwxTblOpacity', 'sigwxTblLatOffset', 'sigwxTblLngOffset', 'sigwxTblScale'] },
  // Wind-field render params + grid + defaults. The altitude/time/opacity
  // sliders are live menu controls; their defaults live here.
  { name: 'Wind field', keys: ['windFieldDefaultAltFt', 'windFieldDefaultOpacity', 'windFieldGridDeg', 'windFieldWest', 'windFieldEast', 'windFieldSouth', 'windFieldNorth', 'windFieldVelocityScale', 'windFieldParticleAge', 'windFieldParticleMultiplier', 'windFieldLineWidth', 'windFieldMaxVelocity', 'windFieldMinVelocity', 'windFieldFrameRate', 'windFieldHoursAhead', 'windFieldForecastDays'] },
  { name: 'Chrome layout', keys: ['inspectorDefaultTopPx', 'inspectorBottomGapPx', 'zuluClockMinWidthPx', 'zuluClockPadYPx', 'zuluClockPadXPx', 'zuluClockMarginTopPx', 'zuluClockMarginRightPx', 'zuluClockFontPx', 'zuluClockFontWeight', 'zuluClockLineHeight', 'zuluClockTextColor', 'zuluClockBgColor', 'zuluClockBgAlpha', 'zuluClockBorderColor', 'zuluClockBorderWidthPx', 'zuluClockBorderRadiusPx', 'zuluClockShadowYPx', 'zuluClockShadowBlurPx', 'zuluClockShadowAlpha'] },
  { name: 'Export', keys: ['exportBgColor'] },
  { name: 'Global palette', keys: ['inkColor', 'selectedColor', 'labelFillColor', 'kiteTextColor', 'legKiteHaloColor'] },
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

// Optional remote config: a JSON map of { tuningKey: value } served from a gist
// (or any CORS-enabled URL). Fetched once at boot and applied over the baked-in
// defaults via setTune(), which validates + clamps each value per its spec.
// Unknown keys are ignored. Any failure (offline, blocked, bad JSON) falls back
// silently to the baked-in defaults so the app always boots.
NavAid.configUrl = 'https://gist.githubusercontent.com/msupino/12c6e9d9dfcd783ffbeaa06246783840/raw/navaid-config.json';
// `?nogist` (or `?gist=0`) skips the remote fetch entirely, so the app runs on
// the baked-in defaults alone — handy for reproducing a bug without the live
// gist's overrides, or testing the shipped defaults.
NavAid.gistDisabled = (function () {
  try {
    const p = new URLSearchParams(location.search);
    return p.has('nogist') || p.get('gist') === '0';
  } catch (e) { return false; }
}());
async function loadRemoteConfig() {
  if (!NavAid.configUrl || NavAid.gistDisabled) return 0;
  try {
    // The gist raw host (Fastly) caches the URL ~5 min, so a fresh gist edit
    // wouldn't show up until the TTL lapses. A unique query param is a new cache
    // key → always a cache MISS → newest content. (cache:'no-store' only covers
    // the browser cache, not the CDN.)
    const url = NavAid.configUrl + (NavAid.configUrl.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return 0;
    const o = await r.json();
    if (!o || typeof o !== 'object') return 0;
    let n = 0;
    for (const k in o) {
      if (!NavAid.tuningDefaults[k]) continue;   // ignore keys we don't know
      setTune(k, o[k]);                          // per-spec validation + clamp
      if (NavAid.tuning[k] !== undefined) n++;
    }
    return n;
  } catch (e) {
    return 0;                                    // network/parse error → defaults
  }
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
  navWpUrl: 'data/cvfr-nav-waypoints.json?v=3',  // resolved relative to index.html (docs/)
  navWpSearchField: 'en',              // which locale label to show/search in results
  airfieldsUrl: 'data/airfields.json?v=23',  // resolved relative to index.html (docs/)
  airfieldLabelField: 'en',            // which locale label to show on the overlay
  commChangeUrl: 'data/cvfr-comm-change.json?v=1', // CVFR comm-change reporting points (issue #399)
  legAltitudeUrl: 'data/cvfr-leg-altitude.json?v=1', // CVFR green-route leg altitude table
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
  tbImsPwx: 'Show wind/temp',                       // IMS PWX overlay toggle
  tbImsPwxTitle: 'Overlay the IMS PWX wind & temperature forecast on the map',
  tbImsPwxLevel: 'Level',
  tbImsPwxTime: 'Valid time',
  tbImsPwxOpacity: 'Sign opacity',
  tbImsPwxOpacityReset: 'Reset opacity',
  tbImsPwxRun: 'Model run',
  tbSigwx: '🌐 Significant weather',                // significant-weather viewer button
  tbSigwxTitle: 'View IMS significant-weather charts by valid time',
  tbSigwxTime: 'Valid time',
  tbSigwxOverlay: 'Show significant weather',
  tbSigwxOverlayTitle: 'Overlay the low-level significant-weather prog chart on the map by valid time. Approximate alignment — fine-tune with ?tune. Planning aid only.',
  sigwxModalTitle: 'Significant weather charts',
  sigwxMissing: 'Chart not available for this time yet.',
  sigwxUnavailable: 'Significant-weather charts are temporarily unavailable.',
  tbPwxCharts: '🌬 Wind/temp charts',               // IMS PWX original-chart viewer button
  tbPwxChartsTitle: 'View the IMS wind/temperature (PWX) charts by flight level and valid time',
  pwxModalTitle: 'Wind / temperature charts (PWX)',
  pwxMissing: 'Chart not available for this level/time yet.',
  pwxUnavailable: 'Wind/temp charts are temporarily unavailable.',
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
  choosePointNotam: 'NOTAM',
  tbSearchOpen: '🔍 Find (Ctrl-F)',
  tbSearchOpenTitle: 'Open the search overlay (Ctrl/Cmd-F)',
  tbRouteTemplates: '🧭 Templates',
  tbRouteTemplatesTitle: 'Build a ready-made route',
  tbRouteLibrary: '💾 Saved routes',
  tbRouteLibraryTitle: 'Save, load and manage your routes (stored on this device)',
  tbSaveRoute: '💾 Save route',
  tbSaveRouteTitle: 'Save the current route to your saved routes',
  tbLoadRoute: '📂 Load route',
  tbLoadRouteTitle: 'Open your saved routes to load one',
  routeLibraryTitle: 'Saved routes',
  routeLibrarySaveCurrent: 'Save current route',
  routeLibraryNamePlaceholder: 'Route name',
  routeLibraryEmpty: 'No saved routes yet',
  routeLibraryLoad: 'Load',
  routeLibrarySave: 'Save',
  routeLibrarySaveConfirm: function (name) { return 'Overwrite "' + name + '" with the current route?'; },
  routeLibraryShow: 'Show',
  routeLibraryHide: 'Hide',
  routeLibraryExportGpx: 'GPX',
  routeLibraryRename: 'Rename',
  routeLibraryDuplicate: 'Duplicate',
  routeLibraryDelete: 'Delete',
  routeLibraryDeleteConfirm: 'Delete this saved route?',
  routeLibraryReplaceConfirm: 'Replace the current route with this saved route?',
  routeLibraryExport: 'Export library',
  routeLibraryImport: 'Import library',
  routeLibraryImportNone: 'No valid routes in that file',
  routeLibrarySaved: function (name) { return name + ' saved'; },
  errRouteLibraryCorrupt: 'Your saved-route library is corrupted and could not be read. Export or discard it from the Saved routes menu before saving new routes.',
  routeLibraryCorruptBanner: 'Saved routes could not be read (the stored data is corrupted). Export the raw data to try to recover it, or discard it to start fresh. Saving is blocked until then.',
  routeLibraryExportCorrupt: 'Export corrupted data',
  routeLibraryDiscardCorrupt: 'Discard corrupted library',
  routeLibraryDiscardCorruptConfirm: 'Discard the corrupted saved-route library and start with an empty one? This cannot be undone — export it first if you might want to recover it.',
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
  routeTemplateWrongLayer: function(name, current, need) {
    return 'Can\'t load "' + name + '" on the ' + current + ' layer. Switch to the ' +
      need + ' layer, load the route, then change layer after if required.';
  },
  deleteWp: '🗑 Delete waypoint (D)',                  // inspector button
  resetWpName: '↻ Reset waypoint name',             // inspector — reference snap or clear (placeholder)
  resetWpNameTitle: 'Set name to the nearest reference (airfield / nav-WP), or clear when off-grid (dimmed sequence label)',
  tbResetAllWpNames: '↻ Reset all waypoint names',
  tbResetAllWpNamesTitle: 'Set each name to its nearest reference, or clear when off-grid',
  resetAllWpNamesConfirm: 'Reset all waypoint names to their nearest reference codes, or clear when off-grid (sequence placeholders)?',
  resetLegMarkers: '↻ Reset marker position',       // inspector leg button — reset label offsets
  resetLegMarkersTitle: 'Reset marker position',
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
  tbShowLsa: 'Show LSA bubbles',
  tbShowLsaTitle: 'Overlay LSA airspace areas (bubbles) — shown on the Low Alt layer',
  vorRefLabel: 'VOR ref',
  vorRefNone: '— none —',
  tbShowWind: 'Show per-leg wind effect',
  tbShowWindTitle: 'Show the wind inputs, the per-leg wind arrows, and the wind-corrected readout in the leg inspector',
  tbSigmet: '⚠ SIGMET',
  tbSigmetTitle: 'Active international SIGMET hazard areas for the Israel region (source: NOAA AWC)',
  tbShowNotam: 'Show NOTAMs',
  tbShowNotamTitle: 'Overlay active NOTAM areas for the Israel FIR (LLLL). Click “NOTAM list” for the full texts. Planning aid only.',
  tbNotamList: '📋 NOTAM list',
  tbNotamListTitle: 'Show all active NOTAMs for the Israel FIR as text',
  tbLsaList: '📋 LSA bubbles',
  tbLsaListTitle: 'List the LSA airspace bubbles; click one to zoom to it',
  lsaModalTitle: 'LSA bubbles',
  lsaUnnamed: 'Unnamed area',
  lsaEmpty: 'No LSA areas on this layer.',
  lsaWeekend: 'weekend',
  tbMosaic: '🛰 Mosaic',
  tbMosaicTitle: 'A grid of map previews, one per route waypoint',
  mosaicTitle: 'Route mosaic',
  mosaicEmpty: 'Add route waypoints first.',
  mosaicOpen: 'Open map view',
  mosaicLayer: 'Mosaic layer',
  mosaicZoom: 'Zoom',
  mosaicSize: 'Size',
  mosaicPrint: '🖨 Print',
  tbLookAheadTitle: 'Look ahead: 0 = now; +N = N hours from now',
  notamTimeNow: 'Now',
  notamTimeAt: function(h, t) { return '+' + h + 'h · ' + t; },
  notamModalTitle: 'Active NOTAMs',
  notamNone: 'No active NOTAMs.',
  notamUnavailable: 'NOTAMs unavailable.',
  notamUpdated: function(t) { return 'Updated ' + t; },
  notamRaw: 'Raw',
  notamDecoded: 'Decoded',
  notamFilterLabel: 'Filter NOTAMs by airfield',
  notamFilterAll: 'All',
  notamFilterGlobal: 'Global (FIR)',
  notamShowOnMap: 'Show on map',
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
  // Printed PNG plan-card column headers — fixed kneeboard set.
  planColDestination: 'Destination',
  planColDirection: 'Direction',
  planColAltitude: 'Altitude',
  planColSpeed: 'Speed',
  planColLegTime: 'Time of leg',
  planColLegFuel: 'Fuel of leg',
  planColRadial: 'Radial',
  planColDme: 'DME',
  planColComm: 'Comm freq',
  fpFreq: 'Freq',
  freqNone: 'None',
  fpHeadersShort: ['#', 'From', 'To', 'Hdg', 'Dist', 'Spd', 'Alt', 'Time', 'Fuel'],
  fpColumns: 'Columns',
  fpColumnsAll: 'All columns',
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
  navLogDepFreqs: 'Departure frequencies',
  navLogArrFreqs: 'Arrival frequencies',
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
  errNothingToSave: 'Nothing to save — add at least two waypoints to your route first.',
  flyConfirm: 'Fly the route in Google Earth Pro (desktop).\n\nPress OK to save the tour file (.kml), then open it in Google Earth — the “Fly the route” tour appears under Places; press play to fly above the terrain.\n\nNo Google Earth? Free desktop app: google.com/earth/versions',
  geWebConfirm: 'Open the route in Google Earth Web (browser).\n\nThe KML file will also be downloaded so you can drag it into the web page to see the full route.',
  chooseGeMode: 'Open in',
  geModeApp: 'Google Earth Pro (KML)',
  geModeWeb: 'Google Earth Web',
  legTitle: function(n) { return 'Leg ' + n; },
  legArrow: '→',                       // direction arrow in leg inspector title (LTR)
  speedKt: 'Speed (kt)',
  legDirection: 'Direction',
  windFromDeg: 'Wind from (°)',
  windSpeedKt: 'Wind speed (kt)',
  windEffect: 'With wind',
  windEffectTitle: 'Wind-corrected magnetic heading, ground speed, wind correction angle, and leg time.',
  windEffectText: function(hdg, gs, wca, time) {
    return 'HDG ' + hdg + '  GS ' + gs + '  WCA ' + wca + '  ' + time;
  },
  windUnflyable: 'Wind exceeds true airspeed',
  windResetTitle: 'Clear wind override (use the route wind)',
  windFetching: 'Fetching wind…',
  windFetchOk: function(hpa, dir, spd) {
    return hpa + ' hPa → ' + dir + '/' + spd;
  },
  windFetchOkLegs: function(n) {
    return 'Per-leg wind set (' + n + ' leg' + (n === 1 ? '' : 's') + ')';
  },
  windFetchErr: 'Wind fetch failed — check connection',
  tbWindField: 'Show wind field',
  tbWindFieldTitle: 'Animated winds-aloft field (~3000 ft) from a live Open-Meteo grid',
  tbWindFieldAlt: 'Altitude',
  tbWindFieldOpacity: 'Field opacity',
  tbWindFieldOpacityReset: 'Reset opacity',
  tbWindFieldTime: 'Time',
  windFieldLoading: 'Loading wind field…',
  windFieldErr: 'Wind field unavailable',
  windFieldNorthUpOnly: 'Wind field shows north-up only — rotate the map to 0°',
  // AI assistant (assistant.js)
  assistantTitle: 'Flight plan assistant',
  assistantSettings: 'Settings',
  assistantClear: 'Clear chat',
  assistantClose: 'Close',
  assistantMaxSteps: 'Stopped after several steps without a final answer — try rephrasing.',
  assistantActLookup: 'looking up',
  assistantPlaceholder: 'Ask about NOTAMs, weather, or plan a route…',
  assistantSend: 'Send',
  assistantGetKey: 'Get an API key',
  assistantFreeTier: 'free tier',
  assistantCorsNote: 'This provider may block direct browser calls (CORS) — if so, set a proxy base URL above.',
  assistantBaseUrlPlaceholder: 'Base URL (optional proxy)',
  assistantKeyPlaceholder: 'API key',
  assistantModelPlaceholder: 'model',
  assistantSaveKey: 'Save',
  assistantKeySaved: 'Settings saved',
  assistantNoKey: 'Add an API key in settings to start chatting.',
  assistantError: 'Assistant error',
  assistantEditedRoute: 'Assistant edited the route',
  assistantConfirmSave: 'Save this route as',
  assistantActNotam: 'checking NOTAMs',
  assistantActWx: 'checking weather',
  assistantActRoute: 'updating route',
  assistantActSave: 'saving route',
  windUpdatedLabel: 'Wind updated (Z)',
  inboundAlt: 'Inbound alt (ft)',
  outboundAlt: 'Outbound alt (ft)',
  altResetKnown: 'Reset to charted altitude',
  shape: 'Shape',
  shapeRect: 'Rectangle',
  shapeOval: 'Oval',
  color: 'Color',
  noteSize: 'Size',
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
  tbBrandTag: '— CVFR flight planner for Israel',
  tbAbout: 'About',
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
  tbShowCircuit: 'Show circuit overlays',
  tbShowCircuitTitle: 'Overlay georeferenced circuit/VFR plates for Israeli airfields',
  tbCircuitOpacity: 'Circuit opacity',
  tbCircuitOpacityTitle: 'Adjust circuit overlay opacity',
  tbCircuitOpacityReset: 'Reset opacity',
  tbShowTraining: 'Show training areas',
  tbShowTrainingTitle: 'Overlay georeferenced training-area plates for Israeli airfields',
  tbTrainingOpacity: 'Training opacity',
  tbTrainingOpacityTitle: 'Adjust training-area overlay opacity',
  tbTrainingOpacityReset: 'Reset opacity',
  tbShowCvfr: 'Show CVFR routes',
  tbShowCvfrTitle: 'Overlay georeferenced CVFR route / comm-failure entry plates for Israeli airfields',
  tbCvfrOpacity: 'CVFR opacity',
  tbCvfrOpacityTitle: 'Adjust CVFR route overlay opacity',
  tbCvfrOpacityReset: 'Reset opacity',
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
  commChangeCallSigns: 'Call signs',
  commChangeName: 'Call sign',
  commChangeFreq: 'Frequency',
  commChangeAuto: 'Auto',
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
  altPairsTitleFor: function (label) { return label + ' altitude pairs'; },
  altPairsCopyJson: 'Copy JSON',
  altPairsCopied: 'Copied',
  altPairsCopyFailed: 'Copy failed',
  altPairsResetAll: '↻ Reset all',
  altPairsResetAllTitle: 'Revert all altitude pairs to origin',
  altPairsPinTitle: 'Keep Alt pairs open when focusing a pair',
  altPairsPinnedTitle: 'Alt pairs stays open when focusing a pair',
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
  addFreqChange: 'Add frequency change (Z)',
  deleteFreqChange: '🗑 Delete freq change (X)',
  resetFreqLocation: '↻ Reset callout location',
  resetFreqLocationTitle: 'Reset callout location',
  resetFreqOverride: 'Reset frequency to default',
  resetFreqAuto: 'Reset call sign and frequency to Auto',
  plates: 'Charts',
  inspOpenCharts: '🗺️ Airport charts',
  inspOpenChartsTitle: 'Open this airfield in the Charts window',
  notamInspLabel: 'NOTAMs',
  notamInspNone: 'N/A',
  notamInspView: function (n) { return '📋 View ' + n; },
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
  tbClearStore: '🗑 Clear local store',
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
  tbPrintPageSize: 'Page size',
  tbOrientTitle: 'Orientation — click to toggle landscape / portrait',
  modalCloseTitle: 'Close',
  tbPrint: '⬇ Save PNG',
  tbPrintTitle: 'Save the framed map + route as a PNG',
  tbMagnifier: '🔍 Magnifying glass (M)',
  tbMagnifierTitle: 'Magnifying glass (M) — zoomed view at cursor; +/− adjust loupe zoom while open',
  // Footer-button labels carry NO icon prefix: the button's own
  // .footer-link-icon span renders the glyph, so an emoji in the label
  // showed a double icon in the mobile footer menu.
  tbGpsRecord: 'Start recording',
  tbGpsRecordTitle: 'Start recording your flown track from the device GPS; Stop saves it to your routes',
  tbGpsStop: 'Stop recording',
  tbGpsLive: 'Show location',
  tbGpsLiveTitle: 'Show your live position on the map (device GPS, no recording)',
  tbGpsLiveStop: 'Hide location',
  gpsUnsupported: 'GPS is not available in this browser.',
  gpsNoTrack: 'No track recorded.',
  gpsError: 'GPS error: ',
  magSettingsTitle: 'Magnifier',
  magZoomLabel: 'Zoom',
  magZoomTitle: 'Magnifier zoom factor',
  magLoading: 'Perfecting…',
  tbResetAllMarkers: '↻ Reset all marker positions',
  tbResetAllMarkersTitle: 'Reset all leg marker offsets to default positions',
  inspCloseTitle: 'Close',
  inspCloseLabel: 'Close',
  tbSecEdit: '✏️ Edit',
  tbSecMap: '🗺 Map',
  tbSecRoute: '📋 Route',
  tbSecDisplay: '🎚️ Display',
  tbSecPrint: '🖨 Print',
  tbSecBuild: '✏️ Edit',
  tbSecView: '👁 View/Set',
  tbSecCharts: '📋 Charts',
  tbSecExport: '📤 Export/import',
  tbSecWeather: '🗂 Extra layers',
  // Offline map packs (offline-tiles.js, Charts section)
  tbOfflineCharts: '⬇ Download offline maps',
  tbOfflineChartsTitle: 'Pre-download the current map layer so it works with no internet (tap again to cancel)',
  offlineDownloadConfirm: 'Download the current map for offline use? About ',
  offlineDelete: '🗑 Delete offline maps',
  offlineDeleteConfirm: 'Delete the offline maps?',
  offlineCancel: '✕ Cancel — ',
  offlineCancelled: 'cancelled',
  offlineDone: 'saved ',
  offlineTilesCount: 'offline tiles: ',
  tbSecSim: 'Simulator',   // footer button + sim modal title; the footer icon span draws the plane
  tbSimConnect: 'Connect to simulator',
  tbSimDisconnect: 'Disconnect from simulator',
  tbSimConnectTitle: 'Poll a local SimConnect bridge (e.g. Little NavMap) for live aircraft position',
  tbSimIpLabel: 'Bridge URL',
  tbSimIpTitle: 'HTTP URL of the SimConnect bridge — default http://localhost:2020',
  tbSimFollow: 'Follow aircraft',
  tbSimFollowTitle: 'Keep the map centred on the live aircraft position',
  tbSimCenter: 'Center on aircraft',
  tbSimCenterTitle: 'Recenter the map on the live aircraft once',
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
  wind: { dir: tune('windDir'), speed: tune('windSpeed') }, // route-wide wind (#722): dir °true FROM, kt; 0 = calm; default is tunable
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
var showLsaBubbles = true;  // LSA airspace bubbles overlay (Low Alt layer; default on)
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
                              // (loaded from cvfr-comm-change.json `callSigns`).
var legAltitudeMap = null; // null = not loaded yet (or last fetch failed —
                                // retry on next call); {} or populated =
                                // cvfr-leg-altitude.json segments keyed as
                                // `FROM-TO` for automatic fresh-leg altitudes.
var legAltitudePointIds = null; // Set of endpoint ids from the same file.
var legAltitudeDataset = null;  // Raw validated dataset for Charts copy/view.
var legAltitudeOriginMap = null; // Loaded JSON baseline keyed as FROM-TO.
var legAltitudeDirectionPool = null; // Directed altitude entries, one per allowed direction.
var legAltitudeMapPrefix = null; // Which layer prefix ('cvfr'/'lsa'/'heli') the loaded table came from.
// The route's altitude table is PINNED to the layer prefix that first filled
// its auto legs: switching the displayed chart (or opening the alt-pairs
// modal, or a boot race) must never silently re-derive a route built against
// another layer's table. The pin resets when the route empties, when a route
// template replaces it, or when a saved route is loaded — those repin to the
// then-active layer on the next apply. Not persisted: after a reload the
// route repins to the restored layer, matching pre-existing boot behavior.
var routeAltPrefix = null;
// Id of the saved-library entry the current route was loaded from (or saved
// as). Set by routeLibraryApply / routeLibrarySaveCurrent; cleared whenever the
// route is replaced from a non-library source (file/template/share/clear). The
// Edit-header Save button overwrites this entry when set, else opens the Saved
// routes menu. Session-only (not persisted across reload).
var currentRouteLibraryId = null;
var showDrift = true;       // 10-degree drift reference lines
var showWind = false;       // wind effect (#722): inputs + arrows + readout — opt-in
var sigmets = null;         // null = not loaded; [] or populated once fetched
var sigmetMeta = null;      // { generatedAt } of the loaded SIGMET file
var showNotam = false;      // NOTAM overlay — opt-in
var notams = null;          // null = not loaded; [] or populated once fetched
var notamMeta = null;       // { generatedAt } of the loaded NOTAM file
var notamBorders = null;    // null = not loaded; { LEBANON:[[ [lat,lng]... ]], ... } border arcs
var showWpNames = true;     // draw waypoint names (off = empty circle)
var yellowAlpha = 0.8;    // global multiplier for yellow label backgrounds (default 80%)
var wpSize = 1;             // waypoint name / number text size scale
var legArrowSize = 1;       // leg arrow (rectangle+triangle) size scale
var legLineWidth = 0.5;     // leg route line width scale (0.5 ≈ 1.75 px of the 3.5 px route width)
var driftLineWidth = 1;     // drift reference line width scale (1 = default 1.5 px)

function legZoomScale() {   // zoom + legArrowSize → pixel multiplier for offsets/sizes
  return Math.max(0.35, Math.pow(2, map.getZoom() - 12)) * legArrowSize;
}
// Readout for a Leaflet zoom level: the raw level plus a linear scale
// multiplier. Zoom is logarithmic — each whole level doubles on-screen
// scale — so the multiplier is anchored at z12 (= 1×, the chart-tile
// baseline the app already uses for kite/label scaling): mult = 2^(z-12).
// e.g. z12.75 → "z12.75 · 1.68×".
function zoomReadoutText(z) {
  const zPart = z % 1 === 0 ? String(z) : z.toFixed(2);
  const mPart = Math.pow(2, z - 12).toFixed(2).replace(/\.?0+$/, '');
  return 'z' + zPart + ' · ' + mPart + '×';
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

const DEFAULT_LABEL_FILL_COLOR = '#fff6aa';

// Tinted fill from any "#rrggbb" hex — yellowAlpha controls the alpha.
function tintFill(hex) {
  let h = (hex || DEFAULT_LABEL_FILL_COLOR).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) h = DEFAULT_LABEL_FILL_COLOR.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${yellowAlpha})`;
}

// Default text-background colour. yellowAlpha directly controls opacity.
const yellowFill = (_) => tintFill(tune('labelFillColor'));

const NOTE_DEFAULT_COLOR = DEFAULT_LABEL_FILL_COLOR;   // matches the existing yellow fill

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
  // Magnetic = True + variation (so −5 means "subtract 5", i.e. 5°E variation).
  // Read from the tune registry (key default -5) so it's adjustable; `magVar`
  // remains the hardcoded fallback/default.
  const mv = typeof tune === 'function' ? tune('magneticVariationDeg') : magVar;
  return ((Math.round(deg + mv) % 360) + 360) % 360;
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
    case 'TURB': return tune('sigmetTurbColor');
    case 'ICE':  return tune('sigmetIceColor');
    case 'MTW':  return tune('sigmetMtwColor');
    case 'VA':   return tune('sigmetVaColor');
    case 'DS':
    case 'SS':   return tune('sigmetDustColor');
    case 'TC':   return tune('sigmetTcColor');
    default:     return tune('sigmetDefaultColor');   // TS + anything else
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

// Per-language localStorage key for draggable menu/panel POSITIONS. The RTL
// (Hebrew) layout mirrors the LTR (English) one, so a spot dragged in one
// language is wrong in the other — store each language's position separately.
function navLangPosKey(base) {
  const lang = (document.documentElement && document.documentElement.lang === 'he') ? 'he' : 'en';
  return base + '.' + lang;
}

// --- NOTAM decoder ---------------------------------------------------
// NOTAMs are terse: a 4-letter ICAO Q-code (subject + condition) plus a free
// text body packed with standard abbreviations. decodeNotam() turns that into
// a plain-English line + an expanded body; the modal keeps a Raw toggle for the
// original. Source: ICAO Annex 15 / Doc 8126 NOTAM Code (subset covering the
// codes the Israel FIR feed emits, plus common extras).
const NOTAM_SUBJ = {            // Q-code letters 2-3 (subject)
  AC: 'Class B/C/D/E surface area', AD: 'Air defense identification zone (ADIZ)',
  AE: 'Control area (CTA)', AF: 'Flight information region (FIR)',
  AH: 'Upper control area (UTA)', AN: 'Area navigation (RNAV) route',
  AP: 'Reporting point', AR: 'ATS route', AT: 'Terminal control area (TMA)',
  AU: 'Upper flight information region (UIR)', AX: 'Intersection',
  AZ: 'Aerodrome traffic zone (ATZ)',
  CA: 'Air/ground facility', CE: 'En-route surveillance radar',
  CG: 'Ground controlled approach (GCA)', CM: 'Surface movement radar',
  CP: 'Precision approach radar (PAR)', CS: 'Secondary surveillance radar (SSR)',
  CT: 'Terminal area radar',
  FA: 'Aerodrome', FF: 'Fire fighting & rescue', FM: 'Meteorological service',
  FP: 'Heliport', FU: 'Fuel availability',
  IC: 'ILS', IG: 'ILS glide path', IL: 'ILS localizer',
  IS: 'ILS Category I', IT: 'ILS Category II', IU: 'ILS Category III',
  LA: 'Approach lighting system', LB: 'Aerodrome beacon',
  LC: 'Runway centre-line lights', LP: 'Precision approach path indicator (PAPI)',
  LT: 'Visual approach slope indicator (VASIS)',
  MA: 'Movement area', MK: 'Parking area', MP: 'Aircraft stands',
  MR: 'Runway', MT: 'Threshold', MX: 'Taxiway',
  NA: 'All radio nav aids', NB: 'Non-directional beacon (NDB)', ND: 'DME',
  NM: 'VOR/DME', NN: 'TACAN', NV: 'VOR', NX: 'Direction-finding station',
  OA: 'Aeronautical information service (AIS)', OB: 'Obstacle',
  OE: 'Aircraft entry requirements', OR: 'Rescue coordination centre',
  PA: 'Standard instrument arrival (STAR)', PD: 'Standard instrument departure (SID)',
  PH: 'Holding procedure', PI: 'Instrument approach procedure',
  PL: 'Flight-plan processing', PM: 'Aerodrome operating minima',
  PR: 'Radio failure procedure', PT: 'Transition altitude/level',
  PU: 'Missed approach procedure',
  RA: 'Airspace reservation', RD: 'Danger area', RM: 'Military operating area',
  RP: 'Prohibited area', RR: 'Restricted area', RT: 'Temporary restricted area',
  SA: 'Automatic terminal information service (ATIS)', SB: 'ATS reporting office',
  SC: 'Area control centre (ACC)', SE: 'Flight information service (FIS)',
  SF: 'Aerodrome flight information service (AFIS)', SP: 'Approach control',
  SS: 'Flight service station', ST: 'Aerodrome control tower (TWR)',
  SV: 'VOLMET broadcast',
  WA: 'Air display', WB: 'Aerobatics', WC: 'Captive balloon or kite',
  WD: 'Demolition of explosives', WE: 'Military exercise', WF: 'Air refuelling',
  WG: 'Glider flying', WJ: 'Banner/target towing', WL: 'Free balloon ascent',
  WM: 'Missile/gun/rocket firing', WP: 'Parachute jumping exercise (PJE)',
  WR: 'Radioactive/toxic materials release', WS: 'Burning or blowing gas',
  WT: 'Mass aircraft movement', WU: 'Unmanned aircraft (UAS/drone) activity',
  WV: 'Formation flight', WW: 'Significant volcanic activity', WZ: 'Model flying',
  GA: 'GNSS (aerodrome-specific)', GW: 'GNSS (area-wide)',
  KK: 'Checklist',
};
const NOTAM_COND = {            // Q-code letters 4-5 (condition/status)
  AC: 'withdrawn for maintenance', AD: 'available for daytime ops',
  AF: 'flight-checked, reliable', AH: 'hours of service changed',
  AK: 'resumed normal ops', AL: 'operative with published limitations',
  AM: 'military ops only', AN: 'available for night ops', AO: 'operational',
  AP: 'available, prior permission required', AR: 'available on request',
  AS: 'unserviceable', AU: 'not available', AW: 'withdrawn',
  CA: 'activated', CC: 'completed', CD: 'deactivated', CE: 'erected',
  CF: 'frequency changed', CG: 'downgraded', CH: 'changed',
  CI: 'identification/call-sign changed', CL: 'realigned', CM: 'displaced',
  CN: 'cancelled', CO: 'operating', CP: 'operating on reduced power',
  CR: 'temporarily replaced', CS: 'installed', CT: 'on test — do not use',
  HW: 'work in progress', HV: 'work completed', HX: 'concentration of birds',
  LC: 'closed', LD: 'unsafe', LI: 'closed to IFR', LL: 'usable (length/width)',
  LN: 'closed at night', LP: 'prohibited', LR: 'restricted to runways/taxiways',
  LS: 'subject to interruption', LT: 'limited to', LV: 'closed to VFR',
  LW: 'will take place', LX: 'operating — caution advised',
  TT: 'trigger NOTAM (AIP amendment)',
  KK: 'checklist',
  XX: 'plain language (see text)',
};
const NOTAM_ABBR = {
  ACFT: 'aircraft', ACT: 'active', ADZ: 'advised', AGL: 'above ground level',
  ALT: 'altitude', AMSL: 'above mean sea level', APCH: 'approach', APRX: 'approximately',
  ARP: 'aerodrome reference point', ATC: 'air traffic control', AUTH: 'authorized',
  AVBL: 'available', AWY: 'airway', BLW: 'below', BTN: 'between', CTC: 'contact',
  CLSD: 'closed', CTN: 'caution', DEP: 'departure', DRG: 'during', EXC: 'except',
  FIR: 'flight information region', FLW: 'following', FM: 'from', FREQ: 'frequency',
  FT: 'feet', GND: 'ground', HGT: 'height', HOL: 'holiday', HR: 'hours',
  LMT: 'local mean time', MAX: 'maximum', MNM: 'minimum', NM: 'nautical miles',
  OPS: 'operations', PJE: 'parachute jumping exercise', PPR: 'prior permission required',
  PSN: 'position', RTE: 'route', RWY: 'runway', SR: 'sunrise', SS: 'sunset',
  TFC: 'traffic', TWR: 'tower', UAS: 'unmanned aircraft system',
  UAV: 'unmanned aerial vehicle', VOR: 'VOR', WEF: 'with effect from', WI: 'within',
  WIP: 'work in progress', WX: 'weather', CHG: 'changed', REF: 'reference',
  AIP: 'AIP', AIC: 'AIC', DOM: 'domestic', REESTABLISHED: 'reestablished',
  MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday',
  SAT: 'Saturday', SUN: 'Sunday', DLY: 'daily',
  // Extra abbreviations seen in the Israel FIR feed (ICAO Doc 8400 subset).
  // NB: AD, ENR, GEN are deliberately NOT expanded — they double as ICAO AIP
  // part identifiers ("PART ENR 5.1", "PAGE AD-2-LLBG", "PART GEN 3.1") in
  // trigger/amendment NOTAMs, where expanding them corrupts the citation.
  FLT: 'flight', NR: 'number', AMDT: 'amendment',
  OPR: 'operated by', HEL: 'helicopter', TRG: 'training', CTR: 'control zone',
  TWY: 'taxiway', TKOF: 'take-off', TKOFF: 'take-off', TEMPO: 'temporary',
  ARO: 'ATS reporting office', APN: 'apron', FPL: 'flight plan', LDG: 'landing',
  FMP: 'flow management position', MAINT: 'maintenance',
  IFR: 'instrument flight rules', VFR: 'visual flight rules', CVFR: 'controlled VFR',
  IAF: 'initial approach fix', ATS: 'air traffic services',
  OBST: 'obstacle', COORD: 'coordinates', COOR: 'coordinates', XNG: 'crossing',
  THR: 'threshold', ARR: 'arrival', PAX: 'passengers', GLD: 'glider',
  COMM: 'communications', INTL: 'international', AFS: 'aeronautical fixed service',
  EQPT: 'equipment', LGT: 'lighting', NAV: 'navigation', EMERG: 'emergency',
  INFO: 'information', MIL: 'military', PARA: 'paragraph',
  PCR: 'pavement classification rating', SKED: 'scheduled', PSNS: 'positions',
  IAA: 'Israel Airports Authority', CAAI: 'Civil Aviation Authority of Israel',
  IDF: 'Israel Defense Forces',
  NE: 'north-east', NW: 'north-west', SE: 'south-east', SW: 'south-west',
  NB: 'northbound', SB: 'southbound', EB: 'eastbound', WB: 'westbound',
};
// Expand the standard abbreviations in a NOTAM body, tidying the source's
// 3-space wrap indentation. Coordinate tokens (digits+N/E/S/W) carry no word
// boundary around their letters, so they pass through untouched.
function expandNotamAbbr(s) {
  let out = String(s == null ? '' : s).replace(/\r/g, '');
  out = out.split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out.replace(/\b[A-Z]{2,5}\b/g, m => NOTAM_ABBR[m] || m);
}
function decodeNotam(n) {
  if (!n || typeof n !== 'object') return '';
  const t = String(n.type || '').toUpperCase();
  let head = '';
  if (t.length === 4) {
    const subj = NOTAM_SUBJ[t.slice(0, 2)];
    const cond = NOTAM_COND[t.slice(2)];
    if (subj || cond) head = [subj, cond].filter(Boolean).join(' — ');
  }
  const body = expandNotamAbbr(n.text || '');
  return (head ? head + '\n' : '') + body;
}
// --- end NOTAM decoder -----------------------------------------------

// Strip a trailing "MHz" unit from a frequency string → "121.70 MHz" → "121.70".
function freqClean(s) { return String(s == null ? '' : s).replace(/\s*MHz\s*$/i, '').trim(); }
// Per-leg comm-frequency sources along the route, sorted by waypoint index:
// each airfield's primary radio frequency (active from the leg departing it)
// plus each comm-change note (which overrides at its waypoint). Used by the
// flight-plan + printed-plan Freq column.
function routeFreqSources() {
  const out = [];
  const wps = state.waypoints || [];
  const legCount = (state.legs || []).length;
  // The DEPARTURE airfield (first waypoint) contributes its frequency on the
  // first leg; airfields merely passed overhead mid-route do not.
  if (wps.length) {
    const af = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wps[0]) : null;
    const f = af && typeof airfieldPrimaryText === 'function' ? freqClean(airfieldPrimaryText(af)) : '';
    if (f) out.push({ wpi: 0, freq: f });
  }
  // The DESTINATION airfield (last waypoint) contributes its frequency on the
  // last leg — so if no comm-change switched to it yet, the final leg still
  // shows the arrival airport's freq. A comm-change at the same leg overrides
  // (notes are pushed after, so they sort last in the carry-forward).
  if (legCount > 0 && wps.length > 1) {
    const af = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wps[wps.length - 1]) : null;
    const f = af && typeof airfieldPrimaryText === 'function' ? freqClean(airfieldPrimaryText(af)) : '';
    if (f) out.push({ wpi: legCount - 1, freq: f });
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

// --- editable VOR frequencies -----------------------------------------
function vorFreqOverrides() {
  try { return JSON.parse(localStorage.getItem('navaid.vorFreqOverrides') || '{}') || {}; }
  catch (e) { return {}; }
}
function setVorFreqOverride(ident, val) {
  const o = vorFreqOverrides();
  if (val) o[ident] = val; else delete o[ident];
  try { localStorage.setItem('navaid.vorFreqOverrides', JSON.stringify(o)); } catch (e) { /* ignore */ }
}
// Effective (override-aware) frequency for a VOR object.
function vorEffectiveFreq(v) {
  if (!v) return '';
  const def = freqClean(v.freq);
  return (v.ident && vorFreqOverrides()[v.ident]) || def;
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
// Default GA climb/descent performance (C172-ish) lives in the tune registry.
// Field elevation at route endpoint waypoint i (airfield elev_ft) or null.
function routeEndpointElev(i) {
  const wp = state.waypoints[i];
  if (!wp) return null;
  const af = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wp) : null;
  return af && Number.isFinite(af.elev_ft) ? af.elev_ft : null;
}
// Model each leg at its own planned altitude. A leg ramps gradually from its
// start altitude to its own altitude at the configured climb/descent
// performance. The ramp is confined to the leg. TOC/TOD markers are emitted only
// when the departure / destination is an actual airfield (has a field
// elevation); intermediate per-leg altitude changes are drawn but not marked.
// Returns per-leg
// time/fuel, altitude-vs-distance vertices (pts), and wpCum (cumulative NM at
// each waypoint, for the distance axis).
function routeProfile(ac) {
  ac = ac || (typeof aircraft === 'object' && aircraft) || {};
  // A single vertical-speed (V/S) override drives both the climb and descent
  // ramp slope when set (the profile's V/S input); otherwise per-aircraft perf.
  const vs = typeof window !== 'undefined' && window.profileVS > 0 ? window.profileVS : 0;
  const climbFpm = vs > 0 ? vs : (ac.climbFpm > 0 ? ac.climbFpm : tune('profileClimbFpm'));
  const descFpm = vs > 0 ? vs : (ac.descentFpm > 0 ? ac.descentFpm : tune('profileDescentFpm'));
  const climbKt = ac.climbKt > 0 ? ac.climbKt : tune('profileClimbKt');
  const descKt = ac.descentKt > 0 ? ac.descentKt : tune('profileDescentKt');
  const gph = ac.gph > 0 ? ac.gph : tune('defaultGph');
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
      const availableDist = Math.max(0, dist - climbDist - descDist);
      endDescDist = Math.min(availableDist, descKt * ((cr - fieldEnd) / descFpm) / 60);
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
// NOAA AWC's METAR/TAF API blocks direct browser fetches and public proxies
// proved unreliable, so a scheduled GitHub Action fetches it server-side and
// publishes wx.json (all Israeli fields) to the `wx-data` branch, served by
// raw.githubusercontent.com — same pattern as the SIGMET feed. The whole file
// is memoised 5 min; same-origin data/wx.json is the offline / first-run
// fallback. Decoding works off AWC's structured JSON fields.
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
// Live chart layers use Flight Maps directly. Export/download rendering uses
// the NavigationApp tile mirror via each chart layer's exportUrl.
// chartBounds = the lat/lng box covered by the published chart tiles
// (Israel + adjacent VFR airspace). exportPNG uses it to skip
// out-of-coverage tile fetches, which would otherwise return 404 and trip
// the "X of Y map tiles failed to load" warning when the viewport extends
// past the chart (the typical case at low zoom).
const FM_BOUNDS = { south: 28.3, west: 33.7, north: 34.3, east: 36.6 };
const TILE = { minZoom: 6, maxZoom: 16, maxNativeZoom: 13,
               chartBounds: FM_BOUNDS };
const FM_ATTR =
  'Charts © <a href="https://flight-maps.com">flight-maps.com</a> · CAAI';
const NAVAID_TILE_BASE = 'https://navaid-tiles.supino.org';

function tileLayerUrl(layer, coords) {
  const subs = layer.options && layer.options.subdomains ?
    layer.options.subdomains : 'abc';
  const sub = typeof layer._getSubdomain === 'function' ?
    layer._getSubdomain(coords) : subs[(coords.x + coords.y) % subs.length];
  return L.Util.template(layer._url, {
    x: coords.x,
    y: coords.y,
    z: coords.z,
    s: sub,
    r: L.Browser.retina ? '@2x' : '',
  });
}

function exportTileLayerUrl(layer, coords) {
  const src = layer.options && layer.options.exportUrl ?
    Object.assign({}, layer, { _url: layer.options.exportUrl }) : layer;
  return tileLayerUrl(src, coords);
}

// Local MBTiles dev server (localhost only): opt in with ?localTiles=1 to serve
// chart tiles from scripts/local-mbtiles-server.py instead of the remote CDN.
// Off by default and inert in production; each layer keeps its exportUrl so
// offline map-pack export still pulls from the remote mirror regardless.
const LOCAL_TILE_KEY = 'navaid.localTiles';
function localChartTilesEnabled() {
  const host = location.hostname;
  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!localHost) return false;
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('localTiles')) {
      const v = String(params.get('localTiles') || '').toLowerCase();
      const on = v === '1' || v === 'true' || v === 'yes' || v === 'on';
      if (on) localStorage.setItem(LOCAL_TILE_KEY, '1');
      else localStorage.removeItem(LOCAL_TILE_KEY);
      return on;
    }
    return localStorage.getItem(LOCAL_TILE_KEY) === '1';
  } catch (e) {
    return false;
  }
}
const LOCAL_CHART_TILES = localChartTilesEnabled();
NavAid.localChartTiles = LOCAL_CHART_TILES;
const LOCAL_FM_ATTR =
  'Local MBTiles © <a href="https://flight-maps.com">flight-maps.com</a> · CAAI';
function chartTileUrl(kind, remoteUrl) {
  return LOCAL_CHART_TILES ? 'tiles/' + kind + '/{z}/{x}/{y}.png' : remoteUrl;
}
function chartTileOptions(options) {
  return LOCAL_CHART_TILES
    ? { ...options, attribution: LOCAL_FM_ATTR, corsOk: true, localTiles: true }
    : options;
}

const layers = {
  'CVFR': L.tileLayer(chartTileUrl('cvfr', 'https://flight-maps.com/tiles/cvfr/{z}/{x}/{y}.png'),
    chartTileOptions({ ...TILE, attribution: FM_ATTR,
      exportUrl: NAVAID_TILE_BASE + '/CVFR/{z}/{x}/{y}.png' })),
  'Navigation': L.tileLayer(chartTileUrl('nav', 'https://flight-maps.com/tiles/nav/{z}/{x}/{y}.png'),
    chartTileOptions({ ...TILE, attribution: FM_ATTR,
      exportUrl: NAVAID_TILE_BASE + '/Israel-Navigation/{z}/{x}/{y}.png' })),
  'Low Alt': L.tileLayer(chartTileUrl('la', 'https://flight-maps.com/tiles/la/{z}/{x}/{y}.png'),
    chartTileOptions({ ...TILE, attribution: FM_ATTR,
      exportUrl: NAVAID_TILE_BASE + '/LSA-Low-Altitude/{z}/{x}/{y}.png' })),
  'Helicopters': L.tileLayer(chartTileUrl('il-hel', 'https://flight-maps.com/tiles/il-hel/{z}/{x}/{y}.png'),
    chartTileOptions({ ...TILE, maxNativeZoom: 12, attribution: FM_ATTR,
      exportUrl: NAVAID_TILE_BASE + '/Israel-Helicopters/{z}/{x}/{y}.png' })),
  'Satellite': L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/' +
    'World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { minZoom: 6, maxZoom: 18, attribution: 'Imagery © Esri' }),
  'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { minZoom: 6, maxZoom: 18, subdomains: 'abc',
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

// --- OpenStreetMap underlay -----------------------------------------
// The Israel chart tiles (CVFR / Nav / Low Alt / Heli) cover only the FIR, so
// the area around it is blank. Render OSM in a pane BELOW the chart tiles to
// fill the surroundings; the chart shows on top wherever it has coverage. Not
// needed for the already-global layers (Satellite / OpenStreetMap).
// leaflet-rotate splits mapPane into rotatePane+norotatePane; custom panes default
// to mapPane and are skipped by rotation. Force into rotatePane when available.
map.createPane('basemapUnderlay', map._rotatePane || undefined);
map.getPane('basemapUnderlay').style.zIndex = 150;        // below tilePane (200)
// Wind-field (leaflet-velocity) pane: deliberately NOT in the rotate pane.
// leaflet-velocity draws in bearing-aware container (screen) coordinates, so
// its canvas must stay screen-aligned; putting it in the rotate pane would
// transform it a second time and break the field on a rotated map. A plain
// mapPane child is never rotated. zIndex sits above the chart tiles (rotatePane
// is 400) but below the app's own #overlay route canvas.
map.createPane('windfield');
map.getPane('windfield').style.zIndex = 410;
const osmUnderlay = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { pane: 'basemapUnderlay', minZoom: 6, maxZoom: 18, subdomains: 'abc',
    opacity: 0.7, attribution: '© OpenStreetMap contributors' });
const FULL_COVERAGE_LAYERS = { Satellite: 1, OpenStreetMap: 1 };
function updateBasemapUnderlay() {
  let cur = null;
  for (const n in layers) if (map.hasLayer(layers[n])) cur = n;
  if (cur && !FULL_COVERAGE_LAYERS[cur]) {
    if (!map.hasLayer(osmUnderlay)) osmUnderlay.addTo(map);
  } else if (map.hasLayer(osmUnderlay)) {
    map.removeLayer(osmUnderlay);
  }
}
window.updateBasemapUnderlay = updateBasemapUnderlay;
updateBasemapUnderlay();

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
  const before = state.legs.length;
  const need = Math.max(0, state.waypoints.length - 1);
  while (state.legs.length < need) {
    const i = state.legs.length;
    state.legs.push(newLeg());
    applyLegAltitudeToLeg(i);
  }
  while (state.legs.length > need) state.legs.pop();
  applyLegAltitudesToRoute();
  // A newly added leg should pick up live wind when the wind display is on
  // (the handler is debounced and no-ops when the wind display is off).
  if (state.legs.length > before && typeof onRouteLegsGrown === 'function') onRouteLegsGrown();
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
  const maxDistance = directDistanceNm * tune('legAltInferMaxDistRatio') +
    tune('legAltInferMaxExtraNm');
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
    if (!cur || cur.hops >= tune('legAltInferMaxHops')) continue;
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
  // Pin gate at the deepest fill point: a route pinned to another layer's
  // prefix never takes values from the loaded table — not even for legs
  // freshly pushed by syncLegs' grow loop, which calls this directly and
  // used to bypass the route-level gate (mixing two layers' altitudes in
  // one route). Unfilled legs heal when the pinned layer's table returns.
  if (routeAltPrefix !== null && legAltitudeMapPrefix &&
      legAltitudeMapPrefix !== routeAltPrefix) return false;
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
// Identity of a leg's two endpoints (rounded coords). Used to detect when a
// waypoint was moved/snapped to a different point so a hand-edited altitude
// doesn't carry the old leg's in/out onto the new one.
function legEndpointSig(i) {
  const a = state.waypoints[i], b = state.waypoints[i + 1];
  if (!a || !b) return '';
  return r5(a.lat) + ',' + r5(a.lng) + '|' + r5(b.lat) + ',' + r5(b.lng);
}
function applyLegAltitudesToRoute() {
  // Pin: an emptied route unpins; a route pins to the prefix of the first
  // table applied to it; a table from any OTHER layer prefix never applies.
  // The per-leg gate lives in applyLegAltitudeToLeg (covers direct callers
  // like syncLegs' grow loop); this early-return is the route-level fast
  // path plus pin adoption/unpin bookkeeping — see routeAltPrefix.
  if (!state.legs.length) { routeAltPrefix = null; return false; }
  if (legAltitudeMap === null) return false;
  if (routeAltPrefix === null) {
    if (legAltitudeMapPrefix) routeAltPrefix = legAltitudeMapPrefix;
  } else if (legAltitudeMapPrefix && legAltitudeMapPrefix !== routeAltPrefix) {
    return false;                       // wrong layer's table — leave the route alone
  }
  let changed = false;
  for (let i = 0; i < state.legs.length; i++) {
    const leg = state.legs[i];
    const sig = legEndpointSig(i);
    if (leg && !leg._legAltitudeAuto) {
      // Manual altitude: keep it — unless the leg's endpoints changed (a
      // waypoint moved/snapped elsewhere), in which case re-derive from the
      // dataset rather than keeping the previous leg's in/out.
      if (leg._altSig === undefined) {
        leg._altSig = sig;                 // adopt current; don't clobber on load
      } else if (leg._altSig !== sig) {
        leg._legAltitudeAuto = 1;          // endpoints changed → back to auto
        if (applyLegAltitudeToLeg(i)) changed = true;
        leg._altSig = sig;
      }
      continue;
    }
    if (applyLegAltitudeToLeg(i)) changed = true;
    if (leg) leg._altSig = sig;
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
  leg._altSig = legEndpointSig(i);         // remember which endpoints this value is for
}
function legAllowsReturn(i) {
  const leg = state.legs[i];
  return !(leg && (leg._legAltitudeOutboundBlocked || leg._legAltitudeOneWay));
}
// The charted altitude for a leg as loaded from cvfr-leg-altitude.json — read from
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
