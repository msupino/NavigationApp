// @ts-check
// Asked for: "in the inspector of an airfield, allow adding the extra layers which are available
// for it". The plate layers -- circuit, training, CVFR, helicopter, comm-failure, aerodrome chart
// and the instrument sheets -- were only reachable from the toolbar, one family at a time for
// every field. The airfield's own panel now offers the ones that field publishes, as one choice.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof loadAirfields === 'function');
  await page.evaluate(() => loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && airfields.length > 0);
}
async function inspect(page, icao) {
  await page.evaluate((code) => {
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === code) };
    showInspector();
  }, icao);
  await expect(page.locator('#inspector')).toBeVisible();
}
const optionValues = (page) => page.locator('#insp-af-layer option')
  .evaluateAll(os => os.map(o => o.value));

test('the panel lists only the layers this field publishes', async ({ page }) => {
  await boot(page);
  const want = await page.evaluate(() => {
    const af = airfields.find(a => a.name === 'LLHZ');
    const kinds = { circuit_overlay: 'circuit-cb', training_overlay: 'training-cb', cvfr_overlay: 'cvfr-cb',
      heli_overlay: 'heli-cb', commfail_overlay: 'commfail-cb', adc_overlay: 'adc-cb' };
    return [''].concat(Object.keys(kinds).filter(k => af[k]).map(k => kinds[k]))
      .concat((af.ifr_overlays || []).map(s => 'ifr|LLHZ|' + s.png));
  });
  await inspect(page, 'LLHZ');
  expect(await optionValues(page)).toEqual(want);
  await expect(page.locator('#insp-af-layer')).toHaveValue('');

  // A field with fewer plates offers fewer.
  await inspect(page, 'LLBO');
  expect(await optionValues(page)).toEqual(['', 'circuit-cb', 'cvfr-cb']);
});

test('a field with nothing to lay on the map has no layer row', async ({ page }) => {
  await boot(page);
  const bare = await page.evaluate(() => {
    const keys = ['circuit_overlay', 'training_overlay', 'cvfr_overlay', 'heli_overlay', 'commfail_overlay', 'adc_overlay'];
    const af = airfields.find(a => a.name && !keys.some(k => a[k]) && !(a.ifr_overlays || []).length);
    return af && af.name;
  });
  expect(bare).toBeTruthy();
  await inspect(page, bare);
  await expect(page.locator('#insp-af-layer')).toHaveCount(0);
});

test('choosing a layer draws this field\'s sheet; None takes it off', async ({ page }) => {
  await boot(page);
  await inspect(page, 'LLHZ');
  await page.locator('#insp-af-layer').selectOption('cvfr-cb');
  await expect.poll(() => page.evaluate(() => !!(window.cvfrLayerGroup && map.hasLayer(cvfrLayerGroup)))).toBe(true);
  const on = await page.evaluate(() => ({
    cb: document.getElementById('cvfr-cb').checked,
    filter: window.plateAirfield,
    shown: airfieldLayerShown(airfields.find(a => a.name === 'LLHZ')),
    toolbar: document.getElementById('plate-enabled-cb').checked,
  }));
  // The field's sheet, not every field's: the airfield filter follows, and the toolbar
  // picker shows the same layer on.
  expect(on).toEqual({ cb: true, filter: 'LLHZ', shown: 'cvfr-cb', toolbar: true });

  await page.locator('#insp-af-layer').selectOption('');
  await expect.poll(() => page.evaluate(() => document.getElementById('cvfr-cb').checked)).toBe(false);
  expect(await page.evaluate(() => !!(window.cvfrLayerGroup && map.hasLayer(cvfrLayerGroup)))).toBe(false);
});

test('an instrument sheet is offered by name and drawn when chosen', async ({ page }) => {
  await boot(page);
  await inspect(page, 'LLIB');
  const ifr = (await optionValues(page)).filter(v => v.indexOf('ifr|LLIB|') === 0);
  expect(ifr.length).toBeGreaterThan(0);
  await page.locator('#insp-af-layer').selectOption(ifr[0]);
  await expect.poll(() => page.evaluate(() => document.getElementById('ifr-cb').checked)).toBe(true);
  const r = await page.evaluate(() => ({ chosen: ifrChosen() && ifrChosen().icao,
    key: 'ifr|' + ifrKeyOf(ifrChosen()) }));
  expect(r.chosen).toBe('LLIB');
  expect(r.key).toBe(ifr[0]);
});

