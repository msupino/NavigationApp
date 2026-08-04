// ICAO flight-plan (FPL) export. The message shape is pinned against the AIP's own
// sample (AIP Israel א'-11 נספח א'), because an AIS parser reads this, not a human:
//
//   (FPL-4XHLH-VG
//   -ULAC/L-S/C
//   -LLRS1100
//   -N0090VFR NTAIM NSHRM ...
//   -LLMG0100
//   -DOF/220929 RMK/PIC ISRAEL ISRAELI LICENSE 1234 CELL 0541234567
//   -E/0400 P/002)
const { test, expect } = require('./_setup');

// The whole point of these cases is the local-clock-to-UTC conversion, so the browser
// timezone is pinned: without it the suite asserted whatever the machine happened to be
// (it passed on a laptop in Israel and failed on a UTC CI runner). Israel is UTC+3 in
// summer, UTC+2 in winter -- both exercised below.
test.use({ timezoneId: 'Asia/Jerusalem' });

async function boot(page, q = '?lang=en&nogist') {
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  await page.goto(q);
  // Both datasets: the aerodrome codes come from `airfields`, the reporting points
  // from `navWP`. Waiting on only one raced the non-aerodrome-destination case.
  await page.waitForFunction(() => typeof buildIcaoFpl === 'function' &&
    typeof airfieldByIcao === 'function' && typeof findNavWpToken === 'function' &&
    Array.isArray(airfields) && airfields.length > 0 &&
    Array.isArray(window.navWP) && window.navWP.length > 0);
}

// Herzliya out to two published reporting points and back to a field, at 90 kt.
async function route(page, names = ['LLHZ', 'APOLN', 'ARENA', 'LLES']) {
  return page.evaluate(codes => {
    state.waypoints = [];
    for (const name of codes) {
      const af = airfieldByIcao(name);
      const wp = af || (typeof findNavWpToken === 'function' ? findNavWpToken(name) : null);
      if (!wp) throw new Error('test fixture missing: ' + name);
      state.waypoints.push({ lat: wp.lat, lng: wp.lng, name });
    }
    syncLegs();
    for (const l of state.legs) { l.flightSpeed = 90; l.outboundSpeed = 90; }
    draw();
    return state.waypoints.length;
  }, names);
}

// A route with an off-network point: that is what makes a flight cross-country, and
// what the form exists for. Named so it cannot resolve in either dataset.
async function offNetworkRoute(page) {
  return page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: 32.42, lng: 35.05, name: 'FARMSTRIP' },
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
    ];
    syncLegs();
    for (const l of state.legs) { l.flightSpeed = 90; l.outboundSpeed = 90; }
    draw();
  });
}

const PROFILE = {
  reg: 'HLH', type: 'ULAC', wake: 'L', equip: 'S', surv: 'C',
  pic: 'Israel Israeli', license: '1234', cell: '0541234567',
  endurance: '0400', persons: '2', kind: 'routes',
  replyTo: 'pilot@example.com',            // required: the approval comes back to it
};

// `now` is given as a LOCAL wall-clock string and built inside the page, where the
// timezone is the pinned one. Building it in Node would use the runner's timezone and
// silently shift the instant.
const build = (page, profile, opts) => {
  const o = { ...(opts || { dateLocal: '2022-09-29', timeLocal: '14:00' }) };
  return page.evaluate(([p, opt]) => {
    if (opt.nowLocal) {
      const [d, t] = opt.nowLocal.split('T');
      const [y, mo, da] = d.split('-').map(Number);
      const [h, mi] = t.split(':').map(Number);
      opt.now = new Date(y, mo - 1, da, h, mi, 0, 0);
    }
    return buildIcaoFpl(p, opt);
  }, [profile || PROFILE, o]);
};

test('the message matches the AIP sample shape line for line', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page);
  expect(res.errs).toBeUndefined();
  const lines = res.text.split('\n');
  expect(lines[0]).toBe('(FPL-4XHLH-VG');
  expect(lines[1]).toBe('-ULAC/L-S/C');
  expect(lines[2]).toMatch(/^-LLHZ\d{4}$/);            // field 13: aerodrome + EOBT
  expect(lines[3]).toMatch(/^-N0090VFR [A-Z0-9 ]+$/);  // no separator after the speed
  expect(lines[4]).toMatch(/^-LLES\d{4}$/);            // field 16: destination + EET
  expect(lines[5]).toMatch(/^-DOF\/220929 RMK\/PIC ISRAEL ISRAELI LICENSE 1234 CELL 0541234567$/);
  expect(lines[6]).toBe('-E/0400 P/002)');             // no space before the paren
});

test('a three-letter call sign gets the 4X prefix, a full one is left alone', async ({ page }) => {
  await boot(page);
  await route(page);
  expect((await build(page, { ...PROFILE, reg: 'HLH' })).text).toContain('(FPL-4XHLH-VG');
  expect((await build(page, { ...PROFILE, reg: '4X-HLH' })).text).toContain('(FPL-4XHLH-VG');
});

// The pilot reads a clock; the message carries UTC. Israel is UTC+3 in summer, so
// a 11:00 local departure is filed as 0800 -- exactly the case in the worked example.
test('the departure time is converted from local to UTC', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page, PROFILE, { dateLocal: '2026-08-04', timeLocal: '11:00' });
  expect(res.eobtUtc).toBe('0800');
  expect(res.dof).toBe('260804');
  expect(res.text).toContain('-LLHZ0800');
});

test('a winter departure converts at UTC+2', async ({ page }) => {
  await boot(page);
  await route(page);
  // Israel is UTC+2 in January: 11:00 local files as 0900.
  const res = await build(page, PROFILE, { dateLocal: '2027-01-14', timeLocal: '11:00' });
  expect(res.eobtUtc).toBe('0900');
  expect(res.dof).toBe('270114');
});

test('an evening departure that crosses midnight in UTC files the right date', async ({ page }) => {
  await boot(page);
  await route(page);
  // 02:30 local on 5 Aug (UTC+3) is 23:30 UTC on 4 Aug -- the DOF must go back a day.
  const res = await build(page, PROFILE, { dateLocal: '2026-08-05', timeLocal: '02:30' });
  expect(res.eobtUtc).toBe('2330');
  expect(res.dof).toBe('260804');
});

test('the route field lists the points between the two aerodromes', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page);
  const field15 = res.text.split('\n')[3];
  expect(field15).toContain('APOLN');
  expect(field15).toContain('ARENA');
  expect(field15).not.toContain('LLHZ');    // departure is field 13, not the route
  expect(field15).not.toContain('LLES');    // destination is field 16
});

// A plan is normally filed field-to-field, but an end that is not a known airfield is
// warned about, not blocked: ICAO files ZZZZ and names the point in field 18.
test('a route not ending at an airfield is warned about and filed as ZZZZ', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'APOLN', 'ARENA', 'NAGID']);
  const res = await build(page);
  expect(res.errs).toBeUndefined();                    // allowed
  expect(res.warns).toContain('warnFplDestNotAerodrome');
  expect(res.text).toMatch(/^-ZZZZ\d{4}$/m);
  expect(res.text).toContain('DEST/NAGID');
  // RMK is free text, so anything after it is swallowed -- the names must precede it.
  expect(res.text.indexOf('DEST/')).toBeLessThan(res.text.indexOf('RMK/'));
  expect(res.text.split('\n')[3]).toContain('NAGID');  // still flown, so still in field 15
});

