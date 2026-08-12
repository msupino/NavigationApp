// @ts-check
// Auto-route on the MAP: adding a reporting point extends the route along the published
// corridor from the previous point, availability honoured -- instead of a straight line
// the pilot has to subdivide by hand. CVFR only; filing-time expansion is independent.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof autoRouteChain === 'function' && typeof airfieldByIcao === 'function');
  // Ships OFF (it changes what the route contains): every test here opts in first, and the
  // default-off behaviour has its own test below.
  await page.evaluate(async () => {
    window.autoRouteCorridors = true;
    await loadAirfields(); await loadNavWaypoints();
  });
}

test('LLHA to LLHZ follows the open corridor, not a direct line', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(async () => {
    const ha = airfieldByIcao('LLHA'), hz = airfieldByIcao('LLHZ');
    const mid = await autoRouteChain(
      { lat: ha.lat, lng: ha.lng, name: 'LLHA' },
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' });
    return mid && mid.map(w => w.name);
  });
  // The northern arrival, coastal corridor -- and no airfield mid-route, no closed inland
  // HASID leg.
  expect(names).toEqual(['GALIM', 'DAROM', 'HOTRM', 'BOREN', 'FRDIS',
    'HADRA', 'ZYAAR', 'SHARO', 'DEROR', 'BAZRA']);
});

test('LLHZ to LLHA is the same corridor flown the other way', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(async () => {
    const ha = airfieldByIcao('LLHA'), hz = airfieldByIcao('LLHZ');
    const mid = await autoRouteChain(
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: ha.lat, lng: ha.lng, name: 'LLHA' });
    return mid && mid.map(w => w.name);
  });
  expect(names).toEqual(['BAZRA', 'DEROR', 'SHARO', 'ZYAAR', 'HADRA',
    'FRDIS', 'BOREN', 'HOTRM', 'DAROM', 'GALIM']);
});

test('a map tap in add mode splices the corridor as real waypoints', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
    syncLegs();
    setMode('add');
    const ridng = navWP.find(w => w.name === 'RIDNG');
    map.setView([ridng.lat, ridng.lng], 12);
    const pt = map.latLngToContainerPoint([ridng.lat, ridng.lng]);
    return { x: pt.x, y: pt.y };
  });
  await page.mouse.click(r.x, r.y);
  // The splice is async (the graph loads lazily): wait for the corridor to slot in.
  await page.waitForFunction(() => state.waypoints.length > 2, { timeout: 8000 });
  const names = await page.evaluate(() => state.waypoints.map(w => w.name));
  expect(names).toEqual(['LLHZ', 'SFAIM', 'APOLN', 'ARENA', 'HTZUK', 'RIDNG']);
  // Inserted points are ordinary waypoints, tagged for provenance only.
  const tags = await page.evaluate(() => state.waypoints.map(w => !!w._autoRouted));
  expect(tags).toEqual([false, true, true, true, true, false]);
  // Deleting one deletes that point only -- no hidden re-route.
  await page.evaluate(() => { state.waypoints.splice(2, 1); syncLegs(); draw(); });
  expect(await page.evaluate(() => state.waypoints.length)).toBe(5);
});

test('every add path splices the corridor, not just the map tap', async ({ page }) => {
  // A pilot who adds a point with the inspector's "Add to route" button expects the same
  // route a tap would have drawn -- the corridor splice used to hang off the map-tap path
  // alone, so adding by button (or extend-through) drew a straight line.
  await boot(page);
  const names = await page.evaluate(async () => {
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
    syncLegs();
    // Select RIDNG's nav-waypoint and press its "Add to route" button, as a pilot would.
    await loadNavWaypoints();
    const i = navWP.findIndex(w => w.name === 'RIDNG');
    state.selected = { type: 'navwp', index: i };
    showInspector();
    document.getElementById('insp-add-to-route').click();
    await new Promise(r => setTimeout(r, 1200));
    return state.waypoints.map(w => w.name);
  });
  expect(names).toEqual(['LLHZ', 'SFAIM', 'APOLN', 'ARENA', 'HTZUK', 'RIDNG']);
});

test('an unnamed tap near a reporting point still routes', async ({ page }) => {
  // A tap only gets a NAME within the 18 px snap radius; auto-route resolves by position
  // (half a mile) too, or a slightly-off tap silently produced no corridor.
  await boot(page);
  const names = await page.evaluate(async () => {
    const hz = airfieldByIcao('LLHZ');
    await loadNavWaypoints();
    const ridng = navWP.find(w => w.name === 'RIDNG');
    const mid = await autoRouteChain(
      { lat: hz.lat, lng: hz.lng, name: '' },                       // unnamed
      { lat: ridng.lat + 0.002, lng: ridng.lng, name: '' });        // unnamed, ~0.12 nm off
    return mid && mid.map(w => w.name);
  });
  expect(names).toEqual(['SFAIM', 'APOLN', 'ARENA', 'HTZUK']);
});

