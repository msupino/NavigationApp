// @ts-check
// The coordinate readout follows the mouse, and a phone has no mouse — there it shows the
// map CENTRE, with nothing on screen saying which spot that is. A crosshair marks it, so
// panning the map under it reads coordinates the way a chart ruler would.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 780 };
const DESKTOP = { width: 1280, height: 800 };

async function boot(page, size) {
  await page.setViewportSize(size);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    !!document.getElementById('map-crosshair'));
}

const shown = (page) => page.evaluate(() =>
  getComputedStyle(document.getElementById('map-crosshair')).display !== 'none');

test('on a phone the crosshair is drawn, dead centre of the map', async ({ page }) => {
  await boot(page, PHONE);
  expect(await shown(page)).toBe(true);
  const centred = await page.evaluate(() => {
    const c = document.getElementById('map-crosshair').getBoundingClientRect();
    const m = map.getContainer().getBoundingClientRect();
    return {
      dx: Math.abs((c.left + c.width / 2) - (m.left + m.width / 2)),
      dy: Math.abs((c.top + c.height / 2) - (m.top + m.height / 2)),
    };
  });
  expect(centred.dx).toBeLessThanOrEqual(1);
  expect(centred.dy).toBeLessThanOrEqual(1);
});

test('it marks what the readout is reading, and keeps up while the map moves', async ({ page }) => {
  await boot(page, PHONE);
  const at = (lat, lng) => page.evaluate(([la, ln]) => {
    map.setView([la, ln], map.getZoom());
    return document.getElementById('coord-readout').textContent.trim();
  }, [lat, lng]);
  const first = await at(32.10, 34.85);
  const second = await at(31.80, 34.60);
  expect(first).not.toBe(second);              // the numbers follow the crosshair
  // ...and they are the CENTRE's numbers, which is where the crosshair sits.
  const expected = await page.evaluate(() => {
    const c = map.getCenter();
    return coordReadoutText(c.lat, c.lng).trim();
  });
  expect(second).toBe(expected);
});

test('it never swallows a tap meant for the map', async ({ page }) => {
  await boot(page, PHONE);
  const passesThrough = await page.evaluate(() => {
    const el = document.getElementById('map-crosshair');
    const m = map.getContainer().getBoundingClientRect();
    const hit = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
    return { pointerEvents: getComputedStyle(el).pointerEvents, hitIsCrosshair: hit === el };
  });
  expect(passesThrough.pointerEvents).toBe('none');
  expect(passesThrough.hitIsCrosshair).toBe(false);
});

test('with a real pointer there is no crosshair — the pointer is the marker', async ({ page }) => {
  await boot(page, DESKTOP);
  expect(await shown(page)).toBe(false);
});
