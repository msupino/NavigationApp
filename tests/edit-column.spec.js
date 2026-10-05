// @ts-check
// The edit column (phone and desktop): the Build menu's first four commands -- Add waypoint, Add note,
// Undo, Clear map, in that order -- as round buttons at the top left, the other side from the
// in-flight column. Requested: "on mobile, I want some edit buttons ... opposite side of the
// live buttons", "in the same order like the edit menu", "each button is activate/deactivate".
const { test, expect, answerAppDialogs } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function boot(page, size) {
  await page.setViewportSize(size || PHONE);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setMode === 'function' && !!document.getElementById('edit-col-add'));
}

test('on a phone: four buttons, top left, in the menu\'s order, drawn icons', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const col = document.querySelector('.edit-col-ctrl');
    const r = col.getBoundingClientRect();
    return {
      ids: [...col.querySelectorAll('button')].map(b => b.id),
      icons: [...col.querySelectorAll('button')].map(b => b.dataset.icon),
      left: r.left, top: r.top, visible: getComputedStyle(col).display !== 'none',
      stripBottom: (document.querySelector('.deck-strip, #deck-strip') || { getBoundingClientRect: () => ({ bottom: 0 }) })
        .getBoundingClientRect().bottom,
    };
  });
  expect(out.visible).toBe(true);
  expect(out.ids).toEqual(['edit-col-add', 'edit-col-note', 'edit-col-undo', 'edit-col-clear']);
  expect(out.icons).toEqual(['addWp', 'addNote', 'undo', 'clearMap']);
  expect(out.left).toBeLessThan(40);                 // the left edge, opposite the live column
  expect(out.top).toBeGreaterThanOrEqual(out.stripBottom);   // below the top strip, not under it
});

test('on a desktop too: below the menubar and the search card, clear of the legend', async ({ page }) => {
  await boot(page, { width: 1280, height: 800 });
  const out = await page.evaluate(() => {
    const box = sel => { const e = document.querySelector(sel); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; };
    const col = box('.edit-col-ctrl'), search = box('#search-overlay'), legend = box('#map-legend');
    const hit = (a, b) => !!(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    return { shown: !!col, left: col && col.left, onSearch: hit(col, search), onLegend: hit(col, legend) };
  });
  expect(out.shown).toBe(true);
  expect(out.left).toBeLessThan(40);
  expect(out.onSearch).toBe(false);
  expect(out.onLegend).toBe(false);
});

test('a short phone: the open legend steps clear of the column', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.legendCollapsed', '0'); } catch (e) {} });
  await boot(page, { width: 360, height: 640 });
  await page.waitForTimeout(300);
  const hit = await page.evaluate(() => {
    const a = document.querySelector('.edit-col-ctrl').getBoundingClientRect();
    const b = document.getElementById('map-legend').getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  expect(hit).toBe(false);
});

test('add mode has no chip over the chart: the lit Add button is the cue and the way out', async ({ page }) => {
  for (const size of [PHONE, { width: 1280, height: 800 }]) {
    await boot(page, size);
    await page.locator('#edit-col-add').click();
    expect(await page.evaluate(() => state.mode)).toBe('add');
    await expect(page.locator('#mode-chip')).toHaveCount(0);
    await expect(page.locator('#edit-col-add')).toHaveClass(/edit-col-on/);
    await page.locator('#edit-col-add').click();
    expect(await page.evaluate(() => state.mode)).toBeNull();
  }
});

test('Add waypoint and Add note each switch on and off, and only one at a time', async ({ page }) => {
  await boot(page);
  const add = page.locator('#edit-col-add');
  const note = page.locator('#edit-col-note');
  await add.click();
  expect(await page.evaluate(() => state.mode)).toBe('add');
  await expect(add).toHaveClass(/edit-col-on/);
  await note.click();
  expect(await page.evaluate(() => state.mode)).toBe('note');
  await expect(add).not.toHaveClass(/edit-col-on/);
  await expect(note).toHaveClass(/edit-col-on/);
  await note.click();                                   // again: off
  expect(await page.evaluate(() => state.mode)).toBe(null);
  await expect(note).not.toHaveClass(/edit-col-on/);
});

test('Undo is dim until there is something to undo, then undoes', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#edit-col-undo')).toBeDisabled();
  await page.locator('#edit-col-add').click();
  await page.evaluate(() => map.fire('click', { latlng: map.getCenter() }));
  await expect.poll(() => page.evaluate(() => state.waypoints.length)).toBe(1);
  await expect(page.locator('#edit-col-undo')).toBeEnabled();
  await page.locator('#edit-col-undo').click();
  await expect.poll(() => page.evaluate(() => state.waypoints.length)).toBe(0);
});

test('Clear map asks first, in the app, then clears', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.8, lng: 35.04, name: 'LLHA' }];
    syncLegs(); draw();
  });
  await answerAppDialogs(page, false);
  await page.locator('#edit-col-clear').click();
  await expect(page.locator('.follow-me-ask-modal')).toHaveCount(0);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(2);   // Cancel: kept
  await answerAppDialogs(page, true);
  await page.locator('#edit-col-clear').click();
  await expect.poll(() => page.evaluate(() => state.waypoints.length)).toBe(0);
});

test('while the route is locked, Add waypoint and Add note are dimmed, not hidden', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.editLocked = true; refreshEditLockControl(); });
  await expect(page.locator('#edit-col-add')).toHaveClass(/is-dim/);
  await expect(page.locator('#edit-col-note')).toHaveClass(/is-dim/);
  await expect(page.locator('#edit-col-add')).toBeVisible();
});

test('Hebrew desktop: top left like English, and the inspector opens beside it, not over it', async ({ page }) => {
  for (const [w, h] of [[1280, 800], [1024, 600]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof showInspector === 'function' && !!document.getElementById('edit-col-add'));
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.05, lng: 34.81, name: 'B' }]; syncLegs();
      state.selected = { type: 'wp', index: 1 }; showInspector(); draw();
      const r = sel => { const e = document.querySelector(sel); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; };
      const hit = (a, b) => !!(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      const col = r('.edit-col-ctrl');
      return { left: col.left < 40, column: col.height > col.width, onInspector: hit(col, r('#inspector')), onSearch: hit(col, r('#search-overlay')) };
    });
    expect(out).toEqual({ left: true, column: true, onInspector: false, onSearch: false });
  }
});
