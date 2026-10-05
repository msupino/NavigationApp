// @ts-check
// Between ~1 Hz GPS fixes the aircraft glides along its track at the measured ground speed,
// so at 500 km/h it no longer jumps ~140 m a fix. Slow, it stays on the fix; a late fix holds it.
const { test, expect } = require('./_setup');

async function liveFix(page, lat, lng, speedMs, heading) {
  await page.evaluate(([lat, lng, s, h]) => {
    onLivePosition({ timestamp: Date.now(), coords: { latitude: lat, longitude: lng, accuracy: 5, speed: s, heading: h, altitude: 10000 } });
  }, [lat, lng, speedMs, heading]);
}
async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof onLivePosition === 'function' && typeof gpsShownOwn === 'function');
  await page.evaluate(() => { new Function('gpsLiveOn = true; gpsFollow = false')(); map.setView([32, 34.8], 13, { animate: false }); });
}
// Metres east of the fix the symbol is drawn at.
const eastOfFix = (page) => page.evaluate(() => {
  const s = gpsShownOwn(), f = gpsOwn;
  return (s.lng - f.lng) * 111320 * Math.cos(f.lat * Math.PI / 180);
});

test('at 500 km/h the symbol moves on between fixes, along the track', async ({ page }) => {
  await boot(page);
  await liveFix(page, 32, 34.8, 139, 90);          // 139 m/s due east
  await page.waitForTimeout(500);
  // Compared with the time actually elapsed since the fix: 139 m for every second of it.
  const r = await page.evaluate(() => {
    const s = gpsShownOwn(), f = gpsOwn, dt = (Date.now() - _gpsGlideFixAt) / 1000;
    return { m: (s.lng - f.lng) * 111320 * Math.cos(f.lat * Math.PI / 180), want: 139 * dt };
  });
  expect(r.m).toBeGreaterThan(30);
  expect(Math.abs(r.m - r.want)).toBeLessThan(r.want * 0.1 + 5);
  expect(await page.evaluate(() => Math.abs(gpsShownOwn().lat - gpsOwn.lat))).toBeLessThan(0.0002);
});

test('slow, it stays on the fix', async ({ page }) => {
  await boot(page);
  await liveFix(page, 32, 34.8, 5, 90);            // ~10 kt, under gpsGlideMinKt
  await page.waitForTimeout(400);
  expect(await eastOfFix(page)).toBe(0);
});

test('a late fix holds the symbol instead of flying on', async ({ page }) => {
  await boot(page);
  await liveFix(page, 32, 34.8, 139, 90);
  await page.waitForTimeout(3200);
  const m = await eastOfFix(page);
  expect(m).toBeLessThan(139 * 2.5 + 10);          // capped at 2.5 s of travel
});

test('while following, the map glides with it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { new Function('gpsFollow = true')(); });
  await liveFix(page, 32, 34.8, 139, 90);
  const c0 = await page.evaluate(() => map.getCenter().lng);
  await page.waitForTimeout(600);
  const c1 = await page.evaluate(() => map.getCenter().lng);
  expect(c1).toBeGreaterThan(c0);
});

test('can be switched off', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { NavAid.tuning.gpsGlide = false; });
  await liveFix(page, 32, 34.8, 139, 90);
  await page.waitForTimeout(400);
  expect(await eastOfFix(page)).toBe(0);
});

test('on the ground the heading line puts no mark on the aircraft itself', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setView([32, 34.8], 11, { animate: false }));
  await liveFix(page, 32, 34.8, 0.5, 90);          // ~1 kt: "2 min" is a few metres ahead
  const near = await page.evaluate(() => {
    const own = proj(gpsOwn), r = tune('liveAircraftRadiusPx') * 2.2;
    const texts = [];
    const orig = octx.fillText.bind(octx);
    octx.fillText = function (t, x, y) {
      const m = octx.getTransform();
      texts.push({ t: String(t), x: m.a * x + m.e, y: m.d * y + m.f });
      return orig(t, x, y);
    };
    draw();
    octx.fillText = orig;
    const dpr = window.devicePixelRatio || 1;
    return texts.filter(o => /min|nm/.test(o.t) && Math.hypot(o.x / dpr - own.x, o.y / dpr - own.y) < r).map(o => o.t);
  });
  expect(near).toEqual([]);
});
