// @ts-check
// Waypoint circles are all one size (radius from wpSize x zoom, never the
// label); the text shrinks to fit instead of the circle growing.
const { test, expect } = require('./_setup');

test('all waypoint circles share one radius; long labels shrink the font', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof waypointGeom === 'function');
  const g = await page.evaluate(() => {
    showWpNames = true;
    state.waypoints = [
      { lat: 32.10, lng: 34.90, name: 'A' },
      { lat: 32.30, lng: 35.10, name: 'LONGWAYPOINT' },
      { lat: 32.50, lng: 35.30, name: 'MID12' },
    ];
    syncLegs(); draw();
    const a = waypointGeom(0), b = waypointGeom(1), c = waypointGeom(2);
    return { ra: a.r, rb: b.r, rc: c.r, fa: a.fontPx, fb: b.fontPx, fc: c.fontPx };
  });
  // identical radius regardless of label length
  expect(g.rb).toBeCloseTo(g.ra, 5);
  expect(g.rc).toBeCloseTo(g.ra, 5);
  // long label shrinks the font below the short one; never below the floor
  expect(g.fb).toBeLessThan(g.fa);
  expect(g.fb).toBeGreaterThanOrEqual(4);
});
