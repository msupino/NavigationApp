// @ts-check
// Public share: beside the private link, a pilot can tick Public, and every NavAid user with
// Extra layers -> Show public NavAid pilots sees the aircraft. Off unless ticked. The public
// packet is signed, not encrypted; a viewer holds each public id to the first key it saw.
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
  await page.waitForFunction(() => !!(window.NavAid && NavAid.followMe && NavAid.publicPilots) && typeof setTune === 'function');
  await page.evaluate(() => {
    setTune('featureFollowMe', true);
    window.gpsLiveOn = true;
    window.__pubs = () => window.__sent.filter(f => (f[0] >> 4) === 3).map(f => {
      let at = 1, digit;
      do { digit = f[at++]; } while (digit & 0x80);
      const len = (f[at] << 8) | f[at + 1];
      const qos = (f[0] >> 1) & 3;
      const body = f.slice(at + 2 + len + (qos ? 2 : 0));
      return { topic: String.fromCharCode(...f.slice(at + 2, at + 2 + len)), retain: f[0] & 1,
               text: new TextDecoder().decode(new Uint8Array(body)) };
    });
  });
}

async function share(page, isPublic) {
  return page.evaluate(async (pub) => {
    const F = NavAid.followMe;
    F.setPublic(pub);
    await F.start('4X-PUB');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 20));
    await F.publish({ lat: 32.2, lng: 34.85, trk: 45, kt: 95, af: 2500 });
    await new Promise(r => setTimeout(r, 20));
    return window.__pubs();
  }, isPublic);
}

test('off by default: nothing goes on the public channel', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => NavAid.followMe.publicOn())).toBe(false);
  const pubs = await share(page, false);
  expect(pubs.some(p => p.topic.startsWith('navaid/public/'))).toBe(false);
  expect(pubs.some(p => p.topic.startsWith('navaid/follow/'))).toBe(true);   // the private link still works
});

test('public: a signed, readable, retained fix on the public channel -- and cleared on Stop', async ({ page }) => {
  await boot(page);
  const pubs = await share(page, true);
  const pub = pubs.find(p => p.topic.startsWith('navaid/public/v1/'));
  expect(pub).toBeTruthy();
  expect(pub.retain).toBe(1);
  const msg = JSON.parse(pub.text);                   // not encrypted: public means public
  expect(msg).toMatchObject({ v: 1, reg: '4X-PUB', lat: 32.2, lng: 34.85, af: 2500, kt: 95, trk: 45 });
  expect('mh' in msg).toBe(true);                     // the heading the pilot's screen shows
  expect(typeof msg.pk).toBe('string');
  expect(typeof msg.sig).toBe('string');
  // Its own id, not the private link's topic.
  const privateTopic = pubs.find(p => p.topic.startsWith('navaid/follow/')).topic;
  expect(privateTopic.includes(pub.topic.split('/').pop())).toBe(false);
  // Stop takes it off everyone's map.
  const after = await page.evaluate(async () => {
    window.__sent.length = 0;
    await NavAid.followMe.stop();
    return window.__pubs();
  });
  const cleared = after.find(p => p.topic === pub.topic);
  expect(cleared).toBeTruthy();
  expect(cleared.text).toBe('');
});

