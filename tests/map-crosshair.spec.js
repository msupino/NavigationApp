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

test('its size, thickness and colours come from the tuning gist', async ({ page }) => {
  await boot(page, PHONE);
  const before = await page.evaluate(() => {
    const b = document.getElementById('map-crosshair').getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  });
  expect(before.w).toBe(await page.evaluate(() => tune('crosshairSizePx')));
  const after = await page.evaluate(() => {
    setTune('crosshairSizePx', 80);
    setTune('crosshairWidthPx', 4);
    setTune('crosshairColor', '#ff0000');
    applyTuningCssVars();
    const el = document.getElementById('map-crosshair');
    const b = el.getBoundingClientRect();
    const arm = getComputedStyle(el, '::before');
    const m = map.getContainer().getBoundingClientRect();
    return {
      w: Math.round(b.width), h: Math.round(b.height),
      line: arm.width, colour: arm.backgroundColor,
      // Still centred after the resize -- the offset has to track the size.
      dx: Math.abs((b.left + b.width / 2) - (m.left + m.width / 2)),
      dy: Math.abs((b.top + b.height / 2) - (m.top + m.height / 2)),
    };
  });
  expect(after.w).toBe(80);
  expect(after.h).toBe(80);
  expect(after.line).toBe('4px');
  expect(after.colour).toBe('rgb(255, 0, 0)');
  expect(after.dx).toBeLessThanOrEqual(1);
  expect(after.dy).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    setTune('crosshairSizePx', 34); setTune('crosshairWidthPx', 1); setTune('crosshairColor', '#231F20');
    applyTuningCssVars();
  });
});

// A tablet is wide but has no pointer, so the width clause of the media query never
// matches there -- `(pointer: coarse)` is what carries it. Asked directly: "iPad will not
// see it?" It does, and this is what keeps that true.
test.describe('a tablet: wide screen, no pointer', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false });

  test('gets the crosshair, and the live readout that goes with it', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!document.getElementById('map-crosshair'));
    const out = await page.evaluate(() => ({
      shown: getComputedStyle(document.getElementById('map-crosshair')).display !== 'none',
      narrowClause: matchMedia('(max-width: 680px)').matches,
      pointerClause: matchMedia('(pointer: coarse)').matches,
      liveUpdates: coarsePointerOnly(),
    }));
    expect(out.shown).toBe(true);
    expect(out.narrowClause).toBe(false);      // NOT the width clause -- the screen is wide
    expect(out.pointerClause).toBe(true);      // this is what carries it
    expect(out.liveUpdates).toBe(true);        // ...and the readout follows the mark
  });
});

test('with a real pointer there is no crosshair — the pointer is the marker', async ({ page }) => {
  await boot(page, DESKTOP);
  expect(await shown(page)).toBe(false);
});
