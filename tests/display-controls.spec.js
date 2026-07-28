// @ts-check
// Display-section controls: leg-arrow opacity and colour, label colour, and the
// leg-arrow size range. It writes the same
// tune key every drawing path reads, so one number drives the screen, the PNG export
// and the print sheet — there is no separate paper value to drift.
const { test, expect } = require('./_setup');
const { showToolbarControl } = require('./_toolbar');

async function boot(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function' && typeof draw === 'function');
}

test('Display rows run map -> waypoint trio -> leg-arrow trio', async ({ page }) => {
  await boot(page);
  await showToolbarControl(page, '#kite-alpha');
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tb-section[data-sec="display"] .navtoggle')];
    const idx = s => rows.findIndex(row => row.querySelector(s));
    const el = document.getElementById('kite-alpha');
    const text = sel => document.querySelector(sel).closest('.navtoggle')
      .textContent.trim().split('\n')[0];
    return { mapOp: idx('#map-opacity'),
      wpAlpha: idx('#yellow-alpha'), wpColor: idx('#waypoint-color'), wpSize: idx('#wp-size'),
      legSize: idx('#leg-arrow-size'), legAlpha: idx('#kite-alpha'), legColor: idx('#leg-arrow-color'),
      lineWidth: idx('#leg-line-width'),
      min: el.min, max: el.max, step: el.step,
      wpAlphaText: text('#yellow-alpha'), wpColorText: text('#waypoint-color'),
      legAlphaText: text('#kite-alpha'),
      hasReset: !!el.parentElement.querySelector('.slider-reset'),
      valueShown: document.getElementById('kite-alpha-val').textContent,
      separators: document.querySelectorAll('.tb-section[data-sec="display"] .tb-group-separator').length,
      sepVisible: (() => {
        const sep = document.querySelector('.tb-section[data-sec="display"] .tb-group-separator');
        const cs = getComputedStyle(sep);
        return cs.display !== 'none' && parseFloat(cs.height) > 0;
      })() };
  });
  expect(r.mapOp).toBe(0);                          // map opacity first, on its own
  // waypoint trio: size, opacity, colour
  expect(r.wpAlpha).toBe(r.wpSize + 1);
  expect(r.wpColor).toBe(r.wpAlpha + 1);
  // leg-arrow trio: the same size, opacity, colour order
  expect(r.legSize).toBe(r.wpColor + 1);
  expect(r.legAlpha).toBe(r.legSize + 1);
  expect(r.legColor).toBe(r.legAlpha + 1);
  expect(r.lineWidth).toBeGreaterThan(r.legColor);
  // and the groups are separated by rules
  expect(r.separators).toBe(3);
  expect(r.sepVisible).toBe(true);
  expect([r.min, r.max, r.step]).toEqual(['0', '100', '5']);
  expect(r.wpAlphaText).toMatch(/Waypoint opacity/);
  expect(r.wpColorText).toMatch(/Waypoint color/);
  expect(r.legAlphaText).toMatch(/Leg arrow opacity/);   // "Leg arrow", never "Nav arrow"
  expect(r.hasReset).toBe(true);
  expect(r.valueShown).toMatch(/%$/);
});

test('every size / width slider has its default in the middle', async ({ page }) => {
  // These all used to start at their shipped value: leg-arrow size 1 on a 1..3 range,
  // leg line width 0.5 on 0.1..2 (21% along), drift width 1 on 0.5..6 (9% along) — so
  // each slider could enlarge but barely reduce.
  await boot(page);
  const r = await page.evaluate(() => {
    const check = (id, dflt) => {
      const el = document.getElementById(id);
      const min = parseFloat(el.min), max = parseFloat(el.max), step = parseFloat(el.step);
      return { id, min, max, mid: (min + max) / 2, dflt, step,
        onGrid: Math.abs(((dflt - min) / step) % 1) < 1e-9,
        canShrink: min < dflt, canGrow: max > dflt };
    };
    return [check('leg-arrow-size', 1), check('leg-line-width', 0.5), check('drift-line-width', 1)];
  });
  for (const c of r) {
    expect(c.mid, c.id).toBeCloseTo(c.dflt, 6);   // centred, not at an end
    expect(c.onGrid, c.id).toBe(true);            // and landing exactly on a tick
    expect(c.canShrink, c.id).toBe(true);
    expect(c.canGrow, c.id).toBe(true);
  }
});

test('waypoint colour drives the fill the waypoints are actually drawn with', async ({ page }) => {
  // It first pointed at labelFillColor, which nothing draws with (yellowFill() has no
  // callers) — so the picker moved a value and the map never changed.
  await boot(page);
  const r = await page.evaluate(() => {
    const el = document.getElementById('waypoint-color');
    el.value = '#123456';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { waypointFill: tune('waypointFillColor'),
      // the exact expression drawWaypoints() uses for the label/disc background
      drawn: tintFill(tune('waypointFillColor')),
      stored: localStorage.getItem('navaid.waypointColor') };
  });
  expect(r.waypointFill).toBe('#123456');
  expect(r.drawn).toContain('18,52,86');
  expect(r.stored).toBe('#123456');
});

