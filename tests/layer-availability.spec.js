// @ts-check
// Base layers can be pulled from (or restored to) the shipped app through the gist: each
// non-CVFR layer hangs on a layerEnabled* tunable. All ship offered; the maintainer pulls
// one with a gist edit (layerEnabled<Name>: 0), not a build.
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

test('every layer is offered by default', async ({ page }) => {
  await boot(page);
  const names = await pickerNames(page);
  for (const n of ['CVFR', 'Low Alt', 'Helicopters', 'Navigation', 'Satellite', 'OpenStreetMap']) {
    expect(names).toContain(n);
  }
});

test('the gist can pull layers', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    setTune('layerEnabledHelicopters', 0);
    setTune('layerEnabledOpenStreetMap', 0);
    rebuildLayerPicker();                       // what the post-gist hook calls
  });
  const names = await pickerNames(page);
  expect(names).not.toContain('Helicopters');
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

test('a saved layer that the gist pulled does not resurrect from localStorage', async ({ page }) => {
  // Simulate the gist having pulled Helicopters before boot completes: the saved-layer
  // restore consults layerOffered(), so the hidden chart must not come back from storage.
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1');
      localStorage.setItem('navaid.layer', 'Helicopters');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof layers !== 'undefined' && typeof rebuildLayerPicker === 'function');
  await page.evaluate(() => { setTune('layerEnabledHelicopters', 0); rebuildLayerPicker(); });
  expect(await page.evaluate(() => currentLayerName())).toBe('CVFR');
});

test('CVFR cannot be configured away', async ({ page }) => {
  await boot(page);
  const offered = await page.evaluate(() => layerOffered('CVFR'));
  expect(offered).toBe(true);                    // no tunable gates it, by design
});
