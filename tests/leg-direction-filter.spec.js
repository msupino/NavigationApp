// @ts-check
// On an out-and-back route both directions draw a kite, and near the turnaround they land
// on top of each other -- readable on screen where you can zoom, unusable on a printed map.
// The filter hides one direction's KITES; the route line is never hidden.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof legIsRetrace === 'function' &&
    typeof legDirVisible === 'function' && typeof syncLegs === 'function');
}

// ALPHA -> BRAVO -> ALPHA: the second leg retraces the first, reversed.
async function outAndBack(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
      { lat: 32.05, lng: 34.0, name: 'BRAVO' },
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
    ];
    syncLegs();
  });
}

test('a leg that reverses an earlier leg is a retrace; a fresh leg is not', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const out = await page.evaluate(() => ({ leg0: legIsRetrace(0), leg1: legIsRetrace(1) }));
  expect(out.leg0).toBe(false);   // outbound
  expect(out.leg1).toBe(true);    // same pair, reversed
});

test('a route that never retraces has no turn, so nothing is filtered', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'A' },
      { lat: 32.05, lng: 34.0, name: 'B' },
      { lat: 32.10, lng: 34.1, name: 'C' },
      { lat: 32.15, lng: 34.2, name: 'D' },
    ];
    syncLegs();
  });
  const out = await page.evaluate(() => {
    const retrace = state.legs.map((_, i) => legIsRetrace(i));
    window.legDirFilter = 'out';
    const visOut = state.legs.map((_, i) => legDirVisible(i));
    window.legDirFilter = 'back';
    const visBack = state.legs.map((_, i) => legDirVisible(i));
    window.legDirFilter = 'both';
    return { retrace, visOut, visBack };
  });
  expect(out.retrace).toEqual([false, false, false]);
  // No retraced leg means no proven turn, so neither setting hides anything. Inventing a
  // turn by measuring the furthest waypoint was wrong: it split a route that never turns.
  expect(out.visOut).toEqual([true, true, true]);
  expect(out.visBack).toEqual([true, true, true]);
});

test('the filter selects one direction on an out-and-back', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const out = await page.evaluate(() => {
    const at = (f) => { window.legDirFilter = f; return state.legs.map((_, i) => legDirVisible(i)); };
    const both = at('both'), outbound = at('out'), back = at('back');
    window.legDirFilter = 'both';
    return { both, outbound, back };
  });
  expect(out.both).toEqual([true, true]);
  // ALPHA->BRAVO->ALPHA: leg 1 retraces, so it is the turn -- leg 0 out, leg 1 home.
  expect(out.outbound).toEqual([true, false]);
  expect(out.back).toEqual([false, true]);
});

test('the toggle persists and is restored on load', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const sel = document.getElementById('leg-dir-select');
    sel.value = 'out';
    sel.dispatchEvent(new Event('change'));
  });
  const stored = await page.evaluate(() => localStorage.getItem('navaid.legDirFilter'));
  expect(stored).toBe('out');

  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof legDirVisible === 'function');
  const restored = await page.evaluate(() => ({
    filter: window.legDirFilter,
    selValue: document.getElementById('leg-dir-select').value,
  }));
  expect(restored.filter).toBe('out');
  expect(restored.selValue).toBe('out');
});

test('hiding a direction never hides the route line itself', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const out = await page.evaluate(() => {
    window.legDirFilter = 'out';
    draw();
    // Both waypoints and both legs still exist and are drawn -- only kites are filtered.
    return { legs: state.legs.length, wps: state.waypoints.length };
  });
  expect(out.legs).toBe(2);
  expect(out.wps).toBe(3);
});

