'use strict';
/* NavAid — hit-testing, inspector panel, mouse/touch interaction.
   Shares globals with core.js; loaded after draw.js. */

// --- hit testing -----------------------------------------------------
function hitNote(px, py) {
  for (let i = state.notes.length - 1; i >= 0; i--) {
    const note = state.notes[i];
    if (note && note.cc && !showCommChange) continue;
    // Frequency callouts are drawn above waypoint markers, but the waypoint
    // circle itself must remain independently selectable.
    if (note && note.cc && hitWaypoint(px, py) >= 0) continue;
    if (note && note.cc) {
      const hitComm = hitCommCallout(px, py, note);
      if (hitComm === true) return i;
      if (hitComm === false) continue;
    }
    const r = noteRect(i);
    if (r.oval) {
      const dx = (px - (r.x + r.w / 2)) / (r.w / 2);
      const dy = (py - (r.y + r.h / 2)) / (r.h / 2);
      if (dx * dx + dy * dy <= 1) return i;
    } else if (px >= r.x && px <= r.x + r.w &&
               py >= r.y && py <= r.y + r.h) {
      return i;
    }
  }
  return -1;
}
function hitCommCallout(px, py, note) {
  const g = (typeof commCalloutGeom === 'function') ? commCalloutGeom(note) : null;
  if (!g) return null;
  const hitPx = Math.max(10, g.width + g.halo * 2 + tune('hitWaypointExtraPx'));
  const points = [g.target, ...g.bends, g.tail];
  for (let i = 0; i < points.length - 1; i++) {
    if (distToSegment(px, py, points[i], points[i + 1]) <= hitPx) return true;
  }

  const maxTextW = Math.max(g.text.nameW, g.text.freqW);
  const textH = g.text.namePx + g.text.freqPx + g.width + g.textGap * 2;
  const dx = px - g.textX;
  const dy = py - g.textY;
  const c = Math.cos(g.textAngle);
  const s = Math.sin(g.textAngle);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx) <= maxTextW / 2 + hitPx &&
         Math.abs(ly) <= textH / 2 + hitPx;
}
function hitCommCalloutCandidates(px, py) {
  const hits = [];
  for (let i = state.notes.length - 1; i >= 0; i--) {
    const note = state.notes[i];
    if (!note || !note.cc || !showCommChange) continue;
    if (hitCommCallout(px, py, note) === true) hits.push({ type: 'commcallout', index: i });
  }
  return hits;
}
function commCalloutWaypointIndex(note) {
  if (!note || !note.cc || !Array.isArray(state.waypoints)) return -1;
  const key = typeof canonicalNavWaypointName === 'function'
    ? canonicalNavWaypointName(note.cc) : String(note.cc || '').trim();
  if (!key) return -1;
  return state.waypoints.findIndex(w => {
    const name = typeof canonicalNavWaypointName === 'function'
      ? canonicalNavWaypointName(w && w.name) : String(w && w.name || '').trim();
    if (name !== key) return false;
    return typeof commChangeWaypointInRange === 'function'
      ? commChangeWaypointInRange(w, key) : true;
  });
}
function selectionForNoteHit(noteIndex) {
  const note = state.notes[noteIndex];
  const wpIndex = commCalloutWaypointIndex(note);
  if (wpIndex >= 0) {
    return { type: 'wp', index: wpIndex, freqNoteIndex: noteIndex };
  }
  return { type: 'note', index: noteIndex };
}
function selectedFreqNoteIndex() {
  const sel = state.selected;
  if (!sel || sel.type !== 'wp') return -1;
  if (Number.isInteger(sel.freqNoteIndex) && sel.freqNoteIndex >= 0) {
    const note = state.notes[sel.freqNoteIndex];
    if (note && note.cc && commCalloutWaypointIndex(note) === sel.index) {
      return sel.freqNoteIndex;
    }
  }
  const idx = state.notes.findIndex(n => n && n.cc && commCalloutWaypointIndex(n) === sel.index);
  if (idx >= 0) sel.freqNoteIndex = idx;
  return idx;
}

const INSPECTOR_SELECTION_KEY = 'navaid.selected';

function inspectorSelectionDataReady(sel) {
  if (!sel || typeof sel !== 'object') return true;
  if (sel.type === 'navwp') return Array.isArray(navWP);
  if (sel.type === 'airfield') return Array.isArray(airfields);
  if (sel.type === 'vor') return Array.isArray(vors);
  return true;
}

function normalizeInspectorSelection(sel) {
  if (!sel || typeof sel !== 'object') return null;
  const index = Number(sel.index);
  if (!Number.isInteger(index) || index < 0) return null;
  if (sel.type === 'wp') {
    if (!state.waypoints || index >= state.waypoints.length) return null;
    const out = { type: 'wp', index };
    if (Number.isInteger(sel.freqNoteIndex) && sel.freqNoteIndex >= 0) {
      const note = state.notes && state.notes[sel.freqNoteIndex];
      if (note && note.cc) out.freqNoteIndex = sel.freqNoteIndex;
    }
    return out;
  }
  if (sel.type === 'leg') {
    return state.legs && index < state.legs.length ? { type: 'leg', index } : null;
  }
  if (sel.type === 'note') {
    return state.notes && index < state.notes.length ? { type: 'note', index } : null;
  }
  if (sel.type === 'navwp') {
    return Array.isArray(navWP) && index < navWP.length ? { type: 'navwp', index } : null;
  }
  if (sel.type === 'airfield') {
    return Array.isArray(airfields) && index < airfields.length ? { type: 'airfield', index } : null;
  }
  if (sel.type === 'vor') {
    return Array.isArray(vors) && index < vors.length ? { type: 'vor', index } : null;
  }
  return null;
}

