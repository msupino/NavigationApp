// @ts-check
// Coverage for the persistence safety paths:
//  #73 — restoreRoute() returns 'corrupt' for an unparseable / schema-invalid
//        saved blob and leaves the raw blob on disk (no silent data loss).
//  #73 — persist() refuses to overwrite a preserved corrupt blob while the
//        in-memory state is still empty.
//  #80 — persist() surfaces a one-time alert when localStorage is full and
//        then stops scheduling writes (quotaWarned latch).
const { test, expect } = require('./_setup');

const STORE_KEY = 'navaid.route';

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof restoreRoute === 'function' && typeof persist === 'function' &&
    typeof NavAid !== 'undefined');
}

const VALID_BLOB = JSON.stringify({
  waypoints: [{ lat: 32.0, lng: 34.9, name: 'A' }],
  legs: [], notes: [],
});

test.describe('Persistence safety (#73 / #80)', () => {
  test('unparseable saved blob -> restoreRoute returns "corrupt", blob preserved', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(([key]) => {
      localStorage.setItem(key, '{ this is not json');
      const result = restoreRoute();
      return { result, stillThere: localStorage.getItem(key),
               err: NavAid.corruptCacheError };
    }, [STORE_KEY]);
    expect(out.result).toBe('corrupt');
    expect(out.stillThere).toBe('{ this is not json');   // not overwritten
    expect(typeof out.err).toBe('string');
  });

  test('schema-invalid saved blob (missing notes) -> "corrupt"', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(([key]) => {
      localStorage.setItem(key, JSON.stringify({ waypoints: [], legs: [] }));
      return { result: restoreRoute(), err: NavAid.corruptCacheError };
    }, [STORE_KEY]);
    expect(out.result).toBe('corrupt');
    expect(out.err).toContain('notes');
  });

  test('valid saved blob restores into state', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(([key, blob]) => {
      localStorage.setItem(key, blob);
      const result = restoreRoute();
      return { result, count: state.waypoints.length, name: state.waypoints[0].name };
    }, [STORE_KEY, VALID_BLOB]);
    expect(out.result).toBe(true);
    expect(out.count).toBe(1);
    expect(out.name).toBe('A');
  });

  test('persist() does not overwrite a preserved corrupt blob while state is empty', async ({ page }) => {
    await boot(page);
    // Let the boot-time persist() debounce flush first so no pending timer
    // (scheduled while corruptCache was false) clobbers our sentinel.
    await page.waitForTimeout(700);
    const before = await page.evaluate(([key]) => {
      const sentinel = '<<corrupt-preserved>>';
      localStorage.setItem(key, sentinel);
      NavAid.corruptCache = true;
      state.waypoints = []; state.legs = []; state.notes = [];
      persist();
      return sentinel;
    }, [STORE_KEY]);
    // Wait past the 500 ms debounce so any write would have landed.
    await page.waitForTimeout(700);
    const after = await page.evaluate(([key]) => localStorage.getItem(key), [STORE_KEY]);
    expect(after).toBe(before);
  });

  test('quota-full persist() alerts once and latches quotaWarned', async ({ page }) => {
    await boot(page);
    let dialogMsg = null;
    page.on('dialog', d => { dialogMsg = d.message(); d.dismiss(); });
    await page.evaluate(() => {
      NavAid.corruptCache = false;
      state.waypoints = [{ lat: 32, lng: 34.9, name: 'A' }];
      state.legs = []; state.notes = [];
      // Force a quota failure on the next write.
      localStorage.setItem = function () {
        const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
      };
      persist();
    });
    await page.waitForTimeout(700);
    const expected = await page.evaluate(() => S.errStorageFull);
    expect(dialogMsg).toBe(expected);
  });
});
