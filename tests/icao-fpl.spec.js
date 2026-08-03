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

const PROFILE = {
  reg: 'HLH', type: 'ULAC', wake: 'L', equip: 'S', surv: 'C',
  pic: 'Israel Israeli', license: '1234', cell: '0541234567',
  endurance: '0400', persons: '2', kind: 'routes',
};

// `now` cannot cross into the page as a Date, so it travels as epoch ms.
const build = (page, profile, opts) => {
  const o = { ...(opts || { dateLocal: '2022-09-29', timeLocal: '14:00' }) };
  if (o.now instanceof Date) { o.nowMs = o.now.getTime(); delete o.now; }
  return page.evaluate(([p, opt]) => {
    if (opt.nowMs) opt.now = new Date(opt.nowMs);
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
  expect((await build(page, { ...PROFILE, reg: 'CWH' })).text).toContain('(FPL-4XCWH-VG');
  expect((await build(page, { ...PROFILE, reg: '4X-CWH' })).text).toContain('(FPL-4XCWH-VG');
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
    dateLocal: '2026-08-20', timeLocal: '10:00',
    now: new Date(2026, 7, 19, 9, 0, 0),
  });
  expect(res.warns).toContain('warnFplEarly');
  expect(res.text).toBeTruthy();                 // still only a warning
});

test('the evening-before window opens at 18:00 for a morning flight', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page, PROFILE, {
    dateLocal: '2026-08-20', timeLocal: '10:00',
    now: new Date(2026, 7, 19, 18, 5, 0),
  });
  expect(res.warns).not.toContain('warnFplEarly');
});

test('a departure after 17:00 must wait for the day of the flight', async ({ page }) => {
  await boot(page);
  await route(page);
  const args = { dateLocal: '2026-08-20', timeLocal: '19:00' };
  // 18:30 the evening before is early enough for a morning flight, but not for this one.
  const early = await build(page, PROFILE, { ...args, now: new Date(2026, 7, 19, 18, 30, 0) });
  expect(early.warns).toContain('warnFplEarly');
  const sameDay = await build(page, PROFILE, { ...args, now: new Date(2026, 7, 20, 8, 0, 0) });
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
  // Flight type and the address live under Advanced; open it the way a pilot would.
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

// A disabled button explains nothing: submitting with the boxes unticked has to say so.
test('submitting without the acknowledgements says what is missing', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => {
    for (const [k, v] of Object.entries({ reg: 'CWH', type: 'C172', pic: 'A PILOT',
      license: '1', persons: '2', endurance: '0500', kind: 'routes' })) {
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
  await expect(page.locator('.fpl-ack-missing')).toHaveCount(2);
  // Ticking one leaves the other marked; ticking both clears the message.
  await page.locator('#fpl-ack-aip').check();
  await expect(page.locator('.fpl-ack-missing')).toHaveCount(1);
  await page.locator('#fpl-ack-wx').check();
  await expect(page.locator('#fpl-ack-required')).toBeHidden();
  await expect(page.locator('.fpl-ack-missing')).toHaveCount(0);
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

// Hebrew names + a Latin ICAO code + an arrow in one line reordered under bidi: the
// code jumped to the wrong end and the sequence read backwards.
// The pilot should know the likely outcome, not just the mechanism.
test('the non-airfield warnings say it will probably be declined', async ({ page }) => {
  for (const lang of ['en', 'he']) {
    await boot(page, '?lang=' + lang + '&nogist');
    const texts = await page.evaluate(() =>
      [S.warnFplDepNotAerodrome, S.warnFplDestNotAerodrome]);
    for (const t of texts) {
      expect(t).toBeTruthy();
      expect(t).toMatch(lang === 'en' ? /probably be declined/i : /יידחה/);
    }
  }
});

test('the route summary is bidi-isolated per waypoint', async ({ page }) => {
  for (const [lang, arrow] of [['en', '→'], ['he', '←']]) {
    await boot(page, '?lang=' + lang + '&nogist');
    await route(page);
    await page.evaluate(() => { showFlightPlan(); document.getElementById('fpl-open').click(); });
    const summary = page.locator('#fpl-route-summary');
    // One <bdi> per waypoint, so no name can drag its neighbours around.
    await expect(summary.locator('bdi')).toHaveCount(4);
    expect(await summary.locator('bdi').first().textContent()).toBe('LLHZ');
    // The arrow points the way the UI reads.
    const seps = await summary.locator('.fpl-route-sep').allTextContents();
    expect(seps.length).toBe(3);
    for (const sep of seps) expect(sep.trim()).toBe(arrow);
  }
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

test('the mail link keeps the recipient literal', async ({ page }) => {
  await boot(page);
  await route(page);
  const res = await build(page);
  // Percent-encoding the @ mangles the recipient in some clients.
  expect(res.to).toBe('ais@iaa.gov.il');
  expect(res.to).not.toContain('%40');
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
        'errFplEndurance', 'errFplProfile', 'errFplLatinOnly', 'warnFplLead', 'warnFplEarly',
        'warnFplMixedSpeed', 'warnFplCrossForm', 'warnFplDepNotAerodrome',
        'warnFplDestNotAerodrome', 'fplAckRequired'];
      return codes.filter(c => !S[c]);
    });
    expect(missing, 'missing in ' + lang).toEqual([]);
  }
});
