// Follow me: a live position link with no server of ours.
//
// A public MQTT broker relays the bytes; the payload is encrypted before it gets there and
// the key rides in the link's fragment, which browsers never send. So the relay carries
// something it cannot read, and "use a public broker" stops being a privacy decision.
//
// Every test here runs against a stubbed WebSocket. Nothing reaches a broker: the suite must
// not depend on someone else's free service being up, and a test that silently starts
// publishing a position is exactly the wrong thing to have in a repository.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && window.NavAid.followMe));
  // A WebSocket that records what was sent and can play frames back.
  await page.evaluate(() => {
    window.__sent = [];
    window.__sockets = [];
    window.StubSocket = class {
      constructor(url, proto) {
        this.url = url; this.protocol = proto; this.binaryType = '';
        window.__sockets.push(this);
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send(bytes) { window.__sent.push(Array.from(new Uint8Array(bytes))); }
      close() { this.onclose && this.onclose(); }
      deliver(bytes) { this.onmessage && this.onmessage({ data: new Uint8Array(bytes).buffer }); }
      connack() { this.deliver([0x20, 2, 0, 0]); }
    };
  });
}

test('the remaining-length varint round-trips past one byte', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const F = NavAid.followMe;
    const check = (n) => {
      const enc = F._encodeLength(n);
      const buf = new Uint8Array([0, ...enc, 0, 0]);
      const back = F._readLength(buf, 1);
      return back && back.value === n && back.next === 1 + enc.length;
    };
    // 127 is the one-byte boundary; a position payload crosses it once encrypted.
    return [0, 1, 127, 128, 300, 16383, 16384].every(check);
  });
  expect(got).toBe(true);
});

test('a session publishes an encrypted position nobody else can read', async ({ page }) => {
  await boot(page);
  const seen = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const link = await F.start('4X-CDE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.publish({ lat: 32.0, lng: 34.9, alt: 2500, trk: 90, kt: 100 });
    window.WebSocket = orig;

    const url = new URL(link);
    const id = url.searchParams.get('follow');
    const rawKey = url.hash.replace(/^#k=/, '');
    // The publish frame: 0x30 = PUBLISH, QoS 0.
    const pub = window.__sent.find(f => f[0] === 0x30);
    const bytes = new Uint8Array(pub);
    const len = F._readLength(bytes, 1);
    const topicLen = (bytes[len.next] << 8) | bytes[len.next + 1];
    const topic = new TextDecoder().decode(bytes.subarray(len.next + 2, len.next + 2 + topicLen));
    const payload = bytes.subarray(len.next + 2 + topicLen, len.next + len.value);
    const asText = new TextDecoder().decode(payload);

    const right = await F._open(await F.importKey(F._b64url.to(rawKey)), payload);
    const wrong = await F._open(await F.importKey(F.randomBytes(32)), payload);
    F.stop();
    return { link, id, topic, hasKeyInQuery: url.search.includes(rawKey),
             looksEncrypted: !/lat|32\.0/.test(asText), right, wrong };
  });
  // The topic is the id, and the id is not guessable.
  expect(seen.topic).toBe('navaid/follow/' + seen.id);
  expect(seen.id.length).toBeGreaterThanOrEqual(20);
  // The key is in the fragment and NOT in the query — the half a server would see.
  expect(seen.link).toContain('#k=');
  expect(seen.hasKeyInQuery).toBe(false);
  // What crosses the wire is unreadable without the key...
  expect(seen.looksEncrypted).toBe(true);
  expect(seen.wrong).toBe(null);
  // ...and exactly right with it.
  expect(seen.right).toMatchObject({ lat: 32, lng: 34.9, alt: 2500, trk: 90, kt: 100 });
  expect(seen.right.t).toBeGreaterThan(0);
});

test('a watcher decrypts what the pilot published', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const link = await F.start('4X-CDE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.publish({ lat: 31.5, lng: 35.1, alt: 3000 });
    const pub = new Uint8Array(window.__sent.find(f => f[0] === 0x30));

    const url = new URL(link);
    const state = await F.watch(url.searchParams.get('follow'), url.hash.replace(/^#k=/, ''));
    window.__sockets[1].connack();
    await new Promise(r => setTimeout(r, 10));
    const subscribed = window.__sent.some(f => f[0] === 0x82);   // SUBSCRIBE, flags 0x02
    window.__sockets[1].deliver(pub);                            // the broker relays it back
    await new Promise(r => setTimeout(r, 30));
    const out = { subscribed, connected: state.connected, fix: state.fix };
    F.unwatch(); F.stop();
    window.WebSocket = orig;
    return out;
  });
  expect(got.subscribed).toBe(true);
  expect(got.connected).toBe(true);
  expect(got.fix).toMatchObject({ lat: 31.5, lng: 35.1, alt: 3000 });
});

