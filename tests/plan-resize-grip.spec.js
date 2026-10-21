// @ts-check
// The flight plan is sized by its corner like the inspector and the NOTAM list. The size the
// pilot gives it is kept across openings and holds while the plan's inputs change (the size
// lock); a double click on the corner gives back the size the plan fits.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof clearBootLoading === 'function');
  await page.evaluate(() => {
    clearBootLoading();
    const t = document.getElementById('map-tour'); if (t) t.remove();
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADRA' }];
    syncLegs(); draw(); showFlightPlan();
  });
  const box = page.locator('.modal-back.flight-plan > .modal.wide');
  await expect(box).toBeVisible();
  return box;
}

async function dragGrip(page, dx, dy) {
  const g = await page.locator('.fp-grip').boundingBox();
  if (!g) throw new Error('no grip');
  const x = g.x + g.width / 2, y = g.y + g.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2);
  await page.mouse.move(x + dx, y + dy);
  await page.mouse.up();
}

for (const lang of ['en', 'he']) {
  test(`the plan is sized by its corner, and keeps that size (${lang})`, async ({ page }) => {
    const box = await boot(page, lang);
    await page.waitForTimeout(100);                   // the size lock measures after two frames
    const before = await box.boundingBox();
    if (!before) throw new Error('no box');
    await expect(page.locator('.fp-grip')).toBeVisible();
    await dragGrip(page, -120, -80);
    const after = await box.boundingBox();
    if (!after) throw new Error('no box');
    // The corner follows the pointer 1:1, and the top-left stays put.
    expect(Math.abs(after.width - (before.width - 120))).toBeLessThan(3);
    expect(Math.abs(after.height - (before.height - 80))).toBeLessThan(3);
    expect(Math.abs(after.x - before.x)).toBeLessThan(2);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.fpUserSize') || 'null'));
    expect(saved && Math.abs(saved.w - after.width)).toBeLessThan(3);
    // Reopened: the pilot's size, not the fitted one.
    await page.evaluate(() => { closeFlightPlan(); showFlightPlan(); });
    await page.waitForTimeout(100);
    const reopened = await box.boundingBox();
    expect(reopened && Math.abs(reopened.width - after.width)).toBeLessThan(3);
    expect(reopened && Math.abs(reopened.height - after.height)).toBeLessThan(3);
    // Double click on the corner: fitted again, and nothing stored.
    await page.locator('.fp-grip').dblclick();
    const fitted = await box.boundingBox();
    expect(fitted && Math.abs(fitted.width - before.width)).toBeLessThan(3);
    expect(await page.evaluate(() => localStorage.getItem('navaid.fpUserSize'))).toBe(null);
  });
}

test('a stored size larger than the window is clamped into it', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.fpUserSize', JSON.stringify({ w: 5000, h: 5000 })); } catch (e) {} });
  const box = await boot(page);
  await page.waitForTimeout(100);
  const r = await box.boundingBox();
  expect(r && r.width).toBeLessThanOrEqual(1400 - 16 + 1);
  expect(r && r.height).toBeLessThanOrEqual(900 - 16 + 1);
});

test('on a phone the plan is the whole window and has no grip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof clearBootLoading === 'function');
  await page.evaluate(() => {
    clearBootLoading();
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADRA' }];
    syncLegs(); draw(); showFlightPlan();
  });
  await expect(page.locator('.modal-back.flight-plan > .modal.wide')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/deck-on/);
  await expect(page.locator('.fp-grip')).toBeHidden();
});
