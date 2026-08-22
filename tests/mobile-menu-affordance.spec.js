// The collapsed-toolbar toggle is the ONLY way into the eight menus on a phone
// (display:none from 681px up), and the 44px touch-target rule overrode the base
// rule's space-between — the three bars stacked into one 6px smudge, so the menu
// looked like it had no opener at all.
const { test, expect } = require('./_setup');

const mobileChromeGeometry = page => page.evaluate(() => {
  const rect = id => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      width: r.width, height: r.height };
  };
  const legend = rect('map-legend');
  const toolbar = rect('toolbar');
  const visibleContent = [...document.querySelectorAll('#map-legend > *')]
    .filter(el => getComputedStyle(el).visibility !== 'hidden' &&
      getComputedStyle(el).display !== 'none')
    .map(el => el.getBoundingClientRect());
  const content = visibleContent.length ? {
    left: Math.min(...visibleContent.map(r => r.left)),
    right: Math.max(...visibleContent.map(r => r.right)),
  } : { left: legend.left, right: legend.right };
  const intersects = legend.left < toolbar.right && legend.right > toolbar.left &&
    legend.top < toolbar.bottom && legend.bottom > toolbar.top;
  return { legend, toolbar, content, intersects,
    viewport: { width: window.innerWidth, height: window.innerHeight } };
});

function expectLegendUsable({ legend, content, intersects, viewport }) {
  expect(legend.left).toBeGreaterThanOrEqual(-1);
  expect(legend.top).toBeGreaterThanOrEqual(-1);
  expect(legend.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(legend.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(content.left).toBeGreaterThanOrEqual(-1);
  expect(content.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(content.left).toBeGreaterThanOrEqual(legend.left - 1);
  expect(content.right).toBeLessThanOrEqual(legend.right + 1);
  expect(intersects).toBe(false);
}

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

for (const lang of ['en', 'he']) {
  test(`the complete ${lang} legend stays visible beside the expanded short-phone toolbar`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await page.addInitScript(() => localStorage.setItem('navaid.toolbarCollapsed', '0'));
    await page.goto(`?lang=${lang}&nogist`);
    await page.waitForFunction(() => {
      const toolbar = document.getElementById('toolbar');
      const legend = document.getElementById('map-legend');
      return !document.documentElement.classList.contains('app-booting') &&
        toolbar && legend && !toolbar.classList.contains('collapsed') &&
        legend.getBoundingClientRect().height > 0;
    });
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.18, lng: 34.84, name: 'LLHZ' },
        { lat: 32.21, lng: 34.81, name: 'SFAIM' },
        { lat: 32.00, lng: 34.73, name: 'TYONA' },
      ];
      state.legs = [];
      syncLegs();
      draw();
    });
    expectLegendUsable(await mobileChromeGeometry(page));
  });
}

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

test('a dragged legend is reconciled and remains persistent after a live phone resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('navaid.toolbarCollapsed', '0'));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => {
    const toolbar = document.getElementById('toolbar');
    return !document.documentElement.classList.contains('app-booting') &&
      toolbar && !toolbar.classList.contains('collapsed') &&
      document.getElementById('map-legend').getBoundingClientRect().height > 0;
  });

  const legend = page.locator('#map-legend');
  const before = await legend.boundingBox();
  if (!before) throw new Error('legend has no box');
  await page.mouse.move(before.x + 20, before.y + 8);
  await page.mouse.down();
  await page.mouse.move(360, 820, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem('navaid.legendPos.en'))).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 664 });
  if (await page.locator('#toolbar').evaluate(el => el.classList.contains('collapsed'))) {
    await page.click('#toolbar-toggle');
  }
  await page.waitForFunction(() =>
    !document.getElementById('toolbar').classList.contains('collapsed'));
  let priorGeometry = '';
  await expect.poll(async () => {
    const { legend: l, intersects, viewport: v } = await mobileChromeGeometry(page);
    const geometry = [l.left, l.top, l.width, l.height].map(Math.round).join(':');
    const stable = geometry === priorGeometry;
    priorGeometry = geometry;
    return stable && l.left >= -1 && l.top >= -1 && l.right <= v.width + 1 &&
      l.bottom <= v.height + 1 && !intersects;
  }, { intervals: [50, 50, 100] }).toBe(true);
  expectLegendUsable(await mobileChromeGeometry(page));
  const reconciled = await legend.boundingBox();
  if (!reconciled) throw new Error('legend has no reconciled box');

  await page.reload();
  await page.waitForFunction(() =>
    !document.documentElement.classList.contains('app-booting') &&
    document.getElementById('map-legend')?.getBoundingClientRect().height > 0);
  expectLegendUsable(await mobileChromeGeometry(page));
  const restored = await legend.boundingBox();
  if (!restored) throw new Error('legend has no restored box');
  expect(Math.abs(restored.x - reconciled.x)).toBeLessThan(3);
  expect(Math.abs(restored.y - reconciled.y)).toBeLessThan(3);
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

test('the phone bottom band does not pile up legend, chip, coords and attribution', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function');
  const boxes = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs(); state.mode = 'add'; draw();
    if (typeof refreshModeChip === 'function') refreshModeChip();
    const get = sel => { const e = document.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect(); return r.height ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null; };
    return { legend: get('#map-legend'), chip: get('#mode-chip'),
             coord: get('#coord-readout'), attrib: get('.leaflet-control-attribution') };
  });
  const hits = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  expect(boxes.legend).not.toBeNull();
  expect(boxes.attrib).not.toBeNull();
  // The legend must sit clear of the attribution, which wraps to two lines here.
  expect(boxes.legend.bottom).toBeLessThanOrEqual(boxes.attrib.top + 1);
  if (boxes.chip) {
    expect(hits(boxes.chip, boxes.legend)).toBe(false);
    expect(hits(boxes.chip, boxes.coord)).toBe(false);
  }
});

test('the collapsed phone toolbar is no taller than its four visible rows', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('toolbar-toggle'));
  const out = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    const r = tb.getBoundingClientRect();
    const rows = [...tb.children].filter(c => c.getBoundingClientRect().height > 0);
    const rowSum = rows.reduce((a, c) => a + c.getBoundingClientRect().height, 0);
    return { h: r.height, rowSum, rows: rows.length };
  });
  // Was 200px around ~160px of content; allow gaps + padding, not 40px of void.
  expect(out.h).toBeLessThanOrEqual(out.rowSum + 24);
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
