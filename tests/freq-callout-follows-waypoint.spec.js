// @ts-check
// Reported: dragging a waypoint that carries a frequency change onto ANOTHER waypoint left
// the callout behind, floating on a point with no waypoint under it. No waypoint, no
// frequency change — the callout describes a call the pilot would never make.
//
// The delete path pruned callouts by the deleted waypoint's CURRENT name, and a waypoint
// dropped onto another adopts that one's name during the drag: by deletion time it no
// longer answered to the comm-change point it was seeded from.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof seedCommChangeNotes === 'function' &&
    commChangeMap && Array.isArray(navWP) && navWP.length > 0);
}

// A route: a plain point, then a waypoint sitting on a comm-change point.
const seed = (page) => page.evaluate(() => {
  const cc = Object.keys(commChangeMap).find(k => commChangeMap[k] && commChangeMap[k].commChange);
  const p = navWP.find(w => w.name === cc);
  const other = { lat: p.lat - 0.25, lng: p.lng + 0.25, name: 'OTHER' };
  state.waypoints = [other, { lat: p.lat, lng: p.lng, name: p.name }];
  syncLegs(); seedCommChangeNotes(); draw();
  return { cc, callouts: state.notes.filter(n => n.cc).length };
});

const dragOnto = (page, from, to) => page.evaluate(([f, t]) => {
  const a = state.waypoints[f], b = state.waypoints[t];
  const p0 = map.latLngToContainerPoint([a.lat, a.lng]);
  map.fire('mousedown', { containerPoint: p0, latlng: L.latLng(a.lat, a.lng) });
  const p1 = map.latLngToContainerPoint([b.lat, b.lng]);
  map.fire('mousemove', { containerPoint: p1, latlng: L.latLng(b.lat, b.lng) });
  endMouseDrag();
  draw();
}, [from, to]);

const callouts = (page) => page.evaluate(() => state.notes.filter(n => n.cc).map(n => n.cc));

test('the callout goes when its waypoint is dropped onto another one', async ({ page }) => {
  await boot(page);
  const s = await seed(page);
  expect(s.callouts).toBe(1);
  await dragOnto(page, 1, 0);
  expect(await callouts(page)).toEqual([]);
});

test('...and the waypoint really is gone, not just renamed', async ({ page }) => {
  await boot(page);
  await seed(page);
  await dragOnto(page, 1, 0);
  const names = await page.evaluate(() => state.waypoints.map(w => w.name));
  expect(names).toEqual(['OTHER']);
});

test('a callout whose waypoint is merely dragged AWAY also goes', async ({ page }) => {
  await boot(page);
  await seed(page);
  await page.evaluate(() => {
    const wp = state.waypoints[1];
    const p0 = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: p0, latlng: L.latLng(wp.lat, wp.lng) });
    const p1 = L.point(p0.x + 220, p0.y + 160);           // nowhere near any comm point
    map.fire('mousemove', { containerPoint: p1, latlng: map.containerPointToLatLng(p1) });
    endMouseDrag();
    draw();
  });
  expect(await callouts(page)).toEqual([]);
});

test('a callout whose waypoint stays put is left alone', async ({ page }) => {
  await boot(page);
  const s = await seed(page);
  await page.evaluate(() => {
    const other = state.waypoints[0];
    const p0 = map.latLngToContainerPoint([other.lat, other.lng]);
    map.fire('mousedown', { containerPoint: p0, latlng: L.latLng(other.lat, other.lng) });
    const p1 = L.point(p0.x + 30, p0.y + 20);             // move the OTHER waypoint
    map.fire('mousemove', { containerPoint: p1, latlng: map.containerPointToLatLng(p1) });
    endMouseDrag();
    draw();
  });
  expect(await callouts(page)).toEqual([s.cc]);
});
