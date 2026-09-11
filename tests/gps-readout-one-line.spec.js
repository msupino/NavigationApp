// @ts-check
// The live readout is the instrument line: points, elapsed, ground speed, altitude, the
// subscale setting and the heading. It is read at arm's length in a cockpit, and on a phone
// it was sharing the footer row with the Record and Location buttons -- about 220px on a
// 390px screen for a string that wants 360. So it wrapped, and a reading broke across two
// lines in the middle. One line, or it is not a readout.
const { test, expect } = require('./_setup');

async function liveReadout(page, opts) {
  return page.evaluate((o) => {
    window.gpsRecording = !!o.recording;
    window.gpsStartT = Date.now() - 754000;
    window.gpsTrack = new Array(128).fill({ lat: 32, lng: 34.9, t: 1 });
    window.gpsLastGS = 104;
    window.gpsLastAlt = 2450;
    window.gpsAltIsGeometric = true;
    window.gpsOwn = { lat: 32, lng: 34.9, hdg: 75, t: Date.now(), hdgCompass: !!o.compass };
    window.gpsQnh = { inHg: 29.83, hPa: 1010, at: Date.now(), lat: 32, lng: 34.9 };
    gpsUpdateReadout();
    const el = document.getElementById('gps-readout');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return { text: el.textContent, lines: Math.round(r.height / lh), width: Math.round(r.width) };
  }, opts);
}

async function boot(page, width, lang) {
  await page.setViewportSize({ width: width, height: 820 });
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof gpsUpdateReadout === 'function');
}

for (const width of [360, 390, 430, 1280]) {
  test('one line at ' + width + 'px', async ({ page }) => {
    await boot(page, width);
    const got = await liveReadout(page, { recording: true, compass: true });
    // Every field is still there -- it takes the width it needs rather than dropping any.
    expect(got.text).toMatch(/pts/);
    expect(got.text).toMatch(/kt/);
    expect(got.text).toMatch(/ft/);
    expect(got.lines).toBe(1);
  });
}

test('one line in Hebrew too, where the words are longer', async ({ page }) => {
  await boot(page, 390, 'he');
  const got = await liveReadout(page, { recording: true, compass: false });
  expect(got.lines).toBe(1);
});

test('and with a stale-fix notice appended', async ({ page }) => {
  await boot(page, 390);
  const got = await page.evaluate(() => {
    window.gpsRecording = true;
    window.gpsStartT = Date.now() - 754000;
    window.gpsTrack = new Array(128).fill({ lat: 32, lng: 34.9, t: 1 });
    window.gpsLastGS = 104;
    window.gpsLastAlt = 2450;
    window.gpsOwn = { lat: 32, lng: 34.9, hdg: 75, t: Date.now() };
    window.gpsQnh = { inHg: 29.83, hPa: 1010, at: Date.now(), lat: 32, lng: 34.9 };
    // The longest this line ever gets: everything, plus "GPS fix 45s" on the end.
    const el = document.getElementById('gps-readout');
    gpsSetReadout(el, ['128 pts · 12:34', '104 kt', '2450 ft', '29.83″', '~070°'], 'GPS fix 45s');
    el.classList.add('live-active');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return { lines: Math.round(r.height / lh), clipped: el.scrollWidth > el.clientWidth + 1 };
  });
  // At its very longest it may be trimmed with an ellipsis -- but it must not wrap: a
  // number split across two lines is misread, a trimmed tail is visibly incomplete.
  expect(got.lines).toBe(1);
});
