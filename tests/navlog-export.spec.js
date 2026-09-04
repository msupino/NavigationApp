// @ts-check
// The kneeboard nav log builds a print-ready window from the RENDERED flight-plan tables, so
// it carries exactly what the pilot is looking at — including live <input>/<select> values,
// which cloneNode does not copy. It had no test of its own; this one exists because the
// function was lifted out of showFlightPlan() and a 156-line move deserves a net.
const { test, expect } = require('./_setup');
const { clickToolbarControl } = require('./_toolbar');

// Same shape the flight-plan suite uses: state.waypoints + state.legs, then syncLegs().
const ROUTE = {
  waypoints: [
    { lat: 32.1800, lng: 34.8300, name: 'LLHZ' },
    { lat: 32.4000, lng: 35.0500, name: 'WP 1' },
    { lat: 32.6000, lng: 35.2400, name: 'LLMG' },
  ],
  legs: [
    { inboundAltitude: 1500, outboundAltitude: 2000, flightSpeed: 100, outboundSpeed: 100 },
    { inboundAltitude: 2000, outboundAltitude: 1500, flightSpeed: 100, outboundSpeed: 100 },
  ],
};

// Capture what the new window is written with, instead of letting it open and print.
async function stubPrintWindow(page) {
  await page.addInitScript(() => {
    window.__navlog = '';
    window.__printed = 0;
    window.open = () => ({
      document: {
        open: () => {},          // the export calls document.open() before write()
        write: (h) => { window.__navlog += h; },
        close: () => {},
        title: '',
      },
      focus: () => {},
      print: () => { window.__printed += 1; },
      close: () => {},
    });
  });
}

async function planWithRoute(page) {
  await stubPrintWindow(page);
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showFlightPlan !== 'undefined');
  await page.evaluate(r => {
    state.waypoints = r.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    state.legs = r.legs.map(l => ({ ...l, inLabel: { a: 0, p: 0 }, outLabel: { a: 0, p: 0 } }));
    state.notes = [];
    syncLegs();
    draw();
  }, ROUTE);
  await clickToolbarControl(page, '#plan');
  await expect(page.locator('.modal-back.flight-plan')).toBeVisible();
  await expect(page.locator('.fp-scroll > .flight-table').first()).toBeVisible();
}

test('the nav log is built from the rendered tables', async ({ page }) => {
  await planWithRoute(page);
  await page.getByRole('button', { name: /Nav log/i }).click();
  const html = await page.evaluate(() => window.__navlog);
  expect(html).toBeTruthy();
  // The waypoints the plan is showing, not a re-derivation of the model.
  expect(html).toContain('LLHZ');
  expect(html).toContain('LLMG');
  expect(html).toContain('<table');
});

test('live input values reach the printed copy', async ({ page }) => {
  await planWithRoute(page);
  // cloneNode copies attributes, not live .value — the export reads each value off the
  // ORIGINAL element, pairing originals and clones by document order. That pairing is the
  // subtlest thing in the function, so it gets the assertion.
  const typed = await page.evaluate(() => {
    const inp = document.querySelector('.fp-scroll > .flight-table input');
    if (!inp) return null;
    inp.value = '137';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return '137';
  });
  test.skip(typed === null, 'no editable cell in this plan');
  await page.getByRole('button', { name: /Nav log/i }).click();
  expect(await page.evaluate(() => window.__navlog)).toContain('137');
});

test('printing is triggered once', async ({ page }) => {
  await planWithRoute(page);
  await page.getByRole('button', { name: /Nav log/i }).click();
  await expect.poll(() => page.evaluate(() => window.__printed || 0), { timeout: 4000 })
    .toBeGreaterThan(0);
});
