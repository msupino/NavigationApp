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
  await page.locator('#fp-etd-time').fill(time);
  await page.locator('#fp-etd-time').dispatchEvent('change');
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
  await expect(etaCell(page)).not.toHaveClass(/fp-eta-dark/);
  await expect(page.locator('#fp-last-light')).not.toHaveClass(/fp-last-light-late/);
  // Last light in Haifa that evening is about 20:20 local.
  await setEtd(page, '2026-06-21', '20:15');
  await expect(etaCell(page)).toHaveClass(/fp-eta-dark/);
  await expect(etaCell(page)).toHaveAttribute('title', /After last light/);
  await expect(page.locator('#fp-last-light')).toHaveClass(/fp-last-light-late/);
  await expect(page.locator('#fp-last-light')).toContainText('arrives after last light');
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
  await page.locator('#fpl-time').fill('10:30');
  await page.locator('#fpl-time').dispatchEvent('change');
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
