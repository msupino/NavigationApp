// @ts-check
// The Charts modal lists every airfield with plates as a collapsible
// section. Sections must be ordered alphabetically by ICAO regardless of
// airfields.json row order, so the list is predictable to scan.
const { test, expect } = require('./_setup');

test.describe('Charts modal — alphabetical airfield order', () => {
  test('airfield sections are sorted alphabetically by ICAO', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof showChartsModal === 'function');
    await page.evaluate(() => showChartsModal());

    const headers = await page.locator('.charts-airport-header').allTextContents();
    expect(headers.length).toBeGreaterThan(1);

    // Header text is "ICAO — English name"; the ICAO is the leading token.
    const icaos = headers.map(h => h.trim().split(/\s|—/)[0]);
    const sorted = [...icaos].sort((a, b) => a.localeCompare(b));
    expect(icaos).toEqual(sorted);
  });
});
