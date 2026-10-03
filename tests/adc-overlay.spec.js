// @ts-check
// Aerodrome chart overlay (AIP Annex A, "תרשים שדה"): georeferenced chart images picked from the
// airfield-plate type list in "Extra layers". Images are built by scripts/georef-adc.py.
const { test, expect } = require('./_setup');
const { setAirfieldPlate } = require('./_platePicker');

// Block the SW so page.route() sees the adc-img requests (see commfail-overlay.spec.js).
test.use({ serviceWorkers: 'block' });

const PNG_RE = /adc-img\/.*\.png/;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64'
);

async function boot(page) {
  const urls = [];
  await page.route(PNG_RE, r => { urls.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('adc-cb'));
  return urls;
}

test('aerodrome chart is a plate type and is off by default', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#adc-cb')).not.toBeChecked();
  await expect(page.locator('#plate-type option[value="adc-cb"]')).toHaveText('Aerodrome chart');
});

test('picking aerodrome chart draws the chart images on the map', async ({ page }) => {
  const urls = await boot(page);
  await setAirfieldPlate(page, 'adc-cb');
  await expect(page.locator('.leaflet-overlay-pane .leaflet-image-layer').first()).toBeAttached();
  await expect.poll(() => urls.length).toBeGreaterThanOrEqual(1);
  for (const u of urls) expect(u).toMatch(/\/adc-img\/[A-Z]{4}_adc\.png/);
  expect(await page.evaluate(() => map.hasLayer(window.adcLayerGroup))).toBe(true);
});

test('another plate type replaces the aerodrome chart', async ({ page }) => {
  await boot(page);
  await setAirfieldPlate(page, 'adc-cb');
  await expect.poll(() => page.evaluate(() => !!window.adcLayerGroup && map.hasLayer(window.adcLayerGroup))).toBe(true);
  await setAirfieldPlate(page, 'commfail-cb');
  await expect(page.locator('#adc-cb')).not.toBeChecked();
  expect(await page.evaluate(() => map.hasLayer(window.adcLayerGroup))).toBe(false);
});

test('choice persists across reload', async ({ page }) => {
  await boot(page);
  await setAirfieldPlate(page, 'adc-cb');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('navaid.showAdc'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('adc-cb'));
  await expect(page.locator('#adc-cb')).toBeChecked();
  await expect(page.locator('#plate-type')).toHaveValue('adc-cb');
});
