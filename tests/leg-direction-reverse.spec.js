// @ts-check
// Leg inspector: a read-only magnetic-direction row sits between the speed and
// altitude rows, and reversing the route keeps the inspector open on the same
// leg (mirrored index) instead of closing it.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      localStorage.clear(); sessionStorage.clear();
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
        localStorage.setItem('navaid.sec.' + s, '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' &&
    typeof showInspector === 'function' &&
    typeof syncLegs === 'function');
}

test.describe('Leg inspector direction + reverse', () => {
  test('shows a direction row between speed and altitude', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.5, lng: 34.9, name: 'B' },
      ];
      syncLegs();
      state.selected = { type: 'leg', index: 0 };
      showInspector();
    });

    const dir = page.locator('#insp-body .row').filter({ hasText: 'Direction' });
    await expect(dir).toHaveCount(1);
    await expect(dir).toContainText(/\d{3}°/);

    const labels = await page.locator('#insp-body .row').allTextContents();
    const iSpeed = labels.findIndex(t => /Speed/.test(t));
    const iDir = labels.findIndex(t => /Direction/.test(t));
    const iAlt = labels.findIndex(t => /Inbound alt/i.test(t));
    expect(iSpeed).toBeGreaterThanOrEqual(0);
    expect(iDir).toBeGreaterThan(iSpeed);
    expect(iAlt).toBeGreaterThan(iDir);
  });

  test('reversing the route keeps the leg inspector open on the same leg', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.3, lng: 35.0, name: 'B' },
        { lat: 32.6, lng: 35.2, name: 'C' },
      ];
      syncLegs();
      state.selected = { type: 'leg', index: 0 };
      showInspector();
    });
    await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);

    await page.locator('#reverse').click();

    await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
    const sel = await page.evaluate(() => state.selected);
    expect(sel).not.toBeNull();
    expect(sel.type).toBe('leg');
    // 2 legs: leg 0 mirrors to index 1 after the reversal.
    expect(sel.index).toBe(1);
  });
});