test('the layer draws signed public aircraft, refuses a forged one, and fades the silent', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const F = NavAid.followMe, P = NavAid.publicPilots;
    // Two keys: the aircraft's own, and a forger's.
    const mk = async () => {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      return { signKey: pair.privateKey, verifyB64: F._b64url.from(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) };
    };
    const own = await mk(), forger = await mk();
    const id = await F._publicIdForKey(own.verifyB64);   // the id is the key's fingerprint
    const topic = 'navaid/public/v1/' + id;
    const now = Date.now();
    const a = await F._publicPacket(own, { reg: '4X-AAA', lat: 32.1, lng: 34.9, af: 3000, kt: 100, mh: 45, trk: 50, t: now - 1000 });
    await P._onMessage(topic, a);
    const first = P.list();
    const forged = await F._publicPacket(forger, { reg: '4X-AAA', lat: 31.0, lng: 34.0, af: 0, kt: 0, trk: 0, t: now });
    await P._onMessage(topic, forged);
    const afterForge = P.list();
    const lab = document.querySelector('.public-pilot-mark .follow-me-label');
    const label = { who: lab.querySelector('b').textContent, readout: lab.querySelector('small').textContent };
    // Silent past the dim threshold.
    setTune('followMePublicDimSec', 10);
    const other = await mk();
    const otherId = await F._publicIdForKey(other.verifyB64);
    const old = await F._publicPacket(other, { reg: '4X-OLD', lat: 32.2, lng: 34.9, af: 3000, kt: 100, trk: 90, t: now - 60000 });
    await P._onMessage('navaid/public/v1/' + otherId, old, true);    // the relay's retained copy
    P._sweep();
    const stale = P.list().find(p => p.id === otherId).stale;
    const staleLabel = [...document.querySelectorAll('.public-pilot-mark small')].map(e => e.textContent).find(t => /min/.test(t));
    // Cleared by its owner: gone.
    await P._onMessage(topic, new Uint8Array(0));
    return { first, afterForge, label, stale, staleLabel, after: P.list().map(p => p.id), otherId };
  });
  expect(out.first).toHaveLength(1);
  expect(out.first[0]).toMatchObject({ reg: '4X-AAA', lat: 32.1, af: 3000 });
  expect(out.afterForge[0].lat).toBe(32.1);            // the forger did not move it
  expect(out.label).toEqual({ who: '4X-AAA', readout: '100 kt · 3000 ft' });   // the icon shows the direction
  expect(out.stale).toBe(true);
  expect(out.staleLabel).toBe('100 kt · 3000 ft · 1 min');   // how long ago it was last heard
  expect(out.after).toEqual([out.otherId]);
});

test('Extra layers has the switch, and the share dialog the Public option', async ({ page }) => {
  await boot(page);
  const box = await page.evaluate(() => {
    const cb = document.getElementById('public-pilots-cb');
    return { exists: !!cb, frameHidden: document.getElementById('public-pilots-frame').hidden };
  });
  expect(box).toEqual({ exists: true, frameHidden: false });
  await page.evaluate(() => { window.__answer = askFollowMeCode('4X-PUB'); });
  const dlg = page.locator('.follow-me-ask-modal');
  await expect(dlg.locator('.follow-me-public-cb')).not.toBeChecked();
  await dlg.locator('.follow-me-public-cb').check();
  await dlg.getByRole('button', { name: 'Share' }).click();
  expect(await page.evaluate(() => NavAid.followMe.publicOn())).toBe(true);
});

test('others are shown only while this device shares publicly -- or on the secret link', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const F = NavAid.followMe, P = NavAid.publicPilots;
    const before = P.allowed();
    F.setPublic(true);
    await F.start('4X-SEE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 20));
    const sharingPublic = P.allowed();
    F.setPublic(false);
    const sharingPrivate = P.allowed();
    await F.stop();
    // The secret viewing link: its SHA-256 is what the app holds.
    const secret = 'test-secret';
    const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    setTune('publicPilotsViewHash', hex);
    const wrong = await P.unlock('not-it');
    const right = await P.unlock(secret);
    return { before, sharingPublic, sharingPrivate, wrong, right, after: P.allowed() };
  });
  expect(out).toEqual({ before: false, sharingPublic: true, sharingPrivate: false, wrong: false, right: true, after: true });
});

test('the switch is dimmed, not hidden, and says why while this device does not share publicly', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.refreshPublicPilotsFeature());
  const label = page.locator('#public-pilots-frame label');
  await expect(label).toHaveClass(/is-dim/);
  await expect(label).toHaveAttribute('title', /Public to see others/);
});

