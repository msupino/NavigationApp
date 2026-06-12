'use strict';
/* NavAid — drawing: route, nav-waypoints, notes, page frame.
   Shares globals with core.js; loaded after it. */

// Issue #394 (+ follow-up bug): default-kite clearance helpers, shared by
// `drawLegs` (rendering), `legLabelCenter` (interact.js hit-testing),
// and the drag-start materialiser (interact.js). The kite shape itself
// is `46 * legZoomScale()` px wide (see drawLegArrow in this file —
// `W = 46 * sc`), so its half-extent perpendicular to the leg axis is
// `23 * legZoomScale()`. Drift lines fan out from each waypoint at the
// configured drift angle (default 10°)
// from the leg axis for half the leg length; at the default along-leg
// position (midpoint, a=0) the cone reaches
// `(legLength / 2) * tan(drift angle)`
// perpendicular. The kite's *centre* must therefore sit at least
// (cone-extent + kite-half-width + visual margin) from the leg line so
// the kite *body* clears both the leg line and the drift dashes at
// every zoom and `legArrowSize`. The first cut of this fix only
// pushed the centre `(len/2)*tan(10°) + 8` out, which left the kite
// edge ON the leg line at low zoom or `legArrowSize >= 2`.
function driftAngleRad() {
  return tune('driftAngleDeg') * Math.PI / 180;
}
function legDefaultLabelPerp(legLenPx) {
  const sc = (typeof legZoomScale === 'function') ? legZoomScale() : 1;
  return (Math.max(1, legLenPx) / 2) * Math.tan(driftAngleRad()) +
         tune('defaultKiteHalfWidthPx') * sc +
         tune('defaultLabelMarginPx');
}

// --- drawing ---------------------------------------------------------
// Draw the live simulator aircraft at its current position with heading.
// Top-down airplane silhouette: nose points up in local frame, rotated to
// (aircraft heading − map bearing) so it tracks correctly on a rotated map.
function drawSimAircraft() {
  if (!simOn || !simAircraft) return;
  const s = proj(simAircraft);
  const mapBearing = (typeof map !== 'undefined' && map.getBearing) ? map.getBearing() : 0;
  const screenAngle = ((simAircraft.hdg || 0) - mapBearing) * Math.PI / 180;
  const r = 18;
  octx.save();
  octx.translate(s.x, s.y);
  octx.rotate(screenAngle);

  // ── fuselage ──
  octx.beginPath();
  octx.moveTo(0, -r);                                      // nose tip
  octx.quadraticCurveTo( r * 0.13, -r * 0.3,  r * 0.13,  r * 0.15);  // right side
  octx.lineTo( r * 0.13,  r * 0.6);                       // right fuselage to tail
  octx.quadraticCurveTo( r * 0.08, r * 0.85, 0,  r * 0.9);            // right tail taper
  octx.quadraticCurveTo(-r * 0.08, r * 0.85, -r * 0.13,  r * 0.6);
  octx.lineTo(-r * 0.13,  r * 0.15);
  octx.quadraticCurveTo(-r * 0.13, -r * 0.3, 0, -r);
  octx.closePath();
  octx.fillStyle = '#e74c3c';
  octx.fill();

  // ── wings — swept back from mid-fuselage ──
  octx.beginPath();
  octx.moveTo( r * 0.13,  r * 0.05);   // right wing root (leading edge)
  octx.lineTo( r,          r * 0.35);  // right wingtip LE
  octx.lineTo( r * 0.85,   r * 0.45);  // right wingtip TE
  octx.lineTo( r * 0.13,   r * 0.22);  // right wing root (trailing edge)
  octx.closePath();
  octx.fillStyle = '#e74c3c';
  octx.fill();

  octx.beginPath();
  octx.moveTo(-r * 0.13,  r * 0.05);
  octx.lineTo(-r,          r * 0.35);
  octx.lineTo(-r * 0.85,   r * 0.45);
  octx.lineTo(-r * 0.13,   r * 0.22);
  octx.closePath();
  octx.fillStyle = '#e74c3c';
  octx.fill();

  // ── horizontal stabilisers ──
  octx.beginPath();
  octx.moveTo( r * 0.13,  r * 0.65);
  octx.lineTo( r * 0.45,  r * 0.78);
  octx.lineTo( r * 0.38,  r * 0.85);
  octx.lineTo( r * 0.13,  r * 0.75);
  octx.closePath();
  octx.fillStyle = '#e74c3c';
  octx.fill();

  octx.beginPath();
  octx.moveTo(-r * 0.13,  r * 0.65);
  octx.lineTo(-r * 0.45,  r * 0.78);
  octx.lineTo(-r * 0.38,  r * 0.85);
  octx.lineTo(-r * 0.13,  r * 0.75);
  octx.closePath();
  octx.fillStyle = '#e74c3c';
  octx.fill();

  // ── white outline over everything ──
  octx.lineWidth = 1.5;
  octx.strokeStyle = 'rgba(255,255,255,0.9)';
  // re-stroke fuselage
  octx.beginPath();
  octx.moveTo(0, -r);
  octx.quadraticCurveTo( r * 0.13, -r * 0.3,  r * 0.13,  r * 0.15);
  octx.lineTo( r * 0.13,  r * 0.6);
  octx.quadraticCurveTo( r * 0.08, r * 0.85, 0,  r * 0.9);
  octx.quadraticCurveTo(-r * 0.08, r * 0.85, -r * 0.13,  r * 0.6);
  octx.lineTo(-r * 0.13,  r * 0.15);
  octx.quadraticCurveTo(-r * 0.13, -r * 0.3, 0, -r);
  octx.closePath();
  octx.stroke();

  octx.restore();
}

function draw() {
  octx.clearRect(0, 0, vw(), vh());
  drawNavWaypoints();
  drawReportingBadges();
  drawCommChangeRings();
  drawAirfields();
  drawVors();
  if (window.showSigmet && Array.isArray(sigmets) && sigmets.length) drawSigmets();
  drawLegs();
  drawWaypoints();
  drawNotes();
  drawSimAircraft();
  drawInfo();
  drawPageFrame();
  drawPlanCard();          // flight-plan card placed for PNG export (#378)
  // #78: keep the Flight Plan modal live with the route. The hook is null
  // when the modal isn't open, or after refresh detects a structural change
  // and closes it.
  if (refreshFlightPlan) refreshFlightPlan();
  // #214: skip persist during a PNG export. The export modal flips overlay
  // toggles for the preview render, then restores them; without this guard
  // the debounced persist() would write the preview-state mutation to
  // localStorage if the user reopened the modal mid-export.
  if (!NavAid.exporting) persist();
}

// --- SIGMET hazard overlay (active international SIGMETs) ------------
// A scheduled GitHub Action fetches the NOAA AWC isigmet feed, filters it to
// the Israel region, and publishes sigmet.json to the `sigmet-data` branch —
// served with CORS by raw.githubusercontent.com, so this static app can read
// it directly (the AWC API itself blocks browser CORS). Same-origin
// data/sigmet.json is the offline / first-run fallback.
const SIGMET_URL =
  'https://raw.githubusercontent.com/msupino/NavigationApp/sigmet-data/sigmet.json';
