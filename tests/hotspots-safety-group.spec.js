// @ts-check
// Hotspots mark places the route puts you somewhere you would rather not be. That is a
// hazard overlay, not route information, so the switch sits with the other things on the
// map that exist to keep you out of trouble — reporting points and snap-to-nearest.
const { test, expect } = require('./_setup');

test('the hotspot switch is in the Safety group of View/Set', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('hotspot-cb'));
  const where = await page.evaluate(() => {
    const cb = document.getElementById('hotspot-cb');
    const row = cb.closest('.navtoggle');
    // Walk back to the nearest group heading: that is the group it belongs to.
    let el = row.previousElementSibling, heading = null;
    while (el && !heading) {
      if (el.classList.contains('tb-group')) heading = el.textContent.trim();
      el = el.previousElementSibling;
    }
    const section = row.closest('.tb-section');
    const after = [];
    for (let n = row.nextElementSibling; n; n = n.nextElementSibling) {
      const c = n.querySelector && n.querySelector('input[type=checkbox]');
      if (c) after.push(c.id);
    }
    return { heading, section: section ? section.dataset.sec : null, after };
  });
  expect(where.section).toBe('view');
  expect(where.heading).toBe('Safety');
  // ...beside the other safety switches, not stranded at the end of the section.
  expect(where.after).toEqual(expect.arrayContaining(['reporting-cb', 'force-snap-cb']));
});

// It ships on, and the gist is what turns it off for everyone -- the same lever every other
// default-visibility toggle uses, so it can come back without an app release.
test('the gist can turn it off, and does not need an app release to turn it back on', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function');
  const wired = await page.evaluate(() => {
    const row = (NavAid.defaultVisibilityMap || []).find(r => r[0] === 'hotspot-cb');
    return { key: row && row[1], tunable: row && row[2], shipped: tune('defaultShowHotspots') };
  });
  expect(wired.key).toBe('navaid.showHotspots');
  expect(wired.tunable).toBe('defaultShowHotspots');
  expect(wired.shipped).toBe(true);          // the app's own default is unchanged

  // A gist saying false reconciles a device that never chose for itself.
  await page.evaluate(() => {
    setTune('defaultShowHotspots', false);
    if (NavAid.applyDefaultVisibility) NavAid.applyDefaultVisibility();
  });
  expect(await page.evaluate(() => document.getElementById('hotspot-cb').checked)).toBe(false);
});
