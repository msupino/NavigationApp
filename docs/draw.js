'use strict';
/* NavAid — drawing: route, nav-waypoints, notes, page frame.
   Shares globals with core.js; loaded after it. */

// Issue #394 (+ follow-up bug): default-kite clearance helpers, shared by
// `drawLegs` (rendering), `legLabelCenter` (interact.js hit-testing),
// and the drag-start materialiser (interact.js). The kite shape itself
// is `46 * legZoomScale()` px wide (see drawLegArrow in this file —
// `W = 46 * sc`), so its half-extent perpendicular to the leg axis is
// `23 * legZoomScale()`. Drift lines fan out from each waypoint at 10°
// from the leg axis for half the leg length; at the default along-leg
// position (midpoint, a=0) the cone reaches `(legLength / 2) * tan(10°)`
// perpendicular. The kite's *centre* must therefore sit at least
// (cone-extent + kite-half-width + visual margin) from the leg line so
// the kite *body* clears both the leg line and the drift dashes at
// every zoom and `legArrowSize`. The first cut of this fix only
// pushed the centre `(len/2)*tan(10°) + 8` out, which left the kite
// edge ON the leg line at low zoom or `legArrowSize >= 2`.
const legDefaultDriftTan = Math.tan(10 * Math.PI / 180);
const legDefaultDriftMarginPx = 8;
const legDefaultKiteHalfWidthPx = 23;   // kite half-width when legZoomScale() === 1 (W = 46 * sc)
function legDefaultLabelPerp(legLenPx) {
  const sc = (typeof legZoomScale === 'function') ? legZoomScale() : 1;
  return (Math.max(1, legLenPx) / 2) * legDefaultDriftTan +
         legDefaultKiteHalfWidthPx * sc +
         legDefaultDriftMarginPx;
}

