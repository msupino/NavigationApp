// @ts-check
// Filing an out-and-back as one plan. The outbound and the return are separate NavAid
// routes -- that is how a pilot gets a nav log and exports for each direction -- and they
// are joined only in field 15, per the AIP א'-11 annex א' sample, which lists the whole
// flown chain including repeated points.
const { test, expect } = require('./_setup');

// Herzliya out to Kfar HaNagid and back, as filed through flp.co.il for 4XDAZ. The return
// is NOT a mirror: it omits APOLN/ARENA and comes home via KNTRY, because the Herzliya
// corridors are one-way (LLHZ->SFAIM out, KNTRY->LLHZ back).
const OUT = [
  { name: 'LLHZ', lat: 32.18078, lng: 34.83275 },
  { name: 'SFAIM', lat: 32.22, lng: 34.83 },
  { name: 'HTZUK', lat: 32.10, lng: 34.80 },
  { name: 'NAGID', lat: 31.90, lng: 34.75 },
];
const BACK = [
  { name: 'NAGID', lat: 31.90, lng: 34.75 },
  { name: 'HTZUK', lat: 32.10, lng: 34.80 },
  { name: 'KNTRY', lat: 32.16, lng: 34.81 },
  { name: 'LLHZ', lat: 32.18078, lng: 34.83275 },
];

const PTS = (() => {
  const g = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, '..', 'docs', 'data', 'cvfr-route-graph.json'), 'utf8'));
  const o = {};
  for (const n of ['LLHZ', 'SFAIM', 'HTZUK', 'NAGID', 'KNTRY', 'ARENA', 'SUPER'])
    if (g.nodes[n]) o[n] = { lat: g.nodes[n].lat, lng: g.nodes[n].lng };
  return o;
})();

const PROFILE = {
  reg: '4XDAZ', type: 'C172', wake: 'L', equip: 'S', surv: 'C',
  pic: 'DAN NITSAN', license: '5127', cell: '0544711823',
  endurance: '0300', persons: 2, kind: 'routes', replyTo: 'pilot@example.com',
};

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display', 'export', 'print']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof buildIcaoFpl === 'function' && typeof syncLegs === 'function');
  // Real published coordinates, so the graph match is by position as it is in the app.
  await page.evaluate((pts) => { window.__pts = pts; }, PTS);
}

