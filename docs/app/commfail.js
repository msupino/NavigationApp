'use strict';
// Comm failure: one button for a pilot who has lost the radio. It picks the nearest of the
// fields that publish a comm-failure procedure (Herzliya, Haifa, Rosh Pina), replaces the route
// with here -> published entry point -> field at the entry's published altitude, puts that
// field's comm-failure chart on the map, and shows a card with the squawk, the tower's phone
// and the entry.
//
// The route is a pointer, not the procedure: what happens after the entry point is on the
// chart, and the card says to fly the chart. Entry points and altitudes come from
// data/commfail.json, which names graph nodes; coordinates come from the route graph so the
// two cannot drift apart.
(function () {
  const S_ = (k, fb) => (typeof S === 'object' && S && S[k]) || fb;

  // What the button changed, so Cancel can put it back: the route snapshot it drew (to tell
  // whether the pilot has edited it since), whether it turned the chart on, and the airfield
  // filter it replaced. null when no comm-failure route is active.
  let active = null;
  let waiting = null;          // the waiting card's answer box while a first fix is awaited
  const routeKey = () => JSON.stringify(routeSnapshotForStorage());

  let dataPromise = null;
  let graphPromise = null;
  const fetchJson = url => fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  function loadData() {
    if (!dataPromise) {
      dataPromise = fetchJson(S_('commfailUrl', 'data/commfail.json?v=2'))
        .catch(e => { dataPromise = null; throw e; });
    }
    return dataPromise;
  }
  // The CVFR graph, not the active layer's: the published entry points are CVFR reporting
  // points whichever base layer happens to be showing.
  function loadGraph() {
    if (!graphPromise) {
      const ver = typeof _verOf === 'function' ? _verOf(S_('routeGraphUrl', '')) : '2';
      graphPromise = fetchJson('data/cvfr-route-graph.json?v=' + ver)
        .catch(e => { graphPromise = null; throw e; });
    }
    return graphPromise;
  }

  const liveFix = () => {
    const f = typeof gpsOwn === 'object' && gpsOwn;
    return f && Number.isFinite(f.lat) && Number.isFinite(f.lng) ? { lat: f.lat, lng: f.lng } : null;
  };
  // Until there is a fix, Location stops (refused, no GPS), or the pilot answers the waiting
  // card. No timeout: a cold GPS can take a minute, and a route drawn from the map centre in
  // the meantime would point a pilot with no radio somewhere they are not.
  function waitForFix(stop) {
    return new Promise(resolve => {
      const tick = () => {
        // gpsLastFix is cleared when Location starts, so it only answers with a fix from THIS
        // session -- gpsOwn can still hold where the aeroplane was last time.
        const f = typeof gpsLastFix === 'function' ? gpsLastFix() : null;
        if (f || !gpsLiveOn || stop.answer) { resolve(f); return; }
        setTimeout(tick, 200);
      };
      tick();
    });
  }
  function setLocation(on) {
    const btn = document.getElementById('gps-live');
    if (btn && !btn.disabled && !!gpsLiveOn !== on) btn.click();
    return !!gpsLiveOn === on;
  }

  function closeCards() {
    document.querySelectorAll('[data-chart-modal="commfail"]').forEach(el => el.remove());
  }
  // What the pilot sees while the GPS finds itself: the squawk, which needs no position, and
  // the two ways out -- take the map centre now, or stop.
  function showWaitingCard(stop) {
    closeCards();
    const m = createDraggableModal(S_('commFailHeading', 'Comm failure'), 'modal commfail-card',
      () => { if (!stop.answer) stop.answer = 'cancel'; }, { nonBlocking: true, chartKind: 'commfail' });
    m.box.appendChild(squawkLine());
    m.box.appendChild(line('commfail-waiting', S_('commFailWaiting', 'Waiting for your GPS position…')));
    const actions = line('commfail-actions');
    const centre = document.createElement('button');
    centre.type = 'button';
    centre.className = 'commfail-use-centre';
    centre.textContent = S_('commFailUseMapCentre', 'Use map centre');
    centre.addEventListener('click', () => { stop.answer = 'centre'; });
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'commfail-cancel';
    off.textContent = S_('commFailCancel', 'Cancel comm failure');
    off.addEventListener('click', () => { stop.answer = 'cancel'; });
    actions.append(centre, off);
    m.box.appendChild(actions);
    m.show();
  }

  // Where the aeroplane is. Comm failure is an in-flight button, so it switches Location on
  // when nothing is giving a position yet (a recording and the simulator both count) and waits
  // for the first fix. The map centre only when the pilot asks for it or there is no GPS to
  // wait for, and the card says so. null: the pilot cancelled while waiting.
  async function origin() {
    let startedLocation = false;
    if (!(typeof gpsPositionLive === 'function' && gpsPositionLive())) {
      startedLocation = setLocation(true);
      if (startedLocation) {
        const stop = { answer: null };
        waiting = stop;
        showWaitingCard(stop);
        try { await waitForFix(stop); } finally { waiting = null; }
        closeCards();
        if (stop.answer === 'cancel') {
          setLocation(false);
          return null;
        }
      }
    }
    const fix = typeof gpsPositionLive === 'function' && gpsPositionLive() ? liveFix() : null;
    if (fix) return { pos: fix, fromGps: true, startedLocation };
    const c = map.getCenter();
    return { pos: { lat: c.lat, lng: c.lng }, fromGps: false, startedLocation };
  }

  function fieldLabel(icao) {
    const af = typeof airfieldByIcao === 'function' ? airfieldByIcao(icao) : null;
    const key = S_('airfieldLabelField', 'en');
    return af && af[key] ? af[key] + ' (' + icao + ')' : icao;
  }
  function nodeLabel(graph, code) {
    const n = graph && graph.nodes && graph.nodes[code];
    const key = S_('navWpSearchField', 'en');
    return n && n[key] && n[key] !== code ? n[key] + ' (' + code + ')' : code;
  }

  function buildRoute(opt) {
    const r = typeof r5 === 'function' ? r5 : v => v;
    const here = { lat: r(opt.from.lat), lng: r(opt.from.lng), name: S_('deckHereNow', 'NOW') };
    state.waypoints = [
      here,
      { lat: opt.entryAt.lat, lng: opt.entryAt.lng, name: opt.entry },
      { lat: opt.fieldAt.lat, lng: opt.fieldAt.lng, name: opt.icao },
    ];
    state.legs = [];
    syncLegs();
    // The entry's published altitude on both legs, as if typed: the dataset fill must not
    // replace it with a graph altitude that belongs to some other procedure.
    for (const leg of state.legs) {
      leg.inboundAltitude = opt.alt;
      delete leg._legAltitudeAuto;
    }
    draw();   // draw -> persist -> one undo step, so Undo brings the planned route back
    // A new route with the aircraft at its start: the leg pointer starts on the first leg,
    // not wherever it had got to on the route this replaced.
    if (typeof gpsResetLegAlerts === 'function') gpsResetLegAlerts();
  }

  // NOW follows the aircraft. A fixed first point left the first leg's bearing and distance
  // measured from wherever the button was pressed, going stale with every minute flown. While
  // comm failure is up and a position is live, the first point moves to the latest fix --
  // until the aircraft is past it onto the entry leg, where it no longer matters.
  const FOLLOW_MS = 2000;
  const FOLLOW_MIN_M = 50;
  let followTimer = 0;
  function followTick() {
    if (!active || !(typeof gpsPositionLive === 'function' && gpsPositionLive())) return;
    if (typeof gpsAlertLegIndex === 'number' && gpsAlertLegIndex > 0) return;
    const fix = liveFix();
    const wp = state.waypoints[0];
    // Only while the route is still the one comm failure drew: an edited route is the pilot's.
    if (!fix || !wp || routeKey() !== active.route) return;
    if (routeCheckNmBetween(wp, fix) * 1852 < FOLLOW_MIN_M) return;
    const r = typeof r5 === 'function' ? r5 : v => v;
    const move = () => { wp.lat = r(fix.lat); wp.lng = r(fix.lng); draw(); };
    if (typeof persistWithoutUndo === 'function') persistWithoutUndo(move); else move();
    active.route = routeKey();
    const origin = document.querySelector('[data-chart-modal="commfail"] .commfail-origin');
    if (origin) origin.textContent = S_('commFailFromGps', 'From your GPS position');
  }
  function follow(on) {
    clearInterval(followTimer);
    followTimer = on ? setInterval(followTick, FOLLOW_MS) : 0;
  }

  function setBox(box, on) {
    if (!box || box.checked === on) return;
    box.checked = on;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof window.refreshPlateTypePicker === 'function') window.refreshPlateTypePicker();
  }
  function setFilter(value) {
    const sel = document.getElementById('plate-airfield');
    if (!sel) return;
    sel.value = value;
    sel.dispatchEvent(new Event('change'));
  }

  // Returns what it changed, for Cancel.
  function showChart(icao) {
    const box = document.getElementById('commfail-cb');
    const was = { chartWasOn: !!(box && box.checked), filter: null };
    if (!box) return was;
    // A filter naming another field would hide the chart just asked for.
    if (window.plateAirfield && window.plateAirfield !== 'auto' && window.plateAirfield !== icao) {
      was.filter = window.plateAirfield;
      setFilter(icao);
    }
    setBox(box, true);
    return was;
  }

  // Back to the plan the pilot had. The route comes back through Undo only while it is still
  // the one this drew: once the pilot has edited it, that edit is theirs and is not thrown away
  // -- the chart and the card go, the route stays.
  function cancel() {
    if (!active) return false;
    const was = active;
    active = null;
    follow(false);
    refreshPressed();
    let restored = false;
    if (routeKey() === was.route && typeof undo === 'function' && was.depth > 0 && undoStack.length >= was.depth) {
      undo();
      restored = true;
    }
    if (!was.chartWasOn) setBox(document.getElementById('commfail-cb'), false);
    if (was.filter) setFilter(was.filter);
    if (was.startedLocation) setLocation(false);
    document.querySelectorAll('[data-chart-modal="commfail"]').forEach(el => el.remove());
    if (!restored && typeof refuse === 'function') {
      refuse(S_('commFailCancelKept', 'Comm failure cancelled. The route was edited since, so it stays.'));
    }
    return restored;
  }

  function line(cls, text) {
    const el = document.createElement('div');
    el.className = cls;
    if (text) el.textContent = text;
    return el;
  }
  // What the tower can still tell a pilot it cannot talk to: the ICAO light signals to an
  // aircraft in flight, and how to answer them. Open on a larger screen; on a phone it starts
  // folded, because open it covers the map the pilot is flying by -- one tap opens it.
  const LIGHTS = [
    ['green', false, 'commFailLightGreen', 'Cleared to land'],
    ['green', true, 'commFailLightGreenFlash', 'Return for landing'],
    ['red', false, 'commFailLightRed', 'Give way and continue circling'],
    ['red', true, 'commFailLightRedFlash', 'Aerodrome unsafe — do not land'],
    ['white', true, 'commFailLightWhiteFlash', 'Land here and proceed to the apron'],
    ['flare', false, 'commFailLightFlare', 'Do not land for the time being'],
  ];
  function lightSignals() {
    const box = document.createElement('details');
    box.className = 'commfail-lights';
    const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 680px)').matches;
    box.open = !phone;
    const sum = document.createElement('summary');
    sum.textContent = S_('commFailLights', 'Light signals from the tower');
    box.appendChild(sum);
    const list = document.createElement('dl');
    for (const [colour, flashing, key, fb] of LIGHTS) {
      const dt = document.createElement('dt');
      const lamp = document.createElement('span');
      lamp.className = 'commfail-lamp commfail-lamp-' + colour + (flashing ? ' commfail-lamp-flash' : '');
      lamp.setAttribute('aria-hidden', 'true');
      dt.appendChild(lamp);
      dt.append(S_(key + 'Name', colour));
      const dd = document.createElement('dd');
      dd.textContent = S_(key, fb);
      list.append(dt, dd);
    }
    box.appendChild(list);
    box.appendChild(line('commfail-lights-ack', S_('commFailLightAck',
      'Acknowledge: by day rock the wings (not on base or final); at night flash the landing or navigation lights twice.')));
    return box;
  }

  function squawkLine() {
    const squawk = line('commfail-squawk');
    squawk.append(S_('commFailSquawk', 'Squawk') + ' ');
    const code = document.createElement('b');
    code.textContent = '7600';
    squawk.appendChild(code);
    return squawk;
  }

  function showCard(opts, graph, fromGps) {
    document.querySelectorAll('[data-chart-modal="commfail"]').forEach(el => el.remove());
    const best = opts[0];
    const m = createDraggableModal(S_('commFailHeading', 'Comm failure'), 'modal commfail-card', null,
      { nonBlocking: true, chartKind: 'commfail' });
    m.box.appendChild(squawkLine());

    const nm = n => Math.round(n) + ' NM';
    const dest = line('commfail-dest');
    const name = document.createElement('b');
    name.textContent = fieldLabel(best.icao);
    dest.append(name, ' · ' + nm(best.totalNm));
    m.box.appendChild(dest);
    m.box.appendChild(line('commfail-entry',
      S_('commFailVia', 'via') + ' ' + nodeLabel(graph, best.entry) + ' ' + S_('commFailAt', 'at') + ' '
      + best.alt.toLocaleString('en-US') + ' ft'));
    if (best.inArea) {
      m.box.appendChild(line('commfail-entry-areas', '(' + String(S_('commFailInArea', 'You are in training area {area}'))
        .replace('{area}', best.inArea) + ')'));
    } else if (best.fromAreas) {
      m.box.appendChild(line('commfail-entry-areas', '(' + String(S_('commFailFromAreas', '{alt} ft from training areas {areas}'))
        .replace('{alt}', best.fromAreas.alt.toLocaleString('en-US'))
        .replace('{areas}', best.fromAreas.areas.join(', ')) + ')'));
    }

    if (best.phone) {
      const phone = line('commfail-phone', S_('commFailCallTower', 'If you have a phone, call the tower') + ': ');
      const a = typeof telLink === 'function' ? telLink(best.phone) : null;
      phone.append(a || best.phone);
      m.box.appendChild(phone);
    }
    m.box.appendChild(lightSignals());
    m.box.appendChild(line('commfail-note', S_('commFailChartNote', 'The published chart is on the map — fly it, not this line.')));
    m.box.appendChild(line('commfail-origin', fromGps
      ? S_('commFailFromGps', 'From your GPS position')
      : S_('commFailFromMap', 'From the map centre — no GPS fix')));

    if (opts.length > 1) {
      const other = line('commfail-other');
      other.append(S_('commFailOther', 'Other fields') + ': '
        + opts.slice(1).map(o => fieldLabel(o.icao) + ' ' + nm(o.totalNm)).join(' · '));
      m.box.appendChild(other);
    }
    const actions = line('commfail-actions');
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'commfail-cancel';
    off.textContent = S_('commFailCancel', 'Cancel comm failure');
    off.title = S_('commFailCancelTitle', 'Put back the route and charts you had before');
    off.addEventListener('click', () => { cancel(); });
    actions.appendChild(off);
    m.box.appendChild(actions);
    m.show();
    return m;
  }

  // On/off like Location: pressed while comm failure is up (or waiting for its fix), and a
  // press then ends it -- the same as Cancel on the card.
  let busy = false;
  function refreshPressed() {
    const on = !!active || busy;
    const btn = document.getElementById('commfail-btn');
    for (const el of [btn, document.querySelector('.deck-btn-commfail')]) {
      if (el) el.setAttribute('aria-pressed', String(on));
    }
    if (btn) {
      const label = on ? S_('commFailEnd', 'End comm failure') : S_('commFail', 'Comm failure');
      const t = btn.querySelector('.footer-link-text');
      if (t) t.textContent = label;
      btn.setAttribute('aria-label', label);
      btn.title = on ? label : S_('commFailTitle', label);
    }
  }
  async function commFailGo() {
    if (waiting) { waiting.answer = 'cancel'; return null; }
    if (active) { cancel(); return null; }
    // Busy without a waiting card is the replace-route question: it is answered there.
    if (busy) return null;
    busy = true;
    refreshPressed();
    try { return await commFailRun(); } finally { busy = false; refreshPressed(); }
  }
  async function commFailRun() {
    let data, graph;
    try {
      [data, graph] = await Promise.all([loadData(), loadGraph()]);
      if (!airfields && typeof loadAirfields === 'function') await loadAirfields();
    } catch (e) {
      if (typeof refuse === 'function') refuse(S_('commFailNoData', 'Comm-failure procedures could not be loaded.'));
      return null;
    }
    const where = await origin();
    if (!where) return null;
    const { pos, fromGps, startedLocation } = where;
    // Location switched on here goes off again on the way out, unless a comm-failure route
    // it belongs to is still up.
    const giveBackLocation = () => { if (startedLocation && !active) setLocation(false); };
    const nodes = (graph && graph.nodes) || {};
    const wpAt = code => {
      const n = nodes[code];
      return n && Number.isFinite(n.lat) && Number.isFinite(n.lng) ? { lat: n.lat, lng: n.lng } : null;
    };
    const fieldAt = icao => {
      const af = typeof airfieldByIcao === 'function' ? airfieldByIcao(icao) : null;
      return af && Number.isFinite(af.lat) && Number.isFinite(af.lng) ? { lat: af.lat, lng: af.lng } : null;
    };
    const opts = commFailOptions(data, pos, wpAt, fieldAt);
    if (!opts.length) {
      giveBackLocation();
      if (typeof refuse === 'function') refuse(S_('commFailNoData', 'Comm-failure procedures could not be loaded.'));
      return null;
    }
    const best = opts[0];
    const ask = String(S_('commFailReplace', 'Replace your route with the comm-failure route to {field}?'))
      .replace('{field}', fieldLabel(best.icao));
    if (!await askReplaceRoute(ask, S_('commFailReplaceOk', 'Route there'), S_('commFailHeading', 'Comm failure'))) {
      giveBackLocation();
      return null;
    }
    const chartWas = document.getElementById('commfail-cb');
    // A comm-failure route drawn over an earlier one: Cancel goes back to the plan before
    // the first, and the chart/filter state from before the first too.
    const prior = active;
    buildRoute(Object.assign({ from: pos }, best));
    const changed = showChart(best.icao);
    active = {
      route: routeKey(),
      depth: undoStack.length,
      chartWasOn: prior ? prior.chartWasOn : (changed.chartWasOn && !!chartWas),
      filter: prior ? prior.filter : changed.filter,
      startedLocation: prior ? prior.startedLocation : startedLocation,
      opts, graph, fromGps, card: null,
    };
    follow(true);
    try {
      map.fitBounds(L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng])).pad(0.2));
    } catch (e) { /* a map with no size yet: the route is drawn, the view just stays put */ }
    active.card = showCard(opts, graph, fromGps);
    return active.card;
  }

  const btn = document.getElementById('commfail-btn');
  if (btn) btn.addEventListener('click', () => { commFailGo(); });
  window.NavAid = window.NavAid || {};
  NavAid.commFail = { go: commFailGo, cancel, isActive: () => !!active };
})();
