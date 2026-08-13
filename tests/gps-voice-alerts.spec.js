// @ts-check
// Spoken in-flight alerts (APK only). See
// docs/superpowers/specs/2026-08-13-voice-alerts-design.md
const { test, expect } = require('./_setup');

test.describe('gpsSpokenDigits', () => {
  test('splits a padded heading into spoken digits, in both languages', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsSpokenDigits === 'function');
    const out = await page.evaluate(() => ({
      en004: gpsSpokenDigits('004', 'en'),
      en270: gpsSpokenDigits('270', 'en'),
      he004: gpsSpokenDigits('004', 'he'),
      numeric: gpsSpokenDigits(90, 'en'),
      // A stray degree sign must not become a spoken word.
      symbols: gpsSpokenDigits('090°', 'en'),
      empty: gpsSpokenDigits('', 'en'),
      nullish: gpsSpokenDigits(null, 'en'),
    }));
    expect(out.en004).toBe('zero zero four');
    expect(out.en270).toBe('two seven zero');
    expect(out.he004).toBe('אפס אפס ארבע');
    expect(out.numeric).toBe('nine zero');
    expect(out.symbols).toBe('zero nine zero');
    expect(out.empty).toBe('');
    expect(out.nullish).toBe('');
  });
});
