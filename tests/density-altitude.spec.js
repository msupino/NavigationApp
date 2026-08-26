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
        icaoId: 'LLHA', temp: 33, altim: 1009, obsTime: Math.floor(Date.now() / 1000),
        rawOb: 'METAR LLHA 33/21 Q1009' } } } }) }));
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
  // Both scales: Israeli QNH is in hectopascals, the altimeter subscale is in inches, and
  // converting in your head on short final is nobody's idea of airmanship.
  expect(da.src).toContain('29.80\u2033');
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

// Open-Meteo answers `current` when that is what was asked for -- the shape the QNH code
// uses, and the one this repo's own test harness serves for every open-meteo call. One hour
// is a poor forecast but an honest present: better than reporting no temperature at a field
// that plainly has one.
test('a current-only answer still gives the present hour', async ({ page }) => {
  await page.route(/^https:\/\/api\.open-meteo\.com\//, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ latitude: 32, longitude: 34.9, elevation: 0,
      current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 31, pressure_msl: 1007 } }),
  }));
  await page.route('**wx-data/wx.json**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: new Date().toISOString(), stations: {} }) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
  await open(page, 'LLHZ');
  const da = await readDa(page);
  expect(da.value).toMatch(/ft$/);
  expect(da.src).toContain('31 °C');
  expect(da.src).toContain('1007 hPa');

  // ...and it does not pretend to know a later hour it was never given.
  await page.evaluate(() => {
    const s2 = document.querySelector('.da-time');
    s2.value = '12'; s2.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect((await readDa(page)).value).toBe('—');
});

// The same pair everywhere pressure is shown, decoded METAR included.
test('pressure is given in both scales', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => ({
    hpa: fmtQnhBoth(1009),
    inches: fmtQnhBoth(29.92),          // some feeds send inches; the pair still reads right
    rubbish: fmtQnhBoth('x'),
    metar: decodeMetar({ altim: 1013, temp: 20 }),
  }));
  expect(out.hpa).toBe('1009 hPa · 29.80\u2033');
  expect(out.inches).toBe('29.92\u2033 · 1013 hPa');
  expect(out.rubbish).toBe('');
  expect(out.metar).toContain('QNH 1013 hPa · 29.91\u2033');
});

// The label is a date and a clock ("+24h · 08-26 14:00Z") and the panel is narrow. Left to
// wrap, it broke into two lines and shoved the slider around under the finger dragging it --
// the one thing a control being dragged must not do. Squeezed here to the width a phone with
// large system type gives it, which is where it was first seen.
test('the time label never wraps the row', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 720 });
  await boot(page);
  await open(page, 'LLHA');
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '#inspector { width: 210px !important; } .da-when { font-size: 13px !important; }';
    document.head.appendChild(st);
    const s2 = document.querySelector('.da-time');
    s2.value = String(s2.max);            // the longest label the slider can produce
    s2.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const geo = await page.evaluate(() => {
    const slider = document.querySelector('.da-time');
    const label = document.querySelector('.da-when');
    const s3 = slider.getBoundingClientRect(), l = label.getBoundingClientRect();
    return {
      labelH: Math.round(l.height),
      // 'normal' line-height parses to NaN, so measure against the font size instead.
      oneLine: l.height < parseFloat(getComputedStyle(label).fontSize) * 1.8,
      sameLine: Math.abs((s3.top + s3.height / 2) - (l.top + l.height / 2)) < 6,
      sliderW: Math.round(s3.width),
    };
  });
  expect(geo.oneLine).toBe(true);         // the label itself is one line, not two
  expect(geo.sliderW).toBeGreaterThan(30);      // ...and the slider is still draggable
});

// The label's text grows as the slider moves ("13:00Z" -> "+24h · 08-26 14:00Z"). With a
// flexible slider, the readout re-sized the control being dragged: the thumb slid out from
// under the finger pushing it.
test('the slider keeps its width as its own label grows', async ({ page }) => {
  await boot(page);
  await open(page, 'LLHA');
  const widths = await page.evaluate(async () => {
    const sl = document.querySelector('.da-time');
    const at = (v) => {
      sl.value = String(v);
      sl.dispatchEvent(new Event('input', { bubbles: true }));
      return Math.round(sl.getBoundingClientRect().width);
    };
    return { now: at(0), mid: at(9), end: at(sl.max),
             label: document.querySelector('.da-when').textContent };
  });
  expect(widths.mid).toBe(widths.now);
  expect(widths.end).toBe(widths.now);
  expect(widths.label).toMatch(/\+24/);      // the longest label really was on screen
});

