// @ts-check
// Settings: the pressure unit (inHg or hPa) and where the altitude comes from (GPS, or the
// phone's barometer with the QNH).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof fmtPressure === 'function' && typeof gpsAltitudeForCompare === 'function' && NavAid.device);
}
const openSettings = async (page) => {
  await page.evaluate(() => { const s = document.querySelector('.tb-section[data-sec="settings"]'); if (s && !s.classList.contains('open')) s.querySelector('.tb-section-head').click(); });
};

test('pressure unit: inches by default, hectopascals when chosen, both scales with the chosen first; kept', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => [fmtPressure(1012.9), fmtQnhBoth(1012.9), fmtPressure(1012.94, true)]))
    .toEqual(['29.91″', '29.91″ · 1013 hPa', '29.91″']);
  await openSettings(page);
  await page.locator('#pressure-unit').selectOption('hPa');
  expect(await page.evaluate(() => [fmtPressure(1012.9), fmtQnhBoth(1012.9), fmtPressure(1012.94, true), fmtPressure(29.91)]))
    .toEqual(['1013 hPa', '1013 hPa · 29.91″', '1012.9 hPa', '1013 hPa']);
  // The in-flight strip uses it.
  const strip = await page.evaluate(() => { gpsQnh = { hPa: 1012.9, inHg: 1012.9 / 33.8639, at: Date.now(), lat: 32, lng: 34.9 }; const p = []; gpsPushAltitudeParts(p); return p[1]; });
  expect(strip).toBe('1013 hPa');
  await page.reload();
  await page.waitForFunction(() => typeof pressureUnit === 'function');
  expect(await page.evaluate(() => [pressureUnit(), document.getElementById('pressure-unit').value])).toEqual(['hPa', 'hPa']);
});

test('altitude from the barometer: the altimeter sum with the QNH; GPS without a reading or QNH', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    gpsLastAlt = 600; gpsAltIsGeometric = false;           // what the GPS says
    gpsQnh = { hPa: 1020, inHg: 1020 / 33.8639, at: Date.now(), lat: 32, lng: 34.9 };
    // 2000 ft above the 1020 hPa level.
    const hPa = 1020 * Math.pow(1 - 2000 / 145366.45, 1 / 0.190284);
    Object.assign(NavAid.device.baro, { hPa, at: Date.now() });
    const out = { gps: Math.round(gpsAltitudeForCompare()) };
    localStorage.setItem('navaid.altSource', 'baro');
    out.baro = Math.round(gpsAltitudeForCompare()); out.from = gpsAltFrom;
    NavAid.device.baro.at = Date.now() - 10000;            // the sensor went quiet
    out.stale = Math.round(gpsAltitudeForCompare()); out.staleFrom = gpsAltFrom;
    NavAid.device.baro.at = Date.now(); gpsQnh = null;      // no QNH
    out.noQnh = Math.round(gpsAltitudeForCompare());
    return out;
  });
  expect(r).toEqual({ gps: 600, baro: 2000, from: 'baro', stale: 600, staleFrom: 'gps', noQnh: 600 });
});

test('the GPS details say where the altitude comes from (Hebrew)', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => NavAid.gpsStatus && NavAid.device);
  await page.evaluate(() => {
    localStorage.setItem('navaid.altSource', 'baro');
    new Function('gpsLiveOn = true; gpsFollow = false')();
    gpsQnh = { hPa: 1013, inHg: 1013 / 33.8639, at: Date.now(), lat: 32, lng: 34.9 };
    Object.assign(NavAid.device.baro, { hPa: 950, at: Date.now() });
    gpsAltitudeForCompare();
    NavAid.gpsStatus.tick();
  });
  await page.locator('#gps-status').click();
  await expect(page.locator('.gps-status-modal')).toContainText('ברומטר + QNH');
});
