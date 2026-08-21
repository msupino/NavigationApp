'use strict';

/* ------------------------------------------------------------------ *
 * NavAid — HTML5 CVFR flight-route planner.
 * Leaflet base map (Flight Maps tiles) + a canvas route overlay.
 * ------------------------------------------------------------------ */

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
  // A GNSS fix is a geometric height; a planned altitude is a pressure height. Correcting
  // the first into the second is what stops an aircraft flying exactly on plan from being
  // told its altitude is off. Off = compare the raw fix, as before.
  altimetryCorrection: { value: true, type: 'bool', label: 'Correct GPS altitude to indicated' },
  // Height of the geoid (mean sea level) above the WGS84 ellipsoid, which is the datum
  // Android reports altitude against. ~18 m across the Israel FIR; one number is enough
  // for an area this size, and it is here rather than hardcoded for the day it is not.
  geoidUndulationFt: { value: 59, min: 0, max: 200, step: 1, label: 'Geoid height above ellipsoid (ft)' },
  // How long a pan or zoom by hand keeps the map, before following the own-ship resumes.
  followResumeMs: { value: 5000, min: 0, max: 60000, step: 500, label: 'Resume following after (ms)' },
  // The live speed / altitude / heading line. It sat at 11 px -- footer-decoration size --
  // while being the one thing read at arm's length in a bumpy cockpit, in sunlight, on a
  // kneeboard. Bigger by default, and tunable from there.
  gpsReadoutFontPx: { value: 16, min: 9, max: 32, step: 1, label: 'GPS readout text (px)' },
  // The touch crosshair that marks what the coordinate readout is reading.
  // Use the phone's compass for the own-ship heading where the GPS gives no course
  // (stationary, taxiing). Never above taxi speed: in flight the GPS course is the truth,
  // and a phone in a metal cockpit is not. See gpsCompassTrue.
  // How long an in-flight notification stays in the shade before the app withdraws it.
  // Android keeps notifications until they are swiped, so without this a sortie ends with
  // a stack of stale calls. Short on purpose: the alert has already made its noise and, in
  // the APK, spoken it -- the shade entry is a glance-at-it-now copy, not a log. 0 = keep
  // them, the old behaviour.
  // --- in-flight alerting -------------------------------------------------------------
  // These decide how talkative the app is in the air, and only a flight can settle them:
  // an aircraft's speed sets how much warning is useful, and GNSS-vs-pressure error sets
  // how tight an altitude tolerance can be before it cries wolf.
  altToleranceFt: { value: 100, min: 20, max: 1000, step: 10, label: 'Altitude alert tolerance (ft)' },
  altMaxAlertsPerLeg: { value: 2, min: 0, max: 10, step: 1, label: 'Altitude alerts per leg (0 = off)' },
  // How long before the destination the ATIS reminder fires. Time, not distance: the point is
  // to have enough of it to tune, listen through a full cycle and copy the numbers before the
  // arrival gets busy, and that is a duration regardless of groundspeed.
  atisLeadSec: { value: 600, min: 60, max: 1800, step: 30, label: 'ATIS reminder lead (s)' },
  atisMarkerColor: { value: '#1f6fd0', type: 'color', label: 'ATIS reminder marker colour' },
  atisMarkerRadiusPx: { value: 10, min: 3, max: 30, step: 1, label: 'ATIS reminder marker radius (px)' },
  atisMarkerFontPx: { value: 13, min: 8, max: 28, step: 1, label: 'ATIS reminder marker label (px)' },
  // The magnetic heading printed past the end of the own-ship predictor line. The same number
  // is already in the footer readout, right next to the speed and altitude it belongs with,
  // and out on the line it sat over the chart at the busiest moment. Off by default; the
  // distance and time ticks on the line are unaffected.
  liveHeadingEndLabel: { value: false, type: 'bool', label: 'Heading number at the end of the predictor line' },
  legEtaLeadSec: { value: 120, min: 15, max: 600, step: 15, label: 'Next-leg call, seconds ahead' },
  legCaptureNm: { value: 0.3, min: 0.05, max: 3, step: 0.05, label: 'TOP capture radius (NM)' },
  driftTrackErrorDeg: { value: 10, min: 2, max: 45, step: 1, label: 'Off-course alert at (deg)' },
  driftCheckSec: { value: 120, min: 15, max: 900, step: 15, label: 'Off-course check every (s)' },
  coneUnknownSec: { value: 15, min: 3, max: 120, step: 1, label: 'Off-route call after (s outside)' },
  // --- fix quality --------------------------------------------------------------------
  // How fussy the app is about the fixes it accepts. A metal cabin or a canopy can make
  // the difference between a usable track and none at all.
  gpsMaxAccuracyM: { value: 100, min: 10, max: 500, step: 5, label: 'Reject fixes worse than (m)' },
  gpsMinMoveM: { value: 10, min: 0, max: 100, step: 1, label: 'Ignore movement under (m)' },
  gpsStaleSec: { value: 20, min: 5, max: 300, step: 5, label: 'Fix goes stale after (s)' },
  // How often the pressure/temperature behind the altimetry correction is refetched. The model
  // itself publishes every 15 minutes, so asking more often buys nothing but requests; the
  // distance is the other trigger, because pressure changes with where you are as well as when.
  qnhMaxAgeMin: { value: 15, min: 1, max: 180, step: 1, label: 'QNH refetch after (min)' },
  qnhMoveNm: { value: 5, min: 1, max: 200, step: 1, label: 'QNH refetch after moving (NM)' },
  compassMaxKt: { value: 3, min: 0, max: 40, step: 1, label: 'Compass stands in below (kt)' },
  alertNotifyTtlSec: { value: 15, min: 0, max: 3600, step: 5, label: 'Alert notification life (s)' },
  compassFallback: { value: true, type: 'bool', label: 'Compass heading when stopped' },
  // How far the heading must move before a heading-up map is rotated. Every rotation
  // redraws the whole chart, and a degree of GPS scatter is not worth that -- nor the
  // shimmer it produces on a phone in the cockpit.
  headingUpMinDeltaDeg: { value: 3, min: 1, max: 30, step: 1, label: 'Heading-up rotation step (deg)' },
  crosshairSizePx: { value: 34, min: 10, max: 120, step: 2, label: 'Centre crosshair size (px)' },
  crosshairWidthPx: { value: 1, min: 1, max: 6, step: 1, label: 'Centre crosshair line (px)' },
  crosshairColor: { value: '#231F20', type: 'color', label: 'Centre crosshair colour' },
  crosshairHaloColor: { value: '#ffffff', type: 'color', label: 'Centre crosshair halo' },
  crosshairAlpha: { value: 0.85, min: 0.1, max: 1, step: 0.05, label: 'Centre crosshair opacity' },

  profileClimbFpm: { value: 500, min: 100, max: 3000, step: 50, label: 'Default climb rate (fpm)' },
  profileClimbKt: { value: 75, min: 30, max: 200, step: 1, label: 'Default climb speed (kt)' },
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
  vorRangeRingColor: { value: '#1d6fe0', type: 'color', label: 'VOR range ring color' },
  vorRangeRingAlpha: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'VOR range ring alpha' },
  vorRangeRingWidthPx: { value: 1.5, min: 0.5, max: 6, step: 0.5, label: 'VOR range ring width' },
  vorRangeRingDashPx: { value: 7, min: 0, max: 30, step: 1, label: 'VOR range ring dash' },
  vorRangeRingGapPx: { value: 6, min: 0, max: 30, step: 1, label: 'VOR range ring dash gap' },
  vorRangeRingLabel: { value: 1, min: 0, max: 1, step: 1, label: 'VOR range ring label (0/1)' },
  vorRangeRingSteps: { value: 96, min: 12, max: 256, step: 4, label: 'VOR range ring smoothness (segments)' },
  vorRangeRingLabelGapPx: { value: 3, min: 0, max: 20, step: 1, label: 'VOR range ring label gap' },
  searchMaxResults: { value: 12, min: 3, max: 40, step: 1, label: 'Search: total results' },
  // Which base layers the picker offers, gist-controlled booleans: true = offered,
  // false = hidden from the picker, the satellite modal and the mosaic. CVFR is not on
  // the list -- it is the fallback layer everything else degrades to, so the app never
  // lets it be configured away. Helicopters ships OFF: its chart and dataset are the thinnest
  // of the set, and it was carried as a gist override long enough to be the settled answer
  // rather than a deployment's opinion. Either value can still be flipped from the gist:
  //   "layerEnabledHelicopters": true
  layerEnabledLowAlt: { value: true, type: 'bool', label: 'Offer the Low Alt layer' },
  layerEnabledHelicopters: { value: false, type: 'bool', label: 'Offer the Helicopters layer' },
  layerEnabledNavigation: { value: true, type: 'bool', label: 'Offer the Navigation layer' },
  layerEnabledSatellite: { value: true, type: 'bool', label: 'Offer the Satellite layer' },
  layerEnabledOpenStreetMap: { value: true, type: 'bool', label: 'Offer the OpenStreetMap layer' },
  searchMaxVor: { value: 3, min: 0, max: 20, step: 1, label: 'Search: max VOR stations' },
  searchMaxBubbles: { value: 12, min: 0, max: 20, step: 1, label: 'Search: max LSA bubbles' },
  searchMaxNotams: { value: 4, min: 0, max: 20, step: 1, label: 'Search: max NOTAM results' },
  searchFlashMs: { value: 3500, min: 0, max: 15000, step: 250,
    label: 'Search: how long the result flashes (ms, 0 = off)' },
  searchFlashRadiusPx: { value: 30, min: 8, max: 80, step: 2,
    label: 'Search: flash ring size (px)' },
  searchFlashColor: { value: '#ffb020', type: 'color', label: 'Search: flash ring colour' },
  searchFlashWidthPx: { value: 2, min: 1, max: 8, step: 1,
    label: 'Search: flash ring thickness (px)' },
  searchFlashFillAlpha: { value: 0.10, min: 0, max: 0.6, step: 0.02,
    label: 'Search: flash fill opacity (0 = ring only)' },
  searchFlashPulses: { value: 2, min: 0, max: 5, step: 1,
    label: 'Search: flash pulses (0 = steady ring)' },
  searchMaxAirfields: { value: 6, min: 0, max: 20, step: 1, label: 'Search: max airfields' },
  searchMaxNavWp: { value: 12, min: 0, max: 40, step: 1, label: 'Search: max nav waypoints' },
  searchMaxRouteWp: { value: 4, min: 0, max: 20, step: 1, label: 'Search: max route waypoints' },
  searchMaxNotes: { value: 3, min: 0, max: 20, step: 1, label: 'Search: max notes' },
  searchNoteLabelChars: { value: 40, min: 10, max: 120, step: 5, label: 'Search: note label length' },
  a4x2MarkLabelBgColor: { value: 'rgba(255,255,255,0.85)', type: 'text', label: 'A4x2 page-label background' },
  a4x2MarkLabelInkColor: { value: '#000000', type: 'color', label: 'A4x2 page-label ink' },
  simStatusOkColor: { value: '#2ecc71', type: 'color', label: 'Simulator status OK color' },
  simStatusErrColor: { value: '#e67e22', type: 'color', label: 'Simulator status error color' },
  overlayLabelHaloWidthPx: { value: 2.5, min: 0, max: 10, step: 0.5, label: 'Overlay label halo width' },
  liveHeadingTickHaloColor: { value: '#000000', type: 'color', label: 'Heading tick label halo color' },
  liveHeadingTickHaloAlpha: { value: 0.8, min: 0, max: 1, step: 0.05, label: 'Heading tick label halo alpha' },
  liveHeadingTickHaloWidthPx: { value: 3, min: 0, max: 10, step: 0.5, label: 'Heading tick label halo width' },
  notamFlashColor: { value: '#ffd400', type: 'color', label: 'NOTAM locate flash color' },
  notamBadgeTextColor: { value: '#ffffff', type: 'color', label: 'NOTAM badge text color' },
  notamBadgeFontPx: { value: 11, min: 6, max: 24, step: 1, label: 'NOTAM badge font size' },
  lsaHighlightColor: { value: '#ffcc33', type: 'color', label: 'LSA locate highlight color' },
  lsaWeekendColor: { value: '#2b2b2b', type: 'color', label: 'LSA weekend outline color' },
  lsaAlwaysColor: { value: '#3c8f3c', type: 'color', label: 'LSA always-active outline color' },
  lsaLabelColor: { value: '#222222', type: 'color', label: 'LSA label ink color' },
  gpsTrackOutlineColor: { value: '#ffffff', type: 'color', label: 'GPS track outline color' },
  gpsTrackStartColor: { value: '#00aa00', type: 'color', label: 'GPS track start dot color' },
  gpsTrackEndColor: { value: '#dd0000', type: 'color', label: 'GPS track end dot color' },
  gpsTrackColors: { value: '#e6194b,#3cb44b,#4363d8,#f58231,#911eb4,#008080,#9a6324,#000075',
    type: 'text', label: 'GPS track palette (comma-separated)' },
  satelliteChartOverscale: { value: 1, min: 0, max: 3, step: 1, label: 'Satellite chart overscale levels' },

  magBaselineZoom: { value: 12, min: 8, max: 18, step: 1, label: 'Magnifier baseline zoom' },
  magMaxExp: { value: 4, min: 1, max: 6, step: 1, label: 'Magnifier max sub-tile exponent' },

  undoLimit: { value: 50, min: 5, max: 500, step: 5, label: 'Undo history depth' },
  rotDragPx: { value: 8, min: 1, max: 40, step: 1, label: 'Rotate drag threshold (px)' },
  // How far a finger must travel before a touch counts as dragging something rather than
  // tapping it. A fingertip is ~10 mm across and never lands still: without a threshold a
  // plain tap nudged the waypoint it was meant to open.
  touchDragPx: { value: 10, min: 1, max: 40, step: 1, label: 'Touch drag threshold (px)' },
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

  defaultLabelMarginPx: { value: 20, min: 0, max: 120, step: 1, label: 'Default marker margin (scaled with the kite)' },
  defaultKiteHalfWidthPx: { value: 23, min: 1, max: 80, step: 1, label: 'Default kite half-width' },

  legKiteFillColor: { value: '#00ff00', type: 'color', label: 'Leg kite fill color' },
  returnKiteFillColor: { value: '#ffccd6', type: 'color', label: 'Return kite fill color' },
  legKiteHeightPx: { value: 47, min: 8, max: 120, step: 1, label: 'Leg kite height' },
  legKiteCellWidthPx: { value: 24, min: 8, max: 80, step: 1, label: 'Leg kite cell width' },
  legKiteTriangleLenPx: { value: 35, min: 8, max: 100, step: 1, label: 'Leg kite triangle length' },
  // Printed HEIGHT of the leg kite at size-selector 1 on a framed A4/A3 export
  // (1:250,000). The whole marker is scaled uniformly to this height, keeping
  // the on-screen proportions (WYSIWYG). Screen size is unchanged; gist-tunable.
  kitePrintHeightMm: { value: 18.5, min: 2, max: 120, step: 0.5, label: 'Leg kite print height (mm)' },
  legKiteBorderPx: { value: 2, min: 0.25, max: 8, step: 0.25, label: 'Leg kite border width' },
  legKiteDividerPx: { value: 1, min: 0.25, max: 6, step: 0.25, label: 'Leg kite divider width' },
  legKiteHaloPx: { value: 7, min: 0, max: 20, step: 0.5, label: 'Leg kite halo width' },
  legKiteTextPx: { value: 13, min: 4, max: 36, step: 1, label: 'Leg kite text size' },
  legKiteHeadingTextPx: { value: 13, min: 4, max: 40, step: 1, label: 'Leg kite heading text size' },
  legKiteHeadingAnchor: { value: 0.25, min: -0.5, max: 1, step: 0.01, label: 'Leg kite heading anchor' },

  // Where the cumulative-time kite sits around its waypoint, as an angle FROM the nav
  // kite's side, turned towards the direction of flight. 0 = the nav kite's own side
  // (which is where it used to be, stacking the two against each other), 180 = straight
  // opposite it, 90 = ahead along the leg. An angle rather than a left/right switch
  // because the useful positions on a busy chart are not only the two sides -- and the
  // distance is unchanged at any angle, so the kite always clears the waypoint disc.
  // Where the frequency callout sits around its waypoint, as a SIGNED angle from the leg's
  // direction of travel: positive is left of track, negative is right. It used to be a
  // hardcoded 90 (square left), which is the quarter the cumulative-time kite now occupies
  // -- the callout covered it. -150 puts it right and behind, clear of both that kite and
  // the nav kite ahead-right.
  // Range runs past a half turn on purpose: -230 and +130 are the same place, and a pilot
  // dialling this in should not have to do the arithmetic to stay inside a bound.
  commCalloutAngleDeg: { value: -230, min: -359, max: 359, step: 5, label: 'Freq callout angle from track (deg, +left)' },
  cumKiteAngleDeg: { value: 180, min: 0, max: 359, step: 5, label: 'Cum kite angle from nav kite (deg)' },
  cumKiteFillColor: { value: '#00ff00', type: 'color', label: 'Cum kite fill color' },
  returnCumKiteFillColor: { value: '#ffccd6', type: 'color', label: 'Return cum kite fill color' },
  cumKiteHeightPx: { value: 23, min: 8, max: 100, step: 1, label: 'Cum kite height' },
  cumKiteCellWidthPx: { value: 43, min: 10, max: 120, step: 1, label: 'Cum kite cell width' },
  cumKiteTriangleLenPx: { value: 20, min: 6, max: 100, step: 1, label: 'Cum kite triangle length' },
  // Printed HEIGHT of the cumulative-time kite at size-selector 1 on a framed
  // A4/A3 export (1:250,000). The whole marker is scaled uniformly to this
  // height, preserving the on-screen proportions (WYSIWYG). Screen size
  // unchanged; gist-tunable.
  cumKitePrintHeightMm: { value: 9.5, min: 1, max: 80, step: 0.5, label: 'Cum kite print height (mm)' },
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
  // Physical diameter of the waypoint disc on a framed A4/A3 PNG export (both
  // print at 1:250,000, so one value fits both). Screen size is unchanged —
  // this only overrides the disc size while exporting a page frame.
  waypointPrintDiaMm: { value: 7, min: 1, max: 40, step: 0.5, label: 'Waypoint circle print diameter (mm)' },
  waypointFontPx: { value: 13, min: 4, max: 40, step: 1, label: 'Waypoint text size' },
  waypointTextFitFactor: { value: 0.85, min: 0.3, max: 1, step: 0.05, label: 'Waypoint text fit (fraction of diameter)' },
  waypointMinZoomScale: { value: 0.35, min: 0.1, max: 2, step: 0.05, label: 'Waypoint min zoom scale' },
  waypointSelectedRadiusAddPx: { value: 2, min: 0, max: 20, step: 0.5, label: 'Selected waypoint radius add' },
  waypointStrokeWidthPx: { value: 1, min: 0.25, max: 10, step: 0.25, label: 'Waypoint stroke width' },
  waypointFillColor: { value: '#fff6aa', type: 'color', label: 'Waypoint fill color' },
  waypointHotspotFillColor: { value: '#ffd166', type: 'color', label: 'Hotspot waypoint fill' },
  waypointHotspotRingColor: { value: '#d7263d', type: 'color', label: 'Hotspot waypoint ring' },
  waypointHotspotRingWidthPx: { value: 3, min: 1, max: 10, step: 0.5, label: 'Hotspot ring width' },
  waypointHotspotRingGapPx: { value: 3, min: 0, max: 12, step: 0.5, label: 'Hotspot ring gap' },

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
  // Physical size of a default (size-1) note rectangle on a framed A4/A3 PNG
  // export (both print at 1:250,000). Screen size is unchanged; gist-tunable.
  notePrintWidthMm: { value: 21, min: 2, max: 120, step: 0.5, label: 'Note default print width (mm)' },
  notePrintHeightMm: { value: 14, min: 2, max: 120, step: 0.5, label: 'Note default print height (mm)' },
  noteStrokeWidthPx: { value: 1.5, min: 0.25, max: 8, step: 0.25, label: 'Note stroke width' },
  noteSelectedStrokeWidthPx: { value: 2.5, min: 0.25, max: 10, step: 0.25, label: 'Selected note stroke width' },
  noteDefaultFillColor: { value: '#fff6aa', type: 'color', label: 'Default note fill color' },

  pageFrameLineWidthPx: { value: 2, min: 0.25, max: 10, step: 0.25, label: 'Page frame line width' },
  pageFrameDashOnPx: { value: 8, min: 1, max: 60, step: 1, label: 'Page frame dash on' },
  pageFrameDashOffPx: { value: 5, min: 0, max: 60, step: 1, label: 'Page frame dash gap' },
  pageFrameScrimColor: { value: '#141212', type: 'color', label: 'Page frame scrim color' },
  pageFrameScrimAlpha: { value: 0.4, min: 0, max: 1, step: 0.05, label: 'Page frame scrim alpha' },
  pageFrameLocked: { value: true, type: 'bool', label: 'Lock page frame to viewport centre' },
  pageFrameHitPx: { value: 14, min: 1, max: 80, step: 1, label: 'Page frame drag band' },
  a4x2CutLineWidthPx: { value: 3, min: 0.25, max: 10, step: 0.25, label: 'A4×2 cut line width' },
  a4x2CutDashOnPx: { value: 14, min: 1, max: 60, step: 1, label: 'A4×2 cut dash on' },
  a4x2CutDashOffPx: { value: 9, min: 0, max: 60, step: 1, label: 'A4×2 cut dash gap' },
  a4x2CutLineColor: { value: '#ff3b30', type: 'color', label: 'A4×2 cut line color' },
  a4x2CutLineAlpha: { value: 0.9, min: 0, max: 1, step: 0.05, label: 'A4×2 cut line alpha' },
  a4x2MarkLabelMm: { value: 3.5, min: 1, max: 10, step: 0.5, label: 'A4×2 printed page-label height (mm)' },
  a4x2MarkGuideMm: { value: 0.5, min: 0.1, max: 3, step: 0.1, label: 'A4×2 printed cut-guide width (mm)' },

  hitWaypointExtraPx: { value: 6, min: 0, max: 40, step: 1, label: 'Waypoint hit extra' },
  hitLegPx: { value: 8, min: 1, max: 60, step: 1, label: 'Leg line hit width' },
  defaultLegSpeedKt: { value: 90, min: 20, max: 400, step: 5, label: 'Default leg speed (kt)' },
  // Flight-plan filing rules, from AIP Israel א׳-11. Tunable so an AIP amendment can be
  // followed from the gist instead of waiting for a release.
  fplMinLeadMin: { value: 60, min: 0, max: 240, step: 5,
    label: 'FPL: file at least this long before departure (min)' },
  fplSameDayAfterMin: { value: 1020, min: 0, max: 1439, step: 15,
    label: 'FPL: departures after this local time are same-day filing (min past midnight)' },
  fplEveOpenMin: { value: 1080, min: 0, max: 1439, step: 15,
    label: 'FPL: evening-before filing opens at (min past midnight)' },
  fplWindowBeforeMin: { value: 30, min: 0, max: 120, step: 5,
    label: 'FPL: plan valid from this long before the filed time (min)' },
  fplWindowAfterVfrMin: { value: 60, min: 0, max: 180, step: 5,
    label: 'FPL: plan valid until this long after, domestic VFR (min)' },
  fplEetRoundMin: { value: 5, min: 1, max: 30, step: 1,
    label: 'FPL: round the filed total time up to a multiple of (min)' },
  fplSignatureInk: { value: '#111111', type: 'color',
    label: 'FPL form: signature ink colour' },
  legLabelMaxScale: { value: 2, min: 1, max: 8, step: 0.5,
    label: 'Max leg-label zoom scale (x)' },
  unknownProfileAltFt: { value: 2000, min: 500, max: 15000, step: 100,
    label: 'Height the profile draws a leg with no altitude at (ft)' },
  kmlTourSecPerFlightMin: { value: 4, min: 0.5, max: 30, step: 0.5,
    label: 'Google Earth tour: seconds per minute of flight' },
  kmlTourLegMinSec: { value: 4, min: 0.5, max: 120, step: 0.5,
    label: 'Google Earth tour: shortest leg (s)' },
  kmlTourLegMaxSec: { value: 45, min: 2, max: 600, step: 1,
    label: 'Google Earth tour: longest leg (s)' },
  kmlTourMinSegSec: { value: 0.2, min: 0.05, max: 3, step: 0.05,
    label: 'Google Earth tour: shortest camera move (s)' },
  kmlUnsetLegAglFt: { value: 800, min: 100, max: 5000, step: 50,
    label: 'Google Earth tour: height for a leg with no altitude (ft AGL)' },
  defaultViewZoom: { value: 11, min: 8, max: 14, step: 0.5, label: 'First-run map zoom' },
  touchRotateGesture: { value: 0, min: 0, max: 1, step: 1, label: 'Two-finger rotate gesture (0/1)' },
  // --- Map fit ---------------------------------------------------------------
  // Every "frame the map on X" call used to carry its own hardcoded padding and maxZoom,
  // so the two a pilot actually notices -- the route auto-fit and ⌖ Fit to screen -- did
  // not even agree with each other (80px vs 70px). One tunable pair per THING being
  // framed, since a NOTAM area, a GPS track and a two-waypoint leg genuinely want
  // different framing; the point-zoom values are the fallback when there is a single
  // point and nothing to fit.
  fitRoutePaddingPx: { value: 70, min: 0, max: 200, step: 5, label: 'Fit route: padding (px)' },
  fitRouteMaxZoom: { value: 11, min: 6, max: 18, step: 0.5, label: 'Fit route: max zoom' },
  fitRouteEmptyZoom: { value: 9, min: 6, max: 14, step: 0.5, label: 'Fit route: zoom with no route' },
  fitNotamPaddingPx: { value: 80, min: 0, max: 200, step: 5, label: 'Fit NOTAM: padding (px)' },
  fitNotamMaxZoom: { value: 11, min: 6, max: 18, step: 0.5, label: 'Fit NOTAM: max zoom' },
  fitNotamPointZoom: { value: 10, min: 6, max: 18, step: 0.5, label: 'Fit NOTAM: single-point zoom floor' },
  fitTrackPaddingPx: { value: 60, min: 0, max: 200, step: 5, label: 'Fit GPS track: padding (px)' },
  fitTrackMaxZoom: { value: 13, min: 6, max: 18, step: 0.5, label: 'Fit GPS track: max zoom' },
  fitTrackPointZoom: { value: 12, min: 6, max: 18, step: 0.5, label: 'Fit GPS track: single-point zoom floor' },
  fitAltPairPaddingPx: { value: 80, min: 0, max: 200, step: 5, label: 'Fit altitude pair: padding (px)' },
  fitAltPairMaxZoom: { value: 12, min: 6, max: 18, step: 0.5, label: 'Fit altitude pair: max zoom' },
  fitAreaPaddingPx: { value: 40, min: 0, max: 200, step: 5, label: 'Fit LSA area: padding (px)' },
  fitAreaMaxZoom: { value: 12, min: 6, max: 18, step: 0.5, label: 'Fit LSA area: max zoom' },
  fitBoxPaddingPx: { value: 30, min: 0, max: 200, step: 5, label: 'Fit metre-box: padding (px)' },
  a3FitZoomOffset: { value: 0, min: -2, max: 2, step: 0.25, label: 'A3/A4x2 fit zoom offset' },
  a4FitZoomOffset: { value: 0, min: -2, max: 2, step: 0.25, label: 'A4 fit zoom offset' },
  defaultViewLat: { value: 32.1, min: 29, max: 34, step: 0.05, label: 'First-run map centre latitude' },
  defaultViewLng: { value: 34.95, min: 33, max: 36.5, step: 0.05, label: 'First-run map centre longitude' },
  hitLegLabelMinPx: { value: 18, min: 1, max: 80, step: 1, label: 'Leg label hit min' },
  hitCumLabelMinPx: { value: 18, min: 1, max: 80, step: 1, label: 'Cum label hit min' },

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

  // Graph-legs review overlay (?graphlegs=1). Presentation only -- the overlay is read
  // against chart imagery, so line weight and the class colours are worth tuning live.
  graphLegArmyColor:   { value: '#c0392b', type: 'color', label: 'Graph leg: army airway' },
  graphLegAtcColor:    { value: '#8e44ad', type: 'color', label: 'Graph leg: ATC approval' },
  graphLegClosedColor: { value: '#e67e22', type: 'color', label: 'Graph leg: hint-closed' },
  graphLegOneWayColor: { value: '#2980b9', type: 'color', label: 'Graph leg: one-way' },
  graphLegPlainColor:  { value: '#16a085', type: 'color', label: 'Graph leg: ordinary' },
  graphLegWidthPx:     { value: 10, min: 1, max: 20, step: 0.5, label: 'Graph leg line width' },
  graphLegArrowPx:     { value: 40, min: 6, max: 80, step: 1, label: 'Graph leg arrowhead size' },
  graphLegLabelMinZoom:{ value: 10, min: 6, max: 14, step: 1, label: 'Graph leg label min zoom' },
  altPairFocusColor: { value: '#ff3030', type: 'color', label: 'Alt-pair focus line color' },
  altPairFocusWidthPx: { value: 5, min: 0.5, max: 16, step: 0.5, label: 'Alt-pair focus line width' },
  altPairFocusDashOnPx: { value: 10, min: 0, max: 40, step: 1, label: 'Alt-pair focus dash on' },
  altPairFocusDashOffPx: { value: 8, min: 0, max: 40, step: 1, label: 'Alt-pair focus dash gap' },
  altPairFocusDotRadiusPx: { value: 7, min: 1, max: 30, step: 0.5, label: 'Alt-pair focus endpoint radius' },
  altPairFocusDotColor: { value: '#ff3030', type: 'color', label: 'Alt-pair focus endpoint fill' },
  altPairFocusMs: { value: 10000, min: 1000, max: 60000, step: 500, label: 'Alt-pair focus duration (ms)' },

  // Matches the on-screen #map background so map-opacity-faded tiles and
  // translucent overlays (kites / notes at kiteNoteAlpha) composite over the
  // same backdrop on paper as on screen — otherwise a dark export bg made them
  // read darker/more opaque than the map. Gist-tunable.
  exportBgColor: { value: '#e7ebf0', type: 'color', label: 'PNG export background color' },

  liveAircraftFillColor: { value: '#000000', type: 'color', label: 'Live aircraft fill color' },
  liveAircraftOutlineColor: { value: '#ffffff', type: 'color', label: 'Live aircraft outline color' },
  liveHeadingLineColor: { value: '#e53935', type: 'color', label: 'Live heading line color' },
  liveHeadingTextColor: { value: '#ffffff', type: 'color', label: 'Live heading label color' },
  // Distance and time marks sit on the same line and read alike at a glance ("5 nm" / "5 min"
  // are the same shape) -- two colours are what tells them apart without reading them.
  liveHeadingNmTextColor: { value: '#ffffff', type: 'color', label: 'Heading line NM mark color' },
  liveHeadingMinTextColor: { value: '#ffd166', type: 'color', label: 'Heading line minute mark color' },

  profileBgColor: { value: '#1d2733', type: 'color', label: 'Profile background color' },
  profileGridColor: { value: '#7896b4', type: 'color', label: 'Profile grid color' },
  profileAxisColor: { value: '#5a6b7d', type: 'color', label: 'Profile axis color' },
  profileGroundColor: { value: '#3a4654', type: 'color', label: 'Profile ground line color' },
  // Terrain under the profile line (#673's grid, drawn where the plan is read). Sample count
  // is the silhouette's resolution: the shipped grid is ~1.2 km per cell, so past a few
  // hundred samples the extra points redraw the same cell.
  profileTerrainColor: { value: '#6b5a44', type: 'color', label: 'Profile terrain fill' },
  // Terrain shading is about ONE question: does the ground threaten the altitude I am planning
  // to fly? Colouring every hill by height only repeats what the chart underneath already
  // says, in a second brown that hides it. So nothing is painted except the ground that is at
  // or near the planned altitude -- on a normal route that is nothing at all, and where it
  // does paint, it is the part worth looking at.
  terrainTintAlpha: { value: 0.45, min: 0, max: 1, step: 0.05, label: 'Terrain shading opacity' },
  // How much air below the planned altitude still counts as clear, in the terms the VFR rules
  // are written in: 500 ft above the surface outside congested areas, 1000 ft above the
  // highest obstacle within 2000 ft horizontally over congested ones. 500 is the shipped
  // value -- the rule that applies to most of a cross-country leg -- and a pilot flying over
  // built-up ground can set 1000 and see the stricter picture.
  //
  // Deliberately NOT msaBufferFt: that is terrain + 1000 ft for every leg regardless, and
  // using it as the red line flagged routes flown every day -- the LLHZ->LLHA coast run at
  // 1000 ft passes over ~200 ft of ground and came out marked end to end. A warning that
  // fires on the ordinary case is the one nobody reads on the day it matters.
  //
  // The grid's own resolution helps here: each cell carries the MAX elevation over roughly a
  // kilometre, so sampling along the leg approximates "the highest thing within about 2000 ft
  // of track" rather than the elevation of a single point under it.
  terrainWarnClearanceFt: { value: 500, min: 0, max: 3000, step: 50, label: 'Terrain clearance: 500 open / 1000 congested (ft)' },
  terrainAlertColor: { value: '#d7263d', type: 'color', label: 'Terrain at or above the planned altitude' },
  terrainCautionColor: { value: '#e8a33d', type: 'color', label: 'Terrain within the warning clearance below it' },
  // A leg planned below its own safe altitude, and the waypoints at either end of one. Drawn
  // under the route so the line itself stays crisp: this marks the plan, it does not replace it.
  terrainLegWarnWidthPx: { value: 9, min: 2, max: 30, step: 1, label: 'Below-MSA leg casing width (px)' },
  terrainLegWarnAlpha: { value: 0.55, min: 0, max: 1, step: 0.05, label: 'Below-MSA leg casing opacity' },
  terrainWpWarnRingPx: { value: 4, min: 1, max: 20, step: 1, label: 'Below-MSA waypoint ring width (px)' },
  // The tint draws at every zoom the map offers; cells are merged into blocks of at least
  // terrainTintMinCellPx so a zoomed-out view stays cheap and legible instead of vanishing.
  terrainTintMinZoom: { value: 0, min: 0, max: 14, step: 1, label: 'Terrain tint: minimum zoom (0 = always)' },
  terrainTintMinCellPx: { value: 7, min: 2, max: 40, step: 1, label: 'Terrain tint: smallest painted block (px)' },
  profileMsaColor: { value: '#d7263d', type: 'color', label: 'Profile safe-altitude line' },
  profileTerrainSamples: { value: 240, min: 40, max: 1000, step: 20, label: 'Profile terrain samples' },
  profileHeadroomFt: { value: 400, min: 0, max: 5000, step: 100, label: 'Profile headroom above terrain (ft)' },
  profileTextColor: { value: '#8aa0b4', type: 'color', label: 'Profile axis text color' },
  profileNmTextColor: { value: '#cdd8e3', type: 'color', label: 'Profile NM text color' },
  profileTimeTextColor: { value: '#7fa8d0', type: 'color', label: 'Profile time text color' },
  profileAreaColor: { value: '#5096e6', type: 'color', label: 'Profile area color' },
  profileLineColor: { value: '#5a96e6', type: 'color', label: 'Profile line color' },
  profileTocColor: { value: '#2e9e4f', type: 'color', label: 'TOC marker color' },
  profileMarkerHaloColor: { value: '#ffffff', type: 'color', label: 'TOC halo color' },

  sigmetTurbColor: { value: '#e67e22', type: 'color', label: 'SIGMET turbulence color' },
  sigmetIceColor: { value: '#1ba1e2', type: 'color', label: 'SIGMET icing color' },
  sigmetMtwColor: { value: '#8e44ad', type: 'color', label: 'SIGMET mountain wave color' },
  sigmetVaColor: { value: '#7f5539', type: 'color', label: 'SIGMET volcanic ash color' },
  sigmetDustColor: { value: '#b8860b', type: 'color', label: 'SIGMET dust/sand color' },
  sigmetTcColor: { value: '#c2185b', type: 'color', label: 'SIGMET cyclone color' },
  sigmetDefaultColor: { value: '#dd1111', type: 'color', label: 'SIGMET default/TS color' },
  sigmetFillAlpha: { value: 0.16, min: 0, max: 1, step: 0.02, label: 'SIGMET fill alpha' },
  sigmetLineWidthPx: { value: 2, min: 0.25, max: 10, step: 0.25, label: 'SIGMET outline width' },
  sigmetDashOnPx: { value: 8, min: 1, max: 60, step: 1, label: 'SIGMET dash on' },
  sigmetDashOffPx: { value: 5, min: 0, max: 60, step: 1, label: 'SIGMET dash gap' },
  sigmetLabelFontPx: { value: 12, min: 6, max: 32, step: 1, label: 'SIGMET label font' },
  lsaLineWidthPx: { value: 2, min: 0.25, max: 10, step: 0.25, label: 'LSA bubble outline width' },
  lsaLabelFontPx: { value: 15, min: 8, max: 28, step: 1, label: 'LSA bubble name font size (px)' },
  lsaMetaFontPx: { value: 12, min: 6, max: 22, step: 1, label: 'LSA bubble alt/hours font size (px)' },
  lsaLabelMinZoom: { value: 10, min: 5, max: 16, step: 1, label: 'LSA bubble labels visible from zoom' },
  lsaHighlightWidthPx: { value: 4, min: 0.5, max: 12, step: 0.5, label: 'LSA bubble highlight width' },
  notamColor: { value: '#c026d3', type: 'color', label: 'NOTAM area color' },
  notamFillAlpha: { value: 0.14, min: 0, max: 1, step: 0.02, label: 'NOTAM area fill alpha' },
  notamLineWidthPx: { value: 2, min: 0.5, max: 5, step: 0.5, label: 'NOTAM area line width (px)' },
  notamRouteWidthPx: { value: 3, min: 1, max: 6, step: 0.5, label: 'NOTAM closed-route line width (px)' },
  notamDivertColor: { value: '#0891b2', type: 'color', label: 'NOTAM diverted-route color' },

  // Every overlay plate laid over the chart -- the airfield plates and the annex layers in
  // Extra layers (circuit, training, CVFR, helicopter, comm-failure joining) -- is drawn at
  // this opacity. One slider drives them all, so one default sits behind it; it was six copies
  // of the same hard-coded 0.6 with no way to change it short of editing the source.
  overlayOpacity: { value: 0.8, min: 0.2, max: 1, step: 0.05, label: 'Overlay plate opacity' },
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
  sigwxCoastWidthPx: { value: 0, min: 0, max: 6, step: 1, label: 'SIGWX coastline width (0 = off, the default; re-strokes the sea/land boundary the knockout erases)' },
  sigwxCoastColor: { value: '#1d4e89', type: 'color', label: 'SIGWX coastline color' },
  sigwxCoastAlpha: { value: 0.9, min: 0, max: 1, step: 0.05, label: 'SIGWX coastline alpha' },
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

  liveAircraftRadiusPx: { value: 12, min: 6, max: 48, step: 1, label: 'Live aircraft size' },
  liveHeadingLineWidthPx: { value: 2, min: 0.5, max: 6, step: 0.5, label: 'Live heading line width' },
  liveHeadingDashPx: { value: 9, min: 1, max: 30, step: 1, label: 'Live heading dash length' },
  liveHeadingDashGapPx: { value: 6, min: 0, max: 30, step: 1, label: 'Live heading dash gap' },
  liveHeadingTickPx: { value: 7, min: 2, max: 20, step: 1, label: 'Live heading tick length' },
  liveHeadingLabelPx: { value: 11, min: 7, max: 24, step: 1, label: 'Live heading label size' },
  liveHeadingLabelGapPx: { value: 6, min: 0, max: 20, step: 1, label: 'Live heading label gap' },
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
  vorLabelMinZoom: { value: 10, min: 5, max: 16, step: 1, label: 'VOR label min zoom' },
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
  floatingPanelGapPx: { value: 12, min: 0, max: 80, step: 1, label: 'Floating panel separation' },
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
  // Kite + note fill opacity. Not exposed as a Display slider — gist-only (also
  // adjustable in the hidden ?tune panel). The waypoint label backgrounds have
  // their own visible slider (yellowAlpha); this covers the leg / cumulative /
  // return kites and note boxes.
  kiteNoteAlpha: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Kite / note fill opacity' },

  // Default on/off state of the toolbar layer/display checkboxes for a NEW user
  // (empty localStorage). Each value mirrors the checkbox's baked-in default, so
  // shipping this changes nothing on its own — but the gist (or the ?tune=1
  // panel) can now flip which layers a fresh visitor sees without a redeploy.
  // NavAid.applyDefaultVisibility() (ui.js) reconciles the live checkboxes to
  // these whenever localStorage has no explicit user choice for that toggle.
  defaultShowReturn: { value: false, type: 'bool', label: 'Default: show return leg' },
  // Whether the feature EXISTS, as opposed to defaultShowReturn's whether it starts on.
  // Ships OFF: the mirrored return path draws an imaginary second route on top of the real
  // legs, and with a turning point the route already contains its return, so the mirror was
  // at best redundant and at worst two headings claiming to be the same leg. Set true in the
  // tuning gist to bring the control, its keyboard shortcut and the drawing back, without a
  // deploy -- the code is all still here.
  featureShowReturn: { value: false, type: 'bool', label: 'Feature: show return path' },
  // The one-time nudge that teaches a first-time visitor the core action, plus the click
  // priming that goes with it (an empty map's first plain click drops a waypoint instead of
  // inspecting). Both are the same onboarding gesture, so one switch governs them: off, and
  // the map behaves for everyone the way it does for a pilot who has already seen the hint.
  featureRouteIntro: { value: true, type: 'bool', label: 'Feature: new-user route intro' },
  // The inspector stays shut while a real fix is driving the map (recording or showing
  // location). Set true to have a tap open it in flight, the way it used to.
  featureInspectorWhileTracking: { value: false, type: 'bool', label: 'Feature: inspector while tracking' },
  // The assistant's launcher sits in the bottom-right map controls, where a thumb reaching
  // for zoom or the follow lock finds it. Ships OFF: the assistant is a planning-desk tool
  // and the map is where a pilot is reading, so it is opted into rather than out of. On
  // brings back the button and the panel with nothing else to configure.
  featureAssistant: { value: false, type: 'bool', label: 'Feature: AI assistant button' },
  // The reverse-route warning is the one toast a pilot has to act on, so it gets its own
  // dwell time and its own attention -- 2.5s alongside 'route saved' was not enough to read
  // it, let alone weigh it. Both live here so they can be tuned from the gist without a
  // deploy, like every other number in the app.
  reverseWarnMs: { value: 10000, min: 1000, max: 30000, step: 500, label: 'Reverse warning (ms)' },
  // Reversing the route turns the chart the other way round too: what was ahead of the
  // aircraft is now behind it, and a map left facing the old direction reads as the flight
  // it is no longer. Off puts the old behaviour back (the bearing is left alone).
  reverseRotatesMap: { value: true, type: 'bool', label: 'Reverse also turns the map 180°' },
  reverseWarnBlink: { value: true, type: 'bool', label: 'Reverse warning blinks' },
  defaultShowNavWP: { value: true, type: 'bool', label: 'Default: show VFR reporting points' },
  defaultShowAirfields: { value: true, type: 'bool', label: 'Default: show airfields' },
  defaultShowVor: { value: true, type: 'bool', label: 'Default: show VOR stations' },
  defaultShowWpNames: { value: true, type: 'bool', label: 'Default: show waypoint names' },
  defaultShowCumTime: { value: true, type: 'bool', label: 'Default: show cumulative time' },
  defaultShowDrift: { value: true, type: 'bool', label: 'Default: show drift lines' },
  defaultShowCommChange: { value: true, type: 'bool', label: 'Default: show comm-change rings' },
  // Speaking the alerts is opt-in per device (navaid.voiceAlerts is deliberately not
  // synced), but the shipped default belongs here like every other toggle's: without an
  // entry tune() returns 0, so applyDefaultVisibility could only ever push this OFF and
  // the gist had no way to hand a fresh phone a talking cockpit.
  defaultVoiceAlerts: { value: false, type: 'bool', label: 'Default: speak alerts' },
  defaultShowMidLeg: { value: false, type: 'bool', label: 'Default: show mid-leg marks' },
  defaultHighlightDiff: { value: false, type: 'bool', label: 'Default: highlight speed/alt change' },
  defaultLimitLegKites: { value: true, type: 'bool', label: 'Default: limit leg kites' },
  defaultShowMsa: { value: false, type: 'bool', label: 'Default: show MSA' },
  defaultShowReporting: { value: false, type: 'bool', label: 'Default: show reporting points' },
  defaultForceSnap: { value: false, type: 'bool', label: 'Default: force snap' },
  defaultShowNotam: { value: false, type: 'bool', label: 'Default: show NOTAMs' },
  defaultShowWind: { value: false, type: 'bool', label: 'Default: show wind' },
  defaultWindField: { value: false, type: 'bool', label: 'Default: show wind field' },
  defaultImsPwx: { value: false, type: 'bool', label: 'Default: show IMS PWX overlay' },
  defaultSigwxOv: { value: false, type: 'bool', label: 'Default: show SIGWX overlay' },
  defaultShowLsaBubbles: { value: true, type: 'bool', label: 'Default: show LSA' },
  // Ships off: auto-route changes what the pilot's route CONTAINS. Gist-flippable like
  // every other shipped default, for a fleet that wants it on from the first boot.
  defaultAutoRoute: { value: false, type: 'bool', label: 'Default: auto-route through waypoints' },
  defaultShowCircuit: { value: false, type: 'bool', label: 'Default: show circuit plates' },
  defaultShowTraining: { value: false, type: 'bool', label: 'Default: show training plates' },
  defaultShowCvfr: { value: false, type: 'bool', label: 'Default: show CVFR plates' },
  defaultShowHeli: { value: false, type: 'bool', label: 'Default: show heli plates' },
  defaultShowCommfail: { value: false, type: 'bool', label: 'Default: show comm-fail plates' },
};
// Groups are ordered to mirror the route-building workflow: the route line
// and its per-leg annotations first, then the markers you place, then the
// reference overlays the chart adds, then chrome (notes, page frame),
// interaction (hit testing), tools (alt pairs, export), and finally the
// global colour palette.
NavAid.tuningGroups = [
  { name: 'Navigation', keys: ['magneticVariationDeg', 'msaBufferFt', 'altimetryCorrection', 'geoidUndulationFt', 'followResumeMs', 'gpsReadoutFontPx', 'alertNotifyTtlSec', 'altToleranceFt', 'altMaxAlertsPerLeg', 'legEtaLeadSec', 'atisLeadSec', 'atisMarkerColor', 'atisMarkerRadiusPx', 'atisMarkerFontPx', 'liveHeadingEndLabel', 'legCaptureNm', 'driftTrackErrorDeg', 'driftCheckSec', 'coneUnknownSec', 'gpsMaxAccuracyM', 'gpsMinMoveM', 'gpsStaleSec', 'qnhMaxAgeMin', 'qnhMoveNm', 'compassMaxKt', 'compassFallback', 'headingUpMinDeltaDeg', 'crosshairSizePx', 'crosshairWidthPx', 'crosshairColor', 'crosshairHaloColor', 'crosshairAlpha'] },
  { name: 'Performance defaults', keys: ['profileClimbFpm', 'profileClimbKt', 'defaultGph', 'defaultTaxiGal'] },
  { name: 'Altitude inference', keys: ['legAltInferMaxHops', 'legAltInferMaxDistRatio', 'legAltInferMaxExtraNm'] },
  { name: 'Plan card', keys: ['planCardBaseRowPx', 'planCardGripPx', 'planCardBgColor', 'planCardHeaderBgColor', 'planCardTotalBgColor', 'planCardStripeBgColor', 'planCardGridColor', 'planCardTextColor', 'planCardGripColor', 'planCardGripLineColor'] },
  { name: 'VOR range ring', keys: ['vorRangeRingColor', 'vorRangeRingAlpha', 'vorRangeRingWidthPx', 'vorRangeRingDashPx', 'vorRangeRingGapPx', 'vorRangeRingLabel', 'vorRangeRingSteps', 'vorRangeRingLabelGapPx'] },
  { name: 'Simulator status', keys: ['simStatusOkColor', 'simStatusErrColor'] },
  { name: 'Overlay labels + flash', keys: ['overlayLabelHaloWidthPx', 'liveHeadingTickHaloColor', 'liveHeadingTickHaloAlpha', 'liveHeadingTickHaloWidthPx', 'notamFlashColor', 'notamBadgeTextColor', 'notamBadgeFontPx'] },
  { name: 'Graph legs review (?graphlegs=1)', keys: ['graphLegArmyColor', 'graphLegAtcColor',
    'graphLegClosedColor', 'graphLegOneWayColor', 'graphLegPlainColor', 'graphLegWidthPx',
    'graphLegArrowPx', 'graphLegLabelMinZoom'] },
  { name: 'LSA colors', keys: ['lsaHighlightColor', 'lsaWeekendColor', 'lsaAlwaysColor', 'lsaLabelColor'] },
  { name: 'GPS track', keys: ['gpsTrackColors', 'gpsTrackOutlineColor', 'gpsTrackStartColor', 'gpsTrackEndColor'] },
  { name: 'Base layers', keys: ['layerEnabledLowAlt', 'layerEnabledHelicopters',
    'layerEnabledNavigation', 'layerEnabledSatellite', 'layerEnabledOpenStreetMap'] },
  { name: 'Search', keys: ['searchMaxResults', 'searchMaxVor', 'searchMaxBubbles', 'searchMaxNotams', 'searchMaxAirfields', 'searchMaxNavWp', 'searchMaxRouteWp', 'searchMaxNotes', 'searchNoteLabelChars', 'searchFlashMs', 'searchFlashRadiusPx', 'searchFlashColor',
    'searchFlashWidthPx', 'searchFlashFillAlpha', 'searchFlashPulses'] },
  { name: 'Satellite', keys: ['satellitePreviewZoom', 'satelliteExpandedZoom', 'satelliteMinZoom', 'satelliteMaxZoom', 'satelliteChartOverscale', 'satellitePreviewWidthPx', 'satellitePreviewHeightPx', 'satelliteMarkerRadiusPx', 'satelliteMarkerColor', 'satelliteMarkerWeightPx', 'satelliteMarkerAlpha'] },
  { name: 'Go-to marker', keys: ['gotoMarkerColor', 'gotoMarkerFillColor', 'gotoMarkerRadiusPx', 'gotoMarkerWeightPx', 'gotoMarkerFillAlpha'] },
  { name: 'Map label zoom', keys: ['airfieldLabelMinZoom', 'navWpLabelMinZoom', 'vorLabelMinZoom'] },
  { name: 'Wind', keys: ['windDir', 'windSpeed'] },
  { name: 'Magnifier', keys: ['magBaselineZoom', 'magMaxExp'] },
  { name: 'Behaviour', keys: ['undoLimit', 'rotDragPx', 'touchDragPx', 'shareMaxWaypoints', 'commChangeSnapPx', 'originResnapArmPx'] },
  { name: 'Route line', keys: ['routeLineWidthPx', 'routeSelectedLineWidthPx'] },
  { name: 'Drift lines', keys: ['driftAngleDeg', 'driftLengthFactor', 'driftDashOnPx', 'driftDashOffPx', 'driftStrokeWidthPx', 'driftLineColor', 'driftLineAlpha'] },
  { name: 'GPS track', keys: ['gpsBreadcrumbColor', 'gpsBreadcrumbWidthPx'] },
  { name: 'Wind arrows', keys: ['windArrowColor', 'windArrowHaloColor', 'windTextHaloColor'] },
  { name: 'Default marker locations', keys: ['defaultLabelMarginPx', 'defaultKiteHalfWidthPx'] },
  { name: 'Leg kites', keys: ['legKiteFillColor', 'returnKiteFillColor', 'legKiteHeightPx', 'legKiteCellWidthPx', 'legKiteTriangleLenPx', 'kitePrintHeightMm', 'legKiteBorderPx', 'legKiteDividerPx', 'legKiteHaloPx', 'legKiteTextPx', 'legKiteHeadingTextPx', 'legKiteHeadingAnchor'] },
  { name: 'Cumulative kites', keys: ['cumKiteAngleDeg', 'cumKiteFillColor', 'returnCumKiteFillColor', 'cumKiteHeightPx', 'cumKiteCellWidthPx', 'cumKiteTriangleLenPx', 'cumKitePrintHeightMm', 'cumKiteBorderPx', 'cumKiteTextPx'] },
  { name: 'Minute markers', keys: ['minuteMarkerFontPx', 'minuteTickEvenPx', 'minuteTickOddPx', 'minuteTickEvenWidthPx', 'minuteTickOddWidthPx', 'minuteLabelOffsetPx'] },
  { name: 'Distance badges', keys: ['distanceBadgeRadiusPx', 'distanceBadgeBorderPx', 'distanceBadgeFontPx', 'distanceBadgeFillColor'] },
  { name: 'Route waypoints', keys: ['waypointBaseRadiusPx', 'waypointPrintDiaMm', 'waypointFontPx', 'waypointTextFitFactor', 'waypointMinZoomScale', 'waypointSelectedRadiusAddPx', 'waypointStrokeWidthPx', 'waypointFillColor', 'waypointHotspotFillColor', 'waypointHotspotRingColor', 'waypointHotspotRingWidthPx', 'waypointHotspotRingGapPx'] },
  { name: 'Airfields', keys: ['airfieldMarkerRadiusPx', 'airfieldMarkerWidthFactor', 'airfieldMarkerBaseFactor', 'airfieldStrokeWidthPx', 'airfieldLabelFontPx', 'airfieldLabelOffsetPx', 'airfieldLabelHaloPx', 'airfieldFillColor', 'airfieldOutlineColor'] },
  { name: 'Nav waypoints', keys: ['navWaypointRadiusPx', 'navWaypointStrokeWidthPx', 'navWaypointLabelFontPx', 'navWaypointLabelOffsetPx', 'navWaypointLabelHaloPx', 'navWaypointDotColor'] },
  { name: 'Overlay labels', keys: ['overlayLabelHaloColor', 'overlayLabelHaloAlpha'] },
  { name: 'Frequency changes', keys: ['commCalloutAngleDeg', 'commChangeRingRadiusPx', 'commChangeRingWidthPx', 'commChangeRingColor', 'commChangeNoteLatOffset', 'commChangeNoteLngOffset', 'commChangeArrowStartGapPx', 'commChangeArrowWidthPx', 'commChangeArrowColor', 'commChangeArrowLineCap', 'commChangeArrowLineJoin', 'commChangeArrowMiterLimit', 'commChangeArrowHaloPx', 'commChangeArrowHaloColor', 'commChangeArrowHaloAlpha', 'commChangeSelectedColor', 'commChangeSelectedAlpha', 'commChangeSelectedWidthAddPx', 'commChangeArrowBoltPx', 'commChangeArrowBoltAngleDeg', 'commChangeArrowBend1Along', 'commChangeArrowBend2Along', 'commChangeNameFontPx', 'commChangeFreqFontPx', 'commChangeTextColor', 'commChangeTextHaloColor', 'commChangeTextHaloAlpha', 'commChangeTextAlong', 'commChangeTextGapPx', 'commChangeNameHaloWidthPx', 'commChangeFreqHaloWidthPx'] },
  { name: 'Notes', keys: ['noteFontPx', 'notePadXPx', 'notePadYPx', 'noteLineHeightPx', 'noteMinWidthPx', 'notePrintWidthMm', 'notePrintHeightMm', 'noteStrokeWidthPx', 'noteSelectedStrokeWidthPx', 'noteDefaultFillColor'] },
  { name: 'Page frame', keys: ['pageFrameLineWidthPx', 'pageFrameDashOnPx', 'pageFrameDashOffPx', 'pageFrameScrimColor', 'pageFrameScrimAlpha', 'pageFrameLocked', 'pageFrameHitPx', 'a4x2CutLineWidthPx', 'a4x2CutDashOnPx', 'a4x2CutDashOffPx', 'a4x2CutLineColor', 'a4x2CutLineAlpha', 'a4x2MarkLabelMm', 'a4x2MarkGuideMm', 'a4x2MarkLabelBgColor', 'a4x2MarkLabelInkColor'] },
  { name: 'Route defaults', keys: ['defaultLegSpeedKt', 'unknownProfileAltFt', 'legLabelMaxScale'] },
  { name: 'Flight plan filing (AIP א׳-11)', keys: ['fplMinLeadMin', 'fplSameDayAfterMin',
    'fplEveOpenMin', 'fplWindowBeforeMin', 'fplWindowAfterVfrMin', 'fplEetRoundMin',
    'fplSignatureInk'] },
  { name: 'Google Earth tour', keys: ['kmlTourSecPerFlightMin', 'kmlTourLegMinSec', 'kmlTourLegMaxSec', 'kmlTourMinSegSec', 'kmlUnsetLegAglFt'] },
  { name: 'Gestures', keys: ['touchRotateGesture'] },
  { name: 'Hit testing', keys: ['hitWaypointExtraPx', 'hitLegPx', 'hitLegLabelMinPx', 'hitCumLabelMinPx'] },
  { name: 'Alt pairs', keys: ['altPairFocusColor', 'altPairFocusWidthPx', 'altPairFocusDashOnPx', 'altPairFocusDashOffPx', 'altPairFocusDotRadiusPx', 'altPairFocusDotColor', 'altPairFocusMs', 'altPairFocusLineAlpha', 'altPairFocusDotAlpha'] },
  { name: 'VOR stations', keys: ['vorMarkerRadiusPx', 'vorMarkerWidthPx', 'vorMarkerColor', 'vorSelectedColor', 'vorLabelFontPx'] },
  { name: 'Reporting badges', keys: ['reportBadgeRadiusPx', 'reportBadgeOffsetPx', 'reportBadgeFontPx', 'reportBadgeColor', 'reportBadgeTextColor'] },
  { name: 'Live aircraft', keys: ['liveAircraftFillColor', 'liveAircraftOutlineColor', 'liveAircraftRadiusPx', 'liveHeadingLineColor', 'liveHeadingTextColor', 'liveHeadingNmTextColor', 'liveHeadingMinTextColor', 'liveHeadingLineWidthPx', 'liveHeadingDashPx', 'liveHeadingDashGapPx', 'liveHeadingTickPx', 'liveHeadingLabelPx', 'liveHeadingLabelGapPx'] },
  { name: 'Terrain', keys: ['terrainWarnClearanceFt', 'terrainTintAlpha', 'terrainAlertColor', 'terrainCautionColor', 'terrainLegWarnWidthPx', 'terrainLegWarnAlpha', 'terrainWpWarnRingPx', 'terrainTintMinZoom', 'terrainTintMinCellPx'] },   // msaBufferFt lives in the Navigation group
  { name: 'Vertical profile', keys: ['profileTerrainColor', 'profileMsaColor', 'profileTerrainSamples', 'profileHeadroomFt', 'profileBgColor', 'profileGridColor', 'profileAxisColor', 'profileGroundColor', 'profileTextColor', 'profileNmTextColor', 'profileTimeTextColor', 'profileAreaColor', 'profileLineColor', 'profileTocColor', 'profileMarkerHaloColor', 'profileAxisHeightPx', 'profileYPadPx'] },
  { name: 'SIGMETs', keys: ['sigmetTurbColor', 'sigmetIceColor', 'sigmetMtwColor', 'sigmetVaColor', 'sigmetDustColor', 'sigmetTcColor', 'sigmetDefaultColor', 'sigmetFillAlpha', 'sigmetLineWidthPx', 'sigmetDashOnPx', 'sigmetDashOffPx', 'sigmetLabelFontPx'] },
  { name: 'LSA bubbles', keys: ['lsaLineWidthPx', 'lsaHighlightWidthPx', 'lsaLabelFontPx', 'lsaMetaFontPx', 'lsaLabelMinZoom'] },
  { name: 'NOTAMs', keys: ['notamColor', 'notamFillAlpha', 'notamLineWidthPx', 'notamRouteWidthPx', 'notamDivertColor'] },
  { name: 'Overlay opacity', keys: ['overlayOpacity'] },
  { name: 'Weather (IMS)', keys: ['imsPwxOpacity', 'imsPwxLatOffset', 'imsPwxLngOffset', 'imsPwxLatScale', 'imsPwxLngScale', 'imsPwxRotationDeg', 'imsPwxDarkBackdropAlpha', 'imsPwxBackdropBandPct'] },
  { name: 'SIGWX overlay', keys: ['sigwxOpacity', 'sigwxLatOffset', 'sigwxLngOffset', 'sigwxLatScale', 'sigwxLngScale', 'sigwxRotationDeg', 'sigwxWhiteKnockout', 'sigwxKnockoutSat', 'sigwxCoastWidthPx', 'sigwxCoastColor', 'sigwxCoastAlpha', 'sigwxTblOpacity', 'sigwxTblLatOffset', 'sigwxTblLngOffset', 'sigwxTblScale'] },
  // Wind-field render params + grid + defaults. The altitude/time/opacity
  // sliders are live menu controls; their defaults live here.
  { name: 'Wind field', keys: ['windFieldDefaultAltFt', 'windFieldDefaultOpacity', 'windFieldGridDeg', 'windFieldWest', 'windFieldEast', 'windFieldSouth', 'windFieldNorth', 'windFieldVelocityScale', 'windFieldParticleAge', 'windFieldParticleMultiplier', 'windFieldLineWidth', 'windFieldMaxVelocity', 'windFieldMinVelocity', 'windFieldFrameRate', 'windFieldHoursAhead', 'windFieldForecastDays'] },
  { name: 'Chrome layout', keys: ['inspectorDefaultTopPx', 'inspectorBottomGapPx', 'floatingPanelGapPx', 'zuluClockMinWidthPx', 'zuluClockPadYPx', 'zuluClockPadXPx', 'zuluClockMarginTopPx', 'zuluClockMarginRightPx', 'zuluClockFontPx', 'zuluClockFontWeight', 'zuluClockLineHeight', 'zuluClockTextColor', 'zuluClockBgColor', 'zuluClockBgAlpha', 'zuluClockBorderColor', 'zuluClockBorderWidthPx', 'zuluClockBorderRadiusPx', 'zuluClockShadowYPx', 'zuluClockShadowBlurPx', 'zuluClockShadowAlpha'] },
  // Includes the former 'First-run view' group: the first-run centre/zoom and the
  // fit-with-no-route view answer the same question, and a pilot tuning one wants the other
  // in front of them.
  { name: 'Map fit', keys: ['fitRoutePaddingPx', 'fitRouteMaxZoom', 'fitRouteEmptyZoom',
    'fitNotamPaddingPx', 'fitNotamMaxZoom', 'fitNotamPointZoom',
    'fitTrackPaddingPx', 'fitTrackMaxZoom', 'fitTrackPointZoom',
    'fitAltPairPaddingPx', 'fitAltPairMaxZoom',
    'fitAreaPaddingPx', 'fitAreaMaxZoom', 'fitBoxPaddingPx',
    'a3FitZoomOffset', 'a4FitZoomOffset',
    'defaultViewZoom', 'defaultViewLat', 'defaultViewLng'] },
  { name: 'Export', keys: ['exportBgColor'] },
  { name: 'Global palette', keys: ['inkColor', 'selectedColor', 'labelFillColor', 'kiteTextColor', 'legKiteHaloColor', 'kiteNoteAlpha'] },
  { name: 'Default layer visibility', keys: ['defaultShowNavWP', 'defaultShowAirfields', 'defaultShowVor', 'defaultShowWpNames', 'defaultShowCumTime', 'defaultShowDrift', 'defaultShowCommChange', 'defaultVoiceAlerts', 'defaultShowMidLeg', 'defaultHighlightDiff', 'defaultLimitLegKites', 'defaultShowMsa', 'defaultShowReporting', 'defaultForceSnap', 'defaultShowReturn', 'featureShowReturn', 'featureRouteIntro', 'featureInspectorWhileTracking', 'featureAssistant', 'reverseWarnMs', 'reverseWarnBlink', 'reverseRotatesMap', 'defaultShowNotam', 'defaultShowWind', 'defaultWindField', 'defaultImsPwx', 'defaultSigwxOv', 'defaultShowLsaBubbles', 'defaultAutoRoute', 'defaultShowCircuit', 'defaultShowTraining', 'defaultShowCvfr', 'defaultShowHeli', 'defaultShowCommfail'] },
];
// Padding pair + maxZoom for a fitBounds call, from the tuning registry. Every "frame the
// map on X" call goes through this instead of carrying its own literals.
function fitOpts(padKey, zoomKey, extra) {
  const pad = Math.max(0, Math.round(tune(padKey)));
  const o = Object.assign({ padding: [pad, pad] }, extra || {});
  if (zoomKey) {
    const mz = tune(zoomKey);
    if (mz > 0) o.maxZoom = mz;
  }
  return o;
}

