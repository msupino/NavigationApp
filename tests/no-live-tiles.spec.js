// @ts-check
// The suite must not fetch map tiles from anyone's server. flight-maps.com is a third
// party's: the charts are theirs, served as a courtesy, and 2000+ tests each booting the
// map into ~24 tiles turned every CI run into tens of thousands of requests from a US
// GitHub runner reporting `Referer: http://127.0.0.1:8000/` -- which its owner saw as
// millions over three months (issue #1668). OpenStreetMap's tile policy says the same
// about automated bulk use.
//
// Two things have to hold for that to stay true, and this file pins both:
//   1. tests/_setup.js answers every tile request inside the harness;
//   2. service workers stay blocked (playwright.config.js) -- a request made from inside
//      a worker is invisible to page.route, which is exactly how the interception was
//      silently bypassed the first time.
const { test, expect } = require('./_setup');

// flight-maps.com and OSM are never acceptable, in any mode. Our own copy is acceptable
// only in the mirror mode the wiki-screenshot job uses (NAVAID_TEST_TILES=mirror), which
// exists so those pictures show real charts -- from our copy, not theirs.
//
// Matched as a HOST, not as a substring of the URL: `flight-maps.com.example.net` is a
// different server, and a pattern that matches anywhere in the string would call it this
// one (CodeQL js/regex/missing-regexp-anchor).
const FORBIDDEN_HOSTS = ['flight-maps.com', 'tile.openstreetmap.org']
  .concat(process.env.NAVAID_TEST_TILES === 'mirror' ? [] : ['navaid-tiles.supino.org']);
const isForbiddenHost = (host) =>
  FORBIDDEN_HOSTS.some((h) => host === h || host.endsWith('.' + h));

test('booting and zooming the map reaches no tile server', async ({ page }) => {
  const live = [];
  page.on('response', async (r) => {
    if (!isForbiddenHost(new URL(r.url()).hostname)) return;
    // The fixture stamps what it answers itself; anything without the stamp came off a wire.
    const stub = await r.headerValue('x-navaid-stub-tile').catch(() => null);
    if (!stub) live.push(r.url());
  });
  await page.goto('?lang=en&nogist');
  await page.waitForTimeout(1500);
  // Zoom and pan: the two gestures that pull a fresh burst of tiles.
  await page.evaluate(() => { map.setZoom(map.getZoom() + 2); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { map.panBy([600, 600]); });
  await page.waitForTimeout(800);
  expect(live).toEqual([]);
});

test('every base chart layer is served from inside the harness too', async ({ page }) => {
  const live = [];
  page.on('response', async (r) => {
    if (!isForbiddenHost(new URL(r.url()).hostname)) return;
    const stub = await r.headerValue('x-navaid-stub-tile').catch(() => null);
    if (!stub) live.push(r.url());
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof layers === 'object' && !!layers);
  const names = await page.evaluate(() => Object.keys(layers));
  for (const name of names) {
    await page.evaluate((n) => {
      for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
      map.addLayer(layers[n]);
    }, name);
    await page.waitForTimeout(250);
  }
  expect(live).toEqual([]);
});

// The block is what makes the interception above reachable at all.
test('service workers are blocked by default', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const registered = await page.evaluate(async () => {
    if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return 0;
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length;
  });
  expect(registered).toBe(0);
});
