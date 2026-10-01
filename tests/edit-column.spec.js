// @ts-check
// The phone's edit column: the Build menu's first four commands -- Add waypoint, Add note,
// Undo, Clear map, in that order -- as round buttons at the top left, the other side from the
// in-flight column. Requested: "on mobile, I want some edit buttons ... opposite side of the
// live buttons", "in the same order like the edit menu", "each button is activate/deactivate".
const { test, expect, answerAppDialogs } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function boot(page, size) {
  await page.setViewportSize(size || PHONE);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setMode === 'function' && !!document.getElementById('edit-col-add'));
}

test('on a phone: four buttons, top left, in the menu\'s order, drawn icons', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const col = document.querySelector('.edit-col-ctrl');
    const r = col.getBoundingClientRect();
    return {
      ids: [...col.querySelectorAll('button')].map(b => b.id),
      icons: [...col.querySelectorAll('button')].map(b => b.dataset.icon),
      left: r.left, top: r.top, visible: getComputedStyle(col).display !== 'none',
      stripBottom: (document.querySelector('.deck-strip, #deck-strip') || { getBoundingClientRect: () => ({ bottom: 0 }) })
        .getBoundingClientRect().bottom,
    };
  });
  expect(out.visible).toBe(true);
  expect(out.ids).toEqual(['edit-col-add', 'edit-col-note', 'edit-col-undo', 'edit-col-clear']);
  expect(out.icons).toEqual(['addWp', 'addNote', 'undo', 'clearMap']);
  expect(out.left).toBeLessThan(40);                 // the left edge, opposite the live column
  expect(out.top).toBeGreaterThanOrEqual(out.stripBottom);   // below the top strip, not under it
});

test('on a desktop the column is not there (the menu is beside the map)', async ({ page }) => {
  await boot(page, { width: 1280, height: 800 });
  expect(await page.evaluate(() =>
    getComputedStyle(document.querySelector('.edit-col-ctrl')).display)).toBe('none');
});

test('Add waypoint and Add note each switch on and off, and only one at a time', async ({ page }) => {
  await boot(page);
  const add = page.locator('#edit-col-add');
  const note = page.locator('#edit-col-note');
  await add.click();
  expect(await page.evaluate(() => state.mode)).toBe('add');
  await expect(add).toHaveClass(/edit-col-on/);
  await note.click();
  expect(await page.evaluate(() => state.mode)).toBe('note');
  await expect(add).not.toHaveClass(/edit-col-on/);
  await expect(note).toHaveClass(/edit-col-on/);
  await note.click();                                   // again: off
  expect(await page.evaluate(() => state.mode)).toBe(null);
  await expect(note).not.toHaveClass(/edit-col-on/);
});

test('Undo is dim until there is something to undo, then undoes', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#edit-col-undo')).toBeDisabled();
  await page.locator('#edit-col-add').click();
  await page.evaluate(() => map.fire('click', { latlng: map.getCenter() }));
  await expect.poll(() => page.evaluate(() => state.waypoints.length)).toBe(1);
  await expect(page.locator('#edit-col-undo')).toBeEnabled();
  await page.locator('#edit-col-undo').click();
  await expect.poll(() => page.evaluate(() => state.waypoints.length)).toBe(0);
});

test('Clear map asks first, in the app, then clears', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.8, lng: 35.04, name: 'LLHA' }];
    syncLegs(); draw();
  });
  await answerAppDialogs(page, false);
  await page.locator('#edit-col-clear').click();
  await expect(page.locator('.follow-me-ask-modal')).toHaveCount(0);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(2);   // Cancel: kept
  await answerAppDialogs(page, true);
  await page.locator('#edit-col-clear').click();
  await expect.poll(() => page.evaluate(() => state.waypoints.length)).toBe(0);
});

test('while the route is locked, Add waypoint and Add note are dimmed, not hidden', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.editLocked = true; refreshEditLockControl(); });
  await expect(page.locator('#edit-col-add')).toHaveClass(/is-dim/);
  await expect(page.locator('#edit-col-note')).toHaveClass(/is-dim/);
  await expect(page.locator('#edit-col-add')).toBeVisible();
});
