// @ts-check
// Regressions from the GPS / Follow me / traffic / OTA / offline-tiles / service-worker audit.
// Each test names the problem it pins in plain words.
const { test, expect } = require('./_setup');

// --- gps.js -------------------------------------------------------------------------------

async function bootGps(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function' &&
    typeof syncLegs === 'function' && typeof onLivePosition === 'function');
}

// Inside the capture circle of the waypoint just passed, the cone kept putting the aircraft
// back on the completed leg, which re-armed that leg's altitude call -- and an aircraft 400 ft
// off plan was told so on every fix inside the 0.3 NM circle.
test('an altitude deviation is not called on every fix inside a waypoint circle', async ({ page }) => {
  await bootGps(page);
  const calls = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
      { lat: 32.20, lng: 34.0, name: 'BRAVO' },
      { lat: 32.40, lng: 34.0, name: 'CHARLIE' },
    ];
    syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = 2000; });
    gpsResetLegAlerts();
    _gpsAlertConfirmed = true;
    window.__alerts = [];
    window.gpsSendWatchAlert = (title) => { window.__alerts.push(title); };
    const at = (lat) => {
      gpsLastAlt = 2400;                 // 400 ft off plan the whole way
      gpsAltIsGeometric = false;
      gpsOwn = { lat, lng: 34.0, hdg: 0, t: Date.now() };
      gpsCheckLegAlerts();
    };
    at(32.10);                           // mid leg: the one call this leg owes
    // Creeping up on BRAVO inside its capture circle, still short of it.
    for (const lat of [32.196, 32.1965, 32.197, 32.1975, 32.198, 32.1985, 32.199]) at(lat);
    return window.__alerts.filter(t => t === 'Altitude').length;
  });
  expect(calls).toBe(1);
});

// While a recording ran, the live handler returned before it updated the last-fix point, so
// gpsLastFix() stayed where the recording started -- and traffic asked around (and dropped
// its own-ship by) a position that could be a hundred miles behind.
test('the last fix keeps moving while a track is recorded', async ({ page }) => {
  await bootGps(page);
  const got = await page.evaluate(() => {
    gpsLiveOn = true;
    gpsRecording = true;
    const fix = (lat, lng) => onLivePosition({
      coords: { latitude: lat, longitude: lng, accuracy: 5 }, timestamp: Date.now() });
    fix(32.0, 34.8);
    fix(32.3, 34.9);
    const last = gpsLastFix();
    gpsRecording = false;
    gpsLiveOn = false;
    return last;
  });
  expect(got).toEqual({ lat: 32.3, lng: 34.9 });
});

// iOS reports CLLocation altitude above mean sea level, and so does a Bluetooth receiver's
// NMEA GGA. The ~59 ft geoid correction belongs to Android's ellipsoid height only; taking it
// off the others read them 59 ft low.
test('an altitude already above sea level is not geoid-corrected again', async ({ page }) => {
  await bootGps(page);
  const got = await page.evaluate(() => {
    setTune('geoidUndulationFt', 59);
    gpsQnh = null;                        // no temperature term: the geoid alone shows
    gpsLiveOn = true;
    gpsRecording = false;
    const fix = (extra) => onLivePosition(Object.assign({
      coords: { latitude: 32.0, longitude: 34.8, accuracy: 5, altitude: 1000 / 3.28084 },
      timestamp: Date.now() }, extra || {}));
    fix();
    const android = gpsAltitudeForCompare();
    fix({ altitudeMsl: true });           // what ble-gps.js now marks its fixes with
    const ble = gpsAltitudeForCompare();
    const realCap = window.Capacitor;
    window.Capacitor = { getPlatform: () => 'ios', isNativePlatform: () => true, Plugins: {} };
    fix();
    const ios = gpsAltitudeForCompare();
    window.Capacitor = realCap;
    gpsLiveOn = false;
    return { android, ble, ios };
  });
  expect(Math.round(got.android)).toBe(941);
  expect(Math.round(got.ble)).toBe(1000);
  expect(Math.round(got.ios)).toBe(1000);
});

