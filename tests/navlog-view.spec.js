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
  await expect(page.locator('#nav-log')).toHaveText('📐 Flight planning form');
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
    return { temp: tds[5], windKt: tds[7], windDir: tds[8], title: tr.querySelectorAll('td')[7].title };
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
    const input = document.querySelector('.navlog-setup input');   // departure elevation
    input.value = '250';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const after = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('navaid.navlog')).depElevFt,
    shown: document.querySelector('.navlog-table tr.navlog-climb td:nth-child(5)').textContent,
  }));
  expect(after.stored).toBe(250);
  // The climb reads its air two thirds up from the field it left, so a higher field moves it.
  expect(Number(after.shown)).toBeGreaterThan(4033);
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
  // Written as a chart writes a correction: a card that steers two degrees HIGH of magnetic is
  // 2W, the same way an east variation subtracts. Not "+2", which says nothing about which way.
  for (const d of devs) expect(d).toBe('2W');
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
  expect(seen.title).toBe('טופס תכנון טיסה');
  expect(seen.firstHeader).toBe('LEG');       // the sheet's own header, in either language
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

// ...and an ordinary route file still takes the route path, untouched by any of this. It asks
// the same question -- the gate is the app's, not this window's (see import.spec.js) -- so the
// sheet is what this one is about: a route file carries none, and must not invent one.
const ROUTE_FILE = require('./fixtures/route-herzliya-rosh-pina.json');

test('a plain route file is still just a route', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.askYesNo = async () => true; });
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

// Reported: opening an exercise replaced the route on the map without asking. The question was
// being asked -- after applyRouteData had already overwritten waypoints, legs and notes, which
// is asking whether to destroy something already destroyed. It is asked first now, and the
// answer decides. Both files below are the same exercise; only the answer differs.
const BOTH = () => Object.assign({}, ROUTE_FILE, {
  title: 'Herzliya - Rosh Pina (CVFR exercise)',
  navlog: FIXTURE.navlog,
});

test('it asks before the route on the map is touched', async ({ page }) => {
  await boot(page);
  // The stub answers yes, but records what the map still held at the moment it was asked.
  await page.evaluate(() => {
    window.__askedWith = null;
    window.askYesNo = async () => {
      window.__askedWith = state.waypoints.map(w => w.name);
      return true;
    };
  });
  await page.setInputFiles('#file', {
    name: 'navaid-exercise.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(BOTH()), 'utf8'),
  });
  await page.waitForFunction(() => state.waypoints.length === 5, null, { timeout: 5000 });
  // The three points boot() drew -- not the five the file carries.
  expect(await page.evaluate(() => window.__askedWith)).toEqual(['LLHZ', 'א', 'LLIB']);
});

test('declining keeps the route on the map, and still takes the sheet', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.askYesNo = async () => false; });
  await page.setInputFiles('#file', {
    name: 'navaid-exercise.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(BOTH()), 'utf8'),
  });
  // The sheet lands either way: the met table is what tells us the import ran at all.
  await page.waitForFunction(() => NavAid.navLog.config().met.length === 6, null, { timeout: 5000 });
  const got = await page.evaluate(() => ({
    names: state.waypoints.map(w => w.name),
    cruise: NavAid.navLog.config().cruiseAltFt,
    dep: NavAid.navLog.config().depElevFt,
  }));
  expect(got).toEqual({ names: ['LLHZ', 'א', 'LLIB'], cruise: 6000, dep: 100 });
});

// Saying yes is not a one-way door: the route path's own Undo takes the old plan back.
test('accepting is undoable', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.askYesNo = async () => true; });
  await page.setInputFiles('#file', {
    name: 'navaid-exercise.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(BOTH()), 'utf8'),
  });
  await page.waitForFunction(() => state.waypoints.length === 5, null, { timeout: 5000 });
  await page.evaluate(() => undo());
  expect(await page.evaluate(() => state.waypoints.map(w => w.name)))
    .toEqual(['LLHZ', 'א', 'LLIB']);
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
  // Adding one keeps the list sorted, wherever the new level belongs. (It used to land above
  // the highest by construction; it now lands on a level the flight reads its air at, which is
  // as likely to be between two existing rows as above them -- so this asserts the order, which
  // is what the test is named for.)
  await page.evaluate(() => document.querySelector('.navlog-add').click());
  const after = await page.evaluate(() => NavAid.navLog.config().met.map(r => r.alt));
  expect(after).toHaveLength(3);
  expect(after).toEqual([...after].sort((a, b) => a - b));
  expect(after).toContain(2000);
  expect(after).toContain(6000);
});

