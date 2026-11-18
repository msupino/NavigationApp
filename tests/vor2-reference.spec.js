// @ts-check
// A second reference VOR, like a cockpit's VOR2 receiver: an independent station tuned
// alongside VOR1, shown as its own radial/DME line. Explicit-only -- unlike VOR1 it never
// falls back to the nearest usable station, so it reads only the one tuned.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof vorReadoutText2 === 'function'
    && typeof setReferenceVor2 === 'function' && typeof loadVors === 'function');
  await page.evaluate(async () => { await loadVors(); });
  // Our setters persist to localStorage, which the shared worker carries between tests; start
  // each from a clean slate so one test's tuned station is not another's boot state.
  await page.evaluate(() => {
    try { localStorage.removeItem('navaid.vorRef'); localStorage.removeItem('navaid.vorRef2'); } catch (e) { /* */ }
    window.vorRef = null; window.vorRef2 = null; window.inspectorVorRef = undefined;
  });
}

test('VOR2 is a separate slot: it persists, feeds its own readout, and never clears VOR1', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const v1 = vors.find(v => v.ident === 'BGN') || vors[0];
    const v2 = vors.find(v => v.ident !== v1.ident);
    setReferenceVor(v1.ident);
    setReferenceVor2(v2.ident);
    return {
      vor1: vorRef, vor2: vorRef2,
      stored1: localStorage.getItem('navaid.vorRef'),
      stored2: localStorage.getItem('navaid.vorRef2'),
      tb2: document.getElementById('vor-ref-select-2').value,
      l1: vorReadoutText(v2.lat + 0.1, v2.lng + 0.1),   // VOR1 still answers
      l2: vorReadoutText2(v2.lat + 0.1, v2.lng + 0.1),  // VOR2 answers for its own station
      id1: v1.ident, id2: v2.ident,
    };
  });
  expect(r.vor1).toBe(r.id1);
  expect(r.vor2).toBe(r.id2);
  expect(r.stored2).toBe(r.id2);
  expect(r.tb2).toBe(r.id2);
  expect(r.l2.startsWith(r.id2 + ' ')).toBe(true);
  expect(r.vor1).toBe(r.id1);                           // setting VOR2 left VOR1 alone
});

test('VOR2 is explicit-only: out of range it goes blank, where VOR1 would fall back', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    NavAid.tuning.vorReadoutMaxNm = 30;
    const v1 = vors.find(v => v.ident === 'BGN') || vors[0];
    const south = vors.slice().sort((a, b) => a.lat - b.lat)[0];
    // Two different stations (one is at most one reference), both far from the test point: VOR 1
    // on BGN (which falls back to the nearest in range), VOR 2 on a northern station (no fallback).
    const north = vors.slice().sort((a, b) => b.lat - a.lat).find(v => v.ident !== v1.ident);
    setReferenceVor(v1.ident);
    setReferenceVor2(north.ident);
    // A point near the southern VOR but far from both tuned stations, past the 30 NM cap.
    return {
      vor1: vorReadoutText(south.lat + 0.05, south.lng),   // falls back to the nearest in range
      vor2: vorReadoutText2(south.lat + 0.05, south.lng),  // no fallback -> blank
      south: south.ident, ref: v1.ident,
    };
  });
  // VOR2 shows nothing when its own station is out of range...
  expect(r.vor2).toBe('');
  // ...while VOR1, from the same spot, still names the nearest usable station (when distinct).
  if (r.south !== r.ref) expect(r.vor1.startsWith(r.south + ' ')).toBe(true);
});

test('the on-map readout shows both VOR1 and VOR2 lines', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const v1 = vors.find(v => v.ident === 'BGN') || vors[0];
    const v2 = vors.find(v => v.ident !== v1.ident);
    setReferenceVor(v1.ident);
    setReferenceVor2(v2.ident);
    showVorReadout(v1.lat + 0.05, v1.lng + 0.05);
    const box = document.getElementById('vor-readout');
    const lines = Array.from(box.children).map(c => c.textContent);
    return { count: lines.length, lines, has2: !!box.querySelector('.vor-readout-2'),
      id1: v1.ident, id2: v2.ident, shown: box.classList.contains('show') };
  });
  expect(r.shown).toBe(true);
  expect(r.count).toBe(2);
  expect(r.has2).toBe(true);
  expect(r.lines[0].startsWith(r.id1 + ' ')).toBe(true);
  expect(r.lines[1].startsWith(r.id2 + ' ')).toBe(true);
});

