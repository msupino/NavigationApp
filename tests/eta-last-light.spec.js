// @ts-check
// #667: a departure time (ETD) on the flight plan, a clock-time ETA per waypoint, and the
// last-light check -- sunset and the end of civil twilight at the destination, with an
// arrival after it flagged. The ETD is the one the filing dialog uses too.
const { test, expect } = require('./_setup');
const { pairLLHZ_LLHA } = require('./_airfieldArp');

// ETD is typed in local time, so the zone is pinned (Israel: UTC+3 in June, +2 in December).
test.use({ timezoneId: 'Asia/Jerusalem' });

const TWO_WP = pairLLHZ_LLHA();

async function boot(page, etd) {
  await page.addInitScript((e) => {
    try {
      if (sessionStorage.getItem('__eta_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        if (e) localStorage.setItem('navaid.etd', JSON.stringify(e));
        sessionStorage.setItem('__eta_init', '1');
      }
    } catch (err) { /* storage blocked */ }
  }, etd || null);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof syncLegs === 'function'
    && typeof lastLightAt === 'function');
  await page.evaluate(wps => {
    state.waypoints = wps.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    draw();
  }, TWO_WP);
}

async function openFlightPlan(page) {
  await page.evaluate(() => showFlightPlan());
  await page.locator('.modal-back.flight-plan').waitFor({ timeout: 5000 });
  // Every column on, whatever the default for this width.
  await page.evaluate(() => {
    const all = document.querySelector('.fp-columns-all');
    if (all) all.click();
  });
}

async function openWhen(page) {
  const d = page.locator('details.fp-when');
  if (!(await d.evaluate(el => el.open))) await d.locator('summary').click();
}

async function setEtd(page, date, time) {
  await openWhen(page);
  await page.locator('#fp-etd-date').fill(date);
  await page.locator('#fp-etd-date').dispatchEvent('change');
  const [h, m] = time.split(':');
  await page.locator('details.fp-when .qtime-h').selectOption(h);
  await page.locator('details.fp-when .qtime-m').selectOption(m);
}

const etaCell = page => page.locator('.flight-table tbody tr').first().locator('td.fp-col-eta');
const cumTimeCell = page => page.locator('.flight-table tbody tr').first().locator('td.fp-col-cumTime');

test('last light is civil twilight after sunset, both from the sun, in UTC', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // Haifa, the longest day and the shortest.
    const june = lastLightAt(32.81, 35.04, '2026-06-21');
    const dec = lastLightAt(32.81, 35.04, '2026-12-21');
    const mins = d => d.getUTCHours() * 60 + d.getUTCMinutes();
    return {
      juneSunset: mins(june.sunset), juneGap: (june.lastLight - june.sunset) / 60000,
      decSunset: mins(dec.sunset), decGap: (dec.lastLight - dec.sunset) / 60000,
    };
  });
  // Published: 19:51 IDT (16:51Z) and 16:41 IST (14:41Z). NOAA is good to a couple of minutes.
  expect(Math.abs(r.juneSunset - (16 * 60 + 51))).toBeLessThanOrEqual(3);
  expect(Math.abs(r.decSunset - (14 * 60 + 41))).toBeLessThanOrEqual(3);
  // Civil twilight at this latitude: about 28 minutes in June, 25 in December.
  expect(r.juneGap).toBeGreaterThan(20);
  expect(r.juneGap).toBeLessThan(35);
  expect(r.decGap).toBeGreaterThan(20);
  expect(r.decGap).toBeLessThan(35);
});

test('no departure: the ETA column says so and last light is still shown', async ({ page }) => {
  await boot(page);
  await openFlightPlan(page);
  await expect(etaCell(page)).toHaveText('--');
  await expect(page.locator('#fp-last-light')).toContainText('Last light at');
  await expect(page.locator('#fp-last-light')).toContainText('sunset');
  // Closed, the popover's row still says the two things that matter.
  await expect(page.locator('details.fp-when summary')).toHaveText('ETD --:--');
  await expect(page.locator('#fp-last-light-short')).toHaveText(/^Last light \d\d:\d\d$/);
});

