// @ts-check
// Reported (screenshot, zoomed in): two close waypoints, their discs covering the whole leg
// between them -- tapping the line opened "Choose point" with WP 1 and WP 2 and no way to the
// leg. Outside a core at the centre, the leg line through a disc is the leg.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof hitWaypointCandidates === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1000, lng: 34.8000 }, { lat: 32.1000, lng: 34.8060 }];
    syncLegs();
    map.setView([32.1, 34.803], 17, { animate: false });
    draw();
  });
}
const pt = (page, f, off) => page.evaluate(([f, off]) => {
  const a = map.latLngToContainerPoint([state.waypoints[0].lat, state.waypoints[0].lng]);
  const b = map.latLngToContainerPoint([state.waypoints[1].lat, state.waypoints[1].lng]);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f + off, r: waypointGeom(0).r, gap: b.x - a.x };
}, [f, off]);

test('the line between two big discs is the leg, the centres are the points', async ({ page }) => {
  await boot(page);
  const mid = await pt(page, 0.5, 0);
  // The setup really is the report: both discs reach past the middle of the leg.
  expect(mid.r * 2, JSON.stringify(mid)).toBeGreaterThan(mid.gap);
  const hits = (x, y) => page.evaluate(([x, y]) => hitWaypointCandidates(x, y).map(h => h.index), [x, y]);
  expect(await hits(mid.x, mid.y), 'on the line: no waypoint').toEqual([]);
  await page.mouse.click(mid.x, mid.y);
  await expect.poll(() => page.evaluate(() => state.selected && state.selected.type + ':' + state.selected.index)).toBe('leg:0');
  await expect(page.locator('.point-choice-modal')).toHaveCount(0);
  // Off the line, inside both discs: still the chooser's two points.
  const off = await pt(page, 0.5, 40);
  expect((await hits(off.x, off.y)).sort()).toEqual([0, 1]);
  // On the line at a centre: the point (it must still be draggable).
  const c = await pt(page, 0, 0);
  expect(await hits(c.x + 5, c.y)).toEqual([0]);
});

test('at a normal zoom the disc is the point, line or not', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { map.setView([32.1, 34.803], 11, { animate: false }); draw(); });
  const r = await page.evaluate(() => {
    const a = map.latLngToContainerPoint([32.1, 34.8]);
    const g = waypointGeom(0).r;
    return { g, core: tune('hitWaypointCorePx'), hit: hitWaypointCandidates(a.x + g, a.y).map(h => h.index) };
  });
  expect(r.g + 6, 'disc no wider than the core here').toBeLessThanOrEqual(r.core);
  expect(r.hit).toContain(0);
});
