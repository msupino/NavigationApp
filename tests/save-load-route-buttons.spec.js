// Save / My routes: two labeled buttons above the menu's sections (and at the top of the
// flight plan), replacing two bare icons in a corner of the Edit header.
//   My routes -> always opens the Saved routes menu, and shows how many there are.
//   Save      -> if the current route was loaded from (or saved as) a library entry and has
//                changed, asks IN THE APP: save over it, save as new, or cancel (confirm() is
//                silent in the APK). Otherwise opens the Saved routes menu to name it.
const { test, expect, answerAppDialogs } = require('./_setup');

async function boot(page, lang = 'en') {
  // The header Save/Load buttons live in the stacked/accordion toolbar; they
  // are hidden in the wide desktop-menubar layout (>=681px), so test narrow
  // and force the (phone-default-collapsed) toolbar open + the Edit section.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('navaid.toolbarCollapsed', '0');
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
        localStorage.setItem('navaid.sec.' + s, '1');
      }
      localStorage.removeItem('navaid.routes');
      localStorage.removeItem('navaid.route');
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof showRouteLibraryModal === 'function' &&
    document.getElementById('tool-save-route') && document.getElementById('tool-load-route'));
  await expect(page.locator('#tool-save-route')).toBeVisible();
}

async function setRoute(page, names) {
  await page.evaluate(ns => {
    state.waypoints = ns.map((n, i) => ({ lat: 32 + i * 0.1, lng: 34.8 + i * 0.1, name: n }));
    state.notes = [];
    syncLegs(); draw();
  }, names);
}

const libLen = page => page.evaluate(() =>
  JSON.parse(localStorage.getItem('navaid.routes') || '[]').filter(e => e && !e.deleted).length);
const stored = page => page.evaluate(() =>
  JSON.parse(localStorage.getItem('navaid.routes') || '[]'));
const currentId = page => page.evaluate(() => currentRouteLibraryId);

