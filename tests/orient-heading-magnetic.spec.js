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

test('the bearing dial\'s red needle points at north on the turned chart', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshDial === 'function' && typeof map.setBearing === 'function');
  const r = await page.evaluate(() => {
    // Heading up on a 354 track: the chart turns 6 degrees clockwise, so north is 6 right of up.
    map.setBearing(6);
    refreshDial();
    return { needle: document.getElementById('rotate-needle').style.transform,
      field: document.getElementById('rotate-hdg').value };
  });
  expect(r.needle).toBe('rotate(6deg)');
  expect(r.field).toBe('349');                          // which way is up, magnetic (354 true, 5°E)
});

test('dragging the dial moves the needle with the finger', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshDial === 'function' && typeof map.setBearing === 'function');
  const box = await page.locator('#rotate-dial').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy - 10);
  await page.mouse.down();
  await page.mouse.move(cx + 10, cy, { steps: 4 });     // to the right: east
  await page.mouse.up();
  const bearing = await page.evaluate(() => Math.round(map.getBearing()));
  expect(bearing).toBe(90);
  expect(await page.locator('#rotate-needle').evaluate(el => el.style.transform)).toBe('rotate(90deg)');
});
