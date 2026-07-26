// @ts-check
// A leg added by extending the route inherits the speed already being flown.
// Splitting a leg always did (splitLegCopy), but appending reset to the default — so
// extending a 110 kt route produced a 90 kt final leg, with the wrong ETE and fuel
// for it, and the flight plan then showed two different aircraft.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof splitLegAt === 'function');
}

const speeds = page => page.evaluate(() => state.legs.map(l => l.flightSpeed));

test('appending a waypoint inherits the previous leg speed', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 110; state.legs[0].outboundSpeed = 110;
    state.waypoints.push({ lat: 32.7, lng: 35.2, name: 'C' }); syncLegs();
  });
  expect(await speeds(page)).toEqual([110, 110]);
  // and keeps carrying it as the route grows
  await page.evaluate(() => { state.waypoints.push({ lat: 33.0, lng: 35.5, name: 'D' }); syncLegs(); });
  expect(await speeds(page)).toEqual([110, 110, 110]);
});

test('the outbound (return) speed is inherited too', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 120; state.legs[0].outboundSpeed = 95;
    state.waypoints.push({ lat: 32.7, lng: 35.2, name: 'C' }); syncLegs();
    return state.legs.map(l => ({ in: l.flightSpeed, out: l.outboundSpeed }));
  });
  expect(r[1]).toEqual({ in: 120, out: 95 });
});

test('splitting a leg still inherits (unchanged behaviour)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.6, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 130;
    splitLegAt(0, { lat: 32.3, lng: 34.95 });
  });
  expect(await speeds(page)).toEqual([130, 130]);
});

test('the first leg of a fresh route uses the gistable default', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const mk = () => {
      state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'X' }, { lat: 32.2, lng: 34.9, name: 'Y' }];
      state.legs = []; syncLegs();
      return state.legs.map(l => l.flightSpeed);
    };
    const shipped = mk();
    NavAid.tuningDefaults.defaultLegSpeedKt.value = 135;   // as the live gist would
    const overridden = mk();
    NavAid.tuningDefaults.defaultLegSpeedKt.value = 90;
    return { shipped, overridden, registered: !!NavAid.tuningDefaults.defaultLegSpeedKt,
             grouped: NavAid.tuningGroups.some(g => g.keys.includes('defaultLegSpeedKt')) };
  });
  expect(r.shipped).toEqual([90]);
  expect(r.overridden).toEqual([135]);   // no longer a literal buried in newLeg()
  expect(r.registered).toBe(true);
  expect(r.grouped).toBe(true);
});

test('a mixed-speed route is not silently created by extending it', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.44, lng: 34.90, name: 'HADERA' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 110; l.outboundSpeed = 110; });
    state.waypoints.push({ lat: 32.70, lng: 35.57, name: 'LLIB' }); syncLegs();
    return new Set(state.legs.map(l => l.flightSpeed)).size;
  });
  expect(r).toBe(1);      // one aircraft, one speed across the whole plan
});

// The leg inspector's Speed field was the one editor that did not propagate: the
// flight-plan speed cell walks the new value down the legs still at the old one
// (propagateAlt), so editing the same number in two places gave two answers.
async function editLegSpeed(page, legIdx, val) {
  await page.evaluate(({ legIdx, val }) => {
    state.selected = { type: 'leg', index: legIdx };
    showInspector();
    const inp = [...document.querySelectorAll('#inspector input[type="number"]')][0];
    inp.value = String(val);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, { legIdx, val });
}

async function fourLegRoute(page) {
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'B' },
      { lat: 32.6, lng: 35.1, name: 'C' }, { lat: 32.9, lng: 35.4, name: 'D' }];
    state.legs = []; syncLegs();
  });
}

test('leg inspector speed propagates down the route, like the flight plan', async ({ page }) => {
  await boot(page);
  await fourLegRoute(page);
  await editLegSpeed(page, 0, 110);
  expect(await speeds(page)).toEqual([110, 110, 110]);
  // and the route then extends at that speed
  await page.evaluate(() => { state.waypoints.push({ lat: 33.1, lng: 35.6, name: 'E' }); syncLegs(); });
  expect(await speeds(page)).toEqual([110, 110, 110, 110]);
});

test('leg inspector speed stops at an intentional change downstream', async ({ page }) => {
  await boot(page);
  await fourLegRoute(page);
  await editLegSpeed(page, 2, 75);          // deliberately slower final leg
  await editLegSpeed(page, 0, 95);
  expect(await speeds(page)).toEqual([95, 95, 75]);
});

test('a mid-route inspector edit walks forward only', async ({ page }) => {
  await boot(page);
  await fourLegRoute(page);
  await editLegSpeed(page, 1, 130);
  expect(await speeds(page)).toEqual([90, 130, 130]);
});

test('an invalid inspector speed leaves the route untouched', async ({ page }) => {
  await boot(page);
  await fourLegRoute(page);
  await editLegSpeed(page, 0, 110);
  await editLegSpeed(page, 0, 0);           // rejected, and must not propagate a 0
  expect(await speeds(page)).toEqual([110, 110, 110]);
});
