// @ts-check
// Reported: in the waypoint zoom view, the ATS routes chart (ENR 6.1) showed "something
// unrelated" -- the whole sheet, small, repeated across the map. ATS is a single reprojected
// image placed by its bounds (an imageOverlay); the view copied every layer as a tile layer, so
// that one URL was fetched for every 256 px tile. It must stay one image on the same bounds.
const { test, expect } = require('./_setup');

test('the zoom view draws the ATS chart as one image on its own bounds, not as tiles', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showSatellitePreviewModal === 'function'
    && typeof clearBootLoading === 'function' && typeof layers === 'object' && !!layers.ATS);
  await page.evaluate(() => showSatellitePreviewModal({ lat: 31.79, lng: 35.457 }, 'ALMOG'));
  await page.waitForFunction(() => !!document.querySelector('.satellite-layer-select'));
  await page.selectOption('.satellite-layer-select', 'ATS');
  const r = await page.evaluate(() => {
    const lm = window.__satModalMap;
    let ats = null;
    lm.eachLayer((l) => { if (l._url && /ats-routes\.png/.test(l._url)) ats = l; });
    const main = layers.ATS.getBounds();
    return {
      found: !!ats,
      image: !!ats && ats instanceof L.ImageOverlay,
      tiles: !!ats && ats instanceof L.TileLayer,
      sameBounds: !!ats && ats.getBounds && ats.getBounds().equals(main),
      imgs: document.querySelectorAll('.satellite-preview-map img[src*="ats-routes.png"]').length,
      zoom: lm.getZoom(),
      maxZoom: lm.getMaxZoom(),
      cap: tune('satelliteAtsNativeZoom') + tune('satelliteChartOverscale'),
    };
  });
  // At z17 a ~107 m/px sheet is a blank patch of a few pixels: like the tiled charts, the view
  // stops at the chart's own resolution plus the overscale, and switching to it zooms out there.
  expect(r).toEqual({ found: true, image: true, tiles: false, sameBounds: true, imgs: 1,
    zoom: r.cap, maxZoom: r.cap, cap: r.cap });
});