test('it ships off: the shipped default draws a direct line', async ({ page }) => {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof autoRouteChain === 'function');
  const off = await page.evaluate(() => ({
    flag: window.autoRouteCorridors,
    checkbox: document.getElementById('autoroute-cb').checked,
  }));
  expect(off.flag).toBe(false);
  expect(off.checkbox).toBe(false);
});

test('the toggle turns it off again after opting in', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(async () => {
    window.autoRouteCorridors = false;
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
    syncLegs();
    setMode('add');
    const ridng = navWP.find(w => w.name === 'RIDNG');
    const mid = await autoRouteChain(state.waypoints[0], { lat: ridng.lat, lng: ridng.lng, name: 'RIDNG' });
    return mid;
  });
  expect(names).toBeNull();
});

test('off the CVFR layer it stays out of the way', async ({ page }) => {
  await boot(page);
  const mid = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    reloadLayerDatasets();
    const hz = airfieldByIcao('LLHZ');
    return autoRouteChain({ lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: 32.21056, lng: 34.80722, name: 'SFAIM' });
  });
  expect(mid).toBeNull();
});

test('the shipped default is gist-flippable, like every other toggle', async ({ page }) => {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function' && !!document.getElementById('autoroute-cb'));
  // Off out of the box...
  expect(await page.evaluate(() => tune('defaultAutoRoute'))).toBe(false);
  expect(await page.evaluate(() => document.getElementById('autoroute-cb').checked)).toBe(false);
  // ...and a gist that sets defaultAutoRoute turns it on for a pilot who never chose.
  const on = await page.evaluate(() => {
    setTune('defaultAutoRoute', true);
    NavAid.applyDefaultVisibility();
    return { checked: document.getElementById('autoroute-cb').checked, flag: window.autoRouteCorridors };
  });
  expect(on).toEqual({ checked: true, flag: true });
});

test('a search-built route fills in the reporting points too', async ({ page }) => {
  // Typing "LLHZ RIDNG" into the search is the same request as tapping the two points;
  // one filling in the corridor and the other not would be arbitrary.
  await boot(page);                                   // boot() opts in
  await page.fill('#wp-search', 'LLHZ RIDNG');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => state.waypoints.length > 2, { timeout: 8000 });
  expect(await page.evaluate(() => state.waypoints.map(w => w.name)))
    .toEqual(['LLHZ', 'SFAIM', 'APOLN', 'ARENA', 'HTZUK', 'RIDNG']);
});

test('with the toggle off, a search-built route stays exactly as typed', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.autoRouteCorridors = false; });
  await page.fill('#wp-search', 'LLHZ RIDNG');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => state.waypoints.length === 2, { timeout: 8000 });
  await page.waitForTimeout(1200);                    // nothing arrives late
  expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['LLHZ', 'RIDNG']);
});

// ---------------------------------------------------------------------------
// Segments the pilot may not be given by default: army airways (never available
// to this flight) and onAtcApproval corridors (opened only by a real-time
// clearance, and a filed plan naming one is not accepted). Neither may be
// auto-filled -- but neither is hidden: a point the pilot places themselves is
// always kept, because choosing it is their call to make, not the app's.
// ---------------------------------------------------------------------------
test('an ATC-approval corridor is never auto-routed, but stays available by hand', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const g = await routeGraphData('cvfr');
    const at = (n) => ({ lat: g.nodes[n].lat, lng: g.nodes[n].lng, name: n });
    // MYTAR <-> MZDOT <-> ENGDI is the short way and is onAtcApproval both ways.
    const auto = await autoRouteChain(at('MYTAR'), at('ENGDI'));
    return {
      auto: auto && auto.map(w => w.name),
      // The direct hop the auto-router must not take, and must not be able to reach for
      // even when nothing else bridges the pair.
      direct: fplGraphChain(g, 'MYTAR', 'MZDOT'),
      forced: fplGraphChain(g, 'MYTAR', 'MZDOT', { ignoreAvailability: true }),
      // The data still says the leg exists, and at what altitude -- refusing to ROUTE it
      // is not the same as pretending it is not published.
      published: (g.edges.MZDOT || []).map(e => e.to + '@' + e.inboundAltitude).sort(),
    };
  });
  // Auto-route takes the published corridor instead, and never names MZDOT. The chain
  // detours via HATRU/ZOHAR because ARRAD->MMORR is the refused side of a one-way leg --
  // the short way round exists only westbound.
  expect(out.auto).not.toContain('MZDOT');
  expect(out.auto).toEqual(['TARAD', 'ARRAD', 'HATRU', 'ZOHAR', 'MMORR']);
  // No pass can produce the ATC-only hop: it is not a hint, so ignoreAvailability
  // (which exists so a hinted closure cannot make a route unfileable) must not reach it.
  expect(out.direct).toBeNull();
  expect(out.forced).toBeNull();
  // Still published, still 4000 ft both ways -- the pilot can place MZDOT by hand.
  expect(out.published).toEqual(['ENGDI@4000', 'MYTAR@4000']);
});

