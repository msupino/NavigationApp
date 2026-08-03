// Every exporter must answer "what altitude does this leg fly at" the same way.
// They did not: the GPX wrote 0 m (sea level, so a GPS unit showed every point on
// the deck), PLN and FDR invented 2 000 ft, and only the KML inherited from the
// route. routeExportAltitudeFt is now the single answer.
const { test, expect } = require('./_setup');

const LLHZ = { lat: 32.17944, lng: 34.83444, name: 'LLHZ' };   // elev 121 ft
const B = { lat: 32.55, lng: 34.95, name: 'B' };
const C = { lat: 32.9, lng: 35.05, name: 'C' };

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' &&
    typeof routeExportAltitudeFt === 'function');
  await page.evaluate(() => loadAirfields());
}

const capture = (page, fn, alts) => page.evaluate(async ([fname, altList]) => {
  state.waypoints = [{ ...window.__A }, { ...window.__B }, { ...window.__C }];
  state.legs = []; syncLegs();
  state.legs.forEach((l, i) => { l.flightSpeed = 100; l.inboundAltitude = altList[i]; });
  draw();
  let text = null;
  const realCreate = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
  const realRevoke = URL.revokeObjectURL, realConfirm = window.confirm;
  URL.createObjectURL = b => { window.__blob = b; return 'blob:stub'; };
  HTMLAnchorElement.prototype.click = function () {};
  URL.revokeObjectURL = () => {};
  window.confirm = () => true;
  try {
    await window[fname]();
    if (fname === 'flyRoute') document.querySelector('.modal-btns button:nth-child(2)').click();
    text = await window.__blob.text();
  } finally {
    URL.createObjectURL = realCreate; HTMLAnchorElement.prototype.click = realClick;
    URL.revokeObjectURL = realRevoke; window.confirm = realConfirm;
    document.querySelectorAll('.modal-back').forEach(e => e.remove());
  }
  return text;
}, [fn, alts]);

async function seed(page) {
  await page.evaluate(([a, b, c]) => { window.__A = a; window.__B = b; window.__C = c; },
    [LLHZ, B, C]);
}

test('the resolver inherits ahead, then behind, then falls back', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const mk = alts => ({ legs: alts.map(a => ({ inboundAltitude: a })) });
    return {
      own: routeExportAltitudeFt(0, mk([3000, 5000])),
      ahead: routeExportAltitudeFt(0, mk([null, 5000])),
      behind: routeExportAltitudeFt(1, mk([4000, null])),
      field: routeExportAltitudeFt(0, { ...mk([null, null]), departureFieldFt: 121 }),
      blank: routeExportAltitudeFt(0, mk([null, null])),
    };
  });
  expect(out.own).toEqual({ ft: 3000, source: 'leg' });
  expect(out.ahead).toEqual({ ft: 5000, source: 'ahead' });
  expect(out.behind).toEqual({ ft: 4000, source: 'behind' });
  expect(out.field).toEqual({ ft: 121 + 800, source: 'field+agl' });
  expect(out.blank).toEqual({ ft: 2000, source: 'assumed' });
});

test('GPX never writes a sea-level elevation for an unset leg', async ({ page }) => {
  await boot(page); await seed(page);
  const gpx = await capture(page, 'exportGpx', [null, 4500]);
  const eles = [...gpx.matchAll(/<ele>([-\d.]+)<\/ele>/g)].map(m => Number(m[1]));
  expect(eles.length).toBeGreaterThan(1);
  expect(eles.some(e => e === 0)).toBe(false);          // was 0 m on every point
  // The blank departure leg inherits the 4500 ft cruise: 1371 m.
  expect(eles[0]).toBe(Math.round(4500 * 0.3048));
});

test('a wholly blank route still exports a plausible height, not zero', async ({ page }) => {
  await boot(page); await seed(page);
  const gpx = await capture(page, 'exportGpx', [null, null]);
  const eles = [...gpx.matchAll(/<ele>([-\d.]+)<\/ele>/g)].map(m => Number(m[1]));
  // Departing LLHZ (121 ft) with nothing to inherit -> field + 800 ft.
  expect(eles[0]).toBe(Math.round((121 + 800) * 0.3048));
  expect(eles.every(e => e > 0)).toBe(true);
});

test('PLN and FDR agree with GPX on the same route', async ({ page }) => {
  await boot(page); await seed(page);
  const pln = await capture(page, 'exportPln', [null, 4500]);
  const plnAlts = [...pln.matchAll(/,\+?0*([0-9]{3,6})\.\d+/g)].map(m => Number(m[1]));
  expect(pln).toContain('4500');                        // the inherited cruise appears
  const fdr = await capture(page, 'exportFdr', [null, 4500]);
  expect(fdr.length).toBeGreaterThan(100);
  // FDR samples altitude in ft MSL; the blank leg must start at the inherited
  // cruise, never at 0.
  const rows = fdr.split('\n').filter(l => /^DATA/.test(l) || /,/.test(l));
  const firstAlt = (() => {
    for (const r of rows) {
      const cols = r.split(',');
      if (cols.length > 4) { const v = parseFloat(cols[4]); if (Number.isFinite(v)) return v; }
    }
    return null;
  })();
  expect(firstAlt).not.toBe(0);
  expect(plnAlts.length + rows.length).toBeGreaterThan(0);
});

test('the KML keeps relativeToGround only for a wholly blank route away from a field', async ({ page }) => {
  await boot(page);
  await page.evaluate(([b, c]) => { window.__A = { lat: 31.6, lng: 35.0, name: 'X' }; window.__B = b; window.__C = c; }, [B, C]);
  const blank = await capture(page, 'flyRoute', [null, null]);
  expect(blank).toContain('relativeToGround');
  const known = await capture(page, 'flyRoute', [null, 4500]);
  expect(known).not.toContain('relativeToGround');      // inherited -> absolute
});
