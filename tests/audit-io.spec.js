// @ts-check
// Regression coverage for a batch of review findings in docs/app/io.js: flight-plan edits
// after undo, the CSV under the out/back filter, the replace question on GPX/PLN import,
// planning forms through Import library, the auto-route closed-corridor fallback, share
// links that stayed in the address bar or carried an unplaceable freq note, half-typed
// altitude pairs, the NOTAM rows of the frequency table and the reset button's pointer flag.
const { test, expect } = require('./_setup');

async function boot(page, q = '?lang=en&nogist') {
  await page.goto(q);
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof syncLegs === 'function'
    && typeof showFlightPlan === 'function' && typeof buildShareUrl === 'function');
}

const ROUTE3 = [
  { lat: 32.10, lng: 34.80, name: 'ALFA' },
  { lat: 32.22, lng: 34.85, name: 'BRAVO' },
  { lat: 32.34, lng: 34.90, name: 'CHARLIE' },
];

test('a flight-plan speed edit after undo lands on the live leg', async ({ page }) => {
  await boot(page);
  await page.evaluate((r) => {
    state.waypoints = r.map(w => ({ ...w }));
    state.legs = []; syncLegs(); state.legs.forEach(l => { l.flightSpeed = 100; l.outboundSpeed = 100; });
    draw(); showFlightPlan();
  }, ROUTE3);
  await page.waitForSelector('.flight-table tbody tr');
  const got = await page.evaluate(() => {
    // What undo does: same number of legs, every leg a new object. The table is not rebuilt.
    state.legs = state.legs.map(l => ({ ...l }));
    if (refreshFlightPlan) refreshFlightPlan();
    const inp = document.querySelector('.flight-table tbody tr').querySelectorAll('input.plan-num')[0];
    inp.value = '137';
    inp.dispatchEvent(new Event('change'));
    return { speed: state.legs[0].flightSpeed, box: inp.value };
  });
  expect(got.speed).toBe(137);
  expect(got.box).toBe('137');
});

test('the CSV leaves out the legs the out/back filter hides', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'A' },
      { lat: 32.10, lng: 34.1, name: 'B' },
      { lat: 32.00, lng: 34.0, name: 'A' },
    ];
    state.legs = []; syncLegs(); state.legs.forEach(l => { l.flightSpeed = 100; });
    window.legDirFilter = 'out';
    draw(); showFlightPlan();
  });
  await page.waitForSelector('.flight-table tbody tr');
  const out = await page.evaluate(() => {
    const table = document.querySelector('.flight-table');
    const scrollArea = table.parentElement;
    const visibleRows = [...table.querySelectorAll('tbody tr')].filter(r => !r.hidden).length;
    const csv = flightPlanCsv(table, scrollArea);
    window.legDirFilter = 'both';
    return { visibleRows, csv };
  });
  expect(out.visibleRows).toBe(1);
  // Section title, header, one leg, the total -- not the hidden way back.
  const firstSection = out.csv.split('\r\n\r\n')[0].split('\r\n').filter(Boolean);
  expect(firstSection.length).toBe(4);
});

for (const kind of ['gpx', 'pln']) {
  test(`a ${kind.toUpperCase()} import asks before replacing the route on the map`, async ({ page }) => {
    await boot(page);
    const body = kind === 'gpx'
      ? '<?xml version="1.0"?><gpx><rte><rtept lat="31.5" lon="34.5"><name>X1</name></rtept>' +
        '<rtept lat="31.6" lon="34.6"><name>X2</name></rtept></rte></gpx>'
      : '<?xml version="1.0"?><SimBase.Document><FlightPlan.FlightPlan>' +
        '<ATCWaypoint id="X1"><WorldPosition>31.5,34.5</WorldPosition></ATCWaypoint>' +
        '<ATCWaypoint id="X2"><WorldPosition>31.6,34.6</WorldPosition></ATCWaypoint>' +
        '</FlightPlan.FlightPlan></SimBase.Document>';
    await page.evaluate((r) => {
      state.waypoints = r.map(w => ({ ...w })); state.legs = []; syncLegs(); draw();
      window.__asked = 0; window.__answer = false;
      window.askYesNo = async () => { window.__asked++; return window.__answer; };
    }, ROUTE3);
    const file = { name: 'route.' + kind, mimeType: 'application/xml', buffer: Buffer.from(body, 'utf8') };
    await page.setInputFiles('#file', file);
    await page.waitForFunction(() => window.__asked === 1);
    expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['ALFA', 'BRAVO', 'CHARLIE']);
    await page.evaluate(() => { window.__answer = true; });
    await page.setInputFiles('#file', file);
    await page.waitForFunction(() => window.__asked === 2 && state.waypoints.length === 2);
    expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['X1', 'X2']);
  });
}

