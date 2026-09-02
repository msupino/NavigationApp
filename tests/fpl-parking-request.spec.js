// @ts-check
// Several Israeli fields require parking to be arranged BEFORE departure (AIP): Herzliya for
// anything over an hour, overnight or maintenance; Haifa's helicopter apron; visiting aircraft
// at Megiddo, Habonim, Ein Yahav, Kiryat Shmona. The plan already holds the registration,
// aircraft type, crew, both aerodromes and the date, so the filing step offers to write that
// request instead of making the pilot retype it — addressed to the destination automatically.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof airfieldParkingRule === 'function'
    && typeof fplParkingMailtoUrl === 'function' && typeof loadAirfields === 'function');
  await page.evaluate(async () => { if (typeof airfields === 'undefined' || airfields === null) await loadAirfields(); });
}

test('the parking rule is read from the dataset, per the AIP', async ({ page }) => {
  await boot(page);
  const seen = await page.evaluate(() => ({
    hz: airfieldParkingRule('LLHZ'),
    ha: airfieldParkingRule('LLHA'),
    mg: airfieldParkingRule('LLMG'),
    bg: airfieldParkingRule('LLBG'),     // no such requirement published
    junk: airfieldParkingRule('nope'),
  }));
  // Herzliya publishes the Operations Centre address; the rule is "over an hour".
  // The 2026-08-06 amendment added a dedicated "email for coordination"; the operations
  // centre it names for executing the approval is kept alongside and cc'd.
  expect(seen.hz.email).toBe('llhz.ops@iaa.gov.il');
  expect(seen.hz.opsEmail).toBe('MerkazTi@iaa.gov.il');
  expect(seen.hz.rule).toBe('over1h');
  expect(seen.ha.email).toBe('mail_haifaairport@iaa.gov.il');
  expect(seen.mg.rule).toBe('always');   // Megiddo names a phone, not an address
  expect(seen.mg.email).toBeUndefined();
  expect(seen.bg).toBe(null);            // Ben Gurion: nothing to request here
  expect(seen.junk).toBe(null);
});

test('the request is addressed to the destination and carries the plan details', async ({ page }) => {
  await boot(page);
  const url = await page.evaluate(() => {
    // The pilot's saved filing profile is what the request draws on.
    for (const [k, v] of Object.entries({ reg: '4X-DAZ', type: 'C172', pic: 'A. Pilot',
      license: '12345', cell: '050-1234567', persons: '3', replyTo: 'pilot@example.com' })) {
      localStorage.setItem('navaid.fpl.' + k, v);
    }
    const park = airfieldParkingRule('LLHZ');
    return fplParkingMailtoUrl({ dep: 'LLBG', dest: 'LLHZ', dof: '260902' }, park,
      { depTimeLocal: '08:15' });
  });
  const body = decodeURIComponent((url.match(/body=([^&]*)/) || [])[1] || '');
  expect(url.startsWith('mailto:llhz.ops@iaa.gov.il?')).toBe(true);   // the published coordination address
  // The address keeps its literal @ (percent-encoding it mangles some clients) — same rule
  // the filing button uses — and the registration is normalised exactly as it is for the FPL.
  expect(url).toContain('MerkazTi@iaa.gov.il');                       // ops centre cc'd, per the clause
  expect(url).toContain('pilot@example.com');                         // pilot stays on the thread
  expect(body).toContain('4XDAZ');
  expect(body).toContain('C172');
  expect(body).toContain('A. Pilot');
  expect(body).toContain('licence 12345');
  expect(body).toContain('LLBG');                 // from
  expect(body).toContain('LLHZ');                 // to
  expect(body).toContain('02/09/2026');            // date of flight, as a person reads it
  expect(body).toContain('08:15');                // departure time as typed
  const subject = decodeURIComponent((url.match(/subject=([^&]*)/) || [])[1] || '');
  expect(subject).toContain('4XDAZ');
  expect(subject).toContain('LLHZ');
});

test('a field with no published address opens an unaddressed draft, not a mail to nowhere', async ({ page }) => {
  await boot(page);
  const url = await page.evaluate(() => fplParkingMailtoUrl(
    { dep: 'LLHZ', dest: 'LLMG', dof: '260902' }, airfieldParkingRule('LLMG'), {}));
  expect(url.startsWith('mailto:?')).toBe(true);   // To: left for the pilot to fill
  expect(decodeURIComponent(url)).toContain('LLMG');
});

