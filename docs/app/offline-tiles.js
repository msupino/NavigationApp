// offline-tiles.js — automatic, auditable CVFR offline coverage. Loaded after ui.js.
//
// CVFR is the chart used in flight. NavAid therefore maintains its complete published tile
// pyramid automatically instead of relying on a pilot to remember a preflight download. The
// toolbar stays to one status button; its dialog says exactly what is stored and whether every
// expected tile is present. Other base layers remain online-only.
(function () {
  'use strict';

  const TILE_CACHE = 'navaid-tiles-v1';
  const OFFLINE_MIN_Z = 7;
  const OFFLINE_MAX_Z = 13;
  const CONCURRENCY = 8;
  const EMPTY_PNG = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
    0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3,
    3, 2, 0, 239, 191, 219, 124, 0, 0, 0, 0, 73, 69, 78, 68, 174,
    66, 96, 130,
  ]);

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

  function cvfrPlan(zMin, zMax) {
    const cvfr = cvfrLayer();
    const range = zoomRange(zMin, zMax);
    if (!cvfr || !range) return [];
    return offlineTileList(TILE.chartBounds, range.min, range.max).map(coords => ({
      coords,
      liveUrl: tileLayerUrl(cvfr.layer, coords),
      fetchUrl: exportTileLayerUrl(cvfr.layer, coords),
    }));
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

  function percentage(present, total) {
    return total ? Math.floor(present / total * 100) : 0;
  }

  async function cvfrCoverage(zMin, zMax, options) {
    const plan = prioritizeRouteTiles(cvfrPlan(zMin, zMax), currentRouteWaypoints());
    if (!plan.length) return { error: 'no CVFR layer', present: 0, total: 0, percent: 0, complete: false };
    if (!(await caches.has(TILE_CACHE))) {
      return { name: 'CVFR', present: 0, total: plan.length, missing: plan.length,
        percent: 0, complete: false, zMin: plan[0].coords.z,
        zMax: plan[plan.length - 1].coords.z };
    }
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    const wanted = new Set(plan.map(item => item.liveUrl));
    if (options && options.pruneOtherLayers) {
      await Promise.all(keys.filter(key => !wanted.has(key.url)).map(key => cache.delete(key)));
    }
    const actualKeys = options && options.pruneOtherLayers ? await cache.keys() : keys;
    const actual = new Set(actualKeys.map(key => key.url));
    const present = plan.reduce((n, item) => n + (actual.has(item.liveUrl) ? 1 : 0), 0);
    return {
      name: 'CVFR', present, total: plan.length, missing: plan.length - present,
      percent: percentage(present, plan.length), complete: present === plan.length,
      zMin: plan[0].coords.z, zMax: plan[plan.length - 1].coords.z,
    };
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
      if (location.hostname !== 'navaid.supino.org') return false;
      const path = location.pathname || '/';
      return path.indexOf('/pr/') !== 0 && path.indexOf('/staging/') !== 0;
    } catch (e) { return false; }
  }

  let runningPromise = null;
  let lastReport = null;
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
    renderCompactStatus();
    renderManager();
  }

  async function downloadPack(onProgress, zMin, zMax) {
    if (runningPromise) return runningPromise;
    const progress = typeof onProgress === 'function' ? onProgress : function () {};
    const plan = cvfrPlan(zMin, zMax);
    if (!plan.length) return { error: 'no CVFR layer' };
    runningPromise = (async () => {
      try {
        try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* */ }
        const cache = await caches.open(TILE_CACHE);
        const existing = new Set((await cache.keys()).map(key => key.url));
        const wanted = new Set(plan.map(item => item.liveUrl));
        // Previous versions could download any selected chart into this shared bucket. CVFR is
        // now the documented offline layer, so remove those ambiguous leftovers.
        await Promise.all([...existing].filter(url => !wanted.has(url)).map(url => cache.delete(url)));
        const missing = plan.filter(item => !existing.has(item.liveUrl));
        let done = 0;
        let fetched = 0;
        let placeholders = 0;
        let failed = 0;
        let present = plan.length - missing.length;
        setReport({ name: 'CVFR', present, total: plan.length, missing: missing.length,
          percent: percentage(present, plan.length), complete: !missing.length, running: true });
        let nextMissing = 0;
        const worker = async () => {
          while (nextMissing < missing.length) {
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
              const report = { name: 'CVFR', present, total: plan.length,
                missing: plan.length - present, percent: percentage(present, plan.length),
                complete: present === plan.length, running: true };
              setReport(report);
              progress(done, missing.length, present);
            }
          }
        };
        const workers = [];
        for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
        await Promise.all(workers);
        notifySw();
        const report = await cvfrCoverage(zMin, zMax, { pruneOtherLayers: true });
        setReport(report);
        return { ok: report.present, failed, fetched, placeholders, complete: report.complete };
      } finally {
        runningPromise = null;
      }
    })();
    return runningPromise;
  }

  // Backward-compatible test/API name. It now means the complete CVFR pack, not whichever
  // base layer happens to be selected.
  async function fetchFloor(options) {
    const o = options || {};
    const range = zoomRange(o.zMin, o.zMax);
    if (!range) return { skipped: 'bad range' };
    if (!o.force && !automaticCvfrWanted()) return { skipped: 'connection-or-deployment' };
    const before = await cvfrCoverage(range.min, range.max, { pruneOtherLayers: true });
    if (before.complete) { setReport(before); return { ok: before.present, fetched: 0, failed: 0, complete: true }; }
    return downloadPack(o.onProgress, range.min, range.max);
  }

  async function deletePack() {
    suppressAutoThisSession = true;
    try {
      await caches.delete(TILE_CACHE);
      notifySw();
      setReport(await cvfrCoverage());
      return true;
    } catch (e) { return false; }
  }

  async function packSize() {
    try {
      if (!(await caches.has(TILE_CACHE))) return 0;
      return (await (await caches.open(TILE_CACHE)).keys()).length;
    }
    catch (e) { return 0; }
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

  function renderManager() {
    if (!manager) return;
    const report = lastReport;
    manager.state.textContent = report ?
      tf('offlineCvfrDetail', (present, total, p) => present + ' of ' + total + ' tiles · ' + p + '%',
        report.present, report.total, report.percent) :
      t('offlineCvfrChecking', 'Offline CVFR: checking…');
    manager.bar.style.width = (report ? report.percent : 0) + '%';
    const complete = !!(report && report.complete);
    manager.repair.hidden = complete;
    manager.repair.disabled = !!runningPromise;
    manager.clear.disabled = !!runningPromise || !(report && report.present);
  }

  function openManager() {
    if (manager) return;
    const back = document.createElement('div');
    back.className = 'modal-back offline-manager-back';
    const box = document.createElement('div');
    box.className = 'modal offline-manager-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = t('offlineManagerTitle', 'Offline maps');
    const close = () => { back.remove(); manager = null; };
    if (typeof addModalCloseX === 'function') addModalCloseX(box, close);
    const intro = document.createElement('p');
    intro.className = 'offline-manager-copy';
    intro.textContent = t('offlineManagerAutomatic', 'CVFR is kept automatically for the whole chart at zooms 7–13.');
    const online = document.createElement('p');
    online.className = 'offline-manager-copy offline-manager-online';
    online.textContent = t('offlineManagerOnlineOnly', 'Online only: Navigation, Low Alt, Helicopters, ATS, Satellite and OpenStreetMap.');
    const card = document.createElement('div');
    card.className = 'offline-manager-card';
    const layer = document.createElement('div');
    layer.className = 'offline-manager-layer'; layer.textContent = 'CVFR';
    const state = document.createElement('div');
    state.className = 'offline-manager-state';
    const track = document.createElement('div');
    track.className = 'offline-manager-progress';
    const bar = document.createElement('span'); track.appendChild(bar);
    const actions = document.createElement('div');
    actions.className = 'offline-manager-actions';
    const repair = document.createElement('button');
    repair.type = 'button'; repair.textContent = t('offlineCvfrRepair', 'Repair missing tiles');
    repair.title = t('offlineCvfrRepairTitle', 'Fetch only the missing CVFR tiles now');
    repair.onclick = () => { downloadPack().catch(() => {}); renderManager(); };
    const clear = document.createElement('button');
    clear.type = 'button'; clear.textContent = t('offlineDelete', 'Clear offline CVFR');
    clear.title = t('offlineDeleteTitle', 'Remove the downloaded CVFR chart from this device');
    clear.onclick = async () => {
      if (!confirm(t('offlineDeleteConfirm', 'Clear the offline CVFR chart from this device?'))) return;
      await deletePack();
    };
    actions.append(repair, clear);
    card.append(layer, state, track, actions);
    box.append(title, intro, card, online);
    back.appendChild(box);
    back.onclick = event => { if (event.target === back) close(); };
    document.body.appendChild(back);
    manager = { back, box, state, bar, repair, clear };
    renderManager();
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
    offlineTileList, cvfrPlan, routeTileDistanceSq, prioritizeRouteTiles,
    cvfrCoverage, connectionSuitable, automaticCvfrWanted,
    downloadPack, fetchFloor, deletePack, packSize, auditAndMaintain, scheduleAuto,
    TILE_CACHE, OFFLINE_MIN_Z, OFFLINE_MAX_Z,
  };
}());
