// A leg with no altitude used to export as absolute 0 m — sea level, i.e. the
// camera underground over any terrain. It is now flown at kmlUnsetLegAglFt:
// above the departure field's elevation when the leg starts from an airfield,
// else above whatever terrain is below (relativeToGround).
const { test, expect } = require('./_setup');

async function kmlFor(page, build) {
  return page.evaluate(async (fn) => {
    // eslint-disable-next-line no-new-func
    new Function(fn)();
    let text = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = blob => { window.__kmlBlob = blob; return 'blob:stub'; };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    const realRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = () => {};
    const realConfirm = window.confirm;
    window.confirm = () => true;
    try {
      await flyRoute();
      document.querySelector('.modal-btns button:nth-child(2)').click();
      text = await window.__kmlBlob.text();
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      HTMLAnchorElement.prototype.click = realClick;
      window.confirm = realConfirm;
      document.querySelectorAll('.modal-back').forEach(e => e.remove());
    }
    return text;
  }, build);
}

const cameras = kml =>
  [...kml.matchAll(/<altitude>([-\d.]+)<\/altitude>[\s\S]*?<altitudeMode>(\w+)<\/altitudeMode>/g)]
    .map(m => ({ alt: Number(m[1]), mode: m[2] }));

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof flyRoute === 'function');
  await page.evaluate(() => loadAirfields());
}

test('a leg with no altitude, away from any airfield, flies 800 ft above terrain', async ({ page }) => {
  await boot(page);
  const kml = await kmlFor(page, `
    state.waypoints = [{ lat: 31.6, lng: 35.0, name: 'A' }, { lat: 31.9, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = null; });
    draw();
  `);
  const cams = cameras(kml);
  expect(cams.length).toBeGreaterThan(2);
  const relative = cams.filter(c => c.mode === 'relativeToGround');
  expect(relative.length).toBeGreaterThan(0);
  // 800 ft = 244 m, and nothing at absolute sea level any more.
  for (const c of relative) expect(c.alt).toBe(244);
  expect(cams.some(c => c.mode === 'absolute' && c.alt === 0)).toBe(false);
});

test('a leg with no altitude departing an airfield uses field elevation + 800 ft', async ({ page }) => {
  await boot(page);
  // Airfield records key on `name` (the ICAO code), and carry elev_ft.
  const info = await page.evaluate(() => {
    const af = airfields.find(a => a.name === 'LLHZ');
    return { lat: af.lat, lng: af.lng, elevFt: Number(af.elev_ft), name: af.name };
  });
  expect(Number.isFinite(info.elevFt)).toBe(true);
  const kml = await kmlFor(page, `
    state.waypoints = [{ lat: ${info.lat}, lng: ${info.lng}, name: '${info.name}' },
                       { lat: ${info.lat + 0.3}, lng: ${info.lng + 0.1}, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = null; });
    draw();
  `);
  const cams = cameras(kml);
  const fieldM = Math.round(info.elevFt * 0.3048);
  const expected = fieldM + 244;
  // Mid-leg cameras hold one absolute height: the field plus 800 ft.
  expect(cams.some(c => c.mode === 'absolute' && c.alt === expected)).toBe(true);
  // Departing a known field there is nothing to resolve from terrain.
  expect(cams.every(c => c.mode === 'absolute')).toBe(true);
});

test('a leg with a real altitude is unaffected and stays absolute', async ({ page }) => {
  await boot(page);
  const kml = await kmlFor(page, `
    state.waypoints = [{ lat: 31.6, lng: 35.0, name: 'A' }, { lat: 31.9, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = 3000; });
    draw();
  `);
  const cams = cameras(kml);
  expect(cams.every(c => c.mode === 'absolute')).toBe(true);
  expect(cams.some(c => c.alt === Math.round(3000 * 0.3048))).toBe(true);
});

test('the unset height is gistable', async ({ page }) => {
  await boot(page);
  const kml = await kmlFor(page, `
    setTune('kmlUnsetLegAglFt', 1500);
    state.waypoints = [{ lat: 31.6, lng: 35.0, name: 'A' }, { lat: 31.9, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = null; });
    draw();
  `);
  const relative = cameras(kml).filter(c => c.mode === 'relativeToGround');
  expect(relative.length).toBeGreaterThan(0);
  for (const c of relative) expect(c.alt).toBe(Math.round(1500 * 0.3048));
});

test('a blank departure leg out of an airfield inherits the next leg altitude', async ({ page }) => {
  await boot(page);
  const af = await page.evaluate(() =>
    (a => ({ lat: a.lat, lng: a.lng, name: a.name, elevFt: Number(a.elev_ft) }))(
      airfields.find(x => x.name === 'LLHZ')));
  const kml = await kmlFor(page, `
    state.waypoints = [{ lat: ${af.lat}, lng: ${af.lng}, name: '${af.name}' },
                       { lat: ${af.lat + 0.25}, lng: ${af.lng + 0.10}, name: 'B' },
                       { lat: ${af.lat + 0.50}, lng: ${af.lng + 0.20}, name: 'C' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; });
    state.legs[0].inboundAltitude = null;   // departure leg left blank
    state.legs[1].inboundAltitude = 3500;   // cruise filled in
    draw();
  `);
  const cams = cameras(kml);
  const cruiseM = Math.round(3500 * 0.3048);
  // The blank departure leg flies the cruise height, not field + 800 ft.
  expect(cams.some(c => c.mode === 'absolute' && c.alt === cruiseM)).toBe(true);
  const fieldPlus800 = Math.round(af.elevFt * 0.3048) + 244;
  expect(cams.some(c => c.alt === fieldPlus800)).toBe(false);
  expect(cams.every(c => c.mode === 'absolute')).toBe(true);
});

test('a blank leg with altitudes only behind it inherits backwards', async ({ page }) => {
  await boot(page);
  const kml = await kmlFor(page, `
    state.waypoints = [{ lat: 31.60, lng: 35.00, name: 'A' },
                       { lat: 31.85, lng: 35.10, name: 'B' },
                       { lat: 32.10, lng: 35.20, name: 'C' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; });
    state.legs[0].inboundAltitude = 2500;
    state.legs[1].inboundAltitude = null;   // nothing ahead to borrow from
    draw();
  `);
  const cams = cameras(kml);
  expect(cams.some(c => c.mode === 'absolute' && c.alt === Math.round(2500 * 0.3048))).toBe(true);
  expect(cams.some(c => c.mode === 'relativeToGround')).toBe(false);
});

test('800 ft AGL applies only when the whole route is blank', async ({ page }) => {
  await boot(page);
  const kml = await kmlFor(page, `
    state.waypoints = [{ lat: 31.60, lng: 35.00, name: 'A' },
                       { lat: 31.85, lng: 35.10, name: 'B' },
                       { lat: 32.10, lng: 35.20, name: 'C' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = null; });
    draw();
  `);
  const rel = cameras(kml).filter(c => c.mode === 'relativeToGround');
  expect(rel.length).toBeGreaterThan(0);
  for (const c of rel) expect(c.alt).toBe(244);
});
