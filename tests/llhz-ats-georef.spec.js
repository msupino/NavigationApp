// @ts-check
// The LLHZ ATS departure sheet was shipped with ROTATED corners (tl/tr/bl) that placed it about
// 1 km east and 300 m north of where it draws the field -- the plate is north-up, and a
// graticule fit (scripts/georef-plate.py, conformality 0.99) says so. It is placed axis-aligned
// (sw/ne) now, and its box must contain the features it draws: the LLHZ field and the NAT and
// BGN VORs, whose exact positions the sheet prints. A box that does not contain them is the old
// misplacement coming back.
const { test, expect } = require('./_setup');

test('the LLHZ ATS sheet is north-up and its box holds the field and both VORs', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof airfields !== 'undefined' && airfields);
  const out = await page.evaluate(() => {
    const af = airfields.find(a => a.name === 'LLHZ');
    const sheet = af.ifr_overlays.find(s => s.png === 'LLHZ_ATS.png');
    return { sheet, af: { lat: af.lat, lng: af.lng } };
  });
  const s = out.sheet;
  // North-up: placed by sw/ne, not the rotated 3-corner model.
  expect(s.sw && s.ne).toBeTruthy();
  expect(s.tl || s.tr || s.bl).toBeFalsy();
  const [swLat, swLng] = s.sw;
  const [neLat, neLng] = s.ne;
  expect(neLat).toBeGreaterThan(swLat);
  expect(neLng).toBeGreaterThan(swLng);
  // Known positions the sheet draws (CAA digits / dataset): all must fall inside the box.
  const inside = (lat, lng) => lat > swLat && lat < neLat && lng > swLng && lng < neLng;
  for (const [name, lat, lng] of [
    ['LLHZ', out.af.lat, out.af.lng],
    ['NAT', 32.33389, 34.96889],
    ['BGN', 32.01306, 34.87528],
    ['SFAIM', 32.21056, 34.80722],
  ]) expect(inside(lat, lng), name + ' is inside the sheet box').toBe(true);
  // ...and the NE corner is nowhere near the old misplaced value (34.01289 -> ~35.013, 1 km east).
  expect(neLng).toBeLessThan(35.008);
});
