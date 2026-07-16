// @ts-check
// "Show plates for" picker (Airfield-plates group). Modes:
//   All (default)  – every field's plates
//   Auto           – only the first & last airfield on the current route
//   custom         – an explicit checkbox selection
const { test, expect } = require('./_setup');

test.use({ serviceWorkers: 'block' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64'
);

async function boot(page) {
  await page.route(/(cvfr|circuit|training|heli|commfail)-img\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(
    () => typeof map !== 'undefined' && document.getElementById('plate-airfields'));
}

const cvfrPngs = (page) => page.evaluate(
  () => (window.cvfrLayerGroup ? cvfrLayerGroup.getLayers().map(l => l._ovPng).sort() : []));

async function setRoute(page, names) {
  await page.evaluate((ns) => {
    state.waypoints = ns.map((n, i) => ({ name: n, lat: 32 + i * 0.1, lng: 34.8 }));
    syncLegs();
  }, names);
}

test('defaults to All: every plate shows and All is checked', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  await expect.poll(() => page.locator('#plate-airfields .plate-af-cb').count()).toBeGreaterThan(1);
  await expect(page.locator('#plate-all')).toBeChecked();
  await page.waitForFunction(() => window.cvfrLayerGroup && cvfrLayerGroup.getLayers().length > 1);
  const all = (await cvfrPngs(page)).length;
  expect(all).toBeGreaterThan(1);
});

test('All off = none; ticking fields shows only those; All on restores', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  await page.waitForFunction(() => window.cvfrLayerGroup && cvfrLayerGroup.getLayers().length > 1);
  const all = (await cvfrPngs(page)).length;

  await page.locator('#plate-all').uncheck();
  expect(await cvfrPngs(page)).toEqual([]);

  await page.locator('#plate-airfields input[value="LLMG"]').check();
  await page.locator('#plate-airfields input[value="LLFK"]').check();
  expect(await cvfrPngs(page)).toEqual(['LLFK_cvfr.png', 'LLMG_cvfr.png']);

  await page.locator('#plate-all').check();
  expect((await cvfrPngs(page)).length).toBe(all);
});

test('Auto shows route endpoints, follows edits, and All turns Auto off', async ({ page }) => {
  await boot(page);
  await setRoute(page, ['LLHZ', 'LLMG', 'LLFK']);   // endpoints LLHZ, LLFK
  await page.locator('#cvfr-cb').check();
  await page.locator('#plate-auto').check();
  expect(await cvfrPngs(page)).toEqual(['LLFK_cvfr.png', 'LLHZ_cvfr.png']);

  // edit the route → filter follows (endpoints become LLMZ, LLMG)
  await setRoute(page, ['LLMZ', 'LLMG']);
  await expect.poll(() => cvfrPngs(page)).toEqual(['LLMG_cvfr.png', 'LLMZ_cvfr.png']);

  // fields stay enabled while Auto is on
  await expect(page.locator('#plate-airfields input[value="LLMG"]')).toBeEnabled();

  // ticking All turns Auto off and shows every field
  await page.locator('#plate-all').check();
  await expect(page.locator('#plate-auto')).not.toBeChecked();
  expect(await page.evaluate(() => window.plateMode)).toBe('all');
  expect((await cvfrPngs(page)).length).toBeGreaterThan(2);
});

test('picking a field while Auto is on turns Auto off and keeps the visible checks', async ({ page }) => {
  await boot(page);
  await setRoute(page, ['LLHZ', 'LLFK']);
  await page.locator('#cvfr-cb').check();
  await page.locator('#plate-auto').check();
  expect(await cvfrPngs(page)).toEqual(['LLFK_cvfr.png', 'LLHZ_cvfr.png']);

  // unticking one shown endpoint → custom (Auto off), the other endpoint stays
  await page.locator('#plate-airfields input[value="LLHZ"]').uncheck();
  await expect(page.locator('#plate-auto')).not.toBeChecked();
  expect(await page.evaluate(() => window.plateMode)).toBe('custom');
  expect(await cvfrPngs(page)).toEqual(['LLFK_cvfr.png']);
});

test('mode + selection persist across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  await expect.poll(() => page.locator('#plate-airfields .plate-af-cb').count()).toBeGreaterThan(1);
  await page.locator('#plate-all').uncheck();
  await page.locator('#plate-airfields input[value="LLMG"]').check();
  await page.reload();
  await page.waitForFunction(() => document.getElementById('plate-airfields'));
  expect(await page.evaluate(() => window.plateMode)).toBe('custom');
  expect(await page.evaluate(() => window.plateAirfields)).toContain('LLMG');
});
