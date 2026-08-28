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

// The stub is installed BEFORE any page script runs, and replaces window.WebSocket
// outright: boot can now resume a stored session on its own, and a test that quietly
// starts publishing a position to a public broker is exactly the wrong thing to have in a
// repository. It also survives a reload, which is how a restart is tested.
async function installStub(page) {
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
        // The broker acknowledges QoS 1 retained deletes. Deliver it asynchronously, like
        // a real socket, so production code has stored the in-flight packet id first.
        if (this.autoPuback !== false && (frame[0] >> 4) === 3 && ((frame[0] >> 1) & 3) === 1) {
          let at = 1, mult = 1, digit;
          do { digit = frame[at++]; mult *= 128; } while (digit & 0x80);
          const topicLen = (frame[at] << 8) | frame[at + 1];
          const idAt = at + 2 + topicLen;
          const id = (frame[idAt] << 8) | frame[idAt + 1];
          setTimeout(() => this.deliver([0x40, 0x02, id >> 8, id & 0xff]), 0);
        }
      }
      close() { this.onclose && this.onclose(); }
      deliver(bytes) { this.onmessage && this.onmessage({ data: new Uint8Array(bytes).buffer }); }
      connack() { this.deliver([0x20, 2, 0, 0]); }
    };
    window.WebSocket = window.StubSocket;
  });
}

async function boot(page) {
  await installStub(page);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && window.NavAid.followMe));
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
    // The publish frame: high nibble 3 = PUBLISH. The low bits carry RETAIN, so match the type.
    const pub = window.__sent.find(f => (f[0] & 0xf0) === 0x30 && f.length > 4);
    const bytes = new Uint8Array(pub);
    const len = F._readLength(bytes, 1);
    const topicLen = (bytes[len.next] << 8) | bytes[len.next + 1];
    const topic = new TextDecoder().decode(bytes.subarray(len.next + 2, len.next + 2 + topicLen));
    const payload = bytes.subarray(len.next + 2 + topicLen, len.next + len.value);
    const asText = new TextDecoder().decode(payload);

    const right = await F._open(await F.importKey(F._b64url.to(rawKey)), payload);
    const wrong = await F._open(await F.importKey(F.randomBytes(32)), payload);
    await F.stop();
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
    const pub = new Uint8Array(window.__sent.find(f => (f[0] & 0xf0) === 0x30 && f.length > 4));

    const url = new URL(link);
    const state = await F.watch(url.searchParams.get('follow'), url.hash.replace(/^#k=/, ''));
    window.__sockets[1].connack();
    await new Promise(r => setTimeout(r, 10));
    const subscribed = window.__sent.some(f => f[0] === 0x82);   // SUBSCRIBE, flags 0x02
    window.__sockets[1].deliver(pub);                            // the broker relays it back
    await new Promise(r => setTimeout(r, 30));
    const out = { subscribed, connected: state.connected, fix: state.fix };
    F.unwatch(); await F.stop();
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
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.stop();
    const after = { sharing: F.sharing(), same: a === b, sockets: window.__sockets.length };
    // ...and a new session is a NEW link: nothing survives the flight it belonged to.
    const c = await F.start('4X-CDE');
    const reused = c === a;
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.stop();
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
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.stop();
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
    const pub = new Uint8Array(window.__sent.find(f => (f[0] & 0xf0) === 0x30 && f.length > 4));
    const wire = new TextDecoder().decode(pub);
    const url = new URL(link);
    const key = await F.importKey(F._b64url.to(url.hash.replace(/^#k=/, '')));
    const len = F._readLength(pub, 1);
    const topicLen = (pub[len.next] << 8) | pub[len.next + 1];
    const msg = await F._open(key, pub.subarray(len.next + 2 + topicLen, len.next + len.value));
    await F.stop();
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
    const pub = new Uint8Array(window.__sent.find(f => (f[0] & 0xf0) === 0x30 && f.length > 4));
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
    F.viewerStop(); await F.stop();
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
    const pub = new Uint8Array(window.__sent.find(f => (f[0] & 0xf0) === 0x30 && f.length > 4));
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
    F.viewerStop(); await F.stop();
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

// Retained, so a viewer opening mid-flight sees where the aeroplane is at once rather than
// waiting for the next publish - and cleared on stop, so the broker does not hand out the
// final position of a flight that ended days ago.
test('the position is retained while sharing and cleared when it stops', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    await F.start('4X-RET');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.publish({ lat: 32, lng: 34.9 });
    const pub = window.__sent.find(f => (f[0] & 0xf0) === 0x30 && f.length > 4);
    const retainBit = pub[0] & 1;
    window.__sent.length = 0;
    const stopped = F.stop();
    await new Promise(r => setTimeout(r, 10));
    const clear = window.__sent.find(f => (f[0] & 0xf0) === 0x30);
    const len = F._readLength(new Uint8Array(clear), 1);
    const topicLen = (clear[len.next] << 8) | clear[len.next + 1];
    const payloadLen = len.value - 2 - topicLen - 2; // QoS 1 packet id
    window.WebSocket = orig;
    await stopped;
    return { retainBit, clearRetain: clear[0] & 1,
             clearQos: (clear[0] >> 1) & 3, payloadLen };
  });
  expect(got.retainBit).toBe(1);
  expect(got.clearRetain).toBe(1);
  expect(got.clearQos).toBe(1);
  expect(got.payloadLen).toBe(0);
});

test('an encryption already in flight cannot republish after Stop', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-RACE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sent.length = 0;

    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let release;
    Object.defineProperty(crypto.subtle, 'encrypt', {
      configurable: true,
      value: (...args) => new Promise((resolve, reject) => {
        release = () => originalEncrypt(...args).then(resolve, reject);
      }),
    });
    const publishing = F.publish({ lat: 32.2, lng: 34.9 });
    while (!release) await new Promise(r => setTimeout(r, 0));
    window.__sockets[0].autoPuback = false;
    const stopping = F.stop();
    await new Promise(r => setTimeout(r, 10));
    const clearIndex = window.__sent.findIndex(f =>
      (f[0] & 0xf0) === 0x30 && ((f[0] >> 1) & 3) === 1);
    const clear = new Uint8Array(window.__sent[clearIndex]);
    const len = F._readLength(clear, 1);
    const topicLen = (clear[len.next] << 8) | clear[len.next + 1];
    const idAt = len.next + 2 + topicLen;
    release();
    const published = await publishing;
    await new Promise(r => setTimeout(r, 10));
    const statusBeforeAck = F.status();
    const pendingBeforeAck = JSON.parse(
      localStorage.getItem('navaid.followMeSession')).pendingStop;
    const afterDelete = window.__sent.slice(clearIndex + 1);
    window.__sockets[0].deliver([0x40, 0x02, clear[idAt], clear[idAt + 1]]);
    await stopping;
    delete crypto.subtle.encrypt;
    return {
      published,
      statusBeforeAck,
      pendingBeforeAck,
      statusAfterAck: F.status(),
      storedAfterAck: localStorage.getItem('navaid.followMeSession'),
      retainedPayloads: afterDelete.filter(f =>
        (f[0] & 0xf0) === 0x30 && (f[0] & 1) && ((f[0] >> 1) & 3) === 0).length,
    };
  });
  expect(got).toEqual({
    published: false,
    statusBeforeAck: 'stopping',
    pendingBeforeAck: true,
    statusAfterAck: 'idle',
    storedAfterAck: null,
    retainedPayloads: 0,
  });
});