function tune(key) {
  const spec = NavAid.tuningDefaults && NavAid.tuningDefaults[key];
  if (!spec) return 0;
  const v = NavAid.tuning[key];
  if (spec.type === 'color') return typeof v === 'string' ? v : spec.value;
  if (spec.type === 'bool') return typeof v === 'boolean' ? v : spec.value;
  if (spec.type === 'select') {
    return spec.options && spec.options.indexOf(v) !== -1 ? v : spec.value;
  }
  return Number.isFinite(v) ? v : spec.value;
}

// Keep two draggable panels readable. The caller supplies the moving panel's
// desired top-left; this returns the nearest in-viewport position that does not
// overlap the fixed panel. On a viewport too narrow to hold both, it preserves
// the desired position and lets the z-index fallback decide which panel is active.
function floatingPanelPosition(movingEl, fixedEl, desiredX, desiredY) {
  const width = movingEl ? movingEl.offsetWidth : 0;
  const height = movingEl ? movingEl.offsetHeight : 0;
  const maxX = Math.max(0, window.innerWidth - width);
  const maxY = Math.max(0, window.innerHeight - height);
  const clamp = p => ({
    x: Math.max(0, Math.min(maxX, p.x)),
    y: Math.max(0, Math.min(maxY, p.y)),
  });
  const desired = clamp({ x: desiredX, y: desiredY });
  if (!movingEl || !fixedEl || fixedEl.classList.contains('hidden')) return desired;
  const fixed = fixedEl.getBoundingClientRect();
  if (!(fixed.width > 0 && fixed.height > 0 && width > 0 && height > 0)) return desired;
  const gap = Math.max(0, tune('floatingPanelGapPx'));
  const overlaps = p => p.x < fixed.right + gap && p.x + width > fixed.left - gap
    && p.y < fixed.bottom + gap && p.y + height > fixed.top - gap;
  if (!overlaps(desired)) return desired;
  const candidates = [
    { x: fixed.left - gap - width, y: desired.y },
    { x: fixed.right + gap, y: desired.y },
    { x: desired.x, y: fixed.top - gap - height },
    { x: desired.x, y: fixed.bottom + gap },
  ].map(clamp).filter(p => !overlaps(p));
  if (!candidates.length) return desired;
  candidates.sort((a, b) => ((a.x - desired.x) ** 2 + (a.y - desired.y) ** 2)
    - ((b.x - desired.x) ** 2 + (b.y - desired.y) ** 2));
  return candidates[0];
}

