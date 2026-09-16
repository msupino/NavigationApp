// @ts-check
// A cumulative time counts from the departure field by definition. That is the wrong answer for
// a pilot joining somebody else's plan part-way, or picking the route up at a reporting point:
// the times they want are the ones from where they actually start. One waypoint on the route
// carries the mark, and both places that print a cumulative time read it.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog) && typeof draw === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => {
    state.waypoints = [
      { name: 'LLHZ', lat: 32.17944, lng: 34.83444 },
      { name: 'A', lat: 32.45, lng: 35.0 },
      { name: 'B', lat: 32.7, lng: 35.25 },
      { name: 'LLIB', lat: 32.98111, lng: 35.57194 },
    ];
    syncLegs();
    for (const leg of state.legs) { leg.inboundAltitude = 3000; leg.flightSpeed = 90; }
    draw();
  });
}

const cumTimes = (page) => page.evaluate(() =>
  NavAid.navLog.rows().map(r => r.cumTimeH));

test('with no mark, the clock counts from the departure field', async ({ page }) => {
  await boot(page);
  const cum = await cumTimes(page);
  expect(cum.every(v => typeof v === 'number')).toBe(true);
  // Monotonic, and the first row is its own time.
  for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
});

test('a marked waypoint restarts the clock, and the rows before it have none', async ({ page }) => {
  await boot(page);
  const before = await cumTimes(page);
  await page.evaluate(() => { setTimerWaypoint(2); draw(); });
  const rows = await page.evaluate(() => NavAid.navLog.rows().map(r =>
    ({ leg: r.legIndex, cum: r.cumTimeH, zero: !!r.timerStartsHere, t: r.timeH })));

  // Nothing before the mark has a cumulative time to show...
  const early = rows.filter(r => r.leg < 1);
  expect(early.length).toBeGreaterThan(0);
  for (const r of early) expect(r.cum).toBeNull();

  // ...the row that ENDS on it reads zero, exactly once...
  expect(rows.filter(r => r.zero)).toHaveLength(1);
  const zero = rows.find(r => r.zero);
  expect(zero.leg).toBe(1);
  expect(zero.cum).toBe(0);

  // ...and the rest count from there: the first counted row's cum is its own leg time.
  const after = rows.filter(r => r.leg >= 2);
  expect(after.length).toBeGreaterThan(0);
  expect(after[0].cum).toBeCloseTo(after[0].t, 6);
  // Which is less than it was when the clock ran from departure.
  expect(after[0].cum).toBeLessThan(before[before.length - 1]);
});

// Cumulative fuel is the reserve figure, burned from the departure field whatever the clock does.
test('the fuel keeps counting from departure', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => NavAid.navLog.rows().map(r => r.cumFuelGal));
  await page.evaluate(() => { setTimerWaypoint(2); draw(); });
  const after = await page.evaluate(() => NavAid.navLog.rows().map(r => r.cumFuelGal));
  expect(after).toEqual(before);
});

test('the sheet prints a dash before it and a mark on it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTimerWaypoint(2); draw(); NavAid.navLog.show(); });
  await page.waitForSelector('.navlog-table');
  const col = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.navlog-table tr')[0].children].map(t => t.textContent);
    const at = heads.indexOf('Cum time');
    return [...document.querySelectorAll('.navlog-table tr.navlog-row')]
      .map(tr => tr.children[at].textContent.trim());
  });
  expect(col[0]).toBe('—');
  expect(col.some(v => v.startsWith('▶'))).toBe(true);
  expect(col[col.length - 1]).toMatch(/^\d+:\d\d$/);
});

// One per route: two origins would make "cumulative" mean nothing.
test('only one waypoint can hold it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTimerWaypoint(1); setTimerWaypoint(2); });
  expect(await page.evaluate(() => state.waypoints.map(w => !!w.timerStart)))
    .toEqual([false, false, true, false]);
  expect(await page.evaluate(() => routeTimerIndex())).toBe(2);
});

// Pressing it again on the point that holds it hands the clock back to the departure field.
test('pressing it again clears it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setTimerWaypoint(2));
  await page.evaluate(() => setTimerWaypoint(2));
  expect(await page.evaluate(() => routeTimerIndex())).toBe(-1);
});

// The departure point is not a mark: the clock already starts there.
test('the departure field is not offered it', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => setTimerWaypoint(0))).toBe(false);
  expect(await page.evaluate(() => routeTimerIndex())).toBe(-1);
});