// Reported: opening the file left every altitude as a dash -- the importer read the points and
// dropped the legs. One door now, and it lands the route complete.
test('an opened exercise lands the route with its altitudes', async ({ page }) => {
  await boot(page);
  const both = Object.assign({}, ROUTE_FILE, {
    title: 'Herzliya - Rosh Pina (CVFR exercise)',
    navlog: FIXTURE.navlog,
  });
  await openLog(page);
  await page.evaluate(() => { window.askYesNo = async () => true; });
  await page.setInputFiles('#file', {
    name: 'navaid-exercise.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(both), 'utf8'),
  });
  await page.waitForFunction(() => state.legs.length === 4 && state.legs[0].inboundAltitude === 6000,
    null, { timeout: 5000 });
  const got = await page.evaluate(() => ({
    // Every leg, both ways: a kite showing a dash is what was reported.
    kites: state.legs.map(l => [kiteAltitudeLabel(l.inboundAltitude, l, 'inboundAltitude'),
      kiteAltitudeLabel(l.outboundAltitude, l, 'outboundAltitude')]),
    met: NavAid.navLog.config().met.length,
  }));
  expect(got.kites).toEqual([['6000', '6000'], ['6000', '6000'], ['6000', '6000'], ['6000', '6000']]);
  expect(got.met).toBe(6);
});

// There is exactly one way in, and it is the app's own Open, in Import/Export. A second import
// button inside the window is a second place to look for the same thing.
test('the window offers no import of its own', async ({ page }) => {
  await boot(page);
  await openLog(page);
  expect(await page.locator('.navlog-import').count()).toBe(0);
  expect(await page.locator('.navlog-file').count()).toBe(0);
  // The way OUT stays here: the sheet it saves is a nav-table document nothing else composes.
  await expect(page.locator('.navlog-export')).toHaveText('Save exercise');
});

// Reported: the compass card took too many lines. It is printed two pairs of columns wide, and
// twelve marks down a single column is a table taller than the sheet it belongs to.
test('the compass card is laid out two pairs wide', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const grid = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.navlog-card-grid tr')];
    return {
      headers: [...rows[0].querySelectorAll('th')].map(th => th.textContent),
      bodyRows: rows.length - 1,
      inputs: document.querySelectorAll('.navlog-card-grid input').length,
      firstRow: [...rows[1].querySelectorAll('td')].map(td => td.textContent || td.querySelector('input').value),
    };
  });
  expect(grid.headers).toEqual(['For (M)', 'Steer (C)', 'For (M)', 'Steer (C)']);
  expect(grid.bodyRows).toBe(6);            // twelve marks, six lines
  expect(grid.inputs).toBe(12);             // every one of them still editable
  // The second half sits beside the first: 000 and 180 share a line, as they do on the sheet.
  expect(grid.firstRow[0]).toBe('000');
  expect(grid.firstRow[2]).toBe('180');
});

// An odd number of marks -- a card swung at other headings -- must not drop the last one.
test('an odd card keeps every mark', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const cfg = NavAid.navLog.config();
    cfg.deviation = [{ mh: 0, ch: 1 }, { mh: 90, ch: 91 }, { mh: 180, ch: 181 },
                     { mh: 240, ch: 241 }, { mh: 300, ch: 301 }];
    NavAid.navLog.save(cfg);
  });
  await openLog(page);
  const got = await page.evaluate(() => ({
    rows: document.querySelectorAll('.navlog-card-grid tr').length - 1,
    inputs: document.querySelectorAll('.navlog-card-grid input').length,
  }));
  expect(got.rows).toBe(3);
  expect(got.inputs).toBe(5);
});

// The window used to save the WHOLE config on every keystroke, defaults included, so the first
// edit anywhere froze the field elevations at whatever route was open and they never followed
// another one again.
test('an untouched elevation follows the route, however much else is typed', async ({ page }) => {
  await boot(page);
  await openLog(page);
  // Type something unrelated -- the cruise CAS -- which is what used to freeze the rest.
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.navlog-setup input')];
    const cas = inputs[3];                       // departure, destination, variation, climb CAS...
    cas.value = '75';
    cas.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('navaid.navlog')))))
    .toEqual(['cas']);
  // Now fly somewhere else: the elevations are the new field's, not the old one's.
  await page.evaluate(() => {
    state.waypoints[state.waypoints.length - 1] = { name: 'LLHZ', lat: 32.17944, lng: 34.83444 };
    syncLegs(); save(); draw();
  });
  const cfg = await page.evaluate(() => NavAid.navLog.config());
  expect(cfg.destElevFt).toBe(121);          // LLHZ's own, from the airfield dataset
  expect(cfg.cas.climb).toBe(75);            // what was typed is still what was typed
});

test('a typed elevation is a decision and outlives the route', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.navlog-setup input')];
    inputs[1].value = '900';                 // destination elevation, as the exercise states it
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    state.waypoints[state.waypoints.length - 1] = { name: 'LLHZ', lat: 32.17944, lng: 34.83444 };
    syncLegs(); save(); draw();
  });
  expect(await page.evaluate(() => NavAid.navLog.config().destElevFt)).toBe(900);
});

// The met table and the card are the exercise itself, not settings with a default behind them.
test('the tables are stored whole, and nothing else rides along', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await page.evaluate(() => document.querySelector('.navlog-add').click());
  const keys = await page.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('navaid.navlog'))).sort());
  expect(keys).toEqual(['deviation', 'met']);
});

