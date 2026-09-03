// @ts-check
// The app ships user-scalable=no, so the browser's own pinch cannot enlarge a panel that is
// mostly small print — frequencies, runway designators, a decoded METAR. The inspector owns
// a text zoom of its own instead, remembered per device.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function openAirfield(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof state !== 'undefined');
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLBG') };
    showInspector();
  });
  await expect(page.locator('#inspector')).toBeVisible();
}

const zoomOf = page => page.locator('#insp-body').evaluate(e => getComputedStyle(e).zoom);

test('the buttons scale the panel body', async ({ page }) => {
  await openAirfield(page);
  expect(await zoomOf(page)).toBe('1');
  await page.locator('#insp-zoom-in').click();
  expect(parseFloat(await zoomOf(page))).toBeCloseTo(1.1, 2);
  await page.locator('#insp-zoom-out').click();
  expect(parseFloat(await zoomOf(page))).toBeCloseTo(1, 2);
});

test('zoom uses reflow, so the sheet never grows wider than the screen', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openAirfield(page);
  const wide = () => page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(await wide()).toBe(false);
  for (let i = 0; i < 8; i++) await page.locator('#insp-zoom-in').click();
  // A transform: scale would have pushed the panel off the right edge here.
  expect(await wide()).toBe(false);
});

test('the size is remembered on this device', async ({ page }) => {
  await openAirfield(page);
  await page.locator('#insp-zoom-in').click();
  await page.locator('#insp-zoom-in').click();
  const saved = await page.evaluate(() => localStorage.getItem('navaid.inspZoom'));
  expect(parseFloat(saved)).toBeCloseTo(1.2, 2);
  await openAirfield(page);                       // reload
  expect(parseFloat(await zoomOf(page))).toBeCloseTo(1.2, 2);
});

test('the buttons dim at the ends of the range rather than disappearing', async ({ page }) => {
  await openAirfield(page);
  const inn = page.locator('#insp-zoom-in');
  const out = page.locator('#insp-zoom-out');
  for (let i = 0; i < 20 && await inn.isEnabled(); i++) await inn.click();
  await expect(inn).toBeVisible();
  await expect(inn).toBeDisabled();
  expect(parseFloat(await zoomOf(page))).toBeCloseTo(2, 2);
  for (let i = 0; i < 30 && await out.isEnabled(); i++) await out.click();
  await expect(out).toBeVisible();
  await expect(out).toBeDisabled();
  expect(parseFloat(await zoomOf(page))).toBeCloseTo(0.8, 2);
});

test('pressing a zoom button does not start the header drag', async ({ page }) => {
  await openAirfield(page);
  const before = await page.locator('#inspector').evaluate(e => e.getBoundingClientRect().left);
  await page.locator('#insp-zoom-in').click();
  const after = await page.locator('#inspector').evaluate(e => e.getBoundingClientRect().left);
  // The buttons sit inside the draggable header bar; a mousedown that reached the drag
  // handler would pin the panel to a new position on the first press.
  expect(after).toBeCloseTo(before, 0);
});

test('two fingers on the body pinch it larger', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openAirfield(page);
  // The buttons are the desktop/precision path; on a phone the gesture is the point, and
  // the app ships user-scalable=no so nothing else would pick this up.
  const r = await page.evaluate(() => {
    const el = document.getElementById('insp-body');
    const mk = (type, pts) => {
      const touches = pts.map((p, i) => new Touch({ identifier: i, target: el, clientX: p[0], clientY: p[1] }));
      return new TouchEvent(type, { touches, targetTouches: touches, changedTouches: touches, bubbles: true, cancelable: true });
    };
    const before = getComputedStyle(el).zoom;
    el.dispatchEvent(mk('touchstart', [[100, 300], [200, 300]]));
    el.dispatchEvent(mk('touchmove', [[60, 300], [240, 300]]));      // spread 100 -> 180
    const after = getComputedStyle(el).zoom;
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [], bubbles: true }));
    return { before: parseFloat(before), after: parseFloat(after) };
  });
  expect(r.before).toBeCloseTo(1, 2);
  expect(r.after).toBeGreaterThan(r.before);
  // Pinching out again returns it, so the gesture is not one-way.
  const back = await page.evaluate(() => {
    const el = document.getElementById('insp-body');
    const mk = (type, pts) => {
      const touches = pts.map((p, i) => new Touch({ identifier: i, target: el, clientX: p[0], clientY: p[1] }));
      return new TouchEvent(type, { touches, targetTouches: touches, changedTouches: touches, bubbles: true, cancelable: true });
    };
    el.dispatchEvent(mk('touchstart', [[60, 300], [240, 300]]));
    el.dispatchEvent(mk('touchmove', [[100, 300], [200, 300]]));
    return parseFloat(getComputedStyle(el).zoom);
  });
  expect(back).toBeLessThan(r.after);
});