test('a route not starting at an airfield is warned about and filed as ZZZZ', async ({ page }) => {
  await boot(page);
  await route(page, ['APOLN', 'ARENA', 'LLES']);
  const res = await build(page);
  expect(res.errs).toBeUndefined();
  expect(res.warns).toContain('warnFplDepNotAerodrome');
  expect(res.text).toMatch(/^-ZZZZ\d{4}$/m);
  expect(res.text).toContain('DEP/APOLN');
  expect(res.text.indexOf('DEP/')).toBeLessThan(res.text.indexOf('RMK/'));
  expect(res.text.split('\n')[3]).toContain('APOLN');
});

test('a route between two airfields files both ICAO codes and no warning', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page);
  expect(res.text).toContain('-LLHZ');
  expect(res.text).toMatch(/^-LLES\d{4}$/m);
  expect(res.text).not.toContain('ZZZZ');
  expect(res.warns).not.toContain('warnFplDepNotAerodrome');
  expect(res.warns).not.toContain('warnFplDestNotAerodrome');
});

// Field 16 is filed on a 5-minute grid, rounded UP: nobody files 00:33, and rounding
// down would understate how long the plan is held open.
test('the EET is rounded up to the next 5 minutes', async ({ page }) => {
  await boot(page);
  await route(page);
  const [res, raw] = await Promise.all([
    build(page),
    page.evaluate(() => routeProfile().totalTimeH * 60),
  ]);
  const filed = Number(res.eet.slice(0, 2)) * 60 + Number(res.eet.slice(2));
  expect(filed % 5).toBe(0);
  expect(filed).toBeGreaterThanOrEqual(raw - 1e-6);   // never files less than the route takes
  expect(filed - raw).toBeLessThan(5);
  expect(res.text).toContain('-LLES' + res.eet);      // and that is what field 16 carries
});

test('a total already on the 5-minute grid is filed unchanged', async ({ page }) => {
  await boot(page);
  await route(page);
  // Pick the speed that makes the route take exactly 30 minutes, so there is
  // nothing to round -- proving the rounding does not inflate a good number.
  await page.evaluate(() => {
    let nm = 0;
    for (let i = 0; i < state.legs.length; i++) {
      nm += geo(state.waypoints[i], state.waypoints[i + 1]).dist;
    }
    const kt = nm * 2;                       // nm / 0.5 h
    for (const l of state.legs) { l.flightSpeed = kt; l.outboundSpeed = kt; }
    draw();
  });
  const res = await build(page);
  expect(res.eet).toBe('0030');
});

test('the speed comes from the first leg', async ({ page }) => {
  await boot(page);
  await route(page);
  expect((await build(page)).text).toContain('-N0090VFR');
});

test('mixed leg speeds are flagged, not silently averaged', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => { state.legs[1].flightSpeed = 120; draw(); });
  const res = await build(page);
  expect(res.mixedSpeed).toBe(true);
  expect(res.warns).toContain('warnFplMixedSpeed');
  expect(res.text).toContain('-N0090VFR');   // the first leg's speed, as documented
});

// AIP א'-11 §3.ד.1 -- a routes plan is filed at least 60 min ahead.
test('a departure less than 60 minutes out is warned about', async ({ page }) => {
  await boot(page);
  await route(page);
  // Computed in the page, so "20 minutes from now" is 20 minutes in the pinned zone.
  const soon = await page.evaluate(() => {
    const d = new Date(Date.now() + 20 * 60000);
    const pad = n => String(n).padStart(2, '0');
    return {
      dateLocal: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      timeLocal: pad(d.getHours()) + ':' + pad(d.getMinutes()),
    };
  });
  const res = await build(page, PROFILE, soon);
  expect(res.warns).toContain('warnFplLead');
  expect(res.text).toBeTruthy();            // a warning, never a block
});

// AIP א'-11 §3.ד.1(ב) -- the filing window has an early edge as well as a late one.
test('filing too early for a morning flight is warned about', async ({ page }) => {
  await boot(page);
  await route(page);
  // A 10:00 departure on the 20th may be filed from 18:00 on the 19th. Filing at
  // 09:00 on the 19th is too early.
  const res = await build(page, PROFILE, {
    dateLocal: '2026-08-20', timeLocal: '10:00', nowLocal: '2026-08-19T09:00',
  });
  expect(res.warns).toContain('warnFplEarly');
  expect(res.text).toBeTruthy();                 // still only a warning
});

test('the evening-before window opens at 18:00 for a morning flight', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page, PROFILE, {
    dateLocal: '2026-08-20', timeLocal: '10:00', nowLocal: '2026-08-19T18:05',
  });
  expect(res.warns).not.toContain('warnFplEarly');
});

test('a departure after 17:00 must wait for the day of the flight', async ({ page }) => {
  await boot(page);
  await route(page);
  const args = { dateLocal: '2026-08-20', timeLocal: '19:00' };
  // 18:30 the evening before is early enough for a morning flight, but not for this one.
  const early = await build(page, PROFILE, { ...args, nowLocal: '2026-08-19T18:30' });
  expect(early.warns).toContain('warnFplEarly');
  const sameDay = await build(page, PROFILE, { ...args, nowLocal: '2026-08-20T08:00' });
  expect(sameDay.warns).not.toContain('warnFplEarly');
});

// AIP א'-11 §3.ב -- routes plans go to AIS, cross-country to the FPL desk.
test('the filing address follows the flight type, and a typed one wins', async ({ page }) => {
  await boot(page);
  await route(page);
  expect((await build(page, { ...PROFILE, kind: 'routes' })).to).toBe('ais@iaa.gov.il');
  expect((await build(page, { ...PROFILE, kind: 'crosscountry' })).to).toBe('fpl@iaa.gov.il');
  expect((await build(page, { ...PROFILE, aisEmail: 'me@example.com' })).to).toBe('me@example.com');
});

// AIP א'-11 נספח ב' -- a מרחב plan is a tabular form, not an ICAO message, so the
// builder must not present its output as something to mail to the FPL desk.
test('a cross-country plan is flagged as needing the authority form', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page, { ...PROFILE, kind: 'crosscountry' });
  expect(res.warns).toContain('warnFplCrossForm');
  expect(res.text).toBeTruthy();                      // still shown, for reference
  const routes = await build(page, { ...PROFILE, kind: 'routes' });
  expect(routes.warns).not.toContain('warnFplCrossForm');
});

// The address is the published one from AIP א'-11 §3.ב, pre-filled rather than hinted.
test('the dialog pre-fills the published filing address for the flight type', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => { showFlightPlan(); document.getElementById('fpl-open').click(); });
  // The flight type leads the form; the address still lives under Advanced.
  await page.click('.fpl-advanced summary');
  await expect(page.locator('#fpl-ais-email')).toHaveValue('ais@iaa.gov.il');
  // Switching the flight type moves the address with it...
  await page.selectOption('#fpl-kind', 'crosscountry');
  await expect(page.locator('#fpl-ais-email')).toHaveValue('fpl@iaa.gov.il');
  // ...but never overwrites one the pilot typed.
  await page.fill('#fpl-ais-email', 'ops@example.com');
  await page.selectOption('#fpl-kind', 'routes');
  await expect(page.locator('#fpl-ais-email')).toHaveValue('ops@example.com');
});

