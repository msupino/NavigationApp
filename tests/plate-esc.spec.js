// @ts-check
// A plate viewer opens on top of the Charts modal. Both register a
// window-level Escape handler, so a single Escape used to close BOTH —
// the plate AND the underlying Charts modal. Escape must close only the
// topmost (plate) viewer and leave the Charts modal open.
const { test, expect } = require('./_setup');

test.describe('plate viewer Escape stacking', () => {
  test('Escape closes only the plate viewer, not the Charts modal', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(
      () => typeof showChartsModal === 'function' &&
            typeof showPlateViewer === 'function');

    await page.evaluate(() => showChartsModal());
    // Charts modal present, no plate viewer yet.
    await expect(page.locator('.modal-back')).toHaveCount(1);
    await expect(page.locator('.modal-back.plate-viewer')).toHaveCount(0);

    await page.evaluate(() => showPlateViewer('LLHZ_Ground_Parking D.pdf', 'Parking D'));
    await expect(page.locator('.modal-back.plate-viewer')).toHaveCount(1);
    await expect(page.locator('.modal-back')).toHaveCount(2);

    await page.keyboard.press('Escape');

    // Plate viewer gone; Charts modal still standing.
    await expect(page.locator('.modal-back.plate-viewer')).toHaveCount(0);
    await expect(page.locator('.modal-back')).toHaveCount(1);

    // A second Escape now closes the Charts modal.
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-back')).toHaveCount(0);
  });
});
