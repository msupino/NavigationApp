'use strict';
/* NavAid — hit-testing, inspector panel, mouse/touch interaction.
   Shares globals with core.js; loaded after draw.js. */

// --- hit testing -----------------------------------------------------
function hitNote(px, py) {
  for (let i = state.notes.length - 1; i >= 0; i--) {
    if (state.notes[i] && state.notes[i].cc && !showCommChange) continue;
    // Frequency callouts are drawn above waypoint markers, but the waypoint
    // circle itself must remain independently selectable.
    if (state.notes[i] && state.notes[i].cc && hitWaypoint(px, py) >= 0) continue;
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
  for (let i = state.waypoints.length - 1; i >= 0; i--) {
    const s = proj(state.waypoints[i]);
    if (Math.hypot(s.x - px, s.y - py) <= waypointGeom(i).r + tune('hitWaypointExtraPx')) return i;
  }
  return -1;
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
      if (which === 'out' && !showReturn) continue;
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
  if (newVal === oldVal) return;
  const dir = key === 'outboundAltitude' || key === 'outboundSpeed' ? -1 : 1;
  for (let j = i + dir; j >= 0 && j < state.legs.length; j += dir) {
    if (state.legs[j][key] !== oldVal) break;
    state.legs[j][key] = newVal;
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
// Returns the canonical English code (4-letter ICAO / 5-letter nav-WP)
// rather than the locale label, so `navName()` can resolve it back to
// the user's locale at render time.
function findSnappedReference(wp) {
  if (!wp || typeof map === 'undefined' || !map) return null;
  const ll = { lat: wp.lat, lng: wp.lng };
  if (typeof nearestAirfield === 'function' &&
      Array.isArray(airfields) && airfields.length) {
    const af = nearestAirfield(ll, 18);
    if (af) return { name: af.name };
  }
  if (typeof nearestNavWaypoint === 'function' &&
      Array.isArray(navWP) && navWP.length) {
    const nw = nearestNavWaypoint(ll, 18);
    if (nw) return { name: nw.name };
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

function showInspector() {
  const insp = document.getElementById('inspector');
  const title = document.getElementById('insp-title');
  const body = document.getElementById('insp-body');
  body.innerHTML = '';
  title.classList.remove('editable');
  if (!state.selected) { insp.classList.add('hidden'); return; }
  insp.classList.remove('hidden');

  if (state.selected.type === 'leg') {
    const idx = state.selected.index;
    const leg = state.legs[idx];
    title.value = legPairTitle(idx);
    title.placeholder = '';
    title.readOnly = true;
    title.oninput = null;
    body.appendChild(numberRow(S.speedKt, leg.flightSpeed, v => {
      leg.flightSpeed = v > 0 ? v : leg.flightSpeed; draw();
    }));
    body.appendChild(numberRow(S.inboundAlt, leg.inboundAltitude, v => {
      const oldVal = leg.inboundAltitude;
      leg.inboundAltitude = Math.round(v);
      propagateAlt(idx, 'inboundAltitude', leg.inboundAltitude, oldVal);
      draw();
    }));
    body.appendChild(numberRow(S.outboundAlt, leg.outboundAltitude, v => {
      const oldVal = leg.outboundAltitude;
      leg.outboundAltitude = Math.round(v);
      propagateAlt(idx, 'outboundAltitude', leg.outboundAltitude, oldVal);
      draw();
    }));
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
  } else {
    const wp = state.waypoints[state.selected.index];
    normalizeWaypointSequenceName(wp);
    // #81: show the locale-resolved label so the inspector matches the map.
    // The canonical stored name (`wp.name`) is whatever the user types/keeps;
    // navName() converts a nav-WP canonical id to the current locale for read.
    title.value = navName((wp.name || '').trim()) || wp.name || '';
    title.placeholder = S.wpPrefix + (state.selected.index + 1);
    title.readOnly = false;
    title.classList.add('editable');
    title.oninput = () => {
      const t = (title.value || '').trim();
      wp.name = isSequenceWaypointName(t) ? '' : title.value;
      draw();
    };
    body.appendChild(textRow(S.latitude, fmtLatLng(wp.lat, 'N', 'S')));
    body.appendChild(textRow(S.longitude, fmtLatLng(wp.lng, 'E', 'W')));
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
    const afInsp = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wp) : null;
    // #231: runway directions when the waypoint is at a known airfield (ICAO
    // name or ARP coords — renamed labels at the same ARP keep runways).
    if (afInsp && Array.isArray(afInsp.runways) && afInsp.runways.length) {
      const row = document.createElement('div');
      row.className = 'row runways-row';
      const lbl = document.createElement('label');
      lbl.textContent = S.runways;
      row.appendChild(lbl);
      const chips = document.createElement('div');
      chips.className = 'runway-chips';
      for (const r of afInsp.runways) {
        const chip = document.createElement('span');
        chip.className = 'runway-chip';
        chip.textContent = r;
        chips.appendChild(chip);
      }
      row.appendChild(chips);
      body.appendChild(row);
    }
    // #105: plates when the waypoint matches an airfield by name or ARP coords.
    if (afInsp && afInsp.plates && afInsp.plates.length) {
      const af = afInsp;
      const section = document.createElement('div');
      section.className = 'plates-section';
      const label = document.createElement('div');
      label.className = 'row';
      const l = document.createElement('label');
      l.textContent = S.plates;
      label.appendChild(l);
      section.appendChild(label);
      // Group by category
      const groups = {};
      const catOrder = ['approach', 'sid', 'star', 'ground', 'vfr', 'other'];
      const catLabel = {
        approach: S.plateCategoryApproach,
        sid: S.plateCategorySid,
        star: S.plateCategoryStar,
        ground: S.plateCategoryGround,
        vfr: S.plateCategoryVfr,
        other: S.plateCategoryOther,
      };
      for (const fn of af.plates) {
        const cat = plateCategory(fn);
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(fn);
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
function numberRow(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = value;
  inp.onchange = () => {
    const v = parseFloat(inp.value);
    if (!isNaN(v)) onChange(v);
  };
  row.append(l, inp);
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
  let lastValidFreq = '';
  const setFreqInputValid = ok => {
    if (!freqInput) return;
    freqInput.classList.toggle('invalid', !ok);
    freqInput.setAttribute('aria-invalid', ok ? 'false' : 'true');
  };
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
        note.freq = (typeof commNormalizeFreqInput === 'function'
          ? commNormalizeFreqInput(opt.freq) : opt.freq) || '';
        note.freqAuto = false;
        lastValidFreq = note.freq;
        if (freqInput) {
          freqInput.value = note.freq;
          setFreqInputValid(true);
        }
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
  const freqControl = document.createElement('span');
  freqControl.className = 'freq-control';
  freqInput = document.createElement('input');
  freqInput.type = 'text';
  freqInput.inputMode = 'decimal';
  freqInput.className = 'freq-input';
  freqInput.value = commNoteFreq(note) || '';
  lastValidFreq = freqInput.value;
  setFreqInputValid(true);
  freqInput.oninput = () => {
    const normalized = typeof commNormalizeFreqInput === 'function'
      ? commNormalizeFreqInput(freqInput.value) : freqInput.value.trim();
    const valid = normalized !== null;
    setFreqInputValid(valid);
    if (!valid) return;
    if (normalized === '') return;
    note.freq = normalized;
    if (normalized) lastValidFreq = normalized;
    note.freqAuto = false;
    draw();
  };
  freqInput.onblur = () => {
    const normalized = typeof commNormalizeFreqInput === 'function'
      ? commNormalizeFreqInput(freqInput.value) : freqInput.value.trim();
    if (normalized === null) {
      freqInput.value = lastValidFreq;
      note.freq = lastValidFreq;
      setFreqInputValid(true);
      draw();
    } else {
      freqInput.value = normalized;
      note.freq = normalized;
      lastValidFreq = normalized;
      setFreqInputValid(true);
      draw();
    }
  };
  freqControl.appendChild(freqInput);
  const unit = document.createElement('span');
  unit.className = 'freq-unit';
  unit.textContent = 'MHz';
  freqControl.appendChild(unit);
  freqRow.appendChild(freqControl);
  body.appendChild(freqRow);
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

map.on('mousedown', e => {
  const p = e.containerPoint;
  // Hit-test priority matches paint order so the topmost element wins:
  // notes are drawn above waypoints (draw.js), so test notes first (issue #71).
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
  const wp = hitWaypoint(p.x, p.y);
  if (wp >= 0) {
    downHit = true;
    state.selected = { type: 'wp', index: wp };
    drag = { kind: 'wp', i: wp, moved: false,
             origLat: state.waypoints[wp].lat, origLng: state.waypoints[wp].lng };
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
    const r = applyNavSnap(e.latlng, wp.name || '',
                          { lat: drag.origLat, lng: drag.origLng });
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
      if (snappedToSelf || snappedToOther) {
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
    if (drag.kind === 'wp' && drag.moved && typeof seedCommChangeNotes === 'function' &&
        seedCommChangeNotes()) {
      draw(); showInspector();
    }
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

function touchXY(t) {
  const r = mapEl.getBoundingClientRect();
  return { x: t.clientX - r.left, y: t.clientY - r.top };
}

mapEl.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  const p = touchXY(e.touches[0]);
  // Hit-test priority matches paint order so the topmost element wins:
  // notes are drawn above waypoints (draw.js), so test notes first (issue #71).
  const note = hitNote(p.x, p.y);
  const wp = note < 0 ? hitWaypoint(p.x, p.y) : -1;
  const cum = (wp < 0 && note < 0) ? hitCumLabel(p.x, p.y) : null;
  const cumRet = (wp < 0 && note < 0 && !cum) ? hitCumLabelRet(p.x, p.y) : null;
  const lab = (wp < 0 && note < 0 && !cum && !cumRet) ? hitLegLabel(p.x, p.y) : null;
  const leg = (wp < 0 && note < 0 && !lab && !cum && !cumRet) ? hitLeg(p.x, p.y) : -1;
  const onPage = (wp < 0 && note < 0 && !lab && !cum && !cumRet && leg < 0 && pageSize)
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
  } else if (wp >= 0) {
    touchDrag = { kind: 'wp', i: wp, moved: false,
                  origLat: state.waypoints[wp].lat, origLng: state.waypoints[wp].lng };
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
    const r = applyNavSnap(ll, wp.name || '',
                           { lat: touchDrag.origLat, lng: touchDrag.origLng });
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
      if (snappedToSelf || snappedToOther) {
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
    if (touchDrag.kind === 'wp' && touchDrag.moved &&
        typeof seedCommChangeNotes === 'function' &&
        seedCommChangeNotes()) {
      draw(); showInspector();
    }
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
