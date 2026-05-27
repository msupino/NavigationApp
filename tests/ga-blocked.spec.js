// @ts-check
// Verify the _setup.js fixture actually prevents any Google Analytics traffic
// from leaving the test page — guards against future tweaks to the production
// GA4 wiring slipping through unblocked.
const { test, expect } = require('./_setup');

const GA_RE = /(googletagmanager|google-analytics|analytics\.google|doubleclick)\.(com|net)/;

test.describe('Google Analytics blocking', () => {
  test('no GA / GTM request completes successfully', async ({ page }) => {
    const completed = [];
    page.on('requestfinished', req => {
      if (GA_RE.test(req.url())) completed.push(req.url());
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined');
    // Mimic the production tag's flow: route the call through the real gtag
    // (which the inline <script> in index.html redeclared). gtag() pushes to
    // window.dataLayer; our stubbed push is a no-op so nothing escapes.
    await page.evaluate(() => {
      if (typeof gtag === 'function') gtag('event', 'page_view');
    });
    await page.waitForTimeout(400);              // give any beacon time to fire
    expect(completed).toEqual([]);
  });

  test('dataLayer.push is stubbed — items never accumulate', async ({ page }) => {
    await page.goto('?lang=en');
    // The production inline script calls gtag() twice on boot ('js', 'config').
    // Both go through dataLayer.push. With the stub, the array (now an object
    // posing as an array) never grows.
    const len = await page.evaluate(() => {
      if (typeof gtag === 'function') gtag('event', 'page_view');
      return Array.isArray(window.dataLayer) ? window.dataLayer.length : 'stubbed';
    });
    expect(len).toBe('stubbed');
  });

  test('GA requests that did fire were aborted by the route handler',
    async ({ page }) => {
      const failed = [];
      page.on('requestfailed', req => {
        if (GA_RE.test(req.url())) failed.push(req.failure() && req.failure().errorText);
      });
      await page.goto('?lang=en');
      // On PR/branch previews GA is intentionally skipped entirely.
      const gaLoaded = await page.evaluate(() =>
        document.querySelector('script[src*="googletagmanager"]') !== null
      );
      if (!gaLoaded) return;   // nothing to block
      await page.waitForTimeout(400);
      // gtag/js loader is requested by the production <script async> tag. If
      // the fixture is working, it appears in `failed` with errorText like
      // 'net::ERR_FAILED' or 'net::ERR_BLOCKED_BY_CLIENT'.
      expect(failed.length).toBeGreaterThan(0);
      for (const why of failed) expect(why).toMatch(/ERR/);
    });
});