function setFloatingPanelPosition(el, position) {
  if (!el || !position) return;
  el.style.position = 'fixed';
  el.style.right = 'auto';
  el.style.left = position.x + 'px';
  el.style.top = position.y + 'px';
  el.style.margin = '0';
}
function setTune(key, value) {
  const spec = NavAid.tuningDefaults && NavAid.tuningDefaults[key];
  if (!spec) return;
  if (spec.type === 'color') {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return;
    NavAid.tuning[key] = value.toLowerCase();
    return;
  }
  if (spec.type === 'bool') {
    // Accept a real boolean, 0/1, or '0'/'1'/'true'/'false' (gist JSON may use
    // any of these); anything else is rejected so a bad value keeps the default.
    if (typeof value === 'boolean') { NavAid.tuning[key] = value; return; }
    if (value === 1 || value === '1' || value === 'true') { NavAid.tuning[key] = true; return; }
    if (value === 0 || value === '0' || value === 'false') { NavAid.tuning[key] = false; return; }
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
// Applies one gist object over the defaults. Unknown keys are ignored: the gist outlives any
// one build, and a key this build has never heard of must not become a tunable by arriving.
function applyRemoteConfigValues(o) {
  if (!o || typeof o !== 'object') return 0;
  let n = 0;
  for (const k in o) {
    if (!NavAid.tuningDefaults[k]) continue;
    setTune(k, o[k]);                          // per-spec validation + clamp
    if (NavAid.tuning[k] !== undefined) n++;
  }
  return n;
}
// The gist arrives over the network, so the first paint used to be the SHIPPED defaults and
// everything the gist changes -- colours, sizes, which layers are on -- visibly jumped a
// moment later. The last gist seen on this device is kept here and applied synchronously at
// boot, so a returning pilot's first frame is already the configured one; the fetch below
// still runs and corrects it if the gist has since changed. A first-ever visit has nothing
// cached and behaves exactly as before.
const GIST_CACHE_KEY = 'navaid.gistCache';
function applyCachedRemoteConfig() {
  if (!NavAid.configUrl || NavAid.gistDisabled) return 0;
  try {
    const raw = localStorage.getItem(GIST_CACHE_KEY);
    if (!raw) return 0;
    return applyRemoteConfigValues(JSON.parse(raw));
  } catch (e) {
    return 0;                                  // unreadable/corrupt cache -> shipped defaults
  }
}
NavAid.gistWarmStart = applyCachedRemoteConfig();

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
    // Cache what the server said, not what this build understood: a key added in a later
    // build must still be there for it, and the file is a few KB.
    try { localStorage.setItem(GIST_CACHE_KEY, JSON.stringify(o)); } catch (e) { /* full/blocked */ }
    return applyRemoteConfigValues(o);
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
  // One graph per layer replaces the nav-waypoints / comm-change / leg-altitude files;
  // the ?v= cache-busts all three kinds, which now come from the same file.
  routeGraphUrl: 'data/cvfr-route-graph.json?v=2',  // resolved relative to index.html (docs/)
  navWpSearchField: 'en',              // which locale label to show/search in results
  airfieldsUrl: 'data/airfields.json?v=37',  // resolved relative to index.html (docs/)
  airfieldLabelField: 'en',            // which locale label to show on the overlay
  routeTemplatesUrl: 'data/route-templates.json?v=2', // ready-made route templates
  vorUrl: 'data/vor.json?v=2',              // Israeli VOR/DME stations (#404 follow-up)

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
  sliderStandardSuffix: '(standard)',
  tbWpSize: 'Waypoint size',                        // Display slider label
  tbWpSizeTitle: 'Waypoint circle and name size',
  tbNavWpSource: 'Nav waypoints from',
  tbNavWpSourceTitle: 'Which chart the nav waypoints, comm changes and leg altitudes come from. Follow chart uses the base layer, and falls back to CVFR on Satellite / OSM / Navigation.',
  tbNavWpSourceFollow: 'Follow chart',
  tbShowNavWp: 'Show/pin nav waypoints',            // Map overlay toggle
  tbShowNavWpTitle: 'Overlay published Israeli VFR reporting points',
  tbShowReporting: 'Show mandatory reports',        // reporting-type overlay toggle
  tbShowReportingTitle: 'Badge waypoints that are mandatory (חובה) reporting points',
  tbImsPwx: 'Show wind/temp',                       // IMS PWX overlay toggle
  tbImsPwxTitle: 'Overlay the IMS PWX wind & temperature forecast on the map',
  tbImsPwxLevel: 'Level',
  tbImsPwxTime: 'Valid time',
  tbWxTime: 'Valid time',
  tbWxTimeTitle: 'Valid time (Zulu) — shared by the wind/temp and SIGWX charts',
  tbWxOpacity: 'Chart opacity',
  tbWxOpacityTitle: 'Opacity of the weather-chart overlays (shared by wind/temp and SIGWX)',
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
  wxPwxUnavailableWatermark: 'Wind/temp — Unavailable',
  wxSigwxUnavailableWatermark: 'SIGWX — Unavailable',
  tbShowMsa: 'Terrain vs altitude',                 // clearance shading + the leg MSA row
  tbShowMsaTitle: 'Shade only the ground that reaches your planned altitude, and show each leg\'s minimum safe altitude in the inspector',
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
  routeLibraryExportJson: 'JSON',
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
  routeLibraryExportEmpty: 'No saved routes to export yet.',
  routeLibraryImportedN: function(n) { return n + ' route(s) imported'; },
  errRouteLibraryWriteFailed: 'Those routes could not be saved to this device (storage full, or the saved-route library is unreadable). Nothing was imported.',
  routeLibraryImportSkipped: function(added, skipped) {
    return added + ' route(s) imported, ' + skipped + ' skipped (not a valid route)';
  },
  errNotRouteLibrary: 'That file is not a saved-routes library (expected a list of routes).',
  routeLibraryDiscardCorrupt: 'Discard corrupted library',
  routeLibraryDiscardCorruptConfirm: 'Discard the corrupted saved-route library and start with an empty one? This cannot be undone — export it first if you might want to recover it.',
  routeLibraryGdriveSync: 'Sync with Google Drive',
  routeLibraryGdriveSyncing: 'Syncing…',
  routeLibraryGdriveSynced: 'Synced with Google Drive',
  routeLibraryGdriveError: 'Drive sync failed',
  fpTimeUnitsTitle: 'Elapsed time, mm:ss (not a clock time)',
  startRouteHere: '➕ Start route here',
  addToRoute: '➕ Add to route',
  alreadyOnRoute: '✓ Already on the route',
  emptyRouteHint: 'Click a point on the map to start a route',
  modeChipAdd: 'Adding waypoints',
  modeChipNote: 'Adding notes',
  modeChipStop: 'tap to stop',
  modeChipTitle: 'Click to leave this mode',
  // Phone-width display labels. Full titles ("Time (mm:ss)", "Fuel (gal)") pushed the
  // table 111px past a 375px screen on their own. CSV/export headers are unaffected --
  // those come from fpHeaders, which is the export contract.
  fpHeadersNarrow: { dist: 'NM', speed: 'kt', alt: 'Alt', time: 'Time', fuel: 'Fuel',
    cumTime: 'Cum', cumFuel: 'Cum fuel' },
  fpMobileSummary: function (legs, nm, time, gal) {
    return legs + (legs === 1 ? ' leg · ' : ' legs · ') + nm + ' NM · ' + time + ' · ' + gal + ' gal';
  },
  vorInfoType: 'Type',
  vorInfoChannel: 'Channel',
  vorInfoHours: 'Hours',
  vorInfoRange: 'Range',
  vorInfoRangeNone: 'not published',
  vorInfoElev: 'DME antenna',
  vorInfoLimits: 'Limits',
  vorInfoOutOfRange: 'This point is {dme} NM out — beyond the published {cov} NM coverage.',
  vorDmeOnlyReadout: function (dme) { return dme + ' NM (DME only)'; },
  searchKindRouteWp: 'on your route',
  searchKindNote: 'note',
  routeLibraryGdriveSyncSettings: 'Sync settings too',
  routeLibraryGdriveSettingsApplied: 'Settings updated — reloading…',
  routeLibraryGdriveFirstSyncConflict: 'This device and Google Drive both have settings for: {keys}.\n\nOK = REPLACE this device\'s values with the ones from Drive.\nCancel = do nothing (sync again to choose).',
  routeLibraryGdriveKeepThisDevice: 'Keep THIS device\'s settings and update Google Drive?',
  routeLibraryGdriveSettingsSkipped: 'Settings not synced — sync again to choose which device wins.',
  routeLibraryGdriveStorageFull: 'This device could not store the settings (storage full).',
  routeLibraryGdriveRaced: 'Another device changed the settings while syncing — sync again.',
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
  inspHotspotSet: '🔥 Mark as hotspot',
  inspHotspotClear: '🔥 Clear hotspot',
  inspHotspotTitle: 'Highlight this route waypoint as a hotspot on the map',
  resetWpName: '↻ Reset waypoint name',             // inspector — reference snap or clear (placeholder)
  resetWpNameTitle: 'Set name to the nearest reference (airfield / nav-WP), or clear when off-grid (dimmed sequence label)',
  tbResetAllWpNames: '↻ Reset all waypoint names',
  tbResetAllWpNamesTitle: 'Set each name to its nearest reference, or clear when off-grid',
  resetAllWpNamesConfirm: 'Reset all waypoint names to their nearest reference codes, or clear when off-grid (sequence placeholders)?',
  resetLegMarkers: '↻ Reset marker position',       // inspector leg button — reset label offsets
  addReportPoint: '＋ Add identification-point marker',  // inspector leg button — drop a נקי הזדהות oval on the leg
  resetLegMarkersTitle: 'Reset marker position',
  hideLegKite: '⊘ Hide kite',                  // inspector leg button — hide this leg's nav kite
  showLegKite: '◉ Show kite',
  hideLegKiteTitle: "Hide this leg's heading / time / altitude kite, both directions. The leg, its other markers and the flight plan are unchanged — click the leg line to bring the kite back.",
  showLegKiteTitle: "Draw this leg's heading / time / altitude kite again",
  hideLegDrift: '⊘ Hide drift lines',          // inspector leg button — hide this leg's drift cone
  showLegDrift: '◉ Show drift lines',
  hideLegDriftTitle: "Hide this leg's dashed drift lines. The leg, its kite and the flight plan are unchanged — click the leg line to bring them back.",
  showLegDriftTitle: "Draw this leg's dashed drift lines again",
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
  chooseLsaBubble: 'LSA bubble',
  bubbleAltBand: 'Altitude band',
  unitFeet: 'ft',
  bubbleActive: 'Active',
  bubbleWeekendOnly: 'Weekends & holidays only',
  bubbleWeekendTag: 'weekend',
  bubbleOpenAll: 'Open all day',
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
  mosaicResetZoom: 'Reset zoom',
  mosaicResetSize: 'Reset size',
  mosaicPrint: '🖨 Print',
  tbLookAheadTitle: 'Look ahead: 0 = now; +N = N hours from now',
  notamTimeNow: 'Now',
  notamTimeAt: function(h, t) { return '+' + h + 'h · ' + t; },
  notamModalTitle: 'Active NOTAMs',
  notamNone: 'No active NOTAMs.',
  notamUnavailable: 'NOTAMs unavailable.',
  notamUpdated: function(t) { return 'Updated ' + t; },
  notamShowAll: 'Include not yet active',
  notamShowAllTitle: 'Also list NOTAMs that have not started yet, or have already ended',
  notamStartsAt: (t) => 'from ' + t,
  notamEnded: 'ended',
  notamRaw: 'Raw',
  notamDecoded: 'Decoded',
  notamFilterLabel: 'Filter NOTAMs by airfield',
  notamFilterAll: 'All',
  notamSearchPh: 'Search NOTAM text…',
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
  // Shown in the table; fpHeaders stays the CSV export contract. Only the two time
  // columns differ — "13:15" beside a Zulu clock reads as a clock time, not elapsed.
  fpHeadersDisplay: ['#', 'From', 'To', 'Hdg', 'Dist (NM)', 'Speed (kt)', 'Alt (ft)', 'Time (mm:ss)', 'Fuel (gal)', 'Cum. time (mm:ss)', 'Cum. fuel', 'Radial', 'DME', ''],
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
  exportPlanNoLegs: 'Place flight plan — add a route leg first',
  fpVorLabel: 'VOR',
  fpVorRadialEmpty: '—',
  fpDel: '✕',
  fpDelTitle: 'Delete leg',
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
  navLogVor: 'Reference VOR',
  navLogDepFreqs: 'Departure frequencies',
  navLogArrFreqs: 'Arrival frequencies',
  navLogPopupBlocked: 'Allow pop-ups to export the nav log.',
  fpFuel: 'Fuel',
  fpMsa: 'MSA (ft)',
  msaLowTitle: 'Planned altitude is below the minimum safe altitude for this leg',
  profileTitle: 'Vertical profile',
  profileVs: 'V/S (ft/min)',
  profileVsTitle: 'Climb rate used to draw the departure climb on the profile. It does not affect leg times or fuel — those are distance and speed only.',
  fpDirection: 'Direction',
  toc: 'TOC',
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
  // --- ICAO flight plan (FPL) ---
  tbFpl: '✈ Submit flight plan',
  tbFplTitle: 'Build the ICAO flight-plan message for this route and submit it to AIS',
  fplTitle: 'ICAO flight plan',
  fplChange: 'Change',
  fplAdvanced: 'Advanced',
  fplHours: function(h) { return h + (h === 1 ? ' hour' : ' hours'); },
  fplHoursMins: function(h, m) { return h + ' h ' + m + ' min'; },
  fplMinutes: function(m) { return m + ' min'; },
  fplPilotOnly: 'pilot only',
  fplPilotPlus: function(n) { return 'pilot + ' + n; },
  fplWhenRow: function(date, time, eobt) { return 'Departure ' + date + ' at ' + time + ' local (' + eobt + 'Z)'; },
  fplPicRow: function(s) { return 'PIC: ' + s; },
  fplPicMissing: 'Pilot in command — not set yet',
  fplStepDetails: 'Aircraft and pilot',
  fplStepReview: 'Review and file',
  fplKind: 'Flight type',
  fplKindRoutes: 'ICAO message (routes)',
  fplKindCross: 'Cross-country form',
  fplKindCrossNa: 'Every point on this route is published, so it is a routes flight — the cross-country form does not apply.',
  fplKindRoutesNa: 'A point on this route is not a published waypoint, so it cannot be filed as a routes flight — it goes on the cross-country form.',
  fplKindRoutesTip: 'A flight along the published routes: filed as an ICAO message to AIS.',
  fplKindCrossTip: 'A flight off the published routes: filed on the authority form to the FPL desk.',
  fplReg: 'Call sign',
  fplRegHint: 'Three letters is enough — 4X is added',
  fplType: 'Aircraft type',
  // Overrides field 15's declared cruise speed for THIS filing; pre-filled with the
  // route's own speed, so leaving it alone changes nothing.
  fplSpeed: 'Speed (kt)',
  fplTypeOther: 'Other…',
  fplTypeFromList: '\u2630',
  fplTypeFromListTip: 'Back to the list of common types',
  fplWake: 'Turbulence category',
  fplEquip: 'Equipment',
  fplSurv: 'Transponder',
  fplWake_L: 'light, up to 7 t',
  fplWake_M: 'medium, 7 to 136 t',
  fplWake_H: 'heavy, 136 t and above',
  fplWake_J: 'super',
  fplLettersKept: 'Also filed, from your profile:',
  fplLettersNone: 'nothing selected',
  fplEquipS: 'standard (VHF, VOR, ILS)',
  fplEquipG: 'GNSS',
  fplEquipD: 'DME',
  fplEquipF: 'ADF',
  fplEquipO: 'VOR',
  fplEquipV: 'VHF RTF',
  fplEquipY: '8.33 kHz radio',
  fplEquipR: 'PBN approved',
  fplEquipN: 'none',
  fplSurvA: 'transponder Mode A',
  fplSurvC: 'Mode A and C',
  fplSurvS: 'Mode S, altitude and ident',
  fplSurvE: 'Mode S, altitude, ident and ADS-B',
  fplSurvL: 'Mode S with ADS-B and ADS-C',
  fplSurvN: 'none',
  fplWakeTip: 'ICAO wake-turbulence category: L = light (up to 7 t), M = medium, H = heavy.',
  fplEquipTip: 'Radio and navigation equipment. S = standard (VHF, VOR, ILS). Append letters for extras, e.g. SG adds GNSS.',
  fplSurvTip: 'Surveillance equipment. C = transponder Mode A and C, S = Mode S, N = none.',
  fplAisEmailTip: 'The published filing address for the flight type above (AIP א\'-11 §3.ב). Change it only if AIS told you to.',
  fplAdvResetTip: 'Restore the default for this field',
  fplDate: 'Date of flight',
  fplTime: 'Departure (local)',
  fplEndurance: 'Fuel endurance',
  fplPersons: 'Persons on board',
  fplPic: 'Pilot in command',
  fplLatinHint: 'Latin letters — the message cannot carry Hebrew.',
  fplLicense: 'License number',
  fplCell: 'Mobile #',
  fplAisEmail: 'Send flight plan to',
  fplReplyTo: 'Your email (for the reply)',
  fplReplyToTip: 'Required: the approval comes back by mail. You are copied on the message, so it reaches you even when the sending account belongs to someone else.',
  fplFrom: 'From the route',
  fplSpeedRow: function(kt) { return 'Cruise ' + kt + ' kt'; },
  fplEetRow: function(hhmm, human) { return 'Total time ' + human + ' (filed as ' + hhmm + ')'; },
  fplUtcRow: function(dof, eobt) { return 'Filed as DOF/' + dof + ' EOBT ' + eobt + 'Z'; },
  fplAckAip: 'I checked this plan against the AIP and the published NOTAMs',
  fplAckWx: 'I checked the weather forecast',
  // --- Cross-country (מרחב) plan form ---
  xcTitle: 'Cross-country flight plan form',
  xcIntro: 'The authority takes a cross-country plan on its own form (AIP א\'-11 appendix ב\'), not as an ICAO message. What NavAid knows is filled in below — complete the rest, save it as a PDF, then sign and send it.',
  xcReg: 'Registration',
  xcType: 'Aircraft type',
  xcPic: 'Pilot name',
  xcLicense: 'License number',
  xcCell: 'Mobile for queries',
  xcCompany: 'Company',
  xcPurpose: 'Purpose of flight',
  xcDest: 'Final destination',
  xcAltField: 'Alternate field',
  xcEet: 'Estimated flight time (hhmm)',
  xcFuel: 'Fuel time (hhmm)',
  xcIas: 'Speed (kt IAS)',
  xcIasHint: function(tas) { return '— the route is planned at ' + tas + ' kt TAS'; },
  xcPersons: 'Persons on board',
  xcCaaEntry: 'Entry into CAA-controlled airspace',
  xcCaaApproval: 'CAA approval held',
  xcAerialWork: 'Aerial work',
  xcColPoint: 'Point',
  xcColPos: 'Position (WGS-84)',
  xcColLegMin: 'Leg (min)',
  xcColCumMin: 'Cumulative (min)',
  xcRules: 'Flight rules',
  xcApprovals: 'Attached approvals',
  xcCoord: 'Coordinations made by the operator / pilot',
  xcSigPilot: 'Pilot signature: ______________________',
  xcSigBriefer: 'Briefer signature: ______________________',
  xcSigClear: 'Clear',
  xcMissingShared: function(list) { return 'Fill these in before saving: ' + list + '. They are the same details the ICAO plan requires.'; },
  xcLegend: 'Grey values come from the submit dialog — change them there. The boxed fields are this form\u2019s own.',
  xcFromDialogTip: 'Entered in the submit dialog; change it there.',
  xcClearForm: 'Clear form',
  xcClearFormTip: 'Clears what you typed on this form and the signatures. The values from the submit dialog and the route table stay.',
  xcClearFormConfirm: 'Clear the fields you filled in on this form, and the signatures?',
  xcMailDesk: '✉ Mail to the FPL desk',
  xcMailDeskTip: 'Opens your mail app addressed to the FPL desk, with you copied in. Attach the PDF you saved — a page cannot attach it for you.',
  xcMailBody: 'Cross-country flight plan attached (AIP א׳-11 appendix ב׳ form).',
  xcSavePdf: '🖫 Print / Save as PDF',
  xcSavePdfTip: 'Opens the print dialog — choose "Save as PDF" as the destination to get a file to attach, or a printer to sign on paper.',
  xcOpenForm: 'Fill the cross-country form',
  fplNoMailApp: 'Your mail app should have opened with the plan. If nothing happened, this device has no mail app set up — press Copy and send the plan yourself to:',
  fplAckRequired: 'Confirm the checks above before submitting the plan.',
  fplAckLanding: function(site) { return 'I coordinated the landing with the operator of ' + site; },
  fplAckTower: function(site) { return 'I coordinated the landing with ' + site + ' tower, and will keep continuous radio contact'; },
  // Shown only when the filed speed disagrees with some leg's actual speed -- an
  // override away from a uniform route, or a route that was already flown unevenly.
  fplAckSpeed: function(kt) { return 'The filed speed (' + kt + ' kt) does not match every leg’s actual speed'; },
  fplCustomRecipient: 'Not the published AIS address — this plan will be sent to:',
  fplCopy: 'Copy',
  fplCopied: 'Flight plan copied.',
  fplOpenMail: 'Submit flight plan',
  fplNext: 'Continue',
  fplBack: 'Back',
  fplMailNote: 'Opens your mail app with the plan ready to send. NavAid does not send it — you do, and the approval comes back to you.',
  fplWindowNote: 'Valid from 30 min before the filed time until 60 min after (domestic VFR). Past that, file again.',
  warnFplCrossForm: 'A cross-country plan is filed on the authority\u2019s own form (AIP א\'-11 appendix ב\'), not as an ICAO message. NavAid cannot produce that form — copy this as a reference and file the form itself.',
  warnFplDepNotAerodrome: 'The route does not start at a known airfield — it is filed as ZZZZ with the point named in field 18, and will probably be declined. A plan is normally filed field to field.',
  warnFplDestNotAerodrome: 'The route does not end at a known airfield — it is filed as ZZZZ with the point named in field 18, and will probably be declined. A plan is normally filed field to field.',
  warnFplEarly: 'Too early to file: a departure at or before 17:00 is filed from 18:00 the day before, a later one on the day of the flight.',
  // Pointer to a frequency NOTAM on an airfield. Names the NOTAM, never its frequency:
  // the published value stays what the inspector shows and the pilot reads the NOTAM.
  freqNotamNote: (ids) => 'Frequency NOTAM: ' + (Array.isArray(ids) ? ids.join(', ') : ids),
  // Plain-language preamble above the ICAO block in a filed mail. Follows the UI
  // language; the (FPL-...) block itself is never translated.
  fplMailTitle: 'Flight plan on the low-level transit routes',
  fplMailDeparture: (place, t) => 'Departure from ' + place + ' at ' + t + ' local time',
  fplMailRoute: (list) => 'Route: ' + list,
  fplMailArrival: (place, t) => 'Landing at ' + place + ' at ' + t,
  warnFplClosedCorridor: 'A corridor on this route may be closed or time-gated at the chosen departure time (secondary source) — no open alternative was published, so it is filed anyway. Verify with the NOTAMs.',
  warnFplLead: 'Less than 60 minutes to departure — a routes plan is filed at least 60 min ahead, or phoned in.',
  warnFplMixedSpeed: 'The legs are not all at one speed; the first leg\'s speed is filed as cruise TAS.',
  errFplNeedRoute: 'Draw a route first — a flight plan needs a departure and a destination.',
  errFplDepUnnamed: 'The first waypoint has no code to file as the departure.',
  errFplDestUnnamed: 'The last waypoint has no code to file as the destination.',
  errFplBadPoints: 'Some waypoints have no reporting-point code and cannot go in the route field.',
  errFplNoPoints: 'No reporting points between the aerodromes to file as the route.',
  errFplNoSpeed: 'No cruising speed on the first leg.',
  errFplNoEet: 'The route has no total time — check the leg speeds.',
  errFplBadAddress: 'That filing address is not a valid email address.',
  errFplReplyToRequired: 'Enter your own email — the approval comes back to it.',
  errFplReplyToInvalid: 'That email address is not valid.',
  errFplProfileList: function(list) { return 'Still needed: ' + list + '.'; },
  // Used when the list of fields is unavailable -- a message must never be a function.
  errFplAtcApprovalLegPlain: 'A leg of this route may only be flown when control clears it '
    + 'in real time, so it cannot be filed as a planned route.',
  errFplAtcApprovalLeg: function(names) {
    const list = Array.isArray(names) ? names : [names];
    return 'This route is flown down ' + list.join(', ') + ', which control opens only in '
      + 'real time \u2014 a plan naming it is not accepted. Route around it, or keep the leg '
      + 'and request it in the air instead of filing it.';
  },
  errFplMidAirfieldPlain: 'This route lands at an airfield on the way, so it is not a single '
    + 'flight plan: file it in legs.',
  errFplMidAirfield: function(names) {
    // Every field on the way is named, but the first leg goes to the FIRST of them -- and
    // three fields on the way are three plans, so the message states no count.
    const list = Array.isArray(names) ? names : [names];
    return 'This route lands at ' + list.join(', ') + ' on the way, so it is not a single '
      + 'flight plan \u2014 file the first leg to ' + list[0] + ', then a plan onward from there.';
  },
  errFplJoinGapPlain: 'The return route does not start where this route ends, so the two '
    + 'are not one flight.',
  errFplJoinGap: function(o) {
    const from = (o && o.from) || '?', to = (o && o.to) || '?';
    return 'This route ends at ' + from + ' but the return route starts at ' + to
      + ' \u2014 they are not one flight. Pick the return that turns back from ' + from
      + ', or file the two separately.';
  },
  errFplReturnNeedRoute: 'The chosen return route has fewer than two waypoints.',
  fplReturnRoute: 'Return route',
  fplReturnNone: '\u2014 none (one-way plan) \u2014',
  fplExpandPoints: 'Name every reporting point on the way',
  fplExpandGapShort: '(no published chain for: ',
  warnFplExpandGapPlain: 'Some stretches have no published chain in the route data, so '
    + 'their reporting points are not named.',
  warnFplExpandGap: function(o) {
    const pairs = (o && o.pairs) || [];
    return 'No published chain for ' + pairs.join(', ') + ' \u2014 the plan names the points '
      + 'you drew for those stretches, not every reporting point on the way.';
  },
  fplReturnAtFieldHint: 'This route lands at a field, so it is one plan on its own \u2014 a '
    + 'return from there is a separate plan.',
  fplReturnRouteTip: 'For an out-and-back: the saved route flown home. It must start where '
    + 'this route ends. Both routes keep their own nav log and exports \u2014 they are joined '
    + 'only in the filed plan.',
  errFplEobt: 'Enter a valid date and departure time.',
  errFplEndurance: 'Pick how much fuel is on board.',
  errFplLatinOnly: 'Write the pilot name and license in Latin letters — the flight-plan message cannot carry Hebrew.',
  errFplProfile: 'Fill in the aircraft and pilot details first.',
  flyConfirm: 'Fly the route in Google Earth Pro (desktop).\n\nPress OK to save the tour file (.kml), then open it in Google Earth — the “Fly the route” tour appears under Places; press play to fly above the terrain.\n\nNo Google Earth? Free desktop app: google.com/earth/versions',
  geWebConfirm: 'Open the route in Google Earth Web (browser).\n\nThe KML file will also be downloaded so you can drag it into the web page to see the full route.',
  chooseGeMode: 'Open in',
  geModeApp: 'Google Earth Pro (KML)',
  geModeWeb: 'Google Earth Web',
  geTourSpeed: 'Tour speed',
  geTourSpeedOpt: function(m) { return m === 1 ? '1x (normal)' : m + 'x'; },
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
  assistantProviderSwitched: 'Using',
  assistantNoKey: 'Add an API key in settings to start chatting.',
  assistantError: 'Assistant error',
  assistantConfirmChange: 'The assistant wants to change your route:',
  assistantUndoHint: 'You can undo it.',
  assistantTaintedWarning: 'Note: this conversation has read text from outside NavAid (NOTAMs or an imported route). Approve only if this is the change you asked for.',
  assistantMutTemplate: 'Replace the route with template',
  assistantMutCorridor: 'Replace the route with a corridor route',
  assistantMutSave: 'Save the current route to the library as',
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
  followOnToast: 'Following the aircraft',
  followOffToast: 'Map stays put',
  orientHeadingToast: 'Heading up',
  orientNorthToast: 'North up',
  voiceOnToast: 'Audio alerts on',
  voiceOffToast: 'Audio alerts off',
  voiceOnTitle: 'Alerts are spoken — tap to silence them',
  voiceOffTitle: 'Alerts are silent — tap to have them spoken',
  orientNorthUp: 'North up — tap to hold your heading up',
  orientRotated: 'Map rotated — tap for north up',
  orientHeadingUp: 'Heading up — tap for north up',
  // The edit lock: nothing on the route can be dragged while it is on. Wording says what the
  // chart is doing, then what a tap changes, like the other in-flight buttons.
  editLockOn: 'Route is locked — tap to allow moving points and labels',
  editLockOff: 'Points and labels can be dragged — tap to lock the route',
  editLockAuto: 'Route is locked while a position is showing — tap to allow moving it',
  editLockBlockedToast: 'Route is locked — unlock it to edit',
  editLockOnToast: 'Route locked',
  editLockOffToast: 'Route unlocked',
  followLockOn: 'Following your aircraft — tap to leave the map where you put it',
  followLockOff: 'Map stays where you put it — tap to follow your aircraft',
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
  tbDefaultSpeedLabel: 'Default speed (kt)',
  tbDefaultSpeedTitle: 'Speed given to a new leg when there is no earlier leg to copy from',
  tbLayerTitle: 'Base map layer',
  tbGrpOverlays: 'Overlays',          // View sub-group headings (layout A)
  tbGrpRouteInfo: 'Route info',
  tbGrpSafety: 'Safety',
  tbGrpTimed: 'NOTAMs & wind',
  tbGrpWxCharts: 'Weather charts',
  tbGrpTerrain: 'Terrain',
  tbGrpAirspace: 'Airspace',
  tbGrpPlates: 'Airfield plates',
  tbPlateOpacity: 'Plate opacity',
  tbPlateOpacityTitle: 'Adjust the airfield-plate overlay opacity (shared by all plate layers)',
  tbPlateOpacityReset: 'Reset opacity',
  tbPlateAirfield: 'Show plates for',
  tbPlateAirfieldTitle: 'Limit airfield-plate overlays to one airfield, so neighbouring fields’ plates don’t overlap',
  tbPlateAirfieldAll: 'All airfields',
  tbPlateAirfieldAuto: 'Auto (route start + end)',
  tbDisabledByTurn: 'Not available on a route with a turning point — it already flies out and back, so there is nothing to reverse or mirror.',
  reverseNoRoute: 'No route to reverse — add at least two waypoints.',
  reverseRouteWarn: '\u26a0 Reversed — might not match allowed routes. Check the chart: published corridors can be one-way.',
  tbReverse: '⇄ Reverse route (R)',
  tbReverseTitle: 'Reverse route order',
  tbUndo: '↶ Undo (Ctrl-Z)',
  tbUndoTitle: 'Undo the last edit, move or delete',
  tbClear: '🗑 Clear map (C)',
  tbClearTitle: 'Remove all waypoints and notes',
  tbExportMenu: '⬇ Export',
  tbExport: '⬇ JSON — NavAid route file',
  tbTrackExport: '⬇ JSON — recorded GPS track',
  tbTrackExportTitle: 'Export the currently shown GPS track as JSON (show a track from Saved routes first)',
  // Referenced by ui.js/gps.js but previously undefined in either table, so they
  // fell back to their English literal even in a Hebrew session.
  errTrackExportFailed: 'That track could not be read from your saved routes.',
  trackExportConfirm: function(name) { return 'Export the track "' + name + '"?'; },
  tbTrackExportNoTrack: 'No GPS track shown — open Saved routes and click Show on a track first.',
  resetToDefault: 'Reset to default',
  tbExportTitle: 'Export route (JSON / GPX / PLN / FDR)',
  tbImport: '⬆ Import JSON/GPX/PLN',
  tbImportTitle: 'Import route from JSON or GPX file',
  tbShare: '🔗 Share',
  tbShareTitle: 'Copy a shareable link to this route to the clipboard',
  shareCopied: 'Route link copied to clipboard',
  errShareTooLong: 'Route is too long for a share link (max 64 waypoints). Export as JSON and send the file instead.',
  tbFit: '⌖ Fit to screen (F)',
  tbFitTitle: 'Fit the selected page to view, or fit the route when no page is selected (F)',
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
  tbAutoRoute: 'Auto-route through waypoints',
  tbAutoRouteTitle: 'Adding a point fills in the published reporting points between it and the previous one (CVFR). Closed routes are avoided.',
  tbShowDrift: 'Show drift lines',
  tbShowDriftTitle: 'Show 10-degree drift reference lines at each leg end',
  tbShowAirfields: 'Show/pin airfields',
  tbShowAirfieldsTitle: 'Overlay published Israeli airfields (BYOP source)',
  tbShowCircuit: 'Show circuit patterns',
  tbShowCircuitTitle: 'Overlay georeferenced circuit/VFR plates for Israeli airfields',
  tbCircuitOpacity: 'Circuit opacity',
  tbCircuitOpacityTitle: 'Adjust circuit overlay opacity',
  tbCircuitOpacityReset: 'Reset opacity',
  tbShowTraining: 'Show training areas',
  tbShowTrainingTitle: 'Overlay georeferenced training-area plates for Israeli airfields',
  tbTrainingOpacity: 'Training opacity',
  tbTrainingOpacityTitle: 'Adjust training-area overlay opacity',
  tbTrainingOpacityReset: 'Reset opacity',
  tbShowCvfr: 'Show CVFR entry/exit routes',
  tbShowCvfrTitle: 'Overlay georeferenced CVFR route plates for Israeli airfields',
  tbCvfrOpacity: 'CVFR opacity',
  tbCvfrOpacityTitle: 'Adjust CVFR route overlay opacity',
  tbCvfrOpacityReset: 'Reset opacity',
  tbShowHeli: 'Show helicopter entry/exit routes',
  tbShowHeliTitle: 'Overlay georeferenced helicopter entry/exit route plates for Israeli airfields',
  tbHeliOpacity: 'Helicopter opacity',
  tbHeliOpacityTitle: 'Adjust helicopter route overlay opacity',
  tbHeliOpacityReset: 'Reset opacity',
  tbShowCommfail: 'Show comm-failure joining',
  tbShowCommfailTitle: 'Overlay georeferenced radio comm-failure entry plates for Israeli airfields',
  tbCommfailOpacity: 'Comm-failure opacity',
  tbCommfailOpacityTitle: 'Adjust comm-failure entry overlay opacity',
  tbCommfailOpacityReset: 'Reset opacity',
  tbAlignOverlays: 'Align overlays',
  tbAlignOverlaysTitle: 'Nudge, scale or rotate a shown chart overlay by eye, then copy the corrected coordinates',
  ovAlignTitle: 'Align overlays',
  ovAlignPick: 'Tap an overlay on the map to select it',
  ovAlignHint: 'Drag centre = move · corners = scale · top dot = rotate',
  ovAlignResetSel: 'Reset this',
  ovAlignResetAll: 'Reset all',
  ovAlignCopy: 'Copy coords',
  ovAlignDone: 'Done',
  ovAlignCopied: 'Overlay coordinates copied to clipboard',
  ovAlignResetAllConfirm: 'Clear all local overlay alignments?',
  tbForceSnap: 'Snap to nearest point',
  tbForceSnapTitle: 'Always snap clicks to the nearest airfield or nav-waypoint (otherwise: 18 px radius)',
  tbShowCommChange: 'Show/Add Freq Changes',
  tbShowCommChangeTitle: 'Mark CVFR reporting points where pilots must change ATC frequency',
  legendTitle: 'Legend',
  legendAirfield: 'Airfield',
  legendWaypoint: 'Waypoint',
  legendVor: 'VOR station',
  tbMoreLinks: 'More links (repo, wiki, issues, about, privacy, terms)',
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
  profileAssumedNote: function(ft) { return 'No altitude set — drawn at ' + ft + ' ft'; },
  altitudeUnsetShort: '—',                          // map kite placeholder — see kiteAltitudeLabel
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
  overlayLoading: 'Loading charts…',
  exitConfirm: 'Close NavAid?',
  plateLoading: 'Loading…',
  loadingCharts: 'Loading charts…',
  plateLoadError: 'Failed to load chart.',
  chartsBack: '← All airfields',
  chartsFilterPlaceholder: 'Search airfield',
  chartsOnRoute: 'On your route',
  chartsAllFields: 'All airfields',
  chartsAllPlates: 'All',
  plateAmendedOn: (d) => 'Amended ' + d,
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
  tbTransparency: 'Waypoint opacity',
  tbTransparencyTitle: 'Opacity of the waypoint discs and their label backgrounds',
  tbLegArrowAlpha: 'Leg arrow opacity',
  tbLegArrowAlphaTitle: 'Fill opacity of the leg / cumulative arrows and notes — on screen and in print/export alike',
  tbLegArrowColor: 'Leg arrow color',
  tbLegArrowColorTitle: 'Fill color of the leg arrows — applies to print/export too',
  tbWaypointColor: 'Waypoint color',
  tbWaypointColorTitle: 'Fill color of the waypoint discs and their label backgrounds — applies to print/export too',
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
  tbPageA4x2Title: 'Two A4 pages (A3 area split in half, at A3 scale) — for when A3 isn’t available',
  a4x2TileLabel: function (n, total, side, other) {
    return 'PAGE ' + n + ' OF ' + total + ' — ' + side + ' · tape to page ' + other;
  },
  a4x2SideLeft: 'LEFT',
  a4x2SideRight: 'RIGHT',
  a4x2SideTop: 'TOP',
  a4x2SideBottom: 'BOTTOM',
  tbPrintPageSize: 'Page size',
  tbOrientTitle: 'Orientation — click to toggle landscape / portrait',
  modalCloseTitle: 'Close',
  printClipWarn: '⚠ The route runs past the page — printing would cut it off.',
  printClipWarnLabels: '⚠ The route fits, but a label or marker hangs past the page — drag it inside, or fit the page.',
  printFitPage: '⤢ Fit page to route',
  printFitPageTitle: 'Pick the smallest page size and orientation that holds the whole route, and centre it',
  printNoFit: '⚠ No page size holds this route — split it or print more than one page.',
  tbPrint: '🖨 Print',
  tbPrintTitle: 'Print or save the framed map + route as a PNG',
  tbMagnifier: '🔍 Magnifying glass (M)',
  tbMagnifierTitle: 'Magnifying glass (M) — zoomed view at cursor; +/− adjust loupe zoom while open',
  // Footer-button labels carry NO icon prefix: the button's own
  // .footer-link-icon span renders the glyph, so an emoji in the label
  // showed a double icon in the mobile footer menu.
  // Short enough that the icon and both GPS buttons keep one line inside the closed menu card
  // on a phone -- 'Start recording'/'Stop recording' pushed the row to two lines once labels
  // stopped being cut short. The full sentence still lives in the title/aria strings.
  tbGpsRecord: 'Record',
  tbGpsRecordTitle: 'Start recording your flown track from the device GPS; Stop saves it to your routes',
  tbGpsStop: 'Stop',
  tbGpsLive: 'Location',
  tbGpsLiveTitle: 'Show your live position on the map (device GPS, no recording)',
  tbGpsLiveStop: 'Hide',
  // ATIS reminder: fires once, a set time out from the destination.
  watchAlertAtisTitle: 'ATIS',
  // Short on purpose: a notification is read at a glance in the cockpit, and the minutes were
  // the part nobody needed -- the alert only fires when it is time.
  watchAlertAtisBody: function (field, freq) { return field + ' ATIS ' + freq; },
  // No "for": the alert names the station and its frequency, and the extra word is one more
  // thing to listen past in a cockpit.
  speakAlertAtis: function (field, freqDigits) {
    return 'A T I S, ' + field + ', ' + freqDigits;
  },
  atisMarkerLabel: 'ATIS',
  gpsUnsupported: 'GPS is not available in this browser.',
  // Prefixes an age in seconds: "GPS fix 47s" — the fix is that old, not that recent.
  gpsFixStale: 'GPS fix',
  wpLabel: 'WP',
  gpsNoTrack: 'No track recorded.',
  gpsLiveNotifTitle: 'NavAid location',
  gpsLiveNotifText: 'Showing your position on the map',
  gpsRecNotifTitle: 'NavAid GPS recording',
  gpsRecNotifText: 'Recording your track — tap to return',
  gpsError: 'GPS error: ',
  // Local device notifications for the watch-alert feature (gpsCheckLegAlerts in gps.js) --
  // mirrored to a paired Garmin (or any) watch by the OS's own notification mirroring, same
  // channel SMS/WhatsApp use. Not shown in-app; only ever read from a notification tray.
  // Bare "next leg" -- no "NavAid —" prefix -- watch notification tiles already show the
  // sending app's icon/name, so the prefix only ate characters off a tiny watch screen.
  watchAlertLegTitle: 'Next leg',
  // alt/hdg/time describe the NEXT leg -- the one starting at `wp`, not the one ending
  // there -- so the alert doubles as prep for the turn, explicitly labelled as such (not
  // just implied by context). All three come from the PLAN (planned altitude, planned
  // course + planned speed for time) -- none reflect live drift, same "route plan is the
  // only source of truth" rule the ETA trigger itself already follows. Any of the three may
  // be null (last leg: no next leg at all; no altitude entered; no planned speed to time
  // it with) and is simply left out, never guessed.
  // `freq` is set only when this waypoint changes frequency -- see the comment at the call
  // site for why that rides here rather than in an alert of its own.
  watchAlertLegBody: function(wp, alt, hdg, time, freq) {
    const parts = [];
    if (alt != null) parts.push(alt + ' ft');
    if (hdg != null) parts.push(hdg + '°');
    if (time != null) parts.push(time);
    return 'Approaching ' + wp + (freq ? ' ' + freq : '') +
      (parts.length ? ' — next leg: ' + parts.join(', ') : '');
  },
  // The overhead-the-waypoint moment -- CVFR radio phraseology's own "TOP <point>" call.
  watchAlertTopTitle: 'TOP',
  watchAlertTopBody: 'TOP',
  watchAlertAltTitle: 'Altitude',
  watchAlertAltBody: function(actual, planned) {
    return actual + ' ft — planned ' + planned + ' ft';
  },
  // Outside every leg cone: the app no longer knows where the aircraft is relative to the
  // route. Saying only that is useless to someone who already knows they are lost, so the
  // alert carries a course back. `turn` is set only when the target is NOT already ahead of
  // the nose -- when it is, the heading alone is the whole instruction.
  watchAlertOffRouteTitle: 'Off route',
  watchAlertOffRouteBody: function(wp, hdg, nm, turn) {
    return 'Direct ' + wp + (turn ? ', turn ' + turn : '') + ', heading ' + hdg + '\u00b0, ' + nm + ' NM';
  },
  speakAlertOffRoute: function(wp, hdgDigits, nm, turn) {
    return 'Off route. Direct ' + wp + '.' + (turn ? ' Turn ' + turn + '.' : '') +
      ' Heading ' + hdgDigits + ', ' + nm + ' miles.';
  },
  watchAlertDriftTitle: 'Off course',
  // Before the leg's midpoint: retain the track error for context, then give the actual
  // magnetic intercept heading. The pilot should not have to apply a relative correction.
  watchAlertDriftBody: function(driftOut, heading, wp) {
    return driftOut + '° off course, heading ' + heading + '° to intercept toward ' + wp;
  },
  // Past the midpoint: rejoining the original line buys nothing this close to the
  // waypoint, so report the actual magnetic heading direct to it.
  watchAlertDriftDirectBody: function(heading, wp) {
    return 'Heading ' + heading + '° direct ' + wp;
  },
  // Spoken forms of the alerts above. Deliberately NOT the notification bodies: those are
  // written for a watch face -- dense, and full of symbols (-, °, 0:12:30) whose spoken
  // rendering is entirely up to the device's TTS engine. These spell the units out, take
  // the heading already split into digits (see gpsSpokenDigits), and give a time in whole
  // minutes. A missing field is left out here exactly as it is left out of the
  // notification: never guessed.
  speakAlertLeg: function(wp, alt, hdgDigits, hms, freqDigits) {
    let s = 'Approaching ' + wp + '.';
    // First, before the next leg's numbers: it is the one thing here that has to be acted
    // on before the waypoint rather than after it.
    if (freqDigits) s += ' Frequency ' + freqDigits + '.';
    const parts = [];
    if (alt != null) parts.push(alt + ' feet');
    if (hdgDigits != null) parts.push('heading ' + hdgDigits);
    // `hms` is the {h,m,s} of the very string the kite shows, not a rounded minute count:
    // the spoken time and the drawn time must never be two different numbers.
    if (hms) {
      const t = [];
      if (hms.h) t.push(hms.h + (hms.h === 1 ? ' hour' : ' hours'));
      if (hms.m) t.push(hms.m + (hms.m === 1 ? ' minute' : ' minutes'));
      // Spoken in full. Dropping the word (just "5 minutes 15") was tried and sounds wrong
      // read aloud -- a bare number after a unit lands as an unfinished sentence.
      if (hms.s) t.push(hms.s + ' seconds');
      if (t.length) parts.push(t.join(' '));
    }
    if (parts.length) s += ' Next leg ' + parts.join(', ') + '.';
    return s;
  },
  speakAlertTop: function() { return 'Top.'; },
  // Shortly before a waypoint that changes frequency. Either half may be missing -- a
  // callout can name a station with no frequency, or a frequency with no station -- and
  // whichever is present is still worth hearing.
  spokenDecimal: 'decimal',
  speakAlertAlt: function(actual, planned) {
    return 'Altitude ' + actual + ' feet, planned ' + planned + '.';
  },
  speakAlertDrift: function(driftOut, headingDigits, wp) {
    return driftOut + ' degrees off course. Fly heading ' + headingDigits + ' to intercept toward ' + wp + '.';
  },
  speakAlertDriftDirect: function(headingDigits, wp) {
    return 'Fly heading ' + headingDigits + ' direct ' + wp + '.';
  },
  tbVoiceAlerts: '🔊 Speak alerts',
  tbVoiceAlertsTitle: 'Say the in-flight alerts out loud (leg, TOP, altitude, off course). Also works in the browser for testing, but browser speech stops when the tab is in the background — the app is the reliable one in flight.',
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
  offlineDeleteTitle: 'Remove the downloaded map tiles from this device — the app keeps working online',
  offlineDeleteConfirm: 'Delete the offline maps?',
  offlineCancel: '✕ Cancel — ',
  offlineCancelled: 'cancelled',
  offlineDone: 'saved ',
  offlineTilesCount: 'offline tiles: ',
  tbLegDir: '🧭 Route direction',
  tbLegDirTitle: 'Which route direction to display. The other half\u2019s route line, waypoints, kites, drift and time marks, wind arrows, route-bound notes, totals and plan rows are hidden.',
  tbLegDirBoth: 'Both directions',
  tbLegDirOut: 'Outbound only',
  tbLegDirBack: 'Return only',
  tbLegDirNoTurn: 'This route does not double back and no turning point is marked, so there is no outbound and return to separate. Mark one on a waypoint to enable this.',
  inspTurnSet: '\u21bb Mark as turning point',
  inspTurnClear: '\u21bb Clear turning point',
  inspTurnTitle: 'Where this route turns for home. A loop repeats no waypoint, so nothing in the geometry says where the far end is — mark it here and the leg-direction filter can split outbound from return.',
  tbSimConnected: 'Simulator connected — showing its aircraft on the map',
  tbSecSim: 'Simulator',   // footer button + sim modal title; the footer icon span draws the plane
  tbSimConnect: 'Connect to simulator',
  tbSimDiscover: 'Find X-Plane',
  tbSimDiscoverTitle: 'Find X-Plane and its NavAid bridge on this local network',
  tbSimDiscovering: 'Searching the local network…',
  tbSimDiscovered: 'X-Plane found on {host}',
  tbSimDiscoverNone: 'No X-Plane bridge found. Start the bridge on the X-Plane computer or enter its URL manually.',
  tbSimDiscoverError: 'Could not search the local network. Check Local Network permission and Wi-Fi.',
  tbSimDisconnect: 'Disconnect from simulator',
  tbSimConnectTitle: 'Poll a local SimConnect bridge (e.g. Little NavMap) for live aircraft position',
  tbSimIpLabel: 'Bridge URL',
  tbSimIpTitle: 'URL of the SimConnect bridge. HTTP works in the native iOS/Android app, for desktop loopback, or when the NavAid page is also HTTP; otherwise use HTTPS.',
  tbSimHelpDesktop: 'Desktop: localhost means this computer. Use it when the bridge runs here. Other devices normally use an HTTPS bridge or tunnel.',
  tbSimHelpIpad: 'iPad browser: localhost means this iPad, not the simulator PC. Use an HTTPS bridge or tunnel URL.',
  tbSimHelpIpadHttp: 'iPad browser over HTTP: localhost still means this iPad. You may use the Mac’s HTTP LAN address (for example, http://192.168.1.20:2020) if the bridge allows CORS.',
  tbSimHelpNative: 'Native app: use Find X-Plane, or enter the simulator computer’s HTTP or HTTPS LAN address. localhost means this device.',
  tbSimHelpNativeOther: 'Native app: use an HTTPS bridge or tunnel. Local HTTP transport is available in the iOS and Android builds.',
  tbSimUrlInvalid: '⚠ Enter a complete HTTP or HTTPS bridge URL.',
  tbSimLocalhostIpad: '⚠ localhost means this iPad. Enter the simulator PC’s HTTPS bridge or tunnel URL.',
  tbSimLocalhostNative: '⚠ localhost means this device. Enter the simulator computer’s LAN bridge URL.',
  tbSimMixedContent: '⚠ Blocked: NavAid uses HTTPS but this bridge uses HTTP. Enter an HTTPS bridge or tunnel URL.',
  tbSimNativeHttp: '⚠ This native build cannot use a local HTTP bridge. Enter an HTTPS bridge or tunnel URL.',
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
  shortcutFitRoute: 'Fit page to view when selected; otherwise fit route',
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
  exportShowCumTime: 'Print cumulative time',
  exportNoPageWarn: 'No page size selected — exported image ratio may not match a print page.',
  exportLayer: 'Layer',
  exportBtn: 'Export',
  printBtn: '🖨 Print',
  printBtnTitle: 'Open the print dialog at true physical size (A4/A3 1:250,000)',
  errPopupBlocked: 'Allow pop-ups for this site to open the print view.',
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
// Which direction's leg kites to draw: 'both' | 'out' | 'back'. An out-and-back route
// draws a kite for each direction, and near the turnaround they land on top of each
// other -- readable on screen where you can zoom, unusable on a printed map. This filters
// the KITES only; the route line itself is never hidden, so the printed track stays whole.
var legDirFilter = 'both';
var showMidLeg = false;
var showCumTime = true;     // cumulative-time kites — on by default
// Route layout is locked against dragging: waypoints, kites, notes and comm callouts all stay
// where they are. Restored per device from navaid.editLocked (ui.js), and separate from the
// automatic lock that applies whenever a fix is driving the map (dragLockedNow in interact.js).
var editLocked = false;
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
// Auto-route on the MAP: adding a reporting point extends the route along the published
// corridor between it and the previous point, instead of a straight line. CVFR only for
// now (the maintainer's scope); filing-time expansion stays independent of this.
// Ships OFF: it changes what the pilot's own route CONTAINS, not how it is drawn, so it
// is opt-in from View/Set rather than something a route inherits by surprise.
var autoRouteCorridors = false;
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
                              // (the route graph's `callSigns` dictionary).
var legAltitudeMap = null; // null = not loaded yet (or last fetch failed —
                                // retry on next call); {} or populated =
                                // the route graph's segments keyed as
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
// Explicit nav-data source ('cvfr' | 'lsa' | 'heli'), or null to follow the base layer.
// Drives waypoints, comm-change AND leg altitudes together -- they are one chart's data,
// so mixing (heli waypoints with CVFR altitudes) would be wrong.
var navDataPrefix = null;
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
var yellowAlpha = 0.5;    // opacity of waypoint label backgrounds (Label-opacity slider, default 50%)
// Kite + note fill opacity is not a Display slider — it's the gist-overridable
// tune key `kiteNoteAlpha` (see tuningDefaults), read via tune() in draw.js.
var wpSize = 1;             // waypoint name / number text size scale
var legArrowSize = 1;       // leg arrow (rectangle+triangle) size scale
var legLineWidth = 0.5;     // leg route line width scale (0.5 ≈ 1.75 px of the 3.5 px route width)
var driftLineWidth = 1;     // drift reference line width scale (1 = default 1.5 px)

function legZoomScale() {   // zoom + legArrowSize → pixel multiplier for offsets/sizes
  // Capped as well as floored. The raw curve doubles every zoom level (8x at the
  // z15 maximum), so zooming in to READ the chart was the moment a single kite grew
  // to cover a third of the screen and bury the very detail being inspected. The
  // Display "Leg arrow size" slider still multiplies on top, so anyone who wants
  // bigger labels can still have them.
  const raw = Math.max(0.35, Math.pow(2, map.getZoom() - 12));
  return Math.min(_legLabelMaxScale(), raw) * legArrowSize;
}
const _legLabelMaxScale = () => {
  const v = (typeof tune === 'function') ? Number(tune('legLabelMaxScale')) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 2;
};
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
    // `raw` can be the literal "null" from a build that persisted a cleared input; that is
    // truthy, so it used to load as `aircraft = null` forever. Accept only a usable profile.
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && Number(parsed.gph) > 0) aircraft = parsed;
  } catch (e) { /* storage unavailable */ }
}

