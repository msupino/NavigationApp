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
  expect(body).toContain('260902');               // date of flight
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
