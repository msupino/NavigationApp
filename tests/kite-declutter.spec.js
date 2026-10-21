// @ts-check
// Short legs and legs that run side by side put two kites, or two cumulative-time boxes, on the
// same patch of chart -- one printed over the other (reported: 20:05 over 22:05, and a nav kite
// half under another). Before painting, each box the pilot has not placed is moved off the
// others; one the pilot dragged stays exactly where it was put.
const { test, expect } = require('./_setup');

// A zig-zag of short legs: the waypoints are close, so the time boxes at each one and the nav
// kites of neighbouring legs all compete for the same few centimetres.
const ROUTE = [
  { lat: 32.800, lng: 34.960, name: 'P1' },
  { lat: 32.790, lng: 34.966, name: 'P2' },
  { lat: 32.782, lng: 34.958, name: 'P3' },
  { lat: 32.772, lng: 34.965, name: 'P4' },
  { lat: 32.764, lng: 34.957, name: 'P5' },
];

async function boot(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof declutterKites === 'function' && typeof clearBootLoading === 'function');
  await page.evaluate((route) => {
    clearBootLoading();
    const t = document.getElementById('map-tour'); if (t) t.remove();
    showReturn = true;
    showCumTime = true;
    state.waypoints = route.map(w => Object.assign({}, w));
    syncLegs();
    map.setView([32.782, 34.961], 13, { animate: false });
    // Record every box as painted: centre, angle, size.
    window._boxes = [];
    const wrap = (name, sizeOf, scIdx) => {
      const orig = window[name];
      window[name] = function (...a) {
        const s = sizeOf(a[scIdx]);
        window._boxes.push({ x: a[0], y: a[1], ang: a[2], hl: s.L / 2, hw: s.W / 2, kind: name });
        return orig.apply(this, a);
      };
    };
    wrap('drawLegArrow', legKiteBoxSize, 9);
    wrap('drawCumTimeArrow', cumKiteBoxSize, 6);
  }, ROUTE);
}

const overlaps = (page) => page.evaluate(() => {
  window._boxes = [];
  draw();
  const b = window._boxes;
  let n = 0;
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (_kiteBoxesOverlap(b[i], b[j])) n++;
  return { n, count: b.length };
});

test('crowded kites and time boxes are moved off each other, and the pass can be switched off', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setTune('kiteDeclutter', false));
  const off = await overlaps(page);
  expect(off.count).toBeGreaterThanOrEqual(8);
  expect(off.n).toBeGreaterThan(0);                 // the scene really is crowded
  await page.evaluate(() => setTune('kiteDeclutter', true));
  const on = await overlaps(page);
  expect(on.count).toBe(off.count);                 // nothing dropped to make room
  expect(on.n).toBe(0);
});

test('a kite moved off another is grabbed where it is painted', async ({ page }) => {
  await boot(page);
  await overlaps(page);
  const r = await page.evaluate(() => {
    for (let i = 0; i < state.legs.length; i++) {
      for (const k of ['in', 'out']) {
        const at = kitePlacedAt(k + ':' + i);
        if (at) return { at, c: legLabelCenter(i, k), hit: hitLegLabel(at.x, at.y) };
      }
    }
    for (let i = 0; i < state.legs.length; i++) {
      const at = kitePlacedAt('cum:' + i);
      if (at) return { at, c: cumLabelCenter(i), hit: hitCumLabel(at.x, at.y) };
    }
    return null;
  });
  expect(r).not.toBeNull();
  if (!r) return;
  expect(Math.abs(r.c.x - r.at.x) + Math.abs(r.c.y - r.at.y)).toBeLessThan(0.5);
  expect(r.hit).not.toBeNull();
});

test('a kite the pilot placed is never moved', async ({ page }) => {
  await boot(page);
  // Pin leg 1's way-out kite onto leg 0's: the pilot asked for it there.
  const pinned = await page.evaluate(() => {
    draw();
    const c0 = legLabelCenter(0, 'in');
    const f = legFrame(1);
    const sc = legZoomScale();
    state.legs[1].inLabel = { a: ((c0.x - f.mx) * f.dx + (c0.y - f.my) * f.dy) / sc,
                              p: ((c0.x - f.mx) * f.nx + (c0.y - f.my) * f.ny) / sc, _m: 1 };
    return legLabelCenter(1, 'in');
  });
  await overlaps(page);
  const painted = await page.evaluate(() => window._boxes.filter(b => b.kind === 'drawLegArrow'));
  expect(painted.some(b => Math.abs(b.x - pinned.x) < 0.5 && Math.abs(b.y - pinned.y) < 0.5)).toBe(true);
});
