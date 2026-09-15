// Nav log — the wind-triangle document the flight plan deliberately is not.
//
// The plan is zero-wind on purpose: a printed plan must not change because a weather fetch
// landed. This is the other sheet, the one a CVFR written exercise asks for, where the whole
// point is the arithmetic between an indicated airspeed and a compass heading. The maths lives
// in core.js (navLogRows and friends, checked against a published exercise); this file is the
// window around it: what the pilot types in, and what comes out.
(function () {
  'use strict';
  const NS = (window.NavAid = window.NavAid || {});
  const KEY = 'navaid.navlog';
  // Every 30°, which is how a compass card is swung and printed. Deviation zero until the
  // pilot types their own: a made-up card is worse than none, since it looks like data.
  const CARD_HEADINGS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  const featureOn = () => typeof tune !== 'function' || tune('featureNavLog') !== false;
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

  function stored() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
  }
  function save(cfg) {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* private mode */ }
  }

  // The elevation of an endpoint, when the endpoint is a field we know. Typed values win: an
  // exercise may put the aeroplane on a strip the dataset has never heard of.
  function elevationOf(wp) {
    if (typeof airfieldAtWaypoint !== 'function') return null;
    const af = airfieldAtWaypoint(wp);
    return (af && Number.isFinite(af.elev_ft)) ? af.elev_ft : null;
  }

  // What the app already knows, so the sheet opens mostly filled in rather than empty: the
  // route's own cruise altitude and speed, the aircraft's burn, the tuning gist's variation.
  function defaults() {
    const wps = (typeof state === 'object' && state && Array.isArray(state.waypoints))
      ? state.waypoints : [];
    const legs = (typeof state === 'object' && state && Array.isArray(state.legs)) ? state.legs : [];
    const planned = legs.map(l => l && Number(l.inboundAltitude)).filter(a => Number.isFinite(a) && a > 0);
    const ac = (typeof aircraft === 'object' && aircraft) ? aircraft : {};
    // A tunable that is zero is a tunable nobody set: an unset gist key reads as 0, and there is
    // no such thing as a zero cruise speed, a zero rate of climb or a zero fuel burn. The same
    // trap the first-run map view has. Variation is the exception -- zero is a real value there,
    // and it is read separately below.
    const t = (k, d) => {
      const v = (typeof tune === 'function') ? Number(tune(k)) : NaN;
      return (Number.isFinite(v) && v > 0) ? v : d;
    };
    const variation = (typeof tune === 'function') ? Number(tune('magneticVariationDeg')) : NaN;
    const cruiseSpeed = legs.map(l => l && Number(l.speed)).find(s => Number.isFinite(s) && s > 0);
    return {
      cruiseAltFt: planned.length ? Math.max(...planned) : 6000,
      // East positive, as an exercise writes it (4E). The app's own tune is signed the other
      // way -- magnetic = true + variation, so -5 there is 5E here.
      variationDeg: -(Number.isFinite(variation) ? variation : -5),
      depElevFt: wps.length ? (elevationOf(wps[0]) || 0) : 0,
      destElevFt: wps.length > 1 ? (elevationOf(wps[wps.length - 1]) || 0) : 0,
      cas: { climb: 70, cruise: cruiseSpeed || t('defaultSpeed', 90), descent: 100 },
      rates: { climbFpm: t('profileClimbFpm', 800), descentFpm: 1000 },
      fuel: { climbGal: 7, cruiseGph: Number(ac.gph) > 0 ? Number(ac.gph) : t('defaultGph', 8) },
      met: [],
      deviation: CARD_HEADINGS.map(mh => ({ mh, ch: mh })),
    };
  }

  function config() {
    return coerce(stored(), defaults());
  }
  // Everything that reads a config goes through here: what this device stored last time, and
  // what an exercise file hands over. A file is somebody else's JSON -- it gets the same
  // coercion, field by field, and nothing it carries becomes a number without passing it.
  function coerce(s, d) {
    s = (s && typeof s === 'object') ? s : {};
    return {
      cruiseAltFt: num(s.cruiseAltFt, d.cruiseAltFt),
      variationDeg: num(s.variationDeg, d.variationDeg),
      depElevFt: num(s.depElevFt, d.depElevFt),
      destElevFt: num(s.destElevFt, d.destElevFt),
      cas: {
        climb: num(s.cas && s.cas.climb, d.cas.climb),
        cruise: num(s.cas && s.cas.cruise, d.cas.cruise),
        descent: num(s.cas && s.cas.descent, d.cas.descent),
      },
      rates: {
        climbFpm: num(s.rates && s.rates.climbFpm, d.rates.climbFpm),
        descentFpm: num(s.rates && s.rates.descentFpm, d.rates.descentFpm),
      },
      fuel: {
        climbGal: num(s.fuel && s.fuel.climbGal, d.fuel.climbGal),
        cruiseGph: num(s.fuel && s.fuel.cruiseGph, d.fuel.cruiseGph),
      },
      // Capped: a met table is a page of a briefing and a compass card has twelve marks. A file
      // claiming ten thousand rows is not an exercise, and the table it would build is a hang.
      // Sorted by altitude, always: a briefing table is read up the page, and a level typed out
      // of order is a level nobody can check against the sheet it was copied from. The lookup
      // takes the nearest row whatever the order, so this is for the reader, not the maths.
      met: Array.isArray(s.met) ? s.met.filter(r => r && Number.isFinite(Number(r.alt)))
        .slice(0, 60)
        .map(r => ({ alt: Number(r.alt), dir: num(r.dir, 0), kt: num(r.kt, 0), tempC: num(r.tempC, 0) }))
        .sort((a, b) => a.alt - b.alt)
        : d.met,
      deviation: Array.isArray(s.deviation) && s.deviation.length
        ? s.deviation.filter(r => r && Number.isFinite(Number(r.mh))).slice(0, 72)
          .map(r => ({ mh: Number(r.mh), ch: num(r.ch, Number(r.mh)) }))
        : d.deviation,
    };
  }

  // --- exercises as files -------------------------------------------------------------------
  // An exercise is handed out as a sheet: a route, a met table, a compass card and a set of
  // assumptions. Reading one back as JSON is the difference between a feature a pilot can use
  // and one only a console can drive.
  const MAX_POINTS = 100;
  function readWaypoints(raw) {
    const list = (raw && raw.route && Array.isArray(raw.route.waypoints)) ? raw.route.waypoints
      : (Array.isArray(raw && raw.waypoints) ? raw.waypoints : null);
    if (!list) return null;
    const out = [];
    for (const w of list.slice(0, MAX_POINTS)) {
      if (!w || typeof w !== 'object') continue;
      const lat = Number(w.lat), lng = Number(w.lng);
      // Israel is the airspace, but the check here is only that these are coordinates at all:
      // an exercise may legitimately run off the edge of the chart, and a silent reject is
      // worse than a route the pilot can see is wrong.
      if (!Number.isFinite(lat) || Math.abs(lat) > 90) continue;
      if (!Number.isFinite(lng) || Math.abs(lng) > 180) continue;
      const name = typeof w.name === 'string' ? w.name.slice(0, 40)
        : (typeof w.he === 'string' ? w.he.slice(0, 40) : '');
      out.push({ lat, lng, name });
    }
    return out.length >= 2 ? out : null;
  }
  // Parses, never applies. Returns null for anything that is not an exercise, so the caller can
  // say so rather than half-loading one.
  function parseExercise(text) {
    let raw = null;
    try { raw = JSON.parse(String(text)); } catch (e) { return null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const src = (raw.navlog && typeof raw.navlog === 'object') ? raw.navlog : raw;
    const waypoints = readWaypoints(raw);
    // A file with neither a route nor any assumption in it is not an exercise.
    const hasConfig = ['cruiseAltFt', 'cas', 'met', 'deviation', 'variationDeg', 'rates', 'fuel']
      .some(k => Object.prototype.hasOwnProperty.call(src, k));
    if (!waypoints && !hasConfig) return null;
    // The elevations an exercise states beat the dataset's: it may be flying from a strip that
    // is not in it, or -- as the Herzliya sheet does -- round 121 ft to 100.
    const d = defaults();
    if (waypoints) {
      const first = (raw.route && raw.route.waypoints) ? raw.route.waypoints[0] : null;
      const last = (raw.route && raw.route.waypoints)
        ? raw.route.waypoints[raw.route.waypoints.length - 1] : null;
      if (first && Number.isFinite(Number(first.elevFt))) d.depElevFt = Number(first.elevFt);
      if (last && Number.isFinite(Number(last.elevFt))) d.destElevFt = Number(last.elevFt);
    }
    return {
      title: typeof raw.title === 'string' ? raw.title.slice(0, 120) : '',
      waypoints,
      navlog: coerce(src, d),
    };
  }

  // Applies one. The route is REPLACED, so it asks first when there is one to lose -- in the
  // app's own dialog, because the answer decides whether a drawn plan survives.
  async function importExercise(text, opts) {
    const S2 = window.S || {};
    const parsed = parseExercise(text);
    // The caller has already drawn the route itself -- an exercise that is also a route file
    // goes down the app's own route path, legs and planned altitudes intact.
    if (parsed && opts && opts.skipRoute) parsed.waypoints = null;
    if (!parsed) {
      if (typeof showToast === 'function') {
        showToast(S2.navTableImportBad || 'That file is not an exercise: no route and no settings in it.',
          { warn: true });
      }
      return null;
    }
    if (parsed.waypoints && typeof state === 'object' && state
      && Array.isArray(state.waypoints) && state.waypoints.length) {
      const ask = S2.navTableReplaceRoute
        || 'This exercise carries its own route. Load it? This replaces the route on your map.';
      let take = false;
      try {
        take = typeof window.askYesNo === 'function'
          ? await window.askYesNo(S2.navTableTitle || 'Nav table', ask,
            S2.navTableReplaceRouteOk || 'Load the route')
          : true;
      } catch (e) { take = false; }
      if (!take) parsed.waypoints = null;      // the settings still land; the plan is untouched
    }
    if (parsed.waypoints) {
      if (typeof recordUndoSnapshot === 'function') recordUndoSnapshot();
      state.waypoints = parsed.waypoints;
      if (typeof syncLegs === 'function') syncLegs();
      if (typeof draw === 'function') draw();
    }
    save(parsed.navlog);
    if (typeof showToast === 'function') {
      showToast((S2.navTableImported || 'Exercise loaded.') + (parsed.title ? ' — ' + parsed.title : ''));
    }
    return parsed;
  }

  // The other direction: this device's sheet as a file, in the shape an exercise arrives in.
  function exportExercise(cfg) {
    const c = cfg || config();
    const wps = (typeof state === 'object' && state && Array.isArray(state.waypoints))
      ? state.waypoints : [];
    const doc = {
      title: (typeof routeFileSlug === 'function') ? routeFileSlug() : 'route',
      route: {
        waypoints: wps.map((w, i) => Object.assign({ name: w.name || '', lat: w.lat, lng: w.lng },
          i === 0 ? { elevFt: c.depElevFt } : {},
          i === wps.length - 1 ? { elevFt: c.destElevFt } : {})),
      },
      navlog: c,
    };
    const text = JSON.stringify(doc, null, 2);
    if (typeof saveFile === 'function' && typeof Blob === 'function') {
      const stamp = (typeof fileStamp === 'function') ? fileStamp() : '';
      saveFile(new Blob([text], { type: 'application/json' }),
        'nav-table-' + doc.title + (stamp ? '-' + stamp : '') + '.json');
    }
    return text;
  }

  // The rows, from the route on the map and the config above.
  function rows(cfg) {
    const c = cfg || config();
    const wps = (typeof state === 'object' && state && Array.isArray(state.waypoints))
      ? state.waypoints : [];
    if (typeof navLogRows !== 'function') return [];
    return navLogRows({
      waypoints: wps,
      depElevFt: c.depElevFt,
      destElevFt: c.destElevFt,
      cruiseAltFt: c.cruiseAltFt,
      cas: c.cas,
      rates: c.rates,
      fuel: c.fuel,
      met: c.met,
      deviation: c.deviation,
      variationDeg: c.variationDeg,
      // Where the typed table is silent, whatever the app itself knows about the wind on this
      // leg -- the route wind, or a per-leg override the pilot set on the map.
      windFor: (legIndex) => {
        const legs = (typeof state === 'object' && state && Array.isArray(state.legs)) ? state.legs : [];
        return (typeof legWindFor === 'function') ? legWindFor(legs[legIndex]) : null;
      },
    });
  }

  // --- formatting -------------------------------------------------------------------------
  // Rounded HERE and nowhere earlier: the arithmetic carries full precision, because rounding
  // at each step and again at the next is how two correct sheets end up a digit apart.
  const deg = (v) => (Number.isFinite(v) ? String(Math.round(v) % 360).padStart(3, '0') : '');
  const one = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) : '');
  const whole = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '');
  const signed = (v) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + Math.round(v) : '');
  function clock(hours) {
    if (!Number.isFinite(hours) || hours < 0) return '';
    const total = Math.round(hours * 3600);
    const m = Math.floor(total / 60), s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
  function cells(row, index, cfg) {
    const S2 = window.S || {};
    return [
      String(index + 1),
      row.from,
      row.to,
      whole(row.casKt),
      whole(row.pressureAltFt),
      signed(row.tempC),
      one(row.tasKt),
      row.wind ? deg(row.wind.dir) : '',
      row.wind ? whole(row.wind.speed) : '',
      deg(row.trackShownDeg),
      row.driftSide ? (Math.round(row.driftShownDeg) + row.driftSide) : '0',
      deg(row.trueHeadingDeg),
      (cfg.variationDeg >= 0 ? Math.abs(Math.round(cfg.variationDeg)) + 'E'
        : Math.abs(Math.round(cfg.variationDeg)) + 'W'),
      deg(row.magneticHeadingDeg),
      Number.isFinite(row.deviationDeg) ? signed(row.deviationDeg) : '',
      deg(row.compassHeadingDeg),
      row.unflyable ? (S2.navLogUnflyable || '—') : one(row.groundSpeedKt),
      one(row.distNm),
      clock(row.timeH),
      clock(row.cumTimeH),
      one(row.gph),
      one(row.fuelGal),
      one(row.cumFuelGal),
    ];
  }
  function headers() {
    const S2 = window.S || {};
    return Array.isArray(S2.navLogHeaders) && S2.navLogHeaders.length === 23
      ? S2.navLogHeaders
      : ['LEG', 'From', 'To', 'CAS', 'PA', 'Temp', 'TAS', 'W dir', 'W kt', 'TT', 'Drift', 'TH',
        'Var', 'MH', 'Dev', 'CH', 'GS', 'Dist', 'Time', 'Cum time', 'FF', 'Fuel', 'Cum fuel'];
  }

  // --- the window -------------------------------------------------------------------------
  // The open sheet's own refresh, while it is open. One window at a time: opening a second
  // replaces the first's handle, and closing either clears it.
  let live = null;
  function routeChanged() { if (typeof live === 'function') live(); }

  // `read` lets the window refresh a field from the config without rebuilding it: the route can
  // change under an open sheet, and rebuilding an input the pilot is typing in takes the caret
  // with it.
  function field(label, value, onInput, opts) {
    const wrap = document.createElement('label');
    wrap.className = 'navlog-field';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = Number.isFinite(value) ? String(value) : '';
    if (opts && opts.step) input.step = opts.step;
    input.addEventListener('input', () => onInput(input.value));
    wrap.append(text, input);
    wrap.sync = (next) => {
      if (document.activeElement === input) return;      // never fight the pilot for the caret
      const shown = Number.isFinite(next) ? String(next) : '';
      if (input.value !== shown) input.value = shown;
    };
    return wrap;
  }

  function show() {
    if (!featureOn()) return null;
    const S2 = window.S || {};
    if (typeof createDraggableModal !== 'function') return null;
    const cfg = config();
    const modal = createDraggableModal(S2.navTableTitle || 'Nav table', 'modal wide navlog-modal',
      () => { live = null; }, { nonBlocking: true });
    const body = document.createElement('div');
    body.className = 'navlog-body';
    modal.box.appendChild(body);

    const table = document.createElement('table');
    table.className = 'navlog-table';
    const note = document.createElement('div');
    note.className = 'navlog-note';

    const commit = () => { save(cfg); render(); };

    // The assumptions, in one row of fields: the aeroplane, the day, and the two fields.
    const setup = document.createElement('div');
    setup.className = 'navlog-setup';
    const fields = [];
    const add = (f, read) => { fields.push({ f, read }); return f; };
    setup.append(
      add(field(S2.navLogCruiseAlt || 'Cruise (ft)', cfg.cruiseAltFt, v => { cfg.cruiseAltFt = num(v, 0); commit(); }), c => c.cruiseAltFt),
      add(field(S2.navLogDepElev || 'Departure elev (ft)', cfg.depElevFt, v => { cfg.depElevFt = num(v, 0); commit(); }), c => c.depElevFt),
      add(field(S2.navLogDestElev || 'Destination elev (ft)', cfg.destElevFt, v => { cfg.destElevFt = num(v, 0); commit(); }), c => c.destElevFt),
      field(S2.navLogVariation || 'Variation (°E)', cfg.variationDeg, v => { cfg.variationDeg = num(v, 0); commit(); }),
      field(S2.navLogCasClimb || 'Climb CAS', cfg.cas.climb, v => { cfg.cas.climb = num(v, 0); commit(); }),
      field(S2.navLogCasCruise || 'Cruise CAS', cfg.cas.cruise, v => { cfg.cas.cruise = num(v, 0); commit(); }),
      field(S2.navLogCasDescent || 'Descent CAS', cfg.cas.descent, v => { cfg.cas.descent = num(v, 0); commit(); }),
      field(S2.navLogClimbRate || 'Climb (fpm)', cfg.rates.climbFpm, v => { cfg.rates.climbFpm = num(v, 0); commit(); }),
      field(S2.navLogDescentRate || 'Descent (fpm)', cfg.rates.descentFpm, v => { cfg.rates.descentFpm = num(v, 0); commit(); }),
      field(S2.navLogClimbFuel || 'Climb fuel (gal)', cfg.fuel.climbGal, v => { cfg.fuel.climbGal = num(v, 0); commit(); }, { step: '0.1' }),
      field(S2.navLogCruiseGph || 'Cruise (gal/h)', cfg.fuel.cruiseGph, v => { cfg.fuel.cruiseGph = num(v, 0); commit(); }, { step: '0.1' }),
    );

    // The met table. Empty by default -- an exercise hands you one, and inventing rows would
    // put numbers on the sheet nobody chose.
    const met = document.createElement('div');
    met.className = 'navlog-met';
    function renderMet() {
      met.replaceChildren();
      const head = document.createElement('div');
      head.className = 'navlog-sub-title';
      head.textContent = S2.navLogMet || 'Met table';
      met.appendChild(head);
      const grid = document.createElement('table');
      grid.className = 'navlog-grid';
      const hr = document.createElement('tr');
      for (const h of [S2.navLogMetAlt || 'Alt (ft)', S2.navLogMetDir || 'Wind °', S2.navLogMetKt || 'Wind kt',
        S2.navLogMetTemp || 'Temp °C', '']) {
        const th = document.createElement('th');
        th.textContent = h;
        hr.appendChild(th);
      }
      grid.appendChild(hr);
      cfg.met.forEach((row, i) => {
        const tr = document.createElement('tr');
        for (const key of ['alt', 'dir', 'kt', 'tempC']) {
          const td = document.createElement('td');
          const input = document.createElement('input');
          input.type = 'number';
          input.value = String(row[key]);
          input.addEventListener('input', () => { row[key] = num(input.value, 0); save(cfg); render(); });
          // Sorting WHILE typing would move the row out from under the caret, so it happens on
          // the way out of the field -- which is also when the number is finished.
          if (key === 'alt') {
            input.addEventListener('change', () => {
              cfg.met.sort((a, b) => a.alt - b.alt);
              commit();
              renderMet();
            });
          }
          td.appendChild(input);
          tr.appendChild(td);
        }
        const del = document.createElement('td');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'navlog-row-del';
        btn.textContent = '✕';
        btn.title = S2.navLogRemoveRow || 'Remove this row';
        btn.setAttribute('aria-label', btn.title);
        btn.addEventListener('click', () => { cfg.met.splice(i, 1); commit(); renderMet(); });
        del.appendChild(btn);
        tr.appendChild(del);
        grid.appendChild(tr);
      });
      met.appendChild(grid);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'navlog-add';
      add.textContent = S2.navLogAddRow || 'Add a level';
      add.addEventListener('click', () => {
        const highest = cfg.met.reduce((top, r) => Math.max(top, r.alt), 0);
        cfg.met.push({ alt: highest ? highest + 1000 : 2000, dir: 0, kt: 0, tempC: 15 });
        cfg.met.sort((a, b) => a.alt - b.alt);
        commit();
        renderMet();
      });
      met.appendChild(add);
    }

    // The compass card: the headings are fixed at the 30° marks a card is swung on, and only
    // the "steer" column is typed.
    const card = document.createElement('div');
    card.className = 'navlog-card';
    function renderCard() {
      card.replaceChildren();
      const head = document.createElement('div');
      head.className = 'navlog-sub-title';
      head.textContent = S2.navLogCard || 'Compass card';
      card.appendChild(head);
      const grid = document.createElement('table');
      grid.className = 'navlog-grid';
      const hr = document.createElement('tr');
      for (const h of [S2.navLogCardFor || 'For (M)', S2.navLogCardSteer || 'Steer (C)']) {
        const th = document.createElement('th');
        th.textContent = h;
        hr.appendChild(th);
      }
      grid.appendChild(hr);
      for (const entry of cfg.deviation) {
        const tr = document.createElement('tr');
        const mh = document.createElement('td');
        mh.textContent = deg(entry.mh);
        const ch = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'number';
        input.value = String(entry.ch);
        input.addEventListener('input', () => { entry.ch = num(input.value, entry.mh); save(cfg); render(); });
        ch.appendChild(input);
        tr.append(mh, ch);
        grid.appendChild(tr);
      }
      card.appendChild(grid);
    }

    function render() {
      const list = rows(cfg);
      table.replaceChildren();
      const hr = document.createElement('tr');
      for (const h of headers()) {
        const th = document.createElement('th');
        th.textContent = h;
        hr.appendChild(th);
      }
      table.appendChild(hr);
      list.forEach((row, i) => {
        const tr = document.createElement('tr');
        tr.className = 'navlog-row navlog-' + row.kind;
        cells(row, i, cfg).forEach((text, col) => {
          const td = document.createElement('td');
          // Aviation values read left to right in either language, like the live readout.
          const bdi = document.createElement('bdi');
          bdi.dir = col === 1 || col === 2 ? 'auto' : 'ltr';
          bdi.textContent = text;
          td.appendChild(bdi);
          if (col === 5 || col === 7 || col === 8) td.title = sourceText(row.metSource);
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      note.textContent = list.length ? ''
        : (S2.navLogNoRoute || 'Draw a route with at least two points, and set a cruise altitude above both fields.');
    }
    // The route can change under an open sheet -- a waypoint dragged on the map, a point added,
    // a leg's altitude edited. Reported as "moving waypoints while the table is open does not
    // affect the data": it was built once at open and then never looked again.
    //
    // Only the DATA is rebuilt. The editors are left alone unless what they show has actually
    // changed, because rebuilding an input mid-keystroke takes the caret with it.
    function refresh() {
      const next = config();
      // Defaults follow the route: swap the destination airfield and its elevation should
      // follow, unless the pilot typed one, in which case what they typed is in the config.
      for (const key of ['cruiseAltFt', 'depElevFt', 'destElevFt']) cfg[key] = next[key];
      for (const { f, read } of fields) f.sync(read(cfg));
      render();
    }
    function sourceText(source) {
      if (source === 'table') return S2.navLogFromTable || 'from the met table';
      if (source === 'app') return S2.navLogFromApp || 'from the route wind';
      return S2.navLogFromIsa || 'standard atmosphere — nothing typed, nothing fetched';
    }

    const actions = document.createElement('div');
    actions.className = 'navlog-actions';
    // The same file the app's own Open accepts -- this is the shortcut from inside the window
    // you are already looking at, not a second format.
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'navlog-import';
    importBtn.textContent = S2.navTableImport || 'Open exercise';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.json,application/json';
    picker.className = 'navlog-file';
    picker.hidden = true;
    picker.addEventListener('change', () => {
      const file = picker.files && picker.files[0];
      picker.value = '';
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {           // the same cap the route loader uses
        if (typeof refuse === 'function') refuse((S2.errLoadFile || '') + 'file too large');
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const applied = await importExercise(reader.result);
        if (!applied) return;
        Object.assign(cfg, config());
        renderMet();
        renderCard();
        render();
      };
      reader.readAsText(file);
    });
    importBtn.addEventListener('click', () => picker.click());
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'navlog-export';
    exportBtn.textContent = S2.navTableExport || 'Save exercise';
    exportBtn.addEventListener('click', () => exportExercise(cfg));
    const csv = document.createElement('button');
    csv.type = 'button';
    csv.textContent = S2.navLogCsv || 'CSV';
    csv.addEventListener('click', () => exportCsv(cfg));
    const print = document.createElement('button');
    print.type = 'button';
    print.textContent = S2.navLogPrint || 'Print';
    print.addEventListener('click', () => window.print());
    actions.append(importBtn, picker, exportBtn, csv, print);

    renderMet();
    renderCard();
    render();
    live = refresh;
    const editors = document.createElement('div');
    editors.className = 'navlog-editors';
    editors.append(met, card);
    body.append(setup, editors, note, table, actions);
    modal.show();     // createDraggableModal is already draggable by its title bar
    return modal;
  }

  // The same rows, as a file. The header row is the export contract: reworded titles belong in
  // the display, not here, or anything downstream keyed on a column loses it.
  function exportCsv(cfg) {
    const c = cfg || config();
    const list = rows(c);
    if (!list.length) return null;
    const esc = (v) => (/[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v);
    const lines = [headers().map(esc).join(',')];
    list.forEach((row, i) => lines.push(cells(row, i, c).map(esc).join(',')));
    const text = lines.join('\n');
    // The same path the flight plan's CSV takes, BOM included: Excel reads a Hebrew waypoint
    // name as mojibake without it, which is most of the From/To column.
    if (typeof saveFile === 'function' && typeof Blob === 'function') {
      const slug = (typeof routeFileSlug === 'function') ? routeFileSlug() : 'route';
      const stamp = (typeof fileStamp === 'function') ? fileStamp() : '';
      saveFile(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' }),
        'nav-log-' + slug + (stamp ? '-' + stamp : '') + '.csv');
    }
    return text;
  }

  NS.navLog = { show, config, save, rows, exportCsv, headers, cells, defaults,
    parseExercise, importExercise, exportExercise, routeChanged };
}());
