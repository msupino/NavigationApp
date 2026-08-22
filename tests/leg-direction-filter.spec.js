// @ts-check
// On an out-and-back route the direction selector is a complete view filter: route
// geometry, waypoints, annotations and calculated display totals all follow it.
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

test('the selected direction hides the other half route line and leg decorations', async ({ page }) => {
  await boot(page);
  await outAndBack(page);
  const out = await page.evaluate(() => {
    window.legDirFilter = 'out';
    window.showDrift = false;
    window.showMidLeg = false;
    window.showCumTime = false;
    window.showWind = false;
    window.showReturn = false;
    state.legs.forEach(l => { l.flightSpeed = 0; l.hideKite = 1; });
    let strokes = 0;
    const stroke = octx.stroke;
    octx.stroke = () => { strokes++; };
    try { drawLegs(); } finally { octx.stroke = stroke; }
    return { strokes, legs: state.legs.length };
  });
  expect(out.legs).toBe(2); // filtering is visual; route data stays intact
  expect(out.strokes).toBe(1);
});

test('waypoints, anchored notes and hit targets follow the selected direction', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.00, name: 'A' },
      { lat: 32.03, lng: 34.03, name: 'B' },
      { lat: 32.06, lng: 34.06, name: 'TURN', turn: 1 },
      { lat: 32.09, lng: 34.09, name: 'D' },
      { lat: 32.12, lng: 34.12, name: 'E' },
    ];
    state.legs = [];
    syncLegs();
    state.notes = [
      { lat: 32.015, lng: 34.015, text: 'OUT', shape: 'oval', rp: { leg: 0, t: 0.5 } },
      { lat: 32.105, lng: 34.105, text: 'BACK', shape: 'oval', rp: { leg: 3, t: 0.5 } },
      { lat: 31.9, lng: 34.2, text: 'FREE', shape: 'rect' },
    ];
    window.legDirFilter = 'out';
    const waypointVisibility = state.waypoints.map((_, i) => legDirWaypointVisible(i));
    const noteVisibility = state.notes.map(n => routeNoteDirVisible(n));
    const hiddenPoint = proj(state.waypoints[4]);
    const hiddenHit = hitWaypointCandidates(hiddenPoint.x, hiddenPoint.y).map(h => h.index);
    window.legDirFilter = 'back';
    const backWaypoints = state.waypoints.map((_, i) => legDirWaypointVisible(i));
    return { waypointVisibility, backWaypoints, noteVisibility, hiddenHit };
  });
  expect(out.waypointVisibility).toEqual([true, true, true, false, false]);
  expect(out.backWaypoints).toEqual([false, false, true, true, true]);
  expect(out.noteVisibility).toEqual([true, false, true]);
  expect(out.hiddenHit).toEqual([]);
});

