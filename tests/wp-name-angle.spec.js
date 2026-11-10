// @ts-check
// Asked: "make each wp label match the base of the nav arrow -- if it points 270, the label should
// be 360-180, regardless of the map orientation", "so when I rotate a printed map, the text is
// always aligned with the nav kite arrow", "with a checkbox ... default on". Each waypoint's name
// is drawn at its next kite's figure angle (the leg leaving it); the last waypoint, the last kite.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__texts = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, w) {
      if (window.__logTexts) {
        const m = this.getTransform();
        window.__texts.push({ text: String(text), deg: ((Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI) % 360) + 360) % 360 });
      }
      return w === undefined ? orig.call(this, text, x, y) : orig.call(this, text, x, y, w);
    };
    try { localStorage.setItem('navaid.tourSeen', '1'); } catch (e) {}
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof window.wpNameAngle === 'function');
  await page.evaluate(() => {
    document.getElementById('boot-loading')?.remove();
    // North to south, then west, then east: three leg directions.
    state.waypoints = [{ lat: 32.80, lng: 35.00, name: 'NORTHA' }, { lat: 32.40, lng: 35.00, name: 'SOUTHB' },
                       { lat: 32.40, lng: 34.70, name: 'WESTC' }, { lat: 32.40, lng: 35.30, name: 'EASTD' }];
    syncLegs(); for (const l of state.legs) { l.flightSpeed = 90; l.inboundAltitude = 2000 + 500 * state.legs.indexOf(l); }
    map.setView([32.6, 35.0], 9, { animate: false }); draw();
  });
}
// The angle each name, and each leg's altitude figure in its kite, was drawn at.
const read = (page) => page.evaluate(() => {
  window.__texts = []; window.__logTexts = true; draw(); window.__logTexts = false;
  const at = (t) => (window.__texts.find(x => x.text === t) || {}).deg;
  return { names: ['NORTHA', 'SOUTHB', 'WESTC', 'EASTD'].map(at), kites: ['2000', '2500', '3000'].map(at) };
});

test('each name lies along its next kite; the last waypoint along the last kite', async ({ page }) => {
  await boot(page);
  const r = await read(page);
  // Kites: leg 0 runs south, leg 1 west, leg 2 east.
  expect(r.kites).toEqual([180, 270, 90]);
  // A name reads like the next kite (the leg leaving it); the last waypoint like the last kite.
  expect(r.names).toEqual([r.kites[0], r.kites[1], r.kites[2], r.kites[2]]);
  // "If it points 270, the label 360-180": SOUTHB's next arrow points 270, its name runs N-S.
  expect(r.names[1] % 180).toBe(90);
});

test('regardless of the map orientation: a turned map turns the names with the kites', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    if (typeof map.setBearing !== 'function') return null;
    map.setBearing(30); draw();
    window.__texts = []; window.__logTexts = true; draw(); window.__logTexts = false;
    const at = (t) => (window.__texts.find(x => x.text === t) || {}).deg;
    const out = { names: ['NORTHA', 'SOUTHB', 'WESTC'].map(at), kites: ['2000', '2500', '3000'].map(at) };
    map.setBearing(0);
    return out;
  });
  test.skip(r === null, 'no map rotation in this build');
  expect(r.names).toEqual(r.kites);
});

test('the checkbox: on by default, off draws the names level, and the choice is kept', async ({ page }) => {
  await boot(page);
  const cb = page.locator('#wpname-angle-cb');
  expect(await cb.evaluate(el => el.checked)).toBe(true);
  await cb.evaluate(el => { el.checked = false; el.dispatchEvent(new Event('change')); });
  expect((await read(page)).names).toEqual([0, 0, 0, 0]);
  expect(await page.evaluate(() => localStorage.getItem('navaid.autoWpNameAngle'))).toBe('0');
  await page.reload();
  await page.waitForFunction(() => typeof window.wpNameAngle === 'function');
  expect(await page.locator('#wpname-angle-cb').evaluate(el => el.checked)).toBe(false);
});

// Asked: "works on hidden nav kite as well? like inside a CTR". The angle is the leg's own, not the
// drawn kite's: a leg whose kite is not drawn (hidden by hand, inside the CTR, before the clock)
// turns its waypoint's name exactly as if it were.
test('a hidden kite turns the name all the same', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const deg = () => state.waypoints.map((_, i) => Math.round(wpNameAngle(i) * 180 / Math.PI));
    const shown = deg();
    state.legs.forEach(l => { l.hideKite = 1; }); draw();
    return { shown, hidden: deg() };
  });
  expect(r.hidden).toEqual(r.shown);
  expect(r.shown.some(d => d !== 0)).toBe(true);
});
