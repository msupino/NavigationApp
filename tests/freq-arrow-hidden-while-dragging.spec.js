// @ts-check
// The comm-change callout is an arrow from a waypoint to a label. While either end is being
// dragged by its WAYPOINT end it sweeps a heavy black line across the chart — over the very ground the point is
// being dragged towards. It goes for the duration of the drag and comes back where things
// land (or does not come back, if the drop broke its link to the comm-change point — that
// rule is unchanged).
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

// DEROR is a comm-change point in the dataset; a route waypoint on it seeds the callout.
async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof seedCommChangeNotes === 'function' &&
    typeof commChangeMap === 'object' && commChangeMap);
  return page.evaluate(() => {
    const name = Object.keys(commChangeMap).find(k => commChangeMap[k] && commChangeMap[k].commChange);
    const ref = (navWP || []).find(w => (w.name || '') === name);
    state.waypoints = [
      { lat: ref.lat, lng: ref.lng, name },
      { lat: ref.lat - 0.15, lng: ref.lng + 0.15, name: 'OTHER' },
    ];
    syncLegs();
    seedCommChangeNotes();
    draw();
    return { name, notes: state.notes.filter(n => n.cc).length };
  });
}

// Which comm-change callouts painted this frame. Counted by wrapping the drawing function
// rather than by reading pixels: the question is whether it was asked to paint at all.
const calloutDrawn = (page) => page.evaluate(() => {
  let drawn = 0;
  const orig = window.drawCommCallout;
  window.drawCommCallout = (...a) => { drawn++; return orig.apply(null, a); };
  draw();
  window.drawCommCallout = orig;
  return drawn;
});

test('the callout exists and paints when nothing is moving', async ({ page }) => {
  const seeded = await boot(page);
  expect(seeded.notes).toBeGreaterThan(0);
  expect(await calloutDrawn(page)).toBeGreaterThan(0);
});

test('it disappears while its waypoint is being dragged, and returns after', async ({ page }) => {
  await boot(page);
  const during = await page.evaluate(() => {
    // Exactly what a real drag sets: a moved touch drag of waypoint 0.
    touchDrag = { kind: 'wp', i: 0, moved: true };
    let drawn = 0;
    const orig = window.drawCommCallout;
    window.drawCommCallout = (...a) => { drawn++; return orig.apply(null, a); };
    draw();
    window.drawCommCallout = orig;
    return drawn;
  });
  expect(during).toBe(0);
  await page.evaluate(() => { touchDrag = null; });
  expect(await calloutDrawn(page)).toBeGreaterThan(0);   // finger up: back again
});

test('dragging the callout itself keeps it painted -- you are aiming it', async ({ page }) => {
  await boot(page);
  const during = await page.evaluate(() => {
    const idx = state.notes.findIndex(n => n.cc);
    touchDrag = { kind: 'note', i: idx, moved: true };
    let drawn = 0;
    const orig = window.drawCommCallout;
    window.drawCommCallout = (...a) => { drawn++; return orig.apply(null, a); };
    draw();
    window.drawCommCallout = orig;
    return drawn;
  });
  expect(during).toBeGreaterThan(0);
});

test('an unrelated drag leaves it alone', async ({ page }) => {
  await boot(page);
  const during = await page.evaluate(() => {
    touchDrag = { kind: 'wp', i: 1, moved: true };   // the OTHER waypoint
    let drawn = 0;
    const orig = window.drawCommCallout;
    window.drawCommCallout = (...a) => { drawn++; return orig.apply(null, a); };
    draw();
    window.drawCommCallout = orig;
    return drawn;
  });
  expect(during).toBeGreaterThan(0);
});

// The two cases the synthetic state above cannot vouch for. Both were broken when this was
// first written, and both looked identical to production because nothing hid:
//   - the live wp.name is CLEARED by applyNavSnap as soon as the point leaves its snap
//     position, so matching the callout by the waypoint's current name compared '' to the
//     callout's code, every frame of the only drag that matters;
//   - `moved` was set for waypoint drags only, so a drag of anything else never registered
//     as a drag at all (which is what `moved` is still needed for elsewhere).
test.describe('a real drag, driven through the handlers', () => {
  const countDuring = (page, what) => page.evaluate((which) => {
    const noteIdx = state.notes.findIndex(n => n.cc);
    const target = which === 'note'
      ? { lat: state.notes[noteIdx].lat, lng: state.notes[noteIdx].lng }
      : { lat: state.waypoints[0].lat, lng: state.waypoints[0].lng };
    const p0 = map.latLngToContainerPoint([target.lat, target.lng]);
    map.fire('mousedown', { containerPoint: p0, latlng: L.latLng(target.lat, target.lng) });
    const p1 = L.point(p0.x + 60, p0.y + 40);
    map.fire('mousemove', { containerPoint: p1, latlng: map.containerPointToLatLng(p1) });
    let drawn = 0;
    const orig = window.drawCommCallout;
    window.drawCommCallout = (...a) => { drawn++; return orig.apply(null, a); };
    draw();
    window.drawCommCallout = orig;
    const nameNow = state.waypoints[0].name;
    endMouseDrag();
    return { drawn, nameNow };
  }, what);

  test('dragging the callout keeps it painted, so it can be aimed', async ({ page }) => {
    await boot(page);
    expect((await countDuring(page, 'note')).drawn).toBeGreaterThan(0);
  });

  test('dragging its waypoint hides it, even though the drag clears the name', async ({ page }) => {
    await boot(page);
    const out = await countDuring(page, 'wp');
    expect(out.nameNow).toBe('');     // the snap dropped it -- this is why origName is used
    expect(out.drawn).toBe(0);
  });
});

test('a press that never moves keeps it drawn', async ({ page }) => {
  await boot(page);
  const during = await page.evaluate(() => {
    touchDrag = { kind: 'wp', i: 0, moved: false };   // a tap, not a drag
    let drawn = 0;
    const orig = window.drawCommCallout;
    window.drawCommCallout = (...a) => { drawn++; return orig.apply(null, a); };
    draw();
    window.drawCommCallout = orig;
    return drawn;
  });
  expect(during).toBeGreaterThan(0);
});
