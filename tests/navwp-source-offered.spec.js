// @ts-check
// Reported: "i disabled heli layer, but it still shows up in nav waypoint from dropdown".
// The base-layer picker asks layerOffered() before listing a chart; this list did not, so a
// chart pulled from service could still be chosen as the source of waypoints, comm changes
// and leg altitudes -- a dataset for a chart the app will not draw.
const { test, expect } = require('./_setup');

const options = (page) => page.evaluate(() =>
  Array.from(document.getElementById('navwp-source').options).map(o => o.value));

test('a chart that is not offered is not a waypoint source', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof layerOffered === 'function');
  // Helicopters ships off, so the shipped list is CVFR + Low Alt + Follow chart.
  expect(await page.evaluate(() => layerOffered('Helicopters'))).toBe(false);
  expect(await options(page)).toEqual(['', 'cvfr', 'lsa']);
});

test('turning the chart back on brings its waypoints back', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.rebuildNavWpSource === 'function');
  await page.evaluate(() => { setTune('layerEnabledHelicopters', true); window.rebuildNavWpSource(); });
  expect(await options(page)).toEqual(['', 'cvfr', 'lsa', 'heli']);
  await page.evaluate(() => { setTune('layerEnabledHelicopters', false); window.rebuildNavWpSource(); });
  expect(await options(page)).toEqual(['', 'cvfr', 'lsa']);
});

// A pilot who chose heli waypoints before the chart was pulled must not be left pinned to a
// dataset they can no longer see or change.
test('a stored source for a withdrawn chart falls back to Follow chart', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('navaid.navDataPrefix', 'heli'));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.rebuildNavWpSource === 'function');
  const after = await page.evaluate(() => ({
    prefix: window.navDataPrefix,
    stored: localStorage.getItem('navaid.navDataPrefix'),
    value: document.getElementById('navwp-source').value,
  }));
  expect(after).toEqual({ prefix: null, stored: null, value: '' });
});
