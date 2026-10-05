const { test, expect } = require('./_setup');

// Offline, failed chart tiles stay blank and the hazard feeds wait for their 10-minute poll.
// When the connection comes back the failed tiles reload and the feeds re-poll straight away.
test('back online: failed tiles reload once, and a toast says so', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshAfterReconnect === 'function' && typeof map !== 'undefined');
  const r = await page.evaluate(() => {
    let redraws = 0;
    const layer = L.tileLayer('data:,').addTo(map);
    layer.redraw = function () { redraws++; return this; };
    layer.fire('tileerror', { tile: document.createElement('img') });
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));     // a second reconnect: nothing failed since
    return { redraws };
  });
  expect(r.redraws).toBe(1);
  await expect(page.locator('#toast-stack .toast').filter({ hasText: 'Back online' }).first()).toBeAttached();
});
