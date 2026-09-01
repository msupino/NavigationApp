'use strict';
/* NavAid — hit-testing, inspector panel, mouse/touch interaction.
   Shares globals with core.js; loaded after draw.js. */

// --- hit testing -----------------------------------------------------
function hitNote(px, py) {
  for (let i = state.notes.length - 1; i >= 0; i--) {
    const note = state.notes[i];
    if (typeof routeNoteDirVisible === 'function' && !routeNoteDirVisible(note)) continue;
    if (note && note.cc && !showCommChange) continue;
    // Frequency callouts are drawn above waypoint markers, but the waypoint
    // circle itself must remain independently selectable.
    if (note && note.cc && hitWaypoint(px, py) >= 0) continue;
    if (note && note.cc) {
      const hitComm = hitCommCallout(px, py, note);
      if (hitComm === true) return i;
      // false = outside the callout; null = it has no geometry, because it is degenerate and
      // nothing was drawn. Falling through to noteRect() below gave that second case the
      // generic 40x40 box -- an invisible blob that swallowed presses over blank chart.
      if (hitComm === false || hitComm === null) continue;
    }
    const r = noteRect(i);
    // Test in the note's OWN frame: identification-point ovals are drawn rotated
    // across the track, so un-rotate the point by the same angle drawNotes used
    // (noteDrawAngle) before the ellipse/box test. Without this the hit region sat
    // 90° off the painted oval on an east-west leg.
    const ang = (typeof noteDrawAngle === 'function') ? noteDrawAngle(note) : 0;
    let qx = px - (r.x + r.w / 2);
    let qy = py - (r.y + r.h / 2);
    if (ang) {
      const c = Math.cos(-ang), s = Math.sin(-ang);
      const rx = qx * c - qy * s, ry = qx * s + qy * c;
      qx = rx; qy = ry;
    }
    if (r.oval) {
      const dx = qx / (r.w / 2);
      const dy = qy / (r.h / 2);
      if (dx * dx + dy * dy <= 1) return i;
    } else if (Math.abs(qx) <= r.w / 2 && Math.abs(qy) <= r.h / 2) {
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
    if (typeof routeNoteDirVisible === 'function' && !routeNoteDirVisible(note)) continue;
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
  const namedIndex = state.waypoints.findIndex(w => {
    const name = typeof canonicalNavWaypointName === 'function'
      ? canonicalNavWaypointName(w && w.name) : String(w && w.name || '').trim();
    if (name !== key) return false;
    return typeof commChangeWaypointInRange === 'function'
      ? commChangeWaypointInRange(w, key) : true;
  });
  if (namedIndex >= 0) return namedIndex;
  return state.waypoints.findIndex(w => typeof commChangeWaypointInRange === 'function' &&
    commChangeWaypointInRange(w, key));
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
  if (sel.type === 'lsaArea') return Array.isArray(areas);
  if (sel.type === 'airspace') return Array.isArray(window.airspace);
  return true;
}

function normalizeInspectorSelection(sel) {
  if (!sel || typeof sel !== 'object') return null;
  // An aircraft is named by its transponder address, not by a place in one of our arrays:
  // the list it lives in is rebuilt every few seconds and its order means nothing.
  if (sel.type === 'traffic') {
    const hex = String(sel.hex || '');
    return hex && (window.trafficAircraft || []).some(a => a && a.hex === hex)
      ? { type: 'traffic', hex } : null;
  }
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
  if (sel.type === 'airspace') {
    return Array.isArray(window.airspace) && index < window.airspace.length
      ? { type: 'airspace', index } : null;
  }
  if (sel.type === 'lsaArea') {
    return Array.isArray(areas) && index < areas.length ? { type: 'lsaArea', index } : null;
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
    // A reload restores BOTH the flight plan and the selection. The plan hides the
    // inspector (it would cover the right-hand columns), so showing it here dropped
    // the panel straight back on top of the plan it had just been hidden for. Keep
    // the selection, defer the panel: the plan hands it back when it closes.
    if (typeof fpOpen !== 'undefined' && fpOpen) window.__inspectorDeferredByPlan = true;
    else showInspector();
    return 'restored';
  }
  if (!inspectorSelectionDataReady(sel)) return 'pending';
  clearStoredInspectorSelection();
  return 'invalid';
}
function addCommChangeNoteForWaypoint(wp, ccKey) {
  if (!wp || !ccKey || !Array.isArray(state.notes)) return -1;
  const wpIdx = Array.isArray(state.waypoints) ? state.waypoints.indexOf(wp) : -1;
  if (wpIdx >= 0 && typeof legRetraceTurnIndex === 'function' &&
      legRetraceTurnIndex() === wpIdx) return -1;
  if (isKnownCommChangeKey(ccKey) && typeof unsuppressCommChange === 'function') {
    unsuppressCommChange(ccKey);
  }
  const existing = state.notes.findIndex(n => linkedCommChangeNoteForKey(n, ccKey));
  if (existing >= 0) return existing;
  const tail = typeof commCalloutDefaultTail === 'function'
    ? commCalloutDefaultTail(wp) : { lat: r5(wp.lat), lng: r5(wp.lng) };
  const callout = typeof commCalloutDefaults === 'function'
    ? commCalloutDefaults(ccKey) : { freqName: ccKey, freq: '' };
  let freqName = callout.freqName;
  let freq = callout.freq;
  // If the waypoint is an airfield with a known primary call sign, seed the
  // freq change with that airfield's main frequency (and its call-sign name)
  // so the user doesn't have to type it. Only when the callout has no freq of
  // its own (a route comm-change catalog entry wins).
  if (!freq) {
    const af = typeof airfieldAtWaypoint === 'function' ? airfieldAtWaypoint(wp) : null;
    const id = af && Object.prototype.hasOwnProperty.call(AIRFIELD_CALL_SIGN_IDS, af.name)
      ? AIRFIELD_CALL_SIGN_IDS[af.name] : null;
    const eff = id && typeof commCallSignEffectiveFreq === 'function'
      ? commCallSignEffectiveFreq(id) : '';
    if (eff) {
      freq = eff;
      const row = typeof commCatalogCallSignRow === 'function' ? commCatalogCallSignRow(id) : null;
      const label = typeof commCallSignLabel === 'function' ? commCallSignLabel(id, row) : '';
      if (label) freqName = label;
    }
  }
  state.notes.push({
    lat: tail.lat,
    lng: tail.lng,
    text: (typeof S !== 'undefined' && S.commChangeNoteText) || 'Freq change',
    color: NOTE_DEFAULT_COLOR,
    shape: 'rect',
    cc: ccKey,
    freqName: freqName,
    freq: freq,
    freqAuto: true,
  });
  return state.notes.length - 1;
}
function waypointFreqChangeKey(wp) {
  if (!wp) return '';
  const raw = String(wp.name || '').trim();
  if (!raw || (typeof isSequenceWaypointName === 'function' && isSequenceWaypointName(raw))) return '';
  return typeof canonicalNavWaypointName === 'function' ? canonicalNavWaypointName(raw) : raw;
}
function linkedCommChangeNoteForKey(note, ccKey) {
  if (!note || !note.cc || !ccKey) return false;
  return (typeof canonicalNavWaypointName === 'function'
    ? canonicalNavWaypointName(note.cc) === ccKey
    : note.cc === ccKey);
}
function freqChangeNoteForKey(ccKey) {
  if (!ccKey || !Array.isArray(state.notes)) return null;
  return state.notes.find(n => linkedCommChangeNoteForKey(n, ccKey)) || null;
}
function isKnownCommChangeKey(ccKey) {
  const cc = commChangeMap && ccKey ? commChangeMap[ccKey] : null;
  return !!(cc && cc.commChange);
}
function appendAddFreqChangeButton(body, wp, ccKey) {
  if (!body || !wp || !ccKey || !showCommChange) return;
  const wpIdx = Array.isArray(state.waypoints) ? state.waypoints.indexOf(wp) : -1;
  // At the turning point you leave on the frequency you arrived on, so there is no change to
  // call. Dimmed with the reason rather than taken away: a control that vanishes when a
  // point becomes the turn moves everything under it -- including the button being pressed
  // -- and leaves a pilot hunting for an action that was there a moment ago.
  const atTurn = wpIdx >= 0 && typeof legRetraceTurnIndex === 'function' &&
    legRetraceTurnIndex() === wpIdx;
  const add = document.createElement('button');
  add.className = 'insp-btn add-freq-change-btn';
  add.textContent = S.addFreqChange || 'Add frequency change';
  add.disabled = atTurn;
  if (atTurn) add.title = S.addFreqChangeAtTurn ||
    'You leave the turning point on the frequency you arrived on, so there is no change to call here.';
  add.onclick = () => {
    if (atTurn) return;
    const idx = addCommChangeNoteForWaypoint(wp, ccKey);
    if (idx >= 0 && state.selected && state.selected.type === 'wp') {
      state.selected.freqNoteIndex = idx;
    }
    draw(); showInspector();
  };
  body.appendChild(add);
}

function appendNavWaypointCommChangeInfo(body, name) {
  if (!showCommChange || !commChangeMap) return false;
  const ccKey = typeof canonicalNavWaypointName === 'function'
    ? canonicalNavWaypointName(name) : String(name || '').trim();
  if (!ccKey) return false;
  const cc = commChangeMap[ccKey];
  if (!cc || !cc.commChange) return false;

  const row = document.createElement('div');
  row.className = 'row col commchange-row commchange-map-row';
  const lbl = document.createElement('label');
  lbl.className = 'commchange-label';
  lbl.textContent = S.commChangeBadge || '📡 Freq change point';
  row.appendChild(lbl);

  const opts = typeof commCallSignOptions === 'function'
    ? commCallSignOptions(ccKey) : [];
  if (opts.length) {
    const title = document.createElement('span');
    title.className = 'commchange-options-title';
    title.textContent = S.commChangeCallSigns || S.commChangeName || 'Call signs';
    row.appendChild(title);

    const list = document.createElement('div');
    list.className = 'commchange-options';
    for (const opt of opts) {
      const item = document.createElement('span');
      item.className = 'val commchange-option';
      item.dataset.callSign = opt.id || '';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'commchange-option-name';
      nameSpan.textContent = opt.label || opt.id || '';
      item.appendChild(nameSpan);

      if (opt.id) {
        const code = document.createElement('span');
        code.className = 'commchange-option-code';
        code.textContent = opt.id;
        item.appendChild(code);
      }

      if (opt.freq) {
        const freq = document.createElement('span');
        freq.className = 'commchange-option-freq';
        freq.dir = 'ltr';
        freq.textContent = opt.freq + ' MHz';
        item.appendChild(freq);
      }
      list.appendChild(item);
    }
    row.appendChild(list);
  } else if (cc.from || cc.to) {
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
  body.appendChild(row);
  return true;
}
function hitWaypoint(px, py) {
  const hits = hitWaypointCandidates(px, py);
  return hits.length ? hits[0].index : -1;
}
function hitWaypointCandidates(px, py) {
  const hits = [];
  for (let i = state.waypoints.length - 1; i >= 0; i--) {
    if (typeof legDirWaypointVisible === 'function' && !legDirWaypointVisible(i)) continue;
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
    if (typeof routePointOnlyInHiddenDirection === 'function' &&
        routePointOnlyInHiddenDirection(airfields[i])) continue;
    const s = proj(airfields[i]);
    if (Math.hypot(s.x - px, s.y - py) <= r) hits.push({ type: 'airfield', index: i, chartPoint: true });
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
    if (typeof routePointOnlyInHiddenDirection === 'function' &&
        routePointOnlyInHiddenDirection(navWP[i])) continue;
    const s = proj(navWP[i]);
    // `chartPoint` marks a real chart-point marker. Comm-change rings report the same
    // 'navwp' type (they are drawn on these dots), so type alone cannot tell them
    // apart — and filtering by type removed rings from the point chooser.
    if (Math.hypot(s.x - px, s.y - py) <= r) hits.push({ type: 'navwp', index: i, chartPoint: true });
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
    if (typeof routePointOnlyInHiddenDirection === 'function' &&
        routePointOnlyInHiddenDirection(wp)) continue;
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
    if (!c) continue;
    let key;
    if (c.type === 'notam') key = 'notam:' + (c.notam && c.notam.id);
    else { if (!Number.isInteger(c.index)) continue; key = c.type + ':' + c.index; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
function pointChoiceText(c) {
  if (c.type === 'airspace') {
    const a = (window.airspace && window.airspace[c.index]) || {};
    const kind = a.kind === 'prohibited' ? (S.airspaceProhibited || 'Prohibited')
      : a.kind === 'tma' ? (S.airspaceTma || 'TMA')
      : a.kind === 'ctr' ? (S.airspaceCtr || 'CTR') : (S.airspaceRestricted || 'Restricted');
    return { primary: a.short || a.id || kind,
      meta: kind + (typeof airspaceLimitText === 'function' ? ' \u00b7 ' + airspaceLimitText(a) : '') };
  }
  if (c.type === 'lsaArea') {
    const a = (typeof areas !== 'undefined' && areas && areas[c.index]) || {};
    const bits = [];
    if (Number.isFinite(a.lowFt) && Number.isFinite(a.highFt)) bits.push(a.lowFt + '-' + a.highFt + ' ' + (S.unitFeet || 'ft'));
    // The legend's availability class only -- same rule as the map label and inspector.
    if (a.active === 'weekend') bits.push(S.bubbleWeekendTag || 'weekend');
    return { primary: areaLabel(a) || a.icao || (S.chooseLsaBubble || 'LSA bubble'),
      meta: (S.chooseLsaBubble || 'LSA bubble') + (bits.length ? ' \u00b7 ' + bits.join('  ') : '') };
  }
  if (c.type === 'notam') {
    const n = c.notam || {};
    return {
      primary: n.id || 'NOTAM',
      meta: (S.choosePointNotam || 'NOTAM') + (n.end ? ' / ' + n.end : ''),
    };
  }
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
    const named = !!String(wp.name || '').trim() &&
      !(typeof isSequenceWaypointName === 'function' && isSequenceWaypointName(wp.name));
    let meta = (S.choosePointRoute || 'Route waypoint') + (named ? '' : ' ' + (c.index + 1));
    // A named route point and its chart reference are one place and one useful chooser
    // action. The route identity wins so the point remains editable, while this suffix
    // makes the airfield/navigation information discoverable.
    const refChoice = c.mergedReference;
    if (refChoice && refChoice.type === 'airfield') {
      const af = airfields && airfields[refChoice.index];
      const label = referenceLocaleName(af, 'airfield');
      meta += ' / ' + (S.choosePointAirfield || 'Airfield') + (label ? ' / ' + label : '');
    } else if (refChoice && refChoice.type === 'navwp') {
      const nw = navWP && navWP[refChoice.index];
      const label = referenceOverlayLabel(nw, 'navwp');
      meta += ' / ' + (S.choosePointNavWaypoint || 'Navigation waypoint') +
        (label && label !== waypointDisplayLabel(wp, c.index) ? ' / ' + label : '');
    }
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
function pointCandidateCanonicalKey(c) {
  if (!c || !Number.isInteger(c.index)) return '';
  if (c.type === 'commcallout') {
    const note = state.notes[c.index];
    return note && note.cc
      ? (typeof canonicalNavWaypointName === 'function'
          ? canonicalNavWaypointName(note.cc)
          : String(note.cc || '').trim())
      : '';
  }
  if (c.type === 'wp') return waypointFreqChangeKey(state.waypoints[c.index]);
  if (c.type === 'navwp') {
    const nw = navWP && navWP[c.index];
    return nw && nw.name
      ? (typeof canonicalNavWaypointName === 'function'
          ? canonicalNavWaypointName(nw.name)
          : String(nw.name || '').trim())
      : '';
  }
  if (c.type === 'airfield') {
    const af = airfields && airfields[c.index];
    return af && af.name ? String(af.name).trim() : '';
  }
  return '';
}
function collapseLinkedCommRouteCandidates(items) {
  const linkedRouteIndexes = new Set();
  const linkedKeys = new Set();
  for (const c of items || []) {
    if (!c || c.type !== 'commcallout') continue;
    const note = state.notes[c.index];
    const wpIndex = commCalloutWaypointIndex(note);
    if (wpIndex < 0) continue;
    const hasLinkedWaypoint = items.some(item =>
      item && item.type === 'wp' && item.index === wpIndex);
    if (!hasLinkedWaypoint) continue;
    linkedRouteIndexes.add(wpIndex);
    const key = pointCandidateCanonicalKey(c) || waypointFreqChangeKey(state.waypoints[wpIndex]);
    if (key) linkedKeys.add(key);
  }
  if (!linkedRouteIndexes.size) return items;
  return items.filter(c => {
    if (!c || c.type === 'commcallout') return true;
    if (c.type === 'wp' && linkedRouteIndexes.has(c.index)) return false;
    const key = pointCandidateCanonicalKey(c);
    return !(key && linkedKeys.has(key));
  });
}
function collapseNamedRouteReferenceCandidates(items) {
  const out = (items || []).slice();
  const routes = out.filter(c => c && c.type === 'wp' && Number.isInteger(c.index));
  if (!routes.length) return out;
  const merged = new Set();
  for (const refChoice of out) {
    if (!refChoice || (refChoice.type !== 'airfield' && refChoice.type !== 'navwp')) continue;
    const ref = refChoice.type === 'airfield'
      ? (airfields && airfields[refChoice.index])
      : (navWP && navWP[refChoice.index]);
    const refKey = pointCandidateCanonicalKey(refChoice);
    if (!ref || !refKey) continue;
    const routeChoice = routes.find(c => {
      const wp = state.waypoints[c.index];
      return wp && pointCandidateCanonicalKey(c) === refKey &&
        (typeof sameMapPoint === 'function'
          ? sameMapPoint(wp, ref)
          : wp.lat === ref.lat && wp.lng === ref.lng);
    });
    if (!routeChoice) continue;
    // Keep selecting the route object: its inspector already includes the matching
    // airfield/nav-point details, and it also retains move/delete/edit actions.
    routeChoice.mergedReference = refChoice;
    merged.add(refChoice);
  }
  return out.filter(c => !merged.has(c));
}
function selectPointCandidate(c) {
  if (c.type === 'notam') {
    if (typeof showNotamModal === 'function') showNotamModal([c.notam]);
    return;
  }
  state.selected = c.type === 'commcallout'
    ? selectionForNoteHit(c.index)
    : { type: c.type, index: c.index };
  showInspector();
  draw();
}
function showPointChoice(candidates) {
  const items = collapseNamedRouteReferenceCandidates(
    collapseLinkedCommRouteCandidates(dedupePointCandidates(candidates)));
  if (!items.length) return false;
  if (items.length === 1) {
    selectPointCandidate(items[0]);
    return true;
  }
  if (typeof createDraggableModal !== 'function') {
    selectPointCandidate(items[0]);
    return true;
  }
  // The chooser replaces the current inspection surface. Close the old inspector and clear
  // its enlarged waypoint before drawing the chooser. Fresh storage exposes this often
  // because reference-point overlays are enabled by default.
  state.selected = null;
  showInspector();
  draw();
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
    if (typeof legDirVisible === 'function' && !legDirVisible(i)) continue;
    const A = state.waypoints[i], B = state.waypoints[i + 1];
    if (!A || !B) continue;   // guard the transient legs>waypoints-1 state (imported / mid-edit)
    // The line as DRAWN: an out-and-back pair is drawn to either side of the track, and a
    // hit test on the shared centre line would hand the click to whichever leg came first.
    const ends = (typeof legScreenEnds === 'function') ? legScreenEnds(i) : null;
    const a = ends ? ends.a : proj(A);
    const b = ends ? ends.b : proj(B);
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
// Unit frame of leg i: along-track (dx,dy) and its perpendicular (nx,ny).
// Returns null only when an endpoint is missing (the transient
// legs > waypoints-1 state), which every caller guards.
//
// When both endpoints project to the SAME pixel — a sub-pixel leg at low zoom, or
// two coincident waypoints — there is no direction, and `len` is reported as 0.
// The vector components stay ZERO in that case, deliberately: the renderer does
// the same (`hypot(...) || 1` with a zero delta, ang = atan2(0,0) = 0), so the
// kite is drawn at the midpoint with no perpendicular offset, and legLabelCenter
// has to agree or the hit box lands somewhere the kite isn't.
// Consumers that need an orientation must check `len` and fall back to screen axes
// (see hitLegLabel) — a rotated-box test fed zero vectors evaluates |0| <= half
// for EVERY point, which is what let one click anywhere on the map grab this kite.
function legFrame(i) {
  const A = state.waypoints[i], B = state.waypoints[i + 1];
  if (!A || !B) return null;
  // The leg as DRAWN: an out-and-back pair is drawn to either side of the shared track, and
  // everything positioned from this frame -- the nav kite, the cumulative kite, their hit
  // boxes -- belongs with its own line rather than on the centre between them.
  const ends = (typeof legScreenEnds === 'function') ? legScreenEnds(i) : null;
  const a = ends ? ends.a : proj(A);
  const b = ends ? ends.b : proj(B);
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len > 0) { dx /= len; dy /= len; }
  return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
           dx, dy, nx: -dy, ny: dx, len };
}
function clampLegLabelAlong(legIdx, label) {
  if (!limitLegKites) return;
  if (!label || !state.waypoints[legIdx] || !state.waypoints[legIdx + 1]) return;
  if (!Number.isFinite(label.a)) label.a = 0;
  const sc = legZoomScale() || 1;                 // o.a is stored in this unit
  // Clamp against the kite's ACTUAL drawn width (kiteDrawScale), not the old
  // zoom scale, so a bigger ground-sized kite is kept fully on the leg.
  const drawSc = (typeof kiteDrawScale === 'function') ? kiteDrawScale() : sc;
  const halfKite = (typeof legKiteAlongHalfPx === 'function') ? legKiteAlongHalfPx(drawSc) : 0;
  const f = legFrame(legIdx);
  if (!f) return;                                 // no length to clamp against
  const limit = Math.max(0, (f.len / 2 - halfKite) / sc);
  label.a = Math.max(-limit, Math.min(limit, label.a));
}
// Identification / report point (oval note anchored to a leg). Project a
// screen point onto the point's leg and store the clamped fraction; the oval's
// lat/lng resyncs from the anchor on the next draw.
function setReportPointTFromScreen(n, px, py) {
  if (!n || !n.rp) return;
  const i = n.rp.leg;
  const A = state.waypoints[i], B = state.waypoints[i + 1];
  if (!A || !B) return;
  const sa = proj(A), sb = proj(B);
  const dx = sb.x - sa.x, dy = sb.y - sa.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - sa.x) * dx + (py - sa.y) * dy) / L2 : 0.5;
  n.rp.t = Math.max(0, Math.min(1, t));
}
// Add an identification-point oval to a leg (default: mid-leg), select it, and
// return its note index. Reuses the note object so it persists / exports /
// edits like any oval note; `rp` marks it as leg-anchored with an auto time.
function addReportPointToLeg(legIdx) {
  if (!Array.isArray(state.notes)) state.notes = [];
  const A = state.waypoints[legIdx], B = state.waypoints[legIdx + 1];
  if (!A || !B) return -1;
  const t = 0.5;
  state.notes.push({
    lat: r5(A.lat + (B.lat - A.lat) * t),
    lng: r5(A.lng + (B.lng - A.lng) * t),
    text: '', color: NOTE_DEFAULT_COLOR, shape: 'oval', rp: { leg: legIdx, t },
  });
  const idx = state.notes.length - 1;
  state.selected = { type: 'note', index: idx };
  // No pushUndo() call: no such function exists, so the guarded call was dead.
  // Undo is snapshot-based — draw() runs persist(), which records an undo
  // snapshot synchronously, so this action is already undoable.
  draw();
  return idx;
}
function legLabelDragGrab(legIdx, which, px, py) {
  const c = legLabelCenter(legIdx, which);
  if (!c) return { grabA: 0, grabP: 0 };
  const f = legFrame(legIdx);
  if (!f) return { grabA: 0, grabP: 0 };
  const sc = legZoomScale() || 1;
  return {
    grabA: ((px - c.x) * f.dx + (py - c.y) * f.dy) / sc,
    grabP: ((px - c.x) * f.nx + (py - c.y) * f.ny) / sc,
  };
}
function setLegLabelFromPoint(dragState, px, py) {
  const leg = state.legs[dragState.i];
  const o = leg && (dragState.which === 'in' ? leg.inLabel : leg.outLabel);
  if (!o) return false;                // malformed leg / label
  const f = legFrame(dragState.i);
  if (!f) return false;                // degenerate leg — nothing to drag along
  const sc = legZoomScale() || 1;
  o.a = ((px - f.mx) * f.dx + (py - f.my) * f.dy) / sc - (dragState.grabA || 0);
  clampLegLabelAlong(dragState.i, o);
  o.p = ((px - f.mx) * f.nx + (py - f.my) * f.ny) / sc - (dragState.grabP || 0);
  return true;
}
function legLabelCenter(i, which) {
  if (!state.waypoints[i] || !state.waypoints[i + 1]) return null;
  const f = legFrame(i);
  if (!f) return null;                 // zero-length leg → no kite position
  const o = (which === 'in' ? state.legs[i].inLabel : state.legs[i].outLabel)
            || { a: 0, p: 0 };
  const sc = legZoomScale();
  // A default (unmodified) label has no stored `p`; its
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

// When the user starts dragging a default (unmodified)
// kite, freeze the currently-rendered offset into the stored
// `{ a, p, _m: 1 }` form (drop `_default`) so subsequent drag deltas
// have a real starting point. Keeps the user-dragged path identical
// to the stored-offset design — only the seed value comes from the drift-cone
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
  // The kite is a wide rectangle+triangle, not a disc — a circular hit zone
  // only covered the middle, so the enlarged kite could only be grabbed there.
  // Test the kite's actual ROTATED footprint (its full length × height at the
  // current draw scale) plus a small touch margin, in the leg's local frame.
  const sc = (typeof kiteDrawScale === 'function') ? kiteDrawScale() : legZoomScale();
  const m = tune('hitLegLabelMinPx') / 2;   // touch margin / floor
  const halfL = (tune('legKiteCellWidthPx') * 2 + tune('legKiteTriangleLenPx')) * sc / 2 + m;
  const halfW = tune('legKiteHeightPx') * sc / 2 + m;
  for (let i = 0; i < state.legs.length; i++) {
    if (typeof legDirVisible === 'function' && !legDirVisible(i)) continue;
    const f = legFrame(i);
    if (!f) continue;
    // A hidden kite is not drawn, so it must not be hit-testable either -- the same reason
    // a blocked one-way kite is skipped below. Otherwise hiding it leaves an invisible
    // clickable, draggable object on the map. legKiteVisible (not the narrower
    // legKiteHidden, which only sees the explicit leg.hideKite flag) is the actual
    // draw-time gate draw.js uses -- it also covers a leg inside the departure CTR,
    // hidden by default with no explicit flag set at all.
    if (typeof legKiteVisible === 'function' && !legKiteVisible(i, state.legs[i])) continue;
    for (const which of ['in', 'out']) {
      if (which === 'out' && (!showReturn || !legAllowsReturn(i))) continue;
      // A blocked inbound one-way leg draws NO nav kite (see draw.js) — so it must
      // not be hit-testable either, or it leaves an invisible clickable/draggable
      // kite (e.g. HTZUK→KNTRY).
      if (which === 'in' && typeof legAltitudeIsBlocked === 'function' &&
          legAltitudeIsBlocked(state.legs[i], 'inboundAltitude')) continue;
      const c = legLabelCenter(i, which);
      if (!c) continue;
      // A zero-length leg has no axis (legFrame reports len 0 and zero vectors, to
      // stay in step with the renderer). Use SCREEN axes there — the renderer draws
      // that kite at ang 0, i.e. axis-aligned — instead of projecting onto zero
      // vectors, which made |along| and |perp| both 0 and so matched every point on
      // the map: one click anywhere grabbed the kite and killed panning.
      const ux = f.len ? f.dx : 1, uy = f.len ? f.dy : 0;
      const vx = f.len ? f.nx : 0, vy = f.len ? f.ny : 1;
      const rx = px - c.x, ry = py - c.y;
      const along = rx * ux + ry * uy;   // project onto the leg axis
      const perp = rx * vx + ry * vy;     // and its perpendicular
      if (Math.abs(along) <= halfL && Math.abs(perp) <= halfW) return { i, which };
    }
  }
  return null;
}

// Cumulative-time kite: position relative to B endpoint with leg.cumLabel offsets.
// Mirrors legLabelCenter but anchors to B (proj of waypoints[i+1]).
function cumLabelCenter(i) {
  if (!state.waypoints[i] || !state.waypoints[i + 1]) return null;
  // The leg as DRAWN -- an out-and-back pair is drawn to either side of the shared track,
  // and the renderer anchors this kite on the offset line.
  const ends = (typeof legScreenEnds === 'function') ? legScreenEnds(i) : null;
  const a = ends ? ends.a : proj(state.waypoints[i]);
  const b = ends ? ends.b : proj(state.waypoints[i + 1]);
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const nx = -dy, ny = dx;
  const leg = state.legs[i];
  const o = (leg && leg.cumLabel) || { a: 0, _default: 1, _m: 1 };
  const sc = legZoomScale();
  // Use own driftPerp (not inLabel's perp) so the cum kite is independent
  // of the navigation kite position when in default state.
  // Default placement comes from draw.js's own helper so the box is always where the kite
  // was painted -- cumKiteAngleDeg moves it off the pure perpendicular.
  const def = cumDefaultLabelOffset();
  const perp  = o._default ? def.perp : (o.p || 0) * sc;
  const along = o._default ? def.along : (o.a || 0) * sc;
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
  const sc = legZoomScale() || 1;
  const def = cumDefaultLabelOffset();
  leg.cumLabel = { a: def.along / sc, p: def.perp / sc, _m: 1 };
}
// Point inside a rotated box: center (cx,cy), unit along-axis (ux,uy) toward
// `anchor`, half-length halfL, half-height halfW.
function _pointInKiteBox(px, py, cx, cy, ax, ay, halfL, halfW) {
  let ux = ax - cx, uy = ay - cy;
  const len = Math.hypot(ux, uy);
  // Center coincides with its anchor (degenerate leg) → no axis to orient along.
  // Use +x, which is what the renderer draws here (atan2(0,0) === 0), rather than
  // normalizing to (0,0) — that made the along/perp test true for EVERY point on
  // the map, so a click anywhere grabbed this kite.
  if (len > 0) { ux /= len; uy /= len; } else { ux = 1; uy = 0; }
  const rx = px - cx, ry = py - cy;
  const along = rx * ux + ry * uy;
  const perp = rx * (-uy) + ry * ux;
  return Math.abs(along) <= halfL && Math.abs(perp) <= halfW;
}
function _cumKiteHalfDims() {
  const sc = (typeof cumKiteDrawScale === 'function') ? cumKiteDrawScale() : legZoomScale();
  const m = tune('hitCumLabelMinPx') / 2;
  return {
    halfL: (tune('cumKiteCellWidthPx') + tune('cumKiteTriangleLenPx')) * sc / 2 + m,
    halfW: tune('cumKiteHeightPx') * sc / 2 + m,
  };
}
function hitCumLabel(px, py) {
  // Elongated pentagon oriented toward B — test its rotated footprint, not a
  // circle (which only covered the middle of the enlarged kite).
  if (!showCumTime) return null;   // not drawn (draw.js gates on it) → not grabbable
  const { halfL, halfW } = _cumKiteHalfDims();
  for (let i = 0; i < state.legs.length; i++) {
    if (typeof legDirVisible === 'function' && !legDirVisible(i)) continue;
    // Same as draw.js's own `showCumTime && !preClock` gate: a leg inside the departure
    // CTR is flown on the field's procedure and draws no cumulative kite at all. Missing
    // this left a phantom, never-drawn kite still hit-testable right over the leg's own
    // endpoint waypoint -- exactly the kind of invisible blocker a hidden kite must not be.
    if (typeof legInsideCtr === 'function' && legInsideCtr(i)) continue;
    const c = cumLabelCenter(i);
    const ends = (typeof legScreenEnds === 'function') ? legScreenEnds(i) : null;
    const b = ends ? ends.b : (state.waypoints[i + 1] && proj(state.waypoints[i + 1]));
    if (c && b && _pointInKiteBox(px, py, c.x, c.y, b.x, b.y, halfL, halfW)) return { i };
  }
  return null;
}

// Return cumulative-time kite: anchored at A (proj of waypoints[i]) with its
// own leg.cumLabelRet offsets. Same +dx/+nx frame as cumLabelCenter so the
// drag math is shared; default sits on the opposite perpendicular side.
function cumLabelRetCenter(i) {
  if (!state.waypoints[i] || !state.waypoints[i + 1]) return null;
  const ends = (typeof legScreenEnds === 'function') ? legScreenEnds(i) : null;   // as drawn
  const a = ends ? ends.a : proj(state.waypoints[i]);
  const b = ends ? ends.b : proj(state.waypoints[i + 1]);
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const nx = -dy, ny = dx;
  const leg = state.legs[i];
  const o = (leg && leg.cumLabelRet) || { a: 0, _default: 1, _m: 1 };
  const sc = legZoomScale();
  const def = cumDefaultLabelOffset();            // mirrored, as the renderer mirrors it
  const perp  = o._default ? -def.perp : (o.p || 0) * sc;
  const along = o._default ? -def.along : (o.a || 0) * sc;
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
  const sc = legZoomScale() || 1;
  const def = cumDefaultLabelOffset();
  leg.cumLabelRet = { a: -def.along / sc, p: -def.perp / sc, _m: 1 };  // mirror of the inbound one
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
  let vx = px - frame.anchor.x;
  let vy = py - frame.anchor.y;
  // The kite points AT the waypoint, so dragging it towards one buries the tip in the
  // circle -- and on a busy chart the pilot cannot then read either. Held at arm's length:
  // the tip may touch the edge of the disc and no further, whichever direction it is
  // dragged from. Only the distance is clamped, so the kite still goes wherever it is put.
  const wpIdx = isReturn ? legIdx : legIdx + 1;
  const clear = cumKiteMinAnchorDistPx(wpIdx);
  const dist = Math.hypot(vx, vy);
  if (dist > 0 && dist < clear) {
    vx = vx * clear / dist;
    vy = vy * clear / dist;
  } else if (dist === 0) {
    vy = clear;                       // dropped exactly on the waypoint: park it below
  }
  const sc = legZoomScale() || 1;
  label.a = (vx * frame.dx + vy * frame.dy) / sc;
  label.p = (vx * frame.nx + vy * frame.ny) / sc;
  label._m = 1;
  delete label._default;
  leg[key] = label;
}
function hitCumLabelRet(px, py) {
  if (!showReturn) return null;          // return kite only drawn with the return path
  if (!showCumTime) return null;         // draw.js nests it in showCumTime too
  const { halfL, halfW } = _cumKiteHalfDims();
  for (let i = 0; i < state.legs.length; i++) {
    if (typeof legDirVisible === 'function' && !legDirVisible(i)) continue;
    if (!legAllowsReturn(i)) continue;
    const c = cumLabelRetCenter(i);
    const retEnds = (typeof legScreenEnds === 'function') ? legScreenEnds(i) : null;
    const a = retEnds ? retEnds.a : (state.waypoints[i] && proj(state.waypoints[i]));   // return kite points toward A
    if (c && a && _pointInKiteBox(px, py, c.x, c.y, a.x, a.y, halfL, halfW)) return { i };
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
  const speedKey = key === 'flightSpeed' || key === 'outboundSpeed';
  // A typed speed is the pilot's own number even when it matches what was already
  // there, so pin it manual ahead of the no-change early return -- otherwise typing
  // the current default would leave the leg still tracking the default. Pin only the
  // direction that was edited: the backward walk below would otherwise let one
  // return-speed keystroke pin every leg's FORWARD speed too.
  if (speedKey && typeof markLegSpeedManual === 'function') markLegSpeedManual(state.legs[i], key);
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
    if (speedKey && typeof markLegSpeedManual === 'function') markLegSpeedManual(state.legs[j], key);
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
  // Where the report points sit on the ground, before the splice renumbers legs.
  const rpGeo = (typeof captureReportPointGeo === 'function') ? captureReportPointGeo() : [];
  state.waypoints.splice(k, 1);
  if (state.legs.length) {
    state.legs.splice(Math.min(k, state.legs.length - 1), 1);
  }
  if (ccName && Array.isArray(state.notes) &&
      !state.waypoints.some(w => canonicalNavWaypointName(w && w.name) === ccName)) {
    if (typeof unsuppressCommChange === 'function') unsuppressCommChange(ccName);
  }
  // Drop any comm-change callout that no longer has a waypoint under it. Matching on the
  // deleted waypoint's CURRENT name is not enough: a waypoint dropped onto another one
  // adopts that one's name during the drag, so by the time it is deleted here it no longer
  // answers to the comm-change point it was seeded from -- and its callout was left behind
  // on a point with no waypoint at all. This asks the same question the seeder asks (is
  // there still a waypoint AT that point), so the name it happens to carry does not matter.
  if (typeof pruneStaleCommChangeNotes === 'function') pruneStaleCommChangeNotes();
  // Re-anchor BEFORE syncLegs: its index prune would drop an anchor that is only
  // temporarily out of range (its segment usually still exists under a new index).
  // waypoints and legs are already consistent here, so nearest-leg is well defined.
  if (typeof reanchorReportPoints === 'function') reanchorReportPoints(rpGeo);
  syncLegs();
}

function splitLegCopy(source) {
  const d = _defaultLegLabels();
  // Same tunable seed newLeg() uses, rather than two more literal 90s here.
  const seed = (typeof _defaultLegSpeedKt === 'function') ? _defaultLegSpeedKt() : 90;
  const leg = {
    inboundAltitude: source ? source.inboundAltitude : NaN,
    outboundAltitude: source ? source.outboundAltitude : NaN,
    flightSpeed: source && Number.isFinite(source.flightSpeed) && source.flightSpeed > 0
      ? source.flightSpeed : seed,
    outboundSpeed: source && Number.isFinite(source.outboundSpeed) && source.outboundSpeed > 0
      ? source.outboundSpeed
      : (source && Number.isFinite(source.flightSpeed) && source.flightSpeed > 0
        ? source.flightSpeed : seed),
    inLabel: d.inLabel,
    outLabel: d.outLabel,
    cumLabel: d.cumLabel,
    cumLabelRet: d.cumLabelRet,
  };
  if (source && source.vorRef) leg.vorRef = source.vorRef;
  for (const key of ['_legAltitudeInboundBlocked', '_legAltitudeOutboundBlocked', '_legAltitudeOneWay']) {
    if (source && source[key]) leg[key] = source[key];
  }
  // If the source leg was auto (charted from the dataset, not hand-edited), keep
  // the new sub-legs auto so they re-derive their own charted altitudes for the
  // new endpoint pairs instead of freezing at the parent's value.
  if (!source || source._legAltitudeAuto) leg._legAltitudeAuto = 1;
  // Same for speed, per direction: split a leg the pilot never typed a speed on and
  // both halves keep following the default; split a 110 kt leg and they keep the 110.
  // (the leg above is a bare literal, so these are set, not deleted)
  if (!source || source._legSpeedAuto) leg._legSpeedAuto = 1;
  if (!source || source._legSpeedAutoRet) leg._legSpeedAutoRet = 1;
  return leg;
}

function splitLegAt(legIndex, latlng) {
  const i = Number(legIndex);
  if (!Number.isInteger(i) || i < 0 || i >= state.legs.length) return false;
  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return false;
  if (!state.waypoints[i] || !state.waypoints[i + 1]) return false;

  const source = state.legs[i];
  const inserted = { lat: r5(latlng.lat), lng: r5(latlng.lng), name: '', _defaultWpName: 1 };
  // Capture ground positions first: the splices keep legs.length ===
  // waypoints.length - 1, so syncLegs never runs here and every anchor above the
  // split would otherwise keep an index that now points one leg too low.
  const rpGeo = (typeof captureReportPointGeo === 'function') ? captureReportPointGeo() : [];
  state.waypoints.splice(i + 1, 0, inserted);
  state.legs.splice(i, 1, splitLegCopy(source), splitLegCopy(source));
  if (typeof reanchorReportPoints === 'function') reanchorReportPoints(rpGeo);
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

// Resolve a waypoint to its nearest reference point
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

// Inspector waypoint-name reset handler. Restores the
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

// Build toolbar — same naming rules as `resetWpName` for
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

// Chart points (nav waypoints, airfields) had no way onto the route: clicking one
// opened an info panel and stopped there, so the only route-building path was the
// add tool, two levels into a menu. This puts the action where the user already is.
function appendAddToRouteButton(body, pt) {
  if (!pt || !Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) return;
  const empty = !state.waypoints || !state.waypoints.length;
  const already = typeof routeOccupiesPoint === 'function' && routeOccupiesPoint(pt);
  const btn = document.createElement('button');
  btn.className = 'insp-btn';
  btn.id = 'insp-add-to-route';
  btn.textContent = already ? (S.alreadyOnRoute || '✓ Already on the route')
    : empty ? (S.startRouteHere || '➕ Start route here')
            : (S.addToRoute || '➕ Add to route');
  // Adding from the inspector is the same edit as adding by tap, so the lock reaches it too --
  // shown as unavailable rather than refusing after the press.
  const locked = typeof routeEditLocked === 'function' && routeEditLocked();
  // No third-pass guard here: a leg that would fly a track a third time always ends on a
  // point already in the route, which this button refuses anyway.
  btn.disabled = !!already || locked;
  btn.onclick = () => {
    if (already || locked) return;
    const prevTail = state.waypoints[state.waypoints.length - 1];
    state.waypoints.push({ lat: r5(pt.lat), lng: r5(pt.lng), name: pt.name || '' });
    syncLegs();
    state.selected = { type: 'wp', index: state.waypoints.length - 1 };
    draw();
    showInspector();
    // Same corridor treatment as a map tap: adding by button must not produce a different
    // route from adding by tap.
    if (prevTail) autoRouteSpliceAfterAdd(prevTail, state.waypoints[state.waypoints.length - 1]);
  };
  body.appendChild(btn);
}

// Published ENR 4.1 detail for a station, as compact key/value lines: what it is,
// what to tune, when it runs, how far it is usable, and its limits. Shown on the
// STATION's own inspector (select the VOR on the map) — that is where facts about
// the facility belong, rather than on whichever waypoint happens to be selected.
function appendVorAipInfo(body, v) {
  if (!v) return;
  const info = document.createElement('div');
  info.className = 'vor-aip-info';
  const line = (k, t, cls) => {
    if (!t) return;
    const d = document.createElement('div');
    d.className = 'vor-aip-line' + (cls ? ' ' + cls : '');
    const kk = document.createElement('span');
    kk.className = 'vor-aip-key';
    kk.textContent = k;
    const vv = document.createElement('span');
    vv.className = 'vor-aip-val';
    vv.textContent = t;
    d.append(kk, vv);
    info.appendChild(d);
  };
  line(S.vorInfoType || 'Type', v.type || '');
  // No frequency here: the editable Frequency row above already shows it. The DME
  // channel has no other home, so it stays.
  line(S.vorInfoChannel || 'Channel', v.ch ? 'CH ' + v.ch : '');
  line(S.vorInfoHours || 'Hours', v.hours || '');
  line(S.vorInfoRange || 'Range',
    v.coverageNm ? v.coverageNm + ' NM' : (S.vorInfoRangeNone || 'not published'));
  if (Number.isFinite(v.elevFt)) line(S.vorInfoElev || 'DME antenna', v.elevFt + ' ft');
  if (v.remarks && v.remarks !== 'Nil') line(S.vorInfoLimits || 'Limits', v.remarks);
  if (info.childNodes.length) body.appendChild(info);
}

// Shared inspector-only VOR selector + "From <VOR>  R-xxx° / yy.y NM" readout.
// Changing this selector never writes `vorRef` or localStorage; it only changes
// the active inspector readout.
function appendVorRadialRow(body, lat, lng) {
  if (typeof vorByIdent !== 'function' || typeof vorRadialDme !== 'function') return;
  if (vors === null && typeof loadVors === 'function') {
    loadVors().then(() => {
      // Data-arrival refresh only — must not raise a panel the flight plan hid.
      refreshInspectorIfVisible();
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
  // Out-of-range notice only: it depends on THIS point's distance, so it belongs
  // here. Everything else about the station lives on the station's own inspector.
  const info = document.createElement('div');
  info.className = 'vor-aip-info';
  const renderInfo = (v) => {
    info.textContent = '';
    if (!v) return;
    const rd2 = vorRadialDme(v, lat, lng);
    if (rd2 && v.coverageNm && Number(rd2.dme) > v.coverageNm) {
      const w = document.createElement('div');
      w.className = 'vor-aip-line vor-aip-warn';
      w.textContent = (S.vorInfoOutOfRange ||
        'This point is {dme} NM out — beyond the published {cov} NM coverage.')
        .replace('{dme}', rd2.dme).replace('{cov}', v.coverageNm);
      info.appendChild(w);
    }
  };
  const render = () => {
    const v = vorByIdent(sel.value);
    const rd = v ? vorRadialDme(v, lat, lng) : null;
    // A DME-only facility has no radial to give — show distance only rather than
    // inventing a bearing from it.
    val.textContent = rd ? (v.dmeOnly ? S.vorDmeOnlyReadout(rd.dme) : S.vorRadialDme(rd.radial, rd.dme)) : '';
    val.title = v && rd ? S.vorFrom(v.ident) : '';
    renderInfo(v);
  };
  populateInspectorVorSelect(sel, inspectorVorIdent());
  sel.onchange = () => {
    window.inspectorVorRef = sel.value || '';
    render();
    // The published-coverage ring is canvas ink keyed on this override, so changing it
    // has to repaint. Without this the ring kept showing the previous station until
    // something else happened to redraw.
    if (typeof draw === 'function') draw();
  };
  controls.append(sel, val);
  row.append(label, controls);
  render();
  body.appendChild(row);
  body.appendChild(info);
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
// A frequency a NOTAM states outright goes into the field's own row, ringed red, rather
// than standing in a row of its own beside it. Two rows for one frequency is two answers to
// one question, and the pilot has to work out which to call; one row ringed red is the
// answer, marked as not-the-published-one. The published value stays in the row's title,
// and the id says which NOTAM to read.
//
// Where the AIP publishes nothing -- Haifa's clearance -- the NOTAM CREATES the row. That is
// the case a value-substitution scheme cannot serve, and the reason this is computed at
// render rather than merged into airfields.json: the row exists exactly as long as the
// NOTAM is in the feed, and needs nothing edited back when it goes.
function airfieldFreqChangeFor(af, service) {
  if (typeof airfieldFreqChanges !== 'function') return null;
  if (typeof tune === 'function' && tune('featureNotamFreqRows') === false) return null;
  return airfieldFreqChanges(af && af.name).find(c => c.service === service) || null;
}

function airfieldFreqNotamTitle(change, published) {
  return S.freqNotamRowTitle
    ? S.freqNotamRowTitle(change.id, published)
    : 'NOTAM ' + change.id + (published ? ' \u00b7 AIP ' + published : '');
}

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
  const configure = opts.configure || (typeof commConfigureFreqInput === 'function' ? commConfigureFreqInput : null);
  const normalize = opts.normalize || (typeof commNormalizeFreqInput === 'function' ? commNormalizeFreqInput : null);
  if (configure) configure(inp);
  else { inp.type = 'number'; inp.inputMode = 'decimal'; inp.step = '0.005'; }
  inp.value = opts.value || opts.def || '';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'commchange-freq-reset';
  reset.textContent = '↻';
  reset.title = S.resetFreqOverride || S.sliderReset || 'Reset to default';
  const norm = () => (normalize ? normalize(inp.value) : String(inp.value || '').trim());
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

// --- airspace helpers --------------------------------------------------------
// Is this area in force at this moment? Only where the printed schedule says so without
// interpretation: "H24" always, and a "Sun 04:00 (UTCW) - Thu 19:00 (UTCW)" window read
// in UTC. Anything resting on sunrise/sunset or on the holiday calendar returns null --
// unknown, and shown as nothing. A confident "not active now" that is wrong is the one
// answer here that could put an aeroplane somewhere it must not be.
const AIRSPACE_DAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function airspaceActiveNow(a, nowDate) {
  const hours = (a && a.hours) || [];
  if (!hours.length) return null;
  if (hours.some(h => /^H24$/i.test(h))) return true;
  const now = nowDate || new Date();
  let known = false;
  for (const h of hours) {
    const m = /^(\w{3})\s+(\d{1,2}):(\d{2})[^-]*-\s*(\w{3})\s+(\d{1,2}):(\d{2})/.exec(h);
    if (!m) continue;                       // SR/SS and the like: not decidable here
    known = true;
    const d0 = AIRSPACE_DAY[m[1].toLowerCase()];
    const d1 = AIRSPACE_DAY[m[4].toLowerCase()];
    if (d0 === undefined || d1 === undefined) continue;
    const minsOf = (d, hh, mm) => d * 1440 + Number(hh) * 60 + Number(mm);
    const from = minsOf(d0, m[2], m[3]);
    const to = minsOf(d1, m[5], m[6]);
    const cur = now.getUTCDay() * 1440 + now.getUTCHours() * 60 + now.getUTCMinutes();
    const inside = from <= to ? (cur >= from && cur <= to) : (cur >= from || cur <= to);
    if (inside) return true;
  }
  return known ? false : null;
}
window.airspaceActiveNow = airspaceActiveNow;

// How the planned route stands against this area's limits. Lateral crossing alone means
// little: the leg may be well above or below it.
function airspaceRouteVerdict(a) {
  if (typeof state === 'undefined' || !state.legs || !state.legs.length) return '';
  if (typeof airspaceContains !== 'function') return '';
  let crosses = false;
  let lowest = null, highest = null;
  for (let i = 0; i < state.legs.length; i++) {
    const w1 = state.waypoints[i], w2 = state.waypoints[i + 1];
    if (!w1 || !w2) continue;
    // Sample along the leg: a leg can pass through an area without either end being in it.
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const at = { lat: w1.lat + (w2.lat - w1.lat) * t, lng: w1.lng + (w2.lng - w1.lng) * t };
      // Geometry, not visibility: this answer is about the route, and it must read the same
      // whether or not the layer happens to be switched on.
      if (!airspaceContains(a, at)) continue;
      crosses = true;
      const alt = typeof legAltitudeFt === 'function' ? legAltitudeFt(state.legs[i]) : null;
      if (Number.isFinite(alt)) {
        lowest = lowest === null ? alt : Math.min(lowest, alt);
        highest = highest === null ? alt : Math.max(highest, alt);
      }
      break;
    }
  }
  if (!crosses) return S.airspaceRouteClear || 'clear of it';
  if (lowest === null) return S.airspaceRouteCrossesNoAlt || 'crosses it — no planned altitude';
  const upper = a.upperFt === null || a.upperFt === undefined ? Infinity : a.upperFt;
  const lower = a.lowerFt || 0;
  if (highest < lower) {
    return (S.airspaceRouteBelow || 'crosses it, below the base') +
      ' (' + (lower - highest) + ' ' + (S.unitFeet || 'ft') + ')';
  }
  if (lowest > upper) {
    return (S.airspaceRouteAbove || 'crosses it, above the top') +
      ' (' + (lowest - upper) + ' ' + (S.unitFeet || 'ft') + ')';
  }
  return S.airspaceRouteInside || 'crosses it, inside its limits';
}

// Distance from the live position (or the map centre when there is no fix) to the nearest
// corner of the area, and roughly which way it lies.
function airspaceDistanceText(a) {
  const fix = (typeof gpsLastFix === 'function' && gpsLastFix()) || null;
  const from = fix || (typeof map !== 'undefined' ? map.getCenter() : null);
  if (!from || !Array.isArray(a.ring)) return '';
  const here = { lat: from.lat, lng: from.lng !== undefined ? from.lng : from.lon };
  let best = null;
  for (const p of a.ring) {
    const g = geo(here, { lat: p[0], lng: p[1] });      // the app's own great-circle helper
    if (!best || g.dist < best.dist) best = g;
  }
  if (!best) return '';
  return best.dist.toFixed(best.dist < 10 ? 1 : 0) + ' ' + (S.unitNm || 'nm')
    + ' · ' + String(Math.round(best.brg)).padStart(3, '0') + '°';
}

// NOTAMs that name this area. Same idea as the bubble matcher: the identifier is what the
// NOTAM text uses, so match on it rather than on geometry.
function airspaceNotams(a) {
  const list = (typeof notams !== 'undefined' && Array.isArray(notams)) ? notams : [];
  if (!list.length || !a || !a.id) return [];
  const id = String(a.id).toUpperCase();
  const rx = new RegExp('\\b' + id.replace(/[^A-Z0-9]/g, '') + '\\b');
  return list.filter(n => rx.test(String((n && (n.text || n.raw || n.body)) || '').toUpperCase()));
}

// Density altitude, beside the elevation it corrects. On a hot afternoon at Haifa, Megiddo
// or Masada the aeroplane behaves as though the field were thousands of feet higher, and
// nothing in an elevation figure says so. The slider runs a day ahead on the hourly
// forecast, because the useful question is rarely "what is it now" -- it is "what time can
// I get out of here".
function appendAirfieldDensityAltitude(body, af) {
  if (typeof tune === 'function' && tune('featureDensityAltitude') === false) return;
  const DA = window.NavAid && NavAid.da;
  if (!DA) return;
  // Five of the fields in the dataset have no published elevation (Habonim, Ein Vered,
  // Arad, Gvulot, Kedem). Without one there is no density altitude at all -- so where the
  // AIP is silent the forecast's own terrain height stands in, and the panel says which of
  // the two it used rather than presenting a model figure as a surveyed one.
  let elev = Number(af.elev_ft);
  let elevFromModel = false;
  if (!Number.isFinite(elev)) {
    elev = NaN;
    elevFromModel = true;
  }

  const sec = document.createElement('div');
  // A group of its own inside Weather: the slider, the figure and the conditions it was
  // computed from are one thing, and the observation below them is another.
  sec.className = 'da-section da-group';
  const valRow = textRow(S.densityAltitude || 'Density altitude', '—');
  valRow.classList.add('da-row');
  const valEl = valRow.querySelector('.val');
  valRow.title = S.densityAltitudeTitle || '';
  sec.appendChild(valRow);

  // What it was computed from, and where those numbers came from. A density altitude with
  // no provenance is a number a pilot cannot argue with, which is the wrong kind of number.
  const srcRow = textRow(S.daConditions || 'Temp · QNH', '—');
  srcRow.classList.add('da-src-row');
  const srcEl = srcRow.querySelector('.val');
  sec.appendChild(srcRow);

  const maxH = Math.round((typeof tune === 'function' && tune('daForecastHours')) || 24);
  const timeRow = document.createElement('div');
  timeRow.className = 'row da-time-row';
  // The slider sits at the top of the Weather box, where an unlabelled control reads as
  // though it moved the whole box -- the METAR below it included. It says what it moves.
  const timeLbl = document.createElement('label');
  timeLbl.textContent = S.daWhen || 'Density altitude at';
  timeRow.appendChild(timeLbl);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(maxH);
  slider.step = '1';
  slider.value = '0';
  slider.className = 'da-time';
  slider.setAttribute('aria-label', S.daWhen || 'Valid time');
  const when = document.createElement('span');
  when.className = 'val da-when';
  when.dir = 'ltr';                 // a clock is a clock in both languages
  timeRow.append(slider, when);
  // The slider goes ABOVE the numbers it changes: a control under its own read-out is a
  // control the pilot scrolls past to find, having already read a figure for the wrong hour.
  sec.insertBefore(timeRow, sec.firstChild);
  body.appendChild(sec);

  // "+21ש · 08-26 12:00Z" in Hebrew is one string with an RTL letter in the middle, and the
  // bidi algorithm hands the digits after it to that letter's run: the label rendered as
  // "12:00 08-26 · ש21+" -- a different date and a different hour. Each part goes in its own
  // <bdi> so the runs cannot reach into each other, whatever the language.
  const fmtWhenText = (h) => (typeof notamTimeLabel === 'function' ? notamTimeLabel(h)
    : (h ? '+' + h + 'h' : (S.daNow || 'now')));
  const setWhen = (h) => {
    when.textContent = '';
    const parts = String(fmtWhenText(h)).split(' · ');
    parts.forEach((part, i) => {
      if (i) when.appendChild(document.createTextNode(' · '));
      const bdi = document.createElement('bdi');
      bdi.textContent = part;
      when.appendChild(bdi);
    });
  };

  // The observation beats the model at hour zero: LLBG's own METAR carries the temperature
  // and QNH measured on the field, and the forecast is a grid interpolation of it.
  let metar = null;
  let hours = null;

  function render() {
    if (elevFromModel) {
      const m = DA.modelElevationFt(af.lat, af.lng);
      if (Number.isFinite(m)) elev = Math.round(m);
    }
    const h = parseInt(slider.value, 10) || 0;
    setWhen(h);
    let tempC = null, qnh = null, from = '';
    const metarAgeMin = metar && metar.obsTime
      ? (Date.now() - Number(metar.obsTime) * 1000) / 60000 : null;
    // No obsTime, no claim: an observation of unknown age was being treated as current
    // forever, so a station that stopped reporting kept feeding "now" into the density
    // altitude. Unknown age falls through to the forecast, which at least knows what hour
    // it is describing.
    const metarFresh = metar && metarAgeMin !== null
      && metarAgeMin <= ((typeof tune === 'function' && tune('daMetarMaxAgeMin')) || 90);
    if (!h && metarFresh && Number.isFinite(Number(metar.temp))) {
      tempC = Number(metar.temp);
      qnh = Number.isFinite(Number(metar.altim)) ? Number(metar.altim) : null;
      // Say how old it is once it stops being "now": a two-hour-old observation is still
      // the best thing available, but the panel should not present it as current.
      from = (S.daFromMetar || 'METAR')
        + (metarAgeMin !== null && metarAgeMin >= 30
          ? ' ' + (typeof S.daAgeMin === 'function' ? S.daAgeMin(Math.round(metarAgeMin))
            : '(' + Math.round(metarAgeMin) + ' min)') : '');
    } else {
      const sample = DA.sampleAt(hours, h);
      if (sample) {
        tempC = sample.tempC;
        qnh = sample.qnh;
        from = S.daFromForecast || 'forecast';
      }
    }
    if (!Number.isFinite(elev)) {
      // The forecast has not answered yet, or answered without a terrain height.
      valEl.textContent = '—';
      srcEl.textContent = S.daNoElev || 'no field elevation';
      valRow.classList.remove('da-warn');
      return;
    }
    if (tempC === null) {
      // No observation and no forecast: say so rather than quietly computing a standard
      // day, which would read as a measurement and be wrong by thousands of feet.
      valEl.textContent = '—';
      srcEl.textContent = S.daNoData || 'no temperature available';
      valRow.classList.remove('da-warn');
      return;
    }
    let qnhAssumed = false;
    if (qnh === null) { qnh = DA.HPA_STD; qnhAssumed = true; }
    const da = DA.densityAltFt(elev, qnh, tempC);
    valEl.textContent = Math.round(da).toLocaleString() + ' ft';
    srcEl.textContent = Math.round(tempC) + ' °C · ' + fmtQnhBoth(qnh)
      + (qnhAssumed ? ' ' + (S.daQnhAssumed || '(standard)') : '')
      + (from ? ' · ' + from : '')
      + (elevFromModel ? ' · ' + (S.daElevFromModel || 'terrain elevation') : '');
    // The threshold is a rule of thumb, not a limit: past it the book figures stop being
    // the figures, and that is worth colouring.
    const over = (typeof tune === 'function' && tune('daWarnAboveElevFt')) || 2000;
    valRow.classList.toggle('da-warn', da > elev + over);
  }

  slider.oninput = render;
  render();

  // Both sources arrive late; each redraws what it can.
  const icao = String(af.name || '').toUpperCase();
  if (/^[A-Z]{4}$/.test(icao) && typeof fetchAirfieldWx === 'function') {
    Promise.resolve(fetchAirfieldWx(icao)).then((wx) => {
      metar = (wx && wx.metar) || null;
      render();
    }).catch(() => {});
  }
  Promise.resolve(DA.forecast(af.lat, af.lng)).then((h) => {
    hours = h;
    render();
  }).catch(() => {});
}

function appendAirfieldComms(body, af) {
  const sec = document.createElement('div');
  // Its own class, not the weather section's: `.wx-section` is what the weather tests and
  // styles select, and a second element wearing it makes every one of those selectors
  // ambiguous.
  sec.className = 'insp-frame comm-section';
  const head = document.createElement('div');
  head.className = 'insp-frame-head';
  const lbl = document.createElement('span');
  lbl.textContent = S.commTitle || 'Communication';
  head.appendChild(lbl);
  sec.appendChild(head);
  appendAirfieldFrequencyRows(sec, af);
  // A field with no published frequency gets no empty frame.
  if (sec.querySelectorAll('.row').length) body.appendChild(sec);
}


function appendAirfieldFrequencyRows(body, af) {
  const id = af && Object.prototype.hasOwnProperty.call(AIRFIELD_CALL_SIGN_IDS, af.name)
    ? AIRFIELD_CALL_SIGN_IDS[af.name] : null;
  const towerChange = airfieldFreqChangeFor(af, 'tower');
  if (id) {
    // commCallSignTemplateFreq already answers with the NOTAM's frequency when one is in
    // force -- that is what the pilot calls and what reset returns to. The published one is
    // not lost: it is in the row's title.
    const published = typeof commCallSignPublishedFreq === 'function' ? commCallSignPublishedFreq(id) : '';
    const template = typeof commCallSignTemplateFreq === 'function' ? commCallSignTemplateFreq(id) : published;
    const override = () => !!(typeof commCallSignOverrideFreq === 'function' && commCallSignOverrideFreq(id));
    const row = freqEditRow(S.primary || 'Primary', {
      value: override() && typeof commCallSignEffectiveFreq === 'function'
        ? commCallSignEffectiveFreq(id) : template,
      def: template, rowClass: 'primary-row',
      isOverride: override,
      commit: n => typeof commApplyCallSignFreqOverride === 'function' ? commApplyCallSignFreqOverride(id, n) : n,
      onReset: () => { if (typeof commResetCallSignFreqOverride === 'function') commResetCallSignFreqOverride(id); return template; },
    });
    if (towerChange) {
      row.classList.add('freq-notam-changed');
      row.title = airfieldFreqNotamTitle(towerChange, published);
    }
    body.appendChild(row);
  } else {
    const primary = airfieldPrimaryText(af);
    if (primary) {
      const row = textRow(S.primary || 'Primary',
        towerChange ? towerChange.freq + ' MHz' : primary);
      row.classList.add('primary-row');
      if (towerChange) {
        row.classList.add('freq-notam-changed');
        row.title = airfieldFreqNotamTitle(towerChange, primary);
      }
      body.appendChild(row);
    } else {
      refreshAirfieldInspectorAfterCommCatalog(af);
    }
  }
  // Clearance / ATIS — one editable numeric field per labelled part (#freq).
  const appendFieldParts = (field, label, rowClass) => {
    const parts = typeof airfieldFieldParts === 'function' ? airfieldFieldParts(af, field) : [];
    const chg = field === 'clearance' ? airfieldFreqChangeFor(af, 'clearance') : null;
    if (!parts.length && chg) {
      // Nothing published, but a NOTAM installed one: the row is the NOTAM's.
      const row = freqEditRow(label, {
        value: chg.freq, def: chg.freq, rowClass,
        isOverride: () => false, commit: n => n, onReset: () => chg.freq,
      });
      row.classList.add('freq-notam-changed');
      row.title = airfieldFreqNotamTitle(chg, '');
      body.appendChild(row);
      return;
    }
    if (!parts.length) {
      // Nothing published: no row. It used to print "Clearance — None" so every airfield
      // read the same way, which was defensible as a loose list and stopped being so inside
      // a titled Communication frame -- there it reads as a service the field has, that
      // happens to be off. Haifa publishes a tower and an ATIS and no clearance at all; the
      // panel now says exactly that by not mentioning one.
      return;
    }
    for (const p of parts) {
      const rowLabel = p.label ? label + ' ' + p.label : label;
      // Only the first part can carry a change: the NOTAMs seen state one frequency per
      // service, and guessing which of "Arrival / Departure" they meant would be a guess.
      const c = (chg && p === parts[0]) ? chg : null;
      const published = p.def;
      // With a NOTAM in force its frequency IS the default -- that is what reset returns to,
      // and what the pilot calls. The published one is not lost; it is in the row's title.
      const def = c ? c.freq : published;
      const row = freqEditRow(rowLabel, {
        value: p.overridden ? p.freq : def, def, rowClass,
        isOverride: () => p.overridden,
        commit: n => { setAirfieldFreqOverride(p.key, n === def ? '' : n); p.freq = n; p.overridden = n !== def; return n; },
        onReset: () => { setAirfieldFreqOverride(p.key, ''); p.freq = def; p.overridden = false; return def; },
      });
      if (c) {
        row.classList.add('freq-notam-changed');
        row.title = airfieldFreqNotamTitle(c, published);
      }
      body.appendChild(row);
    }
  };
  appendFieldParts('clearance', S.clearance || 'Clearance', 'clearance-row');
  appendFieldParts('atis', S.atis || 'ATIS', 'atis-row');


  // A NOTAM about this field's frequencies. A POINTER, never a value: the rows above keep
  // showing what the AIP publishes, and nothing is read out of the NOTAM text. A NOTAM
  // frequency is true today, not in general, and a mis-parse would put a pilot on the wrong
  // frequency -- worse than making them read two lines. So this says "there is one, here it
  // is" and the pilot decides.
  const freqNotams = (typeof airfieldFreqNotams === 'function')
    ? airfieldFreqNotams(af && af.name) : [];
  if (freqNotams.length) {
    const row = document.createElement('div');
    row.className = 'insp-row freq-notam-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'freq-notam-btn';
    btn.textContent = '\u26A0 ' + (S.freqNotamNote
      ? S.freqNotamNote(freqNotams.map(n => n.id))
      : 'Frequency NOTAM: ' + freqNotams.map(n => n.id).join(', '));
    btn.title = freqNotams.map(n => n.id).join(', ');
    btn.onclick = () => {
      // Reuse the existing paths: flash it on the map if it is drawn, else open the list.
      if (typeof flashNotam === 'function') flashNotam(freqNotams[0].id);
      // The array of NOTAM OBJECTS, as every other caller passes -- an id string falls
      // through and lists the whole feed, which is the opposite of a pointer. All of this
      // field's frequency NOTAMs, not just the first: if there are two, both are the answer.
      if (typeof showNotamModal === 'function') showNotamModal(freqNotams);
    };
    row.appendChild(btn);
    body.appendChild(row);
  }
}

const SATELLITE_TILE_SIZE = 256;
const SATELLITE_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/' +
  'World_Imagery/MapServer/tile/';

function clampSatelliteZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return tune('satelliteExpandedZoom');
  return Math.max(tune('satelliteMinZoom'), Math.min(tune('satelliteMaxZoom'), Math.round(n)));
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

// Plain-text attribution from a (possibly HTML) Leaflet attribution string.
// DOMParser extracts text without executing anything — avoids fragile regex
// tag-stripping (CodeQL: incomplete multi-character sanitization).
function attributionText(html) {
  try {
    return (new DOMParser().parseFromString(String(html), 'text/html')
      .body.textContent || '').trim();
  } catch (e) {
    return '';
  }
}
function buildSatelliteSnippet(point, opts = {}) {
  const lat = Number(point && point.lat);
  const lng = Number(point && point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const expanded = !!opts.expanded;
  // Optional base layer (CVFR / Navigation / Satellite / …) — defaults to the
  // satellite imagery. Any Leaflet tileLayer from `layers` works via
  // tileLayerUrl(); chart layers cap out lower (maxNativeZoom 12–13).
  const layer = opts.layer || (typeof layers !== 'undefined' ? layers.Satellite : null);
  const layerMaxZoom = (layer && layer.options &&
    (layer.options.maxNativeZoom || layer.options.maxZoom)) || tune('satellitePreviewZoom');
  // Non-expanded previews honour an explicit opts.width/height (mosaic size
  // slider), keeping the default aspect ratio.
  const width = expanded ? Math.max(300, Math.min(620, window.innerWidth - 64))
    : (Number.isFinite(opts.width) ? opts.width : tune('satellitePreviewWidthPx'));
  const height = expanded ? Math.max(220, Math.min(420, window.innerHeight - 180))
    : (Number.isFinite(opts.height) ? opts.height : tune('satellitePreviewHeightPx'));
  // Non-expanded previews honour an explicit opts.zoom (mosaic zoom slider),
  // capped at the layer's max native zoom.
  const baseZoom = Number.isFinite(opts.zoom) ? opts.zoom : tune('satellitePreviewZoom');
  const z = expanded ? clampSatelliteZoom(opts.zoom)
    : Math.max(1, Math.min(baseZoom, layerMaxZoom));
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
      img.src = (layer && typeof tileLayerUrl === 'function')
        ? tileLayerUrl(layer, { x: tileX, y: tileY, z })
        : satelliteTileUrl(z, tileX, tileY);
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
  attr.textContent = (layer && layer.options && layer.options.attribution)
    ? attributionText(layer.options.attribution)
    : (S.satelliteAttribution || 'Imagery © Esri');
  snippet.appendChild(attr);
  return snippet;
}

const SATELLITE_MODAL_CHART_LAYERS = ['CVFR', 'Navigation', 'Low Alt', 'Helicopters'];

function satelliteModalIsChartLayer(name) {
  return SATELLITE_MODAL_CHART_LAYERS.indexOf(name) !== -1;
}

function satelliteModalLayerZoomBounds(name, layer) {
  const modalMin = tune('satelliteMinZoom');
  const modalMax = tune('satelliteMaxZoom');
  if (!satelliteModalIsChartLayer(name) || !layer) {
    return { minZoom: modalMin, maxZoom: modalMax };
  }
  const nativeMax = Number(layer.options && (layer.options.maxNativeZoom || layer.options.maxZoom));
  if (!Number.isFinite(nativeMax)) return { minZoom: modalMin, maxZoom: modalMax };
  const maxZoom = Math.min(modalMax, nativeMax + tune('satelliteChartOverscale'));
  return {
    minZoom: Math.min(modalMin, maxZoom),
    maxZoom,
  };
}

// Fresh, independent copies of the main map's base layers. Leaflet attaches a
// tile layer to a single map, so the modal must NOT reuse the live instances
// from core.js (that would yank them off the main map) — clone url + options.
function satelliteModalLayers() {
  const out = {};
  if (typeof layers !== 'object' || !layers) return out;
  for (const nm in layers) {
    if (typeof layerOffered === 'function' && !layerOffered(nm)) continue;
    const src = layers[nm];
    if (src && src._url) {
      const opts = Object.assign({}, src.options);
      if (SATELLITE_MODAL_CHART_LAYERS.indexOf(nm) !== -1) {
        opts.maxZoom = satelliteModalLayerZoomBounds(nm, src).maxZoom;
      }
      out[nm] = L.tileLayer(src._url, opts);
    }
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
        const z = typeof zoom === 'function' ? zoom() : zoom;
        lmap.setView([point.lat, point.lng], z);
      });
      L.DomEvent.disableClickPropagation(c);
      return c;
    },
  });
  return new Ctl();
}

// Live zoom readout for the satellite modal, matching the main map's
// `z<level> \u00b7 <mult>\u00d7` box. Self-refreshes on zoom so it tracks both the
// zoom buttons and any layer-driven zoom clamp.
function satelliteZoomControl(lmap) {
  const Ctl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      const c = L.DomUtil.create('div', 'satellite-zoom-readout');
      c.dir = 'ltr';
      const refresh = () => { c.textContent = zoomReadoutText(lmap.getZoom()); };
      refresh();
      lmap.on('zoom', refresh);
      lmap.on('zoomend', refresh);
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
  // Only one satellite view at a time — a repeat open replaces the previous.
  document.querySelectorAll('.modal-back .satellite-preview-modal').forEach(box => {
    const back = box.closest('.modal-back');
    if (back && typeof back._navaidClose === 'function') back._navaidClose();
    else if (back) back.remove();
  });
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
    zoom: tune('satelliteExpandedZoom'),
    minZoom: tune('satelliteMinZoom'),
    maxZoom: tune('satelliteMaxZoom'),
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
  lmap.addControl(satelliteZoomControl(lmap));
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
  let activeLayerName = layerNames.find(nm => lmap.hasLayer(mLayers[nm])) || '';
  const applyLayerZoomBounds = name => {
    const bounds = satelliteModalLayerZoomBounds(name, mLayers[name]);
    const z = Math.max(bounds.minZoom, Math.min(bounds.maxZoom, lmap.getZoom()));
    if (z !== lmap.getZoom()) lmap.setZoom(z, { animate: false });
    lmap.setMinZoom(bounds.minZoom);
    lmap.setMaxZoom(bounds.maxZoom);
  };
  const resetZoomForActiveLayer = () => {
    const bounds = satelliteModalLayerZoomBounds(activeLayerName, mLayers[activeLayerName]);
    return satelliteModalIsChartLayer(activeLayerName)
      ? bounds.maxZoom
      : Math.max(bounds.minZoom, Math.min(bounds.maxZoom, tune('satelliteExpandedZoom')));
  };
  if (activeLayerName) applyLayerZoomBounds(activeLayerName);
  if (layerNames.length) {
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
          activeLayerName = sel.value;
          applyLayerZoomBounds(activeLayerName);
          lmap.addLayer(mLayers[activeLayerName]);
        });
        this._select = sel;
        return c;
      },
    });
    lmap.addControl(new LayerSelect());
  }
  lmap.addControl(satelliteResetControl(lmap, point, resetZoomForActiveLayer));
  // Marker on the waypoint so it stays findable after panning.
  L.circleMarker([point.lat, point.lng], {
    radius: tune('satelliteMarkerRadiusPx'), color: tune('satelliteMarkerColor'), weight: tune('satelliteMarkerWeightPx'), opacity: tune('satelliteMarkerAlpha'), fill: false,
    className: 'satellite-marker',
  }).addTo(lmap);
  setTimeout(() => { if (lmap) lmap.invalidateSize(); }, 0);
}

// Charts → "Satellite mosaic": a grid of static satellite previews, one per
// route waypoint, each labelled and clickable to open the full satellite modal.
function showRouteMosaicModal() {
  if (typeof createDraggableModal !== 'function') return;
  // Dedupe like the other chart modals — a second press must not stack a copy.
  if (typeof prepareChartModal === 'function') {
    if (!prepareChartModal('mosaic')) return;
  }
  const wps = (Array.isArray(state.waypoints) ? state.waypoints : [])
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w && Number.isFinite(Number(w.lat)) && Number.isFinite(Number(w.lng)));
  const modal = createDraggableModal(S.mosaicTitle || 'Route satellite mosaic',
    'modal wide route-mosaic-modal',
    typeof clearOpenChartModal === 'function' ? () => clearOpenChartModal('mosaic') : null,
    { nonBlocking: true, chartKind: 'mosaic' });
  const body = document.createElement('div');
  body.className = 'route-mosaic-body';

  // Toolbar: layer picker (CVFR / Satellite / …) + Print.
  const names = (typeof layers !== 'undefined')
    ? Object.keys(layers).filter(n => typeof layerOffered !== 'function' || layerOffered(n))
    : ['Satellite'];
  const bar = document.createElement('div');
  bar.className = 'route-mosaic-bar';
  const sel = document.createElement('select');
  sel.className = 'route-mosaic-layer'; sel.dir = 'ltr';
  sel.setAttribute('aria-label', S.mosaicLayer || 'Mosaic layer');
  for (const nm of names) {
    const o = document.createElement('option');
    o.value = nm;
    o.textContent = (S.layerLabels && S.layerLabels[nm]) || nm;
    if (nm === 'Satellite') o.selected = true;
    sel.appendChild(o);
  }
  bar.appendChild(sel);
  // Zoom slider — same close-in zoom applied to every preview.
  const zoomWrap = document.createElement('label');
  zoomWrap.className = 'route-mosaic-zoom';
  const zoomLbl = document.createElement('span');
  zoomLbl.textContent = S.mosaicZoom || 'Zoom';
  const zoom = document.createElement('input');
  zoom.type = 'range'; zoom.min = '8'; zoom.max = '18'; zoom.step = '1';
  zoom.value = String(tune('satellitePreviewZoom'));
  const zoomVal = document.createElement('span');
  zoomVal.className = 'route-mosaic-zoom-val';
  zoomVal.textContent = zoom.value;
  const zoomReset = document.createElement('button');
  zoomReset.type = 'button';
  zoomReset.className = 'route-mosaic-reset';
  zoomReset.textContent = '↻';
  zoomReset.title = S.mosaicResetZoom || 'Reset zoom';
  zoomReset.setAttribute('aria-label', zoomReset.title);
  zoomWrap.appendChild(zoomLbl); zoomWrap.appendChild(zoom); zoomWrap.appendChild(zoomVal);
  zoomWrap.appendChild(zoomReset);
  bar.appendChild(zoomWrap);
  // Size slider — scales every preview (keeps the default aspect ratio).
  const baseW = tune('satellitePreviewWidthPx');
  const baseH = tune('satellitePreviewHeightPx');
  const sizeWrap = document.createElement('label');
  sizeWrap.className = 'route-mosaic-size';
  const sizeLbl = document.createElement('span');
  sizeLbl.textContent = S.mosaicSize || 'Size';
  const size = document.createElement('input');
  size.type = 'range'; size.min = '140'; size.max = '440'; size.step = '2';
  size.value = String(baseW);
  const sizeVal = document.createElement('span');
  sizeVal.className = 'route-mosaic-zoom-val';
  sizeVal.textContent = size.value + 'px';
  const sizeReset = document.createElement('button');
  sizeReset.type = 'button';
  sizeReset.className = 'route-mosaic-reset';
  sizeReset.textContent = '↻';
  sizeReset.title = S.mosaicResetSize || 'Reset size';
  sizeReset.setAttribute('aria-label', sizeReset.title);
  sizeWrap.appendChild(sizeLbl); sizeWrap.appendChild(size); sizeWrap.appendChild(sizeVal);
  sizeWrap.appendChild(sizeReset);
  bar.appendChild(sizeWrap);
  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'route-mosaic-print';
  printBtn.textContent = S.mosaicPrint || '🖨 Print';
  let printing = false;
  printBtn.onclick = () => {
    if (printing) return;                 // ignore re-press while a print is in flight
    printing = true;
    document.body.classList.add('mosaic-print');
    const cleanup = () => {
      printing = false;
      document.body.classList.remove('mosaic-print');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 1000);   // fallback if afterprint never fires
  };
  bar.appendChild(printBtn);
  if (wps.length) body.appendChild(bar);

  // LTR sequence regardless of UI language so the route order + arrows read
  // left-to-right.
  const grid = document.createElement('div');
  grid.className = 'route-mosaic-grid'; grid.dir = 'ltr';

  const render = () => {
    grid.textContent = '';
    if (!wps.length) {
      const empty = document.createElement('div');
      empty.className = 'route-mosaic-empty';
      empty.textContent = S.mosaicEmpty || 'Add route waypoints first.';
      grid.appendChild(empty);
      return;
    }
    const layer = (typeof layers !== 'undefined') ? layers[sel.value] : null;
    const zoomLevel = parseInt(zoom.value, 10) || tune('satellitePreviewZoom');
    const cellW = parseInt(size.value, 10) || baseW;
    const cellH = Math.round(cellW * baseH / baseW);
    wps.forEach(({ w, i }, idx) => {
      const label = (typeof wpLabel === 'function') ? wpLabel(i) : (w.name || ('WP ' + (i + 1)));
      const point = { lat: Number(w.lat), lng: Number(w.lng) };
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'route-mosaic-cell';
      cell.style.width = cellW + 'px';
      cell.title = (S.mosaicOpen || 'Open satellite view') + ' — ' + label;
      const cap = document.createElement('div');
      cap.className = 'route-mosaic-label'; cap.dir = 'auto';
      cap.textContent = label;
      cell.appendChild(cap);
      const snippet = buildSatelliteSnippet(point, { layer, zoom: zoomLevel, width: cellW, height: cellH });
      if (snippet) cell.appendChild(snippet);
      cell.onclick = () => {
        if (typeof showSatellitePreviewModal === 'function') showSatellitePreviewModal(point, label);
      };
      grid.appendChild(cell);
      // Direction arrow between consecutive waypoints.
      if (idx < wps.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'route-mosaic-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '→';
        grid.appendChild(arrow);
      }
    });
  };
  // Cap the zoom slider to the selected layer's effective max (chart layers top
  // out at ~12–13) so the number can't keep climbing while the tiles don't.
  const syncZoomMax = () => {
    const layer = (typeof layers !== 'undefined') ? layers[sel.value] : null;
    const max = (layer && layer.options && (layer.options.maxNativeZoom || layer.options.maxZoom))
      || tune('satellitePreviewZoom');
    zoom.max = String(max);
    if (parseInt(zoom.value, 10) > max) zoom.value = String(max);
    zoomVal.textContent = zoom.value;
  };
  sel.onchange = () => { syncZoomMax(); render(); };
  zoom.oninput = () => { zoomVal.textContent = zoom.value; render(); };
  size.oninput = () => { sizeVal.textContent = size.value + 'px'; render(); };
  zoomReset.onclick = () => {
    zoom.value = String(tune('satellitePreviewZoom'));
    syncZoomMax();                        // re-clamp to the current layer's max
    zoomVal.textContent = zoom.value;
    render();
  };
  sizeReset.onclick = () => {
    size.value = String(tune('satellitePreviewWidthPx'));
    sizeVal.textContent = size.value + 'px';
    render();
  };
  syncZoomMax();
  render();
  body.appendChild(grid);
  modal.box.appendChild(body);
  modal.show();
}
window.showRouteMosaicModal = showRouteMosaicModal;

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

