// Desktop keeps the waypoint search on screen permanently under the menu bar,
// parked on the side the language reads from and draggable from there. Mobile
// keeps the summoned overlay — there is no room for a standing panel.
const { test, expect } = require('./_setup');

const box = '#search-overlay';
const geom = page => page.evaluate(() => {
  const b = document.getElementById('search-overlay');
  const r = b.getBoundingClientRect();
  const tb = document.getElementById('toolbar').getBoundingClientRect();
  return {
    left: Math.round(r.left),
    rightGap: Math.round(window.innerWidth - r.right),
    top: Math.round(r.top),
    docked: b.classList.contains('docked'),
    hidden: b.classList.contains('hidden'),
    overlapsBar: r.top < tb.bottom && r.left < tb.right && r.right > tb.left,
  };
});

test('desktop shows the search docked below the menu bar, left in English', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  const g = await geom(page);
  expect(g.docked).toBe(true);
  expect(g.hidden).toBe(false);
  expect(g.left).toBeLessThan(g.rightGap);   // parked on the left
  expect(g.overlapsBar).toBe(false);         // clear of the menu bar
});

test('Hebrew parks it on the right', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  const g = await geom(page);
  expect(g.docked).toBe(true);
  expect(g.rightGap).toBeLessThan(g.left);
  expect(g.overlapsBar).toBe(false);
});

test('mobile keeps the summoned centred overlay', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  let g = await geom(page);
  expect(g.docked).toBe(false);
  expect(g.hidden).toBe(true);
  // The trigger lives inside the collapsed mobile toolbar, so drive the same
  // entry point the button does rather than fighting the hamburger.
  await page.evaluate(() => showSearchOverlay());
  g = await geom(page);
  expect(g.hidden).toBe(false);
  expect(Math.abs(g.left - g.rightGap)).toBeLessThanOrEqual(2);  // centred
  await expect(page.locator('#search-close')).toBeVisible();
});

test('crossing the breakpoint docks and undocks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  expect((await geom(page)).docked).toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => !document.getElementById('search-overlay').classList.contains('docked'));
  expect((await geom(page)).hidden).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => document.getElementById('search-overlay').classList.contains('docked'));
  expect((await geom(page)).hidden).toBe(false);
});

test('the docked panel has no close button and Escape only clears the query', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  await expect(page.locator('#search-close')).toBeHidden();
  await page.fill('#wp-search', 'LLHZ');
  await page.keyboard.press('Escape');
  await expect(page.locator('#wp-search')).toHaveValue('');
  expect((await geom(page)).hidden).toBe(false);   // still on screen
});

test('dragging the panel persists its spot across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  const before = await geom(page);
  const b = await page.locator(box).boundingBox();
  // Grab the panel's own chrome (its bottom edge), not the input.
  await page.mouse.move(b.x + b.width - 6, b.y + b.height - 3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 6 + 180, b.y + b.height - 3 + 160, { steps: 8 });
  await page.mouse.up();
  const moved = await geom(page);
  expect(moved.left).toBeGreaterThan(before.left + 100);
  const stored = await page.evaluate(() => localStorage.getItem('navaid.searchPos.en'));
  expect(stored).not.toBeNull();
  await page.reload();
  await page.waitForFunction(() => typeof searchDocked === 'function');
  const after = await geom(page);
  expect(Math.abs(after.left - moved.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.top - moved.top)).toBeLessThanOrEqual(2);
});

test('typing in the input does not drag the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  const before = await geom(page);
  await page.click('#wp-search');
  await page.keyboard.type('LLHZ');
  const after = await geom(page);
  expect(after.left).toBe(before.left);
  expect(after.top).toBe(before.top);
  await expect(page.locator('#wp-search')).toHaveValue('LLHZ');
});

test('a position dragged in Hebrew does not move the English one', async ({ page }) => {
  // Positions are per-language: the RTL layout mirrors LTR, so one spot cannot
  // serve both. Every draggable stores under navLangPosKey(base).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  const heBefore = await geom(page);
  const b = await page.locator(box).boundingBox();
  await page.mouse.move(b.x + 6, b.y + b.height - 3);
  await page.mouse.down();
  await page.mouse.move(b.x + 6 - 200, b.y + b.height - 3 + 140, { steps: 8 });
  await page.mouse.up();
  const heMoved = await geom(page);
  expect(heMoved.left).toBeLessThan(heBefore.left - 100);
  const keys = await page.evaluate(() => ({
    he: localStorage.getItem('navaid.searchPos.he'),
    en: localStorage.getItem('navaid.searchPos.en'),
    unscoped: localStorage.getItem('navaid.searchPos'),
  }));
  expect(keys.he).not.toBeNull();
  expect(keys.en).toBeNull();
  expect(keys.unscoped).toBeNull();
  // English is untouched: still parked at its own default on the left.
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof searchDocked === 'function');
  const en = await geom(page);
  expect(en.left).toBeLessThan(en.rightGap);
  expect(en.top).not.toBe(heMoved.top);
});

test('every draggable panel stores its position under a per-language key', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navLangPosKey === 'function');
  // The bases below are every position store in the app; each must go through
  // navLangPosKey so Hebrew and English keep separate spots.
  const bases = ['navaid.clockPos', 'navaid.legendPos', 'navaid.searchPos', 'navaid.inspPos',
    'navaid.toolbarPos', 'navaid.toolbarPosDesktop', 'navaid.tunePanelPos', 'navaid.fpPos'];
  const keys = await page.evaluate(bs => bs.map(b => navLangPosKey(b)), bases);
  expect(keys).toEqual(bases.map(b => b + '.en'));
  const he = await page.evaluate(bs => {
    document.documentElement.lang = 'he';
    const out = bs.map(b => navLangPosKey(b));
    document.documentElement.lang = 'en';
    return out;
  }, bases);
  expect(he).toEqual(bases.map(b => b + '.he'));
});