// The part that matters more than the transport: a viewer must never quietly draw an
// aeroplane where it merely used to be.
test('the age of a fix is reported, not smoothed over', async ({ page }) => {
  await boot(page);
  const ages = await page.evaluate(() => {
    const now = Date.now();
    return { fresh: followMeAge(now - 1500, now), old: followMeAge(now - 240000, now),
             unknown: followMeAge(null, now) };
  });
  expect(ages.fresh).toBe(2);
  expect(ages.old).toBe(240);
  expect(ages.unknown).toBe(null);      // no fix is not "0 seconds ago"
});

test('one session at a time, and stopping ends it', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const a = await F.start('4X-CDE');
    const b = await F.start('4X-CDE');               // asking twice does not open a second session
    const sharingBefore = F.sharing();
    F.stop();
    const after = { sharing: F.sharing(), same: a === b, sockets: window.__sockets.length };
    // ...and a new session is a NEW link: nothing survives the flight it belonged to.
    const c = await F.start('4X-CDE');
    const reused = c === a;
    F.stop();
    window.WebSocket = orig;
    return Object.assign(after, { sharingBefore, reused });
  });
  expect(got.sharingBefore).toBe(true);
  expect(got.same).toBe(true);
  expect(got.sockets).toBe(1);
  expect(got.sharing).toBe(false);
  expect(got.reused).toBe(false);
});

// The code is required, and it is a LABEL: nothing verifies it. A shared link with no name
// on it is a puzzle for whoever opens it, which is the whole reason it is mandatory.
test('sharing refuses without an aircraft code', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    F.setCode('');
    const none = await F.start('');
    const blank = await F.start('   ');
    const ok = await F.start('4x-cde');
    const out = { none, blank, ok: !!ok, sockets: window.__sockets.length, code: F.code() };
    F.stop();
    window.WebSocket = orig;
    return out;
  });
  expect(got.none).toBe(null);
  expect(got.blank).toBe(null);
  expect(got.sockets).toBe(1);          // nothing connected until there was a code
  expect(got.ok).toBe(true);
  expect(got.code).toBe('4X-CDE');      // normalised, and remembered for next time
});

test('the code travels inside the envelope, not beside it', async ({ page }) => {
  await boot(page);
  const seen = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const link = await F.start('4X-ABC');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.publish({ lat: 32.1, lng: 34.8 });
    const pub = new Uint8Array(window.__sent.find(f => f[0] === 0x30));
    const wire = new TextDecoder().decode(pub);
    const url = new URL(link);
    const key = await F.importKey(F._b64url.to(url.hash.replace(/^#k=/, '')));
    const len = F._readLength(pub, 1);
    const topicLen = (pub[len.next] << 8) | pub[len.next + 1];
    const msg = await F._open(key, pub.subarray(len.next + 2 + topicLen, len.next + len.value));
    F.stop();
    window.WebSocket = orig;
    return { onWire: /4X-ABC/.test(wire), inLink: /4X-ABC/.test(link), reg: msg && msg.reg };
  });
  expect(seen.reg).toBe('4X-ABC');      // the viewer can read it...
  expect(seen.onWire).toBe(false);      // ...the broker cannot
  expect(seen.inLink).toBe(false);      // ...and it is not in the URL either
});

// The viewer: a link opens into watching mode, and the age is always on screen.
test('opening the link watches, names the aircraft and dates the position', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const link = await F.start('4X-XYZ');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.publish({ lat: 31.8, lng: 34.95, trk: 270 });
    const pub = new Uint8Array(window.__sent.find(f => f[0] === 0x30));
    const url = new URL(link);

    await F.viewerStart({ search: url.search, hash: url.hash });
    const waiting = document.getElementById('follow-me-banner').textContent;
    window.__sockets[1].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sockets[1].deliver(pub);
    await new Promise(r => setTimeout(r, 40));
    const banner = document.getElementById('follow-me-banner');
    const out = { waiting, live: banner.textContent, stale: banner.classList.contains('stale'),
                  viewing: F.viewing(), marks: document.querySelectorAll('.follow-me-mark').length };
    F.viewerStop(); F.stop();
    window.WebSocket = orig;
    return Object.assign(out, { after: !!document.getElementById('follow-me-banner') });
  });
  expect(got.waiting).toMatch(/waiting/i);      // before anything arrives it says so
  expect(got.live).toContain('4X-XYZ');         // then names the aircraft...
  expect(got.live).toMatch(/Last position/);    // ...and dates the position
  expect(got.stale).toBe(false);
  expect(got.viewing).toBe(true);
  expect(got.marks).toBe(1);
  expect(got.after).toBe(false);                // stopping clears the banner
});