// A single button that opens this airfield in the Charts modal — the full
// plate list lives there, so the inspector doesn't duplicate it.
// NOTAM row for an ICAO airfield: a link to its active NOTAMs, or "N/A" when
// it has none. NOTAM data is loaded on demand if the overlay was never on.
function appendAirfieldNotams(body, af) {
  const icao = String(af && af.name || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(icao)) return;
  let loadFailed = false;
  const matchesAll = () => Array.isArray(notams)
    ? notams.filter(n => String(n.icao || '').toUpperCase() === icao)
    : (loadFailed ? [] : null);
  const matchesActive = () => {
    return (Array.isArray(notams) && typeof activeNotams === 'function')
      ? activeNotams().filter(n => String(n.icao || '').toUpperCase() === icao)
      : (loadFailed ? [] : null);
  };
  const row = document.createElement('div');
  row.className = 'row notam-insp-row';
  const lbl = document.createElement('label');
  lbl.textContent = S.notamInspLabel || 'NOTAMs';
  const val = document.createElement('span');
  val.className = 'val';
  const render = () => {
    const active = matchesActive();
    const all = matchesAll();
    val.textContent = '';
    if (active === null || all === null) { val.textContent = '…'; return; }
    if (!all.length) { val.textContent = S.notamInspNone || 'N/A'; return; }
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'insp-notam-link';
    const count = active.length || all.length;
    link.textContent = S.notamInspView ? S.notamInspView(count) : ('View ' + count);
    link.onclick = () => {
      if (typeof showNotamModal === 'function') showNotamModal(null, { filterIcao: icao });
    };
    val.appendChild(link);
  };
  const initial = matchesActive();
  render();
  if (initial === null && typeof ensureNotams === 'function') {
    // Guard against the inspector being closed / switched to another airfield
    // before the load resolves — don't write into a detached/stale row.
    ensureNotams().then(() => { if (val.isConnected) render(); })
      .catch(() => {
        loadFailed = true;
        if (val.isConnected) render();
      });
  }
  row.append(lbl, val);
  body.appendChild(row);
}

