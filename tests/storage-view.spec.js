// Settings > Storage: a usage readout and a one-tap clear of the rebuildable cache. The clear
// touches ONLY the gist cache -- the pilot's routes, recordings, frequencies and settings are
// never cleared automatically. These specs pin that boundary so a future "clear" cannot widen.
const { test, expect } = require('./_setup');

// The View/Settings sections are collapsed by default; open them so the button is interactable,
// same init the other settings specs use.
async function boot(page, seed) {
  await page.addInitScript((seedData) => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print', 'settings'])
        localStorage.setItem('navaid.sec.' + sec, '1');
      if (seedData) for (const [k, v] of Object.entries(seedData)) localStorage.setItem(k, v);
    } catch (e) {}
  }, seed || null);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navStorageUsage === 'function');
}

test('the usage measurement buckets keys and counts cache + preview leftovers as reclaimable', async ({ page }) => {
  await boot(page, {
    'navaid.routes': JSON.stringify([{ id: 1, track: Array(500).fill({ lat: 32, lng: 34, t: 1 }) }]),
    'navaid.airfieldFreqOverrides': JSON.stringify({ 'LLHZ|cat:secondary': '122.100' }),
    'navaid.aircraft': JSON.stringify({ callSign: '4XABC' }),
    'navaid.gistCache': JSON.stringify({ some: 'refetchable blob' }),
    // Leftovers from PR previews opened on this same origin (pr-<n>. namespaced).
    'pr-1453.navaid.routes': JSON.stringify([{ id: 9, name: 'a preview route' }]),
    'pr-1453.navaid.gistCache': JSON.stringify({ blob: 'preview junk' }),
  });
  const u = await page.evaluate(() => navStorageUsage());
  expect(u.cats.routes).toBeGreaterThan(0);
  expect(u.cats.freqs).toBeGreaterThan(0);
  expect(u.cats.aircraft).toBeGreaterThan(0);
  expect(u.cats.cache).toBeGreaterThan(0);
  expect(u.cats.preview).toBeGreaterThan(0);
  // Reclaimable is the gist cache plus every preview leftover; the pilot's own data is not.
  expect(u.reclaimable).toBe(u.cats.cache + u.cats.preview);
  expect(u.budget).toBe(5 * 1024 * 1024);
  // The categoriser never labels the pilot's own data as cache or preview.
  const cat = await page.evaluate(() => ({
    routes: navStorageCategory('navaid.routes'),
    freq: navStorageCategory('navaid.vorFreqOverrides'),
    gist: navStorageCategory('navaid.gistCache'),
    preview: navStorageCategory('pr-1453.navaid.routes'),
    unknown: navStorageCategory('navaid.somethingNew'),
  }));
  expect(cat).toEqual({ routes: 'routes', freq: 'freqs', gist: 'cache', preview: 'preview', unknown: 'other' });
});

test('clearing the cache removes the gist blob and preview leftovers, keeps the pilot data', async ({ page }) => {
  await boot(page, {
    'navaid.routes': JSON.stringify([{ id: 1, name: 'keep me' }]),
    'navaid.airfieldFreqOverrides': JSON.stringify({ 'LLHZ|cat:secondary': '122.100' }),
    'navaid.aircraft': JSON.stringify({ callSign: '4XABC' }),
    'navaid.gistCache': JSON.stringify({ blob: 'x'.repeat(2000) }),
    'pr-1453.navaid.routes': JSON.stringify([{ id: 9, name: 'preview route' }]),
    'pr-900.navaid.gistCache': JSON.stringify({ blob: 'y'.repeat(2000) }),
  });
  const freed = await page.evaluate(() => navClearReclaimable());
  expect(freed).toBeGreaterThan(0);
  const after = await page.evaluate(() => ({
    gist: localStorage.getItem('navaid.gistCache'),
    prev1: localStorage.getItem('pr-1453.navaid.routes'),
    prev2: localStorage.getItem('pr-900.navaid.gistCache'),
    routes: localStorage.getItem('navaid.routes'),
    freqs: localStorage.getItem('navaid.airfieldFreqOverrides'),
    aircraft: localStorage.getItem('navaid.aircraft'),
  }));
  expect(after.gist).toBeNull();
  expect(after.prev1).toBeNull();
  expect(after.prev2).toBeNull();
  expect(after.routes).toContain('keep me');
  expect(after.freqs).toContain('122.100');
  expect(after.aircraft).toContain('4XABC');
});

test('the Storage window opens from Settings and shows the used figure and breakdown', async ({ page }) => {
  await boot(page, {
    'navaid.routes': JSON.stringify([{ id: 1, name: 'r' }]),
    'navaid.gistCache': JSON.stringify({ blob: 'y'.repeat(3000) }),
  });
  await page.click('#storage-manage');
  const body = page.locator('.storage-modal-body');
  await expect(body).toBeVisible();
  await expect(body.locator('.storage-bar-fill')).toHaveCount(1);
  await expect(body.locator('.storage-used')).toContainText('%');
  // The breakdown names at least the two seeded buckets.
  await expect(body.locator('.storage-breakdown')).toContainText(/Routes|recordings/i);
  // The clear button is enabled because there is a cache to clear.
  await expect(body.locator('.storage-clear-btn')).toBeEnabled();
});

test('the clear button is disabled when there is no cache to reclaim', async ({ page }) => {
  await boot(page, { 'navaid.routes': JSON.stringify([{ id: 1, name: 'r' }]) });
  await page.evaluate(() => { try { localStorage.removeItem('navaid.gistCache'); } catch (e) {} });
  await page.click('#storage-manage');
  await expect(page.locator('.storage-clear-btn')).toBeDisabled();
});
