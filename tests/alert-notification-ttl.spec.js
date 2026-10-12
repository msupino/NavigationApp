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
    // setTimeout is held above, so "let the promises run" is a few microtask turns.
    window.__settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
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
  await boot(page, 15);
  await withNative(page);
  const out = await page.evaluate(async () => {
    gpsSendWatchAlert('TOP', 'overhead BASAN');
    await window.__settle();                    // posted once the alert channel is known
    const posted = window.__scheduled.map(n => ({ id: n.id, autoCancel: n.autoCancel }));
    const beforeFire = window.__cancelled.length;
    window.__fireTimers(15000);                 // the TTL timer comes due
    return { posted, beforeFire, cancelled: window.__cancelled.map(n => n.id) };
  });
  expect(out.posted.length).toBe(1);
  expect(out.posted[0].autoCancel).toBe(true);   // tapping clears it too
  expect(out.beforeFire).toBe(0);                // not withdrawn early
  expect(out.cancelled).toEqual([out.posted[0].id]);
});

test('each alert withdraws its own, not the last one twice', async ({ page }) => {
  await boot(page, 15);
  await withNative(page);
  const out = await page.evaluate(async () => {
    gpsSendWatchAlert('Next leg', 'BASAN in 2 min');
    gpsSendWatchAlert('Altitude', '2400 ft, planned 2000 ft');
    await window.__settle();
    window.__fireTimers(15000);
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

// For a paired watch (asked: how will the alerts look on a Pixel Watch). The alerts get
// their own high-importance channel, NavAid's icon instead of Android's grey "i", and one
// group so a burst of them stacks.
test('alerts go to their own Flight alerts channel, with the NavAid icon, in one group', async ({ page }) => {
  await boot(page, 15);
  await withNative(page);
  const out = await page.evaluate(async () => {
    window.__channels = [];
    Capacitor.Plugins.LocalNotifications.createChannel = (c) => { window.__channels.push(c); return Promise.resolve(); };
    gpsSendWatchAlert('TOP', 'overhead BASAN');
    gpsSendWatchAlert('Next leg', 'BASAN in 2 min');
    await window.__settle();
    return { channels: window.__channels, posted: window.__scheduled };
  });
  expect(out.channels.length).toBe(1);                // created once, not per alert
  expect(out.channels[0]).toMatchObject({ id: 'flight-alerts', name: 'Flight alerts', importance: 4, visibility: 1 });
  for (const n of out.posted) {
    expect(n).toMatchObject({ channelId: 'flight-alerts', smallIcon: 'ic_stat_navaid', group: 'navaid-flight-alerts' });
  }
});

test('a channel that cannot be created leaves the alert on the default channel, not dropped', async ({ page }) => {
  await boot(page, 15);
  await withNative(page);
  const posted = await page.evaluate(async () => {
    Capacitor.Plugins.LocalNotifications.createChannel = () => Promise.reject(new Error('no channels'));
    gpsSendWatchAlert('TOP', 'overhead BASAN');
    await window.__settle();
    return window.__scheduled;
  });
  expect(posted.length).toBe(1);
  expect(posted[0].channelId).toBeUndefined();        // Android drops a post to a missing channel
});
