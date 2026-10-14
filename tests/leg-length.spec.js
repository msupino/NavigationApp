// @ts-check
// The leg inspector gives the leg's length, beside its direction: the two read-only facts of the
// line itself, in the flight plan's own form (one decimal, NM).
const { test, expect } = require('./_setup');

for (const lang of ['en', 'he']) {
  test('the leg inspector shows the leg length (' + lang + ')', async ({ page }) => {
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => typeof showInspector === 'function' && typeof syncLegs === 'function');
    const want = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.5, lng: 35.0, name: 'B' }, { lat: 32.81, lng: 35.04, name: 'C' }];
      syncLegs(); draw();
      state.selected = { type: 'leg', index: 1 }; showInspector();
      return geo(state.waypoints[1], state.waypoints[2]).dist.toFixed(1) + ' NM';
    });
    const labels = await page.locator('#insp-body .row > label').allTextContents();
    const label = lang === 'he' ? 'אורך קטע' : 'Leg length';
    const dirLabel = lang === 'he' ? 'כיוון' : 'Direction';
    // Right after Direction.
    expect(labels.indexOf(label)).toBe(labels.indexOf(dirLabel) + 1);
    const row = page.locator('#insp-body .row', { has: page.locator('label', { hasText: new RegExp('^' + label + '$') }) });
    await expect(row).toContainText(want);
  });
}

test('a button with a plus glyph shows one plus: the icon, not the glyph too', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.5, lng: 35.0, name: 'B' }];
    syncLegs(); draw(); state.selected = { type: 'leg', index: 0 }; showInspector();
  });
  const btn = page.locator('#insp-body button', { hasText: 'identification-point' });
  await expect(btn.locator('.mi-icon')).toHaveCount(1);
  expect((await btn.innerText()).trim()).toMatch(/^Add identification-point marker$/);
});
