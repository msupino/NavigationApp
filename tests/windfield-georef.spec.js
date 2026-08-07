// @ts-check
// Reported: the particle field is drawn well south of where that wind actually is — the
// streamlines start below LOT even though the grid runs to 33.45N, north of BGN.
//
// Canvas geometry alone cannot catch this: the canvas can sit perfectly over the map while
// the EXTENT handed to _windy.start describes a different patch of ground, in which case the
// data is sampled at the wrong latitude and painted shifted. So vary the wind BY LATITUDE and
// check that the speed read at a screen point matches the speed at that point's real latitude.
const { test, expect } = require('./_setup');

const OM_RE = /^https:\/\/api\.open-meteo\.com\//;
const NORTH = 33.45, SOUTH = 29.45;

// Speed encodes latitude: 5 m/s at the grid's south edge rising to 45 m/s at its north edge.
function speedForLat(lat) {
  return 5 + 40 * ((lat - SOUTH) / (NORTH - SOUTH));
}

function gridBody(url, lats) {
  const d0 = new Date().toISOString().slice(0, 10);
  const d1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const time = [];
  for (let h = 0; h < 24; h++) time.push(d0 + 'T' + String(h).padStart(2, '0') + ':00');
  for (let h = 0; h < 24; h++) time.push(d1 + 'T' + String(h).padStart(2, '0') + ':00');
  const lv = (String(url || '').match(/wind_speed_(\d+)hPa/) || [])[1] || '900';
  // open-meteo returns one object per requested coordinate, in request order.
  return JSON.stringify(lats.map(lat => {
    const hourly = { time };
    hourly['wind_speed_' + lv + 'hPa'] = new Array(time.length).fill(speedForLat(lat));
    hourly['wind_direction_' + lv + 'hPa'] = new Array(time.length).fill(270);
    return { hourly };
  }));
}

test('the wind drawn at a screen point is the wind at that point on the ground', async ({ page }) => {
  await page.route(OM_RE, r => {
    const u = new URL(r.request().url());
    const lats = (u.searchParams.get('latitude') || '').split(',').map(Number);
    r.fulfill({ status: 200, contentType: 'application/json', body: gridBody(r.request().url(), lats) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && !!document.getElementById('windfield-cb'));
  await page.evaluate(() => {
    const cb = document.getElementById('windfield-cb');
    cb.checked = true; cb.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => !!document.querySelector('canvas.velocity-overlay'), null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    let lyr = null;
    map.eachLayer(l => { if (l._windy) lyr = l; });
    const c = document.querySelector('canvas.velocity-overlay');
    const out = [];
    // Sample down the middle of the canvas: for each screen point, what the field says, and
    // what latitude that point really is.
    for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const x = Math.round(c.width / 2), y = Math.round(c.height * fy);
      let v = null;
      try { v = lyr._windy.field(x, y); } catch (e) { /* off-grid */ }
      const ll = map.containerPointToLatLng([x, y]);
      out.push({ fy, lat: ll.lat, drawn: v && v[2] });
    }
    return { out, zoom: map.getZoom(), bearing: map.getBearing ? map.getBearing() : 0 };
  });

  const S = 29.45, N = 33.45;
  const expected = lat => 5 + 40 * ((lat - S) / (N - S));
  for (const s of r.out) {
    if (s.drawn === null || s.drawn === undefined) continue;   // outside the grid is fine
    if (s.lat < S || s.lat > N) continue;
    // Read the wind at a point, ask what latitude that point is, and the two must agree.
    // A shifted extent shows up here as a consistent offset in the implied latitude.
    const impliedLat = S + (s.drawn - 5) / 40 * (N - S);
    expect(Math.abs(impliedLat - s.lat),
      `at ${Math.round(s.fy * 100)}% down the canvas the map says ${s.lat.toFixed(2)}N but the ` +
      `field drew ${s.drawn.toFixed(1)} m/s, which is the wind at ${impliedLat.toFixed(2)}N`)
      .toBeLessThan(0.2);
  }
});
