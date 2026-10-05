// @ts-check
// A phone that will not say what it is connected to (Safari on iOS: no navigator.connection)
// is asked once before the automatic CVFR download, with its size -- otherwise it would run on
// mobile data as readily as on Wi-Fi. Yes is remembered; Later waits for another start.
const { test, expect } = require('./_setup');

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function bootLikeIos(page) {
  await page.addInitScript(() => {
    for (const k of ['connection', 'mozConnection', 'webkitConnection']) {
      try { Object.defineProperty(Navigator.prototype, k, { get: () => undefined, configurable: true }); } catch (e) {}
    }
    try { localStorage.removeItem('navaid.cvfrAutoAsk'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidOfflineTiles && typeof NavAidOfflineTiles.automaticDownloadAgreed === 'function');
}
const ask = (page) => page.locator('.follow-me-ask-modal');
const agreed = (page) => page.evaluate(() => { window.__agreed = NavAidOfflineTiles.automaticDownloadAgreed({ total: 2000, present: 500 }); });

test('asks once with the size; yes is remembered', async ({ page }) => {
  await bootLikeIos(page);
  expect(await page.evaluate(() => NavAidOfflineTiles.connectionUnknownOnPhone())).toBe(true);
  await agreed(page);
  await expect(ask(page)).toContainText('About 59 MB');
  await ask(page).locator('.follow-me-ask-ok').click();
  expect(await page.evaluate(() => window.__agreed)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('navaid.cvfrAutoAsk'))).toBe('yes');
  // Asked once: the next start goes straight on.
  expect(await page.evaluate(() => NavAidOfflineTiles.automaticDownloadAgreed({ total: 2000, present: 500 }))).toBe(true);
  await expect(ask(page)).toHaveCount(0);
});

test('Later waits, and is not asked again in the same session', async ({ page }) => {
  await bootLikeIos(page);
  await agreed(page);
  await ask(page).locator('.follow-me-ask-cancel').click();
  expect(await page.evaluate(() => window.__agreed)).toBe(false);
  expect(await page.evaluate(() => NavAidOfflineTiles.automaticDownloadAgreed({ total: 2000, present: 500 }))).toBe(false);
  await expect(ask(page)).toHaveCount(0);
});

test('a phone that reports its connection is not asked', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidOfflineTiles && typeof NavAidOfflineTiles.connectionUnknownOnPhone === 'function');
  expect(await page.evaluate(() => NavAidOfflineTiles.connectionUnknownOnPhone())).toBe(false);
});
