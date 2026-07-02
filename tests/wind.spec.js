// #722 — wind speed/direction effect on a leg / flight path.
// Wind-triangle engine (windTriangle / legWindFor), route-wide wind inputs
// in the View section + corner readout, per-leg override rows and the live
// "With wind" readout in the leg inspector, and round-trip persistence.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof windTriangle === 'function' && typeof legWindFor === 'function' &&
    typeof showInspector === 'function');
}

// Two waypoints due north of each other → true course 0°, dist ~30 NM.
async function seedLeg(page) {
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 35.0, name: 'A' },
                       { lat: 32.5, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 100;
    state.selected = { type: 'leg', index: 0 }; showInspector();
  });
}

test('windTriangle: direct crosswind crabs into the wind, GS < TAS', async ({ page }) => {
  await boot(page);
  const fx = await page.evaluate(() =>
    windTriangle(0, 100, { dir: 270, speed: 20 }));   // wind from the left (west)
  // WCA = asin(-20/100) ≈ -11.5° (crab left, into the wind)
  expect(fx.wcaDeg).toBeCloseTo(-11.54, 1);
  expect(fx.hdgTrue).toBeCloseTo(348.46, 1);
  // GS = 100·cos(WCA) − 0 head component ≈ 98.0
  expect(fx.gs).toBeCloseTo(97.98, 1);
});

test('windTriangle: pure headwind / tailwind shifts GS, zero WCA', async ({ page }) => {
  await boot(page);
  const { head, tail } = await page.evaluate(() => ({
    head: windTriangle(0, 100, { dir: 0, speed: 20 }),
    tail: windTriangle(0, 100, { dir: 180, speed: 20 }),
  }));
  expect(head.wcaDeg).toBeCloseTo(0, 5);
  expect(head.gs).toBeCloseTo(80, 5);
  expect(tail.gs).toBeCloseTo(120, 5);
});

test('windTriangle: calm or unflyable wind returns null', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => ({
    calm: windTriangle(0, 100, { dir: 270, speed: 0 }),
    unflyable: windTriangle(0, 20, { dir: 90, speed: 30 }),  // crosswind > TAS
    noTas: windTriangle(0, 0, { dir: 90, speed: 10 }),
  }));
  expect(r.calm).toBeNull();
  expect(r.unflyable).toBeNull();
  expect(r.noTas).toBeNull();
});

test('legWindFor: per-leg override beats route wind; speed 0 marks calm', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.wind = { dir: 270, speed: 15 };
    const out = {};
    out.global = legWindFor({});                          // falls back to route wind
    out.override = legWindFor({ wind: { dir: 90, speed: 25 } });
    out.partial = legWindFor({ wind: { speed: 25 } });    // dir from route wind
    out.calmLeg = legWindFor({ wind: { speed: 0 } });     // explicit calm
    state.wind = { dir: 270, speed: 0 };
    out.allCalm = legWindFor({});
    return out;
  });
  expect(r.global).toEqual({ dir: 270, speed: 15 });
  expect(r.override).toEqual({ dir: 90, speed: 25 });
  expect(r.partial).toEqual({ dir: 270, speed: 25 });
  expect(r.calmLeg).toBeNull();
  expect(r.allCalm).toBeNull();
});

test('Show-wind toggle reveals the realtime fetch button; no manual wind inputs', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  await boot(page);
  // The manual wind dir/speed inputs are gone — wind only comes from the fetch.
  await expect(page.locator('#wind-dir')).toHaveCount(0);
  await expect(page.locator('#wind-speed')).toHaveCount(0);
  const fetchBtn = page.locator('#wind-fetch');
  await expect(fetchBtn).toBeHidden();
  const toggle = page.locator('#show-wind-cb');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(fetchBtn).toBeVisible();
  // The corner readout still reflects a route-wide wind when one is present.
  await page.evaluate(() => { state.wind = { dir: 300, speed: 18 }; refreshWindInputs(); });
  const readout = page.locator('#wind-readout');
  await expect(readout).toHaveClass(/show/);
  await expect(readout).toContainText('300');
  await expect(readout).toContainText('18');
  await toggle.uncheck();
  await expect(fetchBtn).toBeHidden();
  await expect(readout).not.toHaveClass(/show/);
});

