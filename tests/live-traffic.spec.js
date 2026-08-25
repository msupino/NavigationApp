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
  await page.goto('?lang=en&nogist');
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
const asked = (page) => page.evaluate(() => window.__asked || []);
const frameShown = (page) => page.evaluate(() => {
  const f = document.getElementById('traffic-cb').closest('.tb-layer-frame');
  return getComputedStyle(f).display !== 'none';
});

// A browser cannot read these feeds however the switches are set, so it is not offered one.
// A tick-box that can only ever say "Live traffic unavailable" is worse than no tick-box.
test('a plain browser is not offered it at all', async ({ page }) => {
  await boot(page, { native: false });
  expect(await page.evaluate(() => tune('featureLiveTraffic'))).toBe(true);
  expect(await frameShown(page)).toBe(false);
  await fly(page);
  expect(await marks(page).count()).toBe(0);
});

test('the gist switch hides it in the APK too, however the switch under it was left', async ({ page }) => {
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
  expect(first.text).toContain('160');          // 15 975 ft, in hundreds, as it is said
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
test('an aircraft on the ground is drawn without an altitude', async ({ page }) => {
  await boot(page, { body: { ac: [{ hex: 'gnd001', flight: 'ELY7', lat: 32.10, lon: 34.90, alt_baro: 'ground', track: 0 }] } });
  await fly(page);
  const el = await page.evaluate(() => document.querySelector('.traffic-mark').textContent.trim());
  expect(el).toContain('ELY7');
  expect(el).not.toMatch(/\d\d\d/);
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
