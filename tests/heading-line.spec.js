// @ts-check
// Own-ship heading predictor: a line along the current track with cross-tick
// range marks at 2 / 5 / 10 NM. Shown for both live GPS location and the
// simulator own-ship; freezes on the last valid heading when GPS course goes
// null (zero groundspeed). See drawHeadingLine() in draw.js.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof drawOwnShip === 'function' && typeof map !== 'undefined'
    && typeof geo === 'function');
  await page.evaluate(() => map.setView([32.1, 34.9], 9));
}

test('predictor marks the line at 2 / 5 / 10 NM for the live own-ship', async ({ page }) => {
  await boot(page);
  const marks = await page.evaluate(() => {
    window.__headingLine = null;
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 90 };
    drawOwnShip(window.gpsOwn, window.gpsOwn.hdg);
    return window.__headingLine;
  });
  expect(marks).not.toBeNull();
  expect(marks.marks).toEqual([2, 5, 10]);
  expect(marks.heading).toBe(90);
});

test('also draws for the simulator own-ship', async ({ page }) => {
  await boot(page);
  const drawn = await page.evaluate(() => {
    window.__headingLine = null;
    window.simOn = true;
    window.simAircraft = { lat: 32.1, lng: 34.9, hdg: 270 };
    drawOwnShip(window.simAircraft, window.simAircraft.hdg);
    return window.__headingLine;
  });
  expect(drawn).not.toBeNull();
  expect(drawn.heading).toBe(270);
});

test('the 10 NM mark projects to a point 10 NM ahead on the heading', async ({ page }) => {
  await boot(page);
  // Re-derive the outermost mark geographically and check it against geo():
  // 10 NM at 090° from the own-ship should read ~10 NM / ~090° back.
  const out = await page.evaluate(() => {
    const pos = { lat: 32.1, lng: 34.9 };
    const hr = 90 * Math.PI / 180;
    const cosLat = Math.max(0.2, Math.cos(pos.lat * Math.PI / 180));
    const mark = {
      lat: pos.lat + (10 / 60) * Math.cos(hr),
      lng: pos.lng + (10 / 60) * Math.sin(hr) / cosLat,
    };
    return geo(pos, mark); // { dist, brg }
  });
  expect(out.dist).toBeCloseTo(10, 0);
  expect(out.brg).toBeGreaterThan(88);
  expect(out.brg).toBeLessThan(92);
});

test('keeps the last heading when the GPS course goes null (stationary)', async ({ page }) => {
  await boot(page);
  const frozen = await page.evaluate(() => {
    window.gpsLiveOn = true;
    // First a valid course…
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 135 };
    drawOwnShip(window.gpsOwn, window.gpsOwn.hdg);
    // …then a fix with no course (stationary).
    window.__headingLine = null;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: null };
    drawOwnShip(window.gpsOwn, null);
    return window.__headingLine;
  });
  expect(frozen).not.toBeNull();
  expect(frozen.heading).toBe(135); // frozen at the last valid course
});

test('draws nothing when there has never been a valid heading', async ({ page }) => {
  await boot(page);
  const none = await page.evaluate(() => {
    window.__headingLine = null;
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: null };
    drawOwnShip(window.gpsOwn, null);
    return window.__headingLine;
  });
  expect(none).toBeNull();
});