test('Show-wind toggle persists across reload', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  await boot(page);
  await page.locator('#show-wind-cb').check();
  expect(await page.evaluate(() => localStorage.getItem('navaid.showWind'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined');
  await expect(page.locator('#show-wind-cb')).toBeChecked();
  expect(await page.evaluate(() => window.showWind)).toBe(true);
});

test('leg inspector shows the wind-triangle readout and live-updates', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  await page.evaluate(() => {
    window.showWind = true;                // gate the inspector wind rows
    state.wind = { dir: 270, speed: 20 };
    showInspector();                       // rebuild with wind present
  });
  // Direct 20 kt crosswind on TAS 100: HDG ≈ 348T → 343M (magVar −5), GS ≈ 98.
  const fxVal = page.locator('#insp-body .row .val').filter({ hasText: 'GS' });
  await expect(fxVal).toContainText('343');
  await expect(fxVal).toContainText('GS 98');
  await expect(fxVal).toContainText('-12');
  // A calm per-leg wind (from the fetch) hides the readout row.
  await page.evaluate(() => { state.legs[0].wind = { speed: 0 }; showInspector(); });
  await expect(fxVal).toBeHidden();
});

test('leg inspector shows wind dir/speed read-only (no manual inputs)', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  await page.evaluate(() => {
    window.showWind = true;
    state.legs[0].wind = { dir: 90, speed: 35 };   // as set by the realtime fetch
    showInspector();
  });
  // No editable wind inputs — only the leg speed / altitude number inputs remain.
  await expect(page.locator('#insp-body .row input[type="number"]')).toHaveCount(3);
  const rowText = await page.locator('#insp-body .row').allTextContents();
  const joined = rowText.join('\n');
  expect(joined).toMatch(/090°/);                  // wind direction, read-only
  expect(joined).toMatch(/\b35\b/);                // wind speed, read-only
});

test('leg inspector shows "—" when there is no wind', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  await page.evaluate(() => { window.showWind = true; showInspector(); });
  await expect(page.locator('#insp-body .row input[type="number"]')).toHaveCount(3);
  const joined = (await page.locator('#insp-body .row').allTextContents()).join('\n');
  expect(joined).toContain('—');                   // calm / no fetched wind
});

test('route wind + per-leg overrides round-trip through serialize/apply', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  const r = await page.evaluate(() => {
    state.wind = { dir: 240, speed: 12 };
    state.legs[0].wind = { dir: 90, speed: 30 };
    const blob = serializeRoute();
    const verr = validateRoute(blob);
    applyRouteData(JSON.parse(JSON.stringify(blob)));
    return { verr, blob, wind: state.wind, legWind: state.legs[0].wind };
  });
  expect(r.verr).toBeNull();
  expect(r.blob.wind).toEqual({ dir: 240, speed: 12 });
  expect(r.blob.legs[0].wind).toEqual({ dir: 90, speed: 30 });
  expect(r.wind).toEqual({ dir: 240, speed: 12 });
  expect(r.legWind).toEqual({ dir: 90, speed: 30 });
});

test('validateRoute rejects malformed wind, accepts blobs without wind', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const base = { waypoints: [], legs: [], notes: [] };
    return {
      none: validateRoute(base),
      bad: validateRoute({ ...base, wind: 'strong' }),
      badDir: validateRoute({ ...base, wind: { dir: 'west', speed: 5 } }),
      ok: validateRoute({ ...base, wind: { dir: 200, speed: 5 } }),
    };
  });
  expect(r.none).toBeNull();
  expect(r.bad).toContain('root.wind');
  expect(r.badDir).toContain('root.wind.dir');
  expect(r.ok).toBeNull();
});

test('nearestPressureLevelHpa maps CVFR altitudes to winds-aloft levels', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => ({
    sl: nearestPressureLevelHpa(0),
    fl030: nearestPressureLevelHpa(3000),
    fl050: nearestPressureLevelHpa(5000),
    fl100: nearestPressureLevelHpa(10000),
    fl180: nearestPressureLevelHpa(18000),
  }));
  expect(r.sl).toBe(1000);
  expect(r.fl030).toBe(900);
  expect(r.fl050).toBe(850);
  expect(r.fl100).toBe(700);
  expect(r.fl180).toBe(500);
});

