// @ts-check
// A switch on the map, beside the rotation dial: ON keeps the aircraft centred (after the
// pan/zoom grace — see follow-grace.spec.js), OFF leaves the map exactly where the pilot
// put it and never takes it back. It only appears while a real fix is driving the
// own-ship, because with nothing to follow it would be a switch for nothing.
const { test, expect } = require('./_setup');
const { enableAssistant } = require('./_assistant-on');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 8; };
    navigator.geolocation.clearWatch = () => {};
  });  await page.goto('?lang=en&nogist');
  await enableAssistant(page);
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    !!document.getElementById('follow-lock'));
}

const fix = (page, lat, lng) => page.evaluate(([la, ln]) => {
  window.__geoCb({ coords: { latitude: la, longitude: ln, accuracy: 6, speed: 40, altitude: 300, heading: 90 }, timestamp: Date.now() });
}, [lat, lng]);

const centre = (page) => page.evaluate(() => ({ lat: map.getCenter().lat, lng: map.getCenter().lng }));
const shown = (page) => page.evaluate(() =>
  getComputedStyle(document.getElementById('follow-lock').parentNode).display !== 'none');

test('the switch appears only while a fix is driving the map', async ({ page }) => {
  await boot(page);
  expect(await shown(page)).toBe(false);          // nothing to follow yet
  await page.evaluate(() => startLiveLocation());
  expect(await shown(page)).toBe(true);
  await page.evaluate(() => stopLiveLocation());
  expect(await shown(page)).toBe(false);
});

test('on by default, and it says which state it is in', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  const on = await page.evaluate(() => {
    const b = document.getElementById('follow-lock');
    return { follow: gpsFollow, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label') };
  });
  expect(on.follow).toBe(true);
  expect(on.pressed).toBe('true');
  expect(on.label).toMatch(/following/i);
  await page.click('#follow-lock');
  const off = await page.evaluate(() => {
    const b = document.getElementById('follow-lock');
    return { follow: gpsFollow, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label') };
  });
  expect(off.follow).toBe(false);
  expect(off.pressed).toBe('false');
  expect(off.label).toMatch(/stays/i);
});

test('switched off, no fix ever moves the map — not even the first', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { startLiveLocation(); });
  await page.click('#follow-lock');                       // off before any fix arrives
  const before = await centre(page);
  await fix(page, 32.00, 34.00);
  await fix(page, 32.40, 34.40);
  const after = await centre(page);
  expect(after.lat).toBeCloseTo(before.lat, 4);
  expect(after.lng).toBeCloseTo(before.lng, 4);
});

test('switching it back on recentres at once, without waiting out the pan grace', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await fix(page, 32.00, 34.00);
  await page.click('#follow-lock');                       // stop following
  await page.evaluate(() => {
    map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    map.setView([33.00, 35.00], map.getZoom());           // wander off
  });
  await fix(page, 32.20, 34.20);                          // moves the aircraft, not the map
  await page.click('#follow-lock');                       // back on
  const back = await centre(page);
  // Back to where the aircraft IS, not where it was when following stopped -- and without
  // sitting out the grace period the pan just armed, because the tap is the instruction.
  expect(back.lat).toBeCloseTo(32.20, 2);
  expect(back.lng).toBeCloseTo(34.20, 2);
});

test('the choice is remembered on this device', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await page.click('#follow-lock');
  expect(await page.evaluate(() => localStorage.getItem('navaid.gpsFollow'))).toBe('0');
  await page.reload();
  await page.waitForFunction(() => typeof gpsFollow !== 'undefined');
  expect(await page.evaluate(() => gpsFollow)).toBe(false);
});

test('it is the same square as the rotation dial', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  const size = await page.evaluate(() => {
    const b = document.getElementById('follow-lock').getBoundingClientRect();
    const d = document.getElementById('rotate-dial').getBoundingClientRect();
    return { bw: Math.round(b.width), bh: Math.round(b.height), dw: Math.round(d.width), dh: Math.round(d.height) };
  });
  expect(size.bw).toBe(size.dw);
  expect(size.bh).toBe(size.dh);
  expect(size.bw).toBe(size.bh);          // square, like the dial
});

test('it sits at the top of the bottom-right stack, above the assistant launcher', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  const order = await page.evaluate(() => {
    const b = document.getElementById('follow-lock');
    const dial = document.getElementById('rotate-dial');
    const fab = document.querySelector('.assistant-fab');
    const corner = b.closest('.leaflet-bottom.leaflet-right');
    const rowOf = (el) => {
      const row = el && el.closest('.leaflet-control');
      return row ? Array.prototype.indexOf.call(corner.children, row) : -1;
    };
    return {
      sameCorner: !!corner && !!dial.closest('.leaflet-bottom.leaflet-right'),
      follow: rowOf(b),
      fab: rowOf(fab),
      dial: rowOf(dial),
    };
  });
  expect(order.sameCorner).toBe(true);
  expect(order.follow).toBe(0);                       // first child = highest on screen
  expect(order.follow).toBeLessThan(order.fab);       // above the 💬 launcher
  expect(order.fab).toBeLessThan(order.dial);         // which is itself above the dial
});
