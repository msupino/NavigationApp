// @ts-check
// The overlay opacity was six copies of the same hard-coded 0.6 -- one per layer -- and the
// only way to change how strongly a plate prints over the chart was to edit the source. One
// slider has driven all of them since the sliders were united (buildOverlayLayer creates every
// overlay with plateOpacity), so one tunable now sits behind that slider.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof overlayDefaultOpacity === 'function');
}

test('the shared slider has one gist-set default', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => ({
    tuned: tune('overlayOpacity'), used: overlayDefaultOpacity(), applied: plateOpacity,
  }));
  expect(out.tuned).toBe(0.8);
  expect(out.used).toBe(0.8);
  expect(out.applied).toBe(0.8);        // what the overlays are actually drawn with
});

// Read at the point of use, like the other tunables: a value pushed from the gist has to
// apply without a reload.
test('a value pushed from the gist applies without a reload', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    setTune('overlayOpacity', 0.35);
    const v = overlayDefaultOpacity();
    setTune('overlayOpacity', 0.8);
    return v;
  });
  expect(got).toBe(0.35);
});

// A pilot who moved the slider keeps that: the tunable is the default, not an override.
test('a stored slider value still wins', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('navaid.plateOpacity', '0.25'));
  await boot(page);
  expect(await page.evaluate(() => plateOpacity)).toBe(0.25);
});

// The reset button under the slider goes back to the gist value, not to a number frozen into
// the source.
test('reset goes back to the tuned default', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('navaid.plateOpacity', '0.25'));
  await boot(page);
  await page.evaluate(() => setTune('overlayOpacity', 0.55));
  await page.evaluate(() => document.getElementById('plate-opacity-reset').click());
  expect(await page.evaluate(() => plateOpacity)).toBe(0.55);
  await page.evaluate(() => setTune('overlayOpacity', 0.8));
});
