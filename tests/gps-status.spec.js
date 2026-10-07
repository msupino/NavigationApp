// @ts-check
// The location status line: accuracy, fix rate and -- in the Android app -- satellites, while
// the phone's own position shows; a tap opens the details.
const { test, expect } = require('./_setup');

const fix = (page, acc, lat = 32.1) => page.evaluate(([a, l]) => onLivePosition({ timestamp: Date.now(),
  coords: { latitude: l, longitude: 34.85, accuracy: a, altitudeAccuracy: 9, speed: 50, heading: 90, altitude: 600 } }), [acc, lat]);

async function boot(page, lang = 'en') {
  // A stand-in for the Android plugin: records start/stop and lets the test send "gnss" events.
  await page.addInitScript(() => {
    window.__gnss = { started: 0, stopped: 0, cb: null };
    window.Capacitor = Object.assign(window.Capacitor || {}, {
      isNativePlatform: () => false,
      Plugins: { GnssStatus: {
        addListener: async (n, cb) => { window.__gnss.cb = cb; return { remove() { window.__gnss.cb = null; } }; },
        start: async () => { window.__gnss.started++; }, stop: async () => { window.__gnss.stopped++; },
      } },
    });
  });
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => NavAid.gpsStatus && typeof onLivePosition === 'function');
}
const goLive = (page) => page.evaluate(() => { new Function('gpsLiveOn = true; gpsFollow = false')(); NavAid.gpsStatus.tick(); });

test('searching, then accuracy and rate; coarse fixes show as poor; stops with the position', async ({ page }) => {
  await boot(page);
  const line = page.locator('#gps-status');
  await expect(line).toHaveCount(0);                          // nothing while no position shows
  await goLive(page);
  await expect(line).toHaveText('GPS: searching for satellites…');
  await fix(page, 6);
  await page.waitForTimeout(1050);
  await fix(page, 6, 32.1001);
  await expect(line).toHaveText(/^±6 m · 1 Hz$/);
  await expect(line).toHaveAttribute('data-q', 'good');
  await fix(page, 450);                                       // coarser than the map accepts
  await expect(line).toHaveText(/±450 m/);
  await expect(line).toHaveAttribute('data-q', 'poor');
  await page.evaluate(() => { new Function('gpsLiveOn = false')(); NavAid.gpsStatus.tick(); });
  await expect(line).toBeHidden();
});

test('a browser has no satellites: the line has none and the details say why', async ({ page }) => {
  await boot(page);
  await goLive(page);
  await fix(page, 8);
  expect(await page.evaluate(() => window.__gnss.started)).toBe(0);   // not native: plugin not used
  await page.locator('#gps-status').click();
  await expect(page.locator('.gps-status-modal')).toContainText('±8 m');
  await expect(page.locator('.gps-status-modal')).toContainText('Android app');
});

test('Android: satellites used / in view on the line, per system in the details (Hebrew)', async ({ page }) => {
  await boot(page, 'he');
  await page.evaluate(() => { window.Capacitor.isNativePlatform = () => true; });
  await goLive(page);
  await expect.poll(() => page.evaluate(() => window.__gnss.started)).toBe(1);
  await page.evaluate(() => window.__gnss.cb({ inView: 27, used: 14, cn0: 33,
    systems: { GPS: { inView: 11, used: 7 }, Galileo: { inView: 8, used: 5 }, GLONASS: { inView: 8, used: 2 } } }));
  await fix(page, 5);
  await expect(page.locator('#gps-status')).toHaveText('±5 m · 14/27');
  await page.locator('#gps-status').click();
  const m = page.locator('.gps-status-modal');
  await expect(m).toContainText('Galileo');
  // Related numbers share a row; each is its own part (the dots between them are drawn by CSS).
  const rows = await m.locator('tr').evaluateAll(trs => trs.map(tr => [...tr.querySelectorAll('.gps-status-part')].map(p => p.textContent)));
  expect(rows).toContainEqual(['14 מתוך 27 בשימוש', '33 dB-Hz']);
  expect(rows).toContainEqual(['GPS 7/11', 'Galileo 5/8', 'GLONASS 2/8']);   // the systems on one row
  await page.evaluate(() => { new Function('gpsLiveOn = false')(); NavAid.gpsStatus.tick(); });
  expect(await page.evaluate(() => window.__gnss.stopped)).toBe(1);
  await expect(m).toHaveCount(0);
});

test('the gist can switch it off', async ({ page }) => {
  await page.addInitScript(() => { window.__navaidTune = Object.assign(window.__navaidTune || {}, { featureGpsStatus: false }); });
  await boot(page);
  await goLive(page);
  await fix(page, 6);
  await expect(page.locator('#gps-status')).toHaveCount(0);
});

// Everything at once -- satellites, systems, barometer -- still fits a phone without scrolling.
test('the details fit a phone: related numbers share a row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await boot(page);
  await page.evaluate(() => { window.Capacitor.isNativePlatform = () => true; });
  await goLive(page);
  await expect.poll(() => page.evaluate(() => window.__gnss.started)).toBe(1);
  await page.evaluate(() => {
    window.__gnss.cb({ firstFixMs: 12300 });
    window.__gnss.cb({ inView: 31, used: 18, cn0: 34, systems: { GPS: { inView: 11, used: 7 }, Galileo: { inView: 8, used: 5 },
      GLONASS: { inView: 7, used: 4 }, BeiDou: { inView: 5, used: 2 } } });
    Object.assign(NavAid.device.baro, { hPa: 970, pAltFt: 1240, vsFpm: 600, at: Date.now() });
  });
  await fix(page, 5);
  await page.locator('#gps-status').click();
  const r = await page.evaluate(() => { const m = document.querySelector('.gps-status-modal');
    return { rows: m.querySelectorAll('tr').length, scrolls: m.scrollHeight > m.clientHeight + 1 }; });
  expect(r.rows).toBeLessThanOrEqual(7);
  expect(r.scrolls).toBe(false);
});