function readStoredInspectorSelection() {
  try {
    const raw = sessionStorage.getItem(INSPECTOR_SELECTION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearStoredInspectorSelection() {
  try { sessionStorage.removeItem(INSPECTOR_SELECTION_KEY); } catch (e) { /* */ }
}

function resetInspectorVorRef() {
  window.inspectorVorRef = undefined;
}

function persistInspectorSelection() {
  const sel = normalizeInspectorSelection(state.selected);
  if (!sel) {
    clearStoredInspectorSelection();
    return null;
  }
  state.selected = sel;
  try { sessionStorage.setItem(INSPECTOR_SELECTION_KEY, JSON.stringify(sel)); }
  catch (e) { /* */ }
  return sel;
}

function tryRestoreInspectorSelection(sel) {
  if (!sel) return 'empty';
  const normalized = normalizeInspectorSelection(sel);
  if (normalized) {
    state.selected = normalized;
    showInspector();
    return 'restored';
  }
  if (!inspectorSelectionDataReady(sel)) return 'pending';
  clearStoredInspectorSelection();
  return 'invalid';
}
function addCommChangeNoteForWaypoint(wp, ccKey) {
  if (!wp || !ccKey || !Array.isArray(state.notes)) return -1;
  if (typeof unsuppressCommChange === 'function') unsuppressCommChange(ccKey);
  const existing = state.notes.findIndex(n => n && n.cc &&
    (typeof canonicalNavWaypointName === 'function'
      ? canonicalNavWaypointName(n.cc) === ccKey
      : n.cc === ccKey));
  if (existing >= 0) return existing;
  const tail = typeof commCalloutDefaultTail === 'function'
    ? commCalloutDefaultTail(wp) : { lat: r5(wp.lat), lng: r5(wp.lng) };
  const callout = typeof commCalloutDefaults === 'function'
    ? commCalloutDefaults(ccKey) : { freqName: ccKey, freq: '' };
  state.notes.push({
    lat: tail.lat,
    lng: tail.lng,
    text: (typeof S !== 'undefined' && S.commChangeNoteText) || 'Freq change',
    color: NOTE_DEFAULT_COLOR,
    shape: 'rect',
    cc: ccKey,
    freqName: callout.freqName,
    freq: callout.freq,
    freqAuto: true,
  });
  return state.notes.length - 1;
}
function hitWaypoint(px, py) {
  const hits = hitWaypointCandidates(px, py);
  return hits.length ? hits[0].index : -1;
}
function hitWaypointCandidates(px, py) {
  const hits = [];
  for (let i = state.waypoints.length - 1; i >= 0; i--) {
    const s = proj(state.waypoints[i]);
    if (Math.hypot(s.x - px, s.y - py) <= waypointGeom(i).r + tune('hitWaypointExtraPx')) {
      hits.push({ type: 'wp', index: i });
    }
  }
  return hits;
}
// Overlay-marker hit testing for read-only selection (outside edit mode):
// VOR / airfield / nav-waypoint markers that are not route waypoints. Each
// is gated by its own visibility toggle and only when the dataset is loaded.
function hitVorMarker(px, py) {
  const hits = hitVorMarkerCandidates(px, py);
  return hits.length ? hits[0].index : -1;
}
function hitVorMarkerCandidates(px, py) {
  const hits = [];
  if (!showVorStations || !vors || !vors.length) return hits;
  const r = tune('vorMarkerRadiusPx') + tune('hitWaypointExtraPx');
  for (let i = vors.length - 1; i >= 0; i--) {
    const s = proj(vors[i]);
    if (Math.hypot(s.x - px, s.y - py) <= r) hits.push({ type: 'vor', index: i });
  }
  return hits;
}
function hitAirfieldMarker(px, py) {
  const hits = hitAirfieldMarkerCandidates(px, py);
  return hits.length ? hits[0].index : -1;
}
function hitAirfieldMarkerCandidates(px, py) {
  const hits = [];
  if (!showAirfields || !airfields || !airfields.length) return hits;
  const r = tune('airfieldMarkerRadiusPx') + tune('hitWaypointExtraPx');
  for (let i = airfields.length - 1; i >= 0; i--) {
    const s = proj(airfields[i]);
    if (Math.hypot(s.x - px, s.y - py) <= r) hits.push({ type: 'airfield', index: i });
  }
  return hits;
}
function hitNavWpMarker(px, py) {
  const hits = hitNavWpMarkerCandidates(px, py);
  return hits.length ? hits[0].index : -1;
}
function hitNavWpMarkerCandidates(px, py) {
  const hits = [];
  if (!showNavWP || !navWP || !navWP.length) return hits;
  const r = tune('navWaypointRadiusPx') + tune('hitWaypointExtraPx');
  for (let i = navWP.length - 1; i >= 0; i--) {
    const s = proj(navWP[i]);
    if (Math.hypot(s.x - px, s.y - py) <= r) hits.push({ type: 'navwp', index: i });
  }
  return hits;
}
function hitCommChangeMarkerCandidates(px, py) {
  const hits = [];
  if (!showCommChange || !commChangeMap || !navWP || !navWP.length) return hits;
  const r = tune('commChangeRingRadiusPx') +
    tune('commChangeRingWidthPx') / 2 +
    tune('commChangeArrowStartGapPx') + tune('hitWaypointExtraPx');
  for (let i = navWP.length - 1; i >= 0; i--) {
    const wp = navWP[i];
    if (!wp || !commChangeMap[wp.name] || !commChangeMap[wp.name].commChange) continue;
    const s = proj(wp);
    if (Math.hypot(s.x - px, s.y - py) <= r) hits.push({ type: 'navwp', index: i });
  }
  return hits;
}
// Topmost overlay marker under the point (VOR > airfield > nav-WP, matching
// paint order). Returns a read-only selection descriptor, or null.
function hitOverlayMarker(px, py) {
  const hits = hitOverlayMarkerCandidates(px, py);
  return hits.length ? hits[0] : null;
}
function hitOverlayMarkerCandidates(px, py) {
  return []
    .concat(hitVorMarkerCandidates(px, py) || [])
    .concat(hitAirfieldMarkerCandidates(px, py) || [])
    .concat(hitNavWpMarkerCandidates(px, py) || [])
    .concat(hitCommChangeMarkerCandidates(px, py) || []);
}
function dedupePointCandidates(candidates) {
  const seen = new Set();
  const out = [];
  for (const c of candidates || []) {
    if (!c || !Number.isInteger(c.index)) continue;
    const key = c.type + ':' + c.index;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
function pointChoiceText(c) {
  if (c.type === 'commcallout') {
    const note = state.notes[c.index] || {};
    const name = typeof commNoteName === 'function' ? commNoteName(note) : (note.freqName || '');
    const freq = typeof commNoteFreq === 'function' ? commNoteFreq(note) : (note.freq || '');
    const target = typeof commCalloutTarget === 'function' ? commCalloutTarget(note) : null;
    const targetName = target && (target.name || target.en || target.he || note.cc);
    const parts = [];
    if (targetName || note.cc) parts.push(navName(targetName || note.cc));
    if (name || freq) parts.push([name, freq].filter(Boolean).join(' / '));
    return {
      primary: S.choosePointCommChange || 'Freq-change arrow',
      meta: parts.join(' - '),
    };
  }
  if (c.type === 'wp') {
    const wp = state.waypoints[c.index] || {};
    const meta = (S.choosePointRoute || 'Route waypoint') + ' ' + (c.index + 1);
    return { primary: waypointDisplayLabel(wp, c.index), meta };
  }
  if (c.type === 'vor') {
    const v = vors && vors[c.index];
    return {
      primary: v ? v.ident : '',
      meta: ((S.choosePointVor || 'VOR station') +
        (v && referenceLocaleName(v, 'vor') ? ' / ' + referenceLocaleName(v, 'vor') : '') +
        (v && v.freq ? ' / ' + (typeof vorEffectiveFreq === 'function' ? vorEffectiveFreq(v) : v.freq) : '')).trim(),
    };
  }
  if (c.type === 'airfield') {
    const af = airfields && airfields[c.index];
    const label = referenceLocaleName(af, 'airfield');
    return {
      primary: af ? af.name : '',
      meta: (S.choosePointAirfield || 'Airfield') + (label ? ' / ' + label : ''),
    };
  }
  const nw = navWP && navWP[c.index];
  const label = referenceOverlayLabel(nw, 'navwp');
  const code = referenceCode(nw, 'navwp');
  return {
    primary: label || '',
    meta: (S.choosePointNavWaypoint || 'Navigation waypoint') +
      (code && code !== label ? ' / ' + code : ''),
  };
}
function selectPointCandidate(c) {
  state.selected = c.type === 'commcallout'
    ? selectionForNoteHit(c.index)
    : { type: c.type, index: c.index };
  showInspector();
  draw();
}
function showPointChoice(candidates) {
  const items = dedupePointCandidates(candidates);
  if (!items.length) return false;
  if (items.length === 1) {
    selectPointCandidate(items[0]);
    return true;
  }
  if (typeof createDraggableModal !== 'function') {
    selectPointCandidate(items[0]);
    return true;
  }
  const modal = createDraggableModal(S.choosePointTitle || 'Choose point', 'modal point-choice-modal');
  const body = document.createElement('div');
  body.className = 'point-choice-list';
  for (const item of items) {
    const labels = pointChoiceText(item);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'point-choice-option';
    const primary = document.createElement('span');
    primary.className = 'point-choice-primary';
    primary.textContent = labels.primary || '';
    const meta = document.createElement('span');
    meta.className = 'point-choice-meta';
    meta.textContent = labels.meta || '';
    btn.append(primary, meta);
    btn.onclick = () => {
      modal.close();
      selectPointCandidate(item);
    };
    body.appendChild(btn);
  }
  modal.box.appendChild(body);
  modal.show();
  const first = body.querySelector('button');
  if (first) first.focus();
  return true;
}
function hitLeg(px, py) {
  for (let i = 0; i < state.legs.length; i++) {
    const a = proj(state.waypoints[i]);
    const b = proj(state.waypoints[i + 1]);
    if (distToSegment(px, py, a, b) <= tune('hitLegPx')) return i;
  }
  return -1;
}
function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
function legFrame(i) {
  const a = proj(state.waypoints[i]);
  const b = proj(state.waypoints[i + 1]);
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
           dx, dy, nx: -dy, ny: dx, len };
}
function clampLegLabelAlong(legIdx, label) {
  if (!limitLegKites) return;
  if (!label || !state.waypoints[legIdx] || !state.waypoints[legIdx + 1]) return;
  if (!Number.isFinite(label.a)) label.a = 0;
  const sc = legZoomScale() || 1;
  const halfKite = (typeof legKiteAlongHalfPx === 'function') ? legKiteAlongHalfPx(sc) : 0;
  const limit = Math.max(0, (legFrame(legIdx).len / 2 - halfKite) / sc);
  label.a = Math.max(-limit, Math.min(limit, label.a));
}
function legLabelDragGrab(legIdx, which, px, py) {
  const c = legLabelCenter(legIdx, which);
  if (!c) return { grabA: 0, grabP: 0 };
  const f = legFrame(legIdx);
  const sc = legZoomScale() || 1;
  return {
    grabA: ((px - c.x) * f.dx + (py - c.y) * f.dy) / sc,
    grabP: ((px - c.x) * f.nx + (py - c.y) * f.ny) / sc,
  };
}
function setLegLabelFromPoint(dragState, px, py) {
  const leg = state.legs[dragState.i];
  const o = leg && (dragState.which === 'in' ? leg.inLabel : leg.outLabel);
  if (!o) return false;                // malformed leg / label — issue #82
  const f = legFrame(dragState.i);
  const sc = legZoomScale() || 1;
  o.a = ((px - f.mx) * f.dx + (py - f.my) * f.dy) / sc - (dragState.grabA || 0);
  clampLegLabelAlong(dragState.i, o);
  o.p = ((px - f.mx) * f.nx + (py - f.my) * f.ny) / sc - (dragState.grabP || 0);
  return true;
}
function legLabelCenter(i, which) {
  if (!state.waypoints[i] || !state.waypoints[i + 1]) return null;
  const f = legFrame(i);
  const o = (which === 'in' ? state.legs[i].inLabel : state.legs[i].outLabel)
            || { a: 0, p: 0 };
  const sc = legZoomScale();
  // Issue #394: a default (unmodified) label has no stored `p`; its
  // perpendicular is computed at render time from the live leg length
  // so it stays just outside the 10° drift cone. Mirror the renderer's
  // math here so the kite is grabbable at exactly its visible position.
  let perp;
  if (o._default) {
    const a = proj(state.waypoints[i]);
    const b = proj(state.waypoints[i + 1]);
    const legLen = Math.hypot(b.x - a.x, b.y - a.y);
    const sign = which === 'in' ? 1 : -1;
    perp = sign * legDefaultLabelPerp(legLen);
  } else {
    perp = (o.p || 0) * sc;
  }
  const along = (o.a || 0) * sc;
  return { x: f.mx + f.dx * along + f.nx * perp,
           y: f.my + f.dy * along + f.ny * perp };
}

// Issue #394: when the user starts dragging a default (unmodified)
// kite, freeze the currently-rendered offset into the stored
// `{ a, p, _m: 1 }` form (drop `_default`) so subsequent drag deltas
// have a real starting point. Keeps the user-dragged path identical
// to PR #393's design — only the seed value comes from the drift-cone
// formula instead of a fixed `±44 / legArrowSize`.
function _materialiseDefaultLegLabel(legIdx, which) {
  const leg = state.legs[legIdx];
  if (!leg) return;
  const key = which === 'in' ? 'inLabel' : 'outLabel';
  const o = leg[key];
  if (!o || !o._default) return;
  const a = proj(state.waypoints[legIdx]);
  const b = proj(state.waypoints[legIdx + 1]);
  if (!a || !b) return;
  const legLen = Math.hypot(b.x - a.x, b.y - a.y);
  const sc = legZoomScale() || 1;          // never let scale be 0 here
  const sign = which === 'in' ? 1 : -1;
  const perpPx = sign * legDefaultLabelPerp(legLen);
  leg[key] = { a: o.a || 0, p: perpPx / sc, _m: 1 };
}
function hitLegLabel(px, py) {
  // #83: scale the hit radius with the same zoom + legArrowSize factor that
  // sizes the drawn marker (see drawLegArrow in draw.js), so the hit zone
  // tracks the visual size. Floor at 18 px keeps touch ergonomics.
  const hit = Math.max(tune('hitLegLabelMinPx'), tune('hitLegLabelScalePx') * legZoomScale());
  for (let i = 0; i < state.legs.length; i++) {
    for (const which of ['in', 'out']) {
      if (which === 'out' && (!showReturn || !legAllowsReturn(i))) continue;
      const c = legLabelCenter(i, which);
      if (c && Math.hypot(c.x - px, c.y - py) <= hit) return { i, which };
    }
  }
  return null;
}

// Cumulative-time kite: position relative to B endpoint with leg.cumLabel offsets.
// Mirrors legLabelCenter but anchors to B (proj of waypoints[i+1]).
function cumLabelCenter(i) {
  if (!state.waypoints[i] || !state.waypoints[i + 1]) return null;
  const a = proj(state.waypoints[i]);
  const b = proj(state.waypoints[i + 1]);
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const nx = -dy, ny = dx;
  const leg = state.legs[i];
  const o = (leg && leg.cumLabel) || { a: 0, _default: 1, _m: 1 };
  const sc = legZoomScale();
  // Use own driftPerp (not inLabel's perp) so the cum kite is independent
  // of the navigation kite position when in default state.
  const perp  = o._default ? legDefaultLabelPerp(len) : (o.p || 0) * sc;
  const along = (o.a || 0) * sc;
  return { x: b.x + dx * along + nx * perp,
           y: b.y + dy * along + ny * perp };
}
function _materialiseDefaultCumLabel(legIdx) {
  const leg = state.legs[legIdx];
  if (!leg) return;
  // Create default label if missing (legs loaded before this feature was added).
  const o = leg.cumLabel || { a: 0, _default: 1, _m: 1 };
  if (!o._default) return;  // already user-positioned
  const a = proj(state.waypoints[legIdx]);
  const b = proj(state.waypoints[legIdx + 1]);
  if (!a || !b) return;
  const legLen = Math.hypot(b.x - a.x, b.y - a.y);
  const sc = legZoomScale() || 1;
  const perpPx = legDefaultLabelPerp(legLen);
  leg.cumLabel = { a: o.a || 0, p: perpPx / sc, _m: 1 };
}
function hitCumLabel(px, py) {
  const hit = Math.max(tune('hitCumLabelMinPx'), tune('hitCumLabelScalePx') * legZoomScale());
  for (let i = 0; i < state.legs.length; i++) {
    const c = cumLabelCenter(i);
    if (c && Math.hypot(c.x - px, c.y - py) <= hit) return { i };
  }
  return null;
}

// Return cumulative-time kite: anchored at A (proj of waypoints[i]) with its
// own leg.cumLabelRet offsets. Same +dx/+nx frame as cumLabelCenter so the
// drag math is shared; default sits on the opposite perpendicular side.
function cumLabelRetCenter(i) {
  if (!state.waypoints[i] || !state.waypoints[i + 1]) return null;
  const a = proj(state.waypoints[i]);
  const b = proj(state.waypoints[i + 1]);
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const nx = -dy, ny = dx;
  const leg = state.legs[i];
  const o = (leg && leg.cumLabelRet) || { a: 0, _default: 1, _m: 1 };
  const sc = legZoomScale();
  const perp  = o._default ? -legDefaultLabelPerp(len) : (o.p || 0) * sc;
  const along = (o.a || 0) * sc;
  return { x: a.x + dx * along + nx * perp,
           y: a.y + dy * along + ny * perp };
}
function _materialiseDefaultCumLabelRet(legIdx) {
  const leg = state.legs[legIdx];
  if (!leg) return;
  const o = leg.cumLabelRet || { a: 0, _default: 1, _m: 1 };
  if (!o._default) return;
  const a = proj(state.waypoints[legIdx]);
  const b = proj(state.waypoints[legIdx + 1]);
  if (!a || !b) return;
  const legLen = Math.hypot(b.x - a.x, b.y - a.y);
  const sc = legZoomScale() || 1;
  const perpPx = legDefaultLabelPerp(legLen);
  leg.cumLabelRet = { a: o.a || 0, p: -perpPx / sc, _m: 1 };  // default is the -perp side
}
function cumLabelDragFrame(legIdx, isReturn) {
  if (!state.waypoints[legIdx] || !state.waypoints[legIdx + 1]) return null;
  const a = proj(state.waypoints[legIdx]);
  const b = proj(state.waypoints[legIdx + 1]);
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  return {
    anchor: isReturn ? a : b,
    dx,
    dy,
    nx: -dy,
    ny: dx,
  };
}
function setCumLabelFromPoint(legIdx, isReturn, px, py) {
  const leg = state.legs[legIdx];
  const frame = cumLabelDragFrame(legIdx, isReturn);
  if (!leg || !frame) return;
  const key = isReturn ? 'cumLabelRet' : 'cumLabel';
  const label = leg[key] || { a: 0, p: 0, _m: 1 };
  const vx = px - frame.anchor.x;
  const vy = py - frame.anchor.y;
  const sc = legZoomScale() || 1;
  label.a = (vx * frame.dx + vy * frame.dy) / sc;
  label.p = (vx * frame.nx + vy * frame.ny) / sc;
  label._m = 1;
  delete label._default;
  leg[key] = label;
}
function hitCumLabelRet(px, py) {
  if (!showReturn) return null;          // return kite only drawn with the return path
  const hit = Math.max(tune('hitCumLabelMinPx'), tune('hitCumLabelScalePx') * legZoomScale());
  for (let i = 0; i < state.legs.length; i++) {
    if (!legAllowsReturn(i)) continue;
    const c = cumLabelRetCenter(i);
    if (c && Math.hypot(c.x - px, c.y - py) <= hit) return { i };
  }
  return null;
}

// --- inspector -------------------------------------------------------
// When an altitude is edited on leg `i`, propagate the new value to legs
// that currently share the OLD value, walking outward in the natural
// flight direction for that altitude (inbound forward, outbound backward).
// Stops at the first leg that already differs, so intentional level
// changes downstream are preserved.
function propagateAlt(i, key, newVal, oldVal) {
  const altitudeKey = key === 'inboundAltitude' || key === 'outboundAltitude';
  if (altitudeKey ? sameAltitudeValue(newVal, oldVal) : newVal === oldVal) return;
  let pairChanged = false;
  if (altitudeKey) {
    markLegAltitudeManual(i);
    pairChanged = syncLegAltitudePairFromRouteLeg(i, key, newVal) || pairChanged;
  }
  const dir = key === 'outboundAltitude' || key === 'outboundSpeed' ? -1 : 1;
  for (let j = i + dir; j >= 0 && j < state.legs.length; j += dir) {
    if (altitudeKey
      ? !sameAltitudeValue(state.legs[j][key], oldVal)
      : state.legs[j][key] !== oldVal) break;
    state.legs[j][key] = newVal;
    if (altitudeKey) {
      markLegAltitudeManual(j);
      pairChanged = syncLegAltitudePairFromRouteLeg(j, key, newVal) || pairChanged;
    }
  }
  if (pairChanged && typeof refreshAltitudePairsTableIfOpen === 'function') {
    refreshAltitudePairsTableIfOpen();
  }
}

// Remove waypoint k and the leg beside it, so the remaining legs keep
// their altitudes / speeds aligned with the route geometry.
function deleteWaypoint(k) {
  const wp = state.waypoints[k];
  const ccName = wp && typeof canonicalNavWaypointName === 'function'
    ? canonicalNavWaypointName(wp.name) : '';
  state.waypoints.splice(k, 1);
  if (state.legs.length) {
    state.legs.splice(Math.min(k, state.legs.length - 1), 1);
  }
  if (ccName && Array.isArray(state.notes) &&
      !state.waypoints.some(w => canonicalNavWaypointName(w && w.name) === ccName)) {
    state.notes = state.notes.filter(n =>
      !(n && n.cc && canonicalNavWaypointName(n.cc) === ccName));
    if (typeof unsuppressCommChange === 'function') unsuppressCommChange(ccName);
  }
  syncLegs();
}

function splitLegCopy(source) {
  const d = _defaultLegLabels();
  const leg = {
    inboundAltitude: source ? source.inboundAltitude : NaN,
    outboundAltitude: source ? source.outboundAltitude : NaN,
    flightSpeed: source && Number.isFinite(source.flightSpeed) && source.flightSpeed > 0
      ? source.flightSpeed : 90,
    outboundSpeed: source && Number.isFinite(source.outboundSpeed) && source.outboundSpeed > 0
      ? source.outboundSpeed
      : (source && Number.isFinite(source.flightSpeed) && source.flightSpeed > 0
        ? source.flightSpeed : 90),
    inLabel: d.inLabel,
    outLabel: d.outLabel,
    cumLabel: d.cumLabel,
    cumLabelRet: d.cumLabelRet,
  };
  if (source && source.vorRef) leg.vorRef = source.vorRef;
  for (const key of ['_legAltitudeInboundBlocked', '_legAltitudeOutboundBlocked', '_legAltitudeOneWay']) {
    if (source && source[key]) leg[key] = source[key];
  }
  return leg;
}

function splitLegAt(legIndex, latlng) {
  const i = Number(legIndex);
  if (!Number.isInteger(i) || i < 0 || i >= state.legs.length) return false;
  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return false;
  if (!state.waypoints[i] || !state.waypoints[i + 1]) return false;

  const source = state.legs[i];
  const inserted = { lat: r5(latlng.lat), lng: r5(latlng.lng), name: '', _defaultWpName: 1 };
  state.waypoints.splice(i + 1, 0, inserted);
  state.legs.splice(i, 1, splitLegCopy(source), splitLegCopy(source));
  if (state.legs.length !== Math.max(0, state.waypoints.length - 1)) syncLegs();
  state.selected = { type: 'wp', index: i + 1 };
  draw();
  showInspector();
  return true;
}
window.splitLegAt = splitLegAt;

function deleteSelectedWpOrNote() {
  if (state.selected.type === 'wp') {
    deleteWaypoint(state.selected.index);
    state.selected = null;
    draw(); showInspector();
  } else if (state.selected.type === 'note') {
    const note = state.notes[state.selected.index];
    if (note && note.cc && typeof suppressCommChange === 'function') suppressCommChange(note.cc);
    state.notes.splice(state.selected.index, 1);
    state.selected = null;
    draw(); showInspector();
  }
}

// Issue #418: resolve a waypoint to its nearest reference point
// (airfield or nav waypoint) within the same ~18 px snap distance the
// drop / drag path uses (`applyNavSnap`). Airfields take priority over
// nav-WPs because they are a smaller, strongly-known set of landmarks
// (matches applyNavSnap()). Independent of `showNavWP` / `showAirfields`
// so the reset action works even when the overlays are hidden.
// Returns the canonical code (4-letter ICAO / 5-letter nav-WP)
// rather than the locale label, so `navName()` can resolve it back to
// the user's locale at render time.
function findSnappedReference(wp) {
  if (!wp || typeof map === 'undefined' || !map) return null;
  const hit = typeof nearestReference === 'function'
    ? nearestReference(wp, {
        pxThreshold: 18,
        includeAirfields: true,
        includeNavWaypoints: true,
      })
    : null;
  return hit && hit.ref ? Object.assign({ kind: hit.kind }, hit.ref) : null;
}

// Issue #418: inspector "↺ Reset waypoint name" handler. Restores the
// snapped reference code if the waypoint sits on one; otherwise clears
// the name so the dimmed sequence placeholder (`S.wpPrefix` + N) shows.
function resetWpName(idx) {
  const wp = state.waypoints[idx];
  if (!wp) return;
  const snapped = findSnappedReference(wp);
  wp.name = snapped ? snapped.name : '';
  applyLegAltitudesToRoute();
  persist();
  draw();
  showInspector();
}
window.resetWpName = resetWpName;
window.findSnappedReference = findSnappedReference;

// Issue #418: Build toolbar — same naming rules as `resetWpName` for
// every waypoint in one shot (confirm in ui.js).
function resetAllWpNames() {
  for (let i = 0; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i];
    if (!wp) continue;
    const snapped = findSnappedReference(wp);
    wp.name = snapped ? snapped.name : '';
  }
  applyLegAltitudesToRoute();
  persist();
  draw();
  showInspector();
}
window.resetAllWpNames = resetAllWpNames;

// Compose the leg-inspector title from the names of its endpoints, e.g.
// "TLV → NETANYA" (LTR) / "TLV ← NETANYA" (RTL). Falls back to the sequence
// label (`WP N` / `נק׳ N`) for unnamed waypoints, and to the legacy
// "Leg N" string if the adjacent waypoints can't be resolved.
function legPairTitle(idx) {
  try {
    const a = state.waypoints[idx];
    const b = state.waypoints[idx + 1];
    if (!a || !b) return S.legTitle(idx + 1);
    const arrow = S.legArrow || '→';
    return waypointDisplayLabel(a, idx) + ' ' + arrow + ' ' +
      waypointDisplayLabel(b, idx + 1);
  } catch (e) {
    return S.legTitle(idx + 1);
  }
}

function inspectorVorIdent() {
  return inspectorVorRef === undefined ? (vorRef || '') : (inspectorVorRef || '');
}

function populateInspectorVorSelect(sel, selected) {
  if (!sel) return;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = S.vorRefNone || '— none —';
  sel.appendChild(none);
  for (const v of (vors || [])) {
    const opt = document.createElement('option');
    opt.value = v.ident;
    opt.textContent = v.ident;
    sel.appendChild(opt);
  }
  sel.value = selected || '';
}

// Shared inspector-only VOR selector + "From <VOR>  R-xxx° / yy.y NM" readout.
// Changing this selector never writes `vorRef` or localStorage; it only changes
// the active inspector readout.
function appendVorRadialRow(body, lat, lng) {
  if (typeof vorByIdent !== 'function' || typeof vorRadialDme !== 'function') return;
  if (vors === null && typeof loadVors === 'function') {
    loadVors().then(() => {
      if (state.selected) showInspector();
    });
  }
  const row = document.createElement('div');
  row.className = 'row vor-radial-row';
  const label = document.createElement('label');
  label.textContent = S.vorRefLabel || 'VOR ref';
  const controls = document.createElement('div');
  controls.className = 'vor-radial-controls';
  const sel = document.createElement('select');
  sel.className = 'insp-vor-ref';
  sel.setAttribute('aria-label', S.vorRefLabel || 'VOR ref');
  const val = document.createElement('span');
  val.className = 'val vor-radial-val';
  const render = () => {
    const v = vorByIdent(sel.value);
    const rd = v ? vorRadialDme(v, lat, lng) : null;
    val.textContent = rd ? S.vorRadialDme(rd.radial, rd.dme) : '';
    val.title = v && rd ? S.vorFrom(v.ident) : '';
  };
  populateInspectorVorSelect(sel, inspectorVorIdent());
  sel.onchange = () => {
    window.inspectorVorRef = sel.value || '';
    render();
  };
  controls.append(sel, val);
  row.append(label, controls);
  render();
  body.appendChild(row);
}

function airfieldAtisText(af) {
  return typeof airfieldFieldText === 'function'
    ? airfieldFieldText(af, 'atis')
    : (af && typeof af.atis === 'string' ? af.atis.trim() : '');
}

function airfieldClearanceText(af) {
  return typeof airfieldFieldText === 'function'
    ? airfieldFieldText(af, 'clearance')
    : (af && typeof af.clearance === 'string' ? af.clearance.trim() : '');
}

const AIRFIELD_CALL_SIGN_IDS = {
  GVULT: null,
  KKDEM: 'KEDEM',
  LLAR: 'ARAD',
  LLBG: 'BEN_GURION',
  LLBO: 'HABONIM',
  LLBS: 'TEYMAN',
  LLEK: 'TEL_NOF',
  LLER: 'EILAT',
  LLES: null,
  LLEV: 'EIN_VERED',
  LLEY: 'EIN_YAHAV',
  LLFK: 'PIK',
  LLHA: 'HAIFA',
  LLHB: 'HATZERIM_NORTH',
  LLHS: 'HATZOR',
  LLHZ: 'HERZLIYA',
  LLIB: 'ROSH_PINA',
  LLKS: 'KIRYAT_SHMONA',
  LLKZ: null,
  LLMG: 'MEGIDDO',
  LLMZ: 'MASADA',
  LLNV: 'NEVATIM',
  LLOV: 'OVDA',
  LLPL: 'PALMACHIM',
  LLRD: 'RAMAT_DAVID',
  LLRM: 'RAMON',
  LLRS: 'RISHON_LEZION',
};

function airfieldPrimaryText(af) {
  const id = af && Object.prototype.hasOwnProperty.call(AIRFIELD_CALL_SIGN_IDS, af.name)
    ? AIRFIELD_CALL_SIGN_IDS[af.name] : null;
  if (!id) return '';
  // Effective freq honours a freq-table override, falling back to the catalog
  // default — so an edited frequency reflects in the inspector + Freq column.
  const eff = typeof commCallSignEffectiveFreq === 'function'
    ? commCallSignEffectiveFreq(id)
    : (() => {
        const row = typeof commCatalogCallSignRow === 'function' ? commCatalogCallSignRow(id) : null;
        const p = row && typeof row.primary === 'string' ? row.primary.trim() : '';
        return p && typeof commFormatFreq === 'function' ? commFormatFreq(p) : p;
      })();
  return eff ? eff + ' MHz' : '';
}

function refreshAirfieldInspectorAfterCommCatalog(af) {
  if (!af || commChangeMap !== null || typeof loadCommChange !== 'function') return;
  loadCommChange().then(() => {
    const sel = state && state.selected;
    let current = null;
    if (sel && sel.type === 'airfield' && airfields) {
      current = airfields[sel.index];
    } else if (sel && sel.type === 'wp' && typeof airfieldAtWaypoint === 'function') {
      current = airfieldAtWaypoint(state.waypoints[sel.index]);
    }
    if (current && current.name === af.name) showInspector();
  });
}

// Generic editable-frequency inspector row. `opts`:
//   value      current displayed freq, def default, rowClass extra class
//   isOverride() -> bool, commit(norm) -> displayed value, onReset()
function freqEditRow(label, opts) {
  const row = document.createElement('div');
  row.className = 'row' + (opts.rowClass ? ' ' + opts.rowClass : '');
  const l = document.createElement('label');
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'val';
  v.dir = 'ltr';                   // frequencies always read LTR, even in RTL UI
  const inp = document.createElement('input');
  inp.className = 'charts-freq-input';
  inp.dir = 'ltr';
  if (typeof commConfigureFreqInput === 'function') commConfigureFreqInput(inp);
  else { inp.type = 'number'; inp.inputMode = 'decimal'; inp.step = '0.005'; }
  inp.value = opts.value || opts.def || '';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'commchange-freq-reset';
  reset.textContent = '↻';
  reset.title = S.resetFreqOverride || S.sliderReset || 'Reset to default';
  const norm = () => (typeof commNormalizeFreqInput === 'function'
    ? commNormalizeFreqInput(inp.value) : String(inp.value || '').trim());
  function sync() {
    const n = norm();
    const invalid = n === null;
    inp.classList.toggle('invalid', invalid);
    inp.classList.toggle('is-default', !invalid && !!opts.def && (n || '') === opts.def);
    reset.disabled = !opts.def || (!opts.isOverride() && !invalid);
  }
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  inp.addEventListener('input', sync);
  inp.addEventListener('change', () => {
    const n = norm();
    if (n === null) { sync(); return; }
    inp.value = opts.commit(n) || n || inp.value;
    sync();
    draw();
  });
  reset.onclick = () => {
    if (reset.disabled) return;
    inp.value = (opts.onReset && opts.onReset()) || opts.def || '';
    sync();
    draw();
  };
  v.append(inp, reset);
  row.append(l, v);
  sync();
  return row;
}

function appendAirfieldFrequencyRows(body, af) {
  const id = af && Object.prototype.hasOwnProperty.call(AIRFIELD_CALL_SIGN_IDS, af.name)
    ? AIRFIELD_CALL_SIGN_IDS[af.name] : null;
  if (id) {
    const template = typeof commCallSignTemplateFreq === 'function' ? commCallSignTemplateFreq(id) : '';
    body.appendChild(freqEditRow(S.primary || 'Primary', {
      value: typeof commCallSignEffectiveFreq === 'function' ? commCallSignEffectiveFreq(id) : '',
      def: template, rowClass: 'primary-row',
      isOverride: () => !!(typeof commCallSignOverrideFreq === 'function' && commCallSignOverrideFreq(id)),
      commit: n => typeof commApplyCallSignFreqOverride === 'function' ? commApplyCallSignFreqOverride(id, n) : n,
      onReset: () => { if (typeof commResetCallSignFreqOverride === 'function') commResetCallSignFreqOverride(id); return template; },
    }));
  } else {
    const primary = airfieldPrimaryText(af);
    if (primary) {
      const row = textRow(S.primary || 'Primary', primary);
      row.classList.add('primary-row');
      body.appendChild(row);
    } else {
      refreshAirfieldInspectorAfterCommCatalog(af);
    }
  }
  // Clearance / ATIS — one editable numeric field per labelled part (#freq).
  const appendFieldParts = (field, label, rowClass) => {
    const parts = typeof airfieldFieldParts === 'function' ? airfieldFieldParts(af, field) : [];
    for (const p of parts) {
      const rowLabel = p.label ? label + ' ' + p.label : label;
      body.appendChild(freqEditRow(rowLabel, {
        value: p.freq, def: p.def, rowClass,
        isOverride: () => p.overridden,
        commit: n => { setAirfieldFreqOverride(p.key, n === p.def ? '' : n); p.freq = n; p.overridden = n !== p.def; return n; },
        onReset: () => { setAirfieldFreqOverride(p.key, ''); p.freq = p.def; p.overridden = false; return p.def; },
      }));
    }
  };
  appendFieldParts('clearance', S.clearance || 'Clearance', 'clearance-row');
  appendFieldParts('atis', S.atis || 'ATIS', 'atis-row');
}

const SATELLITE_TILE_SIZE = 256;
const SATELLITE_PREVIEW_ZOOM = 16;
const SATELLITE_EXPANDED_ZOOM = 17;
const SATELLITE_MIN_ZOOM = 13;
const SATELLITE_MAX_ZOOM = 18;
const SATELLITE_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/' +
  'World_Imagery/MapServer/tile/';

function clampSatelliteZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return SATELLITE_EXPANDED_ZOOM;
  return Math.max(SATELLITE_MIN_ZOOM, Math.min(SATELLITE_MAX_ZOOM, Math.round(n)));
}

function satelliteTileUrl(z, x, y) {
  return SATELLITE_TILE_URL + z + '/' + y + '/' + x;
}

function satelliteTilePoint(lat, lng, z) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  const safeLng = Number(lng);
  const rad = clampedLat * Math.PI / 180;
  const n = Math.pow(2, z);
  const x = ((safeLng + 180) / 360) * n;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
  return { x, y, n };
}

// Rotate a static satellite preview's tile layer to match the main map's
// bearing — same visual orientation as the live (leaflet-rotate) modal map.
function applySatelliteSnippetRotation(snippet) {
  if (!snippet) return;
  const tiles = snippet.querySelector('.satellite-snippet-tiles');
  if (!tiles) return;
  const b = (typeof map !== 'undefined' && map.getBearing) ? map.getBearing() : 0;
  tiles.style.transform = 'rotate(' + b + 'deg)';
}
// One-time hook: keep any visible inspector preview aligned as the main map
// rotates (e.g. via the dial or the satellite modal's two-way sync).
let _satSnippetRotateHooked = false;
function hookSatelliteSnippetRotation() {
  if (_satSnippetRotateHooked || typeof map === 'undefined' || !map.on) return;
  _satSnippetRotateHooked = true;
  const update = () => {
    document.querySelectorAll('.satellite-snippet:not(.satellite-expanded)')
      .forEach(applySatelliteSnippetRotation);
  };
  map.on('rotate', update);
  map.on('rotateend', update);
}

function buildSatelliteSnippet(point, opts = {}) {
  const lat = Number(point && point.lat);
  const lng = Number(point && point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const expanded = !!opts.expanded;
  const width = expanded ? Math.max(300, Math.min(620, window.innerWidth - 64)) : 214;
  const height = expanded ? Math.max(220, Math.min(420, window.innerHeight - 180)) : 118;
  const z = expanded ? clampSatelliteZoom(opts.zoom) : SATELLITE_PREVIEW_ZOOM;
  const p = satelliteTilePoint(lat, lng, z);
  const centerTileX = Math.floor(p.x);
  const centerTileY = Math.floor(p.y);
  const globalX = p.x * SATELLITE_TILE_SIZE;
  const globalY = p.y * SATELLITE_TILE_SIZE;
  const snippet = document.createElement('div');
  snippet.className = 'satellite-snippet' + (expanded ? ' satellite-expanded' : '');
  snippet.dataset.zoom = String(z);
  snippet.style.setProperty('--sat-width', width + 'px');
  snippet.style.setProperty('--sat-height', height + 'px');
  // Tiles live in their own layer so the preview can rotate to match the main
  // map's bearing while the crosshair / attribution stay upright. The 3×3 grid
  // overscans the visible box, so rotation never reveals corner gaps.
  const tiles = document.createElement('div');
  tiles.className = 'satellite-snippet-tiles';
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tileX = ((centerTileX + dx) % p.n + p.n) % p.n;
      const tileY = Math.max(0, Math.min(p.n - 1, centerTileY + dy));
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = satelliteTileUrl(z, tileX, tileY);
      img.style.left = ((centerTileX + dx) * SATELLITE_TILE_SIZE - globalX + width / 2) + 'px';
      img.style.top = ((centerTileY + dy) * SATELLITE_TILE_SIZE - globalY + height / 2) + 'px';
      tiles.appendChild(img);
    }
  }
  snippet.appendChild(tiles);
  // Static preview rotates to the main map's bearing (expanded view is a live
  // Leaflet map and handles its own rotation).
  if (!expanded) applySatelliteSnippetRotation(snippet);
  const cross = document.createElement('span');
  cross.className = 'satellite-crosshair';
  snippet.appendChild(cross);
  const attr = document.createElement('span');
  attr.className = 'satellite-attribution';
  attr.textContent = S.satelliteAttribution || 'Imagery © Esri';
  snippet.appendChild(attr);
  return snippet;
}

