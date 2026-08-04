// @ts-check
// One-off generator for docs/assets/og-preview.jpg (Open Graph / Twitter card
// image, 1200×630). On demand only:
//   OG_PREVIEW=1 npx playwright test tests/og-preview.spec.js --reporter=line
const { test } = require('./_setup');
const path = require('path');
const { LLHZ, LLHA } = require('./_airfieldArp');

// Nothing used to enforce the "not part of the regular suite" above, so every full-suite
// run silently rewrote a COMMITTED asset: the file then rode along in whatever PR was open
// (it reached #1417 as a 14 KB-larger image nobody had asked for). Same guard the other
// generator uses — see wiki-screenshots.spec.js and its WIKI_IMG check.
test.skip(!process.env.OG_PREVIEW,
  'og-preview generator — set OG_PREVIEW to run');

// 11-waypoint LLHZ → LLHA coastal route — same fixture share-route.spec.js
// uses, so the preview image stays in sync with the canonical demo route.
const ROUTE = [
  { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
  { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
  { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
  { lat: 32.32306, lng: 34.90389, name: 'SHARO' },
  { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
  { lat: 32.59194, lng: 34.94639, name: 'FRDIS' },
  { lat: 32.71444, lng: 34.97083, name: 'BOREN' },
  { lat: 32.75389, lng: 34.93694, name: 'HOTRM' },
  { lat: 32.79611, lng: 34.94333, name: 'DAROM' },
  { lat: 32.84111, lng: 34.98111, name: 'GALIM' },
  { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
];

test.describe('Social media preview image', () => {
  test.use({ viewport: { width: 1200, height: 630 } });

  test('docs/assets/og-preview.jpg captured fresh', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear(); sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        // CVFR layer matches the published Israel aeronautical chart that
        // the site is built around.
        localStorage.setItem('navaid.layer', 'CVFR');
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() =>
      typeof state !== 'undefined' && typeof draw === 'function');
    await page.evaluate(route => {
      state.waypoints = route.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
      syncLegs();
      fitView();
      draw();
    }, ROUTE);
    // Wait for tiles to settle.
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(__dirname, '..', 'docs', 'assets', 'og-preview.jpg'),
      type: 'jpeg',
      quality: 85,
      fullPage: false,
    });
  });
});
