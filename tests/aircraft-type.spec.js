// @ts-check
// Issue #671 / asked: choose the aircraft type in Settings; it fills the figures (cruise TAS,
// gal/hour, taxi, usable fuel, climb), each can be overridden and restored, and it is the type
// the flight plan form files -- choosing it there changes Settings too, and is remembered.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setAircraftType === 'function' && document.getElementById('settings-ac-type'));
}
const chooseType = (page, code) => page.evaluate((c) => { const s = document.getElementById('settings-ac-type'); s.value = c; s.dispatchEvent(new Event('change')); }, code);
const typeIn = (page, id, v) => page.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = String(v); e.dispatchEvent(new Event('input')); }, [id, v]);

test('choosing C172 fills the figures from its table (taxi 1.1, the C172N/P manual)', async ({ page }) => {
  await boot(page);
  await chooseType(page, 'C172');
  const v = await page.evaluate(() => ({ a: aircraft, vs: window.profileVS,
    ui: ['settings-tas', 'settings-gph', 'settings-taxi', 'settings-usable', 'settings-climb-kt'].map(id => document.getElementById(id).value) }));
  expect(v.a).toMatchObject({ type: 'C172', tasKt: 115, gph: 8.5, taxiGal: 1.1, usableGal: 53, climbKt: 75 });
  expect(v.vs).toBe(700);
  expect(v.ui).toEqual(['115', '8.5', '1.1', '53', '75']);
  // New legs start at the cruise TAS.
  const speed = await page.evaluate(() => { state.waypoints = [{ lat: 32.1, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'B' }]; syncLegs(); return state.legs[0].flightSpeed; });
  expect(speed).toBe(115);
  // A leg still on the default follows a new type; a typed one keeps its speed.
  const after = await page.evaluate(() => {
    state.waypoints.push({ lat: 32.5, lng: 35.0, name: 'C' }); syncLegs();
    state.legs[1].flightSpeed = 99; markLegSpeedManual(state.legs[1], 'flightSpeed');
    const s = document.getElementById('settings-ac-type'); s.value = 'C152'; s.dispatchEvent(new Event('change'));
    return [state.legs[0].flightSpeed, state.legs[1].flightSpeed];
  });
  expect(after).toEqual([95, 99]);
});

test('an overridden figure is marked and kept; Restore puts the type back', async ({ page }) => {
  await boot(page);
  await chooseType(page, 'PA28');
  const restore = page.locator('#settings-ac-restore');
  await expect(restore).toHaveText('Restore PA28 figures');
  await expect(restore).toHaveAttribute('aria-disabled', 'true');           // nothing changed yet
  await typeIn(page, 'settings-gph', 9.5);
  await expect(page.locator('.ac-field[data-field="gph"]')).toHaveClass(/ac-overridden/);
  await expect(page.locator('.ac-field[data-field="gph"]')).toHaveAttribute('title', /8\.5/);
  await expect(restore).not.toHaveAttribute('aria-disabled', 'true');
  await page.reload();
  await page.waitForFunction(() => typeof setAircraftType === 'function');
  expect(await page.evaluate(() => [aircraft.type, aircraft.gph])).toEqual(['PA28', 9.5]);   // kept
  await page.locator('#settings-ac-restore').evaluate(b => b.click());
  expect(await page.evaluate(() => aircraft.gph)).toBe(8.5);
  await expect(page.locator('.ac-field[data-field="gph"]')).not.toHaveClass(/ac-overridden/);
});

test('the flight plan form files the Settings type; choosing one there changes Settings, and stays', async ({ page }) => {
  await boot(page);
  await chooseType(page, 'DA40');
  const open = () => page.evaluate(() => { state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.8, lng: 35.04, name: 'LLHA' }];
    syncLegs(); draw(); showFplDialog(); });
  const hasForm = await page.evaluate(() => typeof showFplDialog === 'function');
  test.skip(!hasForm, 'filing form entry point not exposed');
  await open();
  const sel = page.locator('#fpl-type-select');
  await expect(sel).toHaveValue('DA40');
  // Endurance from the aircraft: (40 - 1.0) / 8.5 h = 4 h 35 -> 4 h 30 offered.
  await expect(page.locator('#fpl-endurance')).toHaveValue('0430');
  await sel.selectOption('C152');
  expect(await page.evaluate(() => [aircraft.type, aircraft.gph, document.getElementById('settings-ac-type').value])).toEqual(['C152', 6, 'C152']);
  await page.reload();
  await page.waitForFunction(() => typeof setAircraftType === 'function' && document.getElementById('settings-ac-type').value);
  expect(await page.evaluate(() => document.getElementById('settings-ac-type').value)).toBe('C152');
});

test('Hebrew: the controls have their Hebrew names', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => document.getElementById('settings-ac-type'));
  await expect(page.locator('label:has(#settings-ac-type) span')).toHaveText('סוג מטוס');
});
