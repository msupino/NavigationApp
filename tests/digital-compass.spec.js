// @ts-check
// Asked: "a compass at the bottom of the page that shows the direction when pressed -- a digital
// compass". Press and hold the map's rotation dial (bottom right): a large compass opens, turning
// with the phone, its heading magnetic in three digits. A tap still steps the chart and a drag
// still turns it.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.compass && typeof clearBootLoading === 'function');
  await page.evaluate(() => { clearBootLoading(); const t = document.getElementById('map-tour'); if (t) t.remove(); });
}
const hold = async (page, ms) => {
  const b = await page.locator('#rotate-dial').boundingBox();
  if (!b) throw new Error('no dial');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
};
const bearing = (page) => page.evaluate(() => Math.round(map.getBearing ? map.getBearing() : 0));

test('holding the dial opens the compass, and the release does not also turn the chart', async ({ page }) => {
  await boot(page);
  const before = await bearing(page);
  await hold(page, 800);
  await expect(page.locator('.compass-modal')).toBeVisible();
  expect(await bearing(page)).toBe(before);
  await expect(page.locator('.compass-deg')).toHaveText('---°');           // no reading yet
});

test('a short tap still steps the chart, and opens nothing', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setBearing(10));
  await hold(page, 80);
  await expect(page.locator('.compass-modal')).toHaveCount(0);
  expect(await bearing(page)).toBe(0);                                     // the tap squared it
});

test('the card turns with the phone; the heading reads magnetic, three digits, 360 not 000', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('compassSmoothing', 1); NavAid.compass.show(); });
  // Android: alpha counter-clockwise from north.
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { alpha: 265 })));
  await expect(page.locator('.compass-deg')).toHaveText('095°');
  expect(await page.locator('.compass-card').getAttribute('transform')).toContain('rotate(-95.0');
  // iOS: webkitCompassHeading, clockwise.
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { webkitCompassHeading: 0.2 })));
  await expect(page.locator('.compass-deg')).toHaveText('360°');
  await expect(page.locator('.compass-ref')).toHaveText('MAG');
});

test('smoothing takes the short way round north', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('compassSmoothing', 0.5); NavAid.compass.show(); });
  const h = await page.evaluate(() => {
    const send = (v) => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { webkitCompassHeading: v }));
    send(350); send(10);
    return Number(document.querySelector('.compass-modal').dataset.heading);
  });
  expect(h).toBe(0);                                  // halfway from 350 to 010 is 000, not 180
});

test('iPhone: the compass asks with a Start button, and says so when refused', async ({ page }) => {
  await page.addInitScript(() => {
    window.DeviceOrientationEvent = window.DeviceOrientationEvent || function () {};
    window.DeviceOrientationEvent.requestPermission = () => Promise.resolve(window.__answer || 'denied');
  });
  await boot(page);
  await page.evaluate(() => NavAid.compass.show());
  const start = page.locator('.compass-start');
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.locator('.compass-status')).toContainText('refused');
});

test('no sensor: the compass says so instead of showing a still card as if it worked', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => NavAid.compass.show());
  await expect(page.locator('.compass-status')).toContainText('No compass reading', { timeout: 5000 });
});

test('Hebrew: the window speaks Hebrew; switched off by the gist, holding does nothing', async ({ page }) => {
  await boot(page, 'he');
  await page.evaluate(() => NavAid.compass.show());
  await expect(page.locator('.compass-modal .modal-title')).toHaveText('מצפן');
  await expect(page.locator('.compass-ref')).toHaveText('מגנטי');
  await page.keyboard.press('Escape');
  await expect(page.locator('.compass-modal')).toHaveCount(0);
  await page.evaluate(() => setTune('featureCompass', false));
  await hold(page, 800);
  await expect(page.locator('.compass-modal')).toHaveCount(0);
});

test('iPhone app: the finger lifting at the end of the hold asks, so the compass starts with no Start button', async ({ page }) => {
  // The app's shell grants motion access without a prompt; WebKit still wants the request from a
  // tap, and the lift that ends the hold is one.
  await page.addInitScript(() => {
    window.DeviceOrientationEvent = window.DeviceOrientationEvent || function () {};
    window.__asked = 0;
    window.DeviceOrientationEvent.requestPermission = () => { window.__asked++; return Promise.resolve('granted'); };
  });
  await boot(page);
  await hold(page, 800);
  await expect(page.locator('.compass-modal')).toBeVisible();
  expect(await page.evaluate(() => window.__asked)).toBe(1);
  await expect(page.locator('.compass-start')).toBeHidden();
  await page.evaluate(() => { setTune('compassSmoothing', 1); window.dispatchEvent(Object.assign(new Event('deviceorientation'), { webkitCompassHeading: 45 })); });
  await expect(page.locator('.compass-deg')).toHaveText('045°');
});

test('a long press never steps the chart by 90°, even when the compass does not open', async ({ page }) => {
  // Reported: the long press counted as a 90° turn.
  await boot(page);
  await page.evaluate(() => { setTune('featureCompass', false); map.setBearing(0); });
  await hold(page, 800);
  expect(await bearing(page)).toBe(0);
  await expect(page.locator('.compass-modal')).toHaveCount(0);
});

