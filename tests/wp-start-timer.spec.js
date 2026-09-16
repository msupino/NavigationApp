// @ts-check
// A cumulative time counts from the departure field by definition. That is the wrong answer for
// a pilot joining somebody else's plan part-way, or picking the route up at a reporting point:
// the times they want are the ones from where they actually start. One waypoint on the route
// carries the mark, and both places that print a cumulative time read it.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog) && typeof draw === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => {
    state.waypoints = [
      { name: 'LLHZ', lat: 32.17944, lng: 34.83444 },
      { name: 'A', lat: 32.45, lng: 35.0 },
      { name: 'B', lat: 32.7, lng: 35.25 },
      { name: 'LLIB', lat: 32.98111, lng: 35.57194 },
    ];
    syncLegs();
    for (const leg of state.legs) { leg.inboundAltitude = 3000; leg.flightSpeed = 90; }
    draw();
  });
}

const cumTimes = (page) => page.evaluate(() =>
  NavAid.navLog.rows().map(r => r.cumTimeH));

test('with no mark, the clock counts from the departure field', async ({ page }) => {
  await boot(page);
  const cum = await cumTimes(page);
  expect(cum.every(v => typeof v === 'number')).toBe(true);
  // Monotonic, and the first row is its own time.
  for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
});

test('a marked waypoint restarts the clock, and the rows before it have none', async ({ page }) => {
  await boot(page);
  const before = await cumTimes(page);
  await page.evaluate(() => { setTimerWaypoint(2); draw(); });
  const rows = await page.evaluate(() => NavAid.navLog.rows().map(r =>
    ({ leg: r.legIndex, cum: r.cumTimeH, zero: !!r.timerStartsHere, t: r.timeH })));

  // Nothing before the mark has a cumulative time to show...
  const early = rows.filter(r => r.leg < 1);
  expect(early.length).toBeGreaterThan(0);
  for (const r of early) expect(r.cum).toBeNull();

  // ...the row that ENDS on it reads zero, exactly once...
  expect(rows.filter(r => r.zero)).toHaveLength(1);
  const zero = rows.find(r => r.zero);
  expect(zero.leg).toBe(1);
  expect(zero.cum).toBe(0);

  // ...and the rest count from there: the first counted row's cum is its own leg time.
  const after = rows.filter(r => r.leg >= 2);
  expect(after.length).toBeGreaterThan(0);
  expect(after[0].cum).toBeCloseTo(after[0].t, 6);
  // Which is less than it was when the clock ran from departure.
  expect(after[0].cum).toBeLessThan(before[before.length - 1]);
});

// Cumulative fuel is the reserve figure, burned from the departure field whatever the clock does.
test('the fuel keeps counting from departure', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => NavAid.navLog.rows().map(r => r.cumFuelGal));
  await page.evaluate(() => { setTimerWaypoint(2); draw(); });
  const after = await page.evaluate(() => NavAid.navLog.rows().map(r => r.cumFuelGal));
  expect(after).toEqual(before);
});

test('the sheet prints a dash before it and a mark on it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTimerWaypoint(2); draw(); NavAid.navLog.show(); });
  await page.waitForSelector('.navlog-table');
  const col = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.navlog-table tr')[0].children].map(t => t.textContent);
    const at = heads.indexOf('Cum time');
    return [...document.querySelectorAll('.navlog-table tr.navlog-row')]
      .map(tr => tr.children[at].textContent.trim());
  });
  expect(col[0]).toBe('—');
  expect(col.some(v => v.startsWith('▶'))).toBe(true);
  expect(col[col.length - 1]).toMatch(/^\d+:\d\d$/);
});

// One per route: two origins would make "cumulative" mean nothing.
test('only one waypoint can hold it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTimerWaypoint(1); setTimerWaypoint(2); });
  expect(await page.evaluate(() => state.waypoints.map(w => !!w.timerStart)))
    .toEqual([false, false, true, false]);
  expect(await page.evaluate(() => routeTimerIndex())).toBe(2);
});

// Pressing it again on the point that holds it hands the clock back to the departure field.
test('pressing it again clears it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setTimerWaypoint(2));
  await page.evaluate(() => setTimerWaypoint(2));
  expect(await page.evaluate(() => routeTimerIndex())).toBe(-1);
});

// The departure point is not a mark: the clock already starts there.
test('the departure field is not offered it', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => setTimerWaypoint(0))).toBe(false);
  expect(await page.evaluate(() => routeTimerIndex())).toBe(-1);
});

test('the inspector offers it, says when it is set, and takes it back', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.selected = { type: 'wp', index: 2 }; showInspector(); });
  const btn = page.locator('#insp-timer-btn');
  await expect(btn).toHaveText('⏱ Start the clock here');
  await expect(page.locator('#insp-timer-status')).toHaveCount(0);
  await btn.click();
  expect(await page.evaluate(() => routeTimerIndex())).toBe(2);
  await expect(page.locator('#insp-timer-status')).toBeVisible();
  await expect(btn).toHaveText('⏱ Count from departure again');
  await btn.click();
  expect(await page.evaluate(() => routeTimerIndex())).toBe(-1);
  await expect(page.locator('#insp-timer-status')).toHaveCount(0);
});

test('the departure waypoint gets no such button', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.selected = { type: 'wp', index: 0 }; showInspector(); });
  await expect(page.locator('#insp-timer-btn')).toHaveCount(0);
});

// Three places rebuild a waypoint field by field, and anything not named there is dropped --
// which is how a marked turning point used to vanish on every reload.
test('the mark survives a save and a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTimerWaypoint(2); persist(); });
  const inFile = await page.evaluate(() => serializeRoute().waypoints.map(w => !!w.timerStart));
  expect(inFile).toEqual([false, false, true, false]);
  await page.reload();
  await page.waitForFunction(() => typeof routeTimerIndex === 'function' && state.waypoints.length === 4);
  expect(await page.evaluate(() => routeTimerIndex())).toBe(2);
});

// The map prints the same clock on its cumulative kites, so it has to read the same mark --
// two displays counting from different points would be worse than one of them being wrong.
test('the map kites count from the mark too', async ({ page }) => {
  await boot(page);
  const labels = () => page.evaluate(() => {
    const seen = [];
    const orig = window.drawCumTimeArrow;
    window.drawCumTimeArrow = (cx, cy, ang, cumTime, ...rest) => {
      seen.push(cumTime);
      return orig.call(null, cx, cy, ang, cumTime, ...rest);
    };
    draw();
    window.drawCumTimeArrow = orig;
    return seen;
  });
  await page.evaluate(() => { showCumTime = true; draw(); });
  const before = await labels();
  expect(before.length).toBe(3);                    // one per leg
  expect(before.every(t => t !== '--')).toBe(true);

  await page.evaluate(() => { setTimerWaypoint(2); draw(); });
  const after = await labels();
  // Legs 0 and 1 run before the mark: no clock, so nothing to print.
  expect(after[0]).toBe('--');
  expect(after[1]).toBe('--');
  // Leg 2 starts on it, so its kite reads its own time -- less than it read from departure.
  expect(after[2]).not.toBe('--');
  expect(after[2]).not.toBe(before[2]);
});
