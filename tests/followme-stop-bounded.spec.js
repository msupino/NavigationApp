// @ts-check
// Reported from the phone: stop sharing is stuck, and the control above the lock does nothing.
//
// One bug. Stopping waits for the relay to acknowledge the tombstone that deletes the retained
// position, and a relay that never answers -- no signal, a broker down, a captive wifi -- left
// the button reading "Stopping sharing…", disabled, for ever. The map control is the same
// button, and it refuses while the status is 'stopping', so it did nothing at all.
//
// The wait is bounded now. When it runs out, sharing stops HERE: consent revoked on this
// device, publisher closed, nothing more goes out. What cannot be promised is the retained
// position already sitting on the relay, so it is not claimed.
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
      // The point of this stub: it never acknowledges anything.
      send(bytes) { window.__sent.push(Array.from(new Uint8Array(bytes))); }
      close() { this.onclose && this.onclose(); }
      deliver(bytes) { this.onmessage && this.onmessage({ data: new Uint8Array(bytes).buffer }); }
      connack() { this.deliver([0x20, 0x02, 0x00, 0x00]); }
    };
    window.WebSocket = window.StubSocket;
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.followMe && typeof setTune === 'function');
  await page.evaluate(() => {
    setTune('featureFollowMe', true);
    setTune('followMeStopMaxSec', 1);          // the real one is 25 s
    window.gpsLiveOn = true;
  });
}

test('a relay that never answers does not leave the pilot stuck on "stopping"', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-STUCK');
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 20));
    const sharing = F.status();
    const result = await F.stop();              // no PUBACK will ever come
    const stored = F._stored();
    return { sharing, result, after: F.status(),
             // The capability is kept by design (one link per device), but the CONSENT is
             // not: `on` is what a reload reads back before it resumes anything.
             storedOn: !!(stored && stored.on), pendingStop: !!(stored && stored.pendingStop) };
  });
  expect(got.sharing).toBe('connected');
  // It finished, and it says it was forced -- the caller must not claim the link is dead.
  expect(got.result).toEqual({ pending: false, forced: true });
  expect(got.after, 'still stopping').toBe('idle');
  // Consent is revoked on this device: a reload resumes nothing.
  expect(got.storedOn).toBe(false);
  expect(got.pendingStop, 'left half-stopped, so the next boot tries to finish it').toBe(false);
});

test('the button comes back, and says what actually happened', async ({ page }) => {
  await boot(page);
  const toasts = await page.evaluate(async () => {
    const seen = [];
    window.showToast = (m) => seen.push(String(m));
    window.askFollowMeCode = async () => '4X-STUCK';
    document.getElementById('follow-me').click();
    await new Promise(r => setTimeout(r, 30));
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 30));
    document.getElementById('follow-me').click();      // Stop
    await new Promise(r => setTimeout(r, 1400));       // past followMeStopMaxSec
    return { seen, status: NavAid.followMe.status(),
             disabled: document.getElementById('follow-me').disabled };
  });
  expect(toasts.status).toBe('idle');
  expect(toasts.disabled, 'the button is still refusing').toBe(false);
  // Not "stopped." -- that would claim the retained position is gone from the relay.
  expect(toasts.seen.some(t => /relay never answered/i.test(t))).toBe(true);
});

test('a relay that does answer is still the ordinary stop', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const F = NavAid.followMe;
    await F.start('4X-OK');
    const sock = window.__sockets[0];
    sock.connack();
    await new Promise(r => setTimeout(r, 20));
    // Acknowledge the retained delete, the way a broker does.
    const origSend = sock.send.bind(sock);
    sock.send = (bytes) => {
      origSend(bytes);
      const frame = new Uint8Array(bytes);
      if ((frame[0] >> 4) === 3 && ((frame[0] >> 1) & 3) === 1) {
        let at = 1, mult = 1, digit;
        do { digit = frame[at++]; mult *= 128; } while (digit & 0x80);
        const topicLen = (frame[at] << 8) | frame[at + 1];
        const idAt = at + 2 + topicLen;
        const id = (frame[idAt] << 8) | frame[idAt + 1];
        setTimeout(() => sock.deliver([0x40, 0x02, id >> 8, id & 0xff]), 0);
      }
    };
    const result = await F.stop();
    return { result, status: F.status() };
  });
  expect(got.result.pending).toBe(false);
  expect(got.result.forced, 'an acknowledged stop must not read as forced').toBeFalsy();
  expect(got.status).toBe('idle');
});

// The state a stuck device is already IN: a stop that never finished is written to storage as
// pendingStop, and the next boot picks it up and waits on the same silent relay. A bound that
// only covered the button would never reach that device -- it would open stuck, every time.
test('a stop left half-finished is bounded on the next boot too', async ({ page }) => {
  await boot(page);
  // Leave the device exactly as an interrupted stop leaves it.
  await page.evaluate(() => {
    const rec = { id: 'stuckid00000000', k: 'a'.repeat(43), at: Date.now(), seq: 3,
                  reg: '4X-STUCK', on: false, pendingStop: true };
    localStorage.setItem('navaid.followMe', JSON.stringify(rec));
  });
  await page.reload();
  await page.waitForFunction(() => window.NavAid && NavAid.followMe && typeof setTune === 'function');
  await page.evaluate(() => {
    setTune('featureFollowMe', true);
    setTune('followMeStopMaxSec', 1);
  });
  const got = await page.evaluate(async () => {
    await NavAid.followMe.resume({ resumeSharing: false });
    const stored = NavAid.followMe._stored();
    return { status: NavAid.followMe.status(),
             pendingStop: !!(stored && stored.pendingStop), on: !!(stored && stored.on) };
  });
  // It gave up on the relay and finished locally instead of hanging the boot.
  expect(got.status).toBe('idle');
  expect(got.pendingStop, 'still half-stopped, so the next boot hangs again').toBe(false);
  expect(got.on).toBe(false);
});

// And the pilot's own way out: pressing the button again while it is stopping. It used to be
// ignored -- which is what "stop sharing is stuck" looks like from the cockpit: a dead button
// on the control you press when you want the sharing to be over.
test('pressing Stop again stops waiting for the relay', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setTune('followMeStopMaxSec', 300));   // the deadline is far away
  const got = await page.evaluate(async () => {
    const seen = [];
    window.showToast = (m) => seen.push(String(m));
    window.askFollowMeCode = async () => '4X-AGAIN';
    const btn = document.getElementById('follow-me');
    btn.click();
    await new Promise(r => setTimeout(r, 30));
    window.__sockets[0].connack();
    await new Promise(r => setTimeout(r, 30));
    btn.click();                                   // Stop -- the relay will not answer
    await new Promise(r => setTimeout(r, 30));
    const waiting = { status: NavAid.followMe.status(), disabled: btn.disabled };
    btn.click();                                   // ...and again: do not wait
    await new Promise(r => setTimeout(r, 60));
    return { waiting, after: NavAid.followMe.status(), seen };
  });
  expect(got.waiting.status).toBe('stopping');
  // The button is alive while stopping -- that is the whole point of pressing it again.
  expect(got.waiting.disabled).toBe(false);
  expect(got.after).toBe('idle');
  expect(got.seen.some(t => /relay never answered/i.test(t))).toBe(true);
});
