// @ts-check
// The pressure behind the altimetry correction is refetched on age OR distance: the model
// publishes every 15 minutes, and pressure changes with where you are as well as when. Both
// were hard-coded; they are tunables now, read at the point of use so a gist value applies
// without a reload.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof gpsRefreshQnh === 'function' && typeof tune === 'function');
}

test('the shipped cadence: 15 minutes on age, 5 NM on distance', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(() => ({ min: tune('qnhMaxAgeMin'), nm: tune('qnhMoveNm') }));
  // 15 min is the model's own publish interval -- asking more often buys requests, not data.
  // 5 NM is the distance side, tightened from 25: a QNH from 25 NM back can be a different
  // airfield's pressure, and the fetch is cheap.
  expect(v).toEqual({ min: 15, nm: 5 });
});

test('a fresh value is reused; an old one is refetched', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    let calls = 0;
    const fake = () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ current: { pressure_msl: 1013, temperature_2m: 15 }, elevation: 0 }) }); };
    window.gpsAltimetry = true;
    await gpsRefreshQnh(32.0, 34.9, { fetch: fake, force: true });
    const first = calls;
    await gpsRefreshQnh(32.0, 34.9, { fetch: fake });          // same place, seconds later
    const reused = calls;
    gpsQnh.at = Date.now() - (tune('qnhMaxAgeMin') + 1) * 60 * 1000;
    await gpsRefreshQnh(32.0, 34.9, { fetch: fake });          // now stale by age
    return { first, reused, afterAge: calls };
  });
  expect(out.first).toBe(1);
  expect(out.reused).toBe(1);              // no request: the cached value is still good
  expect(out.afterAge).toBe(2);
});

test('moving far enough refetches even when the value is young', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    let calls = 0;
    const fake = () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ current: { pressure_msl: 1011, temperature_2m: 14 }, elevation: 0 }) }); };
    window.gpsAltimetry = true;
    await gpsRefreshQnh(32.0, 34.9, { fetch: fake, force: true });
    setTune('qnhMoveNm', 10);
    await gpsRefreshQnh(32.05, 34.95, { fetch: fake });        // ~4 NM: still the same air
    const near = calls;
    await gpsRefreshQnh(32.5, 35.3, { fetch: fake });          // ~35 NM away
    return { near, far: calls };
  });
  expect(out.near).toBe(1);
  expect(out.far).toBe(2);
});
