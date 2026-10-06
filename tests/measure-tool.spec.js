// @ts-check
// The ruler: tap a point and read its distance, magnetic bearing and -- moving -- the time at the
// current ground speed, from the aircraft, without putting anything on the route.
const { test, expect } = require('./_setup');

async function boot(page, w = 1000, h = 700) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && typeof onLivePosition === 'function');
  await page.evaluate(() => map.setView([32.05, 34.95], 10, { animate: false }));
}
// The ruler works from a position (Location, recording, simulator); the tests give it a
// simulated aircraft at lat/lng, standing still, with the route not locked by it.
const SIM = (lat, lng) => `simOn = true; simAircraft = { lat: ${lat}, lng: ${lng}, alt: 300, hdg: 0, ias: 0 }; window.editUnlockOverride = true;`;
const fly = (page, lat, lng) => page.evaluate(SIM(lat, lng));
const at = (page, lat, lng) => page.evaluate(([a, c]) => {
  const q = map.latLngToContainerPoint([a, c]); const r = map.getContainer().getBoundingClientRect();
  return { x: r.left + q.x, y: r.top + q.y };
}, [lat, lng]);

test('live: from the aircraft, with distance, bearing and time at the ground speed; nothing added', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    new Function('gpsLiveOn = true; gpsFollow = false')();
    onLivePosition({ timestamp: Date.now(), coords: { latitude: 32.18, longitude: 34.83, accuracy: 5, speed: 56.6, heading: 135, altitude: 600 } });
  });
  await page.locator('#measure-btn').click();
  await expect(page.locator('#measure-btn')).toHaveAttribute('aria-pressed', 'true');
  const t = await at(page, 31.99, 35.05);
  await page.mouse.click(t.x, t.y);
  await expect.poll(() => page.evaluate(() => window.__measureLabel || '')).toMatch(/NM · \d{3}° \| \d+ min at 110 kt/);
  expect(await page.evaluate(() => ({ wps: state.waypoints.length, insp: !document.getElementById('inspector').classList.contains('hidden') })))
    .toEqual({ wps: 0, insp: false });
  // Off again: the line goes.
  await page.locator('#measure-btn').click();
  expect(await page.evaluate(() => window.measure.on)).toBe(false);
});

test('no position: the ruler is dimmed and says why; a position lights it', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#measure-btn')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#measure-btn').click({ force: true });     // dimmed, still tappable
  expect(await page.evaluate(() => window.measure.on)).toBe(false);
  await expect(page.locator('#toast-stack .toast').filter({ hasText: 'turn on Location' }).first()).toBeAttached();
  await fly(page, 32.18, 34.83);
  await page.evaluate(() => draw());
  await expect(page.locator('#measure-btn')).not.toHaveAttribute('aria-disabled', 'true');
  await page.locator('#measure-btn').click();
  expect(await page.evaluate(() => measureOn())).toBe(true);
  // The position stops: measuring stops being in force (nothing drawn, the ruler dims), and comes
  // back with the position.
  await page.evaluate(() => { measureTap(L.latLng(31.99, 35.05)); simOn = false; draw(); });
  expect(await page.evaluate(() => ({ on: measureOn(), body: document.body.classList.contains('measuring'), label: !document.getElementById('measure-label').hidden })))
    .toEqual({ on: false, body: false, label: false });
  await page.evaluate(() => { simOn = true; draw(); });
  expect(await page.evaluate(() => measureOn() && !document.getElementById('measure-label').hidden)).toBe(true);
});

test('a tap on a route waypoint measures to it instead of selecting it', async ({ page }) => {
  await boot(page);
  await fly(page, 32.05, 34.95);
  await page.evaluate(() => { state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 31.99, lng: 35.05, name: 'B' }]; syncLegs(); draw(); });
  await page.locator('#measure-btn').click();
  const b = await at(page, 31.99, 35.05);
  await page.mouse.click(b.x, b.y);
  expect(await page.evaluate(() => ({ sel: state.selected, n: state.waypoints.length, to: !!window.measure.to }))).toEqual({ sel: null, n: 2, to: true });
});

test('the time line reads in Hebrew', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof measureEteText === 'function');
  expect(await page.evaluate(() => [measureEteText(16, 110), measureEteText(150, 100), measureEteText(5, 3)]))
    .toEqual(['9 דק׳ ב-110 קשר', '1 ש׳ 30 דק׳ ב-100 קשר', '']);
});

// Zoomed out, the airfield and waypoint symbols piled on the label and hid it: it was painted
// on the overlay canvas, under the markers. On screen it is now a box above them.
test('zoomed out, the measure label sits above the chart symbols', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  const r = await page.evaluate(() => {
    map.setView([32.0, 34.9], 6, { animate: false });
    simOn = true; simAircraft = { lat: 31.5, lng: 34.8, alt: 300, hdg: 0, ias: 0 }; measureToggle(true);
    window.measure.to = L.latLng(32.6, 35.1);
    draw();
    const el = document.getElementById('measure-label');
    const b = el.getBoundingClientRect();
    return { text: el.textContent, visible: !el.hidden && b.width > 0 };
  });
  expect(r.text).toMatch(/68 NM/);
  expect(r.visible).toBe(true);
  // Above the markers (600) and their tooltips (650).
  const z = await page.evaluate(() => Number(getComputedStyle(document.getElementById('measure-label')).zIndex));
  expect(z).toBeGreaterThan(650);
  await page.evaluate(() => measureToggle(false));
  await expect(page.locator('#measure-label')).toBeHidden();
});

