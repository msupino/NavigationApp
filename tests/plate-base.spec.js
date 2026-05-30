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
      // raw GitHub Pages (repo sub-path)
      ghProd:       plateBase('/NavigationApp/'),
      ghStaging:    plateBase('/NavigationApp/staging/'),
      ghPr:         plateBase('/NavigationApp/pr/456/'),
      ghBranch:     plateBase('/NavigationApp/branch/feat-x/'),
    }));
    expect(out).toEqual({
      prodRoot:  '/byop/',
      prodIndex: '/byop/',
      staging:   '/byop/',
      pr:        '/byop/',
      branch:    '/byop/',
      ghProd:    '/NavigationApp/byop/',
      ghStaging: '/NavigationApp/byop/',
      ghPr:      '/NavigationApp/byop/',
      ghBranch:  '/NavigationApp/byop/',
    });
  });

  test('plateUrl encodes the filename onto the resolved base', async ({ page }) => {
    await boot(page);
    const url = await page.evaluate(() => plateUrl('LLHZ_Ground_Parking F.pdf'));
    // Test server serves at '/', so the base is '/byop/'.
    expect(url).toBe('/byop/LLHZ_Ground_Parking%20F.pdf');
  });
});