test('the Bluetooth GPS marks its GGA altitude as sea-level', async ({ page }) => {
  await bootGps(page);
  const marked = await page.evaluate(() => {
    let seen = null;
    const realLive = window.onLivePosition, realRec = window.onGpsPosition;
    window.onLivePosition = (pos) => { seen = pos; };
    window.onGpsPosition = () => {};
    const sum = (s) => { let c = 0; for (const ch of s) c ^= ch.charCodeAt(0); return c.toString(16).toUpperCase().padStart(2, '0'); };
    const gga = 'GPGGA,123519,3200.000,N,03448.000,E,1,08,0.9,300.0,M,18.0,M,,';
    const rmc = 'GPRMC,123519,A,3200.000,N,03448.000,E,090.0,045.0,230394,003.1,W';
    NavAid.bleGps.feedText('$' + gga + '*' + sum(gga) + '\r\n$' + rmc + '*' + sum(rmc) + '\r\n');
    window.onLivePosition = realLive; window.onGpsPosition = realRec;
    return seen && { msl: seen.altitudeMsl, alt: seen.coords.altitude };
  });
  expect(marked).toEqual({ msl: true, alt: 300 });
});

// webkitCompassHeading is measured from the device's top edge; in landscape the heading-up
// map swung 90 degrees off unless the screen's rotation went back on.
test('the iOS compass fallback takes the screen rotation into account', async ({ page }) => {
  await bootGps(page);
  const got = await page.evaluate(() => {
    Object.defineProperty(window, 'orientation', { configurable: true, value: 90 });
    _gpsOnDeviceOrientation({ webkitCompassHeading: 10 });
    const landscape = gpsCompassMag;
    Object.defineProperty(window, 'orientation', { configurable: true, value: 0 });
    _gpsOnDeviceOrientation({ webkitCompassHeading: 10 });
    return { landscape, portrait: gpsCompassMag };
  });
  expect(got.landscape).toBe(100);
  expect(got.portrait).toBe(10);
});

// Off every leg's cone, the off-route alert has the floor: an "off course, intercept" call
// on top of it measured against a leg the aircraft is not flying.
test('no off-course drift call while the route position is unknown', async ({ page }) => {
  await bootGps(page);
  const got = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
      { lat: 32.20, lng: 34.0, name: 'BRAVO' },
    ];
    syncLegs();
    gpsResetLegAlerts();
    _gpsAlertConfirmed = true;
    _gpsLastTopAt = 0;
    window.__alerts = [];
    window.gpsSendWatchAlert = (title) => { window.__alerts.push(title); };
    gpsOwn = { lat: 32.05, lng: 34.1, hdg: 0, t: Date.now() };   // well off the line
    gpsRouteUnknown = true;
    gpsCheckDrift();
    const whileUnknown = window.__alerts.length;
    gpsRouteUnknown = false;
    gpsCheckDrift();
    return { whileUnknown, known: window.__alerts.length };
  });
  expect(got.whileUnknown).toBe(0);
  expect(got.known).toBe(1);              // the check itself still works once on a leg
});

// --- traffic.js ---------------------------------------------------------------------------

async function bootTraffic(page) {
  await page.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { CapacitorHttp: { request: () => Promise.resolve({ status: 200, data: { ac: [] } }) } },
    };
    localStorage.setItem('navaid.showTraffic', '1');
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.trafficSetExternal === 'function' &&
    typeof window.trafficRefresh === 'function');
  await page.evaluate(() => { setTune('featureLiveTraffic', true); refreshTrafficFeature(); });
}

