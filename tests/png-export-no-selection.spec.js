// @ts-check
// A selected waypoint/leg is highlighted (selectedColor) on screen, but the PNG
// export must render it like any other — selection is an on-screen affordance.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof draw === 'function' && typeof octx !== 'undefined' && typeof state !== 'undefined');
  await page.evaluate(() => {
    map.setView([32.0, 34.85], 10);
    state.waypoints = [
      { lat: 32.10, lng: 34.80, name: 'A' },
      { lat: 31.95, lng: 34.95, name: 'B' },
    ];
    syncLegs();
    state.selected = { type: 'wp', index: 0 };   // select first waypoint
  });
}

// Record every fillStyle / strokeStyle assigned during one draw().
async function stylesDuringDraw(page, exporting) {
  return page.evaluate((exp) => {
    const ctx = octx;
    const seen = [];
    const proto = Object.getPrototypeOf(ctx);
    const fd = Object.getOwnPropertyDescriptor(proto, 'fillStyle');
    const sd = Object.getOwnPropertyDescriptor(proto, 'strokeStyle');
    Object.defineProperty(ctx, 'fillStyle', {
      configurable: true,
      get() { return fd.get.call(ctx); },
      set(v) { seen.push(String(v).toLowerCase()); fd.set.call(ctx, v); },
    });
    Object.defineProperty(ctx, 'strokeStyle', {
      configurable: true,
      get() { return sd.get.call(ctx); },
      set(v) { seen.push(String(v).toLowerCase()); sd.set.call(ctx, v); },
    });
    NavAid.exporting = exp;
    draw();
    NavAid.exporting = false;
    delete ctx.fillStyle;
    delete ctx.strokeStyle;
    return { seen, sel: (typeof tune === 'function' ? tune('selectedColor') : '').toLowerCase() };
  }, exporting);
}

test('selected waypoint highlight shows on screen but not in the PNG export', async ({ page }) => {
  await boot(page);

  const onScreen = await stylesDuringDraw(page, false);
  expect(onScreen.seen).toContain(onScreen.sel);          // highlight visible normally

  const exported = await stylesDuringDraw(page, true);
  expect(exported.seen).not.toContain(exported.sel);      // never in the export
});
