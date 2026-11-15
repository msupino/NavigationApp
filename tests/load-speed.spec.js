// @ts-check
// PageSpeed gave up on navaid.supino.org ("RPC::DEADLINE_EXCEEDED") and scored the first view
// slow. What the first load no longer does, and what it does later instead.
const { test, expect } = require('./_setup');

test('the automatic CVFR download waits for the first tap', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidOfflineTiles && document.readyState === 'complete');
  expect(await page.evaluate(() => NavAidOfflineTiles.autoArmed)).toBe(false);
  await page.locator('#map').click({ position: { x: 40, y: 200 } });
  await expect.poll(() => page.evaluate(() => NavAidOfflineTiles.autoArmed)).toBe(true);
});

test('...or for a minute on screen without one', async ({ page }) => {
  await page.clock.install();
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidOfflineTiles && document.readyState === 'complete');
  await page.clock.runFor(30000);
  expect(await page.evaluate(() => NavAidOfflineTiles.autoArmed)).toBe(false);
  await page.clock.runFor(31000);
  expect(await page.evaluate(() => NavAidOfflineTiles.autoArmed)).toBe(true);
});

test('the analytics tag and the preconnects stay off a test host; the world map still loads', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.readyState === 'complete');
  const r = await page.evaluate(() => ({
    gtag: !!document.querySelector('script[src*="googletagmanager"]'),
    preconnect: document.querySelectorAll('link[rel="preconnect"]').length,
  }));
  expect(r).toEqual({ gtag: false, preconnect: 0 });
  // Deferred to idle after load, not dropped.
  await page.waitForFunction(() => NavAid.worldOffline && NavAid.worldOffline.load().then(ok => ok === true));
});
