'use strict';
// NavAid AI assistant (BYOK). A chat panel that answers grounded questions
// (NOTAMs / weather / airfield & VOR lookups) and can drive the route, by
// giving an LLM a set of tools that call the app's existing functions.
//
// Design (see docs/superpowers/specs): provider-agnostic BYOK — the model runs
// in the browser with the user's own key (default: Google Gemini free tier),
// so the app stays a pure static site. Safety is TIERED: read tools run freely;
// route mutations apply immediately but are Undo-able (existing undo stack);
// outbound/irreversible actions (save, export) require an explicit confirm. The
// assistant may only report facts a tool returned — it must never invent a
// NOTAM, weather value, or frequency — and every answer is a planning aid, not
// an operational briefing.
(function () {
  const NS = (window.NavAid = window.NavAid || {});
  const KEY = 'navaid.ai.key', PROV = 'navaid.ai.provider', MODEL = 'navaid.ai.model';
  const DEFAULT_PROVIDER = 'gemini';
  const DEFAULT_MODEL = 'gemini-2.5-flash';   // free-tier, function-calling capable

  const S = window.S || {};
  const t = (k, fb) => (S && S[k]) || fb;

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setLs(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* */ } }

  const SYSTEM = [
    'You are the NavAid flight-planning assistant for CVFR / LSA VFR flying in the Israel FIR (LLLL).',
    'Help the pilot plan routes and answer questions about NOTAMs, weather, airfields, VOR/DME and reporting points.',
    'ALWAYS use the provided tools to get facts. NEVER invent or guess a NOTAM, a weather value, a frequency, or coordinates —',
    'if a tool returns nothing, say so plainly. Quote the real values the tools return.',
    'Waypoints are Israeli ICAO codes (LLxx), VFR reporting-point codes, or VOR idents; pass them to the tools as written.',
    'Route planning, in order of preference: (1) call list_route_templates and, if a curated route connects the two',
    'airfields (from/to in either direction), use apply_route_template; (2) otherwise call plan_corridor(from,to) to',
    'route over the published CVFR leg network through its reporting points; (3) only if plan_corridor finds no path,',
    'fall back to a direct set_route — and say so. Never draw a direct line when a template or corridor exists.',
    'Corridor/segment altitudes are candidate data — remind the user to verify against the official CVFR chart.',
    'Be concise. When you change the route, briefly say what you did.',
    'This is a PLANNING AID ONLY — not an operational briefing. Remind the user to verify against the official AIP,',
    'NOTAM office and a proper weather brief before flight.',
  ].join(' ');

  // --- data readiness -------------------------------------------------
  async function ensureTemplates() {
    if (typeof loadRouteTemplates === 'function' && (typeof routeTemplates === 'undefined' || routeTemplates == null)) {
      try { await loadRouteTemplates(); } catch (e) { /* */ }
    }
    return (typeof routeTemplates !== 'undefined' && Array.isArray(routeTemplates)) ? routeTemplates : [];
  }
  // CVFR leg network (green-route segments) — fetched once, cached. Used to
  // graph-route any airfield pair through the published reporting points when no
  // curated template fits. Altitudes here are candidate data (planning aid).
  let _segCache = null;
  async function segmentsData() {
    if (_segCache) return _segCache;
    try {
      const url = (S && S.legAltitudeUrl) || 'data/cvfr-leg-altitude.json';
      const r = await fetch(url);
      const j = await r.json();
      _segCache = Array.isArray(j.segments) ? j.segments : [];
    } catch (e) { _segCache = []; }
    return _segCache;
  }
  // Shortest-distance path over the leg network (Dijkstra). One-way segments are
  // directed from→to; two-way segments traverse both ways.
  function corridorPath(segs, from, to) {
    const nodes = new Set(), adj = {};
    const add = (a, b, w) => { (adj[a] = adj[a] || []).push([b, w]); };
    for (const s of segs) {
      if (!s.from || !s.to) continue;
      nodes.add(s.from); nodes.add(s.to);
      const w = Number(s.distanceNm) > 0 ? Number(s.distanceNm) : 1;
      add(s.from, s.to, w);
      if (!s.oneWay) add(s.to, s.from, w);
    }
    if (!nodes.has(from) || !nodes.has(to)) return { missing: !nodes.has(from) ? from : to };
    const dist = { [from]: 0 }, prev = {}, pq = [[0, from]];
    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]);
      const [d, n] = pq.shift();
      if (n === to) break;
      if (d > (dist[n] == null ? Infinity : dist[n])) continue;
      for (const [m, w] of (adj[n] || [])) {
        const nd = d + w;
        if (dist[m] == null || nd < dist[m]) { dist[m] = nd; prev[m] = n; pq.push([nd, m]); }
      }
    }
    if (dist[to] == null) return { path: null };
    const path = [to]; let c = to;
    while (c !== from) { c = prev[c]; if (c == null) return { path: null }; path.unshift(c); }
    return { path };
  }
  async function ensureData() {
    const jobs = [];
    if (typeof loadAirfields === 'function' && (typeof airfields === 'undefined' || airfields == null)) jobs.push(loadAirfields());
    if (typeof loadVors === 'function' && (typeof vors === 'undefined' || vors == null)) jobs.push(loadVors());
    if (typeof loadNavWaypoints === 'function' && (typeof navWP === 'undefined' || navWP == null)) jobs.push(loadNavWaypoints());
    if (jobs.length) { try { await Promise.all(jobs); } catch (e) { /* best effort */ } }
  }

  // Resolve a single name (ICAO / reporting point / VOR ident) → {lat,lng,name}.
  function resolvePoint(name) {
    const s = String(name == null ? '' : name).trim();
    if (!s) return null;
    if (typeof airfieldByIcao === 'function') { const a = airfieldByIcao(s); if (a) return { lat: a.lat, lng: a.lng, name: a.name }; }
    if (typeof findNavWpToken === 'function') { const w = findNavWpToken(s); if (w) return { lat: w.lat, lng: w.lng, name: w.name || s }; }
    if (typeof vorByIdent === 'function') { const v = vorByIdent(s); if (v) return { lat: v.lat, lng: v.lng, name: v.ident }; }
    return null;
  }

  // Route edits are Undo-able for free: draw() calls persist(), which records an
  // undo snapshot synchronously on every state change (io.js). So a tool just
  // mutates state and calls draw(); the standard Undo button reverts it.
  // Full route REPLACEMENT: clear legs + comm-change suppressions first (as the
  // app's own replacement paths do) so nothing from the previous route carries
  // onto the new one when the leg counts happen to match, then rebuild + repaint.
  function applyReplacementRoute(waypoints) {
    state.waypoints = waypoints;
    state.legs = [];
    state.notes = state.notes || [];
    state.commChangeSuppressions = [];
    state.selected = null;
    if (typeof syncLegs === 'function') syncLegs();
    if (typeof draw === 'function') draw();
    toast(t('assistantEditedRoute', 'Assistant edited the route'));
  }

  function r1(x) { return Math.round(x * 10) / 10; }
  function nmBetween(a, b) {
    if (typeof geo === 'function') { try { const g = geo(a, b); if (g && Number.isFinite(g.dist)) return g.dist; } catch (e) { /* */ } }
    // haversine fallback (nm)
    const R = 3440.065, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    const la1 = a.lat * toR, la2 = b.lat * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Representative coord for a NOTAM (circle centre / polygon vertex / airfield).
  function notamCoord(n) {
    const g = n && n.geom;
    if (g) {
      if (g.type === 'circle' && Number.isFinite(g.lat)) return { lat: g.lat, lng: g.lng };
      if (Array.isArray(g.coords) && g.coords.length) return { lat: g.coords[0][0], lng: g.coords[0][1] };
    }
    if (n && n.icao && typeof airfieldByIcao === 'function') { const a = airfieldByIcao(n.icao); if (a) return { lat: a.lat, lng: a.lng }; }
    return null;
  }

  function decode(n) {
    return (typeof decodeNotam === 'function') ? decodeNotam(n) : (n && (n.text || n.id)) || '';
  }
  function activeList() {
    if (typeof activeNotams === 'function') return activeNotams() || [];
    return Array.isArray(typeof notams !== 'undefined' ? notams : null) ? notams : [];
  }

  // --- tools ----------------------------------------------------------
  // Each: { name, description, parameters (Gemini/OpenAPI subset), tier, run }.
  // tier: 'read' (free) | 'route' (auto + undo) | 'out' (confirm).
  const TOOLS = [
    {
      name: 'describe_route', tier: 'read',
      description: 'The full planned route with PER-LEG detail: for each leg the from/to waypoints, distance (NM), ' +
        'magnetic heading (°M), inbound altitude (ft), cruise speed (kt), leg time (min), fuel (US gal), ' +
        'VOR radial/DME and active comm frequency when set; plus route totals. Call this to answer any question ' +
        'about a specific leg (heading, altitude, distance, time, fuel, frequency).',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const wps = (typeof state !== 'undefined' && state.waypoints) || [];
        if (wps.length < 2) return { waypoints: wps.map(w => w.name || '(unnamed)'), legCount: 0, totalNm: 0, legs: [], note: 'No route is currently planned.' };
        const legs = (state.legs) || [];
        const ac = (typeof aircraft === 'object' && aircraft) ? aircraft : null;
        const gph = ac && ac.gph > 0 ? ac.gph : null;
        const freqSrc = typeof routeFreqSources === 'function' ? routeFreqSources() : [];
        const gRef = (typeof activeVor === 'function' ? activeVor() : null);
        let total = 0, totTime = 0, totFuel = 0;
        const rows = [];
        const n = Math.min(legs.length, wps.length - 1);
        for (let i = 0; i < n; i++) {
          const A = wps[i], B = wps[i + 1];
          const g = (typeof geo === 'function') ? geo(A, B) : { dist: nmBetween(A, B), brg: null };
          const dist = g.dist; total += dist;
          const hdg = (g.brg != null && typeof toMagnetic === 'function') ? Math.round(toMagnetic(g.brg)) : null;
          const spd = legs[i].flightSpeed;
          const alt = legs[i].inboundAltitude;
          const dur = spd > 0 ? dist / spd : 0; totTime += dur;
          const fuel = gph ? dur * gph : null; if (fuel != null) totFuel += fuel;
          const v = (legs[i].vorRef && typeof vorByIdent === 'function' ? vorByIdent(legs[i].vorRef) : null) || gRef;
          let radial = null, dmeNm = null;
          if (v && typeof vorRadialDme === 'function') { const rd = vorRadialDme(v, B.lat, B.lng); if (rd) { radial = 'R-' + rd.radial + (v.ident ? ' ' + v.ident : ''); dmeNm = Number(rd.dme); } }
          const freq = (typeof legActiveFreq === 'function') ? legActiveFreq(i, freqSrc) : '';
          rows.push({
            leg: i + 1, from: A.name || '(unnamed)', to: B.name || '(unnamed)',
            distNm: r1(dist), headingMag: hdg, altitudeFt: Number.isFinite(alt) ? alt : null,
            speedKt: spd, timeMin: dur > 0 ? Math.round(dur * 60) : null,
            fuelGal: fuel != null ? r1(fuel) : null, radial, dmeNm, commFreq: freq || null,
          });
        }
        return {
          waypoints: wps.map(w => w.name || '(unnamed)'), legCount: rows.length, totalNm: r1(total),
          totalTimeMin: totTime > 0 ? Math.round(totTime * 60) : null,
          totalFuelGal: gph ? r1(totFuel) : null, legs: rows,
        };
      },
    },
    {
      name: 'find_point', tier: 'read',
      description: 'Resolve an airfield ICAO, VFR reporting-point code, or VOR ident to its name and coordinates.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'e.g. LLHZ, HADERA, NAT' } }, required: ['query'] },
      run: async (a) => { await ensureData(); const p = resolvePoint(a.query); return p ? { found: true, name: p.name, lat: p.lat, lng: p.lng } : { found: false, query: a.query }; },
    },
    {
      name: 'get_airfield_info', tier: 'read',
      description: 'Airfield details by ICAO: name, elevation, runways, and primary radio frequency.',
      parameters: { type: 'object', properties: { icao: { type: 'string' } }, required: ['icao'] },
      run: async (a) => {
        await ensureData();
        const af = typeof airfieldByIcao === 'function' ? airfieldByIcao(a.icao) : null;
        if (!af) return { found: false, icao: a.icao };
        return {
          found: true, icao: af.name, name: af.en || af.name, elevationFt: af.elev_ft,
          runways: af.runways || [],
          primaryFreq: (typeof airfieldPrimaryText === 'function' ? airfieldPrimaryText(af) : '') || null,
        };
      },
    },
    {
      name: 'get_vor_radial', tier: 'read',
      description: 'Magnetic radial and DME (NM) from a VOR to a point (ICAO / reporting point / VOR / current position of a waypoint).',
      parameters: { type: 'object', properties: { vor: { type: 'string', description: 'VOR ident' }, point: { type: 'string' } }, required: ['vor', 'point'] },
      run: async (a) => {
        await ensureData();
        const v = typeof vorByIdent === 'function' ? vorByIdent(a.vor) : null;
        const p = resolvePoint(a.point);
        if (!v) return { error: 'unknown VOR ' + a.vor };
        if (!p) return { error: 'unknown point ' + a.point };
        const rd = typeof vorRadialDme === 'function' ? vorRadialDme(v, p.lat, p.lng) : null;
        return rd ? { vor: v.ident, point: p.name, radial: rd.radial, dmeNm: rd.dme } : { error: 'could not compute' };
      },
    },
    {
      name: 'get_notams', tier: 'read',
      description: 'Active NOTAMs for an airfield (icao) and/or near a point within a radius. With no arguments, returns the active NOTAM count and a sample.',
      parameters: {
        type: 'object', properties: {
          icao: { type: 'string', description: 'airfield ICAO to filter by' },
          near: { type: 'string', description: 'ICAO / reporting point / VOR to search around' },
          radiusNm: { type: 'number', description: 'search radius in NM (default 15)' },
        },
      },
      run: async (a) => {
        await ensureData();
        if (typeof loadNotam === 'function' && (typeof notams === 'undefined' || notams == null)) { try { await loadNotam(); } catch (e) { /* */ } }
        const all = activeList();
        let hits = all;
        if (a.icao) { const ic = String(a.icao).toUpperCase(); hits = hits.filter(n => (n.icao || '').toUpperCase() === ic); }
        if (a.near) {
          const p = resolvePoint(a.near);
          const rad = Number.isFinite(a.radiusNm) ? a.radiusNm : 15;
          if (p) hits = hits.filter(n => { const c = notamCoord(n); return c && nmBetween(p, c) <= rad; });
        }
        const capped = hits.slice(0, 15);
        return {
          count: hits.length,
          notams: capped.map(n => ({ id: n.id, icao: n.icao || null, start: n.start || null, end: n.end || null, text: decode(n) })),
          truncated: hits.length > capped.length,
        };
      },
    },
    {
      name: 'get_weather', tier: 'read',
      description: 'Current surface weather (wind kt + direction, temperature °C) at a point (ICAO / reporting point / VOR / lat,lng).',
      parameters: { type: 'object', properties: { point: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } },
      run: async (a) => {
        await ensureData();
        let lat = a.lat, lng = a.lng, name = null;
        if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && a.point) { const p = resolvePoint(a.point); if (p) { lat = p.lat; lng = p.lng; name = p.name; } }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'need a resolvable point or lat/lng' };
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3) +
          '&current=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timezone=UTC';
        const r = await fetch(url);
        if (!r.ok) return { error: 'weather fetch failed (' + r.status + ')' };
        const j = await r.json(); const c = j.current || {};
        return {
          point: name || (lat.toFixed(3) + ',' + lng.toFixed(3)),
          surfaceWindDir: c.wind_direction_10m, surfaceWindKt: c.wind_speed_10m, tempC: c.temperature_2m,
          timeUTC: c.time, note: 'Surface (10 m) conditions from Open-Meteo model — not a METAR/TAF.',
        };
      },
    },
    {
      name: 'list_route_templates', tier: 'read',
      description: 'Curated CVFR route templates (published corridors). Each has from/to airfields and the full ordered waypoint list including the required VFR reporting points. Use this to find a real route between two airfields.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const list = await ensureTemplates();
        return {
          templates: list.map(x => ({
            id: x.id, name: x.name,
            from: x.waypoints[0], to: x.waypoints[x.waypoints.length - 1],
            waypoints: x.waypoints, defaultSpeedKt: Number(x.defaultSpeed) || 90,
          })),
        };
      },
    },
    {
      name: 'apply_route_template', tier: 'route',
      description: 'Build the route from a curated template (by id or name). Uses the corridor\'s reporting points. Applies immediately; user can Undo.',
      parameters: { type: 'object', properties: { template: { type: 'string', description: 'template id or name' } }, required: ['template'] },
      run: async (a) => {
        const list = await ensureTemplates();
        const key = String(a.template == null ? '' : a.template).trim().toLowerCase();
        if (!key) return { error: 'need a template id or name' };
        const tpl = list.find(x => x.id.toLowerCase() === key || (x.name || '').toLowerCase() === key) ||
          list.find(x => (x.name || '').toLowerCase().includes(key));
        if (!tpl) return { error: 'no template matching "' + a.template + '"', available: list.map(x => x.name) };
        let route;
        try { route = await routeFromTemplate(tpl, Number(tpl.defaultSpeed) || 90); }
        catch (e) { return { error: 'unresolved waypoint in template: ' + ((e && e.message) || e) }; }
        // Template supplies its own legs (with charted altitudes) — set them
        // explicitly, then syncLegs() reconciles count. draw()→persist() records undo.
        state.waypoints = route.waypoints;
        state.legs = route.legs;
        state.notes = route.notes || [];
        state.commChangeSuppressions = Array.isArray(route.commChangeSuppressions) ? route.commChangeSuppressions.slice() : [];
        state.selected = null;
        if (typeof syncLegs === 'function') syncLegs();
        if (typeof draw === 'function') draw();
        toast(t('assistantEditedRoute', 'Assistant edited the route'));
        return { ok: true, template: tpl.name, waypoints: route.waypoints.map(w => w.name) };
      },
    },
    {
      name: 'plan_corridor', tier: 'route',
      description: 'Route between two points over the published CVFR leg network (green-route segments through reporting points), shortest by distance. Use when no curated template matches. Applies immediately; Undo-able. Segment altitudes are candidate data — a planning aid.',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      run: async (a) => {
        await ensureData();
        const segs = await segmentsData();
        if (!segs.length) return { error: 'CVFR leg network unavailable' };
        const F = String(a.from == null ? '' : a.from).trim().toUpperCase();
        const To = String(a.to == null ? '' : a.to).trim().toUpperCase();
        if (F === To) return { error: 'from and to are the same point' };
        const res = corridorPath(segs, F, To);
        if (res.missing) return { error: res.missing + ' is not on the CVFR leg network' };
        if (!res.path || res.path.length < 2) return { error: 'no CVFR corridor found between ' + F + ' and ' + To };
        const resolved = [], bad = [];
        for (const nm of res.path) { const p = resolvePoint(nm); p ? resolved.push(p) : bad.push(nm); }
        if (bad.length) return { error: 'could not resolve corridor points: ' + bad.join(', ') };
        applyReplacementRoute(resolved.map(p => ({ lat: p.lat, lng: p.lng, name: p.name })));
        return { ok: true, corridor: res.path, note: 'Routed over candidate CVFR leg data — verify altitudes against the official chart.' };
      },
    },
    {
      name: 'set_route', tier: 'route',
      description: 'Replace the planned route with these waypoints in order (each an ICAO / reporting point / VOR ident). Use this only when no curated template or CVFR corridor fits. Applies immediately; user can Undo.',
      parameters: { type: 'object', properties: { points: { type: 'array', items: { type: 'string' }, description: 'ordered list, e.g. ["LLHZ","HADERA","LLIB"]' } }, required: ['points'] },
      run: async (a) => {
        await ensureData();
        const names = Array.isArray(a.points) ? a.points : [];
        if (names.length < 2) return { error: 'need at least two waypoints' };
        const resolved = [], bad = [];
        for (const nm of names) { const p = resolvePoint(nm); p ? resolved.push(p) : bad.push(nm); }
        if (bad.length) return { error: 'could not resolve: ' + bad.join(', '), resolved: resolved.map(p => p.name) };
        applyReplacementRoute(resolved.map(p => ({ lat: p.lat, lng: p.lng, name: p.name })));
        return { ok: true, waypoints: resolved.map(p => p.name) };
      },
    },
    {
      name: 'reverse_route', tier: 'route',
      description: 'Reverse the current route (swap start and destination). Undo-able.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const wps = (typeof state !== 'undefined' && state.waypoints) || [];
        if (wps.length < 2) return { error: 'no route to reverse' };
        applyReplacementRoute(wps.slice().reverse());
        return { ok: true, waypoints: state.waypoints.map(w => w.name) };
      },
    },
    {
      name: 'set_leg', tier: 'route',
      description: 'Set the inbound altitude (ft) and/or cruise speed (kt) on a leg (1-based index). Undo-able.',
      parameters: { type: 'object', properties: { leg: { type: 'number', description: '1-based leg number' }, altitudeFt: { type: 'number' }, speedKt: { type: 'number' } }, required: ['leg'] },
      run: async (a) => {
        const legs = (typeof state !== 'undefined' && state.legs) || [];
        const i = (a.leg | 0) - 1;
        if (i < 0 || i >= legs.length) return { error: 'leg ' + a.leg + ' out of range (route has ' + legs.length + ' legs)' };
        if (Number.isFinite(a.altitudeFt)) {
          legs[i].inboundAltitude = a.altitudeFt;
          // Pin as manual so the CVFR dataset reconciler doesn't overwrite it.
          if (typeof markLegAltitudeManual === 'function') markLegAltitudeManual(i);
        }
        if (Number.isFinite(a.speedKt)) legs[i].flightSpeed = a.speedKt;
        if (typeof draw === 'function') draw();
        toast(t('assistantEditedRoute', 'Assistant edited the route'));
        return { ok: true, leg: a.leg, altitudeFt: legs[i].inboundAltitude, speedKt: legs[i].flightSpeed };
      },
    },
    {
      name: 'save_route', tier: 'out',
      description: 'Save the current route to the saved-route library under a name. Requires user confirmation.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      run: async (a) => {
        const wps = (typeof state !== 'undefined' && state.waypoints) || [];
        if (wps.length < 2) return { error: 'nothing to save' };
        if (!confirmAction(t('assistantConfirmSave', 'Save this route as') + ' "' + a.name + '"?')) return { cancelled: true };
        if (typeof routeLibrarySaveCurrent === 'function') { routeLibrarySaveCurrent(a.name); return { ok: true, name: a.name }; }
        return { error: 'save unavailable' };
      },
    },
  ];

  // --- confirm / toast wrappers (overridable in tests) ----------------
  let confirmAction = (msg) => (typeof confirm === 'function') ? confirm(msg) : true;
  function toast(msg) { if (typeof showToast === 'function') showToast(msg); }

  // --- provider (Gemini by default; swappable for tests) --------------
  async function geminiSend(messages) {
    const key = ls(KEY), model = ls(MODEL) || DEFAULT_MODEL;
    if (!key) throw new Error('no-key');
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: messages,
      tools: [{ functionDeclarations: TOOLS.map(x => ({ name: x.name, description: x.description, parameters: x.parameters })) }],
    };
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    if (!r.ok) { const txt = await r.text().catch(() => ''); throw new Error('Gemini ' + r.status + ': ' + txt.slice(0, 200)); }
    const j = await r.json();
    // A prompt-level block has no candidates at all.
    if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error('Gemini blocked the request (' + j.promptFeedback.blockReason + ')');
    const cand = j.candidates && j.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    // A candidate with no parts is a block / truncation (SAFETY, MAX_TOKENS, …) —
    // surface it instead of faking an empty answer.
    if (!parts || !parts.length) throw new Error('Gemini returned no content' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''));
    return parts;
  }
  let providerSend = geminiSend;   // tests override via NS.assistant._setProvider

  // --- agent loop -----------------------------------------------------
  let messages = [];   // Gemini "contents" history
  let busy = false;
  const MAX_ITERS = 6;

  async function runAgent(userText) {
    if (busy) return;
    busy = true;
    messages.push({ role: 'user', parts: [{ text: userText }] });
    renderUser(userText);
    setBusy(true);
    try {
      for (let iter = 0; iter < MAX_ITERS; iter++) {
        const parts = await providerSend(messages);
        messages.push({ role: 'model', parts });
        const text = parts.filter(p => p && p.text).map(p => p.text).join('').trim();
        if (text) renderAssistant(text);
        const calls = parts.filter(p => p && p.functionCall).map(p => p.functionCall);
        if (!calls.length) break;
        const responses = [];
        for (const call of calls) {
          renderActivity(call.name, call.args);
          const tool = TOOLS.find(x => x.name === call.name);
          let result;
          try { result = tool ? await tool.run(call.args || {}) : { error: 'unknown tool ' + call.name }; }
          catch (e) { result = { error: String((e && e.message) || e) }; }
          // Gemini requires a non-empty functionResponse object; JSON.stringify
          // drops undefined values, so coerce to a serializable shape.
          const response = (result && typeof result === 'object') ? result : { result: result == null ? null : result };
          responses.push({ functionResponse: { name: call.name, response } });
        }
        messages.push({ role: 'user', parts: responses });
      }
    } catch (e) {
      renderError((e && e.message) === 'no-key'
        ? t('assistantNoKey', 'Add an API key in settings to start chatting.')
        : (t('assistantError', 'Assistant error') + ': ' + ((e && e.message) || e)));
      if ((e && e.message) === 'no-key') openSettings();
    } finally { busy = false; setBusy(false); }
  }

  function resetChat() {
    if (busy) return;   // don't wipe history mid-turn — it would corrupt the in-flight request
    messages = [];
    if (logEl) logEl.innerHTML = '';
  }

  // --- UI (built in JS; only the script tag lives in index.html) ------
  let fab, panel, logEl, inputEl, sendBtn, settingsEl, built = false;

  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function build() {
    if (built) return; built = true;
    fab = el('button', 'assistant-fab'); fab.type = 'button';
    fab.textContent = '💬'; fab.title = t('assistantTitle', 'Flight assistant');
    fab.setAttribute('aria-label', t('assistantTitle', 'Flight assistant'));
    fab.onclick = toggle;

    panel = el('div', 'assistant-panel hidden');
    const head = el('div', 'assistant-head');
    head.appendChild(el('span', 'assistant-title', t('assistantTitle', 'Flight assistant')));
    const gear = el('button', 'assistant-icon-btn', '⚙'); gear.type = 'button'; gear.title = t('assistantSettings', 'Settings'); gear.onclick = toggleSettings;
    const clr = el('button', 'assistant-icon-btn', '🗑'); clr.type = 'button'; clr.title = t('assistantClear', 'Clear chat'); clr.onclick = resetChat;
    const x = el('button', 'assistant-icon-btn', '✕'); x.type = 'button'; x.title = t('close', 'Close'); x.onclick = toggle;
    head.append(gear, clr, x);

    logEl = el('div', 'assistant-log');

    settingsEl = buildSettings();

    const row = el('div', 'assistant-input-row');
    inputEl = el('textarea', 'assistant-input'); inputEl.rows = 1;
    inputEl.placeholder = t('assistantPlaceholder', 'Ask about NOTAMs, weather, or plan a route…');
    inputEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submit(); } });
    sendBtn = el('button', 'assistant-send', t('assistantSend', 'Send')); sendBtn.type = 'button'; sendBtn.onclick = submit;
    row.append(inputEl, sendBtn);

    panel.append(head, settingsEl, logEl, row);
    document.body.append(fab, panel);
  }

  function buildSettings() {
    const box = el('div', 'assistant-settings hidden');
    box.appendChild(el('div', 'assistant-settings-h', t('assistantSettings', 'Settings')));
    const keyIn = el('input', 'assistant-field'); keyIn.type = 'password'; keyIn.placeholder = t('assistantKeyPlaceholder', 'API key');
    keyIn.value = ls(KEY) || '';
    const modelIn = el('input', 'assistant-field'); modelIn.type = 'text'; modelIn.placeholder = 'model'; modelIn.value = ls(MODEL) || DEFAULT_MODEL;
    const help = el('div', 'assistant-help');
    const link = el('a', null, t('assistantGetKey', 'Get a free Google Gemini key'));
    link.href = 'https://aistudio.google.com/apikey'; link.target = '_blank'; link.rel = 'noopener';
    help.appendChild(link);
    const save = el('button', 'assistant-send', t('assistantSaveKey', 'Save')); save.type = 'button';
    save.onclick = () => {
      setLs(KEY, keyIn.value.trim() || null);
      setLs(PROV, DEFAULT_PROVIDER);
      setLs(MODEL, modelIn.value.trim() || DEFAULT_MODEL);
      box.classList.add('hidden');
      toast(t('assistantKeySaved', 'API key saved'));
    };
    box.append(keyIn, modelIn, help, save);
    return box;
  }

  function toggleSettings() { settingsEl.classList.toggle('hidden'); }
  function openSettings() { build(); panel.classList.remove('hidden'); settingsEl.classList.remove('hidden'); }

  function toggle() {
    build();
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      if (!ls(KEY)) settingsEl.classList.remove('hidden');
      if (inputEl) inputEl.focus();
    }
  }

  function submit() {
    const v = inputEl && inputEl.value.trim();
    if (!v || busy) return;
    inputEl.value = '';
    runAgent(v);
  }

  function addMsg(role, text) {
    if (!logEl) return;
    const m = el('div', 'assistant-msg assistant-' + role, text);
    logEl.appendChild(m); logEl.scrollTop = logEl.scrollHeight;
    return m;
  }
  function renderUser(text) { addMsg('user', text); }
  function renderAssistant(text) { addMsg('assistant', text); }
  function renderError(text) { addMsg('error', text); }
  function renderActivity(name, args) {
    const label = ({
      get_notams: '🔎 ' + t('assistantActNotam', 'checking NOTAMs'),
      get_weather: '🌦 ' + t('assistantActWx', 'checking weather'),
      set_route: '🧭 ' + t('assistantActRoute', 'updating route'),
      reverse_route: '🧭 ' + t('assistantActRoute', 'updating route'),
      set_leg: '🧭 ' + t('assistantActRoute', 'updating route'),
      save_route: '💾 ' + t('assistantActSave', 'saving route'),
    })[name] || ('· ' + name);
    addMsg('activity', label + '…');
  }
  function setBusy(b) {
    if (sendBtn) sendBtn.disabled = b;
    if (inputEl) inputEl.disabled = b;
    if (fab) fab.classList.toggle('assistant-busy', b);
  }

  // --- public surface (also the test seam) ----------------------------
  NS.assistant = {
    open: () => { build(); if (panel.classList.contains('hidden')) toggle(); },
    close: () => { if (panel && !panel.classList.contains('hidden')) toggle(); },
    send: (text) => runAgent(text),
    reset: resetChat,
    _tools: TOOLS,
    _resolvePoint: resolvePoint,
    _corridorPath: corridorPath,
    _setProvider: (fn) => { providerSend = fn || geminiSend; },
    _setConfirm: (fn) => { confirmAction = fn || confirmAction; },
    _messages: () => messages,
  };

  // Build the FAB on load so it's discoverable; the panel stays hidden.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
