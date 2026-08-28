// @ts-check
// A ✕ on each drawn chart's own north-west corner, to put it away from the map itself.
// Switching one off meant going back to the menu it came from -- on a phone that is three
// taps, with the toolbar covering the map you were trying to read.
const { test, expect } = require('./_setup');
const { setAirfieldPlate } = require('./_platePicker');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

async function boot(page) {
  await page.route(/(ifr|cvfr|circuit|training|commfail|heli)-img\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) { /* storage off */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('ifr-cb') && !!document.getElementById('cvfr-cb'));
}

const marks = (page) => page.locator('.ov-hide-btn');

test('a drawn chart carries one, and pressing it puts that chart away', async ({ page }) => {
  await boot(page);
  await page.click('#ifr-cb');
  await expect(marks(page)).toHaveCount(1);
  await marks(page).first().click();
  await expect(marks(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('ifr-cb').checked)).toBe(false);
  expect(await page.evaluate(() => {
    let n = 0; map.eachLayer(l => { if (l && l._ovType) n++; });
    return n;
  })).toBe(0);
});

test('it sits on the chart it closes, at its north-west corner', async ({ page }) => {
  await boot(page);
  await page.click('#ifr-cb');
  await expect(marks(page)).toHaveCount(1);
  const where = await page.evaluate(() => {
    let layer = null;
    map.eachLayer(l => { if (l && l._ovType === 'ifr_overlay') layer = l; });
    const b = layer.getBounds();
    const nw = map.latLngToContainerPoint(b.getNorthWest());
    const btn = document.querySelector('.ov-hide-btn').getBoundingClientRect();
    const map_ = map.getContainer().getBoundingClientRect();
    return { dx: (btn.x - map_.x) - nw.x, dy: (btn.y - map_.y) - nw.y };
  });
  // Within a corner's width of it -- the sheet is rotated, so its north-west corner and the
  // corner of its bounding box are not the same point.
  expect(Math.abs(where.dx)).toBeLessThan(40);
  expect(Math.abs(where.dy)).toBeLessThan(40);
});

test('every drawn sheet of a family gets its own', async ({ page }) => {
  await boot(page);
  await setAirfieldPlate(page, 'cvfr-cb');          // one sheet per airfield that has one
  const counts = await page.evaluate(() => {
    let sheets = 0;
    map.eachLayer(l => { if (l && l._ovType === 'cvfr_overlay') sheets++; });
    return { sheets, marks: document.querySelectorAll('.ov-hide-btn').length };
  });
  expect(counts.sheets).toBeGreaterThan(1);
  expect(counts.marks).toBe(counts.sheets);
});

test('the marks leave with the layer, however it is switched off', async ({ page }) => {
  await boot(page);
  await setAirfieldPlate(page, 'cvfr-cb');
  await expect(marks(page).first()).toBeVisible();
  await setAirfieldPlate(page, 'cvfr-cb', false);   // off from the menu, not the mark
  await expect(marks(page)).toHaveCount(0);
  // ...and a plate layer that replaces another leaves none of the first one's behind.
  await setAirfieldPlate(page, 'circuit-cb');
  const before = await marks(page).count();
  await page.locator('#plate-type').selectOption('commfail-cb');
  const after = await page.evaluate(() => {
    let n = 0; map.eachLayer(l => { if (l && l._ovType) n++; });
    return { sheets: n, marks: document.querySelectorAll('.ov-hide-btn').length };
  });
  expect(before).toBeGreaterThan(0);
  expect(after.marks).toBe(after.sheets);
});
