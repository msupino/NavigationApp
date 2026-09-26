// @ts-check
const { test, expect } = require('./_setup');

for (const lang of ['en', 'he']) {
  for (const [width, height] of [[1000, 800], [390, 667], [844, 390]]) {
    test(`SIGWX stays pinned to the map: ${lang} ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('?lang=' + lang + '&nogist');
      await page.waitForFunction(() => typeof sigwxSideBox === 'function');
      const got = await page.evaluate(() => {
        map.setView([33.5, 38.5], 7, { animate: false });
        map.setBearing(0);
        const box = sigwxSideBox();
        const measure = () => {
          const tableWidth = map.project([34.2, 40.6]).x - map.project([34.2, 37.1]).x;
          const headerHeight = tableWidth * (0.10484 - 0.02258) * 1240 / (0.992 * 1755);
          const anchor = map.project([34.2, 37.1]).subtract(L.point(0, headerHeight))
            .subtract(map.project(map.getCenter())).add(map.getSize().divideBy(2));
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
      expect(got.panned.left).not.toBe(got.before.left);
      expect(got.zoomed.width).toBeCloseTo(got.before.width * 2, 1);
      // The anchor arithmetic this used to assert was the top-left corner taken straight out of
      // map.project() -- the north-up CRS plane, which knows nothing about the bearing. Rotating
      // looked right, but a pan while rotated moves the map along a vector that is itself
      // rotated, so the projection of the anchor moved by a different one: 120 px sideways slid
      // the legend 85 left and 84 down. Reported as the legend keeping moving when north is not
      // up. What is asserted now is the property that was wanted -- the CENTRE sits at the
      // north-up screen position -- rather than the formula that was reached for.
      for (const position of [got.before, got.panned, got.zoomed, got.rotated, got.southUp]) {
        expect(position.transform).toBe('none');
        expect(Number.isFinite(position.left)).toBe(true);
        expect(Number.isFinite(position.top)).toBe(true);
      }
      // Turning the map moves nothing: same view, same place, whatever the bearing.
      expect(got.rotated.width).toBeCloseTo(got.zoomed.width, 1);
      for (const position of [got.rotated, got.southUp]) {
        expect(position.left).toBeCloseTo(got.zoomed.left, 1);
        expect(position.top).toBeCloseTo(got.zoomed.top, 1);
      }
    });
  }
}

test('existing table tuning offsets and scale adjust the geographic placement', async ({ page }) => {
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

// The bug in one test: the legend must not move when the map turns, at any bearing, and a pan
// that is undone must put it back exactly. Measured before the fix: 120 px of sideways pan at
// 45 degrees moved it 85 left and 84 down, and it never came back to where it started.
test('the legend holds its north-up place at every bearing', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof sigwxSideBox === 'function');
  const got = await page.evaluate(() => {
    map.setView([32.2, 35.0], 8, { animate: false });
    map.setBearing(0);
    const box = sigwxSideBox();
    for (const img of box.querySelectorAll('img')) {
      img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    }
    const at = () => {
      const b = box.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y) };
    };
    const north = at();
    const bearings = {};
    for (const b of [30, 45, 90, 180, 270]) { map.setBearing(b); bearings[b] = at(); }
    map.setBearing(45);
    map.panBy([120, 0], { animate: false });
    const panned = at();
    map.panBy([-120, 0], { animate: false });
    const back = at();
    map.setBearing(0);
    return { north, bearings, panned, back, northAgain: at() };
  });
  // Every bearing puts it in the same place as north-up.
  for (const [deg, pos] of Object.entries(got.bearings)) {
    expect(pos, 'bearing ' + deg).toEqual(got.north);
  }
  // A pan moves it -- it is anchored to the map, not to the screen...
  expect(got.panned).not.toEqual(got.north);
  // ...and undoing the pan puts it back exactly, which is what "keeps moving" was not doing.
  expect(got.back).toEqual(got.north);
  expect(got.northAgain).toEqual(got.north);
});
