// @ts-check
// The phone's hardware (device-extras.js, gdl90.js, ble-gps.js), each behind a gist switch:
// keep-awake, haptics, brightness, barometer on by default; battery warning, full screen in
// flight, the ADS-B receiver and the Bluetooth GPS off. The native plugins are stand-ins that
// record what they were asked to do.
const { test, expect } = require('./_setup');

async function boot(page, opts = {}) {
  await page.addInitScript((o) => {
    window.__calls = [];
    const rec = (name) => new Proxy({}, { get: (t, fn) => (fn === 'then' ? undefined : async (arg) => {
      window.__calls.push(name + '.' + String(fn) + (arg !== undefined ? ' ' + JSON.stringify(arg) : ''));
      if (fn === 'addListener') { (window.__cbs = window.__cbs || {})[name + ':' + arg] = arguments[1]; return { remove() {} }; }
      if (fn === 'isAvailable') return { available: true };
      if (fn === 'getBatteryInfo') return { batteryLevel: o.battery == null ? 0.9 : o.battery, isCharging: false };
      return undefined;
    }) });
    // addListener needs its second argument: a Proxy method sees only the first, so wrap it.
    const plug = (name) => { const p = rec(name); return new Proxy(p, { get: (t, fn) => (fn === 'addListener'
      ? async (ev, cb) => { window.__calls.push(name + '.addListener ' + ev); (window.__cbs = window.__cbs || {})[name + ':' + ev] = cb; return { remove() {} }; }
      : p[fn]) }); };
    window.Capacitor = { isNativePlatform: () => !!o.native, Plugins: {
      KeepAwake: plug('KeepAwake'), Haptics: plug('Haptics'), ScreenBrightness: plug('ScreenBrightness'),
      Barometer: plug('Barometer'), Device: plug('Device'), StatusBar: plug('StatusBar'), Gdl90: plug('Gdl90'),
      BluetoothLe: plug('BluetoothLe'),
    } };
    if (o.tune) window.__navaidTune = Object.assign(window.__navaidTune || {}, o.tune);
  }, opts);
  await page.goto('?lang=' + (opts.lang || 'en') + '&nogist');
  await page.waitForFunction(() => NavAid.device && NavAid.gdl90 && NavAid.bleGps && typeof onLivePosition === 'function');
}
const calls = (page) => page.evaluate(() => window.__calls);
const live = (page, v = true) => page.evaluate((v) => { new Function('gpsLiveOn = ' + v + '; gpsFollow = false')(); NavAid.device.tick(); }, v);

test('keep-awake and full screen follow the position (full screen only when switched on)', async ({ page }) => {
  await boot(page, { native: true, tune: { featureFullscreenFlight: true } });
  await live(page);
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining(['KeepAwake.keepAwake', 'StatusBar.hide']));
  await live(page, false);
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining(['KeepAwake.allowSleep', 'StatusBar.show']));
});

test('an in-flight alert vibrates; switched off it does not', async ({ page }) => {
  await boot(page, { native: true });
  await page.evaluate(() => gpsSendWatchAlert('Next leg', 'BAZRA 095°'));
  expect(await calls(page)).toContain('Haptics.notification {"type":"WARNING"}');
  await page.evaluate(() => { setTune('featureHaptics', false); window.__calls = []; gpsSendWatchAlert('x', 'y'); });
  expect((await calls(page)).filter(c => c.startsWith('Haptics'))).toEqual([]);
});

test('brightness: a browser dims with a veil, the app sets the screen; System gives it back; kept on reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => NavAid.device.setBrightness(40));
  expect(await page.evaluate(() => Number(document.getElementById('dim-veil').style.opacity))).toBeCloseTo(0.48, 2);
  await page.reload();
  await page.waitForFunction(() => NavAid.device);
  expect(await page.evaluate(() => !!document.getElementById('dim-veil'))).toBe(true);
  await page.evaluate(() => NavAid.device.setBrightness(null));
  expect(await page.evaluate(() => document.getElementById('dim-veil'))).toBeNull();
  // Native: the screen itself.
  await page.evaluate(() => { window.Capacitor.isNativePlatform = () => true; NavAid.device.setBrightness(60); });
  expect(await calls(page)).toContain('ScreenBrightness.setBrightness {"brightness":0.6}');
  await page.evaluate(() => NavAid.device.setBrightness(null));
  expect(await calls(page)).toContain('ScreenBrightness.setBrightness {"brightness":-1}');
});

