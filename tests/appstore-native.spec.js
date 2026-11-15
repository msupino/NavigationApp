// @ts-check
const { test, expect } = require('./_setup');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function embedded(page, seed) {
  const files = new Map(seed || []);
  const dirs = new Set();
  const listings = [];
  files.listings = listings;
  await page.exposeBinding('nativeFiles', async (_, method, options) => {
    const p = options.path;
    if (method === 'writeFile') { files.set(p, options.data); return { uri: 'file:///' + p }; }
    if (method === 'readFile') {
      if (!files.has(p)) throw new Error('File does not exist');
      return { data: files.get(p) };
    }
    // As Android's: the folder's direct children only, sub-folders as 'directory'. Each answer is
    // recorded, so a test can see no listing ever carries the whole store.
    if (method === 'readdir') {
      const kids = new Map();
      for (const k of [...files.keys(), ...dirs]) {
        if (!k.startsWith(p + '/')) continue;
        const rest = k.slice(p.length + 1), cut = rest.indexOf('/');
        kids.set(cut < 0 ? rest : rest.slice(0, cut), cut < 0 && files.has(k) ? 'file' : 'directory');
      }
      if (!kids.size && !dirs.has(p)) throw new Error('Directory does not exist');
      const out = { files: [...kids].map(([name, type]) => ({ name, type })) };
      listings.push(out.files.length);
      return out;
    }
    if (method === 'stat') {
      if (files.has(p) || dirs.has(p) || [...files.keys()].some(k => k.startsWith(p + '/'))) return { type: 'file' };
      throw new Error('File does not exist');
    }
    if (method === 'mkdir') { dirs.add(p); return {}; }
    if (method === 'rename') {
      if (!files.has(options.from)) throw new Error('File does not exist');
      files.set(options.to, files.get(options.from)); files.delete(options.from); return {};
    }
    if (method === 'deleteFile') {
      if (!files.has(p)) throw new Error('File does not exist');
      files.delete(p); return {};
    }
    if (method === 'rmdir') {
      let any = dirs.delete(p);
      for (const k of [...files.keys()]) if (k.startsWith(p + '/')) { files.delete(k); any = true; }
      for (const d of [...dirs]) if (d.startsWith(p + '/')) dirs.delete(d);
      if (!any) throw new Error('Directory does not exist');
      return {};
    }
    throw new Error('Unexpected filesystem method ' + method);
  });
  await page.addInitScript(() => {
    window.__navaidEmbedded = true;
    window.requestIdleCallback = () => 0;
    window.Capacitor = { Plugins: { Filesystem: Object.fromEntries(
      ['readFile', 'writeFile', 'readdir', 'deleteFile', 'rmdir', 'stat', 'mkdir', 'rename'].map(method =>
        [method, options => window.nativeFiles(method, options)])) } };
  });
  await page.route('https://navaid-tiles.supino.org/**', r => r.fulfill({
    status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64'),
    headers: { 'access-control-allow-origin': '*' },
  }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidOfflineTiles && typeof map !== 'undefined');
  return files;
}

// The APK is served at navaid.supino.org itself, where a request never leaves the phone: the
// plates come from the repository they are published from.
test('embedded plates come from the published repository, not the address the app is served at', async ({ page }) => {
  await embedded(page);
  expect(await page.evaluate(() => plateUrl('A B.pdf')))
    .toBe('https://raw.githubusercontent.com/msupino/NavigationApp/main/docs/byop/A%20B.pdf');
});

test('native downloaded CVFR survives reload and renders without network or a service worker', async ({ page }) => {
  const files = await embedded(page);
  const result = await page.evaluate(async () => {
    const result = await NavAidOfflineTiles.downloadPack(null, 7, 7);
    return { complete: result.complete, present: result.ok };
  });
  expect(result.complete).toBe(true);
  expect(files.size).toBe(result.present);
  expect(files.size).toBeGreaterThan(0);
  await page.route('https://navaid-tiles.supino.org/**', r => r.abort());
  await page.reload();
  await page.waitForFunction(() => window.NavAidOfflineTiles && typeof map !== 'undefined');
  const loaded = await page.evaluate(async () => {
    const coverage = await NavAidOfflineTiles.cvfrCoverage(7, 7);
    const coords = NavAidOfflineTiles.cvfrPlan(7, 7)[0].coords;
    const layer = layers.CVFR;
    layer._tileZoom = 7;
    const src = await new Promise((resolve, reject) => {
      layer.createTile(Object.assign(L.point(coords.x, coords.y), {z: 7}),
        (err, tile) => err ? reject(err) : resolve(tile.src));
    });
    return { complete: coverage.complete, src };
  });
  expect(loaded.complete).toBe(true);
  expect(loaded.src).toMatch(/^data:image\/png;base64,/);
  // Zoom 7 is within the built-in chart an APK carries (7-12), which Clear offline CVFR keeps.
  const kept = files.size;
  await page.evaluate(() => NavAidOfflineTiles.deletePack());
  expect(files.size).toBe(kept);
});

test('failed native writes cannot report a ready chart pack', async ({ page }) => {
  await embedded(page);
  const result = await page.evaluate(async () => {
    Capacitor.Plugins.Filesystem.writeFile = async () => { throw new Error('No space left'); };
    const result = await NavAidOfflineTiles.downloadPack(null, 7, 7);
    return { result, coverage: await NavAidOfflineTiles.cvfrCoverage(7, 7) };
  });
  expect(result.result.failed).toBeGreaterThan(0);
  expect(result.coverage.present).toBe(0);
  expect(result.coverage.complete).toBe(false);
});

test('the generated embedded app boots with every external request blocked', async ({ page }) => {
  const fs = require('fs');
  const path = require('path');
  const bundle = await import('../mobile/scripts/bundle-web.mjs');
  bundle.copyBundle();
  // The bundle lists its own files by content, for the update row to weigh a delta against.
  const own = JSON.parse(fs.readFileSync(path.join(bundle.wwwDir, 'bundle-manifest.json'), 'utf8'));
  expect(own.hashes['index.html']).toBe(require('crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(bundle.wwwDir, 'index.html'))).digest('hex'));
  expect(Object.keys(own.hashes).length).toBe(own.files);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'embedded.test') return route.abort();
    const file = path.resolve(bundle.wwwDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(bundle.wwwDir + path.sep) || !fs.existsSync(file)) {
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 200, body: fs.readFileSync(file),
      contentType: types[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto('http://embedded.test/?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && window.NavAidOfflineTiles);
  await expect(page.locator('#boot-error')).toHaveCount(0);
  expect(await page.evaluate(() => ({ native: NavAidNativeTiles.enabled, leaflet: L.version })))
    .toEqual({ native: true, leaflet: '1.9.4' });
});

// The APK carries CVFR z7-z12 (mobile/scripts/bundle-charts.mjs). Shown from the package with
// nothing downloaded, then copied once into the store the offline download fills -- the copy is
// what survives an update bundle replacing the package's web files.
test('the CVFR tiles packed in the APK show with nothing downloaded, and are copied into the store once', async ({ page }) => {
  const base = 'https://navaid-tiles.supino.org/CVFR';
  await page.route('**/charts/cvfr/index.json', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ chart: 'CVFR', base, minZoom: 7, maxZoom: 7, tiles: ['7/77/52', '7/78/52'] }),
  }));
  await page.route('**/charts/cvfr/7/**', r => r.fulfill({
    status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64'),
  }));
  const files = await embedded(page);
  const out = await page.evaluate(async (base) => {
    const shown = await NavAidNativeTiles.imageUrl(base + '/7/77/52.png');
    const notPacked = await NavAidNativeTiles.imageUrl(base + '/7/1/1.png');
    const first = await NavAidNativeTiles.seedBundled();
    const again = await NavAidNativeTiles.seedBundled();
    const fromStore = await NavAidNativeTiles.imageUrl(base + '/7/78/52.png');
    return { shown, notPacked, first, again, fromStore };
  }, base);
  expect(out.shown).toBe('charts/cvfr/7/77/52.png');
  expect(out.notPacked).toBe(base + '/7/1/1.png');
  expect(out.first).toBe(2);
  expect(out.again).toBe(0);
  expect(files.size).toBe(2);
  expect(out.fromStore).toMatch(/^data:image\/png;base64,/);
});

test('a new APK with a new edition of the chart copies its tiles over the old ones', async ({ page }) => {
  const base = 'https://navaid-tiles.supino.org/CVFR';
  let id = 'edition-1';
  await page.route('**/charts/cvfr/index.json', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ chart: 'CVFR', base, minZoom: 7, maxZoom: 7, id, tiles: ['7/77/52'] }),
  }));
  await page.route('**/charts/cvfr/7/**', r => r.fulfill({
    status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64'),
  }));
  const files = await embedded(page);
  expect(await page.evaluate(() => NavAidNativeTiles.seedBundled())).toBe(1);
  expect(await page.evaluate(() => NavAidNativeTiles.bundledSeeded())).toBe(true);
  id = 'edition-2';                           // the next APK
  await page.reload();
  await page.waitForFunction(() => window.NavAidOfflineTiles && typeof map !== 'undefined');
  expect(await page.evaluate(() => NavAidNativeTiles.bundledSeeded())).toBe(false);
  expect(await page.evaluate(() => NavAidNativeTiles.seedBundled())).toBe(1);   // replaced, not skipped
  expect(files.size).toBe(1);
});