// Hebrew is written right to left; a clock is not. The label "+21ש · 08-26 11:00Z" was being
// reordered into "11:00Z 08-26 · ש21+" -- a different date and a different hour, which on a
// planning tool is worse than no label at all.
test('the time label reads left to right in Hebrew too', async ({ page }) => {
  await boot(page);
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
  await page.evaluate(() => {
    const i = airfields.findIndex(a => String(a.name || '').toUpperCase() === 'LLHA');
    state.selected = { type: 'airfield', index: i };
    showInspector();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s2 = document.querySelector('.da-time');
    s2.value = '21';
    s2.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const out = await page.evaluate(() => {
    const el = document.querySelector('.da-when');
    const cs = getComputedStyle(el);
    return { dir: el.getAttribute('dir'), direction: cs.direction, bidi: cs.unicodeBidi,
             text: el.textContent, rtlPage: document.documentElement.dir };
  });
  expect(out.rtlPage).toBe('rtl');            // the page really is in Hebrew
  expect(out.dir).toBe('ltr');
  expect(out.bidi).toMatch(/isolate/);
  expect(out.text).toMatch(/^\+21/);          // the hour offset still leads
  // ...and leads ON SCREEN, which is the part the bidi algorithm was getting wrong: the
  // Hebrew hour letter took the digits after it into its own run, so the clock and the date
  // swapped places. Each part is isolated now; measure where they actually land.
  const order = await page.evaluate(() => [...document.querySelectorAll('.da-when bdi')]
    .map(b => ({ text: b.textContent, x: Math.round(b.getBoundingClientRect().x) })));
  expect(order.length).toBe(2);
  expect(order[0].text).toMatch(/^\+21/);
  expect(order[0].x).toBeLessThan(order[1].x);        // offset left, clock right
  expect(order[1].text).toMatch(/\d\d:\d\dZ$/);
});

// ...and the row keeps its shape as the label lengthens, in either language.
test('the row does not reflow between the short and long labels', async ({ page }) => {
  await boot(page);
  await open(page, 'LLHA');
  const w = await page.evaluate(() => {
    const sl = document.querySelector('.da-time');
    const lb = document.querySelector('.da-when');
    const at = (v) => {
      sl.value = String(v);
      sl.dispatchEvent(new Event('input', { bubbles: true }));
      return { slider: Math.round(sl.getBoundingClientRect().width),
               label: Math.round(lb.getBoundingClientRect().width) };
    };
    return { now: at(0), late: at(sl.max) };
  });
  // The slider owns its own line, so its width cannot follow its read-out.
  expect(w.late.slider).toBe(w.now.slider);
});

// Where it sits matters as much as what it says. Temperature and QNH are what density
// altitude is made of, and the METAR they come from prints directly below it — so it
// belongs inside Weather, above the satellite thumbnail, with its slider above the numbers
// the slider changes.
test('it lives in the Weather box, slider first, above the satellite', async ({ page }) => {
  await boot(page);
  await open(page, 'LLHA');
  const layout = await page.evaluate(() => {
    const wx = document.querySelector('#insp-body .wx-section');
    const da = document.querySelector('.da-section');
    const sat = document.querySelector('#insp-body .sat-section, #insp-body .satellite-section');
    const inside = !!(wx && da && wx.contains(da));
    const kids = da ? [...da.children].map(c => c.className) : [];
    const order = (a, b) => !!(a && b) &&
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    return {
      inside,
      sliderFirst: /da-time-row/.test(kids[0] || ''),
      beforeSatellite: sat ? order(wx, sat) : null,
      wxBeforeSat: sat ? order(document.querySelector('.da-row'), sat) : null,
    };
  });
  expect(layout.inside).toBe(true);            // inside the Weather frame, not above it
  expect(layout.sliderFirst).toBe(true);       // the control before its own read-out
  if (layout.beforeSatellite !== null) expect(layout.beforeSatellite).toBe(true);
});

// Radios grouped and titled: on a field with a tower, a clearance and an ATIS this is five
// rows of bare numbers otherwise.
test('the frequencies sit in a Communication frame', async ({ page }) => {
  await boot(page);
  await open(page, 'LLHA');
  const comms = await page.evaluate(() => {
    const sec = document.querySelector('#insp-body .comm-section');
    if (!sec) return null;
    return {
      title: sec.querySelector('.insp-frame-head').textContent.trim(),
      rows: [...sec.querySelectorAll('.row label')].map(l => l.textContent.trim()),
      // ...and it must not wear the weather section's class, which the wx tests select on.
      borrowsWxClass: sec.classList.contains('wx-section'),
    };
  });
  expect(comms).not.toBeNull();
  expect(comms.title).toBe('Communication');
  expect(comms.rows.join(' ')).toMatch(/Primary/);
  expect(comms.borrowsWxClass).toBe(false);
});

// The slider sits at the top of the Weather box. Unlabelled, it read as though it moved the
// whole box — the METAR below it included — rather than the density altitude alone.
test('the slider says what it moves, and sits in the DA group', async ({ page }) => {
  await boot(page);
  await open(page, 'LLHA');
  const out = await page.evaluate(() => {
    const row = document.querySelector('.da-time-row');
    const group = document.querySelector('.da-group');
    const wx = document.querySelector('#insp-body .wx-section');
    const metar = wx ? wx.querySelector('.wx-body') : null;
    const cs = group ? getComputedStyle(group) : null;
    return {
      label: row.querySelector('label').textContent.trim(),
      aria: row.querySelector('input[type=range]').getAttribute('aria-label'),
      // The group has a rule down its side, so slider + figure + conditions read as one
      // block and the observation below it as another.
      ruled: cs ? parseFloat(cs.borderInlineStartWidth) > 0 : false,
      // ...and the METAR is outside that block.
      metarInGroup: !!(group && metar && group.contains(metar)),
      rowsInGroup: group ? group.querySelectorAll('.row').length : 0,
    };
  });
  expect(out.label).toBe('Density altitude at');
  expect(out.aria).toBe('Density altitude at');
  expect(out.ruled).toBe(true);
  expect(out.metarInGroup).toBe(false);
  expect(out.rowsInGroup).toBe(3);          // slider, the figure, the conditions it used
});

// In Hebrew the caption is longer than in English, and the clock was being cut to "+5ש · …".
// A truncated time is not a time: it is the one number on the row that has to be read whole.
test('the clock is never truncated, in either language', async ({ page }) => {
  for (const lang of ['he', 'en']) {
    await boot(page);
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
    await page.evaluate(() => {
      const i = airfields.findIndex(a => String(a.name || '').toUpperCase() === 'LLHA');
      state.selected = { type: 'airfield', index: i };
      showInspector();
    });
    await page.waitForTimeout(500);
    const out = await page.evaluate(() => {
      const s2 = document.querySelector('.da-time');
      s2.value = String(s2.max);                    // the longest label the slider produces
      s2.dispatchEvent(new Event('input', { bubbles: true }));
      const el = document.querySelector('.da-when');
      const row = document.querySelector('.da-time-row');
      return {
        clipped: el.scrollWidth > el.clientWidth + 1,
        text: el.textContent,
        sliderFullWidth: Math.round(s2.getBoundingClientRect().width) >=
                         Math.round(row.getBoundingClientRect().width) - 8,
      };
    });
    expect(out.clipped, lang).toBe(false);
    expect(out.text, lang).toMatch(/\d\d:\d\dZ$/);   // the hour survived to the end
    expect(out.sliderFullWidth, lang).toBe(true);
  }
});

// Five fields in the dataset have no published elevation — Habonim, Ein Vered, Arad,
// Gvulot, Kedem — and without one there is no density altitude at all. Where the AIP is
// silent the forecast's own terrain height stands in, and the panel says which it used
// rather than passing a model figure off as a surveyed one.
test('a field with no published elevation still gets a density altitude', async ({ page }) => {
  await page.route(/^https:\/\/api\.open-meteo\.com\//, (r) => {
    const start = Date.now() - (Date.now() % 3600e3);
    const h = { time: [], temperature_2m: [], pressure_msl: [] };
    for (let i = 0; i < 30; i++) {
      h.time.push(new Date(start + i * 3600e3).toISOString().slice(0, 16));
      h.temperature_2m.push(30);
      h.pressure_msl.push(1009);
    }
    // Open-Meteo reports the model's terrain height for the point it answered for.
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ hourly: h, elevation: 100 }) });
  });
  await page.route('**wx-data/wx.json**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: new Date().toISOString(), stations: {} }) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
  await open(page, 'LLBO');                         // Habonim: no elev_ft in the dataset
  await page.waitForTimeout(400);
  const da = await readDa(page);
  expect(da.value).toMatch(/ft$/);
  expect(da.value).not.toBe('—');
  // ...and it is labelled, so nobody reads it as a surveyed field elevation.
  expect(da.src).toMatch(/terrain elevation/);
  expect(da.src).toMatch(/30 °C/);
});

