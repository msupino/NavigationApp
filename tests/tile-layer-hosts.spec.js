// @ts-check
const { test, expect } = require('./_setup');

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
  test('chart layers use the hosted tile repo only', async ({ page }) => {
    await boot(page);
    const tileLayers = await page.evaluate(() => {
      const out = {};
      for (const name of ['CVFR', 'Navigation', 'Low Alt', 'Helicopters']) {
        out[name] = {
          url: layers[name]._url,
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

    const removedOptionKeys = ['fallbackUrl', ['c', 'orsOk'].join('')];
    for (const info of Object.values(tileLayers)) {
      expect(info.url).not.toContain('flight-maps.com');
      for (const key of removedOptionKeys) {
        expect(info.optionKeys).not.toContain(key);
      }
    }
  });

  test('tile URL helper templates direct hosted URLs', async ({ page }) => {
    await boot(page);
    const urls = await page.evaluate(() => {
      const coords = { z: 9, x: 304, y: 205 };
      return {
        cvfr: tileLayerUrl(layers.CVFR, coords),
        navigation: tileLayerUrl(layers.Navigation, coords),
        lowAlt: tileLayerUrl(layers['Low Alt'], coords),
        helicopters: tileLayerUrl(layers.Helicopters, coords),
        hasProxyHelper: typeof window[['tile', 'Export', 'Fetch', 'Url'].join('')] !== 'undefined',
      };
    });

    expect(urls).toEqual({
      cvfr: 'https://navaid-tiles.supino.org/CVFR/9/304/205.png',
      navigation: 'https://navaid-tiles.supino.org/Israel-Navigation/9/304/205.png',
      lowAlt: 'https://navaid-tiles.supino.org/LSA-Low-Altitude/9/304/205.png',
      helicopters: 'https://navaid-tiles.supino.org/Israel-Helicopters/9/304/205.png',
      hasProxyHelper: false,
    });
  });
});
