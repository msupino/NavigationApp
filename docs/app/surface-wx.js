// Surface weather: what the air is doing at the ground, on a grid over the chart.
//
// Asked for: "a dew point layer, and weather at MSL ... now and forecast". The wind field
// draws the air the aeroplane flies through; the airfield wind, the windsock at each field.
// This layer draws the surface itself, one field at a time, chosen under its switch:
//   - dew point spread (T - Td), the default: how close the air is to fog and low cloud;
//   - dew point, and temperature, at 2 m;
//   - sea-level pressure, as isobars every 2 hPa with H / L at the centres;
//   - an estimated cloud base, (T - Td) x 400 ft above the ground -- the rule Route check uses.
// Each grid point gets a dot and its number: the colour is the warning, the number the value,
// so nothing depends on telling red from amber (or either from the chart under them).
//
// Source is Open-Meteo, as for the wind field, the airfield wind and density altitude: one
// batched request (comma-joined points) on switch-on, every hour of the next two days. The
// shared look-ahead slider then re-samples it -- dragging never touches the network -- which
// is the "now and forecast" in one control the pilot already knows.
(function () {
  'use strict';
  const NS = (window.NavAid = window.NavAid || {});

  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
    ? null : Number(v));
  const tn = (k, d) => {
    if (typeof tune !== 'function') return d;
    // tune() answers 0 for a key it does not know: only a registered tunable overrides the
    // default here, so a missing one never zeroes the grid or the time tolerance.
    const defs = window.NavAid && NavAid.tuningDefaults;
    if (!defs || !Object.prototype.hasOwnProperty.call(defs, k)) return d;
    const v = tune(k);
    return v === undefined || v === null ? d : v;
  };
  const str = (k, d) => ((typeof S === 'object' && S && S[k]) || d);

  const FIELDS = ['spread', 'dew', 'temp', 'msl', 'base'];
  const FIELD_KEY = 'navaid.surfaceWxField';
  function field() {
    let f = null;
    try { f = localStorage.getItem(FIELD_KEY); } catch (e) { /* storage blocked */ }
    return FIELDS.includes(f) ? f : 'spread';
  }
  function setField(f) {
    if (!FIELDS.includes(f)) return;
    try { localStorage.setItem(FIELD_KEY, f); } catch (e) { /* storage blocked */ }
  }

  // --- the grid -----------------------------------------------------------------
  // Over Israel and its approaches, the area the Israeli charts cover. A fixed grid, not the
  // view: one request serves every pan and zoom, and the isobars need neighbours to draw.
  function gridPoints() {
    const s = tn('swxGridSouth', 29.4), n = tn('swxGridNorth', 33.4);
    const w = tn('swxGridWest', 34.2), e = tn('swxGridEast', 35.9);
    const step = Math.max(0.1, tn('swxGridStepDeg', 0.25));
    const lats = [], lngs = [];
    for (let la = s; la <= n + 1e-9; la += step) lats.push(+la.toFixed(3));
    for (let lo = w; lo <= e + 1e-9; lo += step) lngs.push(+lo.toFixed(3));
    const pts = [];
    for (let i = 0; i < lats.length; i++) for (let j = 0; j < lngs.length; j++) pts.push({ lat: lats[i], lng: lngs[j], i, j });
    return { lats, lngs, pts };
  }

  let store = null;          // { at, times: [ms], grid, t: [[..]], td: [[..]], p: [[..]] } per point
  let inflight = null;
  const ttlMs = () => tn('swxCacheMin', 60) * 60e3;

  async function fetchGrid(opts) {
    const o = opts || {};
    if (store && Date.now() - store.at < ttlMs()) return store;
    if (inflight) return inflight;
    const grid = gridPoints();
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + grid.pts.map(p => p.lat).join(',')
      + '&longitude=' + grid.pts.map(p => p.lng).join(',')
      + '&hourly=temperature_2m,dew_point_2m,pressure_msl'
      + '&timezone=UTC&forecast_days=' + tn('swxForecastDays', 2);
    const doFetch = o.fetch || window.fetch.bind(window);
    inflight = (async () => {
      try {
        const r = await doFetch(url);
        if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
        const j = await r.json();
        const locs = Array.isArray(j) ? j : [j];
        const h0 = locs[0] && locs[0].hourly;
        const times = (h0 && h0.time) || [];
        if (!times.length || locs.length < grid.pts.length) throw new Error('no grid data');
        const ms = times.map(t => Date.parse(String(t).length <= 16 ? t + ':00Z' : t));
        const t = [], td = [], p = [];
        for (let k = 0; k < grid.pts.length; k++) {
          const h = (locs[k] && locs[k].hourly) || {};
          t.push((h.temperature_2m || []).map(num));
          td.push((h.dew_point_2m || []).map(num));
          p.push((h.pressure_msl || []).map(num));
        }
        store = { at: Date.now(), times: ms, grid, t, td, p };
        return store;
      } catch (e) {
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function hourIndex(hoursAhead, nowMs) {
    if (!store || !store.times.length) return -1;
    const want = (Number.isFinite(nowMs) ? nowMs : Date.now()) + (Number(hoursAhead) || 0) * 3600e3;
    let best = -1, gap = Infinity;
    for (let i = 0; i < store.times.length; i++) {
      const g = Math.abs(store.times[i] - want);
      if (g < gap) { best = i; gap = g; }
    }
    return gap > tn('swxSampleToleranceMin', 90) * 60e3 ? -1 : best;
  }
  // The value of one field at one grid point and hour (null when the model has none).
  function valueAt(k, hi, f) {
    if (!store || hi < 0) return null;
    const t = store.t[k] && store.t[k][hi], td = store.td[k] && store.td[k][hi];
    const p = store.p[k] && store.p[k][hi];
    switch (f) {
      case 'temp': return Number.isFinite(t) ? t : null;
      case 'dew': return Number.isFinite(td) ? td : null;
      case 'msl': return Number.isFinite(p) ? p : null;
      case 'spread': return Number.isFinite(t) && Number.isFinite(td) ? Math.max(0, t - td) : null;
      case 'base': return Number.isFinite(t) && Number.isFinite(td) ? Math.max(0, t - td) * tn('swxBaseFtPerC', 400) : null;
      default: return null;
    }
  }
  // Everything at the grid point nearest a place: for the inspector's "Surface" row.
  function sampleNear(lat, lng, hoursAhead, nowMs) {
    if (!store) return null;
    const hi = hourIndex(hoursAhead, nowMs);
    if (hi < 0) return null;
    const g = store.grid;
    const step = Math.max(0.1, tn('swxGridStepDeg', 0.25));
    if (lat < g.lats[0] - step || lat > g.lats[g.lats.length - 1] + step
      || lng < g.lngs[0] - step || lng > g.lngs[g.lngs.length - 1] + step) return null;
    let best = -1, bd = Infinity;
    for (let k = 0; k < g.pts.length; k++) {
      const d = (g.pts[k].lat - lat) ** 2 + (g.pts[k].lng - lng) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    const t = valueAt(best, hi, 'temp'), td = valueAt(best, hi, 'dew'), p = valueAt(best, hi, 'msl');
    if (t === null && td === null && p === null) return null;
    return { t, td, spread: valueAt(best, hi, 'spread'), p, base: valueAt(best, hi, 'base'), at: store.times[hi] };
  }

  // --- how each field reads ---------------------------------------------------------
  // Warning colours only where there is something to warn about; everything else one quiet
  // ink, so the chart under the layer still reads.
  const WARN = () => tn('swxWarnColor', '#c62828');
  const CAUTION = () => tn('swxCautionColor', '#e07b00');
  const QUIET = () => tn('swxQuietColor', '#1f4e79');
  function colorFor(f, v) {
    if (v === null) return null;
    if (f === 'spread') return v <= tn('swxSpreadWarnC', 2) ? WARN() : v <= tn('swxSpreadCautionC', 4) ? CAUTION() : QUIET();
    if (f === 'base') return v <= tn('swxBaseWarnFt', 1000) ? WARN() : v <= tn('swxBaseCautionFt', 2000) ? CAUTION() : QUIET();
    if (f === 'temp') return tn('swxTempColor', '#9a3d00');
    return QUIET();
  }
  function label(f, v) {
    if (v === null) return '';
    if (f === 'base') return v >= 10000 ? '10k+' : (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v / 100) * 100));
    if (f === 'msl') return String(Math.round(v));
    return String(Math.round(v)) + '°';
  }
  function unitText(f) {
    if (f === 'msl') return 'hPa';
    if (f === 'base') return str('swxBaseUnit', 'ft above ground');
    return '°C';
  }

  function lookaheadHours() {
    const el = document.getElementById('surface-wx-time');
    return el ? (parseInt(el.value, 10) || 0) : 0;
  }

  // --- drawing ------------------------------------------------------------------------
  function haloText(ctx, txt, x, y, color) {
    ctx.lineWidth = tn('swxLabelHaloPx', 3);
    ctx.strokeStyle = tn('overlayLabelHaloColor', '#ffffff');
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = color;
    ctx.fillText(txt, x, y);
  }
  // A point is drawn only when it is far enough from the last one drawn in its row and column,
  // so a zoomed-out map shows every 2nd or 4th point rather than a smear of numbers.
  function strideFor(pxPerStep) {
    const min = tn('swxMinSpacingPx', 46);
    let s = 1;
    while (pxPerStep * s < min && s < 16) s *= 2;
    return s;
  }
  function drawPoints(ctx, f, hi) {
    const g = store.grid;
    if (g.lats.length < 2 || g.lngs.length < 2) return;
    const a = proj({ lat: g.lats[0], lng: g.lngs[0] }), b = proj({ lat: g.lats[0], lng: g.lngs[1] });
    const stride = strideFor(Math.hypot(b.x - a.x, b.y - a.y));
    const r = tn('swxDotRadiusPx', 4.5);
    const w = ctx.canvas.width / (window.devicePixelRatio || 1), h = ctx.canvas.height / (window.devicePixelRatio || 1);
    ctx.font = 'bold ' + tn('swxLabelFontPx', 12) + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let k = 0; k < g.pts.length; k++) {
      const pt = g.pts[k];
      if (pt.i % stride || pt.j % stride) continue;
      const v = valueAt(k, hi, f);
      if (v === null) continue;
      const p = proj(pt);
      if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue;
      const c = colorFor(f, v);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = tn('overlayLabelHaloColor', '#ffffff');
      ctx.stroke();
      haloText(ctx, label(f, v), p.x + r + 3, p.y, c);
    }
  }
  // Isobars by marching squares over the grid, every 2 hPa, each line labelled once in view;
  // H / L where a point is the highest / lowest of its eight neighbours.
  function drawIsobars(ctx, hi) {
    const g = store.grid, R = g.lats.length, C = g.lngs.length;
    const P = (i, j) => valueAt(i * C + j, hi, 'msl');
    let lo = Infinity, hiP = -Infinity;
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) { const v = P(i, j); if (v !== null) { lo = Math.min(lo, v); hiP = Math.max(hiP, v); } }
    if (!Number.isFinite(lo)) return;
    const step = tn('swxIsobarStepHpa', 2);
    const color = tn('swxIsobarColor', '#5b2a86');
    const w = ctx.canvas.width / (window.devicePixelRatio || 1), h = ctx.canvas.height / (window.devicePixelRatio || 1);
    const pt = (i, j) => proj({ lat: g.lats[i], lng: g.lngs[j] });
    const lerp = (a, b, va, vb, L) => { const t = (L - va) / ((vb - va) || 1e-9); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; };
    ctx.lineCap = 'round';
    ctx.font = 'bold ' + tn('swxLabelFontPx', 12) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let L = Math.ceil(lo / step) * step; L <= hiP; L += step) {
      const segs = [];
      for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) {
        const v = [P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)];
        if (v.some(x => x === null)) continue;
        const c = [pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)];
        const cross = [];
        for (let e = 0; e < 4; e++) {
          const a = v[e], b = v[(e + 1) % 4];
          if ((a < L) !== (b < L)) cross.push(lerp(c[e], c[(e + 1) % 4], a, b, L));
        }
        if (cross.length === 2) segs.push(cross);
        else if (cross.length === 4) { segs.push([cross[0], cross[1]]); segs.push([cross[2], cross[3]]); }
      }
      if (!segs.length) continue;
      for (const pass of [0, 1]) {
        ctx.beginPath();
        for (const [a, b] of segs) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        ctx.strokeStyle = pass ? color : tn('overlayLabelHaloColor', '#ffffff');
        ctx.lineWidth = pass ? tn('swxIsobarWidthPx', 1.6) : tn('swxIsobarWidthPx', 1.6) + 2.5;
        ctx.stroke();
      }
      // One label per line, on the segment nearest the middle of the screen.
      let best = null, bd = Infinity;
      for (const [a, b] of segs) {
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (m.x < 30 || m.y < 30 || m.x > w - 30 || m.y > h - 30) continue;
        const d = (m.x - w / 2) ** 2 + (m.y - h / 2) ** 2;
        if (d < bd) { bd = d; best = m; }
      }
      if (best) haloText(ctx, String(Math.round(L)), best.x, best.y, color);
    }
    // Centres: H / L, with their value under them.
    ctx.font = 'bold ' + tn('swxCentreFontPx', 18) + 'px sans-serif';
    for (let i = 1; i < R - 1; i++) for (let j = 1; j < C - 1; j++) {
      const v = P(i, j);
      if (v === null) continue;
      let isHi = true, isLo = true;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const n = P(i + di, j + dj);
        if (n === null) { isHi = isLo = false; continue; }
        if (n >= v) isHi = false;
        if (n <= v) isLo = false;
      }
      if (!isHi && !isLo) continue;
      const p = pt(i, j);
      if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
      haloText(ctx, isHi ? 'H' : 'L', p.x, p.y, isHi ? tn('swxHighColor', '#1f4e79') : tn('swxLowColor', '#c62828'));
    }
  }

  function drawSurfaceWx() {
    if (!window.showSurfaceWx || !store) return;
    if (typeof octx === 'undefined' || !octx || typeof proj !== 'function') return;
    const zoom = (typeof map !== 'undefined' && map.getZoom) ? map.getZoom() : 99;
    if (zoom < tn('swxMinZoom', 7)) return;
    const hi = hourIndex(lookaheadHours());
    if (hi < 0) return;
    const f = field();
    octx.save();
    if (f === 'msl') drawIsobars(octx, hi); else drawPoints(octx, f, hi);
    octx.restore();
  }

  // The hour the map shows, in words: "Dew point spread · +3 h · 15:00Z".
  function caption() {
    if (!store) return '';
    const hrs = lookaheadHours();
    const hi = hourIndex(hrs);
    if (hi < 0) return '';
    const names = { spread: str('swxFieldSpread', 'Dew point spread'), dew: str('swxFieldDew', 'Dew point'),
      temp: str('swxFieldTemp', 'Temperature'), msl: str('swxFieldMsl', 'Sea-level pressure'), base: str('swxFieldBase', 'Cloud base (estimate)') };
    const t = new Date(store.times[hi]);
    const z = String(t.getUTCHours()).padStart(2, '0') + ':00Z';
    const when = hrs ? '+' + hrs + ' h · ' + z : str('swxNow', 'now') + ' · ' + z;
    // Each part isolated: in Hebrew "°C" and "16:00Z" keep their own order inside the line.
    return '⁨' + names[field()] + '⁩ · ⁨' + when + '⁩ · ⁦' + unitText(field()) + '⁩';
  }

  async function enable(opts) {
    const got = await fetchGrid(opts);
    if (typeof draw === 'function') draw();
    return !!got;
  }
  function clear() { store = null; }

  NS.surfaceWx = {
    FIELDS, field, setField, gridPoints, fetchGrid, hourIndex, valueAt, sampleNear,
    colorFor, label, caption, lookaheadHours, enable, clear, _store: () => store,
  };
  window.drawSurfaceWx = drawSurfaceWx;
}());