test('Stop falls back to removing consent when its pending-state write fails', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-REVOKE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
  });

  const other = await context.newPage();
  await boot(other);
  await other.waitForFunction(() => NavAid.followMe.sharing());
  await other.evaluate(async () => {
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
  });

  const stopped = await page.evaluate(async () => {
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'navaid.followMeSession' && JSON.parse(value).pendingStop) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      return realSet.call(this, key, value);
    };
    const result = await NavAid.followMe.stop();
    Storage.prototype.setItem = realSet;
    return { result, stored: localStorage.getItem('navaid.followMeSession') };
  });
  expect(stopped).toEqual({ result: { pending: false }, stored: null });
  await other.waitForFunction(() => NavAid.followMe.status() === 'idle');
  expect(await other.evaluate(() => NavAid.followMe.publish({ lat: 32.1, lng: 34.8 }))).toBe(false);

  const reload = await context.newPage();
  await boot(reload);
  await reload.waitForTimeout(50);
  expect(await reload.evaluate(() => ({
    status: NavAid.followMe.status(),
    sockets: window.__sockets.length,
  }))).toEqual({ status: 'idle', sockets: 0 });
  await Promise.all([other.close(), reload.close()]);
});

test('Stop stays pending until an unreadable session store can be revoked', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-STORE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sockets[0].autoPuback = false;

    const real = {
      get: Storage.prototype.getItem,
      set: Storage.prototype.setItem,
      remove: Storage.prototype.removeItem,
    };
    window.__blockFollowStorage = true;
    for (const [name, method] of [['getItem', 'get'], ['setItem', 'set'], ['removeItem', 'remove']]) {
      Storage.prototype[name] = function (key, ...args) {
        if (window.__blockFollowStorage && key === 'navaid.followMeSession') {
          throw new DOMException('blocked', 'SecurityError');
        }
        return real[method].call(this, key, ...args);
      };
    }
    window.__stopSettled = false;
    window.__storageStop = NavAid.followMe.stop().then(result => {
      window.__stopSettled = true;
      return result;
    });
    await new Promise(r => setTimeout(r, 20));
    const F = NavAid.followMe;
    const frame = new Uint8Array(window.__sent.find(f =>
      (f[0] & 0xf0) === 0x30 && ((f[0] >> 1) & 3) === 1));
    const len = F._readLength(frame, 1);
    const topicLen = (frame[len.next] << 8) | frame[len.next + 1];
    const at = len.next + 2 + topicLen;
    window.__sockets[0].deliver([0x40, 0x02, frame[at], frame[at + 1]]);
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => ({
    settled: window.__stopSettled,
    status: NavAid.followMe.status(),
  }))).toEqual({ settled: false, status: 'stopping' });

  await page.evaluate(() => { window.__blockFollowStorage = false; });
  await page.waitForFunction(() => window.__stopSettled, null, { timeout: 3000 });
  expect(await page.evaluate(async () => ({
    result: await window.__storageStop,
    status: NavAid.followMe.status(),
    stored: localStorage.getItem('navaid.followMeSession'),
  }))).toEqual({ result: { pending: false }, status: 'idle', stored: null });

  const reload = await context.newPage();
  await boot(reload);
  await reload.waitForTimeout(50);
  expect(await reload.evaluate(() => NavAid.followMe.status())).toBe('idle');
  await reload.close();
});

