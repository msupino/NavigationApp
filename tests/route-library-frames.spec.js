// @ts-check
// A saved route is a plan you load and fly. A recording is what happened, and is never
// loaded over the route on the map. They were one list, told apart only by the buttons on
// each row -- so the shape of the list changed as you scrolled it. Two frames now, and a
// filter, because a pilot with a season of recordings opens this menu to find a ROUTE.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showRouteLibraryModal === 'function'
    && typeof persistRouteLibrary === 'function');
}

async function seed(page, routes, tracks) {
  await page.evaluate(([r, t]) => {
    const all = [];
    for (let i = 0; i < r; i++) {
      all.push({ id: 'r' + i, name: 'route ' + i, savedAt: new Date().toISOString(),
        data: { waypoints: [{ lat: 32, lng: 34.9, name: 'A' }, { lat: 32.2, lng: 35, name: 'B' }],
          legs: [{ inboundAltitude: 2000, flightSpeed: 100 }], notes: [] } });
    }
    for (let i = 0; i < t; i++) {
      all.push({ id: 't' + i, name: 'flight ' + i, kind: 'gps', savedAt: new Date().toISOString(),
        track: [{ lat: 32, lng: 34.9, t: 1, alt: 100 }, { lat: 32.1, lng: 35, t: 60000, alt: 200 }] });
    }
    persistRouteLibrary(all);
  }, [routes, tracks]);
}

const open = async (page) => {
  await page.evaluate(() => {
    document.querySelectorAll('.modal-back.route-library').forEach(n => n.remove());
    showRouteLibraryModal();
  });
  await page.waitForSelector('.route-library-list');
};

const groups = (page) => page.evaluate(() => [...document.querySelectorAll('.route-library-group')]
  .map(g => ({
    head: g.querySelector('.route-library-group-head').textContent.trim(),
    rows: g.querySelectorAll('.route-library-row').length,
  })));

test('plans and recordings get a frame each, plans first', async ({ page }) => {
  await boot(page);
  await seed(page, 2, 3);
  await open(page);
  const seen = await groups(page);
  expect(seen.length).toBe(2);
  expect(seen[0].head).toMatch(/^Saved routes/);
  expect(seen[0].rows).toBe(2);
  expect(seen[1].head).toMatch(/^Recordings/);
  expect(seen[1].rows).toBe(3);
  // Each frame says how many it holds, so the count is readable without counting.
  expect(seen[0].head).toContain('2');
  expect(seen[1].head).toContain('3');
});

test('a frame with nothing in it is not drawn', async ({ page }) => {
  await boot(page);
  await seed(page, 2, 0);
  await open(page);
  const seen = await groups(page);
  // An empty "Recordings" heading is a question, not an answer.
  expect(seen.length).toBe(1);
  expect(seen[0].head).toMatch(/^Saved routes/);
});

test('the dropdown picks one kind, and is remembered', async ({ page }) => {
  await boot(page);
  await seed(page, 2, 3);
  await open(page);
  await page.selectOption('.route-library-filter-select', 'gps');
  let seen = await groups(page);
  expect(seen.length).toBe(1);
  expect(seen[0].head).toMatch(/^Recordings/);
  expect(seen[0].rows).toBe(3);

  await page.selectOption('.route-library-filter-select', 'route');
  seen = await groups(page);
  expect(seen[0].head).toMatch(/^Saved routes/);
  expect(seen[0].rows).toBe(2);

  // Closed, reopened -- and on a later visit entirely: a pilot who filtered to routes was
  // looking for a route, and is probably still looking when they come back.
  await open(page);
  expect(await page.evaluate(() => document.querySelector('.route-library-filter-select').value)).toBe('route');
  await page.reload();
  await page.waitForFunction(() => typeof showRouteLibraryModal === 'function');
  await open(page);
  expect(await page.evaluate(() => document.querySelector('.route-library-filter-select').value)).toBe('route');
  expect((await groups(page))[0].head).toMatch(/^Saved routes/);
});

test('a filter that hides everything says so, and stays on screen', async ({ page }) => {
  await boot(page);
  await seed(page, 2, 0);
  await open(page);
  await page.selectOption('.route-library-filter-select', 'gps');
  // A library that looks empty because of a choice the pilot forgot making is worse than one
  // that is actually empty -- so the control that did it has to still be there.
  await expect(page.locator('.route-library-empty')).toHaveText(/No recordings/);
  await expect(page.locator('.route-library-filter')).toBeVisible();
  await page.selectOption('.route-library-filter-select', 'all');
  expect((await groups(page)).length).toBe(1);
});

test('an empty library offers no filter to get lost in', async ({ page }) => {
  await boot(page);
  await seed(page, 0, 0);
  await open(page);
  await expect(page.locator('.route-library-empty')).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('.route-library-filter').hidden)).toBe(true);
});
