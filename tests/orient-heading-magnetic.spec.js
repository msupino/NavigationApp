// @ts-check
// The orientation button writes the aircraft's heading under its needle. That number is the
// one a pilot reads back, so it is magnetic like the strip beside it -- it used to be true,
// showing 354 while the strip said 349. The needle is geometry on the chart and stays true.
const { test, expect } = require('./_setup');

test('the heading under the compass needle is magnetic, the needle true', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshOrientControl === 'function' && typeof toMagnetic === 'function');
  const r = await page.evaluate(() => {
    window.gpsLiveOn = true;
    gpsOwn = { lat: 32.4, lng: 34.45, hdg: 354, t: Date.now() };
    refreshOrientControl();
    const btn = document.getElementById('orient-toggle');
    const turn = btn.querySelector('g[transform]').getAttribute('transform');
    return { readout: btn.querySelector('.orient-hdg').textContent, turn, expected: toMagnetic(354) };
  });
  expect(r.expected).toBe(349);                        // Israel: 5°E variation
  expect(r.readout).toBe('349°');
  expect(r.turn).toContain('rotate(354 ');             // north-up: the needle along the true track
});
