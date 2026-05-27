// @ts-check
const { test, expect } = require('./_setup');

// Coordinates copied from docs/airfields.json (LLHZ, LLHA) and
// docs/nav-waypoints.json (the 9 published Israeli CVFR reporting points
// between them) and rounded to 5 dp to match r5() output. Updating the
// source JSON files should be followed by re-syncing these values.
const ROUTE = {
  waypoints: [
    { lat: 32.18060, lng: 34.83470, name: 'LLHZ' },
    { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
    { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
    { lat: 32.32306, lng: 34.90389, name: 'SHARO' },
    { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
    { lat: 32.59194, lng: 34.94639, name: 'FRDIS' },
    { lat: 32.71444, lng: 34.97083, name: 'BOREN' },
    { lat: 32.75389, lng: 34.93694, name: 'HOTRM' },
    { lat: 32.79611, lng: 34.94333, name: 'DAROM' },
    { lat: 32.84111, lng: 34.98111, name: 'GALIM' },
    { lat: 32.80972, lng: 35.04389, name: 'LLHA' },
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
    await page.locator('#plan').click();
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    const fwdTable = modal.locator('.fp-scroll > .flight-table').first();
    const fwdRows = fwdTable.locator('tbody tr');
    await expect(fwdRows).toHaveCount(10);

    // From/To cells contain <input> — read their values
    const firstFrom = await fwdRows.nth(0).locator('td').nth(1).locator('input').inputValue();
    const firstTo = await fwdRows.nth(0).locator('td').nth(2).locator('input').inputValue();
    expect(firstFrom).toBe('LLHZ');
    expect(firstTo).toBe('BAZRA');

    const lastFrom = await fwdRows.nth(9).locator('td').nth(1).locator('input').inputValue();
    const lastTo = await fwdRows.nth(9).locator('td').nth(2).locator('input').inputValue();
    expect(lastFrom).toBe('GALIM');
    expect(lastTo).toBe('LLHA');

    // No return section
    await expect(modal.locator('.flight-plan-sub')).toHaveCount(0);
  });

  test('both-ways flight plan — forward + return tables', async ({ page }) => {
    await page.evaluate(() => { window.showReturn = true; });
    await page.locator('#plan').click();
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
    await page.locator('#plan').click();
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
    await page.evaluate(() => { window.showReturn = false; });
    await page.locator('#plan').click();
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();

    // No return when first opened
    await expect(modal.locator('.flight-plan-sub')).toHaveCount(0);

    // Toggle return on
    await page.locator('#ret-cb').check();
    await expect(modal).toBeVisible();
    await expect(modal.locator('.flight-plan-sub')).toHaveCount(1);

    // Toggle return off
    await page.locator('#ret-cb').uncheck();
    await expect(modal).toBeVisible();
    await expect(modal.locator('.flight-plan-sub')).toHaveCount(0);
  });

  test('flight plan stays open on data refresh (waypoint drag)', async ({ page }) => {
    await page.locator('#plan').click();
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
    await page.locator('#plan').click();
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
    await page.locator('#plan').click();
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
    await page.locator('#plan').click();
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
    await page.locator('#plan').click();
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
    await page.locator('#plan').click();
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

  test('Flight Plan button toggles: second click closes the modal', async ({ page }) => {
    const modal = page.locator('.modal-back.flight-plan');
    await page.locator('#plan').click();
    await expect(modal).toBeVisible();
    await page.locator('#plan').click();
    await expect(modal).toHaveCount(0);
    // Re-open with a third click.
    await page.locator('#plan').click();
    await expect(modal).toBeVisible();
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

  test('Pin button no longer exists (UX moved to export modal)', async ({ page }) => {
    await page.locator('#plan').click();
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();
    // .modal-pin and resize handles retired — placement now picked in
    // the Export PNG modal.
    await expect(modal.locator('.modal-pin')).toHaveCount(0);
    await expect(modal.locator('.resize-handle')).toHaveCount(0);
  });

  test('Stale pin-mode localStorage keys are cleared on open', async ({ page }) => {
    // Seed the old keys, open the modal, verify they're gone.
    await page.evaluate(() => {
      try {
        localStorage.setItem('navaid.planPin', '1');
        localStorage.setItem('navaid.planW', '400');
        localStorage.setItem('navaid.planH', '250');
      } catch (e) {}
    });
    await page.locator('#plan').click();
    await page.locator('.modal-back.flight-plan').waitFor();
    expect(await page.evaluate(() => localStorage.getItem('navaid.planPin'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('navaid.planW'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('navaid.planH'))).toBeNull();
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
      await page.locator('#plan').click();
      await page.locator('#plan').click();
    }
    const leftover = await page.evaluate(() => window.__touchCount);
    expect(leftover).toBe(0);
  });
});
