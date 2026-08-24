// @ts-check
// Asked for as "IFR SID and ILS charts, for the fields who have it — extra layer like
// circuit". It is like circuit in every way but one: a field has MANY instrument sheets
// (LLBG publishes nineteen that can be placed), so the toggle draws ONE and a picker beside
// it says which, remembered per field.
//
// Only sheets the CAA draws to scale, with a graticule to place them by, are here at all.
// Every LLER SID and IAC, four LLBG STARs and the LLHA STAR are schematics: nothing to place
// them by, so they stay in the charts viewer rather than being placed by guesswork.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

async function boot(page) {
  await page.route(/ifr-img\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) { /* storage off */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('ifr-cb') &&
    typeof loadIfrOverlays === 'function');
}

const on = (page) => page.evaluate(async () => {
  document.getElementById('ifr-cb').click();
  await new Promise(r => setTimeout(r, 300));
});

const drawn = (page) => page.evaluate(() => {
  const out = [];
  map.eachLayer(l => { if (l && l._ovType === 'ifr_overlay') out.push(l._ovPng); });
  return out;
});

test('the shipped sheets are the placeable ones, and they carry their own designation', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'airfields.json'), 'utf8');
  const data = JSON.parse(raw);
  const fields = data[Object.keys(data)[0]];
  const withIfr = fields.filter(a => a.ifr_overlays && a.ifr_overlays.length);
  expect(withIfr.map(a => a.name).sort()).toEqual(['LLBG', 'LLHZ', 'LLIB']);
  for (const af of withIfr) {
    for (const o of af.ifr_overlays) {
      expect(o.png).toMatch(/^LL[A-Z]{2}_.*\.png$/);
      expect(o.code).toBeTruthy();
      // Placed either square to north (sw/ne) or rotated (three corners) — the sheets the
      // CAA prints turned, like LLBG's SIDs, are the second kind.
      const axis = o.sw && o.ne;
      const rot = o.tl && o.tr && o.bl;
      expect(Boolean(axis) !== Boolean(rot)).toBe(true);
    }
  }
  // The schematics are NOT here, and must not quietly appear: LLER publishes fourteen
  // instrument sheets and not one of them can be placed.
  const ller = fields.find(a => a.name === 'LLER');
  expect(ller.plates.some(p => /SID|IAC/.test(p))).toBe(true);
  expect(ller.ifr_overlays).toBeUndefined();
});

test('exactly one sheet is drawn, not one per field', async ({ page }) => {
  await boot(page);
  await on(page);
  const shown = await drawn(page);
  expect(shown.length).toBe(1);                  // not nineteen for LLBG, and not one each
  expect(shown[0]).toMatch(/^LL[A-Z]{2}_/);
});

test('the picker lists every placeable sheet and switches which one is drawn', async ({ page }) => {
  await boot(page);
  await on(page);
  const sel = page.locator('#ifr-sheet');
  const values = await page.evaluate(() =>
    Array.from(document.getElementById('ifr-sheet').options).map(o => o.value));
  expect(values.length).toBe(22);                // 19 at LLBG, 2 at LLIB, 1 at LLHZ
  expect(values.filter(v => v.startsWith('LLBG|')).length).toBe(19);

  // Ask for a different sheet: that one is drawn and the one before it is gone. Reported as
  // "selecting different ifr chart doesn't remove selected" -- the picker names one chart,
  // so one chart is what it puts on the map.
  const wanted = values.find(v => v.startsWith('LLBG|') && v.includes('SID'));
  await sel.selectOption(wanted);
  await page.waitForTimeout(300);
  expect(await drawn(page)).toEqual([wanted.split('|')[1]]);

  // ...including across fields: choosing Rosh Pina's departure takes Ben Gurion's off.
  const other = values.find(v => v.startsWith('LLIB|'));
  await sel.selectOption(other);
  await page.waitForTimeout(300);
  expect(await drawn(page)).toEqual([other.split('|')[1]]);
  expect(await page.evaluate(() => localStorage.getItem('navaid.ifrSheet'))).toBe(other);
});

test('the remembered sheet comes back on the next start', async ({ page }) => {
  await boot(page);
  await on(page);
  const values = await page.evaluate(() =>
    Array.from(document.getElementById('ifr-sheet').options).map(o => o.value));
  const wanted = values.find(v => v.startsWith('LLBG|') && v.includes('RNP'));
  await page.locator('#ifr-sheet').selectOption(wanted);
  await page.reload();
  await page.waitForFunction(() => {
    let n = 0; map.eachLayer(l => { if (l && l._ovType === 'ifr_overlay') n++; });
    return n > 0;
  });
  expect(await drawn(page)).toContain(wanted.split('|')[1]);
});

