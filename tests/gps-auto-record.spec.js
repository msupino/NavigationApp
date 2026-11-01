const { test, expect } = require('./_setup');

// Showing location records the flight too (navaid.autoRecord, gist defaultAutoRecord). When
// location stops, a recording too short to be a flight is dropped; a long one is saved. A
// recording a reload cut short resumes.

async function boot(page, init) {
  await page.addInitScript((pre) => {
    window.__geo = [];
    let id = 0;
    navigator.geolocation.watchPosition = (cb) => { window.__geo.push(cb); return ++id; };
    navigator.geolocation.clearWatch = () => {};
    for (const [k, v] of Object.entries(pre || {})) {
      try { localStorage.setItem(k, v); } catch (e) { /* */ }
    }
  }, init || {});
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function'
    && typeof window.autoRecordOn === 'function' && typeof loadRouteLibrary === 'function');
}

// Feed one fix to every watch (live + recording). t in ms.
const fix = (page, lat, lng, t) => page.evaluate(([la, ln, tt]) => {
  for (const cb of window.__geo) cb({ coords: { latitude: la, longitude: ln, accuracy: 5, altitude: 300, speed: 50 }, timestamp: tt });
}, [lat, lng, t]);

const gpsCount = (page) => page.evaluate(() => loadRouteLibrary().filter(e => e.kind === 'gps').length);

test('showing location starts a recording; stopping drops a short one', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  expect(await page.evaluate(() => gpsRecording && gpsAutoRec)).toBe(true);
  const t0 = Date.now();
  await fix(page, 32.0, 34.9, t0);
  await fix(page, 32.001, 34.9, t0 + 60000);       // 1 min, ~0.06 nm
  const before = await gpsCount(page);
  await page.evaluate(() => stopLiveLocation());
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
  expect(await gpsCount(page)).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem('navaid.gpsRecInProgress'))).toBeNull();
});

test('stopping location saves a recording long enough to be a flight', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { startLiveLocation(); gpsStartT = Date.now() - 10 * 60000; });
  const t0 = Date.now() - 10 * 60000;
  await fix(page, 32.0, 34.9, t0);
  await fix(page, 32.05, 34.9, t0 + 5 * 60000);
  await fix(page, 32.1, 34.9, t0 + 10 * 60000);    // 10 min, ~6 nm
  const before = await gpsCount(page);
  await page.evaluate(() => stopLiveLocation());
  expect(await gpsCount(page)).toBe(before + 1);
});

test('the checkbox turns it off, and stays off', async ({ page }) => {
  await boot(page);
  const cb = page.locator('#auto-record-cb');
  expect(await cb.isChecked()).toBe(true);
  await page.evaluate(() => { const c = document.getElementById('auto-record-cb'); c.checked = false; c.dispatchEvent(new Event('change')); });
  expect(await page.evaluate(() => localStorage.getItem('navaid.autoRecord'))).toBe('0');
  await page.evaluate(() => startLiveLocation());
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
});

test('a manual recording is never dropped for being short', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startGpsRecording());
  const t0 = Date.now();
  await fix(page, 32.0, 34.9, t0);
  await fix(page, 32.001, 34.9, t0 + 30000);
  const before = await gpsCount(page);
  await page.evaluate(() => stopGpsRecordingAndSave());
  expect(await gpsCount(page)).toBe(before + 1);
});

test('a recording a reload interrupted resumes with its points', async ({ page }) => {
  const now = Date.now();
  const track = [{ lat: 32.0, lng: 34.9, t: now - 120000 }, { lat: 32.02, lng: 34.9, t: now - 60000 }];
  await boot(page, {
    'navaid.gpsRecInProgress': JSON.stringify({ startT: now - 120000, auto: true, savedAt: now - 60000, track }),
  });
  const r = await page.evaluate(() => ({ on: gpsRecording, auto: gpsAutoRec, n: gpsTrack.length, start: gpsStartT }));
  expect(r).toEqual({ on: true, auto: true, n: 2, start: now - 120000 });
});

test('a recording left too long before the reload is saved, not resumed', async ({ page }) => {
  const old = Date.now() - 3 * 3600000;
  const track = [{ lat: 32.0, lng: 34.9, t: old }, { lat: 32.1, lng: 34.9, t: old + 15 * 60000 }];
  await boot(page, {
    'navaid.gpsRecInProgress': JSON.stringify({ startT: old, auto: true, savedAt: old + 15 * 60000, track }),
  });
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
  expect(await gpsCount(page)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => localStorage.getItem('navaid.gpsRecInProgress'))).toBeNull();
});

test('the gist can withdraw the option', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('featureAutoRecord', false); window.refreshAutoRecordControl(); startLiveLocation(); });
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
  expect(await page.locator('#auto-record-cb').evaluate(el => el.closest('label').hidden)).toBe(true);
});
