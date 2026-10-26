// @ts-check
// Regressions for the ui.js audit findings: one test per fix, each the reported failure.
const { test, expect, answerAppDialogs } = require('./_setup');

async function boot(page, query) {
  await page.goto(query || '?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof draw === 'function'
    && typeof parseSearchLatLng === 'function');
}

// An Open-Meteo answer shaped like the request: every hourly field asked for, at every point.
function meteoBody(url, value) {
  const u = new URL(url);
  const lats = (u.searchParams.get('latitude') || '').split(',');
  const fields = (u.searchParams.get('hourly') || '').split(',');
  const now = new Date(Math.round(Date.now() / 3600e3) * 3600e3);
  const time = [0, 1, 2, 3].map(h => new Date(now.getTime() + h * 3600e3).toISOString().slice(0, 16));
  const one = () => {
    const hourly = { time };
    for (const f of fields) hourly[f] = time.map(() => value);
    return { latitude: 32, longitude: 35, elevation: 10, hourly };
  };
  return JSON.stringify(lats.length > 1 ? lats.map(one) : one());
}

test('unlettered search coordinates split their numbers evenly', async ({ page }) => {
  await boot(page);
  const parse = t => page.evaluate(s => parseSearchLatLng(s), t);
  const a = await parse('32 30 35 00');
  expect(a.lat).toBeCloseTo(32.5, 4);
  expect(a.lng).toBeCloseTo(35, 4);
  const b = await parse('32 30 034 50');
  expect(b.lat).toBeCloseTo(32.5, 4);
  expect(b.lng).toBeCloseTo(34.8333, 3);
  const c = await parse('32 30 30 035 00 30');
  expect(c.lat).toBeCloseTo(32.5083, 3);
  expect(c.lng).toBeCloseTo(35.0083, 3);
  // An odd count has no honest split.
  expect(await parse('32 30 35')).toBeNull();
});

test('a route edited while its wind is fetched asks again for the edited route', async ({ page }) => {
  const urls = [];
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('https://api.open-meteo.com/**', async route => {
    const url = route.request().url();
    urls.push(url);
    if (urls.length === 1) await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: meteoBody(url, 10) });
  });
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35, name: 'B' }];
    syncLegs(); draw();
    window.__p = fetchRouteWind();
  });
  await expect.poll(() => urls.length).toBe(1);
  await page.evaluate(() => { state.waypoints[1].lat = 32.6; syncLegs(); });
  release();
  await expect.poll(() => urls.length).toBe(2);
  const latOf = u => new URL(u).searchParams.get('latitude');
  expect(latOf(urls[1])).not.toBe(latOf(urls[0]));
  await page.waitForFunction(() => windFetchCache && windFetchCache.sig === windRouteSig());
});

test('a track of 119.7 minutes reads 2:00, not 1:60', async ({ page }) => {
  await boot(page);
  const text = await page.evaluate(() => {
    const panel = document.createElement('div');
    document.body.appendChild(panel);
    renderTrackProfilePanel(panel, { track: [
      { lat: 32, lng: 34.9, t: 0 }, { lat: 32.3, lng: 35, t: 119.7 * 60000 }] });
    return panel.querySelector('.route-profile-totals').textContent;
  });
  expect(text).toContain('2:00');
  expect(text).not.toContain(':60');
});

// Off and on while the first fetch is out, and that fetch fails: the switch-on must not be left
// ticked on "Loading…" with nothing ever drawn.
for (const [name, cbId, statusId, match] of [
  ['airfield wind', 'airfield-wind-cb', 'airfield-wind-status', /wind_speed_10m/],
  ['surface weather', 'surface-wx-cb', 'surface-wx-status', /dew_point_2m/],
]) {
  test(name + ': off/on during a failed fetch tries again', async ({ page }) => {
    let n = 0;
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route('https://api.open-meteo.com/**', async route => {
      const url = route.request().url();
      if (!match.test(url)) return route.fallback();
      n++;
      if (n === 1) { await gate; return route.fulfill({ status: 500, body: 'nope' }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: meteoBody(url, 8) });
    });
    await boot(page);
    await page.evaluate(() => loadAirfields && loadAirfields());
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0
      && window.NavAid && NavAid.afWind && NavAid.surfaceWx);
    const flip = on => page.evaluate(([id, v]) => {
      const c = document.getElementById(id); c.checked = v; c.dispatchEvent(new Event('change'));
    }, [cbId, on]);
    await flip(true);
    await expect.poll(() => n).toBe(1);
    await flip(false);
    await flip(true);
    release();
    await expect.poll(() => n).toBe(2);
    await expect.poll(() => page.evaluate(id => document.getElementById(id).textContent, statusId))
      .not.toMatch(/Loading/);
    expect(await page.evaluate(id => document.getElementById(id).checked, cbId)).toBe(true);
  });
}

test('align Reset all does not build switched-off overlay types', async ({ page }) => {
  await boot(page, '?lang=en&nogist&align=1');
  await page.waitForFunction(() => !!window.airfields && typeof window.overlayAlign === 'object');
  await answerAppDialogs(page, true);
  const before = await page.evaluate(() => navWP.filter(w => w && w._plate).length);
  await page.evaluate(() => window.overlayAlign.enter());
  await page.locator('.ov-align-panel .ov-reset-all').click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    loading: overlayLoadingCount(),
    ifr: !!window.ifrLayerGroup,
    plate: navWP.filter(w => w && w._plate).length,
  }));
  expect(r).toEqual({ loading: 0, ifr: false, plate: before });
});

test('the NOTAM default applied from the gist is not stored as the pilot\'s choice', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const cb = document.getElementById('notam-cb');
    localStorage.removeItem(notamPrefKey());
    localStorage.removeItem('navaid.showNotam.last');
    setTune('defaultShowNotam', !cb.checked);
    NavAid.applyDefaultVisibility();
    return { scoped: localStorage.getItem(notamPrefKey()), last: localStorage.getItem('navaid.showNotam.last') };
  });
  expect(r).toEqual({ scoped: null, last: null });
});

test('a colour picker resets to the gist\'s colour, not the built-in one', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // As if the gist landed after the picker was wired, setting its own waypoint colour.
    localStorage.setItem('navaid.gistCache', JSON.stringify({ waypointFillColor: '#123456' }));
    NavAid.gistDisabled = false;
    if (!NavAid.configUrl) NavAid.configUrl = 'x';
    setTune('waypointFillColor', '#123456');
    const el = document.getElementById('waypoint-color');
    el.value = '#ff0000';
    el.dispatchEvent(new Event('input'));
    el.parentElement.querySelector('.slider-reset').click();
    return { tune: tune('waypointFillColor'), field: el.value, stored: localStorage.getItem('navaid.waypointColor') };
  });
  expect(r).toEqual({ tune: '#123456', field: '#123456', stored: null });
});
