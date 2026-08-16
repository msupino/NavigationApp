// @ts-check
// PWA coverage: manifest, service worker registration + cache + offline fetch,
// icon files, and the meta tags that make the app installable.
const { test, expect } = require('./_setup');

// This whole file is about the service worker, so it opts out of the suite-wide block
// (see playwright.config.js).
test.use({ serviceWorkers: 'allow' });

async function waitForServiceWorkerScriptUrl(page) {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    if (typeof watchServiceWorkerUpdates === 'function') {
      try {
        await watchServiceWorkerUpdates(navigator.serviceWorker);
      } catch (e) {}
    } else {
      try {
        await navigator.serviceWorker.register('sw.js');
      } catch (e) {}
    }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const reg = await navigator.serviceWorker.getRegistration();
      const worker = reg && (reg.active || reg.waiting || reg.installing);
      if (worker && worker.scriptURL) return worker.scriptURL;
      await sleep(100);
    }
    return null;
  });
}

async function waitForActivatedServiceWorkerController(page) {
  await waitForServiceWorkerScriptUrl(page);
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg && reg.active && reg.active.state === 'activated';
  }, null, { timeout: 15000 });
  await page.waitForFunction(
    () => navigator.serviceWorker.controller != null,
    null, { timeout: 15000 });
}

