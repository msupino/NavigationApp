// Airfield surface wind: what the windsock will be doing when you get there.
//
// The wind field layer draws the air the aeroplane flies THROUGH -- a grid at a chosen
// pressure level, several thousand feet up. That is the wrong wind for the only two moments
// that bite: the landing and the takeoff. This layer draws the other one: 10 m surface wind
// at every airfield on the chart, as a standard met barb, scrubbed by the same look-ahead
// slider that already drives NOTAM, wind effect and the wind field. Set it to +3 h and the
// map shows the wind at every field you could divert to at the hour you would arrive.
//
// Source is Open-Meteo, the same free service the per-leg wind, the wind field and the
// density altitude already read. Only five Israeli fields publish a METAR or TAF at all, so
// an official-only layer would leave 22 of 27 airfields blank -- and a blank airfield is
// exactly the one a pilot is thinking about diverting to. Model wind is not an observation
// and does not pretend to be: the METAR stays where it was, in the inspector, and says so.
//
// One batched request covers every airfield (comma-joined coordinates, the shape
// fetchRouteWind already uses), so the whole layer costs a single call per switch-on.
(function () {
  'use strict';
  const NS = (window.NavAid = window.NavAid || {});

  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
    ? null : Number(v));
  const tn = (k, d) => {
    if (typeof tune !== 'function') return d;
    const v = tune(k);
    return v === undefined || v === null ? d : v;
  };
  const norm360 = (d) => ((d % 360) + 360) % 360;

  // --- barb geometry ----------------------------------------------------------
  // The met convention, unchanged since before any of us: a shaft pointing at where the
  // wind is coming FROM, with the feathers at the upwind end. Half tick 5 kt, full tick
  // 10 kt, pennant 50 kt, rounded to the nearest 5. Calm gets a ring rather than a bare
  // shaft, because a shaft with no feathers and a shaft the reader has not looked closely
  // at yet are the same picture.
  const calmMaxKt = () => tn('afWindCalmMaxKt', 2);
  function barbTicks(kt) {
    const v = num(kt);
    if (v === null || v < 0) return null;
    if (v <= calmMaxKt()) return { calm: true, pennants: 0, fulls: 0, halves: 0 };
    let units = Math.round(v / 5);            // one unit = 5 kt = one half tick
    const pennants = Math.floor(units / 10);
    units -= pennants * 10;
    const fulls = Math.floor(units / 2);
    const halves = units - fulls * 2;
    return { calm: false, pennants, fulls, halves };
  }

  // --- runway components ------------------------------------------------------
  // A runway designator is MAGNETIC (08 means 080 magnetic), the model wind is TRUE, and
  // getting that backwards is a 5 degree error in Israel -- small, but it is the sort of
  // small that turns a 9 kt crosswind into a 10 kt one right at the limit written in the
  // aeroplane manual. Convert the wind, not the runway.
  function runwayEnds(pair) {
    return String(pair || '').split('/').map(s => s.trim()).filter(s => /^\d{1,2}[LRC]?$/.test(s));
  }
  function endHeadingDeg(end) {
    const n = parseInt(String(end || '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? norm360(n * 10) : null;
  }
  // Head/cross components for one runway END, given a MAGNETIC wind direction (FROM).
  // Head is positive into wind. Cross carries the side the wind pushes you toward, which is
  // the half a pilot acts on -- "4 kt from the left" is a rudder input, "4 kt" is a number.
  function endComponents(end, windDirMag, windKt) {
    const hdg = endHeadingDeg(end);
    const d = num(windDirMag), s = num(windKt);
    if (hdg === null || d === null || s === null) return null;
    const off = ((d - hdg + 540) % 360) - 180;      // -180..180, + = wind from the right
    const rad = off * Math.PI / 180;
    const cross = s * Math.sin(rad);
    return {
      end: String(end),
      headKt: s * Math.cos(rad),
      crossKt: Math.abs(cross),
      crossSide: Math.abs(cross) < tn('afWindCrossDeadbandKt', 0.5) ? '' : (cross > 0 ? 'R' : 'L'),
    };
  }
  // The end of a runway pair a pilot would use for this wind: the one with the head
  // component. A dead crosswind gives both ends a head component of zero, and there the
  // choice is the field's, not the arithmetic's -- report the first end and let the
  // numbers (head 0) say why it is a toss-up.
  function favouredEnd(pair, windDirMag, windKt) {
    const ends = runwayEnds(pair);
    if (!ends.length) return null;
    let best = null;
    for (const e of ends) {
      const c = endComponents(e, windDirMag, windKt);
      if (c && (!best || c.headKt > best.headKt)) best = c;
    }
    return best;
  }

  // --- forecast store ---------------------------------------------------------
  // { at, times[], sp[i][], di[i][], gs[i][], keys[] } -- one row per airfield, in the order
  // the request listed them. Sampling is local: the slider re-reads this, never refetches.
  let store = null;
  let inflight = null;
  const ttlMs = () => tn('afWindCacheMin', 30) * 60e3;      // an hourly forecast does not move faster

  function fieldKey(af) { return String((af && af.name) || '') + '@' + Number(af.lat).toFixed(3) + ',' + Number(af.lng).toFixed(3); }

  async function fetchWinds(list, opts) {
    const o = opts || {};
    const afs = (list || []).filter(a => a && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng)));
    if (!afs.length) return null;
    const keys = afs.map(fieldKey);
    if (store && Date.now() - store.at < ttlMs() && String(store.keys) === String(keys)) return store;
    if (inflight) return inflight;
    // Two days by default for the same reason the per-leg fetch uses three: the slider
    // reaches +24 h, and a "now" late in the UTC day pushes that over the next day boundary.
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + afs.map(a => Number(a.lat).toFixed(3)).join(',')
      + '&longitude=' + afs.map(a => Number(a.lng).toFixed(3)).join(',')
      + '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m'
      + '&wind_speed_unit=kn&timezone=UTC&forecast_days=' + tn('afWindForecastDays', 2);
    const doFetch = o.fetch || window.fetch.bind(window);
    inflight = (async () => {
      try {
        const r = await doFetch(url);
        if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
        const j = await r.json();
        const locs = Array.isArray(j) ? j : [j];       // multi-location answers come as an array
        const h0 = locs[0] && locs[0].hourly;
        const times = (h0 && h0.time) || [];
        if (!times.length) throw new Error('no hourly data');
        const ms = times.map(t => Date.parse(String(t).length <= 16 ? t + ':00Z' : t));
        const sp = [], di = [], gs = [];
        for (let i = 0; i < afs.length; i++) {
          const h = (locs[i] && locs[i].hourly) || {};
          sp.push((h.wind_speed_10m || []).map(num));
          di.push((h.wind_direction_10m || []).map(num));
          gs.push((h.wind_gusts_10m || []).map(num));
        }
        store = { at: Date.now(), times: ms, sp, di, gs, keys };
        return store;
      } catch (e) {
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  // --- observed wind ----------------------------------------------------------
  // Five Israeli fields publish a METAR. At live time their wind is MEASURED, and a
  // measurement beats a model every time -- so those fields draw their own report rather
  // than the forecast, and draw it as a solid barb while every model barb is dashed. The
  // moment the slider leaves live there is no observation for that hour and everything
  // reverts to the model, dashed, which is the honest picture.
  let obs = null;                             // ICAO -> { dirTrue, kt, gustKt, at }
  async function loadObserved(opts) {
    const o = opts || {};
    const load = o.loadWxFile || (typeof loadWxFile === 'function' ? loadWxFile : null);
    if (!load) { obs = obs || {}; return obs; }
    try {
      const file = await load();
      const out = {};
      for (const icao of Object.keys((file && file.stations) || {})) {
        const m = file.stations[icao] && file.stations[icao].metar;
        if (!m) continue;
        // A variable wind has no direction to draw, and a barb pointing anywhere in
        // particular would be inventing one. Those fields fall back to the model.
        const d = num(m.wdir);
        const kt = num(m.wspd);
        if (d === null || kt === null) continue;
        const at = (typeof wxIssuedAt === 'function') ? wxIssuedAt(m) : null;
        out[icao] = { dirTrue: norm360(Math.round(d)), kt: Math.round(kt), gustKt: num(m.wgst), at };
      }
      obs = out;
    } catch (e) {
      obs = obs || {};
    }
    return obs;
  }
  // An observation is only worth more than the model while it is current. A METAR is issued
  // at least hourly, so one well past that is a gap, not a reading.
  function observedFor(af) {
    const icao = String((af && af.name) || '').toUpperCase();
    const o = obs && obs[icao];
    if (!o) return null;
    const maxAge = tn('afWindObsMaxAgeMin', 0) || tn('wxStaleAfterMin', 75);
    if (o.at !== null && o.at !== undefined && Date.now() - o.at > maxAge * 60e3) return null;
    return o;
  }

  // The hour nearest the requested look-ahead. Nearest, not the next one up: a slider at
  // +3 h with the clock at 14:50 means 18:00 to a pilot, not 17:00. Past the fetched range
  // by more than an hour there is nothing honest to show, so it returns null and the
  // airfield draws no barb at all rather than a stale one.
  function sampleAt(idx, hoursAhead, nowMs) {
    if (!store || !store.times.length) return null;
    const want = (Number.isFinite(nowMs) ? nowMs : Date.now()) + (Number(hoursAhead) || 0) * 3600e3;
    let best = -1, bestGap = Infinity;
    for (let i = 0; i < store.times.length; i++) {
      const gap = Math.abs(store.times[i] - want);
      if (gap < bestGap) { best = i; bestGap = gap; }
    }
    if (best < 0 || bestGap > tn('afWindSampleToleranceMin', 90) * 60e3) return null;
    const s = store.sp[idx] && store.sp[idx][best];
    const d = store.di[idx] && store.di[idx][best];
    if (!Number.isFinite(s) || !Number.isFinite(d)) return null;
    const g = store.gs[idx] && store.gs[idx][best];
    return { t: store.times[best], dirTrue: norm360(Math.round(d)), kt: Math.round(s), gustKt: Number.isFinite(g) ? Math.round(g) : null };
  }
  // What to draw for one airfield at one look-ahead: the field's own report when the slider
  // is at live and it has a current one, the model otherwise. `observed` is what the barb
  // style and the inspector note key off, so neither can drift from the number shown.
  function resolvedFor(af, hoursAhead, nowMs) {
    const hrs = Number(hoursAhead) || 0;
    if (hrs === 0) {
      const o = observedFor(af);
      if (o) return { dirTrue: o.dirTrue, kt: o.kt, gustKt: o.gustKt, t: o.at, observed: true };
    }
    const i = store ? store.keys.indexOf(fieldKey(af)) : -1;
    if (i < 0) return null;
    const m = sampleAt(i, hrs, nowMs);
    return m ? Object.assign({ observed: false }, m) : null;
  }

  // By ICAO, for the inspector -- which knows an airfield, not its index in a fetch.
  function sampleFor(af, hoursAhead, nowMs) {
    if (!store || !af) return null;
    const i = store.keys.indexOf(fieldKey(af));
    return i < 0 ? null : sampleAt(i, hoursAhead, nowMs);
  }

  // How many hours ahead the shared look-ahead slider is pointing.
  function lookaheadHours() {
    const el = document.getElementById('airfield-wind-time');
    return el ? (parseInt(el.value, 10) || 0) : 0;
  }

  // --- rendering --------------------------------------------------------------
  // Drawn on the same overlay canvas as the airfield triangles, through the same proj(),
  // so it rotates with the map bearing and lands in the PNG export like every other symbol.
  function drawBarb(ctx, x, y, dirScreenDeg, kt, color, observed) {
    const ticks = barbTicks(kt);
    if (!ticks) return;
    const shaft = tn('afWindBarbLenPx', 26);
    const tick = tn('afWindBarbTickPx', 9);
    const step = tn('afWindBarbTickGapPx', 4.5);
    ctx.save();
    ctx.translate(x, y);
    // Canvas 0 deg is +x and the shaft has to point at where the wind comes FROM, which on
    // a north-up screen is -y for 0 deg. Hence the -90.
    ctx.rotate((dirScreenDeg - 90) * Math.PI / 180);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = tn('afWindBarbWidthPx', 1.6);
    ctx.lineCap = 'round';
    // Dashed means modelled. A measured wind and a forecast wind are not the same claim,
    // and at a glance on a moving map the line style is the only part of a barb the eye
    // reads without stopping to count feathers.
    if (!observed) ctx.setLineDash([tn('afWindModelDashPx', 3), tn('afWindModelGapPx', 2.5)]);
    if (ticks.calm) {
      ctx.beginPath();
      ctx.arc(0, 0, tn('afWindCalmRadiusPx', 4), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(shaft, 0);
    ctx.stroke();
    // Only the shaft carries the dash. A dashed feather is a feather you cannot count, and
    // counting them is how the speed is read.
    ctx.setLineDash([]);
    // Feathers hang off the upwind end, growing back toward the airfield.
    const pennantW = tn('afWindPennantWidthFactor', 1.6);
    const pennantGap = tn('afWindPennantGapFactor', 0.4);
    let at = shaft;
    for (let i = 0; i < ticks.pennants; i++) {
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at - step * pennantW, -tick);
      ctx.lineTo(at - step * pennantW * 2, 0);
      ctx.closePath();
      ctx.fill();
      at -= step * pennantW * 2 + step * pennantGap;
    }
    for (let i = 0; i < ticks.fulls; i++) {
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at - step * tn('afWindFullTickSlantFactor', 0.9), -tick);
      ctx.stroke();
      at -= step;
    }
    if (ticks.halves) {
      // A lone half tick never sits at the very end of the shaft: there it reads as a full
      // tick that lost half its length to the edge of the drawing. Standard practice moves
      // it one step in.
      if (!ticks.fulls && !ticks.pennants) at -= step;
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at - step * tn('afWindHalfTickSlantFactor', 0.45), -tick * tn('afWindHalfTickLenFactor', 0.5));
      ctx.stroke();
    }
    ctx.restore();
  }

  function windLabel(s) {
    if (!s) return '';
    const str = (typeof S === 'object' && S) || {};
    if (s.kt <= calmMaxKt()) return str.afWindCalmLabel || 'CALM';
    const dir = String(s.dirTrue).padStart(3, '0') + '/';
    const gust = s.gustKt && s.gustKt >= s.kt + tn('afWindGustDeltaKt', 5) ? 'G' + s.gustKt : '';
    return dir + s.kt + gust;
  }

  // Called from draw(), inside the overlay canvas pass.
  function drawAirfieldWind() {
    if (!window.showAirfieldWind) return;
    if (typeof airfields === 'undefined' || !airfields || !airfields.length) return;
    if (typeof octx === 'undefined' || !octx || typeof proj !== 'function') return;
    if (!store) return;
    const hrs = lookaheadHours();
    const showText = typeof map !== 'undefined' && map.getZoom() >= tn('afWindLabelMinZoom', 10);
    const bearing = (typeof map !== 'undefined' && map.getBearing) ? (map.getBearing() || 0) : 0;
    const color = tn('afWindBarbColor', '#0b6fb8');
    const offset = tn('afWindOffsetPx', 12);
    octx.save();
    octx.font = 'bold ' + tn('afWindLabelFontPx', 11) + 'px sans-serif';
    octx.textAlign = 'center';
    octx.textBaseline = 'top';
    for (const af of airfields) {
      const s = resolvedFor(af, hrs);
      if (!s) continue;
      const p = proj(af);
      drawBarb(octx, p.x, p.y - offset, s.dirTrue - bearing, s.kt,
        s.observed ? tn('afWindObsColor', '#0b6fb8') : color, s.observed);
      if (showText) {
        const txt = windLabel(s);
        octx.lineWidth = tn('afWindLabelHaloPx', 3);
        octx.strokeStyle = tn('overlayLabelHaloColor', '#ffffff');
        octx.strokeText(txt, p.x, p.y + offset);
        // A forecast reads a shade lighter than a measurement, so the two are still
        // distinguishable where the barb is small and the number is what gets read.
        const base = s.observed ? tn('afWindObsColor', '#0b6fb8') : color;
        octx.fillStyle = (!s.observed && typeof colorWithAlpha === 'function')
          ? colorWithAlpha(base, tn('afWindModelLabelAlpha', 0.75)) : base;
        octx.fillText(txt, p.x, p.y + offset);
      }
    }
    octx.restore();
  }

  // Switch-on: fetch once, then redraw. Failures are reported by the caller.
  async function enable(opts) {
    const list = (typeof airfields !== 'undefined' && airfields) || [];
    // The observations are a bonus, not a precondition: a wx feed that is down leaves an
    // all-model layer, which is exactly what the layer was for.
    const [got] = await Promise.all([fetchWinds(list, opts), loadObserved(opts)]);
    if (typeof draw === 'function') draw();
    return !!got;
  }
  function clear() { store = null; obs = null; }

  NS.afWind = {
    barbTicks,
    runwayEnds,
    endHeadingDeg,
    endComponents,
    favouredEnd,
    fetchWinds,
    sampleAt,
    sampleFor,
    resolvedFor,
    observedFor,
    loadObserved,
    windLabel,
    lookaheadHours,
    enable,
    clear,
    _store: () => store,
  };
  window.drawAirfieldWind = drawAirfieldWind;
}());
