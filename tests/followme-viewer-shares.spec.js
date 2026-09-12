// @ts-check
// Asked: what happens when a viewer shares their own location?
//
// A viewer holds someone else's capability -- the id and key in the link they opened -- and
// that capability is writable: anyone holding it can publish to that topic, which is what the
// warning on the share dialog says. So the question matters: pressing Follow Me while watching
// must mint THIS device's own link and publish nowhere near the one being watched.
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
        window.__sent.push({ socket: window.__sockets.indexOf(this), frame: Array.from(frame) });
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

test('a viewer who shares gets their own link, not the one they are watching', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    // Someone else's link, of the shape the app mints.
    const watchedId = 'watched000000000';
    const watchedKey = 'k'.repeat(43);
    await F.viewerStart({ search: '?follow=' + watchedId, hash: '#k=' + watchedKey });
    const mine = await F.start('4X-MINE');
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 20));
    const url = new URL(mine);
    return {
      watching: F.viewing(),
      sharing: F.status(),
      mineId: url.searchParams.get('follow'),
      mineKey: url.hash.replace('#k=', ''),
      watchedId, watchedKey,
      // What actually went on the wire, per socket.
      topics: window.__sent.filter(s => (s.frame[0] >> 4) === 3).map(s => {
        const f = s.frame;
        let at = 1, digit;
        do { digit = f[at++]; } while (digit & 0x80);
        const len = (f[at] << 8) | f[at + 1];
        return String.fromCharCode(...f.slice(at + 2, at + 2 + len));
      }),
    };
  });
  // Both at once: still watching, and now sharing.
  expect(got.watching).toBe(true);
  expect(got.sharing).not.toBe('idle');
  // A capability of its own. Nothing of the watched link is reused -- not the topic, not the
  // key -- so a follower cannot be handed the aeroplane they were watching by mistake.
  expect(got.mineId).not.toBe(got.watchedId);
  expect(got.mineKey).not.toBe(got.watchedKey);
  // And nothing this device publishes goes to the topic it is watching, which the capability
  // in that link would have allowed.
  expect(got.topics.some(t => t.includes(got.watchedId))).toBe(false);
});

test('what the viewer publishes is its own position, under its own name', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.viewerStart({ search: '?follow=watched000000000', hash: '#k=' + 'k'.repeat(43) });
    const mine = await F.start('4X-MINE');
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 20));
    await F.publish({ lat: 32.1, lng: 34.9, trk: 90 });
    await new Promise(r => setTimeout(r, 20));
    const id = new URL(mine).searchParams.get('follow');
    const published = window.__sent.filter(s => (s.frame[0] >> 4) === 3).map(s => {
      const f = s.frame;
      let at = 1, digit;
      do { digit = f[at++]; } while (digit & 0x80);
      const len = (f[at] << 8) | f[at + 1];
      return String.fromCharCode(...f.slice(at + 2, at + 2 + len));
    });
    return { id, published };
  });
  expect(got.published.length).toBeGreaterThan(0);
  for (const topic of got.published) expect(topic).toContain(got.id);
});

test('stopping the share leaves the viewer watching', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.viewerStart({ search: '?follow=watched000000000', hash: '#k=' + 'k'.repeat(43) });
    await F.start('4X-MINE');
    window.__sockets[window.__sockets.length - 1].connack();
    await new Promise(r => setTimeout(r, 20));
    await F.stop();
    return { viewing: F.viewing(), status: F.status(),
             banner: !!document.getElementById('follow-me-banner') };
  });
  // Two separate things: giving up your own link does not close the one you opened.
  expect(got).toEqual({ viewing: true, status: 'idle', banner: true });
});
