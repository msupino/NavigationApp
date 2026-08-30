// @ts-check
const { test, expect } = require('./_setup');

const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');
}

test.describe('Base map tile hosts', () => {
  // Off the live site (this harness included) the DISPLAY url is our own mirror too --
  // flight-maps.com is a third party's server and only navaid.supino.org may draw from it
  // (see tiles-live-site-only.spec.js). The export URL was always ours.
  test('chart layers draw and export from our mirror when not the live site', async ({ page }) => {
    await boot(page);
    const tileLayers = await page.evaluate(() => {
      const out = {};
      for (const name of ['CVFR', 'Navigation', 'Low Alt', 'Helicopters']) {
        out[name] = {
          url: layers[name]._url,
          exportUrl: layers[name].options.exportUrl,
          optionKeys: Object.keys(layers[name].options),
        };
      }
      return out;
    });

    expect(tileLayers.CVFR.url).toBe(
      'https://navaid-tiles.supino.org/CVFR/{z}/{x}/{y}.png');
    expect(tileLayers.Navigation.url).toBe(
      'https://navaid-tiles.supino.org/Israel-Navigation/{z}/{x}/{y}.png');
    expect(tileLayers['Low Alt'].url).toBe(
      'https://navaid-tiles.supino.org/LSA-Low-Altitude/{z}/{x}/{y}.png');
    expect(tileLayers.Helicopters.url).toBe(
      'https://navaid-tiles.supino.org/Israel-Helicopters/{z}/{x}/{y}.png');

    expect(tileLayers.CVFR.exportUrl).toBe(
      'https://navaid-tiles.supino.org/CVFR/{z}/{x}/{y}.png');
    expect(tileLayers.Navigation.exportUrl).toBe(
      'https://navaid-tiles.supino.org/Israel-Navigation/{z}/{x}/{y}.png');
    expect(tileLayers['Low Alt'].exportUrl).toBe(
      'https://navaid-tiles.supino.org/LSA-Low-Altitude/{z}/{x}/{y}.png');
    expect(tileLayers.Helicopters.exportUrl).toBe(
      'https://navaid-tiles.supino.org/Israel-Helicopters/{z}/{x}/{y}.png');

    for (const info of Object.values(tileLayers)) {
      // The point of the whole exercise: nothing here may reach the third party's server.
      expect(info.url).not.toContain('flight-maps.com');
      expect(info.optionKeys).not.toContain('fallbackUrl');
    }
  });

  test('tile URL helpers resolve both the display and the export URL', async ({ page }) => {
    await boot(page);
    const urls = await page.evaluate(() => {
      const coords = { z: 9, x: 304, y: 205 };
      return {
        cvfr: tileLayerUrl(layers.CVFR, coords),
        navigation: tileLayerUrl(layers.Navigation, coords),
        lowAlt: tileLayerUrl(layers['Low Alt'], coords),
        helicopters: tileLayerUrl(layers.Helicopters, coords),
        exportCvfr: exportTileLayerUrl(layers.CVFR, coords),
        exportNavigation: exportTileLayerUrl(layers.Navigation, coords),
        exportLowAlt: exportTileLayerUrl(layers['Low Alt'], coords),
        exportHelicopters: exportTileLayerUrl(layers.Helicopters, coords),
        hasProxyHelper: typeof window[['tile', 'Export', 'Fetch', 'Url'].join('')] !== 'undefined',
      };
    });

    expect(urls).toEqual({
      cvfr: 'https://navaid-tiles.supino.org/CVFR/9/304/205.png',
      navigation: 'https://navaid-tiles.supino.org/Israel-Navigation/9/304/205.png',
      lowAlt: 'https://navaid-tiles.supino.org/LSA-Low-Altitude/9/304/205.png',
      helicopters: 'https://navaid-tiles.supino.org/Israel-Helicopters/9/304/205.png',
      exportCvfr: 'https://navaid-tiles.supino.org/CVFR/9/304/205.png',
      exportNavigation: 'https://navaid-tiles.supino.org/Israel-Navigation/9/304/205.png',
      exportLowAlt: 'https://navaid-tiles.supino.org/LSA-Low-Altitude/9/304/205.png',
      exportHelicopters: 'https://navaid-tiles.supino.org/Israel-Helicopters/9/304/205.png',
      hasProxyHelper: false,
    });
  });

  test('chart coverage does not render failed tile columns as pale bands', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() => {
      const layer = layers.CVFR;
      const coords = (x, y) => Object.assign(L.point(x, y), { z: 8 });
      const failedTile = document.createElement('img');
      layer._tileOnError(() => {}, failedTile, new Event('error'));
      return {
        westOutside: layer._isValidTile(coords(151, 103)),
        westInside: layer._isValidTile(coords(152, 103)),
        eastInside: layer._isValidTile(coords(153, 103)),
        eastOutside: layer._isValidTile(coords(154, 103)),
        noWrap: layer.options.noWrap,
        failedTileUrl: failedTile.src,
      };
    });

    expect(result).toEqual({
      westOutside: false,
      westInside: true,
      eastInside: true,
      eastOutside: false,
      noWrap: true,
      failedTileUrl: expect.stringMatching(/^data:image\/png;base64,/),
    });
  });

  test('export tile fetch uses hosted mirror instead of live Flight Maps', async ({ page }) => {
    let liveHits = 0;
    let exportHits = 0;
    await page.route(/^https?:\/\/([^/]*\.)?flight-maps\.com\/tiles\//, route => {
      liveHits++;
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TILE_PNG,
      });
    });
    await page.route(/^https?:\/\/navaid-tiles\.supino\.org\//, route => {
      exportHits++;
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TILE_PNG,
      });
    });

    await boot(page);
    liveHits = 0;
    exportHits = 0;

    const result = await page.evaluate(async () => {
      const realCreateImageBitmap = window.createImageBitmap;
      window.createImageBitmap = async () => ({});
      try {
        const out = await fetchTileBitmap(layers.CVFR, { z: 9, x: 304, y: 205 });
        return { failed: out.failed, hasBitmap: !!out.bmp };
      } finally {
        window.createImageBitmap = realCreateImageBitmap;
      }
    });

    expect(result).toEqual({ failed: false, hasBitmap: true });
    expect(exportHits).toBeGreaterThan(0);
    expect(liveHits).toBe(0);
  });
});
