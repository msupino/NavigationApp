// @ts-check
// The rotate dial calls itself role="slider" and takes focus. Before this it answered
// nothing but the pointer: a keyboard pilot could tab to it, see it highlighted, and have no
// way to turn the map. An audit tool scored it as a working slider the whole time, which is
// how it went unnoticed. Focus and the ARIA value now mean what they say.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshDial === 'function' &&
    !!document.getElementById('rotate-dial'));
}

// What the dial reads: the heading shown to the pilot, not Leaflet's internal bearing.
const shown = (page) => page.evaluate(() =>
  (((360 - Math.round(map.getBearing ? map.getBearing() : 0)) % 360) + 360) % 360);

const press = async (page, key) => {
  await page.focus('#rotate-dial');
  await page.press('#rotate-dial', key);
};

test('arrows turn the map one degree at a time, both ways', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setBearing(0));
  await press(page, 'ArrowUp');
  expect(await shown(page)).toBe(1);
  await press(page, 'ArrowRight');
  expect(await shown(page)).toBe(2);
  await press(page, 'ArrowDown');
  expect(await shown(page)).toBe(1);
  await press(page, 'ArrowLeft');
  expect(await shown(page)).toBe(0);
});

test('Page steps ten, and the value wraps instead of stopping at the ends', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setBearing(0));
  await press(page, 'PageUp');
  expect(await shown(page)).toBe(10);
  await press(page, 'PageDown');
  expect(await shown(page)).toBe(0);
  // Heading is a circle: below north is 359, not a floor to bump against.
  await press(page, 'ArrowDown');
  expect(await shown(page)).toBe(359);
  await press(page, 'ArrowUp');
  expect(await shown(page)).toBe(0);
});

test('Home puts north back up, from anywhere', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setBearing(360 - 137));
  expect(await shown(page)).toBe(137);
  await press(page, 'Home');
  expect(await shown(page)).toBe(0);
});

test('Space and Enter give the same 90° step as a tap', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setBearing(0));
  await press(page, 'Space');
  expect(await shown(page)).toBe(90);
  await press(page, 'Enter');
  expect(await shown(page)).toBe(180);
  // Off the quarters, the first press snaps back to north -- exactly what tapping does.
  await page.evaluate(() => map.setBearing(360 - 137));
  await press(page, 'Enter');
  expect(await shown(page)).toBe(0);
});

test('the ARIA value follows the map, so a screen reader reads the real heading', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setBearing(360 - 42));
  const a = await page.evaluate(() => {
    const d = document.getElementById('rotate-dial');
    return { now: d.getAttribute('aria-valuenow'), min: d.getAttribute('aria-valuemin'), max: d.getAttribute('aria-valuemax') };
  });
  expect(a.now).toBe('42');
  expect(a.min).toBe('0');
  expect(a.max).toBe('359');
  await press(page, 'ArrowUp');
  expect(await page.evaluate(() => document.getElementById('rotate-dial').getAttribute('aria-valuenow'))).toBe('43');
});

test('the dial and the number field are told apart by name', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(() => ({
    dial: document.getElementById('rotate-dial').getAttribute('aria-label'),
    field: document.getElementById('rotate-hdg').getAttribute('aria-label'),
  }));
  expect(names.dial).toBeTruthy();
  expect(names.field).toBeTruthy();
  expect(names.dial).not.toBe(names.field);     // two controls, two names
});

// A quote in a translation used to end the attribute early and spill the rest of the label
// into the markup as attributes of its own. The label has to be in place BEFORE the control
// is built, so this intercepts the assignment of the string table rather than editing it
// afterwards -- by then the dial exists and the damage would already be done or not done.
test('a label with a quote in it stays inside the attribute', async ({ page }) => {
  await page.addInitScript(() => {
    let table = null;
    Object.defineProperty(window, 'S', {
      configurable: true,
      get() { return table; },
      set(v) { table = v; if (v) v.rotateDialLabel = 'Dial "spin" me'; },
    });
  });
  await boot(page);
  const dial = await page.evaluate(() => {
    const d = document.getElementById('rotate-dial');
    return { label: d.getAttribute('aria-label'), attrs: d.getAttributeNames().sort().join(',') };
  });
  expect(dial.label).toBe('Dial "spin" me');    // read back whole, quotes and all
  // and nothing of it leaked out into markup: no stray "spin" or "me" attributes.
  expect(dial.attrs).toBe('aria-label,aria-valuemax,aria-valuemin,aria-valuenow,id,role,tabindex,title');
});

// The keys the dial acts on must not also reach the map underneath: an arrow that turns the
// map AND pans it moves two things for one press.
test('a handled key does not also pan the map', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { map.setBearing(0); map.setView([32.0, 34.8], 9); });
  const before = await page.evaluate(() => ({ lat: map.getCenter().lat, lng: map.getCenter().lng }));
  await press(page, 'ArrowUp');
  const after = await page.evaluate(() => ({ lat: map.getCenter().lat, lng: map.getCenter().lng }));
  expect(after.lat).toBeCloseTo(before.lat, 6);
  expect(after.lng).toBeCloseTo(before.lng, 6);
  expect(await shown(page)).toBe(1);
});