test('Import library keeps the planning form saved with a route', async ({ page }) => {
  await boot(page);
  const res = await page.evaluate((r) => {
    state.waypoints = r.map(w => ({ ...w })); state.legs = []; syncLegs();
    const data = JSON.parse(JSON.stringify(serializeRoute()));
    const navlog = { met: [{ alt: 3000, dir: 270, kt: 15, tempC: 10 }], variationDeg: 5 };
    const huge = { met: Array.from({ length: 5000 }, (_, i) => ({ alt: i, dir: 0, kt: 0, tempC: 0, pad: 'x'.repeat(20) })) };
    const out = importRouteLibraryArray([
      { name: 'With form', data, navlog },
      { name: 'Oversized form', data, navlog: huge },
    ]);
    const byName = n => out.merged.find(e => e.name === n);
    return { added: out.added, form: byName('With form').navlog, huge: byName('Oversized form').navlog };
  }, ROUTE3);
  expect(res.added).toBe(2);
  expect(res.form).toEqual({ met: [{ alt: 3000, dir: 270, kt: 15, tempC: 10 }], variationDeg: 5 });
  expect(res.huge).toBeUndefined();
});

test('auto-route warns when only a closed corridor connects the two points', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => typeof autoRouteChain === 'function' && typeof airfieldByIcao === 'function');
  const out = await page.evaluate(async () => {
    window.autoRouteCorridors = true;
    await loadAirfields(); await loadNavWaypoints();
    window.__said = [];
    const realToast = window.showToast;
    window.showToast = (m, o) => { window.__said.push({ m: String(m), warn: !!(o && o.warn) }); };
    const ha = airfieldByIcao('LLHA'), hz = airfieldByIcao('LLHZ');
    const A = { lat: ha.lat, lng: ha.lng, name: 'LLHA' }, B = { lat: hz.lat, lng: hz.lng, name: 'LLHZ' };
    const open = await autoRouteChain(A, B);
    const saidOpen = window.__said.length;
    // Every corridor closed by NOTAM: only the ignore-availability fallback finds a chain.
    const real = window.fplGraphChain;
    window.fplGraphChain = (g, a, b, o) => (o && o.ignoreAvailability) ? real(g, a, b, o) : null;
    const closed = await autoRouteChain(A, B);
    // The chain carries the flag; nothing is said until a caller draws it (review: a discarded
    // reply warned about a route nobody saw).
    const saidBeforeDraw = window.__said.length;
    warnAutoRouteClosedCorridor();
    window.fplGraphChain = real;
    window.showToast = realToast;
    return { open: !!open, openFlag: !!(open && open.closedCorridor), saidOpen, closed: !!closed,
      closedFlag: !!(closed && closed.closedCorridor), saidBeforeDraw, said: window.__said };
  });
  expect(out.open).toBe(true);
  expect(out.openFlag).toBe(false);
  expect(out.saidOpen).toBe(0);
  expect(out.closed).toBe(true);
  expect(out.closedFlag).toBe(true);
  expect(out.saidBeforeDraw).toBe(0);
  expect(out.said.length).toBe(1);
  expect(out.said[0].warn).toBe(true);
  expect(out.said[0].m).toContain('NOTAM');
});

test('a share link leaves the address bar once its route is loaded', async ({ page }) => {
  await boot(page);
  const search = await page.evaluate((r) => {
    state.waypoints = r.map(w => ({ ...w })); state.legs = []; syncLegs();
    return new URL(buildShareUrl().url).search;
  }, ROUTE3);
  expect(search).toContain('r=');
  const q = new URLSearchParams(search);
  q.set('lang', 'en'); q.set('nogist', '');
  await page.goto('?' + q.toString());
  await page.waitForFunction(() => typeof state !== 'undefined' && state.waypoints.length === 3);
  const after = new URL(page.url()).searchParams;
  for (const k of ['r', 'n', 'l']) expect(after.has(k), k).toBe(false);
  expect(after.get('lang')).toBe('en');
});

