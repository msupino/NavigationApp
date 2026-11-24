// @ts-check
// Reported from the app: the inspector's satellite picture was "way too small" -- a fixed
// 214x118 box in the middle of a phone's inspector. It now takes the panel's width (up to
// satellitePreviewMaxWidthPx) at the tunables' aspect ratio, with enough tiles behind it that a
// rotated preview shows no bare corners.
const { test, expect } = require('./_setup');

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`the inspector satellite preview fills the panel width (${vp.width}x${vp.height})`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof showInspector === 'function' && typeof clearBootLoading === 'function'
      && typeof navWP !== 'undefined' && Array.isArray(navWP) && navWP.length > 0);
    await page.evaluate(() => {
      state.selected = { type: 'navwp', index: navWP.findIndex(w => /YRIHO/.test(w.name)) };
      showInspector();
    });
    const r = await page.evaluate(() => {
      const s = document.querySelector('#insp-body .satellite-snippet');
      const b = s.getBoundingClientRect();
      const w = tune('satellitePreviewWidthPx'), h = tune('satellitePreviewHeightPx');
      return { w: b.width, h: b.height, section: s.parentElement.clientWidth, ratio: w / h,
        max: tune('satellitePreviewMaxWidthPx'), tiles: s.querySelectorAll('img').length };
    });
    expect(r.w).toBeCloseTo(Math.min(r.section, r.max), 0);
    expect(r.w).toBeGreaterThan(214);
    expect(r.w / r.h).toBeCloseTo(r.ratio, 1);
    // The tile grid covers the half-diagonal: at least 3x3, more for a big box.
    const ring = Math.max(1, Math.ceil(Math.hypot(r.w, r.h) / 2 / 256));
    expect(r.tiles).toBe((2 * ring + 1) ** 2);
  });
}