// One plan is one flight, field to field. A field in the middle means the aircraft lands
// there and departs again -- two plans, which one plan cannot describe (one EOBT, one
// destination, one EET).
test('a route landing at an airfield on the way is refused as two plans', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ'), es = airfieldByIcao('LLES'), pl = airfieldByIcao('LLPL');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: es.lat, lng: es.lng, name: 'LLES' },      // a field in the middle
      { lat: pl.lat, lng: pl.lng, name: 'LLPL' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    draw();
  });
  const res = await build(page);
  expect(res.errs.some(e => String(e).startsWith('errFplMidAirfield'))).toBe(true);
  expect(res.text).toBeUndefined();
  // Names the field the way the rest of the UI does -- not its ICAO code.
  const msg = res.errs.find(e => String(e).startsWith('errFplMidAirfield'));
  expect(msg).toMatch(/Ein Shemer/);
  expect(msg).not.toMatch(/LLES/);
});

test('the dialog refuses it too, and names the field', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ'), es = airfieldByIcao('LLES'), pl = airfieldByIcao('LLPL');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: es.lat, lng: es.lng, name: 'LLES' },
      { lat: pl.lat, lng: pl.lng, name: 'LLPL' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    draw();
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  await expect(page.locator('#fpl-text')).toHaveCount(0);          // no message built
  await expect(page.locator('.fpl-errs')).toContainText(/two flight plans|שתי תוכניות/);
  await expect(page.locator('.fpl-errs')).toContainText(/Ein Shemer/);
  // Submission is unreachable: there is no review step, so no submit button exists.
  await expect(page.locator('#fpl-mail')).toHaveCount(0);
  await expect(page.locator('.fpl-ack')).toHaveCount(0);
  // Pressing Continue again keeps refusing rather than letting it through.
  await page.locator('#fpl-next').click();
  await expect(page.locator('#fpl-text')).toHaveCount(0);
});

// Reporting points in the middle are the normal case and must stay fine.
test('reporting points in the middle are not affected', async ({ page }) => {
  await boot(page);
  await route(page);                       // LLHZ APOLN ARENA LLES
  const res = await build(page);
  expect(res.errs).toBeUndefined();
  expect(res.text).toContain('-N0090VFR APOLN ARENA');
});

// The official filing page carries a third box naming the destination's operator, so a
// plan that lands somewhere we can name asks for that coordination too.
test('a landing site adds a third acknowledgement, naming it', async ({ page }) => {
  await boot(page);
  await route(page);                       // ... -> LLES, an uncontrolled field
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  await expect(page.locator('.fpl-ack')).toHaveCount(3);
  const third = page.locator('#fpl-ack-landing');
  await expect(third).toHaveCount(1);
  // Names the site, so it is obvious who is to be called.
  const text = await page.locator('#fpl-ack-landing').locator('..').textContent();
  expect(text).toMatch(/Ein Shemer/);       // the name, not LLES
  expect(text).not.toMatch(/LLES/);

  // All three gate the submission, not just the original two.
  await page.locator('#fpl-ack-aip').check();
  await page.locator('#fpl-ack-wx').check();
  await page.locator('#fpl-mail').click();
  await expect(page.locator('#fpl-ack-required')).toBeVisible();
  await expect(page.locator('.fpl-ack-missing')).toHaveCount(1);
  await third.check();
  await expect(page.locator('#fpl-ack-required')).toBeHidden();
});

// A controlled field is a tower call, not an operator call (א׳-11 §2.ח).
test('a controlled destination asks about the tower and radio contact', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ'), es = airfieldByIcao('LLES');
    state.waypoints = [
      { lat: es.lat, lng: es.lng, name: 'LLES' },
      { lat: 32.3, lng: 34.9, name: 'APOLN' },
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },     // controlled: has clearance/ATIS
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    draw();
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  const text = await page.locator('#fpl-ack-landing').locator('..').textContent();
  expect(text).toMatch(/tower|מגדל/);
  expect(text).toMatch(/radio|רדיו/);
});

// Only the landing end. A plan cannot route over an airfield by the rules, and the
// departure field is one the pilot is already standing on.
test('a route that does not land at a named site has only the two boxes', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'APOLN', 'ARENA', 'NAGID']);   // ends at a reporting point
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  await expect(page.locator('.fpl-ack')).toHaveCount(2);
  await expect(page.locator('#fpl-ack-landing')).toHaveCount(0);
});

// A disabled button explains nothing: submitting with the boxes unticked has to say so.
test('submitting without the acknowledgements says what is missing', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500', kind: 'routes',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  const mail = page.locator('#fpl-mail');
  await expect(mail).toBeEnabled();                       // enabled, so it can explain
  await expect(page.locator('#fpl-ack-required')).toBeHidden();
  await mail.click();
  await expect(page.locator('#fpl-ack-required')).toBeVisible();
  // The wording carries no count: a landing site makes it three, so "both" would be wrong.
  const note = await page.locator('#fpl-ack-required').textContent();
  expect(note).not.toMatch(/both|two|שני|שתי/);
  const outstanding = await page.locator('.fpl-ack input').count();
  await expect(page.locator('.fpl-ack-missing')).toHaveCount(outstanding);
  // Ticking one leaves the others marked; ticking them all clears the message.
  const boxes = await page.locator('.fpl-ack input').all();
  await boxes[0].check();
  await expect(page.locator('.fpl-ack-missing')).toHaveCount(boxes.length - 1);
  for (const cb of boxes.slice(1)) await cb.check();
  await expect(page.locator('#fpl-ack-required')).toBeHidden();
  await expect(page.locator('.fpl-ack-missing')).toHaveCount(0);
});

// mailto: fails silently on a device with no mail app, so submitting must leave the
// pilot able to file by hand rather than wondering whether anything happened.
test('submitting reveals the address to use if no mail app opens', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500', kind: 'routes',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  await expect(page.locator('#fpl-mail-fallback')).toBeHidden();
  // Tick every acknowledgement this route asks for (a landing site adds a third).
  for (const cb of await page.locator('.fpl-ack input').all()) await cb.check();
  // Stop the navigation the click would trigger; the panel is what matters here.
  await page.evaluate(() => { window.__navGuard = true; });
  await page.locator('#fpl-mail').click();
  await expect(page.locator('#fpl-mail-fallback')).toBeVisible();
  await expect(page.locator('.fpl-fallback-addr')).toHaveText('ais@iaa.gov.il');
  await expect(page.locator('#fpl-copy')).toBeVisible();       // and Copy is right there
});

// A cross-country plan belongs on the authority's own form, so this dialog must offer
// no way to mail it -- not a disabled button, not a hidden one: none.
// The choice that decides which artifact is produced leads the dialog, and defaults
// to the ICAO message.
test('the flight type is the first field and defaults to the ICAO message', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    // A filled profile, so Continue reaches the review step instead of validating.
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
  });
  const kind = page.locator('#fpl-kind');
  await expect(kind).toBeVisible();                      // not buried under Advanced
  await expect(kind).toHaveValue('routes');
  // It is the first row of the form.
  const firstRowId = await page.evaluate(() => {
    const row = document.querySelector('.fpl-body .fpl-row');
    const f = row && row.querySelector('select, input');
    return f ? f.id : null;
  });
  expect(firstRowId).toBe('fpl-kind');
  // A cross-country flight skips the ICAO step entirely: Continue opens the form. This
  // route is all-published, so switch to one that is not before selecting it.
  await offNetworkRoute(page);
  await page.evaluate(() => {
    document.querySelector('.fpl-xc-modal, .modal-back.fpl-modal')._navaidClose();
    showFplDialog();
  });
  const kind2 = page.locator('#fpl-kind');
  await kind2.selectOption('crosscountry');
  await page.locator('#fpl-next').click();
  await expect(page.locator('.fpl-xc-modal')).toHaveCount(1);
  await expect(page.locator('#fpl-text')).toHaveCount(0);      // no ICAO message step
});

