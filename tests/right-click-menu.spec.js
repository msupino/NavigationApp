// @ts-check
// Asked: "can we capture right click for quick edit actions?" A right-click on the map opens a
// small menu at the cursor with what can be done to whatever is under it. On a route point, a
// leg, a chart point or a note it carries that item's own inspector actions (mirrored, so the
// two cannot disagree), plus insert / rename / edit; on open map: add a waypoint or a note,
// Direct to, what is here, distance from the aircraft. Dimmed, never hidden.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 1300, height: 850 } });

async function boot(page, lang = 'en') {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => window.NavAidContextMenu && typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.40, lng: 34.95, name: 'B' },
      { lat: 32.60, lng: 35.05, name: 'C' }];
    state.legs = []; syncLegs();
    map.setView([32.38, 34.95], 10, { animate: false }); draw();
  });
}
// Right-click at a lat/lng (or with modifiers); returns the menu's items, '~' marking dimmed.
const rightClick = (page, ll, opts = {}) => page.evaluate(([ll, opts]) => {
  const c = map.getContainer().getBoundingClientRect();
  const p = map.latLngToContainerPoint(ll);
  const ev = new MouseEvent('contextmenu', Object.assign({ bubbles: true, cancelable: true,
    clientX: c.left + p.x, clientY: c.top + p.y }, opts));
  map.getContainer().dispatchEvent(ev);
  const m = document.querySelector('.ctx-menu');
  return { prevented: ev.defaultPrevented,
    items: m ? [...m.querySelectorAll('.ctx-item')].map(b => (b.classList.contains('is-dim') ? '~' : '') + b.textContent.trim()) : null };
}, [ll, opts]);
const press = (page, text) => page.evaluate((text) => {
  const b = [...document.querySelectorAll('.ctx-menu .ctx-item')].find(x => x.textContent.includes(text));
  b.click();
}, text);

test('on open map: add to the route, a note, Direct to, what is here, distance', async ({ page }) => {
  await boot(page);
  const r = await rightClick(page, [32.05, 35.25]);
  expect(r.prevented).toBe(true);                       // no browser menu
  expect(r.items).toEqual(['Add to route', '~Direct to', 'Add note here', 'What is here',
    '~Distance from the aircraft']);
  await press(page, 'Add note here');
  const notes = await page.evaluate(() => ({ n: state.notes.length, sel: state.selected && state.selected.type }));
  expect(notes).toEqual({ n: 1, sel: 'note' });
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
});

test('on a route waypoint: its inspector actions, plus insert after and rename', async ({ page }) => {
  await boot(page);
  const r = await rightClick(page, [32.40, 34.95]);
  const inspector = await page.evaluate(() => ({
    sel: state.selected,
    buttons: [...document.querySelectorAll('#insp-body .insp-actions button.insp-btn')]
      .map(b => b.textContent.trim().replace(/^[^\p{L}\p{N}(]+/u, '')),
  }));
  expect(inspector.sel).toEqual({ type: 'wp', index: 1 });
  expect(r.items.slice(0, 2)).toEqual(['Insert waypoint after', 'Rename']);
  // Every inspector action is in the menu, in the panel's order.
  expect(r.items.slice(2).map(s => s.replace(/^~/, ''))).toEqual(inspector.buttons);
  await press(page, 'Insert waypoint after');
  const wps = await page.evaluate(() => state.waypoints.map(w => [w.lat, w.lng]));
  expect(wps.length).toBe(4);
  expect(wps[2]).toEqual([32.5, 35]);                   // halfway along the next leg
});

test('the last waypoint has no leg after it: insert after is dimmed, saying why', async ({ page }) => {
  await boot(page);
  const r = await rightClick(page, [32.60, 35.05]);
  expect(r.items[0]).toBe('~Insert waypoint after');
  await press(page, 'Insert waypoint after');
  await expect(page.locator('.toast')).toContainText('The last point has no leg after it');
  expect(await page.evaluate(() => state.waypoints.length)).toBe(3);
});

test('on a leg: insert a waypoint where it was clicked', async ({ page }) => {
  await boot(page);
  const r = await rightClick(page, [32.50, 35.00]);
  expect(r.items[0]).toBe('Insert waypoint here');
  await press(page, 'Insert waypoint here');
  expect(await page.evaluate(() => state.waypoints.length)).toBe(4);
});

test('a locked route dims the edits, with the lock as the reason', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.editLocked = true; });
  const r = await rightClick(page, [32.05, 35.25]);
  expect(r.items).toContain('~Add note here');
  await press(page, 'Add note here');
  expect(await page.evaluate(() => state.notes.length)).toBe(0);
});

test('Escape closes it; Shift + right-click is the browser\'s own menu', async ({ page }) => {
  await boot(page);
  await rightClick(page, [32.05, 35.25]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
  const r = await rightClick(page, [32.05, 35.25], { shiftKey: true });
  expect(r.prevented).toBe(false);
  expect(r.items).toBeNull();
});

test('Hebrew', async ({ page }) => {
  await boot(page, 'he');
  const r = await rightClick(page, [32.05, 35.25]);
  expect(r.items).toContain('הוסף הערה כאן');
  expect(r.items).toContain('מה יש כאן');
});
