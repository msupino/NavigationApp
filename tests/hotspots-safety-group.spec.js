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
  expect(wired.key).toBe('navaid.showHotspots2');   // bumped, so every device re-reads the default
  expect(wired.tunable).toBe('defaultShowHotspots');
  expect(wired.shipped).toBe(true);          // the app's own default is unchanged

  // A gist saying false reconciles a device that never chose for itself.
  await page.evaluate(() => {
    setTune('defaultShowHotspots', false);
    if (NavAid.applyDefaultVisibility) NavAid.applyDefaultVisibility();
  });
  expect(await page.evaluate(() => document.getElementById('hotspot-cb').checked)).toBe(false);
});

// The gist default only reaches a device that never chose for itself. Anyone who had ever
// touched this switch — or ran a build that wrote the value on their behalf — would have
// kept the overlay on for good, which is not what "off for now" means. The key was bumped
// so every device looks unset once and takes the gist's answer.
test('a device that had chosen before the reset takes the new default', async ({ page }) => {
  await page.addInitScript(() => {
    // What a long-standing user's storage looks like: the old key, saying on.
    localStorage.setItem('navaid.showHotspots', '1');
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof tune === 'function' && !!document.getElementById('hotspot-cb'));
  const after = await page.evaluate(() => {
    setTune('defaultShowHotspots', false);
    if (NavAid.applyDefaultVisibility) NavAid.applyDefaultVisibility();
    return {
      checked: document.getElementById('hotspot-cb').checked,
      oldKey: localStorage.getItem('navaid.showHotspots'),
      newKey: localStorage.getItem('navaid.showHotspots2'),
    };
  });
  expect(after.checked).toBe(false);        // the stale "on" no longer wins
  // ...and the superseded key is dropped rather than left to sync between devices forever.
  expect(after.oldKey).toBeNull();
});

test('and a choice made after the reset is kept', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('hotspot-cb'));
  await page.evaluate(() => {
    const cb = document.getElementById('hotspot-cb');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(await page.evaluate(() => localStorage.getItem('navaid.showHotspots2'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('hotspot-cb'));
  const kept = await page.evaluate(() => {
    setTune('defaultShowHotspots', false);
    if (NavAid.applyDefaultVisibility) NavAid.applyDefaultVisibility();
    return document.getElementById('hotspot-cb').checked;
  });
  expect(kept).toBe(true);                  // an explicit choice still beats the gist
});