// A route made only of published points IS a routes flight (א'-11 §2.ח), so the
// cross-country option does not apply to it.
test('an all-published route cannot be filed as cross-country', async ({ page }) => {
  await boot(page);
  await route(page);                                  // LLHZ APOLN ARENA LLES
  await page.evaluate(() => { showFlightPlan(); document.getElementById('fpl-open').click(); });
  const crossDisabled = () => page.evaluate(() =>
    document.querySelector('#fpl-kind option[value="crosscountry"]').disabled);
  expect(await crossDisabled()).toBe(true);
  await expect(page.locator('#fpl-kind')).toHaveValue('routes');
  // With an off-network point in the route it becomes available again.
  await offNetworkRoute(page);
  await page.evaluate(() => {
    document.querySelector('.modal-back.fpl-modal')._navaidClose();
    showFplDialog();
  });
  expect(await crossDisabled()).toBe(false);
});

// One row for the aircraft type: a second "type code" field asked for what the dropdown
// already asked for. Picking Other turns the same row into a text box.
// The review step has one primary action; Copy and Back are secondary, or all three
// read as equally weighted next to each other.
test('the review step has a single primary button', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  await expect(page.locator('#fpl-mail')).toHaveClass(/fpl-primary/);
  await expect(page.locator('#fpl-copy')).toHaveClass(/modal-cancel/);
  await expect(page.locator('#fpl-back')).toHaveClass(/modal-cancel/);
});

// The Latin-letters note describes the pilot name and licence, so it sits under them --
// after the email row it read as being about the address.
test('the Latin-letters note sits under the fields it describes', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => { showFlightPlan(); document.getElementById('fpl-open').click(); });
  const order = await page.evaluate(() => {
    const ids = [];
    for (const el of document.querySelectorAll('.fpl-body > *')) {
      const f = el.querySelector('input, select');
      if (f && f.id) ids.push(f.id);
      else if (el.classList.contains('fpl-hint') && /Latin|לטיניות/.test(el.textContent)) ids.push('LATIN-HINT');
    }
    return ids;
  });
  expect(order.indexOf('LATIN-HINT')).toBeGreaterThan(order.indexOf('fpl-license'));
  expect(order.indexOf('LATIN-HINT')).toBeLessThan(order.indexOf('fpl-reply-to'));
  // ...and the mobile field is addressable like every other field.
  await expect(page.locator('#fpl-cell')).toHaveCount(1);
});

test('the aircraft type is one row, not a dropdown plus a duplicate code field', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    localStorage.removeItem('navaid.fpl.type');
    showFlightPlan();
    document.getElementById('fpl-open').click();
  });
  // Exactly one visible row mentions the type.
  const typeRows = await page.evaluate(() =>
    [...document.querySelectorAll('.fpl-body .fpl-row')]
      .filter(r => !r.hidden && /type/i.test((r.querySelector('span') || {}).textContent || ''))
      .length);
  expect(typeRows).toBe(2);        // "Flight type" and "Aircraft type", nothing else
  await expect(page.locator('#fpl-type-select')).toBeVisible();
  await expect(page.locator('#fpl-type')).toBeHidden();
  await expect(page.locator('#fpl-type-select')).toHaveValue('C172');

  // Other turns that row into a text box, in place.
  await page.selectOption('#fpl-type-select', '_other');
  await expect(page.locator('#fpl-type-select')).toBeHidden();
  await expect(page.locator('#fpl-type')).toBeVisible();
  await expect(page.locator('#fpl-type')).toHaveValue('');
  await page.fill('#fpl-type', 'AT3');
  // ...and the way back to the list is right there.
  await page.locator('#fpl-type-list').click();
  await expect(page.locator('#fpl-type-select')).toBeVisible();
  await expect(page.locator('#fpl-type')).toBeHidden();

  // A stored designator outside the list reopens straight into the text box.
  await page.evaluate(() => {
    localStorage.setItem('navaid.fpl.type', 'P28A');
    document.querySelector('.modal-back.fpl-modal')._navaidClose();
    showFplDialog();
  });
  await expect(page.locator('#fpl-type')).toBeVisible();
  await expect(page.locator('#fpl-type')).toHaveValue('P28A');
  await expect(page.locator('#fpl-type-select')).toBeHidden();
});

test('a cross-country plan never reaches a submit button', async ({ page }) => {
  await boot(page);
  await offNetworkRoute(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500', kind: 'crosscountry',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  await expect(page.locator('.fpl-xc-modal')).toHaveCount(1);  // the authority's form
  await expect(page.locator('#fpl-mail')).toHaveCount(0);      // never a way to mail one
  await expect(page.locator('#fpl-text')).toHaveCount(0);      // and no ICAO message at all
});

test('a routes plan does have the submit button', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500', kind: 'routes',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  await expect(page.locator('#fpl-mail')).toHaveCount(1);
});

// The cross-country form: prefilled with what NavAid knows, editable everywhere, and
// printable. The route table is the part that is pure drudgery on paper.
// Nothing is filed on the cross-country path, so the filing acknowledgements are not
// shown there and cannot stand between the pilot and the form.
test('opening the cross-country form needs no acknowledgements', async ({ page }) => {
  await boot(page);
  await offNetworkRoute(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500', kind: 'crosscountry',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  // Straight to the form -- no acknowledgements, because nothing is being filed here.
  await expect(page.locator('.fpl-xc-modal')).toHaveCount(1);
  await expect(page.locator('.fpl-ack')).toHaveCount(0);
});

// The form is stacked on the dialog, so cancelling it lands back on the dialog rather
// than dumping the pilot out to the flight-plan panel.
test('cancelling the cross-country form returns to the submit dialog', async ({ page }) => {
  await boot(page);
  await offNetworkRoute(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500', kind: 'crosscountry',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  await expect(page.locator('.fpl-xc-modal')).toHaveCount(1);
  await page.locator('.fpl-xc-modal .modal-cancel').click();
  await expect(page.locator('.fpl-xc-modal')).toHaveCount(0);
  await expect(page.locator('.modal-back.fpl-modal')).toHaveCount(1);   // the dialog, still there
  await expect(page.locator('#fpl-kind')).toBeVisible();                // back on its first step
  // Escape from the stacked form likewise leaves the dialog standing.
  await page.locator('#fpl-next').click();
  await page.locator('.xc-input').first().focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.fpl-xc-modal')).toHaveCount(0);
  await expect(page.locator('.modal-back.fpl-modal')).toHaveCount(1);
});

// <option> cannot hold markup, so Latin runs are isolated with Unicode FSI/PDI --
// without it "הודעת ICAO" renders reversed in the dropdown.
test('dropdown labels isolate their Latin runs in Hebrew', async ({ page }) => {
  await boot(page, '?lang=he&nogist');
  await route(page);
  await page.evaluate(() => { showFlightPlan(); document.getElementById('fpl-open').click(); });
  const labels = await page.locator('#fpl-kind option').allTextContents();
  expect(labels.length).toBe(2);
  for (const l of labels) {
    if (!/[A-Za-z]/.test(l)) continue;
    expect(l).toContain('\u2068');      // first-strong isolate
    expect(l).toContain('\u2069');      // pop directional isolate
  }
});

// Carried in from the dialog, the departure time is a value, not a box to retype.
test('a departure time from the dialog arrives locked on the sheet', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFplXcForm({ dateLocal: '2026-08-05', timeLocal: '09:20' });
  });
  await expect(page.locator('#xc-eobt')).toHaveValue('09:20');
  expect(await page.evaluate(() => document.getElementById('xc-eobt').readOnly)).toBe(true);
});