// Within ~110 m of the fix used to mean "that is me" at ANY height, hiding an aeroplane
// directly above or below -- the traffic that matters most.
test('traffic overhead is not taken for the own-ship', async ({ page }) => {
  await bootTraffic(page);
  const names = await page.evaluate(() => {
    _gpsLivePrev = { lat: 32.05, lng: 34.92, t: Date.now() };
    gpsLastAlt = 2000; gpsAltIsGeometric = false;
    window.trafficSetExternal([
      { hex: 'aaa111', flight: 'SELF', lat: 32.0502, lon: 34.9201, alt: 2100 },
      { hex: 'bbb222', flight: 'ABOVE', lat: 32.0501, lon: 34.9199, alt: 3000 },
      { hex: 'ccc333', flight: 'FAR', lat: 32.2, lon: 34.9, alt: 2000 },
    ]);
    return window.trafficAircraft.map(a => a.flight).sort();
  });
  expect(names).toEqual(['ABOVE', 'FAR']);
});

test('own-ship altitude is compared on the feed\'s pressure reference, not the day\'s QNH', async ({ page }) => {
  // Review: at QNH 1025 our QNH altitude and our transponder's pressure altitude differ by ~320 ft
  // on their own, and our own target came back as traffic.
  await bootTraffic(page);
  const names = await page.evaluate(() => {
    _gpsLivePrev = { lat: 32.05, lng: 34.92, t: Date.now() };
    gpsLastAlt = 2000; gpsAltIsGeometric = false; gpsQnh = { hPa: 1025, inHg: 30.27 };
    window.trafficSetExternal([
      { hex: 'aaa111', flight: 'SELF', lat: 32.0502, lon: 34.9201, alt: 1680 },   // 2000 - 11.75*27.3
      { hex: 'bbb222', flight: 'ABOVE', lat: 32.0501, lon: 34.9199, alt: 2700 },
    ]);
    return window.trafficAircraft.map(a => a.flight).sort();
  });
  expect(names).toEqual(['ABOVE']);
});

// clear() re-drew the receiver's targets and trafficSetExternal never asked the switch, so a
// pilot who turned traffic off still had the GDL90 aeroplanes on the map.
test('turning traffic off hides the receiver\'s targets too', async ({ page }) => {
  await bootTraffic(page);
  const got = await page.evaluate(() => {
    _gpsLivePrev = null;
    const list = [{ hex: 'ddd444', flight: 'GDL', lat: 32.3, lon: 34.9, alt: 4000 }];
    window.trafficSetExternal(list);
    const before = window.trafficAircraft.length;
    localStorage.setItem('navaid.showTraffic', '0');
    window.trafficRefresh();
    const afterOff = window.trafficAircraft.length;
    window.trafficSetExternal(list);      // the receiver pushes again
    const afterPush = window.trafficAircraft.length;
    const marks = document.querySelectorAll('.traffic-mark').length;
    return { before, afterOff, afterPush, marks };
  });
  expect(got.before).toBe(1);
  expect(got.afterOff).toBe(0);
  expect(got.afterPush).toBe(0);
  expect(got.marks).toBe(0);
});

// --- followme.js --------------------------------------------------------------------------

