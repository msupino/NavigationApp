// @ts-check
// Reported as "cannot see the buttons or plan at all": pressing Plan with nothing drawn did
// answer -- with alert(), which is one of the three dialogs a page does not own. A browser may
// suppress it after one is dismissed, and a WebView shows it only if the host app implements
// onJsAlert, which is exactly where this app is used. A refusal nobody can see is
// indistinguishable from a button that is broken, and that is how it was reported.
//
// The precondition refusals speak through the app's own toast now: on screen in every runtime,
// and with the warning floor they deserve.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof showFlightPlan === 'function');
  return page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => window.__alerts.push(String(m));
    window.__toasts = [];
    const real = window.showToast;
    window.showToast = (m, o) => { window.__toasts.push({ text: String(m), opts: o }); return real(m, o); };
  });
}

const said = (page) => page.evaluate(() => ({ toasts: window.__toasts, alerts: window.__alerts }));

test('the flight plan says why it did not open, where a WebView can show it', async ({ page }) => {
  await boot(page, 'he');
  await page.evaluate(() => document.querySelector('.deck-btn-plan').click());
  const out = await said(page);
  expect(out.alerts, 'still going through alert()').toEqual([]);
  expect(out.toasts).toHaveLength(1);
  expect(out.toasts[0].text).toMatch(/ציוני דרך/);
  // A refusal is not an acknowledgement: it gets the longer floor.
  expect(out.toasts[0].opts).toEqual({ warn: true });
});

test('the other preconditions speak the same way', async ({ page }) => {
  await boot(page);
  const cases = await page.evaluate(() => {
    const out = [];
    for (const [name, run] of [
      ['share', () => shareRoute()],
      ['gpx', () => exportGpx()],
      ['pln', () => exportPln()],
      ['save', () => save()],
      // Not the CSV button: it lives inside the flight-plan window, so it cannot be pressed
      // without a plan and has no precondition to refuse.
    ]) {
      window.__toasts.length = 0;
      window.__alerts.length = 0;
      try { run(); } catch (e) { /* the refusal is the point, not the return */ }
      out.push({ name, toasts: window.__toasts.length, alerts: window.__alerts.length });
    }
    return out;
  });
  for (const c of cases) {
    expect(c.alerts, c.name + ' used alert()').toBe(0);
    expect(c.toasts, c.name + ' said nothing at all').toBeGreaterThan(0);
  }
});

test('with a route drawn, the plan opens and nothing is refused', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' },
                       { lat: 32.78, lng: 35.02, name: 'LLHA' }];
    syncLegs();
    draw();
    showFlightPlan();
  });
  const out = await said(page);
  expect(out.alerts).toEqual([]);
  expect(out.toasts).toEqual([]);
  await expect(page.locator('.modal-back.flight-plan .modal-btns button')).toHaveCount(4);
});
