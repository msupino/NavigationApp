// The collapsed-toolbar toggle is the ONLY way into the eight menus on a phone
// (display:none from 681px up), and the 44px touch-target rule overrode the base
// rule's space-between — the three bars stacked into one 6px smudge, so the menu
// looked like it had no opener at all.
const { test, expect } = require('./_setup');

test('an untouched desktop legend keeps its Leaflet bottom anchor after resize', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() =>
    !document.documentElement.classList.contains('app-booting') &&
    document.getElementById('map-legend').getBoundingClientRect().height > 0);
  const before = await page.locator('#map-legend').boundingBox();
  expect(before).not.toBeNull();
  const beforeGap = 800 - (before.y + before.height);
  expect(await page.locator('#map-legend').evaluate(el => el.style.position)).toBe('');
  await page.setViewportSize({ width: 1200, height: 1000 });
  await expect.poll(async () => {
    const box = await page.locator('#map-legend').boundingBox();
    return Math.abs((1000 - (box.y + box.height)) - beforeGap);
  }).toBeLessThan(3);
  expect(await page.locator('#map-legend').evaluate(el => el.style.position)).toBe('');
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

test('the phone bottom band does not pile up legend, coords and attribution', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function');
  const boxes = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs(); draw();
    const get = sel => { const e = document.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect(); return r.height ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null; };
    return { legend: get('#map-legend'),
             coord: get('#coord-readout'), attrib: get('.leaflet-control-attribution') };
  });
  const hits = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  expect(boxes.legend).not.toBeNull();
  expect(boxes.attrib).not.toBeNull();
  // The legend must sit clear of the attribution, which wraps to two lines here.
  expect(boxes.legend.bottom).toBeLessThanOrEqual(boxes.attrib.top + 1);
  expect(hits(boxes.legend, boxes.coord)).toBe(false);
});

test('the search tip retires after the first search and stays gone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof runSearch === 'function');
  await expect(page.locator('#wp-search-hint')).toBeVisible();
  await page.fill('#wp-search', 'LLHZ');
  await page.dispatchEvent('#wp-search', 'input');
  await expect(page.locator('#wp-search-hint')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('navaid.searchTipDone'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => typeof runSearch === 'function');
  await expect(page.locator('#wp-search-hint')).toBeHidden();
});

test('an unset altitude is drawn dashed and captioned, not as a confident line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof routeProfile === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = null; });
    const unset = routeProfile();
    state.legs.forEach(l => { l.inboundAltitude = 3000; });
    const known = routeProfile();
    return {
      unsetHasAssumed: !!unset.hasAssumed,
      unsetLegAssumed: unset.legs.map(l => l.assumed),
      knownHasAssumed: !!known.hasAssumed,
      knownLegAssumed: known.legs.map(l => l.assumed),
      noteFn: typeof S.profileAssumedNote === 'function' && S.profileAssumedNote(2000),
    };
  });
  expect(out.unsetHasAssumed).toBe(true);
  expect(out.unsetLegAssumed).toEqual([true]);
  expect(out.knownHasAssumed).toBe(false);
  expect(out.knownLegAssumed).toEqual([false]);
  expect(out.noteFn).toMatch(/2000/);
});
