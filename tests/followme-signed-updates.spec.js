// @ts-check
// Who may WRITE to a Follow me topic.
//
// The AES key travels in the link so that everyone holding the link can READ -- and a
// symmetric key is both halves, so until now everyone holding the link could also publish a
// position under the pilot's aeroplane, and nothing on the receiving side could tell.
//
// Asymmetric ENCRYPTION does not fix that, which is the trap worth writing down: the viewer
// must decrypt, so the link must carry the decryption key, and from any standard private key
// the matching encryption key falls out. The property wanted is unforgeability, not secrecy,
// and that is a SIGNATURE: the private key never leaves the aeroplane's device, the link
// carries only the public half, and a viewer verifies what it decrypts.
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

// A PUBLISH frame's payload, off the wire, for the position topic.
const publishedFix = () => `(() => {
  const f = window.__sent.filter(f => (f[0] >> 4) === 3 && f.length > 4).map(f => {
    let at = 1, digit;
    do { digit = f[at++]; } while (digit & 0x80);
    const len = (f[at] << 8) | f[at + 1];
    const topic = String.fromCharCode(...f.slice(at + 2, at + 2 + len));
    let body = at + 2 + len;
    if (((f[0] >> 1) & 3) > 0) body += 2;           // qos > 0 carries a packet id
    return { topic, payload: f.slice(body) };
  }).filter(p => !p.topic.endsWith('/route') && p.payload.length > 13);
  return f[f.length - 1] || null;
})()`;

test('the link carries a public key, and the private one never leaves the device', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const link = await NavAid.followMe.start('4X-SIG');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 20));
    const stored = JSON.parse(localStorage.getItem('navaid.followMeSession') || '{}');
    return { link, hasPrivate: !!(stored.sk && stored.sk.d), pub: stored.v,
             linkHasD: link.indexOf(stored.sk && stored.sk.d ? stored.sk.d : '@@@') > -1 };
  });
  expect(got.link).toMatch(/#k=[A-Za-z0-9\-_]+&v=[A-Za-z0-9\-_]+$/);
  expect(got.hasPrivate, 'no signing key was minted').toBe(true);
  expect(got.pub).toBeTruthy();
  expect(got.link).toContain('&v=' + got.pub);
  // The whole point: the half that can WRITE is not in the thing you hand people.
  expect(got.linkHasD, 'the private key is in the link').toBe(false);
});

test('a follower cannot forge a position with the key they were given', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const link = await F.start('4X-SIG');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 20));
    await F.publish({ lat: 32.0, lng: 34.9, trk: 90, kt: 100 });
    const url = new URL(link);
    // Exactly what a follower holds: the id and the AES key out of the link.
    const rawKey = Uint8Array.from(atob(/k=([^&]+)/.exec(url.hash)[1]
      .replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
    // ...and a position of their own, sealed with it. This is the packet that used to work.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = new TextEncoder().encode(JSON.stringify({
      reg: 'NOT THEM', lat: 31.0, lng: 35.5, t: Date.now(), seq: Date.now(),
    }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
    const forged = new Uint8Array(12 + ct.length);
    forged.set(iv, 0); forged.set(ct, 12);

    await F.viewerStart({ search: url.search, hash: url.hash });
    const sub = window.__sockets[window.__sockets.length - 1];
    sub.connack();
    await new Promise(r => setTimeout(r, 20));
    // Delivered the way the relay would deliver it.
    const topic = 'navaid/follow/' + new URLSearchParams(url.search).get('follow');
    const frame = [0x30];
    const rest = 2 + topic.length + forged.length;
    let n = rest; const len = [];
    do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; len.push(b); } while (n > 0);
    frame.push(...len, topic.length >> 8, topic.length & 0xff,
      ...[...topic].map(c => c.charCodeAt(0)), ...forged);
    sub.deliver(frame);
    await new Promise(r => setTimeout(r, 60));
    const state = F.watching();
    const out = { fix: state && state.fix, verified: state && state.verified };
    F.viewerStop(); await F.stop();
    return out;
  });
  expect(got.verified, 'this link is not verifying at all').toBe(true);
  expect(got.fix, 'a forged position was accepted').toBeNull();
});

test('the aeroplane\'s own packets still arrive', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const link = await F.start('4X-SIG');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 20));
    await F.publish({ lat: 32.0, lng: 34.9, trk: 90, kt: 100 });
    const pub = window.__sent.filter(f => (f[0] & 0xf0) === 0x30 && f.length > 4).pop();
    const url = new URL(link);
    await F.viewerStart({ search: url.search, hash: url.hash });
    const sub = window.__sockets[window.__sockets.length - 1];
    sub.connack();
    await new Promise(r => setTimeout(r, 20));
    sub.deliver(new Uint8Array(pub));
    await new Promise(r => setTimeout(r, 60));
    const state = F.watching();
    const out = { lat: state && state.fix && state.fix.lat, verified: state && state.verified };
    F.viewerStop(); await F.stop();
    return out;
  });
  expect(got.verified).toBe(true);
  expect(got.lat).toBe(32);
});

