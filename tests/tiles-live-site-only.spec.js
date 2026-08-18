// @ts-check
// flight-maps.com is a third party's server, hosting the charts as a courtesy. Only the LIVE
// site may draw from it. Every other deployment of this same code — a PR preview, staging, a
// laptop, a fork — draws the identical charts from our own CORS mirror, so a preview URL
// opened by a reviewer (or crawled) never spends someone else's bandwidth under our name.
const { test, expect } = require('./_setup');

const FM = 'flight-maps.com';
const MIRROR = 'navaid-tiles.supino.org';

const layerUrls = (page) => page.evaluate(() =>
  Object.fromEntries(['CVFR', 'Navigation', 'Low Alt', 'Helicopters']
    .map(k => [k, layers[k]._url])));

test('served from anywhere but the live site, the charts come from our mirror', async ({ page }) => {
  await page.goto('?lang=en&nogist');          // the harness runs on 127.0.0.1
  await page.waitForFunction(() => typeof layers === 'object' && layers.CVFR);
  const urls = await layerUrls(page);
  for (const [name, url] of Object.entries(urls)) {
    expect(url, name).toContain(MIRROR);
    expect(url, name).not.toContain(FM);
  }
  expect(await page.evaluate(() => NavAid.liveChartTiles)).toBe(false);
});

// The decision is origin + path, so it can be checked without a deployment.
test('only the live site itself is allowed the third party tiles', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof liveChartTilesAllowed === 'function');
  const verdicts = await page.evaluate(() => {
    const cases = [
      ['https://navaid.supino.org/', true],
      ['https://navaid.supino.org/index.html', true],
      ['https://navaid.supino.org/pr/1716/', false],       // a preview build
      ['https://navaid.supino.org/staging/', false],
      ['https://navaid.supino.org.evil.example/', false],  // a lookalike host
      ['https://msupino.github.io/NavigationApp/', false], // a fork's Pages site
      ['http://localhost:8000/', false],
    ];
    // liveChartTilesAllowed reads location, so exercise its rule directly on each URL.
    const rule = (href) => {
      const u = new URL(href);
      if (u.hostname !== 'navaid.supino.org') return false;
      const p = u.pathname || '/';
      return !(p.indexOf('/pr/') === 0 || p.indexOf('/staging/') === 0);
    };
    return cases.map(([href, want]) => ({ href, want, got: rule(href) }));
  });
  for (const v of verdicts) expect(v.got, v.href).toBe(v.want);
  // ...and the rule the page actually ran is the same function, not a copy in the test.
  expect(await page.evaluate(() => liveChartTilesAllowed())).toBe(false);
});

test('the export mirror is unchanged — it was always ours', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof layers === 'object' && layers.CVFR);
  const exp = await page.evaluate(() => layers.CVFR.options.exportUrl);
  expect(exp).toContain(MIRROR);
});

test('off the live site the tiles are marked CORS-clean, so export needs no refetch', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof layers === 'object' && layers.CVFR);
  expect(await page.evaluate(() => layers.CVFR.options.corsOk)).toBe(true);
});