// The end point off screen: the label stays on the line, where it leaves the screen, instead of
// pinned to an edge away from it. With none of the line on screen there is no label.
test('with the point off screen, the label sits where the line leaves the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  const r = await page.evaluate(() => {
    map.setView([32.0, 34.9], 10, { animate: false });
    simOn = true; simAircraft = { lat: 32.0, lng: 34.9, alt: 300, hdg: 0, ias: 0 };   // centre of the screen
    measureToggle(true);
    window.measure.to = L.latLng(32.6, 35.6);             // far off to the north-east
    draw();
    const el = document.getElementById('measure-label');
    const lb = el.getBoundingClientRect();
    const a = map.latLngToContainerPoint(measureLiveFrom()), b = map.latLngToContainerPoint(window.measure.to);
    // Distance from the label box to the line a->b, sampled along the on-screen part.
    let best = Infinity;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const dx = Math.max(lb.left - x, 0, x - lb.right), dy = Math.max(lb.top - y, 0, y - lb.bottom);
      best = Math.min(best, Math.hypot(dx, dy));
    }
    const shown = { visible: !el.hidden, inside: lb.left >= 0 && lb.top >= 0 && lb.right <= innerWidth && lb.bottom <= innerHeight, gap: Math.round(best) };
    // Now none of the line on screen.
    map.setView([31.0, 34.6], 12, { animate: false }); draw();
    return { ...shown, hiddenOff: el.hidden };
  });
  expect(r.visible).toBe(true);
  expect(r.inside).toBe(true);
  expect(r.gap).toBeLessThan(30);
  expect(r.hiddenOff).toBe(true);
});

// Reported on a phone: east, west and south worked, north did not -- the line left the screen
// under the top strip, and the label went under it too. And due east the line leaves through
// the button column; the label slides back along the line rather than sit on the buttons.
test.describe('phone: the label is in the seen map, clear of the strip, bar and buttons', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  for (const [dir, to] of [['north', [33.6, 34.9]], ['east', [32.0, 36.4]], ['south', [30.4, 34.9]], ['west', [32.0, 33.4]]]) {
    test(dir, async ({ page }) => {
      await page.goto('?lang=en&nogist');
      await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone && document.body.classList.contains('deck-on'));
      const r = await page.evaluate((to) => {
        map.setView([32.0, 34.9], 10, { animate: false });
        simOn = true; simAircraft = { lat: 32.0, lng: 34.9, alt: 300, hdg: 0, ias: 0 };
        measureToggle(true);
        window.measure.to = L.latLng(to[0], to[1]);
        draw();
        const el = document.getElementById('measure-label'), lb = el.getBoundingClientRect();
        const over = (q) => { const r = q.getBoundingClientRect(); return lb.left < r.right && lb.right > r.left && lb.top < r.bottom && lb.bottom > r.top; };
        const chrome = ['#deck-strip', '#deck-bar'].map(s => document.querySelector(s)).filter(Boolean);
        const buttons = [...document.querySelectorAll('.leaflet-control-container .leaflet-control')].filter(e => e.getClientRects().length);
        const a = map.latLngToContainerPoint(measureLiveFrom()), b = map.latLngToContainerPoint(window.measure.to);
        let gap = Infinity;
        for (let i = 0; i <= 400; i++) {
          const t = i / 400, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
          const dx = Math.max(lb.left - x, 0, x - lb.right), dy = Math.max(lb.top - y, 0, y - lb.bottom);
          if (x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight) gap = Math.min(gap, Math.hypot(dx, dy));
        }
        return { shown: !el.hidden, underChrome: chrome.some(over), onButtons: buttons.filter(over).map(e => e.className.split(' ')[1]), gap: Math.round(gap) };
      }, to);
      expect(r.shown).toBe(true);
      expect(r.underChrome).toBe(false);
      expect(r.onButtons).toEqual([]);
      expect(r.gap).toBeLessThan(30);
    });
  }
});

// Picking a measure point: the crosshair, over the chart and over a marker or NOTAM area alike
// (it was the pointing hand there).
test('measuring shows the crosshair, not the hand', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  await fly(page, 32.05, 34.95);
  const r = await page.evaluate(() => {
    measureToggle(true);
    const c = map.getContainer();
    c.style.cursor = 'pointer';                            // as a NOTAM hover leaves it
    map.fire('mousemove', { latlng: map.getCenter(), containerPoint: L.point(10, 10), originalEvent: new MouseEvent('mousemove') });
    const marker = document.querySelector('#map .leaflet-marker-icon, #map .leaflet-interactive');
    return { map: getComputedStyle(c).cursor, marker: marker ? getComputedStyle(marker).cursor : 'crosshair' };
  });
  expect(r).toEqual({ map: 'crosshair', marker: 'crosshair' });
});

