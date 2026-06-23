// @ts-check
// Live wind-field overlay (prototype): a coarse Open-Meteo winds-aloft grid fed
// to the leaflet-velocity animated particle layer. The toggle fetches the grid
// and adds a canvas overlay; unchecking removes it.
const { test, expect } = require('./_setup');

// Anchored to the Open-Meteo API origin so it can't match a look-alike host
// embedded elsewhere in a URL (CodeQL js/regex/missing-anchor).
const OM_RE = /^https:\/\/api\.open-meteo\.com\//;

// 48 hourly samples (forecast_days=2) starting today 00:00Z — uniform 10 m/s
// from 270°, so the time slider has a full 24h-forward range to scrub.
function gridBody() {
  const day0 = new Date().toISOString().slice(0, 10);
  const day1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const time = [];
  for (let h = 0; h < 24; h++) time.push(day0 + 'T' + String(h).padStart(2, '0') + ':00');
  for (let h = 0; h < 24; h++) time.push(day1 + 'T' + String(h).padStart(2, '0') + ':00');
  const n = time.length;
  const loc = { hourly: { time, 'wind_speed_900hPa': new Array(n).fill(10), 'wind_direction_900hPa': new Array(n).fill(270) } };
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

test('time slider scrubs the forecast hour (0..24 forward) and labels it in Zulu', async ({ page }) => {
  await boot(page);
  await page.locator('#windfield-cb').check();
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(1, { timeout: 10000 });
  const slider = page.locator('#windfield-time');
  await expect(slider).toHaveAttribute('max', '24');     // 24h forward
  await expect(slider).toHaveValue('0');                 // starts at "now"
  // Move +6h → label shows a Zulu time with a +6h offset, layer stays.
  await slider.fill('6');
  await slider.dispatchEvent('input');
  await expect(page.locator('#windfield-time-val')).toHaveText(/\d{2}:\d{2}Z \+6h/);
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(1);
});

test('wind-field toggle persists across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#windfield-cb').check();
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(1, { timeout: 10000 });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('windfield-cb'));
  await expect(page.locator('#windfield-cb')).toBeChecked();
});
