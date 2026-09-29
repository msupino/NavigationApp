(function () {
  'use strict';
  const enabled = window.__navaidEmbedded === true;
  const ROOT = 'navaid-tiles-v1';
  const directory = 'LIBRARY_NO_CLOUD';
  const missing = error => error && (error.code === 'OS-PLUG-FILE-0008' || /does not exist/i.test(error.message));
  const keyUrl = key => typeof key === 'string' ? key : key.url;
  const filePath = key => ROOT + '/' + encodeURIComponent(keyUrl(key));

  function filesystem() {
    const fs = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (!fs) throw new Error('Native offline charts require the Filesystem plugin');
    return fs;
  }

  async function readData(url) {
    try { return (await filesystem().readFile({ path: filePath(url), directory })).data; }
    catch (error) { if (missing(error)) return null; throw error; }
  }

  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  const cache = {
    async keys() {
      try {
        const result = await filesystem().readdir({ path: ROOT, directory });
        return result.files.filter(file => file.type === 'file').map(file => ({ url: decodeURIComponent(file.name) }));
      } catch (error) { if (missing(error)) return []; throw error; }
    },
    async put(key, response) {
      const data = await base64(await response.blob());
      await filesystem().writeFile({ path: filePath(key), directory, data, recursive: true });
    },
    async delete(key) {
      try { await filesystem().deleteFile({ path: filePath(key), directory }); return true; }
      catch (error) { if (missing(error)) return false; throw error; }
    },
  };
  const storage = {
    async has() { return (await cache.keys()).length > 0; },
    async open() { return cache; },
    async delete() {
      try { await filesystem().rmdir({ path: ROOT, directory, recursive: true }); return true; }
      catch (error) { if (missing(error)) return false; throw error; }
    },
  };

  // The CVFR chart the APK carries (mobile/scripts/bundle-charts.mjs): z7-z12, in the package
  // at charts/cvfr/. Shown straight from there, and copied once into the store above -- the
  // one the offline download fills -- because an update bundle replaces the package's web
  // files and the copy is what outlives it. Absent from the web app and from update bundles:
  // the index is simply not there, and none of this does anything.
  const BUNDLED_INDEX = 'charts/cvfr/index.json';
  const SEEDED_KEY = 'navaid.bundledChartsSeeded';
  // A copy that could not finish (storage full) is not waited for again: an update would take
  // away the packed tiles not copied, but a phone that can never update is worse, and every one
  // of those tiles can still be downloaded.
  const SEED_FAILED_KEY = 'navaid.bundledChartsSeedFailed';
  // Which tiles came with the APK (chart, zooms), remembered on the device: after an update the
  // package's own files are out of reach, and Clear offline CVFR must still know which of the
  // stored tiles are the built-in chart it keeps.
  const BUILTIN_KEY = 'navaid.bundledCharts';
  let bundled = null;                 // Map: mirror URL -> packaged path
  let bundledId = '';                 // which chart edition the APK carries (index.json `id`)
  const bundledReady = !enabled ? Promise.resolve() : fetch(BUNDLED_INDEX)
    .then(res => (res.ok ? res.json() : null))
    .then(index => {
      if (!index || !Array.isArray(index.tiles)) return;
      bundled = new Map(index.tiles.map(t => [index.base + '/' + t + '.png', 'charts/cvfr/' + t + '.png']));
      bundledId = String(index.id || index.tiles.length);
      try {
        localStorage.setItem(BUILTIN_KEY, JSON.stringify({
          chart: index.chart || 'CVFR', base: index.base, minZoom: index.minZoom, maxZoom: index.maxZoom }));
      } catch (e) { /* private */ }
    })
    .catch(() => {});
  const seededId = () => { try { return localStorage.getItem(SEEDED_KEY); } catch (e) { return null; } };

  // Nothing packed (the web app, an update bundle), or packed and already copied.
  const seedFailedId = () => { try { return localStorage.getItem(SEED_FAILED_KEY); } catch (e) { return null; } };
  async function bundledSeeded() {
    await bundledReady;
    return !bundled || !bundled.size || seededId() === bundledId || seedFailedId() === bundledId;
  }

  async function seedBundled() {
    await bundledReady;
    if (!bundled || !bundled.size) return 0;
    const before = seededId();
    if (before === bundledId) return 0;
    // A new APK with a new edition of the chart: its tiles replace the ones copied from the
    // last one. Otherwise tiles already there (downloaded, or copied by an interrupted launch)
    // are kept.
    const replace = before != null && before !== bundledId;
    const have = replace ? new Set() : new Set((await cache.keys()).map(k => k.url));
    let copied = 0;
    for (const [url, local] of bundled) {
      if (have.has(url)) continue;
      try {
        const res = await fetch(local);
        if (!res.ok) continue;
        await cache.put(url, res);
        copied++;
      } catch (e) {
        // Storage full, or the app closing: carry on next launch -- but say so, so the update
        // gate stops waiting on a copy that may never finish.
        try { localStorage.setItem(SEED_FAILED_KEY, bundledId); } catch (_) { /* private */ }
        return copied;
      }
    }
    try { localStorage.setItem(SEEDED_KEY, bundledId); } catch (e) { /* private */ }
    return copied;
  }

  async function imageUrl(url) {
    // Only hosts an offline pack can hold: every chart on our mirror, and open flightmaps. Any
    // other host (Satellite, OpenStreetMap) goes straight to the network without a file read.
    if (!enabled || !/^https:\/\/(navaid-tiles\.supino\.org\/|nwy-tiles-api\.prod\.newaydata\.com\/)/.test(url)) return url;
    try {
      const data = await readData(url);
      if (data) return 'data:image/png;base64,' + data;
    } catch (error) { /* fall through */ }
    await bundledReady;
    return (bundled && bundled.get(url)) || url;
  }

  let NativeTileLayer;
  function tileLayer(url, options) {
    if (!enabled) return L.tileLayer(url, options);
    if (!NativeTileLayer) {
      NativeTileLayer = L.TileLayer.extend({
        createTile(coords, done) {
          const tile = document.createElement('img');
          tile.alt = '';
          tile.setAttribute('role', 'presentation');
          if (this.options.crossOrigin) tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
          if (this.options.referrerPolicy) tile.referrerPolicy = this.options.referrerPolicy;
          tile.onload = () => done(null, tile);
          tile.onerror = error => {
            tile.onerror = null;
            tile.onload = null;
            if (this.options.errorTileUrl) tile.src = this.options.errorTileUrl;
            done(error, tile);
          };
          imageUrl(this.getTileUrl(coords)).then(src => {
            if (!tile._navaidUnloaded) tile.src = src;
          });
          return tile;
        },
      });
      NativeTileLayer.addInitHook(function () {
        this.on('tileunload', event => {
          event.tile._navaidUnloaded = true;
          event.tile.onload = null;
          event.tile.onerror = null;
        });
      });
    }
    return new NativeTileLayer(url, options);
  }

  // Is this stored tile part of the chart the APK carries? Clear offline CVFR keeps those: the
  // built-in chart is the offline floor, and once the app has taken an update it cannot be
  // copied out of the package again.
  // Not recorded (an app already running an update when this was added never saw the package's
  // index): what every APK since 1.9 has carried, CVFR 7-12 (mobile/scripts/bundle-charts.mjs).
  // Keeping those on a clear is harmless even where they were downloaded: the same chart.
  const BUILTIN_DEFAULT = { chart: 'CVFR', base: 'https://navaid-tiles.supino.org/CVFR', minZoom: 7, maxZoom: 12 };
  function builtinRecord() {
    try { return JSON.parse(localStorage.getItem(BUILTIN_KEY) || 'null') || BUILTIN_DEFAULT; } catch (e) { return BUILTIN_DEFAULT; }
  }
  function builtinTile(url) {
    if (!enabled) return false;
    const b = builtinRecord();
    if (!b || !b.base || typeof url !== 'string' || url.indexOf(b.base + '/') !== 0) return false;
    const z = Number(url.slice(b.base.length + 1).split('/')[0]);
    return Number.isFinite(z) && z >= b.minZoom && z <= b.maxZoom;
  }
  function builtinZooms() {
    if (!enabled) return null;
    const b = builtinRecord();
    return b && Number.isFinite(b.minZoom) && Number.isFinite(b.maxZoom) ? { min: b.minZoom, max: b.maxZoom } : null;
  }

  window.NavAidNativeTiles = { enabled, storage, imageUrl, tileLayer, seedBundled, bundledSeeded, builtinTile, builtinZooms };
  // After the chart is up, not while it is being drawn: ~1,500 small file writes.
  if (enabled) {
    const later = () => setTimeout(() => { seedBundled().catch(() => {}); }, 20000);
    if (document.readyState === 'complete') later();
    else window.addEventListener('load', later);
  }
}());
