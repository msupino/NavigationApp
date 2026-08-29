// Automatic CVFR maintenance: production keeps the complete chart, while local/staging/PR
// deployments never start the large transfer by themselves.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAidOfflineTiles && window.NavAidOfflineTiles.fetchFloor));
}

test('automatic CVFR ships on but does not run from a local/preview deployment', async ({ page }) => {
  await boot(page);
  const off = await page.evaluate(() => ({
    flag: tune('offlineAutoCvfr'),
    wanted: NavAidOfflineTiles.automaticCvfrWanted(),
    suitable: NavAidOfflineTiles.connectionSuitable(),
  }));
  expect(off.flag).toBe(true);
  expect(off.wanted).toBe(false);
  expect(off.suitable).toBe(true);
});

test('a constrained or explicitly cellular connection pauses automatic maintenance', async ({ page }) => {
  await boot(page);
  const seen = await page.evaluate(() => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'connection');
    const set = (v) => Object.defineProperty(navigator, 'connection', { value: v, configurable: true });
    const out = {};
    set({ effectiveType: '4g', saveData: false });
    out.fast = NavAidOfflineTiles.connectionSuitable();
    set({ type: 'cellular', effectiveType: '4g', saveData: false });
    out.cellular = NavAidOfflineTiles.connectionSuitable();
    set({ effectiveType: '4g', saveData: true });         // Data Saver is an explicit "do not"
    out.saveData = NavAidOfflineTiles.connectionSuitable();
    set({ effectiveType: '3g', saveData: false });
    out.threeG = NavAidOfflineTiles.connectionSuitable();
    set(undefined);                                       // no way to ask
    out.unknown = NavAidOfflineTiles.connectionSuitable();
    setTune('offlineCvfrUnmeteredOnly', false);
    set({ effectiveType: '2g', saveData: true });
    out.forcedOn = NavAidOfflineTiles.connectionSuitable();
    if (orig) Object.defineProperty(navigator, 'connection', orig);
    return out;
  });
  expect(seen.fast).toBe(true);
  expect(seen.cellular).toBe(false);
  expect(seen.saveData).toBe(false);
  expect(seen.threeG).toBe(false);
  expect(seen.unknown).toBe(true);
  expect(seen.forcedOn).toBe(true);
});

test('a forced maintenance run fetches the requested CVFR zooms and nothing deeper', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await caches.delete(O.TILE_CACHE);
    const res = await O.fetchFloor({ force: true, zMin: 7, zMax: 8 });
    const cache = await caches.open(O.TILE_CACHE);
    const zooms = (await cache.keys())
      .map(r => (/\/(\d+)\/\d+\/\d+\.png/.exec(r.url) || [])[1])
      .filter(Boolean).map(Number);
    await caches.delete(O.TILE_CACHE);
    return { res, zooms: [...new Set(zooms)].sort((a, b) => a - b) };
  });
  expect(got.res.fetched).toBeGreaterThan(0);
  expect(got.zooms).toEqual([7, 8]);          // the range asked for, and only that
});

test('a second load costs nothing: what is cached is not refetched', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await caches.delete(O.TILE_CACHE);
    const first = await O.fetchFloor({ force: true, zMin: 7, zMax: 7 });
    const second = await O.fetchFloor({ force: true, zMin: 7, zMax: 7 });
    const coverage = await O.cvfrCoverage(7, 7);
    await caches.delete(O.TILE_CACHE);
    return { first, second, coverage };
  });
  expect(got.first.fetched).toBeGreaterThan(0);
  expect(got.second.fetched).toBe(0);         // ...but still counted as present
  expect(got.second.ok).toBe(got.first.ok);
  expect(got.coverage.complete).toBe(true);
  expect(got.coverage.percent).toBe(100);
});

test('two runs cannot overlap', async ({ page }) => {
  await boot(page);
  const same = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await caches.delete(O.TILE_CACHE);
    const a = O.fetchFloor({ force: true, zMin: 7, zMax: 8 });
    const b = O.fetchFloor({ force: true, zMin: 7, zMax: 8 });
    const [ra, rb] = await Promise.all([a, b]);
    await caches.delete(O.TILE_CACHE);
    return ra === rb || (ra.fetched === rb.fetched && ra.ok === rb.ok);
  });
  expect(same).toBe(true);
});

test('an inverted range does nothing rather than guessing', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => NavAidOfflineTiles.fetchFloor({ force: true, zMin: 10, zMax: 7 }));
  expect(r.skipped).toBe('bad range');
});