test('Stop revokes an in-flight publisher in another NavAid tab', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-TABS');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
  });

  const other = await context.newPage();
  await boot(other);
  await other.waitForFunction(() => NavAid.followMe.sharing());
  await other.evaluate(async () => {
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sent.length = 0;
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    window.__releaseFollowEncryption = null;
    Object.defineProperty(crypto.subtle, 'encrypt', {
      configurable: true,
      value: (...args) => new Promise((resolve, reject) => {
        window.__releaseFollowEncryption = () => originalEncrypt(...args).then(resolve, reject);
      }),
    });
    window.__otherPublish = NavAid.followMe.publish({ lat: 32.3, lng: 34.8 });
    while (!window.__releaseFollowEncryption) await new Promise(r => setTimeout(r, 0));
  });

  await page.evaluate(() => NavAid.followMe.stop());
  const got = await other.evaluate(async () => {
    window.__releaseFollowEncryption();
    const published = await window.__otherPublish;
    await new Promise(r => setTimeout(r, 20));
    delete crypto.subtle.encrypt;
    return {
      published,
      status: NavAid.followMe.status(),
      retainedPositions: window.__sent.filter(f =>
        (f[0] & 0xf0) === 0x30 && (f[0] & 1) && ((f[0] >> 1) & 3) === 0).length,
    };
  });
  expect(got).toEqual({ published: false, status: 'idle', retainedPositions: 0 });
  await other.close();
});

test('simultaneous Stops keep one cleanup owner through PUBACK', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-DUAL');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sockets[0].autoPuback = false;
  });
  const other = await context.newPage();
  await boot(other);
  await other.waitForFunction(() => NavAid.followMe.sharing());
  await other.evaluate(async () => {
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sockets[0].autoPuback = false;
  });

  await Promise.all([
    page.evaluate(() => { window.__stopResult = NavAid.followMe.stop(); }),
    other.evaluate(() => { window.__stopResult = NavAid.followMe.stop(); }),
  ]);
  await page.waitForTimeout(60);
  const statuses = [await page.evaluate(() => NavAid.followMe.status()),
                    await other.evaluate(() => NavAid.followMe.status())];
  expect(statuses.filter(status => status === 'stopping')).toHaveLength(1);
  const owner = statuses[0] === 'stopping' ? page : other;
  const packetId = await owner.evaluate(() => {
    const F = NavAid.followMe;
    const frame = new Uint8Array(window.__sent.find(f =>
      (f[0] & 0xf0) === 0x30 && ((f[0] >> 1) & 3) === 1));
    const len = F._readLength(frame, 1);
    const topicLen = (frame[len.next] << 8) | frame[len.next + 1];
    const at = len.next + 2 + topicLen;
    return [frame[at], frame[at + 1]];
  });
  await owner.evaluate(([hi, lo]) => {
    window.__sockets[0].deliver([0x40, 0x02, hi, lo]);
  }, packetId);
  const results = await Promise.all([
    page.evaluate(() => window.__stopResult),
    other.evaluate(() => window.__stopResult),
  ]);
  // The second scripted call may begin just after it receives revocation and then correctly
  // report "already stopped" instead of "delegated". The invariant is one live owner before
  // PUBACK and completion in both tabs afterward, not a particular scheduler-dependent result.
  expect(results.every(result => typeof result.pending === 'boolean')).toBe(true);
  expect(results.some(result => result.pending === false)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('navaid.followMeSession'))).toBe(null);
  expect(await page.evaluate(() => NavAid.followMe.status())).toBe('idle');
  expect(await other.evaluate(() => NavAid.followMe.status())).toBe('idle');
  await other.close();
});

test('Stop serializes with a session still initializing in another tab', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-START');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
  });

  const other = await context.newPage();
  await other.addInitScript(() => {
    const originalImport = crypto.subtle.importKey.bind(crypto.subtle);
    window.__releaseFollowImport = null;
    Object.defineProperty(crypto.subtle, 'importKey', {
      configurable: true,
      value: (...args) => new Promise((resolve, reject) => {
        window.__releaseFollowImport = () => originalImport(...args).then(resolve, reject);
      }),
    });
  });
  await boot(other);
  await other.waitForFunction(() => typeof window.__releaseFollowImport === 'function');

  await page.evaluate(() => {
    window.__stopFinished = false;
    NavAid.followMe.stop().then(() => { window.__stopFinished = true; });
  });
  await new Promise(r => setTimeout(r, 30));
  expect(await page.evaluate(() => window.__stopFinished)).toBe(false);

  await other.evaluate(() => window.__releaseFollowImport());
  await page.waitForFunction(() => window.__stopFinished);
  await other.waitForFunction(() => NavAid.followMe.status() === 'idle');
  const got = await other.evaluate(() => ({
    status: NavAid.followMe.status(),
    stored: localStorage.getItem('navaid.followMeSession'),
  }));
  expect(got).toEqual({ status: 'idle', stored: null });
  await other.close();
});

