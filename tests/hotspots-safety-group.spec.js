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
  expect(where.after).toEqual(expect.arrayContaining(['reporting-cb']));
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

// Behaviour, not display: these rows left Map for the section that owns what they do.
test('route-building and location-behaviour switches live outside Map', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('force-snap-cb'));
  const sec = await page.evaluate(() => Object.fromEntries(
    ['autoroute-cb', 'force-snap-cb', 'insp-tracking-cb', 'auto-record-cb']
      .map(id => [id, document.getElementById(id).closest('.tb-section').dataset.sec])));
  expect(sec).toEqual({ 'autoroute-cb': 'build', 'force-snap-cb': 'build',
    'insp-tracking-cb': 'settings', 'auto-record-cb': 'settings' });
});

// Edit is a list of buttons, so its two switches are toggle buttons: pressed = on, in the
// toolbar's selected blue, driving the same checkbox (and so the same handler and key).
test('Auto-route and Snap are toggle buttons that drive their checkbox', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.refreshToggleButtons === 'function');
  for (const [btn, cb, key] of [['#autoroute-btn', 'autoroute-cb', 'navaid.autoRoute'], ['#force-snap-btn', 'force-snap-cb', 'navaid.forceSnap']]) {
    const b = page.locator(btn);
    await expect(b).toHaveAttribute('aria-pressed', 'false');
    await b.evaluate(el => el.click());
    await expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(([id, k]) => [document.getElementById(id).checked, localStorage.getItem(k)], [cb, key])).toEqual([true, '1']);
    // Set from elsewhere (the gist default path): the button follows.
    await page.evaluate((id) => { const c = document.getElementById(id); c.checked = false; c.dispatchEvent(new Event('change')); }, cb);
    await expect(b).toHaveAttribute('aria-pressed', 'false');
  }
});

// Show return path joins them; on a route with a turning point it is dimmed, and a tap says why.
test('Show return path is a toggle button, dimmed with its reason on a turning route', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.refreshToggleButtons === 'function' && typeof refreshShowReturnFeature === 'function');
  await page.evaluate(() => {
    const orig = window.tune;
    window.tune = (k) => (k === 'featureShowReturn' ? true : orig(k));
    refreshShowReturnFeature();
  });
  const b = page.locator('#ret-btn');
  expect(await b.evaluate(el => el.hidden)).toBe(false);
  await b.evaluate(el => el.click());
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.showReturn)).toBe(true);
  // Dim it the way a turning point does, and tap: nothing flips, the reason is said.
  const said = await page.evaluate(() => {
    const cb = document.getElementById('ret-cb'), btn = document.getElementById('ret-btn');
    cb.disabled = true; btn.setAttribute('aria-disabled', 'true'); btn.title = 'Has a turning point';
    window.__said = []; const real = window.showToast;
    window.showToast = (m, o) => { window.__said.push(String(m)); return real && real(m, o); };
    btn.click();
    return { said: window.__said, on: window.showReturn };
  });
  expect(said).toEqual({ said: ['Has a turning point'], on: true });
});

// Edit is grouped by kind, with a separator between groups.
test('Edit is split into groups by kind', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('autoroute-btn'));
  const groups = await page.evaluate(() => {
    const body = document.querySelector('.tb-section[data-sec="build"] .tb-section-body');
    const out = [[]];
    for (const el of body.children) {
      if (el.classList.contains('tb-group-separator')) out.push([]);
      else if (el.tagName === 'BUTTON') out[out.length - 1].push(el.id);
    }
    return out;
  });
  expect(groups).toEqual([
    ['tool-add', 'tool-note', 'search-trigger'],
    ['reverse', 'ret-btn'],
    ['undo', 'clear'],
    ['fit', 'tool-reset-all-markers', 'tool-reset-all-wp-names'],
    ['autoroute-btn', 'force-snap-btn'],
  ]);
});

// With no route there is nothing to reset or reverse: dimmed, and a tap says why instead of
// asking to reset markers that do not exist. A route brings them back.
test('Reset and Reverse are dimmed with no route, and say why', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshTurnDependentControls === 'function' && typeof syncLegs === 'function');
  const ids = ['tool-reset-all-markers', 'tool-reset-all-wp-names', 'reverse'];
  const dim = () => page.evaluate((list) => list.map(id => document.getElementById(id).getAttribute('aria-disabled')), ids);
  expect(await dim()).toEqual(['true', 'true', 'true']);
  const out = await page.evaluate(() => {
    window.__said = []; window.__asked = 0;
    const real = window.showToast;
    window.showToast = (m, o) => { window.__said.push(String(m)); return real && real(m, o); };
    const ac = window.appConfirm;
    window.appConfirm = (...a) => { window.__asked++; return ac(...a); };
    document.getElementById('tool-reset-all-markers').click();
    return { said: window.__said.slice(), asked: window.__asked };
  });
  expect(out.asked).toBe(0);
  expect(out.said.join(' ')).toContain('Draw a route first');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 35.0, name: 'B' }];
    syncLegs(); draw();
  });
  expect(await dim()).toEqual([null, null, null]);
});