async function loadSigmets(force) {
  if (sigmets !== null && !force) return sigmets;
  const parse = d => {
    const list = Array.isArray(d && d.sigmets) ? d.sigmets : [];
    sigmetMeta = { generatedAt: (d && d.generatedAt) || null };
    return list.filter(s => s && Array.isArray(s.coords));
  };
  try {
    const res = await fetch(SIGMET_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    sigmets = parse(await res.json());
    return sigmets;
  } catch (e) {
    try {
      const res2 = await fetch('data/sigmet.json');
      sigmets = parse(await res2.json());
    } catch (e2) {
      console.warn('Failed to load SIGMETs:', e, e2);
      sigmets = [];
      sigmetMeta = { generatedAt: null };
    }
    return sigmets;
  }
}
function drawSigmets() {
  octx.save();
  for (const s of sigmets) {
    const pts = (s.coords || [])
      .filter(c => Array.isArray(c) && c.length === 2 &&
                   Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map(c => proj({ lat: c[0], lng: c[1] }));
    if (pts.length < 3) continue;
    const col = sigmetHazardColor(s.hazard);
    octx.beginPath();
    octx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
    octx.closePath();
    octx.fillStyle = colorWithAlpha(col, 0.16);
    octx.fill();
    octx.setLineDash([8, 5]);
    octx.lineWidth = 2;
    octx.strokeStyle = col;
    octx.stroke();
    octx.setLineDash([]);
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    const label = (String(s.hazard || '') +
                   (s.qualifier ? ' ' + s.qualifier : '')).trim();
    if (label) {
      octx.font = 'bold 12px sans-serif';
      octx.textAlign = 'center';
      octx.lineWidth = 3;
      octx.strokeStyle = 'rgba(255,255,255,0.9)';
      octx.strokeText(label, cx, cy);
      octx.fillStyle = col;
      octx.fillText(label, cx, cy);
    }
  }
  octx.textAlign = 'left';
  octx.restore();
}

// --- nav-waypoint reference overlay ---------------------------------
// Lazy-loads docs/data/nav-waypoints.json on first activation. Format:
// { waypoints:[{ name, en, he, lat, lng }] } — 172 published reporting
// points sourced from the IAA CVFR chart page 113 (2025 edition); see
// issue #406. Validated strictly by validateNavWaypoints() (issue
// #101): every documented field must be present and well-typed;
// extras are silently allowed for forward-compat.
async function loadNavWaypoints() {
  if (navWP !== null) return navWP;
  try {
    // ?v bumped whenever nav-waypoints.json changes — the service worker
    // caches it cache-first, so a new URL is needed to pick up edits.
    const res = await fetch(S.navWpUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const verr = validateNavWaypoints(d);
    if (verr) {
      console.warn('nav-waypoints schema error:', verr);
      alert(S.errInvalidNavWaypoints(verr));
      return [];
    }
    navWP = d.waypoints.map(w => ({
      name: w.name,
      en: w.en,                          // English label (name stays canonical code)
      he: w.he,                          // Hebrew label
      lat: w.lat,
      lng: w.lng,
      report: w.report,                  // 'mandatory' | 'onRequest' (issue #404)
    }));
    return navWP;
  } catch (e) {
    // Leave navWP === null so a subsequent toggle / search / snap call can
    // retry — assigning [] would make the early-return guard short-circuit
    // forever and disable nav waypoints for the whole session (issue #72).
    console.warn('Failed to load nav waypoints:', e);
    return [];
  }
}

// Lazy-loads docs/data/comm-change.json — { callSigns:{...},
// points:[{name, commChange, callSigns, from, to, note, source}] }.
// Builds an O(1) map keyed by ICAO `name` for the nav-waypoint overlay ring
// + inspector badge. On 404 or schema error we install an EMPTY map ({})
// instead of leaving commChangeMap null — the dataset is intentionally
// optional, and a missing file must not disable the rest of the nav-WP
// overlay (issue #399). The map is only rebuilt if a future call observes
// `commChangeMap === null` (i.e. nothing was installed yet), so a one-time
// 404 doesn't trigger retry storms.
async function loadCommChange() {
  if (commChangeMap !== null) return commChangeMap;
  try {
    const res = await fetch(S.commChangeUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const verr = validateCommChange(d);
    if (verr) {
      console.warn('comm-change schema error:', verr);
      commChangeMap = {};
      commChangeCallSigns = {};
      return commChangeMap;
    }
    commChangeCallSigns = (d.callSigns && typeof d.callSigns === 'object' &&
      !Array.isArray(d.callSigns)) ? d.callSigns : {};
    const m = {};
    for (const pt of d.points) {
      if (pt && pt.name && pt.commChange) m[pt.name] = pt;
    }
    commChangeMap = m;
    return commChangeMap;
  } catch (e) {
    console.warn('Failed to load comm-change dataset:', e);
    commChangeCallSigns = {};
    commChangeMap = {};                    // graceful degrade — no rings, no retry
    return commChangeMap;
  }
}

// Lazy-loads docs/data/leg-altitude.json — { segments:[{from,to,
// inboundAltitude,outboundAltitude,status,oneWay,...}], directionPool:[...] }.
// The app uses it only as a reference table for freshly-created legs;
// saved/imported route JSON stays authoritative for existing leg values.
async function loadLegAltitudes() {
  if (legAltitudeMap !== null) return legAltitudeMap;
  try {
    const res = await fetch(S.legAltitudeUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const verr = validateLegAltitudes(d);
    if (verr) {
      console.warn('leg-altitude schema error:', verr);
      legAltitudeMap = {};
      legAltitudePointIds = new Set();
      legAltitudeDataset = null;
      return legAltitudeMap;
    }
    const directions = Array.isArray(d.directionPool)
      ? d.directionPool
      : legAltitudeDirectionsFromSegments(d.segments);
    const m = {};
    const ids = new Set();
    for (const segment of d.segments) {
      if (!segment || !segment.from || !segment.to) continue;
      m[legAltitudeKey(segment.from, segment.to)] = {
        from: segment.from,
        to: segment.to,
        distanceNm: segment.distanceNm,
        inboundAltitude: segment.inboundAltitude,
        outboundAltitude: segment.outboundAltitude,
        oneWay: segment.oneWay === true,
        status: segment.status || 'candidate',
      };
      ids.add(segment.from);
      ids.add(segment.to);
    }
    legAltitudeMap = m;
    legAltitudePointIds = ids;
    legAltitudeDataset = d;
    legAltitudeDirectionPool = directions;
    applyLegAltitudesToRoute();
    return legAltitudeMap;
  } catch (e) {
    console.warn('Failed to load leg-altitude dataset:', e);
    legAltitudeMap = {};             // graceful degrade — defaults remain
    legAltitudePointIds = new Set();
    legAltitudeDataset = null;
    legAltitudeDirectionPool = null;
    return legAltitudeMap;
  }
}

// Closest nav waypoint within `pxThreshold` screen pixels of `latlng`,
// or null. Returns the {name, lat, lng} entry from the loaded JSON.
function nearestNavWaypoint(latlng, pxThreshold) {
  if (!navWP || !navWP.length) return null;
  const t = map.latLngToContainerPoint([latlng.lat, latlng.lng]);
  let bestDist = pxThreshold, best = null;
  for (const wp of navWP) {
    const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d < bestDist) { bestDist = d; best = wp; }
  }
  return best;
}

// True if `name` matches a known nav waypoint (code, English, or Hebrew) — so we
// treat it as auto-snapped, not user-typed, and may overwrite on drag.
function isNavName(name) {
  if (!name || !navWP) return false;
  for (const wp of navWP) {
    if (wp.name === name || wp.en === name || wp.he === name) return true;
  }
  return false;
}

function canonicalNavWaypointName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (navWP) {
    for (const wp of navWP) {
      if (wp.name === s || wp.en === s || wp.he === s) return wp.name;
    }
  }
  return s;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// True if `name` is the auto sequence label (`WP N`, `WPn`, or locale
// `S.wpPrefix` + digits). Same family as the dimmed inspector / flight-plan
// placeholder — not a user-chosen static name.
function isSequenceWaypointName(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  if (/^wp\s*\d+$/i.test(s)) return true;
  const p = (typeof S !== 'undefined' && S && S.wpPrefix) ? String(S.wpPrefix) : 'WP ';
  const flags = /[^\u0000-\u007f]/.test(p) || /[^\u0000-\u007f]/.test(s) ? 'u' : '';
  if (new RegExp('^' + escapeRegExp(p) + '\\d+$', flags).test(s)) return true;
  const pt = p.trim();
  if (pt && new RegExp('^' + escapeRegExp(pt) + '\\s*\\d+$', flags).test(s)) return true;
  return false;
}

// Clear stored `wp.name` when it is only a sequence placeholder so the UI
// shows the dimmed placeholder (empty value) and snap logic applies.
function normalizeWaypointSequenceName(wp) {
  if (!wp) return;
  const t = String(wp.name || '').trim();
  if (t && isSequenceWaypointName(t)) wp.name = '';
}

// Resolve a stored waypoint name to the current locale. If the stored value
// is a nav-WP name (code or either language), return the locale-appropriate
// version.
// User-typed names are returned as-is.
function navName(stored) {
  if (!stored || !navWP) return stored || '';
  for (const nw of navWP) {
    if (nw.name === stored || nw.en === stored || nw.he === stored)
      return nw[S.navWpSearchField] || nw.en || nw.name;
  }
  return stored;
}

// Decide where a waypoint should sit + what to call it given a target
// position and its current name. Used by both initial drop and drag.
//  - If the current name is user-typed (non-empty, not an auto-snap or
//    sequence label like "WP 6" / "WP6"):
//    leave the name alone; just move to the target latlng.
//  - Else if an airfield is within 18 px of the target (overlay on):
//    snap lat/lng + adopt its ICAO `name`.
//  - Else if a nav waypoint is within 18 px of the target (overlay on):
//    snap lat/lng + name to that nav waypoint.
//  - Else if the current name was an auto-snap or sequence label (no longer
//    near any):
//    clear it so the circle reverts to the sequence number.
// Airfields take priority because they're a much smaller set of strongly-
// known landmarks (16 vs 172 nav-WPs); if both overlays sit on the same
// spot the airfield name is the more meaningful identifier.
function applyNavSnap(latlng, currentName, excludeLl) {
  const EXCL_DEG = 0.0002;
  const excluded = ll => excludeLl &&
    Math.abs(ll.lat - excludeLl.lat) < EXCL_DEG &&
    Math.abs(ll.lng - excludeLl.lng) < EXCL_DEG;
  if (!showAirfields && !showNavWP) {
    const autoSnapped = isAirfieldName(currentName) || isNavName(currentName) ||
        isSequenceWaypointName(currentName);
    return { lat: latlng.lat, lng: latlng.lng,
             name: autoSnapped ? '' : (currentName || '') };
  }
  const autoSnapped = isAirfieldName(currentName) || isNavName(currentName) ||
      isSequenceWaypointName(currentName);
  const userTyped = currentName && !autoSnapped;
  // #106: Force-snap mode lifts the 18 px radius so every click resolves to
  // the absolute nearest known point. Useful when the chart has many close
  // reporting points and the user wants the published coordinate regardless
  // of click precision.
  // #106: force-snap lifts the radius. Airfield-first priority is fine inside
  // the 18 px radius (both rarely sit there together), but at infinite radius
  // it would make the 16-airfield set always win and leave the 172 nav-WPs
  // unreachable. So in force-snap mode pick the globally nearest across both
  // visible sets by screen distance instead of short-circuiting on airfields.
  if (window.forceSnap) {
    const t = map.latLngToContainerPoint([latlng.lat, latlng.lng]);
    const cands = [];
    if (showAirfields) {
      const af = nearestAirfield(latlng, Infinity);
      if (af && !excluded(af)) cands.push({ pt: af, name: af.name });
    }
    if (showNavWP) {
      const nw = nearestNavWaypoint(latlng, Infinity);
      if (nw && !excluded(nw)) cands.push({ pt: nw, name: nw.name });
    }
    let best = null, bestD = Infinity;
    for (const c of cands) {
      const p = map.latLngToContainerPoint([c.pt.lat, c.pt.lng]);
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) {
      const name = userTyped ? currentName : best.name;
      return { lat: best.pt.lat, lng: best.pt.lng, name, code: best.name };
    }
    return { lat: latlng.lat, lng: latlng.lng,
             name: autoSnapped ? '' : (currentName || ''), code: '' };

  }
  if (showAirfields) {
    const af = nearestAirfield(latlng, 18);
    if (af && !excluded(af)) {
      const name = userTyped ? currentName : af.name;
      return { lat: af.lat, lng: af.lng, name, code: af.name };
    }
  }
  if (showNavWP) {
    const snap = nearestNavWaypoint(latlng, 18);
    if (snap && !excluded(snap)) {
      const name = userTyped ? currentName : snap.name;
      return { lat: snap.lat, lng: snap.lng, name, code: snap.name };
    }
  }
  return { lat: latlng.lat, lng: latlng.lng,
           name: autoSnapped ? '' : (currentName || ''), code: '' };
}

// --- airfield reference overlay -------------------------------------
// Lazy-loads docs/data/airfields.json on first activation. Format:
// { airfields:[{ name, he, en, lat, lng, elev_ft, plates:[string] }] } —
// published Israeli airfields with matching BYOP plate filenames. The
// `plates` field is data-only for now; rendering a per-airfield plate
// list is tracked as a follow-up. Validated strictly by
// validateAirfields() (issue #101): every documented field must be
// present and well-typed; extras are silently allowed for forward-compat.
async function loadAirfields() {
  if (airfields !== null) return airfields;
  try {
    const res = await fetch(S.airfieldsUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const verr = validateAirfields(d);
    if (verr) {
      console.warn('airfields schema error:', verr);
      alert(S.errInvalidAirfields(verr));
      return [];
    }
    airfields = d.airfields.map(a => ({
      name: a.name,
      he: a.he,
      en: a.en,
      lat: a.lat,
      lng: a.lng,
      elev_ft: a.elev_ft,
      atis: a.atis,
      clearance: a.clearance,
      plates: Array.isArray(a.plates) ? a.plates.slice() : [],
      runways: Array.isArray(a.runways) ? a.runways.slice() : null,
    }));
    return airfields;
  } catch (e) {
    // Leave airfields === null so a subsequent toggle / search call can
    // retry — assigning [] would make the early-return guard short-circuit
    // forever and disable the overlay for the whole session (issue #72).
    console.warn('Failed to load airfields:', e);
    return [];
  }
}
// --- VOR/DME stations (issue #404 follow-up) ------------------------
// Lazy-loads docs/data/vor.json: { vors:[{ ident, name, he?, freq, lat, lng }] }.
// Used by the overlay markers, the selectable reference for radial/DME
// readouts, and (later) the flight-plan radial/DME columns.
async function loadVors() {
  if (vors !== null) return vors;
  try {
    const res = await fetch(S.vorUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const verr = typeof validateVors === 'function' ? validateVors(d) : null;
    if (verr) {
      console.warn('vor schema error:', verr);
      if (typeof S.errInvalidVors === 'function') alert(S.errInvalidVors(verr));
      return [];
    }
    vors = d.vors.map(v => ({
      ident: v.ident, name: v.name, he: v.he,
      freq: v.freq, lat: v.lat, lng: v.lng,
    }));
    return vors;
  } catch (e) {
    console.warn('Failed to load VORs:', e);
    return [];
  }
}
function vorByIdent(ident) {
  if (!ident || !vors) return null;
  return vors.find(v => v.ident === ident) || null;
}
// The currently-selected reference VOR object (or null).
function activeVor() { return vorByIdent(vorRef); }
// Magnetic radial FROM the VOR to a point + DME (great-circle nm).
// Radial is magnetic (VOR radials are defined magnetic; matches the Hdg
// column). Returns { radial: '263', dme: '12.4' } strings, or null.
function vorRadialDme(vor, lat, lng) {
  if (!vor || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const g = geo({ lat: vor.lat, lng: vor.lng }, { lat, lng });
  if (!g || !Number.isFinite(g.brg) || !Number.isFinite(g.dist)) return null;
  return { radial: pad3(toMagnetic(g.brg)), dme: g.dist.toFixed(1) };
}

// Closest airfield within `pxThreshold` screen pixels of `latlng`, or null.
// Returns the {name, he, en, lat, lng, ...} entry from the loaded JSON.
function nearestAirfield(latlng, pxThreshold) {
  if (!airfields || !airfields.length) return null;
  const t = map.latLngToContainerPoint([latlng.lat, latlng.lng]);
  let bestDist = pxThreshold, best = null;
  for (const af of airfields) {
    const p = map.latLngToContainerPoint([af.lat, af.lng]);
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d < bestDist) { bestDist = d; best = af; }
  }
  return best;
}

// True if `name` matches a known airfield ICAO (its `name` field).
// Airfield labels are ICAO — the locale-specific Hebrew / English label
// is only shown next to the marker, never stored as the WP name.
function isAirfieldName(name) {
  if (!name || !airfields) return false;
  for (const af of airfields) if (af.name === name) return true;
  return false;
}

// Max |Δlat| and |Δlng| for treating a waypoint as "on" an airfield ARP when
// the label is not the ICAO code (renamed WP, older saved coords vs chart
// refresh, r5 rounding). ~0.002° ≈ 220 m at Israel lat — matches `isAirport`.
const AIRFIELD_POS_MATCH_EPS = 0.002;

// Airfield row from `airfields.json` for inspector runways / plates: prefer an
// exact ICAO name match, else ARP coords within `AIRFIELD_POS_MATCH_EPS` so a
// renamed label (or legacy share-link coords) still surfaces charts + runways.
function airfieldAtWaypoint(wp) {
  if (!wp || !airfields || !airfields.length) return null;
  const name = (wp.name || '').trim().toUpperCase();
  const byName = airfields.find(a => a.name === name);
  if (byName) return byName;
  const eps = AIRFIELD_POS_MATCH_EPS;
  return airfields.find(a =>
    Math.abs(a.lat - wp.lat) < eps && Math.abs(a.lng - wp.lng) < eps
  ) || null;
}

// Distinct from nav-WPs: airfields are rendered as a blue-filled upward
// triangle (▲) outline, sized to ~7 px at typical zooms. The ICAO and
// localised name appear next to the marker at zoom ≥ 10. Suppressed when
// a route waypoint sits on the airfield (proximity-based, like nav-WPs).
function drawAirfields() {
  if (!showAirfields || !airfields || airfields.length === 0) return;
  const SNAP_DEG = 0.0002;               // ~22 m — matches nearestAirfield px threshold
  const showLabels = map.getZoom() >= 10;
  const r = tune('airfieldMarkerRadiusPx');
  const wFactor = tune('airfieldMarkerWidthFactor');
  const bFactor = tune('airfieldMarkerBaseFactor');
  const labelOffset = tune('airfieldLabelOffsetPx');
  octx.font = `bold ${tune('airfieldLabelFontPx')}px sans-serif`;
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  for (const af of airfields) {
    const occupied = state.waypoints.some(
      w => Math.abs(w.lat - af.lat) < SNAP_DEG && Math.abs(w.lng - af.lng) < SNAP_DEG);
    if (occupied) continue;
    const s = proj(af);                  // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
    octx.beginPath();
    octx.moveTo(s.x,          s.y - r);
    octx.lineTo(s.x + r * wFactor, s.y + r * bFactor);
    octx.lineTo(s.x - r * wFactor, s.y + r * bFactor);
    octx.closePath();
    octx.fillStyle = tune('airfieldFillColor');          // saturated blue — distinct from white nav-WP dots
    octx.fill();
    octx.lineWidth = tune('airfieldStrokeWidthPx');
    octx.strokeStyle = tune('airfieldOutlineColor');
    octx.stroke();
    if (showLabels) {
      const locale = af[S.airfieldLabelField] || af.en || af.name;
      const label = af.name + (locale && locale !== af.name ? ' / ' + locale : '');
      octx.lineWidth = tune('airfieldLabelHaloPx');
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
      octx.strokeText(label, s.x + r + labelOffset, s.y);
      octx.fillStyle = tune('airfieldOutlineColor');
      octx.fillText(label, s.x + r + labelOffset, s.y);
    }
  }
  octx.lineWidth = 1;
}

// Comm-change ring styling (issue #399). Drawn around the white nav-WP dot
// when `commChangeMap[name].commChange` is true and the toggle is on. The
// red is distinct from every other overlay glyph: nav-WP dots are white,
// airfields blue, route waypoints yellow-on-black, leg kites yellow/pink —
// so the bright red ring reads as "watch out, frequency boundary" against
// all base layers (CVFR, OSM, Satellite). Sized just outside the 3.5 px
// dot so it visually augments rather than replaces it.
const COMM_CHANGE_RING_COLOR = '#e74c3c';

function drawNavWaypoints() {
  if (!showNavWP || !navWP || navWP.length === 0) return;
  // Suppress nav-WP dot when a route waypoint sits on it (by position),
  // regardless of whether the WP name was changed after snapping.
  const SNAP_DEG = 0.0002;               // ~22 m — matches nearestNavWaypoint px threshold
  const showLabels = map.getZoom() >= 10;
  const dotRadius = tune('navWaypointRadiusPx');
  const labelOffset = tune('navWaypointLabelOffsetPx');
  octx.font = `bold ${tune('navWaypointLabelFontPx')}px sans-serif`;
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  for (const wp of navWP) {
    const occupied = state.waypoints.some(
      r => Math.abs(r.lat - wp.lat) < SNAP_DEG && Math.abs(r.lng - wp.lng) < SNAP_DEG);
    if (occupied) continue;
    const s = proj(wp);                  // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
    octx.fillStyle = tune('navWaypointDotColor');
    octx.strokeStyle = tune('inkColor');
    octx.lineWidth = tune('navWaypointStrokeWidthPx');
    octx.beginPath();
    octx.arc(s.x, s.y, dotRadius, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
    if (showLabels) {
      const label = wp[S.navWpSearchField] || wp.name;
      octx.lineWidth = tune('navWaypointLabelHaloPx');
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
      octx.strokeText(label, s.x + labelOffset, s.y);
      octx.fillStyle = tune('inkColor');
      octx.fillText(label, s.x + labelOffset, s.y);
    }
  }
  octx.lineWidth = 1;
}

// VOR/DME station overlay. Each station draws a compass-rose glyph (ring +
// N/E/S/W ticks + centre dot) with an ident + frequency label. The selected
// reference VOR is highlighted so it is obvious which one feeds the radial/
// DME readouts. Gated by the "Show VOR stations" toggle.
function drawVors() {
  if (!showVorStations || !vors || !vors.length) return;
  const r = tune('vorMarkerRadiusPx');
  const showLabels = map.getZoom() >= 8;
  octx.save();
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  octx.font = `bold ${tune('vorLabelFontPx')}px sans-serif`;
  for (const v of vors) {
    const s = proj(v);
    const sel = v.ident === vorRef;
    const col = sel ? tune('vorSelectedColor') : tune('vorMarkerColor');
    octx.strokeStyle = col;
    octx.fillStyle = col;
    octx.lineWidth = tune('vorMarkerWidthPx') * (sel ? 1.6 : 1);
    octx.beginPath();
    octx.arc(s.x, s.y, r, 0, Math.PI * 2);
    octx.stroke();
    // N/E/S/W ticks just outside the ring.
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      octx.beginPath();
      octx.moveTo(s.x + dx * r, s.y + dy * r);
      octx.lineTo(s.x + dx * (r + 4), s.y + dy * (r + 4));
      octx.stroke();
    }
    octx.beginPath();
    octx.arc(s.x, s.y, Math.max(1.5, r * 0.22), 0, Math.PI * 2);
    octx.fill();
    if (showLabels) {
      const label = v.ident + '  ' + v.freq;
      const lx = s.x + r + 6, ly = s.y;
      octx.lineWidth = 2.5;
      octx.strokeStyle = colorWithAlpha(tune('overlayLabelHaloColor'), tune('overlayLabelHaloAlpha'));
      octx.strokeText(label, lx, ly);
      octx.fillStyle = col;
      octx.fillText(label, lx, ly);
    }
  }
  octx.restore();
  octx.lineWidth = 1;
}

// --- reporting-type overlay (issue #404 / PR #405 design) ------------
// The CVFR chart's סוג דיווח class lives inline on each nav-waypoint as
// `report` ('mandatory' = חובה, 'onRequest' = דרישה). reportingFor() resolves
// a route-waypoint or nav-WP name (code or either locale label) to its class.
let _reportIndex = null;
let _reportIndexFor = null;
function reportingFor(name) {
  if (!name || !navWP || !navWP.length) return null;
  if (_reportIndexFor !== navWP) {
    _reportIndex = Object.create(null);
    for (const w of navWP) if (w.report) _reportIndex[w.name] = w.report;
    _reportIndexFor = navWP;
  }
  // `name` is guaranteed truthy by the guard above.
  const key = typeof canonicalNavWaypointName === 'function'
    ? canonicalNavWaypointName(name) : String(name).trim();
  return (key && _reportIndex[key]) || null;
}
// Small "M" badge on mandatory (חובה) reporting points so they stand out on
// the chart. Drawn as its own pass — independent of the nav-WP dot overlay —
// so it tracks the dedicated "Show mandatory reports" toggle. On-request
// points are not badged (they are the common case); the inspector still
// reports both classes for any selected waypoint.
function drawReportingBadges() {
  if (!showReporting || !navWP || !navWP.length) return;
  const r = tune('reportBadgeRadiusPx');
  const off = tune('reportBadgeOffsetPx');
  octx.save();
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.font = `bold ${tune('reportBadgeFontPx')}px sans-serif`;
  for (const wp of navWP) {
    if (wp.report !== 'mandatory') continue;
    const s = proj(wp);
    const cx = s.x + off, cy = s.y - off;
    octx.beginPath();
    octx.arc(cx, cy, r, 0, Math.PI * 2);
    octx.fillStyle = tune('reportBadgeColor');
    octx.fill();
    octx.lineWidth = 1.5;
    octx.strokeStyle = tune('inkColor');
    octx.stroke();
    octx.fillStyle = tune('reportBadgeTextColor');
    octx.fillText('M', cx, cy + 0.5);
  }
  octx.restore();
  octx.lineWidth = 1;
}

// Comm-change rings (issue #399 / #484). Drawn independently of the nav-WP
// dot layer: the "Show Comm Changes" toggle marks frequency-boundary points
// whether or not the full 173-dot reporting-point overlay is on. Positions
// come from the same navWP dataset, so navWP must be loaded when this layer
// is enabled (toggle handler + boot ensure that). When both layers are on,
// the dot is drawn by drawNavWaypoints() and the ring here — once each.
function drawCommChangeRings() {
  // Test-inspection hook (issue #399): every comm-change ring drawn this
  // frame is recorded here so Playwright can assert "ring drew at X"
  // without snapshotting overlay pixels. Built fresh every draw() so it
  // never accumulates stale names after a toggle off / pan away.
  const ringsDrawn = new Set();
  const ringRadii = {};                  // #488 test hook: name -> drawn radius
  // commChangeMap may be null briefly during boot — guard so a fast first
  // paint can't NPE before loadCommChange resolves.
  if (showCommChange && commChangeMap && navWP && navWP.length) {
    const ringWidth = tune('commChangeRingWidthPx');
    octx.strokeStyle = COMM_CHANGE_RING_COLOR;
    octx.lineWidth = ringWidth;
    // #488: if a route waypoint sits on the point, drawWaypoints() paints a
    // filled disc over this ring later in the frame — and with "show waypoint
    // names" on, waypointGeom() enlarges that disc to fit its label. Grow the
    // ring to enclose the disc (+ its 3px stroke) so it stays visible outside.
    const SNAP_DEG = 0.0002;               // ~22 m — matches the snap threshold
    for (const wp of navWP) {
      if (!commChangeMap[wp.name] || !commChangeMap[wp.name].commChange) continue;
      const s = proj(wp);                // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
      let radius = tune('commChangeRingRadiusPx');
      const wi = state.waypoints.findIndex(
        r => Math.abs(r.lat - wp.lat) < SNAP_DEG && Math.abs(r.lng - wp.lng) < SNAP_DEG);
      if (wi !== -1) {
        const selected = state.selected &&
                         state.selected.type === 'wp' && state.selected.index === wi;
        const discR = (selected ? waypointGeom(wi).r + 2 : waypointGeom(wi).r) + 2;
        if (discR + ringWidth > radius) radius = discR + ringWidth;
      }
      octx.beginPath();
      octx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      octx.stroke();
      ringsDrawn.add(wp.name);
      ringRadii[wp.name] = radius;
    }
    octx.lineWidth = 1;
  }
  window.__commChangeRingsDrawn = ringsDrawn;
  window.__commChangeRingRadii = ringRadii;
}

// Issue #487: auto-seed a real note near any route waypoint that sits on a
// comm-change reporting point, so the frequency change shows on the printed
// plan. The note is a normal `state.notes` object (movable / editable /
// deletable) tagged with `cc: <ICAO>` for idempotency — a point is seeded
// at most once, and the tag survives reload / export / import, so re-draws
// or repeated snaps never duplicate it. The same pass also removes tagged
// notes whose route waypoint moved away from the referenced point. Seeding is
// driven ONLY from explicit placement/snap/toggle actions (drop, drag-end,
// search route-build, Show/Add Freq Changes); it must not be called from
// draw() / load / import / undo or it would resurrect notes the user deleted.
// Returns true if any note was added, changed, or removed so the caller can
// persist / repaint.
const COMM_CHANGE_SNAP_PX = 18;
function splitCommCalloutText(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.*?)(?:\s+(\d{3}(?:\.\d{1,3})?))$/);
  return {
    name: (m ? m[1] : s).trim(),
    freq: m ? commFormatFreq(m[2]) : '',
  };
}
function commFormatFreq(raw) {
  const s = String(raw || '').trim();
  if (/^\d{3}$/.test(s)) return s + '.00';
  if (/^\d{3}\.\d$/.test(s)) return s + '0';
  return s;
}
const COMM_FREQ_INPUT_MIN = '118';
const COMM_FREQ_INPUT_MAX = '136.975';
const COMM_FREQ_INPUT_STEP = '0.005';
function commNormalizeFreqInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/^\d{3}(?:\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < Number(COMM_FREQ_INPUT_MIN) ||
      n > Number(COMM_FREQ_INPUT_MAX)) return null;
  return commFormatFreq(s);
}
function commConfigureFreqInput(input) {
  if (!input) return input;
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = COMM_FREQ_INPUT_MIN;
  input.max = COMM_FREQ_INPUT_MAX;
  input.step = COMM_FREQ_INPUT_STEP;
  return input;
}
function commUseHebrewLabels() {
  const lang = (typeof window !== 'undefined' && window.__navLang) ||
    (typeof document !== 'undefined' && document.documentElement &&
      document.documentElement.lang) || '';
  return String(lang).toLowerCase().slice(0, 2) === 'he';
}
function commCallSignLabel(id, row) {
  if (commUseHebrewLabels() && row && typeof row.he === 'string' && row.he.trim()) {
    return row.he.trim();
  }
  if (row && typeof row.label === 'string' && row.label.trim()) return row.label.trim();
  return String(id || '').replace(/_/g, ' ').toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}
function commCallSignOptionNames(opt) {
  if (!opt) return [];
  const row = (opt.row && typeof opt.row === 'object') ? opt.row : {};
  return [opt.id, opt.label, row.label, row.he]
    .filter(v => typeof v === 'string' && v.trim())
    .map(v => v.trim());
}
function commCallSignOptionMatches(opt, raw) {
  const needle = String(raw || '').trim().toLocaleLowerCase();
  if (!needle) return false;
  return commCallSignOptionNames(opt)
    .some(v => v.toLocaleLowerCase() === needle);
}
const COMM_FREQ_OVERRIDES_KEY = 'navaid.commFreqOverrides';
function commCallSignIdKey(id) {
  return String(id || '').trim().toUpperCase();
}
function commReadFreqOverrides() {
  try {
    const raw = localStorage.getItem(COMM_FREQ_OVERRIDES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [id, freq] of Object.entries(parsed)) {
      const key = commCallSignIdKey(id);
      const val = commFormatFreq(freq);
      if (key && val) out[key] = val;
    }
    return out;
  } catch (e) {
    return {};
  }
}
function commWriteFreqOverrides(overrides) {
  try {
    const clean = {};
    for (const [id, freq] of Object.entries(overrides || {})) {
      const key = commCallSignIdKey(id);
      const val = commFormatFreq(freq);
      if (key && val) clean[key] = val;
    }
    if (Object.keys(clean).length) {
      localStorage.setItem(COMM_FREQ_OVERRIDES_KEY, JSON.stringify(clean));
    } else {
      localStorage.removeItem(COMM_FREQ_OVERRIDES_KEY);
    }
  } catch (e) {}
}
function commCatalogCallSignRow(id) {
  const key = commCallSignIdKey(id);
  const catalog = (typeof commChangeCallSigns === 'object' && commChangeCallSigns) || {};
  return catalog[key] || catalog[id] || null;
}
function commCallSignDefaultFreq(row) {
  if (!row || typeof row !== 'object') return '';
  if (typeof row.primary === 'string' && row.primary.trim()) return commFormatFreq(row.primary);
  if (typeof row.freq === 'string' && row.freq.trim()) return commFormatFreq(row.freq);
  return '';
}
function commCallSignTemplateFreq(id, row) {
  return commCallSignDefaultFreq(row || commCatalogCallSignRow(id));
}
function commCallSignOverrideFreq(id) {
  const key = commCallSignIdKey(id);
  return key ? (commReadFreqOverrides()[key] || '') : '';
}
function commCallSignEffectiveFreq(id, row) {
  return commCallSignOverrideFreq(id) || commCallSignTemplateFreq(id, row);
}
function commSetCallSignFreqOverride(id, freq) {
  const key = commCallSignIdKey(id);
  if (!key) return '';
  const formatted = commFormatFreq(freq);
  const template = commCallSignTemplateFreq(key);
  const overrides = commReadFreqOverrides();
  if (!formatted || (template && formatted === template)) delete overrides[key];
  else overrides[key] = formatted;
  commWriteFreqOverrides(overrides);
  return formatted || template || '';
}
function commApplyCallSignFreqOverride(id, freq) {
  const key = commCallSignIdKey(id);
  const effective = commSetCallSignFreqOverride(key, freq);
  if (!key || !effective || typeof state === 'undefined' || !Array.isArray(state.notes)) {
    return effective;
  }
  for (const n of state.notes) {
    const opt = commNoteCallSignOption(n);
    if (opt && commCallSignIdKey(opt.id) === key) {
      n.freq = effective;
      n.freqAuto = false;
    }
  }
  return effective;
}
function commResetCallSignFreqOverride(id) {
  const template = commCallSignTemplateFreq(id);
  return template ? commApplyCallSignFreqOverride(id, template) : '';
}
function commResetAllCallSignFreqOverrides() {
  const catalog = (typeof commChangeCallSigns === 'object' && commChangeCallSigns) || {};
  for (const id of Object.keys(catalog)) commResetCallSignFreqOverride(id);
  commWriteFreqOverrides({});
}
function commCallSignOptions(name) {
  const key = canonicalNavWaypointName(name);
  const cc = commChangeMap && key ? commChangeMap[key] : null;
  if (!cc || !Array.isArray(cc.callSigns)) return [];
  const catalog = (typeof commChangeCallSigns === 'object' && commChangeCallSigns) || {};
  const out = [];
  for (const rawId of cc.callSigns) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    const row = catalog[id] || catalog[id.toUpperCase()] || null;
    out.push({
      id,
      label: commCallSignLabel(id, row),
      freq: commCallSignEffectiveFreq(id, row),
      templateFreq: commCallSignTemplateFreq(id, row),
      overrideFreq: commCallSignOverrideFreq(id),
      row,
    });
  }
  return out;
}
function commCallSignOptionById(name, id) {
  const needle = String(id || '').trim().toLocaleLowerCase();
  if (!needle) return null;
  return commCallSignOptions(name)
    .find(o => String(o.id || '').trim().toLocaleLowerCase() === needle) || null;
}
function commStaticCalloutDefaults(name) {
  const key = canonicalNavWaypointName(name);
  const cc = commChangeMap && key ? commChangeMap[key] : null;
  const fallback = (typeof S !== 'undefined' && S.commChangeNoteText) || 'Freq change';
  const opt = commCallSignOptions(key)[0];
  if (opt) return { freqName: opt.id || opt.label || fallback, freq: opt.freq || '' };
  const raw = cc && (cc.to || cc.from || cc.note || cc.name || key);
  const d = splitCommCalloutText(raw || key || fallback);
  return { freqName: d.name || fallback, freq: d.freq };
}
function commNameKey(s) {
  return String(s || '').trim().toLocaleLowerCase()
    .replace(/[^0-9a-z\u0590-\u05ff]+/g, '');
}
function commNamesMatch(a, b) {
  const ak = commNameKey(a);
  const bk = commNameKey(b);
  if (!ak || !bk) return false;
  if (ak === bk) return true;
  return ak.length >= 4 && bk.length >= 4 &&
    (ak.includes(bk) || bk.includes(ak));
}
function commWaypointNameCandidates(wp) {
  const out = [];
  const push = v => {
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  };
  if (wp) push(wp.name);
  const key = canonicalNavWaypointName(wp && wp.name);
  push(key);
  if (Array.isArray(navWP) && key) {
    const ref = navWP.find(w => w && canonicalNavWaypointName(w.name) === key);
    if (ref) {
      push(ref.name);
      push(ref.en);
      push(ref.he);
    }
  }
  const af = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wp) : null;
  if (af) {
    push(af.name);
    push(af.en);
    push(af.he);
  }
  return out;
}
function commAllCallSignOptions() {
  const catalog = (typeof commChangeCallSigns === 'object' && commChangeCallSigns) || {};
  return Object.keys(catalog).map(id => ({
    id,
    label: commCallSignLabel(id, catalog[id]),
    freq: commCallSignEffectiveFreq(id, catalog[id]),
    templateFreq: commCallSignTemplateFreq(id, catalog[id]),
    overrideFreq: commCallSignOverrideFreq(id),
    row: catalog[id],
  }));
}
function commOptionPool(allowedIds) {
  const all = commAllCallSignOptions();
  if (!Array.isArray(allowedIds) || !allowedIds.length) return all;
  const allowed = new Set(allowedIds.map(id => String(id || '').toLocaleLowerCase()));
  return all.filter(o => allowed.has(String(o.id || '').toLocaleLowerCase()));
}
function commCallSignReferencePoints(opt, excludedNames) {
  const out = [];
  const excluded = new Set((Array.isArray(excludedNames) ? excludedNames : [])
    .map(canonicalNavWaypointName)
    .filter(Boolean));
  const add = p => {
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) out.push(p);
  };
  if (Array.isArray(airfields)) {
    for (const af of airfields) {
      const names = [af.name, af.en, af.he].filter(v => typeof v === 'string' && v.trim());
      if (commCallSignOptionNames(opt).some(a =>
        names.some(b => commNamesMatch(a, b)))) add(af);
    }
  }
  if (commChangeMap && typeof commChangeMap === 'object') {
    for (const [name, row] of Object.entries(commChangeMap)) {
      const key = canonicalNavWaypointName(name);
      if (excluded.has(key)) continue;
      if (!row || !Array.isArray(row.callSigns)) continue;
      if (!row.callSigns.some(id => String(id || '').toLocaleLowerCase() ===
          String(opt.id || '').toLocaleLowerCase())) continue;
      add(commChangeReferencePoint(key));
    }
  }
  return out;
}
function commCallSignReferenceDistance(wp, opt, excludedNames) {
  if (!wp) return Infinity;
  let best = Infinity;
  for (const ref of commCallSignReferencePoints(opt, excludedNames)) {
    best = Math.min(best, geo(wp, ref).dist);
  }
  return best;
}
function commInferRouteContextCallSignId(points, allowedIds, excludedNames) {
  const opts = commOptionPool(allowedIds);
  const pts = (Array.isArray(points) ? points : []).filter(Boolean);
  if (!pts.length || !opts.length) return '';
  for (const wp of pts) {
    const names = commWaypointNameCandidates(wp);
    for (const opt of opts) {
      if (commCallSignOptionNames(opt).some(a =>
        names.some(b => commNamesMatch(a, b)))) return opt.id;
    }
  }
  let best = null;
  let second = Infinity;
  for (const opt of opts) {
    let d = Infinity;
    for (const wp of pts) d = Math.min(d, commCallSignReferenceDistance(wp, opt, excludedNames));
    if (!Number.isFinite(d)) continue;
    if (!best || d < best.dist) {
      second = best ? best.dist : Infinity;
      best = { id: opt.id, dist: d };
    } else {
      second = Math.min(second, d);
    }
  }
  if (!best || best.dist > 25) return '';
  if (Number.isFinite(second) && second - best.dist < 0.75) return '';
  return best.id;
}
function commInferWaypointCallSignId(wp, allowedIds) {
  return commInferRouteContextCallSignId([wp], allowedIds, []);
}
function commRouteChangeEntries() {
  if (!commChangeMap || typeof state === 'undefined' ||
      !Array.isArray(state.waypoints)) return [];
  const out = [];
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    const name = canonicalNavWaypointName(wp && wp.name);
    const row = name && commChangeMap[name];
    if (!row || !row.commChange || !commChangeWaypointInRange(wp, name)) continue;
    const options = commCallSignOptions(name).map(o => o.id).filter(Boolean);
    if (!options.length) continue;
    out.push({ index: i, name, options, set: new Set(options) });
  }
  return out;
}
function commRouteDomain(entries, pos) {
  const ids = [];
  const push = id => { if (id && !ids.includes(id)) ids.push(id); };
  if (pos === 0) entries[0].options.forEach(push);
  else if (pos === entries.length) entries[entries.length - 1].options.forEach(push);
  else {
    entries[pos - 1].options.forEach(push);
    entries[pos].options.forEach(push);
  }
  return ids;
}
function commRouteDomainHint(entries, pos, allowedIds) {
  if (!entries.length || !Array.isArray(state.waypoints)) return '';
  const start = pos === 0 ? 0 : entries[pos - 1].index + 1;
  const end = pos === entries.length ? state.waypoints.length : entries[pos].index;
  const points = state.waypoints.slice(start, end);
  const excluded = [];
  if (pos > 0) excluded.push(entries[pos - 1].name);
  if (pos < entries.length) excluded.push(entries[pos].name);
  return commInferRouteContextCallSignId(points, allowedIds, excluded);
}
function commSolveRouteCallSigns(entries) {
  const n = entries.length;
  if (!n) return [];
  const domains = [];
  for (let i = 0; i <= n; i++) domains.push(commRouteDomain(entries, i));
  const domainHints = domains.map((ids, i) => commRouteDomainHint(entries, i, ids));
  let states = new Map();
  for (const id of domains[0]) {
    const hint = domainHints[0];
    const cost = hint ? (id === hint ? 0 : 50) : 0;
    states.set(id, { cost, path: [id] });
  }
  for (let i = 0; i < n; i++) {
    const next = new Map();
    for (const [prevId, prev] of states.entries()) {
      for (const id of domains[i + 1]) {
        if (!entries[i].set.has(prevId) || !entries[i].set.has(id)) continue;
        let cost = prev.cost;
        if (prevId === id && entries[i].options.length > 1) cost += 10;
        const idx = entries[i].options.indexOf(id);
        cost += (idx < 0 ? 1 : idx * 0.01);
        const hint = domainHints[i + 1];
        if (hint) cost += id === hint ? 0 : 50;
        const old = next.get(id);
        if (!old || cost < old.cost) next.set(id, { cost, path: prev.path.concat(id) });
      }
    }
    states = next;
    if (!states.size) return [];
  }
  let best = null;
  for (const cur of states.values()) {
    if (!best || cur.cost < best.cost) best = cur;
  }
  return best ? best.path : [];
}
function commRouteCalloutDefaultsMap() {
  const entries = commRouteChangeEntries();
  const path = commSolveRouteCallSigns(entries);
  if (!path.length) return {};
  const out = {};
  for (let i = 0; i < entries.length; i++) {
    const id = path[i + 1];
    const opt = commCallSignOptionById(entries[i].name, id);
    if (opt) out[entries[i].name] = { freqName: opt.id, freq: opt.freq || '' };
  }
  return out;
}
function commCalloutDefaults(name) {
  const key = canonicalNavWaypointName(name);
  const routeDefaults = commRouteCalloutDefaultsMap();
  return (key && routeDefaults[key]) || commStaticCalloutDefaults(key);
}
function commNoteCallSignOption(n) {
  if (!n || !n.cc || typeof n.freqName !== 'string' || !n.freqName.trim()) return null;
  return commCallSignOptions(n.cc)
    .find(o => commCallSignOptionMatches(o, n.freqName)) || null;
}
function commNoteName(n) {
  const opt = commNoteCallSignOption(n);
  if (opt) return opt.label;
  if (n && typeof n.freqName === 'string' && n.freqName.trim()) {
    return n.freqName.trim();
  }
  if (n && n.cc) {
    const d = commCalloutDefaults(n.cc);
    const def = commCallSignOptions(n.cc)
      .find(o => commCallSignOptionMatches(o, d.freqName));
    return def ? def.label : d.freqName;
  }
  return '';
}
function commNoteFreq(n) {
  const opt = commNoteCallSignOption(n);
  if (opt && opt.overrideFreq &&
      (n.freqAuto === true || !n.freq || commFormatFreq(n.freq) === (opt.templateFreq || ''))) {
    return opt.overrideFreq;
  }
  if (n && typeof n.freq === 'string' && n.freq.trim()) return commFormatFreq(n.freq);
  if (opt && opt.freq) return opt.freq;
  if (n && n.cc) return commCalloutDefaults(n.cc).freq;
  return '';
}
function noteLines(n) {
  if (n && n.cc) {
    const name = commNoteName(n);
    const freq = commNoteFreq(n);
    return [name ? name.toUpperCase() : '', freq].filter(Boolean);
  }
  return (n.text || '').split('\n');
}
function commCalloutTarget(n) {
  if (!n || !n.cc) return null;
  const key = canonicalNavWaypointName(n.cc);
  if (!key) return null;
  const routeWp = state.waypoints.find(w => w &&
    canonicalNavWaypointName(w.name) === key);
  if (routeWp) return routeWp;
  const refWp = Array.isArray(navWP) ? navWP.find(w => w && w.name === key) : null;
  return refWp || null;
}
function commCalloutDefaultTail(wp) {
  return {
    lat: r5(wp.lat + tune('commChangeNoteLatOffset')),
    lng: r5(wp.lng + tune('commChangeNoteLngOffset')),
  };
}
function commChangeReferencePoint(name) {
  const key = canonicalNavWaypointName(name);
  if (!key) return null;
  const row = commChangeMap && commChangeMap[key];
  if (row && Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
    return { name: key, lat: row.lat, lng: row.lng };
  }
  const refWp = Array.isArray(navWP)
    ? navWP.find(w => w && canonicalNavWaypointName(w.name) === key)
    : null;
  if (refWp) return refWp;
  const refAf = Array.isArray(airfields)
    ? airfields.find(a => a && a.name === key)
    : null;
  return refAf || null;
}
function commChangeWaypointInRange(wp, name) {
  if (!wp || typeof map === 'undefined' || !map) return false;
  const key = canonicalNavWaypointName(name);
  if (!key) return false;
  const ref = commChangeReferencePoint(key);
  // When there is no reference position, fall back to name equality.
  if (!ref) return canonicalNavWaypointName(wp.name) === key;
  // Position is authoritative — a renamed waypoint still triggers if it
  // sits on the comm-change reference point (name check removed so renaming
  // does not silently disable the frequency-change indicator).
  const a = map.latLngToContainerPoint([wp.lat, wp.lng]);
  const b = map.latLngToContainerPoint([ref.lat, ref.lng]);
  return Math.hypot(a.x - b.x, a.y - b.y) <= COMM_CHANGE_SNAP_PX;
}
function hasActiveCommChangeWaypoint(name) {
  if (!Array.isArray(state.waypoints)) return false;
  const key = canonicalNavWaypointName(name);
  return !!key && state.waypoints.some(w => commChangeWaypointInRange(w, key));
}
function normalizeCommChangeSuppressions(raw) {
  const src = raw === undefined ? state.commChangeSuppressions : raw;
  const out = [];
  if (Array.isArray(src)) {
    for (const v of src) {
      const key = canonicalNavWaypointName(v);
      if (key && !out.includes(key)) out.push(key);
    }
  }
  state.commChangeSuppressions = out;
  return out;
}
function isCommChangeSuppressed(name) {
  const key = canonicalNavWaypointName(name);
  return !!key && normalizeCommChangeSuppressions().includes(key);
}
function suppressCommChange(name) {
  const key = canonicalNavWaypointName(name);
  if (!key) return false;
  const suppressions = normalizeCommChangeSuppressions();
  if (suppressions.includes(key)) return false;
  suppressions.push(key);
  state.commChangeSuppressions = suppressions;
  return true;
}
function unsuppressCommChange(name) {
  const key = canonicalNavWaypointName(name);
  if (!key) return false;
  const suppressions = normalizeCommChangeSuppressions()
    .filter(v => canonicalNavWaypointName(v) !== key);
  if (suppressions.length === state.commChangeSuppressions.length) return false;
  state.commChangeSuppressions = suppressions;
  return true;
}
function pruneStaleCommChangeSuppressions() {
  if (!Array.isArray(state.commChangeSuppressions)) {
    state.commChangeSuppressions = [];
    return false;
  }
  const before = normalizeCommChangeSuppressions();
  const kept = before.filter(name => {
    const row = commChangeMap && commChangeMap[name];
    return row && row.commChange && hasActiveCommChangeWaypoint(name);
  });
  if (kept.length === before.length) return false;
  state.commChangeSuppressions = kept;
  return true;
}
function pruneStaleCommChangeNotes() {
  if (!Array.isArray(state.notes)) return false;
  let changed = false;
  const selectedNote = state.selected && state.selected.type === 'note'
    ? state.notes[state.selected.index] : null;
  const kept = [];
  for (const n of state.notes) {
    if (n && n.cc && !hasActiveCommChangeWaypoint(n.cc)) {
      changed = true;
      continue;
    }
    kept.push(n);
  }
  if (!changed) return false;
  state.notes = kept;
  if (selectedNote) {
    const idx = state.notes.indexOf(selectedNote);
    state.selected = idx >= 0 ? { type: 'note', index: idx } : null;
  }
  return true;
}
function seedCommChangeNotes() {
  if (!showCommChange) return false;
  if (!commChangeMap || typeof state === 'undefined' ||
      !Array.isArray(state.waypoints) || !Array.isArray(state.notes)) return false;
  let changed = pruneStaleCommChangeNotes();
  if (pruneStaleCommChangeSuppressions()) changed = true;
  const routeDefaults = commRouteCalloutDefaultsMap();
  for (const wp of state.waypoints) {
    if (!wp) continue;
    // Resolve comm-change key: try stored name first, then fall back to
    // coordinate scan so a renamed waypoint at a known ICAO position still
    // triggers (e.g. move back to DEROR after rename → freq change shows).
    let nm = canonicalNavWaypointName(wp && wp.name);
    let cc = nm ? commChangeMap[nm] : null;
    if ((!cc || !cc.commChange) && Array.isArray(navWP) && typeof map !== 'undefined' && map) {
      for (const nwp of navWP) {
        const k = canonicalNavWaypointName(nwp.name);
        if (!k || !commChangeMap[k] || !commChangeMap[k].commChange) continue;
        const ref = commChangeReferencePoint(k);
        if (!ref) continue;
        const a = map.latLngToContainerPoint([wp.lat, wp.lng]);
        const b = map.latLngToContainerPoint([ref.lat, ref.lng]);
        if (Math.hypot(a.x - b.x, a.y - b.y) <= COMM_CHANGE_SNAP_PX) {
          nm = k; cc = commChangeMap[k]; break;
        }
      }
    }
    if (!nm || !cc || !cc.commChange) continue;
    if (!commChangeWaypointInRange(wp, nm)) continue;
    const callout = routeDefaults[nm] || commStaticCalloutDefaults(nm);
    const existing = state.notes.find(n => n && canonicalNavWaypointName(n.cc) === nm);
    if (existing) {
      if (unsuppressCommChange(nm)) changed = true;
      if (existing.cc !== nm) { existing.cc = nm; changed = true; }
      if (!existing.freqName) { existing.freqName = callout.freqName; changed = true; }
      if (!existing.freq) { existing.freq = callout.freq; changed = true; }
      if (existing.freqAuto === true &&
          (existing.freqName !== callout.freqName || existing.freq !== callout.freq)) {
        existing.freqName = callout.freqName;
        existing.freq = callout.freq;
        changed = true;
      }
      // Earlier auto-generated callouts were note boxes above the point.
      // Move only notes still sitting on those generated positions to the
      // chart-style west tail; user-dragged callouts keep their location.
      const oldLats = [r5(wp.lat + 0.012), r5(wp.lat + 0.07)];
      const oldLng = r5(wp.lng);
      if (oldLats.some(oldLat => Math.abs(existing.lat - oldLat) < 0.00002) &&
          Math.abs(existing.lng - oldLng) < 0.00002) {
        const tail = commCalloutDefaultTail(wp);
        existing.lat = tail.lat;
        existing.lng = tail.lng;
        changed = true;
      }
      continue;
    }
    if (isCommChangeSuppressed(nm)) continue;
    const tail = commCalloutDefaultTail(wp);
    state.notes.push({
      lat: tail.lat,
      lng: tail.lng,
      text: (typeof S !== 'undefined' && S.commChangeNoteText) || 'Freq change',
      color: NOTE_DEFAULT_COLOR,
      shape: 'rect',
      cc: nm,
      freqName: callout.freqName,
      freq: callout.freq,
      freqAuto: true,
    });
    changed = true;
  }
  return changed;
}
window.seedCommChangeNotes = seedCommChangeNotes;
window.suppressCommChange = suppressCommChange;
window.unsuppressCommChange = unsuppressCommChange;
window.normalizeCommChangeSuppressions = normalizeCommChangeSuppressions;

