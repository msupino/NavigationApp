// @ts-check
// Which chart the nav data comes from. layerDataPrefix() used to fall through to 'cvfr'
// for Satellite / OSM / Navigation, so on those layers the LSA and helicopter waypoint
// sets were unreachable even though both ship (CVFR 172, LSA 138, Heli 184 points).
const { test, expect } = require('./_setup');
const { showToolbarControl } = require('./_toolbar');

async function boot(page, { withHeli = true } = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof layerDataPrefix === 'function' &&
    typeof reloadLayerDatasets === 'function');
  // Helicopters ships switched OFF (layerEnabledHelicopters), and the picker only lists
  // charts the app offers -- so a test about helicopter waypoints has to turn the chart on,
  // exactly as a gist would. See navwp-source-offered.spec.js for the gate itself.
  if (withHeli) {
    await page.evaluate(() => {
      setTune('layerEnabledHelicopters', true);
      if (typeof window.rebuildNavWpSource === 'function') window.rebuildNavWpSource();
      if (typeof rebuildLayerPicker === 'function') rebuildLayerPicker();
    });
  }
}

const setLayer = (page, name) => page.evaluate(n => {
  for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
  map.addLayer(layers[n]);
}, name);

test('the picker offers Follow chart plus every chart on offer', async ({ page }) => {
  await boot(page);
  await showToolbarControl(page, '#navwp-source');
  const r = await page.evaluate(() => {
    const sel = document.getElementById('navwp-source');
    return { values: [...sel.options].map(o => o.value),
      labels: [...sel.options].map(o => o.textContent),
      selected: sel.value,
      label: sel.closest('.navtoggle').textContent.trim().split('\n')[0] };
  });
  expect(r.values).toEqual(['', 'cvfr', 'lsa', 'heli']);
  expect(r.labels[0]).toMatch(/Follow chart/);
  expect(r.selected).toBe('');                 // default: follow the base layer
  expect(r.label).toMatch(/Nav waypoints from/);
});

test('Follow chart keeps the old per-layer behaviour', async ({ page }) => {
  await boot(page);
  const r = {};
  for (const [layer, want] of [['CVFR', 'cvfr'], ['Low Alt', 'lsa'], ['Helicopters', 'heli'],
    ['Satellite', 'cvfr'], ['OpenStreetMap', 'cvfr'], ['Navigation', 'cvfr']]) {
    await setLayer(page, layer);
    r[layer] = await page.evaluate(() => layerDataPrefix());
    expect(r[layer], layer).toBe(want);
  }
});

test('an explicit choice wins on Satellite — the reported gap', async ({ page }) => {
  await boot(page);
  await setLayer(page, 'Satellite');
  expect(await page.evaluate(() => layerDataPrefix())).toBe('cvfr');
  const r = await page.evaluate(async () => {
    const sel = document.getElementById('navwp-source');
    sel.value = 'heli';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(res => setTimeout(res, 50));
    return { prefix: layerDataPrefix(), global: navDataPrefix,
      stored: localStorage.getItem('navaid.navDataPrefix') };
  });
  expect(r.prefix).toBe('heli');
  expect(r.global).toBe('heli');
  expect(r.stored).toBe('heli');
});

test('choosing a source actually loads that chart\'s waypoints', async ({ page }) => {
  await boot(page);
  await setLayer(page, 'Satellite');
  const r = await page.evaluate(async () => {
    const count = async () => { await reloadLayerDatasets(); await loadNavWaypoints();
      return Array.isArray(navWP) ? navWP.length : null; };
    const sel = document.getElementById('navwp-source');
    window.showNavWP = true;
    sel.value = 'cvfr'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const cvfr = await count();
    sel.value = 'lsa'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const lsa = await count();
    sel.value = 'heli'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const heli = await count();
    return { cvfr, lsa, heli };
  });
  // three distinct datasets, so the counts differ
  expect(r.cvfr).toBeGreaterThan(0);
  expect(r.lsa).toBeGreaterThan(0);
  expect(r.heli).toBeGreaterThan(0);
  expect(new Set([r.cvfr, r.lsa, r.heli]).size).toBe(3);
});

test('the choice moves comm-change and leg altitudes with it, not just waypoints', async ({ page }) => {
  // Waypoints from one chart with another chart's altitude table would be a wrong plan.
  await boot(page);
  await setLayer(page, 'Satellite');
  const r = await page.evaluate(async () => {
    window.showNavWP = true; window.showCommChange = true;
    const sel = document.getElementById('navwp-source');
    const snap = async () => {
      await reloadLayerDatasets();
      await Promise.all([loadNavWaypoints(), loadCommChange(), loadLegAltitudes()]);
      return { prefix: layerDataPrefix(),
        cc: commChangeMap ? Object.keys(commChangeMap).length : null,
        alt: legAltitudeMap ? Object.keys(legAltitudeMap).length : null };
    };
    sel.value = 'cvfr'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const cvfr = await snap();
    sel.value = 'heli'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const heli = await snap();
    return { cvfr, heli };
  });
  expect(r.cvfr.prefix).toBe('cvfr');
  expect(r.heli.prefix).toBe('heli');
  // the comm-change and altitude tables changed too
  expect(r.heli.cc).not.toBe(r.cvfr.cc);
  expect(r.heli.alt).not.toBe(r.cvfr.alt);
});

test('the choice survives a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const sel = document.getElementById('navwp-source');
    sel.value = 'lsa';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.reload();
  await page.waitForFunction(() => typeof layerDataPrefix === 'function');
  const r = await page.evaluate(() => ({ prefix: layerDataPrefix(), global: navDataPrefix,
    sel: document.getElementById('navwp-source').value }));
  expect(r.prefix).toBe('lsa');
  expect(r.global).toBe('lsa');
  expect(r.sel).toBe('lsa');
});

test('switching back to Follow chart clears the override', async ({ page }) => {
  await boot(page);
  await setLayer(page, 'CVFR');
  const r = await page.evaluate(async () => {
    const sel = document.getElementById('navwp-source');
    sel.value = 'heli'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const overridden = layerDataPrefix();
    sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(res => setTimeout(res, 50));
    return { overridden, followed: layerDataPrefix(), global: navDataPrefix,
      stored: localStorage.getItem('navaid.navDataPrefix') };
  });
  expect(r.overridden).toBe('heli');
  expect(r.followed).toBe('cvfr');             // back to the base layer
  expect(r.global).toBeNull();
  expect(r.stored).toBeNull();
});