// Fresh, independent copies of the main map's base layers. Leaflet attaches a
// tile layer to a single map, so the modal must NOT reuse the live instances
// from core.js (that would yank them off the main map) — clone url + options.
function satelliteModalLayers() {
  const out = {};
  if (typeof layers !== 'object' || !layers) return out;
  for (const nm in layers) {
    const src = layers[nm];
    if (src && src._url) out[nm] = L.tileLayer(src._url, Object.assign({}, src.options));
  }
  return out;
}

// Rotation dial for the satellite modal — mirrors the main map's bottom-right
// dial: drag to rotate, tap to step 0/90/180/270, needle shows north.
function satelliteRotateControl(lmap) {
  const Ctl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      const wrap = L.DomUtil.create('div', 'leaflet-control satellite-rotate-ctrl');
      const dial = L.DomUtil.create('span', 'satellite-rotate-dial', wrap);
      dial.setAttribute('role', 'slider');
      dial.tabIndex = 0;
      const needle = L.DomUtil.create('span', 'satellite-rotate-needle', dial);
      const bearing = () => (lmap.getBearing ? lmap.getBearing() : 0);
      const refresh = () => {
        const b = (((360 - Math.round(bearing())) % 360) + 360) % 360;
        needle.style.transform = 'rotate(' + b + 'deg)';
        dial.title = (typeof S !== 'undefined' && S.dialTitle) ? S.dialTitle(b) : ('Rotation ' + b + '°');
      };
      const angleFrom = ev => {
        const r = dial.getBoundingClientRect();
        return Math.atan2(ev.clientX - (r.left + r.width / 2),
                          -(ev.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
      };
      let dragging = false, moved = false, sx = 0, sy = 0;
      const DRAG_PX = 8;
      dial.addEventListener('pointerdown', e => {
        dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
        dial.classList.add('dragging'); dial.setPointerCapture(e.pointerId);
      });
      dial.addEventListener('pointermove', e => {
        if (!dragging) return;
        if (!moved) {
          if (Math.hypot(e.clientX - sx, e.clientY - sy) < DRAG_PX) return;
          moved = true;
        }
        if (lmap.setBearing) lmap.setBearing(((360 - angleFrom(e)) % 360 + 360) % 360);
      });
      const end = cycle => {
        if (cycle && dragging && !moved && lmap.setBearing) {
          const shown = (((360 - Math.round(bearing())) % 360) + 360) % 360;
          const next = shown % 90 === 0 ? (shown + 90) % 360 : 0;
          lmap.setBearing((360 - next) % 360);
        }
        dragging = false; dial.classList.remove('dragging');
      };
      dial.addEventListener('pointerup', () => end(true));
      dial.addEventListener('pointercancel', () => end(false));
      lmap.on('rotate', refresh);
      lmap.on('rotateend', refresh);
      refresh();
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      return wrap;
    },
  });
  return new Ctl();
}