// Build the plan with `out` drawn and `back` supplied as a saved return route.
const plan = (page, out, back, extra) => page.evaluate(({ out, back, profile, extra }) => {
  state.waypoints = out.map(w => ({ ...w }));
  syncLegs();
  for (const l of state.legs) l.flightSpeed = 100;
  let retData = null;
  if (back) {
    const keep = state.waypoints, keepLegs = state.legs;
    state.waypoints = back.map(w => ({ ...w }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    retData = JSON.parse(JSON.stringify(serializeRoute()));
    state.waypoints = keep; state.legs = keepLegs;
  }
  const res = buildIcaoFpl(profile, Object.assign({
    dateLocal: '2026-08-07', timeLocal: '11:05', returnRouteData: retData,
    now: new Date('2026-08-07T05:00:00Z'),
  }, extra || {}));
  return { res, drawn: state.waypoints.map(w => w.name) };
}, { out, back, profile: PROFILE, extra: extra || null });

test('an out-and-back files as one plan, with the turn point named once', async ({ page }) => {
  await boot(page);
  const { res, drawn } = await plan(page, OUT, BACK);
  expect(res.errs, JSON.stringify(res.errs)).toBeUndefined();
  const route = res.text.split('\n').find(l => l.startsWith('-N'));
  // Field 15 lists the whole flown sequence, repeats included -- and NAGID, the turn point,
  // appears once rather than twice.
  expect(route).toBe('-N0100VFR SFAIM HTZUK NAGID HTZUK KNTRY');
  expect((route.match(/NAGID/g) || []).length).toBe(1);
  // The drawn route is untouched: it still has its own nav log and exports.
  expect(drawn).toEqual(['LLHZ', 'SFAIM', 'HTZUK', 'NAGID']);
});

test('the EET covers both halves, not just the outbound', async ({ page }) => {
  await boot(page);
  const oneWay = await plan(page, OUT, null);
  const both = await plan(page, OUT, BACK);
  const mins = r => r.res.eetMinutes;
  // Filing an out-and-back with the outbound's time is the defect showReturn has today:
  // the plan is held open for half the flight.
  expect(mins(both)).toBeGreaterThan(mins(oneWay) * 1.5);
});

test('a return that does not start where the route ends is refused', async ({ page }) => {
  await boot(page);
  const elsewhere = BACK.map(w => ({ ...w, lat: w.lat + 0.5 }));
  const { res } = await plan(page, OUT, elsewhere);
  const codes = (res.errs || []).map(e => (typeof e === 'string' ? e : e.code));
  // Two routes that do not meet are not one flight. Refused rather than filed with a
  // warning, exactly as an intermediate landing is refused. The join point here carries
  // the SAME NAME as the route end but sits ~30 nm away -- name identity joins only
  // within the half-mile re-digitisation allowance, never across real distance.
  expect(codes).toContain('errFplJoinGap');
  expect(res.text).toBeUndefined();
});

test('joining two routes at an airfield is still a landing, and still refused', async ({ page }) => {
  await boot(page);
  // LLHZ -> LLES, then LLES -> LLHZ. The join is a field, so it is a landing: AIP א'-11 and
  // the filing desk both require a separate plan per leg
  // ("יש להגיש תוכנית טיסה נפרדת לכל לג").
  const toField = [OUT[0], OUT[1], { name: 'LLES', lat: 32.44, lng: 34.92 }];
  const fromField = [{ name: 'LLES', lat: 32.44, lng: 34.92 }, OUT[1], OUT[0]];
  const { res } = await plan(page, toField, fromField);
  const codes = (res.errs || []).map(e => (typeof e === 'string' ? e : e.code));
  expect(codes).toContain('errFplMidAirfield');
});

test('with no return route the plan is exactly what it was before', async ({ page }) => {
  await boot(page);
  const { res } = await plan(page, OUT, null);
  expect(res.errs).toBeUndefined();
  const route = res.text.split('\n').find(l => l.startsWith('-N'));
  // NAGID is not an aerodrome, so it is filed as ZZZZ with the point named in field 18 --
  // and it stays in field 15, which is the pre-existing documented behaviour.
  expect(route).toBe('-N0100VFR SFAIM HTZUK NAGID');
  expect(res.text).toContain('(FPL-4XDAZ-VG');
  // EOBT is UTC derived from a LOCAL clock time, so the digits depend on the runner's
  // timezone: 11:05 local is 0805Z here and 1105Z on a UTC CI box. Assert the shape.
  expect(res.text).toMatch(/^-LLHZ\d{4}$/m);
});

test('the modal offers the saved routes, and previews what will be filed', async ({ page }) => {
  await boot(page);
  await page.evaluate(({ back }) => {
    state.waypoints = back.map(w => ({ ...w }));
    syncLegs();
    routeLibrarySaveCurrent('Return via KNTRY');
    state.waypoints = [];
    syncLegs();
  }, { back: BACK });
  await page.evaluate(({ out }) => { state.waypoints = out.map(w => ({ ...w })); syncLegs(); }, { out: OUT });
  // The FPL button lives in the flight-plan panel, so that has to be open first.
  await page.evaluate(() => { showFlightPlan(); document.getElementById('fpl-open').click(); });
  const sel = page.locator('#fpl-return-route');
  await expect(sel).toBeVisible({ timeout: 5000 });
  // The saved route is offered...
  await expect(sel.locator('option')).toHaveCount(2);
  // ...and the preview already shows the DRAWN route expanded, because naming every
  // reporting point is on by default. Before a return is picked it ends at the turn point.
  await expect(page.locator('#fpl-return-preview')).toBeVisible();
  await expect(page.locator('#fpl-return-preview')).not.toContainText('KNTRY');
  await sel.selectOption({ index: 1 });
  // Picking one shows the whole flown chain before anything is filed.
  await expect(page.locator('#fpl-return-preview')).toBeVisible();
  await expect(page.locator('#fpl-return-preview')).toContainText('NAGID');
  await expect(page.locator('#fpl-return-preview')).toContainText('KNTRY');
});

test('an out-and-back pair is distinguishable in Hebrew', async ({ page }) => {
  // Reported from the saved-route list: "LLHZ ← צומת אשדוד" and "צומת אשדוד ← LLHZ" render
  // almost identically, because an arrow between a Hebrew name and a Latin code is a bidi
  // neutral and gets reordered. The same list feeds the return picker, where choosing the
  // wrong direction files the wrong route.
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof defaultSavedRouteName === 'function' && typeof syncLegs === 'function');
  const r = await page.evaluate(({ out, back }) => {
    state.waypoints = out.map(w => ({ ...w })); syncLegs();
    const nameOut = defaultSavedRouteName();
    state.waypoints = back.map(w => ({ ...w })); syncLegs();
    const nameBack = defaultSavedRouteName();
    return { nameOut, nameBack };
  }, { out: OUT, back: BACK });
  // Direction is stated in words, not by an arrow whose rendered side depends on bidi.
  expect(r.nameOut).toMatch(/^מ/);            // "מ..."
  expect(r.nameOut).toContain('אל');     // "אל"
  expect(r.nameOut).not.toContain('←');
  // ...and the two directions are plainly different strings.
  expect(r.nameOut).not.toBe(r.nameBack);
  // ...and the NAME carries no isolate characters: it is data the pilot can edit, store
  // and sync. Isolation is applied when it is rendered, not baked into the value.
  expect(r.nameOut).not.toContain('⁨');
  expect(r.nameOut).not.toContain('⁩');
});

// --- filing-time expansion ----------------------------------------------------------------
// The pilot draws sparsely; the plan names every published reporting point on the way, per
// the AIP א'-11 annex א' sample. Coordinates come from PTS above (the real published ones),
// so the graph match is by position exactly as it is in the app.

test('a sparsely drawn route files every reporting point on the way', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    // Four picks, exactly as a pilot would tap them.
    state.waypoints = ['LLHZ', 'ARENA', 'SUPER', 'NAGID'].map(n => ({ ...window.__pts[n], name: n }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    const graph = await fplLoadRouteGraph();
    const res = buildIcaoFpl(profile, { dateLocal: '2026-08-07', timeLocal: '11:05',
      routeGraph: graph, now: new Date('2026-08-07T05:00:00Z') });
    return { res, drawn: state.waypoints.map(w => w.name) };
  }, { profile: PROFILE });
  const route = r.res.text.split('\n').find(l => l.startsWith('-N'));
  // The filed chain is what flp.co.il sent for this sortie, from four taps.
  expect(route).toBe('-N0100VFR SFAIM APOLN ARENA HTZUK RIDNG CLORE TYONA SUPER NTAIM BOVED NAGID');
  // ...and the drawn route is untouched: expansion is a filing concern only.
  expect(r.drawn).toEqual(['LLHZ', 'ARENA', 'SUPER', 'NAGID']);
});

