// @ts-check
// The comm-change callout is an arrow from a waypoint to a label. While either end is being
// dragged it sweeps a heavy black line across the chart — over the very ground the point is
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

test('dragging the callout itself hides it too', async ({ page }) => {
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
  expect(during).toBe(0);
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
