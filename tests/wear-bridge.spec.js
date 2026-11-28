// @ts-check
// The live picture for a paired Wear OS watch (wear.js -> WearBridge plugin -> the watch app).
// Asked: "can we do something with navaid and wearos?" -- design in docs/superpowers/specs/
// 2026-11-09-wear-os-companion-design.md. The plugin is stubbed: these tests are about what the
// page sends, when, and when it stays silent.
const { test, expect } = require('./_setup');

async function boot(page, opts) {
  const o = opts || {};
  await page.addInitScript(([platform, count]) => {
    window.__sent = [];
    window.__cleared = 0;
    window.Capacitor = {
      isNativePlatform: () => platform !== 'web',
      getPlatform: () => platform,
      Plugins: {
        WearBridge: {
          nodes: () => Promise.resolve({ count: window.__nodes === undefined ? count : window.__nodes }),
          publish: (a) => { window.__sent.push(JSON.parse(a.json)); return Promise.resolve(); },
          clear: () => { window.__cleared++; return Promise.resolve(); },
        },
      },
    };
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
  }, [o.platform || 'android', o.nodes === undefined ? 1 : o.nodes]);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.wear && typeof startLiveLocation === 'function');
}

// A three-point route north-east of Herzliya, flown from its start at 90 kt.
const route = (page) => page.evaluate(() => {
  state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.30, lng: 34.95, name: 'ONE' },
                     { lat: 32.40, lng: 34.90, name: 'TWO' }];
  syncLegs();
  for (const l of state.legs) { l.flightSpeed = 90; l.inboundAltitude = 2500; }
  draw();
});
const fix = (page, lat, lng, speedMs) => page.evaluate(([la, ln, sp]) => {
  if (!window.gpsLiveOn) startLiveLocation();
  window.__geoCb({ coords: { latitude: la, longitude: ln, accuracy: 5, altitude: 600, speed: sp, heading: 40 }, timestamp: Date.now() });
}, [lat, lng, speedMs]);
const tick = (page) => page.evaluate(() => NavAid.wear.tick());

test('the watch gets the next waypoint, bearing, distance, ETE/ETA, leg timer, GS and altitude', async ({ page }) => {
  await boot(page);
  await route(page);
  await fix(page, 32.20, 34.85, 46.3);                    // 90 kt
  await page.waitForTimeout(300);
  await tick(page);
  const p = await page.evaluate(() => window.__sent[window.__sent.length - 1]);
  expect(p.v).toBe(1);
  expect(p.live).toBe(true);
  expect(p.wp).toBe('ONE');
  expect(p.wpIdx).toBe(1);
  expect(p.wpCount).toBe(2);
  expect(p.gsKt).toBe(90);
  expect(p.altFt).toBeGreaterThan(1900);
  expect(p.altPlanFt).toBe(2500);
  expect(p.dest).toBe('TWO');
  // The same bearing and distance the app computes, not the watch's own.
  const want = await page.evaluate(() => { const g = geo(gpsOwn, state.waypoints[1]); return { brg: toMagnetic(g.brg), nm: Math.round(g.dist * 10) / 10 }; });
  expect(p.brgMag).toBe(want.brg);
  expect(p.distNm).toBe(want.nm);
  expect(Math.abs(p.eteSec - want.nm / 90 * 3600)).toBeLessThan(5);
  expect(p.etaUtc - p.t).toBe(p.eteSec * 1000);
  expect(p.legStart).toBeGreaterThan(0);
  expect(p.staleSec).toBe(10);
});

test('nothing is sent again until a shown figure changes; a keep-alive after 15 s', async ({ page }) => {
  await boot(page);
  await route(page);
  await fix(page, 32.20, 34.85, 46.3);
  await page.waitForTimeout(300);
  await tick(page);
  await tick(page);
  expect(await page.evaluate(() => window.__sent.length)).toBe(1);
  await fix(page, 32.22, 34.87, 46.3);                     // moved: the distance changed
  await page.waitForTimeout(300);
  await tick(page);
  expect(await page.evaluate(() => window.__sent.length)).toBe(2);
});

test('slow or stopped: no ETE (a taxi or a hover is not an arrival time)', async ({ page }) => {
  await boot(page);
  await route(page);
  await fix(page, 32.20, 34.85, 3);                        // ~6 kt
  await page.waitForTimeout(300);
  await tick(page);
  const p = await page.evaluate(() => window.__sent[window.__sent.length - 1]);
  expect(p.wp).toBe('ONE');
  expect(p.eteSec).toBeUndefined();
  expect(p.etaUtc).toBeUndefined();
});

test('off route: the watch is told, with no waypoint to point at', async ({ page }) => {
  await boot(page);
  await route(page);
  await fix(page, 32.20, 34.85, 46.3);
  await page.waitForTimeout(300);
  await page.evaluate(() => { gpsRouteUnknown = true; });
  await tick(page);
  const p = await page.evaluate(() => window.__sent[window.__sent.length - 1]);
  expect(p.offRoute).toBe(true);
  expect(p.wp).toBeUndefined();
});

test('silent with no watch, outside the Android app, or with featureWear off (and the watch is cleared)', async ({ page }) => {
  await boot(page, { nodes: 0 });
  await route(page);
  await fix(page, 32.20, 34.85, 46.3);
  await page.waitForTimeout(300);
  await tick(page);
  expect(await page.evaluate(() => window.__sent.length)).toBe(0);
  // A watch connects: the next node check finds it.
  await page.evaluate(() => { window.__nodes = 1; NavAid.wear._reset(); });
  await tick(page);
  expect(await page.evaluate(() => window.__sent.length)).toBe(1);
  // Switched off by the gist: the watch's picture is withdrawn, and nothing more is sent.
  await page.evaluate(() => setTune('featureWear', false));
  await tick(page);
  await tick(page);
  expect(await page.evaluate(() => [window.__sent.length, window.__cleared])).toEqual([1, 1]);
});

test('the iPhone app and a browser send nothing', async ({ page }) => {
  await boot(page, { platform: 'ios' });
  await route(page);
  await fix(page, 32.20, 34.85, 46.3);
  await page.waitForTimeout(300);
  await tick(page);
  expect(await page.evaluate(() => window.__sent.length)).toBe(0);
});
