// @ts-check
// ADS-B traffic on the map.
//
// The community feeds send no CORS headers -- a browser cannot call them at all, verified
// rather than assumed -- and NavAid is a static site with nothing to proxy through. So it
// asks one endpoint that can (dump1090web's /api/traffic: the local receiver first, the
// community feed for what the aerial cannot see). Everything here is off unless a real
// position is driving the map: traffic on a planning chart is decoration, and the battery
// cost is only worth paying in the air.
const { test, expect } = require('./_setup');

const AC = [
  { hex: '4c80b8', flight: 'BBG802', lat: 32.10, lon: 34.90, alt: 15975, track: 284.9, gs: 377, type: 'A320', squawk: '2225' },
  { hex: '738a11', flight: 'ELY321', lat: 32.02, lon: 34.95, alt: 4200, track: 120, gs: 210, type: 'B738', squawk: '4512' },
];

async function boot(page, body = { aircraft: AC }, opts = {}) {
  // A test that watches the requests registers its own handler first; a second one here
  // would take precedence (Playwright uses the last match) and the watcher would see none.
  if (opts.route !== false) {
    await page.route(/api\/traffic.*/, r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  }
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    // The layer ships off (see defaultShowTraffic) because the feed it asks for is not
    // standing yet. These tests are about the layer when it is on: turn it on as the pilot
    // would, once, rather than pretending the default is something it is not.
    localStorage.setItem('navaid.showTraffic', '1');
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    typeof window.trafficRefresh === 'function');
  // The feature is off in the shipped gist (see featureLiveTraffic): turn it on the way the
  // gist would, so these tests are about the layer rather than about the switch above it.
  await page.evaluate(() => { setTune('featureLiveTraffic', true); refreshTrafficFeature(); });
}

const fly = (page, lat = 32.05, lng = 34.92) => page.evaluate(async ([la, ln]) => {
  startLiveLocation();
  window.__geoCb({ coords: { latitude: la, longitude: ln, accuracy: 5 }, timestamp: Date.now() });
  await new Promise(r => setTimeout(r, 900));
}, [lat, lng]);

const marks = (page) => page.locator('.traffic-mark');

// Nobody should be greeted by "Live traffic unavailable" over an empty map: the layer stays
// off until the feed it asks for is standing, and only then does the default flip.
test('it ships off, so a pilot who never asked for it is never told it is broken', async ({ page }) => {
  let asked = 0;
  await page.route(/api\/traffic.*/, r => { asked++; r.fulfill({ status: 200, contentType: 'application/json', body: '{"aircraft":[]}' }); });
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function');
  await page.evaluate(() => { setTune('featureLiveTraffic', true); refreshTrafficFeature(); });
  expect(await page.evaluate(() => document.getElementById('traffic-cb').checked)).toBe(false);
  await fly(page);
  expect(await marks(page).count()).toBe(0);
  expect(asked).toBe(0);
});

test('it draws around the map, with no fix at all', async ({ page }) => {
  const asked = [];
  await page.route(/api\/traffic.*/, r => {
    asked.push(new URL(r.request().url()));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ aircraft: AC }) });
  });
  await boot(page, { aircraft: AC }, { route: false });
  await page.evaluate(() => map.setView([32.05, 34.92], 10));
  await page.waitForTimeout(700);
  await expect(marks(page)).toHaveCount(2);
  const last = asked[asked.length - 1];       // the first went out before the map was moved
  expect(Number(last.searchParams.get('lat'))).toBeCloseTo(32.05, 1);
  expect(Number(last.searchParams.get('lon'))).toBeCloseTo(34.92, 1);
});

// A drag across the country is a request to see the traffic there -- but a drag fires
// moveend continuously, and each one would be a request over the wire.
test('panning somewhere else asks about there, once', async ({ page }) => {
  const asked = [];
  await page.route(/api\/traffic.*/, r => {
    asked.push(new URL(r.request().url()));
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"aircraft":[]}' });
  });
  await boot(page, { aircraft: [] }, { route: false });
  await page.evaluate(() => map.setView([32.05, 34.92], 10));
  await page.waitForTimeout(700);
  const before = asked.length;
  await page.evaluate(async () => {
    map.setView([33.00, 35.40], 10);
    map.setView([33.01, 35.41], 10);      // a nudge, not a new place to look at
    await new Promise(r => setTimeout(r, 900));
  });
  expect(asked.length).toBe(before + 1);
  expect(Number(asked[asked.length - 1].searchParams.get('lat'))).toBeCloseTo(33.0, 1);
});

