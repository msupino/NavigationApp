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

test('embedded plates and manifest use the production server', async ({ page }) => {
  await embedded(page);
  expect(await page.evaluate(() => plateUrl('A B.pdf')))
    .toBe('https://navaid.supino.org/byop/A%20B.pdf');
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
