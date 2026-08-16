// @ts-check
// Reported from a phone: the zoom buttons cover the lat/long box. The readouts are floated
// to the LEFT of the bottom-right control column by a fixed clearance written for the
// DESKTOP column (30px buttons). The touch pass later grew those buttons to 44px, so on
// every phone the readout's right edge slid underneath them — a box you cannot read while
// the map is the only thing on screen.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 780 };

async function boot(page, size) {
  await page.setViewportSize(size);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    !!document.getElementById('coord-readout'));
}

// Show all three readouts with representative content; they are hidden until the pointer
// has been over the map, which a touch device never does on its own.
const showReadouts = (page) => page.evaluate(() => {
  const put = (id, text) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    el.textContent = text;
  };
  put('coord-readout', "N 32°10.5' E 034°50.1'");
  put('vor-readout', 'BGN R-215 12.4');
  put('wind-readout', '270/15');
});

const boxes = (page) => page.evaluate(() => {
  const r = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return b.width && b.height ? { x: b.left, y: b.top, r: b.right, b: b.bottom } : null;
  };
  const overlap = (a, c) => !!a && !!c && !(a.r <= c.x || a.x >= c.r || a.b <= c.y || a.y >= c.b);
  const zoom = r('.leaflet-control-zoom');
  const dial = r('#rotate-dial');
  const out = {};
  for (const [name, sel] of [['coord', '#coord-readout'], ['vor', '#vor-readout'], ['wind', '#wind-readout']]) {
    const box = r(sel);
    out[name] = box ? { overZoom: overlap(box, zoom), overDial: overlap(box, dial), right: box.r } : null;
  }
  out.zoomLeft = zoom ? zoom.x : null;
  return out;
});

test('on a phone the readouts clear the zoom column', async ({ page }) => {
  await boot(page, PHONE);
  await showReadouts(page);
  const out = await boxes(page);
  expect(out.coord).not.toBeNull();
  expect(out.coord.overZoom).toBe(false);
  expect(out.coord.overDial).toBe(false);
  // Not merely "not overlapping": it must sit fully to the LEFT of the column, which is
  // what keeps it readable when the buttons grow again.
  expect(out.coord.right).toBeLessThanOrEqual(out.zoomLeft);
  for (const name of ['vor', 'wind']) {
    if (!out[name]) continue;
    expect(out[name].overZoom, name + ' readout overlaps the zoom column').toBe(false);
    expect(out[name].overDial, name + ' readout overlaps the rotation dial').toBe(false);
  }
});

test('the desktop layout is unchanged', async ({ page }) => {
  await boot(page, { width: 1280, height: 800 });
  await showReadouts(page);
  const out = await boxes(page);
  expect(out.coord.overZoom).toBe(false);
  expect(out.coord.overDial).toBe(false);
});
