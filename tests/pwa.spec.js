// @ts-check
// PWA coverage: manifest, service worker registration + cache + offline fetch,
// icon files, and the meta tags that make the app installable.
const { test, expect } = require('./_setup');

test.describe('PWA manifest', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?lang=en');
  });

  test('<link rel="manifest"> points at manifest.json', async ({ page }) => {
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('manifest.json');
  });

  test('manifest.json serves valid JSON with required fields', async ({ page, request }) => {
    const resp = await request.get('/manifest.json');
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toMatch(/json/);
    const m = await resp.json();
    expect(m.name).toMatch(/NavAid/);
    expect(m.short_name).toBe('NavAid');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('.');
    expect(m.scope).toBe('.');
    expect(m.theme_color).toBe('#231F20');
    expect(m.background_color).toBe('#231F20');
    expect(Array.isArray(m.icons)).toBe(true);
    expect(m.icons.length).toBeGreaterThanOrEqual(2);
    const sizes = m.icons.map(i => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  test('all manifest icon URLs return 200 with image content-type', async ({ request }) => {
    const m = await (await request.get('/manifest.json')).json();
    for (const icon of m.icons) {
      const resp = await request.get('/' + icon.src);
      expect(resp.status(), icon.src + ' status').toBe(200);
      expect(resp.headers()['content-type'], icon.src + ' type').toMatch(/^image\//);
    }
  });

  test('apple-touch-icon + theme-color meta tags present', async ({ page }) => {
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBe('#231F20');
    const capable = await page.locator('meta[name="mobile-web-app-capable"]').getAttribute('content');
    expect(capable).toBe('yes');
    const appleCapable = await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content');
    expect(appleCapable).toBe('yes');
  });
});

test.describe('Service worker', () => {
  test('sw.js is served with a JavaScript content-type', async ({ request }) => {
    const resp = await request.get('/sw.js');
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toMatch(/javascript/);
  });

  test('sw.js declares the expected CACHE constant', async ({ request }) => {
    const body = await (await request.get('/sw.js')).text();
    expect(body).toMatch(/^const CACHE = 'navaid-v\d+';/m);
  });

  test('Page registers the service worker on load', async ({ page }) => {
    await page.goto('/?lang=en');
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration()) != null,
      null,
      { timeout: 10000 },
    );
    const url = await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistration()).active
        ? (await navigator.serviceWorker.getRegistration()).active.scriptURL
        : (await navigator.serviceWorker.getRegistration()).installing.scriptURL);
    expect(url).toMatch(/\/sw\.js$/);
  });

  test('Service worker activates and the cache fills with app shell entries',
    async ({ page }) => {
      await page.goto('/?lang=en');
      await page.waitForFunction(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg && reg.active && reg.active.state === 'activated';
      }, null, { timeout: 15000 });
      // Trigger a fetch the SW intercepts so the cache populates.
      await page.evaluate(async () => { await fetch('core.js?v=999'); });
      const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        const out = {};
        for (const n of names) {
          const keys = await caches.open(n).then(c => c.keys());
          out[n] = keys.map(r => new URL(r.url).pathname);
        }
        return out;
      });
      const cacheNames = Object.keys(cached);
      expect(cacheNames.some(n => n.startsWith('navaid-v'))).toBe(true);
      const allPaths = Object.values(cached).flat();
      // At minimum the HTML navigation that loaded the page should have landed
      // in the cache (network-first branch awaits cache.put inside respondWith).
      expect(allPaths.length).toBeGreaterThan(0);
    });

  test('Index HTML is cached so offline navigation can be served', async ({ page }) => {
    // First load registers + activates the SW but doesn't run through it.
    await page.goto('/?lang=en');
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active && reg.active.state === 'activated';
    }, null, { timeout: 15000 });
    // Reload so the second navigation IS intercepted by the SW — that's the
    // request that gets cache.put inside the navigate branch (#84).
    await page.reload();
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active && reg.active.state === 'activated';
    }, null, { timeout: 15000 });
    // Wait until the SW's navigate-branch put() has landed (#84 ensures
    // cache.put is awaited inside respondWith). Then verify the cached
    // response body is the index HTML — exercising the same lookup the SW
    // performs in its .catch(() => caches.match(e.request)) fallback.
    const cachedHtml = await page.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          // The SW caches whatever Request the navigation produced. Find it
          // by scanning every key for the document path, ignoring query params.
          for (const req of await cache.keys()) {
            const p = new URL(req.url).pathname;
            if (p === '/' || p.endsWith('/index.html')) {
              const hit = await cache.match(req);
              if (hit) return (await hit.text()).slice(0, 80);
            }
          }
        }
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    });
    expect(cachedHtml).not.toBeNull();
    expect(cachedHtml).toMatch(/<!DOCTYPE html>/i);
  });

  test('Bad upstream response (5xx) is not cached', async ({ page }) => {
    await page.goto('/?lang=en');
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg && reg.active && reg.active.state === 'activated';
    }, null, { timeout: 15000 });
    // Stub a 500 response for an unusual versioned path.
    await page.route('**/poison.js?v=abc', r => r.fulfill({ status: 500, body: 'nope' }));
    await page.evaluate(async () => { try { await fetch('poison.js?v=abc'); } catch (e) {} });
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      for (const n of names) {
        const keys = await (await caches.open(n)).keys();
        if (keys.some(r => r.url.includes('poison.js'))) return true;
      }
      return false;
    });
    expect(cached).toBe(false);
  });
});