// Airport NOTAM badges are shortcuts into the normal NOTAM sheet, with that
// airfield preselected in its existing ICAO filter. This preserves the sheet's
// "Include not yet active" toggle and lets the pilot return to the full feed.
// Area/route NOTAM clicks remain fixed single-event views.
function showNotamBadgeModal(entries) {
  if (typeof showNotamModal !== 'function') return;
  const list = Array.isArray(entries) ? entries : [];
  const codes = Array.from(new Set(list
    .map(n => String(n && n.icao || '').toUpperCase())
    .filter(code => /^[A-Z]{4}$/.test(code))));
  if (codes.length === 1 && list.every(n => String(n && n.icao || '').toUpperCase() === codes[0])) {
    showNotamModal(null, { filterIcao: codes[0] });
  } else {
    showNotamModal(list);
  }
}

function appendAirfieldPlates(body, af) {
  if (!af || !Array.isArray(af.plates) || !af.plates.length) return;
  const row = document.createElement('div');
  row.className = 'row plates-section';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'insp-charts-btn';
  btn.textContent = S.inspOpenCharts || '🗺️ Airport charts';
  btn.title = S.inspOpenChartsTitle || '';
  btn.onclick = () => { if (typeof showChartsModal === 'function') showChartsModal(af.name); };
  row.appendChild(btn);
  body.appendChild(row);
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
  // Frequencies in a frame of their own: on a field with a tower, a clearance delivery and
  // an ATIS this is four or five rows of numbers, and unlabelled they read as a list of
  // settings rather than as the radios to set.
  appendAirfieldComms(body, af);
  // Density altitude lives under Weather, because temperature and QNH are what it is made
  // of -- and the METAR it reads them from is printed directly below it.
  appendAirfieldWeather(body, af);
  appendSatelliteSnippet(body, af, label || airfieldInspectorTitle(af));
  appendVorRadialRow(body, af.lat, af.lng);
  appendAirfieldRunways(body, af);
  appendAirfieldNotams(body, af);
  appendAirfieldPlates(body, af);
}

