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

// The published wx feed. LLHZ reports a METAR; every other field does not, which is the
// real shape of it -- 5 stations out of 27. `created` is what wxIssuedAt reads first, so the
// report's age is exact rather than inferred from a hand-written DDHHMMZ group.
async function mockWx(page, metar, ageMin) {
  const at = new Date(Date.now() - (ageMin === undefined ? 10 : ageMin) * 60e3);
  const dd = String(at.getUTCDate()).padStart(2, '0');
  const hhmm = String(at.getUTCHours()).padStart(2, '0') + String(at.getUTCMinutes()).padStart(2, '0');
  await page.route('**wx-data/wx.json**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'IAA (brin.iaa.gov.il MobileAeroinfo)',
      stations: metar === null ? {} : {
        LLHZ: { metar: Object.assign({
          icaoId: 'LLHZ',
          rawOb: 'LLHZ ' + dd + hhmm + 'Z 02018KT 9999 FEW030 24/18 Q1013',
          created: at.toISOString(),
          wdir: 20, wspd: 18, wgst: null,
        }, metar || {}) },
      },
    }),
  }));
}

async function mockWind(page, opts, onUrl) {
  await page.route(OM_RE, r => {
    const url = r.request().url();
    if (onUrl) onUrl(url);
    return r.fulfill({ status: 200, contentType: 'application/json', body: windBody(url, opts) });
  });
}

async function boot(page, opts, onUrl) {
  const o = opts || {};
  await mockWx(page, o.metar === undefined ? {} : o.metar, o.metarAgeMin);
  await mockWind(page, o, onUrl);
  await page.goto('?lang=' + (o.lang || 'en') + '&nogist');
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
  await boot(page, { dir: 100, kt: 15, metar: null });
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
  await boot(page, { dir: 280, kt: 14, metar: null });
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'LLHZ');
  const line = page.locator('#insp-body .runway-wind-line').first();
  await expect(line).toContainText('28:');
  await expect(line).not.toContainText('-');
});

test('a nearly calm forecast says calm instead of rounding noise into components', async ({ page }) => {
  await boot(page, { dir: 40, kt: 1, metar: null });
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

// --- measured against modelled ----------------------------------------------

test('at live, a field with a METAR draws its own reported wind, not the model', async ({ page }) => {
  // Model says 270/12 everywhere; LLHZ reports 020/18.
  await boot(page, { dir: 270, kt: 12 });
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => page.evaluate(() => !!window.NavAid.afWind._store())).toBe(true);
  const got = await page.evaluate(() => {
    const w = window.NavAid.afWind;
    const at = (n) => airfields.find(a => a.name === n);
    return { llhz: w.resolvedFor(at('LLHZ'), 0), llks: w.resolvedFor(at('LLKS'), 0) };
  });
  expect(got.llhz).toMatchObject({ dirTrue: 20, kt: 18, observed: true });
  expect(got.llks).toMatchObject({ dirTrue: 270, kt: 12, observed: false });
});

test('scrubbing off live puts the reporting field back on the model, since no report exists for that hour', async ({ page }) => {
  await boot(page, { dir: 270, kt: 12 });
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => page.evaluate(() => !!window.NavAid.afWind._store())).toBe(true);
  const got = await page.evaluate(() => {
    const w = window.NavAid.afWind;
    const llhz = airfields.find(a => a.name === 'LLHZ');
    return { live: w.resolvedFor(llhz, 0), ahead: w.resolvedFor(llhz, 3) };
  });
  expect(got.live.observed).toBe(true);
  expect(got.ahead).toMatchObject({ dirTrue: 270, kt: 12, observed: false });
});

test('a stale METAR is a gap, not a reading, and falls back to the model', async ({ page }) => {
  await boot(page, { dir: 270, kt: 12, metarAgeMin: 360 });
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => page.evaluate(() => !!window.NavAid.afWind._store())).toBe(true);
  const got = await page.evaluate(() =>
    window.NavAid.afWind.resolvedFor(airfields.find(a => a.name === 'LLHZ'), 0));
  expect(got).toMatchObject({ dirTrue: 270, observed: false });
});

test('a variable-direction report has no direction to draw, so the model stands', async ({ page }) => {
  await boot(page, { dir: 270, kt: 12, metar: { wdir: 'VRB', wspd: 3 } });
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => page.evaluate(() => !!window.NavAid.afWind._store())).toBe(true);
  const got = await page.evaluate(() =>
    window.NavAid.afWind.resolvedFor(airfields.find(a => a.name === 'LLHZ'), 0));
  expect(got).toMatchObject({ observed: false });
});

