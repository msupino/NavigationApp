// @ts-check
// On a phone the inspector covers the half of the map a waypoint is being dragged towards.
// A press cannot be told from a drag until the finger lifts, so the panel waits for the
// release: a tap opens it, a drag never opens it at all. It used to open on the press and
// hide again on the first movement, which flashed the panel across the map on every drag.
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
  expect(await hidden(page)).toBe(true);             // nothing opens on the press
  await touch(page, 'touchmove', p.x + 60, p.y + 40);
  expect(await hidden(page)).toBe(true);             // ...and dragging never opens it
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

// A fingertip never lands still: a tap arrives with a few pixels of travel. Without a
// threshold that travel was applied to the waypoint, so pressing a point to open it nudged
// it off its position -- and, once a moved drag started closing the panel, pressing a point
// both moved it AND refused to open.
test('a press with fingertip jitter neither moves the point nor closes the panel', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => ({ lat: state.waypoints[0].lat, lng: state.waypoints[0].lng }));
  const p = await at(page, 0);
  await touch(page, 'touchstart', p.x, p.y);
  for (const [dx, dy] of [[2, 1], [3, -2], [1, 2]]) {          // well inside the threshold
    await touch(page, 'touchmove', p.x + dx, p.y + dy);
  }
  await touch(page, 'touchend', p.x + 1, p.y + 2);
  const after = await page.evaluate(() => ({ lat: state.waypoints[0].lat, lng: state.waypoints[0].lng }));
  expect(after).toEqual(before);                                // not nudged
  expect(await hidden(page)).toBe(false);                       // still a tap: panel opens
  expect(await page.evaluate(() => state.selected && state.selected.index)).toBe(0);
});

test('past the threshold it is a drag again', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => state.waypoints[0].lat);
  const p = await at(page, 0);
  await touch(page, 'touchstart', p.x, p.y);
  await touch(page, 'touchmove', p.x + 4, p.y + 3);             // under: still a tap
  expect(await page.evaluate(() => state.waypoints[0].lat)).toBe(before);
  await touch(page, 'touchmove', p.x + 60, p.y + 45);           // over: a drag
  expect(await hidden(page)).toBe(true);                        // never opened
  await touch(page, 'touchend', p.x + 60, p.y + 45);
  expect(await page.evaluate(() => state.waypoints[0].lat)).not.toBe(before);
});

test('a tap that never moves opens the panel on release', async ({ page }) => {
  await boot(page);
  const p = await at(page, 1);
  await touch(page, 'touchstart', p.x, p.y);
  await touch(page, 'touchend', p.x, p.y);
  expect(await hidden(page)).toBe(false);
  expect(await page.evaluate(() => document.getElementById('inspector').classList.contains('insp-drag-hidden'))).toBe(false);
});

// Reported from a phone: "browsing map on mobile is popping up inspector all the time".
// Pressing a leg line does not drag anything — the map pans under the finger — so the touch
// handler kept its hands off it entirely, and never noticed the finger had travelled. The
// release then read as a tap on the leg and opened its panel, on every pan that happened to
// start on the route.
test.describe('panning the chart is not a request to inspect', () => {
  // Container coordinates, offset by the map's own box, exactly like at() above.
  const legMidpoint = (page) => page.evaluate(() => {
    const a = map.latLngToContainerPoint([state.waypoints[0].lat, state.waypoints[0].lng]);
    const b = map.latLngToContainerPoint([state.waypoints[1].lat, state.waypoints[1].lng]);
    const box = map.getContainer().getBoundingClientRect();
    return { x: Math.round(box.left + (a.x + b.x) / 2), y: Math.round(box.top + (a.y + b.y) / 2) };
  });

  test('a pan that starts on a leg leaves the panel shut', async ({ page }) => {
    await boot(page);
    const mid = await legMidpoint(page);
    await touch(page, 'touchstart', mid.x, mid.y);
    await touch(page, 'touchmove', mid.x + 80, mid.y + 60);
    await touch(page, 'touchend', mid.x + 80, mid.y + 60);
    expect(await hidden(page)).toBe(true);
    // ...and the leg it passed over is not left highlighted with nothing to explain it.
    expect(await page.evaluate(() => state.selected)).toBe(null);
  });

  // The other half of the same rule: a genuine tap on a leg still opens it. That is how a leg
  // is inspected on a touch screen.
  test('a tap on a leg still opens it', async ({ page }) => {
    await boot(page);
    const mid = await legMidpoint(page);
    await touch(page, 'touchstart', mid.x, mid.y);
    await touch(page, 'touchmove', mid.x + 2, mid.y + 1);      // a fingertip is never still
    await touch(page, 'touchend', mid.x + 2, mid.y + 1);
    expect(await hidden(page)).toBe(false);
    expect(await page.evaluate(() => state.selected && state.selected.type)).toBe('leg');
  });
});