// A copy of the packed tiles that cannot finish (storage full) must not stop updates for good.
test('a copy that failed does not hold updates back for ever', async ({ page }) => {
  await page.route('**/charts/cvfr/index.json', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ chart: 'CVFR', base: 'https://navaid-tiles.supino.org/CVFR', minZoom: 7, maxZoom: 7, id: 'e1', tiles: ['7/77/52'] }),
  }));
  await page.route('**/charts/cvfr/7/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') }));
  await embedded(page);
  const out = await page.evaluate(async () => {
    Capacitor.Plugins.Filesystem.writeFile = async () => { throw new Error('No space left'); };
    const before = await NavAidNativeTiles.bundledSeeded();
    const copied = await NavAidNativeTiles.seedBundled();
    return { before, copied, after: await NavAidNativeTiles.bundledSeeded() };
  });
  expect(out.before).toBe(false);
  expect(out.copied).toBe(0);
  expect(out.after).toBe(true);
});

// Clear offline CVFR removes what was downloaded, and keeps the chart the APK carries: after an
// update the package's own files are out of reach, so a cleared built-in chart would be gone
// until a Wi-Fi download.
test('Clear offline CVFR keeps the built-in zooms and removes only what was downloaded beyond them', async ({ page }) => {
  const base = 'https://navaid-tiles.supino.org/CVFR';
  await page.route('**/charts/cvfr/index.json', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ chart: 'CVFR', base, minZoom: 7, maxZoom: 7, id: 'e1', tiles: ['7/77/52'] }),
  }));
  await page.route('**/charts/cvfr/7/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') }));
  const files = await embedded(page);
  const out = await page.evaluate(async () => {
    await NavAidNativeTiles.seedBundled();                        // the built-in z7 tile
    await NavAidOfflineTiles.downloadPack(null, 8, 8);            // and a downloaded z8
    const before = (await (await NavAidNativeTiles.storage.open()).keys()).map(k => k.url);
    await NavAidOfflineTiles.deletePack();
    const after = (await (await NavAidNativeTiles.storage.open()).keys()).map(k => k.url);
    return { before, after, zooms: NavAidNativeTiles.builtinZooms() };
  });
  expect(out.zooms).toEqual({ min: 7, max: 7 });
  expect(out.before.some(u => /\/CVFR\/8\//.test(u))).toBe(true);
  expect(out.after.every(u => /\/CVFR\/7\//.test(u))).toBe(true);    // z8 gone
  expect(out.after).toContain(base + '/7/77/52.png');                  // built-in kept
  expect(files.size).toBe(out.after.length);
});

// Copied once, then cleared: while the package runs, the missing built-in tiles go back in.
test('built-in tiles missing from the store are copied back, even after an earlier copy', async ({ page }) => {
  const base = 'https://navaid-tiles.supino.org/CVFR';
  await page.route('**/charts/cvfr/index.json', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ chart: 'CVFR', base, minZoom: 7, maxZoom: 7, id: 'e1', tiles: ['7/77/52', '7/78/52'] }),
  }));
  await page.route('**/charts/cvfr/7/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') }));
  const files = await embedded(page);
  const out = await page.evaluate(async () => {
    const first = await NavAidNativeTiles.seedBundled();
    await NavAidNativeTiles.storage.delete();                     // gone, as an old Clear did
    const again = await NavAidNativeTiles.seedBundled();
    const idle = await NavAidNativeTiles.seedBundled();           // all there: nothing to do
    return { first, again, idle };
  });
  expect(out).toEqual({ first: 2, again: 2, idle: 0 });
  expect(files.size).toBe(2);
});