test('ETA is the departure plus the cumulative time, and is remembered', async ({ page }) => {
  await boot(page);
  await openFlightPlan(page);
  await setEtd(page, '2026-06-21', '10:00');
  const cum = await cumTimeCell(page).textContent();
  // m:ss or h:mm:ss -> minutes.
  const parts = String(cum).split(':').map(Number);
  const cumMin = parts.length === 3 ? parts[0] * 60 + parts[1] + parts[2] / 60 : parts[0] + parts[1] / 60;
  const eta = String(await etaCell(page).textContent());
  expect(eta).toMatch(/^10:\d\d$/);
  expect(Math.abs(Number(eta.slice(3)) - cumMin)).toBeLessThanOrEqual(1);
  // The departure's UTC is shown beside it (IDT is UTC+3).
  await expect(page.locator('.fp-etd-utc')).toHaveText('07:00Z');
  await expect(page.locator('#fp-last-light')).toContainText('Arrival ' + eta);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.etd'))))
    .toEqual({ date: '2026-06-21', time: '10:00' });
  // Reopened, the departure is still there.
  await page.evaluate(() => closeFlightPlan());
  await openFlightPlan(page);
  await expect(page.locator('#fp-etd-time')).toHaveValue('10:00');
  await expect(etaCell(page)).toHaveText(eta);
});

test('an arrival after last light is flagged, one before it is not', async ({ page }) => {
  await boot(page);
  // Haifa (open until 22:00 on a Sunday) to a plain point with no published hours: night alone.
  await page.evaluate(() => {
    const ha = airfields.find(a => a.name === 'LLHA');
    state.waypoints = [{ lat: ha.lat, lng: ha.lng, name: 'LLHA' }, { lat: ha.lat - 0.25, lng: ha.lng - 0.05, name: 'POINT' }];
    syncLegs(); draw();
  });
  await openFlightPlan(page);
  await setEtd(page, '2026-06-21', '10:00');
  await expect(etaCell(page)).not.toHaveClass(/fp-eta-night/);
  await expect(page.locator('#fp-dest-closed')).not.toHaveClass(/fp-finding-night/);
  // Last light there that evening is about 20:20 local.
  await setEtd(page, '2026-06-21', '20:30');
  await expect(etaCell(page)).toHaveClass(/fp-eta-night/);
  await expect(etaCell(page)).toHaveAttribute('title', /After last light.*night/);
  // Said once, in the findings line beside the departure; the popover gives the times.
  await expect(page.locator('#fp-dest-closed')).toHaveClass(/fp-finding-night/);
  await expect(page.locator('#fp-dest-closed')).toContainText('after last light');
  await expect(page.locator('#fp-last-light')).not.toContainText('after last light');
  await expect(page.locator('.flight-table tfoot td.fp-col-eta')).not.toHaveClass(/fp-eta-closed/);
  await expect(page.locator('details.fp-when summary')).toHaveText('ETD 20:30');
});

test('UTC toggle writes every clock with a Z', async ({ page }) => {
  await boot(page);
  await openFlightPlan(page);
  await setEtd(page, '2026-06-21', '10:00');
  await openWhen(page);
  await page.locator('#fp-eta-zulu').check();
  await expect(etaCell(page)).toHaveText(/^07:\d\dZ$/);
  await expect(page.locator('#fp-last-light')).toContainText(/1[67]:\d\dZ/);
  expect(await page.evaluate(() => localStorage.getItem('navaid.etaZulu'))).toBe('1');
});

test('the filing dialog shows the planned departure, read-only, and says where to change it', async ({ page }) => {
  const tomorrow = new Date(Date.now() + 36 * 3600000);
  const iso = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
    String(tomorrow.getDate()).padStart(2, '0');
  await boot(page, { date: iso, time: '09:45' });
  await page.evaluate(() => showFplDialog());
  await expect(page.locator('#fpl-time')).toHaveValue('09:45');
  await expect(page.locator('#fpl-date')).toHaveValue(iso);
  await expect(page.locator('#fpl-date')).toBeDisabled();
  await expect(page.locator('.fpl-time-box .qtime-h')).toBeDisabled();
  await expect(page.locator('.fpl-time-box .qtime-m')).toBeDisabled();
  await expect(page.locator('#fpl-etd-from-plan')).toContainText('change it there');
  await expect(page.locator('.fpl-time-box')).toHaveAttribute('aria-describedby', /fpl-etd-from-plan/);
});

// The plan's Submit button: the filing dialog opens only with a departure still ahead.
test('Submit with no departure set opens the departure, not the filing dialog', async ({ page }) => {
  await boot(page, null);
  await openFlightPlan(page);
  await page.locator('#fpl-open').click();
  await expect(page.locator('#fpl-date')).toHaveCount(0);           // no filing dialog
  await expect(page.locator('details.fp-when')).toHaveJSProperty('open', true);
  await expect(page.locator('details.fp-when .qtime-h')).toBeFocused();
  await expect(page.locator('body')).toContainText('Set the departure time first');
});

