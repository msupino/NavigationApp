// @ts-check
// The speed / altitude / heading line is the one thing read at arm's length in a bumpy
// cockpit, in sunlight, on a kneeboard mount — and it shipped at 11 px, the size of footer
// decoration. Bigger by default, tunable from there (gpsReadoutFontPx).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 3; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' && typeof tune === 'function');
}

const readoutPx = (page) => page.evaluate(() =>
  parseFloat(getComputedStyle(document.getElementById('gps-readout')).fontSize));

async function goLive(page) {
  await page.evaluate(() => {
    startLiveLocation();
    window.__geoCb({ coords: { latitude: 32.0, longitude: 34.0, accuracy: 6, speed: 46.3, altitude: 300, heading: 40 }, timestamp: Date.now() });
  });
}

test('the readout is bigger than the footer text it used to match', async ({ page }) => {
  await boot(page);
  await goLive(page);
  const size = await readoutPx(page);
  expect(size).toBe(await page.evaluate(() => tune('gpsReadoutFontPx')));
  expect(size).toBeGreaterThan(11);      // the old footer-decoration size
});

test('the size follows the tunable, on the phone footer too', async ({ page }) => {
  await boot(page);
  await goLive(page);
  await page.evaluate(() => { setTune('gpsReadoutFontPx', 24); applyTuningCssVars(); });
  expect(await readoutPx(page)).toBe(24);
  // The phone lays the readout out in the toolbar footer, a different rule -- same var.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.evaluate(() => applyTuningCssVars());
  expect(await readoutPx(page)).toBe(24);
  await page.evaluate(() => { setTune('gpsReadoutFontPx', 16); applyTuningCssVars(); });
  expect(await readoutPx(page)).toBe(16);
});

// Weight is left to whatever the toolbar sets -- forcing one here made the line LIGHTER
// on desktop, where the footer is already bold.
test('a live line is full contrast, not the muted footer grey', async ({ page }) => {
  await boot(page);
  const idle = await page.evaluate(() => {
    const el = document.getElementById('gps-readout');
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, color: cs.color };
  });
  await goLive(page);
  const live = await page.evaluate(() => {
    const el = document.getElementById('gps-readout');
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, color: cs.color, text: el.textContent };
  });
  expect(live.text).toContain('kt');
  expect(Number(live.opacity)).toBeGreaterThanOrEqual(Number(idle.opacity));
  expect(Number(live.opacity)).toBe(1);
});