// Reported: the Android app kept closing. Its crash log: ~30 OutOfMemoryErrors building a ~37 MB
// JSON answer in FilesystemPlugin.readdir -- the store listed in one go, every launch. Tiles now
// live in 256 sub-folders, listed one at a time, and nothing ever lists the whole store at once.
test('the native chart store lists sub-folder by sub-folder, never the whole store at once', async ({ page }) => {
  const files = await embedded(page);
  const out = await page.evaluate(async () => {
    setTune('offlineCvfrMinZoom', 9);
    setTune('offlineCvfrMaxZoom', 10);
    await NavAidOfflineTiles.downloadPack(null, 9, 10);
    const keys = (await (await NavAidNativeTiles.storage.open()).keys()).map(k => k.url);
    return { keys, shard: NavAidNativeTiles.shardOf(keys[0]) };
  });
  const stored = [...files.keys()];
  expect(stored.length).toBeGreaterThan(50);
  expect(out.keys.length).toBe(stored.length);
  // navaid-tiles-v2/<2 hex>/<encoded URL>, spread over many sub-folders.
  for (const f of stored) expect(f).toMatch(/^navaid-tiles-v2\/[0-9a-f]{2}\/https%3A/);
  expect(new Set(stored.map(f => f.split('/')[1])).size).toBeGreaterThan(20);
  expect(out.shard).toMatch(/^[0-9a-f]{2}$/);
  // The largest single answer is a small part of the store.
  expect(Math.max(...files.listings)).toBeLessThan(stored.length / 4);
});

