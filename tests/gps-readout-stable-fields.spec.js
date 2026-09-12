// @ts-check
// The floating menu card is the surface these phone measurements are against; on a phone the
// deck replaces it (see mobile-deck.spec.js), so they ask for the card with `?deck=0`.
// Reported from the cockpit: "the live location info keeps changing the info details".
//
// The readout drops a field when the line is too long for the panel, and every value on it
// changes width as it is flown -- 9 pts becomes 10 pts, 990 ft becomes 1000 ft, the elapsed
// clock ticks, a stale notice counts up. A line sitting on the width limit therefore fit,
// overflowed, and fit again, second after second, and the subscale setting and the point
// count blinked in and out of an instrument the pilot was trying to read.
//
// The number of dropped fields is sticky now: a field goes on overflow, and comes back only
// with gpsReadoutRefitPx of slack to spare.
const { test, expect } = require('./_setup');

async function boot(page, width) {
  await page.setViewportSize({ width: width || 390, height: 820 });
  await page.goto('?lang=en&nogist&deck=0');
  await page.waitForFunction(() => typeof gpsUpdateReadout === 'function'
    && window.NavAid && NavAid.tuningDefaults.gpsReadoutRefitPx);
}

// One second of flight: the values move, the readout is asked to redraw, the text is read.
const frames = (page, o) => page.evaluate((opts) => {
  window.gpsRecording = true;
  window.gpsAltIsGeometric = false;
  window.gpsQnh = { inHg: 29.83, hPa: 1010, at: Date.now(), lat: 32, lng: 34.9 };
  const out = [];
  for (let i = 0; i < opts.n; i++) {
    window.gpsStartT = Date.now() - (600 + i) * 1000;
    window.gpsTrack = new Array(opts.pts + i).fill({ lat: 32, lng: 34.9, t: 1 });
    window.gpsLastGS = opts.gs + (i % 2);
    window.gpsLastAlt = opts.alt + (i % 2) * 10;     // 990 <-> 1000: one character wider
    window.gpsOwn = { lat: 32, lng: 34.9, hdg: 75 + i, t: Date.now() };
    gpsUpdateReadout();
    out.push(document.getElementById('gps-readout').textContent);
  }
  return out;
}, o);

// Which fields a line carries, regardless of the numbers in them.
const shape = (s) => [/pts/, /\d\d:\d\d/, /kt/, / ft/, /″/, /°/].map(re => re.test(s)).join('');

test('the fields stay put while the numbers move', async ({ page }) => {
  await boot(page, 390);
  // 9 -> 10 pts, 990 -> 1000 ft, the clock ticking: every frame is a different width, and
  // the panel is narrow enough that the line is near its limit throughout.
  const seen = await frames(page, { n: 12, pts: 9, gs: 99, alt: 990 });
  const shapes = seen.map(shape);
  // A field may go as the numbers grow -- that is the line making room. What it may not do
  // is come BACK at the same panel width, because that is the blink: gone this second, here
  // the next, gone again.
  const returned = shapes.filter((s, i) => i && [...s].some((ch, j) => ch === 't' && shapes[i - 1][j] === 'f'));
  expect(returned, 'a field that had been dropped came back mid-flight').toEqual([]);
  // And it settles: after the first second or two of finding its width it does not move again.
  expect([...new Set(shapes.slice(2))], 'the line was still changing shape').toHaveLength(1);
  // And it is still a readout: what is being flown survives whatever was dropped.
  expect(seen[seen.length - 1]).toMatch(/kt/);
  expect(seen[seen.length - 1]).toMatch(/ ft/);
});

test('what is dropped is still dropped in the order the fields matter', async ({ page }) => {
  await boot(page, 390);
  const narrow = (await frames(page, { n: 1, pts: 128, gs: 104, alt: 2450 }))[0];
  await boot(page, 1280);
  const wide = (await frames(page, { n: 1, pts: 128, gs: 104, alt: 2450 }))[0];
  expect(wide).toMatch(/pts/);
  expect(wide).toMatch(/″/);
  expect(narrow).not.toMatch(/″/);
  expect(narrow).toMatch(/kt/);
  expect(narrow).toMatch(/ ft/);
});

test('a wider panel gives the fields back', async ({ page }) => {
  await boot(page, 390);
  await frames(page, { n: 3, pts: 128, gs: 104, alt: 2450 });
  await page.setViewportSize({ width: 1280, height: 820 });
  const after = (await frames(page, { n: 2, pts: 128, gs: 104, alt: 2450 }))[1];
  // Stickiness is hysteresis, not a one-way ratchet: room earned back is room used.
  expect(after).toMatch(/pts/);
  expect(after).toMatch(/″/);
});

test('a field comes back when there is real room, not when there is a hair of it', async ({ page }) => {
  await boot(page, 390);
  const got = await page.evaluate(() => {
    const el = document.getElementById('gps-readout');
    el.textContent = 'x';                          // the footer hides this line while empty
    el.classList.add('live-active');
    const drops = [4, 0, 1];                       // subscale, points, elapsed clock
    const line = (alt) => ['128 pts', '12:34', '104 kt', alt + ' ft', '29.83\u2033', '075\u00b0'];
    const run = (alt) => { gpsFitReadout(el, line(alt), '', drops); return el.textContent; };
    return {
      long: run(24500),                            // too wide: something has to go
      hair: run(2450),                             // one character narrower
      room: run(0),                                // and now there is real room
      slack: NavAid.tuningDefaults.gpsReadoutRefitPx.value,
    };
  });
  expect(got.slack).toBeGreaterThan(0);
  // A character's worth of room is not room. Handing the field back for it is exactly the
  // blink that was reported: the next foot of climb takes it away again.
  expect(shape(got.hair)).toBe(shape(got.long));
  // Enough room, and it returns -- this is hysteresis, not a one-way ratchet.
  expect(shape(got.room)).not.toBe(shape(got.long));
  expect(got.room).toMatch(/12:34/);
});