test('two publisher tabs allocate strictly increasing sequence values', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-SEQ');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
  });
  const other = await context.newPage();
  await boot(other);
  await other.waitForFunction(() => NavAid.followMe.sharing());
  await other.evaluate(async () => {
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
  });

  for (const [tab, label] of [[page, 'a'], [other, 'b']]) {
    await tab.evaluate((name) => {
      window.__sent.length = 0;
      Date.now = () => 2_000_000;
      const socket = window.__sockets[0];
      const send = socket.send.bind(socket);
      socket.send = bytes => {
        const frame = new Uint8Array(bytes);
        if ((frame[0] & 0xf0) === 0x30 && ((frame[0] >> 1) & 3) === 0) {
          const order = JSON.parse(localStorage.getItem('test.followWire') || '[]');
          order.push(name);
          localStorage.setItem('test.followWire', JSON.stringify(order));
        }
        send(bytes);
      };
      setTune('followMeRateSec', 1);
    }, label);
  }
  await page.evaluate(() => { window.__publishResult = NavAid.followMe.publish({ lat: 32.1, lng: 34.8 }); });
  await other.evaluate(() => { window.__publishResult = NavAid.followMe.publish({ lat: 32.2, lng: 34.9 }); });
  expect(await page.evaluate(() => window.__publishResult)).toBe(true);
  expect(await other.evaluate(() => window.__publishResult)).toBe(true);

  const seqByTab = {};
  for (const [tab, label] of [[page, 'a'], [other, 'b']]) {
    seqByTab[label] = await tab.evaluate(async () => {
      const F = NavAid.followMe;
      const frame = new Uint8Array(window.__sent.find(f => (f[0] & 0xf0) === 0x30));
      const len = F._readLength(frame, 1);
      const topicLen = (frame[len.next] << 8) | frame[len.next + 1];
      const payload = frame.subarray(len.next + 2 + topicLen, len.next + len.value);
      const stored = JSON.parse(localStorage.getItem('navaid.followMeSession'));
      const key = await F.importKey(F._b64url.to(stored.k));
      return (await F._open(key, payload)).seq;
    });
  }
  const wire = await page.evaluate(() => JSON.parse(localStorage.getItem('test.followWire')));
  expect(wire).toHaveLength(2);
  expect(seqByTab[wire[1]]).toBeGreaterThan(seqByTab[wire[0]]);
  await page.evaluate(() => NavAid.followMe.stop());
  await other.close();
});

test('only one tab resumes pending cleanup and a stale cleaner cannot erase a new session', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-CLEAN');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sockets[0].autoPuback = false;
    NavAid.followMe.stop();
  });
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('navaid.followMeSession') || 'null');
    return s && s.pendingStop;
  });
  await page.close();

  const a = await context.newPage();
  const b = await context.newPage();
  await Promise.all([boot(a), boot(b)]);
  await a.waitForTimeout(80);
  const counts = [await a.evaluate(() => window.__sockets.length),
                  await b.evaluate(() => window.__sockets.length)];
  const owner = counts[0] ? a : b;
  expect(counts[0] + counts[1]).toBe(1);

  const packetId = await owner.evaluate(async () => {
    const socket = window.__sockets[0];
    socket.autoPuback = false;
    socket.connack();
    await new Promise(r => setTimeout(r, 20));
    const F = NavAid.followMe;
    const frame = new Uint8Array(window.__sent.find(f =>
      (f[0] & 0xf0) === 0x30 && ((f[0] >> 1) & 3) === 1));
    const len = F._readLength(frame, 1);
    const topicLen = (frame[len.next] << 8) | frame[len.next + 1];
    const at = len.next + 2 + topicLen;
    return [frame[at], frame[at + 1]];
  });
  const replacement = await owner.evaluate(() => {
    const F = NavAid.followMe;
    const record = {
      id: F._b64url.from(F.randomBytes(16)),
      k: F._b64url.from(F.randomBytes(32)),
      reg: '4X-NEW', at: Date.now(), seq: 0, on: true, pendingStop: false,
    };
    // Same-document writes do not emit a storage event. This directly exercises the
    // acknowledgement guard against a cleanup owner whose shared record was replaced.
    localStorage.setItem('navaid.followMeSession', JSON.stringify(record));
    return record;
  });
  await owner.evaluate(([hi, lo]) => {
    window.__sockets[0].deliver([0x40, 0x02, hi, lo]);
  }, packetId);
  await owner.waitForFunction(() => NavAid.followMe.status() === 'idle');
  expect(await owner.evaluate(() => JSON.parse(
    localStorage.getItem('navaid.followMeSession')))).toEqual(replacement);
  await owner.evaluate(() => localStorage.removeItem('navaid.followMeSession'));
  await Promise.all([a.close(), b.close()]);
});

test('publisher CONNECT installs a retained empty Last Will', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-WILL');
    await new Promise(r => setTimeout(r, 10));
    const frame = new Uint8Array(window.__sent[0]);
    const len = F._readLength(frame, 1);
    let at = len.next;
    const protocolLen = (frame[at] << 8) | frame[at + 1];
    at += 2 + protocolLen;
    at += 1; // protocol level
    const flags = frame[at++];
    at += 2; // keepalive
    const clientLen = (frame[at] << 8) | frame[at + 1];
    at += 2 + clientLen;
    const willTopicLen = (frame[at] << 8) | frame[at + 1];
    const willTopic = new TextDecoder().decode(frame.subarray(at + 2, at + 2 + willTopicLen));
    at += 2 + willTopicLen;
    const willPayloadLen = (frame[at] << 8) | frame[at + 1];
    return { will: !!(flags & 0x04), retained: !!(flags & 0x20), willTopic, willPayloadLen };
  });
  expect(got).toEqual({
    will: true, retained: true, willTopic: expect.stringMatching(/^navaid\/follow\//),
    willPayloadLen: 0,
  });
});

