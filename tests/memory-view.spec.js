// Settings > Memory: the running app's live RAM picture -- the JS heap where the browser reports
// it, and the counts of what is loaded now. Unlike Storage it reads nothing persistent and clears
// nothing. These specs pin the counts, the open-from-Settings flow, and the iOS/WebKit fallback
// where no heap figure exists (dim "not available", never a blank window).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print', 'settings'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navMemoryCounts === 'function' && typeof draw === 'function');
}

test('the counts read the live globals and never throw on missing overlays', async ({ page }) => {
  await boot(page);
  const c = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.8 }, { lat: 32.2, lng: 34.9 }, { lat: 32.3, lng: 35.0 }];
    syncLegs();
    state.notes = [{ lat: 32, lng: 34, text: 'n' }];
    if (typeof gpsTrack !== 'undefined') { gpsTrack.length = 0; gpsTrack.push({ lat: 32, lng: 34, t: 1 }, { lat: 32.1, lng: 34.1, t: 2 }); }
    return navMemoryCounts();
  });
  expect(c.waypoints).toBe(3);
  expect(c.legs).toBe(2);
  expect(c.notes).toBe(1);
  expect(c.track).toBe(2);
  // Overlays that may not be loaded count 0, not undefined, and did not throw to get here.
  for (const k of ['navwp', 'airfields', 'vors', 'notams']) expect(typeof c[k]).toBe('number');
});

test('the heap readout reports availability, and the window shows a bar or the n/a line to match', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.8 }, { lat: 32.2, lng: 34.9 }];
    syncLegs();
  });
  const heap = await page.evaluate(() => navMemoryHeap());
  await page.click('#memory-status');
  const body = page.locator('.storage-modal-body');
  await expect(body).toBeVisible();
  if (heap.available) {
    // Chromium exposes performance.memory: a bar and a used-of-limit percent, like Storage.
    expect(heap.limit).toBeGreaterThan(0);
    await expect(body.locator('.storage-bar-fill')).toHaveCount(1);
    await expect(body.locator('.storage-used')).toContainText('%');
  } else {
    // iOS WebKit path: no bar, a dim line in its place instead of an empty window.
    await expect(body.locator('.storage-bar-fill')).toHaveCount(0);
    await expect(body.locator('.memory-heap-na')).toBeVisible();
  }
  // The loaded-now breakdown names the seeded route either way.
  await expect(body.locator('.storage-breakdown')).toContainText(/waypoint/i);
});

test('the n/a line renders when performance.memory is absent (the iOS case)', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      for (const sec of ['settings']) localStorage.setItem('navaid.sec.' + sec, '1');
      // Simulate WebKit: no heap readout. Redefine the getter to return undefined.
      Object.defineProperty(performance, 'memory', { configurable: true, get: () => undefined });
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navMemoryHeap === 'function');
  const heap = await page.evaluate(() => navMemoryHeap());
  expect(heap.available).toBe(false);
  await page.click('#memory-status');
  const body = page.locator('.storage-modal-body');
  await expect(body.locator('.memory-heap-na')).toBeVisible();
  await expect(body.locator('.storage-bar-fill')).toHaveCount(0);
});

test('Refresh re-measures in place without reopening', async ({ page }) => {
  await boot(page);
  await page.click('#memory-status');
  const body = page.locator('.storage-modal-body');
  await expect(body.locator('.storage-breakdown-title')).toBeVisible();
  // Load a route while the window is open, then Refresh: the new counts appear.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.8 }, { lat: 32.2, lng: 34.9 }];
    syncLegs();
  });
  await body.locator('.storage-clear-btn').click();   // the Refresh button reuses the class
  await expect(body.locator('.storage-breakdown')).toContainText(/waypoint/i);
});
