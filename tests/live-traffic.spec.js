// @ts-check
// ADS-B traffic on the map: the other aeroplanes, an arrow each, pointing where they are
// going. It asks around your fix when there is one -- that is the traffic that matters --
// and otherwise around the middle of what you are looking at, because which airways are
// busy over a field you are routing through is a question asked at the desk too.
//
// It exists in the APK and nowhere else. The aggregators serve data to anyone and CORS
// headers to nobody, so a browser cannot read them at all; Capacitor's native HTTP makes
// the request in Java, where the same-origin rule does not apply. Rather than shipping a
// feature that fails on the desktop, the switch is not offered there.
const { test, expect } = require('./_setup');

// What adsb.lol actually sends: `ac`, `alt_baro`, `t` for the type.
const AC = [
  { hex: '4c80b8', flight: 'BBG802 ', lat: 32.10, lon: 34.90, alt_baro: 15975, track: 284.9, gs: 377, t: 'A320', squawk: '2225' },
  { hex: '738a11', flight: 'ELY321 ', lat: 32.02, lon: 34.95, alt_baro: 4200, track: 120, gs: 210, t: 'B738', squawk: '4512' },
];

// A fake native platform whose CapacitorHttp answers from `body` and records what it was
// asked. There is no page.route here: the request never goes through the browser at all.
async function stubNative(page, opts) {
  const o = opts || {};
  await page.addInitScript(([body, native]) => {
    window.__asked = [];
    window.__body = body;
    window.Capacitor = {
      isNativePlatform: () => native,
      Plugins: {
        CapacitorHttp: {
          request: (req) => {
            window.__asked.push(req.url);
            if (window.__fail) return Promise.reject(new Error(window.__fail));
            return Promise.resolve({ status: 200, data: window.__body });
          },
        },
      },
    };
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    localStorage.setItem('navaid.showTraffic', '1');
  }, [o.body !== undefined ? o.body : { ac: AC }, o.native !== false]);
}

async function boot(page, opts) {
  await stubNative(page, opts);
  await page.goto(`?lang=${(opts && opts.lang) || 'en'}&nogist`);
  await page.waitForFunction(() => typeof window.trafficRefresh === 'function');
  // The feature is off in the shipped gist (featureLiveTraffic): turn it on the way the
  // gist would, so these tests are about the layer rather than the switch above it.
  if (!opts || opts.feature !== false) {
    await page.evaluate(() => { setTune('featureLiveTraffic', true); refreshTrafficFeature(); });
    await page.waitForTimeout(300);
  }
}

const fly = (page, lat = 32.05, lng = 34.92) => page.evaluate(async ([la, ln]) => {
  startLiveLocation();
  window.__geoCb({ coords: { latitude: la, longitude: ln, accuracy: 5 }, timestamp: Date.now() });
  await new Promise(r => setTimeout(r, 900));
}, [lat, lng]);

const marks = (page) => page.locator('.traffic-mark');
// Where a followed aircraft sits on screen: on the map, and not under the inspector that follows it.
const seen = (page, lat, lon) => page.evaluate(([la, lo]) => {
  const box = map.getContainer().getBoundingClientRect();
  const p = map.latLngToContainerPoint([la, lo]);
  const x = box.left + p.x, y = box.top + p.y;
  const i = document.getElementById('inspector').getBoundingClientRect();
  return { onMap: x > box.left && x < box.right && y > box.top && y < box.bottom,
    underPanel: x >= i.left && x <= i.right && y >= i.top && y <= i.bottom };
}, [lat, lon]);
const asked = (page) => page.evaluate(() => window.__asked || []);
const frameShown = (page) => page.evaluate(() => {
  const f = document.getElementById('traffic-cb').closest('.tb-layer-frame');
  return getComputedStyle(f).display !== 'none';
});

// A browser cannot read these feeds however the switches are set, so it is not offered one.
// A tick-box that can only ever say "Live traffic unavailable" is worse than no tick-box.
test('a plain browser keeps the switch, dimmed, and says why', async ({ page }) => {
  await boot(page, { native: false });
  expect(await page.evaluate(() => tune('featureLiveTraffic'))).toBe(true);
  // Still there. A control that vanishes between the phone and the desktop leaves the
  // pilot wondering what else moved -- so it stays, off and dimmed, with the reason on it.
  expect(await frameShown(page)).toBe(true);
  const state = await page.evaluate(() => {
    const cb = document.getElementById('traffic-cb');
    const label = cb.closest('label');
    return { disabled: cb.disabled, dimmed: label.classList.contains('navtoggle-disabled'), why: label.title };
  });
  expect(state.disabled).toBe(true);
  expect(state.dimmed).toBe(true);
  expect(state.why).toMatch(/app only/i);
  // ...and it draws nothing, whatever the stored preference said.
  await fly(page);
  expect(await marks(page).count()).toBe(0);
  expect(await asked(page)).toEqual([]);
});

