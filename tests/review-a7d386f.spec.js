// @ts-check
// Three findings from the main-snapshot review of a7d386f:
//  - re-seeding the shared weather time moved the dropdown without telling the overlays, so
//    an already-drawn chart kept its old pixels under a newer label — aviation weather
//    mislabelled, which is worse than the stale default the re-seed was added to fix;
//  - a simulator poll already in flight when the pilot pressed Stop still repopulated the
//    aircraft and wrote "Connected" when it settled;
//  - the "strict" route validator accepted the per-leg fields added since it was written.
const { test, expect } = require('./_setup');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');
const BOUNDS = { s: 29.88, n: 33.82, w: 33.31, e: 36.69 };

async function serveWx(page, { pwx, sigwx, sigwxDelayMs = 0 }) {
  await page.route(/ims-data\/ims\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/ims-data\/ims\/pwx\.json/, r => (pwx
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pwx) })
    : r.fulfill({ status: 404, body: '' })));
  await page.route(/ims-data\/ims\/sigwx\.json/, async r => {
    if (sigwxDelayMs) await new Promise(res => setTimeout(res, sigwxDelayMs));
    return sigwx
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sigwx) })
      : r.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
    // PWX overlay already on when the page loads — the case that broke.
    try { localStorage.setItem('navaid.imsPwx', JSON.stringify({ on: true, level: '90' })); }
    catch (e) {}
    const fixed = Date.UTC(2026, 5, 21, 23, 45);
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
  });
  await page.goto('?lang=en&nogist');
}