test('a VOR station inspector offers both slots; the VOR2 button toggles vorRef2', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    window.showVorStations = true;
    if (typeof syncVorUI === 'function') syncVorUI();
    draw();
    const v = vors.find(x => x.ident === 'BGN') || vors[0];
    state.selected = { type: 'vor', index: vors.indexOf(v) };
    showInspector();
  });
  const b1 = page.locator('#insp-vor-use-ref');
  const b2 = page.locator('#insp-vor-use-ref-2');
  await b1.waitFor();
  await b2.waitFor();
  const ident = await page.evaluate(() => (vors.find(x => x.ident === 'BGN') || vors[0]).ident);
  await b2.click();
  expect(await page.evaluate(() => vorRef2)).toBe(ident);
  // The label flipped to the active/clear state, and VOR1 is untouched.
  await expect(b2).toContainText('tap to clear');
  expect(await page.evaluate(() => vorRef)).not.toBe(ident);
  await b2.click();                                   // tap again clears VOR2
  expect(await page.evaluate(() => vorRef2)).toBeNull();
});

test('a point inspector shows a VOR2 row with its own radial/DME', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const v2 = vors.find(v => v.ident === 'BGN') || vors[0];
    setReferenceVor2(v2.ident);
    state.waypoints = [{ lat: v2.lat + 0.1, lng: v2.lng + 0.1, name: 'A' },
                       { lat: v2.lat + 0.2, lng: v2.lng + 0.2, name: 'B' }];
    syncLegs(); draw(); state.selected = { type: 'wp', index: 0 }; showInspector();
  });
  const row2 = page.locator('#inspector .vor-radial-row-2').first();
  await row2.waitFor();
  const txt = await row2.locator('.vor-radial-val').textContent();
  expect(txt).toMatch(/R-\d+° \/ [\d.]+ NM/);
});

async function openPlan(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.1, lng: 34.85, name: 'A' },
      { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
    ];
    syncLegs(); draw();
  });
  await page.locator('#plan').click();
  await page.locator('.modal-back').waitFor();
}

test('flight plan: the Radial 2 / DME 2 pair stays off until VOR 2 is tuned', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  const table = page.locator('.flight-table').first();
  await expect(table).toHaveClass(/vor2-off/);
  await expect(table.locator('thead .fp-vor2-col').first()).toBeHidden();
  await page.locator('#fp-vor-select-2').selectOption('NAT');
  expect(await page.evaluate(() => vorRef2)).toBe('NAT');
  await expect(table).not.toHaveClass(/vor2-off/);
  await expect(table.locator('thead .fp-vor2-col').first()).toBeVisible();
});

test('flight plan: VOR 2 reads its own Radial/DME to the leg start, beside VOR 1', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  await page.locator('#fp-vor-select').selectOption('BGN');
  await page.locator('#fp-vor-select-2').selectOption('NAT');
  const headers = await page.locator('.flight-table thead th').allTextContents();
  const r2 = headers.indexOf('Radial 2');
  expect(r2).toBeGreaterThan(headers.indexOf('DME 1'));      // after VOR 1's pair
  const exp = await page.evaluate(() => {
    const rd = vorRadialDme(vorByIdent('NAT'), 32.1, 34.85);
    return { r: 'R-' + rd.radial, d: String(rd.dme) };
  });
  const row = page.locator('.flight-table tbody tr').first();
  // Radial 2 carries its own per-leg picker, like Radial 1, plus the value.
  await expect(row.locator('td').nth(r2).locator('select.fp-leg-vor2')).toHaveCount(1);
  await expect(row.locator('td').nth(r2).locator('.fp-radial-val')).toHaveText(exp.r);
  await expect(row.locator('td').nth(r2 + 1)).toHaveText(exp.d);
});

test('the CSV carries VOR 2 only when it is tuned', async ({ page }) => {
  await boot(page);
  await openPlan(page);
  const csvHead = () => page.evaluate(() => {
    const area = document.querySelector('.flight-table').parentElement;
    return flightPlanCsv(document.querySelector('.flight-table'), area).split(/\r?\n/).slice(0, 3).join('\n');
  });
  expect(await csvHead()).not.toContain('Radial 2');
  await page.locator('#fp-vor-select-2').selectOption('NAT');
  expect(await csvHead()).toContain('Radial 2');
});