test('a link from before signing is still readable, and the gist can refuse it', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    const link = await F.start('4X-OLD');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 20));
    await F.publish({ lat: 32.2, lng: 34.7, trk: 10, kt: 80 });
    const pub = window.__sent.filter(f => (f[0] & 0xf0) === 0x30 && f.length > 4).pop();
    const url = new URL(link);
    // An old link: the key, and no verify key at all.
    const legacyHash = '#k=' + /k=([^&]+)/.exec(url.hash)[1];

    await F.viewerStart({ search: url.search, hash: legacyHash });
    const sub = window.__sockets[window.__sockets.length - 1];
    sub.connack();
    await new Promise(r => setTimeout(r, 20));
    sub.deliver(new Uint8Array(pub));
    await new Promise(r => setTimeout(r, 60));
    const watching = F.watching();
    const legacy = { verified: watching && watching.verified, fix: !!(watching && watching.fix) };
    F.viewerStop();

    // ...and once enough of them have aged out, the gist stops accepting them.
    setTune('followMeRequireSignedLinks', true);
    const refused = await F.viewerStart({ search: url.search, hash: legacyHash });
    await F.stop();
    return { legacy, refused };
  });
  // Signed packets carry their signature after the ciphertext, so a viewer that is not
  // verifying reads them exactly as it always did.
  expect(got.legacy.verified, 'an old link has nothing to verify against').toBe(false);
  expect(got.legacy.fix, 'an old link stopped working').toBe(true);
  expect(got.refused, 'the gist switch did not refuse an unverifiable link').toBeNull();
});

test('a new link mints a new signing key, and reusing a link keeps it', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-KEY');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 20));
    const first = JSON.parse(localStorage.getItem('navaid.followMeSession')).v;
    await F.stop();
    // Same device, same link: the followers holding it must keep verifying.
    const again = await F.start('4X-KEY');
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 20));
    const reused = JSON.parse(localStorage.getItem('navaid.followMeSession')).v;
    // New link: a new topic, a new AES key, and a new pair with them.
    await F.newLink();
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 20));
    const minted = JSON.parse(localStorage.getItem('navaid.followMeSession')).v;
    await F.stop();
    return { first, reused, minted, inLink: (again || '').includes(reused) };
  });
  expect(got.reused).toBe(got.first);
  expect(got.inLink).toBe(true);
  expect(got.minted).not.toBe(got.first);
});

// The two ends are written in different languages, and the thing they must agree on is the
// exact bytes that were signed: the object without its own `sig`, serialised compactly, in
// insertion order. A separator or a key order that drifts fails silently and looks like a
// forgery, so it is checked against the real signer rather than against our own idea of it.
test('a packet signed by the Python simulator verifies in the app', async ({ page }) => {
  const { execFileSync } = require('child_process');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const made = JSON.parse(execFileSync('python3', ['-c', [
    'import base64, importlib.util, json, os, sys',
    'spec = importlib.util.spec_from_file_location("sim", sys.argv[1])',
    'sim = importlib.util.module_from_spec(spec); spec.loader.exec_module(sim)',
    'priv, pub = sim.signing_keys()',
    'key = os.urandom(32)',
    'fix = {"reg": "4X-PY", "lat": 32.5, "lng": 34.95, "alt": 457, "kt": 90, "trk": 88,',
    '       "t": 1700000000000, "seq": 1700000000001}',
    'sealed = sim.seal(key, fix, priv)',
    'print(json.dumps({"key": sim.b64url(key), "v": pub, "packet": sim.b64url(sealed)}))',
  ].join('\n'), path.join(root, 'scripts/follow-me-simulator.py')], { encoding: 'utf8' }));

  await boot(page);
  const got = await page.evaluate(async (m) => {
    const raw = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw(m.key), 'AES-GCM', false,
      ['encrypt', 'decrypt']);
    const verify = await crypto.subtle.importKey('raw', raw(m.v),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const F = NavAid.followMe;
    const good = await F._open(key, raw(m.packet), verify);
    // ...and the same packet with one digit moved is not the aeroplane's any more.
    const tampered = raw(m.packet);
    tampered[tampered.length - 1] ^= 1;
    const bad = await F._open(key, tampered, verify);
    return { lat: good && good.lat, reg: good && good.reg, bad };
  }, made);
  expect(got.reg).toBe('4X-PY');
  expect(got.lat).toBe(32.5);
  expect(got.bad, 'a tampered packet was accepted').toBeNull();
});
