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

  let dataPromise = null;
  let graphPromise = null;
  const fetchJson = url => fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  function loadData() {
    if (!dataPromise) {
      dataPromise = fetchJson(S_('commfailUrl', 'data/commfail.json?v=1'))
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

  // Where the aeroplane is. A live fix when there is one; otherwise the middle of the map,
  // and the card says so -- a route from the wrong place is worse than no route if nobody
  // is told where it starts.
  function origin() {
    const live = typeof gpsPositionLive === 'function' && gpsPositionLive();
    const fix = live && typeof gpsLastFix === 'function' ? gpsLastFix() : null;
    if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng)) return { pos: fix, fromGps: true };
    const c = map.getCenter();
    return { pos: { lat: c.lat, lng: c.lng }, fromGps: false };
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

  function showChart(icao) {
    const box = document.getElementById('commfail-cb');
    if (!box) return;
    // A filter naming another field would hide the chart just asked for.
    const sel = document.getElementById('plate-airfield');
    if (sel && window.plateAirfield && window.plateAirfield !== 'auto' && window.plateAirfield !== icao) {
      sel.value = icao;
      sel.dispatchEvent(new Event('change'));
    }
    if (!box.checked) {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof window.refreshPlateTypePicker === 'function') window.refreshPlateTypePicker();
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
    m.show();
    return m;
  }

  async function commFailGo() {
    let data, graph;
    try {
      [data, graph] = await Promise.all([loadData(), loadGraph()]);
      if (!airfields && typeof loadAirfields === 'function') await loadAirfields();
    } catch (e) {
      if (typeof refuse === 'function') refuse(S_('commFailNoData', 'Comm-failure procedures could not be loaded.'));
      return null;
    }
    const { pos, fromGps } = origin();
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
      if (typeof refuse === 'function') refuse(S_('commFailNoData', 'Comm-failure procedures could not be loaded.'));
      return null;
    }
    const best = opts[0];
    const ask = String(S_('commFailReplace', 'Replace your route with the comm-failure route to {field}?'))
      .replace('{field}', fieldLabel(best.icao));
    if (!await askReplaceRoute(ask, S_('commFailReplaceOk', 'Route there'), S_('commFailHeading', 'Comm failure'))) {
      return null;
    }
    buildRoute(Object.assign({ from: pos }, best));
    showChart(best.icao);
    try {
      map.fitBounds(L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng])).pad(0.2));
    } catch (e) { /* a map with no size yet: the route is drawn, the view just stays put */ }
    return showCard(opts, graph, fromGps);
  }

  const btn = document.getElementById('commfail-btn');
  if (btn) btn.addEventListener('click', () => { commFailGo(); });
  window.NavAid = window.NavAid || {};
  NavAid.commFail = { go: commFailGo };
})();