// Reset-to-centre control: snaps the modal map back over the waypoint. Built
// as a Leaflet bar so it matches the zoom control's look in the same corner.
function satelliteResetControl(lmap, point, zoom) {
  const Ctl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      const c = L.DomUtil.create('div', 'leaflet-bar satellite-reset-control');
      const a = L.DomUtil.create('a', '', c);
      a.href = '#';
      a.innerHTML = '⌖';
      a.title = S.satelliteResetCenter || 'Recentre on waypoint';
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', S.satelliteResetCenter || 'Recentre on waypoint');
      L.DomEvent.on(a, 'click', function (e) {
        L.DomEvent.stop(e);
        lmap.setView([point.lat, point.lng], zoom);
      });
      L.DomEvent.disableClickPropagation(c);
      return c;
    },
  });
  return new Ctl();
}

function textDirection(text) {
  for (const ch of String(text || '')) {
    if (/[\u0590-\u05ff]/.test(ch)) return 'rtl';
    if (/[A-Za-z0-9]/.test(ch)) return 'ltr';
  }
  return 'auto';
}

function appendBidiSpan(parent, text, dir) {
  const span = document.createElement('span');
  span.dir = dir || textDirection(text);
  span.style.unicodeBidi = 'isolate';
  span.textContent = text;
  parent.appendChild(span);
}

function setSatelliteModalTitle(title, label, point) {
  if (!title) return;
  title.textContent = '';
  const labelText = String(label || '').trim();
  if (labelText) {
    const parts = labelText.split(' / ');
    parts.forEach((part, i) => {
      if (i) title.appendChild(document.createTextNode(' / '));
      appendBidiSpan(title, part, textDirection(part));
    });
    title.appendChild(document.createTextNode(' - '));
  }
  appendBidiSpan(title,
    fmtLatLng(point.lat, 'N', 'S') + ' ' + fmtLatLng(point.lng, 'E', 'W'),
    'ltr');
}

function showSatellitePreviewModal(point, label) {
  if (typeof createDraggableModal !== 'function' || typeof L === 'undefined') return;
  // Destroy the Leaflet map on close — otherwise each open/close leaks the
  // map instance, its zoomend listener, the cloned tile layers, and Leaflet's
  // internal window hooks (they keep referencing the detached modal DOM).
  let lmap = null;
  // Bearing is kept in sync both ways with the main map. _syncingBearing
  // guards against the set→event→set feedback loop. mainRotateHandler is
  // detached on close so the closed modal's map isn't poked by later rotations.
  let _syncingBearing = false;
  let mainRotateHandler = null;
  // The title bar shows the location name + coordinates (replacing the generic
  // "Satellite view" header) so the point identity sits at the top, not below.
  const modal = createDraggableModal('',
    'modal satellite-preview-modal',
    () => {
      if (mainRotateHandler && typeof map !== 'undefined' && map.off) {
        map.off('rotate', mainRotateHandler);
        map.off('rotateend', mainRotateHandler);
        mainRotateHandler = null;
      }
      if (lmap) { lmap.remove(); lmap = null; }
      if (typeof window !== 'undefined') window.__satModalMap = null;
    },
    { titleDir: 'ltr', titleBidi: 'isolate' });
  setSatelliteModalTitle(modal.title, label, point);
  const body = document.createElement('div');
  body.className = 'satellite-preview-body';
  const mapEl = document.createElement('div');
  mapEl.className = 'satellite-preview-map';
  body.appendChild(mapEl);
  modal.box.appendChild(body);
  modal.show();
  // Build the map after show() so the container has its final dimensions.
  const mLayers = satelliteModalLayers();
  // Default to the satellite imagery (this is the "satellite view"), falling
  // back to the chart if the layer set is somehow empty.
  const startLayer = mLayers.Satellite || mLayers.CVFR || Object.values(mLayers)[0];
  lmap = L.map(mapEl, {
    center: [point.lat, point.lng],
    zoom: SATELLITE_EXPANDED_ZOOM,
    minZoom: SATELLITE_MIN_ZOOM,
    maxZoom: SATELLITE_MAX_ZOOM,
    layers: startLayer ? [startLayer] : [],
    zoomControl: false,
    rotate: true,                // leaflet-rotate: enable bearing
    rotateControl: false,        // own dial instead
    touchRotate: true,
  });
  // Start aligned to the main map's current orientation.
  if (lmap.setBearing && typeof map !== 'undefined' && map.getBearing) {
    lmap.setBearing(map.getBearing());
  }
  // Black-on-white zoom buttons, bottom-right — identical to the main map.
  L.control.zoom({ position: 'bottomright' }).addTo(lmap);
  lmap.addControl(satelliteRotateControl(lmap));
  // Two-way bearing sync: rotating either map rotates the other.
  if (lmap.setBearing && typeof map !== 'undefined' && map.setBearing) {
    const syncToMain = () => {
      if (_syncingBearing) return;
      _syncingBearing = true;
      try { map.setBearing(lmap.getBearing()); } finally { _syncingBearing = false; }
    };
    lmap.on('rotate', syncToMain);
    lmap.on('rotateend', syncToMain);
    mainRotateHandler = () => {
      if (_syncingBearing || !lmap) return;
      _syncingBearing = true;
      try { lmap.setBearing(map.getBearing()); } finally { _syncingBearing = false; }
    };
    map.on('rotate', mainRotateHandler);
    map.on('rotateend', mainRotateHandler);
  }
  // Test hook: expose the modal map (mirrors window.__commChangeRingsDrawn etc.)
  if (typeof window !== 'undefined') window.__satModalMap = lmap;
  // Layer picker as a dropdown, matching the main app's view-menu selector
  // (#layer-select) instead of Leaflet's radio list.
  const layerNames = Object.keys(mLayers);
  if (layerNames.length) {
    // The 4 flight-maps.com charts only publish tiles up to a limited zoom;
    // past that they 404. Disable picking them when zoomed in beyond their
    // range, and drop back to satellite if one was active.
    const CHART_NAMES = ['CVFR', 'Navigation', 'Low Alt', 'Helicopters'];
    const chartMax = nm => (mLayers[nm] && mLayers[nm].options &&
      mLayers[nm].options.maxZoom) || SATELLITE_MAX_ZOOM;
    const LayerSelect = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const c = L.DomUtil.create('div', 'satellite-layer-control');
        const sel = L.DomUtil.create('select', 'satellite-layer-select', c);
        sel.setAttribute('aria-label', S.exportLayer || 'Map layer');
        for (const nm of layerNames) {
          const opt = document.createElement('option');
          opt.value = nm;
          opt.textContent = (S.layerLabels && S.layerLabels[nm]) || nm;
          if (lmap.hasLayer(mLayers[nm])) opt.selected = true;
          sel.appendChild(opt);
        }
        L.DomEvent.disableClickPropagation(c);
        L.DomEvent.on(sel, 'change', () => {
          for (const nm of layerNames) {
            if (lmap.hasLayer(mLayers[nm])) lmap.removeLayer(mLayers[nm]);
          }
          lmap.addLayer(mLayers[sel.value]);
        });
        this._select = sel;
        return c;
      },
    });
    const layerCtl = new LayerSelect();
    lmap.addControl(layerCtl);
    function syncLayerAvailability() {
      const z = lmap.getZoom();
      const sel = layerCtl._select;
      if (sel) {
        Array.from(sel.options).forEach(opt => {
          if (CHART_NAMES.indexOf(opt.value) !== -1) opt.disabled = z > chartMax(opt.value);
        });
      }
      // Active chart out of range → fall back to satellite imagery.
      for (const nm of CHART_NAMES) {
        if (mLayers[nm] && lmap.hasLayer(mLayers[nm]) && z > chartMax(nm)) {
          lmap.removeLayer(mLayers[nm]);
          if (mLayers.Satellite) lmap.addLayer(mLayers.Satellite);
          if (sel && mLayers.Satellite) sel.value = 'Satellite';
          break;
        }
      }
    }
    lmap.on('zoomend', syncLayerAvailability);
    syncLayerAvailability();
  }
  lmap.addControl(satelliteResetControl(lmap, point, SATELLITE_EXPANDED_ZOOM));
  // Marker on the waypoint so it stays findable after panning.
  L.circleMarker([point.lat, point.lng], {
    radius: 7, color: '#ffda4c', weight: 2, opacity: 0.96, fill: false,
    className: 'satellite-marker',
  }).addTo(lmap);
  setTimeout(() => { if (lmap) lmap.invalidateSize(); }, 0);
}

function appendSatelliteSnippet(body, point, label) {
  const snippet = buildSatelliteSnippet(point);
  if (!snippet) return;
  hookSatelliteSnippetRotation();
  const section = document.createElement('div');
  section.className = 'satellite-snippet-section';
  const head = document.createElement('div');
  head.className = 'satellite-snippet-head';
  const title = document.createElement('label');
  title.textContent = S.satelliteSnippet || 'Satellite';
  head.appendChild(title);
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'satellite-expand-hint';
  expand.textContent = S.satelliteExpand || 'Expand';
  head.appendChild(expand);
  section.appendChild(head);
  snippet.tabIndex = 0;
  snippet.setAttribute('role', 'button');
  snippet.setAttribute('aria-label', S.satelliteSnippetOpen || 'Expand satellite view');
  const open = () => showSatellitePreviewModal(point, label);
  snippet.addEventListener('click', open);
  snippet.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    open();
  });
  expand.onclick = open;
  section.appendChild(snippet);
  body.appendChild(section);
}

// Grouped, clickable BYOP plate chips for an airfield (read-only inspector).
function appendAirfieldPlates(body, af) {
  if (!af || !Array.isArray(af.plates) || !af.plates.length) return;
  const section = document.createElement('div');
  section.className = 'plates-section';
  const label = document.createElement('div');
  label.className = 'row';
  const l = document.createElement('label');
  l.textContent = S.plates;
  label.appendChild(l);
  section.appendChild(label);
  const groups = {};
  const catOrder = ['approach', 'sid', 'star', 'ground', 'vfr', 'other'];
  const catLabel = {
    approach: S.plateCategoryApproach, sid: S.plateCategorySid,
    star: S.plateCategoryStar, ground: S.plateCategoryGround,
    vfr: S.plateCategoryVfr, other: S.plateCategoryOther,
  };
  for (const fn of af.plates) {
    const cat = plateCategory(fn);
    (groups[cat] || (groups[cat] = [])).push(fn);
  }
  for (const cat of catOrder) {
    if (!groups[cat]) continue;
    const row = document.createElement('div');
    row.className = 'row';
    const catLbl = document.createElement('label');
    catLbl.textContent = catLabel[cat];
    row.appendChild(catLbl);
    const chips = document.createElement('span');
    for (const fn of groups[cat]) {
      const chip = document.createElement('button');
      chip.className = 'plate-chip';
      chip.textContent = prettyPlateLabel(fn);
      chip.onclick = () => showPlateViewer(fn, prettyPlateLabel(fn));
      chips.appendChild(chip);
    }
    row.appendChild(chips);
    section.appendChild(row);
  }
  body.appendChild(section);
}

