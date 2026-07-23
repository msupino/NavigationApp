// @ts-check
// "Show plates for" per-airfield filter (Airfield-plates group). Limits every
// plate overlay to a single airfield so close fields (e.g. LLKS & LLIB) don't
// overlap. Default is "All airfields" (every field's plates, as before).
const { test, expect } = require('./_setup');

test.use({ serviceWorkers: 'block' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64'
);

async function boot(page) {
  await page.route(/-(img)\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/(cvfr|circuit|training|heli|commfail)-img\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(
    () => typeof map !== 'undefined' && document.getElementById('plate-airfield'));
}

test('picker is populated once plates load and defaults to All airfields', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  const sel = page.locator('#plate-airfield');
  await expect.poll(() => sel.locator('option').count()).toBeGreaterThan(1);
  await expect(sel).toHaveValue('');                     // "All airfields"
  // First option is the All entry (empty value).
  expect(await sel.locator('option').first().getAttribute('value')).toBe('');
});

test('choosing an airfield limits plates to that field; All restores every plate', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  await page.waitForFunction(() => window.cvfrLayerGroup &&
    cvfrLayerGroup.getLayers().length > 1);

  const all = await page.evaluate(() => cvfrLayerGroup.getLayers().length);
  expect(all).toBeGreaterThan(1);

  // LLMG has a cvfr_overlay — filtering to it must leave exactly its plate.
  await page.selectOption('#plate-airfield', 'LLMG');
  const only = await page.evaluate(() =>
    cvfrLayerGroup.getLayers().map(l => l._ovPng));
  expect(only).toEqual(['LLMG_cvfr.png']);

  // Back to All → every cvfr plate again.
  await page.selectOption('#plate-airfield', '');
  const restored = await page.evaluate(() => cvfrLayerGroup.getLayers().length);
  expect(restored).toBe(all);
});

test('the filter persists across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#cvfr-cb').check();
  await expect.poll(() => page.locator('#plate-airfield option').count()).toBeGreaterThan(1);
  await page.selectOption('#plate-airfield', 'LLMG');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('plate-airfield'));
  // stored value is applied to window.plateAirfield on boot
  expect(await page.evaluate(() => window.plateAirfield)).toBe('LLMG');
});

async function setRoute(page, names) {
  await page.evaluate((ns) => {
    state.waypoints = ns.map((n, i) => ({ name: n, lat: 32 + i * 0.1, lng: 34.8 }));
    syncLegs();
  }, names);
}

test('Auto with no route falls back to showing every field (not none)', async ({ page }) => {
  await boot(page);
  // saved 'auto' from a previous session, but no route loaded
  await page.evaluate(() => { localStorage.setItem('navaid.plateAirfield', 'auto'); });
  await page.reload();
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('plate-airfield'));
  await page.locator('#cvfr-cb').check();
  await page.waitForFunction(() => window.cvfrLayerGroup);
  const shown = await page.evaluate(() => cvfrLayerGroup.getLayers().length);
  expect(shown).toBeGreaterThan(1);   // all fields, not an empty map
});

test('Auto option shows only the route first & last airfield and follows edits', async ({ page }) => {
  await boot(page);
  await setRoute(page, ['LLHZ', 'LLMG', 'LLFK']);   // endpoints LLHZ, LLFK
  await page.locator('#cvfr-cb').check();
  await expect(page.locator('#plate-airfield option[value="auto"]')).toHaveCount(1);

  await page.selectOption('#plate-airfield', 'auto');
  expect(await page.evaluate(() => cvfrLayerGroup.getLayers().map(l => l._ovPng).sort()))
    .toEqual(['LLFK_cvfr.png', 'LLHZ_cvfr.png']);

  // edit the route → Auto follows (endpoints become LLMZ, LLMG)
  await setRoute(page, ['LLMZ', 'LLMG']);
  await expect.poll(() => page.evaluate(
    () => cvfrLayerGroup.getLayers().map(l => l._ovPng).sort()))
    .toEqual(['LLMG_cvfr.png', 'LLMZ_cvfr.png']);
});

