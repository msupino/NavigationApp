// @ts-check
// Anonymous usage counts for the three "hand it to your mail app" buttons.
//
// Counts, never identity. Google's terms forbid sending anything that identifies a person to
// Analytics, and the privacy page promises no route, position, flight plan or setting reaches
// it -- so navaidEvent() takes an event NAME from a fixed list and no parameters at all. There
// is no slot for a registration, a name or an address to leak through, now or later.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

// Replace gtag with a recorder once the page has defined its own (the tests run at the origin
// root, which the tag's gate treats as production; the _setup fixture blocks the network).
const record = page => page.evaluate(() => {
  window.__ga = [];
  window.gtag = function () { window.__ga.push([...arguments]); };
});
const hits = page => page.evaluate(() => (window.__ga || []).filter(a => a[0] === 'event'));

test('an event is a bare name: nothing else can ride along', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navaidEvent === 'function');
  await record(page);
  const r = await page.evaluate(() => ({
    // A careless future caller passing identifying data. navaidEvent takes no such argument --
    // which is the point -- so it goes through Reflect.apply rather than a direct call that a
    // linter would (rightly, anywhere else) flag as a superfluous argument.
    known: Reflect.apply(navaidEvent, null,
      ['fpl_mail_open', { reg: '4X-ABC', email: 'pilot@example.com' }]),
    unknown: navaidEvent('pilot_name_4X-ABC'),
  }));
  expect(r.known).toBe(true);
  expect(r.unknown, 'a name outside the vocabulary must be dropped').toBe(false);
  // Exactly ['event', name] -- the params a caller tried to pass never reach gtag.
  expect(await hits(page)).toEqual([['event', 'fpl_mail_open']]);
});

test('with no tag loaded (app, previews, local runs) it does nothing', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navaidEvent === 'function');
  expect(await page.evaluate(() => { delete window.gtag; return navaidEvent('fpl_mail_open'); }))
    .toBe(false);
});

test('opening a parking request in the mail app is counted once', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showParkingRequestModal === 'function'
    && typeof loadAirfields === 'function');
  await page.evaluate(async () => {
    if (typeof airfields === 'undefined' || airfields === null) await loadAirfields();
    showParkingRequestModal({ dep: 'LLBG', dest: 'LLHZ', dof: '260902' },
      airfieldParkingRule('LLHZ'), { depTimeLocal: '08:15' });
  });
  await record(page);
  const modal = page.locator('.modal-back[data-chart-modal="parking-request"]');
  // Incomplete first: the form refuses, and a refusal is not a use.
  await modal.getByRole('button', { name: /open in mail/i }).click();
  expect(await hits(page)).toEqual([]);
  await modal.locator('input[type="date"]').fill('2026-09-03');
  await modal.locator('input[type="time"]').fill('14:00');
  await modal.getByRole('button', { name: /open in mail/i }).click();
  await expect.poll(() => hits(page)).toEqual([['event', 'parking_mail_open']]);
});

test('every mailto hand-off is counted, and only through the helper', () => {
  // The flight-plan and cross-country buttons sit at the end of a long dialog; this pins the
  // wiring statically: each assignment of a mailto to location.href is preceded by its event,
  // and nothing calls gtag directly with parameters of its own.
  const io = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app', 'io.js'), 'utf8');
  const lines = io.split('\n');
  const handoffs = lines.map((l, i) => [l, i])
    .filter(([l]) => /location\.href\s*=\s*(fplMailtoUrl|fplParkingMailtoUrl|'mailto:)/.test(l));
  expect(handoffs.length).toBe(3);
  for (const [, i] of handoffs) {
    expect(lines[i - 1], 'mailto at io.js:' + (i + 1) + ' is not counted')
      .toMatch(/navaidEvent\('(fpl|xc|parking)_mail_open'\)/);
  }
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'docs', 'app'))) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app', f), 'utf8');
    // core.js holds the helper itself -- its one call is the only one allowed.
    expect(src.match(/gtag\('event'/g) || [], f + ' calls gtag directly').toHaveLength(
      f === 'core.js' ? 1 : 0);
  }
});
