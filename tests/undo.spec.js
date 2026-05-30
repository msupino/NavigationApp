// @ts-check
// Coverage for the Undo feature (toolbar #undo button + Ctrl/Cmd-Z):
//   - undo() reverts the last committed change (add / move / delete) by
//     restoring the previous {waypoints, legs, notes} snapshot.
//   - snapshots are taken inside persist() on every state change, so a
//     change made via state mutation + draw() is immediately undoable.
//   - the toolbar button is disabled until there is something to undo.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof draw === 'function' &&
    typeof undo === 'function');
}

// Replace the route and commit it through the normal draw() path so the
// undo snapshot is recorded exactly as it would be for a real edit.
async function commit(page, waypoints, notes = []) {
  await page.evaluate(({ waypoints, notes }) => {
    state.waypoints = waypoints;
    state.notes = notes;
    syncLegs();
    draw();
  }, { waypoints, notes });
}

test.describe('Undo', () => {
  test('undo restores a deleted waypoint', async ({ page }) => {
    await boot(page);
    await commit(page, [
      { lat: 32.0, lng: 34.9, name: 'A' },
      { lat: 32.2, lng: 35.0, name: 'B' },
    ]);
    // Now delete one and commit the smaller route.
    await commit(page, [{ lat: 32.0, lng: 34.9, name: 'A' }]);
    expect(await page.evaluate(() => state.waypoints.length)).toBe(1);

    await page.evaluate(() => undo());
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['A', 'B']);
  });

  test('undo restores a deleted note', async ({ page }) => {
    await boot(page);
    await commit(page, [], [
      { lat: 32.1, lng: 34.95, text: 'X', color: '#fff6aa', shape: 'rect' },
    ]);
    await commit(page, [], []);
    expect(await page.evaluate(() => state.notes.length)).toBe(0);

    await page.evaluate(() => undo());
    expect(await page.evaluate(() => state.notes.length)).toBe(1);
  });

  test('undo steps back through multiple edits one at a time', async ({ page }) => {
    await boot(page);
    await commit(page, [{ lat: 32.0, lng: 34.9, name: 'A' }]);
    await commit(page, [
      { lat: 32.0, lng: 34.9, name: 'A' },
      { lat: 32.2, lng: 35.0, name: 'B' },
    ]);
    await commit(page, [
      { lat: 32.0, lng: 34.9, name: 'A' },
      { lat: 32.2, lng: 35.0, name: 'B' },
      { lat: 32.4, lng: 35.1, name: 'C' },
    ]);

    await page.evaluate(() => undo());
    expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['A', 'B']);
    await page.evaluate(() => undo());
    expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['A']);
  });

  test('Ctrl+Z triggers undo', async ({ page }) => {
    await boot(page);
    await commit(page, [{ lat: 32.0, lng: 34.9, name: 'A' }]);
    await commit(page, [
      { lat: 32.0, lng: 34.9, name: 'A' },
      { lat: 32.2, lng: 35.0, name: 'B' },
    ]);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['A']);
  });

  test('undo button is disabled until there is something to undo', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#undo')).toBeDisabled();
    await commit(page, [{ lat: 32.0, lng: 34.9, name: 'A' }]);
    await expect(page.locator('#undo')).toBeEnabled();
  });

  test('undo with an empty stack is a no-op', async ({ page }) => {
    await boot(page);
    await commit(page, [{ lat: 32.0, lng: 34.9, name: 'A' }]);
    await page.evaluate(() => { undo(); undo(); undo(); });   // more pops than edits
    expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
  });

  test('Undo label hint renders on the toolbar button', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#undo')).toHaveText(/Undo/);
  });
});
