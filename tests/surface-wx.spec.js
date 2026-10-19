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
      return { latitude: la, longitude: lo, elevation: moist ? 800 : 10, hourly: { time,
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
  // The estimated cloud base: 400 ft above the ground there, plus the model's 800 m (2,625 ft)
  // of ground = 3,000 ft above sea level.
  await expect(page.locator('#inspector .swx-base-row .val')).toHaveText('400 ft AGL · 3,000 ft AMSL');
  await expect(page.locator('#inspector .swx-row:not(.swx-base-row) .val')).toHaveText('20°/19° · Δ1° · Q' + await page.evaluate(() => Math.round(NavAid.surfaceWx.sampleNear(32.18, 34.83, 0).p)));
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

test('H / L only at real centres: a deep low is marked, small bumps on a flat day are not', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 850 });
  await page.route('https://api.open-meteo.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (!/dew_point_2m/.test(u.search)) return route.fallback();
    const lats = u.searchParams.get('latitude').split(',').map(Number), lngs = u.searchParams.get('longitude').split(',').map(Number);
    const now = new Date(Math.round(Date.now() / 3600e3) * 3600e3);
    const time = [0, 1].map(h => new Date(now.getTime() + h * 3600e3).toISOString().slice(0, 16));
    // Hour 0: a deep low near Haifa. Hour 1: 1015 with ±0.3 hPa ripples everywhere.
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lats.map((la, k) => ({ hourly: { time,
      temperature_2m: [20, 20], dew_point_2m: [10, 10],
      pressure_msl: [+(1000 + Math.hypot(la - 32.9, lngs[k] - 35.0) * 6).toFixed(2), +(1015 + 0.3 * Math.sin(la * 40) * Math.cos(lngs[k] * 40)).toFixed(2)] } }))) });
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.surfaceWx);
  await page.evaluate(() => NavAid.surfaceWx.fetchGrid());
  const r = await page.evaluate(() => {
    const sw = NavAid.surfaceWx, g = sw._store().grid;
    const at = (c) => ({ high: c.high, lat: g.lats[c.i], lng: g.lngs[c.j] });
    return { deep: sw.pressureCentres(0).map(at), flat: sw.pressureCentres(1).map(at) };
  });
  expect(r.deep).toHaveLength(1);
  expect(r.deep[0].high).toBe(false);
  expect(Math.abs(r.deep[0].lat - 32.9)).toBeLessThan(0.3);
  expect(r.flat).toEqual([]);
});

test('left on, it comes back on after a reload: switch, map and data together', async ({ page }) => {
  await boot(page);
  await switchOn(page);
  await page.waitForFunction(() => !!NavAid.surfaceWx._store());
  await page.reload();
  await page.waitForFunction(() => window.NavAid && NavAid.surfaceWx && NavAid.surfaceWx._store(), null, { timeout: 15000 });
  expect(await page.evaluate(() => [document.getElementById('surface-wx-cb').checked, window.showSurfaceWx])).toEqual([true, true]);
  await expect(page.locator('#surface-wx-chip')).toContainText('Dew point spread');
});

test('the inspector\'s rows follow the slider; a stale forecast is fetched again', async ({ page }) => {
  const calls = await boot(page);
  await switchOn(page);
  await page.waitForFunction(() => !!NavAid.surfaceWx._store());
  await page.evaluate(() => { state.waypoints = [{ lat: 31.0, lng: 34.8, name: 'S' }, { lat: 31.2, lng: 34.9, name: 'B' }];
    syncLegs(); draw(); state.selected = { type: 'wp', index: 0 }; showInspector(); });
  const surface = page.locator('#inspector .swx-row:not(.swx-base-row) .val');
  await expect(surface).toContainText('20°/10°');
  await page.evaluate(() => { const m = document.getElementById('lookahead-time'); m.value = '2'; m.dispatchEvent(new Event('input')); });
  await expect(surface).toContainText('24°/14°');                     // the +2 h hour, as on the map
  // An hour past its cache life: the next draw asks again.
  await page.evaluate(() => { NavAid.surfaceWx._store().at -= 2 * 3600e3; draw(); });
  await expect.poll(() => calls.n).toBe(2);
});

test('offline, a stale forecast is retried once per few minutes, not on every redraw', async ({ page }) => {
  const calls = await boot(page);
  await switchOn(page);
  await page.waitForFunction(() => !!NavAid.surfaceWx._store());
  await page.unroute('https://api.open-meteo.com/**');
  let failed = 0;
  await page.route('https://api.open-meteo.com/**', (route) => { failed++; return route.fulfill({ status: 503, body: '' }); });
  await page.evaluate(async () => {
    NavAid.surfaceWx._store().at -= 2 * 3600e3;
    for (let i = 0; i < 10; i++) { draw(); await new Promise(r => setTimeout(r, 50)); }
  });
  await page.waitForTimeout(500);
  expect(failed).toBe(1);
  expect(await page.evaluate(() => !!NavAid.surfaceWx._store())).toBe(true);   // the old one stays
  expect(calls.n).toBe(1);
});

test('readable: warning colours hold 4.5:1 on their white halo; field rows are finger-sized on a phone', async ({ page }) => {
  await boot(page, 'en', { width: 390, height: 844 });
  const ratios = await page.evaluate(() => {
    const L = (h) => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const sw = NavAid.surfaceWx;
    return [sw.colorFor('spread', 1), sw.colorFor('spread', 3), sw.colorFor('spread', 9)].map(c => 1.05 / (L(c) + 0.05));
  });
  for (const r of ratios) expect(r).toBeGreaterThanOrEqual(4.5);
  await switchOn(page);
  // The row sits in a menu section closed here: its rule, as the phone applies it.
  const h = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#surface-wx-controls .swx-field')).minHeight));
  expect(h).toBeGreaterThanOrEqual(44);
});
