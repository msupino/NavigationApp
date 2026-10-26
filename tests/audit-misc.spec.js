// @ts-check
// Review findings in the flight planning form (navlog.js), Google Drive sign-in (gdrive.js)
// and the route check's cloud sampling (routecheck.js). One test per finding.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog && NavAid.routeCheck)
    && typeof draw === 'function' && typeof routeLibrarySaveCurrent === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.98, lng: 35.57, name: 'B' }];
    syncLegs();
    draw();
  });
}

// A closed or blocked Google consent popup never calls the token callback -- only the
// error_callback. Without one, Sync sat at "Syncing…" forever.
test('gdrive: a closed consent popup rejects the sync instead of hanging', async ({ page }) => {
  await boot(page);
  const res = await page.evaluate(async () => {
    window.google = { accounts: { oauth2: {
      initTokenClient(cfg) {
        const client = {
          callback: cfg.callback,
          requestAccessToken() {
            setTimeout(() => cfg.error_callback && cfg.error_callback({ type: 'popup_closed' }), 0);
          },
        };
        return client;
      },
      revoke() {},
    } } };
    const timeout = new Promise(r => setTimeout(() => r('hung'), 3000));
    return Promise.race([gdriveSync().then(() => 'ok', e => 'rejected: ' + (e && e.message)), timeout]);
  });
  expect(res).toMatch(/^rejected/);
});

// restore() wrote cfg['paFraction.climb'] -- a flat key nobody reads -- so emptying or resetting
// the "Climb met at (%)" box left the old fraction in the open form.
test('navlog: emptying the climb met fraction puts the default back in the open form', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => NavAid.navLog.show());
  await page.waitForSelector('.navlog-table');
  const box = page.locator('.navlog-field', { hasText: 'Climb met at (%)' }).locator('input');
  await box.fill('40');
  expect(await page.evaluate(() => NavAid.navLog.config().paFraction.climb)).toBeCloseTo(0.4);
  await box.fill('');
  // Something else in the form saves next; the climb fraction it carries must be the default.
  await page.locator('.navlog-field', { hasText: 'Climb CAS' }).locator('input').fill('66');
  await page.locator('.navlog-field', { hasText: 'Descent met at (%)' }).locator('input').fill('45');
  await page.locator('.navlog-field', { hasText: 'Descent met at (%)' }).locator('input').blur();
  await expect(box).toHaveValue('67');
  // The climb row is read at the standard two thirds: the open form's own export says so.
  const frac = await page.evaluate(() => {
    let got = null;
    const orig = window.saveFile;
    window.saveFile = (blob) => { got = blob; };
    document.querySelector('.navlog-export').click();
    window.saveFile = orig;
    return got ? got.text().then(t => JSON.parse(t)) : null;
  });
  const pf = frac && (frac.navlog || frac).paFraction;
  expect(pf.climb).toBeCloseTo(2 / 3);
});

// Opening a saved route that carries its own sheet while the form is open re-read only three
// values; the next met edit then saved the OLD route's met table over the loaded one.
test('navlog: loading a saved route with its own sheet refreshes the open form', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    localStorage.setItem('navaid.navlog', JSON.stringify({
      met: [{ alt: 2000, dir: 100, kt: 10, tempC: 10 }], cas: { cruise: 95 } }));
    NavAid.navLog.show();
  });
  await page.waitForSelector('.navlog-table');
  await page.evaluate(async () => {
    window.askYesNo = async () => true;
    await routeLibraryApply({ id: 'x1', name: 'Other', data: JSON.parse(JSON.stringify(routeSnapshotForStorage())),
      navlog: { met: [{ alt: 4000, dir: 300, kt: 30, tempC: 5 }], cas: { cruise: 115 } } });
  });
  // The open form shows the loaded route's values...
  await expect(page.locator('.navlog-field', { hasText: 'Cruise CAS' }).locator('input')).toHaveValue('115');
  await expect(page.locator('.navlog-met .navlog-grid tr').nth(1).locator('input').first()).toHaveValue('4000');
  // ...and an edit there writes on top of them, not on top of the old table.
  await page.locator('.navlog-met .navlog-grid tr').nth(1).locator('input').nth(2).fill('31');
  const met = await page.evaluate(() => NavAid.navLog.config().met);
  expect(met).toEqual([{ alt: 4000, dir: 300, kt: 31, tempC: 5 }]);
});

// An exercise replaced the waypoints but kept the old route's legs, notes, comm suppressions
// and library id -- so the next Save overwrote whichever saved route was loaded before.
test('navlog: importing an exercise starts a fresh route, not the old one renamed', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    window.askYesNo = async () => true;
    state.legs[0].inboundAltitude = 4500;
    state.legs[0].flightSpeed = 140;
    state.notes = [{ lat: 32.5, lng: 35.1, text: 'old note' }];
    state.commChangeSuppressions = ['x'];
    new Function("currentRouteLibraryId = 'old-entry';")();
    await NavAid.navLog.importExercise(JSON.stringify({
      route: { waypoints: [{ lat: 31.0, lng: 34.5, name: 'P' }, { lat: 31.5, lng: 34.9, name: 'Q' }] },
      navlog: { cruiseAltFt: 3000 },
    }));
    return { lib: currentRouteLibraryId, notes: state.notes.length, sup: state.commChangeSuppressions.length,
      alt: state.legs[0].inboundAltitude, speed: state.legs[0].flightSpeed, n: state.waypoints.length };
  });
  expect(got.n).toBe(2);
  expect(got.lib).toBeNull();
  expect(got.notes).toBe(0);
  expect(got.sup).toBe(0);
  expect(got.alt).not.toBe(4500);
  expect(got.speed).not.toBe(140);
});

// The default cruise CAS was read from l.speed, a field legs do not have: a 110 kt route opened
// the form at the 90 kt default.
test('navlog: the default cruise CAS is the route\'s own leg speed', async ({ page }) => {
  await boot(page);
  const cas = await page.evaluate(() => {
    state.legs.forEach(l => { l.flightSpeed = 110; });
    return NavAid.navLog.defaults().cas.cruise;
  });
  expect(cas).toBe(110);
});

// More than 25 sample points kept every k-th from the start and dropped the tail -- the
// destination included -- from the cloud check.
test('routecheck: a long route still asks for cloud at its destination', async ({ page }) => {
  await boot(page);
  const urls = [];
  await page.route('https://api.open-meteo.com/**', route => {
    urls.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  const pts = await page.evaluate(async () => {
    state.waypoints = [{ lat: 29.0, lng: 33.0, name: 'S' }, { lat: 33.7, lng: 36.0, name: 'N' }];   // 34 samples: every 2nd from the start misses the last
    syncLegs();
    const wps = state.waypoints;
    const p = routeCheckSamplePoints(wps, 10);
    await NavAid.routeCheck.gather();
    return { n: p.length, last: p[p.length - 1].lat.toFixed(3) };
  });
  expect(pts.n).toBeGreaterThan(25);
  const cloud = urls.find(u => /cloud_cover_low/.test(u));
  expect(cloud).toBeTruthy();
  const lats = new URL(String(cloud)).searchParams.get('latitude').split(',');
  expect(lats.length).toBeLessThanOrEqual(25);
  expect(lats[lats.length - 1]).toBe(pts.last);
});
