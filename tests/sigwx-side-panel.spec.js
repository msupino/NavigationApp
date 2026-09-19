// @ts-check
const { test, expect } = require('./_setup');

for (const lang of ['en', 'he']) {
  for (const [width, height] of [[1000, 800], [390, 667], [844, 390]]) {
    test(`SIGWX stays fixed while rotating with the map: ${lang} ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('?lang=' + lang + '&nogist');
      await page.waitForFunction(() => typeof sigwxSideBox === 'function');
      const got = await page.evaluate(() => {
        map.setView([33.5, 38.5], 7, { animate: false });
        map.setBearing(0);
        const box = sigwxSideBox();
        const measure = () => {
          const anchor = map.project([34.2, 37.1]).subtract(map.project(map.getCenter()))
            .add(map.getSize().divideBy(2));
          return { left: parseFloat(box.style.left), top: parseFloat(box.style.top),
            width: parseFloat(box.style.width), anchorX: anchor.x, anchorY: anchor.y,
            transform: getComputedStyle(box).transform };
        };
        const before = measure();
        map.panBy([80, 30], { animate: false });
        const panned = measure();
        map.setZoom(map.getZoom() + 1, { animate: false });
        const zoomed = measure();
        map.setBearing(90);
        const rotated = measure();
        map.setBearing(180);
        const southUp = measure();
        const control = document.querySelector('.leaflet-control');
        box.click();
        return { before, panned, zoomed, rotated, southUp,
          display: getComputedStyle(box).display,
          pointerEvents: getComputedStyle(box).pointerEvents,
          belowControls: Number(getComputedStyle(box).zIndex) < Number(getComputedStyle(control).zIndex),
          outsideRotatedPane: !box.closest('.leaflet-pane'),
          imageCount: box.querySelectorAll('img').length,
          popupCount: document.querySelectorAll('.sigwx-table-modal').length };
      });
      expect(got.display).toBe('flex');
      expect(got.pointerEvents).toBe('none');
      expect(got.belowControls).toBe(true);
      expect(got.outsideRotatedPane).toBe(true);
      expect(got.imageCount).toBe(1);
      expect(got.popupCount).toBe(0);
      expect(Math.abs(got.before.left - got.before.anchorX)).toBeLessThan(1);
      for (const position of [got.before, got.panned, got.zoomed, got.rotated, got.southUp]) {
        expect(position.left).toBeCloseTo(got.before.left, 1);
        expect(position.top).toBeCloseTo(got.before.top, 1);
        expect(position.width).toBeCloseTo(got.before.width, 1);
      }
      expect(got.rotated.transform).toBe('matrix(0, 1, -1, 0, 0, 0)');
      expect(got.southUp.transform).toBe('matrix(-1, 0, 0, -1, 0, 0)');
      expect(got.rotated.width).toBeCloseTo(got.zoomed.width, 1);
      for (const position of [got.rotated, got.southUp]) {
        expect(position.left).toBeCloseTo(got.zoomed.left, 1);
        expect(position.top).toBeCloseTo(got.zoomed.top, 1);
      }
    });
  }
}

test('existing table tuning offsets and scale adjust the frozen reference', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof sigwxSideBox === 'function');
  const got = await page.evaluate(() => {
    const box = sigwxSideBox();
    const read = () => ({ x: parseFloat(box.style.left), y: parseFloat(box.style.top),
      w: parseFloat(box.style.width) });
    const before = read();
    const original = window.tune;
    const overrides = { sigwxTblLatOffset: 1, sigwxTblLngOffset: 1 };
    window.tune = key => key in overrides ? overrides[key] : original(key);
    map.fire('resize');
    const offset = read();
    overrides.sigwxTblScale = 0.5;
    map.fire('resize');
    const scaled = read();
    window.tune = original;
    return { before, offset, scaled };
  });
  expect(got.offset.x).toBeGreaterThan(got.before.x);
  expect(got.offset.y).toBeLessThan(got.before.y);
  expect(got.offset.w).toBeCloseTo(got.before.w, 1);
  expect(got.scaled.w).toBeCloseTo(got.before.w / 2, 1);
});

test('title and table compose into one proportional image', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof sigwxCombineTable === 'function');
  const result = await page.evaluate(async () => {
    const crop = (w, h, color) => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
      return canvas.toDataURL();
    };
    const url = await sigwxCombineTable(crop(200, 20, 'red'), crop(100, 80, 'blue'));
    const img = new Image(); img.src = url; await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    return { width: img.width, height: img.height,
      top: [...ctx.getImageData(0, 0, 1, 1).data],
      bottom: [...ctx.getImageData(0, 89, 1, 1).data] };
  });
  expect(result).toEqual({ width: 100, height: 90,
    top: [255, 0, 0, 255], bottom: [0, 0, 255, 255] });
});
