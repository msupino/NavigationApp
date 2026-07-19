// @ts-check
// Regression tests for #178, #179, #180:
// #178 — cache.put awaited in cache-first path
// #179 — cache.delete awaited in ?v= pruning loop
// #180 — navigation falls back to the cached app shell when request not cached
const { test, expect } = require('./_setup');

async function waitForSW(page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg && reg.active && reg.active.state === 'activated';
  }, null, { timeout: 15000 });
  // The SW calls clients.claim() on activate, but under CI parallel load the
  // claim can lag a reload. Retry the reload a few times instead of betting the
  // whole test on a single reload + one hard 15s wait for the controller.
  for (let attempt = 0; attempt < 4; attempt++) {
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (controlled) return;
    await page.reload();
    try {
      await page.waitForFunction(() => !!navigator.serviceWorker.controller,
        null, { timeout: 8000 });
      return;
    } catch (e) {
      // controller still not claimed — loop and reload again
    }
  }
  await page.waitForFunction(() => !!navigator.serviceWorker.controller,
    null, { timeout: 8000 });
}

test.describe('#178 cache-first awaits cache.put', () => {
  test('After fetch resolves the asset is in the cache (synchronous from caller view)',
    async ({ page }) => {
      test.slow();   // SW install/activate is timing-sensitive under CI parallel load
      await page.goto('?lang=en');
      await waitForSW(page);
      // First reload makes the SW intercept; second reload confirms cached asset.
      await page.reload();
      await waitForSW(page);
      // Hit a versioned asset and check it's cached the moment fetch resolves.
      const inCache = await page.evaluate(async () => {
        const url = 'app/core.js?v=test178';
        await fetch(url);                  // SW handles + caches
        // If the SW awaits cache.put, the entry exists before we look.
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) {
            if (req.url.includes('app/core.js?v=test178')) return true;
          }
        }
        return false;
      });
      expect(inCache).toBe(true);
    });
});

test.describe('#179 ?v= pruning awaits cache.delete', () => {
  test('After fetching a new ?v= the previous version is evicted', async ({ page }) => {
    test.slow();   // SW install/activate is timing-sensitive under CI parallel load
    await page.goto('?lang=en');
    await waitForSW(page);
    await page.reload();
    await waitForSW(page);
    const purged = await page.evaluate(async () => {
      // Seed two old versions, then fetch a third — the SW must delete the old ones.
      await fetch('app/core.js?v=oldA');
      await fetch('app/core.js?v=oldB');
      await fetch('app/core.js?v=newC');
      let oldA = false, oldB = false, newC = false;
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          if (req.url.includes('app/core.js?v=oldA')) oldA = true;
          if (req.url.includes('app/core.js?v=oldB')) oldB = true;
          if (req.url.includes('app/core.js?v=newC')) newC = true;
        }
      }
      return { oldA, oldB, newC };
    });
    expect(purged.newC).toBe(true);
    // The newest version is the one currently fetched; old siblings must be gone.
    expect(purged.oldA).toBe(false);
    expect(purged.oldB).toBe(false);
  });
});

test.describe('#180 navigation fallback to cached app shell', () => {
  test('Offline navigation to uncached URL serves the cached / HTML', async ({ page, context }) => {
    // SW install + double reload + async shell caching is timing-sensitive
    // under full-suite parallel load (all workers hammering one static
    // server): passes reliably in isolation, but the fixed 10s budgets flake
    // when the machine is saturated. Triple the test budget + inner waits.
    test.slow();
    await page.goto('?lang=en');
    await waitForSW(page);
    await page.reload();
    await waitForSW(page);
    // Ensure the shell is cached from a URL with a query string. The real bug
    // was `caches.match('/')` missing this entry because it did not ignore
    // `?lang=en` and did not account for Pages subpath scopes.
    await page.waitForFunction(async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          const u = new URL(req.url);
          if ((u.pathname === '/' || u.pathname.endsWith('/index.html')) &&
              u.search.includes('lang=en')) return true;
        }
      }
      return false;
    }, null, { timeout: 30000 });

    await context.setOffline(true);
    try {
      const resp = await page.goto('/never-visited-deep-link',
        { waitUntil: 'domcontentloaded', timeout: 30000 });
      expect(resp && resp.ok()).toBe(true);
      await expect(page).toHaveTitle(/NavAid/);
      await expect(page.locator('#map')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
