// PLN (MSFS / FSX) import: parses ATCWaypoint WorldPosition DMS into route
// waypoints, and round-trips with the PLN export.
const { test, expect } = require('./_setup');

const ROUTE = [
  { lat: 32.0117, lng: 34.8853, name: 'LLSD' },
  { lat: 32.2000, lng: 34.9000, name: '' },
  { lat: 32.4500, lng: 35.0500, name: 'LLHA' },
];

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof loadPln === 'function' &&
    typeof exportPln === 'function');
}

// Generate a PLN file in-page (intercepting the export Blob) without download.
async function plnText(page) {
  return page.evaluate(route => {
    state.waypoints = route.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    const RealBlob = Blob; let txt = '';
    window.Blob = function (parts, opts) { txt = parts.join(''); return new RealBlob(parts, opts); };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    exportPln();
    window.Blob = RealBlob;
    HTMLAnchorElement.prototype.click = realClick;
    return txt;
  }, ROUTE);
}

test.describe('PLN import', () => {
  test('round-trips an exported PLN back into the route', async ({ page }) => {
    await boot(page);
    const xml = await plnText(page);
    expect(xml).toContain('<ATCWaypoint ');

    // Wipe the route, then import the PLN via the hidden file input.
    await page.evaluate(() => { state.waypoints = []; state.legs = []; syncLegs(); draw(); });
    await page.setInputFiles('#file', {
      name: 'route.pln', mimeType: 'application/xml', buffer: Buffer.from(xml, 'utf8'),
    });
    await page.waitForFunction(() => state.waypoints.length === 3);

    const got = await page.evaluate(() =>
      state.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name })));
    for (let i = 0; i < ROUTE.length; i++) {
      // DMS export keeps ~2-decimal arc-second precision → ~0.0003° tolerance.
      expect(Math.abs(got[i].lat - ROUTE[i].lat)).toBeLessThan(0.001);
      expect(Math.abs(got[i].lng - ROUTE[i].lng)).toBeLessThan(0.001);
    }
    expect(got[0].name).toBe('LLSD');
    expect(got[2].name).toBe('LLHA');
  });

  test('rejects a PLN with no waypoints', async ({ page }) => {
    await boot(page);
    const empty = '<?xml version="1.0"?><SimBase.Document><FlightPlan.FlightPlan>' +
      '</FlightPlan.FlightPlan></SimBase.Document>';
    let fired = false;
    page.once('dialog', d => { fired = true; d.accept(); });
    await page.setInputFiles('#file', {
      name: 'empty.pln', mimeType: 'application/xml', buffer: Buffer.from(empty, 'utf8'),
    });
    await page.waitForTimeout(300);
    expect(fired).toBe(true);
  });
});
