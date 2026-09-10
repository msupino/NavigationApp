// @ts-check
// Reported from the app: the time sliders in Extra layers do not progress over time -- you
// have to refresh the page.
//
// The walk-back from "+3h" toward live already worked (lookahead-countdown.spec.js). What
// did not was the other half: AT live there is no walk-back left to do, so the tick returned
// at its first line and nothing re-read the clock. A chart left open across the top of the
// hour went on naming -- and the layers went on filtering at -- the hour it was opened in,
// until a reload. A flight brief sits open for exactly that long.
//
// The second half is the map clock, which is a second face on the same slider. The tick
// moves that slider without anyone touching it, and 'input' is the wrong event for that (it
// would re-enter the handler that anchors the target instant), so the map clock never heard
// the walk-back either.
const { test, expect } = require('./_setup');

async function freezeMutableClock(page) {
  await page.addInitScript(() => {
    window.__now = Date.UTC(2026, 5, 21, 12, 0);   // 12:00Z, exactly top of the hour
    const RealDate = Date;
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
  await page.waitForFunction(() => document.getElementById('lookahead-time')
    && document.getElementById('map-time-slider') && typeof draw === 'function');
}

const readout = page => page.evaluate(() => document.getElementById('lookahead-time-val').textContent);
const mapRead = page => page.evaluate(() => document.getElementById('map-time-read').textContent);
const master = page => page.evaluate(() => parseInt(document.getElementById('lookahead-time').value, 10));
const advanceHours = (page, n) => page.evaluate(hrs => { window.__now += hrs * 3600e3; }, n);
const advanceMinutes = (page, n) => page.evaluate(m => { window.__now += m * 60e3; }, n);
const tick = page => page.evaluate(() => window.lookaheadTick());
const setMaster = (page, h) => page.evaluate(hh => {
  const m = document.getElementById('lookahead-time');
  m.value = String(hh);
  m.dispatchEvent(new Event('input'));
}, h);

test('at live the readout follows the clock instead of freezing at the hour it loaded in', async ({ page }) => {
  await freezeMutableClock(page);
  await boot(page);
  expect(await readout(page)).toContain('12:00Z');

  await advanceHours(page, 1);
  await tick(page);
  expect(await master(page), 'live is still live -- the slider must not move').toBe(0);
  expect(await readout(page)).toContain('13:00Z');

  await advanceHours(page, 2);
  await tick(page);
  expect(await readout(page)).toContain('15:00Z');
});

test('the map clock names the same hour, without being scrubbed', async ({ page }) => {
  await freezeMutableClock(page);
  await boot(page);
  expect(await mapRead(page)).toContain('12:00Z');
  await advanceHours(page, 1);
  await tick(page);
  expect(await mapRead(page)).toContain('13:00Z');
});

test('the map clock follows the walk-back it did not trigger', async ({ page }) => {
  await freezeMutableClock(page);
  await boot(page);
  await setMaster(page, 3);
  expect(await mapRead(page)).toContain('15:00Z');

  await advanceHours(page, 1);
  await tick(page);
  // The master walked +3h -> +2h on its own. The map clock is the face the pilot is looking
  // at; leaving it saying "+3h" would name an hour no layer is using any more.
  expect(await master(page)).toBe(2);
  expect(await mapRead(page)).toContain('+2');
  expect(await mapRead(page)).toContain('15:00Z');
});

test('the mirror sliders in Extra layers move with it', async ({ page }) => {
  await freezeMutableClock(page);
  await boot(page);
  await setMaster(page, 2);
  await advanceHours(page, 1);
  await tick(page);
  const mirrors = await page.evaluate(() => ['notam-time', 'windfield-time', 'airfield-wind-time']
    .map(id => { const el = document.getElementById(id); return el ? el.value : null; }));
  expect(mirrors).toEqual(['1', '1', '1']);
});

test('a tick inside the same hour changes nothing', async ({ page }) => {
  await freezeMutableClock(page);
  await boot(page);
  // The tick runs every minute. Re-dispatching to every timed layer sixty times an hour --
  // several of which refetch on input -- for a label that has not changed would be its own
  // bug, so the hour has to actually turn over.
  const before = await page.evaluate(() => {
    window.__syncs = 0;
    document.getElementById('notam-time').addEventListener('input', () => { window.__syncs++; });
    return window.__syncs;
  });
  expect(before).toBe(0);
  await advanceMinutes(page, 30);
  await tick(page);
  await tick(page);
  expect(await page.evaluate(() => window.__syncs)).toBe(0);

  await advanceMinutes(page, 30);            // now 13:00Z, the hour has turned
  await tick(page);
  expect(await page.evaluate(() => window.__syncs)).toBe(1);
});

test('the walk-back still never re-anchors the instant the pilot chose', async ({ page }) => {
  await freezeMutableClock(page);
  await boot(page);
  await setMaster(page, 3);
  const target = await page.evaluate(() => window.lookaheadTarget);
  expect(target).toBe(Date.UTC(2026, 5, 21, 15, 0));
  // Ticking at live and ticking through a walk-back both run the same sync(); if either one
  // fired a plain 'input' on the master, that handler would re-anchor +Nh to the NEW now and
  // the chosen instant would slide forward for ever, which is the bug the whole mechanism
  // exists to avoid.
  await advanceHours(page, 1);
  await tick(page);
  expect(await page.evaluate(() => window.lookaheadTarget)).toBe(target);
  await advanceHours(page, 2);
  await tick(page);
  expect(await master(page)).toBe(0);
  expect(await page.evaluate(() => window.lookaheadTarget)).toBe(null);
});