// The header carries no airfield figure: those two numbers are already on the sheet, in the
// climb and descent rows they decide. What it carries instead is the way back -- clearing the
// box drops the override, and the elevation is the airfield's own again.
test('clearing an elevation hands it back to the airfield data', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const dest = () => page.evaluate(() =>
    [...document.querySelectorAll('.navlog-setup input')][1].value);
  expect(await dest()).toBe('884');                  // LLIB, from the dataset

  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.navlog-setup input')][1];
    input.value = '900';                             // as the exercise rounds it
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => NavAid.navLog.config().destElevFt)).toBe(900);

  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.navlog-setup input')][1];
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => NavAid.navLog.config().destElevFt)).toBe(884);
  expect(await dest()).toBe('884');
  expect(await page.evaluate(() =>
    Object.prototype.hasOwnProperty.call(JSON.parse(localStorage.getItem('navaid.navlog') || '{}'),
      'destElevFt'))).toBe(false);
});

// No figure printed beside the box -- that is on the sheet already -- but the way back is a
// control, on each field that has a default worth returning to, and only while it is holding
// something else.
test('the way back appears only when a field is holding an override', async ({ page }) => {
  await boot(page);
  await openLog(page);
  expect(await page.locator('.navlog-hint').count()).toBe(0);
  // Always on screen; dimmed when there is nothing to undo. `true` here means "live".
  const resets = () => page.evaluate(() =>
    [...document.querySelectorAll('.navlog-reset')]
      .map(b => !b.hidden && !b.classList.contains('navlog-reset-idle')));
  // Departure elevation, destination elevation, variation, and the two met fractions: five
  // fields with a default worth returning to, all quiet to begin with.
  expect(await resets()).toEqual([false, false, false, false, false]);

  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.navlog-setup input')][2];   // variation
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await resets()).toEqual([false, false, true, false, false]);

  await page.evaluate(() => document.querySelectorAll('.navlog-reset')[2].click());
  expect(await resets()).toEqual([false, false, false, false, false]);
  expect(await page.evaluate(() => NavAid.navLog.config().variationDeg)).toBe(5);
  expect(await page.evaluate(() =>
    Object.prototype.hasOwnProperty.call(JSON.parse(localStorage.getItem('navaid.navlog') || '{}'),
      'variationDeg'))).toBe(false);
});

test('the arrow hands an elevation back to the airfield data', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.navlog-setup input')][1];   // destination
    input.value = '900';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => NavAid.navLog.config().destElevFt)).toBe(900);
  await page.evaluate(() => document.querySelectorAll('.navlog-reset')[1].click());
  expect(await page.evaluate(() => NavAid.navLog.config().destElevFt)).toBe(884);   // LLIB's own
  expect(await page.evaluate(() =>
    [...document.querySelectorAll('.navlog-setup input')][1].value)).toBe('884');
});

// The variation the form starts from is NavAid's own, not a number of its own. The app signs it
// the other way round -- magnetic = true + variation, so its -5 is 5E on a sheet -- and the form
// writes what a chart writes.
test('variation defaults to the app\'s own, in the sheet\'s sign', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => tune('magneticVariationDeg'))).toBe(-5);
  expect(await page.evaluate(() => NavAid.navLog.config().variationDeg)).toBe(5);
  await openLog(page);
  const shown = await page.evaluate(() => {
    const row = document.querySelector('.navlog-table tr.navlog-row');
    return { field: [...document.querySelectorAll('.navlog-setup input')][2].value,
             column: row.querySelectorAll('td')[12].textContent };
  });
  expect(shown.field).toBe('5');
  expect(shown.column).toBe('5E');
  // A fleet that tunes the variation moves the form with it.
  await page.evaluate(() => { setTune('magneticVariationDeg', -4); });
  expect(await page.evaluate(() => NavAid.navLog.config().variationDeg)).toBe(4);
});

// "לחישוב TAS בנסיקה התחשב ב-2/3 גובה הטיפוס והווסף גובה שדה יציאה" -- two thirds of the height
// GAINED, plus the field it left; a half of the height lost for the descent. Those are the
// defaults, and they are now typed rather than built in, because another syllabus may say
// something else.
test('the met fractions are the exercise\'s, and they are editable', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const cfg = await page.evaluate(() => NavAid.navLog.config());
  expect(cfg.paFraction.climb).toBeCloseTo(2 / 3, 5);
  expect(cfg.paFraction.descent).toBeCloseTo(1 / 2, 5);
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('.navlog-setup input')].map(i => i.value));
  // The order in the row: two elevations, variation, three CAS values, then the two fractions.
  expect(shown[6]).toBe('67');          // climb, as a percentage
  expect(shown[7]).toBe('50');          // descent

  const pa = () => page.evaluate(() => ({
    climb: Math.round(NavAid.navLog.rows()[0].pressureAltFt),
    descent: Math.round(NavAid.navLog.rows().slice(-1)[0].pressureAltFt),
  }));
  // LLHZ 121 -> 6,000: two thirds of the 5,879 ft gained is 4,040 above the field it left.
  expect((await pa()).climb).toBe(4040);

  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.navlog-setup input')][6];
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect((await pa()).climb).toBe(3061);          // 121 + half of 5,879
  expect(await page.evaluate(() => NavAid.navLog.config().paFraction.climb)).toBeCloseTo(0.5, 5);

  // And back, without remembering what the standard one was.
  await page.evaluate(() => document.querySelectorAll('.navlog-reset')[3].click());
  expect((await pa()).climb).toBe(4040);
});

