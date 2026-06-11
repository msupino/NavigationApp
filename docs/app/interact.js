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
    const primary = navName((wp.name || '').trim()) || (S.wpPrefix + (c.index + 1));
    const meta = (S.choosePointRoute || 'Route waypoint') + ' ' + (c.index + 1);
    return { primary, meta };
  }
  if (c.type === 'vor') {
    const v = vors && vors[c.index];
    return {
      primary: v ? v.ident : '',
      meta: ((S.choosePointVor || 'VOR station') + (v && v.freq ? ' / ' + v.freq : '')).trim(),
    };
  }
  if (c.type === 'airfield') {
    const af = airfields && airfields[c.index];
    const field = S.airfieldLabelField || 'en';
    const label = af && (af[field] || af.en || af.he || '');
    return {
      primary: af ? af.name : '',
      meta: (S.choosePointAirfield || 'Airfield') + (label ? ' / ' + label : ''),
    };
  }
  const nw = navWP && navWP[c.index];
  const field = S.navWpSearchField || 'en';
  const label = nw && (nw[field] || nw.en || nw.he || nw.name);
  return {
    primary: label || '',
    meta: (S.choosePointNavWaypoint || 'Navigation waypoint') +
      (nw && nw.name && nw.name !== label ? ' / ' + nw.name : ''),
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
           dx, dy, nx: -dy, ny: dx };
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
  const ll = { lat: wp.lat, lng: wp.lng };
  if (typeof nearestAirfield === 'function' &&
      Array.isArray(airfields) && airfields.length) {
    const af = nearestAirfield(ll, 18);
    if (af) return { name: af.name, he: af.he, en: af.en };
  }
  if (typeof nearestNavWaypoint === 'function' &&
      Array.isArray(navWP) && navWP.length) {
    const nw = nearestNavWaypoint(ll, 18);
    if (nw) return { name: nw.name, he: nw.he, en: nw.en };
  }
  return null;
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
    const labelFor = (wp, i) => {
      const raw = (wp.name || '').trim();
      const loc = raw ? (navName(raw) || raw).trim() : '';
      return loc || (S.wpPrefix + (i + 1));
    };
    const arrow = S.legArrow || '→';
    return labelFor(a, idx) + ' ' + arrow + ' ' + labelFor(b, idx + 1);
  } catch (e) {
    return S.legTitle(idx + 1);
  }
}

// Current UI language for inspector labels (Hebrew uses Hebrew labels, English
// uses English/code labels).
function inspLang() {
  return (window.__navLang === 'he' ||
    (document.documentElement && document.documentElement.lang === 'he')) ? 'he' : 'en';
}
function inspLocaleName(o) {
  if (!o) return '';
  return inspLang() === 'he'
    ? (o.he || o.name || o.ident || '')
    : (o.en || o.name || o.ident || '');
}

// Shared "From <VOR>  R-xxx° / yy.y NM" inspector row. The selected
// reference VOR drives radial/DME readouts independently of marker visibility.
function appendVorRadialRow(body, lat, lng) {
  if (typeof activeVor !== 'function') return;
  const v = activeVor();
  if (!v) return;
  const rd = vorRadialDme(v, lat, lng);
  if (!rd) return;
  const row = textRow(S.vorFrom(v.ident), S.vorRadialDme(rd.radial, rd.dme));
  row.classList.add('vor-radial-row');
  body.appendChild(row);
}

function airfieldAtisText(af) {
  return af && typeof af.atis === 'string' ? af.atis.trim() : '';
}

function airfieldClearanceText(af) {
  return af && typeof af.clearance === 'string' ? af.clearance.trim() : '';
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
  const row = id && typeof commCatalogCallSignRow === 'function'
    ? commCatalogCallSignRow(id) : null;
  const primary = row && typeof row.primary === 'string' ? row.primary.trim() : '';
  if (!primary) return '';
  return (typeof commFormatFreq === 'function' ? commFormatFreq(primary) : primary) + ' MHz';
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

function appendAirfieldFrequencyRows(body, af) {
  const primary = airfieldPrimaryText(af);
  if (primary) {
    const row = textRow(S.primary || 'Primary', primary);
    row.classList.add('primary-row');
    body.appendChild(row);
  } else {
    refreshAirfieldInspectorAfterCommCatalog(af);
  }
  const clearance = airfieldClearanceText(af);
  if (clearance) {
    const row = textRow(S.clearance || 'Clearance', clearance);
    row.classList.add('clearance-row');
    body.appendChild(row);
  }
  const atis = airfieldAtisText(af);
  if (atis) {
    const row = textRow(S.atis || 'ATIS', atis);
    row.classList.add('atis-row');
    body.appendChild(row);
  }
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
      snippet.appendChild(img);
    }
  }
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

