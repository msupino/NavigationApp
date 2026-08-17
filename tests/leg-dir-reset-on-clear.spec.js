// @ts-check
// Reported: after deleting the route, the Route direction picker stays lit and still reads
// whichever direction the deleted route was filtered to. There is no route to have a
// direction — the control must dim and read "outbound only", exactly as it does for any
// route without a turning point.
const { test, expect } = require('./_setup');

const OUT_AND_BACK = [
  { lat: 32.00, lng: 34.00, name: 'ALPHA' },
  { lat: 32.20, lng: 34.00, name: 'BRAVO' },
  { lat: 32.00, lng: 34.00, name: 'ALPHA' },
];

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' &&
    !!document.getElementById('leg-dir-select'));
  // The picker lives in a toolbar section; open them so it is reachable.
  await page.evaluate(() => {
    for (const s of ['build', 'view', 'display']) {
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) { /* */ }
    }
  });
}

const picker = (page) => page.evaluate(() => {
  const sel = document.getElementById('leg-dir-select');
  const row = sel.closest('label');
  return {
    value: sel.value,
    disabled: sel.disabled,
    dimmed: !!(row && row.classList.contains('navtoggle-disabled')),
    filter: window.legDirFilter,
  };
});

test('an out-and-back lights the picker; clearing the map dims it and resets it', async ({ page }) => {
  await boot(page);
  await page.evaluate((wps) => {
    state.waypoints = wps.map(w => ({ ...w }));
    syncLegs();
    draw();
  }, OUT_AND_BACK);
  // Pick a direction, the way a pilot would.
  await page.evaluate(() => {
    const sel = document.getElementById('leg-dir-select');
    sel.value = 'back';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const chosen = await picker(page);
  expect(chosen.disabled).toBe(false);
  expect(chosen.value).toBe('back');
  expect(chosen.filter).toBe('back');

  // Clear map.
  await page.evaluate(() => {
    window.confirm = () => true;
    document.getElementById('clear').click();
  });
  const cleared = await picker(page);
  expect(cleared.disabled).toBe(true);        // nothing to divide
  expect(cleared.dimmed).toBe(true);
  expect(cleared.value).toBe('out');          // not the deleted route's 'back'
  expect(cleared.filter).toBe('out');
  expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
});

test('the choice still returns for the next route that has a turn', async ({ page }) => {
  await boot(page);
  await page.evaluate((wps) => { state.waypoints = wps.map(w => ({ ...w })); syncLegs(); }, OUT_AND_BACK);
  await page.evaluate(() => {
    const sel = document.getElementById('leg-dir-select');
    sel.value = 'back';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.evaluate(() => { window.confirm = () => true; document.getElementById('clear').click(); });
  expect((await picker(page)).value).toBe('out');
  // A new out-and-back: the remembered choice comes back, because clearing must not erase
  // a real preference -- only stop describing a route that is not there.
  await page.evaluate((wps) => { state.waypoints = wps.map(w => ({ ...w })); syncLegs(); }, OUT_AND_BACK);
  const again = await picker(page);
  expect(again.disabled).toBe(false);
  expect(again.value).toBe('back');
});
