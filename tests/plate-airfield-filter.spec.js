// @ts-check
// "Show plates for" per-airfield filter (Airfield-plates group): a multi-select
// checkbox list. Tick one or more fields to show only their plates (so close
// fields like LLKS & LLIB don't overlap); none ticked = every field (default).
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

test('checkbox list populates once plates load; none ticked shows every field', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  const boxes = page.locator('#plate-airfields input[type="checkbox"]');
  await expect.poll(() => boxes.count()).toBeGreaterThan(1);
  expect(await boxes.evaluateAll(els => els.every(e => !e.checked))).toBe(true);
  await page.waitForFunction(() => window.cvfrLayerGroup &&
    cvfrLayerGroup.getLayers().length > 1);
});

test('ticking fields limits plates to them; unticking all restores every plate', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  await page.waitForFunction(() => window.cvfrLayerGroup &&
    cvfrLayerGroup.getLayers().length > 1);
  const all = await page.evaluate(() => cvfrLayerGroup.getLayers().length);

  // LLMG + LLFK both carry a cvfr_overlay.
  await page.locator('#plate-airfields input[value="LLMG"]').check();
  await page.locator('#plate-airfields input[value="LLFK"]').check();
  const two = await page.evaluate(() =>
    cvfrLayerGroup.getLayers().map(l => l._ovPng).sort());
  expect(two).toEqual(['LLFK_cvfr.png', 'LLMG_cvfr.png']);

  await page.locator('#plate-airfields input[value="LLMG"]').uncheck();
  const one = await page.evaluate(() =>
    cvfrLayerGroup.getLayers().map(l => l._ovPng));
  expect(one).toEqual(['LLFK_cvfr.png']);

  await page.locator('#plate-airfields input[value="LLFK"]').uncheck();
  const restored = await page.evaluate(() => cvfrLayerGroup.getLayers().length);
  expect(restored).toBe(all);
});

test('selection persists across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  await expect.poll(
    () => page.locator('#plate-airfields input[type="checkbox"]').count()
  ).toBeGreaterThan(1);
  await page.locator('#plate-airfields input[value="LLMG"]').check();
  await page.reload();
  await page.waitForFunction(() => document.getElementById('plate-airfields'));
  expect(await page.evaluate(() => window.plateAirfields)).toContain('LLMG');
});
