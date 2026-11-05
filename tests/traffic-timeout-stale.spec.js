// @ts-check
// Asked: "if fetch of real time ads-b fails, there is a retry?" -- it retried on the next
// refresh, but (1) a request that hung held every later refresh off (one in flight at a time),
// and (2) while the feed failed, the last positions stayed on the map looking current. Now a
// request has a deadline, and the feed's aircraft fade when it has been silent a while and go,
// with a message, after a longer one.
const { test, expect } = require('./_setup');

const AC = [{ hex: '4c80b8', flight: 'BBG802 ', lat: 32.10, lon: 34.90, alt_baro: 15975, track: 284.9, gs: 377 }];

async function boot(page) {
  await page.addInitScript((body) => {
    window.__asked = 0;
    window.__skew = 0;                                   // shifts Date.now() to age the feed fast
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + window.__skew;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { CapacitorHttp: { request: () => {
        window.__asked++;
        if (window.__hang) return new Promise(() => {});
        if (window.__fail) return Promise.reject(new Error(window.__fail));
        return Promise.resolve({ status: 200, data: body });
      } } },
    };
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    localStorage.setItem('navaid.showTraffic', '1');
  }, { ac: AC });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.trafficRefresh === 'function');
  await page.evaluate(async () => {
    setTune('featureLiveTraffic', true);
    setTune('trafficRefreshSec', 3);
    setTune('trafficTimeoutSec', 3);
    refreshTrafficFeature();
    startLiveLocation();
    window.__geoCb({ coords: { latitude: 32.05, longitude: 34.92, accuracy: 5 }, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 900));
  });
  await expect(page.locator('.traffic-mark')).toHaveCount(1);
}
const lastToast = page => page.evaluate(() => {
  const t = [...document.querySelectorAll('#toast-stack .toast')].pop();
  return t ? t.textContent : '';
});

test('a request that hangs times out, and the next refresh asks again', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.__hang = true; window.__asked = 0; window.trafficPoll(); });
  // Without a deadline this would sit "in flight" and every refresh would skip itself.
  await page.waitForFunction(() => window.trafficLastError && window.trafficLastError.why === 'timeout', null, { timeout: 8000 });
  await page.evaluate(() => { window.__hang = false; });
  await page.waitForFunction(() => window.__asked >= 2, null, { timeout: 8000 });
});

test('the feed silent: its aircraft fade, then go with a message, and come back with it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.__fail = 'HTTP 503'; });
  const mark = page.locator('.traffic-mark');
  await page.evaluate(() => { window.__skew = 31000; window.trafficPoll(); });
  await expect(mark).toHaveClass(/traffic-stale/);
  await page.evaluate(() => { window.__skew = 61000; window.trafficPoll(); });
  await expect(mark).toHaveCount(0);
  expect(await lastToast(page)).toContain('Live traffic lost');
  await page.evaluate(() => { window.__fail = null; window.trafficPoll(); });
  await expect(mark).toHaveCount(1);
  await expect(mark).not.toHaveClass(/traffic-stale/);
});

test('a short blip does not fade anything', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.__fail = 'HTTP 503'; window.__skew = 9000; window.trafficPoll(); });
  await expect(page.locator('.traffic-mark')).not.toHaveClass(/traffic-stale/);
});
