// @ts-check
// Asked for as "IFR SID and ILS charts, for the fields who have it — extra layer like
// circuit". It is like circuit in every way but one: a field has MANY instrument sheets
// (LLBG publishes nineteen that can be placed), so the toggle draws ONE and a picker beside
// it says which, remembered per field.
//
// Only sheets the CAA draws to scale, with a graticule to place them by, are here at all.
// Every LLER SID and IAC, four LLBG STARs and the LLHA STAR are schematics: nothing to place
// them by, so they stay in the charts viewer rather than being placed by guesswork.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

async function boot(page) {
  await page.route(/ifr-img\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) { /* storage off */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('ifr-cb') &&
    typeof loadIfrOverlays === 'function');
}

const on = (page) => page.evaluate(async () => {
  document.getElementById('ifr-cb').click();
  await new Promise(r => setTimeout(r, 300));
});

const drawn = (page) => page.evaluate(() => {
  const out = [];
  map.eachLayer(l => { if (l && l._ovType === 'ifr_overlay') out.push(l._ovPng); });
  return out;
});

test('the shipped sheets are the placeable ones, and they carry their own designation', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'airfields.json'), 'utf8');
  const data = JSON.parse(raw);
  const fields = data[Object.keys(data)[0]];
  const withIfr = fields.filter(a => a.ifr_overlays && a.ifr_overlays.length);
  expect(withIfr.map(a => a.name).sort()).toEqual(['LLBG', 'LLIB']);
  for (const af of withIfr) {
    for (const o of af.ifr_overlays) {
      expect(o.png).toMatch(/^LL[A-Z]{2}_.*\.png$/);
      expect(o.code).toBeTruthy();
      // Placed either square to north (sw/ne) or rotated (three corners) — the sheets the
      // CAA prints turned, like LLBG's SIDs, are the second kind.
      const axis = o.sw && o.ne;
      const rot = o.tl && o.tr && o.bl;
      expect(Boolean(axis) !== Boolean(rot)).toBe(true);
    }
  }
  // The schematics are NOT here, and must not quietly appear: LLER publishes fourteen
  // instrument sheets and not one of them can be placed.
  const ller = fields.find(a => a.name === 'LLER');
  expect(ller.plates.some(p => /SID|IAC/.test(p))).toBe(true);
  expect(ller.ifr_overlays).toBeUndefined();
});

test('one sheet per field is drawn, not all of them', async ({ page }) => {
  await boot(page);
  await on(page);
  const shown = await drawn(page);
  const count = await page.evaluate(() =>
    airfields.filter(a => a.ifr_overlays && a.ifr_overlays.length).length);
  expect(shown.length).toBe(count);              // one each, not nineteen for LLBG
  expect(shown.some(p => p.startsWith('LLBG_'))).toBe(true);
  expect(shown.some(p => p.startsWith('LLIB_'))).toBe(true);
});

test('the picker lists every placeable sheet and switches which one is drawn', async ({ page }) => {
  await boot(page);
  await on(page);
  const sel = page.locator('#ifr-sheet');
  const values = await page.evaluate(() =>
    Array.from(document.getElementById('ifr-sheet').options).map(o => o.value));
  expect(values.length).toBe(21);                // 19 at LLBG + 2 at LLIB
  expect(values.filter(v => v.startsWith('LLBG|')).length).toBe(19);

  // Ask for a different LLBG sheet: that one is drawn, and the other field is untouched.
  const wanted = values.find(v => v.startsWith('LLBG|') && v.includes('SID'));
  await sel.selectOption(wanted);
  await page.waitForTimeout(300);
  const after = await drawn(page);
  expect(after).toContain(wanted.split('|')[1]);
  expect(after.some(p => p.startsWith('LLIB_'))).toBe(true);
  // ...and it is remembered for that field.
  expect(await page.evaluate(() => localStorage.getItem('navaid.ifrSheet.LLBG')))
    .toBe(wanted.split('|')[1]);
});

test('the remembered sheet comes back on the next start', async ({ page }) => {
  await boot(page);
  await on(page);
  const values = await page.evaluate(() =>
    Array.from(document.getElementById('ifr-sheet').options).map(o => o.value));
  const wanted = values.find(v => v.startsWith('LLBG|') && v.includes('RNP'));
  await page.locator('#ifr-sheet').selectOption(wanted);
  await page.reload();
  await page.waitForFunction(() => {
    let n = 0; map.eachLayer(l => { if (l && l._ovType === 'ifr_overlay') n++; });
    return n > 0;
  });
  expect(await drawn(page)).toContain(wanted.split('|')[1]);
});

test('it is an airfield plate, so it excludes the others', async ({ page }) => {
  await boot(page);
  await on(page);
  await page.click('#cvfr-cb');
  expect(await page.evaluate(() => ({
    ifr: document.getElementById('ifr-cb').checked,
    cvfr: document.getElementById('cvfr-cb').checked,
  }))).toEqual({ ifr: false, cvfr: true });
  // ...and the picker row goes away with the layer, rather than offering a choice that
  // changes nothing.
  expect(await page.evaluate(() =>
    document.getElementById('ifr-sheet').closest('label').hidden)).toBe(true);
});

test('"Show plates for" narrows it like every other plate layer', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    localStorage.setItem('navaid.plateAirfield', 'LLIB');
    if (typeof applyPlateAirfieldFilter === 'function') applyPlateAirfieldFilter();
  });
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('ifr-cb'));
  await on(page);
  const shown = await drawn(page);
  expect(shown.every(p => p.startsWith('LLIB_'))).toBe(true);
  expect(shown.length).toBe(1);
});
