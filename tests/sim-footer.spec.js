// @ts-check
// The Simulator (SimConnect) controls moved from a toolbar section to a small
// footer icon that opens a modal panel.
const { test, expect } = require('./_setup');

test('footer sim icon opens the simulator panel; Esc closes it', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');

  // No simulator toolbar section anymore.
  await expect(page.locator('.tb-section[data-sec="sim"]')).toHaveCount(0);

  // Footer icon present; modal hidden initially.
  const trigger = page.locator('#sim-trigger');
  await expect(trigger).toBeVisible();
  await expect(page.locator('#sim-modal')).toBeHidden();

  // Opening reveals the sim controls.
  await trigger.click();
  await expect(page.locator('#sim-modal')).toBeVisible();
  // Three stacked buttons: connect, follow, center.
  await expect(page.locator('#sim-modal .modal.sim-modal > button:not(.sim-modal-close)')).toHaveCount(3);
  await expect(page.locator('#sim-modal #sim-connect-cb')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-follow-cb')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-center')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-url')).toBeVisible();

  // Center is a one-shot — clicking flashes for feedback even with no live
  // aircraft (muted no-data flash).
  await page.locator('#sim-modal #sim-center').click();
  await expect(page.locator('#sim-modal #sim-center')).toHaveClass(/sim-flash/);

  // Follow is a toggle with a visible active (aria-pressed) state.
  const follow = page.locator('#sim-modal #sim-follow-cb');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');

  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(page.locator('#sim-modal')).toBeHidden();

  // Close button also works.
  await trigger.click();
  await expect(page.locator('#sim-modal')).toBeVisible();
  await page.locator('#sim-modal-close').click();
  await expect(page.locator('#sim-modal')).toBeHidden();
});

test('the sim icon stays visible on a mobile viewport -- connecting one is how the watch alerts get tested there', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('sim-trigger'));
  await expect(page.locator('#sim-trigger')).toBeVisible();
});

// Reported from the installed APK: the sim button was invisible AND untappable there,
// while the same build id at the same width in Chrome on the same phone drew it. It was
// the only footer button using an inline <svg>; the two GPS buttons beside it use emoji
// glyphs and rendered in both. On mobile its text label is hidden, so a glyph that does
// not paint leaves a blank ~16px at the edge of the row -- nothing to see, nothing to
// hit. This pins the icon to a real rendered glyph and to the same shape its siblings
// use, rather than markup that can silently paint nothing.
test('the footer sim icon draws a glyph, like its GPS siblings', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 808 });
  await page.goto('?lang=he');
  await page.waitForFunction(() => !!document.getElementById('sim-trigger'));
  const out = await page.evaluate(() => {
    const btn = document.getElementById('sim-trigger');
    const icon = btn.querySelector('.footer-link-icon');
    const r = btn.getBoundingClientRect();
    const ir = icon ? icon.getBoundingClientRect() : null;
    return {
      iconTag: icon ? icon.tagName : null,
      text: icon ? icon.textContent.trim() : '',
      btnW: Math.round(r.width),
      iconW: ir ? Math.round(ir.width) : 0,
      // Same element shape as the buttons that are known to render in the APK.
      gpsIconTags: [...document.querySelectorAll('#gps-record .footer-link-icon, #gps-live .footer-link-icon')]
        .map(e => e.tagName),
    };
  });
  expect(out.iconTag).toBe('SPAN');
  expect(out.gpsIconTags).toEqual(['SPAN', 'SPAN']);
  expect(out.text.length).toBeGreaterThan(0);
  // The label is hidden at this width, so the icon IS the button: it has to carry
  // real width, not collapse to padding.
  expect(out.iconW).toBeGreaterThan(8);
  expect(out.btnW).toBeGreaterThan(20);
});
