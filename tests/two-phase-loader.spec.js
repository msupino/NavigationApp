// @ts-check
// The modules the first chart does not need (traffic, Follow me, the assistant, the nav log,
// the deck extras, the tour...) are appended after the visible tiles have loaded, so on a slow
// connection they no longer stand between the pilot and the chart.
const { test, expect } = require('./_setup');

const started = (page, file) => page.evaluate((f) => {
  const e = performance.getEntriesByType('resource').find(r => r.name.includes('/app/' + f + '?'));
  return e ? e.startTime : null;
}, file);

test('the second phase starts after the first chart tiles, and before the load event', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const t = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource');
    const tileEnd = Math.max(...res.filter(r => r.initiatorType === 'img' && /\/\d+\/\d+\/\d+\.png/.test(r.name)).map(r => r.responseEnd));
    const first = (f) => (res.find(r => r.name.includes('/app/' + f + '?')) || {}).startTime;
    return {
      ui: first('ui.js'), traffic: first('traffic.js'), ota: first('ota.js'), tileEnd,
      load: performance.getEntriesByType('navigation')[0].loadEventStart,
      followMe: typeof (window.NavAid && NavAid.followMe),
    };
  });
  expect(t.traffic).toBeGreaterThan(t.ui);
  expect(t.traffic).toBeGreaterThanOrEqual(t.tileEnd - 1);
  // Everything is there by the load event, as before: the page has not lost a module.
  expect(t.traffic).toBeLessThan(t.load);
  expect(t.followMe).toBe('object');
});

test('ota.js is still the last script of all', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const last = await page.evaluate(() => [...document.scripts].map(s => s.src).filter(Boolean).pop());
  expect(last).toContain('/app/ota.js');
});

test('tiles that never finish do not hold the second phase back', async ({ page }) => {
  // Every tile request hangs: the cap (LATER_MAX_MS) starts the second phase anyway.
  await page.route(/\/\d+\/\d+\/\d+\.png/, () => { /* never answered */ });
  await page.goto('?lang=en&nogist', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.NavAid && NavAid.followMe, null, { timeout: 10000 });
  expect(await started(page, 'traffic.js')).toBeGreaterThan(3000);
});
