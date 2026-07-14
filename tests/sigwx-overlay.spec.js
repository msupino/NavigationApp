// @ts-check
// SIGWX significant-weather MAP overlay: crops the IMS low-level prog-chart map
// panel and overlays it on the map (georeferenced like PWX), toggle + time +
// opacity. Hidden until the sigwx manifest loads.
const { test, expect } = require('./_setup');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAMgAAACWCAIAAAAUvlBOAAABlklEQVR4nO3UsQ0AIBADsYfJGZ0luALJHiDVKWvOwHP7/SQIi4jHIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISyExT88FglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWGREBYJYZEQFglhkRAWCWExhQve2wGshbOUjwAAAABJRU5ErkJggg==';

async function boot(page, times) {
  await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({ status: 404, body: '' }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: '2026-06-24T04:00:00Z', source: 'x',
      times: times || [{ valid: '12:00', day: '24/06/2026', png: 'ims/sigwx/1200.png' }] }),
  }));
  // Serve the chart PNG with CORS so the client-side crop canvas isn't tainted.
  await page.route(/ims-data\/ims\/sigwx\/.*\.png/, r => r.fulfill({
    status: 200, contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: Buffer.from(PNG, 'base64'),
  }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('sigwx-ov-cb'));
}

test('SIGWX overlay box reveals when the manifest loads', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#sigwx-ov')).toBeVisible();
  await expect(page.locator('#sigwx-ov-controls')).toBeHidden();
  // Time dropdown is populated from the manifest.
  await expect(page.locator('#wx-time option')).toHaveCount(1);
});

test('toggling adds a cropped image overlay; persists across reload', async ({ page }) => {
  await boot(page);
  await page.locator('#sigwx-ov-cb').check();
  await expect(page.locator('#sigwx-ov-controls')).toBeVisible();
  // Three cropped overlays appear (map panel + table + title header), data: URLs.
  const img = page.locator('img.sigwx-ov-layer');
  await expect(img).toHaveCount(3);
  await expect(img.first()).toHaveAttribute('src', /^data:image\/png/);
  // Persisted on; restored after reload.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('sigwx-ov-cb'));
  await expect(page.locator('#sigwx-ov-cb')).toBeChecked();
  await expect(page.locator('img.sigwx-ov-layer')).toHaveCount(3);
});

test('no SIGWX times → overlay box stays hidden', async ({ page }) => {
  await boot(page, []);
  await page.waitForTimeout(400);
  await expect(page.locator('#sigwx-ov')).toBeHidden();
});
