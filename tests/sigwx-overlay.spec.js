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
  // Only the geographic crop is a map overlay; the text stays in screen space.
  const img = page.locator('img.sigwx-ov-layer');
  await expect(img).toHaveCount(1);
  await expect(page.locator('.sigwx-side img[src^="data:image/png"]')).toHaveCount(2);
  await expect(img.first()).toHaveAttribute('src', /^data:image\/png/);
  // Persisted on; restored after reload.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('sigwx-ov-cb'));
  await expect(page.locator('#sigwx-ov-cb')).toBeChecked();
  await expect(page.locator('img.sigwx-ov-layer')).toHaveCount(1);
  await expect(page.locator('.sigwx-side img[src^="data:image/png"]')).toHaveCount(2);
  await page.locator('#sigwx-ov-cb').uncheck();
  await expect(page.locator('img.sigwx-ov-layer, .sigwx-side')).toHaveCount(0);
});

test('the panel fits real landscape chart crops including its header', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await boot(page);
  await page.locator('#sigwx-ov-cb').check();
  await expect(page.locator('.sigwx-side img[src^="data:image/png"]')).toHaveCount(2);
  await page.evaluate(async () => {
    const sizes = [[1741, 102], [1057, 1008]];
    await Promise.all(Array.from(document.querySelectorAll('.sigwx-side img')).map((img, i) => {
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = sizes[i];
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.src = canvas.toDataURL();
      });
    }));
  });
  const geometry = await page.evaluate(() => ({
    width: document.querySelector('.sigwx-side').getBoundingClientRect().width,
    bottom: document.querySelector('.sigwx-side').getBoundingClientRect().bottom,
    mapBottom: map.getContainer().getBoundingClientRect().bottom,
  }));
  expect(geometry.width).toBeGreaterThan(500);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.mapBottom - 15);
});

for (const mode of ['add', 'note']) {
  test(`opening the SIGWX table does not edit the map in ${mode} mode`, async ({ page }) => {
    await boot(page);
    await page.locator('#sigwx-ov-cb').check();
    await expect(page.locator('.sigwx-side img[src^="data:image/png"]')).toHaveCount(2);
    await page.evaluate(mode => { state.mode = mode; }, mode);
    const before = await page.evaluate(() => JSON.stringify([state.waypoints, state.notes]));
    await page.locator('.sigwx-side').click();
    await expect(page.locator('.sigwx-table-modal')).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify([state.waypoints, state.notes]))).toBe(before);
  });
}

test('no SIGWX times → overlay box stays hidden', async ({ page }) => {
  await boot(page, []);
  await page.waitForTimeout(400);
  await expect(page.locator('#sigwx-ov')).toBeHidden();
});