// Live METAR / TAF for an ICAO-coded airfield. Fetched on demand from
// the published wx feed; shows decoded text with a toggle to the raw report.
function appendAirfieldWeather(body, af) {
  const icao = String(af && af.name || '').toUpperCase();
  // A field with no ICAO code publishes no METAR -- but it still has weather, and density
  // altitude is computed from a forecast that needs only a position. Gvulot and Kedem used
  // to get no Weather box at all, and with it no density altitude, for want of four letters.
  const hasWx = /^[A-Z]{4}$/.test(icao) && typeof fetchAirfieldWx === 'function';
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
  // Read a weather section aloud. METAR and TAF get their OWN 🔊 button (built into each
  // block below), so the pilot can hear just the report they want rather than both. On-demand
  // — works whether or not the in-flight voice alerts are on. Only one section speaks at a
  // time: pressing the speaking button, or starting another, stops it. Reads what the panel
  // shows — decoded plain language, or the raw code when the raw toggle is on.
  let speakingBtn = null;
  const setSpeakIcon = (btn, on) => {
    btn.textContent = on ? '⏹' : '🔊';
    const what = btn._wxWhat || '';
    btn.title = (on ? (S.wxStopSpeak || 'Stop reading') : (S.wxSpeak || 'Read aloud')) + (what ? ' — ' + what : '');
    btn.setAttribute('aria-label', btn.title);
  };
  const stopSpeak = () => {
    if (typeof window.speakOnDemandStop === 'function') window.speakOnDemandStop();
    if (speakingBtn) { setSpeakIcon(speakingBtn, false); speakingBtn = null; }
  };
  // Speech-only formatting: a QNH is read digit-by-digit on the radio ("one zero one zero",
  // "two niner eight three"), not as a cardinal number ("one thousand ten"). Spell the hPa
  // and inches figures as separate digits for the spoken string; the displayed text is left
  // as-is. Applied to what is read aloud, not to the panel.
  const speechify = (t) => String(t)
    // Wind direction is read as separate digits + "degrees" ("three five zero degrees"),
    // like on the radio. The (?!C) guard leaves a temperature ("29°C") as a cardinal number.
    .replace(/(\d{1,3})°(?!C)/g, (_, n) => n.split('').join(' ') + ' degrees')
    .replace(/(\d{3,4})\s*hPa/g, (_, n) => n.split('').join(' ') + ' hectopascals')
    .replace(/(\d{2})\.(\d{2})\s*[″"]/g, (_, a, b) => (a + b).split('').join(' ') + ' inches')
    // Unit symbols read badly letter-by-letter ("kay tee"); spell them for the voice only.
    .replace(/\bkt\b/g, 'knots')
    .replace(/\bft\b/g, 'feet')
    .replace(/\bSM\b/g, 'statute miles');
  const speakSection = (btn, textFn) => {
    if (speakingBtn === btn) { stopSpeak(); return; }   // same button toggles off
    stopSpeak();                                        // switch away from another section
    if (typeof window.speakOnDemand !== 'function') return;
    const text = textFn();
    if (!text) return;
    speakingBtn = btn; setSpeakIcon(btn, true);
    // Always English: METAR/TAF decode to English, and raw codes are English/ICAO.
    Promise.resolve(window.speakOnDemand(speechify(text), 'en-US'))
      .then(() => { if (speakingBtn === btn) { setSpeakIcon(btn, false); speakingBtn = null; } });
  };
  // A 🔊 button for one section (`what` = METAR/TAF), dimmed (never hidden) when no engine.
  const makeSpeakBtn = (what, textFn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wx-speak';
    b._wxWhat = what;
    setSpeakIcon(b, false);
    b.disabled = !(typeof window.ttsAvailable === 'function' && window.ttsAvailable());
    b.onclick = () => speakSection(b, textFn);
    return b;
  };
  head.appendChild(refreshBtn);
  sec.appendChild(head);
  // Density altitude first, with its own time slider above it: the slider is what the
  // pilot came here to move, and a control that sits under the numbers it changes is a
  // control you scroll past.
  appendAirfieldDensityAltitude(sec, af);
  if (!hasWx) {
    // No observation to fetch: the box is the density altitude, and its heading says so.
    if (!sec.querySelector('.da-group')) return;
    headLbl.textContent = S.wxTitleNoMetar || S.densityAltitude || 'Density altitude';
    refreshBtn.remove();
    body.appendChild(sec);
    return;
  }
  const bodyEl = document.createElement('div');
  bodyEl.className = 'wx-body';
  // Follow content direction: prose messages (loading / no-data / error) read
  // RTL in Hebrew, while METAR/TAF code blocks force LTR on themselves.
  bodyEl.dir = 'auto';
  bodyEl.textContent = S.wxLoading || 'Loading…';
  sec.appendChild(bodyEl);
  body.appendChild(sec);

  let showRaw = false, data = null;
  // AD/WS (aerodrome / wind-shear) warnings for this field, from the IMS feed. Shown in every
  // branch -- even with no METAR/TAF -- and always present with a "None" line when the field
  // has none in force, so absence is stated rather than left ambiguous.
  const appendAdWs = () => {
    const warns = (typeof airfieldWarningsFor === 'function') ? airfieldWarningsFor(icao) : [];
    const wrap = document.createElement('div');
    wrap.className = 'wx-block wx-adws';
    // The label and the "None" line are localized prose — RTL in Hebrew — so let them follow
    // content direction rather than forcing LTR (which mis-ordered the Hebrew label and its
    // "(AD / WS)" parenthetical). The warning bodies below are IMS codes and stay LTR.
    wrap.dir = 'auto';
    const t = document.createElement('span');
    t.className = 'wx-label';
    t.dir = 'auto';
    t.textContent = S.wxAdWs || 'AD / WS warnings';
    wrap.appendChild(t);
    if (!warns.length) {
      const none = document.createElement('div');
      none.className = 'wx-line wx-adws-none';
      none.dir = 'auto';
      none.textContent = S.wxAdWsNone || 'None';
      wrap.appendChild(none);
    } else {
      for (const w of warns) {
        const d = document.createElement('div');
        d.className = 'wx-line';
        d.dir = 'ltr';                 // warning bodies are IMS codes: keep them left-to-right
        d.textContent = w.raw || w.product;
        wrap.appendChild(d);
      }
    }
    bodyEl.appendChild(wrap);
  };
  const load = (force) => {
    stopSpeak();   // a refresh replaces the reports being read; stop mid-sentence
    bodyEl.textContent = S.wxLoading || 'Loading…';
    refreshBtn.disabled = true;
    fetchAirfieldWx(icao, force).then(d => { data = d; refreshBtn.disabled = false; render(); })
      .catch(() => { data = { error: true }; refreshBtn.disabled = false; render(); });
  };
  refreshBtn.onclick = () => load(true);
  const render = () => {
    stopSpeak();                       // a rebuild discards the buttons a read was tied to
    bodyEl.innerHTML = '';
    if (!data || data.unsupported) { bodyEl.textContent = S.wxNone || 'No METAR/TAF'; appendAdWs(); return; }
    if (data.error) { bodyEl.textContent = S.wxError || 'Weather unavailable'; appendAdWs(); return; }
    if (!data.metar && !data.taf) { bodyEl.textContent = S.wxNone || 'No METAR/TAF'; appendAdWs(); return; }
    const block = (label, lines, spkBtn) => {
      const b = document.createElement('div');
      b.className = 'wx-block';
      b.dir = 'ltr';                   // METAR/TAF codes are always left-to-right
      const t = document.createElement('span');
      t.className = 'wx-label';
      t.textContent = label;
      b.appendChild(t);
      if (spkBtn) b.appendChild(spkBtn);   // this section's own 🔊
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
      const spk = makeSpeakBtn(S.wxMetar || 'METAR', () => {
        const txt = showRaw ? (data.metar.rawOb || data.metar.rawText || '') : decodeMetar(data.metar);
        return txt ? (icao + '. ' + (S.wxMetar || 'METAR') + '. ' + txt) : '';
      });
      bodyEl.appendChild(block(S.wxMetar || 'METAR', lines.filter(Boolean), spk));
    }
    if (data.taf) {
      let lines;
      if (showRaw) {
        lines = [data.taf.rawTAF || data.taf.rawText || ''];
      } else {
        const dec = decodeTaf(data.taf);
        lines = dec.length ? dec.map(s => s.when + ': ' + s.text) : [data.taf.rawTAF || ''];
      }
      const spk = makeSpeakBtn(S.wxTaf || 'TAF', () => {
        let txt;
        if (showRaw) { txt = data.taf.rawTAF || data.taf.rawText || ''; }
        else { const dec = decodeTaf(data.taf); txt = dec.length ? dec.map(s => s.when + ': ' + s.text).join('. ') : ''; }
        return txt ? (icao + '. ' + (S.wxTaf || 'TAF') + '. ' + txt) : '';
      });
      bodyEl.appendChild(block(S.wxTaf || 'TAF', lines.filter(Boolean), spk));
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wx-toggle';
    toggle.textContent = showRaw ? (S.wxShowDecoded || 'Show decoded') : (S.wxShowRaw || 'Show raw');
    toggle.onclick = () => { stopSpeak(); showRaw = !showRaw; render(); };   // content changes: stop any read
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
    appendAdWs();
  };
  load(false);
}

// Split the inspector's actions from its data rows: they go into one sticky block so
// the destructive ones cannot fall below the fold on a phone, and only genuinely
// destructive ones keep the alarm red.
// The order a pilot reads them in, not the order the panel happens to build them in.
// Anything not named here keeps its relative position after these.
const INSPECTOR_ACTION_ORDER = [
  'insp-del-wp-btn',        // delete the point
  'insp-reset-name-btn',    // put its name back
  'add-freq-change-btn',    // (class) add a frequency change here
  'insp-hotspot-btn',       // mark it as a hotspot
  'insp-turn-btn',          // mark the turn
];
function inspectorActionRank(el) {
  const i = INSPECTOR_ACTION_ORDER.findIndex(k => el.id === k || el.classList.contains(k));
  return i === -1 ? INSPECTOR_ACTION_ORDER.length : i;
}

function finalizeInspectorActions(body) {
  // Status lines travel with the buttons. A line that says "this point is the turning point"
  // is only useful beside the action it describes, and gathering the buttons at the foot of
  // the panel used to leave it stranded three rows above them. Relative order is kept, and a
  // status sits immediately before its own button.
  const items = [...body.children].filter(el => el.classList &&
    (el.classList.contains('insp-btn') || el.classList.contains('insp-status')));
  if (!items.some(el => el.classList.contains('insp-btn'))) return;
  const wrap = document.createElement('div');
  wrap.className = 'insp-actions';
  // Stable sort: a status line stays with the button it describes, because it carries that
  // button's rank rather than one of its own.
  let lastRank = INSPECTOR_ACTION_ORDER.length;
  const ranked = items.map((el, i) => {
    if (el.classList.contains('insp-btn')) lastRank = inspectorActionRank(el);
    return { el, rank: el.classList.contains('insp-status') ? lastRank : inspectorActionRank(el), i };
  });
  ranked.sort((a, b) => (a.rank - b.rank) || (a.i - b.i));
  for (const { el: b } of ranked) {
    if (b.classList.contains('insp-btn')) {
      const txt = (b.textContent || '').toLowerCase();
      const destructive = /🗑|delete|remove|מחק|הסר/.test(txt);
      if (!destructive) b.classList.add('insp-btn-safe');
    }
    wrap.appendChild(b);
  }
  body.appendChild(wrap);
}

// Re-render an inspector that is ALREADY on screen, and never resurrect a hidden
// one. showInspector() also clears .hidden, so the flight plan's edit handlers --
// which call it to keep an open selection in sync -- popped the inspector back over
// the modal that had deliberately hidden it (inspector z 2320 vs modal 2000). Editing
// a speed in the plan should not raise a panel the plan just put away.
function refreshInspectorIfVisible() {
  const insp = document.getElementById('inspector');
  if (!insp || insp.classList.contains('hidden')) return;
  if (state.selected && typeof showInspector === 'function') showInspector();
}

// While a finger is dragging a waypoint the inspector is in the way: on a phone it covers
// the half of the map the point is being dragged towards, and it is rebuilt on every frame
// of the drag anyway. Hidden for the duration, without touching the selection -- the panel
// comes back, with the same waypoint in it, as soon as the finger lifts.
function setInspectorDragHidden(on) {
  const insp = document.getElementById('inspector');
  if (insp) insp.classList.toggle('insp-drag-hidden', !!on);
}
// Everything the pilot can drag on the map is route LAYOUT: the waypoint, its nav kite, the
// cumulative-time kite, notes and comm callouts. While a real fix (or a simulator) is
// driving the map, none of it may move -- a nudge in flight rewrites the plan under the
// alerts that are measuring against it, and on a kneeboard the nudge is usually accidental.
// The waypoint has been locked for a while; the rest were not, which is the same hazard
// with a smaller target. The page frame is print layout, not the route, so it stays free.
const LOCKABLE_DRAG_KINDS = ['wp', 'note', 'label', 'cumlabel', 'cumlabelret'];
// A press on any of these may become either a drag or a tap, and which it is is not known
// until the release. So it opens nothing on the way down: the thing under the finger is
// selected (that highlight is the feedback a press needs) and the panel waits. On release, a
// tap opens it; a drag leaves a shut panel shut. Opening on the press and hiding it again on
// the first movement -- what the touch path used to do for waypoints, and what an earlier
// pass here did for kites -- flashes the panel across the chart on every drag.
const KITE_DRAG_KINDS = ['label', 'cumlabel', 'cumlabelret'];
const TAP_OPENS_INSPECTOR_KINDS = ['wp', 'note', 'legtap', 'legclick'].concat(KITE_DRAG_KINDS);
// A press on something draggable normally takes the map's drag away, so the gesture moves
// the thing and not the chart under it. When the route is LOCKED, nothing is going to move
// -- and taking the pan away anyway left the map stuck under every waypoint, kite, callout
// and cumulative arrow on it. On a kneeboard those cover a good part of the screen, so the
// map read as frozen wherever the route happened to be.
//
// So: hold the map only when the drag can actually do something. Locked, Leaflet keeps the
// pan and the press still selects on the way down and opens the panel on release -- unless
// the map moved, which `movestart` below marks as a drag rather than a tap.
// A press on a leg line selects it and opens its panel on release. It drags nothing, so the
// map pans under the finger -- which the touchmove handler has documented since it was
// written, and which only the MOUSE path was taught. `legtap` is not a lockable kind, so
// holdMapForDrag fell through to disabling the pan and the touch path then swallowed the
// gesture with preventDefault: on the kneeboard tablet this fix was for, pressing anywhere
// on the route still froze the chart.
const PAN_THROUGH_DRAG_KINDS = ['legtap', 'legclick'];
function holdMapForDrag(kind) {
  if (PAN_THROUGH_DRAG_KINDS.indexOf(kind) !== -1) return false;
  if (dragLockedNow(kind)) return false;
  map.dragging.disable();
  return true;
}

function dragLockedNow(kind) {
  if (LOCKABLE_DRAG_KINDS.indexOf(kind) === -1) return false;
  // The map's edit lock owns this: the pilot's stored choice, the automatic lock whenever a
  // position drives the map, and the one-tap exception to it (see routeEditLocked in ui.js).
  if (typeof routeEditLocked === 'function') return routeEditLocked();
  if (typeof editLocked !== 'undefined' && editLocked) return true;
  return typeof gpsMapLocked === 'function' && gpsMapLocked();
}

function showInspector() {
  const insp = document.getElementById('inspector');
  const title = document.getElementById('insp-title');
  const body = document.getElementById('insp-body');
  // Not while the aircraft is being tracked: the panel covers the map, and in flight the
  // map is what the pilot is reading. The selection is dropped with it, so nothing is left
  // highlighted with no panel to explain it. See inspectorAllowedNow (gps.js).
  if (typeof inspectorAllowedNow === 'function' && !inspectorAllowedNow()) {
    state.selected = null;
    insp.classList.add('hidden');
    if (typeof resetInspectorVorRef === 'function') resetInspectorVorRef();
    if (typeof clearStoredInspectorSelection === 'function') clearStoredInspectorSelection();
    if (typeof scheduleDraw === 'function') scheduleDraw();
    return;
  }
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
    // Wind: per-leg override of the route-wide wind. Blank inputs
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
    // Speed carries forward the same way it does in the flight plan (propagateAlt
    // from the speed cell there): one aircraft flies the whole route, so setting
    // 110 on a leg walks it down the legs still at the old value and stops at the
    // first intentional change. Editing leg by leg was the only place that did NOT
    // propagate, so the two editors disagreed about the same number.
    body.appendChild(numberRow(S.speedKt, leg.flightSpeed, v => {
      if (!(v > 0)) return;
      const oldVal = leg.flightSpeed;
      leg.flightSpeed = v;
      propagateAlt(idx, 'flightSpeed', v, oldVal);
      draw(); refreshWindFx();
    }));
    // Leg magnetic heading (read-only) — sits between speed and altitude.
    const _dirA = state.waypoints[idx], _dirB = state.waypoints[idx + 1];
    if (_dirA && _dirB) {
      body.appendChild(textRow(S.legDirection || 'Direction',
        pad3(toMagnetic(geo(_dirA, _dirB).brg)) + '°'));
    }
    // Reset-to-known: the charted altitude from the route graph. Read from
    // the pristine ORIGIN map (legAltitudeOriginForLeg), not the live lookup —
    // a hand-edited altitude must not redefine the inspector's "charted"
    // default / revert target. Undefined (no entry / unknown direction) means
    // the reset button is omitted — nothing authoritative to revert to.
    const known = (typeof legAltitudeOriginForLeg === 'function') ? legAltitudeOriginForLeg(idx)
      : ((typeof legAltitudeForLeg === 'function') ? legAltitudeForLeg(idx) : null);
    const knownIn  = known && Number.isFinite(known.inboundAltitude)  ? known.inboundAltitude  : undefined;
    const knownOut = known && Number.isFinite(known.outboundAltitude) ? known.outboundAltitude : undefined;
    // Minimum safe altitude row, updated in place as the altitudes
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
    if (window.showWind) {
      // Read-only: the per-leg wind comes from the realtime winds-aloft fetch
      // (leg.wind) or a loaded route's route-wide wind — there is no manual
      // wind entry. Show "—" when no wind is available / it's calm.
      const w = (typeof legWindFor === 'function') ? legWindFor(leg) : null;
      body.appendChild(textRow(S.windFromDeg,
        w && Number.isFinite(w.dir) ? pad3(w.dir) + '°' : '—'));
      body.appendChild(textRow(S.windSpeedKt,
        w && Number.isFinite(w.speed) ? String(w.speed) : '—'));
      windFxRow = textRow(S.windEffect, '');
      windFxRow.classList.add('wind-fx-row');
      body.appendChild(windFxRow);
      refreshWindFx();
      // When the wind came from the realtime fetch, stamp its update time (Zulu).
      if (Number.isFinite(state.windUpdated) && typeof formatZuluHM === 'function') {
        body.appendChild(textRow(S.windUpdatedLabel, formatZuluHM(state.windUpdated)));
      }
    }
    const reset = document.createElement('button');
    reset.className = 'insp-btn';
    // Fallback to a glyph if the locale strings haven't been loaded yet —
    // Hebrew users used to see literal "undefined" on this button until
    // Keep the Hebrew reset-label translation in he/strings.js.
    reset.textContent = S.resetLegMarkers || '↻';
    reset.title = S.resetLegMarkersTitle || 'Reset marker position';
    reset.setAttribute('aria-label', reset.title);
    reset.onclick = () => {
      const d = _defaultLegLabels();
      leg.inLabel = d.inLabel;
      leg.outLabel = d.outLabel;
      leg.cumLabel = d.cumLabel;
      leg.cumLabelRet = d.cumLabelRet;
      draw();
    };
    body.appendChild(reset);
    // Hide / show this leg's nav kite (both directions). Nothing else about the leg changes,
    // and the line stays selectable, which is how this button is reached again to restore it.
    const hideBtn = document.createElement('button');
    hideBtn.className = 'insp-btn';
    // Effective state, like the drift button below: a leg inside the departure CTR hides
    // its kite by default, and this button is how it comes back (leg.showKite).
    const kiteIdx = state.selected.index;
    const kiteOff = typeof legKiteVisible === 'function'
      ? !legKiteVisible(kiteIdx, leg)
      : (typeof legKiteHidden === 'function' && legKiteHidden(leg));
    hideBtn.textContent = kiteOff
      ? (S.showLegKite || 'Show kite')
      : (S.hideLegKite || 'Hide kite');
    hideBtn.title = kiteOff
      ? (S.showLegKiteTitle || "Draw this leg's heading / time / altitude kite again")
      : (S.hideLegKiteTitle ||
         "Hide this leg's heading / time / altitude kite. The leg, its times and the plan are unchanged.");
    hideBtn.setAttribute('aria-label', hideBtn.title);
    hideBtn.setAttribute('aria-pressed', kiteOff ? 'true' : 'false');
    hideBtn.onclick = () => {
      const inCtr = typeof legInsideCtr === 'function' && legInsideCtr(kiteIdx);
      if (kiteOff) { delete leg.hideKite; if (inCtr) leg.showKite = 1; }
      else { delete leg.showKite; if (!inCtr) leg.hideKite = 1; }
      if (typeof persist === 'function') persist();
      draw();
      showInspector();          // relabel the button to what it now does
    };
    body.appendChild(hideBtn);
    // Same again for this leg's drift lines. Separate control rather than a mode on the kite
    // button: a pilot decluttering a busy area wants one or the other, not both together.
    const driftBtn = document.createElement('button');
    driftBtn.className = 'insp-btn';
    // Label from the EFFECTIVE state, so the button always does what it says: with the
    // global toggle off, "Show drift lines" turns this one leg's cone on (showDrift) --
    // it used to clear a hide flag nothing was reading, a click that changed nothing.
    const driftOff = typeof legDriftVisible === 'function'
      ? !legDriftVisible(leg, window.showDrift, state.selected.index)
      : (typeof legDriftHidden === 'function' && legDriftHidden(leg));
    driftBtn.textContent = driftOff
      ? (S.showLegDrift || 'Show drift lines')
      : (S.hideLegDrift || 'Hide drift lines');
    driftBtn.title = driftOff
      ? (S.showLegDriftTitle || "Draw this leg's dashed drift lines again")
      : (S.hideLegDriftTitle ||
         "Hide this leg's dashed drift lines. The leg, its kite and the plan are unchanged.");
    driftBtn.setAttribute('aria-label', driftBtn.title);
    driftBtn.setAttribute('aria-pressed', driftOff ? 'true' : 'false');
    driftBtn.onclick = () => {
      const dIdx = state.selected.index;
      const dInCtr = typeof legInsideCtr === 'function' && legInsideCtr(dIdx);
      if (driftOff) {
        delete leg.hideDrift;
        // Global off, or default-off inside the CTR: this leg opts in explicitly.
        if (!window.showDrift || dInCtr) leg.showDrift = 1;
      } else {
        delete leg.showDrift;
        if (window.showDrift && !dInCtr) leg.hideDrift = 1;
      }
      if (typeof persist === 'function') persist();
      draw();
      showInspector();          // relabel the button to what it now does
    };
    body.appendChild(driftBtn);
    // Add an identification/report-point oval on this leg (draggable along it,
    // auto time from the leg start). CAAI נקי הזדהות.
    const addRp = document.createElement('button');
    addRp.className = 'insp-btn';
    addRp.textContent = S.addReportPoint || 'Add identification-point marker';
    addRp.onclick = () => { addReportPointToLeg(idx); showInspector(); };
    body.appendChild(addRp);
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
      // Identification-point ovals are always leg-anchored ovals at a fixed
      // size, so the shape + size controls (which have no effect for them) are
      // omitted; only the label + colour apply.
      if (!note.rp) {
        body.appendChild(selectRow(S.shape, note.shape || 'rect',
          [['rect', S.shapeRect], ['oval', S.shapeOval]], v => {
            note.shape = v; draw();
          }));
      }
      body.appendChild(colorRow(S.color, note.color || NOTE_DEFAULT_COLOR, v => {
        note.color = v; draw();
      }, NOTE_DEFAULT_COLOR));
      if (!note.rp) {
        body.appendChild(rangeRow(S.noteSize || 'Size',
          Number.isFinite(note.size) ? note.size : 1, 0.5, 1.5, 0.25,   // symmetric → default 100% sits mid-track
          v => Math.round(v * 100) + '%', v => {
            note.size = v;
            if (typeof persist === 'function') persist();
            draw();
          }, 1));   // ↻ resets note size to 1 (100%)
      }
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
        configure: typeof vorConfigureFreqInput === 'function' ? vorConfigureFreqInput : null,
        normalize: typeof vorNormalizeFreqInput === 'function' ? vorNormalizeFreqInput : null,
        isOverride: () => !!(typeof vorFreqOverrides === 'function' && vorFreqOverrides()[v.ident]),
        commit: n => { if (typeof setVorFreqOverride === 'function') setVorFreqOverride(v.ident, n === vdef ? '' : n); return n; },
        onReset: () => { if (typeof setVorFreqOverride === 'function') setVorFreqOverride(v.ident, ''); return vdef; },
      }));
    }
    appendVorAipInfo(body, v);
    appendSatelliteSnippet(body, v, title.value);
    const useBtn = document.createElement('button');
    useBtn.className = 'insp-btn';
    const isRef = vorRef === v.ident;
    useBtn.textContent = isRef ? (S.vorRefActive || '✓ Reference VOR (tap to clear)')
                               : (S.vorUseRef || 'Use as reference VOR');
    useBtn.onclick = () => {
      // setReferenceVor also drops this station's SELECTION ring when clearing, which is why
      // "tap to clear" used to look like it did nothing until the inspector was closed.
      setReferenceVor(isRef ? null : v.ident);
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
    appendAddToRouteButton(body, af);
  } else if (state.selected.type === 'airspace') {
    // One area of controlled or restricted airspace, from the AIP. Everything here is a
    // read-out: what it is, how high it reaches, when it is in force and who owns it.
    const a = (window.airspace || [])[state.selected.index];
    if (!a) {
      state.selected = null;
      insp.classList.add('hidden');
      clearStoredInspectorSelection();
      return;
    }
    title.value = a.name || a.id;
    title.placeholder = ''; title.readOnly = true; title.oninput = null;

    // What the letter means, in words. "Restricted" is not "closed", and a pilot deciding
    // whether to route through needs to know which of the three this is.
    const kindText = a.kind === 'prohibited' ? (S.airspaceKindProhibited || 'Prohibited — closed')
      : a.kind === 'tma' ? (S.airspaceKindTma || 'Controlled — clearance required')
      : a.kind === 'ctr' ? (S.airspaceKindCtr || 'Control zone — clearance required')
      : (S.airspaceKindRestricted || 'Restricted — conditional');
    body.appendChild(textRow(S.airspaceKind || 'Class', kindText));
    body.appendChild(textRow(S.airspaceVertical || 'Vertical limits', airspaceLimitText(a)));

    // Where the planned route stands against those limits: the outline says nothing about
    // whether this leg is a problem, and the numbers on their own make the pilot do the
    // comparison in their head at exactly the wrong moment.
    const verdict = airspaceRouteVerdict(a);
    if (verdict) body.appendChild(textRow(S.airspaceYourRoute || 'Your route', verdict));

    if (Array.isArray(a.activity) && a.activity.length) {
      body.appendChild(textRow(S.airspaceActivity || 'Activity',
        a.activity.map(t => (S.airspaceActivityNames && S.airspaceActivityNames[t]) || t).join(' · ')));
    }
    // Hours, and whether they are in force right now where that can be decided from the
    // text alone. The holiday-eve exceptions stay as printed: the Israeli holiday calendar
    // is not something to infer, and a wrong "not active" is the dangerous direction.
    if (Array.isArray(a.hours) && a.hours.length) {
      const now = airspaceActiveNow(a);
      const state2 = now === true ? (S.airspaceActiveNow || 'active now')
        : now === false ? (S.airspaceNotActiveNow || 'not active now') : '';
      const row = textRow(S.airspaceHours || 'Hours', a.hours.join(' · '));
      if (state2) {
        const tag = document.createElement('span');
        tag.className = 'airspace-now' + (now ? ' is-active' : '');
        tag.textContent = state2;
        row.querySelector('.val').appendChild(document.createTextNode(' '));
        row.querySelector('.val').appendChild(tag);
      }
      body.appendChild(row);
    }
    if (a.byNotam) body.appendChild(textRow(S.airspaceActivation || 'Activation', S.airspaceByNotam || 'By NOTAM'));

    // Who to call. A controlled sector without its frequency is a wall; with it, it is a
    // clearance away.
    if (Array.isArray(a.stations) && a.stations.length) {
      for (const st of a.stations) {
        const label = [st.name, st.purpose].filter(Boolean).join(' · ') || (S.airspaceFreq || 'Frequency');
        const row = textRow(label, st.mhz);
        row.querySelector('.val').dir = 'ltr';
        body.appendChild(row);
      }
    }

    if (a.notes) body.appendChild(textRow(S.airspaceNotes || 'Notes', a.notes));
    if (Number.isFinite(a.areaNm2)) {
      body.appendChild(textRow(S.airspaceSize || 'Size',
        Math.round(a.areaNm2).toLocaleString() + ' ' + (S.airspaceNm2 || 'nm²')));
    }
    const away = airspaceDistanceText(a);
    if (away) body.appendChild(textRow(S.airspaceDistance || 'From you', away));

    // Live NOTAMs that name this area -- the difference between "activated by NOTAM" and
    // "activated", which is the whole question for half of these.
    const hits = airspaceNotams(a);
    if (hits.length) {
      const row = textRow(S.airspaceNotams || 'NOTAMs', String(hits.length));
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'insp-notam-link';
      link.textContent = S.airspaceShowNotams || 'Show';
      link.onclick = () => { if (typeof showNotamModal === 'function') showNotamModal(hits); };
      row.querySelector('.val').appendChild(document.createTextNode(' '));
      row.querySelector('.val').appendChild(link);
      body.appendChild(row);
    }
    body.appendChild(textRow(S.airspaceSource || 'Source', a.source || 'AIP'));
  } else if (state.selected.type === 'lsaArea') {
    const a = (typeof areas !== 'undefined' && areas) ? areas[state.selected.index] : null;
    if (!a) {
      state.selected = null;
      insp.classList.add('hidden');
      clearStoredInspectorSelection();
      return;
    }
    // "CODE / localized name", like the other read-only inspectors. The English label of
    // most bubbles IS the code, so fall back to the Hebrew name rather than repeating it.
    const bubbleName = areaLabel(a) !== (a.icao || '') ? areaLabel(a) : (a.he || '');
    title.value = codeTitle(a.icao || '', bubbleName);
    title.placeholder = ''; title.readOnly = true; title.oninput = null;
    if (Number.isFinite(a.lowFt) && Number.isFinite(a.highFt)) {
      body.appendChild(textRow(S.bubbleAltBand || 'Altitude band', a.lowFt + '-' + a.highFt + ' ' + (S.unitFeet || 'ft')));
    }
    // Availability, as the chart LEGEND states it and nothing else. The secondary source's
    // per-bubble opening hours were dropped from the dataset -- the tan class is carried as
    // active:'weekend', written from the legend.
    const wkndOnly = a.active === 'weekend';
    body.appendChild(textRow(S.bubbleActive || 'Active',
      wkndOnly ? (S.bubbleWeekendOnly || 'Weekends & holidays only')
               : (S.bubbleOpenAll || 'Open all day')));
  } else if (state.selected.type === 'traffic') {
    // An aircraft the receiver is hearing right now. Nothing here is editable and none of it
    // is ours: it is a read-out of one transponder, and it disappears when that aeroplane
    // does. Missing fields stay missing rather than reading as zero -- an aircraft with no
    // altitude reported is not on the ground.
    const ac = (window.trafficAircraft || []).find(a => a && a.hex === state.selected.hex);
    if (!ac) {
      state.selected = null;
      insp.classList.add('hidden');
      clearStoredInspectorSelection();
      return;
    }
    title.value = ac.flight || ac.hex || (S.trafficTitle || 'Traffic');
    title.readOnly = true;
    body.appendChild(textRow(S.trafficAltitude || 'Altitude',
      Number.isFinite(ac.alt) ? Math.round(ac.alt) + ' ' + (S.unitFeet || 'ft') : '—'));
    body.appendChild(textRow(S.trafficGroundSpeed || 'Ground speed',
      Number.isFinite(ac.gs) ? Math.round(ac.gs) + ' kt' : '—'));
    body.appendChild(textRow(S.trafficTrack || 'Track',
      Number.isFinite(ac.track) ? String(Math.round(ac.track)).padStart(3, '0') + '°' : '—'));
    if (ac.type) body.appendChild(textRow(S.trafficType || 'Type', ac.type));
    if (ac.squawk) body.appendChild(textRow(S.trafficSquawk || 'Squawk', ac.squawk));
    body.appendChild(textRow(S.latitude, fmtLatLng(ac.lat, 'N', 'S')));
    body.appendChild(textRow(S.longitude, fmtLatLng(ac.lon, 'E', 'W')));
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
    appendNavWaypointCommChangeInfo(body, nw.name);
    appendSatelliteSnippet(body, nw, title.value);
    appendVorRadialRow(body, nw.lat, nw.lng);
    appendAddToRouteButton(body, nw);
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
    const defaultWpName = waypointDisplayLabel(wp, state.selected.index);
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
    // Reporting-type badge. The chart's סוג דיווח class lives
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
    // Comm-change badge/editor, including manual callouts. Known
    // comm-change points show the chart badge; any named waypoint without a
    // linked callout can still add a manual frequency-change arrow.
    if (showCommChange) {
      let ccKey = waypointFreqChangeKey(wp);
      let linkedNote = ccKey ? freqChangeNoteForKey(ccKey) : null;
      if (!linkedNote) {
        const linkedIndex = selectedFreqNoteIndex();
        linkedNote = linkedIndex >= 0 ? state.notes[linkedIndex] : null;
        if (linkedNote && linkedNote.cc) {
          ccKey = typeof canonicalNavWaypointName === 'function'
            ? canonicalNavWaypointName(linkedNote.cc)
            : String(linkedNote.cc || '').trim();
        }
      }
      const cc = commChangeMap && ccKey ? commChangeMap[ccKey] : null;
      if (linkedNote && typeof appendFreqEdit === 'function') {
        appendFreqEdit(body, linkedNote, { deleteButton: true });
      } else if (cc && cc.commChange) {
        const row = document.createElement('div');
        row.className = 'row col commchange-row';
        const lbl = document.createElement('label');
        lbl.className = 'commchange-label';
        lbl.textContent = S.commChangeBadge || '📡 Freq change';
        row.appendChild(lbl);
        body.appendChild(row);
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
        appendAddFreqChangeButton(body, wp, ccKey);
      } else if (ccKey) {
        appendAddFreqChangeButton(body, wp, ccKey);
      }
    }
    const hotspotOn = typeof routeWaypointHotspot === 'function' && routeWaypointHotspot(wp);
    const hotspotBtn = document.createElement('button');
    // Quiet until it is marked: an unmarked point has nothing on the chart to shout about,
    // and a row of red buttons teaches a pilot to stop reading them.
    hotspotBtn.className = 'insp-btn' + (hotspotOn ? ' insp-btn-on' : '');
    hotspotBtn.id = 'insp-hotspot-btn';
    hotspotBtn.textContent = hotspotOn ? (S.inspHotspotClear || '🔥 Clear hotspot')
                                       : (S.inspHotspotSet || '🔥 Mark as hotspot');
    if (S.inspHotspotTitle) hotspotBtn.title = S.inspHotspotTitle;
    hotspotBtn.setAttribute('aria-pressed', hotspotOn ? 'true' : 'false');
    hotspotBtn.onclick = () => {
      wp.hotspot = !hotspotOn;
      if (typeof persist === 'function') persist();
      draw();
      showInspector();
    };
    body.appendChild(hotspotBtn);
    const del = document.createElement('button');
    del.className = 'insp-btn';
    del.id = 'insp-del-wp-btn';
    del.textContent = S.deleteWp;
    del.onclick = () => {
      deleteWaypoint(state.selected.index);
      state.selected = null;
      draw(); showInspector();
    };
    body.appendChild(del);
    // Waypoint-name reset — snaps the stored name back to
    // the nearest reference code, or clears it when off-grid (placeholder).
    const resetName = document.createElement('button');
    resetName.className = 'insp-btn';
    resetName.id = 'insp-reset-name-btn';
    resetName.textContent = S.resetWpName || '↻';
    if (S.resetWpNameTitle) resetName.title = S.resetWpNameTitle;
    resetName.onclick = () => resetWpName(state.selected.index);
    body.appendChild(resetName);
    // Airfields do not expose the route-only turning-point action, including when the
    // overlap chooser keeps a coincident route waypoint as the editable selection.
    if (!afInsp) {
      // Geometry-derived turns use the same selected treatment as manual turns. The action
      // remains available so a pilot can persist an explicit turn for non-retracing loops.
      const idx = state.selected.index;
      const manualTurn = !!(state.waypoints[idx] && state.waypoints[idx].turn);
      const effectiveTurn = typeof legRetraceTurnIndex === 'function' &&
        legRetraceTurnIndex() === idx;
      // Only an out-and-back has a far end: a route that lands somewhere other than where it
      // started has no return to separate from its outbound. Clearing an existing mark stays
      // available, so a route edited into a one-way trip is not left holding a turn nothing
      // can use.
      const homeAgain = typeof routeReturnsHome === 'function' ? routeReturnsHome() : true;
      // Proven by a retraced leg, not chosen: a-b-a turns at b, and that is not the pilot's
      // to unset or move elsewhere.
      const definitive = typeof routeTurnIsDefinitive === 'function' && routeTurnIsDefinitive();
      // Say it in words when this point IS the turn. Bold text on a button reading "Mark as
      // turning point" was the only sign, which reads as an offer, not a state -- a pilot
      // could not tell a marked point from an unmarked one without pressing it.
      // Built here, appended AFTER the button below: a line that appears above it pushed the
      // button down the moment it was pressed, so the pointer landed on whatever moved into
      // its place and a second press hit the wrong control.
      let status = null;
      if (effectiveTurn) {
        status = document.createElement('div');
        status.className = 'insp-status insp-turn-status';
        status.id = 'insp-turn-status';
        status.textContent = manualTurn
          ? (S.inspTurnIsManual || '↻ Turning point — you marked this as where the route turns for home.')
          : (S.inspTurnIsAuto || '↻ Turning point — the route doubles back here, so this is where it turns for home. It cannot be moved while it does.');
      }
      // A route that doubles back has its turn settled by the geometry, and nothing here can
      // move it: this point IS where it turns, so there is no action to offer -- on this
      // waypoint or on any other. The status line says which point that is.
      if (definitive) {
        if (status) body.appendChild(status);
        if (!effectiveTurn) {
          const held = document.createElement('div');
          held.className = 'insp-status insp-turn-status';
          held.id = 'insp-turn-status';
          const turnName = (typeof navName === 'function')
            ? navName((state.waypoints[legRetraceTurnIndex()] || {}).name || '')
            : ((state.waypoints[legRetraceTurnIndex()] || {}).name || '');
          held.textContent = (typeof S.inspTurnFixedAt === 'function')
            ? S.inspTurnFixedAt(turnName)
            : ('The route turns for home at ' + turnName + '.');
          body.appendChild(held);
        }
        return;                          // no button: there is nothing to press
      }
      const turnBtn = document.createElement('button');
      turnBtn.className = 'insp-btn' + (effectiveTurn ? ' insp-btn-on' : '');
      turnBtn.id = 'insp-turn-btn';
      turnBtn.textContent = manualTurn ? (S.inspTurnClear || '↻ Clear turning point')
                                       : (S.inspTurnSet || '↻ Mark as turning point');
      // A route that does not come home has no far end to mark -- unless one is already in
      // force, by hand or from a leg that retraces. Disabling the button then would leave
      // the app using a turning point the pilot can neither move nor clear, on a button
      // drawn as pressed.
      turnBtn.disabled = !homeAgain && !manualTurn && !effectiveTurn;
      turnBtn.title = turnBtn.disabled
        ? (S.inspTurnNeedsSameField || 'Available on a route that returns to the airfield it started from.')
        : (S.inspTurnTitle || '');
      turnBtn.setAttribute('aria-pressed', effectiveTurn ? 'true' : 'false');
      turnBtn.onclick = () => {
        setTurnWaypoint(idx);
        if (typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
        if (typeof persist === 'function') persist();
        if (typeof refreshLegDirEnabled === 'function') refreshLegDirEnabled();
        if (typeof refreshTurnDependentControls === 'function') refreshTurnDependentControls();
        draw();
        showInspector();      // relabel to what the button now does
      };
      body.appendChild(turnBtn);
      if (status) body.appendChild(status);        // below the button, so pressing moves nothing
    }
  }
  finalizeInspectorActions(body);
  persistInspectorSelection();
  // The inspector owns its chosen position. If a dragged Print panel occupies
  // that space, move Print to the nearest free position instead of hiding either.
  const printBox = document.querySelector('.modal-back.export-options .modal.export-floating');
  if (printBox && typeof floatingPanelPosition === 'function') {
    const r = printBox.getBoundingClientRect();
    setFloatingPanelPosition(printBox, floatingPanelPosition(printBox, insp, r.left, r.top));
  }
}
function colorRow(label, value, onChange, defaultValue) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = value || NOTE_DEFAULT_COLOR;
  inp.oninput = () => onChange(inp.value);
  row.append(l, inp);
  // Optional ↻ reset to a default colour.
  if (typeof defaultValue === 'string' && defaultValue) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'slider-reset';
    reset.textContent = '↻';
    reset.title = (typeof S !== 'undefined' && S.sliderReset) || 'Reset to default';
    reset.setAttribute('aria-label', reset.title);
    reset.onclick = e => {
      e.preventDefault();
      inp.value = defaultValue;
      onChange(defaultValue);
    };
    row.appendChild(reset);
  }
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
function rangeRow(label, value, min, max, step, format, onChange, defaultValue) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(value);
  const val = document.createElement('span');
  val.className = 'slider-val';
  val.textContent = format(value);
  const apply = v => { val.textContent = format(v); onChange(v); };
  input.oninput = () => apply(parseFloat(input.value));
  row.append(l, input, val);
  // Optional ↻ reset to a default value.
  if (typeof defaultValue === 'number') {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'slider-reset';
    reset.textContent = '↻';
    reset.title = (typeof S !== 'undefined' && S.sliderReset) || 'Reset to default';
    reset.setAttribute('aria-label', reset.title);
    reset.onclick = e => {
      e.preventDefault();
      input.value = String(defaultValue);
      apply(defaultValue);
    };
    row.appendChild(reset);
  }
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
  // Dim resettable fields while they still hold the default value
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
// by the note inspector and the waypoint inspector so a
// freq-change point is edited from one panel either way.
function appendFreqEdit(body, note, editOptions) {
  if (!note.freqName) {
    note.freqName = (typeof commCalloutDefaults === 'function'
      ? commCalloutDefaults(note.cc).freqName : commNoteName(note));
  }
  if (!note.freq) note.freq = commNoteFreq(note);
  const opts = typeof commCallSignOptions === 'function'
    ? commCallSignOptions(note.cc) : [];
  let callSignSelect = null;
  let autoCheckbox = null;
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
  function autoDefault() {
    if (!note || !note.cc || typeof commCalloutDefaults !== 'function') return null;
    const def = commCalloutDefaults(note.cc);
    return def && def.freqName ? def : null;
  }
  function normalizedFreq(value) {
    return typeof commFormatFreq === 'function'
      ? commFormatFreq(value || '') : String(value || '').trim();
  }
  function callSignOptionFor(id) {
    return opts.find(o => typeof commCallSignOptionMatches === 'function'
      ? commCallSignOptionMatches(o, id)
      : String(o.id || o.label || '') === String(id || '')) || null;
  }
  function callSignOptionId(id) {
    const found = callSignOptionFor(id);
    return found ? found.id : '';
  }
  function isRouteAutoSelected() {
    const def = autoDefault();
    return !!(def && note.freqAuto === true &&
      callSignOptionId(def.freqName) === callSignOptionId(note.freqName) &&
      normalizedFreq(note.freq) === normalizedFreq(def.freq));
  }
  function syncAutoCheckbox() {
    if (autoCheckbox) autoCheckbox.checked = isRouteAutoSelected();
  }
  function syncCallSignSelect() {
    if (callSignSelect) {
      const id = callSignOptionId(note.freqName);
      if (id) callSignSelect.value = id;
    }
    syncAutoCheckbox();
  }
  function resetFreqToAuto() {
    const def = autoDefault();
    if (!def) return;
    note.freqName = def.freqName;
    note.freq = def.freq || '';
    note.freqAuto = true;
    syncCallSignSelect();
    if (freqInput) {
      freqInput.value = commNoteFreq(note) || note.freq || '';
      lastValidFreq = freqInput.value;
      setFreqInputValid(true);
    }
    updateTemplateHint();
    draw();
  }
  // Assigned once the frequency control exists; `var` so updateTemplateHint can run before
  // that point without tripping over a temporal dead zone.
  var freqNotamTarget = null;
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
    // Ring the frequency control when this call sign's tower is on a NOTAM frequency, the
    // same mark the airfield panel uses. The waypoint is where a pilot reads the frequency
    // they are about to call, so the mark belongs here more than anywhere.
    if (freqNotamTarget) {
      const chg = (opt && typeof commCallSignFreqChange === 'function')
        ? commCallSignFreqChange(opt.id) : null;
      freqNotamTarget.classList.toggle('freq-notam-changed', !!chg);
      freqNotamTarget.title = chg
        ? airfieldFreqNotamTitle(chg, (typeof commCallSignPublishedFreq === 'function'
          ? commCallSignPublishedFreq(opt.id) : ''))
        : '';
    }
    syncCallSignSelect();
  }
  if (opts.length) {
    const current = (note.freqName || '').trim();
    let selected = opts.find(o => typeof commCallSignOptionMatches === 'function'
      ? commCallSignOptionMatches(o, current)
      : o.label === current);
    const rows = [];
    if (!selected && current) {
      selected = { id: '__custom__', label: current };
      rows.push(['__custom__', current]);
    }
    rows.push(...opts.map(o => [o.id, o.label]));
    const callSignRow = selectRow(S.commChangeName || 'Call sign',
      selected ? selected.id : opts[0].id,
      rows, v => {
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
    callSignSelect = callSignRow.querySelector('select');
    if (autoDefault() && callSignSelect) {
      const controls = document.createElement('div');
      controls.className = 'commchange-name-controls';
      const autoInline = document.createElement('span');
      autoInline.className = 'commchange-auto-inline';
      autoCheckbox = document.createElement('input');
      autoCheckbox.type = 'checkbox';
      autoCheckbox.className = 'commchange-auto-checkbox';
      autoCheckbox.setAttribute('aria-label', S.commChangeAuto || 'Auto');
      autoCheckbox.checked = isRouteAutoSelected();
      autoCheckbox.onchange = () => {
        if (autoCheckbox.checked) {
          resetFreqToAuto();
          return;
        }
        note.freqAuto = false;
        updateTemplateHint();
        draw();
      };
      const autoText = document.createElement('span');
      autoText.textContent = S.commChangeAuto || 'Auto';
      autoInline.append(autoCheckbox, autoText);
      callSignSelect.remove();
      controls.append(autoInline, callSignSelect);
      callSignRow.appendChild(controls);
    }
    body.appendChild(callSignRow);
  } else {
    const callSignRow = inputRow(S.commChangeName || 'Call sign', commNoteName(note) || '', v => {
      note.freqName = String(v || '').trim();
      note.freqAuto = false;
      updateTemplateHint();
      draw();
    });
    callSignRow.classList.add('commchange-name-row');
    const callSignInput = callSignRow.querySelector('input');
    if (callSignInput) callSignInput.dir = 'auto';
    body.appendChild(callSignRow);
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
  freqNotamTarget = freqControl;
  updateTemplateHint();
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
    reset.textContent = S.resetFreqLocation || S.resetLegMarkers || '↻';
    reset.title = S.resetFreqLocationTitle || 'Reset callout location';
    reset.setAttribute('aria-label', reset.title);
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
      if (note.cc && isKnownCommChangeKey(waypointFreqChangeKey({ name: note.cc })) &&
          typeof suppressCommChange === 'function') {
        suppressCommChange(note.cc);
      }
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
// Overlay markers (VOR / airfield / nav-WP / NOTAM) are not draggable, so map
// panning stays enabled over them — which means selection must NOT happen on
// mousedown (a pan started on a marker would pop the inspector). The action is
// parked here and committed by the map 'click' handler, which Leaflet only
// fires when the pointer did not drag.
let pendingOverlayAction = null;
map.on('dragstart', () => { pendingOverlayAction = null; });

function dragOriginExclude(d, latlng) {
  if (!d || d.originSnapArmed) return null;
  if (!Number.isFinite(d.origLat) || !Number.isFinite(d.origLng)) return null;
  const origin = map.latLngToContainerPoint([d.origLat, d.origLng]);
  const cur = map.latLngToContainerPoint([latlng.lat, latlng.lng]);
  if (Math.hypot(cur.x - origin.x, cur.y - origin.y) > tune('originResnapArmPx')) {
    d.originSnapArmed = true;
    return null;
  }
  return { lat: d.origLat, lng: d.origLng };
}

// A tap commonly delivers one or two pointer-move frames. In add mode that
// gesture means "visit this waypoint again", not "drag this visit onto its
// neighbour and delete it". The existing origin re-snap distance is the
// deliberate-drag threshold; restore every coincident visit before treating
// sub-threshold movement as the tap the pilot intended.
function settleAddModeWaypointTap(d) {
  if (!d || d.kind !== 'wp' || !d.moved || d.originSnapArmed || state.mode !== 'add') {
    return false;
  }
  const indexes = [d.i].concat(d.also || []);
  for (const i of indexes) {
    const wp = state.waypoints[i];
    if (!wp) continue;
    wp.lat = d.origLat;
    wp.lng = d.origLng;
    if (typeof d.origName === 'string') wp.name = d.origName;
  }
  syncLegs();
  d.moved = false;
  return true;
}

// Precedence: if an item is already selected (its inspector is open) and the
// press lands on that SAME item, grab it for dragging — don't reopen the point
// chooser / re-select an item that merely overlaps it. Returns true if it set
// up a drag. Covers the reported case of moving a selected freq-change arrow
// that overlaps its waypoint.
function grabSelected(px, py, latlng) {
  const sel = state.selected;
  if (!sel) return false;
  // Precedence is scoped to the reported case: a selected note / freq-change
  // callout whose inspector is open. If the press is unambiguously on that same
  // note (hitNote already yields the note — it returns -1 when a route waypoint
  // sits under the cursor, so an overlap still surfaces the point chooser), drag
  // the note instead of re-selecting. Waypoints and leg/cum kites already drag
  // via their own hit-tests, and giving them precedence here would swallow the
  // overlap chooser (issue: a selected waypoint under a freq arrow), so they're
  // deliberately not handled.
  const noteHit = hitNote(px, py);
  if (noteHit >= 0) {
    const isSelFreq = sel.type === 'wp' && sel.freqNoteIndex === noteHit;
    const isSelNote = sel.type === 'note' && sel.index === noteHit;
    if (isSelFreq || isSelNote) {
      state.selected = selectionForNoteHit(noteHit);
      drag = { kind: 'note', i: noteHit,
               offLat: state.notes[noteHit].lat - latlng.lat,
               offLng: state.notes[noteHit].lng - latlng.lng };
      drag.heldMap = holdMapForDrag('note');
      draw();                     // panel waits for the release: see TAP_OPENS_INSPECTOR_KINDS
      return true;
    }
  }
  return false;
}

// A pinch is not a tap. A two-finger zoom ends with a synthesized click, and on a
// phone that opened the inspector for whatever waypoint happened to be under the
// fingers. Leaflet suppresses the click that follows a DRAG, but nothing covers
// multi-touch gestures, so track them and swallow taps for a moment afterwards.
let _multiTouchUntil = 0;
const MULTI_TOUCH_GRACE_MS = 700;
(function armMultiTouchGuard() {
  const el = document.getElementById('map');
  if (!el) return;
  const mark = () => { _multiTouchUntil = Date.now() + MULTI_TOUCH_GRACE_MS; };
  el.addEventListener('touchstart', e => { if (e.touches && e.touches.length > 1) mark(); }, { passive: true });
  // Lifting one finger of a pinch leaves the other down — still a gesture, not a tap.
  el.addEventListener('touchend', e => { if (e.touches && e.touches.length >= 1) mark(); }, { passive: true });
})();
function touchGestureInProgress() { return Date.now() < _multiTouchUntil; }

// A loop visits one place twice, so a press there hits two waypoints at the SAME coordinates.
// The chooser has nothing to choose between -- and worse, it consumed the press, so the shared
// point of a closed route could not be dragged at all. Collapse those candidates to one drag
// that carries every index at that place, which keeps the loop closed while it moves.
function coincidentWaypointIndices(hits) {
  if (!hits || hits.length < 2) return null;
  const first = state.waypoints[hits[0].index];
  if (!first) return null;
  for (const h of hits) {
    const wp = state.waypoints[h.index];
    // Exact coordinates AND the same name: that is what a repeated VISIT to one point looks
    // like, because extending the route through a waypoint copies all three fields. Anything
    // merely close -- even inside sameMapPoint's ~22 m -- can be two real waypoints a pilot
    // needs to pick between, so it still gets the chooser.
    if (!wp || wp.lat !== first.lat || wp.lng !== first.lng ||
        (wp.name || '') !== (first.name || '')) return null;
  }
  return hits.map(h => h.index);
}

// In ADD mode a press on a waypoint EXTENDS the route through that point instead of opening
// its inspector: that is how a loop is drawn, by pressing the point you want to come back to.
// Only a press without movement -- a drag still repositions the waypoint, so you can nudge the
// point you just placed without leaving the mode. Returns true when it consumed the release.
// Splice the published corridor between the route's previous point and a just-added one.
// Every add path goes through here -- the map tap, the inspector's "Add to route", and
// extend-through -- because a pilot who adds a point by button expects the same route a
// tap would have drawn. Async (the graph loads lazily) and self-cancelling: if the route
// changed under the await, nothing is spliced.
function autoRouteSpliceAfterAdd(prevWp, newWp) {
  if (!prevWp || !newWp || typeof autoRouteChain !== 'function') return;
  autoRouteChain(prevWp, newWp).then(mid => {
    if (!mid || !mid.length) return;
    const idx = state.waypoints.indexOf(newWp);
    if (idx < 1 || state.waypoints[idx - 1] !== prevWp) return;
    // Capture what is selected BEFORE the indices shift, and re-point that -- not newWp.
    // Blindly re-selecting the added point hijacked whatever the pilot selected during the
    // await and yanked the inspector onto it; and a leg selection past the insertion point
    // silently showed a different leg's data once the indices moved.
    const sel = state.selected;
    const selWp = (sel && sel.type === 'wp') ? state.waypoints[sel.index] : null;
    state.waypoints.splice(idx, 0, ...mid);
    syncLegs();
    if (typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
    if (selWp) {
      const at = state.waypoints.indexOf(selWp);
      if (at >= 0) state.selected = { type: 'wp', index: at };
    } else if (sel && sel.type === 'leg' && sel.index >= idx) {
      state.selected = { type: 'leg', index: sel.index + mid.length };
    }
    draw();
    if (typeof showInspector === 'function' && state.selected) showInspector();
  }).catch(() => {});
}

function addModeExtendThroughWaypoint(i) {
  if (state.mode !== 'add') return false;
  const src = state.waypoints[i];
  if (!src) return false;
  const tail = state.waypoints[state.waypoints.length - 1];
  // Repeating the point the next leg would start from is the one case
  // that makes a zero-length leg. Pressing the last waypoint therefore does nothing.
  if (tail && typeof sameMapPoint === 'function' && sameMapPoint(tail, src)) return false;
  const next = { lat: src.lat, lng: src.lng, name: src.name };
  // Tapping back and forth between two points is how a-b-a-b gets built. The second pass
  // closes the sortie; a third has nowhere of its own to be drawn.
  if (typeof routeAllowsNextPoint === 'function' && !routeAllowsNextPoint(next)) {
    if (typeof showToast === 'function') showToast(S.trackFlownTwiceToast ||
      'This leg is already flown out and back');
    return true;                 // handled: the tap did something, it just was not an add
  }
  state.waypoints.push(next);
  syncLegs();
  if (typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
  state.selected = { type: 'wp', index: state.waypoints.length - 1 };
  draw();
  if (tail) autoRouteSpliceAfterAdd(tail, state.waypoints[state.waypoints.length - 1]);
  return true;
}

// Is the map primed to start a route? True only while the one-time empty-route hint is on
// screen with no route yet: that is the window in which a press on a chart point should
// fall through to the add path instead of opening its inspector, and in which a plain
// click arms add mode. Gating both on the same predicate keeps them from disagreeing --
// when only the arm was gated, a returning user clicking an airfield on an empty map got
// neither behaviour: no waypoint AND no inspector.
function routePrimingArmed() {
  if (state.waypoints && state.waypoints.length) return false;
  return !!document.getElementById('empty-route-hint');
}

map.on('mousedown', e => {
  if (touchGestureInProgress()) return;
  pendingOverlayAction = null;
  const p = e.containerPoint;
  // Hit-test priority matches paint order so the topmost element wins:
  // notes are drawn above waypoints (draw.js), so test notes first.
  const includeOverlayChoices = state.mode !== 'add' && state.mode !== 'note';
  const wpHits = hitWaypointCandidates(p.x, p.y);
  // A click inside a waypoint dot is unambiguously that waypoint, even though
  // the comm-callout arrow is anchored at the dot's (stroke-dependent) edge and
  // can nominally reach the centre at thin stroke widths. Drop a callout choice
  // for its own waypoint — mirrors hitNote()'s guard (top of file) so dead-centre
  // selects the dot while arrow/tail clicks still pick the callout.
  const wpHitSet = new Set(wpHits.map(h => h.index));
  const commHits = hitCommCalloutCandidates(p.x, p.y).filter(c => {
    const wi = commCalloutWaypointIndex(state.notes[c.index]);
    return !(wi >= 0 && wpHitSet.has(wi));
  });
  let ovHits = includeOverlayChoices ? hitOverlayMarkerCandidates(p.x, p.y) : [];
  // While the map is PRIMED (see routePrimingArmed: empty route and the hint still up), a
  // press on a CHART POINT falls through to the add path instead of being consumed as a
  // selection — clicking the named points you want to route between is the obvious gesture
  // for a first route. Only `chartPoint` candidates are dropped, so comm-change rings stay
  // in the chooser and VOR / NOTAM stay inspectable. Once the hint is gone those points are
  // inspectable again, which is what a returning user expects from a click.
  const primingRoute = includeOverlayChoices && routePrimingArmed();
  if (primingRoute) ovHits = ovHits.filter(h => !h.chartPoint);
  // NOTAM areas / lines / badges are clickable too — include them as overlay
  // choices so an overlap surfaces the multi-selector. Waypoints stay higher
  // priority (so they remain draggable inside large NOTAM areas); a NOTAM-only
  // click opens its text.
  const notamHits = (includeOverlayChoices && window.showNotam && typeof notamsAtLatLng === 'function')
    ? notamsAtLatLng(e.latlng).map(n => ({ type: 'notam', notam: n })) : [];
  // LSA bubbles are clickable like NOTAM areas -- last in the chooser, because a bubble
  // covers a lot of map and everything drawn on top of it should win the plain click.
  const bubbleHits = (includeOverlayChoices && typeof lsaAreasAtLatLng === 'function')
    ? lsaAreasAtLatLng(e.latlng).map(i => ({ type: 'lsaArea', index: i })) : [];
  const airspaceHits = (includeOverlayChoices && typeof airspaceAtLatLng === 'function')
    ? airspaceAtLatLng(e.latlng).map(i => ({ type: 'airspace', index: i })) : [];
  const ovAll = ovHits.concat(notamHits, bubbleHits, airspaceHits);
  // Already-selected item wins: if the press is on the item whose inspector is
  // open, drag it rather than surfacing the chooser for an overlapping item.
  if (includeOverlayChoices && grabSelected(p.x, p.y, e.latlng)) {
    downHit = true;
    return;
  }
  // A NOTAM airport count-badge sits just below the field; when a route waypoint
  // is on the same field it used to cover/block the badge. The badge now draws
  // on top, and wins the click here so its NOTAMs stay selectable.
  if (includeOverlayChoices && typeof notamBadgeNotamsAt === 'function') {
    const badge = notamBadgeNotamsAt(e.latlng);
    if (badge.length) {
      downHit = true;
      pendingOverlayAction = () => {
        showNotamBadgeModal(badge);
      };
      return;
    }
  }
  const commChoiceHits = commHits.concat(wpHits, ovAll);
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
    drag.heldMap = holdMapForDrag('note');
    draw();                       // panel waits for the release: see TAP_OPENS_INSPECTOR_KINDS
    return;
  }
  const coincident = coincidentWaypointIndices(wpHits);
  if (coincident) {
    // Same place, more than one visit: drag them together rather than asking which.
    const lead = coincident[0];
    downHit = true;
    state.selected = { type: 'wp', index: lead };
    drag = { kind: 'wp', i: lead, also: coincident.slice(1), moved: false,
             origLat: state.waypoints[lead].lat, origLng: state.waypoints[lead].lng,
             origName: state.waypoints[lead].name, originSnapArmed: false };
    drag.heldMap = holdMapForDrag('wp');
    draw();
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
             origName: state.waypoints[wp].name, originSnapArmed: false };
    drag.heldMap = holdMapForDrag('wp');
    // Highlight now, but defer the inspector to release-without-move so you can
    // drag a waypoint (or grab one while panning) without the panel popping up.
    draw();
    return;
  }
  // Kite labels (cum-time / altitude-speed) are chart decoration, not route structure --
  // grabbing one for a drag makes no sense mid-placement, and their default offsets can
  // drift far enough (long/diagonal legs, a tall waypoint disc at high zoom) to sit right
  // on top of an unrelated waypoint the pilot is trying to add next. Add mode always means
  // "place a point here", so it skips kites entirely, same as it already skips VOR/airfield/
  // navWP overlay markers below.
  const cum = state.mode !== 'add' ? hitCumLabel(p.x, p.y) : null;
  if (cum) {
    downHit = true;
    _materialiseDefaultCumLabel(cum.i);
    drag = { kind: 'cumlabel', i: cum.i };
    state.selected = { type: 'leg', index: cum.i };
    drag.heldMap = holdMapForDrag('cumlabel');
    draw();                       // panel waits for the release: see KITE_DRAG_KINDS
    return;
  }
  const cumRet = state.mode !== 'add' ? hitCumLabelRet(p.x, p.y) : null;
  if (cumRet) {
    downHit = true;
    _materialiseDefaultCumLabelRet(cumRet.i);
    drag = { kind: 'cumlabelret', i: cumRet.i };
    state.selected = { type: 'leg', index: cumRet.i };
    drag.heldMap = holdMapForDrag('cumlabelret');
    draw();                       // panel waits for the release: see KITE_DRAG_KINDS
    return;
  }
  const lab = state.mode !== 'add' ? hitLegLabel(p.x, p.y) : null;
  if (lab) {
    downHit = true;
    _materialiseDefaultLegLabel(lab.i, lab.which);
    drag = { kind: 'label', i: lab.i, which: lab.which,
             ...legLabelDragGrab(lab.i, lab.which, p.x, p.y) };
    state.selected = { type: 'leg', index: lab.i };
    drag.heldMap = holdMapForDrag('label');
    draw();                       // panel waits for the release: see KITE_DRAG_KINDS
    return;
  }
  const leg = hitLeg(p.x, p.y);
  if (leg >= 0) {
    downHit = true;
    // Kept so a pan that merely started on a leg can put the selection back -- the touch
    // path has done this for `legtap` all along.
    const prevSel = state.selected;
    state.selected = { type: 'leg', index: leg };
    // The map pans under the finger: a leg press selects and opens on release, it does not
    // drag the leg anywhere. The touch handler has said so in its own comment since it was
    // written; the mouse path disabled the pan anyway, so pressing the route froze the chart.
    drag = { kind: 'legclick', prevSelected: prevSel };
    drag.heldMap = holdMapForDrag('legclick');
    draw();                       // panel waits for the release, as every other press does
    return;
  }
  // Outside edit mode, a click on a VOR / airfield / nav-WP marker opens its
  // read-only inspector. Not draggable, so leave map panning enabled.
  if (includeOverlayChoices) {
    // Many stacked NOTAMs (e.g. an airport badge) → open the scrollable NOTAM
    // list directly instead of the point picker, which doesn't scroll.
    if (ovAll.length > 1 && ovAll.every(c => c.type === 'notam')) {
      downHit = true;
      pendingOverlayAction = () => {
        if (typeof showNotamModal === 'function') showNotamModal(ovAll.map(c => c.notam));
      };
      return;
    }
    if (ovAll.length > 1) {
      downHit = true;
      pendingOverlayAction = () => showPointChoice(ovAll);
      return;
    }
    if (ovAll.length) {
      downHit = true;
      pendingOverlayAction = () => {
        if (ovAll[0].type === 'notam') {
          if (typeof showNotamModal === 'function') showNotamModal([ovAll[0].notam]);
        } else {
          state.selected = ovAll[0];
          showInspector(); draw();
        }
      };
      return;
    }
  }
  if (pageSize && hitPageFrameEdge(p.x, p.y)) {
    downHit = true;
    // Print layout, not the route: the lock has never covered it, and it does drag.
    drag = { kind: 'page', lx: p.x, ly: p.y, heldMap: true };
    map.dragging.disable();
    return;
  }
  downHit = false;                     // empty space -> Leaflet pans
});

// A locked press leaves Leaflet its pan, so the map can move while `drag`/`touchDrag` is
// still pending. That is a drag of the CHART, not a tap on the thing under the finger --
// mark it, or letting go re-opens the panel every time the pilot slides the map by a
// waypoint.
map.on('movestart', () => {
  // A press that left Leaflet its pan -- locked, or a leg press, which never drags anything
  // -- can have the map move under it while the press is still pending. That is a drag of
  // the CHART, not a tap on what is under the finger: mark it, or letting go re-opens the
  // panel every time the pilot slides the map past a waypoint or along a leg.
  //
  // Mouse only, deliberately. Leaflet's Draggable starts a pan at clickTolerance = 3px while
  // the app calls a touch gesture a drag at touchDragPx = 10, so marking a touch press here
  // overrode the app's own threshold with a smaller one: a fingertip wobbling 4px while
  // tapping stopped opening the panel. That is what broke the leg tap, and it broke every
  // LOCKABLE kind the same way while the route was locked -- heldMap is false for those too.
  // The touchmove handler already sets `moved` once past the slop, for the locked kinds and
  // for legs alike, so it is the one place that decision belongs. A mouse does not wobble.
  if (drag && !drag.heldMap) drag.moved = true;
});

map.on('mousemove', e => {
  if (!drag) {
    // Pointer cursor over clickable NOTAM areas/badges (select mode only).
    if (window.showNotam && state.mode !== 'add' && state.mode !== 'note' &&
        typeof notamsAtLatLng === 'function') {
      map.getContainer().style.cursor = notamsAtLatLng(e.latlng).length ? 'pointer' : '';
    }
    return;
  }
  const p = e.containerPoint;
  if (typeof setLiveDragging === 'function') setLiveDragging(true);  // collapse this drag's frames into one undo entry
  // Locked (GPS/sim connected): leave drag.moved false and do nothing. On mouseup that
  // reads as a plain click, not a drag -- the inspector still opens normally (endMouseDrag's
  // own !drag.moved path), only the layout edit is skipped.
  if (dragLockedNow(drag.kind)) return;
  if (drag.kind === 'wp') {
    drag.moved = true;
    const wp = state.waypoints[drag.i];
    const r = applyNavSnap(e.latlng, wp.name || '', dragOriginExclude(drag, e.latlng));
    wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
    // Every other visit to the same place moves with it, so a loop stays closed.
    for (const j of (drag.also || [])) {
      const other = state.waypoints[j];
      if (other) { other.lat = wp.lat; other.lng = wp.lng; other.name = wp.name; }
    }
    scheduleDraw();   // move silently — but keep an already-open inspector in sync
    if (!document.getElementById('inspector').classList.contains('hidden')) showInspector();
  } else if (drag.kind === 'note') {
    drag.moved = true;
    const n = state.notes[drag.i];
    if (n && n.rp) {
      setReportPointTFromScreen(n, p.x, p.y);   // constrained to slide along its leg
    } else {
      n.lat = r5(e.latlng.lat + (drag.offLat || 0));
      n.lng = r5(e.latlng.lng + (drag.offLng || 0));
    }
    scheduleDraw();
  } else if (drag.kind === 'label') {
    drag.moved = true;
    if (setLegLabelFromPoint(drag, p.x, p.y)) scheduleDraw();
  } else if (drag.kind === 'cumlabel' || drag.kind === 'cumlabelret') {
    drag.moved = true;
    setCumLabelFromPoint(drag.i, drag.kind === 'cumlabelret', p.x, p.y);
    scheduleDraw();
  } else if (drag.kind === 'page') {
    pageOffset.x += p.x - drag.lx;
    pageOffset.y += p.y - drag.ly;
    drag.lx = p.x; drag.ly = p.y;
    clampPageOffset();
    scheduleDraw();
  }
});

// Re-enable map dragging on release anywhere, not just inside the map.
// Listening to map.on('mouseup') alone misses releases over the toolbar /
// browser chrome and leaves the map permanently unpannable.
// Anything hidden FOR the drag -- the frequency callout whose end is moving (draw.js's
// commCalloutDragging) -- is only restored by a repaint that happens after the drag state
// is gone. Every draw() inside the release path still sees `drag`/`touchDrag` set, so the
// callout stayed hidden until some later interaction happened to repaint: reported as the
// arrow vanishing until the waypoint was pressed. Clearing and repainting therefore travel
// together, on every exit path.
function clearDragAndRedraw(which) {
  if (which === 'touch') touchDrag = null; else drag = null;
  if (typeof scheduleDraw === 'function') scheduleDraw(); else if (typeof draw === 'function') draw();
}

function endMouseDrag() {
  if (drag) {
    // Pressing a leg selects it, which is right for a click and wrong for a pan: the pilot
    // was moving the chart, and a highlighted leg with no panel explains nothing. The touch
    // path has put the old selection back for `legtap` all along; the mouse path did not,
    // so a pan that started on a leg left it highlighted -- and, if the inspector was
    // already open on something else, retargeted the panel to that leg.
    if (drag.kind === 'legclick' && drag.moved) {
      state.selected = drag.prevSelected || null;
      draw();
    }
    settleAddModeWaypointTap(drag);
    if (drag.kind === 'wp' && drag.moved) {
      const wp = state.waypoints[drag.i];
      const snappedToSelf = sameMapPoint(wp, { lat: drag.origLat, lng: drag.origLng });
      // Dropped on the waypoint NEXT to it: the delete gesture. It used to be any waypoint
      // at all, which is what made a circular route impossible to draw -- dragging the last
      // waypoint onto the first deleted it instead of closing the route.
      if (routeNeighbourAtPoint(drag.i, wp)) {
        deleteWaypoint(drag.i);   // removes the adjacent leg too; bare splice+syncLegs would drop the tail leg and misalign the rest
        state.selected = null;
        showInspector(); draw();
        if (typeof setLiveDragging === 'function') setLiveDragging(false);   // commit one undo entry for the whole drag
        map.dragging.enable();
        clearDragAndRedraw();
        return;
      }
      // Landed on another waypoint that is NOT a neighbour: the two are the same place now,
      // so it takes that point's name. Keeping the old one left a closed route whose last
      // waypoint said "TWO" while sitting on LLHZ -- and the flight plan reads the NAME, so
      // the destination filed as ZZZZ instead of the field the aircraft lands at.
      const onIdx = routeWaypointAtPoint(wp, drag.i);
      if (onIdx !== -1 && state.waypoints[onIdx].name) {
        wp.name = state.waypoints[onIdx].name;
      }
      // Picked up and put back without ever leaving: a cancel, as in every drag UI. This
      // used to delete the waypoint, and `moved` is set by a single pixel -- so at high zoom
      // a 2px nudge was enough to lose it.
      if (snappedToSelf && !drag.originSnapArmed) {
        wp.lat = drag.origLat; wp.lng = drag.origLng;
        if (typeof drag.origName === 'string') wp.name = drag.origName;
        // Every visit the drag carried goes back too, or a cancelled drag would leave the
        // loop's two ends in different places.
        for (const j of (drag.also || [])) {
          const other = state.waypoints[j];
          if (other) {
            other.lat = drag.origLat; other.lng = drag.origLng;
            if (typeof drag.origName === 'string') other.name = drag.origName;
          }
        }
        syncLegs();
      }
    }
    // A waypoint drag may have landed (snapped) on a comm-change point.
    // Seed its note now that the position is committed, then repaint.
    let changed = false;
    if (drag.kind === 'wp' && drag.moved) {
      changed = applyLegAltitudesToRoute();
      if (typeof seedCommChangeNotes === 'function' && seedCommChangeNotes()) changed = true;
    }
    if (changed) draw();
    // Open the inspector on a clean waypoint click (released without a move);
    // a drag-to-reposition leaves a closed inspector closed, but refreshes one
    // that was already open (e.g. snapping onto a comm-change point).
    if (drag.kind === 'wp' && !drag.moved && addModeExtendThroughWaypoint(drag.i)) {
      // Extended the route through this point; no inspector, and the new waypoint is selected.
      if (typeof setLiveDragging === 'function') setLiveDragging(false);
      map.dragging.enable();
      clearDragAndRedraw();
      return;
    }
    if (drag.kind === 'wp') {
      const inspOpen = !document.getElementById('inspector').classList.contains('hidden');
      if (!drag.moved || inspOpen) showInspector();
    }
    if (drag.kind !== 'wp' && TAP_OPENS_INSPECTOR_KINDS.indexOf(drag.kind) !== -1) {
      // Byte for byte the waypoint rule above: a tap opens the panel, a drag leaves a shut
      // panel shut, and a panel that was already open before the gesture refreshes rather
      // than vanishing. The selection is left alone -- a drag of the comm-change tail keeps
      // its waypoint selected, which is what carries the freq note through the gesture.
      const inspOpen = !document.getElementById('inspector').classList.contains('hidden');
      if (!drag.moved || inspOpen) showInspector();
    }
    if (typeof setLiveDragging === 'function') setLiveDragging(false);   // commit one undo entry for the whole drag
    map.dragging.enable();
    clearDragAndRedraw();
  }
}
window.addEventListener('mouseup', endMouseDrag);
window.addEventListener('pointerup', endMouseDrag);
window.addEventListener('pointercancel', endMouseDrag);

map.on('click', e => {
  // Tail end of a pinch — see the multi-touch guard above. Also drops any action the
  // gesture's first touch parked, so a zoom can't add a waypoint either.
  if (touchGestureInProgress()) { pendingOverlayAction = null; downHit = false; return; }
  // Commit a parked overlay action — reached only when the mousedown did not
  // turn into a pan (Leaflet suppresses 'click' after a drag).
  if (pendingOverlayAction) {
    const act = pendingOverlayAction;
    pendingOverlayAction = null;
    downHit = false;
    act();
    return;
  }
  if (downHit) { downHit = false; return; }
  // Tap an AIRMET area (in inspect mode, nothing higher-priority hit) to read its text --
  // a polygon labelled only "MT OBSC" does not carry the validity or movement. Inspect mode
  // only, so it never competes with dropping a waypoint in add/note mode.
  if (!state.mode && window.showAirmet && typeof airmetsAtLatLng === 'function'
      && typeof showAirmetDecoded === 'function' && airmetsAtLatLng(e.latlng).length) {
    showAirmetDecoded();
    return;
  }
  // NOTAM clicks are handled in mousedown (as overlay choices); see there.
  // First click on an empty route ARMS add mode -- but only while the one-time hint is
  // actually on screen telling the user to do it. Keying this off "route is empty" alone
  // meant every returning user got a waypoint dropped whenever they clicked open map with
  // no route loaded: they had already learned the app, cleared the map, clicked to look at
  // something, and got an unwanted point plus add mode armed. The affordance now lives
  // exactly as long as the instruction that explains it; afterwards, add mode is entered
  // deliberately (Edit menu, or the A key) and a plain click does nothing, as before.
  // A locked route takes no new points: setMode refuses to arm the tool, and this is the other
  // half of it -- a mode entered before the lock (or the first-click priming above) must not
  // drop a waypoint either.
  if (typeof routeEditLocked === 'function' && routeEditLocked()) return;
  if (!state.mode && routePrimingArmed()) {
    if (typeof setMode === 'function') setMode('add');
  }
  if (state.mode === 'add') {
    const r = applyNavSnap(e.latlng, '');
    // Ignore the click when it lands on the point the next leg would start from --
    // that, and only that, produces a duplicate at the same coords and a leg with zero
    // distance. Any EARLIER waypoint is fair game: clicking the departure field again is how
    // a local sortie is closed into a circular route, and a route may pass a point twice.
    const tail = state.waypoints[state.waypoints.length - 1];
    if (tail && sameMapPoint(tail, r)) {
      return;
    }
    const tail0 = state.waypoints[state.waypoints.length - 1];
    const next = { lat: r5(r.lat), lng: r5(r.lng), name: r.name };
    if (typeof routeAllowsNextPoint === 'function' && !routeAllowsNextPoint(next)) {
      if (typeof showToast === 'function') showToast(S.trackFlownTwiceToast ||
        'This leg is already flown out and back');
      return;
    }
    state.waypoints.push(next);
    syncLegs();
    if (typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
    // Auto-route: splice the published corridor between the old tail and the new point.
    // Async by nature (the graph loads lazily); the direct leg shows first and the
    // corridor points slot in when the chain resolves -- one draw, one undo state.
    if (tail0) autoRouteSpliceAfterAdd(tail0, state.waypoints[state.waypoints.length - 1]);
    state.selected = { type: 'wp', index: state.waypoints.length - 1 };
    // On phones the inspector is a near-full-screen panel that blankets the
    // map, so auto-opening it after every add-mode tap hides the chart while
    // you're still placing waypoints. Keep it closed on narrow viewports —
    // the new waypoint is still selected; tap it to open the inspector and
    // edit its name. (Note mode below still opens it: typing the note needs it.)
    if (!(window.matchMedia && window.matchMedia('(max-width: 680px)').matches)) {
      showInspector();
    }
    draw();
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
    // Close only the TOP-MOST modal (last appended), never the first in the DOM
    // — otherwise a satellite picture stacked over the route mosaic closed the
    // mosaic underneath. Modals built by createDraggableModal carry their own
    // (top-most-guarded) Escape handler and a _navaidClose; defer to those so
    // we don't double-close and race their guard. Only close here the plain
    // modals that have no self-handling (no _navaidClose).
    const modals = document.querySelectorAll('.modal-back');
    if (modals.length) {
      const top = modals[modals.length - 1];
      if (typeof top._navaidClose !== 'function') { top.remove(); return; }
      return;   // top self-handles via its own onEsc
    }
    if (magnifierOn) { toggleMagnifier(); return; }
    if (state.selected) {
      state.selected = null;
      showInspector(); draw();
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) t.blur();
      return;
    }
    if (shortcutTypingTarget(t)) {
      return;
    }
    if (state.mode === 'add' || state.mode === 'note') {
      e.preventDefault();
      if (typeof setMode === 'function') setMode(null);
      draw();
      return;
    }
    // Nothing selected, no mode -- but the map may still be PRIMED on a fresh session, where
    // a click drops the first waypoint. That is a mode in everything but name, so Escape
    // leaves it too rather than doing nothing at all.
    if (typeof dismissRoutePriming === 'function' && dismissRoutePriming()) {
      e.preventDefault();
      draw();
    }
    return;
  }
  if (shortcutTypingTarget(t)) {
    return;                              // typing in a field — leave the WP alone
  }
  // A blocking modal owns the keyboard. Zoom and the mode keys already checked for a backdrop
  // (further down), but the ROUTE-EDITING keys below did not: with the NOTAM list or the
  // charts dialog open, focus sits on one of its buttons -- not a typing target -- and Tab is
  // trapped inside it, so Backspace is the natural "go back". That deleted the selected
  // waypoint behind the dialog, silently, with the route and the filed plan one point short.
  // Undo (Ctrl-Z) is deliberately still allowed: it is a recovery key, not a route edit.
  const modalOpen = !!document.querySelector('.modal-back');
  // Ctrl/Cmd-Z undoes the last committed edit. Shift-Ctrl-Z (redo) is left
  // alone — there is no redo, so don't swallow it.
  if (shortcutKey(e, 'KeyZ', 'z') && (e.ctrlKey || e.metaKey) &&
      !e.altKey && !e.shiftKey) {
    e.preventDefault();
    if (typeof undo === 'function') undo();
    return;
  }
  // '?' (Shift-/) opens the keyboard-shortcuts cheat-sheet.
  // Suppressed in inputs (handled by the early return above) so typing a
  // literal '?' in a waypoint name or note still works. Most browsers
  // surface this key as `e.key === '?'`, but some keyboard layouts /
  // automation harnesses fire `e.key === '/'` with `shiftKey: true`, so
  // accept both.
  if (!e.ctrlKey && !e.metaKey && !e.altKey &&
      (e.key === '?' || ((e.key === '/' || e.code === 'Slash') && e.shiftKey))) {
    e.preventDefault();
    if (typeof showShortcutsHelp === 'function') showShortcutsHelp();
    return;
  }
  // F (no modifier) fits the active paper frame when one is
  // selected, otherwise it re-runs fit-to-route. Ctrl/Cmd-F is the search
  // overlay shortcut handled in ui.js — bail out so we don't shadow it.
  if (shortcutPlain(e, 'KeyF', 'f')) {
    e.preventDefault();
    fitToScreen();
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
    if (shortcutPlain(e, 'KeyM', 'm')) {
      e.preventDefault();
      toggleMagnifier();
      return;
    }
    // A / N toggle the add-waypoint / add-note placement modes (same as the
    // toolbar buttons); C clears the map. Pressing the active mode's key
    // again toggles back to inspect, mirroring setMode()'s button behaviour.
    if (shortcutPlain(e, 'KeyA', 'a')) {
      e.preventDefault();
      if (typeof setMode === 'function') setMode('add');
      return;
    }
    if (shortcutPlain(e, 'KeyN', 'n')) {
      e.preventDefault();
      if (typeof setMode === 'function') setMode('note');
      return;
    }
    if (shortcutPlain(e, 'KeyC', 'c')) {
      e.preventDefault();
      const clearBtn = document.getElementById('clear');
      if (clearBtn) clearBtn.click();   // reuse the button's confirm + reset
      return;
    }
  }
  // X (no modifier): delete the freq-change callout linked to the selected waypoint.
  if (shortcutPlain(e, 'KeyX', 'x')) {
    if (modalOpen || !state.selected) return;
    const freqNote = selectedFreqNoteIndex();
    if (freqNote >= 0) {
      const note = state.notes[freqNote];
      // Suppress so seedCommChangeNotes() doesn't re-seed it on the next
      // drag/add/toggle — matches the other freq-note delete paths.
      if (note && note.cc && typeof suppressCommChange === 'function') suppressCommChange(note.cc);
      state.notes.splice(freqNote, 1);
      delete state.selected.freqNoteIndex;
      draw(); showInspector();
    }
    return;
  }
  // Z (no modifier): add a freq-change callout to a selected named waypoint.
  if (shortcutPlain(e, 'KeyZ', 'z')) {
    if (modalOpen || !state.selected || state.selected.type !== 'wp') return;
    const wp = state.waypoints[state.selected.index];
    if (!wp || !wp.name || !showCommChange) return;
    const ccKey = waypointFreqChangeKey(wp);
    if (!ccKey || freqChangeNoteForKey(ccKey)) return;
    const idx = addCommChangeNoteForWaypoint(wp, ccKey);
    if (idx >= 0) state.selected.freqNoteIndex = idx;
    draw(); showInspector();
    return;
  }
  // D (no modifier): delete the selected waypoint or note (freq callout goes with its waypoint).
  if (shortcutPlain(e, 'KeyD', 'd')) {
    if (modalOpen || !state.selected) return;
    deleteSelectedWpOrNote();
    return;
  }
  // Delete / Backspace: delete freq callout first, otherwise waypoint/note.
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (modalOpen || !state.selected) return;
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
  const rect = mapEl.getBoundingClientRect();
  const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  if (hitNote(p.x, p.y) >= 0) return;
  if (hitWaypointCandidates(p.x, p.y).length) return;
  if (hitCumLabel(p.x, p.y) || hitCumLabelRet(p.x, p.y) || hitLegLabel(p.x, p.y)) return;
  const leg = hitLeg(p.x, p.y);
  if (leg < 0) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  downHit = false;
  // A locked route takes no new points. Every other way of adding one checks this -- the
  // add-click, every waypoint and note drag -- and this one did not: with a position driving
  // the map the route locks itself, and a double-click on a leg still cut it in two and moved
  // a waypoint out from under the leg being flown. Silently, because the panel that would
  // have explained it is itself suppressed in flight.
  if (typeof routeEditLocked === 'function' && routeEditLocked()) return;
  splitLegAt(leg, map.containerPointToLatLng([p.x, p.y]));
}, true);

function touchXY(t) {
  const r = mapEl.getBoundingClientRect();
  return { x: t.clientX - r.left, y: t.clientY - r.top };
}

mapEl.addEventListener('touchstart', e => {
  touchLog('touchstart', 'fingers=' + e.touches.length);
  if (e.touches.length !== 1) return;
  const p = touchXY(e.touches[0]);
  // Second tap of a double tap: the first tap's panel goes back where it was, and this touch
  // is marked so its own release opens nothing either -- a double tap is not a request to
  // inspect. It does not zoom the chart when it lands on a route element: this handler takes
  // the gesture and suppresses the browser default, and Leaflet's doubleClickZoom listens
  // for the dblclick that default would have produced. Suppressing it is deliberate -- the
  // same default is what let a double tap on a LEG reach the dblclick handler and split the
  // route. Double-tap zoom still works everywhere the press hits no route element, which is
  // where a pilot zooming the chart is aiming.
  const wasDoubleTap = undoTapOpenIfDoubleTap(p.x, p.y);
  const selectionBeforeTouch = state.selected;
  // Hit-test priority matches paint order so the topmost element wins:
  // notes are drawn above waypoints (draw.js), so test notes first.
  const includeOverlayChoices = state.mode !== 'add' && state.mode !== 'note';
  const wpHits = hitWaypointCandidates(p.x, p.y);
  // A click inside a waypoint dot is unambiguously that waypoint, even though
  // the comm-callout arrow is anchored at the dot's (stroke-dependent) edge and
  // can nominally reach the centre at thin stroke widths. Drop a callout choice
  // for its own waypoint — mirrors hitNote()'s guard (top of file) so dead-centre
  // selects the dot while arrow/tail clicks still pick the callout.
  const wpHitSet = new Set(wpHits.map(h => h.index));
  const commHits = hitCommCalloutCandidates(p.x, p.y).filter(c => {
    const wi = commCalloutWaypointIndex(state.notes[c.index]);
    return !(wi >= 0 && wpHitSet.has(wi));
  });
  let ovHits = includeOverlayChoices ? hitOverlayMarkerCandidates(p.x, p.y) : [];
  // While the map is PRIMED (see routePrimingArmed: empty route and the hint still up), a
  // press on a CHART POINT falls through to the add path instead of being consumed as a
  // selection — clicking the named points you want to route between is the obvious gesture
  // for a first route. Only `chartPoint` candidates are dropped, so comm-change rings stay
  // in the chooser and VOR / NOTAM stay inspectable. Once the hint is gone those points are
  // inspectable again, which is what a returning user expects from a click.
  const primingRoute = includeOverlayChoices && routePrimingArmed();
  if (primingRoute) ovHits = ovHits.filter(h => !h.chartPoint);
  // NOTAM areas/lines/badges as overlay choices (see the mousedown handler).
  const notamHits = (includeOverlayChoices && window.showNotam && typeof notamsAtLatLng === 'function')
    ? notamsAtLatLng(map.containerPointToLatLng([p.x, p.y])).map(n => ({ type: 'notam', notam: n })) : [];
  const bubbleHits = (includeOverlayChoices && typeof lsaAreasAtLatLng === 'function')
    ? lsaAreasAtLatLng(map.containerPointToLatLng([p.x, p.y])).map(i => ({ type: 'lsaArea', index: i })) : [];
  // Airspace last for the same reason the bubbles are: it covers a lot of map, and
  // anything drawn on top of it should win a plain tap.
  const airspaceHits = (includeOverlayChoices && typeof airspaceAtLatLng === 'function')
    ? airspaceAtLatLng(map.containerPointToLatLng([p.x, p.y])).map(i => ({ type: 'airspace', index: i })) : [];
  const ovAll = ovHits.concat(notamHits, bubbleHits, airspaceHits);
  // Airport count-badge wins over a waypoint on the same field (see mousedown).
  if (includeOverlayChoices && typeof notamBadgeNotamsAt === 'function') {
    const badge = notamBadgeNotamsAt(map.containerPointToLatLng([p.x, p.y]));
    if (badge.length) {
      e.preventDefault();
      showNotamBadgeModal(badge);
      return;
    }
  }
  const commChoiceHits = commHits.concat(wpHits, ovAll);
  if (commHits.length && commChoiceHits.length > 1) {
    e.preventDefault();
    showPointChoice(commChoiceHits);
    return;
  }
  const note = hitNote(p.x, p.y);
  const activeWpHits = note < 0 ? wpHits : [];
  const activeOvHits = note < 0 ? ovAll : [];
  const wpAmbiguous = activeWpHits.length > 1;
  const wp = activeWpHits.length ? activeWpHits[0].index : -1;
  // Add mode always means "place a point here" -- kites (chart decoration, not route
  // structure) are skipped entirely, same as VOR/airfield/navWP overlay markers below.
  // See the matching comment on the mousedown handler for why.
  const kitesLive = state.mode !== 'add';
  const cum = (kitesLive && !wpAmbiguous && wp < 0 && note < 0) ? hitCumLabel(p.x, p.y) : null;
  const cumRet = (kitesLive && !wpAmbiguous && wp < 0 && note < 0 && !cum) ? hitCumLabelRet(p.x, p.y) : null;
  const lab = (kitesLive && !wpAmbiguous && wp < 0 && note < 0 && !cum && !cumRet) ? hitLegLabel(p.x, p.y) : null;
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
  } else if (coincidentWaypointIndices(activeWpHits)) {
    // A loop's shared point: one place, several visits. Drag them together instead of asking
    // which one was meant -- the chooser used to consume the press, so it could not be moved.
    const together = coincidentWaypointIndices(activeWpHits);
    const lead = together[0];
    touchDrag = { kind: 'wp', i: lead, also: together.slice(1), moved: false,
                  origLat: state.waypoints[lead].lat, origLng: state.waypoints[lead].lng,
                  origName: state.waypoints[lead].name, originSnapArmed: false };
    state.selected = { type: 'wp', index: lead };
  } else if (wpAmbiguous) {
    e.preventDefault();
    showPointChoice(activeWpHits);
    return;
  } else if (wp >= 0) {
    touchDrag = { kind: 'wp', i: wp, moved: false,
                  origLat: state.waypoints[wp].lat, origLng: state.waypoints[wp].lng,
                  origName: state.waypoints[wp].name, originSnapArmed: false };
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
    touchDrag = { kind: 'legtap', prevSelected: state.selected };
    state.selected = { type: 'leg', index: leg };
  } else if (onPage) {
    touchDrag = { kind: 'page', lx: p.x, ly: p.y };
  }

  // Outside edit mode, a tap on a VOR / airfield / nav-WP marker opens its
  // read-only inspector (no drag).
  if (!touchDrag && includeOverlayChoices) {
    if (activeOvHits.length > 1 && activeOvHits.every(c => c.type === 'notam')) {
      e.preventDefault();
      if (typeof showNotamModal === 'function') showNotamModal(activeOvHits.map(c => c.notam));
      return;
    }
    if (activeOvHits.length > 1) {
      e.preventDefault();
      showPointChoice(activeOvHits);
      return;
    }
    if (activeOvHits.length) {
      e.preventDefault();
      if (activeOvHits[0].type === 'notam') {
        if (typeof showNotamModal === 'function') showNotamModal([activeOvHits[0].notam]);
      } else {
        state.selected = activeOvHits[0];
        showInspector(); draw();
      }
      return;
    }
  }

  if (touchDrag) {
    touchDrag.wasDoubleTap = wasDoubleTap;
    touchDrag.selectionBefore = selectionBeforeTouch;
    touchDrag.pressedAt = Date.now();          // tap or grab is decided by how long it lasts
    touchLog('  grabbed', 'kind=' + touchDrag.kind + (touchDrag.wasDoubleTap ? ' dbltap' : ''));
    // Where the finger LANDED -- the threshold below measures from here. Seeding it from
    // the first touchmove instead made that move measure zero, so the guard let the first
    // (largest) jump through and only started counting afterwards.
    touchDrag.startX = p.x;
    touchDrag.startY = p.y;
    // Whether the pilot already had the panel up before this gesture. It is hidden for the
    // duration of a drag, so by release the class alone cannot answer -- and the mouse path
    // preserves a pre-gesture panel, which left tablets losing the inspector after every
    // label nudge while desktops kept it.
    touchDrag.inspWasOpen = !document.getElementById('inspector').classList.contains('hidden');
    // Two separate things, and tying them together was a bug in both directions.
    //
    // heldMap answers "does this gesture move something, so Leaflet must not pan?" -- false
    // when the route is locked (nothing is going to move) and for a leg press (which drags
    // nothing by design).
    //
    // preventDefault answers "has the app taken this gesture?", and the answer is always
    // yes: this branch only runs when the press hit something. Suppressing the default is
    // what kills the browser's compatibility mouse sequence -- without it a leg tap fires a
    // real mousedown/mouseup/click, two taps make a native dblclick, and the dblclick
    // handler above SPLITS THE LEG. A pilot double-tapping the chart to zoom in got their
    // route cut in two and a waypoint inserted. Leaflet pans from its own touch listeners,
    // not from the browser default, so suppressing it costs no panning.
    touchDrag.heldMap = holdMapForDrag(touchDrag.kind);
    e.preventDefault();              // suppress the synthetic mouse chain, and with it dblclick
    // Nothing opens here -- endTouch decides, once tap and drag can be told apart.
    draw();
  }
}, { passive: false });

mapEl.addEventListener('touchmove', e => {
  if (touchDrag && !touchDrag.moved) touchLog('touchmove', 'fingers=' + e.touches.length);
  // A press on a leg line does not drag anything -- the map pans under the finger instead --
  // so this handler deliberately keeps its hands off it: no preventDefault, nothing moved.
  // But it still has to NOTICE, because the release opens the leg inspector for a tap, and
  // browsing the chart with a finger that happened to land on the route was opening the panel
  // on every pan. Travel past the same slop the other drags use makes it a pan, not a tap.
  if (touchDrag && touchDrag.kind === 'legtap') {
    if (e.touches.length === 1 && touchDrag.startX != null && !touchDrag.moved) {
      const q = touchXY(e.touches[0]);
      const far = Math.hypot(q.x - touchDrag.startX, q.y - touchDrag.startY);
      if (far >= (typeof tune === 'function' ? tune('touchDragPx') : 10)) touchDrag.moved = true;
    }
    return;
  }
  if (!touchDrag || e.touches.length !== 1) return;
  // No pinch guard here, deliberately. A drag cannot survive a pinch to be resumed: endTouch
  // is bound to EVERY touchend with no remaining-finger check, and every path through it
  // ends in clearDragAndRedraw('touch'), so the lift that ends a pinch has already nulled
  // touchDrag -- the `!touchDrag` return above is what actually stops the teleport. A guard
  // added here fired only in the case it was not written for: for 700ms after any pinch it
  // swallowed a BRAND NEW one-finger drag, so a pilot who zoomed in and immediately grabbed
  // a waypoint got a dead drag. What protects the pinch-that-started-on-a-waypoint is
  // endTouch's own touchGestureInProgress() check, which marks it moved so the release is
  // not read as a tap.
  e.preventDefault();
  const p = touchXY(e.touches[0]);
  // A fingertip is ~10 mm across and never lands still, so a plain tap arrives with a few
  // pixels of travel. Below the threshold this is still a tap: nothing moves, and the
  // waypoint the finger came to open is not nudged out from under it. The dial has had the
  // same guard (rotDragPx) since it was built.
  if (touchDrag.startX == null) { touchDrag.startX = p.x; touchDrag.startY = p.y; }  // paths that set no start
  if (!touchDrag.moved && !touchDrag.dragArmed) {
    const far = Math.hypot(p.x - touchDrag.startX, p.y - touchDrag.startY);
    if (far < (typeof tune === 'function' ? tune('touchDragPx') : 10)) return;
    touchDrag.dragArmed = true;
  }
  const ll = map.containerPointToLatLng([p.x, p.y]);
  if (typeof setLiveDragging === 'function') setLiveDragging(true);  // collapse this drag's frames into one undo entry
  // Same lock as the mouse path -- see there for why leaving touchDrag.moved false is what
  // keeps a plain tap opening the inspector as normal. Past the slop it is no longer a plain
  // tap, though: the pilot is dragging across a locked chart, and the release must not open
  // the panel just because the lock stopped the drag from doing anything.
  if (dragLockedNow(touchDrag.kind)) { touchDrag.moved = true; return; }
  if (touchDrag.kind === 'wp') {
    if (!touchDrag.moved) setInspectorDragHidden(true);   // first real movement, not a tap
    touchDrag.moved = true;
    const wp = state.waypoints[touchDrag.i];
    const r = applyNavSnap(ll, wp.name || '', dragOriginExclude(touchDrag, ll));
    wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
    for (const j of (touchDrag.also || [])) {
      const other = state.waypoints[j];
      if (other) { other.lat = wp.lat; other.lng = wp.lng; other.name = wp.name; }
    }
    scheduleDraw();
  } else if (touchDrag.kind === 'note') {
    touchDrag.moved = true;
    setInspectorDragHidden(true);
    const n = state.notes[touchDrag.i];
    if (n && n.rp) {
      setReportPointTFromScreen(n, p.x, p.y);   // constrained to slide along its leg
    } else {
      n.lat = r5(ll.lat + (touchDrag.offLat || 0));
      n.lng = r5(ll.lng + (touchDrag.offLng || 0));
    }
    scheduleDraw();
  } else if (touchDrag.kind === 'label') {
    touchDrag.moved = true;
    setInspectorDragHidden(true);
    if (setLegLabelFromPoint(touchDrag, p.x, p.y)) scheduleDraw();
  } else if (touchDrag.kind === 'cumlabel' || touchDrag.kind === 'cumlabelret') {
    touchDrag.moved = true;
    setCumLabelFromPoint(touchDrag.i, touchDrag.kind === 'cumlabelret', p.x, p.y);
    scheduleDraw();
  } else if (touchDrag.kind === 'page') {
    pageOffset.x += p.x - touchDrag.lx;
    pageOffset.y += p.y - touchDrag.ly;
    touchDrag.lx = p.x; touchDrag.ly = p.y;
    clampPageOffset();
    scheduleDraw();
  }
}, { passive: false });

// The first tap of a DOUBLE tap is a tap: it opens whatever is under it. On a phone that is
// how a pilot zooms in on a waypoint, and the panel opened over the chart they were zooming
// into -- reported after the pinch fix as "still opens inspector". A double tap is only
// recognisable from its second tap, so the first one's effect is remembered and undone when
// that arrives: Leaflet's own double-tap window, and a distance a thumb can hold.
let _tapOpened = null;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 40;
// --- touch diagnostics (?touchlog=1) ------------------------------------------------------
// Four fixes into "holding a waypoint opens the inspector" it became clear that guessing at
// what a phone sends is the wrong way round: what a device does with a long press (does it
// cancel? does it fire a second touchstart? how long is the sequence?) differs between
// Android, iOS and every WebView in between. This prints the actual sequence on screen, on
// the device where it goes wrong, so the next fix answers a measurement rather than a guess.
//
// Off unless asked for by URL, so it cannot cost anything in flight.
function touchLogOn() {
  try { return new URLSearchParams(location.search).get('touchlog') === '1'; }
  catch (e) { return false; }
}
let _touchLogEl = null;
const _touchLog = [];
function touchLog(what, detail) {
  if (!touchLogOn()) return;
  const t = new Date();
  const stamp = String(t.getSeconds()).padStart(2, '0') + '.' +
    String(t.getMilliseconds()).padStart(3, '0');
  _touchLog.push(stamp + '  ' + what + (detail ? '  ' + detail : ''));
  while (_touchLog.length > 14) _touchLog.shift();
  if (!_touchLogEl) {
    _touchLogEl = document.createElement('div');
    _touchLogEl.id = 'touch-log';
    // Bottom-left, above the footer, and deliberately not interactive: it must never eat the
    // very touches it is there to record.
    _touchLogEl.style.cssText = 'position:fixed;left:6px;bottom:64px;z-index:4000;' +
      'max-width:min(94vw,460px);max-height:42vh;overflow:hidden;pointer-events:none;' +
      'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre;' +
      'color:#e8e8e8;background:rgba(20,18,18,0.88);border:1px solid #4b4646;' +
      'border-radius:6px;padding:6px 8px;direction:ltr;text-align:left';
    document.body.appendChild(_touchLogEl);
  }
  _touchLogEl.textContent = _touchLog.join('\n');
}

// A press long enough to be a GRAB is not a tap, even when the finger ends up back where it
// started. Reported twice: holding a waypoint to move it opened its inspector -- the pilot
// held on, the point did not travel far enough to count as moved, and the release read as a
// request to inspect. A tap is quick; anything held is an attempt to move something.
const TAP_MAX_MS = 300;
function noteTapOpened(x, y, prev) {
  _tapOpened = (x == null) ? null : { t: Date.now(), x, y, prev: prev || null };
}
// True when this touch is the second tap of a double tap. The first tap's panel is put back
// where it was here, so the caller only has to leave the panel alone.
function undoTapOpenIfDoubleTap(x, y) {
  const rec = _tapOpened;
  _tapOpened = null;
  if (!rec) return false;
  if (Date.now() - rec.t > DOUBLE_TAP_MS) return false;
  if (Math.hypot(x - rec.x, y - rec.y) > DOUBLE_TAP_PX) return false;
  state.selected = rec.prev;
  showInspector();
  // ...and then do what the pilot actually asked for. A double tap zooms the chart, and
  // everywhere else on the map Leaflet's doubleClickZoom does it -- off the browser's
  // compatibility dblclick, which this handler suppresses whenever the press lands on a
  // route element. Suppressing it is not optional: the same dblclick reaches the split
  // handler and cuts the leg in two. So the zoom is performed here instead of being lost.
  //
  // Which matters most exactly where the route is: airborne the edit lock is on, the route
  // covers much of a kneeboard screen, and a double tap that landed on it used to do
  // nothing at all.
  if (map.doubleClickZoom && map.doubleClickZoom.enabled()) {
    map.setZoomAround(map.containerPointToLatLng([x, y]), map.getZoom() + 1);
  }
  draw();
  return true;
}

// `cancelled` is true when the browser took the touch away rather than the pilot lifting it:
// a long press on a phone raises the OS's own text-selection / context gesture and fires
// touchcancel, and the sequence looks from here like a press that never moved -- a tap. That
// is how "holding a waypoint to move it" ended up opening its inspector instead. A cancelled
// touch is not a tap: nothing opens, and whatever was showing stays as it was.
function endTouch(evOrCancelled) {
  const cancelled = evOrCancelled === true ||
    !!(evOrCancelled && evOrCancelled.type === 'touchcancel');
  // A pinch is not a tap either. The two-finger paths deliberately move nothing -- touchmove
  // returns early unless exactly one finger is down -- so a zoom that happened to start on a
  // waypoint left `moved` false and the release read as a tap on it, opening the inspector
  // over the chart the pilot was zooming into. Same rule the map pan already follows: the
  // finger came down to do something else.
  if (touchDrag && typeof touchGestureInProgress === 'function' && touchGestureInProgress()) {
    touchDrag.moved = true;
  }
  // A drag is not a request to inspect: the finger came down to MOVE something, so the
  // panel that was hidden for the drag stays shut, and the selection goes with it (a
  // highlighted point with no panel explains nothing). A tap that never moved is the
  // opposite -- that IS the request -- and keeps its panel.
  const wasDrag = !!(touchDrag && touchDrag.moved &&
    (touchDrag.kind === 'wp' || touchDrag.kind === 'note' ||
     KITE_DRAG_KINDS.indexOf(touchDrag.kind) !== -1));
  setInspectorDragHidden(false);
  // ...unless it was already open before the finger landed, in which case it is something
  // the pilot was reading and a drag does not take it away -- the mouse path's rule.
  // The second tap of a double tap opens nothing -- it is not a request to inspect, and the first tap's
  // panel has already been put back where it was.
  touchLog(cancelled ? 'touchcancel' : 'touchend',
    touchDrag ? ('kind=' + touchDrag.kind + ' moved=' + !!touchDrag.moved +
      ' held=' + (Number.isFinite(touchDrag.pressedAt) ? (Date.now() - touchDrag.pressedAt) + 'ms' : '?'))
      : 'no drag');
  const held = !!touchDrag && Number.isFinite(touchDrag.pressedAt) &&
    (Date.now() - touchDrag.pressedAt) > TAP_MAX_MS &&
    KITE_DRAG_KINDS.concat(['wp', 'note']).indexOf(touchDrag.kind) !== -1;
  const isTap = !!touchDrag && !touchDrag.moved && !touchDrag.wasDoubleTap && !cancelled &&
    !held && TAP_OPENS_INSPECTOR_KINDS.indexOf(touchDrag.kind) !== -1;
  if (touchDrag && (touchDrag.wasDoubleTap || held || (cancelled && !touchDrag.moved))) {
    // Put back what was showing before the finger landed: a cancelled press selected the
    // waypoint under it on the way down, and a highlighted point with no panel explains
    // nothing.
    state.selected = touchDrag.selectionBefore || null;
    showInspector();
  } else if (wasDrag && !touchDrag.inspWasOpen) { state.selected = null; showInspector(); }
  else if (touchDrag && (wasDrag || isTap)) showInspector();
  // A tap that DID open something is remembered, so the second tap of a double tap can put it
  // back -- see undoTapOpenIfDoubleTap.
  touchLog('  decided', 'tap=' + isTap + ' drag=' + wasDrag + ' held=' + held +
    ' panel=' + (document.getElementById('inspector').classList.contains('hidden') ? 'shut' : 'OPEN'));
  if (isTap) noteTapOpened(touchDrag.startX, touchDrag.startY, touchDrag.selectionBefore);
  else if (touchDrag && !touchDrag.wasDoubleTap) noteTapOpened(null);
  // Pressing a leg selects it, which is right for a tap and wrong for a pan: the pilot was
  // moving the chart, and a highlighted leg with no panel explains nothing. Put back whatever
  // was selected when the finger landed.
  if (touchDrag && touchDrag.kind === 'legtap' && touchDrag.moved) {
    state.selected = touchDrag.prevSelected || null;
    draw();
  }
  if (touchDrag) {
    settleAddModeWaypointTap(touchDrag);
    if (touchDrag.kind === 'wp' && touchDrag.moved) {
      const wp = state.waypoints[touchDrag.i];
      const snappedToSelf = sameMapPoint(wp, { lat: touchDrag.origLat, lng: touchDrag.origLng });
      // Same two rules as the mouse path -- see endMouseDrag.
      if (routeNeighbourAtPoint(touchDrag.i, wp)) {
        deleteWaypoint(touchDrag.i);   // removes the adjacent leg too (see endMouseDrag)
        state.selected = null;
        showInspector(); draw();
        if (typeof setLiveDragging === 'function') setLiveDragging(false);   // commit one undo entry for the whole drag
        map.dragging.enable();
        clearDragAndRedraw('touch');
        return;
      }
      // Adopt the name of the point it landed on -- see endMouseDrag.
      const onIdx = routeWaypointAtPoint(wp, touchDrag.i);
      if (onIdx !== -1 && state.waypoints[onIdx].name) {
        wp.name = state.waypoints[onIdx].name;
      }
      if (snappedToSelf && !touchDrag.originSnapArmed) {
        wp.lat = touchDrag.origLat; wp.lng = touchDrag.origLng;
        if (typeof touchDrag.origName === 'string') wp.name = touchDrag.origName;
        syncLegs();
      }
    }
    // Same rule as the mouse path: a TAP on a waypoint in add mode extends the route through
    // it. The two paths have drifted six times before, so both call the one helper.
    if (touchDrag.kind === 'wp' && !touchDrag.moved &&
        addModeExtendThroughWaypoint(touchDrag.i)) {
      if (typeof setLiveDragging === 'function') setLiveDragging(false);
      map.dragging.enable();
      clearDragAndRedraw('touch');
      return;
    }
    // Seed a comm-change note if a touch waypoint-drag landed on one.
    let changed = false;
    if (touchDrag.kind === 'wp' && touchDrag.moved) {
      changed = applyLegAltitudesToRoute();
      if (typeof seedCommChangeNotes === 'function' && seedCommChangeNotes()) changed = true;
    }
    // seedCommChangeNotes/applyLegAltitudesToRoute may repaint; after a drag the panel must
    // stay shut, so redraw without reopening it.
    if (changed) { draw(); if (!wasDrag) showInspector(); }
    if (typeof setLiveDragging === 'function') setLiveDragging(false);   // commit one undo entry for the whole drag
    map.dragging.enable();
    clearDragAndRedraw('touch');
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
  const visibleWaypoints = state.waypoints.filter((w, i) =>
    typeof legDirWaypointVisible !== 'function' || legDirWaypointVisible(i));
  if (visibleWaypoints.length === 0) {
    map.setView([tune('defaultViewLat'), tune('defaultViewLng')], tune('fitRouteEmptyZoom'));
    return;
  }
  const b = L.latLngBounds(visibleWaypoints.map(w => [w.lat, w.lng]));
  // Clamp maxZoom so two close waypoints don't snap to a tight, useless view.
  map.fitBounds(b, fitOpts('fitRoutePaddingPx', 'fitRouteMaxZoom'));
}

function fitToScreen() {
  if (typeof pageSize !== 'undefined' && pageSize && typeof fitPageFrame === 'function') {
    pageOffset = { x: 0, y: 0 };
    fitPageFrame();
    return;
  }
  fitView();
}
