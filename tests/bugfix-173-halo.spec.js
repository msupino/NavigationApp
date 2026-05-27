// @ts-check
// Regression test for #173: needsHalo('out') must compare outboundSpeed,
// not flightSpeed, between adjacent legs.
const { test, expect } = require('./_setup');

test.describe('#173 needsHalo outboundSpeed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof needsHalo === 'function');
    await page.evaluate(() => {
      window.highlightDiff = true;          // needsHalo bails when off
      state.waypoints = [
        { lat: 32.18, lng: 34.83, name: 'A' },
        { lat: 32.50, lng: 34.95, name: 'B' },
        { lat: 32.81, lng: 35.04, name: 'C' },
      ];
      syncLegs();
      for (const l of state.legs) {
        l.inboundAltitude = 2000; l.outboundAltitude = 2000;
        l.flightSpeed = 90; l.outboundSpeed = 90;
      }
    });
  });

  test('halo OFF when adjacent legs are identical', async ({ page }) => {
    const out = await page.evaluate(() => ({
      // needsHalo('in', 0) returns false (first leg has no prev). Use index 1.
      inLeg1:  needsHalo(1, 'in'),
      outLeg0: needsHalo(0, 'out'),
    }));
    expect(out).toEqual({ inLeg1: false, outLeg0: false });
  });

  test('halo ON for "out" when only outboundSpeed differs (#173)', async ({ page }) => {
    const out = await page.evaluate(() => {
      state.legs[1].outboundSpeed = 110;    // differ from leg 0's 90
      return { outLeg0: needsHalo(0, 'out'), inLeg1: needsHalo(1, 'in') };
    });
    // The bug: needsHalo('out') compared flightSpeed (both 90) → halo off.
    expect(out.outLeg0).toBe(true);
    expect(out.inLeg1).toBe(false);          // 'in' direction unaffected
  });

  test('halo ON for "in" when only flightSpeed differs', async ({ page }) => {
    const out = await page.evaluate(() => {
      state.legs[1].flightSpeed = 110;
      return { outLeg0: needsHalo(0, 'out'), inLeg1: needsHalo(1, 'in') };
    });
    expect(out.inLeg1).toBe(true);
    expect(out.outLeg0).toBe(false);         // 'out' direction unaffected
  });

  test('halo ON for "out" when only outboundAltitude differs', async ({ page }) => {
    const halo = await page.evaluate(() => {
      state.legs[1].outboundAltitude = 4000;
      return needsHalo(0, 'out');
    });
    expect(halo).toBe(true);
  });
});
