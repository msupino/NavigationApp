// offline-tiles.js — downloadable offline chart packs. Loaded after ui.js.
//
// "Download charts for offline" pre-fetches the current chart layer's tiles
// for the whole published chart extent (FM_BOUNDS, z OFFLINE_MIN..MAX) into a
// dedicated Cache Storage bucket. The tiles are FETCHED from the NavigationApp
// tile mirror (NAVAID_TILE_BASE, which serves CORS `*` — a cross-origin
// no-cors fetch would store opaque responses that Chrome quota-pads to ~7 MB
// each) but STORED under the live flight-maps.com tile URL, so the service
// worker can serve the map's normal tile requests cache-first offline
// (sw.js: OFFLINE_TILE_HOSTS branch). Packs survive service-worker upgrades
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
    const cur = chartLayer();
    if (!cur) return { error: 'not a chart layer' };
    const list = offlineTileList(TILE.chartBounds, zMin || OFFLINE_MIN_Z, zMax || OFFLINE_MAX_Z);
    // Ask the browser not to evict the pack under storage pressure.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* */ }
    const cache = await caches.open(TILE_CACHE);
    let done = 0, ok = 0, failed = 0;
    _running = true; _cancel = false;
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
    _running = false;
    return { ok, failed, cancelled: _cancel };
  }

  async function deletePack() {
    try { await caches.delete(TILE_CACHE); return true; } catch (e) { return false; }
  }

  async function packSize() {
    try {
      const cache = await caches.open(TILE_CACHE);
      return (await cache.keys()).length;
    } catch (e) { return 0; }
  }

  // --- UI (Extra layers section) ---------------------------------------
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

  // Test seam
  window.NavAidOfflineTiles = { offlineTileList, downloadPack, deletePack, packSize,
    TILE_CACHE, OFFLINE_MIN_Z, OFFLINE_MAX_Z };
}());
