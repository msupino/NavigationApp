// #670 — airfield METAR / TAF in the inspector (decoded + raw toggle),
// served from the wx-data branch with a same-origin fallback.
const { test, expect } = require('./_setup');

// Mock the wx-data feed. `onHit` lets a test count fetches.
async function mockWx(page, onHit) {
  await page.route('**wx-data/wx.json**', r => {
    if (onHit) onHit();
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      generatedAt: '2026-06-14T06:00:00Z',
      stations: { LLBG: { metar: METAR[0], taf: TAF[0] } },
    }) });
  });
}

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof decodeMetar === 'function' && typeof fetchAirfieldWx === 'function' &&
    typeof showInspector === 'function');
}

const METAR = [{
  icaoId: 'LLBG', rawOb: 'LLBG 140650Z 27012G20KT 9999 FEW030 SCT100 24/18 Q1013',
  wdir: 270, wspd: 12, wgst: 20, visib: '6+', wxString: '-RA BR',
  temp: 24, dewp: 18, altim: 1013, clouds: [{ cover: 'FEW', base: 3000 }, { cover: 'SCT', base: 10000 }],
}];
const TAF = [{
  icaoId: 'LLBG', rawTAF: 'TAF LLBG 140500Z 1406/1506 28010KT 9999 SCT035',
  fcsts: [{ timeFrom: 1781503200, wdir: 280, wspd: 10, visib: '6+', clouds: [{ cover: 'SCT', base: 3500 }] }],
}];

function rgbParts(cssColor) {
  const nums = String(cssColor).match(/[\d.]+/g).map(Number);
  return nums.slice(0, 3);
}

function contrastAgainstWhite(cssColor) {
  const lum = rgbParts(cssColor).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return 1.05 / (l + 0.05);
}

async function expectReadableOnLight(locator) {
  const color = await locator.evaluate(el => getComputedStyle(el).color);
  expect(contrastAgainstWhite(color)).toBeGreaterThanOrEqual(4.5);
}

test('decodeMetar renders wind/vis/wx/cloud/temp/QNH', async ({ page }) => {
  await boot(page);
  const txt = await page.evaluate(m => decodeMetar(m), METAR[0]);
  expect(txt).toContain('Wind 270° 12 kt gust 20');
  expect(txt).toContain('Visibility 6+');
  expect(txt).toContain('Dew point 18°C');
  expect(txt).toContain('light rain');
  expect(txt).toContain('mist');
  expect(txt).toContain('Clouds Few 3000 ft');
  expect(txt).toContain('Temperature 24°C');
  expect(txt).toContain('QNH 1013 hPa');
});

test('decodeTaf expands BECMG/TEMPO and drops an empty visibility', async ({ page }) => {
  await boot(page);
  const T = {
    fcsts: [
      { fcstChange: '', timeFrom: 1781503200, wdir: 'VRB', wspd: 4, visib: '6+', clouds: [{ cover: 'SCT', base: 3000 }] },
      { fcstChange: 'TEMPO', timeFrom: 1781510400, wdir: 150, wspd: 5, visib: '', clouds: [{ cover: 'BKN', base: 2500 }] },
      { fcstChange: 'BECMG', timeFrom: 1781535600, wdir: 290, wspd: 10, visib: '6+', clouds: [{ cover: 'FEW', base: 3000 }] },
    ],
  };
  const out = await page.evaluate(t => decodeTaf(t), T);
  expect(out[0].when).toMatch(/^From /);         // plain FM period
  expect(out[1].when).toMatch(/^Temporary /);    // TEMPO expanded
  expect(out[2].when).toMatch(/^Becoming /);     // BECMG expanded
  expect(out[0].when).not.toContain('BECMG');
  expect(out[1].when).not.toContain('TEMPO');
  // Empty visibility must not leave a dangling "Vis" with no value.
  expect(out[1].text).not.toContain('Vis');
  expect(out[1].text).toContain('Broken 2500 ft');
  expect(out[0].text).toContain('Visibility 6+');   // a real visibility still shows
});

