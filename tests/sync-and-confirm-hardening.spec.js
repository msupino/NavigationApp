// @ts-check
// Failures that used to happen in silence, and two decisions made on the wrong evidence.
const { test, expect } = require('./_setup');
const { enableAssistant } = require('./_assistant-on');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof driveFetch === 'function' &&
    typeof _isAuthError === 'function' && typeof scheduleRouteAutoSync === 'function');
  await page.evaluate(() => { window.gdriveHeaders = () => ({ Authorization: 'Bearer test' }); });
}

test('a Drive error carries its status as a number, not as prose', async ({ page }) => {
  await boot(page);
  await page.route(/drive\/v3\/files\?/, r => r.fulfill({ status: 401, body: 'no' }));
  const err = await page.evaluate(async () => {
    try { await gdriveFindFile(); return null; }
    catch (e) { return { status: e.status, message: e.message }; }
  });
  expect(err.status).toBe(401);
  expect(err.message).toContain('401');
});

test('the auth retry decides on the status, and a message that merely says 401 does not fool it',
  async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => ({
      byStatus: _isAuthError(Object.assign(new Error('Drive list failed: 401'), { status: 401 })),
      notAuth: _isAuthError(Object.assign(new Error('Drive list failed: 403'), { status: 403 })),
      // A quota error whose body happens to mention 401 must not force a re-auth.
      prose: _isAuthError(Object.assign(new Error('rate limited; see error 401 docs'), { status: 429 })),
      legacy: _isAuthError(new Error('Drive list failed: 401')),   // no status: fall back
    }));
    expect(out).toEqual({ byStatus: true, notAuth: false, prose: false, legacy: true });
  });

test('a hung request gives up instead of wedging the sync', async ({ page }) => {
  await boot(page);
  // A request that never answers. The real timeout is 20 s, which no test should wait for,
  // so the abort is triggered here and the assertion is on what driveFetch makes of it --
  // the branch that turns an AbortError into a timeout the caller can report.
  await page.route(/drive\/v3\/files\?/, () => { /* never answered */ });
  const out = await page.evaluate(async () => {
    const realFetch = window.fetch;
    window.fetch = (url, init) => {
      // Abort on the caller's own signal, immediately, exactly as the timer would.
      if (init && init.signal) {
        return new Promise((_, reject) => {
          const err = new Error('aborted'); err.name = 'AbortError';
          setTimeout(() => reject(err), 10);
        });
      }
      return realFetch(url, init);
    };
    try {
      await driveFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder',
        { headers: gdriveHeaders() }, 'list');
      return { threw: false };
    } catch (e) {
      return { threw: true, timeout: !!e.timeout, message: e.message };
    } finally { window.fetch = realFetch; }
  });
  expect(out.threw).toBe(true);
  expect(out.timeout).toBe(true);
  expect(out.message).toMatch(/timed out/i);
});

test('an auto-sync that fails says so, once', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.gdriveConnected = () => true;
    window.gdriveSync = () => Promise.reject(new Error('offline'));
    scheduleRouteAutoSync();
    await new Promise(r => setTimeout(r, 1800));
    scheduleRouteAutoSync();                    // a second failure while still broken
    await new Promise(r => setTimeout(r, 1800));
    return toasts;
  });
  expect(out.length).toBe(1);
  expect(out[0]).toMatch(/not synced/i);
});

test('the assistant refuses a change it cannot ask about', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await enableAssistant(page);                 // the assistant ships off; see _assistant-on.js
  await page.waitForFunction(() => !!(window.NavAid && NavAid.assistant && NavAid.assistant._runTool));
  const out = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs(); draw();
    const before = JSON.stringify(state.waypoints);
    const toasts = [];
    window.showToast = (m) => toasts.push(String(m));
    NavAid.assistant._resetConsent();
    NavAid.assistant._setConfirm(null);          // back to the shipped default
    const realConfirm = window.confirm;
    // A WebView with dialogs suppressed: there is nothing to ask with. The old default
    // answered "yes" on the pilot's behalf here.
    Object.defineProperty(window, 'confirm', { value: undefined, configurable: true });
    let res;
    try { res = await NavAid.assistant._runTool('set_route', { points: ['LLHZ', 'LLIB'] }); }
    finally { Object.defineProperty(window, 'confirm', { value: realConfirm, configurable: true }); }
    return { res, toasts, unchanged: JSON.stringify(state.waypoints) === before };
  });
  expect(out.unchanged).toBe(true);                                  // nothing was applied
  expect(String(out.res && out.res.error)).toMatch(/declined/i);     // and the model is told
  expect(out.toasts.join(' ')).toMatch(/cannot show the confirmation/i);
});
