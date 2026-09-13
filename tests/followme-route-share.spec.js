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
