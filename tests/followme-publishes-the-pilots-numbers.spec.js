// @ts-check
// What goes on the wire has to be the number in the cockpit.
//
// Reported from a flight: the follower saw a HIGHER altitude than the pilot. Both were right
// about their own arithmetic -- the aeroplane published the raw GNSS height, and the pilot's
// readout shows what an altimeter would: that height less the geoid undulation (~59 ft over
// Israel) and less the ISA temperature term. So the two of them quoted different altitudes for
// one aeroplane, by 60 ft on a standard day and a few hundred on a hot one.
//
// The second half of this file is the same class of bug found while tracing the first: the
// live-fix path stands down while a recording runs, and the recording path never published at
// all, so turning Record on mid-flight stopped the share with every control still saying it
// was running.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof onLivePosition === 'function'
    && typeof onGpsPosition === 'function' && !!(window.NavAid && NavAid.followMe));
  // Capture what would go out, without the relay: this is about the numbers, not the transport.
  await page.evaluate(() => {
    window.__published = [];
    NavAid.followMe.sharing = () => true;
    NavAid.followMe.publish = (fix) => { window.__published.push(fix); return Promise.resolve(); };
    window.gpsQnh = null;              // no temperature: the geoid term alone, deterministically
  });
}

test('the altitude published is the altitude the pilot is reading', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    window.gpsLiveOn = true;
    window.gpsRecording = false;
    onLivePosition({
      coords: { latitude: 32.1, longitude: 34.9, altitude: 1000, accuracy: 5, speed: 40, heading: 90 },
      timestamp: Date.now(),
    });
    await new Promise(r => setTimeout(r, 20));
    return { published: window.__published, shownFt: gpsAltitudeForCompare(), geoidFt: gpsGeoidFt() };
  });
  expect(got.published).toHaveLength(1);
  // Feet, as the cockpit rounded them: the follower prints this, it does not convert it.
  expect(got.published[0].af).toBe(Math.round(got.shownFt));
  // And that is the raw height LESS the geoid, not the raw height.
  expect(got.published[0].af).toBe(Math.round(1000 * 3.28084 - got.geoidFt));
  expect(got.published[0].af).toBeLessThan(Math.round(1000 * 3.28084));
  // Nothing in metres goes out at all any more: a unit the viewer would have to convert is a
  // unit the two screens can disagree in.
  expect(got.published[0].alt).toBe(undefined);
});

test('with the correction switched off, the raw height is what both of them read', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    setTune('altimetryCorrection', false);
    window.gpsLiveOn = true;
    window.gpsRecording = false;
    onLivePosition({
      coords: { latitude: 32.1, longitude: 34.9, altitude: 1000, accuracy: 5, speed: 40, heading: 90 },
      timestamp: Date.now(),
    });
    await new Promise(r => setTimeout(r, 20));
    return { published: window.__published, shownFt: gpsAltitudeForCompare() };
  });
  expect(got.published[0].af).toBe(Math.round(1000 * 3.28084));
  expect(got.published[0].af).toBe(Math.round(got.shownFt));
});

// A fix with no altitude at all (indoors, a phone that reports none) says so, rather than
// sending a zero a follower would read as "on the ground".
test('a fix with no altitude publishes none', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    window.gpsLiveOn = true;
    window.gpsRecording = false;
    onLivePosition({
      coords: { latitude: 32.1, longitude: 34.9, altitude: null, accuracy: 5, speed: 40, heading: 90 },
      timestamp: Date.now(),
    });
    await new Promise(r => setTimeout(r, 20));
    return window.__published;
  });
  expect(got).toHaveLength(1);
  expect(got[0].af).toBe(null);
});

test('a recording publishes too, and publishes the same corrected altitude', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    window.gpsRecording = true;
    window.gpsLiveOn = false;
    window.gpsTrack = [];
    onGpsPosition({
      coords: { latitude: 32.1, longitude: 34.9, altitude: 1000, accuracy: 5, speed: 40, heading: 90 },
      timestamp: Date.now(),
    });
    await new Promise(r => setTimeout(r, 20));
    return { published: window.__published, shownFt: gpsAltitudeForCompare(), geoidFt: gpsGeoidFt() };
  });
  expect(got.published, 'Record on = a share that goes quiet').toHaveLength(1);
  expect(got.published[0].af).toBe(Math.round(got.shownFt));
  expect(got.published[0].af).toBe(Math.round(1000 * 3.28084 - got.geoidFt));
});