test.describe('PWA manifest', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('?lang=en');
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
  test.describe.configure({ mode: 'serial' });

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
    await page.goto('?lang=en');
    const url = await waitForServiceWorkerScriptUrl(page);
    expect(url).toMatch(/\/sw\.js$/);
  });

  test('Service worker activates and the cache fills with app shell entries',
    async ({ page }) => {
      await page.goto('?lang=en');
      await page.waitForFunction(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg && reg.active && reg.active.state === 'activated';
      }, null, { timeout: 15000 });
      // 'activated' fires before the SW takes control: controller is set
      // asynchronously (via controllerchange) after clients.claim() resolves.
      // A fetch issued before then bypasses the SW and never fills the cache.
      await page.waitForFunction(
        () => navigator.serviceWorker.controller != null,
        null, { timeout: 15000 });
      // Trigger a fetch the SW intercepts so the cache populates.
      await page.evaluate(async () => { await fetch('app/core.js?v=999'); });
      // The page's fetch() resolves on body arrival, not when the SW has
      // finished cache.put inside respondWith — poll until the cache appears.
      const cached = await page.waitForFunction(async () => {
        const names = await caches.keys();
        const out = {};
        for (const n of names) {
          const keys = await caches.open(n).then(c => c.keys());
          out[n] = keys.map(r => new URL(r.url).pathname);
        }
        const hasNavaid = Object.keys(out).some(n => n.startsWith('navaid-v'));
        return hasNavaid ? out : false;
      }, null, { timeout: 15000 }).then(h => h.jsonValue());
      const cacheNames = Object.keys(cached);
      expect(cacheNames.some(n => n.startsWith('navaid-v'))).toBe(true);
      const allPaths = Object.values(cached).flat();
      // At minimum the HTML navigation that loaded the page should have landed
      // in the cache (network-first branch awaits cache.put inside respondWith).
      expect(allPaths.length).toBeGreaterThan(0);
    });

  test('Index HTML is cached so offline navigation can be served', async ({ page }) => {
    // First load registers + activates the SW but doesn't run through it.
    await page.goto('?lang=en');
    await waitForActivatedServiceWorkerController(page);
    // Reload so the second navigation IS intercepted by the SW — that's the
    // request that gets cache.put inside the navigate branch (#84).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForActivatedServiceWorkerController(page);
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
    await page.goto('?lang=en');
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

  test('First service-worker control does not show the build update notice', async ({ page }) => {
    await page.goto('?lang=en');
    const shown = await page.evaluate(async () => {
      const listeners = {};
      const workerListeners = {};
      const firstWorker = {
        state: 'installing',
        addEventListener(type, cb) { workerListeners[type] = cb; },
      };
      const fakeSw = {
        controller: null,
        addEventListener(type, cb) { listeners[type] = cb; },
        register() {
          return Promise.resolve({
            installing: firstWorker,
            waiting: null,
            addEventListener() {},
            update() { return Promise.resolve(); },
          });
        },
      };
      await watchServiceWorkerUpdates(fakeSw);
      listeners.controllerchange();
      firstWorker.state = 'activated';
      workerListeners.statechange();
      return !!document.getElementById('build-update-notice');
    });
    expect(shown).toBe(false);
  });

  test('New service-worker control shows a hard-refresh build notice', async ({ page }) => {
    await page.goto('?lang=en');
    const text = await page.evaluate(async () => {
      const listeners = {};
      const fakeSw = {
        controller: {},
        addEventListener(type, cb) { listeners[type] = cb; },
        register() {
          return Promise.resolve({
            installing: null,
            waiting: null,
            addEventListener() {},
            update() { return Promise.resolve(); },
          });
        },
      };
      await watchServiceWorkerUpdates(fakeSw);
      listeners.controllerchange();
      return document.getElementById('build-update-notice')?.textContent || '';
    });
    expect(text).toContain('New NavAid build available');
    expect(text).toContain('Hard refresh');
    expect(text).toContain('Reload');
    await page.locator('#build-update-notice .update-dismiss').click();
    await expect(page.locator('#build-update-notice')).toHaveCount(0);
  });

  test('Service-worker update checks are throttled after registration', async ({ page }) => {
    await page.goto('?lang=en');
    const updates = await page.evaluate(async () => {
      const originalNow = Date.now;
      let now = 100000;
      let updateCalls = 0;
      Date.now = () => now;
      const fakeSw = {
        controller: {},
        addEventListener() {},
        register() {
          return Promise.resolve({
            installing: null,
            waiting: null,
            addEventListener() {},
            update() {
              updateCalls++;
              return Promise.resolve();
            },
          });
        },
      };
      try {
        await watchServiceWorkerUpdates(fakeSw);
        await requestBuildUpdateCheck('too-soon');
        now += (5 * 60 * 1000) + 1;
        await requestBuildUpdateCheck('after-throttle');
        return updateCalls;
      } finally {
        Date.now = originalNow;
      }
    });
    expect(updates).toBe(2);
  });

  test('Focus and toolbar activity request a throttled update check', async ({ page }) => {
    await page.goto('?lang=en');
    // On load the page registers the real service worker, which writes the
    // module-global registration that the focus/toolbar update-check handlers
    // read. Let that settle first so the fake registration installed below is
    // the last writer; otherwise the real registration can resolve mid-test
    // and hijack the update() calls we count, leaving updateCalls short. This
    // race — not microtask timing — is what made the test flaky in CI.
    await page.evaluate(() =>
      Promise.race([
        navigator.serviceWorker.ready,
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]).catch(() => {}));
    const updates = await page.evaluate(async () => {
      const originalNow = Date.now;
      let now = 200000;
      let updateCalls = 0;
      Date.now = () => now;
      const fakeSw = {
        controller: {},
        addEventListener() {},
        register() {
          return Promise.resolve({
            installing: null,
            waiting: null,
            addEventListener() {},
            update() {
              updateCalls++;
              return Promise.resolve();
            },
          });
        },
      };
      // performance.now() is not mocked, so it gives a real wall-clock
      // timeout while Date.now stays frozen for the throttle logic.
      const waitFor = async (predicate, timeout = 2000) => {
        const start = performance.now();
        while (!predicate()) {
          if (performance.now() - start > timeout) {
            throw new Error('waitFor timed out at updateCalls=' + updateCalls);
          }
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      };
      try {
        await watchServiceWorkerUpdates(fakeSw);
        await waitFor(() => updateCalls >= 1); // forced 'load' check
        now += (5 * 60 * 1000) + 1;
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => updateCalls >= 2); // 'focus' check after throttle
        document.querySelector('.tb-section-head').click(); // throttled, no-op
        now += (5 * 60 * 1000) + 1;
        document.querySelector('.tb-section-head').click();
        await waitFor(() => updateCalls >= 3); // 'toolbar' check after throttle
        return updateCalls;
      } finally {
        Date.now = originalNow;
      }
    });
    expect(updates).toBe(3);
  });
});

