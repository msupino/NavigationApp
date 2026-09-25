// @ts-check
// The always-offline world map: country outlines and names shipped with the app, drawn under
// every chart, so a map with no tiles (an airliner, anywhere outside a downloaded pack) still
// shows where it is.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const TILE_HOSTS = /(flight-maps\.com|navaid-tiles\.supino\.org|arcgisonline\.com|openstreetmap\.org|newaydata\.com)$/;
async function boot(page, lang = 'en') {
  await page.route(url => TILE_HOSTS.test(url.hostname), r => r.abort());   // no tiles at all
  await page.goto('?lang=' + lang + '&nogist');
  // Hebrew settles with a reload of its own; wait for the page that stays.
  await page.waitForFunction((l) => document.documentElement.lang === l && window.NavAid && NavAid.worldOffline
    && typeof layers !== 'undefined', lang);
  await page.waitForLoadState('load');
  await page.evaluate(() => NavAid.worldOffline.load());
}

test('the shipped data is small, and names every country in English and Hebrew', () => {
  const file = path.join(__dirname, '../docs/data/world-countries.json');
  const raw = fs.readFileSync(file);                  // read once: size and content are the same bytes
  expect(raw.length).toBeLessThan(1024 * 1024);
  const d = JSON.parse(raw.toString('utf8'));
  expect(d.countries.length).toBeGreaterThan(200);
  const il = d.countries.find(c => c.en === 'Israel');
  expect(il.he).toBe('ישראל');
  for (const c of d.countries) {
    expect(typeof c.en).toBe('string');
    expect(Array.isArray(c.p) && c.p.length).toBeTruthy();
  }
});

test('with no tiles at all, the map still shows land, sea and country names', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    map.setView([38, 22], 8, { animate: false });
    const pane = map.getPane('worldBase');
    return { canvas: !!pane.querySelector('canvas'), below: Number(pane.style.zIndex) < Number(map.getPane('tilePane').style.zIndex || 200) };
  });
  expect(r.canvas).toBe(true);
  expect(r.below).toBe(true);
  await expect(page.locator('.world-label', { hasText: 'Greece' })).toHaveCount(1);
});

test('names are in the page language', async ({ page }) => {
  await boot(page, 'he');
  await page.evaluate(() => { map.setView([38, 22], 8, { animate: false }); });
  await expect(page.locator('.world-label', { hasText: 'יוון' })).toHaveCount(1);
});

test('zoomed out, only the major names stay', async ({ page }) => {
  await boot(page);
  const counts = await page.evaluate(() => {
    const sel = document.getElementById('layer-select');
    sel.value = 'World'; sel.dispatchEvent(new Event('change'));
    map.setView([40, 20], 3, { animate: false });
    const far = document.querySelectorAll('.world-label').length;
    map.setView([40, 20], 8, { animate: false });
    return { far, near: document.querySelectorAll('.world-label').length };
  });
  expect(counts.far).toBeGreaterThan(5);
  expect(counts.near).toBeGreaterThan(counts.far);
});

test('World (offline) is a chart of its own that zooms out to a continent', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const sel = document.getElementById('layer-select');
    const label = sel.querySelector('option[value="World"]').textContent;
    sel.value = 'World'; sel.dispatchEvent(new Event('change'));
    const min = map.getMinZoom();
    sel.value = 'CVFR'; sel.dispatchEvent(new Event('change'));
    return { label, min, back: map.getMinZoom() };
  });
  expect(r.label).toBe('World (offline)');
  expect(r.min).toBe(2);
  expect(r.back).toBe(8);
});

test('a chart tile that fails is transparent, not white over the world map', async ({ page }) => {
  await boot(page);
  const alpha = await page.evaluate(() => new Promise(done => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      done(g.getImageData(0, 0, 1, 1).data[3]);
    };
    img.src = layers.CVFR.options.errorTileUrl;
  }));
  expect(alpha).toBe(0);
});
