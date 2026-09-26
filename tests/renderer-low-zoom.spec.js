// @ts-check
// Vector layers stay on their coordinates at every zoom and bearing. leaflet-rotate positioned
// its renderers through a latitude round-trip that clamps at +-85, so once the map could zoom out
// to a continent, a renderer whose padded bounds reached past the top of the world was drawn
// hundreds of pixels too low -- coastlines a country away from their names.
const { test, expect } = require('./_setup');

test('a vector shape sits on its coordinates at every zoom and bearing', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 800 });
  await page.goto('?lang=en&nogist&deck=0');
  await page.waitForFunction(() => typeof map !== 'undefined' && map.setBearing);
  const errs = await page.evaluate(async () => {
    const svg = L.svg({ padding: 0.5 });
    const dot = L.circleMarker([32, 35], { renderer: svg, radius: 6 }).addTo(map);
    const out = [];
    for (const bearing of [0, 40]) {
      for (const z of [9, 6, 4, 3, 2.5, 2]) {
        map.setBearing(bearing);
        map.setView([32.1, 34.95], z, { animate: false });
        // Near the top of the screen: zoomed out, that is far north -- where the clamp bit.
        const target = map.containerPointToLatLng([215, 120]);
        dot.setLatLng(target);
        await new Promise(r => setTimeout(r, 50));
        const b = dot._path.getBoundingClientRect();
        const c = map.getContainer().getBoundingClientRect();
        const want = map.latLngToContainerPoint(target);
        out.push({ bearing, z, dx: Math.round(b.left + b.width / 2 - c.left - want.x),
          dy: Math.round(b.top + b.height / 2 - c.top - want.y) });
      }
    }
    dot.remove();
    return out;
  });
  for (const e of errs) {
    expect(Math.abs(e.dx), JSON.stringify(e)).toBeLessThanOrEqual(2);
    expect(Math.abs(e.dy), JSON.stringify(e)).toBeLessThanOrEqual(2);
  }
});