async function bootFollow(page) {
  await page.addInitScript(() => {
    window.__sockets = [];
    window.WebSocket = class {
      constructor(url, proto) {
        this.url = url; this.protocol = proto; this.binaryType = '';
        window.__sockets.push(this);
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send() {}
      close() { this.onclose && this.onclose(); }
      deliver(bytes) { this.onmessage && this.onmessage({ data: new Uint8Array(bytes).buffer }); }
      connack() { this.deliver([0x20, 0x02, 0x00, 0x00]); }
    };
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && window.NavAid.followMe)
    && typeof setTune === 'function');
  await page.evaluate(() => setTune('featureFollowMe', true));
}

// Transit only ever makes a packet's stamp look OLDER. Taking the smallest offset let one
// packet held back five minutes (a backgrounded tab) set the correction, and a dead feed then
// read as live for five minutes longer. The largest offset is the estimate.
test('a delayed packet does not make a stopped feed look live', async ({ page }) => {
  await bootFollow(page);
  const skew = await page.evaluate(async () => {
    const F = NavAid.followMe;
    history.replaceState(null, '', '?lang=en&nogist&follow=watched000000000#k=' + 'k'.repeat(43));
    await F.viewerStart({ search: location.search, hash: location.hash });
    const sock = window.__sockets[window.__sockets.length - 1];
    sock.connack();
    await new Promise(r => setTimeout(r, 20));
    const raw = Uint8Array.from(atob('k'.repeat(43) + '='), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
    const send = async (fix) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
        new TextEncoder().encode(JSON.stringify(fix))));
      const payload = new Uint8Array(iv.length + body.length);
      payload.set(iv); payload.set(body, iv.length);
      const topic = new TextEncoder().encode('navaid/follow/watched000000000');
      const remaining = 2 + topic.length + payload.length;
      const header = [0x30];
      let len = remaining;
      do { let b = len % 128; len = Math.floor(len / 128); if (len > 0) b |= 128; header.push(b); } while (len > 0);
      const frame = new Uint8Array(header.length + remaining);
      frame.set(header);
      frame[header.length] = topic.length >> 8;
      frame[header.length + 1] = topic.length & 0xff;
      frame.set(topic, header.length + 2);
      frame.set(payload, header.length + 2 + topic.length);
      sock.deliver(Array.from(frame));
      await new Promise(r => setTimeout(r, 40));
    };
    const base = { reg: '4X-TST', lat: 32.1, lng: 34.9, af: 984, kt: 100, mh: 85, trk: 90 };
    // Same clock both ends. First the packet that sat five minutes in a buffer...
    await send(Object.assign({}, base, { t: Date.now() - 5 * 60 * 1000, seq: 1 }));
    // ...then a fresh one.
    await send(Object.assign({}, base, { t: Date.now(), seq: 2 }));
    const s = F.watching().skew;
    F.viewerStop();
    return s;
  });
  // The clocks agree: the correction is about zero, not minus five minutes.
  expect(Math.abs(skew)).toBeLessThan(5000);
});

// The link's v= used to win over the key this device already trusted for the aeroplane, and
// overwrite it -- anyone holding the link could swap in their own key and have forged
// positions accepted. The remembered key wins; a different one is refused, out loud.
test('a link cannot replace the signing key this device already trusts', async ({ page }) => {
  await bootFollow(page);
  const got = await page.evaluate(async () => {
    const pub = async () => {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
      return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const trusted = await pub(), other = await pub();
    localStorage.setItem('navaid.followVerified', JSON.stringify({ goodTopicId: trusted }));
    window.__toasts = [];
    const realToast = window.showToast;
    window.showToast = (m) => { window.__toasts.push(String(m)); };
    const F = NavAid.followMe;
    const k = '#k=' + 'A'.repeat(43);
    const refused = await F.viewerStart({ search: '?follow=goodTopicId', hash: k + '&v=' + other });
    const stored = JSON.parse(localStorage.getItem('navaid.followVerified')).goodTopicId;
    const viewing = document.body.classList.contains('follow-me-viewing');
    const same = await F.viewerStart({ search: '?follow=goodTopicId', hash: k + '&v=' + trusted });
    const sameVerified = !!(same && same.verified);
    F.viewerStop();
    window.showToast = realToast;
    return { refused, storedIsTrusted: stored === trusted, viewing, sameVerified, toasts: window.__toasts };
  });
  expect(got.refused).toBeNull();
  expect(got.storedIsTrusted, 'the link overwrote the remembered key').toBe(true);
  expect(got.viewing).toBe(false);
  expect(got.toasts.join(' ')).toMatch(/signing key/);
  expect(got.sameVerified).toBe(true);
});

// --- ota.js -------------------------------------------------------------------------------

// After a rollback nothing remembered the version that failed, so every launch downloaded
// (26 MB) and installed it again, and rolled back again.
test('a bundle that was rolled back is not downloaded again', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.ota);
  const got = await page.evaluate(async () => {
    localStorage.removeItem('navaid.otaFailedVersion');
    const o = { current: { id: 'old', version: '1.0-old' }, pending: { id: 'b1', version: '1.0-new' }, downloads: 0 };
    window.__navaidEmbedded = true;
    const p = {
      current: async () => ({ bundle: o.current }),
      getNextBundle: async () => o.pending,
      set: async () => {}, cancelDelay: async () => {}, setMultiDelay: async () => {},
      next: async () => {}, notifyAppReady: async () => {},
      // The install reloads into the new bundle...
      reload: async () => { o.current = { id: o.pending.id, version: o.pending.version }; o.pending = null; },
      download: async (a) => { o.downloads++; return { id: 'b' + (o.downloads + 1), version: a.version }; },
    };
    window.Capacitor = { isNativePlatform: () => true,
      Plugins: { CapacitorUpdater: p, Network: { getStatus: async () => ({ connected: true, connectionType: 'wifi' }) } } };
    const first = await NavAid.ota.installPendingAtStartup({ plugin: p });
    // ...which never came up: the plugin put the old one back and dropped the pending pointer.
    o.current = { id: 'old', version: '1.0-old' };
    const second = await NavAid.ota.installPendingAtStartup({ plugin: p });
    const manifest = { version: '1.0-new', url: 'https://navaid.supino.org/ota/x.zip', checksum: 'a'.repeat(64) };
    const auto = await NavAid.ota.checkForUpdate({ plugin: p, manifest });
    const newer = await NavAid.ota.checkForUpdate({ plugin: p, manifest: Object.assign({}, manifest, { version: '1.0-newer' }) });
    return { first: first.installed, second: second.reason, auto: auto.reason, newer: newer.updated,
      downloads: o.downloads, failed: localStorage.getItem('navaid.otaFailedVersion') };
  });
  expect(got.first).toBe(true);
  expect(got.second).toBe('no pending bundle');
  expect(got.failed).toBe('1.0-new');
  expect(got.auto).toBe('this version failed to start before');
  expect(got.newer).toBe(true);           // a newer build is still taken
  expect(got.downloads).toBe(1);          // the newer one, never the failed one again
});