test('airfield inspector shows decoded METAR/TAF with a raw toggle', async ({ page }) => {
  await mockWx(page);
  await boot(page);
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const index = airfields.findIndex(a => a.name === 'LLBG');
    if (index < 0) throw new Error('LLBG missing from airfields.json');
    state.selected = { type: 'airfield', index };
    showInspector();
  });
  const wx = page.locator('#insp-body .wx-section');
  await expect(wx).toBeVisible();
  await expect(wx).toContainText('Wind 270° 12 kt');
  await expect(wx).toContainText('METAR');
  await expect(wx).toContainText('TAF');
  // Toggle to raw.
  await page.locator('.wx-toggle').click();
  await expect(wx).toContainText('27012G20KT');     // raw METAR token
  await expect(wx).toContainText('1406/1506');      // raw TAF token
});

test('light theme keeps decoded and raw METAR/TAF readable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('navaid.theme', 'light'));
  await mockWx(page);
  await boot(page);
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const index = airfields.findIndex(a => a.name === 'LLBG');
    if (index < 0) throw new Error('LLBG missing from airfields.json');
    state.selected = { type: 'airfield', index };
    showInspector();
  });

  const wx = page.locator('#insp-body .wx-section');
  await expect(wx).toBeVisible();
  await expect(wx.locator('.wx-line').first()).toContainText('Wind 270°');

  await expectReadableOnLight(wx.locator('.wx-line').first());
  await expectReadableOnLight(wx.locator('.wx-updated'));
  await expectReadableOnLight(wx.locator('.wx-refresh'));

  await page.locator('.wx-toggle').click();
  await expect(wx).toContainText('27012G20KT');
  await expectReadableOnLight(wx.locator('.wx-line.wx-raw').first());
  await expectReadableOnLight(wx.locator('.wx-toggle'));
});

test('refresh button re-fetches (force, bypassing cache)', async ({ page }) => {
  let calls = 0;
  await mockWx(page, () => { calls++; });
  await boot(page);
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const index = airfields.findIndex(a => a.name === 'LLBG');
    if (index < 0) throw new Error('LLBG missing from airfields.json');
    state.selected = { type: 'airfield', index };
    showInspector();
  });
  await expect(page.locator('#insp-body .wx-section')).toContainText('Wind 270°');
  const before = calls;
  await page.locator('.wx-refresh').click();
  await expect(page.locator('#insp-body .wx-section')).toContainText('Wind 270°');
  expect(calls).toBeGreaterThan(before);          // re-fetched, not served from cache
  // METAR/TAF code blocks forced LTR regardless of UI language.
  expect(await page.locator('.wx-block').first().getAttribute('dir')).toBe('ltr');
});

test('Hebrew no-data message reads RTL, not garbled LTR', async ({ page }) => {
  // No stations in the feed → every field falls back to the no-data message.
  await page.route('**wx-data/wx.json**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt: '2026-06-14T06:00:00Z', stations: {} }),
  }));
  await page.goto('?lang=he');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showInspector === 'function' && typeof fetchAirfieldWx === 'function');
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const index = airfields.findIndex(a => a.name === 'LLBG');
    if (index < 0) throw new Error('LLBG missing from airfields.json');
    state.selected = { type: 'airfield', index };
    showInspector();
  });
  const body = page.locator('#insp-body .wx-body');
  await expect(body).toContainText('אין METAR / TAF לשדה זה');
  // Body follows content direction (dir=auto) so the Hebrew prose resolves RTL
  // from its first strong char instead of being forced LTR and reordered.
  expect(await body.getAttribute('dir')).toBe('auto');
});

// A field with no ICAO code publishes no METAR -- so no observation, no refresh button and
// no "Weather" heading. It does still have weather, though, and density altitude is computed
// from a forecast that needs only a position: Gvulot and Kedem used to get no box at all,
// and with it no density altitude, for want of four letters.
test('a non-ICAO field gets no METAR, but keeps its density altitude', async ({ page }) => {
  await boot(page);
  const shown = await page.evaluate(() => {
    const body = document.createElement('div');
    appendAirfieldWeather(body, { name: 'WP 3', lat: 32, lng: 34.9, elev_ft: 300 });
    const sec = body.querySelector('.wx-section');
    return {
      section: !!sec,
      heading: sec ? sec.querySelector('.wx-head').textContent.trim() : '',
      refresh: !!(sec && sec.querySelector('.wx-refresh')),
      metarBody: !!(sec && sec.querySelector('.wx-body')),
      da: !!(sec && sec.querySelector('.da-group')),
    };
  });
  expect(shown.section).toBe(true);
  expect(shown.da).toBe(true);
  expect(shown.heading).toBe('Density altitude');   // not "Weather (METAR / TAF)"
  expect(shown.refresh).toBe(false);
  expect(shown.metarBody).toBe(false);
});