test('details the profile does not carry are left blank, never invented', async ({ page }) => {
  await boot(page);
  const body = await page.evaluate(() => {
    for (const k of ['reg', 'type', 'pic', 'license', 'cell', 'persons', 'replyTo']) {
      localStorage.removeItem('navaid.fpl.' + k);
    }
    const url = fplParkingMailtoUrl({ dep: 'LLBG', dest: 'LLHZ', dof: '260902' },
      airfieldParkingRule('LLHZ'), {});
    return decodeURIComponent((url.match(/body=([^&]*)/) || [])[1] || '');
  });
  expect(body).toContain('[REG]');       // an unfilled registration says so
  expect(body).toContain('—');           // and the other unknowns are dashes to complete
});

// --- the dialog ------------------------------------------------------------------------
// The AIP asks for things the plan cannot know — which kind of parking, until when, whether
// fuel is wanted — so the button opens a dialog rather than dropping the pilot into a mail
// draft full of "[ ... ]" placeholders to guess at.
const openDialog = page => page.evaluate(() => {
  showParkingRequestModal({ dep: 'LLBG', dest: 'LLHZ', dof: '260902' },
    airfieldParkingRule('LLHZ'), { depTimeLocal: '08:15' });
});

test('the dialog names the recipient and previews exactly what will be sent', async ({ page }) => {
  await boot(page);
  await openDialog(page);
  const modal = page.locator('.modal-back[data-chart-modal="parking-request"]');
  await expect(modal).toBeVisible();
  // The address is stated: a pilot cannot sanity-check a recipient they cannot see.
  await expect(modal).toContainText('llhz.ops@iaa.gov.il');
  await expect(modal).toContainText('MerkazTi@iaa.gov.il');      // cc, per the clause
  const preview = await modal.locator('.parking-preview').inputValue();
  expect(preview).toContain('LLHZ');
  expect(preview).toContain('02/09/2026');
  expect(preview).not.toContain('[ transit');                    // no placeholder left to guess
});

test('choosing options rewrites the message', async ({ page }) => {
  await boot(page);
  await openDialog(page);
  const modal = page.locator('.modal-back[data-chart-modal="parking-request"]');
  const preview = modal.locator('.parking-preview');
  await modal.locator('select').selectOption({ index: 1 });      // Overnight
  await modal.locator('input[type="date"]').fill('2026-09-03');
  await modal.locator('input[type="time"]').fill('14:00');
  await modal.locator('input[type="checkbox"]').check();
  const text = await preview.inputValue();
  expect(text).toContain('Overnight');
  expect(text).toContain('03/09/2026 14:00');   // written the way the desk reads it
  expect(text).toContain('Refuelling requested');
});

test('an edited message is the pilot\'s and is not rewritten under them', async ({ page }) => {
  await boot(page);
  await openDialog(page);
  const modal = page.locator('.modal-back[data-chart-modal="parking-request"]');
  const preview = modal.locator('.parking-preview');
  await preview.fill('my own wording');
  await modal.locator('select').selectOption({ index: 2 });      // changing an option now
  expect(await preview.inputValue()).toBe('my own wording');     // must not clobber the edit
});

