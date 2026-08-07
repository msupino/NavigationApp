// @ts-check
// The magnetic heading in the flight-plan table is the number a pilot flies, and until now the
// suite had no ground truth for it anywhere: the only heading assertion compared the return
// table to the forward table (both built by the same code), and because `parseInt('')` is NaN
// and `Object.is(NaN, NaN)` is true, BLANKING the whole heading column passed 45 tests. A
// magnetic-variation sign flip, or true-vs-magnetic confusion, moves both tables together and
// was equally invisible.
//
// So this file computes the expected values here, from the waypoint coordinates, with an
// implementation deliberately unlike the app's (spherical law of cosines rather than the app's
// haversine + atan2 formulation), and asserts what the table actually shows.
const { test, expect } = require('./_setup');

// Initial great-circle bearing A -> B, degrees true. Independent of docs/app/core.js.
function trueBearing(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const deg = r => (r * 180) / Math.PI;
  const dLon = rad(b.lng - a.lng);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
            Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Israel's variation is ~5°E, so magnetic = true − 5 ("east is least"). Read the app's own
// tunable rather than hard-coding it, but assert the SIGN below so a flip cannot pass.
const toMag = (trueDeg, magVar) => (Math.round(trueDeg + magVar) + 360) % 360;

const ROUTE = [
  { lat: 32.18, lng: 34.83, name: 'A' },     // Herzliya-ish, heading north-east
  { lat: 32.42, lng: 35.05, name: 'B' },
  { lat: 32.60, lng: 34.95, name: 'C' },     // then north-west
  { lat: 32.30, lng: 34.70, name: 'D' },     // then south-west, to exercise all quadrants
];

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' &&
    typeof showFlightPlan === 'function' && typeof tune === 'function');
}

async function openPlan(page, route) {
  return page.evaluate(r => {
    state.waypoints = r.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    window.showReturn = false;
    showFlightPlan();
    return { magVar: tune('magneticVariationDeg') };
  }, route);
}

// Column 3 (0-based) of each body row, e.g. "045°M".
async function tableHeadings(page) {
  return page.evaluate(() => {
    const table = document.querySelector('.modal-back.flight-plan .flight-table');
    if (!table) return null;
    return Array.from(table.querySelectorAll('tbody tr'), r => {
      const cell = r.querySelectorAll('td')[3];
      return cell ? cell.textContent.trim() : null;
    });
  });
}

test('the flight-plan heading column shows the computed magnetic heading', async ({ page }) => {
  await boot(page);
  const { magVar } = await openPlan(page, ROUTE);
  const shown = await tableHeadings(page);
  expect(shown, 'no flight-plan table rendered').not.toBeNull();
  expect(shown).toHaveLength(ROUTE.length - 1);

  for (let i = 0; i < ROUTE.length - 1; i++) {
    const expectedTrue = trueBearing(ROUTE[i], ROUTE[i + 1]);
    const expectedMag = toMag(expectedTrue, magVar);
    // The cell must carry a real 3-digit value — not '', not 'NaN', not '—'.
    expect(shown[i], 'leg ' + i).toMatch(/^\d{3}°M$/);
    const got = parseInt(shown[i], 10);
    expect(Number.isFinite(got), 'leg ' + i + ' is not a number: ' + shown[i]).toBe(true);
    // ±1° for the rounding and the sphere-model difference between the two formulations.
    const diff = Math.min(Math.abs(got - expectedMag), 360 - Math.abs(got - expectedMag));
    expect(diff, 'leg ' + i + ': table ' + shown[i] + ' vs computed ' + expectedMag + '°M')
      .toBeLessThanOrEqual(1);
  }
});

test('magnetic variation is applied in the correct direction', async ({ page }) => {
  await boot(page);
  const { magVar } = await openPlan(page, ROUTE);
  // Israel is ~5°E, expressed here as a NEGATIVE tunable, so magnetic reads LOWER than true.
  // A sign flip would put every heading 10° out and move both tables together, which the
  // reciprocal-only assertion could never see.
  expect(magVar).toBeLessThan(0);
  const shown = await tableHeadings(page);
  const firstTrue = trueBearing(ROUTE[0], ROUTE[1]);
  const got = parseInt(shown[0], 10);
  const wrongWay = (Math.round(firstTrue - magVar) + 360) % 360;
  expect(got).not.toBe(wrongWay);
  expect(Math.abs(got - ((Math.round(firstTrue + magVar) + 360) % 360))).toBeLessThanOrEqual(1);
});