// It is not one of the airfield plates: it draws the ONE sheet you named, at the field you
// named it for, so neither the plates' mutual exclusion nor "Show plates for" applies to it.
// It has a frame of its own in the menu for exactly that reason.
test('an instrument chart and a VFR plate cancel each other', async ({ page }) => {
  await boot(page);
  await on(page);
  await page.click('#cvfr-cb');
  // Two pictures of the same few miles: neither can be read through the other, so the
  // instrument chart joins the plates' mutual exclusion even though it lives in its own
  // section of the menu.
  expect(await page.evaluate(() => ({
    ifr: document.getElementById('ifr-cb').checked,
    cvfr: document.getElementById('cvfr-cb').checked,
  }))).toEqual({ ifr: false, cvfr: true });
  expect(await drawn(page)).toEqual([]);

  // ...and back the other way.
  await page.click('#ifr-cb');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => ({
    ifr: document.getElementById('ifr-cb').checked,
    cvfr: document.getElementById('cvfr-cb').checked,
  }))).toEqual({ ifr: true, cvfr: false });
  expect(await drawn(page)).toHaveLength(1);
});

// The section it lives in is still its own: "Show plates for" does not reach it, and the
// frame title says which kind of chart it is.
test('it has a section of its own', async ({ page }) => {
  await boot(page);
  const frames = await page.evaluate(() => {
    const mine = document.getElementById('ifr-cb').closest('.tb-layer-frame');
    const plates = document.getElementById('cvfr-cb').closest('.tb-layer-frame');
    return { same: mine === plates, title: mine.querySelector('.tb-frame-title').textContent.trim() };
  });
  expect(frames.same).toBe(false);
  expect(frames.title).toMatch(/instrument/i);
});

test('"Show plates for" does not reach it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    localStorage.setItem('navaid.plateAirfield', 'LLIB');
    if (typeof applyPlateAirfieldFilter === 'function') applyPlateAirfieldFilter();
  });
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('ifr-cb'));
  await on(page);
  // Every field's sheets are still offered: filtering them would only ever remove the chart
  // just asked for, since the pick names its own field.
  const values = await page.evaluate(() =>
    Array.from(document.getElementById('ifr-sheet').options).map(o => o.value));
  expect(values.some(v => v.startsWith('LLBG|'))).toBe(true);
  expect(values.some(v => v.startsWith('LLIB|'))).toBe(true);
  expect(await drawn(page)).toHaveLength(1);
});

// The AIP's one airfield-level ATS chart -- LLHZ's נספח ח', the departure to the ATS routes
// -- is an instrument departure like any other, so it is a sheet in this picker rather than
// a layer of its own. It used to have its own toggle, which said it was a different kind of
// thing than the SIDs beside it.
test('the LLHZ ATS departure plate is one of the sheets', async ({ page }) => {
  await boot(page);
  await on(page);
  const values = await page.evaluate(() =>
    Array.from(document.getElementById('ifr-sheet').options).map(o => o.value));
  const hz = values.find(v => v.startsWith('LLHZ|'));
  expect(hz).toBeTruthy();
  expect(await page.evaluate(() =>
    Array.from(document.getElementById('ifr-sheet').options)
      .find(o => o.value.startsWith('LLHZ|')).textContent)).toMatch(/ATS departure/);
  // Choose it -- one chart is drawn at a time -- then it is on the bounds its own row
  // states, like every other sheet.
  await page.locator('#ifr-sheet').selectOption(hz);
  await page.waitForTimeout(300);
  const laid = await page.evaluate(async () => {
    const af = await fetch('data/airfields.json').then(r => r.json());
    const list = af[Object.keys(af)[0]];
    const row = list.find(a => a.name === 'LLHZ').ifr_overlays[0];
    let b = null;
    map.eachLayer(l => { if (l && l._ovType === 'ifr_overlay' && l._ovPng === row.png) b = l.getBounds(); });
    return b ? { want: row, got: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()] } : null;
  });
  expect(laid).not.toBeNull();
  expect(laid.got[0]).toBeCloseTo(laid.want.sw[0], 5);
  expect(laid.got[3]).toBeCloseTo(laid.want.ne[1], 5);
  // And nothing is left of the toggle it used to have.
  expect(await page.evaluate(() => !!document.getElementById('atsdep-cb'))).toBe(false);
});