test('leg-arrow colour covers the cumulative arrow too, but not the return arrows', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const before = { ret: tune('returnKiteFillColor'), retCum: tune('returnCumKiteFillColor') };
    const el = document.getElementById('leg-arrow-color');
    el.value = '#abcdef';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { leg: tune('legKiteFillColor'), cum: tune('cumKiteFillColor'),
      legFill: tintFill(tune('legKiteFillColor'), tune('kiteNoteAlpha')),
      cumFill: tintFill(tune('cumKiteFillColor'), tune('kiteNoteAlpha')),
      ret: tune('returnKiteFillColor'), retCum: tune('returnCumKiteFillColor'), before,
      stored: localStorage.getItem('navaid.legArrowColor') };
  });
  expect(r.leg).toBe('#abcdef');
  expect(r.cum).toBe('#abcdef');                    // the cum arrow follows
  expect(r.legFill).toContain('171,205,239');
  expect(r.cumFill).toContain('171,205,239');
  expect(r.ret).toBe(r.before.ret);                 // return arrows keep their own colours
  expect(r.retCum).toBe(r.before.retCum);
  expect(r.stored).toBe('#abcdef');
});

test('leg-arrow size scales the cumulative arrow as well', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.86, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'B' }];
    state.legs = []; syncLegs(); window.showCumTime = true; draw();
    const at = v => { window.legArrowSize = v; return { leg: legZoomScale(), cum: cumKiteDrawScale() }; };
    const small = at(0.5), big = at(1.5);
    window.legArrowSize = 1;
    return { small, big };
  });
  expect(r.big.leg / r.small.leg).toBeCloseTo(3, 5);
  expect(r.big.cum / r.small.cum).toBeCloseTo(3, 5);   // same selector drives both
});

test('a colour picker reset returns to the shipped colour', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const el = document.getElementById('leg-arrow-color');
    const shipped = tune('legKiteFillColor');
    const shippedCum = tune('cumKiteFillColor');
    el.value = '#ff0000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const changed = tune('legKiteFillColor');
    el.parentElement.querySelector('.slider-reset').click();
    return { shipped, shippedCum, changed, afterReset: tune('legKiteFillColor'),
      afterResetCum: tune('cumKiteFillColor'),
      stored: localStorage.getItem('navaid.legArrowColor') };
  });
  expect(r.changed).toBe('#ff0000');
  expect(r.afterReset).toBe(r.shipped);
  expect(r.afterResetCum).toBe(r.shippedCum);      // both keys restored
  expect(r.stored).toBeNull();
});

test('moving it changes the fill every drawing path uses', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const el = document.getElementById('kite-alpha');
    const fill = () => tintFill(tune('legKiteFillColor'), tune('kiteNoteAlpha'));
    const before = { alpha: tune('kiteNoteAlpha'), fill: fill() };
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const after = { alpha: tune('kiteNoteAlpha'), fill: fill(),
      shown: document.getElementById('kite-alpha-val').textContent,
      stored: localStorage.getItem('navaid.legArrowAlpha') };
    return { before, after };
  });
  expect(r.after.alpha).toBeCloseTo(0.2, 5);
  expect(r.after.fill).toContain('0.2');
  expect(r.after.shown).toBe('20%');
  expect(parseFloat(r.after.stored)).toBeCloseTo(0.2, 5);
  expect(r.after.fill).not.toBe(r.before.fill);
});

test('the value the export and print render with is the slider value', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const el = document.getElementById('kite-alpha');
    el.value = '35';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // These are the exact expressions draw.js uses for the leg kite, the cumulative
    // kite, the return kites and notes — the same code runs for screen and export.
    return {
      leg: tintFill(tune('legKiteFillColor'), tune('kiteNoteAlpha')),
      cum: tintFill(tune('cumKiteFillColor'), tune('kiteNoteAlpha')),
      ret: tintFill(tune('returnKiteFillColor'), tune('kiteNoteAlpha')),
      exporting: !!(window.NavAid && NavAid.exporting),
    };
  });
  for (const k of ['leg', 'cum', 'ret']) expect(r[k]).toContain('0.35');
  expect(r.exporting).toBe(false);            // same value with no export-only branch
});

test('it survives a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const el = document.getElementById('kite-alpha');
    el.value = '15';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.reload();
  await page.waitForFunction(() => typeof tune === 'function');
  const r = await page.evaluate(() => ({ alpha: tune('kiteNoteAlpha'),
    slider: document.getElementById('kite-alpha').value,
    shown: document.getElementById('kite-alpha-val').textContent }));
  expect(r.alpha).toBeCloseTo(0.15, 5);
  expect(r.slider).toBe('15');
  expect(r.shown).toBe('15%');
});

