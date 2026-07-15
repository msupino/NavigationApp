// @ts-check
// Coverage for plateBase() (io.js) — resolves the shared BYOP plate root
// from the page's location so the single root copy of the ~133 MB PDFs is
// reachable on every host/preview without a deploy-time path rewrite.
//   - custom domain (served at '/'):        '/byop/'
//   - raw GitHub Pages ('/NavigationApp/'):  '/NavigationApp/byop/'
//   - staging / pr / branch previews strip back to the shared root.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof plateBase === 'function');
}

test.describe('plateBase()', () => {
  test('resolves the shared root across hosts and previews', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => ({
      // custom domain (root)
      prodRoot:     plateBase('/'),
      prodIndex:    plateBase('/index.html'),
      staging:      plateBase('/staging/'),
      pr:           plateBase('/pr/456/'),
      branch:       plateBase('/branch/dev-undo/'),
      branchSlash:  plateBase('/branch/feat/loading-charts-indicator/'),
      // raw GitHub Pages (repo sub-path)
      ghProd:       plateBase('/NavigationApp/'),
      ghStaging:    plateBase('/NavigationApp/staging/'),
      ghPr:         plateBase('/NavigationApp/pr/456/'),
      ghBranch:     plateBase('/NavigationApp/branch/feat-x/'),
      ghBranchSlash: plateBase('/NavigationApp/branch/feat/plate-png/'),
    }));
    expect(out).toEqual({
      prodRoot:  '/byop/',
      prodIndex: '/byop/',
      staging:   '/byop/',
      pr:        '/byop/',
      branch:    '/byop/',
      branchSlash: '/byop/',
      ghProd:    '/NavigationApp/byop/',
      ghStaging: '/NavigationApp/byop/',
      ghPr:      '/NavigationApp/byop/',
      ghBranch:  '/NavigationApp/byop/',
      ghBranchSlash: '/NavigationApp/byop/',
    });
  });

  test('plateUrl encodes the filename onto the resolved base', async ({ page }) => {
    await boot(page);
    const url = await page.evaluate(() => plateUrl('LLHZ_Ground_Parking F.pdf'));
    // Test server serves at '/', so the base is '/byop/'.
    expect(url).toBe('/byop/LLHZ_Ground_Parking%20F.pdf');
  });

  // Regression for the staging 404 (#457): showPlateViewer must load the plate
  // at the location-resolved base and actually receive it. Plates now render as
  // per-page PNGs, so the resolved page-image URL must return 200 and the
  // loading overlay must NOT flip to the plateLoadError text. On a host where
  // the prefix is wrong (the original bug) this 404s and the test fails.
  test('opening a plate loads its page image and does not error', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(
      () => typeof showPlateViewer === 'function' && typeof S === 'object');

    // Filename carries a space → encodes to %20, same class as the bug's
    // `LLHZ_Ground_Parking F.pdf`. The file exists under docs/byop/.
    const FILE = 'LLHZ_airport_Annex Alef.pdf';

    const respPromise = page.waitForResponse(
      r => r.url().includes('/byop/') && /-p\d+\.png(\?|$)/i.test(r.url()));
    await page.evaluate((f) => showPlateViewer(f, 'Annex Alef'), FILE);

    const resp = await respPromise;
    expect(resp.url()).toContain('/byop/LLHZ_airport_Annex%20Alef-p01.png');
    expect(resp.status()).toBe(200);

    // The overlay must never show the failure string for a reachable plate.
    const errText = await page.evaluate(() => S.plateLoadError);
    await expect(page.locator('.plate-loading')).not.toContainText(errText);
  });
});
