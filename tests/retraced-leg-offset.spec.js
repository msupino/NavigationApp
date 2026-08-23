// @ts-check
// A sortie that flies out and back over the same track drew both legs on one line: two legs,
// one stroke, and no way to tell from the chart that there were two or which arrow belonged
// to which. Each half of the pair now steps to its own right — out on one side, back on the
// other. Picking a direction in the leg filter puts the visible one back on the track it
// describes, because then there is only one of the pair on screen.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof legScreenEnds === 'function' &&
    typeof legPairOffsetPx === 'function' && typeof syncLegs === 'function');
}

// LLHZ -> MID -> LLHZ: leg 0 and leg 1 are the same track, flown each way.
async function outAndBack(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'HOME' },
      { lat: 32.60, lng: 35.10, name: 'MID' },
      { lat: 32.18, lng: 34.83, name: 'HOME' },
    ];
    syncLegs(); draw();
  });
}

const ends = (page, i) => page.evaluate((n) => legScreenEnds(n), i);

test('the two halves of an out-and-back are drawn apart', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const [out, back] = [await ends(page, 0), await ends(page, 1)];
  const mid = (e) => ({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
  const gap = Math.hypot(mid(out).x - mid(back).x, mid(out).y - mid(back).y);
  const offset = await page.evaluate(() => tune('retracedLegOffsetPx'));
  expect(gap).toBeGreaterThan(offset);          // two lines, not one
  expect(gap).toBeLessThan(offset * 3);         // and only just apart -- still one sortie
});

test('each takes its own side, so they never land on the same one', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  // Displacement of each drawn leg from the track it describes, measured along the SAME
  // normal for both, so the two must come out with opposite signs.
  const sides = await page.evaluate(() => {
    const a0 = proj(state.waypoints[0]), b0 = proj(state.waypoints[1]);
    const dx = b0.x - a0.x, dy = b0.y - a0.y, len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const along = (e) => {
      const cx = (e.a.x + e.b.x) / 2 - (a0.x + b0.x) / 2;
      const cy = (e.a.y + e.b.y) / 2 - (a0.y + b0.y) / 2;
      return Math.round((cx * nx + cy * ny) * 100) / 100;
    };
    return { out: along(legScreenEnds(0)), back: along(legScreenEnds(1)) };
  });
  expect(Math.sign(sides.out)).toBe(-Math.sign(sides.back));   // opposite sides
  expect(Math.abs(sides.out)).toBeCloseTo(Math.abs(sides.back), 1);   // by the same amount
});

test('a leg flown once is left on its own track', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'A' },
      { lat: 32.60, lng: 35.10, name: 'B' },
      { lat: 32.90, lng: 35.40, name: 'C' },
    ];
    syncLegs(); draw();
  });
  expect(await page.evaluate(() => [legPairOffsetPx(0), legPairOffsetPx(1)])).toEqual([0, 0]);
  const e = await ends(page, 0);
  const plain = await page.evaluate(() => {
    const a = proj(state.waypoints[0]), b = proj(state.waypoints[1]);
    return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
  });
  expect(Math.round(e.a.x)).toBe(Math.round(plain.a.x));
  expect(Math.round(e.a.y)).toBe(Math.round(plain.a.y));
});

test('choosing a direction puts the line back in the middle', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  expect(await page.evaluate(() => legPairOffsetPx(0))).toBeGreaterThan(0);
  for (const dir of ['out', 'back']) {
    const off = await page.evaluate((d) => {
      window.legDirFilter = d;
      draw();
      return [legPairOffsetPx(0), legPairOffsetPx(1)];
    }, dir);
    expect(off, dir).toEqual([0, 0]);
  }
  // ...and back to both puts them apart again.
  expect(await page.evaluate(() => { window.legDirFilter = 'both'; draw(); return legPairOffsetPx(0); }))
    .toBeGreaterThan(0);
});

// The line a pilot taps must be the line they see.
test('the hit test follows the line as drawn', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const out = await page.evaluate(() => {
    const e0 = legScreenEnds(0), e1 = legScreenEnds(1);
    const mid = (e) => ({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
    return { onOut: hitLeg(mid(e0).x, mid(e0).y), onBack: hitLeg(mid(e1).x, mid(e1).y) };
  });
  expect(out.onOut).toBe(0);
  expect(out.onBack).toBe(1);
});

test('the separation is tunable, and zero means the old single line', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const same = await page.evaluate(() => {
    setTune('retracedLegOffsetPx', 0);
    draw();
    const e0 = legScreenEnds(0), e1 = legScreenEnds(1);
    setTune('retracedLegOffsetPx', 5);
    return Math.round(e0.a.x) === Math.round(e1.b.x) && Math.round(e0.a.y) === Math.round(e1.b.y);
  });
  expect(same).toBe(true);
});