test('expansion never drops a drawn point, and says when it cannot bridge', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    // A point the graph does not know, between two it does.
    state.waypoints = [
      { ...window.__pts.LLHZ, name: 'LLHZ' },
      { lat: 31.5, lng: 34.4, name: 'OFFGRID' },
      { ...window.__pts.NAGID, name: 'NAGID' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    const graph = await fplLoadRouteGraph();
    return buildIcaoFpl(profile, { dateLocal: '2026-08-07', timeLocal: '11:05',
      routeGraph: graph, now: new Date('2026-08-07T05:00:00Z') });
  }, { profile: PROFILE });
  const route = (r.text || '').split('\n').find(l => l.startsWith('-N')) || '';
  // Whatever the graph can or cannot do, every point the pilot drew is still filed.
  expect(route).toContain('OFFGRID');
  expect(route).toContain('NAGID');
});

test('turning expansion off files exactly what was drawn', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    state.waypoints = ['LLHZ', 'ARENA', 'SUPER', 'NAGID'].map(n => ({ ...window.__pts[n], name: n }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    return buildIcaoFpl(profile, { dateLocal: '2026-08-07', timeLocal: '11:05',
      routeGraph: null, now: new Date('2026-08-07T05:00:00Z') });
  }, { profile: PROFILE });
  const route = r.text.split('\n').find(l => l.startsWith('-N'));
  expect(route).toBe('-N0100VFR ARENA SUPER NAGID');
});

test('expansion honours one-way corridors', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const graph = await fplLoadRouteGraph();
    return {
      out: fplGraphChain(graph, 'LLHZ', 'HTZUK'),
      back: fplGraphChain(graph, 'HTZUK', 'LLHZ'),
    };
  });
  // Herzliya's corridors are one-way: out via SFAIM, home via KNTRY. A mirror would file a
  // corridor flown against its published direction. The outbound now also names the coastal
  // points between them -- a filed plan lists every reporting point on the way, so the chain
  // is the finest decomposition of the track, not the fewest hops.
  expect(r.out[0]).toBe('LLHZ');
  expect(r.out[1]).toBe('SFAIM');
  expect(r.out[r.out.length - 1]).toBe('HTZUK');
  expect(r.out).toContain('APOLN');
  expect(r.back).toEqual(['HTZUK', 'KNTRY', 'LLHZ']);
});

test('the picker never says the same thing twice', async ({ page }) => {
  // Reported: an option read "מ־LLHZ אל צומת אשדוד (LLHZ → צומת אשדוד)" — the name states
  // the direction in words, and the parenthetical repeated it with the very arrow whose
  // rendered direction is ambiguous in RTL.
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof showFlightPlan === 'function');
  const labels = await page.evaluate(({ out, back }) => {
    // The picker only offers routes that start where the current one ENDS, so the saved
    // candidates here are outbound-shaped and the loaded route is the return.
    state.waypoints = out.map(w => ({ ...w })); syncLegs();
    routeLibrarySaveCurrent();                       // auto-named: direction in words
    routeLibrarySaveCurrent('תרגיל בוקר');            // renamed: no endpoints in the name
    state.waypoints = back.map(w => ({ ...w })); syncLegs();
    showFlightPlan(); document.getElementById('fpl-open').click();
    return Array.from(document.querySelectorAll('#fpl-return-route option'))
      .map(o => o.textContent);
  }, { out: OUT, back: BACK });
  const auto = labels.find(t => t.includes('אל'));
  const renamed = labels.find(t => t.includes('תרגיל בוקר'));
  // The auto-named one carries no parenthetical: the name already says it.
  expect(auto).toBeTruthy();
  expect(auto).not.toContain('→');
  expect(auto).not.toContain('(');
  // ...while a renamed route still gets its endpoints, because nothing else states them.
  expect(renamed).toContain('→');
});

test('a loop route is not offered as its own return', async ({ page }) => {
  await boot(page);
  // A LOOP starts where it ends, so it passes the join filter -- this is the one case the
  // filter cannot catch, and filing it would fly the whole sortie twice.
  const LOOP = OUT.concat([{ ...OUT[0] }]);
  const r = await page.evaluate(({ loop, back }) => {
    state.waypoints = loop.map(w => ({ ...w })); syncLegs();
    routeLibrarySaveCurrent('The loop');
    state.waypoints = back.map(w => ({ ...w })); syncLegs();
    routeLibrarySaveCurrent('Ends at LLHZ too');
    state.waypoints = loop.map(w => ({ ...w })); syncLegs();
    showFlightPlan(); document.getElementById('fpl-open').click();
    return Array.from(document.querySelectorAll('#fpl-return-route option')).map(o => o.textContent);
  }, { loop: LOOP, back: BACK });
  expect(r.some(t => /The loop/.test(t))).toBe(false);
});

