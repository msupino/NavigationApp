// @ts-check
// Airfield surface-wind layer: a met barb at every airfield, fed by one batched Open-Meteo
// 10 m forecast and scrubbed by the shared look-ahead slider. Plus the head/cross components
// it puts in the inspector for the nine fields that publish runway designators.
const { test, expect } = require('./_setup');
const { showToolbarControl } = require('./_toolbar');

// Anchored to the Open-Meteo origin so it cannot match a look-alike host embedded elsewhere
// in a URL (CodeQL js/regex/missing-anchor).
const OM_RE = /^https:\/\/api\.open-meteo\.com\//;

// 48 hourly samples starting today 00:00Z, uniform wind, one location object per requested
// coordinate — the multi-location shape Open-Meteo answers a comma-joined request with.
function windBody(url, opts) {
  const o = opts || {};
  const dir = o.dir === undefined ? 270 : o.dir;
  const kt = o.kt === undefined ? 12 : o.kt;
  const gust = o.gust === undefined ? 0 : o.gust;
  const day0 = new Date().toISOString().slice(0, 10);
  const day1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const time = [];
  for (const d of [day0, day1]) {
    for (let h = 0; h < 24; h++) time.push(d + 'T' + String(h).padStart(2, '0') + ':00');
  }
  const n = time.length;
  const params = new URLSearchParams(String(url).split('?')[1] || '');
  const count = (params.get('latitude') || '').split(',').filter(Boolean).length || 1;
  const one = {
    hourly: {
      time,
      wind_speed_10m: new Array(n).fill(kt),
      wind_direction_10m: new Array(n).fill(dir),
      wind_gusts_10m: new Array(n).fill(gust),
    },
  };
  return JSON.stringify(new Array(count).fill(one));
}

async function mockWind(page, opts, onUrl) {
  await page.route(OM_RE, r => {
    const url = r.request().url();
    if (onUrl) onUrl(url);
    return r.fulfill({ status: 200, contentType: 'application/json', body: windBody(url, opts) });
  });
}

async function boot(page, opts, onUrl) {
  await mockWind(page, opts, onUrl);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined'
    && window.NavAid && window.NavAid.afWind
    && document.getElementById('airfield-wind-cb'));
}

// --- barb geometry (pure) ---------------------------------------------------

test('barbTicks follows the met convention: half 5 kt, full 10 kt, pennant 50 kt', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const f = window.NavAid.afWind.barbTicks;
    const pick = (k) => { const t = f(k); return t && [t.calm ? 1 : 0, t.pennants, t.fulls, t.halves]; };
    return { calm: pick(1), five: pick(5), ten: pick(10), fifteen: pick(15), fifty: pick(50), sixtyFive: pick(65) };
  });
  expect(got.calm).toEqual([1, 0, 0, 0]);        // a ring, not a bare shaft
  expect(got.five).toEqual([0, 0, 0, 1]);
  expect(got.ten).toEqual([0, 0, 1, 0]);
  expect(got.fifteen).toEqual([0, 0, 1, 1]);
  expect(got.fifty).toEqual([0, 1, 0, 0]);
  expect(got.sixtyFive).toEqual([0, 1, 1, 1]);
});

test('barbTicks rounds to the nearest 5 kt and refuses nonsense', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const f = window.NavAid.afWind.barbTicks;
    return {
      twelve: f(12) && [f(12).pennants, f(12).fulls, f(12).halves],
      thirteen: f(13) && [f(13).pennants, f(13).fulls, f(13).halves],
      missing: f(null),
      negative: f(-3),
    };
  });
  expect(got.twelve).toEqual([0, 1, 0]);         // 12 -> 10 kt
  expect(got.thirteen).toEqual([0, 1, 1]);       // 13 -> 15 kt
  expect(got.missing).toBeNull();
  expect(got.negative).toBeNull();
});

// --- runway components (pure) -----------------------------------------------

