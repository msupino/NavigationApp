// @ts-check
// Verify the Google Earth KML download exactly mirrors the route geometry:
// the <LineString>, the per-waypoint <Placemark><Point>s, and the gx:Tour
// camera positions all carry the same lat/lng sequence as state.waypoints.
const { test, expect } = require('./_setup');

const ROUTE = {
  waypoints: [
    { lat: 32.18060, lng: 34.83470, name: 'LLHZ' },
    { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
    { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
    { lat: 32.32306, lng: 34.90389, name: 'SHARO' },
    { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
    { lat: 32.59194, lng: 34.94639, name: 'FRDIS' },
    { lat: 32.71444, lng: 34.97083, name: 'BOREN' },
    { lat: 32.75389, lng: 34.93694, name: 'HOTRM' },
    { lat: 32.79611, lng: 34.94333, name: 'DAROM' },
    { lat: 32.84111, lng: 34.98111, name: 'GALIM' },
    { lat: 32.80972, lng: 35.04389, name: 'LLHA' },
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
  await page.goto('/?lang=en');
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
    return { lat, lng, alt };
  });
}

function parsePlacemarkPoints(kml) {
  const out = [];
  const re = /<Placemark><name>([^<]*)<\/name><Point><coordinates>([^<]+)<\/coordinates><\/Point><\/Placemark>/g;
  let m;
  while ((m = re.exec(kml)) !== null) {
    const [lng, lat] = m[2].split(',').map(Number);
    out.push({ name: m[1], lat, lng });
  }
  return out;
}

function parseTourCameraCoords(kml) {
  const out = [];
  const re = /<gx:FlyTo>[\s\S]*?<longitude>([^<]+)<\/longitude>\s*<latitude>([^<]+)<\/latitude>/g;
  let m;
  while ((m = re.exec(kml)) !== null) {
    out.push({ lat: Number(m[2]), lng: Number(m[1]) });
  }
  return out;
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
      expect(coords[i].alt).toBe(0);            // route line is clamped to ground
    }
  });

  test('Per-waypoint Placemark Points use the same coords and names', async ({ page }) => {
    const kml = await captureKml(page);
    const points = parsePlacemarkPoints(kml);
    expect(points).toHaveLength(ROUTE.waypoints.length);
    for (let i = 0; i < ROUTE.waypoints.length; i++) {
      expect(points[i].lat).toBeCloseTo(ROUTE.waypoints[i].lat, 5);
      expect(points[i].lng).toBeCloseTo(ROUTE.waypoints[i].lng, 5);
      expect(points[i].name).toBe(ROUTE.waypoints[i].name);
    }
  });

  test('gx:Tour cameras visit every waypoint in order', async ({ page }) => {
    const kml = await captureKml(page);
    const cams = parseTourCameraCoords(kml);
    expect(cams).toHaveLength(ROUTE.waypoints.length);
    for (let i = 0; i < ROUTE.waypoints.length; i++) {
      expect(cams[i].lat).toBeCloseTo(ROUTE.waypoints[i].lat, 5);
      expect(cams[i].lng).toBeCloseTo(ROUTE.waypoints[i].lng, 5);
    }
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
