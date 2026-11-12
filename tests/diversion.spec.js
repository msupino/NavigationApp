// @ts-check
// Diversion planner (#675): the Divert button lists the nearest airfields from here and re-routes
// direct to the one chosen; Back to my route restores the plan. No GPS is granted here, so the
// planner falls back to the map centre (its own path, exercised the same way in the air).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) localStorage.setItem('navaid.sec.' + s, '1');
      localStorage.setItem('navaid.aircraft', JSON.stringify({ type: 'C172', gph: 8, taxiGal: 1.1, usableGal: 53 }));
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof draw === 'function'
    && window.NavAid && NavAid.divert && typeof loadAirfields === 'function');
  // A starting plan so Back to my route has something to restore, and the airfields loaded so the
  // list is ready. Centre the map near Herzliya (LLHZ) so the nearest list is deterministic.
  await page.evaluate(async () => {
    await loadAirfields();
    state.waypoints = [{ lat: 32.6, lng: 35.0, name: 'A' }, { lat: 32.9, lng: 35.2, name: 'B' }];
    if (typeof syncLegs === 'function') syncLegs();
    draw();
    map.setView([32.18, 34.83], 10);
    // No GPS in the test harness: disable the Location button so Divert deterministically falls
    // back to the map centre (its own path) instead of waiting for a fix that never comes.
    const g = document.getElementById('gps-live');
    if (g) g.disabled = true;
  });
}

async function openDivert(page) {
  await page.locator('#divert-btn').click();
  await page.locator('.divert-list').waitFor({ state: 'visible', timeout: 5000 });
}

test.describe('Diversion planner (#675)', () => {
  test('lists nearest airfields with magnetic bearing, distance, time and fuel', async ({ page }) => {
    await boot(page);
    await openDivert(page);
    const options = page.locator('.divert-option');
    expect(await options.count()).toBeGreaterThan(2);
    // The nearest to the Herzliya-area centre is LLHZ itself.
    await expect(options.first().locator('.divert-primary')).toContainText('LLHZ');
    // The meta line carries °M, NM and gal.
    const meta = (await options.first().locator('.divert-meta').textContent()) || '';
    expect(meta).toMatch(/°M/);
    expect(meta).toMatch(/NM/);
    expect(meta).toMatch(/gal/);
  });

  test('choosing a field re-routes direct (NOW → field) and Back restores the plan', async ({ page }) => {
    await boot(page);
    await openDivert(page);
    await page.locator('.divert-option').first().click();
    // The route is now two points: here and the field.
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names.length).toBe(2);
    expect(names[1]).toBe('LLHZ');
    // The active card offers the way back.
    await expect(page.locator('.divert-active-to')).toContainText('LLHZ');
    await page.locator('.divert-cancel').click();
    const restored = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(restored).toEqual(['A', 'B']);
  });

  test('the button is present beside comm failure', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#divert-btn')).toHaveCount(1);
    await expect(page.locator('#divert-btn .footer-link-text')).toHaveText('Divert');
  });
});