test('a route saved twice under different names is still not offered to itself', async ({ page }) => {
  await boot(page);
  const options = await page.evaluate(({ out }) => {
    state.waypoints = out.map(w => ({ ...w })); syncLegs();
    routeLibrarySaveCurrent('Copy A');
    routeLibrarySaveCurrent('Copy B');        // same waypoints, a second entry
    state.waypoints = out.map(w => ({ ...w })); syncLegs();
    showFlightPlan(); document.getElementById('fpl-open').click();
    return Array.from(document.querySelectorAll('#fpl-return-route option')).map(o => o.textContent);
  }, { out: OUT });
  // The tracked id only knows about one of them; the waypoints are what make them the same
  // flight.
  expect(options.some(t => /Copy A/.test(t))).toBe(false);
  expect(options.some(t => /Copy B/.test(t))).toBe(false);
});

// --- field 9/10 have fixed vocabularies ---------------------------------------------------
test('wake, equipment and transponder are chosen, not typed', async ({ page }) => {
  await boot(page);
  await page.evaluate(({ out }) => {
    state.waypoints = out.map(w => ({ ...w })); syncLegs();
    showFlightPlan(); document.getElementById('fpl-open').click();
    document.querySelector('.fpl-advanced').open = true;
  }, { out: OUT });
  // A select for the one-of category...
  const wake = page.locator('#fpl-wake');
  await expect(wake).toBeVisible();
  expect(await wake.evaluate(el => el.tagName)).toBe('SELECT');
  expect(await wake.locator('option').allTextContents()).toEqual(
    expect.arrayContaining([expect.stringContaining('L —')]));
  // ...and checkbox sets for the letter fields, because field 10 carries several. They live
  // in a disclosure that reads as a field until opened -- a wall of checkboxes in a form row
  // is unreadable.
  const equip = page.locator('#fpl-equip');
  expect(await equip.evaluate(el => el.tagName)).toBe('DETAILS');
  await expect(equip.locator('summary')).toContainText('S');        // shows what will be filed
  await equip.evaluate(el => { el.open = true; });
  await expect(equip.locator('input[type=checkbox]').first()).toBeVisible();
  const surv = page.locator('#fpl-surv');
  await surv.evaluate(el => { el.open = true; });
  await expect(surv.locator('input[type=checkbox]').first()).toBeVisible();
});

test('picking equipment produces a sorted letter string', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(({ out }) => {
    state.waypoints = out.map(w => ({ ...w })); syncLegs();
    showFlightPlan(); document.getElementById('fpl-open').click();
    const g = document.getElementById('fpl-equip');
    for (const cb of g.querySelectorAll('input[type=checkbox]')) cb.checked = false;
    for (const l of ['G', 'S', 'D']) {
      const cb = [...g.querySelectorAll('input')].find(x => x.value === l);
      cb.checked = true; cb.dispatchEvent(new Event('change'));
    }
    return g.__value();
  }, { out: OUT });
  expect(v).toBe('DGS');            // alphabetical, which is how field 10 is written
});

test('"none" cannot be combined with equipment that exists', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(({ out }) => {
    state.waypoints = out.map(w => ({ ...w })); syncLegs();
    showFlightPlan(); document.getElementById('fpl-open').click();
    const g = document.getElementById('fpl-surv');
    const pick = (l) => { const cb=[...g.querySelectorAll('input')].find(x=>x.value===l);
      cb.checked = true; cb.dispatchEvent(new Event('change')); };
    pick('C'); pick('N');            // N clears the rest...
    const afterNone = g.__value();
    pick('S');                       // ...and choosing equipment clears N
    return { afterNone, afterS: g.__value() };
  }, { out: OUT });
  expect(r.afterNone).toBe('N');
  expect(r.afterS).toBe('S');
});

test('letters the pilot already has are kept, not silently dropped', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(({ out }) => {
    state.waypoints = out.map(w => ({ ...w })); syncLegs();
    // 'W' (RVSM) is not offered in the common set; an equipment string is the pilot's
    // declaration, and a control that dropped it would file a different aircraft.
    localStorage.setItem('navaid.fpl.equip', 'SW');   // one key per field, not one blob
    showFlightPlan(); document.getElementById('fpl-open').click();
    const g = document.getElementById('fpl-equip');
    return g ? g.__value() : null;
  }, { out: OUT });
  expect(v).toContain('W');          // kept
  expect(v).toContain('S');          // ...alongside what the checkboxes know
});

