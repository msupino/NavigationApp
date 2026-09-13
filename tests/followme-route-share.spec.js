// @ts-check
// Asked for: when sharing a location, seed the route into MQTT as well, and ask the viewer
// whether to load it.
//
// Two topics, not one packet: a fix changes every couple of seconds and a route once a
// flight, and both are retained so whoever opens the link an hour later gets the current
// copy of each. The plan is offered, never applied -- loading it replaces the route on the
// viewer's map, and they may well be looking at their own.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__sent = [];
    window.__sockets = [];
    window.StubSocket = class {
      constructor(url, proto) {
        this.url = url; this.protocol = proto; this.binaryType = '';
        window.__sockets.push(this);
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send(bytes) {
        const frame = new Uint8Array(bytes);
        window.__sent.push(Array.from(frame));
        if ((frame[0] >> 4) === 3 && ((frame[0] >> 1) & 3) === 1) {
          let at = 1, digit;
          do { digit = frame[at++]; } while (digit & 0x80);
          const topicLen = (frame[at] << 8) | frame[at + 1];
          const idAt = at + 2 + topicLen;
          const id = (frame[idAt] << 8) | frame[idAt + 1];
          setTimeout(() => this.deliver([0x40, 0x02, id >> 8, id & 0xff]), 0);
        }
      }
      close() { this.onclose && this.onclose(); }
      deliver(bytes) { this.onmessage && this.onmessage({ data: new Uint8Array(bytes).buffer }); }
      connack() { this.deliver([0x20, 0x02, 0x00, 0x00]); }
    };
    window.WebSocket = window.StubSocket;
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && window.NavAid.followMe)
    && typeof setTune === 'function' && typeof serializeRoute === 'function');
  await page.evaluate(() => {
    setTune('featureFollowMe', true);
    setTune('followMeRouteDebounceMs', 0);
    window.gpsLiveOn = true;
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' },
                       { lat: 32.78, lng: 35.02, name: 'LLHA' }];
    syncLegs();
    draw();
  });
}

// Every PUBLISH on the wire, as { topic, empty }.
const published = (page) => page.evaluate(() => window.__sent
  .filter(f => (f[0] >> 4) === 3)
  .map(f => {
    let at = 1, digit;
    do { digit = f[at++]; } while (digit & 0x80);
    const len = (f[at] << 8) | f[at + 1];
    const topic = String.fromCharCode(...f.slice(at + 2, at + 2 + len));
    const qos = (f[0] >> 1) & 3;
    const body = f.slice(at + 2 + len + (qos ? 2 : 0));
    return { topic, empty: body.length === 0 };
  }));

test('starting a share seeds the route on its own retained topic', async ({ page }) => {
  await boot(page);
  const id = await page.evaluate(async () => {
    const link = await NavAid.followMe.start('4X-RTE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    return new URL(link).searchParams.get('follow');
  });
  const out = await published(page);
  const route = out.filter(p => p.topic.endsWith('/route'));
  expect(route.length, 'no route was seeded').toBeGreaterThan(0);
  expect(route[0].topic).toBe('navaid/follow/' + id + '/route');
  expect(route[0].empty).toBe(false);
});

test('a route edit re-sends it, and an unchanged route does not', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-RTE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    window.__sent.length = 0;
  });
  const again = await page.evaluate(async () => {
    await NavAid.followMe.publishRoute(false);        // nothing changed
    return window.__sent.length;
  });
  expect(again, 'the relay already has it, retained').toBe(0);

  await page.evaluate(async () => {
    // A diversion agreed in the air is exactly what a follower wants to see.
    state.waypoints.push({ lat: 32.9, lng: 35.3, name: 'MEGID' });
    syncLegs();
    await NavAid.followMe.publishRoute(false);
  });
  const out = await published(page);
  expect(out.filter(p => p.topic.endsWith('/route')).length).toBe(1);
});

test('stopping clears the route as well as the position', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-RTE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    window.__sent.length = 0;
    await NavAid.followMe.stop();
  });
  const out = await published(page);
  const tombstones = out.filter(p => p.empty);
  // A link that no longer says where the aeroplane IS must not still hand out where it was
  // going.
  expect(tombstones.some(p => p.topic.endsWith('/route'))).toBe(true);
  expect(tombstones.some(p => !p.topic.endsWith('/route'))).toBe(true);
});