function showSatellitePreviewModal(point, label) {
  if (typeof createDraggableModal !== 'function' || typeof L === 'undefined') return;
  // Destroy the Leaflet map on close — otherwise each open/close leaks the
  // map instance, its zoomend listener, the cloned tile layers, and Leaflet's
  // internal window hooks (they keep referencing the detached modal DOM).
  let lmap = null;
  const modal = createDraggableModal(S.satelliteSnippetTitle || 'Satellite view',
    'modal satellite-preview-modal',
    () => { if (lmap) { lmap.remove(); lmap = null; } });
  const body = document.createElement('div');
  body.className = 'satellite-preview-body';
  const mapEl = document.createElement('div');
  mapEl.className = 'satellite-preview-map';
  body.appendChild(mapEl);
  const caption = document.createElement('div');
  caption.className = 'satellite-caption';
  const name = label ? label + ' - ' : '';
  caption.textContent = name +
    fmtLatLng(point.lat, 'N', 'S') + ' ' + fmtLatLng(point.lng, 'E', 'W');
  body.appendChild(caption);
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
  });
  // Black-on-white zoom buttons, bottom-right — identical to the main map.
  L.control.zoom({ position: 'bottomright' }).addTo(lmap);
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

function airfieldInspectorTitle(af) {
  const locale = inspLocaleName(af);
  return af.name + (locale && locale !== af.name ? ' / ' + locale : '');
}

