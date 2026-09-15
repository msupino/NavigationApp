// @ts-check
// The nav log on screen: the window, what it opens filled in with, and what the sheet says.
// The arithmetic behind it is navlog-golden.spec.js; this is the part a pilot touches.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  // The airfield dataset arrives async, and the sheet fills its field elevations from it.
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog) && typeof draw === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => {
    state.waypoints = [
      { name: 'LLHZ', lat: 32.17944, lng: 34.83444 },
      { name: 'א', lat: 32.5, lng: 35.0 },
      { name: 'LLIB', lat: 32.98111, lng: 35.57194 },
    ];
    syncLegs();
    draw();
  });
}

const openLog = async (page) => {
  await page.evaluate(() => NavAid.navLog.show());
  await page.waitForSelector('.navlog-table');
};

test('the toolbar offers it, and it opens a sheet', async ({ page }) => {
  await boot(page);
  // The icon is part of the label, as it is on every other button in this section.
  await expect(page.locator('#nav-log')).toHaveText('📐 Nav table');
  await page.evaluate(() => document.getElementById('nav-log').click());
  await expect(page.locator('.navlog-modal .navlog-table')).toBeVisible();
  // 23 columns, the exercise's own set.
  expect(await page.locator('.navlog-table tr').first().locator('th').count()).toBe(23);
});

test('it opens filled in from what the app already knows', async ({ page }) => {
  await boot(page);
  const cfg = await page.evaluate(() => NavAid.navLog.config());
  // LLHZ is 121 ft in the airfield dataset, LLIB 922 -- nobody should type those again.
  expect(cfg.depElevFt).toBe(121);
  expect(cfg.destElevFt).toBeGreaterThan(500);
  // The app's variation is signed the other way (magnetic = true + variation); the sheet's
  // convention is degrees EAST, so -5 there is 5E here.
  expect(cfg.variationDeg).toBe(5);
  expect(cfg.cas.cruise).toBeGreaterThan(0);
  expect(cfg.deviation).toHaveLength(12);
  expect(cfg.met).toEqual([]);          // nothing invented: a met table is handed to you
});

test('the rows come out climb, cruise, descent', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const kinds = await page.evaluate(() =>
    [...document.querySelectorAll('.navlog-table tr.navlog-row')].map(tr => tr.className));
  expect(kinds[0]).toContain('navlog-climb');
  expect(kinds[kinds.length - 1]).toContain('navlog-descent');
  expect(kinds.length).toBeGreaterThanOrEqual(3);
});

test('a typed met level reaches the sheet, and the cell says where it came from', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const cfg = NavAid.navLog.config();
    cfg.cruiseAltFt = 6000;
    cfg.met = [{ alt: 6000, dir: 320, kt: 25, tempC: 2 }];
    NavAid.navLog.save(cfg);
  });
  await openLog(page);
  const row = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('.navlog-table tr.navlog-cruise')][0];
    const tds = [...tr.querySelectorAll('td')].map(td => td.textContent);
    return { temp: tds[5], windDir: tds[7], windKt: tds[8], title: tr.querySelectorAll('td')[7].title };
  });
  expect(row.temp).toBe('+2');
  expect(row.windDir).toBe('320');
  expect(row.windKt).toBe('25');
  expect(row.title).toMatch(/met table/i);
});

// Nothing typed and nothing fetched is a legitimate state -- it must produce a sheet and say
// what air it assumed, rather than an empty table or a silent guess.
test('with no met table at all the sheet still comes out, marked standard', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const title = await page.evaluate(() =>
    document.querySelector('.navlog-table tr.navlog-row td:nth-child(6)').title);
  expect(title).toMatch(/standard atmosphere/i);
});

test('what is typed is remembered, and stays on this device', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await page.evaluate(() => {
    const input = document.querySelector('.navlog-setup input');
    input.value = '7500';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const after = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('navaid.navlog')).cruiseAltFt,
    shown: document.querySelector('.navlog-table tr.navlog-cruise td:nth-child(5)').textContent,
  }));
  expect(after.stored).toBe(7500);
  expect(after.shown).toBe('7500');
});