test('Fetch wind sets a per-leg wind for every leg (own midpoint + level)', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.sec.weather', '1'); localStorage.setItem('navaid.showWind', '1'); } catch (e) {}
  });
  // Two legs at different altitudes → 850 hPa (5000 ft) and 700 hPa (10000 ft).
  // Multi-location request → Open-Meteo returns an array (one per midpoint).
  await page.route('**api.open-meteo.com/**', route => {
    const now = new Date();
    const t = [now.toISOString().slice(0, 10) + 'T' + String(now.getUTCHours()).padStart(2, '0') + ':00'];
    const loc = (extra) => ({ hourly: Object.assign({ time: t }, extra) });
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        loc({ 'wind_speed_850hPa': [20], 'wind_direction_850hPa': [200],
              'wind_speed_700hPa': [40], 'wind_direction_700hPa': [300] }),
        loc({ 'wind_speed_850hPa': [20], 'wind_direction_850hPa': [200],
              'wind_speed_700hPa': [40], 'wind_direction_700hPa': [300] }),
      ]),
    });
  });
  await boot(page);
  await page.evaluate(() => {
    window.showWind = true;
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' },
                       { lat: 32.3, lng: 35.0, name: 'B' },
                       { lat: 32.6, lng: 35.1, name: 'C' }];
    state.legs = []; syncLegs();
    state.legs[0].inboundAltitude = 5000;   // → 850 hPa → 200/20
    state.legs[1].inboundAltitude = 10000;  // → 700 hPa → 300/40
  });
  await page.locator('#wind-fetch').click();
  await page.waitForFunction(() => state.legs[0].wind && state.legs[1].wind);
  // Status shows the count and the Zulu update stamp (HH:MMZ).
  await expect(page.locator('#wind-fetch-status')).toContainText('Per-leg');
  await expect(page.locator('#wind-fetch-status')).toContainText(/\d{2}:\d{2}Z/);
  expect(await page.evaluate(() => state.legs[0].wind)).toEqual({ dir: 200, speed: 20 });
  expect(await page.evaluate(() => state.legs[1].wind)).toEqual({ dir: 300, speed: 40 });
  // The leg inspector shows the same Zulu update time, read-only.
  await page.evaluate(() => { state.selected = { type: 'leg', index: 0 }; showInspector(); });
  const joined = (await page.locator('#insp-body .row').allTextContents()).join('\n');
  expect(joined).toMatch(/\d{2}:\d{2}Z/);
});

test('Fetch wind with no legs alerts and fetches nothing', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.sec.weather', '1'); localStorage.setItem('navaid.showWind', '1'); } catch (e) {}
  });
  let fetched = false;
  await page.route('**api.open-meteo.com/**', route => { fetched = true; route.abort(); });
  await boot(page);
  await page.evaluate(() => { window.showWind = true; state.waypoints = []; state.legs = []; });
  let alerted = '';
  page.on('dialog', d => { alerted = d.message(); d.dismiss(); });
  await page.locator('#wind-fetch').click();
  await page.waitForFunction(() => true);
  expect(alerted).toMatch(/two waypoints/i);
  expect(fetched).toBe(false);
});

test('Fetch wind surfaces an error when the request fails', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.sec.weather', '1'); localStorage.setItem('navaid.showWind', '1'); } catch (e) {}
  });
  await page.route('**api.open-meteo.com/**', route => route.fulfill({ status: 500, body: 'err' }));
  await boot(page);
  await page.evaluate(() => {
    window.showWind = true;
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
  });
  await page.locator('#wind-fetch').click();
  await expect(page.locator('#wind-fetch-status')).toContainText('failed');
});

test('calm wind is omitted from saved blobs (no schema churn)', async ({ page }) => {
  await boot(page);
  await seedLeg(page);
  const blob = await page.evaluate(() => {
    state.wind = { dir: 270, speed: 0 };
    return serializeRoute();
  });
  expect(blob.wind).toBeUndefined();
  expect(blob.legs[0].wind).toBeUndefined();
});