test('a wind straight down the runway is all head component and no crosswind', async ({ page }) => {
  await boot(page);
  const c = await page.evaluate(() => window.NavAid.afWind.favouredEnd('09/27', 90, 10));
  expect(c.end).toBe('09');
  expect(Math.round(c.headKt)).toBe(10);
  expect(Math.round(c.crossKt)).toBe(0);
  expect(c.crossSide).toBe('');
});

test('the favoured end is the one with the head component, not the first listed', async ({ page }) => {
  await boot(page);
  const c = await page.evaluate(() => window.NavAid.afWind.favouredEnd('09/27', 270, 10));
  expect(c.end).toBe('27');
  expect(Math.round(c.headKt)).toBe(10);
});

test('a dead crosswind reports the side it comes from', async ({ page }) => {
  await boot(page);
  const right = await page.evaluate(() => window.NavAid.afWind.favouredEnd('09/27', 180, 10));
  expect(Math.round(right.crossKt)).toBe(10);
  expect(Math.round(right.headKt)).toBe(0);
  expect(right.crossSide).toBe('R');            // wind from the south, landing on 09
  const left = await page.evaluate(() => window.NavAid.afWind.endComponents('09', 0, 10));
  expect(left.crossSide).toBe('L');
});

test('runway designators with a side letter still parse', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => ({
    ends: window.NavAid.afWind.runwayEnds('08L/26R'),
    hdg: window.NavAid.afWind.endHeadingDeg('26R'),
    junk: window.NavAid.afWind.endHeadingDeg('grass'),
  }));
  expect(got.ends).toEqual(['08L', '26R']);
  expect(got.hdg).toBe(260);
  expect(got.junk).toBeNull();
});

// --- the fetch --------------------------------------------------------------

test('switching the layer on makes ONE batched request covering every airfield in knots', async ({ page }) => {
  const urls = [];
  await boot(page, {}, u => urls.push(u));
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => urls.length).toBeGreaterThan(0);
  const url = urls.find(u => u.includes('wind_speed_10m'));
  expect(url).toBeTruthy();
  const params = new URLSearchParams(url.split('?')[1]);
  const lats = params.get('latitude').split(',');
  const lngs = params.get('longitude').split(',');
  expect(lats.length).toBeGreaterThan(20);        // every airfield, not just the ICAO ones
  expect(lats.length).toBe(lngs.length);
  expect(url).toContain('wind_speed_unit=kn');
  expect(url).toContain('wind_gusts_10m');
  expect(url).toContain('timezone=UTC');
  // One call for the whole layer, not one per airfield.
  expect(urls.filter(u => u.includes('wind_speed_10m')).length).toBe(1);
});

test('the layer flag and the store follow the checkbox, and unchecking stops the draw', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => page.evaluate(() => !!(window.NavAid.afWind._store() && window.showAirfieldWind))).toBe(true);
  await page.locator('#airfield-wind-cb').uncheck();
  expect(await page.evaluate(() => window.showAirfieldWind)).toBe(false);
});

test('a failed fetch clears the box and says so rather than leaving a silent empty layer', async ({ page }) => {
  await page.route(OM_RE, r => r.fulfill({ status: 500, contentType: 'text/plain', body: 'nope' }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && window.NavAid.afWind && document.getElementById('airfield-wind-cb'));
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect(page.locator('#airfield-wind-status')).toBeVisible();
  await expect(page.locator('#airfield-wind-status')).toContainText('unavailable');
  await expect(page.locator('#airfield-wind-cb')).not.toBeChecked();
});

// --- the shared look-ahead slider -------------------------------------------

test('the shared look-ahead slider drives the airfield-wind time with no extra fetch', async ({ page }) => {
  const urls = [];
  await boot(page, {}, u => urls.push(u));
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => urls.length).toBeGreaterThan(0);
  const before = urls.filter(u => u.includes('wind_speed_10m')).length;
  const master = page.locator('#lookahead-time');
  await master.fill('6');
  await master.dispatchEvent('input');
  await expect(page.locator('#airfield-wind-time')).toHaveValue('6');
  expect(await page.evaluate(() => window.NavAid.afWind.lookaheadHours())).toBe(6);
  // Scrubbing re-samples what was already fetched. A slider that hits the network on every
  // tick is a slider nobody can drag.
  expect(urls.filter(u => u.includes('wind_speed_10m')).length).toBe(before);
});