function drawLegs() {
  const zoomScale = legZoomScale();

  // Pre-compute cumulative outbound times (walk legs in reverse so each
  // entry is "total return time from the last waypoint through leg i").
  const cumOutArr = new Array(state.legs.length).fill('--');
  if (showReturn) {
    let cumOut = 0;
    for (let j = state.legs.length - 1; j >= 0; j--) {
      const Aj = state.waypoints[j], Bj = state.waypoints[j + 1];
      if (!Aj || !Bj) continue;
      const { dist: dj } = geo(Aj, Bj);
      const dur = state.legs[j].outboundSpeed > 0 ? dj / state.legs[j].outboundSpeed : 0;
      cumOut += dur;
      cumOutArr[j] = cumOut > 0 ? toHMS(cumOut) : '--';
    }
  }

  let cumInH = 0;  // running inbound cumulative time (hours)

  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    if (!A || !B) continue;
    const leg = state.legs[i];
    const sa = proj(A), sb = proj(B);
    const selected = state.selected &&
                     state.selected.type === 'leg' &&
                     state.selected.index === i;

    const lw = (typeof legLineWidth === 'number' && legLineWidth > 0) ? legLineWidth : 1;
    octx.lineCap = 'round';
    octx.strokeStyle = selected ? tune('selectedColor') : tune('inkColor');
    octx.lineWidth = selected ? tune('routeSelectedLineWidthPx') * lw : tune('routeLineWidthPx') * lw;
    octx.beginPath();
    octx.moveTo(sa.x, sa.y);
    octx.lineTo(sb.x, sb.y);
    octx.stroke();
    octx.lineCap = 'butt';

    if (showDrift) drawDriftLines(sa, sb);

    const { dist, brg } = geo(A, B);
    const durH = leg.flightSpeed > 0 ? dist / leg.flightSpeed : 0;
    const durOut = leg.outboundSpeed > 0 ? dist / leg.outboundSpeed : 0;
    const magIn = toMagnetic(brg);
    const magOut = (magIn + 180) % 360;
    const timeStr = durH > 0 ? toHMS(durH) : '--';
    const timeStrOut = durOut > 0 ? toHMS(durOut) : '--';

    drawMinuteMarkers(sa, sb, durH);

    const ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    let dx = sb.x - sa.x, dy = sb.y - sa.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    // Strict validator (`_normalizeLegLabel` + `syncLegs`) should keep
    // these defined in practice — every code path that touches a leg
    // stamps `inLabel`/`outLabel` via `_defaultLegLabels()`. Fallback
    // exists as a defensive guard for hand-edited / corrupted state.
    const defaults = (typeof _defaultLegLabels === 'function')
      ? _defaultLegLabels()
      : { inLabel: { a: 0, _default: 1, _m: 1 },
          outLabel: { a: 0, _default: 1, _m: 1 } };
    const inP = leg.inLabel || defaults.inLabel;
    const outP = leg.outLabel || defaults.outLabel;
    // Issue #394: a default (unmodified) kite sits just outside the drift
    // cone instead of at a fixed per-zoom pixel offset. The cone's
    // perpendicular extent at the leg midpoint comes from the configured
    // drift angle; a margin keeps the kite visibly clear of the dashed
    // drift lines at every zoom / leg length. User-dragged offsets
    // (no `_default` flag) keep the existing `p * legZoomScale()` path so
    // hand-positioned kites round-trip exactly as PR #393 designed.
    const driftPerp = legDefaultLabelPerp(len);
    const inPerp  = inP._default  ?  driftPerp : (inP.p  || 0) * zoomScale;
    const outPerp = outP._default ? -driftPerp : (outP.p || 0) * zoomScale;
    const inAlong  = (inP.a  || 0) * zoomScale;
    const outAlong = (outP.a || 0) * zoomScale;
    cumInH += durH;
    const cumInStr = cumInH > 0 ? toHMS(cumInH) : '--';

    drawLegArrow(mid.x + dx * inAlong + nx * inPerp,
      mid.y + dy * inAlong + ny * inPerp,
      ang, pad3(magIn), timeStr, formatAltitudeValue(leg.inboundAltitude, leg, 'inboundAltitude'),
      tune('inkColor'), yellowFill(0.80), needsHalo(i, 'in'), zoomScale);
    // Cumulative inbound time: < [time], position driven by leg.cumLabel
    // (default: at B waypoint, same perpendicular side as main kite).
    const defCum = { a: 0, _default: 1, _m: 1 };
    if (showCumTime) {
      const cumP = leg.cumLabel || defCum;
      const cumPerp  = cumP._default ? driftPerp : (cumP.p || 0) * zoomScale;
      const cumAlong = (cumP.a || 0) * zoomScale;
      const cumX = sb.x + dx * cumAlong + nx * cumPerp;
      const cumY = sb.y + dy * cumAlong + ny * cumPerp;
      drawCumTimeArrow(cumX, cumY,
        Math.atan2(sb.y - cumY, sb.x - cumX),
        cumInStr, tune('inkColor'), yellowFill(0.80), zoomScale);
    }

    if (showReturn && legAllowsReturn(i)) {
      drawLegArrow(mid.x + dx * outAlong + nx * outPerp,
        mid.y + dy * outAlong + ny * outPerp, ang + Math.PI,
        pad3(magOut), timeStrOut, formatAltitudeValue(leg.outboundAltitude, leg, 'outboundAltitude'),
        tune('inkColor'), 'rgba(255,204,214,0.80)', needsHalo(i, 'out'), zoomScale);
      if (showCumTime) {
        // Cumulative return time kite at A waypoint (return destination).
        // Own offset (cumLabelRet), anchored at A with the same +dx/+nx frame
        // as the inbound kite so its drag math is identical; default sits on
        // the opposite perpendicular side (-driftPerp).
        const cumRetP = leg.cumLabelRet || defCum;
        const cumRetPerp  = cumRetP._default ? -driftPerp : (cumRetP.p || 0) * zoomScale;
        const cumRetAlong = (cumRetP.a || 0) * zoomScale;
        const cumRetX = sa.x + dx * cumRetAlong + nx * cumRetPerp;
        const cumRetY = sa.y + dy * cumRetAlong + ny * cumRetPerp;
        drawCumTimeArrow(cumRetX, cumRetY,
          Math.atan2(sa.y - cumRetY, sa.x - cumRetX),
          cumOutArr[i], tune('inkColor'), 'rgba(255,204,214,0.80)', zoomScale);
      }
    }
    if (showMidLeg) drawDistanceBadge(mid.x, mid.y, dist);

    // Wind arrow (#722): show the wind that applies to each leg — the
    // route-wide wind, or a per-leg override where one is set. A leg that
    // overrides the route wind is drawn slightly bolder so the difference is
    // visible at a glance. Drawn at 30% along the leg (clear of the midpoint
    // distance badge and the minute-marker numbers).
    if (window.showWind && typeof legWindFor === 'function') {
      const lw2 = legWindFor(leg);
      if (lw2) {
        const f = 0.3;
        const px = sa.x + (sb.x - sa.x) * f, py = sa.y + (sb.y - sa.y) * f;
        const pll = { lat: A.lat + (B.lat - A.lat) * f,
                      lng: A.lng + (B.lng - A.lng) * f };
        const isOverride = !!(leg.wind &&
          (Number.isFinite(leg.wind.dir) || Number.isFinite(leg.wind.speed)));
        drawWindArrow(px, py, pll, lw2, isOverride);
      }
    }
  }
}

