// @ts-check
// The live readout inside the desktop menu is what this file measures; on a phone and a
// tablet the deck carries those numbers on its strip instead (see mobile-deck.spec.js).
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
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof gpsUpdateReadout === 'function');
}

for (const width of [1280]) {
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
