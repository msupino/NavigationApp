// @ts-check
// Tests for the fuel/endurance calculator in the flight-plan modal.
// Aircraft is now configured via two free inputs: GPH and Taxi/T.O. (gal).
// Presets (C152 / C172 / PA-28) and airport-based taxi detection removed.
const { test, expect } = require('./_setup');
const { pairLLHZ_LLHA } = require('./_airfieldArp');

const TWO_WP = pairLLHZ_LLHA();

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_fuel_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_fuel_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
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

// Read (legFuel of row 0, totalFuel from tfoot) from the flight table.
// Find the fuel column by matching its header text ("Fuel (gal)" or "דלק (גאל)").
async function readFuelCells(page) {
  return page.evaluate(() => {
    const table = document.querySelector('.flight-table');
    if (!table) return { legFuel: NaN, totalFuel: NaN };
    const headers = table.querySelectorAll('thead th');
    let fuelCol = -1;
    for (let i = 0; i < headers.length; i++) {
      if (/Fuel|דלק/.test(headers[i].textContent)) { fuelCol = i; break; }
    }
    if (fuelCol < 0) return { legFuel: NaN, totalFuel: NaN };
    const legRow   = table.querySelector('tbody tr:first-child');
    const totalRow = table.querySelector('tfoot tr:first-child');
    function cellAt(row, col) {
      if (!row) return NaN;
      const cells = row.querySelectorAll('td');
      // tfoot first td has colspan=4, so visual col maps differently.
      // Walk cells accumulating colspan until we reach the visual column.
      let vis = 0;
      for (const c of cells) {
        const cs = c.colSpan || 1;
        if (vis <= col && col < vis + cs) return parseFloat(c.textContent);
        vis += cs;
      }
      return NaN;
    }
    return { legFuel: cellAt(legRow, fuelCol), totalFuel: cellAt(totalRow, fuelCol) };
  });
}

