// @ts-check
// Asked: "can we behave the printed map for a black and white printer? Currently it's better on a
// colour printer." A "Black-and-white printer" option in the Print dialog (device-local) prints
// the chart in light grey and the route black on white -- white kites, labels and notes with
// black text, black rings and callouts -- for the saved PNG and Print alike. The screen never
// changes: the black-and-white colours are read only while the export draws.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 1000, height: 750 } });

async function exportWith(page, bw) {
  return page.evaluate(async (bw) => {
    localStorage.setItem('navaid.printBw', bw ? '1' : '0');
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.40, lng: 34.95, name: 'B' },
      { lat: 32.60, lng: 35.05, name: 'C' }];
    state.legs = []; syncLegs();
    map.setView([32.4, 34.95], 10, { animate: false }); draw();
    const blob = await new Promise((resolve) => { window.saveFile = (b) => resolve(b); exportPNG('save'); });
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let green = 0, coloured = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gg = px[i + 1], b = px[i + 2];
      if (gg > 180 && r < 120 && b < 120) green++;                       // the kites' #00ff00
      if (Math.max(r, gg, b) - Math.min(r, gg, b) > 40) coloured++;       // anything not grey
    }
    return { green, coloured, kite: tune('legKiteFillColor'), override: NavAid.printOverride || null };
  }, bw);
}

test.beforeEach(async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof exportPNG === 'function' && typeof printBwOn === 'function');
});

test('the colour export has the green kites; the black-and-white one has no colour at all', async ({ page }) => {
  const colour = await exportWith(page, false);
  expect(colour.green).toBeGreaterThan(200);
  const bw = await exportWith(page, true);
  expect(bw.green).toBe(0);
  expect(bw.coloured).toBe(0);
  // ...and the screen's colours are untouched afterwards.
  expect(bw.kite).toBe('#00ff00');
  expect(bw.override).toBeNull();
});

test('the Print dialog has the option, remembered on this device', async ({ page }) => {
  await page.evaluate(() => showExportModal());
  const cb = page.locator('#export-bw');
  await expect(cb).not.toBeChecked();
  await cb.check();
  expect(await page.evaluate(() => localStorage.getItem('navaid.printBw'))).toBe('1');
  await expect(page.locator('label', { has: cb })).toContainText('Optimized for a black-and-white printer');
});
