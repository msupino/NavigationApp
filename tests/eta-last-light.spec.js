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
  await openFlightPlan(page);
  await setEtd(page, '2026-06-21', '10:00');
  await expect(etaCell(page)).not.toHaveClass(/fp-eta-night/);
  await expect(page.locator('#fp-last-light')).not.toHaveClass(/fp-last-light-late/);
  // Last light in Haifa that evening is about 20:20 local.
  await setEtd(page, '2026-06-21', '20:15');
  await expect(etaCell(page)).toHaveClass(/fp-eta-night/);
  await expect(etaCell(page)).toHaveAttribute('title', /After last light.*night/);
  await expect(page.locator('#fp-last-light')).toHaveClass(/fp-last-light-late/);
  await expect(page.locator('#fp-last-light')).toContainText('arrives after last light');
  // Night is a caution, not a closed field: Haifa is open until 22:00 on a Sunday.
  await expect(page.locator('#fp-dest-closed')).not.toContainText('at the arrival');
  await expect(page.locator('.flight-table tfoot td.fp-col-eta')).not.toHaveClass(/fp-eta-closed/);
  // ...while Herzliya itself shuts at 19:30, so the departure is the red finding.
  await expect(page.locator('#fp-dest-closed')).toContainText('at the departure');
  await expect(page.locator('#fp-last-light-short')).toHaveClass(/fp-last-light-late/);
  await expect(page.locator('details.fp-when summary')).toHaveText('ETD 20:15');
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

test('the filing dialog starts from the planned departure, and writes it back', async ({ page }) => {
  // A departure tomorrow, comfortably beyond the filing lead.
  const tomorrow = new Date(Date.now() + 36 * 3600000);
  const iso = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
    String(tomorrow.getDate()).padStart(2, '0');
  await boot(page, { date: iso, time: '09:45' });
  await page.evaluate(() => showFplDialog());
  await expect(page.locator('#fpl-time')).toHaveValue('09:45');
  await expect(page.locator('#fpl-date')).toHaveValue(iso);
  await page.locator('#fpl-time').locator('..').locator('.qtime-h').selectOption('10');
  await page.locator('#fpl-time').locator('..').locator('.qtime-m').selectOption('30');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.etd'))))
    .toEqual({ date: iso, time: '10:30' });
});

test('a departure in the past is not offered for filing', async ({ page }) => {
  await boot(page, { date: '2020-01-01', time: '09:00' });
  await page.evaluate(() => showFplDialog());
  await expect(page.locator('#fpl-date')).not.toHaveValue('2020-01-01');
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
  // The morning: open, and in daylight -- nothing to say.
  await setEtd(page, '2026-06-21', '10:00');
  await expect(page.locator('#fp-dest-closed')).toHaveText('');
});

test('in flight: a destination closed at the arrival is its own alert', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => NavAid.airfieldHours.load());
  const alerts = await page.evaluate(() => {
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