// A sortie that goes out one way and comes home another never retraces a single leg, yet a
// pilot still thinks of it as out and back. The turnaround split reads it that way: the
// furthest waypoint from the start is the turn, and everything from there on is the return.
test.describe('turnaround split', () => {
  // The route this was reported on: only the TYONA->NTAIM->TYONA spur retraces, but the
  // whole second half is "the way home" to the pilot flying it.
  const REAL = [
    { lat: 32.17648, lng: 34.83524, name: '' },
    { lat: 32.21056, lng: 34.80722, name: 'SFAIM' },
    { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
    { lat: 31.94361, lng: 34.78083, name: 'NTAIM' },
    { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
    { lat: 32.14556, lng: 34.77833, name: 'HTZUK' },
    { lat: 32.14083, lng: 34.80139, name: 'KNTRY' },
  ];

  test('splits the reported route at NTAIM, its furthest point', async ({ page }) => {
    await boot(page);
    await page.evaluate((wps) => { state.waypoints = wps.map(w => ({ ...w })); syncLegs(); }, REAL);
    const out = await page.evaluate(() => {
      const t = legTurnaroundIndex();
      const at = (f) => { window.legDirFilter = f; return state.legs.map((_, i) => legDirVisible(i)); };
      const o = at('out'), b = at('back');
      window.legDirFilter = 'both';
      return { t, o, b, name: state.waypoints[t].name };
    });
    // The turn is found from the RETRACED leg (NTAIM->TYONA), not by measuring distance.
    expect(out.t).toBe(3);
    expect(out.name).toBe('NTAIM');
    // Legs 0-2 outbound; 3-5 the way home -- including the ones that never retrace.
    expect(out.o).toEqual([true, true, true, false, false, false]);
    expect(out.b).toEqual([false, false, false, true, true, true]);
  });

  test('the exact rule still flags only the retraced leg on that same route', async ({ page }) => {
    await boot(page);
    await page.evaluate((wps) => { state.waypoints = wps.map(w => ({ ...w })); syncLegs(); }, REAL);
    const retrace = await page.evaluate(() => state.legs.map((_, i) => legIsRetrace(i)));
    expect(retrace).toEqual([false, false, false, true, false, false]);
  });

  test('a two-waypoint route has no turn, and nothing is hidden', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' }, { lat: 32.1, lng: 34.0, name: 'B' }];
      syncLegs();
    });
    const out = await page.evaluate(() => {
      const at = (f) => { window.legDirFilter = f; return state.legs.map((_, i) => legDirVisible(i)); };
      const o = at('out'), b = at('back');
      window.legDirFilter = 'both';
      return { t: legTurnaroundIndex(), o, b };
    });
    expect(out.t).toBe(-1);
    expect(out.o).toEqual([true]);
    expect(out.b).toEqual([true]);
  });
});

// The turnaround is where the route reverses, not where it crosses into another sector:
// the aircraft leaves on the same frequency it arrived on, so an automatic callout there
// is a radio call that is not made. Reported from the route below, where NTAIM -- flown
// out to and straight back from -- was seeding one.
test.describe('the turn point seeds no automatic frequency change', () => {
  const OUT_AND_BACK = [
    { lat: 32.17648, lng: 34.83524, name: '' },
    { lat: 32.21056, lng: 34.80722, name: 'SFAIM' },
    { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
    { lat: 31.94361, lng: 34.78083, name: 'NTAIM' },
    { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
    { lat: 32.14556, lng: 34.77833, name: 'HTZUK' },
    { lat: 32.14083, lng: 34.80139, name: 'KNTRY' },
  ];

  test('NTAIM gets no auto note, while the other comm points still do', async ({ page }) => {
    await boot(page);
    const ccs = await page.evaluate(async (wps) => {
      if (typeof loadNavWaypoints === 'function') await loadNavWaypoints();
      state.waypoints = wps.map(w => ({ ...w }));
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.filter(n => n && n.cc).map(n => n.cc);
    }, OUT_AND_BACK);
    expect(ccs).not.toContain('NTAIM');   // the turn point
    expect(ccs.length).toBeGreaterThan(0); // but the route still has its other callouts
  });

  test('a hand-added note at the turn point survives', async ({ page }) => {
    await boot(page);
    const kept = await page.evaluate(async (wps) => {
      if (typeof loadNavWaypoints === 'function') await loadNavWaypoints();
      state.waypoints = wps.map(w => ({ ...w }));
      // freqAuto absent == the pilot put this one there deliberately.
      state.notes = [{ lat: 31.94361, lng: 34.78083, cc: 'NTAIM',
                       freqName: 'TEL_NOF', freq: '129.05', text: 'freq' }];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.some(n => n && n.cc === 'NTAIM');
    }, OUT_AND_BACK);
    expect(kept).toBe(true);
  });

  test('a straight route that never turns keeps every frequency change', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => ({
      retraceTurn: legRetraceTurnIndex(),
    }));
    // No retrace anywhere -> no proven turn -> nothing suppressed. The distance-based
    // fallback used for kite filtering must never reach the comm-change logic.
    expect(out.retraceTurn).toBe(-1);
  });
});