// The viewer must start from the link alone. It boots on DOMContentLoaded and the tuning
// gist lands after that, so a feature-flag check there answered with the baked-in false and
// the link opened an ordinary map - which is exactly what happened in the air.
test('the viewer boot does not wait on the gist', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const src = await page.evaluate(async () => (await fetch('app/followme.js')).text());
  const at = src.indexOf('function followMeBoot');
  const boot = src.slice(at, at + 900);
  expect(at).toBeGreaterThan(0);
  // Comments stripped first: the block explains the trap by naming the call, and prose
  // about a guard is not a guard.
  const code = boot.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  expect(code).toContain('followMeLinkParams');
  expect(code).not.toContain('featureFollowMe');
});

test('opening a follower link skips route onboarding and locks route editing', async ({ page }) => {
  await installStub(page);
  const key = 'A'.repeat(43); // 32 zero bytes, base64url without padding
  await page.goto('?lang=en&nogist&follow=test-viewer#k=' + key);
  await page.waitForFunction(() => !!(window.NavAid && NavAid.followMe.viewing()));

  await expect(page.locator('#empty-route-hint')).toHaveCount(0);
  const before = await page.evaluate(() => ({
    primed: routePrimingArmed(),
    locked: routeEditLocked(),
    waypoints: state.waypoints.length,
  }));
  expect(before).toEqual({ primed: false, locked: true, waypoints: 0 });

  await page.evaluate(() => {
    const p = L.point(240, 260);
    map.fire('click', { containerPoint: p, latlng: map.containerPointToLatLng(p) });
  });
  expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
});

// A follower on the ground is watching an aeroplane, not a dot: the banner has to say how
// high and how fast, in feet and knots, and where. The fix carries metres and knots.
test('the banner reads out altitude, speed, track and position', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const link = await F.start('4X-ABC');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    const seen = [];
    const url = new URL(link);
    await F.viewerStart({ search: url.search, hash: url.hash });
    window.__sockets[1].connack();
    await new Promise(r => setTimeout(r, 10));
    // Two fixes: one complete, one with no altitude and no speed at all.
    for (const fix of [{ lat: 32.1, lng: 34.8, alt: 610, kt: 95, trk: 7 },
                       { lat: 32.2, lng: 34.85, trk: 7 }]) {
      window.__sent.length = 0;
      // The publisher rate-limits itself; the floor is one second, so wait it out rather
      // than reach into its state.
      setTune('followMeRateSec', 1);
      await new Promise(r => setTimeout(r, 1100));
      await F.publish(fix);
      window.__sockets[1].deliver(new Uint8Array(window.__sent.find(f => (f[0] & 0xf0) === 0x30 && f.length > 4)));
      await new Promise(r => setTimeout(r, 40));
      seen.push(document.getElementById('follow-me-banner').textContent);
    }
    F.viewerStop(); await F.stop();
    window.WebSocket = orig;
    return seen;
  });
  expect(got[0]).toContain('2001 ft');          // 610 m read back in feet
  expect(got[0]).toContain('95 kt');
  expect(got[0]).toContain('007°');        // track, three digits like a heading
  expect(got[0]).toContain('32.1000, 34.8000');
  expect(got[1]).not.toMatch(/ft|kt/);          // nothing invented for what was not sent
  expect(got[1]).toContain('32.2000');
});

// The cockpit case: the socket dies mid-flight (screen lock, cell handover, doze). Silence
// after that would leave the pilot believing they are still being followed.
test('a dropped socket reconnects and re-subscribes; stopping does not', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const link = await F.start('4X-RCN');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    const url = new URL(link);
    await F.viewerStart({ search: url.search, hash: url.hash });
    window.__sockets[1].connack();
    await new Promise(r => setTimeout(r, 10));
    const subs = () => window.__sent.filter(f => (f[0] & 0xf0) === 0x80).length;
    const before = { sockets: window.__sockets.length, subs: subs() };

    window.__sockets[1].close();                  // the drop
    await new Promise(r => setTimeout(r, 2300));  // first backoff step is 2s
    const grew = window.__sockets.length;
    window.__sockets[grew - 1].connack();
    await new Promise(r => setTimeout(r, 20));
    const after = { sockets: grew, subs: subs() };

    F.viewerStop(); await F.stop();
    const closed = window.__sockets.length;
    window.__sockets[grew - 1].close();           // a close that stop() already asked for
    await new Promise(r => setTimeout(r, 2300));
    const settled = window.__sockets.length;
    window.WebSocket = orig;
    return { before, after, closed, settled };
  });
  expect(got.after.sockets).toBe(got.before.sockets + 1);  // it came back...
  expect(got.after.subs).toBe(got.before.subs + 1);        // ...and re-subscribed
  expect(got.settled).toBe(got.closed);                    // stop means stop
});

// A share that dies with the app is a share nobody can rely on: the pilot is at 2000 feet
// and is not going to re-send a link. These four tests pin what survives and what does not.
async function shareOnce(page, code) {
  return page.evaluate(async (reg) => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const link = await F.start(reg);
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.stop();
    window.WebSocket = orig;
    return link;
  }, code);
}

test('sharing the same aeroplane again resumes the same link', async ({ page }) => {
  await boot(page);
  // A crash is a stop that never ran, so the stored session is what a restart reads.
  const first = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const link = await F.start('4X-KEEP');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    window.WebSocket = orig;
    return link;
  });
  await page.reload();                            // the restart
  await page.waitForFunction(() => !!(window.NavAid && window.NavAid.followMe));
  // Boot resumes it by itself: the pilot does not have to notice anything happened.
  await page.waitForFunction(() => NavAid.followMe.sharing(), null, { timeout: 3000 });
  const again = await shareOnce(page, '4X-KEEP');
  expect(again).toBe(first);                      // same topic AND same key
});