test('sampleAt picks the hour nearest the look-ahead and gives up past the fetched range', async ({ page }) => {
  await boot(page, { dir: 200, kt: 18 });
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => page.evaluate(() => !!window.NavAid.afWind._store())).toBe(true);
  const got = await page.evaluate(() => ({
    now: window.NavAid.afWind.sampleAt(0, 0),
    plus3: window.NavAid.afWind.sampleAt(0, 3),
    wayOut: window.NavAid.afWind.sampleAt(0, 400),
  }));
  expect(got.now.dirTrue).toBe(200);
  expect(got.now.kt).toBe(18);
  expect(got.plus3.t - got.now.t).toBe(3 * 3600e3);
  expect(got.wayOut).toBeNull();               // no barb beats a stale barb
});

test('the map label shows direction and speed, gusts only when they exceed the mean', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const w = window.NavAid.afWind;
    return {
      plain: w.windLabel({ dirTrue: 70, kt: 12, gustKt: null }),
      gusty: w.windLabel({ dirTrue: 270, kt: 12, gustKt: 22 }),
      nearlyGusty: w.windLabel({ dirTrue: 270, kt: 12, gustKt: 14 }),
      calm: w.windLabel({ dirTrue: 0, kt: 1, gustKt: null }),
    };
  });
  expect(got.plain).toBe('070/12');            // three digits, like every wind a pilot reads
  expect(got.gusty).toBe('270/12G22');
  expect(got.nearlyGusty).toBe('270/12');      // a 2 kt gust is not a gust
  expect(got.calm).toBe('CALM');
});

// --- the inspector ----------------------------------------------------------

async function openAirfield(page, icao) {
  await page.evaluate(async (name) => {
    if (airfields === null) await loadAirfields();
    const index = airfields.findIndex(a => a.name === name);
    if (index < 0) throw new Error(name + ' missing from airfields.json');
    state.selected = { type: 'airfield', index };
    showInspector();
  }, icao);
}

test('the inspector gives head and cross components for the runway', async ({ page }) => {
  // LLHZ is 10/28. A 100 degrees TRUE wind is 095 magnetic here, so runway 10 has almost
  // all of it as headwind.
  await boot(page, { dir: 100, kt: 15 });
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'LLHZ');
  const line = page.locator('#insp-body .runway-wind-line');
  await expect(line.first()).toBeVisible();
  await expect(line.first()).toContainText('10:');
  await expect(line.first()).toContainText('head');
  await expect(line.first()).toContainText('cross');
  // Model wind is not an observation, and the inspector says so next to the numbers.
  await expect(page.locator('#insp-body .runway-wind-note')).toContainText('not an observation');
});

test('a tailwind is called a tailwind, not a negative headwind', async ({ page }) => {
  // Wind from 280 true on LLHZ 10/28: runway 28 is the favoured end, so the line shows a
  // head component there rather than a minus sign on runway 10.
  await boot(page, { dir: 280, kt: 14 });
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'LLHZ');
  const line = page.locator('#insp-body .runway-wind-line').first();
  await expect(line).toContainText('28:');
  await expect(line).not.toContainText('-');
});

test('a nearly calm forecast says calm instead of rounding noise into components', async ({ page }) => {
  await boot(page, { dir: 40, kt: 1 });
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'LLHZ');
  await expect(page.locator('#insp-body .runway-wind-line').first()).toHaveText('CALM');
});

test('an airfield with no published runways gets no runway-wind row', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'GVULT');            // a strip, no runway designators in the data
  await expect(page.locator('#insp-body .runway-wind-row')).toHaveCount(0);
});

