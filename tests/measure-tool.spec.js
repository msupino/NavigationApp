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

// A reload (refresh, APK restart, update) keeps the measurement on screen, without the hint.
test('the measurement survives a reload', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  await page.evaluate(() => {
    map.setView([32.0, 34.9], 10, { animate: false });
    measureToggle(true);
    measureTap(L.latLng(31.9, 34.8));
    measureTap(L.latLng(32.1, 35.0));
  });
  const before = await page.evaluate(() => window.__measureLabel);
  expect(before).toMatch(/NM/);
  await page.reload();
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  const r = await page.evaluate(() => ({ on: measureOn(), label: window.__measureLabel, pressed: document.getElementById('measure-btn').getAttribute('aria-pressed'),
    shown: !document.getElementById('measure-label')?.hidden }));
  expect(r).toEqual({ on: true, label: before, pressed: 'true', shown: true });
  await expect(page.locator('#toast-stack .toast').filter({ hasText: 'Tap the start' })).toHaveCount(0);
  // Turned off, it stays off after the next reload.
  await page.evaluate(() => measureToggle(false));
  await page.reload();
  await page.waitForFunction(() => typeof measureToggle === 'function');
  expect(await page.evaluate(() => measureOn())).toBe(false);
});
