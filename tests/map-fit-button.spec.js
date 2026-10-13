// @ts-check
// The F key's fit, on the map for a phone (it has no F key): under Clear map, a "[ ]" frame.
// It brings the selected page frame to the screen, or the route when no page is selected.
// And a position on the map is flying, not printing: starting Location or a recording takes
// the A3/A4 frame off.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = () => 1;
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof fitToScreen === 'function' && typeof setPage === 'function'
    && document.getElementById('edit-col-fit'));
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.81, lng: 35.04, name: 'LLHA' }];
    syncLegs(); draw();
  });
}

test('the Fit button sits under Clear map, named, with the frame icon', async ({ page }) => {
  await boot(page);
  const ids = await page.evaluate(() => [...document.querySelectorAll('.edit-col-ctrl button')].map(b => b.id));
  expect(ids.slice(-2)).toEqual(['edit-col-clear', 'edit-col-fit']);
  await expect(page.locator('#edit-col-fit')).toHaveAttribute('aria-label', /Fit to screen/);
  await expect(page.locator('#edit-col-fit')).toHaveAttribute('data-icon', 'fitFrame');
});

test('with no page selected it fits the route', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setView([31.0, 34.5], 13, { animate: false }));
  await page.locator('#edit-col-fit').click();
  const inView = await page.evaluate(() => state.waypoints.every(w => map.getBounds().contains([w.lat, w.lng])));
  expect(inView).toBe(true);
});

test('with a page selected it fits the page, as F does', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.__fitPage = 0;
    const real = window.fitPageFrame;
    window.fitPageFrame = function () { window.__fitPage++; return real.apply(this, arguments); };
    setPage('A4');
    window.__fitPage = 0;
  });
  await page.locator('#edit-col-fit').click();
  expect(await page.evaluate(() => window.__fitPage)).toBe(1);
});

for (const [name, start] of [['Location', 'startLiveLocation()'], ['a recording', 'startGpsRecording()']]) {
  test('starting ' + name + ' takes the A3/A4 frame off', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => setPage('A3'));
    expect(await page.evaluate(() => pageSize)).toBe('A3');
    await page.evaluate(start);
    expect(await page.evaluate(() => pageSize)).toBe(null);
    expect(await page.evaluate(() => localStorage.getItem('navaid.pageSize'))).toBe(null);
    await expect(page.locator('body')).toContainText('Page frame off while your position shows');
  });
}
