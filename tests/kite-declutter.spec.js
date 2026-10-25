// @ts-check
// Short legs and legs that run side by side put two kites, or two cumulative-time boxes, on the
// same patch of chart -- one printed over the other (reported: 20:05 over 22:05, and a nav kite
// half under another). Before painting, a box covered past the allowance is moved somewhere
// clear. Some covering is wanted: a slight overlap stays, a box the pilot dragged stays and so
// does the one it was dragged onto, and with no clear spot in reach a box stays home.
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

async function boot(page, route, view) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof declutterKites === 'function' && typeof clearBootLoading === 'function');
  await page.evaluate(([route, view]) => {
    clearBootLoading();
    const t = document.getElementById('map-tour'); if (t) t.remove();
    showReturn = true;
    showCumTime = true;
    setTune('kiteDeclutter', true);       // the automatic pass; the button's tests switch it off
    state.waypoints = route.map(w => Object.assign({}, w));
    syncLegs();
    map.setView(view[0], view[1], { animate: false });
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
  }, [route || ROUTE, view || [[32.782, 34.961], 13]]);
}

// Pairs where one box covers more of the other than the allowance.
const overlaps = (page) => page.evaluate(() => {
  window._boxes = [];
  draw();
  const b = window._boxes;
  const allow = tune('kiteDeclutterAllowPct') / 100;
  let n = 0;
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (_kiteBoxCover(b[i], b[j]) > allow) n++;
  return { n, count: b.length, boxes: b };
});

test('crowded kites and time boxes are moved somewhere clear, and the pass can be switched off', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setTune('kiteDeclutter', false));
  const off = await overlaps(page);
  expect(off.count).toBeGreaterThanOrEqual(8);
  expect(off.n).toBeGreaterThan(0);                 // the scene really is crowded
  await page.evaluate(() => setTune('kiteDeclutter', true));
  const on = await overlaps(page);
  expect(on.count).toBe(off.count);                 // nothing dropped to make room
  expect(on.n).toBeLessThan(off.n);
  // Every box that was moved went somewhere clear.
  const movedClear = await page.evaluate(() => {
    const allow = tune('kiteDeclutterAllowPct') / 100;
    const b = window._boxes;
    const moved = b.filter(x => [...Array(state.legs.length).keys()].some(i =>
      ['in:', 'out:', 'cum:', 'cumret:'].some(k => { const at = kitePlacedAt(k + i); return at && Math.abs(at.x - x.x) < 0.5 && Math.abs(at.y - x.y) < 0.5; })));
    return { n: moved.length, clear: moved.every(m => b.every(o => o === m || _kiteBoxCover(m, o) <= allow)) };
  });
  expect(movedClear.n).toBeGreaterThan(0);
  expect(movedClear.clear).toBe(true);
});

test('a slight overlap is left alone: only a box covered past the allowance moves', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setTune('kiteDeclutterAllowPct', 100));
  const all = await overlaps(page);
  await page.evaluate(() => setTune('kiteDeclutter', false));
  const off = await overlaps(page);
  // Allowed to cover each other completely: nothing moves.
  expect(all.boxes.map(b => [Math.round(b.x), Math.round(b.y)])).toEqual(off.boxes.map(b => [Math.round(b.x), Math.round(b.y)]));
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

// Three legs far apart: nothing crowds leg 0's kite except what the pilot puts on it.
const OPEN = [
  { lat: 32.60, lng: 34.80, name: 'Q1' }, { lat: 32.90, lng: 35.05, name: 'Q2' },
  { lat: 32.60, lng: 35.30, name: 'Q3' },
];
test('a kite the pilot placed is never moved', async ({ page }) => {
  await boot(page, OPEN, [[32.75, 35.05], 10]);
  // Pin leg 1's way-out kite onto leg 0's: the pilot asked for it there.
  const pinned = await page.evaluate(() => {
    setTune('kiteDeclutter', false);
    draw();
    window._home0 = legLabelCenter(0, 'in');
    setTune('kiteDeclutter', true);
    const c0 = window._home0;
    const f = legFrame(1);
    const sc = legZoomScale();
    state.legs[1].inLabel = { a: ((c0.x - f.mx) * f.dx + (c0.y - f.my) * f.dy) / sc,
                              p: ((c0.x - f.mx) * f.nx + (c0.y - f.my) * f.ny) / sc, _m: 1 };
    return legLabelCenter(1, 'in');
  });
  await overlaps(page);
  const painted = await page.evaluate(() => window._boxes.filter(b => b.kind === 'drawLegArrow'));
  expect(painted.some(b => Math.abs(b.x - pinned.x) < 0.5 && Math.abs(b.y - pinned.y) < 0.5)).toBe(true);
  // ...and the kite it was dragged onto is not pushed away from it: they were put together.
  const home0 = await page.evaluate(() => window._home0);
  expect(painted.filter(b => Math.abs(b.x - home0.x) < 0.5 && Math.abs(b.y - home0.y) < 0.5).length).toBe(2);
});

// --- the Auto arrange button ---------------------------------------------------------------
// The automatic pass is off by default: the pilot arranges, and asks for help with one button.
test('Auto arrange: off by default; the button moves what covers, as positions the pilot can drag, and Undo puts them back', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('kiteDeclutter', false); localStorage.removeItem('navaid.tune.kiteDeclutter'); });
  expect(await page.evaluate(() => NavAid.tuningDefaults.kiteDeclutter.value)).toBe(false);
  const before = await overlaps(page);
  expect(before.n).toBeGreaterThan(0);
  const btn = page.locator('#edit-col-arrange');
  await expect(btn).toBeVisible();
  await expect(btn).not.toHaveAttribute('aria-disabled', 'true');
  await btn.click();
  await expect(page.locator('#toast-stack > *, .toast').filter({ hasText: /Moved \d+ label/ }).first()).toBeVisible();
  const after = await overlaps(page);
  expect(after.n).toBeLessThan(before.n);
  expect(after.count).toBe(before.count);
  // Written as ordinary dragged positions: nothing is held in the automatic pass any more.
  const placed = await page.evaluate(() => state.legs.some(l => [l.inLabel, l.cumLabel].some(o => o && !o._default)));
  expect(placed).toBe(true);
  // One Undo puts every label back.
  await page.evaluate(() => undo());
  const undone = await overlaps(page);
  expect(undone.boxes.map(b => [Math.round(b.x), Math.round(b.y)])).toEqual(before.boxes.map(b => [Math.round(b.x), Math.round(b.y)]));
});

test('Auto arrange: dimmed with no route, and says so when nothing covers anything', async ({ page }) => {
  await boot(page, OPEN, [[32.75, 35.05], 10]);
  await page.evaluate(() => setTune('kiteDeclutter', false));
  await page.locator('#edit-col-arrange').click();
  await expect(page.locator('#toast-stack > *, .toast').filter({ hasText: 'Nothing covers anything' }).first()).toBeVisible();
  await page.evaluate(() => { state.waypoints = []; syncLegs(); draw(); refreshEditColumn(); });
  await expect(page.locator('#edit-col-arrange')).toHaveAttribute('aria-disabled', 'true');
});
