// @ts-check
// Asked: what happens when a viewer shares their own location? Answered: it does not.
//
// One aeroplane per page. A page opened on someone else's link is watching THEM, and a page
// that is both watching and sharing has two aircraft on it, two banners, and a Follow-me
// control that means two different things. The link also carries a capability that can publish
// to the topic it watches -- the share dialog says so -- and a share pointed at a capability
// the device merely holds is the mistake worth ruling out entirely.
//
// So: sharing is refused while watching, a share resumed from an earlier flight is stopped
// when the page becomes a viewer, and pressing the button offers to leave the watch -- which
// reloads the page without the link, because the watch comes from that URL.
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

test('a page that is watching does not share', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.viewerStart({ search: '?follow=watched000000000', hash: '#k=' + 'k'.repeat(43) });
    const link = await F.start('4X-MINE');
    return { link, why: F.startFailure(), viewing: F.viewing(), status: F.status(),
             sockets: window.__sent.filter(s => (s.frame[0] >> 4) === 3).length };
  });
  expect(got.link, 'a viewer minted a link').toBe(null);
  expect(got.why).toBe('viewing');
  expect(got.viewing).toBe(true);
  expect(got.status).toBe('idle');
  // Nothing was published anywhere -- least of all to the topic whose key it is holding.
  expect(got.sockets).toBe(0);
});

test('a share already running is stopped when the page becomes a viewer', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-MINE');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 20));
    const before = F.status();
    await F.viewerStart({ search: '?follow=watched000000000', hash: '#k=' + 'k'.repeat(43) });
    const stored = F._stored();
    return { before, after: F.status(), viewing: F.viewing(), consent: !!(stored && stored.on) };
  });
  expect(got.before).toBe('connected');
  // The pilot opened someone else's link; their own position going out from the same screen
  // is not what they asked for.
  expect(got.after).toBe('idle');
  expect(got.consent).toBe(false);
  expect(got.viewing).toBe(true);
});

test('a stored share is not resumed on a page opened as a viewer', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    localStorage.setItem('navaid.followMeSession', JSON.stringify({
      id: 'mine000000000000', k: 'm'.repeat(43), at: Date.now(), seq: 1,
      reg: '4X-MINE', on: true, pendingStop: false,
    }));
  });
  const got = await page.evaluate(async () => {
    // The URL the page was opened with is what decides this.
    history.replaceState(null, '', '?lang=en&nogist&follow=watched000000000#k=' + 'k'.repeat(43));
    const link = await NavAid.followMe.resume({ resumeSharing: true });
    return { link, status: NavAid.followMe.status() };
  });
  expect(got.link).toBe(null);
  expect(got.status).toBe('idle');
});

test('pressing the button offers to leave the watch, and leaving reloads without the link', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    history.replaceState(null, '', '?lang=en&nogist&follow=watched000000000#k=' + 'k'.repeat(43));
    await F.viewerStart({ search: location.search, hash: location.hash });
    const asked = [];
    let sentTo = null;
    window.confirm = (text) => { asked.push(String(text)); return false; };
    window.navaidReloadTo = (url) => { sentTo = url; };
    document.getElementById('follow-me').click();
    await new Promise(r => setTimeout(r, 30));
    const declined = { viewing: F.viewing(), sentTo };
    window.confirm = (text) => { asked.push(String(text)); return true; };
    document.getElementById('follow-me').click();
    await new Promise(r => setTimeout(r, 30));
    return { asked, declined, viewing: F.viewing(), sentTo };
  });
  // It says what is actually about to happen, not "Follow me".
  expect(got.asked[0]).toMatch(/stops following|reload/i);
  // Declined: still watching, nothing reloaded.
  expect(got.declined).toEqual({ viewing: true, sentTo: null });
  // Accepted: the watch is dropped and the page goes to the same place without the link, so
  // the state a pilot lands in is a normal map, ready to share.
  expect(got.viewing).toBe(false);
  expect(got.sentTo).toBeTruthy();
  const url = new URL(got.sentTo);
  expect(url.searchParams.get('follow')).toBe(null);
  expect(url.hash).not.toMatch(/k=/);
  // ...and what the pilot had set is still there.
  expect(url.searchParams.get('lang')).toBe('en');
  expect(url.searchParams.get('nogist')).not.toBe(null);
});

// ...unless a fleet says otherwise. The rule is a default, not a law of the app: the gist can
// let a page share while it watches -- a chase plane, a two-aircraft sortie on one phone --
// and it is off, because the link a viewer holds can publish to the topic it is watching.
test.describe('with the gist switch on', () => {
  const allow = (page) => page.evaluate(() => setTune('featureFollowMeShareWhileViewing', true));

  test('a viewer may share, on its own link', async ({ page }) => {
    await boot(page);
    await allow(page);
    const got = await page.evaluate(async () => {
      const F = NavAid.followMe;
      const watchedId = 'watched000000000';
      const watchedKey = 'k'.repeat(43);
      await F.viewerStart({ search: '?follow=' + watchedId, hash: '#k=' + watchedKey });
      const mine = await F.start('4X-MINE');
      window.__sockets[window.__sockets.length - 1].connack();
      await new Promise(r => setTimeout(r, 20));
      const url = new URL(mine);
      return { watching: F.viewing(), status: F.status(),
               mineId: url.searchParams.get('follow'), mineKey: url.hash.replace('#k=', ''),
               watchedId, watchedKey };
    });
    expect(got.watching).toBe(true);
    expect(got.status).not.toBe('idle');
    // Still its OWN capability: the switch permits two aircraft on one page, not publishing
    // into the link somebody else handed over.
    expect(got.mineId).not.toBe(got.watchedId);
    expect(got.mineKey).not.toBe(got.watchedKey);
  });

  test('opening a link no longer stops a share that is running', async ({ page }) => {
    await boot(page);
    await allow(page);
    const got = await page.evaluate(async () => {
      const F = NavAid.followMe;
      await F.start('4X-MINE');
      window.__sockets[0].connack();
      await new Promise(r => setTimeout(r, 20));
      await F.viewerStart({ search: '?follow=watched000000000', hash: '#k=' + 'k'.repeat(43) });
      return { status: F.status(), viewing: F.viewing() };
    });
    expect(got).toEqual({ status: 'connected', viewing: true });
  });

  test('the button shares instead of offering to leave the watch', async ({ page }) => {
    await boot(page);
    await allow(page);
    const got = await page.evaluate(async () => {
      const F = NavAid.followMe;
      await F.viewerStart({ search: '?follow=watched000000000', hash: '#k=' + 'k'.repeat(43) });
      const asked = [];
      let sentTo = null;
      window.confirm = (text) => { asked.push(String(text)); return true; };
      window.navaidReloadTo = (url) => { sentTo = url; };
      window.askFollowMeCode = async () => '4X-MINE';
      document.getElementById('follow-me').click();
      await new Promise(r => setTimeout(r, 40));
      return { asked, sentTo, viewing: F.viewing(), status: F.status() };
    });
    // No question about leaving, and no reload: it just shares.
    expect(got.asked.filter(a => /stops following/i.test(a))).toEqual([]);
    expect(got.sentTo).toBe(null);
    expect(got.viewing).toBe(true);
    expect(got.status).not.toBe('idle');
  });
});