function appendAirfieldRunways(body, af) {
  if (!af || !Array.isArray(af.runways) || !af.runways.length) return;
  const row = document.createElement('div');
  row.className = 'row runways-row';
  const lbl = document.createElement('label');
  lbl.textContent = S.runways;
  row.appendChild(lbl);
  const chips = document.createElement('div');
  chips.className = 'runway-chips';
  for (const r of af.runways) {
    const chip = document.createElement('span');
    chip.className = 'runway-chip';
    chip.textContent = r;
    chips.appendChild(chip);
  }
  row.appendChild(chips);
  body.appendChild(row);
}

function appendPointCoordinateRows(body, point) {
  body.appendChild(textRow(S.latitude, fmtLatLng(point.lat, 'N', 'S')));
  body.appendChild(textRow(S.longitude, fmtLatLng(point.lng, 'E', 'W')));
}

function airfieldInspectorTitle(af) {
  return referenceInspectorTitle(af, 'airfield');
}

function appendAirfieldDetailRows(body, af, label) {
  if (Number.isFinite(af.elev_ft)) {
    body.appendChild(textRow(S.elevation || 'Elevation', af.elev_ft + ' ft'));
  }
  appendAirfieldFrequencyRows(body, af);
  appendAirfieldWeather(body, af);
  appendSatelliteSnippet(body, af, label || airfieldInspectorTitle(af));
  appendVorRadialRow(body, af.lat, af.lng);
  appendAirfieldRunways(body, af);
  appendAirfieldPlates(body, af);
}

