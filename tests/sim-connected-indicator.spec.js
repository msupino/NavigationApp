// @ts-check
// Reported: nothing in the menu bar says the simulator is connected — you had to open the
// panel to find out. The two GPS buttons beside it already carry their state; the plane
// icon now carries its own, the same way, so one glance reads all three sources alike.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof simStart === 'function' &&
    !!document.getElementById('sim-trigger'));
  // The poll must not reach a real bridge; answer it here.
  await page.route(/^http:\/\/localhost:2020\//, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ latitude: 32.1, longitude: 34.9, altitude: 1500, heading: 90, ias: 95 }),
  }));
}

const iconState = (page) => page.evaluate(() => {
  const b = document.getElementById('sim-trigger');
  return {
    pressed: b.getAttribute('aria-pressed'),
    label: b.getAttribute('aria-label') || '',
    latched: b.classList.contains('gps-footer-btn'),
  };
});

test('the plane icon is unlatched until the simulator connects', async ({ page }) => {
  await boot(page);
  const off = await iconState(page);
  expect(off.pressed).toBe('false');
  expect(off.label).not.toMatch(/connected/i);
});

test('connecting latches it, disconnecting releases it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => simStart());
  const on = await iconState(page);
  expect(on.pressed).toBe('true');
  expect(on.latched).toBe(true);                 // same treatment as the GPS buttons
  expect(on.label).toMatch(/connected/i);
  await page.evaluate(() => simStop());
  const off = await iconState(page);
  expect(off.pressed).toBe('false');
  expect(off.label).not.toMatch(/connected/i);
});

test('a session resumed on boot shows as connected without opening the panel', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.simOn', '1'); } catch (e) { /* */ }
  });
  await boot(page);
  await page.waitForFunction(() => document.getElementById('sim-trigger').getAttribute('aria-pressed') === 'true');
  expect((await iconState(page)).pressed).toBe('true');
  expect(await page.evaluate(() => document.getElementById('sim-modal').classList.contains('hidden'))).toBe(true);
});

// Asked: "pressing on sim button when active, should disable, not open the connect window".
// Connected, the plane button is a switch like Location and Record: a press disconnects (the
// panel's own state with it) and says so; disconnected, it opens the panel.
test('pressing the plane button while connected disconnects instead of opening the panel', async ({ page }) => {
  await boot(page);
  // Connect the way a pilot does: open the panel, press Connect, close it.
  await page.locator('#sim-trigger').click();
  await expect(page.locator('#sim-modal')).not.toHaveClass(/hidden/);
  await page.locator('#sim-connect-cb').click();
  await page.locator('#sim-modal-close').click();
  expect((await iconState(page)).pressed).toBe('true');
  expect((await iconState(page)).label).toMatch(/tap to disconnect/);

  await page.locator('#sim-trigger').click();
  expect((await iconState(page)).pressed).toBe('false');
  await expect(page.locator('#sim-modal')).toHaveClass(/hidden/);           // not opened
  expect(await page.evaluate(() => [window.simOn, localStorage.getItem('navaid.simOn')])).toEqual([false, '0']);
  // The panel's own button follows: it offers to connect again.
  expect(await page.locator('#sim-connect-cb').textContent()).toMatch(/Connect to simulator/);

  // Disconnected, the same press opens the panel.
  await page.locator('#sim-trigger').click();
  await expect(page.locator('#sim-modal')).not.toHaveClass(/hidden/);
});

// Reported: "record when sim connected should record sim movement, not gps". With a simulator
// connected and Location off, Record records the simulator's flight -- the device GPS is not
// started -- and the recording ends (saved) when the simulator disconnects.
test('Record with the simulator connected records the simulator, not the GPS', async ({ page }) => {
  await page.addInitScript(() => {
    window.__watches = 0;
    navigator.geolocation.watchPosition = () => ++window.__watches;
    navigator.geolocation.clearWatch = () => {};
  });
  await boot(page);
  // A moving simulated aircraft: each poll a little further north.
  let n = 0;
  await page.unroute(/^http:\/\/localhost:2020\//);
  await page.route(/^http:\/\/localhost:2020\//, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ latitude: 32.1 + 0.01 * (n++), longitude: 34.9, altitude: 1500, heading: 0, ias: 95 }),
  }));
  await page.evaluate(() => simStart());
  await page.locator('#gps-record').click();
  expect(await page.evaluate(() => [gpsRecording, gpsLiveOn, gpsSimRecording(), window.__watches])).toEqual([true, false, true, 0]);
  await expect.poll(() => page.evaluate(() => gpsTrack.length), { timeout: 8000 }).toBeGreaterThan(2);
  const pts = await page.evaluate(() => gpsTrack.map(p => p.lat));
  expect(pts[pts.length - 1]).toBeGreaterThan(pts[0]);                   // it is the simulator's movement
  // Disconnecting the simulator ends the recording, and keeps it.
  const before = await page.evaluate(() => loadRouteLibrary().filter(e => e.kind === 'gps').length);
  await page.evaluate(() => simStop());
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
  expect(await page.evaluate(() => loadRouteLibrary().filter(e => e.kind === 'gps').length)).toBe(before + 1);
});

// Asked: "if sim is connected after record, which activated location, should deactivate location
// and record from sim". The same recording carries on from the simulator; a Location the pilot
// turned on themselves is left alone (the real GPS keeps precedence).
test('connecting the simulator during a Record that turned Location on hands the recording over', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geo = [];
    navigator.geolocation.watchPosition = (cb) => { window.__geo.push(cb); return window.__geo.length; };
    navigator.geolocation.clearWatch = () => {};
  });
  await boot(page);
  await page.locator('#gps-record').click();                     // Record turns Location on
  await page.evaluate(() => window.__geo[0]({ coords: { latitude: 32.0, longitude: 34.8, accuracy: 5 }, timestamp: Date.now() }));
  expect(await page.evaluate(() => [gpsLiveOn, gpsTrack.length])).toEqual([true, 1]);
  await page.evaluate(() => simStart());
  expect(await page.evaluate(() => [gpsRecording, gpsLiveOn, gpsSimRecording(),
    document.getElementById('gps-live').getAttribute('aria-pressed')])).toEqual([true, false, true, 'false']);
  // The same recording: the GPS point stays, the simulator's are added after it.
  await expect.poll(() => page.evaluate(() => gpsTrack.length), { timeout: 8000 }).toBeGreaterThan(1);
  expect(await page.evaluate(() => gpsTrack[0].lat)).toBe(32.0);
});

test('a Location the pilot turned on stays on when the simulator connects', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = () => 1;
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.setItem('navaid.autoRecord', '0'); } catch (e) { /* */ }
  });
  await boot(page);
  await page.locator('#gps-live').click();
  await page.locator('#gps-record').click();
  await page.evaluate(() => simStart());
  expect(await page.evaluate(() => [gpsRecording, gpsLiveOn, gpsSimRecording()])).toEqual([true, true, false]);
});