test('a share-link freq note that matches no waypoint is dropped, not saved without a position', async ({ page }) => {
  await boot(page);
  const search = await page.evaluate((r) => {
    state.waypoints = r.map(w => ({ ...w })); state.legs = []; syncLegs();
    state.notes = [{ lat: 32.2, lng: 34.8, text: 'Freq change', color: '#fff6aa', shape: 'rect',
      cc: 'NOWHERE', freqName: 'Test', freq: '123.45' }];
    const s = new URL(buildShareUrl().url).search;
    state.notes = [];
    return s;
  }, ROUTE3);
  expect(search).toContain('f=');
  const q = new URLSearchParams(search);
  q.set('lang', 'en'); q.set('nogist', '');
  await page.goto('?' + q.toString());
  await page.waitForFunction(() => typeof state !== 'undefined' && state.waypoints.length === 3);
  const out = await page.evaluate(() => ({
    orphan: state.notes.filter(n => n.cc === 'NOWHERE').length,
    allPlaced: state.notes.every(n => Number.isFinite(n.lat) && Number.isFinite(n.lng)),
    verr: validateRoute(JSON.parse(JSON.stringify(serializeRoute()))),
  }));
  expect(out.orphan).toBe(0);
  expect(out.allPlaced).toBe(true);
  expect(out.verr).toBeFalsy();
});

test('a half-typed altitude pair value is refused, not written as a clear', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.settings', '1'); } catch (e) {}
  });
  await boot(page);
  await page.evaluate(() => showAltitudePairsModal());
  await page.waitForFunction(() => [...document.querySelectorAll('input.charts-alt-input')].some(i => i.value !== ''));
  const idx = await page.evaluate(() => [...document.querySelectorAll('input.charts-alt-input')].findIndex(i => i.value !== ''));
  const target = page.locator('input.charts-alt-input').nth(idx);
  const before = await target.inputValue();
  await target.click();
  await target.press('Control+A');
  await page.keyboard.type('-');
  expect(await target.evaluate(el => /** @type {HTMLInputElement} */ (el).validity.badInput)).toBe(true);
  await target.evaluate(el => el.blur());
  expect(await target.getAttribute('aria-invalid')).toBe('true');
  // The stored pair still holds the old value: re-render and read it back.
  const reread = await page.evaluate((i) => {
    let host = document.querySelector('input.charts-alt-input');
    while (host && !host._altitudePairsRenderOpts) host = host.parentElement;
    renderAltitudePairsTable(host);
    return document.querySelectorAll('input.charts-alt-input')[i].value;
  }, idx);
  expect(reread).toBe(before);
});

test('frequency table: a stored edit shows over the NOTAM, and a NOTAM-only row is read-only', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    await loadAirfields();
    const withClr = airfields.find(a => typeof a.clearance === 'string' && airfieldFieldParts(a, 'clearance').length);
    const without = airfields.find(a => a !== withClr && !airfieldFieldParts(a, 'clearance').length);
    window.airfieldFreqChangeFor = (af, svc) => (svc === 'clearance' && af && (af.name === withClr.name || af.name === without.name))
      ? { id: 'A0001/26', freq: '121.900', service: 'clearance' } : null;
    const key = airfieldFieldParts(withClr, 'clearance')[0].key;
    setAirfieldFreqOverride(key, '122.350');
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderFreqTable(host);
    const rowOf = icao => host.querySelector('tr.freq-notam-changed[data-icao="' + icao + '"]');
    const edited = rowOf(withClr.name);
    const notamOnly = rowOf(without.name);
    return {
      editedValue: edited && edited.querySelector('input.charts-freq-input').value,
      editedOverridden: edited && edited.classList.contains('overridden'),
      notamOnlyDisabled: notamOnly && notamOnly.querySelector('input.charts-freq-input').disabled,
    };
  });
  expect(out.editedOverridden).toBe(true);
  expect(out.editedValue).toBe('122.350');
  expect(out.notamOnlyDisabled).toBe(true);
});

test('a reset that disables itself on pointerdown does not swallow the next keyboard press', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'audit-reset';
    b.textContent = 'R';
    document.body.appendChild(b);
    window.__resets = 0;
    wireAltitudePairResetButton(b, () => { window.__resets++; b.disabled = true; });
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    // Disabled: the trailing click never arrives. Later an edit enables it again.
    b.disabled = false;
    b.focus();
  });
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__resets)).toBe(2);
});
