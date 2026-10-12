// @ts-check
// open flightmaps: an aeronautical chart for about twenty regions, mostly European. Elsewhere
// (Israel, Spain, the UK...) its server answers every tile with the same fully transparent
// PNG. It is offered in the chart picker everywhere -- the dimming over Israel was dropped
// ("un-dim it, it's stupid") -- and the map says when the view is empty instead.
const { test, expect } = require('./_setup');

// What the server sends where it has no data (transparent), and where it has (a drawn pixel).
const BLANK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==', 'base64');
const DRAWN = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4wcDwHwAEJAHIBqHEeAAAAABJRU5ErkJggg==', 'base64');

async function boot(page, lang = 'en', tiles = null) {
  // No tile traffic to the real service from the suite.
  await page.route(url => url.hostname === 'nwy-tiles-api.prod.newaydata.com',
    r => tiles ? r.fulfill({ status: 200, contentType: 'image/png', body: tiles(r.request().url()),
      headers: { 'access-control-allow-origin': '*' } }) : r.fulfill({ status: 204, body: '' }));
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

test('it is offered everywhere, over Israel too', async ({ page }) => {
  await boot(page);
  await panTo(page, 32.1, 34.9);
  expect(await option(page)).toMatchObject({ disabled: false, label: 'OpenFlightMaps' });
  await panTo(page, 47.3, 11.4);                      // Innsbruck
  expect(await option(page)).toMatchObject({ disabled: false });
});

const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent));
const loaded = (page) => page.waitForFunction(() => {
  const t = Object.values(layers.OpenFlightMaps._tiles || {});
  return t.length && t.every(x => !x.current || (x.el.complete && x.el.naturalWidth));
});

test('chosen where its tiles are empty, the map says it has no data here -- once', async ({ page }) => {
  await boot(page, 'en', () => BLANK);
  await panTo(page, 40.4, -3.7);                      // Madrid: not covered, not Israel either
  await choose(page, 'OpenFlightMaps');
  await loaded(page);
  await expect.poll(() => toasts(page)).toContainEqual(expect.stringContaining('OpenFlightMaps has no data here'));
  const n = (await toasts(page)).length;
  await panTo(page, 40.6, -3.5);                      // still nothing here: not told again
  await loaded(page);
  await page.waitForTimeout(300);
  expect((await toasts(page)).filter(t => t.includes('no data here')).length).toBeLessThanOrEqual(n);
});

test('where its tiles draw something, nothing is said', async ({ page }) => {
  await boot(page, 'en', () => DRAWN);
  await panTo(page, 47.3, 11.4);
  await choose(page, 'OpenFlightMaps');
  await loaded(page);
  await page.waitForTimeout(300);
  expect((await toasts(page)).some(t => t.includes('OpenFlightMaps has no data here'))).toBe(false);
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

test('Hebrew says it in Hebrew', async ({ page }) => {
  await boot(page, 'he', () => BLANK);
  await panTo(page, 32.1, 34.9);
  await choose(page, 'OpenFlightMaps');
  await loaded(page);
  await expect.poll(() => toasts(page)).toContainEqual(expect.stringContaining('אין נתונים כאן'));
});

// Asked: "why not notify for every layer if no data for this area? CVFR in Europe is missing".
// The Israeli tile charts have no tile at all outside Israel: the mirror answers 404.
const CHART_HOSTS = (url) => /(^|\.)flight-maps\.com$|^navaid-tiles\.supino\.org$|^127\.0\.0\.1$|^localhost$/.test(url.hostname)
  && /\/(tiles\/cvfr|CVFR)\//.test(url.pathname);

test('CVFR over Europe says it has no data there: it covers Israel', async ({ page }) => {
  await boot(page);
  await page.route(CHART_HOSTS, r => r.fulfill({ status: 404, body: '', headers: { 'access-control-allow-origin': '*' } }));
  await panTo(page, 47.3, 11.4);
  await choose(page, 'OpenStreetMap');
  await choose(page, 'CVFR');
  await expect.poll(() => toasts(page)).toContainEqual(expect.stringContaining('CVFR has no data here: it covers Israel'));
});

test('a chart that fails for want of a signal is not said to have no data', async ({ page }) => {
  await boot(page);
  await page.route(CHART_HOSTS, r => r.abort('internetdisconnected'));
  await panTo(page, 32.1, 34.9);
  await choose(page, 'OpenStreetMap');
  await choose(page, 'CVFR');
  await page.waitForTimeout(1500);
  expect((await toasts(page)).some(t => t.includes('no data here'))).toBe(false);
});

test('the ATS sheet says so once the map is off its frame', async ({ page }) => {
  await boot(page);
  await panTo(page, 32.1, 34.9);
  await choose(page, 'ATS');
  await page.waitForTimeout(300);
  expect((await toasts(page)).some(t => t.includes('no data here'))).toBe(false);
  await panTo(page, 47.3, 11.4);
  await expect.poll(() => toasts(page)).toContainEqual(expect.stringContaining('has no data here'));
});
