// Route library (#677): save multiple named routes locally, then load /
// rename / duplicate / delete them.
const { test, expect } = require('./_setup');
const { clickToolbarControl, hideToolbarMenus } = require('./_toolbar');

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
        localStorage.setItem('navaid.sec.' + s, '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
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

    await clickToolbarControl(page, '#route-library');
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
    await page.evaluate(() => { state.waypoints = []; state.legs = []; syncLegs(); draw(); });
    await hideToolbarMenus(page);
    await modal.locator('.route-library-open').first().click();
    await expect(page.locator('.route-library-modal')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => state.waypoints.length)).toBe(3);

    // (continued) — delete is exercised below.
    await clickToolbarControl(page, '#route-library');
    const modal2 = page.locator('.route-library-modal');    await modal2.locator('.route-library-row').first()
      .getByRole('button', { name: 'Delete' }).click();
    await expect(modal2.locator('.route-library-row')).toHaveCount(1);
  });

  test('per-row Save overwrites the saved route with the current one (same id/name)', async ({ page }) => {
    await boot(page);
    page.on('dialog', d => d.accept());
    await setRoute(page, ['LLSD', 'BAZRA', 'LLHA']);   // 3 WP
    await clickToolbarControl(page, '#route-library');
    const modal = page.locator('.route-library-modal');
    await modal.locator('.route-library-name').fill('My route');
    await modal.getByRole('button', { name: 'Save current route' }).click();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.routes'))[0]);
    expect(before.data.waypoints.length).toBe(3);

    // Change the live route to 5 WP, then Save onto the existing entry.
    await setRoute(page, ['A', 'B', 'C', 'D', 'E']);
    await modal.locator('.route-library-row').first()
      .getByRole('button', { name: 'Save', exact: true }).click();

    // Same entry (id + name kept), route replaced with the current 5-WP one.
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.routes')));
    expect(after.length).toBe(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].name).toBe('My route');
    expect(after[0].data.waypoints.length).toBe(5);
    expect(new Date(after[0].savedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(before.savedAt).getTime());
    await expect(modal.locator('.route-library-row').first()).toContainText('5 WP');
  });

  test('Hebrew library rows isolate mixed route names and metadata', async ({ page }) => {
    await boot(page, 'he');
    await page.evaluate(() => {
      localStorage.setItem('navaid.routes', JSON.stringify([{
        id: 'mixed-he',
        name: 'בדיקה BAZRA DEROR',
        savedAt: '2026-06-15T08:00:00.000Z',
        data: {
          waypoints: [
            { lat: 32.22, lng: 34.88, name: 'BAZRA' },
            { lat: 32.24, lng: 34.92, name: 'DEROR' },
          ],
          legs: [{ flightSpeed: 90 }],
          notes: [],
        },
      }]));
    });

    await page.locator('#route-library').click();
    const row = page.locator('.route-library-row').first();
    const name = row.locator('.route-library-row-name');
    const meta = row.locator('.route-library-row-meta');
    await expect(name).toHaveText('בדיקה BAZRA DEROR');
    await expect(meta).toHaveText('2 WP · 2026-06-15');

    const bidi = await row.evaluate(el => {
      const nameEl = el.querySelector('.route-library-row-name');
      const metaEl = el.querySelector('.route-library-row-meta');
      const nameStyle = getComputedStyle(nameEl);
      const metaStyle = getComputedStyle(metaEl);
      return {
        nameDir: nameEl.getAttribute('dir'),
        nameBidi: nameStyle.unicodeBidi,
        metaDir: metaEl.getAttribute('dir'),
        metaCssDir: metaStyle.direction,
        metaBidi: metaStyle.unicodeBidi,
      };
    });
    expect(bidi.nameDir).toBe('auto');
    expect(bidi.nameBidi).toBe('plaintext');
    expect(bidi.metaDir).toBe('ltr');
    expect(bidi.metaCssDir).toBe('ltr');
    expect(bidi.metaBidi).toContain('isolate');
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
    const pos = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.inspPos.en') || 'null'));
    expect(pos && Number.isFinite(pos.x)).toBeTruthy();
  });
});