// --- drawing ---------------------------------------------------------
function draw() {
  octx.clearRect(0, 0, vw(), vh());
  drawNavWaypoints();
  drawCommChangeRings();
  drawAirfields();
  drawLegs();
  drawWaypoints();
  drawNotes();
  drawInfo();
  drawPageFrame();
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

// --- nav-waypoint reference overlay ---------------------------------
// Lazy-loads docs/nav-waypoints.json on first activation. Format:
// { waypoints:[{ name, he, lat, lng }] } — 173 published reporting
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
      he: w.he,                          // Hebrew label (English kept for search)
      lat: w.lat,
      lng: w.lng,
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

// Lazy-loads docs/comm-change.json — { points:[{name, commChange, from, to,
// note, verified, source}] }. Builds an O(1) map keyed by ICAO `name` for
// the nav-waypoint overlay ring + inspector badge. On 404 or schema error
// we install an EMPTY map ({}) instead of leaving commChangeMap null —
// the dataset is intentionally optional, and a missing file must not
// disable the rest of the nav-WP overlay (issue #399). The map is only
// rebuilt if a future call observes `commChangeMap === null` (i.e. nothing
// was installed yet), so a one-time 404 doesn't trigger retry storms.
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
      return commChangeMap;
    }
    const m = {};
    for (const pt of d.points) {
      if (pt && pt.name && pt.commChange) m[pt.name] = pt;
    }
    commChangeMap = m;
    return commChangeMap;
  } catch (e) {
    console.warn('Failed to load comm-change dataset:', e);
    commChangeMap = {};                    // graceful degrade — no rings, no retry
    return commChangeMap;
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

// True if `name` matches a known nav waypoint (English or Hebrew) — so we
// treat it as auto-snapped, not user-typed, and may overwrite on drag.
function isNavName(name) {
  if (!name || !navWP) return false;
  for (const wp of navWP) if (wp.name === name || wp.he === name) return true;
  return false;
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
// is a nav-WP name (either language), return the locale-appropriate version.
// User-typed names are returned as-is.
function navName(stored) {
  if (!stored || !navWP) return stored || '';
  for (const nw of navWP) {
    if (nw.name === stored || nw.he === stored)
      return nw[S.navWpSearchField] || nw.name;
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
// known landmarks (16 vs 173 nav-WPs); if both overlays sit on the same
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
  // it would make the 16-airfield set always win and leave the 173 nav-WPs
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
      if (nw && !excluded(nw)) cands.push({ pt: nw, name: nw[S.navWpSearchField] || nw.name });
    }
    let best = null, bestD = Infinity;
    for (const c of cands) {
      const p = map.latLngToContainerPoint([c.pt.lat, c.pt.lng]);
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) {
      const name = userTyped ? currentName : best.name;
      return { lat: best.pt.lat, lng: best.pt.lng, name };
    }
    return { lat: latlng.lat, lng: latlng.lng,
             name: autoSnapped ? '' : (currentName || '') };
  }
  if (showAirfields) {
    const af = nearestAirfield(latlng, 18);
    if (af && !excluded(af)) {
      const name = userTyped ? currentName : af.name;
      return { lat: af.lat, lng: af.lng, name };
    }
  }
  if (showNavWP) {
    const snap = nearestNavWaypoint(latlng, 18);
    if (snap && !excluded(snap)) {
      const name = userTyped ? currentName : (snap[S.navWpSearchField] || snap.name);
      return { lat: snap.lat, lng: snap.lng, name };
    }
  }
  return { lat: latlng.lat, lng: latlng.lng,
           name: autoSnapped ? '' : (currentName || '') };
}

// --- airfield reference overlay -------------------------------------
// Lazy-loads docs/airfields.json on first activation. Format:
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
  const r = 7;                           // half-width of the triangle, screen px
  octx.font = 'bold 11px sans-serif';
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
    octx.lineTo(s.x + r * 0.95, s.y + r * 0.65);
    octx.lineTo(s.x - r * 0.95, s.y + r * 0.65);
    octx.closePath();
    octx.fillStyle = '#2f6fd0';          // saturated blue — distinct from white nav-WP dots
    octx.fill();
    octx.lineWidth = 1.5;
    octx.strokeStyle = '#0a1a2a';
    octx.stroke();
    if (showLabels) {
      const locale = af[S.airfieldLabelField] || af.en || af.name;
      const label = af.name + (locale && locale !== af.name ? ' / ' + locale : '');
      octx.lineWidth = 2.5;
      octx.strokeStyle = 'rgba(255,255,255,0.85)';
      octx.strokeText(label, s.x + r + 3, s.y);
      octx.fillStyle = '#0a1a2a';
      octx.fillText(label, s.x + r + 3, s.y);
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
const COMM_CHANGE_RING_RADIUS = 6;
const COMM_CHANGE_RING_WIDTH = 1.8;

function drawNavWaypoints() {
  if (!showNavWP || !navWP || navWP.length === 0) return;
  // Suppress nav-WP dot when a route waypoint sits on it (by position),
  // regardless of whether the WP name was changed after snapping.
  const SNAP_DEG = 0.0002;               // ~22 m — matches nearestNavWaypoint px threshold
  const showLabels = map.getZoom() >= 10;
  octx.font = 'bold 10px sans-serif';
  octx.textAlign = 'left';
  octx.textBaseline = 'middle';
  for (const wp of navWP) {
    const occupied = state.waypoints.some(
      r => Math.abs(r.lat - wp.lat) < SNAP_DEG && Math.abs(r.lng - wp.lng) < SNAP_DEG);
    if (occupied) continue;
    const s = proj(wp);                  // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
    octx.fillStyle = '#ffffff';
    octx.strokeStyle = '#161412';
    octx.lineWidth = 1.5;
    octx.beginPath();
    octx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
    if (showLabels) {
      const label = wp[S.navWpSearchField] || wp.name;
      octx.lineWidth = 2.5;
      octx.strokeStyle = 'rgba(255,255,255,0.85)';
      octx.strokeText(label, s.x + 6, s.y);
      octx.fillStyle = '#161412';
      octx.fillText(label, s.x + 6, s.y);
    }
  }
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
    octx.strokeStyle = COMM_CHANGE_RING_COLOR;
    octx.lineWidth = COMM_CHANGE_RING_WIDTH;
    // #488: if a route waypoint sits on the point, drawWaypoints() paints a
    // filled disc over this ring later in the frame — and with "show waypoint
    // names" on, waypointGeom() enlarges that disc to fit its label. Grow the
    // ring to enclose the disc (+ its 3px stroke) so it stays visible outside.
    const SNAP_DEG = 0.0002;               // ~22 m — matches the snap threshold
    for (const wp of navWP) {
      if (!commChangeMap[wp.name] || !commChangeMap[wp.name].commChange) continue;
      const s = proj(wp);                // no viewport cull: also drawn into
                                         // the larger PNG-export canvas
      let radius = COMM_CHANGE_RING_RADIUS;
      const wi = state.waypoints.findIndex(
        r => Math.abs(r.lat - wp.lat) < SNAP_DEG && Math.abs(r.lng - wp.lng) < SNAP_DEG);
      if (wi !== -1) {
        const selected = state.selected &&
                         state.selected.type === 'wp' && state.selected.index === wi;
        const discR = (selected ? waypointGeom(wi).r + 2 : waypointGeom(wi).r) + 2;
        if (discR + COMM_CHANGE_RING_WIDTH > radius) radius = discR + COMM_CHANGE_RING_WIDTH;
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
// or repeated snaps never duplicate it. Seeding is driven ONLY from explicit
// placement/snap actions (drop, drag-end, search route-build); it must not be
// called from draw() / load / import / undo or it would resurrect notes the
// user deleted. Returns true if any note was added so the caller can persist.
const COMM_CHANGE_NOTE_LAT_OFFSET = 0.012;   // ~1.3 km north of the dot
function seedCommChangeNotes() {
  if (!showCommChange) return false;
  if (!commChangeMap || typeof state === 'undefined' ||
      !Array.isArray(state.waypoints) || !Array.isArray(state.notes)) return false;
  let added = false;
  for (const wp of state.waypoints) {
    const nm = wp && wp.name ? wp.name.trim() : '';
    if (!nm) continue;
    const cc = commChangeMap[nm];
    if (!cc || !cc.commChange) continue;
    if (state.notes.some(n => n && n.cc === nm)) continue;   // already seeded / kept
    state.notes.push({
      lat: r5(wp.lat + COMM_CHANGE_NOTE_LAT_OFFSET),
      lng: r5(wp.lng),
      text: (typeof S !== 'undefined' && S.commChangeNoteText) || 'Freq change',
      color: NOTE_DEFAULT_COLOR,
      shape: 'rect',
      cc: nm,
    });
    added = true;
  }
  return added;
}
window.seedCommChangeNotes = seedCommChangeNotes;

function drawLegs() {
  const zoomScale = legZoomScale();
  for (let i = 0; i < state.legs.length; i++) {
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    if (!A || !B) continue;
    const leg = state.legs[i];
    const sa = proj(A), sb = proj(B);
    const selected = state.selected &&
                     state.selected.type === 'leg' &&
                     state.selected.index === i;

    octx.lineCap = 'round';
    octx.strokeStyle = selected ? '#ffcc33' : '#161412';
    octx.lineWidth = selected ? 5 : 3.5;
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
    // Issue #394: a default (unmodified) kite sits just outside the 10°
    // drift cone instead of at a fixed per-zoom pixel offset. The cone's
    // perpendicular extent at the leg midpoint is `(len/2) * tan(10°)`;
    // adding an 8 px margin keeps the kite visibly clear of the dashed
    // drift lines at every zoom / leg length. User-dragged offsets
    // (no `_default` flag) keep the existing `p * legZoomScale()` path so
    // hand-positioned kites round-trip exactly as PR #393 designed.
    const driftPerp = legDefaultLabelPerp(len);
    const inPerp  = inP._default  ?  driftPerp : (inP.p  || 0) * zoomScale;
    const outPerp = outP._default ? -driftPerp : (outP.p || 0) * zoomScale;
    const inAlong  = (inP.a  || 0) * zoomScale;
    const outAlong = (outP.a || 0) * zoomScale;
    drawLegArrow(mid.x + dx * inAlong + nx * inPerp,
      mid.y + dy * inAlong + ny * inPerp,
      ang, pad3(magIn), timeStr, String(leg.inboundAltitude),
      '#161412', yellowFill(0.80), needsHalo(i, 'in'), zoomScale);
    if (showReturn) {
      drawLegArrow(mid.x + dx * outAlong + nx * outPerp,
        mid.y + dy * outAlong + ny * outPerp, ang + Math.PI,
        pad3(magOut), timeStrOut, String(leg.outboundAltitude),
        '#161412', 'rgba(255,204,214,0.80)', needsHalo(i, 'out'), zoomScale);
    }
    if (showMidLeg) drawDistanceBadge(mid.x, mid.y, dist);
  }
}

// 10-degree drift reference lines, one from each end, half the leg length.
function drawDriftLines(sa, sb) {
  const a = 10 * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const abx = sb.x - sa.x, aby = sb.y - sa.y;
  const bax = -abx, bay = -aby;
  octx.save();
  octx.setLineDash([5, 4]);
  octx.lineWidth = 1.5;
  octx.strokeStyle = 'rgba(20,20,20,0.6)';
  octx.beginPath();
  octx.moveTo(sa.x, sa.y);
  octx.lineTo(sa.x + (abx * c - aby * s) * 0.5, sa.y + (abx * s + aby * c) * 0.5);
  octx.moveTo(sb.x, sb.y);
  octx.lineTo(sb.x + (bax * c - bay * s) * 0.5, sb.y + (bax * s + bay * c) * 0.5);
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
  octx.font = 'bold 10px sans-serif';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  const count = Math.floor(totalMin);
  for (let m = 1; m <= count; m++) {
    const f = m / totalMin;
    const px = sa.x + (sb.x - sa.x) * f;
    const py = sa.y + (sb.y - sa.y) * f;
    const even = m % 2 === 0;
    const tick = even ? 9 : 4;          // long on even minutes, short on odd
    octx.strokeStyle = '#161412';
    octx.lineWidth = even ? 2 : 1.5;
    octx.beginPath();
    octx.moveTo(px - nx * tick, py - ny * tick);
    octx.lineTo(px + nx * tick, py + ny * tick);
    octx.stroke();
    if (even) {                         // minute number past the tick end
      const tx = px + nx * (tick + 8), ty = py + ny * (tick + 8);
      octx.fillStyle = '#161412';
      octx.font = 'bold 10px sans-serif';
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
    return cur.inboundAltitude !== prev.inboundAltitude ||
           cur.flightSpeed     !== prev.flightSpeed;
  }
  if (i === state.legs.length - 1) return false;
  const next = state.legs[i + 1];
  return cur.outboundAltitude !== next.outboundAltitude ||
         cur.outboundSpeed    !== next.outboundSpeed;
}

// Navigation leg marker: a two-cell rectangle (altitude, time) joined to a
// triangle (heading) pointing in the flight direction. Text runs across the
// marker and is locked to its orientation.
function drawLegArrow(cx, cy, flightAng, head, time, alt, accent, fill, halo, sc) {
  sc = sc ?? 1;
  const W = 46 * sc, cell = 22 * sc, Lt = 26 * sc;
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
    octx.lineWidth = 7 * sc;
    octx.strokeStyle = '#8e44ad';
    octx.stroke();
    octx.lineJoin = 'miter';
  }
  octx.fillStyle = fill;
  octx.fill();
  octx.lineWidth = 2 * sc;
  octx.strokeStyle = accent;
  octx.stroke();
  octx.lineWidth = sc;
  for (const dx of [-L / 2 + cell, xb]) {
    octx.beginPath();
    octx.moveTo(dx, -W / 2);
    octx.lineTo(dx, W / 2);
    octx.stroke();
  }
  octx.restore();

  const fontPx = Math.max(4, Math.round(13 * sc));
  const fontPxH = Math.max(4, Math.round(14 * sc));
  const ta = flightAng + Math.PI / 2;
  const cos = Math.cos(flightAng), sin = Math.sin(flightAng);
  const at = lx => ({ x: cx + lx * cos, y: cy + lx * sin });
  const pAlt = at(-L / 2 + cell * 0.5);
  const pTime = at(-L / 2 + cell * 1.5);
  const pHead = at(xb + Lt * 0.22);
  drawRotText(pAlt.x, pAlt.y, ta, alt, `bold ${fontPx}px sans-serif`, '#000');
  drawRotText(pTime.x, pTime.y, ta, time, `bold ${fontPx}px sans-serif`, '#000');
  drawRotText(pHead.x, pHead.y, ta, head, `bold ${fontPxH}px sans-serif`, '#000');
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
  octx.arc(cx, cy, 15, 0, Math.PI * 2);
  octx.fillStyle = yellowFill(0.90);
  octx.fill();
  octx.lineWidth = 2.5;
  octx.strokeStyle = '#161412';
  octx.stroke();
  octx.fillStyle = '#161412';
  octx.font = 'bold 11px sans-serif';
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(dist.toFixed(1), cx, cy);
  octx.textAlign = 'left';
}

const WP_RADIUS = 13;

// Label to draw inside a waypoint circle, plus the radius and font px
// needed to fit it. Scaled by wpSize slider × zoom (geographic footprint
// stays roughly constant; floor at 0.35× so markers stay visible when zoomed out).
function waypointGeom(i) {
  const wp = state.waypoints[i];
  // Match wpLabel() / inspector placeholder ("WP N"), not a bare digit.
  const label = showWpNames
    ? (navName((wp.name || '').trim()) || (S.wpPrefix + (i + 1)))
    : '';
  const zoomScale = Math.max(0.35, Math.pow(2, map.getZoom() - 12));
  const scale = wpSize * zoomScale;
  const fontPx = Math.max(4, Math.round(13 * scale));
  octx.font = `bold ${fontPx}px sans-serif`;
  const w = octx.measureText(label).width;
  const minR = WP_RADIUS * scale;
  return { label, fontPx, r: Math.max(minR, w / 2 + fontPx * 0.7) };
}

function drawWaypoints() {
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    const s = proj(wp);
    const selected = state.selected &&
                     state.selected.type === 'wp' &&
                     state.selected.index === i;
    const { label, fontPx, r } = waypointGeom(i);
    const radius = selected ? r + 2 : r;

    octx.beginPath();
    octx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    octx.fillStyle = selected ? '#ffcc33' : yellowFill(0.60);
    octx.fill();
    octx.lineWidth = 3;
    octx.strokeStyle = '#161412';
    octx.stroke();

    octx.save();
    octx.translate(s.x, s.y);
    if (wpNameAngle) octx.rotate(wpNameAngle * Math.PI / 180);
    octx.font = `bold ${fontPx}px sans-serif`;
    octx.fillStyle = '#161412';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(label, 0, 0);
    octx.restore();
    octx.textAlign = 'left';
  }
}

// --- notes (free-text annotation boxes) ------------------------------
const NOTE_FONT = 'bold 12px sans-serif';
const NOTE_PAD_X = 8;
const NOTE_PAD_Y = 6;
const NOTE_LINE_H = 16;
const NOTE_MIN_W = 56;                  // keep short / empty notes landscape

function noteRect(i) {
  const n = state.notes[i];
  const s = proj(n);
  const lines = (n.text || '').split('\n');
  octx.font = NOTE_FONT;
  let maxW = 1;
  for (const l of lines) {
    const w = octx.measureText(l || ' ').width;
    if (w > maxW) maxW = w;
  }
  let w = Math.max(maxW + NOTE_PAD_X * 2, NOTE_MIN_W);
  let h = Math.max(1, lines.length) * NOTE_LINE_H + NOTE_PAD_Y * 2;
  const oval = n.shape === 'oval';
  if (oval) { w *= Math.SQRT2; h *= Math.SQRT2; }   // ellipse must bound the text
  return { x: s.x - w / 2, y: s.y - h / 2, w, h, lines, oval };
}

function drawNotes() {
  for (let i = 0; i < state.notes.length; i++) {
    const n = state.notes[i];
    const r = noteRect(i);
    const selected = state.selected &&
                     state.selected.type === 'note' &&
                     state.selected.index === i;
    const color = n.color || NOTE_DEFAULT_COLOR;
    octx.fillStyle = tintFill(color);
    octx.lineWidth = selected ? 2.5 : 1.5;
    octx.strokeStyle = selected ? '#ffcc33' : '#161412';
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

    octx.font = NOTE_FONT;
    octx.fillStyle = '#161412';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    const cx = r.x + r.w / 2;
    const y0 = r.y + (r.h - r.lines.length * NOTE_LINE_H) / 2;
    for (let j = 0; j < r.lines.length; j++) {
      octx.fillText(r.lines[j], cx, y0 + NOTE_LINE_H / 2 + j * NOTE_LINE_H);
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
  const t = 14;
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

function drawPageFrame() {
  const r = pageFrameRect();
  if (!r) return;
  octx.save();
  octx.fillStyle = 'rgba(20,18,18,0.4)';
  octx.beginPath();
  octx.rect(0, 0, vw(), vh());
  octx.rect(r.x, r.y, r.w, r.h);
  octx.fill('evenodd');
  octx.strokeStyle = '#ffcc33';
  octx.lineWidth = 2;
  octx.setLineDash([8, 5]);
  octx.strokeRect(r.x, r.y, r.w, r.h);
  octx.restore();
}