test('Submit with a passed departure asks: set a new time (the default) ...', async ({ page }) => {
  await boot(page, { date: '2020-01-01', time: '09:00' });
  await openFlightPlan(page);
  await page.locator('#fpl-open').click();
  const ask = page.locator('.fpl-etd-ask');
  await expect(ask).toContainText('has passed');
  await expect(ask.locator('.fpl-etd-set')).toBeFocused();
  await ask.locator('.fpl-etd-set').click();
  await expect(page.locator('#fpl-date')).toHaveCount(0);
  await expect(page.locator('details.fp-when')).toHaveJSProperty('open', true);
  await expect(page.locator('details.fp-when .qtime-h')).toBeFocused();
});

test('... or open anyway: the time as set, and Continue is not refused for it', async ({ page }) => {
  await boot(page, { date: '2020-01-01', time: '09:00' });
  await openFlightPlan(page);
  await page.locator('#fpl-open').click();
  await page.locator('.fpl-etd-ask .fpl-etd-force').click();
  await expect(page.locator('#fpl-time')).toHaveValue('09:00');
  await expect(page.locator('#fpl-date')).toHaveValue('2020-01-01');
  await expect(page.locator('#fpl-etd-from-plan')).toContainText('sent as you asked');
  await expect(page.locator('#fpl-time-past')).toBeHidden();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.fpl-errs')).not.toContainText('already passed');
});

test('the "already passed" refusal has a checkbox to send it anyway', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => showFplDialog());                          // no plan departure: editable
  await page.locator('#fpl-date').fill('2020-01-01');
  await page.locator('#fpl-date').dispatchEvent('change');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.fpl-errs')).toContainText('already passed');
  await page.locator('#fpl-allow-past').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.fpl-errs')).not.toContainText('already passed');
});

test('Submit with a departure still ahead opens the filing dialog with it', async ({ page }) => {
  const tomorrow = new Date(Date.now() + 36 * 3600000);
  const iso = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
    String(tomorrow.getDate()).padStart(2, '0');
  await boot(page, { date: iso, time: '11:30' });
  await openFlightPlan(page);
  await page.locator('#fpl-open').click();
  await expect(page.locator('#fpl-time')).toHaveValue('11:30');
});

test('a departure in the past is not offered for filing, and the dialog says why', async ({ page }) => {
  await boot(page, { date: '2020-01-01', time: '09:00' });
  await page.evaluate(() => showFplDialog());
  await expect(page.locator('#fpl-date')).not.toHaveValue('2020-01-01');
  const note = page.locator('#fpl-etd-passed');
  await expect(note).toContainText('01/01 09:00');
  await expect(note).toContainText('has passed');
  await expect(page.locator('.fpl-time-box')).toHaveAttribute('aria-describedby', 'fpl-etd-passed');
  // Choosing a time here answers it.
  await page.locator('#fpl-time').locator('..').locator('.qtime-m').selectOption('45');
  await expect(note).toHaveCount(0);
});

test('a departure still ahead is the one offered, even inside the filing hour', async ({ page }) => {
  await boot(page);
  // 40 minutes ahead, in the page's own (Israel) time, rounded up to the quarter.
  const etd = await page.evaluate(() => {
    const soon = new Date(Date.now() + 40 * 60000);
    const q = Math.ceil((soon.getHours() * 60 + soon.getMinutes()) / 15) * 15;
    if (q >= 24 * 60) return null;
    const p2 = n => String(n).padStart(2, '0');
    const e = { date: soon.getFullYear() + '-' + p2(soon.getMonth() + 1) + '-' + p2(soon.getDate()), time: p2(Math.floor(q / 60)) + ':' + p2(q % 60) };
    localStorage.setItem('navaid.etd', JSON.stringify(e));
    return e;
  });
  test.skip(!etd, 'too close to midnight for a same-day quarter');
  await page.evaluate(() => showFplDialog());
  await expect(page.locator('#fpl-time')).toHaveValue(etd.time);
  await expect(page.locator('#fpl-etd-passed')).toHaveCount(0);
});