test('the inspector offers it, says when it is set, and takes it back', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.selected = { type: 'wp', index: 2 }; showInspector(); });
  const btn = page.locator('#insp-timer-btn');
  await expect(btn).toHaveText('⏱ Start the clock here');
  await expect(page.locator('#insp-timer-status')).toHaveCount(0);
  await btn.click();
  expect(await page.evaluate(() => routeTimerIndex())).toBe(2);
  await expect(page.locator('#insp-timer-status')).toBeVisible();
  await expect(btn).toHaveText('⏱ Count from departure again');
  await btn.click();
  expect(await page.evaluate(() => routeTimerIndex())).toBe(-1);
  await expect(page.locator('#insp-timer-status')).toHaveCount(0);
});

test('the departure waypoint gets no such button', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.selected = { type: 'wp', index: 0 }; showInspector(); });
  await expect(page.locator('#insp-timer-btn')).toHaveCount(0);
});

// Three places rebuild a waypoint field by field, and anything not named there is dropped --
// which is how a marked turning point used to vanish on every reload.
test('the mark survives a save and a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTimerWaypoint(2); persist(); });
  const inFile = await page.evaluate(() => serializeRoute().waypoints.map(w => !!w.timerStart));
  expect(inFile).toEqual([false, false, true, false]);
  await page.reload();
  await page.waitForFunction(() => typeof routeTimerIndex === 'function' && state.waypoints.length === 4);
  expect(await page.evaluate(() => routeTimerIndex())).toBe(2);
});

// The map prints the same clock on its cumulative kites, so it has to read the same mark --
// two displays counting from different points would be worse than one of them being wrong.
test('the map kites count from the mark too', async ({ page }) => {
  await boot(page);
  const labels = () => page.evaluate(() => {
    const seen = [];
    const orig = window.drawCumTimeArrow;
    window.drawCumTimeArrow = (cx, cy, ang, cumTime, ...rest) => {
      seen.push(cumTime);
      return orig.call(null, cx, cy, ang, cumTime, ...rest);
    };
    draw();
    window.drawCumTimeArrow = orig;
    return seen;
  });
  await page.evaluate(() => { showCumTime = true; draw(); });
  const before = await labels();
  expect(before.length).toBe(3);                    // one per leg
  expect(before.every(t => t !== '--')).toBe(true);

  await page.evaluate(() => { setTimerWaypoint(2); draw(); });
  const after = await labels();
  // Legs 0 and 1 run before the mark, so they get no kite at all -- not a kite reading '--'.
  // That is the treatment a leg inside the departure CTR already gets, and the reason the
  // departure airfield has none: a label that says nothing is a label to read and discard.
  expect(after).toHaveLength(1);
  // The one that remains starts on the mark, so it reads its own leg time -- less than it read
  // when the clock ran from departure.
  expect(after[0]).not.toBe('--');
  expect(after[0]).not.toBe(before[2]);
});

// The kite you cannot see is a kite you cannot drag: the drawing and the hit test read one
// predicate, so they cannot disagree about which legs have one.
test('a leg with no cum kite offers nothing to grab', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { showCumTime = true; setTimerWaypoint(2); draw(); });
  const boxes = await page.evaluate(() => {
    const seen = [];
    const orig = window.cumLabelCenter;
    if (typeof orig !== 'function') return null;
    window.cumLabelCenter = (i, ...rest) => { seen.push(i); return orig.call(null, i, ...rest); };
    if (typeof routeInkRects === 'function') routeInkRects();
    window.cumLabelCenter = orig;
    return seen;
  });
  if (boxes !== null) for (const i of boxes) expect(i).toBeGreaterThanOrEqual(2);
});

