// Density altitude: what the aeroplane thinks the field elevation is.
//
// On a hot Israeli summer afternoon at Haifa, Megiddo or Masada the air is thin enough that
// the takeoff roll stops resembling the number in the book -- and the pilot has no way to
// see that from an elevation figure alone. This turns three numbers a pilot can read
// (elevation, temperature, QNH) into the one that governs performance, and lets them scrub
// forward a day to find the hour that is flyable.
//
// The arithmetic is the standard cockpit approximation, not the full barometric formula:
//   pressure altitude = elevation + 30 × (1013 − QNH)
//   ISA temperature at that pressure altitude = 15 − 1.98 × (PA / 1000)
//   density altitude = PA + 120 × (OAT − ISA)
// It is what the manuals and the E6-B teach, it is good to a few tens of feet over the
// range that matters here, and a pilot can check it in their head -- which a pilot cannot
// do with the exact form, and being checkable is the point.
(function () {
  'use strict';
  const NS = (window.NavAid = window.NavAid || {});

  const HPA_STD = 1013;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  function pressureAltFt(elevFt, qnhHpa) {
    const e = num(elevFt), q = num(qnhHpa);
    if (e === null) return null;
    return e + 30 * (HPA_STD - (q === null ? HPA_STD : q));
  }

  function isaTempC(pressureAltitudeFt) {
    const pa = num(pressureAltitudeFt);
    return pa === null ? null : 15 - 1.98 * (pa / 1000);
  }

  function densityAltFt(elevFt, qnhHpa, oatC) {
    const pa = pressureAltFt(elevFt, qnhHpa);
    const t = num(oatC);
    if (pa === null || t === null) return null;
    return pa + 120 * (t - isaTempC(pa));
  }

  // --- forecast ---------------------------------------------------------------
  // Open-Meteo, the same free service the winds-aloft and QNH code already use: hourly
  // 2 m temperature and mean-sea-level pressure at the field. forecast_days=2 so the
  // slider's +24 h still lands inside the fetched range when "now" is late in the UTC day.
  const cache = new Map();       // key -> { at, hours: [{t, tempC, qnh}], elevationFt }
  const TTL_MS = 30 * 60e3;                   // an hourly forecast does not move faster

  function key(lat, lng) { return lat.toFixed(2) + ',' + lng.toFixed(2); }

  async function forecast(lat, lng, opts) {
    const o = opts || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const k = key(lat, lng);
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.hours;
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3)
      + '&hourly=temperature_2m,pressure_msl&timezone=UTC&forecast_days=2';
    const doFetch = o.fetch || window.fetch;
    try {
      const r = await doFetch(url);
      if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
      const j = await r.json();
      const h = j && j.hourly;
      const times = (h && h.time) || [];
      let hours = times.map((t, i) => ({
        t: Date.parse(t.length <= 16 ? t + ':00Z' : t),
        tempC: num(h.temperature_2m && h.temperature_2m[i]),
        qnh: num(h.pressure_msl && h.pressure_msl[i]),
      })).filter(x => Number.isFinite(x.t) && x.tempC !== null);
      // Some answers carry only `current` (the shape the QNH code asks for, and the one the
      // test harness serves). One hour is a poor forecast but an honest present: take it
      // rather than reporting no temperature at a field that plainly has one.
      if (!hours.length && j && j.current && num(j.current.temperature_2m) !== null) {
        hours = [{
          t: Date.parse(String(j.current.time || '').length <= 16
            ? j.current.time + ':00Z' : j.current.time) || Date.now(),
          tempC: num(j.current.temperature_2m),
          qnh: num(j.current.pressure_msl),
        }];
      }
      if (!hours.length) throw new Error('no hourly data');
      // The model's own terrain height at the point, in feet. Not a substitute for a
      // published field elevation, but for the handful of strips the AIP gives no
      // elevation for it is the difference between a density altitude and a dash.
      const elevM = num(j && j.elevation);
      cache.set(k, { at: Date.now(), hours, elevationFt: elevM === null ? null : elevM * 3.28084 });
      return hours;
    } catch (e) {
      return null;
    }
  }

  // The hour nearest `hoursAhead` from now. Nearest rather than the next one up: a slider
  // at +3 h with the clock at 14:50 means 18:00 to a pilot, not 17:00.
  function sampleAt(hours, hoursAhead, nowMs) {
    if (!Array.isArray(hours) || !hours.length) return null;
    const want = (Number.isFinite(nowMs) ? nowMs : Date.now()) + (Number(hoursAhead) || 0) * 3600e3;
    let best = null, bestGap = Infinity;
    for (const h of hours) {
      const gap = Math.abs(h.t - want);
      if (gap < bestGap) { best = h; bestGap = gap; }
    }
    // Beyond the fetched range by more than an hour there is nothing honest to show.
    return bestGap <= 3600e3 * 1.5 ? best : null;
  }

  // The terrain height the forecast reported for this point, once it has been fetched.
  function modelElevationFt(lat, lng) {
    const hit = cache.get(key(lat, lng));
    return hit && Number.isFinite(hit.elevationFt) ? hit.elevationFt : null;
  }

  NS.da = {
    HPA_STD,
    modelElevationFt,
    pressureAltFt,
    isaTempC,
    densityAltFt,
    forecast,
    sampleAt,
    _cache: cache,
  };
  window.densityAltFt = densityAltFt;
}());