// With NavAid's relay named in the gist (trafficWebApiUrl, relay/traffic), a browser shows
// traffic too: the relay adds the CORS header the feeds leave out.
test('a browser shows traffic through the relay the gist names', async ({ page }) => {
  await boot(page, { native: false });
  const relayed = [];
  await page.route('https://relay.navaid.test/**', (r) => {
    relayed.push(r.request().url());
    return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ac: AC }) });
  });
  await page.evaluate(() => {
    setTune('trafficWebApiUrl', 'https://relay.navaid.test/v2/lat/{lat}/lon/{lon}/dist/{dist}');
    refreshTrafficFeature();
  });
  const state = await page.evaluate(() => {
    const cb = document.getElementById('traffic-cb');
    return { disabled: cb.disabled, dimmed: cb.closest('label').classList.contains('navtoggle-disabled') };
  });
  expect(state).toEqual({ disabled: false, dimmed: false });
  await page.evaluate(() => map.setView([32.05, 34.92], 10));
  await expect(marks(page)).toHaveCount(2);
  expect(relayed[0]).toMatch(/^https:\/\/relay\.navaid\.test\/v2\/lat\/32\.\d+\/lon\/34\.\d+\/dist\/\d+$/);
  // The feed itself is never asked from a browser.
  expect(await asked(page)).toEqual([]);
});

test('the gist switch is the only thing that takes it away', async ({ page }) => {
  await boot(page, { feature: false });           // shipped state: featureLiveTraffic off
  expect(await page.evaluate(() => tune('featureLiveTraffic'))).toBe(false);
  expect(await frameShown(page)).toBe(false);
  await fly(page);
  expect(await marks(page).count()).toBe(0);
  expect(await asked(page)).toEqual([]);          // and nothing is asked for, either

  // The gist lands after boot, so flipping it has to reach a page already running.
  await page.evaluate(() => { setTune('featureLiveTraffic', true); refreshTrafficFeature(); });
  expect(await frameShown(page)).toBe(true);
  await expect(marks(page)).toHaveCount(2);
});

test('it draws around the map, with no fix at all', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setView([32.05, 34.92], 10));
  await page.waitForTimeout(700);
  await expect(marks(page)).toHaveCount(2);
  // The feeds put the position in the path, so the tunable is a template.
  expect((await asked(page)).pop()).toMatch(/\/lat\/32\.05\d*\/lon\/34\.92\d*\/dist\/40$/);
});

// A drag across the country is a request to see the traffic there -- but a drag fires
// moveend continuously, and each one would be a request over the wire.
test('panning somewhere else asks about there, once', async ({ page }) => {
  await boot(page, { body: { ac: [] } });
  await page.evaluate(() => map.setView([32.05, 34.92], 10));
  await page.waitForTimeout(700);
  const before = (await asked(page)).length;
  await page.evaluate(async () => {
    map.setView([33.00, 35.40], 10);
    map.setView([33.01, 35.41], 10);      // a nudge, not a new place to look at
    await new Promise(r => setTimeout(r, 900));
  });
  const after = await asked(page);
  expect(after.length).toBe(before + 1);
  expect(after.pop()).toContain('/lat/33.0');
});

// A fix outranks the map: the traffic that matters is the traffic around the aircraft, not
// around whatever corner of the chart was last dragged into view.
test('a fix decides where it asks about, over the map centre', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setView([31.20, 34.70], 9));   // looking somewhere else
  await fly(page, 32.05, 34.92);
  await expect(marks(page)).toHaveCount(2);
  expect((await asked(page)).pop()).toContain('/lat/32.05');
});

test('each mark says who and how high, pointing where it is going', async ({ page }) => {
  await boot(page);
  await fly(page);
  const first = await page.evaluate(() => {
    const el = document.querySelector('.traffic-mark');
    return { text: el.textContent.trim(), rotated: el.querySelector('.traffic-arrow').style.transform };
  });
  expect(first.text).toContain('BBG802');       // trimmed: the feed pads callsigns to 8
  expect(first.text).toContain('FL160');         // 15 975 ft, shown as flight level
  expect(first.rotated).toBe('rotate(284.9deg)');
});

