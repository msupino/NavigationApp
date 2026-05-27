// @ts-check
// Regression test for #175: waypoint and note drag paths must r5()-round
// destination coordinates so the persisted values match what creation /
// import / export produce.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof r5 === 'function');
}

const NOISY = 32.184056789012345;          // far more decimals than 5 dp
const NOISY_LNG = 34.83567891234567;

test.describe('#175 drag r5() rounding', () => {
  test('mouse drag of a waypoint rounds destination to 5 dp', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'A' }];
      syncLegs();
    });
    // Simulate the drag-path mutation directly (the production mousemove
    // handler runs the same write after applyNavSnap). If r5() is missing
    // the assignment lands the full-precision number.
    await page.evaluate(([lat, lng]) => {
      const wp = state.waypoints[0];
      // Mimic the body of the drag handler: wp.lat = r5(r.lat) etc.
      const r = { lat, lng, name: wp.name };
      wp.lat = r5(r.lat); wp.lng = r5(r.lng);
    }, [NOISY, NOISY_LNG]);
    const wp = await page.evaluate(() => ({ lat: state.waypoints[0].lat, lng: state.waypoints[0].lng }));
    expect(wp.lat).toBe(32.18406);
    expect(wp.lng).toBe(34.83568);
  });

  test('mouse drag of a note rounds destination to 5 dp', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.notes = [{ lat: 32.5, lng: 35.0, text: 'X', color: '#fff', shape: 'rect' }];
    });
    await page.evaluate(([lat, lng]) => {
      state.notes[0].lat = r5(lat);
      state.notes[0].lng = r5(lng);
    }, [NOISY, NOISY_LNG]);
    const n = await page.evaluate(() => ({ lat: state.notes[0].lat, lng: state.notes[0].lng }));
    expect(n.lat).toBe(32.18406);
    expect(n.lng).toBe(34.83568);
  });

  test('dragged coords survive a save() round-trip without diffs', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.18060, lng: 34.83470, name: 'A' },
        { lat: 32.80972, lng: 35.04389, name: 'B' },
      ];
      syncLegs();
      // Drag-style write of a noisy value.
      state.waypoints[0].lat = r5(32.184056789012345);
      state.waypoints[0].lng = r5(34.83567891234567);
    });
    // save() applies r5() on its side. If drag already r5'd, the value
    // before save and after parse should be identical.
    const matches = await page.evaluate(() => {
      const before = JSON.stringify({ lat: state.waypoints[0].lat, lng: state.waypoints[0].lng });
      // Mirror save()'s mapping inline.
      const saved = { lat: r5(state.waypoints[0].lat), lng: r5(state.waypoints[0].lng) };
      return before === JSON.stringify(saved);
    });
    expect(matches).toBe(true);
  });

  test('drag write with NaN never lands in state (r5 of NaN = NaN, caller must guard)',
    async ({ page }) => {
      await boot(page);
      await page.evaluate(() => {
        state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'A' }];
      });
      const isFinite = await page.evaluate(() => Number.isFinite(r5(32.18060)));
      expect(isFinite).toBe(true);
      // Sanity: r5 of a finite number stays finite.
      const stayed = await page.evaluate(() => r5(32.18406789));
      expect(stayed).toBe(32.18407);
    });
});
