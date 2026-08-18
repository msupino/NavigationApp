// @ts-check
// The shipped defaults are meant to BE the deployed configuration now, not a starting point
// the gist corrects on every load. This pins the handful of values that were only ever right
// because the gist said so — if one drifts back, the app boots wrong for the seconds before
// the fetch lands, and wrong for good for anyone offline or with the gist unreachable.
const { test, expect } = require('./_setup');

// value in the live gist at the time it was folded in (2026-08-18).
const DEPLOYED = {
  defaultLabelMarginPx: 20,
  layerEnabledHelicopters: false,   // the Helicopters base chart is not offered...
  defaultShowHeli: false,           // ...and its route-plate overlay ships off too
  magBaselineZoom: 12,
  featureAssistant: false,          // the 💬 launcher ships off
};

test('the shipped defaults already carry the deployed configuration', async ({ page }) => {
  await page.goto('?lang=en&nogist');            // no gist at all: pure shipped values
  await page.waitForFunction(() => typeof tune === 'function');
  const got = await page.evaluate((keys) => {
    const out = {};
    for (const k of keys) out[k] = tune(k);
    return out;
  }, Object.keys(DEPLOYED));
  expect(got).toEqual(DEPLOYED);
});
