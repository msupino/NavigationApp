// @ts-check
// Reported from the cockpit: "speed shows up after all others".
//
// It did. The first fix of a session carries no ground speed unless the device volunteers
// one -- there is no previous fix to derive it from -- so the field was simply absent, and
// arrived a second later than the altitude and heading that came off the same fix, pushing
// them along the line as it did. The speed keeps its place now, with a dash standing in
// until the number is in.
const { test, expect } = require('./_setup');

async function boot(page, width) {
  await page.setViewportSize({ width: width || 1280, height: 820 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof gpsUpdateReadout === 'function');
}

// One fix, as the live path leaves things: gs null on the first, a number after.
const fix = (page, o) => page.evaluate((opts) => {
  window.gpsRecording = !!opts.recording;
  window.gpsLiveOn = !opts.recording;
  window.gpsStartT = Date.now() - 754000;
  window.gpsTrack = new Array(12).fill({ lat: 32, lng: 34.9, t: 1 });
  window.gpsLastGS = opts.gs;
  window.gpsLastAlt = 2450;
  window.gpsAltIsGeometric = false;
  window.gpsOwn = { lat: 32, lng: 34.9, hdg: 75, t: Date.now() };
  window.gpsQnh = null;
  gpsUpdateReadout();
  return document.getElementById('gps-readout').textContent;
}, o);

for (const recording of [false, true]) {
  const what = recording ? 'while recording' : 'on a plain live position';
  test('the speed keeps its place before the first one arrives, ' + what, async ({ page }) => {
    await boot(page);
    const first = await fix(page, { recording: recording, gs: null });
    // Not missing, and not a made-up zero: a dash, where the number will be.
    expect(first).toMatch(/—\s*kt/);
    expect(first).toMatch(/2450 ft/);

    const second = await fix(page, { recording: recording, gs: 104 });
    expect(second).toMatch(/104 kt/);
    expect(second).not.toMatch(/—/);
    // Same fields, same order, in both frames: the number landed in the slot that was
    // already there rather than opening a new one and shifting everything after it.
    const fields = (s) => s.split(' · ').map(f => f.replace(/[\d.\u2014]+/g, '#'));
    expect(fields(second)).toEqual(fields(first));
  });
}

test('a heading that is not there yet does not shift the line either', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const read = () => document.getElementById('gps-readout').textContent;
    window.gpsRecording = false; window.gpsLiveOn = true;
    window.gpsLastGS = 104; window.gpsLastAlt = 2450; window.gpsAltIsGeometric = false;
    window.gpsQnh = null;
    // A stationary GPS reports no course at all, and with the compass quiet there is no
    // heading to show -- then the aircraft rolls and there is.
    window.gpsOwn = { lat: 32, lng: 34.9, hdg: NaN, t: Date.now() };
    gpsUpdateReadout();
    const still = read();
    window.gpsOwn = { lat: 32, lng: 34.9, hdg: 75, t: Date.now() };
    gpsUpdateReadout();
    return { still: still, moving: read() };
  });
  expect(got.still).not.toMatch(/°/);
  expect(got.moving).toMatch(/°/);
  // The heading is the tail of the line, so it can appear without moving anything: what
  // matters is that the fields before it did not move when it did.
  expect(got.moving.startsWith(got.still)).toBe(true);
});