test('the viewer is asked, and yes loads the plan', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const link = await F.start('4X-RTE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    // Keep the sealed route packet, then become a viewer with a different route drawn.
    const routeFrame = window.__sent.filter(f => (f[0] >> 4) === 3).map(f => {
      let at = 1, digit;
      do { digit = f[at++]; } while (digit & 0x80);
      const len = (f[at] << 8) | f[at + 1];
      const topic = String.fromCharCode(...f.slice(at + 2, at + 2 + len));
      return { topic, frame: f };
    }).find(p => p.topic.endsWith('/route'));
    state.waypoints = [{ lat: 31.2, lng: 34.6, name: 'MINE' }, { lat: 31.4, lng: 34.7, name: 'OWN' }];
    syncLegs();
    const url = new URL(link);
    const asked = [];
    window.confirm = (text) => { asked.push(String(text)); return true; };
    await F.viewerStart({ search: url.search, hash: url.hash });
    const sub = window.__sockets[window.__sockets.length - 1];
    sub.connack();
    await new Promise(r => setTimeout(r, 20));
    sub.deliver(routeFrame.frame);
    await new Promise(r => setTimeout(r, 60));
    return { asked, names: state.waypoints.map(w => w.name) };
  });
  // It says which flight, and that loading replaces what is there.
  expect(got.asked.length).toBe(1);
  expect(got.asked[0]).toMatch(/LLHZ/);
  expect(got.asked[0]).toMatch(/replaces/i);
  expect(got.names).toEqual(['LLHZ', 'LLHA']);
});

test('no means no, and the same plan is not asked about twice', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const link = await F.start('4X-RTE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    const routeFrame = window.__sent.filter(f => (f[0] >> 4) === 3).map(f => {
      let at = 1, digit;
      do { digit = f[at++]; } while (digit & 0x80);
      const len = (f[at] << 8) | f[at + 1];
      const topic = String.fromCharCode(...f.slice(at + 2, at + 2 + len));
      return { topic, frame: f };
    }).find(p => p.topic.endsWith('/route'));
    state.waypoints = [{ lat: 31.2, lng: 34.6, name: 'MINE' }, { lat: 31.4, lng: 34.7, name: 'OWN' }];
    syncLegs();
    const asked = [];
    window.confirm = (text) => { asked.push(String(text)); return false; };
    const url = new URL(link);
    await F.viewerStart({ search: url.search, hash: url.hash });
    const sub = window.__sockets[window.__sockets.length - 1];
    sub.connack();
    await new Promise(r => setTimeout(r, 20));
    sub.deliver(routeFrame.frame);
    await new Promise(r => setTimeout(r, 40));
    sub.deliver(routeFrame.frame);           // a reconnect re-delivers the retained packet
    await new Promise(r => setTimeout(r, 40));
    return { asked: asked.length, names: state.waypoints.map(w => w.name) };
  });
  expect(got.asked, 'asked again about a plan already declined').toBe(1);
  expect(got.names, 'the viewer\'s own route was replaced anyway').toEqual(['MINE', 'OWN']);
});

test('the gist can withdraw the whole channel', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    setTune('featureFollowMeRoute', false);
    await NavAid.followMe.start('4X-RTE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    return window.__sent.filter(f => (f[0] >> 4) === 3).map(f => {
      let at = 1, digit;
      do { digit = f[at++]; } while (digit & 0x80);
      const len = (f[at] << 8) | f[at + 1];
      return String.fromCharCode(...f.slice(at + 2, at + 2 + len));
    });
  });
  expect(out.some(t => t.endsWith('/route'))).toBe(false);
});

// ---- gzip -----------------------------------------------------------------------------
// The payload is RETAINED: it sits on a free public relay until the share stops, so the
// smaller copy is the polite one. JSON with the same keys repeated once per leg is the case
// gzip is best at -- a 20-waypoint plan with comm changes goes from about 7.6 KB to 0.6 KB.
// Compressed BEFORE sealing, because compressing ciphertext buys nothing.
const routePublishSize = (page) => page.evaluate(() => {
  const frame = window.__sent.filter(f => (f[0] >> 4) === 3).map(f => {
    let at = 1, digit;
    do { digit = f[at++]; } while (digit & 0x80);
    const len = (f[at] << 8) | f[at + 1];
    return { topic: String.fromCharCode(...f.slice(at + 2, at + 2 + len)), size: f.length };
  }).find(p => p.topic.endsWith('/route'));
  return frame ? frame.size : 0;
});