// A waypoint with no name of its own still gets the label the app shows it by, so no row
// on the form is nameless.
test('unnamed waypoints use their default label in the point column', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: 32.3, lng: 34.9, name: '' },          // dropped on the map, never named
      { lat: 32.4, lng: 35.0, name: '' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    draw();
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFplXcForm();
  });
  const sites = await page.evaluate(() =>
    [...document.querySelectorAll('.xc-t-route tbody td:nth-child(1) input')]
      .map(i => i.value).slice(0, 3));
  expect(sites[0]).toBeTruthy();
  expect(sites[1]).toBeTruthy();          // the default label, not an empty cell
  expect(sites[2]).toBeTruthy();
  expect(sites[1]).not.toBe(sites[2]);    // and they are distinct points
});

test('the cross-country form prefills from the route and the profile', async ({ page }) => {
  await boot(page);
  await route(page);                       // LLHZ APOLN ARENA LLES
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1234', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFplXcForm();
  });
  const sheet = page.locator('.fpl-xc-modal');
  await expect(sheet).toHaveCount(1);
  const vals = await page.evaluate(() => ({
    reg: document.getElementById('xc-reg').value,
    callsign: document.getElementById('xc-callsign').value,
    type: document.getElementById('xc-type').value,
    pic: document.getElementById('xc-pic').value,
    license: document.getElementById('xc-license').value,
    fuel: document.getElementById('xc-fuel').value,
    persons: document.getElementById('xc-persons').value,
    cell: document.getElementById('xc-cell').value,
    ias: document.getElementById('xc-ias').value,
    details: [...document.querySelectorAll('.xc-detail-input')]
      .map(e => e.value != null ? e.value : e.textContent).filter(Boolean),
    sites: [...document.querySelectorAll('.xc-t-route tbody tr td:nth-child(1) input')]
      .map(i => i.value).filter(Boolean),
    times: [...document.querySelectorAll('.xc-t-route tbody tr td:nth-child(3) input')]
      .map(i => i.value).filter(Boolean),
  }));
  expect(vals.reg).toBe('4XHLH');                // registration, with the prefix applied
  expect(vals.callsign).toBe('4XHLH');
  expect(vals.type).toBe('C172');
  expect(vals.pic).toBe('A PILOT');
  expect(vals.license).toBe('1234');
  expect(vals.fuel).toBe('0500');
  expect(vals.persons).toBe('2');
  expect(vals.cell).toBe('0500000000');
  // The speed comes from the Default speed setting under View/Set.
  expect(vals.ias).toBe('90');
  // The detail column carries position (and planned altitude when set) for every point
  // -- the part that is pure drudgery on paper. Times live in the form's time columns.
  expect(vals.details.length).toBe(4);
  expect(vals.details[0]).toMatch(/^\d{2}°\d{2}\.\d'[NS] \d{3}°\d{2}\.\d'[EW]/);
  expect(vals.sites.length).toBe(4);                 // the point column is filled
  // The waypoint's own name, once -- never the code and the name together, which printed
  // twice for a custom point whose name IS its code.
  expect(vals.sites[0]).toBeTruthy();
  for (const site of vals.sites) {
    const words = site.split(/\s+/).filter(Boolean);
    expect(new Set(words).size, site).toBe(words.length);
  }
  // The estimate per point lives in the detail column, as that column's header asks.
  // Opened without a departure time, so the running minutes stand in for a clock time.
  expect(vals.details[3]).toMatch(/\+\d+/);
  // The זמן columns are the actual takeoff and landing, so only the last row here.
  expect(vals.times.length).toBeLessThanOrEqual(1);
});

// The header's first row spans (point rowspan, זמן colspan 2, detail rowspan), so
// nth-child width rules sized the wrong cells and the table came out lopsided. Widths
// live on a <colgroup> now; this measures the result.
test('the route table columns line up', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => showFplXcForm());
  const cols = await page.evaluate(() => {
    const row = document.querySelector('.xc-t-route tbody tr');
    const w = el => Math.round(el.getBoundingClientRect().width);
    const tds = [...row.children].map(w);
    const heads = [...document.querySelectorAll('.xc-t-route thead tr:last-child th')].map(w);
    return { tds, heads, table: w(document.querySelector('.xc-t-route')) };
  });
  expect(cols.tds.length).toBe(4);
  // The two time columns are the same width as each other, and as their headers.
  expect(cols.tds[1]).toBe(cols.tds[2]);
  expect(cols.heads[0]).toBe(cols.tds[1]);
  expect(cols.heads[1]).toBe(cols.tds[2]);
  // Each fixed column is narrow, and the detail column takes the rest of the table.
  expect(cols.tds[1]).toBeLessThan(70);
  expect(cols.tds[0]).toBeLessThan(cols.tds[3]);
  expect(cols.tds[3]).toBeGreaterThan(cols.table / 2);

  // ...and a time cell is comfortably wider than the text it holds, header included.
  const fit = await page.evaluate(() => {
    const inp = document.querySelector('.xc-t-route tbody td:nth-child(2) input');
    const th = document.querySelector('.xc-t-route thead tr:last-child th');
    const width = (el, text) => {
      const cs = getComputedStyle(el);
      const c = document.createElement('canvas').getContext('2d');
      c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      return c.measureText(text).width;
    };
    return {
      cell: inp.closest('td').getBoundingClientRect().width,
      value: width(inp, '08:30'),
      header: width(th, th.textContent),
    };
  });
  expect(fit.cell - fit.value).toBeGreaterThan(12);
  expect(fit.cell - fit.header).toBeGreaterThan(12);
});

test('the sheet tells its two kinds of box apart, and nothing is blank-and-locked', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1234', cell: '0500000000', persons: '2', endurance: '0500' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFplXcForm();
  });
  // Values entered in the dialog are shown, not retyped here: read-only, muted, and out
  // of the tab order, with a tooltip saying where to change them.
  for (const id of ['xc-reg', 'xc-type', 'xc-pic', 'xc-license', 'xc-persons', 'xc-fuel',
    'xc-date', 'xc-ias', 'xc-cell']) {
    const box = await page.evaluate(i => {
      const el = document.getElementById(i);
      return el && { ro: el.readOnly, cls: el.className, tab: el.tabIndex, tip: !!el.title };
    }, id);
    expect(box, id).toMatchObject({ ro: true, tab: -1, tip: true });
    expect(box.cls, id).toContain('xc-ro');
  }
  // The form's own boxes are editable and marked as such.
  for (const id of ['xc-company', 'xc-purpose', 'xc-dest', 'xc-eta', 'xc-altField',
    'xc-caaEntry', 'xc-caaApproval', 'xc-aerialWork',
    'xc-rules', 'xc-approvals', 'xc-coord', 'xc-aisNotes']) {
    const box = await page.evaluate(i => {
      const el = document.getElementById(i);
      return el && { ro: !!el.readOnly, cls: el.className };
    }, id);
    expect(box, id).toMatchObject({ ro: false });
  }
  expect(await page.evaluate(() =>
    [...document.querySelectorAll('.xc-detail-input')].every(e => e.isContentEditable))).toBe(true);
  expect(await page.locator('.xc-sig-pad').count()).toBe(2);
  // A locked box must never be empty -- that would be a value the pilot can neither see
  // nor supply.
  const blankLocked = await page.evaluate(() =>
    [...document.querySelectorAll('.xc-sheet input')]
      .filter(el => el.readOnly && !el.value.trim())
      .map(el => el.id));
  expect(blankLocked).toEqual([]);
  // Opened without a departure time, so that box is the pilot's to fill.
  expect(await page.evaluate(() => document.getElementById('xc-eobt').readOnly)).toBe(false);
  // And the difference is stated, not left to be inferred from the styling. The note is
  // in the app's language, so it carries the app's direction inside this RTL sheet.
  await expect(page.locator('.xc-legend')).toBeVisible();
  expect(await page.evaluate(() => {
    const want = document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
    return document.querySelector('.xc-legend').dir === want;
  })).toBe(true);
});

