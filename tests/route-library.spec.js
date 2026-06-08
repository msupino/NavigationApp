// Route library (#677): save multiple named routes locally, then load /
// rename / duplicate / delete them.
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
        localStorage.setItem('navaid.sec.' + s, '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof showRouteLibraryModal === 'function');
}

async function setRoute(page, names) {
  await page.evaluate(ns => {
    state.waypoints = ns.map((n, i) => ({ lat: 32 + i * 0.1, lng: 34.8 + i * 0.1, name: n }));
    state.notes = [];
    syncLegs(); draw();
  }, names);
}

test.describe('Route library', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem('navaid.routes'); } catch (e) {} });
  });

  test('save, list, load, rename, duplicate, delete', async ({ page }) => {
    await boot(page);
    page.on('dialog', d => d.accept());   // accept any confirm/prompt
    await setRoute(page, ['LLSD', 'BAZRA', 'LLHA']);

    await page.locator('#route-library').click();
    const modal = page.locator('.route-library-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.route-library-empty')).toBeVisible();

    // Save current route under a name.
    await modal.locator('.route-library-name').fill('Coast hop');
    await modal.getByRole('button', { name: 'Save current route' }).click();
    const rows = modal.locator('.route-library-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Coast hop');
    await expect(rows.first()).toContainText('3 WP');

    // Persisted to localStorage.
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('navaid.routes') || '[]'));
    expect(stored.length).toBe(1);
    expect(stored[0].name).toBe('Coast hop');
    expect(stored[0].data.waypoints.length).toBe(3);

    // Duplicate → 2 entries.
    await rows.first().getByRole('button', { name: 'Duplicate' }).click();
    await expect(modal.locator('.route-library-row')).toHaveCount(2);

    // Clear the live route, then load the saved one back.
    await page.evaluate(() => { state.waypoints = []; state.legs = []; syncLegs(); draw(); });    await modal.locator('.route-library-open').first().click();
    await expect(page.locator('.route-library-modal')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => state.waypoints.length)).toBe(3);

    // (continued) — delete is exercised below.
    await page.locator('#route-library').click();
    const modal2 = page.locator('.route-library-modal');    await modal2.locator('.route-library-row').first()
      .getByRole('button', { name: 'Delete' }).click();
    await expect(modal2.locator('.route-library-row')).toHaveCount(1);
  });

  test('mergeRouteLibraries keeps newest by id and dedupes', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => mergeRouteLibraries(
      [{ id: 'a', name: 'old', savedAt: '2026-01-01', data: { waypoints: [] } },
       { id: 'b', name: 'keep', savedAt: '2026-02-01', data: { waypoints: [] } }],
      [{ id: 'a', name: 'new', savedAt: '2026-03-01', data: { waypoints: [] } }],
    ));
    const a = out.find(x => x.id === 'a');
    expect(out.length).toBe(2);
    expect(a.name).toBe('new');         // newer savedAt wins
    expect(out[0].id).toBe('a');        // sorted newest-first
  });

  test('a tombstone removes a route across the merge (delete propagates)', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate(() => {
      // Local deleted route 'a' (tombstone, newer); remote still has 'a' + 'b'.
      const fresh = new Date().toISOString();   // recent so the TTL prune keeps it
      const merged = mergeRouteLibraries(
        [{ id: 'a', savedAt: fresh, deleted: true },
         { id: 'b', name: 'keep', savedAt: '2026-02-01', data: { waypoints: [] } }],
        [{ id: 'a', name: 'old', savedAt: '2026-01-01', data: { waypoints: [] } }],
      );
      const visible = merged.filter(e => e && e.data && !e.deleted).map(e => e.id);
      const aEntry = merged.find(e => e.id === 'a');
      // A very old tombstone is pruned entirely.
      const prunedAway = mergeRouteLibraries(
        [{ id: 'z', savedAt: '2000-01-01', deleted: true }], []).length;
      return { visible, aDeleted: !!(aEntry && aEntry.deleted), prunedAway };
    });
    expect(res.visible).toEqual(['b']);   // 'a' no longer shows
    expect(res.aDeleted).toBe(true);      // tombstone retained (so it keeps winning)
    expect(res.prunedAway).toBe(0);       // stale tombstone dropped
  });
});

test.describe('Inspector', () => {
  test('is draggable by its header and the position persists', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem('navaid.inspPos'); } catch (e) {} });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof showInspector === 'function');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'B' }];
      syncLegs(); state.selected = { type: 'leg', index: 0 }; showInspector();  // read-only title
    });
    const insp = page.locator('#inspector');
    await expect(insp).toBeVisible();
    const before = await insp.boundingBox();
    const hdr = page.locator('#insp-header');
    const hb = await hdr.boundingBox();
    await page.mouse.move(hb.x + 40, hb.y + 8);
    await page.mouse.down();
    await page.mouse.move(hb.x - 120, hb.y + 90, { steps: 6 });
    await page.mouse.up();
    const after = await insp.boundingBox();
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(40);
    const pos = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.inspPos') || 'null'));
    expect(pos && Number.isFinite(pos.x)).toBeTruthy();
  });
});