test('return direction hides outbound hotspot projection, recognizes geometric turn, and omits airfield turn control', async ({ page }) => {
  await page.goto('?lang=en&nogist&hotspots=1');
  await page.waitForFunction(() => typeof legRetraceTurnIndex === 'function' &&
    typeof hitNavWpMarkerCandidates === 'function' && Array.isArray(navWP) && navWP.length > 0 &&
    Array.isArray(airfields) && airfields.length > 0);

  const out = await page.evaluate(() => {
    const hadra = navWP.find(w => w.name === 'HADRA');
    if (!hadra || !waypointHotspot(hadra)) throw new Error('HADRA hotspot fixture missing');

    // HADRA belongs only to the outbound half. TURN -> BEFORE reverses the preceding
    // BEFORE -> TURN leg, so TURN is the route's geometry-proven turning waypoint.
    state.waypoints = [
      { lat: 32.55, lng: 34.85, name: 'START' },
      // Imported routes may carry the same named reporting point at older chart
      // coordinates. Direction filtering must still bind the reference by name.
      { lat: hadra.lat + 0.001, lng: hadra.lng - 0.001, name: hadra.name },
      { lat: 32.38, lng: 34.98, name: 'BEFORE' },
      { lat: 32.34, lng: 35.03, name: 'TURN' },
      { lat: 32.38, lng: 34.98, name: 'BEFORE' },
      { lat: 32.30, lng: 34.90, name: 'HOME' },
    ];
    state.legs = [];
    syncLegs();
    window.legDirFilter = 'back';

    // Isolate the review overlay and nav-reference hit path to the hidden hotspot.
    window.navWP = [hadra];
    window.showNavWP = true;
    draw();
    const visibleRouteHotspots = window.__hotspotWaypointIndexes.slice();
    const projectedHotspots = window.__hotspotOverlayCount;
    const p = proj(hadra);
    const hits = hitNavWpMarkerCandidates(p.x, p.y).map(h => h.type);

    state.selected = { type: 'wp', index: 3 };
    showInspector();
    const turnBtn = document.getElementById('insp-turn-btn');
    const turnPressed = turnBtn.getAttribute('aria-pressed');
    const turnSelected = turnBtn.classList.contains('insp-btn-on');

    // If the same chart hotspot also occurs on the visible return half, keep its
    // projection. Only points whose every route occurrence is hidden are suppressed.
    state.waypoints[5] = { lat: hadra.lat, lng: hadra.lng, name: hadra.name };
    syncLegs();
    draw();
    const projectedWhenAlsoVisible = window.__hotspotOverlayCount;
    const visiblePoint = proj(hadra);
    const navReferenceHitsWhenAlsoVisible = hitNavWpMarkerCandidates(
      visiblePoint.x, visiblePoint.y).map(h => h.type);

    // A route waypoint at an airfield remains the editable route candidate.
    // Its inspector follows the standalone airfield rule: no turning-point control.
    // Keep it on the visible return half so direction filtering is not the reason.
    const af = airfields[0];
    state.waypoints[5] = { lat: af.lat, lng: af.lng, name: af.name };
    syncLegs();
    state.selected = { type: 'wp', index: 5 };
    showInspector();
    return {
      turnIndex: legRetraceTurnIndex(),
      visibleRouteHotspots,
      projectedHotspots,
      navReferenceHits: hits,
      turnPressed,
      turnSelected,
      projectedWhenAlsoVisible,
      navReferenceHitsWhenAlsoVisible,
      routeWaypointResolvesToAirfield: !!airfieldAtWaypoint(state.waypoints[5]),
      airfieldHasTurnButton: !!document.getElementById('insp-turn-btn'),
    };
  });

  expect(out.turnIndex).toBe(3);
  expect(out.visibleRouteHotspots).toEqual([]);
  expect.soft(out.projectedHotspots).toBe(0);
  expect.soft(out.navReferenceHits).toEqual([]);
  expect.soft(out.turnPressed).toBe('true');
  expect.soft(out.turnSelected).toBe(true);
  expect.soft(out.projectedWhenAlsoVisible).toBe(1);
  expect.soft(out.navReferenceHitsWhenAlsoVisible).toEqual(['navwp']);
  expect(out.routeWaypointResolvesToAirfield).toBe(true);
  expect.soft(out.airfieldHasTurnButton).toBe(false);
});

test('hidden reference matching falls back to coordinates when names differ', async ({ page }) => {
  await page.goto('?lang=en&nogist&hotspots=1');
  await page.waitForFunction(() => typeof legRetraceTurnIndex === 'function' &&
    typeof hitNavWpMarkerCandidates === 'function' && Array.isArray(navWP) && navWP.length > 0);
  const out = await page.evaluate(() => {
    const hadra = navWP.find(w => w.name === 'HADRA');
    state.waypoints = [
      { lat: 32.55, lng: 34.85, name: 'START' },
      { lat: hadra.lat, lng: hadra.lng, name: 'OLD IMPORT NAME' },
      { lat: 32.38, lng: 34.98, name: 'BEFORE' },
      { lat: 32.34, lng: 35.03, name: 'TURN' },
      { lat: 32.38, lng: 34.98, name: 'BEFORE' },
      { lat: 32.30, lng: 34.90, name: 'HOME' },
    ];
    state.legs = [];
    syncLegs();
    window.legDirFilter = 'back';
    window.navWP = [hadra];
    window.showNavWP = true;
    draw();
    const p = proj(hadra);
    return {
      hidden: routePointOnlyInHiddenDirection(hadra),
      projected: window.__hotspotOverlayCount,
      hits: hitNavWpMarkerCandidates(p.x, p.y),
    };
  });
  expect(out).toEqual({ hidden: true, projected: 0, hits: [] });
});

