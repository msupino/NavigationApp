// The collapsed-toolbar toggle is the ONLY way into the eight menus on a phone
// (display:none from 681px up), and the 44px touch-target rule overrode the base
// rule's space-between — the three bars stacked into one 6px smudge, so the menu
// looked like it had no opener at all.
const { test, expect } = require('./_setup');

test('the mobile menu toggle renders three spaced bars', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('toolbar-toggle'));
  const bars = await page.evaluate(() => {
    const t = document.getElementById('toolbar-toggle');
    return [...t.children].map(s => {
      const r = s.getBoundingClientRect();
      return { y: r.y, h: r.height, w: r.width };
    });
  });
  expect(bars.length).toBe(3);
  // Each bar must be clear of the next, or they read as one thick dash.
  const gap1 = bars[1].y - (bars[0].y + bars[0].h);
  const gap2 = bars[2].y - (bars[1].y + bars[1].h);
  expect(gap1).toBeGreaterThanOrEqual(2);
  expect(gap2).toBeGreaterThanOrEqual(2);
  // And the whole glyph must still be a 44px touch target.
  const box = await page.locator('#toolbar-toggle').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('the toggle opens the menus a first-time phone user needs', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('toolbar-toggle'));
  const hiddenBefore = await page.evaluate(() =>
    [...document.querySelectorAll('#toolbar .tb-section-head')].every(h => h.getBoundingClientRect().height === 0));
  expect(hiddenBefore).toBe(true);
  await page.click('#toolbar-toggle');
  const visibleAfter = await page.evaluate(() =>
    [...document.querySelectorAll('#toolbar .tb-section-head')].filter(h => h.getBoundingClientRect().height > 0).length);
  expect(visibleAfter).toBeGreaterThan(5);
});

test('an unset altitude is not clipped: dash on a phone, the word on desktop', async ({ page }) => {
  const openPlan = async () => {
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
      state.legs = []; syncLegs();
      state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = null; });
      draw();
      showFlightPlan();
    });
    return page.evaluate(() => {
      // The altitude cell is tagged with its column key; other .plan-num inputs
      // (speed) live in their own columns.
      const inp = document.querySelector('.flight-table [data-fp-col="alt"] .plan-num');
      const cs = getComputedStyle(inp);
      // Measure the placeholder against the space it has to render in.
      const c = document.createElement('canvas').getContext('2d');
      c.font = cs.fontSize + ' ' + cs.fontFamily;
      const textW = c.measureText(inp.placeholder).width;
      const usable = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { placeholder: inp.placeholder, textW, usable };
    });
  };

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function');
  const phone = await openPlan();
  expect(phone.placeholder).toBe('—');
  expect(phone.textW).toBeLessThanOrEqual(phone.usable);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function');
  const desktop = await openPlan();
  expect(desktop.placeholder).toBe('Unknown');
  expect(desktop.textW).toBeLessThanOrEqual(desktop.usable);   // fits, no "Unkno"
});

test('the Hebrew unset-altitude placeholder also fits on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = null; });
    draw(); showFlightPlan();
    const inp = document.querySelector('.flight-table [data-fp-col="alt"] .plan-num');
    const cs = getComputedStyle(inp);
    const c = document.createElement('canvas').getContext('2d');
    c.font = cs.fontSize + ' ' + cs.fontFamily;
    return { placeholder: inp.placeholder, textW: c.measureText(inp.placeholder).width,
             usable: inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
  });
  expect(out.textW).toBeLessThanOrEqual(out.usable);   // no "לא יד"
});
