// @ts-check
// The deployed site packs the app scripts into two downloads (scripts/bundle-app.mjs), because
// Google's renderer skipped some of ~44 ("Other error" on app/draw.js and app/terrain.js) and
// recorded the boot-error overlay as the page. These boot the app the way a deployed copy does --
// the bundler's own index.html and bundles, served in place of the source tree's -- and check it
// is the same program: every file runs, in order, each as its own script.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');

async function servePlan(page, tweak) {
  const { planBundles } = await import('../scripts/bundle-app.mjs');
  const plan = planBundles(fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8'),
    (f) => fs.readFileSync(path.join(DOCS, f), 'utf8'));
  expect(plan, 'the loader supports bundles').not.toBeNull();
  if (tweak) tweak(plan);
  const fetched = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (/\/app\/[^/]+\.js$/.test(u.pathname)) fetched.push(u.pathname.split('/').pop()); });
  // The page itself, wherever the suite serves it: '/' locally, '/pr/<n>/' in the deployed run.
  await page.route((url) => url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'), (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: plan.indexHtml }));
  await page.route('**/app/*.bundle.js*', (route) => {
    const name = 'app/' + new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: plan.bundles[name] });
  });
  return { plan, fetched };
}

test('a bundled site boots as the same program, from two app downloads', async ({ page }) => {
  const { plan, fetched } = await servePlan(page);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.documentElement.classList.contains('nav-booted')
    && typeof draw === 'function' && typeof showInspector === 'function', null, { timeout: 20000 });
  // The later phase too: its last file is the update module.
  await page.waitForFunction(() => window.NavAid && NavAid.ota, null, { timeout: 20000 });
  await expect(page.locator('#boot-error')).toHaveCount(0);
  const ran = await page.evaluate(() => [...document.querySelectorAll('script[data-src]')].map((s) => s.getAttribute('data-src')));
  const listed = Object.values(plan.bundles).length;
  expect(listed).toBe(2);
  // Every bundled file ran, once, in the loader's order.
  const order = [];
  for (const src of Object.values(plan.bundles)) for (const m of src.matchAll(/^\["((?:app|data)\/[^"]+)",/gm)) order.push(m[1]);
  expect(ran).toEqual(order);
  expect(order).toContain('app/core.js');
  expect(order).toContain('app/ota.js');
  expect([...new Set(fetched)].sort(), 'only the two bundles are downloaded').toEqual(['boot.bundle.js', 'later.bundle.js']);
  expect(await page.evaluate(() => window.__navaidBootBroke)).toBe(false);
});

test('a throw in one bundled file stays in that file, as with separate scripts', async ({ page }) => {
  await servePlan(page, (plan) => {
    // Break the update module's neighbour in the later bundle: the files after it still run.
    plan.bundles['app/later.bundle.js'] = plan.bundles['app/later.bundle.js']
      .replace(/\["app\/tour\.js",/, '["app/tour.js","throw new Error(\\"tour broke\\");\\n"],["app/tour-real.js",');
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.ota, null, { timeout: 20000 });
  expect(await page.evaluate(() => window.__navaidBootBroke), 'the boot health check saw it').toBe(true);
});