// Both watches run when a pilot records with Location already on. The live one stands down so
// the two do not fight over the own-ship -- and the share must not stand down with it.
test('with both watches running, the recording is what keeps the share alive', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    window.gpsLiveOn = true;
    window.gpsRecording = true;
    window.gpsTrack = [];
    const p = { latitude: 32.1, longitude: 34.9, altitude: 1000, accuracy: 5, speed: 40, heading: 90 };
    onLivePosition({ coords: p, timestamp: Date.now() });      // stands down: recording owns the fix
    const afterLive = window.__published.length;
    onGpsPosition({ coords: p, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 20));
    return { afterLive, total: window.__published.length };
  });
  expect(got.afterLive).toBe(0);
  expect(got.total).toBe(1);
});

// The same rule for the ground speed. A device omits `speed` when it is stationary and some
// chipsets never report it at all; both fix paths then derive it from the last two positions
// so the readout keeps showing one. Publishing only the device field left a follower with no
// speed beside a cockpit reading 95 kt.
test('the ground speed published is the one the readout derived', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    window.gpsLiveOn = true;
    window.gpsRecording = false;
    const t0 = Date.now();
    // Two fixes a minute apart with NO device speed: the readout derives it, so the wire must.
    onLivePosition({ coords: { latitude: 32.0, longitude: 34.9, altitude: 300, accuracy: 5, speed: null, heading: 90 }, timestamp: t0 });
    onLivePosition({ coords: { latitude: 32.0, longitude: 35.0, altitude: 300, accuracy: 5, speed: null, heading: 90 }, timestamp: t0 + 60000 });
    await new Promise(r => setTimeout(r, 20));
    return { published: window.__published, shownKt: gpsLastGS };
  });
  const last = got.published[got.published.length - 1];
  expect(got.shownKt).toBeGreaterThan(0);          // the readout has a speed
  expect(last.kt).toBe(Math.round(got.shownKt));   // ...and so does the follower, the same one
});

// Magnetic is a conversion, and a conversion needs a variation. The viewer used its own, so a
// follower on ?nogist and a pilot on a tuned gist read different headings off one true track.
test('the magnetic heading is computed in the aeroplane, not on the ground', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    setTune('magVarAuto', false); setTune('magneticVariationDeg', -7);
    window.gpsLiveOn = true;
    window.gpsRecording = false;
    onLivePosition({ coords: { latitude: 32.1, longitude: 34.9, altitude: 300, accuracy: 5, speed: 40, heading: 90 }, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 20));
    const fix = window.__published[window.__published.length - 1];
    return { fix, cockpit: toMagnetic(90) };
  });
  // 90 true with 7 degrees of east variation: the aeroplane says 083, and says it in the packet.
  expect(got.fix.mh).toBe(83);
  expect(got.fix.mh).toBe(got.cockpit);
  // True goes too, but only as the geometry the follower's map points the icon with.
  expect(got.fix.trk).toBe(90);
  // The variation itself is nobody else's business: it was already applied.
  expect(got.fix.mv).toBe(undefined);
});

// Reported after the correction landed: 261 in the aeroplane, 262 on the ground. The altitude
// was right by then -- what was left was the wire's unit. A metre is 3.28 ft, so feet rounded
// into metres and converted back land a foot or two away. Feet go on the wire now.
test('the follower quotes the pilot\'s feet exactly, across the rounding cases', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const out = [];
    window.gpsLiveOn = true;
    window.gpsRecording = false;
    // A sweep, because the disagreement only shows at particular heights.
    for (let m = 80; m < 100; m += 1.7) {
      window.__published.length = 0;
      onLivePosition({ coords: { latitude: 32.1, longitude: 34.9, altitude: m, accuracy: 5, speed: 40, heading: 90 }, timestamp: Date.now() });
      const fix = window.__published[0];
      out.push({
        cockpit: Math.round(gpsAltitudeForCompare()),
        sent: fix.af,
        // What the old wire would have carried, and what it would have come back as.
        viaMetres: Math.round(Math.round(gpsAltitudeForCompare() / 3.28084) * 3.28084),
      });
    }
    return out;
  });
  for (const sample of got) expect(sample.sent).toBe(sample.cockpit);
  expect(got.some(sample => sample.viaMetres !== sample.cockpit),
    'the sweep never hit the rounding case').toBe(true);
});