const bigRoute = (page) => page.evaluate(() => {
  state.waypoints = Array.from({ length: 20 }, (_, i) => ({
    lat: 32 + i * 0.05, lng: 34.8 + i * 0.03, name: 'WPT' + String(i).padStart(2, '0') }));
  syncLegs();
  state.notes = state.waypoints.slice(0, 10).map((w) => ({
    lat: w.lat, lng: w.lng, text: 'CONTACT HERZLIYA TOWER 122.6 AT ' + w.name,
    cc: w.name, freqName: 'HERZLIYA TWR', freq: '122.600' }));
});

test('the plan goes out compressed, and is a fraction of the size', async ({ page }) => {
  await boot(page);
  await bigRoute(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-GZ');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
  });
  const gz = await routePublishSize(page);

  // The same route with compression taken away, for comparison and for the old-runtime path.
  await page.evaluate(() => { window.__CS = window.CompressionStream; delete window.CompressionStream; });
  await page.evaluate(async () => {
    window.__sent.length = 0;
    await NavAid.followMe.publishRoute(true);
    await new Promise(r => setTimeout(r, 40));
  });
  const plain = await routePublishSize(page);
  expect(plain).toBeGreaterThan(4000);
  expect(gz, 'gzip bought nothing: ' + gz + ' vs ' + plain).toBeLessThan(plain / 3);
});

test('a viewer reads either form', async ({ page }) => {
  await boot(page);
  await bigRoute(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const link = await F.start('4X-GZ');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    const grab = () => window.__sent.filter(f => (f[0] >> 4) === 3).map(f => {
      let at = 1, digit;
      do { digit = f[at++]; } while (digit & 0x80);
      const len = (f[at] << 8) | f[at + 1];
      return { topic: String.fromCharCode(...f.slice(at + 2, at + 2 + len)), frame: f };
    }).find(p => p.topic.endsWith('/route'));
    const zipped = grab().frame;
    // ...and the same plan from a publisher that could not compress.
    window.__CS = window.CompressionStream;
    delete window.CompressionStream;
    window.__sent.length = 0;
    await F.publishRoute(true);
    await new Promise(r => setTimeout(r, 40));
    const flat = grab().frame;
    window.CompressionStream = window.__CS;

    const read = async (frame) => {
      state.waypoints = [{ lat: 31.2, lng: 34.6, name: 'MINE' }, { lat: 31.4, lng: 34.7, name: 'OWN' }];
      syncLegs();
      F.viewerStop();
      const url = new URL(link);
      window.confirm = () => true;
      await F.viewerStart({ search: url.search, hash: url.hash });
      const sub = window.__sockets[window.__sockets.length - 1];
      sub.connack();
      await new Promise(r => setTimeout(r, 20));
      sub.deliver(frame);
      await new Promise(r => setTimeout(r, 80));
      return state.waypoints.length;
    };
    return { fromGz: await read(zipped), fromPlain: await read(flat) };
  });
  expect(got.fromGz, 'the gzipped plan did not load').toBe(20);
  expect(got.fromPlain, 'the uncompressed plan did not load').toBe(20);
});

test('a viewer that cannot inflate is left with the position, not an error', async ({ page }) => {
  await boot(page);
  await bigRoute(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const link = await F.start('4X-GZ');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    const frame = window.__sent.filter(f => (f[0] >> 4) === 3).map(f => {
      let at = 1, digit;
      do { digit = f[at++]; } while (digit & 0x80);
      const len = (f[at] << 8) | f[at + 1];
      return { topic: String.fromCharCode(...f.slice(at + 2, at + 2 + len)), frame: f };
    }).find(p => p.topic.endsWith('/route')).frame;
    delete window.DecompressionStream;             // an iOS before 16.4
    state.waypoints = [{ lat: 31.2, lng: 34.6, name: 'MINE' }, { lat: 31.4, lng: 34.7, name: 'OWN' }];
    syncLegs();
    let asked = 0;
    window.confirm = () => { asked++; return true; };
    const url = new URL(link);
    await F.viewerStart({ search: url.search, hash: url.hash });
    const sub = window.__sockets[window.__sockets.length - 1];
    sub.connack();
    await new Promise(r => setTimeout(r, 20));
    sub.deliver(frame);
    await new Promise(r => setTimeout(r, 80));
    return { asked, names: state.waypoints.map(w => w.name), watching: F.viewing() };
  });
  // No offer it cannot honour, no thrown error, and the watch -- which is what the link is
  // for -- carries on.
  expect(got.asked).toBe(0);
  expect(got.names).toEqual(['MINE', 'OWN']);
  expect(got.watching).toBe(true);
});

