// @ts-check
// The installed app on a Mac (a window wider than a phone, with a mouse) gets the desktop menu
// bar, which has no footer -- and hid the App version row with it, so the app could not take an
// update until the window was narrowed (reported). On that layout the row lives at the bottom of
// the Settings menu, and a dot on the menu's title says an update is waiting.
const { test, expect } = require('./_setup');

const MANIFEST = { version: '1.0-abcdef1', url: 'https://navaid.supino.org/ota/navaid-1.0-abcdef1.zip', checksum: 'a'.repeat(64), bytes: 27 * 1048576 };

async function boot(page) {
  await page.addInitScript((m) => {
    window.__navaidEmbedded = true;
    const updater = {
      notifyAppReady: async () => {},
      current: async () => ({ bundle: { id: 'builtin', version: 'builtin' } }),
      getNextBundle: async () => null,
      download: async () => new Promise(() => {}),
      addListener: async () => ({ remove: async () => {} }),
      setMultiDelay: async () => {}, next: async () => {}, cancelDelay: async () => {},
      reload: async () => {}, set: async () => {},
    };
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'ios',
      Plugins: {
        CapacitorUpdater: updater,
        CapacitorHttp: { get: async () => ({ status: 200, data: m }) },
        // Not Wi-Fi: the update waits for the button instead of downloading by itself.
        Network: { getStatus: async () => ({ connected: true, connectionType: 'cellular' }) },
      },
    };
  }, MANIFEST);
  await page.setViewportSize({ width: 1280, height: 800 });     // a Mac window: the menu bar
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.appUpdate && NavAid.ota && NavAid.ota.status);
  await page.evaluate(() => { NavAid.version = '1.0-0000000'; return NavAid.appUpdate.refresh(); });
}

const settings = '#toolbar .tb-section[data-sec="settings"]';

test('on the desktop layout the update row is in the Settings menu, with a dot when one waits', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains('menubar'))).toBe(true);
  await expect(page.locator(settings + ' > .tb-section-body #app-update')).toHaveCount(1);
  await expect(page.locator(settings)).toHaveClass(/has-app-update/);
  await page.locator(settings + ' > .tb-section-head').click();
  const row = page.locator('#app-update');
  await expect(row).toBeVisible();
  await expect(row.locator('.app-update-btn')).toHaveText('Download now');
});

test('narrowed to a phone it goes back to the footer line', async ({ page }) => {
  await boot(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.documentElement.classList.contains('menubar'));
  expect(await page.evaluate(() => {
    const row = document.getElementById('app-update');
    return row.parentNode.id === 'toolbar' && row.nextElementSibling.id === 'footer-links';
  })).toBe(true);
});
