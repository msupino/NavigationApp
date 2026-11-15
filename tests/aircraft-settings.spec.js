// @ts-check
// Asked: "the planes can only be defined or seen if there is a route -- add to Settings a Route
// section, with the planes configuration part". Settings -> Route -> Aircraft opens the flight
// plan's aircraft panel in a window of its own: no route needed, and the panel goes back after.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof createAircraftProfile === 'function' && typeof createDraggableModal === 'function');
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading'); if (b) b.remove();
    document.documentElement.classList.remove('app-booting');
    const t = document.getElementById('map-tour'); if (t) t.remove();
  });
}
const openWindow = (page) => page.evaluate(() => document.getElementById('aircraft-settings').click());

test('Settings has a Route group with Aircraft, which opens with no route', async ({ page }) => {
  await boot(page);
  const head = await page.evaluate(() => {
    const b = document.getElementById('aircraft-settings');
    let el = b.previousElementSibling;
    while (el && !el.classList.contains('tb-group')) el = el.previousElementSibling;
    return { inSettings: !!b.closest('.tb-section[data-sec="settings"]'), group: el && el.textContent, route: state.waypoints.length };
  });
  expect(head).toEqual({ inSettings: true, group: 'Route', route: 0 });
  await openWindow(page);
  const win = page.locator('.ac-settings-modal');
  await expect(win).toBeVisible();
  await expect(win.locator('#ac-type')).toBeVisible();
  await expect(win.locator('#ac-callsign')).toBeVisible();
  await expect(win.locator('#ac-usable')).toBeVisible();
  await expect(win.locator('#acs-gph')).toBeVisible();
  await expect(win.locator('#acs-taxi')).toBeVisible();
});

test('an aircraft made there is kept, with its fuel burn, and the panel goes home', async ({ page }) => {
  await boot(page);
  await openWindow(page);
  const win = page.locator('.ac-settings-modal');
  await win.locator('#ac-callsign').fill('ABC');
  await win.locator('#ac-callsign').dispatchEvent('change');
  await win.locator('#acs-gph').fill('9.5');
  await win.locator('#acs-gph').dispatchEvent('input');
  await expect(win.locator('#ac-type option:checked')).toHaveText(/4X-ABC/);
  await page.keyboard.press('Escape');
  await expect(win).toHaveCount(0);
  const r = await page.evaluate(() => ({
    home: document.getElementById('ac-panel').parentNode.id,
    figsOpen: document.getElementById('ac-custom').open,
    profiles: JSON.parse(localStorage.getItem('navaid.aircraftProfiles') || '[]').map(p => p.name),
    gph: JSON.parse(localStorage.getItem('navaid.aircraft')).gph,
  }));
  expect(r).toEqual({ home: 'ac-panel-home', figsOpen: false, profiles: ['ABC'], gph: 9.5 });
});

test('opened over a flight plan, the panel goes back into the plan', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADRA' }];
    syncLegs(); draw(); showFlightPlan();
  });
  await openWindow(page);
  await expect(page.locator('.ac-settings-modal #ac-type')).toBeVisible();
  await page.locator('.ac-settings-modal #acs-gph').fill('7');
  await page.locator('.ac-settings-modal #acs-gph').dispatchEvent('input');
  await page.locator('.ac-settings-modal .modal-close-x').click();
  expect(await page.evaluate(() => ({
    inPlan: !!document.querySelector('.fp-aircraft #ac-panel'),
    planGph: document.getElementById('aircraft-gph').value,
  }))).toEqual({ inPlan: true, planGph: '7' });
});

test('Restore is dimmed, not hidden, for a type with no listed figures', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { aircraft = { gph: 8, taxiGal: 1, type: 'ZZZZ' }; saveAircraft(); });
  await openWindow(page);
  const r = page.locator('.ac-settings-modal #ac-restore');
  await expect(r).toBeVisible();
  await expect(r).toHaveAttribute('aria-disabled', 'true');
});

test('the Hebrew labels', async ({ page }) => {
  await boot(page, 'he');
  expect(await page.locator('#aircraft-settings').textContent()).toBe('כלי טיס');
});

test('a flight plan closed while the window is open: the panel stays, then goes home', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADRA' }];
    syncLegs(); draw(); showFlightPlan();
  });
  await openWindow(page);
  await page.evaluate(() => closeFlightPlan());
  await expect(page.locator('.ac-settings-modal #ac-type')).toBeVisible();
  await page.locator('.ac-settings-modal .modal-close-x').click();
  expect(await page.evaluate(() => document.getElementById('ac-panel').parentNode.id)).toBe('ac-panel-home');
  await page.evaluate(() => showFlightPlan());
  await expect(page.locator('.fp-aircraft #ac-type')).toBeVisible();
});