test('barometer: pressure altitude and vertical speed, in the GPS details', async ({ page }) => {
  await boot(page, { native: true });
  await live(page);
  await expect.poll(() => calls(page)).toContain('Barometer.start');
  // 1013.25 hPa is 0 ft; a steady climb of ~600 fpm over ten seconds.
  const r = await page.evaluate(() => {
    const t0 = Date.now() - 10000;
    for (let i = 0; i <= 10; i++) {
      const ft = i * 10;                                   // 10 ft a second = 600 fpm
      const hPa = 1013.25 * Math.pow(1 - ft / 145366.45, 1 / 0.190284);
      window.__cbs['Barometer:pressure']({ hPa, t: t0 + i * 1000 });
    }
    return { alt: Math.round(NavAid.device.baro.pAltFt), vs: Math.round(NavAid.device.baro.vsFpm) };
  });
  expect(r.alt).toBe(100);
  expect(Math.abs(r.vs - 600)).toBeLessThan(5);
  await page.evaluate(() => NavAid.gpsStatus.tick());
  await page.locator('#gps-status').click();
  await expect(page.locator('.gps-status-modal')).toContainText('+600 fpm');
  await expect(page.locator('.gps-status-modal')).toContainText('Pressure altitude');
});

test('battery warning (when switched on): once at 20 %, in flight, not charging', async ({ page }) => {
  await boot(page, { native: true, battery: 0.18, tune: { featureBatteryWarn: true } });
  await live(page);
  await page.evaluate(() => NavAid.device.checkBattery());
  await expect(page.locator('#toast-stack .toast').filter({ hasText: 'Battery 18%' }).first()).toBeAttached();
});

// A GDL90 frame as a receiver sends it: id, payload, CRC (LSB first), 0x7E at both ends, 0x7D escapes.
function gdl90Traffic({ hex, lat, lon, altFt, kt, trackDeg, call }) {
  const m = new Array(28).fill(0);
  m[0] = 0x14;
  const a = parseInt(hex, 16); m[2] = a >> 16 & 255; m[3] = a >> 8 & 255; m[4] = a & 255;
  const s24 = (v) => { const x = Math.round(v * 0x800000 / 180) & 0xffffff; return [x >> 16 & 255, x >> 8 & 255, x & 255]; };
  [m[5], m[6], m[7]] = s24(lat); [m[8], m[9], m[10]] = s24(lon);
  const alt = Math.round((altFt + 1000) / 25); m[11] = alt >> 4 & 255; m[12] = ((alt & 15) << 4) | 0x01;   // track valid
  m[14] = kt >> 4 & 255; m[15] = (kt & 15) << 4;
  m[17] = Math.round(trackDeg * 256 / 360) & 255;
  for (let i = 0; i < 8; i++) m[19 + i] = (call.padEnd(8).charCodeAt(i));
  return m;
}
test('GDL90 (when switched on): a traffic report from a cockpit receiver goes on the map; stale ones go', async ({ page }) => {
  await boot(page, { native: true, tune: { featureGdl90: true } });
  await page.evaluate(() => NavAid.gdl90.sync());
  await expect.poll(() => calls(page)).toContain('Gdl90.start {"port":4000}');
  const msg = gdl90Traffic({ hex: '738065', lat: 32.2, lon: 34.95, altFt: 3500, kt: 120, trackDeg: 90, call: '4XABC' });
  const r = await page.evaluate((msg) => {
    const crc = NavAid.gdl90.crc16(msg);
    const body = [...msg, crc & 255, crc >> 8];
    const esc = []; for (const b of body) { if (b === 0x7e || b === 0x7d) esc.push(0x7d, b ^ 0x20); else esc.push(b); }
    const bytes = Uint8Array.from([0x7e, ...esc, 0x7e]);
    window.__cbs['Gdl90:packet']({ data: btoa(String.fromCharCode(...bytes)) });
    const a = window.trafficAircraft.find(x => x.hex === '738065');
    return a && { flight: a.flight, lat: +a.lat.toFixed(3), lon: +a.lon.toFixed(3), alt: a.alt, gs: a.gs, track: Math.round(a.track) };
  }, msg);
  expect(r).toEqual({ flight: '4XABC', lat: 32.2, lon: 34.95, alt: 3500, gs: 120, track: 90 });
  // A corrupted frame (bad CRC) is ignored.
  expect(await page.evaluate(() => NavAid.gdl90.frames(Uint8Array.from([0x7e, 0x14, 1, 2, 3, 0x00, 0x00, 0x7e])).length)).toBe(0);
  // Not heard for 20 s: dropped.
  await page.evaluate(() => { for (const t of NavAid.gdl90.targets.values()) t._seen -= 21000; NavAid.gdl90.feed(new Uint8Array(0)); });
  expect(await page.evaluate(() => window.trafficAircraft.some(x => x.hex === '738065'))).toBe(false);
});

