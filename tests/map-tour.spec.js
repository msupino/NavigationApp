// @ts-check
// The first-launch map tour: one control at a time, with the arrow and the bubble; Next / Back /
// Skip; plays once; Settings replays it. The suite turns it off (tests/_setup.js); this opts in.
const { test, expect } = require('./_setup');

async function boot(page, size, lang = 'en') {
  await page.setViewportSize(size);
  // A first launch: the "seen" flag cleared on the FIRST load only. Cleared on every load, the
  // reload that checks "plays once" was a first launch again, and only timing hid it.
  await page.addInitScript(() => {
    window.__navaidNoTour = false;
    try {
      if (!sessionStorage.getItem('__tourFirstLoad')) { sessionStorage.setItem('__tourFirstLoad', '1'); localStorage.removeItem('navaid.tourSeen'); }
    } catch (e) { /* storage off */ }
  });
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.tour && typeof map !== 'undefined');
}

for (const [name, size, lang] of [['phone', { width: 390, height: 844 }, 'he'], ['desktop', { width: 1280, height: 800 }, 'en']]) {
  test(`plays once on first launch and walks the controls (${name})`, async ({ page }) => {
    // Every step clicked through, then a reload and a fixed 3 s wait: past 15 s once the tour
    // grew a Route check step.
    test.slow();
    await boot(page, size, lang);
    const tour = page.locator('#map-tour');
    await expect(tour).toBeVisible({ timeout: 10000 });
    const n = await page.evaluate(() => NavAid.tour.steps().length);
    expect(n).toBeGreaterThanOrEqual(7);
    // Every step with a control: the spotlight sits on it and the bubble does not cover it.
    for (let k = 0; k < n; k++) {
      const r = await page.evaluate(() => {
        const spot = document.querySelector('#map-tour .tour-spot'), b = document.querySelector('#map-tour .tour-bubble').getBoundingClientRect();
        // The spot glides between controls: compare against where it is going, not where it is.
        const st = spot.style, s = spot.hidden ? null : { left: parseFloat(st.left), top: parseFloat(st.top),
          right: parseFloat(st.left) + parseFloat(st.width), bottom: parseFloat(st.top) + parseFloat(st.height) };
        return { plain: !s, overlap: !!s && b.left < s.right && b.right > s.left && b.top < s.bottom && b.bottom > s.top,
                 inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight };
      });
      expect(r.overlap).toBe(false);
      expect(r.inside).toBe(true);
      await page.locator('#map-tour .tour-next').click();
    }
    await expect(tour).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('navaid.tourSeen'))).toBe('1');
    await page.reload();
    await page.waitForFunction(() => window.NavAid && NavAid.tour && NavAid.disclaimerDone);
    await page.waitForTimeout(3000);                       // past the auto-start's own delays
    await expect(tour).toHaveCount(0);                     // once
  });
}

test('Back, Skip and Escape; Settings plays it again', async ({ page }) => {
  await boot(page, { width: 1280, height: 800 });
  await expect(page.locator('#map-tour')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#map-tour .tour-back')).toBeDisabled();
  await page.locator('#map-tour .tour-next').click();
  await expect(page.locator('#map-tour .tour-count')).toHaveText(/^2 \//);
  await page.locator('#map-tour .tour-back').click();
  await expect(page.locator('#map-tour .tour-count')).toHaveText(/^1 \//);
  await page.keyboard.press('Escape');
  await expect(page.locator('#map-tour')).toHaveCount(0);
  await page.evaluate(() => document.getElementById('tour-replay').click());
  await expect(page.locator('#map-tour')).toBeVisible();
  await page.locator('#map-tour .tour-skip').click();
  await expect(page.locator('#map-tour')).toHaveCount(0);
});

// Reported with a screenshot: the Edit step lit the whole column, Route check included.
test('the Edit step lights the edit buttons, not Route check above them', async ({ page }) => {
  await boot(page, { width: 1280, height: 800 });
  await expect(page.locator('#map-tour')).toBeVisible({ timeout: 10000 });
  const titles = await page.evaluate(() => NavAid.tour.steps().map(s => s.k));
  for (let k = 0; k < titles.indexOf('Edit'); k++) await page.locator('#map-tour .tour-next').click();
  await page.waitForTimeout(400);                          // the spot glides to its place
  const r = await page.evaluate(() => {
    const st = document.querySelector('#map-tour .tour-spot').style;
    const top = parseFloat(st.top), bottom = top + parseFloat(st.height);
    const box = id => document.getElementById(id).getBoundingClientRect();
    return { top, bottom, check: box('edit-col-check'), add: box('edit-col-add'), clear: box('edit-col-clear') };
  });
  expect(r.top).toBeGreaterThan(r.check.bottom - 2);       // Route check is outside the ring
  expect(r.top).toBeLessThanOrEqual(r.add.top);             // Add waypoint inside it
  expect(r.bottom).toBeGreaterThanOrEqual(r.clear.bottom);  // ...down to Clear map
});
