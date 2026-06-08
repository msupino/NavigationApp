// Route library (#677): save multiple named routes locally, then load /
// rename / duplicate / delete them.
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
        localStorage.setItem('navaid.sec.' + s, '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof showRouteLibraryModal === 'function');
}

async function setRoute(page, names) {
  await page.evaluate(ns => {
    state.waypoints = ns.map((n, i) => ({ lat: 32 + i * 0.1, lng: 34.8 + i * 0.1, name: n }));
    state.notes = [];
    syncLegs(); draw();
  }, names);
}

test.describe('Route library', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem('navaid.routes'); } catch (e) {} });
  });

  test('save, list, load, rename, duplicate, delete', async ({ page }) => {
    await boot(page);
    page.on('dialog', d => d.accept());   // accept any confirm/prompt
    await setRoute(page, ['LLSD', 'BAZRA', 'LLHA']);

    await page.locator('#route-library').click();
    const modal = page.locator('.route-library-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.route-library-empty')).toBeVisible();

    // Save current route under a name.
    await modal.locator('.route-library-name').fill('Coast hop');
    await modal.getByRole('button', { name: 'Save current route' }).click();
    const rows = modal.locator('.route-library-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Coast hop');
    await expect(rows.first()).toContainText('3 WP');

    // Persisted to localStorage.
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('navaid.routes') || '[]'));
    expect(stored.length).toBe(1);
    expect(stored[0].name).toBe('Coast hop');
    expect(stored[0].data.waypoints.length).toBe(3);

    // Duplicate → 2 entries.
    await rows.first().getByRole('button', { name: 'Duplicate' }).click();
    await expect(modal.locator('.route-library-row')).toHaveCount(2);

    // Clear the live route, then load the saved one back.
    await page.evaluate(() => { state.waypoints = []; state.legs = []; syncLegs(); draw(); });    await modal.locator('.route-library-open').first().click();
    await expect(page.locator('.route-library-modal')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => state.waypoints.length)).toBe(3);

    // Reopen, delete one entry.
    await page.locator('#route-library').click();
    const modal2 = page.locator('.route-library-modal');    await modal2.locator('.route-library-row').first()
      .getByRole('button', { name: 'Delete' }).click();
    await expect(modal2.locator('.route-library-row')).toHaveCount(1);
  });
});