test.describe('APK self-update (native remote-URL shell)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('?lang=en');
  });

  // The build id is the '-<sha>' suffix of NavAid.version ('1.0-<sha>').
  test('currentBuildId parses the sha suffix; dev builds have none', async ({ page }) => {
    const r = await page.evaluate(() => ({
      deployed: currentBuildId('1.0-abc1234'),
      dev: currentBuildId('1.0'),
      empty: currentBuildId(''),
    }));
    expect(r.deployed).toBe('abc1234');
    expect(r.dev).toBe('');
    expect(r.empty).toBe('');
  });

  const runCheck = (page, args) => page.evaluate(async ({ live, running, marker }) => {
    let reloaded = false;
    const store = {
      _v: marker ? { 'navaid.apkReloadedForBuild': marker } : {},
      getItem(k) { return this._v[k] || null; },
      setItem(k, v) { this._v[k] = v; },
    };
    const did = await checkApkForUpdate({
      buildId: running,
      force: true,
      storage: store,
      reload: () => { reloaded = true; },
      fetch: () => Promise.resolve({
        ok: true,
        text: () => Promise.resolve("const CACHE = 'navaid-" + live + "';"),
      }),
    });
    return { did, reloaded, marker: store.getItem('navaid.apkReloadedForBuild') };
  }, args);

  test('reloads when a newer build is live and records the marker', async ({ page }) => {
    const r = await runCheck(page, { live: 'bbbbbbb', running: 'aaaaaaa', marker: null });
    expect(r.did).toBe(true);
    expect(r.reloaded).toBe(true);
    expect(r.marker).toBe('bbbbbbb');
  });

  test('does not reload when the live build matches the running build', async ({ page }) => {
    const r = await runCheck(page, { live: 'aaaaaaa', running: 'aaaaaaa', marker: null });
    expect(r.did).toBe(false);
    expect(r.reloaded).toBe(false);
  });

  test('does not reload twice for the same build (loop guard)', async ({ page }) => {
    const r = await runCheck(page, { live: 'bbbbbbb', running: 'aaaaaaa', marker: 'bbbbbbb' });
    expect(r.did).toBe(false);
    expect(r.reloaded).toBe(false);
  });

  test('never reloads a dev build (no sha) and never hits the network', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let fetched = false;
      let reloaded = false;
      const did = await checkApkForUpdate({
        buildId: '',
        force: true,
        fetch: () => { fetched = true; return Promise.resolve({ ok: true, text: () => Promise.resolve('') }); },
        reload: () => { reloaded = true; },
      });
      return { did, fetched, reloaded };
    });
    expect(r.did).toBe(false);
    expect(r.fetched).toBe(false);
    expect(r.reloaded).toBe(false);
  });

  test('an un-rewritten sw.js (navaid-v6) is treated as no update', async ({ page }) => {
    const r = await runCheck(page, { live: 'v6', running: 'aaaaaaa', marker: null });
    expect(r.did).toBe(false);
    expect(r.reloaded).toBe(false);
  });

  // The track being recorded lives in memory only, and nothing restores a recording on
  // boot: reloading mid-flight ends the recording and takes every point of it with it.
  test('never reloads while a track is being recorded, and reloads once it stops', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const run = (recording) => {
        let reloaded = false;
        const store = { _v: {}, getItem(k) { return this._v[k] || null; }, setItem(k, v) { this._v[k] = v; } };
        return checkApkForUpdate({
          buildId: 'aaaaaaa', force: true, recording, storage: store,
          reload: () => { reloaded = true; },
          fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve("const CACHE = 'navaid-bbbbbbb';") }),
        }).then(did => ({ did, reloaded, marker: store.getItem('navaid.apkReloadedForBuild') }));
      };
      return { during: await run(true), after: await run(false) };
    });
    expect(r.during.reloaded).toBe(false);
    expect(r.during.did).toBe(false);
    // No marker while skipped: stamping it would mean "already reloaded for this build"
    // and would swallow the update for good once the flight ended.
    expect(r.during.marker).toBeNull();
    expect(r.after.reloaded).toBe(true);
    expect(r.after.marker).toBe('bbbbbbb');
  });

  test('the live recording flag is what gates it, with no override passed', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.gpsRecording = true;
      let reloaded = false;
      const did = await checkApkForUpdate({
        buildId: 'aaaaaaa', force: true,
        storage: { getItem: () => null, setItem: () => {} },
        reload: () => { reloaded = true; },
        fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve("const CACHE = 'navaid-bbbbbbb';") }),
      });
      window.gpsRecording = false;
      return { did, reloaded };
    });
    expect(r.reloaded).toBe(false);
    expect(r.did).toBe(false);
  });
});
