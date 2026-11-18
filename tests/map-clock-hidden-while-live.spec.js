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

// The desktop takes the idle clock away on its own now, so the live/following rule is tested
// with a timed layer up: the clock is on screen to begin with, and going live is what removes
// it. (The wind overlay stands in for NOTAM, which a nogist boot disables without a feed.)
const timedUp = (page) => page.evaluate(() => {
  const cb = document.getElementById('show-wind-cb');
  if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  NavAid.refreshMapClock();
});

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
  await timedUp(page);
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

// A follower is watching a live aeroplane from the ground: same state, other end of the
// link. Reported from a follower window -- there is a dimmed time slider on the map, and
// nothing on that page answers to it.
test('following someone else\'s aeroplane puts the clock away too', async ({ page }) => {
  await boot(page);
  await timedUp(page);
  await page.waitForFunction(() => window.NavAid && NavAid.followMe);
  expect(await clockHidden(page), 'not following yet').toBe(false);
  const hiddenWhileViewing = await page.evaluate(() => {
    // The state the clock asks about, without a broker: viewing() is what it reads.
    const F = NavAid.followMe;
    const realViewing = F.viewing;
    F.viewing = () => true;
    NavAid.refreshMapClock();
    const hidden = document.getElementById('map-time').hidden;
    F.viewing = realViewing;
    NavAid.refreshMapClock();
    return hidden;
  });
  expect(hiddenWhileViewing).toBe(true);
  expect(await clockHidden(page), 'and it comes back when the watch ends').toBe(false);
});

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
  await timedUp(page);                 // a layer answers to it, or the idle rule would hide it anyway
  await page.evaluate(() => { NavAid.tuningDefaults.hideMapClockWhileLive.value = false; });
  await setLive(page, 'location');
  expect(await clockHidden(page)).toBe(false);
  // ...and it is lit on the usual rule, not on this one.
  expect(await page.evaluate(() => document.getElementById('map-time').classList.contains('idle'))).toBe(false);
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

// Reported twice, from a phone: there is a dimmed time slider on the map although nothing
// needs it. On a phone the strip lies across the bottom of the chart, and the deck's own
// strip along the top already carries this clock's readout beside the Zulu time -- so when
// nothing answers to it, the dim is not a quieter control, it is a band of chart saying
// nothing that is not already said two lines away.
const PHONE = { width: 390, height: 844 };

async function phone(page, opts) {
  await page.setViewportSize(PHONE);
  await page.goto('?lang=en&nogist' + ((opts && opts.deck === false) ? '' : ''));
  await page.waitForFunction(() => document.getElementById('map-time')
    && window.NavAid && NavAid.refreshMapClock && NavAid.refreshMobileDeck);
}

// NOTAM is disabled without a feed in a `nogist` boot, so the wind overlay stands in: the
// rule is about whether ANY timed layer is on, not about which one.
const timedLayerOn = (page, on) => page.evaluate((want) => {
  const cb = document.getElementById('show-wind-cb');
  if (!!cb.checked !== want) cb.click();
  NavAid.refreshMapClock();
  return cb.checked;
}, on);

// On a phone the clock lives in the strip: the hour shown there is a button, and the slider
// opens as one row under the strip only when it is tapped (asked: the card took too much of the
// map). Closed, it spends nothing -- timed layer or not.
const clockShown = (page) => page.evaluate(() => {
  const el = document.getElementById('map-time');
  return !el.hidden && getComputedStyle(el).display !== 'none';
});
test('on a phone the clock spends no map until the hour in the strip is tapped', async ({ page }) => {
  await phone(page);
  expect(await page.evaluate(() => document.body.classList.contains('deck-on'))).toBe(true);
  await timedLayerOn(page, true);
  expect(await clockShown(page), 'closed: not on the map').toBe(false);
  await page.locator('.deck-strip-clock').click();
  expect(await clockShown(page)).toBe(true);
  await expect(page.locator('.deck-strip-clock')).toHaveAttribute('aria-expanded', 'true');
  // A second tap folds it back into the strip.
  await page.locator('.deck-strip-clock').click();
  expect(await clockShown(page)).toBe(false);
});

test('the desktop takes the idle clock away too, and the gist can keep it dimmed in place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.getElementById('map-time') && window.NavAid && NavAid.refreshMapClock);
  // No deck, and nothing answering to the clock: it is taken away rather than left dim on a
  // band of chart (requested). The class still marks it idle while it is gone.
  expect(await page.evaluate(() => document.body.classList.contains('deck-on'))).toBe(false);
  expect(await clockHidden(page)).toBe(true);
  expect(await page.evaluate(() => document.getElementById('map-time').classList.contains('idle'))).toBe(true);
  // House rule: only the gist removes a control, so the old dim-in-place stays available.
  await page.evaluate(() => {
    NavAid.tuningDefaults.hideIdleMapClockOnDesktop.value = false;
    NavAid.refreshMapClock();
  });
  expect(await clockHidden(page)).toBe(false);
  expect(await page.evaluate(() => document.getElementById('map-time').classList.contains('idle'))).toBe(true);
});

test('opened on a phone, the clock shows even with nothing timed, and Now folds it away', async ({ page }) => {
  await phone(page);
  await timedLayerOn(page, false);
  await page.locator('.deck-strip-clock').click();
  expect(await clockShown(page)).toBe(true);
  await page.evaluate(() => { const s = document.getElementById('map-time-slider'); s.value = '3'; s.dispatchEvent(new Event('input')); });
  await page.locator('#map-time-now').click();
  expect(await clockShown(page)).toBe(false);
  expect(await page.evaluate(() => document.getElementById('lookahead-time').value)).toBe('0');
});

// The live rule still outranks everything: flying is not "nothing to scrub".
test('a live position hides it on a phone even with a timed layer on', async ({ page }) => {
  await phone(page);
  await timedLayerOn(page, true);
  expect(await clockHidden(page)).toBe(false);
  await setLive(page, 'location');
  expect(await clockHidden(page)).toBe(true);
});