// Every airfield in the dataset ends up with the figure, one way or the other.
test('every airfield has one', async ({ page }) => {
  await boot(page);
  const missing = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < airfields.length; i++) {
      state.selected = { type: 'airfield', index: i };
      showInspector();
      await new Promise(r => setTimeout(r, 60));
      if (!document.querySelector('.da-group')) out.push(airfields[i].name);
    }
    return out;
  });
  expect(missing).toEqual([]);
});

// A service the AIP does not publish is not mentioned: the panel used to print
// "Clearance — None" so every airfield read the same way, and inside a titled Communication
// frame that reads as a service the field has, which happens to be off. Ein Shemer has a
// tower and nothing else.
test('a field with no clearance does not mention one', async ({ page }) => {
  await boot(page);
  await open(page, 'LLES');
  const comms = await page.evaluate(() => {
    const sec = document.querySelector('#insp-body .comm-section');
    if (!sec) return { labels: [], clearanceRows: 0, text: '' };
    return {
      labels: [...sec.querySelectorAll('.row label')].map(l => l.textContent.trim()),
      clearanceRows: sec.querySelectorAll('.clearance-row').length,
      text: sec.textContent,
    };
  });
  expect(comms.labels).not.toContain('Clearance');
  expect(comms.clearanceRows).toBe(0);
  expect(comms.text).not.toMatch(/None/);
});