test('the old one-folder store moves into the sub-folders once, without ever being listed', async ({ page }) => {
  const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const base = 'https://navaid-tiles.supino.org/CVFR';
  const enc = u => 'navaid-tiles-v1/' + encodeURIComponent(u);
  // The automatic CVFR at z7 only (tuned below): every z7 tile of the plan, plus one tile no
  // pack wants any more.
  const seedFiles = [[enc(base + '/7/77/52.png'), PNG1], [enc(base + '/7/78/52.png'), PNG1],
    [enc(base + '/12/2400/1600.png'), PNG1]];
  await page.addInitScript(() => {
    try {
      localStorage.setItem('navaid.tuningOverrides', JSON.stringify({ offlineCvfrMinZoom: 7, offlineCvfrMaxZoom: 7 }));
    } catch (e) { /* */ }
  });
  const files = await embedded(page, seedFiles);
  const out = await page.evaluate(async (base) => {
    setTune('offlineCvfrMinZoom', 7);
    setTune('offlineCvfrMaxZoom', 7);
    // Before the move, the map still finds the old tile.
    const before = await NavAidNativeTiles.imageUrl(base + '/7/77/52.png');
    const keys = (await (await NavAidNativeTiles.storage.open()).keys()).map(k => k.url).sort();
    const after = await NavAidNativeTiles.imageUrl(base + '/7/77/52.png');
    return { before: before.slice(0, 22), after: after.slice(0, 22), keys,
      flag: localStorage.getItem('navaid.tilesV2Migrated'),
      wanted: NavAidOfflineTiles.wantedTileUrls().has(base + '/7/77/52.png'),
      wantedSeeded: [base + '/7/77/52.png', base + '/7/78/52.png', base + '/12/2400/1600.png']
        .filter(u => NavAidOfflineTiles.wantedTileUrls().has(u)).sort() };
  }, base);
  expect(out.wanted).toBe(true);
  expect(out.before).toBe('data:image/png;base64,');
  expect(out.after).toBe('data:image/png;base64,');
  // Every seeded tile a pack still wants moved; the rest (no pack's) went with the old folder.
  expect(out.wantedSeeded.length).toBeGreaterThanOrEqual(1);
  expect(out.wantedSeeded.length).toBeLessThan(3);
  expect(out.keys).toEqual(out.wantedSeeded);
  expect(out.flag).toBe('1');
  const left = [...files.keys()];
  expect(left.some(f => f.startsWith('navaid-tiles-v1/'))).toBe(false);   // old folder gone, stray tile with it
  expect(left).toHaveLength(out.wantedSeeded.length);
  // The old folder was never listed: every listing was of a new sub-folder.
  expect(Math.max(0, ...files.listings)).toBeLessThan(3);
});

test('a tile that will not move keeps the old store until a later launch', async ({ page }) => {
  const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const base = 'https://navaid-tiles.supino.org/CVFR';
  const seedFiles = [['navaid-tiles-v1/' + encodeURIComponent(base + '/7/77/52.png'), PNG1]];
  const files = await embedded(page, seedFiles);
  const out = await page.evaluate(async (base) => {
    setTune('offlineCvfrMinZoom', 7);
    setTune('offlineCvfrMaxZoom', 7);
    Capacitor.Plugins.Filesystem.rename = async () => { throw new Error('I/O error'); };
    await (await NavAidNativeTiles.storage.open()).keys();
    return { flag: localStorage.getItem('navaid.tilesV2Migrated'),
      read: (await NavAidNativeTiles.imageUrl(base + '/7/77/52.png')).slice(0, 22) };
  }, base);
  expect(out.flag).toBeNull();
  expect(out.read).toBe('data:image/png;base64,');                     // still shown from the old store
  expect([...files.keys()].some(f => f.startsWith('navaid-tiles-v1/'))).toBe(true);
});

test('asking whether anything is stored lists nothing', async ({ page }) => {
  const files = await embedded(page);
  const out = await page.evaluate(async () => {
    const empty = await NavAidNativeTiles.storage.has();
    await (await NavAidNativeTiles.storage.open()).put('https://navaid-tiles.supino.org/CVFR/7/77/52.png',
      new Response(new Blob([new Uint8Array([1, 2, 3])])));
    return { empty, some: await NavAidNativeTiles.storage.has() };
  });
  expect(out).toEqual({ empty: false, some: true });
  expect(files.listings).toHaveLength(0);
});