test('heading up turns the card; north up keeps N up and turns the aircraft; the choice is kept', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('compassSmoothing', 1); NavAid.compass.show();
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { webkitCompassHeading: 70 })); });
  await expect(page.locator('.compass-modes button[data-mode="heading"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.compass-card').getAttribute('transform')).toContain('rotate(-70.0');
  expect(await page.locator('.compass-ac').getAttribute('transform')).toContain('rotate(0.0');
  await page.locator('.compass-modes button[data-mode="north"]').click();
  expect(await page.locator('.compass-card').getAttribute('transform')).toContain('rotate(0.0');
  expect(await page.locator('.compass-ac').getAttribute('transform')).toContain('rotate(70.0');
  await expect(page.locator('.compass-deg')).toHaveText('070°');          // same heading either way
  await page.reload();
  await page.waitForFunction(() => window.NavAid && NavAid.compass && typeof clearBootLoading === 'function');
  await page.evaluate(() => { clearBootLoading(); NavAid.compass.show(); });
  await expect(page.locator('.compass-modes button[data-mode="north"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Android Chrome: a permission call that answers by itself shows no iPhone message, and the compass just runs', async ({ page }) => {
  // Reported on Android web: "iPhone asks before reading the compass". Chrome on Android has the
  // call too; the events come without it.
  await page.addInitScript(() => {
    window.DeviceOrientationEvent = window.DeviceOrientationEvent || function () {};
    window.DeviceOrientationEvent.requestPermission = () => Promise.resolve('granted');
  });
  await boot(page);
  await page.evaluate(() => { setTune('compassSmoothing', 1); NavAid.compass.show();
    window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { alpha: 300 })); });
  await expect(page.locator('.compass-deg')).toHaveText('060°');
  await page.waitForTimeout(1500);
  await expect(page.locator('.compass-start')).toBeHidden();
  await expect(page.locator('.compass-status')).not.toContainText('iPhone');
});

test('a finger drifting a few pixels while held opens the compass and does not turn the map', async ({ page }) => {
  // Reported on Android: the long press still rotated the map -- the finger's small drift was
  // taken for a drag, which turns the chart to the finger's angle.
  await boot(page);
  await page.evaluate(() => map.setBearing(0));
  const r = await page.evaluate(async () => {
    const d = document.getElementById('rotate-dial');
    const b = d.getBoundingClientRect();
    const x = b.left + b.width / 2 + 2, y = b.top + 3;     // near the top edge, like a thumb
    const ev = (type, dx, dy) => d.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x + dx, clientY: y + dy, isPrimary: true }));
    ev('pointerdown', 0, 0);
    for (const [dx, dy] of [[3, 1], [-6, 8], [11, -4], [2, 13]]) { await new Promise(r => setTimeout(r, 120)); ev('pointermove', dx, dy); }
    await new Promise(r => setTimeout(r, 400));
    ev('pointerup', 2, 13);
    return Math.round(map.getBearing());
  });
  expect(r).toBe(0);
  await expect(page.locator('.compass-modal')).toBeVisible();
});

test('source: magnetic, true (with the app\'s variation) or the GPS track; kept on the device', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('compassSmoothing', 1); NavAid.compass.show();
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { webkitCompassHeading: 100 })); });
  await expect(page.locator('.compass-deg')).toHaveText('100°');
  await expect(page.locator('.compass-ref')).toHaveText('MAG');
  await page.locator('.compass-sources button[data-source="true"]').click();
  const want = await page.evaluate(() => String(Math.round(fromMagnetic(100)) % 360).padStart(3, '0') + '°');
  await expect(page.locator('.compass-deg')).toHaveText(want);
  await expect(page.locator('.compass-ref')).toHaveText('TRUE');
  // GPS track: nothing until a fresh fix says the aircraft is moving.
  await page.locator('.compass-sources button[data-source="gps"]').click();
  await expect(page.locator('.compass-deg')).toHaveText('---°');
  await expect(page.locator('.compass-status')).toContainText('GPS track needs');
  await page.evaluate(() => { new Function('gpsOwn = { lat: 32, lng: 35, hdg: 200, t: Date.now(), hdgCompass: false }; gpsLastGS = 90;')(); });
  const gpsWant = await page.evaluate(() => String(Math.round(toMagnetic(200)) % 360).padStart(3, '0') + '°');
  await expect(page.locator('.compass-deg')).toHaveText(gpsWant, { timeout: 3000 });
  await expect(page.locator('.compass-ref')).toHaveText('GPS TRK');
  // The sensor does not override the GPS track.
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { webkitCompassHeading: 10 })));
  await expect(page.locator('.compass-deg')).toHaveText(gpsWant);
  await page.reload();
  await page.waitForFunction(() => window.NavAid && NavAid.compass && typeof clearBootLoading === 'function');
  await page.evaluate(() => { clearBootLoading(); NavAid.compass.show(); });
  await expect(page.locator('.compass-sources button[data-source="gps"]')).toHaveAttribute('aria-pressed', 'true');
});