// ...and a field that does publish one still shows it.
test('a field with a clearance still shows it', async ({ page }) => {
  await boot(page);
  await open(page, 'LLBG');
  const val = await page.evaluate(() => {
    const row = document.querySelector('#insp-body .clearance-row');
    const inp = row && row.querySelector('input');
    return inp ? inp.value : null;
  });
  expect(val).toBe('121.55');
});

// An assumed 1013 is an assumption. The row printed it exactly like a measured QNH, so a
// figure computed from a guess read as a figure computed from an observation.
test('an assumed pressure says so', async ({ page }) => {
  await page.route(/^https:\/\/api\.open-meteo\.com\//, (r) => {
    const start = Date.now() - (Date.now() % 3600e3);
    const h = { time: [], temperature_2m: [], pressure_msl: [] };
    for (let i = 0; i < 30; i++) {
      h.time.push(new Date(start + i * 3600e3).toISOString().slice(0, 16));
      h.temperature_2m.push(28);
      h.pressure_msl.push(null);            // temperature only: no pressure in the answer
    }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hourly: h }) });
  });
  await page.route('**wx-data/wx.json**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: new Date().toISOString(), stations: {} }) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
  await open(page, 'LLHA');
  const da = await readDa(page);
  expect(da.src).toContain('1013 hPa');
  expect(da.src).toMatch(/\(standard\)/);
});

// A METAR is the observation while it is recent. Past daMetarMaxAgeMin it is history, and
// the forecast for this hour is the better answer; between 30 min and that limit it is still
// used, with its age said out loud rather than presented as "now".
test('a stale METAR is aged, then dropped for the forecast', async ({ page }) => {
  const wx = (ageMin) => ({
    generatedAt: new Date().toISOString(),
    stations: { LLHA: { metar: { icaoId: 'LLHA', temp: 33, altim: 1009,
      obsTime: Math.round((Date.now() - ageMin * 60000) / 1000) } } },
  });
  const forecast = (r) => {
    const start = Date.now() - (Date.now() % 3600e3);
    const h = { time: [], temperature_2m: [], pressure_msl: [] };
    for (let i = 0; i < 30; i++) {
      h.time.push(new Date(start + i * 3600e3).toISOString().slice(0, 16));
      h.temperature_2m.push(21); h.pressure_msl.push(1005);
    }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hourly: h }) });
  };
  await page.route(/^https:\/\/api\.open-meteo\.com\//, forecast);

  await page.route('**wx-data/wx.json**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wx(45)) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
  await open(page, 'LLHA');
  const aged = await readDa(page);
  expect(aged.src).toContain('33 °C');            // still the observation...
  expect(aged.src).toMatch(/45 min old/);         // ...and it says how old

  await page.route('**wx-data/wx.json**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wx(200)) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.da) && !!window.airfields);
  await open(page, 'LLHA');
  const stale = await readDa(page);
  expect(stale.src).toContain('21 °C');           // the forecast for this hour instead
  expect(stale.src).toContain('forecast');
  expect(stale.src).not.toMatch(/METAR/);
});

// A station that stops stamping its observations is not reporting "now" forever. Without an
// obsTime there is no way to tell a five-minute-old reading from a five-day-old one, and the
// panel was calling every one of them current -- so the safe reading is that it is not.
test('a METAR with no observation time is not treated as current', async ({ page }) => {
  await page.route('**wx-data/wx.json**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: new Date().toISOString(), stations: { LLHA: { metar: {
      icaoId: 'LLHA', temp: 33, altim: 1009, rawOb: 'METAR LLHA 33/21 Q1009' } } } }) }));
  await boot(page, { metar: false });
  await open(page, 'LLHA');
  const src = await page.evaluate(() => {
    const el = document.querySelector('.da-src-row .val');
    return el ? el.textContent.trim() : null;
  });
  expect(src).not.toMatch(/METAR/);
});