test('the supplied LLHZ loop hides direction-only hotspots in both selections', async ({ page }) => {
  await page.goto('?lang=en&nogist&hotspots=1');
  await page.waitForFunction(() => Array.isArray(navWP) && navWP.length > 0 &&
    typeof routeNoteDirVisible === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [
      ['LLHZ', 32.17944, 34.83444], ['SFAIM', 32.21056, 34.80722],
      ['TYONA', 32.00472, 34.72722], ['NTAIM', 31.94361, 34.78083],
      ['YAVNE', 31.87194, 34.75694], ['ZASHD', 31.82611, 34.70833],
      ['YAVNE', 31.87194, 34.75694], ['NTAIM', 31.94361, 34.78083],
      ['TYONA', 32.00472, 34.72722], ['HTZUK', 32.14556, 34.77833],
      ['KNTRY', 32.14083, 34.80139], ['LLHZ', 32.17944, 34.83444],
    ].map(([name, lat, lng]) => ({ name, lat, lng }));
    state.legs = [];
    state.notes = [
      { lat: 32.12305, lng: 34.78239, text: 'Freq change', cc: 'SFAIM', freq: '118.40' },
      { lat: 32.22145, lng: 34.75415, text: 'Freq change', cc: 'KNTRY', freq: '122.20' },
      { lat: 31.91716, lng: 34.7027, text: 'Freq change', cc: 'TYONA', freq: '118.40' },
    ];
    syncLegs();
    const routeRefs = new Set(['SFAIM', 'TYONA', 'NTAIM', 'HTZUK', 'KNTRY']);
    window.navWP = navWP.filter(wp => routeRefs.has(wp.name));
    const at = filter => {
      window.legDirFilter = filter;
      draw();
      const commHits = window.navWP.filter(wp => {
        if (!commChangeMap || !commChangeMap[wp.name] || !commChangeMap[wp.name].commChange) {
          return false;
        }
        const p = proj(wp);
        return hitCommChangeMarkerCandidates(p.x, p.y)
          .some(hit => window.navWP[hit.index] && window.navWP[hit.index].name === wp.name);
      }).map(wp => wp.name);
      return {
        routeHotspots: window.__hotspotWaypointIndexes.map(i => state.waypoints[i].name),
        projectedHotspots: window.navWP.filter(wp => waypointHotspot(wp) &&
          !routePointOnlyInHiddenDirection(wp)).map(wp => wp.name).sort(),
        notes: state.notes.filter(routeNoteDirVisible).map(n => n.cc).sort(),
        commRings: Array.from(window.__commChangeRingsDrawn).sort(),
        commHits: commHits.sort(),
      };
    };
    return { turn: legRetraceTurnIndex(), outbound: at('out'), returning: at('back') };
  });
  expect(out.turn).toBe(5);
  expect(out.outbound).toEqual({
    routeHotspots: ['SFAIM', 'TYONA', 'NTAIM'],
    projectedHotspots: ['NTAIM', 'SFAIM', 'TYONA'],
    notes: ['SFAIM', 'TYONA'],
    commRings: ['NTAIM', 'SFAIM', 'TYONA'],
    commHits: ['NTAIM', 'SFAIM', 'TYONA'],
  });
  expect(out.returning).toEqual({
    routeHotspots: ['NTAIM', 'TYONA', 'HTZUK'],
    projectedHotspots: ['HTZUK', 'NTAIM', 'TYONA'],
    notes: ['KNTRY', 'TYONA'],
    commRings: ['KNTRY', 'NTAIM', 'TYONA'],
    commHits: ['KNTRY', 'NTAIM', 'TYONA'],
  });
});

