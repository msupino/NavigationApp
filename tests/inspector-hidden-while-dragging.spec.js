// @ts-check
// On a phone the inspector covers the half of the map a waypoint is being dragged towards,
// and it is rebuilt on every frame of the drag. Hidden while the finger is down, back as
// soon as it lifts — with the same waypoint still selected, so nothing has to be re-found.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof showInspector === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.10, lng: 34.80, name: 'ALPHA' },
      { lat: 32.00, lng: 34.90, name: 'BRAVO' },
    ];
    syncLegs();
    draw();
  });
}

// Screen position of a waypoint.
const at = (page, i) => page.evaluate((idx) => {
  const p = map.latLngToContainerPoint([state.waypoints[idx].lat, state.waypoints[idx].lng]);
  const b = map.getContainer().getBoundingClientRect();
  return { x: b.left + p.x, y: b.top + p.y };
}, i);

const hidden = (page) => page.evaluate(() => {
  const el = document.getElementById('inspector');
  return el.classList.contains('hidden') || getComputedStyle(el).display === 'none';
});

const touch = (page, type, x, y) => page.evaluate(([t, px, py]) => {
  const el = map.getContainer();
  const b = el.getBoundingClientRect();
  const init = { clientX: px, clientY: py, pageX: px, pageY: py, identifier: 1, target: el };
  const list = t === 'touchend' ? [] : [new Touch(init)];
  el.dispatchEvent(new TouchEvent(t, {
    bubbles: true, cancelable: true, touches: list, targetTouches: list,
    changedTouches: [new Touch(init)],
  }));
  return { b: b.width };
}, [type, x, y]);

test('the panel goes away for the drag and comes back after it', async ({ page }) => {
  await boot(page);
  const p = await at(page, 0);
  await touch(page, 'touchstart', p.x, p.y);
  expect(await hidden(page)).toBe(false);            // a touch alone is a tap: panel opens
  await touch(page, 'touchmove', p.x + 60, p.y + 40);
  expect(await hidden(page)).toBe(true);             // ...dragging hides it
  await touch(page, 'touchmove', p.x + 90, p.y + 70);
  expect(await hidden(page)).toBe(true);
  await touch(page, 'touchend', p.x + 90, p.y + 70);
  // The finger came down to MOVE the point, not to read about it: the panel stays shut.
  expect(await hidden(page)).toBe(true);
  expect(await page.evaluate(() => state.selected)).toBeNull();   // nothing left highlighted
  expect(await page.evaluate(() => state.waypoints[0].lat)).not.toBe(32.10);   // it moved
  // Not merely hidden by the drag class -- properly closed, so the next tap opens it clean.
  expect(await page.evaluate(() =>
    document.getElementById('inspector').classList.contains('insp-drag-hidden'))).toBe(false);
});

test('a tap right after a drag opens the panel again', async ({ page }) => {
  await boot(page);
  const p = await at(page, 0);
  await touch(page, 'touchstart', p.x, p.y);
  await touch(page, 'touchmove', p.x + 70, p.y + 50);
  await touch(page, 'touchend', p.x + 70, p.y + 50);
  expect(await hidden(page)).toBe(true);
  const q = await at(page, 1);
  await touch(page, 'touchstart', q.x, q.y);
  await touch(page, 'touchend', q.x, q.y);
  expect(await hidden(page)).toBe(false);
  expect(await page.evaluate(() => state.selected && state.selected.index)).toBe(1);
});

test('a tap that never moves keeps the panel up throughout', async ({ page }) => {
  await boot(page);
  const p = await at(page, 1);
  await touch(page, 'touchstart', p.x, p.y);
  await touch(page, 'touchend', p.x, p.y);
  expect(await hidden(page)).toBe(false);
  expect(await page.evaluate(() => document.getElementById('inspector').classList.contains('insp-drag-hidden'))).toBe(false);
});