test.describe('Edit-header Save / Load route buttons', () => {
  test('both buttons are labeled, on their own row above the Edit section', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#tool-save-route')).toContainText('Save route');
    await expect(page.locator('#tool-load-route')).toContainText('My routes');
    const geo = await page.evaluate(() => {
      const head = document.querySelector('.tb-section[data-sec="build"] .tb-section-head');
      const sv = document.getElementById('tool-save-route').getBoundingClientRect();
      return { inHead: !!document.getElementById('tool-save-route').closest('.tb-section-head'),
               above: sv.bottom <= head.getBoundingClientRect().top + 2 };
    });
    expect(geo.inHead).toBe(false);      // not tucked into the Edit header any more
    expect(geo.above).toBe(true);
    // Only one pair in this layout: the menubar's compact pair stays hidden.
    await expect(page.locator('#tool-save-route-wide')).toBeHidden();
  });

  test('in Hebrew (RTL) Save is on the right, the route name isolated on its own line', async ({ page }) => {
    await boot(page, 'he');
    await setRoute(page, ['LLHZ', 'BAZRA']);
    await page.evaluate(() => { routeLibrarySaveCurrent('LLHZ–BAZRA'); });
    await expect(page.locator('#tool-save-route .rf-label')).toHaveText('שמור');
    await expect(page.locator('#tool-save-route .rf-sub')).toHaveText('LLHZ–BAZRA');
    const geo = await page.evaluate(() => {
      const s = document.getElementById('tool-save-route').getBoundingClientRect();
      const l = document.getElementById('tool-load-route').getBoundingClientRect();
      // Side by side, Save leads -- on the right in Hebrew. Stacked (a large font, a narrow
      // panel), Save is on top.
      const sameRow = Math.abs(s.top - l.top) < 4;
      return { dir: document.documentElement.dir, leads: sameRow ? s.left > l.left : s.top < l.top,
        sub: document.querySelector('#tool-save-route .rf-sub').tagName };
    });
    expect(geo.dir).toBe('rtl');
    expect(geo.leads).toBe(true);
    expect(geo.sub).toBe('BDI');
  });

  test('Save shows which saved route it goes to, and a dot while there are unsaved changes', async ({ page }) => {
    await boot(page);
    await setRoute(page, ['A', 'B']);
    await expect(page.locator('#tool-save-route .rf-dot')).toBeVisible();   // a route, never saved
    await page.evaluate(() => { routeLibrarySaveCurrent('My Route'); });
    await expect(page.locator('#tool-save-route .rf-label')).toHaveText('Save');
    await expect(page.locator('#tool-save-route .rf-sub')).toHaveText('My Route');
    await expect(page.locator('#tool-save-route .rf-dot')).toBeHidden();    // just saved
    await expect(page.locator('#tool-load-route .rf-count')).toHaveText('1');
    await page.evaluate(() => { state.waypoints.push({ lat: 32.5, lng: 35.1, name: 'C' }); syncLegs(); draw(); persist(); });
    await expect(page.locator('#tool-save-route .rf-dot')).toBeVisible();   // changed since
  });

  test('Save is dimmed, not hidden, while there is nothing to save', async ({ page }) => {
    await boot(page);
    const save = page.locator('#tool-save-route');
    await expect(save).toBeVisible();
    await expect(save).toHaveClass(/is-dim/);
    await expect(save).toBeEnabled();      // still pressable: it says why there is nothing to save
    await setRoute(page, ['A', 'B']);
    await expect(save).not.toHaveClass(/is-dim/);
  });

  test('the flight plan carries the same row on a phone (the Plan tab)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => document.body.classList.add('deck-on'));
    await setRoute(page, ['A', 'B']);
    await page.evaluate(() => showFlightPlan());
    const row = page.locator('.fp-route-file-row');
    await expect(row.locator('.route-file-save')).toContainText('Save route');
    await row.locator('.route-file-load').click();
    await expect(page.locator('.route-library-modal')).toBeVisible();
  });

  test('Load route opens the Saved routes menu', async ({ page }) => {
    await boot(page);
    await page.locator('#tool-load-route').click();
    await expect(page.locator('.route-library-modal')).toBeVisible();
  });

  test('wide desktop shows the standalone pair; the in-header pair is hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() =>
      typeof showRouteLibraryModal === 'function' && document.querySelector('.tb-quick'));
    // Desktop-menubar: standalone pair visible, in-header pair hidden.
    await expect(page.locator('#tool-save-route-wide')).toBeVisible();
    await expect(page.locator('#tool-load-route-wide')).toBeVisible();
    // Compact at 1280: the icons, the tooltip says what they do (labels from 1440 px).
    await expect(page.locator('#tool-save-route-wide')).toHaveAttribute('title', /Save route/);
    await expect(page.locator('#tool-save-route')).toBeHidden();
    // Load opens the Saved routes menu.
    await page.locator('#tool-load-route-wide').click();
    await expect(page.locator('.route-library-modal')).toBeVisible();
  });

  test('Save on an empty route shows an error and does not open the menu', async ({ page }) => {
    await boot(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.evaluate(() => {
      window.__said = [];
      const real = window.showToast;
      window.showToast = (m, o) => { window.__said.push(String(m)); return real && real(m, o); };
    });
    // No route built — nothing to save.
    await page.locator('#tool-save-route').click();
    await expect(page.locator('.route-library-modal')).toHaveCount(0);
    // Said out loud through either channel -- the refusal is a toast now.
    const said = dialogs.concat(await page.evaluate(() => window.__said));
    expect(said.some(m => /nothing to save|two waypoints/i.test(m))).toBe(true);
    expect(await libLen(page)).toBe(0);
  });

  test('Save on an unsaved route opens the Saved routes menu (no silent save)', async ({ page }) => {
    await boot(page);
    let dialogs = 0;
    page.on('dialog', d => { dialogs++; d.accept(); });
    await setRoute(page, ['A', 'B']);
    expect(await currentId(page)).toBeNull();

    await page.locator('#tool-save-route').click();
    await expect(page.locator('.route-library-modal')).toBeVisible();
    // Name is pre-suggested from the first → last waypoints.
    await expect(page.locator('.route-library-modal .route-library-name'))
      .toHaveValue('A → B');
    expect(await libLen(page)).toBe(0);   // nothing saved yet — menu just opened
    expect(dialogs).toBe(0);              // no confirm on an unsaved route
  });

  test('Hebrew suggests the name with the direction in words', async ({ page }) => {
    await boot(page, 'he');
    await answerAppDialogs(page, true);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.2, lng: 34.8, name: 'שפיים' },
        { lat: 31.8, lng: 34.65, name: 'צומת אשדוד' },
      ];
      state.legs = []; syncLegs(); draw();
    });
    await page.locator('#tool-save-route').click();
    // Was "שפיים ← צומת אשדוד". The arrow is a bidi neutral: with a Latin code at one end
    // it gets reordered, so an out-and-back pair read almost identically in the saved-route
    // list -- and that list now also chooses which direction gets FILED. Words say it the
    // same way whichever side the endpoints fall on.
    await expect(page.locator('.route-library-modal .route-library-name'))
      .toHaveValue('מ־שפיים אל צומת אשדוד');
  });

  test('Save on a changed saved route asks in the app, and Save over it overwrites the same entry', async ({ page }) => {
    await boot(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await setRoute(page, ['A', 'B']);

    // Save it once through the menu → becomes the tracked entry.
    await page.locator('#tool-save-route').click();
    const modal = page.locator('.route-library-modal');
    await modal.locator('.route-library-name').fill('My Route');
    await modal.getByRole('button', { name: 'Save current route' }).click();
    await expect(modal.locator('.route-library-row')).toHaveCount(1);
    const id1 = await currentId(page);
    expect(id1).not.toBeNull();
    await modal.locator('.modal-close-x').click();

    // Edit the route, then Save again from the header → overwrites in place.
    await setRoute(page, ['A', 'B', 'C']);
    await page.locator('#tool-save-route').click();
    const ask = page.locator('.route-overwrite-modal');
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('My Route');
    await ask.getByRole('button', { name: /Save over it/ }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.locator('.route-library-modal')).toHaveCount(0);   // no menu; overwrote
    expect(dialogs).toEqual([]);          // never a browser dialog: silent in the APK

    const all = await stored(page);
    expect(all.filter(e => e && !e.deleted).length).toBe(1);             // still one entry
    expect(all[0].id).toBe(id1);                                         // same id
    expect(all[0].data.waypoints.length).toBe(3);                        // updated content
  });

  test('Save as a new route opens the menu to name it and leaves the saved one alone', async ({ page }) => {
    await boot(page);
    await setRoute(page, ['A', 'B']);
    await page.evaluate(() => { routeLibrarySaveCurrent('Kept'); });
    await setRoute(page, ['A', 'B', 'C']);
    await page.locator('#tool-save-route').click();
    await page.locator('.route-overwrite-modal').getByRole('button', { name: /new route/ }).click();
    await expect(page.locator('.route-library-modal')).toBeVisible();
    const all = await stored(page);
    expect(all.filter(e => e && !e.deleted).length).toBe(1);
    expect(all[0].data.waypoints.length).toBe(2);                        // untouched
  });

  test('Save with no changes since saving says so and asks nothing', async ({ page }) => {
    await boot(page);
    await setRoute(page, ['A', 'B']);
    await page.evaluate(() => { routeLibrarySaveCurrent('Same'); });
    await page.locator('#tool-save-route').click();
    await expect(page.locator('.route-overwrite-modal')).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('Same');
  });

  test('opening Saved routes via the toolbar button does not prefill the name field', async ({ page }) => {
    await boot(page);
    await setRoute(page, ['A', 'B']);
    await page.locator('#route-library').click();
    const modal = page.locator('.route-library-modal');
    await expect(modal).toBeVisible();
    // Browsing the menu must not auto-fill/steal the name field (only the
    // header Save shortcut on an unsaved route does that).
    await expect(modal.locator('.route-library-name')).toHaveValue('');
  });

  test('undo clears the tracked saved-route id so Save cannot overwrite the wrong entry', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      currentRouteLibraryId = 'X';
      undoStack.push(JSON.stringify({
        waypoints: [{ lat: 32, lng: 34, name: 'A' }, { lat: 33, lng: 35, name: 'B' }],
        legs: [], notes: [],
      }));
      undo();
    });
    expect(await currentId(page)).toBeNull();
  });

  test('clearing the route makes Save open the menu again', async ({ page }) => {
    await boot(page);
    await answerAppDialogs(page, true);
    await setRoute(page, ['A', 'B']);
    await page.evaluate(() => { currentRouteLibraryId = 'someid'; });
    // Clear the route via the toolbar Clear button.
    await page.locator('#clear').click();
    expect(await currentId(page)).toBeNull();
  });

  test('deleting the tracked saved route clears its id so Save cannot overwrite a tombstone', async ({ page }) => {
    await boot(page);
    await answerAppDialogs(page, true);
    await setRoute(page, ['A', 'B']);
    // Save through the menu → this becomes the tracked entry.
    await page.locator('#tool-save-route').click();
    const modal = page.locator('.route-library-modal');
    await modal.locator('.route-library-name').fill('My Route');
    await modal.getByRole('button', { name: 'Save current route' }).click();
    await expect(modal.locator('.route-library-row')).toHaveCount(1);
    expect(await currentId(page)).not.toBeNull();
    // Delete that entry → the tracked id must clear (else a later header Save
    // would overwrite the now-tombstoned entry).
    await modal.locator('.route-library-del').first().click();
    await expect(modal.locator('.route-library-row')).toHaveCount(0);
    expect(await currentId(page)).toBeNull();
  });

  test('importing a file with no valid routes shows a toast and writes nothing', async ({ page }) => {
    await boot(page);
    await page.locator('#route-library').click();
    const modal = page.locator('.route-library-modal');
    await expect(modal).toBeVisible();
    // A JSON array whose entries carry no route `data` → nothing to import.
    await modal.locator('input[type="file"]').setInputFiles({
      name: 'bad.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ name: 'no-data' }, { foo: 1 }])),
    });
    await expect(page.locator('.toast')).toContainText(/no valid routes/i);
    expect(await libLen(page)).toBe(0);                 // nothing written
  });
});