test('the compass card is typed once and read everywhere', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const cfg = NavAid.navLog.config();
    cfg.deviation = cfg.deviation.map(e => ({ mh: e.mh, ch: (e.mh + 2) % 360 }));
    NavAid.navLog.save(cfg);
  });
  await openLog(page);
  const devs = await page.evaluate(() =>
    [...document.querySelectorAll('.navlog-table tr.navlog-row')]
      .map(tr => tr.querySelectorAll('td')[14].textContent));
  for (const d of devs) expect(d).toBe('+2');
});

test('CSV carries the same numbers the table shows', async ({ page }) => {
  await boot(page);
  const csv = await page.evaluate(() => {
    const text = [];
    const cfg = NavAid.navLog.config();
    const rows = NavAid.navLog.rows(cfg);
    text.push(NavAid.navLog.headers().join(','));
    rows.forEach((row, i) => text.push(NavAid.navLog.cells(row, i, cfg).join(',')));
    return text.join('\n');
  });
  const lines = csv.split('\n');
  expect(lines[0].split(',')).toHaveLength(23);
  expect(lines.length).toBeGreaterThan(3);
  expect(lines[1]).toContain('LLHZ');
});

test('an empty map says what to do instead of showing an empty grid', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog));
  await page.evaluate(() => NavAid.navLog.show());
  await expect(page.locator('.navlog-note')).toContainText(/draw a route/i);
});

test('the gist can withdraw it', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setTune === 'function');
  await page.evaluate(() => setTune('featureNavLog', false));
  expect(await page.evaluate(() => NavAid.navLog.show())).toBeNull();
});

test('the Hebrew sheet is Hebrew, with the numbers left to right', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog) && typeof draw === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ name: 'LLHZ', lat: 32.17944, lng: 34.83444 },
                       { name: 'LLIB', lat: 32.98111, lng: 35.57194 }];
    syncLegs(); draw();
    NavAid.navLog.show();
  });
  await page.waitForSelector('.navlog-table');
  const seen = await page.evaluate(() => ({
    title: document.querySelector('.navlog-modal .modal-title').textContent,
    firstHeader: document.querySelector('.navlog-table th').textContent,
    valueDir: document.querySelector('.navlog-table tr.navlog-row td:nth-child(4) bdi').dir,
  }));
  expect(seen.title).toBe('טבלת ניווט');
  expect(seen.firstHeader).toBe('קטע');
  expect(seen.valueDir).toBe('ltr');
});

// An exercise arrives as a file. It goes in through the app's OWN Open, because "open a file"
// is one action to a pilot and a second import button is a second thing to find -- and through
// a shortcut inside the window you are already looking at, which is the same code path.
const FIXTURE = require('./fixtures/navlog-herzliya-rosh-pina.json');

test('the app\'s own Open recognises an exercise and hands it to the nav table', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async (fixture) => {
    // What load() does with the file's text, without a file picker: the dispatch is the point.
    const text = JSON.stringify(fixture);
    const parsed = JSON.parse(text);
    const isExercise = !!(parsed && parsed.navlog && window.NavAid && NavAid.navLog
      && typeof NavAid.navLog.importExercise === 'function');
    window.askYesNo = async () => true;
    await NavAid.navLog.importExercise(text);
    return {
      isExercise,
      names: state.waypoints.map(w => w.name),
      cfg: NavAid.navLog.config(),
    };
  }, FIXTURE);
  expect(got.isExercise).toBe(true);
  // The route the exercise sets, drawn on the map, under the names the APP identifies points by
  // -- LLHZ, not the sheet's Hebrew alias for it, which is a label on a page rather than a
  // waypoint the airfield dataset, the plates and the frequencies all key on.
  expect(got.names).toEqual(['LLHZ', 'א', 'ב', 'ג', 'LLIB']);
  // ...and its assumptions, including the elevations IT states rather than the dataset's 121.
  expect(got.cfg.depElevFt).toBe(100);
  expect(got.cfg.destElevFt).toBe(900);
  expect(got.cfg.variationDeg).toBe(4);
  expect(got.cfg.met).toHaveLength(6);
  expect(got.cfg.deviation[1]).toEqual({ mh: 30, ch: 27 });
});

