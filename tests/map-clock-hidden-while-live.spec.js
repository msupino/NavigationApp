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

// A follower is watching a live aeroplane from the ground: same state, other end of the
// link. Reported from a follower window -- there is a dimmed time slider on the map, and
// nothing on that page answers to it.
test('following someone else\'s aeroplane puts the clock away too', async ({ page }) => {
  await boot(page);
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

// Reported twice, from a phone: there is a dimmed time slider on the map although nothing
// needs it. On a phone the strip lies across the bottom of the chart, and the deck's own
// strip along the top already carries this clock's readout beside the Zulu time -- so when
// nothing answers to it, the dim is not a quieter control, it is a band of chart saying
// nothing that is not already said two lines away.
const PHONE = { width: 390, height: 844 };

async function phone(page, opts) {
  await page.setViewportSize(PHONE);
  await page.goto('?lang=en&nogist' + ((opts && opts.deck === false) ? '&deck=0' : ''));
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

test('on a phone the clock goes away when nothing answers to it', async ({ page }) => {
  await phone(page);
  expect(await page.evaluate(() => document.body.classList.contains('deck-on'))).toBe(true);
  expect(await clockHidden(page), 'nothing timed is on').toBe(true);
  // ...and comes straight back when something needs it.
  await timedLayerOn(page, true);
  expect(await clockHidden(page)).toBe(false);
  await timedLayerOn(page, false);
  expect(await clockHidden(page)).toBe(true);
});

test('the desktop still dims rather than hides', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.getElementById('map-time') && window.NavAid);
  // No deck: the strip has a fixed place and the room to keep it, and a control that
  // vanishes from a fixed place is one a pilot hunts for.
  expect(await page.evaluate(() => document.body.classList.contains('deck-on'))).toBe(false);
  expect(await clockHidden(page)).toBe(false);
  expect(await page.evaluate(() => document.getElementById('map-time').classList.contains('idle')))
    .toBe(true);
});

test('without the deck, a phone keeps the old behaviour', async ({ page }) => {
  await phone(page, { deck: false });
  expect(await clockHidden(page)).toBe(false);
});

test('the gist can keep it on screen on a phone too', async ({ page }) => {
  await phone(page);
  expect(await clockHidden(page)).toBe(true);
  const shown = await page.evaluate(() => {
    NavAid.tuningDefaults.hideIdleMapClockOnPhone.value = false;
    NavAid.refreshMapClock();
    return !document.getElementById('map-time').hidden;
  });
  expect(shown).toBe(true);
});

// The live rule still outranks everything: flying is not "nothing to scrub".
test('a live position hides it on a phone even with a timed layer on', async ({ page }) => {
  await phone(page);
  await timedLayerOn(page, true);
  expect(await clockHidden(page)).toBe(false);
  await setLive(page, 'location');
  expect(await clockHidden(page)).toBe(true);
});