test('a wx feed that is down leaves an all-model layer rather than no layer', async ({ page }) => {
  await boot(page, { dir: 270, kt: 12, metar: null });
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => page.evaluate(() => !!window.NavAid.afWind._store())).toBe(true);
  const got = await page.evaluate(() =>
    window.NavAid.afWind.resolvedFor(airfields.find(a => a.name === 'LLHZ'), 0));
  expect(got).toMatchObject({ dirTrue: 270, observed: false });
});

test('the legend explaining solid against dashed shows only while the layer is on', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await expect(page.locator('#airfield-wind-legend')).toBeHidden();
  await page.locator('#airfield-wind-cb').check();
  const legend = page.locator('#airfield-wind-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText('reported');
  await expect(legend).toContainText('forecast');
  await page.locator('#airfield-wind-cb').uncheck();
  await expect(legend).toBeHidden();
});

test('the inspector note names which wind the components came from', async ({ page }) => {
  await boot(page, { dir: 270, kt: 12 });
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'LLHZ');                       // reports a METAR
  await expect(page.locator('#insp-body .runway-wind-note')).toContainText('Reported wind');
  await openAirfield(page, 'LLKS');                       // does not
  await expect(page.locator('#insp-body .runway-wind-note')).toContainText('not an observation');
});

test('the runway row says WHICH hour its components are for', async ({ page }) => {
  await boot(page, { dir: 100, kt: 15, metar: null });
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'LLHZ');
  const when = page.locator('#insp-body .runway-wind-when');
  await expect(when).toBeVisible();
  await expect(when).toContainText('Z');                 // a Zulu clock, not a bare number
  const live = (await when.textContent()).trim();

  // Move the shared look-ahead: the row must follow it, not keep the hour it opened on.
  // Driven through the element rather than the UI, so the open inspector is not disturbed
  // by opening the toolbar section the slider lives in.
  await page.evaluate(() => {
    const el = document.getElementById('lookahead-time');
    el.value = '5';
    el.dispatchEvent(new Event('input'));
  });
  await expect(when).toContainText('+5');
  expect((await when.textContent()).trim()).not.toBe(live);
});

test('an observation is stamped with when it was made, not with the slider', async ({ page }) => {
  await boot(page, { dir: 270, kt: 12, metarAgeMin: 20 });
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'LLHZ');                      // reports a METAR, so live is observed
  const when = page.locator('#insp-body .runway-wind-when');
  await expect(page.locator('#insp-body .runway-wind-note')).toContainText('Reported wind');
  // wxHhmmZ renders DD/MM HH:MMZ -- a report time, not a "+Nh" offset.
  await expect(when).toContainText('/');
  await expect(when).not.toContainText('+');
});

test('the Hebrew row uses knots in Hebrew and reads runway-first', async ({ page }) => {
  await boot(page, { lang: 'he', dir: 100, kt: 15, metar: null });
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'LLHZ');
  const line = page.locator('#insp-body .runway-wind-line').first();
  await expect(line).toBeVisible();
  // The app writes knots as קשר everywhere else; a Latin unit here also drops an LTR run
  // into the middle of an RTL line, which is what made it read as a jumble.
  await expect(line).toContainText('קשר');
  expect(await line.textContent()).not.toContain('kt');

  // Reading order is right-to-left: the runway id comes first, the side last. Asserted by
  // geometry -- the visual order is the thing that was wrong, and the string cannot show it.
  const order = await page.evaluate(() => {
    const el = document.querySelector('#insp-body .runway-wind-line');
    const bdi = el.querySelector('bdi');
    const items = [{ p: 'id', x: bdi.getBoundingClientRect().left }];
    // Walk every child, text node or element: the line is assembled from spans and the side
    // word has already moved between the two. A probe pinned to one child silently found
    // nothing and passed vacuously -- twice.
    for (const node of el.childNodes) {
      for (const probe of ['משמאל', 'מימין']) {
        const i = node.textContent.indexOf(probe);
        if (i < 0) continue;
        let box;
        if (node.nodeType === 3) {
          const r = document.createRange();
          r.setStart(node, i); r.setEnd(node, i + probe.length);
          box = r.getBoundingClientRect();
        } else {
          box = node.getBoundingClientRect();
        }
        items.push({ p: 'side', x: box.left });
      }
    }
    items.sort((a, b) => b.x - a.x);
    return items.map(i => i.p);
  });
  expect(order).toContain('side');               // else this asserts nothing at all
  expect(order[0]).toBe('id');                   // rightmost, so read first
  expect(order[order.length - 1]).toBe('side');
});