test.describe('Fuel/endurance flight plan modal', () => {
  test('flight plan modal opens without JS runtime errors', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    await boot(page);
    await openFlightPlan(page);

    expect(jsErrors).toHaveLength(0);
    await expect(page.locator('#aircraft-gph')).toBeVisible();
    await expect(page.locator('#aircraft-taxi')).toBeVisible();
  });

  test('default GPH=8 and taxi=1.1 applied on open: fuel cells show numbers', async ({ page }) => {
    await boot(page);
    await openFlightPlan(page);

    expect(parseFloat(await page.locator('#aircraft-gph').inputValue())).toBe(8);
    expect(parseFloat(await page.locator('#aircraft-taxi').inputValue())).toBeCloseTo(1.1, 1);

    const { legFuel, totalFuel } = await readFuelCells(page);
    expect(legFuel).toBeGreaterThan(0);
    expect(totalFuel).toBeGreaterThan(0);
  });

  test('opening the flight plan does not change the route-summary fuel total', async ({ page }) => {
    await boot(page);
    const before = await page.locator('#route-summary').innerText();
    expect(before).toContain('gal');

    await openFlightPlan(page);

    await expect(page.locator('#route-summary')).toHaveText(before);
  });

  test('a saved aircraft profile drives the route summary before the plan is opened', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      localStorage.setItem('navaid.aircraft', JSON.stringify({ gph: 9, taxiGal: 1.1 }));
    });
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.legs.length > 0);

    const before = await page.locator('#route-summary').innerText();
    await openFlightPlan(page);

    expect(parseFloat(await page.locator('#aircraft-gph').inputValue())).toBe(9);
    await expect(page.locator('#route-summary')).toHaveText(before);
  });

  test('clearing GPH shows -- in fuel cells', async ({ page }) => {
    await boot(page);
    await openFlightPlan(page);

    await page.fill('#aircraft-gph', '');
    await page.locator('#aircraft-gph').dispatchEvent('input');

    const totFuel = await page.evaluate(() => {
      const table = document.querySelector('.flight-table');
      if (!table) return null;
      const headers = table.querySelectorAll('thead th');
      let fuelCol = -1;
      for (let i = 0; i < headers.length; i++) {
        if (/Fuel|דלק/.test(headers[i].textContent)) { fuelCol = i; break; }
      }
      if (fuelCol < 0) return null;
      const totalRow = table.querySelector('tfoot tr:first-child');
      if (!totalRow) return null;
      const cells = totalRow.querySelectorAll('td');
      let vis = 0;
      for (const c of cells) {
        const cs = c.colSpan || 1;
        if (vis <= fuelCol && fuelCol < vis + cs) return c.textContent;
        vis += cs;
      }
      return null;
    });
    expect(totFuel).toBe('--');
  });

  test('taxi fuel added to total when origin is a known airfield (LLHZ)', async ({ page }) => {
    await boot(page);
    // airfields loaded lazily on first draw(); wait before opening modal.
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await openFlightPlan(page);

    // Zero out taxi first so we have a clean before snapshot.
    await page.fill('#aircraft-taxi', '0');
    await page.locator('#aircraft-taxi').dispatchEvent('input');
    const { legFuel: legNoTaxi, totalFuel: totNoTaxi } = await readFuelCells(page);

    await page.fill('#aircraft-taxi', '1.1');
    await page.locator('#aircraft-taxi').dispatchEvent('input');
    const { legFuel: legWithTaxi, totalFuel } = await readFuelCells(page);

    // First leg cell and total both absorb the taxi allowance.
    expect(legWithTaxi - legNoTaxi).toBeCloseTo(1.1, 1);
    expect(totalFuel - totNoTaxi).toBeCloseTo(1.1, 1);
  });

  test('renaming origin airfield label keeps taxi fuel (matched by coords)', async ({ page }) => {
    await boot(page);
    // Origin remains LLHZ coordinates but the label is renamed.
    await page.evaluate(() => {
      state.waypoints[0].name = 'LLHZ1';
      syncLegs(); draw();
    });
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await openFlightPlan(page);

    await page.fill('#aircraft-gph', '8.5');
    await page.locator('#aircraft-gph').dispatchEvent('input');

    await page.fill('#aircraft-taxi', '0');
    await page.locator('#aircraft-taxi').dispatchEvent('input');
    const { legFuel: legNoTaxi } = await readFuelCells(page);

    await page.fill('#aircraft-taxi', '1.1');
    await page.locator('#aircraft-taxi').dispatchEvent('input');
    const { legFuel: legWithTaxi } = await readFuelCells(page);

    expect(legWithTaxi - legNoTaxi).toBeCloseTo(1.1, 1);
  });

  test('taxi fuel NOT added when origin is not an airfield', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints[0] = { lat: 32.21861, lng: 34.88250, name: 'BAZRA' };
      syncLegs(); draw();
    });
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await openFlightPlan(page);

    await page.fill('#aircraft-gph', '8.5');
    await page.locator('#aircraft-gph').dispatchEvent('input');
    await page.fill('#aircraft-taxi', '1.1');
    await page.locator('#aircraft-taxi').dispatchEvent('input');

    const { legFuel, totalFuel } = await readFuelCells(page);
    // No taxi: total should equal leg fuel.
    expect(totalFuel).toBeCloseTo(legFuel, 5);
  });

  test('syncAircraftUI on open does not throw when aircraft is null', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await boot(page);
    await page.evaluate(() => { window.aircraft = null; });
    await openFlightPlan(page);
    expect(jsErrors).toHaveLength(0);
  });

  test('pre-saved aircraft loads into GPH and taxi inputs', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await boot(page);
    await page.evaluate(() => {
      window.aircraft = { gph: 7, taxiGal: 1.1 };
    });
    await openFlightPlan(page);
    expect(jsErrors).toHaveLength(0);
    expect(parseFloat(await page.locator('#aircraft-gph').inputValue())).toBe(7);
    expect(parseFloat(await page.locator('#aircraft-taxi').inputValue())).toBe(1.1);
  });

  test('cumulative time and fuel columns increase down the route', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
        { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
        { lat: 32.80833, lng: 35.04278, name: 'LLHA' },
      ];
      syncLegs(); draw();
    });
    await openFlightPlan(page);

    const meta = await page.evaluate(() => {
      function colIndex(re) {
        const headers = document.querySelectorAll('.flight-table thead th');
        for (let i = 0; i < headers.length; i++) {
          if (re.test(headers[i].textContent)) return i;
        }
        return -1;
      }
      function cellAt(row, col) {
        let vis = 0;
        for (const c of row.querySelectorAll('td')) {
          const cs = c.colSpan || 1;
          if (vis <= col && col < vis + cs) return c.textContent.trim();
          vis += cs;
        }
        return '';
      }
      const headers = Array.from(document.querySelectorAll('.flight-table thead th'))
        .map(th => th.textContent);
      const cumFuelCol = colIndex(/Cum\. fuel|דלק מצטבר/);
      const trs = document.querySelectorAll('.flight-table tbody tr');
      const cumFuels = Array.from(trs).map(tr => parseFloat(cellAt(tr, cumFuelCol)));
      return { headers, cumFuels };
    });

    expect(meta.headers.some(h => /Cum\. time|זמן מצטבר/.test(h))).toBe(true);
    expect(meta.headers.some(h => /Cum\. fuel|דלק מצטבר/.test(h))).toBe(true);
    expect(meta.cumFuels).toHaveLength(2);
    expect(meta.cumFuels[1]).toBeGreaterThan(meta.cumFuels[0]);
  });
});
