// Edit-header Save / Load route buttons.
//   Load route  -> always opens the Saved routes menu.
//   Save route  -> if the current route was loaded from (or saved as) a
//                  library entry, overwrite that same entry after a confirm
//                  warning; otherwise open the Saved routes menu to name it.
const { test, expect } = require('./_setup');

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
  test('both buttons render on the leading side of the Edit header', async ({ page }) => {
    await boot(page);
    const save = page.locator('#tool-save-route');
    const load = page.locator('#tool-load-route');
    await expect(save).toBeVisible();
    await expect(load).toBeVisible();
    // Buttons sit inside the "Edit" (build) section header, before the label.
    const geo = await page.evaluate(() => {
      const head = document.querySelector('.tb-section[data-sec="build"] .tb-section-head');
      const sv = document.getElementById('tool-save-route').getBoundingClientRect();
      const title = head.querySelector('.tb-section-title').getBoundingClientRect();
      return { inHead: !!document.getElementById('tool-save-route').closest('.tb-section-head'),
               saveLeftOfTitle: sv.x < title.x };
    });
    expect(geo.inHead).toBe(true);
    expect(geo.saveLeftOfTitle).toBe(true);   // LTR: leading side is the left
  });

  test('in Hebrew (RTL) the buttons sit on the right of the Edit header', async ({ page }) => {
    await boot(page, 'he');
    const geo = await page.evaluate(() => {
      const head = document.querySelector('.tb-section[data-sec="build"] .tb-section-head');
      const sv = document.getElementById('tool-save-route').getBoundingClientRect();
      const title = head.querySelector('.tb-section-title').getBoundingClientRect();
      return { dir: document.documentElement.dir, saveRightOfTitle: sv.x > title.x };
    });
    expect(geo.dir).toBe('rtl');
    expect(geo.saveRightOfTitle).toBe(true);
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
    await expect(page.locator('#tool-save-route')).toBeHidden();
    // Load opens the Saved routes menu.
    await page.locator('#tool-load-route-wide').click();
    await expect(page.locator('.route-library-modal')).toBeVisible();
  });

  test('Save on an empty route shows an error and does not open the menu', async ({ page }) => {
    await boot(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    // No route built — nothing to save.
    await page.locator('#tool-save-route').click();
    await expect(page.locator('.route-library-modal')).toHaveCount(0);
    expect(dialogs.some(m => /nothing to save|two waypoints/i.test(m))).toBe(true);
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

  test('Hebrew suggests the name with a left arrow (first ← last)', async ({ page }) => {
    await boot(page, 'he');
    page.on('dialog', d => d.accept());
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.2, lng: 34.8, name: 'שפיים' },
        { lat: 31.8, lng: 34.65, name: 'צומת אשדוד' },
      ];
      state.legs = []; syncLegs(); draw();
    });
    await page.locator('#tool-save-route').click();
    await expect(page.locator('.route-library-modal .route-library-name'))
      .toHaveValue('שפיים ← צומת אשדוד');
  });

  test('Save on a loaded route overwrites the same entry after a warning', async ({ page }) => {
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
    await expect(page.locator('.route-library-modal')).toHaveCount(0);   // no menu; overwrote
    expect(dialogs.some(m => /overwrite|my route/i.test(m))).toBe(true); // warned

    const all = await stored(page);
    expect(all.filter(e => e && !e.deleted).length).toBe(1);             // still one entry
    expect(all[0].id).toBe(id1);                                         // same id
    expect(all[0].data.waypoints.length).toBe(3);                        // updated content
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
    page.on('dialog', d => d.accept());
    await setRoute(page, ['A', 'B']);
    await page.evaluate(() => { currentRouteLibraryId = 'someid'; });
    // Clear the route via the toolbar Clear button.
    await page.locator('#clear').click();
    expect(await currentId(page)).toBeNull();
  });
});
