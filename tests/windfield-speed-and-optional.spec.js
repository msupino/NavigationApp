// @ts-check
// Two things about the wind field, both discovered while fixing its rotation:
//
//  1. leaflet-velocity scales particle speed by mapArea^0.4, taking mapArea from
//     map.getBounds() — the axis-aligned box of a ROTATED viewport, which grows with the
//     bearing even though the visible area does not. Measured on this map: 0.1216 deg² at 0°,
//     0.2814 at 45°, 0.1216 again at 90°, giving particles ~36% too fast at 45°. Direction
//     and position are fine and the colour ramp reads real m/s, so nothing a pilot READS is
//     wrong — the animation just overstates the wind.
//  2. leaflet-velocity was in the same "required script" list as Leaflet itself, so a blocked
//     jsdelivr blacked out the entire app behind "could not load a required component" — for
//     an optional animation. That is worse than the blank chart the overlay was added to fix.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const OM_RE = /^https:\/\/api\.open-meteo\.com\//;
const VELOCITY_RE = /^https:\/\/cdn\.jsdelivr\.net\/npm\/leaflet-velocity@/;

function gridBody(url) {
  const d0 = new Date().toISOString().slice(0, 10);
  const d1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const time = [];
  for (let h = 0; h < 24; h++) time.push(d0 + 'T' + String(h).padStart(2, '0') + ':00');
  for (let h = 0; h < 24; h++) time.push(d1 + 'T' + String(h).padStart(2, '0') + ':00');
  const lv = (String(url || '').match(/wind_speed_(\d+)hPa/) || [])[1] || '900';
  const hourly = { time };
  hourly['wind_speed_' + lv + 'hPa'] = new Array(time.length).fill(10);
  hourly['wind_direction_' + lv + 'hPa'] = new Array(time.length).fill(270);
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

// Magnitude of the field's screen vector at the canvas centre: velocityScale is baked into
// it, so this is a direct read-out of the animation speed.
async function screenMagnitude(page, bearing) {
  await page.evaluate(d => { map.setBearing(d); }, bearing);
  await page.waitForTimeout(2200);            // rotate → debounced rebuild → field ready
  return page.evaluate(() => {
    let lyr = null;
    map.eachLayer(l => { if (l._windy) lyr = l; });
    const c = document.querySelector('canvas.velocity-overlay');
    const v = lyr._windy.field(Math.round(c.width / 2), Math.round(c.height / 2));
    return { screen: Math.hypot(v[0], v[1]), data: v[2] };
  });
}

test('particle speed does not change with the map bearing', async ({ page }) => {
  await bootWithField(page);
  const at0 = await screenMagnitude(page, 0);
  const at45 = await screenMagnitude(page, 45);
  const at90 = await screenMagnitude(page, 90);
  // Same wind, so the same animation speed at every bearing. Unpatched this read
  // 12.66 / 17.26 / 12.66 — 1.36x too fast at 45°, correct at the right angles, because the
  // rotated bounding box is largest at the diagonals.
  expect(at0.data).toBeCloseTo(10, 1);
  expect(at45.screen / at0.screen).toBeCloseTo(1, 1);
  expect(at90.screen / at0.screen).toBeCloseTo(1, 1);
  // ...and the data speed the colour ramp uses is untouched throughout.
  expect(at45.data).toBeCloseTo(at0.data, 1);
});

test('the patch is applied to the library, not vendored around it', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app', 'ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
  // One overridden method, against the pinned CDN copy with its SRI hash — rather than a
  // 31 KB fork in the repo to change twelve lines.
  expect(ui).toContain('_startWindy');
  expect(ui).toMatch(/L\.VelocityLayer\s*&&\s*L\.VelocityLayer\.prototype/);
  expect(html).toMatch(/cdn\.jsdelivr\.net\/npm\/leaflet-velocity@/);
  expect(html).toMatch(/leaflet-velocity[^']*':\s*'sha384-/);      // SRI still pinned
  expect(fs.existsSync(path.join(__dirname, '..', 'docs', 'vendor'))).toBe(false);
  // It must degrade rather than throw if the library's shape ever changes.
  expect(ui).toMatch(/typeof proto\._startWindy !== 'function'/);
});

// --- the optional-script classification -------------------------------------------------
test('a blocked wind-field library does not black out the app', async ({ page }) => {
  await page.route(VELOCITY_RE, r => r.abort());
  await page.route(OM_RE, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: gridBody(r.request().url()) }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof state !== 'undefined');
  const r = await page.evaluate(() => {
    const cb = document.getElementById('windfield-cb');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    return {
      bootError: document.querySelectorAll('#boot-error').length,
      mapAlive: typeof map !== 'undefined' && !!map.getCenter,
      appAlive: typeof draw === 'function' && typeof showFlightPlan === 'function',
      optionalFailed: (window.__navOptionalScriptFailed || []).join(','),
      velocityMissing: typeof L.velocityLayer !== 'function',
    };
  });
  // The chart, the route tools and the plan all still work...
  expect(r.mapAlive).toBe(true);
  expect(r.appAlive).toBe(true);
  // ...and no full-screen "required component" overlay for an optional animation.
  expect(r.bootError).toBe(0);
  expect(r.velocityMissing).toBe(true);
  expect(r.optionalFailed).toMatch(/leaflet-velocity/);
  // The wind field itself reports itself unavailable, which is the honest outcome.
  await expect(page.locator('#windfield-status')).toBeVisible();
  await expect(page.locator('#windfield-status')).toContainText(/unavailable/i);
  await expect(page.locator('#windfield-cb')).not.toBeChecked();
});

test('a blocked REQUIRED script still blacks out the app', async ({ page }) => {
  // The distinction has to cut both ways, or the classification is just a way of hiding
  // failures: Leaflet is load-bearing, and its absence must still say so.
  await page.route(/^https:\/\/unpkg\.com\/leaflet@1\.9\.4/, r => r.abort());
  await page.goto('?lang=en&nogist');
  const alert = page.locator('#boot-error');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/could not load/i);
  expect(await alert.getAttribute('role')).toBe('alert');
});
