// #674 — kneeboard nav-log PDF: the Nav log button opens a print-ready
// window with a header, the per-leg table, and a frequency list.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
      localStorage.setItem('navaid.sec.' + s, '1');
    } } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showFlightPlan === 'function');
}

async function openNavLog(page, context) {
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(() => {
      const b = [...document.querySelectorAll('.modal-btns button')]
        .find(x => /Nav log/i.test(x.textContent));
      b.click();
    }),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}

test('Nav log opens a printable document with header, table and freqs', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'LLSD' },
                       { lat: 32.4, lng: 35.0, name: 'LLHA' }];
    state.notes = [{ lat: 32.2, lng: 34.9, text: '', shape: 'rect', color: '#ffd84a',
                     cc: 'LLSD', freqName: 'TLV', freq: '118.40' }];
    syncLegs(); draw(); showFlightPlan();
  });
  // Stub print so headless doesn't block, then click Nav log and grab the popup.
  const popup = await openNavLog(page, context);
  const txt = await popup.evaluate(() => document.body.innerText);
  expect(txt).toContain('LLSD');
  expect(txt).toContain('LLHA');
  expect(txt).toContain('Frequencies');
  expect(txt).toContain('118.40');
  expect(await popup.locator('table.flight-table').count()).toBeGreaterThan(0);
});

test('Nav log radio frequencies follow route waypoint order', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'START' },
      { lat: 32.2, lng: 34.9, name: 'MID' },
      { lat: 32.4, lng: 35.0, name: 'END' },
    ];
    state.notes = [
      { lat: 32.4, lng: 35.0, text: '', shape: 'rect', color: '#ffd84a',
        cc: 'END', freqName: 'END_RADIO', freq: '133.30' },
      { lat: 32.0, lng: 34.8, text: '', shape: 'rect', color: '#ffd84a',
        cc: 'START', freqName: 'START_RADIO', freq: '118.10' },
      { lat: 32.2, lng: 34.9, text: '', shape: 'rect', color: '#ffd84a',
        cc: 'MID', freqName: 'MID_RADIO', freq: '122.20' },
    ];
    syncLegs(); draw(); showFlightPlan();
  });

  const popup = await openNavLog(page, context);
  const freqs = await popup.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')]
      .find(el => (el.textContent || '').trim() === 'Frequencies');
    return h2 && h2.nextElementSibling
      ? [...h2.nextElementSibling.querySelectorAll('li')].map(li => li.textContent)
      : [];
  });
  expect(freqs).toEqual([
    expect.stringContaining('START_RADIO'),
    expect.stringContaining('MID_RADIO'),
    expect.stringContaining('END_RADIO'),
  ]);
});

test('Herzliya to Beer Sheva nav log does not include the reverse Country Club frequency', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    await Promise.all([loadNavWaypoints(), loadAirfields(), loadCommChange(), loadRouteTemplates()]);
    const template = routeTemplates.find(t => t.id === 'llhz-llbs-south');
    if (!template) throw new Error('missing llhz-llbs-south template');
    await applyRouteTemplate(template, template.defaultSpeed, null);
    showFlightPlan();
  });

  const popup = await openNavLog(page, context);
  const freqs = await popup.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')]
      .find(el => (el.textContent || '').trim() === 'Frequencies');
    return h2 && h2.nextElementSibling
      ? [...h2.nextElementSibling.querySelectorAll('li')].map(li => li.textContent)
      : [];
  });
  expect(freqs.some(line => /Country|KNTRY|HERZLIYA|125\.60/.test(line || ''))).toBe(false);
  expect(freqs.at(-1)).toMatch(/Teyman/i);
  expect(freqs.at(-1)).toEqual(expect.stringContaining('122.50'));
});

test('Nav log lists the reference VOR(s) with their frequency', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'LLSD' },
                       { lat: 32.4, lng: 35.0, name: 'LLHA' }];
    syncLegs();
    if (typeof loadVors === 'function') await loadVors();
    window.vorRef = 'BGN';                    // route-wide reference VOR
    state.legs[0].vorRef = 'NAT';             // per-leg override — both must list
    draw(); showFlightPlan();
  });
  // fillLegVorSelects applies the per-leg value on a later tick — wait for it
  // so the nav-log clone freezes 'NAT', not a placeholder.
  await page.waitForFunction(() => {
    const sel = document.querySelector('.fp-leg-vor');
    return sel && sel.value === 'NAT';
  });
  const popup = await openNavLog(page, context);
  const txt = await popup.evaluate(() => document.body.innerText);
  expect(txt).toContain('Reference VOR');
  expect(txt).toContain('BGN');
  expect(txt).toContain('113.50 MHz');        // BGN frequency from vor.json
  expect(txt).toContain('NAT');
  expect(txt).toContain('112.40 MHz');        // NAT frequency

  // Each Radial row names its effective VOR: leg 0 overrides to NAT — its
  // radial cell must carry the NAT ident (not the route-wide BGN).
  const radialCells = await popup.evaluate(() =>
    [...document.querySelectorAll('td .nl-vor-ident')].map(e => e.textContent.trim()));
  expect(radialCells).toContain('NAT');
});