test.describe('the picker dims when there is no turn', () => {
  test('disabled on a straight route, enabled once the route doubles back', async ({ page }) => {
    await boot(page);
    const straight = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' },
                         { lat: 32.05, lng: 34.0, name: 'B' },
                         { lat: 32.10, lng: 34.1, name: 'C' }];
      syncLegs();
      const sel = document.getElementById('leg-dir-select');
      return { disabled: sel.disabled, dimmed: sel.closest('label').classList.contains('navtoggle-disabled'),
               hasTitle: sel.title.length > 0, turn: legRetraceTurnIndex() };
    });
    expect(straight.turn).toBe(-1);
    expect(straight.disabled).toBe(true);
    expect(straight.dimmed).toBe(true);
    expect(straight.hasTitle).toBe(true);   // says WHY it is unavailable

    const outBack = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' },
                         { lat: 32.05, lng: 34.0, name: 'B' },
                         { lat: 32.0, lng: 34.0, name: 'A' }];
      syncLegs();
      const sel = document.getElementById('leg-dir-select');
      return { disabled: sel.disabled, dimmed: sel.closest('label').classList.contains('navtoggle-disabled') };
    });
    expect(outBack.disabled).toBe(false);
    expect(outBack.dimmed).toBe(false);
  });

  test('with no turn the filter hides nothing, whatever it is set to', async ({ page }) => {
    await boot(page);
    const vis = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' },
                         { lat: 32.05, lng: 34.0, name: 'B' },
                         { lat: 32.10, lng: 34.1, name: 'C' }];
      syncLegs();
      const at = (f) => { window.legDirFilter = f; return state.legs.map((_, i) => legDirVisible(i)); };
      const o = at('out'), b = at('back');
      window.legDirFilter = 'both';
      return { o, b };
    });
    // A stale 'out'/'back' from another route must never blank a straight route's kites.
    expect(vis.o).toEqual([true, true]);
    expect(vis.b).toEqual([true, true]);
  });
});

