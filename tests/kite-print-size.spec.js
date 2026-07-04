// @ts-check
// The leg-kite default size is anchored at z12 (legZoomScale = 2^(z-12)), so it
// maps to a fixed paper size at the app's 1:250,000 page-frame scale:
// 1 mm = 250 m on the ground. Default kite = 18.5 mm wide × 20 mm tall square
// with a 10 mm triangle. Guards the code DEFAULTS (independent of the live
// tuning gist, whose override is cleared here).
const { test, expect } = require('./_setup');

test('default leg kite is 18.5 x 20 mm with a 10 mm triangle at 1:250,000', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    typeof metresPerPixel === 'function' && typeof legZoomScale === 'function' &&
    NavAid && NavAid.tuningDefaults);
  const mm = await page.evaluate(() => {
    // Use the code defaults, not any gist/localStorage override.
    for (const k of ['legKiteHeightPx', 'legKiteCellWidthPx', 'legKiteTriangleLenPx']) {
      delete NavAid.tuning[k];
    }
    map.setView([32.0, 34.9], 12);
    const mpp = metresPerPixel(), sc = legZoomScale();   // sc === 1 at z12
    const toMM = px => px * sc * mpp / 250;               // 1:250,000: 1 mm = 250 m
    return {
      width: toMM(tune('legKiteCellWidthPx') * 2),
      height: toMM(tune('legKiteHeightPx')),
      triangle: toMM(tune('legKiteTriangleLenPx')),
      sc,
    };
  });
  expect(mm.sc).toBeCloseTo(1, 5);
  expect(mm.width).toBeCloseTo(18.5, 0);     // ±0.5 mm
  expect(mm.height).toBeCloseTo(20, 0);
  expect(mm.triangle).toBeCloseTo(10, 0);
});
