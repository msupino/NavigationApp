// @ts-check
// Leg inspector, reported with a screenshot: speed had no ↻ although the altitudes below it did,
// the three fields did not line up (a field with a ↻ floated to the middle of its row), and the
// altitude boxes were twice the width of the five digits they ever hold.
const { test, expect } = require('./_setup');

async function boot(page, legs) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof syncLegs === 'function'
    && typeof _defaultLegSpeedKt === 'function');
  await page.evaluate((n) => {
    state.waypoints = [];
    for (let k = 0; k <= n; k++) state.waypoints.push({ lat: 32.0 + k * 0.2, lng: 34.9, name: 'P' + k });
    syncLegs(); draw();
    state.selected = { type: 'leg', index: 0 }; showInspector();
  }, legs || 1);
}
// Anchored: "Wind speed (kt)" is a row too when wind is shown.
const speedRow = (page) => page.locator('#insp-body .row').filter({ has: page.locator('label', { hasText: /^Speed/ }) });

test('speed has a ↻ that puts the leg back on the Default speed setting', async ({ page }) => {
  await boot(page, 3);
  const def = await page.evaluate(() => _defaultLegSpeedKt());
  const input = speedRow(page).locator('input[type=number]');
  await input.fill('123');
  await input.press('Enter');
  // A typed speed carries forward to the legs that held the old one, and pins them manual.
  expect(await page.evaluate(() => state.legs.map(l => [l.flightSpeed, !!l._legSpeedAuto])))
    .toEqual([[123, false], [123, false], [123, false]]);
  const reset = speedRow(page).locator('button.row-reset');
  await expect(reset).toHaveAttribute('title', 'Reset to default speed');
  await reset.click();
  await expect(input).toHaveValue(String(def));
  await expect(input).toHaveClass(/is-default/);
  // Back to the default, the carried-forward legs too, and tracking it again: a new Default
  // speed moves them.
  expect(await page.evaluate(() => state.legs.map(l => [l.flightSpeed, !!l._legSpeedAuto])))
    .toEqual([[def, true], [def, true], [def, true]]);
  expect(await page.evaluate(() => applyDefaultSpeedToAutoLegs(_defaultLegSpeedKt() + 7)
    && state.legs.every(l => l.flightSpeed === _defaultLegSpeedKt() + 7))).toBe(true);
});

test('speed and altitude fields line up, sized for five digits', async ({ page }) => {
  await boot(page);
  const boxes = await page.evaluate(() => [...document.querySelectorAll('#insp-body .row input[type=number]')]
    .slice(0, 3).map(i => { const r = i.getBoundingClientRect(); return { right: r.right, width: r.width }; }));
  expect(boxes.length).toBe(3);
  for (const b of boxes) {
    expect(b.width).toBeLessThanOrEqual(90);
    // Five digits fit without clipping.
    expect(b.width).toBeGreaterThanOrEqual(60);
    // Same column whether or not the row has a ↻.
    expect(Math.abs(b.right - boxes[0].right)).toBeLessThanOrEqual(3);
  }
});

test('Hebrew: the speed ↻ is labelled in Hebrew', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'B' }];
    syncLegs(); draw(); state.selected = { type: 'leg', index: 0 }; showInspector();
  });
  await expect(page.locator('#insp-body .row').filter({ has: page.locator('label', { hasText: /^מהירות \(/ }) }).locator('button.row-reset'))
    .toHaveAttribute('title', 'חזרה למהירות ברירת המחדל');
});