// Reported from a phone: pinching to zoom with a finger on a waypoint opened that waypoint's
// inspector. The two-finger paths deliberately move nothing — touchmove returns early unless
// exactly one finger is down — so the release read as a tap. Same rule the map pan already
// follows: the finger came down to do something else.
test.describe('a pinch is not a tap', () => {
  const multi = (page, type, pts) => page.evaluate(([t, list]) => {
    const el = map.getContainer();
    const touches = list.map((p, i) => new Touch({
      identifier: i, target: el, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y }));
    el.dispatchEvent(new TouchEvent(t, { bubbles: true, cancelable: true,
      touches: t === 'touchend' ? [] : touches, targetTouches: touches, changedTouches: touches }));
  }, [type, pts]);

  const wpPoint = (page, i) => page.evaluate((idx) => {
    const p = map.latLngToContainerPoint([state.waypoints[idx].lat, state.waypoints[idx].lng]);
    const b = map.getContainer().getBoundingClientRect();
    return { x: Math.round(b.left + p.x), y: Math.round(b.top + p.y) };
  }, i);

  test('zooming with a finger on a waypoint leaves the panel shut', async ({ page }) => {
    await boot(page);
    const at = await wpPoint(page, 0);
    await multi(page, 'touchstart', [at]);
    await multi(page, 'touchstart', [at, { x: at.x + 60, y: at.y + 40 }]);
    await multi(page, 'touchmove', [{ x: at.x - 20, y: at.y - 10 }, { x: at.x + 110, y: at.y + 90 }]);
    await multi(page, 'touchend', [{ x: at.x - 20, y: at.y - 10 }]);
    expect(await hidden(page)).toBe(true);
    expect(await page.evaluate(() => state.selected)).toBe(null);
  });

  test('the waypoint itself does not move during the pinch', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => ({ ...state.waypoints[0] }));
    const at = await wpPoint(page, 0);
    await multi(page, 'touchstart', [at]);
    await multi(page, 'touchstart', [at, { x: at.x + 60, y: at.y + 40 }]);
    await multi(page, 'touchmove', [{ x: at.x - 40, y: at.y - 30 }, { x: at.x + 140, y: at.y + 120 }]);
    await multi(page, 'touchend', [{ x: at.x - 40, y: at.y - 30 }]);
    const after = await page.evaluate(() => ({ ...state.waypoints[0] }));
    expect(after.lat).toBeCloseTo(before.lat, 6);
    expect(after.lng).toBeCloseTo(before.lng, 6);
  });

  // A single-finger tap on the same waypoint still opens it — that is how a waypoint is
  // inspected on a touch screen.
  test('a plain tap still opens the waypoint', async ({ page }) => {
    await boot(page);
    const at = await wpPoint(page, 0);
    await touch(page, 'touchstart', at.x, at.y);
    await touch(page, 'touchend', at.x, at.y);
    expect(await hidden(page)).toBe(false);
  });
});
