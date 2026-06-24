// @ts-check
// IMS wind/temperature (PWX) original-chart viewer in the Charts menu: an image
// modal keyed by flight level + valid time. Hidden until the pwx manifest loads.
const { test, expect } = require('./_setup');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

async function boot(page, levels) {
  await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      generatedAt: '2026-06-24T04:00:00Z', run: '202606240000',
      bounds: { n: 34, s: 29, w: 34, e: 36 },
      levels: levels || [
        { level: '950', label: 'FL020', times: [{ valid: '12:00', day: '24/06/2026', png: 'ims/pwx/950_1200.png' }] },
        { level: '850', label: 'FL050', times: [{ valid: '12:00', day: '24/06/2026', png: 'ims/pwx/850_1200.png' }] },
      ],
    }),
  }));
  await page.route(/ims-data\/ims\/pwx\/.*\.png/, r => r.fulfill({
    status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64'),
  }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.charts', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => document.getElementById('pwx-btn'));
}

test('PWX charts button reveals and opens a level/time chart modal', async ({ page }) => {
  await boot(page);
  const btn = page.locator('#pwx-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  const modal = page.locator('.modal-back .sigwx-modal');
  await expect(modal).toBeVisible();
  // Level + time selects present; two levels offered.
  const selects = modal.locator('select');
  await expect(selects).toHaveCount(2);
  await expect(selects.first().locator('option')).toHaveCount(2);
  // Chart image points at the manifest png.
  await expect(modal.locator('img.sigwx-img')).toHaveAttribute('src', /ims\/pwx\/.*\.png/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-back .sigwx-modal')).toHaveCount(0);
});

test('no PWX levels → button stays hidden', async ({ page }) => {
  await boot(page, []);
  await page.waitForTimeout(400);
  await expect(page.locator('#pwx-btn')).toBeHidden();
});