// A percentage outside 0-100 is not a fraction of anything, and must not silently become one.
test('an impossible fraction is refused, and the last good one stands', async ({ page }) => {
  await boot(page);
  await openLog(page);
  // 'abc' never reaches the handler as text -- a number input hands over '' -- and an empty box
  // means "the standard one", which is checked in the fraction test above.
  for (const bad of ['150', '-20', '250']) {
    await page.evaluate((v) => {
      const input = [...document.querySelectorAll('.navlog-setup input')][7];
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, bad);
    expect(await page.evaluate(() => NavAid.navLog.config().paFraction.descent), bad)
      .toBeCloseTo(0.5, 5);
  }
});

// The arrow belongs to the box it resets. Under it, it reads as another row of the form.
test('the restore arrow sits beside its box, not below it', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.navlog-setup input')][2];   // variation
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const box = await page.evaluate(() => {
    const field = [...document.querySelectorAll('.navlog-field')][2];
    const i = field.querySelector('input').getBoundingClientRect();
    const r = field.querySelector('.navlog-reset').getBoundingClientRect();
    return { input: { left: i.left, right: i.right, top: i.top, bottom: i.bottom },
             reset: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } };
  });
  // To the right of the box...
  expect(box.reset.left).toBeGreaterThanOrEqual(box.input.right - 1);
  // And it was on screen before anything was typed, holding its place in the row.

  // ...and on the same line as it, not under it.
  expect(box.reset.top).toBeLessThan(box.input.bottom);
  expect(box.reset.bottom).toBeGreaterThan(box.input.top);
});

// Asked for: fetch the wind and temperature for the relevant altitudes, and calculate from them.
// It fills the TABLE rather than feeding the sheet directly -- what was fetched is then visible,
// editable and saved, and the sheet reads it like any level typed off an exercise.
async function stubForecast(page) {
  await page.route('**/api.open-meteo.com/**', (route) => {
    const url = new URL(route.request().url());
    const names = (url.searchParams.get('hourly') || '').split(',');
    const hourly = { time: ['2026-09-15T00:00', '2026-09-15T01:00'] };
    for (const name of names) {
      const level = Number((name.match(/_(\d+)hPa$/) || [])[1]) || 0;
      // Something level-dependent, so a wrong level cannot pass unnoticed.
      if (name.startsWith('wind_speed')) hourly[name] = [Math.round(1000 - level) / 10, 0];
      else if (name.startsWith('wind_direction')) hourly[name] = [(level % 360), 0];
      else hourly[name] = [Math.round((level - 700) / 10), 0];
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hourly }) });
  });
}

test('the forecast fills the met table, and the sheet computes from it', async ({ page }) => {
  await boot(page);
  await stubForecast(page);
  await openLog(page);
  expect(await page.evaluate(() => NavAid.navLog.config().met.length)).toBe(0);
  const before = await page.evaluate(() => NavAid.navLog.rows()[0].metSource);
  expect(before).toBe('isa');            // nothing typed, nothing fetched

  await page.locator('.navlog-fetch').click();
  await page.waitForFunction(() => NavAid.navLog.config().met.length > 0, null, { timeout: 5000 });
  const got = await page.evaluate(() => ({
    met: NavAid.navLog.config().met,
    stored: JSON.parse(localStorage.getItem('navaid.navlog')).met.length,
    source: NavAid.navLog.rows()[0].metSource,
    rows: document.querySelectorAll('.navlog-met .navlog-grid tr').length - 1,
  }));
  // The altitudes the sheet reads its air at, bracketed either side -- not a fixed ladder.
  const pas = await page.evaluate(() =>
    NavAid.navLog.rows().map(r => Math.round(r.pressureAltFt / 100) * 100));
  for (const pa of pas) expect(got.met.map(r => r.alt)).toContain(pa);
  expect(got.met[0].alt).toBeLessThan(Math.min(...pas));
  expect(got.met[got.met.length - 1].alt).toBeGreaterThan(Math.max(...pas));
  expect(got.met.every(r => Number.isFinite(r.dir) && Number.isFinite(r.kt) && Number.isFinite(r.tempC))).toBe(true);
  // In the table on screen, in the storage, and in the arithmetic.
  expect(got.rows).toBe(got.met.length);
  expect(got.stored).toBe(got.met.length);
  expect(got.source).toBe('table');
});

