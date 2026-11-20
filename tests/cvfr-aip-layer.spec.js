// @ts-check
// The CVFR AIP chart (#2032): our own tiles, cut from the CAA's two CVFR sheets, served from
// NavAid's own tile repository -- never from the third-party mirror, never from flight-maps.
//
// Pinned here: where it draws from, the box its tiles cover (so export and offline packs do
// not chase tiles past the sheet), that it never asks for a zoom the build did not produce
// (z8-13) while the map still zooms in as far as every other chart, and that it is the CVFR
// chart for a route -- moving between the two is free.
const { test, expect } = require('./_setup');

const OWNED = 'https://msupino.github.io/NavigationApp-owned-tiles/CVFR-AIP/';
const boot = async (page, lang = 'en') => {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.tuningDefaults && typeof layers !== 'undefined' && layers['CVFR AIP']);
};
const pick = (page, name) => page.evaluate((name) => {
  const sel = document.getElementById('layer-select');
  sel.value = name;
  sel.onchange && sel.onchange();
}, name);

for (const lang of ['en', 'he']) test(`the layer is offered beside CVFR and labelled (${lang})`, async ({ page }) => {
  await boot(page, lang);
  const info = await page.evaluate(() => {
    const names = Array.from(document.getElementById('layer-select').options).map(o => o.value);
    const opt = Array.from(document.getElementById('layer-select').options).find(o => o.value === 'CVFR AIP');
    return { idx: names.indexOf('CVFR AIP'), cvfr: names.indexOf('CVFR'), label: opt && opt.textContent };
  });
  expect(info.idx).toBe(info.cvfr + 1);
  expect(info.label).toBe('CVFR (AIP)');
});

test('it draws from the owned-tile repository, and exports from it too', async ({ page }) => {
  await boot(page);
  const seen = [];
  page.on('request', (r) => { if (/\/CVFR-AIP\//.test(r.url())) seen.push(r.url()); });
  await pick(page, 'CVFR AIP');
  await page.evaluate(() => map.setView([32.1, 34.9], 10));
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  for (const u of seen) expect(u.startsWith(OWNED)).toBe(true);
  const opts = await page.evaluate(() => ({ url: layers['CVFR AIP']._url, exp: layers['CVFR AIP'].options.exportUrl }));
  expect(opts.url).toBe(OWNED + '{z}/{x}/{y}.png');
  expect(opts.exp).toBe(OWNED + '{z}/{x}/{y}.png');
});

test('every zoom: the map goes as far as other charts, tiles only from z8-13', async ({ page }) => {
  await boot(page);
  const zooms = new Set();
  page.on('request', (r) => { const m = /\/CVFR-AIP\/(\d+)\//.exec(r.url()); if (m) zooms.add(Number(m[1])); });
  await pick(page, 'CVFR AIP');
  const maxZ = await page.evaluate(async () => {
    for (const z of [6, 7, 8, 11, 13, 15, 18]) { map.setView([32.1, 34.9], z, { animate: false }); await new Promise(r => setTimeout(r, 150)); }
    return map.getMaxZoom();
  });
  expect(maxZ).toBe(await page.evaluate(() => layers.CVFR.options.maxZoom));
  expect([...zooms].every(z => z >= 8 && z <= 13)).toBe(true);
  expect(zooms.has(8)).toBe(true);
  expect(zooms.has(13)).toBe(true);
});

test('its frame is the two sheets, and an offline pack asks only for that', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const o = layers['CVFR AIP'].options;
    return { cb: o.chartBounds, n: NavAidOfflineTiles.offlineTileCount(o.chartBounds, 8, 13) };
  });
  expect(r.cb).toEqual({ south: 29.4313, west: 34.1003, north: 33.3635, east: 35.9145 });
  expect(r.n).toBe(6210);            // the box at z8-13; the 3,768 built tiles sit inside it
});

test('moving a route between CVFR and CVFR (AIP) is free; it still belongs to CVFR', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.6, lng: 35.0, name: 'A' }, { lat: 32.9, lng: 35.2, name: 'B' }];
    return { toAip: NavAid.layerSwitchAllowed('CVFR', 'CVFR AIP'), back: NavAid.layerSwitchAllowed('CVFR AIP', 'CVFR'),
      toLsa: NavAid.layerSwitchAllowed('CVFR AIP', 'Low Alt') };
  });
  expect(r.toAip).toBe(true);
  expect(r.back).toBe(true);
  expect(r.toLsa).toBe(false);
});

test('the gist can withdraw it', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => layerOffered('CVFR AIP'))).toBe(true);
  expect(await page.evaluate(() => { setTune('layerEnabledCVFRAIP', false); return layerOffered('CVFR AIP'); })).toBe(false);
});

test('the service worker serves packed owned tiles, and only from that repository', async ({ request }) => {
  const sw = await (await request.get('sw.js')).text();
  expect(sw).toContain("OWNED_TILE_HOST = 'msupino.github.io'");
  expect(sw).toContain("OWNED_TILE_PATH = '/NavigationApp-owned-tiles/'");
});
