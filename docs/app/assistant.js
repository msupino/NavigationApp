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
  const PROV = 'navaid.ai.provider';                   // active provider id
  const BASEURL = 'navaid.ai.baseUrl';                 // LEGACY single override -- migrated below
  const DEFAULT_PROVIDER = 'gemini';
  // key/model are stored PER provider so switching keeps each provider's setup.
  const keyKey = p => 'navaid.ai.key.' + p;
  const modelKey = p => 'navaid.ai.model.' + p;
  // ...and so is the proxy Base URL, for the same reason and a sharper one. It used to be a
  // single global: configure a proxy for DeepSeek, later switch to OpenRouter and save an
  // OpenRouter key, and the next request posted THAT key and the whole conversation to the
  // DeepSeek proxy. Two independent reviews reproduced it -- the second captured
  // `Authorization: Bearer OPENROUTER-SECRET` arriving at the DeepSeek proxy URL. A
  // credential must never outlive the destination it was chosen for.
  const baseKey = p => 'navaid.ai.baseUrl.' + p;

  const S = window.S || {};
  const t = (k, fb) => (S && S[k]) || fb;

  // Drop the legacy global override. It is NOT migrated onto the active provider, which was
  // my first instinct and is wrong for the very case this fixes: a pilot who set the proxy
  // for DeepSeek and has since switched to OpenRouter would have had OpenRouter silently
  // inherit the DeepSeek proxy -- the leak, carried across the upgrade. The stored value
  // does not record which provider it belonged to, and a guess here sends a credential to a
  // host the pilot never chose for it. Re-entering a proxy URL costs a moment; that does not.
  function migrateLegacyBaseUrl() {
    try {
      if (localStorage.getItem(BASEURL) === null) return;
      localStorage.removeItem(BASEURL);
    } catch (e) { /* storage unavailable */ }
  }

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setLs(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* */ } }
  function activeProvider() { const p = ls(PROV); return PROVIDERS[p] ? p : DEFAULT_PROVIDER; }

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
    'If a waypoint name is not in the datasets but you know its position, pass it to set_route as "NAME=lat,lng"',
    '(decimal degrees). ALWAYS draw the route on the map with the tools — never answer with a coordinate table instead.',
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
      // Always the CVFR network, whatever layer is displayed: routing a CVFR flight
      // through a heli corridor would file a route it is not cleared for.
      const j = legAltitudeFromGraph(await routeGraphData('cvfr'));
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
    // Transactional: if the rebuild throws part-way (e.g. syncLegs/seedCommChange
    // on malformed data), roll back so the tool never leaves a half-applied route
    // that can't be undone. `notes` is kept by reference + mutated below, so copy it.
    const prev = {
      waypoints: state.waypoints, legs: state.legs, notes: (state.notes || []).slice(),
      suppressions: state.commChangeSuppressions, selected: state.selected,
      altPrefix: typeof routeAltPrefix !== 'undefined' ? routeAltPrefix : undefined,
      libId: typeof currentRouteLibraryId !== 'undefined' ? currentRouteLibraryId : undefined,
    };
    try {
      if (typeof routeAltPrefix !== 'undefined') routeAltPrefix = null;   // repin altitude layer to the new route
      if (typeof currentRouteLibraryId !== 'undefined') currentRouteLibraryId = null;   // not the loaded saved entry anymore
      state.waypoints = waypoints;
      state.legs = [];
      state.notes = state.notes || [];
      // This replaces the WHOLE route, so identification-point ovals anchored to the
      // old legs describe segments that no longer exist. Their {leg, t} anchor would
      // survive and place them on unrelated geometry, printing a named reporting fix
      // at the wrong position and time. Every other whole-route replacement (imports,
      // search-built routes, templates) clears notes; drop just the anchored ones so
      // the user's free-standing notes and callouts are kept.
      state.notes = state.notes.filter(n => !(n && n.rp));
      state.commChangeSuppressions = [];
      state.selected = null;
      if (typeof syncLegs === 'function') syncLegs();
      // Drop orphan comm-change callouts from the old route + seed the new one's.
      if (showCommChange && typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
      if (typeof draw === 'function') draw();
      toast(t('assistantEditedRoute', 'Assistant edited the route'));
    } catch (e) {
      state.waypoints = prev.waypoints; state.legs = prev.legs; state.notes = prev.notes;
      state.commChangeSuppressions = prev.suppressions; state.selected = prev.selected;
      if (prev.altPrefix !== undefined) routeAltPrefix = prev.altPrefix;
      if (prev.libId !== undefined) currentRouteLibraryId = prev.libId;
      if (typeof draw === 'function') draw();
      throw e;   // surfaced to the tool's catch → reported to the model as { error }
    }
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
    // The whole FIR, not the chart on screen: a question about NOTAMs is not
    // scoped to the chart the map happens to be showing, and the per-chart filter
    // would have the assistant deny the ultralight ones on a CVFR chart.
    if (typeof activeNotams === 'function') return activeNotams({ allCharts: true }) || [];
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
        return rd ? { vor: v.ident, point: p.name, radial: rd.radial, dmeNm: Number(rd.dme) } : { error: 'could not compute' };
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
          if (!p) return { error: 'could not resolve "near" point: ' + a.near };   // don't silently return unrelated NOTAMs
          const rad = Number.isFinite(a.radiusNm) ? a.radiusNm : 15;
          hits = hits.filter(n => { const c = notamCoord(n); return c && nmBetween(p, c) <= rad; });
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
        if (typeof routeAltPrefix !== 'undefined') routeAltPrefix = null;
        if (typeof currentRouteLibraryId !== 'undefined') currentRouteLibraryId = null;
        state.waypoints = route.waypoints;
        state.legs = route.legs;
        state.notes = route.notes || [];
        state.commChangeSuppressions = Array.isArray(route.commChangeSuppressions) ? route.commChangeSuppressions.slice() : [];
        if (typeof state.wind !== 'undefined') state.wind = { dir: 270, speed: 0 };   // template carries no route-wide wind
        state.selected = null;
        if (typeof syncLegs === 'function') syncLegs();
        if (showCommChange && typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
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
      description: 'Replace the planned route with these waypoints in order. Each point is an ICAO / reporting point / VOR ident, OR explicit coordinates as "NAME=lat,lng" / "lat,lng" (decimal degrees) for points not in the datasets — so a route can ALWAYS be drawn on the map, never dumped as a text table. Consecutive NAMED points not directly connected on the CVFR leg network are auto-expanded via the published corridor (reporting points inserted); coordinate points are used verbatim. Applies immediately; user can Undo.',
      parameters: { type: 'object', properties: { points: { type: 'array', items: { type: 'string' }, description: 'ordered list, e.g. ["LLHZ","HADERA","BKAMA=31.44167,34.76556","LLRM"]' } }, required: ['points'] },
      run: async (a) => {
        await ensureData();
        // Each token: a resolvable name, or explicit coords "NAME=lat,lng" / "lat,lng".
        const coordTok = s => {
          const m = String(s).match(/^(?:([^=]+?)\s*=\s*)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
          if (!m) return null;
          const lat = +m[2], lng = +m[3];
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          // Israel-region sanity (the chart extent, padded ~2°). A value outside
          // this is almost always a typo or a lat/lng swap — and because Israel's
          // latitude (~29-33) and longitude (~34-36) each fall inside the other's
          // global range, a naive -90..90 / -180..180 check would accept a swap
          // and plot a wrong point a pilot might trust. Reject so the model fixes it.
          if (lat < 27 || lat > 36 || lng < 32 || lng > 38) return null;
          // The padded boxes OVERLAP (both admit 32-36), so the check above does not actually
          // catch the swap its comment describes: every northern-Israel point (lat 32-33.3,
          // lng 34.2-35.9) survives transposition, because the swapped lat lands under 36 and
          // the swapped lng over 32. LLKS as "35.57,32.98" was accepted and drawn in the sea
          // north of Cyprus, ~250 NM out, and reported as success.
          // Israel's real lat and lng ranges do NOT overlap (33.4 < 34.2), so a transposition
          // is decidable: reject when the point is outside the tight box but its transpose is
          // inside it. Points legitimately outside (over the sea to the west, say) are
          // untouched, which narrowing the padded box would not have managed.
          const inTight = (la, ln) => la >= 29 && la <= 34 && ln >= 33 && ln <= 36.5;
          if (!inTight(lat, lng) && inTight(lng, lat)) return null;
          return { lat, lng, name: (m[1] || '').trim() };
        };
        const raw = Array.isArray(a.points) ? a.points.map(n => String(n == null ? '' : n).trim()).filter(Boolean) : [];
        const pts = [];   // { lat, lng, name, key? } — key set only for network-resolvable names
        const bad = [];
        for (const s of raw) {
          const c = coordTok(s);
          if (c) { pts.push(c); continue; }
          const n = s.toUpperCase();
          const p = resolvePoint(n);
          if (p) pts.push({ lat: p.lat, lng: p.lng, name: p.name, key: n });
          else bad.push(n);
        }
        if (bad.length) {
          return { error: 'could not resolve: ' + bad.join(', ') +
            '. If you know their coordinates, pass those points as "NAME=lat,lng" (decimal degrees) and call set_route again — do NOT fall back to printing a table.' };
        }
        if (pts.length < 2) return { error: 'need at least two waypoints' };
        // Expand each consecutive NAMED pair through the CVFR leg network so we
        // never emit a straight-line leg that isn't a published route. Pairs with
        // no network path (or with an explicit-coordinate end) keep the direct
        // segment and are reported as gaps.
        const segs = await segmentsData();
        const chain = [pts[0]];
        const gaps = [];
        let inserted = false;
        for (let i = 1; i < pts.length; i++) {
          const A = pts[i - 1], B = pts[i];
          const res = (A.key && B.key && segs.length) ? corridorPath(segs, A.key, B.key) : { path: null };
          if (res.path && res.path.length >= 2) {
            for (let k = 1; k < res.path.length; k++) {
              const nm = res.path[k];
              const p = resolvePoint(nm);
              if (p) chain.push({ lat: p.lat, lng: p.lng, name: p.name, key: nm });
            }
            if (res.path.length > 2) inserted = true;
          } else {
            chain.push(B);
            gaps.push((A.name || A.key || A.lat + ',' + A.lng) + '→' + (B.name || B.key || B.lat + ',' + B.lng));
          }
        }
        const wps = chain.map(p => ({ lat: p.lat, lng: p.lng, name: p.name || '' }));
        applyReplacementRoute(wps);
        const out = { ok: true, waypoints: wps.map(w => w.name || '(coords)') };
        if (inserted) out.note = 'Expanded via the CVFR corridor (reporting points inserted) — candidate leg data, verify altitudes.';
        if (gaps.length) out.directGaps = gaps;   // pairs with no known CVFR leg — direct segment (may not be a real route)
        return out;
      },
    },
    {
      name: 'reverse_route', tier: 'route',
      description: 'Reverse the current route (swap start and destination). Undo-able.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const wps = (typeof state !== 'undefined' && state.waypoints) || [];
        if (wps.length < 2) return { error: 'no route to reverse' };
        // Delegate to the app's Reverse action, which swaps each leg's
        // inbound/outbound altitude+speed (and labels) instead of discarding
        // per-leg data. It repaints + records undo itself.
        const btn = typeof document !== 'undefined' && document.getElementById('reverse');
        if (btn) btn.click(); else applyReplacementRoute(wps.slice().reverse());
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
        if (Number.isFinite(a.speedKt)) {
          legs[i].flightSpeed = a.speedKt;
          // Asked-for speed, so pin it: the default-speed control must not overwrite
          // it. Forward only -- set_leg never sets outboundSpeed, so the return speed
          // keeps following the default instead of freezing at whatever it was.
          if (typeof markLegSpeedManual === 'function') markLegSpeedManual(legs[i], 'flightSpeed');
        }
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
        // The gate above already showed and confirmed this exact save, so asking again here
        // would be two dialogs for one action.
        if (!mutationApproved('save_route') &&
            !confirmAction(t('assistantConfirmSave', 'Save this route as') + ' "' + a.name + '"?')) {
          return { cancelled: true };
        }
        if (typeof routeLibrarySaveCurrent === 'function') { routeLibrarySaveCurrent(a.name); return { ok: true, name: a.name }; }
        return { error: 'save unavailable' };
      },
    },
  ];

  // --- confirm / toast wrappers (overridable in tests) ----------------
  let confirmAction = (msg) => (typeof confirm === 'function') ? confirm(msg) : true;
  function toast(msg) { if (typeof showToast === 'function') showToast(msg); }

  // --- providers (BYOK, provider-agnostic) ----------------------------
  // The conversation history is kept in a neutral Gemini-style "parts" shape
  // ({text} / {functionCall:{name,args}} / {functionResponse:{name,response}});
  // each adapter translates that (and the tool schema) to/from its own API and
  // returns a normalised parts[] array. Gemini, Anthropic and OpenRouter support
  // direct browser (BYOK) calls; DeepSeek may block browser CORS, so it can take
  // a proxy baseUrl override.
  function toolDefs() { return TOOLS.map(x => ({ name: x.name, description: x.description, parameters: x.parameters })); }
  function keyOrThrow() { const k = ls(keyKey(activeProvider())); if (!k) throw new Error('no-key'); return k; }
  function modelFor(p) { return ls(modelKey(p)) || PROVIDERS[p].model; }

  async function geminiSend(messages) {
    const key = keyOrThrow(), model = modelFor('gemini');
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: messages,
      tools: [{ functionDeclarations: toolDefs() }],
    };
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    if (!r.ok) { const txt = await r.text().catch(() => ''); throw new Error('Gemini ' + r.status + ': ' + txt.slice(0, 200)); }
    const j = await r.json();
    if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error('Gemini blocked the request (' + j.promptFeedback.blockReason + ')');
    const cand = j.candidates && j.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    if (!parts || !parts.length) throw new Error('Gemini returned no content' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''));
    return parts;
  }

  // Convert neutral history → OpenAI chat messages (unique tool_call ids link
  // an assistant turn's calls to the following tool results, in order).
  function toOpenAI(messages) {
    const out = [{ role: 'system', content: SYSTEM }];
    let cid = 0, lastIds = [];
    for (const m of messages) {
      if (m.role === 'model') {
        const text = m.parts.filter(p => p.text).map(p => p.text).join('');
        const calls = m.parts.filter(p => p.functionCall).map(p => p.functionCall);
        lastIds = calls.map(() => 'call_' + (cid++));
        const msg = { role: 'assistant', content: text || null };
        if (calls.length) msg.tool_calls = calls.map((c, i) => ({ id: lastIds[i], type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
        out.push(msg);
      } else {
        const frs = m.parts.filter(p => p.functionResponse);
        if (frs.length) frs.forEach((p, i) => out.push({ role: 'tool', tool_call_id: lastIds[i] || ('call_' + i), content: JSON.stringify(p.functionResponse.response) }));
        else out.push({ role: 'user', content: m.parts.map(p => p.text || '').join('') });
      }
    }
    return out;
  }
  // Shared adapter for OpenAI-compatible chat APIs (DeepSeek, OpenRouter, or any
  // OpenAI-style endpoint). Base URL comes from the provider (or a user override
  // for a proxy). DeepSeek and OpenRouter both speak this format.
  async function openAiCompatSend(messages) {
    const p = activeProvider();
    const key = keyOrThrow(), model = modelFor(p);
    const base = (ls(baseKey(p)) || PROVIDERS[p].base).replace(/\/+$/, '');
    const body = {
      model, messages: toOpenAI(messages),
      tools: TOOLS.map(x => ({ type: 'function', function: { name: x.name, description: x.description, parameters: x.parameters } })),
      tool_choice: 'auto',
    };
    const r = await fetch(base + '/chat/completions',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
    if (!r.ok) { const txt = await r.text().catch(() => ''); throw new Error(PROVIDERS[p].label + ' ' + r.status + ': ' + txt.slice(0, 200)); }
    const j = await r.json();
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    const parts = [];
    if (msg && msg.content) parts.push({ text: msg.content });
    for (const tc of ((msg && msg.tool_calls) || [])) {
      let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { /* */ }
      parts.push({ functionCall: { name: tc.function.name, args } });
    }
    if (!parts.length) throw new Error(PROVIDERS[p].label + ' returned no content');
    return parts;
  }

  // Convert neutral history → Anthropic messages (tool_use ids link to tool_result).
  function toAnthropic(messages) {
    const out = [];
    let cid = 0, lastIds = [];
    for (const m of messages) {
      if (m.role === 'model') {
        const blocks = [];
        const text = m.parts.filter(p => p.text).map(p => p.text).join('');
        if (text) blocks.push({ type: 'text', text });
        const calls = m.parts.filter(p => p.functionCall).map(p => p.functionCall);
        lastIds = calls.map(() => 'tool_' + (cid++));
        calls.forEach((c, i) => blocks.push({ type: 'tool_use', id: lastIds[i], name: c.name, input: c.args || {} }));
        out.push({ role: 'assistant', content: blocks });
      } else {
        const frs = m.parts.filter(p => p.functionResponse);
        if (frs.length) out.push({ role: 'user', content: frs.map((p, i) => ({ type: 'tool_result', tool_use_id: lastIds[i] || ('tool_' + i), content: JSON.stringify(p.functionResponse.response) })) });
        else out.push({ role: 'user', content: m.parts.map(p => p.text || '').join('') });
      }
    }
    return out;
  }
  async function anthropicSend(messages) {
    const key = keyOrThrow(), model = modelFor('anthropic');
    const body = {
      model, max_tokens: 1024, system: SYSTEM, messages: toAnthropic(messages),
      tools: TOOLS.map(x => ({ name: x.name, description: x.description, input_schema: x.parameters })),
    };
    const r = await fetch('https://api.anthropic.com/v1/messages',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
    if (!r.ok) { const txt = await r.text().catch(() => ''); throw new Error('Claude ' + r.status + ': ' + txt.slice(0, 200)); }
    const j = await r.json();
    const parts = [];
    for (const b of (j.content || [])) {
      if (b.type === 'text') parts.push({ text: b.text });
      else if (b.type === 'tool_use') parts.push({ functionCall: { name: b.name, args: b.input || {} } });
    }
    if (!parts.length) throw new Error('Claude returned no content' + (j.stop_reason ? ' (' + j.stop_reason + ')' : ''));
    return parts;
  }

  const PROVIDERS = {
    gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey', send: geminiSend },
    anthropic: { label: 'Anthropic (Claude)', model: 'claude-sonnet-5', keyUrl: 'https://console.anthropic.com/settings/keys', send: anthropicSend },
    openrouter: { label: 'OpenRouter', model: 'openai/gpt-4o-mini', keyUrl: 'https://openrouter.ai/keys', send: openAiCompatSend, base: 'https://openrouter.ai/api/v1', openaiCompat: true },
    deepseek: { label: 'DeepSeek', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys', send: openAiCompatSend, base: 'https://api.deepseek.com', openaiCompat: true, browserBlocked: true },
    // OrcaRouter is a BYOK gateway over ~185 models behind an OpenAI-compatible endpoint, so
    // it reuses this adapter. Its preflight answers Access-Control-Allow-Origin: *, so unlike
    // DeepSeek it works browser-direct with no proxy. The default is an explicit model rather
    // than one of the orcarouter/fusion auto-routing ids: this assistant is useless without
    // tool calls, and a router that picks the model per prompt cannot promise every pick
    // supports them. Any id from the catalog can be typed into the model field.
    orcarouter: { label: 'OrcaRouter', model: 'google/gemini-2.5-flash', keyUrl: 'https://www.orcarouter.ai/console/token', send: openAiCompatSend, base: 'https://api.orcarouter.ai/v1', openaiCompat: true },
  };
  async function dispatchSend(messages) { return PROVIDERS[activeProvider()].send(messages); }
  let providerSend = dispatchSend;   // tests override via NS.assistant._setProvider

  // --- agent loop -----------------------------------------------------
  let messages = [];   // Gemini "contents" history
  let busy = false;
  const MAX_ITERS = 6;

  // Tools carry a `tier`: 'read' answers questions, 'route' rewrites the pilot's
  // route, 'out' writes it somewhere. Only 'read' may run unasked. The tier field
  // existed on every tool but was never consulted, so a state-changing call went
  // straight through — and the model's context includes NOTAM free text from a
  // public feed, so instruction-shaped text in a NOTAM body could rewrite a route
  // the pilot only asked about. Consent is per session, not per call: an ordinary
  // "plan me a route" turn should not become a click-fest.
  // Consent lasts ONE TURN, not the session, and the prompt names the concrete change.
  // A session-wide latch plus a generic "let the assistant change your route" question was
  // the weak half of this gate: tool results carry text nobody in this app wrote -- NOTAM
  // bodies from a public feed, waypoint names out of an imported route file -- and once that
  // text is in the model's context it can ask for a mutation the pilot never did. With one
  // generic approval already given, that mutation ran silently; and even the approval itself
  // could not be attributed, because it never said what was about to change.
  // Sticky: once untrusted text has entered the context it stays there for the rest of the
  // conversation, so every later mutation is asked for individually. Cleared only by Clear.
  let contextTainted = false;
  function markTainted() { contextTainted = true; }
  // The gate now shows the concrete change for every mutation, including save_route -- which
  // has always confirmed its own name. Record the approval the gate just obtained so that
  // tool does not put up a second dialog for the same action. Single use.
  let lastApproved = null;
  function mutationApproved(name) {
    if (lastApproved !== name) return false;
    lastApproved = null;
    return true;
  }

  function fmtPoint(p) {
    if (p == null) return '?';
    if (typeof p === 'string') return p;
    if (typeof p === 'object') {
      if (p.name) return String(p.name);
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) return r1(p.lat) + ',' + r1(p.lng);
    }
    return String(p);
  }
  const currentRouteNames = () => ((typeof state !== 'undefined' && state.waypoints) || [])
    .map(w => w.name || '(unnamed)');
  function arrow(from, to) { return (from.length ? from.join(' → ') : '(empty)') + '\n⇒ ' + to; }

  // What this call would actually do, in the pilot's terms. Never the raw JSON: the point is
  // that an approval can be attributed to a change the pilot recognises.
  function mutationSummary(name, args) {
    const a = args || {};
    const now = currentRouteNames();
    if (name === 'set_route') {
      const pts = Array.isArray(a.points) ? a.points.map(fmtPoint) : [];
      return arrow(now, (pts.length ? pts.join(' → ') : '(empty)') +
        '  (' + pts.length + ' point' + (pts.length === 1 ? '' : 's') + ')');
    }
    if (name === 'reverse_route') return arrow(now, now.slice().reverse().join(' → '));
    if (name === 'apply_route_template') {
      return t('assistantMutTemplate', 'Replace the route with template') + ' "' +
        fmtPoint(a.name || a.template || a.id) + '"\n' + arrow(now, '…');
    }
    if (name === 'plan_corridor') {
      return t('assistantMutCorridor', 'Replace the route with a corridor route') + ' ' +
        fmtPoint(a.from) + ' → ' + fmtPoint(a.to) + '\n' + arrow(now, '…');
    }
    if (name === 'set_leg') {
      const legs = (typeof state !== 'undefined' && state.legs) || [];
      const i = (a.leg | 0) - 1;
      const leg = legs[i];
      const from = now[i] || ('leg ' + a.leg), to = now[i + 1] || '';
      const bits = [];
      if (Number.isFinite(a.altitudeFt)) {
        bits.push('altitude ' + (leg && Number.isFinite(leg.inboundAltitude) ? leg.inboundAltitude : '—') +
          ' → ' + a.altitudeFt + ' ft');
      }
      if (Number.isFinite(a.speedKt)) {
        bits.push('speed ' + (leg && leg.flightSpeed > 0 ? leg.flightSpeed : '—') +
          ' → ' + a.speedKt + ' kt');
      }
      return 'Leg ' + a.leg + (to ? ' (' + from + ' → ' + to + ')' : '') + ':\n' +
        (bits.length ? bits.join('\n') : '(no change)');
    }
    if (name === 'save_route') {
      return t('assistantMutSave', 'Save the current route to the library as') + ' "' +
        fmtPoint(a.name) + '"';
    }
    // An unknown mutating tool: show the arguments rather than approving a blank cheque.
    let js = '';
    try { js = JSON.stringify(a); } catch (e) { js = '(unserializable arguments)'; }
    return name + ' ' + js.slice(0, 300);
  }

  function confirmMutation(name, args) {
    const head = t('assistantConfirmChange', 'The assistant wants to change your route:');
    const tail = contextTainted
      // The pilot has to be able to tell this case apart: the request may have come from text
      // in a NOTAM or an imported file rather than from anything they asked for.
      ? '\n\n' + t('assistantTaintedWarning',
        'Note: this conversation has read text from outside NavAid (NOTAMs or an imported ' +
        'route). Approve only if this is the change you asked for.')
      : '\n\n' + t('assistantUndoHint', 'You can undo it.');
    let ok = false;
    try { ok = !!confirmAction(head + '\n\n' + mutationSummary(name, args) + tail); }
    catch (e) { ok = false; }
    return ok;
  }

  // A model turn can contain several tool calls, and the approval the pilot gave was for a
  // change they were SHOWN. Letting it cover any later tool in the same turn meant an
  // approved set_route could silently authorise a different set_leg or reverse_route. What
  // the approval now covers is that change, repeated: the same tool with the same
  // arguments (a retry, or the model re-issuing an identical call) runs without asking
  // again, and anything materially different is confirmed on its own terms. Taint still
  // disables the allowance entirely.
  function signature(name, args) {
    try { return name + ' ' + JSON.stringify(args || {}); } catch (e) { return name + ' ?'; }
  }
  const approvedThisTurn = new Set();
  function allowMutation(name, args) {
    const sig = signature(name, args);
    if (!contextTainted && approvedThisTurn.has(sig)) { lastApproved = null; return true; }
    const ok = confirmMutation(name, args);
    if (ok) {
      lastApproved = name;
      if (!contextTainted) approvedThisTurn.add(sig);
    }
    return ok;
  }
  // One place where a tool is chosen, gated and run — the loop calls this, and so
  // does the test seam below, so what is tested is the path that actually runs.
  // Read tools whose result carries text this app did not author: NOTAM free text straight
  // from the public feed, and route/waypoint names that may have come from an imported file.
  const EXTERNAL_TEXT_TOOLS = new Set(['get_notams', 'describe_route', 'get_weather']);

  async function runToolGated(name, args) {
    const tool = TOOLS.find(x => x.name === name);
    // Anything that is not read-only needs consent. Refusals come back as a tool
    // error so the model explains itself instead of pretending the edit happened.
    // Fails CLOSED on a missing tier: the earlier `tool.tier &&` let a tool declared
    // without one skip the gate. Every tool carries a tier today, so this guards the
    // next one added rather than closing a live hole.
    if (tool && tool.tier !== 'read' && !allowMutation(name, args)) {
      return { error: 'declined: the pilot did not approve this change' };
    }
    try {
      const out = tool ? await tool.run(args || {}) : { error: 'unknown tool ' + name };
      // Read tools that return text from outside NavAid taint the context from here on.
      if (tool && tool.tier === 'read' && EXTERNAL_TEXT_TOOLS.has(name)) markTainted();
      return out;
    } catch (e) { return { error: String((e && e.message) || e) }; }
  }

  async function runAgent(userText) {
    if (busy) return;
    busy = true;
    // Remember where this turn starts so a failed send can be fully rolled back.
    // Otherwise the pushed user turn (or a tool-response user turn) dangles, and
    // the next send appends a second consecutive user turn → Anthropic/OpenAI
    // 400 "roles must alternate", wedging the chat until Clear.
    const historyBase = messages.length;
    // A new turn is a new authorisation: consent never carries from one message to the next.
    approvedThisTurn.clear();
    messages.push({ role: 'user', parts: [{ text: userText }] });
    renderUser(userText);
    setBusy(true);
    try {
      let producedText = false, hitCap = true;
      for (let iter = 0; iter < MAX_ITERS; iter++) {
        const parts = await providerSend(messages);
        messages.push({ role: 'model', parts });
        const text = parts.filter(p => p && p.text).map(p => p.text).join('').trim();
        if (text) { renderAssistant(text); producedText = true; }
        const calls = parts.filter(p => p && p.functionCall).map(p => p.functionCall);
        if (!calls.length) { hitCap = false; break; }
        const responses = [];
        for (const call of calls) {
          renderActivity(call.name, call.args);
          const result = await runToolGated(call.name, call.args || {});
          // Gemini requires a non-empty functionResponse object; JSON.stringify
          // drops undefined values, so coerce to a serializable shape.
          const response = (result && typeof result === 'object') ? result : { result: result == null ? null : result };
          responses.push({ functionResponse: { name: call.name, response } });
        }
        messages.push({ role: 'user', parts: responses });
      }
      // Ran the whole tool budget without ever producing an answer — don't leave
      // the user staring at activity spinners with no result.
      if (hitCap && !producedText) renderError(t('assistantMaxSteps', 'Stopped after several steps without a final answer — try rephrasing.'));
    } catch (e) {
      messages.length = historyBase;   // discard the failed turn so history never ends on a dangling user turn
      renderError((e && e.message) === 'no-key'
        ? t('assistantNoKey', 'Add an API key in settings to start chatting.')
        : (t('assistantError', 'Assistant error') + ': ' + ((e && e.message) || e)));
      if ((e && e.message) === 'no-key') openSettings();
    } finally { busy = false; setBusy(false); }
  }

  function resetChat() {
    if (busy) return;   // don't wipe history mid-turn — it would corrupt the in-flight request
    messages = [];
    // The untrusted text went with the history, so the taint goes too.
    contextTainted = false;
    approvedThisTurn.clear();
    if (logEl) logEl.innerHTML = '';
  }

  // --- UI (built in JS; only the script tag lives in index.html) ------
  let fab, panel, logEl, inputEl, sendBtn, settingsEl, built = false;

  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // --- draggable + resizable panel (persisted like the inspector / clock) ---
  const PANELPOS = 'navaid.ai.panelPos';
  const PANELSIZE = 'navaid.ai.panelSize';
  let panelDrag = null;
  function restorePanelSize() {
    let s = null; try { s = JSON.parse(ls(PANELSIZE) || 'null'); } catch (e) { /* */ }
    if (s && s.w > 0 && s.h > 0) {
      panel.style.width = Math.min(s.w, window.innerWidth - 8) + 'px';
      panel.style.height = Math.min(s.h, window.innerHeight - 8) + 'px';
    }
  }
  function savePanelSize() {
    if (panel.classList.contains('hidden')) return;
    setLs(PANELSIZE, JSON.stringify({ w: Math.round(panel.offsetWidth), h: Math.round(panel.offsetHeight) }));
  }
  function clampPanel(x, y) {
    const w = panel.offsetWidth || 380, h = panel.offsetHeight || 200;
    const maxX = Math.max(0, window.innerWidth - w), maxY = Math.max(0, window.innerHeight - h);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  }
  function placePanel(x, y) {
    const c = clampPanel(x, y);
    // Switch from the corner-anchored default to absolute left/top.
    panel.style.insetInlineEnd = 'auto'; panel.style.insetBlockEnd = 'auto';
    panel.style.left = c.x + 'px'; panel.style.top = c.y + 'px';
  }
  function restorePanelPos() {
    let p = null; try { p = JSON.parse(ls(PANELPOS) || 'null'); } catch (e) { /* */ }
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) placePanel(p.x, p.y);
  }
  function wirePanelDrag(handle) {
    handle.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.assistant-icon-btn')) return;   // buttons aren't drag handles
      const r = panel.getBoundingClientRect();
      panelDrag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      try { handle.setPointerCapture(ev.pointerId); } catch (e) { /* */ }
      ev.preventDefault();
    });
    handle.addEventListener('pointermove', (ev) => {
      if (panelDrag) placePanel(ev.clientX - panelDrag.dx, ev.clientY - panelDrag.dy);
    });
    const end = (ev) => {
      if (!panelDrag) return;
      panelDrag = null;
      try { handle.releasePointerCapture(ev.pointerId); } catch (e) { /* */ }
      const r = panel.getBoundingClientRect();
      setLs(PANELPOS, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function build() {
    if (built) return; built = true;
    fab = el('button', 'assistant-fab'); fab.type = 'button';
    fab.textContent = '💬'; fab.title = t('assistantTitle', 'Flight plan assistant');
    fab.setAttribute('aria-label', t('assistantTitle', 'Flight plan assistant'));
    fab.onclick = toggle;

    panel = el('div', 'assistant-panel hidden');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('assistantTitle', 'Flight plan assistant'));
    panel.addEventListener('mouseup', savePanelSize);   // persist size after a resize-grabber drag
    // Escape closes the panel (accessibility) while focus is inside it.
    panel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); toggle(); } });
    const head = el('div', 'assistant-head');
    head.appendChild(el('span', 'assistant-title', t('assistantTitle', 'Flight plan assistant')));
    const iconBtn = (glyph, key, fb, fn) => {
      const b = el('button', 'assistant-icon-btn', glyph); b.type = 'button';
      b.title = t(key, fb); b.setAttribute('aria-label', t(key, fb)); b.onclick = fn; return b;
    };
    const gear = iconBtn('⚙', 'assistantSettings', 'Settings', toggleSettings);
    const clr = iconBtn('🗑', 'assistantClear', 'Clear chat', resetChat);
    const x = iconBtn('✕', 'assistantClose', 'Close', toggle);
    head.append(gear, clr, x);
    wirePanelDrag(head);   // drag the panel by its header

    logEl = el('div', 'assistant-log');

    settingsEl = buildSettings();

    const row = el('div', 'assistant-input-row');
    inputEl = el('textarea', 'assistant-input'); inputEl.rows = 2;
    inputEl.placeholder = t('assistantPlaceholder', 'Ask about NOTAMs, weather, or plan a route…');
    inputEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submit(); } });
    sendBtn = el('button', 'assistant-send', t('assistantSend', 'Send')); sendBtn.type = 'button'; sendBtn.onclick = submit;
    row.append(inputEl, sendBtn);

    panel.append(head, settingsEl, logEl, row);
    document.body.appendChild(panel);
    // Dock the launcher in the Leaflet bottom-right control column so it stacks
    // above the zoom buttons (spaced by Leaflet) instead of floating over the map
    // and covering controls/readouts. Prepend so it sits above zoom, not below.
    if (typeof L !== 'undefined' && L.Control && typeof map !== 'undefined' && map && map.addControl) {
      const wrap = el('div', 'leaflet-control assistant-fab-control');
      wrap.appendChild(fab);
      const Ctl = L.Control.extend({ options: { position: 'bottomright' }, onAdd: () => wrap });
      map.addControl(new Ctl());
      const corner = wrap.parentNode;   // the bottomright corner container
      if (corner && corner.firstChild !== wrap) corner.insertBefore(wrap, corner.firstChild);
    } else {
      fab.classList.add('assistant-fab-floating');
      document.body.appendChild(fab);
    }
  }

  function buildSettings() {
    const box = el('div', 'assistant-settings hidden');
    box.appendChild(el('div', 'assistant-settings-h', t('assistantSettings', 'Settings')));

    // Provider picker.
    const provSel = el('select', 'assistant-field');
    for (const id of ['gemini', 'anthropic', 'openrouter', 'deepseek', 'orcarouter']) {
      const opt = el('option', null, PROVIDERS[id].label + (id === 'gemini' ? ' — ' + t('assistantFreeTier', 'free tier') : ''));
      opt.value = id; provSel.appendChild(opt);
    }
    const keyIn = el('input', 'assistant-field'); keyIn.type = 'password'; keyIn.placeholder = t('assistantKeyPlaceholder', 'API key');
    const modelIn = el('input', 'assistant-field'); modelIn.type = 'text'; modelIn.placeholder = t('assistantModelPlaceholder', 'model');
    const baseIn = el('input', 'assistant-field'); baseIn.type = 'text'; baseIn.placeholder = t('assistantBaseUrlPlaceholder', 'Base URL (optional proxy)'); baseIn.value = '';
    const help = el('div', 'assistant-help');
    const link = el('a', null, ''); link.target = '_blank'; link.rel = 'noopener'; help.appendChild(link);
    const note = el('div', 'assistant-help assistant-note');

    // Reflect the selected provider's stored key/model + help link + notes.
    function syncProvider(id, loadStored) {
      const P = PROVIDERS[id];
      // The Base URL reloads with the provider exactly like the key and model do; leaving a
      // stale one in the form is how the wrong-endpoint bug reached the user in the first place.
      if (loadStored) {
        keyIn.value = ls(keyKey(id)) || '';
        modelIn.value = ls(modelKey(id)) || '';
        baseIn.value = ls(baseKey(id)) || '';
      }
      modelIn.placeholder = P.model;
      // The provider's own endpoint, shown the same way the model default is: an empty box
      // reads as "unset" when it actually means "use the provider's URL". Placeholder, not
      // value -- a filled-in value gets SAVED as a per-provider override, freezing the
      // endpoint at whatever shipped instead of following the provider entry.
      baseIn.placeholder = P.base || t('assistantBaseUrlPlaceholder', 'Base URL (optional proxy)');
      link.textContent = t('assistantGetKey', 'Get an API key') + ' — ' + P.label;
      link.href = P.keyUrl;
      baseIn.style.display = P.openaiCompat ? '' : 'none';   // proxy override for OpenAI-compatible providers
      note.textContent = P.browserBlocked
        ? t('assistantCorsNote', 'This provider may block direct browser calls (CORS) — if so, set a proxy base URL above.')
        : '';
      note.style.display = note.textContent ? '' : 'none';
    }
    provSel.value = activeProvider();
    syncProvider(provSel.value, true);
    provSel.onchange = () => syncProvider(provSel.value, true);

    const save = el('button', 'assistant-send', t('assistantSaveKey', 'Save')); save.type = 'button';
    save.onclick = () => {
      const id = provSel.value;
      setLs(PROV, id);
      setLs(keyKey(id), keyIn.value.trim() || null);
      setLs(modelKey(id), modelIn.value.trim() || null);
      if (PROVIDERS[id].openaiCompat) setLs(baseKey(id), baseIn.value.trim() || null);
      box.classList.add('hidden');
      toast(t('assistantKeySaved', 'Settings saved'));
    };
    box.append(provSel, keyIn, modelIn, baseIn, help, note, save);
    return box;
  }
  function hasKey() { return !!ls(keyKey(activeProvider())); }

  function toggleSettings() { settingsEl.classList.toggle('hidden'); }
  function openSettings() { build(); panel.classList.remove('hidden'); restorePanelSize(); restorePanelPos(); settingsEl.classList.remove('hidden'); }

  function toggle() {
    build();
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      restorePanelSize();  // apply saved size first so the position clamp uses real dims
      restorePanelPos();   // apply the saved drag position (needs the panel visible for sizing)
      if (!hasKey()) settingsEl.classList.remove('hidden');
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
  let _lastActivity = null;   // { name, el, count } — collapses repeated same-tool lines
  function renderActivity(name, args) {
    const notam = '🔎 ' + t('assistantActNotam', 'checking NOTAMs');
    const wx = '🌦 ' + t('assistantActWx', 'checking weather');
    const route = '🧭 ' + t('assistantActRoute', 'updating route');
    const save = '💾 ' + t('assistantActSave', 'saving route');
    const look = '🔎 ' + t('assistantActLookup', 'looking up');
    const label = ({
      get_notams: notam, get_weather: wx, save_route: save,
      set_route: route, reverse_route: route, set_leg: route,
      plan_corridor: route, apply_route_template: route,
      find_point: look, get_airfield_info: look, get_vor_radial: look,
      list_route_templates: look, describe_route: look,
    })[name] || ('· ' + name);
    // A tool called in a burst (e.g. find_point per waypoint) used to print one
    // identical line per call — collapse consecutive repeats into "label ×N".
    if (_lastActivity && _lastActivity.name === name && logEl &&
        _lastActivity.el === logEl.lastElementChild) {
      _lastActivity.count++;
      _lastActivity.el.textContent = label + ' ×' + _lastActivity.count + '…';
      logEl.scrollTop = logEl.scrollHeight;
      return;
    }
    // Single lookups show what's being looked up (e.g. "🔎 looking up: BKAMA…").
    const arg = args && typeof args.name === 'string' && args.name.trim()
      ? ': ' + args.name.trim() : '';
    _lastActivity = { name, el: addMsg('activity', label + arg + '…'), count: 1 };
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
    _tools: TOOLS,                 // raw tools — BYPASS the tier gate
    _runTool: runToolGated,        // the gated path the agent loop uses
    _resetConsent: () => {
      contextTainted = false; lastApproved = null; approvedThisTurn.clear();
    },
    // What a fresh user message does to consent, without going through a provider round-trip.
    _newTurn: () => { lastApproved = null; approvedThisTurn.clear(); },
    _reset: resetChat,
    _isTainted: () => contextTainted,
    _summarise: mutationSummary,
    _resolvePoint: resolvePoint,
    _corridorPath: corridorPath,
    _setProvider: (fn) => { providerSend = fn || geminiSend; },
    _setConfirm: (fn) => { confirmAction = fn || confirmAction; },
    _messages: () => messages,
  };

  // Retire the legacy single Base URL before anything can read it or send to it.
  migrateLegacyBaseUrl();

  // Build the FAB on load so it's discoverable; the panel stays hidden.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