// Which compressor, or none, is the gist's to say: a relay that dislikes a format, or a fleet
// on a runtime whose CompressionStream misbehaves, should be a config push and not a release.
const routeEnvelopeKeys = (page, link) => page.evaluate(async (shared) => {
  // Read our own packet back the way a viewer does -- with the key out of the link -- so this
  // asserts what is actually on the wire rather than what the publisher meant to send.
  const rawKey = Uint8Array.from(
    atob(new URL(shared).hash.replace('#k=', '').replace(/-/g, '+').replace(/_/g, '/')),
    c => c.charCodeAt(0));
  const frame = window.__sent.filter(f => (f[0] >> 4) === 3).map(f => {
    let at = 1, digit;
    do { digit = f[at++]; } while (digit & 0x80);
    const len = (f[at] << 8) | f[at + 1];
    return { topic: String.fromCharCode(...f.slice(at + 2, at + 2 + len)),
             body: f.slice(at + 2 + len) };
  }).find(p => p.topic.endsWith('/route'));
  if (!frame) return null;
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const bytes = new Uint8Array(frame.body);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return JSON.parse(new TextDecoder().decode(pt));
}, link);

for (const format of ['gzip', 'deflate-raw']) {
  test('the gist picks the compressor: ' + format, async ({ page }) => {
    await boot(page);
    await bigRoute(page);
    const link = await page.evaluate(async (f) => {
      setTune('followMeRouteCompress', f);
      const out = await NavAid.followMe.start('4X-ZF');
      window.__sockets[0].connack();
      await new Promise(r => setTimeout(r, 60));
      return out;
    }, format);
    const env = await routeEnvelopeKeys(page, link);
    expect(env.zf, 'the packet does not say how it was compressed').toBe(format);
    expect(env.gz).toBeTruthy();
    expect(env.route, 'both forms in one packet').toBeUndefined();
  });
}

test('the gist can turn the compressor off entirely', async ({ page }) => {
  await boot(page);
  await bigRoute(page);
  const link = await page.evaluate(async () => {
    setTune('followMeRouteCompress', 'off');
    const out = await NavAid.followMe.start('4X-ZF');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    return out;
  });
  const env = await routeEnvelopeKeys(page, link);
  expect(env.gz).toBeUndefined();
  expect(env.route, 'nothing to read').toBeTruthy();
});

test('a viewer inflates what the packet says it is, whatever the gist says now', async ({ page }) => {
  await boot(page);
  await bigRoute(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    setTune('followMeRouteCompress', 'deflate-raw');
    const link = await F.start('4X-ZF');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 60));
    const frame = window.__sent.filter(f => (f[0] >> 4) === 3).map(f => {
      let at = 1, digit;
      do { digit = f[at++]; } while (digit & 0x80);
      const len = (f[at] << 8) | f[at + 1];
      return { topic: String.fromCharCode(...f.slice(at + 2, at + 2 + len)), frame: f };
    }).find(p => p.topic.endsWith('/route')).frame;
    // The gist changes its mind while a retained packet from before is still on the relay.
    setTune('followMeRouteCompress', 'gzip');
    state.waypoints = [{ lat: 31.2, lng: 34.6, name: 'MINE' }, { lat: 31.4, lng: 34.7, name: 'OWN' }];
    syncLegs();
    window.confirm = () => true;
    const url = new URL(link);
    await F.viewerStart({ search: url.search, hash: url.hash });
    const sub = window.__sockets[window.__sockets.length - 1];
    sub.connack();
    await new Promise(r => setTimeout(r, 20));
    sub.deliver(frame);
    await new Promise(r => setTimeout(r, 80));
    return state.waypoints.length;
  });
  // The format travels in the packet, so a reader never has to guess -- or agree.
  expect(got).toBe(20);
});
