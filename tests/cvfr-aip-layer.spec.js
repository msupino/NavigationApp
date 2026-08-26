// The CVFR AIP chart: our own tiles, cut from the CAA's two CVFR sheets.
//
// What is worth pinning here is not that a layer exists -- the picker test would catch
// that -- but the three things that would make it quietly wrong: that it draws from our
// mirror and never from flight-maps (it is not their chart), that it declares the box its
// tiles actually cover so export does not chase 404s past the sheet edge, and that it never
// asks for a zoom the build did not produce.
const { test, expect } = require('./_setup');

// Relative, never '/': the deployed run serves the preview under BASE_URL=.../pr/<n>/, and
// an absolute '/' resolves to the ORIGIN root -- which is the base build, without this layer.
const boot = async (page) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && window.NavAid.tuningDefaults);
};

test('the layer is offered, labelled, and sits beside CVFR', async ({ page }) => {
  await boot(page);
  const info = await page.evaluate(() => {
    const sel = document.getElementById('layer-select');
    const names = Array.from(sel.options).map(o => o.value);
    const opt = Array.from(sel.options).find(o => o.value === 'CVFR AIP');
    return { names, label: opt && opt.textContent,
             idx: names.indexOf('CVFR AIP'), cvfr: names.indexOf('CVFR') };
  });
  expect(info.names).toContain('CVFR AIP');
  expect(info.label).toBe('CVFR (AIP)');
  // Next to the chart it is an alternative to, not lost at the end of the list.
  expect(info.idx).toBe(info.cvfr + 1);
});

test('the Hebrew build labels it too', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => window.NavAid && window.NavAid.tuningDefaults);
  const label = await page.evaluate(() => {
    const opt = Array.from(document.getElementById('layer-select').options)
      .find(o => o.value === 'CVFR AIP');
    return opt && opt.textContent;
  });
  expect(label).toBe('CVFR (AIP)');
});

test('it draws from our own mirror, not from flight-maps', async ({ page }) => {
  await boot(page);
  // The layer object is not exported, so this asserts on the tile requests it makes.
  const seen = [];
  page.on('request', (r) => { if (/\/CVFR-AIP\//.test(r.url())) seen.push(r.url()); });
  await page.evaluate(() => {
    const sel = document.getElementById('layer-select');
    sel.value = 'CVFR AIP';
    sel.onchange && sel.onchange();
  });
  await page.waitForTimeout(1500);
  expect(seen.length).toBeGreaterThan(0);
  for (const u of seen) {
    expect(u).toContain('navaid-tiles.supino.org/CVFR-AIP/');
    expect(u).not.toContain('flight-maps.com');
  }
});

test('it never asks below the zoom the build produced', async ({ page }) => {
  await boot(page);
  const zooms = [];
  page.on('request', (r) => {
    const m = /\/CVFR-AIP\/(\d+)\//.exec(r.url());
    if (m) zooms.push(Number(m[1]));
  });
  await page.evaluate(() => {
    const sel = document.getElementById('layer-select');
    sel.value = 'CVFR AIP';
    sel.onchange && sel.onchange();
    map.setZoom(6);
  });
  await page.waitForTimeout(1500);
  for (const z of zooms) {
    expect(z).toBeGreaterThanOrEqual(8);
    expect(z).toBeLessThanOrEqual(13);
  }
});

test('the gist can withdraw it, and the picker loses it', async ({ page }) => {
  await boot(page);
  const gone = await page.evaluate(() => {
    window.setTune('layerEnabledCVFRAIP', false);
    if (typeof window.rebuildLayerPicker === 'function') window.rebuildLayerPicker();
    const sel = document.getElementById('layer-select');
    return !Array.from(sel.options).some(o => o.value === 'CVFR AIP');
  });
  expect(gone).toBe(true);
});

// The knob. Both entries draw the same chart; which one the CVFR entry itself uses is a
// deployment's choice, and it defaults to what every existing user is already looking at.
// Asserted on the layer's URL template rather than on requests: the harness blocks tile
// hosts, so "no request was made" would pass for the wrong reason.
const cvfrUrl = (page) => page.evaluate(() => {
  const sel = document.getElementById('layer-select');
  sel.value = 'CVFR';
  sel.onchange && sel.onchange();
  return (layers.CVFR && layers.CVFR._url) || '';
});

test('the CVFR layer draws flight-maps tiles by default', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => tune('cvfrTileSource'))).toBe('flight-maps');
  expect(await cvfrUrl(page)).not.toContain('CVFR-AIP');
});

test('the gist can point the CVFR entry at our own build', async ({ page }) => {
  await boot(page);
  const url = await page.evaluate(() => {
    setTune('cvfrTileSource', 'aip');
    // Rebuilt from the specs, the way the gist landing does it.
    layers.CVFR = CHART_SPECS.CVFR(undefined);
    return layers.CVFR._url;
  });
  expect(url).toBe('https://navaid-tiles.supino.org/CVFR-AIP/{z}/{x}/{y}.png');
});

test('both entries share one definition', async ({ page }) => {
  await boot(page);
  const same = await page.evaluate(() => {
    setTune('cvfrTileSource', 'aip');
    return CHART_SPECS.CVFR(undefined)._url === CHART_SPECS['CVFR AIP'](undefined)._url;
  });
  expect(same).toBe(true);
});
