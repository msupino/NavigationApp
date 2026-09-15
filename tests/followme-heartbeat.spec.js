// @ts-check
// "Still here, nothing new to say."
//
// Publishing is fix-driven, so the feed goes quiet whenever fixes stop: a phone in a bag, an
// app the OS suspended, a spell of accuracy too poor to publish. From the ground all of those
// look exactly like a phone that died, and the follower -- who is often the reason the pilot
// turned sharing on -- cannot tell which they are watching.
//
// So the aeroplane sends a signed, position-less packet when it has nothing else to send. The
// mark stays where it last really was and goes on aging honestly; what changes is that the
// banner can say the aircraft is still connected, in amber rather than red.
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
    && typeof setTune === 'function');
  await page.evaluate(() => { setTune('featureFollowMe', true); window.gpsLiveOn = true; });
}

// Deliver a packet the viewer's own client will parse. `hb` makes it a heartbeat.
async function deliver(page, { hb, seq, offsetMs, retained }) {
  return page.evaluate(async (args) => {
    const sock = window.__sockets[window.__sockets.length - 1];
    const raw = Uint8Array.from(atob('k'.repeat(43) + '='), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
    const body = args.hb
      ? { reg: '4X-TST', hb: 1, t: Date.now() + args.offsetMs, seq: args.seq }
      : { reg: '4X-TST', lat: 32.1, lng: 34.9, alt: 300, trk: 90, kt: 100,
          t: Date.now() + args.offsetMs, seq: args.seq };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify(body))));
    const payload = new Uint8Array(iv.length + sealed.length);
    payload.set(iv); payload.set(sealed, iv.length);
    const topicBytes = new TextEncoder().encode('navaid/follow/watched000000000');
    const remaining = 2 + topicBytes.length + payload.length;
    const header = [0x30 | (args.retained ? 1 : 0)];
    let len = remaining;
    do { let b = len % 128; len = Math.floor(len / 128); if (len > 0) b |= 128; header.push(b); } while (len > 0);
    const frame = new Uint8Array(header.length + remaining);
    frame.set(header);
    frame[header.length] = topicBytes.length >> 8;
    frame[header.length + 1] = topicBytes.length & 0xff;
    frame.set(topicBytes, header.length + 2);
    frame.set(payload, header.length + 2 + topicBytes.length);
    sock.deliver(Array.from(frame));
    await new Promise(r => setTimeout(r, 40));
  }, { hb, seq, offsetMs, retained });
}

async function watching(page) {
  await page.evaluate(async () => {
    history.replaceState(null, '', '?lang=en&nogist&follow=watched000000000#k=' + 'k'.repeat(43));
    await NavAid.followMe.viewerStart({ search: location.search, hash: location.hash });
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 20));
  });
}

const banner = (page) => page.evaluate(() => {
  NavAid.followMe.viewerRefresh();
  const el = document.getElementById('follow-me-banner');
  return { text: el.textContent, cls: el.className,
           markOpacity: document.querySelector('.follow-me-mark')
             ? document.querySelector('.follow-me-mark').style.opacity : null };
});

test('an aeroplane with nothing new to say still says it is there', async ({ page }) => {
  await boot(page);
  await watching(page);
  // A real position, then a long silence, then a heartbeat.
  await deliver(page, { hb: false, seq: 1, offsetMs: -5 * 60 * 1000, retained: true });
  const quiet = await banner(page);
  expect(quiet.text).toMatch(/not moving|feed has stopped/);
  expect(quiet.cls).toMatch(/\bstale\b/);

  await deliver(page, { hb: true, seq: 2, offsetMs: 0, retained: false });
  const held = await banner(page);
  // The position is still five minutes old and the banner still says so...
  expect(held.text).toMatch(/Last position 5 min ago/);
  // ...but the aeroplane is not gone, and the colour says amber rather than red.
  expect(held.text).toMatch(/still connected/);
  expect(held.cls).toMatch(/\bholding\b/);
  expect(held.cls).not.toMatch(/\bstale\b/);
});

test('a heartbeat does not become the position', async ({ page }) => {
  await boot(page);
  await watching(page);
  await deliver(page, { hb: false, seq: 1, offsetMs: -60000, retained: true });
  const before = await page.evaluate(() => NavAid.followMe.viewerFix());
  await deliver(page, { hb: true, seq: 2, offsetMs: 0, retained: false });
  const after = await page.evaluate(() => NavAid.followMe.viewerFix());
  // Same fix, same age: an aeroplane that has not reported a position has not moved on the map.
  expect(after.lat).toBe(before.lat);
  expect(after.t).toBe(before.t);
  expect(after.hb).toBe(undefined);
});

