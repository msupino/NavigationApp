// @ts-check
// Whose clock the age is measured on.
//
// A Follow me packet is stamped by the aeroplane and read by a device whose clock is its own.
// The viewer used to subtract one from the other, so the number on the banner -- "last position
// 4s ago", the whole point of the feature -- was really "the difference between two phones'
// clocks, plus 4s". Minutes apart, and a live feed read as stopped, or a dead one never aged.
// A viewer more than five minutes SLOW rejected every packet as impossibly-future and drew
// nothing at all.
//
// A live packet crosses in milliseconds, so its stamp minus its arrival is the offset itself.
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
  await page.evaluate(() => setTune('featureFollowMe', true));
}

// Build a PUBLISH frame the viewer's own client will parse, carrying a sealed fix whose
// timestamp is the PUBLISHER's clock -- deliberately not this machine's.
const KEY = 'k'.repeat(43);

async function watchWith(page, { publisherOffsetMs, retained }) {
  return page.evaluate(async (args) => {
    const F = NavAid.followMe;
    history.replaceState(null, '', '?lang=en&nogist&follow=watched000000000#k=' + 'k'.repeat(43));
    await F.viewerStart({ search: location.search, hash: location.hash });
    const sock = window.__sockets[window.__sockets.length - 1];
    sock.connack();
    await new Promise(r => setTimeout(r, 20));

    // The same sealing the aeroplane does, with a stamp from the PUBLISHER's clock.
    const raw = Uint8Array.from(atob('k'.repeat(43) + '='), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
    const fix = { reg: '4X-TST', lat: 32.1, lng: 34.9, alt: 300, trk: 90, kt: 100,
                  t: Date.now() + args.publisherOffsetMs, seq: 1 };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify(fix))));
    const payload = new Uint8Array(iv.length + body.length);
    payload.set(iv); payload.set(body, iv.length);

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
    return { drawn: !!F.viewerFix(), skew: F.watching() && F.watching().skew };
  }, { publisherOffsetMs, retained });
}

test('a fix from a phone whose clock is ahead is not reported as from the future', async ({ page }) => {
  await boot(page);
  const got = await watchWith(page, { publisherOffsetMs: 10 * 60 * 1000, retained: false });
  // Ten minutes ahead: this used to fail the "impossibly future" test and never be drawn at all.
  expect(got.drawn, 'the aeroplane was dropped for having the wrong clock').toBe(true);
  expect(got.skew).toBeGreaterThan(9 * 60 * 1000);
  const said = await page.evaluate(() => {
    NavAid.followMe.viewerRefresh();
    return document.getElementById('follow-me-banner').textContent;
  });
  // The fix IS about zero seconds old, and that is what it says.
  expect(said).toMatch(/Last position [0-9]s ago/);
});

test('the banner ages a fix on the viewer\'s clock, not the publisher\'s', async ({ page }) => {
  await boot(page);
  await watchWith(page, { publisherOffsetMs: 5 * 60 * 1000, retained: false });
  const said = await page.evaluate(() => {
    NavAid.followMe.viewerRefresh();
    return document.getElementById('follow-me-banner').textContent;
  });
  // Five minutes of clock difference would have read as a five-minute-old, stale feed.
  expect(said).toMatch(/Last position [0-9]s ago/);
  expect(said).not.toMatch(/not moving/);
});

test('a retained copy of unknown age is not passed off as fresh', async ({ page }) => {
  await boot(page);
  const got = await watchWith(page, { publisherOffsetMs: -10 * 60 * 1000, retained: true });
  expect(got.drawn).toBe(true);
  // Nothing was learnt about the clock from a stored packet, so its own stamp stands: ten
  // minutes old, and the banner says so rather than calling it live.
  expect(got.skew).toBe(null);
  const said = await page.evaluate(() => {
    NavAid.followMe.viewerRefresh();
    return document.getElementById('follow-me-banner').textContent;
  });
  expect(said).toMatch(/not moving|feed has stopped/);
});