test('Hebrew: last light reads with its times isolated', async ({ page }) => {
  await boot(page);
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof syncLegs === 'function');
  await page.evaluate(wps => {
    state.waypoints = wps.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    draw();
  }, TWO_WP);
  await openFlightPlan(page);
  await setEtd(page, '2026-06-21', '10:00');
  const text = String(await page.locator('#fp-last-light').textContent());
  expect(text).toContain('אור אחרון');
  expect(text).toMatch(/\u2066\d\d:\d\d\u2069/);
});

test('departure times are quarter hours: the minute list is 00/15/30/45, an odd stored time snaps', async ({ page }) => {
  await boot(page, { date: '2026-06-21', time: '10:08' });
  expect(await page.evaluate(() => [etdQuarter('10:07'), etdQuarter('10:08'), etdQuarter('23:53'), etdQuarter('00:00')]))
    .toEqual(['10:00', '10:15', '23:45', '00:00']);
  await openFlightPlan(page);
  await openWhen(page);
  expect(await page.locator('details.fp-when .qtime-m option').allTextContents()).toEqual(['--', '00', '15', '30', '45']);
  await expect(page.locator('#fp-etd-time')).toHaveValue('10:15');
  await setEtd(page, '2026-06-21', '10:45');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.etd')).time)).toBe('10:45');
});

test('with Times in UTC on, the departure is shown and typed in UTC', async ({ page }) => {
  await boot(page);
  await openFlightPlan(page);
  await setEtd(page, '2026-06-21', '10:00');           // local, IDT = UTC+3
  await page.locator('#fp-eta-zulu').check();
  await expect(page.locator('#fp-etd-time')).toHaveValue('07:00');
  await expect(page.locator('.fp-etd-utc')).toHaveText('10:00 local');
  // Typed in UTC, stored local.
  await page.locator('details.fp-when .qtime-h').selectOption('22');
  await page.locator('details.fp-when .qtime-m').selectOption('15');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.etd'))))
    .toEqual({ date: '2026-06-22', time: '01:15' });   // 22:15Z is 01:15 the next day here
  await expect(page.locator('#fp-etd-date')).toHaveValue('2026-06-21');
  // Off again: the local clock.
  await page.locator('#fp-eta-zulu').uncheck();
  await expect(page.locator('#fp-etd-time')).toHaveValue('01:15');
  await expect(page.locator('#fp-etd-date')).toHaveValue('2026-06-22');
});

// In flight: one warning when the planned arrival is after last light at the destination, or
// within the margin of it. Planned speed, like every in-flight alert.
async function flyAt(page, localIso, nmOut) {
  return page.evaluate(([iso, out]) => {
    window.__navaidNoDayAlerts = false;     // this spec is about them, at times it sets
    window.__alerts = [];
    window.gpsSendWatchAlert = (title, body, speech) => { window.__alerts.push({ title, body, speech }); };
    const dest = state.waypoints[state.waypoints.length - 1], start = state.waypoints[0];
    state.legs.forEach(l => { l.flightSpeed = 100; });
    const f = 1 - (out / geo(start, dest).dist);
    gpsOwn = { lat: start.lat + (dest.lat - start.lat) * f, lng: start.lng + (dest.lng - start.lng) * f,
      hdg: 0, t: new Date(iso).getTime() };
    gpsResetLegAlerts();
    _gpsAlertConfirmed = true;
    gpsCheckLegAlerts();
    gpsCheckLegAlerts();                              // still inbound: must not repeat
    return window.__alerts.filter(a => a.title === 'Last light');
  }, [localIso, nmOut]);
}

test('in flight: an arrival near or after last light is warned once', async ({ page }) => {
  await boot(page);
  // Last light at Haifa on 21 June is about 20:21 local; 10 NM at 100 kt is 6 minutes.
  const late = await flyAt(page, '2026-06-21T20:05:00', 10);
  expect(late).toHaveLength(1);
  expect(late[0].body).toMatch(/last light 20:\d\d · ETA 20:1\d/);
  expect(late[0].speech).toMatch(/^Last light at .+Planned arrival 20:1\d\.$/);
});

test('in flight: a daytime arrival says nothing', async ({ page }) => {
  await boot(page);
  expect(await flyAt(page, '2026-06-21T12:00:00', 10)).toHaveLength(0);
});

