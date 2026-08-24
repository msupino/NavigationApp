// @ts-check
// The one national sheet among the overlays: the CAA's ENR 6.1 ATS routes chart, laid on the
// map from Extra layers. Everything else in that menu is a per-airfield plate, and this is
// deliberately not one of them — it is the enroute picture a plate is read against, so it
// neither turns a plate off nor gets turned off by one.
const { test, expect } = require('./_setup');

// A 1x1 PNG stands in for the 1.8 MB sheet: this spec is about where the layer is placed and
// when it shows, and the real raster would be fetched on every one of these runs for nothing.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

async function boot(page) {
  await page.route(/ats-img\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript(() => {
    // Open "Extra layers" so its controls are interactable.
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) { /* storage off */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map === 'object' && !!document.getElementById('ats-cb'));
}

const layerOn = (page) => page.evaluate(() => {
  let found = null;
  map.eachLayer(l => { if (l && l._ovType === 'ats_overlay') found = l; });
  if (!found) return null;
  const b = found.getBounds();
  return {
    url: found._ovUrl,
    sw: [b.getSouth(), b.getWest()],
    ne: [b.getNorth(), b.getEast()],
    opacity: found.options.opacity,
  };
});

test('the chart is off until asked for, and covers the box the sheet labels', async ({ page }) => {
  await boot(page);
  expect(await layerOn(page)).toBeNull();
  expect(await page.evaluate(() => document.getElementById('ats-cb').checked)).toBe(false);

  await page.click('#ats-cb');
  await page.waitForFunction(() => {
    let on = false; map.eachLayer(l => { if (l && l._ovType === 'ats_overlay') on = true; });
    return on;
  });
  const on = await layerOn(page);
  const meta = await page.evaluate(() => fetch('data/ats-chart.json').then(r => r.json()));
  // Bounds come from the sheet's own graticule, not from anything typed twice.
  expect(on.sw[0]).toBeCloseTo(meta.sw[0], 5);
  expect(on.sw[1]).toBeCloseTo(meta.sw[1], 5);
  expect(on.ne[0]).toBeCloseTo(meta.ne[0], 5);
  expect(on.ne[1]).toBeCloseTo(meta.ne[1], 5);
  expect(on.url).toContain(meta.png);
  // It really covers the country it is a chart of: Ben Gurion and Rosh Pina are inside.
  expect(on.sw[0]).toBeLessThan(32.0);
  expect(on.ne[0]).toBeGreaterThan(33.0);
  expect(on.sw[1]).toBeLessThan(34.88);
  expect(on.ne[1]).toBeGreaterThan(35.58);
});

test('the choice is remembered, and restored on the next start', async ({ page }) => {
  await boot(page);
  await page.click('#ats-cb');
  expect(await page.evaluate(() => localStorage.getItem('navaid.showAts'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => {
    let on = false; map.eachLayer(l => { if (l && l._ovType === 'ats_overlay') on = true; });
    return on && document.getElementById('ats-cb').checked;
  });
  await page.click('#ats-cb');
  expect(await page.evaluate(() => localStorage.getItem('navaid.showAts'))).toBe('0');
  expect(await layerOn(page)).toBeNull();
});

// The airfield plates are mutually exclusive because they all draw the same few miles of
// map. The enroute sheet is a different question, and answering it must not close the other.
test('it lives alongside an airfield plate, not instead of it', async ({ page }) => {
  await boot(page);
  await page.click('#ats-cb');
  await page.waitForFunction(() => {
    let on = false; map.eachLayer(l => { if (l && l._ovType === 'ats_overlay') on = true; });
    return on;
  });
  await page.click('#cvfr-cb');
  const both = await page.evaluate(() => ({
    ats: document.getElementById('ats-cb').checked,
    cvfr: document.getElementById('cvfr-cb').checked,
  }));
  expect(both).toEqual({ ats: true, cvfr: true });
  // ...and turning a second plate on still closes the first, as before.
  await page.click('#heli-cb');
  expect(await page.evaluate(() => ({
    ats: document.getElementById('ats-cb').checked,
    cvfr: document.getElementById('cvfr-cb').checked,
    heli: document.getElementById('heli-cb').checked,
  }))).toEqual({ ats: true, cvfr: false, heli: true });
});

test('the shared plate-opacity slider drives it too', async ({ page }) => {
  await boot(page);
  await page.click('#ats-cb');
  await page.waitForFunction(() => {
    let on = false; map.eachLayer(l => { if (l && l._ovType === 'ats_overlay') on = true; });
    return on;
  });
  await page.evaluate(() => {
    const el = document.getElementById('plate-opacity');
    el.value = '0.35';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect((await layerOn(page)).opacity).toBeCloseTo(0.35, 3);
});

test('the sheet is placed in Web Mercator, not as the paper draws it', async ({ page }) => {
  await page.goto('?lang=en&nogist');          // the real raster, not the stub
  await page.waitForFunction(() => !!document.getElementById('ats-cb'));
  const meta = await page.evaluate(() => fetch('data/ats-chart.json').then(r => r.json()));
  // A conformal sheet holds a degree of longitude at cos(latitude) of a degree of latitude,
  // so a raster of it can only be laid down axis-aligned AFTER reprojection. What that buys
  // is checkable from the shipped file: its aspect ratio must be the Mercator one for these
  // bounds, not the paper's.
  const png = await page.evaluate(async (name) => {
    const img = new Image();
    img.src = 'ats-img/' + name;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, meta.png);
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  const want = (merc(meta.ne[0]) - merc(meta.sw[0])) / ((meta.ne[1] - meta.sw[1]) * Math.PI / 180);
  expect(png.h / png.w).toBeCloseTo(want, 2);
});
