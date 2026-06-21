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
    { level: '50', label: 'FL180', times: [
      { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/50/1200.png' },
      { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/50/1800.png' },
    ] },
    { level: '90', label: 'FL030', times: [
      { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/90/1200.png' },
      { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/90/1800.png' },
    ] },
  ],
};

async function boot(page, { withManifest } = { withManifest: true }) {
  await page.route(PNG_RE, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(MANIFEST_RE, r => withManifest
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANIFEST) })
    : r.fulfill({ status: 404, body: '' }));
  // Keep the "view" toolbar section expanded so the control is interactable.
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
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
  expect(levels).toEqual(['FL030', 'FL180']);   // lowest altitude first (default)
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
  await expect(img).toHaveAttribute('src', /ims\/pwx\/90\/1200\.png/);   // default FL030
  // Toggling off removes it.
  await page.locator('#ims-pwx-cb').uncheck();
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer')).toHaveCount(0);
});

test('changing the level keeps the selected valid time', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  await page.locator('#ims-pwx-time').selectOption('18:00');   // pick a non-default period
  await page.locator('#ims-pwx-level').selectOption('50');      // switch FL (FL180 also has 18:00)
  expect(await page.locator('#ims-pwx-time').inputValue()).toBe('18:00');
  await expect(page.locator('.leaflet-overlay-pane img.leaflet-image-layer'))
    .toHaveAttribute('src', /ims\/pwx\/50\/1800\.png/);
});

test('opacity reset restores the default opacity', async ({ page }) => {
  await boot(page);
  await page.locator('#ims-pwx-cb').check();
  const r = await page.evaluate(() => {
    const s = document.getElementById('ims-pwx-opacity');
    const def = s.value;
    s.value = '0.3'; s.dispatchEvent(new Event('input'));
    const mid = document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer').style.opacity;
    document.getElementById('ims-pwx-opacity-reset').click();
    return { def, after: s.value,
      midOp: parseFloat(mid),
      resetOp: parseFloat(document.querySelector('.leaflet-overlay-pane img.leaflet-image-layer').style.opacity) };
  });
  expect(r.midOp).toBeCloseTo(0.3, 2);        // slider drove the overlay
  expect(r.after).toBe(r.def);                // reset restored the slider
  expect(r.resetOp).toBeCloseTo(parseFloat(r.def), 2);  // and the overlay
});
