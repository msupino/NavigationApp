// @ts-check
// Showing your position without a route drawn is an ordinary thing to do — checking where
// you are before planning anything. A "load a route to get alerts" notification used to
// fire there: test scaffolding from before the watch alerts were validated. Worse, live
// location RESUMES on boot (navaid.gpsLiveOn), so a pilot who had touched nothing got a
// notification telling them to load a route.
const { test, expect } = require('./_setup');

// Capture what the app tries to notify, at the one funnel every alert goes through.
async function watchAlerts(page) {
  await page.addInitScript(() => {
    window.__alerts = [];
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 6; };
    navigator.geolocation.clearWatch = () => {};
    // Permission already granted: the nudge waited on this answer, so a denied permission
    // would hide the bug rather than prove it gone.
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
    Notification.requestPermission = () => Promise.resolve('granted');
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    typeof gpsSendWatchAlert === 'function');
  await page.evaluate(() => {
    const orig = window.gpsSendWatchAlert;
    window.gpsSendWatchAlert = (title, body, speech) => {
      window.__alerts.push({ title, body });
      return orig.call(null, title, body, speech);
    };
  });
}

const alerts = (page) => page.evaluate(() => window.__alerts.slice());

test('showing your location with no route says nothing', async ({ page }) => {
  await watchAlerts(page);
  await page.evaluate(() => { state.waypoints = []; state.legs = []; syncLegs(); startLiveLocation(); });
  await page.waitForTimeout(400);        // the nudge was async, behind the permission answer
  expect(await alerts(page)).toEqual([]);
});

test('nor does the boot that resumes live location', async ({ page }) => {
  await watchAlerts(page);
  await page.evaluate(() => { try { localStorage.setItem('navaid.gpsLiveOn', '1'); } catch (e) {} });
  await page.reload();
  await page.waitForFunction(() => typeof gpsSendWatchAlert === 'function');
  await page.waitForTimeout(400);
  const said = await page.evaluate(() => (window.__alerts || []).slice());
  expect(said).toEqual([]);
});

test('the string is gone from both languages, not just unused', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof S === 'object');
  const leftovers = await page.evaluate(() => Object.keys(S).filter(k => /NoRouteTest/.test(k)));
  expect(leftovers).toEqual([]);
});