test('the loaded exercise reproduces its own published sheet', async ({ page }) => {
  await boot(page);
  const rows = await page.evaluate(async (fixture) => {
    window.askYesNo = async () => true;
    await NavAid.navLog.importExercise(JSON.stringify(fixture));
    const cfg = NavAid.navLog.config();
    return NavAid.navLog.rows(cfg).map(r => ({
      pa: Math.round(r.pressureAltFt), tas: Math.round(r.tasKt * 10) / 10 }));
  }, FIXTURE);
  expect(rows).toHaveLength(6);
  expect(rows[0]).toEqual({ pa: 4033, tas: 74.2 });
  expect(rows[5]).toEqual({ pa: 3450, tas: 105.2 });
});

// Replacing the route is the destructive half, so it is asked -- and saying no still lands the
// settings, because the pilot opened the file for a reason.
test('a drawn route is not replaced without being asked', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async (fixture) => {
    const before = state.waypoints.map(w => w.name);
    let asked = '';
    window.askYesNo = async (title, text) => { asked = String(text); return false; };
    await NavAid.navLog.importExercise(JSON.stringify(fixture));
    return { asked, before, after: state.waypoints.map(w => w.name),
             met: NavAid.navLog.config().met.length };
  }, FIXTURE);
  expect(got.asked).toMatch(/replaces the route/i);
  expect(got.after).toEqual(got.before);
  expect(got.met).toBe(6);            // the exercise's met table landed anyway
});

test('a file that is not an exercise is refused, and says so', async ({ page }) => {
  await boot(page);
  const said = await page.evaluate(async () => {
    const toasts = [];
    window.showToast = (m) => toasts.push(String(m));
    const bad = await NavAid.navLog.importExercise('{"hello":"world"}');
    const worse = await NavAid.navLog.importExercise('not json at all');
    return { bad, worse, toasts };
  });
  expect(said.bad).toBeNull();
  expect(said.worse).toBeNull();
  expect(said.toasts.join(' ')).toMatch(/not an exercise/i);
});

test('a file with absurd contents cannot build an absurd sheet', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    window.askYesNo = async () => true;
    const parsed = NavAid.navLog.parseExercise(JSON.stringify({
      route: { waypoints: [
        { name: 'ok', lat: 32, lng: 35 },
        { name: 'off the planet', lat: 999, lng: 999 },
        { name: 'ok2', lat: 32.5, lng: 35.1 },
      ] },
      navlog: {
        met: new Array(500).fill({ alt: 1000, dir: 0, kt: 0, tempC: 0 }),
        deviation: new Array(500).fill({ mh: 0, ch: 0 }),
      },
    }));
    return { points: parsed.waypoints.length, met: parsed.navlog.met.length,
             card: parsed.navlog.deviation.length };
  });
  expect(got.points).toBe(2);         // the impossible coordinate is dropped, the rest stands
  expect(got.met).toBe(60);
  expect(got.card).toBe(72);
});

test('what it saves is what it opens', async ({ page }) => {
  await boot(page);
  const round = await page.evaluate(async (fixture) => {
    window.askYesNo = async () => true;
    await NavAid.navLog.importExercise(JSON.stringify(fixture));
    const text = NavAid.navLog.exportExercise();
    const again = NavAid.navLog.parseExercise(text);
    return {
      points: again.waypoints.length,
      met: again.navlog.met.length,
      cruise: again.navlog.cruiseAltFt,
      dep: again.navlog.depElevFt,
      variation: again.navlog.variationDeg,
    };
  }, FIXTURE);
  expect(round).toEqual({ points: 5, met: 6, cruise: 6000, dep: 100, variation: 4 });
});

