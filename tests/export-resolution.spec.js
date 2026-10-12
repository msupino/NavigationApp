// @ts-check
// "What's the PNG dpi? Seems not very good." A framed export stopped at 300 tiles and fell a
// whole zoom level past that: A3, and an A4 on a rotated map, came out at about 197 dpi. The
// limit is the image size now, so every page is drawn from the chart's sharpest tiles (about
// 390 dpi at 1:250 000 on CVFR), scaled down smoothly only where the browser cannot hold the
// image. With no page chosen it is twice the screen, and says so in the file. The tiles are
// fetched sixteen at a time, so a ~1,000-tile page does not time its own requests out.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 1400, height: 900 } });
test.setTimeout(90000);

async function exportAt(page, size, bearing) {
  return page.evaluate(async ([size, bearing]) => {
    window.refuse = () => {};                    // stub tiles do not decode; not what is measured
    let inFlight = 0, peak = 0;
    const realFetch = window.fetch;
    window.fetch = async (...a) => {
      const tile = /navaid-tiles\.supino\.org/.test(String(a[0]));
      if (tile) { inFlight++; peak = Math.max(peak, inFlight); }
      try { return await realFetch(...a); } finally { if (tile) inFlight--; }
    };
    map.setView([32.3, 34.95], 10, { animate: false });
    if (bearing) map.setBearing(bearing);
    if (size) setPage(size);
    await new Promise(r => setTimeout(r, 300));
    const blob = await new Promise((resolve) => { window.saveFile = (b, _name) => resolve(b); exportPNG('save'); });
    window.fetch = realFetch;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let ppm = null;
    for (let i = 8; i < buf.length - 12;) {
      const len = dv.getUint32(i), type = String.fromCharCode(...buf.slice(i + 4, i + 8));
      if (type === 'pHYs') { ppm = dv.getUint32(i + 8); break; }
      if (type === 'IDAT') break;
      i += 12 + len;
    }
    return { W: dv.getUint32(16), H: dv.getUint32(20), dpi: ppm && Math.round(ppm * 0.0254), peak };
  }, [size, bearing]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof exportPNG === 'function' && typeof setPage === 'function');
  await page.evaluate(() => { const s = document.getElementById('layer-select'); s.value = 'CVFR'; s.dispatchEvent(new Event('change')); });
});

for (const [size, bearing] of [['A4', 0], ['A3', 0], ['A4', 30]]) {
  test(size + (bearing ? ' on a rotated map' : '') + ' is printed from the sharpest tiles', async ({ page }) => {
    const r = await exportAt(page, size, bearing);
    expect(r.dpi).toBeGreaterThanOrEqual(350);   // was ~197 for A3 and a rotated A4
    expect(r.peak).toBeLessThanOrEqual(16);       // a pool, not a thousand requests at once
  });
}

test('with no page chosen it is twice the screen, and says so', async ({ page }) => {
  const r = await exportAt(page, null, 0);
  expect([r.W, r.H]).toEqual([2800, 1800]);
  expect(r.dpi).toBe(192);
});