// Live METAR / TAF for an ICAO-coded airfield (#670). Fetched on demand via a
// CORS proxy; shows decoded text with a toggle to the raw report.
function appendAirfieldWeather(body, af) {
  const icao = String(af && af.name || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(icao) || typeof fetchAirfieldWx !== 'function') return;
  const sec = document.createElement('div');
  sec.className = 'wx-section';
  const head = document.createElement('div');
  head.className = 'wx-head';
  const headLbl = document.createElement('span');
  headLbl.textContent = S.wxTitle || 'Weather';
  head.appendChild(headLbl);
  // Refresh button — re-fetch bypassing the cache (recover from a failed
  // fetch or pull newer data).
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'wx-refresh';
  refreshBtn.textContent = '↻';
  refreshBtn.title = S.wxRefresh || 'Refresh weather';
  refreshBtn.setAttribute('aria-label', refreshBtn.title);
  head.appendChild(refreshBtn);
  sec.appendChild(head);
  const bodyEl = document.createElement('div');
  bodyEl.className = 'wx-body';
  bodyEl.dir = 'ltr';                 // METAR/TAF codes are always left-to-right
  bodyEl.textContent = S.wxLoading || 'Loading…';
  sec.appendChild(bodyEl);
  body.appendChild(sec);

  let showRaw = false, data = null;
  const load = (force) => {
    bodyEl.textContent = S.wxLoading || 'Loading…';
    refreshBtn.disabled = true;
    fetchAirfieldWx(icao, force).then(d => { data = d; refreshBtn.disabled = false; render(); })
      .catch(() => { data = { error: true }; refreshBtn.disabled = false; render(); });
  };
  refreshBtn.onclick = () => load(true);
  const render = () => {
    bodyEl.innerHTML = '';
    if (!data || data.unsupported) { bodyEl.textContent = S.wxNone || 'No METAR/TAF'; return; }
    if (data.error) { bodyEl.textContent = S.wxError || 'Weather unavailable'; return; }
    if (!data.metar && !data.taf) { bodyEl.textContent = S.wxNone || 'No METAR/TAF'; return; }
    const block = (label, lines) => {
      const b = document.createElement('div');
      b.className = 'wx-block';
      const t = document.createElement('span');
      t.className = 'wx-label';
      t.textContent = label;
      b.appendChild(t);
      for (const ln of lines) {
        const d = document.createElement('div');
        d.className = 'wx-line' + (showRaw ? ' wx-raw' : '');
        d.textContent = ln;
        b.appendChild(d);
      }
      return b;
    };
    if (data.metar) {
      const lines = showRaw ? [data.metar.rawOb || data.metar.rawText || '']
        : [decodeMetar(data.metar)];
      bodyEl.appendChild(block(S.wxMetar || 'METAR', lines.filter(Boolean)));
    }
    if (data.taf) {
      let lines;
      if (showRaw) {
        lines = [data.taf.rawTAF || data.taf.rawText || ''];
      } else {
        const dec = decodeTaf(data.taf);
        lines = dec.length ? dec.map(s => s.when + ': ' + s.text) : [data.taf.rawTAF || ''];
      }
      bodyEl.appendChild(block(S.wxTaf || 'TAF', lines.filter(Boolean)));
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wx-toggle';
    toggle.textContent = showRaw ? (S.wxShowDecoded || 'Show decoded') : (S.wxShowRaw || 'Show raw');
    toggle.onclick = () => { showRaw = !showRaw; render(); };
    bodyEl.appendChild(toggle);
    if (data.generatedAt) {
      const upd = new Date(data.generatedAt);
      if (!isNaN(upd.getTime())) {
        const age = document.createElement('div');
        age.className = 'wx-updated';
        age.dir = 'auto';      // "עודכן 18:19Z" reads correctly in RTL too
        age.textContent = (S.wxUpdated || 'Updated') + ' ' +
          String(upd.getUTCHours()).padStart(2, '0') + ':' +
          String(upd.getUTCMinutes()).padStart(2, '0') + 'Z';
        bodyEl.appendChild(age);
      }
    }
  };
  load(false);
}

function showInspector() {
  const insp = document.getElementById('inspector');
  const title = document.getElementById('insp-title');
  const body = document.getElementById('insp-body');
  body.innerHTML = '';
  title.classList.remove('editable');
  title.dir = 'auto';
  const normalized = normalizeInspectorSelection(state.selected);
  if (!normalized) {
    state.selected = null;
    insp.classList.add('hidden');
    resetInspectorVorRef();
    clearStoredInspectorSelection();
    return;
  }
  state.selected = normalized;
  insp.classList.remove('hidden');

  if (state.selected.type === 'leg') {
    const idx = state.selected.index;
    const leg = state.legs[idx];
    title.value = legPairTitle(idx);
    title.placeholder = '';
    title.readOnly = true;
    title.oninput = null;
    // Wind (#722): per-leg override of the route-wide wind. Blank inputs
    // fall back to state.wind (shown as the placeholder); an explicit
    // speed of 0 marks the leg calm. The "With wind" row is a live readout
    // of the wind-triangle result (HDG/GS/WCA/time) — updated in place,
    // same pattern as the MSA row, so typing keeps focus.
    let windFxRow = null;
    const refreshWindFx = () => {
      if (!windFxRow) return;
      const A = state.waypoints[idx], B = state.waypoints[idx + 1];
      const w = (typeof legWindFor === 'function') ? legWindFor(leg) : null;
      if (!A || !B || !w) { windFxRow.style.display = 'none'; return; }
      windFxRow.style.display = '';
      const val = windFxRow.querySelector('.val');
      if (!val) return;
      const { dist, brg } = geo(A, B);
      const fx = windTriangle(brg, leg.flightSpeed, w);
      if (!fx || fx.gs <= 0) { val.textContent = S.windUnflyable; return; }
      const wca = Math.round(fx.wcaDeg);
      val.textContent = S.windEffectText(
        pad3(toMagnetic(fx.hdgTrue)), Math.round(fx.gs),
        (wca >= 0 ? '+' : '') + wca, toHMS(dist / fx.gs));
    };
    body.appendChild(numberRow(S.speedKt, leg.flightSpeed, v => {
      leg.flightSpeed = v > 0 ? v : leg.flightSpeed; draw(); refreshWindFx();
    }));
    // Reset-to-known: the charted altitude from leg-altitude.json. Read from
    // the pristine ORIGIN map (legAltitudeOriginForLeg), not the live lookup —
    // a hand-edited altitude must not redefine the inspector's "charted"
    // default / revert target. Undefined (no entry / unknown direction) means
    // the reset button is omitted — nothing authoritative to revert to.
    const known = (typeof legAltitudeOriginForLeg === 'function') ? legAltitudeOriginForLeg(idx)
      : ((typeof legAltitudeForLeg === 'function') ? legAltitudeForLeg(idx) : null);
    const knownIn  = known && Number.isFinite(known.inboundAltitude)  ? known.inboundAltitude  : undefined;
    const knownOut = known && Number.isFinite(known.outboundAltitude) ? known.outboundAltitude : undefined;
    // Minimum safe altitude (#673) row, updated in place as the altitudes
    // change — no full inspector rebuild, so the number spinner / typing keep
    // focus while the red flag and value track live.
    let msaRow = null;
    const refreshMsa = () => {
      if (!msaRow) return;
      const msa = (typeof legMsaFt === 'function') ? legMsaFt(idx) : null;
      if (!Number.isFinite(msa)) { msaRow.style.display = 'none'; return; }
      msaRow.style.display = '';
      const val = msaRow.querySelector('.val');
      if (val) val.textContent = String(msa);
      const planned = [leg.inboundAltitude, leg.outboundAltitude]
        .filter(a => Number.isFinite(a));
      msaRow.classList.toggle('msa-low',
        planned.length > 0 && Math.min.apply(null, planned) < msa);
    };
    body.appendChild(numberRow(S.inboundAlt, leg.inboundAltitude, v => {
      const oldVal = leg.inboundAltitude;
      leg.inboundAltitude = Number.isFinite(v) ? Math.round(v) : NaN;
      propagateAlt(idx, 'inboundAltitude', leg.inboundAltitude, oldVal);
      draw(); refreshMsa();
    }, { allowUnknown: true, placeholder: legAltitudePlaceholder(leg, 'inboundAltitude'),
         undoValue: knownIn, live: true,
         defaultValue: knownIn, mutedWhenDefault: true, emptyRestoresDefault: true }));
    body.appendChild(numberRow(S.outboundAlt, leg.outboundAltitude, v => {
      const oldVal = leg.outboundAltitude;
      leg.outboundAltitude = Number.isFinite(v) ? Math.round(v) : NaN;
      propagateAlt(idx, 'outboundAltitude', leg.outboundAltitude, oldVal);
      draw(); refreshMsa();
    }, { allowUnknown: true, placeholder: legAltitudePlaceholder(leg, 'outboundAltitude'),
         undoValue: knownOut, live: true,
         defaultValue: knownOut, mutedWhenDefault: true, emptyRestoresDefault: true }));
    if (window.showMsa &&
        typeof terrainHasCoverage === 'function' && terrainHasCoverage() &&
        Number.isFinite(typeof legMsaFt === 'function' ? legMsaFt(idx) : NaN)) {
      msaRow = textRow(S.fpMsa || 'MSA (ft)', '');
      msaRow.title = S.msaLowTitle || 'Planned altitude is below the minimum safe altitude';
      body.appendChild(msaRow);
      refreshMsa();
    }
    // Per-leg wind override rows + live readout — appended AFTER the altitude
    // rows so the long-standing number-input order (speed, in-alt, out-alt)
    // that other specs index by stays put.
    const setLegWind = (field, v) => {
      const cur = Object.assign({}, leg.wind);
      if (Number.isFinite(v)) {
        cur[field] = field === 'dir'
          ? ((Math.round(v) % 360) + 360) % 360
          : Math.max(0, Math.round(v));
      } else {
        delete cur[field];
      }
      if (Number.isFinite(cur.dir) || Number.isFinite(cur.speed)) leg.wind = cur;
      else delete leg.wind;
      refreshWindFx(); draw();
    };
    if (window.showWind) {
      const gw = state.wind || { dir: 270, speed: 0 };
      body.appendChild(numberRow(S.windFromDeg,
        leg.wind && Number.isFinite(leg.wind.dir) ? leg.wind.dir : NaN,
        v => setLegWind('dir', v),
        { allowUnknown: true, placeholder: String(gw.dir), live: true,
          normalize: v => ((Math.round(v) % 360) + 360) % 360, wrapStep: 5,
          undoValue: NaN, undoTitle: S.windResetTitle }));
      body.appendChild(numberRow(S.windSpeedKt,
        leg.wind && Number.isFinite(leg.wind.speed) ? leg.wind.speed : NaN,
        v => setLegWind('speed', v),
        { allowUnknown: true, placeholder: String(gw.speed), live: true,
          normalize: v => Math.max(0, Math.round(v)),
          undoValue: NaN, undoTitle: S.windResetTitle }));
      windFxRow = textRow(S.windEffect, '');
      windFxRow.classList.add('wind-fx-row');
      body.appendChild(windFxRow);
      refreshWindFx();
    }
    const reset = document.createElement('button');
    reset.className = 'insp-btn';
    // Fallback to a glyph if the locale strings haven't been loaded yet —
    // Hebrew users used to see literal "undefined" on this button until
    // resetLegMarkers landed in he/strings.js (PR review #4).
    reset.textContent = S.resetLegMarkers || '↺';
    reset.onclick = () => {
      const d = _defaultLegLabels();
      leg.inLabel = d.inLabel;
      leg.outLabel = d.outLabel;
      leg.cumLabel = d.cumLabel;
      leg.cumLabelRet = d.cumLabelRet;
      draw();
    };
    body.appendChild(reset);
  } else if (state.selected.type === 'note') {
    const note = state.notes[state.selected.index];
    if (note.cc) {
      title.value = S.commChangeBadge || 'Freq change';
      title.placeholder = '';
      title.readOnly = true;
      title.oninput = null;
      const target = typeof commCalloutTarget === 'function'
        ? commCalloutTarget(note) : null;
      const wpName = (target && target.name) || note.cc || '';
      body.appendChild(textRow(S.commChangeCallSign || 'Waypoint',
        typeof navName === 'function' ? navName(wpName) : wpName));
      appendFreqEdit(body, note);
    } else {
      title.value = '';
      title.placeholder = '';
      title.readOnly = true;
      title.oninput = null;
      body.appendChild(textareaRow('', note.text || '', v => {
        note.text = v; draw();
      }));
      body.appendChild(selectRow(S.shape, note.shape || 'rect',
        [['rect', S.shapeRect], ['oval', S.shapeOval]], v => {
          note.shape = v; draw();
        }));
      body.appendChild(colorRow(S.color, note.color || NOTE_DEFAULT_COLOR, v => {
        note.color = v; draw();
      }));
    }
    const del = document.createElement('button');
    del.className = 'insp-btn';
    del.textContent = note.cc ? (S.deleteFreqChange || S.deleteNote) : S.deleteNote;
    del.onclick = () => {
      if (note.cc && typeof suppressCommChange === 'function') suppressCommChange(note.cc);
      state.notes.splice(state.selected.index, 1);
      state.selected = null;
      draw(); showInspector();
    };
    body.appendChild(del);
  } else if (state.selected.type === 'vor') {
    const v = vors && vors[state.selected.index];
    if (!v) {
      state.selected = null;
      insp.classList.add('hidden');
      clearStoredInspectorSelection();
      return;
    }
    title.value = referenceInspectorTitle(v, 'vor');
    title.placeholder = ''; title.readOnly = true; title.oninput = null;
    appendPointCoordinateRows(body, v);
    {
      const vdef = typeof freqClean === 'function' ? freqClean(v.freq) : String(v.freq || '');
      body.appendChild(freqEditRow(S.vorFreq || 'Frequency', {
        value: typeof vorEffectiveFreq === 'function' ? vorEffectiveFreq(v) : vdef,
        def: vdef, rowClass: 'vor-freq-row',
        isOverride: () => !!(typeof vorFreqOverrides === 'function' && vorFreqOverrides()[v.ident]),
        commit: n => { if (typeof setVorFreqOverride === 'function') setVorFreqOverride(v.ident, n === vdef ? '' : n); return n; },
        onReset: () => { if (typeof setVorFreqOverride === 'function') setVorFreqOverride(v.ident, ''); return vdef; },
      }));
    }
    appendSatelliteSnippet(body, v, title.value);
    const useBtn = document.createElement('button');
    useBtn.className = 'insp-btn';
    const isRef = vorRef === v.ident;
    useBtn.textContent = isRef ? (S.vorRefActive || '✓ Reference VOR (tap to clear)')
                               : (S.vorUseRef || 'Use as reference VOR');
    useBtn.onclick = () => {
      window.vorRef = isRef ? null : v.ident;
      try {
        if (vorRef) localStorage.setItem('navaid.vorRef', vorRef);
        else localStorage.removeItem('navaid.vorRef');
      } catch (e) { /* */ }
      const vs = document.getElementById('vor-ref-select');
      if (vs) vs.value = vorRef || '';
      if (typeof refreshFlightPlan === 'function' && refreshFlightPlan) refreshFlightPlan();
      draw(); showInspector();
    };
    body.appendChild(useBtn);
  } else if (state.selected.type === 'airfield') {
    const af = airfields && airfields[state.selected.index];
    if (!af) {
      state.selected = null;
      insp.classList.add('hidden');
      clearStoredInspectorSelection();
      return;
    }
    title.value = airfieldInspectorTitle(af);
    title.placeholder = ''; title.readOnly = true; title.oninput = null;
    appendPointCoordinateRows(body, af);
    appendAirfieldDetailRows(body, af, title.value);
  } else if (state.selected.type === 'navwp') {
    const nw = navWP && navWP[state.selected.index];
    if (!nw) {
      state.selected = null;
      insp.classList.add('hidden');
      clearStoredInspectorSelection();
      return;
    }
    // Title in the current UI language: "CODE / localized name" (matches the
    // airfield and route-waypoint inspectors) so expanded satellite views keep
    // the same identity whether the point is on-route or standalone.
    title.value = referenceInspectorTitle(nw, 'navwp');
    title.placeholder = ''; title.readOnly = true; title.oninput = null;
    appendPointCoordinateRows(body, nw);
    appendSatelliteSnippet(body, nw, title.value);
    appendVorRadialRow(body, nw.lat, nw.lng);
  } else {
    const wp = state.waypoints[state.selected.index];
    normalizeWaypointSequenceName(wp);
    const afInsp = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wp) : null;
    const ref = typeof findSnappedReference === 'function' ? findSnappedReference(wp) : null;
    let canonical = ref ? ref.name : null;
    let refKind = ref ? ref.kind : '';
    let refLocale = ref ? referenceLocaleName(ref, refKind) : '';
    const storedName = (wp.name || '').trim();
    if (!canonical && storedName && navWP) {
      for (const nw of navWP) {
        if (nw.name === storedName || nw.en === storedName || nw.he === storedName) {
          canonical = nw.name;
          refKind = 'navwp';
          refLocale = referenceLocaleName(nw, refKind);
          break;
        }
      }
    }
    title.value = afInsp ? airfieldInspectorTitle(afInsp)
      : (canonical
          ? codeTitle(canonical, refLocale)
          : waypointDisplayLabel(wp, state.selected.index));
    title.placeholder = '';
    title.readOnly = true;
    title.oninput = null;
    let labelValue = storedName ? navName(storedName) : '';
    const defaultWpName = S.wpPrefix + (state.selected.index + 1);
    const preferDefaultWpName = !storedName && wp._defaultWpName;
    if (!preferDefaultWpName && refLocale && (!storedName || storedName === canonical)) labelValue = refLocale;
    const nameValue = labelValue || storedName || defaultWpName;
    body.appendChild(inputRow(S.navHebrew || 'Waypoint name', nameValue, v => {
      wp.name = isSequenceWaypointName((v || '').trim()) ? '' : v;
      draw();
    }));
    appendPointCoordinateRows(body, wp);
    if (afInsp) {
      appendAirfieldDetailRows(body, afInsp, title.value);
    } else {
      appendSatelliteSnippet(body, wp, title.value);
      appendVorRadialRow(body, wp.lat, wp.lng);
    }
    // Reporting-type badge (issue #404). The chart's סוג דיווח class lives
    // inline on the nav-WP (`report`). Surfaces mandatory (חובה) vs on-request
    // (דרישה) for a route waypoint that matches a known reporting point.
    if (typeof reportingFor === 'function') {
      const rep = reportingFor(wp.name);
      if (rep === 'mandatory' || rep === 'onRequest') {
        const row = textRow(S.report || 'Reporting',
          rep === 'mandatory' ? (S.reportingMandatory || '📍 Mandatory report')
                              : (S.reportingOnRequest || '📍 Report on request'));
        row.classList.add('reporting-badge-row');
        body.appendChild(row);
      }
    }
    // Comm-change badge (issue #399). Surfaces the sector / CTR / TMA
    // frequency change associated with a known comm-change reporting
    // point. Looked up by the canonical ICAO name so it works for both
    // auto-snapped nav-WP waypoints and routes built via the search
    // overlay, regardless of locale (the badge text itself is i18n'd).
    if (commChangeMap && wp.name) {
      // Resolve to the canonical ICAO key first: in Hebrew locale snapped
      // waypoints store the he label as wp.name, and commChangeMap is keyed
      // by canonical English — a raw lookup would miss the badge in Hebrew
      // even though the on-map callout (which canonicalises) shows.
      const ccKey = typeof canonicalNavWaypointName === 'function'
        ? canonicalNavWaypointName(wp.name) : wp.name.trim();
      const cc = commChangeMap[ccKey];
      if (cc && cc.commChange) {
        const row = document.createElement('div');
        row.className = 'row col commchange-row';
        const lbl = document.createElement('label');
        lbl.className = 'commchange-label';
        lbl.textContent = S.commChangeBadge || '📡 Freq change';
        row.appendChild(lbl);
        body.appendChild(row);
        // #530 — united inspector: if a freq callout note exists for this
        // point, edit it right here (call sign + frequency + reset location)
        // instead of a read-only badge. Falls back to the read-only from/to
        // summary when no callout note is present (e.g. overlay off).
        const linkedNote = state.notes.find(n => n && n.cc &&
          (typeof canonicalNavWaypointName === 'function'
            ? canonicalNavWaypointName(n.cc) === ccKey
            : n.cc === ccKey));
        if (showCommChange && linkedNote && typeof appendFreqEdit === 'function') {
          appendFreqEdit(body, linkedNote, { deleteButton: true });
        } else {
          if (cc.from || cc.to) {
            const freq = document.createElement('span');
            freq.className = 'val commchange-freq';
            const arrow = (S.legArrow || '→');
            freq.textContent = (cc.from || '?') + ' ' + arrow + ' ' + (cc.to || '?');
            row.appendChild(freq);
          }
          if (cc.note) {
            const note = document.createElement('span');
            note.className = 'val commchange-note';
            note.textContent = cc.note;
            row.appendChild(note);
          }
          if (showCommChange) {
            const add = document.createElement('button');
            add.className = 'insp-btn';
            add.textContent = S.addFreqChange || 'Add freq change';
            add.onclick = () => {
              const idx = addCommChangeNoteForWaypoint(wp, ccKey);
              if (idx >= 0 && state.selected && state.selected.type === 'wp') {
                state.selected.freqNoteIndex = idx;
              }
              draw(); showInspector();
            };
            body.appendChild(add);
          }
        }
      }
    }
    const del = document.createElement('button');
    del.className = 'insp-btn';
    del.textContent = S.deleteWp;
    del.onclick = () => {
      deleteWaypoint(state.selected.index);
      state.selected = null;
      draw(); showInspector();
    };
    body.appendChild(del);
    // Issue #418: ↺ Reset waypoint name — snaps the stored name back to
    // the nearest reference code, or clears it when off-grid (placeholder).
    const resetName = document.createElement('button');
    resetName.className = 'insp-btn';
    resetName.textContent = S.resetWpName || '↺ Reset waypoint name';
    if (S.resetWpNameTitle) resetName.title = S.resetWpNameTitle;
    resetName.onclick = () => resetWpName(state.selected.index);
    body.appendChild(resetName);
  }
  persistInspectorSelection();
}
function colorRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = value || NOTE_DEFAULT_COLOR;
  inp.oninput = () => onChange(inp.value);
  row.append(l, inp);
  return row;
}
function selectRow(label, value, options, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const sel = document.createElement('select');
  for (const [val, text] of options) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = text;
    if (val === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => onChange(sel.value);
  row.append(l, sel);
  return row;
}
function textareaRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row col';
  if (label) {
    const l = document.createElement('label');
    l.textContent = label;
    row.appendChild(l);
  }
  const ta = document.createElement('textarea');
  ta.value = value || '';
  ta.rows = 3;
  ta.oninput = () => onChange(ta.value);
  row.appendChild(ta);
  return row;
}
// Make a number input's spinner / arrow-keys / wheel cycle endlessly through
// 0–359 (a compass dial): stepping up past 359 wraps to 0 and down past 0
// wraps to 359. Typing is left alone — a single-step move out of range is the
// spinner signature, so we only wrap then (and normalize-on-blur catches the
// rest). Removes min/max so the native spinner isn't clamped at the edges.
function wrapDirectionInput(inp) {
  inp.removeAttribute('min');
  inp.removeAttribute('max');
  const norm = v => ((v % 360) + 360) % 360;
  inp.addEventListener('input', e => {
    // `inputType` is set for typing / pasting and empty for spinner / arrow /
    // wheel steps. Only wrap a spinner step — typing is left for blur-normalize
    // so partial input (a lone "-", "36") is never yanked mid-keystroke.
    if (e.inputType) return;
    const v = parseInt(inp.value, 10);
    if (Number.isFinite(v) && (v < 0 || v > 359)) inp.value = String(norm(v));
  });
}
function numberRow(label, value, onChange, opts = {}) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = altitudeInputValue(value);
  if (opts.placeholder) inp.placeholder = opts.placeholder;
  // Endless 0–359 spinner wrap (attached first so it cleans the value before
  // the commit handler below reads it).
  if (opts.wrapStep) wrapDirectionInput(inp);
  // Dim resettable fields while they still hold the default value (#722
  // follow-up): charted leg altitudes and inherited wind values read muted so
  // values the user typed stand out. Recomputed on every keystroke and reset.
  const hasDefaultStyle = opts.mutedWhenDefault || opts.undoValue !== undefined;
  const defaultValue = opts.defaultValue !== undefined ? opts.defaultValue : opts.undoValue;
  const updateDefaultStyle = () => {
    if (!hasDefaultStyle) return;
    const raw = inp.value.trim();
    const cur = parseFloat(inp.value);
    const atDefault = Number.isFinite(defaultValue)
      ? Number.isFinite(cur) && cur === defaultValue
      : raw === '' && defaultValue !== undefined && !Number.isFinite(defaultValue);
    inp.classList.toggle('is-default', atDefault);
  };
  // `final` (blur / Enter / spinner-change) runs opts.normalize and writes the
  // cleaned value back to the field — e.g. wrapping a wind direction of -395
  // to 325. The live `input` path stays raw so normalization never fights the
  // user mid-keystroke (typing "-39" must not jump to a wrapped value).
  const commit = (final) => {
    const raw = inp.value.trim();
    if (raw === '') {
      // Emptying a field with a default (charted leg altitude) restores that
      // default on blur/Enter rather than leaving it blank/unknown.
      if (final && opts.emptyRestoresDefault && Number.isFinite(opts.defaultValue)) {
        inp.value = altitudeInputValue(opts.defaultValue);
        updateDefaultStyle();
        onChange(opts.defaultValue);
        return;
      }
      if (opts.allowUnknown) onChange(NaN);
      return;
    }
    let v = parseFloat(inp.value);
    if (isNaN(v)) return;
    if (final && typeof opts.normalize === 'function') {
      v = opts.normalize(v);
      inp.value = altitudeInputValue(v);
    }
    updateDefaultStyle();
    onChange(v);
  };
  inp.onchange = () => commit(true);
  // `live` also commits on every `input` — keystrokes and the number spinner.
  // On macOS the spinner / typing only fire `change` on blur, so without this
  // the leg altitude (and the MSA flag) wouldn't update until the field was
  // left or the inspector reopened.
  if (opts.live) inp.oninput = () => commit(false);
  inp.addEventListener('input', updateDefaultStyle);
  updateDefaultStyle();
  row.append(l, inp);
  // Optional reset button — restores the charted altitude from the dataset.
  // Omitted when undoValue is undefined (no known/charted value to revert to).
  if (opts.undoValue !== undefined) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-reset';
    btn.textContent = '↻';
    btn.title = opts.undoTitle || S.altResetKnown || 'Reset to charted altitude';
    btn.setAttribute('aria-label', btn.title);
    btn.onclick = () => {
      inp.value = altitudeInputValue(opts.undoValue);
      updateDefaultStyle();                       // restored value → re-dim if it's the default
      onChange(opts.undoValue);
    };
    row.appendChild(btn);
  }
  return row;
}
function inputRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value || '';
  inp.oninput = () => onChange(inp.value);
  row.append(l, inp);
  return row;
}
function textRow(label, value) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'val';
  v.dir = 'auto';
  v.textContent = value;
  row.append(l, v);
  return row;
}

