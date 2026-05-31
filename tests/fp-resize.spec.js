// @ts-check
const { test, expect } = require('./_setup');
const { LLHZ, LLHA } = require('./_airfieldArp');

// Minimal 1-leg route — enough to open the flight-plan modal.
const ROUTE = {
  waypoints: [
    { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
    { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
  ],
};

test.describe('Flight-plan modal resize', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() =>
      typeof state !== 'undefined' && typeof showFlightPlan !== 'undefined');
    await page.evaluate(route => {
      state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
      syncLegs();
      draw();
    }, ROUTE);
  });

  test('a corner grip resizes the plan window and persists the size', async ({ page }) => {
    await page.locator('#plan').click();
    const modal = page.locator('.modal-back.flight-plan .modal.wide');
    await expect(modal).toBeVisible();
    const grip = modal.locator('.resize-handle.corner-se');
    await expect(grip).toBeVisible();

    const before = await modal.boundingBox();

    // Drag the grip down-right by +120 / +90.
    const gb = await grip.boundingBox();
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    await page.mouse.move(gb.x + gb.width / 2 + 120, gb.y + gb.height / 2 + 90, { steps: 5 });
    await page.mouse.up();

    const after = await modal.boundingBox();
    expect(after.width).toBeGreaterThan(before.width + 80);
    expect(after.height).toBeGreaterThan(before.height + 60);

    // Size is persisted to localStorage.
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('navaid.fpSize');
      return raw ? JSON.parse(raw) : null;
    });
    expect(stored).not.toBeNull();
    expect(stored.w).toBeGreaterThan(before.width + 80);
    expect(stored.h).toBeGreaterThan(before.height + 60);
  });

  test('a persisted size is restored on reopen', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('navaid.fpSize', JSON.stringify({ w: 760, h: 540 }));
    });
    await page.locator('#plan').click();
    const modal = page.locator('.modal-back.flight-plan .modal.wide');
    await expect(modal).toBeVisible();
    const box = await modal.boundingBox();
    expect(box.width).toBeCloseTo(760, -1);
    expect(box.height).toBeCloseTo(540, -1);
  });
});
