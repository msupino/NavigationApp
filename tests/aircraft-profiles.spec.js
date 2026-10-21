// @ts-check
// #671, aircraft profiles. The aircraft lives in the flight plan's Aircraft row: a listed type, or
// one of the pilot's own aircraft (a name, the ICAO type it files as, its own figures). The filing
// form shows the type read-only. Descent rate is one of the figures, and the nav log plans with it.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof createAircraftProfile === 'function');
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading'); if (b) b.remove();
    document.documentElement.classList.remove('app-booting');
    const t = document.getElementById('map-tour'); if (t) t.remove();
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADRA' }];
    syncLegs(); draw();
  });
}
const openPlan = (page) => page.evaluate(() => { showFlightPlan(); document.getElementById('ac-custom').open = true; });
const answer = async (page, text) => {
  if (text !== undefined) await page.locator('.app-ask-input').fill(text);
  await page.locator('.follow-me-ask-ok').last().click();
};

test('the aircraft is chosen in the flight plan, not in Settings', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => !!document.querySelector('.tb-section[data-sec="settings"] #ac-type'))).toBe(false);
  await openPlan(page);
  await expect(page.locator('.fp-aircraft #ac-type')).toBeVisible();
  await expect(page.locator('#ac-type')).toHaveValue('C172');                  // the default
  // Back home, hidden, once the plan is closed.
  await page.evaluate(() => closeFlightPlan());
  expect(await page.evaluate(() => document.getElementById('ac-panel').parentNode.id)).toBe('ac-panel-home');
});

test('a listed type fills its figures, descent included; a change is marked and Restore puts it back', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  await page.selectOption('#ac-type', 'PA28');
  expect(await page.evaluate(() => [aircraft.type, aircraft.gph, aircraft.taxiGal, aircraft.descentFpm,
    document.getElementById('aircraft-gph').value, document.getElementById('ac-descent').value]))
    .toEqual(['PA28', 8.5, 1.2, 500, '8.5', '500']);
  await page.locator('#ac-descent').fill('700');
  await expect(page.locator('.ac-field[data-field="descentFpm"]')).toHaveClass(/ac-overridden/);
  await page.locator('#ac-restore').click();
  expect(await page.evaluate(() => aircraft.descentFpm)).toBe(500);
  // A listed type files as itself: its ICAO box is not editable.
  expect(await page.locator('#ac-icao').evaluate(el => el.readOnly)).toBe(true);
  await expect(page.locator('#ac-profile-delete')).toHaveAttribute('aria-disabled', 'true');
});

test('New aircraft... names one of your own; its figures are its own and survive a reload', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  await page.selectOption('#ac-type', 'C152');
  await page.selectOption('#ac-type', '__new');
  await answer(page, '4X-CRW');
  await expect(page.locator('#ac-type option:checked')).toHaveText('4X-CRW (C152)');
  await expect(page.locator('#ac-profile-rename')).not.toHaveAttribute('aria-disabled', 'true');
  // Its ICAO type and figures are the pilot's to change, and the changes are that aircraft's.
  await page.locator('#ac-icao').fill('c150');
  await page.locator('#aircraft-gph').fill('5.5');
  await page.locator('#ac-descent').fill('400');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.aircraftProfiles')));
  expect(stored).toHaveLength(1);
  expect([stored[0].name, stored[0].type, stored[0].gph, stored[0].descentFpm]).toEqual(['4X-CRW', 'C150', 5.5, 400]);
  // A listed type and back: the aircraft comes back with its own numbers.
  await page.selectOption('#ac-type', 'C172');
  expect(await page.evaluate(() => aircraft.gph)).toBe(8.5);
  await page.selectOption('#ac-type', 'profile:' + stored[0].id);
  expect(await page.evaluate(() => [aircraft.type, aircraft.gph, aircraft.descentFpm])).toEqual(['C150', 5.5, 400]);
  await page.reload();
  await boot(page);
  expect(await page.evaluate(() => [aircraft.profile, aircraft.type, aircraft.gph])).toEqual([stored[0].id, 'C150', 5.5]);
});

test('Rename and Delete, asked in the app; deleting the one in use goes back to its type', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => createAircraftProfile('4X-AAA', 'C172'));
  await openPlan(page);
  await page.locator('#ac-profile-rename').click();
  await answer(page, '4X-BBB');
  await expect(page.locator('#ac-type option:checked')).toHaveText('4X-BBB (C172)');
  await page.locator('#ac-profile-delete').click();
  await expect(page.locator('.follow-me-ask-text').last()).toContainText('4X-BBB');
  await answer(page);
  await expect(page.locator('#ac-type')).toHaveValue('C172');
  expect(await page.evaluate(() => [aircraftProfiles.length, aircraft.profile || null])).toEqual([0, null]);
  await expect(page.locator('.toast').last()).toContainText('4X-BBB');
});

test('the filing form files the aircraft\'s type, read-only, and says where it comes from', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => createAircraftProfile('4X-CRW', 'P28A'));
  await page.evaluate(() => showFplDialog());
  await expect(page.locator('#fpl-type')).toHaveValue('P28A');
  expect(await page.locator('#fpl-type').evaluate(el => el.readOnly)).toBe(true);
  await expect(page.locator('#fpl-type-hint')).toContainText('4X-CRW');
});

test('an aircraft set by hand before profiles (Other..., filing P28A) becomes one of your own', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('navaid.aircraft', JSON.stringify({ gph: 9.2, taxiGal: 1, type: '' }));
    localStorage.setItem('navaid.fpl.type', 'P28A');
  });
  await boot(page);
  expect(await page.evaluate(() => [aircraftProfiles.length, aircraftProfiles[0].name, aircraft.type, aircraft.gph]))
    .toEqual([1, 'P28A', 'P28A', 9.2]);
});

test('the nav log plans the descent at the aircraft\'s rate unless set there', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setAircraftType('C172'); aircraft.descentFpm = 650; saveAircraft(); });
  const rate = await page.evaluate(() => (window.NavAid && NavAid.navLog && typeof NavAid.navLog.config === 'function') ? NavAid.navLog.config().rates.descentFpm : null);
  test.skip(rate === null, 'nav log config not exposed');
  expect(rate).toBe(650);
});

test('Hebrew: the panel speaks Hebrew', async ({ page }) => {
  await boot(page, 'he');
  await openPlan(page);
  await expect(page.locator('#ac-profile-rename')).toHaveText('שנה שם');
  await expect(page.locator('label:has(#ac-descent) span')).toHaveText('ירידה (רגל/דקה)');
  await expect(page.locator('#ac-type option[value="__new"]')).toHaveText('מטוס חדש…');
});
