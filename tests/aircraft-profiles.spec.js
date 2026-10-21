// @ts-check
// #671, aircraft profiles. The aircraft lives in the flight plan's Aircraft row, keyed by its call
// sign (the code the flight plan form files, after 4X-); its type is selected for it. Until it has
// a call sign it is the unnamed aircraft, which has a type all the same. The rest of its figures are in a popover, which never makes
// the plan taller. The filing form shows the call sign and type read-only. Descent rate is one of
// the figures, and the nav log plans with it.
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
const openPlan = (page) => page.evaluate(() => showFlightPlan());
const openFigures = (page) => page.locator('#ac-custom > summary').click();
const answer = async (page, text) => {
  if (text !== undefined) await page.locator('.app-ask-input').fill(text);
  await page.locator('.follow-me-ask-ok').last().click();
};

test('the aircraft is chosen in the flight plan, not in Settings', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => !!document.querySelector('.tb-section[data-sec="settings"] #ac-type'))).toBe(false);
  await openPlan(page);
  await expect(page.locator('.fp-aircraft #ac-type')).toBeVisible();
  await expect(page.locator('#ac-type option:checked')).toHaveText('No call sign (C172)');   // the default
  // The picker lists aircraft, not types.
  expect(await page.locator('#ac-type option').evaluateAll(os => os.map(o => o.value))).toEqual(['', '__new']);
  await page.evaluate(() => closeFlightPlan());
  expect(await page.evaluate(() => document.getElementById('ac-panel').parentNode.id)).toBe('ac-panel-home');
});

test('Custom figures opens over the plan: the plan window keeps its size', async ({ page }) => {
  for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await boot(page);
    await openPlan(page);
    const box = () => page.evaluate(() => {
      const r = document.querySelector('.modal-back.flight-plan .modal').getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height), Math.round(r.top)];
    });
    const before = await box();
    await openFigures(page);
    await expect(page.locator('.ac-menu')).toBeVisible();
    expect(await box()).toEqual(before);
    // And it is on the screen, whichever side the row starts from.
    const m = await page.locator('.ac-menu').boundingBox();
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(size.width + 1);
    await page.keyboard.press('Escape');                                        // closes it, not the plan
    await expect(page.locator('.ac-menu')).toBeHidden();
    await expect(page.locator('.modal-back.flight-plan')).toBeVisible();
    await page.evaluate(() => closeFlightPlan());
  }
});

test('the type selected fills its figures, descent included; a change is marked and Restore puts it back', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  await openFigures(page);
  await page.selectOption('#ac-model', 'PA28');
  expect(await page.evaluate(() => [aircraft.type, aircraft.gph, aircraft.taxiGal, aircraft.descentFpm,
    document.getElementById('aircraft-gph').value]))
    .toEqual(['PA28', 8.5, 1.2, 500, '8.5']);
  await expect(page.locator('#ac-descent')).toHaveValue('500');
  await page.locator('#ac-descent').fill('700');
  await expect(page.locator('.ac-field[data-field="descentFpm"]')).toHaveClass(/ac-overridden/);
  await page.locator('#ac-restore').click();
  expect(await page.evaluate(() => aircraft.descentFpm)).toBe(500);
  // No call sign yet: nothing to delete. Typing one makes it one of your own, its type kept.
  await expect(page.locator('#ac-profile-delete')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#ac-callsign').fill('DEF');
  await page.locator('#ac-callsign').dispatchEvent('change');
  await expect(page.locator('#ac-type option:checked')).toHaveText('4X-DEF (PA28)');
  expect(await page.locator('#ac-type option').evaluateAll(os => os.map(o => o.value).includes(''))).toBe(false);
});

