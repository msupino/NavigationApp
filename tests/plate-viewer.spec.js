// Airfield plate viewer — plates are shown as pre-rendered PNG pages
// (scripts/render-plates.sh, poppler): poppler renders the embedded Hebrew CID
// fonts correctly (PDF.js garbled them) and images work in the Android WebView,
// which has no native PDF renderer. Page count comes from
// docs/byop/plates-manifest.json; the original PDF stays for download.
const { test, expect } = require('./_setup');

test.describe('Airfield plate viewer (pre-rendered PNGs)', () => {
  test('renders all plate pages as PNGs and clears the loading state', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() =>
      typeof showPlateViewer === 'function' && typeof loadPlatesManifest === 'function');
    // Uses the real committed assets: LLBS_airport_Chart is a 10-page plate.
    await page.evaluate(() => showPlateViewer('LLBS_airport_Chart.pdf', 'airport Chart'));

    const imgs = page.locator('.plate-viewer .plate-canvas-wrap img.plate-canvas');
    await expect(imgs).toHaveCount(10);                                  // manifest page count
    await expect(imgs.first()).toHaveAttribute('src', /\/byop\/LLBS_airport_Chart-p01\.png/);
    await expect(page.locator('.plate-viewer .plate-loading')).toBeHidden();  // no phantom spinner
    await expect(page.locator('.plate-viewer .modal-title')).toHaveText('airport Chart');
  });

  test('a missing plate image shows the load error, not an endless spinner', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() =>
      typeof showPlateViewer === 'function' && typeof S === 'object');
    // Not in the manifest → falls back to 1 page; the p01 PNG 404s → error.
    await page.evaluate(() => showPlateViewer('ZZZZ_none.pdf', 'None'));

    const loading = page.locator('.plate-viewer .plate-loading');
    const expected = await page.evaluate(() => S.plateLoadError);
    await expect(loading).toBeVisible();
    await expect(loading).toContainText(expected);
  });

  test('prefetchPlate warms the first-page PNG once (deduped)', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() =>
      typeof prefetchPlate === 'function' && typeof platePngUrl === 'function');
    const png = await page.evaluate(() => {
      const seen = [];
      const real = window.fetch;
      window.fetch = (u) => { seen.push(String(u)); return Promise.resolve(new Response('', { status: 200 })); };
      try {
        prefetchPlate('LLBS_airport_Chart.pdf');
        prefetchPlate('LLBS_airport_Chart.pdf');   // same chip again → deduped
        prefetchPlate('LLHZ_airport_Text.pdf');
      } finally { window.fetch = real; }
      return seen.filter(u => /-p01\.png/.test(u));   // just the page-image warms
    });
    expect(png.length).toBe(2);                       // one per distinct plate
    expect(png[0]).toContain('/byop/');
    expect(png[0]).toContain('LLBS_airport_Chart-p01.png');
    expect(png[1]).toContain('LLHZ_airport_Text-p01.png');
  });
});
