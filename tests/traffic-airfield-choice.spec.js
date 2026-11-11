// @ts-check
// A plane sitting over an airfield must offer the multi-item chooser, not silently select the
// plane. traffic.js gathers the overlay candidates at the tapped point and hands the chooser a
// {type:'traffic'} candidate alongside them; the chooser can list and select it.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadAirfields === 'function' && typeof showPointChoice === 'function' && typeof selectPointCandidate === 'function');
  await page.evaluate(async () => { await loadAirfields();
    window.trafficAircraft = [{ hex: 'ABC123', flight: 'TEST01', lat: 32.18, lon: 34.83 },
                              { hex: 'Z9', flight: '', lat: 32.0, lon: 34.8 }]; });
}

test('the chooser lists the aircraft and the airfield, and both are selectable', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const i = airfields.findIndex(a => a.name === 'LLHZ');
    const cand = [{ type: 'traffic', hex: 'ABC123', aircraft: { hex: 'ABC123', flight: 'TEST01' } },
                  { type: 'airfield', index: i, chartPoint: true }];
    const ok = showPointChoice(cand);
    const opts = [...document.querySelectorAll('.point-choice-option .point-choice-primary')].map(e => e.textContent);
    return { ok, opts };
  });
  expect(r.ok).toBe(true);
  expect(r.opts).toContain('TEST01');                 // the aircraft, by flight id
  expect(r.opts.some(o => /Herzliya|LLHZ/i.test(o || ''))).toBe(true);
});

test('choosing the aircraft selects traffic; choosing the field selects the airfield', async ({ page }) => {
  await boot(page);
  const sel = await page.evaluate(() => {
    const i = airfields.findIndex(a => a.name === 'LLHZ');
    // pick the aircraft
    showPointChoice([{ type: 'traffic', hex: 'ABC123', aircraft: { hex: 'ABC123', flight: 'TEST01' } },
                     { type: 'airfield', index: i }]);
    [...document.querySelectorAll('.point-choice-option')].find(b => /TEST01/.test(b.textContent)).click();
    const afterPlane = state.selected && state.selected.type;
    // pick the airfield
    showPointChoice([{ type: 'traffic', hex: 'ABC123', aircraft: { hex: 'ABC123', flight: 'TEST01' } },
                     { type: 'airfield', index: i }]);
    [...document.querySelectorAll('.point-choice-option')].find(b => !/TEST01/.test(b.textContent)).click();
    const afterField = state.selected && state.selected.type;
    return { afterPlane, afterField };
  });
  expect(sel.afterPlane).toBe('traffic');
  expect(sel.afterField).toBe('airfield');
});

test('a single aircraft candidate selects it directly (no modal)', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const ok = showPointChoice([{ type: 'traffic', hex: 'Z9', aircraft: { hex: 'Z9' } }]);
    return { ok, sel: state.selected && state.selected.type, modal: !!document.querySelector('.point-choice-modal') };
  });
  expect(r.ok).toBe(true);
  expect(r.sel).toBe('traffic');
  expect(r.modal).toBe(false);
});