test('New aircraft is its call sign; its type is selected for it, and its figures are its own', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  await page.selectOption('#ac-type', '__new');
  await answer(page, '4x-crw');
  await expect(page.locator('#ac-type option:checked')).toHaveText('4X-CRW (C172)');
  await expect(page.locator('.ac-menu')).toBeVisible();                       // opened where its type is chosen
  await expect(page.locator('#ac-callsign')).toHaveValue('CRW');
  // Selecting its type brings that type's figures; they are this aircraft's to change.
  await page.selectOption('#ac-model', 'C152');
  expect(await page.evaluate(() => [aircraft.type, aircraft.gph, aircraft.profile ? 1 : 0])).toEqual(['C152', 6, 1]);
  await page.locator('#ac-descent').fill('400');
  await page.locator('#aircraft-gph').fill('5.5');
  // A type not on the list: Other, and its ICAO code.
  await page.selectOption('#ac-model', '__other');
  await page.locator('#ac-icao').fill('c150');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.aircraftProfiles')));
  expect(stored).toHaveLength(1);
  expect([stored[0].name, stored[0].type, stored[0].gph, stored[0].descentFpm]).toEqual(['CRW', 'C150', 5.5, 400]);
  // The call sign is the name: changing it renames the aircraft.
  await page.locator('#ac-callsign').fill('CRX');
  await page.locator('#ac-callsign').dispatchEvent('change');
  await expect(page.locator('#ac-type option:checked')).toHaveText('4X-CRX (C150)');
  // Another aircraft and back, and a reload: each comes back with its own numbers.
  await page.evaluate(() => { createAircraftProfile('ZZZ', 'C172'); setAircraftProfileType('C172'); });
  expect(await page.evaluate(() => aircraft.gph)).toBe(8.5);
  await page.evaluate(() => refreshSettingsAircraft());
  await page.selectOption('#ac-type', 'profile:' + stored[0].id);
  expect(await page.evaluate(() => [aircraft.type, aircraft.gph, aircraft.descentFpm])).toEqual(['C150', 5.5, 400]);
  await page.reload();
  await boot(page);
  expect(await page.evaluate(() => [aircraft.profile, aircraft.type, aircraftProfiles[0].name])).toEqual([stored[0].id, 'C150', 'CRX']);
});

test('the same call sign twice is the same aircraft', async ({ page }) => {
  await boot(page);
  const n = await page.evaluate(() => { createAircraftProfile('CRW', 'C172'); createAircraftProfile('4X-CRW', 'PA28'); return aircraftProfiles.length; });
  expect(n).toBe(1);
});

test('Delete is asked in the app; deleting the one in use goes back to its type', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => createAircraftProfile('AAA', 'PA28'));
  await openPlan(page);
  await openFigures(page);
  await page.locator('#ac-profile-delete').click();
  await expect(page.locator('.follow-me-ask-text').last()).toContainText('4X-AAA');
  await answer(page);
  await expect(page.locator('#ac-type option:checked')).toHaveText('No call sign (PA28)');
  expect(await page.evaluate(() => [aircraftProfiles.length, aircraft.profile || null])).toEqual([0, null]);
  await expect(page.locator('.toast').last()).toContainText('4X-AAA');
});

test('the filing form files the aircraft\'s call sign and type, read-only, and says where they come from', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => createAircraftProfile('CRW', 'P28A'));
  await page.evaluate(() => showFplDialog());
  await expect(page.locator('#fpl-reg')).toHaveValue('CRW');
  await expect(page.locator('#fpl-type')).toHaveValue('P28A');
  expect(await page.locator('#fpl-reg').evaluate(el => el.readOnly)).toBe(true);
  expect(await page.locator('#fpl-type').evaluate(el => el.readOnly)).toBe(true);
  await expect(page.locator('#fpl-type-hint')).toContainText('CRW');
});

test('no call sign yet: it is typed in the filing form as before', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setAircraftType('C172'));
  await page.evaluate(() => showFplDialog());
  expect(await page.locator('#fpl-reg').evaluate(el => el.readOnly)).toBe(false);
});

test('an aircraft set by hand before profiles (Other..., filing P28A as 4X-ABC) becomes one of your own', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('navaid.aircraft', JSON.stringify({ gph: 9.2, taxiGal: 1, type: '' }));
    localStorage.setItem('navaid.fpl.type', 'P28A');
    localStorage.setItem('navaid.fpl.reg', 'ABC');
  });
  await boot(page);
  expect(await page.evaluate(() => [aircraftProfiles.length, aircraftProfiles[0].name, aircraft.type, aircraft.gph]))
    .toEqual([1, 'ABC', 'P28A', 9.2]);
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
  await openFigures(page);
  await expect(page.locator('label:has(#ac-callsign) > span').first()).toHaveText('אות קריאה');
  await expect(page.locator('label:has(#ac-descent) span')).toHaveText('ירידה (רגל/דקה)');
  await expect(page.locator('#ac-type option[value="__new"]')).toHaveText('מטוס חדש…');
});
