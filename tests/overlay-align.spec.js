// @ts-check
// Overlay align editor: pan / scale / rotate a shown chart overlay, persist the
// result as a per-PNG localStorage override, and render it back (rotated when
// rotation was applied). Toggled from the "Extra layers" toolbar section.
const { test, expect } = require('./_setup');

// Block the SW so overlay-img requests are stubbable and deterministic.
test.use({ serviceWorkers: 'block' });

const IMG_RE = /(training|circuit|cvfr|heli|commfail)-img\/.*\.png/;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64'
);
const OV_KEY = 'navaid.overlayBoundsOverrides';

async function boot(page, initScript, query) {
  await page.route(IMG_RE, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  if (initScript) await page.addInitScript(initScript);
  await page.goto(query || '?lang=en');
  await page.waitForFunction(
    () => typeof map !== 'undefined' && !!window.airfields &&
          typeof window.overlayAlign === 'object');
}

test('align toggle is hidden without ?align=1, revealed and functional with it', async ({ page }) => {
  await boot(page);   // no ?align=1
  await expect(page.locator('#overlay-align-group')).toBeHidden();
  await boot(page, null, '?lang=en&align=1');
  await expect(page.locator('#overlay-align-group')).toBeVisible();
  await page.locator('#overlay-align-cb').check();
  await expect(page.locator('.ov-align-panel')).toBeVisible();
  await page.locator('#overlay-align-cb').uncheck();
  await expect(page.locator('.ov-align-panel')).toHaveCount(0);
});

test('Align-overlays button opens and closes the editor panel', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.ov-align-panel')).toHaveCount(0);
  await page.evaluate(() => window.overlayAlign.enter());
  await expect(page.locator('.ov-align-panel')).toBeVisible();
  await page.locator('.ov-align-panel .ov-done').click();
  await expect(page.locator('.ov-align-panel')).toHaveCount(0);
});

test('selecting an overlay and panning saves a shifted rect override', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    window.showTraining = true;
    loadTrainingOverlays();
    trainingLayerGroup.addTo(map);
    window.overlayAlign.enter();
    // select LLHZ training by clicking its centre
    const af = airfields.find(a => a.name === 'LLHZ');
    const to = af.training_overlay;
    const c = [(to.sw[0] + to.ne[0]) / 2, (to.sw[1] + to.ne[1]) / 2];
    map.setView(c, 10);
    map.fire('click', { latlng: L.latLng(c[0], c[1]),
                        originalEvent: { target: document.body } });
    // find the centre handle marker and drag it +0.03 lat / +0.02 lng
    let ctr = null;
    map.eachLayer(l => {
      if (l instanceof L.Marker && l.options.icon &&
          /ov-h-center/.test(l.options.icon.options.className || '')) ctr = l;
    });
    if (ctr) {
      ctr.setLatLng(L.latLng(c[0] + 0.03, c[1] + 0.02));
      ctr.fire('drag', { target: ctr });
      ctr.fire('dragend', { target: ctr });
    }
    const ov = JSON.parse(localStorage.getItem('navaid.overlayBoundsOverrides') || '{}');
    return { sel: document.querySelector('.ov-sel').textContent,
             hadCtr: !!ctr, ov: ov['LLHZ_training.png'],
             baseCenter: c };
  });
  expect(out.sel).toContain('LLHZ_training.png');
  expect(out.hadCtr).toBe(true);
  expect(out.ov).toBeTruthy();
  expect(out.ov.sw).toBeTruthy();
  // centre moved +0.03 lat / +0.02 lng
  const newCenterLat = (out.ov.sw[0] + out.ov.ne[0]) / 2;
  const newCenterLng = (out.ov.sw[1] + out.ov.ne[1]) / 2;
  expect(newCenterLat).toBeCloseTo(out.baseCenter[0] + 0.03, 2);
  expect(newCenterLng).toBeCloseTo(out.baseCenter[1] + 0.02, 2);
});

test('a saved rotated override renders the overlay as a rotated image', async ({ page }) => {
  await boot(page, () => {
    localStorage.setItem('navaid.overlayBoundsOverrides', JSON.stringify({
      'LLHZ_training.png': { tl: [32.60, 34.72], tr: [32.62, 35.10], bl: [32.10, 34.70] },
    }));
    localStorage.setItem('navaid.showTraining', '1');
  });
  const res = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 100));
    let found = null;
    trainingLayerGroup.eachLayer(l => { if (l._ovPng === 'LLHZ_training.png') found = l; });
    return { found: !!found, rotated: !!(found && found instanceof L.ImageOverlay.Rotated) };
  });
  expect(res.found).toBe(true);
  expect(res.rotated).toBe(true);
});

test('Reset all clears every stored override', async ({ page }) => {
  await boot(page, () => {
    localStorage.setItem('navaid.overlayBoundsOverrides', JSON.stringify({
      'LLHZ_training.png': { sw: [32.1, 34.7], ne: [32.5, 35.1] },
    }));
  });
  page.on('dialog', d => d.accept());
  await page.evaluate(() => window.overlayAlign.enter());
  await page.locator('.ov-align-panel .ov-reset-all').click();
  const remaining = await page.evaluate(
    (k) => localStorage.getItem(k), OV_KEY);
  expect(remaining).toBeNull();
});
