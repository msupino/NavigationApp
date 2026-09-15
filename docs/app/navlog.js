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
    const d = defaults();
    const s = stored();
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
      met: Array.isArray(s.met) ? s.met.filter(r => r && Number.isFinite(Number(r.alt)))
        .map(r => ({ alt: Number(r.alt), dir: num(r.dir, 0), kt: num(r.kt, 0), tempC: num(r.tempC, 0) }))
        : d.met,
      deviation: Array.isArray(s.deviation) && s.deviation.length
        ? s.deviation.filter(r => r && Number.isFinite(Number(r.mh)))
          .map(r => ({ mh: Number(r.mh), ch: num(r.ch, Number(r.mh)) }))
        : d.deviation,
    };
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
    return wrap;
  }

  function show() {
    if (!featureOn()) return null;
    const S2 = window.S || {};
    if (typeof createDraggableModal !== 'function') return null;
    const cfg = config();
    const modal = createDraggableModal(S2.navTableTitle || 'Nav table', 'modal wide navlog-modal',
      null, { nonBlocking: true });
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
    setup.append(
      field(S2.navLogCruiseAlt || 'Cruise (ft)', cfg.cruiseAltFt, v => { cfg.cruiseAltFt = num(v, 0); commit(); }),
      field(S2.navLogDepElev || 'Departure elev (ft)', cfg.depElevFt, v => { cfg.depElevFt = num(v, 0); commit(); }),
      field(S2.navLogDestElev || 'Destination elev (ft)', cfg.destElevFt, v => { cfg.destElevFt = num(v, 0); commit(); }),
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
        const last = cfg.met[cfg.met.length - 1];
        cfg.met.push({ alt: last ? last.alt + 1000 : 2000, dir: 0, kt: 0, tempC: 15 });
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
    function sourceText(source) {
      if (source === 'table') return S2.navLogFromTable || 'from the met table';
      if (source === 'app') return S2.navLogFromApp || 'from the route wind';
      return S2.navLogFromIsa || 'standard atmosphere — nothing typed, nothing fetched';
    }

    const actions = document.createElement('div');
    actions.className = 'navlog-actions';
    const csv = document.createElement('button');
    csv.type = 'button';
    csv.textContent = S2.navLogCsv || 'CSV';
    csv.addEventListener('click', () => exportCsv(cfg));
    const print = document.createElement('button');
    print.type = 'button';
    print.textContent = S2.navLogPrint || 'Print';
    print.addEventListener('click', () => window.print());
    actions.append(csv, print);

    renderMet();
    renderCard();
    render();
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

  NS.navLog = { show, config, save, rows, exportCsv, headers, cells, defaults };
}());