test('two picks reproduce a real filed plan, route and EET', async ({ page }) => {
  await boot(page);
  // The 4XDAZ sortie as actually filed through flp.co.il on 2026-08-07. The pilot picks
  // only the turn point; the corridor and its reporting points come from the graph.
  const r = await page.evaluate(async ({ profile }) => {
    const at = n => ({ name: n, lat: window.__pts[n].lat, lng: window.__pts[n].lng });
    state.waypoints = [at('NAGID'), at('LLHZ')]; syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    const retData = JSON.parse(JSON.stringify(serializeRoute()));
    state.waypoints = [at('LLHZ'), at('NAGID')]; syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    const graph = await fplLoadRouteGraph();
    return buildIcaoFpl(profile, { dateLocal: '2026-08-07', timeLocal: '11:05',
      returnRouteData: retData, routeGraph: graph, now: new Date('2026-08-07T05:00:00Z') });
  }, { profile: PROFILE });
  const route = r.text.split('\n').find(l => l.startsWith('-N'));
  expect(route).toBe('-N0100VFR SFAIM APOLN ARENA HTZUK RIDNG CLORE TYONA SUPER NTAIM ' +
    'BOVED NAGID BOVED NTAIM SUPER TYONA CLORE RIDNG HTZUK KNTRY');
  // The EET must cover the CORRIDOR, not the straight line between the picks: the expanded
  // chain is 44.8 nm against 39.2 drawn, which is the difference between filing 0030 and
  // 0025 -- a plan held open for a shorter flight than it describes.
  expect(r.eet).toBe('0030');
  expect(r.errs).toBeUndefined();
});

test('an expanded chain never visits the same point twice', async ({ page }) => {
  await boot(page);
  // "More points within the slack" rewards bouncing unless the path must be simple:
  // LLBS->LLHZ came out as "... LLEK NAGID YAVNE NAGID BOVED ...", a detour to YAVNE and
  // straight back, and LLHA->LLBS repeated ARENA and HTZUK. Nobody flies that.
  const r = await page.evaluate(async () => {
    const graph = await fplLoadRouteGraph();
    const pairs = [['LLHZ', 'LLBS'], ['LLBS', 'LLHZ'], ['LLHA', 'LLBS'], ['LLHZ', 'NAGID']];
    return pairs.map(([a, b]) => {
      const c = fplGraphChain(graph, a, b);
      return { a, b, len: c ? c.length : 0, simple: c ? new Set(c).size === c.length : null };
    });
  });
  for (const x of r) {
    expect(x.len, `${x.a}->${x.b} has no chain`).toBeGreaterThan(1);
    expect(x.simple, `${x.a}->${x.b} visits a point twice`).toBe(true);
  }
});

test('the published Herzliya to Eilat-Ramon route is complete', async ({ page }) => {
  await boot(page);
  // Every reporting point of the published route, as flown:
  // הרצליה שפיים אפולוניה ארנה הצוק רידינג קלור תל יונה סופרלנד נטעים נצר סירני מחלף נשרים
  // אילון לטרון שער הגיא שורש מחלף הראל בית חנינא ענאתא כפר אדומים מצפה יריחו אלמוג
  // עינות צוקים מצפה שלם עין גדי מור נווה זוהר צומת הערבה חצבה צופר באר מנוחה יהל
  // צומת קטורה יטבתה סמר אילת-רמון
  const missing = await page.evaluate(async () => {
    const graph = await fplLoadRouteGraph();
    const seq = ['LLHZ','SFAIM','APOLN','ARENA','HTZUK','RIDNG','CLORE','TYONA','SUPER','NTAIM',
      'SIRNI','NSHRM','AYLON','LTRUN','SHARG','SORES','HAREL','HNINA','ANATA','DUMIM','YRIHO',
      'ALMOG','ZUKIM','SHALM','ENGDI','MMORR','ZOHAR','ARAVA','HAZVA','ZOFAR','BMNUH','YAHEL',
      'KTORA','YOTVT','SAMAR','LLER'];
    const out = [];
    for (let i = 0; i < seq.length - 1; i++) {
      const es = graph.edges[seq[i]] || [];
      if (!es.some(e => e.to === seq[i + 1])) out.push(seq[i] + '->' + seq[i + 1]);
    }
    return out;
  });
  // Three of these were missing until now: ENGDI->MMORR, HAZVA->ZOFAR and SAMAR->LLER.
  // Eilat-Ramon was unreachable for want of the last hop, not for want of a corridor.
  expect(missing).toEqual([]);
});