test('the window offers both, in the language it is in', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await expect(page.locator('.navlog-import')).toHaveText('Open exercise');
  await expect(page.locator('.navlog-export')).toHaveText('Save exercise');
  // The picker is a real file input, not a drop of custom UI that cannot be reached by keyboard.
  expect(await page.locator('.navlog-file').getAttribute('accept')).toContain('json');
});

// End to end, through the control a pilot actually presses: the toolbar's own Import, the real
// file input, the real load(). The unit tests above drive importExercise() directly; this one
// proves the file reaches it at all.
test('the toolbar Import opens an exercise file', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.askYesNo = async () => true; });
  await page.setInputFiles('#file', {
    name: 'nav-table-herzliya-rosh-pina.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      title: 'Herzliya - Rosh Pina (CVFR exercise)',
      route: FIXTURE.route,
      navlog: FIXTURE.navlog,
    }), 'utf8'),
  });
  await page.waitForFunction(() => state.waypoints.length === 5, null, { timeout: 5000 });
  const got = await page.evaluate(() => ({
    names: state.waypoints.map(w => w.name),
    met: NavAid.navLog.config().met.length,
    cruise: NavAid.navLog.config().cruiseAltFt,
    dep: NavAid.navLog.config().depElevFt,
  }));
  expect(got).toEqual({ names: ['LLHZ', 'א', 'ב', 'ג', 'LLIB'], met: 6, cruise: 6000, dep: 100 });
});

// ...and an ordinary route file still takes the route path, untouched by any of this.
const ROUTE_FILE = require('./fixtures/route-herzliya-rosh-pina.json');

test('a plain route file is still just a route', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => NavAid.navLog.config().met.length);
  await page.setInputFiles('#file', {
    name: 'route.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(ROUTE_FILE), 'utf8'),
  });
  await page.waitForFunction(() => state.waypoints.length === 5, null, { timeout: 5000 });
  expect(await page.evaluate(() => state.waypoints.map(w => w.name)))
    .toEqual(['LLHZ', 'א', 'ב', 'ג', 'LLIB']);
  expect(await page.evaluate(() => NavAid.navLog.config().met.length)).toBe(before);
});

// The file that is both: a route this app exported, with the sheet's assumptions beside it. The
// route must land on the map COMPLETE -- legs, planned altitudes, speeds -- which only the app's
// own route path does, so that is the path it takes.
test('an exercise that is also a route lands whole: map and sheet', async ({ page }) => {
  await boot(page);
  const both = Object.assign({}, ROUTE_FILE, {
    title: 'Herzliya - Rosh Pina (CVFR exercise)',
    navlog: FIXTURE.navlog,
  });
  await page.evaluate(() => { window.askYesNo = async () => true; });
  await page.setInputFiles('#file', {
    name: 'navaid-exercise.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(both), 'utf8'),
  });
  await page.waitForFunction(() => state.waypoints.length === 5, null, { timeout: 5000 });
  const got = await page.evaluate(() => ({
    names: state.waypoints.map(w => w.name),
    // The legs the route file carries, not a bare list of points: this is what the route path
    // gives that the nav table's own reader cannot.
    legs: state.legs.length,
    planned: state.legs[0].inboundAltitude,
    speed: state.legs[0].flightSpeed,
    met: NavAid.navLog.config().met.length,
    cruise: NavAid.navLog.config().cruiseAltFt,
    dep: NavAid.navLog.config().depElevFt,
  }));
  expect(got).toEqual({ names: ['LLHZ', 'א', 'ב', 'ג', 'LLIB'], legs: 4, planned: 6000,
    speed: 90, met: 6, cruise: 6000, dep: 100 });
  // ...and the sheet it produces is the exercise's own.
  const rows = await page.evaluate(() => NavAid.navLog.rows().map(r => Math.round(r.pressureAltFt)));
  expect(rows[0]).toBe(4033);
  expect(rows[rows.length - 1]).toBe(3450);
});

