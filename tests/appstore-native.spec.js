// @ts-check
const { test, expect } = require('./_setup');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function embedded(page) {
  const files = new Map();
  await page.exposeBinding('nativeFiles', async (_, method, options) => {
    const p = options.path;
    if (method === 'writeFile') { files.set(p, options.data); return { uri: 'file:///' + p }; }
    if (method === 'readFile') {
      if (!files.has(p)) throw new Error('File does not exist');
      return { data: files.get(p) };
    }
    if (method === 'readdir') return { files: [...files.keys()].filter(k => k.startsWith(p + '/'))
      .map(k => ({ name: k.slice(p.length + 1), type: 'file' })) };
    if (method === 'deleteFile') { files.delete(p); return {}; }
    if (method === 'rmdir') { for (const k of files.keys()) if (k.startsWith(p + '/')) files.delete(k); return {}; }
    throw new Error('Unexpected filesystem method ' + method);
  });
  await page.addInitScript(() => {
    window.__navaidEmbedded = true;
    window.requestIdleCallback = () => 0;
    window.Capacitor = { Plugins: { Filesystem: Object.fromEntries(
      ['readFile', 'writeFile', 'readdir', 'deleteFile', 'rmdir'].map(method =>
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
  await page.evaluate(() => NavAidOfflineTiles.deletePack());
  expect(files.size).toBe(0);
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
