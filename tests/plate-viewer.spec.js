// Airfield plate (approach chart) viewer.
// Plates are PDFs. The Android WebView (Capacitor shell) has no built-in PDF
// renderer, so the old <iframe src=blob:pdf> hung on "Loading..." forever.
// showPlateViewer now renders each page to a <canvas> via PDF.js, which works
// the same in the WebView and browsers.
const { test, expect } = require('./_setup');

// A fake pdfjsLib so the viewer never reaches for the CDN in CI. getDocument
// resolves a 1-page doc whose render() completes immediately.
async function stubPdfjs(page) {
  await page.evaluate(() => {
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      __rendered: 0,
      getDocument() {
        return { promise: Promise.resolve({
          numPages: 1,
          getPage() {
            return Promise.resolve({
              getViewport({ scale }) { return { width: 200 * scale, height: 300 * scale }; },
              render() { window.pdfjsLib.__rendered++; return { promise: Promise.resolve() }; },
            });
          },
        }) };
      },
    };
  });
}

test.describe('Airfield plate viewer (PDF.js canvas)', () => {
  test('renders the plate to a canvas and clears the loading state', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof showPlateViewer === 'function');
    await stubPdfjs(page);
    // Stub window.fetch (not page.route): a service worker proxies the /byop/
    // request, and Playwright's page.route doesn't intercept SW-initiated
    // fetches. The stubbed pdfjsLib ignores the bytes.
    await page.evaluate(() => {
      const real = window.fetch;
      window.fetch = (u, o) => String(u).includes('/byop/')
        ? Promise.resolve(new Response(new Blob(['%PDF-1.4 stub'], { type: 'application/pdf' }), { status: 200 }))
        : real(u, o);
    });

    await page.evaluate(() => showPlateViewer('LLHZ_APPROACH_RWY_29.pdf', 'LLHZ Approach'));

    const viewer = page.locator('.plate-viewer .plate-canvas-wrap canvas.plate-canvas');
    await expect(viewer).toHaveCount(1);                              // page drawn
    await expect(page.locator('.plate-viewer .plate-loading')).toBeHidden();  // no phantom "Loading..."
    expect(await page.evaluate(() => window.pdfjsLib.__rendered)).toBe(1);
    await expect(page.locator('.plate-viewer .modal-title')).toHaveText('LLHZ Approach');
  });

  test('a failed plate fetch shows the load error, not an endless spinner', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof showPlateViewer === 'function' && typeof S === 'object');
    await stubPdfjs(page);
    await page.evaluate(() => {
      const real = window.fetch;
      window.fetch = (u, o) => String(u).includes('/byop/')
        ? Promise.resolve(new Response('nope', { status: 404 }))
        : real(u, o);
    });

    await page.evaluate(() => showPlateViewer('LLHZ_MISSING.pdf', 'Missing'));

    const loading = page.locator('.plate-viewer .plate-loading');
    const expected = await page.evaluate(() => S.plateLoadError);
    await expect(loading).toBeVisible();
    await expect(loading).toContainText(expected);
  });

  test('prefetchPlate warms a plate URL once (deduped) so a later open hits cache', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() =>
      typeof prefetchPlate === 'function' && typeof plateUrl === 'function');
    const calls = await page.evaluate(() => {
      const seen = [];
      const real = window.fetch;
      window.fetch = (u) => { seen.push(String(u)); return Promise.resolve(new Response('', { status: 200 })); };
      try {
        prefetchPlate('LLBG_SID_08.pdf');
        prefetchPlate('LLBG_SID_08.pdf');   // same chip hovered again → deduped
        prefetchPlate('LLHZ_VAC.pdf');
      } finally { window.fetch = real; }
      return seen;
    });
    expect(calls.length).toBe(2);                 // repeat deduped
    expect(calls[0]).toContain('/byop/');
    expect(calls[0]).toContain('LLBG_SID_08.pdf');
    expect(calls[1]).toContain('LLHZ_VAC.pdf');
  });
});