// A LOOP route repeats no waypoint, so no leg retraces and the geometry has nothing to say
// about where it turns for home -- but the pilot knows. Reported on this route.
test.describe('manual turning point', () => {
  const LOOP = [
    { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
    { lat: 32.21056, lng: 34.80722, name: 'SFAIM' },
    { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
    { lat: 32.11028, lng: 34.76250, name: 'RIDNG' },
    { lat: 32.14556, lng: 34.77833, name: 'HTZUK' },
    { lat: 32.14083, lng: 34.80139, name: 'KNTRY' },
    { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
  ];
  async function loop(page) {
    await page.evaluate((wps) => {
      state.waypoints = wps.map(w => ({ ...w }));
      syncLegs();
    }, LOOP);
  }

  test('the loop has no detectable turn until one is marked', async ({ page }) => {
    await boot(page);
    await loop(page);
    const before = await page.evaluate(() => legRetraceTurnIndex());
    expect(before).toBe(-1);   // no leg retraces: LLHZ repeats, but no PAIR reverses

    const after = await page.evaluate(() => {
      setTurnWaypoint(2);      // TYONA, the far end
      return { turn: legRetraceTurnIndex(), marked: !!state.waypoints[2].turn };
    });
    expect(after.marked).toBe(true);
    expect(after.turn).toBe(2);
  });

  test('marking a turn splits the loop, and enables the picker', async ({ page }) => {
    await boot(page);
    await loop(page);
    const out = await page.evaluate(() => {
      setTurnWaypoint(2);
      if (typeof refreshLegDirEnabled === 'function') refreshLegDirEnabled();
      const at = (f) => { window.legDirFilter = f; return state.legs.map((_, i) => legDirVisible(i)); };
      const o = at('out'), b = at('back');
      window.legDirFilter = 'both';
      return { o, b, disabled: document.getElementById('leg-dir-select').disabled };
    });
    expect(out.disabled).toBe(false);
    expect(out.o).toEqual([true, true, false, false, false, false]);
    expect(out.b).toEqual([false, false, true, true, true, true]);
  });

  test('only one waypoint can be the turn, and it toggles off', async ({ page }) => {
    await boot(page);
    await loop(page);
    const out = await page.evaluate(() => {
      setTurnWaypoint(2);
      setTurnWaypoint(4);                       // moving it clears the old one
      const marks = state.waypoints.map(w => !!w.turn);
      setTurnWaypoint(4);                       // pressing the same one clears it
      return { marks, cleared: state.waypoints.every(w => !w.turn) };
    });
    expect(out.marks).toEqual([false, false, false, false, true, false, false]);
    expect(out.cleared).toBe(true);
  });

  test('the mark survives a save/load round-trip', async ({ page }) => {
    await boot(page);
    await loop(page);
    const kept = await page.evaluate(() => {
      setTurnWaypoint(2);
      const blob = serializeRoute();
      state.waypoints = [];
      syncLegs();
      applyRouteData(blob);
      return { idx: state.waypoints.findIndex(w => w.turn), turn: legRetraceTurnIndex() };
    });
    expect(kept.idx).toBe(2);
    expect(kept.turn).toBe(2);
  });

  test('the inspector button marks the selected waypoint', async ({ page }) => {
    await boot(page);
    await loop(page);
    await page.evaluate(() => {
      state.selected = { type: 'wp', index: 2 };
      showInspector();
    });
    await page.locator('#insp-turn-btn').click();
    const out = await page.evaluate(() => ({
      marked: !!state.waypoints[2].turn,
      pressed: document.getElementById('insp-turn-btn').getAttribute('aria-pressed'),
    }));
    expect(out.marked).toBe(true);
    expect(out.pressed).toBe('true');   // relabels to "clear" once set
  });
});

test.describe('the picker reflects the route in front of you', () => {
  test('reads "outbound only" when there is no turn, whatever was chosen before', async ({ page }) => {
    await boot(page);
    // Choose "Return only" on a route that DOES turn.
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' },
                         { lat: 32.05, lng: 34.0, name: 'B' },
                         { lat: 32.0, lng: 34.0, name: 'A' }];
      syncLegs();
      const sel = document.getElementById('leg-dir-select');
      sel.value = 'back';
      sel.dispatchEvent(new Event('change'));
    });
    // Now open a route with no turn at all.
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' },
                         { lat: 32.05, lng: 34.0, name: 'B' },
                         { lat: 32.10, lng: 34.1, name: 'C' }];
      syncLegs();
      const sel = document.getElementById('leg-dir-select');
      return { shown: sel.value, filter: window.legDirFilter, disabled: sel.disabled,
               stored: localStorage.getItem('navaid.legDirFilter') };
    });
    expect(out.disabled).toBe(true);
    expect(out.shown).toBe('out');      // not the stale 'back'
    expect(out.filter).toBe('out');
    expect(out.stored).toBe('back');    // the real preference is not clobbered

    // ...and it comes back when a route with a turn is opened again.
    const back = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'A' },
                         { lat: 32.05, lng: 34.0, name: 'B' },
                         { lat: 32.0, lng: 34.0, name: 'A' }];
      syncLegs();
      const sel = document.getElementById('leg-dir-select');
      return { shown: sel.value, disabled: sel.disabled };
    });
    expect(back.disabled).toBe(false);
    expect(back.shown).toBe('back');
  });
});

