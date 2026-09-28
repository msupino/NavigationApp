// @ts-check
// The installed app's App version row (ui.js appUpdate, ota.js status/downloadNow). Automatic
// updates are Wi-Fi only, so a phone that is never on Wi-Fi never updated; this row takes one
// now, on mobile data too, after asking -- and says "Up to date" when there is nothing to take.
const { test, expect } = require('./_setup');

const MANIFEST = { version: '1.0-abcdef1', url: 'https://navaid.supino.org/ota/navaid-1.0-abcdef1.zip', checksum: 'a'.repeat(64), bytes: 27 * 1048576 };

async function boot(page, o) {
  await page.addInitScript((o) => {
    window.__navaidEmbedded = true;
    window.__ota = { downloads: 0, next: null, asked: 0, listeners: {} };
    const updater = {
      notifyAppReady: async () => {},
      current: async () => ({ bundle: { id: 'builtin', version: 'builtin' } }),
      getNextBundle: async () => window.__ota.next,
      download: async (a) => {
        window.__ota.downloads++;
        // Report progress the way the plugin does, then finish when the test says so.
        for (const p of [10, 45]) (window.__ota.listeners.download || []).forEach(fn => fn({ percent: p }));
        await new Promise(r => { window.__ota.finish = r; });
        return { id: 'dl', version: a.version };
      },
      addListener: async (name, fn) => {
        (window.__ota.listeners[name] = window.__ota.listeners[name] || []).push(fn);
        return { remove: async () => { window.__ota.listeners[name] = (window.__ota.listeners[name] || []).filter(f => f !== fn); } };
      },
      setMultiDelay: async () => {},
      next: async (a) => { window.__ota.next = { id: a.id, version: o.manifest.version }; },
      cancelDelay: async () => {},
      reload: async () => {}, set: async () => {},
    };
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android',
      Plugins: {
        CapacitorUpdater: updater,
        CapacitorHttp: { get: async () => ({ status: 200, data: o.manifest }) },
        Network: { getStatus: async () => ({ connected: true, connectionType: o.network }) },
      },
    };
  }, o);
  // A phone: the row lives in the menu sheet (the desktop menubar has no installed app to update).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.appUpdate && NavAid.ota && NavAid.ota.status);
  await page.evaluate((v) => { if (v) NavAid.version = v; }, o.running);
  await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
  await page.evaluate(() => NavAid.appUpdate.refresh());
  const row = page.locator('#app-update');
  await row.scrollIntoViewIfNeeded();
  return row;
}

test('already on the latest build: Up to date, and a check, not a download', async ({ page }) => {
  // The APK's own stamp has 8 characters of the commit, the deploy's 7: the same build.
  const row = await boot(page, { manifest: MANIFEST, network: 'cellular', running: '1.0-abcdef12' });
  await expect(row).toContainText('Up to date');
  await expect(row.locator('.app-update-btn')).toHaveText('Check again');
  expect(await page.evaluate(() => NavAid.ota.checkForUpdate({ force: true }).then(r => r.reason))).toBe('already running it');
  expect(await page.evaluate(() => window.__ota.downloads)).toBe(0);
});

test('an update on mobile data is downloaded now, after asking, and waits for the next start', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const row = await boot(page, { manifest: MANIFEST, network: 'cellular', running: '1.0-0000000' });
  await expect(row).toContainText(/Update available · \u2066?27 MB/);
  await row.locator('.app-update-btn').click();
  const ask = page.locator('.follow-me-ask-modal');
  await expect(ask).toContainText(/27 MB\u2069? of mobile data/);
  await ask.getByRole('button', { name: 'Download now' }).click();
  // Progress while it downloads: the plugin's percent, and a bar.
  await expect(row).toContainText('Downloading… 45%');
  // (State, not on-screen visibility: the menu sheet it sits in is not always open in CI.)
  await expect(row.locator('.app-update-progress')).not.toHaveAttribute('hidden', '');
  expect(await row.locator('.app-update-progress').evaluate(b => b.value)).toBe(45);
  await page.evaluate(() => window.__ota.finish());
  await expect(row).toContainText('installs the next time NavAid starts');
  await expect(row.locator('.app-update-progress')).toHaveAttribute('hidden', '');
  expect(await page.evaluate(() => (window.__ota.listeners.download || []).length)).toBe(0);   // listener removed
  expect(await page.evaluate(() => window.__ota.downloads)).toBe(1);
  expect(dialogs).toEqual([]);                       // asked in the app, never window.confirm
});

test('declining on mobile data downloads nothing', async ({ page }) => {
  const row = await boot(page, { manifest: MANIFEST, network: 'cellular', running: '1.0-0000000' });
  await row.locator('.app-update-btn').click();
  await page.locator('.follow-me-ask-modal').getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toContainText('Update available');
  expect(await page.evaluate(() => window.__ota.downloads)).toBe(0);
});

test('on Wi-Fi it downloads without asking', async ({ page }) => {
  const row = await boot(page, { manifest: MANIFEST, network: 'wifi', running: '1.0-0000000' });
  await row.locator('.app-update-btn').click();
  await page.waitForFunction(() => typeof window.__ota.finish === 'function');
  await page.evaluate(() => window.__ota.finish());
  await expect(row).toContainText('installs the next time');
  await expect(page.locator('.follow-me-ask-modal')).toHaveCount(0);
});

test('the web app has no such row', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.appUpdate);
  await page.evaluate(() => NavAid.appUpdate.refresh());
  await expect(page.locator('#app-update')).toBeHidden();
});
