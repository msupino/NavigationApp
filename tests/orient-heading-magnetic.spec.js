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
  expect(r.field).toBe('354');                          // planning: the map's true rotation
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

test('while planning the dial\'s number is the map\'s true rotation; in flight the heading, magnetic', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshDial === 'function' && typeof map.setBearing === 'function');
  const r = await page.evaluate(() => {
    const field = () => document.getElementById('rotate-hdg').value;
    map.setView([32.1, 34.9], 9, { animate: false });
    map.setBearing(0); refreshDial();
    const northUp = field();
    map.setBearing(6); refreshDial();
    const turned = field();
    window.gpsLiveOn = true; gpsOwn = { lat: 32.1, lng: 34.9, hdg: 354, t: Date.now() };
    refreshOrientControl();
    const flying = field();
    window.gpsLiveOn = false; refreshOrientControl();
    return { northUp, turned, flying, after: field() };
  });
  expect(r.northUp).toBe('0');                 // planning: north up is 0, not 355
  expect(r.turned).toBe('354');                // planning: the true rotation
  expect(r.flying).toBe('349');                // in flight: magnetic (5E)
  expect(r.after).toBe('354');                 // back to true when the position stops
});

test('a heading typed while planning is true', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshDial === 'function');
  const bearing = await page.evaluate(() => {
    const f = document.getElementById('rotate-hdg');
    f.value = '40'; f.dispatchEvent(new Event('change'));
    return Math.round(map.getBearing());
  });
  expect(bearing).toBe(320);
});
