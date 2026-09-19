// @ts-check
const { test, expect } = require('./_setup');

for (const lang of ['en', 'he']) {
  for (const [width, height] of [[1000, 800], [390, 667], [844, 390]]) {
    test(`SIGWX is map-anchored and upright: ${lang} ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('?lang=' + lang + '&nogist');
      await page.waitForFunction(() => typeof sigwxSideBox === 'function');
      const got = await page.evaluate(() => {
        map.setView([33.5, 38.5], 7, { animate: false });
        map.setBearing(0);
        const box = sigwxSideBox();
        const measure = () => {
          const anchor = map.latLngToContainerPoint([34.2, 37.1]);
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
        const control = document.querySelector('.leaflet-control');
        box.click();
        return { before, panned, zoomed, rotated,
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
      expect(got.panned.left).not.toBe(got.before.left);
      expect(got.zoomed.width).toBeCloseTo(got.before.width * 2, 1);
      for (const position of [got.before, got.panned, got.zoomed, got.rotated]) {
        expect(position.left).toBeCloseTo(position.anchorX, 1);
        expect(position.top).toBeLessThan(position.anchorY);
        expect(position.transform).toBe('none');
      }
      expect(got.rotated.width).toBeCloseTo(got.zoomed.width, 1);
    });
  }
}

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