test('the runway id keeps its colon on the right side of the number in Hebrew', async ({ page }) => {
  await boot(page, { lang: 'he', dir: 100, kt: 15, metar: null });
  await page.waitForFunction(() => typeof showInspector === 'function');
  await openAirfield(page, 'LLHZ');
  // Left as plain text, "10:" is a number followed by a neutral colon and bidi moves the
  // colon to the far side -- the row read ":10". Its own isolated LTR run fixes that.
  const bdi = page.locator('#insp-body .runway-wind-line bdi').first();
  await expect(bdi).toHaveText('10:');
  expect(await bdi.getAttribute('dir')).toBe('ltr');
});

for (const lang of ['en', 'he']) {
  test('a narrow inspector wraps the runway line without ever splitting a figure (' + lang + ')', async ({ page }) => {
    // 25 kt at 55 deg off the runway: two digits for BOTH the head and the cross component,
    // which is the longest this line gets.
    await boot(page, { lang, dir: 55, kt: 25, metar: null });
    await page.waitForFunction(() => typeof showInspector === 'function');
    await openAirfield(page, 'LLHZ');
    await expect(page.locator('#insp-body .runway-wind-line').first()).toBeVisible();
    // Squeeze the panel until the line has to wrap. A pilot can drag it this narrow, and
    // the components must survive it.
    await page.evaluate(() => {
      const el = document.getElementById('inspector');
      el.style.width = '190px';
      el.style.maxWidth = '190px';
    });
    const got = await page.evaluate(() => {
      const line = document.querySelector('#insp-body .runway-wind-line');
      const box = line.getBoundingClientRect();
      const parent = line.parentElement.getBoundingClientRect();
      // An RTL span yields one client rect PER BIDI RUN, so counting rects reports splits
      // that are not there. Distinct rect tops is the honest measure of "how many lines".
      const qty = [...line.querySelectorAll('.runway-wind-qty')].map(q =>
        new Set([...q.getClientRects()].map(r => Math.round(r.top))).size);
      return {
        wrapped: box.height > 20,
        qtyLines: qty,
        overflowRight: Math.round(box.right - parent.right),
        overflowLeft: Math.round(parent.left - box.left),
      };
    });
    expect(got.wrapped).toBe(true);                 // the case this test exists for
    // "cross 19" ending one line and "kt" starting the next is a crosswind a pilot can
    // misread at a glance. Every figure stays whole -- and so does the side phrase, which
    // is three words in English and used to wrap as "... from the" with a lone "left".
    expect(got.qtyLines).toEqual([1, 1, 1]);
    expect(got.overflowRight).toBeLessThanOrEqual(0);
    expect(got.overflowLeft).toBeLessThanOrEqual(0);
  });
}

test('zoomed out past the gate the layer draws nothing, and the gate is tunable', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => { if (airfields === null) await loadAirfields(); });
  await showToolbarControl(page, '#airfield-wind-cb');
  await page.locator('#airfield-wind-cb').check();
  await expect.poll(() => page.evaluate(() => !!window.NavAid.afWind._store())).toBe(true);
  // Count what the layer actually paints, by tallying strokes on the overlay canvas.
  const drawnAt = (z) => page.evaluate((zoom) => {
    map.setZoom(zoom);
    let n = 0;
    const orig = octx.stroke;
    octx.stroke = function () { n++; return orig.apply(this, arguments); };
    try { drawAirfieldWind(); } finally { octx.stroke = orig; }
    return n;
  }, z);
  // At country zoom 27 full-size barbs overlap each other and the airfields they belong to,
  // and their labels are suppressed there anyway: a scatter of dashes, not a wind picture.
  expect(await drawnAt(8)).toBe(0);
  expect(await drawnAt(10)).toBeGreaterThan(0);
  // The gate moves with the tunable, in both directions.
  await page.evaluate(() => { NavAid.tuningDefaults.afWindMinZoom.value = 11; });
  expect(await drawnAt(10)).toBe(0);
  await page.evaluate(() => { NavAid.tuningDefaults.afWindMinZoom.value = 4; });
  expect(await drawnAt(8)).toBeGreaterThan(0);
  await page.evaluate(() => { NavAid.tuningDefaults.afWindMinZoom.value = 9; });
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
    // Three hours past the last hour the mock serves. Derived from the store rather than a
    // fixed +47, which only lands past the end at certain times of day -- the first version
    // of this test passed at 05:00Z and failed at 06:00Z.
    const times = w._store().times;
    const pastEndH = (times[times.length - 1] - Date.now()) / 3600e3 + 3;
    const before = !!w.sampleAt(0, pastEndH);          // 90 min of slack: too far
    NavAid.tuningDefaults.afWindSampleToleranceMin.value = 4 * 60;
    const after = !!w.sampleAt(0, pastEndH);           // 4 h of slack: reaches it
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
