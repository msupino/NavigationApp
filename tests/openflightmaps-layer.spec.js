// @ts-check
// open flightmaps: an aeronautical chart for about twenty regions, mostly European, with no
// data over Israel. It is offered in the chart picker everywhere, and dimmed -- with the
// reason -- while the map is over Israel, where its tiles are empty.
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  // No tile traffic to the real service from the suite.
  await page.route(/nwy-tiles-api\.prod\.newaydata\.com/, r => r.fulfill({ status: 204, body: '' }));
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof layers !== 'undefined' && typeof rebuildLayerPicker === 'function');
}
const option = page => page.evaluate(() => {
  const o = document.querySelector('#layer-select option[value="OpenFlightMaps"]');
  return o && { disabled: o.disabled, title: o.title, label: o.textContent };
});
const choose = (page, name) => page.evaluate((n) => {
  const sel = document.getElementById('layer-select');
  sel.value = n; sel.dispatchEvent(new Event('change'));
}, name);
const panTo = (page, lat, lng) => page.evaluate(([a, b]) => new Promise(done => {
  map.once('moveend', () => setTimeout(done, 0));
  map.setView([a, b], 9, { animate: false });
}), [lat, lng]);

test('over Israel it is dimmed with the reason; over Europe it is offered', async ({ page }) => {
  await boot(page);
  await panTo(page, 32.1, 34.9);
  expect(await option(page)).toEqual({ disabled: true, label: 'open flightmaps',
    title: expect.stringContaining('No data over Israel') });
  await panTo(page, 47.3, 11.4);                      // Innsbruck
  expect(await option(page)).toMatchObject({ disabled: false });
  await panTo(page, 32.1, 34.9);
  expect(await option(page)).toMatchObject({ disabled: true });
});

test('choosing it draws the open flightmaps aero tiles, credited', async ({ page }) => {
  await boot(page);
  await panTo(page, 47.3, 11.4);
  await choose(page, 'OpenFlightMaps');
  const r = await page.evaluate(() => ({
    on: map.hasLayer(layers.OpenFlightMaps),
    url: layers.OpenFlightMaps._url,
    native: layers.OpenFlightMaps.options.maxNativeZoom,
    credit: document.querySelector('.leaflet-control-attribution').textContent,
    saved: localStorage.getItem('navaid.layer'),
  }));
  expect(r.on).toBe(true);
  expect(r.url).toContain('path=latest/aero/latest');
  expect(r.native).toBe(12);
  expect(r.credit).toContain('open flightmaps');
  expect(r.saved).toBe('OpenFlightMaps');
});

test('while it is the chart on the map it stays selectable, even over Israel', async ({ page }) => {
  await boot(page);
  await panTo(page, 47.3, 11.4);
  await choose(page, 'OpenFlightMaps');
  await panTo(page, 32.1, 34.9);
  expect(await option(page)).toMatchObject({ disabled: false });
  expect(await page.evaluate(() => document.getElementById('layer-select').value)).toBe('OpenFlightMaps');
});

test('the gist can pull it', async ({ page }) => {
  await boot(page);
  const has = await page.evaluate(() => {
    setTune('layerEnabledOpenFlightMaps', false);
    rebuildLayerPicker();
    return !!document.querySelector('#layer-select option[value="OpenFlightMaps"]');
  });
  expect(has).toBe(false);
});

test('Hebrew explains the dimming in Hebrew', async ({ page }) => {
  await boot(page, 'he');
  await panTo(page, 32.1, 34.9);
  expect((await option(page)).title).toContain('אין נתונים מעל ישראל');
});