test('tapping one opens the inspector on it, in flight', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(() => map.setView([32.10, 34.90], 10));
  await page.locator('.traffic-mark').first().click({ force: true });
  const out = await page.evaluate(() => ({
    sel: state.selected,
    title: document.getElementById('insp-title').value,
    rows: [...document.querySelectorAll('#insp-body .row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' '),
  }));
  // The in-flight rule hides the inspector because the panel covers the chart. A tap on an
  // aircraft is the pilot asking for exactly that panel.
  expect(out.sel).toEqual({ type: 'traffic', hex: '4c80b8' });
  expect(out.title).toBe('BBG802');
  expect(out.rows).toMatch(/15975 ft/);
  expect(out.rows).toMatch(/377 kt/);
  expect(out.rows).toMatch(/A320/);
  expect(out.rows).toMatch(/2225/);
});

test('the open inspector follows new reports for its selected aircraft', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(() => map.setView([32.10, 34.90], 10));
  await page.locator('.traffic-mark').first().click({ force: true });
  await expect(page.locator('#insp-body')).toContainText('15975 ft');

  await page.evaluate(async (report) => {
    window.__body = { ac: [report] };
    await window.trafficPoll();
  }, { ...AC[0], alt_baro: 17200, gs: 401, track: 301.2, lat: 32.12, lon: 34.93 });

  await expect(page.locator('#insp-body')).toContainText('17200 ft');
  await expect(page.locator('#insp-body')).toContainText('401 kt');
  await expect(page.locator('#insp-body')).toContainText('301°');
  await expect(page.locator('#insp-body')).toContainText(/32°07\.2/);
});

test('the traffic inspector follows its aircraft until follow is stopped', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(() => map.setView([32.10, 34.90], 10));
  await page.locator('.traffic-mark').first().click({ force: true });
  const follow = page.locator('#insp-traffic-follow');
  await expect(follow).toHaveText('Follow aircraft');

  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  const startState = await page.evaluate(() => ({
    ownFollow: gpsFollow,
    storedFollow: localStorage.getItem('navaid.gpsFollow'),
  }));
  // Centred in the map you can see -- beside the open inspector, not under it.
  expect(await seen(page, 32.10, 34.90)).toEqual({ onMap: true, underPanel: false });
  expect(startState.ownFollow).toBe(true);
  expect(startState.storedFollow).toBeNull();

  await page.evaluate(async (report) => {
    window.__body = { ac: [report] };
    await window.trafficPoll();
  }, { ...AC[0], alt_baro: 16200, lat: 32.16, lon: 34.96 });
  await expect.poll(() => seen(page, 32.16, 34.96)).toEqual({ onMap: true, underPanel: false });
  const followedAt = await page.evaluate(() => map.getCenter());
  await expect(follow).toHaveText('Stop following');
  await page.evaluate(() => {
    window.__geoCb({ coords: { latitude: 32.05, longitude: 34.92, accuracy: 5 }, timestamp: Date.now() });
  });
  // The pilot's own fix does not take the view back while an aircraft is followed.
  await expect.poll(() => page.evaluate(() => map.getCenter().lat)).toBeCloseTo(followedAt.lat, 4);

  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  const stoppedAt = await page.evaluate(() => map.getCenter());
  await page.evaluate(async (report) => {
    window.__body = { ac: [report] };
    await window.trafficPoll();
  }, { ...AC[0], lat: 32.20, lon: 35.02 });
  await expect.poll(() => page.evaluate(() => map.getCenter().lat)).toBeCloseTo(stoppedAt.lat, 4);
  await expect.poll(() => page.evaluate(() => map.getCenter().lng)).toBeCloseTo(stoppedAt.lng, 4);
  expect(await page.evaluate(() => localStorage.getItem('navaid.gpsFollow'))).toBeNull();

  await follow.click();
  await page.locator('#insp-close').click();
  expect(await page.evaluate(() => window.trafficFollowTarget())).toBe('');
});

