// @ts-check
// Requested: hide the time slider on the map when showing location.
//
// The clock dims when nothing on screen answers to it -- it has a fixed place on the chart,
// and a control that vanishes is one the pilot hunts for. A live position is the exception:
// the hour being flown is NOW, the strip lies across the bottom of a phone screen that has an
// aircraft on it, and the live readout is the thing beside it worth reading.
//
// The look-ahead itself is untouched. Every layer still answers to it, and the sliders in
// Extra layers and on the inspector still move it -- only this face goes.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.getElementById('map-time')
    && window.NavAid && NavAid.refreshMapClock && typeof gpsUpdateReadout === 'function');
}

const clockHidden = (page) => page.evaluate(() => document.getElementById('map-time').hidden);

// Live the way the app judges it: gpsPositionLive() reads these three.
const setLive = (page, how) => page.evaluate((mode) => {
  window.gpsRecording = mode === 'recording';
  window.gpsLiveOn = mode === 'location';
  window.simOn = mode === 'sim';
  if (typeof refreshVoiceControl === 'function') refreshVoiceControl();
}, how);

test('showing a position puts the clock away, and stopping brings it back', async ({ page }) => {
  await boot(page);
  expect(await clockHidden(page), 'nothing live yet').toBe(false);
  await setLive(page, 'location');
  expect(await clockHidden(page)).toBe(true);
  await setLive(page, 'off');
  expect(await clockHidden(page), 'the clock has a fixed place and comes back to it').toBe(false);
});

for (const mode of ['recording', 'sim']) {
  test('a ' + mode + ' position hides it too -- it is one rule, not three', async ({ page }) => {
    await boot(page);
    await setLive(page, mode);
    expect(await clockHidden(page)).toBe(true);
  });
}

test('the look-ahead keeps running behind it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const m = document.getElementById('lookahead-time');
    m.value = '4';
    m.dispatchEvent(new Event('input'));
  });
  await setLive(page, 'location');
  // Hidden, not reset: the NOTAM layer and the wind are still showing +4h, and the mirrors
  // that are still on screen still say so.
  expect(await page.evaluate(() => document.getElementById('lookahead-time').value)).toBe('4');
  expect(await page.evaluate(() => document.getElementById('map-time-slider').value)).toBe('4');
  expect(await page.evaluate(() => document.getElementById('notam-time').value)).toBe('4');
  await setLive(page, 'off');
  expect(await page.evaluate(() => document.getElementById('map-time-read').textContent)).toContain('+4');
});

test('the gist can keep it on screen in flight', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { NavAid.tuningDefaults.hideMapClockWhileLive.value = false; });
  await setLive(page, 'location');
  expect(await clockHidden(page)).toBe(false);
  // ...and it is dim or lit on the usual rule, not on this one.
  expect(await page.evaluate(() => document.getElementById('map-time').classList.contains('idle'))).toBe(true);
});

test('the feature switch still wins over both', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureMapClock.value = false;
    NavAid.tuningDefaults.hideMapClockWhileLive.value = false;
    NavAid.refreshMapClock();
  });
  expect(await clockHidden(page)).toBe(true);
});
