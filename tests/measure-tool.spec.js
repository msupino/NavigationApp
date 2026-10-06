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

test('not live: the first tap is the start, the second the end; no time without a ground speed', async ({ page }) => {
  await boot(page);
  await page.locator('#measure-btn').click();
  const a = await at(page, 32.18, 34.83), b = await at(page, 31.99, 35.05);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  const label = await page.evaluate(() => window.__measureLabel || '');
  expect(label).toMatch(/1\d NM · 1\d\d°/);
  expect(label).not.toMatch(/min at/);
});

test('a tap on a route waypoint measures to it instead of selecting it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 31.99, lng: 35.05, name: 'B' }]; syncLegs(); draw(); });
  await page.locator('#measure-btn').click();
  const a = await at(page, 32.18, 34.83), b = await at(page, 31.99, 35.05);
  await page.mouse.click(a.x, a.y);
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
    measureToggle(true);
    window.measure.from = L.latLng(31.5, 34.8); window.measure.to = L.latLng(32.6, 35.1);
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
    measureToggle(true);
    window.measure.from = L.latLng(32.0, 34.9);           // centre of the screen
    window.measure.to = L.latLng(32.6, 35.6);             // far off to the north-east
    draw();
    const el = document.getElementById('measure-label');
    const lb = el.getBoundingClientRect();
    const a = map.latLngToContainerPoint(window.measure.from), b = map.latLngToContainerPoint(window.measure.to);
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
        measureToggle(true);
        window.measure.from = L.latLng(32.0, 34.9); window.measure.to = L.latLng(to[0], to[1]);
        draw();
        const el = document.getElementById('measure-label'), lb = el.getBoundingClientRect();
        const over = (q) => { const r = q.getBoundingClientRect(); return lb.left < r.right && lb.right > r.left && lb.top < r.bottom && lb.bottom > r.top; };
        const chrome = ['#deck-strip', '#deck-bar'].map(s => document.querySelector(s)).filter(Boolean);
        const buttons = [...document.querySelectorAll('.leaflet-control-container .leaflet-control')].filter(e => e.getClientRects().length);
        const a = map.latLngToContainerPoint(window.measure.from), b = map.latLngToContainerPoint(window.measure.to);
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
    measureToggle(true);
    window.measure.from = L.latLng(31.9, 34.75); window.measure.to = L.latLng(32.1, 35.05);
    draw();
    const lb = document.getElementById('measure-label').getBoundingClientRect();
    const a = map.latLngToContainerPoint(window.measure.from), b = map.latLngToContainerPoint(window.measure.to);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = Math.max(lb.left - mid.x, 0, mid.x - lb.right), dy = Math.max(lb.top - mid.y, 0, mid.y - lb.bottom);
    return { gapToMid: Math.round(Math.hypot(dx, dy)), toEnd: Math.round(Math.hypot(lb.left + lb.width / 2 - b.x, lb.top + lb.height / 2 - b.y)), len: Math.round(Math.hypot(b.x - a.x, b.y - a.y)) };
  });
  expect(r.gapToMid).toBeLessThan(20);           // its corner is at the line's midpoint
  expect(r.toEnd).toBeGreaterThan(r.len / 4);    // not at the end dot
});
