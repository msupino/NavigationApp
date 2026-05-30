// @ts-check
// Coverage for the A / N / C global keyboard shortcuts wired into the
// interact.js keydown handler:
//   A — toggle add-waypoint mode (state.mode 'add' <-> null)
//   N — toggle add-note mode (state.mode 'note' <-> null)
//   C — clear the map (reuses the Clear button's confirm + reset)
// Guards: suppressed while typing in an input/textarea, and (for A/N/C)
// while a modal backdrop is open.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof map !== 'undefined' &&
    typeof setMode === 'function');
}

test.describe('A / N / C keyboard shortcuts', () => {
  test('A toggles add-waypoint mode on and off', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => state.mode)).toBeNull();
    await page.keyboard.press('a');
    expect(await page.evaluate(() => state.mode)).toBe('add');
    await page.keyboard.press('a');
    expect(await page.evaluate(() => state.mode)).toBeNull();
  });

  test('N toggles add-note mode on and off', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('n');
    expect(await page.evaluate(() => state.mode)).toBe('note');
    await page.keyboard.press('n');
    expect(await page.evaluate(() => state.mode)).toBeNull();
  });

  test('A then N switches modes (exclusive)', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('a');
    expect(await page.evaluate(() => state.mode)).toBe('add');
    await page.keyboard.press('n');
    expect(await page.evaluate(() => state.mode)).toBe('note');
  });

  test('C clears all waypoints and notes', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.2, lng: 35.0, name: 'B' },
      ];
      state.notes = [{ lat: 32.1, lng: 34.95, text: 'X', color: '#fff6aa', shape: 'rect' }];
      syncLegs(); draw();
    });
    page.once('dialog', d => d.accept());      // clearConfirm
    await page.keyboard.press('c');
    const counts = await page.evaluate(() => ({
      wp: state.waypoints.length, legs: state.legs.length, notes: state.notes.length,
    }));
    expect(counts).toEqual({ wp: 0, legs: 0, notes: 0 });
  });

  test('shortcut keys are ignored while typing in an input', async ({ page }) => {
    await boot(page);
    // Open the search overlay (Ctrl-F) so its input is visible + focused,
    // then type "a" — the keydown guard must NOT enter add mode.
    await page.keyboard.press('Control+f');
    await expect(page.locator('#wp-search')).toBeFocused();
    await page.keyboard.press('a');
    expect(await page.evaluate(() => state.mode)).toBeNull();
  });

  test('shortcut label hints render on the toolbar buttons', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#tool-add')).toHaveText(/\(A\)/);
    await expect(page.locator('#tool-note')).toHaveText(/\(N\)/);
    await expect(page.locator('#clear')).toHaveText(/\(C\)/);
  });
});
