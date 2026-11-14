(function () {
  'use strict';
  const enabled = window.__navaidEmbedded === true;
  // Tiles live in 256 sub-folders, picked by a hash of the tile's URL. They used to share ONE
  // folder (navaid-tiles-v1), and listing it -- the store's keys(), on every launch and every
  // pack status -- came back from the native side as a single JSON string: ~37 MB for a pilot
  // with a few chart packs. Android builds that string in a 256 MB Java heap and ran out of
  // memory: the app closed (reported; ~30 OutOfMemoryErrors in FilesystemPlugin.readdir on one
  // phone). A sub-folder lists at 1/256 of that.
  const ROOT = 'navaid-tiles-v2';
  const OLD_ROOT = 'navaid-tiles-v1';
  const SHARDS = 256;
  const directory = 'LIBRARY_NO_CLOUD';
  const missing = error => error && (error.code === 'OS-PLUG-FILE-0008' || /does not exist/i.test(error.message));
  const keyUrl = key => typeof key === 'string' ? key : key.url;
  // FNV-1a: stable, fast, and spreads tile URLs (which differ only in their last digits) evenly.
  function shardOf(url) {
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ((h >>> 0) % SHARDS).toString(16).padStart(2, '0');
  }
  const filePath = key => { const u = keyUrl(key); return ROOT + '/' + shardOf(u) + '/' + encodeURIComponent(u); };
  const oldPath = key => OLD_ROOT + '/' + encodeURIComponent(keyUrl(key));
  const shardNames = () => Array.from({ length: SHARDS }, (_, i) => i.toString(16).padStart(2, '0'));

  function filesystem() {
    const fs = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (!fs) throw new Error('Native offline charts require the Filesystem plugin');
    return fs;
  }

  async function readData(url) {
    try { return (await filesystem().readFile({ path: filePath(url), directory })).data; }
    catch (error) { if (!missing(error)) throw error; }
    // Not moved yet (see migrate): the map never loses a tile while the store is reorganised.
    if (migrated()) return null;
    try { return (await filesystem().readFile({ path: oldPath(url), directory })).data; }
    catch (error) { if (missing(error)) return null; throw error; }
  }

  async function exists(path) {
    try { await filesystem().stat({ path, directory }); return true; }
    catch (error) { if (missing(error)) return false; throw error; }
  }
  // Run `fn` over `items`, a few at a time: each is one small native call.
  async function pool(items, width, fn) {
    let next = 0;
    const lane = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
  }

  // --- moving the old one-folder store into the sub-folders, once ------------------------
  // The old folder is never listed (that listing is the crash). Instead every tile the app
  // knows it wants -- the pilot's packs, the automatic CVFR, the chart the APK carries -- is
  // moved by name, one small call each; a name that is not there is simply skipped. What is
  // left in the old folder afterwards is no pack's (the next prune would have deleted it), and
  // the folder goes in one native call. Until then reads fall back to it.
  const MIGRATED_KEY = 'navaid.tilesV2Migrated';
  const migrated = () => { try { return localStorage.getItem(MIGRATED_KEY) === '1'; } catch (e) { return false; } };
  let migration = null;
  function wantedUrls() {
    const o = window.NavAidOfflineTiles;
    const urls = new Set(o && typeof o.wantedTileUrls === 'function' ? o.wantedTileUrls() : []);
    if (bundled) for (const u of bundled.keys()) urls.add(u);
    return urls;
  }
  async function migrate() {
    if (!enabled || migrated()) return 0;
    if (!(await exists(OLD_ROOT))) {
      try { localStorage.setItem(MIGRATED_KEY, '1'); } catch (e) { /* private */ }
      return 0;
    }
    await bundledReady;
    // The packs the pilot keeps are offline-tiles.js's to say; it loads later than this file.
    for (let i = 0; i < 120 && !window.NavAidOfflineTiles; i++) await new Promise(r => setTimeout(r, 500));
    await pool(shardNames(), 8, async shard => {
      try { await filesystem().mkdir({ path: ROOT + '/' + shard, directory, recursive: true }); }
      catch (error) { /* already there */ }
    });
    let moved = 0, stuck = 0;
    await pool([...wantedUrls()], 8, async url => {
      try {
        await filesystem().rename({ from: oldPath(url), to: filePath(url), directory, toDirectory: directory });
        moved++;
      } catch (error) {
        // Not in the old store: the common case, nothing to do.
        if (!(await exists(oldPath(url)))) return;
        // Already in the new store (downloaded again meanwhile): the new copy wins.
        if (await exists(filePath(url))) {
          try { await filesystem().deleteFile({ path: oldPath(url), directory }); } catch (_) { /* gone */ }
          return;
        }
        stuck++;                      // there, and would not move: keep it, try again next launch
      }
    });
    // Anything that would not move keeps the old folder -- and the reads that fall back to it --
    // until a later launch moves it. Deleting it would lose a pack the pilot downloaded.
    if (stuck) throw new Error(stuck + ' tiles would not move to the new store');
    try { await filesystem().rmdir({ path: OLD_ROOT, directory, recursive: true }); }
    catch (error) { if (!missing(error)) throw error; }
    try { localStorage.setItem(MIGRATED_KEY, '1'); } catch (e) { /* private */ }
    return moved;
  }
  // One move per launch, shared by everything that needs the store listed.
  // A move that fails is not retried in the same launch (it would be redone for every listing).
  const ready = () => migration || (migration = migrate().catch(error => {
    console.warn('Offline charts: the store move did not finish, retrying next launch:', error && error.message);
    return -1;
  }));

  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  const cache = {
    // Sub-folder by sub-folder: each listing is small. Never the whole store in one answer.
    async keys() {
      await ready();                // never throws: an unfinished move still lists the new store
      const out = [];
      await pool(shardNames(), 4, async shard => {
        try {
          const result = await filesystem().readdir({ path: ROOT + '/' + shard, directory });
          for (const file of result.files) {
            if (file.type === 'file') out.push({ url: decodeURIComponent(file.name) });
          }
        } catch (error) { if (!missing(error)) throw error; }
      });
      return out;
    },
    async put(key, response) {
      const data = await base64(await response.blob());
      await filesystem().writeFile({ path: filePath(key), directory, data, recursive: true });
    },
    async delete(key) {
      let gone = false;
      try { await filesystem().deleteFile({ path: filePath(key), directory }); gone = true; }
      catch (error) { if (!missing(error)) throw error; }
      if (!migrated()) {
        try { await filesystem().deleteFile({ path: oldPath(key), directory }); gone = true; }
        catch (error) { if (!missing(error)) throw error; }
      }
      return gone;
    },
  };
  const storage = {
    // Is anything stored? The folders' existence answers it without listing a single tile.
    async has() { return (await exists(ROOT)) || (!migrated() && (await exists(OLD_ROOT))); },
    async open() { return cache; },
    async delete() {
      let gone = false;
      for (const path of [ROOT, OLD_ROOT]) {
        try { await filesystem().rmdir({ path, directory, recursive: true }); gone = true; }
        catch (error) { if (!missing(error)) throw error; }
      }
      return gone;
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
    // A new APK with a new edition of the chart: its tiles replace the ones copied from the
    // last one. Otherwise tiles already there (downloaded, or copied by an interrupted launch)
    // are kept -- and any that are MISSING are put back, even when this edition was copied
    // before: a Clear offline CVFR (before it learned to keep them) or a storage clean-up took
    // them, and while the package is running they can still be copied out of it.
    const replace = before != null && before !== bundledId;
    const have = replace ? new Set() : new Set((await cache.keys()).map(k => k.url));
    if (!replace && before === bundledId && [...bundled.keys()].every(u => have.has(u))) return 0;
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

  window.NavAidNativeTiles = { enabled, storage, imageUrl, tileLayer, seedBundled, bundledSeeded, builtinTile, builtinZooms,
    migrate: ready, shardOf };
  // After the chart is up, not while it is being drawn: ~1,500 small file writes.
  if (enabled) {
    const later = () => setTimeout(() => { seedBundled().catch(() => {}); }, 20000);
    if (document.readyState === 'complete') later();
    else window.addEventListener('load', later);
  }
}());
