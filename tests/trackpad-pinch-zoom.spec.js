// @ts-check
// A trackpad pinch on the Mac app (the iOS build in WebKit) arrives as gesturestart/gesturechange
// with a scale, not as two touches, and the app's user-scalable=no blocks the page zoom -- so the
// pinch did nothing (reported). The map now zooms by it, around the cursor. A touchscreen pinch
// stays Leaflet's own. The events are made here by hand: Chromium has no GestureEvent.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && map.getContainer());
  await page.evaluate(() => map.setZoom(10, { animate: false }));
}

// Fire one WebKit-style gesture event on the map at its centre; returns whether it was cancelled.
const gesture = (page, type, scale) => page.evaluate(([type, scale]) => {
  const el = map.getContainer();
  const r = el.getBoundingClientRect();
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(e, {
    scale: { value: scale }, clientX: { value: r.left + r.width / 2 }, clientY: { value: r.top + r.height / 2 },
  });
  el.dispatchEvent(e);
  return e.defaultPrevented;
}, [type, scale]);

test('pinching out on a trackpad zooms in, pinching in zooms out', async ({ page }) => {
  await boot(page);
  expect(await gesture(page, 'gesturestart', 1)).toBe(true);     // no page zoom
  await gesture(page, 'gesturechange', 2);                        // twice the size: one level in
  expect(await page.evaluate(() => map.getZoom())).toBe(11);
  await gesture(page, 'gestureend', 2);
  await gesture(page, 'gesturestart', 1);
  await gesture(page, 'gesturechange', 0.25);                     // a quarter: two levels out
  expect(await page.evaluate(() => map.getZoom())).toBe(9);
  await gesture(page, 'gestureend', 0.25);
});

test('a touchscreen pinch is left to Leaflet', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const el = map.getContainer();
    const e = new Event('touchstart', { bubbles: true });
    Object.defineProperty(e, 'touches', { value: [{}, {}] });    // two fingers down
    el.dispatchEvent(e);
  });
  expect(await gesture(page, 'gesturestart', 1)).toBe(false);
  await gesture(page, 'gesturechange', 2);
  expect(await page.evaluate(() => map.getZoom())).toBe(10);      // untouched by this handler
});
