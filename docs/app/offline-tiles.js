// offline-tiles.js — offline map packs. Loaded after ui.js.
//
// CVFR is the chart used in flight, so NavAid keeps its complete published tile pyramid
// automatically instead of relying on a pilot to remember a preflight download. The other
// charts are the pilot's choice, as many as they like: the other Israeli charts whole
// (Navigation, Low Alt, Helicopters, and the ATS sheet, which is one image), and open
// flightmaps by area -- it covers many countries, so a pack is the area that was on screen.
// Satellite and OpenStreetMap stay online-only: their providers do not allow downloading for
// offline use. The toolbar keeps one status button (about CVFR); its dialog lists every pack.
(function () {
  'use strict';

  const tileCaches = window.NavAidNativeTiles && NavAidNativeTiles.enabled ? NavAidNativeTiles.storage : window.caches;
  const TILE_CACHE = 'navaid-tiles-v1';
  const OFFLINE_MIN_Z = 7;
  const OFFLINE_MAX_Z = 13;
  const CONCURRENCY = 8;
  // 1x1, alpha 0: what an outside-the-sheet cell is stored as. (It used to be opaque white.)
  const EMPTY_PNG = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
    0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 96, 96, 0, 0, 0,
    3, 0, 1, 43, 9, 77, 132, 0, 0, 0, 0, 73, 69, 78, 68, 174,
    66, 96, 130,
  ]);
  // Whole-chart packs the pilot can add, beside the automatic CVFR one. Each covers the
  // Israeli charts' frame, like CVFR.
  const WHOLE_CHARTS = ['Navigation', 'Low Alt', 'Helicopters'];
  // Area packs: a chart with no fixed frame, downloaded for the area on screen.
  const AREA_LAYERS = ['OpenFlightMaps'];
  // From a continent's-eye view down to the detail level the pilot picks: most of Europe fits
  // to z10 in about a gigabyte, z12 would be fourteen.
  const AREA_MIN_Z = 5;
  const AREA_MAX_Z = 12;
  const AREA_DETAIL_ZOOMS = [8, 9, 10, 11, 12];
  // A detail level bigger than this is offered dimmed, with its size, rather than started.
  const AREA_TILE_LIMIT = 80000;
  // For the size shown beside each detail level: open flightmaps' tiles average about this
  // over land and sea together (a land tile is ~60 kB, a sea tile ~1 kB).
  const AVG_TILE_KB = 40;
  const PACKS_KEY = 'navaid.offlinePacks';

  function offlineTileList(bounds, zMin, zMax) {
    const out = [];
    const yFrac = lat => {
      const r = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
    };
    for (let z = zMin; z <= zMax; z++) {
      const n = Math.pow(2, z);
      const x0 = Math.max(0, Math.floor((bounds.west + 180) / 360 * n));
      const x1 = Math.min(n - 1, Math.floor((bounds.east + 180) / 360 * n));
      const y0 = Math.max(0, Math.floor(yFrac(bounds.north) * n));
      const y1 = Math.min(n - 1, Math.floor(yFrac(bounds.south) * n));
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) out.push({ z, x, y });
      }
    }
    return out;
  }

  // How many tiles offlineTileList would list, without listing them: the dialog asks on every
  // pan, and over Europe the list is hundreds of thousands long.
  function offlineTileCount(bounds, zMin, zMax) {
    const yFrac = lat => {
      const r = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
    };
    let n = 0;
    for (let z = zMin; z <= zMax; z++) {
      const k = Math.pow(2, z);
      const x0 = Math.max(0, Math.floor((bounds.west + 180) / 360 * k));
      const x1 = Math.min(k - 1, Math.floor((bounds.east + 180) / 360 * k));
      const y0 = Math.max(0, Math.floor(yFrac(bounds.north) * k));
      const y1 = Math.min(k - 1, Math.floor(yFrac(bounds.south) * k));
      if (x1 >= x0 && y1 >= y0) n += (x1 - x0 + 1) * (y1 - y0 + 1);
    }
    return n;
  }

  function layerNamed(name) {
    const layer = typeof layers !== 'undefined' && layers[name];
    return layer && layer.options ? layer : null;
  }
  // A tile chart can be packed when the page can read its tiles: our CORS mirror (exportUrl)
  // for the Israeli charts, or a host that serves CORS itself (open flightmaps).
  function packableTileLayer(name) {
    const layer = layerNamed(name);
    if (!layer || !layer._url) return null;
    return layer.options.exportUrl || layer.options.corsOk ? layer : null;
  }
  function cvfrLayer() {
    const layer = typeof layers !== 'undefined' && layers.CVFR;
    if (!layer || !layer.options || !layer.options.exportUrl) return null;
    return { name: 'CVFR', layer };
  }

  function zoomRange(zMin, zMax) {
    const min = Number(zMin != null ? zMin :
      (typeof tune === 'function' ? tune('offlineCvfrMinZoom') : OFFLINE_MIN_Z));
    const max = Number(zMax != null ? zMax :
      (typeof tune === 'function' ? tune('offlineCvfrMaxZoom') : OFFLINE_MAX_Z));
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
    return { min, max };
  }

  function tilePlan(layer, bounds, zMin, zMax) {
    // Never past what the chart publishes: above it Leaflet scales the last level up.
    const top = Number.isFinite(layer.options.maxNativeZoom) ? Math.min(zMax, layer.options.maxNativeZoom) : zMax;
    return offlineTileList(bounds, zMin, top).map(coords => ({
      coords,
      liveUrl: tileLayerUrl(layer, coords),
      fetchUrl: exportTileLayerUrl(layer, coords),
    }));
  }
  function chartPlan(name, zMin, zMax) {
    const layer = packableTileLayer(name);
    const range = zoomRange(zMin, zMax);
    if (!layer || !range) return [];
    return tilePlan(layer, TILE.chartBounds, range.min, range.max);
  }
  function chartTileCount(name) {
    const layer = packableTileLayer(name);
    const range = zoomRange();
    if (!layer || !range) return 0;
    const top = Number.isFinite(layer.options.maxNativeZoom) ? Math.min(range.max, layer.options.maxNativeZoom) : range.max;
    return offlineTileCount(TILE.chartBounds, range.min, top);
  }
  function cvfrPlan(zMin, zMax) {
    return cvfrLayer() ? chartPlan('CVFR', zMin, zMax) : [];
  }
  function areaPlan(area) {
    const layer = area && packableTileLayer(area.layer);
    if (!layer || !area.bounds) return [];
    return tilePlan(layer, area.bounds, AREA_MIN_Z, Number.isFinite(area.maxZ) ? area.maxZ : AREA_MAX_Z);
  }

  // ---- which packs the pilot has chosen (this device only) -------------------------
  function readPacks() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PACKS_KEY) || 'null'); } catch (e) { p = null; }
    const charts = p && Array.isArray(p.charts) ? p.charts.filter(n => WHOLE_CHARTS.includes(n) || n === 'ATS') : [];
    const areas = p && Array.isArray(p.areas) ? p.areas.filter(a => a && a.id && AREA_LAYERS.includes(a.layer)
      && a.bounds && ['north', 'south', 'east', 'west'].every(k => Number.isFinite(a.bounds[k]))) : [];
    return { charts, areas };
  }
  function writePacks(p) {
    try { localStorage.setItem(PACKS_KEY, JSON.stringify({ charts: p.charts, areas: p.areas })); } catch (e) { /* */ }
  }
  function atsUrl() {
    const l = layerNamed('ATS');
    return l && l._url ? new URL(l._url, document.baseURI).href : null;
  }
  // Every tile URL some pack still wants. Pruning keeps exactly these, so deleting one pack
  // never takes a tile another pack shares.
  function wantedTileUrls() {
    const packs = readPacks();
    const urls = new Set(cvfrPlan().map(i => i.liveUrl));
    for (const name of packs.charts) {
      if (name !== 'ATS') for (const i of chartPlan(name)) urls.add(i.liveUrl);
    }
    for (const area of packs.areas) for (const i of areaPlan(area)) urls.add(i.liveUrl);
    return urls;
  }

  function routeTilePoint(waypoint, zoom) {
    const lat = Math.max(-85.05112878, Math.min(85.05112878, Number(waypoint.lat)));
    const lng = Number(waypoint.lng);
    const n = Math.pow(2, zoom);
    const r = lat * Math.PI / 180;
    return {
      x: (lng + 180) / 360 * n,
      y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n,
    };
  }

  function pointSegmentDistanceSq(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (!dx && !dy) return Math.pow(point.x - a.x, 2) + Math.pow(point.y - a.y, 2);
    const t = Math.max(0, Math.min(1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    const x = a.x + t * dx;
    const y = a.y + t * dy;
    return Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2);
  }

  function routeTileDistanceSq(coords, waypoints) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) return Infinity;
    const center = { x: coords.x + 0.5, y: coords.y + 0.5 };
    const points = waypoints.map(waypoint => routeTilePoint(waypoint, coords.z));
    let best = Infinity;
    for (let i = 1; i < points.length; i++) {
      best = Math.min(best, pointSegmentDistanceSq(center, points[i - 1], points[i]));
    }
    return best;
  }

  // Download a one-tile corridor around the route before the rest of the country. Preserve the
  // normal low-to-high zoom order inside each group, so every useful route scale becomes
  // available progressively. The complete CVFR plan is unchanged; only its queue order moves.
  function prioritizeRouteTiles(plan, waypoints) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) return plan.slice();
    const corridorDistanceSq = 2.25; // 1.5 tiles from the route centreline
    return plan.map((item, index) => ({ item, index,
      routeFirst: routeTileDistanceSq(item.coords, waypoints) <= corridorDistanceSq }))
      .sort((a, b) => Number(b.routeFirst) - Number(a.routeFirst) || a.index - b.index)
      .map(entry => entry.item);
  }

  function currentRouteWaypoints() {
    try {
      return typeof state !== 'undefined' && Array.isArray(state.waypoints) ? state.waypoints : [];
    } catch (e) { return []; }
  }

  function routeFingerprint(waypoints) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) return '';
    return waypoints.map(waypoint => Number(waypoint.lat) + ',' + Number(waypoint.lng)).join(';');
  }

  function reprioritizeRemaining(queue, start, waypoints) {
    if (!Array.isArray(queue) || start >= queue.length) return queue;
    const ordered = prioritizeRouteTiles(queue.slice(start), waypoints);
    queue.splice.apply(queue, [start, queue.length - start].concat(ordered));
    return queue;
  }

  function percentage(present, total) {
    return total ? Math.floor(present / total * 100) : 0;
  }

  async function cacheUrlSet(prune) {
    if (!(await tileCaches.has(TILE_CACHE))) return null;
    const cache = await tileCaches.open(TILE_CACHE);
    if (prune) {
      const wanted = wantedTileUrls();
      const keys = await cache.keys();
      await Promise.all(keys.filter(key => !wanted.has(key.url)).map(key => cache.delete(key)));
    }
    return new Set((await cache.keys()).map(key => key.url));
  }
  function coverageOf(name, plan, actual) {
    const present = actual ? plan.reduce((n, item) => n + (actual.has(item.liveUrl) ? 1 : 0), 0) : 0;
    return {
      name, present, total: plan.length, missing: plan.length - present,
      percent: percentage(present, plan.length), complete: !!plan.length && present === plan.length,
      zMin: plan.length ? plan[0].coords.z : null, zMax: plan.length ? plan[plan.length - 1].coords.z : null,
    };
  }

  async function cvfrCoverage(zMin, zMax, options) {
    const plan = prioritizeRouteTiles(cvfrPlan(zMin, zMax), currentRouteWaypoints());
    if (!plan.length) return { error: 'no CVFR layer', present: 0, total: 0, percent: 0, complete: false };
    const actual = await cacheUrlSet(!!(options && options.pruneOtherLayers));
    return coverageOf('CVFR', plan, actual);
  }

  function connectionSuitable() {
    if (typeof tune === 'function' && tune('offlineCvfrUnmeteredOnly') === false) return true;
    try {
      const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!c) return true;
      if (c.saveData) return false;
      if (c.type && /^(cellular|bluetooth|wimax)$/.test(c.type)) return false;
      return !/^(slow-2g|2g|3g)$/.test(c.effectiveType || '');
    } catch (e) { return true; }
  }

  // Only the production app performs the large automatic transfer. PR previews, staging and
  // local tests share the production origin/cache or run repeatedly, so downloading there would
  // waste bandwidth and could make a preview mutate a pilot's real offline pack.
  function automaticCvfrWanted() {
    if (typeof tune === 'function' && tune('offlineAutoCvfr') !== true) return false;
    if (!connectionSuitable()) return false;
    try {
      if (window.NavAidNativeTiles && NavAidNativeTiles.enabled) return true;
      if (location.hostname !== 'navaid.supino.org') return false;
      const path = location.pathname || '/';
      return path.indexOf('/pr/') !== 0 && path.indexOf('/staging/') !== 0;
    } catch (e) { return false; }
  }

  let runningPromise = null;         // the CVFR download, for the API the tests and toolbar use
  let lastReport = null;             // CVFR's
  const reports = {};                // every pack's, by id ('CVFR', a chart name, 'ATS', an area id)
  const running = new Map();         // id -> the promise of its download in flight
  let manager = null;
  let suppressAutoThisSession = false;

  function emptyTileResponse() {
    return new Response(EMPTY_PNG.slice(), {
      status: 200,
      headers: { 'content-type': 'image/png', 'x-navaid-empty-chart-tile': '1' },
    });
  }

  function notifySw() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'tile-pack-changed' });
      }
    } catch (e) { /* service workers unavailable */ }
  }

  function setReport(report) {
    lastReport = report;
    reports.CVFR = report;
    renderCompactStatus();
    renderManager();
  }
  function setPackReport(id, report) {
    if (id === 'CVFR') { setReport(report); return; }
    reports[id] = report;
    renderManager();
  }

  // Fetch whatever of `plan` is missing into the pack bucket. Route-corridor first for CVFR,
  // which is the chart flown; the rest in plain low-to-high zoom order.
  async function fetchPlan(id, plan, onProgress, routeFirst) {
    const progress = typeof onProgress === 'function' ? onProgress : function () {};
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* */ }
    const cache = await tileCaches.open(TILE_CACHE);
    const existing = new Set((await cache.keys()).map(key => key.url));
    const missing = plan.filter(item => !existing.has(item.liveUrl));
    let done = 0;
    let fetched = 0;
    let placeholders = 0;
    let failed = 0;
    let present = plan.length - missing.length;
    const report = extra => Object.assign({ name: id, present, total: plan.length,
      missing: plan.length - present, percent: percentage(present, plan.length),
      complete: present === plan.length }, extra);
    setPackReport(id, report({ running: true }));
    let nextMissing = 0;
    let queuedRouteFingerprint = routeFingerprint(currentRouteWaypoints());
    const worker = async () => {
      while (nextMissing < missing.length) {
        if (routeFirst) {
          // A route can be created or edited while a long whole-country download is running.
          // Reorder only work that has not started; completed and in-flight requests are left
          // alone, while the new route corridor becomes the next work dispatched.
          const routeNow = currentRouteWaypoints();
          const fingerprintNow = routeFingerprint(routeNow);
          if (fingerprintNow !== queuedRouteFingerprint) {
            reprioritizeRemaining(missing, nextMissing, routeNow);
            queuedRouteFingerprint = fingerprintNow;
          }
        }
        const item = missing[nextMissing++];
        try {
          const response = await fetch(item.fetchUrl, { mode: 'cors' });
          if (response.ok) {
            await cache.put(item.liveUrl, response);
            fetched++; present++;
          } else if (response.status === 404) {
            // The rectangular chart bounds include sea/outside-sheet cells. A transparent
            // local tile makes that known absence complete and prevents futile retries.
            await cache.put(item.liveUrl, emptyTileResponse());
            placeholders++; present++;
          } else failed++;
        } catch (e) { failed++; }
        done++;
        if (done % 25 === 0 || done === missing.length) {
          setPackReport(id, report({ running: true }));
          progress(done, missing.length, present);
        }
      }
    };
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);
    notifySw();
    const final = report();
    setPackReport(id, final);
    return { ok: present, failed, fetched, placeholders, complete: final.complete };
  }

  // Start a pack's download now, beside any other. They used to queue one behind another,
  // and opening the dialog from the toolbar starts the whole-country CVFR download -- so an
  // area the pilot asked for sat behind fourteen thousand tiles, looking dead. Packs are on
  // different hosts or share HTTP/2 connections, so running them together costs little.
  // A second request for a pack already downloading gets the same download.
  function enqueue(id, job) {
    if (running.has(id)) return running.get(id);
    if (!reports[id] || !reports[id].total) reports[id] = { name: id, starting: true, present: 0, total: 0, percent: 0 };
    const p = Promise.resolve().then(job).finally(() => { running.delete(id); renderManager(); });
    running.set(id, p);
    renderManager();
    return p;
  }

  async function downloadPack(onProgress, zMin, zMax) {
    if (runningPromise) return runningPromise;
    const plan = cvfrPlan(zMin, zMax);
    if (!plan.length) return { error: 'no CVFR layer' };
    runningPromise = enqueue('CVFR', async () => {
      try {
        // Tiles no pack wants any more (a chart dropped, an older build's leftovers) go first.
        await cacheUrlSet(true);
        const result = await fetchPlan('CVFR', prioritizeRouteTiles(plan, currentRouteWaypoints()), onProgress, true);
        const report = await cvfrCoverage(zMin, zMax, { pruneOtherLayers: true });
        setReport(report);
        return Object.assign(result, { ok: report.present, complete: report.complete });
      } finally {
        runningPromise = null;
      }
    });
    return runningPromise;
  }

  // Backward-compatible test/API name. It means the complete CVFR pack.
  async function fetchFloor(options) {
    const o = options || {};
    const range = zoomRange(o.zMin, o.zMax);
    if (!range) return { skipped: 'bad range' };
    if (!o.force && !automaticCvfrWanted()) return { skipped: 'connection-or-deployment' };
    const before = await cvfrCoverage(range.min, range.max, { pruneOtherLayers: true });
    if (before.complete) { setReport(before); return { ok: before.present, fetched: 0, failed: 0, complete: true }; }
    return downloadPack(o.onProgress, range.min, range.max);
  }

  // Clear CVFR's tiles only: the other packs are the pilot's and stay.
  async function deletePack() {
    suppressAutoThisSession = true;
    try {
      if (await tileCaches.has(TILE_CACHE)) {
        const cache = await tileCaches.open(TILE_CACHE);
        const others = new Set();
        const packs = readPacks();
        for (const name of packs.charts) if (name !== 'ATS') for (const i of chartPlan(name)) others.add(i.liveUrl);
        for (const area of packs.areas) for (const i of areaPlan(area)) others.add(i.liveUrl);
        if (!others.size) {
          // Nothing else is kept: drop the whole store in one call.
          await tileCaches.delete(TILE_CACHE);
        } else {
          // Only the tiles actually stored, never the plan's: at zooms 7-13 the plan is 14,000
          // URLs, and in the APK each delete is a file-system call.
          const cvfr = new Set(cvfrPlan().map(i => i.liveUrl));
          const keys = await cache.keys();
          await Promise.all(keys.filter(k => cvfr.has(k.url) && !others.has(k.url)).map(k => cache.delete(k)));
        }
      }
      notifySw();
      setReport(await cvfrCoverage());
      return true;
    } catch (e) { return false; }
  }

  async function packSize() {
    try {
      if (!(await tileCaches.has(TILE_CACHE))) return 0;
      return (await (await tileCaches.open(TILE_CACHE)).keys()).length;
    }
    catch (e) { return 0; }
  }

  // ---- the pilot's packs ------------------------------------------------------------
  async function chartCoverage(name) {
    if (name === 'ATS') return atsCoverage();
    return coverageOf(name, chartPlan(name), await cacheUrlSet(false));
  }
  async function areaCoverage(area) {
    return coverageOf(area.id, areaPlan(area), await cacheUrlSet(false));
  }
  // The ATS sheet is one same-origin image: the service worker's app cache keeps it once it
  // has been fetched, so "downloading" it is fetching it. In the APK it ships in the bundle.
  async function atsCoverage() {
    const url = atsUrl();
    let hit = false;
    try { hit = !!(url && window.caches && await caches.match(url)); } catch (e) { hit = false; }
    return { name: 'ATS', present: hit ? 1 : 0, total: 1, missing: hit ? 0 : 1,
      percent: hit ? 100 : 0, complete: hit };
  }
  function downloadChart(name) {
    const packs = readPacks();
    if (!packs.charts.includes(name)) { packs.charts.push(name); writePacks(packs); }
    if (running.has(name)) return Promise.resolve(null);
    return enqueue(name, async () => {
      if (name === 'ATS') {
        const url = atsUrl();
        try { if (url) await fetch(url, { cache: 'reload' }); } catch (e) { /* offline: stays missing */ }
        const r = await atsCoverage();
        setPackReport('ATS', r);
        return r;
      }
      return fetchPlan(name, chartPlan(name), null, false);
    });
  }
  async function deleteChart(name) {
    const packs = readPacks();
    packs.charts = packs.charts.filter(n => n !== name);
    writePacks(packs);
    await cacheUrlSet(true);
    notifySw();
    setPackReport(name, name === 'ATS' ? await atsCoverage() : await chartCoverage(name));
  }

  // The area on screen, as a pack: its bounds, what each detail level would cost, and the
  // one chosen -- the pilot's pick if it fits, else the most detail that does.
  let areaDetailPick = null;
  function screenArea(layerName) {
    if (typeof map === 'undefined' || !map.getBounds) return null;
    const b = map.getBounds();
    const bounds = { north: Math.min(85, b.getNorth()), south: Math.max(-85, b.getSouth()),
      east: Math.min(180, b.getEast()), west: Math.max(-180, b.getWest()) };
    const layer = packableTileLayer(layerName);
    const top = layer && Number.isFinite(layer.options.maxNativeZoom) ? layer.options.maxNativeZoom : AREA_MAX_Z;
    const levels = AREA_DETAIL_ZOOMS.filter(z => z <= top).map(z => {
      const tiles = layer ? offlineTileCount(bounds, AREA_MIN_Z, z) : 0;
      return { z, tiles, fits: tiles <= AREA_TILE_LIMIT, mb: Math.round(tiles * AVG_TILE_KB / 1024) };
    });
    const fitting = levels.filter(l => l.fits);
    const pick = levels.find(l => l.z === areaDetailPick && l.fits) || fitting[fitting.length - 1] || null;
    const c = map.getCenter();
    const overIsrael = typeof layerHasNoDataHere === 'function' && layerHasNoDataHere(layerName, c);
    // Already kept: a saved area of this chart that holds the whole screen at least this
    // detailed. Pressing the button again used to save the same area again, once per press.
    const covered = !!pick && readPacks().areas.some(a => a.layer === layerName
      && (Number.isFinite(a.maxZ) ? a.maxZ : AREA_MAX_Z) >= pick.z
      && a.bounds.north >= bounds.north && a.bounds.south <= bounds.south
      && a.bounds.east >= bounds.east && a.bounds.west <= bounds.west);
    return { layer: layerName, bounds, levels, maxZ: pick ? pick.z : null, tiles: pick ? pick.tiles : 0,
      center: { lat: c.lat, lng: c.lng }, overIsrael, covered };
  }
  function downloadArea(layerName, maxZ) {
    if (Number.isFinite(maxZ)) areaDetailPick = maxZ;
    const a = screenArea(layerName);
    if (!a || !a.tiles || !a.maxZ || a.overIsrael || a.covered) return Promise.resolve(null);
    const packs = readPacks();
    const area = { id: 'area-' + Date.now().toString(36), layer: layerName, bounds: a.bounds,
      maxZ: a.maxZ, center: a.center, at: new Date().toISOString() };
    packs.areas.push(area);
    writePacks(packs);
    return enqueue(area.id, () => fetchPlan(area.id, areaPlan(area), null, false));
  }
  async function deleteArea(id) {
    const packs = readPacks();
    packs.areas = packs.areas.filter(a => a.id !== id);
    writePacks(packs);
    delete reports[id];
    await cacheUrlSet(true);
    notifySw();
    renderManager();
  }
  // Pick up where each chosen pack stands: shown in the dialog, and finished off on a suitable
  // connection by auditAndMaintain.
  async function refreshPackReports() {
    const packs = readPacks();
    for (const name of WHOLE_CHARTS.concat('ATS')) {
      if (!running.has(name)) reports[name] = await chartCoverage(name);
    }
    for (const area of packs.areas) if (!running.has(area.id)) reports[area.id] = await areaCoverage(area);
    renderManager();
    return packs;
  }

  const t = (key, fallback) => (window.S && S[key]) || fallback;
  function tf(key, fallback) {
    const value = t(key, fallback);
    const args = Array.prototype.slice.call(arguments, 2);
    return typeof value === 'function' ? value.apply(null, args) : value;
  }

  function compactText() {
    if (!lastReport) return t('offlineCvfrChecking', 'Offline CVFR: checking…');
    if (lastReport.complete) return t('offlineCvfrReady', 'Offline CVFR: ready ✓');
    if (lastReport.waiting) {
      return tf('offlineCvfrWaiting', p => 'Offline CVFR: ' + p + '% — waiting for connection', lastReport.percent);
    }
    return tf('offlineCvfrProgress', p => '⬇ Download CVFR offline — ' + p + '%', lastReport.percent);
  }

  function renderCompactStatus() {
    const button = document.getElementById('offline-tiles-btn');
    if (!button) return;
    button.textContent = compactText();
    button.classList.toggle('is-set', !!(lastReport && lastReport.complete));
  }

  const layerLabel = name => (window.S && S.layerLabels && S.layerLabels[name]) || name;
  // A pack's own words: not CVFR's "Offline CVFR: checking…" on an open flightmaps area.
  const detail = r => !r ? t('offlinePackChecking', 'Checking…')
    : r.starting ? t('offlinePackStarting', 'Starting download…')
    : tf('offlineCvfrDetail', (present, total, p) => present + ' of ' + total + ' tiles · ' + p + '%',
      r.present, r.total, r.percent);
  const offered = name => typeof layerOffered !== 'function' || layerOffered(name);

  function button(text, title, onClick, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (title) b.title = title;
    if (cls) b.className = cls;
    b.onclick = onClick;
    return b;
  }
  // Ask in the app, not with confirm(): a browser dialog is silent in the APK's WebView, so
  // the question would never be asked there. No way to ask means nothing is deleted.
  async function ask(text, ok) {
    try {
      return typeof window.askYesNo === 'function'
        ? !!await window.askYesNo(t('offlineManagerTitle', 'Offline maps'), text, ok)
        : false;
    } catch (e) { return false; }
  }

  function card(key, name) {
    const c = document.createElement('div');
    c.className = 'offline-manager-card';
    c.dataset.pack = key;
    const layer = document.createElement('div');
    layer.className = 'offline-manager-layer';
    layer.textContent = name;
    const state = document.createElement('div');
    state.className = 'offline-manager-state';
    const track = document.createElement('div');
    track.className = 'offline-manager-progress';
    const bar = document.createElement('span'); track.appendChild(bar);
    const actions = document.createElement('div');
    actions.className = 'offline-manager-actions';
    c.append(layer, state, track, actions);
    return { card: c, state, bar, actions, track };
  }
  function fill(parts, report) {
    parts.state.textContent = detail(report);
    parts.bar.style.width = (report ? report.percent : 0) + '%';
  }

  function renderManager() {
    if (!manager) return;
    const report = lastReport;
    fill(manager, report);
    if (!report) manager.state.textContent = t('offlineCvfrChecking', 'Offline CVFR: checking…');
    const complete = !!(report && report.complete);
    manager.repair.hidden = complete;
    manager.repair.disabled = !!runningPromise;
    manager.clear.disabled = !!runningPromise || !(report && report.present);
    renderPackCards();
  }

  // The chosen and choosable packs below the CVFR card, rebuilt on each change: a handful of
  // cards, and the area list changes shape as areas come and go.
  function renderPackCards() {
    if (!manager || !manager.packs) return;
    const host = manager.packs;
    host.textContent = '';
    const packs = readPacks();
    const native = !!(window.NavAidNativeTiles && NavAidNativeTiles.enabled);
    for (const name of WHOLE_CHARTS.concat('ATS')) {
      if (!offered(name) || (name === 'ATS' && native)) continue;
      if (name !== 'ATS' && !packableTileLayer(name)) continue;
      const parts = card(name, layerLabel(name));
      const chosen = packs.charts.includes(name);
      const r = reports[name];
      const busy = running.has(name);
      if (chosen || (r && r.present)) fill(parts, r);
      else {
        parts.state.textContent = name === 'ATS' ? t('offlinePackOneImage', 'One image')
          : tf('offlinePackTiles', n => n.toLocaleString() + ' tiles', chartTileCount(name));
        parts.track.hidden = true;
      }
      if (!chosen) {
        parts.actions.append(button(t('offlinePackDownload', '⬇ Download'),
          tf('offlinePackDownloadTitle', n => 'Keep ' + n + ' on this device for offline use', layerLabel(name)),
          () => { downloadChart(name).catch(() => {}); }));
      } else {
        if (!(r && r.complete)) {
          const b = button(t('offlinePackRepair', '⬇ Download missing tiles'), '',
            () => { downloadChart(name).catch(() => {}); });
          b.disabled = busy;
          parts.actions.append(b);
        }
        const del = button(t('offlinePackDelete', 'Delete'),
          tf('offlinePackDeleteTitle', n => 'Remove ' + n + ' from this device', layerLabel(name)),
          async () => {
            if (!await ask(tf('offlinePackDeleteConfirm', n => 'Remove ' + n + ' from this device?', layerLabel(name)),
              t('offlinePackDelete', 'Delete'))) return;
            await deleteChart(name);
          });
        del.disabled = busy;
        parts.actions.append(del);
      }
      host.appendChild(parts.card);
    }
    for (const layerName of AREA_LAYERS) {
      if (!offered(layerName) || !packableTileLayer(layerName)) continue;
      const box = document.createElement('div');
      box.className = 'offline-manager-card offline-manager-areas';
      box.dataset.pack = layerName;
      const title = document.createElement('div');
      title.className = 'offline-manager-layer';
      title.textContent = layerLabel(layerName);
      box.appendChild(title);
      const mine = packs.areas.filter(a => a.layer === layerName);
      for (const area of mine) {
        const parts = card(area.id, tf('offlineAreaName', (lat, lng) => 'Area around ' + lat + ', ' + lng,
          area.center ? area.center.lat.toFixed(2) : '?', area.center ? area.center.lng.toFixed(2) : '?'));
        parts.card.classList.add('offline-manager-area');
        const r = reports[area.id];
        fill(parts, r);
        const busy = running.has(area.id);
        if (r && !r.complete) {
          const b = button(t('offlinePackRepair', '⬇ Download missing tiles'), '', () => {
            enqueue(area.id, () => fetchPlan(area.id, areaPlan(area), null, false)).catch(() => {});
          });
          b.disabled = busy;
          parts.actions.append(b);
        }
        const del = button(t('offlinePackDelete', 'Delete'), '', async () => {
          if (!await ask(t('offlineAreaDeleteConfirm', 'Remove this area from this device?'), t('offlinePackDelete', 'Delete'))) return;
          await deleteArea(area.id);
        });
        del.disabled = busy;
        parts.actions.append(del);
        box.appendChild(parts.card);
      }
      const a = screenArea(layerName);
      // Dimmed, never removed, and it says why: over Israel there is nothing to download,
      // already kept there is nothing new, and too big there is too much even at the least detail.
      const why = !a ? '' : a.overIsrael ? t('layerNoDataOverIsrael', 'No data over Israel')
        : a.covered ? t('offlineAreaCovered', 'This area is already downloaded.')
        : !a.maxZ ? tf('offlineAreaTooBig', (n, max) => n.toLocaleString() + ' tiles: zoom in to under ' + max.toLocaleString(),
          a.levels.length ? a.levels[0].tiles : 0, AREA_TILE_LIMIT)
        : '';
      const size = mb => mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.max(1, mb) + ' MB';
      // How much detail: each level with its tile count and size, the ones over the cap dimmed.
      const detail = document.createElement('label');
      detail.className = 'offline-area-detail';
      const detailText = document.createElement('span');
      detailText.textContent = t('offlineAreaDetail', 'Detail');
      const pick = document.createElement('select');
      pick.className = 'offline-area-zoom';
      for (const l of (a ? a.levels : [])) {
        const o = document.createElement('option');
        o.value = String(l.z);
        o.textContent = tf('offlineAreaLevel', (z, n, sz) => 'up to zoom ' + z + ' · ' + n.toLocaleString() + ' tiles · ≈ ' + sz,
          l.z, l.tiles, size(l.mb));
        o.disabled = !l.fits;
        if (a.maxZ === l.z) o.selected = true;
        pick.appendChild(o);
      }
      pick.disabled = !!why && !a.covered;
      pick.onchange = () => { areaDetailPick = Number(pick.value); renderManager(); };
      detail.append(detailText, pick);
      const add = button(tf('offlineAreaDownload', n => '⬇ Download the area on screen (' + n.toLocaleString() + ' tiles)', a ? a.tiles : 0),
        why || t('offlineAreaDownloadTitle', 'Keep this chart for the area the map shows now'),
        () => { downloadArea(layerName, Number(pick.value)).catch(() => {}); }, 'offline-area-add');
      add.disabled = !!why;
      const row = document.createElement('div');
      row.className = 'offline-manager-actions';
      row.appendChild(add);
      box.append(detail, row);
      if (why) {
        const note = document.createElement('div');
        note.className = 'offline-manager-note';
        note.textContent = why;
        box.appendChild(note);
      }
      host.appendChild(box);
    }
  }

  function openManager() {
    // A stale guard must not lock the window shut. `manager` is cleared by close(), so any
    // path that takes the backdrop out WITHOUT calling it leaves this pointing at a node
    // that is no longer on the page -- and the button then does nothing for the rest of the
    // session. Ask the DOM, not the variable.
    if (manager && manager.back && manager.back.isConnected) return;
    manager = null;
    const back = document.createElement('div');
    back.className = 'modal-back offline-manager-back';
    const box = document.createElement('div');
    box.className = 'modal offline-manager-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.id = 'offline-manager-title';
    box.setAttribute('aria-labelledby', title.id);
    title.textContent = t('offlineManagerTitle', 'Offline maps');
    const close = () => {
      document.removeEventListener('keydown', onEsc, true);
      if (typeof map !== 'undefined' && map.off) map.off('moveend', renderManager);
      back.remove();
      manager = null;
    };
    // Escape, guarded on being the topmost backdrop so it cannot reach past a window opened
    // over this one -- the same shape the other modals in the app use. Publishing
    // _navaidClose below without this would be worse than not publishing it: the global
    // handler reads that property as "this modal handles its own Escape" and stands back.
    function onEsc(ev) {
      if (ev.key !== 'Escape') return;
      // A backdrop taken out WITHOUT close() -- the case the isConnected guard in
      // openManager() exists for -- leaves this listener behind. It must stand down, not act:
      // it runs in the capture phase and stops propagation, so an orphan swallowed every
      // Escape for the rest of the session and the global handler never deselected again.
      if (!back.isConnected) {
        document.removeEventListener('keydown', onEsc, true);
        return;
      }
      const backs = document.querySelectorAll('.modal-back');
      if (backs.length && backs[backs.length - 1] !== back) return;
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
    document.addEventListener('keydown', onEsc, true);
    // Every other modal publishes its own closer here, and the global Escape handler checks
    // for it: a backdrop WITHOUT one is removed with a bare back.remove(), which skips the
    // bookkeeping above. Escape therefore took this window off the screen while leaving the
    // guard set, and the button never opened it again.
    back._navaidClose = close;
    if (typeof addModalCloseX === 'function') addModalCloseX(box, close);
    const intro = document.createElement('p');
    intro.className = 'offline-manager-copy';
    intro.textContent = t('offlineManagerAutomatic', 'CVFR is kept automatically for the whole chart at zooms 7–13.');
    const cvfr = card('CVFR', 'CVFR');
    const repair = button(t('offlineCvfrRepair', 'Repair missing tiles'),
      t('offlineCvfrRepairTitle', 'Fetch only the missing CVFR tiles now'),
      () => { downloadPack().catch(() => {}); renderManager(); });
    const clear = button(t('offlineDelete', 'Clear offline CVFR'),
      t('offlineDeleteTitle', 'Remove the downloaded CVFR chart from this device'),
      async () => {
        if (!await ask(t('offlineDeleteConfirm', 'Clear the offline CVFR chart from this device?'),
          t('offlineDelete', 'Clear offline CVFR'))) return;
        await deletePack();
      });
    cvfr.actions.append(repair, clear);
    const more = document.createElement('p');
    more.className = 'offline-manager-copy';
    more.textContent = t('offlineManagerMore', 'Other charts, as many as you like:');
    const packs = document.createElement('div');
    packs.className = 'offline-manager-packs';
    const online = document.createElement('p');
    online.className = 'offline-manager-copy offline-manager-online';
    online.textContent = t('offlineManagerOnlineOnly',
      'Online only: Satellite and OpenStreetMap. Their providers do not allow downloading them for offline use.');
    box.append(title, intro, cvfr.card, more, packs, online);
    back.appendChild(box);
    back.onclick = event => { if (event.target === back) close(); };
    document.body.appendChild(back);
    manager = { back, box, state: cvfr.state, bar: cvfr.bar, repair, clear, packs };
    // The area button counts the tiles on screen, so it follows the map.
    if (typeof map !== 'undefined' && map.on) map.on('moveend', renderManager);
    renderManager();
    refreshPackReports().catch(() => {});
  }

  async function openManagerAndDownload() {
    openManager();
    const report = lastReport || await cvfrCoverage(undefined, undefined, { pruneOtherLayers: true });
    setReport(report);
    // An incomplete compact button is an explicit download action. This also gives PR/staging
    // users a way to exercise the feature even though large automatic transfers run only in
    // production. Once complete, the same button remains a read-only way into the details.
    if (!report.complete && !runningPromise) await downloadPack();
  }

  async function auditAndMaintain() {
    const report = await cvfrCoverage(undefined, undefined, { pruneOtherLayers: true });
    if (!automaticCvfrWanted() || suppressAutoThisSession) {
      if (!report.complete) report.waiting = !connectionSuitable();
      setReport(report);
      return report;
    }
    setReport(report);
    if (!report.complete) await downloadPack();
    // The pilot's own packs are finished off on the same terms: a download cut short by a
    // lost connection completes the next time there is a good one.
    const packs = await refreshPackReports();
    for (const name of packs.charts) {
      const r = reports[name];
      if (r && !r.complete) downloadChart(name).catch(() => {});
    }
    for (const area of packs.areas) {
      const r = reports[area.id];
      if (r && !r.complete && !running.has(area.id)) {
        enqueue(area.id, () => fetchPlan(area.id, areaPlan(area), null, false)).catch(() => {});
      }
    }
    return lastReport;
  }

  function wire() {
    const button = document.getElementById('offline-tiles-btn');
    if (!button) return;
    button.onclick = () => { openManagerAndDownload().catch(() => {}); };
    renderCompactStatus();
    cvfrCoverage(undefined, undefined, { pruneOtherLayers: true }).then(setReport).catch(() => {});
  }

  function scheduleAuto() {
    const go = () => { auditAndMaintain().catch(() => {}); };
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 8000 });
    else setTimeout(go, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  if (document.readyState === 'complete') scheduleAuto();
  else window.addEventListener('load', scheduleAuto);
  window.addEventListener('online', scheduleAuto);

  window.NavAidOfflineTiles = {
    offlineTileList, cvfrPlan, chartPlan, areaPlan, routeTileDistanceSq, prioritizeRouteTiles, reprioritizeRemaining,
    cvfrCoverage, chartCoverage, areaCoverage, connectionSuitable, automaticCvfrWanted,
    downloadPack, fetchFloor, deletePack, packSize, auditAndMaintain, scheduleAuto,
    downloadChart, deleteChart, downloadArea, deleteArea, screenArea, readPacks, wantedTileUrls, openManager,
    offlineTileCount, TILE_CACHE, OFFLINE_MIN_Z, OFFLINE_MAX_Z, AREA_TILE_LIMIT,
  };
}());