// One rule for the shared details, applied before the sheet is drawn -- so it does not
// need testing twice.
test('the dialog refuses a cross-country plan with details missing', async ({ page }) => {
  await boot(page);
  await offNetworkRoute(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    localStorage.removeItem('navaid.fpl.license');      // the one blank field
    showFlightPlan();
    document.getElementById('fpl-open').click();
  });
  await expect(page.locator('#fpl-kind')).toHaveValue('crosscountry');
  await page.locator('#fpl-next').click();
  // No sheet, and the same message the ICAO plan gives.
  await expect(page.locator('.fpl-xc-modal')).toHaveCount(0);
  // Names the field that is blank, rather than "fill in the details".
  await expect(page.locator('.fpl-errs')).toContainText(/License number|מספר רישיון/);
  await expect(page.locator('#fpl-license')).toHaveClass(/fpl-input-missing/);
  // Filling it in the dialog is all it takes.
  await page.fill('#fpl-license', '4321');
  await page.locator('#fpl-next').click();
  await expect(page.locator('.fpl-xc-modal')).toHaveCount(1);
  await expect(page.locator('#xc-license')).toHaveValue('4321');
});

// The two plans are validated by the same code against the same list, so neither accepts
// what the other rejects.
test('both plans demand exactly the same details', async ({ page }) => {
  await boot(page);
  const seed = (extra) => page.evaluate(o => {
    for (const [k, v] of Object.entries(o)) {
      if (v === null) localStorage.removeItem('navaid.fpl.' + k);
      else localStorage.setItem('navaid.fpl.' + k, v);
    }
  }, extra);
  const full = { reg: 'HLH', type: 'C172', wake: 'L', equip: 'S', surv: 'C', pic: 'A PILOT',
    license: '1', cell: '0500000000', persons: '2', endurance: '0500',
    replyTo: 'pilot@example.com' };

  // Drop each field the pilot can actually leave blank; both plans must refuse it. (Type,
  // endurance and persons are dropdowns, so the dialog always supplies a value for them --
  // asserted below rather than pretended otherwise.)
  for (const field of ['reg', 'pic', 'license', 'cell', 'replyTo']) {
    await route(page);                                   // all-published: ICAO
    await seed({ ...full, [field]: null });
    await page.evaluate(() => {
      document.querySelectorAll('.modal-back').forEach(b => b._navaidClose ? b._navaidClose() : b.remove());
      showFplDialog();
    });
    await page.locator('#fpl-next').click();
    expect(await page.locator('#fpl-text').count(), 'ICAO accepted a missing ' + field).toBe(0);

    await offNetworkRoute(page);                         // off-network: the form
    await page.evaluate(() => {
      document.querySelectorAll('.modal-back').forEach(b => b._navaidClose ? b._navaidClose() : b.remove());
      showFplDialog();
    });
    await page.locator('#fpl-next').click();
    expect(await page.locator('.fpl-xc-modal').count(), 'form accepted a missing ' + field).toBe(0);
  }

  // The dropdown-backed details cannot be blank from the dialog at all.
  await seed({ ...full, type: null, endurance: null, persons: null });
  await route(page);
  await page.evaluate(() => {
    document.querySelectorAll('.modal-back').forEach(b => b._navaidClose ? b._navaidClose() : b.remove());
    showFplDialog();
  });
  for (const id of ['fpl-type-select', 'fpl-endurance', 'fpl-persons']) {
    expect(await page.evaluate(i => document.getElementById(i).value, id), id).toBeTruthy();
  }

  // With everything present, both go through.
  await seed(full);
  await route(page);
  await page.evaluate(() => {
    document.querySelectorAll('.modal-back').forEach(b => b._navaidClose ? b._navaidClose() : b.remove());
    showFplDialog();
  });
  await page.locator('#fpl-next').click();
  await expect(page.locator('#fpl-text')).toBeVisible();
  await offNetworkRoute(page);
  await page.evaluate(() => {
    document.querySelectorAll('.modal-back').forEach(b => b._navaidClose ? b._navaidClose() : b.remove());
    showFplDialog();
  });
  await page.locator('#fpl-next').click();
  await expect(page.locator('.fpl-xc-modal')).toHaveCount(1);
});

test('form-only fields live on the form, not in the dialog', async ({ page }) => {
  await boot(page);
  await offNetworkRoute(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
  });
  // Company, purpose, alternate field and IAS are boxes on the authority's form.
  for (const id of ['fpl-xc-company', 'fpl-xc-purpose', 'fpl-xc-altField', 'fpl-xc-ias']) {
    await expect(page.locator('#' + id)).toHaveCount(0);
  }
  await page.locator('#fpl-next').click();
  for (const id of ['xc-company', 'xc-purpose', 'xc-altField', 'xc-ias']) {
    await expect(page.locator('#' + id)).toBeVisible();
  }
  // Filled on the form, remembered for next time.
  await page.fill('#xc-company', 'Test Aviation');
  await page.evaluate(() => { window.print = () => {}; document.getElementById('xc-save').click(); });
  expect(await page.evaluate(() => localStorage.getItem('navaid.fpl.company'))).toBe('Test Aviation');
});

// Clear form wipes what the pilot typed here -- not the dialog's values, and not the
// route table the app generated.
// The IAS follows the Default speed setting; it is not a remembered copy that could
// shadow the setting later.
test('the form speed follows the Default speed setting', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    // A stale copy from an older build must not win.
    localStorage.setItem('navaid.fpl.ias', '77');
    showFplXcForm();
  });
  await expect(page.locator('#xc-ias')).toHaveValue('90');          // the shipped default
  // Locked: it is the Default speed setting, changed under View/Set rather than here.
  expect(await page.evaluate(() => document.getElementById('xc-ias').readOnly)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('navaid.fpl.ias'))).toBeNull();

  // Change the setting and the form follows it.
  await page.evaluate(() => {
    document.querySelector('.fpl-xc-modal')._navaidClose();
    setTune('defaultLegSpeedKt', 115);
    showFplXcForm();
  });
  await expect(page.locator('#xc-ias')).toHaveValue('115');
});

// A UI review on a phone found the form squeezed: seven values and six headers clipped
// into unreadable slivers at 375px. The form has a paper width -- it scrolls instead.
test('nothing on the form is clipped on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await boot(page);
  await offNetworkRoute(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'ISRAEL ISRAELI',
      license: '1234', cell: '0541234567', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFplXcForm({ dateLocal: '2026-08-05', timeLocal: '09:20' });
  });
  const fit = await page.evaluate(() => ({
    clippedValues: [...document.querySelectorAll('.xc-sheet input')]
      .filter(el => el.value && el.scrollWidth > el.clientWidth + 1)
      .map(el => el.id + '=' + el.value),
    clippedHeaders: [...document.querySelectorAll('.xc-t th')]
      .filter(th => th.scrollWidth > th.clientWidth + 1)
      .map(th => th.textContent.trim().slice(0, 18)),
    scrollRegions: document.querySelectorAll('.xc-scroll').length,
    pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
  }));
  expect(fit.clippedValues).toEqual([]);
  expect(fit.clippedHeaders).toEqual([]);
  expect(fit.scrollRegions).toBe(3);          // each table scrolls on its own
  expect(fit.pageScrollsSideways).toBe(false);   // the page itself does not
});

