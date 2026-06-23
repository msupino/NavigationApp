// @ts-check
// Live wind-field overlay (prototype): a coarse Open-Meteo winds-aloft grid fed
// to the leaflet-velocity animated particle layer. The toggle fetches the grid
// and adds a canvas overlay; unchecking removes it.
const { test, expect } = require('./_setup');

const OM_RE = /api\.open-meteo\.com/;

// One hourly sample at the current UTC hour, uniform 10 m/s from 270°.
function gridBody() {
  const now = new Date();
  const t = now.toISOString().slice(0, 13) + ':00';
  const loc = { hourly: { time: [t], 'wind_speed_900hPa': [10], 'wind_direction_900hPa': [270] } };
  return JSON.stringify(new Array(600).fill(loc));   // ≥ grid point count
}

async function boot(page) {
  await page.route(OM_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: gridBody() }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('windfield-cb'));
  // leaflet-velocity loads from CDN — wait for it before toggling.
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
}

test('toggling the wind field adds a velocity canvas; untoggling removes it', async ({ page }) => {
  await boot(page);
  const canvases = () => page.locator('.leaflet-overlay-pane canvas');
  const before = await canvases().count();
  await page.locator('#windfield-cb').check();
  // Velocity layer renders a canvas into the overlay pane once the grid loads.
  await expect(canvases()).toHaveCount(before + 1, { timeout: 10000 });
  await page.locator('#windfield-cb').uncheck();
  await expect(canvases()).toHaveCount(before);
});

test('the grid request covers many points over Israel in m/s', async ({ page }) => {
  let url = '';
  await page.route(OM_RE, r => { url = r.request().url(); return r.fulfill({ status: 200, contentType: 'application/json', body: gridBody() }); });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof L !== 'undefined' && typeof L.velocityLayer === 'function', null, { timeout: 20000 });
  await page.locator('#windfield-cb').check();
  await page.waitForFunction(() => true);
  await expect.poll(() => url).toContain('wind_speed_900hPa');
  const lats = new URLSearchParams(url.split('?')[1]).get('latitude').split(',');
  expect(lats.length).toBeGreaterThan(50);             // a real grid, not a point
  expect(url).toContain('wind_speed_unit=ms');
});

test('opacity slider shows with the field and drives the canvas opacity', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#windfield-controls')).toBeHidden();
  await page.locator('#windfield-cb').check();
  await expect(page.locator('#windfield-controls')).toBeVisible();
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(1, { timeout: 10000 });
  const op = page.locator('#windfield-opacity');
  await op.fill('0.4');
  await op.dispatchEvent('input');
  const canvasOpacity = await page.locator('.leaflet-overlay-pane canvas').evaluate(c => c.style.opacity);
  expect(parseFloat(canvasOpacity)).toBeCloseTo(0.4, 2);
  await expect(page.locator('#windfield-opacity-val')).toHaveText('40%');
});

test('wind-field toggle persists across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#windfield-cb').check();
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(1, { timeout: 10000 });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('windfield-cb'));
  await expect(page.locator('#windfield-cb')).toBeChecked();
});