test('a bundle that installed fine is not marked as failed', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.ota);
  const failed = await page.evaluate(async () => {
    localStorage.removeItem('navaid.otaFailedVersion');
    const o = { current: { id: 'old', version: '1.0-old' }, pending: { id: 'b1', version: '1.0-new' } };
    window.__navaidEmbedded = true;
    const p = {
      current: async () => ({ bundle: o.current }),
      getNextBundle: async () => o.pending,
      set: async () => {}, cancelDelay: async () => {},
      reload: async () => { o.current = { id: o.pending.id, version: o.pending.version }; o.pending = null; },
    };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { CapacitorUpdater: p } };
    await NavAid.ota.installPendingAtStartup({ plugin: p });
    await NavAid.ota.installPendingAtStartup({ plugin: p });    // the next launch, on it
    return localStorage.getItem('navaid.otaFailedVersion');
  });
  expect(failed).toBeNull();
});

// --- offline-tiles.js ---------------------------------------------------------------------

// A preview shares the production origin and so its tile cache. Pruning to the preview's own
// wanted list on load deleted the pilot's production pack.
test('a PR preview never prunes the shared offline tile cache', async ({ page }) => {
  // Both legs need the app at the origin ROOT: the deployed run serves it under /pr/<n>/,
  // where the 'production' leg is itself a preview.
  test.skip(/\/(pr\/\d+|staging)\//.test(process.env.BASE_URL || ''), 'needs the app at the origin root');
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidOfflineTiles && typeof map !== 'undefined');
  const got = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    const stray = 'https://navaid-tiles.supino.org/Some-Other-Build/7/1/1.png';
    const keep = async () => {
      const urls = (await (await caches.open(O.TILE_CACHE)).keys()).map(k => k.url);
      return urls.includes(stray);
    };
    await caches.delete(O.TILE_CACHE);
    const cache = await caches.open(O.TILE_CACHE);
    await cache.put(stray, new Response(new Uint8Array([1]), { status: 200 }));
    const home = location.pathname + location.search;
    history.replaceState(null, '', '/pr/123/?lang=en&nogist');
    await O.cvfrCoverage(7, 7, { pruneOtherLayers: true });
    const keptOnPreview = await keep();
    history.replaceState(null, '', home);
    await O.cvfrCoverage(7, 7, { pruneOtherLayers: true });
    const keptOnProduction = await keep();
    await caches.delete(O.TILE_CACHE);
    return { keptOnPreview, keptOnProduction,
      pr: O.previewDeployment('/pr/9/'), staging: O.previewDeployment('/staging/'), root: O.previewDeployment('/') };
  });
  expect(got.keptOnPreview).toBe(true);
  expect(got.keptOnProduction).toBe(false);   // production still tidies its own cache
  expect(got).toMatchObject({ pr: true, staging: true, root: false });
});

