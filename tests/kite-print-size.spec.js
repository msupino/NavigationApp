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

// On screen the 0.35 floor in legZoomScale inflates the kite when zoomed out so
// it stays clickable. That floor must NOT apply during PNG export, or a route
// framed on A4 at a low zoom (z9-z10, common for long routes) prints far larger
// than 20 mm. Export must render the kite at its true fixed 1:250,000 paper size
// at every framing zoom.
test('exported leg kite stays a fixed 18.5 x 20 mm at every framing zoom', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    typeof metresPerPixel === 'function' && typeof legZoomScale === 'function' &&
    NavAid && NavAid.tuningDefaults);
  const rows = await page.evaluate(() => {
    for (const k of ['legKiteHeightPx', 'legKiteCellWidthPx', 'legKiteTriangleLenPx']) {
      delete NavAid.tuning[k];
    }
    map.setView([32.0, 34.9], 12);
    const out = [];
    NavAid.exporting = true;
    try {
      for (const z of [9, 10, 11, 12, 13]) {
        map.setZoom(z);
        const mpp = metresPerPixel(), sc = legZoomScale();
        const toMM = px => px * sc * mpp / 250;
        out.push({
          z,
          width: toMM(tune('legKiteCellWidthPx') * 2),
          height: toMM(tune('legKiteHeightPx')),
          triangle: toMM(tune('legKiteTriangleLenPx')),
        });
      }
    } finally {
      NavAid.exporting = false;
    }
    return out;
  });
  for (const r of rows) {
    expect(r.width, `z${r.z} width`).toBeCloseTo(18.5, 0);
    expect(r.height, `z${r.z} height`).toBeCloseTo(20, 0);
    expect(r.triangle, `z${r.z} triangle`).toBeCloseTo(10, 0);
  }
});
