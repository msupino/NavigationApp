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

async function exportAt(page, size, bearing, res) {
  return page.evaluate(async ([size, bearing, res]) => {
    if (res) localStorage.setItem('navaid.printRes', res);
    let tiles = 0;
    window.refuse = () => {};                    // stub tiles do not decode; not what is measured
    let inFlight = 0, peak = 0;
    const realFetch = window.fetch;
    window.fetch = async (...a) => {
      let tile = false;
      try { tile = new URL(String(a[0]), location.href).hostname === 'navaid-tiles.supino.org'; } catch (e) { /* not a URL */ }
      if (tile) { tiles++; inFlight++; peak = Math.max(peak, inFlight); }
      try { return await realFetch(...a); } finally { if (tile) inFlight--; }
    };
    map.setView([32.3, 34.95], 10, { animate: false });
    if (bearing) map.setBearing(bearing);
    if (size && pageSize !== size) setPage(size);   // pressing the same size again turns the page off
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
    return { W: dv.getUint32(16), H: dv.getUint32(20), dpi: ppm && Math.round(ppm * 0.0254), peak, tiles };
  }, [size, bearing, res]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof exportPNG === 'function' && typeof setPage === 'function');
  await page.evaluate(() => { const s = document.getElementById('layer-select'); s.value = 'CVFR'; s.dispatchEvent(new Event('change')); });
});

for (const [size, bearing] of [['A4', 0], ['A3', 0], ['A4', 30]]) {
  test(size + (bearing ? ' on a rotated map' : '') + ' is printed from the sharpest tiles', async ({ page }) => {
    const r = await exportAt(page, size, bearing, 'high');
    expect(r.dpi).toBeGreaterThanOrEqual(350);   // was ~197 for A3 and a rotated A4
    expect(r.peak).toBeLessThanOrEqual(16);       // a pool, not a thousand requests at once
  });
}

test('with no page chosen it is twice the screen at High, and says so', async ({ page }) => {
  const r = await exportAt(page, null, 0, 'high');
  expect([r.W, r.H]).toEqual([2800, 1800]);
  expect(r.dpi).toBe(192);
  const m = await exportAt(page, null, 0, 'medium');     // the default: 1.5x
  expect([m.W, m.H]).toEqual([2100, 1350]);
  expect(m.dpi).toBe(144);
});

// Asked: 'add a "resolution" slider, low, med, high, in print menu'.
test('Low, Medium and High: about half, three quarters and all of the sharpest tiles', async ({ page }) => {
  const high = await exportAt(page, 'A4', 0, 'high');
  const medium = await exportAt(page, 'A4', 0, 'medium');
  const low = await exportAt(page, 'A4', 0, 'low');
  expect(high.dpi).toBeGreaterThanOrEqual(380);
  expect(Math.abs(medium.dpi - high.dpi * 0.75)).toBeLessThan(8);
  expect(Math.abs(low.dpi - high.dpi * 0.5)).toBeLessThan(8);
  expect(low.tiles).toBeLessThan(high.tiles / 2);    // Low is drawn from a level coarser: quick
});

test('the Print dialog has the Resolution slider, remembered on this device', async ({ page }) => {
  await page.evaluate(() => showExportModal());
  const slider = page.locator('#export-res');
  await expect(slider).toHaveValue('1');                 // Medium by default
  await slider.fill('0');
  expect(await page.evaluate(() => localStorage.getItem('navaid.printRes'))).toBe('low');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Low');
});

// Asked: "show a timer running for export, let the user know something is happening" -- "some
// progress bar". A panel shows the tiles fetched and the seconds running, then "composing",
// and goes when the page is saved.
test('a progress panel counts the tiles and the seconds, and goes when the page is saved', async ({ page }) => {
  await page.route(u => u.hostname === 'navaid-tiles.supino.org', async (r) => {
    await new Promise(x => setTimeout(x, 40));
    await r.fulfill({ status: 404, body: '' });
  });
  const seen = await page.evaluate(async () => {
    window.refuse = () => {};
    setPage('A4');
    await new Promise(r => setTimeout(r, 200));
    const samples = [];
    const iv = setInterval(() => {
      const el = document.getElementById('export-progress');
      if (el) samples.push({ text: el.textContent, value: el.querySelector('progress').value, max: el.querySelector('progress').max });
    }, 100);
    await new Promise((resolve) => { window.saveFile = (b, _name) => resolve(b); exportPNG('save'); });
    clearInterval(iv);
    return { samples, after: !!document.getElementById('export-progress') };
  });
  expect(seen.samples.length).toBeGreaterThan(2);
  expect(seen.samples.some(s => /Fetching the map: \d+ \/ \d+ tiles · \d+ s/.test(s.text) && s.value > 0)).toBe(true);
  expect(seen.after).toBe(false);
});

// Review: Print opened its window when the page was ready, but a browser allows a window only
// for a few seconds after the click -- a sharp A3 takes longer, and the print was blocked as a
// pop-up. The window opens at the press ("Preparing the page"), and the page arrives in it.
test('Print opens its window at the press, and the page arrives in that window', async ({ page }) => {
  await page.route(u => u.hostname === 'navaid-tiles.supino.org', async (r) => {
    await new Promise(x => setTimeout(x, 30));
    await r.fulfill({ status: 404, body: '' });
  });
  const r = await page.evaluate(async () => {
    window.refuse = () => {};
    setPage('A4');
    await new Promise(r => setTimeout(r, 200));
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    let opens = 0, printed = 0;
    window.open = () => { opens++; frame.contentWindow.print = () => { printed++; }; return frame.contentWindow; };
    exportPNG('print');
    const openedAtPress = opens;                       // before any tile has come back
    const preparing = frame.contentDocument.body.textContent;
    for (let i = 0; i < 200 && !printed; i++) await new Promise(x => setTimeout(x, 100));
    return { openedAtPress, opens, preparing, imgs: frame.contentDocument.querySelectorAll('img').length, printed };
  });
  expect(r.openedAtPress).toBe(1);
  expect(r.preparing).toContain('Preparing the page');
  expect(r.opens).toBe(1);                              // the same window, not a second one
  expect(r.imgs).toBe(1);
  expect(r.printed).toBe(1);
});