test('reset returns to the gist / shipped default, not a hardcoded 50%', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // pretend the gist shipped 0.65, the way loadRemoteConfig would
    setTune('kiteNoteAlpha', 0.65);
    syncKiteAlphaSlider(true);
    const gistShown = document.getElementById('kite-alpha').value;
    const el = document.getElementById('kite-alpha');
    el.value = '10';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const chosen = tune('kiteNoteAlpha');
    el.parentElement.querySelector('.slider-reset').click();
    return { gistShown, chosen, afterReset: tune('kiteNoteAlpha'),
      slider: el.value, stored: localStorage.getItem('navaid.legArrowAlpha') };
  });
  expect(r.gistShown).toBe('65');
  expect(r.chosen).toBeCloseTo(0.1, 5);
  expect(r.afterReset).toBeCloseTo(0.65, 5);   // back to the gist value
  expect(r.slider).toBe('65');
  expect(r.stored).toBeNull();                 // and the override is cleared
});

test('a pilot choice outranks a later gist value', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const el = document.getElementById('kite-alpha');
    el.value = '25';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // gist lands afterwards with a different value
    setTune('kiteNoteAlpha', 0.7);
    syncKiteAlphaSlider(true);
    return { slider: el.value, gistRemembered: gistKiteAlpha };
  });
  expect(r.slider).toBe('25');                 // slider left alone
  expect(r.gistRemembered).toBeCloseTo(0.7, 5);// but reset would go to the gist value
});

test('waypoint size does not move or resize the cumulative arrow', async ({ page }) => {
  // The cumulative arrow belongs to the leg-arrow controls. Its default offset used to
  // include the LIVE waypoint disc radius, so dragging Waypoint size slid the arrow
  // outwards — one slider moving another slider's marker.
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.86, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'B' }];
    state.legs = []; syncLegs(); window.showCumTime = true;
    map.setView([32.2, 34.88], 11, { animate: false });
    const probe = () => {
      draw();
      const c = cumLabelCenter(0), b = proj(state.waypoints[1]);
      const h = _cumKiteHalfDims();
      return { scale: cumKiteDrawScale(), offset: Math.hypot(c.x - b.x, c.y - b.y),
        halfW: h.halfW, discR: waypointDiscRadiusPx() };
    };
    window.wpSize = 1; window.legArrowSize = 1;
    const base = probe();
    window.wpSize = 1.8;
    const bigWp = probe();
    window.wpSize = 0.4;
    const smallWp = probe();
    window.wpSize = 1;
    const bigArrow = (window.legArrowSize = 1.8, probe());
    window.legArrowSize = 1;
    return { base, bigWp, smallWp, bigArrow };
  });
  // waypoint size: no effect on the arrow at all now
  expect(r.bigWp.offset).toBeCloseTo(r.base.offset, 3);
  expect(r.smallWp.offset).toBeCloseTo(r.base.offset, 3);
  expect(r.bigWp.scale).toBeCloseTo(r.base.scale, 6);
  // ...and the biggest disc still cannot reach the arrow
  expect(r.bigWp.offset - r.bigWp.halfW).toBeGreaterThan(r.bigWp.discR);
  // leg-arrow size still drives both its size and its clearance
  expect(r.bigArrow.scale).toBeGreaterThan(r.base.scale);
  expect(r.bigArrow.offset).toBeGreaterThan(r.base.offset);
});

test('the standard marker is visible and not clipped', async ({ page }) => {
  await boot(page);
  await showToolbarControl(page, '#leg-arrow-size');
  const r = await page.evaluate(() => {
    const read = id => {
      const el = document.getElementById(id + '-val');
      return { text: el.textContent, clipped: el.scrollWidth > el.clientWidth + 1 };
    };
    const before = { wp: read('wp-size'), leg: read('leg-arrow-size') };
    // move off the standard, then back
    const el = document.getElementById('leg-arrow-size');
    el.value = '0.6'; el.dispatchEvent(new Event('input', { bubbles: true }));
    const off = read('leg-arrow-size');
    el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true }));
    return { before, off, back: read('leg-arrow-size') };
  });
  expect(r.before.wp.text).toMatch(/standard/);
  expect(r.before.leg.text).toMatch(/standard/);
  expect(r.before.leg.clipped).toBe(false);      // the suffix must actually be readable
  expect(r.off.text).toBe('0.60');               // silent when off-standard? no — plain number
  expect(r.off.text).not.toMatch(/standard/);
  expect(r.back.text).toMatch(/standard/);
  expect(r.back.clipped).toBe(false);
});
