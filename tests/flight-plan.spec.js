// @ts-check
const { test, expect } = require('./_setup');
const { LLHZ, LLHA } = require('./_airfieldArp');
const { clickToolbarControl, hideToolbarMenus, showToolbarControl } = require('./_toolbar');
const NAV_WAYPOINTS = require('./_layerData').waypointRows('cvfr');

const NAV_EN = new Map(NAV_WAYPOINTS.map(w => [w.name, w.en]));
function displayName(code) {
  return NAV_EN.get(code) || code;
}

async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Endpoints from `docs/data/airfields.json` via `tests/_airfieldArp.js`; CVFR
// reporting points between them from `docs/data/cvfr-nav-waypoints.json` (5 dp).
const ROUTE = {
  waypoints: [
    { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
    { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
    { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
    { lat: 32.32306, lng: 34.90389, name: 'SHARO' },
    { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
    { lat: 32.59194, lng: 34.94639, name: 'FRDIS' },
    { lat: 32.71444, lng: 34.97083, name: 'BOREN' },
    { lat: 32.75389, lng: 34.93694, name: 'HOTRM' },
    { lat: 32.79611, lng: 34.94333, name: 'DAROM' },
    { lat: 32.84111, lng: 34.98111, name: 'GALIM' },
    { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
  ],
  legs: Array(10).fill(null).map(() => ({
    inboundAltitude: 1500,
    outboundAltitude: 2000,
    flightSpeed: 90,
    outboundSpeed: 90,
    inLabel: { a: 0, p: 44 },
    outLabel: { a: 0, p: -44 },
  })),
  notes: [],
};

test.describe('Flight plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof showFlightPlan !== 'undefined');
    await page.evaluate(route => {
      state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
      state.legs = route.legs.map(l => ({
        inboundAltitude: l.inboundAltitude,
        outboundAltitude: l.outboundAltitude,
        flightSpeed: l.flightSpeed,
        outboundSpeed: l.outboundSpeed,
        inLabel: { a: l.inLabel.a, p: l.inLabel.p },
        outLabel: { a: l.outLabel.a, p: l.outLabel.p },
      }));
      state.notes = [];
      syncLegs();
      draw();
    }, ROUTE);
  });

  test('one-way flight plan — forward table only', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = false; });
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const fwdTable = modal.locator('.fp-scroll > .flight-table').first();
    const fwdRows = fwdTable.locator('tbody tr');
    await expect(fwdRows).toHaveCount(10);

    // From/To cells contain <input> — read their values
    const firstFrom = await fwdRows.nth(0).locator('td').nth(1).locator('input').inputValue();
    const firstTo = await fwdRows.nth(0).locator('td').nth(2).locator('input').inputValue();
    expect(firstFrom).toBe(displayName('LLHZ'));
    expect(firstTo).toBe(displayName('BAZRA'));

    const lastFrom = await fwdRows.nth(9).locator('td').nth(1).locator('input').inputValue();
    const lastTo = await fwdRows.nth(9).locator('td').nth(2).locator('input').inputValue();
    expect(lastFrom).toBe(displayName('GALIM'));
    expect(lastTo).toBe(displayName('LLHA'));

    // No return section
    await expect(modal.locator('.flight-plan-sub')).toHaveCount(0);
  });

  test('column selector hides columns in table and CSV and persists', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = true; });
    await clickToolbarControl(page, '#plan');
    let modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    await modal.locator('.fp-columns summary').click();
    // Per-leg distance now SHIPS visible (it is a nav-log staple), so hide it here
    // explicitly — this test is about the selector, not about the defaults.
    await modal.locator('.fp-columns input[data-fp-col="dist"]').uncheck();
    await modal.locator('.fp-columns input[data-fp-col="fuel"]').uncheck();
    await modal.locator('.fp-columns input[data-fp-col="cumFuel"]').uncheck();

    const fwdTable = modal.locator('.fp-scroll > .flight-table').first();
    const retTable = modal.locator('.fp-scroll > .flight-table').nth(1);
    await expect(fwdTable.locator('thead th.fp-col-dist')).toBeHidden();
    await expect(modal.locator('.fp-columns input[data-fp-col="dist"]')).not.toBeChecked();

    await expect(fwdTable.locator('thead th.fp-col-fuel')).toBeHidden();
    await expect(fwdTable.locator('thead th.fp-col-cumFuel')).toBeHidden();
    await expect(retTable.locator('thead th.fp-col-fuel')).toBeHidden();

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.fpColumns') || '[]'));
    expect(saved).toEqual(expect.arrayContaining(['dist', 'fuel', 'cumFuel']));

    const downloadPromise = page.waitForEvent('download');
    await modal.locator('.modal-btns button', { hasText: 'CSV' }).click();
    const csv = await downloadText(await downloadPromise);
    expect(csv).not.toContain('Dist (NM)');
    expect(csv).not.toContain('Fuel (gal)');
    expect(csv).not.toContain('Cum. fuel');
    expect(csv).toContain('Flight plan\r\n#,From,To,Hdg,Speed (kt),Alt (ft),Time,Cum. time');

    await modal.locator('.modal-close-x').click();
    await clickToolbarControl(page, '#plan');
    modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.flight-table').first().locator('thead th.fp-col-fuel')).toBeHidden();
    await expect(modal.locator('.fp-columns input[data-fp-col="fuel"]')).not.toBeChecked();

    await modal.locator('.fp-columns summary').click();
    await modal.locator('.fp-columns-all').click();
    await expect(modal.locator('.flight-table').first().locator('thead th.fp-col-dist')).toBeVisible();
    await expect(modal.locator('.flight-table').first().locator('thead th.fp-col-fuel')).toBeVisible();
    const allColumns = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.fpColumns') || 'null'));
    expect(allColumns).toEqual([]);
  });

  test('both-ways flight plan — forward + return tables', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = true; });
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    // Return section heading — exact text from S.fpReturn
    await expect(modal.locator('.flight-plan-sub')).toHaveCount(1);
    await expect(modal.locator('.flight-plan-sub')).toHaveText('Return route');

    // Two tables
    const tables = modal.locator('.fp-scroll > .flight-table');
    await expect(tables).toHaveCount(2);

    const fwdRows = tables.first().locator('tbody tr');
    const retRows = tables.nth(1).locator('tbody tr');
    await expect(fwdRows).toHaveCount(10);
    await expect(retRows).toHaveCount(10);

    // Derive expected return legs from forward table: reverse leg order, swap From/To.
    const fwdLegs = await fwdRows.evaluateAll(rows =>
      rows.map(r => ({
        from: r.querySelectorAll('td')[1].querySelector('input').value,
        to:   r.querySelectorAll('td')[2].querySelector('input').value,
      }))
    );
    const expectedRet = [...fwdLegs].reverse().map(l => ({ from: l.to, to: l.from }));
    for (let i = 0; i < 10; i++) {
      const from = await retRows.nth(i).locator('td').nth(1).locator('input').inputValue();
      const to   = await retRows.nth(i).locator('td').nth(2).locator('input').inputValue();
      expect(from).toBe(expectedRet[i].from);
      expect(to).toBe(expectedRet[i].to);
    }
  });

  test('return headings are reciprocal of forward headings (±180°)', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = true; });
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const tables = modal.locator('.fp-scroll > .flight-table');
    const fwdRows = tables.first().locator('tbody tr');
    const retRows = tables.nth(1).locator('tbody tr');

    // Heading is column index 3 (0-based), plain text like "045°M"
    const fwdHdgs = await fwdRows.evaluateAll(rows =>
      rows.map(r => parseInt((r.querySelectorAll('td')[3]?.textContent || '').replace('°M', ''), 10))
    );
    const retHdgs = await retRows.evaluateAll(rows =>
      rows.map(r => parseInt((r.querySelectorAll('td')[3]?.textContent || '').replace('°M', ''), 10))
    );

    expect(fwdHdgs).toHaveLength(10);
    expect(retHdgs).toHaveLength(10);

    // Return leg i is the reverse of forward leg (9-i)
    for (let i = 0; i < 10; i++) {
      const ri = 9 - i;
      const expected = (fwdHdgs[ri] + 180) % 360;
      expect(retHdgs[i]).toBe(expected);
    }
  });

  test('return toggle while modal is open updates the table', async ({ page }) => {
    // The return path now ships OFF (featureShowReturn), which hides this control. This
    // test is ABOUT that control, so it asks for the feature instead of inheriting it.
    await page.evaluate(() => {
      const orig = window.tune;
      window.tune = (k) => (k === 'featureShowReturn' ? true : orig(k));
      const row = document.getElementById('ret-cb').closest('label');
      if (row) row.hidden = false;
      window.showReturn = false;
    });
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    // No return when first opened
    await expect(modal.locator('.flight-plan-sub')).toHaveCount(0);

    // Toggle return on
    await showToolbarControl(page, '#ret-cb');
    await page.locator('#ret-cb').check();
    await expect(modal).toBeVisible();
    await expect(modal.locator('.flight-plan-sub')).toHaveCount(1);

    // Toggle return off
    await page.locator('#ret-cb').uncheck();
    await expect(modal).toBeVisible();
    await expect(modal.locator('.flight-plan-sub')).toHaveCount(0);
  });

  test('flight plan stays open on data refresh (waypoint drag)', async ({ page }) => {
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    // Simulate waypoint drag
    await page.evaluate(() => {
      state.waypoints[0].lat = 32.190;
      state.waypoints[0].lng = 34.845;
      draw();
    });

    await expect(modal).toBeVisible();

    // Distance column (index 4) should have updated
    const rows = modal.locator('.flight-table').first().locator('tbody tr');
    const distText = await rows.nth(0).locator('td').nth(4).textContent();
    expect(parseFloat(distText)).toBeGreaterThan(0);
  });

  test('adding a waypoint while flight plan is open rebuilds the table', async ({ page }) => {
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    await page.evaluate(() => {
      state.waypoints.splice(5, 0, { lat: 32.500, lng: 34.930, name: 'MID' });
      syncLegs();
      draw();
    });

    await expect(modal).toBeVisible();
    const rows = modal.locator('.flight-table').first().locator('tbody tr');
    await expect(rows).toHaveCount(11);
  });

  test('altitude propagation updates forward table display and state — no close needed', async ({ page }) => {
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const fwdRows = modal.locator('.fp-scroll > .flight-table').first().locator('tbody tr');

    // Change leg 0 altitude (col 6) from 1500 → 5000 via realistic fill + blur
    const altInput = fwdRows.nth(0).locator('td').nth(6).locator('input');
    await altInput.fill('5000');
    await altInput.blur();
    await page.waitForTimeout(100);

    // All forward rows reflect the new value immediately
    for (let i = 0; i < 10; i++) {
      const val = await fwdRows.nth(i).locator('td').nth(6).locator('input').inputValue();
      expect(val).toBe('5000');
    }

    // State matches
    const stateAlts = await page.evaluate(() => state.legs.map(l => l.inboundAltitude));
    stateAlts.forEach((v, i) => expect(v).toBe(5000));
  });

  test('speed propagation updates forward table display and state — no close needed', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = true; });
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const tables = modal.locator('.fp-scroll > .flight-table');
    const fwdRows = tables.first().locator('tbody tr');

    // Change leg 0 forward speed (col 5) from 90 → 120
    const speedInput = fwdRows.nth(0).locator('td').nth(5).locator('input');
    await speedInput.evaluate(el => {
      el.value = '120';
      if (typeof el.onchange === 'function') el.onchange(new Event('change'));
    });
    await page.waitForTimeout(100);

    // All forward speed inputs show 120 (propagated downstream)
    for (let i = 0; i < 10; i++) {
      const val = await fwdRows.nth(i).locator('td').nth(5).locator('input').inputValue();
      expect(val).toBe('120');
    }

    // State matches for flightSpeed
    const stateSpeeds = await page.evaluate(() => state.legs.map(l => l.flightSpeed));
    stateSpeeds.forEach((v, i) => expect(v).toBe(120));

    // Return table outboundSpeed should remain 90 (separate property)
    const retRows = tables.nth(1).locator('tbody tr');
    for (let i = 0; i < 10; i++) {
      const val = await retRows.nth(i).locator('td').nth(5).locator('input').inputValue();
      expect(val).toBe('90');
    }
  });

  test('return-table speed change propagates forward through return route — not backward', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = true; });
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const retRows = modal.locator('.fp-scroll > .flight-table').nth(1).locator('tbody tr');

    // Change speed in return row 0 (first return leg = forward leg 9) from 90 → 120.
    const retSpeedInput = retRows.nth(0).locator('td').nth(5).locator('input');
    await retSpeedInput.evaluate(el => {
      el.value = '120';
      if (typeof el.onchange === 'function') el.onchange(new Event('change'));
    });
    await page.waitForTimeout(100);

    // All return rows should show 120 (propagated forward through return route)
    for (let i = 0; i < 10; i++) {
      const val = await retRows.nth(i).locator('td').nth(5).locator('input').inputValue();
      expect(val).toBe('120');
    }

    // Forward table flightSpeed is a different property — should remain 90
    const fwdRows = modal.locator('.fp-scroll > .flight-table').first().locator('tbody tr');
    for (let i = 0; i < 10; i++) {
      const val = await fwdRows.nth(i).locator('td').nth(5).locator('input').inputValue();
      expect(val).toBe('90');
    }

    // State matches for outboundSpeed
    const stateOutSpeeds = await page.evaluate(() => state.legs.map(l => l.outboundSpeed));
    stateOutSpeeds.forEach((v, i) => expect(v).toBe(120));
  });

  test('return-table altitude propagates backward and updates display — no close needed', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = true; });
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const retRows = modal.locator('.fp-scroll > .flight-table').nth(1).locator('tbody tr');

    // Return row 0 = last forward leg (index 9). Change outboundAltitude col 6 from 2000 → 4000.
    const retAltInput = retRows.nth(0).locator('td').nth(6).locator('input');
    await retAltInput.evaluate(el => {
      el.value = '4000';
      if (typeof el.onchange === 'function') el.onchange(new Event('change'));
    });
    await page.waitForTimeout(100);

    // All return rows now show 4000 (propagated backward through all same-valued legs)
    for (let i = 0; i < 10; i++) {
      const val = await retRows.nth(i).locator('td').nth(6).locator('input').inputValue();
      expect(val).toBe('4000');
    }

    // Forward table inboundAltitude is a different property — should remain 1500
    const fwdRows = modal.locator('.fp-scroll > .flight-table').first().locator('tbody tr');
    for (let i = 0; i < 10; i++) {
      const val = await fwdRows.nth(i).locator('td').nth(6).locator('input').inputValue();
      expect(val).toBe('1500');
    }

    // State matches
    const stateOutAlts = await page.evaluate(() => state.legs.map(l => l.outboundAltitude));
    stateOutAlts.forEach((v, i) => expect(v).toBe(4000));
  });

  test('Flight Plan button keeps the chart window open on a second click', async ({ page }) => {
    const modal = page.locator('.modal-back.flight-plan');
    await clickToolbarControl(page, '#plan');
    await expect(modal).toBeVisible();
    await clickToolbarControl(page, '#plan');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveCount(1);
  });

  test('reverse route preserves flightSpeed when showReturn is off', async ({ page }) => {
    // Set leg 0 to have outboundSpeed different from flightSpeed
    await page.evaluate(() => {
      state.legs[0].flightSpeed = 90;
      state.legs[0].outboundSpeed = 130;
      window.showReturn = false;
    });

    // Click Reverse Route button
    await page.locator('#reverse').click();
    await page.waitForTimeout(100);

    // After reverse, leg 0 was originally leg 9. Check all reversed legs:
    // flightSpeed should never be 130 (the stale outboundSpeed)
    const speeds = await page.evaluate(() => state.legs.map(l => ({
      flightSpeed: l.flightSpeed,
      outboundSpeed: l.outboundSpeed,
    })));

    for (let i = 0; i < speeds.length; i++) {
      expect(speeds[i].flightSpeed).toBe(90);
      // outboundSpeed should match flightSpeed (not swap in stale 130)
      expect(speeds[i].outboundSpeed).toBe(90);
    }
  });

  test('R key reverses the route', async ({ page }) => {
    const firstBefore = await page.evaluate(() => state.waypoints[0].name);
    const lastBefore  = await page.evaluate(() => state.waypoints[state.waypoints.length - 1].name);
    await page.keyboard.press('r');
    await page.waitForTimeout(50);
    const firstAfter = await page.evaluate(() => state.waypoints[0].name);
    const lastAfter  = await page.evaluate(() => state.waypoints[state.waypoints.length - 1].name);
    expect(firstAfter).toBe(lastBefore);
    expect(lastAfter).toBe(firstBefore);
  });

  test('R key inside a text input does not reverse the route', async ({ page }) => {
    const firstBefore = await page.evaluate(() => state.waypoints[0].name);
    // #wp-search lives in the hidden search overlay; open it so the input is
    // focusable, otherwise focus() falls through to <body> and 'r' reverses.
    await page.locator('#search-trigger').click();
    await expect(page.locator('#wp-search')).toBeFocused();
    await page.keyboard.press('r');
    await page.waitForTimeout(50);
    const firstAfter = await page.evaluate(() => state.waypoints[0].name);
    expect(firstAfter).toBe(firstBefore);
  });

  test('R key preserves _default label flag after reverse', async ({ page }) => {
    await page.evaluate(() => {
      state.legs.forEach(l => {
        l.inLabel  = { a: 0, _default: 1, _m: 1 };
        l.outLabel = { a: 0, _default: 1, _m: 1 };
      });
    });
    await page.keyboard.press('r');
    await page.waitForTimeout(50);
    const flags = await page.evaluate(() => state.legs.map(l => ({
      inDef: l.inLabel._default, outDef: l.outLabel._default,
      inM:   l.inLabel._m,       outM:   l.outLabel._m,
    })));
    for (const f of flags) {
      expect(f.inDef).toBe(1);
      expect(f.outDef).toBe(1);
      expect(f.inM).toBe(1);
      expect(f.outM).toBe(1);
    }
  });

  test('reverse does not throw when a leg label is missing', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));
    await page.evaluate(() => {
      state.legs[0].inLabel = null;
      state.legs[0].outLabel = undefined;
    });
    await page.locator('#reverse').click();
    await page.waitForTimeout(50);
    expect(jsErrors).toHaveLength(0);
    const ok = await page.evaluate(() =>
      state.legs.every(l => l.inLabel && l.outLabel &&
        typeof l.inLabel.a === 'number' && typeof l.outLabel.a === 'number'));
    expect(ok).toBe(true);
  });

  test('drag-handler touch listeners are cleaned up on close', async ({ page }) => {
    // Stub addEventListener to count the touch listeners attached to window
    // by the drag block. Open/close 5×; count must not grow.
    await page.evaluate(() => {
      window.__touchCount = 0;
      const origAdd = window.addEventListener.bind(window);
      const origRem = window.removeEventListener.bind(window);
      window.addEventListener = function (type, fn, opts) {
        if (type === 'touchmove' || type === 'touchend' || type === 'touchcancel') {
          window.__touchCount++;
        }
        return origAdd(type, fn, opts);
      };
      window.removeEventListener = function (type, fn, opts) {
        if (type === 'touchmove' || type === 'touchend' || type === 'touchcancel') {
          window.__touchCount--;
        }
        return origRem(type, fn, opts);
      };
    });
    for (let i = 0; i < 5; i++) {
      await clickToolbarControl(page, '#plan');
      await hideToolbarMenus(page);
      await page.locator('.modal-back.flight-plan .modal-close-x').click();
    }
    const leftover = await page.evaluate(() => window.__touchCount);
    expect(leftover).toBe(0);
  });

  test('delete-leg button exists on every forward row', async ({ page }) => {
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const fwdRows = modal.locator('.flight-table').first().locator('tbody tr');
    await expect(fwdRows).toHaveCount(10);
    for (let i = 0; i < 10; i++) {
      const delBtn = fwdRows.nth(i).locator('.fp-del button');
      await expect(delBtn).toBeVisible();
    }
  });

  test('delete middle leg (index 3) removes waypoint and reconnects', async ({ page }) => {
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    // Delete leg 3 (0-based) → removes waypoint 4 (SHARO), reconnects HADRA (idx 4→3 after splice)
    const fwdRows = modal.locator('.flight-table').first().locator('tbody tr');
    await fwdRows.nth(3).locator('.fp-del button').click();

    // Modal rebuilds with 9 legs
    await expect(fwdRows).toHaveCount(9);

    // Leg 3 now connects SHARO(3) → FRDIS(4) (HADRA was removed)
    const fromInp = fwdRows.nth(3).locator('td').nth(1).locator('input');
    const toInp   = fwdRows.nth(3).locator('td').nth(2).locator('input');
    await expect(fromInp).toHaveValue(displayName('SHARO'));
    await expect(toInp).toHaveValue(displayName('FRDIS'));
  });

  test('delete first leg removes the departure waypoint and reconnects', async ({ page }) => {
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const fwdRows = modal.locator('.flight-table').first().locator('tbody tr');
    await fwdRows.nth(0).locator('.fp-del button').click();

    await expect(fwdRows).toHaveCount(9);
    // Deleting the first leg removes the departure (its "From") = LLHZ, so
    // peeling legs off the front trims the start. Leg 0 is now BAZRA → DEROR.
    const fromInp = fwdRows.nth(0).locator('td').nth(1).locator('input');
    const toInp   = fwdRows.nth(0).locator('td').nth(2).locator('input');
    await expect(fromInp).toHaveValue(displayName('BAZRA'));
    await expect(toInp).toHaveValue(displayName('DEROR'));
  });

  test('delete last leg removes final waypoint shortens route by 1', async ({ page }) => {
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const fwdRows = modal.locator('.flight-table').first().locator('tbody tr');
    await fwdRows.nth(9).locator('.fp-del button').click();

    await expect(fwdRows).toHaveCount(9);
    // Last leg connects GALIM → (removed LLHA). After delete:
    // Leg 8: GALIM(8) → LLHA was at idx 9, removed. So now leg 8 is DAROM(7?) → GALIM(8?)
    // Actually let me think. After delete leg 9:
    // waypoints: [LLHZ, BAZRA, DEROR, SHARO, HADRA, FRDIS, BOREN, HOTRM, DAROM, GALIM]
    // leg 8: GALIM → (removed LLHA), so leg 8 becomes DAROM → GALIM
    const lastFrom = await fwdRows.nth(8).locator('td').nth(1).locator('input').inputValue();
    const lastTo   = await fwdRows.nth(8).locator('td').nth(2).locator('input').inputValue();
    expect(lastFrom).toBe(displayName('DAROM'));
    expect(lastTo).toBe(displayName('GALIM'));
  });

  test('delete leg updates state correctly (waypoints + legs trimmed)', async ({ page }) => {
    await clickToolbarControl(page, '#plan');
    const fwdRows = page.locator('.modal-back.flight-plan .flight-table').first().locator('tbody tr');
    await fwdRows.nth(5).locator('.fp-del button').click();

    const wpLen = await page.evaluate(() => state.waypoints.length);
    const legLen = await page.evaluate(() => state.legs.length);
    expect(wpLen).toBe(10);   // was 11, removed 1
    expect(legLen).toBe(9);   // was 10, removed 1
    expect(legLen).toBe(wpLen - 1);
  });

  test('delete-leg with return route: both tables rebuild correctly', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = true; });
    await clickToolbarControl(page, '#plan');
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const tables = modal.locator('.fp-scroll > .flight-table');
    const fwdRows = tables.first().locator('tbody tr');
    const retRows = tables.nth(1).locator('tbody tr');

    // Delete middle leg
    await fwdRows.nth(4).locator('.fp-del button').click();

    await expect(fwdRows).toHaveCount(9);
    await expect(retRows).toHaveCount(9);

    // Return headings should still be reciprocal of forward
    const fwdHdgs = await fwdRows.evaluateAll(rows =>
      rows.map(r => parseInt((r.querySelectorAll('td')[3]?.textContent || '').replace('°M', ''), 10))
    );
    const retHdgs = await retRows.evaluateAll(rows =>
      rows.map(r => parseInt((r.querySelectorAll('td')[3]?.textContent || '').replace('°M', ''), 10))
    );
    for (let i = 0; i < 9; i++) {
      const ri = 8 - i;
      expect(retHdgs[i]).toBe((fwdHdgs[ri] + 180) % 360);
    }
  });
});
