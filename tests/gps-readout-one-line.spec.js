// @ts-check
// The live readout inside the floating menu card is what this file measures; on a phone
// the deck now carries those numbers on its strip instead (see mobile-deck.spec.js).
// `?deck=0` asks for the card, which is still what a wide screen and a deck-off gist get.
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
    const bar = document.getElementById('toolbar').getBoundingClientRect();
    return { text: el.textContent, lines: Math.round(r.height / lh), width: Math.round(r.width),
             cut: el.scrollWidth > el.clientWidth + 1, fitsPanel: r.right <= bar.right + 1 };
  }, opts);
}

async function boot(page, width, lang) {
  await page.setViewportSize({ width: width, height: 820 });
  await page.goto('?lang=' + (lang || 'en') + '&nogist&deck=0');
  await page.waitForFunction(() => typeof gpsUpdateReadout === 'function');
}

for (const width of [360, 390, 430, 1280]) {
  test('one line at ' + width + 'px, and inside the panel', async ({ page }) => {
    await boot(page, width);
    const got = await liveReadout(page, { recording: true, compass: true });
    expect(got.lines).toBe(1);
    // ...and not merely one line: the toolbar is a fixed 240px panel with overflow hidden,
    // so a line that is too long is not wrapped, it is CUT, and what it loses is the tail.
    expect(got.cut, 'the line is truncated inside the panel').toBe(false);
    expect(got.fitsPanel, 'the line runs past the edge of the panel').toBe(true);
    // Speed, altitude and heading are the instrument and survive at every width.
    expect(got.text).toMatch(/kt/);
    expect(got.text).toMatch(/ft/);
    expect(got.text).toMatch(/\d{3}°/);
  });
}

test('a narrow panel drops the bookkeeping before the instrument', async ({ page }) => {
  await boot(page, 390);
  const narrow = await liveReadout(page, { recording: true, compass: true });
  await boot(page, 1280);
  const wide = await liveReadout(page, { recording: true, compass: true });
  // With room, everything: point count, elapsed, speed, altitude, subscale, heading.
  expect(wide.text).toMatch(/pts/);
  expect(wide.text).toMatch(/12:34/);
  expect(wide.text).toMatch(/″/);
  // Without room, the fields a pilot can find elsewhere go first -- the subscale setting,
  // then the point count, then the elapsed clock. What is left is what is being flown.
  expect(narrow.text).not.toMatch(/″/);
  expect(narrow.text).not.toMatch(/pts/);
  expect(narrow.text).toMatch(/kt/);
  expect(narrow.text).toMatch(/ft/);
  expect(narrow.text).toMatch(/°/);
});

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
