// @ts-check
// Issue #668: the go/no-go fuel block under the nav log -- trip + reserve + alternate, their sum
// against the tanks, fuel remaining, endurance, and a red over-tank warning. Reserve lives on the
// aircraft (navaid.aircraft.reserveMin), alternate on the filing profile (navaid.fpl.altGal).
const { test, expect } = require('./_setup');
const { pairLLHZ_LLHA } = require('./_airfieldArp');

const TWO_WP = pairLLHZ_LLHA();

async function boot(page, aircraft, extra) {
  await page.addInitScript((cfg) => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      sessionStorage.clear();
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
      if (cfg.aircraft) localStorage.setItem('navaid.aircraft', JSON.stringify(cfg.aircraft));
      if (cfg.alt != null) localStorage.setItem('navaid.fpl.altGal', String(cfg.alt));
    } catch (e) { /* storage off */ }
  }, { aircraft, alt: extra && extra.alt });
  await page.goto('?lang=' + ((extra && extra.lang) || 'en'));
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof syncLegs === 'function');
  await page.evaluate(wps => {
    state.waypoints = wps.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    draw();
  }, TWO_WP);
}

async function openFlightPlan(page) {
  await page.locator('#plan').click();
  await page.locator('.modal-back.flight-plan').waitFor({ timeout: 5000 });
}

function gal(page, key) {
  return page.evaluate((k) => {
    const row = document.querySelector('#fp-fuel-summary .fp-fuel-row[data-k="' + k + '"] .fp-fuel-v');
    return row ? parseFloat(row.textContent) : NaN;
  }, key);
}

// The fuel check is a popover: its button carries the verdict, the breakdown is inside. Open it.
async function openFuel(page) {
  await page.locator('#fp-fuel-summary').waitFor({ state: 'visible', timeout: 5000 });
  if (!(await page.locator('#fp-fuel-summary[open]').count())) {
    await page.locator('#fp-fuel-summary > summary').click();
  }
  await page.locator('#fp-fuel-summary .fp-fuel-menu').waitFor({ state: 'visible' });
}

test.describe('Fuel reserve & endurance check (#668)', () => {
  test('shows trip, reserve, required, remaining and endurance; required = trip + reserve', async ({ page }) => {
    await boot(page, { type: 'C172', gph: 8, taxiGal: 0, usableGal: 60, reserveMin: 45 });
    await openFlightPlan(page);
    await openFuel(page);

    const trip = await gal(page, 'trip');
    const reserve = await gal(page, 'reserve');
    const required = await gal(page, 'required');
    const remaining = await gal(page, 'remaining');
    expect(trip).toBeGreaterThan(0);
    // 45 min at 8 gph = 6.0 gal.
    expect(reserve).toBeCloseTo(6.0, 1);
    expect(required).toBeCloseTo(trip + reserve, 1);
    expect(remaining).toBeCloseTo(60 - required, 1);

    const endurance = await page.locator('#fp-fuel-summary .fp-fuel-row[data-k="endurance"] .fp-fuel-v').textContent();
    // 60 gal / 8 gph = 7.5 h = 7:30.
    expect(endurance.trim()).toBe('7:30');

    // No warning when the tanks cover it.
    expect(await page.locator('#fp-fuel-summary .fp-fuel-warn').isHidden()).toBe(true);
  });

  test('over-tank: required beyond usable turns the row red and shows the warning', async ({ page }) => {
    await boot(page, { type: 'C172', gph: 8, taxiGal: 0, usableGal: 3, reserveMin: 45 });
    await openFlightPlan(page);
    // The closed button already shows the no-go: a red state + a warning sign in the badge.
    await page.locator('#fp-fuel-summary').waitFor({ state: 'visible' });
    await expect(page.locator('#fp-fuel-summary')).toHaveClass(/fp-fuel-over/);
    await expect(page.locator('#fp-fuel-summary .fp-fuel-badge')).toContainText('⚠');
    await openFuel(page);
    const warn = page.locator('#fp-fuel-summary .fp-fuel-warn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText(/Over tanks/);
    // The over-tank warning is the red alarm, never the muted "set usable fuel" hint.
    expect(await warn.evaluate(el => el.classList.contains('fp-fuel-note'))).toBe(false);
    expect(await page.locator('#fp-fuel-summary .fp-fuel-remaining.fp-fuel-short').count()).toBe(1);
  });

  test('alternate fuel adds to the required total and persists', async ({ page }) => {
    await boot(page, { type: 'C172', gph: 8, taxiGal: 0, usableGal: 60, reserveMin: 30 });
    await openFlightPlan(page);
    await openFuel(page);
    const before = await gal(page, 'required');
    await page.locator('#fp-fuel-alt').fill('5');
    await page.locator('#fp-fuel-alt').dispatchEvent('input');
    await expect.poll(() => gal(page, 'required')).toBeCloseTo(before + 5, 1);
    const stored = await page.evaluate(() => localStorage.getItem('navaid.fpl.altGal'));
    expect(stored).toBe('5');
  });

  test('no usable fuel set: remaining and endurance are blank and a hint shows (not a red alarm)', async ({ page }) => {
    // Aircraft with a burn but no usable-fuel figure: the trip and reserve still compute, but the
    // tanks comparison cannot, so Remaining/Endurance are em dashes and the note (not the red
    // over-tank warning) explains why.
    await boot(page, { type: 'C172', gph: 8, taxiGal: 0, reserveMin: 45 });
    await openFlightPlan(page);
    await openFuel(page);
    expect((await page.locator('#fp-fuel-summary .fp-fuel-row[data-k="remaining"] .fp-fuel-v').textContent()).trim()).toBe('—');
    expect((await page.locator('#fp-fuel-summary .fp-fuel-row[data-k="endurance"] .fp-fuel-v').textContent()).trim()).toBe('—');
    const warn = page.locator('#fp-fuel-summary .fp-fuel-warn');
    await expect(warn).toBeVisible();
    expect(await warn.evaluate(el => el.classList.contains('fp-fuel-note'))).toBe(true);
    // No over-tank colouring when the tanks are unknown.
    expect(await page.locator('#fp-fuel-summary .fp-fuel-remaining.fp-fuel-short').count()).toBe(0);
  });

  test('CSV export carries the fuel check as label/value rows', async ({ page }) => {
    await boot(page, { type: 'C172', gph: 8, taxiGal: 0, usableGal: 60, reserveMin: 45 });
    await openFlightPlan(page);
    await page.locator('#fp-fuel-summary').waitFor({ state: 'visible' });
    const csv = await page.evaluate(() => {
      const table = document.querySelector('.flight-table');
      const scroll = table.closest('.fp-scroll') || table.parentElement;
      return typeof flightPlanCsv === 'function' ? flightPlanCsv(table, scroll) : '';
    });
    expect(csv).toContain('Fuel check');
    expect(csv).toMatch(/Total required/);
    expect(csv).toMatch(/Endurance/);
  });

  test('Hebrew: labels localise and numbers stay in order', async ({ page }) => {
    await boot(page, { type: 'C172', gph: 8, taxiGal: 0, usableGal: 60, reserveMin: 45 }, { lang: 'he' });
    await openFlightPlan(page);
    await page.locator('#fp-fuel-summary').waitFor({ state: 'visible' });
    // The popover button carries the Hebrew label; the breakdown parses correctly when opened.
    await expect(page.locator('#fp-fuel-summary .fp-fuel-btn-label')).toContainText('בדיקת דלק');
    await openFuel(page);
    // Required figure still parses as a number (isolation characters do not corrupt it).
    expect(await gal(page, 'required')).toBeGreaterThan(0);
  });
});
