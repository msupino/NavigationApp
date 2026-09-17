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
  // Each source reports when it is asked and when it answers, so the panel can show five rows
  // ticking off rather than one line that sits there. It is honest progress -- a row changes
  // because that feed actually came back -- and it doubles as the failure story: the source that
  // ends in a cross is the one the findings below do not cover.
  const SOURCES = ['airspace', 'notams', 'hazards', 'ceiling', 'cloud'];
  async function gather(onStep) {
    const step = (k, state) => { try { if (onStep) onStep(k, state); } catch (e) { /* cosmetic */ } };
    const track = async (key, make) => {
      step(key, 'asking');
      let v = null;
      try { v = await make(); } catch (e) { v = null; }
      step(key, v === null || v === undefined ? 'failed' : 'done');
      return v;
    };
    const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : null);
    const points = (typeof routeCheckSamplePoints === 'function')
      ? routeCheckSamplePoints((state && state.waypoints) || [], 10) : [];
    const at = departAtMs();

    // All five at once: one feed being slow must not hold the other four, and one being down
    // must not turn them into silence.
    const [airspaceRes, notamsRes, hazardRes, wxRes, cloud] = await Promise.all([
      track('airspace', async () => {
        if (Array.isArray(window.airspace)) return window.airspace;
        await call(window.loadAirspace);
        return Array.isArray(window.airspace) ? window.airspace : null;
      }),
      track('notams', async () => {
        const v = await call(window.loadNotam);
        return Array.isArray(v) ? v : (Array.isArray(window.notams) ? window.notams : null);
      }),
      track('hazards', async () => {
        const [sig, air] = await Promise.all([
          Promise.resolve(call(window.loadSigmets)).catch(() => null),
          Promise.resolve(call(window.loadAirmets)).catch(() => null),
        ]);
        if (!Array.isArray(sig) && !Array.isArray(air)) return null;
        return [...(Array.isArray(sig) ? sig : []), ...(Array.isArray(air) ? air : [])];
      }),
      track('ceiling', async () => {
        const f = await call(window.loadWxFile);
        return (f && f.stations) ? f : null;
      }),
      track('cloud', async () => fetchCloudAlongRoute(points, at)),
    ]);

    // The stations this route actually passes, in the shape the check reads.
    const wx = [];
    if (wxRes && wxRes.stations) {
      const names = fieldsNearRoute(points);
      for (const icao of Object.keys(wxRes.stations)) {
        if (!names.has(icao.toUpperCase())) continue;
        const st = wxRes.stations[icao] || {};
        const m = st.metar;
        // The TAF's own periods, in the shape the check reads: what the field is forecast to be
        // while the flight is there, which is the question a plan asks and a METAR cannot
        // answer. A field can be CAVOK now and forecast SCT018 BKN015 for the hour you arrive.
        const fcsts = tafPeriods(st.taf);
        const taf = fcsts.map(f => ({
          from: Number(f.timeFrom) * 1000,
          to: f.timeTo * 1000,
          clouds: Array.isArray(f.clouds) ? f.clouds : [],
        })).filter(p => Number.isFinite(p.from));
        wx.push({ icao, clouds: (m && m.clouds) || [], taf });
      }
    }
    return {
      waypoints: (state && state.waypoints) || [],
      legs: (state && state.legs) || [],
      legTimesH: legTimesH(),
      departAtMs: at,
      airspace: airspaceRes,
      notams: notamsRes,
      hazards: hazardRes,
      wx: wxRes ? wx : null,
      cloud,
      contains: (a, p) => (typeof airspaceContains === 'function' ? airspaceContains(a, p) : false),
    };
  }

  async function run(onStep) {
    if (typeof routeCheckFindings !== 'function') return null;
    return routeCheckFindings(await gather(onStep));
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
    if (f.kind === 'ceiling' || f.kind === 'layer') {
      // A ceiling is a lid. A scattered or few layer is not, and saying so is the difference
      // between "you cannot get over this" and "there is cloud in your way".
      const what = f.kind === 'ceiling'
        ? (S2.routeCheckCeiling || 'ceiling')
        : ((f.cover || '') + ' ' + (S2.routeCheckLayer || 'layer')).trim();
      const src = f.forecast ? (S2.routeCheckForecast || 'forecast') : (S2.routeCheckObserved || 'reported');
      return {
        head: (f.icao || '') + ' · ' + what + ' ' + ft(f.ceilingFt),
        detail: src + ' · ' + (S2.routeCheckLowestLeg || 'lowest planned leg') + ' ' + ft(f.altFt),
        where: '', when: f.forecast ? span(f.from, f.to) : '',
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

    // Every source, every time, with what it found. Reported as "I only see NOTAMs on the
    // warning list": four of the five had been asked and had nothing to say, and a source that
    // is silent looked exactly like a source that was never consulted. The findings above are
    // what is wrong with the plan; this is what was looked at, which is the other half of
    // trusting the answer.
    const names = {
      airspace: S2.routeCheckSrcAirspace || 'airspace',
      notams: S2.routeCheckSrcNotams || 'NOTAMs',
      hazards: S2.routeCheckSrcHazards || 'SIGMET/AIRMET',
      ceiling: S2.routeCheckSrcCeiling || 'aerodrome reports',
      cloud: S2.routeCheckSrcCloud || 'forecast along the route',
    };
    const counts = {};
    for (const f of result.findings) {
      const key = f.kind === 'hazard' ? 'hazards'
        : (f.kind === 'notam' ? 'notams'
          : (f.kind === 'cloudbase' ? 'cloud'
            : (f.kind === 'ceiling' || f.kind === 'layer' ? 'ceiling' : 'airspace')));
      counts[key] = (counts[key] || 0) + 1;
    }
    const asked = document.createElement('ul');
    asked.className = 'route-check-asked';
    for (const key of SOURCES) {
      const li = document.createElement('li');
      const missing = result.unchecked.includes(key);
      li.className = 'route-check-asked-row'
        + (missing ? ' route-check-asked-missing' : '');
      const mark = document.createElement('span');
      mark.className = 'route-check-step-mark';
      mark.textContent = missing ? '\u2715' : '\u2713';
      const label = document.createElement('span');
      label.textContent = names[key] || key;
      const said = document.createElement('span');
      said.className = 'route-check-asked-said';
      said.textContent = missing
        ? (S2.routeCheckNotRead || 'could not be read')
        : (counts[key]
          ? (S2.routeCheckFound ? S2.routeCheckFound(counts[key]) : counts[key] + ' found')
          : (S2.routeCheckNothing || 'nothing'));
      li.append(mark, label, said);
      asked.appendChild(li);
    }
    body.prepend(asked);
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
    modal.box.append(head, body);

    // Five rows, ticking off as each source answers. A single "asking…" line gives a pilot no
    // way to tell a slow feed from a dead one, and the slowest of these goes over the network
    // to a forecast API. Announced politely: a screen reader should hear the summary settle,
    // not every row as it lands.
    head.textContent = S2.routeCheckWorking
      || 'Asking airspace, NOTAMs, SIGMET/AIRMET, the aerodrome reports and the forecast along the route…';
    const names = {
      airspace: S2.routeCheckSrcAirspace || 'airspace',
      notams: S2.routeCheckSrcNotams || 'NOTAMs',
      hazards: S2.routeCheckSrcHazards || 'SIGMET/AIRMET',
      ceiling: S2.routeCheckSrcCeiling || 'ceiling',
      cloud: S2.routeCheckSrcCloud || 'cloud along the route',
    };
    const progress = document.createElement('ul');
    progress.className = 'route-check-progress';
    progress.setAttribute('aria-live', 'polite');
    const rows = {};
    for (const key of SOURCES) {
      const li = document.createElement('li');
      li.className = 'route-check-step';
      const mark = document.createElement('span');
      mark.className = 'route-check-step-mark';
      mark.textContent = '\u00b7';                  // not started
      const label = document.createElement('span');
      label.textContent = names[key] || key;
      li.append(mark, label);
      progress.appendChild(li);
      rows[key] = { li, mark };
    }
    body.appendChild(progress);
    modal.show();

    const MARKS = { asking: '\u2026', done: '\u2713', failed: '\u2715' };
    const onStep = (key, state) => {
      const row = rows[key];
      if (!row || !modal.box.isConnected) return;
      row.mark.textContent = MARKS[state] || '\u00b7';
      row.li.classList.toggle('route-check-step-asking', state === 'asking');
      row.li.classList.toggle('route-check-step-done', state === 'done');
      row.li.classList.toggle('route-check-step-failed', state === 'failed');
    };

    // Held long enough to be SEEN, which is not the same as long enough to be read. On a warm
    // cache all five answer at once and the list was gone before the eye had found it; the
    // first fix reached for toastReadMs and held it for the time it takes to read every word,
    // which on this much text is eight seconds of staring at a list whose answer is already in.
    //
    // toastNoticeMs is the figure that fits: the app defines it as "the beat before reading
    // begins -- the eye has to find the thing that just appeared", which is exactly what this
    // list needs and all it needs. Nobody has to read five labels word by word to learn that
    // five sources were asked.
    const noticeMs = () => {
      const v = (typeof tune === 'function') ? tune('toastNoticeMs') : 0;
      return Number.isFinite(v) && v > 0 ? v : 1000;
    };
    const started = Date.now();
    const result = await run(onStep);
    const left = noticeMs() - (Date.now() - started);
    if (left > 0) await new Promise(r => setTimeout(r, left));
    if (!modal.box.isConnected) return null;      // closed while the feeds were answering
    if (result) render(head, body, result);
    return modal;
  }

  NS.routeCheck = { show, run, gather, lineFor };
}());