// Reported: on a phone, following an aircraft put it in the middle of the screen -- under the
// inspector sheet that carries Stop following. It goes to the middle of the map left uncovered.
test('on a phone the followed aircraft sits above the inspector sheet, not under it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await fly(page);
  await page.evaluate(() => map.setView([32.10, 34.90], 10));
  await page.evaluate(() => { state.selected = { type: 'traffic', hex: '4c80b8' }; showInspector(); });
  await page.locator('#insp-traffic-follow').click();
  const r = await page.evaluate(() => {
    const box = map.getContainer().getBoundingClientRect();
    const p = map.latLngToContainerPoint([32.10, 34.90]);
    const y = box.top + p.y;
    const sheet = document.getElementById('inspector').getBoundingClientRect();
    const strip = document.getElementById('deck-strip').getBoundingClientRect();
    return { y, sheetTop: sheet.top, stripBottom: strip.bottom };
  });
  expect(r.y).toBeLessThan(r.sheetTop);
  expect(r.y).toBeGreaterThan(r.stripBottom);
  // Centred in that gap, give or take.
  expect(Math.abs(r.y - (r.stripBottom + r.sheetTop) / 2)).toBeLessThan(12);
});

test('turning traffic off clears its temporary follow target', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(() => map.setView([32.10, 34.90], 10));
  await page.locator('.traffic-mark').first().click({ force: true });
  await page.locator('#insp-traffic-follow').click();
  expect(await page.evaluate(() => window.trafficFollowTarget())).toBe('4c80b8');

  await page.evaluate(() => {
    const cb = document.getElementById('traffic-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.trafficFollowTarget())).toBe('');
});

test('an aircraft that stops being heard takes its panel with it', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(() => map.setView([32.10, 34.90], 10));
  await page.locator('.traffic-mark').first().click({ force: true });
  expect(await page.evaluate(() => state.selected.type)).toBe('traffic');
  await page.evaluate(async () => {
    window.__body = { ac: [] };
    await window.trafficPoll();
    await new Promise(r => setTimeout(r, 200));
  });
  expect(await page.evaluate(() => state.selected)).toBeNull();
  expect(await marks(page).count()).toBe(0);
});

test('the toggle is remembered, and off means off even in the air', async ({ page }) => {
  await boot(page);
  await fly(page);
  await expect(marks(page)).toHaveCount(2);
  await page.evaluate(() => {
    const cb = document.getElementById('traffic-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  expect(await marks(page).count()).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('navaid.showTraffic'))).toBe('0');
});

// The own-ship is in the feed too when its transponder is on, and a second aeroplane drawn
// on top of yourself reads as traffic in your lap.
test('your own aircraft is not drawn as traffic', async ({ page }) => {
  await boot(page, { body: { ac: [{ hex: 'own111', flight: 'SELF', lat: 32.05, lon: 34.92, alt_baro: 1200 }, ...AC] } });
  await fly(page, 32.05, 34.92);
  const names = await page.evaluate(() => (window.trafficAircraft || []).map(a => a.flight));
  expect(names).not.toContain('SELF');
  expect(names).toEqual(expect.arrayContaining(['BBG802', 'ELY321']));
});

// One aeroplane, whichever spelling the feed uses: adsb.lol says ac/alt_baro/t, a proxy of
// one's own would more likely say aircraft/alt/type. Both have to read the same.
test('it reads either spelling of the feed', async ({ page }) => {
  await boot(page, { body: { aircraft: [{ hex: 'abc123', callsign: 'ISR44', lat: 32.10, lng: 34.90, alt: 3300, heading: 90, speed: 140, type: 'C172', squawk: '7000' }] } });
  await fly(page);
  const a = await page.evaluate(() => window.trafficAircraft[0]);
  expect(a).toMatchObject({ hex: 'abc123', flight: 'ISR44', lat: 32.10, lon: 34.90, alt: 3300, track: 90, gs: 140, type: 'C172' });
  expect(await page.evaluate(() => document.querySelector('.traffic-mark').textContent)).toContain('ISR44');
});

// An aeroplane on the runway reports alt_baro "ground", not a number.
// On the ground it is drawn quiet -- no label at all (asked, decluttering a busy airport); it is
// still named on hover (the marker's title) and on a tap (the inspector).
test('an aircraft on the ground is drawn quiet, named on hover', async ({ page }) => {
  await boot(page, { body: { ac: [{ hex: 'gnd001', flight: 'ELY7', lat: 32.10, lon: 34.90, alt_baro: 'ground', track: 0 }] } });
  await fly(page);
  await page.evaluate(() => map.setView([32.10, 34.90], 11, { animate: false }));
  await page.waitForTimeout(200);
  const el = await page.evaluate(() => { const m = document.querySelector('.traffic-mark'); const l = m.querySelector('.traffic-label');
    return { shown: !!(l && l.getClientRects().length), title: m.title, ground: m.classList.contains('traffic-ground') }; });
  expect(el.ground).toBe(true);
  expect(el.shown).toBe(false);
  expect(el.title).toBe('ELY7');
  // Asked: "zooming in restore the plane info?" -- at airport zoom the callsign comes back (no altitude).
  await page.evaluate(() => map.setView([32.10, 34.90], 14, { animate: false }));
  await page.waitForTimeout(200);
  const near = await page.evaluate(() => { const l = document.querySelector('.traffic-mark .traffic-label');
    return { shown: !!(l && l.getClientRects().length), text: l.textContent }; });
  expect(near).toEqual({ shown: true, text: 'ELY7' });
});

// One dropped request is not an outage. The feed times out or rate-limits now and then, and
// complaining on the first failure put "Live traffic unavailable" over a map that was
// drawing traffic perfectly well -- which is how a pilot learns to ignore messages.
test('a single dropped request says nothing', async ({ page }) => {
  await boot(page);
  await fly(page);
  await expect(marks(page)).toHaveCount(2);
  await page.evaluate(() => { window.__toasts = []; const t = window.showToast; window.showToast = (m) => { window.__toasts.push(m); return t && t(m); }; });
  await page.evaluate(async () => { window.__fail = 'Timeout'; await window.trafficPoll(); });
  expect(await page.evaluate(() => window.__toasts)).toEqual([]);
  // ...and what is already on the map stays there rather than blinking out.
  expect(await marks(page).count()).toBe(2);
});

test('a real outage says so, and says why', async ({ page }) => {
  await boot(page, { body: { ac: [] } });      // nothing on the map to look at
  await fly(page);
  await page.evaluate(() => { window.__toasts = []; const t = window.showToast; window.showToast = (m) => { window.__toasts.push(m); return t && t(m); }; });
  await page.evaluate(async () => {
    window.__fail = 'HTTP 429';
    for (let i = 0; i < 3; i++) await window.trafficPoll();
  });
  const toasts = await page.evaluate(() => window.__toasts);
  expect(toasts.length).toBe(1);               // once, not once per poll
  expect(toasts[0]).toMatch(/HTTP 429/);
  expect(await page.evaluate(() => window.trafficLastError.fails)).toBe(3);

  // And it goes quiet again the moment the feed answers.
  await page.evaluate(async () => { window.__fail = ''; window.__body = { ac: [] }; await window.trafficPoll(); });
  expect(await page.evaluate(() => window.trafficLastError)).toBeNull();
});

// Red on an aviation display means resolve it now. Traffic is information.
test('the aircraft are not red, and the colour is tunable', async ({ page }) => {
  await boot(page);
  await fly(page);
  const c = await page.evaluate(() => getComputedStyle(document.querySelector('.traffic-plane')).fill);
  expect(c).toBe('rgb(181, 23, 158)');
  await page.evaluate(() => { setTune('trafficArrowColor', '#0044cc'); applyTuningCssVars(); });
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.traffic-plane')).fill))
    .toBe('rgb(0, 68, 204)');
});

// A shape, not a font glyph: an aeroplane seen from above, nose along the track, so which
// way it is going is readable before the label is.
test('each one is an aeroplane, turned to its track', async ({ page }) => {
  await boot(page);
  await fly(page);
  const out = await page.evaluate(() => {
    const el = document.querySelector('.traffic-mark');
    const svg = el.querySelector('svg.traffic-plane');
    return {
      isSvg: !!svg,
      path: svg.querySelector('path').getAttribute('d').slice(0, 8),
      rotated: el.querySelector('.traffic-arrow').style.transform,
      size: svg.getAttribute('width'),
      glyph: el.textContent.includes('\u27a4'),
    };
  });
  expect(out.isSvg).toBe(true);
  expect(out.glyph).toBe(false);              // the old ➤ is gone
  expect(out.path).toBe('M12 1.6 ');
  expect(out.rotated).toBe('rotate(284.9deg)');
  expect(out.size).toBe('22');

  // Size follows the tunable, on the next draw.
  await page.evaluate(async () => { setTune('trafficIconPx', 34); await window.trafficPoll(); });
  expect(await page.evaluate(() => document.querySelector('svg.traffic-plane').getAttribute('width')))
    .toBe('34');
});

// A request already on the wire when the layer is switched off used to arrive afterwards and
// draw its aeroplanes onto a map that was meant to be clear of them.
test('a response that outlives its switch-off is discarded', async ({ page }) => {
  await boot(page);
  await fly(page);
  await expect(marks(page)).toHaveCount(2);

  const after = await page.evaluate(async () => {
    // Hold the next response open, switch the layer off underneath it, then let it land.
    let release;
    const held = new Promise((r) => { release = r; });
    const tts = window.Capacitor.Plugins.CapacitorHttp;
    const real = tts.request;
    tts.request = () => held.then(() => ({ status: 200, data: window.__body }));
    const poll = window.trafficPoll();
    await new Promise((r) => setTimeout(r, 50));
    const cb = document.getElementById('traffic-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));   // off: map is cleared
    const cleared = document.querySelectorAll('.traffic-mark').length;
    release();
    await poll;
    await new Promise((r) => setTimeout(r, 100));
    tts.request = real;
    return { cleared, afterLanding: document.querySelectorAll('.traffic-mark').length,
             list: (window.trafficAircraft || []).length };
  });
  expect(after.cleared).toBe(0);
  expect(after.afterLanding).toBe(0);      // the stale answer did not put them back
  expect(after.list).toBe(0);
});

// trafficApiUrl is documented as gist-configurable. setTune had no branch for a text spec,
// so the value fell through to the numeric check and was silently rejected — and the tuning
// panel rendered a range slider with min/max of undefined for it.
test('the endpoint is settable, and the panel gives it a text field', async ({ page }) => {
  await boot(page);
  const set = await page.evaluate(() => {
    const before = tune('trafficApiUrl');
    setTune('trafficApiUrl', 'https://example.test/v2/lat/{lat}/lon/{lon}/dist/{dist}');
    const after = tune('trafficApiUrl');
    setTune('trafficApiUrl', 42);          // not a string: refused, value kept
    return { before, after, afterBadValue: tune('trafficApiUrl') };
  });
  expect(set.after).toBe('https://example.test/v2/lat/{lat}/lon/{lon}/dist/{dist}');
  expect(set.after).not.toBe(set.before);
  expect(set.afterBadValue).toBe(set.after);

  // ...and it is asked for at the new address.
  await page.evaluate(() => { window.__asked.length = 0; });
  await fly(page);
  expect((await asked(page)).pop()).toContain('example.test');

  await page.goto('?lang=en&nogist&tune=1');
  await page.waitForFunction(() => !!document.getElementById('tuning-panel'));
  const control = await page.evaluate(() => {
    const field = document.getElementById('tune-trafficApiUrl-text');
    return { exists: !!field, type: field && field.type, value: field && field.value,
             range: !!document.getElementById('tune-trafficApiUrl-range') };
  });
  expect(control.exists).toBe(true);
  expect(control.type).toBe('text');
  expect(control.range).toBe(false);       // not a slider for a URL
  expect(control.value).toContain('adsb.lol');
});

// Asked: "can ADS-B show a helicopter? it shows planes only, even if it is a heli". A helicopter
// is drawn as one -- by its emitter category (A7, rotorcraft) or, where a report carries none,
// by its type code. The inspector names it, and shows the aircraft type rather than the
// report's source tag (it said "Type adsb_icao").
test('a helicopter is drawn as a helicopter, and the inspector names its type', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(async (body) => { window.__body = body; await window.trafficPoll(); }, { ac: [
    { hex: 'aaa001', flight: 'HELI1', lat: 32.06, lon: 34.93, alt_baro: 1500, track: 90, gs: 110, category: 'A7', type: 'adsb_icao' },
    { hex: 'aaa002', flight: 'HELI2', lat: 32.07, lon: 34.94, alt_baro: 1200, track: 180, gs: 100, t: 'R44', type: 'mlat' },
    { hex: 'aaa003', flight: 'PLANE', lat: 32.08, lon: 34.95, alt_baro: 3500, track: 270, gs: 140, t: 'C172', category: 'A1', type: 'adsb_icao' },
  ] });
  const kinds = await page.evaluate(() => [...document.querySelectorAll('.traffic-mark')].map(m =>
    [m.querySelector('.traffic-label').textContent.split(' ')[0], m.querySelector('.traffic-heli') ? 'heli' : 'plane']).sort());
  expect(kinds).toEqual([['HELI1', 'heli'], ['HELI2', 'heli'], ['PLANE', 'plane']]);
  // The inspector: the aircraft type and the word, never the source tag.
  const typeRow = async (hex) => page.evaluate((h) => {
    state.selected = { type: 'traffic', hex: h }; showInspector();
    const row = [...document.querySelectorAll('#inspector .row')].find(r => /Type/.test(r.textContent));
    return row ? row.querySelector('.val').textContent : null;
  }, hex);
  expect(await typeRow('aaa001')).toBe('Helicopter');
  expect(await typeRow('aaa002')).toBe('R44 · Helicopter');
  expect(await typeRow('aaa003')).toBe('C172');
});

test('a GDL90 receiver target with the rotorcraft emitter category is drawn as a helicopter', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(() => window.trafficSetExternal([
    { hex: 'bbb001', flight: 'RCV1', lat: 32.06, lon: 34.93, alt: 900, gs: 90, track: 45, type: '', category: 7, squawk: '' },
    { hex: 'bbb002', flight: 'RCV2', lat: 32.07, lon: 34.95, alt: 2500, gs: 120, track: 45, type: '', category: 1, squawk: '' },
  ], 'gdl90'));
  await page.waitForTimeout(300);
  const kinds = await page.evaluate(() => [...document.querySelectorAll('.traffic-mark')].map(m =>
    [m.querySelector('.traffic-label').textContent.split(' ')[0], m.querySelector('.traffic-heli') ? 'heli' : 'plane'])
    .filter(k => /^RCV/.test(k[0])).sort());
  expect(kinds).toEqual([['RCV1', 'heli'], ['RCV2', 'plane']]);
});

// Asked, with a Ben Gurion screenshot: aircraft on the ground covered the map, and zoomed out the
// labels overprinted each other. On the ground: smaller, faded, no label. Overlapping labels:
// the first keeps it; the followed or selected aircraft goes first.
test('aircraft on the ground are quiet: small, faded, no label; a slow low helicopter is not', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(() => map.setView([32.02, 34.90], 11, { animate: false }));   // below airport zoom
  await page.evaluate(async (body) => { window.__body = body; await window.trafficPoll(); }, { ac: [
    { hex: 'ccc001', flight: 'GND1', lat: 32.00, lon: 34.87, alt_baro: 'ground', gs: 12, track: 90, t: 'B738' },
    { hex: 'ccc002', flight: 'TAXI', lat: 32.01, lon: 34.88, alt_baro: 150, gs: 18, track: 90, t: 'A320' },
    { hex: 'ccc003', flight: 'HOVER', lat: 32.02, lon: 34.89, alt_baro: 300, gs: 10, track: 90, category: 'A7' },
    { hex: 'ccc004', flight: 'AIR', lat: 32.03, lon: 34.95, alt_baro: 4500, gs: 160, track: 90, t: 'C172' },
  ] });
  const by = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.traffic-mark').forEach(m => {
      const lab = m.querySelector('.traffic-label');
      const hex = m.title;
      out[hex] = { ground: m.classList.contains('traffic-ground'), label: !!(lab && lab.getClientRects().length && !lab.classList.contains('traffic-label-hidden')), px: Number(m.querySelector('svg').getAttribute('width')),
        opacity: Number(getComputedStyle(m).opacity) };
    });
    return out;
  });
  expect(by.GND1.ground && !by.GND1.label).toBe(true);
  expect(by.TAXI.ground && !by.TAXI.label).toBe(true);
  expect(by.HOVER.ground).toBe(false);                   // slow and low is how a helicopter flies
  expect(by.AIR.ground).toBe(false);
  expect(by.GND1.px).toBeLessThan(by.AIR.px);
  expect(by.GND1.opacity).toBeLessThan(1);
});