test('a position that stops arriving is called stale, not drawn as current', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const link = await F.start('4X-OLD');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.publish({ lat: 31.8, lng: 34.95 });
    const pub = new Uint8Array(window.__sent.find(f => f[0] === 0x30));
    const url = new URL(link);
    const state = await F.viewerStart({ search: url.search, hash: url.hash });
    window.__sockets[1].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sockets[1].deliver(pub);
    await new Promise(r => setTimeout(r, 40));
    // Age it past the staleness threshold without waiting for real time to pass.
    state.at = Date.now() - (F.staleSec() + 5) * 1000;
    F.viewerRefresh();
    const banner = document.getElementById('follow-me-banner');
    const out = { text: banner.textContent, stale: banner.classList.contains('stale') };
    F.viewerStop(); F.stop();
    window.WebSocket = orig;
    return out;
  });
  expect(got.stale).toBe(true);
  expect(got.text).toMatch(/stopped|not moving/i);
});

// Where the control lives. Sharing is decided in the air, so it belongs beside the follow
// lock and the compass -- the two other controls that exist only while a fix is driving the
// map -- not in the Export menu, which is where you go to save a file.
test('the map control appears with the position source, and only if offered', async ({ page }) => {
  await boot(page);
  const seen = await page.evaluate(() => {
    const wrap = () => document.getElementById('follow-me-map').parentNode;
    const shown = () => wrap().style.display !== 'none';
    const out = {};
    // Feature off: nothing, whatever the GPS is doing.
    setTune('featureFollowMe', false);
    window.gpsLiveOn = true;
    refreshFollowMeMapControl();
    out.offNoControl = shown();
    // Offered, but no position to share: still nothing -- a switch for nothing is worse
    // than no switch.
    setTune('featureFollowMe', true);
    window.gpsLiveOn = false;
    window.gpsRecording = false;
    refreshFollowMeMapControl();
    out.noFix = shown();
    // Offered and live: there it is.
    window.gpsLiveOn = true;
    refreshFollowMeMapControl();
    out.live = shown();
    // Recording counts too.
    window.gpsLiveOn = false;
    window.gpsRecording = true;
    refreshFollowMeMapControl();
    out.recording = shown();
    window.gpsRecording = false;
    return out;
  });
  expect(seen.offNoControl).toBe(false);
  expect(seen.noFix).toBe(false);
  expect(seen.live).toBe(true);
  expect(seen.recording).toBe(true);
});

// The gist lands AFTER ui.js, so a feature switched on there has to bring its controls back
// without a reload — the trap showReturnFeatureOn documents in its own comment. Two halves:
// the refreshes must DO the right thing, and the gist-landing path must CALL them.
test('the refreshes bring the controls back when the flag flips', async ({ page }) => {
  await boot(page);
  const seen = await page.evaluate(() => {
    window.gpsLiveOn = true;
    setTune('featureFollowMe', false);
    refreshFollowMeControl();
    refreshFollowMeMapControl();
    const before = { menu: !document.getElementById('follow-me').hidden,
                     map: document.getElementById('follow-me-map').parentNode.style.display !== 'none' };
    setTune('featureFollowMe', true);
    refreshFollowMeControl();
    refreshFollowMeMapControl();
    return { before, after: { menu: !document.getElementById('follow-me').hidden,
                              map: document.getElementById('follow-me-map').parentNode.style.display !== 'none' } };
  });
  expect(seen.before).toEqual({ menu: false, map: false });
  expect(seen.after).toEqual({ menu: true, map: true });
});

// ...and that they are actually wired into the gist-landing block. That block is an inline
// .then() on loadRemoteConfig with no name to call, so this reads the source: a behavioural
// test here would pass whether or not the calls were ever hooked up, which is exactly how a
// feature ends up switched on in the gist and invisible until a reload.
test('the gist-landing block calls both refreshes', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const wired = await page.evaluate(async () => {
    const src = await (await fetch('app/ui.js')).text();
    const at = src.indexOf('loadRemoteConfig().then');
    if (at < 0) return null;
    const block = src.slice(at, at + 4000);
    return { menu: block.includes('refreshFollowMeControl'),
             map: block.includes('refreshFollowMeMapControl'),
             // The neighbour that documents the same trap, as a canary that this is the
             // right block and not some other .then().
             neighbour: block.includes('refreshShowReturnFeature') };
  });
  expect(wired).not.toBe(null);
  expect(wired.neighbour).toBe(true);
  expect(wired.menu).toBe(true);
  expect(wired.map).toBe(true);
});
