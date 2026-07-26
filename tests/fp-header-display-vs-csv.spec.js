// @ts-check
// The flight-plan column titles and the CSV export header are two different things.
// They used to be one array, and the CSV row is scraped from the rendered <th>, so
// rewording a title silently rewrote the exported file's header and broke anything
// keyed on the old name. Titles now carry units; the export contract does not move.
const { test, expect } = require('./_setup');

async function openPlan(page, lang = 'en') {
  await page.goto(`?lang=${lang}&nogist`);
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADERA' }];
    state.legs = []; syncLegs(); state.legs.forEach(l => l.flightSpeed = 110);
    state.selected = null; draw();
    showFlightPlan();
  });
  await page.waitForSelector('.flight-table thead th');
}

const csvRow = page => page.evaluate(() =>
  [...document.querySelectorAll('.flight-table thead th')]
    .filter(th => !(th.classList && th.classList.contains('fp-col-hidden')))
    .map(th => (th.dataset && th.dataset.csv) || th.textContent || '')
    .filter(h => h.trim() !== '')
    .join(','));

test('the table shows units while the CSV header keeps its stable names', async ({ page }) => {
  await openPlan(page);
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('.flight-table thead th')].map(t => t.textContent).filter(Boolean));
  expect(titles).toContain('Time (mm:ss)');
  expect(titles).toContain('Cum. time (mm:ss)');

  const row = await csvRow(page);
  // Byte-identical to what shipped before the reword — this is the contract.
  expect(row).toContain(',Time,');
  expect(row).toContain(',Cum. time,');
  expect(row).not.toContain('mm:ss');
});

test('every header cell carries its export name, so a reworded title cannot leak', async ({ page }) => {
  await openPlan(page);
  const r = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('.flight-table thead th')];
    const missing = ths.filter(th => th.textContent.trim() && th.dataset.csv === undefined)
      .map(th => th.textContent.trim());
    // Simulate a future reword of a visible title.
    const time = ths.find(th => /^Time/.test(th.textContent));
    time.textContent = 'Elapsed';
    const after = ths
      .filter(th => !(th.classList && th.classList.contains('fp-col-hidden')))
      .map(th => (th.dataset && th.dataset.csv) || th.textContent || '')
      .filter(h => h.trim() !== '').join(',');
    return { missing, after };
  });
  expect(r.missing).toEqual([]);        // no titled cell lacks a contract
  expect(r.after).toContain(',Time,');  // the reword does not reach the export
  expect(r.after).not.toContain('Elapsed');
});

test('the display array falls back to the export name when a slot is absent', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function');
  const titles = await page.evaluate(() => {
    S.fpHeadersDisplay = [];            // as if a locale shipped none
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.44, lng: 34.90, name: 'B' }];
    state.legs = []; syncLegs(); state.legs.forEach(l => l.flightSpeed = 110);
    draw(); showFlightPlan();
    return [...document.querySelectorAll('.flight-table thead th')].map(t => t.textContent).filter(Boolean);
  });
  expect(titles).toContain('Time');     // no empty headers, no crash
  expect(titles).toContain('Cum. time');
});

test('Hebrew shows its own units and the same stable CSV names', async ({ page }) => {
  await openPlan(page, 'he');
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('.flight-table thead th')].map(t => t.textContent).filter(Boolean));
  expect(titles.join('|')).toMatch(/דק:שנ/);
  const row = await csvRow(page);
  expect(row).not.toMatch(/דק:שנ/);     // units stay out of the export in every locale
});