test('labels that would overprint: one shows; the selected aircraft keeps its label', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(() => map.setView([32.05, 34.90], 8, { animate: false }));
  await page.evaluate(async (body) => { window.__body = body; await window.trafficPoll(); }, { ac: [
    { hex: 'ddd001', flight: 'ONE', lat: 32.050, lon: 34.900, alt_baro: 5000, gs: 200, track: 90, t: 'A320' },
    { hex: 'ddd002', flight: 'TWO', lat: 32.052, lon: 34.902, alt_baro: 6000, gs: 210, track: 90, t: 'A320' },
  ] });
  await page.waitForTimeout(200);
  const shown = () => page.evaluate(() => [...document.querySelectorAll('.traffic-label')]
    .filter(l => !l.classList.contains('traffic-label-hidden')).map(l => l.textContent.split(' ')[0]));
  expect((await shown()).length).toBe(1);
  // Select the one whose label is hidden: its label comes first now.
  const hidden = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.traffic-label')].find(x => x.classList.contains('traffic-label-hidden'));
    return l.textContent.split(' ')[0];
  });
  const hex = hidden === 'ONE' ? 'ddd001' : 'ddd002';
  await page.evaluate((h) => { state.selected = { type: 'traffic', hex: h }; showInspector(); window.trafficDeclutter(); }, hex);
  expect(await shown()).toEqual([hidden]);
});

