// @ts-check
// Requested: the flight plan's aircraft fields (gallons per hour, taxi and takeoff) "in the
// settings menu as well, changes affect both". One profile, two places.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('settings-gph') && typeof openFlightPlan === 'function');
}
const values = (page) => page.evaluate(() => ({
  sGph: document.getElementById('settings-gph').value,
  sTaxi: document.getElementById('settings-taxi').value,
  fpGph: (document.getElementById('aircraft-gph') || {}).value || null,
  fpTaxi: (document.getElementById('aircraft-taxi') || {}).value || null,
  stored: JSON.parse(localStorage.getItem('navaid.aircraft') || 'null'),
}));
const type = (page, id, v) => page.evaluate(([i, val]) => {
  const el = document.getElementById(i); el.value = val; el.dispatchEvent(new Event('input'));
}, [id, v]);

test('Settings shows the profile and saves a change to it', async ({ page }) => {
  await boot(page);
  const before = await values(page);
  expect(Number(before.sGph)).toBeGreaterThan(0);
  await type(page, 'settings-gph', '9.5');
  await type(page, 'settings-taxi', '1.4');
  expect((await values(page)).stored).toEqual({ gph: 9.5, taxiGal: 1.4 });
  // ...and it survives a reload, read back into Settings.
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('settings-gph'));
  const after = await values(page);
  expect([after.sGph, after.sTaxi]).toEqual(['9.5', '1.4']);
});

test('a change in either place shows in the other, with the flight plan open', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.98, lng: 35.57, name: 'LLIB' }];
    syncLegs(); draw(); openFlightPlan();
  });
  await page.waitForSelector('#aircraft-gph');
  await type(page, 'settings-gph', '11');
  let v = await values(page);
  expect(v.fpGph).toBe('11');
  expect(v.stored.gph).toBe(11);
  await type(page, 'aircraft-taxi', '2.2');
  v = await values(page);
  expect(v.sTaxi).toBe('2.2');
  expect(v.stored.taxiGal).toBe(2.2);
});
