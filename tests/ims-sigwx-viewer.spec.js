// @ts-check
// IMS SIGWX significant-weather charts: in-app image viewer (no map overlay).
// The button is hidden until the ims-data sigwx manifest loads; clicking it
// opens a modal with a valid-time dropdown and the chart image.
const { test, expect } = require('./_setup');

const MANIFEST_RE = /ims-data\/ims\/sigwx\.json/;
const PNG_RE = /ims-data\/ims\/sigwx\/.*\.png/;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

const MANIFEST = {
  generatedAt: '2026-06-21T09:00:00Z',
  times: [
    { valid: '06:00', day: '21/06/2026', png: 'ims/sigwx/0600.png' },
    { valid: '12:00', day: '21/06/2026', png: 'ims/sigwx/1200.png' },
    { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/0000.png' },
  ],
};

// Freeze at 12:00Z on 21/06/2026 so "the chart that is valid now" is unambiguous: the
// viewer opens on the nearest valid time, not on whichever the manifest happens to list first.
async function freezeNoon(page) {
  await page.addInitScript(() => {
    const fixed = Date.UTC(2026, 5, 21, 12, 0);
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
  });
}

async function boot(page, { withManifest } = { withManifest: true }) {
  await freezeNoon(page);
  await page.route(PNG_RE, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(MANIFEST_RE, r => withManifest
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANIFEST) })
    : r.fulfill({ status: 404, body: '' }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.charts', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => document.getElementById('sigwx-btn'));
}

test('SIGWX button stays hidden when no manifest exists', async ({ page }) => {
  await boot(page, { withManifest: false });
  await page.waitForTimeout(400);
  await expect(page.locator('#sigwx-btn')).toBeHidden();
});

test('SIGWX button shows (and reports unavailable) when manifest has no charts', async ({ page }) => {
  await page.route(PNG_RE, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(MANIFEST_RE, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: 'x', times: [] }),
  }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.charts', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => document.getElementById('sigwx-btn'));
  await expect(page.locator('#sigwx-btn')).toBeVisible();   // exists, not hidden
  await page.locator('#sigwx-btn').click();
  await expect(page.locator('.sigwx-modal .sigwx-missing')).toContainText('unavailable');
  await expect(page.locator('.sigwx-modal select.sigwx-time')).toBeHidden();
});

test('SIGWX button opens a viewer with valid-time options and the chart image', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#sigwx-btn')).toBeVisible();
  await page.locator('#sigwx-btn').click();

  const modal = page.locator('.modal-back .sigwx-modal');
  await expect(modal).toBeVisible();
  const opts = await modal.locator('select.sigwx-time option').allTextContents();
  expect(opts.length).toBe(3);
  expect(opts[0]).toContain('06:00');
  // The chart valid NOW is shown, not the manifest's first entry.
  await expect(modal.locator('img.sigwx-img')).toHaveAttribute('src', /ims\/sigwx\/1200\.png/);
  // Switching the time swaps the image.
  await modal.locator('select.sigwx-time').selectOption({ label: '21/06/2026 06:00Z' });
  await expect(modal.locator('img.sigwx-img')).toHaveAttribute('src', /ims\/sigwx\/0600\.png/);
  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-back .sigwx-modal')).toHaveCount(0);
});