// --- the tunables ------------------------------------------------------------
// Every threshold in this layer is a registry entry, so a gist can move it without a
// release. These check the knobs are wired to the behaviour rather than merely declared.

test('the calm threshold is tunable and moves both the barb and the label', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const w = window.NavAid.afWind;
    const before = { calm: w.barbTicks(4).calm, label: w.windLabel({ dirTrue: 90, kt: 4, gustKt: null }) };
    NavAid.tuningDefaults.afWindCalmMaxKt.value = 5;
    const after = { calm: w.barbTicks(4).calm, label: w.windLabel({ dirTrue: 90, kt: 4, gustKt: null }) };
    NavAid.tuningDefaults.afWindCalmMaxKt.value = 2;
    return { before, after };
  });
  expect(got.before).toEqual({ calm: false, label: '090/4' });
  expect(got.after).toEqual({ calm: true, label: 'CALM' });
});

test('the crosswind deadband is tunable', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const w = window.NavAid.afWind;
    const at = () => w.endComponents('09', 92, 10).crossSide;   // ~0.35 kt of crosswind
    const before = at();
    NavAid.tuningDefaults.afWindCrossDeadbandKt.value = 0.1;
    const after = at();
    NavAid.tuningDefaults.afWindCrossDeadbandKt.value = 0.5;
    return { before, after };
  });
  expect(got.before).toBe('');            // too small to name a side
  expect(got.after).toBe('R');
});

test('the fetch window is tunable and reaches the request', async ({ page }) => {
  const urls = [];
  await boot(page, {}, u => urls.push(u));
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    NavAid.tuningDefaults.afWindForecastDays.value = 4;
  });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => urls.find(u => u.includes('wind_speed_10m')) || '').toContain('forecast_days=4');
});

test('how far past the forecast a barb may be drawn is tunable', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => page.evaluate(() => !!window.NavAid.afWind._store())).toBe(true);
  const got = await page.evaluate(() => {
    const w = window.NavAid.afWind;
    // The mock serves 48 hours from today 00:00Z, so +47 h from now is past its end.
    const before = !!w.sampleAt(0, 47);
    NavAid.tuningDefaults.afWindSampleToleranceMin.value = 360;
    const after = !!w.sampleAt(0, 47);
    NavAid.tuningDefaults.afWindSampleToleranceMin.value = 90;
    return { before, after };
  });
  expect(got.before).toBe(false);
  expect(got.after).toBe(true);
});

test('the barb feather proportions are tunable, and the 5/10/50 kt meanings are not', async ({ page }) => {
  await boot(page);
  const keys = await page.evaluate(() => Object.keys(NavAid.tuningDefaults).filter(k => k.startsWith('afWind')));
  for (const k of ['afWindPennantWidthFactor', 'afWindPennantGapFactor', 'afWindFullTickSlantFactor',
    'afWindHalfTickSlantFactor', 'afWindHalfTickLenFactor', 'afWindCacheMin']) {
    expect(keys).toContain(k);
  }
  // No knob may redefine what a feather MEANS: a barb whose ticks are worth 7 kt is not a
  // barb, and a pilot reading it would be reading it wrong.
  expect(keys.filter(k => /KtPerTick|TickValue|UnitKt/i.test(k))).toEqual([]);
});

// --- the gist switch --------------------------------------------------------

test('the gist can withdraw the whole feature, and switching it back needs no reload', async ({ page }) => {
  await boot(page);
  await showToolbarControl(page, '#airfield-wind-cb');
  const row = page.locator('#airfield-wind-cb').locator('xpath=ancestor::label[1]');
  await expect(row).toBeVisible();
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureAirfieldWind.value = false;
    NavAid.refreshAirfieldWindFeature();
  });
  await expect(row).toBeHidden();
  expect(await page.evaluate(() => window.showAirfieldWind)).toBe(false);
  await page.evaluate(() => {
    NavAid.tuningDefaults.featureAirfieldWind.value = true;
    NavAid.refreshAirfieldWindFeature();
  });
  await expect(row).toBeVisible();
});
