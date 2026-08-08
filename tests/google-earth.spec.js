// @ts-check
// Verify the Google Earth KML download exactly mirrors the route geometry:
// the <LineString>, the per-waypoint <Placemark><Point>s, and the gx:Tour
// camera positions all carry the same lat/lng sequence as state.waypoints.
const { test, expect } = require('./_setup');
const { arp, LLHZ, LLHA } = require('./_airfieldArp');
const AIRFIELDS = require('../docs/data/airfields.json').airfields;
const NAV_WAYPOINTS = require('./_layerData').waypointRows('cvfr');
const LLMZ = arp('LLMZ');

const NAV_EN = new Map(NAV_WAYPOINTS.map(w => [w.name, w.en]));
function displayName(code) {
  return NAV_EN.get(code) || code;
}

const ROUTE = {
  waypoints: [
    { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
    { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
    { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
    { lat: 32.32306, lng: 34.90389, name: 'SHARO' },
    { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
    { lat: 32.59194, lng: 34.94639, name: 'FRDIS' },
    { lat: 32.71444, lng: 34.97083, name: 'BOREN' },
    { lat: 32.75389, lng: 34.93694, name: 'HOTRM' },
    { lat: 32.79611, lng: 34.94333, name: 'DAROM' },
    { lat: 32.84111, lng: 34.98111, name: 'GALIM' },
    { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
  ],
};

async function bootWithRoute(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
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

async function captureKml(page) {
  // Accept the 'Fly the route' confirm dialog as soon as it fires.
  page.once('dialog', d => d.accept());
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#fly').click();
  // Mode picker modal — pick the desktop KML option.
  await page.getByRole('button', { name: 'Google Earth Pro (KML)' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function parseLineStringCoords(kml) {
  const m = kml.match(/<LineString>[\s\S]*?<coordinates>([^<]+)<\/coordinates>/);
  if (!m) throw new Error('no LineString coordinates in KML');
  return m[1].trim().split(/\s+/).map(t => {
    const [lng, lat, alt] = t.split(',').map(Number);
    return { lat, lng, alt: Number.isFinite(alt) ? alt : 0 };
  });
}

function parsePlacemarkPoints(kml) {
  const out = [];
  const re = /<Placemark><name>([^<]*)<\/name><Point>[\s\S]*?<coordinates>([^<]+)<\/coordinates><\/Point><\/Placemark>/g;
  let m;
  while ((m = re.exec(kml)) !== null) {
    const [lng, lat] = m[2].split(',').map(Number);
    out.push({ name: m[1], lat, lng });
  }
  return out;
}

function parseTourCameraCoords(kml) {
  const out = [];
  const re = /<gx:FlyTo>[\s\S]*?<longitude>([^<]+)<\/longitude>\s*<latitude>([^<]+)<\/latitude>\s*<altitude>([^<]+)<\/altitude>\s*<heading>([^<]+)<\/heading>/g;
  let m;
  while ((m = re.exec(kml)) !== null) {
    out.push({ lat: Number(m[2]), lng: Number(m[1]), alt: Number(m[3]), heading: Number(m[4]) });
  }
  return out;
}

function headingDelta(a, b) {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

function approxNm(a, b) {
  const meanLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  return Math.hypot((a.lat - b.lat) * 60, (a.lng - b.lng) * 60 * Math.cos(meanLat));
}

function cameraAtWaypoint(cam, wp) {
  return Math.abs(cam.lat - wp.lat) < 1e-5 && Math.abs(cam.lng - wp.lng) < 1e-5;
}

function waypointTourCameras(cams, waypoints) {
  let next = 0;
  return waypoints.map(wp => {
    const idx = cams.findIndex((cam, i) => i >= next && cameraAtWaypoint(cam, wp));
    if (idx < 0) throw new Error('missing tour camera for waypoint ' + wp.name);
    next = idx + 1;
    return cams[idx];
  });
}

function airfieldElevationM(code) {
  const af = AIRFIELDS.find(a => a.name === code);
  if (!af || typeof af.elev_ft !== 'number') {
    throw new Error('missing airfield elevation for ' + code);
  }
  return Math.round(af.elev_ft * 0.3048);
}

test.describe('Google Earth KML export', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('downloaded filename starts with navaid-flythrough- and ends in .kml', async ({ page }) => {
    page.once('dialog', d => d.accept());
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#fly').click();
    await page.getByRole('button', { name: 'Google Earth Pro (KML)' }).click();
    const download = await downloadPromise;
    const name = download.suggestedFilename();
    expect(name).toMatch(/^navaid-flythrough-.+\.kml$/);
  });

  test('LineString coordinates exactly match state.waypoints in order', async ({ page }) => {
    const kml = await captureKml(page);
    const coords = parseLineStringCoords(kml);
    expect(coords).toHaveLength(ROUTE.waypoints.length);
    for (let i = 0; i < ROUTE.waypoints.length; i++) {
      expect(coords[i].lat).toBeCloseTo(ROUTE.waypoints[i].lat, 5);
      expect(coords[i].lng).toBeCloseTo(ROUTE.waypoints[i].lng, 5);
      expect(coords[i].alt).toBe(0);            // legacy Google Earth ground-line hint
    }
  });

  test('LineString keeps Google Earth legacy tessellated ground-line format', async ({ page }) => {
    const kml = await captureKml(page);
    const line = kml.match(/<LineString>([\s\S]*?)<\/LineString>/);
    expect(line).not.toBeNull();
    expect(line[1]).toContain('<tessellate>1</tessellate>');
    expect(line[1]).not.toContain('<altitudeMode>');
    const coordText = line[1].match(/<coordinates>([^<]+)<\/coordinates>/)[1].trim();
    for (const tuple of coordText.split(/\s+/)) {
      const parts = tuple.split(',');
      expect(parts).toHaveLength(3);
      expect(Number(parts[2])).toBe(0);
    }
  });

  test('Per-waypoint Placemark Points use the same coords and displayed names', async ({ page }) => {
    const kml = await captureKml(page);
    const points = parsePlacemarkPoints(kml);
    expect(points).toHaveLength(ROUTE.waypoints.length);
    for (let i = 0; i < ROUTE.waypoints.length; i++) {
      expect(points[i].lat).toBeCloseTo(ROUTE.waypoints[i].lat, 5);
      expect(points[i].lng).toBeCloseTo(ROUTE.waypoints[i].lng, 5);
      expect(points[i].name).toBe(displayName(ROUTE.waypoints[i].name));
    }
  });

  test('gx:Tour cameras visit every waypoint in order', async ({ page }) => {
    const kml = await captureKml(page);
    const cams = parseTourCameraCoords(kml);
    const waypointCams = waypointTourCameras(cams, ROUTE.waypoints);
    expect(waypointCams).toHaveLength(ROUTE.waypoints.length);
    for (let i = 0; i < ROUTE.waypoints.length; i++) {
      expect(waypointCams[i].lat).toBeCloseTo(ROUTE.waypoints[i].lat, 5);
      expect(waypointCams[i].lng).toBeCloseTo(ROUTE.waypoints[i].lng, 5);
    }
  });

  test('gx:Tour cameras round heading changes around waypoint arrivals', async ({ page }) => {
    const turn = { lat: 31.3, lng: 34.8, name: 'TURN' };
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 31.0, lng: 34.8, name: 'START' },
        { lat: 31.3, lng: 34.8, name: 'TURN' },
        { lat: 31.3, lng: 35.2, name: 'FINISH' },
      ];
      syncLegs();
      draw();
    });
    const expected = await page.evaluate(() => ({
      first: geo(state.waypoints[0], state.waypoints[1]).brg,
      turnInbound: geo(state.waypoints[0], state.waypoints[1]).brg,
      turnOutbound: geo(state.waypoints[1], state.waypoints[2]).brg,
      finishInbound: geo(state.waypoints[1], state.waypoints[2]).brg,
    }));
    const kml = await captureKml(page);
    const cams = parseTourCameraCoords(kml);
    expect(cams[0].heading).toBeCloseTo(expected.first, 1);
    const turnIdx = cams.findIndex(c => cameraAtWaypoint(c, turn));
    expect(turnIdx).toBeGreaterThan(3);
    expect(cams[turnIdx - 1].heading).toBeCloseTo(expected.turnInbound, 1);
    expect(cams[turnIdx - 1].lat).toBeLessThan(31.3);
    expect(approxNm(cams[turnIdx - 1], turn)).toBeLessThanOrEqual(0.6);
    expect(cams[turnIdx - 1].lng).toBeCloseTo(34.8, 5);
    expect(cams[turnIdx].heading).toBeCloseTo(expected.turnOutbound, 1);
    expect(headingDelta(cams[turnIdx].heading, expected.turnInbound)).toBeGreaterThan(45);
    expect(cams[turnIdx + 1].lat).toBeCloseTo(31.3, 5);
    expect(cams[turnIdx + 1].lng).toBeGreaterThan(34.8);
    expect(approxNm(cams[turnIdx], cams[turnIdx + 1])).toBeGreaterThan(0.5);
    for (let i = 1; i < cams.length; i++) {
      expect(approxNm(cams[i - 1], cams[i])).toBeLessThanOrEqual(1.6);
    }
  });

  test('gx:Tour headings stay continuous when a turn crosses north', async ({ page }) => {
    const north = { lat: 31.3, lng: 34.75, name: 'NORTH' };
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 31.0, lng: 34.8, name: 'START' },
        { lat: 31.3, lng: 34.75, name: 'NORTH' },
        { lat: 31.6, lng: 34.8, name: 'FINISH' },
      ];
      syncLegs();
      draw();
    });
    const kml = await captureKml(page);
    const cams = parseTourCameraCoords(kml);
    const northIdx = cams.findIndex(c => cameraAtWaypoint(c, north));
    expect(northIdx).toBeGreaterThan(3);
    expect(cams[northIdx - 1].heading).toBeGreaterThan(350);
    expect(cams[northIdx].heading).toBeGreaterThan(360);
    expect(cams[northIdx + 1].heading).toBeGreaterThan(360);
    for (let i = 1; i < cams.length; i++) {
      expect(Math.abs(cams[i].heading - cams[i - 1].heading)).toBeLessThan(20);
    }
  });

  test('airfield endpoints use ground elevation while enroute cameras keep planned altitude', async ({ page }) => {
    const middle = { lat: 32.21861, lng: 34.88250, name: 'BAZRA' };
    await page.evaluate(({ start, end }) => {
      state.waypoints = [
        { lat: start.lat, lng: start.lng, name: start.name },
        { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
        { lat: end.lat, lng: end.lng, name: end.name },
      ];
      syncLegs();
      // Hand-edited altitudes: mark the legs manual so the leg-altitude dataset
      // auto-fill (which runs on draw) doesn't overwrite them. BAZRA is a
      // synthetic point with no charted leg, so an auto leg would reset to NaN.
      state.legs[0].inboundAltitude = 2000;
      markLegAltitudeManual(0);
      state.legs[1].inboundAltitude = 2500;
      markLegAltitudeManual(1);
      draw();
    }, { start: LLHZ, end: LLHA });
    const kml = await captureKml(page);
    const cams = parseTourCameraCoords(kml);
    const waypointCams = waypointTourCameras(cams, [
      LLHZ,
      middle,
      LLHA,
    ]);
    expect(waypointCams).toHaveLength(3);
    expect(waypointCams[0].alt).toBe(airfieldElevationM('LLHZ'));
    expect(waypointCams[1].alt).toBe(Math.round(2500 * 0.3048));
    expect(waypointCams[2].alt).toBe(airfieldElevationM('LLHA'));
  });

  test('below-sea-level airfield endpoint keeps its negative ground elevation', async ({ page }) => {
    await page.evaluate(start => {
      state.waypoints = [
        { lat: start.lat, lng: start.lng, name: start.name },
        { lat: 31.22972, lng: 35.18972, name: 'ARAD' },
      ];
      syncLegs();
      state.legs[0].inboundAltitude = 3000;
      draw();
    }, LLMZ);
    const kml = await captureKml(page);
    const cams = parseTourCameraCoords(kml);
    const startCam = waypointTourCameras(cams, [LLMZ])[0];
    expect(startCam.alt).toBe(airfieldElevationM('LLMZ'));
    expect(startCam.alt).toBeLessThan(0);
  });

  test('KML is well-formed XML and starts with the declaration', async ({ page }) => {
    const kml = await captureKml(page);
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2"');
    expect(kml).toContain('</kml>');
  });

  test('After reverse the KML order also reverses', async ({ page }) => {
    await page.locator('#reverse').click();
    const kml = await captureKml(page);
    const coords = parseLineStringCoords(kml);
    expect(coords[0].lat).toBeCloseTo(ROUTE.waypoints[ROUTE.waypoints.length - 1].lat, 5);
    expect(coords[0].lng).toBeCloseTo(ROUTE.waypoints[ROUTE.waypoints.length - 1].lng, 5);
    expect(coords[coords.length - 1].lat).toBeCloseTo(ROUTE.waypoints[0].lat, 5);
    expect(coords[coords.length - 1].lng).toBeCloseTo(ROUTE.waypoints[0].lng, 5);
  });

  test('Deleting a waypoint shrinks the KML coords sequence', async ({ page }) => {
    await page.evaluate(() => { deleteWaypoint(5); draw(); });   // remove FRDIS
    const kml = await captureKml(page);
    const coords = parseLineStringCoords(kml);
    expect(coords).toHaveLength(10);
    const points = parsePlacemarkPoints(kml);
    expect(points.map(p => p.name)).not.toContain('FRDIS');
  });
});