// Where a plan is filed is one decision, asked by both paths. The form's copy of it used
// to ignore an override entirely, so a pilot who set one did not get it honoured there.
test('the filing address is one decision for both paths', async ({ page }) => {
  await boot(page);
  await route(page);
  const answers = await page.evaluate(() => ({
    routesPublished: fplFilingAddress({ kind: 'routes' }, 'routes'),
    crossPublished: fplFilingAddress({ kind: 'crosscountry' }, 'crosscountry'),
    overrideRoutes: fplFilingAddress({ aisEmail: 'ops@example.com' }, 'routes'),
    overrideCross: fplFilingAddress({ aisEmail: 'ops@example.com' }, 'crosscountry'),
    junkFallsBack: fplFilingAddress({ aisEmail: 'not-an-email' }, 'crosscountry'),
    smugglingFallsBack: fplFilingAddress({ aisEmail: 'x@y.com?bcc=evil@z.com' }, 'routes'),
    publishedCheck: [fplIsPublishedAddress('ais@iaa.gov.il'),
      fplIsPublishedAddress('fpl@iaa.gov.il'), fplIsPublishedAddress('ops@example.com')],
  }));
  expect(answers.routesPublished).toBe('ais@iaa.gov.il');
  expect(answers.crossPublished).toBe('fpl@iaa.gov.il');
  // The override applies on BOTH paths, not just the ICAO one.
  expect(answers.overrideRoutes).toBe('ops@example.com');
  expect(answers.overrideCross).toBe('ops@example.com');
  // Junk or header-smuggling never becomes the recipient.
  expect(answers.junkFallsBack).toBe('fpl@iaa.gov.il');
  expect(answers.smugglingFallsBack).toBe('ais@iaa.gov.il');
  expect(answers.publishedCheck).toEqual([true, true, false]);
});

test('clear form wipes only what was typed on the sheet', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1234', cell: '0500000000', persons: '2', endurance: '0500' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFplXcForm({ dateLocal: '2026-08-05', timeLocal: '09:20' });
    window.confirm = () => true;
  });
  await page.fill('#xc-company', 'Test Aviation');
  await page.fill('#xc-purpose', 'Training');
  await page.fill('#xc-coord', 'Called the tower');
  const detailBefore = await page.locator('.xc-detail-input').first().textContent();

  await page.locator('#xc-clear').click();

  // Gone: what was typed here.
  await expect(page.locator('#xc-company')).toHaveValue('');
  await expect(page.locator('#xc-purpose')).toHaveValue('');
  await expect(page.locator('#xc-coord')).toHaveValue('');
  // Kept: what the app supplied, the dialog's values, and the generated route.
  await expect(page.locator('#xc-rules')).toHaveValue('VFR');
  await expect(page.locator('#xc-pic')).toHaveValue('A PILOT');
  await expect(page.locator('#xc-license')).toHaveValue('1234');
  // The mobile is one of those dialog values, even though it sits on a free-text line
  // among boxes that clear -- it is the number the dialog already required.
  await expect(page.locator('#xc-cell')).toHaveValue('0500000000');
  expect(await page.evaluate(() => document.getElementById('xc-cell').readOnly)).toBe(true);
  expect(await page.locator('.xc-detail-input').first().textContent()).toBe(detailBefore);
});

test('the signature pads look like somewhere to draw, but print as a rule', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => showFplXcForm());
  // The pad is white on a white sheet, so a bottom rule alone left an invisible box: it
  // has to be outlined all round ON SCREEN, in either theme.
  for (const theme of ['theme-light', 'theme-dark']) {
    await page.evaluate(t => {
      document.body.classList.remove('theme-light', 'theme-dark');
      document.body.classList.add(t);
    }, theme);
    const box = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.xc-sig-pad'));
      return { top: cs.borderTopStyle, side: cs.borderInlineStartStyle,
        bottom: cs.borderBottomStyle, colour: cs.borderTopColor,
        bg: cs.backgroundColor, width: cs.borderTopWidth };
    });
    expect(box, theme).toMatchObject({ top: 'dashed', side: 'dashed', bottom: 'solid' });
    expect(parseFloat(box.width), theme).toBeGreaterThan(0);
    // Outlined, and against the pad's own white -- not the same colour as it.
    expect(box.bg, theme).toBe('rgb(255, 255, 255)');
    expect(box.colour, theme).not.toBe('rgb(255, 255, 255)');
  }
  // On paper the signature sits on the form's rule, with no box around it.
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.body.classList.add('printing-xc'));
  const printed = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.xc-sig-pad'));
    return { top: cs.borderTopWidth, side: cs.borderInlineStartWidth,
      bottom: cs.borderBottomStyle, colour: cs.borderBottomColor };
  });
  expect(printed).toMatchObject({ top: '0px', side: '0px', bottom: 'solid',
    colour: 'rgb(17, 17, 17)' });
  await page.emulateMedia({ media: null });
});

test('saving the form prints only the sheet', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => showFplXcForm());
  const printing = await page.evaluate(() => new Promise(resolve => {
    window.print = () => resolve(document.body.classList.contains('printing-xc'));
    document.getElementById('xc-save').click();
  }));
  expect(printing).toBe(true);
  // ...and the screen is not left in print state afterwards.
  await expect.poll(() => page.evaluate(() =>
    document.body.classList.contains('printing-xc'))).toBe(false);
});

test('Escape closes the FPL dialog and leaves the flight plan open', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => { showFlightPlan(); document.getElementById('fpl-open').click(); });
  await expect(page.locator('.modal-back.fpl-modal')).toHaveCount(1);
  await page.locator('#fpl-pic').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-back.fpl-modal')).toHaveCount(0);
  // The panel the dialog was opened from must survive -- it holds the plan.
  await expect(page.locator('.modal-back.flight-plan')).toHaveCount(1);
  expect(await page.evaluate(() => window.fpOpen)).toBe(true);
  // A second Escape, with only the panel left, closes the panel.
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-back.flight-plan')).toHaveCount(0);
});

test('a Hebrew pilot name is refused — the message is ASCII', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page, { ...PROFILE, pic: 'מרקו סופינו' });
  expect(res.errs).toContain('errFplLatinOnly');
  expect(res.text).toBeUndefined();
  const ok = await build(page, { ...PROFILE, pic: 'MARCO SUPINO' });
  expect(ok.errs).toBeUndefined();
});

test('the mail note carries no address, so RTL cannot garble it', async ({ page }) => {
  for (const lang of ['en', 'he']) {
    await boot(page, '?lang=' + lang + '&nogist');
    const note = await page.evaluate(() => S.fplMailNote);
    expect(typeof note).toBe('string');
    expect(note).not.toContain('@');
  }
});

// An early build let the pilot's own address land in the filing-address field, where it
// then outranked the published one for good. It must not survive.
test('a stale filing address equal to the old pilot-email field is dropped', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('navaid.fpl.pilotEmail', 'pilot@example.com');
      localStorage.setItem('navaid.fpl.aisEmail', 'pilot@example.com');
    } catch (e) {}
  });
  await boot(page);
  await route(page);
  const p = await page.evaluate(() => fplProfileRead());
  expect(p.aisEmail).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('navaid.fpl.aisEmail'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('navaid.fpl.pilotEmail'))).toBeNull();
  expect((await build(page, { ...PROFILE, aisEmail: p.aisEmail })).to).toBe('ais@iaa.gov.il');
});

