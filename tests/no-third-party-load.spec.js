// @ts-check
// The suite boots the app thousands of times per CI run, twice per push (locally and against
// the deployed preview). A host it reaches unstubbed gets hundreds of thousands of requests from
// GitHub runners -- it happened to flight-maps.com, and to OpenFlightMaps once it became the
// default base map (#2592). An audit then found Esri satellite tiles and our own GitHub data
// branches doing the same. This boots the app the ways most tests do and fails on any request
// that leaves the machine for a host outside the allowlist: same-origin, and the CDNs serving
// the app's pinned libraries. A new map layer, API or feed must be stubbed in tests/_setup.js.
const { test, expect, externalHits, ALLOWED_EXTERNAL } = require('./_setup');

const offenders = () => [...new Set(externalHits
  .filter(h => !ALLOWED_EXTERNAL.some(a => h === a || h.startsWith(a + '/') || h.split('/')[0].endsWith('.' + a)))
  .map(h => h.split('/')[0]))];

for (const [name, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
  test(`booting and opening panels reaches no third-party host (${name})`, async ({ page }) => {
    externalHits.length = 0;
    await page.setViewportSize(size);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof showInspector === 'function' && !!window.airfields);
    // The panels that pull imagery and weather: an airfield (satellite view, METAR/TAF,
    // density altitude, hours) and a bare point (satellite view, nearest field).
    await page.evaluate(() => {
      const i = airfields.findIndex(a => a.name === 'LLHZ');
      state.selected = { type: 'airfield', index: i };
      showInspector();
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { state.selected = { type: 'coord', lat: 32.2, lng: 34.9 }; showInspector(); });
    await page.waitForTimeout(1500);
    expect(offenders(), 'stub these hosts in tests/_setup.js').toEqual([]);
  });
}