test('automatic resume says sharing only after the broker connects', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    await NavAid.followMe.start('4X-RESUME');
  });
  await page.reload();
  await page.waitForFunction(() => !!(window.NavAid && window.NavAid.followMe));
  const before = await page.evaluate(async () => {
    window.__resumeToasts = [];
    window.showToast = message => window.__resumeToasts.push(String(message));
    await new Promise(r => setTimeout(r, 30));
    return { status: NavAid.followMe.status(), toasts: window.__resumeToasts.slice() };
  });
  expect(before.status).toBe('connecting');
  expect(before.toasts.some(text => /still sharing/i.test(text))).toBe(false);
  const after = await page.evaluate(async () => {
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 30));
    const result = { status: NavAid.followMe.status(), toasts: window.__resumeToasts.slice() };
    await NavAid.followMe.stop();
    return result;
  });
  expect(after.status).toBe('connected');
  expect(after.toasts.some(text => /still sharing/i.test(text))).toBe(true);
});

test('a different aircraft code never inherits the previous link', async ({ page }) => {
  await boot(page);
  const a = await shareOnce(page, '4X-AAA');
  const b = await shareOnce(page, '4X-BBB');
  expect(b).not.toBe(a);
});

test('stopping kills the link, and an expired session is not resumed', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const first = await F.start('4X-DEAD');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.stop();                               // deliberate: the key goes with it
    const afterStop = !!F._stored();
    const resumedAfterStop = await F.resume();

    // Now a session that was never stopped, but is older than the window.
    const second = await F.start('4X-DEAD');
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 10));
    const stored = JSON.parse(localStorage.getItem('navaid.followMeSession'));
    localStorage.setItem('navaid.followMeSession',
      JSON.stringify({ ...stored, at: Date.now() - 13 * 3600000 }));   // window is 12h
    const expired = !!F._stored();
    const third = await F.start('4X-DEAD');       // already sharing: same session
    await F.stop();
    window.WebSocket = orig;
    return { differs: second !== first, afterStop, resumedAfterStop, expired, third: third === second };
  });
  expect(got.afterStop).toBe(false);              // nothing left to resume
  expect(got.resumedAfterStop).toBe(null);
  expect(got.differs).toBe(true);                 // a stopped link never comes back
  expect(got.expired).toBe(false);                // 13h later it is not offered either
  expect(got.third).toBe(true);
});

test('the persistent-link flag keeps one link across a deliberate stop', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    setTune('featureFollowMePersist', true);
    const orig = window.WebSocket;
    window.WebSocket = window.StubSocket;
    const first = await F.start('4X-CLUB');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.stop();
    const kept = F._stored();
    // Stopped on purpose, so a restart must NOT start publishing again by itself...
    const resumed = await F.resume();
    // ...but the link the club already has still works next flight.
    const second = await F.start('4X-CLUB');
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 10));
    // And the escape hatch throws it away.
    const third = await F.newLink();
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.stop();
    window.WebSocket = orig;
    return { same: second === first, kept: !!kept, on: kept && kept.on, resumed, fresh: third !== first };
  });
  expect(got.kept).toBe(true);
  expect(got.on).toBe(false);                     // kept, but marked not sharing
  expect(got.resumed).toBe(null);
  expect(got.same).toBe(true);
  expect(got.fresh).toBe(true);
});

// A retained MQTT packet can arrive minutes after publication. Reconnects can replay an
// older retained packet after a newer live one. Receipt time is not aircraft time.
// The encrypted publisher timestamp is the honest age, and packet order must advance.
test('retained positions keep their publisher age and replays cannot become fresh', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const realNow = Date.now;
    const link = await F.start('4X-TIME');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    setTune('followMeRateSec', 1);

    // Produce two valid encrypted frames from the real publisher, ten minutes apart.
    const present = realNow();
    Date.now = () => present - 10 * 60 * 1000;
    await F.publish({ lat: 31.1, lng: 34.1 });
    const oldFrame = new Uint8Array(window.__sent.find(
      f => (f[0] & 0xf0) === 0x30 && f.length > 4));
    window.__sent.length = 0;
    Date.now = () => present;
    await F.publish({ lat: 32.2, lng: 35.2 });
    const newFrame = new Uint8Array(window.__sent.find(
      f => (f[0] & 0xf0) === 0x30 && f.length > 4));
    Date.now = realNow;

    const url = new URL(link);
    const state = await F.watch(url.searchParams.get('follow'), url.hash.replace(/^#k=/, ''));
    window.__sockets[1].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sockets[1].deliver(newFrame);
    await new Promise(r => setTimeout(r, 30));
    const afterNew = { lat: state.fix && state.fix.lat, at: state.at };
    window.__sockets[1].deliver(oldFrame);          // reconnect/re retained replay
    await new Promise(r => setTimeout(r, 30));
    const afterReplay = { lat: state.fix && state.fix.lat, at: state.at };
    F.unwatch(); await F.stop();
    return { present, oldPublishedAt: present - 10 * 60 * 1000, afterNew, afterReplay };
  });
  expect(got.afterNew).toEqual({ lat: 32.2, at: got.present });
  expect(got.afterReplay).toEqual(got.afterNew);
  expect(got.afterReplay.at).not.toBe(got.oldPublishedAt);
});