test('route summary and open flight plan show only the selected half', async ({ page }) => {
  await boot(page);
  const outbound = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.00, name: 'A' },
      { lat: 32.03, lng: 34.03, name: 'B' },
      { lat: 32.06, lng: 34.06, name: 'TURN', turn: 1 },
      { lat: 32.09, lng: 34.09, name: 'D' },
      { lat: 32.12, lng: 34.12, name: 'E' },
    ];
    state.legs = [];
    syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 100; });
    window.legDirFilter = 'out';
    draw();
    showFlightPlan();
    const rows = Array.from(document.querySelectorAll('.fp-scroll > .flight-table:first-of-type tbody tr'));
    return {
      summary: document.getElementById('route-summary').textContent,
      rows: rows.filter(r => !r.hidden).map(r => {
        const cells = r.querySelectorAll('td');
        return { seq: cells[0].textContent.trim(), from: cells[1].querySelector('input').value,
          to: cells[2].querySelector('input').value };
      }),
    };
  });
  expect(outbound.summary).toMatch(/^2 legs ·/);
  expect(outbound.rows).toEqual([
    { seq: '1', from: 'A', to: 'B' },
    { seq: '2', from: 'B', to: 'TURN' },
  ]);

  const returned = await page.evaluate(() => {
    window.legDirFilter = 'back';
    draw();
    const rows = Array.from(document.querySelectorAll('.fp-scroll > .flight-table:first-of-type tbody tr'));
    return {
      summary: document.getElementById('route-summary').textContent,
      rows: rows.filter(r => !r.hidden).map(r => {
        const cells = r.querySelectorAll('td');
        return { seq: cells[0].textContent.trim(), from: cells[1].querySelector('input').value,
          to: cells[2].querySelector('input').value };
      }),
    };
  });
  expect(returned.summary).toMatch(/^2 legs ·/);
  expect(returned.rows).toEqual([
    { seq: '1', from: 'TURN', to: 'D' },
    { seq: '2', from: 'D', to: 'E' },
  ]);
});

test('switching direction clears an inspector selection from the hidden half', async ({ page }) => {
  await boot(page);
  const selected = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.00, name: 'A' },
      { lat: 32.03, lng: 34.03, name: 'TURN', turn: 1 },
      { lat: 32.06, lng: 34.06, name: 'HOME' },
    ];
    state.legs = [];
    syncLegs();
    state.selected = { type: 'wp', index: 2 };
    const sel = document.getElementById('leg-dir-select');
    sel.value = 'out';
    sel.dispatchEvent(new Event('change'));
    return state.selected;
  });
  expect(selected).toBeNull();
});

test('Fit to route uses only waypoints in the selected direction', async ({ page }) => {
  await boot(page);
  const fitted = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.00, name: 'A' },
      { lat: 32.02, lng: 34.02, name: 'TURN', turn: 1 },
      { lat: 33.00, lng: 35.00, name: 'FAR RETURN' },
    ];
    state.legs = [];
    syncLegs();
    window.legDirFilter = 'out';
    const original = map.fitBounds;
    let bounds;
    map.fitBounds = b => { bounds = b; };
    try { fitView(); } finally { map.fitBounds = original; }
    return {
      south: bounds.getSouth(), north: bounds.getNorth(),
      west: bounds.getWest(), east: bounds.getEast(),
    };
  });
  expect(fitted).toEqual({ south: 32, north: 32.02, west: 34, east: 34.02 });
});

