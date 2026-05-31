// @ts-check
// Regression for the loupe-vs-map misalignment under map rotation.
//
// The magnifier clones base/hi-res tiles from `.leaflet-rotate-pane` (their
// transforms are in that pane's LOCAL, unrotated space) but captures the
// route overlay canvas in rotated CONTAINER space. Before the fix the loupe
// placed both with only the map-pane translate, so a rotated map showed the
// overlay (dots/lines) drifting off the underlying tiles. The fix wraps the
// cloned tiles in a div carrying the rotate-pane matrix and runs the loupe
// transform in pure container space.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(
    () => typeof map !== 'undefined' && typeof toggleMagnifier === 'function');
}

// Drive the loupe at x1 with a fixed cursor and report, for a latlng that is
// NOT under the cursor, the gap between where it renders on the real map and
// where it renders inside the loupe (overlay/container path).
async function gapAt(page, bearing) {
  return await page.evaluate(async (bearing) => {
    map.setBearing(bearing);
    map.setView([32.0, 34.85], 13, { animate: false });
    window.magnifierZoom = 1;
    const mapRect = map.getContainer().getBoundingClientRect();
    const cpt = map.latLngToContainerPoint(L.latLng(32.0, 34.85));
    const cur = { x: mapRect.left + cpt.x, y: mapRect.top + cpt.y };
    if (!magnifierOn) toggleMagnifier();
    window.magnifierZoom = 1;
    _magX = cur.x; _magY = cur.y;
    const mag = document.getElementById('magnifier');
    mag.style.left = (_magX - 200) + 'px';
    mag.style.top = (_magY - 200) + 'px';
    _magDirty = true; rebuildMagnifier(); applyMagnifierTransform();
    await new Promise(r => requestAnimationFrame(r));

    const wp = map.latLngToContainerPoint(L.latLng(32.02, 34.90));
    const real = { x: mapRect.left + wp.x, y: mapRect.top + wp.y };
    const content = document.getElementById('mag-content');
    const m = new DOMMatrixReadOnly(getComputedStyle(content).transform);
    const magRect = mag.getBoundingClientRect();
    const p = m.transformPoint(new DOMPoint(wp.x, wp.y));
    const loupe = { x: magRect.left + p.x, y: magRect.top + p.y };
    return Math.hypot(loupe.x - real.x, loupe.y - real.y);
  }, bearing);
}

test.describe('Magnifier alignment under rotation', () => {
  test('overlay/map point aligns in the loupe at x1, bearing 0/30/45', async ({ page }) => {
    await boot(page);
    for (const b of [0, 30, 45]) {
      const gap = await gapAt(page, b);
      // Sub-pixel rounding aside, the loupe must place the point exactly
      // where the real map does, at every bearing.
      expect(gap).toBeLessThan(1.5);
    }
  });

  test('cloned tiles are wrapped in the rotate-pane matrix', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      map.setBearing(30);
      map.setView([32.0, 34.85], 13, { animate: false });
      if (!magnifierOn) toggleMagnifier();
      _magX = 640; _magY = 360; _magDirty = true; rebuildMagnifier();
      const content = document.getElementById('mag-content');
      // First child div = tileWrap; it must carry the rotate-pane transform
      // so the local-space tile clones land in rotated container space.
      const wrap = content.querySelector('div');
      const pane = document.querySelector('.leaflet-rotate-pane');
      return {
        wrapT: wrap ? getComputedStyle(wrap).transform : null,
        paneT: pane ? getComputedStyle(pane).transform : null,
        hasTiles: !!(wrap && wrap.querySelector('img')),
      };
    });
    expect(r.paneT).not.toBe('matrix(1, 0, 0, 1, 0, 0)'); // sanity: rotated
    expect(r.wrapT).toBe(r.paneT);
    expect(r.hasTiles).toBe(true);
  });

  test('overlay capture sits at the content origin (container space)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      map.setBearing(20);
      map.setView([32.0, 34.85], 13, { animate: false });
      state.waypoints = [{ lat: 32.0, lng: 34.85, name: 'X' }]; syncLegs(); draw();
      if (!magnifierOn) toggleMagnifier();
      _magX = 640; _magY = 360; _magDirty = true; rebuildMagnifier();
      const cap = document.getElementById('mag-content').querySelector('canvas');
      return cap ? { left: cap.style.left, top: cap.style.top } : null;
    });
    expect(r).not.toBeNull();
    expect(r.left).toBe('0px');
    expect(r.top).toBe('0px');
  });
});