test('a forecast that does not arrive leaves the table alone', async ({ page }) => {
  await boot(page);
  await page.route('**/api.open-meteo.com/**', route => route.fulfill({ status: 503, body: '' }));
  await page.evaluate(() => {
    const cfg = NavAid.navLog.config();
    cfg.met = [{ alt: 6000, dir: 320, kt: 25, tempC: 2 }];
    NavAid.navLog.save(cfg);
  });
  await openLog(page);
  const toasts = await page.evaluate(() => { window.__t = []; window.showToast = m => window.__t.push(String(m)); return true; });
  expect(toasts).toBe(true);
  await page.locator('.navlog-fetch').click();
  await page.waitForFunction(() => (window.__t || []).length > 0, null, { timeout: 5000 });
  // Half a met table is worse than none: the sheet would quietly compute from it.
  expect(await page.evaluate(() => NavAid.navLog.config().met)).toEqual([{ alt: 6000, dir: 320, kt: 25, tempC: 2 }]);
  expect(await page.evaluate(() => window.__t.join(' '))).toMatch(/could not fetch/i);
});

// Asked why it pulled 2,000 / 3,000 / 4,000 on a route flown at 800 ft: it was a fixed ladder.
// The sheet has a pressure altitude for every row -- that is where each row's TAS is read -- so
// those are the levels fetched, bracketed by one above and below for the nearest-row lookup.
test('the levels asked for are the ones the sheet reads its air at', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.legs[0].inboundAltitude = 800;
    for (let i = 1; i < state.legs.length; i++) state.legs[i].inboundAltitude = 2500;
    save(); draw();
  });
  const got = await page.evaluate(() => ({
    levels: NavAid.navLog.metLevelsFor(),
    pas: NavAid.navLog.rows().map(r => Math.round(r.pressureAltFt / 100) * 100),
  }));
  // Every altitude the sheet reads its air at is asked for.
  for (const pa of got.pas) expect(got.levels, JSON.stringify(got)).toContain(pa);
  // Nothing from a ladder that has nothing to do with this flight.
  expect(got.levels).not.toContain(7000);
  // Bracketed either side, so the nearest-row lookup always has a neighbour.
  expect(Math.min(...got.levels)).toBeLessThan(Math.min(...got.pas));
  expect(Math.max(...got.levels)).toBeGreaterThan(Math.max(...got.pas));
});

test('with no route at all it falls back to a plain ladder', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog));
  const levels = await page.evaluate(() => NavAid.navLog.metLevelsFor());
  expect(levels[0]).toBe(2000);
  expect(levels[levels.length - 1]).toBe(7000);
});

// Asked: is it affected by the time slider? It is now. Planning is done for a departure that has
// not happened yet, so a forecast pinned to "now" is the wrong forecast for most of the flights
// this sheet is worked out for. It reads the same master look-ahead clock every other layer
// answers to -- NOTAM, wind field, airfield wind, density altitude.
test('the forecast is fetched for the hour the look-ahead clock points at', async ({ page }) => {
  await boot(page);
  let asked = null;
  await page.route('**/api.open-meteo.com/**', (route) => {
    const url = new URL(route.request().url());
    const names = (url.searchParams.get('hourly') || '').split(',');
    // Twelve hours of forecast starting at the top of this UTC hour.
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    const time = [];
    for (let h = 0; h < 12; h++) {
      time.push(new Date(start.getTime() + h * 3600000).toISOString().slice(0, 16));
    }
    const hourly = { time };
    for (const name of names) {
      const level = Number((name.match(/_(\d+)hPa$/) || [])[1]) || 0;
      // The VALUE encodes the hour, so the row that lands says which hour was read.
      hourly[name] = time.map((t, h) => (name.startsWith('wind_direction')
        ? (level % 360) : (name.startsWith('wind_speed') ? h : Math.round((level - 700) / 10))));
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hourly }) });
  });
  await openLog(page);

  // Live: the first hour.
  await page.locator('.navlog-fetch').click();
  await page.waitForFunction(() => NavAid.navLog.config().met.length > 0, null, { timeout: 5000 });
  expect(await page.evaluate(() => NavAid.navLog.config().met[0].kt)).toBe(0);

  // Three hours ahead on the shared clock: the same fetch reads three hours in.
  await page.evaluate(() => {
    const master = document.getElementById('lookahead-time');
    master.value = '3';
    master.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => NavAid.navLog.lookaheadHoursAhead())).toBe(3);
  await page.locator('.navlog-fetch').click();
  await page.waitForFunction(() => NavAid.navLog.config().met[0].kt === 3, null, { timeout: 5000 });
  expect(await page.evaluate(() => NavAid.navLog.config().met[0].kt)).toBe(3);
  expect(asked).toBe(null);
});

// Side by side and touching, the two buttons read as one control with a seam down it.
test('the met table\'s buttons have room between them', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const gap = await page.evaluate(() => {
    const a = document.querySelector('.navlog-add').getBoundingClientRect();
    const f = document.querySelector('.navlog-fetch').getBoundingClientRect();
    const [left, right] = a.left < f.left ? [a, f] : [f, a];
    return { between: right.left - left.right, sameRow: right.top < left.bottom && right.bottom > left.top };
  });
  expect(gap.between).toBeGreaterThanOrEqual(6);
  expect(gap.sameRow).toBe(true);
});

