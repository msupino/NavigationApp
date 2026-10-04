// @ts-check
// The APK asks to restart onto a downloaded update instead of waiting silently for the next cold
// start, and says when a newer APK is out -- once per version, and never while a position is live.
const { test, expect } = require('./_setup');

const boot = (page) => page.goto('?lang=en&nogist');
// A pending bundle ready to apply, as the real plugin reports it.
const stub = (page) => page.evaluate(() => {
  window.__ota = { current: { id: 'running', version: '1.0-old' }, pending: { id: 'b2', version: '1.0-new' }, reloads: 0 };
  window.__navaidEmbedded = true;
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { CapacitorUpdater: {
    current: async () => ({ bundle: window.__ota.current }),
    getNextBundle: async () => window.__ota.pending,
    cancelDelay: async () => {},
    set: async () => {},
    reload: async () => {
      window.__ota.reloads++;
      const q = window.__ota.pending;
      if (q) { window.__ota.current = { id: q.id, version: q.version }; window.__ota.pending = null; }
    },
  } } };
  try { localStorage.removeItem('navaid.otaAskedVersion'); localStorage.removeItem('navaid.apkAskedVersion');
        localStorage.removeItem('navaid.otaInstalling'); } catch (e) {}
});
const question = (page) => page.locator('.follow-me-ask-modal');

test('Restart now applies the downloaded update straight away', async ({ page }) => {
  await boot(page);
  await stub(page);
  const p = page.evaluate(() => NavAid.ota.offerRestart('1.0-new'));
  await expect(question(page)).toContainText('1.0-new');
  await expect(page.locator('.follow-me-ask-cancel')).toHaveText('Later');
  await page.locator('.follow-me-ask-ok').click();
  expect(await p).toBe(true);
  expect(await page.evaluate(() => ({ r: window.__ota.reloads, cur: window.__ota.current.id }))).toEqual({ r: 1, cur: 'b2' });
});

test('Later leaves it for the next start, and the same version is not asked again', async ({ page }) => {
  await boot(page);
  await stub(page);
  const p = page.evaluate(() => NavAid.ota.offerRestart('1.0-new'));
  await page.locator('.follow-me-ask-cancel').click();
  expect(await p).toBe(false);
  expect(await page.evaluate(() => window.__ota.reloads)).toBe(0);
  expect(await page.evaluate(() => NavAid.ota.offerRestart('1.0-new'))).toBe(false);
  await expect(question(page)).toHaveCount(0);
});

test('not asked while a position is live; asked once it stops', async ({ page }) => {
  await boot(page);
  await stub(page);
  await page.evaluate(() => { new Function('gpsLiveOn = true')(); window.__asked = NavAid.ota.offerRestart('1.0-new', { pollMs: 100 }); });
  await page.waitForTimeout(500);
  await expect(question(page)).toHaveCount(0);
  await page.evaluate(() => { new Function('gpsLiveOn = false')(); });
  await expect(question(page)).toHaveCount(1);
  await page.locator('.follow-me-ask-cancel').click();
});

test('a newer APK is offered once and opens its release page', async ({ page }) => {
  await boot(page);
  await stub(page);
  const url = 'https://github.com/msupino/NavigationApp/releases/tag/android-v1.23.0';
  const run = (installed, version) => page.evaluate(([i, v, u]) => {
    window.__opened = null;
    return NavAid.ota.checkForNewApk({ installed: i, latest: { version: v, url: u }, open: (x) => { window.__opened = x; } });
  }, [installed, version, url]);
  const p = run('1.22', '1.23.0');
  await expect(question(page)).toContainText('NavAid 1.23.0 is available');
  await page.locator('.follow-me-ask-ok').click();
  expect((await p).accepted).toBe(true);
  expect(await page.evaluate(() => window.__opened)).toBe(url);
  expect((await run('1.22', '1.23.0')).reason).toBe('asked already');
  expect((await run('1.23', '1.23.0')).reason).toBe('up to date');
  expect((await run('1.23', '1.22.0')).reason).toBe('up to date');
});

test('version order is numeric, not alphabetical', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => [
    NavAid.ota.newerVersion('1.10.0', '1.9'), NavAid.ota.newerVersion('1.22.0', '1.22'),
    NavAid.ota.newerVersion('2.0', '1.99'), NavAid.ota.newerVersion('1.22', '1.23.0')])).toEqual([true, false, true, false]);
});
