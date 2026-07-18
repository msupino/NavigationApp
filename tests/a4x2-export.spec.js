// @ts-check
// "A4×2" page size: the A3 frame exported as two A4 tiles at 1:250 000, for
// when an A3 printer isn't available. Covers the frame geometry (A4×2 reuses
// the A3 coverage) and that Save-PNG emits two A4 tile files.
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
    () => typeof setPage === 'function' && typeof exportA4x2Tiles === 'function' &&
          document.getElementById('page-a4x2'));
}

test('A4×2 selects the A3 frame geometry', async ({ page }) => {
  await boot(page);
  await page.locator('#page-a4x2').click();
  const d = await page.evaluate(() => ({ ...pageDims(), size: pageSize }));
  expect(d.size).toBe('A4x2');
  // A4×2 covers the A3 area (aspect ≈ √2), not the smaller A4.
  const ratio = Math.max(d.w, d.h) / Math.min(d.w, d.h);
  expect(ratio).toBeGreaterThan(1.38);
  expect(ratio).toBeLessThan(1.45);
  await expect(page.locator('#page-a4x2')).toHaveAttribute('aria-pressed', 'true');
});

test('Save PNG in A4×2 emits two A4 tile files', async ({ page }) => {
  await boot(page);
  const names = [];
  page.on('download', dl => names.push(dl.suggestedFilename()));
  // Drive the tiler directly on a synthetic A3-landscape canvas (no map
  // tiles). A landscape sheet splits into two portrait pages side-by-side.
  await page.evaluate(() => new Promise((res) => {
    const out = document.createElement('canvas');
    out.width = 1200; out.height = 850;
    const o = out.getContext('2d');
    o.fillStyle = '#8899aa'; o.fillRect(0, 0, 1200, 850);
    window.pageOrient = 'landscape';
    exportA4x2Tiles(out, 1200, 850, () => res());
  }));
  await page.waitForTimeout(400);
  expect(names.length).toBe(2);
  expect(names.some(n => /A4x2-p1of2-.*\.png$/.test(n))).toBe(true);
  expect(names.some(n => /A4x2-p2of2-.*\.png$/.test(n))).toBe(true);
});

test('each A4×2 tile is half the A3 canvas (A4 aspect)', async ({ page }) => {
  await boot(page);
  // Capture the tile canvases by intercepting the download step.
  const dims = await page.evaluate(() => new Promise((res) => {
    const sizes = [];
    const realCreate = document.createElement.bind(document);
    // Spy on toBlob-producing canvases: exportA4x2Tiles draws each tile onto a
    // fresh canvas, so record canvas sizes created during the call.
    const created = [];
    document.createElement = function (tag) {
      const el = realCreate(tag);
      if (tag === 'canvas') created.push(el);
      return el;
    };
    const out = realCreate('canvas'); out.width = 1200; out.height = 850;
    out.getContext('2d').fillRect(0, 0, 1200, 850);
    window.pageOrient = 'landscape';  // landscape sheet = vertical cut
    // stub anchor clicks so nothing actually downloads
    exportA4x2Tiles(out, 1200, 850, () => {
      document.createElement = realCreate;
      for (const c of created) if (c.width && c.height) sizes.push([c.width, c.height]);
      res(sizes);
    });
  }));
  // Two tile canvases, each 600×850 (half of 1200 wide) — A4 portrait aspect.
  const tileSizes = dims.filter(([w, h]) => h === 850);
  expect(tileSizes.length).toBe(2);
  for (const [w, h] of tileSizes) {
    expect(w).toBe(600);
    expect(h / w).toBeGreaterThan(1.39);   // ≈ 297/210
  }
});

test('portrait orientation gives a tall frame and two WYSIWYG landscape tiles', async ({ page }) => {
  await boot(page);
  // Sheet semantics, like A3/A4: portrait toggle -> tall (A3-portrait) frame.
  await page.evaluate(() => { window.pageOrient = 'portrait'; });
  await page.locator('#page-a4x2').click();
  const d = await page.evaluate(() => pageDims());
  expect(d.h).toBeGreaterThan(d.w);          // tall coverage follows the toggle

  // Tiler: horizontal cut -> two W×(H/2) landscape halves, saved exactly as
  // they appear on screen (WYSIWYG — no rotation).
  const dims = await page.evaluate(() => new Promise((res) => {
    const sizes = [];
    const realCreate = document.createElement.bind(document);
    const created = [];
    document.createElement = function (tag) {
      const el = realCreate(tag);
      if (tag === 'canvas') created.push(el);
      return el;
    };
    const out = realCreate('canvas'); out.width = 850; out.height = 1200;
    out.getContext('2d').fillRect(0, 0, 850, 1200);
    window.pageOrient = 'portrait';
    exportA4x2Tiles(out, 850, 1200, () => {
      document.createElement = realCreate;
      for (const c of created) if (c.width && c.height) sizes.push([c.width, c.height]);
      res(sizes);
    });
  }));
  const cut = dims.filter(([w, h]) => w === 850 && h === 600);
  const rotated = dims.filter(([w, h]) => w === 600 && h === 850);
  expect(cut.length).toBe(2);      // two wide halves, saved as-is
  expect(rotated.length).toBe(0);  // WYSIWYG: nothing gets rotated
});
