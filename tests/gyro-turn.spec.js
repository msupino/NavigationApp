// @ts-check
// The phone's gyro gives the turn predictor a head start: GPS sees a turn only after a few
// seconds of course, the gyro the moment it changes. Fused as GPS + k * (gyro now - gyro mean
// over the GPS window), with k learned from clear turns; ignored until it is.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    // A controllable clock, so a flight's seconds pass instantly.
    window.__now = 1_800_000_000_000;
    const Real = Date.now.bind(Date);
    Date.now = () => (window.__now != null ? window.__now : Real());
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidGyro && typeof drawHeadingLine === 'function' && typeof map !== 'undefined');
  await page.evaluate(() => { map.setView([32.1, 34.9], 9); window.gpsLiveOn = true; });
}

// Calibration flying: four separate 10 s turns (the gyro reporting the opposite sign, as some
// platforms' axes do -- k has to learn that too), wings level in between.
const CALIBRATE = `(function (fly, st) {
  for (let i = 0; i < 4; i++) { fly(st, 10, 3, -3); fly(st, 10, 0, 0); }
})`;

// Fly `secs` seconds: a GPS fix every second at `rateDeg` of turn (the predictor's input), and
// gyro events every 100 ms reporting `gyroDeg` about the phone's up axis (flat phone).
const FLY = `(function (state, secs, rateDeg, gyroDeg) {
  const out = [];
  for (let s = 0; s < secs; s++) {
    for (let k = 0; k < 10; k++) {
      window.__now += 100;
      const e = new Event('devicemotion');
      Object.defineProperty(e, 'rotationRate', { value: { alpha: gyroDeg, beta: 0, gamma: 0 } });
      Object.defineProperty(e, 'accelerationIncludingGravity', { value: { x: 0, y: 0, z: 9.81 } });
      window.dispatchEvent(e);
    }
    state.h = ((state.h + rateDeg) % 360 + 360) % 360;
    drawHeadingLine({ lat: 32.1, lng: 34.9, t: window.__now }, state.h, 100,
      { trackKey: 'own', sampleTime: window.__now, receivedAt: window.__now });
    out.push({ curved: window.__headingLine.curved, rate: window.__headingLine.turnRate });
  }
  return out;
})`;

test('yaw rate is the rotation about the vertical the phone feels, however it is held', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const y = (rr, g) => NavAidGyro._yawFrom({ rotationRate: rr, accelerationIncludingGravity: g });
    return {
      flat: y({ alpha: 3, beta: 0, gamma: 0 }, { x: 0, y: 0, z: 9.81 }),
      upright: y({ alpha: 0, beta: 0, gamma: 3 }, { x: 0, y: 9.81, z: 0 }),
      tilted: y({ alpha: 3 * Math.cos(Math.PI / 4), beta: 0, gamma: 3 * Math.sin(Math.PI / 4) },
        { x: 0, y: 9.81 * Math.sin(Math.PI / 4), z: 9.81 * Math.cos(Math.PI / 4) }),
      noGravity: y({ alpha: 3, beta: 0, gamma: 0 }, { x: 0, y: 0, z: 0 }),
    };
  });
  expect(r.flat).toBeCloseTo(3, 5);
  expect(r.upright).toBeCloseTo(3, 5);
  expect(r.tilted).toBeCloseTo(3, 5);
  expect(r.noGravity).toBe(null);
});

test('uncalibrated, the gyro changes nothing', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async (fly) => {
    await NavAidGyro.start(); NavAidGyro.reset(); resetHeadingPredictor();
    const st = { h: 90 };
    eval(fly)(st, 6, 0, 0);                       // straight, gyro quiet
    return eval(fly)(st, 1, 0, -3).pop();         // gyro says turning, never calibrated
  }, FLY);
  expect(r.curved).toBe(false);
});

test('calibrated, the line bends at the roll-in and straightens at the roll-out -- before GPS sees either', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async ({ fly, cal }) => {
    await NavAidGyro.start(); NavAidGyro.reset(); resetHeadingPredictor();
    const st = { h: 90 };
    eval(cal)(eval(fly), st);
    const learned = NavAidGyro.state();
    eval(fly)(st, 8, 0, 0);                      // wings level long enough for GPS to agree
    const level = eval(fly)(st, 1, 0, 0).pop();
    // Roll in: the gyro sees it now; GPS still has a straight window.
    const rollIn = eval(fly)(st, 1, 0.1, -3).pop();
    // Established: GPS catches up.
    eval(fly)(st, 8, 3, -3);
    // Roll out: the gyro is quiet at once; the GPS window is still full of turn.
    const rollOut = eval(fly)(st, 1, 0, 0).pop();
    return { learned, level, rollIn, rollOut };
  }, { fly: FLY, cal: CALIBRATE });
  expect(r.learned.cal).toBe(4);                 // four turns, not forty fixes
  expect(r.learned.k).toBeLessThan(-0.8);        // learned: opposite sign, about the same size
  expect(r.learned.k).toBeGreaterThan(-1.2);
  expect(r.level.curved).toBe(false);
  expect(r.rollIn.curved).toBe(true);
  expect(r.rollIn.rate).toBeGreaterThan(2);
  expect(r.rollOut.curved).toBe(false);
});

test('switched off, or flying the simulator, the gyro is not used', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async ({ fly, cal }) => {
    await NavAidGyro.start(); NavAidGyro.reset(); resetHeadingPredictor();
    const st = { h: 90 };
    eval(cal)(eval(fly), st);
    setTune('livePredictorGyro', false);
    const off = eval(fly)(st, 1, 0, -3).pop();
    setTune('livePredictorGyro', true);
    eval(fly)(st, 8, 0, 0);
    window.simOn = true;
    const sim = eval(fly)(st, 1, 0, -3).pop();
    window.simOn = false;
    return { off, sim };
  }, { fly: FLY, cal: CALIBRATE });
  expect(r.off.curved).toBe(false);
  expect(r.sim.curved).toBe(false);
});

test('one long turn is not four: the gyro stays unused until it has seen separate turns', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async (fly) => {
    await NavAidGyro.start(); NavAidGyro.reset(); resetHeadingPredictor();
    const st = { h: 90 };
    eval(fly)(st, 40, 3, -3);                    // forty seconds, one turn
    const learned = NavAidGyro.state();
    eval(fly)(st, 8, 0, 0);
    return { learned, rollIn: eval(fly)(st, 1, 0.1, -3).pop() };
  }, FLY);
  expect(r.learned.cal).toBe(1);
  expect(r.rollIn.curved).toBe(false);
});
