// @ts-check
const { test, expect } = require('./_setup');

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

async function boot(page, query = '') {
  await page.route(/^https?:\/\/([^/]*\.)?flight-maps\.com\/tiles\//, route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG })
  );
  await page.route(/\/tiles\/(?:cvfr|nav|la|il-hel)\//, route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG })
  );
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
  });
  await page.goto(query || '?lang=en');
  await page.waitForFunction(() => typeof layers !== 'undefined');
}

test.describe('local MBTiles layer switch', () => {
  test('localTiles=1 serves Flight Maps chart layers from same-origin tile paths', async ({ page }) => {
    await boot(page, '?lang=en&localTiles=1');
    const out = await page.evaluate(() => ({
      enabled: NavAid.localChartTiles,
      cvfr: layers.CVFR._url,
      nav: layers.Navigation._url,
      lowAlt: layers['Low Alt']._url,
      helicopters: layers.Helicopters._url,
      cvfrCors: layers.CVFR.options.corsOk === true,
      navLocal: layers.Navigation.options.localTiles === true,
      lowAltLocal: layers['Low Alt'].options.localTiles === true,
      helicoptersLocal: layers.Helicopters.options.localTiles === true,
    }));
    expect(out).toMatchObject({
      enabled: true,
      cvfr: 'tiles/cvfr/{z}/{x}/{y}.png',
      nav: 'tiles/nav/{z}/{x}/{y}.png',
      lowAlt: 'tiles/la/{z}/{x}/{y}.png',
      helicopters: 'tiles/il-hel/{z}/{x}/{y}.png',
      cvfrCors: true,
      navLocal: true,
      lowAltLocal: true,
      helicoptersLocal: true,
    });
  });

  test('localTiles=0 disables the persisted local tile setting', async ({ page }) => {
    await boot(page, '?lang=en&localTiles=1');
    expect(await page.evaluate(() => localStorage.getItem('navaid.localTiles'))).toBe('1');
    await page.goto('?lang=en&localTiles=0');
    await page.waitForFunction(() => typeof layers !== 'undefined');
    const out = await page.evaluate(() => ({
      enabled: NavAid.localChartTiles,
      stored: localStorage.getItem('navaid.localTiles'),
      cvfr: layers.CVFR._url,
      nav: layers.Navigation._url,
      lowAlt: layers['Low Alt']._url,
      helicopters: layers.Helicopters._url,
    }));
    expect(out.enabled).toBe(false);
    expect(out.stored).toBeNull();
    expect(out.cvfr).toContain('https://flight-maps.com/tiles/cvfr/');
    expect(out.nav).toContain('https://flight-maps.com/tiles/nav/');
    expect(out.lowAlt).toContain('https://flight-maps.com/tiles/la/');
    expect(out.helicopters).toContain('https://flight-maps.com/tiles/il-hel/');
  });
});
