// @ts-check
// The automatic update check ran once, 15 s after start. An app started away from Wi-Fi -- the
// usual way before a flight -- never looked again until the next restart. It now looks again
// when Wi-Fi comes back.
const { test, expect } = require('./_setup');

test('Wi-Fi coming back starts the download that was waiting for it', async ({ page }) => {
  await page.addInitScript(() => {
    window.__navaidEmbedded = true;
    window.__ota = { downloads: 0, net: null, type: 'cellular' };
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android',
      Plugins: {
        CapacitorUpdater: {
          notifyAppReady: async () => {}, current: async () => ({ bundle: { id: 'builtin', version: 'builtin' } }),
          getNextBundle: async () => null, setMultiDelay: async () => {}, cancelDelay: async () => {},
          download: async (a) => { window.__ota.downloads++; return { id: 'dl', version: a.version }; },
          next: async () => {}, addListener: async () => ({ remove: async () => {} }), reload: async () => {}, set: async () => {},
        },
        CapacitorHttp: { get: async () => ({ status: 200, data: { version: '1.0-abcdef1', url: 'https://navaid.supino.org/ota/x.zip', checksum: 'a'.repeat(64), bytes: 1 } }) },
        Network: {
          getStatus: async () => ({ connected: true, connectionType: window.__ota.type }),
          addListener: async (ev, cb) => { window.__ota.net = cb; return { remove() {} }; },
        },
      },
    };
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.__ota.net);
  expect(await page.evaluate(() => window.__ota.downloads)).toBe(0);     // on mobile data: waits
  await page.evaluate(() => { window.__ota.type = 'wifi'; window.__ota.net({ connected: true, connectionType: 'wifi' }); });
  await expect.poll(() => page.evaluate(() => window.__ota.downloads)).toBe(1);
});

// Reported: opened the app on mobile data, joined Wi-Fi shortly after -- and it did not
// download. The start-up check had just run, and a 60 s guard ignored the Wi-Fi coming on.
test('Wi-Fi joined right after the start-up check still starts the download', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__navaidEmbedded = true;
    window.__ota = { downloads: 0, net: null, type: 'cellular', checks: 0 };
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android',
      Plugins: {
        CapacitorUpdater: {
          notifyAppReady: async () => {}, current: async () => ({ bundle: { id: 'builtin', version: 'builtin' } }),
          getNextBundle: async () => null, setMultiDelay: async () => {}, cancelDelay: async () => {},
          download: async (a) => { window.__ota.downloads++; return { id: 'dl', version: a.version }; },
          next: async () => {}, addListener: async () => ({ remove: async () => {} }), reload: async () => {}, set: async () => {},
        },
        CapacitorHttp: { get: async () => { window.__ota.checks++; return { status: 200, data: { version: '1.0-abcdef1', url: 'https://navaid.supino.org/ota/x.zip', checksum: 'a'.repeat(64), bytes: 1 } }; } },
        Network: {
          getStatus: async () => ({ connected: true, connectionType: window.__ota.type }),
          addListener: async (ev, cb) => { window.__ota.net = cb; return { remove() {} }; },
        },
      },
    };
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.__ota.net);
  await page.clock.runFor(16000);                          // the start-up check, on mobile data
  expect(await page.evaluate(() => window.__ota.downloads)).toBe(0);
  await page.clock.runFor(5000);                           // ...and Wi-Fi a few seconds later
  await page.evaluate(() => { window.__ota.type = 'wifi'; window.__ota.net({ connected: true, connectionType: 'wifi' }); });
  await expect.poll(() => page.evaluate(() => window.__ota.downloads)).toBe(1);
});