function saveAircraft() {
  try { localStorage.setItem('navaid.aircraft', JSON.stringify(aircraft)); } catch (e) {}
}

// Route totals are visible before the Flight plan modal is ever opened, so the
// persisted performance profile must be available to the first draw.
loadAircraft();

const DEFAULT_LABEL_FILL_COLOR = '#fff6aa';

// Tinted fill from any "#rrggbb" hex. Alpha defaults to yellowAlpha (the
// waypoint label-opacity slider); kite fills and note backgrounds pass
// tune('kiteNoteAlpha') so their opacity is gist-tunable, not a Display slider.
function tintFill(hex, alpha) {
  const a = (typeof alpha === 'number') ? alpha : yellowAlpha;
  let h = (hex || DEFAULT_LABEL_FILL_COLOR).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) h = DEFAULT_LABEL_FILL_COLOR.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
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
// Seed speed for a leg with nothing to inherit from. Gistable, rather than a literal
// 90 buried in newLeg().
// Height the vertical profile DRAWS a leg with no altitude at. Never used for timing
// (see routeProfile: such a leg is flown level), so changing it moves the strip's
// baseline only. Gistable rather than a literal 2000 scattered through the code.
const _unknownProfileAltFt = () => {
  const v = (typeof tune === 'function') ? Number(tune('unknownProfileAltFt')) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 2000;
};

