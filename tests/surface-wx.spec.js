// @ts-check
// Asked: "a dew point layer, and weather at MSL ... now and forecast". Extra layers → Surface
// weather: one switch, five fields, a grid over the chart, scrubbed by the look-ahead slider.
const { test, expect } = require('./_setup');

// A model answer for every grid point: 20 °C, a moist patch near Herzliya (spread 1 °C), a low
// centre over the sea west of Haifa, and the next hour 2 °C warmer everywhere.
async function stubGrid(page) {
  const calls = { n: 0 };
  await page.route('https://api.open-meteo.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (!/dew_point_2m/.test(u.search)) return route.fallback();
    calls.n++;
    const lats = u.searchParams.get('latitude').split(',').map(Number);
    const lngs = u.searchParams.get('longitude').split(',').map(Number);
    // The hour nearest now first, as the model answers: it is what "now" samples.
    const now = new Date(Math.round(Date.now() / 3600e3) * 3600e3);
    const time = [0, 1, 2, 3].map(h => new Date(now.getTime() + h * 3600e3).toISOString().slice(0, 16));
    const body = lats.map((la, k) => {
      const lo = lngs[k];
      const moist = Math.hypot(la - 32.18, lo - 34.83) < 0.2;
      const p = 1004 + 2.2 * Math.hypot(la - 32.9, lo - 34.5) * 4;
      return { latitude: la, longitude: lo, hourly: { time,
        temperature_2m: time.map((_, h) => 20 + 2 * h),
        dew_point_2m: time.map((_, h) => (moist ? 19 : 10) + 2 * h),
        pressure_msl: time.map(() => +p.toFixed(1)) } };
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}
async function boot(page, lang = 'en', size = { width: 1300, height: 850 }) {
  await page.setViewportSize(size);
  const calls = await stubGrid(page);
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.surfaceWx && document.getElementById('surface-wx-cb'));
  return calls;
}
const switchOn = (page) => page.evaluate(() => { const c = document.getElementById('surface-wx-cb'); c.checked = true; c.dispatchEvent(new Event('change')); });

test('one request on switch-on; the moist patch reads as a low spread, in red, with its number', async ({ page }) => {
  const calls = await boot(page);
  await switchOn(page);
  await page.waitForFunction(() => !!NavAid.surfaceWx._store());
  expect(calls.n).toBe(1);
  const r = await page.evaluate(() => {
    const sw = NavAid.surfaceWx;
    const herz = sw.sampleNear(32.18, 34.83, 0), south = sw.sampleNear(31.0, 34.8, 0);
    return { herz, south, red: sw.colorFor('spread', herz.spread), quiet: sw.colorFor('spread', south.spread),
      label: sw.label('spread', herz.spread), base: sw.label('base', herz.base) };
  });
  expect(r.herz.spread).toBe(1);
  expect(r.south.spread).toBe(10);
  expect(r.red).toBe('#c62828');
  expect(r.quiet).not.toBe(r.red);
  expect(r.label).toBe('1°');
  expect(r.base).toBe('400');                                  // (20 − 19) × 400 ft
  // The field picker is there, spread chosen; the chip on the map says what and when.
  await expect(page.locator('#surface-wx-controls input[value="spread"]')).toBeChecked();
  await expect(page.locator('#surface-wx-chip')).toContainText('Dew point spread');
  await expect(page.locator('#surface-wx-chip')).toContainText('now');
});

test('the look-ahead slider moves it to the forecast hour, with no new request', async ({ page }) => {
  const calls = await boot(page);
  await switchOn(page);
  await page.waitForFunction(() => !!NavAid.surfaceWx._store());
  await page.evaluate(() => { const m = document.getElementById('lookahead-time'); m.value = '2'; m.dispatchEvent(new Event('input')); });
  await expect(page.locator('#surface-wx-chip')).toContainText('+2 h');
  const t = await page.evaluate(() => NavAid.surfaceWx.sampleNear(31.0, 34.8, NavAid.surfaceWx.lookaheadHours()).t);
  expect(t).toBe(24);
  expect(calls.n).toBe(1);
});

test('fields: sea-level pressure draws isobars and a low; the choice is remembered', async ({ page }) => {
  await boot(page);
  await switchOn(page);
  await page.waitForFunction(() => !!NavAid.surfaceWx._store());
  // The radio lives in the menu's Extra layers section, closed here: chosen as the pilot would.
  await page.evaluate(() => { const r = document.querySelector('#surface-wx-controls input[value="msl"]'); r.checked = true; r.dispatchEvent(new Event('change')); });
  await expect(page.locator('#surface-wx-chip')).toContainText('Sea-level pressure');
  await expect(page.locator('#surface-wx-legend')).toContainText('Isobars every 2 hPa');
  expect(await page.evaluate(() => localStorage.getItem('navaid.surfaceWxField'))).toBe('msl');
  await page.reload();
  await page.waitForFunction(() => window.NavAid && NavAid.surfaceWx);
  expect(await page.evaluate(() => NavAid.surfaceWx.field())).toBe('msl');
});

test('a waypoint inspector shows the surface there while the layer is on', async ({ page }) => {
  await boot(page);
  await switchOn(page);
  await page.waitForFunction(() => !!NavAid.surfaceWx._store());
  await page.evaluate(() => { state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'HERZ' }, { lat: 32.4, lng: 34.95, name: 'B' }];
    syncLegs(); draw(); state.selected = { type: 'wp', index: 0 }; showInspector(); });
  await expect(page.locator('#inspector .swx-row .val')).toHaveText('20°/19° · Δ1° · Q' + await page.evaluate(() => Math.round(NavAid.surfaceWx.sampleNear(32.18, 34.83, 0).p)));
});

test('no data: the switch goes back off and says why; it is in the quick layers list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://api.open-meteo.com/**', (route) => /dew_point_2m/.test(route.request().url())
    ? route.fulfill({ status: 503, body: '' }) : route.fallback());
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.surfaceWx);
  await switchOn(page);
  await expect(page.locator('#surface-wx-status')).toHaveText('Surface weather unavailable');
  expect(await page.evaluate(() => document.getElementById('surface-wx-cb').checked)).toBe(false);
  await page.locator('#edit-col-layers').click();
  await expect(page.locator('#quick-layers .ql-switch[data-for="surface-wx-cb"]')).toHaveText(/Surface weather/);
});

test('Hebrew: its names, and the chip isolates them from the times', async ({ page }) => {
  await boot(page, 'he', { width: 390, height: 844 });
  await switchOn(page);
  await page.waitForFunction(() => !!NavAid.surfaceWx._store());
  await expect(page.locator('#surface-wx-chip')).toContainText('פער נקודת טל');
  await expect(page.locator('#surface-wx-chip')).toContainText('עכשיו');
});
