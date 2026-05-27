// @ts-check
// Test tintFill hex-to-rgba conversion and that superfluous arguments are
// ignored (CodeQL alert #34 — the old call passed a second alpha argument
// that was silently dropped).
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

  test('extra arguments are ignored', async ({ page }) => {
    const result = await page.evaluate(() => ({
      one: tintFill('#ffcc33'),
      two: tintFill('#ffcc33', 0.95),
    }));
    expect(result.two).toBe(result.one);
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
