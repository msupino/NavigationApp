// @ts-check
// Reported on a phone: in the waypoint zoom view the layer picker sat fine, but zoom, the dial,
// reset and the map credit were stacked up the middle of the map, over the place being looked at.
// The deck's rules for the MAIN map's bottom-right column (a bottom margin for the deck bar, a
// 12-button flex column) and its bottom-left lift applied to this second Leaflet map too.
const { test, expect } = require('./_setup');

async function open(page) {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showSatellitePreviewModal === 'function'
    && typeof clearBootLoading === 'function');
  await page.evaluate(() => showSatellitePreviewModal({ lat: 31.82, lng: 35.388 }, 'YRIHO / מצפה יריחו'));
  await page.waitForFunction(() => !!document.querySelector('.satellite-preview-map .leaflet-control-zoom'));
}

const gaps = (page) => page.evaluate(() => {
  const m = document.querySelector('.satellite-preview-map').getBoundingClientRect();
  const box = (s) => document.querySelector('.satellite-preview-map ' + s).getBoundingClientRect();
  return {
    deck: document.body.classList.contains('deck-on'),
    rightCorner: Math.round(m.bottom - box('.leaflet-bottom.leaflet-right').bottom),
    leftCorner: Math.round(m.bottom - box('.leaflet-bottom.leaflet-left').bottom),
    zoomFromBottom: Math.round(m.bottom - box('.leaflet-control-zoom').bottom),
    zoomFromRight: Math.round(m.right - box('.leaflet-control-zoom').right),
    // the bottom-right controls' union: on the phone one row along the bottom
    ctrlTop: Math.round(Math.min(...['.leaflet-control-zoom', '.satellite-rotate-ctrl', '.satellite-reset-control']
      .map(s => box(s).top)) - m.top),
    mapH: Math.round(m.height),
  };
});

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`zoom view controls sit in the map's own corners (${vp.width}x${vp.height})`, async ({ page }) => {
    await page.setViewportSize(vp);
    await open(page);
    const g = await gaps(page);
    if (vp.width < 600) expect(g.deck, 'the phone runs the deck').toBe(true);
    expect(g.rightCorner, 'bottom-right corner reaches the map bottom').toBeLessThanOrEqual(1);
    expect(g.leftCorner, 'bottom-left corner reaches the map bottom').toBeLessThanOrEqual(1);
    // The zoom bar is the lowest control on the right: above the credit line only.
    expect(g.zoomFromBottom).toBeLessThanOrEqual(30);
    expect(g.zoomFromRight).toBeLessThanOrEqual(16);
    // Reported again: in a column the 44 px controls still covered a third of the phone's map.
    // On the deck they make one row, so they take only the bottom strip.
    if (g.deck) expect(g.mapH - g.ctrlTop, 'controls take one bottom strip').toBeLessThanOrEqual(80);
  });
}