test('a new viewer accepts timestamp-ordered packets from an older publisher', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const link = await F.start('4X-OLD');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    const url = new URL(link);
    const id = url.searchParams.get('follow');
    const rawKey = url.hash.replace(/^#k=/, '');
    const topic = new TextEncoder().encode(F.topicFor(id));
    const key = await F.importKey(F._b64url.to(rawKey));
    const makeFrame = async (fix) => {
      const payload = await F._seal(key, fix);
      const body = new Uint8Array(2 + topic.length + payload.length);
      body[0] = topic.length >> 8; body[1] = topic.length & 255;
      body.set(topic, 2); body.set(payload, 2 + topic.length);
      const lengths = F._encodeLength(body.length);
      const frame = new Uint8Array(1 + lengths.length + body.length);
      frame[0] = 0x31; frame.set(lengths, 1); frame.set(body, 1 + lengths.length);
      return frame;
    };
    const sentAt = Date.now() - 1000;
    const newer = await makeFrame({ reg: '4X-OLD', lat: 32.4, lng: 34.8, t: sentAt });
    const older = await makeFrame({ reg: '4X-OLD', lat: 31.9, lng: 35.1, t: sentAt - 1000 });

    const state = await F.watch(id, rawKey);
    window.__sockets[1].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sockets[1].deliver(newer);
    await new Promise(r => setTimeout(r, 30));
    window.__sockets[1].deliver(older);
    await new Promise(r => setTimeout(r, 30));
    const out = { fix: state.fix, at: state.at, sentAt };
    F.unwatch(); await F.stop();
    return out;
  });
  expect(got.fix).toMatchObject({ reg: '4X-OLD', lat: 32.4, lng: 34.8 });
  expect(got.at).toBe(got.sentAt);
});

test('the publisher sequence survives an app restart', async ({ page }) => {
  await boot(page);
  const first = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-SEQ');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await F.publish({ lat: 32.1, lng: 34.9 });
    return JSON.parse(localStorage.getItem('navaid.followMeSession')).seq;
  });
  await page.reload();
  await page.waitForFunction(() => !!(window.NavAid && window.NavAid.followMe));
  await page.waitForFunction(() => NavAid.followMe.sharing());
  const second = await page.evaluate(async () => {
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    await NavAid.followMe.publish({ lat: 32.2, lng: 35.0 });
    const seq = JSON.parse(localStorage.getItem('navaid.followMeSession')).seq;
    await NavAid.followMe.stop();
    return seq;
  });
  expect(second).toBeGreaterThan(first);
});

// MQTT can only delete a retained value while connected. If Stop happens in a tunnel or
// cell handover, throwing away the topic/key makes cleanup impossible forever. The local
// record must keep the capability needed to retry, but must not remain marked as sharing.
test('stopping while disconnected retries and completes retained-position cleanup', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-CLEAN');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sockets[0].close();                    // client.ready is now false
    const toasts = [];
    window.showToast = (message) => toasts.push(String(message));
    window.gpsLiveOn = true;
    document.getElementById('follow-me').click();   // pilot presses Stop
    await new Promise(r => setTimeout(r, 20));
    const pending = JSON.parse(localStorage.getItem('navaid.followMeSession') || 'null');
    await new Promise(r => setTimeout(r, 2300));
    window.__sockets[1].autoPuback = false;
    window.__sockets[1].connack();                 // reconnect completes the retained delete
    await new Promise(r => setTimeout(r, 30));
    const beforeAck = {
      status: F.status(),
      stored: JSON.parse(localStorage.getItem('navaid.followMeSession') || 'null'),
      deadToast: toasts.some(text => /link is dead/i.test(text)),
    };
    const clear = new Uint8Array(window.__sent.find(f =>
      (f[0] & 0xf0) === 0x30 && ((f[0] >> 1) & 3) === 1));
    const len = F._readLength(clear, 1);
    const topicLen = (clear[len.next] << 8) | clear[len.next + 1];
    const idAt = len.next + 2 + topicLen;
    window.__sockets[1].deliver([0x40, 0x02, clear[idAt], clear[idAt + 1]]);
    await new Promise(r => setTimeout(r, 30));
    const cleared = localStorage.getItem('navaid.followMeSession');
    const retainedDelete = window.__sent.some(f =>
      (f[0] & 0xf1) === 0x31 && f.length > 4 && f[f.length - 1] !== 0);
    window.gpsLiveOn = false;
    return { sharing: F.sharing(), pending, beforeAck, cleared, retainedDelete, toasts };
  });
  expect(got.sharing).toBe(false);
  expect(got.pending).toMatchObject({ reg: '4X-CLEAN', pendingStop: true, on: false });
  expect(got.pending.id).toBeTruthy();
  expect(got.pending.k).toBeTruthy();
  expect(got.beforeAck.status).toBe('stopping');
  expect(got.beforeAck.stored).toMatchObject({ pendingStop: true, on: false });
  expect(got.beforeAck.deadToast).toBe(false);
  expect(got.cleared).toBe(null);
  expect(got.retainedDelete).toBe(true);
  expect(got.toasts.some(text => /link is dead/i.test(text))).toBe(true);
});