test('a hand-placed ATC-approval point survives filing-time expansion', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(async () => {
    const g = await routeGraphData('cvfr');
    const at = (n) => ({ lat: g.nodes[n].lat, lng: g.nodes[n].lng, name: n });
    // The pilot drew MZDOT deliberately. Expansion only ever ADDS between drawn
    // points, so theirs must come out the other side untouched.
    const ex = fplExpandRoute(g, [at('MYTAR'), at('MZDOT'), at('ENGDI')], {});
    return ex.points.map(p => p.name);
  });
  expect(names[0]).toBe('MYTAR');
  expect(names[names.length - 1]).toBe('ENGDI');
  expect(names).toContain('MZDOT');
});

test('a drawn ATC-approval leg is refused at filing, and the refusal reads as text', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const g = await routeGraphData('cvfr');
    const at = (n) => ({ lat: g.nodes[n].lat, lng: g.nodes[n].lng, name: n });
    return {
      // Drawn straight down the ATC-only corridor: legal to draw, not filable.
      bad: fplUnfilableLegs(g, [at('ENGDI'), at('MZDOT'), at('MYTAR')]),
      // The published way round names no such leg.
      good: fplUnfilableLegs(g, [at('MYTAR'), at('TARAD'), at('ARRAD'), at('MMORR'), at('ENGDI')]),
      // The [object Object] bug: a payload-carrying entry must render as a sentence.
      rendered: fplErrText({ code: 'errFplAtcApprovalLeg', names: ['ENGDI–MZDOT'] }),
      gapRendered: fplErrText({ code: 'warnFplExpandGap', pairs: ['A–B'] }),
      // A payload-carrying code with no payload falls back to the neutral wording,
      // never to a function's source.
      noPayload: fplErrText('errFplAtcApprovalLeg'),
    };
  });
  expect(out.bad).toEqual(['ENGDI–MZDOT', 'MZDOT–MYTAR']);
  expect(out.good).toEqual([]);
  expect(out.rendered).toContain('ENGDI–MZDOT');
  expect(out.rendered).not.toContain('[object Object]');
  expect(out.gapRendered).toContain('A–B');
  expect(out.gapRendered).not.toContain('[object Object]');
  expect(out.noPayload).not.toContain('function');
  expect(out.noPayload).not.toBe('errFplAtcApprovalLeg');
});

test('a hint keyed only on the direction FLOWN still matches when auto-route splices in a real stop', async ({ page }) => {
  // Regression: NTAIM's hint used to require before:TYONA directly adjacent. Auto-route
  // correctly splices SUPER between TYONA and NTAIM (a real published corridor stop) --
  // which broke that exact adjacency and silently fell back to the general solver instead
  // of the maintainer-verified hint. Confirmed live on navaid.supino.org before the fix.
  //
  // Fix: a comm-change point's applicable call sign is a property of the point and the
  // direction FLOWN (`after`), not of whatever happens to precede it -- so routeHints
  // dataset-wide are `after`-only now (see cvfr-route-graph.json), and this must hold
  // regardless of how many real intermediate stops auto-route inserts.
  //
  // NTAIM's after:NAGID hint originally said TEL_NOF here; corrected later this session to
  // PALMACHIM (NAGID really is PALMACHIM, not TEL_NOF -- reported live). That correction
  // means NTAIM's hinted call sign now matches TYONA's already-active PALMACHIM, so NTAIM's
  // note is correctly SUPPRESSED here too (same-frequency suppression, gated on `hinted` --
  // this scenario is exactly what proves the hint fired for real, not a coincidental guess).
  await boot(page);
  await page.evaluate(async () => { await loadCommChange(); window.showCommChange = true; });
  await page.waitForFunction(() => window.commChangeMap && window.commChangeMap.NTAIM);
  const out = await page.evaluate(async () => {
    const hz = airfieldByIcao('LLHZ');
    const nagid = navWP.find(w => w.name === 'NAGID');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
    syncLegs();
    const prev = state.waypoints[0];
    const newWp = { lat: nagid.lat, lng: nagid.lng, name: 'NAGID' };
    state.waypoints.push(newWp);
    syncLegs();
    seedCommChangeNotes();
    const mid = await autoRouteChain(prev, newWp);
    state.waypoints.splice(1, 0, ...mid);
    syncLegs();
    seedCommChangeNotes();
    return {
      names: state.waypoints.map(w => w.name),
      ntaim: state.notes.find(n => n.cc === 'NTAIM'),
      tyona: state.notes.find(n => n.cc === 'TYONA'),
    };
  });
  // SUPER really is a real intermediate stop on this corridor -- confirms the scenario
  // actually exercises the broken adjacency, not a route that happened to stay direct.
  expect(out.names).toContain('SUPER');
  const ntaimIdx = out.names.indexOf('NTAIM');
  expect(out.names[ntaimIdx - 1]).toBe('SUPER');
  expect(out.tyona.freqName).toBe('PALMACHIM');
  // NTAIM's hint fired (proven by the suppression itself -- an unhinted/guessed match is
  // never suppressed, see the "same-frequency suppression" describe block) and correctly
  // resolved to PALMACHIM, matching TYONA already in effect -- so no separate note.
  expect(out.ntaim).toBeFalsy();
});