test('Bluetooth GPS (when switched on): NMEA fixes drive the position, and the phone\'s step aside', async ({ page }) => {
  await boot(page, { tune: { featureBleGps: true } });
  // Outside the app the button is there, dimmed, saying why.
  await expect(page.locator('#ble-gps-btn')).toHaveAttribute('aria-disabled', 'true');
  const r = await page.evaluate(() => {
    new Function('gpsLiveOn = true; gpsFollow = false')();
    NavAid.bleGps.dev.id = 'AA:BB';                         // as if connected
    const nmea = (body) => { let x = 0; for (const ch of body) x ^= ch.charCodeAt(0); return '$' + body + '*' + x.toString(16).toUpperCase().padStart(2, '0') + '\r\n'; };
    NavAid.bleGps.feedText(nmea('GPGGA,120000.00,3212.000,N,03457.000,E,1,11,0.8,450.0,M,18.0,M,,')
      + nmea('GPRMC,120000.00,A,3212.000,N,03457.000,E,95.0,180.0,061026,,,A'));
    // A sentence with a wrong checksum is dropped.
    const before = NavAid.bleGps.dev.lastFixAt;
    NavAid.bleGps.feedText('$GPRMC,120001.00,A,3000.000,N,03400.000,E,95.0,180.0,061026,,,A*00\r\n');
    if (NavAid.bleGps.dev.lastFixAt !== before) throw new Error('bad checksum accepted');
    const viaBle = { lat: gpsOwn && gpsOwn.lat, lng: gpsOwn && gpsOwn.lng, line: NavAid.gpsStatus.text() };
    // The phone's own fix right after: set aside while the Bluetooth GPS is fresh.
    onLivePosition({ timestamp: Date.now(), coords: { latitude: 31.0, longitude: 35.0, accuracy: 5, speed: 10, heading: 0 } });
    return { viaBle, after: gpsOwn.lat, sats: NavAid.bleGps.dev.sats };
  });
  expect(r.viaBle.lat).toBeCloseTo(32.2, 3);
  expect(r.viaBle.lng).toBeCloseTo(34.95, 3);
  expect(r.viaBle.line).toMatch(/^BT · ±4 m/);
  expect(r.after).toBeCloseTo(32.2, 3);
  expect(r.sats).toBe(11);
});

test('the four default-on extras are on, the other four off, without a gist', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => ['featureKeepAwake', 'featureHaptics', 'featureBrightness', 'featureBarometer',
    'featureBatteryWarn', 'featureFullscreenFlight', 'featureGdl90', 'featureBleGps'].map(k => tune(k)));
  expect(r).toEqual([true, true, true, true, false, false, false, false]);
  await expect(page.locator('#brightness-row')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#ble-gps-btn')).toBeHidden();
});

// The alert is read on screen too: a bubble at the bottom with its text, while the app is in view.
test('an in-flight alert shows its text in a bubble as well', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => gpsSendWatchAlert('Next leg', 'BAZRA 095° 2500 ft'));
  await expect(page.locator('#toast-stack .toast').filter({ hasText: 'Next leg: BAZRA 095° 2500 ft' }).first()).toBeAttached();
});