test('the dialog closes on Escape', async ({ page }) => {
  await boot(page);
  await openDialog(page);
  const modal = page.locator('.modal-back[data-chart-modal="parking-request"]');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

test('the departure date/time are pickers, defaulted to the day of the flight', async ({ page }) => {
  await boot(page);
  await openDialog(page);
  const modal = page.locator('.modal-back[data-chart-modal="parking-request"]');
  // Native pickers rather than a free-text format the pilot has to guess at.
  await expect(modal.locator('input[type="date"]')).toHaveCount(1);
  await expect(modal.locator('input[type="time"]')).toHaveCount(1);
  // NOT seeded from the plan: when the aircraft leaves again is not in the plan (an overnight
  // stay departs the next day), so a prefilled date would be a guess presented as an answer.
  expect(await modal.locator('input[type="date"]').inputValue()).toBe('');
  expect(await modal.locator('input[type="time"]').inputValue()).toBe('');
  // A date with no time still reads sensibly.
  await modal.locator('input[type="date"]').fill('2026-09-04');
  expect(await modal.locator('.parking-preview').inputValue()).toContain('04/09/2026');
});

test('the departure line carries no aerodrome code, and dates read the same way', async ({ page }) => {
  // An aerodrome code embedded in this label reordered to the far side of an RTL line --
  // "LLHZ: 02/09/2026" jumped left while the "מ-" it belonged to stayed right. The
  // destination is named two lines above, so the code is dropped rather than patched.
  await boot(page);
  const out = await page.evaluate(() => fplParkingText({ dep: 'LLHA', dest: 'LLHZ', dof: '260902' },
    airfieldParkingRule('LLHZ'), { until: '02/09/2026 20:00', depTimeLocal: '19:30' }).body);
  expect(out).toContain('Expected departure from destination: 02/09/2026 20:00');
  expect(out).not.toMatch(/Expected departure from destination: *LLHZ/);
  // ...and the date of flight is written the way a person reads it, not as the raw ICAO DOF
  // sitting next to an already-formatted date in the same message.
  expect(out).toContain('02/09/2026,  departure');
  expect(out).not.toContain('260902');
});

test('Escape over the filing dialog closes only the request', async ({ page }) => {
  // The real stack is three deep: plan panel -> ICAO filing dialog -> parking request. The
  // filing dialog's Escape listener is registered BEFORE this one, so without it standing
  // down, Escape closed the dialog underneath instead of the request on top.
  await boot(page);
  await page.evaluate(() => {
    // Stand-in for the filing dialog: same marker the real one is found by.
    const back = document.createElement('div');
    back.className = 'modal-back fpl-modal';
    back.id = 'stub-filing';
    document.body.appendChild(back);
    // ...with an Escape handler registered first, exactly as the real one is.
    window.__stubClosed = false;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.modal-back[data-chart-modal="parking-request"]')) return;
      window.__stubClosed = true;
      back.remove();
    }, true);
  });
  await openDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-chart-modal="parking-request"]')).toHaveCount(0);  // request gone
  expect(await page.evaluate(() => window.__stubClosed)).toBe(false);                 // filing dialog kept
  await expect(page.locator('#stub-filing')).toHaveCount(1);
});

test('Escape closes the dialog without taking the flight plan with it', async ({ page }) => {
  // The plan's own Escape listener is on `document` too, so a plain stopPropagation left both
  // handlers running: the request closed and the half-filled plan closed underneath it.
  await boot(page);
  await page.evaluate(() => {
    // A route, so the flight-plan modal has something to show.
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'LLBG' }, { lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
    showFlightPlan();
  });
  const plan = page.locator('.modal-back').filter({ hasNot: page.locator('[data-chart-modal="parking-request"]') });
  await expect(plan.first()).toBeVisible();
  const planCount = await page.locator('.modal-back').count();

  await openDialog(page);
  await expect(page.locator('[data-chart-modal="parking-request"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-chart-modal="parking-request"]')).toHaveCount(0);   // dialog gone
  expect(await page.locator('.modal-back').count()).toBe(planCount);                   // plan still up
});

test('the request will not send without the date and time it leaves again', async ({ page }) => {
  await boot(page);
  await openDialog(page);
  const modal = page.locator('.modal-back[data-chart-modal="parking-request"]');
  await modal.getByRole('button', { name: /open in mail/i }).click();
  await expect(modal).toContainText(/date and time/i);      // says what is missing...
  await expect(modal).toBeVisible();                        // ...and stays open
  await expect(modal.locator('input[type="date"]')).toHaveClass(/fpl-need/);
  // Filling them clears the mark.
  await modal.locator('input[type="date"]').fill('2026-09-03');
  await modal.locator('input[type="time"]').fill('14:00');
  await expect(modal.locator('input[type="date"]')).not.toHaveClass(/fpl-need/);
});

test('both aerodromes are named the same way', async ({ page }) => {
  await boot(page);
  const body = await page.evaluate(() => fplParkingText(
    { dep: 'LLHZ', dest: 'LLHA', dof: '260902' }, airfieldParkingRule('LLHA'), {}).body);
  // "From: LLHZ / To: LLHA (Haifa)" named one end and not the other.
  expect(body).toMatch(/LLHZ \(/);
  expect(body).toMatch(/LLHA \(/);
});

test('times say which clock they are on', async ({ page }) => {
  // An unmarked "19:30" in a mail to an operations desk is the dangerous kind of time: the
  // pilot means the clock they typed, the desk works in Zulu.
  await boot(page);
  const body = await page.evaluate(() => fplParkingText(
    { dep: 'LLHA', dest: 'LLHZ', dof: '260902' }, airfieldParkingRule('LLHZ'),
    { depTimeLocal: '19:30', depDateIso: '2026-09-02', until: '02/09/2026 20:00 LT (17:00Z)' }).body);
  // Every time carries a marker — either "LT (…Z)" or a bare Z where the two coincide.
  const times = body.match(/\b\d{2}:\d{2}\b[^\n]*/g) || [];
  expect(times.length).toBeGreaterThan(0);
  for (const t of times) expect(t).toMatch(/(LT|Z)/);
});
