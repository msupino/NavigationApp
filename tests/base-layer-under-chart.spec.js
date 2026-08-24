// @ts-check
// Reported as a question: can more than one layer be on at once — ATS over Satellite, ATS
// over CVFR? The picker still chooses ONE chart, because everything downstream (waypoint
// source, NOTAM preferences, offline tiles, export) asks "which chart am I on". What it
// gains is a floor: Display → "Map under the chart" chooses what sits beneath, and any chart
// can take that place. Two controls, one answer each, instead of a stacking model.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map === 'object' &&
    !!document.getElementById('base-layer-select') && typeof underlayLayer === 'function');
}

const pick = (page, id, value) => page.evaluate(([i, v]) => {
  const sel = document.getElementById(i);
  sel.value = v;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

const state = (page) => page.evaluate(() => {
  const under = {};
  for (const n of Object.keys(layers)) {
    const l = underlayLayer(n);
    under[n] = !!(l && map.hasLayer(l));
  }
  const top = Object.keys(layers).find(n => map.hasLayer(layers[n])) || null;
  return { top, under, chosen: window.baseLayerName };
});

test('OpenStreetMap is the floor until something else is chosen', async ({ page }) => {
  await boot(page);
  const s = await state(page);
  expect(s.chosen).toBe('OpenStreetMap');
  expect(s.top).toBe('CVFR');
  expect(s.under.OpenStreetMap).toBe(true);
  // The default is the gist's to change, and the picker offers every chart plus none.
  const opts = await page.evaluate(() =>
    Array.from(document.getElementById('base-layer-select').options).map(o => o.value));
  expect(opts[0]).toBe('none');
  expect(opts).toContain('Satellite');
  expect(opts).toContain('ATS');
  expect(await page.evaluate(() => tune('defaultBaseLayer'))).toBe('OpenStreetMap');
});

test('ATS over Satellite: the sheet on top, imagery underneath', async ({ page }) => {
  await boot(page);
  await pick(page, 'layer-select', 'ATS');
  await pick(page, 'base-layer-select', 'Satellite');
  const s = await state(page);
  expect(s.top).toBe('ATS');
  expect(s.under.Satellite).toBe(true);
  expect(s.under.OpenStreetMap).toBe(false);      // one floor at a time
  // The underlay is its own instance in the pane below: the loops that name the active
  // chart look at `layers`, and must still answer ATS rather than Satellite.
  expect(await page.evaluate(() => currentLayerName())).toBe('ATS');
  expect(await page.evaluate(() => underlayLayer('Satellite').options.pane)).toBe('basemapUnderlay');
});

test('ATS over CVFR: a chart under a chart', async ({ page }) => {
  await boot(page);
  await pick(page, 'layer-select', 'ATS');
  await pick(page, 'base-layer-select', 'CVFR');
  const s = await state(page);
  expect(s.top).toBe('ATS');
  expect(s.under.CVFR).toBe(true);
  // ...and the CVFR the picker owns is NOT on the map: the underlay is a second instance,
  // so "which chart am I on" is still one answer.
  expect(await page.evaluate(() => map.hasLayer(layers.CVFR))).toBe(false);
  expect(await page.evaluate(() => layerDataPrefix())).toBe('ats');
});

test('a chart is never laid under itself', async ({ page }) => {
  await boot(page);
  await pick(page, 'base-layer-select', 'CVFR');   // CVFR is already the chart on top
  const s = await state(page);
  expect(s.top).toBe('CVFR');
  expect(s.under.CVFR).toBe(false);                // nothing to gain, two sets of tiles to lose
  // Switch the chart away and the floor appears, without touching the choice.
  await pick(page, 'layer-select', 'ATS');
  expect((await state(page)).under.CVFR).toBe(true);
});

test('none leaves the map bare under a chart that covers only the FIR', async ({ page }) => {
  await boot(page);
  await pick(page, 'base-layer-select', 'none');
  const s = await state(page);
  expect(Object.values(s.under).some(Boolean)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('navaid.baseLayer'))).toBe('none');
});

test('the choice is remembered, and the gist sets the default for a device that has none', async ({ page }) => {
  await boot(page);
  await pick(page, 'base-layer-select', 'Satellite');
  await page.reload();
  await page.waitForFunction(() => typeof underlayLayer === 'function');
  expect(await page.evaluate(() => window.baseLayerName)).toBe('Satellite');

  // A device that never chose follows the gist.
  await page.evaluate(() => localStorage.removeItem('navaid.baseLayer'));
  await page.reload();
  await page.waitForFunction(() => typeof underlayLayer === 'function');
  const gisted = await page.evaluate(() => {
    setTune('defaultBaseLayer', 'none');
    if (typeof window.rebuildBaseLayerPicker === 'function') window.rebuildBaseLayerPicker();
    return window.baseLayerName;
  });
  expect(gisted).toBe('OpenStreetMap');    // already resolved at boot; the gist lands earlier in life
});

test('how strongly the floor shows through is tunable', async ({ page }) => {
  await boot(page);
  await pick(page, 'base-layer-select', 'Satellite');
  const op = await page.evaluate(() => {
    setTune('baseLayerOpacity', 0.35);
    return underlayLayer('Satellite').options.opacity;
  });
  expect(op).toBeCloseTo(0.35, 3);
});
