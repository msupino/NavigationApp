// @ts-check
// Test tintFill hex-to-rgba conversion. The optional second argument is the
// alpha (used by the kite fills so their opacity is independent of the
// waypoint/label yellowAlpha slider); when omitted it defaults to yellowAlpha.
const { test, expect } = require('./_setup');

test.describe('tintFill utility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof tintFill === 'function');
  });

  test('converts hex to rgba using yellowAlpha', async ({ page }) => {
    const rgba = await page.evaluate(() => tintFill('#ffcc33'));
    expect(rgba).toMatch(/^rgba\(255,\s*204,\s*51,\s*[\d.]+\)$/);
  });

  test('the second argument sets the alpha (defaults to yellowAlpha)', async ({ page }) => {
    const result = await page.evaluate(() => ({
      def: tintFill('#ffcc33'),
      explicit: tintFill('#ffcc33', 0.3),
      matchesYellow: tintFill('#ffcc33', window.yellowAlpha),
    }));
    // Explicit alpha is honoured, and matches the "no arg" case when equal to yellowAlpha.
    expect(result.explicit).toBe('rgba(255,204,51,0.3)');
    expect(result.matchesYellow).toBe(result.def);
  });

  test('returns yellowFill for missing or invalid hex', async ({ page }) => {
    const result = await page.evaluate(() => ({
      none: tintFill(null),
      short: tintFill('#fff'),
    }));
    expect(result.none).toMatch(/^rgba\(255,\s*246,\s*170,/);
    expect(result.short).toMatch(/^rgba\(255,\s*246,\s*170,/);
  });
});