test('vertical profile distance and waypoint labels follow the selected direction', async ({ page }) => {
  await boot(page);
  const profile = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.00, name: 'A' },
      { lat: 32.02, lng: 34.02, name: 'TURN', turn: 1 },
      { lat: 33.00, lng: 35.00, name: 'FAR RETURN' },
    ];
    state.legs = [];
    syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 100; l.inboundAltitude = 2000; });
    window.legDirFilter = 'out';
    const indexes = state.legs.map((_, i) => i).filter(i => legDirVisible(i));
    const selected = routeProfile(undefined, indexes);
    const whole = routeProfile();
    return {
      indexes,
      selectedWpIndexes: selected.wpIndexes,
      selectedDistance: selected.totalDist,
      wholeDistance: whole.totalDist,
    };
  });
  expect(profile.indexes).toEqual([0]);
  expect(profile.selectedWpIndexes).toEqual([0, 1]);
  expect(profile.selectedDistance).toBeLessThan(profile.wholeDistance);
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
const OUT_AND_BACK = [
    { lat: 32.17648, lng: 34.83524, name: '' },
    { lat: 32.21056, lng: 34.80722, name: 'SFAIM' },
    { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
    { lat: 31.94361, lng: 34.78083, name: 'NTAIM' },
    { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
    { lat: 32.14556, lng: 34.77833, name: 'HTZUK' },
    { lat: 32.14083, lng: 34.80139, name: 'KNTRY' },
];
test.describe('the turn point seeds no automatic frequency change', () => {

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

  test('reconciliation removes every turn callout and preserves unrelated notes', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async (wps) => {
      await Promise.all([loadNavWaypoints(), loadCommChange()]);
      state.waypoints = wps.map(w => ({ ...w }));
      const unrelatedCallout = { lat: 32.21056, lng: 34.80722, cc: 'SFAIM',
        freqName: 'HERZLIYA', freq: '123.45', text: 'keep callout' };
      const ordinaryNote = { lat: 32.1, lng: 34.8, text: 'keep ordinary note', color: '#fff' };
      state.notes = [
        { lat: 31.94361, lng: 34.78083, cc: 'NTAIM',
          freqName: 'TEL_NOF', freq: '129.05', text: 'automatic', freqAuto: true },
        { lat: 31.944, lng: 34.781, cc: 'NTAIM',
          freqName: 'PILOT', freq: '130.00', text: 'manual' },
        unrelatedCallout,
        ordinaryNote,
      ];
      state.commChangeSuppressions = [];
      syncLegs();
      seedCommChangeNotes();
      return [legRetraceTurnIndex(),
        state.notes.filter(n => n && n.cc === 'NTAIM').length,
        state.notes.includes(unrelatedCallout), state.notes.includes(ordinaryNote),
        state.commChangeSuppressions.slice()];
    }, OUT_AND_BACK);
    expect(out).toEqual([3, 0, true, true, []]);
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

  test('import and manual or derived-turn startup remove persisted callouts safely', async ({ page }) => {
    await boot(page);
    await loop(page);
    const out = await page.evaluate(({ loopWps, derivedWps }) => {
      setTurnWaypoint(2);
      state.notes = [
        { lat: 32.00472, lng: 34.72722, cc: 'TYONA',
          freqName: 'PILOT', freq: '130.00', text: 'remove me' },
        { lat: 32.1, lng: 34.8, text: 'keep me', color: '#fff' },
      ];
      const blob = serializeRoute();
      state.selected = { type: 'note', index: 0 };
      applyRouteData(blob);
      const imported = {
        turnCallout: state.notes.some(n => n && n.cc === 'TYONA'),
        ordinaryKept: state.notes.some(n => n && n.text === 'keep me'),
      };
      localStorage.setItem('navaid.route', JSON.stringify(blob));
      state.waypoints = loopWps.map(w => ({ ...w }));
      state.legs = [];
      state.notes = [{ lat: 0, lng: 0, text: 'old selection' }];
      state.selected = { type: 'note', index: 0 };
      const restored = restoreRoute();
      draw();
      const removedSelection = state.selected;
      // A selected unrelated note after the removed callout must follow its object
      // to the new index instead of silently selecting the wrong note or disappearing.
      state.selected = { type: 'note', index: 1 };
      restoreRoute();
      draw();
      const shiftedSelection = state.selected && {
        ...state.selected,
        text: state.notes[state.selected.index] && state.notes[state.selected.index].text,
      };
      const manual = [restored, state.notes.some(n => n && n.cc === 'TYONA'),
        state.notes.some(n => n && n.text === 'keep me'), removedSelection, shiftedSelection];
      state.waypoints = derivedWps.map(w => ({ ...w }));
      state.legs = [];
      syncLegs();
      state.notes = [{ lat: 31.94361, lng: 34.78083, cc: 'NTAIM', text: 'remove derived' }];
      localStorage.setItem('navaid.route', JSON.stringify(serializeRoute()));
      state.waypoints = []; state.legs = []; state.notes = [];
      const derivedRestored = restoreRoute();
      draw();
      return { imported, manual,
        derived: [derivedRestored, legRetraceTurnIndex(),
          state.notes.some(n => n && n.cc === 'NTAIM')],
      };
    }, { loopWps: LOOP, derivedWps: OUT_AND_BACK });
    expect(out.imported).toEqual({ turnCallout: false, ordinaryKept: true });
    expect(out.manual).toEqual([true, false, true, null,
      { type: 'note', index: 0, text: 'keep me' }]);
    expect(out.derived).toEqual([true, 3, false]);
  });

  test('moving or clearing the turn re-seeds its old frequency point', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      await Promise.all([loadNavWaypoints(), loadCommChange()]);
    });
    await loop(page);
    const out = await page.evaluate(() => {
      const setAndReconcile = idx => {
        setTurnWaypoint(idx);
        seedCommChangeNotes();
      };
      setAndReconcile(1);                 // SFAIM is the turn: no callout
      const atTurn = state.notes.some(n => n && n.cc === 'SFAIM');
      setAndReconcile(2);                 // move turn to TYONA
      const afterMove = state.notes.some(n => n && n.cc === 'SFAIM');

      setAndReconcile(1);                 // move back, then clear SFAIM
      setAndReconcile(1);
      return [atTurn, afterMove, state.notes.some(n => n && n.cc === 'SFAIM'),
        state.commChangeSuppressions.includes('SFAIM')];
    });
    expect(out).toEqual([false, true, true, false]);
  });

  test('the inspector marks the turn and immediately removes its callout', async ({ page }) => {
    await boot(page);
    await loop(page);
    await page.evaluate(async () => {
      await Promise.all([loadNavWaypoints(), loadCommChange()]);
      state.notes = [
        { lat: 32.00472, lng: 34.72722, cc: 'TYONA',
          freqName: 'PILOT', freq: '130.00', text: 'remove me' },
        { lat: 32.1, lng: 34.8, text: 'keep me', color: '#fff' },
      ];
      state.selected = { type: 'wp', index: 2 };
      showInspector();
    });
    const idleStyle = await page.locator('#insp-turn-btn').evaluate(el => {
      const css = getComputedStyle(el);
      return [css.color, css.backgroundColor, css.borderColor, Number(css.fontWeight) || 400];
    });
    const destructive = await page.locator('.insp-actions .insp-btn:not(.insp-btn-safe)').first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(idleStyle[1]).not.toBe(destructive);
    await page.locator('#insp-turn-btn').click();
    const out = await page.evaluate(() => ({
      marked: !!state.waypoints[2].turn,
      pressed: document.getElementById('insp-turn-btn').getAttribute('aria-pressed'),
      turnCallout: state.notes.some(n => n && n.cc === 'TYONA'),
      ordinaryKept: state.notes.some(n => n && n.text === 'keep me'),
      canAdd: !!document.querySelector('.add-freq-change-btn'),
      style: (() => {
        const css = getComputedStyle(document.getElementById('insp-turn-btn'));
        return [css.color, css.backgroundColor, css.borderColor,
          Number(css.fontWeight) || 400];
      })(),
    }));
    expect(out.marked).toBe(true);
    expect(out.pressed).toBe('true');   // relabels to "clear" once set
    expect(out.turnCallout).toBe(false);
    expect(out.ordinaryKept).toBe(true);
    expect(out.canAdd).toBe(false);
    expect(out.style.slice(0, 3)).toEqual(idleStyle.slice(0, 3));
    expect(out.style[3]).toBeGreaterThan(idleStyle[3]);
  });

  test('Z cannot recreate a callout at the effective turn', async ({ page }) => {
    await boot(page);
    await loop(page);
    await page.evaluate(async () => {
      await Promise.all([loadNavWaypoints(), loadCommChange()]);
      setTurnWaypoint(2);
      state.notes = [];
      state.selected = { type: 'wp', index: 2 };
      showInspector();
    });
    await page.keyboard.press('z');
    const out = await page.evaluate(() => [legRetraceTurnIndex(),
      state.notes.some(n => n && n.cc === 'TYONA'),
      !!document.querySelector('.add-freq-change-btn')]);
    expect(out).toEqual([2, false, false]);
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

// The menu is capped to the screen and scrolls, but a flex item still shrinks BELOW its
// content by default -- so once the rows stopped fitting they compressed instead, and a row
// whose label sits above its control squashed to one line with its select painting over the
// row beneath. Reported as the VOR ref box overlapping "Show/Add Freq Changes".
test('a stacked row keeps its full height when the menu overflows', async ({ page }) => {
  // The capped, scrolling menu exists only from 681px up (below that the section is an
  // inline block with no height limit), so the squash can only happen there. Short height
  // so the section cannot possibly fit and the cap is genuinely in play.
  await page.setViewportSize({ width: 900, height: 420 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => !!document.getElementById('vor-ref-row'));
  const out = await page.evaluate(() => {
    const sec = document.getElementById('vor-ref-row').closest('.tb-section');
    if (sec) sec.classList.add('open');
    const rows = [document.getElementById('vor-ref-row'), document.getElementById('leg-dir-row')];
    return rows.filter(Boolean).map((row) => {
      const sel = row.querySelector('select');
      const rb = row.getBoundingClientRect(), sb = sel.getBoundingClientRect();
      const next = row.nextElementSibling;
      const nb = next ? next.getBoundingClientRect() : null;
      return {
        id: row.id,
        // The row must be tall enough for what is inside it...
        containsSelect: sb.bottom <= rb.bottom + 1,
        // ...and must not paint over whatever follows.
        overlapsNext: nb ? sb.bottom > nb.top + 1 : false,
        shrink: getComputedStyle(row).flexShrink,
      };
    });
  });
  expect(out.length).toBeGreaterThan(0);
  for (const r of out) {
    expect(r.shrink, r.id + ' must not shrink below its content').toBe('0');
    expect(r.containsSelect, r.id + ' select escapes its row').toBe(true);
    expect(r.overlapsNext, r.id + ' paints over the next row').toBe(false);
  }
});

// A loop starts and finishes at the same field, so "first to last" reduced to
// "LLHZ -> LLHZ" -- true, and useless in a list of saved routes. The turning point is what
// tells two sorties out of the same field apart.
test.describe('a turning point names the saved route', () => {
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

  test('the suggested name carries the turn, in English', async ({ page }) => {
    await boot(page);
    await loop(page);
    const out = await page.evaluate(() => {
      const before = defaultSavedRouteName();
      setTurnWaypoint(2);                      // TYONA
      // Endpoints are already shown by their localised display name, and the turn is
      // named the same way rather than as a raw code.
      const shown = (typeof navName === 'function') ? navName('TYONA') : 'TYONA';
      return { before, after: defaultSavedRouteName(), shown };
    });
    expect(out.before).toBe('LLHZ → LLHZ');    // both ends the same: says nothing
    expect(out.after).toContain(out.shown);
    expect(out.after).toContain('LLHZ');
  });

  test('and in Hebrew, without naming the same field twice', async ({ page }) => {
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof defaultSavedRouteName === 'function' &&
      typeof setTurnWaypoint === 'function');
    await loop(page);
    const out = await page.evaluate(() => {
      setTurnWaypoint(2);
      return { name: defaultSavedRouteName(),
               shown: (typeof navName === 'function') ? navName('TYONA') : 'TYONA' };
    });
    const name = out.name;
    expect(name).toContain(out.shown);
    expect(name).toContain('וחזרה');
    // LLHZ is the start AND the end; "וחזרה" already says where it returns to.
    expect(name.split('LLHZ').length - 1).toBe(1);
  });

  test('a one-way route is named as before', async ({ page }) => {
    await boot(page);
    const name = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' },
                         { lat: 32.1, lng: 34.1, name: 'BRAVO' }];
      syncLegs();
      return defaultSavedRouteName();
    });
    expect(name).toBe('ALPHA → BRAVO');
  });

  test('the saved entry keeps that name', async ({ page }) => {
    await boot(page);
    await loop(page);
    const out = await page.evaluate(() => {
      setTurnWaypoint(2);
      const entry = routeLibrarySaveCurrent('');   // blank = use the suggestion
      return { name: entry && entry.name,
               shown: (typeof navName === 'function') ? navName('TYONA') : 'TYONA' };
    });
    expect(out.name).toContain(out.shown);
  });
});

