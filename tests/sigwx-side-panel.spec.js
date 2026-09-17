// @ts-check
// The SIGWX sheet's header and table are not geography. They were image overlays pinned to
// invented coordinates east of Israel -- the code said so itself: "the TABLE isn't geographic,
// park it just east of Israel" -- which works only while the map is north-up. Rotate it and
// those fake points swing away: off to the side, half off-screen, on their ear. Counter-rotating
// them fixed the angle and left the position wrong, which reads worse.
//
// They live in screen space now. The panel is torn down whenever the layer is off, so each test
// builds it and measures inside one evaluate rather than across several.
const { test, expect } = require('./_setup');

const PIX = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

async function boot(page, w, h) {
  await page.setViewportSize({ width: w || 1000, height: h || 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map === 'object' && map
    && typeof sigwxSideBox === 'function');
  await page.evaluate(() => { if (window.clearBootLoading) clearBootLoading(); });
}

// Build the module's own box (not a copy) and hand back whatever the callback measures.
const withBox = (page, fn) => page.evaluate(({ src, body }) => {
  const box = sigwxSideBox();
  for (const img of box.querySelectorAll('img')) img.src = src;
  return new Function('box', 'return (' + body + ')(box)')(box);
}, { src: PIX, body: fn });

test('it holds its place and its orientation while the map turns', async ({ page }) => {
  await boot(page);
  const got = await withBox(page, `(box) => {
    const at = () => { const b = box.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y),
               t: getComputedStyle(box).transform }; };
    const a0 = at();
    map.setBearing(45); const a45 = at();
    map.setBearing(135); const a135 = at();
    map.setBearing(0);
    return { a0, a45, a135 };
  }`);
  // Nothing rotates it, and nothing moves it: that is the whole fix.
  expect(got.a45.t).toBe('none');
  expect(got.a135.t).toBe('none');
  expect({ x: got.a45.x, y: got.a45.y }).toEqual({ x: got.a0.x, y: got.a0.y });
  expect({ x: got.a135.x, y: got.a135.y }).toEqual({ x: got.a0.x, y: got.a0.y });
});

// The old failure came from living in a rotating pane. This is the structural reason it cannot
// happen again.
test('it is on the map container, not in a rotating pane', async ({ page }) => {
  await boot(page);
  const where = await withBox(page, `(box) => ({
    inPane: !!box.closest('.leaflet-pane'),
    inRotatePane: !!box.closest('.leaflet-rotate-pane'),
    parentIsContainer: box.parentElement === map.getContainer(),
  })`);
  expect(where.inPane).toBe(false);
  expect(where.inRotatePane).toBe(false);
  expect(where.parentIsContainer).toBe(true);
});

// Panning and zooming moved it too: it was pinned to ground, not to the screen.
test('panning and zooming leave it where it is', async ({ page }) => {
  await boot(page);
  const got = await withBox(page, `(box) => {
    const at = () => { const b = box.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y) }; };
    const before = at();
    map.setView([31.2, 34.6], 9);
    return { before, after: at() };
  }`);
  expect(got.after).toEqual(got.before);
});

// It must not cover the toolbar: that is how the pilot turns it back off.
test('it clears the toolbar', async ({ page }) => {
  await boot(page);
  const clear = await withBox(page, `(box) => box.getBoundingClientRect().top
    >= document.getElementById('toolbar').getBoundingClientRect().bottom`);
  expect(clear).toBe(true);
});

test('it leaves room for the search window above the chart table', async ({ page }) => {
  await boot(page, 918, 826);
  const top = await withBox(page, `(box) =>
    box.getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top`);
  expect(top).toBeGreaterThanOrEqual(208);
});

// The published chart is landscape; reserve space for both the table and header.
test('the width comes from the height there is room for, not a fixed cap', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => ({
    tall: sigwxSideWidthPx(1400, 1400, 1),
    short: sigwxSideWidthPx(1400, 600, 1),
    narrow: sigwxSideWidthPx(700, 1400, 1),
    tiny: sigwxSideWidthPx(400, 260, 1),
    scaled: sigwxSideWidthPx(1400, 1400, 0.5),
  }));
  // Its own resolution and no further: upscaling a scanned table adds blur, not letters.
  expect(got.tall).toBe(700);
  // A short window gets less, because the whole table still has to fit inside it. The first
  // version capped the WIDTH at 380px instead and let the height fall out of that, which is
  // smaller than fitting the height allows on any window taller than about 830px.
  expect(got.short).toBeLessThan(got.tall);
  // Never more than half the map, however tall the window.
  expect(got.narrow).toBeLessThanOrEqual(350);
  // Viewport safety takes precedence over the preferred minimum width.
  expect(got.tiny).toBeLessThan(40);
  // The tunable still means what it meant: a size knob.
  expect(got.scaled).toBeLessThan(got.tall);
});

// At that size the panel is a summary. The way to READ the table is to open it.
test('it is pressable, and says so', async ({ page }) => {
  await boot(page);
  const got = await withBox(page, `(box) => ({
    role: box.getAttribute('role'),
    label: box.getAttribute('aria-label'),
    tab: box.tabIndex,
    cursor: getComputedStyle(box).cursor,
  })`);
  expect(got.role).toBe('button');
  expect(got.label).toMatch(/full size/i);
  expect(got.tab).toBe(0);
  expect(got.cursor).toBe('zoom-in');
});

// A third of a phone is too much to give a table nobody can read at that size.
test('a phone gets the chart instead of the table', async ({ page }) => {
  await boot(page, 430, 780);
  const display = await withBox(page, `(box) => getComputedStyle(box).display`);
  expect(display).toBe('none');
});

// East of the chart, in both languages. The table always stood east of Israel, and east does
// not move when the interface language does -- a logical property put it on the left in Hebrew,
// which is a different place from the one a pilot already knows.
for (const lang of ['en', 'he']) {
  test('it stands east of the chart in ' + lang, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => typeof sigwxSideBox === 'function');
    const got = await page.evaluate((src) => {
      const box = sigwxSideBox();
      for (const img of box.querySelectorAll('img')) img.src = src;
      const b = box.getBoundingClientRect();
      return {
        right: Math.round(b.right),
        left: Math.round(b.left),
        viewport: innerWidth,
        dir: getComputedStyle(document.documentElement).direction,
      };
    }, 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    expect(got.dir).toBe(lang === 'he' ? 'rtl' : 'ltr');
    // Hard against the right edge, and nowhere near the left one.
    expect(got.viewport - got.right).toBeLessThanOrEqual(12);
    expect(got.left).toBeGreaterThanOrEqual(got.viewport / 2 - 8);
  });
}
