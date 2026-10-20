// @ts-check
// Asked: "can the airfield from legend match the map? resize with zoom". Zoomed out the field is
// its fixed-size symbol; zoomed in, its real runway is drawn to scale, where it is on the ground.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 800, height: 600 } });

test('LLHZ: the symbol far out, the true runway (to scale) close in', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && Array.isArray(airfields) && airfields.length);
  const spans = await page.evaluate(async () => {
    const af = airfields.find(a => a.name === 'LLHZ');
    const out = {};
    for (const z of [10, 15]) {
      map.setView([af.lat, af.lng], z, { animate: false });
      // What drawTrueRunways would take: the runway on screen against the symbol's own length.
      const [a1, o1, a2, o2] = af.runwayGeom[0];
      const p = map.latLngToContainerPoint([a1, o1]), q = map.latLngToContainerPoint([a2, o2]);
      out[z] = { runwayPx: Math.hypot(q.x - p.x, q.y - p.y), symbolPx: tune('airfieldMarkerRadiusPx') * 3.6 };
    }
    return out;
  });
  expect(spans[10].runwayPx).toBeLessThan(spans[10].symbolPx);    // far: the symbol is drawn
  expect(spans[15].runwayPx).toBeGreaterThan(spans[15].symbolPx); // close: the runway itself
  // And it is drawn, light inside, along the line it belongs on: the chart's own bar on the CVFR
  // chart ("match square to map"), the real runway on satellite.
  const lightAt = (geomKey, layer) => page.evaluate(([geomKey, layer]) => {
    const sel = document.getElementById('layer-select');
    if (sel.value !== layer) { sel.value = layer; sel.dispatchEvent(new Event('change')); }
    const af = airfields.find(a => a.name === 'LLHZ');
    map.setView([af.lat, af.lng], 15, { animate: false }); draw();
    const [a1, o1, a2, o2] = af[geomKey][0];
    const p = map.latLngToContainerPoint([a1 + (a2 - a1) * 0.5, o1 + (o2 - o1) * 0.5]);
    const c = octx.canvas, k = c.width / c.clientWidth;
    const d = octx.getImageData(Math.round(p.x * k) - 3, Math.round(p.y * k) - 3, 7, 7).data;
    let light = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) light++;
    return light;
  }, [geomKey, layer]);
  expect(await lightAt('runwayChart', 'CVFR')).toBeGreaterThan(10);
  expect(await lightAt('runwayGeom', 'Satellite')).toBeGreaterThan(10);
});
