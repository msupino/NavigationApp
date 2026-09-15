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

const M_PER_FT = 1 / 3.28084;

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
  // Metres on the wire, as they have always been -- viewers already in the air convert from them.
  expect(got.published[0].alt * 3.28084).toBeCloseTo(got.shownFt, 3);
  // And that is the raw height LESS the geoid, not the raw height.
  expect(got.published[0].alt).toBeCloseTo(1000 - got.geoidFt * M_PER_FT, 3);
  expect(got.published[0].alt).toBeLessThan(1000);
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
  expect(got.published[0].alt).toBeCloseTo(1000, 3);
  expect(got.published[0].alt * 3.28084).toBeCloseTo(got.shownFt, 3);
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
  expect(got[0].alt).toBe(null);
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
  expect(got.published[0].alt).toBeCloseTo(1000 - got.geoidFt / 3.28084, 3);
  expect(got.published[0].alt * 3.28084).toBeCloseTo(got.shownFt, 3);
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
  expect(last.kt).toBeCloseTo(got.shownKt, 3);     // ...and so does the follower
});

// Magnetic is a conversion, and a conversion needs a variation. The viewer used its own, so a
// follower on ?nogist and a pilot on a tuned gist read different headings off one true track.
test('the variation behind the pilot\'s heading travels with it', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    setTune('magneticVariationDeg', -7);
    window.gpsLiveOn = true;
    window.gpsRecording = false;
    onLivePosition({ coords: { latitude: 32.1, longitude: 34.9, altitude: 300, accuracy: 5, speed: 40, heading: 90 }, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 20));
    const fix = window.__published[window.__published.length - 1];
    // A viewer whose own gist says something else renders the PUBLISHER's number.
    setTune('magneticVariationDeg', -2);
    return { fix, withPublisher: gpsHeadingText(fix.trk, false, fix.mv), withOwn: gpsHeadingText(fix.trk, false) };
  });
  expect(got.fix.mv).toBe(-7);
  expect(got.withPublisher).toBe('083°');          // 90 true, 7°E variation
  expect(got.withOwn).toBe('088°');                // what the follower used to show instead
});

// Reported after the correction landed: 261 in the aeroplane, 262 on the ground. Nothing was
// wrong with the altitude any more -- it was the wire's own unit. A metre is 3.28 ft, so
// rounding feet into metres and converting back lands a foot or two away. The fix carries both:
// metres, which every older viewer converts from, and the cockpit's own rounded feet.
test('the follower quotes the pilot\'s feet, not feet rounded through metres', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const out = [];
    window.gpsLiveOn = true;
    window.gpsRecording = false;
    // Sweep a range of raw heights: somewhere in here is a value that rounds badly.
    for (let m = 80; m < 100; m += 1.7) {
      window.__published.length = 0;
      onLivePosition({ coords: { latitude: 32.1, longitude: 34.9, altitude: m, accuracy: 5, speed: 40, heading: 90 }, timestamp: Date.now() });
      const fix = window.__published[0];
      // What the wire carries, rounded the way the publisher rounds it...
      const wire = { alt: Math.round(fix.alt), af: Math.round(fix.af) };
      out.push({
        cockpit: Math.round(gpsAltitudeForCompare()),
        viaMetres: Math.round(wire.alt * 3.28084),
        viaFeet: wire.af,
      });
    }
    return out;
  });
  // Every sample: the feet field is exactly the cockpit's number.
  for (const s of got) expect(s.viaFeet).toBe(s.cockpit);
  // ...and at least one of them would have been off had the viewer gone through metres, which
  // is the bug this covers.
  expect(got.some(s => s.viaMetres !== s.cockpit), 'the sweep never hit the rounding case').toBe(true);
});