test('the published address is not persisted as a pilot override', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => fplProfileWrite({ aisEmail: 'ais@iaa.gov.il', pic: 'X' }));
  expect(await page.evaluate(() => localStorage.getItem('navaid.fpl.aisEmail'))).toBe('');
  // A real override is kept.
  await page.evaluate(() => fplProfileWrite({ aisEmail: 'ops@example.com', pic: 'X' }));
  expect(await page.evaluate(() => localStorage.getItem('navaid.fpl.aisEmail'))).toBe('ops@example.com');
});

test('the mail link keeps the recipient readable but cannot carry extra headers', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page);
  expect(res.to).toBe('ais@iaa.gov.il');
  const encoded = await page.evaluate(a => fplMailtoAddress(a), res.to);
  expect(encoded).toBe('ais@iaa.gov.il');          // @ stays literal (clients mangle %40)
  // A crafted address cannot smuggle mailto headers through the URL.
  const nasty = await page.evaluate(() => fplMailtoAddress('x@y.com?bcc=evil@z.com&subject=hi'));
  expect(nasty).not.toContain('?');
  expect(nasty).not.toContain('&');
});

// On a borrowed machine the sending account is not the pilot's, so the approval would
// land in someone else's inbox. mailto's reply-to is ignored by most clients, so the
// address is CC'd as well -- that is the part that actually works.
test('a reply-to address is carried as cc and reply-to', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page);
  const url = await page.evaluate(([r, o]) => fplMailtoUrl(r, o),
    [res, { reg: 'HLH', replyTo: 'pilot@example.com' }]);
  expect(url.startsWith('mailto:ais@iaa.gov.il?')).toBe(true);
  expect(url).toContain('cc=pilot@example.com');
  expect(url).toContain('reply-to=pilot@example.com');
  expect(url).toContain('subject=FPL%204XHLH%20');
  // Without one, neither parameter appears at all.
  const plain = await page.evaluate(([r, o]) => fplMailtoUrl(r, o), [res, { reg: 'HLH' }]);
  expect(plain).not.toContain('cc=');
  expect(plain).not.toContain('reply-to=');
  // A junk or header-smuggling value is dropped rather than passed through.
  for (const bad of ['not-an-email', 'x@y.com?bcc=evil@z.com']) {
    const u = await page.evaluate(([r, o]) => fplMailtoUrl(r, o), [res, { reg: 'HLH', replyTo: bad }]);
    expect(u).not.toContain('cc=');
    expect(u).not.toContain('bcc');
  }
});

// Required, and in the open rather than behind Advanced: the approval arrives by mail.
test('the pilot email is required to file, and is not hidden under Advanced', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    localStorage.removeItem('navaid.fpl.replyTo');
    showFlightPlan();
    document.getElementById('fpl-open').click();
  });
  // Visible without opening Advanced.
  await expect(page.locator('#fpl-reply-to')).toBeVisible();
  expect(await page.evaluate(() =>
    !!document.getElementById('fpl-reply-to').closest('.fpl-advanced'))).toBe(false);
  // Filing without it is refused, naming the field.
  await page.locator('#fpl-next').click();
  await expect(page.locator('#fpl-text')).toHaveCount(0);
  await expect(page.locator('.fpl-errs')).toContainText(/email|דואל/);
  // A junk address is refused too, a good one gets through.
  await page.fill('#fpl-reply-to', 'nope');
  await page.locator('#fpl-next').click();
  await expect(page.locator('#fpl-text')).toHaveCount(0);
  await page.fill('#fpl-reply-to', 'pilot@example.com');
  await page.locator('#fpl-next').click();
  await expect(page.locator('#fpl-text')).toBeVisible();
});

test('the reply-to field persists and syncs', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    showFlightPlan();
    document.getElementById('fpl-open').click();
  });
  await page.fill('#fpl-reply-to', 'pilot@example.com');
  await page.locator('#fpl-next').click();
  expect(await page.evaluate(() => localStorage.getItem('navaid.fpl.replyTo')))
    .toBe('pilot@example.com');
});

// An override is device-local now, but it still redirects the plan on this device. The
// note deliberately carries no address, so without this the redirect would be silent.
test('a recipient that is not the published address is shown before submitting', async ({ page }) => {
  await boot(page);
  await route(page);
  const open = () => page.evaluate(() => {
    const dlg = document.querySelector('.modal-back.fpl-modal');
    if (dlg && dlg._navaidClose) dlg._navaidClose();
    if (window.fpOpen) closeFlightPlan();
    showFlightPlan();
    document.getElementById('fpl-open').click();
    document.getElementById('fpl-next').click();
  });
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'HLH', type: 'C172', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
  });

  // The published address: nothing to shout about.
  await open();
  await expect(page.locator('#fpl-custom-recipient')).toHaveCount(0);

  // An override: named, so it cannot redirect the plan unnoticed.
  await page.evaluate(() => localStorage.setItem('navaid.fpl.aisEmail', 'ops@example.com'));
  await open();
  await expect(page.locator('#fpl-custom-recipient')).toBeVisible();
  await expect(page.locator('.fpl-custom-addr')).toHaveText('ops@example.com');
});

test('an invalid filing address is refused', async ({ page }) => {
  await boot(page);
  await route(page);
  for (const bad of ['x@y.com?bcc=evil@z.com', 'not-an-email', 'a b@c.com', 'a@b']) {
    const res = await build(page, { ...PROFILE, aisEmail: bad });
    expect(res.errs, bad).toContain('errFplBadAddress');
  }
  expect((await build(page, { ...PROFILE, aisEmail: 'ops@example.com' })).errs).toBeUndefined();
});

// AIS needs a way to reach the pilot about the plan: the AIP's own sample carries CELL
// and the מרחב form has a "mobile for queries" box, so it is required.
test('a missing mobile is refused, and the RMK always carries it', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page, { ...PROFILE, cell: '' });
  expect(res.errs).toContain('errFplProfile:cell');
  expect(res.text).toBeUndefined();
  expect((await build(page)).text).toContain('CELL 0541234567');
});

test('missing pilot or aircraft details are refused, one message per field', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page, { ...PROFILE, pic: '', license: '' });
  expect(res.errs).toContain('errFplProfile:pic');
  expect(res.errs).toContain('errFplProfile:license');
  expect(res.text).toBeUndefined();
});

test('an empty route is refused before anything else', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.waypoints = []; state.legs = []; draw(); });
  expect((await build(page)).errs).toEqual(['errFplNeedRoute']);
});

test('every error and warning code has text in both languages', async ({ page }) => {
  for (const lang of ['en', 'he']) {
    await boot(page, '?lang=' + lang + '&nogist');
    const missing = await page.evaluate(() => {
      const codes = ['errFplNeedRoute', 'errFplDepUnnamed', 'errFplDestUnnamed',
        'errFplBadPoints', 'errFplNoPoints', 'errFplNoSpeed', 'errFplNoEet', 'errFplEobt',
        'errFplEndurance', 'errFplProfile', 'errFplLatinOnly', 'errFplBadAddress', 'warnFplLead', 'warnFplEarly',
        'warnFplMixedSpeed', 'warnFplCrossForm', 'warnFplDepNotAerodrome',
        'warnFplDestNotAerodrome', 'fplAckRequired'];
      return codes.filter(c => !S[c]);
    });
    expect(missing, 'missing in ' + lang).toEqual([]);
  }
});