// Reported: "location still drifts" -- in Hebrew the marker's row ran right to left, so the aircraft
// sat at the far end of its box, east of the point it is anchored to, and slid against the chart
// as the zoom changed. The aircraft's centre is its position, in either language, at any zoom.
for (const lang of ['en', 'he']) {
  test(`the aircraft is drawn on its position (${lang})`, async ({ page }) => {
    await boot(page, { lang, body: { ac: [
      { hex: 'pos001', flight: 'ISR972', lat: 32.005, lon: 34.877, alt_baro: 3000, gs: 150, track: 90, t: 'B738' },
      { hex: 'pos002', flight: 'BBG252', lat: 32.000, lon: 34.890, alt_baro: 'ground', gs: 5, track: 0, t: 'B738' },
    ] } });
    await fly(page);
    for (const z of [10, 14]) {
      await page.evaluate((zz) => map.setView([32.003, 34.884], zz, { animate: false }), z);
      await page.waitForTimeout(150);
      const off = await page.evaluate(() => window.trafficAircraft.map((a) => {
        const want = map.latLngToContainerPoint([a.lat, a.lon]);
        const c = map.getContainer().getBoundingClientRect();
        const el = [...document.querySelectorAll('.traffic-mark')].find(m => m.title === a.flight);
        const r = el.querySelector('svg').getBoundingClientRect();
        return Math.hypot(r.left + r.width / 2 - c.left - want.x, r.top + r.height / 2 - c.top - want.y);
      }));
      for (const d of off) expect(d).toBeLessThan(1.5);
    }
  });
}

