// The route check: the five things that can say "not this plan, not at this time", asked
// together and against the clock.
//
// Each of them already knew its own half. The airspace inspector knew the route crossed a
// CTR, the NOTAM list knew a field was closed, the SIGMET layer knew where the weather was,
// the METAR knew the ceiling -- and none of them knew what the air was doing between the
// fields at all. Five surfaces now, none of which was looking at the plan, and none of
// them looking at WHEN. A NOTAM that lifts at 10:00 is not a warning on a flight that lands
// at 11:00, and a danger area live from 09:00 is not a warning on a leg flown at 08:20.
//
// The arithmetic is core.js's routeCheckFindings(), which is pure and knows nothing about
// fetching or the DOM. This file is the part that goes and gets the five datasets, hands them
// over, and puts the answer on screen.
(function () {
  const NS = (window.NavAid = window.NavAid || {});
  const featureOn = () => typeof tune !== 'function' || tune('featureRouteCheck') !== false;

  // Departure is the look-ahead clock, the same master slider the NOTAM list, the wind field
  // and the planning form's forecast all answer to. Planning is done for a flight that has not
  // happened yet, so "now" is the wrong question to ask of any of this.
  function departAtMs() {
    const el = document.getElementById('lookahead-time');
    const v = el ? parseInt(el.value, 10) : 0;
    return Date.now() + (Number.isFinite(v) && v > 0 ? v : 0) * 3600000;
  }

  // Leg times from the one model everything else flies by, so the check cannot disagree with
  // the kites, the plan and the nav log about when the aeroplane is where.
  function legTimesH() {
    const prof = (typeof routeProfile === 'function') ? routeProfile() : null;
    const legs = (prof && Array.isArray(prof.legs)) ? prof.legs : [];
    return legs.map(l => (Number.isFinite(l.timeH) ? l.timeH : 0));
  }

  // The air along the route, not just over its aerodromes. One request for every sample point --
  // Open-Meteo takes them comma-separated and answers with an array, each entry carrying its own
  // ground elevation, which is what turns a base above the ground into a height above the sea
  // that a planned altitude can be compared with.
  //
  // `cloud_base` is accepted by the API and comes back null: it is not served by the model this
  // uses. The base is derived instead, from the surface temperature and dew point.
  const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
  async function fetchCloudAlongRoute(points, atMs) {
    if (!Array.isArray(points) || !points.length) return null;
    // A cap, because the URL is one line and a 400 NM route sampled every ten miles is forty
    // points. Beyond it the spacing widens rather than the tail being dropped: a check that
    // quietly stopped looking two thirds of the way along would be worse than a coarser one.
    const MAX = 25;
    const use = points.length <= MAX
      ? points
      : points.filter((_, i) => i % Math.ceil(points.length / MAX) === 0);
    const lat = use.map(p => p.lat.toFixed(3)).join(',');
    const lng = use.map(p => p.lng.toFixed(3)).join(',');
    const url = OPEN_METEO + '?latitude=' + lat + '&longitude=' + lng
      + '&hourly=temperature_2m,dew_point_2m,cloud_cover_low'
      + '&timezone=UTC&forecast_days=2';
    let list;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      list = Array.isArray(j) ? j : [j];
    } catch (e) { return null; }
    const stamp = new Date(Number.isFinite(atMs) ? atMs : Date.now()).toISOString().slice(0, 13);
    const out = [];
    use.forEach((p, i) => {
      const loc = list[i];
      const hours = loc && loc.hourly && Array.isArray(loc.hourly.time) ? loc.hourly.time : null;
      if (!hours) return;
      let at = hours.findIndex(t => String(t).slice(0, 13) === stamp);
      if (at < 0) at = 0;
      const read = (k) => {
        const arr = loc.hourly[k];
        return Array.isArray(arr) && Number.isFinite(Number(arr[at])) ? Number(arr[at]) : null;
      };
      const t = read('temperature_2m'), d = read('dew_point_2m');
      out.push({
        lat: p.lat, lng: p.lng, leg: p.leg,
        baseFtAgl: routeCheckCloudBaseAglFt(t, d),
        lowCoverPct: read('cloud_cover_low'),
        elevFt: Number.isFinite(loc.elevation) ? loc.elevation * 3.28084 : 0,
      });
    });
    return out.length ? out : null;
  }

  // The fields worth asking a METAR of: the ones near the route, not only the ones it names.
  // A plan that routes past Haifa without landing there still cares what Haifa is reporting.
  const WX_NEAR_NM = 15;
  function fieldsNearRoute(points) {
    const out = new Set();
    for (const w of ((state && state.waypoints) || [])) {
      const n = String((w && w.name) || '').trim().toUpperCase();
      if (/^[A-Z]{4}$/.test(n)) out.add(n);
    }
    if (!Array.isArray(window.airfields)) return out;
    for (const af of window.airfields) {
      const icao = String((af && af.icao) || (af && af.name) || '').trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(icao) || out.has(icao)) continue;
      if (!Number.isFinite(af.lat) || !Number.isFinite(af.lng)) continue;
      for (const p of points) {
        if (routeCheckNmBetween(p, af) <= WX_NEAR_NM) { out.add(icao); break; }
      }
    }
    return out;
  }

  // The five datasets, each fetched the way its own layer fetches it, and each allowed to fail
  // on its own: one feed that is down must not turn the others into silence.
  async function gather() {
    const want = (fn, force) => {
      try { return typeof fn === 'function' ? fn(force) : null; } catch (e) { return null; }
    };
    const [notamsRes, sigRes, airRes, wxRes] = await Promise.all([
      Promise.resolve(want(window.loadNotam)).catch(() => null),
      Promise.resolve(want(window.loadSigmets)).catch(() => null),
      Promise.resolve(want(window.loadAirmets)).catch(() => null),
      Promise.resolve(want(window.loadWxFile)).catch(() => null),
    ]);
    if (typeof loadAirspace === 'function' && !Array.isArray(window.airspace)) {
      try { await loadAirspace(); } catch (e) { /* its own layer says so */ }
    }
    const hazards = [];
    for (const list of [sigRes, airRes]) if (Array.isArray(list)) hazards.push(...list);
    // The stations this route actually touches, in the shape the check reads: a ceiling is a
    // property of a field on the plan, not of every field in the country.
    const points = (typeof routeCheckSamplePoints === 'function')
      ? routeCheckSamplePoints((state && state.waypoints) || [], 10) : [];
    const cloud = await fetchCloudAlongRoute(points, departAtMs());
    const wx = [];
    const stations = (wxRes && wxRes.stations) || null;
    if (stations) {
      const names = fieldsNearRoute(points);
      for (const icao of Object.keys(stations)) {
        if (!names.has(icao.toUpperCase())) continue;
        const m = stations[icao] && stations[icao].metar;
        wx.push({ icao, clouds: (m && m.clouds) || [] });
      }
    }
    return {
      waypoints: (state && state.waypoints) || [],
      legs: (state && state.legs) || [],
      legTimesH: legTimesH(),
      departAtMs: departAtMs(),
      airspace: Array.isArray(window.airspace) ? window.airspace : null,
      notams: Array.isArray(notamsRes) ? notamsRes
        : (Array.isArray(window.notams) ? window.notams : null),
      hazards: (Array.isArray(sigRes) || Array.isArray(airRes)) ? hazards : null,
      wx: stations ? wx : null,
      cloud,
      contains: (a, p) => (typeof airspaceContains === 'function' ? airspaceContains(a, p) : false),
    };
  }

  async function run() {
    if (typeof routeCheckFindings !== 'function') return null;
    return routeCheckFindings(await gather());
  }

  const hhmm = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) : '');
  const hhmmZ = (ms) => (Number.isFinite(ms) ? hhmm(ms) + 'Z' : '');
  // An open end is what a NOTAM with no end and a permanent area both carry, and "until
  // further notice" is what that means to a pilot -- not a blank.
  function span(from, to) {
    const S2 = window.S || {};
    if (!Number.isFinite(from) && !Number.isFinite(to)) return '';
    if (!Number.isFinite(to)) return (S2.routeCheckFrom || 'from') + ' ' + hhmmZ(from);
    if (!Number.isFinite(from)) return (S2.routeCheckUntil || 'until') + ' ' + hhmmZ(to);
    // One Z on the pair, the way a validity is written: 08:00-08:30Z, not 08:00Z-08:30Z.
    return hhmm(from) + '\u2013' + hhmmZ(to);
  }
  const ft = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString() + ' ft' : '');
  function band(lower, upper) {
    const S2 = window.S || {};
    const lo = Number.isFinite(lower) && lower > 0 ? ft(lower) : (S2.routeCheckSfc || 'SFC');
    const hi = Number.isFinite(upper) ? ft(upper) : (S2.routeCheckUnl || 'unlimited');
    return lo + '–' + hi;
  }
  const legName = (i) => {
    const wps = (state && state.waypoints) || [];
    const a = wps[i], b = wps[i + 1];
    const nm = (w) => (typeof navName === 'function' ? navName((w && w.name) || '') : ((w && w.name) || ''));
    return (a && b) ? nm(a) + ' → ' + nm(b) : '';
  };

  // One line per finding: what it is, where on the route, and when. The "when" is the point.
  function lineFor(f) {
    const S2 = window.S || {};
    const where = Number.isInteger(f.leg) ? legName(f.leg) : '';
    if (f.kind === 'airspace') {
      const head = (f.name || '') + (f.airspaceClass ? ' (' + f.airspaceClass + ')' : '');
      const detail = f.noAltitude
        ? (S2.routeCheckNoAlt || 'crossed, and no altitude is planned for that leg')
        : ((S2.routeCheckCrossedAt || 'crossed at') + ' ' + ft(f.altFt));
      return { head, detail: detail + ' · ' + band(f.lowerFt, f.upperFt), where, when: span(f.from, f.to) };
    }
    if (f.kind === 'notam') {
      const head = (f.onField ? (f.icao || '') + ' · ' : '') + (f.id || 'NOTAM');
      return { head, detail: f.text || '', where, when: span(f.from, f.to) };
    }
    if (f.kind === 'hazard') {
      const head = [f.qualifier, f.hazard].filter(Boolean).join(' ');
      return { head, detail: band(f.baseFt, f.topFt), where, when: span(f.from, f.to) };
    }
    if (f.kind === 'cloudbase') {
      // Said as an estimate, every time. This is a spread rule on a forecast, not a report:
      // a derived figure dressed as a METAR is a wrong number wearing the shape of a right one.
      const head = (S2.routeCheckCloudEst || 'Estimated cloud base') + ' ' + ft(f.baseFtAmsl)
        + ' (' + (S2.routeCheckAgl || 'AGL') + ' ' + ft(f.baseFtAgl) + ')';
      const detail = (S2.routeCheckLowCover || 'low cloud') + ' ' + f.coverPct + '%'
        + ' · ' + (S2.routeCheckLegPlanned || 'leg planned') + ' ' + ft(f.altFt);
      return { head, detail, where, when: span(f.from, f.to) };
    }
    if (f.kind === 'ceiling') {
      return {
        head: (f.icao || '') + ' · ' + (S2.routeCheckCeiling || 'ceiling') + ' ' + ft(f.ceilingFt),
        detail: (S2.routeCheckLowestLeg || 'lowest planned leg') + ' ' + ft(f.altFt),
        where: '', when: '',
      };
    }
    return { head: '', detail: '', where: '', when: '' };
  }

  // `head` is a sibling of the scroller, not its first child. The window this was checked FOR is
  // the one line every finding below is relative to -- a NOTAM valid 13:00-14:00 means nothing
  // without it -- so it scrolling away with the list was the worst line to lose. Every other
  // chart in this app keeps its header; so does this one now.
  function render(head, body, result) {
    const S2 = window.S || {};
    body.replaceChildren();
    head.textContent = (S2.routeCheckWindow || 'Checked for')
      + ' ' + span(result.from, result.to);

    if (!result.findings.length) {
      const ok = document.createElement('p');
      ok.className = 'route-check-clear';
      ok.textContent = S2.routeCheckClear
        || 'Nothing found against this plan in that window.';
      body.appendChild(ok);
    }
    const list = document.createElement('ul');
    list.className = 'route-check-list';
    for (const f of result.findings) {
      const li = document.createElement('li');
      li.className = 'route-check-item route-check-' + f.severity;
      const mark = document.createElement('span');
      mark.className = 'route-check-mark';
      mark.textContent = f.severity === 'stop' ? '⛔' : '⚠';
      const text = document.createElement('div');
      const parts = lineFor(f);
      const h = document.createElement('div');
      h.className = 'route-check-head';
      h.textContent = parts.head;
      text.appendChild(h);
      for (const [cls, val] of [['route-check-detail', parts.detail],
        ['route-check-where', parts.where], ['route-check-when-row', parts.when]]) {
        if (!val) continue;
        const d = document.createElement('div');
        d.className = cls;
        d.textContent = val;
        text.appendChild(d);
      }
      li.append(mark, text);
      list.appendChild(li);
    }
    body.appendChild(list);

    // A source that could not be read is not a clear source. Saying so is the difference
    // between "no NOTAMs affect this route" and "I could not ask about NOTAMs".
    if (result.unchecked.length) {
      const miss = document.createElement('p');
      miss.className = 'route-check-unchecked';
      const names = { airspace: S2.routeCheckSrcAirspace || 'airspace',
        notams: S2.routeCheckSrcNotams || 'NOTAMs',
        hazards: S2.routeCheckSrcHazards || 'SIGMET/AIRMET',
        cloud: S2.routeCheckSrcCloud || 'cloud along the route',
        ceiling: S2.routeCheckSrcCeiling || 'ceiling' };
      miss.textContent = (S2.routeCheckCouldNotAsk || 'Not checked (no data):') + ' '
        + result.unchecked.map(k => names[k] || k).join(', ');
      body.appendChild(miss);
    }
  }

  async function show() {
    if (!featureOn()) return null;
    const S2 = window.S || {};
    if (typeof createDraggableModal !== 'function') return null;
    if (!state || !Array.isArray(state.waypoints) || state.waypoints.length < 2) {
      if (typeof refuse === 'function') refuse(S2.routeCheckNeedRoute || S2.errNeedWps
        || 'Draw a route first.');
      return null;
    }
    const modal = createDraggableModal(S2.routeCheckTitle || 'Route check',
      'modal wide route-check-modal', null, { chartKind: 'route-check' });
    const head = document.createElement('div');
    head.className = 'route-check-when';
    const body = document.createElement('div');
    body.className = 'route-check-body';
    const waiting = document.createElement('p');
    waiting.className = 'route-check-waiting';
    waiting.textContent = S2.routeCheckWorking
      || 'Asking airspace, NOTAMs, SIGMET/AIRMET, the aerodrome reports and the forecast along the route…';
    body.appendChild(waiting);
    modal.box.append(head, body);
    // createDraggableModal BUILDS the window; show() is what puts it on screen. Without this
    // the panel was constructed, filled and returned to nobody.
    modal.show();
    const result = await run();
    if (!modal.box.isConnected) return null;      // closed while the feeds were answering
    if (result) render(head, body, result);
    return modal;
  }

  NS.routeCheck = { show, run, gather, lineFor };
}());
