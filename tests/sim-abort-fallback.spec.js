// @ts-check
// The simulator poll timed its request out with AbortSignal.timeout(), which a WebView can
// lack while still having working fetch and AbortController. The expression THREW before
// fetch was called, and the broad catch turned that into "No data" — so the whole simulator
// feature was silently unavailable and looked exactly like a simulator that was not running.
const { test, expect } = require('./_setup');

async function boot(page, { dropTimeout }) {
  if (dropTimeout) {
    await page.addInitScript(() => {
      // Exactly what an older WebView presents: AbortController yes, the static helper no.
      try { delete AbortSignal.timeout; } catch (e) { AbortSignal.timeout = undefined; }
    });
  }
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof _simFetch === 'function' && typeof map !== 'undefined');
}

// A fetch that answers with one good SimConnect frame, recording the options it was given.
async function stubGoodFetch(page) {
  await page.evaluate(() => {
    window.__simCalls = [];
    window.fetch = (url, opts) => {
      window.__simCalls.push({ url: String(url), hasSignal: !!(opts && opts.signal),
        isSignal: !!(opts && opts.signal && typeof opts.signal.aborted === 'boolean') });
      return Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 32.1, longitude: 34.85, altitude: 1200,
          heading: 90, ias: 105 }) });
    };
  });
}

test('the poll connects when AbortSignal.timeout is unavailable', async ({ page }) => {
  await boot(page, { dropTimeout: true });
  await stubGoodFetch(page);
  const r = await page.evaluate(async () => {
    await _simFetch();
    return { calls: window.__simCalls, aircraft: window.simAircraft || null,
      hasHelper: typeof AbortSignal.timeout === 'function' };
  });
  expect(r.hasHelper).toBe(false);          // the environment really is the old one
  // Previously fetch was never reached at all: AbortSignal.timeout(900) threw first.
  expect(r.calls).toHaveLength(1);
  expect(r.calls[0].hasSignal).toBe(true);  // ...and it still gets a real abort signal
  expect(r.calls[0].isSignal).toBe(true);
  expect(r.aircraft).toMatchObject({ lat: 32.1, lng: 34.85, alt: 1200, hdg: 90, ias: 105 });
});

test('the fallback still times the request out', async ({ page }) => {
  await boot(page, { dropTimeout: true });
  await page.evaluate(() => {
    window.__aborted = false;
    // A simulator that accepts the connection and never answers — the case the timeout is
    // there for. Without one, a hung poll would wedge the link with no status change.
    window.fetch = (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => { window.__aborted = true; reject(new Error('aborted')); });
    });
  });
  const t0 = Date.now();
  const aborted = await page.evaluate(async () => {
    await _simFetch();
    return window.__aborted;
  });
  expect(aborted).toBe(true);
  expect(Date.now() - t0).toBeLessThan(5000);
});

test('the native path is still used when present', async ({ page }) => {
  await boot(page, { dropTimeout: false });
  await stubGoodFetch(page);
  const r = await page.evaluate(async () => {
    await _simFetch();
    return { hasHelper: typeof AbortSignal.timeout === 'function',
      calls: window.__simCalls.length, aircraft: window.simAircraft || null };
  });
  expect(r.hasHelper).toBe(true);
  expect(r.calls).toBe(1);
  expect(r.aircraft).toMatchObject({ lat: 32.1, lng: 34.85 });
});

test('a failed poll leaves no abort timer to fire later', async ({ page }) => {
  await boot(page, { dropTimeout: true });
  const r = await page.evaluate(async () => {
    let cleared = 0;
    const realClear = window.clearTimeout;
    window.clearTimeout = function (id) { cleared++; return realClear.call(window, id); };
    window.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    await _simFetch();
    window.clearTimeout = realClear;
    return cleared;
  });
  // The fallback's timer has to be cleared on every settle, or each poll (every second)
  // would leave a pending abort behind it.
  expect(r).toBeGreaterThan(0);
});
