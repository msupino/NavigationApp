// @ts-check
// In add mode, tapping a waypoint already on the route adds it again (closing a loop) -- and,
// like any other add on a phone, it does not open the inspector. Reported: "adding new wp
// doesn't open inspector, unless the selected waypoint already exists (loop)".
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('a tap on the departure point in add mode closes the loop without opening the panel', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setMode === 'function' && typeof syncLegs === 'function');
  const pt = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.05, lng: 34.95, name: 'B' },
                       { lat: 31.95, lng: 34.80, name: 'C' }];
    syncLegs(); state.selected = null; showInspector();
    map.setView([32.07, 34.86], 11, { animate: false }); draw();
    setMode('add');
    const p = map.latLngToContainerPoint([32.18, 34.83]);
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    n: state.waypoints.length,
    last: state.waypoints[state.waypoints.length - 1].name,
    panelOpen: !document.getElementById('inspector').classList.contains('hidden'),
    mode: state.mode,
  }));
  expect(r.n).toBe(4);
  expect(r.last).toBe('LLHZ');
  expect(r.panelOpen).toBe(false);
  expect(r.mode).toBe('add');
});
