// @ts-check
// Rotating the map turned the significant-weather sheet's text with it.
//
// An image overlay lives in .leaflet-rotate-pane, so the bearing turns it with the chart. That
// is right for anything georeferenced and wrong for a panel of text: the SIGWX sheet is cropped
// into three, and only one of them is weather over ground. leaflet-rotate already counter-
// rotates divIcon content to keep it upright; this is the same trick for an element the plugin
// does not know about.
const { test, expect } = require('./_setup');

// The rotation an element actually shows on screen: its own transform composed with the pane's.
const angleOf = (m) => {
  const n = String(m).match(/matrix\(([^)]+)\)/);
  if (!n) return 0;
  const [a, b] = n[1].split(',').map(Number);
  return Math.round(Math.atan2(b, a) * 180 / Math.PI);
};

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map === 'object' && map
    && typeof keepOverlayUpright === 'function');
}

test('the helper cancels the bearing and keeps what Leaflet put there', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const el = document.createElement('div');
    el.style.transform = 'translate3d(10px, 20px, 0px)';
    keepOverlayUpright(el, 45);
    const turned = el.style.transform;
    keepOverlayUpright(el, 0);
    return { turned, back: el.style.transform, origin: el.style.transformOrigin };
  });
  expect(got.turned).toBe('translate3d(10px, 20px, 0px) rotate(-45deg)');
  // Leaflet's own positioning survives, and a bearing of zero leaves no rotation behind.
  expect(got.back).toBe('translate3d(10px, 20px, 0px)');
  expect(got.origin).toBe('50% 50%');
});

test('applying it twice does not stack rotations', async ({ page }) => {
  await boot(page);
  const t = await page.evaluate(() => {
    const el = document.createElement('div');
    el.style.transform = 'translate3d(1px, 2px, 0px)';
    keepOverlayUpright(el, 30);
    keepOverlayUpright(el, 50);
    return el.style.transform;
  });
  expect(t).toBe('translate3d(1px, 2px, 0px) rotate(-50deg)');
});

// The point of the whole thing: on screen, an upright panel reads level whatever the map does.
test('a counter-rotated overlay reads level while the map is turned', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const ov = L.imageOverlay('data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      [[32.0, 34.9], [32.3, 35.3]], { pane: 'overlayPane' }).addTo(map);
    const plain = L.imageOverlay('data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      [[31.6, 34.9], [31.9, 35.3]], { pane: 'overlayPane' }).addTo(map);
    map.setBearing(45);
    keepOverlayUpright(ov.getElement(), map.getBearing());
    const pane = getComputedStyle(document.querySelector('.leaflet-rotate-pane')).transform;
    const read = (l) => getComputedStyle(l.getElement()).transform;
    const out = { pane, upright: read(ov), plain: read(plain) };
    map.setBearing(0);
    ov.remove(); plain.remove();
    return out;
  });
  const paneAngle = angleOf(got.pane);
  expect(paneAngle).toBe(45);                                   // the map really is turned
  // The one left alone inherits the pane's 45°; the counter-rotated one comes back to level.
  expect(angleOf(got.plain)).toBe(0);                           // no transform of its own...
  expect(paneAngle + angleOf(got.plain)).toBe(45);              // ...so it reads 45 on screen
  expect(paneAngle + angleOf(got.upright)).toBe(0);             // and this one reads level
});
