// @ts-check
// Reported: the cumulative kite could not be moved. Its default placement is now an angle
// (cumKiteAngleDeg), but only the renderer knew that -- the hit box was still built on the
// pure perpendicular, so the kite painted in one place and was grabbable in another, and at
// 180 degrees the two were a whole kite-width apart. The box must follow the paint at every
// angle, which is what a shared default-offset helper buys.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof hitCumLabel === 'function' &&
    typeof state === 'object' && state);
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

// Where the renderer actually put the inbound cumulative kite this frame.
const paintedCentre = (page) => page.evaluate(() => {
  const seen = [];
  const orig = window.drawCumTimeArrow;
  window.drawCumTimeArrow = (x, y, ...rest) => { seen.push({ x, y }); return orig.call(null, x, y, ...rest); };
  draw();
  window.drawCumTimeArrow = orig;
  return seen[0] || null;
});

for (const deg of [180, 90, 45, 0]) {
  test(`at ${deg} degrees the kite can be grabbed where it is drawn`, async ({ page }) => {
    await boot(page);
    await page.evaluate((d) => { setTune('cumKiteAngleDeg', d); draw(); }, deg);
    const c = await paintedCentre(page);
    expect(c).not.toBeNull();
    const hit = await page.evaluate(([x, y]) => {
      const h = hitCumLabel(x, y);
      return h ? h.i : null;
    }, [c.x, c.y]);
    expect(hit).toBe(0);
  });
}

test('a drag from the painted spot moves the kite with the pointer', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('cumKiteAngleDeg', 180); draw(); });
  const c = await paintedCentre(page);
  const out = await page.evaluate(([x, y]) => {
    const before = hitCumLabel(x, y);
    setCumLabelFromPoint(0, false, x + 40, y - 30);       // what the drag handler calls
    draw();
    const seen = [];
    const orig = window.drawCumTimeArrow;
    window.drawCumTimeArrow = (cx, cy, ...rest) => { seen.push({ x: cx, y: cy }); return orig.call(null, cx, cy, ...rest); };
    draw();
    window.drawCumTimeArrow = orig;
    return { grabbed: !!before, after: seen[0] };
  }, [c.x, c.y]);
  expect(out.grabbed).toBe(true);
  // It followed: the painted centre moved towards where it was dropped, not back to default.
  expect(Math.hypot(out.after.x - c.x, out.after.y - c.y)).toBeGreaterThan(20);
});