test('a heartbeat before any position still says it is waiting', async ({ page }) => {
  await boot(page);
  await watching(page);
  await deliver(page, { hb: true, seq: 1, offsetMs: 0, retained: false });
  const said = await banner(page);
  expect(said.text).toMatch(/waiting for a position/);
  expect(said.cls).toMatch(/\bholding\b/);      // something IS arriving
});

test('when the heartbeat stops too, the banner goes back to red', async ({ page }) => {
  await boot(page);
  await watching(page);
  // Time is moved rather than waited for: an old stamp on a LIVE packet is read (rightly) as a
  // wrong clock, so the only honest way to age a feed in a test is to advance the clock.
  await page.evaluate(() => {
    window.__now = Date.now();
    Date.now = () => window.__now;
  });
  await deliver(page, { hb: false, seq: 1, offsetMs: 0, retained: true });

  await page.evaluate(() => { window.__now += 40000; });        // the position goes stale
  await deliver(page, { hb: true, seq: 2, offsetMs: 0, retained: false });
  const held = await banner(page);
  expect(held.text).toMatch(/still connected/);
  expect(held.cls).toMatch(/\bholding\b/);

  await page.evaluate(() => { window.__now += 10 * 60 * 1000; });  // and then silence
  const said = await banner(page);
  expect(said.text).toMatch(/not moving|feed has stopped/);
  expect(said.cls).toMatch(/\bstale\b/);
  expect(said.cls).not.toMatch(/\bholding\b/);
});

test('the heartbeat is not retained, so a late follower still gets a position', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-TST');
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 20));
    setTune('followMeRateSec', 1);
    await F.publish({ lat: 32.1, lng: 34.9, alt: 300, trk: 90, kt: 100 });
    await new Promise(r => setTimeout(r, 20));
    const fixFrames = window.__sent.filter(f => (f[0] & 0xf0) === 0x30 && f.length > 40);
    const fixRetain = fixFrames.length ? (fixFrames[fixFrames.length - 1][0] & 0x01) : null;
    // The rate limiter is shared: a heartbeat is skipped while a real fix is recent, which is
    // the point of it. Past the window, it goes.
    await new Promise(r => setTimeout(r, 1100));
    await F.publishHeartbeat();
    await new Promise(r => setTimeout(r, 20));
    const all = window.__sent.filter(f => (f[0] & 0xf0) === 0x30 && f.length > 40);
    return { fixRetain, hbRetain: all[all.length - 1][0] & 0x01, grew: all.length > fixFrames.length };
  });
  expect(got.grew, 'the heartbeat was never published').toBe(true);
  // The retained packet on the relay is what a late joiner gets. A position-less one there
  // would hand them an aeroplane with no position at all.
  expect(got.fixRetain).toBe(1);
  expect(got.hbRetain).toBe(0);
});

// The banner reads the feet the aeroplane sent. An older publisher sends only metres, and the
// viewer converts those -- right to within the metre they were rounded to.
test('the banner shows the feet the aeroplane sent, and falls back to metres', async ({ page }) => {
  await boot(page);
  await watching(page);
  await page.evaluate(async () => {
    const raw = Uint8Array.from(atob('k'.repeat(43) + '='), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
    window.__send = async (body) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
        new TextEncoder().encode(JSON.stringify(body))));
      const payload = new Uint8Array(iv.length + sealed.length);
      payload.set(iv); payload.set(sealed, iv.length);
      const topicBytes = new TextEncoder().encode('navaid/follow/watched000000000');
      const remaining = 2 + topicBytes.length + payload.length;
      const header = [0x30];
      let len = remaining;
      do { let b = len % 128; len = Math.floor(len / 128); if (len > 0) b |= 128; header.push(b); } while (len > 0);
      const frame = new Uint8Array(header.length + remaining);
      frame.set(header);
      frame[header.length] = topicBytes.length >> 8;
      frame[header.length + 1] = topicBytes.length & 0xff;
      frame.set(topicBytes, header.length + 2);
      frame.set(payload, header.length + 2 + topicBytes.length);
      window.__sockets[window.__sockets.length - 1].deliver(Array.from(frame));
      await new Promise(r => setTimeout(r, 40));
    };
  });
  // 80 m is 262 ft converted, but the aeroplane's own readout said 261.
  await page.evaluate(() => window.__send({ reg: '4X-TST', lat: 32.1, lng: 34.9, alt: 80, af: 261, trk: 90, kt: 100, t: Date.now(), seq: 1 }));
  expect((await banner(page)).text).toMatch(/\b261 ft\b/);

  // An older publisher, metres only: converted, and right to the metre it was rounded to.
  await page.evaluate(() => window.__send({ reg: '4X-TST', lat: 32.1, lng: 34.9, alt: 80, trk: 90, kt: 100, t: Date.now(), seq: 2 }));
  expect((await banner(page)).text).toMatch(/\b262 ft\b/);
});
