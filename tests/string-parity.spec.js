// @ts-check
// Guards EN/HE string parity. English lives in core.js defaults (en/strings.js
// is empty); Hebrew overrides live in docs/i18n/he/strings.js. Every Hebrew key
// MUST correspond to an English key — a he key with no English counterpart is
// a stale entry or a typo that silently never renders.
const { test, expect } = require('./_setup');

async function heKeys(page) {
  return page.evaluate(async () => {
    const txt = await (await fetch('i18n/he/strings.js')).text();
    const sandbox = {};
    // he/strings.js is `window.S = { ... }`; run it against a fake window.
    new Function('window', txt)(sandbox);
    return Object.keys(sandbox.S || {});
  });
}

test.describe('EN/HE string parity', () => {
  test('every Hebrew string key exists in the English defaults', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof window.S === 'object' && window.S);
    const enKeys = await page.evaluate(() => Object.keys(window.S));
    const he = await heKeys(page);
    const orphans = he.filter(k => !enKeys.includes(k));
    expect(orphans).toEqual([]);   // a he key with no English key = stale/typo
  });

  test('newly added strings are present in both EN and HE', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof window.S === 'object' && window.S);
    const enKeys = await page.evaluate(() => Object.keys(window.S));
    const he = await heKeys(page);
    for (const k of ['sliderReset', 'exportShowCumTime',
      'speakAlertLeg', 'speakAlertTop', 'speakAlertAlt',
      'speakAlertDrift', 'speakAlertDriftDirect',
      'tbVoiceAlerts', 'tbVoiceAlertsTitle']) {
      expect(enKeys).toContain(k);
      expect(he).toContain(k);
    }
  });
});
