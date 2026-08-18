// @ts-check
// Reported from the phone: alerts pile up in Android's shade and stay there for ever. An
// in-flight alert is about NOW — approaching a waypoint, overhead it, off plan — so ten
// minutes later it is history, and a two-hour sortie lands with a stack to swipe away.
//
// Nothing in either API sets an expiry (Android's timeoutAfter is not exposed by the
// plugin; the web Notification API has no such field), so each path withdraws what it
// posted: cancel by id natively, close the notification on the web.
const { test, expect } = require('./_setup');

// A fake clock: the app schedules the withdrawal with setTimeout, so the test drives it.
async function boot(page, ttlSec) {
  await page.addInitScript(() => {
    window.__timers = [];
    const realTimeout = window.setTimeout;
    window.setTimeout = (fn, ms) => {
      window.__timers.push({ fn, ms });
      return realTimeout(() => {}, 0);      // never fire on their own; the test decides
    };
    window.__fireTimers = (minMs) => {
      const due = window.__timers.filter(t => (t.ms || 0) >= (minMs || 0));
      window.__timers = window.__timers.filter(t => due.indexOf(t) === -1);
      due.forEach(t => t.fn());
      return due.length;
    };
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof gpsSendWatchAlert === 'function' && typeof setTune === 'function');
  if (ttlSec !== undefined) await page.evaluate((s) => setTune('alertNotifyTtlSec', s), ttlSec);
}

// Stub the native plugin and record schedule/cancel.
const withNative = (page) => page.evaluate(() => {
  window.__scheduled = [];
  window.__cancelled = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LocalNotifications: {
        schedule: (o) => { window.__scheduled.push(...o.notifications); return Promise.resolve(); },
        cancel: (o) => { window.__cancelled.push(...o.notifications); return Promise.resolve(); },
        requestPermissions: () => Promise.resolve({ display: 'granted' }),
      },
    },
  };
});

test('a native alert is withdrawn once its life is up', async ({ page }) => {
  await boot(page, 120);
  await withNative(page);
  const out = await page.evaluate(() => {
    gpsSendWatchAlert('TOP', 'overhead BASAN');
    const posted = window.__scheduled.map(n => ({ id: n.id, autoCancel: n.autoCancel }));
    const beforeFire = window.__cancelled.length;
    window.__fireTimers(120000);                 // the TTL timer comes due
    return { posted, beforeFire, cancelled: window.__cancelled.map(n => n.id) };
  });
  expect(out.posted.length).toBe(1);
  expect(out.posted[0].autoCancel).toBe(true);   // tapping clears it too
  expect(out.beforeFire).toBe(0);                // not withdrawn early
  expect(out.cancelled).toEqual([out.posted[0].id]);
});

test('each alert withdraws its own, not the last one twice', async ({ page }) => {
  await boot(page, 120);
  await withNative(page);
  const out = await page.evaluate(() => {
    gpsSendWatchAlert('Next leg', 'BASAN in 2 min');
    gpsSendWatchAlert('Altitude', '2400 ft, planned 2000 ft');
    window.__fireTimers(120000);
    return { posted: window.__scheduled.map(n => n.id), cancelled: window.__cancelled.map(n => n.id) };
  });
  expect(out.posted.length).toBe(2);
  expect(out.cancelled.sort()).toEqual(out.posted.sort());
});

test('zero means keep them, the old behaviour', async ({ page }) => {
  await boot(page, 0);
  await withNative(page);
  const cancelled = await page.evaluate(() => {
    gpsSendWatchAlert('TOP', 'overhead BASAN');
    window.__fireTimers(0);
    return window.__cancelled.length;
  });
  expect(cancelled).toBe(0);
});

test('the web path closes the notification it opened', async ({ page }) => {
  await boot(page, 60);
  const out = await page.evaluate(async () => {
    const closed = [];
    const shown = [];
    // A mobile browser with permission, and no service worker in the way. userAgentData
    // is checked before the UA string (see _gpsIsMobileDevice) and Chromium reports
    // mobile: false, so that is what has to say phone here.
    Object.defineProperty(navigator, 'userAgentData',
      { get: () => ({ mobile: true }), configurable: true });
    Object.defineProperty(navigator, 'userAgent',
      { get: () => 'Mozilla/5.0 (Linux; Android 14) Mobile', configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    window.Capacitor = undefined;
    window.Notification = function (title, opts) {
      shown.push({ title, tag: opts && opts.tag });
      this.close = () => closed.push(title);
    };
    window.Notification.permission = 'granted';
    gpsSendWatchAlert('TOP', 'overhead BASAN');
    const before = closed.length;
    window.__fireTimers(60000);
    return { shown, before, closed };
  });
  expect(out.shown.length).toBe(1);
  expect(out.shown[0].tag).toMatch(/^navaid-alert-/);   // tagged so the SW path can find it
  expect(out.before).toBe(0);
  expect(out.closed).toEqual(['TOP']);
});