// Freq-change editor rows for a comm-change callout note: call-sign select
// (or read-only name), frequency input, and a reset-location button. Shared
// by the note inspector and the waypoint inspector (#530 — united) so a
// freq-change point is edited from one panel either way.
function appendFreqEdit(body, note, editOptions) {
  if (!note.freqName) {
    note.freqName = (typeof commCalloutDefaults === 'function'
      ? commCalloutDefaults(note.cc).freqName : commNoteName(note));
  }
  if (!note.freq) note.freq = commNoteFreq(note);
  const opts = typeof commCallSignOptions === 'function'
    ? commCallSignOptions(note.cc) : [];
  let freqInput = null;
  let resetFreq = null;
  let templateRow = null;
  let lastValidFreq = '';
  function normalizeFreqValue(raw) {
    if (typeof commNormalizeFreqInput === 'function') return commNormalizeFreqInput(raw);
    const s = String(raw || '').trim();
    return typeof commFormatFreq === 'function' ? commFormatFreq(s) : s;
  }
  function setFreqInputValid(ok) {
    if (!freqInput) return;
    freqInput.classList.toggle('invalid', !ok);
    freqInput.setAttribute('aria-invalid', ok ? 'false' : 'true');
  }
  function freqInputInvalid() {
    return !!(freqInput && freqInput.classList.contains('invalid'));
  }
  function applyFreqValue(value) {
    const opt = typeof commNoteCallSignOption === 'function'
      ? commNoteCallSignOption(note) : null;
    if (opt && typeof commApplyCallSignFreqOverride === 'function') {
      return commApplyCallSignFreqOverride(opt.id, value) || value;
    }
    return value;
  }
  function updateTemplateHint() {
    if (!templateRow) return;
    const opt = typeof commNoteCallSignOption === 'function'
      ? commNoteCallSignOption(note) : null;
    const template = opt && opt.templateFreq ? opt.templateFreq : '';
    const normalized = normalizeFreqValue(freqInput ? freqInput.value : note.freq);
    const cur = normalized === null ? (note.freq || '') : (normalized || note.freq || '');
    const changed = !!(template && (freqInputInvalid() || (cur && cur !== template)));
    if (freqInput) freqInput.classList.toggle('is-default',
      !!template && !freqInputInvalid() && cur === template);
    templateRow.style.display = changed ? '' : 'none';
    const val = templateRow.querySelector('.val');
    if (val) val.textContent = template;
    if (resetFreq) {
      resetFreq.hidden = !template;
      resetFreq.disabled = !changed;
    }
  }
  if (opts.length) {
    const current = (note.freqName || '').trim();
    let selected = opts.find(o => typeof commCallSignOptionMatches === 'function'
      ? commCallSignOptionMatches(o, current)
      : o.label === current);
    const rows = opts.map(o => [o.id, o.label]);
    if (!selected && current) {
      selected = { id: '__custom__', label: current };
      rows.unshift(['__custom__', current]);
    }
    const callSignRow = selectRow(S.commChangeName || 'Call sign',
      selected ? selected.id : opts[0].id, rows, v => {
        const opt = opts.find(o => o.id === v);
        if (!opt) return;
        note.freqName = opt.id;
        const normalized = normalizeFreqValue(opt.freq);
        note.freq = normalized === null
          ? (typeof commFormatFreq === 'function' ? commFormatFreq(opt.freq) : opt.freq || '')
          : normalized;
        note.freqAuto = false;
        lastValidFreq = note.freq;
        if (freqInput) {
          freqInput.value = note.freq;
          setFreqInputValid(true);
        }
        updateTemplateHint();
        draw();
      });
    callSignRow.classList.add('commchange-name-row');
    body.appendChild(callSignRow);
  } else {
    body.appendChild(textRow(S.commChangeName || 'Call sign', commNoteName(note) || ''));
  }
  const freqRow = document.createElement('div');
  freqRow.className = 'row';
  const freqLbl = document.createElement('label');
  freqLbl.textContent = S.commChangeFreq || 'Frequency';
  freqRow.appendChild(freqLbl);
  const freqControl = document.createElement('div');
  freqControl.className = 'commchange-freq-controls';
  freqInput = document.createElement('input');
  freqInput.className = 'freq-input';
  if (typeof commConfigureFreqInput === 'function') {
    commConfigureFreqInput(freqInput);
  } else {
    freqInput.type = 'number';
    freqInput.inputMode = 'decimal';
    freqInput.step = '0.005';
  }
  freqInput.value = commNoteFreq(note) || '';
  lastValidFreq = freqInput.value;
  setFreqInputValid(true);
  function commitFreqInput(formatInput) {
    const normalized = normalizeFreqValue(freqInput.value);
    const valid = normalized !== null;
    setFreqInputValid(valid);
    if (!valid) {
      updateTemplateHint();
      return false;
    }
    if (normalized === '' && !formatInput) {
      updateTemplateHint();
      return true;
    }
    const next = applyFreqValue(normalized);
    note.freq = next;
    if (next) lastValidFreq = next;
    if (formatInput) freqInput.value = next || lastValidFreq;
    note.freqAuto = false;
    updateTemplateHint();
    draw();
    return true;
  }
  freqInput.oninput = () => commitFreqInput(false);
  freqInput.onblur = () => {
    if (!commitFreqInput(true)) {
      freqInput.value = lastValidFreq;
      note.freq = lastValidFreq;
      setFreqInputValid(true);
      updateTemplateHint();
      draw();
    }
  };
  freqControl.appendChild(freqInput);
  const unit = document.createElement('span');
  unit.className = 'freq-unit';
  unit.textContent = 'MHz';
  freqControl.appendChild(unit);
  resetFreq = document.createElement('button');
  resetFreq.type = 'button';
  resetFreq.className = 'commchange-freq-reset';
  resetFreq.textContent = '↻';
  resetFreq.title = S.resetFreqOverride || S.sliderReset || 'Reset to default';
  resetFreq.setAttribute('aria-label', resetFreq.title);
  function resetFreqToTemplate() {
    const opt = typeof commNoteCallSignOption === 'function'
      ? commNoteCallSignOption(note) : null;
    const template = opt && opt.templateFreq ? opt.templateFreq : '';
    if (!opt || !template) return;
    const next = applyFreqValue(template);
    note.freq = next;
    note.freqAuto = false;
    lastValidFreq = next;
    freqInput.value = next;
    setFreqInputValid(true);
    updateTemplateHint();
    draw();
  }
  // pointerdown handles pointer activation (so a swallowing drag handler can't
  // eat the click); click handles keyboard (Enter/Space). Suppress the click
  // that trails a pointerdown so the reset doesn't fire twice per tap.
  let resetFreqPointerHandled = false;
  resetFreq.onpointerdown = e => {
    if (resetFreq.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    resetFreqPointerHandled = true;
    resetFreqToTemplate();
  };
  resetFreq.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    if (resetFreqPointerHandled) { resetFreqPointerHandled = false; return; }
    if (!resetFreq.disabled) resetFreqToTemplate();
  };
  freqControl.appendChild(resetFreq);
  freqRow.classList.add('commchange-freq-edit');
  freqRow.appendChild(freqControl);
  body.appendChild(freqRow);
  templateRow = textRow(S.commChangeTemplateFreq || 'Default', '');
  templateRow.classList.add('commchange-template');
  body.appendChild(templateRow);
  updateTemplateHint();
  // Reset the callout to its default tail position beside the waypoint.
  const target = typeof commCalloutTarget === 'function' ? commCalloutTarget(note) : null;
  if (target && typeof commCalloutDefaultTail === 'function') {
    const reset = document.createElement('button');
    reset.className = 'insp-btn';
    reset.textContent = S.resetFreqLocation || S.resetLegMarkers || '↺';
    reset.onclick = () => {
      const tail = commCalloutDefaultTail(target);
      note.lat = tail.lat;
      note.lng = tail.lng;
      draw();
    };
    body.appendChild(reset);
  }
  if (editOptions && editOptions.deleteButton) {
    const del = document.createElement('button');
    del.className = 'insp-btn';
    del.textContent = S.deleteFreqChange || S.deleteNote;
    del.onclick = () => {
      if (note.cc && typeof suppressCommChange === 'function') suppressCommChange(note.cc);
      const idx = state.notes.indexOf(note);
      if (idx >= 0) state.notes.splice(idx, 1);
      if (state.selected && state.selected.type === 'wp') {
        delete state.selected.freqNoteIndex;
      }
      draw(); showInspector();
    };
    body.appendChild(del);
  }
}

// --- interaction (Leaflet mouse events) ------------------------------
let drag = null;
let downHit = false;
const ORIGIN_RESNAP_ARM_PX = 18;

function dragOriginExclude(d, latlng) {
  if (!d || d.originSnapArmed) return null;
  if (!Number.isFinite(d.origLat) || !Number.isFinite(d.origLng)) return null;
  const origin = map.latLngToContainerPoint([d.origLat, d.origLng]);
  const cur = map.latLngToContainerPoint([latlng.lat, latlng.lng]);
  if (Math.hypot(cur.x - origin.x, cur.y - origin.y) > ORIGIN_RESNAP_ARM_PX) {
    d.originSnapArmed = true;
    return null;
  }
  return { lat: d.origLat, lng: d.origLng };
}

