// @ts-check
// Regression coverage for recent merged PRs that lacked behavioural tests.
// One suite per PR — each asserts the user-visible symptom, not the
// implementation, so refactors won't break them unnecessarily.
//
//   #218 — 'Show'  → 'Show/Pin' relabel for the two map-overlay toggles
//   #232 — runway directions are already covered by runway-directions.spec.js
//   #238 — toolbar section order: Build → View → Display → Charts →
//          Export/Import → Print
//   #250 — export-PNG modal checkbox labels match the View section
//          terminology ('Navigation Waypoints' / 'Airfields')
//   #251 — Hebrew tbMapOpacity label is the new wording ('בהירות מפה',
//          not the old 'מפת רקע')
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_recent_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_recent_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('/?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined');
}

// ---------------------------------------------------------------------------
// #218 — Show/Pin label relabel.
// ---------------------------------------------------------------------------
test.describe('#218 — Show/Pin label relabel', () => {
  test('navWP toggle label reads "Show/Pin Navigation Waypoints"', async ({ page }) => {
    await boot(page);
    const text = await page.locator('label[data-i18n-title="tbShowNavWpTitle"]').textContent();
    expect(text).toMatch(/Show\/Pin Navigation Waypoints/i);
  });

  test('airfields toggle label reads "Show/Pin Airfields"', async ({ page }) => {
    await boot(page);
    const text = await page.locator('label[data-i18n-title="tbShowAirfieldsTitle"]').textContent();
    expect(text).toMatch(/Show\/Pin Airfields/i);
  });
});

// ---------------------------------------------------------------------------
// #238 — toolbar section order.
// ---------------------------------------------------------------------------
test.describe('#238 — toolbar section order', () => {
  test('sections render in order: build, view, display, charts, export, print', async ({ page }) => {
    await boot(page);
    const order = await page.locator('#toolbar .tb-section').evaluateAll(els =>
      els.map(el => el.getAttribute('data-sec')));
    expect(order).toEqual(['build', 'view', 'display', 'charts', 'export', 'print']);
  });
});

// ---------------------------------------------------------------------------
// #250 — export-PNG checkbox labels match View section terminology.
// ---------------------------------------------------------------------------
test.describe('#250 — export modal checkbox label terminology', () => {
  test('Print PNG modal labels use Navigation Waypoints / Airfields wording', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.18060, lng: 34.83470, name: 'LLHZ' },
        { lat: 32.80972, lng: 35.04389, name: 'LLHA' },
      ];
      syncLegs(); draw();
    });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();

    const labels = await page.locator('.modal label').allTextContents();
    const joined = labels.join(' ');
    expect(joined).toMatch(/Navigation Waypoints/i);
    expect(joined).toMatch(/Airfields/i);
    // No leftover legacy 'airports' wording (renamed to Airfields in #250).
    expect(joined).not.toMatch(/\bairports\b/i);
  });
});

// ---------------------------------------------------------------------------
// #251 — HE tbMapOpacity wording.
// ---------------------------------------------------------------------------
test.describe('#251 — Hebrew tbMapOpacity label', () => {
  test('Hebrew "Map opacity" slider label reads בהירות מפה', async ({ page }) => {
    await boot(page, 'he');
    const text = await page.locator('label[data-i18n-title="tbMapOpacityTitle"]').textContent();
    expect(text).toMatch(/בהירות מפה/);
    // Old wording must be gone.
    expect(text).not.toMatch(/מפת רקע/);
  });
});

// ---------------------------------------------------------------------------
// #252 — Print Waypoint Names checkbox + map-opacity slider added to modal.
// ---------------------------------------------------------------------------
test.describe('#252 — Print Waypoint Names + Map Opacity in export modal', () => {
  test('export modal has 3 checkboxes, "Waypoint Names" defaults on', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.18060, lng: 34.83470, name: 'LLHZ' },
        { lat: 32.80972, lng: 35.04389, name: 'LLHA' },
      ];
      syncLegs(); draw();
    });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();

    const cbs = page.locator('.modal input[type="checkbox"]');
    expect(await cbs.count()).toBe(3);

    const labels = await page.locator('.modal label').allTextContents();
    const wpNamesIdx = labels.findIndex(l => /Waypoint Names/i.test(l));
    expect(wpNamesIdx).toBeGreaterThanOrEqual(0);
    expect(await cbs.nth(wpNamesIdx).isChecked()).toBe(true);
  });

  test('export modal includes a map-opacity slider', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.18060, lng: 34.83470, name: 'LLHZ' },
        { lat: 32.80972, lng: 35.04389, name: 'LLHA' },
      ];
      syncLegs(); draw();
    });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();

    const ranges = page.locator('.modal input[type="range"]');
    expect(await ranges.count()).toBeGreaterThanOrEqual(1);
  });
});