// Reported: moving a waypoint with the table open changed nothing on it. The sheet is worked
// out FROM the route, so a dragged point is a sheet that has just gone wrong.
test('the sheet follows the route while it is open', async ({ page }) => {
  await boot(page);
  await openLog(page);
  // The cumulative time at the bottom of the sheet: the one number every leg feeds. Not the
  // last row's own distance -- a descent is bounded by its rate, so it covers the same ground
  // wherever the aeroplane starts it from.
  const total = () => page.evaluate(() => {
    const rows = document.querySelectorAll('.navlog-table tr.navlog-row');
    return rows[rows.length - 1].querySelectorAll('td')[19].textContent;
  });
  const before = await total();
  await page.evaluate(() => {
    state.waypoints[state.waypoints.length - 1].lng += 0.6;
    syncLegs();
    save();          // the app's own persist path, which is what an edit goes through
    draw();
  });
  expect(await total()).not.toBe(before);
});

test('a point added to the route becomes a row', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const before = await page.evaluate(() =>
    document.querySelectorAll('.navlog-table tr.navlog-row').length);
  await page.evaluate(() => {
    state.waypoints.splice(1, 0, { name: 'NEW', lat: 32.3, lng: 34.9 });
    syncLegs(); save(); draw();
  });
  const after = await page.evaluate(() => ({
    rows: document.querySelectorAll('.navlog-table tr.navlog-row').length,
    names: [...document.querySelectorAll('.navlog-table tr.navlog-row')]
      .map(tr => tr.querySelectorAll('td')[2].textContent),
  }));
  expect(after.rows).toBeGreaterThan(before);
  expect(after.names).toContain('NEW');
});

// A destination swapped for a different field brings its own elevation with it -- unless the
// pilot typed one, which is a decision and not a default.
test('the field elevations follow the route, until they are typed', async ({ page }) => {
  await boot(page);
  await openLog(page);
  expect(await page.evaluate(() => NavAid.navLog.config().destElevFt)).toBeGreaterThan(500);
  await page.evaluate(() => {
    state.waypoints[state.waypoints.length - 1] = { name: 'LLHZ', lat: 32.17944, lng: 34.83444 };
    syncLegs(); save(); draw();
  });
  expect(await page.evaluate(() => NavAid.navLog.config().destElevFt)).toBe(121);
  // Typed: it stays, whatever the route does next.
  await page.evaluate(() => {
    const cfg = NavAid.navLog.config();
    cfg.destElevFt = 900;
    NavAid.navLog.save(cfg);
    state.waypoints[state.waypoints.length - 1] = { name: 'LLIB', lat: 32.98111, lng: 35.57194 };
    syncLegs(); save(); draw();
  });
  expect(await page.evaluate(() => NavAid.navLog.config().destElevFt)).toBe(900);
});

// Reported: a met level added while the table was open landed at the bottom of the list.
test('met levels are kept in altitude order', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const cfg = NavAid.navLog.config();
    cfg.met = [{ alt: 6000, dir: 320, kt: 25, tempC: 2 }, { alt: 2000, dir: 315, kt: 17, tempC: 10 }];
    NavAid.navLog.save(cfg);
  });
  // Out of order going in, in order coming back.
  expect(await page.evaluate(() => NavAid.navLog.config().met.map(r => r.alt))).toEqual([2000, 6000]);
  await openLog(page);
  const shown = await page.evaluate(() => {
    const grid = document.querySelectorAll('.navlog-met .navlog-grid tr');
    return [...grid].slice(1).map(tr => tr.querySelector('input').value);
  });
  expect(shown).toEqual(['2000', '6000']);
  // Adding one puts it above the highest, and the list stays sorted.
  await page.evaluate(() => document.querySelector('.navlog-add').click());
  const after = await page.evaluate(() => NavAid.navLog.config().met.map(r => r.alt));
  expect(after).toEqual([2000, 6000, 7000]);
});