// Screen angle (radians) of the direction the wind BLOWS TOWARD at a given
// lat/lng. Computed by projecting a small geographic offset instead of using
// the compass angle directly so it stays correct under map rotation
// (map.setBearing) — same reasoning as the kite angles, which come from
// projected points.
function windScreenAngle(latlng, windDirFrom) {
  const to = ((windDirFrom + 180) * Math.PI) / 180;
  const eps = 0.02;                                   // ~1.2 NM; angle only
  const p1 = proj(latlng);
  const p2 = proj({
    lat: latlng.lat + Math.cos(to) * eps,
    lng: latlng.lng + Math.sin(to) * eps / Math.cos((latlng.lat * Math.PI) / 180),
  });
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

// Blue wind arrow + "dir/speed" label for a per-leg wind override.
function drawWindArrow(x, y, latlng, wind, emphasis) {
  const ang = windScreenAngle(latlng, wind.dir);
  // Shaft length scales with wind speed (≈ stronger wind = longer barb),
  // clamped so a light breeze is still visible and a gale doesn't span the
  // whole leg. Override legs draw a touch longer/bolder.
  const base = Math.max(16, Math.min(70, 12 + (wind.speed || 0) * 1.1));
  const len = emphasis ? base * 1.15 : base;
  const head = emphasis ? 11 : 9;
  const cx = Math.cos(ang), cy = Math.sin(ang);
  const x1 = x + cx * len / 2, y1 = y + cy * len / 2;
  octx.save();
  octx.strokeStyle = '#0b5ed7';
  octx.fillStyle = '#0b5ed7';
  octx.lineWidth = emphasis ? 3 : 2;
  // White halo so the arrow reads over busy chart tiles.
  octx.lineJoin = 'round';
  octx.beginPath();
  octx.moveTo(x - cx * len / 2, y - cy * len / 2);
  octx.lineTo(x1, y1);
  octx.save();
  octx.strokeStyle = 'rgba(255,255,255,0.85)';
  octx.lineWidth = (emphasis ? 3 : 2) + 3;
  octx.stroke();
  octx.restore();
  octx.stroke();
  octx.beginPath();                                   // arrow head
  octx.moveTo(x1, y1);
  octx.lineTo(x1 - Math.cos(ang - 0.4) * head, y1 - Math.sin(ang - 0.4) * head);
  octx.lineTo(x1 - Math.cos(ang + 0.4) * head, y1 - Math.sin(ang + 0.4) * head);
  octx.closePath();
  octx.fill();
  const label = pad3(wind.dir) + '/' + wind.speed;
  octx.font = 'bold 11px sans-serif';
  octx.lineWidth = 3;                                 // text halo
  octx.strokeStyle = 'rgba(255,255,255,0.9)';
  octx.strokeText(label, x1 + 6, y1 + 3);
  octx.fillText(label, x1 + 6, y1 + 3);
  octx.restore();
}

// Drift reference lines, one from each end, defaulting to half the leg length.
function drawDriftLines(sa, sb) {
  const a = driftAngleRad();
  const c = Math.cos(a), s = Math.sin(a);
  const abx = sb.x - sa.x, aby = sb.y - sa.y;
  const bax = -abx, bay = -aby;
  const dlw = (typeof driftLineWidth === 'number' && driftLineWidth > 0) ? driftLineWidth : 1;
  const lenFactor = tune('driftLengthFactor');
  octx.save();
  octx.setLineDash([tune('driftDashOnPx'), tune('driftDashOffPx')]);
  octx.lineWidth = tune('driftStrokeWidthPx') * dlw;
  octx.strokeStyle = colorWithAlpha(tune('driftLineColor'), tune('driftLineAlpha'));
  octx.beginPath();
  octx.moveTo(sa.x, sa.y);
  octx.lineTo(sa.x + (abx * c - aby * s) * lenFactor, sa.y + (abx * s + aby * c) * lenFactor);
  octx.moveTo(sb.x, sb.y);
  octx.lineTo(sb.x + (bax * c - bay * s) * lenFactor, sb.y + (bax * s + bay * c) * lenFactor);
  octx.stroke();
  octx.restore();
}

function drawMinuteMarkers(sa, sb, durH) {
  const totalMin = durH * 60;
  if (totalMin < 1) return;
  let dx = sb.x - sa.x, dy = sb.y - sa.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const nx = -dy, ny = dx;
  octx.font = `bold ${tune('minuteMarkerFontPx')}px sans-serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  const count = Math.floor(totalMin);
  for (let m = 1; m <= count; m++) {
    const f = m / totalMin;
    const px = sa.x + (sb.x - sa.x) * f;
    const py = sa.y + (sb.y - sa.y) * f;
    const even = m % 2 === 0;
    const tick = even ? tune('minuteTickEvenPx') : tune('minuteTickOddPx');
    octx.strokeStyle = tune('inkColor');
    octx.lineWidth = even ? tune('minuteTickEvenWidthPx') : tune('minuteTickOddWidthPx');
    octx.beginPath();
    octx.moveTo(px - nx * tick, py - ny * tick);
    octx.lineTo(px + nx * tick, py + ny * tick);
    octx.stroke();
    if (even) {                         // minute number past the tick end
      const tx = px + nx * (tick + tune('minuteLabelOffsetPx'));
      const ty = py + ny * (tick + tune('minuteLabelOffsetPx'));
      octx.fillStyle = tune('inkColor');
      octx.font = `bold ${tune('minuteMarkerFontPx')}px sans-serif`;
      octx.fillText(String(m), tx, ty);
    }
  }
  octx.textAlign = 'left';
}

// Highlight when altitude OR speed differs from the adjacent leg.
// 'in'  -> compare with previous leg's inbound altitude/speed.
// 'out' -> compare with next leg's outbound altitude/speed (return direction).
function needsHalo(i, which) {
  if (!highlightDiff) return false;
  const cur = state.legs[i];
  if (which === 'in') {
    if (i === 0) return false;
    const prev = state.legs[i - 1];
    return !sameAltitudeValue(cur.inboundAltitude, prev.inboundAltitude) ||
           cur.flightSpeed     !== prev.flightSpeed;
  }
  if (i === state.legs.length - 1) return false;
  const next = state.legs[i + 1];
  return !sameAltitudeValue(cur.outboundAltitude, next.outboundAltitude) ||
         cur.outboundSpeed    !== next.outboundSpeed;
}

// Cumulative-time marker: < [time]
// A backward-pointing triangle (tip toward the leg origin) joined to a single
// rectangle cell showing the running total time from departure to this leg.
// Drawn on the opposite perpendicular side from the main inbound kite so both
// markers are always visible without overlap.
function drawCumTimeArrow(cx, cy, flightAng, cumTime, accent, fill, sc) {
  sc = sc ?? 1;
  const W = tune('cumKiteHeightPx') * sc;
  const cell = tune('cumKiteCellWidthPx') * sc;
  const Lt = tune('cumKiteTriangleLenPx') * sc;
  const L = Lt + cell;
  // Pentagon: tip on the LEFT (= backward along flightAng), rectangle on right.
  octx.save();
  octx.translate(cx, cy);
  octx.rotate(flightAng);
  const xb = L / 2 - Lt;                // rectangle/triangle junction
  octx.beginPath();
  octx.moveTo(-L / 2, -W / 2);          // top-left of rectangle
  octx.lineTo(xb,     -W / 2);
  octx.lineTo( L / 2,  0);              // → tip pointing toward B waypoint
  octx.lineTo(xb,      W / 2);
  octx.lineTo(-L / 2,  W / 2);          // bottom-left of rectangle
  octx.closePath();
  octx.fillStyle = fill;
  octx.fill();
  octx.lineWidth = tune('cumKiteBorderPx') * sc;
  octx.strokeStyle = accent;
  octx.stroke();
  octx.restore();

  const fontPx = Math.max(4, Math.round(tune('cumKiteTextPx') * sc));
  const cos = Math.cos(flightAng), sin = Math.sin(flightAng);
  const textLx = -L / 2 + cell / 2;     // centre of the rectangle cell (excludes the triangle)
  const p = { x: cx + textLx * cos, y: cy + textLx * sin };
  octx.save();
  octx.translate(p.x, p.y);
  // Text orientation matches the navigation kite (flightAng+π = ang+π/2 when kite is at ang-π/2).
  let textAng = flightAng + Math.PI;
  if (Math.cos(textAng) < 0) textAng += Math.PI;
  octx.rotate(textAng);
  octx.font = `bold ${fontPx}px sans-serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillStyle = tune('kiteTextColor');
  octx.fillText(cumTime, 0, 0);
  octx.restore();
}

// Navigation leg marker: a two-cell rectangle (altitude, time) joined to a
// triangle (heading) pointing in the flight direction. Text runs across the
// marker and is locked to its orientation.
function drawLegArrow(cx, cy, flightAng, head, time, alt, accent, fill, halo, sc) {
  sc = sc ?? 1;
  const W = tune('legKiteHeightPx') * sc;
  const cell = tune('legKiteCellWidthPx') * sc;
  const Lt = tune('legKiteTriangleLenPx') * sc;
  const Lr = cell * 2, L = Lr + Lt;
  const xb = -L / 2 + Lr;

  octx.save();
  octx.translate(cx, cy);
  octx.rotate(flightAng);
  octx.beginPath();
  octx.moveTo(-L / 2, -W / 2);
  octx.lineTo(xb, -W / 2);
  octx.lineTo(L / 2, 0);
  octx.lineTo(xb, W / 2);
  octx.lineTo(-L / 2, W / 2);
  octx.closePath();
  if (halo) {                            // purple band around the marker
    octx.lineJoin = 'round';
    octx.lineWidth = tune('legKiteHaloPx') * sc;
    octx.strokeStyle = tune('legKiteHaloColor');
    octx.stroke();
    octx.lineJoin = 'miter';
  }
  octx.fillStyle = fill;
  octx.fill();
  octx.lineWidth = tune('legKiteBorderPx') * sc;
  octx.strokeStyle = accent;
  octx.stroke();
  octx.lineWidth = tune('legKiteDividerPx') * sc;
  for (const dx of [-L / 2 + cell, xb]) {
    octx.beginPath();
    octx.moveTo(dx, -W / 2);
    octx.lineTo(dx, W / 2);
    octx.stroke();
  }
  octx.restore();

  const fontPx = Math.max(4, Math.round(tune('legKiteTextPx') * sc));
  const fontPxH = Math.max(4, Math.round(tune('legKiteHeadingTextPx') * sc));
  const ta = flightAng + Math.PI / 2;
  const cos = Math.cos(flightAng), sin = Math.sin(flightAng);
  const at = lx => ({ x: cx + lx * cos, y: cy + lx * sin });
  const pAlt = at(-L / 2 + cell * 0.5);
  const pTime = at(-L / 2 + cell * 1.5);
  const pHead = at(xb + Lt * tune('legKiteHeadingAnchor'));
  drawRotText(pAlt.x, pAlt.y, ta, alt, `bold ${fontPx}px sans-serif`, tune('kiteTextColor'));
  drawRotText(pTime.x, pTime.y, ta, time, `bold ${fontPx}px sans-serif`, tune('kiteTextColor'));
  drawRotText(pHead.x, pHead.y, ta, head, `bold ${fontPxH}px sans-serif`, tune('kiteTextColor'));
}

function drawRotText(x, y, ang, text, font, color) {
  octx.save();
  octx.translate(x, y);
  octx.rotate(ang);
  octx.font = font;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillStyle = color;
  octx.fillText(text, 0, 0);
  octx.restore();
}

function drawDistanceBadge(cx, cy, dist) {
  octx.beginPath();
  octx.arc(cx, cy, tune('distanceBadgeRadiusPx'), 0, Math.PI * 2);
  octx.fillStyle = yellowFill(0.90);
  octx.fill();
  octx.lineWidth = tune('distanceBadgeBorderPx');
  octx.strokeStyle = tune('inkColor');
  octx.stroke();
  octx.fillStyle = tune('inkColor');
  octx.font = `bold ${tune('distanceBadgeFontPx')}px sans-serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(dist.toFixed(1), cx, cy);
  octx.textAlign = 'left';
}

// Label to draw inside a waypoint circle, plus the radius and font px
// needed to fit it. Scaled by wpSize slider × zoom (geographic footprint
// stays roughly constant; floor at 0.35× so markers stay visible when zoomed out).
function waypointGeom(i) {
  const wp = state.waypoints[i];
  // Match wpLabel() / inspector placeholder ("WP N"), not a bare digit.
  const label = showWpNames
    ? (navName((wp.name || '').trim()) || (S.wpPrefix + (i + 1)))
    : '';
  const zoomScale = Math.max(tune('waypointMinZoomScale'), Math.pow(2, map.getZoom() - 12));
  const scale = wpSize * zoomScale;
  const fontPx = Math.max(4, Math.round(tune('waypointFontPx') * scale));
  octx.font = `bold ${fontPx}px sans-serif`;
  const w = octx.measureText(label).width;
  const minR = tune('waypointBaseRadiusPx') * scale;
  return { label, fontPx, r: Math.max(minR, w / 2 + fontPx * tune('waypointTextPadFactor')) };
}

function drawWaypoints() {
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    const s = proj(wp);
    const selected = state.selected &&
                     state.selected.type === 'wp' &&
                     state.selected.index === i;
    const { label, fontPx, r } = waypointGeom(i);
    const radius = selected ? r + tune('waypointSelectedRadiusAddPx') : r;

    octx.beginPath();
    octx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    octx.fillStyle = selected ? tune('selectedColor') : yellowFill(0.60);
    octx.fill();
    octx.lineWidth = tune('waypointStrokeWidthPx');
    octx.strokeStyle = tune('inkColor');
    octx.stroke();

    octx.save();
    octx.translate(s.x, s.y);
    if (wpNameAngle) octx.rotate(wpNameAngle * Math.PI / 180);
    octx.font = `bold ${fontPx}px sans-serif`;
    octx.fillStyle = tune('inkColor');
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(label, 0, 0);
    octx.restore();
    octx.textAlign = 'left';
  }
}

// --- notes (free-text annotation boxes) ------------------------------
function noteFont() {
  return `bold ${tune('noteFontPx')}px sans-serif`;
}

function noteRect(i) {
  const n = state.notes[i];
  if (n && n.cc) return commCalloutRect(n);
  const s = proj(n);
  const lines = noteLines(n);
  const lineH = tune('noteLineHeightPx');
  octx.font = noteFont();
  let maxW = 1;
  for (const l of lines) {
    const w = octx.measureText(l || ' ').width;
    if (w > maxW) maxW = w;
  }
  let w = Math.max(maxW + tune('notePadXPx') * 2, tune('noteMinWidthPx'));
  let h = Math.max(1, lines.length) * lineH + tune('notePadYPx') * 2;
  const oval = n.shape === 'oval';
  if (oval) { w *= Math.SQRT2; h *= Math.SQRT2; }   // ellipse must bound the text
  return { x: s.x - w / 2, y: s.y - h / 2, w, h, lines, oval };
}

function commCalloutTextMetrics(lines) {
  const name = lines[0] || '';
  const freq = lines[1] || '';
  const namePx = tune('commChangeNameFontPx');
  const freqPx = tune('commChangeFreqFontPx');
  const oldFont = octx.font;
  octx.font = `bold ${namePx}px sans-serif`;
  const nameW = octx.measureText(name || ' ').width;
  octx.font = `bold ${freqPx}px sans-serif`;
  const freqW = octx.measureText(freq || ' ').width;
  octx.font = oldFont;
  return { name, freq, namePx, freqPx, nameW, freqW };
}

function colorWithAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  const m = typeof color === 'string' && color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function commCalloutGeom(n) {
  const target = commCalloutTarget(n);
  if (!target) return null;
  const lines = noteLines(n);
  const text = commCalloutTextMetrics(lines);
  const targetCenter = proj(target);
  const fp = proj(n);
  let dx = fp.x - targetCenter.x;
  let dy = fp.y - targetCenter.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return null;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const key = canonicalNavWaypointName(n.cc);
  const routeIdx = state.waypoints.findIndex(w => w &&
    canonicalNavWaypointName(w.name) === key);
  const targetRadius = routeIdx >= 0
    ? waypointGeom(routeIdx).r + tune('waypointStrokeWidthPx') / 2
    : tune('commChangeRingRadiusPx') + tune('commChangeRingWidthPx') / 2;
  const startGap = Math.max(0, tune('commChangeArrowStartGapPx'));
  const startClear = Math.min(Math.max(0, len - 4), targetRadius + startGap);
  const tp = {
    x: targetCenter.x + ux * startClear,
    y: targetCenter.y + uy * startClear,
  };
  dx = fp.x - tp.x;
  dy = fp.y - tp.y;
  const pathLen = Math.hypot(dx, dy) || 1;
  const width = tune('commChangeArrowWidthPx');
  const halo = tune('commChangeArrowHaloPx');
  const bolt = tune('commChangeArrowBoltPx');
  const boltAngle = tune('commChangeArrowBoltAngleDeg') * Math.PI / 180;
  const boltX = ux * Math.cos(boltAngle) + nx * Math.sin(boltAngle);
  const boltY = uy * Math.cos(boltAngle) + ny * Math.sin(boltAngle);
  const bend1 = {
    x: tp.x + dx * tune('commChangeArrowBend1Along') + boltX * bolt,
    y: tp.y + dy * tune('commChangeArrowBend1Along') + boltY * bolt,
  };
  const bend2 = {
    x: tp.x + dx * tune('commChangeArrowBend2Along') - boltX * bolt,
    y: tp.y + dy * tune('commChangeArrowBend2Along') - boltY * bolt,
  };
  const bends = [bend1, bend2];
  const points = [tp, ...bends, fp];
  const segs = [];
  let totalPath = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen <= 0) continue;
    segs.push({ a, b, len: segLen });
    totalPath += segLen;
  }
  let want = totalPath * tune('commChangeTextAlong');
  let textSeg = segs[segs.length - 1];
  for (const seg of segs) {
    if (want <= seg.len) { textSeg = seg; break; }
    want -= seg.len;
  }
  const textT = textSeg ? Math.max(0, Math.min(1, want / textSeg.len)) : 0;
  const tx = textSeg ? textSeg.a.x + (textSeg.b.x - textSeg.a.x) * textT : fp.x;
  const ty = textSeg ? textSeg.a.y + (textSeg.b.y - textSeg.a.y) * textT : fp.y;
  let textAngle = textSeg ? Math.atan2(textSeg.b.y - textSeg.a.y, textSeg.b.x - textSeg.a.x)
                          : Math.atan2(uy, ux);
  if (Math.cos(textAngle) < 0) textAngle += Math.PI;
  const textGap = tune('commChangeTextGapPx');
  return {
    target: tp, targetCenter, targetRadius, startGap, tail: fp, bends, bend1, bend2,
    ux, uy, nx, ny, len: pathLen, width, halo, textGap,
    textX: tx, textY: ty, textAngle, text, lines,
  };
}

function commCalloutRect(n) {
  const g = commCalloutGeom(n);
  if (!g) {
    const s = proj(n);
    return { x: s.x - 20, y: s.y - 20, w: 40, h: 40, lines: noteLines(n), oval: false, comm: true };
  }
  const maxTextW = Math.max(g.text.nameW, g.text.freqW);
  const textH = g.text.namePx + g.text.freqPx + g.width + g.textGap * 2;
  const pad = Math.max(g.width + g.halo * 2, 16) + 8;
  const xs = [g.tail.x, g.target.x, ...g.bends.map(p => p.x),
    g.textX - maxTextW / 2, g.textX + maxTextW / 2];
  const ys = [g.tail.y, g.target.y, ...g.bends.map(p => p.y),
    g.textY - textH / 2, g.textY + textH / 2];
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, lines: g.lines, oval: false, comm: true };
}

function strokeCommCalloutShape(g, width, style, alpha) {
  octx.strokeStyle = style;
  octx.globalAlpha = alpha;
  octx.lineWidth = width;
  octx.lineCap = tune('commChangeArrowLineCap');
  octx.lineJoin = tune('commChangeArrowLineJoin');
  octx.miterLimit = tune('commChangeArrowMiterLimit');
  octx.beginPath();
  octx.moveTo(g.target.x, g.target.y);
  for (const p of g.bends) octx.lineTo(p.x, p.y);
  octx.lineTo(g.tail.x, g.tail.y);
  octx.stroke();
  octx.globalAlpha = 1;
}

function drawCommCalloutText(g) {
  const name = g.text.name ? g.text.name.toUpperCase() : '';
  const freq = g.text.freq || '';
  if (!name && !freq) return;
  octx.save();
  octx.translate(g.textX, g.textY);
  octx.rotate(g.textAngle);
  octx.textAlign = 'center';
  octx.lineJoin = 'round';
  const halo = colorWithAlpha(tune('commChangeTextHaloColor'), tune('commChangeTextHaloAlpha'));
  const textColor = tune('commChangeTextColor');
  if (name) {
    octx.font = `bold ${g.text.namePx}px sans-serif`;
    octx.textBaseline = 'bottom';
    const y = -g.width / 2 - g.textGap;
    octx.lineWidth = tune('commChangeNameHaloWidthPx');
    octx.strokeStyle = halo;
    octx.strokeText(name, 0, y);
    octx.fillStyle = textColor;
    octx.fillText(name, 0, y);
  }
  if (freq) {
    octx.font = `bold ${g.text.freqPx}px sans-serif`;
    octx.textBaseline = 'top';
    const y = g.width / 2 + g.textGap;
    octx.lineWidth = tune('commChangeFreqHaloWidthPx');
    octx.strokeStyle = halo;
    octx.strokeText(freq, 0, y);
    octx.fillStyle = textColor;
    octx.fillText(freq, 0, y);
  }
  octx.restore();
}

function drawCommCallout(n, selected) {
  const g = commCalloutGeom(n);
  if (!g) return;
  octx.save();
  if (selected) {
    strokeCommCalloutShape(g, g.width + tune('commChangeSelectedWidthAddPx'),
      tune('commChangeSelectedColor'), tune('commChangeSelectedAlpha'));
  }
  if (g.halo > 0) {
    const halo = colorWithAlpha(tune('commChangeArrowHaloColor'), tune('commChangeArrowHaloAlpha'));
    strokeCommCalloutShape(g, g.width + g.halo * 2, halo, 1);
  }
  strokeCommCalloutShape(g, g.width, tune('commChangeArrowColor'), 1);
  drawCommCalloutText(g);
  octx.restore();
}

function selectedCommCallout(i) {
  if (!state.selected) return false;
  if (state.selected.type === 'note' && state.selected.index === i) return true;
  return state.selected.type === 'wp' && state.selected.freqNoteIndex === i;
}

function drawNotes() {
  for (let i = 0; i < state.notes.length; i++) {
    const n = state.notes[i];
    if (n && n.cc && !showCommChange) continue;
    const r = noteRect(i);
    const selected = n && n.cc
      ? selectedCommCallout(i)
      : state.selected &&
        state.selected.type === 'note' &&
        state.selected.index === i;
    const color = n.color || NOTE_DEFAULT_COLOR;
    if (n.cc) {
      drawCommCallout(n, selected);
      continue;
    }
    octx.fillStyle = tintFill(color);
    octx.lineWidth = selected ? tune('noteSelectedStrokeWidthPx') : tune('noteStrokeWidthPx');
    octx.strokeStyle = selected ? tune('selectedColor') : tune('inkColor');
    if (r.oval) {
      octx.beginPath();
      octx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2,
                   0, 0, Math.PI * 2);
      octx.fill();
      octx.stroke();
    } else {
      octx.fillRect(r.x, r.y, r.w, r.h);
      octx.strokeRect(r.x, r.y, r.w, r.h);
    }

    const lineH = tune('noteLineHeightPx');
    octx.font = noteFont();
    octx.fillStyle = tune('inkColor');
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    const cx = r.x + r.w / 2;
    const y0 = r.y + (r.h - r.lines.length * lineH) / 2;
    for (let j = 0; j < r.lines.length; j++) {
      octx.fillText(r.lines[j], cx, y0 + lineH / 2 + j * lineH);
    }
    octx.textAlign = 'left';
  }
}

function drawInfo() {
  let totalDist = 0, totalH = 0;
  for (let i = 0; i < state.legs.length; i++) {
    const { dist } = geo(state.waypoints[i], state.waypoints[i + 1]);
    totalDist += dist;
    if (state.legs[i].flightSpeed > 0) totalH += dist / state.legs[i].flightSpeed;
  }
  document.getElementById('info').textContent =
    `${S.summaryWaypoints}: ${state.waypoints.length}\n` +
    `${S.summaryLegs}: ${state.legs.length}\n` +
    `${S.summaryDist}: ${totalDist.toFixed(1)} NM\n` +
    `${S.summaryTime}: ${totalH > 0 ? toHMS(totalH) : '--'}`;
}

// --- print page frame -----------------------------------------------
// Landscape page coverage in nautical miles at 1:250,000.
const PAGE_NM = { A4: { w: 40.09, h: 28.35 }, A3: { w: 56.70, h: 40.09 } };

function metresPerPixel() {
  const y = vh() / 2;
  const a = map.containerPointToLatLng([0, y]);
  const b = map.containerPointToLatLng([200, y]);
  return map.distance(a, b) / 200;
}

function pageDims() {                   // page coverage (NM), oriented
  const p = PAGE_NM[pageSize];
  return pageOrient === 'portrait' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

function pageFrameRect() {
  if (!pageSize) return null;
  const mpp = metresPerPixel();
  const d = pageDims();
  const w = d.w * 1852 / mpp;
  const h = d.h * 1852 / mpp;
  return { x: (vw() - w) / 2 + pageOffset.x,
           y: (vh() - h) / 2 + pageOffset.y, w, h };
}

// True if (px,py) is on the page-frame border band — the drag grip.
function hitPageFrameEdge(px, py) {
  const r = pageFrameRect();
  if (!r) return false;
  const t = tune('pageFrameHitPx');
  const inOuter = px >= r.x - t && px <= r.x + r.w + t &&
                  py >= r.y - t && py <= r.y + r.h + t;
  const inInner = px >= r.x + t && px <= r.x + r.w - t &&
                  py >= r.y + t && py <= r.y + r.h - t;
  return inOuter && !inInner;
}

// Keep the frame centre on screen so it can always be grabbed back.
function clampPageOffset() {
  pageOffset.x = Math.max(-vw() / 2, Math.min(vw() / 2, pageOffset.x));
  pageOffset.y = Math.max(-vh() / 2, Math.min(vh() / 2, pageOffset.y));
}

// Render the flight-plan table onto a canvas at (x,y), auto-sizing columns to
// content. `w`/`h` are the available box; the table is anchored within it per
// `align` ('tl'|'tr'|'bl'|'br'|'center'). Returns the rendered { x, y, w, h }
// (or null when there's no route). Paper-print look — white bg, black text.
// Shared by the live export preview and the PNG render so they match exactly.
function drawFlightPlanTable(ctx, x, y, w, h, align) {
  const legs = state.legs || [];
  const wpts = state.waypoints || [];
  if (!legs.length || wpts.length < 2) return null;
  const ac = aircraft;
  const taxiFuel = ac && ac.taxiGal && typeof isAirport === 'function' && isAirport(wpts[0]) ? ac.taxiGal : 0;
  const rows = [];
  let totDist = 0, totTime = 0, totFuel = 0;
  for (let i = 0; i < legs.length; i++) {
    const A = wpts[i], B = wpts[i + 1];
    if (!A || !B) continue;
    const { dist, brg } = geo(A, B);
    const hdg = toMagnetic(brg);
    const dur = legs[i].flightSpeed > 0 ? dist / legs[i].flightSpeed : 0;
    let fuel = ac ? dur * ac.gph : 0;
    if (i === 0 && taxiFuel) fuel += taxiFuel;
    totDist += dist; totTime += dur; totFuel += fuel;
    const fLabel = ac ? fuel.toFixed(1) + (i === 0 && taxiFuel ? ' *' : '') : '--';
    rows.push({ num: i + 1, from: navName((A.name || '').trim()) || S.wpPrefix + (i + 1),
      to: navName((B.name || '').trim()) || S.wpPrefix + (i + 2),
      hdg: pad3(hdg) + '°M', dist: dist.toFixed(1),
      speed: String(legs[i].flightSpeed), alt: String(legs[i].inboundAltitude),
      time: dur > 0 ? toHMS(dur) : '--', fuel: fLabel });
  }
  if (!rows.length) return null;
  const headers = S.fpHeadersShort;
  const numCols = headers.length;
  const numRows = rows.length + 2;            // header + data + total
  const idealRowH = h / numRows;
  const fontSize = Math.max(9, Math.min(idealRowH * 0.7, 22));
  const rowH = Math.min(idealRowH, Math.ceil(fontSize * 1.35));
  const padX = Math.max(4, Math.round(fontSize * 0.6));
  const aligns = ['center', 'left', 'left', 'center', 'right', 'right', 'right', 'center', 'right'];
  ctx.save();
  ctx.font = fontSize + 'px sans-serif';
  const totVals = { 4: totDist.toFixed(1), 7: totTime > 0 ? toHMS(totTime) : '--', 8: ac ? totFuel.toFixed(1) : '--' };
  const colW = new Array(numCols).fill(0);
  ctx.font = 'bold ' + fontSize + 'px sans-serif';
  for (let mc = 0; mc < numCols; mc++) {
    colW[mc] = Math.max(colW[mc], ctx.measureText(String(headers[mc])).width);
    if (totVals[mc] !== undefined) colW[mc] = Math.max(colW[mc], ctx.measureText(String(totVals[mc])).width);
  }
  ctx.font = fontSize + 'px sans-serif';
  for (let mr = 0; mr < rows.length; mr++) {
    const rd = rows[mr];
    const mvals = [rd.num, rd.from, rd.to, rd.hdg, rd.dist, rd.speed, rd.alt, rd.time, rd.fuel];
    for (let mc = 0; mc < numCols; mc++) colW[mc] = Math.max(colW[mc], ctx.measureText(String(mvals[mc])).width);
  }
  for (let mc = 0; mc < numCols; mc++) colW[mc] = Math.ceil(colW[mc] + 2 * padX);
  const colX = new Array(numCols + 1).fill(0);
  for (let mc = 0; mc < numCols; mc++) colX[mc + 1] = colX[mc] + colW[mc];
  const totalW = colX[numCols];
  const HEADER_BG = '#e8e6e1', TOTAL_BG = '#f0eee9', STRIPE_BG = '#f7f5f0', GRID = '#7a7470', TEXT = '#1a1a1a';
  const tableH = rowH * numRows;
  const al = align || 'tl';
  if (al === 'tr' || al === 'br') x = x + Math.max(0, w - totalW);
  if (al === 'bl' || al === 'br') y = y + Math.max(0, h - tableH);
  if (al === 'center') { x = x + Math.max(0, (w - totalW) / 2); y = y + Math.max(0, (h - tableH) / 2); }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, totalW, tableH);
  function cell(row, col, text, bold, bg) {
    const cx = x + colX[col], cy = y + row * rowH, cw = colW[col];
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(cx, cy, cw, rowH); }
    ctx.fillStyle = TEXT;
    ctx.font = (bold ? 'bold ' : '') + fontSize + 'px sans-serif';
    ctx.textBaseline = 'middle';
    const a = aligns[col];
    ctx.textAlign = a;
    const tx = a === 'right' ? cx + cw - padX : a === 'center' ? cx + cw / 2 : cx + padX;
    ctx.fillText(text, tx, cy + rowH / 2);
  }
  ctx.fillStyle = HEADER_BG;
  ctx.fillRect(x, y, totalW, rowH);
  for (let c = 0; c < numCols; c++) cell(0, c, headers[c], true, null);
  for (let r = 0; r < rows.length; r++) {
    const rd = rows[r];
    const vals = [rd.num, rd.from, rd.to, rd.hdg, rd.dist, rd.speed, rd.alt, rd.time, rd.fuel];
    for (let c2 = 0; c2 < numCols; c2++) cell(r + 1, c2, String(vals[c2]), false, r % 2 === 1 ? STRIPE_BG : null);
  }
  const tr = rows.length + 1, totCY = y + tr * rowH;
  ctx.fillStyle = TOTAL_BG;
  ctx.fillRect(x, totCY, totalW, rowH);
  ctx.fillStyle = TEXT;
  ctx.font = 'bold ' + fontSize + 'px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(S.fpTotal, x + colX[1] + padX, totCY + rowH / 2);
  for (let c4 = 4; c4 < numCols; c4++) if (totVals[c4] !== undefined) cell(tr, c4, String(totVals[c4]), true, null);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, totalW - 1, tableH - 1);
  ctx.lineWidth = 0.75;
  for (let gc = 1; gc < numCols; gc++) {
    const gx = Math.round(x + colX[gc]) + 0.5;
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + tableH); ctx.stroke();
  }
  for (let gr = 1; gr < numRows; gr++) {
    const gy = Math.round(y + gr * rowH) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + totalW, gy); ctx.stroke();
  }
  ctx.restore();
  return { x, y, w: totalW, h: tableH };
}

// Draw the placed flight-plan card on the overlay (live preview + export).
// Sized for ~16 px rows in container pixels; the export scale renders it
// crisp at print DPI. Updates planCardRect for hit-testing the drag.
function drawPlanCard() {
  if (!planCard) { planCardRect = null; return; }
  const numRows = (state.legs ? state.legs.length : 0) + 2;
  const h = numRows * 16;
  planCardRect = drawFlightPlanTable(octx, planCard.x, planCard.y, 100000, h, 'tl');
}

function drawPageFrame() {
  const r = pageFrameRect();
  if (!r) return;
  octx.save();
  octx.fillStyle = `rgba(20,18,18,${tune('pageFrameScrimAlpha')})`;
  octx.beginPath();
  octx.rect(0, 0, vw(), vh());
  octx.rect(r.x, r.y, r.w, r.h);
  octx.fill('evenodd');
  octx.strokeStyle = tune('selectedColor');
  octx.lineWidth = tune('pageFrameLineWidthPx');
  octx.setLineDash([tune('pageFrameDashOnPx'), tune('pageFrameDashOffPx')]);
  octx.strokeRect(r.x, r.y, r.w, r.h);
  octx.restore();
}