test('an arrival outside the destination\'s published hours is the red finding', async ({ page }) => {
  await boot(page);
  await openFlightPlan(page);
  await page.waitForFunction(() => NavAid.airfieldHours.entryFor('LLHA'));
  // Sunday 21 June 2026: Haifa is open 08:00-22:00. Off at 22:00, landing about 22:2x.
  await setEtd(page, '2026-06-21', '22:00');
  await expect(page.locator('#fp-dest-closed')).toContainText('outside its published hours');
  await expect(page.locator('.flight-table tfoot td.fp-col-eta')).toHaveClass(/fp-eta-closed/);
  // Said once: not repeated in the popover, and no "night landing" at a shut field; the last
  // leg's ETA carries the same mark as the total.
  await expect(page.locator('#fp-last-light')).not.toContainText('outside its published hours');
  await expect(page.locator('#fp-dest-closed')).not.toContainText('night landing');
  await expect(page.locator('.flight-table tbody tr').last().locator('td.fp-col-eta')).toHaveClass(/fp-eta-closed/);
  // The morning: open, and in daylight -- nothing to say.
  await setEtd(page, '2026-06-21', '10:00');
  await expect(page.locator('#fp-dest-closed')).toHaveText('');
});

test('in flight: a destination closed at the arrival is its own alert', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => NavAid.airfieldHours.load());
  const alerts = await page.evaluate(() => {
    window.__navaidNoDayAlerts = false;
    window.__alerts = [];
    window.gpsSendWatchAlert = (title, body, speech) => { window.__alerts.push({ title, body, speech }); };
    const dest = state.waypoints[state.waypoints.length - 1], start = state.waypoints[0];
    state.legs.forEach(l => { l.flightSpeed = 100; });
    const f = 1 - (10 / geo(start, dest).dist);
    gpsOwn = { lat: start.lat + (dest.lat - start.lat) * f, lng: start.lng + (dest.lng - start.lng) * f,
      hdg: 0, t: new Date('2026-06-21T21:58:00').getTime() };
    gpsResetLegAlerts();
    _gpsAlertConfirmed = true;
    gpsCheckLegAlerts();
    gpsCheckLegAlerts();
    return window.__alerts.map(a => a.title);
  });
  expect(alerts.filter(t => t === 'Destination hours')).toHaveLength(1);
  expect(alerts.filter(t => t === 'Last light')).toHaveLength(1);
});

test('the departure field at the departure time: Herzliya is shut to fixed wing 14:00-16:00', async ({ page }) => {
  await boot(page);
  await openFlightPlan(page);
  await page.waitForFunction(() => NavAid.airfieldHours.entryFor('LLHZ'));
  await setEtd(page, '2026-06-21', '14:30');
  await expect(page.locator('#fp-dest-closed')).toContainText('at the departure');
  await setEtd(page, '2026-06-21', '16:00');
  await expect(page.locator('#fp-dest-closed')).not.toContainText('at the departure');
});

test('legs inside the departure CTR count towards the clock time', async ({ page }) => {
  await boot(page);
  const ctr = await page.evaluate(() => {
    const hz = airfields.find(a => a.name === 'LLHZ'), ha = airfields.find(a => a.name === 'LLHA');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: hz.lat + 0.03, lng: hz.lng + 0.01, name: 'BAZRA' }, { lat: ha.lat, lng: ha.lng, name: 'LLHA' }];
    syncLegs(); draw();
    return typeof legInsideCtr === 'function' && legInsideCtr(0);
  });
  test.skip(!ctr, 'no CTR leg in this dataset');
  await openFlightPlan(page);
  await setEtd(page, '2026-06-21', '10:00');
  const first = page.locator('.flight-table tbody tr').first().locator('td.fp-col-eta');
  // The cumulative column says "---" for it; the clock does not stop.
  await expect(first).toHaveText(/^10:0\d$/);
  const total = String(await page.locator('.flight-table tfoot td.fp-col-eta').first().textContent());
  const cum = String(await page.locator('.flight-table tfoot td.fp-col-cumTime').first().textContent());
  const [m, s] = cum.split(':').map(Number);
  // Arrival is later than departure + the boundary-started cumulative time.
  expect(Number(total.slice(3))).toBeGreaterThan(m + s / 60);
});

test('an odd stored departure is the quarter it shows, for the filing dialog too', async ({ page }) => {
  const tomorrow = new Date(Date.now() + 36 * 3600000);
  const iso = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
    String(tomorrow.getDate()).padStart(2, '0');
  await boot(page, { date: iso, time: '09:47' });
  expect(await page.evaluate(() => etdRead().time)).toBe('09:45');
  await page.evaluate(() => showFplDialog());
  await expect(page.locator('#fpl-time')).toHaveValue('09:45');
  // What the dialog would file: the time it shows.
  await expect(page.locator('#fpl-utc-hint')).toHaveText('0645Z');
});

