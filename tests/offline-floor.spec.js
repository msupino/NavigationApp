// The offline floor: a small en-route map fetched quietly on load.
//
// The downloadable pack is something a pilot chooses. This is the part that happens whether
// or not anyone remembered — because "the map was blank in the air" should need someone to
// have both forgotten AND been offline at the desk.
//
// It is small on purpose: z7-10 over the published extent is ~300 tiles, about 4 MB. The
// full z7-13 pack is ~14,600 tiles and ~200 MB, which is not something to start on someone
// else's data plan unasked — so the deep zooms stay behind the button.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAidOfflineTiles && window.NavAidOfflineTiles.fetchFloor));
}

test('it ships off, so nothing is fetched unasked', async ({ page }) => {
  await boot(page);
  const off = await page.evaluate(() => ({
    flag: tune('offlineAutoFloor'),
    wanted: NavAidOfflineTiles.floorWanted(),
  }));
  expect(off.flag).toBe(false);
  expect(off.wanted).toBe(false);
});

test('a metered connection is a reason not to', async ({ page }) => {
  await boot(page);
  const seen = await page.evaluate(() => {
    setTune('offlineAutoFloor', true);
    const orig = Object.getOwnPropertyDescriptor(navigator, 'connection');
    const set = (v) => Object.defineProperty(navigator, 'connection', { value: v, configurable: true });
    const out = {};
    set({ effectiveType: '4g', saveData: false });
    out.wifi = NavAidOfflineTiles.floorWanted();
    set({ effectiveType: '4g', saveData: true });         // Data Saver is an explicit "do not"
    out.saveData = NavAidOfflineTiles.floorWanted();
    set({ effectiveType: '3g', saveData: false });
    out.threeG = NavAidOfflineTiles.floorWanted();
    set(undefined);                                       // no way to ask
    out.unknown = NavAidOfflineTiles.floorWanted();
    // ...and a deployment that would rather not care can say so.
    setTune('offlineFloorWifiOnly', false);
    set({ effectiveType: '2g', saveData: true });
    out.forcedOn = NavAidOfflineTiles.floorWanted();
    if (orig) Object.defineProperty(navigator, 'connection', orig);
    return out;
  });
  expect(seen.wifi).toBe(true);
  expect(seen.saveData).toBe(false);
  expect(seen.threeG).toBe(false);
  expect(seen.unknown).toBe(true);
  expect(seen.forcedOn).toBe(true);
});

test('it fetches the floor zooms and nothing deeper', async ({ page }) => {
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
    await caches.delete(O.TILE_CACHE);
    return { first, second };
  });
  expect(got.first.fetched).toBeGreaterThan(0);
  expect(got.second.fetched).toBe(0);         // ...but still counted as present
  expect(got.second.ok).toBe(got.first.ok);
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