test('the aircraft and its label grow a little zoomed in, and shrink a little zoomed out', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const F = NavAid.followMe, P = NavAid.publicPilots;
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const k = { signKey: pair.privateKey, verifyB64: F._b64url.from(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) };
    const size = async (z) => {
      map.setView([32.1, 34.9], z, { animate: false });
      await P._onMessage('navaid/public/v1/' + await F._publicIdForKey(k.verifyB64), await F._publicPacket(k, { reg: 'X', lat: 32.1, lng: 34.9, af: 1000, kt: 90, trk: 0, t: Date.now() + z }));
      const el = document.querySelector('.public-pilot-mark');
      return { icon: el.offsetWidth, font: parseFloat(getComputedStyle(el.querySelector('.follow-me-label')).fontSize) };
    };
    return { z7: await size(7), z9: await size(9), z12: await size(12) };
  });
  expect(out.z12.icon).toBeGreaterThan(out.z9.icon);
  expect(out.z9.icon).toBeGreaterThan(out.z7.icon);
  expect(out.z12.font).toBeGreaterThan(out.z9.font);
  expect(out.z12.icon / out.z9.icon).toBeLessThanOrEqual(1.6);
});

test('a packet under another pilot id is refused even by a viewer that never saw the real key', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const F = NavAid.followMe, P = NavAid.publicPilots;
    const mk = async () => {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      return { signKey: pair.privateKey, verifyB64: F._b64url.from(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) };
    };
    const victim = await mk(), forger = await mk();
    const victimId = await F._publicIdForKey(victim.verifyB64);
    // The forger's retained packet is the first thing a newcomer sees under the victim's id.
    await P._onMessage('navaid/public/v1/' + victimId, await F._publicPacket(forger, { reg: 'FAKE', lat: 31, lng: 34, t: Date.now() }), true);
    const afterForged = P.list().length;
    await P._onMessage('navaid/public/v1/' + victimId, await F._publicPacket(victim, { reg: 'REAL', lat: 32, lng: 35, t: Date.now() }));
    return { afterForged, list: P.list().map(p => p.reg) };
  });
  expect(out.afterForged).toBe(0);
  expect(out.list).toEqual(['REAL']);
});

test('a live packet from a phone whose clock runs behind is not shown as silent', async ({ page }) => {
  await boot(page);
  const stale = await page.evaluate(async () => {
    const F = NavAid.followMe, P = NavAid.publicPilots;
    setTune('followMePublicDimSec', 10);
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const k = { signKey: pair.privateKey, verifyB64: F._b64url.from(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) };
    const id = await F._publicIdForKey(k.verifyB64);
    await P._onMessage('navaid/public/v1/' + id, await F._publicPacket(k, { reg: 'SLOW', lat: 32, lng: 35, t: Date.now() - 120000 }), false);
    P._sweep();
    return P.list()[0].stale;
  });
  expect(stale).toBe(false);
});

for (const form of ['?pilots=', '#pilots=']) {
  test(`the secret viewing link (${form}) is taken out of the address before anything can report it`, async ({ page }) => {
    await page.addInitScript(() => { window.__hrefAtGa = null; });
    // A secret whose hash the test sets as the gist would.
    await page.goto('?lang=en&nogist' + (form[0] === '#' ? '' : '&') + (form[0] === '#' ? form.replace('#', '#') : form.slice(1)) + 'test-secret');
    await page.waitForFunction(() => !!(window.NavAid && NavAid.publicPilots));
    const out = await page.evaluate(() => ({ href: location.href }));
    expect(out.href).not.toContain('test-secret');
    expect(out.href).not.toContain('pilots=');
  });
}

test('the label reads in the dark theme too: light text on its dark backing', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.theme', 'dark'); } catch (e) {} });
  await boot(page);
  const c = await page.evaluate(async () => {
    const F = NavAid.followMe, P = NavAid.publicPilots;
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const k = { signKey: pair.privateKey, verifyB64: F._b64url.from(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) };
    await P._onMessage('navaid/public/v1/' + await F._publicIdForKey(k.verifyB64), await F._publicPacket(k, { reg: 'QQQQ', lat: 32, lng: 35, kt: 41, af: 1049, t: Date.now() }));
    const cs = getComputedStyle(document.querySelector('.public-pilot-label'));
    const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    return { text: lum(cs.color), bg: lum(cs.backgroundColor) };
  });
  expect(c.text - c.bg).toBeGreaterThan(120);   // light on dark, well apart
});
