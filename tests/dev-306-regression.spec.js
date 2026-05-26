// @ts-check
// Regression coverage for PR #306 (merged into dev only): Show Waypoint
// Names moved from Display → View section, and the Magnetic Variation
// toolbar input is removed (magVar hardcoded to -6 in core.js).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_306_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_306_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('/?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');
}

test.describe('#306 — Show Waypoint Names moved to View section', () => {
  test('#wpname-cb lives inside the View section', async ({ page }) => {
    await boot(page);
    const sec = await page.locator('#wpname-cb').evaluate(el =>
      el.closest('.tb-section')?.getAttribute('data-sec'));
    expect(sec).toBe('view');
  });

  test('#wpname-cb is NOT in the Display section', async ({ page }) => {
    await boot(page);
    const inDisplay = await page.locator(
      '.tb-section[data-sec="display"] #wpname-cb').count();
    expect(inDisplay).toBe(0);
  });

  test('toggling #wpname-cb still writes navaid.showWpNames (wiring intact after the move)', async ({ page }) => {
    await boot(page);
    const cb = page.locator('#wpname-cb');
    expect(await cb.isChecked()).toBe(true);
    await cb.click();
    expect(await page.evaluate(() => localStorage.getItem('navaid.showWpNames'))).toBe('0');
    await cb.click();
    expect(await page.evaluate(() => localStorage.getItem('navaid.showWpNames'))).toBe('1');
  });
});

test.describe('#306 — Magnetic Variation removed from toolbar', () => {
  test('#mag-var DOM element no longer exists', async ({ page }) => {
    await boot(page);
    expect(await page.locator('#mag-var').count()).toBe(0);
    expect(await page.locator('label[data-i18n-title="tbMagVarTitle"]').count()).toBe(0);
  });

  test('magVar is hardcoded at -6 (6°E for Israel)', async ({ page }) => {

    expect(await page.evaluate(() => window.magVar)).toBe(-6);

    expect(await page.evaluate(() => window.magVar)).toBe(-6);
  });

  test('stale navaid.magVar in localStorage does not override the hardcoded value', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('navaid.magVar', '-12'); } catch (e) {}
    });
    await page.goto('/?lang=en');
    await page.waitForFunction(() => typeof magVar !== 'undefined');
    expect(await page.evaluate(() => window.magVar)).toBe(-5);
  });
});