test('retuning a leg\'s VOR carries to the legs after it, until a later retune', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.85, name: 'A' }, { lat: 32.2, lng: 34.88, name: 'B' },
      { lat: 32.4, lng: 34.91, name: 'C' }, { lat: 32.6, lng: 34.95, name: 'D' },
      { lat: 32.8, lng: 35.0, name: 'E' },
    ];
    syncLegs(); draw();
  });
  await page.locator('#plan').click();
  await page.locator('.modal-back').waitFor();
  // A route VOR first: the per-leg pickers live in the Radial column, hidden until one is on.
  const routeVor = await page.evaluate(() => vors.find(v => v.ident !== 'BGN' && v.ident !== 'NAT').ident);
  await page.locator('#fp-vor-select').selectOption(routeVor);
  const legSel = (i) => page.locator('.flight-table').first().locator('tbody tr').nth(i).locator('select.fp-leg-vor');
  // Leg 4 (index 3) tuned to its own station first: a later retune that must hold.
  await legSel(3).selectOption('BGN');
  // Retune leg 2 (index 1): legs 2-3 follow, leg 4 keeps BGN, leg 1 is untouched.
  await legSel(1).selectOption('NAT');
  expect(await page.evaluate(() => state.legs.map(l => l.vorRef || null)))
    .toEqual([null, 'NAT', 'NAT', 'BGN']);
});

test('VOR 2 has a per-leg picker too, and a retune carries forward like VOR 1', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.85, name: 'A' }, { lat: 32.2, lng: 34.88, name: 'B' },
      { lat: 32.4, lng: 34.91, name: 'C' }, { lat: 32.6, lng: 34.95, name: 'D' },
    ];
    syncLegs(); draw();
  });
  await page.locator('#plan').click();
  await page.locator('.modal-back').waitFor();
  await page.locator('#fp-vor-select-2').selectOption('NAT');      // route VOR 2 on: pickers show
  const sel2 = (i) => page.locator('.flight-table').first().locator('tbody tr').nth(i).locator('select.fp-leg-vor2');
  await sel2(1).selectOption('BGN');
  expect(await page.evaluate(() => state.legs.map(l => l.vorRef2 || null))).toEqual([null, 'BGN', 'BGN']);
  // VOR 1's per-leg choices are untouched by VOR 2's.
  expect(await page.evaluate(() => state.legs.map(l => l.vorRef || null))).toEqual([null, null, null]);
  // And it is a route field: it survives the route round trip.
  const rt = await page.evaluate(() => JSON.parse(JSON.stringify(serializeRoute())).legs.map(l => l.vorRef2 || null));
  expect(rt).toEqual([null, 'BGN', 'BGN']);
});

test('a station is at most one reference: taking it as VOR 2 releases it from VOR 1', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const v1 = vors.find(v => v.ident === 'BGN') || vors[0];
    setReferenceVor(v1.ident);
    setReferenceVor2(v1.ident);                    // same station -> moves to VOR 2
    const moved = { vor1: vorRef, vor2: vorRef2 };
    setReferenceVor(v1.ident);                     // back to VOR 1 -> releases VOR 2
    const back = { vor1: vorRef, vor2: vorRef2 };
    return { moved, back, id: v1.ident };
  });
  expect(r.moved).toEqual({ vor1: null, vor2: r.id });
  expect(r.back).toEqual({ vor1: r.id, vor2: null });
});

test('the station inspector disables the slot a station already fills on the other', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const v = vors.find(x => x.ident === 'BGN') || vors[0];
    setReferenceVor(v.ident);                      // this station is VOR 1
    window.showVorStations = true; if (typeof syncVorUI === 'function') syncVorUI(); draw();
    state.selected = { type: 'vor', index: vors.indexOf(v) }; showInspector();
  });
  // VOR 1 button active (clearable); VOR 2 button disabled (can't also be VOR 2).
  await expect(page.locator('#insp-vor-use-ref')).toBeEnabled();
  await expect(page.locator('#insp-vor-use-ref-2')).toBeDisabled();
});
