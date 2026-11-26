// @ts-check
// The modules the first chart does not need (traffic, Follow me, the assistant, the nav log,
// the deck extras, the tour...) are appended after the visible tiles have loaded, so on a slow
// connection they no longer stand between the pilot and the chart.
const { test, expect } = require('./_setup');
// On the deployed site each phase is one download, app/boot.bundle.js or app/later.bundle.js
// (tests/_app-scripts.js): a file's start is its bundle's.
const { PHASE_BUNDLE, resourceStartFn, loadedAppScriptsFn } = require('./_app-scripts');

const started = (page, file) => page.evaluate(resourceStartFn, { f: file, bundle: PHASE_BUNDLE[file] });

test('the second phase starts after the first chart tiles, and before the load event', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const ui = await started(page, 'ui.js');
  const traffic = await started(page, 'traffic.js');
  const t = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource');
    const tileEnd = Math.max(...res.filter(r => r.initiatorType === 'img' && /\/\d+\/\d+\/\d+\.png/.test(r.name)).map(r => r.responseEnd));
    return {
      tileEnd,
      load: performance.getEntriesByType('navigation')[0].loadEventStart,
      followMe: typeof (window.NavAid && NavAid.followMe),
    };
  });
  expect(traffic).toBeGreaterThan(ui);
  expect(traffic).toBeGreaterThanOrEqual(t.tileEnd - 1);
  // Everything is there by the load event, as before: the page has not lost a module.
  expect(traffic).toBeLessThan(t.load);
  expect(t.followMe).toBe('object');
});

test('ota.js is still the last script of all', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.followMe);   // the second phase ran
  const last = (await page.evaluate(loadedAppScriptsFn)).pop();
  expect(last).toBe('app/ota.js');
});

test('tiles that never finish do not hold the second phase back', async ({ page }) => {
  // Every tile request hangs: the cap (LATER_MAX_MS) starts the second phase anyway.
  await page.route(/\/\d+\/\d+\/\d+\.png/, () => { /* never answered */ });
  await page.goto('?lang=en&nogist', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.NavAid && NavAid.followMe, null, { timeout: 10000 });
  expect(await started(page, 'traffic.js')).toBeGreaterThan(3000);
});
