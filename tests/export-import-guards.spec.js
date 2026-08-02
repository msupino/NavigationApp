// Exports must not produce files that look valid and import as nothing, and a
// file exported from the Saved routes menu must import from either entry point.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof save === 'function');
}

const withRoute = page => page.evaluate(() => {
  state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
  state.legs = []; syncLegs();
  state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = 3000; });
  draw();
});

test('exporting an empty route says there is nothing to save instead of writing a file', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    state.waypoints = []; state.legs = []; state.notes = []; syncLegs(); draw();
    let alerted = null, downloaded = false;
    const realAlert = window.alert, realCreate = URL.createObjectURL;
    window.alert = m => { alerted = m; };
    URL.createObjectURL = () => { downloaded = true; return 'blob:stub'; };
    try { save(); } finally { window.alert = realAlert; URL.createObjectURL = realCreate; }
    return { alerted, downloaded };
  });
  expect(out.downloaded).toBe(false);
  expect(out.alerted).toBeTruthy();
});

test('a real route still exports', async ({ page }) => {
  await boot(page);
  await withRoute(page);
  const out = await page.evaluate(() => {
    let alerted = null;   // the exported text comes back via the blob promise below
    const realAlert = window.alert, realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    window.alert = m => { alerted = m; };
    URL.createObjectURL = b => { window.__b = b; return 'blob:stub'; };
    HTMLAnchorElement.prototype.click = function () {};
    try { save(); } finally {
      window.alert = realAlert; URL.createObjectURL = realCreate;
      HTMLAnchorElement.prototype.click = realClick;
    }
    return window.__b.text().then(t => ({ alerted, text: t }));
  });
  expect(out.alerted).toBeNull();
  expect(JSON.parse(out.text).waypoints.length).toBe(2);
});

test('exporting an empty library says so instead of writing "[]"', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    localStorage.removeItem('navaid.routes');
    showRouteLibraryModal();
    let alerted = null, downloaded = false;
    const realAlert = window.alert, realCreate = URL.createObjectURL;
    window.alert = m => { alerted = m; };
    URL.createObjectURL = () => { downloaded = true; return 'blob:stub'; };
    try {
      [...document.querySelectorAll('.route-library-tools button')]
        .find(b => /export/i.test(b.textContent)).click();
    } finally { window.alert = realAlert; URL.createObjectURL = realCreate; }
    return { alerted, downloaded };
  });
  expect(out.downloaded).toBe(false);
  expect(out.alerted).toBeTruthy();
});

test('a library file imports through the toolbar Import, not just Import library', async ({ page }) => {
  await boot(page);
  // Build the exact shape "Export library" writes, then feed it to load().
  const out = await page.evaluate(async () => {
    localStorage.removeItem('navaid.routes');
    // Use the app's own serializer so the fixture matches the real schema.
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs(); draw();
    const lib = [{ id: 'r1', name: 'Round trip', savedAt: new Date().toISOString(),
                   data: serializeRoute() }];
    let alerted = null;
    const realAlert = window.alert;
    window.alert = m => { alerted = m; };
    try {
      const file = new File([JSON.stringify(lib)], 'navaid-routes.json', { type: 'application/json' });
      load(file);
      await new Promise(r => setTimeout(r, 300));
    } finally { window.alert = realAlert; }
    return { alerted, stored: JSON.parse(localStorage.getItem('navaid.routes') || '[]') };
  });
  expect(out.alerted).toBeNull();          // no "root.waypoints: missing"
  expect(out.stored.length).toBe(1);
  expect(out.stored[0].name).toBe('Round trip');
});

test('a library round trip keeps GPS tracks', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    localStorage.removeItem('navaid.routes');
    const lib = [{ id: 't1', name: 'Flown 12 Jan', kind: 'gps', savedAt: new Date().toISOString(),
      track: [{ lat: 32.1, lng: 34.9, t: 1 }, { lat: 32.2, lng: 34.95, t: 2 }] }];
    const file = new File([JSON.stringify(lib)], 'navaid-routes.json', { type: 'application/json' });
    load(file);
    await new Promise(r => setTimeout(r, 300));
    const stored = JSON.parse(localStorage.getItem('navaid.routes') || '[]');
    return { n: stored.length, kind: stored[0] && stored[0].kind, pts: stored[0] && stored[0].track.length };
  });
  expect(out.n).toBe(1);
  expect(out.kind).toBe('gps');
  expect(out.pts).toBe(2);
});

test('a JSON array that is not a library is rejected with a clear message', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    let alerted = null;
    const realAlert = window.alert;
    window.alert = m => { alerted = m; };
    try {
      const file = new File([JSON.stringify([1, 2, 3])], 'nope.json', { type: 'application/json' });
      load(file);
      await new Promise(r => setTimeout(r, 300));
    } finally { window.alert = realAlert; }
    return { alerted };
  });
  expect(out.alerted).toBeTruthy();
  expect(out.alerted).not.toMatch(/waypoints/);   // not the single-route validator's complaint
});

test('a single-route file still imports as a route', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs(); draw();
    const data = serializeRoute();
    state.waypoints = []; state.legs = []; syncLegs(); draw();
    let alerted = null;
    const realAlert = window.alert;
    window.alert = m => { alerted = m; };
    try {
      load(new File([JSON.stringify(data)], 'route.json', { type: 'application/json' }));
      await new Promise(r => setTimeout(r, 300));
    } finally { window.alert = realAlert; }
    return { alerted, wps: state.waypoints.length };
  });
  expect(out.alerted).toBeNull();
  expect(out.wps).toBe(2);
});