// The label sits at the middle of the line in view, even when the end point is on screen too.
test('with both ends in view the label sits at the middle of the line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  const r = await page.evaluate(() => {
    map.setView([32.0, 34.9], 10, { animate: false });
    simOn = true; simAircraft = { lat: 31.9, lng: 34.75, alt: 300, hdg: 0, ias: 0 }; measureToggle(true);
    window.measure.to = L.latLng(32.1, 35.05);
    draw();
    const lb = document.getElementById('measure-label').getBoundingClientRect();
    const a = map.latLngToContainerPoint(measureLiveFrom()), b = map.latLngToContainerPoint(window.measure.to);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = Math.max(lb.left - mid.x, 0, mid.x - lb.right), dy = Math.max(lb.top - mid.y, 0, mid.y - lb.bottom);
    return { gapToMid: Math.round(Math.hypot(dx, dy)), toEnd: Math.round(Math.hypot(lb.left + lb.width / 2 - b.x, lb.top + lb.height / 2 - b.y)), len: Math.round(Math.hypot(b.x - a.x, b.y - a.y)) };
  });
  expect(r.gapToMid).toBeLessThan(20);           // its corner is at the line's midpoint
  expect(r.toEnd).toBeGreaterThan(r.len / 4);    // not at the end dot
});

// A reload (refresh, APK restart, update) keeps the measurement on screen, without the hint.
test('the measurement survives a reload', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  await fly(page, 31.9, 34.8);
  await page.evaluate(() => {
    map.setView([32.0, 34.9], 10, { animate: false });
    measureToggle(true);
    measureTap(L.latLng(32.1, 35.0));
  });
  const before = await page.evaluate(() => window.__measureLabel);
  expect(before).toMatch(/NM/);
  await page.reload();
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  // Kept while the position is not back yet, and drawn as soon as it is.
  await expect.poll(() => page.evaluate(() => window.measure.on)).toBe(true);
  await fly(page, 31.9, 34.8);
  await page.evaluate(() => { map.setView([32.0, 34.9], 10, { animate: false }); draw(); });
  const r = await page.evaluate(() => ({ on: measureOn(), label: window.__measureLabel, pressed: document.getElementById('measure-btn').getAttribute('aria-pressed'),
    shown: !document.getElementById('measure-label').hidden }));
  expect(r).toEqual({ on: true, label: before, pressed: 'true', shown: true });
  await expect(page.locator('#toast-stack .toast').filter({ hasText: 'Tap a point' })).toHaveCount(0);
  // Turned off, it stays off after the next reload.
  await page.evaluate(() => measureToggle(false));
  await page.reload();
  await page.waitForFunction(() => typeof measureToggle === 'function');
  expect(await page.evaluate(() => window.measure.on)).toBe(false);
});

// One map tool at a time: the ruler and Add / Note never both take the tap.
test('measuring and adding exclude each other', async ({ page }) => {
  await page.addInitScript(() => { window.__navaidTune = Object.assign(window.__navaidTune || {}, { featureRouteIntro: true }); });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  await fly(page, 32.05, 34.95);
  const r = await page.evaluate(() => {
    const out = {};
    setMode('add');
    measureToggle(true);
    out.afterMeasure = { mode: state.mode, measuring: measureOn(), addLit: document.getElementById('edit-col-add').getAttribute('aria-pressed') };
    setMode('note');
    out.afterNote = { mode: state.mode, measuring: measureOn(), ruler: document.getElementById('measure-btn').getAttribute('aria-pressed') };
    setMode(null);
    // An empty map primed to start a route: measuring takes the tap, and Add is not shown lit.
    state.waypoints = []; state.notes = []; syncLegs(); draw();
    measureToggle(true);
    out.primed = { armed: routePrimingArmed(), toolAdd: document.getElementById('tool-add').classList.contains('active') };
    map.fire('click', { latlng: L.latLng(32.0, 34.9) });
    out.tap = { wps: state.waypoints.length, measured: !!window.measure.to };
    return out;
  });
  expect(r.afterMeasure).toEqual({ mode: null, measuring: true, addLit: 'false' });
  expect(r.afterNote).toEqual({ mode: 'note', measuring: false, ruler: 'false' });
  expect(r.primed).toEqual({ armed: false, toolAdd: false });
  expect(r.tap).toEqual({ wps: 0, measured: true });
});

// Clear map takes the measurement with it, and with only a measurement on the map Clear is live.
test('Clear map removes the measurement', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  await fly(page, 31.9, 34.8);
  await page.evaluate(() => {
    state.waypoints = []; state.notes = []; syncLegs(); draw();
    measureToggle(true); measureTap(L.latLng(32.1, 35.0));
  });
  await expect(page.locator('#edit-col-clear')).not.toHaveAttribute('aria-disabled', 'true');
  await page.locator('#edit-col-clear').click();
  await expect.poll(() => page.evaluate(() => measureOn())).toBe(false);
  await expect(page.locator('#measure-label')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('navaid.measure'))).toBeNull();
});