test('every link in the national CVFR traversal is present', async ({ page }) => {
  await boot(page);
  // A full traversal of the published Israeli CVFR routes, north to south and back: 105
  // distinct points, 157 links. Codes resolved from our own datasets by Hebrew name -- ten
  // links were missing when this was first run, five for the Eilat route (ENGDI-MMORR,
  // HAZVA-ZOFAR, SAMAR-LLER, BRORA-LLER, ZMGID-LLMG) and five more here (AMNON-HULAT,
  // GILAM-GALIM, BOREN-LLBO, LLBO-FRDIS, LLMZ-ZOHAR). Mitzpe Ramon (LLMR) is deliberately
  // absent: we hold no data for that airstrip.
  const missing = await page.evaluate(async () => {
    const graph = await fplLoadRouteGraph();
    const seq = [
      'LLKS','BASAN','HULAT','LLIB','AMNON','DESHE','ZALMN','SEGEV','EVLYM','AHIUD','AAKKO',
      'SMRAT','AAKKO','KRYON','LLHA','GILAM','EVLYM','SEGEV','ZALMN','DESHE','AMNON','HULAT',
      'BASAN','LLKS','BASAN','HULAT','AMNON','DESHE','ZALMN','SEGEV','EVLYM','GILAM','GALIM',
      'DAROM','HOTRM','BOREN','LLBO','FRDIS','HADRA','EIRON','ZMGID','LLMG','ZMGID','EIRON',
      'HADRA','ZYAAR','SHARO','DEROR','BAZRA','LLHZ','GNYAM','PARDS','LLBG','MRISN','NTAIM',
      'BOVED','NAGID','YAVNE','ZASHD','NMASD','ZDAFA','NITZA','HODYA','REVAH','NOAAM','BKAMA',
      'SOVAL','MINGV','NASIH','LLBS','KUVSH','NCITY','OMMER','SOKET','MYTAR','TARAD','ARRAD',
      'LLMZ','ENGDI','SHALM','ZUKIM','ALMOG','YRIHO','DUMIM','ANATA','HNINA','HAREL','SORES',
      'SHARG','LTRUN','AYLON','NSHRM','SIRNI','NTAIM','SUPER','TYONA','CLORE','RIDNG','HTZUK',
      'KNTRY','LLHZ','SFAIM','APOLN','ARENA','HTZUK','RIDNG','CLORE','TYONA','SUPER','NTAIM',
      'BOVED','NAGID','YAVNE','ZASHD','NMASD','ZDAFA','NITZA','HODYA','REVAH','NOAAM','BKAMA',
      'ZLHAV','ZGOAL','NCITY','OMMER','OHLIM','HOVAV','NEGEV','TLLIM','BOKER','OVDAT','RUHOT',
      'HRGVS','ZOFAR','LLEY','HAZVA','ARAVA','ZOHAR','MMORR','LLMZ','ZOHAR','ARAVA',
      'HAZVA','ZOFAR','BMNUH','YAHEL','KTORA','YOTVT','SAMAR','LLER','SAMAR','YOTVT','KTORA',
      'YAHEL','BMNUH','ZOFAR','HRGVS','RUHOT'];
    const out = [];
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i], b = seq[i + 1];
      if (a === b) continue;
      if (!(graph.edges[a] || []).some(e => e.to === b)) out.push(a + '->' + b);
    }
    return [...new Set(out)];
  });
  expect(missing).toEqual([]);
});

