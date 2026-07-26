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

test('a zero-length leg does not turn the whole map into one kite hit box', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // Two coincident waypoints: the leg projects to a single pixel, so it has no
    // direction. A zero frame used to make the along/perp test true everywhere.
    state.waypoints = [{ lat: 32.4, lng: 35.0, name: 'A' }, { lat: 32.4, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 90;
    map.setView([32.4, 35.0], 10, { animate: false }); draw();
    const box = map.getContainer().getBoundingClientRect();
    const farX = box.width - 10, farY = box.height - 10;
    const f = legFrame(0);
    const c = legLabelCenter(0, 'in');
    return {
      // A usable axis, not (0,0) — the renderer draws this kite along +x, so the
      // hit box must line up with it rather than collapsing.
      frame: { dx: f.dx, dy: f.dy, len: f.len },
      centre: !!hitLegLabel(c.x, c.y),          // the visible kite is still grabbable
      farLeg: hitLegLabel(farX, farY),
      farCum: hitCumLabel(farX, farY),
      cornerLeg: hitLegLabel(5, 5),
    };
  });
  expect(r.frame.len).toBe(0);         // genuinely degenerate
  expect(r.frame.dx).toBe(1);          // deterministic +x fallback, not 0
  expect(r.frame.dy).toBe(0);
  expect(r.centre).toBe(true);         // drawn kite stays grabbable where it is
  expect(r.farLeg).toBeNull();         // but a click across the map grabs nothing
  expect(r.farCum).toBeNull();
  expect(r.cornerLeg).toBeNull();
});

test('the cum-time kite is not hit-testable while its toggle is off', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.2, lng: 35.0, name: 'A' }, { lat: 32.7, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 90;
    map.setView([32.45, 35.0], 10, { animate: false });
    window.showCumTime = true; draw();
    const c = cumLabelCenter(0);
    const on = !!hitCumLabel(c.x, c.y);        // drawn → grabbable
    window.showCumTime = false; draw();
    const off = !!hitCumLabel(c.x, c.y);       // not drawn → must not be grabbable
    window.showCumTime = true;
    return { on, off };
  });
  expect(r.on).toBe(true);
  expect(r.off).toBe(false);
});