// Found in review, all four introduced or widened by the change above.
test.describe('what the review found', () => {
  // The inbound hit test knew about CTR legs and not about the mark, so the legs before it kept
  // a kite that is never drawn -- sitting right over the leg's own endpoint waypoint. The
  // comment there had already been written about exactly this, for the CTR case.
  test('a kite that is not drawn cannot be grabbed', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { showCumTime = true; draw(); });
    // Where leg 0's cum kite sits while the clock runs from departure.
    const spot = await page.evaluate(() => {
      const c = cumLabelCenter(0);
      return c ? { x: Math.round(c.x), y: Math.round(c.y) } : null;
    });
    expect(spot).not.toBeNull();
    expect(await page.evaluate(p => !!hitCumLabel(p.x, p.y), spot)).toBe(true);
    // Start the clock later: leg 0 draws no kite, so nothing there is grabbable.
    await page.evaluate(() => { setTimerWaypoint(2); draw(); });
    expect(await page.evaluate(p => hitCumLabel(p.x, p.y), spot)).toBeNull();
  });

  // The return kite is drawn whenever the return path is -- its own clock, counted backwards
  // from the last waypoint -- so the inbound clock's gate is not its to answer to.
  test('a return kite that IS drawn is counted in the page bounds', async ({ page }) => {
    await boot(page);
    const counted = await page.evaluate(() => {
      showCumTime = true;
      window.showReturnFeatureOn = () => true;
      showReturn = true;
      for (const l of state.legs) { l.outboundAltitude = 3000; l.outboundSpeed = 90; }
      setTimerWaypoint(2);
      const painted = [];
      const origArrow = window.drawCumTimeArrow;
      window.drawCumTimeArrow = (...a) => { painted.push(a[3]); return origArrow.apply(null, a); };
      draw();
      window.drawCumTimeArrow = origArrow;
      const box = { in: [], ret: [] };
      const oIn = window.cumLabelCenter, oRet = window.cumLabelRetCenter;
      window.cumLabelCenter = (i, ...r) => { box.in.push(i); return oIn.call(null, i, ...r); };
      window.cumLabelRetCenter = (i, ...r) => { box.ret.push(i); return oRet.call(null, i, ...r); };
      routeInkRects();
      window.cumLabelCenter = oIn; window.cumLabelRetCenter = oRet;
      return { painted: painted.length, box, legs: state.legs.length };
    });
    // One inbound kite (the only leg on the clock) and one return kite per leg.
    expect(counted.painted).toBe(1 + counted.legs);
    expect(counted.box.in).toEqual([2]);                       // only the leg that draws one
    expect(counted.box.ret).toEqual([0, 1, 2]);                // every return kite that is drawn
  });

  // cells() is what exportCsv writes. An em dash and a play glyph are not times.
  test('the CSV carries values, not typography', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => setTimerWaypoint(2));
    const col = await page.evaluate(() => {
      const saved = window.saveFile;
      window.saveFile = () => {};
      const text = NavAid.navLog.exportCsv();
      window.saveFile = saved;
      const head = text.split('\n')[0].split(',');
      const at = head.indexOf('Cum time');
      return text.split('\n').slice(1).map(l => l.split(',')[at]);
    });
    for (const cell of col) expect(cell).not.toMatch(/[—▶]/);
    expect(col[0]).toBe('');            // the clock had not started
    expect(col[col.length - 1]).toMatch(/^\d+:\d\d$/);
    // ...while the table still says which is which.
    await page.evaluate(() => NavAid.navLog.show());
    await page.waitForSelector('.navlog-table');
    const shown = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.navlog-table tr')[0].children].map(t => t.textContent);
      const at = heads.indexOf('Cum time');
      return [...document.querySelectorAll('.navlog-table tr.navlog-row')]
        .map(tr => tr.children[at].textContent.trim());
    });
    expect(shown[0]).toBe('—');
    expect(shown.some(v => v.startsWith('▶'))).toBe(true);
  });

  // The button named a level the route no longer needed. It always ADDED the right one.
  test('the Add button keeps naming the level it will actually add', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => NavAid.navLog.show());
    await page.waitForSelector('.navlog-table');
    const titleNow = () => page.locator('.navlog-add').getAttribute('title');
    const before = await titleNow();
    // Change the route under the open window: different levels, so a different next level.
    await page.evaluate(() => {
      for (const l of state.legs) l.inboundAltitude = 8500;
      syncLegs();
      draw();
      NavAid.navLog.routeChanged();
    });
    const after = await titleNow();
    expect(after).not.toBe(before);
    // ...and what it says is what it does.
    const named = Number(String(after).replace(/[^0-9]/g, ''));
    await page.locator('.navlog-add').click();
    expect(await page.evaluate(() => NavAid.navLog.config().met.map(r => r.alt))).toContain(named);
  });
});

