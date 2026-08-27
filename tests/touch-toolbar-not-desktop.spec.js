// A wide screen is not a desktop.
//
// An iPad in landscape is 1080 CSS px, so a width-only breakpoint gave it the menubar
// layout — where the collapse toggle is inert (setCollapsed force-returns false for the
// desktop menu) and the section bodies are absolutely-positioned dropdowns with nowhere to
// scroll. Measured on a real iPad profile under WebKit: the toggle was visible and did
// nothing, and the View and Weather menus ran 172px and 198px past the bottom of the screen
// with no way to reach the rest. Reported from an iPad, in both Chrome and the home-screen
// app, in landscape.
//
// The fix is not a user-agent test — iPadOS deliberately reports a DESKTOP Safari UA, so
// sniffing calls an iPad a Mac. What actually differs is the pointer.
const { test, expect } = require('./_setup');

test('the menubar layout asks about the pointer, not just the width', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof toolbarUsesDesktopMenu === 'function');
  const q = await page.evaluate(() => {
    // The predicate the whole responsive toolbar hangs off.
    const mq = window.matchMedia('(min-width: 681px) and (hover: hover) and (pointer: fine)');
    return { media: mq.media, matches: mq.matches, agrees: toolbarUsesDesktopMenu() === mq.matches };
  });
  expect(q.media).toContain('hover: hover');
  expect(q.media).toContain('pointer: fine');
  // The JS predicate and the CSS must ask the same question, or the layout and the
  // behaviour disagree — which is the shape of this whole bug.
  expect(q.agrees).toBe(true);
});

test('every desktop-menu CSS block carries the same conditions', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const blocks = await page.evaluate(async () => {
    const css = await (await fetch('app/style.css')).text();
    const wide = css.match(/@media\s*\(min-width:\s*681px\)[^{]*\{/g) || [];
    return wide.map(m => m.replace(/\s+/g, ' ').trim());
  });
  expect(blocks.length).toBeGreaterThan(0);
  // A block that asks about width alone would hand an iPad the menubar again.
  for (const b of blocks) {
    expect(b).toContain('hover: hover');
    expect(b).toContain('pointer: fine');
  }
});

// On a fine-pointer desktop nothing changes: the menubar is still the menubar.
test('a desktop still gets the menubar', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof toolbarUsesDesktopMenu === 'function');
  const desktop = await page.evaluate(() => ({
    menubar: toolbarUsesDesktopMenu(),
    fine: window.matchMedia('(pointer: fine)').matches,
    toggle: getComputedStyle(document.getElementById('toolbar-toggle')).display,
  }));
  expect(desktop.fine).toBe(true);
  expect(desktop.menubar).toBe(true);
  expect(desktop.toggle).toBe('none');     // nothing to collapse in the menubar layout
});
