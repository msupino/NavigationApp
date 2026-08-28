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
      send(bytes) { window.__sent.push(Array.from(new Uint8Array(bytes))); }
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
    const pub = new Uint8Array(window.__sent.find(f => (f[0] & 0xf0) === 0x30 && f.length > 4));

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
    const pub = new Uint8Array(window.__sent.find(f => (f[0] & 0xf0) === 0x30 && f.length > 4));
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
    F.stop();
    await new Promise(r => setTimeout(r, 10));
    const clear = window.__sent.find(f => (f[0] & 0xf0) === 0x30);
    const len = F._readLength(new Uint8Array(clear), 1);
    const topicLen = (clear[len.next] << 8) | clear[len.next + 1];
    const payloadLen = len.value - 2 - topicLen;
    window.WebSocket = orig;
    return { retainBit, clearRetain: clear[0] & 1, payloadLen };
  });
  expect(got.retainBit).toBe(1);
  expect(got.clearRetain).toBe(1);
  expect(got.payloadLen).toBe(0);
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
    F.viewerStop(); F.stop();
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

    F.viewerStop(); F.stop();
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
    F.stop();
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
    F.stop();                                     // deliberate: the key goes with it
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
    F.stop();
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
    F.stop();
    const kept = F._stored();
    // Stopped on purpose, so a restart must NOT start publishing again by itself...
    const resumed = await F.resume();
    // ...but the link the club already has still works next flight.
    const second = await F.start('4X-CLUB');
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 10));
    // And the escape hatch throws it away.
    const third = await F.newLink();
    F.stop();
    window.WebSocket = orig;
    return { same: second === first, kept: !!kept, on: kept && kept.on, resumed, fresh: third !== first };
  });
  expect(got.kept).toBe(true);
  expect(got.on).toBe(false);                     // kept, but marked not sharing
  expect(got.resumed).toBe(null);
  expect(got.same).toBe(true);
  expect(got.fresh).toBe(true);
});
