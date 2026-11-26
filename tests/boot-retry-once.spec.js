// @ts-check
// Search Console rendered NavAid as the "could not load a required component" overlay: Google's
// renderer had missed one app script. A required script that fails now costs one reload of the
// page (web only, once per tab session) before the overlay; and the overlay, the same for
// everyone, carries data-nosnippet so a search result never quotes it.
const { test, expect } = require('./_setup');
// deck.js, or the boot bundle that carries it on the deployed site
const { routeAppScript } = require('./_app-scripts');

// Booted in the RELOADED document: the first one can look booted (its failed script does not
// stop the rest) for the 300 ms before the retry reloads it.
const bootedAfterReload = (page) => page.waitForFunction(() =>
  performance.getEntriesByType('navigation')[0].type === 'reload'
  && document.documentElement.classList.contains('nav-booted')
  && typeof draw === 'function', null, { timeout: 20000 });
// Main-frame navigations, not load events: the retry can reload before the first page's load
// event ever fires (it waits on tiles), which made counting loads flaky under CI's parallelism.
function countNavigations(page) {
  const n = { count: 0 };
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) n.count++; });
  return n;
}

test('a script that fails once is retried by one reload, and the app boots', async ({ page }) => {
  let failed = 0;
  await routeAppScript(page, 'app/deck.js', (route) => {
    if (failed++ === 0) return route.fulfill({ status: 503, body: '' });
    return route.continue();
  });
  const navs = countNavigations(page);
  await page.goto('?lang=en&nogist');
  await bootedAfterReload(page);
  await page.waitForTimeout(500);
  expect(navs.count, 'one reload').toBe(2);
  await expect(page.locator('#boot-error')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('navaid.bootRetry')), 'mark cleared by a good boot').toBeNull();
});

test('a script that keeps failing shows the overlay after one retry, marked data-nosnippet', async ({ page }) => {
  await routeAppScript(page, 'app/deck.js', (route) => route.fulfill({ status: 503, body: '' }));
  const navs = countNavigations(page);
  await page.goto('?lang=en&nogist');
  const alert = page.locator('#boot-error');
  await expect(alert).toBeVisible({ timeout: 20000 });
  await expect(alert).toHaveAttribute('data-nosnippet', '');
  expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'shown after the retry').toBe('reload');
  await page.waitForTimeout(1500);
  expect(navs.count, 'exactly one retry, no loop').toBe(2);
});

test('the installed app never retries: a broken bundle stays broken for its rollback', async ({ page }) => {
  await routeAppScript(page, 'app/deck.js', (route) => route.fulfill({ status: 404, body: '' }));
  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  });
  const navs = countNavigations(page);
  await page.goto('?lang=en&nogist');
  await expect(page.locator('#boot-error')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
  expect(navs.count).toBe(1);
});