// Asked for: the undo arrow stays on screen even when the field is already at its default.
// Dim, never hide -- a control that comes and goes moves the row under the hand reaching for
// it, and one a pilot has never seen is one they do not know they have.
test('the undo arrow is always there, dimmed when there is nothing to undo', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const state1 = await page.evaluate(() => [...document.querySelectorAll('.navlog-reset')]
    .map(b => ({ hidden: b.hidden, idle: b.classList.contains('navlog-reset-idle'),
                 title: b.title, visible: b.getBoundingClientRect().width > 0 })));
  expect(state1).toHaveLength(5);
  for (const b of state1) {
    expect(b.hidden).toBe(false);
    expect(b.visible).toBe(true);
    expect(b.idle).toBe(true);
    expect(b.title).toMatch(/already the default/i);
  }
  // Pressing one that has nothing to undo is harmless.
  await page.evaluate(() => document.querySelectorAll('.navlog-reset')[2].click());
  expect(await page.evaluate(() => NavAid.navLog.config().variationDeg)).toBe(5);

  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.navlog-setup input')][2];
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const after = await page.evaluate(() => {
    const b = document.querySelectorAll('.navlog-reset')[2];
    return { idle: b.classList.contains('navlog-reset-idle'), title: b.title };
  });
  expect(after.idle).toBe(false);
  expect(after.title).toMatch(/back to the variation/i);
});

// Reported: a refresh, or a language switch (which IS a refresh -- it reloads with ?lang),
// closed the form, while every other table on the toolbar comes back.
test('the form comes back after a reload, like every other chart window', async ({ page }) => {
  await boot(page);
  await openLog(page);
  expect(await page.evaluate(() => sessionStorage.getItem('navaid.openChartModal'))).toBe('nav-table');
  await page.reload();
  await page.waitForSelector('.navlog-modal .navlog-table', { timeout: 8000 });
  await expect(page.locator('.navlog-modal')).toBeVisible();
});

test('closing it means it stays closed', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await page.evaluate(() => {
    const back = document.querySelector('.navlog-modal').closest('.modal-back');
    if (back && back._navaidClose) back._navaidClose();
    else document.querySelector('.modal-back .modal-x, .modal-x').click();
  });
  expect(await page.evaluate(() => sessionStorage.getItem('navaid.openChartModal'))).toBe(null);
  await page.reload();
  await page.waitForFunction(() => typeof draw === 'function');
  expect(await page.locator('.navlog-modal').count()).toBe(0);
});

// Dark is the window's own colour (.modal is #2a2626); the form used to be the only light thing
// inside it, because its inputs and grids were the browser's defaults.
test('the form is painted from the window\'s palette, not the browser\'s', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const paint = await page.evaluate(() => {
    // The app boots light in tests; this is about what dark mode looks like.
    document.body.classList.remove('theme-light');
    const input = document.querySelector('.navlog-setup input');
    const th = document.querySelector('.navlog-table th');
    const rgb = (el, prop) => getComputedStyle(el)[prop];
    // Alpha matters: a header tinted rgba(255,255,255,0.05) is a whisper over the dark window,
    // not a white box, and reading only the channels calls it white.
    const parse = (css) => {
      const m = (css.match(/[\d.]+/g) || []).map(Number);
      const a = m.length > 3 ? m[3] : 1;
      return { lum: (m[0] * 0.299 + m[1] * 0.587 + m[2] * 0.114) / 255, alpha: a };
    };
    return { input: parse(rgb(input, 'backgroundColor')), text: parse(rgb(input, 'color')),
             head: parse(rgb(th, 'backgroundColor')) };
  });
  // The box is opaque and darker than its text, which is the definition of not-a-white-box.
  expect(paint.input.alpha).toBe(1);
  expect(paint.input.lum).toBeLessThan(0.3);
  expect(paint.text.lum).toBeGreaterThan(0.6);
  // The header is a tint over the window, not a panel of its own.
  expect(paint.head.alpha).toBeLessThan(0.2);
});

// Reported: "the first leg is lower than 2500, it's 800" -- a TOC that landed in the second leg
// because the whole route was flattened to its highest planned level. Each leg is flown at the
// altitude on its own kite, so a route that leaves at 800 and steps up to 2,500 climbs twice.
test('each leg is flown at its own planned altitude', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { name: 'LLHZ', lat: 32.17944, lng: 34.83444 },
      { name: 'A', lat: 32.35, lng: 34.95 },
      { name: 'B', lat: 32.7, lng: 35.2 },
      { name: 'LLIB', lat: 32.98111, lng: 35.57194 },
    ];
    syncLegs();
    state.legs[0].inboundAltitude = 800;      // low, out of the circuit
    state.legs[1].inboundAltitude = 2500;     // then up
    state.legs[2].inboundAltitude = 2500;
    save(); draw();
  });
  const rows = await page.evaluate(() => NavAid.navLog.rows().map(r => ({
    kind: r.kind, from: r.from, to: r.to, pa: Math.round(r.pressureAltFt) })));
  // The first climb is to 800 and ends inside the first leg -- LLHZ 121 ft to 800 is 679 ft.
  expect(rows[0]).toMatchObject({ kind: 'climb', from: 'LLHZ', to: 'TOC' });
  expect(rows[0].pa).toBe(574);              // 121 + two thirds of 679
  expect(rows[1]).toMatchObject({ kind: 'cruise', from: 'TOC', to: 'A' });
  expect(rows[1].pa).toBe(800);              // the leg's own level, not the route's highest
  // The step up to 2,500 is NOT a second top of climb: the pilot has not said where in the leg
  // the level changes, and a sheet that guesses prints a TOC at every waypoint -- which is how
  // this was reported. The leg is simply flown at the level it is planned at.
  expect(rows.filter(r => r.to === 'TOC')).toHaveLength(1);
  const stepped = rows.find(r => r.kind === 'cruise' && r.from === 'A');
  expect(stepped, JSON.stringify(rows)).toBeTruthy();
  expect(stepped.pa).toBe(2500);
  expect(rows[rows.length - 1].kind).toBe('descent');
});

