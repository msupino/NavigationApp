'use strict';
// Diversion planner (#675): one button for a pilot deciding where to go NOW. It takes the
// aeroplane's position (the live GPS fix, or the map centre), lists the nearest airfields with
// their magnetic bearing, distance, time and fuel to reach at the planned cruise, and -- on a tap
// -- re-routes direct to the chosen field (here -> field) with a card confirming the figures.
// Cancel puts the earlier route back. Modelled on the comm-failure button beside it, but the
// pilot picks the field from the list instead of the procedure picking it.
(function () {
  const S_ = (k, fb) => (typeof S === 'object' && S && S[k]) || fb;

  // The route this drew, and the plan it replaced, so Cancel can restore it. null when inactive.
  let active = null;
  let busy = false;

  const liveFix = () => {
    const f = typeof gpsOwn === 'object' && gpsOwn;
    return f && Number.isFinite(f.lat) && Number.isFinite(f.lng) ? { lat: f.lat, lng: f.lng } : null;
  };
  const positionLive = () => typeof gpsPositionLive === 'function' && gpsPositionLive();
  const locationFix = () => (typeof gpsLastFix === 'function' ? gpsLastFix() : null);
  function setLocation(on) {
    const btn = document.getElementById('gps-live');
    if (btn && !btn.disabled && !!(typeof gpsLiveOn !== 'undefined' && gpsLiveOn) !== on) btn.click();
    return !!(typeof gpsLiveOn !== 'undefined' && gpsLiveOn) === on;
  }

  function closeCards() {
    document.querySelectorAll('[data-divert-card]').forEach(el => el.remove());
  }

  // Where the aeroplane is. Like comm failure: switch Location on when nothing gives a position
  // yet and wait for the first fix; the map centre only when the pilot asks or there is no GPS.
  function waitForFix(stop, fixNow, sourceOn) {
    return new Promise(resolve => {
      const tick = () => {
        const f = fixNow();
        if (f || !sourceOn() || stop.answer) { resolve(f); return; }
        setTimeout(tick, 200);
      };
      tick();
    });
  }
  let waiting = null;
  function showWaitingCard(stop) {
    closeCards();
    const m = createDraggableModal(S_('divertHeading', 'Divert'), 'modal divert-card',
      () => { if (!stop.answer) stop.answer = 'cancel'; }, { nonBlocking: true });
    m.box.setAttribute('data-divert-card', '1');
    const msg = document.createElement('div');
    msg.className = 'divert-waiting';
    msg.textContent = S_('divertWaiting', 'Waiting for your GPS position…');
    m.box.appendChild(msg);
    const actions = document.createElement('div');
    actions.className = 'divert-actions';
    const centre = document.createElement('button');
    centre.type = 'button';
    centre.className = 'divert-use-centre';
    centre.textContent = S_('divertUseMapCentre', 'Use map centre');
    centre.addEventListener('click', () => { stop.answer = 'centre'; });
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'divert-cancel';
    off.textContent = S_('divertCancel', 'Cancel');
    off.addEventListener('click', () => { stop.answer = 'cancel'; });
    actions.append(centre, off);
    m.box.appendChild(actions);
    m.show();
  }
  async function wait(fixNow, sourceOn) {
    const stop = { answer: null };
    waiting = stop;
    showWaitingCard(stop);
    try { await waitForFix(stop, fixNow, sourceOn); } finally { waiting = null; }
    closeCards();
    return stop.answer;
  }
  async function origin() {
    let startedLocation = false;
    if (!positionLive()) {
      startedLocation = setLocation(true);
      if (startedLocation) {
        const ans = await wait(locationFix, () => typeof gpsLiveOn !== 'undefined' && gpsLiveOn);
        if (ans === 'cancel') { setLocation(false); return null; }
      }
    } else if (!liveFix()) {
      if (await wait(liveFix, positionLive) === 'cancel') return null;
    }
    const fix = positionLive() ? liveFix() : null;
    if (fix) return { pos: fix, fromGps: true, startedLocation };
    const c = map.getCenter();
    return { pos: { lat: c.lat, lng: c.lng }, fromGps: false, startedLocation };
  }

  // The planned cruise the time/fuel are figured at: the route's own speed if it has one, else the
  // default leg speed; the fuel burn from the aircraft, else the default.
  function cruiseKt() {
    const legs = (typeof state === 'object' && state && state.legs) || [];
    for (const l of legs) if (l && Number(l.flightSpeed) > 0) return Number(l.flightSpeed);
    return typeof _defaultLegSpeedKt === 'function' ? _defaultLegSpeedKt() : 90;
  }
  function gphNow() {
    if (typeof aircraft === 'object' && aircraft && Number(aircraft.gph) > 0) return Number(aircraft.gph);
    return typeof tune === 'function' && Number(tune('defaultGph')) > 0 ? Number(tune('defaultGph')) : 8;
  }
  function afLabel(af) {
    const key = S_('airfieldLabelField', 'en');
    const name = (af && af[key]) || (af && af.name) || '';
    return af && af.name && name !== af.name ? name + ' (' + af.name + ')' : (af ? af.name : '');
  }
  // The nearest fields to `pos`, each with magnetic bearing, distance, time and fuel.
  function nearest(pos, count) {
    if (!Array.isArray(airfields)) return [];
    const cruise = cruiseKt();
    const gph = gphNow();
    const rows = [];
    for (const af of airfields) {
      if (!af || !Number.isFinite(af.lat) || !Number.isFinite(af.lng)) continue;
      const g = geo(pos, af);
      const timeH = cruise > 0 ? g.dist / cruise : 0;
      rows.push({ af, dist: g.dist, brgTrue: g.brg, timeH, fuel: timeH * gph });
    }
    rows.sort((a, b) => a.dist - b.dist);
    return rows.slice(0, count);
  }

  function metaText(row) {
    const bearing = typeof toMagnetic === 'function' ? toMagnetic(row.brgTrue) : Math.round(row.brgTrue);
    const brg = (typeof pad3 === 'function' ? pad3(bearing) : String(bearing)) + '°M';
    const dist = row.dist.toFixed(1) + ' NM';
    const ete = typeof toHMS === 'function' ? toHMS(row.timeH) : (Math.round(row.timeH * 60) + ' min');
    const fuel = row.fuel.toFixed(1) + ' gal';
    const parts = [brg, dist, ete, fuel];
    // One LTR run per field, so the figures do not reorder inside a Hebrew card.
    return parts.join(' · ');
  }
  function runwayText(af) {
    const m = af && Number.isFinite(af.runwayLengthM) ? Math.round(af.runwayLengthM) : null;
    if (!m) return '';
    const hard = af.hardRunway ? S_('divertRwyHard', 'paved') : S_('divertRwySoft', 'unpaved');
    return S_('divertRunway', 'Runway') + ' ' + m + ' m · ' + hard;
  }

  // Re-route direct to the field: here (NOW, the position) -> field. The earlier plan is snapshot
  // first so Cancel restores it.
  function buildRoute(pos, af) {
    const r = typeof r5 === 'function' ? r5 : v => v;
    state.waypoints = [
      { lat: r(pos.lat), lng: r(pos.lng), name: S_('deckHereNow', 'NOW') },
      { lat: af.lat, lng: af.lng, name: af.name },
    ];
    state.legs = [];
    syncLegs();
    draw();
    if (typeof gpsResetLegAlerts === 'function') gpsResetLegAlerts();
  }
  function divertTo(row, pos, fromGps) {
    const before = active ? active.before
      : (typeof routeSnapshotForStorage === 'function' ? JSON.stringify(routeSnapshotForStorage()) : null);
    const startedLocation = active ? active.startedLocation : false;
    buildRoute(pos, row.af);
    active = { before, startedLocation };
    try {
      map.fitBounds(L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng])).pad(0.2),
        typeof fitOpts === 'function' ? fitOpts('fitRoutePaddingPx', 'fitRouteMaxZoom') : {});
    } catch (e) { /* a map with no size yet: the route is drawn, the view stays put */ }
    refreshPressed();
    if (typeof showToast === 'function') {
      showToast(String(S_('divertingTo', 'Diverting to {field}')).replace('{field}', afLabel(row.af)));
    }
  }

  function cancel() {
    if (!active) return false;
    const was = active;
    active = null;
    refreshPressed();
    let restored = false;
    if (was.before && typeof applyRouteSnapshot === 'function') {
      try { applyRouteSnapshot(JSON.parse(was.before)); restored = true; } catch (e) { /* kept */ }
    }
    if (was.startedLocation) setLocation(false);
    closeCards();
    return restored;
  }

  function showList(rows, pos, fromGps) {
    closeCards();
    const m = createDraggableModal(S_('divertHeading', 'Divert'), 'modal divert-card', null, { nonBlocking: true });
    m.box.setAttribute('data-divert-card', '1');
    const src = document.createElement('div');
    src.className = 'divert-source';
    src.textContent = fromGps ? S_('divertFromGps', 'From your GPS position')
      : S_('divertFromCentre', 'From the map centre');
    m.box.appendChild(src);
    const list = document.createElement('div');
    list.className = 'divert-list';
    for (const row of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'divert-option';
      const primary = document.createElement('span');
      primary.className = 'divert-primary';
      primary.textContent = afLabel(row.af);
      const meta = document.createElement('span');
      meta.className = 'divert-meta';
      meta.dir = 'ltr';
      meta.textContent = metaText(row);
      btn.append(primary, meta);
      const rwy = runwayText(row.af);
      if (rwy) {
        const r = document.createElement('span');
        r.className = 'divert-rwy';
        r.textContent = rwy;
        btn.appendChild(r);
      }
      btn.addEventListener('click', () => { divertTo(row, pos, fromGps); showActive(row); });
      list.appendChild(btn);
    }
    m.box.appendChild(list);
    m.show();
    const first = list.querySelector('button');
    if (first) first.focus();
    return m;
  }

  // After a field is chosen: the route is drawn; the card shrinks to the chosen field plus Cancel
  // (back to the plan) and "Other field" (the list again).
  function showActive(row) {
    closeCards();
    const m = createDraggableModal(S_('divertHeading', 'Divert'), 'modal divert-card', null, { nonBlocking: true });
    m.box.setAttribute('data-divert-card', '1');
    const to = document.createElement('div');
    to.className = 'divert-active-to';
    to.textContent = String(S_('divertingTo', 'Diverting to {field}')).replace('{field}', afLabel(row.af));
    m.box.appendChild(to);
    const meta = document.createElement('div');
    meta.className = 'divert-active-meta';
    meta.dir = 'ltr';
    meta.textContent = metaText(row);
    m.box.appendChild(meta);
    const actions = document.createElement('div');
    actions.className = 'divert-actions';
    const other = document.createElement('button');
    other.type = 'button';
    other.className = 'divert-other';
    other.textContent = S_('divertOther', 'Other field');
    other.addEventListener('click', () => { go(true); });
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'divert-cancel';
    back.textContent = S_('divertUndo', 'Back to my route');
    back.addEventListener('click', () => { cancel(); });
    actions.append(other, back);
    m.box.appendChild(actions);
    m.show();
    return m;
  }

  function refreshPressed() {
    const on = !!active;
    const btn = document.getElementById('divert-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const label = on ? S_('divertEnd', 'End divert') : S_('divert', 'Divert');
      const t = btn.querySelector('.footer-link-text');
      if (t) t.textContent = label;
      btn.setAttribute('aria-label', label);
    }
  }

  // `reopen` is true when the pilot asks for the list again from the active card: keep the active
  // route, just re-show the list from the same position.
  async function go(reopen) {
    if (waiting) { waiting.answer = 'cancel'; return; }
    if (busy) return;
    if (active && !reopen) { cancel(); return; }
    busy = true;
    try {
      if (!airfields && typeof loadAirfields === 'function') await loadAirfields();
      if (!Array.isArray(airfields) || !airfields.length) {
        if (typeof refuse === 'function') refuse(S_('divertNoFields', 'Airfields could not be loaded.'));
        return;
      }
      const where = await origin();
      if (!where) return;
      const rows = nearest(where.pos, typeof tune === 'function' && tune('divertListCount') > 0 ? tune('divertListCount') : 6);
      if (!rows.length) {
        if (typeof refuse === 'function') refuse(S_('divertNoFields', 'No airfields were found.'));
        return;
      }
      showList(rows, where.pos, where.fromGps);
    } finally {
      busy = false;
    }
  }

  const btn = document.getElementById('divert-btn');
  if (btn) btn.addEventListener('click', () => { go(false); });
  window.NavAid = window.NavAid || {};
  NavAid.divert = { go: () => go(false), cancel, isActive: () => !!active };
})();
