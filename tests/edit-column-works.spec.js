// @ts-check
// The edit column's buttons must work wherever the column ends up. Moving it between corners
// (Hebrew desktop: top right) rebuilt the control, and the rebuilt buttons had lost their
// handlers -- "they seem not to do anything".
const { test, expect } = require('./_setup');

for (const [lang, w, h] of [['he', 1280, 800], ['en', 1280, 800], ['he', 390, 844], ['en', 390, 844]]) {
  test(`the four buttons act (${lang}, ${w}px)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => typeof setMode === 'function' && !!document.getElementById('edit-col-add'));
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.05, lng: 34.81, name: 'B' }];
      syncLegs(); draw();
    });
    await page.locator('#edit-col-add').click();
    expect(await page.evaluate(() => state.mode)).toBe('add');
    await page.locator('#edit-col-note').click();
    expect(await page.evaluate(() => state.mode)).toBe('note');
    await page.locator('#edit-col-note').click();
    expect(await page.evaluate(() => state.mode)).toBeNull();
    await page.locator('#edit-col-clear').click();
    await expect(page.locator('.modal-back')).toHaveCount(1);     // the Clear question
  });
}

test('a dimmed button says why instead of doing nothing; a locked route locks all four', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setMode === 'function' && !!document.getElementById('edit-col-undo'));
  await page.evaluate(() => { state.waypoints = []; state.notes = []; syncLegs(); draw(); refreshEditColumn(); });
  // A real tap reaches an aria-disabled button; Playwright's actionability check would refuse it.
  const tap = (id) => page.locator(id).click({ force: true });
  await tap('#edit-col-undo');
  await expect(page.locator('body')).toContainText('Nothing to undo');
  await tap('#edit-col-clear');
  await expect(page.locator('body')).toContainText('The map is already empty');
  await expect(page.locator('.modal-back')).toHaveCount(0);       // no Clear question for an empty map
  // Locked: all four refuse with the lock's own message, and nothing changes.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.05, lng: 34.81, name: 'B' }];
    syncLegs(); draw();
    window.editLocked = true; refreshEditLockControl();
  });
  for (const id of ['#edit-col-add', '#edit-col-note', '#edit-col-undo', '#edit-col-clear']) {
    await expect(page.locator(id)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator(id)).toHaveAttribute('data-why', /Route is locked/);
    await tap(id);
  }
  await expect(page.locator('.modal-back')).toHaveCount(0);
  expect(await page.evaluate(() => ({ mode: state.mode, n: state.waypoints.length }))).toEqual({ mode: null, n: 2 });
});
