// @ts-check
// Reported with a phone screenshot: "can't move time slider". The legend dock -- the Legend
// button with the route totals over it -- shared the clock card's row: the button drew over the
// card's left end, and the dock's empty box caught the touches meant for the slider. On a phone
// the clock now opens from the strip as a row under it, clear of every map button, and the
// dock's empty space lets touches through.
const { test, expect } = require('./_setup');

test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

for (const lang of ['he', 'en']) test(`the map clock opened from the strip takes a touch drag on a phone, clear of the map buttons (${lang})`, async ({ page }) => {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof NavAid !== 'undefined' && NavAid.refreshMapClock && typeof syncLegs === 'function');
  await page.evaluate(() => {
    // A route, so the totals pill is in the dock (the tallest the dock gets).
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADERA' }];
    state.legs = []; syncLegs(); draw();
    NavAid.refreshMapClock();
  });
  await page.locator('.deck-strip-clock').click();
  await page.waitForTimeout(300);
  const g = await page.evaluate(() => {
    const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const s = document.getElementById('map-time-slider');
    const sr = s.getBoundingClientRect();
    const cy = sr.top + sr.height / 2;
    // What is under the track at ten points along it.
    const under = [];
    for (let i = 0; i < 10; i++) {
      const e = document.elementFromPoint(sr.left + 4 + (sr.width - 8) * i / 9, cy);
      under.push(e === s);
    }
    return { card: box('#map-time'), dock: box('.legend-dock'), strip: box('#deck-strip'), under,
      r: [sr.left, sr.top, sr.width, sr.height] };
  });
  // Under the strip, and nowhere near the dock.
  expect(g.card.t).toBeGreaterThanOrEqual(g.strip.b);
  expect(g.card.b).toBeLessThan(g.dock.t);
  expect(g.under.every(Boolean)).toBe(true);
  // A real touch drag from the live end moves the hour.
  const cdp = await page.context().newCDPSession(page);
  const y = g.r[1] + g.r[3] / 2;
  const live = lang === 'he' ? g.r[0] + g.r[2] - 8 : g.r[0] + 8;        // Hebrew runs right-to-left
  const to = g.r[0] + g.r[2] / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: live, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: live + (to - live) * i / 8, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => Number(document.getElementById('lookahead-time').value))).toBeGreaterThan(5);
});
