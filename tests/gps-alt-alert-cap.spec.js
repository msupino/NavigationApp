// @ts-check
// Reported from the air: repeated altitude alarms on one leg. The episode latch stops a
// CONTINUOUS deviation repeating, but an aircraft riding the tolerance — a bumpy leg, a
// slow drift, a climb settling — crosses the line again and again, and every crossing was a
// fresh episode and a fresh alarm. Two calls per leg is the cap: after that the pilot knows,
// and more of it is the noise that gets alerts switched off altogether.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function' &&
    typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
      { lat: 32.20, lng: 34.0, name: 'BRAVO' },
      { lat: 32.40, lng: 34.0, name: 'CHARLIE' },
    ];
    syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = 2000; });
    gpsResetLegAlerts();
    // Alerts only fire once the fix is demonstrably on a leg.
    gpsOwn = { lat: 32.05, lng: 34.0, hdg: 0, t: Date.now() };
    _gpsAlertConfirmed = true;
    window.__alerts = [];
    window.gpsSendWatchAlert = (title) => { window.__alerts.push(title); };
  });
}

// Fly at `alt` (feet, as an altimeter would read it) and let the alert logic run.
const at = (page, alt, lat) => page.evaluate(([a, la]) => {
  gpsLastAlt = a;
  gpsAltIsGeometric = false;          // already an indicated altitude: no correction
  gpsOwn = { lat: la, lng: 34.0, hdg: 0, t: Date.now() };
  gpsCheckLegAlerts();
}, [alt, lat]);

const altCalls = (page) => page.evaluate(() =>
  window.__alerts.filter(t => t === 'Altitude').length);

test('an aircraft riding the tolerance is told twice, not endlessly', async ({ page }) => {
  await boot(page);
  // Six excursions past tolerance, each settling back inside it: six episodes.
  let lat = 32.02;
  for (let i = 0; i < 6; i++) {
    await at(page, 2400, lat += 0.005);      // 400 ft off plan
    await at(page, 2000, lat += 0.005);      // back on plan
  }
  expect(await altCalls(page)).toBe(2);
});

test('a continuous deviation still says it once', async ({ page }) => {
  await boot(page);
  let lat = 32.02;
  for (let i = 0; i < 5; i++) await at(page, 2400, lat += 0.005);
  expect(await altCalls(page)).toBe(1);
});

test('the next leg gets its own two', async ({ page }) => {
  await boot(page);
  let lat = 32.02;
  for (let i = 0; i < 4; i++) {
    await at(page, 2400, lat += 0.005);
    await at(page, 2000, lat += 0.005);
  }
  expect(await altCalls(page)).toBe(2);
  // Move onto the second leg: past BRAVO.
  await page.evaluate(() => { window.__alerts.length = 0; });
  await at(page, 2000, 32.25);
  await at(page, 2000, 32.30);
  const onLeg2 = await page.evaluate(() => gpsAlertLegIndex);
  expect(onLeg2).toBe(1);
  let lat2 = 32.30;
  for (let i = 0; i < 4; i++) {
    await at(page, 2400, lat2 += 0.005);
    await at(page, 2000, lat2 += 0.005);
  }
  expect(await altCalls(page)).toBe(2);      // a fresh budget, not a spent one
});

test('starting a new session resets the budget', async ({ page }) => {
  await boot(page);
  let lat = 32.02;
  for (let i = 0; i < 4; i++) {
    await at(page, 2400, lat += 0.005);
    await at(page, 2000, lat += 0.005);
  }
  expect(await altCalls(page)).toBe(2);
  await page.evaluate(() => {
    gpsResetLegAlerts();
    _gpsAlertConfirmed = true;
    window.__alerts.length = 0;
  });
  await at(page, 2400, 32.06);
  expect(await altCalls(page)).toBe(1);
});