test('a route clicked on the map, with no names, is named by date in the interface language', async ({ page }) => {
  await page.goto('?lang=he');
  await page.waitForFunction(() => typeof defaultSavedRouteName === 'function' && typeof state !== 'undefined');
  const name = await page.evaluate(() => {
    // Out at sea: no chart point within 5 NM to name them by.
    state.waypoints = [0, 1].map(i => ({ lat: 32.3 + i * 0.1, lng: 34.2, name: '' }));
    return defaultSavedRouteName();
  });
  expect(name).toMatch(/^מסלול \d\d\.\d\d \d\d:\d\d$/);
});

test('an unnamed end point is suggested by the nearest chart point, the waypoint left unnamed', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof defaultSavedRouteName === 'function' && typeof nearestReference === 'function'
    && Array.isArray(window.airfields || (typeof airfields !== 'undefined' ? airfields : null)) && (typeof airfields !== 'undefined' && airfields.length > 0));
  const out = await page.evaluate(() => {
    const hz = airfields.find(a => a.name === 'LLHZ');
    const bg = airfields.find(a => a.name === 'LLBG');
    // Clicked on the map a few hundred metres from each field: no names.
    state.waypoints = [
      { lat: hz.lat + 0.003, lng: hz.lng + 0.003, name: '' },
      { lat: bg.lat - 0.003, lng: bg.lng + 0.003, name: '' },
    ];
    return { name: defaultSavedRouteName(), wp0: state.waypoints[0].name };
  });
  expect(out.name).toMatch(/^LLHZ.*→.*LLBG/);
  expect(out.wp0).toBe('');
});

