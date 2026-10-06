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
