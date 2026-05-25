// @ts-check
// Tests for the export-PNG options modal (PR #203): checkboxes for
// printing waypoints/airports and layer dropdown, defaults, restore.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_export_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['edit','map','route','display','print','build','view','numbers','export'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_export_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('/?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof exportPNG === 'function');
}

test.describe('Export PNG options modal', () => {
  test('Modal opens with checkboxes off and layer defaulting to Navigation', async ({ page }) => {
    await boot(page);
    // Need a route so exportPNG doesn't NOP; the modal should show regardless.
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    await page.locator('#print').click();
    // Wait for the modal backdrop to appear.
    await page.locator('.modal-back').waitFor();
    // Title.
    expect(await page.locator('.modal-title').textContent()).toBe('Export PNG');
    // Both checkboxes off by default.
    const cbs = page.locator('.modal input[type="checkbox"]');
    expect(await cbs.count()).toBe(2);
    expect(await cbs.nth(0).isChecked()).toBe(false);
    expect(await cbs.nth(1).isChecked()).toBe(false);
    // Layer defaults to Navigation.
    const sel = page.locator('.modal select');
    expect(await sel.inputValue()).toBe('Navigation');
    // Buttons present.
    expect(await page.locator('.modal .modal-btns button').count()).toBe(2);
    // Cancel closes the modal.
    await page.locator('.modal .modal-cancel').click();
    await expect(page.locator('.modal-back')).toHaveCount(0);
  });

  test('Export with both checkboxes off uses Navigation layer', async ({ page }) => {
    await boot(page);
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    // Open modal, leave defaults, click Export.
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    await page.locator('.modal .modal-btns button').first().click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^navigation-.+\.png$/);
  });

  test('Modal respects checkbox toggles and layer change', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    // Toggle both checkboxes on, switch to CVFR.
    const cbs = page.locator('.modal input[type="checkbox"]');
    await cbs.nth(0).check();
    await cbs.nth(1).check();
    await page.locator('.modal select').selectOption('CVFR');
    expect(await cbs.nth(0).isChecked()).toBe(true);
    expect(await cbs.nth(1).isChecked()).toBe(true);
    expect(await page.locator('.modal select').inputValue()).toBe('CVFR');
    // Click Export and verify download triggers.
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('.modal .modal-btns button').first().click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^navigation-.+\.png$/);
  });
});