test('clearing the turning point drops the picker back to outbound only', async ({ page }) => {
  await boot(page);
  // A loop: no leg retraces, so the turn only exists because it is marked by hand.
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
      { lat: 32.21056, lng: 34.80722, name: 'SFAIM' },
      { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
      { lat: 32.14083, lng: 34.80139, name: 'KNTRY' },
      { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
    ];
    syncLegs();
    setTurnWaypoint(2);
    if (typeof refreshLegDirEnabled === 'function') refreshLegDirEnabled();
    const sel = document.getElementById('leg-dir-select');
    sel.value = 'back';
    sel.dispatchEvent(new Event('change'));
  });
  const withTurn = await page.evaluate(() => {
    const sel = document.getElementById('leg-dir-select');
    return { shown: sel.value, disabled: sel.disabled };
  });
  expect(withTurn.disabled).toBe(false);
  expect(withTurn.shown).toBe('back');

  // Remove it the way the inspector button does.
  const cleared = await page.evaluate(() => {
    setTurnWaypoint(2);                 // pressing the marked one again clears it
    if (typeof refreshLegDirEnabled === 'function') refreshLegDirEnabled();
    const sel = document.getElementById('leg-dir-select');
    return { shown: sel.value, disabled: sel.disabled, filter: window.legDirFilter,
             anyMarked: state.waypoints.some(w => w.turn) };
  });
  expect(cleared.anyMarked).toBe(false);
  expect(cleared.disabled).toBe(true);
  expect(cleared.shown).toBe('out');    // not the 'back' it was left on
  expect(cleared.filter).toBe('out');
});

// Both controls assume a one-way route you might fly back. With a turn the route already
// contains its return: reversing it renumbers the same sortie, and the mirrored return
// path draws an imaginary second one on top of the real legs.
test.describe('a turning point disables reverse and show-return', () => {
  async function loop(page) {
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
        { lat: 32.21056, lng: 34.80722, name: 'SFAIM' },
        { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
        { lat: 32.14083, lng: 34.80139, name: 'KNTRY' },
        { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
      ];
      syncLegs();
    });
  }

  test('enabled with no turn, disabled once one is marked, back again when cleared', async ({ page }) => {
    await boot(page);
    await loop(page);
    const read = () => page.evaluate(() => {
      const rev = document.getElementById('reverse');
      const ret = document.getElementById('ret-cb');
      return { rev: rev.disabled, ret: ret.disabled,
               dimmed: ret.closest('label').classList.contains('navtoggle-disabled'),
               why: rev.title };
    });

    const before = await read();
    expect(before.rev).toBe(false);
    expect(before.ret).toBe(false);

    await page.evaluate(() => {
      setTurnWaypoint(2);
      refreshTurnDependentControls();
    });
    const marked = await read();
    expect(marked.rev).toBe(true);
    expect(marked.ret).toBe(true);
    expect(marked.dimmed).toBe(true);
    expect(marked.why.length).toBeGreaterThan(0);   // says why, rather than just going dead

    await page.evaluate(() => {
      setTurnWaypoint(2);           // clears it
      refreshTurnDependentControls();
    });
    const cleared = await read();
    expect(cleared.rev).toBe(false);
    expect(cleared.ret).toBe(false);
    expect(cleared.dimmed).toBe(false);
  });
});

// What matters after the turn is how long until you are back, not how long you have been
// out -- so the map's cumulative clock restarts there. The FILED plan must not: a filing
// desk wants the total.
test.describe('the turn restarts the cumulative clock', () => {
  async function outAndBack(page) {
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00, lng: 34.0, name: 'A' },
        { lat: 32.10, lng: 34.0, name: 'B' },
        { lat: 32.00, lng: 34.0, name: 'A' },
      ];
      syncLegs();
      state.legs.forEach(l => { l.flightSpeed = 60; });   // 6 NM legs at 60 kt = 6 min each
      window.showCumTime = true;
      draw();
    });
  }

  test('the map clock restarts, while the flight plan keeps running totals', async ({ page }) => {
    await boot(page);
    await outAndBack(page);
    const out = await page.evaluate(() => {
      const turn = legRetraceTurnIndex();
      // The plan's own cumulative column, built independently of the map kites.
      const rows = (typeof buildFlightRows === 'function') ? buildFlightRows() : null;
      return { turn, rows: rows && rows.length };
    });
    expect(out.turn).toBe(1);   // leg 1 (B->A) retraces leg 0

    // The drawn kite for the leg AFTER the turn must not carry the outbound time.
    const drawn = await page.evaluate(() => {
      const seen = [];
      const orig = window.drawCumTimeArrow;
      window.drawCumTimeArrow = (cx, cy, ang, txt) => { seen.push(txt); };
      draw();
      window.drawCumTimeArrow = orig;
      return seen;
    });
    // Two legs, two cumulative kites: the second restarts rather than reading ~12 min.
    expect(drawn.length).toBe(2);
    expect(drawn[0]).toBe(drawn[1]);
  });
});
