// @ts-check
// ?hotspots=1 rings every waypoint the app treats as a junction, across the whole chart.
// Without it, a hotspot only shows where a route happens to pass one — which cannot answer
// "which points are hotspots", a property of the graph rather than of any one flight plan.
// A review tool like ?graphlegs=1: no toolbar entry, nothing persisted, off unless asked for.
const { test, expect } = require('./_setup');

async function boot(page, query = '') {
  await page.goto(`?lang=en&nogist${query}`);
  await page.waitForFunction(() => typeof draw === 'function' && Array.isArray(navWP) && navWP.length > 0);
}

// How many rings the overlay painted this frame.
const ringCount = (page) => page.evaluate(() => {
  window.__hotspotOverlayCount = 0;
  draw();
  return window.__hotspotOverlayCount || 0;
});

test('off by default — nothing is drawn without the flag', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => hotspotsOverlayEnabled())).toBe(false);
  expect(await ringCount(page)).toBe(0);
});

test('with the flag, every hotspot in the dataset is ringed', async ({ page }) => {
  await boot(page, '&hotspots=1');
  const expected = await page.evaluate(() => navWP.filter(w => waypointHotspot(w)).length);
  expect(expected).toBeGreaterThan(50);          // the CVFR graph has ~80
  expect(await ringCount(page)).toBe(expected);
});

test('it draws with the nav-waypoint layer switched off', async ({ page }) => {
  await boot(page, '&hotspots=1');
  const withLayer = await ringCount(page);
  await page.evaluate(() => { window.showNavWP = false; });
  expect(await ringCount(page)).toBe(withLayer);   // the layer being off does not hide the review
});

test('it follows the layer being switched — heli points are its own set', async ({ page }) => {
  await boot(page, '&hotspots=1');
  const cvfr = await ringCount(page);
  expect(cvfr).toBeGreaterThan(0);
  // The overlay reads whatever navWP currently holds, so switching chart data switches it.
  const after = await page.evaluate(() => {
    window.navWP = navWP.slice(0, 3).map(w => ({ ...w, hotspot: true }));
    window.__hotspotOverlayCount = 0;
    draw();
    return window.__hotspotOverlayCount;
  });
  expect(after).toBe(3);
});

test('an explicit hotspot:false is honoured, not overridden by the default set', async ({ page }) => {
  await boot(page, '&hotspots=1');
  const out = await page.evaluate(() => {
    const name = navWP.find(w => waypointHotspot(w)).name;
    window.navWP = [{ ...navWP.find(w => w.name === name), hotspot: false }];
    window.__hotspotOverlayCount = 0;
    draw();
    return { name, count: window.__hotspotOverlayCount };
  });
  expect(out.count).toBe(0);
});