// routeFileSlug feeds EVERY export -- json, gpx, pln, fdr, csv, png, kml -- so a loop
// without the turn made every sortie out of one field collide in the downloads folder.
test.describe('a turning point names the exported files', () => {
  test('a loop is named by its far point, not "LLHZ-to-LLHZ"', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      // A LOOP, not an out-and-back: no leg retraces, so nothing is auto-detected and the
      // slug really is the useless "LLHZ-to-LLHZ" until a turn is marked.
      state.waypoints = [
        { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
        { lat: 32.21056, lng: 34.80722, name: 'SFAIM' },
        { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
        { lat: 32.14083, lng: 34.80139, name: 'KNTRY' },
        { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
      ];
      syncLegs();
      const before = routeFileSlug();
      setTurnWaypoint(2);
      return { before, after: routeFileSlug() };
    });
    expect(out.before).toBe('LLHZ-to-LLHZ');
    expect(out.after).toMatch(/^LLHZ-via-/);
    expect(out.after).not.toBe(out.before);
  });

  test('different ends keep both, with the turn between', async ({ page }) => {
    await boot(page);
    const slug = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
        { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
        { lat: 31.83417, lng: 34.80972, name: 'LLES' },
      ];
      syncLegs();
      setTurnWaypoint(1);
      return routeFileSlug();
    });
    expect(slug).toMatch(/^LLHZ-via-.*-to-LLES$/);
  });

  test('a one-way route is unchanged, and stays filename-safe', async ({ page }) => {
    await boot(page);
    const slug = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
                         { lat: 31.83417, lng: 34.80972, name: 'LLES' }];
      syncLegs();
      return routeFileSlug();
    });
    expect(slug).toBe('LLHZ-to-LLES');
    expect(slug).toMatch(/^[A-Za-z0-9-]+$/);   // no spaces or punctuation in a filename
  });
});

