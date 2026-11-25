// @ts-check
// Reported from the Android app: in the waypoint zoom view the layer picker sat ~55 px down into
// the map. The app is drawn edge to edge, so env(safe-area-inset-top) is the status bar's height,
// and the main map's rule ".leaflet-top { padding-top: env(safe-area-inset-top) }" also applied
// to this map inside a dialog. A browser reports 0, so this emulates the inset (Chrome DevTools).
const { test, expect } = require('./_setup');

test('a top safe-area inset does not push the zoom view\'s layer picker into the map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  let emulated = true;
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 28, topMax: 28 } });
  } catch (e) { emulated = false; }
  test.skip(!emulated, 'this browser cannot emulate safe-area insets');
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showSatellitePreviewModal === 'function'
    && typeof clearBootLoading === 'function');
  const inset = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px)';
    document.body.appendChild(d);
    const h = d.getBoundingClientRect().height;
    d.remove();
    return h;
  });
  expect(inset, 'the emulated inset is in effect').toBe(28);
  await page.evaluate(() => showSatellitePreviewModal({ lat: 32.14, lng: 34.8017 }, 'KNTRY'));
  await page.waitForFunction(() => !!document.querySelector('.satellite-layer-control'));
  const gap = await page.evaluate(() => Math.round(
    document.querySelector('.satellite-layer-control').getBoundingClientRect().top
    - document.querySelector('.satellite-preview-map').getBoundingClientRect().top));
  // Leaflet's own control margin (10 px) and no more.
  expect(gap).toBeLessThanOrEqual(14);
});