map.on('mousedown', e => {
  const p = e.containerPoint;
  // Hit-test priority matches paint order so the topmost element wins:
  // notes are drawn above waypoints (draw.js), so test notes first (issue #71).
  const includeOverlayChoices = state.mode !== 'add' && state.mode !== 'note';
  const commHits = hitCommCalloutCandidates(p.x, p.y);
  const wpHits = hitWaypointCandidates(p.x, p.y);
  const ovHits = includeOverlayChoices ? hitOverlayMarkerCandidates(p.x, p.y) : [];
  const commChoiceHits = commHits.concat(wpHits, ovHits);
  if (commHits.length && commChoiceHits.length > 1) {
    downHit = true;
    showPointChoice(commChoiceHits);
    return;
  }
  const note = hitNote(p.x, p.y);
  if (note >= 0) {
    downHit = true;
    state.selected = selectionForNoteHit(note);
    drag = {
      kind: 'note',
      i: note,
      offLat: state.notes[note].lat - e.latlng.lat,
      offLng: state.notes[note].lng - e.latlng.lng,
    };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  if (wpHits.length > 1) {
    downHit = true;
    showPointChoice(wpHits);
    return;
  }
  const wp = wpHits.length ? wpHits[0].index : -1;
  if (wp >= 0) {
    downHit = true;
    state.selected = { type: 'wp', index: wp };
    drag = { kind: 'wp', i: wp, moved: false,
             origLat: state.waypoints[wp].lat, origLng: state.waypoints[wp].lng,
             originSnapArmed: false };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  const cum = hitCumLabel(p.x, p.y);
  if (cum) {
    downHit = true;
    _materialiseDefaultCumLabel(cum.i);
    drag = { kind: 'cumlabel', i: cum.i };
    state.selected = { type: 'leg', index: cum.i };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  const cumRet = hitCumLabelRet(p.x, p.y);
  if (cumRet) {
    downHit = true;
    _materialiseDefaultCumLabelRet(cumRet.i);
    drag = { kind: 'cumlabelret', i: cumRet.i };
    state.selected = { type: 'leg', index: cumRet.i };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  const lab = hitLegLabel(p.x, p.y);
  if (lab) {
    downHit = true;
    _materialiseDefaultLegLabel(lab.i, lab.which);
    drag = { kind: 'label', i: lab.i, which: lab.which,
             ...legLabelDragGrab(lab.i, lab.which, p.x, p.y) };
    state.selected = { type: 'leg', index: lab.i };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  const leg = hitLeg(p.x, p.y);
  if (leg >= 0) {
    downHit = true;
    state.selected = { type: 'leg', index: leg };
    drag = { kind: 'legclick' };
    map.dragging.disable();
    showInspector(); draw();
    return;
  }
  // Outside edit mode, a click on a VOR / airfield / nav-WP marker opens its
  // read-only inspector. Not draggable, so leave map panning enabled.
  if (includeOverlayChoices) {
    if (ovHits.length > 1) {
      downHit = true;
      showPointChoice(ovHits);
      return;
    }
    if (ovHits.length) {
      downHit = true;
      state.selected = ovHits[0];
      showInspector(); draw();
      return;
    }
  }
  if (pageSize && hitPageFrameEdge(p.x, p.y)) {
    downHit = true;
    drag = { kind: 'page', lx: p.x, ly: p.y };
    map.dragging.disable();
    return;
  }
  downHit = false;                     // empty space -> Leaflet pans
});

map.on('mousemove', e => {
  if (!drag) return;
  const p = e.containerPoint;
  if (drag.kind === 'wp') {
    drag.moved = true;
    const wp = state.waypoints[drag.i];
    const r = applyNavSnap(e.latlng, wp.name || '', dragOriginExclude(drag, e.latlng));
    wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
    draw(); showInspector();
  } else if (drag.kind === 'note') {
    state.notes[drag.i].lat = r5(e.latlng.lat + (drag.offLat || 0));
    state.notes[drag.i].lng = r5(e.latlng.lng + (drag.offLng || 0));
    draw();
  } else if (drag.kind === 'label') {
    if (setLegLabelFromPoint(drag, p.x, p.y)) draw();
  } else if (drag.kind === 'cumlabel' || drag.kind === 'cumlabelret') {
    setCumLabelFromPoint(drag.i, drag.kind === 'cumlabelret', p.x, p.y);
    draw();
  } else if (drag.kind === 'page') {
    pageOffset.x += p.x - drag.lx;
    pageOffset.y += p.y - drag.ly;
    drag.lx = p.x; drag.ly = p.y;
    clampPageOffset();
    draw();
  }
});

// Re-enable map dragging on release anywhere, not just inside the map.
// Listening to map.on('mouseup') alone misses releases over the toolbar /
// browser chrome and leaves the map permanently unpannable (issue #70).
function endMouseDrag() {
  if (drag) {
    if (drag.kind === 'wp' && drag.moved) {
      const wp = state.waypoints[drag.i];
      const snappedToSelf = sameMapPoint(wp, { lat: drag.origLat, lng: drag.origLng });
      const snappedToOther = routeOccupiesPoint(wp, drag.i);
      if ((snappedToSelf && !drag.originSnapArmed) || snappedToOther) {
        state.waypoints.splice(drag.i, 1);
        state.selected = null;
        syncLegs();
        showInspector(); draw();
        map.dragging.enable();
        drag = null;
        return;
      }
    }
    // #487: a waypoint drag may have landed (snapped) on a comm-change point.
    // Seed its note now that the position is committed, then repaint.
    let changed = false;
    if (drag.kind === 'wp' && drag.moved) {
      changed = applyLegAltitudesToRoute();
      if (typeof seedCommChangeNotes === 'function' && seedCommChangeNotes()) changed = true;
    }
    if (changed) { draw(); showInspector(); }
    map.dragging.enable();
    drag = null;
  }
}
window.addEventListener('mouseup', endMouseDrag);
window.addEventListener('pointerup', endMouseDrag);
window.addEventListener('pointercancel', endMouseDrag);

map.on('click', e => {
  if (downHit) { downHit = false; return; }
  if (state.mode === 'add') {
    const r = applyNavSnap(e.latlng, '');
    // #104: ignore the click if a waypoint already sits at the snap target.
    // Without this an add-mode click on a nav-WP / airfield that already has
    // a route waypoint produces a duplicate at the same coords and a leg
    // with zero distance.
    if (routeOccupiesPoint(r)) {
      return;
    }
    state.waypoints.push({ lat: r5(r.lat), lng: r5(r.lng), name: r.name });
    syncLegs();
    if (typeof seedCommChangeNotes === 'function') seedCommChangeNotes();  // #487
    state.selected = { type: 'wp', index: state.waypoints.length - 1 };
    showInspector(); draw();
  } else if (state.mode === 'note') {
    state.notes.push({ lat: r5(e.latlng.lat), lng: r5(e.latlng.lng),
                       text: S.noteDefault, color: NOTE_DEFAULT_COLOR,
                       shape: 'rect' });
    state.selected = { type: 'note', index: state.notes.length - 1 };
    showInspector(); draw();
  } else if (state.selected) {
    state.selected = null;               // empty-map click closes the inspector
    showInspector(); draw();
  }
});

window.addEventListener('keydown', e => {
  const t = e.target;
  if (e.key === 'Escape') {
    const modal = document.querySelector('.modal-back');
    if (modal) { modal.remove(); return; }
    if (magnifierOn) { toggleMagnifier(); return; }
    if (state.selected) {
      state.selected = null;
      showInspector(); draw();
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) t.blur();
      return;
    }
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }
    if (state.mode === 'add' || state.mode === 'note') {
      e.preventDefault();
      if (typeof setMode === 'function') setMode(null);
      draw();
    }
    return;
  }
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;                              // typing in a field — leave the WP alone
  }
  // Ctrl/Cmd-Z undoes the last committed edit. Shift-Ctrl-Z (redo) is left
  // alone — there is no redo, so don't swallow it.
  if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) &&
      !e.altKey && !e.shiftKey) {
    e.preventDefault();
    if (typeof undo === 'function') undo();
    return;
  }
  // Issue #420: '?' (Shift-/) opens the keyboard-shortcuts cheat-sheet.
  // Suppressed in inputs (handled by the early return above) so typing a
  // literal '?' in a waypoint name or note still works. Most browsers
  // surface this key as `e.key === '?'`, but some keyboard layouts /
  // automation harnesses fire `e.key === '/'` with `shiftKey: true`, so
  // accept both.
  if (!e.ctrlKey && !e.metaKey && !e.altKey &&
      (e.key === '?' || (e.key === '/' && e.shiftKey))) {
    e.preventDefault();
    if (typeof showShortcutsHelp === 'function') showShortcutsHelp();
    return;
  }
  // Issue #413: F (no modifier) re-runs fit-to-route. Ctrl/Cmd-F is the
  // search-overlay shortcut handled in ui.js — bail out so we don't shadow it.
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    fitView();
    return;
  }
  // Map zoom (+ / − / numpad) and magnifier (M) — skip under any modal
  // backdrop so we don't change the map behind dialogs.
  if (!document.querySelector('.modal-back')) {
    const zoomInKeys = !e.ctrlKey && !e.metaKey && !e.altKey && (
      e.code === 'NumpadAdd' || e.code === 'Equal' || e.key === '+');
    const zoomOutKeys = !e.ctrlKey && !e.metaKey && !e.altKey && (
      e.code === 'NumpadSubtract' || e.code === 'Minus' || e.key === '-');
    if (zoomInKeys || zoomOutKeys) {
      e.preventDefault();
      const step = zoomInKeys ? 0.25 : -0.25;
      if (magnifierOn && typeof bumpMagnifierZoomKeyboard === 'function') {
        bumpMagnifierZoomKeyboard(step);
      } else if (zoomInKeys) {
        map.zoomIn();
      } else {
        map.zoomOut();
      }
      return;
    }
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleMagnifier();
      return;
    }
    // A / N toggle the add-waypoint / add-note placement modes (same as the
    // toolbar buttons); C clears the map. Pressing the active mode's key
    // again toggles back to inspect, mirroring setMode()'s button behaviour.
    if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (typeof setMode === 'function') setMode('add');
      return;
    }
    if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (typeof setMode === 'function') setMode('note');
      return;
    }
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const clearBtn = document.getElementById('clear');
      if (clearBtn) clearBtn.click();   // reuse the button's confirm + reset
      return;
    }
  }
  // X (no modifier): delete the freq-change callout linked to the selected waypoint.
  if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!state.selected) return;
    const freqNote = selectedFreqNoteIndex();
    if (freqNote >= 0) {
      state.notes.splice(freqNote, 1);
      delete state.selected.freqNoteIndex;
      draw(); showInspector();
    }
    return;
  }
  // Z (no modifier): add a freq-change callout to a comm-change waypoint.
  if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!state.selected || state.selected.type !== 'wp') return;
    const wp = state.waypoints[state.selected.index];
    if (!wp || !wp.name || !commChangeMap || !showCommChange) return;
    const ccKey = typeof canonicalNavWaypointName === 'function'
      ? canonicalNavWaypointName(wp.name) : wp.name.trim();
    const cc = commChangeMap[ccKey];
    if (!cc || !cc.commChange) return;
    const linkedNote = state.notes.find(n => n && n.cc &&
      (typeof canonicalNavWaypointName === 'function'
        ? canonicalNavWaypointName(n.cc) === ccKey
        : n.cc === ccKey));
    if (linkedNote) return;
    const idx = addCommChangeNoteForWaypoint(wp, ccKey);
    if (idx >= 0) state.selected.freqNoteIndex = idx;
    draw(); showInspector();
    return;
  }
  // D (no modifier): delete the selected waypoint or note (freq callout goes with its waypoint).
  if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!state.selected) return;
    deleteSelectedWpOrNote();
    return;
  }
  // Delete / Backspace: delete freq callout first, otherwise waypoint/note.
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!state.selected) return;
    const freqNote = selectedFreqNoteIndex();
    if (freqNote >= 0) {
      const note = state.notes[freqNote];
      if (note && note.cc && typeof suppressCommChange === 'function') suppressCommChange(note.cc);
      state.notes.splice(freqNote, 1);
      delete state.selected.freqNoteIndex;
      draw(); showInspector();
      return;
    }
    deleteSelectedWpOrNote();
  }
});

// --- touch interaction (drag waypoints / markers on mobile) ----------
// Synthesised mouse events don't fire during a touch-drag, so handle touch
// directly. One-finger touches that hit a route element are captured; other
// touches fall through to Leaflet for pan / pinch-zoom.
const mapEl = map.getContainer();
let touchDrag = null;

mapEl.addEventListener('dblclick', e => {
  if (state.mode === 'add' || state.mode === 'note') return;
  const rect = mapEl.getBoundingClientRect();
  const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  if (hitNote(p.x, p.y) >= 0) return;
  if (hitWaypointCandidates(p.x, p.y).length) return;
  if (hitCumLabel(p.x, p.y) || hitCumLabelRet(p.x, p.y) || hitLegLabel(p.x, p.y)) return;
  if (hitOverlayMarkerCandidates(p.x, p.y).length) return;
  const leg = hitLeg(p.x, p.y);
  if (leg < 0) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  downHit = false;
  splitLegAt(leg, map.containerPointToLatLng([p.x, p.y]));
}, true);

function touchXY(t) {
  const r = mapEl.getBoundingClientRect();
  return { x: t.clientX - r.left, y: t.clientY - r.top };
}

mapEl.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  const p = touchXY(e.touches[0]);
  // Hit-test priority matches paint order so the topmost element wins:
  // notes are drawn above waypoints (draw.js), so test notes first (issue #71).
  const includeOverlayChoices = state.mode !== 'add' && state.mode !== 'note';
  const commHits = hitCommCalloutCandidates(p.x, p.y);
  const wpHits = hitWaypointCandidates(p.x, p.y);
  const ovHits = includeOverlayChoices ? hitOverlayMarkerCandidates(p.x, p.y) : [];
  const commChoiceHits = commHits.concat(wpHits, ovHits);
  if (commHits.length && commChoiceHits.length > 1) {
    e.preventDefault();
    showPointChoice(commChoiceHits);
    return;
  }
  const note = hitNote(p.x, p.y);
  const activeWpHits = note < 0 ? wpHits : [];
  const activeOvHits = note < 0 ? ovHits : [];
  const wpAmbiguous = activeWpHits.length > 1;
  const wp = activeWpHits.length ? activeWpHits[0].index : -1;
  const cum = (!wpAmbiguous && wp < 0 && note < 0) ? hitCumLabel(p.x, p.y) : null;
  const cumRet = (!wpAmbiguous && wp < 0 && note < 0 && !cum) ? hitCumLabelRet(p.x, p.y) : null;
  const lab = (!wpAmbiguous && wp < 0 && note < 0 && !cum && !cumRet) ? hitLegLabel(p.x, p.y) : null;
  const leg = (!wpAmbiguous && wp < 0 && note < 0 && !lab && !cum && !cumRet) ? hitLeg(p.x, p.y) : -1;
  const onPage = (!wpAmbiguous && wp < 0 && note < 0 && !lab && !cum && !cumRet && leg < 0 && pageSize)
    ? hitPageFrameEdge(p.x, p.y) : false;

  if (note >= 0) {
    const ll = map.containerPointToLatLng([p.x, p.y]);
    touchDrag = {
      kind: 'note',
      i: note,
      offLat: state.notes[note].lat - ll.lat,
      offLng: state.notes[note].lng - ll.lng,
    };
    state.selected = selectionForNoteHit(note);
  } else if (wpAmbiguous) {
    e.preventDefault();
    showPointChoice(activeWpHits);
    return;
  } else if (wp >= 0) {
    touchDrag = { kind: 'wp', i: wp, moved: false,
                  origLat: state.waypoints[wp].lat, origLng: state.waypoints[wp].lng,
                  originSnapArmed: false };
    state.selected = { type: 'wp', index: wp };
  } else if (lab) {
    _materialiseDefaultLegLabel(lab.i, lab.which);
    touchDrag = { kind: 'label', i: lab.i, which: lab.which,
                  ...legLabelDragGrab(lab.i, lab.which, p.x, p.y) };
    state.selected = { type: 'leg', index: lab.i };
  } else if (cum) {
    _materialiseDefaultCumLabel(cum.i);
    touchDrag = { kind: 'cumlabel', i: cum.i };
    state.selected = { type: 'leg', index: cum.i };
  } else if (cumRet) {
    _materialiseDefaultCumLabelRet(cumRet.i);
    touchDrag = { kind: 'cumlabelret', i: cumRet.i };
    state.selected = { type: 'leg', index: cumRet.i };
  } else if (leg >= 0) {
    touchDrag = { kind: 'legtap' };
    state.selected = { type: 'leg', index: leg };
  } else if (onPage) {
    touchDrag = { kind: 'page', lx: p.x, ly: p.y };
  }

  // Outside edit mode, a tap on a VOR / airfield / nav-WP marker opens its
  // read-only inspector (no drag).
  if (!touchDrag && includeOverlayChoices) {
    if (activeOvHits.length > 1) {
      e.preventDefault();
      showPointChoice(activeOvHits);
      return;
    }
    if (activeOvHits.length) {
      state.selected = activeOvHits[0];
      e.preventDefault();
      showInspector(); draw();
      return;
    }
  }

  if (touchDrag) {
    map.dragging.disable();
    e.preventDefault();                // suppress pan + the synthetic click
    showInspector(); draw();
  }
}, { passive: false });

mapEl.addEventListener('touchmove', e => {
  if (!touchDrag || touchDrag.kind === 'legtap' || e.touches.length !== 1) return;
  e.preventDefault();
  const p = touchXY(e.touches[0]);
  const ll = map.containerPointToLatLng([p.x, p.y]);
  if (touchDrag.kind === 'wp') {
    touchDrag.moved = true;
    const wp = state.waypoints[touchDrag.i];
    const r = applyNavSnap(ll, wp.name || '', dragOriginExclude(touchDrag, ll));
    wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
    draw(); showInspector();
  } else if (touchDrag.kind === 'note') {
    state.notes[touchDrag.i].lat = r5(ll.lat + (touchDrag.offLat || 0));
    state.notes[touchDrag.i].lng = r5(ll.lng + (touchDrag.offLng || 0));
    draw();
  } else if (touchDrag.kind === 'label') {
    if (setLegLabelFromPoint(touchDrag, p.x, p.y)) draw();
  } else if (touchDrag.kind === 'cumlabel' || touchDrag.kind === 'cumlabelret') {
    setCumLabelFromPoint(touchDrag.i, touchDrag.kind === 'cumlabelret', p.x, p.y);
    draw();
  } else if (touchDrag.kind === 'page') {
    pageOffset.x += p.x - touchDrag.lx;
    pageOffset.y += p.y - touchDrag.ly;
    touchDrag.lx = p.x; touchDrag.ly = p.y;
    clampPageOffset();
    draw();
  }
}, { passive: false });

function endTouch() {
  if (touchDrag) {
    if (touchDrag.kind === 'wp' && touchDrag.moved) {
      const wp = state.waypoints[touchDrag.i];
      const snappedToSelf = sameMapPoint(wp, { lat: touchDrag.origLat, lng: touchDrag.origLng });
      const snappedToOther = routeOccupiesPoint(wp, touchDrag.i);
      if ((snappedToSelf && !touchDrag.originSnapArmed) || snappedToOther) {
        state.waypoints.splice(touchDrag.i, 1);
        state.selected = null;
        syncLegs();
        showInspector(); draw();
        map.dragging.enable();
        touchDrag = null;
        return;
      }
    }
    // #487: seed a comm-change note if a touch waypoint-drag landed on one.
    let changed = false;
    if (touchDrag.kind === 'wp' && touchDrag.moved) {
      changed = applyLegAltitudesToRoute();
      if (typeof seedCommChangeNotes === 'function' && seedCommChangeNotes()) changed = true;
    }
    if (changed) { draw(); showInspector(); }
    map.dragging.enable();
    touchDrag = null;
  }
}
mapEl.addEventListener('touchend', endTouch);
mapEl.addEventListener('touchcancel', endTouch);

let _drawPending = false;
function scheduleDraw() {
  if (_drawPending) return;
  _drawPending = true;
  requestAnimationFrame(() => { _drawPending = false; draw(); });
}
map.on('move zoom viewreset moveend zoomend', scheduleDraw);
map.on('resize', () => { resizeOverlay(); scheduleDraw(); });

// --- view fitting ----------------------------------------------------
function fitView() {
  if (state.waypoints.length === 0) {
    map.setView([32.0, 34.9], 9);
    return;
  }
  const b = L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng]));
  // Clamp maxZoom so two close waypoints don't snap to a tight, useless view.
  map.fitBounds(b, { padding: [70, 70], maxZoom: 11 });
}