test('a departure in the past is refused, and said as it is chosen', async ({ page }) => {
  await boot(page);
  // The dialog: choosing a time that has gone shows the line under it at once.
  await page.evaluate(() => showFplDialog());
  await expect(page.locator('#fpl-time-past')).toBeHidden();
  await page.locator('#fpl-date').fill('2020-01-01');
  await page.locator('#fpl-date').dispatchEvent('change');
  await expect(page.locator('#fpl-time-past')).toBeVisible();
  await expect(page.locator('#fpl-time-past')).toContainText('already passed');
  await expect(page.locator('.fpl-time-box')).toHaveAttribute('aria-describedby', /fpl-time-past/);
  // Continue refuses it, with the same words, instead of only warning "less than 60 minutes".
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.fpl-errs')).toContainText('already passed');
  // Back to a later day: gone.
  const tomorrow = await page.evaluate(() => { const d = new Date(Date.now() + 36 * 3600000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await page.locator('#fpl-date').fill(tomorrow);
  await page.locator('#fpl-date').dispatchEvent('change');
  await expect(page.locator('#fpl-time-past')).toBeHidden();
});

test('Now + 60 min sets the soonest filable departure', async ({ page }) => {
  await boot(page);
  await openFlightPlan(page);
  await openWhen(page);
  await page.locator('#fp-etd-soon').click();
  const r = await page.evaluate(() => ({ etd: etdRead(), want: fplDefaultWhen() }));
  expect(r.etd).toEqual({ date: r.want.date, time: r.want.time });
  await expect(page.locator('#fp-etd-time')).toHaveValue(r.want.time);
});

test('Submit with no departure: the departure pulses red to show what was missed', async ({ page }) => {
  await boot(page, null);
  await openFlightPlan(page);
  await page.locator('#fpl-open').click();
  await expect(page.locator('details.fp-when summary')).toHaveClass(/fp-attn/);
  await expect(page.locator('details.fp-when .qtime')).toHaveClass(/fp-attn/);
});

test('Submit with a field outside its published hours asks the same question', async ({ page }) => {
  // Tomorrow 14:30 from Herzliya: shut to fixed wing 14:00-16:00 every day of the week.
  await boot(page);
  const etd = await page.evaluate(() => { const d = new Date(Date.now() + 24 * 3600000); const p2 = n => String(n).padStart(2, '0');
    const e = { date: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), time: '14:30' }; localStorage.setItem('navaid.etd', JSON.stringify(e)); return e; });
  await openFlightPlan(page);
  await page.waitForFunction(() => NavAid.airfieldHours.entryFor('LLHZ'));
  await page.locator('#fpl-open').click();
  const ask = page.locator('.fpl-etd-ask');
  await expect(ask).toContainText('outside its published hours at the departure');
  await ask.locator('.fpl-etd-force').click();
  await expect(page.locator('#fpl-time')).toHaveValue(etd.time);
});

test('Hebrew mail names an airfield as one: "משדה תימן", never "מתימן" (Yemen)', async ({ page }) => {
  await boot(page);
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof fplMailPreamble === 'function' && typeof airfieldByIcao === 'function' && airfieldByIcao('LLBS'));
  const text = await page.evaluate(() => fplMailPreamble({ dep: 'LLBS', dest: 'LLHZ', eetMinutes: 45 }, { depTimeLocal: '10:00' }));
  expect(text).toContain('המראה משדה תימן');
  expect(text).toContain('נחיתה בשדה');
  expect(text).not.toContain('מתימן');
});

test('the departure popover closes by its X, by Escape and by a tap outside', async ({ page }) => {
  await boot(page);
  await openFlightPlan(page);
  const when = page.locator('details.fp-when');
  await openWhen(page);
  await page.locator('.fp-when-close').click();
  await expect(when).toHaveJSProperty('open', false);
  await openWhen(page);
  await page.keyboard.press('Escape');
  await expect(when).toHaveJSProperty('open', false);
  await expect(page.locator('.modal-back.flight-plan')).toBeVisible();     // Escape closed only the popover
  await openWhen(page);
  const tb = await page.locator('.modal-back.flight-plan .modal-title').boundingBox();
  await page.mouse.click(tb.x + 10, tb.y + tb.height / 2);           // a tap on the panel, outside the popover
  await expect(when).toHaveJSProperty('open', false);
});
