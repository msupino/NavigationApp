// @ts-check
// The offline-maps window has to open twice.
//
// It guards itself with a module-level `manager`, cleared by its own close(). But the
// backdrop published no _navaidClose, and the global Escape handler treats that as "this
// modal does not self-handle" and calls a bare back.remove(). That skips close(), so the
// node went away while the guard stayed set -- and `if (manager) return` meant the button
// did nothing for the rest of the session. No error, no toast: a dead control.
//
// Two independent fixes, because either one alone leaves the other hole open: the backdrop
// now publishes its closer (so Escape routes through it, as every other modal does), and the
// guard asks the DOM whether its node is still on the page rather than trusting a variable
// no other path is obliged to clear.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function'
    && !document.documentElement.classList.contains('app-booting'));
  await page.evaluate(() => { const b = document.getElementById('boot-loading'); if (b) b.remove(); });
  await expect(page.locator('#offline-tiles-btn')).toHaveCount(1);
}

const isOpen = page => page.evaluate(() => !!document.querySelector('.offline-manager-back'));
const press = async (page) => {
  await page.evaluate(() => document.getElementById('offline-tiles-btn').click());
  await page.waitForTimeout(450);
};

test('Escape closes it and the button opens it again', async ({ page }) => {
  await boot(page);
  await press(page);
  expect(await isOpen(page), 'did not open').toBe(true);

  await page.keyboard.press('Escape');
  await expect.poll(() => isOpen(page), { message: 'Escape did not close it' }).toBe(false);

  await press(page);
  expect(await isOpen(page), 'the button was dead after Escape').toBe(true);
});

test('the backdrop publishes its own closer, as every other modal does', async ({ page }) => {
  await boot(page);
  await press(page);
  // This is what the global Escape handler looks for before deciding whether to route
  // through the modal or remove it blind.
  expect(await page.evaluate(() =>
    typeof document.querySelector('.offline-manager-back')._navaidClose)).toBe('function');
});

test('a backdrop removed by any other means does not lock the window shut', async ({ page }) => {
  await boot(page);
  await press(page);
  expect(await isOpen(page)).toBe(true);
  // Whatever takes the node out -- a sweep, a stray remove(), a future caller that does not
  // know about close() -- the next press must still work.
  await page.evaluate(() => document.querySelector('.offline-manager-back').remove());
  expect(await isOpen(page)).toBe(false);
  await press(page);
  expect(await isOpen(page), 'guard left stale by a bare remove()').toBe(true);
});
