// @ts-check
// Dragging a waypoint should not pop the inspector — it opens only on a clean
// click (mouse released without a move). A drag-to-reposition leaves a closed
// inspector closed.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof proj === 'function');
  return page.evaluate(() => {
    map.setView([32.0, 34.9], 9);
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }];
    state.legs = []; state.notes = [];
    syncLegs();
    state.selected = null;
    showInspector();   // ensure closed (nothing selected)
    draw();
    const s = proj(state.waypoints[0]);
    const r = mapEl.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  });
}

const hidden = page => page.evaluate(() =>
  document.getElementById('inspector').classList.contains('hidden'));

test('dragging a waypoint does not open the inspector', async ({ page }) => {
  const p = await boot(page);
  expect(await hidden(page)).toBe(true);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 60, p.y + 40, { steps: 5 });
  await page.mouse.up();
  // Waypoint moved, inspector stayed closed.
  expect(await hidden(page)).toBe(true);
  const moved = await page.evaluate(() => state.waypoints[0].lat !== 32.0 || state.waypoints[0].lng !== 34.9);
  expect(moved).toBe(true);
});

test('clicking a waypoint (no move) opens the inspector on release', async ({ page }) => {
  const p = await boot(page);
  await page.mouse.click(p.x, p.y);
  expect(await hidden(page)).toBe(false);
  expect(await page.evaluate(() => state.selected)).toEqual({ type: 'wp', index: 0 });
});
