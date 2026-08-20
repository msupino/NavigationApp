// @ts-check
// The Charts modal lists every airfield with plates as a collapsible
// section. Sections must be ordered alphabetically by ICAO regardless of
// airfields.json row order, so the list is predictable to scan.
const { test, expect } = require('./_setup');

test.describe('Charts modal — airfield order', () => {
  // Sorted by the name the pilot reads, not by ICAO: the tiles lead with the name, and a list
  // ordered by a code the eye is not scanning is not ordered at all.
  test('airfield tiles are sorted by the name shown on them', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof showChartsModal === 'function');
    await page.evaluate(() => showChartsModal());
    await page.waitForSelector('.charts-fields-grid .charts-field');

    const names = await page.locator('.charts-field .charts-field-name').allTextContents();
    expect(names.length).toBeGreaterThan(1);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    expect(names).toEqual(sorted);
  });
});