// Picking a sheet takes the map to it: asking for Ben Gurion's ILS while looking at Eilat
// used to draw the chart somewhere off screen and say nothing.
test('choosing a sheet moves the map to it', async ({ page }) => {
  await boot(page);
  await on(page);
  const out = await page.evaluate(async () => {
    map.setView([29.6, 35.0], 9);                       // far away, down at Eilat
    const before = [map.getCenter().lat, map.getCenter().lng];
    const sel = document.getElementById('ifr-sheet');
    const llib = Array.from(sel.options).find(o => o.value.startsWith('LLIB|'));
    sel.value = llib.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const af = airfields.find(a => a.name === 'LLIB');
    return { before, after: [map.getCenter().lat, map.getCenter().lng], field: [af.lat, af.lng] };
  });
  expect(Math.abs(out.after[0] - out.field[0])).toBeLessThan(0.3);
  expect(Math.abs(out.after[1] - out.field[1])).toBeLessThan(0.3);
  expect(out.after[0]).not.toBeCloseTo(out.before[0], 2);
});

// ...but only when the pilot picks one. A fix driving the map wins over any of this.
test('a live fix keeps the map', async ({ page }) => {
  await boot(page);
  await on(page);
  const out = await page.evaluate(async () => {
    window.gpsLiveOn = true;                            // as if Location were running
    map.setView([29.6, 35.0], 9);
    const before = [map.getCenter().lat, map.getCenter().lng];
    const sel = document.getElementById('ifr-sheet');
    const llib = Array.from(sel.options).find(o => o.value.startsWith('LLIB|'));
    sel.value = llib.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    window.gpsLiveOn = false;
    return { before, after: [map.getCenter().lat, map.getCenter().lng] };
  });
  expect(out.after[0]).toBeCloseTo(out.before[0], 3);
  expect(out.after[1]).toBeCloseTo(out.before[1], 3);
});

// The positions a plate prints in full become chart points while it is showing, so they can
// be tapped, inspected and put in a route. Only what the sheet actually prints: a fix it
// names without a position is not invented.
test('the sheet\'s printed positions become chart points', async ({ page }) => {
  await boot(page);
  await on(page);
  const out = await page.evaluate(async () => {
    const before = navWP.length;
    const sel = document.getElementById('ifr-sheet');
    const llib = Array.from(sel.options).find(o => o.textContent.includes('VOR approach'));
    sel.value = llib.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const added = navWP.filter(w => w._plate);
    return { before, names: added.map(w => w.name), tag: added[0] && added[0]._plate,
             sample: added.find(w => w.name === 'ROP') };
  });
  expect(out.names).toEqual(expect.arrayContaining(['ETROG', 'GIMIK', 'ROP', 'DALIT']));
  expect(out.tag).toMatch(/LLIB/);
  // The CAA's own digits: ROP is printed at 32°58'57.1"N 035°34'22.0"E on that sheet.
  expect(out.sample.lat).toBeCloseTo(32 + 58 / 60 + 57.1 / 3600, 4);
  expect(out.sample.lng).toBeCloseTo(35 + 34 / 60 + 22.0 / 3600, 4);
});

test('a point can be selected and inspected like any chart point', async ({ page }) => {
  await boot(page);
  await on(page);
  const out = await page.evaluate(async () => {
    const sel = document.getElementById('ifr-sheet');
    const llib = Array.from(sel.options).find(o => o.textContent.includes('VOR approach'));
    sel.value = llib.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    window.showNavWP = true;
    const i = navWP.findIndex(w => w.name === 'DALIT');
    state.selected = { type: 'navwp', index: i };
    showInspector();
    const title = document.getElementById('insp-title');
    return { i, title: title && (title.value || title.textContent),
             addBtn: !!document.getElementById('insp-add-to-route') };
  });
  expect(out.i).toBeGreaterThan(-1);
  expect(out.title).toMatch(/DALIT/);
  expect(out.addBtn).toBe(true);          // and it can go straight into the route
});

test('the points leave with the sheet', async ({ page }) => {
  await boot(page);
  await on(page);
  const gone = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    const during = navWP.filter(w => w._plate).length;
    document.getElementById('ifr-cb').click();          // off
    await new Promise(r => setTimeout(r, 300));
    return { during, after: navWP.filter(w => w._plate).length };
  });
  expect(gone.during).toBeGreaterThan(0);
  expect(gone.after).toBe(0);
});