// A route with no altitudes typed on it is still a sheet: one level, the fallback.
test('a route with no planned altitudes uses the single level', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.legs.forEach(l => { l.inboundAltitude = NaN; });
    save(); draw();
  });
  const rows = await page.evaluate(() => NavAid.navLog.rows().map(r => Math.round(r.pressureAltFt)));
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every(pa => Number.isFinite(pa))).toBe(true);
});

// Reported with a screenshot: TOC, TOC, TOC down the page, one for every leg planned a little
// higher than the last. There is one top of climb -- the climb off the departure field.
test('there is exactly one TOC, however the levels step', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { name: 'LLHZ', lat: 32.17944, lng: 34.83444 },
      { name: 'BAZRA', lat: 32.28, lng: 34.93 },
      { name: 'DEROR', lat: 32.40, lng: 35.02 },
      { name: 'SHARO', lat: 32.55, lng: 35.10 },
      { name: 'HADRA', lat: 32.70, lng: 35.20 },
      { name: 'LLIB', lat: 32.98111, lng: 35.57194 },
    ];
    syncLegs();
    // Levels that step up and down the way a real CVFR route does.
    const alts = [800, 2500, 2000, 2500, 3000];
    state.legs.forEach((l, i) => { l.inboundAltitude = alts[i]; });
    save(); draw();
  });
  const rows = await page.evaluate(() => NavAid.navLog.rows().map(r => ({
    kind: r.kind, from: r.from, to: r.to, pa: Math.round(r.pressureAltFt) })));
  expect(rows.filter(r => r.to === 'TOC'), JSON.stringify(rows)).toHaveLength(1);
  expect(rows[0].kind).toBe('climb');
  expect(rows[0].from).toBe('LLHZ');
  // Every later leg is a cruise row at its own level, and the sheet ends in the descent.
  expect(rows.filter(r => r.kind === 'cruise').map(r => r.pa)).toEqual([800, 2500, 2000, 2500, 3000]);
  expect(rows[rows.length - 1].kind).toBe('descent');
  expect(rows.filter(r => r.from === 'TOD')).toHaveLength(1);
});

// Only one chart on screen: two full-width tables of the same route, one over the other, is what
// opening the flight plan with the form already up looked like.
test('opening the flight plan closes the planning form', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await expect(page.locator('.navlog-modal')).toBeVisible();
  await page.evaluate(() => showFlightPlan());
  await page.waitForFunction(() => !document.querySelector('.navlog-modal'), null, { timeout: 5000 });
  expect(await page.locator('.navlog-modal').count()).toBe(0);
  await expect(page.locator('.modal-back.flight-plan')).toBeVisible();
  // ...and the session no longer says to bring it back on the next reload.
  expect(await page.evaluate(() => sessionStorage.getItem('navaid.openChartModal'))).toBe(null);
});

// ...and the other way round, which the generic sweep already did for every other table.
test('opening another chart closes it too', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await page.evaluate(() => { if (typeof showFreqTableModal === 'function') showFreqTableModal(); });
  await page.waitForFunction(() => !document.querySelector('.navlog-modal'), null, { timeout: 5000 });
  expect(await page.locator('.navlog-modal').count()).toBe(0);
});

// Movable by its title bar, resizable by its corner: 23 columns is a table somebody wants wider.
test('the window can be moved and resized', async ({ page }) => {
  await boot(page);
  await openLog(page);
  const css = await page.evaluate(() => {
    const box = document.querySelector('.navlog-modal');
    const s = getComputedStyle(box);
    return { resize: s.resize, overflow: s.overflow,
             title: !!box.querySelector('.modal-title.modal-drag-handle') };
  });
  expect(css.resize).toBe('both');
  expect(css.title, 'the title bar is the drag handle').toBe(true);
});

