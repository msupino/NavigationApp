// @ts-check
// Coverage for flyRoute()'s "Google Earth Web" branch (onPick('web')):
//  - builds an earth.google.com/web/@ URL from the first waypoint and opens it,
//  - #145: rejects tampered / out-of-range first-waypoint coords before the
//    string-concat so a malformed lat/lng can't leak into the opened URL.
const { test, expect } = require('./_setup');
const { LLHZ, LLHA } = require('./_airfieldArp');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof syncLegs === 'function');
  // Capture window.open instead of spawning a real tab.
  await page.evaluate(() => {
    window.__opened = [];
    window.open = url => { window.__opened.push(url); return null; };
  });
}

async function setRoute(page, wps) {
  await page.evaluate(list => {
    state.waypoints = list.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs(); draw();
  }, wps);
}

test.describe('Google Earth Web mode (flyRoute)', () => {
  test('valid route opens an earth.google.com/web URL from the first waypoint', async ({ page }) => {
    await boot(page);
    await setRoute(page, [LLHZ, LLHA]);
    page.once('dialog', d => d.accept());            // geWebConfirm
    const downloadPromise = page.waitForEvent('download');   // KML still downloads
    await page.locator('#fly').click();
    await page.getByRole('button', { name: 'Google Earth Web' }).click();
    await downloadPromise;
    const opened = await page.evaluate(() => window.__opened);
    expect(opened.length).toBe(1);
    expect(opened[0]).toContain('https://earth.google.com/web/@');
    expect(opened[0]).toContain(LLHZ.lat.toFixed(6));
    expect(opened[0]).toContain(LLHZ.lng.toFixed(6));
  });

  test('#145 tampered first-waypoint coords are rejected — no URL opened', async ({ page }) => {
    await boot(page);
    await setRoute(page, [LLHZ, LLHA]);
    // Corrupt the first waypoint's latitude to an out-of-range value.
    await page.evaluate(() => { state.waypoints[0].lat = 999; });
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.locator('#fly').click();
    await page.getByRole('button', { name: 'Google Earth Web' }).click();
    const errBadCoords = await page.evaluate(() => S.errBadCoords);
    // First dialog is the geWebConfirm; the second must be the bad-coords alert.
    await expect.poll(() => dialogs).toContain(errBadCoords);
    const opened = await page.evaluate(() => window.__opened);
    expect(opened.length).toBe(0);
  });
});
