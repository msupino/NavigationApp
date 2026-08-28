// @ts-check
// Fresh storage enables map-reference layers by default, so overlapping points commonly
// open the chooser. It must replace an existing inspector rather than stack over it while
// leaving the previous waypoint selected and enlarged.
const { test, expect } = require('./_setup');

test('opening a point chooser closes the old waypoint inspector and selection', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showPointChoice === 'function' &&
    typeof showInspector === 'function' && typeof syncLegs === 'function');

  const opened = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.10, lng: 34.80, name: 'FIRST' },
      { lat: 32.11, lng: 34.81, name: 'SECOND' },
      { lat: 32.12, lng: 34.82, name: 'THIRD' },
    ];
    syncLegs();
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    draw();
    const firstWasOpen = !document.getElementById('inspector').classList.contains('hidden');
    const originalDraw = window.draw;
    let chooserDraws = 0;
    window.draw = function () {
      chooserDraws += 1;
      return originalDraw.apply(this, arguments);
    };
    showPointChoice([{ type: 'wp', index: 1 }, { type: 'wp', index: 2 }]);
    window.draw = originalDraw;
    return {
      firstWasOpen,
      inspectorHidden: document.getElementById('inspector').classList.contains('hidden'),
      selected: state.selected,
      chooserCount: document.querySelectorAll('.point-choice-modal').length,
      chooserDraws,
    };
  });

  expect(opened.firstWasOpen).toBe(true);
  expect(opened.inspectorHidden).toBe(true);
  expect(opened.selected).toBeNull();
  expect(opened.chooserCount).toBe(1);
  expect(opened.chooserDraws).toBeGreaterThan(0);

  await page.locator('.point-choice-option', { hasText: 'SECOND' }).click();
  await expect(page.locator('.point-choice-modal')).toHaveCount(0);
  await expect(page.locator('#inspector')).toHaveCount(1);
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
  expect(await page.evaluate(() => state.selected)).toEqual({ type: 'wp', index: 1 });
});
