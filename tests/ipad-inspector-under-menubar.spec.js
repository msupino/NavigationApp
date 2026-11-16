// Reported (iPad, desktop layout): the docked inspector anchors to --navaid-inspector-default-top
// (96 px), but the desktop menubar on a tablet sits at the top of the screen and on an iPad wraps
// onto two rows, so its bottom drops below 96 px and hid the inspector's header -- the leg title,
// the +/- zoom and the x close. The fix drops an UNDRAGGED inspector to the bar's measured bottom
// (--navaid-toolbar-bottom) when that is lower; a dragged panel keeps its inline top.
//
// pointer:coarse is required for the rule, so this runs under touch emulation.
const { test, expect } = require('./_setup');
test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });

async function boot(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.tabletLayout', 'desktop'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && document.getElementById('inspector'));
  // Force the desktop menubar on (the tablet-desktop layout the report was in).
  await page.evaluate(() => { if (window.NavAid && NavAid.refreshDesktopMenu) NavAid.refreshDesktopMenu(); });
  await page.waitForFunction(() => document.documentElement.classList.contains('menubar'));
}

async function openLegInspector(page) {
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 35.0, name: 'B' }];
    syncLegs();
    state.selected = { type: 'leg', index: 0 };
    draw();
    if (typeof showInspector === 'function') showInspector();
  });
  await expect(page.locator('#inspector')).toBeVisible();
}

test('the undragged inspector drops below a tall (wrapped) menubar instead of hiding under it', async ({ page }) => {
  await boot(page);
  await openLegInspector(page);
  const r = await page.evaluate(() => {
    // Simulate the iPad's two-row bar: a measured bottom well below the 96 px default.
    document.documentElement.style.setProperty('--navaid-toolbar-bottom', '120px');
    const top = parseFloat(getComputedStyle(document.getElementById('inspector')).top);
    return { top, insp: document.getElementById('inspector').getBoundingClientRect().top };
  });
  // max(96, 120 + 8) = 128: the panel starts clear of the bar, not at the old 96.
  expect(r.top).toBeGreaterThanOrEqual(128 - 0.5);
  expect(r.insp).toBeGreaterThanOrEqual(120);   // its real top is below the bar's bottom
});

test('a short bar leaves the inspector at its normal default top', async ({ page }) => {
  await boot(page);
  await openLegInspector(page);
  const top = await page.evaluate(() => {
    document.documentElement.style.setProperty('--navaid-toolbar-bottom', '40px');
    return parseFloat(getComputedStyle(document.getElementById('inspector')).top);
  });
  // max(96, 40 + 8) = 96: unchanged where the bar is short.
  expect(top).toBeGreaterThanOrEqual(95.5);
  expect(top).toBeLessThanOrEqual(97);
});

test('a dragged inspector keeps its own top under the tall bar (the clamp is default-only)', async ({ page }) => {
  await boot(page);
  await openLegInspector(page);
  const top = await page.evaluate(() => {
    document.documentElement.style.setProperty('--navaid-toolbar-bottom', '120px');
    const el = document.getElementById('inspector');
    el.style.top = '300px';            // a dragged position sets inline top
    return parseFloat(getComputedStyle(el).top);
  });
  expect(top).toBe(300);
});