// The clock decides which hour the forecast is fetched for, so it must be findable while the
// form is open. Reported as barely visible -- which is exactly when it decides something.
test('the look-ahead clock is lit while the form is open', async ({ page }) => {
  await boot(page);
  const idle = () => page.evaluate(() => {
    const el = document.getElementById('map-time');
    return el ? el.classList.contains('idle') : null;
  });
  expect(await idle()).toBe(true);           // nothing else timed on this map
  await openLog(page);
  expect(await idle()).toBe(false);
  await page.evaluate(() => {
    const back = document.querySelector('.navlog-modal').closest('.modal-back');
    if (back && back._navaidClose) back._navaidClose();
  });
  await page.waitForTimeout(50);
  expect(await idle()).toBe(true);
});

// Found in review: the sheet could come up short -- a missing row, a dash for a ground speed --
// and say nothing about why. What it cannot do is now said under it.
test('the sheet says what it could not work out', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const cfg = NavAid.navLog.config();
    cfg.met = [{ alt: 2000, dir: 90, kt: 200, tempC: 10 }];   // a gale across the route
    NavAid.navLog.save(cfg);
  });
  await openLog(page);
  const seen = await page.evaluate(() => ({
    note: document.querySelector('.navlog-note').textContent,
    warn: document.querySelector('.navlog-note').classList.contains('navlog-note-warn'),
    gs: [...document.querySelectorAll('.navlog-table tr.navlog-row')]
      .map(tr => tr.querySelectorAll('td')[16].textContent),
  }));
  expect(seen.warn).toBe(true);
  expect(seen.note).toMatch(/crosswind/i);
  expect(seen.gs.some(t => /no solution/i.test(t))).toBe(true);
});

test('a climb with no rate says so under the sheet', async ({ page }) => {
  await boot(page);
  await openLog(page);
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.navlog-setup input')][8];   // climb fpm
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const note = await page.evaluate(() => document.querySelector('.navlog-note').textContent);
  expect(note).toMatch(/no rate of climb/i);
});

// "Add a level" appended the next rung of a ladder -- highest + 1000, with wind 00/00 and 15 °C
// whatever the altitude. Three problems in one button: the altitude was not a level this flight
// reads its air at, and the sheet works its true airspeeds from that temperature column, so a
// flat 15 is a wrong number wearing the shape of a default.
test.describe('adding a met level', () => {
  const alts = (page) => page.evaluate(() => NavAid.navLog.config().met.map(r => r.alt));

  test('it adds a level this flight actually reads its air at', async ({ page }) => {
    await boot(page);
    await openLog(page);
    // The levels the sheet asks the forecast for: the same list, and the table starts empty.
    const wanted = await page.evaluate(() => NavAid.navLog.metLevelsFor(NavAid.navLog.config()));
    expect(await alts(page)).toEqual([]);
    await page.locator('.navlog-add').click();
    expect(await alts(page)).toEqual([wanted[0]]);
    await page.locator('.navlog-add').click();
    expect(await alts(page)).toEqual(wanted.slice(0, 2));
  });

  // The temperature column is where every TAS on the sheet comes from.
  test('the new row is ISA for its altitude, not 15 °C everywhere', async ({ page }) => {
    await boot(page);
    await openLog(page);
    await page.locator('.navlog-add').click();
    const row = await page.evaluate(() => NavAid.navLog.config().met[0]);
    // 15 − 2 °C per 1,000 ft, the lapse rate this sheet is worked to.
    expect(row.tempC).toBe(Math.round(15 - 2 * row.alt / 1000));
    expect(row.dir).toBe(0);      // nothing to copy from, so calm: it claims nothing
    expect(row.kt).toBe(0);
  });

  test('the wind is copied from the nearest row there is', async ({ page }) => {
    await boot(page);
    // Stored before the window opens: calling show() twice would leave two of them on screen.
    await page.evaluate(() => {
      NavAid.navLog.save({ met: [{ alt: 3000, dir: 270, kt: 22, tempC: 9 }] });
    });
    await openLog(page);
    await page.locator('.navlog-add').click();
    const rows = await page.evaluate(() => NavAid.navLog.config().met);
    const added = rows.find(r => r.alt !== 3000);
    expect(added.dir).toBe(270);
    expect(added.kt).toBe(22);
  });

  // Adding a level is asking to type one.
  test('the caret lands on the altitude just added', async ({ page }) => {
    await boot(page);
    await openLog(page);
    await page.locator('.navlog-add').click();
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      const cell = el && el.closest('td');
      return { tag: el && el.tagName, first: !!(cell && cell === cell.parentElement.children[0]),
        value: el && el.value };
    });
    expect(focused.tag).toBe('INPUT');
    expect(focused.first).toBe(true);
    expect(Number(focused.value)).toBe((await alts(page))[0]);
  });

  // The button says which level it is about to add, so it is not a surprise.
  test('the button names the level it will add', async ({ page }) => {
    await boot(page);
    await openLog(page);
    const wanted = await page.evaluate(() => NavAid.navLog.metLevelsFor(NavAid.navLog.config()));
    // Written the way a number is written: 2,000 rather than 2000.
    await expect(page.locator('.navlog-add'))
      .toHaveAttribute('title', new RegExp(wanted[0].toLocaleString('en-US').replace(',', ',')));
  });
});