// Simulator-only flights are a supported position source. Offering Follow me there while
// only the Geolocation handler publishes leaves a plausible-looking link that never moves.
test('a simulator fix is published when Follow me is sharing', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-SIM');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    window.__sent.length = 0;
    const originalRequest = window._simRequestData;
    window._simRequestData = async () => ({
      latitude: 32.12345, longitude: 34.98765, altitude: 2500,
      heading: 85, variation: 5, ias: 104,
    });
    window.simOn = true;
    await window._simFetch();
    await new Promise(r => setTimeout(r, 30));
    const published = window.__sent.some(f => (f[0] & 0xf0) === 0x30 && f.length > 4);
    window._simRequestData = originalRequest;
    window.simOn = false;
    F.stop();
    return published;
  });
  expect(got).toBe(true);
});

// A session exists before MQTT's CONNACK, and survives temporary disconnects. The cockpit
// label must describe those states instead of promising that positions are being shared.
test('the Follow me control distinguishes connecting and reconnecting from sharing', async ({ page }) => {
  await boot(page);
  const labels = await page.evaluate(async () => {
    const F = NavAid.followMe;
    window.gpsLiveOn = true;
    await F.start('4X-STATE');
    refreshFollowMeMapControl();
    const connecting = document.getElementById('follow-me-map').getAttribute('aria-label');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    refreshFollowMeMapControl();
    const connected = document.getElementById('follow-me-map').getAttribute('aria-label');
    window.__sockets[0].close();
    refreshFollowMeMapControl();
    const reconnecting = document.getElementById('follow-me-map').getAttribute('aria-label');
    F.stop();
    window.gpsLiveOn = false;
    return { connecting, connected, reconnecting };
  });
  expect(labels.connecting).toMatch(/connecting/i);
  expect(labels.connected).toMatch(/sharing/i);
  expect(labels.reconnecting).toMatch(/reconnecting/i);
});

test('a Stop delegated to another tab does not claim the link is dead', async ({ page }) => {
  await boot(page);
  const toasts = await page.evaluate(async () => {
    const F = NavAid.followMe;
    setTune('featureFollowMe', true);
    window.gpsLiveOn = true;
    await F.start('4X-PENDING');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 10));
    const realStop = F.stop.bind(F);
    F.stop = async () => ({ pending: true });
    const seen = [];
    window.showToast = message => seen.push(String(message));
    document.getElementById('follow-me').click();
    await new Promise(r => setTimeout(r, 30));
    F.stop = realStop;
    await F.stop();
    window.gpsLiveOn = false;
    return seen;
  });
  expect(toasts.some(text => /link is dead/i.test(text))).toBe(false);
  expect(toasts.some(text => /clearing the last position/i.test(text))).toBe(true);
});

// Dismissing the native share sheet is not a copy, and a denied clipboard write is not one
// either. Never tell a pilot a link reached the clipboard when both delivery paths failed.
test('failed native sharing and clipboard do not claim the link was copied', async ({ page }) => {
  await boot(page);
  const toasts = await page.evaluate(async () => {
    setTune('featureFollowMe', true);
    window.gpsLiveOn = true;
    window.prompt = () => '4X-NOCOPY';
    const seen = [];
    window.showToast = (message) => seen.push(String(message));
    Object.defineProperty(navigator, 'share', {
      configurable: true, value: async () => { throw new Error('cancelled'); },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async () => { throw new Error('denied'); } },
    });
    document.getElementById('follow-me').click();
    await new Promise(r => setTimeout(r, 80));
    if (NavAid.followMe.sharing()) {
      window.__sockets[0].connack();
      await new Promise(r => setTimeout(r, 10));
      await NavAid.followMe.stop();
    }
    window.gpsLiveOn = false;
    return seen;
  });
  expect(toasts).not.toContain('Follow-me link copied.');
  expect(toasts.some(text => /could not be shared/i.test(text))).toBe(true);
});

test('cancelling the native share sheet does not fall back to clipboard or show an error', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    setTune('featureFollowMe', true);
    window.gpsLiveOn = true;
    window.prompt = () => '4X-CANCEL';
    const toasts = [];
    let clipboardWrites = 0;
    window.showToast = message => toasts.push(String(message));
    Object.defineProperty(navigator, 'share', {
      configurable: true, value: async () => {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async () => { clipboardWrites++; } },
    });
    document.getElementById('follow-me').click();
    await new Promise(r => setTimeout(r, 80));
    if (NavAid.followMe.sharing()) {
      window.__sockets[0].connack();
      await new Promise(r => setTimeout(r, 10));
      await NavAid.followMe.stop();
    }
    window.gpsLiveOn = false;
    return { toasts, clipboardWrites };
  });
  expect(got.clipboardWrites).toBe(0);
  expect(got.toasts).toEqual([]);
});

test('storage failure refuses to create a link that cannot publish', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'navaid.followMeSession') throw new DOMException('full', 'QuotaExceededError');
      return realSet.call(this, key, value);
    };
    const link = await NavAid.followMe.start('4X-NOSTORE');
    Storage.prototype.setItem = realSet;
    return { link, status: NavAid.followMe.status() };
  });
  expect(got).toEqual({ link: null, status: 'idle' });
});

test('a truncated follower URL keeps ordinary route onboarding', async ({ page }) => {
  await installStub(page);
  await page.goto('?lang=en&nogist&follow=missing-key');
  await page.waitForFunction(() => typeof routePrimingArmed === 'function');
  expect(await page.evaluate(() => NavAid.followMe.viewing())).toBe(false);
  await expect(page.locator('#empty-route-hint')).toBeVisible();
  expect(await page.evaluate(() => routePrimingArmed())).toBe(true);
});
