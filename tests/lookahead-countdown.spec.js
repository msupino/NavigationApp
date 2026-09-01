// @ts-check
// The unified look-ahead slider points at a fixed absolute instant (the top of the target
// hour), not a rolling "+N hours from now". So as real time advances, the gap must close on
// its own: +3h -> +2h -> ... -> live, with the hazard layers dropping what has since expired,
// and it must snap to live once now catches up. lookaheadTick() does that walk; we drive a
// mutable frozen clock forward and call it deterministically instead of waiting for the timer.
const { test, expect } = require('./_setup');

async function freezeMutableClock(page) {
  await page.addInitScript(() => {
    window.__now = Date.UTC(2026, 5, 21, 12, 0);   // 12:00Z, exactly top of the hour
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [window.__now])); }
      static now() { return window.__now; }
    };
  });
}

async function boot(page) {
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.getElementById('lookahead-time') && typeof draw === 'function');
}

const master = page => page.evaluate(() => parseInt(document.getElementById('lookahead-time').value, 10));
const readout = page => page.evaluate(() => document.getElementById('lookahead-time-val').textContent);
const viewTime = page => page.evaluate(() => window.notamViewTime);
const setMaster = (page, h) => page.evaluate(hh => {
  const m = document.getElementById('lookahead-time');
  m.value = String(hh);
  m.dispatchEvent(new Event('input'));
}, h);
const advanceHours = (page, n) => page.evaluate(hrs => { window.__now += hrs * 3600e3; }, n);
const tick = page => page.evaluate(() => window.lookaheadTick());

test('a forward look-ahead walks back toward live as the clock advances', async ({ page }) => {
  await freezeMutableClock(page);
  await boot(page);

  // Pilot sets +3h → looks at the situation at 15:00Z.
  await setMaster(page, 3);
  expect(await master(page)).toBe(3);
  expect(await readout(page)).toContain('15:00Z');
  const target = await page.evaluate(() => window.lookaheadTarget);
  expect(target).toBe(Date.UTC(2026, 5, 21, 15, 0));

  // One hour passes. The gap closes to +2h, but the absolute instant it points at is unchanged
  // (still 15:00Z), and the target instant is not re-anchored to the new now.
  await advanceHours(page, 1);
  await tick(page);
  expect(await master(page)).toBe(2);
  expect(await readout(page)).toContain('15:00Z');
  expect(await viewTime(page)).toBe(Date.UTC(2026, 5, 21, 15, 0));
  expect(await page.evaluate(() => window.lookaheadTarget)).toBe(target);

  // The remaining two hours pass. Now catches up: it snaps to live (0) and the look-ahead
  // clears, so the hazard layers show the real "now".
  await advanceHours(page, 2);
  await tick(page);
  expect(await master(page)).toBe(0);
  expect(await viewTime(page)).toBe(null);
  expect(await page.evaluate(() => window.lookaheadTarget)).toBe(null);
});

test('a tick with the slider at live is a no-op', async ({ page }) => {
  await freezeMutableClock(page);
  await boot(page);
  expect(await master(page)).toBe(0);
  await advanceHours(page, 5);
  await tick(page);
  expect(await master(page)).toBe(0);
  expect(await viewTime(page)).toBe(null);
});