test('a re-seed refreshes the active overlay, so label and pixels agree', async ({ page }) => {
  await serveWx(page, {
    // PWX is restored ON and its level publishes ONLY 18:00, so it draws that chart while
    // it is the only option in the dropdown.
    pwx: { generatedAt: '2026-06-21T18:00:00Z', bounds: BOUNDS,
      levels: [{ level: '90', label: 'FL030', times: [
        { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/90/old.png' }] }] },
    // SIGWX answers later with a time fifteen minutes from the frozen clock, which
    // re-seeds the shared selector away from 18:00.
    sigwx: { generatedAt: '2026-06-21T18:00:00Z', times: [
      { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/new.png' }] },
    sigwxDelayMs: 600,
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const sel = document.getElementById('wx-time');
    const imgs = Array.from(document.querySelectorAll('.leaflet-image-layer'),
      i => i.getAttribute('src') || '');
    return { selected: sel.value, imgs };
  });
  expect(r.selected).toBe('22/06/2026|00:00');
  // The overlay must FOLLOW the selector. Its level has no 00:00 chart, so the honest
  // outcome is that it stops drawing; what it must never do is keep painting the 18:00
  // chart under a label that now says 00:00 — a weather chart six hours from what it
  // claims. Only a real `change` event used to refresh it, and a re-seed fires none.
  expect(r.imgs.some(src => /old\.png/.test(src)),
    'PWX still painting the 18:00 chart after the selector moved to 00:00').toBe(false);
});

test('a re-seed does not write itself back as the pilot\'s pinned choice', async ({ page }) => {
  await serveWx(page, {
    pwx: { generatedAt: '2026-06-21T18:00:00Z', bounds: BOUNDS,
      levels: [{ level: '90', label: 'FL030', times: [
        { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/90/old.png' },
        { valid: '00:00', day: '22/06/2026', png: 'ims/pwx/90/new.png' }] }] },
    sigwx: { generatedAt: '2026-06-21T18:00:00Z', times: [
      { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/new.png' }] },
    sigwxDelayMs: 400,
  });
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 2);
  const stored = await page.evaluate(() => {
    try { return localStorage.getItem('navaid.wxTime'); } catch (e) { return 'ERR'; }
  });
  // Only a real change persists the choice; otherwise the app's own default would harden
  // into a pin the pilot never made, and later re-seeds would stop improving it.
  expect(stored).toBeNull();
});

// --- the simulator session -----------------------------------------------------------
async function bootSim(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof _simFetch === 'function' &&
    typeof simStop === 'function' && typeof simStart === 'function');
}

test('a poll that lands after Stop does not resurrect the aircraft', async ({ page }) => {
  await bootSim(page);
  const r = await page.evaluate(async () => {
    let release;
    const gate = new Promise(res => { release = res; });
    window.fetch = async () => {
      await gate;
      return { ok: true, status: 200,
        json: async () => ({ latitude: 32.1, longitude: 34.85, altitude: 900, heading: 90, ias: 100 }) };
    };
    simStart();
    const poll = _simFetch();          // in flight
    simStop();                         // ...pilot stops while it is in flight
    release();
    await poll;
    return { aircraft: window.simAircraft,
      status: (document.getElementById('sim-status') || {}).textContent || '' };
  });
  // It used to repopulate simAircraft and write "Connected" after the pilot had stopped,
  // leaving a stale aeroplane on the map with the simulator switched off.
  expect(r.aircraft).toBeNull();
  expect(r.status).not.toMatch(/connected/i);
});

test('an old session\'s answer cannot overwrite a newer one', async ({ page }) => {
  await bootSim(page);
  const r = await page.evaluate(async () => {
    // simStart() polls immediately as well as on its interval, so the request under test
    // has to be simStart's OWN first poll — an earlier version of this test awaited a
    // later call and was measuring a race instead of the fix.
    let releaseOld;
    const oldGate = new Promise(res => { releaseOld = res; });
    let call = 0;
    window.fetch = async () => {
      call++;
      if (call === 1) {
        await oldGate;      // session 1's poll, still in flight across the restart
        return { ok: true, status: 200,
          json: async () => ({ latitude: 31.0, longitude: 34.0, altitude: 100, heading: 10, ias: 50 }) };
      }
      return { ok: true, status: 200,
        json: async () => ({ latitude: 33.0, longitude: 35.0, altitude: 5000, heading: 200, ias: 120 }) };
    };
    simStart();                       // session 1 — its poll hangs on the gate
    simStop();
    simStart();                       // session 2
    await new Promise(r2 => setTimeout(r2, 30));
    const fresh = window.simAircraft ? window.simAircraft.lat : null;
    releaseOld();                     // session 1's answer finally arrives
    await new Promise(r2 => setTimeout(r2, 30));
    const after = window.simAircraft ? window.simAircraft.lat : null;
    simStop();
    return { calls: call, fresh, after };
  });
  expect(r.calls).toBeGreaterThanOrEqual(2);
  expect(r.fresh).toBe(33);
  // The stale fix is ~200 NM away; applying it would jump the aeroplane across the map
  // with nothing to indicate the position came from a session already ended.
  expect(r.after).toBe(33);
});

// --- the strict validator ------------------------------------------------------------
test('the strict validator rejects malformed new per-leg fields', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof validateRoute === 'function' &&
    typeof serializeRoute === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 90;
    const base = serializeRoute();
    // validateRoute returns a message string on failure and a falsy value when the
    // document is acceptable.
    const check = mutate => {
      const d = JSON.parse(JSON.stringify(base));
      mutate(d.legs[0]);
      const r = validateRoute(d);
      return r ? String(r) : '';
    };
    return {
      clean: check(() => {}),
      hideKiteString: check(l => { l.hideKite = 'false'; }),
      hideKiteZero: check(l => { l.hideKite = 0; }),
      hideKiteOne: check(l => { l.hideKite = 1; }),
      vorRefNumber: check(l => { l.vorRef = 42; }),
      vorRefLong: check(l => { l.vorRef = 'X'.repeat(40); }),
      vorRefOk: check(l => { l.vorRef = 'BGN'; }),
      cumLabelBad: check(l => { l.cumLabel = { a: 'x' }; }),
      cumLabelOk: check(l => { l.cumLabel = { a: 3, p: -4 }; }),
      speedAutoString: check(l => { l.speedAuto = 'false'; }),
    };
  });
  expect(out.clean).toBe('');
  // `hideKite: "false"` passed the advertised strict check and then read as TRUE, so an
  // imported file could hide a leg's kite while claiming the opposite.
  expect(out.hideKiteString).toMatch(/hideKite/);
  expect(out.hideKiteZero).toMatch(/hideKite/);
  expect(out.hideKiteOne).toBe('');
  expect(out.vorRefNumber).toMatch(/vorRef/);
  expect(out.vorRefLong).toMatch(/vorRef/);
  expect(out.vorRefOk).toBe('');
  expect(out.cumLabelBad).toMatch(/cumLabel/);
  expect(out.cumLabelOk).toBe('');
  expect(out.speedAutoString).toMatch(/speedAuto/);
});
