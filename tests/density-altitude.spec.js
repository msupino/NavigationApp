// @ts-check
// Density altitude in the airfield panel (#157): the elevation the aeroplane actually flies
// from, once temperature and pressure are counted, with a slider that runs a day ahead on
// the hourly forecast -- because the useful question is rarely "what is it now", it is
// "what time can I get out of here".
const { test, expect } = require('./_setup');

// One hourly series starting at the top of the current hour: hot now, cooler overnight.
function series(startMs, hours) {
  const out = { time: [], temperature_2m: [], pressure_msl: [] };
  for (let i = 0; i < hours; i++) {
    const t = new Date(startMs + i * 3600e3);
    out.time.push(t.toISOString().slice(0, 16));
    out.temperature_2m.push(i < 6 ? 38 - i : 22);       // 38 °C now, 22 °C later
    out.pressure_msl.push(1005);
  }
  return out;
}

async function boot(page, opts) {
  const o = opts || {};
  await page.route(/^https:\/\/api\.open-meteo\.com\//, (r) => {
    const start = Date.now() - (Date.now() % 3600e3);
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ hourly: series(start, 36), elevation: 30 }) });
  });
  if (o.metar !== false) {
    await page.route('**wx-data/wx.json**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ generatedAt: new Date().toISOString(), stations: { LLHA: { metar: {
        icaoId: 'LLHA', temp: 33, altim: 1009, rawOb: 'METAR LLHA 33/21 Q1009' } } } }) }));
  }
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
}

// Open the panel on a named field the way a tap does.
async function open(page, icao) {
  await page.evaluate((name) => {
    const i = airfields.findIndex(a => String(a.name || '').toUpperCase() === name);
    state.selected = { type: 'airfield', index: i };
    showInspector();
  }, icao);
  await page.waitForTimeout(400);
}

const readDa = (page) => page.evaluate(() => {
  const row = document.querySelector('.da-row');
  const src = document.querySelector('.da-src-row .val');
  return row ? {
    value: row.querySelector('.val').textContent.trim(),
    warn: row.classList.contains('da-warn'),
    src: src ? src.textContent.trim() : '',
    when: (document.querySelector('.da-when') || {}).textContent,
  } : null;
});

test('the arithmetic is the one the manuals teach', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const D = NavAid.da;
    return {
      // Standard day at sea level: density altitude is the field elevation.
      isaSeaLevel: Math.round(D.densityAltFt(0, 1013, 15)),
      // Low pressure raises the pressure altitude 30 ft per hPa.
      pa: Math.round(D.pressureAltFt(1000, 1003)),
      // ISA falls ~2 °C per thousand feet.
      isaAt5000: Math.round(D.isaTempC(5000) * 10) / 10,
      // A hot day at a 1000 ft field: PA 1300, ISA there 12.4, +120 ft per degree over.
      hot: Math.round(D.densityAltFt(1000, 1003, 38)),
    };
  });
  expect(out.isaSeaLevel).toBe(0);
  expect(out.pa).toBe(1300);
  expect(out.isaAt5000).toBe(5.1);
  expect(out.hot).toBe(1300 + Math.round(120 * (38 - (15 - 1.98 * 1.3))));
});

test('a hot field reads far above its own elevation, and says so in red', async ({ page }) => {
  await boot(page);
  await open(page, 'LLHA');
  const da = await readDa(page);
  expect(da).not.toBeNull();
  expect(da.value).toMatch(/ft$/);
  const ft = Number(da.value.replace(/[^\d-]/g, ''));
  const elev = await page.evaluate(() => airfields.find(a => a.name === 'LLHA').elev_ft);
  expect(ft).toBeGreaterThan(elev + 2000);      // 33 °C at Haifa in summer
  expect(da.warn).toBe(true);
});

// The observation beats the model at hour zero: the METAR is measured on the field, the
// forecast is a grid interpolation of it.
test('hour zero uses the METAR, and says which numbers it used', async ({ page }) => {
  await boot(page);
  await open(page, 'LLHA');
  const da = await readDa(page);
  expect(da.src).toContain('33 °C');
  expect(da.src).toContain('1009 hPa');
  expect(da.src).toContain('METAR');
});

test('the slider runs a day ahead, on the forecast', async ({ page }) => {
  await boot(page);
  await open(page, 'LLHA');
  const hot = Number((await readDa(page)).value.replace(/[^\d-]/g, ''));
  const max = await page.evaluate(() => document.querySelector('.da-time').max);
  expect(Number(max)).toBe(24);

  await page.evaluate(() => {
    const s = document.querySelector('.da-time');
    s.value = '10';                              // ten hours on: 22 °C in the series
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const cool = await readDa(page);
  const cold = Number(cool.value.replace(/[^\d-]/g, ''));
  expect(cold).toBeLessThan(hot);                // cooler air, lower density altitude
  expect(cool.src).toContain('22 °C');
  expect(cool.src).toContain('forecast');
  expect(cool.when).toMatch(/\+10h/);
  expect(cool.warn).toBe(false);                 // and no longer worth colouring
});

// A density altitude with no provenance is a number a pilot cannot argue with. With neither
// an observation nor a forecast, say nothing rather than quietly computing a standard day.
test('with no temperature it shows nothing, not a standard day', async ({ page }) => {
  await page.route(/^https:\/\/api\.open-meteo\.com\//, r => r.fulfill({ status: 500, body: '' }));
  await page.route('**wx-data/wx.json**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: new Date().toISOString(), stations: {} }) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
  await open(page, 'LLHA');
  const da = await readDa(page);
  expect(da.value).toBe('—');
  expect(da.src).toMatch(/no temperature/i);
  expect(da.warn).toBe(false);
});

test('the gist can take the whole section away', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setTune('featureDensityAltitude', false));
  await open(page, 'LLHA');
  expect(await page.locator('.da-row').count()).toBe(0);
  // ...and the elevation it sits under is untouched.
  expect(await page.locator('#insp-body .row').allTextContents()).toEqual(
    expect.arrayContaining([expect.stringMatching(/Elevation/)]));
});

test('the forecast is asked for once per field', async ({ page }) => {
  let asked = 0;
  await page.route(/^https:\/\/api\.open-meteo\.com\//, (r) => {
    asked++;
    const start = Date.now() - (Date.now() % 3600e3);
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ hourly: series(start, 36) }) });
  });
  await page.route('**wx-data/wx.json**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: new Date().toISOString(), stations: {} }) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
  await open(page, 'LLHA');
  const first = asked;
  expect(first).toBeGreaterThan(0);
  // Moving the slider re-reads the cached hours; reopening the panel does not refetch.
  await page.evaluate(() => {
    const s = document.querySelector('.da-time');
    s.value = '6'; s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await open(page, 'LLHA');
  await page.waitForTimeout(300);
  expect(asked).toBe(first);
});
