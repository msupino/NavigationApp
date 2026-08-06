// @ts-check
// The wind field follows map rotation. It used to be refused above 0° bearing, on the belief
// that leaflet-velocity "bakes a north-up screen grid" that cannot be re-placed. That was
// wrong: the library inverts every screen pixel with containerPointToLatLng and builds its
// u/v→screen Jacobian through latLngToContainerPoint, both of which account for bearing under
// leaflet-rotate. What it lacks is a rebuild trigger — its getEvents() has resize/moveend
// plus dragend/zoomstart/zoomend and nothing for rotate — so after a rotation the field kept
// the columns computed at the old bearing. Stale, not misplaced.
const { test, expect } = require('./_setup');

const OM_RE = /^https:\/\/api\.open-meteo\.com\//;

// A uniform 10 m/s from 270° (i.e. blowing due east) at every grid point and hour, so the
// field's screen vector is a direct read-out of how the layer maps geography to pixels.
function gridBody(url) {
  const day0 = new Date().toISOString().slice(0, 10);
  const day1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const time = [];
  for (let h = 0; h < 24; h++) time.push(day0 + 'T' + String(h).padStart(2, '0') + ':00');
  for (let h = 0; h < 24; h++) time.push(day1 + 'T' + String(h).padStart(2, '0') + ':00');
  const n = time.length;
  const lv = (String(url || '').match(/wind_speed_(\d+)hPa/) || [])[1] || '900';
  const hourly = { time };
  hourly['wind_speed_' + lv + 'hPa'] = new Array(n).fill(10);
  hourly['wind_direction_' + lv + 'hPa'] = new Array(n).fill(270);
  return JSON.stringify(new Array(600).fill({ hourly }));
}

async function bootWithField(page) {
  await page.route(OM_RE, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: gridBody(r.request().url()) }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && !!document.getElementById('windfield-cb'));
  await page.evaluate(() => {
    const cb = document.getElementById('windfield-cb');
    cb.checked = true; cb.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => !!document.querySelector('canvas.velocity-overlay'), null,
    { timeout: 20000 });
  await page.waitForTimeout(1500);
}

// The built field's screen vector at the canvas centre, plus how much ink the particle
// canvas actually carries.
const sample = page => page.evaluate(() => {
  let lyr = null;
  map.eachLayer(l => { if (l._windy) lyr = l; });
  if (!lyr || !lyr._windy || !lyr._windy.field) return { err: 'no field' };
  const canvas = document.querySelector('canvas.velocity-overlay');
  const cx = Math.round(canvas.width / 2), cy = Math.round(canvas.height / 2);
  let vec = null;
  try { vec = lyr._windy.field(cx, cy); } catch (e) { return { err: 'field threw' }; }
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 8) ink++;
  return { bearing: Math.round(map.getBearing ? map.getBearing() : 0),
    x: Math.round(vec[0] * 100) / 100, y: Math.round(vec[1] * 100) / 100,
    speed: Math.round(vec[2] * 100) / 100, ink };
});

async function rotate(page, deg) {
  await page.evaluate(d => { map.setBearing(d); }, deg);
  await page.waitForTimeout(2200);            // rotateend → settle → field rebuild
}

test('the field rotates with the map instead of going stale', async ({ page }) => {
  await bootWithField(page);
  const north = await sample(page);
  expect(north.err).toBeUndefined();
  // Wind from 270° blows east, which is +x on screen when the map is north-up.
  expect(north.x).toBeGreaterThan(1);
  expect(Math.abs(north.y)).toBeLessThan(1);

  await rotate(page, 90);
  const turned = await sample(page);
  expect(turned.err).toBeUndefined();
  expect(turned.bearing).toBe(90);
  // At 90° the same geographic wind must push particles along a different screen axis. This
  // is the whole bug: without a rebuild it stayed +x, i.e. the field showed the pre-rotation
  // pattern over a rotated chart.
  expect(Math.abs(turned.y)).toBeGreaterThan(1);
  expect(Math.abs(turned.x)).toBeLessThan(1);
  // Same wind speed, so the magnitude is unchanged — only its screen direction turned.
  expect(turned.speed).toBeCloseTo(north.speed, 1);
  // ...and it is still drawn across the viewport rather than pushed off it.
  expect(turned.ink).toBeGreaterThan(north.ink * 0.5);
});

test('the toggle stays available at any bearing', async ({ page }) => {
  await bootWithField(page);
  await rotate(page, 55);
  const s = await page.evaluate(() => {
    const cb = document.getElementById('windfield-cb');
    const note = document.getElementById('windfield-north-note');
    return { disabled: cb.disabled, checked: cb.checked,
      noteVisible: !!(note && !note.hidden),
      status: (document.getElementById('windfield-status') || {}).textContent || '' };
  });
  // No "north-up only" refusal any more: the field works, so nothing is disabled and no
  // apology is shown.
  expect(s.disabled).toBe(false);
  expect(s.checked).toBe(true);
  expect(s.noteVisible).toBe(false);
  expect(s.status).not.toMatch(/north-up/i);
});

test('rotating back and forth keeps the field alive', async ({ page }) => {
  await bootWithField(page);
  await rotate(page, 120);
  await rotate(page, 0);
  const back = await sample(page);
  expect(back.err).toBeUndefined();
  expect(back.bearing).toBe(0);
  expect(back.x).toBeGreaterThan(1);          // east again
  expect(back.ink).toBeGreaterThan(0);
});
