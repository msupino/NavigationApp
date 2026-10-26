// @ts-check
// Asked: "if there is an active NOTAM on a blocked route, paint it" -- no route check needed, and
// following the timeline slider. A leg on a corridor a NOTAM closes at the map's time is painted.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof applyRouteTemplate === 'function' && typeof closedLegIndexes === 'function' && typeof clearBootLoading === 'function');
  await page.evaluate(async () => {
    clearBootLoading();
    const list = await (await fetch('data/route-templates.json')).json();
    await applyRouteTemplate((Array.isArray(list) ? list : list.templates).find(x => x.id === 'llmg-llib-north'), 90, false);
  });
}
const hour = 3600e3;

test('a leg on a NOTAM-closed corridor is painted while the NOTAM is in force at the map time', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate((hour) => {
    const now = Date.now();
    new Function('n', 'notams = n;')([{ id: 'A0001/26', text: 'RTE AFULA-TAVOR CLSD DUE TO MIL ACT',
      start: new Date(now + 2 * hour).toISOString(), end: new Date(now + 4 * hour).toISOString() }]);
    return {
      names: state.waypoints.map(w => w.name),
      atNow: closedLegIndexes(now),
      inForce: closedLegIndexes(now + 3 * hour),
      after: closedLegIndexes(now + 5 * hour),
    };
  }, hour);
  expect(r.names.slice(0, 3)).toEqual(['LLMG', 'AFULA', 'TAVOR']);
  expect(r.atNow).toEqual([]);          // not yet in force
  expect(r.inForce).toEqual([1]);       // AFULA-TAVOR
  expect(r.after).toEqual([]);
});

test('the map follows the timeline slider: scrubbing into the NOTAM paints the leg', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate((hour) => {
    const now = Date.now();
    new Function('n', 'notams = n;')([{ id: 'A0002/26', text: 'ROUTE TAVOR-AFULA CLSD',
      start: new Date(now + hour).toISOString(), end: new Date(now + 3 * hour).toISOString() }]);
    window.notamViewTime = now + 2 * hour; draw();
    const scrubbed = window.closedLegs.slice();
    window.notamViewTime = NaN; draw();
    return { scrubbed, live: window.closedLegs.slice() };
  }, hour);
  expect(r.scrubbed).toEqual([1]);       // the NOTAM names it either way round
  expect(r.live).toEqual([]);
});

test('a closure NOTAM is judged at the time asked, not now (filing a later departure too)', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate((hour) => {
    const now = Date.now();
    const n = { id: 'A0003/26', text: 'RTE AFULA-TAVOR CLSD', start: new Date(now + hour).toISOString(), end: new Date(now + 2 * hour).toISOString() };
    return { atNow: notamActive(n, new Date(now)), later: notamActive(n, new Date(now + 1.5 * hour)) };
  }, hour);
  expect(r.atNow).toBe(false);
  expect(r.later).toBe(true);
});
