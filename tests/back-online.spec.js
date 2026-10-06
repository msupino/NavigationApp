const { test, expect } = require('./_setup');

// Offline, failed chart tiles stay blank and the hazard feeds wait for their 10-minute poll.
// When the connection comes back the tiles that failed OFFLINE reload and the feeds re-poll at
// once. A tile that fails online too (open sea) does not reload its layer on every reconnect,
// and a brief flap with nothing to reload passes without a message.
test('back online: tiles that failed offline reload once, and a toast says so', async ({ page, context }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshAfterReconnect === 'function' && typeof map !== 'undefined');
  await page.evaluate(() => {
    window.__redraws = { off: 0, on: 0 };
    const mk = (k) => { const l = L.tileLayer('data:,').addTo(map); l.redraw = function () { window.__redraws[k]++; return this; }; return l; };
    window.__offLayer = mk('off'); window.__onLayer = mk('on');
    window.__onLayer.fire('tileerror', { tile: document.createElement('img') });     // online: a gap, not an outage
  });
  await context.setOffline(true);
  await page.evaluate(() => window.__offLayer.fire('tileerror', { tile: document.createElement('img') }));
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => window.__redraws)).toEqual({ off: 1, on: 0 });
  await expect(page.locator('#toast-stack .toast').filter({ hasText: 'Back online' }).first()).toBeAttached();
});

test('a brief flap with nothing to reload re-polls quietly', async ({ page, context }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshAfterReconnect === 'function' && typeof map !== 'undefined');
  await context.setOffline(true);
  await context.setOffline(false);
  await page.waitForTimeout(300);
  await expect(page.locator('#toast-stack .toast').filter({ hasText: 'Back online' })).toHaveCount(0);
});