// AD/WS (aerodrome / wind-shear) warnings from the IMS feed, shown in the airfield WX box.
async function openLLBG(page) {
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const index = airfields.findIndex(a => a.name === 'LLBG');
    state.selected = { type: 'airfield', index };
    showInspector();
  });
}

test('the WX box lists a field\'s active AD/WS warnings', async ({ page }) => {
  await mockWx(page);
  await page.route('**airmet-data/airmet.json**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt: null, airmets: [], airfieldWarnings: { LLBG: [
      { product: 'AD', validFrom: '2020-01-01T00:00:00Z', validTo: '2099-01-01T00:00:00Z',
        raw: 'LLBG AD WRNG 1 VALID 311200/311800 SFC WIND 320/25KT MAX 38KT=' },
      { product: 'WS', validFrom: '2020-01-01T00:00:00Z', validTo: null,
        raw: 'LLBG WS WRNG 2 VALID 311200/311400 WS APCH RWY 12=' },
      { product: 'AD', validFrom: '2020-01-01T00:00:00Z', validTo: '2020-01-02T00:00:00Z',
        raw: 'LLBG AD WRNG 9 EXPIRED-MARKER=' },        // expired -> not shown
    ] } }),
  }));
  await boot(page);
  await page.evaluate(() => loadAirmets(true));
  await openLLBG(page);
  const wx = page.locator('#insp-body .wx-section');
  await expect(wx.locator('.wx-adws')).toContainText('Aerodrome / Wind-shear');
  await expect(wx.locator('.wx-adws')).toContainText('SFC WIND 320/25KT');
  await expect(wx.locator('.wx-adws')).toContainText('WS APCH RWY 12');
  await expect(wx.locator('.wx-adws')).not.toContainText('EXPIRED-MARKER');   // expired filtered
  await expect(wx.locator('.wx-adws-none')).toHaveCount(0);                   // has data -> no None
});

test('the WX box says None when a field has no AD/WS warning', async ({ page }) => {
  await mockWx(page);
  await page.route('**airmet-data/airmet.json**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt: null, airmets: [], airfieldWarnings: {} }),
  }));
  await boot(page);
  await page.evaluate(() => loadAirmets(true));
  await openLLBG(page);
  const wx = page.locator('#insp-body .wx-section');
  await expect(wx.locator('.wx-adws')).toContainText('Aerodrome / Wind-shear');
  await expect(wx.locator('.wx-adws-none')).toHaveText('None');
});

test('the AD/WS label follows content direction — RTL in a Hebrew session', async ({ page }) => {
  await mockWx(page);
  await page.route('**airmet-data/airmet.json**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt: null, airmets: [], airfieldWarnings: {} }),
  }));
  await page.goto('?lang=he');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showInspector === 'function' && typeof fetchAirfieldWx === 'function');
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    if (typeof loadAirmets === 'function') await loadAirmets(true);
    const index = airfields.findIndex(a => a.name === 'LLBG');
    state.selected = { type: 'airfield', index };
    showInspector();
  });
  const adws = page.locator('#insp-body .wx-adws');
  // dir=auto (not forced ltr): the UA lays each line out from its first strong char via
  // bidi-plaintext, so the Hebrew label + its "(AD / WS)" render in the right order. (The
  // CSS `direction` stays inherited; plaintext is what reorders, so that's what we assert.)
  expect(await adws.getAttribute('dir')).toBe('auto');
  expect(await adws.evaluate(el => getComputedStyle(el).unicodeBidi)).toBe('isolate');
  await expect(adws).toContainText('אזהרות שדה');   // Hebrew label present
});
