// @ts-check
// How far the cumulative-time kite sits from its waypoint is tunable (cumKiteGapPx), on top
// of the minimum that keeps its tip clear of the waypoint disc. The renderer and the hit test
// share one placement helper, so the knob has to move both together — a kite you can see but
// not grab is the bug this pairing was introduced for.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof hitCumLabel === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.80, name: 'A' },
      { lat: 32.30, lng: 35.10, name: 'B' },
    ];
    syncLegs();
    showCumTime = true;
    map.setView([32.15, 34.95], 10);
    draw();
  });
}

// Distance from the leg's end waypoint to where the kite was actually painted.
const paintedDist = (page) => page.evaluate(() => {
  let seen = null;
  const orig = window.drawCumTimeArrow;
  window.drawCumTimeArrow = (x, y, ...rest) => { if (!seen) seen = { x, y }; return orig.call(null, x, y, ...rest); };
  draw();
  window.drawCumTimeArrow = orig;
  const b = proj(state.waypoints[1]);
  return { d: Math.hypot(seen.x - b.x, seen.y - b.y), x: seen.x, y: seen.y };
});

const setGap = (page, px) => page.evaluate((v) => { setTune('cumKiteGapPx', v); draw(); }, px);
// The knob is in the same units as the rest of the kite's geometry (cell width, triangle
// length): kite pixels, scaled by cumKiteDrawScale so the whole marker grows and shrinks
// together. On screen a knob of N moves it N * scale.
const scale = (page) => page.evaluate(() => cumKiteDrawScale());

test('the knob moves the kite out', async ({ page }) => {
  await boot(page);
  const base = await paintedDist(page);
  await setGap(page, 40);
  const far = await paintedDist(page);
  expect(far.d - base.d).toBeCloseTo(40 * await scale(page), 0);
});

test('and pulls it back in', async ({ page }) => {
  await boot(page);
  const base = await paintedDist(page);
  await setGap(page, -20);
  const near = await paintedDist(page);
  expect(base.d - near.d).toBeCloseTo(20 * await scale(page), 0);
});

test('but never inside the waypoint disc it points at', async ({ page }) => {
  await boot(page);
  await setGap(page, -400);                       // far past the floor
  const near = await paintedDist(page);
  const floor = await page.evaluate(() => {
    const sc = cumKiteDrawScale();
    const halfLen = (tune('cumKiteCellWidthPx') + tune('cumKiteTriangleLenPx')) * sc / 2;
    return waypointDiscRadiusPx(1) + halfLen;
  });
  expect(near.d).toBeGreaterThanOrEqual(floor - 1);
});

test('the hit box follows the knob', async ({ page }) => {
  await boot(page);
  await setGap(page, 60);
  const at = await paintedDist(page);
  expect(await page.evaluate(([x, y]) => {
    const h = hitCumLabel(x, y);
    return h ? h.i : null;
  }, [at.x, at.y])).toBe(0);
});

test('a kite the pilot has placed ignores the knob', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const b = proj(state.waypoints[1]);
    setCumLabelFromPoint(0, false, b.x + 90, b.y - 60);   // dragged by hand
    draw();
  });
  const placed = await paintedDist(page);
  await setGap(page, 60);
  const after = await paintedDist(page);
  expect(after.d).toBeCloseTo(placed.d, 0);
});
