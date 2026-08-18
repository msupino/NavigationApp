// @ts-check
// A paper chart is read north-up; a moving map is easier heading-up, because what is ahead
// on the glass is what is ahead through the windscreen. A button above the follow lock
// switches between the two, and only while a fix is driving the own-ship — with no heading
// there is nothing to hold the map to, and a frozen stale bearing is worse than north-up.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 21; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('orient-toggle') &&
    typeof startLiveLocation === 'function');
}

const fix = (page, hdg) => page.evaluate((h) => {
  window.__geoCb({ coords: { latitude: 32.1, longitude: 34.9, accuracy: 5, speed: 40, altitude: 300, heading: h }, timestamp: Date.now() });
}, hdg);

const state_ = (page) => page.evaluate(() => {
  const b = document.getElementById('orient-toggle');
  return {
    shown: getComputedStyle(b.parentNode).display !== 'none',
    pressed: b.getAttribute('aria-pressed'),
    label: b.getAttribute('aria-label') || '',
    bearing: map.getBearing ? Math.round(map.getBearing()) : null,
  };
});

test('it only appears while a fix is driving the map', async ({ page }) => {
  await boot(page);
  expect((await state_(page)).shown).toBe(false);
  await page.evaluate(() => startLiveLocation());
  expect((await state_(page)).shown).toBe(true);
  await page.evaluate(() => stopLiveLocation());
  expect((await state_(page)).shown).toBe(false);
});

test('north up by default; switching holds the heading up', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await fix(page, 90);
  const before = await state_(page);
  expect(before.pressed).toBe('false');
  expect(before.bearing).toBe(0);                 // north up
  expect(before.label).toMatch(/north up/i);

  await page.click('#orient-toggle');
  const after = await state_(page);
  expect(after.pressed).toBe('true');
  expect(after.label).toMatch(/heading up/i);
  // Holding 090 up means rotating the map by 270.
  expect(after.bearing).toBe(270);
});

test('it follows the aircraft round, and returns to north on the way back', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await fix(page, 90);
  await page.click('#orient-toggle');
  expect((await state_(page)).bearing).toBe(270);
  await fix(page, 180);
  expect((await state_(page)).bearing).toBe(180);
  await fix(page, 0);
  expect((await state_(page)).bearing).toBe(0);
  await page.click('#orient-toggle');             // back to north up
  await fix(page, 200);
  expect((await state_(page)).bearing).toBe(0);   // the map no longer follows the heading
});

test('a degree of scatter does not rotate the chart', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await fix(page, 90);
  await page.click('#orient-toggle');
  const settled = (await state_(page)).bearing;
  await fix(page, 91);                            // inside headingUpMinDeltaDeg
  expect((await state_(page)).bearing).toBe(settled);
  await fix(page, 120);                           // a real turn
  expect((await state_(page)).bearing).not.toBe(settled);
});

test('the choice is remembered on this device', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await page.click('#orient-toggle');
  expect(await page.evaluate(() => localStorage.getItem('navaid.headingUp'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('orient-toggle'));
  expect(await page.evaluate(() => document.getElementById('orient-toggle').getAttribute('aria-pressed'))).toBe('true');
});

test('it sits directly above the follow lock', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  const order = await page.evaluate(() => {
    const corner = document.getElementById('orient-toggle').closest('.leaflet-bottom.leaflet-right');
    const rowOf = (sel) => {
      const el = document.querySelector(sel);
      const row = el && el.closest('.leaflet-control');
      return row ? Array.prototype.indexOf.call(corner.children, row) : -1;
    };
    return { orient: rowOf('#orient-toggle'), follow: rowOf('#follow-lock'), fab: rowOf('.assistant-fab') };
  });
  expect(order.orient).toBe(0);
  expect(order.orient).toBeLessThan(order.follow);
  expect(order.follow).toBeLessThan(order.fab);
});