test('Fetch wind samples each leg at its forecast ETA, not "now" (#leg-wind-forecast)', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.sec.weather', '1'); localStorage.setItem('navaid.showWind', '1'); } catch (e) {}
  });
  // 8 hourly samples from the current hour; wind speed encodes the hour index
  // (10 + idx) so the chosen forecast hour is readable from the leg wind.
  let reqUrl = '';
  await page.route('**api.open-meteo.com/**', route => {
    reqUrl = route.request().url();
    const now = new Date();
    const t = [], spd = [], dir = [];
    for (let i = 0; i < 8; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + i));
      t.push(d.toISOString().slice(0, 13) + ':00');
      spd.push(10 + i); dir.push(100 + 10 * i);
    }
    const loc = () => ({ hourly: { time: t, 'wind_speed_850hPa': spd, 'wind_direction_850hPa': dir } });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([loc(), loc()]) });
  });
  await boot(page);
  await page.evaluate(() => {
    window.showWind = true;
    // Leg 1: ~6 NM at 120 kt (3 min — midpoint ETA ≈ now).
    // Leg 2: ~120 NM at 15 kt (8 h — midpoint ETA ≈ now + 4 h).
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' },
                       { lat: 32.1, lng: 34.9, name: 'B' },
                       { lat: 34.1, lng: 34.9, name: 'C' }];
    state.legs = []; syncLegs();
    state.legs[0].inboundAltitude = 5000; state.legs[0].flightSpeed = 120;
    state.legs[1].inboundAltitude = 5000; state.legs[1].flightSpeed = 15;
  });
  await page.locator('#wind-fetch').click();
  await page.waitForFunction(() => state.legs[0].wind && state.legs[1].wind);
  const w = await page.evaluate(() => ({ w0: state.legs[0].wind, w1: state.legs[1].wind }));
  // Leg 1 gets an early hour (idx 0-1), leg 2 a much later one (idx 4-5):
  // ETA-based sampling, robust to where "now" falls inside the hour.
  expect(w.w0.speed).toBeLessThanOrEqual(11);
  expect(w.w1.speed).toBeGreaterThanOrEqual(14);
  expect(w.w1.speed - w.w0.speed).toBeGreaterThanOrEqual(3);
  // Three forecast days requested so the +24 h departure slider plus route
  // time can't clamp at the last fetched hour.
  expect(reqUrl).toContain('forecast_days=3');
});

test('departure slider shifts every leg\'s sampled forecast hour', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.sec.weather', '1'); localStorage.setItem('navaid.showWind', '1'); } catch (e) {}
  });
  // 30 hourly samples, hour index encoded in the wind speed (10 + idx).
  let fetchCount = 0;
  await page.route('**api.open-meteo.com/**', route => {
    fetchCount++;
    const now = new Date();
    const t = [], spd = [], dir = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + i));
      t.push(d.toISOString().slice(0, 13) + ':00');
      spd.push(10 + i); dir.push(100 + i);
    }
    const loc = () => ({ hourly: { time: t, 'wind_speed_850hPa': spd, 'wind_direction_850hPa': dir } });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([loc()]) });
  });
  await boot(page);
  await page.evaluate(() => {
    window.showWind = true;
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.1, lng: 34.9, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].inboundAltitude = 5000; state.legs[0].flightSpeed = 120;  // ~3 min leg
  });
  // Depart now → early hour.
  await page.locator('#wind-fetch').click();
  await page.waitForFunction(() => state.legs[0].wind);
  const nowSpeed = await page.evaluate(() => state.legs[0].wind.speed);
  expect(nowSpeed).toBeLessThanOrEqual(11);              // idx 0-1
  // Move the slider to +6 h: the wind updates IMMEDIATELY on the input tick
  // (mid-drag, before release) from the cached hourly data — no second
  // click, no second network request.
  const depart = page.locator('#wind-depart');
  await depart.fill('6');
  await depart.dispatchEvent('input');
  await expect(page.locator('#wind-depart-val')).toContainText('+6h');   // shared fmtViewTime readout
  await page.waitForFunction(ns => state.legs[0].wind.speed !== ns, nowSpeed);
  const laterSpeed = await page.evaluate(() => state.legs[0].wind.speed);
  expect(laterSpeed - nowSpeed).toBe(6);                 // exactly +6 forecast hours
  expect(fetchCount).toBe(1);                            // re-sampled from cache
});

test('checking "show wind" pulls the forecast automatically when a route exists', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  let fetched = 0;
  await page.route('**api.open-meteo.com/**', route => {
    fetched++;
    const now = new Date();
    const t = [now.toISOString().slice(0, 13) + ':00'];
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([
      { hourly: { time: t, 'wind_speed_850hPa': [17], 'wind_direction_850hPa': [210] } },
    ]) });
  });
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.1, lng: 34.9, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].inboundAltitude = 5000;
  });
  await page.locator('#show-wind-cb').check();
  await page.waitForFunction(() => state.legs[0].wind);
  expect(await page.evaluate(() => state.legs[0].wind)).toEqual({ dir: 210, speed: 17 });
  expect(fetched).toBe(1);
});

test('checking "show wind" with no route does not fetch and does not alert', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  let fetched = false;
  await page.route('**api.open-meteo.com/**', route => { fetched = true; route.abort(); });
  let alerted = false;
  page.on('dialog', d => { alerted = true; d.dismiss(); });
  await boot(page);
  await page.locator('#show-wind-cb').check();
  await page.waitForTimeout(150);
  expect(fetched).toBe(false);
  expect(alerted).toBe(false);
});
