// @ts-check
// The gist arrives over the network, so the first paint was the SHIPPED defaults and
// everything the gist changes — colours, sizes, which layers are offered — jumped a moment
// later, on every single load. The last gist seen on this device is cached and applied
// synchronously at boot, so a returning pilot's first frame is already the configured one.
const { test, expect } = require('./_setup');

const GIST = { waypointFillColor: '#123456', legKiteHeightPx: 41, layerEnabledHelicopters: false };

// Serve a gist, and count how many times it is actually fetched.
async function withGist(page, body) {
  let hits = 0;
  await page.route(/gist\.githubusercontent\.com/, route => {
    hits++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return () => hits;
}

const boot = (page) => page.waitForFunction(() => typeof tune === 'function' && typeof NavAid === 'object');

test('the first load still has to wait for the network — nothing is cached yet', async ({ page }) => {
  await withGist(page, GIST);
  await page.goto('?lang=en');
  await boot(page);
  expect(await page.evaluate(() => NavAid.gistWarmStart)).toBe(0);
  await expect.poll(() => page.evaluate(() => tune('waypointFillColor'))).toBe(GIST.waypointFillColor);
});

test('the next load is already configured before the fetch answers', async ({ page }) => {
  await withGist(page, GIST);
  await page.goto('?lang=en');
  await boot(page);
  await expect.poll(() => page.evaluate(() => tune('legKiteHeightPx'))).toBe(41);

  // Second visit: hold the gist response open, so anything correct on screen came from cache.
  await page.unroute(/gist\.githubusercontent\.com/);
  let release;
  const held = new Promise(r => { release = r; });
  await page.route(/gist\.githubusercontent\.com/, async route => {
    await held;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GIST) });
  });
  await page.goto('?lang=en');
  await boot(page);
  const atBoot = await page.evaluate(() => ({
    warm: NavAid.gistWarmStart,
    colour: tune('waypointFillColor'),
    kite: tune('legKiteHeightPx'),
  }));
  release();
  expect(atBoot.warm).toBeGreaterThan(0);
  expect(atBoot.colour).toBe(GIST.waypointFillColor);   // no jump: right from the first frame
  expect(atBoot.kite).toBe(41);
});

test('a changed gist still wins over the cache', async ({ page }) => {
  await withGist(page, GIST);
  await page.goto('?lang=en');
  await boot(page);
  await expect.poll(() => page.evaluate(() => tune('legKiteHeightPx'))).toBe(41);

  // Hold the new gist until the cached value has been read, or the network wins the race and
  // the test proves nothing about which came first.
  await page.unroute(/gist\.githubusercontent\.com/);
  let release;
  const held = new Promise(r => { release = r; });
  await page.route(/gist\.githubusercontent\.com/, async route => {
    await held;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...GIST, legKiteHeightPx: 55 }) });
  });
  await page.goto('?lang=en');
  await boot(page);
  expect(await page.evaluate(() => tune('legKiteHeightPx'))).toBe(41);          // cache first...
  release();
  await expect.poll(() => page.evaluate(() => tune('legKiteHeightPx'))).toBe(55); // ...then the truth
});

test('?nogist ignores the cache as well as the network', async ({ page }) => {
  await withGist(page, GIST);
  await page.goto('?lang=en');
  await boot(page);
  await expect.poll(() => page.evaluate(() => tune('legKiteHeightPx'))).toBe(41);

  await page.goto('?lang=en&nogist');
  await boot(page);
  const out = await page.evaluate(() => ({
    warm: NavAid.gistWarmStart,
    kite: tune('legKiteHeightPx'),
    shipped: NavAid.tuningDefaults.legKiteHeightPx.value,
  }));
  expect(out.warm).toBe(0);
  expect(out.kite).toBe(out.shipped);
});

test('a corrupt cache is ignored, not fatal', async ({ page }) => {
  await withGist(page, GIST);
  await page.goto('?lang=en');
  await boot(page);
  await page.evaluate(() => localStorage.setItem('navaid.gistCache', '{not json'));
  await page.goto('?lang=en');
  await boot(page);
  expect(await page.evaluate(() => NavAid.gistWarmStart)).toBe(0);
  expect(await page.evaluate(() => typeof tune('legKiteHeightPx'))).toBe('number');
});
