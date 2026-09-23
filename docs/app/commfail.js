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

  // How long to wait for a first fix after switching Location on. Long enough for a phone
  // that has had GPS recently; a cold start that takes longer gets the map centre, and the
  // card says so.
  const FIX_WAIT_MS = 8000;

  const liveFix = () => {
    const f = typeof gpsOwn === 'object' && gpsOwn;
    return f && Number.isFinite(f.lat) && Number.isFinite(f.lng) ? { lat: f.lat, lng: f.lng } : null;
  };
  function waitForFix(ms) {
    return new Promise(resolve => {
      const until = Date.now() + ms;
      const tick = () => {
        // gpsLastFix is cleared when Location starts, so it only answers with a fix from THIS
        // session -- gpsOwn can still hold where the aeroplane was last time.
        const f = typeof gpsLastFix === 'function' ? gpsLastFix() : null;
        if (f || !gpsLiveOn || Date.now() >= until) { resolve(f); return; }
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

  // Where the aeroplane is. Comm failure is an in-flight button, so it switches Location on
  // when nothing is giving a position yet (a recording and the simulator both count), and
  // waits briefly for the first fix. No fix: the middle of the map, and the card says so --
  // a route from the wrong place is worse than no route if nobody is told where it starts.
  async function origin() {
    let startedLocation = false;
    if (!(typeof gpsPositionLive === 'function' && gpsPositionLive())) {
      startedLocation = setLocation(true);
      if (startedLocation) {
        if (typeof showToast === 'function') showToast(S_('commFailLocating', 'Getting your position…'));
        await waitForFix(FIX_WAIT_MS);
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

  function showCard(opts, graph, fromGps) {
    document.querySelectorAll('[data-chart-modal="commfail"]').forEach(el => el.remove());
    const best = opts[0];
    const m = createDraggableModal(S_('commFailHeading', 'Comm failure'), 'modal commfail-card', null,
      { nonBlocking: true, chartKind: 'commfail' });
    const squawk = line('commfail-squawk');
    squawk.append(S_('commFailSquawk', 'Squawk') + ' ');
    const code = document.createElement('b');
    code.textContent = '7600';
    squawk.appendChild(code);
    m.box.appendChild(squawk);

    const nm = n => Math.round(n) + ' NM';
    const dest = line('commfail-dest');
    const name = document.createElement('b');
    name.textContent = fieldLabel(best.icao);
    dest.append(name, ' · ' + nm(best.totalNm));
    m.box.appendChild(dest);
    m.box.appendChild(line('commfail-entry',
      S_('commFailVia', 'via') + ' ' + nodeLabel(graph, best.entry) + ' ' + S_('commFailAt', 'at') + ' '
      + best.alt.toLocaleString('en-US') + ' ft'));
    if (best.fromAreas) {
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

  async function commFailGo() {
    // Already on: the button brings the card back (and with it Cancel) rather than asking
    // to replace a route that is already the comm-failure route.
    if (active && active.card && routeKey() === active.route) {
      document.querySelectorAll('[data-chart-modal="commfail"]').forEach(el => el.remove());
      active.card = showCard(active.opts, active.graph, active.fromGps);
      return active.card;
    }
    let data, graph;
    try {
      [data, graph] = await Promise.all([loadData(), loadGraph()]);
      if (!airfields && typeof loadAirfields === 'function') await loadAirfields();
    } catch (e) {
      if (typeof refuse === 'function') refuse(S_('commFailNoData', 'Comm-failure procedures could not be loaded.'));
      return null;
    }
    const { pos, fromGps, startedLocation } = await origin();
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
