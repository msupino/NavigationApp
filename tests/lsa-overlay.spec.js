// @ts-check
// LSA reporting-point overlay: renders data/lsa-waypoints.json as cyan
// triangles, only on the Low Alt base layer.
const { test, expect } = require('./_setup');

test('LSA waypoints draw only on the Low Alt layer', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof loadLsaWaypoints === 'function');
  const r = await page.evaluate(async () => {
    await loadLsaWaypoints();
    map.setView([32.0, 34.9], 9);
    const drawn = () => {
      let n = 0; const orig = octx.moveTo;
      octx.moveTo = function (...a) { n++; return orig.apply(this, a); };
      drawLsaWaypoints();
      octx.moveTo = orig; return n;
    };
    const setL = k => { for (const x in layers) if (map.hasLayer(layers[x])) map.removeLayer(layers[x]); map.addLayer(layers[k]); };
    setL('CVFR'); const onCvfr = drawn();
    setL('Low Alt'); const onLsa = drawn();
    return { onCvfr, onLsa, count: lsaWP.length };
  });
  expect(r.count).toBeGreaterThan(50);   // ~88 points
  expect(r.onLsa).toBeGreaterThan(0);    // triangles drawn on Low Alt
  expect(r.onCvfr).toBe(0);              // nothing off the LSA layer
});