test('picking a return route restores the landing acknowledgement', async ({ page }) => {
  // The drawn route ends at the turnaround, so fplLandingSite() used to see no airfield
  // and the "I coordinated the landing" checkbox vanished from exactly the flights that
  // DO land at one -- the out-and-backs. With a return picked, the plan lands at the
  // return route's final point, and the acknowledgement must gate filing again.
  await boot(page);
  await page.evaluate(({ back }) => {
    state.waypoints = back.map(w => ({ ...w }));
    syncLegs();
    routeLibrarySaveCurrent('Return via KNTRY');
    state.waypoints = [];
    syncLegs();
  }, { back: BACK });
  await page.evaluate(({ out }) => {
    state.waypoints = out.map(w => ({ ...w }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
  }, { out: OUT });
  const sel = page.locator('#fpl-return-route');
  await expect(sel).toBeVisible({ timeout: 5000 });
  await sel.selectOption({ index: 1 });
  await page.evaluate(() => document.getElementById('fpl-next').click());
  await expect(page.locator('#fpl-text')).toBeVisible({ timeout: 5000 });
  // The third acknowledgement is back, and it names the HOME field the plan lands at.
  const ack = page.locator('#fpl-ack-landing');
  await expect(ack).toHaveCount(1);
  const label = await ack.locator('..').textContent();
  expect(label).toMatch(/Herzliya|הרצליה/);
});

test('a return route saved with an older chart position still joins by name', async ({ page }) => {
  // The chart datasets have been re-digitised since old saves: the same published point can
  // sit more than the 22 m position tolerance from where a Drive-synced route put it. The
  // picker and the join validator both accept name identity -- ZASHD is still ZASHD.
  await boot(page);
  await page.evaluate(({ back }) => {
    // The saved return's first point is ZASHD, displaced ~80 m from where the outbound's
    // ZASHD sits -- a stale digitization, not a different place.
    const stale = back.map(w => ({ ...w }));
    stale[0] = { ...stale[0], lat: stale[0].lat + 0.0007 };
    state.waypoints = stale;
    syncLegs();
    routeLibrarySaveCurrent('Old return via KNTRY');
    state.waypoints = [];
    syncLegs();
  }, { back: BACK });
  await page.evaluate(({ out }) => {
    state.waypoints = out.map(w => ({ ...w }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    showFlightPlan();
    document.getElementById('fpl-open').click();
  }, { out: OUT });
  const sel = page.locator('#fpl-return-route');
  await expect(sel).toBeVisible({ timeout: 5000 });
  // The displaced-but-same-named route is offered...
  await expect(sel.locator('option')).toHaveCount(2);
  await sel.selectOption({ index: 1 });
  // ...and the build accepts the join instead of refusing with errFplJoinGap.
  const res = await page.evaluate(() => {
    const e = loadRouteLibrary().find(x => x && !x.deleted);
    return buildIcaoFpl({ reg: '4XDAZ', type: 'C172', pic: 'A PILOT', license: '1',
      cell: '0500000000', endurance: '0300', persons: 2, replyTo: 'p@e.com',
      wake: 'L', equip: 'S', surv: 'C' },
      { dateLocal: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        timeLocal: '10:00', returnRouteData: e.data, routeGraph: null });
  });
  expect(res.errs).toBeUndefined();
  expect(res.text).toContain('SFAIM HTZUK NAGID HTZUK KNTRY');
  // ...and EXPANSION still resolves the displaced points: the graph lookup goes by name
  // first (within the same half-mile allowance), so the filed plan names every reporting
  // point on the way even when the save predates the current chart digitisation.
  const res2 = await page.evaluate(async () => {
    const e = loadRouteLibrary().find(x => x && !x.deleted);
    return buildIcaoFpl({ reg: '4XDAZ', type: 'C172', pic: 'A PILOT', license: '1',
      cell: '0500000000', endurance: '0300', persons: 2, replyTo: 'p@e.com',
      wake: 'L', equip: 'S', surv: 'C' },
      { dateLocal: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        timeLocal: '10:00', returnRouteData: e.data,
        routeGraph: await fplLoadRouteGraph() });
  });
  expect(res2.errs).toBeUndefined();
  const route2 = res2.text.split('\n').find(l => l.startsWith('-N'));
  // The displaced NAGID leg still expands through the corridor points around it.
  expect(route2.split(' ').length).toBeGreaterThan('SFAIM HTZUK NAGID HTZUK KNTRY'.split(' ').length);
});

test('the full out-and-back files every reporting point on the way, both directions', async ({ page }) => {
  // The complete sortie as the filing service sends it: outbound expanded through the
  // corridor, the SAVED return picked in the modal, its leg expanded too, one plan. This is
  // the exact chain for the LLHZ out-and-back turned at NAGID -- out via SFAIM, home via
  // KNTRY, every reporting point named in the direction flown.
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    // The return, saved first -- NAGID home via KNTRY, as a pilot would keep it.
    state.waypoints = ['NAGID', 'HTZUK', 'KNTRY', 'LLHZ'].map(n => ({ ...window.__pts[n], name: n }));
    syncLegs();
    routeLibrarySaveCurrent('home via KNTRY');
    // The outbound, drawn coarse: four taps.
    state.waypoints = ['LLHZ', 'SFAIM', 'HTZUK', 'NAGID'].map(n => ({ ...window.__pts[n], name: n }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    const ret = loadRouteLibrary().find(e => e && !e.deleted && e.name === 'home via KNTRY');
    const graph = await fplLoadRouteGraph();
    const res = buildIcaoFpl(profile, { dateLocal: '2026-08-07', timeLocal: '11:05',
      returnRouteData: ret.data, routeGraph: graph, now: new Date('2026-08-07T05:00:00Z') });
    return { res };
  }, { profile: PROFILE });
  expect(r.res.errs).toBeUndefined();
  const route = r.res.text.split('\n').find(l => l.startsWith('-N'));
  expect(route).toBe('-N0100VFR SFAIM APOLN ARENA HTZUK RIDNG CLORE TYONA SUPER NTAIM BOVED NAGID' +
    ' BOVED NTAIM SUPER TYONA CLORE RIDNG HTZUK KNTRY');
});

test('expansion never routes THROUGH an airfield', async ({ page }) => {
  // LLHZ->LLHA expanded through FRDIS->LLBO->BOREN: the Habonim join segments exist for
  // flights that END there, and "most points within slack" took the detour -- inserting a
  // landing that the plan then refused as two flights. A field is a place expansion may
  // route TO, never through.
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    await loadAirfields();
    const hz = airfieldByIcao('LLHZ'), ha = airfieldByIcao('LLHA');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: ha.lat, lng: ha.lng, name: 'LLHA' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    const res = buildIcaoFpl(profile, { dateLocal: '2026-08-07', timeLocal: '11:05',
      routeGraph: await fplLoadRouteGraph(), now: new Date('2026-08-07T05:00:00Z') });
    return { errs: res.errs && res.errs.map(e => e.code || e),
      route: res.text && res.text.split('\n').find(l => l.startsWith('-N')) };
  }, { profile: PROFILE });
  // The plan builds -- no errFplMidAirfield -- and names no airfield between the ends.
  expect(r.errs).toBeUndefined();
  expect(r.route).toBeTruthy();
  const mids = r.route.replace('-N0100VFR ', '').split(' ');
  const fields = await page.evaluate(names =>
    names.filter(n => typeof airfieldByIcao === 'function' && airfieldByIcao(n)), mids);
  expect(fields).toEqual([]);
});

test('expansion prefers corridors that are open at the departure time', async ({ page }) => {
  // LLHZ->LLHA: the inland FRDIS->HASID corridor carries closedHint (the secondary
  // source's live data had it shut), so the coastal chain -- the one a pilot actually
  // flies -- becomes the shortest OPEN path and wins, weekday and weekend alike.
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    await loadAirfields();
    const hz = airfieldByIcao('LLHZ'), ha = airfieldByIcao('LLHA');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: ha.lat, lng: ha.lng, name: 'LLHA' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    const res = buildIcaoFpl(profile, { dateLocal: '2026-08-11', timeLocal: '08:00',
      routeGraph: await fplLoadRouteGraph(), now: new Date('2026-08-11T05:00:00') });
    return { route: res.text && res.text.split('\n').find(l => l.startsWith('-N')),
      warns: res.warns };
  }, { profile: PROFILE });
  expect(r.route).toBe('-N0100VFR BAZRA DEROR SHARO ZYAAR HADRA FRDIS BOREN HOTRM DAROM GALIM');
  expect(r.warns || []).not.toContain('warnFplClosedCorridor');
});