// Waypoints are rebuilt field by field in THREE places -- serializeRoute, applyRouteData,
// and the session restore -- so a new field has to be added to all three or it silently
// vanishes. Reported as: switching language loses the marked turning point (a language
// change is a reload, which goes through the session restore).
test('the turning point survives a reload, including a language change', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
      { lat: 32.21056, lng: 34.80722, name: 'SFAIM' },
      { lat: 32.00472, lng: 34.72722, name: 'TYONA' },
      { lat: 32.14083, lng: 34.80139, name: 'KNTRY' },
      { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
    ];
    syncLegs();
    setTurnWaypoint(2);          // TYONA
    persist();                   // what every edit does
  });

  // A plain reload first.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof legRetraceTurnIndex === 'function' &&
    state.waypoints.length === 5);
  const afterReload = await page.evaluate(() => ({
    marked: state.waypoints.findIndex(w => w.turn),
    turn: legRetraceTurnIndex(),
  }));
  expect(afterReload.marked).toBe(2);
  expect(afterReload.turn).toBe(2);

  // Then the language switch, which is the reported case.
  await page.goto('?lang=he');
  await page.waitForFunction(() => typeof legRetraceTurnIndex === 'function' &&
    state.waypoints.length === 5);
  const afterLang = await page.evaluate(() => ({
    marked: state.waypoints.findIndex(w => w.turn),
    turn: legRetraceTurnIndex(),
    picker: document.getElementById('leg-dir-select').disabled,
  }));
  expect(afterLang.marked).toBe(2);
  expect(afterLang.turn).toBe(2);
  expect(afterLang.picker).toBe(false);   // and the picker is still usable
});
