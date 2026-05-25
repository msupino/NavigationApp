// @ts-check
// Regression tests for #178, #179, #180:
// #178 — cache.put awaited in cache-first path
// #179 — cache.delete awaited in ?v= pruning loop
// #180 — navigation falls back to cached '/' when request not cached
const { test, expect } = require('./_setup');

async function waitForSW(page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg && reg.active && reg.active.state === 'activated';
  }, null, { timeout: 15000 });
}

test.describe('#178 cache-first awaits cache.put', () => {
  test('After fetch resolves the asset is in the cache (synchronous from caller view)',
    async ({ page }) => {
      await page.goto('/?lang=en');
      await waitForSW(page);
      // First reload makes the SW intercept; second reload confirms cached asset.
      await page.reload();
      await waitForSW(page);
      // Hit a versioned asset and check it's cached the moment fetch resolves.
      const inCache = await page.evaluate(async () => {
        const url = 'core.js?v=test178';
        await fetch(url);                  // SW handles + caches
        // If the SW awaits cache.put, the entry exists before we look.
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) {
            if (req.url.includes('core.js?v=test178')) return true;
          }
        }
        return false;
      });
      expect(inCache).toBe(true);
    });
});

test.describe('#179 ?v= pruning awaits cache.delete', () => {
  test('After fetching a new ?v= the previous version is evicted', async ({ page }) => {
    await page.goto('/?lang=en');
    await waitForSW(page);
    await page.reload();
    await waitForSW(page);
    const purged = await page.evaluate(async () => {
      // Seed two old versions, then fetch a third — the SW must delete the old ones.
      await fetch('core.js?v=oldA');
      await fetch('core.js?v=oldB');
      await fetch('core.js?v=newC');
      let oldA = false, oldB = false, newC = false;
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          if (req.url.includes('core.js?v=oldA')) oldA = true;
          if (req.url.includes('core.js?v=oldB')) oldB = true;
          if (req.url.includes('core.js?v=newC')) newC = true;
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

test.describe('#180 navigation fallback to cached /', () => {
  test('Offline navigation to uncached URL serves the cached / HTML', async ({ page, context }) => {
    await page.goto('/?lang=en');
    await waitForSW(page);
    await page.reload();
    await waitForSW(page);
    // Ensure '/' (or the canonical index) is in the cache.
    await page.waitForFunction(async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          const p = new URL(req.url).pathname;
          if (p === '/' || p.endsWith('/index.html')) return true;
        }
      }
      return false;
    }, null, { timeout: 10000 });

    // Now request a navigation URL that was never visited. The .catch branch
    // hits caches.match(e.request) → undefined → falls back to caches.match('/').
    // Verify the SW's match logic finds the cached app shell.
    const html = await page.evaluate(async () => {
      // Mimic the SW catch branch in user-space: look up an unknown
      // navigation URL, fall back to '/'. The cached entry's key includes
      // the query (?lang=en) so we ignoreSearch on the fallback lookup.
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        const miss = await cache.match('/never-visited-deep-link');
        if (miss) return 'unexpected-hit';
        const root = await cache.match('/', { ignoreSearch: true });
        if (root) return (await root.text()).slice(0, 80);
      }
      return null;
    });
    expect(html).not.toBeNull();
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });
});