function appendAirfieldDetailRows(body, af, label) {
  if (Number.isFinite(af.elev_ft)) {
    body.appendChild(textRow(S.elevation || 'Elevation', af.elev_ft + ' ft'));
  }
  appendAirfieldFrequencyRows(body, af);
  appendSatelliteSnippet(body, af, label || airfieldInspectorTitle(af));
  appendVorRadialRow(body, af.lat, af.lng);
  appendAirfieldRunways(body, af);
  appendAirfieldPlates(body, af);
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
    // Reset-to-known: the charted altitude from leg-altitude.json. Undefined
    // (no entry / unknown direction) means the reset button is omitted — there
    // is nothing authoritative to revert to.
    const known = (typeof legAltitudeForLeg === 'function') ? legAltitudeForLeg(idx) : null;
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
         undoValue: knownIn, live: true }));
    body.appendChild(numberRow(S.outboundAlt, leg.outboundAltitude, v => {
      const oldVal = leg.outboundAltitude;
      leg.outboundAltitude = Number.isFinite(v) ? Math.round(v) : NaN;
      propagateAlt(idx, 'outboundAltitude', leg.outboundAltitude, oldVal);
      draw(); refreshMsa();
    }, { allowUnknown: true, placeholder: legAltitudePlaceholder(leg, 'outboundAltitude'),
         undoValue: knownOut, live: true }));
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
    const gw = state.wind || { dir: 270, speed: 0 };
    body.appendChild(numberRow(S.windFromDeg,
      leg.wind && Number.isFinite(leg.wind.dir) ? leg.wind.dir : NaN,
      v => setLegWind('dir', v),
      { allowUnknown: true, placeholder: String(gw.dir), live: true }));
    body.appendChild(numberRow(S.windSpeedKt,
      leg.wind && Number.isFinite(leg.wind.speed) ? leg.wind.speed : NaN,
      v => setLegWind('speed', v),
      { allowUnknown: true, placeholder: String(gw.speed), live: true }));
    windFxRow = textRow(S.windEffect, '');
    body.appendChild(windFxRow);
    refreshWindFx();
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
    title.value = v.ident;
    title.placeholder = ''; title.readOnly = true; title.oninput = null;
    body.appendChild(textRow(S.vorName || 'Name', inspLocaleName(v)));
    body.appendChild(textRow(S.vorFreq || 'Frequency', v.freq + ' MHz'));
    body.appendChild(textRow(S.latitude, fmtLatLng(v.lat, 'N', 'S')));
    body.appendChild(textRow(S.longitude, fmtLatLng(v.lng, 'E', 'W')));
    appendSatelliteSnippet(body, v, v.ident);
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
    body.appendChild(textRow(S.latitude, fmtLatLng(af.lat, 'N', 'S')));
    body.appendChild(textRow(S.longitude, fmtLatLng(af.lng, 'E', 'W')));
    appendAirfieldDetailRows(body, af, title.value);
  } else if (state.selected.type === 'navwp') {
    const nw = navWP && navWP[state.selected.index];
    if (!nw) {
      state.selected = null;
      insp.classList.add('hidden');
      clearStoredInspectorSelection();
      return;
    }
    title.value = nw.name;
    title.placeholder = ''; title.readOnly = true; title.oninput = null;
    const nwLocale = inspLocaleName(nw);
    if (nwLocale) {
      body.appendChild(textRow(S.navHebrew || 'Waypoint name', nwLocale));
    }
    body.appendChild(textRow(S.latitude, fmtLatLng(nw.lat, 'N', 'S')));
    body.appendChild(textRow(S.longitude, fmtLatLng(nw.lng, 'E', 'W')));
    appendSatelliteSnippet(body, nw, nw.name);
    appendVorRadialRow(body, nw.lat, nw.lng);
  } else {
    const wp = state.waypoints[state.selected.index];
    normalizeWaypointSequenceName(wp);
    const afInsp = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wp) : null;
    const ref = typeof findSnappedReference === 'function' ? findSnappedReference(wp) : null;
    let canonical = ref ? ref.name : null;
    let refLocale = ref ? inspLocaleName(ref) : '';
    const storedName = (wp.name || '').trim();
    if (!canonical && storedName && navWP) {
      for (const nw of navWP) {
        if (nw.name === storedName || nw.en === storedName || nw.he === storedName) {
          canonical = nw.name;
          refLocale = inspLocaleName(nw);
          break;
        }
      }
    }
    title.value = afInsp ? airfieldInspectorTitle(afInsp)
      : canonical || navName(storedName) || (S.wpPrefix + (state.selected.index + 1));
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
    body.appendChild(textRow(S.latitude, fmtLatLng(wp.lat, 'N', 'S')));
    body.appendChild(textRow(S.longitude, fmtLatLng(wp.lng, 'E', 'W')));
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
function numberRow(label, value, onChange, opts = {}) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = altitudeInputValue(value);
  if (opts.placeholder) inp.placeholder = opts.placeholder;
  const commit = () => {
    const raw = inp.value.trim();
    if (opts.allowUnknown && raw === '') {
      onChange(NaN);
      return;
    }
    const v = parseFloat(inp.value);
    if (!isNaN(v)) onChange(v);
  };
  inp.onchange = commit;
  // `live` also commits on every `input` — keystrokes and the number spinner.
  // On macOS the spinner / typing only fire `change` on blur, so without this
  // the leg altitude (and the MSA flag) wouldn't update until the field was
  // left or the inspector reopened.
  if (opts.live) inp.oninput = commit;
  row.append(l, inp);
  // Optional reset button — restores the charted altitude from the dataset.
  // Omitted when undoValue is undefined (no known/charted value to revert to).
  if (opts.undoValue !== undefined) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-reset';
    btn.textContent = '↻';
    btn.title = S.altResetKnown || 'Reset to charted altitude';
    btn.setAttribute('aria-label', btn.title);
    btn.onclick = () => {
      inp.value = altitudeInputValue(opts.undoValue);
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
    body.appendChild(selectRow(S.commChangeName || 'Call sign',
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
      }));
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
    const f = legFrame(lab.i);
    drag = { kind: 'label', i: lab.i, which: lab.which, lx: p.x, ly: p.y,
             dx: f.dx, dy: f.dy, nx: f.nx, ny: f.ny };
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
    const ddx = p.x - drag.lx, ddy = p.y - drag.ly;
    drag.lx = p.x; drag.ly = p.y;
    const leg = state.legs[drag.i];
    const o = leg && (drag.which === 'in' ? leg.inLabel : leg.outLabel);
    if (!o) return;                    // malformed leg / label — issue #82
    const isc = 1 / legZoomScale();
    o.a += (ddx * drag.dx + ddy * drag.dy) * isc;
    o.p += (ddx * drag.nx + ddy * drag.ny) * isc;
    draw();
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
      const SNAP_DEG = 0.0002;
      const snappedToSelf = Math.abs(wp.lat - drag.origLat) < SNAP_DEG &&
          Math.abs(wp.lng - drag.origLng) < SNAP_DEG;
      const snappedToOther = state.waypoints.some((w, j) => j !== drag.i &&
          Math.abs(w.lat - wp.lat) < SNAP_DEG &&
          Math.abs(w.lng - wp.lng) < SNAP_DEG);
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
    const SNAP_DEG = 0.0002;
    if (state.waypoints.some(
          w => Math.abs(w.lat - r.lat) < SNAP_DEG &&
               Math.abs(w.lng - r.lng) < SNAP_DEG)) {
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
    const f = legFrame(lab.i);
    touchDrag = { kind: 'label', i: lab.i, which: lab.which,
                  lx: p.x, ly: p.y, dx: f.dx, dy: f.dy, nx: f.nx, ny: f.ny };
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
    const ddx = p.x - touchDrag.lx, ddy = p.y - touchDrag.ly;
    touchDrag.lx = p.x; touchDrag.ly = p.y;
    const leg = state.legs[touchDrag.i];
    const o = leg && (touchDrag.which === 'in' ? leg.inLabel : leg.outLabel);
    if (!o) return;                    // malformed leg / label — issue #82
    const isc = 1 / legZoomScale();
    o.a += (ddx * touchDrag.dx + ddy * touchDrag.dy) * isc;
    o.p += (ddx * touchDrag.nx + ddy * touchDrag.ny) * isc;
    draw();
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
      const SNAP_DEG = 0.0002;
      const snappedToSelf = Math.abs(wp.lat - touchDrag.origLat) < SNAP_DEG &&
          Math.abs(wp.lng - touchDrag.origLng) < SNAP_DEG;
      const snappedToOther = state.waypoints.some((w, j) => j !== touchDrag.i &&
          Math.abs(w.lat - wp.lat) < SNAP_DEG &&
          Math.abs(w.lng - wp.lng) < SNAP_DEG);
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