// A fix outranks the map: the traffic that matters is the traffic around the aircraft, not
// around whatever corner of the chart was last dragged into view.
test('a fix decides where it asks about, over the map centre', async ({ page }) => {
  const asked = [];
  await page.route(/api\/traffic.*/, r => {
    asked.push(new URL(r.request().url()));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ aircraft: AC }) });
  });
  await boot(page, { aircraft: AC }, { route: false });
  await page.evaluate(() => map.setView([31.20, 34.70], 9));   // looking somewhere else
  await fly(page, 32.05, 34.92);
  await expect(marks(page)).toHaveCount(2);
  const last = asked[asked.length - 1];
  expect(Number(last.searchParams.get('lat'))).toBeCloseTo(32.05, 1);
});

test('each mark says who and how high, pointing where it is going', async ({ page }) => {
  await boot(page);
  await fly(page);
  const first = await page.evaluate(() => {
    const el = document.querySelector('.traffic-mark');
    const arrow = el.querySelector('.traffic-arrow');
    return { text: el.textContent.trim(), rotated: arrow.style.transform };
  });
  expect(first.text).toContain('BBG802');
  expect(first.text).toContain('160');            // 15 975 ft, in hundreds, as it is said
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
    rows: [...document.querySelectorAll('#insp-body .row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()),
  }));
  // The in-flight rule hides the inspector because the panel covers the chart. These marks
  // exist ONLY in flight, so a tap on one is the pilot asking for exactly this panel.
  expect(out.sel).toEqual({ type: 'traffic', hex: '4c80b8' });
  expect(out.title).toBe('BBG802');
  expect(out.rows.join(' ')).toMatch(/15975 ft/);
  expect(out.rows.join(' ')).toMatch(/377 kt/);
  expect(out.rows.join(' ')).toMatch(/2225/);
});

test('an aircraft that stops being heard takes its panel with it', async ({ page }) => {
  await boot(page);
  await fly(page);
  await page.evaluate(() => map.setView([32.10, 34.90], 10));
  await page.locator('.traffic-mark').first().click({ force: true });
  expect(await page.evaluate(() => state.selected.type)).toBe('traffic');
  await page.route(/api\/traffic.*/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"aircraft":[]}' }));
  await page.evaluate(async () => { await window.trafficPoll(); await new Promise(r => setTimeout(r, 200)); });
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
  await boot(page, { aircraft: [{ hex: 'own111', flight: 'SELF', lat: 32.05, lon: 34.92, alt: 1200 }, ...AC] });
  await fly(page, 32.05, 34.92);
  const names = await page.evaluate(() => (window.trafficAircraft || []).map(a => a.flight));
  expect(names).not.toContain('SELF');
  expect(names).toEqual(expect.arrayContaining(['BBG802', 'ELY321']));
});

// The gist switch above the pilot's: it decides whether this exists at all, on every device,
// so a feed that goes away (or was never stood up) can be answered without an app release.
test('the gist switch hides the whole thing, however the switch under it was left', async ({ page }) => {
  let asked = 0;
  await page.route(/api\/traffic.*/, r => { asked++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ aircraft: AC }) }); });
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    localStorage.setItem('navaid.showTraffic', '1');   // this pilot asked for traffic...
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.trafficRefresh === 'function');
  expect(await page.evaluate(() => tune('featureLiveTraffic'))).toBe(false);   // ...and ships off
  // No frame to wonder about: a lone disabled tick-box reads as something broken.
  expect(await page.evaluate(() => {
    const f = document.getElementById('traffic-cb').closest('.tb-layer-frame');
    return getComputedStyle(f).display;
  })).toBe('none');
  await fly(page);
  expect(await marks(page).count()).toBe(0);
  expect(asked).toBe(0);

  // The gist lands after boot, so flipping it has to reach a page already running.
  await page.evaluate(() => { setTune('featureLiveTraffic', true); refreshTrafficFeature(); });
  expect(await page.evaluate(() => {
    const f = document.getElementById('traffic-cb').closest('.tb-layer-frame');
    return getComputedStyle(f).display;
  })).not.toBe('none');
  await page.waitForTimeout(600);
  await expect(marks(page)).toHaveCount(2);

  // ...and switching it back off takes the marks away again.
  await page.evaluate(() => { setTune('featureLiveTraffic', false); refreshTrafficFeature(); });
  await page.waitForTimeout(300);
  expect(await marks(page).count()).toBe(0);
});