test('Hebrew: the row and its choices are in Hebrew', async ({ page }) => {
  await boot(page, 'he');
  await inspect(page, 'LLHZ');
  const row = page.locator('.airfield-layers-row');
  await expect(row.locator('label')).toHaveText('שכבות שדה');
  await expect(row.locator('option').first()).toHaveText('— ללא —');
  await expect(row.locator('option[value="cvfr-cb"]')).toHaveText('נתיבי כניסה/יציאה CVFR');
});

// The panel follows the map: closing the layer anywhere else -- its ✕, the toolbar -- reads as
// off here, rather than the choice still naming a sheet that is gone.
test('closing the layer elsewhere shows None in the open panel', async ({ page }) => {
  await boot(page);
  await inspect(page, 'LLHZ');
  await page.locator('#insp-af-layer').selectOption('circuit-cb');
  await expect.poll(() => page.evaluate(() => document.getElementById('circuit-cb').checked)).toBe(true);
  await page.evaluate(() => {
    const cb = document.getElementById('circuit-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#insp-af-layer')).toHaveValue('');
});

// Reviewed with the ui-ux-pro-max checklist (compact label overflow): the choice names layers in
// words, and the 110px width the number fields use clipped them.
test('the choice is wide enough for the layer names', async ({ page }) => {
  await boot(page);
  await inspect(page, 'LLHZ');
  const w = await page.locator('#insp-af-layer').evaluate(e => e.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(130);
});

test('English: the row is labelled Airfield layer', async ({ page }) => {
  await boot(page);
  await inspect(page, 'LLHZ');
  await expect(page.locator('.airfield-layers-row label')).toHaveText('Airfield layer');
});

// Reported: the NOTAM row, the charts entry and the layer row were three designs -- a link, a
// big button under its own divider, a dropdown with its own placeholder. One group now: each a
// label with its control at the end, the charts one a link like the NOTAM one.
test('NOTAMs, charts and layers share one layout', async ({ page }) => {
  await boot(page, 'he');
  await inspect(page, 'LLHZ');
  const r = await page.evaluate(() => {
    const g = document.querySelector('#insp-body .airfield-refs');
    const rows = g ? Array.from(g.children).map(x => x.className) : [];
    const charts = g && g.querySelector('.insp-charts-btn');
    const notam = g && g.querySelector('.notam-insp-row label');
    const notamLink = g && g.querySelector('.insp-notam-link');
    const layerLabel = g && g.querySelector('.airfield-layers-row label');
    const font = (el) => el && getComputedStyle(el).fontSize;
    return {
      rows,
      // Looks like the NOTAM link (same colour and underline), without sharing its class.
      chartsIsLink: !!charts && !!notamLink && getComputedStyle(charts).color === getComputedStyle(notamLink).color
        && getComputedStyle(charts).textDecorationLine === 'underline'
        && !charts.classList.contains('insp-notam-link'),
      chartsText: charts && charts.textContent.trim(),
      chartsIcon: !!(charts && charts.querySelector('.mi-icon svg')),
      labelsMatch: !!notam && font(notam) === font(layerLabel),
      none: document.querySelector('#insp-af-layer option').textContent,
      vorNone: (document.querySelector('.insp-vor-ref option') || {}).textContent,
    };
  });
  expect(r.rows).toEqual(['row notam-insp-row', 'row plates-row', 'row airfield-layers-row']);
  expect(r.chartsIsLink).toBe(true);
  // The app dresses a button's leading glyph as an SVG icon (ui.js dressByGlyph), so the
  // link reads "הצג 13" behind the charts icon, not the raw emoji.
  expect(r.chartsText).toMatch(/^הצג \d+$/);
  expect(r.chartsIcon).toBe(true);
  expect(r.labelsMatch).toBe(true);
  // The empty choice reads like the reference-VOR one above it.
  expect(r.none).toBe(r.vorNone);
});

// ui-ux-pro-max review: the links are this group's controls, and an inline 12px link is about
// 16px tall -- below the 24px WCAG 2.2 target size, and well below the 36px button the charts
// entry used to be.
test('the group\'s links are at least the WCAG target size', async ({ page }) => {
  await boot(page);
  await inspect(page, 'LLHZ');
  const hs = await page.locator('#insp-body .airfield-refs :is(.insp-notam-link, .insp-charts-btn)')
    .evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
  expect(hs.length).toBeGreaterThan(0);
  for (const h of hs) expect(h).toBeGreaterThanOrEqual(24);
});