test('a known cardinal leg reads the cardinal heading', async ({ page }) => {
  await boot(page);
  // Due north and due east legs, where the expected answer needs no model at all.
  const { magVar } = await openPlan(page, [
    { lat: 32.00, lng: 34.90, name: 'S' },
    { lat: 32.40, lng: 34.90, name: 'N' },      // due north  -> 000°T
    { lat: 32.40, lng: 35.30, name: 'E' },      // due east   -> 090°T
  ]);
  const shown = await tableHeadings(page);
  const north = (Math.round(0 + magVar) + 360) % 360;    // 355 with -5
  const east = (Math.round(90 + magVar) + 360) % 360;    // 085 with -5
  expect(parseInt(shown[0], 10)).toBe(north);
  // Due east along a meridian-crossing leg: the great-circle initial bearing is slightly
  // north of 090 at this latitude, so allow a degree.
  expect(Math.abs(parseInt(shown[1], 10) - east)).toBeLessThanOrEqual(1);
});

test('the return table is the reciprocal AND both tables carry real numbers', async ({ page }) => {
  await boot(page);
  // showReturn has to be set BEFORE the plan is first built: re-opening an already-open
  // modal does not rebuild it, so the second table never appeared and tables[1] was
  // undefined. That, plus a wrong table selector, is why this spec never ran green.
  const { magVar } = await page.evaluate(r => {
    state.waypoints = r.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    window.showReturn = true;
    showFlightPlan();
    return { magVar: tune('magneticVariationDeg') };
  }, ROUTE);
  const both = await page.evaluate(() => {
    const tables = document.querySelectorAll('.modal-back.flight-plan .flight-table');
    if (tables.length < 2) return { tables: tables.length };
    const read = t => Array.from(t.querySelectorAll('tbody tr'),
      r => ((r.querySelectorAll('td')[3] || {}).textContent || '').trim());
    return { tables: tables.length, fwd: read(tables[0]), ret: read(tables[1]) };
  });
  expect(both.tables, 'the return table did not render').toBe(2);
  // The original assertion was fwd-vs-ret only. Keep it, but prove each side is a real
  // heading first: parseInt('') is NaN and Object.is(NaN, NaN) is true, so BLANKING the
  // whole column used to satisfy "the return is the reciprocal".
  for (const s of [...both.fwd, ...both.ret]) expect(s).toMatch(/^\d{3}°M$/);
  const n = both.fwd.length;
  expect(both.ret).toHaveLength(n);
  for (let i = 0; i < n; i++) {
    const fwd = parseInt(both.fwd[n - 1 - i], 10);
    const ret = parseInt(both.ret[i], 10);
    expect((fwd + 180) % 360).toBe(ret);
    // ...and the forward value still matches the independently computed bearing.
    const expectedMag = toMag(trueBearing(ROUTE[n - 1 - i], ROUTE[n - i]), magVar);
    const diff = Math.min(Math.abs(fwd - expectedMag), 360 - Math.abs(fwd - expectedMag));
    expect(diff).toBeLessThanOrEqual(1);
  }
});

test('the leg inspector shows the same magnetic direction as the plan', async ({ page }) => {
  await boot(page);
  const { magVar } = await openPlan(page, ROUTE);
  const shown = await page.evaluate(() => {
    for (const b of [...document.querySelectorAll('.modal-back.flight-plan .modal-cancel')]) b.click();
    document.querySelectorAll('.modal-back.flight-plan').forEach(m => m.remove());
    state.selected = { type: 'leg', index: 0 };
    showInspector();
    // The leg inspector is built from div rows, not a table — '#insp-body tr' matched
    // nothing, which is the second reason this spec never passed. Find the Direction row by
    // its own label rather than by guessing at units.
    const rows = Array.from(document.querySelectorAll('#insp-body .row, #insp-body > div'));
    const row = rows.find(r => /^Direction/.test(r.textContent.replace(/\s+/g, ' ').trim()));
    return row ? row.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  expect(shown, 'no direction row in the leg inspector').not.toBeNull();
  const got = parseInt((shown.match(/(\d{3})°/) || [])[1], 10);
  const expectedMag = toMag(trueBearing(ROUTE[0], ROUTE[1]), magVar);
  // The inspector's row was asserted only as /\d{3}°/, so the RECIPROCAL passed — which is
  // exactly what swapping the leg's endpoints produces.
  const diff = Math.min(Math.abs(got - expectedMag), 360 - Math.abs(got - expectedMag));
  expect(diff, 'inspector ' + got + '° vs computed ' + expectedMag + '°').toBeLessThanOrEqual(1);
  const reciprocal = (expectedMag + 180) % 360;
  expect(got).not.toBe(reciprocal);
});
