// @ts-check
// Verify route JSON import rejects malformed exports without mutating state.
// Every spec uploads a file to the hidden #file <input>, captures the resulting
// alert, and asserts that state.waypoints is unchanged.
const { test, expect } = require('./_setup');
const { LLHZ, LLHA } = require('./_airfieldArp');

const ROUTE = {
  waypoints: [
    { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
    { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
    { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
  ],
};

async function bootWithRoute(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_init_v1', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof syncLegs === 'function');
  await page.evaluate(route => {
    state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    draw();
  }, ROUTE);
}

// Upload a JSON blob to #file. Returns the message body of the alert that fires
// (or null if no alert). Confirm is dismissed so it doesn't block other tests.
async function uploadAndCapture(page, contents) {
  let alerted = null;
  page.once('dialog', d => { alerted = d.message(); d.accept(); });
  await page.setInputFiles('#file', {
    name: 'corrupt.json',
    mimeType: 'application/json',
    buffer: Buffer.from(contents, 'utf8'),
  });
  // The import is async (FileReader.onload); give it a tick to fire.
  await page.waitForTimeout(150);
  return alerted;
}

test.describe('Route import rejection', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('malformed JSON: parse error surfaces, state unchanged', async ({ page }) => {
    const msg = await uploadAndCapture(page, '{ this is not json');
    expect(msg).toMatch(/Could not load file/i);
    const len = await page.evaluate(() => state.waypoints.length);
    expect(len).toBe(3);                       // original route intact
  });

  // A top-level array is now read as a saved-routes library first (that is what
  // "Export library" writes), so an array of junk is rejected as "not a library"
  // rather than with the single-route validator's "expected object, got array".
  // See export-import-guards.spec.js.
  test('root is array of junk: rejected as not a saved-routes library', async ({ page }) => {
    const msg = await uploadAndCapture(page, '[1,2,3]');
    expect(msg).toMatch(/not a saved-routes library/);
    expect(msg).not.toMatch(/waypoints/);
  });

  test('missing waypoints field: rejected', async ({ page }) => {
    const msg = await uploadAndCapture(page, JSON.stringify({ legs: [], notes: [] }));
    expect(msg).toMatch(/waypoints.*missing/);
  });

  test('waypoint missing lat: rejected with field path', async ({ page }) => {
    const bad = {
      waypoints: [{ lng: 34.83, name: 'X' }, { lat: 32.81, lng: 35.04, name: 'Y' }],
      legs: [{ inboundAltitude: 1500, outboundAltitude: 2000, flightSpeed: 90,
               inLabel: { a: 0, p: 44 }, outLabel: { a: 0, p: -44 } }],
      notes: [],
    };
    const msg = await uploadAndCapture(page, JSON.stringify(bad));
    expect(msg).toMatch(/waypoints\[0\]\.lat.*missing/);
  });

  test('waypoint lat is a string: rejected', async ({ page }) => {
    const bad = {
      waypoints: [
        { lat: 'not-a-number', lng: 34.83, name: 'X' },
        { lat: 32.81, lng: 35.04, name: 'Y' },
      ],
      legs: [{ inboundAltitude: 1500, outboundAltitude: 2000, flightSpeed: 90,
               inLabel: { a: 0, p: 44 }, outLabel: { a: 0, p: -44 } }],
      notes: [],
    };
    const msg = await uploadAndCapture(page, JSON.stringify(bad));
    expect(msg).toMatch(/waypoints\[0\]\.lat.*expected number.*string/);
  });

  test('legs.length mismatch (3 wps but 0 legs): rejected', async ({ page }) => {
    const bad = {
      waypoints: ROUTE.waypoints,
      legs: [],
      notes: [],
    };
    const msg = await uploadAndCapture(page, JSON.stringify(bad));
    expect(msg).toMatch(/legs.*length.*does not match/);
  });

  test('leg missing inLabel: rejected', async ({ page }) => {
    const bad = {
      waypoints: [
        { lat: 32.18, lng: 34.83, name: 'A' },
        { lat: 32.80, lng: 35.04, name: 'B' },
      ],
      legs: [{ inboundAltitude: 1500, outboundAltitude: 2000, flightSpeed: 90,
               outLabel: { a: 0, p: -44 } }],     // inLabel missing
      notes: [],
    };
    const msg = await uploadAndCapture(page, JSON.stringify(bad));
    expect(msg).toMatch(/legs\[0\]\.inLabel.*missing/);
  });

  test('note with invalid shape: rejected', async ({ page }) => {
    const bad = {
      waypoints: [], legs: [],
      notes: [{ lat: 32.5, lng: 35.0, text: 'X', color: '#fff', shape: 'triangle' }],
    };
    const msg = await uploadAndCapture(page, JSON.stringify(bad));
    expect(msg).toMatch(/notes\[0\]\.shape.*"rect" or "oval"/);
  });

  test('NaN lat: rejected (validator forbids non-finite numbers)', async ({ page }) => {
    // JSON has no native NaN — emit a stringly value the parser turns into 'null',
    // and validateRoute should flag the resulting null as a non-number.
    const bad = `{
      "waypoints": [
        { "lat": null, "lng": 34.83, "name": "X" },
        { "lat": 32.80, "lng": 35.04, "name": "Y" }
      ],
      "legs": [{ "inboundAltitude": 1500, "outboundAltitude": 2000, "flightSpeed": 90,
                 "inLabel": { "a": 0, "p": 44 }, "outLabel": { "a": 0, "p": -44 } }],
      "notes": []
    }`;
    const msg = await uploadAndCapture(page, bad);
    expect(msg).toMatch(/waypoints\[0\]\.lat.*expected number.*null/);
  });

  test('file size cap: 3 MB blob rejected without parsing (#146)', async ({ page }) => {
    const big = '{"waypoints":[],"legs":[],"notes":[],"pad":"' + 'x'.repeat(3 * 1024 * 1024) + '"}';
    const msg = await uploadAndCapture(page, big);
    expect(msg).toMatch(/Could not load file.*too large.*max 2 MB/);
    const len = await page.evaluate(() => state.waypoints.length);
    expect(len).toBe(3);
  });

  test('valid round-trip: save() then import same blob — state matches', async ({ page }) => {
    const blob = await page.evaluate(() => JSON.stringify({
      waypoints: state.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name || '' })),
      legs: state.legs.map(l => ({
        inboundAltitude: l.inboundAltitude,
        outboundAltitude: l.outboundAltitude,
        flightSpeed: l.flightSpeed,
        outboundSpeed: l.outboundSpeed,
        inLabel: l.inLabel, outLabel: l.outLabel,
      })),
      notes: [],
    }));
    // Clear the route, then re-import. Any rejection path here means save()
    // produces a blob its own validator refuses — that's the bug we want to catch.
    await page.evaluate(() => { state.waypoints = []; state.legs = []; state.notes = []; draw(); });
    page.once('dialog', d => d.dismiss());     // shouldn't fire
    await page.setInputFiles('#file', {
      name: 'route.json', mimeType: 'application/json',
      buffer: Buffer.from(blob, 'utf8'),
    });
    await page.waitForFunction(() => state.waypoints.length === 3);
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['LLHZ', 'BAZRA', 'LLHA']);
  });
});
