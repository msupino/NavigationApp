// @ts-check
// On an out-and-back route both directions draw a kite, and near the turnaround they land
// on top of each other -- readable on screen where you can zoom, unusable on a printed map.
// The filter hides one direction's KITES; the route line is never hidden.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof legIsRetrace === 'function' &&
    typeof legDirVisible === 'function' && typeof syncLegs === 'function');
}

// ALPHA -> BRAVO -> ALPHA: the second leg retraces the first, reversed.
async function outAndBack(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
      { lat: 32.05, lng: 34.0, name: 'BRAVO' },
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
    ];
    syncLegs();
  });
}

test('a leg that reverses an earlier leg is a retrace; a fresh leg is not', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const out = await page.evaluate(() => ({ leg0: legIsRetrace(0), leg1: legIsRetrace(1) }));
  expect(out.leg0).toBe(false);   // outbound
  expect(out.leg1).toBe(true);    // same pair, reversed
});

test('a route that never doubles back has no retrace legs, so the filter is a no-op', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'A' },
      { lat: 32.05, lng: 34.0, name: 'B' },
      { lat: 32.10, lng: 34.1, name: 'C' },
      { lat: 32.15, lng: 34.2, name: 'D' },
    ];
    syncLegs();
  });
  const out = await page.evaluate(() => {
    const retrace = state.legs.map((_, i) => legIsRetrace(i));
    window.legDirFilter = 'out';
    const visOut = state.legs.map((_, i) => legDirVisible(i));
    window.legDirFilter = 'back';
    const visBack = state.legs.map((_, i) => legDirVisible(i));
    window.legDirFilter = 'both';
    return { retrace, visOut, visBack };
  });
  expect(out.retrace).toEqual([false, false, false]);
  expect(out.visOut).toEqual([true, true, true]);    // outbound-only keeps everything
  expect(out.visBack).toEqual([false, false, false]); // return-only has nothing to show
});

test('the filter selects one direction on an out-and-back', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const out = await page.evaluate(() => {
    const at = (f) => { window.legDirFilter = f; return state.legs.map((_, i) => legDirVisible(i)); };
    const both = at('both'), outbound = at('out'), back = at('back');
    window.legDirFilter = 'both';
    return { both, outbound, back };
  });
  expect(out.both).toEqual([true, true]);
  expect(out.outbound).toEqual([true, false]);
  expect(out.back).toEqual([false, true]);
});

test('the toggle persists and is restored on load', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const sel = document.getElementById('leg-dir-select');
    sel.value = 'out';
    sel.dispatchEvent(new Event('change'));
  });
  const stored = await page.evaluate(() => localStorage.getItem('navaid.legDirFilter'));
  expect(stored).toBe('out');

  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof legDirVisible === 'function');
  const restored = await page.evaluate(() => ({
    filter: window.legDirFilter,
    selValue: document.getElementById('leg-dir-select').value,
  }));
  expect(restored.filter).toBe('out');
  expect(restored.selValue).toBe('out');
});

test('hiding a direction never hides the route line itself', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const out = await page.evaluate(() => {
    window.legDirFilter = 'out';
    draw();
    // Both waypoints and both legs still exist and are drawn -- only kites are filtered.
    return { legs: state.legs.length, wps: state.waypoints.length };
  });
  expect(out.legs).toBe(2);
  expect(out.wps).toBe(3);
});
