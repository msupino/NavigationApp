// @ts-check
// Nav (leg) and cumulative-time kites are wide rectangle+triangle shapes. Their
// hit-test must cover the whole rotated footprint — a circular zone only caught
// the middle, so an enlarged kite could only be grabbed from its centre.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof hitLegLabel === 'function' && typeof legLabelCenter === 'function' &&
    typeof legFrame === 'function' && typeof kiteDrawScale === 'function');
}

test('the nav kite is grabbable across its whole footprint, not just the centre', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.2, lng: 35.0, name: 'A' }, { lat: 32.7, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 90; state.legs[0].inboundAltitude = 1500;
    map.setView([32.45, 35.0], 10, { animate: false }); draw();
    const c = legLabelCenter(0, 'in'), f = legFrame(0), sc = kiteDrawScale();
    const halfL = (tune('legKiteCellWidthPx') * 2 + tune('legKiteTriangleLenPx')) * sc / 2;
    const halfW = tune('legKiteHeightPx') * sc / 2;
    const at = (a, p) => !!hitLegLabel(c.x + f.dx * a + f.nx * p, c.y + f.dy * a + f.ny * p);
    return {
      center: at(0, 0),
      alongEnd: at(halfL * 0.85, 0),   // near the triangle tip / far cell — missed by the old circle
      perpEdge: at(0, halfW * 0.85),
      corner: at(halfL * 0.7, halfW * 0.7),
      outsideAlong: at(halfL * 1.6, 0),
      outsidePerp: at(0, halfW * 1.8),
    };
  });
  expect(r.center).toBe(true);
  expect(r.alongEnd).toBe(true);
  expect(r.perpEdge).toBe(true);
  expect(r.corner).toBe(true);
  expect(r.outsideAlong).toBe(false);   // still bounded — doesn't grab far away
  expect(r.outsidePerp).toBe(false);
});
