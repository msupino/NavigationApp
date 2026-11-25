// @ts-check
// Search Console rendered NavAid as the "could not load a required component" overlay: Google's
// renderer had missed one app script. A required script that fails now costs one reload of the
// page (web only, once per tab session) before the overlay; and the overlay, the same for
// everyone, carries data-nosnippet so a search result never quotes it.
const { test, expect } = require('./_setup');

const booted = (page) => page.waitForFunction(() => document.documentElement.classList.contains('nav-booted')
  && typeof draw === 'function', null, { timeout: 20000 });

test('a script that fails once is retried by one reload, and the app boots', async ({ page }) => {
  let failed = 0;
  await page.route('**/app/deck.js*', (route) => {
    if (failed++ === 0) return route.fulfill({ status: 503, body: '' });
    return route.continue();
  });
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.goto('?lang=en&nogist');
  await booted(page);
  await page.waitForTimeout(500);
  expect(loads, 'one reload').toBe(2);
  await expect(page.locator('#boot-error')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('navaid.bootRetry')), 'mark cleared by a good boot').toBeNull();
});

test('a script that keeps failing shows the overlay after one retry, marked data-nosnippet', async ({ page }) => {
  await page.route('**/app/deck.js*', (route) => route.fulfill({ status: 503, body: '' }));
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.goto('?lang=en&nogist');
  const alert = page.locator('#boot-error');
  await expect(alert).toBeVisible({ timeout: 20000 });
  await expect(alert).toHaveAttribute('data-nosnippet', '');
  await page.waitForTimeout(1500);
  expect(loads, 'exactly one retry, no loop').toBe(2);
});

test('the installed app never retries: a broken bundle stays broken for its rollback', async ({ page }) => {
  await page.route('**/app/deck.js*', (route) => route.fulfill({ status: 404, body: '' }));
  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  });
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.goto('?lang=en&nogist');
  await expect(page.locator('#boot-error')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
  expect(loads).toBe(1);
});