// Google Earth tour pacing. The exported KML carries fixed <gx:duration> values —
// Earth has no playback-speed control — so the whole pace is decided here at export
// time. The base pace is "seconds of tour per minute of flight" (4 => ~15x real
// time) with per-leg clamps; the user's speed multiplier then scales every duration
// uniformly, so a leg's share of the tour stays proportional at any speed.
const _tuneNum = (key, fallback) => {
  const v = (typeof tune === 'function') ? Number(tune(key)) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const _kmlTourSecPerFlightMin = () => _tuneNum('kmlTourSecPerFlightMin', 4);
const _kmlTourLegMinSec = () => _tuneNum('kmlTourLegMinSec', 4);
const _kmlTourLegMaxSec = () => _tuneNum('kmlTourLegMaxSec', 45);
const _kmlTourMinSegSec = () => _tuneNum('kmlTourMinSegSec', 0.2);
// A leg with no altitude used to export as absolute 0 m — sea level, i.e. the
// camera underground over any terrain. It is flown at this height instead:
// above the departure field's elevation when the leg starts from one, else
// above the terrain directly below (Earth resolves that from relativeToGround).
const _kmlUnsetLegAglFt = () => _tuneNum('kmlUnsetLegAglFt', 800);

// Playback speed multiplier picked in the Google Earth dialog. Higher = faster
// flight, i.e. shorter durations, hence the reciprocal at the call site.
const GE_TOUR_SPEED_KEY = 'navaid.geTourSpeed';
const GE_TOUR_SPEEDS = [0.5, 1, 2, 4];
function geTourSpeed() {
  let v = NaN;
  try { v = Number(localStorage.getItem(GE_TOUR_SPEED_KEY)); } catch (e) { /* storage off */ }
  return GE_TOUR_SPEEDS.indexOf(v) !== -1 ? v : 1;
}
function setGeTourSpeed(multiplier) {
  const v = GE_TOUR_SPEEDS.indexOf(Number(multiplier)) !== -1 ? Number(multiplier) : 1;
  try {
    if (v === 1) localStorage.removeItem(GE_TOUR_SPEED_KEY);
    else localStorage.setItem(GE_TOUR_SPEED_KEY, String(v));
  } catch (e) { /* storage off */ }
  return v;
}

// What altitude does a leg FLY at, for an exporter that must write a number?
// Every export used to answer differently for a leg with nothing entered: the GPX
// wrote 0 m (sea level, so a GPS unit showed every point at zero), PLN and FDR
// invented 2 000 ft, and the KML inherited from the route. One answer now:
//
//   1. the leg's own altitude
//   2. the next leg ahead that has one, else the last one behind it — the
//      departure leg out of a field is usually the blank one, and climbing to the
//      cruise height is what the aircraft does
//   3. kmlUnsetLegAglFt above the departure field's elevation, when it sits on one
//   4. unknownProfileAltFt, so the number is at least plausible airspace
//
// Returns { ft, source } so a caller that CAN express height-above-ground (the KML
// tour) knows step 3/4 was a guess rather than a flown altitude.
function routeExportAltitudeFt(legIdx, opts) {
  const legs = (opts && opts.legs) || (typeof state === 'object' && state.legs) || [];
  const leg = legs[legIdx];
  if (leg && Number.isFinite(leg.inboundAltitude)) return { ft: leg.inboundAltitude, source: 'leg' };
  for (let j = legIdx + 1; j < legs.length; j++) {
    const a = legs[j] && legs[j].inboundAltitude;
    if (Number.isFinite(a)) return { ft: a, source: 'ahead' };
  }
  for (let j = legIdx - 1; j >= 0; j--) {
    const a = legs[j] && legs[j].inboundAltitude;
    if (Number.isFinite(a)) return { ft: a, source: 'behind' };
  }
  const fieldFt = (opts && Number.isFinite(opts.departureFieldFt)) ? opts.departureFieldFt : null;
  const aglFt = _kmlUnsetLegAglFt();
  if (fieldFt !== null) return { ft: fieldFt + aglFt, source: 'field+agl' };
  return { ft: _unknownProfileAltFt(), source: 'assumed' };
}

const _defaultLegSpeedKt = () => {
  const v = (typeof tune === 'function') ? Number(tune('defaultLegSpeedKt')) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 90;
};
// A leg's speed tracks the default until someone types one. Raising "Default speed"
// should carry the whole untouched route with it -- a pilot who sets 110 kt for their
// aircraft means the legs they already drew, not only the next one. Any typed speed
// (nav-log cell, inspector, assistant) pins the leg and it keeps its own number.
// Mirrors _legAltitudeAuto, and rides along in snapshots because those spread ...leg.
//
// Tracked PER DIRECTION, because the forward and return speeds are two independent
// numbers with two independent editors. One shared flag meant typing a return speed
// pinned the forward speed as well -- and since propagateAlt walks BACKWARD for
// outboundSpeed across every leg still holding the old value, a single return-speed
// keystroke pinned the whole route and left the Default speed control doing nothing.
const LEG_SPEED_AUTO_KEY = { flightSpeed: '_legSpeedAuto', outboundSpeed: '_legSpeedAutoRet' };
function markLegSpeedManual(leg, key) {
  if (!leg) return;
  // No key = the whole leg (used where a speed is authored wholesale, e.g. a template).
  const flags = key ? [LEG_SPEED_AUTO_KEY[key]] : Object.values(LEG_SPEED_AUTO_KEY);
  for (const f of flags) if (f) delete leg[f];
}
function applyDefaultSpeedToAutoLegs(kt) {
  const n = Number(kt);
  if (!Number.isFinite(n) || n <= 0) return false;
  let changed = false;
  for (const leg of state.legs) {
    if (!leg) continue;
    if (leg._legSpeedAuto && leg.flightSpeed !== n) { leg.flightSpeed = n; changed = true; }
    if (leg._legSpeedAutoRet && leg.outboundSpeed !== n) { leg.outboundSpeed = n; changed = true; }
  }
  return changed;
}
const newLeg = () => {
  const d = _defaultLegLabels();
  const seed = _defaultLegSpeedKt();
  return {
    inboundAltitude: NaN,
    outboundAltitude: NaN,
    flightSpeed: seed,
    outboundSpeed: seed,
    _legSpeedAuto: 1,              // forward speed still tracking defaultLegSpeedKt
    _legSpeedAutoRet: 1,           // return speed likewise; the two are edited separately
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
// Is `point` where waypoint `i`'s NEIGHBOUR sits? Two waypoints at one place only make a
// zero-length leg when they are adjacent, and dropping a waypoint on the one next to it is
// the deliberate delete gesture. Landing on any OTHER waypoint is an ordinary route that
// passes a point twice -- a local sortie back to its own departure field, most of all.
function routeNeighbourAtPoint(i, point, eps = SAME_REFERENCE_POINT_DEG) {
  if (!point || !state || !Array.isArray(state.waypoints)) return false;
  const wps = state.waypoints;
  const prev = i > 0 ? wps[i - 1] : null;
  const next = i < wps.length - 1 ? wps[i + 1] : null;
  return !!((prev && sameMapPoint(prev, point, eps)) ||
            (next && sameMapPoint(next, point, eps)));
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
// A leg whose NAV KITE the pilot has hidden -- the heading/time/altitude marker, both
// the inbound one and the return one. Nothing else about the leg changes: the line, its
// drift cone, the cumulative-time kite, the distance badge, the minute marks and the wind
// arrow all still draw, and the flight plan is untouched. Clicking the line still selects
// the leg (hitLeg never went through a marker), which is how the kite is brought back
// from the leg inspector.
function legKiteHidden(leg) {
  return !!(leg && leg.hideKite);
}
// CTR boundary points per airfield (docs/data/ctr-boundaries.json), lazily loaded. The
// climb-out from a field to its CTR boundary is flown on the field's procedure, not on the
// route's stopwatch -- pilots start counting at the boundary point. An airfield not listed
// behaves as before: the clock starts at the field.
var ctrBoundaries = null;          // null = not loaded; {} or populated once fetched
var _ctrBoundariesLoad = null;     // in-flight memo: the draw loop asks several times a frame
// Guard state for the graph derivation below. Declared HERE, above every use: `var` hoists
// so the old placement worked, but a bare assignment in _loadCtrBoundariesNow with no
// declaration in sight above it reads as an accidental global to a human and to no-undef.
var _ctrDerivePromise = null;      // in-flight derivation, or null
var _ctrDeriveNextTry = 0;         // earliest retry after a failed derivation
var _ctrDerived = false;           // true once derivation succeeds; cleared on a boundary reload
async function loadCtrBoundaries() {
  if (ctrBoundaries !== null) return ctrBoundaries;
  if (_ctrBoundariesLoad) return _ctrBoundariesLoad;
  _ctrBoundariesLoad = _loadCtrBoundariesNow();
  return _ctrBoundariesLoad;
}
async function _loadCtrBoundariesNow() {
  try {
    // Cache-bust with the same marker the datasets use; deploy rewrites it in core.js.
    const ver = (typeof _verOf === 'function') ? _verOf(S.routeGraphUrl) : '2';
    const r = await fetch('data/ctr-boundaries.json?v=' + ver);
    const d = r.ok ? await r.json() : null;
    const map = (d && d.airfields && typeof d.airfields === 'object') ? d.airfields : {};
    const up = (arr) => (Array.isArray(arr) ? arr : [])
      .map(p => String(p || '').trim().toUpperCase()).filter(Boolean);
    const out = {};
    for (const [icao, v] of Object.entries(map)) {
      // v1 shipped a bare array of boundary points; v2 splits inside/boundary. Both read.
      out[String(icao).toUpperCase()] = Array.isArray(v)
        ? { clockStartsAt: up(v), inside: [] }
        : { clockStartsAt: up(v && v.clockStartsAt), inside: up(v && v.inside) };
    }
    ctrBoundaries = out;
  } catch (e) {
    ctrBoundaries = {};             // absent or unreadable: every clock starts at the field
  }
  // A route drawn before this fetch landed was memoised against a null boundary set --
  // without this reset the repaint below hits that stale "no CTR anywhere" memo forever.
  _ctrLegMemo = { sig: null, inside: null };
  _ctrDerived = false;      // boundary data changed — allow one fresh re-derivation from the graph
  if (typeof scheduleDraw === 'function') scheduleDraw();
  return ctrBoundaries;
}
// Most "inside the CTR" points are already implied by the route graph: they are the
// reporting points the published corridor passes through between the field and its exit
// point. Deriving them means the hand-written list only has to carry what no corridor
// traverses (Haifa's KRYON and AFFEK), and it self-corrects as the graph grows -- LLIB's
// AMNON and Haifa's GALIM were both missing from the hand list and both fall out of this.
async function ctrDeriveInsideFromGraph() {
  if (!ctrBoundaries || typeof fplGraphChain !== 'function') return;
  let graph = null;
  try {
    graph = (typeof fplLoadRouteGraph === 'function') ? await fplLoadRouteGraph() : null;
  } catch (e) { graph = null; }
  if (!graph) return false;
  for (const rec of Object.values(ctrBoundaries)) {
    rec._derived = [];
  }
  for (const [icao, rec] of Object.entries(ctrBoundaries)) {
    if (!graph.nodes || !graph.nodes[icao]) continue;
    const found = new Set();
    for (const exit of rec.clockStartsAt || []) {
      if (!graph.nodes[exit]) continue;
      // Both directions, keep the SHORTER: a one-way boundary point (Herzliya's KNTRY,
      // arrival only) makes the other direction wrap the whole corridor loop, and taking
      // its intermediates would mark half the coastal route as "inside the CTR" -- which
      // is exactly what happened. The genuine field<->boundary hop is the short one.
      let a = null, b = null;
      try { a = fplGraphChain(graph, icao, exit, {}); } catch (e) { a = null; }
      try { b = fplGraphChain(graph, exit, icao, {}); } catch (e) { b = null; }
      const chain = (a && b) ? (a.length <= b.length ? a : b) : (a || b);
      if (!chain) continue;
      for (const n of chain.slice(1, -1)) found.add(n);
    }
    rec._derived = [...found];
  }
  _ctrLegMemo = { sig: null, inside: null };   // derived points may change the answer
  if (typeof scheduleDraw === 'function') scheduleDraw();
  return true;
}
// Every point inside a field's CTR: the hand-written list plus what the corridors imply.
// The derivation needs the route graph -- 236 KB that most sessions never open -- so it is
// kicked off on FIRST USE (a route touching a listed field) rather than at boot, where it
// added a fetch and a parse to every startup. Until it lands, the hand-written list stands
// on its own; the derived points appear on the next repaint.
function ctrInsidePoints(rec) {
  if (!rec) return [];
  _ctrKickDerive();
  return (rec.inside || []).concat(rec._derived || []);
}
// Retryable: a failed graph fetch (offline start) must not disable derivation for the
// whole session -- the hand list works meanwhile, and a later use tries again. The retry
// is time-gated: legInsideCtr calls this on every frame of a CTR-touching route, and
// re-fetching a dead network per frame would spin. (_ctrDeriveNextTry / _ctrDerived /
// _ctrDerivePromise are declared with the rest of the CTR state, above loadCtrBoundaries.)
function _ctrKickDerive() {
  if (_ctrDerivePromise || typeof fplGraphChain !== 'function') return;
  if (_ctrDerived) return;            // already derived for this boundary load — wait for reload
  if (Date.now() < _ctrDeriveNextTry) return;
  _ctrDerivePromise = ctrDeriveInsideFromGraph().then(ok => {
    _ctrDerivePromise = null;         // always clear so a later chart reload can re-derive
    if (ok === true) { _ctrDerived = true; }
    else { _ctrDeriveNextTry = Date.now() + 30000; }
  });
}
// Every name that belongs to a field's CTR: the field itself, the points inside it (listed
// or inherited from the corridors), and its exit points -- the exit is still inside, the
// clock starts on the leg LEAVING it.
function ctrNameSet(icao) {
  const rec = icao && ctrBoundaries && ctrBoundaries[icao];
  if (!rec) return null;
  const set = new Set([icao]);
  for (const n of ctrInsidePoints(rec)) set.add(n);
  for (const n of (rec.clockStartsAt || [])) set.add(n);
  return set;
}
function ctrFieldSetAt(idx) {
  if (ctrBoundaries === null) { loadCtrBoundaries(); return null; }
  const wp = state.waypoints[idx];
  const nm = (wp && wp.name) ? String(wp.name).trim().toUpperCase() : '';
  return nm ? ctrNameSet(nm) : null;
}
// Is leg i flown inside a CTR? By NAME, and CONTIGUOUSLY with the field: the prefix of
// legs from the departure field while every waypoint stays in its CTR's name set, and the
// suffix into the destination field likewise. Contiguity is the CTR's physical reality --
// a mid-route leg that happens to run between two of the departure field's boundary
// points (SFAIM -> BAZRA on a coastal transit long after exit) is ordinary route time,
// and without this it silently vanished from the clock and the totals.
// Memoised per route signature: three callers per leg per draw frame were rebuilding the
// name sets from scratch each time.
var _ctrLegMemo = { sig: null, inside: null };
function _ctrRouteSig() {
  const wps = (state && state.waypoints) || [];
  let sig = wps.length + ':';
  for (const w of wps) sig += (w.name || '') + '|';
  return sig;
}
function legInsideCtr(i) {
  if (!state || !Array.isArray(state.waypoints) || state.waypoints.length < 2) return false;
  const sig = _ctrRouteSig();
  if (_ctrLegMemo.sig !== sig) {
    const n = state.waypoints.length;
    const inside = new Array(Math.max(0, n - 1)).fill(false);
    const nameAt = (k) => (state.waypoints[k].name || '').toString().trim().toUpperCase();
    const dep = ctrFieldSetAt(0);
    if (dep) {
      for (let k = 0; k + 1 < n; k++) {
        if (dep.has(nameAt(k)) && dep.has(nameAt(k + 1))) inside[k] = true;
        else break;                                    // contiguity: stop at the first exit
      }
    }
    const arr = ctrFieldSetAt(n - 1);
    if (arr) {
      for (let k = n - 2; k >= 0; k--) {
        if (arr.has(nameAt(k)) && arr.has(nameAt(k + 1))) inside[k] = true;
        else break;
      }
    }
    _ctrLegMemo = { sig, inside, touchesCtr: !!(dep || arr) };
  }
  // The memo hides ctrInsidePoints (the derivation trigger) from later frames, so a
  // derivation that failed once (offline start) would never retry while the route sits
  // unchanged. Kick it here on CTR-touching routes; it self-throttles.
  if (_ctrLegMemo.touchesCtr) _ctrKickDerive();
  return !!_ctrLegMemo.inside[i];
}

// ...and the same for the leg's DRIFT LINES -- the dashed pair fanning out at the tuned
// drift angle. Same reasoning as the kite: on a busy chart several legs' cones overlap into
// noise, and the pilot wants that leg's cone gone without losing the leg. The global drift
// toggle still governs everything (this can only hide a cone the toolbar is already
// drawing), the kite keeps its usual offset so hiding the cone does not shift it, and the
// flight plan and every computed value are untouched.
function legDriftHidden(leg) {
  return !!(leg && leg.hideDrift);
}
// Effective visibility of one leg's drift cone. The per-leg override is symmetric now:
// hideDrift beats a global ON (declutter one leg), and showDrift beats a global OFF (bring
// one leg's cone back on an otherwise clean map). The global used to be a hard ceiling,
// which made the inspector's "Show drift lines" button a no-op whenever the toolbar toggle
// was off -- a control that does nothing teaches the pilot it is broken.
function legDriftVisible(leg, globalOn, i) {
  if (leg && leg.hideDrift) return false;
  if (leg && leg.showDrift) return true;
  // Inside the departure field's CTR the leg is flown on the field's procedure: its drift
  // cone is noise over the busiest part of the chart, so it is off unless asked for.
  if (Number.isInteger(i) && typeof legInsideCtr === 'function' && legInsideCtr(i)) {
    return false;
  }
  return !!globalOn;
}
// Effective nav-kite visibility, same rules: an explicit hide wins, an explicit show wins
// next, and a leg inside the departure CTR is hidden by default.
function legKiteVisible(i, leg) {
  if (leg && leg.hideKite) return false;
  if (leg && leg.showKite) return true;
  return !(typeof legInsideCtr === 'function' && legInsideCtr(i));
}

// A PR preview may SHARE a big static asset directory with the deployed root instead of
// carrying its own copy: every preview used to ship ~12 MB of chart-overlay imagery it had
// not changed, and with several PRs open that pushed one Pages artifact near 300 MB, past
// what Pages can publish inside the deploy action's (non-configurable) ceiling.
//
// The build omits a directory only when the branch has not touched it, and lists what it
// omitted in window.__navPreviewSharedDirs. So a branch that DOES edit an overlay still
// previews its own images -- the saving is only ever taken where there is nothing to see.
//
// Filesystem links cannot do this job: actions/upload-pages-artifact packs with
// `tar --dereference --hard-dereference`, which turns both soft and hard links back into
// full copies, and Pages does not serve through symlinks either. Hence a URL-level
// indirection, the same trick plateBase() uses for the byop plate set.
function navPreviewSharesDir(dir) {
  const shared = (typeof window !== 'undefined' && window.__navPreviewSharedDirs) || null;
  return !!(shared && shared.indexOf(dir) >= 0);
}

// Base URL for a static asset directory: this document's own copy, unless the build told us
// this preview shares the root's.
function navAssetBase(dir) {
  const here = new URL(dir + '/', document.baseURI).href;
  if (!navPreviewSharesDir(dir)) return here;
  // Strip the preview suffix exactly as plateBase() does -- `branch/.+` so a branch name
  // containing a slash strips fully.
  const u = new URL(here);
  u.pathname = u.pathname.replace(/[^/]*\/$/, '').replace(/(staging|pr\/[^/]+|branch\/.+)\/$/, '') + dir + '/';
  return u.href;
}

// The reference VOR was set from four places -- the toolbar picker, the VOR inspector's
// "use as reference" button, and two selects in the flight plan -- each with its own copy of
// "assign, persist, sync the other select, redraw". They drifted: only some reset the
// inspector-only override, and none dealt with the coverage ring's first precedence, so
// clearing the reference from a selected station's own inspector left its ring on the map
// until the inspector was closed. One setter now owns the whole transition.
var vorRingSuppressIdent = null;   // station the pilot un-referenced while it was selected

function setReferenceVor(ident) {
  const next = ident || null;
  window.vorRef = next;
  try {
    if (next) localStorage.setItem('navaid.vorRef', next);
    else localStorage.removeItem('navaid.vorRef');
  } catch (e) { /* storage unavailable */ }
  // An explicit reference choice ends any inspector-only override.
  if (typeof resetInspectorVorRef === 'function') resetInspectorVorRef();
  // The ring rings the SELECTED station first, which is what a pilot asks for by tapping
  // one. But clearing the reference on that same station is the pilot saying "not this one",
  // so its selection ring goes too -- otherwise the button appears to do nothing.
  const selIdent = (typeof state !== 'undefined' && state.selected &&
    state.selected.type === 'vor' && typeof vors !== 'undefined' && vors[state.selected.index])
    ? vors[state.selected.index].ident : null;
  window.vorRingSuppressIdent = (!next && selIdent) ? selIdent : null;
  // Keep every picker showing the same answer.
  for (const id of ['vor-ref-select', 'fp-vor-select']) {
    const el = document.getElementById(id);
    if (el) el.value = next || '';
  }
  return next;
}

// Is the selected station's ring suppressed? Answering also EXPIRES the suppression, which
// is the whole point: it is scoped to the one selection the pilot cleared the reference on,
// not to the ident for the rest of the session. Without the expiry, NAT -> clear -> select
// BGN -> select NAT again left NAT permanently un-ringable, because the value was only ever
// reset by setting another non-empty reference. Selection moving anywhere else (or nowhere)
// ends it. Called from draw(), so "the selection changed" needs no hook on all ~50 sites
// that assign state.selected.
function vorRingSuppressed(selectedIdent) {
  if (typeof vorRingSuppressIdent !== 'string' || !vorRingSuppressIdent) return false;
  if (selectedIdent && selectedIdent === vorRingSuppressIdent) return true;
  window.vorRingSuppressIdent = null;             // selection left the station -- expired
  return false;
}

function navLangPosKey(base) {
  const lang = (document.documentElement && document.documentElement.lang === 'he') ? 'he' : 'en';
  return base + '.' + lang;
}
// Read a position, adopting a pre-split blob. Positions used to be stored under the
// bare key for both languages; splitting them per language would otherwise discard
// every spot the pilot had already dragged (legend, clock, inspector, toolbar,
// tuning panel, flight plan) and snap each panel back to its default. On the first
// read we inherit the legacy value into this language's key. The legacy key is left
// in place so the other language inherits it too, once.
function navLangPosRead(base) {
  try {
    const scoped = localStorage.getItem(navLangPosKey(base));
    if (scoped !== null) return scoped;
    const legacy = localStorage.getItem(base);
    if (legacy === null) return null;
    localStorage.setItem(navLangPosKey(base), legacy);
    return legacy;
  } catch (e) { return null; }   // storage unavailable
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
  // ACT: ICAO Doc 8400 defines it as the adjective "active" — the most common
  // usage in this feed ("METZADA ACT FM 8000FT", "LZ ACT", "GLD ACT AVBL").
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
  // Round 2, from a frequency analysis of the live feed (2026-08). Three kinds:
  // real abbreviations that were missing, feed typos mapped to their word, and
  // plain-English words the source shouts in caps -- mapped to lowercase so the
  // decoded text stops mixing cases mid-sentence. Identifiers (waypoints, bubble
  // codes, place names) are deliberately absent and stay uppercase.
  EXER: 'exercise', SER: 'service', INT: 'intersection', TYP: 'type',
  CTL: 'control', ADC: 'aerodrome chart', AIS: 'aeronautical information service',
  MEDEVAC: 'medical evacuation', IDENT: 'identification',
  BOUNDRAY: 'boundary', BOUNDARY: 'boundary', MAINTANING: 'maintaining',
  ISRAEL: 'Israel', LEBANON: 'Lebanon', JORDAN: 'Jordan', GAZA: 'Gaza',
  SYRIA: 'Syria', EGYPT: 'Egypt',
  // No MAY: in NOTAMs it is overwhelmingly the permission modal ("PILOTS MAY CTC
  // TWR"), and one key cannot serve both it and the month. Dates keep their MAY.
  JAN: 'January', FEB: 'February', MAR: 'March', APR: 'April',
  JUN: 'June', JUL: 'July', AUG: 'August', SEP: 'September', OCT: 'October',
  NOV: 'November', DEC: 'December',
  AN: 'an', AT: 'at', ON: 'on', TO: 'to', UP: 'up', OF: 'of', OR: 'or', BY: 'by',
  IN: 'in', THE: 'the', AND: 'and', ALL: 'all', NOT: 'not', FOR: 'for',
  TWO: 'two', WAY: 'way', VIA: 'via', DUE: 'due', WILL: 'will', TAKE: 'take',
  PLACE: 'place', AREA: 'area', ROAD: 'road', ONLY: 'only', WITH: 'with',
  SHALL: 'shall', RADIUS: 'radius', RADIO: 'radio', PILOT: 'pilot',
  PHONE: 'phone', ENTRY: 'entry', EXIT: 'exit', STRIP: 'strip', STAND: 'stand',
  ADDED: 'added', NIL: 'nil', CHART: 'chart', CHARTS: 'charts', CRANE: 'crane',
  BALLOON: 'balloon', CAPTIVE: 'captive', ERECTED: 'erected', SPOKEN: 'spoken',
  UPDATED: 'updated', TRIGGER: 'trigger', CLOSURE: 'closure', CONTACT: 'contact',
  POLICE: 'police', AIR: 'air', CASE: 'case', BOARD: 'board', YEAR: 'year',
  TIME: 'time', LOCAL: 'local', FUEL: 'fuel', OVER: 'over', MAKE: 'make',
  NORTH: 'north', SOUTH: 'south', EAST: 'east', WEST: 'west',
  CENTERED: 'centered', INCLUDING: 'including', PROHIBITED: 'prohibited',
  WITHDRAWN: 'withdrawn', RESTRICTIONS: 'restrictions',
  FIREFIGHTING: 'firefighting', AGRICULTURE: 'agriculture', DISPLAY: 'display',
  AIRSPACE: 'airspace', AIRBORNE: 'airborne', GLIDERS: 'gliders',
  APPROVED: 'approved', LANGUAGE: 'language', DIFFERENCES: 'differences',
  REGULATION: 'regulation', DAYLIGHT: 'daylight', SAVING: 'saving',
  REQUIRES: 'requires', TRANSPONDER: 'transponder', OPERATING: 'operating',
  CIRCUIT: 'circuit', FLYPAST: 'flypast', REFUELING: 'refuelling',
  ENGINE: 'engine', JUNCTION: 'junction', HELIPAD: 'helipad',
  ESTABLISHED: 'established', AIRCRAFT: 'aircraft', AIRSTRIP: 'airstrip',
  DEPARTING: 'departing', BIDIRECTIONAL: 'bidirectional',
};
// Nouns that turn a following 1-2 digit number into a DESIGNATOR rather than a
// day-of-month ("runway 27", "taxiway 3"). Used by the MAY disambiguation below;
// both the expanded word and the raw code are listed because the abbreviation pass
// runs first but does not carry every one of these.
const NOTAM_DESIGNATOR_NOUN =
  /\b(?:runway|taxiway|route|frequency|apron|stand|helipad|helicopter|RWY|RWYS|TWY|TWYS|RTE|FREQ|VOR|NDB|ILS|GATE|BAY|PAD)\s*$/i;
// Expand the standard abbreviations in a NOTAM body, tidying the source's
// 3-space wrap indentation. Coordinate tokens (digits+N/E/S/W) carry no word
// boundary around their letters, so they pass through untouched.
function expandNotamAbbr(s) {
  let out = String(s == null ? '' : s).replace(/\r/g, '');
  out = out.split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Up to 13 letters: the table now carries whole words (BIDIRECTIONAL) alongside the
  // abbreviations. Only table entries are replaced, so identifiers of any length pass.
  out = out.replace(/\b[A-Z]{2,13}\b/g, m => NOTAM_ABBR[m] || m);
  // MAY is the one token the table cannot carry: modal verb in prose, month in dates.
  // A real day-of-month or year marks the date use ("15 MAY 2027", "MAY 2027");
  // everything else is the modal and reads lowercase like the rest.
  //
  // The day check is not just "a digit before MAY": RWY and FREQ numbers routinely sit
  // right before it ("RWY 09/27 MAY BE CLOSED", "FREQ 118.3 MAY CHANGE") and read as a
  // 1-2 digit day at a glance -- a real day needs a clean boundary in front of it (not
  // the tail of a runway pair or a frequency). Two alternatives, tried in order: a
  // clean day + MAY (always a date, whether or not a year follows), or bare MAY with
  // an optional trailing year. A single adjacent optional-digit group doesn't work here
  // -- for a genuine 2-digit day ("15 MAY") the group happily eats the day's own first
  // digit as "the preceding character", so the day looks unbounded and gets misread as
  // the modal ("15 may"). Splitting into two alternatives keeps the day's digits and
  // its boundary check from ever competing over the same character.
  out = out.replace(/(?:(?:^|[^\d./])(\d{1,2})\s+MAY\b(?:\s+\d{4}\b)?|\bMAY\b(\s+\d{4}\b)?)/g,
    (m, day, bareYear, offset, str) => {
      if (bareYear) return m;           // "MAY 2027" — definitely a month name
      if (day) {
        // A bare 1-2 digit number precedes MAY. Slashes and dots are already excluded
        // above, so "RWY 09/27" and "FREQ 118.3" never reach here -- but a SINGLE
        // runway ("RWY 27 MAY BE CLSD") does, and it is not a date.
        //
        // Decided by what comes BEFORE the number, not after MAY: a facility noun
        // ("runway 27", "taxiway 3") makes the number a designator, so MAY is the modal.
        // Anything else leaves it a day-of-month. Looking AFTER instead -- treating a
        // following BE/NOT as the modal marker -- cannot work, because a date takes the
        // same predicates ("WEF 27 MAY NOT AVBL" is the 27th of May, "08 MAY BE CLSD"
        // likewise) and those got their month wrongly lowercased.
        //
        // The abbreviation pass above already ran, so the nouns are matched in their
        // EXPANDED form; the raw codes stay listed for anything the table does not carry.
        const before = str.slice(0, offset + m.search(/\d/));
        if (NOTAM_DESIGNATOR_NOUN.test(before)) return m.replace('MAY', 'may');
        return m;                       // plain day-of-month → month name
      }
      return 'may';                     // bare MAY with no context → modal verb
    });
  // Sentence-case what the lowercase mapping produced: a sentence that begins with an
  // expanded word ("an area at...") gets its capital back. Only at the start of the
  // text or after a sentence ender -- the feed hard-wraps mid-sentence, so a bare
  // newline is NOT a sentence boundary ([.!?]\s+ already covers ".\n").
  return out.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
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
  // Only when there IS a later leg to attach it to. On a single-leg route the last leg is
  // also the first, so `legCount - 1` is 0 -- the departure's own index -- and the stable
  // sort below let the destination (pushed second) win it. A local hop then printed the
  // ARRIVAL field's frequency from the moment of departure, which is the one leg where the
  // pilot is certainly still on the departure field's.
  if (legCount > 1) {
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
// performance. The ramp is confined to the leg. A TOC marker is emitted only
// when the departure / destination is an actual airfield (has a field
// elevation); intermediate per-leg altitude changes are drawn but not marked.
// Returns per-leg
// time/fuel, altitude-vs-distance vertices (pts), and wpCum (cumulative NM at
// each waypoint, for the distance axis).
function routeProfile(ac, legIndexes) {
  ac = ac || (typeof aircraft === 'object' && aircraft) || {};
  // V/S shapes the PICTURE, never the clock. Leg time is dist / speed, full stop, so
  // the kite, the plan, the totals and the nav log cannot disagree, and the ETE never
  // moves because of a rate the pilot did not think they were entering. (Climb time is
  // conventionally carried as a separate allowance, not smeared into leg ETEs.)
  const vs = typeof window !== 'undefined' && window.profileVS > 0 ? window.profileVS : 0;
  const climbFpm = vs > 0 ? vs : (ac.climbFpm > 0 ? ac.climbFpm : tune('profileClimbFpm'));
  const climbKt = ac.climbKt > 0 ? ac.climbKt : tune('profileClimbKt');
  const gph = ac.gph > 0 ? ac.gph : tune('defaultGph');
  const legs = state.legs || [], wps = state.waypoints || [];
  const indexes = Array.isArray(legIndexes)
    ? legIndexes.filter(i => Number.isInteger(i) && i >= 0 && i < legs.length)
    : legs.map((_, i) => i);
  const n = indexes.length;
  // A leg with no altitude entered is flown LEVEL for timing: the plan must not
  // charge climb/descent time against an altitude the pilot never typed. It used
  // to assume 2 000 ft silently, model a descent onto the field, and come out ~50 s
  // short of the map kites and the route summary for the very same leg -- three
  // surfaces, two ETEs, and the assumption shown nowhere. The fallback survives only
  // as the height the profile strip is DRAWN at (flat, no TOC).
  const unknownAlt = _unknownProfileAltFt();
  const altKnown = i => Number.isFinite(legs[i].inboundAltitude);
  const legAlt = i => altKnown(i) ? legs[i].inboundAltitude : unknownAlt;
  // The only ramp in the profile is the climb off an airfield: that is where the
  // aircraft demonstrably leaves a known elevation. A leg starting anywhere else is
  // drawn level at its own altitude -- no synthesized mid-route ramps, and no descent
  // invented onto the destination field (so TOD is gone; TOC stays).
  const out = { legs: [], pts: [], tocs: [], wpCum: [0], wpTime: [0],
    wpIndexes: n ? [indexes[0]].concat(indexes.map(i => i + 1)) : [],
    totalDist: 0, totalTimeH: 0, totalFuel: 0 };

  // Prepass: per-leg distance + cumulative NM at each waypoint.
  const dists = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const sourceIndex = indexes[i];
    const A = wps[sourceIndex], B = wps[sourceIndex + 1];
    const d = A && B ? geo(A, B).dist : 0;
    dists.push(d); total += d; out.wpCum.push(total);
  }
  out.totalDist = total;
  if (!n) return out;

  let cum = 0;
  for (let i = 0; i < n; i++) {
    const sourceIndex = indexes[i];
    const dist = dists[i];
    const cr = legAlt(sourceIndex);
    // Does this leg start ON an airfield? Then it climbs from that field's elevation
    // to its own altitude at the V/S, over however much distance that takes (capped
    // at the leg). Everything else is drawn level.
    const startElev = routeEndpointElev(sourceIndex);
    const climbs = altKnown(sourceIndex) && startElev != null && cr > startElev;
    const startAlt = climbs ? startElev : cr;
    const climbDist = climbs
      ? Math.min(dist, climbKt * ((cr - startAlt) / climbFpm) / 60)
      : 0;
    // Time is speed and distance only -- the ramp above costs nothing.
    const timeH = legs[sourceIndex].flightSpeed > 0 ? dist / legs[sourceIndex].flightSpeed : 0;
    const fuel = timeH * gph;
    // assumed: nothing was typed for this leg, so cr is unknownProfileAltFt. The
    // strip must not draw an invented height as confidently as a real one.
    const assumed = !altKnown(sourceIndex);
    if (assumed) out.hasAssumed = true;
    out.legs.push({ dist, timeH, fuel, climbDist, descDist: 0,
      cruiseDist: Math.max(0, dist - climbDist), startAlt, cruiseAlt: cr, endAlt: cr, assumed });
    // Vertices: field elevation, ramp up to the leg altitude, then level to the end.
    out.pts.push({ d: cum, alt: startAlt, assumed });
    if (climbDist > 0) out.pts.push({ d: cum + climbDist, alt: cr, assumed });
    out.pts.push({ d: cum + dist, alt: cr, assumed });
    if (climbDist > 0) {
      out.tocs.push({ leg: i, frac: dist > 0 ? climbDist / dist : 0, alt: cr });
    }
    cum += dist; out.totalTimeH += timeH; out.totalFuel += fuel;
    out.wpTime.push(out.totalTimeH);
  }
  // Drop consecutive duplicate vertices.
  out.pts = out.pts.filter((p, i, arr) => i === 0 || p.d !== arr[i - 1].d || p.alt !== arr[i - 1].alt ||
    p.assumed !== arr[i - 1].assumed);
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
  if (legAltitudeIsBlocked(leg, key)) return altitudeBlockedLabel();
  // Tables keep the explicit word (see kiteAltitudeLabel) — but a phone's alt
  // column is 42px, where "Unknown" / "לא ידוע" renders as "Unkno" / "לא יד".
  // Below the breakpoint the dash the kites use is the honest choice.
  if (typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(max-width: 680px)').matches) {
    return S.altitudeUnsetShort || '—';
  }
  return altitudeUnknownLabel();
}
// Map kites are glanced at, not read: a full-width "Unknown" on every leg label was
// the loudest text on the chart and looked like an error rather than "not set yet".
// Tables and the inspector keep the explicit word; the kite gets a dash.
function kiteAltitudeLabel(v, leg, key) {
  if (legAltitudeIsBlocked(leg, key)) return altitudeBlockedLabel();
  return Number.isFinite(v) ? String(v) : (S.altitudeUnsetShort || '—');
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
  const isLng = pos === 'E' || pos === 'W';   // longitude → 3 degree digits (aviation convention)
  v = Math.abs(v);
  let d = Math.floor(v);
  // Round minutes to 1 dp FIRST, then carry a rounded-up 60.0 into the degree
  // so the readout never shows e.g. 32°60.0' (should be 33°00.0'). Same 60→0
  // carry as dmsParts().
  let m = Math.round((v - d) * 60 * 10) / 10;
  if (m >= 60) { m -= 60; d += 1; }
  // Zero-pad degrees: latitude 2 digits (32°), longitude 3 digits (035°).
  const dd = String(d).padStart(isLng ? 3 : 2, '0');
  return `${dd}°${m.toFixed(1).padStart(4, '0')}'${hemi}`;
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
// flight-maps.com is a third party's server and the charts are served there as a courtesy.
// Only the live site may draw from it: every other deployment of this code -- a PR preview,
// staging, a developer's laptop, a fork -- draws the same charts from our own CORS mirror
// instead. A preview left on the third party's tiles puts a reviewer's panning, and every
// automated visit to that URL, on someone else's bandwidth under our name.
function liveChartTilesAllowed() {
  try {
    if (location.hostname !== 'navaid.supino.org') return false;
    const path = location.pathname || '/';
    // Same origin, different builds: /pr/<n>/ previews and /staging/ are not the live site.
    return !(path.indexOf('/pr/') === 0 || path.indexOf('/staging/') === 0);
  } catch (e) {
    return false;                      // cannot tell -> do not use the third party's server
  }
}
const LIVE_CHART_TILES = liveChartTilesAllowed();
NavAid.liveChartTiles = LIVE_CHART_TILES;
function chartTileUrl(kind, remoteUrl, mirrorUrl) {
  if (LOCAL_CHART_TILES) return 'tiles/' + kind + '/{z}/{x}/{y}.png';
  return LIVE_CHART_TILES ? remoteUrl : mirrorUrl;
}
function chartTileOptions(options) {
  if (LOCAL_CHART_TILES) return { ...options, attribution: LOCAL_FM_ATTR, corsOk: true, localTiles: true };
  // Off the live site the displayed tile IS the mirror, which serves CORS `*` -- so the
  // export path can read it straight from the canvas instead of re-fetching every tile.
  return LIVE_CHART_TILES ? options : { ...options, corsOk: true };
}

const layers = {
  'CVFR': L.tileLayer(chartTileUrl('cvfr', 'https://flight-maps.com/tiles/cvfr/{z}/{x}/{y}.png',
    NAVAID_TILE_BASE + '/CVFR/{z}/{x}/{y}.png'),
    chartTileOptions({ ...TILE, attribution: FM_ATTR,
      exportUrl: NAVAID_TILE_BASE + '/CVFR/{z}/{x}/{y}.png' })),
  'Navigation': L.tileLayer(chartTileUrl('nav', 'https://flight-maps.com/tiles/nav/{z}/{x}/{y}.png',
    NAVAID_TILE_BASE + '/Israel-Navigation/{z}/{x}/{y}.png'),
    chartTileOptions({ ...TILE, attribution: FM_ATTR,
      exportUrl: NAVAID_TILE_BASE + '/Israel-Navigation/{z}/{x}/{y}.png' })),
  'Low Alt': L.tileLayer(chartTileUrl('la', 'https://flight-maps.com/tiles/la/{z}/{x}/{y}.png',
    NAVAID_TILE_BASE + '/LSA-Low-Altitude/{z}/{x}/{y}.png'),
    chartTileOptions({ ...TILE, attribution: FM_ATTR,
      exportUrl: NAVAID_TILE_BASE + '/LSA-Low-Altitude/{z}/{x}/{y}.png' })),
  'Helicopters': L.tileLayer(chartTileUrl('il-hel', 'https://flight-maps.com/tiles/il-hel/{z}/{x}/{y}.png',
    NAVAID_TILE_BASE + '/Israel-Helicopters/{z}/{x}/{y}.png'),
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

// Is a base layer offered at all? CVFR always is -- it is the fallback everything else
// degrades to. The rest hang on gist-controlled tunables, so a layer can be pulled from
// (or restored to) the shipped app without a build.
function layerOffered(name) {
  if (name === 'CVFR') return true;
  const key = 'layerEnabled' + String(name || '').replace(/\s+/g, '');
  if (typeof NavAid === 'undefined' || !NavAid.tuningDefaults || !NavAid.tuningDefaults[key]) return true;
  // Bool tunable: the gist writes true/false, exactly as it reads.
  return tune(key) !== false && tune(key) !== 0;
}

const LAYER_KEY = 'navaid.layer';
let initialLayer = layers.CVFR;
try {
  let saved = localStorage.getItem(LAYER_KEY);
  if (saved === 'OSM') { saved = 'OpenStreetMap'; localStorage.setItem(LAYER_KEY, saved); }
  if (saved === 'Nav') { saved = 'Navigation'; localStorage.setItem(LAYER_KEY, saved); }
  if (saved === 'Heli') { saved = 'Helicopters'; localStorage.setItem(LAYER_KEY, saved); }
  // A saved layer that is no longer offered falls back to CVFR rather than resurrecting a
  // hidden chart from localStorage.
  if (saved && layers[saved] && layerOffered(saved)) initialLayer = layers[saved];
} catch (e) { /* storage unavailable */ }

// First-run view. z9 fitted the whole country but drew the CVFR chart at 0.13× --
// unreadable, and mostly off-chart, so a new user's first screen was a near-white
// page speckled with unlabelled reporting points. z11 is the first zoom where the
// chart reads as a chart. A saved navaid.view (see io.js) still wins on a return
// visit -- this is the first-run / rejected-save fallback. Gistable, so the landing
// view can be retuned without a build.
const _touchRotateGesture = () => {
  const v = (typeof tune === 'function') ? Number(tune('touchRotateGesture')) : 0;
  return v === 1;
};
const _initialView = (() => {
  const num = (k, d) => { const v = (typeof tune === 'function') ? Number(tune(k)) : NaN;
    return Number.isFinite(v) && v !== 0 ? v : d; };
  return { center: [num('defaultViewLat', 32.1), num('defaultViewLng', 34.95)], zoom: num('defaultViewZoom', 11) };
})();
const map = L.map('map', {
  center: _initialView.center,
  zoom: _initialView.zoom,
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
  // Two-finger ROTATION is off by default: on a phone every pinch-zoom twisted the
  // chart a few degrees, and nothing on screen says why north moved. Bearing is set
  // deliberately from the toolbar dial instead. Gistable, so the gesture can come
  // back without a build for anyone who wants it.
  touchRotate: _touchRotateGesture(),
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
// --- report-point re-anchoring ---------------------------------------------
// Identification-point ovals anchor to a leg by INDEX ({leg, t}), so any splice
// that renumbers legs invalidates them. Rather than doing index arithmetic per
// splice shape (which got the delete case wrong — an anchor on the removed leg
// kept its index, and after the splice that index is the NEXT leg, so the marker
// jumped a segment forward), capture where each marker sits on the GROUND before
// the splice and re-anchor it to the nearest surviving leg afterwards. One
// mechanism, correct for delete / insert / merge, and it keeps the marker on the
// spot the pilot actually put it.
//
// Call captureReportPointGeo() before mutating waypoints/legs and pass the result
// to reanchorReportPoints() after syncLegs().

// Fraction of the way from A to B at which P sits (clamped 0..1). Planar is fine
// at leg scale — it only has to place a marker back onto a segment.
function legFractionAt(A, B, P) {
  if (!A || !B || !P) return 0;
  const dx = B.lng - A.lng, dy = B.lat - A.lat;
  const d2 = dx * dx + dy * dy;
  if (!d2) return 0;
  const t = ((P.lng - A.lng) * dx + (P.lat - A.lat) * dy) / d2;
  return Math.max(0, Math.min(1, t));
}

function captureReportPointGeo() {
  const out = [];
  if (!Array.isArray(state.notes)) return out;
  for (const n of state.notes) {
    if (!n || !n.rp || !Number.isInteger(n.rp.leg)) continue;
    const A = state.waypoints[n.rp.leg], B = state.waypoints[n.rp.leg + 1];
    if (!A || !B) continue;
    // Clamp exactly as reportPointGeom does, so the captured point is the pixel the
    // user actually sees. An out-of-range t (possible in a loaded/imported route)
    // would otherwise extrapolate past the leg end and re-anchor onto a neighbour.
    const raw = Number.isFinite(n.rp.t) ? n.rp.t : 0.5;
    const t = Math.max(0, Math.min(1, raw));
    // Keep the endpoint OBJECTS, not the index: waypoint objects survive a splice,
    // so identity is how we recognise the same segment afterwards. Comparing indexes
    // cannot work — that is the whole reason this helper exists.
    out.push({ n, A, B, t,
      lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t });
  }
  return out;
}

function reanchorReportPoints(captured) {
  if (!Array.isArray(captured) || !captured.length) return;
  for (const c of captured) {
    if (!c || !c.n || !c.n.rp) continue;
    // 1. Same segment still in the route (renumbered, or untouched)? Keep t exactly.
    let same = -1;
    for (let i = 0; i < state.legs.length; i++) {
      if (state.waypoints[i] === c.A && state.waypoints[i + 1] === c.B) { same = i; break; }
    }
    if (same >= 0) { c.n.rp.leg = same; c.n.rp.t = c.t; continue; }
    // 2. Segment is gone (a waypoint was deleted, or it was split). Prefer a leg
    //    that still shares one of the marker's own endpoints — after deleting B from
    //    A-B-C that is the merged A-C, which is where the marker belongs. Only if
    //    NEITHER endpoint survives do we consider the whole route.
    //
    //    Restricting the candidates matters: a route that loops back near itself (an
    //    out-and-back) has an unrelated leg passing closer to the old position than
    //    the merged one, and an unbounded nearest-leg search moved the marker there —
    //    where it looks plausible but prints a different leg's time on the nav log.
    //
    //    Deliberately no distance cut-off either way: dropping the marker when
    //    nothing is close (deleting the apex of a dogleg leaves only the far chord)
    //    silently destroys a named reporting point the pilot placed.
    const scan = (restrict) => {
      let best = -1, bestD = Infinity, bestT = 0.5;
      for (let i = 0; i < state.legs.length; i++) {
        const A = state.waypoints[i], B = state.waypoints[i + 1];
        if (!A || !B) continue;
        if (restrict && A !== c.A && B !== c.A && A !== c.B && B !== c.B) continue;
        const t = legFractionAt(A, B, c);
        const dLat = (A.lat + (B.lat - A.lat) * t) - c.lat;
        const dLng = (A.lng + (B.lng - A.lng) * t) - c.lng;
        const d = dLat * dLat + dLng * dLng;
        if (d < bestD) { bestD = d; best = i; bestT = t; }
      }
      return { best, bestT };
    };
    let hit = scan(true);
    if (hit.best < 0) hit = scan(false);
    if (hit.best >= 0) { c.n.rp.leg = hit.best; c.n.rp.t = hit.bestT; }
  }
}

function syncLegs() {
  const before = state.legs.length;
  const need = Math.max(0, state.waypoints.length - 1);
  while (state.legs.length < need) {
    const i = state.legs.length;
    const leg = newLeg();
    // Continue the route at the speed already being flown. Splitting a leg has always
    // inherited it (splitLegCopy), but appending reset to the default — so extending a
    // 110 kt route silently produced a 90 kt final leg, with the wrong ETE and fuel.
    const prev = i > 0 ? state.legs[i - 1] : null;
    if (prev && Number.isFinite(prev.flightSpeed) && prev.flightSpeed > 0) {
      leg.flightSpeed = prev.flightSpeed;
      leg.outboundSpeed = Number.isFinite(prev.outboundSpeed) && prev.outboundSpeed > 0
        ? prev.outboundSpeed : prev.flightSpeed;
      // Inheriting a hand-typed speed makes the appended leg hand-typed too, so a
      // later change of the default can't undercut the speed it was extended at.
      if (!prev._legSpeedAuto) delete leg._legSpeedAuto;
      if (!prev._legSpeedAutoRet) delete leg._legSpeedAutoRet;
    }
    state.legs.push(leg);
    applyLegAltitudeToLeg(i);
  }
  while (state.legs.length > need) state.legs.pop();
  // Last-resort prune for identification-point ovals left past the end of the
  // route (cleared / truncated / a loaded blob). Mid-route inserts and deletes
  // must NOT rely on this: pruning by index deleted markers whose segment still
  // existed and slid the survivors onto a different leg, so those call sites
  // re-anchor first — see captureReportPointGeo / reanchorReportPoints.
  if (Array.isArray(state.notes)) {
    state.notes = state.notes.filter(n => !n || !n.rp || n.rp.leg < need);
  }
  applyLegAltitudesToRoute();
  // A newly added leg should pick up live wind when the wind display is on
  // (the handler is debounced and no-ops when the wind display is off).
  if (state.legs.length > before && typeof onRouteLegsGrown === 'function') onRouteLegsGrown();
  // Auto plate-filter follows the route's first/last airfield.
  if (typeof onRouteChangedForPlates === 'function') onRouteChangedForPlates();
  // Whether the route doubles back can change with any edit, and with it whether the
  // leg-direction picker has anything to divide.
  if (typeof refreshLegDirEnabled === 'function') refreshLegDirEnabled();
  if (typeof refreshTurnDependentControls === 'function') refreshTurnDependentControls();
}

// Canonical -- the same key whichever way the leg is flown. The graph stores a segment in
// whichever direction it walks first, so ~30% of rows come out reversed from one build to
// the next; a directional key made every lookup probe both orientations, and a future
// single-orientation lookup would have silently missed those rows. Orientation is decided
// where it matters: by comparing the leg's `from` with the row's own `from`.
function legAltitudeKey(from, to) {
  const a = String(from || '').trim();
  const b = String(to || '').trim();
  return a <= b ? a + '-' + b : b + '-' + a;
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
  const row = legAltitudeMap[legAltitudeKey(from, to)];
  if (row) {
    // Reversed when the leg is flown against the row's stored direction.
    const match = resolveSegment(row, row.from !== from);
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
  const key = legAltitudeKey(from, to);
  const segment = legAltitudeMap[key];
  if (segment) return { key, segment, reverse: segment.from !== from };
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
// Did the leg's endpoints actually MOVE, or just wobble? The signature is 5-dp coordinates,
// i.e. ~1 m, and `drag.moved` is set by a single pixel -- so comparing signature strings made
// a 2 px nudge at high zoom count as "the pilot pointed this leg somewhere else", which reverted
// the leg to auto and (for endpoints not on a charted segment, i.e. any hand-placed point)
// blanked a typed 3500 ft in the plan card, the nav log, the profile and the export.
// The threshold is the app's own "same point" tolerance, the one sameMapPoint and the snap
// suppression already use, so "same place" means one thing everywhere.
function legEndpointsMoved(oldSig, newSig) {
  if (!oldSig || !newSig) return oldSig !== newSig;
  const parse = sig => String(sig).split('|').map(p => {
    const [lat, lng] = p.split(',').map(Number);
    return { lat, lng };
  });
  const a = parse(oldSig), b = parse(newSig);
  if (a.length !== 2 || b.length !== 2) return oldSig !== newSig;
  for (let k = 0; k < 2; k++) {
    if (!Number.isFinite(a[k].lat) || !Number.isFinite(b[k].lat)) return oldSig !== newSig;
    if (!sameMapPoint(a[k], b[k])) return true;
  }
  return false;
}
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
      } else if (legEndpointsMoved(leg._altSig, sig)) {
        leg._legAltitudeAuto = 1;          // endpoints changed → back to auto
        if (applyLegAltitudeToLeg(i)) changed = true;
        leg._altSig = sig;
      } else if (leg._altSig !== sig) {
        leg._altSig = sig;                 // moved, but not far enough to mean anything
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
// Does leg i fly back down a leg already flown? True when its two waypoints are the same
// pair as an EARLIER leg's, reversed. Exact, and needs no guess about where a turnaround
// is: on an out-and-back this picks out precisely the return legs, and on a route that
// never retraces it is false everywhere, so the direction filter simply does nothing.
function legIsRetrace(i) {
  const wps = (typeof state !== 'undefined' && state.waypoints) || [];
  const a = wps[i], b = wps[i + 1];
  if (!a || !b) return false;
  const same = (p, q) => p && q &&
    (typeof sameMapPoint === 'function' ? sameMapPoint(p, q) : (p.lat === q.lat && p.lng === q.lng));
  for (let j = 0; j < i; j++) {
    if (same(wps[j], b) && same(wps[j + 1], a)) return true;
  }
  return false;
}
// Where the route turns for home. The FIRST retraced leg is the answer whenever there is
// one: a leg flown back down a track already flown is direct evidence of the turn, not an
// inference, and everything after it is the way home even where it takes a different path
// and retraces nothing further. On the route this was reported from --
//
//   LLHZ -> SFAIM -> TYONA -> NTAIM -> TYONA -> HTZUK -> KNTRY
//
// only NTAIM->TYONA reverses an earlier leg, so leg 3 is the turn and legs 3-5 are the
// return, which is how the pilot flying it describes the sortie.
//
// With nothing retraced at all, fall back to the waypoint furthest from the start -- a
// sortie that goes out one way and comes back another still has a turn, it just leaves no
// reversed leg to find it by.
// The turn: the start of the first retraced leg, or -1 when the route never doubles back.
// Proof, never a guess. An earlier version fell back to "the waypoint furthest from the
// start" when nothing retraced, which read plausibly and was wrong twice over: it invented
// a turn on a straight A->B->C route, and in the comm-change path that suppressed a real
// frequency change at an arbitrary point. With no retraced leg there is no turn, the
// direction filter has nothing to divide, and the picker says so by disabling itself.
function legRetraceTurnIndex() {
  const wps = (typeof state !== 'undefined' && state.waypoints) || [];
  const legs = (typeof state !== 'undefined' && state.legs) || [];
  const n = Math.min(legs.length, wps.length - 1);
  // A hand-set turn wins outright. A LOOP route repeats no waypoint, so no leg retraces
  // and the geometry has nothing to say about where it turns for home -- but the pilot
  // flying LLHZ -> SFAIM -> TYONA -> RIDNG -> HTZUK -> KNTRY -> LLHZ knows perfectly well
  // that TYONA is the far end. Marked in the waypoint inspector.
  for (let i = 0; i < wps.length; i++) {
    if (wps[i] && wps[i].turn) return Math.min(i, n);
  }
  for (let i = 0; i < n; i++) {
    if (legIsRetrace(i)) return i;
  }
  return -1;
}
// Mark (or clear) the waypoint the route turns for home at. One per route: setting a new
// one clears the old, because a route has a single far end and two would make "outbound"
// meaningless.
function setTurnWaypoint(idx) {
  const wps = (typeof state !== 'undefined' && state.waypoints) || [];
  const was = wps[idx] && wps[idx].turn;
  for (const w of wps) { if (w) delete w.turn; }
  if (!was && wps[idx]) wps[idx].turn = 1;
  return !was;
}
function legTurnaroundIndex() { return legRetraceTurnIndex(); }
// Should leg i be shown, given the direction filter? Everything from the turnaround
// on counts as the return -- not just the legs that literally retrace. This is the
// shared gate for every route-bound visual and hit target.
function legDirVisible(i) {
  const f = (typeof legDirFilter === 'string') ? legDirFilter : 'both';
  if (f !== 'out' && f !== 'back') return true;
  const t = legRetraceTurnIndex();
  if (t < 0) return true;             // no turn: nothing to divide, so hide nothing
  return f === 'out' ? i < t : i >= t;
}
function legDirVisibleIndexes() {
  const legs = (typeof state !== 'undefined' && state.legs) || [];
  const f = (typeof legDirFilter === 'string') ? legDirFilter : 'both';
  const t = (f === 'out' || f === 'back') ? legRetraceTurnIndex() : -1;
  const indexes = [];
  if (t < 0) {
    for (let i = 0; i < legs.length; i++) indexes.push(i);
    return indexes;
  }
  const start = f === 'back' ? t : 0;
  const end = f === 'out' ? t : legs.length;
  for (let i = start; i < end; i++) indexes.push(i);
  return indexes;
}
function legDirWaypointVisible(i) {
  const f = (typeof legDirFilter === 'string') ? legDirFilter : 'both';
  if (f !== 'out' && f !== 'back') return true;
  const t = legRetraceTurnIndex();
  if (t < 0) return true;
  return f === 'out' ? i <= t : i >= t;
}
function routeNoteDirVisible(note) {
  if (!note) return false;
  if (note.rp && Number.isInteger(note.rp.leg)) return legDirVisible(note.rp.leg);
  if (!note.cc || !Array.isArray(state.waypoints)) return true;
  const canonical = value => typeof canonicalNavWaypointName === 'function'
    ? canonicalNavWaypointName(value) : String(value || '').trim();
  const key = canonical(note.cc);
  let routeBound = false;
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    if (!wp || canonical(wp.name) !== key) continue;
    routeBound = true;
    if (legDirWaypointVisible(i)) return true;
  }
  return !routeBound;
}
function routeSelectionDirVisible(selection) {
  if (!selection) return true;
  if (selection.type === 'leg') return legDirVisible(selection.index);
  if (selection.type === 'wp') return legDirWaypointVisible(selection.index);
  if (selection.type === 'note') return routeNoteDirVisible(state.notes[selection.index]);
  return true;
}
function legAllowsReturn(i) {
  const leg = state.legs[i];
  return !(leg && (leg._legAltitudeOutboundBlocked || leg._legAltitudeOneWay));
}
// The charted altitude for a leg, from the route graph's edges — read from
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
  const row = legAltitudeOriginMap[legAltitudeKey(from, to)];
  if (row) { const m = resolve(row, row.from !== from); if (m) return m; }
  return null;
}
