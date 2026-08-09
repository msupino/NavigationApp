// @ts-check
// Base layers can be pulled from (or restored to) the shipped app through the gist: each
// non-CVFR layer hangs on a layerEnabled* tunable. Helicopters ships hidden -- the chart
// is not good enough yet, and its dataset is the thinnest.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof layers !== 'undefined' && typeof rebuildLayerPicker === 'function');
}

const pickerNames = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('#layer-select option'))
    .filter(o => !o.disabled).map(o => o.value));

test('Helicopters is not offered by default; the rest are', async ({ page }) => {
  await boot(page);
  const names = await pickerNames(page);
  expect(names).not.toContain('Helicopters');
  for (const n of ['CVFR', 'Low Alt', 'Navigation', 'Satellite', 'OpenStreetMap']) {
    expect(names).toContain(n);
  }
});

test('the gist can offer it back, and pull others', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    setTune('layerEnabledHelicopters', 1);
    setTune('layerEnabledOpenStreetMap', 0);
    rebuildLayerPicker();                       // what the post-gist hook calls
  });
  const names = await pickerNames(page);
  expect(names).toContain('Helicopters');
  expect(names).not.toContain('OpenStreetMap');
});

test('pulling the ACTIVE layer lands the map on CVFR, datasets and all', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const sel = document.getElementById('layer-select');
    sel.value = 'Low Alt';
    sel.onchange();
  });
  await page.evaluate(() => { setTune('layerEnabledLowAlt', 0); rebuildLayerPicker(); });
  const active = await page.evaluate(() => currentLayerName());
  expect(active).toBe('CVFR');
  await page.evaluate(() => { setTune('layerEnabledLowAlt', 1); });   // restore for other tests
});

test('a saved hidden layer does not resurrect from localStorage', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1');
      localStorage.setItem('navaid.layer', 'Helicopters');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof layers !== 'undefined' && typeof currentLayerName === 'function');
  expect(await page.evaluate(() => currentLayerName())).toBe('CVFR');
});

test('CVFR cannot be configured away', async ({ page }) => {
  await boot(page);
  const offered = await page.evaluate(() => layerOffered('CVFR'));
  expect(offered).toBe(true);                    // no tunable gates it, by design
});
