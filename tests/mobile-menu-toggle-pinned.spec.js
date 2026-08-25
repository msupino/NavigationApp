// @ts-check
// The ☰ is the only way in and out of the menus on a phone. It used to scroll away with
// them: open a long section, scroll to its bottom, and the control that closes it is above
// the top of the screen. It is pinned to the top of the panel now; only the sections move.
const { test, expect } = require('./_setup');

// Short on purpose: a phone in landscape, or a tall one with the keyboard up. The panel
// has to actually overflow for any of this to mean anything.
const PHONE = { width: 390, height: 360 };

async function boot(page) {
  await page.setViewportSize(PHONE);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('toolbar-toggle'));
  // Open the panel if it booted closed, and expand a couple of sections so it can scroll.
  await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    if (tb.classList.contains('collapsed')) document.getElementById('toolbar-toggle').click();
    document.querySelectorAll('.tb-section-head').forEach(h => {
      const sec = h.closest('.tb-section');
      if (sec && sec.classList.contains('collapsed')) h.click();
    });
  });
  await page.waitForTimeout(200);
}

const boxes = (page) => page.evaluate(() => {
  const tb = document.getElementById('toolbar');
  const t = document.getElementById('toolbar-toggle');
  return {
    scrollTop: tb.scrollTop,
    scrollable: tb.scrollHeight - tb.clientHeight,
    toggleTop: Math.round(t.getBoundingClientRect().top),
    panelTop: Math.round(tb.getBoundingClientRect().top),
    sticky: getComputedStyle(t).position,
  };
});

test('the menu button stays put while the sections scroll under it', async ({ page }) => {
  await boot(page);
  const before = await boxes(page);
  expect(before.sticky).toBe('sticky');
  expect(before.scrollable).toBeGreaterThan(60);       // there is something to scroll

  await page.evaluate(() => { const tb = document.getElementById('toolbar'); tb.scrollTop = 60; });
  await page.waitForTimeout(120);
  const mid = await boxes(page);
  await page.evaluate(() => { const tb = document.getElementById('toolbar'); tb.scrollTop = tb.scrollHeight; });
  await page.waitForTimeout(120);
  const end = await boxes(page);

  expect(end.scrollTop).toBeGreaterThan(50);           // the panel really scrolled
  // It rides up to the top of the panel and stops there: same place on screen however far
  // the sections travel underneath, and always within the panel's first few pixels.
  expect(end.toggleTop).toBe(mid.toggleTop);
  expect(end.toggleTop).toBeLessThanOrEqual(before.toggleTop);   // it never travels down
  expect(end.toggleTop - end.panelTop).toBeLessThan(20);
});

test('it is still tappable after scrolling, and still closes the panel', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { const tb = document.getElementById('toolbar'); tb.scrollTop = tb.scrollHeight; });
  await page.waitForTimeout(150);
  await page.click('#toolbar-toggle');
  expect(await page.evaluate(() => document.getElementById('toolbar').classList.contains('collapsed')))
    .toBe(true);
});

// Nothing may show through it: the rows sliding past are the whole point of pinning it.
// And the band is the whole head -- grip, ☰, language -- not the button alone, so the open
// panel's first line is the same line the closed card shows.
test('the pinned head is one opaque band across the panel', async ({ page }) => {
  await boot(page);
  const look = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    const ids = ['toolbar-handle', 'toolbar-toggle', 'lang-toggle'];
    const cells = ids.map(id => {
      const el = document.getElementById(id);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { id, pos: cs.position, bg: cs.backgroundColor, z: Number(cs.zIndex) || 0,
               left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) };
    });
    const r = tb.getBoundingClientRect();
    return { cells, panelLeft: Math.round(r.left), panelRight: Math.round(r.right) };
  });
  for (const c of look.cells) {
    expect(c.pos).toBe('sticky');
    expect(c.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(c.z).toBeGreaterThan(0);
  }
  // One row: same top, and together they reach both edges with no seam between them.
  const tops = look.cells.map(c => c.top);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  const lefts = look.cells.map(c => c.left);
  const rights = look.cells.map(c => c.right);
  expect(Math.min(...lefts)).toBeLessThanOrEqual(look.panelLeft + 2);
  expect(Math.max(...rights)).toBeGreaterThanOrEqual(look.panelRight - 2);
  const sorted = look.cells.slice().sort((a, b) => a.left - b.left);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i].left - sorted[i - 1].right).toBeLessThanOrEqual(1);   // no gap to see through
  }
});

// The closed card is a three-column grid (handle, ☰, language on one row). Sticky there
// would fight the grid, so the pin applies only to the open panel.
test('the closed card is untouched', async ({ page }) => {
  await boot(page);
  await page.click('#toolbar-toggle');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('toolbar-toggle')).position))
    .toBe('static');
});

test('on a desktop width nothing is pinned', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('toolbar-toggle'));
  // The ☰ is display:none from 681px up; the menubar takes over there.
  const cs = await page.evaluate(() => {
    const t = document.getElementById('toolbar-toggle');
    return { display: getComputedStyle(t).display, position: getComputedStyle(t).position };
  });
  expect(cs.display === 'none' || cs.position === 'static').toBe(true);
});
