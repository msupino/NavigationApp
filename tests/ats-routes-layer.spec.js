// @ts-check
// The CAA's enroute sheet (ENR 6.1) as a base chart, beside CVFR / Low Alt / Helicopters. It
// is the one chart here that ships as a single reprojected raster rather than a tile set, so
// it is an imageOverlay wearing a base layer's hat — and, being a chart, its reporting points
// are what "Follow chart" hands the route builder while it is showing.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map === 'object' && typeof layers === 'object' &&
    !!document.getElementById('layer-select'));
}

const onMap = (page) => page.evaluate(() => {
  const l = layers.ATS;
  if (!map.hasLayer(l)) return null;
  const b = l.getBounds();
  return { sw: [b.getSouth(), b.getWest()], ne: [b.getNorth(), b.getEast()], url: l._url };
});

const pick = (page, name) => page.evaluate((n) => {
  const sel = document.getElementById('layer-select');
  sel.value = n;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}, name);

test('it is listed as a chart, after the tile charts and before the base maps', async ({ page }) => {
  await boot(page);
  const values = await page.evaluate(() =>
    Array.from(document.getElementById('layer-select').options).map(o => o.value));
  expect(values).toContain('ATS');
  // Charts first, then the divider, then the base maps.
  expect(values.indexOf('ATS')).toBeGreaterThan(values.indexOf('CVFR'));
  expect(values.indexOf('ATS')).toBeLessThan(values.indexOf('Satellite'));
});

test('choosing it puts the sheet on the map, on the bounds its data states', async ({ page }) => {
  await boot(page);
  expect(await onMap(page)).toBeNull();
  await pick(page, 'ATS');
  const on = await onMap(page);
  const meta = await page.evaluate(() => fetch('data/ats-chart.json').then(r => r.json()));
  expect(on).not.toBeNull();
  expect(on.sw[0]).toBeCloseTo(meta.sw[0], 5);
  expect(on.sw[1]).toBeCloseTo(meta.sw[1], 5);
  expect(on.ne[0]).toBeCloseTo(meta.ne[0], 5);
  expect(on.ne[1]).toBeCloseTo(meta.ne[1], 5);
  expect(on.url).toContain(meta.png);
  // A chart is remembered like any other.
  expect(await page.evaluate(() => localStorage.getItem('navaid.layer'))).toBe('ATS');
});

// The sheet covers the FIR and no more, so the world around it must not be blank — the same
// floor every other FIR-only chart gets, which is OpenStreetMap until Display says otherwise
// (see base-layer-under-chart.spec.js).
test('the map under the chart fills in around it', async ({ page }) => {
  await boot(page);
  await pick(page, 'ATS');
  expect(await page.evaluate(() => map.hasLayer(underlayLayer('OpenStreetMap')))).toBe(true);
});

// Being a chart is what makes "Follow chart" meaningful: its own reporting points come up
// without the pilot pinning a dataset by hand.
test('following the chart hands over its own reporting points', async ({ page }) => {
  await boot(page);
  await pick(page, 'ATS');
  const out = await page.evaluate(async () => {
    await loadNavWaypoints();
    const graph = await fetch('data/ats-route-graph.json').then(r => r.json());
    return { prefix: layerDataPrefix(), label: layerLabelForPrefix('ats'),
             count: navWP.length, nodes: Object.keys(graph.nodes).length,
             vetek: navWP.find(w => w.name === 'VETEK') || null };
  });
  expect(out.prefix).toBe('ats');              // followed the chart, nothing pinned
  expect(out.label).toBe('ATS routes');
  expect(out.count).toBe(out.nodes);
  expect(out.vetek.lat).toBeCloseTo(32.35472, 5);
  expect(out.vetek.lng).toBeCloseTo(34.52333, 5);
});

test('the gist can withdraw it, like any other chart', async ({ page }) => {
  await boot(page);
  const off = await page.evaluate(() => {
    setTune('layerEnabledATS', false);
    return { offered: layerOffered('ATS'), cvfr: layerOffered('CVFR') };
  });
  expect(off.offered).toBe(false);
  expect(off.cvfr).toBe(true);                 // the fallback is never withdrawn
});

test('the sheet is placed in Web Mercator, not as the paper draws it', async ({ page }) => {
  await boot(page);
  const meta = await page.evaluate(() => fetch('data/ats-chart.json').then(r => r.json()));
  // A conformal sheet holds a degree of longitude at cos(latitude) of a degree of latitude,
  // so a raster of it can only be laid down axis-aligned AFTER reprojection. What that buys
  // is checkable from the shipped file: its aspect ratio must be the Mercator one for these
  // bounds, not the paper's.
  //
  // Through the app's own resolver, not a hard-coded path: a PR preview ships without the
  // image sets it has not touched and resolves them against the deployed root, so
  // 'ats-img/...' is a 404 there -- which arrives as an undecodable image, not a clear miss.
  const png = await page.evaluate(async (name) => {
    const img = new Image();
    img.src = navAssetBase('ats-img') + name;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, meta.png);
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  const want = (merc(meta.ne[0]) - merc(meta.sw[0])) / ((meta.ne[1] - meta.sw[1]) * Math.PI / 180);
  expect(png.h / png.w).toBeCloseTo(want, 2);
});

// Reported: choosing the ATS chart after an instrument chart hid the instrument chart. An
// imageOverlay defaults to the overlay pane -- where the plates are drawn -- so the layer
// added last won. A base map belongs under what is drawn on the map.
test('choosing it does not cover the plates drawn on top', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => layers.ATS.options.pane)).toBe('tilePane');
  await pick(page, 'ATS');
  const panes = await page.evaluate(() => {
    const ats = map.getPane(layers.ATS.options.pane);
    const overlay = map.getPane('overlayPane');
    const z = (el) => parseInt(getComputedStyle(el).zIndex || '0', 10);
    return { ats: z(ats), overlay: z(overlay) };
  });
  expect(panes.ats).toBeLessThan(panes.overlay);
});
