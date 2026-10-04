// @ts-check
// The SIGMET, AIRMET and NOTAM controls (Charts buttons, Extra-layers rows) dim when nothing is
// in force at any time across the look-ahead slider's range (24 h), and come back for something
// that starts later inside it -- not only for what is in force at this minute.
const { test, expect } = require('./_setup');

const H = 3600e3;
async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshSigmetBtn === 'function' && typeof notamsInLookahead === 'function'
    && typeof refreshNotamListBtn === 'function');
}
// Feed a window of validity [from, to] (hours from now) to all three feeds and refresh the controls.
function feed(page, from, to) {
  return page.evaluate(([from, to, H]) => {
    const now = Date.now();
    new Function('v', 'sigmets = v')([{ id: 'T1', firId: 'LCCC', hazard: 'TS', raw: 'LCCC SIGMET T1 VALID',
      validFrom: (now + from * H) / 1000, validTo: (now + to * H) / 1000, coords: [] }]);
    new Function('v', 'airmets = v; window.airmets = v')([{ id: 'a', hazard: 'TURB', raw: 'LLLL AIRMET 1 VALID',
      validFrom: new Date(now + from * H).toISOString(), validTo: new Date(now + to * H).toISOString(), coords: [] }]);
    new Function('v', 'notams = v')([{ id: 'A0001/26', icao: 'LLHZ', text: 'RWY 11/29 CLSD.',
      start: new Date(now + from * H).toISOString(), end: new Date(now + to * H).toISOString(), geom: null }]);
    refreshSigmetBtn(); refreshSigmetLayerCount(); refreshAirmetGroup(); refreshAirmetBtn(); refreshNotamListBtn();
    const idle = id => document.getElementById(id).closest('.navtoggle').classList.contains('navtoggle-idle');
    const off = id => document.getElementById(id).disabled;
    return { btn: [off('sigmet-btn'), off('airmet-btn'), off('notam-list-btn')],
             row: [idle('sigmet-cb'), idle('airmet-cb'), idle('notam-cb')],
             rowClickable: !document.getElementById('sigmet-cb').disabled };
  }, [from, to, H]);
}

test('nothing in the next 24 h: buttons and rows dim, the toggles stay usable', async ({ page }) => {
  await boot(page);
  const r = await feed(page, 30, 34);          // starts after the look-ahead ends
  expect(r.btn).toEqual([true, true, true]);
  expect(r.row).toEqual([true, true, true]);
  expect(r.rowClickable).toBe(true);
  const past = await feed(page, -6, -1);       // already over
  expect(past.btn).toEqual([true, true, true]);
  expect(past.row).toEqual([true, true, true]);
});

test('something starting later in the look-ahead keeps them lit, and the list shows it', async ({ page }) => {
  await boot(page);
  const r = await feed(page, 3, 6);            // not in force now, but within 24 h
  expect(r.btn).toEqual([false, false, false]);
  expect(r.row).toEqual([false, false, false]);
  await page.locator('#sigmet-btn').evaluate(b => b.click());
  await expect(page.locator('.met-modal .notam-item')).toHaveCount(1);
});

test('in force now: lit, as before', async ({ page }) => {
  await boot(page);
  const r = await feed(page, -1, 2);
  expect(r.btn).toEqual([false, false, false]);
  expect(r.row).toEqual([false, false, false]);
});
