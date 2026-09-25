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
  // Cum time, counted from LEG: the one column the table draws differently from what cells()
  // returns, because a clock that has not started is a fact about the flight, not a value.
  const COL_CUM_TIME = 19;

  const featureOn = () => typeof tune !== 'function' || tune('featureNavLog') !== false;
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);
  // A heading is a point on a circle, so 364 is 004 and -10 is 350. Typed as 364 it used to
  // stay 364: a number the compass in front of the pilot cannot show, on a card whose whole
  // job is to say what that compass will read.
  const deg360 = (v, fallback) => {
    const n = num(v, null);
    return n === null ? fallback : ((Math.round(n) % 360) + 360) % 360;
  };
  // A percentage box, read as the fraction it means. Anything that is not a number -- and any
  // number that is not a percentage -- leaves the last good value alone: typing over a field
  // character by character must not pass through nonsense on the way.
  const pct = (v, fallback) => {
    const n = Number(String(v).trim());
    if (!Number.isFinite(n)) return fallback;
    return frac(n / 100, fallback);
  };
  const frac = (v, fallback) => {
    const n = Number(v);
    return (Number.isFinite(n) && n >= 0 && n <= 1) ? n : fallback;
  };

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
  // Store ONE field, the one that was just typed.
  //
  // Saving the whole config on every keystroke stored the defaults too -- so the first edit
  // anywhere froze the field elevations at whatever route was open, and they never followed
  // another one again. Reported as a destination elevation of 861 ft, which belongs to no
  // airfield in the dataset: it was a leftover, kept alive by a save that meant nothing.
  //
  // What is not in storage is re-derived every time, which is how an elevation stays the
  // airfield's own until a pilot decides otherwise.
  function saveField(cfg, path) {
    const parts = String(path).split('.');
    const s = stored();
    let src = cfg, dst = s;
    for (let i = 0; i < parts.length - 1; i++) {
      src = src[parts[i]];
      if (!dst[parts[i]] || typeof dst[parts[i]] !== 'object') dst[parts[i]] = {};
      dst = dst[parts[i]];
    }
    dst[parts[parts.length - 1]] = src[parts[parts.length - 1]];
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
  }
  // Forget one typed value, so the field goes back to what the app knows.
  function clearField(path) {
    const parts = String(path).split('.');
    const s = stored();
    let dst = s;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!dst[parts[i]] || typeof dst[parts[i]] !== 'object') return;
      dst = dst[parts[i]];
    }
    delete dst[parts[parts.length - 1]];
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
  }
  function storedHas(path) {
    const parts = String(path).split('.');
    let at = stored();
    for (const part of parts) {
      if (!at || typeof at !== 'object' || !Object.prototype.hasOwnProperty.call(at, part)) return false;
      at = at[part];
    }
    return true;
  }

  // Typed data rather than a setting: a met table and a compass card are the exercise itself,
  // and there is no default to fall back to.
  function saveTables(cfg) {
    const s = stored();
    s.met = cfg.met;
    s.deviation = cfg.deviation;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
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
    const variation = (typeof currentMagVar === 'function') ? Number(currentMagVar()) : NaN;
    const cruiseSpeed = legs.map(l => l && Number(l.speed)).find(s => Number.isFinite(s) && s > 0);
    return {
      // The route's own planned level -- the number already on the leg lines. There is no field
      // for it in the form: two places to set one altitude is two numbers to disagree.
      cruiseAltFt: planned.length ? Math.max(...planned) : 6000,
      routeStatesCruise: planned.length > 0,
      // East positive, as an exercise writes it (4E). The app's own tune is signed the other
      // way -- magnetic = true + variation, so -5 there is 5E here.
      variationDeg: -(Number.isFinite(variation) ? variation : -5),
      depElevFt: wps.length ? (elevationOf(wps[0]) || 0) : 0,
      destElevFt: wps.length > 1 ? (elevationOf(wps[wps.length - 1]) || 0) : 0,
      cas: { climb: 70, cruise: cruiseSpeed || t('defaultSpeed', 90), descent: 100 },
      rates: { climbFpm: t('profileClimbFpm', 800), descentFpm: 1000 },
      fuel: { climbGal: 7, cruiseGph: Number(ac.gph) > 0 ? Number(ac.gph) : t('defaultGph', 8) },
      // Where in the climb and the descent the met data is read -- the exercise's two thirds
      // and one half. Written as fractions of the height gained or lost, measured from the field.
      paFraction: { climb: 2 / 3, descent: 1 / 2 },
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
      // The route wins whenever it says anything: the altitude is edited on the leg, not here.
      // A file may still state one -- an exercise that hands over bare coordinates has no legs
      // to carry it -- and then there is nothing to be overridden.
      cruiseAltFt: d.routeStatesCruise ? d.cruiseAltFt : num(s.cruiseAltFt, d.cruiseAltFt),
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
      // Typed as a percentage in the form; kept as a fraction, which is how the exercise states
      // it and how the arithmetic wants it. Outside 0..1 is not a fraction of anything.
      paFraction: {
        climb: frac(s.paFraction && s.paFraction.climb, d.paFraction.climb),
        descent: frac(s.paFraction && s.paFraction.descent, d.paFraction.descent),
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

  // The gate in front of every exercise route, asked before anything is applied. Both doors pass
  // through it: an exercise that is also a route file (drawn by the app's own route path) and one
  // that is only points (drawn here). Reported as a route replaced with no warning -- the ask
  // lived after applyRouteData had already overwritten the map.
  //
  // The question itself is io.js's, shared with the app's other route doors; only the wording is
  // this window's, because an exercise carries a sheet as well as a route.
  async function askExerciseRoute() {
    const S2 = window.S || {};
    if (typeof askReplaceRoute !== 'function') return true;
    return askReplaceRoute(
      S2.navTableReplaceRoute
        || 'This exercise carries its own route. Load it? This replaces the route on your map.',
      S2.navTableReplaceRouteOk || 'Load the route',
      S2.navTableTitle || 'Flight planning form');
  }

  // The undo the route path takes, so declining is not the only way back.
  function snapshotRoute() {
    if (typeof recordUndoSnapshot !== 'function'
      || typeof routeSnapshotForStorage !== 'function') return;
    try { recordUndoSnapshot(JSON.stringify(routeSnapshotForStorage())); } catch (e) { /* not fatal */ }
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
    // Already asked and answered upstairs when the caller drew the route itself.
    if (parsed.waypoints && !(await askExerciseRoute())) {
      parsed.waypoints = null;               // the settings still land; the plan is untouched
    }
    if (parsed.waypoints) {
      snapshotRoute();
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

  // --- the met table, fetched ----------------------------------------------------------------
  // The table is the exercise's to hand over, but a pilot planning a real flight has no sheet to
  // copy from -- so the same forecast the wind overlay and the density-altitude panel already
  // use can fill it: Open-Meteo's pressure levels, at the middle of the route, for every
  // thousand feet the flight actually touches.
  //
  // It fills the TABLE rather than feeding the sheet directly, which is the point: what was
  // fetched is then visible, editable, and saved with everything else, and the rows say where
  // they came from. A forecast a pilot cannot see or correct is not planning data.
  // The levels this flight actually touches, not a ladder.
  //
  // Asked why it pulled 2,000 / 3,000 / 4,000 on a route flown at 800: it was a fixed ladder
  // from 2,000 ft up. The sheet knows better than that -- it has a pressure altitude for every
  // row, which is where the TAS for that row is read. So those are the levels fetched: the two
  // thirds point of each climb, the level of each leg, the half-way point of the descent.
  //
  // Rounded to the nearest hundred (a forecast is not finer than that), de-duplicated, and
  // bracketed by a level above and below so the nearest-row lookup always has one either side
  // of whatever it is asked about -- including after the pilot edits an altitude on the map.
  function metLevelsFor(cfg) {
    const c = cfg || config();
    const wanted = new Set();
    let rows = [];
    try { rows = rowsFor(c); } catch (e) { rows = []; }
    for (const row of rows) {
      const pa = Number(row.pressureAltFt);
      if (Number.isFinite(pa) && pa > 0) wanted.add(Math.round(pa / 100) * 100);
    }
    if (!wanted.size) {
      // No route yet: a plain ladder is the only honest guess, and it is what the exercise's
      // own met table looks like.
      for (let ft = 2000; ft <= 7000; ft += 1000) wanted.add(ft);
    } else {
      const list = Array.from(wanted);
      const lo = Math.max(500, Math.min(...list) - 1000);
      const hi = Math.max(...list) + 1000;
      wanted.add(Math.round(lo / 100) * 100);
      wanted.add(Math.round(hi / 100) * 100);
    }
    return Array.from(wanted).sort((a, b) => a - b).slice(0, 14);
  }

  // The shared look-ahead clock, in hours from now. One master slider drives every layer that
  // answers to time; this reads it rather than keeping a clock of its own.
  function lookaheadHoursAhead() {
    const el = document.getElementById('lookahead-time');
    const v = el ? parseInt(el.value, 10) : 0;
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  function routeMidpoint() {
    const wps = (typeof state === 'object' && state && Array.isArray(state.waypoints))
      ? state.waypoints.filter(w => w && Number.isFinite(w.lat) && Number.isFinite(w.lng)) : [];
    if (!wps.length) return null;
    const mid = wps[Math.floor(wps.length / 2)];
    return { lat: mid.lat, lng: mid.lng };
  }
  async function fetchMet(cfg) {
    const c = cfg || config();
    const S2 = window.S || {};
    const levels = metLevelsFor(c);
    const at = routeMidpoint();
    if (!levels.length || !at) return null;
    // One request for every level, the way the route-wind fetch does it: a dozen round trips for
    // one table is a dozen chances to half-fill it.
    const hpa = Array.from(new Set(levels.map(ft => (typeof nearestPressureLevelHpa === 'function')
      ? nearestPressureLevelHpa(ft) : null))).filter(Boolean);
    if (!hpa.length) return null;
    const params = hpa.flatMap(l => ['wind_speed_' + l + 'hPa', 'wind_direction_' + l + 'hPa',
      'temperature_' + l + 'hPa']);
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + at.lat.toFixed(3) + '&longitude=' + at.lng.toFixed(3)
      + '&hourly=' + params.join(',')
      + '&wind_speed_unit=kn&timezone=UTC&forecast_days=2';
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const hours = (j && j.hourly && Array.isArray(j.hourly.time)) ? j.hourly.time : null;
    if (!hours || !hours.length) throw new Error('no data');
    // The hour the FLIGHT is in, which is the one the look-ahead clock is pointing at -- the same
    // master slider the NOTAM list, the wind field, the airfield wind and the density-altitude
    // panel all answer to. Planning is done for a departure that has not happened yet, so a
    // forecast pinned to "now" would be the wrong forecast for most of the flights this sheet
    // is worked out for.
    const ahead = lookaheadHoursAhead();
    const when = new Date(Date.now() + ahead * 3600000);
    const stamp = when.toISOString().slice(0, 13);
    let idx = hours.findIndex(t => String(t).slice(0, 13) === stamp);
    if (idx < 0) idx = 0;
    const read = (name) => {
      const arr = j.hourly[name];
      return (Array.isArray(arr) && Number.isFinite(Number(arr[idx]))) ? Number(arr[idx]) : null;
    };
    const rows = [];
    for (const ft of levels) {
      const level = nearestPressureLevelHpa(ft);
      const dir = read('wind_direction_' + level + 'hPa');
      const kt = read('wind_speed_' + level + 'hPa');
      const tempC = read('temperature_' + level + 'hPa');
      if (dir === null || kt === null || tempC === null) continue;
      rows.push({ alt: ft, dir: Math.round(dir), kt: Math.round(kt), tempC: Math.round(tempC) });
    }
    if (!rows.length) throw new Error('no data');
    c.met = rows.sort((a, b) => a.alt - b.alt);
    const s = stored();
    s.met = c.met;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
    c.metAtZ = stamp.slice(11) + ':00Z';
    if (typeof showToast === 'function') {
      showToast((S2.navTableMetFetched ? S2.navTableMetFetched(rows.length, c.metAtZ)
        : (rows.length + ' levels fetched for ' + c.metAtZ)));
    }
    return c.met;
  }

  // One door for a file, whichever control opened it: the app's Open, or this window's own.
  //
  // An exercise may also BE a route -- the shape this app exports, legs and planned altitudes and
  // all. When it is, the route goes down the ordinary route path so it lands on the map complete;
  // only the sheet's assumptions come here. Reported as "the alt is ---": the window's own
  // importer read the points and dropped the legs, so every kite showed a dash.
  async function openExerciseFile(text) {
    let doc = null;
    try { doc = JSON.parse(String(text)); } catch (e) { doc = null; }
    const asRoute = (doc && typeof doc === 'object' && typeof validateRoute === 'function'
      && !validateRoute(doc)) ? doc : null;
    if (asRoute && typeof applyRouteData === 'function') {
      // Ask BEFORE applying: applyRouteData overwrites waypoints, legs and notes outright, and
      // a question asked afterwards is asking about a plan that is already gone. Declining
      // keeps the map and still takes the sheet -- met table, card, speeds, field elevations.
      if (await askExerciseRoute()) {
        snapshotRoute();
        applyRouteData(asRoute);
      }
    }
    // skipRoute when this path drew the route, and also when it was offered and declined:
    // either way the answer is settled, and importExercise must not ask a second time.
    return importExercise(text, { skipRoute: !!asRoute });
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
  function rowsFor(cfg) {
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
      paFraction: c.paFraction,
      // Where the cumulative clock starts, if a waypoint says somewhere other than the
      // departure field. It lives on the route, not in the sheet's own settings: it is a fact
      // about this flight, and the map's cumulative kites read the same mark.
      timerFromIndex: (typeof routeTimerIndex === 'function') ? routeTimerIndex() : -1,
      // The altitude on each leg's own kite. A route that leaves at 800 ft and steps up to
      // 2,500 climbs twice, and the first top of climb is inside the first leg where the pilot
      // put it -- reported as a TOC that landed in the second leg because the whole route was
      // flattened to its highest level.
      legAltitudes: ((typeof state === 'object' && state && Array.isArray(state.legs))
        ? state.legs : []).map(l => (l && Number(l.inboundAltitude) > 0)
        ? Number(l.inboundAltitude) : null),
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
  // A correction written the way a chart writes it: 4E, 2W, or nothing at all when it is zero.
  // The sign convention is the sheet's -- east SUBTRACTS -- so the caller passes the value that
  // is subtracted.
  function eastWest(v) {
    if (!Number.isFinite(v)) return '';
    const n = Math.round(v);
    if (n === 0) return '0';
    return Math.abs(n) + (n > 0 ? 'E' : 'W');
  }
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
      // Strength then direction, the order the exercise's own sheet prints them in.
      row.wind ? whole(row.wind.speed) : '',
      row.wind ? deg(row.wind.dir) : '',
      deg(row.trackShownDeg),
      row.driftSide ? (Math.round(row.driftShownDeg) + row.driftSide) : '0',
      deg(row.trueHeadingDeg),
      eastWest(cfg.variationDeg),
      deg(row.magneticHeadingDeg),
      // Deviation is written as the sheet writes it -- 2E, not -2. East subtracts, exactly as an
      // east variation does, which is why the two columns read the same way and a pilot can
      // apply them the same way.
      eastWest(-row.deviationDeg),
      deg(row.compassHeadingDeg),
      // A segment with no solution has no ground speed to print, and a dash is not an answer:
      // the cell says which of the two it is, and the row is marked for the note below the sheet.
      row.unflyable
        ? (row.noRate ? (S2.navLogNoRate || 'no rate') : (S2.navLogUnflyable || 'no solution'))
        : one(row.groundSpeedKt),
      one(row.distNm),
      clock(row.timeH),
      // The VALUE, not the typography: cells() is what exportCsv writes, and an em dash and a
      // \u25b6 in a spreadsheet column of times are not times. A clock that has not started has
      // nothing to say, so it says nothing; the table below decorates its own cell.
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
      // Strength then direction, the order cells() emits and the order the exercise's own sheet
      // prints them in. This fallback had them the other way round, so a language pack missing
      // navLogHeaders -- or the first build after a column is added, when the length check
      // fails -- labelled the wind speed "W dir" and the direction "W kt". The header row is
      // the export contract, so anything keyed on those names read the wrong figure.
      : ['LEG', 'From', 'To', 'CAS', 'PA', 'Temp', 'TAS', 'W kt', 'W dir', 'TT', 'Drift', 'TH',
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
    const o = opts || {};
    const wrap = document.createElement('label');
    wrap.className = 'navlog-field';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = Number.isFinite(value) ? String(value) : '';
    if (o.step) input.step = o.step;
    input.addEventListener('input', () => onInput(input.value));
    wrap.append(text, input);
    // Back to what the app knows -- the airfield's own elevation, the tuning gist's variation --
    // shown only when there is something to go back FROM. A control that is always there and
    // does nothing most of the time is a control nobody trusts.
    if (o.onReset) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'navlog-reset';
      reset.textContent = '\u21ba';
      reset.addEventListener('click', o.onReset);
      wrap.appendChild(reset);
      // Always there, dimmed while there is nothing to undo -- the house rule, and the reason
      // for it: a control that appears and disappears moves the row under the pilot's hand, and
      // one they have never seen is one they do not know they have. Pressing it on a field that
      // is already at its default costs nothing.
      wrap.showReset = (on) => {
        reset.classList.toggle('navlog-reset-idle', !on);
        reset.title = on ? (o.resetTitle || '') : (o.atDefaultTitle || o.resetTitle || '');
        reset.setAttribute('aria-label', reset.title);
      };
    }
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
    // Only one chart on screen. The form is swept BY closeOpenChartModals -- that function
    // looks for .navlog-modal by name -- but it never called it, so opening the form left
    // whatever was already up underneath.
    if (typeof closeOpenChartModals === 'function') closeOpenChartModals();
    // Remembered like every other chart window: a refresh, or a language switch (which IS a
    // refresh -- it reloads with ?lang), brings it back. Reported as the form closing itself
    // when every other table on the toolbar survives.
    const modal = createDraggableModal(S2.navTableTitle || 'Flight planning form', 'modal wide navlog-modal',
      () => {
        live = null;
        if (typeof clearOpenChartModal === 'function') clearOpenChartModal('nav-table');
        if (NS.refreshMapClock) setTimeout(NS.refreshMapClock, 0);
      }, { nonBlocking: true });
    if (typeof rememberOpenChartModal === 'function') rememberOpenChartModal('nav-table');
    // The clock dims when nothing answers to it. This form does -- its forecast is fetched for
    // the hour the slider points at -- so it says so, on the way in and on the way out.
    const tellClock = () => { if (NS.refreshMapClock) NS.refreshMapClock(); };
    const body = document.createElement('div');
    body.className = 'navlog-body';
    modal.box.appendChild(body);

    const table = document.createElement('table');
    table.className = 'navlog-table';
    const note = document.createElement('div');
    note.className = 'navlog-note';

    // refresh(), not render(): typing a value is also the moment the way back to the default
    // appears beside it. The inputs are left alone while they have the caret, so this cannot
    // fight the pilot for the field they are in.
    const commit = (path) => { if (path) saveField(cfg, path); refresh(); };
    // A field elevation is the airfield's own until somebody types over it. Clearing the box is
    // how they take that back: the override goes, and the number returns to what the dataset
    // says for whatever the route ends at now. (Asked for the other way round first -- the real
    // figure printed beside the box -- but it is already on the sheet, in the climb and descent
    // rows those two numbers decide.)
    const restore = (path) => {
      clearField(path);
      cfg[path] = config()[path];
      refresh();
    };
    // Emptying the box -- which is also what a `number` input does with anything unparseable --
    // hands it back to the standard fraction, exactly as an emptied elevation does.
    const fractionEdited = (path, value) => {
      if (String(value).trim() === '') { restore(path); return; }
      const parts = path.split('.');
      const next = pct(value, cfg[parts[0]][parts[1]]);
      cfg[parts[0]][parts[1]] = next;
      commit(path);
    };
    const settingEdited = (path, value) => {
      if (String(value).trim() === '') { restore(path); return; }
      cfg[path] = num(value, 0);
      commit(path);
    };

    // The assumptions, in one row of fields: the aeroplane, the day, and the two fields.
    const setup = document.createElement('div');
    setup.className = 'navlog-setup';
    const fields = [];
    const add = (f, read, path) => { fields.push({ f, read, path }); return f; };
    // Twelve boxes in one flow is twelve boxes to read before finding the one you want, and it
    // wrapped wherever the window happened to end -- "Cruise (gal/h)" alone on a second line.
    // They belong in four groups, and a group wraps as a unit: where the aeroplane starts and
    // ends, how fast it flies, where in the climb and descent the air is read, and what it
    // costs to get there.
    const group = (...items) => {
      const g = document.createElement('div');
      g.className = 'navlog-group';
      g.append(...items);
      return g;
    };
    setup.append(
      group(
      // Emptying the box, or pressing the arrow, hands it back -- see settingEdited.
      add(field(S2.navLogDepElev || 'Departure elev (ft)', cfg.depElevFt,
        v => settingEdited('depElevFt', v), {
          resetTitle: S2.navLogUseFieldElev || 'Back to the airfield\u2019s own elevation',
          atDefaultTitle: S2.navLogAtDefault || 'Already the default',
          onReset: () => restore('depElevFt'),
        }), c => c.depElevFt, 'depElevFt'),
      add(field(S2.navLogDestElev || 'Destination elev (ft)', cfg.destElevFt,
        v => settingEdited('destElevFt', v), {
          resetTitle: S2.navLogUseFieldElev || 'Back to the airfield\u2019s own elevation',
          atDefaultTitle: S2.navLogAtDefault || 'Already the default',
          onReset: () => restore('destElevFt'),
        }), c => c.destElevFt, 'destElevFt'),
      add(field(S2.navLogVariation || 'Variation (°E)', cfg.variationDeg,
        v => settingEdited('variationDeg', v), {
          resetTitle: S2.navLogUseTuneVariation || 'Back to the variation the app uses',
          atDefaultTitle: S2.navLogAtDefault || 'Already the default',
          onReset: () => restore('variationDeg'),
        }), c => c.variationDeg, 'variationDeg')),
      group(
        field(S2.navLogCasClimb || 'Climb CAS', cfg.cas.climb, v => { cfg.cas.climb = num(v, 0); commit('cas.climb'); }),
        field(S2.navLogCasCruise || 'Cruise CAS', cfg.cas.cruise, v => { cfg.cas.cruise = num(v, 0); commit('cas.cruise'); }),
        field(S2.navLogCasDescent || 'Descent CAS', cfg.cas.descent, v => { cfg.cas.descent = num(v, 0); commit('cas.descent'); })),
      group(
      // Where in the climb and the descent the met data is read, as a percentage of the height
      // gained or lost: the exercise's 67% and 50%. A percentage is what a pilot can type; the
      // fraction is what the arithmetic uses.
      add(field(S2.navLogClimbPa || 'Climb met at (%)', Math.round(cfg.paFraction.climb * 100),
        v => fractionEdited('paFraction.climb', v), {
          resetTitle: S2.navLogUseDefaultFraction || 'Back to the standard fraction',
          atDefaultTitle: S2.navLogAtDefault || 'Already the default',
          onReset: () => restore('paFraction.climb'),
        }), c => Math.round(c.paFraction.climb * 100), 'paFraction.climb'),
      add(field(S2.navLogDescentPa || 'Descent met at (%)', Math.round(cfg.paFraction.descent * 100),
        v => fractionEdited('paFraction.descent', v), {
          resetTitle: S2.navLogUseDefaultFraction || 'Back to the standard fraction',
          atDefaultTitle: S2.navLogAtDefault || 'Already the default',
          onReset: () => restore('paFraction.descent'),
        }), c => Math.round(c.paFraction.descent * 100), 'paFraction.descent')),
      group(
        field(S2.navLogClimbRate || 'Climb (fpm)', cfg.rates.climbFpm, v => { cfg.rates.climbFpm = num(v, 0); commit('rates.climbFpm'); }),
        field(S2.navLogDescentRate || 'Descent (fpm)', cfg.rates.descentFpm, v => { cfg.rates.descentFpm = num(v, 0); commit('rates.descentFpm'); }),
        field(S2.navLogClimbFuel || 'Climb fuel (gal)', cfg.fuel.climbGal, v => { cfg.fuel.climbGal = num(v, 0); commit('fuel.climbGal'); }, { step: '0.1' }),
        field(S2.navLogCruiseGph || 'Cruise (gal/h)', cfg.fuel.cruiseGph, v => { cfg.fuel.cruiseGph = num(v, 0); commit('fuel.cruiseGph'); }, { step: '0.1' })),
    );

    // The met table. Empty by default -- an exercise hands you one, and inventing rows would
    // put numbers on the sheet nobody chose.
    const met = document.createElement('div');
    met.className = 'navlog-met';
    let syncAddTitle = () => {};
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
          input.addEventListener('input', () => { row[key] = num(input.value, 0); saveTables(cfg); render(); });
          // Sorting WHILE typing would move the row out from under the caret, so it happens on
          // the way out of the field -- which is also when the number is finished.
          if (key === 'alt') {
            input.addEventListener('change', () => {
              cfg.met.sort((a, b) => a.alt - b.alt);
              saveTables(cfg);
              render();
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
        btn.addEventListener('click', () => { cfg.met.splice(i, 1); saveTables(cfg); render(); renderMet(); });
        del.appendChild(btn);
        tr.appendChild(del);
        grid.appendChild(tr);
      });
      met.appendChild(grid);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'navlog-add';
      add.textContent = S2.navLogAddRow || 'Add a level';
      // The level the FLIGHT is missing, not the next rung of a ladder. metLevelsFor already
      // knows the pressure altitudes this sheet reads its air at -- it is the list Fetch
      // forecast asks for -- so the first of those with no row is the one worth adding. Only
      // once the table covers the flight does it fall back to a thousand feet above the top.
      const nextLevel = () => {
        const have = new Set(cfg.met.map(r => Math.round(r.alt)));
        const wanted = metLevelsFor(cfg).find(ft => !have.has(ft));
        if (Number.isFinite(wanted)) return wanted;
        const highest = cfg.met.reduce((top, r) => Math.max(top, r.alt), 0);
        return highest ? highest + 1000 : 2000;
      };
      // Re-read on every refresh, not once when the table was built: the levels this flight
      // reads come from the route, and a waypoint dragged under an open window changed them
      // while the button went on naming the old one. It ADDED the right level either way --
      // nextLevel() is re-evaluated on the press -- so the button was lying, not misbehaving.
      syncAddTitle = () => {
        add.title = S2.navLogAddRowAt ? S2.navLogAddRowAt(nextLevel()) : add.textContent;
        add.setAttribute('aria-label', add.title);
      };
      syncAddTitle();
      add.addEventListener('click', () => {
        const alt = nextLevel();
        // The wind stays calm. It was calm before, and calm is the one honest answer: 000/00
        // reads as a row nobody has filled in, which is what it is. Copying the nearest row's
        // wind up here was tried and is worse -- 270/22 at a level nobody measured is a number
        // wearing the shape of data, and the sheet works drift and ground speed from it.
        //
        // The temperature is different, and is why this row changed at all: ISA is not a guess
        // but the defined standard for an atmosphere nobody has measured, and it is the lapse
        // rate this sheet is already worked to. A flat 15 at every level is neither -- at 7,000
        // ft it is a wrong number wearing the shape of a default, and every true airspeed on
        // the sheet comes out of that column.
        cfg.met.push({
          alt,
          dir: 0,
          kt: 0,
          tempC: typeof isaTempAtPaC === 'function' ? Math.round(isaTempAtPaC(alt)) : 15,
        });
        cfg.met.sort((a, b) => a.alt - b.alt);
        saveTables(cfg);
        render();
        renderMet();
        // Adding a level is asking to type one, so the caret lands in the row just added -- and
        // on its altitude, the one figure the app cannot guess better than the pilot can.
        const idx = cfg.met.findIndex(r => Math.round(r.alt) === Math.round(alt));
        const tr = met.querySelectorAll('.navlog-grid tr')[idx + 1];
        const box = tr && tr.querySelector('input');
        if (box) { box.focus(); box.select(); }
      });
      // The two buttons share a row, with room between them: side by side and touching, they
      // read as one control with a seam down it.
      const metActions = document.createElement('div');
      metActions.className = 'navlog-met-actions';
      met.appendChild(metActions);
      metActions.appendChild(add);
      // The forecast, into the table rather than past it: what it fetched is then visible,
      // editable and saved, and the sheet reads it like any typed level.
      const fetchBtn = document.createElement('button');
      fetchBtn.type = 'button';
      fetchBtn.className = 'navlog-fetch';
      fetchBtn.textContent = S2.navTableFetchMet || 'Fetch forecast';
      fetchBtn.title = S2.navTableFetchMetTitle
        || 'Wind and temperature for every level this flight touches, at the middle of the route';
      fetchBtn.addEventListener('click', async () => {
        if (fetchBtn.disabled) return;
        const was = fetchBtn.textContent;
        fetchBtn.disabled = true;
        fetchBtn.textContent = S2.navTableFetching || 'Fetching…';
        try {
          await fetchMet(cfg);
          renderMet();
          refresh();
        } catch (e) {
          // A forecast that did not arrive leaves the table exactly as it was: half a met table
          // is worse than none, because the sheet would quietly compute from it.
          if (typeof showToast === 'function') {
            showToast(S2.navTableFetchMetErr || 'Could not fetch the forecast.', { warn: true });
          }
        } finally {
          fetchBtn.disabled = false;
          fetchBtn.textContent = was;
        }
      });
      metActions.appendChild(fetchBtn);
    }

    // The compass card: the headings are fixed at the 30° marks a card is swung on, and only
    // the "steer" column is typed.
    const card = document.createElement('div');
    card.className = 'navlog-card';
    // A card with no deviation on it: steer what you were told to fly. That is the state the
    // window starts in, and the one this arrow goes back to. It clears the WHOLE card; each
    // row has its own arrow beside its box for clearing one heading. (This comment used to
    // argue against those per-row arrows, on the grounds that twelve of them would be noise on
    // the densest table in the window. That was my call and it was wrong: every other box in
    // this window has its own way back, and one arrow for the whole table is a way back to
    // nothing in particular.)
    const cardIsClear = () => cfg.deviation.every(e => e && e.ch === e.mh);
    let showCardReset = () => {};
    const clearCard = () => {
      for (const e of cfg.deviation) e.ch = e.mh;
      saveTables(cfg);
      renderCard();          // rebuilt, so every row's own arrow is re-lit with it
      render();
    };
    function renderCard() {
      card.replaceChildren();
      const head = document.createElement('div');
      head.className = 'navlog-sub-title';
      head.textContent = S2.navLogCard || 'Compass card';
      // Always there, dimmed while there is nothing to undo -- the house rule every other box
      // in this window follows.
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'navlog-reset';
      reset.textContent = '\u21ba';
      reset.addEventListener('click', clearCard);
      showCardReset = () => {
        const on = !cardIsClear();
        reset.classList.toggle('navlog-reset-idle', !on);
        reset.title = on
          ? (S2.navLogCardReset || 'Clear the card: steer what you are told to fly')
          : (S2.navLogAtDefault || 'Already the default');
        reset.setAttribute('aria-label', reset.title);
      };
      head.appendChild(reset);
      card.appendChild(head);
      // Two pairs of columns, the way a card is printed and the way the exercise hands it over:
      // twelve marks down one column is a table taller than the sheet it belongs to.
      const grid = document.createElement('table');
      grid.className = 'navlog-grid navlog-card-grid';
      const half = Math.ceil(cfg.deviation.length / 2);
      const hr = document.createElement('tr');
      for (let col = 0; col < 2; col++) {
        for (const h of [S2.navLogCardFor || 'For (M)', S2.navLogCardSteer || 'Steer (C)']) {
          const th = document.createElement('th');
          th.textContent = h;
          hr.appendChild(th);
        }
      }
      grid.appendChild(hr);
      const cell = (entry) => {
        const mh = document.createElement('td');
        const ch = document.createElement('td');
        if (!entry) return [mh, ch];
        mh.textContent = deg(entry.mh);
        const input = document.createElement('input');
        input.type = 'number';
        // No max: a max makes the spinner STOP at 359, and a compass does not stop -- one step
        // up from 359 is 000. The circle is enforced by wrapping what is typed or stepped, not
        // by walling off the end of it.
        input.step = '1';
        // Three digits, the way the magnetic column beside it is printed and the way a heading
        // is spoken: a card reading 000 / 030 against boxes reading 0 / 30 is the same number
        // written two ways, on the one table whose job is to be compared across.
        input.value = deg(entry.ch);
        // Emptying the box is how a row's deviation is taken back, the same as every other box
        // in this window: the steer heading returns to the magnetic one beside it.
        input.addEventListener('input', (e) => {
          entry.ch = deg360(input.value, entry.mh);
          saveTables(cfg);
          render();
          lightBack();
          showCardReset();
          // A step -- the spinner, or an arrow key -- carries no inputType, and it is a finished
          // answer: show it wrapped at once, which is what makes 359 step round to 000. A typed
          // digit is a half-finished answer, and rewriting the box under the caret would stop
          // anyone typing 120 (1 ... 12 ... 120) from ever reaching the second digit.
          if (!e.inputType) {
            const shown = deg(entry.ch);
            if (input.value !== shown) input.value = shown;
          }
        });
        // What is stored is on the circle; what is typed is whatever was typed. Putting the
        // wrapped value back on blur rather than mid-keystroke leaves the caret alone.
        input.addEventListener('change', () => {
          const shown = deg(entry.ch);
          if (input.value !== shown) input.value = shown;
        });
        // Its own way back, on every row, the way every other box in this window has one --
        // always there, dimmed while that row carries no deviation. The arrow in the title
        // clears the whole card; this one clears the heading it sits on.
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'navlog-reset';
        back.textContent = '\u21ba';
        const lightBack = () => {
          const on = entry.ch !== entry.mh;
          back.classList.toggle('navlog-reset-idle', !on);
          back.title = on
            ? (S2.navLogCardRowReset || 'No deviation on this heading')
            : (S2.navLogAtDefault || 'Already the default');
          back.setAttribute('aria-label', back.title);
        };
        back.addEventListener('click', () => {
          entry.ch = entry.mh;
          input.value = deg(entry.ch);
          saveTables(cfg);
          render();
          lightBack();
          showCardReset();
        });
        lightBack();
        ch.append(input, back);
        return [mh, ch];
      };
      for (let i = 0; i < half; i++) {
        const tr = document.createElement('tr');
        tr.append(...cell(cfg.deviation[i]), ...cell(cfg.deviation[i + half]));
        grid.appendChild(tr);
      }
      card.appendChild(grid);
      showCardReset();
    }

    function render() {
      const list = rowsFor(cfg);
      table.replaceChildren();
      const hr = document.createElement('tr');
      // A column called "FF" or "TT" is a column somebody has to be told about once. The full
      // name rides along as the tooltip rather than widening a sheet that is already 23 wide.
      const titles = Array.isArray(S2.navLogHeaderTitles) && S2.navLogHeaderTitles.length === 23
        ? S2.navLogHeaderTitles : null;
      headers().forEach((h, i) => {
        const th = document.createElement('th');
        th.textContent = h;
        if (titles && titles[i] && titles[i] !== h) th.title = titles[i];
        hr.appendChild(th);
      });
      table.appendChild(hr);
      list.forEach((row, i) => {
        const tr = document.createElement('tr');
        tr.className = 'navlog-row navlog-' + row.kind;
        cells(row, i, cfg).forEach((text, col) => {
          const td = document.createElement('td');
          // The cumulative-time cell, on screen only: an empty cell reads as missing data, and
          // this is not missing -- the clock has not started. The row it starts on says so.
          // (COL_CUM_TIME is the 20th column; see headers().)
          if (col === COL_CUM_TIME) {
            if (row.cumTimeH === null) text = '\u2014';
            else if (row.timerStartsHere) text = '\u25b6 ' + text;
          }
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
      // What the sheet could not do, said under it. A row that is simply missing, or a ground
      // speed cell reading "no solution", is not an explanation.
      const trouble = [];
      if (list.some(r => r.noRate)) trouble.push(S2.navLogNoteNoRate
        || 'No rate of climb: the first row cannot be worked out.');
      if (list.some(r => r.unflyable && !r.noRate)) trouble.push(S2.navLogNoteUnflyable
        || 'A crosswind on this route is stronger than the airspeed flown against it.');
      if (list.some(r => r.descentClipped)) trouble.push(S2.navLogNoteClipped
        || 'The descent does not fit in the route: the aeroplane arrives above the field.');
      note.textContent = list.length ? trouble.join(' ')
        : (S2.navLogNoRoute || 'Draw a route with at least two points, and set a cruise altitude above both fields.');
      note.classList.toggle('navlog-note-warn', list.length > 0 && trouble.length > 0);
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
      // The cruise level has no field: it is read off the legs every time, so a level changed on
      // the map is a sheet recomputed at the new one.
      for (const { f, read, path } of fields) {
        f.sync(read(cfg));
        if (f.showReset) f.showReset(!!path && storedHas(path));
      }
      // Not renderMet(): rebuilding the met table would take the caret out of whichever box is
      // being typed in. Only the one thing in it that reads the route.
      syncAddTitle();
      render();
    }
    function sourceText(source) {
      if (source === 'table') return S2.navLogFromTable || 'from the met table';
      if (source === 'app') return S2.navLogFromApp || 'from the route wind';
      return S2.navLogFromIsa || 'standard atmosphere — nothing typed, nothing fetched';
    }

    const actions = document.createElement('div');
    actions.className = 'navlog-actions';
    // No Import here. A file goes in through the app's own Open, in Import/Export -- one door,
    // and one place to look for it. This window only offers the way OUT, because the sheet it
    // saves is a nav-table document that nothing else composes.
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'navlog-export';
    exportBtn.textContent = S2.navTableExport || 'Save as a file';
    exportBtn.addEventListener('click', () => exportExercise(cfg));
    const csv = document.createElement('button');
    csv.type = 'button';
    csv.textContent = S2.navLogCsv || 'CSV';
    csv.addEventListener('click', () => exportCsv(cfg));
    const print = document.createElement('button');
    print.type = 'button';
    print.textContent = S2.navLogPrint || 'Print';
    print.addEventListener('click', () => window.print());
    actions.append(exportBtn, csv, print);

    renderMet();
    renderCard();
    refresh();
    live = refresh;
    const editors = document.createElement('div');
    editors.className = 'navlog-editors';
    editors.append(met, card);
    body.append(setup, editors, note, table, actions);
    modal.show();
    // Dragged by its title bar and remembered where it was put, like the flight plan. The
    // factory's name is about the SHAPE it builds; the dragging itself is wired here, which is
    // why the window would not move.
    if (typeof makeModalDraggable === 'function') {
      const title = modal.box.querySelector('.modal-title');
      if (title) makeModalDraggable(modal.box, title, 'navaid.navlogPos');
    }
    tellClock();
    return modal;
  }

  // The same rows, as a file. The header row is the export contract: reworded titles belong in
  // the display, not here, or anything downstream keyed on a column loses it.
  function exportCsv(cfg) {
    const c = cfg || config();
    const list = rowsFor(c);
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

  // ...and the other half of that: if the page came back with the form open, open it, whichever
  // of the two files won the race. show() is idempotent enough -- one window at a time -- and a
  // key for a window nobody restored would otherwise sit in the session forever.
  function restoreIfWasOpen() {
    if (typeof readOpenChartModal !== 'function') return;
    if (readOpenChartModal() !== 'nav-table') return;
    if (document.querySelector('.navlog-modal')) return;
    show();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreIfWasOpen);
  } else {
    setTimeout(restoreIfWasOpen, 0);
  }

  NS.navLog = { show, config, save, rows: rowsFor, exportCsv, headers, cells, defaults,
    parseExercise, importExercise, openExerciseFile, exportExercise, routeChanged,
    fetchMet, metLevelsFor, lookaheadHoursAhead };
}());
