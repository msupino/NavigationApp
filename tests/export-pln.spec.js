// Verify the PLN (MSFS / FSX flight plan) export: valid envelope, one
// ATCWaypoint per route waypoint, DMS world positions, and departure /
// destination metadata mirroring the route endpoints.
const { test, expect } = require('./_setup');

const ROUTE = {
  waypoints: [
    { lat: 32.0117, lng: 34.8853, name: 'LLSD' },
    { lat: 32.2000, lng: 34.9000, name: '' },
    { lat: 32.4500, lng: 35.0500, name: 'LLHA' },
  ],
};

async function bootWithRoute(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
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

async function capturePln(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-select').selectOption('pln');
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return { name: download.suggestedFilename(), xml: Buffer.concat(chunks).toString('utf8') };
}

test.describe('PLN export', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('filename is named for the route endpoints and ends in .pln', async ({ page }) => {
    const { name } = await capturePln(page);
    // Endpoints LLSD → LLHA (see routeFileSlug): the download is named for the
    // route, not a bare "route-".
    expect(name).toMatch(/^LLSD-to-LLHA-.+\.pln$/);
  });

  test('valid FSX envelope with one ATCWaypoint per waypoint', async ({ page }) => {
    const { xml } = await capturePln(page);
    expect(xml).toContain('<SimBase.Document Type="AceXML"');
    expect(xml).toContain('<FlightPlan.FlightPlan>');
    expect(xml).toContain('<FPType>VFR</FPType>');
    const wpCount = (xml.match(/<ATCWaypoint /g) || []).length;
    expect(wpCount).toBe(ROUTE.waypoints.length);
    // MSFS 2024 rejects the plan ("Wrong File Version") unless this is 12.
    expect(xml).toContain('<AppVersionMajor>12</AppVersionMajor>');
    // DMS world position with hemisphere + altitude triple.
    expect(xml).toMatch(/<WorldPosition>N\d+° \d+' [\d.]+",E\d+° \d+' [\d.]+",\+\d{6}\.\d{2}<\/WorldPosition>/);
  });

  test('departure and destination mirror the route endpoints', async ({ page }) => {
    const { xml } = await capturePln(page);
    expect(xml).toContain('<DepartureID>LLSD</DepartureID>');
    expect(xml).toContain('<DestinationID>LLHA</DestinationID>');
    expect(xml).toContain('<Title>LLSD to LLHA</Title>');
  });

  test('a single waypoint refuses to export', async ({ page }) => {
    await page.evaluate(() => { state.waypoints = [{ lat: 32, lng: 34, name: 'X' }]; syncLegs(); });
    let fired = false;
    page.once('dialog', d => { fired = true; d.accept(); });
    await page.locator('#export-select').selectOption('pln');
    await page.waitForTimeout(200);
    expect(fired).toBe(true);
  });
});
