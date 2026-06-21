// @ts-check
// IMS PWX wind/temperature chart overlay. The control is hidden until the
// ims-data manifest loads; once it does, toggling it on adds a georeferenced
// image overlay to the map at the manifest's bounds.
const { test, expect } = require('./_setup');

const MANIFEST_RE = /ims-data\/ims\/pwx\.json/;
const PNG_RE = /ims-data\/ims\/pwx\/.*\.png/;

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

const MANIFEST = {
  generatedAt: '2026-06-21T09:00:00Z',
  bounds: { s: 29.88, n: 33.82, w: 33.31, e: 36.69 },
  levels: [
    { level: '50', label: '500 hPa · FL180', times: [
      { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/50/1200.png' },
      { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/50/1800.png' },
    ] },
    { level: '90', label: '900 hPa · FL030', times: [
      { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/90/1200.png' },
    ] },
  ],
};

async function boot(page, { withManifest } = { withManifest: true }) {
  await page.route(PNG_RE, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(MANIFEST_RE, r => withManifest
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANIFEST) })
    : r.fulfill({ status: 404, body: '' }));
  // Keep the "view" toolbar section expanded so the control is interactable.
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.view', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && document.getElementById('ims-pwx'));
}

test('control stays hidden when no ims-data manifest exists', async ({ page }) => {
  await boot(page, { withManifest: false });
  await page.waitForTimeout(400);
  await expect(page.locator('#ims-pwx')).toBeHidden();
});

test('manifest reveals the control and populates levels', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#ims-pwx')).toBeVisible();
  const levels = await page.locator('#ims-pwx-level option').allTextContents();
  expect(levels).toEqual(['500 hPa · FL180', '900 hPa · FL030']);
  // Times follow the selected level.
  const times = await page.locator('#ims-pwx-time option').allTextContents();
  expect(times.length).toBe(2);
  expect(times[0]).toContain('12:00');
});

test('toggling on adds a georeferenced image overlay at the manifest bounds', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#ims-pwx-controls')).toBeHidden();
  await page.locator('#ims-pwx-cb').check();
  await expect(page.locator('#ims-pwx-controls')).toBeVisible();
  // Leaflet renders an <img class="leaflet-image-layer"> in the overlay pane.
  const img = page.locator('.leaflet-overlay-pane img.leaflet-image-layer');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('src', /ims\/pwx\/50\/1200\.png/);
  // Toggling off removes it.
  await page.locator('#ims-pwx-cb').uncheck();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer')).toHaveCount(0);
});