// A second review, of the fixes above. Three more, all in or beside what they touched.
test.describe('what the second review found', () => {
  const inkProbe = (page, setup) => page.evaluate((body) => {
    eval(body);
    const seen = { in: [], out: [], cumIn: [], cumRet: [] };
    const o = {
      legLabelCenter: window.legLabelCenter,
      cumLabelCenter: window.cumLabelCenter,
      cumLabelRetCenter: window.cumLabelRetCenter,
    };
    window.legLabelCenter = (i, which, ...r) => {
      seen[which === 'out' ? 'out' : 'in'].push(i);
      return o.legLabelCenter.call(null, i, which, ...r);
    };
    window.cumLabelCenter = (i, ...r) => { seen.cumIn.push(i); return o.cumLabelCenter.call(null, i, ...r); };
    window.cumLabelRetCenter = (i, ...r) => { seen.cumRet.push(i); return o.cumLabelRetCenter.call(null, i, ...r); };
    routeInkRects();
    Object.assign(window, o);
    return seen;
  }, setup);

  // The draw site checks the feature flag as well as the toggle -- "belt and braces", against a
  // stored or synced showReturn that outlived the gist switching the feature off. The ink gate
  // did not, so it counted return kites nobody paints: a larger fitted sheet than the export
  // needs, and a clipping warning for ink that is not there.
  test('a return path the gist switched off is not counted as ink', async ({ page }) => {
    await boot(page);
    const on = await inkProbe(page, `
      showCumTime = true; showReturn = true;
      window.showReturnFeatureOn = () => true;
      for (const l of state.legs) { l.outboundAltitude = 3000; l.outboundSpeed = 90; }
      draw();`);
    expect(on.out.length, 'return nav kites counted while the feature is on').toBeGreaterThan(0);
    expect(on.cumRet.length).toBeGreaterThan(0);

    const off = await inkProbe(page, `
      showCumTime = true; showReturn = true;          // stored on...
      window.showReturnFeatureOn = () => false;       // ...but switched off by the gist
      draw();`);
    expect(off.out, 'nothing is painted, so nothing may be counted').toEqual([]);
    expect(off.cumRet).toEqual([]);
    expect(off.in.length, 'the inbound side is untouched by the return flag').toBeGreaterThan(0);
  });

  // An out-and-back steps each direction to its own side. The boxes are elongated, so orienting
  // one about the unshifted waypoint gives the wrong SHAPE, not merely a few pixels of offset.
  test('the ink boxes are built on the ends the kites are drawn from', async ({ page }) => {
    await boot(page);
    const moved = await page.evaluate(() => {
      // a-b-a: the two directions of the same ground, which is what legScreenEnds steps apart.
      state.waypoints = [
        { name: 'A', lat: 32.1, lng: 34.9 },
        { name: 'B', lat: 32.6, lng: 35.2 },
        { name: 'A', lat: 32.1, lng: 34.9 },
      ];
      syncLegs();
      for (const l of state.legs) { l.inboundAltitude = 3000; l.flightSpeed = 90; }
      showCumTime = true;
      draw();
      const ends = legScreenEnds(0);
      const raw = proj(state.waypoints[1]);
      return { shifted: Math.round(Math.abs(ends.b.x - raw.x) + Math.abs(ends.b.y - raw.y)) };
    });
    // The fixture only proves anything if this route really is stepped apart.
    expect(moved.shifted, 'legScreenEnds steps an out-and-back aside').toBeGreaterThan(0);
    // Isolate the ANCHOR. The kite centres are themselves computed from legScreenEnds, so
    // moving it moves them too and any difference proves nothing; pinned to constants, the only
    // thing left that legScreenEnds can reach is the point each box is oriented about. Run it
    // with the real ends and again with them forced back to the raw waypoints: if the boxes are
    // built on the drawn ends the two differ, and if they are built on proj(wps[i]) -- which is
    // what they were -- the two are identical.
    const both = await page.evaluate(() => {
      const sum = (rs) => rs.map(r => [r.x, r.y, r.w, r.h].map(Math.round).join(',')).join('|');
      // A kite sits beside its waypoint, not across the map: the anchor sets only the ANGLE the
      // box is rotated to, so on a long lever a four-pixel step is a fifth of a degree and
      // rounds away. Pinned 40px from the waypoint, the way a real kite sits, the same step is
      // about five degrees -- which is the difference this is about.
      const near = proj(state.waypoints[1]);
      const pin = { x: near.x + 40, y: near.y + 10 };
      const saved = {
        legLabelCenter: window.legLabelCenter,
        cumLabelCenter: window.cumLabelCenter,
        cumLabelRetCenter: window.cumLabelRetCenter,
        legScreenEnds: window.legScreenEnds,
      };
      window.legLabelCenter = () => pin;
      window.cumLabelCenter = () => pin;
      window.cumLabelRetCenter = () => pin;
      const real = sum(routeInkRects());
      window.legScreenEnds = (i) => ({ a: proj(state.waypoints[i]), b: proj(state.waypoints[i + 1]) });
      const raw = sum(routeInkRects());
      Object.assign(window, saved);
      return { real, raw };
    });
    expect(both.real).not.toBe(both.raw);
  });

  // The header row is the export contract.
  test('the built-in header order matches the cells beneath it', async ({ page }) => {
    await boot(page);
    const got = await page.evaluate(() => {
      const saved = window.S.navLogHeaders;
      delete window.S.navLogHeaders;                 // a language pack that omits the key
      const fallback = NavAid.navLog.headers();
      window.S.navLogHeaders = saved;
      return { fallback, localized: saved };
    });
    expect(got.fallback).toHaveLength(23);
    expect(got.fallback).toEqual(got.localized);     // one order, not two
    expect(got.fallback[7]).toBe('W kt');            // cells() emits wind SPEED here
    expect(got.fallback[8]).toBe('W dir');
  });
});