test('the desktop menubar stays one row at 1280 px, with words from 1440 px', async ({ page }) => {
  for (const [w, labeled, lang] of [[1280, false, 'en'], [1280, false, 'he'], [1500, true, 'en']]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto('?lang=' + lang);
    await page.waitForFunction(() => document.querySelector('.tb-quick') && typeof routeLibrarySaveCurrent === 'function');
    // The widest it gets: a two-digit route count and the unsaved-changes dot.
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.2, lng: 34.93, name: 'BAZRA' }]; syncLegs(); draw();
      for (let i = 0; i < 12; i++) routeLibrarySaveCurrent('R' + i);
      state.waypoints.push({ lat: 32.4, lng: 34.9, name: 'HADRA' }); syncLegs(); draw(); persist();
    });
    await page.waitForTimeout(100);
    const out = await page.evaluate(() => ({
      h: document.getElementById('toolbar').getBoundingClientRect().height,
      label: getComputedStyle(document.querySelector('#tool-save-route-wide .rf-text')).display,
    }));
    if (!labeled) expect(out.h).toBeLessThan(50);
    expect(out.label === 'none').toBe(!labeled);
  }
});

for (const lang of ['en', 'he']) test(`the Zulu clock stays below the desktop menubar when a live readout wraps it onto two rows (${lang})`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => document.querySelector('.leaflet-control.zulu-clock') && document.getElementById('gps-readout'));
  const gap = () => page.evaluate(() => {
    const tb = document.getElementById('toolbar').getBoundingClientRect();
    const clock = document.querySelector('.leaflet-control.zulu-clock').getBoundingClientRect();
    return { rows: tb.height > 50 ? 2 : 1, clear: clock.top >= tb.bottom };
  });
  expect(await gap()).toEqual({ rows: 1, clear: true });
  // What a live position does: the readout joins the bar and wraps it.
  // (Stood in for by a wide element in the same place: the readout only shows with a fix.)
  await page.evaluate(() => {
    const s = document.createElement('span');
    s.style.cssText = 'display:inline-block;width:420px;height:20px';
    document.getElementById('footer-links').appendChild(s);
  });
  await page.waitForFunction(() => document.getElementById('toolbar').getBoundingClientRect().height > 50);
  await page.waitForTimeout(100);
  expect(await gap()).toEqual({ rows: 2, clear: true });
});
