// @ts-check
// The SIGWX sheet's header and table are not geography. They were image overlays pinned to
// invented coordinates east of Israel -- the code said so itself: "the TABLE isn't geographic,
// park it just east of Israel" -- which works only while the map is north-up. Rotate it and
// those fake points swing away with everything else: off to the side, half off-screen, on their
// ear. Counter-rotating them fixed the angle and left the position wrong, which reads worse.
//
// They live in screen space now. These tests are about the one property that failed: the panel
// holds its place and its orientation whatever the map does underneath.
const { test, expect } = require('./_setup');

const PIX = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

async function boot(page, w, h) {
  await page.setViewportSize({ width: w || 1000, height: h || 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map === 'object' && map && typeof L === 'object');
  await page.evaluate(() => { if (window.clearBootLoading) clearBootLoading(); });
}

// The box the SIGWX module builds (sideBox), reproduced here: the module only builds it after
// fetching and cropping a half-megabyte chart, and this is about where the box lands.
const addBox = (page) => page.evaluate((src) => {
  const box = document.createElement('div');
  box.className = 'sigwx-side';
  for (const cls of ['sigwx-side-header', 'sigwx-side-table']) {
    const img = document.createElement('img');
    img.className = cls;
    img.src = src;
    box.appendChild(img);
  }
  map.getContainer().appendChild(box);
}, PIX);

const boxRect = (page) => page.evaluate(() => {
  const b = document.querySelector('.sigwx-side').getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) };
});

test('it holds its place and its orientation while the map turns', async ({ page }) => {
  await boot(page);
  await addBox(page);
  const at0 = await boxRect(page);
  const transformAt = (deg) => page.evaluate((d) => {
    map.setBearing(d);
    const el = document.querySelector('.sigwx-side');
    return getComputedStyle(el).transform;
  }, deg);
  expect(await transformAt(45)).toBe('none');       // nothing rotates it
  expect(await boxRect(page)).toEqual(at0);          // ...and nothing moves it
  expect(await transformAt(135)).toBe('none');
  expect(await boxRect(page)).toEqual(at0);
  await page.evaluate(() => map.setBearing(0));
});

// The old failure came from living in a rotating pane. This is the structural reason it cannot
// happen again.
test('it is on the map container, not in a rotating pane', async ({ page }) => {
  await boot(page);
  await addBox(page);
  const where = await page.evaluate(() => {
    const el = document.querySelector('.sigwx-side');
    return {
      inPane: !!el.closest('.leaflet-pane'),
      inRotatePane: !!el.closest('.leaflet-rotate-pane'),
      parentIsContainer: el.parentElement === map.getContainer(),
    };
  });
  expect(where.inPane).toBe(false);
  expect(where.inRotatePane).toBe(false);
  expect(where.parentIsContainer).toBe(true);
});

// Panning and zooming moved it too, at any bearing -- it was pinned to ground, not to the screen.
test('panning and zooming leave it where it is', async ({ page }) => {
  await boot(page);
  await addBox(page);
  const before = await boxRect(page);
  await page.evaluate(() => { map.setView([31.2, 34.6], 9); });
  await page.waitForTimeout(150);
  expect(await boxRect(page)).toEqual(before);
});

// It must not cover the toolbar: that is how the pilot turns it back off.
test('it clears the toolbar', async ({ page }) => {
  await boot(page);
  await addBox(page);
  const clear = await page.evaluate(() => {
    const box = document.querySelector('.sigwx-side').getBoundingClientRect();
    const tb = document.getElementById('toolbar').getBoundingClientRect();
    return box.top >= tb.bottom;
  });
  expect(clear).toBe(true);
});

// It is a read-out, not a control: the map underneath stays draggable through it.
test('it does not swallow the map underneath', async ({ page }) => {
  await boot(page);
  await addBox(page);
  expect(await page.evaluate(() =>
    getComputedStyle(document.querySelector('.sigwx-side')).pointerEvents)).toBe('none');
});

// A third of a phone is too much to give a table nobody can read at that size.
test('a phone gets the chart instead of the table', async ({ page }) => {
  await boot(page, 430, 780);
  await addBox(page);
  expect(await page.evaluate(() =>
    getComputedStyle(document.querySelector('.sigwx-side')).display)).toBe('none');
});