// Reported (Haifa): a pressure altitude below zero was labelled "FL0-3" -- the padding went in front
// of the sign. It reads FL-003, and FL000 for an aircraft right at the standard pressure level.
test('a negative pressure altitude is labelled FL-003, not FL0-3', async ({ page }) => {
  await boot(page, { body: { ac: [
    { hex: 'neg001', flight: '4XCDE', lat: 32.81, lon: 35.04, alt_baro: -300, gs: 90, track: 340, t: 'C172' },
    { hex: 'neg002', flight: '4XZRO', lat: 32.83, lon: 35.06, alt_baro: 20, gs: 90, track: 340, t: 'C172' },
  ] } });
  await fly(page, 32.82, 35.05);
  const labels = await page.evaluate(() => [...document.querySelectorAll('.traffic-label')].map(l => l.textContent).sort());
  expect(labels).toEqual(['4XCDE FL-003', '4XZRO FL000']);
});

// Reported (Haifa): an aircraft on a runway was hidden by the runway. Runways, the route and its
// waypoints are painted on #overlay, a canvas above the whole Leaflet map, so traffic lives in its
// own pane on the map container, above that canvas -- and still on its position as the map moves.
test('traffic is drawn above the chart overlay (runways), and stays on its position when panned', async ({ page }) => {
  await boot(page, { body: { ac: [{ hex: 'rwy001', flight: '4XCDE', lat: 32.81, lon: 35.043, alt_baro: 500, gs: 70, track: 340, t: 'C172' }] } });
  await fly(page, 32.82, 35.05);
  const z = await page.evaluate(() => {
    const m = document.querySelector('.traffic-mark');
    const pane = m.parentElement;
    const zOf = (el) => Number(getComputedStyle(el).zIndex) || 0;
    // The stacking contexts that decide it are the direct children of the map container.
    const top = (el) => { while (el.parentElement && el.parentElement !== map.getContainer() && el.parentElement !== document.body) el = el.parentElement; return el; };
    const ov = document.getElementById('overlay');
    return { paneOnContainer: pane.parentElement === map.getContainer(), traffic: zOf(top(m)), overlay: zOf(ov),
      overlayAfterMap: !!(map.getContainer().compareDocumentPosition(ov) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  expect(z.paneOnContainer).toBe(true);
  expect(z.traffic).toBeGreaterThan(z.overlay);
  for (const dx of [0, 120]) {
    await page.evaluate((d) => map.panBy([d, 60], { animate: false }), dx);
    await page.waitForTimeout(100);
    const off = await page.evaluate(() => {
      const a = window.trafficAircraft[0], want = map.latLngToContainerPoint([a.lat, a.lon]);
      const c = map.getContainer().getBoundingClientRect(), r = document.querySelector('.traffic-mark svg').getBoundingClientRect();
      return Math.hypot(r.left + r.width / 2 - c.left - want.x, r.top + r.height / 2 - c.top - want.y);
    });
    expect(off).toBeLessThan(1.5);
  }
});
