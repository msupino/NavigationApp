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
        for (const s of ['build','view','display','charts','export','print'])
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
    // 3 checkboxes: Nav WPs (off), Waypoint Names (on), Airfields (off).
    const cbs = page.locator('.modal input[type="checkbox"]');
    expect(await cbs.count()).toBe(3);
    expect(await cbs.nth(0).isChecked()).toBe(true);   // Waypoint Names default on
    expect(await cbs.nth(1).isChecked()).toBe(false);  // Nav WPs
    expect(await cbs.nth(2).isChecked()).toBe(false);  // Airfields
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

  test('Live preview: modal defaults hide waypoints/airfields immediately', async ({ page }) => {
    await boot(page);
    // Turn waypoints and airfields on so we can verify the modal hides them.
    await page.evaluate(() => { showNavWP = true; showAirfields = true; draw(); });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    // Default state applied: both should be false now.
    expect(await page.evaluate(() => showNavWP)).toBe(false);
    expect(await page.evaluate(() => showAirfields)).toBe(false);
  });

  test('Live preview: toggling checkbox updates the map immediately', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { showNavWP = false; showAirfields = false; draw(); });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    const cbs = page.locator('.modal input[type="checkbox"]');
    // Check "Print Navigation Waypoints" (idx 1) → showNavWP becomes true.
    await cbs.nth(1).check();
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    // Uncheck → showNavWP back to false.
    await cbs.nth(1).uncheck();
    expect(await page.evaluate(() => showNavWP)).toBe(false);
    // Check "Print Airfields" (idx 2) → showAirfields becomes true.
    await cbs.nth(2).check();
    expect(await page.evaluate(() => showAirfields)).toBe(true);
  });

  test('Cancel restores original waypoints/airfields state', async ({ page }) => {
    await boot(page);
    // Starting with both visible.
    await page.evaluate(() => { showNavWP = true; showAirfields = true; draw(); });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    // Modal hides them (default). Toggle waypoints on (idx 1 = Nav WPs).
    await page.locator('.modal input[type="checkbox"]').nth(1).check();
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    // Cancel → restore original (both true).
    await page.locator('.modal .modal-cancel').click();
    await expect(page.locator('.modal-back')).toHaveCount(0);
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    expect(await page.evaluate(() => showAirfields)).toBe(true);
  });

  test('Cancel restores original layer', async ({ page }) => {
    await boot(page);
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    // Verify we're on OSM.
    expect(await page.locator('#layer-select').inputValue()).toBe('OpenStreetMap');
    // Open modal (defaults to Navigation), then Cancel.
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    await page.locator('.modal .modal-cancel').click();
    // Back to OSM.
    expect(await page.locator('#layer-select').inputValue()).toBe('OpenStreetMap');
  });

  test('X button closes modal and restores original state', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { showNavWP = true; draw(); });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    // Toggle waypoints off in the modal (idx 1 = Nav WPs).
    await page.locator('.modal input[type="checkbox"]').nth(1).uncheck();
    expect(await page.evaluate(() => showNavWP)).toBe(false);
    // Click ✕ close button.
    await page.locator('.modal-close-x').click();
    await expect(page.locator('.modal-back')).toHaveCount(0);
    // Original state restored.
    expect(await page.evaluate(() => showNavWP)).toBe(true);
  });

  test('Warns when no page size (A3/A4) is selected', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    // Ensure no page frame is active.
    await page.evaluate(() => { pageSize = null; });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    await expect(page.locator('.modal-back').getByText(/no page size/i)).toBeVisible();
    await page.locator('.modal .modal-cancel').click();
    await expect(page.locator('.modal-back')).toHaveCount(0);

    // Select A3 and reopen — warning should be gone.
    await page.locator('#page-a3').click();
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    await expect(page.locator('.modal-back').getByText(/no page size/i)).not.toBeVisible();
    await page.locator('.modal .modal-cancel').click();
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
    await cbs.nth(1).check();
    await cbs.nth(0).check();
    await page.locator('.modal select').selectOption('CVFR');
    expect(await cbs.nth(1).isChecked()).toBe(true);
    expect(await cbs.nth(0).isChecked()).toBe(true);
    expect(await page.locator('.modal select').inputValue()).toBe('CVFR');
    // Click Export and verify download triggers.
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('.modal .modal-btns button').first().click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^navigation-.+\.png$/);
  });
});