// --- sw.js --------------------------------------------------------------------------------

// Every scope used one cache name, so the owner stamp was whichever scope installed last --
// and a preview bumping its CACHE could find production's shell cache stamped as its own and
// delete it. A non-root scope now has a cache of its own; production keeps the plain name.
test.describe('service worker scopes', () => {
  test.use({ serviceWorkers: 'allow' });
  test('a preview-scoped worker keeps its own shell cache and leaves production\'s alone', async ({ page }) => {
  // Both legs need the app at the origin ROOT: the deployed run serves it under /pr/<n>/,
  // where the 'production' leg is itself a preview.
  test.skip(/\/(pr\/\d+|staging)\//.test(process.env.BASE_URL || ''), 'needs the app at the origin root');
    test.slow();
    await page.goto('?lang=en&nogist');
    const got = await page.evaluate(async () => {
      const src = await (await fetch('sw.js', { cache: 'no-store' })).text();
      const CACHE = /^const CACHE = '([^']+)';/m.exec(src)[1];
      const root = await navigator.serviceWorker.register('sw.js');
      const wait = async (pred) => {
        for (let i = 0; i < 150; i++) { if (await pred()) return true; await new Promise(r => setTimeout(r, 100)); }
        return false;
      };
      await wait(async () => (await caches.keys()).includes(CACHE));
      await wait(async () => !!(await (await caches.open(CACHE)).match('__navaid_owner__')));
      const rootScope = root.scope;
      const preview = await navigator.serviceWorker.register('sw.js', { scope: './pr/77/' });
      const previewName = CACHE + ':' + new URL(preview.scope).pathname;
      const made = await wait(async () => (await caches.keys()).includes(previewName));
      await wait(async () => !!(await (await caches.open(previewName)).match('__navaid_owner__')));
      const stampOf = async (n) => {
        const r = await (await caches.open(n)).match('__navaid_owner__');
        return r ? r.text() : null;
      };
      const out = { made, rootStamp: await stampOf(CACHE), rootScope,
        previewStamp: await stampOf(previewName), previewScope: preview.scope };
      await preview.unregister();
      await caches.delete(previewName);
      return out;
    });
    expect(got.made, 'the preview scope did not get its own cache').toBe(true);
    expect(got.rootStamp).toBe(got.rootScope);       // not re-stamped by the preview
    expect(got.previewStamp).toBe(got.previewScope);
  });
});

test('a track recorded already above sea level keeps that through saving, and its profile is not geoid-corrected again', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof sanitizeTrack === 'function' && typeof trackAltFt === 'function');
  const r = await page.evaluate(() => {
    const kept = sanitizeTrack([{ lat: 32, lng: 35, t: 1, alt: 300, msl: 1 }, { lat: 32.01, lng: 35, t: 2, alt: 310 }]);
    return { kept: kept.map(p => p.msl || 0), msl: trackAltFt(300, 1), ell: trackAltFt(300) };
  });
  expect(r.kept).toEqual([1, 0]);
  expect(r.msl).toBeGreaterThan(r.ell);           // the geoid term was not taken off the MSL point
});

test('a preview worker never deletes any unscoped shell cache (each root deploys its own CACHE name)', () => {
  // Review: staging's CACHE is navaid-<dev sha>, not production's navaid-<main sha>, so guarding
  // only k === CACHE left production's shell deletable by an old /staging/ stamp.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
  expect(src).toMatch(/if \(SHELL_CACHE !== CACHE && \/\^navaid-\[\^:\]\+\$\/\.test\(k\)\) continue;/);
});
