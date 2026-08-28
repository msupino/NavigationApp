// offline-tiles.js — downloadable offline chart packs. Loaded after ui.js.
//
// "Download charts for offline" pre-fetches the current chart layer's tiles
// for the whole published chart extent (FM_BOUNDS, z OFFLINE_MIN..MAX) into a
// dedicated Cache Storage bucket. The tiles are FETCHED from the NavigationApp
// tile mirror (NAVAID_TILE_BASE, which serves CORS `*` — a cross-origin
// no-cors fetch would store opaque responses that Chrome quota-pads to ~7 MB
// each) but STORED under the live flight-maps.com tile URL, so the service
// worker can serve the map's normal tile requests cache-first offline
// (sw.js: the url.host === TILE_HOST tile branch). Packs survive SW upgrades
// (sw.js activate exempts the tile cache from cleanup).
(function () {
  'use strict';

  const TILE_CACHE = 'navaid-tiles-v1';
  const OFFLINE_MIN_Z = 7;
  const OFFLINE_MAX_Z = 13;      // charts' maxNativeZoom — full native detail
  const CONCURRENCY = 8;
  const AVG_TILE_KB = 14;        // for the size estimate shown before download

  // Slippy-map tile coordinates covering `bounds` at zoom levels zMin..zMax.
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
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
    }
    return out;
  }

  function chartLayer() {
    // The active base layer, only if it is a chart with a CORS mirror.
    for (const name in layers) {
      if (map.hasLayer(layers[name]) && layers[name].options && layers[name].options.exportUrl) {
        return { name, layer: layers[name] };
      }
    }
    return null;
  }

  let _running = false;
  let _cancel = false;

  async function downloadPack(onProgress, zMin, zMax) {   // zMin/zMax: test seam
    if (_running) return { error: 'busy' };
    const cur = chartLayer();
    if (!cur) return { error: 'not a chart layer' };
    // Set the re-entrancy guard SYNCHRONOUSLY (before the first await) so a
    // second tap during caches.open() cancels this run instead of starting a
    // concurrent one that would double the bandwidth and share _cancel.
    _running = true; _cancel = false;
    let done = 0, ok = 0, failed = 0;
    try {
      // Inside the try so a throw here (e.g. TILE.chartBounds unavailable) still
      // hits the finally and resets _running — otherwise downloadPack would be
      // stuck 'busy' forever.
      const list = offlineTileList(TILE.chartBounds, zMin || OFFLINE_MIN_Z, zMax || OFFLINE_MAX_Z);
      // Ask the browser not to evict the pack under storage pressure.
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* */ }
      const cache = await caches.open(TILE_CACHE);
      const worker = async () => {
        while (list.length && !_cancel) {
          const c = list.pop();
          const liveUrl = tileLayerUrl(cur.layer, c);
          const mirrorUrl = exportTileLayerUrl(cur.layer, c);
          try {
            const hit = await cache.match(liveUrl);
            if (!hit) {
              const r = await fetch(mirrorUrl, { mode: 'cors' });
              if (r.ok) { await cache.put(liveUrl, r); ok++; }
              else failed++;               // 404 = outside coverage (sea) — fine
            } else ok++;
          } catch (e) { failed++; }
          done++;
          if (done % 25 === 0 || !list.length) onProgress(done, done + list.length, ok);
        }
      };
      const workers = []; for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
      await Promise.all(workers);
      return { ok, failed, cancelled: _cancel };
    } finally {
      _running = false;
      // Never leave an EMPTY bucket behind (cancelled before any tile stored, or
      // every fetch failed offline): an empty cache still flips the SW's
      // tilePackReady on — reintroducing per-tile proxy overhead with zero
      // offline benefit — and packSize()===0 keeps the Delete button hidden,
      // stranding the user in proxy mode. A non-empty (partial) pack is kept.
      try {
        const c = await caches.open(TILE_CACHE);
        if ((await c.keys()).length === 0) await caches.delete(TILE_CACHE);
      } catch (e) { /* */ }
      notifySw();   // reflect real state: pack exists, or was cleaned up
    }
  }

  // --- the floor -------------------------------------------------------------
  // The pack above is something a pilot chooses to download. This is the part that happens
  // whether or not anyone remembered: a small en-route map of the whole country, refetched
  // quietly on load, so "the map was blank in the air" needs someone to have both forgotten
  // AND been offline at the desk.
  //
  // Small on purpose. z7-10 over the published chart extent is ~300 tiles, about 4 MB. The
  // full z7-13 pack is ~14,600 tiles and ~200 MB, which is not something to start on someone
  // else's data plan without being asked -- so the deep zooms stay behind the button.
  //
  // It also repairs itself, which matters more than it sounds: Safari evicts site data after
  // about a week of not being used, and does not honour storage.persist(). A pack downloaded
  // before one flight can simply be gone before the next, with nothing said. A floor that is
  // refetched every load turns that from a silent loss into a few seconds of wifi.
  const FLOOR_CONCURRENCY = 4;
  let _floorRun = null;

  function floorWanted() {
    if (typeof tune !== 'function') return false;
    if (tune('offlineAutoFloor') !== true) return false;
    // Not on someone's data plan. 4 MB is small, but "small" is not ours to decide for a
    // pilot roaming abroad or on a metered hotspot.
    if (tune('offlineFloorWifiOnly') === false) return true;
    try {
      const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!c) return true;                       // no way to ask: assume it is fine
      if (c.saveData) return false;              // Data Saver is an explicit "do not"
      return !/^(slow-2g|2g|3g)$/.test(c.effectiveType || '');
    } catch (e) { return true; }
  }

  // Returns what it did, so the caller (and a test) can tell "skipped" from "nothing to do".
  async function fetchFloor(opts) {
    const o = opts || {};
    if (_floorRun) return _floorRun;
    if (!o.force && !floorWanted()) return { skipped: 'metered-or-off' };
    const cur = chartLayer();
    if (!cur) return { skipped: 'no chart layer' };
    const zMin = Number(o.zMin != null ? o.zMin : (typeof tune === 'function' ? tune('offlineFloorMinZ') : 7));
    const zMax = Number(o.zMax != null ? o.zMax : (typeof tune === 'function' ? tune('offlineFloorMaxZ') : 10));
    if (!Number.isFinite(zMin) || !Number.isFinite(zMax) || zMin > zMax) return { skipped: 'bad range' };

    _floorRun = (async () => {
      let ok = 0, fetched = 0, failed = 0;
      try {
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* */ }
        const cache = await caches.open(TILE_CACHE);
        const list = offlineTileList(TILE.chartBounds, zMin, zMax);
        const worker = async () => {
          while (list.length) {
            const c = list.pop();
            const liveUrl = tileLayerUrl(cur.layer, c);
            try {
              // Already there: cost nothing on every load after the first.
              if (await cache.match(liveUrl)) { ok++; continue; }
              const r = await fetch(exportTileLayerUrl(cur.layer, c), { mode: 'cors' });
              if (r.ok) { await cache.put(liveUrl, r); ok++; fetched++; }
              else failed++;                  // 404 = sea, outside coverage
            } catch (e) { failed++; }         // offline at the desk: try again next load
          }
        };
        const workers = [];
        for (let i = 0; i < FLOOR_CONCURRENCY; i++) workers.push(worker());
        await Promise.all(workers);
        if (fetched) notifySw();
        return { ok, fetched, failed, zMin, zMax };
      } finally {
        _floorRun = null;
      }
    })();
    return _floorRun;
  }

  // After boot, and out of its way: the map painting is what the pilot is waiting for, and a
  // few hundred tile requests during it would be felt.
  function scheduleFloor() {
    const go = () => { fetchFloor().catch(() => { /* next load tries again */ }); };
    const idle = window.requestIdleCallback;
    if (idle) idle(go, { timeout: 8000 });
    else setTimeout(go, 4000);
  }

  // The SW skips tile proxying entirely while no pack exists (perf); tell it
  // to re-check after a download or delete.
  function notifySw() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'tile-pack-changed' });
      }
    } catch (e) { /* */ }
  }

  async function deletePack() {
    try { await caches.delete(TILE_CACHE); notifySw(); return true; } catch (e) { return false; }
  }

  async function packSize() {
    try {
      const cache = await caches.open(TILE_CACHE);
      return (await cache.keys()).length;
    } catch (e) { return 0; }
  }

  // --- UI (Charts section) ---------------------------------------------
  const t = (k, fb) => (window.S && S[k]) || fb;
  function wire() {
    const btn = document.getElementById('offline-tiles-btn');
    const delBtn = document.getElementById('offline-tiles-del');
    const status = document.getElementById('offline-tiles-status');
    const grp = document.getElementById('offline-tiles-group');
    if (!btn || !grp) return;

    const refresh = async () => {
      grp.hidden = !chartLayer();
      const n = await packSize();
      if (status && !_running) {
        status.textContent = n ? t('offlineTilesCount', 'offline tiles: ') + n : '';
      }
      if (delBtn) delBtn.hidden = !n;
    };

    btn.onclick = async () => {
      if (_running) { _cancel = true; return; }   // second tap = cancel
      const total = offlineTileList(TILE.chartBounds, OFFLINE_MIN_Z, OFFLINE_MAX_Z).length;
      const mb = Math.round(total * AVG_TILE_KB / 1024);
      const msg = (t('offlineDownloadConfirm', 'Download the current chart for offline use? About ') + mb + ' MB.');
      if (!confirm(msg)) return;
      const label = btn.textContent;
      const res = await downloadPack((done, totalN, okN) => {
        btn.textContent = t('offlineCancel', '✕ Cancel — ') + Math.round(done / totalN * 100) + '%';
        if (status) status.textContent = okN + '/' + totalN;
      });
      btn.textContent = label;
      // res.error (busy, or the base layer stopped being a chart mid-click) has
      // no ok/cancelled — don't render "saved undefined tiles".
      if (res.error) { refresh(); return; }
      if (status) {
        status.textContent = res.cancelled ? t('offlineCancelled', 'cancelled')
          : (t('offlineDone', 'saved ') + res.ok + ' tiles');
      }
      refresh();
    };
    if (delBtn) {
      delBtn.onclick = async () => {
        if (_running) return;
        if (!confirm(t('offlineDeleteConfirm', 'Delete the offline charts?'))) return;
        await deletePack();
        refresh();
      };
    }
    // Follow base-layer switches (chart layers only get the button).
    if (typeof map !== 'undefined' && map.on) map.on('layeradd', () => { refresh(); });
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  // ...and the floor, once the map has settled. Deliberately not inside wire(): the button
  // exists whether or not the floor is offered, and the floor runs whether or not the button
  // was ever pressed.
  if (document.readyState === 'complete') scheduleFloor();
  else window.addEventListener('load', scheduleFloor);

  // Test seam
  window.NavAidOfflineTiles = { offlineTileList, downloadPack, deletePack, packSize,
    fetchFloor, floorWanted, scheduleFloor,
    TILE_CACHE, OFFLINE_MIN_Z, OFFLINE_MAX_Z };
}());
