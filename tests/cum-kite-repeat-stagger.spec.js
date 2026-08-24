// @ts-check
// Reported with a screenshot of a route flown over the same track several times: the leg
// lines and nav kites had been separated, but the cumulative-time kites were still one pile
// -- every pass ends at the same waypoint, and that is what this kite is anchored to. Only
// the topmost elapsed time was readable; the ones underneath might as well not have been
// drawn. Each pass now steps a kite's width along its leg, and the hit box goes with it.
const { test, expect } = require('./_setup');

const A = { lat: 32.00, lng: 34.80, name: 'A' };
const B = { lat: 32.30, lng: 35.10, name: 'B' };

async function boot(page, wps) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof hitCumLabel === 'function');
  await page.evaluate((list) => {
    state.waypoints = list.map(w => ({ ...w }));
    syncLegs();
    window.showCumTime = true;
    map.setView([32.15, 34.95], 10);
    draw();
  }, wps);
}

// Every cumulative kite the renderer painted this frame, in draw order.
const painted = (page) => page.evaluate(() => {
  const seen = [];
  const orig = window.drawCumTimeArrow;
  window.drawCumTimeArrow = (x, y, ...rest) => { seen.push({ x, y }); return orig.call(null, x, y, ...rest); };
  draw();
  window.drawCumTimeArrow = orig;
  return seen;
});

const spread = (pts) => {
  let closest = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      closest = Math.min(closest, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return closest;
};

test('three passes over one track leave three readable elapsed times', async ({ page }) => {
  await boot(page, [A, B, A, B, A, B]);
  const pts = await painted(page);
  expect(pts.length).toBe(5);                 // one per leg
  // Legs 0, 2 and 4 all end at B and used to land on the same point.
  const atB = [pts[0], pts[2], pts[4]];
  expect(Math.round(spread(atB))).toBeGreaterThan(40);
});

test('a leg flown once is not moved at all', async ({ page }) => {
  await boot(page, [A, B]);
  const before = (await painted(page))[0];
  const step = await page.evaluate(() => legRepeatCumAlongPx(0));
  expect(step).toBe(0);
  // ...and the kite sits exactly where the shared default helper puts it.
  const expected = await page.evaluate(() => {
    const ends = legScreenEnds(0);
    const dx = ends.b.x - ends.a.x, dy = ends.b.y - ends.a.y, len = Math.hypot(dx, dy) || 1;
    const def = cumDefaultLabelOffset();
    return { x: ends.b.x + (dx / len) * def.along + (-dy / len) * def.perp,
             y: ends.b.y + (dy / len) * def.along + (dx / len) * def.perp };
  });
  expect(before.x).toBeCloseTo(expected.x, 3);
  expect(before.y).toBeCloseTo(expected.y, 3);
});

test('each stepped kite can be grabbed where it is drawn', async ({ page }) => {
  await boot(page, [A, B, A, B, A, B]);
  const pts = await painted(page);
  for (const i of [0, 2, 4]) {
    const c = await page.evaluate((n) => cumLabelCenter(n), i);
    expect(c.x).toBeCloseTo(pts[i].x, 3);      // box centre on the painted kite
    expect(c.y).toBeCloseTo(pts[i].y, 3);
    const hit = await page.evaluate((p) => { const h = hitCumLabel(p.x, p.y); return h && h.i; }, c);
    expect(hit).toBe(i);                       // and it grabs THAT pass, not a neighbour
  }
});

// The step belongs to the kites the app placed. One the pilot has dragged is where they put
// it, and adding a step on top would move it every time another pass was flown.
test('a hand-placed cumulative kite keeps its position', async ({ page }) => {
  await boot(page, [A, B, A, B]);
  const moved = await page.evaluate(() => {
    state.legs[2].cumLabel = { a: 0, p: 0, _m: 1 };     // dragged: no _default flag
    draw();
    const c = cumLabelCenter(2);
    const ends = legScreenEnds(2);
    return Math.round(Math.hypot(c.x - ends.b.x, c.y - ends.b.y));
  });
  expect(moved).toBe(0);                                // exactly on its anchor, unstepped
});

// The pair offset moved the LINE; the kite anchored to that line has to move with it, or the
// elapsed time for the outbound leg floats over the return one.
test('the kite follows its own line when an out-and-back is split', async ({ page }) => {
  await boot(page, [A, B, A]);
  const out = await page.evaluate(() => {
    const centres = () => [0, 1].map(cumLabelCenter);
    setTune('splitRetracedLegs', false); draw();
    const together = centres();
    setTune('splitRetracedLegs', true); draw();
    const apart = centres();
    const off = tune('retracedLegOffsetPx');
    return [0, 1].map((i) => {
      const e = legScreenEnds(i);
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const mx = apart[i].x - together[i].x, my = apart[i].y - together[i].y;
      return { across: Math.round((mx * nx + my * ny) * 10) / 10, off };
    });
  });
  for (const leg of out) expect(leg.across).toBe(-leg.off);
});