test('the availability rules: closures, weekday gates, weekends', async ({ page }) => {
  await boot(page);
  const t = await page.evaluate(() => {
    const tue8 = new Date('2026-08-11T08:00');    // Tuesday morning
    const tue13 = new Date('2026-08-11T13:00');   // Tuesday afternoon
    const sat8 = new Date('2026-08-15T08:00');    // Saturday morning
    return [
      fplEdgeOpen({}, tue8),                                  // plain edge: open
      fplEdgeOpen({ closedHint: true }, tue8),                // closed is closed
      fplEdgeOpen({ closedHint: true }, sat8),                // ...even on the weekend
      fplEdgeOpen({ openFromHourHint: 12 }, tue8),            // gated, before opening
      fplEdgeOpen({ openFromHourHint: 12 }, tue13),           // gated, after opening
      fplEdgeOpen({ openFromHourHint: 12 }, sat8),            // weekend: open all day
      fplEdgeOpen({ weekdayClosedHint: true }, tue8),         // weekday-closed
      fplEdgeOpen({ weekdayClosedHint: true }, sat8),         // ...open on the weekend
      fplEdgeOpen({ openFromHourHint: 12 }, null),            // no clock: gates need one
      fplEdgeOpen({ closedHint: true }, null),                // no clock: closures still bite
    ];
  });
  expect(t).toEqual([true, false, false, false, true, true, false, true, true, false]);
});

test('when every chain is gated shut, expansion falls back and warns', async ({ page }) => {
  // A hint must never make a published route unfileable: the only corridor between A and C
  // is closed, so the plan files through it anyway and says so.
  await boot(page);
  const r = await page.evaluate(() => {
    const graph = { nodes: {
      AAA: { lat: 32.0, lng: 34.8, kind: 'waypoint', layers: ['cvfr'] },
      BBB: { lat: 32.1, lng: 34.85, kind: 'waypoint', layers: ['cvfr'] },
      CCC: { lat: 32.2, lng: 34.9, kind: 'waypoint', layers: ['cvfr'] },
    }, edges: {
      AAA: [{ to: 'BBB', distanceNm: 7, inboundAltitude: 1000, outboundAltitude: 1000, closedHint: true }],
      BBB: [{ to: 'CCC', distanceNm: 7, inboundAltitude: 1000, outboundAltitude: 1000, closedHint: true },
            { to: 'AAA', distanceNm: 7, inboundAltitude: 1000, outboundAltitude: 1000, closedHint: true }],
      CCC: [{ to: 'BBB', distanceNm: 7, inboundAltitude: 1000, outboundAltitude: 1000, closedHint: true }],
    } };
    const ex = fplExpandRoute(graph,
      [{ lat: 32.0, lng: 34.8, name: 'AAA' }, { lat: 32.2, lng: 34.9, name: 'CCC' }],
      { when: new Date('2026-08-11T08:00') });
    return { names: ex.points.map(w => w.name), usedClosed: ex.usedClosed };
  });
  expect(r.names).toEqual(['AAA', 'BBB', 'CCC']);
  expect(r.usedClosed).toBe(true);
});

test('a live route-closure NOTAM reroutes the expansion', async ({ page }) => {
  // The NOTAM pipeline already parses "RTE CLSD BTN X-Y" chains for the map; expansion now
  // honours them for the departure time. Close SFAIM-APOLN by NOTAM: the 4XDAZ outbound
  // must leave via another published corridor instead of the standard SFAIM chain -- and
  // with no NOTAM, the standard chain is back.
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    const mk = async () => {
      state.waypoints = ['LLHZ', 'ARENA', 'SUPER', 'NAGID'].map(n => ({ ...window.__pts[n], name: n }));
      syncLegs();
      for (const l of state.legs) l.flightSpeed = 100;
      const res = buildIcaoFpl(profile, { dateLocal: '2026-08-11', timeLocal: '08:00',
        routeGraph: await fplLoadRouteGraph(), now: new Date('2026-08-11T05:00:00') });
      return res.text && res.text.split('\n').find(l => l.startsWith('-N'));
    };
    const before = await mk();
    window.notams = [{ id: 'A0001/26',
      text: 'RTE CLSD BTN SFAIM-APOLN DLY 0500-1400',
      start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z' }];
    const closed = await mk();
    window.notams = [];
    const after = await mk();
    return { before, closed, after };
  }, { profile: PROFILE });
  expect(r.before).toBe('-N0100VFR SFAIM APOLN ARENA HTZUK RIDNG CLORE TYONA SUPER NTAIM BOVED NAGID');
  expect(r.closed).not.toContain('SFAIM APOLN');    // the closed pair is not flown
  expect(r.closed).toMatch(/^-N0100VFR /);          // ...but a plan still files
  expect(r.after).toBe(r.before);                   // NOTAM gone, standard chain back
});
