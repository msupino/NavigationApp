// Published operating hours, and whether a field is within them at a given moment.
//
// The hours are the CAA AIP's own (docs/data/airfield-hours.json, read by hand from each
// field's text pages). Most of them are plain clock times, but the ones a pilot is most
// likely to trip over are not: Herzliya closes "10 minutes before the end of evening civil
// twilight or 19:30, whichever is earlier", Rosh Pina keeps different Saturday hours in summer
// time, and Haifa, Herzliya and Rosh Pina close early on the eve of a holiday and not at all
// on Yom Kippur. So the evaluation carries its own sun (civil twilight, sunrise, sunset) and
// its own holiday calendar, read off the browser's Hebrew calendar rather than a table that
// would run out.
//
// It answers in three states, not two. "Within" and "outside" are stated only when the rules
// decide it; anything the AIP leaves to judgement -- the twilight either side of a "daytime
// only" field, a day like Yom HaAtzmaut that the AIP's "holiday" may or may not mean, the
// evening after Yom Kippur -- comes back null and the panel shows no verdict. The same stance
// as airspaceActiveNow(): a confident answer that is wrong is the one that matters.
(function () {
  'use strict';
  const NS = (window.NavAid = window.NavAid || {});
  const TZ = 'Asia/Jerusalem';
  const DAY_TAGS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  let data = null;
  let loading = null;
  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    const url = (window.S && S.airfieldHoursUrl) || 'data/airfield-hours.json';
    loading = fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { data = (j && j.fields) ? j : { fields: {} }; return data; })
      .catch(() => { loading = null; return { fields: {} }; });
    return loading;
  }
  function entryFor(icao) {
    const k = String(icao || '').toUpperCase();
    return (data && data.fields && Object.prototype.hasOwnProperty.call(data.fields, k))
      ? data.fields[k] : null;
  }

  // --- Israel local time -------------------------------------------------------------------
  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short',
  });
  const offFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' });
  function local(date) {
    const p = {};
    for (const x of partsFmt.formatToParts(date)) p[x.type] = x.value;
    const off = /GMT([+-]\d+)/.exec(offFmt.format(date));
    return {
      y: +p.year, m: +p.month, d: +p.day,
      mins: (+p.hour % 24) * 60 + (+p.minute),
      dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
      offsetH: off ? +off[1] : 2,
    };
  }

  // --- Holidays ----------------------------------------------------------------------------
  // The Hebrew date of a civil day, from the browser's own calendar. Noon UTC is the same civil
  // day in Israel all year.
  const hebFmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: TZ, day: 'numeric', month: 'long' });
  function hebrewDate(y, m, d) {
    const p = {};
    for (const x of hebFmt.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)))) p[x.type] = x.value;
    return { month: p.month, day: +p.day };
  }
  // Yom tov in Israel: the days the AIP's "holiday" (חג) unambiguously means. The eve is the
  // civil day before. Rosh Hashana's first day is itself the eve of its second, but it is a
  // holiday, and a holiday rule is listed before an eve rule in every schedule.
  const HOLIDAYS = [
    ['Tishri', 1, 'rh'], ['Tishri', 2, 'rh'], ['Tishri', 10, 'yk'], ['Tishri', 15, 'sukkot'],
    ['Tishri', 22, 'shemini'], ['Nisan', 15, 'pesach'], ['Nisan', 21, 'pesach7'], ['Sivan', 6, 'shavuot'],
  ];
  const EVES = [
    ['Elul', 29, 'rhEve'], ['Tishri', 9, 'ykEve'], ['Tishri', 14, 'sukkotEve'], ['Tishri', 21, 'sheminiEve'],
    ['Nisan', 14, 'pesachEve'], ['Nisan', 20, 'pesach7Eve'], ['Sivan', 5, 'shavuotEve'],
  ];
  // Days the AIP may or may not count as a holiday: Yom HaAtzmaut and its eve (which move
  // between 3 and 6 Iyar), Purim. Not guessed either way.
  const UNSURE = [['Iyar', 2], ['Iyar', 3], ['Iyar', 4], ['Iyar', 5], ['Iyar', 6], ['Adar', 14], ['Adar II', 14]];
  function dayTags(y, m, d, dow) {
    const tags = new Set(['any', DAY_TAGS[dow]]);
    const h = hebrewDate(y, m, d);
    for (const [mo, dd, tag] of HOLIDAYS) if (h.month === mo && h.day === dd) { tags.add('holiday'); tags.add(tag); }
    for (const [mo, dd, tag] of EVES) if (h.month === mo && h.day === dd) { tags.add('holidayEve'); tags.add(tag); }
    const unsure = UNSURE.some(([mo, dd]) => h.month === mo && h.day === dd);
    return { tags, unsure, hebrew: h };
  }

  // --- Sun ---------------------------------------------------------------------------------
  // NOAA's sunrise equation, good to a minute or so: the local minute of the day at which the
  // sun's centre crosses `alt` degrees, morning (rising) or evening. -0.833 is sunrise/sunset
  // (refraction and the upper limb), -6 the edge of civil twilight.
  function sunMinutes(y, m, d, lat, lng, alt, evening, offsetH) {
    const rad = Math.PI / 180;
    const jd = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5;
    const n = jd - 2451545.0 + 0.0008;
    const Jstar = n - lng / 360;
    const M = (357.5291 + 0.98560028 * Jstar) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const lam = (M + C + 180 + 102.9372) % 360;
    const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
    const decl = Math.asin(Math.sin(lam * rad) * Math.sin(23.4397 * rad));
    const cosH = (Math.sin(alt * rad) - Math.sin(lat * rad) * Math.sin(decl)) /
      (Math.cos(lat * rad) * Math.cos(decl));
    if (cosH < -1 || cosH > 1) return null;
    const H = Math.acos(cosH) / rad;
    const jEvent = Jtransit + (evening ? H : -H) / 360;
    const utcMins = ((jEvent - 2440587.5) * 86400000 - Date.UTC(y, m - 1, d)) / 60000;
    return Math.round(utcMins + offsetH * 60);
  }

  // --- Evaluation --------------------------------------------------------------------------
  function hhmm(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  // A time in a rule: "07:30", a sun event with an optional offset ("dusk-10"), the earlier of
  // several ({min: [...]}), or a summer/winter pair. Null when it cannot be resolved.
  function resolveTime(t, ctx) {
    if (t && typeof t === 'object') {
      if (Array.isArray(t.min)) {
        const vs = t.min.map(x => resolveTime(x, ctx));
        return vs.some(v => v === null) ? null : Math.min(...vs);
      }
      if (t.summer || t.winter) return resolveTime(ctx.summer ? t.summer : t.winter, ctx);
      return null;
    }
    const s = String(t);
    const clock = hhmm(s);
    if (clock !== null) return clock;
    const m = /^(sunrise|sunset|dawn|dusk)([+-]\d+)?$/.exec(s);
    if (!m) return null;
    const base = ctx.sun[m[1]];
    return base === null || base === undefined ? null : base + (m[2] ? +m[2] : 0);
  }
  // Does this time move with the sun? Those edges are computed to a minute or two, so the
  // minutes either side of one get no verdict.
  function sunBased(t) {
    if (t && typeof t === 'object') return Array.isArray(t.min) ? t.min.some(sunBased) : false;
    return /^(sunrise|sunset|dawn|dusk)/.test(String(t));
  }
  const SUN_MARGIN = 3;
  function fmtMins(v) {
    const h = Math.floor(v / 60), mm = v % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  // Where the sun is read for this field: its own position, or the field the AIP names
  // (Herzliya's twilight is Ben Gurion's table).
  function sunPlace(entry, af, lookup) {
    if (entry.twilightAt && typeof lookup === 'function') {
      const ref = lookup(entry.twilightAt);
      if (ref && Number.isFinite(ref.lat)) return ref;
    }
    return af;
  }

  // { state: 'open' | 'closed' | null, until, opens, approx, reason }. `until` is when the
  // current window ends (open), `opens` when the next one today starts (closed) -- as 'HH:MM'
  // local; `approx` when that time comes from the sun.
  function status(icao, af, when, lookup) {
    const entry = entryFor(icao);
    if (!entry || !Array.isArray(entry.schedule)) return { state: null, reason: 'none' };
    const now = when || new Date();
    const L = local(now);
    const { tags, unsure } = dayTags(L.y, L.m, L.d, L.dow);
    const rule = entry.schedule.find(r => (r.days || []).some(t => tags.has(t)));
    if (!rule) return { state: null, reason: 'norule' };
    if (rule.h24) return { state: 'open', reason: 'h24' };
    const usesHolidays = entry.schedule.some(r => (r.days || []).some(t => t !== 'any' && !DAY_TAGS.includes(t)));
    if (unsure && usesHolidays) return { state: null, reason: 'calendar' };
    const place = sunPlace(entry, af, lookup);
    const sun = {};
    if (place && Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
      sun.sunrise = sunMinutes(L.y, L.m, L.d, place.lat, place.lng, -0.833, false, L.offsetH);
      sun.sunset = sunMinutes(L.y, L.m, L.d, place.lat, place.lng, -0.833, true, L.offsetH);
      sun.dawn = sunMinutes(L.y, L.m, L.d, place.lat, place.lng, -6, false, L.offsetH);
      sun.dusk = sunMinutes(L.y, L.m, L.d, place.lat, place.lng, -6, true, L.offsetH);
    }
    const ctx = { sun, summer: L.offsetH === 3 };
    const cur = L.mins;
    if (rule.closed) {
      if (rule.reopensAfter) {
        const after = resolveTime(rule.reopensAfter, ctx);
        if (after === null || cur >= after) return { state: null, reason: 'reopens' };
      }
      return { state: 'closed', reason: 'closedDay' };
    }
    // Windows for today, with any closures cut out of them.
    const spans = [];
    let fuzzy = false;
    for (const w of rule.windows || []) {
      if (w === 'day') {
        if (sun.sunrise === null || sun.sunset === null || sun.sunrise === undefined) return { state: null, reason: 'sun' };
        spans.push([sun.sunrise, sun.sunset, true, true]);
        if ((cur >= sun.dawn && cur < sun.sunrise) || (cur >= sun.sunset && cur < sun.dusk)) fuzzy = true;
        continue;
      }
      const a = resolveTime(w[0], ctx), b = resolveTime(w[1], ctx);
      if (a === null || b === null) return { state: null, reason: 'sun' };
      if (b > a) spans.push([a, b, sunBased(w[0]), sunBased(w[1])]);
    }
    for (const c of entry.closures || []) {
      if (!(c.days || []).some(t => tags.has(t))) continue;
      const a = resolveTime(c.window[0], ctx), b = resolveTime(c.window[1], ctx);
      if (a === null || b === null) continue;
      for (let i = spans.length - 1; i >= 0; i--) {
        const [s, e, sf, ef] = spans[i];
        if (b <= s || a >= e) continue;
        const keep = [];
        if (a > s) keep.push([s, a, sf, false]);
        if (b < e) keep.push([b, e, false, ef]);
        spans.splice(i, 1, ...keep);
      }
    }
    spans.sort((p, q) => p[0] - q[0]);
    if (spans.some(([s, e, sf, ef]) => (sf && Math.abs(cur - s) < SUN_MARGIN) || (ef && Math.abs(cur - e) < SUN_MARGIN))) {
      return { state: null, reason: 'edge' };
    }
    const inside = spans.find(([s, e]) => cur >= s && cur < e);
    if (inside) return { state: 'open', until: fmtMins(inside[1]), approx: !!inside[3], reason: 'window' };
    if (fuzzy) return { state: null, reason: 'twilight' };
    const next = spans.find(([s]) => s > cur);
    return { state: 'closed', opens: next ? fmtMins(next[0]) : null, approx: !!(next && next[2]), reason: 'window' };
  }

  NS.airfieldHours = { load, entryFor, status, _sunMinutes: sunMinutes, _dayTags: dayTags,
    _setData: j => { data = j; } };
})();
